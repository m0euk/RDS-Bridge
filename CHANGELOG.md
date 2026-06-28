# Changelog

All notable changes to RDS Bridge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Note: dates for 0.2.0-beta and 0.1.0-beta are reconstructed — if your repo's
> existing CHANGELOG.md has the exact release dates, keep those.

## [Unreleased]

## [0.2.1-beta] - 2026-06-28

### Fixed
- Large IQ recordings (over 4 GB) failed to load with "not a RIFF/WAV file".
  Captures above the 4 GB classic-RIFF ceiling are written in the 64-bit
  RF64/BW64 variant, which the loader rejected on the first four bytes. The
  IQ-file loader now accepts `RIFF`, `RF64` and `BW64` headers and reads the
  true data size from the `ds64` chunk when the legacy size fields carry the
  `0xFFFFFFFF` sentinel. Verified loading 5 GB and 24 GB RF64 captures from
  SDRConnect; sub-4 GB RIFF files are unaffected. No change to the decode path
  or DX log.

## [0.2.0-beta] - 2026-06

### Added
- Known-PI matcher (advanced, experimental, advisory): asks "is a station I
  already know present?" instead of decoding the PI blind. It reads the recent
  same-frequency catches from the DX log and matched-filters the live soft
  accumulator against each one's known 26-bit block A. Read-only and
  prior-independent by construction — it never writes the log, never overrides
  the decoded PI, cannot produce a PS, and the recency prior only orders the
  search, never lowers the evidence bar. Shown as the `match` read-out on the PI
  line. Any real-world sensitivity gain is not yet measured on live signals;
  thresholds are provisional pending the calibration sweep.
- Programme type (PTY) is now shown by name in the DX log rows.

### Changed
- DX log — names only commit once settled: the decoder keeps the most complete
  PS seen and logs it once it stops getting more complete, instead of writing
  whatever happened to be on screen at commit time.
- DX log — names upgrade in place: if a fuller name finishes decoding while
  still tuned to a station, the existing log entry is completed rather than
  duplicated.

### Fixed
- DX log — stray 1–2 character fragments are no longer logged as names; a catch
  that never forms a name is recorded PI-only.
- DX log — a PI that flickers out and back on the same frequency is recognised
  as the same catch rather than a duplicate.

## [0.1.0-beta] - 2026-06

### Added
- First public beta.
- NDA open-loop acquisition front-end — Oerder–Meyr feed-forward symbol timing +
  Costas carrier seeding, with feedback tracking engaged only after a coarse
  lock. Locks weak and unstable FM signals from cold where conventional
  loop-based decoders hang.
- Full RDS group decode: PI, PS station name, PTY, RadioText, TP/TA flags,
  stereo pilot, AF list and clock-time.
- Syndrome block synchronisation with configurable burst error-correction
  (off / ≤1 / ≤2 / ≤3 bits).
- Channel-bandwidth selection (130–230 kHz) for weak-signal and adjacent-channel
  rejection.
- DX log: every fully-identified live catch is recorded with its conditions
  (SNR, pilot, data quality) and what the decoder needed to resolve it
  (error-correction used, time-to-ID) — with CSV export and local persistence.
- Advanced mode (header toggle or `?dev=1`): offline IQ-file test harness with
  calibrated noise + fading injection and an auto-sweep that measures the decode
  threshold in dB; experimental soft-PI and blind soft-PI read-outs; low-level
  decoder switches.
- In-app Guide, technical How-it-works and this changelog.

[Unreleased]: https://github.com/m0euk/RDS-Bridge/compare/v0.2.1-beta...HEAD
[0.2.1-beta]: https://github.com/m0euk/RDS-Bridge/compare/v0.2.0-beta...v0.2.1-beta
[0.2.0-beta]: https://github.com/m0euk/RDS-Bridge/compare/v0.1.0-beta...v0.2.0-beta
[0.1.0-beta]: https://github.com/m0euk/RDS-Bridge/releases/tag/v0.1.0-beta
