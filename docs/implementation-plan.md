# Neolab.ai — Staged Implementation Plan

> Status: Working plan, version 0.1<br>
> Companion documents: [Technical Design Document](technical-design.md) (TDD, v0.2) and [Game Design Document](game-design.md) (GDD, v0.7)<br>
> Authority: This document decides *order and granularity of work only*. The TDD remains authoritative for architecture and APIs; the GDD for game behaviour. If a task here conflicts with either, fix the documents first (TDD §1).

## How to use this document

This plan exists so that work can be interrupted at any point and resumed by someone (or some session) with no memory of the previous session.

### Resumption protocol

1. Read this section, then scan the stage list for the first stage whose **exit gate** is not fully checked.
2. Within that stage, find the first task marked `[~]` (in progress). If one exists, read its **Done when** list and finish the unchecked items.
3. If no task is `[~]`, start the first `[ ]` task in order. Mark it `[~]` before starting work.
4. When a task's every **Done when** item is verifiably true, change `[~]` to `[x]` and commit with the task ID in the message (e.g. `S2.4: cycle settlement + ledger reconciliation`).
5. Never begin a task in a later stage while the current stage's exit gate has unchecked items, unless a task is explicitly marked **(parallel-safe)**.
6. Record any deviation from the TDD, renamed API, or deferred sub-item in the **Decisions and deviations log** at the bottom of this file, in the same commit.

### Task state legend

- `[ ]` not started
- `[~]` in progress (at most one per stage; the resumption pointer)
- `[x]` complete and verified
- `[-]` intentionally skipped or superseded (must have a log entry)

### Conventions used by every task

- **Spec:** the TDD/GDD sections that define the behaviour. Read them before coding.
- **Where:** package paths per the repository layout (TDD §4).
- **Done when:** objectively checkable conditions. Prefer a command whose success is the check. Every simulation task's Done-when implicitly includes: `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass; no forbidden imports (TDD §4.1); no `any`/`@ts-ignore` in sim or content code (TDD §3.1).
- A task that adds sim state must update: Zod save schema, invariants (TDD §9.5), and the testkit builders (TDD §25.2) in the same task, not later.
- Balance constants are loaded from data with stable keys (TDD §26.4), never inlined in formulas.

---

## Stage 0 — Workspace and contracts (TDD Milestone 0)

**Goal:** every package builds, forbidden imports fail CI, and the architectural skeleton exists with zero game logic.

**Entry criteria:** none (first stage).

### Tasks

- [ ] **S0.1 — Initialise pnpm workspace and packages.**
  - Spec: TDD §4, §3.1.
  - Where: repo root; `apps/web`, `packages/content-schema`, `packages/content`, `packages/sim`, `packages/testkit`, `tools/content-compiler`, `tools/balance-runner`, `tools/save-inspector`.
  - Done when:
    - `pnpm-workspace.yaml` lists all packages; each has a `package.json` with `"private": true`, explicit `exports`, and no floating `latest` ranges.
    - `.nvmrc` (or `.tool-versions`) and `packageManager` field pin Node and pnpm.
    - `pnpm install` succeeds from a clean checkout; lockfile committed.

- [ ] **S0.2 — Strict TypeScript configuration and project references.**
  - Spec: TDD §3.1 (compiler options block).
  - Where: `tsconfig.base.json` plus per-package `tsconfig.json` using project references.
  - Done when:
    - All strict options from TDD §3.1 are enabled in the base config.
    - `pnpm typecheck` runs `tsc --noEmit` across all packages via references and passes on the empty skeleton.

- [ ] **S0.3 — Lint, format, and import-boundary enforcement.**
  - Spec: TDD §3.2, §4.1.
  - Where: root ESLint (type-aware) + Prettier config; restricted-import rules.
  - Done when:
    - ESLint bans: `sim` importing React/Zustand/browser APIs/`apps/web`; UI importing `sim/src/**` internals; `any`, non-null assertions, `@ts-ignore` in `sim` and content code.
    - A deliberate violation of each rule fails `pnpm lint` (write a temporary fixture to prove it, then delete it).

- [ ] **S0.4 — Test tooling.**
  - Spec: TDD §3.1, §25.1.
  - Done when:
    - Vitest runs in every package (`pnpm test` at root aggregates).
    - Playwright is installed in `apps/web` with a placeholder smoke spec that opens a blank Vite page (`pnpm test:e2e`).

- [ ] **S0.5 — Foundational shared types.**
  - Spec: TDD §5.3 (branded IDs), §5.4 (units), §5.6 (`assertNever`).
  - Where: `packages/sim/src/model/` (brands, units, helpers), `packages/content-schema/src/` (content ID types).
  - Done when:
    - `Brand`, `LabId`, `ModelId`, `ProjectId`, `ContentId`, `Tick`, `CashMillions`, `GpuCount`, `GpuWeeks`, `Rating`, and `Fraction` exist with validating constructors (`rating()`, `fraction()` etc.) that throw on invalid programmer input.
    - Unit tests cover boundary values (NaN, Infinity, out-of-range) for every constructor.

- [ ] **S0.6 — Empty content manifest and compiler walking skeleton.**
  - Spec: TDD §12.1–§12.4 (minimal subset only).
  - Where: `tools/content-compiler`, `content/manifest.yaml`, `packages/content/generated/`.
  - Done when:
    - `pnpm content:build` parses `content/manifest.yaml` (YAML 1.2, anchors/tags disabled), validates it with Zod, emits `content.bundle.json` with a hash, and fails with file/line diagnostics on malformed YAML.
    - `packages/content` exports `loadCompiledContent()` returning the (nearly empty) typed bundle.
    - Generated output directory is git-ignored or clearly marked generated; a CI step verifies it is reproducible.

- [ ] **S0.7 — CI pipeline.**
  - Spec: TDD §31.1–§31.2.
  - Where: `.github/workflows/ci.yml`.
  - Done when:
    - On every push/PR: install → content compile → lint → typecheck → unit tests → web production build → Playwright smoke (Chromium at minimum) → bundle-size report artifact.
    - The scripts named in TDD §31.1 exist in root `package.json` (those not yet meaningful may print "not implemented, see implementation-plan stage N" and exit non-zero only where CI does not yet require them).

### Exit gate (Stage 0)

- [ ] Fresh clone → `pnpm install && pnpm build` succeeds.
- [ ] Each forbidden-import category has a test or lint proof it fails CI.
- [ ] CI is green on `main`.

---

## Stage 1 — Deterministic kernel (TDD Milestone 1)

**Goal:** same seed/config/commands produce byte-equivalent canonical state; no gameplay yet beyond an advancing empty world.

**Entry criteria:** Stage 0 exit gate checked.

### Tasks

- [ ] **S1.1 — RandomOracleV1.**
  - Spec: TDD §10.1–§10.2 (follow the 11-step derivation exactly).
  - Where: `packages/sim/src/random/`.
  - Done when:
    - `uniform`, `integer`, `triangular`, `weighted`, `shuffle` implemented over SHA-256 (`@noble/hashes`) + xoshiro128\*\* with 8-draw warm-up, rejection sampling for `integer`, sorted candidates for `weighted`, Fisher–Yates for `shuffle`.
    - Golden vectors: ≥100 seed/key fixtures committed under `packages/sim/src/random/__fixtures__/`; a test regenerates and compares.
    - Property tests: uniformity sanity, integer bounds inclusivity, weighted zero-weight exclusion, invalid-weight rejection.
    - `randomContractVersion` constant exported and included in state.

- [ ] **S1.2 — Canonical `GameState` shell and serialisation rules.**
  - Spec: TDD §5.1, §5.2, §5.5, §7 (all subsections); GDD §31 for slice inventory.
  - Where: `packages/sim/src/model/`.
  - Done when:
    - `GameState`, `RunState`, `WorldState`, `LabState` (all named slices, may be minimally populated), `ModelState`, `ProjectState`, `EventInstanceState`, `ModifierState`, `ScheduledEffectState`, `EndgameState` exist as plain-data types.
    - A Zod schema validates the full state; a test round-trips `JSON.parse(JSON.stringify(state))` and deep-equals.
    - Deterministic ID counters per namespace (`run:model:player:0007` pattern), no UUIDs.
    - A recursive test asserts no `Date`, `Map`, `Set`, class instance, function, or non-finite number anywhere in a constructed state.

- [ ] **S1.3 — `createNewGame` and starting-state content.**
  - Spec: TDD §21.5 (`NewGameConfig`, application order), GDD §29.2–§29.7 (baseline table, mandates, five leaders/labs).
  - Where: `packages/sim/src/engine/`; content YAML in `content/labs/`, `content/leaders/` (extend compiler schemas as needed — leaders, labs, difficulties, mandates).
  - Done when:
    - Five leader + lab definitions and three mandates compile from YAML.
    - `createNewGame(config)` applies baseline → lab modifiers → leader modifiers → difficulty → mandate → seeded world generation, in that order.
    - Golden test: exact starting state snapshot for **each of the five leaders × Standard difficulty**, plus one per remaining difficulty (GDD §29.4 multipliers present in state or rules data).
    - Baseline numbers match GDD §29.2 table exactly (assert per-field, not only via snapshot).

- [ ] **S1.4 — Command shell and transaction.**
  - Spec: TDD §8.1–§8.3, §9.3–§9.4.
  - Where: `packages/sim/src/commands/`, `packages/sim/src/engine/`.
  - Done when:
    - `GameCommand` union exists with at least `SetGpuAllocationCommand` (placeholder handlers for the rest may be typed but rejected as "not yet implemented" via `CommandValidation`).
    - `validateCommand` / `applyCommand` implemented; `applyCommand` is atomic (test: a handler that throws mid-way leaves input state referentially untouched).
    - `SimulationTransaction` implemented with `read/update/applyEffects/emit/schedule/allocateId/commit`; `commit` runs invariants and (dev builds) freezes state.
    - `expectedTick` staleness rejection works (test).

- [ ] **S1.5 — Tick engine skeleton.**
  - Spec: TDD §9.1–§9.2, §9.5; GDD §30.3 (canonical order).
  - Done when:
    - `TickPhase` enum matches TDD §9.2 exactly; system registry sorts by phase → priority → system ID and rejects duplicates at startup.
    - `advanceOneTick` executes all phases with placeholder/no-op systems, advances calendar (week/cycle/quarter boundaries per GDD §28.1), emits a tick summary domain event.
    - Invariant suite from TDD §9.5 implemented as a callable pack; wired into `commit`.
    - Queued orders (S1.4) apply in `apply-orders` phase next tick (test).

- [ ] **S1.6 — Effects, modifiers, predicates, checks (core vocabulary).**
  - Spec: TDD §11.1–§11.4.
  - Where: `packages/sim/src/engine/` (executor, resolver), `packages/content-schema` (authored forms).
  - Done when:
    - `Effect` union + `EffectExecutor` with at least: `AddResourceEffect`, `AddRatingEffect`, `SetFlagEffect`, `AddModifierEffect`, `RemoveModifierEffect`, `ScheduleEffectsEffect`, `EndRunEffect`. Every switch ends in `assertNever`.
    - `ModifierState` + resolver with documented order (min/max → add → multiply → clamp) and `ModifierBreakdown` output; closed `ModifierTarget` registry; unknown target rejected at compile and runtime.
    - `Predicate` AST evaluator + `MetricRegistry` with a first metric set (cash, tick, ratings); no arbitrary path traversal.
    - `CheckDefinition` with the single shared logistic implementation (GDD §42.3: 10-point ≈ 73%, 20-point ≈ 88% asserted in tests) and clamping.

- [ ] **S1.7 — Save envelope, memory repository, replay hash.**
  - Spec: TDD §24.1–§24.2, §24.6.
  - Where: `packages/sim/src/persistence/`, `packages/testkit`.
  - Done when:
    - `SaveEnvelopeV1` write/load with checksum; `MemorySaveRepository` implements `SaveRepository`.
    - Deterministic state hash function (stable key ordering) exported for replay comparison.
    - Replay test: new game → 100 ticks with no commands → serialise → load → 100 more ticks, compared against an uninterrupted 200-tick run; hashes equal. Run for two different seeds and two leaders.

- [ ] **S1.8 — Testkit scenario builders (initial).**
  - Spec: TDD §25.2.
  - Done when:
    - `scenario()` builder produces valid states with safe defaults; `.atTick()`, `.withPlayerLab()` (cash/compute/rating setters) work; `build()` validates; `unsafeFixture()` escape hatch exists.
    - All Stage 1 tests that construct states use the builder (spot-check, refactor stragglers).

### Exit gate (Stage 1)

- [ ] Same seed/config/command-log ⇒ byte-equivalent canonical state (automated test, ≥2 seeds).
- [ ] Golden baselines exist for all five leaders and all four difficulties.
- [ ] RandomOracle golden vectors committed and green.
- [ ] CI green.

---

## Stage 2 — Ten-minute economy (TDD Milestone 2)

**Goal:** a player can survive or go bankrupt through legible decisions; forecast reconciles with settlement; first playable React shell with a real clock.

**Entry criteria:** Stage 1 exit gate checked.

### Tasks

- [ ] **S2.1 — GPU portfolio, workload throughput, allocation hierarchy, normalisation.**
  - Spec: GDD §32.1–§32.2; TDD §16.1.
  - Done when:
    - `calculateGpuThroughput` breaks out physical count, generation factor, availability, software, power and interconnect; reservations resolve before discretionary allocation; `normaliseAllocation` uses basis points (0–10 000) and largest-remainder integer-GPU rounding.
    - Unfunded-program rule (<200 physical GPUs/week ⇒ no progress, marked stranded) implemented where allocation is consumed.
    - Allocation invariants: sums within 1e-9 at each hierarchy level; property test over thousands of random allocations.
    - `SetGpuAllocationCommand` fully implemented (queued, applies next tick, >25-point domain swing penalty flag recorded for Stage 3 to consume).

- [ ] **S2.2 — Hardware market: buy, lease, deliveries.**
  - Spec: GDD §32.3; TDD §16.1 (`quoteGpuOffer`).
  - Done when:
    - The four default offers exist as content data; `PurchaseGpuCommand` quotes (generation, physical count, price, delivery, ongoing cost and relative training/serving throughput) and schedules delivery; deliveries land in the `deliveries` phase before allocation.
    - Owned vs leased tracked; lease recurring costs feed finance.

- [ ] **S2.3 — Finance ledger, forecast, cycle settlement, runway.**
  - Spec: GDD §33.1, §33.7; TDD §16.2.
  - Done when:
    - Every income/expense line is a ledger entry with stable category + source ID.
    - `forecastFinance` and `settleCycle` share rule functions; reconciliation test: opening cash + ledger entries = closing cash, asserted every cycle in a 3-year seeded run.
    - `calculateRunway` matches GDD §33.7 formula incl. `∞` display case; warning thresholds (12w, 4w) emit domain events; insolvency detection emits the auto-pause reason (emergency options are Stage 5 events; until then insolvency ends the run with a placeholder loss recorded in the log).

- [ ] **S2.4 — Minimal market: one segment, serving, revenue, satisfaction.**
  - Spec: GDD §33.2–§33.5 (Researchers + Start-ups segments only); TDD §16.3.
  - Done when:
    - Appeal formula, softmax share (player + placeholder static rivals), acquisition-rate lag, price tiers, delivered-vs-requested usage with shortage feedback (GDD §32.4), and satisfaction deltas implemented for the starting segments.
    - "Never profitable to serve undelivered usage" asserted by test.

- [ ] **S2.5 — Project framework + first facility.**
  - Spec: TDD §17.3–§17.4; GDD §31.5 (slots), §37.7 (catalogue — implement `Power and Cooling I` and `Data Centre I` only).
  - Done when:
    - `BaseProjectState`, `ProjectHandler` registry, slot accounting from Management Capacity, construction crew limit.
    - Construction completes → `FacilityInstanceState` + sourced modifiers; disabling facility disables its modifiers by source (test).

- [ ] **S2.6 — GameRuntime, clock, and Zustand bridge.**
  - Spec: TDD §6.1–§6.3, §21.1–§21.2.
  - Where: `apps/web/src/runtime/`, `apps/web/src/app/`.
  - Done when:
    - `BrowserGameRuntime` owns state; `AnimationFrameClockDriver` uses `performance.now()`, ≤4 ticks/frame, carries debt, honours pause; auto-pause reasons stop consumption and surface to UI.
    - Zustand store holds `GameView` snapshot + UI state only; a lint rule or review note bans game-mutation actions in the store.

- [ ] **S2.7 — `GameView` projection (economy slice) and hidden-state guard.**
  - Spec: TDD §20.1–§20.3.
  - Done when:
    - `projectGameView` covers top bar (finance/GPU fleet/Aura placeholder/date), GPU allocation view with physical-GPUs-beside-percentage values and generation mix, market view, project list.
    - `assertNoHiddenKeys(view)` recursive test guard implemented and wired into projection tests (hidden fields list starts now, grows later).

- [ ] **S2.8 — Playable economy shell UI.**
  - Spec: TDD §21.3, §21.6, §21.8; GDD §25.1–§25.3 (layout targets).
  - Done when:
    - Screens: minimal Title → New Game (seed/difficulty/leader pick, plain list is fine this stage) → GameShell with `TopStatusBar`, GPU sliders (basis points, keyboard steps, physical counts, commit-on-release), pause/speed controls, buy-GPUs dialog with quote preview from `validateCommand`.
    - A human can play: adjust serving vs R&D, buy compute, watch runway, hit bankruptcy or survive 3+ years.
    - Playwright: scripted run reaches both "survived 2 years" and "insolvency" outcomes deterministically with fixed seeds.

### Exit gate (Stage 2)

- [ ] Manual 10-minute session is coherent: costs visible before confirm, cashflow explains itself (TDD §32 M2 exit).
- [ ] Forecast/settlement reconciliation test green over long seeded runs.
- [ ] Replay determinism still green including purchases and allocation commands.
- [ ] CI green including new Playwright specs.

---

## Stage 3 — Research and model loop (TDD Milestone 3)

**Goal:** a complete seeded paper race and two model generations replay exactly.

**Entry criteria:** Stage 2 exit gate checked.

### Tasks

- [ ] **S3.1 — Research domains and weekly production.**
  - Spec: GDD §34.1–§34.3; TDD §14.1, §14.3.
  - Done when:
    - Eight capability domains + three safety programmes as content; `calculateDomainOutput` full breakdown; focus multipliers with 4-week cooldown; context-switch penalty consumes the Stage 2 flag; weekly variance via keyed draws.
    - Domain-level thresholds award generic advances (GDD §34.7) with player choice recorded as a command.

- [ ] **S3.2 — Paper graph, hidden thresholds, discovery, publication, diffusion.**
  - Spec: GDD §34.4–§34.6, §34.8; TDD §14.2, §14.4.
  - Done when:
    - `PaperDefinition` schema + compiler checks (weights sum to 1, prerequisite graph acyclic unless flagged, source URL format); ten real papers authored (per TDD §33.3 selection).
    - Hidden thresholds derived lazily from (seed, lab, paper) — test lazy == eager.
    - World-first resolution respects canonical order + run-creation shuffle; all four publication policies apply their effects; diffusion credit at 25/50/75/100.
    - Golden scenario: seeded two-lab paper race (player + one scripted rival stub) replays exactly.

- [ ] **S3.3 — Training pipeline.**
  - Spec: GDD §35.2–§35.4; TDD §15.2.
  - Done when:
    - `quoteTrainingRun` freezes recipe/duration/reservation/cash; three scales; dataset + safety-protocol choices; failure checks at 35/70/100% with logistic rule; capability generation per GDD §35.3 with draws keyed to the future model ID.
    - Regression highlighting data present in the completion report payload.

- [ ] **S3.4 — Hidden safety generation and capability tiers.**
  - Spec: GDD §35.1, §35.6, §36.3; TDD §15.1.
  - Done when:
    - `HiddenModelSafetyState` generated at training completion (four formulas + noise); excluded from public package exports (compile-time test: importing it from `@neolab/sim/public` fails).
    - `classifyCapabilityTier` selector over measured evidence only; tier definitions loaded from `content/ai-levels.yaml`; tier-change presentation event enqueued once per model/tier.
    - AGI-candidate criteria detection (GDD §35.6) sets the flag that Stage 7 will consume (until then it only logs + auto-pauses).

- [ ] **S3.5 — Evaluations, observations, anomalies.**
  - Spec: GDD §36.4–§36.8; TDD §15.3–§15.4.
  - Done when:
    - Baseline eval on training completion + the seven eval project types as content; observation = truth + bias + error + masking, error narrowing with Eval Quality; diminishing information on repeats (100/55/25/10).
    - Anomaly records with true vs observed severity; dismiss/investigate commands; three-unresolved-severe forced event hook (fires a placeholder critical event until Stage 5 authors the real one).
    - Weekly incident hazard check per GDD §36.7 with clamps; `isCatastropheCheckLegal` implemented and enforced (dev-throw / prod-convert per TDD §15.4) — with FC/access preconditions unreachable this stage, a forced-fixture test proves the gate blocks illegal catastrophes.
    - Calibration test batch: weak vs strong evidence mislabel rates within GDD §48.8 bands (coarse assertion, refined in Stage 9).

- [ ] **S3.6 — Productisation and deployment policies.**
  - Spec: GDD §33.4, §35.5.
  - Done when: internal/preview/guarded/open/weights policies with exposure values; productisation projects (normal/hardened/rush) adjust Product Quality/Reliability; deployment feeds market appeal from Stage 2.

- [ ] **S3.7 — Research & model UI.**
  - Spec: TDD §21.3; GDD §25.2, §34.3 (no exact progress bars), §34.9 (educational card).
  - Done when:
    - Research workspace: domain allocations with physical GPUs/week shown, focus picker, qualitative progress labels (`Speculative`/`Promising`/`Hot trail`/`Breakthrough imminent`) — no numeric completion bars (assert the view type cannot carry one).
    - Model workspace: model cards, training dialog with quote, eval reports with confidence labels, deployment policy control.
    - Paper discovery presentation: full educational card incl. real-world publication info and source link (opens `noopener,noreferrer`, domain shown).

### Exit gate (Stage 3)

- [ ] Seeded run: ≥2 model generations trained, ≥3 papers discovered (≥1 by the rival stub), one full publication-policy cycle each — replays byte-identically.
- [ ] Hidden-safety truth provably absent from `GameView` and screen-reader strings (guard test extended).
- [ ] CI green.

---

## Stage 4 — People, Aura, and facilities (TDD Milestone 4)

**Goal:** six stars, five facilities, hiring/poaching/dismissal, funding chains work.

**Entry criteria:** Stage 3 exit gate checked.

### Tasks

- [ ] **S4.1 — Researcher definitions, abilities, compacts (data + engine).**
  - Spec: GDD §37.2–§37.2.5; TDD §17.1.
  - Done when:
    - Full `ResearcherDefinition` schema incl. signature/passive/compact/availability; `AuthoredModifier` compilation; `syncResearcherAbilityModifiers`; signature 4-week ramp; advisor vs lead contribution (3%/1.5% per point, caps 15/7.5); stacking caps table from GDD §37.2.4 as registry rules with capped-away reporting.
    - Six launch researchers authored in YAML (pick from GDD §37.2.3; include at least one Research-Council-style institutional signature and one compact-required character).
    - Compact evaluation over rolling 13-week windows with warning → breach event hook.

- [ ] **S4.2 — Star slots, talent market, recruitment.**
  - Spec: GDD §29.3, §37.3–§37.4; TDD §17.2.
  - Done when:
    - Slot caps from facilities (hard max 8), `Unhoused` status; market refresh every 13 weeks with composition rules and availability waves; offer → `recruitmentStrength` → logistic acceptance with stored draw; improved-offer-after-4-weeks rule; one-employer invariant.

- [ ] **S4.3 — Morale, loyalty, burnout, promises, departures, poaching.**
  - Spec: GDD §31.4 (drift), §37.5–§37.6.
  - Done when:
    - Rating drift `newRating = old + (target-old)×0.015 + immediate` for org ratings and researcher states; promises as first-class records; quarterly departure checks with ultimatum-first rule; poaching signal chain (rumour → counteroffer window → resolution); knowledge-transfer on departure (20–60% of associated secret progress, delayed).

- [ ] **S4.4 — Aura economy.**
  - Spec: GDD §38.1–§38.2.
  - Done when: spendable Aura floor at zero, Lifetime Aura monotone, `Aura Signal` derived with 26-week spend recovery; all sources/sinks wired to existing systems (papers, launches, satisfaction, incidents).

- [ ] **S4.5 — Fundraising.**
  - Spec: GDD §33.6; TDD §16.2 (`generateFundingOffers`).
  - Done when: three campaign types as projects (Aura spent at start), funding score formula, generated offers with conditions as modifiers/flags, accept command; board-condition follow-up hooks recorded for Stage 5.

- [ ] **S4.6 — Facility catalogue and campus view-model.**
  - Spec: GDD §37.7–§37.8; TDD §17.4, §22.1.
  - Done when: all 15 initial catalogue entries as content; slot-unlock facilities; over-cap `Unhoused` flow; `CampusView` projection (facilities, construction stage, load state, cues) — DOM strip rendering may remain placeholder blocks.

- [ ] **S4.7 — People & campus UI.**
  - Spec: GDD §25.3 (portrait row), §49.2; TDD §21.3.
  - Done when: persistent star strip (portraits, assignment, morale warnings, vacant/locked cards), dossier dialog (bio, abilities, compact, contract), recruitment dialog with honest acceptance wording, dismissal confirmation with consequences; facilities panel with build buttons showing full costs; campus strip renders `CampusView`.

### Exit gate (Stage 4)

- [ ] Scenario test: hire 3 stars, trigger a compact warning and a breach, lose one star to scripted poaching, dismiss one, complete a Competitive Round — all consequences visible in decision log; replays exactly.
- [ ] Six stars + five facilities usable end-to-end from the UI.
- [ ] CI green.

---

## Stage 5 — Events, politics, and content compiler completion (TDD Milestone 5)

**Goal:** 25–35 vertical-slice events survive save/load; no event can illegally cause catastrophe; government behaves as a strategic actor.

**Entry criteria:** Stage 4 exit gate checked.

### Tasks

- [ ] **S5.1 — Event engine.**
  - Spec: GDD §43 (all); TDD §13.1–§13.5.
  - Done when:
    - Full `EventDefinition`/`EventInstanceState` schemas; eligibility → weights → suppression → pity ramp (2.2% base, +0.3/wk after 12, guarantee at 30) → deterministic weighted selection; mandatory trigger detectors as explicit rules; expiry with declared defaults; cooldown groups; precommitted option outcomes keyed per TDD §10.3; `DecisionMemory` records.
    - Token interpolation via typed tokens + ICU-style formatter; no raw string HTML.

- [ ] **S5.2 — Content compiler: full validation passes.**
  - Spec: TDD §12.3 (all 13 steps), §25.5.
  - Done when: reachability analysis for every option/outcome branch; probability-band coverage of `[0,1)`; localisation key/placeholder verification; release-blocking warning class (missing paper source, missing alt text, unreachable branch, ungated catastrophe effect); content report emitted; `pnpm content:check` green.

- [ ] **S5.3 — Vertical-slice event set.**
  - Spec: GDD §45 (author from the 26 examples), §43.8 (per-event test requirements).
  - Done when: 25–35 events authored covering every category in GDD §46 at least twice, including `ai.root_access_request` and `safety.unapproved_tool_call`; every event passes the §43.8 automated checklist; dynamic names resolve for all five labs (test matrix).

- [ ] **S5.4 — Politics and government.**
  - Spec: GDD §38.3–§38.5, §40.2; TDD §18.3.
  - Done when: four government values; quarterly `interventionPressure` with threshold consequences delivered as events (due process — no direct stat-jump interventions); lobbying projects; government segment unlock; nationalisation prerequisites (pressure ≥80 + trigger + failed response) enforced by rule, verified by forced fixture.

- [ ] **S5.5 — Delayed effects, decision log, autosave triggers.**
  - Spec: GDD §43.6, §15 (delayed consequences); TDD §24.3.
  - Done when: scheduled effects fire in `delayed-effects` phase quoting their origin; decision log traces every persistent modifier to source; autosave on cycle boundary + around critical events (memory repo; IndexedDB in S5.7).

- [ ] **S5.6 — Event UI and overlay discipline.**
  - Spec: GDD §15.1, §47.9; TDD §21.3 (`OverlayHost`), §23 (presentation queue).
  - Done when: decision dialog with evidence/known-costs/uncertainty preview from `EventOptionPreview` only; ordered `OverlayHost` (critical > discovery > urgent > user); notification levels incl. non-disableable critical auto-pause; feed panel with severity styling and expiry countdowns (direction unambiguous).

- [ ] **S5.7 — IndexedDB persistence + import/export + migration scaffold.**
  - Spec: TDD §24.2–§24.5.
  - Done when: `IndexedDbSaveRepository` with atomic slot-pointer writes; export/import with size limits and `unknown`-first parsing; save-version migration pipeline with a fixture test (v1→v1 identity now, structure ready); corrupt-save load fails gracefully to title screen.

### Exit gate (Stage 5)

- [ ] Save/load mid-event preserves options, tokens, and precommitted outcomes (automated).
- [ ] Full event branch-coverage report: zero unreachable branches without `manual-only` justification.
- [ ] Forced-fixture proof: no authored event can emit a catastrophe without `isCatastropheCheckLegal`.
- [ ] CI green.

---

## Stage 6 — Rivals and coalition (TDD Milestone 6)

**Goal:** headless runs produce credible multi-lab races with no rubber-banding.

**Entry criteria:** Stage 5 exit gate checked.

### Tasks

- [ ] **S6.1 — Rival state and utility policy.** (Spec: GDD §39.1–§39.3; TDD §18.1–§18.2.) Done when: four rivals instantiated from lab definitions; one weighted-utility policy with data personalities; quarterly plan selection with top-3 logging; weekly command generation through the same command shapes; no read access to player hidden state (type-level + test).
- [ ] **S6.2 — Rival research/market/talent participation.** (Spec: GDD §39.3, §37.6, §33.2.) Done when: rivals accumulate real paper progress against real thresholds, poach via the Stage 4 chain, participate in the single-pass market settlement (TDD §16.3), and generate public signals (releases, hires, benchmarks) with estimate error driven by intelligence quality.
- [ ] **S6.3 — Rival incidents, containment of failure, diplomacy actions.** (Spec: GDD §39.4, §39.6.) Done when: rival high-severity failures convert to the allowed consequence set (never extinction); relationship state per rival; player diplomacy actions (collaborate, standards, non-poach, share incident info) as commands/events.
- [ ] **S6.4 — Rival candidate countdown and Race Emergency.** (Spec: GDD §39.5, §18.1.) Done when: hidden 26-week-base countdown with modifiers; player-visible range estimate narrowing with intelligence; Rival Ascendance loss ending wired; Race Emergency event authored.
- [ ] **S6.5 — Coalition groundwork systems.** (Spec: GDD §14.1, §41.3–§41.4; TDD §18.4.) Done when: `CoalitionState` lifecycle proposal→ratification; shared protocol/verification ratings raised by projects (incl. `coalition.inspection`-style events from Stage 5 set); hard prerequisites of GDD §41.3 encoded as an eligibility selector (readiness is never a stored boolean).
- [ ] **S6.6 — Balance runner v1.** (Spec: TDD §26; parallel-safe once S6.1–S6.2 done.) Done when: `runBalanceBatch` executes ≥1,000 seeded runs headless in CI-nightly time budget; policies: balanced, capability-first, commercial, random-legal, never-fund-serving; JSON+CSV report with win funnel, paper ownership, rival competitiveness (GDD §48.7 metrics), event frequency.
- [ ] **S6.7 — World UI.** (Spec: GDD §25.1 world column.) Done when: rival race panel with uncertainty rendering, relationship/diplomacy panel, coalition board, regulation status; world column sticky behaviour per TDD §21.8 breakpoints.

### Exit gate (Stage 6)

- [ ] Nightly balance batch: ≥2 rivals plausible contenders entering Frontier in ~70% of runs; player world-first share 20–70% under balanced policy (coarse bands acceptable this stage).
- [ ] No-rubber-band audit: rival RP inputs contain no player-relative terms (code review + targeted test).
- [ ] CI green.

---

## Stage 7 — Complete Deployment Crisis (TDD Milestone 7)

**Goal:** every required victory/loss fixture of GDD §49.4 is reachable and explainable.

**Entry criteria:** Stage 6 exit gate checked.

### Tasks

- [ ] **S7.1 — Endgame state machine.** (Spec: GDD §44.2–§44.3; TDD §19.1–§19.2.) Done when: `EndgameState` union with all stages; trigger on candidate completion (tick finish → auto-pause → Crisis Start checkpoint → snapshot → Stage One); crisis clocks (rival/political/financial) projected as windows; crisis project capacity (2, +1 conditional) separate from ordinary slots; max speed 2×.
- [ ] **S7.2 — Access ladder and AI character.** (Spec: GDD §36.6, §44.4; TDD §19.4.) Done when: per-model access levels with acceleration/exposure; first-grant critical confirmations for levels 4/5 incl. type-to-confirm UI; `AiCharacterState` with authored conditional dialogue templates conditioned on evidence/access/memories/hidden traits via the privileged dialogue registry; annotation hooks ("claim conflicts with tool log").
- [ ] **S7.3 — Stages One–Four content and rules.** (Spec: GDD §44.5–§44.8.) Done when: confirmation project with four method options and integrity bonuses; Near-AGI failure path returns to normal play with 13-week cooldown; containment posture table; all 12 evidence-sprint crisis projects; pressure-collision selector (highest pressure picks category, randomness picks variant) with ≥6 authored collisions.
- [ ] **S7.4 — Final review, deployment modes, resolution gates.** (Spec: GDD §44.9–§44.12, §44.17; TDD §19.3.) Done when: final review compiles evidence without leaking truth (guard test); six deployment choices with requirements; Gates A–F implemented with full `GateResolution` audit records; derived scores (IntentSafety, OffensiveAgency, Defence, Evidence, Legitimacy, BenefitStrength) as pure formula helpers with unit tests.
- [ ] **S7.5 — Rollout beats, shutdown/retry, coalition resolution.** (Spec: GDD §44.13–§44.15.) Done when: five rollout beats played in sequence; shutdown archive/recovery path with repeat costs; coalition governance gate with salvage event and success bonuses; all clocks continue during rollout.
- [ ] **S7.6 — Endings and post-run audit.** (Spec: GDD §44.16, §42.9, §47.10; TDD §20.2 privileged selectors.) Done when: all endings in GDD §44.16 reachable via intentional test fixtures (victory, Rival Ascendance, nationalisation, contained failure, catastrophe at minimum — the §49.4 list); ending screen (epilogue → mechanical causes); **What Actually Happened** exposes seed, true traits, evaluation errors, major draws/thresholds, top-5 causal decisions, labelled counterfactuals; privileged selectors live in `@neolab/sim/debug`-style export unavailable during active runs.
- [ ] **S7.7 — Prosperity Programmes.** (Spec: GDD §41.1.) Done when: four programmes with readiness 0–100 from research/facilities/experts/discoveries; readiness feeds Gate E; at least the fictional-paper stubs needed by fixtures exist and are clearly marked fictional.

### Exit gate (Stage 7)

- [ ] Every GDD §49.4 bullet has a green automated fixture.
- [ ] A full seeded run from new game to an ending replays byte-identically, including the crisis.
- [ ] Audit screen explains a catastrophe fixture end-to-end (manual review note in log).
- [ ] CI green.

---

## Stage 8 — Content-complete alpha (TDD Milestone 8)

**Goal:** launch content quotas met; no placeholder mechanics or broken branches.

**Entry criteria:** Stage 7 exit gate checked. Content work is **parallel-safe** across tasks once S8.1 lands.

### Tasks

- [ ] **S8.1 — Content pipeline hardening for volume.** Done when: compiler performance acceptable at full quota scale; review-metadata fields (source notes, last-reviewed, portrayal status, legal status per TDD §30.4) required by schema; content report lists gaps.
- [ ] **S8.2 — Papers: 72 (58 real + 14 fictional)** with prerequisites, educational copy, sources (GDD §20.2, §23). Track sub-progress in `content/README.md` counts.
- [ ] **S8.3 — Researchers: 56** with bios, abilities, compacts, hooks (GDD §37.2.3 pattern + open question 4 resolution).
- [ ] **S8.4 — Events: 180 ordinary + 30 crisis chains + 600 feed templates**, meeting GDD §46 per-category quotas; lab-specific variants (≥5/lab), researcher personal events, AI-family voice guides.
- [ ] **S8.5 — Endgame content: 48 decision nodes, 12 crisis inserts, 18 ending/epilogue families** (GDD §20.2).
- [ ] **S8.6 — Facilities: 20 families / 44 definitions**; nine capability tiers finalised in `ai-levels.yaml`.
- [ ] **S8.7 — Editorial/legal review pass** of every real-person and real-paper record; review status recorded in content metadata; unresolved items logged as release blockers.

### Exit gate (Stage 8)

- [ ] `pnpm content:check` green at full quota with zero release-blocking warnings.
- [ ] Branch-coverage harness green over the full catalogue.
- [ ] Balance batch median run length within 90–120 min proxy band (GDD §48.1).

---

## Stage 9 — Art, sound, accessibility, and balance (TDD Milestone 9)

**Entry criteria:** Stage 8 exit gate checked (balance tasks may start against Stage 7 build, parallel-safe).

### Tasks

- [ ] **S9.1 — Art-direction test then production assets** (GDD §26.5 two-treatment test first; then portraits, campus, icons, event cards per asset-manifest rules TDD §22.3).
- [ ] **S9.2 — Campus strip final implementation**; measure against TDD §22.2 thresholds before any PixiJS adoption; decision recorded in the log.
- [ ] **S9.3 — Audio**: `WebAudioManager`, cue registry, rate limiting, settings (TDD §23).
- [ ] **S9.4 — Responsive shell acceptance fixtures** for the four breakpoint states (TDD §21.8) as Playwright visual tests.
- [ ] **S9.5 — Accessibility audit** against TDD §25.6/§30.3 checklist: full keyboard, focus management, colour redundancy, 200% zoom, reduced motion, screen-reader label leak tests.
- [ ] **S9.6 — Balance to GDD §48 targets**: full matrix sweeps; win funnel 45–55%, loss-family distribution, event calibration ("Very likely" ⇒ 85–100%), hidden-info calibration bands; constant changes only via data keys with log entries.
- [ ] **S9.7 — Human playtests** recorded against GDD §49.6 comprehension questions; failures triaged into UI/copy/rules tasks appended to this stage.

### Exit gate (Stage 9)

- [ ] GDD §48 quantitative targets met in nightly reports.
- [ ] Accessibility checklist fully green.
- [ ] §49.6 review gate: playtesters answer all seven questions.

---

## Stage 10 — Public build (TDD Milestone 10)

**Entry criteria:** Stage 9 exit gate checked.

### Tasks

- [ ] **S10.1 — Save-compatibility fixture set**: archive representative saves from the alpha; migration suite proves they load (TDD §24.4).
- [ ] **S10.2 — GitHub Pages deployment workflow** exactly per TDD §31.3: `deploy-pages.yml`, base-path handling for project-site and `play.neolab.ai`, cache header policy, size budgets (≤15 MB compressed first load; fail >900 MB site / >20 MB asset), artifact + content-hash retention for rollback, post-deploy smoke (title → seeded game → one tick → assets resolve).
- [ ] **S10.3 — itch.io package**: relative-path-safe ZIP from the same build; manual upload checklist documented.
- [ ] **S10.4 — Release checks**: licence report, CSP verification, bundle report, optional consented diagnostics wiring (off by default), feedback channel link in-game.
- [ ] **S10.5 — Tag and release**: reproducible tagged build; rollback rehearsal performed once.

### Exit gate (Stage 10)

- [ ] Public URL serves the game; smoke test green post-deploy.
- [ ] Tagged build + content hash archived; rollback procedure documented and rehearsed.

---

## Cross-cutting rules (apply to every stage)

1. **Determinism regression is a stop-the-line failure.** The replay suite from S1.7 runs in CI forever; any red replay blocks all other work.
2. **New state ⇒ same-task updates** to: Zod schemas, invariants, testkit builders, `GameView` projection (or an explicit hidden-state guard entry), and save round-trip test.
3. **New mechanic ⇒ TDD §29.7 checklist** copied into the task's Done-when before starting.
4. **No formula in the UI.** Previews come from `validateCommand`/selector breakdowns only.
5. **Content beyond the current stage's quota is not authored early** — it churns against unstable schemas.
6. **Every completed task = one commit** referencing its ID; every skipped/deviated item = one log entry below.

## Decisions and deviations log

Append-only. Format: `YYYY-MM-DD · task ID · decision · reason · follow-up (if any)`.

- (empty)
