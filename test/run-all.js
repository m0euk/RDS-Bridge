#!/usr/bin/env node
/* run-all.js — run every *_test.js in this folder against one index.html.
 *
 *   node test/run-all.js                  # tests ../index.html
 *   node test/run-all.js path/to/work.html
 *
 * Each suite is a standalone script that takes the html path as argv[2] and exits non-zero on
 * failure, so it can also be run on its own. Exit code here is the number of failing suites.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const here = __dirname;
const target = path.resolve(process.argv[2] || path.join(here, "..", "index.html"));

if (!fs.existsSync(target)) {
  console.error("No such file: " + target);
  process.exit(2);
}
try {
  require.resolve("jsdom");
} catch (e) {
  console.error("jsdom is not installed. From this folder, run:  npm install");
  process.exit(2);
}

/* the file under test identifies itself, so a passing run can never be about the wrong build */
const html = fs.readFileSync(target, "utf8");
const grab = (re) => { const m = html.match(re); return m ? m[1] : "?"; };
const crypto = require("crypto");
console.log("target   " + target);
console.log("sha256   " + crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex"));
console.log("version  " + grab(/var VERSION="([^"]*)"/) +
            (grab(/var BUILD="([^"]*)"/) ? "  build " + grab(/var BUILD="([^"]*)"/) : "  (release build)"));

const suites = fs.readdirSync(here).filter(f => /_test\.js$/.test(f)).sort();
if (!suites.length) { console.error("no *_test.js files found in " + here); process.exit(2); }

let failed = 0;
const results = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(here, s), target], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bad = r.status !== 0;
  if (bad) failed++;
  results.push({ s, line: m ? m[0] : "did not report", bad, out });
  console.log("\n──── " + s + " ".repeat(Math.max(1, 26 - s.length)) + (bad ? "FAIL" : "ok") +
              "   " + (m ? m[0] : ""));
  if (bad) console.log(out.split("\n").filter(l => /FAIL|Error/.test(l)).join("\n"));
}

console.log("\n" + "═".repeat(60));
for (const r of results) console.log((r.bad ? "FAIL  " : "ok    ") + r.s.padEnd(28) + r.line);
console.log(failed ? "\n" + failed + " suite(s) FAILED" : "\nall suites passed");
process.exit(failed);
