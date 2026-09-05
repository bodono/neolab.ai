# Funding conditions and board patience — placebo audit

Audited 2026-07-29, prompted by a player question about the term sheets on the
fundraising screen: *"Are these placebos or real effects?"*

**Answer: effectively all of them are cosmetic.** Ten of thirteen conditions
write a flag nothing reads. The other three move a stat whose only gameplay
consequence is one line of advisory text inside a collapsed disclosure element
in the endgame.

This is the same failure shape as the researcher ability audit — state that is
written, stored, rendered and read by nothing — but it is worse in one respect:
the conditions are *paid for*, so the placebos actively distort play (§3).

---

## Status

**All findings resolved.** §1–§4 below record what was found and are kept as the
reasoning behind the fixes, not as an outstanding work list. §6 is a follow-on
audit that the first fix provoked, and §5 is the only part still open.

| finding | resolved by |
|---|---|
| §1 ten placebo flag conditions | `e0e00d1` — replaced with real windowed modifiers |
| §1 thirteen missing follow-up events | `e0e00d1` — `followUpHook` retired |
| §1 obligations stuck at `pending-stage-5` | `e0e00d1` — no longer recorded; UI note removed |
| §2 board patience has no teeth | `e0e00d1` — parked under `TODO(board-patience)` |
| §3 condition premium rewards free terms | `e0e00d1`, `cac5f28` — 6% → 22%, conditions capped at 2 |
| §6 duplicate and chained targets | `5a2785d`, `cac5f28` |
| §5 guards against recurrence | `e197cae` — flag invariant added; `followUpHook` deleted |

---

## 1. The census

Every condition a funding offer can carry, from
`packages/sim/src/fundraising/fundraising.ts`.

| condition | kind | writes | verdict |
|---|---|---|---|
| `board-observer` | flag | `funding:board-observer` | **placebo** |
| `mission-covenant` | flag | `funding:mission-covenant` | **placebo** |
| `board-seat` | flag | `funding:board-seat` | **placebo** |
| `reserved-inference` | flag | `funding:reserved-inference-share` = 0.12 | **placebo** |
| `deployment-review` | flag | `funding:deployment-review` | **placebo** |
| `board-control` | flag | `funding:enhanced-board-control` | **placebo** |
| `deployment-deadline` | flag | `funding:deployment-deadline` | **placebo** |
| `preferred-compute-partner` | flag | `funding:preferred-compute-partner` | **placebo** |
| `reserved-inference-mega` | flag | `funding:reserved-inference-share` | **placebo** |
| `government-access-memo` | flag | `funding:government-access-memorandum` | **placebo** |
| `growth-expectations` | modifier | boardPatienceTarget −6 | near-placebo (§2) |
| `mega-growth-expectations` | modifier | boardPatienceTarget −14 | near-placebo (§2) |
| `strategic-patience` | modifier | boardPatienceTarget −10 | near-placebo (§2) |

**1.1 The nine distinct flags have zero consumers.** Grepped across
`packages/sim`, `apps/web` and `content/`. The only occurrence outside
`fundraising.ts` is one assertion in `fundraising.test.ts` confirming the flag
was set — a test that proves the write happened and nothing about the read.

**1.2 All thirteen follow-up events are missing.** Each condition carries a
`followUpHook` naming an event: `event.funding.board-vote`,
`event.funding.inference-call`, `event.funding.mission-covenant-review`, and ten
more. **None of them exist in `content/`.**

**1.3 Obligations are recorded and never resolved.** Accepting an offer pushes a
`FundingObligationState` with `status: "pending-stage-5"`. The schema also
allows `satisfied | breached | expired`; nothing in the codebase ever assigns
them. Every obligation ever created sits at `pending-stage-5` for the rest of
the run.

**1.4 The UI promises the follow-up anyway.** `fundraising-dialog.tsx`:

> "N accepted conditions recorded for future board and event follow-up."

There is no Stage 5. This is the game telling the player, in its own interface,
that something is coming which cannot arrive.

---

## 2. Board patience is nearly a placebo too

The three `modifier` conditions look real — they apply a genuine `add-modifier`
to `lab.organisation.boardPatienceTarget`, which is resolved every tick through
`ORGANISATION_TARGET_MODIFIERS` in `researchers/people.ts`. The value moves.

**But almost nothing reads the result.** Board patience starts at 70
(`content/balance.yaml`) and is written by events (±4, ±5, ±6, −12), crisis
stages (−2, −3, −5, −6, −10) and these funding conditions. Tracing every read:

| site | what it is |
|---|---|
| `endgame/resolution.ts:321` | **the only consumer that branches.** `boardPatience < 40` flips one advisor's recommendation between "deploy" and "restrict" |
| `events/frontier.yaml:104`, `events/operations.yaml:26` | `evidence:` entries — print the number on an event card, gate nothing |
| `researchers/promises.ts:36` | a registered metric accessor. **No researcher promise in content uses it** |
| `researchers/people.ts:199, 1268` | accessors and flag plumbing |
| `endgame/crisis-stages.ts` ×6 | writes, not reads |

**2.1 It is never compared against a threshold anywhere else.** No ending, no
board dismissal, no gate on fundraising, hiring or morale. The obvious mechanic
— patience reaches zero and the board removes you — does not exist.

**2.2 Even the one consumer is inert.** The `recommendations` list from
`resolution.ts` is mapped into `endgame-view.ts` and rendered by
`crisis-board.tsx` under `<summary>Committee recommendations</summary>`. Nothing
branches on a recommendation. So the full causal chain of a −14 board-patience
condition is: *one sentence changes, in the endgame, inside a collapsed
`<details>`.*

**2.3 The writes are detailed and deliberate.** Five distinct penalty magnitudes
in the crisis stages alone. This is a designed stat whose consumer was never
built, not an abandoned idea.

---

## 3. Why this is worse than inert: conditions are paid for

`fundraising.ts:675`:

```ts
const conditionPremium = 1 + shape.conditions.length * 0.06;
```

**Cash offered scales with the number of conditions attached, +6% each.** Since
the conditions are almost all fictional, the offers that *look* most demanding
are simply the best ones.

From the reported screen:

| offer | conditions | real cost | effect |
|---|---|---|---|
| Strategic Compute **$33.0m** | 1 | none | **+6% cash, free** |
| Commercial Growth **$31.5m** | 2 | −6 board patience (≈nothing) | +12% cash, near-free |
| Commercial Growth **$29.9m** | 2 | same | differs only by the random draw |

The dominant strategy is **always take the offer with the most conditions**, and
the mega-round tier is where this is most extreme: `government-access-memo`,
`preferred-compute-partner` and `reserved-inference-mega` are all free money.

This inverts the intended risk/reward and makes the choice between term sheets —
the entire point of the screen — a comparison of one random number.

---

## 4. Options considered

Recorded as written at the time. The outcome was 4.1, 4.2 and 4.3 together,
with 4.4 resolved as "park it" and 4.5 declined.

**4.1 Stop lying, today.** Delete the obligation note from
`fundraising-dialog.tsx`, or reword it to describe what actually happens. Drop
the `followUpHook` field or mark it explicitly unimplemented. Roughly an hour,
and the screen becomes honest without any balance change.

**4.2 Remove `conditionPremium`, or make it match reality.** While the
conditions are cosmetic the premium is a straight bonus for accepting nothing.
Either delete it or restrict it to conditions that carry a real cost.

**4.3 Convert the placebo flags into modifiers.** Several map cleanly onto
targets that already exist and are consumed:

- `preferred-compute-partner` → `lab.compute.acquisitionCost` or
  `lab.compute.ownedPurchasePrice`
- `reserved-inference-share` → `serving.gpusPerRequest`, or a cap on serving
  allocation
- `deployment-deadline` → a real deadline with a real consequence
- `board-seat` / `board-control` → they should mean something about board
  patience, but see §4.4 first

This keeps the flavour and makes the term sheet a genuine trade-off.

**4.4 Decide what board patience is for.** It is currently a well-instrumented
stat with no teeth, displayed to the player as though it matters. Either:

- **give it a consequence** — the obvious one is a board-dismissal loss ending,
  which would make every existing write meaningful at a stroke and give the
  fundraising conditions real weight; or
- **remove it**, and re-point the three modifier conditions at something live.

Leaving it as-is is the one option that should be ruled out: a visible stat that
absorbs penalties from a dozen systems and changes nothing teaches the player a
false model of the game.

**4.5 Build the Stage 5 follow-up events.** The most interesting and the most
work. The nine flags become event preconditions, which is plainly what they were
staged for, and the obligations gain a resolution path. Only worth starting
after §4.4 settles what a board can actually do.

---

## 5. Guard against recurrence — DONE

`engine/consumed-targets.ts` polices *modifier targets* — that is why the
researcher audit could be made systematic. **It does not police flags**, which is
why nine dead flags survived here.

**5.1 Extend the no-placebo invariant to lab flags.** DONE in `e197cae`:
`no-placebo-flags.test.ts` requires every literally-written flag to be read or
declared in `RECORD_ONLY_FLAGS`. It found two more dead flags immediately
(`politics:nationalisation-diverted-to-coalition`,
`politics:technical-standard-shaped`), both records written beside the ratings
that carry the actual mechanic, now declared rather than deleted.

Its limitation is documented in the file: it matches bare literals, so it cannot
see a flag written through a variable — which is how the funding catalogue did
it. That hole is closed structurally instead, by forbidding `kind: "flag"`
conditions outright. Verified by injecting a dead flag and confirming the
invariant fails; an invariant that cannot fail is itself a placebo.

**5.2 Check that every `followUpHook` names an event that exists.** Resolved by
deletion instead. Once conditions applied in full on acceptance, nothing wrote
the field, so guarding it would have meant maintaining a check for a value
nothing produced. `followUpHook` is gone from the condition and obligation
types.

**5.3 Treat "state is written" as proving nothing.** Both defects here pass
every existing test, because the tests assert the write. The check that matters
is whether the value changes an outcome — the same lesson recorded in
`people-page-desiderata.md` §1.

---

## 6. The overlap audit the fix provoked

Replacing the placebos meant authoring against real targets, and the first
attempt shipped a fresh defect: the mega strategic-compute offer paired
`ownedPurchasePrice +5%` with `acquisitionCost +6%`. Those two are **chained** —
`acquisitionCost` resolves against the output of `ownedPurchasePrice` — so it
charged **+11.3% on one GPU purchase** while presenting it as two unrelated
terms. Fixed in `5a2785d`.

That prompted a sweep of all 30 `resolveModifierValue` / `resolveResearcherStack`
sites, looking for the same shape.

**6.1 One functional duplicate — two names, one lever.**

```ts
const perRequest =
  resolve("serving.computePerRequest", 1).final *
  resolve("serving.gpusPerRequest",   1).final;   // identical base, clamp, scope
```

Mathematically indistinguishable, multiplied into the same divisor. The same
defect as the old `workloadThroughput` alias: two registry entries, two labels,
one mechanic. `computePerRequest` survives (content authored it);
`gpusPerRequest` retired in `cac5f28`.

**6.2 Chains — B resolves against A's output, so they multiply.**

| chain | status |
|---|---|
| `ownedPurchasePrice` → `acquisitionCost` | real, fixed in `5a2785d` |
| `market.acquisitionRate` → `publicAcquisitionRate` | the second had **zero authors**; removed in `cac5f28` |
| `lobbying.auraCost` → `coalition.auraCost` | deliberate surcharge on a subset of actions |
| `product.durationWeeks` → `firstProject.durationWeeks` | deliberate, documented in source |

**6.3 Nestings — A is a line item inside B's base.** `lab.costs.fixed` sums
salaries, engineering and ops payroll, facility operations, executive overhead,
GPU leases **and owned-GPU electricity**. So two targets live inside it:

- `lab.compute.ownedPowerCost` ⊂ `lab.costs.fixed`
- `lab.finance.executiveCostPerCycle` ⊂ `lab.costs.fixed`

Neither is wrong, but an effect on either compounds with an effect on the total,
and nothing warns an author. No offer pairs them; a test enforces that.

**6.4 The pattern.** Target *names* imply an independence the resolution chain
does not provide. `acquisitionCost` sounds unrelated to `ownedPurchasePrice`;
`costs.fixed` sounds like overheads rather than everything; `gpusPerRequest` and
`computePerRequest` sound like different quantities. **Only reading the consumer
tells you.** A registry of target names cannot express this, which is why §5.1
would not have caught any of it.

---

## 7. Current state

Every funding condition is a time-limited multiplier on a target the simulation
reads. Offers carry **0, 1 or 2** conditions and pay **+22% cash each**.

| condition | effect | window |
|---|---|---|
| Commercialisation push | research output −3% | 104w |
| Publication restraint | research output −2% | 52w |
| Preferred hardware vendor | GPU purchase price +5% | 104w |
| Procurement through partner | acquisition cost +6% | 52w |
| Aggressive scaling | owned power cost +7% | 52w |
| Reserved inference | compute per served request +6% | 52w |
| Investor reporting | all operating costs +4% | 104w |
| Revenue share | product revenue −4% | 104w |
| Exclusivity terms | demand ceiling −5% | 52w |
| Safety assurance regime | evaluation cash cost +12% | 104w |

Tests assert that every condition lands as a live expiring modifier, that none
sits on a researcher-only target (`resolveResearcherStack` passes
`includeSourceKinds: ["researcher"]`, so a system-sourced modifier there would be
silently discarded), that none targets the parked `boardPatienceTarget`, and
that no offer pairs an overlapping couple from §6.
