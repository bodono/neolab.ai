# Balance runner

The balance runner executes the production simulation without a browser. Policies receive the same
player-safe `GameView` used by the UI plus commands which pass the production validator. Canonical
state is inspected only after decisions, for diagnostics and sampled replay hashes.

## Commands

- `pnpm balance:smoke` — 30 paired runs, ten policies, up to 104 weeks, all on Standard / Thomas
  Hassabi / Build It Right (see `--difficulties` below to rotate setups).
- `pnpm balance:horizon` — one seed across all ten policies, up to 1,120 weeks (about 21.5 years), with a deterministic
  10% replay sample. This small nightly probe is long enough to observe rivals naturally completing
  their Candidate Programmes, training qualifying models, and resolving any resulting countdowns
  without multiplying the entire Cartesian matrix's cost.
- `pnpm balance:expert` — 30 seeds of the strong scripted player (below), up to 1,120 weeks. Add
  `--shard-index i --shard-count 3` to the CLI to split it across processes.
- `--expert-focus <programme>` (with `--expert`, and on `balance:expert-trace`) makes the expert
  focus its research: half of capability research goes to one capability programme, given as a
  bare slug (`multimodality`), `domain.multimodality` or the full id, and the rest is split as
  usual. At the expert's normal 70% capability share that is 35% of all research compute, enough
  to make the programme a paper focus (its papers need four fewer levels). Use it to measure what
  a focused player wins in the paper race; reports still name the policy `expert`, so give the
  output directory a telling name.
- `--difficulties`, `--leaders` and `--mandates` pick the setups any CLI batch plays: comma-separated
  IDs or bare slugs (`fellowship`, `base:difficulty.fellowship`), or `all`. A dimension left out stays
  at Standard, Thomas Hassabi or Build It Right, except under `--matrix cartesian`, where it expands
  to every authored ID. For example, the expert on every difficulty over the same ten seeds:
  `--expert --matrix cartesian --difficulties all --leaders thomas-hassabi --mandates build-it-right
  --runs 40`.
- `pnpm balance:ladder` — the expert on all four difficulties over twenty fixed seeds, to week 1,500
  (80 games, about two hours split three ways with `--shard-index i --shard-count 3 --output
  ../../artifacts/balance/ladder-shards/shard-i`, then `pnpm balance:aggregate`). The weekly
  workflow plays it in ten shards and runs `pnpm balance:drift -- --input
  ../../artifacts/balance/ladder/report.json`, which fails when a statistic (wins, crises
  reached, emergency shutdowns, rival ascensions, median end week, events per run, the player's
  share of world-first papers, rivals' crossing capability) moves further than chance would from
  `baselines/expert-ladder.json`: for counts, three standard deviations of the difference between
  two independent draws of the same twenty seeds (at least three games), so a change that only
  re-rolls the random streams almost never fails; a fixed margin for the rest. The seeds are fixed and the
  simulation deterministic, so unchanged code reproduces the baseline exactly. After an intended
  balance change, refresh the baseline before the next scheduled run: dispatch the Weekly balance
  workflow with `refresh_baseline` ticked (it plays the ladder and writes
  `expert-ladder-baseline.json` into the `expert-ladder` artifact without comparing), or play it
  locally and run `pnpm balance:drift -- --input <report.json> --write-baseline --measured-at
  <commit>`, then commit it as `tools/balance-runner/baselines/expert-ladder.json`.
- `--opening guided|classic` picks how every game in a batch opens. `classic` (the default, and what
  every measurement above and the committed baseline use) is "Everything unlocked",
  `createNewGame`. `guided` is "Guided chapters", `createProgressiveNewGame`: the new-game screen's
  default, built from the same setup (apps/web `BrowserGameRuntime.createNew`). The lab starts in a
  garage with about $30M and no GPUs, and works through twelve chapters, each opening one system
  and closing on a checklist; random decision events open at the institution chapter and
  mandatory ones at the last, the frontier.
  Only the expert can play the chapters (below); the catalogue policies stall in the garage. A
  guided run's key ends in `/guided`, its record carries `opening` and `chapterEntryTicks` (the
  week each chapter began), the report's `matrix.opening` says which opening it played, and
  aggregation refuses to mix the two.
- `pnpm balance:ladder-guided` — the expert through the guided opening on all four difficulties
  over the ladder's twenty seeds, to week 1,500 (80 games). The weekly workflow plays it in ten
  shards and
  compares it with its own baseline, `baselines/expert-ladder-guided.json`, honouring
  `refresh_baseline` as the ladder above does. Until that file is committed, `pnpm balance:drift`
  writes `expert-ladder-guided-baseline.json` beside the aggregate (the `expert-ladder-guided`
  artifact) and only warns; commit that file to start comparing. The drift tool refuses to
  compare a guided ladder with a classic baseline, or the reverse.
- `pnpm balance:expert-trace -- --seed 1` — one expert game with a yearly timeline and the week each
  era, key facility, work and crisis stage landed, plus the player's world-first papers overall
  and per programme, and a closing `events` line: ordinary decision events in all, the week of
  the first, the week the world (the strongest true model anywhere) reached FC 45, where the
  early-era events close, and the events that fired before it. Add `--opening guided` to start
  from the guided chapters: the timeline then shows the chapter, and the milestones the week each
  chapter began. A tuning aid: it reads privileged state to explain the run, while the policy
  still sees only the player view.
- `pnpm balance:full` — 1,000 paired runs, ten policies, up to 520 weeks, on the same single setup
  unless setup flags are added (with `--runs` a multiple of the number of setups they name).
- `pnpm balance:release` — the complete 10,200-run Cartesian release matrix: 17 seeds × four
  difficulties × five leaders × three mandates × ten policies, local only (about 250 hours of
  games, far past any CI limit): split it with `--shard-index i --shard-count n` and rebuild with
  `balance:aggregate`.
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

### The guided opening

In a guided game the expert first plays the chapter in front of it, as a player following the
checklist would, and from the frontier chapter on plays exactly as above; a classic game has no
chapters, so its play is unchanged. Unaided, the expert never left the garage: its $30M cash floor
kept a $30M lab from buying its first GPUs, so it issued nothing at all (no command was ever
refused) and sat at FC 0. Chapter by chapter it now:

- **Garage, cluster, model, startup.** Buys the 1,000 GPUs the garage holds, trains the prototype,
  reviews the rival race (`review-rival-race`, the command the World screen sends), builds the
  Server Rack and fills it to 5,000 GPUs.
- **Foundation.** Gives capability research 80% of R&D compute (the checklist's minimum), waits for a
  programme to advance, then trains the quickest run whose whole forecast clears FC 5.
- **Product, funding, lab.** Productises the FC 5 model, puts it on the Guarded API and serves
  demand; raises a round and takes the best offer; recruits the cheapest star on the market and
  appoints them to lead the programme they are best at.
- **Institution, safety, autonomy.** Builds the Press Office, then grows the lab with its usual
  economy (launches, compute, housing, recruits, fundraising) while training toward FC 10 and then
  FC 20, a sure run when one exists and its usual next model otherwise. The safety chapter gives
  safety research 30% of R&D compute and runs the cheapest evaluation; the autonomy chapter grants
  the FC 20 model Access Level 1.

Chapter costs the opening's family credit line covers (the first GPUs, the prototype and FC 5
runs, the Server Rack, the launch, the first recruit, the Press Office, the evaluation) may take
cash below zero, as the chapter intends; everything else, including the FC 10 and FC 20 milestone
runs, keeps the usual floors. A guided run also
asks its policy whenever a chapter opens or an objective completes, the moments the game pauses
for a player, as well as on the usual cadence.

## Matrix and sharding contract

`runBalanceBatch` defaults to a true Cartesian product. `matrixMode: "paired"` is a deliberately
smaller probe which rotates leader, mandate, and difficulty over each seed/policy pair. It rotates
only through the IDs it is given: the CLI passes a single setup (Standard, Thomas Hassabi, Build It
Right) for any dimension not named with `--difficulties`, `--leaders` or `--mandates`, so a
paired CLI batch rotates nothing unless those flags list several IDs or `all`. Every
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

## Paper race note

Before rival paper levels and the player paper focus (game design section 34.5), the expert won no
paper a rival could also attempt: by week 860 it had 1 of 115 world firsts on seed 1 and 0 of 115
on seed 2, and every later win was a facility-gated paper rivals never build for. Expert traces
after the change (`balance:expert-trace`, Standard / Thomas Hassabi / Build It Right), player world
firsts at week 860, then at the end of the game:

| Seed | Expert focus  | Week 860 | Focus programme | End of game          |
| ---- | ------------- | -------- | --------------- | -------------------- |
| 1    | none          | 0/114    | –               | 20/134, lost wk 1056 |
| 1    | multimodality | 9/114    | 8/17            | 29/134, lost wk 1056 |
| 1    | reasoning     | 3/114    | 2/14            | 23/134, lost wk 1056 |
| 2    | none          | 7/114    | –               | 27/134, won wk 951   |
| 2    | multimodality | 14/114   | 13/17           | 33/133, won wk 951   |
| 2    | reasoning     | 3/114    | 2/14            | 23/134, lost wk 965  |

Focus pays most in a programme the rivals neglect (Multimodality) and little in one they push
hardest (Reasoning). Before the change the unfocused expert ended seed 1 lost in week 1061 with
20/134 and seed 2 won in week 951 with 19/134. Rival real levels are unchanged, but fewer early
papers are published, so their payloads arrive later: on seed 1 the world reached the Frontier
phase in week 525 rather than 488 (seed 2 was unchanged, week 521).
