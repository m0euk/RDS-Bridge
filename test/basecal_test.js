#!/usr/bin/env node
/* basecal_test.js -- the carrier gate expressed in dB against the live spectrum scale.
 *
 *   node test/basecal_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted scanDbPerU8 / scanCarrierThresh / scanClipFrac / scanCarrierLevel /
 * scanLvlTxt in a vm. No fixture files, no jsdom, deterministic.
 *
 * WHY THIS EXISTS. SDRconnect's binary type-3 frames are "unsigned 8-bit spectrum FFT bin
 * normalised to visible range", and the visible range is spectrum_base..spectrum_ref_level. Through
 * 0.11.2 the carrier pre-skip compared those counts against an absolute constant (carrierU8:4), so
 * the gate moved whenever the user moved Base. Measured 15-Aug-2026 on the RSPdxR2, 94.8 MHz, one
 * station, nothing touched but the Base slider:
 *
 *     Base -130   ->  3.9 u8   (empty, skip)
 *     Base -149   ->  6.2 u8   (carrier - checking)
 *     Base -140   ->  3.9 u8   (empty, skip)
 *
 * SDRconnect 1.0.10 then made Base draggable from the spectrum axis, so this became reachable by
 * accident rather than only by deliberate adjustment.
 *
 * WHAT THIS SUITE CAN AND CANNOT ASSERT. It does NOT use those three readings as an invariance
 * fixture, because they are not one: 94.8 is a marginal channel, empty-channel readings drift by
 * ~2 u8 between passes (measured, and documented at scanCarrierLevel), and the floor estimate moves
 * with them. The bench numbers establish that the VERDICT changed under the slider. They do not
 * establish a clean affine relationship, and a suite that pretended otherwise would be fitting
 * noise. So GROUP 3 synthesises windows where the counts scale exactly as the normalisation defines
 * -- which is the property the fix actually guarantees -- and asserts the DECISION is stable.
 *
 * GROUP 5 is the one that protects everyone who is not on SDRconnect: with no scale readback the
 * gate must fall back to the old absolute constant and behave exactly as 0.11.2 did.
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

/* ---------- extract the real functions ------------------------------------------------ */
function grab(name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) throw new Error("basecal_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
function grabOpt(name) { try { return grab(name); } catch (e) { return ""; } }

const scanLiteral = (() => {
  const at = src.indexOf("var SCAN={");
  if (at < 0) throw new Error("basecal_test: cannot find SCAN in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j) + ";";
})();

const CODE = [scanLiteral, grabOpt("scanDbPerU8"), grabOpt("scanCarrierThresh"),
              grabOpt("scanClipFrac"), grabOpt("scanScaleTxt"),
              grab("scanCarrierLevel"), grabOpt("scanLvlTxt")].join("\n\n");

const ctx = {
  Math, Number, Float32Array, isFinite, console,
  prop: {},                                   // the property shadow SDRconnect fills in
  scanAvg: null, scanFloor: 0, scanMad: 1, curCenter: NaN, rateHz: 0,
};
vm.createContext(ctx);
vm.runInContext(CODE +
  "\n;this.SCAN=SCAN;" +
  "\n;try{this.scanDbPerU8=scanDbPerU8;}catch(e){}" +
  "\n;try{this.scanCarrierThresh=scanCarrierThresh;}catch(e){}" +
  "\n;try{this.scanClipFrac=scanClipFrac;}catch(e){}" +
  "\n;this.scanCarrierLevel=scanCarrierLevel;" +
  "\n;try{this.scanLvlTxt=scanLvlTxt;}catch(e){}", ctx);

const SCAN = ctx.SCAN;
const dbPerU8 = ctx.scanDbPerU8 || null;
const thresh  = ctx.scanCarrierThresh || null;
const clipFrac = ctx.scanClipFrac || null;
const lvlTxt = ctx.scanLvlTxt || null;

/* ---------- harness ------------------------------------------------------------------- */
let pass = 0, fail = 0;
function ok(cond, what) { if (cond) { pass++; } else { fail++; console.log("  FAIL: " + what); } }
function near(a, b, tol, what) { ok(isFinite(a) && Math.abs(a - b) <= tol, what + " (got " + a + ", want " + b + " +/-" + tol + ")"); }
function group(t) { console.log("\n" + t); }

function setScale(base, ref) {
  if (base === null) delete ctx.prop["spectrum_base"]; else ctx.prop["spectrum_base"] = String(base);
  if (ref === null) delete ctx.prop["spectrum_ref_level"]; else ctx.prop["spectrum_ref_level"] = String(ref);
}

/* A synthetic window. Levels are given in dB above the floor and converted to counts through the
   scale in force, which is exactly what SDRconnect's normalisation does to an unclipped spectrum. */
const N = 512, RATE = 9e6, CENTRE = 90.917e6;
function binOf(hz) { return Math.round((hz - (CENTRE - RATE / 2)) / (RATE / N)); }
function loadDb(stationsDb, floorU8, base, ref) {
  const per = (ref - base) / 255;
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = floorU8;
  for (const hz of Object.keys(stationsDb)) {
    const c = binOf(+hz), counts = stationsDb[hz] / per;
    for (let i = c - 5; i <= c + 5; i++) if (i >= 0 && i < N) a[i] = floorU8 + counts;
  }
  ctx.scanAvg = a; ctx.scanFloor = floorU8; ctx.scanMad = 5;
  ctx.curCenter = CENTRE; ctx.rateHz = RATE;
  setScale(base, ref);
}

/* ---------- GROUP 1: the scale itself -------------------------------------------------- */
group("GROUP 1 -- scanDbPerU8 reads the reported visible range");
if (!dbPerU8) { fail++; console.log("  FAIL: scanDbPerU8 is not defined in this build"); }
else {
  setScale(-129, -33); near(dbPerU8(), 96 / 255, 1e-9, "Antenna A bench scale -129/-33");
  setScale(-134, -33); near(dbPerU8(), 101 / 255, 1e-9, "Antenna C bench scale -134/-33");
  setScale(-149, -33); near(dbPerU8(), 116 / 255, 1e-9, "Test-3 wide scale -149/-33");
  setScale(null, -33); ok(!isFinite(dbPerU8()), "no base -> NaN, not zero");
  setScale(-129, null); ok(!isFinite(dbPerU8()), "no ref -> NaN, not zero");
  setScale(-33, -129); ok(!isFinite(dbPerU8()), "inverted range -> NaN (never a negative scale)");
  setScale(-33, -33); ok(!isFinite(dbPerU8()), "zero range -> NaN (never a divide by zero)");
  setScale("junk", -33); ok(!isFinite(dbPerU8()), "unparseable base -> NaN");
}

/* ---------- GROUP 2: the derived gate -------------------------------------------------- */
group("GROUP 2 -- scanCarrierThresh converts carrierDb through that scale");
if (!thresh) { fail++; console.log("  FAIL: scanCarrierThresh is not defined in this build"); }
else {
  setScale(-129, -33);
  near(thresh(), SCAN.carrierDb / (96 / 255), 1e-9, "gate at Antenna A's scale");
  ok(Math.abs(thresh() - 4) < 0.1, "at the scale carrierU8:4 was tuned on, the gate is still ~4 counts");
  setScale(-149, -33);
  ok(thresh() < 4, "a wider visible range means fewer counts per dB, so the gate falls");
  setScale(-100, -33);
  ok(thresh() > 4, "a narrower visible range means more counts per dB, so the gate rises");
  /* The physical level the gate represents must be the SAME at every scale -- that is the whole
     point. Measure it back out rather than restating the division. */
  [[-129, -33], [-134, -33], [-149, -33], [-100, -33]].forEach(function (p) {
    setScale(p[0], p[1]);
    near(thresh() * ((p[1] - p[0]) / 255), SCAN.carrierDb, 1e-9,
         "gate is " + SCAN.carrierDb + " dB at base " + p[0]);
  });
}

/* ---------- GROUP 3: THE DECISION, across scales ---------------------------------------
   This is the group that matters. A station at a FIXED PHYSICAL LEVEL must get the SAME verdict
   at every Base. Against 0.11.2 the 1.7 dB case flips, which is what makes this suite meaningful
   rather than a restatement of the new arithmetic.                                          */
group("GROUP 3 -- a fixed physical level gets a fixed verdict at any Base");
if (!thresh || !lvlTxt) { fail++; console.log("  FAIL: build lacks scanCarrierThresh or scanLvlTxt"); }
else {
  const BASES = [-100, -110, -120, -129, -134, -140, -149];
  /* 1.7 dB is above the 1.5 dB gate and below what the old absolute gate would pass at wide
     Bases -- i.e. squarely in the region where 0.11.2 disagreed with itself. */
  BASES.forEach(function (b) {
    loadDb({ 94800000: 1.7 }, 20, b, -33);
    const lvl = ctx.scanCarrierLevel(94800000);
    ok(lvl >= thresh(), "1.7 dB station is a carrier at base " + b + " (read " + lvl.toFixed(2) + " u8, gate " + thresh().toFixed(2) + ")");
    ok(/carrier/.test(lvlTxt(lvl)), "  and scanLvlTxt says carrier at base " + b);
  });
  BASES.forEach(function (b) {
    loadDb({ 94800000: 1.2 }, 20, b, -33);
    const lvl = ctx.scanCarrierLevel(94800000);
    ok(lvl < thresh(), "1.2 dB station is empty at base " + b + " (read " + lvl.toFixed(2) + " u8, gate " + thresh().toFixed(2) + ")");
    ok(/empty/.test(lvlTxt(lvl)), "  and scanLvlTxt says empty at base " + b);
  });
  /* The old behaviour, stated as a fact about the old constant rather than as a prediction:
     at base -149 a 1.7 dB station reads under 4 counts, so an absolute gate of 4 would skip it. */
  loadDb({ 94800000: 1.7 }, 20, -149, -33);
  const wide = ctx.scanCarrierLevel(94800000);
  ok(wide < SCAN.carrierU8,
     "the same station reads " + wide.toFixed(2) + " u8 at base -149, which the old absolute gate of " +
     SCAN.carrierU8 + " would have skipped");
}

/* ---------- GROUP 4: the clipped-window measurement ------------------------------------ */
group("GROUP 4 -- scanClipFrac measures how much of the floor is pinned at zero");
if (!clipFrac) { fail++; console.log("  FAIL: scanClipFrac is not defined in this build"); }
else {
  loadDb({ 94800000: 6 }, 20, -129, -33);
  near(clipFrac(), 0, 1e-9, "healthy window: nothing pinned");
  loadDb({ 94800000: 6 }, 0, -129, -33);
  ok(clipFrac() > 0.9, "floor at 0: nearly every bin pinned");
  ctx.scanAvg = null;
  ok(!isFinite(clipFrac()), "no baseline -> NaN, not 0 (absence is not a measurement)");
  /* Half-pinned: a floor at zero with half the bins lifted clear. */
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = (i < N / 2) ? 0 : 30;
  ctx.scanAvg = a; ctx.scanFloor = 0; ctx.scanMad = 5; ctx.curCenter = CENTRE; ctx.rateHz = RATE;
  near(clipFrac(), 0.5, 1e-9, "half the bins pinned reads 0.5");
}

/* ---------- GROUP 5: the fallback, for everyone not on SDRconnect ---------------------- */
group("GROUP 5 -- with no scale readback, behaviour is exactly 0.11.2's");
if (!thresh) { fail++; console.log("  FAIL: scanCarrierThresh is not defined in this build"); }
else {
  setScale(null, null);
  ok(thresh() === SCAN.carrierU8, "gate falls back to the absolute constant");
  ctx.scanAvg = new Float32Array(N).fill(20);
  ctx.scanFloor = 20; ctx.scanMad = 5; ctx.curCenter = CENTRE; ctx.rateHz = RATE;
  const c = binOf(94800000);
  for (let i = c - 5; i <= c + 5; i++) ctx.scanAvg[i] = 20 + 3.9;
  ok(ctx.scanCarrierLevel(94800000) < thresh(), "3.9 u8 is empty under the fallback, as before");
  for (let i = c - 5; i <= c + 5; i++) ctx.scanAvg[i] = 20 + 6.2;
  ok(ctx.scanCarrierLevel(94800000) >= thresh(), "6.2 u8 is a carrier under the fallback, as before");
  /* MPX and file lanes never populate prop at all -- the same path, asserted explicitly so a
     future change that made the gate depend on a scale cannot pass this suite. */
  ctx.prop = {};
  ok(thresh() === SCAN.carrierU8, "an empty property shadow still yields the fallback");
}

/* ---------- GROUP 6: the call sites the vm cannot reach --------------------------------
   The two pre-skip decisions live inline inside the scan driver, not in an extractable function,
   so no amount of behavioural testing above touches them. A mutant that reverted the DX-watch
   comparison to the absolute constant passed all 53 checks. This group is therefore a STRUCTURAL
   assertion on the source text, and it is honest about being one: it cannot tell you the decision
   is right, only that the decision is reading the derived gate rather than the raw constant.
   The rule: after 0.12.0 the only legitimate mentions of SCAN.carrierU8 are its definition and the
   no-readback fallback inside scanCarrierThresh. A COMPARISON against it is by definition a call
   site that was missed. */
group("GROUP 6 -- no decision compares against the raw constant (structural)");
{
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const cmp = stripped.match(/[<>]=?\s*SCAN\.carrierU8/g) || [];
  ok(cmp.length === 0,
     "no comparison against SCAN.carrierU8 survives (found " + cmp.length + ": " + cmp.join(", ") + ")");
  const uses = stripped.match(/scanCarrierThresh\(\)/g) || [];
  ok(uses.length >= 3,
     "the derived gate is read at every decision point (found " + uses.length + ", expected >= 3: " +
     "scanLvlTxt, DX-watch pre-skip, full-band pre-skip)");
  const defs = stripped.match(/SCAN\.carrierU8/g) || [];
  ok(defs.length === 1,
     "SCAN.carrierU8 survives exactly once, as the fallback inside scanCarrierThresh (found " + defs.length + ")");
}

/* ---------- report --------------------------------------------------------------------- */
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
