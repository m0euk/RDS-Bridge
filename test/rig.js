/* rig.js — run the REAL extracted decode worker in a Node vm, headless.
   Rebuilt this session (the how-to was recorded as "lives in the handover" and wasn't there).
   Extracts WORKER_SRC from a build by its String.raw delimiters, so the rig can never
   silently test a stale or hand-copied worker. */
"use strict";
const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");

function extractWorker(buildPath, name){
  const src = fs.readFileSync(buildPath, "utf8");
  const m = new RegExp(name + "\\s*=\\s*String\\.raw`").exec(src);
  if(!m) throw new Error(name + " not found in " + buildPath);
  let i = m.index + m[0].length, j = i;
  for(;;){ j = src.indexOf("`", j); if(src[j-1] === "\\"){ j++; continue; } break; }
  let body = src.slice(i, j);
  if(body[0] === "\n") body = body.slice(1);
  return { body, sha: crypto.createHash("sha256").update(body, "utf8").digest("hex") };
}

/* One worker instance. postMessage()/onmessage are stubbed; frames are captured. */
function Rx(buildPath){
  const w = extractWorker(buildPath, "WORKER_SRC");
  this.workerSha = w.sha;
  const frames = [];
  const sandbox = {
    postMessage: r => { if(r && r.type === "frame") frames.push(r); },
    setInterval: () => 1, clearInterval: () => {},
    Math, Date, Object, Array, Map, Number, String, JSON, isNaN, parseInt, parseFloat,
    Float32Array, Float64Array, Int16Array, Uint16Array, Uint8Array, Int32Array, Uint32Array,
    ArrayBuffer, console
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(w.body, sandbox, { filename: "WORKER_SRC" });
  this.ctx = sandbox;
  this.frames = frames;
}
Rx.prototype.send = function(msg){ this.ctx.onmessage({ data: msg }); };
/* feedIQ path — exactly the shape playFile() uses for the IQ-file lane */
Rx.prototype.feed = function(i16){ this.ctx.onmessage({ data: { type: "iqfile", buf: i16.buffer } }); };
Rx.prototype.snap = function(){ return this.ctx.rx.snapshot(); };

module.exports = { Rx, extractWorker };
