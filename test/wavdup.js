#!/usr/bin/env node
/* wavdup.js — how much of this recording is repeated audio?
 *
 *   node wavdup.js recording.wav
 *
 * WHY THIS EXISTS. When the main thread is saturated, WebSocket audio frames are delivered late
 * and repeated, so a recording contains byte-identical audio twice in a row. That fault is
 * INVISIBLE to a duration check, because duplication ADDS length: 8.80 s of repeats padded out
 * 8.80 s of missing audio and the file reconciled perfectly against the wall clock while being
 * audibly broken. Duration tells you nothing here; unique audio does.
 *
 * WHY IT SLIDES. The first attempt at this scanned on a fixed 2400-sample grid. SDRconnect's audio
 * frames are VARIABLE length — 9600 B and 9604 B were both measured inside one minute — so a fixed
 * grid loses alignment at the first odd frame and undercounts by about 2.5x (it reported 4.25% where
 * the real figure was 12.02%). This one finds repeats at any offset and any length.
 *
 * HOW. A 64-sample rolling hash at every position; where the content at i has been seen at some
 * earlier j, the match is extended as far as it runs, and it is only counted when it is ADJACENT
 * (j + length === i) — i.e. a block immediately followed by a copy of itself, which is what a
 * re-delivered frame looks like. Flat windows are skipped so digital silence cannot masquerade as
 * duplication.
 */

const fs = require("fs");

const file = process.argv[2];
if (!file) { console.error("usage: node wavdup.js <recording.wav>"); process.exit(2); }
const buf = fs.readFileSync(file);

/* ── parse the WAV, believing the chunks rather than assuming a 44-byte header ─────────────── */
if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
  console.error("not a RIFF/WAVE file: " + file); process.exit(2);
}
let fmt = null, dataAt = -1, dataLen = 0, p = 12;
while (p + 8 <= buf.length) {
  const id = buf.toString("ascii", p, p + 4), sz = buf.readUInt32LE(p + 4);
  if (id === "fmt ") {
    fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10),
            rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
  } else if (id === "data") { dataAt = p + 8; dataLen = Math.min(sz, buf.length - dataAt); }
  p += 8 + sz + (sz & 1);
}
if (!fmt || dataAt < 0) { console.error("no fmt/data chunk found"); process.exit(2); }
if (fmt.tag !== 1 || fmt.bits !== 16) { console.error("only 16-bit PCM is supported (got tag " + fmt.tag + ", " + fmt.bits + "-bit)"); process.exit(2); }

const frames = Math.floor(dataLen / 2 / fmt.ch);
/* mono-ise for comparison only — a repeat repeats in both channels */
const s = new Int16Array(frames);
for (let i = 0; i < frames; i++) s[i] = buf.readInt16LE(dataAt + i * fmt.ch * 2);

const W = 64;                       // hash window: long enough not to collide on ordinary audio
const MINRUN = 480;                 // 10 ms at 48 kHz — shorter than any real frame, so no false runs
const dup = new Uint8Array(frames); // 1 = this sample is part of an adjacent repeat

/* rolling polynomial hash */
const B = 1000003 >>> 0;
let POW = 1; for (let i = 1; i < W; i++) POW = Math.imul(POW, B) >>> 0;
const seen = new Map();
let h = 0, rehash = true;
/* A rolling hash is only valid while the cursor advances ONE sample at a time. When a match is
   found the cursor jumps past the whole matched block, so the hash must be rebuilt from scratch at
   the landing position — roll it instead and every hash after the first match is garbage, the
   detector finds exactly one duplicate and reports it as the whole answer. That is what the first
   version of this file did: it reported 0.50% on a 25%-duplicated fixture, which is precisely one
   4800-sample frame in 960000 samples. Caught by wavdup_discriminate.js, not by reading the code. */
let flat = 0;
for (let i = 0; i + W <= frames; i++) {
  if (rehash) {
    h = 0; for (let k = 0; k < W; k++) h = (Math.imul(h, B) + (s[i + k] + 32768)) >>> 0;
    rehash = false;
  } else if (i > 0) {
    h = (h - Math.imul(POW, (s[i - 1] + 32768))) >>> 0;
    h = (Math.imul(h, B) + (s[i + W - 1] + 32768)) >>> 0;
  }
  /* skip a window with no variation: digital silence repeats trivially and means nothing */
  let varies = false;
  for (let k = 1; k < W; k++) if (s[i + k] !== s[i]) { varies = true; break; }
  if (!varies) { flat++; seen.set(h, i); continue; }

  const j = seen.get(h);
  seen.set(h, i);
  if (j === undefined || j >= i || dup[i]) continue;

  /* verify, then extend forward */
  let eq = true;
  for (let k = 0; k < W; k++) if (s[j + k] !== s[i + k]) { eq = false; break; }
  if (!eq) continue;
  let L = W;
  while (i + L < frames && s[j + L] === s[i + L]) L++;
  /* adjacent only: the copy must start exactly where the original ended */
  if (j + L !== i || L < MINRUN) continue;
  for (let k = 0; k < L; k++) dup[i + k] = 1;
  i += L - 1; rehash = true;                        // the cursor jumped — the rolling hash is void
}

let dupN = 0; for (let i = 0; i < frames; i++) if (dup[i]) dupN++;
const dur = frames / fmt.rate, uniq = (frames - dupN) / fmt.rate;

const f2 = (x) => x.toFixed(2);
console.log("file       : " + file);
console.log("format     : " + fmt.rate + " Hz, " + fmt.ch + " ch, " + fmt.bits + "-bit PCM");
console.log("duration   : " + f2(dur) + " s  (" + frames + " frames)");
console.log("unique     : " + f2(uniq) + " s of " + f2(dur) + " s");
console.log("duplicated : " + f2(100 * dupN / (frames || 1)) + "%   (" + f2(dur - uniq) + " s of repeated audio)");
if (flat) console.log("silence    : " + flat + " flat windows skipped (not counted either way)");
console.log(dupN === 0
  ? "\nVERDICT: no repeated audio found. Every second in this file is distinct."
  : "\nVERDICT: " + f2(dur - uniq) + " s of this recording is a repeat of the audio immediately before it,"
    + "\n         which means roughly that much real audio never arrived.");
