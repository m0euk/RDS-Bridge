/* 0.10.5-cand.3 — prove the stall detector reports real main-thread blocks and stays quiet
   otherwise. Extracts the real stallStart/stallTxt and drives the interval callback with
   stubbed wall-clock advances. */
const fs=require('fs'), vm=require('vm'), path=process.argv[2]||'work.html';
const src=fs.readFileSync(path,'utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const code=[ grab(/var STALL=\{[^\n]*\};/),
             grab(/function stallStart\(\)\{[\s\S]*?\n\}/),
             grab(/function stallTxt\(\)\{[^\n]*\}/) ].join('\n');

let T=0, LOG=[], cb=null;
const ctx={ performance:{now:()=>T}, log:(k,m)=>LOG.push(m), scanDwellActive:true,
            setInterval:(f)=>{ cb=f; return 1; } };
vm.createContext(ctx); vm.runInContext(code,ctx);

function reset(){ ctx.STALL.n=0;ctx.STALL.worst=0;ctx.STALL.total=0;ctx.STALL.last=0;ctx.STALL.warnT=0;ctx.STALL.t0=0;ctx.STALL.dwell=0;ctx.STALL.dwellWorst=0;ctx.scanDwellActive=true;
  T=0; LOG=[]; ctx.stallStart(); }
/* advance the clock by ms, then fire the tick the browser would have fired */
function tick(ms){ T+=ms; cb(); }

function check(n,c){ console.log((c?'PASS  ':'FAIL  ')+n); if(!c) process.exitCode=1; }

reset();
for(let i=0;i<40;i++) tick(250);                       // a healthy page: every tick on time
check('healthy page records no stalls',        ctx.STALL.n===0);
check('healthy page logs nothing',             LOG.length===0);

reset();
for(let i=0;i<4;i++) tick(250);
tick(3250);                                            // one 3 s block
check('a 3 s block is counted once',           ctx.STALL.n===1);
check('worst is the block, not the period',    Math.round(ctx.STALL.worst)===3000);
check('the interval detector no longer judges dwells', LOG.length===0 && ctx.STALL.dwell===0);   /* cand.6: whether a freeze damaged a verdict is answered by the dwell itself, see dwellstall_discriminate.js */

reset();
for(let i=0;i<4;i++) tick(250);
tick(600); tick(600); tick(600);                       // three 350 ms overruns
/* cand.5 dropped the 500 ms floor ON PURPOSE: the presence window is 300-500 ms, so a 350 ms
   freeze inside a dwell is precisely the one that fabricates an "empty" on a live station. It
   must report. The rate limit is what stops it becoming noise. */
check('sub-500ms overruns counted quietly',    ctx.STALL.n===3 && LOG.length===0);
check('total lost time accumulates',           Math.round(ctx.STALL.total)===1050);

reset();
tick(3250); T+=20000; tick(250); tick(3250);           // two big blocks >10 s apart
check('still silent across the rate limit window', LOG.length===0);

reset(); tick(3250); tick(3250);                       // two big blocks close together
check('counts both blocks, logs neither',      LOG.length===0 && ctx.STALL.n===2);

reset(); for(let i=0;i<4;i++) tick(250); tick(1250);
check('summary shows the dwell subset beside the raw count', /stalls ≥250ms: 1 \(0 during a dwell\), worst overall 1000 ms/.test(ctx.stallTxt()));

/* THE discrimination this build exists for: an idle or slept page racks up stalls with none of
   them on a dwell, and must not be reported as damage. Graeme's clean overnight run scored 625. */
reset(); ctx.scanDwellActive=false;
for(let i=0;i<4;i++) tick(250);
for(let i=0;i<20;i++) tick(60000);                     // twenty one-minute freezes, page idle
check('idle/slept page: stalls counted',       ctx.STALL.n===20 && ctx.STALL.worst>59000);
check('idle/slept page: none charged to a dwell', ctx.STALL.dwell===0);
check('idle/slept page: NOTHING logged',       LOG.length===0);
check('summary makes the benign case obvious', /\(0 during a dwell\)/.test(ctx.stallTxt()));
console.log('   idle case reads: '+ctx.stallTxt());
console.log('\n'+ctx.stallTxt()+'\n');
