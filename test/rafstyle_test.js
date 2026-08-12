/* rafstyle_test.js — 0.11.0
 *
 * Defends the fix for the scanning freeze (FINDING-scan-freeze-rootcause-12-Aug-2026.md).
 *
 * THE FAULT, in one line: draw() read els.scope.clientWidth every frame; clientWidth is a forced
 * synchronous layout; the document was re-laid in full at ~25 ms a time, 505 times in 16 seconds;
 * the main thread saturated; and because Chrome dispatches WebSocket frames on that same thread,
 * the radio's audio and spectrum frames were never delivered. Users reported that as Bridge
 * freezing, and Bridge's own log reported it as SDRConnect having stopped sending.
 *
 * WHAT THIS SUITE CAN AND CANNOT DO. jsdom has no layout engine, so the COST of a layout is not
 * measurable here and never will be — that is a Chrome trace, recorded in the finding with the
 * machine named. What is measurable, and what actually regresses, is the COUNT: how many times the
 * loop reaches for a value it could have kept. So every check here counts calls against frames and
 * asserts the two do not scale together. A build that reintroduces the fault fails on the count
 * long before anyone notices the freeze.
 *
 * Note the suite installs a ResizeObserver stub, because jsdom has none and Chrome does. Without
 * one the cache deliberately reads through — that is the documented fallback, and group 3 drives a
 * second DOM without the stub to prove the fallback is still exact rather than merely absent.
 *
 * Usage: node rafstyle_test.js [path/to/index.html]
 */

process.env.TZ = "Australia/Adelaide";

const fs_ = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs_.readFileSync(FILE, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log("  FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
};
const group = (t) => console.log("\n" + t);

/* ── a canvas context that accepts everything and records nothing: this suite counts DOM reads,
      not strokes. ─────────────────────────────────────────────────────────────────────────── */
function stubCtx() {
  const noop = () => {};
  const c = {
    canvas: null, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    textBaseline: "", globalAlpha: 1, shadowColor: "", shadowBlur: 0,
    save: noop, restore: noop, setLineDash: noop, getLineDash: () => [],
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop,
    arc: noop, fillRect: noop, clearRect: noop, strokeRect: noop, translate: noop, scale: noop,
    rotate: noop, setTransform: noop, fillText: noop, strokeText: noop, drawImage: noop,
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createImageData: (w, h) => ({ width: w, height: h || 1, data: new Uint8ClampedArray(4 * w * (h || 1)) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(4 * w * h) }),
    putImageData: noop,
  };
  return c;
}

/* ── build a DOM.
   The size stubs and the ResizeObserver MUST be installed in beforeParse, not afterwards. The page
   runs its first frame during construction (pretendToBeVisual drives rAF), so a stub added after
   the fact arrives too late: the cache is already seeded with jsdom's 0, the observer never
   registered, and a "zero reads in 60 frames" check then passes for entirely the wrong reason.
   This bit the first draft of this suite. Sizes are therefore held in a map declared up here and
   read through a prototype getter that exists from the very first line the page runs.
   withRO=false exercises the documented no-ResizeObserver fallback. ─────────────────────────── */
function build(withRO, sizes) {
  const counts = { gcs: 0 };
  const ro = { instances: [] };
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "file:///rdsbridge/index.html",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx) { this.__ctx = stubCtx(); this.__ctx.canvas = this; }
        return this.__ctx;
      };
      w.URL.createObjectURL = () => "blob:stub";
      w.URL.revokeObjectURL = () => {};
      w.Worker = function () { this.postMessage = () => {}; this.terminate = () => {}; this.onmessage = null; };
      const realGCS = w.getComputedStyle.bind(w);
      w.getComputedStyle = function (el) { counts.gcs++; return realGCS(el); };
      Object.defineProperty(w.Element.prototype, "clientWidth", {
        get() { const r = sizes[this.id]; if (!r) return 0; r.reads++; return r.w; }, configurable: true });
      Object.defineProperty(w.Element.prototype, "clientHeight", {
        get() { const r = sizes[this.id]; if (!r) return 0; r.reads++; return r.h; }, configurable: true });
      if (withRO) {
        w.ResizeObserver = function (cb) {
          this._cb = cb; this._els = [];
          this.observe = (el) => { this._els.push(el); if (ro.instances.indexOf(this) < 0) ro.instances.push(this); };
          this.unobserve = () => {}; this.disconnect = () => {};
        };
      } else {
        delete w.ResizeObserver;
      }
    },
  });
  return { dom, win: dom.window, doc: dom.window.document, counts, ro };
}
/* Count writes to innerHTML without breaking it. */
function watchInnerHTML(win, el) {
  const d = Object.getOwnPropertyDescriptor(win.Element.prototype, "innerHTML");
  const rec = { writes: 0 };
  Object.defineProperty(el, "innerHTML", {
    get() { return d.get.call(el); },
    set(v) { rec.writes++; d.set.call(el, v); },
    configurable: true,
  });
  return rec;
}

const HB = 512;
const magFrame = (fs) => ({ mag: new Float32Array(HB).fill(-120), fs });

/* ════════════════════════════════════════════════════════════════════════════════════════════
   MAIN ARM — ResizeObserver present, as in Chrome.
   ════════════════════════════════════════════════════════════════════════════════════════ */
const sizesA = {
  scope:      { w: 800,  h: 170, reads: 0 },
  mpxaxis:    { w: 1000, h: 20,  reads: 0 },
  rdyConst:   { w: 104,  h: 104, reads: 0 },
  rdyPiSpark: { w: 300,  h: 34,  reads: 0 },
};
const A = build(true, sizesA);
const win = A.win, doc = A.doc;
const szScope = sizesA.scope;

group("0. the surfaces this suite depends on exist");
const scope = doc.getElementById("scope");
ok("#scope exists", !!scope);
ok("draw is a function", typeof win.draw === "function");
ok("frame is a function", typeof win.frame === "function");
ok("css is a function", typeof win.css === "function");
ok("elSize is a function — the size cache is present at all", typeof win.elSize === "function");
ok("monSideTxt is a function", typeof win.monSideTxt === "function");

if (typeof win.elSize !== "function" || !scope) {
  console.log("\nthe size cache is not present in this build — remaining groups skipped");
  console.log("\n" + pass + " passed, " + (fail + 1) + " failed");
  process.exit(1);
}

win.latest = magFrame(192000);
win.rateHz = 192000;

group("1. the element size is read once, not once per frame");
/* draw() at :3789 was 263 of the 505 layout flushes in the finding's 16-second trace — the single
   highest-value line in the fix. The claim is not "fewer reads"; it is "a number of reads that does
   not scale with frames". 60 frames is the point: at 60 fps this is one second of the loop. */
win.draw();                                   // first call may legitimately read, to seed the cache
const seed = szScope.reads;
szScope.reads = 0;
for (let i = 0; i < 60; i++) win.draw();
ok("60 further frames read the element size zero times", szScope.reads === 0, "reads=" + szScope.reads);
/* `seed` is every read on #scope since the page loaded, not just draw's: fit() legitimately reads
   width and height at init, and the cache seeds itself once. What must never be true is that this
   number grows with frames — so it is asserted as a small constant, and the check above is the one
   that actually discriminates. */
ok("reads since page load are a small constant, not a per-frame cost", seed <= 6, "seed=" + seed);
ok("draw still produced a frame (the cache is not simply returning nothing)",
   win.elSize(scope).w === 800 && win.elSize(scope).h === 170);

group("2. a real size change still reaches the loop");
/* A cache that never updates is a worse bug than the one it fixes: the canvas would silently paint
   at the wrong width forever. The ResizeObserver callback is the ONLY thing that may refresh it. */
szScope.w = 1200; szScope.h = 300;
szScope.reads = 0;
win.draw();
ok("a size change alone does NOT reach the loop (nothing re-read it)", szScope.reads === 0);
ok("...so the loop is still using the cached size", win.elSize(scope).w === 800);
const ro = A.ro.instances.find((i) => i._els.includes(scope));
ok("#scope is being observed", !!ro);
if (ro) {
  ro._cb([{ target: scope }]);
  ok("the observer callback updates the cached width", win.elSize(scope).w === 1200, "w=" + win.elSize(scope).w);
  ok("...and the cached height", win.elSize(scope).h === 300);
  szScope.reads = 0;
  for (let i = 0; i < 30; i++) win.draw();
  ok("and the loop goes back to reading nothing", szScope.reads === 0, "reads=" + szScope.reads);
}

group("3. design tokens are resolved once per theme, not once per frame");
/* css() is a getComputedStyle call and ran ~14x per frame across the draw functions. This is a
   STYLE-RECALC cost, not a layout one — it is not what produced the flushes, and the fix must not
   be credited with more than it does. It is still work repeated sixty times a second for a value
   that changes only when the theme does. */
A.counts.gcs = 0;
for (let i = 0; i < 60; i++) win.draw();
ok("60 frames resolve tokens a bounded number of times, not 60x", A.counts.gcs <= 8, "getComputedStyle=" + A.counts.gcs);
A.counts.gcs = 0;
for (let i = 0; i < 60; i++) win.draw();
ok("...and a second 60 frames resolve none at all", A.counts.gcs === 0, "getComputedStyle=" + A.counts.gcs);
const before = win.css("--trace");
A.counts.gcs = 0;
win.css("--trace"); win.css("--trace"); win.css("--trace");
ok("a repeated token read never re-resolves", A.counts.gcs === 0);
/* An UNDEFINED token resolves to "" — and "" is falsy, so a memo written `if(!c)` rather than
   `if(c===undefined)` would re-resolve it on every single call and cache nothing at all. That has to
   be tested against a token that genuinely does not exist: the first draft tested it against
   --trace, which jsdom resolves to a real value, so the check passed while the defect was live.
   A mutant flipping the test to `!c` survived because of it. */
const MISSING = "--no-such-token-rafstyle-test";
ok("a missing token resolves to the empty string", win.css(MISSING) === "", JSON.stringify(win.css(MISSING)));
A.counts.gcs = 0;
for (let i = 0; i < 20; i++) win.css(MISSING);
ok("an EMPTY token result is memoised too, not re-fetched on every call", A.counts.gcs === 0,
   "getComputedStyle=" + A.counts.gcs + ", value=" + JSON.stringify(before));

group("4. a theme change invalidates the tokens");
/* Keyed on the root class list rather than hooked to the two toggles, so a third toggle added later
   cannot silently serve stale colours. Both .light and .hc are root classes. */
doc.documentElement.classList.add("light");
A.counts.gcs = 0;
win.css("--trace");
ok("adding .light re-resolves", A.counts.gcs >= 1, "getComputedStyle=" + A.counts.gcs);
A.counts.gcs = 0; win.css("--trace");
ok("...once, then memoised again", A.counts.gcs === 0);
doc.documentElement.classList.add("hc");
A.counts.gcs = 0; win.css("--trace");
ok("adding .hc re-resolves as well", A.counts.gcs >= 1);
doc.documentElement.classList.remove("light"); doc.documentElement.classList.remove("hc");
A.counts.gcs = 0; win.css("--trace");
ok("removing them re-resolves", A.counts.gcs >= 1);

group("5. the AF chip list is rebuilt only when the AF set changes");
/* refresh() runs at 5/s and did afList.innerHTML="" then afOverflow(), which reads scrollWidth,
   clientWidth and scrollLeft — a write followed by a read in the same turn, which forces the
   pending layout to flush. The fix is the conditional rebuild; in steady state the write never
   happens, so there is nothing to flush. */
const afList = doc.getElementById("afList");
ok("#afList exists", !!afList);
if (afList && typeof win.refresh === "function") {
  const afw = watchInnerHTML(win, afList);
  const rds = (af) => ({
    pi: 0xC204, ps: "BBC R3", rt: "x", ct: "", pty: 10, af,
    good: 10, corr: 1, total: 20, groups: 5, pilotLock: 0.9, dataQ: 0.8, synced: true, sym: null,
  });
  win.latest = Object.assign(magFrame(192000), { rds: rds([89.1, 90.2]), rdsDb: 12 });
  try { win.refresh(); } catch (e) { ok("refresh() ran", false, e.message); }
  const firstWrites = afw.writes;
  ok("the first refresh builds the list", firstWrites >= 1, "writes=" + firstWrites);
  afw.writes = 0;
  for (let i = 0; i < 10; i++) { try { win.refresh(); } catch (e) {} }
  ok("ten further refreshes with an UNCHANGED AF set rebuild it zero times", afw.writes === 0, "writes=" + afw.writes);
  win.latest.rds = rds([89.1, 90.2, 104.9]);
  afw.writes = 0;
  try { win.refresh(); } catch (e) {}
  ok("a CHANGED AF set does rebuild", afw.writes >= 1, "writes=" + afw.writes);
  ok("...and renders every chip", afList.querySelectorAll(".chip").length === 3,
     "chips=" + afList.querySelectorAll(".chip").length);
  /* the trap: anything else that empties the list must invalidate the key, or an unchanged AF set
     would never repaint after a clear and the panel would sit permanently empty. */
  if (typeof win.clearRdsUI === "function") {
    win.clearRdsUI();
    afw.writes = 0;
    try { win.refresh(); } catch (e) {}
    ok("after clearRdsUI the SAME AF set is rebuilt, not skipped", afw.writes >= 1, "writes=" + afw.writes);
    ok("...and the chips are actually back", afList.querySelectorAll(".chip").length === 3);
  }
  /* an empty AF set is a state, not an absence: it must be distinguishable from "unknown" */
  win.latest.rds = rds([]);
  afw.writes = 0;
  try { win.refresh(); } catch (e) {}
  ok("dropping to an empty AF set clears the chips", afList.querySelectorAll(".chip").length === 0);
  afw.writes = 0;
  try { win.refresh(); } catch (e) {}
  ok("...and an unchanged empty set does not rebuild either", afw.writes === 0, "writes=" + afw.writes);
}

group("6. every canvas in the loop is cached, not just the spectrum");
/* #scope was the biggest single site but it was never the only one. mpxDrawAxis read clientWidth
   AHEAD of its own memo guard, so the guard saved the repaint and not the layout; drawConst and
   drawPiSpark are reached from refresh() at 5/s, immediately after update57k writes four
   style.width values — the same write-then-read pair as the AF list. Covering only #scope would
   let any of the three regress silently, and two mutants proved exactly that against the first
   draft of this suite. */
[["mpxaxis", () => win.mpxDrawAxis()],
 ["rdyConst", () => { try { win.drawConst(null); } catch (e) {} }]].forEach(([id, call]) => {
  const rec = sizesA[id];
  call();                        // seed
  rec.reads = 0;
  for (let i = 0; i < 60; i++) call();
  ok("#" + id + ": 60 calls read the element size zero times", rec.reads === 0, "reads=" + rec.reads);
});
if (typeof win.refresh === "function") {
  const spark = sizesA.rdyPiSpark;
  win.latest = Object.assign(magFrame(192000), {
    rds: { pi: 0xC204, ps: "BBC R3", rt: "x", ct: "", pty: 10, af: [89.1],
           good: 10, corr: 1, total: 20, groups: 5, pilotLock: 0.9, dataQ: 0.8, synced: true, sym: null },
    rdsDb: 12 });
  try { win.refresh(); } catch (e) {}
  spark.reads = 0;
  for (let i = 0; i < 30; i++) { try { win.refresh(); } catch (e) {} }
  ok("#rdyPiSpark: 30 refreshes read the element size zero times", spark.reads === 0, "reads=" + spark.reads);
}

group("7. the log stops blaming SDRConnect for Bridge's own starvation");
/* The old test was MON.rafS>=10. A renderer saturated by forced layout still turns in ~16 frames/s
   while receiving no audio at all (measured 12-Aug-2026), so the old threshold read "clean" in
   precisely the failure state and the log told users SDRplay had stopped sending. The detector is
   sound; the attribution was not. */
if (typeof win.monSideTxt === "function" && win.MON) {
  const say = (rafS, buf, hidden) => {
    win.MON.rafS = rafS; win.MON.buf = buf;
    Object.defineProperty(doc, "visibilityState", { get: () => (hidden ? "hidden" : "visible"), configurable: true });
    return win.monSideTxt();
  };
  const bad = say(16, 0, false);
  ok("at the measured failure rate it does NOT claim the frames are not being sent",
     !/not being sent to us/.test(bad), bad.slice(0, 90));
  ok("...it says the fault is more likely here", /\bHERE\b|not in SDRConnect/.test(bad), bad.slice(0, 120));
  ok("...and reports the rate it measured", /16 frames\/s/.test(bad));
  const good = say(60, 0, false);
  ok("at full rate with an empty buffer it may still draw the conclusion",
     /not being sent to us/.test(good), good.slice(0, 90));
  ok("the threshold sits above the measured failure mode", !/not being sent to us/.test(say(44, 0, false)));
  ok("...and admits a busy but healthy page", /not being sent to us/.test(say(45, 0, false)));
  ok("a queued outbound buffer is still reported as possibly ours", !/not being sent to us/.test(say(60, 4096, false)));
  ok("a hidden tab is not judged on its frame rate (rAF is throttled by design)",
     /not being sent to us/.test(say(0, 0, true)));
  Object.defineProperty(doc, "visibilityState", { get: () => "visible", configurable: true });
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   FALLBACK ARM — no ResizeObserver. The cache must degrade to exactly the old behaviour rather
   than to a stale value: a browser without the observer should be slow, never wrong.
   ════════════════════════════════════════════════════════════════════════════════════════ */
group("8. no layout property is animated");
/* The SECOND source of the freeze, found in the 12-Aug trace and missed by the original finding
   because it is not JavaScript: `.rdy-bar i` carried `transition:width`, and update57k writes four
   widths every 200 ms. width is a LAYOUT property, so each 180 ms transition re-laid the whole
   document — 9191 objects to move four 5-pixel bars — at ~36 layouts a second, with no JS stack to
   name it. transform and opacity are the only two properties a browser animates without layout.
   This check reads the stylesheet text because the effect is invisible to jsdom, which has no
   layout engine and no compositor. */
const styleTxt = Array.from(doc.querySelectorAll("style")).map((s2) => s2.textContent).join("\n");
const LAYOUT_PROPS = ["width", "height", "top", "left", "right", "bottom", "margin", "padding", "font-size", "flex", "inset"];
const transitions = (styleTxt.match(/transition:[^;}]+/g) || []);
ok("the stylesheet has transitions at all (the check is looking at something)", transitions.length > 0,
   "found=" + transitions.length);
const offenders = transitions.filter((t) => {
  const props = t.replace(/^transition:/, "").split(",").map((x) => x.trim().split(/\s+/)[0]);
  return props.some((pr) => LAYOUT_PROPS.indexOf(pr) >= 0);
});
ok("no transition animates a layout property", offenders.length === 0, offenders.join(" | "));
ok("the readiness bars animate transform instead", /\.rdy-bar i\{[^}]*transition:transform/.test(styleTxt));
ok("...scaled from the left edge, so the bar still grows rightwards",
   /\.rdy-bar i\{[^}]*transform-origin:0/.test(styleTxt));
ok("...and the track contains its own layout", /\.rdy-bar\{[^}]*contain:layout/.test(styleTxt));
ok("no @keyframes animation was introduced either", !/@keyframes/.test(styleTxt));
/* and the JS must write the property the CSS transitions, or the bars simply stop moving */
ok("update57k writes scaleX, not width", /rdyB0\.style\.transform="scaleX\(/.test(html));
ok("...and the reset does too", !/rdyB0,els\.rdyB1[\s\S]{0,120}style\.width/.test(html));
ok("no style.width write remains on any readiness bar", !/rdyB[0-3]\.style\.width/.test(html));

group("9. without ResizeObserver the size is read through, not cached stale");
const sizesB = { scope: { w: 640, h: 100, reads: 0 } };
const B = build(false, sizesB);
const scopeB = B.doc.getElementById("scope");
const szB = sizesB.scope;
if (scopeB && typeof B.win.elSize === "function") {
  ok("ResizeObserver really is absent in this arm", typeof B.win.ResizeObserver === "undefined");
  ok("the first read returns the live size", B.win.elSize(scopeB).w === 640);
  szB.w = 999;
  ok("a later size change is picked up, because it reads through", B.win.elSize(scopeB).w === 999,
     "w=" + B.win.elSize(scopeB).w);
  szB.reads = 0;
  for (let i = 0; i < 10; i++) B.win.elSize(scopeB);
  ok("...at the cost of reading every time, which is the documented trade", szB.reads > 0, "reads=" + szB.reads);
}
ok("a missing element never throws", (() => { try { return win.elSize(null).w === 0; } catch (e) { return false; } })());

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
