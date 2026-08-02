#!/usr/bin/env node
/* scanskip_test.js -- band-scan FFT pre-skip: what the level functions answer when they have
 * no baseline, and what the skip decisions do with that answer.
 *
 *   node test/scanskip_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted scanFftLift / scanCarrierLevel / scanAdjacentStrong in a vm against
 * synthesised spectrum arrays. No fixture files, no jsdom, deterministic.
 *
 * WHY THIS EXISTS. Through 0.10.3 scanFftLift() returned +Infinity when scanAvg was null, and
 * scanAdjacentStrong() tests `>= SCAN.localStrongK`. Infinity >= 15 is true, so a window that
 * captured no spectrum frames declared EVERY channel "splatter of a strong local" and skipped the
 * whole band without measuring anything. In a user's 27-Jul-2026 log, 34 of 44 DX-watch windows
 * did exactly that; the loop checked 70 carriers where a single full-band pass checked 51.
 * The out-of-range guards returned -Infinity, which the carrier test read as "empty, skip" -- the
 * same fault in the opposite direction.
 *
 * The rule the suite defends: A MISSING OR UNUSABLE MEASUREMENT MUST NOT ANSWER AS A LEVEL.
 * NaN fails every comparison at the three call sites, so the pre-skip switches itself off and the
 * dwell -- the real detector -- decides. Slower is the correct failure direction for a DX watch;
 * silently skipping the band is not.
 *
 * GROUP 3 is the part that matters most: it asserts the DECISIONS, not just the return values.
 * A suite that only checked "returns NaN" would pass against a build that then compared it wrongly.
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
  if (at < 0) throw new Error("scanskip_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}

/* SCAN.* is read straight out of the build too -- localStrongK / carrierU8 are the thresholds the
   decisions turn on, and a suite that hard-coded 15 and 4 would stop testing the build the day
   either moved. */
const scanLiteral = (() => {
  const at = src.indexOf("var SCAN={");
  if (at < 0) throw new Error("scanskip_test: cannot find SCAN in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j) + ";";
})();

/* scanLvlTxt arrived at 0.10.4; an older build simply doesn't have it. A suite that THROWS on a
   missing function reads as a broken harness rather than a red, and run-all.js can only parse a
   "N passed, M failed" line -- so extract it optionally and let GROUP 7 fail honestly instead. */
function grabOpt(name) { try { return grab(name); } catch (e) { return ""; } }
const CODE = [scanLiteral, grabOpt("scanLvlTxt"), grab("scanFftLift"), grab("scanCarrierLevel"), grab("scanAdjacentStrong")].join("\n\n");

const ctx = {
  Math, Number, Float32Array, isFinite, console,
  scanAvg: null, scanFloor: 0, scanMad: 1, curCenter: NaN, rateHz: 0,
};
vm.createContext(ctx);
vm.runInContext(CODE + "\n;this.scanFftLift=scanFftLift; this.scanCarrierLevel=scanCarrierLevel;" +
                "\n;this.scanAdjacentStrong=scanAdjacentStrong; this.SCAN=SCAN;" +
                "\n;this.scanLvlTxt=(typeof scanLvlTxt===\"function\")?scanLvlTxt:null;", ctx);
const lvlTxt = ctx.scanLvlTxt || (() => "!! scanLvlTxt is not defined in this build !!");

const K = ctx.SCAN.localStrongK, CU8 = ctx.SCAN.carrierU8;

/* ---------- a synthetic window ---------------------------------------------------------
   1024 bins across 10 MHz centred on 90.917 MHz -- the geometry from the reporting user's
   session (RSPdxR2 at 10 Msps, band split into 3 windows of 20.5/3 MHz).                 */

const N = 1024, RATE = 10e6, CENTRE = 90917000;
function binOf(hz) { return Math.round((hz - (CENTRE - RATE / 2)) / (RATE / N)); }

function makeAvg(stations) {          // stations: { hz: level_u8_above_floor }
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = 20;                       // flat floor
  for (const hz of Object.keys(stations)) {
    const c = binOf(+hz), lift = stations[hz];
    for (let i = c - 9; i <= c + 9; i++) if (i >= 0 && i < N) a[i] = 20 + lift;
  }
  return a;
}
function loadWindow(stations) {
  ctx.scanAvg = makeAvg(stations); ctx.scanFloor = 20; ctx.scanMad = 1;
  ctx.curCenter = CENTRE; ctx.rateHz = RATE;
}
function noBaseline() {               // scanFinishAccum() got zero frames
  ctx.scanAvg = null; ctx.curCenter = CENTRE; ctx.rateHz = RATE;
}
function staleGeometry() {            // frames present, curCenter a window behind
  ctx.scanAvg = makeAvg({}); ctx.scanFloor = 20; ctx.scanMad = 1;
  ctx.curCenter = 104583000; ctx.rateHz = RATE;
}

/* ---------- the decisions, exactly as scanStart() makes them --------------------------- */
/* Mirrors the three call sites: splatter test first, then the carrier-level threshold.
   `false` means "do not skip -- tune it and let the dwell decide". */
const STEP = 200000;
function skipsChannel(hz) {
  if (ctx.scanAdjacentStrong(hz, STEP)) return "splatter";
  const lvl = ctx.scanCarrierLevel(hz);
  if (lvl < CU8) return "empty";
  return false;
}

/* ---------- assertions ---------------------------------------------------------------- */

let pass = 0;
const fails = [];
function ok(label, cond) { if (cond) pass++; else fails.push(label); }
function isNan(label, v) { ok(label, typeof v === "number" && Number.isNaN(v)); }

/* GROUP 1 -- the level functions still work when they DO have a baseline.
   Without this the suite could go green against a build that returned NaN unconditionally. */
loadWindow({ 88900000: 40, 91500000: 25, 90500000: 6 });
ok("1.1  strong station reads above localStrongK", ctx.scanFftLift(88900000) >= K);
ok("1.2  quiet channel reads below localStrongK", ctx.scanFftLift(89300000) < K);
ok("1.3  carrier level positive on a station", ctx.scanCarrierLevel(91500000) > CU8);
ok("1.4  carrier level ~0 on an empty channel", Math.abs(ctx.scanCarrierLevel(89300000)) < 1);
ok("1.5  weak-but-present station clears carrierU8", ctx.scanCarrierLevel(90500000) > CU8);
ok("1.6  neighbour of a strong local is splatter", ctx.scanAdjacentStrong(89100000, STEP) === true);
ok("1.7  channel far from any strong local is not", ctx.scanAdjacentStrong(89900000, STEP) === false);
ok("1.8  a real station is checked, not skipped", skipsChannel(91500000) === false);
ok("1.9  a real empty channel is skipped as empty", skipsChannel(89300000) === "empty");
ok("1.10 splatter neighbour is skipped as splatter", skipsChannel(89100000) === "splatter");

/* GROUP 2 -- no baseline: the functions must decline to answer.
   This is the group the 0.10.3 build fails. */
noBaseline();
isNan("2.1  scanFftLift returns NaN with no baseline", ctx.scanFftLift(88900000));
isNan("2.2  scanCarrierLevel returns NaN with no baseline", ctx.scanCarrierLevel(88900000));
ok("2.3  scanFftLift is not +Infinity", ctx.scanFftLift(88900000) !== Infinity);
ok("2.4  scanCarrierLevel is not +Infinity", ctx.scanCarrierLevel(88900000) !== Infinity);
ok("2.5  scanFftLift is not -Infinity", ctx.scanFftLift(88900000) !== -Infinity);
ok("2.6  no-baseline lift does not clear localStrongK", !(ctx.scanFftLift(88900000) >= K));
ok("2.7  no-baseline level does not read as empty", !(ctx.scanCarrierLevel(88900000) < CU8));
ok("2.8  no-baseline level does not read as a carrier", !(ctx.scanCarrierLevel(88900000) > CU8));

/* GROUP 3 -- THE DECISIONS. With no baseline the pre-skip must switch itself off, so every
   channel falls through to the dwell. This is the behaviour, not the return value: a build
   could return NaN and still skip if a call site compared it the other way round. */
noBaseline();
const band = [];
for (let hz = 87.5e6; hz <= 94.3e6; hz += STEP) band.push(hz);
ok("3.1  window covers the full first raster block", band.length === 35);
const skipped = band.filter((hz) => skipsChannel(hz) !== false);
ok("3.2  NO channel is skipped when there is no baseline", skipped.length === 0);
ok("3.3  none skipped as splatter (the 0.10.3 fault)",
   band.every((hz) => skipsChannel(hz) !== "splatter"));
ok("3.4  none skipped as empty (the mirror fault)",
   band.every((hz) => skipsChannel(hz) !== "empty"));
ok("3.5  scanAdjacentStrong is false throughout with no baseline",
   band.every((hz) => ctx.scanAdjacentStrong(hz, STEP) === false));

/* GROUP 4 -- stale geometry: frames present but curCenter a window behind, so every bin index
   falls outside the array. Same rule -- decline, do not answer "empty". This is the "? u8
   (empty, skip)" state in the user's log. */
staleGeometry();
isNan("4.1  out-of-range lift returns NaN", ctx.scanFftLift(87500000));
isNan("4.2  out-of-range carrier level returns NaN", ctx.scanCarrierLevel(87500000));
ok("4.3  out-of-range level is not -Infinity", ctx.scanCarrierLevel(87500000) !== -Infinity);
ok("4.4  stale geometry skips nothing",
   band.every((hz) => skipsChannel(hz) === false));

/* GROUP 5 -- partial geometry. rateHz unset or curCenter NaN are the states between a recentre
   and its readback; both must decline rather than guess. */
ctx.scanAvg = makeAvg({ 88900000: 40 }); ctx.scanFloor = 20; ctx.scanMad = 1;
ctx.curCenter = NaN; ctx.rateHz = RATE;
isNan("5.1  NaN curCenter declines (lift)", ctx.scanFftLift(88900000));
isNan("5.2  NaN curCenter declines (level)", ctx.scanCarrierLevel(88900000));
ok("5.3  NaN curCenter skips nothing", skipsChannel(88900000) === false);
ctx.curCenter = CENTRE; ctx.rateHz = 0;
isNan("5.4  zero rateHz declines (lift)", ctx.scanFftLift(88900000));
isNan("5.5  zero rateHz declines (level)", ctx.scanCarrierLevel(88900000));
ok("5.6  zero rateHz skips nothing", skipsChannel(88900000) === false);

/* GROUP 6 -- the thresholds are read from the build, and are the ones the decisions use. */
ok("6.1  localStrongK is a finite number", isFinite(K) && K > 0);
ok("6.2  carrierU8 is a finite number", isFinite(CU8) && CU8 > 0);
ok("6.3  the sentinel is not reachable as a level: Infinity would clear localStrongK",
   Infinity >= K);   /* documents WHY the old default was fatal -- if this ever fails the
                        threshold has become Infinity and the whole test is meaningless */
ok("6.4  NaN does not clear localStrongK", !(NaN >= K));
ok("6.5  NaN does not fall under carrierU8", !(NaN < CU8));

/* GROUP 7 -- the verbose log must not report a carrier it never measured.
   "? u8 (carrier -- checking)" was what cand.1 printed in the starved state: honest about the
   missing number, then inferring a verdict from it anyway. Confirmed-only over inferred. */
ok("7.1  a real level still reads as u8", /u8/.test(lvlTxt(9.8)));
ok("7.2  a level under carrierU8 still says empty, skip", /empty, skip/.test(lvlTxt(1.2)));
ok("7.3  a level over carrierU8 still says carrier", /carrier/.test(lvlTxt(9.8)));
ok("7.4  NaN does not claim a carrier", !/carrier/.test(lvlTxt(NaN)));
ok("7.5  NaN does not claim empty", !/empty/.test(lvlTxt(NaN)));
ok("7.6  NaN does not print a u8 figure", !/u8/.test(lvlTxt(NaN)));
ok("7.7  NaN says what actually happened", /no baseline/.test(lvlTxt(NaN)));

/* ---------- report ---------- */
if (fails.length) {
  fails.forEach((f) => console.log("FAIL  " + f));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed`);
