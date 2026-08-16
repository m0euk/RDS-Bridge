#!/usr/bin/env node
/* antcfg_test.js -- per-antenna settings: storage, keying, planning and verification.
 *
 *   node test/antcfg_test.js [build.html]     (default ../index.html)
 *
 * Drives the REAL extracted antCfg* functions in a vm against a stub localStorage. No fixture
 * files, no jsdom, deterministic.
 *
 * WHY THIS EXISTS. From 0.12.0 an antenna change writes gain and spectrum-scale settings to the
 * radio. Two failure modes here are SILENT and both produce data that looks exactly like good data:
 *
 *   1. A verification that always says "honoured". SDRconnect answers every property as a STRING
 *      ("10"), a saved record holds a NUMBER (10), and === between them is false. A verifier written
 *      without that in mind reports every successful write as refused; one written carelessly the
 *      other way reports every failed write as honoured. GROUP 3 pins both directions.
 *
 *   2. Cross-device contamination. "Antenna A" on an RSPdxR2 and "Antenna A" on any other radio are
 *      different ports. Records are keyed by active_device (which carries the serial) then port, so
 *      swapping radios cannot silently apply one rig's gain to another's front end. GROUP 2.
 *
 * GROUP 4 covers the plan: a record must never write a property it does not hold. A record saved by
 * an older build, or one where a property never answered, would otherwise set_property("undefined").
 *
 * WHAT THIS SUITE CANNOT REACH. The capture and apply paths are timer- and socket-driven and the
 * panel is DOM. Those are hardware sign-off, not sim -- as the project's own note about the mock
 * harness and ws.close() says. This suite defends the model underneath them.
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

function grab(name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) throw new Error("antcfg_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
function grabOpt(name) { try { return grab(name); } catch (e) { return ""; } }

const keyLine = (src.match(/var ANTCFG_KEY=.*?;/) || [""])[0];

const NAMES = ["antCfgAll", "antCfgWriteAll", "antCfgDev", "antCfgGet", "antCfgPut",
               "antCfgForget", "antCfgName", "antCfgSame", "antCfgPlan", "antCfgDesc",
               "antCfgIfTxt", "antCfgIfRemind", "antCfgEdit", "antCfgIfAdvice"];
const CODE = [keyLine].concat(NAMES.map(grabOpt)).join("\n\n");

/* A stub localStorage that can also be made to REFUSE, which is the file:// / private-mode case. */
let store = {}, refuse = false;
const localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { if (refuse) throw new Error("QuotaExceeded"); store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};

/* antCfgEdit and antCfgIfRemind reach for the DOM renderer and the activity log. Stub both: this
   suite is about the model, and the log stub doubles as an assertion surface for GROUP 8. */
let logged = [];
const ctx = { Math, Number, String, Object, JSON, isFinite, Date, console, localStorage, prop: {},
              antCfgRender() {}, antCfgSync() {},
              log(kind, msg) { logged.push({ kind, msg }); },
              antCfgLastIf: null, antNames: [] };
vm.createContext(ctx);
vm.runInContext(CODE + "\n;" + NAMES.map(n => `try{this.${n}=${n};}catch(e){}`).join("") +
                "\n;try{this.ANTCFG_KEY=ANTCFG_KEY;}catch(e){}", ctx);

const A = ctx;
let pass = 0, fail = 0;
function ok(c, w) { if (c) pass++; else { fail++; console.log("  FAIL: " + w); } }
/* A mutant that makes the build THROW must still be reported as a failed check. run-all.js parses
   "N passed, M failed" and nothing else, so a suite that dies reads as a broken runner rather than
   as a defect found -- and a broken runner gets investigated as a test problem. Every call into the
   build goes through this. (Lesson recorded in the 0.11.2 handover; five mutants did exactly that.) */
function tryv(fn, w, dflt) { try { return fn(); } catch (e) { fail++; console.log("  FAIL: " + w + " -- threw: " + e.message); return dflt; } }
/* And read fields off the RESULT safely too. tryv alone is not enough: antCfgGet legitimately
   returns null, so `tryv(...).lna_state` throws inside the SUITE, which is the same broken-runner
   outcome by a different route. Found by the put-drops-device mutant. */
function fieldOf(fn, key, w) { const r = tryv(fn, w, null); return (r && typeof r === "object") ? r[key] : undefined; }
function group(t) { console.log("\n" + t); }
function reset() { store = {}; refuse = false; ctx.prop = {}; logged = []; ctx.antCfgLastIf = null; ctx.antNames = []; }

const MISSING = NAMES.filter(n => typeof A[n] !== "function");
if (MISSING.length) {
  console.log("\n  FAIL: build lacks " + MISSING.join(", "));
  console.log("\n0 passed, 1 failed");
  process.exit(1);
}

/* ---------- GROUP 1: round trip -------------------------------------------------------- */
group("GROUP 1 -- a saved port survives a round trip");
reset();
ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
{
  const rec = { lna_state: 8, spectrum_base: -134, spectrum_ref_level: -33, label: "vertical" };
  ok(tryv(() => A.antCfgPut("Antenna C", rec), "put must not throw", null) === true, "put reports success");
  const got = A.antCfgGet("Antenna C");
  ok(!!got, "get returns the record");
  ok(!!got && got.lna_state === 8, "lna_state survives");
  ok(got && got.spectrum_base === -134, "spectrum_base survives");
  ok(got && got.spectrum_ref_level === -33, "spectrum_ref_level survives");
  ok(A.antCfgGet("Antenna A") === null, "an unsaved port returns null, not an empty record");
  ok(A.antCfgName("Antenna C") === "vertical", "the label is the display name");
  ok(A.antCfgName("Antenna A") === "Antenna A", "an unnamed port displays as its port name");
  ok(A.antCfgForget("Antenna C") === true, "forget reports success");
  ok(A.antCfgGet("Antenna C") === null, "and the record is gone");
  ok(A.antCfgForget("Antenna C") === false, "forgetting nothing reports false, not true");
}

/* ---------- GROUP 2: device keying ------------------------------------------------------ */
group("GROUP 2 -- one radio's ports cannot be applied to another's");
reset();
{
  ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
  tryv(() => A.antCfgPut("Antenna A", { lna_state: 10, spectrum_base: -129 }), "put must not throw", null);
  ctx.prop["active_device"] = "RSPduo (1809999A11)";
  ok(tryv(() => A.antCfgGet("Antenna A"), "get must not throw", 0) === null, "same port name on a different radio reads as unsaved");
  tryv(() => A.antCfgPut("Antenna A", { lna_state: 3, spectrum_base: -100 }), "put must not throw", null);
  ok(fieldOf(() => A.antCfgGet("Antenna A"), "lna_state", "get must not throw") === 3, "the second radio has its own record");
  ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
  ok(fieldOf(() => A.antCfgGet("Antenna A"), "lna_state", "get must not throw") === 10, "and the first radio's is untouched");
  ctx.prop["active_device"] = "RSPduo (1809999A11)";
  A.antCfgForget("Antenna A");
  ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
  ok(!!A.antCfgGet("Antenna A"), "forgetting on one radio does not delete the other's");
  delete ctx.prop["active_device"];
  ok(A.antCfgGet("Antenna A") === null, "with no device reported, another rig's record is not adopted");
}

/* ---------- GROUP 3: verification, both directions --------------------------------------- */
group("GROUP 3 -- antCfgSame compares a stored number against SDRconnect's string");
{
  ok(A.antCfgSame(8, "8") === true, "8 vs \"8\" is the SAME (string/number is the whole trap)");
  ok(A.antCfgSame("8", 8) === true, "and the other way round");
  ok(A.antCfgSame(-134, "-134") === true, "negative values compare");
  ok(A.antCfgSame(-33, "-33.0") === true, "a Double formatted with a decimal still compares");
  ok(A.antCfgSame(8, "10") === false, "a refused write is reported as DIFFERENT");
  ok(A.antCfgSame(8, "9") === false, "one LNA step out is different, not rounded away");
  ok(A.antCfgSame(-134, "-129") === false, "a Base that did not take is different");
  ok(A.antCfgSame(8, undefined) === null, "no answer is null -- neither honoured nor refused");
  ok(A.antCfgSame(8, null) === null, "a null answer is null");
  ok(A.antCfgSame(8, "") === null, "an empty answer is null, not zero");
  ok(A.antCfgSame(8, "junk") === null, "an unparseable answer is null");
  ok(A.antCfgSame(undefined, "8") === null, "nothing asked for is null");
}

/* ---------- GROUP 4: the write plan ------------------------------------------------------ */
group("GROUP 4 -- a record never writes a property it does not hold");
{
  const full = A.antCfgPlan({ lna_state: 8, spectrum_base: -134, spectrum_ref_level: -33 });
  ok(full.length === 3, "a complete record plans three writes");
  ok(full.every(w => typeof w.value === "string"), "every value is a string (the API takes strings)");
  ok(full.map(w => w.property).join(",") === "lna_state,spectrum_base,spectrum_ref_level",
     "and only those three properties");

  const partial = A.antCfgPlan({ lna_state: 8 });
  ok(partial.length === 1, "a record holding one property plans one write");

  ok(A.antCfgPlan({}).length === 0, "an empty record plans nothing");
  ok(A.antCfgPlan(null).length === 0, "no record plans nothing (and does not throw)");
  ok(A.antCfgPlan({ lna_state: undefined, spectrum_base: -134 }).length === 1,
     "an undefined entry is skipped, never written as \"undefined\"");
  ok(A.antCfgPlan({ lna_state: null }).length === 0, "a null entry is skipped");
  ok(A.antCfgPlan({ lna_state: "junk" }).length === 0, "an unparseable entry is skipped");
  ok(A.antCfgPlan({ label: "vertical" }).length === 0, "the label is not a property to write");
  ok(A.antCfgPlan({ saved: "2026-08-15T18:00:00Z", device: "x" }).length === 0,
     "bookkeeping fields are not written to the radio");
  /* agc_enable / agc_threshold are AUDIO AGC and must never be restored per antenna. */
  ok(A.antCfgPlan({ agc_enable: 1, agc_threshold: 100 }).length === 0,
     "audio AGC is never planned, even if some record somehow carries it");
}

/* ---------- GROUP 5: storage that fails or is corrupt ------------------------------------ */
group("GROUP 5 -- broken storage degrades, never throws");
reset();
ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
{
  refuse = true;
  ok(A.antCfgPut("Antenna A", { lna_state: 8 }) === false,
     "a refused write reports false so the caller can say so (file:// / private mode)");
  refuse = false;

  store["rdsb.antcfg"] = "{not json";
  let threw = false;
  try { A.antCfgAll(); } catch (e) { threw = true; }
  ok(!threw, "corrupt JSON does not throw");
  ok(tryv(() => A.antCfgGet("Antenna A"), "get on corrupt storage must not throw", 0) === null, "corrupt JSON reads as nothing saved");

  store["rdsb.antcfg"] = '"a string"';
  ok(tryv(() => A.antCfgGet("Antenna A"), "get on a string payload must not throw", 0) === null, "a non-object payload reads as nothing saved");

  store["rdsb.antcfg"] = "null";
  ok(tryv(() => A.antCfgGet("Antenna A"), "get on a null payload must not throw", 0) === null, "a null payload reads as nothing saved");

  store["rdsb.antcfg"] = '{"RSPdxR2 (2402087D70)":{"Antenna A":{"lna_state":10}}}';
  ok(fieldOf(() => A.antCfgGet("Antenna A"), "lna_state", "get must not throw") === 10, "and a good payload still reads back");
}

/* ---------- GROUP 6: the description shown to the user ------------------------------------ */
group("GROUP 6 -- the summary line says what is actually stored");
{
  const d = A.antCfgDesc({ lna_state: 8, spectrum_base: -134, spectrum_ref_level: -33 });
  ok(/RF gain 8/.test(d), "names the RF gain");
  ok(/Base -134/.test(d), "names the Base");
  ok(/Ref -33/.test(d), "names the Ref");
  ok(!/IF/.test(d), "never mentions IF gain -- the API cannot read or write it");
  ok(A.antCfgDesc(null) === "nothing saved", "no record says so plainly");
  ok(A.antCfgDesc({}) === "nothing saved", "an empty record says so plainly");
  ok(/RF gain 0/.test(A.antCfgDesc({ lna_state: 0 })), "lna_state 0 is a real value, not absent");
  ok(/Base 0/.test(A.antCfgDesc({ spectrum_base: 0 })), "a zero Base is a real value, not absent");
}

/* ---------- GROUP 8: the IF note -- recorded, never written -----------------------------
   SDRconnect exposes no IF gain and no IF AGC property (1,034 novel names probed 15-Aug, all
   silent, against an instrument that answered all 18 published ones). These two fields therefore
   record what a port NEEDS so Bridge can tell the user to set it. The failure that matters is
   them ever reaching the radio, or ever being described as applied.                            */
group("GROUP 8 -- the IF note is stored and reminded, never written to the radio");
reset();
ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
{
  ok(A.antCfgIfTxt({ if_auto: true }) === "IF AGC on (auto)", "auto reads as auto");
  ok(A.antCfgIfTxt({ if_gain: 39 }) === "IF Gain 39 dB", "a manual value reads in dB");
  ok(A.antCfgIfTxt({ if_gain: 0 }) === "IF Gain 0 dB", "0 dB is a real value, not absent");
  ok(A.antCfgIfTxt({}) === "", "no note reads as empty");
  ok(A.antCfgIfTxt(null) === "", "no record reads as empty");
  ok(A.antCfgIfTxt({ if_gain: "junk" }) === "", "an unparseable note reads as empty");
  ok(A.antCfgIfTxt({ if_auto: true, if_gain: 39 }) === "IF AGC on (auto)", "auto wins if both are somehow set");

  /* THE ONE THAT MATTERS: an IF note must never become a set_property. */
  ok(A.antCfgPlan({ if_auto: true, if_gain: 39, lna_state: 8 }).length === 1,
     "a record with an IF note plans only the lna_state write");
  ok(A.antCfgPlan({ if_gain: 39 }).length === 0, "an IF note alone plans nothing at all");
  ok(A.antCfgPlan({ if_auto: true }).length === 0, "IF AGC alone plans nothing at all");

  /* And must never be described as something Bridge applied. */
  ok(!/IF/.test(A.antCfgDesc({ lna_state: 8, if_gain: 39, if_auto: false })),
     "the applied-settings summary never mentions IF");

  /* Editing: auto and manual are mutually exclusive, either way round. */
  tryv(() => A.antCfgEdit("Antenna C", "if_gain", "39"), "edit must not throw");
  ok(fieldOf(() => A.antCfgGet("Antenna C"), "if_gain", "get") === 39, "a manual value is stored as a number");
  tryv(() => A.antCfgEdit("Antenna C", "if_auto", true), "edit must not throw");
  ok(fieldOf(() => A.antCfgGet("Antenna C"), "if_auto", "get") === true, "ticking auto stores auto");
  ok(fieldOf(() => A.antCfgGet("Antenna C"), "if_gain", "get") === undefined, "and clears the manual value");
  tryv(() => A.antCfgEdit("Antenna C", "if_gain", "37"), "edit must not throw");
  ok(fieldOf(() => A.antCfgGet("Antenna C"), "if_auto", "get") === undefined, "typing a manual value clears auto");
  tryv(() => A.antCfgEdit("Antenna C", "if_gain", ""), "edit must not throw");
  ok(fieldOf(() => A.antCfgGet("Antenna C"), "if_gain", "get") === undefined, "clearing the field removes the note");

  /* A name or an IF note is worth keeping for a port whose gain was never captured. */
  reset(); ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
  tryv(() => A.antCfgEdit("Antenna B", "label", "MW loop"), "edit must not throw");
  ok(A.antCfgName("Antenna B") === "MW loop", "a label alone creates a record");
  ok(A.antCfgPlan(A.antCfgGet("Antenna B")).length === 0, "and that record writes nothing to the radio");
}

group("GROUP 9 -- the reminder fires on a change of note, and not otherwise");
reset();
ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
{
  A.antCfgPut("Antenna A", { lna_state: 10, if_gain: 38 });
  A.antCfgPut("Antenna C", { lna_state: 8, if_gain: 39 });
  A.antCfgPut("Antenna B", { lna_state: 5 });

  logged = []; ctx.antCfgLastIf = null;
  tryv(() => A.antCfgIfRemind("Antenna A"), "remind must not throw");
  ok(logged.length === 1, "the first switch reminds");
  ok(/38 dB/.test(logged[0].msg || ""), "and names the value the port wants");
  ok(/cannot set this/.test(logged[0].msg || ""),
     "and says plainly that Bridge cannot set it -- the whole point of the field");

  logged = [];
  tryv(() => A.antCfgIfRemind("Antenna A"), "remind must not throw");
  ok(logged.length === 0, "the same note again does not repeat (rotation would say it every pass)");

  logged = [];
  tryv(() => A.antCfgIfRemind("Antenna C"), "remind must not throw");
  ok(logged.length === 1, "a different note reminds again");
  ok(/39 dB/.test(logged[0].msg || ""), "with the new value");

  logged = [];
  tryv(() => A.antCfgIfRemind("Antenna B"), "remind must not throw");
  ok(logged.length === 0, "a port with no note says nothing");
  logged = [];
  tryv(() => A.antCfgIfRemind("Antenna C"), "remind must not throw");
  ok(logged.length === 1, "and after a note-less port, the next note is said again rather than suppressed");
}

group("GROUP 10 -- the cross-port IF advice reports the spread and judges nothing");
reset();
ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
ctx.antNames = ["Antenna A", "Antenna B", "Antenna C"];
{
  let a = tryv(() => A.antCfgIfAdvice(), "advice must not throw", "");
  ok(/Note what each port needs/.test(a), "with nothing noted, it asks for notes rather than inventing advice");

  A.antCfgPut("Antenna A", { if_gain: 38 });
  A.antCfgPut("Antenna C", { if_gain: 39 });
  a = tryv(() => A.antCfgIfAdvice(), "advice must not throw", "");
  ok(/38/.test(a) && /39/.test(a), "it names each port's wanted value");
  ok(/spread of 1 dB/.test(a), "it states the spread as a number");
  ok(/38\u2013?39|38-39/.test(a.replace(/\u2013/g, "-")), "and the range");
  ok(!/too (wide|close)|acceptable|fine|good enough/i.test(a),
     "it does NOT judge whether the spread is workable -- that depends on antennas Bridge cannot see");

  A.antCfgPut("Antenna C", { if_gain: 38 });
  a = tryv(() => A.antCfgIfAdvice(), "advice must not throw", "");
  ok(/same value/.test(a) && /38 dB/.test(a), "identical wants get a single concrete instruction");
  ok(!/spread/.test(a), "and no spread is reported when there is none");

  reset(); ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
  ctx.antNames = ["Antenna A", "Antenna C"];
  A.antCfgPut("Antenna A", { if_auto: true });
  A.antCfgPut("Antenna C", { if_auto: true });
  a = tryv(() => A.antCfgIfAdvice(), "advice must not throw", "");
  ok(/All of them want IF AGC on/.test(a), "all-auto is a single instruction, not a spread");

  A.antCfgPut("Antenna C", { if_gain: 39 });
  a = tryv(() => A.antCfgIfAdvice(), "advice must not throw", "");
  ok(/no single SDRConnect setting/.test(a), "auto mixed with manual is called out as having no single answer");

  /* A port with a record but no IF note must not appear as though it wanted something. */
  reset(); ctx.prop["active_device"] = "RSPdxR2 (2402087D70)";
  ctx.antNames = ["Antenna A", "Antenna B"];
  A.antCfgPut("Antenna A", { if_gain: 38 });
  A.antCfgPut("Antenna B", { lna_state: 5 });
  a = tryv(() => A.antCfgIfAdvice(), "advice must not throw", "");
  ok(!/Antenna B/.test(a), "a port with gain saved but no IF note is not listed as wanting anything");
  ok(/38/.test(a), "and the port that does want something still is");
}

/* ---------- GROUP 7: structural, for what the vm cannot reach ----------------------------- */
group("GROUP 7 -- apply is wired only to a Bridge-initiated change (structural)");
{
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/if\(wasAsked\)\s*antCfgApply\(name\)/.test(stripped),
     "antCfgApply runs only when Bridge asked for the port -- never on the connect-time readback");
  const applies = stripped.match(/antCfgApply\(/g) || [];
  /* 0.12.0-cand.11: TWO call sites now, and the count is asserted so a third cannot appear
     unnoticed. (1) the antenna readback, for a change Bridge asked for. (2) the rotation driver's
     no-switch path \u2014 pass 1 runs on the port already selected and must still start from that
     port's saved settings, or it measures at whatever the radio happened to hold. */
  ok(applies.length === 3,
     "antCfgApply has one definition and exactly two call sites (found " + applies.length + ")");
  ok(/if\(wasAsked\) antCfgApply\(name\)/.test(stripped) && /antCfgApply\(want\)/.test(stripped),
     "and they are the readback path and the rotation no-switch path, nothing else");
  ok(/antCfgApply\(name\)/.test(stripped) && !/antCfgApply\(antWant\)/.test(stripped),
     "it applies for the port the radio REPORTED, not the one requested (a reroute must get the right settings)");
  ok(/getProp\(w\.property\)/.test(stripped),
     "apply re-reads each property rather than trusting the write");
  ok(/antCfgIfRemind\(/.test(stripped), "the IF reminder is wired into the apply path");
  /* Capture runs inside a setTimeout, so the vm cannot reach it. Structural, and honest about it:
     Save Settings re-reads the RADIO and must carry the user's own fields through, or a re-save
     silently wipes the port name and the IF note they typed. Caught here and nowhere else. */
  ok(/var prev=antCfgGet\(port,dev\);/.test(stripped),
     "capture reads the existing record before overwriting it");
  /* The user's fields are declared ONCE, and the capture carries that list. Enumerating the field
     names here instead would restate the implementation and pass while a newly-added field went
     uncarried -- which is exactly how `rotate` was dropped at 0.12.0. Assert the LIST is complete,
     then DRIVE the carry-through and read what actually survives. */
  const userDecl = src.match(/var ANTCFG_USER\s*=\s*\[([^\]]*)\]/);
  ok(!!userDecl, "the user-field list ANTCFG_USER is declared");
  const userFields = userDecl ? userDecl[1].split(",").map(x => x.trim().replace(/^["']|["']$/g, "")) : [];
  ["label", "if_auto", "if_gain", "rotate"].forEach(f => {
    ok(userFields.indexOf(f) >= 0, "ANTCFG_USER includes the user field \"" + f + "\"");
  });
  /* Behavioural: run the real carry-through with a record holding every user field set, and a
     fresh radio read, then check nothing the user typed or ticked was lost. */
  {
    const carry = src.match(/var prev=antCfgGet\(port,dev\);[\s\S]*?\n(?=\s*rec\.saved)/);
    let survived = null;
    if (carry) {
      reset(); ctx.prop["active_device"] = "RSPdxR2 (CARRY)";
      ctx.antNames = ["Antenna A"];
      A.antCfgPut("Antenna A", { lna_state: 8, spectrum_base: -129, spectrum_ref_level: -33,
                                 label: "vertical", if_gain: 12, rotate: true });
      const sandbox = {
        antCfgGet: A.antCfgGet, ANTCFG_USER: userFields,
        port: "Antenna A", dev: "RSPdxR2 (CARRY)",
        rec: { lna_state: 9, spectrum_base: -129, spectrum_ref_level: -33 }
      };
      try {
        new Function("antCfgGet", "ANTCFG_USER", "port", "dev", "rec",
                     carry[0] + "; return rec;")(sandbox.antCfgGet, sandbox.ANTCFG_USER,
                     sandbox.port, sandbox.dev, sandbox.rec);
        survived = sandbox.rec;
      } catch (e) { survived = null; }
    }
    ok(survived && survived.rotate === true && survived.label === "vertical" && survived.if_gain === 12
       && Number(survived.lna_state) === 9,
       "a re-save keeps the tick, the name and the IF note, and takes the NEW gain from the radio");
  }
  ANTCFG_CHECK: {
    const m = src.match(/var ANTCFG_KEY="[^"]+",\s*ANTCFG_PROPS=\[([^\]]*)\]/);
    ok(!!m, "ANTCFG_PROPS is declared");
    if (m) {
      ok(!/agc_/.test(m[1]), "audio AGC is not in the stored property list");
      ok(!/if_/.test(m[1]), "the IF note is not in the written property list");
      ok(/lna_state/.test(m[1]) && /spectrum_base/.test(m[1]) && /spectrum_ref_level/.test(m[1]),
         "the three writable properties are");
    }
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
