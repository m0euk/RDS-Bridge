# Changelog

RDS Bridge — browser-based FM RDS decoder for SDRplay via SDRConnect.
All notable changes per release. Dates are release month; every 0.x is a beta.

## 0.11.0-beta — Aug 2026

**Bridge records, and Bridge stops freezing.** Two things in this release, and they turned out to be
connected: the recorder is what finally measured the freeze. A recording is a byte-exact copy of what the
radio delivered, so "9.71% of this file is repeated audio, 8.80 seconds of it never arrived" is the first
hard number anyone has had for a fault that had only ever been described in words.

**Shell only — nothing in the decode path has moved.** Both embedded decode workers are byte-identical to
0.8.8-beta: `WORKER_SRC` `b8e3ecb3…`, `DCWORKER_SRC` `19785acb…`.

### Audio recording

**Record and Stop, in the left panel.** Writes what Bridge is producing to a 48 kHz 16-bit mono WAV, in
every source mode — SDRConnect, IQ file, Network SDR and MPX Stream alike. Elapsed time and running file
size show beside the button; a saved file is confirmed on the panel by name and destination, and stays
there until the next recording starts.

**Bit-exact, not re-encoded.** Both audio paths already hold 16-bit PCM before converting it for playback,
and the recorder takes it there. No resample, no float round trip, no `MediaRecorder`, and the audio graph
is not touched at all. On the SDRConnect lane the two channels are averaged rather than taking the left one,
which is identical to left when the source is mono and correct when it is not.

**It does not force the speakers on.** If monitoring was off when you press Record, the stream is enabled
silently and the volume left alone — an unattended overnight session is the case this was built for. The
previous state is restored at Stop.

**Choose a folder once.** Every recording is then written straight into it with no save dialog, including
one that stops itself at the limit. The choice is remembered between sessions where the browser allows it,
and the panel states which of those you have. With no folder chosen, files go to your downloads folder as
normal. Chrome will not grant access to every folder — on test it refused Downloads itself; pick another.

**Filenames sort chronologically and say what was caught.**
`rdsbridge_20260812T152346Z_88.500MHz_C202_BBC-R2.wav`. Date first, UTC with the `Z`, no colons. PI and PS
appear only when they were actually decoded — nothing is invented to fill the field.

**A 30-minute limit, stated beside the button.** At the limit the recording stops and saves itself, with a
line saying why. It exists to catch a forgotten recording, not to constrain a deliberate one, and it never
discards.

**Recording and scanning refuse each other, in both directions, with a message.** Nothing stops a recording
as a side-effect — including a source-mode switch, which is blocked so that a recording can never span two
lanes and produce a file whose header disagrees with its contents.

Not in this release: MPX composite recording, IQ recording, scheduled or triggered recording.

### The scanning freeze

Long sessions froze, stuttered, dropped audio, needed "Stop scan" pressed twice, and produced recordings
with stutter in them. **One fault, in Bridge's own rendering, with two sources — and neither of them was
SDRConnect.**

**The spectrum display measured its canvas on every frame.** Reading an element's width forces the browser
to re-calculate the layout of the entire page, and it was doing so sixty times a second: 9,000-odd objects
re-laid to draw one trace. Sizes are now cached and kept current by a `ResizeObserver`, which reports a
change when there is one instead of being asked when there is not.

**The four readiness bars animated their width.** A CSS transition on `width` is a layout animation, and
with a new value written every 200 ms the transitions never stopped overlapping — so the whole document was
re-laid again on nearly every frame to move four five-pixel bars. They now animate `transform`, which the
browser can do without laying anything out. Same animation, no layout.

**Why that broke the radio and not just the display.** Chrome delivers WebSocket frames on the same thread
that does the drawing. With that thread fully committed to layout, arriving audio and spectrum frames were
simply not taken delivery of.

Measured on an aged scanning session, Mac mini M-series, 16 GB, Chrome 150 — that machine's figures, not a
promise about yours:

| | before | after |
|---|---|---|
| main thread busy | 100% | **23%** |
| of which layout | 73% | **2%** |
| forced layouts | 31.6/s | **7.0/s** |
| audio frames delivered | 0 | **23.5/s** |
| repeated audio in a 60 s recording | 9.71% | **0.00%** |

The design-token lookups in the drawing loop are also cached now. That is a style cost rather than a layout
one and it is **not** what fixed the freeze; it is listed because it changed, not because it was the cure.

**And the log stopped blaming SDRplay for it.** "SDRConnect has stopped sending" treated the page as
healthy at ten frames a second — and a page in the failed state still managed about sixteen, so the message
declared Bridge clean and pointed at SDRConnect in precisely the case where the fault was ours. The
detector is sound; the attribution was not. It now states what it measured and says plainly when the more
likely fault is here.

**The AF chip list** is rebuilt only when the alternative frequencies change, rather than five times a
second regardless.

### Tests

Two new suites, 224 checks, taking the committed total to **861**. `recording_test.js` (166) covers the WAV
header's two size fields, the stereo downmix, filename construction, the 30-minute limit, the silent-record
contract, the remembered folder and its three outcomes, and the mutual exclusions. `rafstyle_test.js` (58)
counts how often the drawing loop reaches for a value it could have kept — jsdom has no layout engine, so
cost is a Chrome measurement, but the *count* is what regresses — and asserts that no CSS transition anywhere
in the stylesheet animates a layout property.

Both were mutation-tested before being trusted: 50 named mutants across the two, every one caught. Three
survived the first draft of `rafstyle_test.js` and each was a real gap rather than a false alarm.

`wavdup.js` and `wavdup_discriminate.js` join the tools. The first reports how much of a recording is
repeated audio; the second proves it by injecting known duplicate rates, which caught a real defect in it.

## 0.10.7-beta — Aug 2026

**The scan tells the truth about itself.** Every fault in this release is the same shape: a check applied
outside the conditions it was designed for, or a message asserting something the code was not in a position
to know. One of them meant a watch list never checked its own channels at all.

**Shell only — nothing in the decode path has moved.** Both embedded decode workers are byte-identical to
every release since 0.8.8-beta (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). **The helper is unchanged
at 0.9.2-beta and needs no update.** No protocol change.

### Fixed

- **A watch list never checked the channels you gave it.** The watch list exists to monitor clear DX spots —
  channels that read empty by definition until an opening appears — but the rapid watch pass was applying the
  full-band sweep's spectrum pre-skip first. Every named channel was skipped before it was tuned. A
  nine-channel list completed a "pass" in 1.1 seconds having measured nothing, six times in six seconds, and
  reported it as a normal result.

  The readings behind those skips were correct: on a live bench list the channels genuinely measured −0.2 to
  −3.1 u8 above the noise floor. The behaviour built on them was not. The pre-skip exists to avoid dwelling on
  two hundred empty channels in a full sweep; on a list of nine it saved nine dwells and cost the entire
  feature.

  There is a second-order fault behind it worth stating, because it explains why nobody reported this. The
  threshold is an absolute value in u8 on a spectrum that SDRConnect normalises **to the visible range**, so
  it is not a fixed physical level — it moves with span and with the ref-level and base settings. Measured on
  the same radio, same band, same afternoon: the noise floor reads 0.2–2.6 u8 at a 2 MHz span and 22–23 u8 at
  9 MHz. At a wide span with a strong local in the same window, a genuine DX catch can read 1–3 u8 and be
  skipped in silence — indistinguishable from "no DX tonight".

  The watch list now checks every channel you name, every pass. The spectrum reading still appears in the
  verbose log, but it no longer decides anything there. **DX watch and full-band sweeps are unchanged** and
  still pre-skip exactly as before.

- **The scan's map self-check cried wolf, and buried the real cases.** After each spectrum baseline the scan
  locates the strongest bin and reports how far it sits from the nearest channel, warning `MAP IS WRONG` when
  that exceeds a threshold. The warning exists to catch a real fault fixed in 0.10.5, where every level
  reading was taken half a channel out.

  It had two problems. The threshold was derived from the **FFT bin width**, so it grew stricter as the
  capture got narrower in hertz — backwards, since what defines "on channel" is the channel raster. At 512
  bins over 1 MHz it was 3 kHz against a 200 kHz raster: 1.5% of a channel, well inside ordinary peak-picking
  noise. And it ran on **every** window, including windows containing no carrier at all, where it was
  faithfully reporting the position of noise.

  In a user's log it fired on **422 of 522 baselines — 81%**. Of those windows, 245 had a strongest bin
  *below* the noise floor the same line reported. Bucketing by how far the peak stood above the floor, the
  median offset ran from 40 kHz where there was no carrier to 4 kHz where there was one.

  The check is now scaled to the channel raster with a floor of two bins, evaluates only where a carrier is
  actually present, and excludes the span edges where peak position is unreliable. Where it declines to
  judge, it says so, and says the channel measurements are unaffected. Replayed against the same 522
  baselines it drops from **422 warnings to 19** — and those 19, all sitting 52–98 kHz out, are the ones that
  were always worth looking at. The 0.10.5 half-raster fault still trips it at every span offered.

- **A pass that measured nothing blamed the wrong thing, three ways at once.** The message attributed it to
  the session skip cache — on a code path only reachable when that cache is empty. It called the mode "DX
  watch" while a watch list was running. And it advised stopping and restarting the scan, which clears a
  cache that is, again, already empty. Every one of those was contradicted by counters the same message
  already held. It now names whichever reason actually accounted for the skips.

- **MPX Stream reported a normal condition as an error, twice per baseline window.** One message advised
  checking whether the RF waterfall was streaming — in a mode that has no waterfall and cannot have one.
  MPX has no wideband spectrum, so there is never a baseline and every channel gets a full dwell; that is the
  design, not a fault. Both messages now appear in normal colour and describe what is actually happening.
  **Unchanged on SDRConnect**, where the same condition really is a fault worth colouring.

- **A fourth stale description of the pre-0.10.5 scan survived.** 0.10.6 corrected three places where the app
  still said DX watch learns dead channels and speeds up on later passes, and stated that three was all of
  them. The MPX band-scan start message was a fourth, and in MPX the claim is doubly wrong: setting a channel
  aside requires a verdict measured against a spectrum baseline, and MPX has no spectrum, so nothing is ever
  set aside there. Two source comments carried the same stale wording and were corrected with it.

- **Smaller reporting faults, all found while testing the above.** A level printed as "empty, skip" on a
  channel that was not skipped. A watch-list channel count that reported 50 kHz storage buckets rather than
  channels — 14 for a nine-channel list. A progress line naming whichever channel the loop was stepping past
  rather than the one being checked, because it was written before the filter that decides.

### Changed

- **The Guide's unattended-scan section now covers the audio exemption.** A browser will not throttle a tab
  that is producing sound, so switching audio on is the one thing that keeps an overnight scan running at
  full speed once you look away. The section makes clear those figures describe a *backgrounded* tab: with
  the window in front there is no throttling to defeat, and two full-band passes measured 3.1 s and 2.8 s per
  dwell with audio on and off respectively.

### Tests

- **`test/scan0107_test.js` — 68 checks, new.** The map self-check is driven as the real extracted function
  against synthesised spectra at four capture geometries, including the 0.10.5 half-raster fault as a
  standing regression and three baselines taken off the bench. The remainder are source-structure and copy
  assertions, and say so in their own output rather than being read as behavioural coverage. Mutation-tested
  against the published 0.10.6 build: 37 failures.
- The stale-copy sweep was widened. It tested for the exact phrase *learns dead channels* and would have
  missed *learns which channels are dead* — one paraphrase from being useless.

**Suites: 637 checks across nine files.**

## 0.10.6-beta — Aug 2026

**The band map fix.** Two users reported that clicking the map landed on the wrong channel. It was never
reproducible on the bench, and the reason turned out to be that the bench runs at 100% interface scale — the
one setting at which the fault is invisible. Both faults in this release are in the map's click handling;
neither is anywhere near the decode path.

**Shell only — nothing in the decode path has moved.** Both embedded decode workers are byte-identical to
every release since 0.8.8-beta (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). **The helper is unchanged
at 0.9.2-beta and needs no update.** No protocol change.

### Fixed

- **Clicking the band map landed on the wrong channel at any interface scale except 100%.** The pointer was
  measured in on-screen pixels and then divided by the map's *design* cell size. The interface-scale control
  sets a page zoom, so those two are the same number only at 100% — at any other setting the computed column
  is out by the scale factor, which means **no error at the left-hand edge of the map and a growing error
  across it**. At 150% a pointer on 90.7 MHz reported a channel two megahertz higher.

  Reported independently by two users, neither reproducible here, and the scaling questions we asked them
  were the wrong ones: this is Bridge's own **Interface scale** setting, not the operating system's display
  scaling or the browser's zoom, so it never correlated with anything they were asked about.

  The hit test now measures the pointer against the mosaic itself rather than against an assumed cell size,
  which makes it correct under page zoom, browser zoom, a transform or any display density, without needing
  to know which is in play. This is how click-to-tune on the RF waterfall has always worked; the map was the
  only surface in the app that had departed from it.

- **Clicking the band map while a live source was selected restarted file playback underneath the session.**
  The status line read "Playing file", the RF waterfall stopped and the audio went. The map is built from a
  recording and only ever drove the file transport — the build button was correctly disabled on other sources
  and the playhead correctly hidden, but the mosaic itself still accepted clicks. The map is now visibly
  dimmed and inert on any source other than **IQ File**, and says why if you click it anyway.

- **The scan's description of itself was out of date, in three places.** A tooltip, the scan panel and the
  guide all still said DX watch skips channels it finds "dead", and that a pass speeds up as it goes. Since
  0.10.5 a channel showing a carrier is never set aside and every set-aside channel comes back after fifteen
  minutes, so the list settles at a working size rather than growing. The published site was corrected at
  0.10.5; the app's own copy was not, and had gone from stale to wrong.

### New

- **Hover a cell to outline it and read it.** A box marks the cell under the pointer and a chip beside it
  gives the channel, the time and the level, with the PI and station name if you have already caught it. It
  is drawn from the same measurement a click uses, so the read-out and the click can never disagree about
  which cell you are on — which is what makes it usable for reporting an alignment problem rather than only
  for reading the map.

- **The guide covers leaving a scan running unattended.** A DX watch left looping overnight needs its window
  visible and un-minimised, and the browser's sleeping-tabs or memory-saver setting turned off for the page.
  Bridge already detects the condition, says so in the log and stops learning from channels it cannot time
  properly; what it could not do was tell you in advance.

### Tests

`test/bandmap_test.js` — **96 checks**, new. The band map is the largest feature the project has shipped and
its click handling had no committed coverage. Drives the real hit test, hover and source-sync out of the
build under jsdom: which lane a click is allowed on, that the hover read-out and the click describe the same
cell, that the outline is drawn on the cell's own rectangle, and that every cell is hit exactly at all ten
interface scales the control offers — because the fault above is invisible at exactly one of them.

Proven to discriminate against eight named mutants, including a build carrying the 0.10.5 hit test, which
fails it fourteen times.

`bandmap_follow_test.js` gained a corrected canvas stub. Its old one asserted a rect unrelated to the canvas
it belonged to, a pairing the shell cannot produce; harmless while the hit test ignored the rect's scale, and
wrong afterwards. `theme_test.js` widened its on-dark rule list to the two new overlays and pins the count.

**569 checks across eight suites.**

## 0.10.5-beta — Aug 2026

**The overnight scan fix.** 0.10.4 stopped a throttled tab corrupting the scan's dead-channel learning. This
release fixes the mechanism underneath it: a channel could be written off permanently on evidence the scan
had no right to trust, and once written off it never came back. Found by reading three users' logs across
five days, confirmed against a reproduction, and measured over a four-hour run.

**Also in here:** a spectrum-geometry self-check that told every North American user their frequency map was
wrong, on every sweep; a scan that paused correctly but looked like a hang; and an activity log that could
bury itself in a single repeating notice.

**Shell only — nothing in the decode path has moved.** Both embedded decode workers are byte-identical to
every release since 0.8.8-beta (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). **The helper is unchanged
at 0.9.2-beta and needs no update.** No protocol change.

### Fixed

- **An overnight DX watch could write off the whole band and then find nothing.** Four faults compounded:
  two non-committing checks retired a channel *permanently*; a check taken while the browser had stalled the
  page read as `empty` with no pilot lock even on a live station; a channel already in your DX log could still
  be written off; and after one strike the second check used a shorter listening window than the first, so the
  evidence that condemned a channel was weaker than the evidence that spared it. In the reporting user's
  overnight log **all 103 channels were written off within a few minutes** and 883 further sweeps found
  nothing.

  A channel is now only written off on a verdict the scan can stand behind: the spectrum baseline has to
  exist, the timing has to be sound, and the dwell has to have decoded frames. **A channel with a pilot lock
  is never written off** — a carrier that didn't yield RDS this time is not evidence that it never will.
  **A channel already in your DX log is never written off.** Every strike **expires after fifteen minutes**,
  and a sweep that measures nothing at all clears the list rather than trusting it. The shortened second
  window is gone.

  Measured over 3 h 52 m and 142 sweeps: the skip cache held at **27 → 30 → 30 → 30 of 206 channels** across
  the four quarters of the run, with 407 channels written off and 498 re-opened. It reaches an equilibrium and
  stays there.
- **"MAP IS WRONG" on every sweep, for every North American user.** The scan's spectrum self-check compared
  the strongest bin against a channel grid built from zero rather than the grid the scan itself uses. On a
  100 kHz raster the two agree; on the 200 kHz North American raster they are exactly half a raster apart, so
  carriers sitting precisely on 88.9, 97.9 and 105.5 were each reported as ~95 kHz off and the log announced
  that every level reading below it was measured at the wrong frequency. **36 baselines out of 36** in the
  reporting user's log. None now, and a stale centre frequency or a span mismatch is still caught on both
  rasters.
- **A paused scan looked like a hang.** When SDRConnect stops sending, the scan waits rather than judging
  channels it cannot measure. Correct — but the status line still read "surveying 87.5–93.0 MHz…" and the
  frequency read-out was frozen on the last confirmed value, so one user reasonably reported a 79-minute
  pause as a crash. The scan now says **"Paused — SDRConnect is not sending"** on screen, with the elapsed
  time.
- **A stale frequency read-out no longer looks live.** If SDRConnect hasn't confirmed the tuned frequency for
  ten seconds, both read-outs dim and carry the age in their tooltip. Previously the RF read-out sat at full
  brightness above a waterfall that had stopped moving, showing a frequency the radio had left.
- **Pass summaries account for every channel checked.** Channels held because they had a pilot lock, stations
  reheard and stations newly logged were all being checked and none of them counted, so `checked` and
  `verdicts` disagreed. A summary now reads `verdicts: 28 empty, 1 LOGGED, 21 held (pilot lock, never written
  off)` and the parts add up.
- **A repeating notice is written once, not every minute.** A backgrounded tab produced one "the clock
  jumped 60 s" line per minute all night: **500 of one overnight log's 552 lines were that single message.**
  It is now logged once and closed with a summary of how many were suppressed. The message shown when
  SDRConnect stops sending is given in full once per interruption rather than every thirty seconds — one log
  carried 150 copies of it.
- **A connection that never delivered anything is described as exactly that**, rather than as one that
  stopped sending, and it waits ten seconds before saying so instead of three. Connecting with the RF
  waterfall on used to fire the full interruption warning two seconds after connect, before the decoder had
  even been started.

### Added

- **Link diagnostics** — an optional switch in the advanced view, under Band scan. **Off by default.** It
  records the outside conditions that can interrupt an SDR link and that no other counter can see: the
  display pipeline stopping because a monitor slept or the window was covered by another (which does not make
  a tab "hidden", and so used to be invisible), single tasks blocking the page, the browser's outbound socket
  backing up, and the machine changing power source. **The counters run whether the switch is on or off and
  appear in every saved log's header**, along with a one-line machine summary — cores, memory, screen, power
  source. The switch only decides whether each event is also written to the activity log as it happens.
- **Bridge stops polling a link that isn't answering.** It asks SDRConnect for twelve properties a second
  while connected; through one user's 79-minute interruption that was around 57,000 requests to a server that
  was not replying. It now stops asking while the streams are down and resumes when they return.

### Changed

- Round-trip timings that span an interruption are no longer counted as round trips. A property write made
  before a 79-minute silence and echoed after it was reported as "SDRConnect took 4767.6 s to confirm", which
  dragged the session average from under a second to seventeen. Such measurements are now discarded and
  counted separately.

### Known issues

- **SDRConnect link interruptions.** On some systems SDRConnect stops sending spectrum and property data over
  the WebSocket while continuing to send IQ, with the connection still open; on others the connection closes
  outright. Bridge detects this, pauses the scan, judges no channel while it lasts and resumes when the data
  returns, so a scan is delayed rather than corrupted. **The cause has not been identified.** It has been seen
  on three different combinations of operating system, browser and receiver, and in each case only restarting
  SDRConnect itself restored the streams — reconnecting Bridge and restarting the device did not. Investigation
  continues with a standalone diagnostic tool that removes the browser from the picture. If you see it, the
  activity log records what Bridge measured and what to check.

## 0.10.4-beta — Aug 2026

**Band scan reliability.** Three faults found by reading two users' logs, all in the scan driver: DX watch
could skip the whole band without measuring it, a dropped connection left the scan running for ever, and a
backgrounded browser tab silently corrupted the scan's dead-channel learning. Plus a dark-mode readability
request from a third user.

**Shell only — nothing in the decode path has moved.** Both embedded decode workers are byte-identical to
every release since 0.8.8-beta (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). **The helper is unchanged
at 0.9.2-beta and needs no update.** No protocol change.

### Fixed

- **DX watch could skip the entire band without measuring it.** Each sweep captures ~750 ms of RF spectrum as
  a baseline before stepping the channels. When that capture returned nothing — which happens when sweeps come
  round quickly, or if the RF waterfall is switched off — the level readings answered with a placeholder that
  the adjacent-channel test read as *the strongest possible signal*, so every channel in the sweep was passed
  over as "splatter of a strong local". In the reporting user's log, **34 of 44 DX-watch sweeps did this**, and
  the loop checked 70 carriers where a single full-band pass had checked 51. The readings now decline to answer
  when they have nothing to measure; the spectrum pre-skip switches itself off for that sweep and every channel
  is tuned and listened to instead. Slow, and correct: the scan no longer skips a channel it hasn't measured.
- **Losing the connection during a scan left the scan running.** Stopping the decoder always stopped the scan;
  a *dropped socket* did not. If SDRConnect quit or the link failed mid-scan, the scan kept looping against a
  dead connection indefinitely with the **Scan band** button stuck disabled. It now stops itself and says so.
  In the reporting user's overnight log the connection closed at 02:17:52 and sweeps were still incrementing at
  02:22:43 — silently, because the fault above meant it never reached the point of trying to tune.
- **The scan log called a channel a carrier when it had no reading for it.** It now says
  `no baseline — checking`, which is what actually happened.

### Added

- **Throttled-tab detection.** Browsers slow a hidden tab to roughly one timer per minute and can freeze it
  altogether. One user's overnight DX watch stalled for **4 h 23 m** and resumed the instant the window was
  brought back. The scan now measures its own timing, reports the throttling in the activity log with the tab's
  visibility state, and — because a channel judged on a single sample taken a minute late is not a judgement —
  **pauses dead-channel learning until timing recovers**, then says so. Without that, a spell in the background
  would leave channels written off as dead that were never really listened to. **For an unattended scan, keep
  the window visible**; on Edge, also turn off sleeping tabs / efficiency mode for the page.

### Changed

- **Dark mode: panels now stand out from the page behind them.** Requested by a user who liked light mode's
  slightly darker surround around each panel and wanted the same framing in the theme he actually uses. The
  page background moves from `#0d1217` to `#05090c`; **the panels themselves do not move**, so every text
  contrast figure on a panel is exactly as it shipped in 0.10.3 — including `--ink-faint`, which that release
  had deliberately raised to clear WCAG AA. Light mode is untouched.

### Testing

- New `test/scanskip_test.js` — 45 checks covering what the scan's level functions answer when they have no
  baseline, and what the skip decisions then do with that answer. It asserts the *decisions*, not just the
  return values. Run against 0.10.3 it reports 23 failures.
- `test/theme_test.js` gains the card-gradient tokens to its no-drift baseline. They had never been in it,
  which is why an earlier attempt at this release moved three surface tokens that turned out not to paint any
  panel, passed every check, and was invisible on the bench.
- **386 → 438 checks.**

## 0.10.3-beta — Jul 2026

**Light mode.** A theme button in the top bar switches the whole interface between dark and light, and
remembers which you chose. Dark remains the default and is unchanged. Along the way this release fixes the
readability problem that made a light theme worth doing in the first place, in *both* themes, and restores a
band-map cursor that turns out never to have been drawn.

**Shell only — nothing in the decode path has moved.** Both embedded decode workers are byte-identical to
every release since 0.8.8-beta (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). **The helper is unchanged
at 0.9.2-beta and needs no update.** No protocol change.

**This release also carries every fix from 0.10.2, which was never published separately** — there is no
`v0.10.2-beta` tag. See the 0.10.2 section below; if you are coming from 0.10.1, you are getting both.

### Added

- **Light mode.** A `theme` button beside `contrast`. Panels, controls, labels, axes and the band-map frame
  follow the theme; your choice persists between sessions.
  - **The waterfall, the MPX spectrogram and the band-map body stay dark in both themes.** This is a decision,
    not an omission. Those three are signal painted through a colour map, and a light version of a colour map
    is harder to read, not easier. They gain a border in light mode so a dark panel doesn't float unattached
    on a light page.
  - Every text colour in the light palette was checked against every background it appears on. The weakest
    pair is 4.94:1, so the theme clears the WCAG AA standard for normal text throughout.

### Fixed

- **Faint label text now meets WCAG AA — in dark mode too.** The dimmest text in the interface sat at
  **3.16:1** against its background, below the 4.5:1 standard for normal text, and it is used in 57 places in
  the stylesheet plus five more in canvas drawing. It is now **4.83:1**, measured against the lightest surface
  it actually appears on rather than an average one. The `contrast` toggle was a manual workaround for this
  and remains available for anyone who wants more.
- **The high-contrast toggle works in light mode.** Its values were written for a dark background only and
  were not scoped, so turning it on with a light theme would have produced near-white text on a white page —
  the readability control destroying readability. Each theme now carries its own pair.
- **The band-map playhead is visible.** The dot marking your position in a recording referred to a colour that
  was never defined anywhere in the file. The declaration was therefore discarded, and the dot has been drawn
  with **no fill at all since 0.10.0** — a soft halo with a hole in it. Against the map's own colour scale that
  is close to invisible, which is exactly what a reader described. The fill is restored, the dot is slightly
  larger, and it now carries a dark ring inside a light one.
  - **Why a contour and not a brighter colour.** The map runs from black through red and orange to near-white.
    Measured against that scale, no single colour clears 1.05:1 everywhere — not red (1.03), not teal (1.01),
    not white (1.01), not black (1.02). A dark ring beside a light ring clears **4.48:1**, because whichever
    end of the scale a cell sits at, one of the two shows. The DX catch rings in the same picture have always
    been drawn this way; the playhead simply wasn't. The time and channel rules got the same treatment.

### Internal

- **`test/theme_test.js` (62 checks)** joins the suite set: that every colour reference resolves to a real
  definition, that both themes define the same set, contrast computed from the file against WCAG rather than
  restated, that the contrast toggle raises legibility in both themes, that the dark palette has not drifted
  from 0.10.2 except where this release says it has, and that the playhead cursor reads against a colour map
  regenerated from the shipped code rather than a copy of it.
- **`test/rig.js`, `test/rdsgen.js` and `test/loop_scatter.js` are now in the repository.** The first two are
  the off-hardware harness — the real decode worker extracted from a build and run in a Node `vm` against
  seeded synthetic IQ. `loop_scatter.js` is the experiment behind 0.10.1's loop-accumulation design, whose
  figures the 0.10.1 notes quoted while the file itself was never committed. It reproduces them exactly.
- **`test/iqmeta_test.js` (52 checks)** and the `test/wavprobe.js` triage tool, both from 0.10.2, are also now
  in the repository.

## 0.10.2-beta — Jul 2026

**Never released on its own; published as part of 0.10.3-beta.** There is no `v0.10.2-beta` tag. Everything
here is in the 0.10.3 download.

**IQ recordings tune absolutely.** Three independent faults in one code path, any one of which alone loses the
centre frequency of a recording. **Shell only** — both decode workers byte-identical to every release since
0.8.8-beta; the helper was unchanged at 0.9.2-beta.

### Fixed

- **Recordings from SDRuno and HDSDR now tune absolutely.** Both write the centre frequency into the file
  twice — once in the metadata and once in the filename — and Bridge was reading neither, so every capture from
  either program opened with a dash where the frequency should be and no way to tune to a real station. This is
  not a small class of file: SDRuno is SDRplay's own software, and absolute tuning from one of its recordings
  had never worked.
- **Centre frequencies in filenames are read in kHz, MHz and GHz.** Previously only MHz and a bare Hz value
  were understood, which is why a name ending `_88489kHz_` was ignored. A bare Hz figure still has to carry at
  least six digits before it is believed, so a stray `105Hz` in a name cannot be mistaken for a station.
- **SDR Console recordings read their metadata at last.** SDR Console writes its metadata as UTF-16 text with
  no byte-order mark. Bridge tested for it byte-by-byte and never matched, so **every SDR Console recording has
  been taking its frequency from the filename since the reader was written** — and silently getting nothing
  when the filename didn't carry one.
- **An unrecognised recording no longer invents a frequency.** Reading the metadata is now conditional on the
  file also carrying a valid timestamp in the place that file format puts one. Without that check, a program
  nobody has tested against can supply a plausible-looking number from the wrong bytes — which is precisely
  what happened to SDR Console recordings during development, reporting 3.145774 MHz for an 88.5 MHz capture.
  An unfamiliar recording now falls back to the filename instead.
- When a recording's metadata and its filename disagree about the centre frequency by more than 50 kHz, the
  activity log says so. The metadata still wins; some recorders write a pointer to the *next* file of a split
  into the header, so a disagreeing name is often the recorder working as designed rather than a fault.

### Added

- **A `guide ↗` link in the top bar**, beside `? help`, opening the illustrated guide at rdsbridge.com.

## 0.10.1-beta — Jul 2026

**The hunt.** Looping a section of a recording now builds a picture instead of repeating one. Each pass starts
a fraction of a second later than the last and works through a short list of channel bandwidths, so every lap
is a genuinely independent attempt rather than a rerun — and a **Hunt** strip assembles the station across
them: the name filling in character by character, the PI with the count of passes that read it, programme
type, country, alternative frequencies. This is the experience the section loop was always for, and it is now
the thing the loop actually does. **Shell only:** both embedded workers are **byte-identical to 0.8.8 through
0.10.0-beta** (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). No helper change, no protocol change.

### Added

- **The hunt — a composite picture across loop passes.** A strip above the waterfall, shown during looped
  playback, holding what the passes have given up: PS per character, every PI candidate with its pass count,
  PTY, country once the ECC decodes, AF. Each part is drawn at the strength of its evidence — **bright** where
  it came back on several passes *under more than one configuration*, **dim** where it repeated but only ever
  under one, a faint dot where nothing has been read. It updates while a pass is in flight, not only at the
  boundary.
- **Jittered pass starts** (*jitter each pass*, on by default). Each lap begins up to 400 ms — or 8 % of the
  section, whichever is smaller — later than the last, walking a golden-ratio sequence so the alignments
  spread evenly and reproduce. The first lap is exactly the section you marked.
- **Bandwidth sweep** (*vary bandwidth*, on by default in a loop). Each pass takes the next of
  160 / 180 / 205 / 140 / 225 kHz rather than holding the width you set. 160 kHz goes first because it was the
  only width that came out ahead on *both* counts in the off-hardware bandwidth sweep. Your own setting is
  restored the moment the loop stops, and is never persisted or overwritten.
- **Pass ledger.** Under the transport: one row per completed lap with the settings in force and what that
  lap alone read, plus a per-PI tally — *0xC202 in 7 of 9* — with the bandwidths that produced it and whether
  it ever passed the commit guard. Repeated into the map footer, where the loop is actually being watched.
- **Log a catch from the hunt.** A button in the Hunt strip, available in looped playback only and only once
  a PI has been read on at least two passes. It records the **strongest single pass's own conditions** — its
  SNR, pilot and error-correction figures — never an average, and writes the name from the bright characters
  only. The entry is stamped in the DX log, the CSV and the JSON backup as coming from a hunt, with the number
  of passes and configurations behind it.
- **Decoder settings can be changed while a loop runs.** Bandwidth, error correction, matched filter and sync
  mode all rebuild the decoder, so changing one mid-pass used to throw that lap away. They are now held to the
  top of the next pass — the control moves at once, the decode filter changes at the boundary, and the ledger
  records which setting produced which read. Acquisition and the PI commit guard are unaffected and still
  apply immediately; neither rebuilds anything.
- **DX Log view.** *dx log* in the view selector, available from every mode: the log full screen, list
  scrolling inside the window, with the backup / restore / export controls. A log of forty entries is taller
  than any shared view can spare a corner for.

### Changed

- **The band map has the column to itself.** The DX log panel is no longer drawn in map view; its catches are
  still on the map as blue rings and counted in the map header, and the map footer links across to the new
  view. The map's height is now **measured** from the space the column actually has, rather than set as a
  fraction of the viewport.
- The activity log reports the map's fit measurement once on entering the view, and reports it as an error if
  any part of the column falls below the window.

### Fixed

- **Full-height views ran off the bottom of the screen.** `body` is `min-height:100%`, so the document grows
  with the tall left column and the page scrolls; a `height:100vh` child inside `main` therefore began below
  the header and ended roughly a header's height *below* the bottom of the window, with the overflow clipped.
  The map footer sat in that band, and on a 4K display so did more. The band map and DX Log views now pin the
  document to the viewport and let each column scroll inside itself.
- A long DX log no longer squashes the band map. With a full log the map had been pinned to a fixed minimum
  height whatever the size of the window.

### Notes

- **Nothing here touches the decode path, and nothing accumulates confidence.** The per-pass decoder reset is
  unchanged and deliberate. `piVotes` is the only guard block A has — it carries an offset-word syndrome and
  no CRC, so repetition is the whole defence against a burst-corrected accident being read as a PI. The hunt
  counts passes and configurations *separately from* anything the decoder reports, writes nothing back to it,
  and is never an automatic commit source: automatic DX logging still takes only what a single pass decoded.
- **Why the passes are varied rather than simply repeated.** Replaying identical samples through the decoder
  is bit-for-bit deterministic — ten passes over one section, five with the feed chunk size varied from 6 k to
  131 k frames, produced the identical result down to `dataQ` at nine decimals. A loop that changes nothing
  therefore learns nothing; it reports one answer over and over. Independence has to come from varying the
  decoder.
- **Why "dim" stays dim.** Jitter decorrelates timing, but the noise in a recording is frozen, so errors
  repeat across passes. In the off-hardware test a per-character majority over ten jittered passes at one
  bandwidth committed a character that is **not in the signal**, on two readings. The picture therefore tracks
  configuration diversity separately from pass count, shows both, and writes only bright characters into a
  logged name.
- **The figures behind all of this are off-hardware**, from `test/loop_scatter.js` driving the real extracted
  worker against seeded synthetic IQ: the genuine PI in 10 of 10 alignments on a marginal signal, 3 of 10
  below the decode cliff, and — as the negative control — 5 spurious readings across 48 noise alignments with
  a maximum repeat of 1 and not one passing the commit guard. They justify the *shape* of the read-out. They
  are not a threshold, and no threshold is applied.
- **New test suite.** `test/looppass_test.js` (203 checks) covers the jitter bounds, the deferred parameter
  writes, the ledger, the hunt's support tiers, the log-catch gate and stamp, the bandwidth sweep and its
  restore, the two view layouts and the worker SHAs. `test/loop_scatter.js` is the experiment above; it is
  deliberately outside `run-all.js` because it takes minutes and is an experiment, not a regression test.

## 0.10.0-beta — Jul 2026

**A band map for IQ recordings.** A recording holds far more than you heard while it was playing. The new
**Band Map** turns one into a picture — time down the page, channels across, brightness showing how far each
channel stood above its own noise floor at that moment — so a two-minute opening on 90.7 half an hour in is
something you can *see* rather than something you had to be listening for. Click any cell and the recording
seeks there, tunes that channel and starts playing. **Shell only:** both embedded workers are
**byte-identical to 0.8.8 through 0.9.4-beta** (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). No helper
change, no protocol change.

### Added
- **Band Map (IQ File only).** A frequency × time mosaic of a whole recording, in its own **map** view.
  Channels follow the channel-spacing raster; recordings that carry no centre frequency get a relative
  (offset) axis. Frozen channel header and time gutter, three cell sizes, and a resolution ladder of
  5 / 10 / 30 / 60 s / 2 / 5 min per row — 5 s by default, stepped up automatically for a recording long
  enough to overrun the canvas.
- **Seek-and-sample build.** The map does **not** read the whole file. Each time bucket is established from
  four short sample windows, four Bartlett-averaged periodograms each, max-held across the bucket. A 66 GB,
  32-minute, 9 MHz capture built a 91-channel × 396-row map from 1581 reads in **1.3–1.4 s** on an Apple
  Silicon Mac mini; that figure is that machine's, not a promise about yours.
- **Click-to-play.** Clicking a cell seeks the transport to that time, tunes that channel, and — if the
  recording is stopped or paused — starts it and arms the audio tap.
- **Playhead.** A time rule, a channel rule and a dot at their intersection, following playback. It stops
  following the moment you scroll elsewhere, and picks up again when you scroll back to it or click a cell.
- **Section loop.** *loop start* / *loop end* / *play loop* / *clear* on the transport, with the looped
  stretch drawn on the map. The decoder is reset at the top of every pass — see **Notes**.
- **DX-log overlay.** Catches made from the loaded recording are drawn as blue rings, so a bright column with
  no ring is an unidentified target. `commitCatch()` now records the position in the recording and the file
  name with each catch; entries without them (pre-0.10.0, or logged live) are skipped rather than drawn at an
  invented time.
- **Capture roll-off marked.** Two faint vertical lines show where the capture filter begins rolling off. The
  full captured span is mapped and the roll-off is **marked, not trimmed** — a channel reading low because it
  sits in the roll-off is a different thing from an empty one.
- **MPX scale in map view.** The composite waterfall keeps its 10 kHz scale and its 19 / 38 / 57 kHz markers
  in the one view that hides the MPX spectrum those normally sit beneath. Same constants, same colours, same
  span expression as the spectrum's own scale.

### Changed
- The in-app Guide gains a **Band Map** section and a description of the **MPX scale** and its three markers.

### Notes
- **Why the loop resets the decoder every pass.** Looping feeds the decoder the same samples. Carrying RDS
  state across passes would let one realisation of noise vote for the same spurious PI on every lap, so
  dominance and vote count would climb with no new evidence behind them. Vote count is the instrument this
  project relies on to spot a fabricated PI, and inflating it would break the one check that works. Each pass
  is an independent attempt instead. Accumulating evidence across *genuinely independent* passes is a
  candidate for a later release, and is not claimed here.
- **Brightness is relative to each row's own median floor**, not an absolute level, and is not comparable
  between recordings. The map answers "was anything here?"; identifying a station still means playing it.
- **The map is IQ File only.** It samples across a whole file on disk, which a live stream does not have.
- The helper is **unchanged** since v0.9.4-beta. Bridge and the helper remain a matched pair; nothing in this
  release alters the IQ protocol or the helper's wire format.

## 0.9.4-beta — Jul 2026

**A built-in self-check.** A new button beside *help* tests the user's browser, confirms their copy of RDS
Bridge is complete and unmodified, and proves the decoder works by generating a synthetic RDS signal and
decoding it — then writes a plain-language report to the Downloads folder that the user can read or email for
support. **Nothing is ever sent automatically**, and the report carries no file names, locations, serial
numbers or DX-log contents. **Shell only:** both embedded workers are **byte-identical to 0.9.1/0.9.2/0.9.3-beta**
(`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). No helper change, no protocol change.

### Added
- **Self-check (Tiers 1–4).** Environment and capability check (browser, engine, secure context, storage);
  a build-integrity check hashing both embedded workers against baked-in expected SHAs; a decoder proof that
  runs the *real* worker unchanged against a synthetic composite in a throwaway Worker, with a seeded negative
  control that confirms noise is never decoded into a station; and a per-source-mode connection check.
- **SDRConnect front-end overload** is now read and reported. An overloading tuner can stop RDS decoding on a
  strong, clean-looking signal; the self-check flags it with plain guidance (lower RF gain, attenuate, or
  switch antenna). `signal_power` and the read-only LNA-state readback are reported alongside.
- **Storage-loss warning.** If the browser will not persist data to disk (for example a private window), the
  self-check warns that the DX log and settings will be lost on close, and points to the backup button. The
  DX-log fill level is reported against its cap.
- **Band scan, explained.** The report and a new help section explain the odd frequency the radio jumps to
  mid-scan (it is placing the capture window, not tuning to a station), and surface skip-list, watch-list,
  region, raster and channel-bandwidth settings in plain language.

### Changed
- **Skip-list and watch-list counts now report FM channels, not internal buckets.** A list like
  `87.5-88.0 88.8 91.0` now reads *8 channels* everywhere it is shown — the scan panel, the save
  confirmations and the self-check report — matching what the user typed. Scan matching is unchanged.
- The in-app help gains a self-check section and a scan-explanation section; a stale note implying a
  local file cannot save at all was corrected.

### Notes
- This release publishes alongside **0.9.3-beta** (below), which was locked as a local baseline and held.
- `crypto.subtle` and Worker-from-Blob are confirmed working on `file://` in current Chromium; the AudioWorklet
  module loader is refused on `file://` (both Chrome and Edge), which is why file-opened pages use the standard
  capture path. The self-check reports the capture path actually in use.

## 0.9.3-beta — Jul 2026

**DX-log safety.** Deleting entries, or clearing the log, can now be undone — and the change is durable across
a reload. Locked as a local baseline and published with 0.9.4. **Shell only; workers byte-identical to 0.9.1.**

### Added
- **Undo for the DX log.** The last delete-selected or clear-log action can be put back with an undo button,
  and it survives a page reload. Catches made since the deletion are preserved — undoing an old delete never
  removes a newer catch.
- **Timestamped activity-log text export** with an explicit line-cap disclosure.
- **Per-row DX-log deletion** by stable entry ID, so deleting one row never removes the wrong one.

### Changed
- Delete confirmations reworded now that the action is reversible.

## 0.9.2-beta — Jul 2026

**Bridge can tune your radio in MPX mode**, when the frequency helper is connected to something it can control
over CAT — SDR Console is the case this was built and bench-tested against. That unlocks type-in tuning and the
**band scan** in MPX, and comes with two decode-integrity fixes found along the way. **Shell + helper:** both
embedded workers are **byte-identical to 0.9.1-beta** (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). There
is **no protocol change** — the control frame is the one already published in `PROTOCOL-generic-iq.md` §7 — but
**the helper and Bridge must be updated together**, because earlier helpers refuse the tune instruction.

### Added
- **Type-in tuning in MPX.** When the helper reports a controllable source, the frequency readout above the
  waterfall becomes editable in MPX exactly as in every other source mode: click, type MHz, press Enter. The
  decimal point is optional, as elsewhere. With a source that cannot be controlled the readout stays read-only
  and says so.
- **Band scan in MPX.** The scan retunes the radio channel by channel over CAT and logs whatever decodes,
  through the normal PI commit guard. It is **much slower than the live-SDRConnect scan, unavoidably**: MPX has
  no wideband spectrum to skip empty channels with, and each channel needs roughly two seconds for the audio to
  travel through the demodulator and virtual audio cable and lock. A full band pass takes several minutes. Use a
  **watch list** for routine monitoring, or leave **DX watch** looping — it learns dead channels and speeds up
  each pass. Decoding itself is unaffected by the speed.
- **In-app help:** a new "Tuning and band scan in MPX mode" section covering when tuning is available, why the
  scan is slow, and how to use it well.
- **Helper:** accepts the published `control` / `action:"tune"` frame and sets the radio's frequency over CAT;
  reports whether the connected source can be controlled at all. Sources that cannot be tuned are unchanged and
  continue to refuse. A unit test pins the CAT set bytes and the control-frame shape so neither can drift.

### Fixed
- **The decoded station was held after the frequency changed in MPX.** A PS and PI could remain on screen
  against a frequency they never came from — tuning from a station to empty air left the previous station
  displayed indefinitely. Both existing reset triggers (a pilot break and a change of PI) require the *new*
  frequency to announce itself, and empty air announces nothing. A confirmed frequency change now resets the
  decoder itself.
- **A catch could be logged against the wrong frequency.** Audio reaches the decoder a second or two after the
  radio retunes, so a station could commit after the scan had stepped on and be recorded one channel high.
  Catches are now stamped with the channel they were heard on, and in MPX a commit arriving sooner than a
  genuine lock can form is held back rather than logged.
- **The band scan reported a station it had heard before as a timeout.** A rehear does not grow the log, which
  the scan read as failure; it is now reported as "reheard", and a rehear clears that channel's dead-strike in
  DX watch.
- **A read-only frequency readout looked identical to an editable one** — same colour, full opacity — so there
  was no way to tell whether tuning was available. It is now dimmed.

### Notes
- Reverse-CAT control is a bigger primitive than the scan that uses it: the helper can now set the radio's
  frequency in MPX at all, which it previously could not. The scan is the first consumer.
- Known limitation, deferred to 0.9.3: MPX has no adjacent-channel splatter suppression. The live-SDRConnect
  scan skips channels next to a strong local using the RF spectrum; MPX has no spectrum, so a strong local's
  splatter can still *display* on the adjacent channel. The post-retune guard keeps it out of the DX log in
  testing, but the display is not yet defended.

## 0.9.1-beta — Jul 2026

Three shell-only features on a "monitoring + international reach" theme — a new **Pano** view, **user-selectable
channel spacing** (including Thailand's quarter-MHz grid), and in-app help updates. **Shell-only:** both
embedded workers are **byte-identical to 0.9.0-beta** (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`), no
protocol change and no helper change — every helper from 0.8.6-beta onward pairs with it unchanged.

- **Pano view — a fifth view mode for watching the band.** It puts the identification cards (PS, RadioText,
  PI-stability) and the 57k confidence strip over a deep, screen-filling RF waterfall, with a thin activity
  strip kept below so a catch stays visible. Built for DXers who want a long stretch of history at a glance:
  a **depth control (1× / 4× / 8× / 16× / 32×)** slows the waterfall by *max-holding* several spectrum frames
  into each row, so a brief opening still paints bright rather than being averaged away. Audio and the
  stereo / RDS status chips are available here too. It shows the captured span — a deep single-span
  waterfall, not a stitched whole-band panorama — and, like Compact and Essentials, it's per session.
- **Channel spacing is now yours to choose, decoupled from the region.** A new **Spacing** control offers
  **Auto** (follows the region: 100 kHz Europe/rest-of-world, 200 kHz North America), **50, 100, 200 and
  250 kHz**. 250 kHz lands on the quarter-MHz grid used in Thailand (88.25, 101.75 …); 50 kHz suits grids
  like Italy's. Your choice drives the ± tune buttons, wheel-scroll tuning and the band scan together on one
  grid, and the click-to-tune snap gains a matching 250 kHz option. The DX log and skip-list now key on a
  50 kHz grid, so quarter-MHz catches are logged and skipped precisely.
- **Wheel-scroll tuning follows your channel spacing.** Scrolling over the waterfall now steps by whole
  channels — the same spacing as the ± buttons and the scan — so on **Auto in North America it steps
  200 kHz, not 100**. Fine landing still lives on click-to-tune's snap dropdown.
- **The region toggle is relabelled Region RoW / NA** (it used to read EU). "RoW" — rest of world — is the
  honest label: it covers Europe, Thailand, Australia and everywhere else on 50 µs de-emphasis and RDS, as
  opposed to North America's 75 µs and RBDS.
- **In-app help** now states the Chromium-only requirement and links to rdsbridge.com (Guide and About
  tabs), and the contact address is now `info@rdsbridge.com`.
- **Decode path unchanged:** both embedded workers are byte-identical to 0.9.0-beta (`WORKER_SRC b8e3ecb3…`,
  `DCWORKER_SRC 19785acb…`). Everything in this release is the page shell.

## 0.9.0-beta — Jul 2026

A **band scan** for RDS Bridge — sweep the FM band, find the carriers, and log the ones that decode RDS.
**Shell-only:** the DSP is untouched — both embedded workers are **byte-identical to 0.8.8-beta**
(`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`), no protocol change and no helper change, so every
helper from 0.8.6-beta onward pairs with it unchanged.

- **Band scan (Decoder panel).** Finds carriers from the RF spectrum, tunes each on the region channel raster (100 kHz, or 200 kHz on odd tenths in North America) and logs the ones that decode RDS — through the normal PI commit guard, so nothing is fabricated; results stream into the DX log
  as it goes. Three modes:
  - **Full band** — sweep the whole band once and log every station it can decode.
  - **DX watch** — sweep the whole band on a loop, skipping your skip-list, empty channels, strong-local
    splatter and dead carriers, converging on genuinely new signals. A caught DX is *never* auto-skipped.
  - **Watch list** — rapidly loop just the frequencies you choose (single freqs and ranges, e.g.
    `87.5-88.0 104.2`), for monitoring the clear channels where DX shows first.
- **Carrier detection is modulation-robust.** The scan decides "carrier or empty" from **integrated channel
  power** (mean across the channel), which stays steady on clear channels where a single spectrum bin
  wanders with FM modulation. Empty channels are skipped cleanly and it stops on real signals; the band
  edges (87.5 and 108.0) are covered by an even, nearest-centre window layout.
- **Skip list — the frequencies the scan never stops on (your locals).** Tick "skip" on any DX-log row to
  add it, type frequencies directly (they apply on Enter), or press "＋ my catches" to add your whole log at
  once; removable chips show what's set. Because a caught DX is never auto-skipped, *you* decide what to
  ignore — the scanner never does it for you.
- **Verbose scan log.** An optional toggle that logs every channel the scan checks — its integrated level
  and what it decided (empty, carrier, skip-listed or logged): a running text view of the sweep.
- **The activity log now holds the most recent 50,000 lines** and only auto-scrolls when you are already at
  the bottom, so a long run doesn't pull you away while you're reading it.
- **Fixed:** Essentials view now keeps the frequency readout and tune buttons — they previously vanished with
  the waterfall, leaving no way to see or change the frequency in that view.

## 0.8.9-beta — Jul 2026

A third **Network SDR** source: **SDRConnect**. **Helper-only** — RDS Bridge itself (`index.html`)
and both embedded workers are **byte-identical to 0.8.8-beta**, no protocol change. Because the wire
frames are unchanged, this helper pairs with **any Bridge from 0.8.6-beta onward** (including 0.8.8);
there is no new Bridge to download for this release.

- **Decode an SDRplay receiver through SDRConnect, over your network.** The helper now speaks
  SDRConnect's own WebSocket API (port 5454) as a client, reads its live IQ, and streams it to RDS
  Bridge on the existing Network SDR path — the same lane SpyServer and rtl_tcp already use. Pick
  **Network SDR — SDRConnect (SDRplay)** on the helper's setup page, point it at SDRConnect
  (`localhost:5454` on the same machine), and tune from RDS Bridge.
- **Why this exists — it fixes stutter.** Connecting a browser *directly* to SDRConnect across a Wi-Fi
  LAN stutters: the browser can't buffer the real-time IQ against Wi-Fi jitter, so audio and the display
  break up (the decode itself is fine — it's rate-agnostic). The helper is a native, buffered process on
  that hop, and it **narrows the stream at the source** — it asks SDRConnect for a ~250 kHz sample rate,
  so only an RDS-appropriate stream crosses the network instead of the full device rate — then hands
  Bridge a smooth localhost feed. Bench-confirmed on an RSPdxR2: the radio honoured the 250 kHz request,
  decoded cleanly, and audio was smooth over Wi-Fi.
- **Run the helper on the same computer as SDRConnect for the best result.** Then SDRConnect → helper is
  a local connection at full rate, and only the narrowed stream travels the network to RDS Bridge.
- **Tuning.** When SDRConnect reports hardware control available, RDS Bridge drives the tuning (the helper
  recentres SDRConnect on each station). When it doesn't, the source is read-only: it streams whatever
  SDRConnect is tuned to and declines tune requests, exactly like a read-only SpyServer.
- **No RF waterfall on the SDRConnect source (yet).** Unlike SpyServer, this source does not paint the
  wideband click-to-tune waterfall — a deliberate scope choice for this release (decode and audio come
  first, and SDRConnect's spectrum is tied to the narrowed rate). If the band-view waterfall would be
  useful to you, **say so** (Discord / info@rdsbridge.com) and it goes on the backlog; we'd rather build
  it for real demand than on spec. The narrow baseband display (pilot / RDS subcarrier) is unaffected.
- **Under the hood.** The helper gained a small standard-library WebSocket *client* (it previously spoke
  WebSocket only as a server). No new third-party dependency; still one pinned, cgo-free module and a
  single static binary. The SDRConnect reader is unit-tested against a fake SDRConnect server (handshake,
  narrow-rate request, IQ conversion, tune-recentre, read-only refusal).
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0
  (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). This release changes only the helper.

## 0.8.8-beta — Jul 2026

Consolidation and cross-source fixes for RDS Bridge itself. **Shell-only** — no helper change, no
protocol change; a 0.8.6-beta helper pairs with this release unchanged. Both embedded workers are
byte-identical to 0.7.0.

- **One audio control for every source.** The four separate audio controls — the header button (live SDRConnect), the file transport's **audio ▶**, the Network SDR panel's **Audio ▶**, and MPX's **monitor audio** checkbox — are now a **single control in the header**, next to the volume slider, that follows whichever source is active. There were only ever two mechanisms behind the four: SDRConnect's own PCM stream (live only) and the decode worker's audio tap (file / MPX / Network SDR, which had shared one internal flag since each landed). The single button **arms as well as plays**: switch it on before you Play a file or Start an MPX stream and audio comes up with the stream; on Network SDR it enables once the stream is running. Volume was already shared and is unchanged. The audio data path is untouched.
- **Channel-step buttons follow the region.** The ± step buttons on the frequency readout now step by **100 kHz** in Europe / rest-of-world and **200 kHz** in North America — the FM channel raster — instead of always stepping 200 kHz (the NA raster), which was wrong for most of the world out of the box. No new setting: the **region toggle** drives it, the same switch that already sets the PTY label table and the audio de-emphasis. That control is now labelled **Region EU / NA** rather than "PTY EU" — it has driven de-emphasis since 0.5.2 and the raster now too, so the PTY-only label had outgrown itself. The click-to-tune snap step (`#wfSnap`) is unchanged: its 100 kHz default is already correct and it is a persisted user choice mirroring SDRConnect's own Tuning Step Size.
- **Save the activity log to a text file.** The activity log gains an **Export** button that writes the on-screen log to a timestamped `.txt` file (`rds-bridge-log-YYYY-MM-DD_HHMMSS.txt`), with a header carrying the save time and version. The log is a 250-line ring; the export carries what is on screen and the file header says so.
- **Delete individual DX log entries.** Each DX log row gains a checkbox; **Delete** removes the ticked entries, rather than only being able to clear the whole log. Entries now carry a stable id assigned at commit (existing logs are migrated on load), so a catch landing between selecting and deleting can't shift the selection onto the wrong row.
- **The "SDRCONNECT built-in" comparison row is hidden off-live.** SDRConnect's own decoded PI/PS/RadioText is only available on a live SDRConnect connection, so the comparison block is now hidden entirely on file, MPX and Network SDR, where it previously sat showing empty dashes.
- **The per-source "Tune to (MHz)" boxes are gone.** The IQ File and Network SDR panels each carried their own tuning box; both are removed. Tune every source the same way — from the **main frequency readout above the waterfall**, or by clicking / scrolling the waterfall itself. In file mode the offset-from-centre feedback the box used to show now goes to the activity log.
- **⚠ Fixed: live controls and readbacks leaked into non-live sources.** Switching away from live SDRConnect **without stopping first** — while the SDRConnect socket stayed connected — left several live-only behaviours active under the new source:
  - The live decoder **Start** button stayed enabled in file / MPX / Network SDR mode, and pressing it started a live IQ stream and a second audio stream **on top of** the file's.
  - A file tune set from the readout or the waterfall **flipped back** to the last live frequency a moment later, as SDRConnect's `device_vfo_frequency` push kept repainting the readout (the file was correctly tuned throughout; only the display flipped).
  - Live rate / centre pushes could disturb the Network SDR lane the same way.

  All three shared one cause: live control and readback paths remained active while a non-live source was selected. They are now **inert unless live SDRConnect is the current source**, even while SDRConnect stays connected — matching the existing rule that already kept live spectrum frames out of the file waterfall.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`) — every change above is the page shell.

## 0.8.7-beta — Jul 2026

Two user-facing additions to RDS Bridge itself. **Shell-only** — no helper change, no protocol change;
a 0.8.6-beta helper pairs with this release unchanged.

- **Antenna selector for SDRConnect.** RSPs with more than one antenna port — the RSPdx / RSPdxR2's **Antenna A / B / C**, for instance — can now be switched from inside RDS Bridge, in the **Device** panel, instead of going back to SDRConnect to do it. The available ports and the one currently in use are **read from the radio**, never assumed: the selector shows the port the radio actually settled on, not the one that was requested, so if the hardware declines or reroutes a request the dial tells you the truth. Receivers with a single port don't show the control at all. Needs SDRConnect hardware control (a read-only session gets a disabled control, not a silent no-op). Switching ports briefly re-acquires, as any front-end change does.
- **DX mode — a plain switch for a setting that was already there.** Under **Decoder**, **DX mode** commits a PI code on its **first** reception rather than waiting for it to repeat — what RDS Spy and SDR Console call DX. This is not a new decoder behaviour: it is the advanced view's **PI commit (repetition guard)** at 1, surfaced as a labelled opt-in. One setting, two views — they cannot disagree. **Off by default.**
- **⚠ Expect false PI codes with DX mode on. That is the trade, not a fault.** On a signal too weak to decode properly it will commit a PI that was never transmitted. On test, a station whose true PI is `0xC202` was committed variously as `0x428E` and `0x2ED2` from single receptions — at default error correction and bandwidth — while SDRConnect's own decoder declined to call it at all. The **default (require one repeat) is what prevents this, and it is unchanged**.
- **Judge a DX-mode catch by the vote count.** The **PI stability** readout shows the votes behind whatever has been committed: a real catch accumulates votes (a solid local station reaches dozens), a fabrication is committed on **one**. **Dominance is not the tell** — it measures the leader's margin over its runner-up, so at a single vote it reads 100% or 0% purely on whether a second spurious value happened to turn up as well. It only becomes meaningful once votes accumulate.
- **The activity log now names both settings that bear on a fabricated PI** — the commit guard and the error-correction strength — at the start of every decode, on every source. Both persist between sessions, so a log captured today states the settings that actually produced it rather than the ones you assume were set. Aggressive (`≤3 bit`) correction is flagged in that line, because it fabricates block-A repairs on marginal signals independently of the commit guard.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`) — every change above is the page shell.

## 0.8.6-beta — Jul 2026

Network SDR, an RF waterfall for it, and wide-file playback. This release folds in the unpublished
0.8.3 / 0.8.4 / 0.8.5 development baselines — coming from **0.8.2-beta**, everything below is new.

- **Network SDR — decode RDS from a networked receiver.** A new **Network SDR** source decodes an IQ stream served by the **rds-bridge-helper** companion from a **SpyServer** (Airspy R2 / Mini / HF+ / Discovery, and RTL-SDR-via-SpyServer) or **rtl_tcp** (RTL-SDR) source, over a local network. The helper reads the radio, narrows the IQ to an RDS-appropriate rate and streams it to RDS Bridge; you tune, decode PI/PS/RadioText and hear the station, all from the browser — no other SDR application needed. The radio may be on this machine or another box on your LAN; the helper runs alongside your browser and connects out to it. A browser cannot open a raw TCP socket, which is why the helper has to sit in the middle.
- **⚠ Tested with SpyServer + an Airspy HF+ Discovery only.** The **rtl_tcp source is experimental**: it is written and unit-tested against the protocol, but has **never been run against a real dongle** — nobody here owns one. It may well work; it is not a claim. SpyServer also fronts RTL-SDR dongles, so that is the tested route to one today. Reports welcome.
- **Listen while you decode.** The Network SDR source plays the tuned station's audio (mono FM, de-emphasis following the region toggle) through the browser, demodulated from the same IQ stream. RDS decoding is unaffected whether audio is on or off.
- **Tune from RDS Bridge.** When the helper can control the radio, tune from the main frequency readout or the panel's **Tune To** box: a small move shifts the decode offset within the captured span instantly; a jump outside the span retunes the radio itself through the helper. If the radio refuses control (SpyServer `allow_control=0`, or you are not the first client), set the frequency in your SDR software and Bridge follows it.
- **RF waterfall for Network SDR (SpyServer).** With a SpyServer source the helper streams a wideband display spectrum alongside the IQ, and RDS Bridge paints it as a full RF waterfall — click, scroll or Ctrl-scroll it exactly like the SDRConnect and IQ-file waterfalls. The waterfall spans the **radio's full width** (768 kHz on an Airspy HF+ — a silicon ceiling, not ours), which is wider than the channel being decoded; a click outside the decoded span retunes the radio. **rtl_tcp announces no spectrum**, so it decodes without a waterfall.
- **⚠ Update the helper and RDS Bridge together.** From this release the IQ frames are tagged by type. A 0.8.2-or-earlier helper paired with this Bridge — or this helper with an older Bridge — produces **garbled audio and junk decode rather than a clean error**. If a setup that was working suddenly decodes nonsense, suspect a mismatched pair first.
- **Wide IQ files play smoothly on slower machines.** The file reader used to wait for the decoder to drain before it started fetching the next chunk, so each cycle cost read *plus* decode instead of the greater of the two. It now reads ahead while the decoder works. On an 8-year-old i5 reading a **6.144 MHz** recording from an uncached disk — a rate the previous README claimed outright — audio went from **62 dropouts in 30 seconds to none**, and playback from 0.19–0.85× to a steady 1.00×. A backlog bound keeps catch-up from overrunning the audio buffer.
- **Bridge now tells you when your machine can't keep up.** If playback falls below 0.95× for two consecutive 3-second windows, the file readout shows the measured speed (e.g. `0.41× — audio stutters`) and says plainly that **RDS decoding is unaffected** — which is true: a user reporting badly stuttering audio held PI `0xC202` at 99% dominance throughout at 0.36×. Audio needs real time; decoding does not.
- **No sample-rate limit is claimed any more, because a rate is a promise about someone else's machine.** The old claim that 9–10 Msps captures "play with continuous audio in real time" was **wrong on ordinary hardware** and this release retires it. The honest rule, which Bridge now measures and reports: **it plays as fast as your machine can narrow the signal; if it can't keep up it says so, and decoding is unaffected either way.** A rough guide, not a promise: narrowing costs roughly 14 MMAC/s per Msps, and a file larger than your RAM also needs sustained disk throughput of about 4 MB/s per Msps (24.576 Msps ⇒ ~94 MB/s, which most single drives will not hold).
- **Panel layout consistency.** The Network SDR and MPX frequency-helper panels now follow the house pattern: full-width input on its own row, paired equal-width Connect/Disconnect buttons, Title Case labels. Fixed: the address and tune boxes in both panels were **completely unstyled** (missing `type="text"`, which the stylesheet selects on — an attribute selector never matches an absent attribute), and the Network SDR audio button had **never** shown on/off state.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`) — every change above is the page shell or the separate helper program. The helper gains the IQ readers, an FFT relay and a tune uplink; its wire format is specified in `PROTOCOL-generic-iq.md` and now guarded by a unit test.

## 0.8.2-beta — Jul 2026

- **Helper packaging — one file, double-click to run.** The optional **rds-bridge-helper** now ships as a ready-to-run single file per platform, with nothing to install and no terminal. On **Windows** it runs with **no command-prompt window** — the setup page's **Stop** button quits it. On **macOS** it's a double-clickable **RDS Bridge Helper.app** (universal, Apple-silicon and Intel) that runs quietly as a background agent with no Dock icon; the plain `darwin-arm64`/`darwin-amd64` command-line binaries are still provided for terminal users. Because there's no console to print to, the helper now writes its status log to **`rds-bridge-helper.log`** beside the program (truncated at each start) for troubleshooting.
- **macOS stays unsigned / un-notarized (deliberate).** Clear the download quarantine once with `xattr -dr com.apple.quarantine "RDS Bridge Helper.app"` — the same step other SDR tools (e.g. WavViewDX) need. Windows may show a one-time SmartScreen prompt (**More info → Run anyway**).
- **RDS Bridge itself is unchanged — helper/packaging release.** The only change inside `index.html` is this version bump and changelog entry. Both embedded workers are byte-identical to 0.7.0 (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`); the decode path is untouched. The helper's one dependency (`go.bug.st/serial`) stays pinned, and its checksums (`go.sum`) are now committed so a source build needs no extra fetch step.

## 0.8.1-beta — Jul 2026

- **Frequency helper, made easy — no terminal.** The optional **rds-bridge-helper** now sets up in a browser: run it and a setup page opens where you pick your SDR source and, for a CAT radio, the COM port and speed from menus — no command-line flags. It shows a plain-language live status (tuned frequency, whether RDS Bridge is connected), auto-fills this computer's network address for the SDR++ (rigctld) case, remembers your settings, and has a **Stop** button. This is the "simpler, self-contained path" foreshadowed in 0.8.0; the rigctld route still works and is now one menu choice.
- **Native CAT (serial) source for SDR Console — no Hamlib.** The helper reads your tuned frequency straight off an SDR's Kenwood **TS-2000** CAT serial port, so on Windows with SDR Console you no longer need Hamlib/rigctld in the middle (a **com0com** virtual COM pair is still needed, because two Windows programs can't share one port). Hardware handshake is off by default, so a virtual pair won't block it — the old `serial_handshake=None` step is gone.
- **Tuned frequency in the main readout (MPX).** When a frequency helper is linked, its frequency now shows in the large green RF-bar readout and the PS/PI summary, not only the MPX-panel status line and the DX log — matching how the live-SDR and IQ-file paths already read. *(This is the only change inside RDS Bridge's `index.html` this release.)*
- **Gentler out of the box.** The helper opens its page automatically, starts on a calm "waiting — choose your source" state rather than an error, and if you run it a second time it just shows the page of the copy already running instead of failing to start. **Tested on** an Apple-silicon Mac with SDR++ and on Windows with SDR Console; Linux and Intel-Mac builds are provided but not yet verified.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). The only RDS Bridge change is the frequency-readout addition; the rest of this release is the separate helper program (its one dependency, `go.bug.st/serial`, pinned in `go.mod`).

## 0.8.0-beta — Jul 2026

- **Experimental frequency helper for MPX (optional, advisory).** In MPX mode RDS Bridge has no dial frequency of its own — tuning stays in your SDR — so MPX catches log as `MPX`. A new optional companion program, **rds-bridge-helper**, reads your SDR's tuned frequency and feeds it to RDS Bridge over a local WebSocket, so MPX catches log by their real frequency instead and re-key as you retune. It is entirely additive: with no helper linked (or if the helper drops mid-decode), MPX behaves exactly as in 0.7.2. Link it from the new **Frequency helper** row in the MPX panel (`ws://localhost:8765` by default). Setup currently needs a little plumbing on the SDR side — the helper reads a **rigctld** source today — so treat it as experimental; a simpler, self-contained path (a native serial/CAT reader that talks to your SDR software directly) is planned. See the helper's README for setup, including the `serial_handshake=None` note for SDR Console over a virtual COM pair.
- **Clean-room helper protocol (`rds-bridge-iq/1`).** The helper speaks a small, purpose-built WebSocket protocol to RDS Bridge — RDS Bridge is the client, the helper (or any compatible source) is the server. This release implements frequency-only ("meta") mode; the protocol is specified in `PROTOCOL-generic-iq.md` and is designed to also carry raw IQ from other sources in a later release. The helper is a single dependency-free binary (~5 MB) for macOS, Windows and Linux, with nothing to install.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 (`WORKER_SRC b8e3ecb3…`, `DCWORKER_SRC 19785acb…`). This is a shell-only release: the entire helper feature is a separate program plus a page-shell WebSocket client, and touches nothing in the decoder.

## 0.7.2-beta — Jul 2026

- **Weak-signal decode: wider default channel bandwidth.** The default is now **200 kHz** (was 160 kHz). On the live-SDR and IQ-file paths the RDS decode runs on the FM-demodulated composite, and on a weak signal a too-narrow channel filter clips the FM carrier and costs demodulator SNR — so a marginal station showing a solid pilot but no PI at 160 kHz will often decode at 200 kHz. This brings the IQ path's weak-signal reach closer to what the MPX path already achieves (where the upstream demodulator is already wide). Narrow it again from the **Channel bandwidth** control if an adjacent station is splattering in; a bandwidth you saved in a previous session is kept as-is, so only new/reset users get the new default.
- **PI raised to a headline.** For DXers the programme identification is almost as important as the name at a glance, so PI now sits on its own line directly under the PS name in a larger amber readout, with the country (once the ECC resolves) beside it. The tuned frequency is now shown in the summary in **every** view — it was essentials-only — so PS, PI and frequency read together.
- **Summary stays put as you scroll.** The PS / PI / frequency summary panel is now pinned to the top of the column, so it stays visible while the activity log scrolls beneath it.
- **DX log now records IQ-file and MPX catches.** Previously only live-SDR catches were logged; playing back an IQ recording or decoding an MPX composite didn't populate the log. Both are now logged. MPX has no dial frequency in RDS Bridge (tuning stays in your SDR), so MPX catches are logged **by PI** and shown with `MPX` in the frequency column, one row per station; the synthetic test sweep is still excluded. Acquisition timing resets on each MPX station change, so the "to ID" figure is per-station.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 — a shell-only release.

## 0.7.1-beta — Jul 2026

- **Retune auto-reset reworked (MPX).** Previously the old station's PS/RadioText/AF/clock were cleared when a *new committed PI* appeared — which lagged (the new PI had to out-vote the old station's accumulated votes first) and couldn't spot a retune between two stations that share a PI. It now detects the physical signature of a retune instead: tuning your SDR breaks the FM composite, so the 19 kHz pilot drops and recovers, and the decoder resets on that — promptly, and regardless of PI. A committed-PI change is kept as a backstop, and the manual **reset decode** button is unchanged. Trade-off: a deep fade that kills the pilot for more than ~0.7 s will also reset (and simply re-accumulate the same station); the threshold is deliberately conservative so normal fading doesn't trip it. Affects **MPX only** — the live SDRConnect and IQ-file paths already reset deterministically when you tune.
- **Decode-timing diagnostic (Advanced view).** With the view selector on Advanced, the activity log reports, per fresh sync-lock: time to the first raw PI, time to the committed PI (exposing the **repetition-guard cost** — the delay the confirm-before-commit guard adds), and the PS name once it settles. For measuring decode latency objectively — e.g. comparing against another decoder on the same signal. Debounced against momentary sync flap, and same-station re-locks are suppressed, so each line marks a genuine fresh decode. Available in all live and file modes; logging only, no effect on decoding.
- **Build identity.** The version label and startup log carry a build tag for pre-release test builds, so a captured log identifies its own build. Released builds show just the version.
- **Decode path unchanged.** Both embedded workers are byte-identical to 0.7.0 — a shell-only release.

## 0.7.0-beta — Jul 2026

- **MPX composite live input — decode RDS from any SDR.** RDS Bridge can now take an FM composite (stereo multiplex) stream as a live source, alongside SDRConnect and IQ files. Route your SDR software's composite/MPX output to a virtual audio cable (VB-Cable, VAC, BlackHole), pick that input under the new **MPX Stream** source, and RDS Bridge captures the composite at 192 kHz, recovers the 19 kHz pilot and 57 kHz RDS subcarrier, and decodes PS, PI, PTY, RadioText, clock and AF — with the composite spectrum and 57k constellation shown live. Tuning and the RF spectrum stay in your SDR software (the RF waterfall is replaced by an "external tuning" note in this mode). This makes RDS Bridge usable with **any SDR that can output composite**, not only SDRplay over the SDRConnect websocket. **Verified with SDR Console's composite output feeding an Airspy HF+ Discovery.** Other SDRs, other software and other virtual cables use the same standard audio path and are expected to work, but are not yet verified.
- **The composite must be 192 kHz end to end.** The RDS subcarrier is at 57 kHz, so the audio path has to run at 192 kHz (120 kHz minimum) or the subcarrier isn't present — the pilot survives and stereo lights up, but nothing decodes. Set **both** the virtual cable and your SDR's composite output to 192000 Hz. RDS Bridge reads the actual source rate the browser reports and refuses to start with a clear message if it's too low, so a mis-set cable fails loudly instead of silently never decoding.
- **Capture uses the best path your browser allows, automatically:** an AudioWorklet when the page is served over http/localhost; a `MediaStreamTrackProcessor` on a plain double-clicked `file://` page, which needs no server and resists dropouts far better than the older ScriptProcessor; and ScriptProcessor as a universal last resort. A throughput read-out in the activity log reports whether capture is keeping up.
- **Retuning is handled.** MPX carries no "channel changed" signal — the audio just keeps flowing — so when you retune your SDR to another station RDS Bridge notices the new PI and automatically clears the previous station's PS, RadioText, AF and clock. A manual **reset decode** button does the same on demand (for the case where two stations share a PI).
- **Offline MPX test (Advanced view).** Play a mono composite `.wav` straight through the decoder with no radio attached — useful for regression and demos. A known-good 192 kHz test vector (PI `0xC479`, PS `MPXTEST0`) ships as a regression check.
- **`file://` notes.** On a double-clicked local file, browsers restrict two things outside our control: audio-input devices aren't listed by name (the picker works by position, and the name of the device you capture is shown once running), and microphone permission isn't remembered between reloads. Serving the same single file over `http://localhost` restores named device selection and remembered permission — a browser policy for local files, not an app limitation.
- **Decode path (worker):** this is the **first change to the decoder since 0.5.0**. It gains exactly two message branches — one to build the RDS receiver at the incoming composite sample rate, one to feed composite samples into it — mirroring the existing post-discriminator seam; nothing else in the decoder changed. Live SDRConnect and IQ-file decoding behave byte-for-byte as before. `WORKER_SRC` re-baselines to `b8e3ecb3…`; the downconvert worker (`DCWORKER_SRC`) is unchanged since 0.5.0.

## 0.6.1-beta — Jul 2026

- 32-bit float IQ recordings now load and decode, alongside 16-bit PCM. 32-bit IEEE-float is the format SDR Console records in by default, so those files previously wouldn't open at all — they now do, with full tuning. Float samples aren't on the same scale as 16-bit, and a recorder's float level varies from file to file, so RDS Bridge measures each recording's level as it loads and maps it into the decoder's working range automatically: no clipping, no manual gain. Tested with an Elad FDM-S2 captured in SDR Console; other float recorders (e.g. SDR++) write the same IEEE-float format and are expected to work. 16-bit recordings are unaffected — they load exactly as before.
- The decode path (worker) is byte-identical to 0.5.0–0.6.0. The 32-bit handling is entirely shell-side: float is normalised to the very same interleaved-Int16 stream the decoder has always received, so nothing downstream — the downconvert stage, the decoder, or the RF waterfall — changes. Both worker SHAs are unchanged since 0.5.0.

## 0.6.0-beta — Jul 2026

- SDR Console recordings now decode with full tuning. An IQ `.wav` from SDR Console would load and play, but the frequency read "— MHz" and you couldn't tune within it — because RDS Bridge only ever took the centre frequency from the filename (the SDRuno/SDRConnect convention), and SDR Console doesn't name files that way. SDR Console instead writes the recording's parameters into the WAV's "auxi" metadata as XML; RDS Bridge now reads the centre frequency (and the start time) from there. An SDR Console capture therefore tunes absolutely — real MHz on the readout, with click-to-tune and type-a-frequency both working — exactly as an SDRuno or SDRConnect file does. The filename reader also learned the "100.675MHz" style as a fallback, and the header scan was widened so the metadata is found even in longer headers.
- RDS Bridge is now a live *and* an offline tool. With SDR Console captures working alongside SDRuno and SDRConnect, the app is no longer just a companion to SDRConnect: it decodes live over SDRConnect, or offline from an IQ recording made in any SDR software (SDRuno, SDR Console, SDR#, HDSDR and the rest). The in-app Guide and About text have been rewritten to reflect that, with a dedicated offline "getting started" path.
- Fixed: the Help panel's tabs. Only Guide responded — clicking How it works, Changelog or About highlighted the tab but never changed the panel. The "what's new" overlay added in an earlier release shares the Help body's CSS class and sits ahead of it in the page, so the tab-switch code was targeting the wrong element. It's now scoped to the Help panel; all four tabs work.
- The decode path (worker) is byte-identical to 0.5.0–0.5.5: every change this release is shell-side. This is the first release of the 0.6.x line.

## 0.5.5-beta — Jul 2026

- The tuned frequency now shows in the essentials view. Essentials hides the RF waterfall and its frequency readout, so the one thing it couldn't tell you was where you were tuned — you had to switch to a fuller view to check. The frequency now sits at the head of the identification card (e.g. “90.700 MHz · PI 0xC203 · United Kingdom”), on both live and file sources, and tracks every retune. The normal and advanced views are unchanged — they still carry the readout above the RF waterfall.
- Housekeeping: the in-app “what’s new” list now includes 0.5.2–0.5.4, which had been missing from it (this CHANGELOG on GitHub always had them). The in-app list and the repository changelog are back in step.
- The decode path (worker) is byte-identical to 0.5.0–0.5.4: this release is shell-side only.

## 0.5.4-beta — Jul 2026

- The file RF waterfall is sharper and scrolls at a steady pace. On high-rate recordings it used to race — it advanced with the file's true data rate, so a 9–10 Msps capture scrolled far too fast to read. It now emits at a fixed rate (≈25 lines/second) whatever the file's sample rate, so a 192 ksps file and a 10 Msps one scroll the same. Resolution is finer too: each line is now a windowed average of several periodograms spread across the block, at double the previous FFT size, so carriers sit tighter and the noise floor reads smoother. This is the “sharpening the file waterfall” noted as next in 0.5.3.
- The file waterfall's brightness now matches the live band. Its byte scaling sat high, so switching between a live capture and a file meant re-touching the RF FLOOR / CEIL sliders each time. The file mapping is now translated down to land where SDRConnect's live bins do — the same floor and ceiling on the sliders across both sources — with its contrast unchanged. Measured against the RSPdxR2's live scaling.
- Fixed: the RF waterfall could freeze after a live→file switch. After running a live stream, then pressing Disconnect and loading an IQ file, the RF waterfall would sometimes stay frozen on the last live frame instead of running on the file. It was a timing race — the live connection's teardown runs when the WebSocket finishes closing, which could land *after* you'd already switched to file mode and stop the file-fed waterfall. Teardown now only stops the waterfall while still in live mode, so a late socket close can't reach across into a file session. Intermittent (about one switch in three); confirmed fixed on hardware over 20 consecutive switches.
- The decode path (worker) is byte-identical to 0.5.0–0.5.3: every change this release is shell-side.

## 0.5.3-beta — Jul 2026

- Audio for IQ file playback. The tuned station's audio now plays while you work a recording, just as live SDRConnect audio does — mono, with 50/75 µs de-emphasis following the region toggle. An IQ file now plays much like a live capture: RDS decode, both waterfalls, transport and the UTC readout, and now sound.
- It plays wideband recordings in real time. High-rate captures — 5, 9, 10 Msps and up — now keep continuous audio, not only narrow files. Behind the scenes the tuned station is mixed down and narrowed before the decoder, so the demodulator always runs comfortably in real time; the RF waterfall still spans the full recorded bandwidth, so click-to-tune across the whole capture is unchanged.
- One known trade-off: on high-rate recordings the RF waterfall now scrolls faster, because it advances with the file's true data rate. Sharpening the file waterfall — both its resolution and its scroll pacing — is the next item on the list.
- The only decode-path (worker) change since 0.5.0 is the file-audio tap itself: a small, read-only branch off the FM discriminator that never touches the RDS decode. All of the wideband handling is shell-side, so the decoder is byte-identical to that one tap.

## 0.5.2-beta — Jul 2026

- v0.5.2-beta failed testing in development and was superceded by v0.5.3-beta. This was not released.


## 0.5.1-beta — Jul 2026

- IQ File is now a proper source, not just a developer test tool. A new source selector at the top of the Connection panel switches between SDRConnect (live, the default — exactly as before) and IQ File; a third slot, MPX Stream, is reserved for later. Choosing IQ File swaps the WebSocket controls for a file box, so you can load and play a recording without SDRConnect running.
- Transport with a real timeline. Play/pause, a Stop, and a scrubber let you move to any point in the recording; the ◂/▸ buttons jump ±10 s and ±60 s. Playback is always real time (1×) — the scrubber only changes where you are, it doesn't fast-forward the audio. Seeking re-acquires cleanly at the new position.
- Date and UTC time readout. The recording's start time is read from the file itself (SDRuno/SpectraVue and Broadcast-Wave timestamps, or a date in the filename) and the transport shows the exact UTC time at the playhead as you scrub, alongside elapsed / total.
- Both waterfalls work on a file the same way they do live. The MPX composite waterfall and the RF band waterfall both render during playback. You can tune within the recording exactly as on a live capture — click the RF waterfall, type a frequency into the main readout, or use the step buttons — and the readout shows the tuned station. The RF waterfall self-calibrates its floor and ceiling to the recording, so it reads clearly whatever the file's IQ gain.
- The decode-filter passband edges (cyan) on the RF waterfall are now a single translucent line rather than a solid 2-pixel bar, matching the tuning-marker change from 0.5.0 — so an edge no longer hides a carrier sitting under it.
- Audio for file playback is the next release. This one is display/transport only; the decode path (worker) is byte-identical to 0.5.0.

## 0.5.0-beta — Jul 2026

- Country of origin: when a station transmits its Extended Country Code (ECC), the country now appears next to the PI, e.g. "PI 0xC201 · United Kingdom". This is resolved from the ECC combined with the PI's country nibble, using the full international table (all regions — Europe, Africa, the Americas and Asia-Pacific), so any station worldwide that sends its ECC is identified correctly.
- It's shown confirmed-only, and on purpose. The first digit of the PI on its own is ambiguous — the standard reuses it across countries that can't hear each other (nibble C, for instance, is the UK, Croatia and Malta), and only the ECC tells them apart. So no country is ever guessed from the PI alone: the field stays blank until the ECC has actually decoded. The ECC is optional and some stations send it rarely or never, so a valid catch can still show no country — that's expected, not a fault.
- The tuning marker on the RF waterfall is now a single, translucent line instead of a solid 2-pixel bar. A weak carrier sitting right on your tuned frequency used to be hidden underneath it; now the signal reads through the marker.
- First release since 0.4.3 to touch the decode path (worker): a small, additive group-1A branch to read the ECC. Everything else — the country table, the display and the waterfall marker — is control/shell-side.

## 0.4.7-beta — Jul 2026

- Decoder settings are now remembered between sessions. The advanced Decoder options — Error correction (max burst), matched filter, sync mode, acquisition and the PI commit guard — used to reset to their defaults on every reload; each now keeps whatever you last set it to. In particular, if you prefer ≤3-bit error correction on weak signals it will stick. The shipped defaults are unchanged (error correction still starts at ≤2 bits, the sound all-round setting); persistence only holds your own choice.
- Frequency step buttons beside the readout: −1M / −200k / +200k / +1M jump the tuning down or up by 1 MHz or 200 kHz in one click. A step that lands outside the currently captured span recentres the capture automatically, the same as type-in tuning. Needs SDRConnect hardware control.
- Shift+wheel over the RF waterfall now steps in coarse 1 MHz jumps, for moving across the band quickly; plain wheel still steps by the snap size and Ctrl+wheel still zooms.
- Smaller touches: the alternative-frequency row now shows a ‹ cue on the left as well as the › on the right, so you can tell there are frequencies off either edge; the bandwidth control wraps more tidily on narrow, multi-column layouts; and in advanced view the soft/blind/match line now wraps inside the Programme Service card instead of stretching it and pushing PI-stability onto its own row.
- Control-side only — tuning and settings drive SDRConnect's front-end and the display; the decode path (worker) remains byte-identical to 0.4.3–0.4.6.

## 0.4.6-beta — Jul 2026

- Type-in tuning: the big frequency readout above the RF waterfall is now editable — click it, type a frequency in MHz and press Enter to tune there. As in most FMDX software the decimal point is optional, so typing 875 tunes 87.5 and 1041 tunes 104.1. It's free-range, so you can go outside the FM band (for example the OIRT band, 65–74 MHz) as well as anywhere in 87.5–108 — include the decimal point for out-of-band frequencies. If the frequency you enter is outside the currently captured span, the capture is recentred automatically so it lands in view. Esc cancels an edit. Needs SDRConnect hardware control, like click-to-tune.
- Mouse wheel over the RF waterfall now tunes: each notch steps the VFO by the current snap step (100 kHz if snap is off), with wheel-down stepping the frequency down to match SDRConnect. A quick spin is smoothed into a single retune. Zoom moves to Ctrl+wheel (hold Ctrl and scroll), and the zoom dropdown is unchanged — so you keep both, without the wheel doing two jobs at once.
- Hover help everywhere: tooltips now cover nearly every element on screen — every indicator in the Lock & quality and Link panels, the Programme Service / PI / RadioText cards and their flags, the SDRConnect built-in comparison, all four 57k-confidence meters and the PI-stability read-outs, the DX log and activity log, the MPX chips, the status pill, and the connection and decoder controls (including the advanced options). Hover any figure to see what it means and how to read it.
- Control-side only — tuning drives SDRConnect's front-end; the decode path (worker) remains byte-identical.

## 0.4.5-beta — Jul 2026

- View selector (top right): the old Compact button and advanced toggle are now one control with four settings — compact, essentials, normal and advanced. Normal is the full decoder; advanced adds the developer/experimental tools as before; compact collapses to the single-line status bar; and essentials is a new decode-focused view. Normal and advanced are remembered between sessions; compact and essentials are quick monitoring views for the current session, so reopening the app always returns you to a full view with the connect controls in reach.
- New 'essentials' view: strips the screen back to just the identification — Programme Service, RadioText, PI-stability with a compact 57k constellation beside it, and the 57k confidence strip — hiding the controls, both waterfalls, the scope and the logs. Handy for watching a marginal catch resolve, or on a small screen, without dropping all the way to the compact status bar. Switch back any time; from compact, Expand returns you to whichever view you were last in.
- Alternative-frequency list: the AF chips under RadioText now sit on a single row that scrolls sideways when a station carries a lot of them, instead of wrapping onto extra lines and pushing the rest of the view down. A › marker fades in at the right when there are more frequencies off-screen — scroll the row (mouse wheel over it) to reach them — and the full count still shows as 'AF n'.
- Display/shell only — the four views are just layout, and the decode path (worker) remains byte-identical.

## 0.4.4-beta — Jul 2026

- "What's new" summary on update: the first time you open a new version, a short summary of what changed appears, taken straight from this changelog — so you don't have to go looking for it. Dismiss it and it won't reappear until the next update; the 'Full changelog' link opens this full list. It's entirely local to your browser (it compares the running version against the last one you opened here) — nothing is fetched, and the decode path is untouched.
- Update indicator: a quiet badge beside the version number lights up when a newer release is available in the repository, and opens that release's page on GitHub when you click it. It checks once on load — the result is cached for a few hours, so it isn't fetched on every reload — and stays silent, with no nag, if you're offline or the check is unavailable. Display-side only.
- Note: because both features are new, they can only show changes from this version onward — the 'what's new' summary will start appearing when you update away from 0.4.4-beta, and the update badge works from now on. The decode path (worker) remains byte-identical.

## 0.4.3-beta — Jul 2026

- New 'centre ⌖' button on the RF waterfall row: recentres SDRConnect's capture on the station you're tuned to, so it sits in the middle of the span instead of out near the edge, where the band rolls off and weak carriers fade first. Click-tune a catch near the edge of the captured range, press centre, and it moves to the middle where the signal is cleanest — without changing what you're tuned to. Needs SDRConnect hardware control (like click-to-tune and the bandwidth control); when it isn't available the button just says so. Your RDS lock is held through the move — the PS, PI and RadioText you've already gathered don't reset — and the display snaps back to 1× so the recentred station is in view.
- Under the hood this moves the capture centre (device_center_frequency) and the VFO together: SDRConnect holds the VFO at a fixed offset from centre, so both are set to land the station dead-centre. The absolute tuned frequency doesn't change, so it isn't treated as a station change; a brief re-acquire as the radio's local oscillator retunes is normal. The decode path (worker) remains byte-identical.

## 0.4.2-beta — Jul 2026

- The cyan passband edges on the RF waterfall are now drawn a touch thicker so they show reliably — previously they were a single pixel wide and got lost when the waterfall is scaled down to fit, so they could be invisible depending on your window size.
- New 'edges' toggle beside the bandwidth slider to show or hide the passband overlay, for when you'd rather keep the waterfall clean. Your choice is remembered between sessions.

## 0.4.1-beta — Jul 2026

- Unified bandwidth control — the fixed 130/160/200/230 kHz dropdown is now a slider plus a type-in kHz field (120–230 kHz), and it drives two filters in step. It always sets RDS Bridge's own decode filter; and when SDRConnect reports hardware control is available, it also sets SDRConnect's front-end filter (filter_bandwidth) — so narrowing is now audible in the streamed audio and moves on SDRConnect's own display, not just silently in the decode. This is RDS Bridge's first control that writes back to the radio. When hardware control isn't available it falls back to decode-only (as before). Your width is remembered between sessions.
- RF-waterfall passband overlay — cyan edges mark the current filter passband and track the slider live as you drag, so you can watch it close over an adjacent splattering station.
- Why two filters: unlike a typical radio's single filter, RDS Bridge decodes from the full-bandwidth IQ with its own filter, so audio (SDRConnect's) and decode (ours) are separate paths. This control keeps them in step. See Help for the full explanation. The decode path (worker) remains byte-identical.

## 0.4.0-beta — Jul 2026

- PTY region toggle (top right, "PTY EU / PTY NA"): switches the programme-type labels between Europe/rest-of-world (RDS · EN 50067) and North America (RBDS · NRSC-4). The 5-bit PTY value on air is identical in both systems — only the label table differs (e.g. code 5 reads "Education" in Europe but "Rock" in North America) — and there is no on-air flag to tell them apart, so this is a manual toggle, not an auto-detect. Remembered between sessions. Display-side only: the numeric PTY stored in the DX log and CSV is unchanged, so a station logged under one region simply shows the other region's label if you switch — correct and reversible, no re-logging.
- Mouse-wheel zoom on the RF waterfall: scroll over the waterfall to step the display zoom through 1× / 2× / 4× / 8× (the dropdown still works and stays in sync). In free view the wheel magnifies about the pointer; in follow view it keeps tracking the tuned frequency. Display-only — same captured bins, no added resolution and no retune.
- Fullscreen toggle (top right): hides the browser chrome to give the waterfalls the whole screen. Pure display — Esc or the button returns you. Decode path untouched.

## 0.3.6-beta — Jun 2026

- PI-stability moved up beside RadioText: the dominance/votes/rivals trace now sits as a compact card in the top row instead of a full-width strip under the 57k confidence meters. Tightens the layout — RadioText no longer stretches across the whole width and the confidence panel is shorter — while keeping the PI convergence read next to the PS/PI identity. Display-side only; the trace and its data are unchanged.

## 0.3.5-beta — Jun 2026

- Waterfall settings now persist between sessions: the RF floor, ceiling, lift, averaging, zoom and view-mode controls, and the MPX floor, lift and averaging controls, are all remembered in the browser (previously only snap survived a reload). The RF waterfall's on/off state is remembered too — if it was running last session it re-enables automatically once you reconnect. Dial in a setup once and it sticks. Display-side only — saved locally in the browser, nothing leaves the machine, and the decode path is untouched.
- Added an RDS-Bridge Discord channel (linked from the About tab) — the main place to chat about the app, exchange ideas and talk features.
- High-contrast text toggle (top right): brightens the dim and faint labels for readability at small sizes, keeping the text hierarchy intact. Remembered between sessions. Presentation-only — no layout change, decode path untouched.
- Layout fix for smaller screens (laptops / 1080p): the main view now grows and scrolls when it's taller than the window, so the activity log at the bottom is always reachable. Previously the bottom panel could be squeezed off the foot of the screen on shorter displays with no way to scroll to it.
- Automatic interface scaling: the scale control now defaults to Auto, which sizes the layout to your display (the menu shows the chosen percentage, e.g. Auto · 75%). Defaults are 115% on 4K / large desktops, 90% on 1440p, 75% on 1080p and 14–16" laptops, and 70% on smaller laptops — so no display is stuck at a size tuned for another. New smaller steps (50–85%) were added, and you can still pick any fixed size to override; your choice is remembered. Presentation-only.
- Moved the DX log down to sit just above the activity log, so the live waterfalls and confidence panel stay at the top of the view and don't get pushed down as the log fills.

## 0.3.4-beta — Jun 2026

- RF waterfall display zoom (zoom control, 1× / 2× / 4× / 8×) with a view mode (follow / free): magnifies the captured spectrum bins for a closer look at a crowded part of the band. In follow the view recentres on the frequency you tune; in free the view stays fixed (clicking tunes without recentring, matching the non-zoom feel) and you drag the waterfall to pan across the band. Display-only — no added resolution (the bins are SDRConnect's), but the frequency axis, VFO marker and click-to-tune all track the zoomed window, so clicking still tunes accurately.
- MPX waterfall averaging + lift: the composite strip gains the same frame-averaging and weak-signal lift as the RF waterfall — averaging steadies the composite through fading, lift pulls a faint 19/38/57 kHz subcarrier up out of the noise. Useful for judging whether RDS is coming through on a marginal signal. Display-side only.
- RF waterfall weak-signal lift (gamma): a non-linear curve on the floor-to-ceiling mapping (off / low / med / high / max) that expands the low end, so faint stations sitting just above the noise floor brighten up the palette while strong carriers stay at white. Pairs with averaging on. Display-side only.
- RF waterfall floor + ceiling controls (replacing the single contrast slider): floor lifts the noise floor to black, ceiling sets where the palette tops out. SDRConnect's streamed spectrum bins top out well below full scale, so the old fixed ceiling left the strongest carriers stuck in orange/red; pulling the ceiling down lets them reach white and brightens mid-strength signals — matching SDRConnect's own Base/Ref Level behaviour.
- RF waterfall frame averaging (avg control): an exponential per-bin average that smooths the noise floor's frame-to-frame variance while steady carriers stay put. Most visible once the floor is lowered to reveal weak signals. Off / light / med / heavy / max; display-side only, the decode path never sees the spectrum stream.
- PI-stability trace: the leader reads as confirming (green) only once the value has actually repeated to the commit threshold — a single unrepeated read no longer flashes as a strong candidate. (Calibration corpus showed dominance is trivially 100% at a single vote, with no runner-up to measure against.)

## 0.3.3-beta — Jun 2026

- PI-stability trace (under the confidence meters): a live read of how decisively one block-A value owns the PI slot over the course of an opening. Block A carries no message CRC, so a sound PI is really a matter of repetition and dominance over rivals — the same evidence the repetition guard commits on, now shown as a convergence trace. Dominance is the lead over the runner-up (0% = tied, 100% = uncontested); rivals counts how many distinct values have themselves reached the commit threshold. One value climbing and holding high with rivals = 1 is a real PI; a low, thrashing trace with several rivals is noise. Reads only the leader telemetry already exposed — main-thread, no tap, no decode-path change.
- Confidence calibration log now also records each opening's peak PI dominance and rival count (advanced-mode CSV), to help calibrate the predictive bands and the real-vs-false PI call against real openings.

## 0.3.2-beta — Jun 2026

- 57k confidence predictor: an advisory estimate of how likely a station is to yield an ID on the current pass, under the MPX view. Built for the rapid fading of Es DX — it ratchets accumulated evidence over the opening (peak SNR/pilot, pilot and sync duty, soft-PI/blind convergence, groups parsed) rather than reacting to instantaneous fades, banks a sticky milestone when a hard PI or PS is confirmed, and reads from existing telemetry only — no change to the decode path.
- 57k constellation: a live scatter of the post-carrier symbol samples beside the confidence meters. A diffuse cloud is noise; two tight poles on the decision axis is recoverable RDS — a direct, novel read of how close a signal is to decoding, where a magnified spectrum can't show it.
- PI repetition guard: a committed PI now requires agreeing reception (default: one repeat) before it is shown, logged, or counted — block A has no message CRC, so a single burst-corrected read could previously pass as a false PI. Tunable in advanced mode (accept-first / one-repeat / strict).
- Confidence calibration logging (advanced mode): each opening's evidence accumulators are recorded against the outcome and exportable as CSV, including the PI vote count and raw value, to allow the predictive bands to be calibrated against real openings.

## 0.3.1-beta — Jun 2026

- RF waterfall frequency axis: an MHz tick scale beneath the band, aligned to the spectrum span, with a green VFO tick mirroring the channel marker. The band is now properly readable at a glance.
- Click-to-tune: click the RF waterfall (or its axis) to retune SDRConnect's VFO to that point, with a hover read-out of the target frequency. Guarded on hardware control availability, and it reuses the existing re-acquisition path — small moves follow the signal, genuine station changes reset cleanly.
- Snap-to-step: click-to-tune snaps to a selectable frequency step (off / 50 / 100 / 200 kHz, default 100 kHz, remembered between sessions) to match SDRConnect's Tuning Step Size — needed because an externally-commanded VFO bypasses Connect's own Step Snap.
- All presentation / command only — the decode path is untouched.

## 0.3.0-beta — Jun 2026

- Live monitoring, all in one window. Alongside the sensitive decoder, RDS Bridge now shows an RF band waterfall and plays the tuned station's audio — using SDRConnect's spectrum-bin and demodulated-audio streams over the same WebSocket.
- RF band waterfall: the full captured span (≈9 MHz on a wideband capture) as a scrolling spectrum, with a large tuned-frequency read-out and a green marker on the channel being decoded. Makes faint, catchable carriers visible at a glance — useful for spotting DX before it fully resolves.
- MPX waterfall strip: a scrolling history above the composite trace, sharing its frequency axis, so the 19 / 38 / 57 kHz pilot, stereo and RDS subcarriers persist and fade visibly — a direct read on whether RDS is coming through on a marginal signal.
- Live stereo audio from SDRConnect, with a volume control; runs alongside decoding without disturbing it.
- Independent contrast controls for the RF and MPX waterfalls, each dialled to conditions.
- All of the above is presentation-only and never touches the decode path.

## 0.2.2-beta — Jun 2026

- Interface scale control (header, top-right): 90–150% presets for readability on 4K / high-DPI displays. Scales the whole interface including the scope, and is remembered between sessions.
- DX log — no duplicate rows on return: a station you leave and come back to (or that is still in the log after a reload) is recognised as the same catch within the hour and enriches the existing entry instead of adding a second row. Rows now show a ×N heard-count and track last-heard, both included in the CSV export. A genuine re-catch after an hour still logs fresh, and a fuller name still upgrades the entry in place.
- Offline test harness — the auto-sweep now also measures the experimental known-PI matcher's sensitivity (the weakest SNR at which it still confirms the correct station), reported alongside Normal/Soft/Blind with its gain over the baseline decoder. Advanced mode only; the matcher stays experimental and advisory and its thresholds are unchanged — this adds measurement, not a validated result.

## 0.2.1-beta — Jun 2026

- Fixed: large IQ recordings (over 4 GB) failed to load with "not a RIFF/WAV file". Captures past that size are written in the 64-bit RF64/BW64 variant rather than classic RIFF, which the loader didn't recognise. The loader now accepts RIFF, RF64 and BW64 and reads the true data size from the file's ds64 chunk. Confirmed loading 5 GB and 24 GB RF64 captures; sub-4 GB RIFF files are unaffected.

## 0.2.0-beta — Jun 2026

- Known-PI matcher (advanced, experimental, advisory): asks "is a station I already know present?" instead of decoding the PI blind. It reads the recent same-frequency catches from the DX log and matched-filters the live soft accumulator against each one's known 26-bit block A. Read-only and prior-independent by construction — it never writes the log, never overrides the decoded PI, cannot produce a PS, and the recency prior only orders the search, never lowers the evidence bar. Shown as the 'match' read-out on the PI line. Any real-world sensitivity gain is not yet measured on live signals; thresholds are provisional pending the calibration sweep.
- DX log — names only commit once settled: the decoder keeps the most complete PS seen and logs it once it stops getting more complete, instead of writing whatever happened to be on screen. Stray 1–2 character fragments are no longer logged as names; a catch that never forms a name is recorded PI-only.
- DX log — names upgrade in place: if a fuller name finishes decoding while still tuned to a station, the existing log entry is completed rather than duplicated.
- DX log — fewer duplicates: a PI that flickers out and back on the same frequency is recognised as the same catch.
- Programme type is now shown by name in the DX log rows.

## 0.1.0-beta — Jun 2026

- First public beta.
- NDA open-loop acquisition front-end — Oerder–Meyr feed-forward symbol timing + Costas carrier seeding, with feedback tracking engaged only after a coarse lock. Locks weak and unstable FM signals from cold where conventional loop-based decoders hang.
- Full RDS group decode: PI, PS station name, PTY, RadioText, TP/TA flags, stereo pilot, AF list and clock-time.
- Syndrome block synchronisation with configurable burst error-correction (off / ≤1 / ≤2 / ≤3 bits).
- Channel-bandwidth selection (130–230 kHz) for weak-signal and adjacent-channel rejection.
- DX log: every fully-identified live catch is recorded with its conditions (SNR, pilot, data quality) and what the decoder needed to resolve it (error-correction used, time-to-ID) — with CSV export and local persistence.
- Advanced mode (header toggle or ?dev=1): offline IQ-file test harness with calibrated noise + fading injection and an auto-sweep that measures the decode threshold in dB; experimental soft-PI and blind soft-PI read-outs; low-level decoder switches.
- In-app Guide, technical How-it-works and this changelog.

