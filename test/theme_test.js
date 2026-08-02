#!/usr/bin/env node
/* theme_test.js -- light/dark theme: token parity, contrast, and the light-chrome/dark-data rule.
 *
 *   node test/theme_test.js [build.html]     (default ../index.html)
 *
 * Reads the real <style> block out of the build and analyses it. No fixture files, no jsdom,
 * deterministic. Contrast figures are COMPUTED from the hex in the file against the WCAG 2.1
 * relative-luminance formula and compared to a fixed threshold -- the suite never restates the
 * palette's own numbers back at it, so a wrong colour fails rather than agreeing with itself.
 *
 * The three faults this exists to catch, all of which shipped or nearly shipped:
 *   GROUP 1  a var() with no definition anywhere. --teal was used 4x and defined 0x from
 *            0.10.0 to 0.10.2; the band-map playhead had no line and no dot fill for three
 *            releases and nothing flagged it.
 *   GROUP 2  a token themed on one side only -- light mode with a dark-mode value left in.
 *   GROUP 4  .hc unscoped. Its dark values on a light page are near-white text on white.
 */

const fs = require("fs");
const path = require("path");

const BUILD = process.argv[2] || path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(BUILD, "utf8");
const css = src.slice(src.indexOf("<style"), src.indexOf("</style>"));

let pass = 0;
const fails = [];
function eq(label, got, want) {
  if (got === want) pass++;
  else fails.push(`${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ---------- WCAG 2.1 relative luminance / contrast ratio ------------------------------ */

function lum(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ---------- pull the token blocks out of the real stylesheet -------------------------- */

function blockOf(sel) {
  const at = css.indexOf(sel + "{");
  if (at < 0) return null;
  const end = css.indexOf("}", at);
  const body = css.slice(at + sel.length + 1, end);
  const out = {};
  body.replace(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g, (_, k, v) => { out[k] = v.trim(); return ""; });
  return out;
}

const DARK  = blockOf(":root");
const LIGHT = blockOf(":root.light");
const HCD   = blockOf(":root:not(.light).hc");
const HCL   = blockOf(":root.light.hc");

const isHex = (v) => /^#[0-9a-fA-F]{3,8}$/.test(String(v || "").trim());

/* ---------- the suite ----------------------------------------------------------------- */

ok("0.1  :root block found", DARK && Object.keys(DARK).length > 20);
ok("0.2  :root.light block found", LIGHT && Object.keys(LIGHT).length > 20);
ok("0.3  dark .hc block found", HCD);
ok("0.4  light .hc block found", HCL);

/* GROUP 1 -- every var() resolves. This is the --teal guard. */
const used = new Set();
css.replace(/var\((--[a-z0-9-]+)/g, (_, k) => { used.add(k); return ""; });
const defined = new Set([...Object.keys(DARK || {}), ...Object.keys(LIGHT || {}),
                         ...Object.keys(HCD || {}), ...Object.keys(HCL || {})]);
const dangling = [...used].filter((k) => !defined.has(k)).sort();
eq("1.1  no var() references an undefined token", dangling.join(",") || "none", "none");
eq("1.2  --teal specifically is gone", css.includes("var(--teal)"), false);
ok("1.3  the stylesheet actually uses tokens", used.size > 30);

/* A token defined and never used is the same fault one step earlier. */
const CSS_UNUSED_OK = new Set(["--od-bg", "--grid", "--vfo-mark",
                               "--bm-ink", "--bm-tick", "--bm-faint", "--bm-rolloff"]);
const orphan = [...defined].filter((k) => !used.has(k) && !CSS_UNUSED_OK.has(k)).sort();
eq("1.4  no token is defined but unreferenced", orphan.join(",") || "none", "none");
/* ...and the six exempted above must be read from JS instead, or they are orphans too. */
for (const k of CSS_UNUSED_OK)
  ok(`1.5  ${k} is read from JS via css()`, src.includes(`css("${k}")`));

/* GROUP 2 -- theme parity. Every themeable dark token needs a light value. */
const NOT_THEMED = /^--(mono|sans|od-)/;
const themeable = Object.keys(DARK || {}).filter((k) => !NOT_THEMED.test(k));
const noLight = themeable.filter((k) => !(LIGHT || {})[k]).sort();
eq("2.1  every themeable token has a light value", noLight.join(",") || "none", "none");
const lightOnly = Object.keys(LIGHT || {}).filter((k) => !(DARK || {})[k]).sort();
eq("2.2  light defines nothing dark lacks", lightOnly.join(",") || "none", "none");
const same = themeable.filter((k) => DARK[k] === LIGHT[k]).sort();
eq("2.3  no themeable token carries an identical value in both", same.join(",") || "none", "none");
ok("2.4  --od-* are declared once, in :root only",
   Object.keys(DARK).some((k) => k.startsWith("--od-")) &&
   !Object.keys(LIGHT).some((k) => k.startsWith("--od-")));

/* GROUP 3 -- contrast, computed from the file. AA normal text = 4.5:1. */
const AA = 4.5;
const hexOf = (blk, k) => ((blk || {})[k] || "").trim();

const INK  = ["--ink", "--ink-dim", "--ink-faint", "--trace", "--amber", "--good", "--bad", "--violet"];
const SURF = ["--panel", "--panel-2", "--bg", "--topbar-a"];

for (const [name, blk] of [["dark", DARK], ["light", LIGHT]]) {
  let worst = Infinity, worstPair = "";
  for (const i of INK) {
    for (const sfc of SURF) {
      const a = hexOf(blk, i), b = hexOf(blk, sfc);
      if (!isHex(a) || !isHex(b)) continue;
      const r = ratio(a, b);
      if (r < worst) { worst = r; worstPair = `${i} on ${sfc}`; }
    }
  }
  ok(`3.${name === "dark" ? 1 : 2}  ${name}: every ink/surface pair clears AA ` +
     `(worst ${worst.toFixed(2)}:1, ${worstPair})`, worst >= AA);
}

/* The token this release exists to fix. 3.16:1 shipped through 0.10.2. */
ok("3.3  dark --ink-faint clears AA on --panel", isHex(hexOf(DARK,"--ink-faint")) && ratio(DARK["--ink-faint"], DARK["--panel"]) >= AA);
ok("3.4  dark --ink-faint is still dimmer than --ink-dim",
   ratio(DARK["--ink-faint"], DARK["--panel"]) < ratio(DARK["--ink-dim"], DARK["--panel"]));
ok("3.5  light --ink-faint is still dimmer than --ink-dim",
   ratio(LIGHT["--ink-faint"], LIGHT["--panel"]) < ratio(LIGHT["--ink-dim"], LIGHT["--panel"]));
ok("3.6  primary-button ink reads on the button fill (dark)",
   ratio(DARK["--on-trace"], DARK["--trace"]) >= AA);
ok("3.7  primary-button ink reads on the button fill (light)",
   ratio(LIGHT["--on-trace"], LIGHT["--trace"]) >= AA);

/* GROUP 4 -- .hc must lift contrast in BOTH themes, never destroy it.
   Guarded: a MISSING block is the defect this group exists to catch, so it has to report a
   failure, not throw. run-all.js parses the "N passed, M failed" line -- a suite that dies
   before printing it reads as a crash rather than a red, and that is how a real regression
   gets mistaken for a broken harness. */
for (const [name, base, hc] of [["dark", DARK, HCD], ["light", LIGHT, HCL]]) {
  const n = name === "dark" ? 1 : 3;
  for (const k of ["--ink-dim", "--ink-faint"]) {
    const label = `4.${n + (k === "--ink-faint" ? 1 : 0)}  ${name} .hc raises ${k}`;
    if (!hc || !hc[k] || !base || !isHex(base[k]) || !isHex(hc[k])) { ok(label + " (block or value missing)", false); continue; }
    const before = ratio(base[k], base["--panel"]);
    const after  = ratio(hc[k],  base["--panel"]);
    ok(`${label} (${before.toFixed(2)} -> ${after.toFixed(2)})`, after > before);
  }
}
ok("4.5  the dark .hc rule cannot apply in light mode", css.includes(":root:not(.light).hc"));
ok("4.6  a light .hc rule exists", css.includes(":root.light.hc"));

/* GROUP 5 -- light chrome, dark data. The strips that must NOT follow the theme. */
ok("5.1  band-map body fills from --od-bg, not --panel", src.includes('css("--od-bg")'));
ok("5.2  band-map chrome reads its own tokens, not the page ink",
   src.includes('css("--bm-ink")') && src.includes('css("--bm-chrome")'));
ok("5.3  playhead uses the on-dark cursor token, not the themed one",
   /#bmPlayRow\{[^}]*var\(--od-play\)/.test(css) && /#bmPlayDot\{[^}]*var\(--od-play\)/.test(css));
ok("5.4  the RF waterfall carries a data frame", /#wfall\{[^}]*var\(--data-frame\)/.test(css));
ok("5.5  the MPX spectrogram carries a data frame", /#mpxwf\{[^}]*var\(--data-frame\)/.test(css));
ok("5.6  both themes define --data-frame", !!DARK["--data-frame"] && !!LIGHT["--data-frame"]);
/* The two persistent bitmaps are filled from JS and must stay dark literals. */
eq("5.7  waterfall bitmap still fills dark", (src.match(/fillStyle="#06121a"/g) || []).length, 2);

/* GROUP 6 -- no colour escapes the token system. */
const TOKEN_BLOCK = /:root(?:\.light|:not\(\.light\)\.hc|\.light\.hc)?\s*\{[^}]*\}/g;
const outside = css.replace(TOKEN_BLOCK, "");
const stray = (outside.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) => h.toLowerCase() !== "#fff");
eq("6.1  no un-tokenised hex outside the :root blocks", stray.join(",") || "none", "none");
/* rgba() survives in exactly one place: the band-map overlays, which are painted ON the
   dark map body and must not follow the page. Naming the rules is a stronger check than a
   count -- a raw colour added anywhere else fails, and these four cannot silently grow. */
/* Parse SELECTOR{BODY} pairs rather than hunting for a rule by name. The first cut looked
   for `#bmLoopBand{...}` and matched the SHARED rule
   `#bmPlayRow,#bmPlayCol,#bmPlayDot,#bmLoopBand{position:absolute;...}`, which carries no
   colour -- so it removed the wrong block, counted four, and passed while the real overlay
   rule still held three raw rgba(). A count that agrees for the wrong reason is the failure
   mode this project keeps meeting; measure the thing, not a proxy for it. */
const OD_IDS = ["#bmLoopBand", "#bmPlayRow", "#bmPlayCol", "#bmPlayDot"];
const rules = [...outside.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2] }));
const isOnDark = (sel) => OD_IDS.some((id) => sel.includes(id));
const strayRgba = rules.filter((r) => /rgba\(/.test(r.body) && !isOnDark(r.sel))
  .map((r) => r.sel.slice(0, 30));
eq("6.2  rgba() survives only in rules that paint on the dark map",
   strayRgba.join(" | ") || "none", "none");
const odColoured = rules.filter((r) => isOnDark(r.sel) && /rgba\(/.test(r.body));
eq("6.3  and exactly the four on-dark overlay rules carry it", odColoured.length, 4);

/* GROUP 7 -- the toggle. */
ok("7.1  a theme button exists", /id="btnTheme"/.test(src));
ok("7.2  it toggles the .light class on :root",
   /classList\.toggle\("light"/.test(src));
ok("7.3  the choice persists", /rdsb\.theme/.test(src));
ok("7.4  switching re-renders the band map", /bmRender\(\);\s*\}\s*catch/.test(src));
ok("7.5  switching invalidates the memoised MPX axis", /_mpxAxKey=null/.test(src));
ok("7.6  contrast and theme are independent controls",
   /id="btnContrast"/.test(src) && /id="btnTheme"/.test(src) && /rdsb\.hc/.test(src));

/* GROUP 8 -- dark must not drift.
   Light mode is not a licence to repaint the theme everyone already uses. These are the
   fifteen tokens as SHIPPED in 0.10.3, transcribed from that release; every one must still
   hold, with exactly three documented exceptions.

   Rebased from 0.10.2 to 0.10.3 at 0.10.4. The baseline is always the LAST SHIPPED release, so
   "unchanged" keeps meaning "unchanged for the people running it" rather than drifting a release
   at a time against a fixed historical snapshot. The band map earns its own --bm-* set for the
   same reason: pointing its chrome at --panel/--ink-dim looked tidy and silently restyled the
   gutter, header and ticks in dark mode. */
const SHIPPED_0_10_3 = {
  "--bg": "#0d1217", "--panel": "#131a21", "--panel-2": "#0f161c",
  "--line": "#243038", "--line-soft": "#1a242c",
  /* added at 0.10.4: the card gradient was NOT in the thirteen, so the surface the panels are
     actually painted with had no drift guard at all until it was changed by accident. */
  "--card-a": "#121c22", "--card-b": "#0f161c",
  "--ink": "#e8eef2", "--ink-dim": "#8b9aa6", "--ink-faint": "#7e8a95",
  "--trace": "#38e1d6", "--amber": "#f0a93b", "--good": "#57d98a",
  "--bad": "#ff6b6b", "--violet": "#9a8cff"
};
/* The agreed 0.10.4 change: panel-vs-surround separation. Reported by a user who liked light
   mode's slightly darker frame around each panel and wanted the same cue in dark. Measured:
   light gives 1.172 between --bg and --panel, dark gave 1.073 -- under half the separation.
   Three surface tokens move; nothing else may. */
const ALLOWED_DRIFT = new Set(["--bg"]);
const drift = Object.keys(SHIPPED_0_10_3)
  .filter((k) => hexOf(DARK, k).toLowerCase() !== SHIPPED_0_10_3[k])
  .sort();
eq("8.1  dark drifts from 0.10.3 only where agreed",
   drift.filter((k) => !ALLOWED_DRIFT.has(k)).join(",") || "none", "none");
eq("8.2  and the agreed changes were actually made", drift.join(","), "--bg");
/* The cue is CARD vs SURROUND, and the cards paint with --card-a/--card-b, NOT --panel
   (--panel is modals, buttons and .rdy-bar). cand.1 moved --bg/--panel/--panel-2, measured a
   healthy contrast-ratio improvement, and was invisible on the bench because none of those tokens
   paints a card. Assert the tokens the surface actually uses.

   And assert it in RAW RGB STEPS, not contrast ratio and not L*. Both were tried and both were
   refuted at the bench: ratio parity (cand.1) and L* parity (cand.3) each computed as "matched to
   light" and each was invisible on a real monitor. Near black, L* is steeply nonlinear and assumes
   an adapted observer against a reference white; a real display's black floor and the room's
   ambient light dominate at that end. What predicts visibility here is the plain 8-bit step, which
   is what the panel raised its own separation by in light mode.

   The separation is bought by DARKENING THE SURROUND, not lightening the cards: --ink-faint and
   --ink-dim sit on the cards and were tuned to AA at 0.10.3, so moving the card stops would have
   put --ink-faint back under 4.5 (measured 4.28). Moving --bg leaves every text contrast on a card
   exactly as shipped and only ever increases contrast for text sitting on the surround. */
function rgbOf(hex) { const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function meanStep(bg, surf) { const a = rgbOf(bg), b = rgbOf(surf);
  return (b[0] - a[0] + b[1] - a[1] + b[2] - a[2]) / 3; }
const dA = meanStep(hexOf(DARK,  "--bg"), hexOf(DARK,  "--card-a"));
const dB = meanStep(hexOf(DARK,  "--bg"), hexOf(DARK,  "--card-b"));
const lA = meanStep(hexOf(LIGHT, "--bg"), hexOf(LIGHT, "--card-a"));
const lB = meanStep(hexOf(LIGHT, "--bg"), hexOf(LIGHT, "--card-b"));
ok("8.2a dark card top separation is within 3 steps of light's", Math.abs(dA - lA) <= 3);
ok("8.2b dark card bottom separation is within 4 steps of light's", Math.abs(dB - lB) <= 4);
ok("8.2c dark separation beats the 0.10.3 shipped 8.7", dA >= 14);
ok("8.2d cards are LIGHTER than the surround in both themes -- same depth cue",
   lum(hexOf(DARK, "--card-a")) > lum(hexOf(DARK, "--bg")) &&
   lum(hexOf(LIGHT, "--card-a")) > lum(hexOf(LIGHT, "--bg")));
ok("8.2e the gradient still runs light-to-dark in both themes",
   lum(hexOf(DARK, "--card-a")) > lum(hexOf(DARK, "--card-b")) &&
   lum(hexOf(LIGHT, "--card-a")) > lum(hexOf(LIGHT, "--card-b")));
ok("8.2f card text contrast is UNCHANGED from 0.10.3 -- the cards did not move",
   hexOf(DARK, "--card-a") === "#121c22" && hexOf(DARK, "--card-b") === "#0f161c");
ok("8.2g --ink-faint still clears AA on the darker surround",
   ratio(hexOf(DARK, "--ink-faint"), hexOf(DARK, "--bg")) >= 4.5);
/* The band map's dark chrome is the 0.10.2 literal, not a page token. */
const BM_SHIPPED = { "--bm-chrome": "#07080a", "--bm-ink": "#8b94a0",
                     "--bm-tick": "#39414c", "--bm-faint": "#5b6470" };
const bmDrift = Object.keys(BM_SHIPPED)
  .filter((k) => hexOf(DARK, k).toLowerCase() !== BM_SHIPPED[k]).sort();
eq("8.3  band-map dark chrome is unchanged from 0.10.2", bmDrift.join(",") || "none", "none");
ok("8.4  ...and light gives it different values",
   Object.keys(BM_SHIPPED).every((k) => hexOf(LIGHT, k) && hexOf(LIGHT, k) !== hexOf(DARK, k)));

/* GROUP 9 -- the playhead cursor must read against the band map's own colormap.
   Reported 30-Jul-2026: "that tiny circular cursor completely disappears against that
   multicoloured background", with a request for bright red.

   The colormap is regenerated HERE from the coefficients parsed out of the shipped
   bmColour(), not from a copy of them -- so if the ramp is ever retuned this recomputes and
   fails rather than agreeing with a stale assumption. The finding that drove the fix: the
   ramp runs black -> red -> orange -> yellow -> near-white, red is the max channel in every
   sampled cell, and NO single cursor colour clears 1.05:1 against all of it (red 1.03,
   teal 1.01, white 1.01, black 1.02). A dark ring beside a light ring clears 4.48:1,
   because whichever end of the ramp a cell sits at, one of the two contrasts. */
const bmSrc = src.slice(src.indexOf("function bmColour(db){"));
const coef = bmSrc.slice(0, bmSrc.indexOf("}")).match(/t \* ([\d.]+)(?:\s*-\s*([\d.]+))?/g) || [];
ok("9.1  bmColour() coefficients parsed from the build", coef.length === 3);

function ramp() {
  const out = [];
  const num = (i) => (coef[i].match(/[\d.]+/g) || []).map(Number);
  const [mr] = num(0), [mg, sg] = num(1), [mb, sb] = num(2);
  const floor = (bmSrc.match(/return "(#[0-9a-f]{6})"/) || [])[1] || "#0b0d10";
  out.push(floor);
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const c = [Math.min(1, t * mr), Math.max(0, Math.min(1, t * mg - (sg || 0))),
               Math.max(0, Math.min(1, t * mb - (sb || 0)))]
      .map((v) => Math.round(255 * v).toString(16).padStart(2, "0")).join("");
    out.push("#" + c);
  }
  return out;
}
const LUT = coef.length === 3 ? ramp() : [];
ok("9.2  the ramp is red-dominant end to end (so red is the worst cursor family)",
   LUT.length > 1 && LUT.slice(1).every((h) => {
     const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
     return r >= g && r >= b;
   }));

const CASING = "#08090c", RIM = "#ffffff";
const single = (c) => Math.min(...LUT.map((h) => ratio(c, h)));
ok("9.3  no single colour reads across the ramp (this is why it is a contour, not a colour)",
   LUT.length > 1 && ["#ff0000", "#38e1d6", "#ffffff", "#08090c"].every((c) => single(c) < 1.1));
const contour = Math.min(...LUT.map((h) => Math.max(ratio(CASING, h), ratio(RIM, h))));
ok(`9.4  the dark/light contour reads everywhere (worst ${contour.toFixed(2)}:1)`, contour >= 3.0);

/* ...and the cursor rules must actually carry both halves. */
const dotRule = (css.match(/#bmPlayDot\{[^}]*\}/) || [""])[0];
ok("9.5  the dot has a dark casing", /rgba\(8,\s*10,\s*12/.test(dotRule));
ok("9.6  the dot has a light rim", /rgba\(255,\s*255,\s*255/.test(dotRule));
ok("9.7  the dot grew from the reported 9px", /width:1[1-9]px/.test(dotRule));
for (const [n, id] of [[8, "#bmPlayRow"], [9, "#bmPlayCol"]]) {
  const rule = (css.match(new RegExp(id + "\\{[^}]*\\}")) || [""])[0];
  ok(`9.${n}  ${id} has a dark casing`, /rgba\(8,\s*10,\s*12/.test(rule));
}
ok("9.10 the cursor core is a token, not a literal", /var\(--od-play\)/.test(css));

/* ---------- report ---------- */
if (fails.length) {
  fails.forEach((f) => console.log("FAIL  " + f));
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed`);
