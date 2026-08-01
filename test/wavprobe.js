#!/usr/bin/env node
// wavprobe.js -- dump the RIFF/WAVE structure of an SDR IQ recording and predict
// what RDS Bridge will make of it. No dependencies. Reads only the first 128 kB,
// so it is safe on a 95 GB capture.
//
//   node wavprobe.js <file.wav>
//
// The centre-frequency logic here is a deliberate mirror of index.html's parseWav /
// parseCentreHz / loadFile. If Bridge changes, change this in the same edit -- a probe
// that disagrees with the shell reports a fault that isn't there, or hides one that is.

const fs = require("fs");
const path = require("path");

const PROBE_VERSION = "wavprobe 5 (31-Jul-2026) - utf16 auxi, +32 gated on StartTime";
if (process.argv[2] === "-version" || process.argv[2] === "--version") { console.log(PROBE_VERSION); process.exit(0); }

const file = process.argv[2];
if (!file) { console.error("usage: node wavprobe.js <file.wav>"); process.exit(2); }

const st = fs.statSync(file);
const fd = fs.openSync(file, "r");
const HEAD = Math.min(st.size, 128 << 10);          // Bridge reads 128 kB; match it
const b = Buffer.alloc(HEAD);
fs.readSync(fd, b, 0, HEAD, 0);
fs.closeSync(fd);

const warn = [];
const note = (s) => warn.push(s);
const fourcc = (o) => b.toString("latin1", o, o + 4);
const hz = (n) => n.toLocaleString("en-GB") + " Hz";
const mhz = (n) => (n / 1e6).toFixed(4).replace(/\.?0+$/, "") + " MHz";

console.log(`probe       ${PROBE_VERSION}`);
console.log(`file        ${path.basename(file)}`);
console.log(`size        ${st.size.toLocaleString("en-GB")} bytes`);

// ---- container ------------------------------------------------------------
const magic = fourcc(0);
if (magic !== "RIFF" && magic !== "RF64") {
  console.error(`not a RIFF/RF64 file (magic ${JSON.stringify(magic)})`);
  process.exit(1);
}
const riffSize = b.readUInt32LE(4);
console.log(`container   ${magic} / ${fourcc(8)}`);

if (magic === "RIFF") {
  const implied = riffSize + 8;
  console.log(`riff size   ${riffSize.toLocaleString("en-GB")}  -> ${implied === st.size ? "ok" : `MISMATCH (implies ${implied.toLocaleString("en-GB")})`}`);
  if (implied !== st.size) note("RIFF size does not match the file size -- truncated, appended to, or still being written.");
  if (riffSize === 0xffffffff) note("RIFF size is 0xFFFFFFFF: a >4 GB file mislabelled as RIFF. Bridge cannot size the payload from the header and falls back to the file length.");
} else {
  note("RF64 container: sizes live in ds64, not in the RIFF/data headers. Bridge handles the 0xFFFFFFFF sentinel, but confirm the data chunk was located before trusting the duration.");
}

// ---- chunk walk -----------------------------------------------------------
// Bridge breaks at `data`. We keep walking so a chunk placed after it is still
// visible -- but anything found past `data` is flagged as invisible to Bridge.
console.log("\nchunks");
let off = 12, fmt = null, dataOff = null, dataSize = null, auxi = null, bext = null;
let sawData = false, afterData = [];
while (off + 8 <= HEAD) {
  const id = fourcc(off);
  if (!/^[\x20-\x7e]{4}$/.test(id)) { note(`Non-printable chunk id at offset ${off} -- chunk walk lost alignment.`); break; }
  const size = b.readUInt32LE(off + 4);
  const payload = off + 8;
  console.log(`  ${id.padEnd(6)} offset ${String(off).padStart(9)}  payload ${String(payload).padStart(9)}  size ${size.toLocaleString("en-GB")}${sawData ? "   [after data -- Bridge never sees this]" : ""}`);
  if (sawData) afterData.push(id);

  if (id === "fmt " && fmt === null) fmt = payload;
  else if (id === "auxi" && auxi === null) auxi = { at: payload, size, afterData: sawData };
  else if (id === "bext" && bext === null) bext = payload;
  else if (id === "data" && !sawData) { dataOff = payload; dataSize = size; sawData = true; }

  if (size === 0xffffffff) { note("Chunk size sentinel 0xFFFFFFFF -- cannot walk past it."); break; }
  off = payload + size + (size & 1);                 // RIFF chunks are word-aligned
}
if (dataOff === null) note("No data chunk found within the first 128 kB -- Bridge throws \"no data chunk\" and the file will not open.");
if (afterData.length) note(`Chunks after data (${afterData.join(", ")}) are invisible to Bridge: parseWav breaks at the data chunk.`);

// ---- fmt ------------------------------------------------------------------
let bits = null, ch = null, byteRate = null;
if (fmt !== null) {
  const tag = b.readUInt16LE(fmt);
  ch = b.readUInt16LE(fmt + 2);
  const rate = b.readUInt32LE(fmt + 4);
  byteRate = b.readUInt32LE(fmt + 8);
  const align = b.readUInt16LE(fmt + 12);
  bits = b.readUInt16LE(fmt + 14);
  const tagName = { 1: "PCM", 3: "IEEE float", 0xfffe: "WAVE_FORMAT_EXTENSIBLE" }[tag] || `0x${tag.toString(16)}`;
  console.log("\nfmt");
  console.log(`  format      ${tagName}`);
  console.log(`  channels    ${ch}${ch === 2 ? " (I/Q)" : ""}`);
  console.log(`  sample rate ${hz(rate)}`);
  console.log(`  bits        ${bits}`);
  console.log(`  block align ${align}`);
  const expectAlign = (ch * bits) / 8, expectByte = rate * expectAlign;
  if (align !== expectAlign) note(`blockAlign ${align} != channelsxbits/8 = ${expectAlign}.`);
  if (byteRate !== expectByte) note(`byteRate ${byteRate} != ratexblockAlign = ${expectByte}.`);
  if (ch !== 2) note(`${ch} channel(s): Bridge's IQ File lane requires 2. HDSDR "_AF" files are demodulated audio -- they are rejected at load, not silently mis-decoded.`);
  // Bridge accepts 16-bit PCM (any tag) or 32-bit IEEE float only
  if (!(bits === 16 || (bits === 32 && tag === 3)))
    note(`Bridge accepts 16-bit PCM or 32-bit float; this is ${bits}-bit tag ${tag}. It will refuse to open.`);
  if (tag === 0xfffe) note("WAVE_FORMAT_EXTENSIBLE: the real format is in the extension's SubFormat GUID, not wFormatTag.");
  if (dataOff !== null && dataSize && byteRate) {
    const avail = Math.max(0, st.size - dataOff);
    const usable = Math.min(dataSize === 0xffffffff ? avail : dataSize, avail);
    console.log(`  duration    ${(usable / byteRate).toFixed(3)} s of usable payload`);
    if (dataSize !== 0xffffffff && dataSize > avail)
      note(`data declares ${dataSize.toLocaleString("en-GB")} bytes but only ${avail.toLocaleString("en-GB")} follow -- Bridge clamps to the file length.`);
    if (dataOff % align !== 0) note(`data payload starts at byte ${dataOff}, not a multiple of blockAlign ${align} -- I and Q will be swapped by a half-frame.`);
  }
}

// ---- auxi -- flavour-sniffed exactly as Bridge does -------------------------
let metaCentre = null, metaSource = null;
if (auxi) {
  const a = auxi.at;
  let txt = b.toString("latin1", a, a + auxi.size), wide = false;
  const isX = (s) => s.indexOf("SDR-XML-Root") >= 0 || s.indexOf("<?xml") >= 0;
  if (!isX(txt) && auxi.size >= 4 && b[a + 1] === 0 && b[a + 3] === 0) {
    // SDR Console writes UTF-16LE with no BOM; de-interleave and retry (mirrors index.html)
    const w = b.toString("utf16le", a, a + (auxi.size & ~1));
    if (isX(w)) { txt = w; wide = true; }
  }
  const isXml = isX(txt);
  console.log(`\nauxi (${auxi.size} bytes) -- ${isXml ? ("SDR Console XML" + (wide ? " (UTF-16LE)" : " (8-bit)")) : "binary SpectraVue struct"}`);

  if (isXml) {
    const mCf = txt.match(/RadioCenterFreq="(\d+)"/), mUs = txt.match(/UTCSeconds="(\d+)"/);
    if (mCf) { metaCentre = Number(mCf[1]); metaSource = "auxi XML RadioCenterFreq"; console.log(`  centre      ${hz(metaCentre)}`); }
    else note("XML auxi carries no RadioCenterFreq attribute -- Bridge finds no centre here and falls back to the filename.");
    if (mUs) console.log(`  start       ${new Date(Number(mUs[1]) * 1000).toISOString()}`);
    // SDR Console embeds the user's Windows account, machine name and full folder path.
    // Probe output gets pasted into support threads, so redact by default; --raw to see all.
    const SENSITIVE = /^(Folder|CreatedBy|RadioSerial|Filename|FirstFile|PreviousFile|InternalTag|TimeZoneInfo)$/;
    const raw = process.argv.includes("--raw");
    let hid = 0;
    const attrs = (txt.match(/[A-Za-z]+="[^"]*"/g) || []).map((kv) => {
      const k = kv.slice(0, kv.indexOf("="));
      if (!raw && SENSITIVE.test(k)) { hid++; return `${k}="[redacted]"`; }
      return kv.length > 70 ? `${k}="...${kv.length} chars..."` : kv;
    });
    if (attrs.length) console.log(`  attributes  ${attrs.join("  ")}`);
    if (hid) console.log(`  (${hid} attribute(s) redacted -- username, machine name, paths. Use --raw to show them.)`);
  } else {
    // Sanity-gate the struct before printing any of it. Bytes that are not a
    // SYSTEMTIME will read as plausible-looking dwords and fabricate a centre.
    const year = b.readUInt16LE(a);
    const looksLikeSysTime = year >= 1970 && year <= 2200;
    if (!looksLikeSysTime) {
      console.log(`  (first u16 = ${year}, not a plausible SYSTEMTIME year -- this does not look like the SpectraVue struct)`);
      note(`auxi is neither XML nor a recognisable SpectraVue struct. Bridge (0.10.2+) gates the +32 read on a valid StartTime, so it will NOT adopt a centre from this chunk and falls back to the filename. Capture this header anyway -- it is a writer we have not seen.`);
    }
    const sysTime = (o) => {
      const w = (i) => b.readUInt16LE(o + i * 2), p = (n, d = 2) => String(n).padStart(d, "0");
      return `${w(0)}-${p(w(1))}-${p(w(3))} ${p(w(4))}:${p(w(5))}:${p(w(6))}.${p(w(7), 3)} UTC`;
    };
    if (looksLikeSysTime) {
      console.log(`  start       ${sysTime(a)}`);
      console.log(`  stop        ${sysTime(a + 16)}`);
    }
    // SpectraVue dwords from +32. Bridge gates on auxLen>=36 and reads CenterFreq only.
    let sawStructTail = false;
    const dwords = ["CenterFreq", "ADFrequency", "IFFrequency", "Bandwidth", "IQOffset", "DBOffset", "MaxVal"];
    const shown = Math.min(dwords.length, Math.max(0, (auxi.size - 32) >> 2));
    for (let i = 0; i < shown; i++) {
      const v = b.readUInt32LE(a + 32 + i * 4);
      if (i === 0) {
        if (looksLikeSysTime && auxi.size >= 36 && v > 0) { metaCentre = v; metaSource = "auxi binary CenterFreq (+32)"; }
        console.log(`  ${dwords[i].padEnd(11)} ${hz(v)}${v === 0 ? "   (zero -- Bridge falls back to the filename)" : ""}${looksLikeSysTime ? "" : "   [offset +32; field name is the struct's, not this writer's]"}`);
        if (looksLikeSysTime && v > 0) sawStructTail = true;
      } else if (v) {
        // Once a field has read zero, a later non-zero value means this writer is not
        // filling the struct -- report the offset, do not assert the struct's field name.
        const named = looksLikeSysTime && sawStructTail;
        console.log(`  ${(named ? dwords[i] : "+" + (32 + i * 4)).padEnd(11)} ${hz(v)}${named ? "" : "   [unnamed: preceding field was zero]"}`);
      } else sawStructTail = false;
    }
    if (auxi.size < 36) note(`auxi is only ${auxi.size} bytes: Bridge's auxLen>=36 gate fails, so no centre is read from it.`);
    const tail = 32 + shown * 4;
    const region = b.toString("latin1", a + tail, a + auxi.size);
    const rx = /[\x20-\x7e]{6,}/g;
    let mm, found = 0;
    while ((mm = rx.exec(region)) !== null) {
      if (!found++) console.log(`  trailing    ${auxi.size - tail} bytes past the known dwords`);
      const at = tail + mm.index;
      const lead = at > 0 ? b[a + at - 1] : -1;
      console.log(`    +${String(at).padEnd(4)} ${JSON.stringify(mm[0])}`);
      console.log(`         preceding byte 0x${lead < 0 ? "--" : lead.toString(16).padStart(2, "0")}` +
        (lead >= 0x20 && lead < 0x7f ? ` (${JSON.stringify(String.fromCharCode(lead))})` : ""));
    }
  }
  if (auxi.afterData) note("The auxi chunk sits after data -- Bridge stops walking at data and will never read it.");
} else {
  note("No auxi chunk: the centre frequency can only come from the filename.");
}
if (!auxi && bext !== null) console.log("\nbext        present (BWF) -- Bridge uses it for the start time only, never for the centre.");

// ---- filename -- Bridge's parseCentreHz, character for character ------------
// index.html: /(\d+(?:\.\d+)?)\s*([kKmMgG])?[Hh][Zz]/ , unanchored, with a
// 6-digit guard on a bare Hz unit so a stray "105Hz" cannot be read as a centre.
function parseCentreHz(name) {
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*([kKmMgG])?[Hh][Zz]/);
  if (!m) return NaN;
  const v = Number(m[1]), u = (m[2] || "").toLowerCase();
  if (!u) return m[1].replace(/\D/g, "").length >= 6 ? v : NaN;
  return Math.round(v * (u === "k" ? 1e3 : u === "m" ? 1e6 : 1e9));
}
const name = path.basename(file);
const raw = name.match(/(\d+(?:\.\d+)?)\s*([kKmMgG])?[Hh][Zz]/);
const nameHz = parseCentreHz(name);
console.log("\nfilename");
if (raw) {
  console.log(`  match       "${raw[0]}"  unit ${raw[2] ? `'${raw[2]}'` : "none (bare Hz)"}`);
  console.log(`  parses to   ${isFinite(nameHz) ? hz(nameHz) : "NaN -- rejected"}`);
  if (!raw[2] && !isFinite(nameHz)) note(`Bare "Hz" with only ${raw[1].replace(/\D/g, "").length} digits -- under the 6-digit guard, so Bridge rejects it. This is the guard working, not a bug.`);
  if (!raw[2] && isFinite(nameHz)) note("Filename gives a bare Hz unit with no k/M/G multiplier. Record which program wrote this name -- writers differ, and the unit is the thing under test.");
} else {
  console.log("  match       none");
}

// ---- what Bridge will actually do -----------------------------------------
// loadFile: centreHz = isFinite(meta) ? meta : nameHz, and a >50 kHz disagreement is logged.
console.log("\nBridge verdict");
const chosen = (metaCentre != null && isFinite(metaCentre)) ? metaCentre : (isFinite(nameHz) ? nameHz : null);
if (chosen == null) {
  console.log("  centre      none -- file decodes at its own centre, absolute tuning unavailable");
} else {
  console.log(`  centre      ${mhz(chosen)}   from ${metaCentre != null ? metaSource : "the filename"}`);
  if (metaCentre != null && isFinite(nameHz)) {
    const d = Math.abs(metaCentre - nameHz);
    console.log(`  filename    ${mhz(nameHz)}   ${d > 50000 ? `DISAGREES by ${(d / 1e3).toFixed(1)} kHz -- Bridge logs a warning and uses the metadata` : "agrees"}`);
    if (d > 50000) note("Metadata and filename disagree by more than 50 kHz. Bridge prefers the metadata and says so in the log. A stale embedded filename from earlier in a recording session is a known cause.");
  }
}
if (ch !== 2 || !(bits === 16 || bits === 32)) console.log("  opens       NO -- rejected at load (see warnings)");

// ---- summary --------------------------------------------------------------
console.log(warn.length ? "\nwarnings" : "\nno warnings");
warn.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
