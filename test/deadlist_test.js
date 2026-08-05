/* 0.10.5 — the accrual rule. Extracts the real decision expression from the build and drives it
   through every verdict/condition combination the 02-03 Aug logs produced.
   Written as an acceptance test for the fixes, not a restatement of them: each case names the log
   line that motivated it, and the mutants at the bottom prove the suite discriminates. */
const fs=require('fs');
const src=fs.readFileSync(process.argv[2]||'work.html','utf8');

/* pull the guard out of the build verbatim so the test can never drift from the code */
const m=src.match(/else if\(looping && fullPass && (.*?)\)\{\s*\n\s*var _nv=/s);
if(!m) throw new Error('accrual guard not found — did the shape change?');
const GUARD=m[1];
console.log('guard under test:  '+GUARD+'\n');
const learns=new Function('res','scanThrottled','scanAvg','scanInDxLog','ch','looping','fullPass',
  'return !!('+GUARD+');');

function C(o){ return learns(o.res, o.throttled||false, o.baseline===undefined?{}:o.baseline,
                             ()=>o.inDxLog||false, 1e8, true, true); }
let fails=0;
function check(name,got,want){ const ok=got===want; if(!ok) fails++;
  console.log((ok?'PASS  ':'FAIL  ')+name+(ok?'':'   (got '+got+', want '+want+')')); }

console.log('— what may be learned —');
check('plain "empty" with a baseline is learned',      C({res:'empty'}), true);
/* 03-Aug 12:58, a clean foreground run: 8 of 21 write-offs had a pilot lock */
check('"carrier" is NOT learned (pilot locked)',       C({res:'carrier'}), false);
check('"rdstimeout" is NOT learned (pilot locked)',    C({res:'rdstimeout'}), false);
/* cand.7: the channel was never listened to */
check('"starved" is NOT learned',                      C({res:'starved'}), false);
check('"stopped" is NOT learned',                      C({res:'stopped'}), false);
check('"reheard" is NOT learned',                      C({res:'reheard'}), false);

console.log('\n— conditions that invalidate an otherwise-good verdict —');
/* 02-Aug 21:11 Linux/Edge: spectrum flat zero, every channel dwelled blind */
check('no FFT baseline blocks learning',               C({res:'empty', baseline:null}), false);
/* 03-Aug 08:20: scanThrottled fired only after the damage, but the gate stays */
check('a throttled verdict is not learned',            C({res:'empty', throttled:true}), false);
/* 02-Aug: 88.9 logged clean at 100% pilot, then struck twice and skipped for 13 minutes */
check('a channel already in the DX log is never struck', C({res:'empty', inDxLog:true}), false);
check('all four conditions together still refuse',     C({res:'carrier', baseline:null, throttled:true, inDxLog:true}), false);

console.log('\n— the rest of the release, asserted against the source —');
function has(re,name,want=true){ const got=re.test(src); if(got!==want) fails++;
  console.log(((got===want)?'PASS  ':'FAIL  ')+name); }
has(/strikeTtlMs:\s*\d+/,                              'strikes have a TTL');
has(/now-scanStrikeAt\[k\]\)>SCAN\.strikeTtlMs/,       'the TTL is actually applied, per pass');
has(/scanNoRds=\{\}; scanStrikeAt=\{\};[\s\S]{0,80}\} else if\(pDwell===0/,
                                                       'a pass that measures nothing clears the cache');
has(/var startLen=dxLog\.length, quick=\(watchOn && !fullPass\);/,
                                                       'the quick path no longer shortens a DX-watch verdict');
has(/quick=\(\(watchOn && !fullPass\) \|\| \(looping/,  'the old ratchet is gone', false);
has(/while\(shDead\(\) && !scanStop\)/,                'the scan pauses when the streams are dead');
has(/if\(scanDwellFrames < SCAN\.minFrames\) return "starved";/,
                                                       'an "empty" verdict requires decoded frames');

console.log('\n— mutants: each must be caught —');
function mutant(name, patched){
  const g=patched.match(/else if\(looping && fullPass && (.*?)\)\{\s*\n\s*L/s);
  const f=new Function('res','scanThrottled','scanAvg','scanInDxLog','ch','looping','fullPass','return !!('+g[1]+');');
  return f;
}
const M1=mutant('drop pilot check', 'else if(looping && fullPass && res!=="reheard" && !scanThrottled && scanAvg && !scanInDxLog(ch)){\n  L');
check('mutant that learns "carrier" is caught',        M1('carrier',false,{},()=>false,1e8,true,true), true);
const M2=mutant('drop dxlog check', 'else if(looping && fullPass && res==="empty" && !scanThrottled && scanAvg){\n  L');
check('mutant that ignores the DX log is caught',      M2('empty',false,{},()=>true,1e8,true,true), true);

console.log('\n'+(fails?(fails+' FAILED'):'all green')+'\n');
process.exitCode = fails?1:0;

/* ── the predicate itself, not just the guard that calls it ────────────────────────────────────
   The block above stubs scanInDxLog, so it passes whether or not that function works. It did pass
   against a build where scanInDxLog read dxLog[i].hz — a field that does not exist — and therefore
   returned false for every channel in the log. Measure both halves, or measure neither. */
console.log('\n— scanInDxLog against real dxLog entry shapes —');
{
  const g=src.match(/function scanChKey\(hz\)\{[^\n]*\}/)[0];
  const p=src.match(/function scanInDxLog\(hz\)\{[\s\S]*?\n  return false; \}/)[0];
  const sandbox={dxLog:[]};
  require('vm').createContext(sandbox);
  require('vm').runInContext(g+'\n'+p, sandbox);
  /* exactly the shape logCatch builds: freq is a display string, there is no hz */
  sandbox.dxLog=[{id:1, freq:'88.5', pi:0xC202}, {id:2, freq:'101.8', pi:0xC3A8}, {id:3, freq:'MPX', pi:0x1234}];
  check('a logged channel is recognised (88.5)',        sandbox.scanInDxLog(88.5e6), true);
  check('a logged channel is recognised (101.8)',       sandbox.scanInDxLog(101.8e6), true);
  check('an unlogged channel is not',                   sandbox.scanInDxLog(89.9e6), false);
  check('an MPX entry does not match everything',       sandbox.scanInDxLog(93.1e6), false);
  check('50 kHz bucketing holds (88.52 -> 88.5)',       sandbox.scanInDxLog(88.52e6), true);
  check('an adjacent channel does not match',           sandbox.scanInDxLog(88.6e6), false);
  /* the mutant: the version that shipped in cand.7/8 */
  const bad=p.replace('parseFloat(dxLog[i].freq)','parseFloat(dxLog[i].hz)');
  const s2={dxLog:sandbox.dxLog}; require('vm').createContext(s2); require('vm').runInContext(g+'\n'+bad,s2);
  check('mutant reading .hz is caught',                 s2.scanInDxLog(88.5e6), false);
}
console.log('\n'+(fails?(fails+' FAILED'):'all green')+'\n');
process.exitCode = fails?1:0;


/* ── 0.10.5-cand.15: every verdict the dwell can return must be tallied ────────────────────────
   The pass summary's whole value is the invariant "verdicts add up to checked" — it is how a
   4-hour log is read at a glance. "logged" was returned by scanDwell and counted by nothing, so
   any pass that actually CAUGHT a station reported one verdict fewer than it checked. Two of 142
   passes in the 05-Aug soak, and the missing one was the good outcome.
   This reads the verdicts out of the function rather than restating a list, so a new verdict
   added later cannot quietly go uncounted. */
console.log('\n— every dwell verdict is accounted for in the pass summary —');
{
  const i=src.indexOf('function scanDwell(quick, tuneAt)');
  if(i<0) throw new Error('scanDwell not found');
  const after=src.slice(i+10);
  const nxt=after.search(/\n(?:async )?function /);   /* the next top-level function ends the body */
  if(nxt<0) throw new Error('could not bound scanDwell');
  const body=src.slice(i, i+10+nxt);
  /* plain returns AND ternaries: `return rdsSeen?"rdstimeout":"carrier";` is how carrier arrives */
  const verdicts=[...new Set([...body.matchAll(/return\s+[^;]*?"([a-z]+)"/g)].map(m=>m[1]))].sort();
  console.log('  scanDwell can return: '+verdicts.join(', '));
  const tallyStart=src.indexOf('if(res==="empty") pEmpty++;');
  const tally=src.slice(tallyStart, tallyStart+600);
  /* "stopped" ends the scan mid-dwell, so no summary is ever printed for that pass — the only
     verdict legitimately absent from the tally, and named here so the exemption is explicit. */
  const exempt=['stopped'];
  verdicts.forEach(v=>{
    if(exempt.indexOf(v)>=0){ console.log('SKIP  "'+v+'" — pass is abandoned, no summary printed'); return; }
    check('"'+v+'" is counted in the pass summary', new RegExp('res==="'+v+'"').test(tally), true);
  });
  check('the summary prints the logged count',  /pLogged\+" LOGGED"/.test(src), true);
  check('pLogged is reset each pass',           /pLogged=0;pSil0=MON\.silentMs/.test(src), true);
  /* the mutant: cand.14, where "logged" fell through every branch */
  const bad=tally.replace('else if(res==="logged") pLogged++;','');
  check('a build that drops the logged tally is caught', /res==="logged"/.test(bad), false);
}
console.log('\n'+(fails?(fails+' FAILED'):'all green')+'\n');
process.exitCode = fails?1:0;
