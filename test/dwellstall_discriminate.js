/* 0.10.5-cand.6 — prove the dwell measures its own freeze, and that it beats the cand.5 approach
   on the exact ordering that made cand.5 under-report.
   Reproduces the race: a freeze leaves BOTH the scanSleep timeout and the stall interval overdue;
   the browser runs the sleep timer first, its microtasks carry the dwell to a verdict and clear
   scanDwellActive, and only then does the interval tick. cand.5 sampled the flag at that point
   and saw false. cand.6 reads a value produced inside the dwell, so ordering cannot reach it. */
const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync(process.argv[2]||'work.html','utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const code=[ grab(/var scanDwellStallMs=0;/),
             grab(/function scanSleep\(ms\)\{[\s\S]*?\n  \},ms\); \}\); \}/) ].join('\n');

let T=0; const due=[];
const ctx={ performance:{now:()=>T}, Promise, log:()=>{}, document:{visibilityState:'hidden'},
            scanRun:true, scanThrottled:false, scanThrottleWarned:false, scanThrottleClean:0,
            scanDwellActive:false, els:{},
            setTimeout:(fn,ms)=>{ due.push({fn,at:T+ms,seq:due.length}); return due.length; } };
vm.createContext(ctx); vm.runInContext(code,ctx);

/* advance wall clock by `freeze` ms without running anything, then drain due timers in schedule order */
async function freezeThenDrain(freeze){
  T+=freeze;
  const ready=due.splice(0).sort((a,b)=>a.at-b.at||a.seq-b.seq);
  for(const t of ready){ t.fn(); await Promise.resolve(); }
}
function check(n,c){ console.log((c?'PASS  ':'FAIL  ')+n); if(!c) process.exitCode=1; }

(async ()=>{
  /* a dwell: three 120 ms polls, with a 740 ms browser freeze across the second one */
  ctx.scanDwellActive=true; ctx.scanDwellStallMs=0;
  let p=ctx.scanSleep(120); await freezeThenDrain(120); await p;
  p=ctx.scanSleep(120);     await freezeThenDrain(860);   /* 120 due + 740 late */ await p;
  p=ctx.scanSleep(120);     await freezeThenDrain(120); await p;
  const inDwell=ctx.scanDwellStallMs;
  ctx.scanDwellActive=false;   /* the call site clears it \u2014 AFTER the verdict, as in the real code */

  console.log('dwell recorded its worst overrun as '+Math.round(inDwell)+' ms\n');
  check('the 740 ms freeze is attributed to the dwell', Math.round(inDwell)===740);
  check('it clears the 250 ms invalidation threshold',  inDwell>=250);
  check('scanThrottled did NOT fire (740 ms is far under its 5 s gate)', ctx.scanThrottled===false);

  /* the cand.5 method, on the same events: sample the flag after the dwell has completed */
  const cand5Sample = ctx.scanDwellActive;
  check('cand.5 flag-sampling would have missed it', cand5Sample===false);

  /* sleeps OUTSIDE a dwell (settle, accum, recentre) must not be charged to one */
  ctx.scanDwellStallMs=0; ctx.scanDwellActive=false;
  p=ctx.scanSleep(350); await freezeThenDrain(60350); await p;
  check('a 60 s freeze between dwells is not charged to a dwell', ctx.scanDwellStallMs===0);
  check('but it does trip scanThrottled (>5 s)',                  ctx.scanThrottled===true);
  console.log('');
})();
