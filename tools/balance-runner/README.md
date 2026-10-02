# Balance runner

The balance runner executes the production simulation without a browser. Policies receive the same
player-safe `GameView` used by the UI plus commands which pass the production validator. Canonical
state is inspected only after decisions, for diagnostics and sampled replay hashes.

## Commands

- `pnpm balance:smoke` — 30 paired runs, ten policies, up to 104 weeks.
- `pnpm balance:horizon` — one seed across all ten policies, up to 1,120 weeks (about 21.5 years), with a deterministic
  10% replay sample. This small nightly probe is long enough to observe rivals naturally completing
  their Candidate Programmes, training qualifying models, and resolving any resulting countdowns
  without multiplying the entire Cartesian matrix's cost.
- `pnpm balance:expert` — 30 seeds of the strong scripted player (below), up to 1,120 weeks. Add
  `--shard-index i --shard-count 3` to the CLI to split it across processes.
- `pnpm balance:expert-trace -- --seed 1` — one expert game with a yearly timeline and the week each
  era, key facility, work and crisis stage landed. A tuning aid: it reads privileged state to
  explain the run, while the policy still sees only the player view.
- `pnpm balance:full` — 1,000 paired runs, ten policies, up to 520 weeks.
- `pnpm balance:release` — the complete 10,200-run Cartesian release matrix: 17 seeds × four
  difficulties × five leaders × three mandates × ten policies. The nightly workflow partitions this
  into ten deterministic 1,020-run shards.
- `pnpm balance:aggregate -- --input ../../artifacts/balance/shards --output
  ../../artifacts/balance/release` — validates a complete, non-overlapping shard set and rebuilds all
  aggregates from raw runs.
- `pnpm balance:sweep -- --key economy.startingCash --values 80,100,120 --runs 100` — changes one
  allowlisted in-memory balance key across an identical seed/policy cohort. It does not rewrite or
  rebuild authored content.

Every normal batch writes:

- `report.json` — report format 2, including raw runs, sampled action logs, and explicit rival
  candidacy timelines (starts, False Dawns, emergency containment, delays, deployments, and
  catastrophes);
- `runs.csv`, `policies.csv`, and `dimensions.csv`;
- `targets.csv` with pass/fail/unavailable status for each GDD section 48 target;
- `resource-curves.csv`, `facilities.csv`, and `events.csv`;
- `replay-verification.json` proving sampled command logs reproduce the exact terminal state hash.

Target misses never fail or mutate the simulation. Structural errors—invalid requests, incomplete or
duplicate shards, rejected sampled replays, and engine exceptions—do fail the command.

The ten-year full/release cap is a throughput cohort, not evidence that later phases are reachable.
Always review the twenty-one-year horizon artifact alongside it. A balance gate remains unavailable
when neither cohort produces the required Frontier, candidate, crisis, gate, or ending sample.

## Policy catalogue

The release matrix covers balanced generalist, capability-first, commercial compounder,
open-science prestige, safety/institution-first, secretive proprietary, coalition builder, random
legal, never-fund-serving, and never-train-model. The last two are deliberately bad controls.
Policies are deterministic probes, not claims about optimal or human play.

The balanced probe replaces the deliberately narrow 2012 launch allocation on its first decision:
62.5% serving leaves 37.5% for R&D, the remaining split is 60% capabilities / 40% safety, and all
seven capability programme sliders receive non-zero weight. It does not inspect undiscovered-paper
thresholds or rival truth. This distinction matters because leaving the launch portfolio unchanged
would fund only architectures and optimisation for the entire run while
mislabeling that omission as balanced play.

All policies make choices only from player-visible information. Event options vary by policy so the
catalogue can demonstrate option coverage. The action enumerator also exercises research focus,
publishing, compute, facilities, training, evaluation, productisation, deployment policy,
recruitment, lobbying, diplomacy, coalition work, anomalies, and all Deployment Crisis command
families when they are legal.

## Expert policy

`--expert` replaces the catalogue with one strong scripted player (`src/expert-policy.ts`). The
catalogue policies are narrow archetypes and none of them starts the Candidate Programme, so none
can reach candidacy; the expert exists to measure whether the game can be won and how hard it is.
It sees only the player view, plus the same command previews the UI shows before an action (prices,
training forecasts, blockers), and builds commands the way a player would: sized GPU orders,
training runs chosen from the forecast, and the Candidate Programme works.

Its plan, in order of what decides a run:

- **Economy.** Fund every capability programme, serve enough of the fleet to meet demand, raise
  before runway runs short, and expand housing and compute continuously. It trains only runs
  forecast to beat their parent, so an early lab spends on compute rather than repeat models.
- **Hold the gate.** A lineage's chance of being a genuine superintelligence is fixed when it first
  crosses the candidacy gate (FC 88, every attribute 80), so crossing at 90 locks in about a 13%
  prior. Until every work is under way it trains only runs forecast to stay below the gate. Then it
  crosses once, with a run forecast to clear FC 97 (a prior of 61% or more), unless a rival's public
  countdown leaves no time to wait, when it takes the best run available.
- **Work chains.** Each work waits on a facility chain, and tier-4 and tier-5 buildings take two of
  at most five major project slots. From the frontier phase it schedules the chain with the most
  work left first (the World Engine's, through the Hadron Collider and Time Sphere) and spends no
  slot elsewhere.
- **The Deployment Crisis.** Nominate the highest-prior candidate, prove it with the generalist
  gauntlet under independent verification, take at most two sprint responses, comply with the
  pressure collision, deploy through adaptive monitored rollout, choose cautious rollout options,
  and retire the candidate if the clock stops with nothing else legal.

The runner keeps asking the policy at the same tick while an endgame beat stops the clock (the
world-waiting reveal, a containment failure, a False Dawn or recovery choice, an unverified
retirement, the final deployment decision) and ends the run if no command makes progress.

## Matrix and sharding contract

`runBalanceBatch` defaults to a true Cartesian product. `matrixMode: "paired"` is a deliberately
smaller probe which rotates leader, mandate, and difficulty over each seed/policy pair. Every
Cartesian configuration receives a stable zero-based ordinal and semantic run key. Shard `i/n`
contains exactly ordinals where `ordinal % n === i`.

Aggregation rejects:

- missing or repeated shard indexes;
- mixed content hashes, matrix shapes, tick caps, or trace rates;
- duplicate run keys or ordinals;
- any ordinal gap;
- a raw run count different from the declared matrix size.

This makes ten parallel jobs equivalent to one serial 10,200-run invocation.

## Metric interpretation

Reports distinguish measured values from proxies:

- `estimatedRealMinutes` is four seconds per simulated week plus 45 seconds per material scripted
  decision. Human session recordings must calibrate it.
- Rival plausibility is captured exactly once at the first canonical Frontier entry. Runs ending
  earlier retain an explicitly labelled `run-end-fallback` diagnostic but are excluded from the
  GDD 48.7 target denominator. The viable-response metric likewise captures the first live rival
  candidate countdown, rather than inspecting an expired deadline at run end.
- A facility's `cashDeltaAfter26Weeks` is a confounded post-build diagnostic, not causal ROI.
- State-conditioned event rate is a structural proxy: the definition has a state predicate or
  weight modifier.
- An event check may carry a structured qualitative likelihood promise plus the outcome IDs that
  count as success. The runner measures resolved trials by label; “Very likely” is tested against
  85–100%. It remains `unavailable` when no such check resolves and never infers semantics from
  prose.
- Hidden-evidence error uses the same alignment-label classifier as production and privileged truth
  only after the run.

Anomaly detection counts stranded zero-progress projects, invalid allocation hierarchies, and
unresolved events with no enabled choice. Simulation invariants still
run every tick and fail immediately on harder corruption.

## Constant overrides

The allowlist is closed and typed:

- `economy.startingCash`
- `economy.startingOwnedGpus`
- `economy.fundingClimate`
- `research.baseRpCoefficient`
- `research.teraflopScaleDivisor`
- `facilities.baselineOwnedGpuCapacity`

Sweep output records the base content hash, key, values, and a complete report per value. Overrides
are cloned in memory; release builds expose no arbitrary override control.
