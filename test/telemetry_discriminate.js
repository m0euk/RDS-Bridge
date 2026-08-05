/* 0.10.5-cand.1 — prove the instrument DISCRIMINATES before it goes to the bench.
   Extracts the real shTick / handleJSON echo-matcher from the build and drives them through the
   competing hypotheses with stubbed per-second timings. A diagnostic that cannot tell the
   hypotheses apart costs a bench round (0.8.6 diag.1). */
const fs=require('fs'), vm=require('vm'), path=process.argv[2]||'work.html';
const src=fs.readFileSync(path,'utf8');
let WALL=0;

function grab(re){ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; }
const code=[
  grab(/var SH=\{[\s\S]*?recentre:0 \};/),
  grab(/function shReset\(\)\{[\s\S]*?SH\.recentre=0; \}/),
  grab(/function shAge\(p\)\{[^\n]*\}/),
  grab(/function shAgeTxt\(p\)\{[^\n]*\}/),
  grab(/function shLagTxt\(\)\{[\s\S]*?\n[^\n]*\}/),
  grab(/function shDead\(\)\{[^\n]*\}/),
  grab(/var ENV=\{[\s\S]*?started:Date\.now\(\) \};/),
  grab(/function envNow\(\)\{[\s\S]*?\}\n/),
             grab(/function envHiddenDuring\(mark\)\{[^\n]*\}/),
  grab(/var MON=\{[\s\S]*?silentMs:0 \};/),
  grab(/var STALL=\{[^\n]*\};/),
  grab(/function stallTxt\(\)\{[^\n]*\}/),
  grab(/function shLinkTxt\(\)\{[^\n]*\}/),
  grab(/function monSideTxt\(\)\{[\s\S]*?\n\}/),
  grab(/function shTick\(\)\{[\s\S]*?\n\}/),
].join('\n');

let T=0, LOG=[];
const ctx={ performance:{now:()=>T}, log:(k,m)=>LOG.push(k+': '+m), Date:{now:()=>WALL},
            audioOn:false, actx:null, document:{visibilityState:'visible',hasFocus:()=>true},
            ws:{readyState:1}, sourceMode:'sdr', streaming:true, wfOn:true };
vm.createContext(ctx); vm.runInContext(code,ctx);

/* cand.14: a delivered frame also marks the stream as having EVER delivered — handleBinary
   and handleJSON do that, so the driver must too or every scenario reads as never-started. */
function seen(iq,spec,json){ if(iq)ctx.SH.everIq=true; if(spec)ctx.SH.everSpec=true; if(json)ctx.SH.everJson=true; }
function second(iq,spec,json,wk){ seen(iq,spec,json); ctx.SH.iq=iq; ctx.SH.spec=spec; ctx.SH.json=json; ctx.SH.wk=(wk==null?iq:wk); ctx.SH.tx=2; T+=1000; WALL+=1000; ctx.shTick(); }
/* a clamped tick: one callback covering `ms` of wall clock, carrying that whole period's frames */
function clamped(ms,iq,spec,json,wk){ seen(iq,spec,json); ctx.SH.iq=iq; ctx.SH.spec=spec; ctx.SH.json=json; ctx.SH.wk=(wk==null?iq:wk); ctx.SH.tx=2; T+=ms; WALL+=ms; ctx.shTick(); }
function run(name,fn){ LOG=[]; T=0; ctx.shReset(); ctx.streaming=true; ctx.wfOn=true; fn();
  console.log('\n=== '+name); LOG.forEach(l=>console.log('   '+l)); return LOG.join('\n'); }

const H1=run('H1 all streams stop (socket open)',()=>{ for(let i=0;i<5;i++) second(40,8,3); for(let i=0;i<70;i++) second(0,0,0); });   /* 70 s => warnings at 0, 30 and 60 s */
const H2=run('H2 spectrum only stops, IQ keeps flowing',()=>{ for(let i=0;i<5;i++) second(40,8,3); for(let i=0;i<40;i++) second(40,0,3); });
const H3=run('H3 everything flowing (control)',()=>{ for(let i=0;i<45;i++) second(40,8,3); });
const H4=run('H4 stops then recovers',()=>{ for(let i=0;i<3;i++) second(40,8,3); for(let i=0;i<10;i++) second(0,0,0); for(let i=0;i<3;i++) second(40,8,3); });

function check(name,cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if(!cond) process.exitCode=1; }
console.log('\n--- discrimination');
check('H1 names IQ and spectrum',            /IQ \(3s\) and spectrum \(3s\)/.test(H1));
check('H1 names property starvation too',    /property \(/.test(H1));
check('H2 names spectrum but NOT IQ',        /spectrum \(3s\)/.test(H2) && !/IQ \(/.test(H2));
check('H1 and H2 are distinguishable',       H1!==H2);
check('H3 (control) is silent',              H3==='');
/* cand.12: the full ~600-character explanation ran every 30 s for the whole outage — 150 copies
   in one tester's export. It teaches once; after that it only has to timestamp. */
check('H1 explains itself exactly once',     (H1.match(/WHAT TO DO/g)||[]).length===1);
check('H1 still re-reports while it lasts',  (H1.match(/still silent after/g)||[]).length>=2);
check('the repeats are short',               H1.split('\n').filter(l=>/still silent after/.test(l)).every(l=>l.length<200));
check('the first warning names the side-by-side test', /side by side/.test(H1) && /SDRConnect's OWN spectrum display freezes/.test(H1));
check('it says Bridge has paused its own poll', /paused its own once-a-second property poll/.test(H1));
check('H4 reports recovery with a duration', /streams resumed after 10 s/.test(H4));
/* cand.14: seed a live stream first — "dead" means a stream that WAS running and stopped. A
   never-started stream now has a 10 s grace, which is a different state and tested below. */
check('shDead() true only while dead',       (()=>{ ctx.shReset(); ctx.streaming=true; ctx.wfOn=true;
        for(let i=0;i<2;i++) second(40,8,3);
        for(let i=0;i<4;i++) second(0,0,0); const d=ctx.shDead(); for(let i=0;i<2;i++) second(40,8,3); return d && !ctx.shDead(); })());

/* the echo-lag matcher, driven directly */
console.log('\n--- echo lag matcher');
ctx.shReset(); T=0;
ctx.SH.wr['device_center_frequency']={v:97750000,t:0}; T=12400;
(function match(v){ const p=ctx.SH.wr['device_center_frequency'];
  if(p && Number(v)===p.v){ const lag=T-p.t; delete ctx.SH.wr['device_center_frequency'];
    ctx.SH.lagN++; ctx.SH.lagSum+=lag; if(lag>ctx.SH.lagMax) ctx.SH.lagMax=lag; } })(97750000);
check('12.4 s echo recorded as max', ctx.SH.lagMax===12400 && ctx.SH.lagN===1);
check('lag text is human-readable', /12\.40s max/.test(ctx.shLagTxt()));
ctx.SH.wr['device_center_frequency']={v:90917000,t:0}; T=100;
check('a non-matching echo does not count', (function(){ const p=ctx.SH.wr['device_center_frequency'];
  return !(p && Number(104583000)===p.v); })());
console.log('');

/* ── 0.10.5-cand.10: rates are per real second, not per tick ────────────────────────────────────
   A hidden tab clamped to 1/min delivers a whole minute of frames to one callback. cand.9 printed
   that as a per-second rate and produced "decoder 1295/s (nominal 25)" in Graeme's 03-Aug test 2. */
console.log('\n--- rate normalisation under a clamped tick');
ctx.shReset(); T=0; WALL=0; ctx.ENV.lastWall=0; LOG=[]; ctx.document.visibilityState='hidden';
for(let i=0;i<3;i++) second(25,28,18);
check('an unclamped tick reports the true rate', ctx.SH.wkS===25 && ctx.SH.iqS===25);
clamped(60000, 25*60, 28*60, 18*60);          // one minute of frames, one callback
check('a 60 s clamped tick still reports ~25/s, not 1500/s', Math.abs(ctx.SH.wkS-25)<=1);
check('...and the same for iq and spectrum',   Math.abs(ctx.SH.iqS-25)<=1 && Math.abs(ctx.SH.specS-28)<=1);
check('the clock gap is still reported',       /clock jumped 60 s/.test(LOG.join('\n')));
check('a hidden tab is named as throttling, not sleep',
      /clamped its timers/.test(LOG.join('\n')) && !/machine was most likely asleep/.test(LOG.join('\n')));
ctx.document.visibilityState='visible'; LOG=[];
clamped(300000, 0,0,0);
check('a VISIBLE tab losing 5 min is named as sleep',
      /machine was most likely asleep/.test(LOG.join('\n')) && !/clamped its timers/.test(LOG.join('\n')));
console.log('');


/* ── 0.10.5-cand.12: an echo that spans an outage is not a round-trip ───────────────────────
   It reported "SDRConnect took 4767.6 s to confirm device_vfo_frequency" for a write made before a
   79-minute blackout, and dragged the session average from sub-second to 17 s. We cannot tell a
   reply queued 4770 s ago from a fresh one sent on recovery, so the figure means only "we were
   blind that long" — which the outage counters already say properly. */
console.log('\n--- echo lag across an outage');
{
  const grabF=(re)=>{ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; };
  const c2=[ grabF(/var SH=\{[\s\S]*?recentre:0 \};/),
             grabF(/function shReset\(\)\{[\s\S]*?SH\.recentre=0; \}/),
             grabF(/function shLagTxt\(\)\{[\s\S]*?\n[^\n]*\}/),
             grabF(/var setProp=function\(p,v\)\{[\s\S]*?value:String\(v\)\}\);\};/),
             grabF(/function handleJSON\(text\)\{[\s\S]*?applyProp\(m\.property,m\.value\);\}\}/) ].join('\n');
  let TT=0;
  const c={ performance:{now:()=>TT}, log:()=>{}, JSON, Number, prop:{},
            applyProp:()=>{}, send:()=>{}, ws:{readyState:1} };
  require('vm').createContext(c); require('vm').runInContext(c2,c);
  c.shReset();
  /* a clean write, echoed 1.2 s later, with no outage in between */
  TT=0; c.setProp('device_vfo_frequency', 97500000);
  TT=1200; c.handleJSON(JSON.stringify({event_type:'property_changed',property:'device_vfo_frequency',value:'97500000'}));
  check('a clean 1.2 s echo is counted',      c.SH.lagN===1 && Math.round(c.SH.lagMax)===1200 && c.SH.lagVoid===0);
  /* a write, then an outage begins (deadEpoch bumps), then the echo arrives */
  TT=2000; c.setProp('device_vfo_frequency', 97700000);
  c.SH.deadEpoch++;                       // shTick does this on entering an outage
  TT=2000+4770000;
  c.handleJSON(JSON.stringify({event_type:'property_changed',property:'device_vfo_frequency',value:'97700000'}));
  check('an echo spanning an outage is NOT counted', c.SH.lagN===1 && c.SH.lagVoid===1);
  check('it does not become the max',        Math.round(c.SH.lagMax)===1200);
  check('the average is not poisoned',       Math.round(c.SH.lagSum/c.SH.lagN)===1200);
  check('the summary says how many were void', /1 spanned an outage, not counted/.test(c.shLagTxt()));
  /* the mutant: the version that shipped in cand.11 */
  const bad=c2.replace('if(pend.e!==SH.deadEpoch){ SH.lagVoid++; }\n      else {','if(false){}\n      else {');
  const c3={ performance:{now:()=>TT}, log:()=>{}, JSON, Number, prop:{}, applyProp:()=>{}, send:()=>{}, ws:{readyState:1} };
  require('vm').createContext(c3); require('vm').runInContext(bad,c3); c3.shReset();
  TT=0; c3.setProp('device_vfo_frequency', 97700000); c3.SH.deadEpoch++; TT=4770000;
  c3.handleJSON(JSON.stringify({event_type:'property_changed',property:'device_vfo_frequency',value:'97700000'}));
  check('mutant without the epoch check is caught', Math.round(c3.SH.lagMax/1000)===4770);
}
console.log('');


/* ── 0.10.5-cand.12: whose backlog is it? ───────────────────────────────────────────
   ws.bufferedAmount was never read. It is the one measurement that says whether OUR messages are
   leaving the browser, and without it "SDRConnect isn't answering" and "we aren't sending" look
   identical from the log. */
console.log('\n--- outbound socket backlog');
ctx.shReset(); T=0; WALL=0; ctx.ENV.lastWall=0; LOG=[]; ctx.MON.bufMax=0; ctx.MON.bufWarnT=NaN;   /* NaN, not 0 — the sentinel rule */
ctx.ws={readyState:1, bufferedAmount:0};
second(20,20,10);
check('an empty send buffer reads 0',        ctx.MON.buf===0 && ctx.MON.bufMax===0);
ctx.ws.bufferedAmount=4096; second(20,20,10);
check('a small backlog is sampled',          ctx.MON.buf===4096 && ctx.MON.bufMax===4096);
ctx.ws.bufferedAmount=0;    second(20,20,10);
check('the PEAK is retained after it drains', ctx.MON.buf===0 && ctx.MON.bufMax===4096);
check('a small backlog is not worth a line', !/outbound socket buffer/.test(LOG.join('\n')));
LOG=[]; ctx.ws.bufferedAmount=1048576; second(20,20,10);
check('a 1 MB backlog IS reported',          /outbound socket buffer has 1024 kB queued/.test(LOG.join('\n')));
check('and it says plainly that this end is at fault', /at Bridge's end, not SDRConnect's/.test(LOG.join('\n')));
LOG=[]; second(20,20,10); second(20,20,10);
check('it is rate-limited to once a minute', LOG.filter(l=>/outbound socket buffer/.test(l)).length===0);
ctx.ws={readyState:1};
console.log('');


/* ── 0.10.5-cand.12: don't pester a link that isn't answering ──────────────────────────────────
   refresh() fires twelve get_property calls a second for as long as the socket is open. Through a
   4770 s outage that is ~57,000 requests into a server that was not replying, and every recovery
   arrived as a json flood of 100-234/s. It does not make the outage ours — but while we are doing
   it we cannot say it is not. The guard is extracted verbatim so the test cannot drift from it. */
console.log('\n--- the 1 Hz property poll');
{
  const m=src.match(/if\((.*)\)\{getProp\("signal_snr"\)/);
  if(!m) throw new Error('poll guard not found — did the shape change?');
  console.log('  guard under test: '+m[1]);
  const polls=new Function('ws','shDead','return !!('+m[1]+');');
  check('polls on a healthy open socket',   polls({readyState:1},()=>false)===true);
  check('does NOT poll while streams are dead', polls({readyState:1},()=>true)===false);
  check('does not poll on a closed socket',  polls({readyState:3},()=>false)===false);
  check('does not poll with no socket',      polls(null,()=>false)===false);
  const mut=new Function('ws','shDead','return !!(ws&&ws.readyState===1);');
  check('the cand.11 guard is caught',       mut({readyState:1},()=>true)===true);
}
console.log('');


/* ── 0.10.5-cand.14: "has never sent" is not "has stopped sending" ─────────────────────────────
   Connecting with the RF waterfall on fired the full 600-character outage warning TWO SECONDS
   after connect, before the decoder had started — a log whose own text read "centre readback
   never seen" while announcing that SDRConnect had stopped sending. It is also the exact state a
   tester's rig reached after reconnecting to a wedged SDRConnect, where a fresh socket and a
   device restart both changed nothing, so the two cases must read differently. */
console.log('\n--- a stream that never started');
{
  const fresh=()=>{ ctx.shReset(); T=0; WALL=0; ctx.ENV.lastWall=0; LOG=[]; ctx.streaming=true; ctx.wfOn=true; };
  /* nothing has ever arrived: silent for the first 3 s must say NOTHING at all */
  fresh(); for(let i=0;i<3;i++) second(0,0,0);
  check('3 s after connect with nothing yet, silence',   LOG.length===0 && ctx.shDead()===false);
  for(let i=0;i<8;i++) second(0,0,0);
  const never=LOG.join('\n');
  check('after the 10 s grace it DOES speak',            LOG.length>0);
  check('it says "has not sent any", not "has stopped"', /has not sent any/.test(never) && !/has stopped sending/.test(never));
  check('it says plainly nothing arrived at all',        /not a dropout: nothing has arrived at all/.test(never));
  check('it points at the device, not at a dropout',     /device is selected and started/.test(never));
  check('it records what did NOT clear it',              /only closing SDRConnect and reopening it/.test(never));
  check('it does not offer the side-by-side test',       !/side by side/.test(never));

  /* a stream that WAS running keeps the 3 s window and the original wording */
  fresh(); for(let i=0;i<5;i++) second(40,8,3); LOG=[];
  for(let i=0;i<4;i++) second(0,0,0);
  const stopped=LOG.join('\n');
  check('a running stream still trips at 3 s',           LOG.length>0);
  check('and reads as "has stopped sending"',            /has stopped sending/.test(stopped) && !/has not sent any/.test(stopped));
  check('the two states are distinguishable',            never!==stopped);

  /* mixed: spectrum ran and stopped, IQ never started at all */
  fresh(); for(let i=0;i<5;i++) second(0,8,3); LOG=[];
  for(let i=0;i<12;i++) second(0,0,0);
  const mixed=LOG.join('\n');
  check('a mix reports as a stop, naming both streams',  /has stopped sending/.test(mixed) && /spectrum \(/.test(mixed) && /IQ \(/.test(mixed));
}
console.log('');


/* ── cand.14: the ever-flags must be set by the REAL dispatchers ───────────────────────────────
   The driver above marks them itself, so it tests the guard and not the predicate — the same trap
   that let scanInDxLog ship inert for two candidates. Drive the real handleBinary/handleJSON. */
console.log('\n--- ever-flags come from the real frame handlers');
{
  const g=(re)=>{ const m=src.match(re); if(!m) throw new Error('not found: '+re); return m[0]; };
  const c2=[ g(/var SH=\{[\s\S]*?recentre:0 \};/),
             g(/function shReset\(\)\{[\s\S]*?SH\.recentre=0; \}/),
             g(/function handleBinary\(buf\)\{[\s\S]*?els\.hintTxt\.textContent="live";\}\}\}/),
             g(/function handleJSON\(text\)\{[\s\S]*?applyProp\(m\.property,m\.value\);\}\}/) ].join('\n');
  const c={ DataView, JSON, Number, performance:{now:()=>0},
            audioFeed:()=>{}, wfFeed:()=>{}, scanAddFrame:()=>{}, applyProp:()=>{},
            scanAccumOn:false, fileSource:false, worker:null, streaming:true, prop:{}, canControl:true,
            samplesThisSec:0, els:{hintTxt:{}}, setPill:()=>{}, log:()=>{}, ws:{readyState:1} };
  require('vm').createContext(c); require('vm').runInContext(c2,c);
  const frame=(type,bytes)=>{ const b=new ArrayBuffer(bytes||16); new DataView(b).setUint16(0,type,true); return b; };
  c.shReset();
  check('a fresh connection has no ever-flags set',
        c.SH.everIq===false && c.SH.everSpec===false && c.SH.everJson===false);
  c.handleBinary(frame(3));
  check('a spectrum frame marks everSpec (and only it)',
        c.SH.everSpec===true && c.SH.everIq===false && c.SH.everJson===false);
  c.handleBinary(frame(2));
  check('an IQ frame marks everIq',                    c.SH.everIq===true);
  c.handleJSON(JSON.stringify({event_type:'property_changed',property:'signal_snr',value:'12'}));
  check('a property message marks everJson',           c.SH.everJson===true);
  c.handleBinary(frame(6)); c.handleBinary(frame(5));   /* secondary-device types must count too */
  c.shReset();
  check('shReset clears them — they are per-connection',
        c.SH.everIq===false && c.SH.everSpec===false && c.SH.everJson===false);
  c.handleBinary(frame(6));
  check('the secondary-device spectrum type also counts', c.SH.everSpec===true);
}
console.log('');
