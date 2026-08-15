#!/usr/bin/env node
/* preroll_test.js -- 0.11.1 pre-roll recording: the ring, what empties it, and what the file
 * that comes out of it claims about itself.
 *
 *   node test/preroll_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted pre-roll out of the build in a vm. No fixture files, no jsdom,
 * deterministic. Where a rule cannot be executed (a discard sitting inside an async play loop, a
 * lane switch that tears down half the app) the source is asserted with COMMENTS STRIPPED,
 * because a test that greps source otherwise matches its own explanatory prose.
 *
 * WHAT IT DEFENDS, and why each one is here rather than trusted:
 *
 *  - THE OLDEST SAMPLES ARE THE ONES THAT GO. A ring that holds the right NUMBER of samples and
 *    the wrong ones passes any length assertion, so every ring check here reads identifiable
 *    sample VALUES: the fixtures are ramps, and the suite asserts which part of the ramp came
 *    back. A cap that kept the FIRST 30 seconds instead of the last would satisfy a length test
 *    perfectly and produce a feature that does the opposite of what it is for.
 *  - THE WRAP, NOT JUST THE FILL. A ring is correct on the first lap by accident. Every sequence
 *    here crosses the boundary at least once, and one crosses it with a single write larger than
 *    the whole ring.
 *  - WHAT EMPTIES IT IS THE FEATURE. 30 s of audio from before a retune, prepended to what came
 *    after it, is a fabricated recording that the filename then names plausibly and wrongly.
 *    The retune rule is executable and is executed. The other five discard sites cannot be driven
 *    here, so their host functions are asserted to contain the call -- a census that goes red if
 *    one is removed.
 *  - THE STAMP NAMES THE FIRST SAMPLE. recStartWall moves back by the held duration, so the
 *    filename, the panel's elapsed time and the 30-minute cap all describe the same file. A
 *    build that seeds the audio but not the clock produces a file whose name is 30 seconds wrong
 *    and whose duration readout is 30 seconds short, and nothing else would catch it.
 *  - OFF MEANS OFF. The claim behind "default off" is that the tap returns before doing any work
 *    and that no buffer exists at all -- asserted on the state, not on the outcome.
 *  - A REFUSAL, NOT A 44-BYTE FILE. Save Last 30s with nothing held must say so. A WAV header
 *    with no data opens, plays, and is silence.
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
  const at = src.indexOf(sig);
  if (at < 0) throw new Error("preroll_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
function grabOpt(name) { try { return grab(name); } catch (e) { return "function " + name + "(){ throw new Error('missing: " + name + "'); }"; } }
function grabLineOpt(re, fallback) { const m = src.match(re); return m ? m[0] : fallback; }
function grabLine(re, what) {
  const m = src.match(re);
  if (!m) throw new Error("preroll_test: cannot find " + what + " in " + BUILD);
  return m[0];
}

const DECL = [
  "var AUDIO_SR=48000;",
  grabLine(/var REC_MAX_MIN=[^\n]*/, "REC_MAX_MIN"),
  grabLine(/var recOn=false[^\n]*/, "recorder state"),
  grabLine(/var PREROLL_SEC=[^\n]*/, "pre-roll constants"),
  grabLine(/var preOn=[^\n]*/, "pre-roll state"),   /* NOT keyed on the default: a build that shipped it defaulting to ON must fail check 4.9, not fail to load */
  grabLine(/var PRE_MIN_SAVE=[^\n]*/, "minimum saveable"),
  grabLineOpt(/var preTotal=[^\n]*/, "var preTotal=0;"),                 /* 0.11.2; absent in 0.11.1, so the suite still runs against it */
  grabLineOpt(/var srOn=false, srArmed=[^\n]*/, "var srArmed=false;"),   /* preLive() reads it; false here keeps this suite on the no-scan path */
  grabLine(/var recDirHandle=null[^\n]*/, "chosen-folder state"),
  grabLine(/var recLast=null[^\n]*/, "last-saved state"),
  grabLine(/var REC_PICKER_ID=[^\n]*/, "picker id"),
].join("\n");

const CODE = [
  DECL,
  grabOpt("recBytesTxt"), grabOpt("recDurTxt"), grabOpt("recLaneOn"), grabOpt("recStartHzNow"),
  grabOpt("preHeldSec"), grabOpt("preDrop"), grabOpt("preSetOn"), grabOpt("preGuard"),
  grabOpt("preLive"), grabOpt("preAlloc"), grabOpt("preRelease"), grabOpt("recIdSuffix"),
  grabOpt("preWrite"), grabOpt("preFeedMono"), grabOpt("preFeedStereo"), grabOpt("preTake"),
  grabOpt("preSaveLast"), grabOpt("preSync"),
  grabOpt("recFeedStereo"), grabOpt("recPush"), grabOpt("recWavHeader"),
  grabOpt("recStamp"), grabOpt("recFileName"), grabOpt("recSync"), grabOpt("recTick"),
  grabOpt("recSaved"), grabOpt("recDestSync"),
  grabOpt("recStart"), grabOpt("recStop"), grabOpt("recSaveBlob"), grabOpt("recDownload"),
].join("\n\n");

/* ---------- a context that records what the recorder did ------------------------------ */

const saved = [];
const logs = [];
const el = () => ({ disabled: false, title: "", textContent: "", style: {}, parentNode: null, appendChild() {} });

const ctx = {
  Math, Number, String, Date, isFinite, console, setTimeout, Promise, Error,
  Int16Array, ArrayBuffer, DataView, Uint8Array,
  AUDIO_SR: 48000,
  sourceMode: "sdr", scanRun: false, audioOn: true, fileAudioOn: false,
  latest: null, curVfo: 90.7e6, metaVfo: NaN,
  aGain: { gain: { value: 0.7 } },
  els: { btnRec: el(), btnRecStop: el(), recStat: el(), recCap: el(), recSave: el(),
         recDest: Object.assign(el(), { childNodes: [{ nodeValue: "" }] }), recFolder: el(),
         preChk: { checked: false }, preStat: el(), preSave: el(),
         audVol: { value: "0.7" } },
  log: (k, m) => logs.push(k + ": " + m),
  mpxActive: () => ctx.sourceMode === "mpx",
  audioStart: () => { ctx.audioOn = true; },
  audioStop: () => { ctx.audioOn = false; },
  tapAudioSet: (on) => { ctx.fileAudioOn = !!on; },
  Blob: function (parts) {
    this.size = parts.reduce((n, p) => n + (p.byteLength != null ? p.byteLength : p.length), 0);
    this.parts = parts;
  },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  document: { createElement: () => ({ click() {}, remove() {}, set href(_) {}, set download(_) {} }), body: { appendChild() {} } },
  window: {},   /* no showSaveFilePicker -> the anchor fallback, which is synchronous and testable */
  recDirStored: false, recDirNeedsAllow: false,
};
ctx.window.showSaveFilePicker = undefined;
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
const realDownload = ctx.recDownload;
ctx.recDownload = function (blob, name) { saved.push({ blob, name }); return realDownload.call(null, blob, name); };

/* ---------- harness ------------------------------------------------------------------- */
let pass = 0; const fails = [];
function ok(label, cond) { if (cond) pass++; else fails.push(label); }
function eq(label, a, b) { ok(label + "  (got " + a + ", want " + b + ")", a === b); }

const CAP = ctx.PRE_SAMPLES;

function reset(over) {
  ctx.recOn = false; ctx.recChunks = []; ctx.recSamples = 0; ctx.recPending = null;
  ctx.recSilent = false; ctx.recStartHz = NaN; ctx.recStartWall = 0;
  ctx.sourceMode = "sdr"; ctx.scanRun = false; ctx.audioOn = true; ctx.fileAudioOn = false;
  ctx.latest = null; ctx.curVfo = 90.7e6; ctx.metaVfo = NaN;
  ctx.recDirHandle = null; ctx.recDirName = ""; ctx.recLast = null;
  ctx.srArmed = false; ctx.preTotal = 0;   /* 0.11.2: this suite is the no-scan path throughout */
  ctx.preSetOn(true, true); ctx.preDrop();
  saved.length = 0; logs.length = 0;
  Object.assign(ctx, over || {});
}

/* Fixtures carry their own absolute index, so every assertion can name which samples came back.
   THE FIRST VERSION OF THIS WAS A RAMP OF PERIOD 30000 AND IT COULD NOT DISCRIMINATE: 1 440 000
   is 48 x 30000, so a ring slot held the same VALUE on every lap and stale data from a previous
   lap was bit-identical to the correct sample. A mutant that dropped the wrapped half of a write
   passed all seventeen ring checks. The value is now a hash of the absolute index, whose period
   is far longer than any test here, so a sample from the wrong lap cannot look right. */
let seq = 0;
function valueAt(absIndex) { return (Math.imul(absIndex + 1, 2654435761) >>> 17) % 30000 - 15000; }
function ramp(n) {
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = valueAt(seq + i);
  seq += n;
  return a;
}

function stereoBufEarly(pairs) {
  const b = new ArrayBuffer(2 + pairs.length * 4), dv = new DataView(b);
  dv.setUint8(0, 1); dv.setUint8(1, 0);
  pairs.forEach(([l, r], i) => { dv.setInt16(2 + i * 4, l, true); dv.setInt16(4 + i * 4, r, true); });
  return b;
}

/* comment-stripped source, for the rules that cannot be executed */
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

/* =====================================================================================
   GROUP 1 -- the window. 30 seconds at 48 kHz, held whatever the session length.
   ===================================================================================== */
eq("1.1  the window is 30 seconds", ctx.PREROLL_SEC, 30);
eq("1.2  ...which is 1 440 000 samples at 48 kHz", CAP, 30 * 48000);
eq("1.3  ...and 2.88 MB of s16, the figure the design rests on", CAP * 2, 2880000);
ok("1.4  the retune tolerance matches the one maybeRetune already uses", ctx.PRE_HZ_TOL === 1000);
ok("1.5  ...and that figure is not written twice", (bare.match(/PRE_HZ_TOL/g) || []).length >= 2);

/* =====================================================================================
   GROUP 2 -- the ring holds the LAST N samples. Read by value, not by length: a ring that
   kept the FIRST 30 seconds would pass every length assertion and invert the feature.
   ===================================================================================== */
reset({});
seq = 0;
for (let i = 0; i < 10; i++) ctx.preFeedMono(ramp(4800));     /* 1 s in 100 ms frames */
eq("2.1  under the cap, everything is held", ctx.preLen, 48000);
let take = ctx.preTake();
eq("2.2  ...and comes back at full length", take.length, 48000);
eq("2.3  oldest sample first", take[0], valueAt(0));
eq("2.4  newest sample last", take[take.length - 1], valueAt(47999));
ok("2.5  every sample in order", Array.from(take).every((v, i) => v === valueAt(i)));

reset({}); seq = 0;
const FRAME = 4800, FRAMES = Math.ceil(CAP / FRAME) + 37;      /* well past the wrap */
for (let i = 0; i < FRAMES; i++) ctx.preFeedMono(ramp(FRAME));
const total = FRAMES * FRAME;
eq("2.6  past the cap, the held total stops growing", ctx.preLen, CAP);
take = ctx.preTake();
eq("2.7  ...and a take is exactly one window", take.length, CAP);
eq("2.8  the oldest held sample is the one 30 s back, not the one at the start of the session",
   take[0], valueAt(total - CAP));
eq("2.9  the newest held sample is the last one written", take[CAP - 1], valueAt(total - 1));
ok("2.10 the whole window is contiguous across the wrap",
   Array.from(take).every((v, i) => v === valueAt(total - CAP + i)));
for (let i = 0; i < 20; i++) ctx.preFeedMono(ramp(FRAME));
eq("2.11 feeding more does not grow it", ctx.preLen, CAP);
eq("2.12 ...it advances it", ctx.preTake()[CAP - 1], valueAt(seq - 1));

/* a single write larger than the whole ring: only its tail can be kept */
reset({}); seq = 0;
ctx.preFeedMono(ramp(CAP + 12345));
eq("2.13 one oversized write is clamped to the window", ctx.preLen, CAP);
take = ctx.preTake();
eq("2.14 ...keeping its TAIL, not its head", take[0], valueAt(12345));
eq("2.15 ...to the very last sample", take[CAP - 1], valueAt(CAP + 12344));

/* an odd frame size that never divides the ring evenly, so the wrap lands mid-frame every lap */
reset({}); seq = 0;
const ODD = 4801;
for (let i = 0; i < Math.ceil(CAP / ODD) * 2 + 3; i++) ctx.preFeedMono(ramp(ODD));
take = ctx.preTake();
eq("2.16 an odd frame size still wraps cleanly", take.length, CAP);
ok("2.17 ...with the window still contiguous",
   Array.from(take).every((v, i) => v === valueAt(seq - CAP + i)));

/* =====================================================================================
   GROUP 3 -- what empties it. This is the correctness rule of the feature: audio from
   before a move, prepended to what came after it, is a fabricated recording.
   ===================================================================================== */
reset({}); seq = 0;
ctx.preFeedMono(ramp(48000));
ok("3.1  a full second is held before the retune", ctx.preLen === 48000);
ctx.curVfo = 90.7e6 + 200000;                                  /* a real retune */
ctx.preFeedMono(ramp(4800));
eq("3.2  a retune empties the pre-roll", ctx.preLen, 4800);
eq("3.3  ...leaving only what arrived after it", ctx.preTake()[0], valueAt(48000));

reset({}); seq = 0;
ctx.preFeedMono(ramp(48000));
ctx.curVfo = 90.7e6 + 900;                                     /* inside the tolerance */
ctx.preFeedMono(ramp(4800));
eq("3.4  a sub-kHz wobble does NOT empty it", ctx.preLen, 52800);

reset({}); seq = 0;
ctx.preFeedMono(ramp(48000));
ctx.curVfo = 90.7e6 + 1001;
ctx.preFeedMono(ramp(4800));
eq("3.5  just over the tolerance does", ctx.preLen, 4800);

reset({}); seq = 0;
ctx.preFeedMono(ramp(48000));
ctx.curVfo = NaN;                                              /* a dial that disappears */
ctx.preFeedMono(ramp(4800));
eq("3.6  a frequency that stops being known empties it", ctx.preLen, 4800);
ctx.curVfo = 90.7e6;
ctx.preFeedMono(ramp(4800));
eq("3.7  ...and one that starts being known empties it too", ctx.preLen, 4800);

reset({ sourceMode: "mpx", metaVfo: 98.1e6 }); seq = 0;
ctx.preFeedMono(ramp(48000));
ctx.metaVfo = 98.4e6;                                          /* MPX's dial lives in metaVfo */
ctx.preFeedMono(ramp(4800));
eq("3.8  the MPX lane's helper-reported frequency is the one watched there", ctx.preLen, 4800);

reset({}); seq = 0;
ctx.preFeedMono(ramp(48000));
ctx.preDrop();
eq("3.9  a drop empties it completely", ctx.preLen, 0);
ok("3.10 ...and a take returns nothing rather than a stale window", ctx.preTake() === null);
ctx.preFeedMono(ramp(4800));
eq("3.11 ...and it refills from empty, not from where it was", ctx.preLen, 4800);
eq("3.12 ...starting at the first sample after the drop", ctx.preTake()[0], valueAt(48000));

/* The five discard sites that cannot be driven here: a census, so removing one goes red.
   A census cannot see a NEW site that should have been added -- that is what the tap-side
   frequency guard above is for, and why it was put at the tap rather than at the seven
   places that write curVfo. */
ok("3.13 a source-mode switch discards", /preDrop\(\)/.test(fnBody("setSource")));
ok("3.14 ...before it tears the old lane down", fnBody("setSource").indexOf("preDrop") < fnBody("setSource").indexOf("mpxLeave"));
ok("3.15 switching the SDRconnect audio stream off discards", /preDrop\(\)/.test(fnBody("audioStop")));
ok("3.16 switching the worker tap off discards", /fileAudioOn=false; preDrop\(\)/.test(fnBody("tapAudioSet")));
ok("3.17 a transport seek discards", /preDrop\(\)/.test(fnBody("transportSeek")));
ok("3.18 ...and it happens at the seek, not after the reset", fnBody("transportSeek").indexOf("preDrop") < fnBody("transportSeek").indexOf("_anchorWall"));
ok("3.19 stopping the file discards", /preDrop\(\)/.test(fnBody("stopFile")));
ok("3.20 a hunt-loop lap boundary discards", /playHead=lpNextStart\(\); preDrop\(\)/.test(bare));
/* anchored on loopChk: stopFile contains the same two statements, so the bare pattern alone
   matched there and a mutant that removed the loop-restart discard went uncaught. */
ok("3.21 a file loop restart discards", /loopChk\.checked\)\{ playHead=0; preDrop\(\)/.test(bare));
/* Driven, not grepped: 0.11.2 moved the release behind preRelease()/preLive() and the grep went
   red while the behaviour was unchanged, which is a test measuring the shape of the code rather
   than what it does. */
reset({}); seq = 0;
ctx.preFeedMono(ramp(48000));
ok("3.22a something is held before the toggle goes off", ctx.preLen === 48000 && ctx.preBuf !== null);
ctx.preSetOn(false, true);
eq("3.22 turning the pre-roll off discards what was held", ctx.preLen, 0);
ok("3.22b ...and releases the buffer with it", ctx.preBuf === null);

/* =====================================================================================
   GROUP 4 -- off means off. The whole justification for "default off" is that an idle tap
   costs nothing, so it is asserted on the state rather than on the outcome.
   ===================================================================================== */
reset({}); seq = 0;
ctx.preSetOn(false, true);
ok("4.1  off releases the buffer entirely", ctx.preBuf === null);
ctx.preFeedMono(ramp(48000));
eq("4.2  ...and the mono tap holds nothing", ctx.preLen, 0);
ctx.preFeedStereo(new DataView(new ArrayBuffer(2 + 4 * 100)), 100);
eq("4.3  ...nor the stereo tap", ctx.preLen, 0);
/* Driven, not grepped. An index-ordering assertion is satisfied by the toggle being ABSENT from
   the guard (indexOf returns -1, which is less than everything) -- a mutant that deleted the
   check passed it. So the state is set directly here, buffer allocated and toggle off, which is
   the one arrangement that separates "tests the toggle" from "tests the buffer". */
ctx.preSetOn(true, true); ctx.preDrop();
ctx.preOn = false;                                    /* buffer still allocated */
ctx.preFeedMono(ramp(48000));
eq("4.4  the mono tap tests the toggle, not merely the buffer", ctx.preLen, 0);
ctx.preFeedStereo(new DataView(stereoBufEarly([[100, 100], [200, 200]])), 2);
eq("4.5  ...and so does the stereo tap", ctx.preLen, 0);
/* 0.11.2: the ring has a SECOND customer. The scan's capture must be able to fill it while the
   user's own toggle is off, and must never write the user's persisted preference. Both taps are
   driven with preOn false and srArmed true \u2014 the arrangement that separates "tests preLive()"
   from "tests preOn". A build that kept the taps on preOn alone captures nothing during a scan and
   the whole 0.11.2 feature is silently inert. */
ctx.srArmed = true;
ctx.preFeedMono(ramp(4800));
eq("4.5b the mono tap fills for an armed scan with the toggle off", ctx.preLen, 4800);
ctx.preFeedStereo(new DataView(stereoBufEarly([[100, 100], [200, 200]])), 2);
eq("4.5c ...and so does the stereo tap", ctx.preLen, 4802);
ctx.preSetOn(false, true);
ok("4.5d ...and turning the toggle off mid-scan does not pull the buffer out from under it",
   ctx.preBuf !== null && ctx.preLen === 4802);
ctx.srArmed = false;
ctx.preSetOn(false, true);
ok("4.5e ...but with neither customer live the buffer goes", ctx.preBuf === null && ctx.preLen === 0);
ctx.preSetOn(true, true);
ctx.preOn = true;
ctx.preSetOn(false, true);
ok("4.6  ...and neither allocates anything per frame while it is on",
   !/new Int16Array/.test(fnBody("preFeedStereo")) && !/new Int16Array/.test(fnBody("preFeedMono")) && !/new Int16Array/.test(fnBody("preWrite")));
ctx.preSetOn(true, true);
ok("4.7  on allocates one buffer", ctx.preBuf !== null && ctx.preBuf.length === CAP);
const buf1 = ctx.preBuf;
ctx.preSetOn(true, true);
ok("4.8  ...and turning it on again does not allocate a second", ctx.preBuf === buf1);
ok("4.9  the default is off", /var preOn=false/.test(bare));
ok("4.10 ...and the remembered setting is opt-in, not opt-out", /localStorage\.getItem\("rdsb\.preroll"\)/.test(bare) && /preSetOn\(v==="1"/.test(bare));

/* =====================================================================================
   GROUP 5 -- the stereo tap. The SDRconnect lane downmixes STRAIGHT INTO the ring while it
   is only being held: that is the reason the ring exists at all.
   ===================================================================================== */
function stereoBuf(pairs) {
  const b = new ArrayBuffer(2 + pairs.length * 4), dv = new DataView(b);
  dv.setUint8(0, 1); dv.setUint8(1, 0);
  pairs.forEach(([l, r], i) => { dv.setInt16(2 + i * 4, l, true); dv.setInt16(4 + i * 4, r, true); });
  return b;
}
reset({}); seq = 0;
ctx.recFeedStereo(new DataView(stereoBuf([[1000, 2000], [-1000, -2000], [0, 0], [32767, 32767], [-32768, -32768]])), 5);
const s5 = Array.from(ctx.preTake() || []);   /* a build that holds nothing must fail the checks below, not throw */
eq("5.1  (1000+2000)/2 into the ring", s5[0], 1500);
eq("5.2  (-1000+-2000)/2", s5[1], -1500);
eq("5.3  silence stays silence", s5[2], 0);
eq("5.4  positive full scale does not overflow", s5[3], 32767);
eq("5.5  negative full scale does not overflow", s5[4], -32768);
eq("5.6  nothing is recorded while not recording", ctx.recChunks.length, 0);
eq("5.7  ...and no recording samples are counted", ctx.recSamples, 0);
const monoPairs = [[7, 7], [-7, -7], [12345, 12345], [-12345, -12345]];
reset({});
ctx.recFeedStereo(new DataView(stereoBuf(monoPairs)), monoPairs.length);
const s8 = Array.from(ctx.preTake() || []);
ok("5.8  bit-identical to L when L===R", s8.length === monoPairs.length && s8.every((v, i) => v === monoPairs[i][0]));

/* while RECORDING, the ring is fed from the chunk the recorder already downmixed -- one
   downmix, not two, and the ring must advance by n and not by 2n */
reset({ recOn: true });
ctx.recFeedStereo(new DataView(stereoBuf(new Array(1000).fill([100, 100]))), 1000);
eq("5.9  recording feeds the ring exactly once per frame", ctx.preLen, 1000);
eq("5.10 ...and the recording gets the same frame once", ctx.recSamples, 1000);
ok("5.11 the recording path downmixes once and hands it on", /recPush\(m\)/.test(fnBody("recFeedStereo")));
ok("5.12 ...and the idle path never allocates", /preFeedStereo\(dv,n\)/.test(fnBody("recFeedStereo")));
ok("5.13 the mono lane's tap feeds the ring before the recording gate",
   fnBody("recPush").indexOf("preFeedMono") < fnBody("recPush").indexOf("if(!recOn)"));
ok("5.14 ...and the file / IQ / wsiq / MPX lane still taps before the float conversion",
   fnBody("fileAudioFeed").indexOf("recPush") < fnBody("fileAudioFeed").indexOf("M[i]="));

/* =====================================================================================
   GROUP 6 -- Record starts the file BEFORE the press. The clock moves with the audio: a
   build that seeds one and not the other names the file 30 seconds wrongly.
   ===================================================================================== */
reset({}); seq = 0;
for (let i = 0; i < FRAMES; i++) ctx.preFeedMono(ramp(FRAME));   /* a full window held */
const heldAt = seq;
const t0 = Date.now();
ctx.recStart();
eq("6.1  the recording starts with the whole window already in it", ctx.recSamples, CAP);
eq("6.2  ...as ONE contiguous chunk, not as the ring's frames", ctx.recChunks.length, 1);
/* read defensively: a build that seeds nothing must FAIL this check, not throw. A suite that
   throws reads as a broken harness rather than as a defect found. */
const c0 = ctx.recChunks[0] || new Int16Array(0);
eq("6.3  the file's first sample is the oldest held sample, not the press moment",
   c0[0], valueAt(heldAt - CAP));
eq("6.4  ...and its last pre-roll sample is the one that arrived just before the press",
   c0[CAP - 1], valueAt(heldAt - 1));
ok("6.5  the start time is moved back by the held duration", Math.abs((t0 - ctx.recStartWall) - 30000) <= 50);
ok("6.6  ...so the panel's elapsed time describes the file, not the wait",
   Math.abs(((Date.now() - ctx.recStartWall) / 1000) - 30) <= 0.1);
eq("6.7  the frequency is the one the ring was filled at (a retune would have emptied it)",
   ctx.recStartHz, 90.7e6);
ctx.recStartWall = Date.UTC(2026, 7, 10, 10, 32, 45);
ctx.latest = { rds: { pi: 0xC204, ps: "BBC R3" } };
eq("6.8  the filename stamps the first sample", ctx.recFileName(),
   "rdsbridge_20260810T103245Z_90.700MHz_C204_BBC-R3.wav");
ctx.recPush(ramp(48000));
eq("6.9  recording continues on top of the pre-roll", ctx.recSamples, CAP + 48000);
ctx.recStop(false);
const f1 = saved[saved.length - 1] || { blob: { size: 0 } };
eq("6.10 the saved file is pre-roll + recorded, to the byte", f1.blob.size, 44 + (CAP + 48000) * 2);
eq("6.11 ...and the ring still holds a window afterwards", ctx.preLen, CAP);

/* with the pre-roll OFF, Record starts at the press -- the 0.11.0 behaviour, unchanged */
reset({}); seq = 0;
ctx.preSetOn(false, true);
for (let i = 0; i < 10; i++) ctx.preFeedMono(ramp(4800));
const t1 = Date.now();
ctx.recStart();
eq("6.12 with the pre-roll off nothing is seeded", ctx.recSamples, 0);
ok("6.13 ...and the start time is the press", Math.abs(t1 - ctx.recStartWall) <= 50);

/* a partly-filled ring seeds what it has, and the clock follows it exactly */
reset({}); seq = 0;
ctx.preFeedMono(ramp(48000 * 7));
const t2 = Date.now();
ctx.recStart();
eq("6.14 a partly-filled ring seeds what it has", ctx.recSamples, 48000 * 7);
ok("6.15 ...and the clock moves back by that, not by the window", Math.abs((t2 - ctx.recStartWall) - 7000) <= 50);

/* =====================================================================================
   GROUP 7 -- the 30-minute cap counts AUDIO, which is what the pre-roll makes visible.
   ===================================================================================== */
reset({}); seq = 0;
ctx.preFeedMono(ramp(CAP));
ctx.recStart();
eq("7.1  the seeded samples count towards the cap", ctx.recSamples, CAP);
const remain = Math.max(1, ctx.REC_MAX_SAMPLES - ctx.recSamples);   /* against the build's own seed, so a build that seeds nothing still reaches its cap and fails 7.1 rather than the harness */
ctx.recPush(ramp(remain - 1));
ok("7.2  one sample short of the cap the recording is still running", ctx.recOn === true);
ctx.recPush(ramp(1));
ok("7.3  the cap fires on the pre-roll-inclusive total", ctx.recOn === false);
const capped = saved[saved.length - 1] || { blob: { size: 0 } };
eq("7.4  ...and the file is exactly the cap, not the cap plus the pre-roll",
   capped.blob.size, 44 + ctx.REC_MAX_SAMPLES * 2);
ok("7.5  the automatic stop reports itself as automatic", logs.some((l) => /limit/.test(l)));
ok("7.6  the panel copy says the limit is a length of audio", /minutes of audio/i.test(src));
ok("7.7  ...and so does the log line at the start", /minutes of AUDIO/.test(bare));
eq("7.8  the cap stops it exactly once", saved.length, 1);

/* =====================================================================================
   GROUP 8 -- Save Last 30s. It writes what is held, and refuses rather than writing a
   44-byte file that opens, plays and is nothing.
   ===================================================================================== */
reset({}); seq = 0;
ctx.preSaveLast();
eq("8.1  an empty pre-roll saves nothing", saved.length, 0);
ok("8.2  ...and says so", logs.some((l) => /^err/.test(l) && /held/.test(l)));

reset({}); seq = 0;
ctx.preFeedMono(ramp(4800));                                   /* 100 ms -- under the floor */
ctx.preSaveLast();
eq("8.3  a barely-filled pre-roll saves nothing either", saved.length, 0);
ok("8.4  ...and states how little is held rather than refusing blankly",
   logs.some((l) => /^err/.test(l) && /0\.1 s/.test(l)));

reset({}); seq = 0;
ctx.preFeedMono(ramp(48000 * 12));
ctx.latest = { rds: { pi: 0xC204, ps: "BBC R3" } };
const t3 = Date.now();
ctx.preSaveLast();
eq("8.5  a filled pre-roll saves one file", saved.length, 1);
eq("8.6  ...of exactly what was held", (saved[0] || { blob: { size: 0 } }).blob.size, 44 + 48000 * 12 * 2);
ok("8.7  ...stamped at the first sample, not the press",
   Math.abs((t3 - ctx.recStartWall) - 12000) <= 50);
ok("8.8  ...and named like any other recording, PI and PS included",
   /^rdsbridge_\d{8}T\d{6}Z_90\.700MHz_C204_BBC-R3\.wav$/.test((saved[0] || {}).name || ""));
eq("8.9  the ring is NOT emptied by saving it", ctx.preLen, 48000 * 12);
ok("8.10 no recording was started", ctx.recOn === false);
ok("8.11 ...and none of the recorder's chunk state was disturbed", ctx.recChunks.length === 0 && ctx.recSamples === 0);

reset({ recOn: true }); seq = 0;
ctx.preFeedMono(ramp(48000 * 12));
ctx.preSaveLast();
eq("8.12 it is refused while a recording is running", saved.length, 0);
ok("8.13 ...because that audio is already in the recording, and it says so",
   logs.some((l) => /^err/.test(l) && /already in it/.test(l)));

reset({}); seq = 0;
ctx.preSetOn(false, true);
ctx.preSaveLast();
eq("8.14 it is refused when the pre-roll is off", saved.length, 0);
ok("8.15 ...pointing at the toggle rather than reporting an empty buffer",
   logs.some((l) => /^err/.test(l) && /pre-roll is off/.test(l)));

/* =====================================================================================
   GROUP 9 -- what the panel says. The status line is the only place a user can see whether
   anything is being held, and it must not claim a window it does not have.
   ===================================================================================== */
reset({}); seq = 0;
ctx.preSetOn(false, true); ctx.preSync();
ok("9.1  off says the file starts at the press", /at the press/.test(ctx.els.preStat.textContent));
ok("9.2  ...and the Save control is hidden entirely", ctx.els.preSave.style.display === "none");
ctx.preSetOn(true, true); ctx.preSync();
ok("9.3  on with nothing held says it is filling", /fills while audio/.test(ctx.els.preStat.textContent));
ok("9.4  ...and the Save control is visible but disabled", ctx.els.preSave.style.display === "" && ctx.els.preSave.disabled === true);
ctx.preFeedMono(ramp(48000 * 12)); ctx.preSync();
ok("9.5  a filled pre-roll reports what it holds, as a duration", /holding 0:12/.test(ctx.els.preStat.textContent));
ok("9.6  ...and the Save control is enabled", ctx.els.preSave.disabled === false);
ctx.recOn = true; ctx.preSync();
ok("9.7  during a recording the Save control is disabled", ctx.els.preSave.disabled === true);
ok("9.8  ...and its tooltip says why rather than leaving a dead control", /already going into it/.test(ctx.els.preSave.title));
ctx.recOn = false;
ok("9.9  the line is refreshed on the 1 Hz tick, not per audio frame", /preSync\(\);/.test(fnBody("recTick")));
ok("9.10 ...and neither tap touches the DOM", !/els\./.test(fnBody("preFeedMono")) && !/els\./.test(fnBody("preFeedStereo")));
ok("9.11 ...nor calls the thing that does, which would put a DOM write on the audio path",
   !/preSync/.test(fnBody("preFeedMono")) && !/preSync/.test(fnBody("preFeedStereo")) && !/preSync/.test(fnBody("preWrite")));

/* =====================================================================================
   GROUP 10 -- the sacred path and the 0.11.0 contracts are untouched.
   ===================================================================================== */
ok("10.1 no MediaRecorder or MediaStream anywhere", !/createMediaStreamDestination|MediaRecorder/.test(bare));
eq("10.2 recStop is still called from exactly two places", (bare.match(/recStop\(/g) || []).length - 1, 2);
ok("10.3 the pre-roll never stops a recording as a side-effect",
   !/recStop/.test(fnBody("preDrop") + fnBody("preFeedMono") + fnBody("preFeedStereo") + fnBody("preSaveLast") + fnBody("preSetOn")));
ok("10.4 the recorder still holds references and concatenates once at stop",
   /new Blob\(\[recWavHeader\(samples,AUDIO_SR,1\)\]\.concat\(chunks\)/.test(bare));
ok("10.5 the pre-roll writes into a preallocated ring, not a growing array",
   /new Int16Array\(PRE_SAMPLES\)/.test(bare) && !/preChunks/.test(bare));
ok("10.6 the exclusions are unchanged: a scan still refuses a recording", /if\(recOn\)/.test(bare.slice(bare.indexOf("async function scanStart("), bare.indexOf("async function scanStart(") + 1200)));
ok("10.7 ...and a lane change still refuses one", /if\(recOn/.test(fnBody("setSource")));

/* ---------- report ---------- */
if (fails.length) {
  fails.forEach((f) => console.log("FAIL  " + f));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed`);
