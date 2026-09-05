# People page — desiderata

What must be true of every researcher, ability, effect and promise. Written to be
verified and fixed by someone who did not write the current content.

Each item states the property, then **how to check it**. The checks matter as much
as the properties: nearly every defect listed here passed the guards that already
exist, because those guards test the wrong thing. In particular
`packages/sim/src/engine/consumed-targets.ts` records **that** a target is
consumed but not **which source kinds** the consumer accepts, so an effect can be
"registered", "consumed", rendered in the dossier, and still read by nothing.

**The one rule behind all of it:** if the dossier says a researcher does
something, the simulation must actually do it, at the magnitude shown, on the
scope named. A player must be able to act on what they read.

---

## 1. Every effect must actually fire

**1.1 No effect may be discarded by its own consumer.**
Some targets are read with `excludeSourceKinds: ["researcher"]`. Content authored
by a researcher on such a target is stored in `state.modifiers`, rendered in the
dossier, and never read.

Check, for every distinct target used by any researcher: find the consumer, and
confirm it does **not** exclude researcher sources — or that a companion
`resolveResearcherStack` reads *the same string*. A companion reading a
*different* string does not count; that was the live defect for
`lab.training.technicalFailureHazard`, where 8 researchers once paid nothing while
3 on an alias worked, and both rendered the same label.

**1.2 No target may be authored that nothing consumes.**
Grep for the exact string in `packages/sim`, and also for dynamic construction
(template literals). Known dynamic builders: `trainingModifierTarget`,
`programmeModifierTarget`, and the domain-variance form in `research.ts`.

**1.3 No `.starting` grant may be used as a standing effect.**
Targets ending `.starting` are one-time grants applied at game creation
(`GRANT_TARGETS` in `create-new-game.ts`). On a researcher hired in week 200 they
do nothing at all. If a researcher should raise a standing value, it needs a
standing target — a floor or a target the sim re-reads each tick.

**1.4 Every authored array must have a code path that applies it.**
`compact.fulfilmentEffects` was shipped into the bundle by the compiler and read
by nothing, so compacts were pure downside: breaching cost morale, loyalty and
departure pressure while keeping the promise paid nothing.

**Verification that works, and the only one that does:** hire the researcher into
a fresh game, sync ability modifiers, resolve the target, and assert the value
**moves**. See `packages/sim/src/training/__tests__/revived.test.ts`. Asserting
that a target appears in a registry proves nothing.

---

## 2. No duplicated bonuses

**2.1 A researcher's signature and passive must not land on the same runtime
target.** Compare targets **after** `runtimeTarget()` translation, not as
authored. Two different authored names can resolve to one target — that was true
of `assignedTrainingRun.workloadThroughput` and `lab.compute.workloadThroughput`,
which produced two dossier rows, two labels, one mechanic.

**2.2 Two abilities must not be two helpings of one idea.** Even on distinct
targets: a researcher whose signature and passive both raise compute throughput
is thin design. The second ability should reach a different lever — cash,
schedule, risk, morale, aura, evaluation quality, diffusion.

**2.3 A named-area effect must not duplicate the researcher's other area.** When
assigning areas, check what the researcher **already** has, not just what is being
replaced. Nine duplicates were created by a conversion that checked only the old
target.

**2.4 Alternative modes are not duplicates.** An ability with
`mutuallyExclusiveModes` fires exactly one mode. Do not merge or flatten them —
and never apply a blanket value change across modes, which silently deletes the
distinction between them. If two modes end up with equal values, the choice is
dead.

**Check:** for each of the 106, build a map of runtime target → [abilities that
hit it]; any entry with more than one distinct ability is a finding. Exclude
modes of the same ability.

---

## 3. Compute bonuses are GPU throughput bonuses

**3.1 There is exactly one compute lever: `lab.compute.workloadThroughput`.**
It is resolved once in `fleetThroughputMultiplier`
(`packages/sim/src/compute/flops.ts`) and folded into the per-GPU FLOP rating.
Nothing else may multiply compute anywhere.

**3.2 It is fleet-wide, and must be priced as such.** It reaches training,
research output **and** serving. A value authored as if it were training-only is
worth roughly three times what its author intended. This has caused two separate
mispricings.

**3.3 No target may name training, inference or a run as its scope.** There are no
training-run assignments. Any target called `assignedTrainingRun.*` or
`lab.training.*Effectiveness` is either dead or lying about scope. Both were
retired; do not reintroduce the pattern.

**3.4 Nothing may multiply the capability formula's scale term separately.**
Throughput already raises total FLOP, which is what `scaleScore` is computed
from. A second multiplier there double-counts.

**Check:** grep for any target containing `throughput`, `compute`, `flop`,
`effectiveness`; there must be exactly one, and one consumer.

---

## 4. Values must be sensible

**4.1 A bonus to a specific research area maxes at +5%.** It stacks openly with
the generic lead bonus, knowledge diffusion, facilities and events — that layering
is intended and visible. The +5% is the researcher's own contribution, not the
total.

**4.2 Fleet throughput: single effects x1.02–x1.06; no researcher above x1.08
total.** Rationale in 3.2 — it is three levers at once.

**4.3 Every value must sit in its target's established band.** Collect the
distribution across all 106 before authoring; a value far outside its peers is a
finding unless the researcher's rank justifies it.

**4.4 `add` on a target resolved with base 1 is a multiplier in disguise.**
`add 4` against base 1 is **x5**, not +4%. This has shipped twice. For every
`add` effect, find the consumer and confirm the base it resolves against.

**4.5 Check the operation before computing any combined value.** Multiplying
`add` values produces nonsense — an audit pass reported x24 for what was +10.

**4.6 There are no stacking caps, deliberately** — they were hidden mechanics and
were removed. Nothing bounds a stacked roster except the authored numbers, so the
numbers must be right on their own. The roster cap is 8.

**Check:** for each target, compute what the 8 strongest researchers stack to.
State that number. If it exceeds roughly one GPU generation's worth of benefit,
it is too high.

---

## 5. Effects name a real, specific thing

**5.1 Every target has a human label.** No target may fall through to the
humanised path dump (`"Lab · Compute · Owned Power Cost"`). Twelve did.

**5.2 The label must be true.** It must name the actual scope and the actual
consumer. A label invented to paper over a misleading target name is not a fix —
rename the target.

**5.3 Effects name a specific area, never "whatever they lead".**
`assignedProgramme.researchOutput` and `pairedProgramme.researchOutput` floated
with the assignment, so 98 researchers rendered one identical line and every one
stacked on the generic lead bonus, which follows the same assignment. Each
researcher now boosts a **named** area whether or not they lead it.

**5.4 The named area must match the person.** These are satirical portraits of
real researchers. Choose from identity, epithet, biography and the ability's own
label — not from the maximum skill value. A max-with-alphabetical-tiebreak put 37
of 106 on one area and would have labelled a continual-learning roboticist an
interpretability researcher.

**5.5 The generic lead bonus must be labelled as such.** A lead earns 3% per
matching skill point on their programme (there is no hidden cap). It currently renders without
saying it is the baseline every lead gets, so it reads as another researcher
bonus. Render it as the **Baseline programme lead bonus** and explain that every
programme lead receives 3% per matching skill point.

---

## 6. Promises must make sense and be achievable

**6.1 The promise's requirement text must describe what to do.** Use the
`requirement` string, never the `label`. Krizhensky's dossier says
`Complete "Two GPUs and a Benchmark" work` — a nickname referencing AlexNet's two
GTX 580s — above a requirement about maintaining a vision project. They read as
unrelated because one is a title and the other is the task. Promise work and the
dossier now lead with the authored requirement; the epithet remains flavour.

**6.2 Every researcher has one binary promise.** A promise has exactly one
authored condition and is either met or not met. Compound `all`/`any` checks,
multi-tag choices, waivers and alternative fulfilment routes are not permitted.
The dossier renders the requirement, status, progress and sole fulfilment action
inside one panel.

**6.3 Displayed costs must come from the project, not a hardcoded string.** The
promise panel reads its duration and cash cost from the same project quote used
by command validation.

**6.4 Every check must be satisfiable.** Assignments are **lead-only** on a
capability or safety programme. Any check referencing `training-run`,
`productisation`, `research-council`, `safety-director`, or an `assignmentTag`
for those, can never be met. Those obsolete promise variants have been removed
from the schema; `assignmentDomain` is the sole direct assignment condition.

**6.5 A promise must be worth keeping.** Breach costs 20 morale, 10 loyalty, 15
departure pressure, a 22-point compact penalty and a transfer lock. Fulfilment
must pay something.

**Check:** for each of the 106, read the compact's `requirement`, `check` and
`cadence`, and state how a player satisfies it from a normal mid-game position.
If that cannot be written in one sentence, it is a finding.

---

## 7. Process requirements

**7.1 Never bulk-edit content by regex.** Three regressions today came from
transforms applied across many effects without inspecting what each was attached
to — including flattening two alternative modes to identical values, and
recreating nine duplicates immediately after fixing seventeen.

**7.2 Verify the result, not the transform.** "It compiles" and "tests pass"
proved nothing in every case above, because nothing tested the property that
broke.

**7.3 Every fix needs a test that would have caught the original defect.** Not
that the target is registered — that the value **moves** when the researcher is
hired.

**7.4 Reviving a dead effect changes balance.** Eight revived hazard effects
stacked to x0.308 checkpoint difficulty, which would have made training
essentially unfailable. Revive and retune in the same change.

---

## Current state

The 2026-07-29 roster audit applies this contract to all 106 researchers:

- every authored effect is consumed by the simulation and moves its live value;
- signatures and passives have no duplicate runtime target;
- every named-programme modifier is at most +5%, and compute uses the sole
  workload-throughput lever within its authored band;
- the standard programme-lead contribution is labelled separately and has no
  hidden cap;
- every researcher has one binary, achievable promise with one fulfilment
  action and a non-zero reward;
- the People view uses human labels and a single promise panel; and
- deterministic portrait traits cover all 106 current profiles.

The roster-integrity regression test hires every researcher at full ramp,
materialises every authored modifier, and verifies that each one changes the
resolver output the game consumes.
