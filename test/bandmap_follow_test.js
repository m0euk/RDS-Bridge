/* bandmap_follow_test.js — 0.10.0 cand.15
   Targeted suite for the band map playhead FOLLOW behaviour (the cand.14 scroll-lock bug).
   Drives the real shell out of index.html under jsdom. No fixtures, runs in ~2 s.

   Harness notes carried from the 0.10.0 session (each cost a debugging round):
     - the shell is ONE script block: an unstubbed getContext() throws mid-block and every var
       initialiser after it silently never runs.  Stub canvas in beforeParse.
     - stub URL.createObjectURL or anything reaching startWorker() dies.
     - jsdom has no layout: clientHeight/scrollHeight are 0 and scrollTop does not clamp.
       Both are defined explicitly on #bmScroll below, and scrollTop is given a real setter that
       clamps and fires a scroll event, because THAT is the browser behaviour under test.

   Usage: node bandmap_follow_test.js [path/to/index.html]
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

group("0. shell parsed and wired");
ok("bmPlayhead exists", typeof win.bmPlayhead === "function");
/* a candidate carries its id; a release build clears it. Both are valid — a stray value is not. */
ok("BUILD is a cand tag or empty at release", /^(0\.\d+\.\d+-cand\.\d+)?$/.test(win.BUILD || ""),
   JSON.stringify(win.BUILD) + " / VERSION " + win.VERSION);
if (typeof win.bmPlayhead !== "function") { console.log("\nshell did not wire — aborting"); process.exit(1); }

/* ── give #bmScroll real scroll mechanics ───────────────────────────────────── */
const VIEW_H = 400, CONTENT_H = 40000;
const sc = doc.getElementById("bmScroll");
let _top = 0, scrollEvents = 0;
Object.defineProperty(sc, "clientHeight", { get: () => VIEW_H, configurable: true });
Object.defineProperty(sc, "scrollHeight", { get: () => CONTENT_H, configurable: true });
Object.defineProperty(sc, "scrollTop", {
  get: () => _top,
  set(v){
    const clamped = Math.max(0, Math.min(CONTENT_H - VIEW_H, Math.round(v)));
    if (clamped === _top) return;                 // no change → NO scroll event, as in a browser
    _top = clamped; scrollEvents++;
    sc.dispatchEvent(new win.Event("scroll"));
  },
  configurable: true
});
/* a user gesture: same mechanics, but nothing has pre-registered the value */
const userScrollTo = (v) => { sc.scrollTop = v; };

/* ── synthetic map + transport state ────────────────────────────────────────── */
win.BMAP = { rows: 400, bucket: 5, nC: 1, raster: 100000, chans: [88.1e6], abs: false,
             cells: new Float32Array(400) };
win.fileMeta = { rate: 1000, frames: 2000000, name: "t.wav", bytesPerFrame: 4, dataOffset: 44,
                 file: { slice(){ return { arrayBuffer: async () => new ArrayBuffer(0) }; } } };
win.sourceMode = "file";
win.playing = true; win.paused = false;
const seekTo = (sec) => { win.playHead = sec * win.fileMeta.rate; };
const CELL_H = win.bmCell().h;                            // read from the shell, never assumed
const yFor = (sec) => (sec / win.BMAP.bucket) * CELL_H;

group("1. geometry read from the shell");
ok("bmCell().h is a sane pixel height", CELL_H > 0 && CELL_H < 64, "got " + CELL_H);
ok("map is taller than the viewport", win.BMAP.rows * CELL_H > VIEW_H);

group("2. follow, unmolested, keeps the playhead on screen");
win._bmFollow = true; _top = 0; scrollEvents = 0;
seekTo(10); win.bmPlayhead();
ok("playhead inside view → no scroll", _top === 0, "top=" + _top);
seekTo(1000);                                   // y = 2000 px, far below the viewport
win.bmPlayhead();
ok("playhead below view → centred", Math.abs(_top - (yFor(1000) - VIEW_H / 2)) <= 1, "top=" + _top);
ok("follow still armed after our own write", win._bmFollow === true);

group("3. a user scroll disarms follow and is NOT undone  ← the cand.14 bug");
userScrollTo(120);
ok("user scroll disarms follow", win._bmFollow === false);
const afterUser = _top;
for (let i = 0; i < 40; i++){ seekTo(1000 + i); win.bmPlayhead(); }   // 40 transport ticks
ok("40 ticks do not steal the scroll", _top === afterUser, "top=" + _top + " want " + afterUser);
ok("playhead row still tracks time", parseFloat(doc.getElementById("bmPlayRow").style.top) === yFor(1039));

group("4. a USER scroll that lands on the playhead re-arms follow");
seekTo(1039); win.bmPlayhead();                  // refresh _bmPlayY without scrolling (follow is off)
userScrollTo(yFor(1039) - VIEW_H / 2);           // deliberately scroll back to it
ok("gesture landing on the playhead re-arms", win._bmFollow === true);
const reTop = _top;
win.bmPlayhead();
ok("re-arming does not itself scroll", _top === reTop, "top=" + _top);
seekTo(1200); win.bmPlayhead();                  // and following works again
ok("following resumed", Math.abs(_top - (yFor(1200) - VIEW_H / 2)) <= 1, "top=" + _top);

group("5. follow is inert when not playing");
win._bmFollow = true; win.playing = false; _top = 0;
seekTo(1500); win.bmPlayhead();
ok("stopped → no scroll", _top === 0, "top=" + _top);
win.playing = true; win.paused = true; _top = 0;
win.bmPlayhead();
ok("paused → no scroll", _top === 0, "top=" + _top);
win.paused = false;

group("6. a scroll the code did not write always disarms, even at the same value");
win._bmFollow = true; _top = 500;
seekTo(1000); win.bmPlayhead();                  // writes a new top, consumes _bmWantTop
ok("_bmWantTop consumed", win._bmWantTop === -1, "want=" + win._bmWantTop);
userScrollTo(_top + 300);
ok("next user scroll disarms", win._bmFollow === false);

group("7. clicking a cell re-arms follow (explicit 'take me there')");
win._bmFollow = false;
win.transportSeek = () => {};                    // isolate: no worker/decoder side effects
win.applyTune = () => {};
const cv = doc.getElementById("bmCanvas");
/* 0.10.6: bmHit() now normalises the pointer by the MEASURED rect (the UI-scale control sets
   document.body.style.zoom, so the rect is in zoomed px while bmCell() is in design px). That
   makes the backing store meaningful, so the stub has to model the pairing prep() creates:
   cv.width/height and the CSS size are the same design px, and only the zoom stretches the
   rect. The old stub asserted a 100 px-wide rect on a canvas jsdom sized at 300 \u2014 a
   combination the shell cannot produce. Self-consistent here, at zoom 1. */
const MAP_W = win.BMAP.nC * win.bmCell().w, MAP_H = win.BMAP.rows * win.bmCell().h;
cv.width = MAP_W; cv.height = MAP_H;
cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: MAP_W, height: MAP_H });
try {
  win.bmClick({ clientX: 5, clientY: 25 });
  ok("bmClick re-arms follow", win._bmFollow === true);
} catch (e) {
  ok("bmClick re-arms follow", false, e.message);
}

group("8. drift-in does NOT re-arm — the parked user is left alone");
win._bmFollow = false; _top = 0; scrollEvents = 0;
/* sweep the playhead from above the viewport, straight through it, and out the bottom */
for (let s2 = 0; s2 < 1900; s2 += 7){ seekTo(s2); win.bmPlayhead(); }
ok("zero scroll writes across the whole recording", scrollEvents === 0, "events=" + scrollEvents);
ok("still disarmed after the playhead passed through view", win._bmFollow === false);

group("9. the playhead row itself is unaffected by follow state");
win._bmFollow = false; seekTo(777); win.bmPlayhead();
ok("row positioned from time, not from scroll",
   Math.abs(parseFloat(doc.getElementById("bmPlayRow").style.top) - yFor(777)) < 0.01,
   doc.getElementById("bmPlayRow").style.top);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
