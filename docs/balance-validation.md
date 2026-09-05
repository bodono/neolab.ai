# Balance validation protocol

This protocol is the evidence contract for GDD section 48 and implementation-plan S9.6. A green
unit-test suite proves deterministic rules; it does not prove the game is balanced. A completed
Stage 9 balance gate needs all three evidence classes below.

## 1. Automated release matrix

Run the nightly 10,200-game matrix at the exact candidate commit. Archive the aggregate artifact,
not one shard. Also archive the same commit's `balance-horizon` artifact: the Cartesian matrix's
ten-year cap measures broad cohorts efficiently, while the 1,120-week probe checks whether rivals
naturally complete the candidate requirements and whether resulting countdowns resolve. Confirm:

1. `reportFormat` is `2`, the content hash matches the candidate build, and `runCount` is `10200`.
2. All ten policy IDs, five leaders, three mandates, and four difficulties appear in
   `dimensions.csv`.
3. `shards.json` lists all ten inputs and the aggregate has no `matrix.shard` field.
4. Every sampled entry in each shard's `replay-verification.json` has `verified: true`.
5. `anomalyCounts` are all zero and no policy command was rejected.
6. Review every failed and unavailable row in `targets.csv`; do not average a missing cohort into
   zero and do not treat a smoke result as release evidence.
7. For event probability language, confirm `events.csv` contains resolved
   `likelihood-trials`/`likelihood-successes` rows. `events.very-likely-success` must have a real
   sample and fall in the promised 85–100% band; an absent sample is `unavailable`, not success.
8. The horizon report contains all ten policies, has zero rejected commands and structural
   anomalies, and produces the required Frontier/endgame samples. A late-game target with no
   horizon sample is `unavailable` even if every shorter Cartesian run is structurally green.
9. Rival plausibility rows use `plausibilityMeasurement: frontier-entry`; labelled
   `run-end-fallback` rows are diagnostics only and do not enter the GDD 48.7 denominator.
   Countdown response windows must be timestamped at their first live observation, before the
   recorded deadline expires.
10. The balanced probe's first allocation funds all eight player-visible capability programmes;
    retaining the three-programme 2012 launch allocation is a harness defect, not a legitimate
    balanced strategy. Judge the paper-share target from the aggregate balanced cohort as well as
   the deterministic horizon regression, because hidden paper breakthrough rolls intentionally create
    large run-to-run variation.

Automated policies are deliberately varied controls. The Standard target cohort excludes random
legal and the two deliberately bad baselines. No target result edits constants or affects play.

## 2. Controlled constant sweep

For each proposed numerical change:

1. identify one stable allowlisted key;
2. run at least the incumbent value plus one lower and one higher value over identical seeds;
3. compare funnel, loss family, economy curves, paper share, event calibration, and strategy
   dominance—not only headline win rate;
4. record the command, base content hash, selected value, rejected alternatives, and reason in the
   implementation decision log;
5. make the accepted change in authored balance data in a separate reviewed commit.

The sweep tool is diagnostic. It never writes the chosen value back into content.

## 3. Human playtest evidence

Headless games cannot establish comprehension, fairness, pacing, humour, or whether the Deployment
Crisis feels earned. S9.7 remains separate and must record real sessions against all seven GDD
section 49.6 questions. The real-time proxy in automated reports is provisional until those session
durations and decision times calibrate it.

## Release interpretation

- `pass`: the measured cohort exists and falls inside the stated GDD band.
- `fail`: the cohort exists and falls outside the band. This is a balance finding, not a runner
  failure.
- `unavailable`: the catalogue or play path produced no valid sample. This blocks claiming the
  corresponding gate; it must never be presented as zero or pass.

A release candidate is not balanced merely because target percentages look good. The matrix must
also contain viable distinct strategies, zero structural anomalies, credible rival routes, and no
large cohort hidden behind `incomplete`.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
