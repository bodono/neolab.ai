# Pacing & researcher backlog — handoff

Written 2026-07-28. Everything described as "done" is on `origin/main`.
Work trunk-based: commit and push straight to main, no feature branches.
Another agent shares this working tree — never `git add -A`, stage explicit
paths only, and never stash or discard their uncommitted files.

Verification recipe for any item below:

```
pnpm --filter @neolab/content-compiler compile   # expect 0 blocking / 0 warnings
npx tsc --noEmit -p packages/sim && npx tsc --noEmit -p apps/web
npx vitest run packages/sim packages/testkit     # expect ~566 passed
npx eslint <changed files> && npx prettier --write <changed files>
```

Full-suite runs are flaky under load because a second agent runs builds
concurrently: failures that pass in isolation are contention, not regressions.
Always re-run a failure alone before believing it.

---

## Context: what already changed (so you don't undo it)

- **Capability is Cobb-Douglas, not a weighted sum.**
  `100 × research^0.60 × scale^0.30 × data^0.10`, in
  `packages/sim/src/training/training.ts`. Research is the dominant term.
  Engineering quality was removed from the formula entirely (it was invisible
  and unactionable); the lab stat still exists for researcher hiring.
- **Capability scale is ABSOLUTE FLOP**, not era-relative:
  `scale = 14.024 × (log10(effectiveFLOP) − log10(2.9e22))`, clamped 0–100.
  Anchors: first prototype 3.9e22 → 1.8, 7.5e28 → 90, full Basilica
  2.2e29 → 96.5. This moves the score-90 upper-curve point exactly 3×
  right; YOLO separately counts physical training FLOP as 3× effective FLOP.
  Models store `investedTotalFlop` for physical capability inputs,
  training history, and proportional costs, but candidacy has no raw-FLOP gate.
  Era-reference survives ONLY as UI sugar ("% of a reference cluster").
- **Research level costs already grow exponentially from level 20**:
  capability uses `levelCostGrowth 1.10`, while safety uses
  `safetyLevelCostGrowth 1.15`. Safety has only three programmes against seven
  capability domains, so its deliberately steeper late curve prevents the
  whole branch from saturating while the player is still building capability.
- **Signature abilities are always on** (no assignment gating). They resolve
  `assignedProgramme.*` against the programme named in their `activation`
  clause via `authoredProgrammeId`. This is intended, not a bug.
- **Assignments are lead-only**: capability or safety programme lead. Project
  postings and the research-council / safety-director / external-council
  options were removed from the dropdown.
- **Knowledge diffusion** exists: every star researcher lifts every programme
  by `skill × rate`, rate unlocked by six campus buildings 0 → 2.0.

---

## 1. Slow paper discoveries (DONE)

Every paper now has one hidden authored `breakthroughRequirement`: a programme
and exact level. The catalogue spans foundation levels 10–28, deep-learning
32–48, scaling 54–70, real frontier 74–86, and fictional future 87–100.
Attention Is All You Need, for example, is gated at Architectures 62.

Once all visible prerequisites and the hidden level are met, each lab makes one
seeded weekly breakthrough roll: 22% at the threshold, +8 percentage points per
extra level, capped at 78%. The old parallel `baseEffort`/`paperProgress`
accumulation is no longer advanced or consulted. Player surfaces retain
qualitative estimated momentum; exact levels and chances are confined to the
developer inspector.

## 2. Milestone popup pile-up (DONE)

**Symptom.** All ten research programmes use one cost table, so under balanced
allocation they cross level thresholds within a week or two of each other and
fire several modals at once.

Every programme now has a distinct authored `levelCostMultiplier`, ranging
from Security and Containment at 0.80 through Architectures at 1.00 to Robotics
and Embodiment at 1.20. Their mean remains close to the old 1.00 baseline, but
balanced allocations no longer buy milestones on the same schedule. This adds
field character and permanently desynchronises the threshold crossings without
adding another hidden phase-offset state variable.

## 3. Timeline probe (DONE)

The first post-FLOP probe exposed a real regression: late rivals still targeted
only 25,000 current-era GPU equivalents, so their ordinary models stalled well
below candidate capability. The old calendar backstop could then create the
first candidate before normal rival progression had earned one; that backstop
has been removed. Rivals now need the same four works and capability gate as
the player before any countdown starts.

Rival fleet targets now step through the same physical scale as the player's
late datacentres: 80k in Hopper, 250k in Blackwell, 800k in Rubin, and 2.5m in
Markov/Kolmogorov. Orders remain real delayed GPU purchases. Because rival
finances are abstracted, a sovereign-scale order receives only its exact
external-finance shortfall immediately before purchase; it does not leave idle
cash behind. Procurement is capped at 800k GPUs per tranche.

An eight-seed deterministic stagnant-player probe now reaches every milestone
naturally:

| Milestone | Minimum | Median | Maximum |
|---|---:|---:|---:|
| Markov unlock | 708 | 739 | 849 |
| First rival candidate countdown | 756 | 786 | 896 |
| Rival ascendance | 824 | 854.5 | 968 |
| Markov-to-ascendance window | 113 | 117 | 134 |

The prior endgame-window reference was 122 weeks (Markov 289, countdown 336,
ascendance 411). The new median window is 117 weeks: nearly unchanged despite
the much longer research-driven campaign, and no seed relies on the global
convergence fallback.

Median hardware unlock weeks were Kepler 0, Maxwell 214.5, Pascal 318.5, Volta
393, Turing 445, Ampere 565, Hopper 638, Blackwell 675, Rubin 701.5, Markov
739, and Kolmogorov 785.5. The disposable probe test was deleted after writing its
results to `/tmp/neolab-timeline-probe.json`.

## 4. Researcher ability audit follow-ups (PARTLY DONE)

**Done and on main** (commits 526a066, 56fb5b3):

- **Four separate gates** were each independently cancelling the always-on
  rule, so an unassigned researcher's advertised ability produced nothing:
  ability-level activation, per-modifier activation, `abilityEffects`
  returning `[]` when no authored mode matched, and
  `signatureAssignmentEligible` returning false with no assignment. All four
  now pass signatures and passives through; compacts keep their gates.
- **`signatureRamp`** returned zero strength when unassigned and ignored the
  authored `rampWeeks` in favour of a fixed four-step table. It now counts
  from the assignment where there is one and the hire date otherwise, and
  honours the authored length.
- **`pairedProgramme.researchOutput`** resolved to the same target as
  `assignedProgramme`. It now resolves to the strongest programme that is not
  the one already being boosted.
- **`capabilityPotentialGain`** multiplies the compute term against a base of
  1, so the authored `add 4` was a x5 on scale, not a small bonus. Seven flat
  adds converted to the multiplier band (4 -> 1.06, 3 -> 1.04, 2 -> 1.03).
  Both `assignedTrainingRun.*` targets are genuinely consumed; the gates were
  what killed them, so no re-pointing was needed.
- **Four double-applying signatures** (Schoelkopff, Hopfeld, Sejnowsky,
  Bronsteen) named their own strongest field as a second effect, so both
  effects landed on one programme. Second effect is now `pairedProgramme`.
  Vapnick looks identical but is NOT a duplicate (strongest field is Reasoning
  Tools); Abeter and Levinsky repeat across alternative modes, only one of
  which fires. Both correctly left alone.
- **Jared Kapler's compact** keyed off a training-run assignment that cannot
  occur, so it could never be satisfied or breached. Now keys off leading
  Optimisation & Scaling. Note the schema's `assignmentKind` variant requires
  `assignmentTag` alongside it; `assignmentDomain` is the single-field form.
- **Unassigned researchers** fall back to the least generous authored mode, so
  assigning someone is never a downgrade.

Pacing consequence, deliberate: the rollout ledger lost three world-firsts and
a rediscovery. Those four polymaths had been concentrating ~1.19 on a single
programme instead of 1.12 plus 1.06 across two, so the lab was scoring off the
double-apply. This moves research pace in the direction section 1 wants.

**Dead targets: done.** Nine were real, all of them one-time grants used as
standing passives -- seven on `lab.politics.governmentTrust.starting`, two on
`lab.culture.safety.starting`, one of those authored `add 0`. Both now resolve
to standing floors (`lab.politics.governmentTrustFloor`,
`lab.organisation.safetyCultureFloor`): trust is pulled up a point a week and
stops exactly on the floor, and neither ever pulls a lab down.

Floors rather than targets on purpose. The existing `*Target` modifiers resolve
against the CURRENT value, so `add 4` means "aim four above wherever you are",
a treadmill that climbs to 100 and never settles. Fine behind the time-limited
event nudges that use it (`durationWeeks` 39 and 52), wrong behind a permanent
researcher. If you add more standing content here, use a floor.

The other four were a false positive in the sweep that found them, which only
matched string literals in `CONSUMED_TARGET_LITERALS`:
`lab.training.frontier.duration` and `.cashCost` are built at runtime by
`trainingModifierTarget`, and `lab.research.domain.<x>.weeklyVarianceWidth` is
handled explicitly in `research.ts:112-131`. All live, all unchanged. Any
future sweep has to account for runtime-constructed targets or it will keep
reporting these.

**Display: done.** Three surfaces derived a researcher's contribution three
different ways -- the dossier from authored strength, the roster panel from
live modifier records, and the roster card list from a third view on top of
those. A four-week ramping signature advertised x1.09 and then showed x1.022
on hire, and the generic per-skill-point lead bonus (up to 15%) appeared
nowhere.

`quoteResearcherBenefits` in `researchers.ts` is now the single source. It
walks the same `abilityEffects`/`runtimeTarget` path the modifier builder
uses, so rows match what the sim applies, and every row carries both
`currentValue` and `fullValue` plus an explicit `inactiveReason`. One
`BenefitBreakdown` component renders it in both surfaces.

If you add a people surface, render `profile().benefits` -- do not derive a
fourth view from `activeModifiers`.

## 4a. Training-run redesign (DONE)

Scale stopped being an input. The player commits FLOP/s and weeks; the band name
is derived from what they add up to. Landed across five commits; see game-design
35.2 for the mechanic. What a future change most needs to know:

- **Do not reintroduce era-relative units into the simulation.** Band thresholds
  (era-GPU-weeks) are the only one left and are display-only. The old
  `minimumEraGpuEquivalents` floors meant a "Product run" silently required
  1,400x more compute on Kolmogorov hardware than on Kepler.
- **`lab.compute.workloadThroughput` is resolved once**, in
  `fleetThroughputMultiplier`, and folded into the per-GPU rating. Do not
  multiply it in at a consumer; that is how one authored effect came to mean
  three different things depending on who read it, while the FLOPS shown to the
  player used none of them.
- **Anything that shortens a run weakens the model.** Total FLOP is commitment x
  weeks, so `lab.training.frontier.duration` was retired: five authored effects
  labelled as benefits were removing compute. "Faster training" means throughput.
- **The reliability forecast and the failure check share
  `trainingCheckpointOdds`.** If you change one, the other moves with it. A
  readout that drifts from the sim is worse than none.
- **Risk is keyed to stretch against the lab's own best run**, never absolute
  size, or the endgame becomes unplayable. Experience and capability are
  deliberately small (2 and 10); at 5 and 20 every endgame run pinned the 0.95
  clamp and scale carried no risk at all.
- **Save version is 5.** Three field removals each needed a migration, all of
  which shipped broken first: a key deleted from a `.strict()` schema without a
  bump makes every existing save fail to load rather than upgrade.

Open: the balance sweep has not been re-run since. The three long-horizon pins
in `balance-runner.test.ts` were already red before this work (verified against
d25a6c4 in a worktree) and are unrelated, but the pacing numbers behind them are
now stale for a different reason.

## 5. Older backlog

- **Balance-runner solvency — diagnosed, NOT fixed.** The old note here blamed
  the fundraising rule. That is wrong and now stale: `needsFunding` already
  raises against runway, and the cash curve shows raises landing.

  The real chain, measured over 1,857 policy weeks with a horizon sweep:

  1. GPU purchases are gated on facility capacity (`gpu-market.ts:103`,
     `projectedOwnedPhysicalGpus <= supportedOwnedGpuCount`).
  2. Capacity comes from facilities, which are MAJOR PROJECTS competing for the
     same slots as training runs. A lab that always has a run going never frees
     a slot for a data centre.
  3. `buy-gpus` was purchasable in only 18.5% of weeks and a facility offered in
     18.6%; the fleet stayed at exactly 2,000 cards for entire games while
     frontier capability DECAYED from 8.9 to 2.2.
  4. Compounding it, cash sits at 5-15m against a 24-40m reserve that GROWS with
     burn (`effectiveReserveMillions`), so from about week 50 every discretionary
     purchase is blocked -- including the 2m Server Rack that would unlock the
     0.9m-per-thousand GPUs. The reserve protects the lab by forbidding the only
     investments that could make it solvent.

  Three fixes were tried and reverted after measuring no effect: buying compute
  on a busy week rather than only an idle one; letting compute spend into a
  fraction of the reserve (slightly WORSE, 3197 -> 2989 ticks); and yielding the
  project slot to a data centre when the shed is full. The last does nothing
  because when the shed is full no facility is offered either.

  What did work: removing the obsolete pre-2016 compute embargo (`f41f5cf`),
  worth +66% total ticks survived and the first endgame the sweep has ever
  reached.

  **The instrumentation has now been done**, capturing validation rejection
  reasons for capacity facilities during weeks when the shed was full:

  | count | reason |
  |---|---|
  | 146 | `server-rack: Facility already completed` |
  | 145 | `data-centre-1: Requires Power and Cooling I` |
  | 146 | `data-centre-2: Requires Data Centre I` |
  | 88/134/146 | `data-centre-1/-2/-3: Insufficient cash` |

  So it is neither slots nor policy gates. It is the shape of the capacity
  ladder:

  | step | cost | capacity |
  |---|---:|---:|
  | Server Rack | 2m | 4,000 — already built at game start |
  | Power and Cooling I | 7m | **0** |
  | Data Centre I | 20m | 30,000, requires Power and Cooling I |

  Passing 4,000 GPUs costs **27m across two major projects, the first granting
  no capacity at all**, against cash that never exceeds ~15m. A partial
  investment is entirely wasted, so there is no incremental path: the lab must
  bank 27m while burning, which it never does.

  **The economy half is fixed.** Server Hall (8m, 12,000 capacity, no
  prerequisites) now sits between Server Rack and Data Centre I, so the ladder
  reads 2m/4k, 8m/12k, 20m+7m/30k and the cost per 1,000 GPUs of headroom rises
  0.50 -> 0.67 -> 0.90. There is an incremental path where there was a 27m cliff
  with a dead 7m intermediate.

  **The policy half is NOT fixed and is now the binding constraint.** Adding the
  rung did not move the sweep at all, because the bots never reach the cliff:
  capacity is already 4,000 from the starting Server Rack while the fleet sits
  at 2,000, and a 1.8m order for 2,000 more was valid and affordable in 18.5% of
  weeks and never taken.

  Five policy changes have now been tried and reverted after measuring no
  effect: dropping the idle-week gate on purchases; spending into 40% of the
  reserve; yielding the project slot when the shed is full; and judging compute
  against a flat 5m working floor instead of the 24-40m panic reserve (3197 ->
  3037 ticks, slightly worse). The reserve arithmetic alone is damning -- a 1.8m
  purchase is refused because the 12.2m left over is not 35m -- but fixing it
  changes nothing, which means the buy-gpus code paths are not being REACHED.

  Next step, and do this before touching another gate: instrument the DECISION,
  not the availability. Log which branch of `decide` returns for each week and
  which candidate it selects. Every attempt so far has assumed the GPU branch is
  evaluated and blocked; the evidence says it is skipped.
- **Human playtest.** Nothing since several large systems landed. The only
  thing that distinguishes "hard" from "broken".
- **Coalitions** are disabled behind `TODO(coalition-redesign)` with skipped
  tests, an unreachable ending and an inert tick step. **Rival diplomacy** has
  one skipped test. Both need a redesign-or-delete decision from Brendan.
- **Historical FLOP scale (open question).** The starting rack is 2,000 GPUs;
  real AlexNet was ~2 GPUs / 5e17 FLOP. Week one is already GPT-2 scale in
  2012. If the numbers should read as historically plausible, the lever is the
  starting fleet and datacentre ladder, not the capability formula.
