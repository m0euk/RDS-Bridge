# Changelog

RDS Bridge — browser-based FM RDS decoder for SDRplay via SDRConnect.
All notable changes per release. Dates are release month; every 0.x is a beta.

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

