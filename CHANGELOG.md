# Changelog

All notable changes to RDS Bridge, newest first. This mirrors the in-app changelog (Help → Changelog). Repo: https://github.com/m0euk/RDS-Bridge

The decode path — the DSP worker and IQ pipeline — is treated as sacred and is validated on live hardware before every release. The waterfall, confidence, PI-stability, persistence, scaling and layout work is all display-side and read-only unless a note says otherwise.

## v0.4.0-beta — Jul 2026

- PTY region toggle (top right, "PTY EU / PTY NA"): switches the programme-type labels between Europe/rest-of-world (RDS · EN 50067) and North America (RBDS · NRSC-4). The 5-bit PTY value on air is identical in both systems — only the label table differs (e.g. code 5 reads "Education" in Europe but "Rock" in North America) — and there is no on-air flag to tell them apart, so this is a manual toggle, not an auto-detect. Remembered between sessions. Display-side only: the numeric PTY stored in the DX log and CSV is unchanged, so a station logged under one region simply shows the other region's label if you switch — correct and reversible, no re-logging.
- Mouse-wheel zoom on the RF waterfall: scroll over the waterfall to step the display zoom through 1× / 2× / 4× / 8× (the dropdown still works and stays in sync). In free view the wheel magnifies about the pointer; in follow view it keeps tracking the tuned frequency. Display-only — same captured bins, no added resolution and no retune.
- Fullscreen toggle (top right): hides the browser chrome to give the waterfalls the whole screen. Pure display — Esc or the button returns you. Decode path untouched.

## v0.3.6-beta — Jun 2026

- PI-stability moved up beside RadioText: the dominance/votes/rivals trace now sits as a compact card in the top row instead of a full-width strip under the 57k confidence meters. Tightens the layout — RadioText no longer stretches across the whole width and the confidence panel is shorter — while keeping the PI convergence read next to the PS/PI identity. Display-side only; the trace and its data are unchanged.

## v0.3.5-beta — Jun 2026

- Waterfall settings now persist between sessions: the RF floor, ceiling, lift, averaging, zoom and view-mode controls, and the MPX floor, lift and averaging controls, are all remembered in the browser (previously only snap survived a reload). The RF waterfall's on/off state is remembered too — if it was running last session it re-enables automatically once you reconnect. Dial in a setup once and it sticks. Display-side only — saved locally in the browser, nothing leaves the machine, and the decode path is untouched.
- Added an RDS-Bridge Discord channel (linked from the About tab) — the main place to chat about the app, exchange ideas and talk features.
- High-contrast text toggle (top right): brightens the dim and faint labels for readability at small sizes, keeping the text hierarchy intact. Remembered between sessions. Presentation-only — no layout change, decode path untouched.
- Layout fix for smaller screens (laptops / 1080p): the main view now grows and scrolls when it's taller than the window, so the activity log at the bottom is always reachable. Previously the bottom panel could be squeezed off the foot of the screen on shorter displays with no way to scroll to it.
- Automatic interface scaling: the scale control now defaults to Auto, which sizes the layout to your display (the menu shows the chosen percentage, e.g. Auto · 75%). Defaults are 115% on 4K / large desktops, 90% on 1440p, 75% on 1080p and 14–16" laptops, and 70% on smaller laptops — so no display is stuck at a size tuned for another. New smaller steps (50–85%) were added, and you can still pick any fixed size to override; your choice is remembered. Presentation-only.
- Moved the DX log down to sit just above the activity log, so the live waterfalls and confidence panel stay at the top of the view and don't get pushed down as the log fills.

## v0.3.4-beta — Jun 2026

- RF waterfall display zoom (zoom control, 1× / 2× / 4× / 8×) with a view mode (follow / free): magnifies the captured spectrum bins for a closer look at a crowded part of the band. In follow the view recentres on the frequency you tune; in free the view stays fixed (clicking tunes without recentring, matching the non-zoom feel) and you drag the waterfall to pan across the band. Display-only — no added resolution (the bins are SDRConnect's), but the frequency axis, VFO marker and click-to-tune all track the zoomed window, so clicking still tunes accurately.
- MPX waterfall averaging + lift: the composite strip gains the same frame-averaging and weak-signal lift as the RF waterfall — averaging steadies the composite through fading, lift pulls a faint 19/38/57 kHz subcarrier up out of the noise. Useful for judging whether RDS is coming through on a marginal signal. Display-side only.
- RF waterfall weak-signal lift (gamma): a non-linear curve on the floor-to-ceiling mapping (off / low / med / high / max) that expands the low end, so faint stations sitting just above the noise floor brighten up the palette while strong carriers stay at white. Pairs with averaging on. Display-side only.
- RF waterfall floor + ceiling controls (replacing the single contrast slider): floor lifts the noise floor to black, ceiling sets where the palette tops out. SDRConnect's streamed spectrum bins top out well below full scale, so the old fixed ceiling left the strongest carriers stuck in orange/red; pulling the ceiling down lets them reach white and brightens mid-strength signals — matching SDRConnect's own Base/Ref Level behaviour.
- RF waterfall frame averaging (avg control): an exponential per-bin average that smooths the noise floor's frame-to-frame variance while steady carriers stay put. Most visible once the floor is lowered to reveal weak signals. Off / light / med / heavy / max; display-side only, the decode path never sees the spectrum stream.
- PI-stability trace: the leader reads as confirming (green) only once the value has actually repeated to the commit threshold — a single unrepeated read no longer flashes as a strong candidate. (Calibration corpus showed dominance is trivially 100% at a single vote, with no runner-up to measure against.)

## v0.3.3-beta — Jun 2026

- PI-stability trace (under the confidence meters): a live read of how decisively one block-A value owns the PI slot over the course of an opening. Block A carries no message CRC, so a sound PI is really a matter of repetition and dominance over rivals — the same evidence the repetition guard commits on, now shown as a convergence trace. Dominance is the lead over the runner-up (0% = tied, 100% = uncontested); rivals counts how many distinct values have themselves reached the commit threshold. One value climbing and holding high with rivals = 1 is a real PI; a low, thrashing trace with several rivals is noise. Reads only the leader telemetry already exposed — main-thread, no tap, no decode-path change.
- Confidence calibration log now also records each opening's peak PI dominance and rival count (advanced-mode CSV), to help calibrate the predictive bands and the real-vs-false PI call against real openings.

## v0.3.2-beta — Jun 2026

- 57k confidence predictor: an advisory estimate of how likely a station is to yield an ID on the current pass, under the MPX view. Built for the rapid fading of Es DX — it ratchets accumulated evidence over the opening (peak SNR/pilot, pilot and sync duty, soft-PI/blind convergence, groups parsed) rather than reacting to instantaneous fades, banks a sticky milestone when a hard PI or PS is confirmed, and reads from existing telemetry only — no change to the decode path.
- 57k constellation: a live scatter of the post-carrier symbol samples beside the confidence meters. A diffuse cloud is noise; two tight poles on the decision axis is recoverable RDS — a direct, novel read of how close a signal is to decoding, where a magnified spectrum can't show it.
- PI repetition guard: a committed PI now requires agreeing reception (default: one repeat) before it is shown, logged, or counted — block A has no message CRC, so a single burst-corrected read could previously pass as a false PI. Tunable in advanced mode (accept-first / one-repeat / strict).
- Confidence calibration logging (advanced mode): each opening's evidence accumulators are recorded against the outcome and exportable as CSV, including the PI vote count and raw value, to allow the predictive bands to be calibrated against real openings.

## v0.3.1-beta — Jun 2026

- RF waterfall frequency axis: an MHz tick scale beneath the band, aligned to the spectrum span, with a green VFO tick mirroring the channel marker. The band is now properly readable at a glance.
- Click-to-tune: click the RF waterfall (or its axis) to retune SDRConnect's VFO to that point, with a hover read-out of the target frequency. Guarded on hardware control availability, and it reuses the existing re-acquisition path — small moves follow the signal, genuine station changes reset cleanly.
- Snap-to-step: click-to-tune snaps to a selectable frequency step (off / 50 / 100 / 200 kHz, default 100 kHz, remembered between sessions) to match SDRConnect's Tuning Step Size — needed because an externally-commanded VFO bypasses Connect's own Step Snap.
- All presentation / command only — the decode path is untouched.

## v0.3.0-beta — Jun 2026

- Live monitoring, all in one window. Alongside the sensitive decoder, RDS Bridge now shows an RF band waterfall and plays the tuned station's audio — using SDRConnect's spectrum-bin and demodulated-audio streams over the same WebSocket.
- RF band waterfall: the full captured span (≈9 MHz on a wideband capture) as a scrolling spectrum, with a large tuned-frequency read-out and a green marker on the channel being decoded. Makes faint, catchable carriers visible at a glance — useful for spotting DX before it fully resolves.
- MPX waterfall strip: a scrolling history above the composite trace, sharing its frequency axis, so the 19 / 38 / 57 kHz pilot, stereo and RDS subcarriers persist and fade visibly — a direct read on whether RDS is coming through on a marginal signal.
- Live stereo audio from SDRConnect, with a volume control; runs alongside decoding without disturbing it.
- Independent contrast controls for the RF and MPX waterfalls, each dialled to conditions.
- All of the above is presentation-only and never touches the decode path.

## v0.2.2-beta — Jun 2026

- Interface scale control (header, top-right): 90–150% presets for readability on 4K / high-DPI displays. Scales the whole interface including the scope, and is remembered between sessions.
- DX log — no duplicate rows on return: a station you leave and come back to (or that is still in the log after a reload) is recognised as the same catch within the hour and enriches the existing entry instead of adding a second row. Rows now show a ×N heard-count and track last-heard, both included in the CSV export. A genuine re-catch after an hour still logs fresh, and a fuller name still upgrades the entry in place.
- Offline test harness — the auto-sweep now also measures the experimental known-PI matcher's sensitivity (the weakest SNR at which it still confirms the correct station), reported alongside Normal/Soft/Blind with its gain over the baseline decoder. Advanced mode only; the matcher stays experimental and advisory and its thresholds are unchanged — this adds measurement, not a validated result.

## v0.2.1-beta — Jun 2026

- Fixed: large IQ recordings (over 4 GB) failed to load with "not a RIFF/WAV file". Captures past that size are written in the 64-bit RF64/BW64 variant rather than classic RIFF, which the loader didn't recognise. The loader now accepts RIFF, RF64 and BW64 and reads the true data size from the file's ds64 chunk. Confirmed loading 5 GB and 24 GB RF64 captures; sub-4 GB RIFF files are unaffected.

## v0.2.0-beta — Jun 2026

- Known-PI matcher (advanced, experimental, advisory): asks "is a station I already know present?" instead of decoding the PI blind. It reads the recent same-frequency catches from the DX log and matched-filters the live soft accumulator against each one's known 26-bit block A. Read-only and prior-independent by construction — it never writes the log, never overrides the decoded PI, cannot produce a PS, and the recency prior only orders the search, never lowers the evidence bar. Shown as the 'match' read-out on the PI line. Any real-world sensitivity gain is not yet measured on live signals; thresholds are provisional pending the calibration sweep.
- DX log — names only commit once settled: the decoder keeps the most complete PS seen and logs it once it stops getting more complete, instead of writing whatever happened to be on screen. Stray 1–2 character fragments are no longer logged as names; a catch that never forms a name is recorded PI-only.
- DX log — names upgrade in place: if a fuller name finishes decoding while still tuned to a station, the existing log entry is completed rather than duplicated.
- DX log — fewer duplicates: a PI that flickers out and back on the same frequency is recognised as the same catch.
- Programme type is now shown by name in the DX log rows.

## v0.1.0-beta — Jun 2026

- First public beta.
- NDA open-loop acquisition front-end — Oerder–Meyr feed-forward symbol timing + Costas carrier seeding, with feedback tracking engaged only after a coarse lock. Locks weak and unstable FM signals from cold where conventional loop-based decoders hang.
- Full RDS group decode: PI, PS station name, PTY, RadioText, TP/TA flags, stereo pilot, AF list and clock-time.
- Syndrome block synchronisation with configurable burst error-correction (off / ≤1 / ≤2 / ≤3 bits).
- Channel-bandwidth selection (130–230 kHz) for weak-signal and adjacent-channel rejection.
- DX log: every fully-identified live catch is recorded with its conditions (SNR, pilot, data quality) and what the decoder needed to resolve it (error-correction used, time-to-ID) — with CSV export and local persistence.
- Advanced mode (header toggle or ?dev=1): offline IQ-file test harness with calibrated noise + fading injection and an auto-sweep that measures the decode threshold in dB; experimental soft-PI and blind soft-PI read-outs; low-level decoder switches.
- In-app Guide, technical How-it-works and this changelog.
