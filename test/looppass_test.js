/* looppass_test.js — 0.10.1 cand.1
   Covers the section loop's new behaviour: jittered pass starts, the shell-side pass ledger,
   and holding decoder-parameter changes to the pass boundary. Drives the real shell out of
   index.html under jsdom. No fixtures, runs in ~2 s.

   What this suite deliberately does NOT do: recompute the jitter formula and compare. That
   proves nothing (0.10.0's first axis test passed against a build with a deliberately wrong
   span for exactly that reason). It measures properties the formula must have — first lap
   unmoved, bounded by the section, reproducible, spread — and it measures what was actually
   POSTED to the worker and what was actually RENDERED into the ledger.

   Harness notes carried from the 0.10.0 session:
     - the shell is ONE script block: an unstubbed getContext() throws mid-block and every var
       initialiser after it silently never runs.  Stub canvas in beforeParse.
     - stub URL.createObjectURL or anything reaching startWorker() dies.

   Usage: node looppass_test.js [path/to/index.html]
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = process.argv[2] || path.join(__dirname, "work.html");
const html = fs.readFileSync(FILE, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  [" + extra + "]" : "")); }
};
const group = (t) => console.log("\n" + t);

/* ── boot the shell ─────────────────────────────────────────────────────────── */
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
      measureText(){ return { width: 10 }; }
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

group("0. shell parsed and the new surfaces are wired");
ok("lpJit checkbox present", !!doc.getElementById("lpJit"));
ok("lpLedger read-out present", !!doc.getElementById("lpLedger"));
ok("lpJit registered in els", !!(win.els && win.els.lpJit));
ok("lpLedger registered in els", !!(win.els && win.els.lpLedger));
["lpJitFrames", "lpJitMs", "lpNextStart", "lpDeferParam", "lpApplyPending",
 "lpRecordPass", "lpRender", "lpLedgerClear", "lpRunning"].forEach(fn => {
  ok("function " + fn + " defined", typeof win[fn] === "function");
});
ok("lpJit has an onchange handler", typeof (win.els.lpJit || {}).onchange === "function");

/* ── a loaded recording and a marked section ───────────────────────────────── */
const RATE = 250000;
function loadFixture(sectionSec) {
  win.fileMeta = { rate: RATE, frames: RATE * 600, dur: 600, bytesPerFrame: 4,
                   dataOffset: 44, startUTC: NaN, file: null, name: "fixture.wav" };
  win.lpFromF = RATE * 100;
  win.lpToF   = RATE * (100 + sectionSec);
  win.lpPass  = 0;
  win.lpLedgerClear();
}

group("1. jitter: the first lap is exactly the section the operator marked");
loadFixture(10);
win.els.lpJit.checked = true;
ok("lap 0 offset is zero", win.lpJitFrames(0) === 0, String(win.lpJitFrames(0)));
ok("lpNextStart from lap 0 lands past the marker",
   (win.lpPass = 0, win.lpNextStart()) > win.lpFromF);

group("2. jitter is bounded by the section, not by a constant");
{
  /* short section: the 8% rule must bind, not the 400 ms ceiling */
  loadFixture(2);                                   // 8% of 2 s = 160 ms
  let maxShort = 0;
  for (let p = 0; p < 60; p++) maxShort = Math.max(maxShort, win.lpJitFrames(p));
  ok("2 s section: no lap starts more than 8% in",
     maxShort <= Math.ceil(0.08 * 2 * RATE), "max=" + maxShort + " frames");
  ok("2 s section: jitter is smaller than the 400 ms ceiling",
     maxShort < 0.400 * RATE, "max=" + maxShort);

  /* long section: the 400 ms ceiling must bind, not 8% */
  loadFixture(60);                                  // 8% of 60 s = 4.8 s, way too far
  let maxLong = 0;
  for (let p = 0; p < 60; p++) maxLong = Math.max(maxLong, win.lpJitFrames(p));
  ok("60 s section: no lap starts more than 400 ms in",
     maxLong <= Math.ceil(0.400 * RATE), "max=" + maxLong + " frames");
  ok("60 s section: jitter is well short of 8%",
     maxLong < 0.08 * 60 * RATE, "max=" + maxLong);

  /* and it can never run past the far marker */
  let overrun = 0;
  for (let p = 0; p < 200; p++) if (win.lpFromF + win.lpJitFrames(p) >= win.lpToF) overrun++;
  ok("no lap start ever reaches the loop end", overrun === 0, "overruns=" + overrun);
}

group("3. jitter actually spreads, and is reproducible");
{
  loadFixture(10);
  const runA = [], runB = [];
  for (let p = 0; p < 24; p++) runA.push(win.lpJitFrames(p));
  for (let p = 0; p < 24; p++) runB.push(win.lpJitFrames(p));
  ok("two runs give the same alignments", runA.join(",") === runB.join(","));
  const distinct = new Set(runA.slice(1)).size;
  ok("23 laps give 23 distinct alignments", distinct === 23, "distinct=" + distinct);
  /* spread: the window split into quarters should all be visited, or the laps are clustered
     and "7 of 9" would be counting near-duplicates */
  const span = Math.max(...runA);
  const quarters = new Set(runA.slice(1).map(v => Math.min(3, Math.floor(v / (span / 4) ))));
  ok("all four quarters of the jitter window are visited", quarters.size === 4,
     "quarters=" + [...quarters].sort().join(","));
}

group("4. jitter off means every lap is identical");
{
  loadFixture(10);
  win.els.lpJit.checked = false;
  let nz = 0;
  for (let p = 0; p < 30; p++) if (win.lpJitFrames(p) !== 0) nz++;
  ok("no lap is offset with jitter off", nz === 0, "nonzero=" + nz);
  win.els.lpJit.checked = true;
}

/* ── deferred parameters ───────────────────────────────────────────────────── */
let posted = [];
function armWorker() { posted = []; win.worker = { postMessage: (m) => posted.push(m) }; }
function setRunning(on) {
  win.playing = on; win.paused = false; win.sourceMode = "file";
}

group("5. lpRunning only reports a loop that is genuinely running");
loadFixture(10); armWorker();
setRunning(false);
ok("stopped → not running", win.lpRunning() === false);
setRunning(true);
ok("playing a marked section → running", win.lpRunning() === true);
win.paused = true;
ok("paused → not running", win.lpRunning() === false);
win.paused = false;
win.sourceMode = "sdr";
ok("live SDR → not running (loop is file-lane only)", win.lpRunning() === false);
win.sourceMode = "file";
win.lpToF = null;
ok("no section marked → not running", win.lpRunning() === false);
win.lpToF = RATE * 110;

group("6. a parameter change outside a loop goes straight through");
loadFixture(10); armWorker(); setRunning(false);
ok("lpDeferParam declines to hold it", win.lpDeferParam("bandwidth", 160000, "bandwidth") === false);
ok("nothing was queued", win.lpPend.length === 0);
/* and the real control still posts: drive the actual handler */
win.els.bwSel.value = "160000";
win.els.bwSel.onchange();
ok("bandwidth handler posted to the worker",
   posted.filter(m => m.type === "bandwidth").length === 1,
   JSON.stringify(posted));

group("7. a parameter change DURING a loop is held, not sent");
loadFixture(10); armWorker(); setRunning(true);
win.els.bwSel.value = "180000";
win.els.bwSel.onchange();
ok("nothing reached the worker", posted.length === 0, JSON.stringify(posted));
ok("one change is queued", win.lpPend.length === 1, JSON.stringify(win.lpPend));
ok("queued change is the bandwidth", win.lpPend[0].type === "bandwidth" && win.lpPend[0].v === 180000);
ok("ledger shows the queued change",
   /queued for the next pass/.test(win.els.lpLedger.innerHTML));

group("8. the other three rebuild()-causing controls are held too");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.els.burstSel.value = win.els.burstSel.options[win.els.burstSel.options.length - 1].value;
  win.els.burstSel.onchange();
  win.els.mfSel.value = "1"; win.els.mfSel.onchange();
  win.els.gearSel.value = "0"; win.els.gearSel.onchange();
  ok("nothing reached the worker", posted.length === 0, JSON.stringify(posted));
  const types = win.lpPend.map(q => q.type).sort().join(",");
  ok("burst, mf and sync are all queued", types === "burst,mf,sync", types);
}

group("9. acquisition and the PI guard are NOT held — they do not rebuild the decoder");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.els.acqSel.value = "0"; win.els.acqSel.onchange();
  ok("acquisition posted immediately", posted.filter(m => m.type === "nda").length === 1,
     JSON.stringify(posted));
  ok("acquisition was not queued", win.lpPend.filter(q => q.type === "nda").length === 0);
}

group("10. last write wins per parameter — a slider drag is one change, not ten");
{
  loadFixture(10); armWorker(); setRunning(true);
  [140000, 150000, 160000, 170000].forEach(v => { win.els.bwSel.value = String(v); win.els.bwSel.onchange(); });
  ok("still one queued bandwidth", win.lpPend.filter(q => q.type === "bandwidth").length === 1,
     JSON.stringify(win.lpPend));
  ok("it is the last value", win.lpPend.filter(q => q.type === "bandwidth")[0].v === 170000);
}

group("11. lpApplyPending posts what was queued, exactly once, then empties");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.els.bwSel.value = "160000"; win.els.bwSel.onchange();
  win.els.mfSel.value = "1"; win.els.mfSel.onchange();
  ok("two queued, nothing posted", win.lpPend.length === 2 && posted.length === 0);
  win.lpApplyPending();
  ok("both posted", posted.length === 2, JSON.stringify(posted));
  ok("bandwidth carried its value", posted.some(m => m.type === "bandwidth" && m.v === 160000));
  ok("queue is empty", win.lpPend.length === 0);
  win.lpApplyPending();
  ok("a second apply posts nothing", posted.length === 2, JSON.stringify(posted));
}

/* ── the ledger ────────────────────────────────────────────────────────────── */
function fakePass(rds) {
  win.latest = rds ? { type: "frame", rds: rds } : null;
  win.lpRecordPass();
  win.lpPass++;                       // playFile does this via lpNextStart()
}
const RDS = (pi, committed, votes, ps) => ({
  pi: committed ? pi : null, piRaw: pi, piVotes: votes || 0, ps: ps || "",
  good: 10, corr: 3, bad: 2
});

group("12. the ledger counts laps, and counts only laps");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.els.bwSel.value = "160000";
  fakePass(RDS(0xC202, true, 12));
  fakePass(RDS(0xC202, true, 9));
  fakePass(null);
  fakePass(RDS(0x730F, false, 1));
  fakePass(RDS(0xC202, true, 11));
  ok("five rows recorded", win.lpLedger.length === 5, "n=" + win.lpLedger.length);
  const h = win.els.lpLedger.innerHTML;
  ok("ledger is visible", win.els.lpLedger.style.display === "block");
  ok("genuine PI reported as 3 of 5", /0xC202[\s\S]*?3 of 5/.test(h), h.slice(0, 400));
  ok("one-off PI reported as 1 of 5", /0x730F[\s\S]*?1 of 5/.test(h));
  ok("one-off PI marked as never committed",
     /0x730F[\s\S]*?never committed/.test(h));
  /* read the rows individually — a lazy regex across the whole block would happily match the
     "hit" class on one row and the PI on the next, and report a pass that means nothing */
  const rowOf = (pi) => (h.match(/<div class="lpl-r[^"]*"[\s\S]*?<\/div>\s*(?=<div class="lpl-|<div class="lpl-l|$)/g) || [])
                          .find(r => r.indexOf(pi) >= 0) || "";
  ok("repeated PI carries the 'hit' emphasis", /class="lpl-r hit"/.test(rowOf("0xC202")), rowOf("0xC202"));
  ok("one-off PI does NOT carry it", !/class="lpl-r hit"/.test(rowOf("0x730F")), rowOf("0x730F"));
  ok("best vote count is the max seen, not a sum", /best 12 votes/.test(h) && !/best 32 votes/.test(h));
  ok("pass count stated", /5 passes/.test(h));
}

group("13. PS is printed per pass and never merged across passes");
{
  loadFixture(10); armWorker(); setRunning(true);
  fakePass(RDS(0xC202, true, 5, "  ST"));
  fakePass(RDS(0xC202, true, 6, "TE  FM"));
  fakePass(RDS(0xC202, true, 7, "  ST"));
  const h = win.els.lpLedger.innerHTML;
  ok("each pass's own PS appears", h.indexOf("  ST") >= 0 && h.indexOf("TE  FM") >= 0);
  /* the merged string a per-character majority would have produced */
  ok("no merged/synthesised PS", h.indexOf("TEST") < 0 && h.indexOf("TESTFM") < 0, h.slice(0, 600));
  ok("no per-character vote counts rendered", !/char|majority/i.test(h));
}

group("14. ledger rows record the settings in force for that lap");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.els.bwSel.value = "160000"; fakePass(RDS(0xC202, true, 8));
  win.els.bwSel.value = "205000"; fakePass(RDS(0xC202, true, 4));
  ok("row 1 recorded 160 kHz", win.lpLedger[0].bw === 160000, String(win.lpLedger[0].bw));
  ok("row 2 recorded 205 kHz", win.lpLedger[1].bw === 205000, String(win.lpLedger[1].bw));
  ok("summary lists both bandwidths", /160\/205 kHz/.test(win.els.lpLedger.innerHTML),
     win.els.lpLedger.innerHTML.slice(0, 400));
}

group("15. PS is escaped, not injected");
{
  loadFixture(10); armWorker(); setRunning(true);
  fakePass(RDS(0xC202, true, 5, "<b>x</b>"));
  const h = win.els.lpLedger.innerHTML;
  ok("no live tag from PS", h.indexOf("<b>x</b>") < 0);
  ok("escaped form present", h.indexOf("&lt;b&gt;") >= 0, h.slice(0, 600));
}

group("16. moving the section, clearing it, or restarting the loop empties the tally");
{
  loadFixture(10); armWorker(); setRunning(true);
  fakePass(RDS(0xC202, true, 9));
  ok("one row before", win.lpLedger.length === 1);
  win.playHead = RATE * 105;
  win.lpSet("a");
  ok("moving a marker clears the tally", win.lpLedger.length === 0, "n=" + win.lpLedger.length);

  fakePass(RDS(0xC202, true, 9));
  win.lpReset();
  ok("clearing the loop clears the tally", win.lpLedger.length === 0);
  ok("ledger hidden when empty", win.els.lpLedger.style.display === "none");

  loadFixture(10);
  fakePass(RDS(0xC202, true, 9));
  win.transportSeek = () => {};
  win.playFile = () => {};
  win.playing = false;
  win.lpPlayLoop();
  ok("play loop starts a fresh tally", win.lpLedger.length === 0, "n=" + win.lpLedger.length);
  ok("pass counter reset", win.lpPass === 0, "pass=" + win.lpPass);
}

group("17. jitter-off is stated in the ledger, so a meaningless tally says so");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.els.lpJit.checked = false;
  fakePass(RDS(0xC202, true, 9));
  ok("ledger warns that passes are identical",
     /NOT jittered/.test(win.els.lpLedger.innerHTML), win.els.lpLedger.innerHTML.slice(0, 200));
  win.els.lpJit.checked = true;
  win.lpRender();
  ok("and says jittered when it is", /jittered/.test(win.els.lpLedger.innerHTML) &&
     !/NOT jittered/.test(win.els.lpLedger.innerHTML));
}

group("18. the ledger does not grow without bound");
{
  loadFixture(10); armWorker(); setRunning(true);
  for (let i = 0; i < 260; i++) fakePass(RDS(0xC202, true, 3));
  ok("row store is capped", win.lpLedger.length <= 200, "n=" + win.lpLedger.length);
  const rows = (win.els.lpLedger.innerHTML.match(/<div>#/g) || []).length;
  ok("per-pass list is windowed, not fully rendered", rows <= 12, "rendered=" + rows);
}

/* ── the reported layout bug ───────────────────────────────────────────────── */
group("19. band-map layout: the map no longer shares the column");
{
  /* jsdom has no layout, so this reads what the stylesheet DECLARES. It cannot prove the map is
     tall on screen — that is a bench check — but it does stop the fix being undone. */
  const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g).join("\n");
  /* a selector can appear in more than one rule (body.bmap #bmScroll{display:block} is a separate
     one), so collect EVERY declaration block for it rather than the first */
  const declsFor = (sel) => {
    const re = new RegExp(sel.replace(/[.#*+?^$(){}|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}", "g");
    let m, all = [];
    while ((m = re.exec(css)) !== null) all.push(m[1]);
    return all.join(";");
  };
  const dx = declsFor("body.bmap .dxlog");
  ok("body.bmap .dxlog rule found", dx.length > 0);
  ok("DX log is not rendered in the map view", /display:\s*none/.test(dx), dx);
  ok("no leftover flex ratio fighting the map", !/flex:/.test(dx), dx);

  const map = declsFor("body.bmap #bmScroll");
  ok("body.bmap #bmScroll rule found", map.length > 0);
  ok("map shrinks to fit the column", /flex:\s*0 1 auto/.test(map), map);
  ok("map no longer capped at a fraction of the viewport", !/max-height:\s*[\d.]+vh/.test(map), map);
  /* the generic #bmScroll rule caps at calc(100vh - 220px), which assumes 220 px of chrome above
     the map and is wrong by ~400 px in this view — it has to be cleared, or bmFit's measurement
     is overridden by a guess */
  ok("the generic viewport cap is cleared in this view", /max-height:\s*none/.test(map), map);
  const mn = parseFloat((map.match(/min-height:\s*([\d.]+)px/) || [])[1] || "0");
  ok("map keeps a floor", mn >= 120, "min-height:" + mn + "px");
}

group("20. the DX log has a view of its own, reachable from every mode");
{
  const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g).join("\n");
  ok("dxlog is a registered view", (win.VIEWS || []).indexOf("dxlog") >= 0,
     JSON.stringify(win.VIEWS));
  const btn = doc.querySelector('[data-view="dxlog"]');
  ok("view selector carries a dx log button", !!btn);
  ok("the button sits with the other views, not somewhere new",
     !!btn && btn.parentElement === doc.getElementById("viewSel"));

  win.setView("dxlog");
  ok("setView('dxlog') puts the body in the view", doc.body.classList.contains("dxv"));
  ok("and drops the band-map view", !doc.body.classList.contains("bmap"));
  ok("selector marks it current", !!btn && btn.classList.contains("on"));

  /* the log list must be released from the 188 px cap it carries globally, or the new view
     shows a full-height panel with a short list and dead space under it */
  const gl = (css.match(/\.dxlist\{([^}]*)\}/) || [])[1] || "";
  ok("global .dxlist is capped (unchanged)", /max-height:\s*188px/.test(gl), gl);
  const dv = (css.match(/body\.dxv \.dxlog \.dxlist\{([^}]*)\}/) || [])[1] || "";
  ok("the view releases the cap", /max-height:\s*none/.test(dv), dv);
  ok("and scrolls inside itself", /overflow:\s*auto/.test(dv), dv);
  ok("the panel fills the column", /body\.dxv \.dxlog\{[^}]*flex:1 1 auto/.test(css));
  ok("the left control column is hidden", /body\.dxv main>\.col:first-child\{display:none\}/.test(css));

  /* Not persisted: it is a monitoring view, like compact and essentials, and the app must always
     reopen somewhere with the connect controls. Asserted against the source, not against
     localStorage — jsdom serves this page from file://, an opaque origin, so every localStorage
     access in the shell throws into its own try/catch and a read here is inert. A mutant that
     added "dxlog" to the persisted list passed the localStorage version of this check. */
  const persistLine = (html.match(/localStorage\.setItem\("rdsb\.view"[^\n]*/) || [""])[0];
  const persistCond = (html.match(/if\(([^)]*)\)\{ try\{ localStorage\.setItem\("rdsb\.view"/) || ["", ""])[1];
  ok("the persisted-view branch was found", persistLine.length > 0);
  ok("dxlog is not in the persisted-view list", persistCond.indexOf("dxlog") < 0, persistCond);
  ok("normal and advanced still are", /normal/.test(persistCond) && /advanced/.test(persistCond), persistCond);
  win.setView("normal");
}

group("21. the map footer link survives the hint being rewritten");
{
  const goto = doc.getElementById("dxGoto");
  ok("dxGoto button present", !!goto);
  ok("dxGoto is registered in els", !!(win.els && win.els.dxGoto));
  ok("dxGoto has a click handler", typeof (win.els.dxGoto || {}).onclick === "function");
  /* bmHint.innerHTML is reassigned from JS on every source change — a button INSIDE it would be
     destroyed on the first switch and silently stop existing. It must be a sibling. */
  ok("dxGoto is outside #bmHint", !!goto && !doc.getElementById("bmHint").contains(goto));
  win.bmSourceSync();
  win.bmSourceSync();
  const after = doc.getElementById("dxGoto");
  ok("still in the DOM after the hint is rewritten twice", !!after);
  ok("still the same element, so its handler is intact", after === goto);
  ok("still wired", typeof after.onclick === "function");
  after.onclick();
  ok("clicking it opens the DX log view", doc.body.classList.contains("dxv"));
  win.setView("normal");
}

group("22. the map is sized from a measurement, not a viewport fraction");
{
  /* jsdom has no layout, so give it one: define the heights the browser would report and check
     what bmFit() actually WRITES. The assertion is the invariant — everything in the column adds
     up to the column — not a restatement of the subtraction inside bmFit. */
  const el = doc.getElementById("bmScroll");
  const col = el.parentNode;
  let colH = 2160;                                  // 4K, full height, 100% scaling
  Object.defineProperty(col, "clientHeight", { get: () => colH, configurable: true });
  const kids = Array.from(col.children).filter(c => c !== el);
  let footH = 40;
  kids.forEach(c => Object.defineProperty(c, "offsetHeight", {
    get: () => (c.id === "bmFoot" ? footH : 75), configurable: true
  }));
  const sibs = () => kids.reduce((a, c) => a + c.offsetHeight, 0);

  win.setView("map");
  win.bmFit();
  const h4k = parseFloat(el.style.maxHeight);
  ok("an explicit pixel height is written", el.style.maxHeight.slice(-2) === "px", el.style.maxHeight);
  ok("map + everything else fits the column", h4k + sibs() <= colH, h4k + "+" + sibs() + " vs " + colH);
  ok("and fills it — no wasted band", h4k + sibs() >= colH - 4, h4k + "+" + sibs() + " vs " + colH);
  ok("on 4K that is far more than the old 38vh", h4k > 0.38 * colH, h4k + "px vs " + (0.38 * colH));

  /* the same code on a laptop must not hand out more than there is */
  colH = 900;
  win.bmFit();
  const hLap = parseFloat(el.style.maxHeight);
  ok("laptop: never exceeds the column", hLap + sibs() <= Math.max(colH, sibs() + 160),
     hLap + "+" + sibs() + " vs " + colH);
  ok("laptop: keeps the 160 px floor", hLap >= 160, String(hLap));
  ok("a fixed vh fraction could not have produced both",
     Math.abs(h4k / 2160 - hLap / 900) > 0.05,
     (h4k / 2160).toFixed(3) + " vs " + (hLap / 900).toFixed(3));

  /* the footer hint rewraps per source; the map has to give the space back */
  colH = 2160; win.bmFit();
  const before = parseFloat(el.style.maxHeight);
  footH = 120; win.bmFit();
  const after = parseFloat(el.style.maxHeight);
  ok("a taller footer takes height off the map", after < before, before + " -> " + after);
  ok("and exactly that much", Math.abs((before - after) - 80) < 2, before + " -> " + after);
  footH = 40;

  /* before layout, leave the CSS fallback alone rather than writing a nonsense value */
  colH = 0; el.style.maxHeight = "";
  win.bmFit();
  ok("unlaid-out column writes nothing", el.style.maxHeight === "", el.style.maxHeight);
  colH = 2160;

  /* and it must not leak into the other views */
  win.bmFit();
  ok("sized while in the map view", el.style.maxHeight !== "");
  win.setView("normal");
  win.bmFit();
  ok("cleared on leaving the map view", el.style.maxHeight === "", el.style.maxHeight);
  win.setView("normal");
}

group("23. the loop tally is repeated into the map footer");
{
  const m = doc.getElementById("bmLoop");
  ok("bmLoop present in the map footer", !!m);
  ok("bmLoop is inside #bmFoot", !!m && doc.getElementById("bmFoot").contains(m));
  ok("bmLoop is registered in els", !!(win.els && win.els.bmLoop));

  loadFixture(10); armWorker(); setRunning(true);
  ok("hidden with no passes", m.style.display === "none", m.style.display);
  fakePass(RDS(0xC202, true, 9));
  fakePass(RDS(0xC202, true, 7));
  fakePass(null);
  ok("shown once there are passes", m.style.display !== "none");
  ok("states the pass count", /3 passes/.test(m.textContent), m.textContent);
  ok("states the leading PI and how many laps carried it", /0xC202 in 2 of 3/.test(m.textContent),
     m.textContent);
  win.lpLedgerClear();
  ok("hidden again when the tally is cleared", m.style.display === "none", m.style.display);

  /* it must survive the footer hint being rewritten, same trap as dxGoto */
  fakePass(RDS(0xC202, true, 9));
  win.bmSourceSync();
  const after = doc.getElementById("bmLoop");
  ok("still the same element after bmSourceSync", after === m);
  ok("still showing its tally", /1 pass/.test(after.textContent), after.textContent);
}

group("24. the full-height views stop the document scrolling");
{
  /* The container overhang, asserted from the stylesheet. jsdom cannot lay it out, but it can
     confirm the two declarations that make the overhang impossible: the body is pinned to the
     viewport, and the column is a percentage of its parent rather than a fresh 100vh started
     part-way down the page. This is the check that would have caught three candidates of
     resizing the contents of a box that was itself hanging off the bottom. */
  const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g).join("\n");
  const declsFor = (sel) => {
    const re = new RegExp(sel.replace(/[.#*+?^$(){}|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}", "g");
    let m, all = []; while ((m = re.exec(css)) !== null) all.push(m[1]);
    return all.join(";");
  };
  const bodyRule = declsFor("body.bmap,body.dxv");
  ok("both full-height views pin the body to the viewport", /height:\s*100vh/.test(bodyRule), bodyRule);
  ok("and stop the document scrolling", /overflow:\s*hidden/.test(bodyRule), bodyRule);

  const bm = declsFor("body.bmap .right");
  ok("map column is a percentage of its parent, not a fresh 100vh",
     /height:\s*100%/.test(bm) && !/height:\s*100vh/.test(bm), bm);
  ok("map column no longer needs sticky", !/position:\s*sticky/.test(bm), bm);
  const dv = declsFor("body.dxv .right");
  ok("dx log column is a percentage too",
     /height:\s*100%/.test(dv) && !/height:\s*100vh/.test(dv), dv);

  /* body{min-height:100%} is what made a 100vh child overhang; it must still be the base rule,
     because every OTHER view relies on the page scrolling */
  const base = declsFor("body");
  ok("the base body rule still lets other views scroll", /min-height:\s*100%/.test(base), base);
}

group("25. bmFit reports what it measured");
{
  /* A layout fix nobody can verify from a screenshot has to state its numbers. */
  ok("bmFit logs a fit line", /map fit \\u2014 column/.test(html) || /map fit — column/.test(html));
  ok("it reports the column bottom against the window",
     /column bottom/.test(html) && /window\.innerHeight/.test(html));
  ok("and calls an overhang an error, not an event",
     /log\(over \? "err" : "ev"/.test(html));
  ok("the report is armed on entering the view, not on every frame",
     /_bmFitSay = true;/.test(html) && /_bmFitSay = false;/.test(html));
}

group("26. the hunt: the picture accumulates fields, never confidence");
{
  loadFixture(10); armWorker(); setRunning(true);
  ok("hunt panel present", !!doc.getElementById("huntPanel"));
  ["lpPicAdd","lpPicClear","lpTier","lpPicPs","lpPicPsText","lpHuntRender","lpLogCatch",
   "lpSweepApply","lpSweepRestore","lpCfgKey"].forEach(fn =>
    ok("function " + fn + " defined", typeof win[fn] === "function"));

  /* nothing in the picture may write to a decoder-reported number */
  const src = html.slice(html.indexOf("function lpPicAdd"), html.indexOf("function lpTop"));
  ok("lpPicAdd never assigns piVotes", !/piVotes\s*=/.test(src), src.slice(0, 200));
  ok("lpPicAdd never assigns dominance", !/dominance\s*=/.test(src));
  ok("lpPicAdd posts nothing to the worker", src.indexOf("postMessage") < 0);
}

group("27. support tiers: repetition alone is not confirmation");
{
  loadFixture(10); armWorker(); setRunning(true);
  ok("one lap is thin", win.lpTier({ n: 1, cfg: { a: 1 } }) === "t");
  ok("two laps, one config is weak, not firm", win.lpTier({ n: 2, cfg: { a: 1 } }) === "w");
  ok("five laps, one config is STILL not firm", win.lpTier({ n: 5, cfg: { a: 1 } }) === "w",
     win.lpTier({ n: 5, cfg: { a: 1 } }));
  ok("three laps under two configs is firm", win.lpTier({ n: 3, cfg: { a: 1, b: 1 } }) === "f");
  ok("nothing seen is a gap", win.lpTier(null) === "n");
}

group("28. the PS fabrication case from this session's own measurement");
{
  /* Reproduces the shape of the failure the off-hardware test found: a character not in the signal
     that survived two jittered laps. Under ONE configuration it must never render as firm, and it
     must never be written into a logged name as if it were established. */
  win.lpPicClear();
  win.lpPicAdd(RDS(0xC202, true, 9, "  ST  \""), "160/2/0/1");
  win.lpPicAdd(RDS(0xC202, true, 8, "  ST  \""), "160/2/0/1");
  win.lpPicAdd(RDS(0xC202, true, 7, "  ST"),     "160/2/0/1");
  const cs = win.lpPicPs();
  ok("the twice-seen spurious char is not firm", cs[6].tier !== "f", JSON.stringify(cs[6]));
  ok("the thrice-seen genuine chars ARE weak at best under one config",
     cs[2].tier === "w" && cs[3].tier === "w", cs[2].tier + "," + cs[3].tier);

  /* add configuration diversity and the genuine characters, and only those, get promoted */
  win.lpPicAdd(RDS(0xC202, true, 11, "  ST"), "205/2/0/1");
  win.lpPicAdd(RDS(0xC202, true, 10, "  ST"), "180/2/0/1");
  const cs2 = win.lpPicPs();
  ok("genuine chars promoted once configs differ", cs2[2].tier === "f" && cs2[3].tier === "f",
     cs2[2].tier + "," + cs2[3].tier);
  ok("spurious char still not promoted", cs2[6].tier !== "f", JSON.stringify(cs2[6]));

  /* the logged name must carry FIRM positions only. Weak is two laps under one configuration —
     the measured fabrication case — and must be visible to the operator but never written down. */
  const txt = win.lpPicPsText();
  ok("logged name carries the firm characters", txt.indexOf("ST") >= 0, JSON.stringify(txt));
  ok("the twice-seen spurious char is NOT in the logged name", txt.indexOf('"') < 0, JSON.stringify(txt));
  ok("no punctuation smuggled in at all", !/[^\sA-Za-z0-9.\-&+']/.test(txt), JSON.stringify(txt));
  ok("unread positions are a gap in the panel, not a space",
     win.lpPicPs()[7].ch === null, JSON.stringify(win.lpPicPs()[7]));
}

group("29. the picture is never an automatic commit source");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.dxLog.length = 0;
  win.lpLedgerClear();
  const before = win.dxLog.length;
  /* drive the REAL lap boundary path, not lpPicAdd directly — a mutant that made lpRecordPass
     call lpLogCatch() passed a version of this check that only exercised the accumulator */
  [160000, 180000, 205000, 140000, 160000, 180000, 205000, 140000].forEach(bw => {
    win.els.bwSel.value = String(bw);
    fakePass(RDS(0xC202, true, 12, "TESTFM"));
  });
  ok("eight laps recorded", win.lpPic.laps === 8, "laps=" + win.lpPic.laps);
  ok("the picture is firm on the PI", win.lpTier(win.lpPic.pi[0xC202]) === "f");
  ok("eight strong laps log nothing by themselves", win.dxLog.length === before,
     "n=" + win.dxLog.length);
  ok("the log button is the only route", typeof win.els.huntLog.onclick === "function");

  /* commitCatch — the automatic path — must not have learned about the picture */
  const cc = html.slice(html.indexOf("function commitCatch"), html.indexOf("function updateCatch"));
  ok("commitCatch does not read lpPic", cc.indexOf("lpPic") < 0);
  ok("commitCatch stamps no hunt marker", cc.indexOf("hunt") < 0);
}

group("30. log this catch: gated, stamped, and single-pass conditions");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.dxLog.length = 0; win.lpPicClear();
  win.targetHz = 89.8e6;
  win.lastSnr = 17.3;

  win.lpPicAdd(RDS(0x730F, false, 1, ""), "160/2/0/1");
  win.lpHuntRender();
  ok("one lap, one PI: button disabled", win.els.huntLog.disabled === true);
  win.els.huntLog.onclick();
  ok("and pressing it anyway logs nothing", win.dxLog.length === 0, "n=" + win.dxLog.length);

  /* two independent laps on the same PI is the floor */
  win.lpPicClear();
  const strong = RDS(0xC202, true, 14, "TESTFM"); strong.pilotLock = 0.93; strong.dataQ = 0.71;
  const weak   = RDS(0xC202, true, 4,  "TE");     weak.pilotLock = 0.40; weak.dataQ = 0.20;
  win.lpPicAdd(weak,   "205/2/0/1");
  win.lpPicAdd(strong, "160/2/0/1");
  win.lpPicAdd(strong, "180/2/0/1");
  win.lpHuntRender();
  ok("button enabled at two-plus laps", win.els.huntLog.disabled === false);
  win.els.huntLog.onclick();
  ok("one entry logged", win.dxLog.length === 1, "n=" + win.dxLog.length);
  const e = win.dxLog[0];
  ok("PI is the leader", e.pi === 0xC202, String(e.pi));
  ok("entry is stamped as a hunt", !!e.hunt, JSON.stringify(e.hunt));
  ok("stamp records laps and configs", e.hunt.piLaps === 3 && e.hunt.laps === 3 && e.hunt.piCfgs === 3,
     JSON.stringify(e.hunt));
  /* the conditions must be ONE pass's, not an average of three — an average is a number no
     observation ever produced */
  ok("pilot is the strongest pass's, not a mean", e.pilot === 93, String(e.pilot));
  ok("dataQ is the strongest pass's, not a mean", e.dataQ === 71, String(e.dataQ));
  ok("SNR recorded", e.snr === 17.3, String(e.snr));
  ok("frequency recorded", e.freq === "89.8", String(e.freq));

  /* and the row says so */
  win.renderDxLog();
  ok("the DX row shows the hunt provenance",
     /hunt: PI on 3 of 3 passes, 3 cfg/.test(win.els.dxList.innerHTML),
     win.els.dxList.innerHTML.slice(0, 500));
  win.dxLog.length = 0; win.renderDxLog();
}

group("31. the bandwidth sweep never becomes the operator's setting");
{
  loadFixture(10); armWorker(); setRunning(true);
  let persisted = [];
  /* the transient hook must not write the key the bandwidth block persists under */
  const bwBlock = html.slice(html.indexOf('var KEY="rdsb.chanbw"'), html.indexOf('r.oninput=function()'));
  const hook = bwBlock.slice(bwBlock.indexOf("bwSetTransient=function"));
  ok("the sweep hook exists", hook.length > 0);
  ok("the sweep hook does not persist", hook.indexOf("setItem") < 0, hook.slice(0, 200));
  ok("the sweep hook does not log", hook.indexOf("log(") < 0, hook.slice(0, 200));
  ok("the sweep hook still clamps to the control's own limits", hook.indexOf("clampHz") >= 0);

  ok("the sweep list is bounded by the slider", win.LP_BW.every(v =>
     v >= Number(win.els.bwSel.min) && v <= Number(win.els.bwSel.max)), JSON.stringify(win.LP_BW));
  ok("160 kHz is tried first", win.LP_BW[0] === 160000, JSON.stringify(win.LP_BW));

  /* walking the sweep moves the control, and stopping puts the operator's value back */
  win.els.bwSel.value = "200000";
  win.lpBwUser = null;
  win.els.lpVary.checked = true;
  win.lpPass = 0; win.lpSweepStart(); win.lpSweepApply();
  const first = Number(win.els.bwSel.value);
  win.lpPass = 1; win.lpSweepApply();
  const second = Number(win.els.bwSel.value);
  ok("consecutive passes use different widths", first !== second, first + " vs " + second);
  ok("both are from the list", win.LP_BW.indexOf(first) >= 0 && win.LP_BW.indexOf(second) >= 0);
  win.lpSweepRestore();
  ok("the operator's width is restored", Number(win.els.bwSel.value) === 200000,
     win.els.bwSel.value);
  ok("restore is idempotent", (win.lpSweepRestore(), Number(win.els.bwSel.value) === 200000));

  /* and with the sweep off, nothing moves */
  win.els.lpVary.checked = false;
  win.els.bwSel.value = "170000";
  win.lpPass = 3; win.lpSweepApply();
  ok("sweep off leaves the width alone", Number(win.els.bwSel.value) === 170000, win.els.bwSel.value);
  win.els.lpVary.checked = true;
}

group("32. the hunt panel shows thin evidence as thin");
{
  loadFixture(10); armWorker(); setRunning(true);
  win.lpPicClear();
  win.lpPicAdd(RDS(0xC202, true, 9, "TESTFM"), "160/2/0/1");
  win.lpPicAdd(RDS(0xC202, true, 8, "TESTFM"), "180/2/0/1");
  win.lpPicAdd(RDS(0xC202, true, 7, "TESTFM"), "205/2/0/1");
  win.lpPicAdd(RDS(0x730F, false, 1, ""),      "205/2/0/1");
  win.lpHuntRender();
  ok("panel is showing", doc.getElementById("huntPanel").classList.contains("on"));
  ok("pass and config counts stated", /4 passes/.test(win.els.huntStat.textContent)
     && /4 configs|3 configs/.test(win.els.huntStat.textContent), win.els.huntStat.textContent);
  const psh = win.els.huntPs.innerHTML;
  ok("firm characters are marked firm", /class="f"/.test(psh), psh.slice(0, 300));
  ok("unread positions render as a gap", /class="n"/.test(psh), psh.slice(0, 300));
  const pih = win.els.huntPi.innerHTML;
  ok("the leader is shown with its lap count", /0xC202[\s\S]*?3\/4 passes/.test(pih), pih);
  ok("the rival is NOT hidden", pih.indexOf("0x730F") >= 0, pih);
  ok("the rival is marked thin", /class="t">0x730F/.test(pih), pih);

  /* PS support must be per-character, and readable */
  ok("each character carries its own support in a title",
     (psh.match(/passes,/g) || []).length >= 6, psh.slice(0, 400));
}

group("33. the worker was not touched");
{
  const crypto = require("crypto");
  const grab = (name) => {
    const m = new RegExp(name + "\\s*=\\s*String\\.raw`").exec(html);
    let i = m.index + m[0].length, j = i;
    for (;;) { j = html.indexOf("`", j); if (html[j - 1] === "\\") { j++; continue; } break; }
    let body = html.slice(i, j);
    if (body[0] === "\n") body = body.slice(1);
    return crypto.createHash("sha256").update(body, "utf8").digest("hex");
  };
  const w = grab("WORKER_SRC"), d = grab("DCWORKER_SRC");
  const eW = (html.match(/EXPECT_WORKER_SHA\s*=\s*"([0-9a-f]{64})"/) || [])[1];
  const eD = (html.match(/EXPECT_DCWORKER_SHA\s*=\s*"([0-9a-f]{64})"/) || [])[1];
  ok("WORKER_SRC matches the shell's own EXPECT constant", w === eW, w);
  ok("DCWORKER_SRC matches the shell's own EXPECT constant", d === eD, d);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
