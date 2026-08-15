#!/usr/bin/env node
/* scanrec_test.js -- 0.11.2 scan clips: the mark, the verdict rule, the dedup, and the write.
 *
 *   node test/scanrec_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted capture out of the build in a vm. No fixture files, no jsdom,
 * deterministic. Async only where the write is async, and awaited rather than slept on.
 *
 * WHAT IT DEFENDS, and why each one is here rather than trusted:
 *
 *  - THE MARK IS THE WHOLE CORRECTNESS ARGUMENT. The audio in flight when scanTune() fires was
 *    produced at the PREVIOUS frequency. A clip taken as "whatever the ring holds" would open on
 *    the station before it, under a filename naming this one -- the same fabrication the pre-roll
 *    exists to prevent, arriving through a different door. srMark bounds it. Every bound check
 *    here reads sample VALUES, not lengths: a clip of the right length taken from the wrong place
 *    passes any length assertion and is exactly the defect.
 *  - min(preLen, preTotal-srMark), NOT EITHER HALF. preTotal alone reaches back past a mid-dwell
 *    discard into audio that was deliberately thrown away. preLen alone reaches back through the
 *    retune settle into the previous channel. Both halves are driven.
 *  - preTotal IS NEVER RESET. A drop or a take that reset it would make the next clip's bound
 *    negative or wrong, and Math.max(0, ...) would hide it as a zero-length clip -- a feature that
 *    silently stops saving.
 *  - THE VERDICT RULE IS ONE RULE. reheard keeps only if the PI is unseen this scan, which covers
 *    both "logged last night, first lap tonight" and "second lap of a loop" without a second test.
 *    All seven verdicts are driven, including the ones that must produce nothing.
 *  - CLAIMED BEFORE THE WRITE. srSeen[key] is set before an async write, or a slow filesystem lets
 *    the next lap queue a duplicate.
 *  - NO GESTURE, SO NO PROMPT AND NO ANCHOR. requestPermission needs a gesture a scan does not
 *    have, and an <a download> without one dies on the second catch. Both absences are asserted
 *    on the source, because an absence cannot be driven.
 *  - A LAPSE STOPS CLIPS, NOT THE SCAN. Sticky, logged once, and it never throws into the scan
 *    loop.
 *  - THE EXCLUSION IS NOT RELAXED. Record by hand during a scan is still refused.
 */

process.env.TZ = "Australia/Adelaide";   /* the stamp must be UTC; a UTC build machine would pass a local-time implementation by coincidence */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

/* ---------- extract ------------------------------------------------------------------- */

function grab(name) {
  const sig = "function " + name + "(";
  let at = src.indexOf(sig);
  if (at < 0) throw new Error("scanrec_test: cannot find " + name + " in " + BUILD);
  /* keep an "async" prefix: extracting the body without it produces a function whose await is a
     syntax error, which reads as a broken suite rather than as the async function it is */
  if (src.slice(at - 6, at) === "async ") at -= 6;
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
/* Sentinel stubs rather than a throw at load: a missing function must fail a CHECK, not kill the
   harness. run-all.js can only read "N passed, M failed", so a suite that throws reads as a broken
   runner rather than as a defect found. */
function grabOpt(name) { try { return grab(name); } catch (e) { return "function " + name + "(){ throw new Error('missing: " + name + "'); }"; } }
function grabLineOpt(re, fallback) { const m = src.match(re); return m ? m[0] : fallback; }

const DECL = [
  "var AUDIO_SR=48000;",
  grabLineOpt(/var PREROLL_SEC=[^\n]*/, "var PREROLL_SEC=30, PRE_SAMPLES=30*48000, PRE_HZ_TOL=1000;"),
  grabLineOpt(/var preOn=false[^\n]*/, "var preOn=false, preBuf=null, preW=0, preLen=0, preHz=NaN;"),
  grabLineOpt(/var preTotal=[^\n]*/, "var preTotal=0;"),
  grabLineOpt(/var PRE_MIN_SAVE=[^\n]*/, "var PRE_MIN_SAVE=24000;"),
  grabLineOpt(/var recOn=false[^\n]*/, "var recOn=false, recChunks=[], recSamples=0, recStartWall=0, recStartHz=NaN, recSilent=false, recPending=null;"),
  grabLineOpt(/var recDirHandle=null[^\n]*/, "var recDirHandle=null, recDirName='', recDirStored=false, recDirNeedsAllow=false;"),
  grabLineOpt(/var recLast=null[^\n]*/, "var recLast=null;"),
  grabLineOpt(/var SR_MIN_SEC=[^\n]*/, "var SR_MIN_SEC=1.0;"),
  grabLineOpt(/var srOn=false, srArmed=[^\n]*/, "var srOn=false, srArmed=false, srSilent=false, srLapsed=false, srGrant=false;"),
  grabLineOpt(/var srMark=0[^\n]*/, "var srMark=0, srSeen=null, srCount=0, srBytes=0, srShort=0, srHeldMs=0;"),
  grabLineOpt(/var srTail=[^\n]*/, "var srTail=10;"),
  "var scanStop=false;",
].join("\n");

const CODE = [
  DECL,
  grabOpt("recBytesTxt"), grabOpt("recDurTxt"), grabOpt("recLaneOn"), grabOpt("recStartHzNow"),
  grabOpt("preDrop"), grabOpt("preLive"), grabOpt("preAlloc"), grabOpt("preRelease"),
  grabOpt("preSetOn"), grabOpt("preGuard"), grabOpt("preWrite"), grabOpt("preFeedMono"),
  grabOpt("preTake"), grabOpt("preSync"), grabOpt("preHeldSec"),
  grabOpt("recWavHeader"), grabOpt("recStamp"), grabOpt("recIdSuffix"), grabOpt("recFileName"),
  grabOpt("recSync"), grabOpt("recTick"),
  grabOpt("srReady"), grabOpt("srSetOn"), grabOpt("recDestSync"), grabOpt("recDirRemember"), grabOpt("srMaxClipBytes"), grabOpt("srSync"),
  grabOpt("srTailMaxSec"), grabOpt("srSetTail"),
  grabOpt("srArm"), grabOpt("srArmNow"), grabOpt("srDisarm"), grabOpt("srMarkDwell"),
  grabOpt("srKey"), grabOpt("srWants"), grabOpt("srHold"), grabOpt("srLapse"),
  grabOpt("srWrite"), grabOpt("srCapture"),
].join("\n\n");

/* ---------- a context that records what the capture did -------------------------------- */

const written = [];      /* every file the capture actually wrote */
const logs = [];
const el = () => ({ disabled: false, checked: false, title: "", textContent: "", style: {}, parentNode: null, appendChild() {} });

let writeFails = false;
let attempts = 0;      /* every time the capture reaches for the folder at all */
function dirHandle(name) {
  return {
    name,
    queryPermission: () => { attempts++; return Promise.resolve(writeFails ? "prompt" : "granted"); },
    /* deliberately present, so a build that CALLS it is caught rather than silently working */
    requestPermission: () => { ctx.__requestedPermission = true; return Promise.resolve("granted"); },
    getFileHandle: (fn) => Promise.resolve({
      createWritable: () => Promise.resolve({
        write: (b) => { written.push({ name: fn, blob: b }); return Promise.resolve(); },
        close: () => Promise.resolve(),
      }),
    }),
  };
}

const ctx = {
  Math, Number, String, Date, isFinite, console, setTimeout, Promise, Error, JSON,
  Int16Array, ArrayBuffer, DataView, Uint8Array,
  AUDIO_SR: 48000,
  SCAN: { dwellMaxMs: 6000, settleMs: 350, mpxSettleMs: 300 },
  performance: { now: () => Date.now() },
  fmtMHz: (hz) => (hz / 1e6).toFixed(1),
  /* the scan's own sleep, but instant: the hold's DURATION is not what is under test here, its
     placement and its interruptibility are, and a suite that really waited 10 s per catch would
     not be run per candidate. */
  scanSleep: (ms) => { ctx.__slept += ms; return Promise.resolve(); },
  __slept: 0,
  sourceMode: "sdr", scanRun: false, audioOn: true, fileAudioOn: false,
  latest: null, curVfo: 90.7e6, metaVfo: NaN, scanStampHz: NaN,
  aGain: { gain: { value: 0.7 } },
  els: { btnRec: el(), btnRecStop: el(), recStat: el(), recCap: el(), recSave: el(),
         recDest: Object.assign(el(), { childNodes: [{ nodeValue: "" }] }), recFolder: el(),
         preChk: { checked: false }, preStat: el(), preSave: el(),
         srChk: el(), srLine: el(), srStat: el(),
         audVol: { value: "0.7" } },
  log: (k, m) => logs.push(k + ": " + m),
  localStorage: { store: {}, getItem(k) { return this.store[k] === undefined ? null : this.store[k]; },
                  setItem(k, v) { this.store[k] = String(v); } },
  mpxActive: () => ctx.sourceMode === "mpx",
  audioStart: () => { ctx.audioOn = true; ctx.__audioStarted = (ctx.__audioStarted || 0) + 1; },
  audioStop: () => { ctx.audioOn = false; ctx.__audioStopped = (ctx.__audioStopped || 0) + 1; },
  tapAudioSet: (on) => { ctx.fileAudioOn = !!on; },
  Blob: function (parts) {
    this.size = parts.reduce((n, p) => n + (p.byteLength != null ? p.byteLength : p.length), 0);
    this.parts = parts;
  },
  __requestedPermission: false, __audioStarted: 0, __audioStopped: 0,
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);

/* ---------- harness ------------------------------------------------------------------- */
let pass = 0; const fails = [];
function ok(label, cond) { if (cond) pass++; else fails.push(label); }
function eq(label, a, b) { ok(label + "  (got " + a + ", want " + b + ")", a === b); }
const tick = () => new Promise((r) => setTimeout(r, 0));

const CAP = ctx.PRE_SAMPLES;

/* Samples are hashed on ABSOLUTE index. A periodic fixture whose period divides the ring makes a
   stale lap bit-identical to the correct sample -- that mistake let a broken wrap pass seventeen
   checks in the 0.11.1 suite, and the same trap applies to any bound check here. */
let seq = 0;
function valueAt(absIndex) { return (Math.imul(absIndex + 1, 2654435761) >>> 17) % 30000 - 15000; }
function feed(n) {
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = valueAt(seq + i);
  seq += n;
  ctx.preFeedMono(a);
  return a;
}

function reset(over) {
  ctx.recOn = false; ctx.recChunks = []; ctx.recSamples = 0; ctx.recPending = null;
  ctx.recSilent = false; ctx.recStartHz = NaN; ctx.recStartWall = 0; ctx.recLast = null;
  ctx.sourceMode = "sdr"; ctx.scanRun = false; ctx.audioOn = true; ctx.fileAudioOn = false;
  ctx.latest = null; ctx.curVfo = 90.7e6; ctx.metaVfo = NaN; ctx.scanStampHz = NaN;
  ctx.recDirHandle = null; ctx.recDirName = "";
  ctx.srOn = false; ctx.srArmed = false; ctx.srSilent = false; ctx.srLapsed = false;
  ctx.srMark = 0; ctx.srCount = 0; ctx.srBytes = 0; ctx.srShort = 0; ctx.srHeldMs = 0;
  ctx.srGrant = false; ctx.scanStop = false; ctx.__slept = 0; ctx.recDirNeedsAllow = false;
  /* srSeen is deliberately NOT cleared here. Clearing it in the harness would mask srArm() failing
     to clear it, and "a new scan starts the dedup empty" is the check that keeps last night's
     catches from being silently skipped tonight. It is seeded with a stale key instead. */
  ctx.srSeen = { "5001": 1, "9999": 1 };
  ctx.preSetOn(false, true); ctx.preTotal = 0;
  ctx.__requestedPermission = false; ctx.__audioStarted = 0; ctx.__audioStopped = 0;
  writeFails = false; written.length = 0; logs.length = 0; seq = 0; attempts = 0;
  /* threw is deliberately NOT reset: it is a whole-run tally. Clearing it per test would let a
     build that throws on one path be exonerated by the next reset before anything read it. */
  Object.assign(ctx, over || {});
}

/* Arms the capture the way scanStart does, with a folder in hand. */
function armed(over) {
  reset(over);
  ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX";
  ctx.srOn = true;
  ctx.srArm();
  return ctx.srArmed;
}
/* One dwell: settle audio, then the mark, then the dwell's own audio, then the verdict.
   scanStampHz and curVfo are set to DIFFERENT frequencies on purpose: a clip named from the tuned
   dial rather than from the channel the scan froze would be indistinguishable if they agreed, and
   they do not agree in life either -- the dial is written by the retune, the stamp by the scanner. */
let threw = 0;
function dwell(settleN, dwellN, rds, verdict, hz) {
  if (hz !== undefined) { ctx.scanStampHz = hz; ctx.curVfo = hz + 1e6; }
  if (settleN) feed(settleN);
  ctx.srMarkDwell();
  const a = dwellN ? feed(dwellN) : null;
  ctx.latest = rds ? { rds } : null;
  /* A capture that throws must FAIL A CHECK, not kill the suite: it runs inside the scan loop, so a
     throw there would take the scan down with it, which is the defect and not the report of it. */
  try { ctx.srCapture(verdict); } catch (e) { threw++; }
  return a;
}
function nameOf(w) { return (w && w.name) || ""; }
/* Defensive on purpose: a mutant that writes nothing must FAIL a check, not throw and read as a
   broken harness. run-all.js parses "N passed, M failed" and nothing else. */
function clipSamples(w) {
  /* the WAV the capture wrote: [44-byte header, Int16Array] */
  return (w && w.blob && w.blob.parts && w.blob.parts[1]) || new Int16Array(0);
}

/* comment-stripped source, for the rules that are absences */
const bare = src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
function fnBody(name) {
  const m = bare.match(new RegExp("function\\s+" + name + "\\s*\\("));
  if (!m) return "";
  let d = 0, j = bare.indexOf("{", m.index);
  for (; j < bare.length; j++) {
    if (bare[j] === "{") d++;
    else if (bare[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return bare.slice(m.index, j);
}

(async function () {

/* =====================================================================================
   GROUP 1 -- preTotal. The counter the whole bound rests on.
   ===================================================================================== */
reset({}); ctx.preSetOn(true, true);
feed(4800);
eq("1.1  preTotal counts what was written", ctx.preTotal, 4800);
feed(4800);
eq("1.2  ...and keeps counting", ctx.preTotal, 9600);
ctx.preDrop();
eq("1.3  a discard does NOT reset it", ctx.preTotal, 9600);
eq("1.4  ...though it does empty the ring", ctx.preLen, 0);
feed(1200);
eq("1.5  ...and it carries on from where it was", ctx.preTotal, 10800);
ctx.preTake();
eq("1.6  a take does not reset it either", ctx.preTotal, 10800);
reset({}); ctx.preSetOn(true, true);
feed(CAP + 12000);
/* preTotal counts what ENTERED THE RING, not what was offered: preWrite keeps only the tail of an
   over-cap write, and a counter that counted the discarded head would drift from preLen and make
   min(preLen, preTotal-srMark) reach back past a discard. The two must agree. */
eq("1.7  a write larger than the ring counts only the tail it kept", ctx.preTotal, CAP);
eq("1.8  ...which is exactly what the ring holds", ctx.preLen, CAP);
ok("1.9  preTotal is never assigned zero outside its declaration",
   !/preTotal\s*=\s*0/.test(bare.replace(/var preTotal=0;/, "")));

/* =====================================================================================
   GROUP 2 -- the mark. THE settle audio must not reach the clip.
   ===================================================================================== */
armed({});
let a = dwell(16800, 48000, { pi: 0x1234 }, "logged", 90.7e6);   /* 350 ms settle, 1 s dwell */
await tick();
eq("2.1  one clip was written", written.length, 1);
let c = clipSamples(written[0]);
eq("2.2  the clip is the dwell, not the ring", c.length, 48000);
ok("2.3  ...and it OPENS on the first dwell sample, not on the settle", c[0] === a[0]);
ok("2.4  ...and ends on the last one", c[c.length - 1] === a[a.length - 1]);
/* Element-wise, not by searching for a marker value: the fixture hash has a 30000-value range, so
   any single sample recurs by chance inside a 48000-sample clip and an indexOf check would fail on
   a CORRECT build. Compare the whole clip against the whole dwell. */
ok("2.5  ...and matches the dwell sample for sample, so no settle audio is anywhere in it",
   c.length === a.length && Array.prototype.every.call(c, (v, i) => v === a[i]));

/* The bound is a MINIMUM of two quantities and needs both halves. */
armed({});
ctx.scanStampHz = 90.7e6; ctx.curVfo = 90.7e6;
feed(20000);
ctx.srMarkDwell();
const keep = feed(30000);
ctx.preDrop();                       /* something mid-dwell threw the audio away */
const after = feed(60000);
ctx.latest = { rds: { pi: 0x2222 } };
ctx.srCapture("logged");
await tick();
c = clipSamples(written[written.length - 1]);
eq("2.6  after a mid-dwell discard the clip is only what survived", c.length, 60000);
ok("2.7  ...which is the audio AFTER the discard", c[0] === after[0]);
ok("2.8  ...sample for sample, so none of what was thrown away is in it",
   c.length === after.length && Array.prototype.every.call(c, (v, i) => v === after[i]));
ok("2.9  the bound is a min of the ring and the mark, not either alone",
   /Math\.min\(\s*preLen\s*,\s*Math\.max\(\s*0\s*,\s*preTotal\s*-\s*srMark\s*\)\s*\)/.test(bare));

/* =====================================================================================
   GROUP 3 -- where the mark is taken. After the settle, before the dwell.
   ===================================================================================== */
const loop = bare.slice(bare.indexOf("scanTune(ch);"), bare.indexOf("scanTune(ch);") + 900);
ok("3.1  the mark is taken in the scan loop", /srMarkDwell\(\)/.test(loop));
ok("3.2  ...AFTER the retune settle", loop.indexOf("scanSleep(") < loop.indexOf("srMarkDwell()"));
ok("3.3  ...and BEFORE the dwell begins", loop.indexOf("srMarkDwell()") < loop.indexOf("scanDwell(quick"));
ok("3.4  the capture runs on the verdict", /srCapture\(res\)/.test(loop));
ok("3.5  ...after the dwell returns", loop.indexOf("scanDwell(quick") < loop.indexOf("srCapture(res)"));
ok("3.6  the capture is armed by scanStart", /srArm\(\)/.test(fnBody("scanStart")));
ok("3.7  ...and disarmed when the scan ends", /srDisarm\(\)/.test(fnBody("scanStart")));
ok("3.8  there is no lead-in constant to get wrong", !/SR_LEADIN|srLeadIn|LEAD_IN/.test(bare));

/* =====================================================================================
   GROUP 4 -- the verdict rule. All seven, driven.
   ===================================================================================== */
["empty", "carrier", "rdstimeout", "starved", "stopped"].forEach(function (v, i) {
  armed({});
  dwell(4800, 96000, { pi: 0x3000 + i }, v, 90.7e6);
  eq("4." + (i + 1) + "  \"" + v + "\" writes nothing", written.length, 0);
});
armed({});
dwell(4800, 96000, { pi: 0x4001 }, "logged", 90.7e6);
await tick();
eq("4.6  \"logged\" writes a clip", written.length, 1);
armed({});
dwell(4800, 96000, { pi: 0x4002 }, "reheard", 90.7e6);
await tick();
eq("4.7  \"reheard\" with an unseen PI writes one too", written.length, 1);
ok("4.8  a starved dwell is not treated as an empty one anywhere in the capture",
   !/starved/.test(fnBody("srCapture")) || !/empty/.test(fnBody("srCapture")));

/* =====================================================================================
   GROUP 5 -- the dedup. One rule covering both the loop lap and last night's catch.
   ===================================================================================== */
armed({});
dwell(4800, 96000, { pi: 0x5001, ps: "ONE" }, "logged", 90.1e6);
await tick();
dwell(4800, 96000, { pi: 0x5002, ps: "TWO" }, "logged", 90.3e6);
await tick();
eq("5.1  two different stations, two clips", written.length, 2);
dwell(4800, 96000, { pi: 0x5001, ps: "ONE" }, "reheard", 90.1e6);
await tick();
eq("5.2  the same PI again in the same scan writes nothing", written.length, 2);
dwell(4800, 96000, { pi: 0x5001, ps: "ONE" }, "logged", 90.1e6);
await tick();
eq("5.3  ...not even on a \"logged\" verdict", written.length, 2);
eq("5.4  the counter agrees with what was written", ctx.srCount, 2);
armed({});
dwell(4800, 96000, { pi: 0x5001 }, "reheard", 90.1e6);
await tick();
eq("5.5  a NEW scan starts the dedup empty, so last night's catch gets its clip", written.length, 1);
armed({});
dwell(4800, 96000, null, "logged", 90.1e6);
eq("5.6  no RDS at all -> no key -> no clip", written.length, 0);
dwell(4800, 96000, { pi: null, ps: "NAMEONLY" }, "logged", 90.1e6);
eq("5.7  a PS with no PI is still no key", written.length, 0);
/* Asserted here as well as at 10.14: a build that reaches the key derivation with a null PI throws
   rather than writing, so "nothing was written" is satisfied by the crash and proves nothing on
   its own. The scan loop would go down with it. */
eq("5.7b ...and it declines rather than throwing on the null", threw, 0);
ok("5.8  the key is claimed BEFORE the write, or a slow disk lets the next lap duplicate it",
   fnBody("srCapture").indexOf("srSeen[key]=1") < fnBody("srCapture").indexOf("srWrite("));

/* =====================================================================================
   GROUP 6 -- the runt. A dwell won on almost no audio is not a clip.
   ===================================================================================== */
armed({});
dwell(4800, Math.round(ctx.SR_MIN_SEC * 48000) - 1, { pi: 0x6001 }, "logged", 90.1e6);
eq("6.1  a clip under the minimum is not written", written.length, 0);
eq("6.2  ...and is counted so the panel can say so", ctx.srShort, 1);
ok("6.3  ...and the PI is NOT claimed, so a later, longer dwell can still have it",
   !ctx.srSeen["6001"]);
dwell(4800, 96000, { pi: 0x6001 }, "logged", 90.1e6);
await tick();
eq("6.4  ...and it does", written.length, 1);
armed({});
dwell(4800, Math.round(ctx.SR_MIN_SEC * 48000), { pi: 0x6002 }, "logged", 90.1e6);
await tick();
eq("6.5  exactly the minimum IS written", written.length, 1);

/* =====================================================================================
   GROUP 7 -- the name.
   ===================================================================================== */
armed({});
const t0 = Date.now();
/* Ten seconds, not two: recStamp floors to the whole second, so a two-second clip left the
   correct and the mutated stamp barely 1 s apart and the check passed or failed on where the
   wall clock happened to land. A tolerance that overlaps the defect is not a check. */
dwell(4800, 480000, { pi: 0xC202, ps: "BBC R4" }, "logged", 93.5e6);
await tick();
const nm = nameOf(written[0]);
ok("7.1  a scan clip is named as one", /^rdsbridge_scan_/.test(nm));
ok("7.2  ...carries the channel the scan was dwelling on", /_93\.500MHz/.test(nm));
ok("7.3  ...the PI that identified it", /_C202/.test(nm));
ok("7.4  ...the PS, sanitised", /_BBC-R4/.test(nm));
ok("7.5  ...and is a .wav", /\.wav$/.test(nm));
/* The stamp names the FIRST sample, not the verdict: 2 s of audio means 2 s ago. */
const stampM = nm.match(/_(\d{8}T\d{6}Z)_/);
const stamped = stampM ? Date.parse(stampM[1]
  .replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")) : NaN;
ok("7.6  the stamp names the first sample, not the verdict",
   isFinite(stamped) && Math.abs((t0 - 10000) - stamped) < 2000);
ok("7.7  the stamp is UTC (this suite runs in Australia/Adelaide)", /Z_|Z\./.test(nm) && !/[+-]\d{4}/.test(nm));
ok("7.8  the PI/PS half is shared with the manual recording's name, not written twice",
   /recIdSuffix\(\)/.test(fnBody("recFileName")) && /recIdSuffix\(\)/.test(fnBody("srCapture")));
armed({});
ctx.scanStampHz = NaN; ctx.curVfo = 90.7e6;
dwell(4800, 96000, { pi: 0x7001 }, "logged");
await tick();
ok("7.9  with no scan channel in hand it falls back to the tuned frequency, not to nothing",
   /_90\.700MHz/.test(nameOf(written[0])));

/* =====================================================================================
   GROUP 8 -- arming. A folder is required; audio is made to exist.
   ===================================================================================== */
reset({}); ctx.srOn = true; ctx.srArm();
ok("8.1  no folder -> not armed", ctx.srArmed === false);
ok("8.2  ...and it says why", logs.some((l) => /folder/.test(l)));
reset({}); ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX"; ctx.srOn = false; ctx.srArm();
ok("8.3  toggle off -> not armed even with a folder", ctx.srArmed === false);
ok("8.4  armed with both", armed({}) === true);
ok("8.5  arming allocates the ring even with the user's pre-roll off",
   ctx.preOn === false && ctx.preBuf !== null);
/* Driven with the ring ALREADY FULL: a build that allocates but does not clear would show preLen 0
   here purely because the harness had never filled it, and the first clip of the night would then
   open on whatever was playing before the scan started. */
reset({}); ctx.preSetOn(true, true); feed(240000);
ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX"; ctx.srOn = true;
ok("8.6a something is held before the scan arms", ctx.preLen === 240000);
ctx.srArm();
eq("8.6  ...and arming starts empty, so nothing from before the scan can reach a clip", ctx.preLen, 0);
/* audio off on the SDRconnect lane means the radio sends no audio frames at all */
reset({}); ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX"; ctx.srOn = true;
ctx.audioOn = false; ctx.srArm();
ok("8.7  with monitoring off the stream is enabled anyway", ctx.audioOn === true);
ok("8.8  ...silently", ctx.srSilent === true && ctx.aGain.gain.value === 0);
ctx.srDisarm();
ok("8.9  ...and put back at the end of the scan", ctx.audioOn === false && ctx.aGain.gain.value === 0.7);
ok("8.10 disarming releases the ring when nothing else wants it", ctx.preBuf === null);
reset({}); ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX"; ctx.srOn = true;
ctx.preSetOn(true, true); ctx.srArm(); ctx.srDisarm();
ok("8.11 ...but keeps it when the user's own pre-roll is on", ctx.preBuf !== null);
reset({}); ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX"; ctx.srOn = true;
ctx.audioOn = true; ctx.srArm(); ctx.srDisarm();
ok("8.12 audio that was already on is left alone", ctx.audioOn === true && ctx.__audioStopped === 0);

/* =====================================================================================
   GROUP 9 -- the lapse. Clips stop; the scan does not.
   ===================================================================================== */
armed({});
writeFails = true;
dwell(4800, 96000, { pi: 0x9001 }, "logged", 90.1e6);
await tick(); await tick();
ok("9.1  a refused write lapses the capture", ctx.srLapsed === true);
eq("9.2  ...and nothing was written", written.length, 0);
ok("9.3  ...and it is reported", logs.some((l) => /^err: scan clips stopped/.test(l)));
const nLogs = logs.length, nAtt = attempts;
dwell(4800, 96000, { pi: 0x9002 }, "logged", 90.2e6);
await tick(); await tick();
eq("9.4  a lapse is sticky -- the folder is not reached for again", attempts, nAtt);
eq("9.4b ...and nothing further is written", written.length, 0);
eq("9.5  ...and it does not say so again every channel", logs.length, nLogs);
/* srLapse's own guard, driven directly: srCapture's early return makes it unreachable in normal
   operation, so nothing else here would notice it being removed. */
ctx.srLapsed = false; logs.length = 0;
ctx.srLapse("first"); ctx.srLapse("second");
eq("9.5b the lapse notice is written once, not once per failure",
   logs.filter((l) => /scan clips stopped/.test(l)).length, 1);
ok("9.6  the capture never asks for permission -- a scan has no gesture behind it",
   ctx.__requestedPermission === false && !/requestPermission/.test(fnBody("srWrite")));
ok("9.7  ...and never falls back to a download, which dies on the second catch",
   !/recDownload|recSaveBlob/.test(fnBody("srWrite")) && !/recDownload|recSaveBlob/.test(fnBody("srCapture")));
ok("9.8  a capture that is not armed does nothing at all", (function () {
  reset({}); const before = written.length; ctx.srCapture("logged"); return written.length === before;
})());

/* =====================================================================================
   GROUP 10 -- the panel, and the exclusion 0.11.0 set.
   ===================================================================================== */
reset({});
ok("10.1 the toggle is disabled without a folder", (ctx.srSync(), ctx.els.srChk.disabled === true));
ok("10.2 ...and says why", /folder/.test(ctx.els.srLine.title));
ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX"; ctx.srSync();
ok("10.3 a chosen folder enables it", ctx.els.srChk.disabled === false);
ctx.scanRun = true; ctx.srSync();
ok("10.4 ...and a running scan freezes it", ctx.els.srChk.disabled === true);
ctx.scanRun = false;
ctx.srSetOn(true, true);
ok("10.5 the preference persists", ctx.localStorage.getItem("rdsb.scanrec") === "1");
ok("10.6 ...under its own key, not the pre-roll's", /rdsb\.scanrec/.test(bare) && /rdsb\.preroll/.test(bare));
ctx.srSync();
ok("10.7 the idle line states the disk cost", /each/.test(ctx.els.srStat.textContent) && /hundred/.test(ctx.els.srStat.textContent));
eq("10.8 ...derived from the dwell cap AND the hold, not from a second copy of either",
   ctx.srMaxClipBytes(), Math.round((ctx.SCAN.dwellMaxMs / 1000 + ctx.srTail) * 48000) * 2 + 44);
ok("10.9 choosing a folder refreshes this line", /srSync\(\)/.test(fnBody("recDestSync")));
ok("10.10 the scan never writes the user's pre-roll preference",
   !/rdsb\.preroll/.test(fnBody("srArm")) && !/rdsb\.preroll/.test(fnBody("srDisarm")) && !/preSetOn/.test(fnBody("srArm")));
/* 0.11.0's exclusion, unrelaxed */
ok("10.11 recording by hand during a scan is still refused", /if\(scanRun\)\{ log\("err"/.test(fnBody("recStart")));
ok("10.12 ...and the Record button is still disabled by a scan", /disabled = recOn \|\| scanRun/.test(fnBody("recSync")));
ok("10.13 Save Last 30s still answers to the user's toggle, not to the scan's",
   /if\(!preOn\)/.test(fnBody("preSaveLast")));

eq("10.14 the capture never throws into the scan loop", threw, 0);

/* =====================================================================================
   GROUP 11 -- cand.2: the hold. The verdict arrives SOONER the stronger the station, so a
   clip that ended at the verdict gave its worst audio to its best catches.
   ===================================================================================== */
reset({});
ctx.srSetTail(10, true);
eq("11.1  the hold is held in seconds", ctx.srTail, 10);
eq("11.2  ...persisted under its own key", ctx.localStorage.getItem("rdsb.scantail"), "10");
ok("11.3  ...separately from the toggle", /rdsb\.scantail/.test(bare) && /rdsb\.scanrec/.test(bare));
/* The ceiling is the ring, and it is DERIVED. A hold long enough to push the clip past what the
   ring holds would keep the NEWEST 30 s and silently drop the front -- the part with the
   identification in it. */
eq("11.4  the ceiling is the ring less the dwell cap", ctx.srTailMaxSec(), 30 - 6);
ctx.srSetTail(999, true);
eq("11.5  ...and a longer request is clamped to it, not honoured", ctx.srTail, ctx.srTailMaxSec());
ok("11.6  ...so the longest possible clip still fits the ring",
   Math.round((ctx.SCAN.dwellMaxMs / 1000 + ctx.srTail) * 48000) <= CAP);
ctx.srSetTail(-5, true);
eq("11.7  a negative hold is no hold", ctx.srTail, 0);
ctx.srSetTail(10, true);

/* srWants gates the hold, and must not touch state: a hold taken for a clip the capture then
   declines would cost pass time for nothing, and a PI burned by an interrupted hold would never
   get its clip on a later lap. */
armed({});
ctx.latest = { rds: { pi: 0x1101 } };
ok("11.8  a keeping verdict wants the hold", ctx.srWants("logged") === true);
ok("11.9  ...and so does an unseen reheard", ctx.srWants("reheard") === true);
["empty", "carrier", "rdstimeout", "starved", "stopped"].forEach((v, i) =>
  ok("11.10." + (i + 1) + " \"" + v + "\" does not", ctx.srWants(v) === false));
ctx.latest = { rds: { pi: null } };
ok("11.11 no PI, no hold", ctx.srWants("logged") === false);
ctx.latest = { rds: { pi: 0x1101 } };
ctx.srSeen["1101"] = 1;
ok("11.12 a PI already clipped this scan does not earn a hold", ctx.srWants("logged") === false);
ctx.srSeen = {};
const seenBefore = JSON.stringify(ctx.srSeen);
ctx.srWants("logged"); ctx.srWants("logged");
eq("11.13 asking does not claim the key", JSON.stringify(ctx.srSeen), seenBefore);
ctx.srLapsed = true;
ok("11.14 a lapsed capture wants no hold", ctx.srWants("logged") === false);
ctx.srLapsed = false;
ctx.srArmed = false;
ok("11.15 an unarmed scan wants no hold", ctx.srWants("logged") === false);

/* The hold itself: sliced, interruptible, and accounted for. */
armed({});
ctx.__slept = 0;
await ctx.srHold(90.1e6);
ok("11.16 the hold sleeps in slices, not in one long wait", ctx.__slept >= 10000);
ok("11.17 ...and no slice is longer than a second, so Stop is answered promptly",
   /scanSleep\((\d{1,3})\)/.test(fnBody("srHold")) && Number(fnBody("srHold").match(/scanSleep\((\d+)\)/)[1]) <= 1000);
ok("11.18 ...and it is counted, so the panel can say what it cost", ctx.srHeldMs >= 0);
armed({});
ctx.scanStop = true; ctx.__slept = 0;
await ctx.srHold(90.1e6);
eq("11.19 Stop ends the hold at once", ctx.__slept, 0);
ctx.scanStop = false;
armed({}); ctx.srSetTail(0, true); ctx.__slept = 0;
await ctx.srHold(90.1e6);
eq("11.20 no hold configured means no wait at all", ctx.__slept, 0);
ctx.srSetTail(10, true);
/* Placement: after the verdict, before the capture. A hold taken before the verdict would delay
   every channel in the band; one taken after the capture would not lengthen the clip at all. */
ok("11.21 the hold sits between the verdict and the capture",
   loop.indexOf("scanDwell(quick") < loop.indexOf("srHold(ch)") &&
   loop.indexOf("srHold(ch)") < loop.indexOf("srCapture(res)"));
ok("11.22 ...and only for a verdict that will be kept", /if\(srWants\(res\)\) await srHold\(ch\)/.test(bare));

/* The runt guard is now only a zero-length guard: with a hold behind it there is no reason to
   refuse a short clip, and 1.0 s was throwing away exactly the catches the hold rescues. */
ok("11.23 the minimum is a floor, not a judgement about what is worth keeping", ctx.SR_MIN_SEC <= 0.5);

/* =====================================================================================
   GROUP 12 -- cand.2: a restored folder is confirmed on the Scan press.
   ===================================================================================== */
/* Bench 13-Aug armed against a handle restored from IndexedDB whose permission was NOT live.
   The first catch would have read "prompt" and lapsed the capture for the whole scan -- so the
   feature worked when a folder had just been picked and was silently dead on the first catch of
   the next session, which is exactly the overnight run it exists for. */
reset({}); ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX";
ctx.recDirNeedsAllow = true; ctx.srOn = true; ctx.scanRun = true;
ctx.srArm();
ok("12.1  a folder needing confirmation does not arm immediately", ctx.srArmed === false);
ok("12.2  ...it asks, on the Scan press", ctx.srGrant === true && ctx.__requestedPermission === true);
ok("12.3  ...and says so", logs.some((l) => /confirming access/.test(l)));
ok("12.4  ...without touching the audio state until it lands", ctx.srSilent === false);
await tick();
ok("12.5  a granted confirmation arms the capture", ctx.srArmed === true && ctx.srGrant === false);
ok("12.6  ...and clears the outstanding-permission flag", ctx.recDirNeedsAllow === false);
/* refused */
reset({});
const refuse = dirHandle("DX");
refuse.requestPermission = () => Promise.resolve("denied");
ctx.recDirHandle = refuse; ctx.recDirName = "DX"; ctx.recDirNeedsAllow = true;
ctx.srOn = true; ctx.scanRun = true;
ctx.srArm();
await tick();
ok("12.7  a refusal does not arm", ctx.srArmed === false && ctx.srGrant === false);
ok("12.8  ...leaves no half-armed audio state behind", ctx.srSilent === false);
ok("12.9  ...and says the scan is unaffected", logs.some((l) => /^err:.*not granted.*scan itself is unaffected/.test(l)));
/* a scan stopped while the dialog was open must not arm behind it */
reset({});
let release; const slow = dirHandle("DX");
slow.requestPermission = () => new Promise((r) => { release = () => r("granted"); });
ctx.recDirHandle = slow; ctx.recDirName = "DX"; ctx.recDirNeedsAllow = true;
ctx.srOn = true; ctx.scanRun = true;
ctx.srArm();
ctx.scanRun = false;            /* the user pressed Stop while the dialog was open */
/* Defensive: a build that never opens the dialog leaves release undefined, and calling it would
   kill the suite instead of failing this check. */
ok("12.10a the confirmation was asked for at all", typeof release === "function");
if (typeof release === "function") release();
await tick();
ok("12.10 a confirmation that lands after the scan ended does not arm", ctx.srArmed === false);
/* and the ordinary case is untouched */
reset({}); ctx.recDirHandle = dirHandle("DX"); ctx.recDirName = "DX";
ctx.recDirNeedsAllow = false; ctx.srOn = true; ctx.srArm();
ok("12.11 a live permission arms straight away, with no dialog",
   ctx.srArmed === true && ctx.__requestedPermission === false);
ok("12.12 the toggle is still gated on having a folder at all, not on the grant",
   /return !!recDirHandle/.test(fnBody("srReady")));

/* ---------- report -------------------------------------------------------------------- */
fails.forEach((f) => console.log("FAIL  " + f));
console.log("\n" + pass + " passed, " + fails.length + " failed");
process.exit(fails.length ? 1 : 0);

})();
