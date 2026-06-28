# Matcher graduation — pre-registration

**Status:** committed-pending-threshold. NOT valid as a pre-registration until the
FROZEN THRESHOLD below is filled from source and this file is committed *before* any
sweep trial is scored. The commit timestamp is the whole point.

```
Date committed:        2026-06-28
Decoder build (hash):  b233c0e4a335be99fdcdf8bf3d8b938ae656e602   (v0.2.1-beta)

Matcher operating point — FROZEN AS-BUILT:
  minGroups:  8
  corrMin:    0.30
  margin:     0.10
  windowMin:  30
  tolKHz:     50
```

## Decision rule
Graduate the known-PI matcher out of advanced/experimental mode IFF all three hold,
all measured at the frozen threshold above:

1. Phantom false-alarm — PASS
2. Confusion false-alarm — PASS
3. Sensitivity gain ≥ 3 dB

False-alarm is the fixed constraint; gain is read off *at* it. The threshold is set
once, from the as-built source, before any trial is scored. Retuning it to help a
pass voids the pre-registration. Tuning is a separate job with its own pre-reg.

## Metrics & thresholds

**Phantom-FA** — matcher asserts a PI when it should stay silent (no decodable RDS
present, or the true PI is absent from the candidate list). The poison mode; hard zero.
- PASS = 0 assertions across ≥300 negative-control trials.
- Rule of three: 0 in 300 bounds the true rate ≤1% at 95% confidence. Fewer trials
  bound nothing.
- Negative controls are synthesisable (seeded noise; or a real signal with its true
  PI removed from the list), so 300 is a batch loop, not 300 captures.

**Confusion-FA** — true PI is in the list, matcher picks a decoy instead.
- PASS = ≤1% across ≥300 trials (≤3 decoy-picks in 300).

**Sensitivity gain** — extra weak-signal reach the matcher buys over baseline NDA.
- Measure the signal level at which each path first holds ≥90% correct-PI assertion;
  gain = baseline level − matcher level, in dB.
- ≥3 dB = pass · 1.5–3 dB = INCONCLUSIVE (redesign/re-run, no tag) · <1.5 dB = fail.

## Candidate-list size (N)
Phantom-FA scales with list length, so it is measured at the size actually run in the
field — a 2000-entry summer log gives the matcher ~8× more misfire chances than a 250.
- Swept at **N = 500** (diagnostic) and **N = 2000** (decision).
- Decision gates on N = 2000.
- Clean at 500 but dirty at 2000 = envelope found: matcher may still graduate behind a
  candidate-cap or N-dependent threshold guardrail, decided from the curve — not a
  silent pass, not a silent fail.

## Corpus (pre-committed; no cherry-picking after the fact)
- ≥5 distinct PIs across the marginal regime.
- **AWGN arm** — ≥5 attenuation steps × ≥30 trials/step, for the clean dB axis and the
  90% crossings. A trial = one noise seed, looped; the harness fast-forwards.
- **Real-weak arm** — naturally marginal captures incl. 93.6 MHz "Tyneside" PI 0xC053.
  Hard must-pass gate: correct PI decodes when present, and NO phantom assertion when
  detuned off it. Qualitative (you cannot synthesise 300 real captures) — its job is
  the multipath / phase-mush check AWGN cannot surface. Clean-on-AWGN-but-dirty-on-real
  = fail, not a footnote.

## Outcomes → version
- All three pass at N = 2000 → matcher graduates → **0.3.0** (graduation is the
  headline; UI-scale + log-dedupe ride as supporting changes).
- Gain < 1.5 dB, or any FA arm dirty → matcher stays experimental → UI-scale +
  log-dedupe ship as **0.2.2**.
- Inconclusive gain band, or corpus too thin to bound FA → no tag either way; expand
  corpus and re-run. Version stays unpicked.
