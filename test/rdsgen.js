/* rdsgen.js — synthesise FM-composite IQ carrying a real RDS bitstream.
   Deterministic: seeded PRNG for noise, no Math.random anywhere.
   Nothing here is copied from the worker; the block coding is re-derived from the
   standard so a pass proves the decoder, not a shared bug. */
"use strict";

const G = 1465;                                     // x^10+x^8+x^7+x^5+x^4+x^3+1
const OFF = { A: 0x0FC, B: 0x198, C: 0x168, Cp: 0x350, D: 0x1B4 };

function rem10(v){                                  // remainder of a 26-bit value mod g
  let r = v >>> 0;
  for(let i = 25; i >= 10; i--) if(r & (1 << i)) r ^= (G << (i - 10));
  return r & 0x3FF;
}
function block(data16, offName){                    // → 26-bit block
  const d = data16 & 0xFFFF;
  const chk = rem10(d * 1024) ^ OFF[offName];
  return (d * 1024 + chk) >>> 0;
}

/* A 0A group: PI / type+flags / AF pair / two PS characters. */
function group0A(pi, pty, seg, psChars){
  const b = ((0 << 12) | (0 << 11) | (1 << 10) | ((pty & 31) << 5) | (0 << 4) | (0 << 3) | (0 << 2) | (seg & 3)) & 0xFFFF;
  const c = 0xE0CD;                                 // AF filler
  const d = ((psChars[0].charCodeAt(0) & 0xFF) << 8) | (psChars[1].charCodeAt(0) & 0xFF);
  return [block(pi, "A"), block(b, "B"), block(c, "C"), block(d, "D")];
}

/* Bit stream: N groups of 0A, PS cycling, differentially encoded at the end. */
function bitstream(pi, ps, nGroups){
  const bits = [];
  const name = (ps + "        ").slice(0, 8);
  for(let g = 0; g < nGroups; g++){
    const seg = g & 3;
    const blocks = group0A(pi, 10, seg, [name[seg * 2], name[seg * 2 + 1]]);
    for(const bl of blocks) for(let i = 25; i >= 0; i--) bits.push((bl >>> i) & 1);
  }
  return bits;
}

function diffEncode(bits){                          // RDS differential encoding
  const out = new Array(bits.length);
  let prev = 0;
  for(let i = 0; i < bits.length; i++){ prev = prev ^ bits[i]; out[i] = prev; }
  return out;
}

/* Mulberry32 — seeded, portable, so every run of a suite is the same run. */
function prng(seed){
  let a = seed >>> 0;
  return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(rnd){                                // Box–Muller, seeded
  let u, v, w;
  do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; w = u * u + v * v; } while(w >= 1 || w === 0);
  return u * Math.sqrt(-2 * Math.log(w) / w);
}

/* Build Int16 interleaved IQ.
   opts: { rate, seconds, pi, ps, snrDb, seed, startPhaseBits } */
function makeIQ(opts){
  const rate = opts.rate || 256000;
  const secs = opts.seconds || 6;
  const n = Math.floor(rate * secs);
  const BR = 1187.5;

  const nGroups = Math.ceil((secs + 2) * BR / 104) + 4;
  const bits = diffEncode(bitstream(opts.pi, opts.ps || "TESTFM", nGroups));

  /* biphase (Manchester) at 2×1187.5, subcarrier locked to 3× pilot */
  const skip = opts.startPhaseBits || 0;            // whole-bit offset into the stream
  const halfLen = rate / (2 * BR);

  const rnd = prng(opts.seed === undefined ? 1 : opts.seed);
  const snr = opts.snrDb;
  const DEV = 75000;                                // full-scale composite → 75 kHz
  const A_PILOT = 0.09, A_RDS = 0.05;
  const out = new Int16Array(n * 2);
  let phase = 0, nAmp = 0;

  if(snr !== undefined){
    /* noise power set relative to the RDS subcarrier's own power */
    nAmp = Math.pow(10, -snr / 20);
  }

  for(let k = 0; k < n; k++){
    const t = k / rate;
    const halfIdx = Math.floor(k / halfLen);
    const bitIdx = skip + (halfIdx >> 1);
    const b = bits[bitIdx % bits.length];
    const manch = ((halfIdx & 1) === 0) ? (b ? 1 : -1) : (b ? -1 : 1);
    const comp = A_PILOT * Math.sin(2 * Math.PI * 19000 * t)
               + A_RDS * manch * Math.cos(2 * Math.PI * 57000 * t);
    phase += 2 * Math.PI * DEV * comp / rate;
    if(phase > Math.PI * 2) phase -= Math.PI * 2;
    let I = Math.cos(phase), Q = Math.sin(phase);
    if(nAmp){ I += gauss(rnd) * nAmp; Q += gauss(rnd) * nAmp; }
    let ii = I * 12000, qq = Q * 12000;
    out[2 * k]     = ii > 32767 ? 32767 : ii < -32768 ? -32768 : ii;
    out[2 * k + 1] = qq > 32767 ? 32767 : qq < -32768 ? -32768 : qq;
  }
  return out;
}

/* Pure seeded noise — no station present. The negative control. */
function makeNoise(opts){
  const rate = opts.rate || 256000;
  const n = Math.floor(rate * (opts.seconds || 6));
  const rnd = prng(opts.seed === undefined ? 1 : opts.seed);
  const out = new Int16Array(n * 2);
  for(let k = 0; k < n; k++){
    out[2 * k]     = Math.max(-32768, Math.min(32767, gauss(rnd) * 6000));
    out[2 * k + 1] = Math.max(-32768, Math.min(32767, gauss(rnd) * 6000));
  }
  return out;
}

module.exports = { makeIQ, makeNoise, block, rem10, OFF };
