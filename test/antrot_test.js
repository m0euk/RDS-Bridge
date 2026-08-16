#!/usr/bin/env node
/* antrot_test.js -- antenna rotation: eligibility, the pass->port cycle, and the three keys that
 * make a verdict belong to one antenna rather than to all of them.
 *
 *   node test/antrot_test.js [build.html]     (default ../index.html)
 *
 * WHY THIS EXISTS. Rotation is only worth having because a verdict taken on one antenna is not
 * evidence about another. Measured 15-Aug-2026 on the RSPdxR2: 88.1 MHz read 4.7 and 5.0 u8 on
 * Antenna A either side of 23.2 u8 on Antenna C, and only C produced an identification. Two strikes
 * on A, and a channel-keyed dead list would have stopped the vertical ever being given that channel.
 *
 * Three keys therefore had to change, and every one of them fails SILENTLY if it is wrong:
 *   dead list  -- a channel struck on one port stays struck on all of them (a lost catch, invisible)
 *   clip dedup -- the second port never writes a clip for a station the first caught (no comparison)
 *   DX log     -- the second port enriches the first port's row (one row silently mixing antennas)
 *
 * GROUP 5 pins the "" case in every one of them: with rotation off, every key must be BYTE-IDENTICAL
 * to what 0.11.2 produced. A single-antenna user must not be able to tell this release changed
 * anything, and old DX rows carry no `ant` at all.
 */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");

function grab(name) {
  const sig = "function " + name + "(";
  const at = src.indexOf(sig);
  if (at < 0) throw new Error("antrot_test: cannot find " + name + " in " + BUILD);
  let d = 0, j = src.indexOf("{", at);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) { j++; break; } }
  }
  return src.slice(at, j);
}
function grabOpt(n) { try { return grab(n); } catch (e) { return ""; } }

const keyLine = (src.match(/var ANTCFG_KEY=.*?;/) || [""])[0];
/* Read the re-log window out of the BUILD rather than restating it. A suite that hard-coded 60
   minutes would stop testing the build the day it moved, and findRecentDup would throw on the
   missing constant -- which run-all.js reports as a broken runner, not as a defect. */
const relogLine = (src.match(/var DX_RELOG_MS=[^;]*;/) || ["var DX_RELOG_MS=60*60000;"])[0];
const NAMES = ["antCfgAll", "antCfgWriteAll", "antCfgDev", "antCfgGet", "antCfgPut", "antCfgName",
               "antCfgPlan", "antCfgRotatable", "antRotationPorts", "scanChKey", "scanDeadKey",
               "scanAntName", "findRecentDup", "srKey"];
const CODE = [keyLine, relogLine, 'var scanAnt="";'].concat(NAMES.map(grabOpt)).join("\n\n");

let store = {};
const localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; },
};
const ctx = { Math, Number, String, Object, JSON, isFinite, Date, console, localStorage,
              prop: {}, antNames: [], dxLog: [], latest: null };
vm.createContext(ctx);
vm.runInContext(CODE + "\n;" + NAMES.map(n => `try{this.${n}=${n};}catch(e){}`).join("") +
  "\n;this.setAnt=function(a){ scanAnt=a; };", ctx);

const A = ctx;
let pass = 0, fail = 0;
function ok(c, w) { if (c) pass++; else { fail++; console.log("  FAIL: " + w); } }
function tryv(fn, w, d) { try { return fn(); } catch (e) { fail++; console.log("  FAIL: " + w + " -- threw: " + e.message); return d; } }
function group(t) { console.log("\n" + t); }
function reset() {
  store = {}; ctx.prop = { active_device: "RSPdxR2 (2402087D70)" };
  ctx.antNames = ["Antenna A", "Antenna B", "Antenna C"]; ctx.dxLog = []; ctx.latest = null; A.setAnt("");
}

const MISSING = NAMES.filter(n => typeof A[n] !== "function");
if (MISSING.length) { console.log("\n  FAIL: build lacks " + MISSING.join(", ")); console.log("\n0 passed, 1 failed"); process.exit(1); }

const FULL = { lna_state: 8, spectrum_base: -134, spectrum_ref_level: -33 };

/* ---------- GROUP 1: eligibility -------------------------------------------------------- */
group("GROUP 1 -- only a port Bridge can actually configure may be rotated onto");
reset();
{
  ok(A.antCfgRotatable("Antenna A") === false, "a port with no record is not rotatable");
  A.antCfgPut("Antenna A", { label: "horizontal" });
  ok(A.antCfgRotatable("Antenna A") === false, "a name alone does not make a port rotatable");
  A.antCfgPut("Antenna A", { if_gain: 38 });
  ok(A.antCfgRotatable("Antenna A") === false,
     "an IF note alone does not either -- Bridge cannot apply it, so a pass would run at the previous port's gain");
  A.antCfgPut("Antenna A", FULL);
  ok(A.antCfgRotatable("Antenna A") === true, "saved gain and scale make it rotatable");
}

/* ---------- GROUP 2: selection ---------------------------------------------------------- */
group("GROUP 2 -- the selected set, in the order the radio reports");
reset();
{
  ok(A.antRotationPorts().length === 0, "nothing selected is an empty set, not an error");
  A.antCfgPut("Antenna C", Object.assign({ rotate: true }, FULL));
  A.antCfgPut("Antenna A", Object.assign({ rotate: true }, FULL));
  const p = A.antRotationPorts();
  ok(p.length === 2, "two selected ports are returned");
  ok(p[0] === "Antenna A" && p[1] === "Antenna C",
     "in valid_antennas order, not the order they were saved -- rotation must be predictable");
  A.antCfgPut("Antenna B", { rotate: true, label: "MW loop" });
  ok(A.antRotationPorts().length === 2,
     "a port ticked but not configured is excluded, however it got ticked");
  A.antCfgPut("Antenna C", Object.assign({}, FULL));
  ok(A.antRotationPorts().join(",") === "Antenna A", "unticking removes it");
}

/* ---------- GROUP 3: the pass -> port cycle --------------------------------------------- */
group("GROUP 3 -- one full pass per port, then round again");
{
  /* The build computes rotPorts[(pass-1) % rotPorts.length] inside an async scan driver the vm
     cannot enter. Assert the arithmetic against the same expression, and GROUP 7 pins that the
     build still contains it. */
  const ports = ["Antenna A", "Antenna C"];
  const at = p => ports[(p - 1) % ports.length];
  ok(at(1) === "Antenna A", "pass 1 is the first port");
  ok(at(2) === "Antenna C", "pass 2 is the second");
  ok(at(3) === "Antenna A", "pass 3 wraps to the first");
  const three = ["Antenna A", "Antenna B", "Antenna C"];
  const at3 = p => three[(p - 1) % three.length];
  ok(at3(4) === "Antenna A" && at3(6) === "Antenna C", "three ports cycle over three passes");
}

/* ---------- GROUP 4: the three keys separate the ports ---------------------------------- */
group("GROUP 4 -- a verdict, a clip and a row belong to ONE antenna");
reset();
{
  const chk = A.scanChKey(88100000);
  A.setAnt("Antenna A"); const kA = A.scanDeadKey(chk);
  A.setAnt("Antenna C"); const kC = A.scanDeadKey(chk);
  ok(kA !== kC, "the same channel keys differently on two ports (88.1 MHz: 5.0 u8 on A, 23.2 on C)");
  ok(String(kA).indexOf(String(chk)) === 0 && String(kC).indexOf(String(chk)) === 0,
     "and both still start from the channel key");

  A.setAnt("Antenna A"); ok(A.scanAntName() === "Antenna A", "the port name is the display name by default");
  A.antCfgPut("Antenna A", Object.assign({ label: "horizontal" }, FULL));
  ok(A.scanAntName() === "horizontal", "the user's own name is used when they gave one");

  /* DX rows: same PI, same frequency, different antenna -> a different row. */
  ctx.dxLog = [{ pi: 0xC202, freq: "88.1", ant: "horizontal", lastTs: new Date().toISOString() }];
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now(), "horizontal"), "findRecentDup must not throw", 0) !== null,
     "the same station on the same antenna finds its own row");
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now(), "vertical"), "findRecentDup must not throw", 0) === null,
     "the same station on the OTHER antenna does not -- it gets its own row, which is the point");
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now(), ""), "findRecentDup must not throw", 0) === null,
     "and an unattributed catch does not adopt an attributed row");
}

group("GROUP 4b -- one clip per PI PER ANTENNA");
reset();
{
  ctx.latest = { rds: { pi: 0xC202 } };
  A.setAnt("Antenna A"); const cA = tryv(() => A.srKey(), "srKey must not throw", null);
  A.setAnt("Antenna C"); const cC = tryv(() => A.srKey(), "srKey must not throw", null);
  ok(cA !== cC,
     "the same station keys differently on two ports, so both write a clip and can be compared");
  ok(String(cA).indexOf("C202") === 0 && String(cC).indexOf("C202") === 0,
     "and both still start from the PI");
  A.setAnt("");
  ok(A.srKey() === "C202", "with rotation off the key is the bare PI, exactly as in 0.11.2");
  ctx.latest = { rds: {} };
  ok(A.srKey() === null, "no PI is still no key, so no clip and no dedup");
  ctx.latest = null;
  ok(A.srKey() === null, "and no decode at all is still no key");
  /* The user's own name for a port must reach the clip key, or renaming a port would silently
     re-open every PI it had already claimed. */
  ctx.latest = { rds: { pi: 0xC202 } };
  A.antCfgPut("Antenna C", Object.assign({ label: "vertical" }, FULL));
  A.setAnt("Antenna C");
  ok(/vertical/.test(String(A.srKey())), "the clip key follows the user's name for the port");
}

/* ---------- GROUP 5: rotation OFF is byte-identical to 0.11.2 ---------------------------- */
group("GROUP 5 -- with rotation off nothing changes for a single-antenna user");
reset();
{
  A.setAnt("");
  const chk = A.scanChKey(88100000);
  ok(A.scanDeadKey(chk) === String(chk), "the dead-list key is exactly the bare channel key");
  ok(A.scanAntName() === "", "there is no antenna name to put anywhere");
  /* And it must be a STRING for every falsy port value, not just for "". Without the guard,
     antCfgName(null) returns null and antCfgName(undefined) returns undefined -- either of which
     would be concatenated into a clip filename as "null". Established by driving both forms
     side by side rather than by assuming the mutant was equivalent. */
  A.setAnt(null);
  ok(A.scanAntName() === "", "a null port name reads as empty, not as null");
  A.setAnt(undefined);
  ok(A.scanAntName() === "", "an undefined port name reads as empty, not as undefined");
  A.setAnt("");
  ctx.dxLog = [{ pi: 0xC202, freq: "88.1", lastTs: new Date().toISOString() }];
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now(), ""), "findRecentDup must not throw", 0) !== null,
     "a pre-0.12.0 row (no ant field at all) is still matched");
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now()), "findRecentDup must not throw", 0) !== null,
     "and matched when the antenna argument is not passed at all");
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now(), "vertical"), "findRecentDup must not throw", 0) === null,
     "but an attributed catch does not silently enrich an unattributed row");
  /* the re-log window still applies, and is not accidentally disabled by the new condition */
  ctx.dxLog = [{ pi: 0xC202, freq: "88.1", lastTs: new Date(Date.now() - 4 * 3600e3).toISOString() }];
  ok(tryv(() => A.findRecentDup(0xC202, "88.1", Date.now(), ""), "findRecentDup must not throw", 0) === null, "an old row is still outside the re-log window");
}

/* ---------- GROUP 6: the file lane and MPX are excluded ---------------------------------- */
group("GROUP 6 -- rotation is a live-radio feature only (structural)");
{
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/var rotPorts=\(!mpxActive\(\) && !fileSource\) \? antRotationPorts\(\) : \[\];/.test(stripped),
     "an IQ file and the MPX lane never rotate -- there is no antenna to switch");
  ok(/var rotOn=\(rotPorts\.length>1\)/.test(stripped),
     "one selected port is not rotation: the scan runs on that port as usual");
}

/* ---------- GROUP 7: the driver, which the vm cannot enter ------------------------------- */
group("GROUP 7 -- the rotation driver (structural)");
{
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/rotPorts\[\(pass-1\)%rotPorts\.length\]/.test(stripped),
     "the port for a pass is derived from the pass number, so one pass runs on one port");
  ok(/if\(antShown!==want\)\s*log\("err"/.test(stripped),
     "a refused or rerouted switch is reported, not assumed to have worked");
  ok(/scanAnt=antShown\|\|want/.test(stripped),
     "and the pass is keyed to the port the radio REPORTS, so its verdicts are filed correctly even then");
  ok(/if\(rotOn && rotHome && antShown!==rotHome[^)]*\)\{[\s\S]{0,200}?antWant=rotHome/.test(stripped),
     "the starting port is restored when the scan ends, and only when it actually moved");
  ok(/while\(\(\(looping \|\| \(rotOn && pass<rotPorts\.length\)\) && !scanStop\)\)/.test(stripped),
     "the loop continues while ports remain, so a raster sweep does what the announcement promised");
  ok(/looping\?", then round again\."/.test(stripped),
     "and the announcement distinguishes a looping scan from one that stops");
  /* cand.11: apply was gated on the SWITCH, so pass 1 ran at whatever the radio happened to hold.
     Two ports sharing one dead list at two different spectrum scales, silently. */
  ok(/if\(want===antShown\)\{[\s\S]{0,900}?antCfgApply\(want\)/.test(stripped),
     "a pass that needs no switch STILL applies the port's saved settings");
  const applies = stripped.match(/antCfgApply\(/g) || [];
  ok(applies.length === 3,
     "antCfgApply has one definition and two call sites: switch and no-switch (found " + applies.length + ")");
  const names = stripped.match(/"pass "\+pass\+" \\u2192 antenna "/g) || [];
  ok(names.length === 2,
     "every rotation pass names its port, switch or no switch (found " + names.length + ")");
  ok(/scanAnt="";/.test(stripped), "and the port key is cleared, so a later single scan is unattributed");
  ok(/var rotPorts=/.test(stripped) && !/rotPorts=antRotationPorts\(\)[\s\S]{0,400}?do\{[\s\S]*?rotPorts=/.test(stripped),
     "the selection is read once per scan, not per pass -- a pass must not change antenna halfway");
  ok(/e\.ant=_ant/.test(stripped), "a catch records the antenna it was made on");
  ok(/dxLogged\[_pikey\]|dxLogged\[dxPending\.pikey\]/.test(stripped),
     "the in-RAM dedupe is keyed per antenna");
  ok(!/dxLogged\[r\.pi\]/.test(stripped), "and nothing is still keyed by PI alone");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
