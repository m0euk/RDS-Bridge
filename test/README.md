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
| `looppass_test.js` | 203 | Loop-pass jitter bounds, deferred parameter writes, the pass ledger, hunt support tiers, the log-catch gate and stamp, the bandwidth sweep and its restore, both view layouts, worker SHAs | jsdom |
| `mpxaxis_test.js` | 48 | The map-view MPX scale: parity with the scale under the spectrum, and its geometry against the composite waterfall | jsdom |
| `iqmeta_test.js` | 52 | IQ file headers: centre frequency and start time across every writer we have measured (SDRuno, HDSDR, SDR Console 8-bit and UTF-16, SDR#), RF64, the fallbacks, and both guards against a fabricated centre | none |
| `theme_test.js` | 62 | Light/dark themes: colour references all resolve, both themes define the same set, contrast computed against WCAG, the contrast toggle raises legibility in both themes, the dark palette has not drifted, light chrome vs dark data, and the playhead cursor against the band map's own colour scale | none |

**386 checks.**

## Experiments

Deliberately **not** picked up by `run-all.js` — it matches `*_test.js` only. These answer a question rather
than defending a behaviour, and some take minutes. Run them on purpose.

| File | What it is | What it established |
|---|---|---|
| `loop_scatter.js` | Drives the real extracted worker against seeded synthetic IQ across jittered loop alignments. ~4 minutes. | Replayed passes are bit-for-bit identical, so a loop that changes nothing learns nothing — accumulation needs variation. The genuine PI in 10/10 alignments on a marginal signal, 3/10 below the decode cliff. As the negative control, 5 spurious reads across 48 noise alignments, maximum repeat 1, none passing the commit guard. And the result that says **no**: a per-character majority vote across passes committed a PS character that is not in the signal — which is why PS is never synthesised across passes. These are the figures behind 0.10.1's loop design. |
| `wavprobe.js` | Triage tool. Dumps the RIFF/RF64 chunk structure of an IQ recording, decodes its metadata in either flavour, and reports the centre frequency Bridge will use and why. Reads the first 128 kB, so it is safe on a 95 GB capture. Redacts usernames, machine names and paths by default — its output gets pasted into support threads. | Not an experiment; a diagnostic for "why won't this file tune?". Answers `-version`. |

Run them as:

```
node test/loop_scatter.js            # or a path to any build
node test/wavprobe.js capture.wav
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
- **Stub canvas in `beforeParse`.** The shell is one script block: an unstubbed `getContext()` throws
  mid-block, and although function declarations still hoist, every `var` initialiser after the throw never
  runs and the wiring at the foot of the block never executes. Stub `URL.createObjectURL` too, or anything
  reaching `startWorker()` dies.
- **jsdom has no layout.** `clientWidth`, `clientHeight` and `scrollHeight` are all 0, and `scrollTop`
  neither clamps nor fires events. Define them explicitly when the thing under test *is* layout or scrolling.
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
- **Delete a test that encodes a wrong belief.** A green test written to a misdiagnosis will keep passing
  against correct behaviour.

## Note on committing

Do not upload this folder through the GitHub web UI *after* running `npm install` — the web UI caps a commit
at 100 files and silently truncates a larger folder drag, and `node_modules` is thousands. Delete
`node_modules` first, or keep your working copy somewhere separate from the one you upload.

**Read the file names back after uploading**, not just the count. `.gitignore` lost its leading dot on the way
through the web UI once, landing as an inert `gitignore` that would have let the next `npm install` push
`node_modules/` through that 100-file cap.
