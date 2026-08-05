/* 0.10.5-cand.12 — prove the external-condition monitors detect what they claim to, stay silent
   when DIAG is off, and DISCRIMINATE between the states they are meant to tell apart.
   Each case names the observation that motivated it. Extracts the real MON block, monRaf,
   monSideTxt, monTxt, monMachineTxt and the shTick clock-gap run logic from the build. */
const fs=require('fs'), vm=require('vm'), path=process.argv[2]||'work.html';
const src=fs.readFileSync(path,'utf8');
function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const MONSRC=grab(/var MON=\{[\s\S]*?silentMs:0 \};/);
const code=[ grab(/var DIAG=false;/),
             grab(/var ENV=\{[\s\S]*?started:Date\.now\(\) \};/),
             grab(/function envHiddenDuring\(mark\)\{[^\n]*\}/),
             MONSRC,
             grab(/function monRaf\(\)\{[\s\S]*?\n\}/),
             grab(/function monMachineTxt\(\)\{[\s\S]*?\n\}/),
             grab(/function monTxt\(\)\{[\s\S]*?\n\}/),
             grab(/function monSideTxt\(\)\{[\s\S]*?\n\}/) ].join('\n');

let T=0, LOG=[];
const ctx={ performance:{now:()=>T}, log:(k,m)=>LOG.push(m),
            document:{visibilityState:'visible'}, screen:{width:2560,height:1440},
            window:{devicePixelRatio:2}, navigator:{hardwareConcurrency:8, deviceMemory:16},
            envNow:()=>'visible, focused, audio off' };
vm.createContext(ctx); vm.runInContext(code,ctx);
let fails=0;
function check(n,c){ if(!c) fails++; console.log((c?'PASS  ':'FAIL  ')+n); }
/* Re-run the DECLARATION rather than poking fields, so the declared sentinels are what is under
   test. Assigning ctx.MON.rafWarnT=0 here would have hidden exactly the defect this checks for. */
function reset(vis){ vm.runInContext(MONSRC,ctx); ctx.ENV.hides=0; ctx.ENV.visN=0;
  ctx.document.visibilityState=vis||'visible'; LOG=[]; T=0; }
function raf(gap){ T+=gap; ctx.monRaf(); }

console.log('— display pipeline (monitor asleep / window occluded) —');
/* a healthy visible page at 60 fps */
reset('visible'); ctx.DIAG=true;
for(let i=0;i<120;i++) raf(16);
check('60 fps visible page records no display stall', ctx.MON.rafStalls===0);
check('and logs nothing',                             LOG.length===0);

/* THE case this exists for: the tab is VISIBLE and focused, but the compositor has stopped.
   visibilityState stays "visible", so before cand.12 this state read as perfectly healthy. */
reset('visible');
raf(16); raf(300000); raf(16);
check('a 300 s freeze on a VISIBLE tab is caught',    ctx.MON.rafStalls===1);
check('the worst gap is recorded',                    Math.round(ctx.MON.rafWorst/1000)===300);
check('DIAG on: it is logged',                        LOG.some(l=>/display pipeline stopped for 300\.0 s/.test(l)));
check('the line says the tab was visible',            LOG.some(l=>/VISIBLE/.test(l)));
check('the line names the plausible causes',          LOG.some(l=>/monitor going to sleep/.test(l) && /covered by another/.test(l)));
check('it does not claim decoding was affected',      LOG.some(l=>/Decoding is unaffected/.test(l)));

/* THE case cand.12 shipped wrong. The harness only ever modelled a tab that was hidden for the
   whole interval; the real sequence is hidden, then VISIBLE, and the rAF that ends the gap fires
   after the flip. Graeme's smoke test backgrounded the tab for 15 s and 376 s and got back
   "the display pipeline stopped for 15.1 s / 376.1 s while this tab was VISIBLE" \u2014 exactly the
   hidden durations, reported as the one state the monitor exists to rule out. */
reset('visible'); ctx.DIAG=true;
raf(16);
ctx.document.visibilityState='hidden'; ctx.ENV.hides++; ctx.ENV.visN++;   /* backgrounded... */
T+=376000;
ctx.document.visibilityState='visible'; ctx.ENV.visN++;      /* ...and brought back */
ctx.monRaf();                                                /* the rAF that ends the gap */
check('a hidden-then-visible gap is NOT a display stall',  ctx.MON.rafStalls===0);
check('and nothing is logged about it',                    LOG.length===0);
check('it is not counted as the worst gap either',         ctx.MON.rafWorst===0);
/* and the very next interval, wholly visible, must work normally again */
raf(16); raf(20000);
check('the next genuine visible stall is still caught',    ctx.MON.rafStalls===1 && LOG.length===1);

/* rAF stopping while HIDDEN is normal browser behaviour, not a fault — Graeme's 10.9 h run was
   hidden for 613 of 655 minutes and must not score a single one of these. */
reset('hidden');
for(let i=0;i<20;i++) raf(60000);
check('a hidden tab racking up 20 min is NOT a stall', ctx.MON.rafStalls===0 && ctx.MON.rafWorst===0);
check('and nothing is logged for it',                  LOG.length===0);

/* DIAG off: the counter still runs, the line does not appear. This is the whole point of the
   switch — 500 of one tester's 552 lines were a single repeating notice. */
reset('visible'); ctx.DIAG=false;
raf(16); raf(20000); raf(16);   /* 20 s, comfortably past the 10 s rate-limit window, so the only
                                   thing that can keep this quiet is the DIAG gate itself */
check('DIAG off: the stall is still COUNTED',          ctx.MON.rafStalls===1);
check('DIAG off: nothing is logged',                   LOG.length===0);

/* Falsy zero is a live hazard where performance.now() is a sentinel — it bit twice already this
   release (STALL.warnT=0 swallowed every stall in a session's first ten seconds; ENV.hiddenSince=0
   meant a tab hidden at page load never accrued hidden time). A rate limit written against 0 would
   silently suppress the FIRST warning of every session, which is the one that matters most. */
reset('visible'); ctx.DIAG=true;
raf(16); raf(2000);
check('a stall in the first 10 s of a session is still reported', LOG.length===1);

/* rate-limited, or a sustained freeze becomes the transcript */
reset('visible'); ctx.DIAG=true;
for(let i=0;i<10;i++) raf(2000);
check('repeated stalls are counted individually',      ctx.MON.rafStalls===9);
check('but rate-limited to one line per 10 s',         LOG.length<=3);

console.log('\n— which side is the backlog on —');
ctx.MON.buf=0; ctx.MON.rafS=58; ctx.document.visibilityState='visible';
const clean=ctx.monSideTxt();
check('nothing queued + page running -> says it is not being sent to us',
      /not being sent to us/.test(clean) && /outbound socket buffer 0 bytes/.test(clean));
ctx.MON.buf=524288;
const dirty=ctx.monSideTxt();
check('a queued send buffer refuses to blame the other end', /may be at Bridge's end/.test(dirty));
ctx.MON.buf=0; ctx.MON.rafS=0;
check('a stopped display also refuses to conclude',    /may be at Bridge's end/.test(ctx.monSideTxt()));
ctx.document.visibilityState='hidden'; ctx.MON.rafS=0;
check('a HIDDEN tab with no rAF is still clean (rAF is meant to stop)',
      /not being sent to us/.test(ctx.monSideTxt()));
check('the three readings are distinguishable',        new Set([clean,dirty]).size===2);

console.log('\n— the footer stamps —');
ctx.document.visibilityState='visible'; ctx.DIAG=false; ctx.MON.buf=0; ctx.MON.bufMax=4096; ctx.MON.rafS=59;
ctx.MON.ltN=12; ctx.MON.ltWorst=1834; ctx.MON.rafStalls=2; ctx.MON.rafWorst=300000;
console.log('  monitors: '+ctx.monTxt());
check('monTxt reports display rate, stalls, buffer, long tasks and the switch',
      /display 59 frames\/s/.test(ctx.monTxt()) && /display stalled 2/.test(ctx.monTxt())
      && /send buffer 0 B \(peak 4096 B\)/.test(ctx.monTxt()) && /long tasks 12, worst 1834 ms/.test(ctx.monTxt())
      && /diagnostics off/.test(ctx.monTxt()));
ctx.MON.rafStalls=0;
check('a clean session says so plainly',               /no display stalls/.test(ctx.monTxt()));
console.log('  machine : '+ctx.monMachineTxt());
check('monMachineTxt reports cores, RAM and screen',
      /8 cores/.test(ctx.monMachineTxt()) && /16 GB RAM/.test(ctx.monMachineTxt()) && /2560×1440@2x/.test(ctx.monMachineTxt()));
ctx.navigator={}; ctx.screen=undefined; ctx.window={}; ctx.MON.battTxt='';
check('a browser that reports nothing says so, rather than printing an empty line',
      /not reported by this browser/.test(ctx.monMachineTxt()));

console.log('\n— repeating clock-gap notices are one notice —');
{
  const c2=[ grab(/var ENV=\{[\s\S]*?started:Date\.now\(\) \};/),
             grab(/function envNow\(\)\{[\s\S]*?\}\n/) ].join('\n');
  const tick=new Function('ENV','log','Date','envNow','document','envHiddenDuring',
    grab(/var _wall=Date\.now\(\)[\s\S]*?\} else \{ ENV\.gapVis=ENV\.visN; \}/)+'\n');
  const doc={visibilityState:'hidden'};
  const c={document:doc, audioOn:false, actx:null}; vm.createContext(c); vm.runInContext(c2,c);
  let WALL=0, L=[];
  const D={now:()=>WALL};
  const hidDuring=(mark)=>doc.visibilityState!=='visible'||c.ENV.visN!==mark;
  const go=(ms)=>{ WALL+=ms; tick(c.ENV, (k,m)=>L.push(m), D, c.envNow, doc, hidDuring); };
  c.ENV.lastWall=0;
  /* Bjarne's night: a backgrounded tab, one 60 s clamped tick every minute for 8.5 hours */
  go(1000);
  for(let i=0;i<500;i++) go(60000);
  check('500 identical gaps produce ONE line, not 500',  L.length===1);
  check('every gap is still counted',                    c.ENV.sleeps===500);
  check('the one line warns it will be summarised',      /summarised rather than repeated/.test(L[0]));
  L=[]; doc.visibilityState='visible';
  go(1000);                                              /* back to normal ticking */
  check('the run closes with one summary',               L.length===1 && /499 identical notices not repeated/.test(L[0]));
  check('the summary states the duration',               /over 500\.0 min/.test(L[0]));
  /* one suppressed notice is not "1 notices" */
  c.ENV.gapRun=0; c.ENV.gapSup=0; c.ENV.gapCause=''; c.ENV.gapVis=c.ENV.visN;
  doc.visibilityState='hidden'; L=[]; c.ENV.lastWall=WALL;
  go(60000); go(60000);                                  /* one logged, one suppressed */
  L=[]; doc.visibilityState='visible'; c.ENV.gapVis=c.ENV.visN; c.ENV.visN++;
  go(1000);
  check('a single suppressed notice reads as singular',
        L.some(l=>/1 identical notice not repeated/.test(l)));
  /* a DIFFERENT cause must not be folded into the same run */
  L=[]; c.ENV.lastWall=WALL;
  go(60000);                                             /* visible throughout -> "asleep", a new run */
  check('a machine sleeping starts a new notice',        L.length===1 && /most likely asleep/.test(L[0]));
  doc.visibilityState='hidden'; c.ENV.hides++; c.ENV.visN++; L=[];
  go(60000);                                             /* cause changes -> must speak again */
  check('a change of cause is not suppressed',           L.length===1 && /clamped its timers/.test(L[0]));

  /* cand.13: the tick that runs when a hidden tab comes BACK. visibilityState has already flipped
     to visible, so cand.12 reported the tail of a 376 s background period as "the machine was most
     likely asleep". The hide happened during the interval; that is what has to be read. */
  L=[]; doc.visibilityState='hidden'; c.ENV.visN++; c.ENV.gapVis=c.ENV.visN;
  go(60000);
  L=[]; doc.visibilityState='visible'; c.ENV.visN++;     /* brought back mid-interval */
  go(60000);
  check('the tick after a tab returns is named as throttling, not sleep',
        L.length===0 || (/clamped its timers/.test(L.join('|')) && !/most likely asleep/.test(L.join('|'))));

  /* a run that ends by CHANGE OF CAUSE must still report what it suppressed \u2014 cand.12 dropped it */
  c.ENV.gapRun=0; c.ENV.gapSup=0; c.ENV.gapCause=''; c.ENV.gapVis=c.ENV.visN;
  doc.visibilityState='hidden'; L=[]; c.ENV.lastWall=WALL;
  for(let i=0;i<20;i++) go(60000);
  check('20 hidden gaps produce one line',               L.length===1);
  L=[]; doc.visibilityState='visible'; c.ENV.gapVis=c.ENV.visN;
  go(60000);                                             /* cause flips to sleep */
  check('the previous run is closed off with its count', L.some(l=>/19 identical notices not repeated/.test(l)));
  check('and the new cause is announced',                L.some(l=>/most likely asleep/.test(l)));
}

console.log('\n'+(fails?(fails+' FAILED'):'all green')+'\n');
process.exitCode = fails?1:0;
