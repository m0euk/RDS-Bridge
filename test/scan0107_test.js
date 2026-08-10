/* scan0107_test.js — 0.10.7 scan-correctness suite.
 *
 * Covers the three changes in 0.10.7's scan work:
 *   A. scanBaseGeomTxt()  — the baseline map self-check (real arithmetic, real extracted function)
 *   B. the rapid watch pass — must NOT power-pre-skip  (structural: see note below)
 *   C. the "measured NOTHING" branch — must name the dominant counter, never assert the dead list
 *
 * NOTE ON B AND C. Section A drives the real extracted function against synthesised spectra, so it
 * measures both halves. B and C cannot: reaching them means standing up the whole scan loop, the
 * socket, the device and the dwell. They are therefore SOURCE-STRUCTURE assertions, and are labelled
 * as such in their output so nobody reads them as behavioural coverage. They are still worth having:
 * both defects being defended against here were re-introducible by a one-line edit, and both shipped
 * once already.
 *
 * Usage:  node scan0107_test.js ../index.html
 */
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), crypto = require("crypto");

const target = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(target, "utf8");
/* Sections A-C assert things about CODE. Matching them against the file raw makes any comment that
   merely NAMES the old behaviour read as the old behaviour, which failed five checks the first time
   this suite ran. Strip comments for those. Section D deliberately does NOT strip: the standing rule
   is that a comment stating a mechanism is read as fact, so stale copy in a comment is still a
   defect. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

let pass = 0, fail = 0;
function ok(cond, what, detail) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + what + (detail ? "   [" + detail + "]" : "")); }
}
function section(t) { console.log("\n" + t); }

/* ---------- build identity, printed FIRST so a green run can never be about the wrong file ---------- */
const ver = (src.match(/\bVERSION\s*=\s*"([^"]*)"/) || [])[1];
const bld = (src.match(/\bBUILD\s*=\s*"([^"]*)"/) || [])[1];
console.log("scan0107_test.js");
console.log("  target : " + target);
console.log("  sha256 : " + crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex"));
console.log("  version: " + ver + (bld ? ("  build " + bld) : ""));

/* ---------- helpers to lift real source out of the build ---------- */
function grab(name, sentinel) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return sentinel;
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") { d++; started = true; }
    else if (c === "}") { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return sentinel;
}
const geomSrc = grab("scanBaseGeomTxt", null);

/* ================================================================= A. geometry self-check */
section("A. scanBaseGeomTxt — baseline map self-check (real function, synthesised spectra)");

ok(geomSrc !== null, "scanBaseGeomTxt is present in the build");

const cfg = (src.match(/var SCAN=\{[\s\S]*?\};/) || [])[0];
ok(!!cfg, "SCAN config block found");
ok(/geomLiftU8\s*:\s*\d+/.test(cfg || ""), "SCAN.geomLiftU8 exists (carrier gate for the self-check)");
ok(/geomEdgeFrac\s*:\s*[\d.]+/.test(cfg || ""), "SCAN.geomEdgeFrac exists (span-edge exclusion)");
const geomCode = (geomSrc || "").replace(/\/\*[\s\S]*?\*\//g, " ");
ok(!/off\s*>\s*hzPerBin\s*\*\s*1\.5/.test(geomCode), "the old bin-width threshold (off > hzPerBin*1.5) is gone");
ok(/rst\s*\/\s*4/.test(geomCode), "the threshold is scaled to the raster");

/* Build a sandbox carrying only what the real function reads. Everything here is a value the app
   would have supplied; nothing stubs the logic under test. */
function runGeom(o) {
  const n = o.bins, avg = new Float32Array(n);
  const hzPerBin = o.rateHz / n;
  for (let i = 0; i < n; i++) avg[i] = o.floor;                 // flat floor
  if (isFinite(o.peakHz)) {
    const bin = Math.round((o.peakHz - (o.curCenter - o.rateHz / 2)) / hzPerBin);
    if (bin >= 0 && bin < n) avg[bin] = o.floor + o.lift;
  }
  const ctx = {
    scanAvg: avg, scanFloor: o.floor, curCenter: o.curCenter, rateHz: o.rateHz,
    SCAN: JSON.parse(JSON.stringify(sandboxSCAN)),
    scanRaster: function () { return o.raster; },
    shAgeTxt: function () { return "0.1s"; },
    Math: Math, isFinite: isFinite
  };
  vm.createContext(ctx);
  vm.runInContext(geomSrc + "\n;out = scanBaseGeomTxt();", ctx);
  return ctx.out;
}
/* read the two new constants out of the real config rather than restating them */
const sandboxSCAN = {
  fmLo: parseFloat((cfg.match(/fmLo\s*:\s*([\d.e+]+)/) || [])[1]),
  geomLiftU8: parseFloat((cfg.match(/geomLiftU8\s*:\s*([\d.]+)/) || [])[1]),
  geomEdgeFrac: parseFloat((cfg.match(/geomEdgeFrac\s*:\s*([\d.]+)/) || [])[1])
};
ok(isFinite(sandboxSCAN.fmLo) && isFinite(sandboxSCAN.geomLiftU8) && isFinite(sandboxSCAN.geomEdgeFrac),
   "the three constants read out of the build are finite");

const US = 200000, ROW = 100000;
const WRONG = /MAP IS WRONG/, NOCARR = /cannot be self-checked/, EDGE = /near the span edge/;

/* 1. a strong carrier exactly on the raster is clean, at every span the app offers */
[[1e6, 512], [2e6, 512], [9e6, 512], [10e6, 1024]].forEach(function (g) {
  const t = runGeom({ bins: g[1], rateHz: g[0], floor: 22, lift: 130,
                      curCenter: 90.1e6, peakHz: 90.1e6, raster: ROW });
  ok(!WRONG.test(t) && !NOCARR.test(t) && !EDGE.test(t),
     "on-raster carrier reads clean at " + (g[0] / 1e6) + " MHz / " + g[1] + " bins", t.slice(-90));
});

/* 2. the 0.10.5 half-raster fault still trips — this is the regression the check exists for */
[[1e6, 512, US, 100000], [2e6, 512, US, 100000], [9e6, 512, ROW, 50000]].forEach(function (g) {
  /* anchor on a real channel of THIS raster (fmLo + k*raster), then step half a raster off it */
  const onCh = sandboxSCAN.fmLo + Math.round((90.1e6 - sandboxSCAN.fmLo) / g[2]) * g[2];
  const t = runGeom({ bins: g[1], rateHz: g[0], floor: 20, lift: 130,
                      curCenter: onCh, peakHz: onCh + g[3], raster: g[2] });
  ok(WRONG.test(t), "half-raster offset still flags at " + (g[0] / 1e6) + " MHz, raster " +
     (g[2] / 1000) + " kHz", t.slice(-90));
});

/* 3. an empty window renders NO verdict — this is the 245-of-522 case from the 09-Aug log */
(function () {
  const t = runGeom({ bins: 512, rateHz: 1e6, floor: 42, lift: -6,
                      curCenter: 87.946e6, peakHz: 88.132e6, raster: US });
  ok(!WRONG.test(t), "a peak BELOW the floor does not flag the map");
  ok(NOCARR.test(t), "…and says why the map was not checked");
  ok(/unaffected/.test(t), "…and states the channel measurements are unaffected");
})();

/* 4. the gate is a carrier test, not a station test: just under vs just over */
(function () {
  const L = sandboxSCAN.geomLiftU8;
  const under = runGeom({ bins: 512, rateHz: 1e6, floor: 30, lift: L - 1,
                          curCenter: 90.0e6, peakHz: 90.06e6, raster: ROW });
  const over  = runGeom({ bins: 512, rateHz: 1e6, floor: 30, lift: L + 1,
                          curCenter: 90.0e6, peakHz: 90.06e6, raster: ROW });
  ok(NOCARR.test(under), "lift one u8 under geomLiftU8 withholds the verdict");
  ok(!NOCARR.test(over), "lift one u8 over geomLiftU8 renders one");
})();

/* 5. span edges are excluded, and say so distinctly from "no carrier" */
(function () {
  const t = runGeom({ bins: 512, rateHz: 1e6, floor: 20, lift: 130,
                      curCenter: 90.0e6, peakHz: 90.0e6 + 0.45e6, raster: ROW });
  ok(EDGE.test(t), "a peak beyond geomEdgeFrac of the span is excluded");
  ok(!NOCARR.test(t), "…and is not reported as an absent carrier");
  ok(!WRONG.test(t), "…and does not flag the map");
})();

/* 6. THE regression that motivated the change: the threshold must not tighten with bin width.
      Same physical error, two capture widths — the verdict must agree. */
(function () {
  const narrow = runGeom({ bins: 512, rateHz: 1e6, floor: 22, lift: 130,
                           curCenter: 90.1e6, peakHz: 90.1e6 + 6000, raster: ROW });
  const wide   = runGeom({ bins: 512, rateHz: 9e6, floor: 22, lift: 130,
                           curCenter: 90.1e6, peakHz: 90.1e6 + 6000, raster: ROW });
  ok(!WRONG.test(narrow), "6 kHz out at 2 kHz/bin does not flag (was 3 kHz threshold → flagged)");
  ok(!WRONG.test(wide),   "6 kHz out at 18 kHz/bin does not flag");
  ok(WRONG.test(narrow) === WRONG.test(wide), "the verdict is independent of capture width");
})();

/* 7. real bench rows, 10-Aug, RSPdxR2 at 9 MHz — every one read clean on hardware */
[[90.706e6, 158.2], [92.903e6, 163.2], [88.509e6, 152.6]].forEach(function (r) {
  const t = runGeom({ bins: 512, rateHz: 9e6, floor: 22.8, lift: r[1] - 22.8,
                      curCenter: 90.917e6, peakHz: r[0], raster: ROW });
  ok(!WRONG.test(t), "bench 10-Aug: " + (r[0] / 1e6).toFixed(3) + " MHz reads clean");
});

/* ================================================================= B. the rapid watch pass */
section("B. rapid watch pass must not power-pre-skip  (SOURCE-STRUCTURE assertion, not behavioural)");

const watchBranch = (function () {
  const i = src.indexOf("RAPID watch pass");
  if (i < 0) return null;
  const j = src.indexOf("} else if(looping)", i);
  return j < 0 ? null : src.slice(i, j);
})();
ok(watchBranch !== null, "the rapid-watch branch is locatable");
ok(watchBranch !== null && !/pPower\+\+/.test(watchBranch),
   "the watch branch does not increment pPower (no power pre-skip)");
const watchCode = (watchBranch || "").replace(/\/\*[\s\S]*?\*\//g, " ");
ok(watchBranch !== null && !/<\s*SCAN\.carrierU8/.test(watchCode),
   "the watch branch does not compare against SCAN.carrierU8");
ok(watchBranch !== null && /RELATIVE|relative/.test(watchBranch),
   "the branch records why an absolute u8 threshold must not return");
/* cand.2: the reading is printed but NOT acted on here, so the line must not state a verdict.
   cand.1 printed "-0.6 u8 (empty, skip) — watch list, checking regardless": one sentence asserting
   both that the channel was skipped and that it was not. Bench-caught 10-Aug. */
ok(watchBranch !== null && /scanLvlTxt\([^;]*?,\s*false\s*\)/.test(watchCode),
   "the watch branch calls scanLvlTxt with judged=false (prints a level, states no verdict)");
const lvlFn = grab("scanLvlTxt", "");
ok(/judged\s*===\s*false/.test(lvlFn),
   "scanLvlTxt suppresses the verdict when the caller does not act on it");
(function () {
  const ctx = { SCAN: { carrierU8: 4 } };
  vm.createContext(ctx);
  vm.runInContext(lvlFn + "\n;a=scanLvlTxt(-0.6,false); b=scanLvlTxt(-0.6); c=scanLvlTxt(9.0); d=scanLvlTxt(NaN);", ctx);
  ok(ctx.a === "-0.6 u8", "judged=false prints the level alone", ctx.a);
  ok(/empty, skip/.test(ctx.b), "the default still states the verdict for callers that act on it", ctx.b);
  ok(/carrier/.test(ctx.c), "a level above carrierU8 still reads as a carrier", ctx.c);
  ok(/no baseline/.test(ctx.d), "no baseline is still not a level", ctx.d);
})();

/* the pre-skip must still be doing its job everywhere it belongs */
const dxBranch = (function () {
  const i = src.indexOf("} else if(looping)");
  const j = src.indexOf("} else {", i);
  return i < 0 || j < 0 ? null : src.slice(i, j);
})();
ok(dxBranch !== null && /pPower\+\+/.test(dxBranch), "DX watch still power-pre-skips");
ok((code.match(/if\(\w+ < SCAN\.carrierU8\)\{ pPower\+\+/g) || []).length === 2,
   "exactly two power pre-skips remain (DX watch + full band)");

/* The two watch-list counts are NOT interchangeable: scanWatch keys on a 50 kHz grid, so a
   range like 87.5-88.0 stores 11 keys for 6 real channels. cand.2 reported "14 watch-list
   channels per pass" against "checked 9" by using the key count. Any user-facing channel count
   must go through scanRasterChannels(); the raw bucket count gates scan BEHAVIOUR and must not
   be rerouted. Bench-caught 10-Aug — the comment at the helper said so and was not read. */
(function () {
  const geomLine = (src.match(/scan geometry: rate [^\n]*/) || [""])[0];
  ok(/scanWatchChannels\(\)/.test(geomLine),
     "the geometry line counts watch channels on the raster");
  ok(!/scanWatchCount\(\)/.test(geomLine),
     "…and not on the 50 kHz storage grid");
  const rc = grab("scanRasterChannels", "");
  const ctx = { rasterHz: function () { return 100000; }, Math: Math };
  vm.createContext(ctx);
  /* 87.5-88.0 as the app stores it: 50 kHz keys (hz/50000), i.e. 1750..1760 */
  const keys = {}; for (let k = 1750; k <= 1760; k++) keys[k] = 1;
  ctx.keys = keys;
  vm.runInContext(rc + "\n;out = scanRasterChannels(keys);", ctx);
  ok(ctx.out === 6, "87.5-88.0 collapses to 6 channels on a 100 kHz raster, not 11 keys", "got " + ctx.out);
})();

/* cand.4: the 30 s heartbeat must be emitted AFTER the watch filter, or it reports a channel the
   pass will not visit ("at 90.1 MHz" on a list that has no 90.1). Bench-caught 10-Aug. */
(function () {
  const filt = code.indexOf("!scanInWatch(ch)) continue;");
  const beat = code.indexOf("scanHbT=hb;");
  ok(filt > 0 && beat > 0, "both the watch filter and the heartbeat are locatable");
  ok(filt > 0 && beat > filt, "the heartbeat is emitted after the watch filter, not before it");
  /* and it must still be inside the same channel loop, not hoisted out of it */
  const loop = code.indexOf("for(ch=SCAN.fmLo;");
  ok(loop > 0 && beat > loop, "…and still inside the per-channel loop");
})();

/* the Guide must carry the audio exemption, not only the visibility constraint: it is the only
   remedy that survives the user walking away, and until cand.4 it existed solely in the log. */
(function () {
  const g = src.slice(src.indexOf("Leaving a scan running unattended"));
  const sec = g.slice(0, g.indexOf("<h3>", 10));
  ok(/visible/.test(sec) && /minimised/.test(sec), "the Guide still states the visibility constraint");
  ok(/audio/i.test(sec), "the Guide states that audio exempts the tab from clamping");
  ok(/background/i.test(sec),
     "…and scopes the measured figures to a backgrounded tab (they do not describe a foreground scan)");
})();

/* ================================================================= C. the measured-NOTHING branch */
section("C. \"measured NOTHING\" must report a counter, not assert a mechanism  (SOURCE-STRUCTURE)");

const nothing = (function () {
  const i = src.indexOf("measured NOTHING");
  if (i < 0) return null;
  const a = src.lastIndexOf("} else if(pDwell===0", i);
  const b = src.indexOf("\n        }", i);
  return a < 0 || b < 0 ? null : src.slice(a, b);
})();
ok(nothing !== null, "the branch is locatable");
const nothingCode = (nothing || "").replace(/\/\*[\s\S]*?\*\//g, " ");
ok(nothing !== null && !/dead list/.test(nothingCode),
   "it no longer blames the dead list (unreachable on this branch: the cache is empty by construction)");
ok(nothing !== null && !/stopped and restarted/.test(nothingCode),
   "it no longer offers a remedy that clears an already-empty cache");
ok(nothing !== null && /watchOn\s*\?/.test(nothingCode),
   "it names the mode that is actually running");
ok(nothing !== null && /pPower/.test(nothingCode) && /pList/.test(nothingCode) &&
   /pSplat/.test(nothingCode) && /pDead/.test(nothingCode),
   "it considers all four skip counters");

/* the preceding branch is what makes the old wording impossible — assert it is still there */
ok(/pDwell===0 && !mpxActive\(\) && scanDeadCount\(\)/.test(code),
   "the non-empty-cache branch above still exists (this is why the dead list cannot be the cause here)");

/* ================================================================= copy sweep */
section("D. no surface still describes the pre-0.10.5 dead-list behaviour");

const CHANGELOG_AT = src.indexOf("CHANGELOG=[");
const live = CHANGELOG_AT < 0 ? src : (src.slice(0, CHANGELOG_AT) + src.slice(src.indexOf("];", CHANGELOG_AT)));
[/speeds up (each|on later|with each|on the next) pass/i,
 /learns (which )?(channels are )?dead( channels)?/i,   // cand.6: the old form missed
                                                        // "learns which channels are dead"
 /dead channels and speeds up/i, /skips channels it finds dead/i,
 /written off permanently/i, /permanently written off/i, /never (looked at|checked) again/i
].forEach(function (re) {
  const m = live.match(re);
  ok(!m, "live text does not say /" + re.source + "/",
     m ? live.slice(Math.max(0, m.index - 90), m.index + 90).replace(/\s+/g, " ") : "");
});
/* Supplement §4 listed TWO MPX baseline log sites; cand.5 had patched only one. Both must branch
   on the lane: err plus "the RF waterfall is not streaming" is a fault report in a lane that has no
   waterfall and cannot have one. */
(function () {
  const fin = grab("scanFinishAccum", "");
  ok(/mpxActive\(\)\s*\?\s*"ev"/.test(fin), "scanFinishAccum drops to ev in MPX");
  ok(/normal for this lane/.test(fin), "…and says the condition is normal for the lane");
  const bl = (code.match(/log\(scanAvg\?"ev":[^\n]*/) || [""])[0];
  ok(/mpxActive\(\)\?"ev":"err"/.test(bl), "the baseline line drops to ev in MPX");
  ok(/Normal for this lane/.test(bl), "…and says so rather than citing a waterfall");
  ok(/NO BASELINE, pre-skip off for this window/.test(bl), "…while the SDRConnect wording is unchanged");
})();

ok(/nothing is ever set aside here/.test(live),
   "the MPX scan-start message states the mechanism, not merely the absence of the wrong claim");

/* ================================================================= */
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
