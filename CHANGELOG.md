# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to a date-tagged beta versioning scheme.

## [Unreleased]

## [0.2.0-beta] - 2026-06-27

### Added
- **Known-PI matcher** (advanced, experimental, advisory). Reframes the question
  from "what PI is this?" to "is a station I already know present?": it reads the
  recent same-frequency catches from the DX log and matched-filters the live soft
  accumulator against each one's known 26-bit block A. Read-only and
  prior-independent by construction — it never writes the log, never overrides the
  decoded PI, cannot produce a PS, and the recency prior only orders the search, it
  never lowers the evidence bar a confirm must clear. Shown as the `match`
  read-out on the PI line. **Any real-world sensitivity gain is not yet measured on
  live signals** — thresholds are provisional pending the calibration sweep, and
  the matcher sits in the same experimental tier as the soft/blind read-outs.
- Programme type is now shown by name (not raw number) in the DX log rows.

### Changed
- **DX log — names only commit once settled.** The decoder now keeps the most
  complete PS seen for a catch and logs it once it stops getting more complete,
  rather than writing whatever text happened to be on screen at the commit moment.
- **DX log — names upgrade in place.** If a fuller name finishes decoding while
  still tuned to a station, the existing log entry is completed rather than a
  second entry being added.

### Fixed
- DX log no longer records stray 1–2 character fragments as station names; a catch
  that never forms a name is recorded PI-only (still a valid DX identification).
- DX log no longer double-logs a station whose PI briefly drops out and returns on
  the same frequency — it is recognised as the same catch.

## [0.1.0-beta] - 2026-06

### Added
- First public beta.
- NDA open-loop acquisition front-end — Oerder–Meyr feed-forward symbol timing
  plus Costas carrier seeding, with feedback tracking engaged only after a coarse
  lock. Locks weak and unstable FM signals from cold where conventional loop-based
  decoders hang. This is the core of the project.
- Full RDS group decode: PI, PS station name, PTY, RadioText, TP/TA flags, stereo
  pilot, AF list and clock-time.
- Syndrome block synchronisation with configurable burst error-correction
  (off / ≤1 / ≤2 / ≤3 bits).
- Channel-bandwidth selection (130–230 kHz) for weak-signal and adjacent-channel
  rejection.
- DX log: every fully-identified live catch is recorded with its conditions (SNR,
  pilot, data quality) and what the decoder needed to resolve it (error-correction
  used, time-to-ID), with CSV export and local persistence.
- Advanced mode (header toggle or `?dev=1`): offline IQ-file test harness with
  calibrated noise and fading injection and an auto-sweep that measures the decode
  threshold in dB; experimental soft-PI and blind soft-PI read-outs; low-level
  decoder switches.
- In-app Guide, technical How-it-works and changelog.

[Unreleased]: https://github.com/m0euk/RDS-Bridge/compare/v0.2.0-beta...HEAD
[0.2.0-beta]: https://github.com/m0euk/RDS-Bridge/compare/v0.1.0-beta...v0.2.0-beta
[0.1.0-beta]: https://github.com/m0euk/RDS-Bridge/releases/tag/v0.1.0-beta
