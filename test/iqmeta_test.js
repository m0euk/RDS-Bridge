#!/usr/bin/env node
/* iqmeta_test.js -- IQ file header metadata: centre frequency, start time, container handling.
 *
 *   node test/iqmeta_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted parseWav / parseCentreHz in a vm against headers synthesised in
 * memory. No fixture files, no jsdom, deterministic.
 *
 * Every header shape here was measured from a real capture, not invented:
 *   HDSDR       binary auxi 164 B at offset 36, data at 216   (reporter's file, 29-Jul-2026)
 *   SDRuno      identical geometry; only CenterFreq filled     (RSPdxR2, 31-Jul-2026)
 *   SDR Console UTF-16LE XML auxi 1914 B, RF64 + ds64          (Airspy HF+, SDR Console 3.2
 *                                                               build 2731, XMLLevel003)
 *   SDR#        no auxi, frequency in the filename only
 *
 * The SDR Console case is a regression guard: 0.10.2's binary-auxi read initially made Bridge
 * report 3.145774 MHz for an 88.5 MHz recording, because the UTF-16 XML was being read as the
 * SpectraVue dword table. Two independent defences must both stay in place -- see GROUP 6.
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

/* ---------- extract the real functions ------------------------------------------------ */

function grab(name, isAsync) {
  const sig = (isAsync ? "async " : "") + "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) throw new Error("iqmeta_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}

const CODE = ["fourCC", "sysTimeUTC", "bextUTC", "parseCentreHz"].map((n) => grab(n, false))
  .concat([grab("parseWav", true)]).join("\n\n");

const ctx = { DataView, Uint8Array, Math, Number, String, Date, isFinite, parseFloat, console };
vm.createContext(ctx);
vm.runInContext(CODE + "\n;this.parseWav=parseWav; this.parseCentreHz=parseCentreHz;", ctx);

/* ---------- assertions ---------------------------------------------------------------- */

let pass = 0;
const fails = [];
function eq(label, got, want) {
  const ok = (got === want) || (Number.isNaN(got) && Number.isNaN(want));
  if (ok) pass++;
  else fails.push(`${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ---------- header builders ----------------------------------------------------------- */

function sysTime(y, mo, dow, d, h, mi, s, ms) {
  const b = Buffer.alloc(16);
  [y, mo, dow, d, h, mi, s, ms].forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}
function chunk(id, payload) {
  const h = Buffer.alloc(8);
  h.write(id, 0, "latin1");
  h.writeUInt32LE(payload.length, 4);
  const pad = (payload.length & 1) ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([h, payload, pad]);
}
function fmtChunk({ ch = 2, rate = 2000000, bits = 16, tag = 1, ext = 0 } = {}) {
  const p = Buffer.alloc(16 + ext);
  const align = (ch * bits) / 8;
  p.writeUInt16LE(tag, 0); p.writeUInt16LE(ch, 2); p.writeUInt32LE(rate, 4);
  p.writeUInt32LE(rate * align, 8); p.writeUInt16LE(align, 12); p.writeUInt16LE(bits, 14);
  return chunk("fmt ", p);
}
/* SpectraVue binary auxi: StartTime(16) StopTime(16) CenterFreq(u32 LE) ... */
function auxiBinary({ centre = 0, size = 164, year = 2026, tail = null } = {}) {
  const p = Buffer.alloc(size);
  sysTime(year, 7, 5, 31, 16, 50, 31, 570).copy(p, 0);
  sysTime(year, 7, 5, 31, 16, 50, 43, 969).copy(p, 16);
  if (size >= 36) p.writeUInt32LE(centre, 32);
  if (tail && size > 68) p.write(tail, 68, "latin1");
  return chunk("auxi", p);
}
function auxiXml({ centre = 88500000, utc = 1785517766, wide = false, size = null } = {}) {
  const xml = `<?xml version="1.0"?><SDR-XML-Root RadioCenterFreq="${centre}" ` +
    `UTCSeconds="${utc}" XMLLevel="XMLLevel003" SoftwareName="SDR Console"/>`;
  const body = Buffer.from(xml, wide ? "utf16le" : "latin1");
  const p = Buffer.alloc(size || body.length + (body.length & 1));
  body.copy(p, 0);
  return chunk("auxi", p);
}
function ds64Chunk(dataSize) {
  const p = Buffer.alloc(28);
  p.writeUInt32LE(0xffffffff, 0); p.writeUInt32LE(0, 4);            // riffSize
  p.writeUInt32LE(dataSize >>> 0, 8);
  p.writeUInt32LE(Math.floor(dataSize / 4294967296), 12);           // dataSize hi
  return chunk("ds64", p);
}
function wav(name, { magic = "RIFF", chunks = [], payload = 65536, dataSentinel = false } = {}) {
  const body = Buffer.concat(chunks);
  const dh = Buffer.alloc(8);
  dh.write("data", 0, "latin1");
  dh.writeUInt32LE(dataSentinel ? 0xffffffff : payload, 4);
  const hd = Buffer.alloc(12);
  hd.write(magic, 0, "latin1"); hd.write("WAVE", 8, "latin1");
  hd.writeUInt32LE(magic === "RIFF" ? 4 + body.length + 8 + payload : 0xffffffff, 4);
  const buf = Buffer.concat([hd, body, dh, Buffer.alloc(payload)]);
  return {
    size: buf.length, name,
    slice: (a, b) => ({
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset + a, buf.byteOffset + Math.min(b, buf.length))
    })
  };
}
/* loadFile's rule: metadata wins; a >50 kHz disagreement is logged, not resolved. */
function bridgeCentre(meta, name) {
  const n = ctx.parseCentreHz(name);
  return isFinite(meta.centreHz) ? meta.centreHz : n;
}

/* ---------- the suite ----------------------------------------------------------------- */

(async () => {

  /* GROUP 1 -- parseCentreHz units and the bare-Hz guard */
  const pc = ctx.parseCentreHz;
  eq("1.1  kHz token", pc("SDRuno_20260731_165031Z_88489kHz.wav"), 88489000);
  eq("1.2  MHz token", pc("31-Jul-2026 180926.754 88.500MHz.wav"), 88500000);
  eq("1.3  bare Hz, 8 digits", pc("SDRSharp_90000000Hz_IQ.wav"), 90000000);
  eq("1.4  GHz token", pc("cap_1.2GHz.wav"), 1200000000);
  eq("1.5  lower-case unit", pc("cap_90000khz.wav"), 90000000);
  eq("1.6  bare Hz under 6 digits rejected", pc("noisefloor_105Hz.wav"), NaN);
  eq("1.7  no frequency at all", pc("SDRConsole_recording.wav"), NaN);
  eq("1.8  unanchored: no leading underscore", pc("88489kHz-capture.wav"), 88489000);
  eq("1.9  fractional kHz", pc("cap_88489.5kHz.wav"), 88489500);
  eq("1.10 trailing token does not block", pc("HDSDR_20260729_90000kHz_RF.wav"), 90000000);

  /* GROUP 2 -- HDSDR / SDRuno binary auxi (measured geometry) */
  const hd = wav("HDSDR_20260729_195930Z_90000kHz_RF.wav",
    { chunks: [fmtChunk(), auxiBinary({ centre: 90000000 })] });
  const m2 = await ctx.parseWav(hd, 2);
  eq("2.1  binary auxi centre read at +32", m2.centreHz, 90000000);
  eq("2.2  chunk geometry: data offset", m2.dataOffset, 216);
  eq("2.3  sample rate", m2.rate, 2000000);
  eq("2.4  frame size", m2.bytesPerFrame, 4);
  ok("2.5  StartTime decoded", isFinite(m2.startUTC));
  eq("2.6  Bridge uses the metadata", bridgeCentre(m2, hd.name), 90000000);

  const un = wav("SDRuno_20260731_165031Z_88489kHz.wav",
    { chunks: [fmtChunk(), auxiBinary({ centre: 88489000 })] });
  const m2b = await ctx.parseWav(un, 2);
  eq("2.7  SDRuno centre", m2b.centreHz, 88489000);
  eq("2.8  SDRuno off-grid centre survives", bridgeCentre(m2b, un.name), 88489000);

  /* GROUP 3 -- zero and short auxi fall back to the filename */
  const z = wav("HDSDR_90000kHz.wav", { chunks: [fmtChunk(), auxiBinary({ centre: 0 })] });
  const m3 = await ctx.parseWav(z, 2);
  eq("3.1  CenterFreq zero is not adopted", m3.centreHz, NaN);
  eq("3.2  falls back to the filename", bridgeCentre(m3, z.name), 90000000);

  const shortAux = wav("HDSDR_90000kHz.wav", { chunks: [fmtChunk(), auxiBinary({ centre: 90000000, size: 32 })] });
  const m3b = await ctx.parseWav(shortAux, 2);
  eq("3.3  auxi under 36 bytes: no centre", m3b.centreHz, NaN);
  eq("3.4  short auxi still falls back", bridgeCentre(m3b, shortAux.name), 90000000);

  /* GROUP 4 -- SDR Console XML, 8-bit */
  const x8 = wav("SDRConsole_capture.wav", { chunks: [fmtChunk(), auxiXml({ centre: 90000000 })] });
  const m4 = await ctx.parseWav(x8, 2);
  eq("4.1  8-bit XML centre", m4.centreHz, 90000000);
  eq("4.2  UTCSeconds -> startUTC ms", m4.startUTC, 1785517766000);
  eq("4.3  no filename frequency needed", ctx.parseCentreHz(x8.name), NaN);
  eq("4.4  Bridge uses the XML", bridgeCentre(m4, x8.name), 90000000);

  /* GROUP 5 -- SDR Console XML, UTF-16LE, RF64 (the real Airspy capture shape) */
  const DATA = 30489930;
  const x16 = wav("31-Jul-2026 180926.754 88.500MHz.wav", {
    magic: "RF64", dataSentinel: true, payload: 262144,
    chunks: [ds64Chunk(DATA), fmtChunk({ rate: 768000, ext: 2 }), auxiXml({ wide: true, size: 1914 })]
  });
  const m5 = await ctx.parseWav(x16, 2);
  eq("5.1  UTF-16 XML centre", m5.centreHz, 88500000);
  eq("5.2  UTF-16 UTCSeconds", m5.startUTC, 1785517766000);
  eq("5.3  RF64 accepted", m5.rate, 768000);
  eq("5.4  data sentinel resolved, not 0xFFFFFFFF", m5.dataSize <= 262144, true);
  eq("5.5  Bridge centre is correct", bridgeCentre(m5, x16.name), 88500000);
  ok("5.6  NOT the misread struct value", m5.centreHz !== 3145774);

  /* GROUP 6 -- the two independent defences against a fabricated centre.
     Either alone is sufficient; both must remain. A chunk that is neither XML nor a
     recognisable SpectraVue struct must never supply a centre. */
  const junk = Buffer.alloc(164);
  junk.write("NOT-XML-AND-NOT-A-SYSTEMTIME-EITHER", 0, "latin1");
  junk.writeUInt32LE(3145774, 32);
  const jf = wav("mystery_90000kHz.wav", { chunks: [fmtChunk(), chunk("auxi", junk)] });
  const m6 = await ctx.parseWav(jf, 2);
  eq("6.1  unrecognised auxi supplies no centre", m6.centreHz, NaN);
  eq("6.2  invalid StartTime is NaN", isFinite(m6.startUTC), false);
  eq("6.3  falls back to the filename", bridgeCentre(m6, jf.name), 90000000);
  ok("6.4  the +32 read is gated on StartTime",
    /if\(isFinite\(startUTC\)\s*&&\s*auxLen>=36\)/.test(src));
  ok("6.5  the UTF-16 sniff is present", /auxTxt\s*=\s*wide/.test(src));

  const badYear = wav("cap_90000kHz.wav",
    { chunks: [fmtChunk(), auxiBinary({ centre: 12345678, year: 1900 })] });
  const m6b = await ctx.parseWav(badYear, 2);
  eq("6.6  implausible year blocks the +32 read", m6b.centreHz, NaN);
  eq("6.7  and the filename wins", bridgeCentre(m6b, badYear.name), 90000000);

  /* GROUP 7 -- precedence and the >50 kHz disagreement */
  const stale = wav("HDSDR_20260729_195930Z_91500kHz_RF.wav", {
    chunks: [fmtChunk(), auxiBinary({ centre: 90000000, tail: "HDSDR_20260729_195939Z_91500kHz_RF.wav" })]
  });
  const m7 = await ctx.parseWav(stale, 2);
  eq("7.1  metadata outranks a disagreeing filename", bridgeCentre(m7, stale.name), 90000000);
  ok("7.2  disagreement exceeds the 50 kHz threshold",
    Math.abs(m7.centreHz - ctx.parseCentreHz(stale.name)) > 50000);
  ok("7.3  loadFile carries the 50 kHz warning", /Math\.abs\(m\.centreHz-nameHz\)>50000/.test(src));

  /* GROUP 8 -- no auxi at all */
  const bare = wav("SDRSharp_20260731_90000000Hz_IQ.wav", { chunks: [fmtChunk({ rate: 2400000 })] });
  const m8 = await ctx.parseWav(bare, 2);
  eq("8.1  no auxi: centre is NaN", m8.centreHz, NaN);
  eq("8.2  startUTC is NaN", isFinite(m8.startUTC), false);
  eq("8.3  filename supplies the centre", bridgeCentre(m8, bare.name), 90000000);

  /* GROUP 9 -- formats accepted and refused */
  const f32 = wav("console_32f_90000kHz.wav",
    { chunks: [fmtChunk({ bits: 32, tag: 3 }), auxiXml({ centre: 90000000 })] });
  const m9 = await ctx.parseWav(f32, 2);
  eq("9.1  32-bit float accepted", m9.bits, 32);
  eq("9.2  frame size follows bit depth", m9.bytesPerFrame, 8);

  let threw = null;
  try { await ctx.parseWav(wav("mono_AF_90000kHz.wav", { chunks: [fmtChunk({ ch: 1, rate: 48000 })] }), 2); }
  catch (e) { threw = String(e); }
  ok("9.3  mono AF file is rejected", threw && /channel/i.test(threw));

  threw = null;
  try { await ctx.parseWav(wav("deep_24_90000kHz.wav", { chunks: [fmtChunk({ bits: 24 })] }), 2); }
  catch (e) { threw = String(e); }
  ok("9.4  24-bit is rejected", threw && /16-bit|32-bit/.test(threw));

  threw = null;
  try { await ctx.parseWav(wav("nofmt_90000kHz.wav", { chunks: [] }), 2); }
  catch (e) { threw = String(e); }
  ok("9.5  missing fmt throws", threw && /fmt/.test(threw));

  /* GROUP 10 -- mono composite path (MPX offline harness passes wantCh=1) */
  const mono = wav("mpx_composite.wav", { chunks: [fmtChunk({ ch: 1, rate: 192000 })] });
  const m10 = await ctx.parseWav(mono, 1);
  eq("10.1 wantCh=1 accepts mono", m10.ch, 1);
  eq("10.2 mono frame size", m10.bytesPerFrame, 2);

  /* ---------- report ---------- */
  /* run-all.js parses the "N passed, M failed" line, and prints any line matching
     /FAIL|Error/ from a failing suite -- so each failure is tagged FAIL. */
  if (fails.length) {
    fails.forEach((f) => console.log("FAIL  " + f));
    console.log(`\n${pass} passed, ${fails.length} failed`);
    process.exit(1);
  }
  console.log(`${pass} passed, 0 failed`);
})().catch((e) => { console.error("FAIL  iqmeta_test threw -- Error: " + (e && e.stack || e)); process.exit(1); });
