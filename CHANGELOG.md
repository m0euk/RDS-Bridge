# Changelog

All notable changes to RDS Bridge are documented here. This project is in beta;
versions follow `0.MAJOR.MINOR-beta`.

## [0.3.1-beta] — Jun 2026

Tuning UX. All changes are presentation / command only — the decode path is untouched.

- **RF waterfall frequency axis** — an MHz tick scale beneath the band, aligned to the spectrum span, with a green VFO tick mirroring the channel marker. The band is now properly readable at a glance.
- **Click-to-tune** — click the RF waterfall (or its axis) to retune SDRConnect's VFO to that point, with a hover read-out of the target frequency. Guarded on hardware control availability, and it reuses the existing re-acquisition path: small moves follow the signal, genuine station changes reset cleanly.
- **Snap-to-step** — click-to-tune snaps to a selectable frequency step (off / 50 / 100 / 200 kHz, default 100 kHz, remembered between sessions) to match SDRConnect's Tuning Step Size. Needed because an externally-commanded VFO bypasses Connect's own Step Snap.

## [0.3.0-beta] — Jun 2026

Live monitoring, all in one window. Alongside the sensitive decoder, RDS Bridge now shows an RF band waterfall and plays the tuned station's audio — using SDRConnect's spectrum-bin and demodulated-audio streams over the same WebSocket. All of the below is presentation-only and never touches the decode path.

- **RF band waterfall** — the full captured span (≈9 MHz on a wideband capture) as a scrolling spectrum, with a large tuned-frequency read-out and a green marker on the channel being decoded. Makes faint, catchable carriers visible at a glance — useful for spotting DX before it fully resolves.
- **MPX waterfall strip** — a scrolling history above the composite trace, sharing its frequency axis, so the 19 / 38 / 57 kHz pilot, stereo and RDS subcarriers persist and fade visibly. A direct read on whether RDS is coming through on a marginal signal.
- **Live stereo audio** from SDRConnect, with a volume control; runs alongside decoding without disturbing it.
- **Independent contrast controls** for the RF and MPX waterfalls, each dialled to conditions.

## [0.2.2-beta] — Jun 2026

- **Interface scale control** (header, top-right) — 90–150% presets for readability on 4K / high-DPI displays. Scales the whole interface including the scope, and is remembered between sessions.
- **DX log — no duplicate rows on return** — a station you leave and come back to (or that is still in the log after a reload) is recognised as the same catch within the hour and enriches the existing entry instead of adding a second row. Rows now show a ×N heard-count and track last-heard, both included in the CSV export. A genuine re-catch after an hour still logs fresh, and a fuller name still upgrades the entry in place.
- **Offline test harness — matcher sensitivity measurement** — the auto-sweep now also measures the experimental known-PI matcher's sensitivity (the weakest SNR at which it still confirms the correct station), reported alongside Normal / Soft / Blind with its gain over the baseline decoder. Advanced mode only; the matcher stays experimental and advisory and its thresholds are unchanged — this adds measurement, not a validated result.

## [0.2.1-beta] — Jun 2026

- **Fixed: large IQ recordings (over 4 GB) failed to load** with "not a RIFF/WAV file". Captures past that size are written in the 64-bit RF64/BW64 variant rather than classic RIFF, which the loader didn't recognise. The loader now accepts RIFF, RF64 and BW64 and reads the true data size from the file's `ds64` chunk. Confirmed loading 5 GB and 24 GB RF64 captures; sub-4 GB RIFF files are unaffected.

## [0.2.0-beta] — Jun 2026

- **Known-PI matcher** (advanced, experimental, advisory) — asks "is a station I already know present?" instead of decoding the PI blind. It reads the recent same-frequency catches from the DX log and matched-filters the live soft accumulator against each one's known 26-bit block A. Read-only and prior-independent by construction: it never writes the log, never overrides the decoded PI, cannot produce a PS, and the recency prior only orders the search, never lowers the evidence bar. Shown as the `match` read-out on the PI line. Any real-world sensitivity gain is not yet measured on live signals; thresholds are provisional pending the calibration sweep.
- **DX log — names only commit once settled** — the decoder keeps the most complete PS seen and logs it once it stops getting more complete, instead of writing whatever happened to be on screen. Stray 1–2 character fragments are no longer logged as names; a catch that never forms a name is recorded PI-only.
- **DX log — names upgrade in place** — if a fuller name finishes decoding while still tuned to a station, the existing log entry is completed rather than duplicated.
- **DX log — fewer duplicates** — a PI that flickers out and back on the same frequency is recognised as the same catch.
- **Programme type** is now shown by name in the DX log rows.

## [0.1.0-beta] — Jun 2026

First public beta.

- **NDA open-loop acquisition front-end** — Oerder–Meyr feed-forward symbol timing + Costas carrier seeding, with feedback tracking engaged only after a coarse lock. Locks weak and unstable FM signals from cold where conventional loop-based decoders hang.
- **Full RDS group decode** — PI, PS station name, PTY, RadioText, TP/TA flags, stereo pilot, AF list and clock-time.
- **Syndrome block synchronisation** with configurable burst error-correction (off / ≤1 / ≤2 / ≤3 bits).
- **Channel-bandwidth selection** (130–230 kHz) for weak-signal and adjacent-channel rejection.
- **DX log** — every fully-identified live catch is recorded with its conditions (SNR, pilot, data quality) and what the decoder needed to resolve it (error-correction used, time-to-ID), with CSV export and local persistence.
- **Advanced mode** (header toggle or `?dev=1`) — offline IQ-file test harness with calibrated noise + fading injection and an auto-sweep that measures the decode threshold in dB; experimental soft-PI and blind soft-PI read-outs; low-level decoder switches.
- **In-app Guide**, technical How-it-works and this changelog.
