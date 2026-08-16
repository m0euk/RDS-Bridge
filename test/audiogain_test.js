#!/usr/bin/env node
/* audiogain_test.js -- the one rule that decides how loud the output graph is.
 *
 *   node test/audiogain_test.js [build.html]     (default ../index.html)
 *
 * WHY THIS EXISTS. Two features turn the audio stream on for their own purposes while the user has
 * asked for no monitoring: scan clips and recording. Through 0.11.2 each wrote aGain.gain.value
 * directly, in four places, and that produced a real fault: at the end of a scan srDisarm() lifted
 * the gain on the line after audioStop(), but audioStop() only stops NEW buffers being queued --
 * the ones already scheduled ahead of the WebAudio clock play out regardless. Reported from the
 * bench on 15-Aug as "a very brief 200 ms or so of audio at the end of a scan".
 *
 * The fix is an invariant rather than a delay: nothing lifts the gain at teardown, and audioStart()
 * applies the wanted level on EVERY call so the next deliberate audio-on restores it. A timer long
 * enough to cover the drain would be a constant chosen without data and would still be wrong on a
 * machine with a bigger buffer.
 *
 * GROUP 3 covers the ordering, which is the half the existing recording suites cannot reach --
 * they stub audioStart(), so a build that opened the graph at the listening level before declaring
 * silence passed all 134 of their checks.
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

function grab(n) {
  const at = src.indexOf("function " + n + "(");
  if (at < 0) throw new Error("audiogain_test: cannot find " + n + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
function grabOpt(n) { try { return grab(n); } catch (e) { return ""; } }

const NAMES = ["audioGainWanted", "audioApplyGain", "audioStart", "audioStop", "srArmNow", "srDisarm", "recStart", "recStop"];
const CODE = NAMES.map(grabOpt).join("\n\n");

let pass = 0, fail = 0, gainHistory = [];
function ok(c, w) { if (c) pass++; else { fail++; console.log("  FAIL: " + w); } }
function tryv(fn, w) { try { return fn(); } catch (e) { fail++; console.log("  FAIL: " + w + " -- threw: " + e.message); } }
function group(t) { console.log("\n" + t); }

const ctx = {
  Math, Number, String, isFinite, console,
  /* aGain records every value written, so ordering faults are visible rather than only end states.
     A build that opened at 0.7 and zeroed on the next line leaves 0.7 in this history even though
     the final value is right -- which is exactly the window that has to be closed. */
  aGain: { gain: { set value(v) { gainHistory.push(v); this._v = v; }, get value() { return this._v; }, _v: 0.7 } },
  actx: { state: "running", resume() {}, createGain() { return ctx.aGain; }, destination: {} },
  els: { audVol: { value: "0.7" } },
  ws: { readyState: 1 }, aNext: 0, audioOn: false, sourceMode: "sdr",
  srSilent: false, recSilent: false, srArmed: false, srCount: 0, srBytes: 0, srShort: 0, srHeldMs: 0,
  recOn: false, laneOn: false, scanRun: false,
  recChunks: [], recSamples: 0, recPending: null, recLast: null, recStartWall: 0, recStartHz: NaN,
  recStartHzNow() { return NaN; }, recSync() {}, recTick() {}, preTotal: 0, preLen: 0, preOn: false, AUDIO_SR: 48000, REC_MAX_MIN: 60, recSaveBlob() {}, recDest: null, recDirHandle: {}, recWrite() {}, recPushPre() {},
  preTake() { return null; }, recStamp() { return "t"; }, recIdSuffix() { return ""; },
  recWavHeader() { return new Uint8Array(0); }, Blob: function () {}, Date,
  enable(k, v) { if (k === "audio_stream_enable") ctx.laneOn = v; },
  recLaneOn() { return ctx.laneOn; },
  tapAudioSet(v) { ctx.laneOn = v; ctx.audioOn = v; },
  audioBtnSync() {}, preDrop() {}, preAlloc() {}, preRelease() {}, srSync() {},
  log() {}, recBytesTxt() { return "0 kB"; }, srMaxClipBytes() { return 0; },
  recDirName: "rdsbridge", srTail: 10,
};
vm.createContext(ctx);
vm.runInContext(CODE + "\n;" + NAMES.map(n => `try{this.${n}=${n};}catch(e){}`).join("") +
  "\n;this.setSilent=function(a,b){ srSilent=a; recSilent=b; };" +
  "\n;this.getSilent=function(){ return [srSilent,recSilent]; };", ctx);

const A = ctx;
const MISSING = NAMES.filter(n => typeof A[n] !== "function");
if (MISSING.length) { console.log("\n  FAIL: build lacks " + MISSING.join(", ")); console.log("\n0 passed, 1 failed"); process.exit(1); }

function reset(laneOn) {
  gainHistory = []; ctx.laneOn = !!laneOn; ctx.audioOn = !!laneOn;
  A.setSilent(false, false); ctx.srArmed = false; ctx.aGain.gain._v = 0.7;
  ctx.els.audVol.value = "0.7";
}

/* ---------- GROUP 1: the rule ----------------------------------------------------------- */
group("GROUP 1 -- one function decides the level, and a silent lane always wins");
reset();
{
  ok(A.audioGainWanted() === 0.7, "no silent lane: the slider value");
  ctx.els.audVol.value = "0.35";
  ok(A.audioGainWanted() === 0.35, "and it follows the slider");
  A.setSilent(true, false);
  ok(A.audioGainWanted() === 0, "scan clips holding: silent");
  A.setSilent(false, true);
  ok(A.audioGainWanted() === 0, "recording holding: silent");
  A.setSilent(true, true);
  ok(A.audioGainWanted() === 0, "both holding: silent");
  A.setSilent(false, false);
  ok(A.audioGainWanted() === 0.35, "released: back to the slider, not to a hardcoded default");
}

/* ---------- GROUP 2: the slider cannot override a hold ----------------------------------- */
group("GROUP 2 -- the volume slider cannot un-mute a silent lane");
reset();
{
  A.setSilent(true, false); A.audioApplyGain();
  ok(ctx.aGain.gain.value === 0, "muted while armed");
  ctx.els.audVol.value = "0.9"; A.audioApplyGain();
  ok(ctx.aGain.gain.value === 0,
     "dragging the slider during a silently-armed scan does NOT make it audible");
  A.setSilent(false, false); A.audioApplyGain();
  ok(ctx.aGain.gain.value === 0.9, "and the level the user chose meanwhile is what they get afterwards");
}

/* ---------- GROUP 3: ordering, which the recording suites cannot see --------------------- */
group("GROUP 3 -- the graph never opens at the listening level");
reset(false);
{
  tryv(() => A.srArmNow(), "srArmNow must not throw");
  ok(ctx.srSilent === true, "the arm took");
  ok(gainHistory.length > 0, "the gain was written during the arm");
  ok(gainHistory.every(v => v === 0),
     "and EVERY value written was zero -- not 0.7 first and 0 on the next line (" + gainHistory.join(",") + ")");
  ok(ctx.aGain.gain.value === 0, "ending muted");
}

group("GROUP 4 -- teardown does not lift the gain over the buffer drain");
{
  gainHistory = [];
  tryv(() => A.srDisarm(), "srDisarm must not throw");
  ok(ctx.srSilent === false, "the hold is released");
  ok(ctx.audioOn === false, "the stream is stopped");
  ok(!gainHistory.some(v => v > 0),
     "and nothing lifted the gain while already-scheduled buffers can still play (" + gainHistory.join(",") + ")");
  ok(A.audioGainWanted() === 0.7, "but the rule now answers the slider again, ready for the next audio-on");
}

group("GROUP 5 -- the next deliberate audio-on is what restores it");
{
  gainHistory = [];
  tryv(() => A.audioStart(), "audioStart must not throw");
  ok(ctx.aGain.gain.value === 0.7,
     "audioStart applies the wanted level on EVERY call, not only when it first builds the graph");
  ok(gainHistory.indexOf(0.7) >= 0, "and did so explicitly");
}

group("GROUP 6 -- a failed arm leaves nothing latched");
reset(false);
{
  /* The stream refuses to come up: recLaneOn() stays false however it is asked. */
  ctx.enable = function () { ctx.laneOn = false; };
  ctx.tapAudioSet = function () { ctx.laneOn = false; };
  tryv(() => A.srArmNow(), "srArmNow must not throw");
  ok(ctx.srArmed === false, "the arm is refused");
  ok(ctx.srSilent === false,
     "and no silent hold is left behind -- otherwise the gain stays at zero with nothing holding it and audio is dead for the session");
  ok(A.audioGainWanted() === 0.7, "the rule answers the slider again");
  /* The failed-arm path applies the rule immediately rather than leaving the graph muted until the
     next audioStart(). That is stronger than it needs to be and worth pinning: an arm that failed
     is not a silent lane, so the user's own monitoring must be usable the instant they ask for it. */
  ok(ctx.aGain.gain.value === 0.7, "the gain is restored there and then, not left for a later audio-on");
}

group("GROUP 7 -- the recording lane obeys the same rule (structural)");
{
  /* recStart's dependency chain (directory handles, permission state, the pre-roll ring) is deep
     enough that stubbing it here would mean testing the stubs. recording_test.js drives the real
     thing. What belongs HERE is that the recording lane uses the same invariant as the scan lane,
     because the two were independently wrong in the same way before 0.12.0. */
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/recSilent=true;\s*\n\s*if\(sourceMode==="sdr"\) audioStart\(\);/.test(stripped),
     "recording declares silence BEFORE audioStart, so the graph never opens at the listening level");
  ok(/if\(!recLaneOn\(\)\)\{ recSilent=false; audioApplyGain\(\);/.test(stripped),
     "a refused recording releases the hold and reapplies the rule, leaving nothing latched");
  ok(!/aGain\.gain\.value = els\.audVol/.test(stripped),
     "no teardown path lifts the gain from the slider directly -- that is what made the drain audible");
  const raw = (stripped.match(/aGain\.gain\.value\s*=/g) || []).length;
  ok(raw <= 3,
     "aGain is written in at most three places: the rule itself and the two graph constructions (found " + raw + ")");
}

group("GROUP 8 -- the overload lamp is styled by a rule that exists");
{
  /* 0.12.0-cand.9. cand.8 shipped this element with data-state="bad" -- a value NO CSS rule
     matches, so it rendered in the default dim grey and read as one more small-caps label in a
     header full of them. It appeared on the bench and was reported as not illuminating.
     This is the operating guide's "a class that no rule matches is dead code that looks alive",
     and nothing but the bench caught it. Assert the state against the rules the build actually
     defines, rather than against a name I chose. */
  const el = src.match(/<span class="pill" id="pillOvl"[^>]*>/);
  ok(!!el, "the lamp element exists");
  if (el) {
    const st = (el[0].match(/data-state="([^"]+)"/) || [])[1];
    const defined = [...new Set((src.match(/header \.pill\[data-state="([^"]+)"\]/g) || [])
      .map(x => x.match(/"([^"]+)"/)[1]))];
    ok(defined.length > 0, "the build defines pill states at all (" + defined.join(", ") + ")");
    ok(defined.indexOf(st) >= 0,
       'the lamp uses a state the CSS defines (got "' + st + '", defined: ' + defined.join(", ") + ")");
    ok(/header #pillOvl\{[^}]*background:var\(--bad\)/.test(src),
       "and is filled rather than tinted, so it does not read as another header label");
    /* --bad is a LIGHT red in the dark theme and a DARK red in the light one, so a fixed
       foreground is legible in at most one of them. var(--bg) inverts with the theme. */
    ok(/header #pillOvl\{[^}]*color:var\(--bg\)/.test(src),
       "with a foreground that inverts with the theme, not a fixed white or black");
    ok(!/header #pillOvl\{[^}]*color:#(fff|000)/i.test(src),
       "specifically NOT a fixed white or black on a fill whose lightness flips between themes");
    ok(!/#pillOvl[^}]*(transition|animation)/.test(src),
       "with no transition or animation -- one of those was a confirmed cause of the 0.10.x scan freeze");
  }
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  ok((stripped.match(/ovlSync\(\)/g) || []).length >= 4,
     "ovlSync runs on the overload push, on can_control, on disconnect, and is defined");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
