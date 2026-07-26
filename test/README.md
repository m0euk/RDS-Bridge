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

Then, from the repository root:

```
node test/run-all.js                 # tests ../index.html
node test/run-all.js path/to/work.html   # or any candidate build
```

The runner prints the SHA-256 and version of the file it tested, so a passing run can never turn out to have
been about the wrong build. It exits non-zero if any suite fails.

Each suite is standalone and can be run on its own:

```
node test/mpxaxis_test.js index.html
```

## What is here

| Suite | Checks | Covers |
|---|---|---|
| `bandmap_follow_test.js` | 21 | Band-map playhead follow, and how it interacts with manual scrolling |
| `mpxaxis_test.js` | 48 | The map-view MPX scale: parity with the scale under the spectrum, and its geometry against the composite waterfall |

## Writing another one

The pattern is worth keeping to, because most of it was learned the hard way:

- **Drive the real code.** Load `index.html` into jsdom with `runScripts: "dangerously"` and call the actual
  functions. A test against a reimplementation tests the reimplementation.
- **Stub canvas in `beforeParse`.** The shell is one script block: an unstubbed `getContext()` throws
  mid-block, and although function declarations still hoist, every `var` initialiser after the throw never
  runs and the wiring at the foot of the block never executes. Stub `URL.createObjectURL` too, or anything
  reaching `startWorker()` dies.
- **jsdom has no layout.** `clientWidth`, `clientHeight` and `scrollHeight` are all 0, and `scrollTop`
  neither clamps nor fires events. Define them explicitly when the thing under test *is* layout or scrolling.
- **A recording canvas context beats an assertion about arithmetic.** If a suite needs to know where
  something was drawn, capture `moveTo` / `lineTo` / `fillText` / `putImageData` and read the answer out,
  rather than recomputing the expected position in the test. A test that restates the implementation's own
  maths passes against a wrong implementation — that happened here, twice, before both suites were rewritten.
- **Prove the suite discriminates.** Introduce the defect deliberately, run the suite, and check it goes red
  before trusting it when it is green.
- **Delete a test that encodes a wrong belief.** A green test written to a misdiagnosis will keep passing
  against correct behaviour.

## Note on committing

Do not upload this folder through the GitHub web UI *after* running `npm install` — the web UI caps a commit
at 100 files and silently truncates a larger folder drag, and `node_modules` is thousands. Delete
`node_modules` first, or keep your working copy somewhere separate from the one you upload.
