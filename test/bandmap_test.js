/* bandmap_test.js — 0.10.6 cand.1
   The band map's HIT surface: which lane a click is allowed on, and whether the hover read-out
   and the click agree about what is under the pointer.

   Why it exists: 0.10.5 shipped bmClick() guarded on !BMAP and nothing else. bmSourceSync()
   disabled the build button and bmPlayhead() hid the crosshair, so the mosaic LOOKED inert on a
   live SDR lane while a click still ran transportSeek() → applyTune() → playFile() and restarted
   file playback underneath the session. Two users reported it as "status says Playing file,
   waterfall dead, no audio, but the map responds".

   The hover read-out added alongside is the instrument for the separate click/crosshair
   alignment report. It is only worth anything if it runs the SAME arithmetic the click runs —
   a read-out that restates it would agree with the click by construction and measure nothing.
   Section 4 tests exactly that property by driving both and comparing.

   Harness notes carried from bandmap_follow_test.js — each cost a debugging round:
     - the shell is ONE script block: an unstubbed getContext() throws mid-block and every var
       initialiser after it silently never runs. Stub canvas in beforeParse.
     - stub URL.createObjectURL or anything reaching startWorker() dies.
     - jsdom has no layout, so getBoundingClientRect() must be defined on #bmCanvas explicitly.

   Usage: node bandmap_test.js [path/to/index.html]
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(FILE, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
};
const group = (t) => console.log("\n" + t);

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "file:///rdsbridge/index.html",
  beforeParse(w) {
    const stubCtx = {
      canvas: null, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
      textBaseline: "", globalAlpha: 1,
      fillRect(){}, clearRect(){}, strokeRect(){}, beginPath(){}, closePath(){}, moveTo(){},
      lineTo(){}, arc(){}, fill(){}, stroke(){}, save(){}, restore(){}, translate(){}, scale(){},
      rotate(){}, setTransform(){}, fillText(){}, strokeText(){}, drawImage(){}, putImageData(){},
      createLinearGradient(){ return { addColorStop(){} }; },
      getImageData(w2, h2){ return { data: new Uint8ClampedArray(4 * (w2 || 1) * (h2 || 1)) }; },
      createImageData(w2, h2){ return { data: new Uint8ClampedArray(4 * (w2 || 1) * (h2 || 1)) }; },
      measureText(){ return { width: 10 }; },
      setLineDash(){}, getLineDash(){ return []; }, rect(){}, clip(){}, ellipse(){},
      quadraticCurveTo(){}, bezierCurveTo(){}, roundRect(){},
      createRadialGradient(){ return { addColorStop(){} }; }, createPattern(){ return null; }
    };
    w.HTMLCanvasElement.prototype.getContext = function(){ return stubCtx; };
    w.URL.createObjectURL = () => "blob:stub";
    w.URL.revokeObjectURL = () => {};
    w.AudioContext = function(){
      return { state: "running", currentTime: 0, sampleRate: 48000, destination: {},
               resume(){}, createGain(){ return { gain: { value: 1 }, connect(){} }; },
               createBuffer(){ return { copyToChannel(){} }; },
               createBufferSource(){ return { buffer: null, connect(){}, start(){}, stop(){} }; } };
    };
    w.Worker = function(){ this.postMessage = () => {}; this.terminate = () => {}; this.onmessage = null; };
  }
});
const win = dom.window, doc = win.document;

group("0. shell parsed and wired");
ok("bmClick exists", typeof win.bmClick === "function");
ok("bmHit exists", typeof win.bmHit === "function");
ok("bmCellTxt exists", typeof win.bmCellTxt === "function");
ok("bmHover exists", typeof win.bmHover === "function");
ok("bmSourceSync exists", typeof win.bmSourceSync === "function");
ok("BUILD is a cand tag or empty at release", /^(0\.\d+\.\d+-cand\.\d+)?$/.test(win.BUILD || ""),
   JSON.stringify(win.BUILD) + " / VERSION " + win.VERSION);
if (typeof win.bmClick !== "function" || typeof win.bmHit !== "function") {
  console.log("\nshell did not wire — aborting");
  console.log("\n" + pass + " passed, " + (fail + 1) + " failed");
  process.exit(1);
}

/* ── synthetic map. Absolute, multi-column, so a click has a real frequency and applyTune()
      is genuinely reachable — a single-column offset map would let the guard pass for the
      wrong reason. ───────────────────────────────────────────────────────────────────── */
const ROWS = 200, NC = 8, RASTER = 100000, BUCKET = 5;
const cells = new Float32Array(ROWS * NC);
for (let i = 0; i < cells.length; i++) cells[i] = (i % 37) - 5;   // a spread of levels, some floor
win.BMAP = { rows: ROWS, bucket: BUCKET, nC: NC, raster: RASTER, chans: [], abs: true, cells: cells };
for (let c = 0; c < NC; c++) win.BMAP.chans.push(88.1e6 + c * RASTER);
win.centreHz = 88.5e6;
win.fileMeta = { rate: 1000, frames: 2000000, name: "t.wav", bytesPerFrame: 4, dataOffset: 44,
                 file: { slice(){ return { arrayBuffer: async () => new ArrayBuffer(0) }; } } };

const CELL = win.bmCell();                       // read from the shell, never assumed
const cv = doc.getElementById("bmCanvas");
/* prep() sets the backing store and the CSS size to the same design px; the RECT is what the
   UI-scale zoom stretches. setScale() models exactly that pairing. */
cv.width = NC * CELL.w; cv.height = ROWS * CELL.h;
let SCALE = 1;
const setScale = (z) => {
  SCALE = z;
  cv.getBoundingClientRect = () => ({ left: 0, top: 0,
    width: NC * CELL.w * z, height: ROWS * CELL.h * z });
};
setScale(1);

/* count the three things a click on a live lane must not do */
let nSeek = 0, nTune = 0, nPlay = 0, nTap = 0;
win.transportSeek = () => { nSeek++; };
win.applyTune     = () => { nTune++; };
win.playFile      = () => { nPlay++; win.playing = true; };
win.tapAudioSet   = () => { nTap++; };
const reset = () => { nSeek = nTune = nPlay = nTap = 0; win.playing = false; win.paused = false; };

/* aim at the middle of a known cell so nothing here depends on the drawing conventions —
   this suite is about WHICH cell, not about where the rules are stroked. */
const at = (r, c) => ({ clientX: (c + 0.5) * CELL.w * SCALE,
                        clientY: (r + 0.5) * CELL.h * SCALE });

group("1. geometry read from the shell");
ok("cell has real pixel size", CELL.w > 0 && CELL.h > 0, JSON.stringify(CELL));
ok("bmHit finds the cell aimed at", (() => {
  const h = win.bmHit(at(12, 3));
  return h && h.r === 12 && h.c === 3;
})(), JSON.stringify(win.bmHit(at(12, 3))));
ok("bmHit returns null outside the map", win.bmHit({ clientX: (NC + 3) * CELL.w, clientY: 10 }) === null);
ok("bmHit returns null above the map", win.bmHit({ clientX: 5, clientY: -4 }) === null);

group("2. on the file lane the click still does all three things");
win.sourceMode = "file"; win.bmSourceSync(); reset();
win.bmClick(at(9, 2));
ok("transportSeek called", nSeek === 1, "n=" + nSeek);
ok("applyTune called", nTune === 1, "n=" + nTune);
ok("playFile called when stopped", nPlay === 1, "n=" + nPlay);
ok("bmStat names the cell", /88\.3 MHz @ /.test(doc.getElementById("bmStat").textContent),
   doc.getElementById("bmStat").textContent);

group("3. on every other lane the click does NOTHING  ← the 0.10.5 fault");
["sdr", "mpx", "wsiq"].forEach((mode) => {
  win.sourceMode = mode; win.bmSourceSync(); reset();
  win.bmClick(at(9, 2));
  ok(mode + ": no transportSeek", nSeek === 0, "n=" + nSeek);
  ok(mode + ": no applyTune", nTune === 0, "n=" + nTune);
  ok(mode + ": no playFile", nPlay === 0, "n=" + nPlay);
  ok(mode + ": no audio tap", nTap === 0, "n=" + nTap);
  ok(mode + ": playing stays false", win.playing === false);
  ok(mode + ": bmStat says why", /IQ File/.test(doc.getElementById("bmStat").textContent),
     doc.getElementById("bmStat").textContent);
  ok(mode + ": mosaic carries the inert class",
     doc.getElementById("bmBodyWrap").classList.contains("off"));
});
win.sourceMode = "file"; win.bmSourceSync();
ok("file: inert class removed again", !doc.getElementById("bmBodyWrap").classList.contains("off"));

group("4. a click with no map is still inert, on every lane");
const savedMap = win.BMAP;
["file", "sdr", "mpx", "wsiq"].forEach((mode) => {
  win.BMAP = null; win.sourceMode = mode; reset();
  win.bmClick(at(9, 2));
  ok(mode + ": no map → no seek", nSeek === 0, "n=" + nSeek);
});
win.BMAP = savedMap; win.sourceMode = "file"; win.bmSourceSync();

/* ── the hover read-out has to RUN the click's arithmetic, not restate it ──────────────── */
const raf2 = () => new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));

(async () => {
  group("5. hover and click describe the same cell identically");
  const stat = doc.getElementById("bmStat");
  let agreed = 0, compared = 0;
  for (const [r, c] of [[0, 0], [3, 5], [17, 1], [ROWS - 1, NC - 1], [88, 4]]) {
    win.sourceMode = "file"; reset();
    win.bmHover(at(r, c));
    await raf2();
    const hovered = stat.textContent;
    win.bmClick(at(r, c));
    const clicked = stat.textContent;
    compared++;
    if (hovered === clicked && hovered.length > 4) agreed++;
    ok("r" + r + "c" + c + ": hover text === click text", hovered === clicked,
       JSON.stringify(hovered) + " vs " + JSON.stringify(clicked));
  }
  ok("every comparison was non-trivial", agreed === compared && compared === 5,
     agreed + "/" + compared);

  group("6. the read-out moves with the pointer, and only on the file lane");
  win.sourceMode = "file"; reset();
  win.bmHover(at(2, 1)); await raf2();
  const a = stat.textContent;
  win.bmHover(at(40, 6)); await raf2();
  const b = stat.textContent;
  ok("a different cell reads differently", a !== b, JSON.stringify(a) + " / " + JSON.stringify(b));
  ok("the read-out names the second cell", /88\.7 MHz/.test(b), b);

  win.sourceMode = "sdr"; win.bmSourceSync();
  const before = stat.textContent;
  win.bmHover(at(11, 3)); await raf2();
  ok("no hover read-out on a live lane", stat.textContent === before,
     JSON.stringify(before) + " → " + JSON.stringify(stat.textContent));

  group("7. leaving the map restores what was there before the hover");
  win.bmHoverOut();                 // the pointer leaves before anything else writes #bmStat
  win.sourceMode = "file"; win.bmSourceSync(); reset();
  stat.textContent = "RESTING TEXT";
  win.bmHover(at(6, 2)); await raf2();
  ok("hover replaced the resting text", stat.textContent !== "RESTING TEXT", stat.textContent);
  win.bmHoverOut();
  ok("mouseleave restored it", stat.textContent === "RESTING TEXT", stat.textContent);

  group("8. hover is wired to the canvas, not just callable");
  /* a listener test, because a function nobody calls is the same as no function */
  win.bmHoverOut();
  stat.textContent = "RESTING 2";
  cv.dispatchEvent(new win.MouseEvent("mousemove", { bubbles: true,
                    clientX: at(20, 5).clientX, clientY: at(20, 5).clientY }));
  await raf2();
  ok("mousemove on the canvas updates the read-out", stat.textContent !== "RESTING 2",
     stat.textContent);
  cv.dispatchEvent(new win.MouseEvent("mouseleave", { bubbles: false }));
  ok("mouseleave on the canvas restores", stat.textContent === "RESTING 2", stat.textContent);

  group("9. scan copy matches the shipped dead-list rules");
  /* 0.10.5 stopped writing off a channel that shows a pilot and gave every strike a TTL.
     The site was corrected; these three in-app strings were not, and went from stale to false. */
  ok("scanMode tooltip does not promise dead carriers",
     !/dead carriers/i.test(doc.getElementById("scanMode").getAttribute("title") || ""));
  ok("scanMode tooltip states the pilot exemption",
     /pilot is never set aside/i.test(doc.getElementById("scanMode").getAttribute("title") || ""));
  ok("baseline info does not claim no-RDS channels are skipped",
     !/has no RDS/i.test(doc.getElementById("scanBaselineInfo").textContent));
  ok("guide does not claim the loop speeds up as it goes",
     !/speeds up as it goes/i.test(doc.getElementById("panel-guide").textContent));
  ok("guide states the fifteen-minute return",
     /fifteen minutes/i.test(doc.getElementById("panel-guide").textContent));
  ok("guide carries the unattended-scan window caveat",
     /visible and un-minimised/i.test(doc.getElementById("panel-guide").textContent));

  group("10. the hover outline sits on the cell's OWN rectangle");
  /* The point of the overlay: it is drawn with the mosaic's convention (c*CW, r*CH, CW, CH),
     so a disagreement between the hit-test and the render is visible rather than measured.
     Read what the code actually wrote — never recompute the expectation from the same source. */
  const hcE = doc.getElementById("bmHoverCell"), tipE = doc.getElementById("bmTip");
  ok("overlay elements exist", !!hcE && !!tipE);
  win.sourceMode = "file"; win.bmSourceSync(); reset();
  for (const [r, c] of [[0, 0], [7, 3], [ROWS - 1, NC - 1]]) {
    win.bmHoverOut();
    win.bmHover(at(r, c)); await raf2();
    ok("r" + r + "c" + c + ": outline shown", hcE.style.display === "block", hcE.style.display);
    ok("r" + r + "c" + c + ": outline left = c*cellW",
       parseFloat(hcE.style.left) === c * CELL.w, hcE.style.left + " want " + (c * CELL.w));
    ok("r" + r + "c" + c + ": outline top = r*cellH",
       parseFloat(hcE.style.top) === r * CELL.h, hcE.style.top + " want " + (r * CELL.h));
    ok("r" + r + "c" + c + ": outline is one cell",
       parseFloat(hcE.style.width) === CELL.w && parseFloat(hcE.style.height) === CELL.h,
       hcE.style.width + "x" + hcE.style.height);
    ok("r" + r + "c" + c + ": tip carries the cell text",
       tipE.style.display === "block" && tipE.textContent === doc.getElementById("bmStat").textContent,
       JSON.stringify(tipE.textContent));
  }
  ok("tip stays inside the map on the right edge",
     parseFloat(tipE.style.left) >= 0 && parseFloat(tipE.style.left) < NC * CELL.w,
     tipE.style.left);

  group("11. the overlay goes away when it should");
  win.bmHoverOut();
  ok("hidden on mouseleave", hcE.style.display === "none" && tipE.style.display === "none");
  win.bmHover(at(5, 2)); await raf2();
  ok("shown again", hcE.style.display === "block");
  win.sourceMode = "sdr"; win.bmSourceSync();
  ok("hidden on a lane change", hcE.style.display === "none" && tipE.style.display === "none");
  win.bmHover(at(5, 2)); await raf2();
  ok("stays hidden on a live lane", hcE.style.display === "none", hcE.style.display);
  win.sourceMode = "file"; win.bmSourceSync();

  group("12. the hit-test survives the UI-scale control  \u2190 the fault behind fault 2");
  /* The scale control sets document.body.style.zoom, so the rect is in ZOOMED px while
     bmCell() is in design px. 0.10.5 divided one by the other and was out by the scale
     factor \u2014 nothing at column 0, growing linearly across the map. Every scale the
     control actually offers is tested, because the fault is invisible at exactly one of them.
     Note what is NOT done here: the expected column is not recomputed from the same
     arithmetic. The pointer is placed at a known cell's centre on screen and the code is
     asked which cell that is. */
  const SCALES = [0.5, 0.7, 0.75, 0.8, 0.85, 0.9, 1, 1.15, 1.3, 1.5];
  let worst = 0;
  for (const z of SCALES) {
    setScale(z);
    let bad = 0;
    for (const [r, c] of [[0, 0], [1, 1], [40, 4], [ROWS - 1, NC - 1], [123, 6]]) {
      const h = win.bmHit(at(r, c));
      if (!h || h.r !== r || h.c !== c) bad++;
      if (h) worst = Math.max(worst, Math.abs(h.c - c));
    }
    ok("scale " + z + ": every cell hit exactly", bad === 0, bad + " wrong of 5");
  }
  setScale(1.5);
  ok("at 150% the far column is not mistaken for another",
     (() => { const h = win.bmHit(at(10, NC - 1)); return h && h.c === NC - 1; })(),
     JSON.stringify(win.bmHit(at(10, NC - 1))));
  ok("column 0 is right at every scale (the fault's blind spot)", true);
  ok("no residual column error anywhere", worst === 0, "worst=" + worst);

  group("13. the outline still lands on the cell at a non-unit scale");
  /* The outline is positioned in DESIGN px inside #bmBodyWrap, which the zoom scales with
     everything else \u2014 so it must NOT be scaled again here. */
  setScale(1.5);
  win.sourceMode = "file"; win.bmSourceSync(); reset();
  win.bmHoverOut();
  win.bmHover(at(9, 5)); await raf2();
  ok("outline left is design px, unscaled",
     parseFloat(hcE.style.left) === 5 * CELL.w, hcE.style.left + " want " + (5 * CELL.w));
  ok("outline top is design px, unscaled",
     parseFloat(hcE.style.top) === 9 * CELL.h, hcE.style.top + " want " + (9 * CELL.h));
  ok("read-out names the hovered channel at 150%", /88\.6 MHz/.test(tipE.textContent), tipE.textContent);
  setScale(1);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
