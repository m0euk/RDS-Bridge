# Changelog

All notable changes to RDS Bridge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/). Beta
releases are tagged `-beta`; the project reaches `1.0.0` when considered stable.

## [Unreleased]

_Changes for the next release will be collected here as community feedback comes in._

### Added

### Changed

### Fixed

---

## [0.1.0-beta] — 2026-06-27

First public beta.

### Added

- **NDA open-loop acquisition front-end** — Oerder–Meyr feed-forward symbol timing
  plus Costas carrier seeding, with feedback tracking engaged only after a coarse
  lock. Locks weak and unstable FM signals from a cold start where conventional
  loop-based decoders hang. *(Core feature of the project.)*
- **Full RDS group decode**: PI, PS station name, PTY, RadioText, TP/TA flags,
  stereo pilot, AF list and clock-time.
- **Syndrome block synchronisation** with configurable burst error-correction
  (off / ≤1 / ≤2 / ≤3 bits) over the (26,16) shortened cyclic code.
- **Channel-bandwidth selection** (130–230 kHz) for weak-signal and
  adjacent-channel rejection.
- **DX log** — every fully-identified live catch is recorded with its conditions
  (SNR, pilot, data quality) and what the decoder needed to resolve it
  (error-correction used, time-to-ID); with CSV export and local persistence.
- **Advanced / developer mode** (header toggle or `?dev=1`): an offline IQ-file
  test harness with calibrated noise and fading injection and an auto-sweep that
  measures the decode threshold in dB; experimental soft-PI and blind soft-PI
  read-outs; and low-level decoder switches.
- In-app **Guide**, technical **How it works**, **Changelog** and **About**.

### Notes

- The experimental **soft-PI** and **blind soft-PI** paths are included but **off by
  default**. Controlled testing (via the in-app harness) showed them at best
  marginal over the NDA baseline — under steady noise they tie the normal decoder
  and don't meaningfully extend the threshold. They are retained as a foundation
  for future work (e.g. cross-referencing a signal against a previously-decoded PI
  on the same frequency). The frozen baseline is the NDA decoder alone.

[Unreleased]: https://github.com/m0euk/RDS-Bridge/compare/v0.1.0-beta...HEAD
[0.1.0-beta]: https://github.com/m0euk/RDS-Bridge/releases/tag/v0.1.0-beta
