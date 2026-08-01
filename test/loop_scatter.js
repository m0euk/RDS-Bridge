/* loop_scatter.js — the experiment that decided 0.10.1's loop-accumulation design.
   NOT part of run-all.js: it takes minutes, and it is an experiment, not a regression test.
   Run deliberately:  node test/loop_scatter.js            (tests ./index.html beside test/)
                      node test/loop_scatter.js path/to/build.html
   NOTE: earlier docs said `../index.html`. From the folder holding index.html and test/, that
   resolves one level ABOVE the build. Pass nothing, or pass a real path.

   Question it answers (the handover's "prove the scatter before building it"):
     1. Is a replayed loop pass deterministic?              -> yes, bit-for-bit
     2. Does jittering the loop start decorrelate the read?  -> yes
     3. Do spurious PIs repeat across jittered alignments?   -> no, in 48 noise alignments
     4. Can PS characters be majority-voted across passes?   -> NO. It fabricated one.

   Everything here is seeded. Two runs of this file are the same run. */
"use strict";
const path = require("path");
const { Rx } = require("./rig");
const { makeIQ, makeNoise } = require("./rdsgen");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const RATE = 256000, SEC = 3;
const JIT = [0, .137, .291, .052, .418, .203, .366, .089, .244, .311];

const r = new Rx(BUILD);
console.log("build   : " + BUILD);
console.log("worker  : " + r.workerSha + "\n");

/* One loop pass: reset, re-apply settings, feed [from, from+SEC). */
function pass(iq, fromFrame, bw){
  r.send({ type: "reset" });
  r.send({ type: "rate", rate: RATE });
  r.send({ type: "bandwidth", v: bw || 200000 });
  const a = fromFrame * 2, b = Math.min(iq.length, a + SEC * RATE * 2), CH = 51200;
  for(let o = a; o < b; o += CH) r.feed(iq.slice(o, Math.min(o + CH, b)));
  return r.snap();
}
const hex = v => v === null ? "-" : "0x" + v.toString(16);

/* ── 1. determinism ─────────────────────────────────────────────────────── */
console.log("== 1. Six identical passes, and six with the chunk size varied ==");
{
  const iq = makeIQ({ rate: RATE, seconds: 5, pi: 0xC202, ps: "TESTFM", snrDb: 8, seed: 7 });
  const sig = s => [hex(s.piRaw), s.piVotes, JSON.stringify(s.ps), s.good, s.corr, s.bad, s.dataQ.toFixed(9)].join("|");
  const base = sig(pass(iq, RATE, 200000));
  let same = 0;
  for(let i = 0; i < 5; i++) if(sig(pass(iq, RATE, 200000)) === base) same++;
  console.log("   identical passes matching the first : " + same + "/5");
  /* wall-clock pacing gives every pass a different chunk pattern; it must not matter */
  let chunkSame = 0;
  for(const CH of [8192, 65536, 22222, 6000, 131072]){
    r.send({ type: "reset" }); r.send({ type: "rate", rate: RATE }); r.send({ type: "bandwidth", v: 200000 });
    const a = RATE * 2, b = a + SEC * RATE * 2;
    for(let o = a; o < b; o += CH) r.feed(iq.slice(o, Math.min(o + CH, b)));
    if(sig(r.snap()) === base) chunkSame++;
  }
  console.log("   passes matching under varied chunking: " + chunkSame + "/5");
  console.log("   => a loop that changes nothing learns nothing. Accumulation needs variation.\n");
}

/* ── 2/3. scatter ───────────────────────────────────────────────────────── */
function trial(label, iq){
  console.log("== " + label + " ==");
  const tally = {}; let committed = 0;
  for(const j of JIT){
    const s = pass(iq, Math.round((1 + j) * RATE), 200000);
    if(s.piRaw !== null){ const k = hex(s.piRaw); tally[k] = (tally[k] || 0) + 1; }
    if(s.pi !== null) committed++;
    console.log("   +" + String((j * 1000).toFixed(0)).padStart(3) + " ms  raw=" + hex(s.piRaw).padEnd(7)
      + " committed=" + hex(s.pi).padEnd(7) + " votes=" + String(s.piVotes).padStart(3)
      + "  ps=" + JSON.stringify(s.ps));
  }
  console.log("   tally over " + JIT.length + " alignments: " + JSON.stringify(tally)
    + "  (committed in " + committed + ")\n");
  return tally;
}
trial("2. Marginal signal, 8.0 dB — genuine PI 0xC202",
      makeIQ({ rate: RATE, seconds: 8, pi: 0xC202, ps: "TESTFM", snrDb: 8.0, seed: 7 }));
trial("3. Below the cliff, 7.5 dB — genuine PI 0xC202",
      makeIQ({ rate: RATE, seconds: 8, pi: 0xC202, ps: "TESTFM", snrDb: 7.5, seed: 7 }));

/* ── 4. negative control ────────────────────────────────────────────────── */
console.log("== 4. NEGATIVE CONTROL — noise only, 6 seeds x 8 alignments ==");
{
  const J = JIT.slice(0, 8);
  let repeats = 0, raw = 0, committed = 0;
  for(let sd = 1; sd <= 6; sd++){
    const iq = makeNoise({ rate: RATE, seconds: 8, seed: sd * 97 });
    const tally = {};
    for(const j of J){
      const s = pass(iq, Math.round((1 + j) * RATE), 200000);
      if(s.piRaw !== null){ const k = hex(s.piRaw); tally[k] = (tally[k] || 0) + 1; raw++; }
      if(s.pi !== null) committed++;
    }
    const mx = Math.max(0, ...Object.values(tally));
    if(mx >= 2) repeats++;
    console.log("   seed " + sd + "  distinct=" + Object.keys(tally).length
      + "  maxRepeat=" + mx + "  " + JSON.stringify(tally));
  }
  console.log("   => spurious raw reads " + raw + " in 48 alignments; "
    + repeats + "/6 seeds had any PI repeat; " + committed + " ever committed.\n");
}

/* ── 5. the one that says NO ────────────────────────────────────────────── */
console.log("== 5. Can PS be majority-voted across passes? ==");
{
  const iq = makeIQ({ rate: RATE, seconds: 8, pi: 0xC202, ps: "TESTFM", snrDb: 8.0, seed: 7 });
  const votes = Array.from({ length: 8 }, () => ({}));
  for(const j of JIT){
    const ps = pass(iq, Math.round((1 + j) * RATE), 200000).ps || "";
    for(let i = 0; i < 8; i++){ const c = ps[i]; if(c && c !== " ") votes[i][c] = (votes[i][c] || 0) + 1; }
  }
  let best = "";
  votes.forEach(v => { let bc = " ", bn = 0; for(const c in v) if(v[c] > bn){ bn = v[c]; bc = c; } best += bc; });
  console.log("   truth              : " + JSON.stringify("TESTFM  "));
  console.log("   per-character vote : " + JSON.stringify(best));
  console.log("   votes              : " + votes.map(v => JSON.stringify(v)).join(""));
  console.log("   => a character that is NOT in the signal repeated across passes.");
  console.log("      PS must not be synthesised from a cross-pass majority.");
}
