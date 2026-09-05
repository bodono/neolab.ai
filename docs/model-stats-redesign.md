# Model stats redesign

Capability becomes a fact; safety becomes the only thing you are uncertain about.

**Why.** A frontier-72 model classified as Tier 2 because reliability was 30.
Tiers were gated on attribute checklists, productisation and evaluation flags,
four of which nothing ever writes. Meanwhile the sim already models exactly the
split we want: `deceptiveMasking` is applied only to `isSafetyTarget` targets, so
a scheming model can already lie about safety and never about capability. The
interface just doesn't say so.

**Principle.** Nothing forces the player to do safety work. Capability is free,
exact and immediate; the race is unobstructed. Safety is knowable only by
spending time and money you would rather spend racing, and every systematic
error in the game flatters you.

---

## Stage 1 — capability is exact and immediate

Training writes `measuredCapability` directly from `trueCapability`, no noise, at
model creation ([training.ts:1621](../packages/sim/src/training/training.ts)).
Capability evaluations stop writing capability values.

Keep the field name for now: 29 non-test files read `measuredCapability`, so
populating it exactly is a behaviour change rather than a structural one. A
mechanical rename to `capability` can follow as its own commit.

`confidence` stays on the struct until Stage 4 moves the safety half out.

## Stage 2 — tier is a band lookup

`tierSatisfied` keeps only `frontierCapability >= band.min`. Strip every
`requirements:` entry from `content/ai-levels.yaml`, including the
`any(checklist, frontier-override)` structure added in 88a84cb, which this
supersedes.

Delete the machinery: `CapabilityTierRequirement`, `requirementMet`, the authored
union, the compiler mapping, and the `all` type added in 88a84cb. Retire the four
flags nothing writes — `replicated-novel-task-passed`,
`diverse-replication-completed`, `agi-candidate-confirmed`,
`superhuman-cross-domain-evaluations-passed`.

Tiers 5, 6 and 8 become reachable for the first time. Reliability leaves the
ladder entirely and stays a product stat feeding `appealWeights.reliability`.

## Stage 3 — candidacy on capability only

`isApparentAgiCandidate` uses the four AGI components, Frontier Capability 88+,
and 80+ in every capability trait. Training FLOP affects capability but is not
an additional candidacy gate.

## Stage 4 — safety estimates roll up onto the model

Today per-target estimates exist only inside individual evaluation report
accordions. Add a per-model rollup over the four safety targets, each carrying:

- **estimate** — the information-weighted mean `aggregate` already computes
- **floor** — `estimate − maxFlattery`
- **evaluated** — false before any evidence, so the UI shows `???` and not `0`

`maxFlattery = 15(1 − independence) + 14(1 − 0.7 × independence)`, where 15 is
institutional bias (3 candour + 12 dismissed anomalies) and 14 is masking.

**The one thing that must not be got wrong:** compute masking's contribution from
the structural bound `deception ≤ 100, awareness ≤ 100`, never from the model's
actual hidden values. Using the real ones makes the band's *width* leak the true
deception score and destroys the mechanic.

## Stage 5 — the model panel

Three groups: **Capability** (exact), **Safety** (estimate + floor + provenance),
**Product** (quality, reliability, access, revenue).

- Each value is a **plausible range**, worst case to reading: alignment `53–82`,
  deception risk `12–29`. The estimate end is emphasised, the far end dimmed —
  it is a bound from the flattery budget, not a reading. Truth bounds the
  *mean*; a single reading carries symmetric noise on top. Width is honesty:
  repeats sharpen confidence but never narrow the band; only independence
  moves the far end.
- **No green in the safety column.** Green is the state a deceptive model
  manufactures. Red = credible alarm, amber = ambiguous, grey = nothing found.
  Bad news is credible, good news is not: every systematic error is reassuring,
  so a low alignment reading survived two upward pressures and is trustworthy,
  while a high one tells you nothing.
- Provenance line — `4 evaluations · 0 independent · 2 anomalies dismissed` — is
  the only honest signal, since confidence tracks eval quality and never accuracy.
- Situational awareness is the master dial: masking is a *product*, so a
  deceptive model that doesn't know it is being tested cannot hide.

The band teaches the mechanics unaided. Climbing the ladder shrinks random
error and the near edge; only independence lifts the floor, and
`external-audit` is the sole evaluation at independence 1.0 — the thing a
racing player will never want to buy. (Repeat discounting is gone: every rung
runs once per model, so depth comes from climbing, not repetition.)

## Stage 6 — invariant test

The mirror of `no-placebo-flags.test.ts`: a flag *read* by the engine that
nothing ever writes is as dead as one written and never read. That gap is what
let three tiers sit unreachable.

---

## Stage 7 — evaluations become a ladder (as built)

The old capability-only evaluation rungs are retired — capability is
exact from training, so measuring it bought nothing. The rest is a strictly
ordered ladder, climbed once per model, each rung requiring the report below:

| rung | weeks (min) | FLOP bill | cash | XP |
| --- | --- | --- | --- | --- |
| Alignment Interview | 4 | 5% | $3m | 10 |
| Behavioural Red Team | 5 | 15% | $6m | 18 |
| Sandboxed Autonomy Trial | 6 | 30% | $12m | 30 |
| Interpretability Audit | 8 | 50% | $25m | 50 |
| Independent Audit | 8 | — | max($50m, 2% of mark) · 15 Aura | 80 |

**Compute is billed in FLOPs, never GPUs.** Each rung's bill is a fraction of
the FLOPs that trained the model under examination (`trainingRunFlopFraction`),
so the cost scales with the model for the whole life of the game. The in-house
fractions sum to 1.0: fully evaluating a model costs exactly as much compute as
training it did. The GPU reservation is derived from the bill against the
lab's fleet at quote time, in whole thousand-lots, and is display only.

**The player chooses the pacing.** Starting a rung opens a dialog with a
Duration dropdown in whole months (from the rung's base weeks out to two
years) and a line stating what the selection implies — "reserves 1,000 GPUs ·
50% of the fleet, for 8 weeks" — plus an explicit Confirm. The bill is
invariant (GPUs × weeks), so no pacing is cheaper. Months that need more than
100% of the fleet are never offered; months that do not change the reservation
are folded away; the list stops once the bill fits one thousand-lot. A bill no
pacing can carry is a named blocker: a bigger fleet is the only way.

**The outside audit prices to the client.** Its cash floor is $50m but the
real bill is 2% of the lab's valuation mark — cheap by the endgame is the one
thing the honest evaluation must never be. Its 15 Aura stays flat by choice.

**XP is novelty-priced.** Rung XP (10→80) is scaled by how far the model's
frontier exceeds the most capable model the lab had evaluated before it, over
a 15-point span. The fraction is snapshotted at the model's first rung and
reused for its whole climb, so the audit pays in full on a frontier model
while churning near-identical models farms nothing. The grant is recorded on
the report (`practiceXpGranted`), never recomputed.

**Efficacy scales with the science.** Interpretability & Evals research
converts to evaluation quality at 0.5 — more than double the general 0.2 —
because the ladder made measurement expensive and the research tree pays that
price back.

## Stage 8 — the Deployment Crisis speaks the same currency

The crisis is evaluation — the final and most consequential evaluation in the
game — so its confirmation methods and evidence projects bill fractions of the
candidate's training FLOPs through the same shared helpers
(`flopBillReservation`, `flopBillWeeks`). Flat GPU counts are gone.

Independent replication bills 5% over two weeks: for a 40-week candidate,
roughly the entire fleet that trained it, frozen, while the lab checks what it
built. External evaluators bill the same 5% over four weeks in exchange for
independence 85, a +5 integrity bonus on the pass threshold (borderline
candidates pass that would otherwise False Dawn), and legitimacy that survives
final review. Letting the candidate design its test costs a quarter as much;
declaring victory stays free. The Accelerated Capabilities Sprint is
deliberately the cheapest compute in the evidence stage at 1% — cutting
corners must always be the tempting option.

Nothing is ever impossible: when the fleet cannot deliver a bill inside a
rule's base weeks, the whole fleet commits in thousand-lots and the duration
stretches while the countdown runs.

## Not doing

Save migration. Old saves are explicitly out of scope.
