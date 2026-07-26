/* mpxaxis_test.js — 0.10.0 cand.17
   Suite for #mpxaxis, the composite scale shown in Map view.

   The claim is a PARITY claim, not a new-feature claim: draw() has painted this scale along the
   bottom of #scope since 0.3.0, and Map view hides #scope. So the test drives the real draw() and
   the real mpxDrawAxis() from the same frame, at DIFFERENT canvas widths, and requires the two to
   agree on every tick and every mark as a fraction of width. Nothing here restates the arithmetic:
   both sides are read off a recording canvas context, and group 4 measures the marks against the
   columns mpxwfPush actually paints.

   Usage: node mpxaxis_test.js [path/to/index.html]
*/
const fs_ = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = process.argv[2] || path.join(__dirname, "work.html");
const html = fs_.readFileSync(FILE, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log("  FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
};
const group = (t) => console.log("\n" + t);
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 1e-6 : eps);

/* ── a canvas context that records what was actually drawn ──────────────────── */
function recorder(){
  const r = { lines: [], texts: [], images: [] };
  let cur = null;
  const ctx = {
    canvas: null, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    textBaseline: "", globalAlpha: 1, shadowColor: "", shadowBlur: 0, _dash: [], _stack: [],
    save(){ this._stack.push({ s: this.strokeStyle, a: this.globalAlpha, d: this._dash.slice() }); },
    restore(){ const p = this._stack.pop(); if (p){ this.strokeStyle = p.s; this.globalAlpha = p.a; this._dash = p.d; } },
    setLineDash(d){ this._dash = d && d.length ? d.slice() : []; },
    getLineDash(){ return this._dash; },
    beginPath(){ cur = { pts: [] }; },
    closePath(){},
    moveTo(x, y){ (cur || (cur = { pts: [] })).pts.push([x, y]); },
    lineTo(x, y){ (cur || (cur = { pts: [] })).pts.push([x, y]); },
    stroke(){ if (cur && cur.pts.length >= 2) r.lines.push({ pts: cur.pts.slice(),
                strokeStyle: this.strokeStyle, alpha: this.globalAlpha, dash: this._dash.slice() }); cur = null; },
    fill(){}, arc(){}, fillRect(){}, clearRect(){}, strokeRect(){},
    translate(){}, scale(){}, rotate(){}, setTransform(){},
    fillText(t, x, y){ r.texts.push({ t: String(t), x, y }); }, strokeText(){},
    drawImage(){}, measureText(){ return { width: 10 }; },
    createLinearGradient(){ return { addColorStop(){} }; },
    createImageData(w, h){ return { width: w, height: h || 1, data: new Uint8ClampedArray(4 * w * (h || 1)) }; },
    getImageData(x, y, w, h){ return { width: w, height: h, data: new Uint8ClampedArray(4 * w * h) }; },
    putImageData(img){ r.images.push(img); }
  };
  r.ctx = ctx; r.reset = () => { r.lines.length = 0; r.texts.length = 0; r.images.length = 0; };
  return r;
}
const recs = new Map();
const recOf = (el) => recs.get(el);

const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "file:///rdsbridge/index.html",
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = function(){
      if (!recs.has(this)) { const r = recorder(); r.ctx.canvas = this; recs.set(this, r); }
      return recs.get(this).ctx;
    };
    w.URL.createObjectURL = () => "blob:stub";
    w.URL.revokeObjectURL = () => {};
    w.Worker = function(){ this.postMessage = () => {}; this.terminate = () => {}; this.onmessage = null; };
  }
});
const win = dom.window, doc = win.document;

group("0. the surface exists, and only where the spectrum does not");
const axis = doc.getElementById("mpxaxis"), mwf = doc.getElementById("mpxwf");
ok("#mpxaxis exists", !!axis);
ok("directly under the MPX waterfall", mwf && mwf.nextElementSibling === axis,
   mwf && mwf.nextElementSibling ? mwf.nextElementSibling.id : "none");
ok("registered in els", win.els && win.els.mpxaxis === axis);
ok("mpxDrawAxis is a function", typeof win.mpxDrawAxis === "function");
const cssText = Array.from(doc.querySelectorAll("style")).map(s2 => s2.textContent).join("\n");
ok("display:none by default", /#mpxaxis\{[^}]*display:none/.test(cssText));
ok("shown in map view", /body\.bmap #mpxaxis\{display:block/.test(cssText));
ok("NOT re-hidden by the essentials rule", !/body\.ess[^{]*#mpxaxis/.test(cssText));
ok("NOT re-hidden by the pano rule", !/body\.pano[^{]*#mpxaxis/.test(cssText));
ok("title names all three marks", !!axis &&
   /19 kHz/.test(axis.title) && /38 kHz/.test(axis.title) && /57 kHz/.test(axis.title));
if (!axis || typeof win.mpxDrawAxis !== "function") {
  /* report rather than throw: a suite run against a build that predates the surface must still say
     how many checks failed, or the runner has nothing to summarise. */
  console.log("\n#mpxaxis is not present in this build — remaining groups skipped");
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(1);
}

/* jsdom has no layout. Give the two canvases DIFFERENT widths on purpose: parity must hold as a
   fraction of width, not as pixels. */
const AXW = 1000, SCW = 800, SCH = 170;
Object.defineProperty(axis, "clientWidth", { get: () => AXW, configurable: true });
const scope = doc.getElementById("scope");
Object.defineProperty(scope, "clientWidth", { get: () => SCW, configurable: true });
Object.defineProperty(scope, "clientHeight", { get: () => SCH, configurable: true });

const HB = 2048;
const frameAt = (fs, spikeHz) => {
  const mag = new Float32Array(HB).fill(-120);
  if (spikeHz != null) mag[Math.round(spikeHz / (fs / 2) * HB)] = 0;
  return { mag, fs };
};
const rAx = () => recOf(axis), rSc = () => recOf(scope);
/* the scope draws its grid AND a trace polyline; a grid line or a mark is the two-point vertical kind */
const straight = (r) => r.lines.filter(l => l.pts.length === 2 && near(l.pts[0][0], l.pts[1][0], 1e-9));
const marksOf  = (r) => straight(r).filter(l => l.dash.length).map(l => ({ x: l.pts[0][0], c: l.strokeStyle, a: l.alpha }));
const ticksOf  = (r) => straight(r).filter(l => !l.dash.length).map(l => l.pts[0][0]);

group("1. no rate known yet: no scale is claimed");
win.latest = null; win.rateHz = 0; win._mpxAxKey = "";
if (rAx()) rAx().reset();
win.mpxDrawAxis();
ok("nothing stroked", !rAx() || straight(rAx()).length === 0);
ok("nothing labelled", !rAx() || rAx().texts.length === 0);

group("2. parity with the scale under the spectrum — 192 kHz composite");
win.latest = frameAt(192000, null); win._mpxAxKey = "";
rAx() && rAx().reset(); rSc() && rSc().reset();
win.draw(); win.mpxDrawAxis();
const axT = rAx().texts, scT = rSc().texts;
ok("same tick labels, in the same order",
   axT.map(t => t.t).join(",") === scT.map(t => t.t).join(","),
   axT.map(t => t.t).join(",") + "  vs  " + scT.map(t => t.t).join(","));
ok("labels are 0k…80k", axT.map(t => t.t).join(",") === "0k,10k,20k,30k,40k,50k,60k,70k,80k",
   axT.map(t => t.t).join(","));
ok("every tick line at the same fraction of width",
   ticksOf(rAx()).length === ticksOf(rSc()).length &&
   ticksOf(rAx()).every((x, i) => near(x / AXW, ticksOf(rSc())[i] / SCW, 1e-9)),
   ticksOf(rAx()).length + " vs " + ticksOf(rSc()).length);
const axM = marksOf(rAx()), scM = marksOf(rSc());
ok("three marks, as the spectrum has", axM.length === 3 && scM.length === 3,
   axM.length + " vs " + scM.length);
ok("marks at the same fractions", axM.length === scM.length &&
   axM.every((m, i) => near(m.x / AXW, scM[i].x / SCW, 1e-9)),
   axM.map(m => (m.x / AXW).toFixed(4)).join(",") + " vs " + scM.map(m => (m.x / SCW).toFixed(4)).join(","));
ok("marks in the same colours", axM.map(m => m.c).join(",") === scM.map(m => m.c).join(","),
   axM.map(m => m.c).join(",") + " vs " + scM.map(m => m.c).join(","));
ok("marks at the same alpha", axM.length === scM.length && axM.every((m, i) => near(m.a, scM[i].a)),
   axM.map(m => m.a).join(",") + " vs " + scM.map(m => m.a).join(","));
ok("the amber mark is the 19 kHz one",
   near(axM[0].x / AXW, 19 / 80, 1e-9) && /f0a93b/i.test(axM[0].c), axM[0].c);
ok("the trace mark is the 57 kHz one",
   near(axM[2].x / AXW, 57 / 80, 1e-9) && /38e1d6/i.test(axM[2].c), axM[2].c);

group("3. edge labels pulled inboard — the one deliberate difference");
ok("scope centres its 0k label on x=0", near(scT[0].x, 0));
ok("axis places 0k at the left edge", near(axT[0].x, 0));
ok("axis places its last label at the right edge", near(axT[axT.length - 1].x, AXW));

group("4. GEOMETRY: the marks land on the columns the waterfall paints");
const brightest = (img) => {
  let best = -1, bx = -1;
  for (let x = 0; x < img.width; x++){
    const v = img.data[(x << 2)] + img.data[(x << 2) + 1] + img.data[(x << 2) + 2];
    if (v > best){ best = v; bx = x; }
  }
  return bx;
};
[[19000, 0], [38000, 1], [57000, 2]].forEach(([hz, mi]) => {
  const rw = recOf(mwf); if (rw) rw.reset();
  win.mpxwfPush(frameAt(192000, hz));
  const rw2 = recOf(mwf), img = rw2 && rw2.images[rw2.images.length - 1];
  if (!img) { ok((hz / 1000) + " kHz column", false, "no ImageData captured"); return; }
  const colFrac = brightest(img) / img.width, markFrac = axM[mi].x / AXW;
  ok((hz / 1000) + " kHz: painted column matches the drawn mark",
     Math.abs(colFrac - markFrac) < 0.002,
     "waterfall " + colFrac.toFixed(4) + " vs mark " + markFrac.toFixed(4));
});

group("5. a narrow composite: still parity, and 57k drops off when the spectrum drops it");
[120000, 100000].forEach(fs => {
  win.latest = frameAt(fs, null); win._mpxAxKey = "";
  rAx().reset(); rSc().reset();
  win.draw(); win.mpxDrawAxis();
  const a = marksOf(rAx()), c = marksOf(rSc());
  ok((fs / 1000) + " kHz: same number of marks as the spectrum", a.length === c.length,
     a.length + " vs " + c.length);
  ok((fs / 1000) + " kHz: same fractions",
     a.length === c.length && a.every((m, i) => near(m.x / AXW, c[i].x / SCW, 1e-9)));
  ok((fs / 1000) + " kHz: same labels",
     rAx().texts.map(t => t.t).join(",") === rSc().texts.map(t => t.t).join(","),
     rAx().texts.map(t => t.t).join(","));
});
ok("at 100 kHz the 57k mark is gone, not drawn off-canvas", marksOf(rAx()).length === 2,
   marksOf(rAx()).length + " marks");

group("6. falls back to rateHz before the first decoded frame, as the spectrum does");
win.latest = null; win.rateHz = 192000; win._mpxAxKey = "";
rAx().reset(); rSc().reset(); win.draw(); win.mpxDrawAxis();
ok("scale drawn from rateHz",
   rAx().texts.map(t => t.t).join(",") === "0k,10k,20k,30k,40k,50k,60k,70k,80k",
   rAx().texts.map(t => t.t).join(","));
ok("still parity with the spectrum",
   rAx().texts.map(t => t.t).join(",") === rSc().texts.map(t => t.t).join(","));

group("7. the rAF-rate caller does not repaint every frame");
rAx().reset();
for (let i = 0; i < 50; i++) win.mpxDrawAxis();
ok("50 further calls draw nothing", rAx().lines.length === 0 && rAx().texts.length === 0,
   rAx().lines.length + " lines");
win.latest = frameAt(120000, null);
win.mpxDrawAxis();
ok("a rate change does repaint", rAx().texts.length > 0);

group("8. outside map view the element has no width and nothing is drawn");
Object.defineProperty(axis, "clientWidth", { get: () => 0, configurable: true });
win._mpxAxKey = ""; rAx().reset();
for (let i = 0; i < 20; i++) win.mpxDrawAxis();
ok("zero-width: no strokes, no labels", rAx().lines.length === 0 && rAx().texts.length === 0);
Object.defineProperty(axis, "clientWidth", { get: () => AXW, configurable: true });

group("9. map view: every child of the ordered column has a unique, explicit order");
const wanted = { ".rds": 0, "#rfHead": 1, "#wfall": 2, "#wfaxis": 3, "#mpxwf": 5,
                 "#mpxaxis": 6, "#bmHead": 7, "#bmScroll": 8, "#bmFoot": 9 };
Object.keys(wanted).forEach(sel => {
  const re = new RegExp("body\\.bmap " + sel.replace(/[.#]/g, m => "\\" + m) + "\\{[^}]*order:(\\d+)");
  const m = cssText.match(re);
  ok("order " + wanted[sel] + " for " + sel, !!m && Number(m[1]) === wanted[sel], m ? "got " + m[1] : "no rule");
});
const orders = Object.values(wanted);
ok("no two elements share an order", new Set(orders).size === orders.length);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
