#!/usr/bin/env node
/* recording_test.js -- 0.11.0 audio recording: the WAV header, the stereo downmix, the filename,
 * the 30-minute cap, the silent-record contract, and the mutual exclusions.
 *
 *   node test/recording_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted recorder out of the build in a vm. No fixture files, no jsdom,
 * deterministic. Where a rule cannot be executed (a guard inside an async scan, a tap sitting
 * inside another function) the source is asserted with COMMENTS STRIPPED, because a test that
 * greps source otherwise matches its own explanatory prose.
 *
 * WHAT IT DEFENDS, and why each one is here rather than trusted:
 *
 *  - THE HEADER'S TWO SIZE FIELDS. A 44-byte RIFF header states the total length at byte 4 and
 *    the data length at byte 40, and a wrong one produces a file that opens, plays, and is
 *    silently truncated. Both are asserted against the actual byte count, not against each other.
 *  - (L+R)>>1, NOT L. Bridge neither sets nor reads wfm_stereo_enable, so the SDRconnect lane's
 *    two channels carry whatever SDRconnect's own stereo setting produces. Taking L would
 *    silently discard half of a genuinely two-channel stream. The suite asserts the downmix AND
 *    its bit-equality with L when L===R, which is what makes it safe on a mono source.
 *  - CONFIRMED-ONLY IN THE FILENAME. PI and PS appear only when they were decoded; nothing is
 *    invented to fill the slot. Same principle as country-of-origin.
 *  - NO COLON, EVER. A colon in a filename breaks on Windows, and the timestamp is the one place
 *    a colon would naturally appear.
 *  - THE CAP SAVES, IT DOES NOT DISCARD. The cap exists to catch a forgotten recording, not to
 *    punish one -- and it must report itself as automatic, because an automatic stop has no user
 *    gesture behind it and therefore cannot open a save dialog.
 *  - NOTHING SILENTLY STOPS A RECORDING. The exclusions are mutual and refused with a message.
 *    Group 6 asserts the call sites of recStop() are exactly the three that are meant to exist,
 *    which is the only form of this check that catches a NEW side-effect added later.
 */

/* A DELIBERATELY NON-UTC, HALF-HOUR-OFFSET TIMEZONE, set before any Date is constructed.
   The filename stamp must be UTC, and on a machine that is already UTC a local-time
   implementation passes a UTC assertion by coincidence -- so the test would prove nothing on a
   UTC build machine while the fault was live for every user with an offset. */
process.env.TZ = "Australia/Adelaide";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

/* ---------- extract ------------------------------------------------------------------- */

function grab(name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) throw new Error("recording_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
function grabOpt(name) { try { return grab(name); } catch (e) { return "function " + name + "(){ throw new Error('missing: " + name + "'); }"; } }
/* 0.11.1: the pre-roll sits ON the taps this suite drives (recPush feeds the ring before the
   recording gate), so its declarations and functions have to be in the context or recFeedStereo
   throws. They are pulled in OPTIONALLY: this suite defends 0.11.0's behaviour and must still run
   against a build that predates the pre-roll. preOn stays false in every reset() here, so what is
   exercised below is the no-pre-roll path -- which is exactly what this suite is for. The
   pre-roll's own behaviour is defended by preroll_test.js. */
function grabLineOpt(re, fallback) { const m = src.match(re); return m ? m[0] : fallback; }

/* the declaration lines carry REC_MAX_MIN and the recorder state; read them from the build so a
   changed cap is tested, not a copy of it */
function grabLine(re, what) {
  const m = src.match(re);
  if (!m) throw new Error("recording_test: cannot find " + what + " in " + BUILD);
  return m[0];
}
const DECL = [
  grabLine(/var REC_MAX_MIN=[^\n]*/, "REC_MAX_MIN"),
  grabLine(/var recOn=false[^\n]*/, "recorder state"),
  grabLine(/var recDirHandle=null[^\n]*/, "chosen-folder state"),
  grabLine(/var REC_DB=[^\n]*/, "idb names"),
  grabLine(/var recLast=null[^\n]*/, "last-saved state"),
  grabLine(/var REC_PICKER_ID=[^\n]*/, "picker id"),
  grabLine(/var AUDIO_SR=48000[^;]*;/, "AUDIO_SR") ? "var AUDIO_SR=48000;" : "",
  grabLineOpt(/var PREROLL_SEC=[^\n]*/, "var PREROLL_SEC=30, PRE_SAMPLES=30*48000, PRE_HZ_TOL=1000;"),
  grabLineOpt(/var preOn=false[^\n]*/, "var preOn=false, preBuf=null, preW=0, preLen=0, preHz=NaN;"),
  grabLineOpt(/var PRE_MIN_SAVE=[^\n]*/, "var PRE_MIN_SAVE=24000;"),
  grabLineOpt(/var preTotal=[^\n]*/, "var preTotal=0;"),                 /* 0.11.2 */
  grabLineOpt(/var srOn=false, srArmed=[^\n]*/, "var srArmed=false;"),   /* 0.11.2: preLive() reads it; this suite is the no-scan path */
].join("\n");

const CODE = [
  /* 0.12.0: the silent lanes now go through one gain rule instead of writing aGain directly.
     Extract the real functions rather than stubbing them, or this suite tests a graph the
     build no longer has \u2014 and a missing callee THROWS, which run-all.js reports as a broken
     runner rather than as a defect. */
  grabOpt("audioGainWanted"), grabOpt("audioApplyGain"),
  DECL,
  grabOpt("recBytesTxt"), grabOpt("recDurTxt"), grabOpt("recLaneOn"),
  grabOpt("recFeedStereo"), grabOpt("recPush"), grabOpt("recWavHeader"),
  grabOpt("recStamp"), grabOpt("recFileName"), grabOpt("recStartHzNow"),
  grabOpt("recSync"), grabOpt("recTick"), grabOpt("recDestSync"), grabOpt("recChooseFolder"),
  grabOpt("recWriteToDir"), grabOpt("recSaved"),
  grabOpt("recIdb"), grabOpt("recIdbDo"), grabOpt("recDirRemember"), grabOpt("recDirForget"),
  grabOpt("recDirRestore"), grabOpt("recAllowFolder"),
  grabOpt("recStart"), grabOpt("recStop"), grabOpt("recSaveBlob"), grabOpt("recDownload"),
  grabOpt("preDrop"), grabOpt("preSetOn"), grabOpt("preGuard"), grabOpt("preWrite"),
  grabOpt("preLive"), grabOpt("preAlloc"), grabOpt("preRelease"), grabOpt("recIdSuffix"),
  grabOpt("preFeedMono"), grabOpt("preFeedStereo"), grabOpt("preTake"), grabOpt("preHeldSec"),
  grabOpt("preSync"), grabOpt("preSaveLast"),
].join("\n\n");

/* ---------- a context that records what the recorder did ------------------------------ */

const saved = [];        // every blob handed to the downloads-folder fallback
const written = [];      // every blob written through a chosen directory handle
/* A minimal IndexedDB stand-in. idbMode switches it between working, absent (the file:// case
   this whole design has to survive) and throwing, because "degrades cleanly" is the claim. */
const idbStore = new Map();
let idbMode = "ok";
function fakeReq(result, fail) {
  const r = { result, onsuccess: null, onerror: null };
  setTimeout(() => { if (fail) { if (r.onerror) r.onerror(); } else if (r.onsuccess) r.onsuccess(); }, 0);
  return r;
}
const fakeIdb = {
  open() {
    if (idbMode === "throw") throw new Error("idb blocked");
    if (idbMode === "openfail") return fakeReq(null, true);
    return fakeReq({
      transaction: () => ({ objectStore: () => ({
        put: (v, k) => { if (idbMode === "putfail") return fakeReq(null, true); idbStore.set(k, v); return fakeReq(k); },
        get: (k) => fakeReq(idbStore.get(k)),
        delete: (k) => { idbStore.delete(k); return fakeReq(undefined); },
      }) }),
    });
  },
};
const logs = [];
const el = () => ({ disabled: false, title: "", textContent: "", style: {}, parentNode: null, appendChild() {} });

const ctx = {
  Math, Number, String, Date, isFinite, console, setTimeout, Promise, Error,
  Int16Array, ArrayBuffer, DataView, Uint8Array,
  AUDIO_SR: 48000,
  sourceMode: "sdr", scanRun: false, audioOn: true, fileAudioOn: false,
  latest: null, curVfo: NaN, metaVfo: NaN,
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
ctx.window.indexedDB = fakeIdb;
vm.createContext(ctx);
vm.runInContext(CODE, ctx);
/* capture every save without changing the code under test */
const realDownload = ctx.recDownload;
ctx.recDownload = function (blob, name) { saved.push({ blob, name }); return realDownload.call(null, blob, name); };

/* ---------- harness ------------------------------------------------------------------- */
let pass = 0; const fails = [];
function ok(label, cond) { if (cond) pass++; else fails.push(label); }
function eq(label, a, b) { ok(label + "  (got " + a + ", want " + b + ")", a === b); }

function reset(over) {
  ctx.recOn = false; ctx.recChunks = []; ctx.recSamples = 0; ctx.recPending = null;
  ctx.recSilent = false; ctx.recStartHz = NaN; ctx.recStartWall = 0;
  ctx.sourceMode = "sdr"; ctx.scanRun = false; ctx.audioOn = true; ctx.fileAudioOn = false;
  ctx.latest = null; ctx.curVfo = NaN; ctx.metaVfo = NaN; ctx.aGain.gain.value = 0.7;
  ctx.recDirHandle = null; ctx.recDirName = ""; ctx.recLast = null; written.length = 0;
  ctx.recDirStored = false; ctx.recDirNeedsAllow = false;
  ctx.preOn = false; ctx.preBuf = null; ctx.preW = 0; ctx.preLen = 0; ctx.preHz = NaN;   /* 0.11.1: this suite is the no-pre-roll path */   /* idbStore / idbMode are NOT reset here: group 12 sets them deliberately either side of a reset */
  saved.length = 0; logs.length = 0;
  Object.assign(ctx, over || {});
}

/* comment-stripped source, for the rules that cannot be executed */
const bare = src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/* =====================================================================================
   GROUP 1 -- the WAV header. Parsed back out of the real bytes, not compared to a copy
   of the arithmetic that wrote them.
   ===================================================================================== */
function parseHeader(buf) {
  const dv = new DataView(buf), txt = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  return {
    riff: txt(0), riffSize: dv.getUint32(4, true), wave: txt(8),
    fmt: txt(12), fmtLen: dv.getUint32(16, true), tag: dv.getUint16(20, true),
    ch: dv.getUint16(22, true), rate: dv.getUint32(24, true), byteRate: dv.getUint32(28, true),
    align: dv.getUint16(32, true), bits: dv.getUint16(34, true),
    data: txt(36), dataSize: dv.getUint32(40, true), len: buf.byteLength,
  };
}
const N1 = 48000 * 7 + 13;                       // 7 s and change, deliberately not round
const h1 = parseHeader(ctx.recWavHeader(N1, 48000, 1));
eq("1.1  header is 44 bytes", h1.len, 44);
eq("1.2  RIFF", h1.riff, "RIFF");
eq("1.3  WAVE", h1.wave, "WAVE");
eq("1.4  fmt chunk", h1.fmt, "fmt ");
eq("1.5  fmt chunk length 16", h1.fmtLen, 16);
eq("1.6  format tag 1 (PCM)", h1.tag, 1);
eq("1.7  mono", h1.ch, 1);
eq("1.8  48 kHz", h1.rate, 48000);
eq("1.9  16-bit", h1.bits, 16);
eq("1.10 block align = channels x 2", h1.align, 2);
eq("1.11 byte rate = rate x channels x 2", h1.byteRate, 96000);
eq("1.12 data chunk", h1.data, "data");
eq("1.13 data size = samples x channels x 2", h1.dataSize, N1 * 2);
eq("1.14 RIFF size = data size + 36", h1.riffSize, N1 * 2 + 36);
const h0 = parseHeader(ctx.recWavHeader(0, 48000, 1));
eq("1.15 zero samples: data size 0", h0.dataSize, 0);
eq("1.16 zero samples: RIFF size still 36", h0.riffSize, 36);
const h2 = parseHeader(ctx.recWavHeader(N1, 48000, 2));
eq("1.17 stereo header would state 2 channels", h2.ch, 2);
eq("1.18 stereo header doubles the data size", h2.dataSize, N1 * 4);
eq("1.19 96 kB per second of mono audio (the figure the UI quotes)", h1.byteRate, 96000);
const hMax = parseHeader(ctx.recWavHeader(ctx.REC_MAX_SAMPLES, 48000, 1));
ok("1.20 a full-length recording's data size does not overflow uint32", hMax.dataSize === ctx.REC_MAX_SAMPLES * 2 && hMax.dataSize < 4294967296);

/* =====================================================================================
   GROUP 2 -- the downmix. (L+R)/2, produced not assumed.
   ===================================================================================== */
function stereoBuf(pairs) {
  const b = new ArrayBuffer(2 + pairs.length * 4), dv = new DataView(b);
  dv.setUint8(0, 1); dv.setUint8(1, 0);                 // the 2-byte type header
  pairs.forEach(([l, r], i) => { dv.setInt16(2 + i * 4, l, true); dv.setInt16(4 + i * 4, r, true); });
  return b;
}
function feedStereo(pairs) {
  reset({ recOn: true });
  const b = stereoBuf(pairs);
  ctx.recFeedStereo(new DataView(b), pairs.length);
  return ctx.recChunks.length ? Array.from(ctx.recChunks[0]) : [];
}
const d1 = feedStereo([[1000, 2000], [-1000, -2000], [0, 0], [32767, 32767], [-32768, -32768]]);
eq("2.1  (1000+2000)/2", d1[0], 1500);
eq("2.2  (-1000+-2000)/2", d1[1], -1500);
eq("2.3  silence stays silence", d1[2], 0);
eq("2.4  positive full scale does not overflow", d1[3], 32767);
eq("2.5  negative full scale does not overflow", d1[4], -32768);
const mono = [[7, 7], [-7, -7], [1, 1], [-1, -1], [12345, 12345], [-12345, -12345], [0, 0]];
const d2 = feedStereo(mono);
ok("2.6  bit-identical to L when L===R (so it can never be wrong on a mono source)",
   d2.every((v, i) => v === mono[i][0]));
eq("2.7  one output sample per stereo pair", feedStereo([[1, 1], [2, 2], [3, 3]]).length, 3);
reset({ recOn: false });
ctx.recFeedStereo(new DataView(stereoBuf([[1, 1]])), 1);
eq("2.8  no capture while not recording", ctx.recChunks.length, 0);
eq("2.9  ...and no samples counted", ctx.recSamples, 0);

/* =====================================================================================
   GROUP 3 -- the filename.
   ===================================================================================== */
function name(over) {
  reset(Object.assign({ recStartWall: Date.UTC(2026, 7, 10, 10, 32, 45), recStartHz: 90.7e6 }, over || {}));
  return ctx.recFileName();
}
const nAll = name({ latest: { rds: { pi: 0xC204, ps: "BBC R3" } } });
eq("3.1  full name", nAll, "rdsbridge_20260810T103245Z_90.700MHz_C204_BBC-R3.wav");
eq("3.2  nothing decoded", name({}), "rdsbridge_20260810T103245Z_90.700MHz.wav");
eq("3.3  PI but no PS", name({ latest: { rds: { pi: 0xE2CF } } }), "rdsbridge_20260810T103245Z_90.700MHz_E2CF.wav");
eq("3.4  PS but no PI (confirmed-only: nothing invented for the missing field)",
   name({ latest: { rds: { ps: "ROCK FM" } } }), "rdsbridge_20260810T103245Z_90.700MHz_ROCK-FM.wav");
eq("3.5  a PI below 0x1000 keeps four hex digits", name({ latest: { rds: { pi: 0x0C2 } } }),
   "rdsbridge_20260810T103245Z_90.700MHz_00C2.wav");
ok("3.6  punctuation is stripped from the PS", !/[^A-Za-z0-9_.-]/.test(name({ latest: { rds: { ps: "Hit's 100.7!" } } })));
eq("3.7  a space-padded scrolling PS does not leave stray hyphens",
   name({ latest: { rds: { ps: "  BBC  R4  " } } }), "rdsbridge_20260810T103245Z_90.700MHz_BBC-R4.wav");
eq("3.8  three decimals are kept", name({ recStartHz: 104.125e6, recStartWall: Date.UTC(2026, 7, 10, 10, 32, 45) })
   .indexOf("104.125MHz") > 0, true);
eq("3.9  a trailing zero is not dropped", name({ recStartHz: 88.0e6, recStartWall: Date.UTC(2026, 7, 10, 10, 32, 45) }),
   "rdsbridge_20260810T103245Z_88.000MHz.wav");
eq("3.10 no frequency at all: the field is omitted, not filled with a guess",
   name({ recStartHz: NaN }), "rdsbridge_20260810T103245Z.wav");
const many = [nAll, name({}), name({ latest: { rds: { pi: 1, ps: "a:b" } } }), name({ recStartHz: NaN })];
ok("3.11 no colon appears in any generated name (it breaks on Windows)", many.every((n) => n.indexOf(":") < 0));
ok("3.12 every name ends .wav", many.every((n) => /\.wav$/.test(n)));
ok("3.13 the date comes first, so a downloads folder sorts chronologically", many.every((n) => /^rdsbridge_\d{8}T\d{6}Z/.test(n)));
/* the stamp is UTC, not local -- the whole point of the Z */
eq("3.14 stamp is UTC", ctx.recStamp(Date.UTC(2026, 0, 2, 3, 4, 5)), "20260102T030405Z");
eq("3.15 midnight UTC", ctx.recStamp(Date.UTC(2026, 11, 31, 0, 0, 0)), "20261231T000000Z");
ok("3.16 the stamp carries the Z", /Z$/.test(ctx.recStamp(Date.now())));

/* =====================================================================================
   GROUP 4 -- the 30-minute cap. It stops AND saves; it does not discard, and it does not
   keep growing.
   ===================================================================================== */
eq("4.1  the cap is 30 minutes", ctx.REC_MAX_MIN, 30);
eq("4.2  ...expressed in samples at 48 kHz", ctx.REC_MAX_SAMPLES, 30 * 60 * 48000);
reset({ recOn: true, recStartWall: Date.now() - 1800000, recStartHz: 90.7e6 });
const BLK = 48000;
let pushes = 0;
while (ctx.recOn && pushes < 2000) { ctx.recPush(new Int16Array(BLK)); pushes++; }
ok("4.3  a feed driven past the cap stops itself", ctx.recOn === false);
eq("4.4  ...at the cap, not later", pushes, ctx.REC_MAX_SAMPLES / BLK);
eq("4.5  ...and saves rather than discarding", saved.length, 1);
ok("4.6  the saved file is the full length", saved[0] && saved[0].blob.size === 44 + ctx.REC_MAX_SAMPLES * 2);
ok("4.7  ...and says why it stopped", logs.some((l) => /limit/.test(l) && /automatic/.test(l)));
ok("4.8  the chunk array is released at stop", ctx.recChunks.length === 0);
reset({ recOn: true });
ctx.recPush(new Int16Array(10)); ctx.recPush(new Int16Array(0)); ctx.recPush(null);
eq("4.9  an empty buffer is not counted", ctx.recSamples, 10);
eq("4.10 ...and does not become a chunk", ctx.recChunks.length, 1);
reset({ recOn: true, recStartWall: Date.now() });
ctx.recPush(new Int16Array(4800));
ctx.recStop(false);
ok("4.11 a manual stop saves too", saved.length === 1);
ok("4.12 ...and is not reported as automatic", !logs.some((l) => /limit/.test(l)));
reset({ recOn: true, recStartWall: Date.now() });
ctx.recStop(false);
eq("4.13 stopping with no audio saves nothing", saved.length, 0);
ok("4.14 ...and says so", logs.some((l) => /no audio/.test(l)));

/* =====================================================================================
   GROUP 5 -- the silent-record contract. Record enables the stream; it must not force
   audible monitoring, and it must put back what it found.
   ===================================================================================== */
reset({ audioOn: false });
ctx.aGain.gain.value = 0.7;
ctx.recStart();
ok("5.1  starting with audio off enables the stream", ctx.audioOn === true);
eq("5.2  ...silently", ctx.aGain.gain.value, 0);
ok("5.3  ...and records", ctx.recOn === true);
ok("5.4  ...and says the speakers were left alone", logs.some((l) => /monitoring left off/.test(l)));
ctx.recPush(new Int16Array(480));
ctx.recStop(false);
ok("5.5  stop puts the stream back off", ctx.audioOn === false);
/* 0.12.0: CHANGED, and the old form was asserting the bug \u2014 the same one scanrec 8.9 held.
   recStop() lifted the gain immediately after audioStop(), but audioStop() only stops NEW buffers
   being queued; those already scheduled ahead of the WebAudio clock play out, and lifting the gain
   made that drain audible. The gain now stays down and the next audioStart() restores it from the
   slider. What must hold is that nothing is left latched. */
ok("5.6  ...releases the silent hold without lifting the gain over the buffer drain",
   ctx.recSilent === false && ctx.aGain.gain.value === 0 && ctx.audioGainWanted() === 0.7);
reset({ audioOn: true });
ctx.aGain.gain.value = 0.55;
ctx.recStart();
eq("5.7  audio already on: the volume is NOT touched", ctx.aGain.gain.value, 0.55);
ctx.recPush(new Int16Array(480));
ctx.recStop(false);
ok("5.8  ...and the stream is left on afterwards", ctx.audioOn === true);
eq("5.9  ...with the volume still the user's", ctx.aGain.gain.value, 0.55);
reset({ sourceMode: "mpx", audioOn: false, fileAudioOn: false });
ctx.recStart();
ok("5.10 the tap lane arms through tapAudioSet, not audioStart", ctx.fileAudioOn === true && ctx.audioOn === false);
ctx.recStop(false);
ok("5.11 ...and is disarmed again at stop", ctx.fileAudioOn === false);
reset({ scanRun: true });
ctx.recStart();
ok("5.12 a scan in progress refuses the record", ctx.recOn === false);
ok("5.13 ...with a message rather than silence", logs.some((l) => /band scan/.test(l)));
reset({ sourceMode: "mpx", metaVfo: 93.1e6, curVfo: 88.5e6 });
eq("5.14 MPX takes its frequency from the helper (metaVfo), not curVfo", ctx.recStartHzNow(), 93.1e6);
reset({ sourceMode: "sdr", metaVfo: 93.1e6, curVfo: 88.5e6 });
eq("5.15 every other lane takes curVfo", ctx.recStartHzNow(), 88.5e6);

/* =====================================================================================
   GROUP 6 -- the exclusions are mutual, and nothing stops a recording as a side-effect.
   Asserted against comment-stripped source: these guards sit inside an async scan and a
   source switch that cannot be driven here.
   ===================================================================================== */
function fnBody(name) {
  const sig = new RegExp("function\\s+" + name + "\\s*\\(");
  const m = bare.match(sig);
  if (!m) return "";
  const at = m.index;
  let d = 0, j = bare.indexOf("{", at);
  for (; j < bare.length; j++) {
    if (bare[j] === "{") d++;
    else if (bare[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return bare.slice(at, j);
}
const scanBody = bare.slice(bare.indexOf("async function scanStart("), bare.indexOf("async function scanStart(") + 1200);
ok("6.1  scanStart refuses to start while a recording is running", /if\(recOn\)/.test(scanBody));
ok("6.2  ...and returns rather than continuing", /if\(recOn\)\{[^}]*return;/.test(scanBody));
ok("6.3  ...before it sets scanRun", scanBody.indexOf("recOn") < scanBody.indexOf("scanRun=true"));
const srcBody = fnBody("setSource");
ok("6.4  setSource refuses a lane change while a recording is running", /if\(recOn/.test(srcBody));
ok("6.5  ...and returns before tearing anything down", srcBody.indexOf("recOn") < srcBody.indexOf("mpxLeave"));
ok("6.6  ...but does not block a no-op call with the same mode", /s!==sourceMode/.test(srcBody));
const togBody = fnBody("audioToggle");
ok("6.7  the audio stream cannot be switched off under a recording", /if\(recOn\)/.test(togBody));
ok("6.8  ...and returns rather than toggling", /if\(recOn\)\{[^}]*return;/.test(togBody));
/* the call-site census: exactly the cap, the Stop button, and nothing else. A new caller added
   later fails this check, which is the whole point -- no other assertion here would see it. */
const stopCalls = (bare.match(/recStop\(/g) || []).length;
eq("6.9  recStop is called from exactly two places (the cap and the Stop button)", stopCalls - 1, 2);
ok("6.10 the cap calls it as automatic", /recSamples>=REC_MAX_SAMPLES\)\s*recStop\(true\)/.test(bare));
ok("6.11 the Stop button calls it as manual", /btnRecStop[\s\S]{0,80}recStop\(false\)/.test(bare));
ok("6.12 stopIQ does not stop a recording", !/recStop/.test(fnBody("stopIQ")));
ok("6.13 setSource does not stop a recording", !/recStop/.test(srcBody));

/* =====================================================================================
   GROUP 7 -- the taps sit before the float conversion, on both lanes, and the worker is
   untouched.
   ===================================================================================== */
const aBody = fnBody("audioFeed"), fBody = fnBody("fileAudioFeed");
ok("7.1  the SDRconnect lane is tapped", /recFeedStereo\(/.test(aBody));
ok("7.2  ...before the Float32 conversion", aBody.indexOf("recFeedStereo") < aBody.indexOf("L[i]="));
ok("7.3  the file / IQ / wsiq / MPX lane is tapped", /recPush\(pcm\)/.test(fBody));
ok("7.4  ...before the Float32 conversion", fBody.indexOf("recPush") < fBody.indexOf("M[i]="));
ok("7.5  neither tap touches the WebAudio graph", !/createMediaStreamDestination|MediaRecorder/.test(bare));
ok("7.6  no encoder was embedded", !/lamejs|Mp3Encoder/i.test(src));
ok("7.7  the recorder adds no external dependency", !/<script[^>]+src=/i.test(src));

/* =====================================================================================
   GROUP 8 -- what the panel says. The cap is stated where the button is, because a limit
   a user only discovers when it fires is not a stated limit.
   ===================================================================================== */
const capCopy = (src.match(/id="recCap"[^>]*>([^<]*)</) || [])[1] || "";
ok("8.1  the maximum duration is stated beside the button", /30 minutes/.test(capCopy));
ok("8.2  ...and says it saves rather than stopping dead", /save/i.test(capCopy));
ok("8.3  ...and does not promise a destination the folder choice overrides", !/downloads folder/i.test(capCopy));
ok("8.4  the Record button exists in the left panel", /id="btnRec"/.test(src));
ok("8.5  ...paired with a Stop, per the panel pattern", /id="btnRecStop"/.test(src));
ok("8.6  the status line exists", /id="recStat"/.test(src));
/* the silent-record case is the main use of the feature and the one a user cannot see working,
   so it is stated where they are already looking rather than only in a tooltip */
const idleCopy = (src.match(/id="recStat"[^>]*>([^<]*)</) || [])[1] || "";
/* The silent-record case is stated on the Record button and in the start log, not on this line
   — Graeme's call, 10-Aug-2026: the idle line is for what the panel does, not for its caveats. */
ok("8.7  the idle line says what the panel records", /records/.test(idleCopy) && /any mode/.test(idleCopy));
ok("8.7b ...and the silent case is still stated on the button itself",
   /monitoring is off it stays off/.test((src.match(/id="btnRec"[^>]*title="([^"]*)"/) || [])[1] || ""));
ok("8.8  the same wording is what the tick repaints (no drift between markup and code)",
   bare.indexOf(idleCopy.trim()) > 0 && (bare.match(new RegExp(idleCopy.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length === 2);

/* =====================================================================================
   GROUP 9 -- the save dialog opens where the user last put a recording. Chrome remembers a
   directory per picker id; without one it reverts to the profile default (Documents) on every
   save, which is what the bench found. Asserted on source: the picker cannot be invoked here.
   ===================================================================================== */
const saveBody = fnBody("recSaveBlob");
ok("9.1  the picker is given an id, so the folder is remembered", /showSaveFilePicker\(\{[^}]*id:/.test(saveBody));
ok("9.2  ...a plain alphanumeric one (a rejected id throws and would read as a failed dialog)",
   /REC_PICKER_ID=\"[A-Za-z0-9]{1,32}\"/.test(bare));
/* MEASURED, not assumed: with startIn:"downloads" passed alongside the id, the dialog opened at
   Downloads every time and did not follow the folder the user chose. Until that is separated,
   no well-known startIn is passed at all — so this asserts its ABSENCE. */
ok("9.3  no well-known startIn overrides the remembered directory", !/startIn:\s*\"/.test(saveBody));
ok("9.4  the automatic cap-save still routes to the browser download folder",
   /recDownload\(blob,name\)/.test(saveBody));
ok("9.5  the suggested name is still the generated one", /suggestedName:name/.test(saveBody));

/* =====================================================================================
   GROUP 10 -- the chosen folder. The per-id remembered directory does not work at a file://
   origin (measured, twice, with and without startIn), so the folder is held here instead.
   A handle in hand needs no user gesture, which is what lets the AUTOMATIC cap save land in
   the same place a manual one does -- the asymmetry that existed while the picker was the
   only route.
   ===================================================================================== */
function dirStub(over) {
  const h = Object.assign({
    name: "DX-catches",
    queryPermission: () => Promise.resolve("granted"),
    getFileHandle: (n) => Promise.resolve({
      createWritable: () => Promise.resolve({
        write: (b) => { written.push({ blob: b, name: n }); return Promise.resolve(); },
        close: () => Promise.resolve(),
      }),
    }),
  }, over || {});
  return h;
}
function stopWithFolder(auto, over) {
  reset({ recOn: true, recStartWall: Date.now(), recStartHz: 90.7e6 });
  ctx.recDirHandle = dirStub(over); ctx.recDirName = "DX-catches";
  ctx.recPush(new Int16Array(4800));
  ctx.recStop(auto);
  return new Promise((r) => setTimeout(r, 0));
}
const g10 = (async () => {
  await stopWithFolder(false);
  eq("10.1 a manual stop writes into the chosen folder", written.length, 1);
  eq("10.2 ...and does not fall back to the downloads folder", saved.length, 0);
  ok("10.3 ...under the generated name", !!written[0] && /^rdsbridge_.*\.wav$/.test(written[0].name));
  await stopWithFolder(true);
  eq("10.4 the AUTOMATIC cap save lands in the same folder, not the downloads folder", written.length, 1);
  eq("10.5 ...with no downloads-folder fallback", saved.length, 0);
  await stopWithFolder(false, { queryPermission: () => Promise.resolve("denied"), requestPermission: () => Promise.resolve("denied") });
  eq("10.6 a revoked permission does not lose the recording", saved.length, 1);
  ok("10.7 ...and says why it went elsewhere", logs.some((l) => /could not write into/.test(l)));
  await stopWithFolder(false, { getFileHandle: () => Promise.reject(new Error("disk full")) });
  eq("10.8 a write failure falls back rather than discarding", saved.length, 1);
  ok("10.9 ...naming the reason", logs.some((l) => /disk full/.test(l)));
  reset({});
  ok("10.10 with no folder chosen the picker route is unchanged", /showSaveFilePicker/.test(fnBody("recSaveBlob")));
  ok("10.11 the folder is asked for with readwrite, or writing would fail later",
     /showDirectoryPicker\(\{[^}]*mode:\s*\"readwrite\"/.test(fnBody("recChooseFolder")));
  ok("10.12 permission is queried, not assumed", /queryPermission/.test(fnBody("recWriteToDir")));
  const destCopy = (src.match(/id="recDest"[^>]*>([^<]*)</) || [])[1] || "";
  ok("10.13 the destination is stated in the panel", /downloads folder/i.test(destCopy));
  ok("10.14 the session-only limit is stated where the folder is chosen",
     /session/i.test(fnBody("recDestSync")) && /forget/i.test(fnBody("recDestSync")));
  ok("10.15 a cancelled folder chooser is not reported as an error",
     /AbortError/.test(fnBody("recChooseFolder")));

  /* ===================================================================================
     GROUP 11 -- the panel confirms a completed save. Through cand.4 the status line showed
     "recording MM:SS · N MB" throughout and reverted to "idle" the instant the write finished,
     so a successful save was indistinguishable from nothing having happened -- and with a
     folder chosen there is no dialog to confirm it either. The confirmation goes on the
     surface that was already being watched, and PERSISTS: a modal on every stop is wrong for
     a feature whose main use is an unattended overnight session.
     =================================================================================== */
  await stopWithFolder(false);
  ok("11.1 after a folder write the panel confirms rather than reverting to idle", !/idle/.test(ctx.els.recStat.textContent));
  ok("11.2 ...naming the file", /rdsbridge_.*\.wav/.test(ctx.els.recStat.textContent));
  ok("11.3 ...and naming where it went", /DX-catches/.test(ctx.els.recStat.textContent));
  const held = ctx.els.recStat.textContent;
  ctx.recTick(); ctx.recTick();
  eq("11.4 ...and it persists across later ticks", ctx.els.recStat.textContent, held);
  reset({ audioOn: true });
  ctx.recLast = { name: "old.wav", dest: "somewhere" };
  ctx.recStart();
  ok("11.5 a new recording clears the previous confirmation", ctx.recLast === null);
  ok("11.6 ...and the line goes back to reporting progress", /recording/.test(ctx.els.recStat.textContent));
  ctx.recStop(false);
  reset({});
  ctx.recDownload(new ctx.Blob([new Int16Array(10)]), "x.wav");
  ok("11.7 the downloads-folder route confirms too", /x\.wav/.test(ctx.els.recStat.textContent));
  ok("11.8 ...naming the downloads folder as the destination", /downloads folder/.test(ctx.els.recStat.textContent));
  ok("11.9 all three save routes report through one function",
     (bare.match(/recSaved\(/g) || []).length === 4);
  ok("11.10 a failed save does not claim success", (function () {
     reset({}); ctx.recPending = { blob: { size: 1000 }, name: "y.wav" }; ctx.recTick();
     return /not saved/.test(ctx.els.recStat.textContent);
   })());
  /* Chrome refuses directory access to several well-known folders, Downloads among them --
     found on the bench, and a user who is told only after the dialog rejects them reasonably
     reads it as a Bridge fault. */
  const folderTip = (src.match(/id="recFolder"[^>]*title="([^"]*)"/) || [])[1] || "";
  ok("11.11 the button says some folders will be refused", /refuse/i.test(folderTip));
  ok("11.12 ...and names Downloads, which is the one a user will try first",
     /Downloads/.test(folderTip));
  /* ONE MACHINE. Downloads being refused was measured on one Mac at file://; whether it is on
     Chromium's published blocklist generally is not established, so no surface may state it as
     a general rule. "on test" is the whole claim. */
  ok("11.13 ...as something measured, not as a general rule about Chrome",
     /on test/i.test(folderTip) && !/always|never|all system folders/i.test(folderTip));
  ok("11.14 a refusal explains itself rather than reporting a bare error name",
     /blocks folders it treats as sensitive/.test(fnBody("recChooseFolder")));
  ok("11.15 ...and points at the fallback that is not subject to any of this",
     /downloads folder as before/.test(fnBody("recChooseFolder")));

  /* ===================================================================================
     GROUP 12 -- the folder survives a reload. The handle is structured-cloneable so
     IndexedDB can hold it; whether IndexedDB EXISTS at a file:// origin is the same
     opaque-origin question that killed the picker's remembered directory, so every path
     here has to survive its absence. The panel must never claim the folder is remembered
     when the write did not happen -- an unkept promise about where a recording will go is
     worse than no promise.
     =================================================================================== */
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const dh = (over) => dirStub(Object.assign({ requestPermission: () => Promise.resolve("granted") }, over || {}));

  idbStore.clear(); idbMode = "ok";
  reset({}); ctx.recDirHandle = dh(); ctx.recDirName = "DX-catches";
  await ctx.recDirRemember(ctx.recDirHandle); await tick();
  ok("12.1  a chosen folder is written to storage", idbStore.size === 1);
  ok("12.2  ...and the panel records that it was kept", ctx.recDirStored === true);
  ok("12.3  ...and says so rather than saying session-only", /remembered/.test(ctx.els.recDest.childNodes[0].nodeValue));

  reset({}); await ctx.recDirRestore(); await tick();   /* the store deliberately survives the reset -- this IS the reload */
  ok("12.4  it comes back on the next load", ctx.recDirHandle !== null);
  eq("12.5  ...by name", ctx.recDirName, "DX-catches");
  ok("12.6  ...with nothing to click when the permission survived", ctx.recDirNeedsAllow === false);

  reset({}); idbStore.set("recdir", dh({ queryPermission: () => Promise.resolve("prompt") }));
  await ctx.recDirRestore(); await tick();
  ok("12.7  a handle whose permission lapsed is still restored", ctx.recDirHandle !== null);
  ok("12.8  ...but is flagged as needing one click", ctx.recDirNeedsAllow === true);
  /* A browser will not restore write access without a user gesture. Pressing Record IS a
     gesture, and one the user is making anyway — so the permission is asked for there and the
     separate Allow button is gone. Two things must hold: the ask happens, and it does NOT gate
     the recording, because losing audio while a folder question is answered is the worse
     failure of the two. */
  ok("12.9  the panel does not demand a click", !/Allow/.test(ctx.els.recDest.childNodes[0].nodeValue));
  eq("12.10 ...and the button only ever offers to change the folder", ctx.els.recFolder.textContent, "Change\u2026");
  let asked = 0;
  ctx.recDirHandle = dh({ requestPermission: () => { asked++; return Promise.resolve("granted"); } });
  ctx.recDirNeedsAllow = true; ctx.audioOn = true;
  ctx.recStart();
  eq("12.11 pressing Record asks for the permission", asked, 1);
  ok("12.12 ...and the recording starts anyway, without waiting for the answer", ctx.recOn === true);
  await tick();
  ok("12.13 granting it clears the flag", ctx.recDirNeedsAllow === false);
  ctx.recStop(false); await tick();
  reset({ audioOn: true });
  ctx.recDirHandle = dh({ requestPermission: () => Promise.resolve("denied") });
  ctx.recDirNeedsAllow = true;
  ctx.recStart(); await tick();
  ok("12.14 a refusal still leaves the recording running", ctx.recOn === true);
  ok("12.15 ...and says where the file will go instead", logs.some((l) => /downloads folder instead/.test(l)));
  ctx.recStop(false); await tick();
  reset({ audioOn: true }); asked = 0;
  ctx.recDirHandle = dh({ requestPermission: () => { asked++; return Promise.resolve("granted"); } });
  ctx.recDirNeedsAllow = false;
  ctx.recStart();
  eq("12.16 a permission already held is not asked for again", asked, 0);
  ctx.recStop(false); await tick();

  /* There is no "back to the downloads folder" control by design: Change... overwrites the
     stored handle. What must NOT survive that decision is a button, a handler or a hidden
     element that no longer does anything -- dead code that looks alive is a standing trap here. */
  idbStore.clear();
  ok("12.24 no orphaned revert control is left in the markup", !/recFolderClear/.test(src));
  ok("12.25 ...and no handler for one", !/recDirForget/.test(bare));
  ok("12.26 choosing again overwrites the stored handle rather than adding a second",
     (await (async () => { reset({}); await ctx.recDirRemember(dh()); await ctx.recDirRemember(dh({ name: "Other" })); await tick(); return idbStore.size; })()) === 1);

  /* the three failure modes: no IndexedDB at all, an open that fails, a write that fails */
  reset({}); idbMode = "throw";
  const kept1 = await ctx.recDirRemember(dh()); await tick();
  ok("12.17 a browser without usable IndexedDB does not throw", kept1 === false);
  ok("12.18 ...and the panel falls back to the session-only wording",
     /this session only/.test((ctx.recDirHandle = dh(), ctx.recDirName = "X", ctx.recDestSync(), ctx.els.recDest.childNodes[0].nodeValue)));
  reset({}); idbMode = "openfail";
  ok("12.19 a failed open is survived", (await ctx.recDirRemember(dh())) === false);
  await ctx.recDirRestore();
  ok("12.20 ...and restore simply finds nothing", ctx.recDirHandle === null);
  reset({}); idbMode = "putfail";
  ok("12.21 a failed write is not reported as remembered", (await ctx.recDirRemember(dh())) === false);
  reset({}); idbMode = "ok"; idbStore.clear(); idbStore.set("recdir", { name: "not-a-handle" });
  await ctx.recDirRestore(); await tick();
  ok("12.22 a stored value that is not a directory handle is ignored", ctx.recDirHandle === null);
  idbStore.clear();
  ok("12.23 restore runs at start-up", /recDestSync\(\);\s*recDirRestore\(\)/.test(bare));
  ok("12.27 the permission is asked for from recStart, where the gesture is",
     /recDirHandle && recDirNeedsAllow\) recAllowFolder\(\)/.test(fnBody("recStart")));
  ok("12.28 ...and the folder button no longer doubles as a permission prompt",
     !/recAllowFolder/.test((src.match(/els\.recFolder\.onclick=[^;]*/) || [""])[0]));

  /* ---------- report ---------- */
  if (fails.length) {
    fails.forEach((f) => console.log("FAIL  " + f));
    console.log(`\n${pass} passed, ${fails.length} failed`);
    process.exit(1);
  }
  console.log(`${pass} passed, 0 failed`);
})();
g10.catch((e) => { console.log("FAIL  harness: " + e.message); console.log("\n0 passed, 1 failed"); process.exit(1); });
