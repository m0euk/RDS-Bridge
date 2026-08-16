# RDS Bridge — test suites

Offline regression tests for `index.html`. They run the **real shell** out of the file, in Node, with no
hardware and no fixture files, in a few seconds.

**None of this is part of the app.** `index.html` still has no dependencies, no build step and nothing to
install — it is one file you double-click. This folder exists so that a fix made in one release cannot be
quietly undone in the next.

## Running them

Once, to get the one dependency:

```
cd test
npm install
```

Then, from the folder containing `index.html` and `test/`:

```
node test/run-all.js                     # tests ./index.html
node test/run-all.js path/to/work.html   # or any candidate build, anywhere on disk
```

The build path is just an argument — it can be any file in any location, and nothing has to be arranged in a
particular layout. Only the suites need to sit together, because the runner discovers them in its own folder.

The runner prints the path, SHA-256 and version of the file it tested **before** running anything, so a
passing run can never turn out to have been about the wrong build. It exits non-zero if any suite fails.

Each suite is standalone and can be run on its own:

```
node test/mpxaxis_test.js index.html
```

## Suites

Run by `run-all.js`. A red suite is a release blocker.

| Suite | Checks | Covers | Needs |
|---|---|---|---|
| `bandmap_follow_test.js` | 21 | Band-map playhead follow, and how it interacts with manual scrolling | jsdom |
| `bandmap_test.js` | 96 | The band map's hit surface (0.10.6). Which source a click is allowed on and that the mosaic is inert on the others; that the hover read-out and the click run the *same* measurement rather than two statements of it; that the hover outline is drawn on the cell's own rectangle; and that every cell is hit exactly at all ten interface scales the control offers — the scale fault it was written for is invisible at exactly one of them. Eight named mutants prove it discriminates, including a build carrying the 0.10.5 hit test. | jsdom |
| `looppass_test.js` | 203 | Loop-pass jitter bounds, deferred parameter writes, the pass ledger, hunt support tiers, the log-catch gate and stamp, the bandwidth sweep and its restore, both view layouts, worker SHAs | jsdom |
| `mpxaxis_test.js` | 48 | The map-view MPX scale: parity with the scale under the spectrum, and its geometry against the composite waterfall | jsdom |
| `iqmeta_test.js` | 52 | IQ file headers: centre frequency and start time across every writer we have measured (SDRuno, HDSDR, SDR Console 8-bit and UTF-16, SDR#), RF64, the fallbacks, and both guards against a fabricated centre | none |
| `scanskip_test.js` | 60 | The band scan's pre-skips: empty-channel and adjacent-strong decisions against a real baseline, and what the level readings do when there is none — no channel skipped anywhere in a sweep, neither sentinel reachable, the out-of-range and stale-geometry guards, and the scan log's level text. Extended in 0.11.2 with the **straddled peak**: the fixture's stations are 19 bins wide with a flat top, so its peak can never straddle a boundary — which is precisely the defect measured on the bench and therefore precisely what it could not reproduce. A second, narrow-peak fixture puts the energy in a single bin at an arbitrary offset. Includes the checks that keep the widened read from reaching the candidate's own skirt, and both new ways it can fall off the end of the window. The two straddle checks fail against the published 0.11.0 and pass here, so the suite catches the real fault rather than agreeing with the new code. | none |
| `deadlist_test.js` | 35 | The DX-watch accrual rule (0.10.5). Pulls the real guard expression out of the build and drives it through every verdict/condition combination the 02–03 Aug logs produced; `scanInDxLog` against the entry shapes `logCatch` actually builds; the strike TTL, the clear-on-empty-pass rule and the removal of the quick-path window halving asserted against the source; and every verdict `scanDwell` can return required to have a tally branch, enumerated from the code rather than from a remembered list. Four named mutants at the foot prove it discriminates. | none |
| `theme_test.js` | 69 | Light/dark themes: colour references all resolve, both themes define the same set, contrast computed against WCAG, the contrast toggle raises legibility in both themes, the dark palette has not drifted (including the card gradient tokens), light chrome vs dark data, and the playhead cursor against the band map's own colour scale | none |
| `recording_test.js` | 166 | Audio recording (0.11.0). The WAV header parsed back out of the bytes it wrote — both size fields against the actual byte count, because a wrong one produces a file that opens, plays and is silently truncated. The `(L+R)/2` downmix *and* its bit-equality with L when `L===R`, since the equality check alone passes against a build that takes L. Filename construction across every combination of decoded PI and PS, a scrolling space-padded PS, and an assertion that no colon can appear. The 30-minute cap driven to its limit, stopping, saving and reporting itself as automatic. The silent-record contract in both directions, including restoring the prior volume. The remembered folder and its three outcomes, with the fake IndexedDB switched between working, absent and throwing. And a call-site census on `recStop` — the only form of the check that catches a *new* side-effect added later. The suite forces a half-hour-offset timezone before constructing any Date, because a local-time filename stamp passes a UTC assertion by coincidence on a UTC machine. | none |
| `preroll_test.js` | 130 | The pre-roll ring (0.11.1). The ring driven through wrap, saturation and partial reads with samples hashed on **absolute** index — a ramp whose period divides the ring makes a stale lap bit-identical to a correct one, which is how a broken wrap passed seventeen checks the first time. The retune guard driven from the audio tap rather than from the tuning control, including the tolerance either side. The minimum saveable length at and around its threshold. And, from 0.11.2, the ring's **second customer**: both taps driven with the user's switch off and a scan armed, which is the only arrangement that distinguishes "tests `preLive()`" from "tests `preOn`" — a build that kept the taps on the switch alone captures nothing during a scan and the whole scan-clip feature is silently inert. Two checks that used to grep the source for the shape of the code were rewritten to drive it, after 0.11.2 moved the release behind `preRelease()` and the greps went red while the behaviour was unchanged. | none |
| `scanrec_test.js` | 134 | Scan clips (0.11.2). The **mark** is the whole correctness argument and every bound check reads sample *values*, not lengths — a clip of the right length taken from the wrong place passes any length assertion and is exactly the defect. `min(preLen, preTotal−srMark)` driven through both halves separately: `preTotal` alone reaches back past a mid-dwell discard into audio deliberately thrown away, `preLen` alone reaches back through the retune settle into the previous channel. All seven verdicts driven, including the five that must produce nothing. The dedup, and that asking for a hold does not claim the key. The hold's placement between verdict and capture, its interruptibility, and that its ceiling is *derived* from the ring rather than chosen. The folder grant on the Scan gesture — granted, refused, and landing after the scan already stopped. And two absences asserted on the source, because they cannot be driven: no `requestPermission` mid-scan, and no download fallback. Runs in `Australia/Adelaide`, because a local-time filename stamp passes a UTC assertion by coincidence on a UTC machine. | none |
| `rafstyle_test.js` | 58 | The scanning-freeze fix (0.11.0). jsdom has no layout engine, so the *cost* of a layout is a Chrome measurement and is recorded in the release notes with the machine named — what this suite measures is the **count**: sixty frames of the real `draw` are driven and the element-size reads must not scale with them, the design tokens must resolve once per theme rather than once per frame, and the AF chip list must rebuild only when the AF set changes. Also that no CSS transition anywhere in the stylesheet animates a layout property, which is how the second source of the freeze got in. Installs a `ResizeObserver` stub because Chrome has one and jsdom does not, and drives a second DOM without it to prove the documented fallback still reads through rather than serving a stale size. | jsdom |
| `basecal_test.js` | 56 | The scale-derived carrier gate (0.12.0). SDRConnect normalises its spectrum to the visible Base..Ref range, so a threshold in display counts is a threshold in dB only while those two hold still — measured on the bench, one station read 3.9 / 6.2 / 3.9 u8 at three Base settings and flipped verdict. Group 3 does **not** use those three readings as a fixture: 94.8 is a marginal channel whose empty-channel level drifts ~2 u8 between passes, so they establish that the verdict moved and nothing more. Instead it synthesises windows where counts scale exactly as the normalisation defines and asserts the *decision* is stable across seven Base settings, in both directions. Group 5 pins the no-readback fallback for the file, MPX and network lanes as byte-identical to 0.11.2. Group 6 is structural, and had to be: a mutant reverting the DX-watch pre-skip to the raw constant passed all 53 behavioural checks, because that comparison is inline in the scan driver and unreachable by function extraction. Thirteen named mutants. | none |
| `antcfg_test.js` | 103 | Per-antenna settings (0.12.0): storage, device keying, the write plan, verification, the IF note and the cross-port advice. Group 3 found a real fault in the build rather than confirming it — `antCfgSame(8, null)` returned *false*, because `Number(null)` is 0 and finite, so a write the radio never answered would have been reported to the user as REFUSED quoting a value it never gave. Group 4 asserts that a record never writes a property it does not hold, and Group 8 that the IF note — which SDRConnect's API cannot accept under any name — can never become a `set_property`. Records are keyed by device then port, so one radio's gain cannot reach another's front end. Twenty-nine named mutants; one of them was found to be *equivalent* and replaced, with the reasoning kept in the runner so it is not re-added. | none |
| `antrot_test.js` | 50 | Antenna rotation (0.12.0). Three keys had to change and each fails silently if wrong: the dead list (a channel struck on one antenna stays struck on all of them — measured, 88.1 MHz read 5.0 u8 on one port and 23.2 on the other, and only the second identified it), clip dedup (the second port never writes a clip for a station the first caught, so the ports can never be compared) and the DX log (the second port enriches the first port's row). Group 5 pins rotation *off* as byte-identical to 0.11.2, including that pre-0.12.0 rows carrying no antenna field still match. Group 7 is structural for the driver the vm cannot enter. Twenty-two named mutants — one survivor I expected to be equivalent turned out not to be, and was only settled by driving both forms side by side. | none |
| `audiogain_test.js` | 35 | The output gain rule (0.12.0). Two features turn the audio stream on while monitoring is off, and through 0.11.2 each wrote the gain node directly in four places — which produced a real fault: `audioStop()` stops new buffers being queued but cannot unschedule ones already ahead of the WebAudio clock, and the teardown lifted the gain over exactly that drain. The gain node here **records every value written**, so an ordering fault is visible rather than only an end state: a build that opened at the listening level and zeroed on the next line leaves that value in the history even though the final state is right. Group 3 covers ordering the recording suites cannot reach, because they stub `audioStart()`. Group 8 reads the overload lamp's `data-state` out of the element and checks it against the states the CSS actually defines — cand.8 shipped a value no rule matched and the lamp rendered unlit, which nothing but the bench caught. Thirteen named mutants. | none |
| `scan0107_test.js` | 68 | The 0.10.7 scan corrections. The baseline map self-check driven as the *real extracted function* against synthesised spectra — on-raster carriers clean at four capture geometries, the 0.10.5 half-raster fault still flagged at each, empty windows and span edges withheld with distinct reasons, the verdict independent of capture width, and three baselines measured off the bench. Plus source-structure assertions that the rapid watch pass no longer power-pre-skips while DX watch and full band still do, that the "measured NOTHING" branch names a counter instead of asserting a mechanism, that both MPX baseline log sites branch on the lane while the SDRConnect wording does not, and a widened sweep for stale pre-0.10.5 copy. Mutation-tested against the published 0.10.6 build: 37 failures. | none |

**1,140 checks.**

`scan0107_test.js` labels its sections in its own output: section A drives real code, sections B–D are
source-structure and copy assertions. That distinction is deliberate — reaching the watch branch or the
pass-summary branch behaviourally means standing up the scan loop, the socket, the device and the dwell, so
those are defended structurally and the suite says so rather than letting a green run imply more than it
measured. Section D does **not** strip comments before searching, on the standing rule that a comment
stating a mechanism is read as fact; sections A–C do, after five checks failed on their own explanatory
comments the first time it ran.

`basecal_test.js`, `antcfg_test.js`, `antrot_test.js` and `audiogain_test.js` are version-bound to 0.12.0:
they defend behaviour earlier builds do not have, so they do not run green against 0.11.2. Two assertions in
`scanrec_test.js` and `recording_test.js` were **changed** in 0.12.0 rather than added, and both were
asserting the bug: each required the output gain to be back at the listening level the instant teardown
returned, which is precisely what made the buffer drain audible. The reasoning is recorded at each site so
they are not "restored" later.

`preroll_test.js` is version-bound as of 0.11.2: three of its checks defend behaviour 0.11.1 does not have,
so it no longer runs green against the earlier build. `recording_test.js` deliberately still does — it is the
regression guard for a shipped feature and its extraction tolerates the declarations it cannot find.

One check in `deadlist_test.js` reports `SKIP`: the `stopped` verdict is exempt from the tally rule because
the pass is abandoned and no summary is printed. The exemption is stated in the suite rather than left as a
silent gap. Note also that its verdict list is read out of `scanDwell` itself, so a build that removes a
verdict runs *fewer* checks — the total is a property of the build, not a constant.

`bandmap_follow_test.js`'s canvas stub was corrected in 0.10.6. It had asserted a 100 px-wide rect on a canvas
jsdom had sized at 300 — a pairing `bmRender`'s `prep()` cannot produce. That was harmless while the hit test
ignored the rect's scale and wrong the moment it stopped. The stub now models what `prep()` actually does.
Checked the right way round: against a build carrying the 0.10.5 hit test the corrected follow suite still
passes 21/21 while `bandmap_test.js` fails 14, so the fix was not fitted to the test.

## Discrimination proofs

Deliberately **not** picked up by `run-all.js` — it matches `*_test.js` only. Each one takes an instrument
added in 0.10.5 and proves it can tell apart the states it claims to report, **before** it reached the bench.
That check is cheap and skipping it is expensive: 0.8.6's diag.1 went to hardware unable to separate I/O from
CPU and cost a bench round. They run in seconds; run them on purpose.

| File | Checks | What it established |
|---|---|---|
| `telemetry_discriminate.js` | 56 | The link telemetry. Extracts the real `shTick` and the `handleJSON` echo matcher and drives them through the competing hypotheses with stubbed per-second timings, so the instrument was known to separate a stalled link from a slow one before any of the SDRConnect interruption data was collected with it. |
| `mon_discriminate.js` | 40 | The external-condition monitors. Real `MON`, `monRaf`, `monSideTxt`, `monTxt`, `monMachineTxt` and `shTick`'s clock-gap run logic: each detects what it claims, stays silent while `DIAG` is off, and a repeating notice is written once and closed off with its count instead of filling the log. |
| `env_discriminate.js` | 14 | The environment journal. Real `ENV` / `envStart` / `envTxt` and the sleep detector against stubbed events: each external condition that has cost this project a round is recorded, reported distinguishably, and carried in the saved log's footer. |
| `stall_discriminate.js` | 14 | The main-thread stall detector. Real `stallStart` / `stallTxt` driven with stubbed wall-clock advances: it reports genuine blocks and stays quiet otherwise. |
| `dwellstall_discriminate.js` | 6 | That a dwell measures its own freeze. Reproduces the timer-ordering race that made cand.5 under-report — the sleep timer runs first, carries the dwell to a verdict and clears `scanDwellActive` before the stall interval ticks — and shows cand.6 reads a value produced inside the dwell, which ordering cannot reach. |
| `geom_discriminate.js` | 6 | That the spectrum-geometry report can catch a wrong hz→bin map at all. Synthesises one strong carrier at a known frequency and asks the real `scanBaseGeomTxt()` where it thinks the peak is, under a correct map and two wrong ones. It stubs `scanRaster` at 100 kHz — which is exactly why the next one had to be written. |
| `geomraster_discriminate.js` | 8 | The same report on **both** rasters, with the real grid. On the 200 kHz North American raster the channel grid is `SCAN.fmLo + k·200k` (odd tenths) while `Math.round(hz/200k)·200k` is even tenths, so carriers sitting precisely on 88.9 / 97.9 / 105.5 were each reported ~95 kHz off — 36 of 36 baselines in the reporting user's log. Now 0 of 100 real NA channels flag, and a genuinely stale centre is still caught on both rasters. |
| `logring_discriminate.js` | 8 | That the log ring caps the DOM without shortening the transcript. Real `log()` / `logFlush()` against jsdom: node count stops growing at `LOG_DOM_MAX` while export depth holds at `LOG_KEEP`. The point of the change is both halves at once, so both are measured. |

**152 checks.** Run them as:

```
node test/telemetry_discriminate.js index.html
```

## Experiments and tools

Also outside `run-all.js`. These answer a question or triage a file rather than defending a behaviour, and
some take minutes.

| File | What it is | What it established |
|---|---|---|
| `loop_scatter.js` | Drives the real extracted worker against seeded synthetic IQ across jittered loop alignments. ~4 minutes. | Replayed passes are bit-for-bit identical, so a loop that changes nothing learns nothing — accumulation needs variation. The genuine PI in 10/10 alignments on a marginal signal, 3/10 below the decode cliff. As the negative control, 5 spurious reads across 48 noise alignments, maximum repeat 1, none passing the commit guard. And the result that says **no**: a per-character majority vote across passes committed a PS character that is not in the signal — which is why PS is never synthesised across passes. These are the figures behind 0.10.1's loop design. |
| `wavdup.js` | Triage tool. Reports how much of a recording is **repeated** audio, and how many seconds of it are unique. Zero dependencies; reads the file and nothing else. | Duplication is invisible to a duration check, because repeats *add* length — 8.80 s of repeats padded out 8.80 s of missing audio and the file reconciled against the wall clock while being audibly broken. It found 9.71% repeats in a 90 s recording on an aged 0.10.7 session and 0.00% on 0.11.0. It **slides**: an earlier fixed-grid version undercounted by ~2.5× because SDRConnect's audio frames are variable length (9600 and 9604 bytes both measured inside one minute). |
| `wavdup_discriminate.js` | Builds WAVs containing a known percentage of re-delivered frames, at variable frame lengths, and checks `wavdup.js` reports the rate it was given. | 0.00 → 0.00, 7.50 → 7.50, 12.50 → 12.00, 18.50 → 18.00, and a clean file reads exactly zero. It earned its place immediately: the first `wavdup.js` reported 0.50% on a 25%-duplicated fixture, because the cursor jumped past a matched block without rebuilding the rolling hash. 0.50% is precisely one frame in the whole file — the failure signature named the cause. |
| `wavprobe.js` | Triage tool. Dumps the RIFF/RF64 chunk structure of an IQ recording, decodes its metadata in either flavour, and reports the centre frequency Bridge will use and why. Reads the first 128 kB, so it is safe on a 95 GB capture. Redacts usernames, machine names and paths by default — its output gets pasted into support threads. | Not an experiment; a diagnostic for "why won't this file tune?". Answers `-version`. |

Run them as:

```
node test/loop_scatter.js            # or a path to any build
node test/wavprobe.js capture.wav
node test/wavdup.js recording.wav
node test/wavdup_discriminate.js
```

## Harness

| File | Role |
|---|---|
| `rig.js` | Extracts the real `WORKER_SRC` from a build by its `String.raw` delimiters and runs it in a Node `vm`, exposing `send` / `feed` / `snap` and the worker's SHA-256. It cannot silently test a stale or hand-copied worker. |
| `rdsgen.js` | Synthesises FM-composite IQ carrying a real RDS bitstream, plus pure noise for negative controls. Seeded throughout — two runs are the same run. The block coding is re-derived from the standard rather than copied from the worker, so a pass proves the decoder rather than a shared bug. |

Neither needs jsdom.

## Writing another one

The pattern is worth keeping to, because most of it was learned the hard way:

- **Drive the real code.** Load `index.html` into jsdom with `runScripts: "dangerously"` and call the actual
  functions, or extract the function you care about and run it in a `vm`. A test against a reimplementation
  tests the reimplementation.
- **A stub tests the guard, not the predicate.** Three suites have now been green against a broken build for
  this reason: `scanInDxLog` stubbed while it read a field that does not exist, `scanRaster` stubbed at
  100 kHz while the fault lived on the 200 kHz raster, and flags set by the driver rather than by the code
  that is supposed to set them. Where a suite stubs something the fix depends on, write the second half that
  drives the real thing — or the green means nothing.
- **Enumerate an enum from the code, don't restate it.** The `logged` verdict went uncounted for two
  candidates because the tally was written from a remembered list of verdicts. `deadlist_test.js` extracts
  `scanDwell`'s returns — ternaries included — and requires a branch for each, so a new verdict cannot be
  added without the test noticing.
- **Stub canvas in `beforeParse`.** The shell is one script block: an unstubbed `getContext()` throws
  mid-block, and although function declarations still hoist, every `var` initialiser after the throw never
  runs and the wiring at the foot of the block never executes. Stub `URL.createObjectURL` too, or anything
  reaching `startWorker()` dies.
- **jsdom has no layout.** `clientWidth`, `clientHeight` and `scrollHeight` are all 0, and `scrollTop`
  neither clamps nor fires events. Define them explicitly when the thing under test *is* layout or scrolling.
- **Install a stub before the page runs, not after.** The shell draws its first frame during construction, so
  a `clientWidth` stub added after `new JSDOM` arrives too late: `rafstyle_test.js` seeded the size cache with
  jsdom's 0 and then passed "zero reads in sixty frames" for entirely the wrong reason. Define the getters on
  `Element.prototype` inside `beforeParse` and hold the values in a map the test can move.
- **Test the awkward value, not the convenient one.** A memo written `if(!c)` rather than `if(c===undefined)`
  re-resolves an empty result forever and caches nothing — and the check written for it used `--trace`, which
  jsdom resolves to a real value, so it never exercised the empty case at all. A mutant survived on that.
  Assert against a token that genuinely does not exist.
- **Cover every site, not the biggest one.** The freeze had five canvases reading their own size; the suite
  watched one. Two mutants walked straight through it until the other four were covered.
- **A recording canvas context beats an assertion about arithmetic.** If a suite needs to know where something
  was drawn, capture `moveTo` / `lineTo` / `fillText` / `putImageData` and read the answer out, rather than
  recomputing the expected position in the test. A test that restates the implementation's own maths passes
  against a wrong implementation — that happened here, twice, before both suites were rewritten.
- **Measure, don't restate.** Where a suite checks a number the code produces, compute it from first
  principles or regenerate it from the shipped source. `theme_test.js` computes WCAG contrast from the hex in
  the file and rebuilds the band map's colour scale from the coefficients it parses out of `bmColour()`, so
  retuning either fails the suite rather than agreeing with a stale copy.
- **A count is not a measurement.** One check in `theme_test.js` looked up a rule by name, matched a
  *different* rule that happened to share the selector list, removed the wrong block and passed green while
  the fault it was written for was still present. Assert the thing, not a proxy for it.
- **Prove the suite discriminates.** Introduce the defect deliberately, run the suite, and check it goes red
  before trusting it when it is green. Sixteen mutants were used on `theme_test.js`; two of them exposed a
  suite that crashed instead of reporting a failure, which reads as a broken harness rather than a red.
  0.10.5 added seventeen named mutants across the files above, all caught.
- **Extract defensively, or the suite crashes instead of failing.** A suite that pulls a function out of the
  build unconditionally throws on any build that predates it, and `run-all.js` can only report "N passed,
  M failed" — a throw reads as a broken harness, not a red suite. Grab optionally and substitute a
  sentinel stub, so an older build fails the checks it should fail and nothing else.
- **Report a count, not just a verdict.** `run-all.js` reads "N passed, M failed" out of a suite's output; a
  suite that only prints "all green" shows as `did not report` in the summary and its checks vanish from the
  total, so a suite that quietly shrank would look identical. Print the totals at the end.
- **Delete a test that encodes a wrong belief.** A green test written to a misdiagnosis will keep passing
  against correct behaviour.

## Note on committing

Do not upload this folder through the GitHub web UI *after* running `npm install` — the web UI caps a commit
at 100 files and silently truncates a larger folder drag, and `node_modules` is thousands. Delete
`node_modules` first, or keep your working copy somewhere separate from the one you upload.

**Read the file names back after uploading**, not just the count. `.gitignore` lost its leading dot on the way
through the web UI once, landing as an inert `gitignore` that would have let the next `npm install` push
`node_modules/` through that 100-file cap.
