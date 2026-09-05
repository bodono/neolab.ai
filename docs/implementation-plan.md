# Neolab.ai — Staged Implementation Plan

> Status: Working plan, version 0.2 (revised for the GPU-economy and Score/ledger changes in GDD §18.9/§32/§41.5 and TDD §7.2.1/§18.5/§24.7)<br>
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
- **Existing content packs:** `content/` already holds authored draft records (`labs/launch.yaml`, `hardware/gpu-generations.yaml`, `research/domains.yaml`, `research/papers-a.yaml`, `researchers/*.yaml`, `scoring.yaml`, `ai-levels.yaml`). Tasks that need this content **compile and validate the existing records** (fixing them where the schema disagrees) rather than authoring from scratch; author new records only for gaps.

---

## Stage 0 — Workspace and contracts (TDD Milestone 0)

**Goal:** every package builds, forbidden imports fail CI, and the architectural skeleton exists with zero game logic.

**Entry criteria:** none (first stage).

### Tasks

- [x] **S0.1 — Initialise pnpm workspace and packages.**
  - Spec: TDD §4, §3.1.
  - Where: repo root; `apps/web`, `packages/content-schema`, `packages/content`, `packages/sim`, `packages/testkit`, `tools/content-compiler`, `tools/balance-runner`, `tools/save-inspector`.
  - Done when:
    - `pnpm-workspace.yaml` lists all packages; each has a `package.json` with `"private": true`, explicit `exports`, and no floating `latest` ranges.
    - `.nvmrc` (or `.tool-versions`) and `packageManager` field pin Node and pnpm.
    - `pnpm install` succeeds from a clean checkout; lockfile committed.

- [x] **S0.2 — Strict TypeScript configuration and project references.**
  - Spec: TDD §3.1 (compiler options block).
  - Where: `tsconfig.base.json` plus per-package `tsconfig.json` using project references.
  - Done when:
    - All strict options from TDD §3.1 are enabled in the base config.
    - `pnpm typecheck` runs `tsc --noEmit` across all packages via references and passes on the empty skeleton.

- [x] **S0.3 — Lint, format, and import-boundary enforcement.**
  - Spec: TDD §3.2, §4.1.
  - Where: root ESLint (type-aware) + Prettier config; restricted-import rules.
  - Done when:
    - ESLint bans: `sim` importing React/Zustand/browser APIs/`apps/web`; UI importing `sim/src/**` internals; `any`, non-null assertions, `@ts-ignore` in `sim` and content code.
    - A deliberate violation of each rule fails `pnpm lint` (write a temporary fixture to prove it, then delete it).

- [x] **S0.4 — Test tooling.**
  - Spec: TDD §3.1, §25.1.
  - Done when:
    - Vitest runs in every package (`pnpm test` at root aggregates).
    - Playwright is installed in `apps/web` with a placeholder smoke spec that opens a blank Vite page (`pnpm test:e2e`).

- [x] **S0.5 — Foundational shared types.**
  - Spec: TDD §5.3 (branded IDs), §5.4 (units), §5.6 (`assertNever`).
  - Where: `packages/sim/src/model/` (brands, units, helpers), `packages/content-schema/src/` (content ID types).
  - Done when:
    - `Brand`, `LabId`, `ModelId`, `ProjectId`, `ContentId`, `Tick`, `CashMillions`, `GpuCount`, `GpuWeeks`, `Rating`, and `Fraction` exist with validating constructors (`rating()`, `fraction()` etc.) that throw on invalid programmer input.
    - Unit tests cover boundary values (NaN, Infinity, out-of-range) for every constructor.

- [x] **S0.6 — Empty content manifest and compiler walking skeleton.**
  - Spec: TDD §12.1–§12.4 (minimal subset only).
  - Where: `tools/content-compiler`, `content/manifest.yaml`, `packages/content/generated/`.
  - Done when:
    - `pnpm content:build` parses `content/manifest.yaml` (YAML 1.2, anchors/tags disabled), validates it with Zod, emits `content.bundle.json` with a hash, and fails with file/line diagnostics on malformed YAML.
    - `packages/content` exports `loadCompiledContent()` returning the (nearly empty) typed bundle.
    - Generated output directory is git-ignored or clearly marked generated; a CI step verifies it is reproducible.

- [x] **S0.7 — CI pipeline.**
  - Spec: TDD §31.1–§31.2.
  - Where: `.github/workflows/ci.yml`.
  - Done when:
    - On every push/PR: install → content compile → lint → typecheck → unit tests → web production build → Playwright smoke (Chromium at minimum) → bundle-size report artifact.
    - The scripts named in TDD §31.1 exist in root `package.json` (those not yet meaningful may print "not implemented, see implementation-plan stage N" and exit non-zero only where CI does not yet require them).

### Exit gate (Stage 0)

- [x] Fresh clone → `pnpm install && pnpm build` succeeds.
- [x] Each forbidden-import category has a test or lint proof it fails CI.
- [x] CI is green on `main` (verified locally 2026-07-21, then confirmed on the hosted runner after the first push — run 29859764711).

---

## Stage 1 — Deterministic kernel (TDD Milestone 1)

**Goal:** same seed/config/commands produce byte-equivalent canonical state; no gameplay yet beyond an advancing empty world.

**Entry criteria:** Stage 0 exit gate checked.

### Tasks

- [x] **S1.1 — RandomOracleV1.** *(the `randomContractVersion`-in-state item is fulfilled by S1.2's `GameState`, which embeds `RANDOM_CONTRACT_VERSION`)*
  - Spec: TDD §10.1–§10.2 (follow the 11-step derivation exactly).
  - Where: `packages/sim/src/random/`.
  - Done when:
    - `uniform`, `integer`, `triangular`, `weighted`, `shuffle` implemented over SHA-256 (`@noble/hashes`) + xoshiro128\*\* with 8-draw warm-up, rejection sampling for `integer`, sorted candidates for `weighted`, Fisher–Yates for `shuffle`.
    - Golden vectors: ≥100 seed/key fixtures committed under `packages/sim/src/random/__fixtures__/`; a test regenerates and compares.
    - Property tests: uniformity sanity, integer bounds inclusivity, weighted zero-weight exclusion, invalid-weight rejection.
    - `randomContractVersion` constant exported and included in state.

- [x] **S1.2 — Canonical `GameState` shell and serialisation rules.**
  - Spec: TDD §5.1, §5.2, §5.5, §7 (all subsections); GDD §31 for slice inventory.
  - Where: `packages/sim/src/model/`.
  - Done when:
    - `GameState`, `RunState`, `WorldState`, `LabState` (all named slices, may be minimally populated), `ModelState`, `ProjectState`, `EventInstanceState`, `ModifierState`, `ScheduledEffectState`, `ScoreState`, `EndgameState` exist as plain-data types.
    - `ComputeState` follows TDD §7.2.1: physical `GpuLotState[]` (generation ID, ownership, integer `physicalCount`, availability, reliability) plus allocation basis points, reservations, and queued orders. No derived-throughput or CU-style balance is ever stored (invariant + test).
    - A Zod schema validates the full state; a test round-trips `JSON.parse(JSON.stringify(state))` and deep-equals.
    - Deterministic ID counters per namespace (`run:model:player:0007` pattern), no UUIDs.
    - A recursive test asserts no `Date`, `Map`, `Set`, class instance, function, or non-finite number anywhere in a constructed state.

- [x] **S1.3 — `createNewGame` and starting-state content.**
  - Spec: TDD §21.5 (`NewGameConfig`, application order), §7.2.1 (`GpuGenerationDefinition`); GDD §29.2–§29.7 (baseline table, mandates, five leaders/labs).
  - Where: `packages/sim/src/engine/`; content YAML — extend/validate the existing `content/labs/launch.yaml` and `content/hardware/gpu-generations.yaml` (extend compiler schemas as needed — leaders, labs, difficulties, mandates, GPU generations).
  - Done when:
    - Five leader + lab definitions and three mandates compile from YAML.
    - All launch GPU generations (Kepler → Rubin plus fictional successors) compile with training/serving factors, power, interconnect tier, costs, delivery weeks; compiler enforces `historicity` rules (fictional generations require the fictional manufacturer and `FICTIONAL HARDWARE` labelling; Kepler is the `1.0` reference).
    - `createNewGame(config)` applies baseline → lab modifiers → leader modifiers → difficulty → mandate → seeded world generation, in that order; the starting fleet is physical Kepler lots (10,000 GPUs baseline; 9,000 for Humanic's `Deliberate Scale`).
    - Golden test: exact starting state snapshot for **each of the five leaders × Standard difficulty**, plus one per remaining difficulty (GDD §29.4 multipliers present in state or rules data).
    - Baseline numbers match GDD §29.2 table exactly (assert per-field, not only via snapshot).

- [x] **S1.4 — Command shell and transaction.**
  - Spec: TDD §8.1–§8.3, §9.3–§9.4.
  - Where: `packages/sim/src/commands/`, `packages/sim/src/engine/`.
  - Done when:
    - `GameCommand` union exists with at least `SetGpuAllocationCommand` (placeholder handlers for the rest may be typed but rejected as "not yet implemented" via `CommandValidation`).
    - `validateCommand` / `applyCommand` implemented; `applyCommand` is atomic (test: a handler that throws mid-way leaves input state referentially untouched).
    - `SimulationTransaction` implemented with `read/update/applyEffects/emit/schedule/allocateId/commit`; `commit` runs invariants and (dev builds) freezes state.
    - `expectedTick` staleness rejection works (test).

- [x] **S1.5 — Tick engine skeleton.**
  - Spec: TDD §9.1–§9.2, §9.5; GDD §30.3 (canonical order).
  - Done when:
    - `TickPhase` enum matches TDD §9.2 exactly; system registry sorts by phase → priority → system ID and rejects duplicates at startup.
    - `advanceOneTick` executes all phases with placeholder/no-op systems, advances calendar (week/cycle/quarter boundaries per GDD §28.1), emits a tick summary domain event.
    - Invariant suite from TDD §9.5 implemented as a callable pack; wired into `commit`.
    - Queued orders (S1.4) apply in `apply-orders` phase next tick (test).

- [x] **S1.6 — Effects, modifiers, predicates, checks (core vocabulary).**
  - Spec: TDD §11.1–§11.4.
  - Where: `packages/sim/src/engine/` (executor, resolver), `packages/content-schema` (authored forms).
  - Done when:
    - `Effect` union + `EffectExecutor` with at least: `AddResourceEffect`, `AddRatingEffect`, `SetFlagEffect`, `AddModifierEffect`, `RemoveModifierEffect`, `ScheduleEffectsEffect`, `EndRunEffect`. Every switch ends in `assertNever`.
    - `ModifierState` + resolver with documented order (min/max → add → multiply → clamp) and `ModifierBreakdown` output; closed `ModifierTarget` registry; unknown target rejected at compile and runtime.
    - `Predicate` AST evaluator + `MetricRegistry` with a first metric set (cash, tick, ratings); no arbitrary path traversal.
    - `CheckDefinition` with the single shared logistic implementation (GDD §42.3: 10-point ≈ 73%, 20-point ≈ 88% asserted in tests) and clamping.

- [x] **S1.7 — Save envelope, memory repository, replay hash.**
  - Spec: TDD §24.1–§24.2, §24.6.
  - Where: `packages/sim/src/persistence/`, `packages/testkit`.
  - Done when:
    - `SaveEnvelopeV1` write/load with checksum; `MemorySaveRepository` implements `SaveRepository`.
    - Deterministic state hash function (stable key ordering) exported for replay comparison.
    - Replay test: new game → 100 ticks with no commands → serialise → load → 100 more ticks, compared against an uninterrupted 200-tick run; hashes equal. Run for two different seeds and two leaders.

- [x] **S1.8 — Testkit scenario builders (initial).**
  - Spec: TDD §25.2.
  - Done when:
    - `scenario()` builder produces valid states with safe defaults; `.atTick()`, `.withPlayerLab()` (cash/rating setters plus `.gpus("gpu.kepler", 40_000)`-style lot setters per TDD §25.2) work; `build()` validates; `unsafeFixture()` escape hatch exists.
    - All Stage 1 tests that construct states use the builder (spot-check, refactor stragglers).

- [x] **S1.9 — Score ledger core.**
  - Spec: TDD §18.5; GDD §18.9, §41.5; `content/scoring.yaml` (canonical values).
  - Where: `packages/sim/src/engine/` (award/finalise helpers), `packages/sim/src/selectors/`, compiler schema for `scoreRules`.
  - Done when:
    - `content/scoring.yaml` compiles into `CompiledContent.scoreRules`; system code contains no paper titles or point tables (review check).
    - `awardScore` appends `ScoreLedgerEntry` records with semantic keys and rejects duplicate keys (test); entries survive save round-trip and replay identically.
    - `calculateScoreView` exists and is exported from `@neolab/sim/public` (TDD §33.1); it exposes only ledger facts the player already knows.
    - Architecture guard: no economy/research/rival/event/endgame system reads score to change an outcome — enforced by lint restriction or a targeted import/usage test.
    - `finaliseScore` is stubbed to throw "endgame not implemented" (real implementation lands in S7.8).

### Exit gate (Stage 1)

- [x] Same seed/config/command-log ⇒ byte-equivalent canonical state (automated test, ≥2 seeds; command-free replay across 4 seed/leader configs — command-inclusive replay is a logged test gap).
- [x] Golden baselines exist for all five leaders and all four difficulties.
- [x] RandomOracle golden vectors committed and green.
- [x] CI green (hosted, after Stage 1 review fixes).

---

## Stage 2 — Ten-minute economy (TDD Milestone 2)

**Goal:** a player can survive or go bankrupt through legible decisions; forecast reconciles with settlement; first playable React shell with a real clock.

**Entry criteria:** Stage 1 exit gate checked.

### Tasks

- [x] **S2.1 — GPU portfolio, workload throughput, allocation hierarchy, normalisation.**
  - Spec: GDD §32.1–§32.2; TDD §16.1.
  - Done when:
    - `calculateGpuThroughput(state, content, labId, workload, selection?)` breaks out physical GPUs by generation, generation factor, availability, software, power and interconnect; its final scalar is a formula input only, never stored or shown as a resource (TDD §16.1).
    - Reservations resolve before discretionary allocation and honour generation/interconnect pins; unpinned allocation draws proportionally from available lots in stable `GpuLotId` order.
    - `normaliseAllocation` operates over lots with basis points (0–10 000) and largest-remainder integer-GPU rounding: every displayed count is an integer and child allocations sum exactly to their physical parent count (property test).
    - Unfunded-program rule (<200 physical GPUs/week ⇒ no progress, marked stranded) implemented where allocation is consumed.
    - Allocation invariants: sums within 1e-9 at each hierarchy level; property test over thousands of random allocations.
    - `SetGpuAllocationCommand` fully implemented (queued, applies next tick, >25-point domain swing penalty flag recorded for Stage 3 to consume).

- [x] **S2.2 — Hardware market: buy, lease, deliveries.**
  - Spec: GDD §32.3; TDD §16.1 (`quoteGpuOffer`).
  - Done when:
    - The four default offers exist as content data referencing `content/hardware/gpu-generations.yaml` for the current generation; `PurchaseGpuCommand` quotes (generation, physical count, price, delivery, ongoing cost and relative training/serving comparison against the current fleet) and schedules delivery; deliveries create new `GpuLotState` records in the `deliveries` phase before allocation.
    - Owned vs leased vs cloud lots tracked; lease recurring costs feed finance; damage/sale/lease-expiry change lots through commands/effects only, never by rewriting generation factors (test).

- [x] **S2.3 — Finance ledger, forecast, cycle settlement, runway.**
  - Spec: GDD §33.1, §33.7; TDD §16.2.
  - Done when:
    - Every income/expense line is a ledger entry with stable category + source ID.
    - `forecastFinance` and `settleCycle` share rule functions; reconciliation test: opening cash + ledger entries = closing cash, asserted every cycle in a 3-year seeded run.
    - `calculateRunway` matches GDD §33.7 formula incl. `∞` display case; warning thresholds (12w, 4w) emit domain events; insolvency detection emits the auto-pause reason (emergency options are Stage 5 events; until then insolvency ends the run with a placeholder loss recorded in the log).

- [x] **S2.4 — Minimal market: launch segments, serving, revenue, satisfaction.**
  - Spec: GDD §33.2–§33.5 (Researchers + Start-ups segments only); TDD §16.3.
  - Done when:
    - Appeal formula, softmax share (player + placeholder static rivals), acquisition-rate lag, price tiers, delivered-vs-requested usage with shortage feedback (GDD §32.4), and satisfaction deltas implemented for the starting segments.
    - "Never profitable to serve undelivered usage" asserted by test.

- [x] **S2.5 — Project framework + first facility.**
  - Spec: TDD §17.3–§17.4; GDD §31.5 (slots), §37.7 (catalogue — implement `Power and Cooling I` and `Data Centre I` only).
  - Done when:
    - `BaseProjectState`, `ProjectHandler` registry, and unified Major Project slot accounting from Management Capacity.
    - Construction completes → `FacilityInstanceState` + sourced modifiers; disabling facility disables its modifiers by source (test).

- [x] **S2.6 — GameRuntime, clock, and Zustand bridge.**
  - Spec: TDD §6.1–§6.3, §21.1–§21.2.
  - Where: `apps/web/src/runtime/`, `apps/web/src/app/`.
  - Done when:
    - `BrowserGameRuntime` owns state; `AnimationFrameClockDriver` uses `performance.now()`, ≤4 ticks/frame, carries debt, honours pause; auto-pause reasons stop consumption and surface to UI.
    - Zustand store holds `GameView` snapshot + UI state only; a lint rule or review note bans game-mutation actions in the store.
  - Implemented: the runtime exposes only a frozen bootstrap `GameView`, the clock
    publishes each atomic tick and preserves capped frame debt, and the vanilla
    Zustand bridge contains view snapshots plus interface-only actions. ESLint
    prevents app/store modules from importing simulation mutation functions.

- [x] **S2.7 — `GameView` projection (economy slice) and hidden-state guard.**
  - Spec: TDD §20.1–§20.3.
  - Done when:
    - `projectGameView` covers top bar (finance/GPU fleet/Aura placeholder/date) and a `GpuFleetView` (TDD §20.1) with physical-GPUs-beside-percentage values and the generation mix (e.g. `45% · 4,500 GPUs/week`, `3,000 Volta · 1,500 Turing`), market view, project list.
    - `assertNoHiddenKeys(view)` recursive test guard implemented and wired into projection tests (hidden fields list starts now, grows later).
  - Implemented: the simulation-owned projection supplies identity, calendar,
    finance/runway, Aura, score, physical GPU generation and allocation views,
    customer-market forecasts, facilities, and project status. Projection tests
    prove hidden safety/candour changes cannot alter the view, and the shared
    recursive guard reports forbidden key paths.

- [x] **S2.8 — Playable economy shell UI.**
  - Spec: TDD §21.3, §21.6, §21.8; GDD §25.1–§25.3 (layout targets).
  - Done when:
    - Screens: minimal Title → New Game (seed/difficulty/leader pick, plain list is fine this stage) → GameShell with `TopStatusBar`, GPU sliders (basis points, keyboard steps, physical counts, commit-on-release), pause/speed controls, buy-GPUs dialog with quote preview from `validateCommand`.
    - A human can play: adjust serving vs R&D, buy compute, watch runway, hit bankruptcy or survive 3+ years.
    - Playwright: scripted run reaches both "survived 2 years" and "insolvency" outcomes deterministically with fixed seeds.
  - Implemented: the responsive lab-operations shell now runs the real runtime
    and commands. It includes title/setup/leader selection, clock controls,
    command-previewed GPU allocation, procurement, market pricing, content-driven
    Aura fundraising, facility construction, runway warnings, score, feed, and
    an animated CSS campus. Playwright covers launch, 104-week survival, and the
    insolvency ending.

### Exit gate (Stage 2)

- [x] Manual 10-minute session is coherent: costs visible before confirm, cashflow explains itself (TDD §32 M2 exit).
- [x] Forecast/settlement reconciliation test green over long seeded runs.
- [x] Replay determinism still green including purchases and allocation commands.
- [x] CI green including new Playwright specs.

---

## Stage 3 — Research and model loop (TDD Milestone 3)

**Goal:** a complete seeded paper race and two model generations replay exactly.

**Entry criteria:** Stage 2 exit gate checked.

### Tasks

- [x] **S3.1 — Research domains and weekly production.**
  - Spec: GDD §34.1–§34.3; TDD §14.1, §14.3.
  - Done when:
    - Eight capability domains + three safety programmes compiled from the existing `content/research/domains.yaml`; `calculateDomainOutput` full breakdown using the GPU-based formula (`weightedTrainingGpuWeeks / 100` → `researchScale`, GDD §34.2 — `researchScale` is never stored or displayed as a resource); focus multipliers with 4-week cooldown; context-switch penalty consumes the Stage 2 flag; weekly variance via keyed draws.
    - Domain-level thresholds award generic advances (GDD §34.7) with player choice recorded as a command.
  - Implemented: `content/research/domains.yaml` now compiles all eleven
    programmes, formula constants, and two authored option themes expanded to
    stable IDs at every ten-level threshold. The research phase consumes the
    physical GPU portfolio by generation, applies keyed variance, research
    freedom, facilities, talent, modifiers, focus cooldown and the one-week
    context-switch flag, then advances integer levels with rising RP costs.
    Focus changes queue for the next tick; generic choices are immediate
    commands that create sourced modifiers and exact content-defined score
    entries. `GameView` exposes levels, weekly momentum, GPUs/week, focus
    cooldowns and choice copy while recursively forbidding within-level RP.

- [x] **S3.2 — Paper graph, hidden thresholds, discovery, publication, diffusion.**
  - Spec: GDD §34.4–§34.6, §34.8; TDD §14.2, §14.4.
  - Done when:
    - `PaperDefinition` schema matches the revised TDD §14.2: `historicity` (`real` / `fictional-future`), inline title/authors/education fields (`playerSummary`, `archiveExplanation`, `insideBaseball`), `PaperPrerequisiteDefinition` compiled to the predicate AST, `discovery` block, `review` state. Compiler checks: weights sum to 1, prerequisite graph acyclic unless flagged, real papers require primary source/authors/year, fictional papers must omit factual-source fields and carry `FICTIONAL FUTURE PAPER`.
    - The existing `content/research/papers-a.yaml` batch compiles clean; at least ten of its real papers are wired into the run (fix records where the schema disagrees; log fixes).
    - Hidden thresholds derived lazily from (seed, lab, paper) — test lazy == eager.
    - World-first resolution respects canonical order + run-creation shuffle; all four publication policies apply their effects; diffusion credit at 25/50/75/100.
    - Score entries per GDD §41.5 Scientific Legacy: world-first awards `100 × worldFirstAura`, rediscovery 20%, diffusion 0, publication-policy bonuses (open +10%, controlled +5%, release-everything +10%) — exact-value fixtures against `content/scoring.yaml`.
    - Golden scenario: seeded two-lab paper race (player + one scripted rival stub) replays exactly, including the score ledger.
  - Implemented: landmark papers compile to a predicate graph with reverse,
    domain, tag, chronology and earliest-phase indexes; validation rejects bad
    weights, metadata mismatches, missing references and unflagged cycles.
    Per-lab thresholds remain seed-derived and absent from saves. Weekly player
    and scripted-rival progress resolves threshold crossings in the run-shuffled
    lab order, supports independent rediscovery, applies unlocks, and records
    exact score-ledger entries. All publication policies, timed diffusion, four
    knowledge milestones, replay/save-load equality, and hidden-view invariance
    have exact fixtures. Publication and temporary rival defaults live in the
    compiler so authored paper expansion can proceed independently.

- [x] **S3.3 — Training pipeline.**
  - Spec: GDD §35.2–§35.4; TDD §15.2.
  - Done when:
    - `quoteTrainingRun` freezes recipe/duration/reservation/cash; three scales; dataset + safety-protocol choices; failure checks at 35/70/100% with logistic rule; capability generation per GDD §35.3 with draws keyed to the future model ID.
    - Regression highlighting data present in the completion report payload.
  - Implemented: the command preview and transition share one quote that
    freezes a future model ID, recipe version, cash schedule, duration,
    physical-GPU count, eligible generations and interconnect floor. Prototype,
    Product and Frontier runs enter the common project scheduler, consume
    actual availability-adjusted reserved throughput, and cannot grow when the
    fleet later expands. Keyed logistic checks at 35/70/100% record their draw,
    probability and exact delay/cost/capability/total-loss outcome. Completion
    applies the documented capability formula, keys every draw
    to the preallocated model ID, preserves a regression list, releases the
    reservation, adds the model to the portfolio, auto-pauses, and survives a
    strict save/load round trip. Five integration fixtures cover all scales,
    policy trade-offs, frozen terms, completion/regressions, and the legal
    total-loss gate.

- [x] **S3.4 — Hidden safety generation and capability tiers.**
  - Spec: GDD §35.1, §35.6, §36.3; TDD §15.1.
  - Done when:
    - `HiddenModelSafetyState` generated at training completion (four formulas + noise); excluded from public package exports (compile-time test: importing it from `@neolab/sim/public` fails).
    - `classifyCapabilityTier` selector over measured evidence only; tier definitions loaded from `content/ai-levels.yaml`; tier-change presentation event enqueued once per model/tier.
    - AGI-candidate criteria detection (GDD §35.6) sets the flag that Stage 7 will consume (until then it only logs + auto-pauses).
    - First-time capability-tier score entries (Race and Operations category) emitted with duplicate-key protection per model/tier.
  - Implemented: the existing nine AI-level records compile into a closed,
    ordered requirement AST. Every new model receives a low-confidence baseline
    capability estimate, while all four hidden safety values use the exact GDD
    formulas and independent model-ID-keyed triangular noise. Tier selection
    reads measured capability only; changing hidden safety cannot affect it. A
    newly reached tier adds one durable presentation item,
    emits exact Race and Operations score entries, and remains idempotent when
    reprocessed. Measured AGI-candidate criteria set the Stage 7 flag, append a
    domain-log record and auto-pause. Compile-time and recursive runtime guards
    keep `HiddenModelSafetyState` and true capability out of
    the browser-facing surface.

- [x] **S3.5 — Evaluations, observations, anomalies.**
  - Spec: GDD §36.4–§36.8; TDD §15.3–§15.4.
  - Done when:
    - Baseline eval on training completion + the seven eval project types as content; observation = truth + bias + error + masking, error narrowing with Eval Quality; diminishing information on repeats (100/55/25/10).
    - Anomaly records with true vs observed severity; dismiss/investigate commands; three-unresolved-severe forced event hook (fires a placeholder critical event until Stage 5 authors the real one).
    - Weekly incident hazard check per GDD §36.7 with clamps; `isCatastropheCheckLegal` implemented and enforced (dev-throw / prod-convert per TDD §15.4) — with FC/access preconditions unreachable this stage, a forced-fixture test proves the gate blocks illegal catastrophes.
    - Calibration test batch: weak vs strong evidence mislabel rates within GDD §48.8 bands (coarse assertion, refined in Stage 9).
  - Implemented: the compiler emits the automatic baseline and seven stable
    evaluation project definitions without touching the authored content tree.
    Evaluation quotes reserve physical GPUs and project capacity, freeze cash
    and Aura terms, and complete through the shared project scheduler. Reports
    keep only observations: each estimate combines evaluator bias, seeded error
    and directional deceptive masking; Eval Quality narrows the error radius,
    confidence and alignment labels remain player-facing, and repeat evidence
    weights are exactly 100/55/25/10. Training completion now creates a real
    baseline evaluation before tier classification. Anomalies retain hidden
    severity separately from observed severity, support audited dismiss and
    delayed investigate commands, and three severe unresolved anomalies emit a
    mandatory placeholder event plus critical auto-pause. Weekly player-model
    incident checks use the five FC hazard bands, documented culture/control/
    exposure/difficulty factors and ordinary clamp. Catastrophes pass a single
    five-condition legality gate: illegal development attempts throw, while
    production converts them to a contained severity-84 incident. Fixtures
    cover the full evaluation lifecycle, save-safe state, forced anomaly hook,
    incident formula/gate, and 2,000-seed weak/strong calibration bands.

- [x] **S3.6 — Productisation and deployment policies.**
  - Spec: GDD §33.4, §35.5.
  - Done when: internal/preview/guarded/open/weights policies with exposure values; productisation projects (normal/hardened/rush) adjust Product Quality/Reliability; deployment feeds market appeal from Stage 2.
  - Implemented: all five policies compile with the exact 0.02/0.15/0.35/
    0.65/1.00 base exposures plus data-shaped demand, revenue, appeal, Aura and
    irreversibility effects. A shared immediate deployment command exposes the
    resulting effective exposure in its preview, switches the lab's commercial
    model when appropriate, requires productisation before external API access,
    and makes weights release permanently irreversible after its one-time Aura
    award. Normal (four-week), hardened (eight-week), and rush (one-week)
    projects use the common scheduler and frozen quotes. Completion moves
    Product Quality/Reliability toward Engineering Quality, with hardened
    monitoring reducing exposure and incident pressure while rush adds the
    explicit reliability/evidence/incident penalties. Stage 2 market forecasts
    now apply the selected policy to appeal, potential demand, immediate
    requested usage and revenue. Incident checks use the greater of deployment
    and autonomy exposure, include rushed/hardened state, volume and unresolved
    severe anomalies, and run for deployed as well as internally autonomous
    player models. Exact fixtures cover recipes, all policies, market/hazard
    integration, the external-deployment gate, and irreversible weights release.

- [x] **S3.7 — Research & model UI.**
  - Spec: TDD §21.3; GDD §25.2, §34.3 (no exact progress bars), §34.9 (educational card).
  - Done when:
    - Research workspace: domain allocations with physical GPUs/week shown, focus picker, qualitative progress labels (`Speculative`/`Promising`/`Hot trail`/`Breakthrough imminent`) — no numeric completion bars (assert the view type cannot carry one).
    - Model workspace: model cards, training dialog with quote (physical GPU reservation by permitted generation/interconnect tier), eval reports with confidence labels, deployment policy control.
    - Dashboard header shows the current Score total from `calculateScoreView` (GDD §18.9), with the category breakdown reachable from it.
    - Paper discovery presentation: full educational card incl. real-world publication info and source link (opens `noopener,noreferrer`, domain shown).
  - Implemented: the player-safe projection now includes model cards, measured
    capability evidence, qualitative tier progress, accessible evaluation
    observations, observed anomaly severity, and the educational paper archive;
    canonical safety truth remains excluded. The research workspace shows all
    eleven programmes in physical GPUs/week with focus controls and only
    qualitative momentum signals. The model workspace provides portfolio
    switching, shared-rule training quotes with eligible GPU generations and
    interconnect requirements, productisation previews, deployment policy
    controls, evaluation reports and anomaly actions. The header's live Score
    opens a category breakdown, while paper cards distinguish real and fictional
    work, show educational copy and open primary sources with the source domain
    plus `noopener,noreferrer`. Desktop and narrow layouts were visually checked;
    the browser journey asserts no exact research progress surface and no hidden
    safety vocabulary in rendered text.

- [x] **S3.8 — Post-alpha opening model, demand, and insolvency correction.**
  - Spec: GDD §29.2, §33.1, §33.4, §33.6–§33.7; TDD §7.2, §16.2–§16.3.
  - Done when:
    - New games contain no trained AI, no commercial model, no demand, and zero serving allocation; the first parentless training run creates generation zero and becomes active.
    - Active internal and commercial model roles are separate, projected explicitly, invariant-checked, and compatible with save-version-3 states.
    - Serving allocation cannot exceed useful current demand, shows the cap in basis points and physical GPUs/week, and automatically reclaims stale over-allocation.
    - A negative settlement pauses for a legal fundraising rescue and becomes terminal only when no rescue exists.
    - Accepted fundraising rounds grow cheque scale exponentially, with quote and offer generation using one formula.
  - Implemented: `LabModelPortfolioState` now carries optional active and
    commercial IDs; production starts with an empty portfolio and a 12.0 cash
    bootstrap runway rather than a fictional deployed starter model. Training,
    productisation, deployment, selectors, runtime UI, rivals, balance policies,
    market demand, finance settlement and deterministic test fixtures now
    honour the two roles. A shared serving-demand cap binary-searches the real
    GPU fleet, rejects wasteful slider commands and reclaims obsolete
    allocations during accrual. Insolvency checks available offers, active
    campaigns and launchable emergency bridges before ending the run. Each
    accepted financing round doubles later campaign ranges up to a numerical
    safety ceiling. Engine rules version is `0.2.0`; save version remains 3
    because the new commercial ID is optional and legacy external current
    models have a compatibility fallback. Rival off-screen organisational
    growth and lifecycle-aware headless policies preserve the long-horizon
    race/coalition gates without reading hidden player state. Authored
    gameplay catalogue files were not changed.

### Exit gate (Stage 3)

- [x] Seeded run: ≥2 model generations trained, ≥3 papers discovered (≥1 by the rival stub), one full publication-policy cycle each — replays byte-identically.
- [x] Hidden-safety truth provably absent from `GameView` and screen-reader strings (guard test extended).
- [x] CI green.

---

## Stage 4 — People, Aura, and facilities (TDD Milestone 4)

**Goal:** six stars, five facilities, hiring/poaching/dismissal, funding chains work.

**Entry criteria:** Stage 3 exit gate checked.

### Tasks

- [x] **S4.1 — Researcher definitions, abilities, compacts (data + engine).**
  - Spec: GDD §37.2–§37.2.5; TDD §17.1.
  - Done when:
    - Full `ResearcherDefinition` schema matches the revised TDD §17.1: inline display name/epithet/role/biography, portrait block (asset + brief + alt text), `signature`/`passive`/`compact`, contract sub-object whose values must equal the declared band defaults unless an authored override explains itself, `paperHooks`/`facilityHooks`/`endgameHooks`, `eventReactions`, `feedLines`, sources, portrayal/legal review metadata. `ResearcherActivationDefinition`, `ResearcherCompactCheckDefinition`, and `ResearcherUnlockDefinition` are closed unions compiled into predicates; unknown keys rejected.
    - Compiler completeness rules enforced: each released researcher has exactly three event reactions, at least six feed lines, a sourced biography, portrait brief + alt text, and explicit review metadata (may be a warning class until Stage 8 hardening, but the check exists now).
    - `AuthoredModifier` compilation; `syncResearcherAbilityModifiers`; signature 4-week ramp; lead contribution (3% per point); uncapped source-attributed stacking for all researcher bonuses and penalties.
    - The existing `content/researchers/*.yaml` records (foundation, deep-learning, scaling, frontier, rules) compile clean; at least six are wired into the run, including one Research-Council-style institutional signature and one compact-required character (fix records where the schema disagrees; log fixes).
    - Compact evaluation over rolling 13-week windows with warning → breach event hook.

- [x] **S4.2 — Star slots, talent market, recruitment.**
  - Spec: GDD §29.3, §37.3–§37.4; TDD §17.2.
  - Done when:
    - Slot caps from facilities (hard max 8), `Unhoused` status; market refresh every 13 weeks with composition rules and availability waves; deterministic recruitment at fixed market-window terms; mandatory authored promise; assignment after hiring; one-employer invariant.

- [x] **S4.3 — Morale, loyalty, burnout, promises, departures, poaching.**
  - Spec: GDD §31.4 (drift), §37.5–§37.6.
  - Done when:
    - Rating drift `newRating = old + (target-old)×0.015 + immediate` for org ratings and researcher states; promises as first-class records; quarterly departure checks with ultimatum-first rule; poaching signal chain (rumour → counteroffer window → resolution); knowledge-transfer on departure (20–60% of associated secret progress, delayed).

- [x] **S4.4 — Aura economy.**
  - Spec: GDD §38.1–§38.2.
  - Done when: spendable Aura floor at zero, Lifetime Aura monotone, `Aura Signal` derived with 26-week spend recovery; all sources/sinks wired to existing systems (papers, launches, satisfaction, incidents).

- [x] **S4.5 — Fundraising.**
  - Spec: GDD §33.6; TDD §16.2 (`generateFundingOffers`).
  - Done when: three campaign types as projects (Aura spent at start), funding score formula, generated offers with conditions as modifiers/flags, accept command; board-condition follow-up hooks recorded for Stage 5.

- [x] **S4.6 — Facility catalogue and campus view-model.**
  - Spec: GDD §37.7–§37.8; TDD §17.4, §22.1.
  - Done when: all 15 initial catalogue entries as content (GPU-count capacities per the revised GDD §37.7 — e.g. Data Centre I supports 25,000 owned GPUs); slot-unlock facilities; over-cap `Unhoused` flow; first-completion score entries (Institution Building) with duplicate-key protection so sell-and-rebuild cannot farm points; `CampusView` projection (facilities, construction stage, load state, cues) — DOM strip rendering may remain placeholder blocks.

- [x] **S4.7 — People & campus UI.**
  - Spec: GDD §25.3 (portrait row), §49.2; TDD §21.3.
  - Done when: persistent star strip (portraits, assignment, morale warnings, vacant/locked cards), dossier dialog (bio, abilities, compact, contract), recruitment dialog with fixed listed terms and one guaranteed recruit action, post-hire assignment, dismissal confirmation with consequences; facilities panel with build buttons showing full costs; campus strip renders `CampusView`.

### Exit gate (Stage 4)

- [x] Scenario test: hire 3 stars, trigger a compact warning and a breach, lose one star to scripted poaching, dismiss one, complete a Competitive Round — all consequences visible in decision log; replays exactly.
- [x] Six stars + five facilities usable end-to-end from the UI.
- [x] CI green.

---

## Stage 5 — Events, politics, and content compiler completion (TDD Milestone 5)

**Goal:** 25–35 vertical-slice events survive save/load; no event can illegally cause catastrophe; government behaves as a strategic actor.

**Entry criteria:** Stage 4 exit gate checked.

### Tasks

- [x] **S5.1 — Event engine.**
  - Spec: GDD §43 (all); TDD §13.1–§13.5.
  - Done when:
    - Full `EventDefinition`/`EventInstanceState` schemas; eligibility → weights → suppression → pity ramp (2.2% base, +0.3/wk after 12, guarantee at 30) → deterministic weighted selection; mandatory trigger detectors as explicit rules; expiry with declared defaults; cooldown groups; precommitted option outcomes keyed per TDD §10.3; `DecisionMemory` records.
    - Token interpolation via typed tokens + ICU-style formatter; no raw string HTML.

- [x] **S5.2 — Content compiler: full validation passes.**
  - Spec: TDD §12.3 (all 13 steps), §25.5.
  - Done when: reachability analysis for every option/outcome branch; probability-band coverage of `[0,1)`; localisation key/placeholder verification; release-blocking warning class (missing paper source, missing alt text, unreachable branch, ungated catastrophe effect); retired Part I ending names (GDD §18.7: "The Long Boom", "The Careful Dawn", "Someone Else's Future", "Paperclip Adjacent", "The Adults Have Entered the Building") rejected anywhere in content data or UI copy; `content/scoring.yaml` keys validated (every referenced milestone resolvable, no duplicates, category IDs closed); content report emitted; `pnpm content:check` green.

- [ ] **S5.3 — Vertical-slice event set.**
  - Spec: GDD §45 (author from the 26 examples), §43.8 (per-event test requirements).
  - Done when: 25–35 events authored covering every category in GDD §46 at least twice, including `ai.root_access_request` and `safety.unapproved_tool_call`; every event passes the §43.8 automated checklist; dynamic names resolve for all five labs (test matrix).

- [x] **S5.4 — Politics and government.**
  - Spec: GDD §38.3–§38.5, §40.2; TDD §18.3.
  - Done when: four government values; quarterly `interventionPressure` with threshold consequences delivered as events (due process — no direct stat-jump interventions); lobbying projects; government segment unlock; nationalisation prerequisites (pressure ≥80 + trigger + failed response) enforced by rule, verified by forced fixture.

- [x] **S5.5 — Delayed effects, decision log, autosave triggers.**
  - Spec: GDD §43.6, §15 (delayed consequences); TDD §24.3.
  - Done when: scheduled effects fire in `delayed-effects` phase quoting their origin; decision log traces every persistent modifier to source; autosave on cycle boundary + around critical events (memory repo; IndexedDB in S5.7).

- [x] **S5.6 — Event UI and overlay discipline.**
  - Spec: GDD §15.1, §47.9; TDD §21.3 (`OverlayHost`), §23 (presentation queue).
  - Done when: decision dialog with evidence/known-costs/uncertainty preview from `EventOptionPreview` only; ordered `OverlayHost` (critical > discovery > urgent > user); notification levels incl. non-disableable critical auto-pause; feed panel with severity styling and expiry countdowns (direction unambiguous).

- [x] **S5.7 — IndexedDB persistence + import/export + migration scaffold.**
  - Spec: TDD §24.2–§24.5.
  - Done when: `IndexedDbSaveRepository` with atomic slot-pointer writes; export/import with size limits and `unknown`-first parsing; save-version migration pipeline with a fixture test (v1→v1 identity now, structure ready); corrupt-save load fails gracefully to title screen.

### Exit gate (Stage 5)

- [x] Save/load mid-event preserves options, tokens, and precommitted outcomes (automated).
- [ ] Full event branch-coverage report: zero unreachable branches without `manual-only` justification.
- [ ] Forced-fixture proof: no authored event can emit a catastrophe without `isCatastropheCheckLegal`.
- [ ] CI green.

---

## Stage 6 — Rivals and coalition (TDD Milestone 6)

**Goal:** headless runs produce credible multi-lab races with no rubber-banding.

**Entry criteria:** Stage 5 exit gate checked.

### Tasks

- [x] **S6.1 — Rival state and utility policy.** (Spec: GDD §39.1–§39.3; TDD §18.1–§18.2.) Done when: four rivals instantiated from lab definitions; one weighted-utility policy with data personalities; quarterly plan selection with top-3 logging; weekly command generation through the same command shapes; no read access to player hidden state (type-level + test).
- [x] **S6.2 — Rival research/market/talent participation.** (Spec: GDD §39.3, §37.6, §33.2.) Done when: rivals accumulate real paper progress against real thresholds, poach via the Stage 4 chain, participate in the single-pass market settlement (TDD §16.3), and generate public signals (releases, hires, benchmarks) with estimate error driven by intelligence quality.
- [x] **S6.3 — Rival incidents, containment of failure, diplomacy actions.** (Spec: GDD §39.4, §39.6.) Done when: rival high-severity failures convert to the allowed consequence set (never extinction); relationship state per rival; player diplomacy actions (collaborate, standards, non-poach, share incident info) as commands/events.
- [ ] **S6.4 — Rival candidate countdown and Race Emergency.** (Spec: GDD §39.5, §18.1.) Done when: hidden 26-week-base countdown with modifiers; player-visible range estimate narrowing with intelligence; Rival Ascendance loss ending wired; Race Emergency event authored.
  - [x] Engine: hidden modified countdown, intelligence-filtered projection, final-year warning, and Rival Ascendance resolution.
  - [x] Content contract: mandatory `rival-candidate` detector and Race Emergency trigger tokens.
  - [ ] Content-owned completion: authored Race Emergency event definition and copy.
- [ ] **S6.5 — Coalition groundwork systems.** (Spec: GDD §14.1, §41.3–§41.4; TDD §18.4.) Done when: `CoalitionState` lifecycle proposal→ratification; shared protocol/verification ratings raised by projects (incl. `coalition.inspection`-style events from Stage 5 set); hard prerequisites of GDD §41.3 encoded as an eligibility selector (readiness is never a stored boolean); coalition-ratification score entry (Race and Operations) emitted once.
  - [x] Engine: proposal→negotiation→ratification→active lifecycle, project handler, member-specific countdown pause, and typed inspection-event effects.
  - [x] Rules: every §41.3 groundwork prerequisite is a derived eligibility check; ratification awards the data-defined Race and Operations score once.
  - [ ] Content-owned completion: authored coalition inspection/verification event definitions using the typed effect hook.
- [x] **S6.6 — Balance runner v1.** (Spec: TDD §26; parallel-safe once S6.1–S6.2 done.) Done when: `runBalanceBatch` executes ≥1,000 seeded runs headless in CI-nightly time budget; policies: balanced, capability-first, commercial, random-legal, never-fund-serving; JSON+CSV report with win funnel, paper ownership, rival competitiveness (GDD §48.7 metrics), event frequency. Implemented with player-safe policy views, production command validation, deterministic JSON/CSV reports, local smoke/full scripts, and a 30-minute scheduled GitHub Actions job.
- [x] **S6.7 — World UI.** (Spec: GDD §25.1 world column.) Done when: rival race panel with uncertainty rendering, relationship/diplomacy panel, coalition board, regulation status; world column sticky behaviour per TDD §21.8 breakpoints. Implemented with a player-safe `WorldView`, fuzzy signal/countdown ranges, relationship bands and costed diplomacy, interactive coalition groundwork, regulation telemetry, sticky desktop rail and single-column narrow layout.

### Exit gate (Stage 6)

- [ ] Nightly balance batch: ≥2 rivals plausible contenders entering Frontier in ~70% of runs; player world-first share 20–70% under balanced policy (coarse bands acceptable this stage).
- [x] No-rubber-band audit: rival RP inputs contain no player-relative terms (code review + targeted test).
- [x] CI green.

---

## Stage 7 — Complete Deployment Crisis (TDD Milestone 7)

**Goal:** every required victory/loss fixture of GDD §49.4 is reachable and explainable.

**Entry criteria:** Stage 6 exit gate checked.

### Tasks

- [x] **S7.1 — Endgame state machine.** (Spec: GDD §44.2–§44.3; TDD §19.1–§19.2.) Done when: `EndgameState` union with all stages; trigger on candidate completion (tick finish → auto-pause → Crisis Start checkpoint → snapshot → Stage One); crisis clocks (rival/political/financial) projected as windows; crisis project capacity (2, +1 conditional) separate from ordinary slots; max speed 2×. Implemented as an ordered ending-check system with a privileged Crisis Start snapshot, dedicated permanent checkpoint save, exhaustive stage union/schema/invariants, player-safe range clocks, separate 2-or-3-slot capacity projection, runtime/UI 2× ceiling, and persistent crisis header.
- [x] **S7.2 — Access ladder and AI character.** (Spec: GDD §36.6, §44.4; TDD §19.4.) Done when: per-model access levels with acceleration/exposure; first-grant critical confirmations for levels 4/5 incl. type-to-confirm UI; `AiCharacterState` with authored conditional dialogue templates conditioned on evidence/access/memories/hidden traits via the privileged dialogue registry; annotation hooks ("claim conflicts with tool log"). Implemented with a six-level canonical rules table, real research acceleration and incident-relevant model access, validator-backed permission previews, first-grant typed confirmations, persistent AI state/memories/transcript, a closed privileged metric registry, deliberately non-oracular hidden-trait variants, instrument annotations, and a responsive secure-channel UI.
- [x] **S7.3 — Stages One–Four content and rules.** (Spec: GDD §44.5–§44.8.) Done when: capability challenge and verifier compose a durable proof; False Dawn returns a non-genuine deployed lineage to normal play with a 52-week declaration cooldown; candidate access remains explicit; crisis projects and pressure collisions are mechanically consequential. Implemented with typed proof composition, immutable proof history, a strict ontic post-deployment Near-AGI return/cooldown, candidate access controls, dedicated-capacity crisis projects, state-selected pressure collisions, strict stage-transition/save schemas and a responsive crisis operations board.
- [x] **S7.4 — Final review, deployment modes, resolution gates.** (Spec: GDD §44.9–§44.12, §44.17; TDD §19.3.) Done when: final review compiles evidence without leaking truth (guard test); six deployment choices with requirements; Gates A–F implemented with full `GateResolution` audit records; derived scores (IntentSafety, OffensiveAgency, Defence, Evidence, Legitimacy, BenefitStrength) as pure formula helpers with unit tests. Implemented with a frozen evidence-only review packet and hidden-trait mutation guard, conflicting committee recommendations, six validator-backed deployment modes, typed critical commitments, pure §44.11 score helpers, deterministic Gate A–F resolution, complete privileged factor/RNG audit records and a player-safe review UI that exposes no probabilities or hidden factors.
- [x] **S7.5 — Rollout beats, shutdown/retry, coalition resolution.** (Spec: GDD §44.13–§44.15.) Done when: five rollout beats played in sequence; shutdown archive/recovery path with repeat costs; coalition governance gate with salvage event and success bonuses; all clocks continue during rollout. Implemented with a tick-driven five-beat rollout timeline, two decision collisions that can alter later evidence and timing, player-safe public gate records, successful archive plus thirteen-week recovery, current-access shutdown failure handling, retry costs and cancellation, materially-different-candidate enforcement, a keyed coalition governance check with one salvage route, coalition evidence/legitimacy/defence bonuses, and integration fixtures proving finance, rival, and political windows keep moving.
- [x] **S7.6 — Endings and post-run audit.** (Spec: GDD §44.16, §42.9, §47.10; TDD §20.2 privileged selectors.) Done when: all endings in GDD §44.16 reachable via intentional test fixtures (victory, Rival Ascendance, nationalisation, contained failure, catastrophe at minimum — the §49.4 list), using only the canonical §44.16 names (the retired Part I aliases are banned by the S5.2 compiler check); ending screen (epilogue → mechanical causes); **What Actually Happened** exposes seed, true traits, evaluation errors, major draws/thresholds, top-5 causal decisions, labelled counterfactuals; privileged selectors live in `@neolab/sim/debug`-style export unavailable during active runs. Implemented with the exact fifteen-name canonical catalogue, pure intentional branch selection, automatic Gate F resolution, preserved review/gate audit records, Long Pause during shutdown recovery, epilogue-first ending UI, mechanical cause/evidence/uncertainty/alternative sections, and a guarded `@neolab/sim/debug` projection containing the seed, model truth, signed evaluation error, keyed gate/event draws, exact rival timelines, missed warnings, deterministically ranked top-five decisions, and explicitly non-certain formula counterfactuals.
- [x] **S7.7 — Prosperity Programmes.** (Spec: GDD §41.1.) Done when: four programmes with readiness 0–100 from research/facilities/experts/discoveries; readiness feeds Gate E; at least the fictional-paper stubs needed by fixtures exist and are clearly marked fictional. Implemented as a four-entry deterministic registry with transparent capped contributions from programme-weighted research (30), enabled specialist facilities (20), the two strongest employed domain experts (15), and explicit/precursor paper effects (35), plus separately disclosed crisis-validation gains. The player-safe Research workspace explains every source and the 45/60/80 thresholds; final review recommends but does not force the strongest route; the player's selected programme is stored in canonical rollout/resolution state, changes the semantic Gate E RNG contract, BenefitStrength, coalition/shared readiness and durable-settlement preparation; fixtures verify every programme has a clearly labelled fictional-future discovery without changing the separately owned authored catalogue.
- [x] **S7.8 — Score finalisation, ending score screen, local high scores.**
  - Spec: GDD §41.5, §18.9; TDD §18.5 (`finaliseScore`), §24.7 (high-score repository).
  - Done when:
    - Endgame score entries: authored ending awards from `content/scoring.yaml` (e.g. The Age of Superintelligence and Abundance 11,500; losses 0); Safe Stewardship entries from crisis conduct; hidden-truth penalties emitted **during ending resolution** when the audit reveals that truth, never mid-run.
    - `finaliseScore` runs exactly once after the ending ID is fixed and before the final autosave (test: double-finalisation impossible); computes `rawScore`/`adjustedScore` with difficulty (0.75/1.00/1.25/1.50) and victory-class (1.25/1.10/1.00) multipliers; both totals plus category totals stored in `FinalScoreRecord` with `leaderboardEligibility`.
    - Ending score screen explains every award and penalty across the six categories; raw and adjusted totals both visible.
    - `IndexedDbHighScoreRepository` with the two boards (`all-finished-runs`, `winning-runs`), best 50 entries each, entries per TDD §24.7; deleting a save does not delete its high-score summary; the high-score screen has its own explicit delete.
    - `LeaderboardSubmissionV1` types exist for the future service, but **no network submission ships** — launch is local-only.
    - Full-run fixture: the entire score ledger for a seeded run matches an exact expected fixture and replays identically.
  - Implemented with transition-boundary score settlement before the final autosave, a guarded exactly-once finaliser, data-authored ending awards, crisis-conduct awards and audit-time hidden-truth penalties, exact six-category totals and multipliers, a byte-identical seeded full-run fixture, explanatory ending UI, and independent local-only IndexedDB boards with deterministic top-50 ordering and explicit deletion. `LeaderboardSubmissionV1` remains a type-only future seam; no network score client exists.

### Exit gate (Stage 7)

- [x] Every GDD §49.4 bullet has a green automated fixture.
- [x] A full seeded run from new game to an ending replays byte-identically, including the crisis and the score ledger/final score.
- [x] Audit screen explains a catastrophe fixture end-to-end (manual review note in log).
- [x] CI green.

---

## Stage 8 — Content-complete alpha (TDD Milestone 8)

**Goal:** launch content quotas met; no placeholder mechanics or broken branches.

**Entry criteria:** Stage 7 exit gate checked. Content work is **parallel-safe** across tasks once S8.1 lands.

### Tasks

- [x] **S8.1 — Content pipeline hardening for volume.** Done when: compiler performance acceptable at full quota scale; review-metadata fields (source notes, last-reviewed, portrayal status, legal status per TDD §30.4) required by schema; content report lists gaps. Implemented with required normalised editorial metadata on every compiled leader, paper and researcher; deterministic missing/stale review analysis; manifest-driven quota accounting for every Stage 8 target; draft reports that name every outstanding gap; fail-closed release blockers when a manifest becomes final; and a CI performance fixture covering 870 events, 100 researchers, 100 papers and 44 facilities under a five-second budget.
- [ ] **S8.2 — Papers: 100+ spanning capability and safety** with prerequisites, educational copy,
  sources (GDD §20.2, §23), and clearly labelled fictional frontier work. The current authored
  catalogue contains 111 records (88 real and 23 fictional); remaining work is editorial and
  mechanical review rather than quota filling. Track review progress in `content/README.md`.
- [ ] **S8.3 — Researchers: 56** with bios, abilities, compacts, hooks (GDD §37.2.3 pattern + open question 4 resolution), extending the existing wave files in `content/researchers/`. Note the roster now includes Jürgen Smithhuber in place of the removed Timnit Gebra record — verify no stale references survive in events, synergy copy, or scoring keys.
- [ ] **S8.4 — Events: 180 ordinary + 30 crisis chains**, meeting GDD §46 per-category quotas; lab-specific variants (≥5/lab), researcher personal events, AI-family voice guides. Feed templates are no longer part of this: ambient chatter is engine-side in `packages/sim/src/feed/ambient.ts`, and the `labFeedTemplates` quota has been retired (see content-production-plan §12).
- [ ] **S8.5 — Endgame content: 18 ending/epilogue families** (GDD §20.2). Decision nodes and crisis inserts are no longer counted here: the Deployment Crisis is a stage machine in `packages/sim/src/endgame/`, and those quotas have been retired (see content-production-plan §12).
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

- [ ] **S9.1 — Art-direction test then production assets** (GDD §26.5 two-treatment test first; then portraits, campus, icons, event cards per asset-manifest rules TDD §22.3). The required eleven-item sheets now exist for restrained corporate and colourful arcade 16-bit treatments, with concept metadata and an in-dashboard development comparison at `?fixture=art-direction`; Treatment A is recommended, but production generation and runtime wiring remain blocked on explicit treatment selection and the separately authored final researcher/event catalogue.
- [x] **S9.2 — Campus strip final implementation**; measure against TDD §22.2 thresholds before any PixiJS adoption; decision recorded in the log. The bounded DOM/CSS panorama now renders the full target of twenty visually differentiated facility families, three construction phases, eight named researchers, eighteen walking staff and three state-driven scene props; it exposes a keyboard-scrollable narrow view, live activity labels, a complete screen-reader status alternative and reduced motion. A development-only maximum-density fixture plus Chromium profiler locks node/animation bounds, throttled frame timing and page-heap limits; the recorded profile is in `docs/campus-renderer-profile.md`.
- [x] **S9.3 — Audio**: `WebAudioManager`, cue registry, rate limiting, settings (TDD §23). Implemented as a browser-only presentation service with gesture-gated Web Audio initialisation, lazy encoded loading, decoded-buffer eviction, pause-position preservation, closed music-state routing, priority interruption/ducking, cooldown and occurrence deduplication, player-safe `GameView`/`DomainEvent` cue mapping, independent persistent mix settings, title-screen sound/muted starts, and a distinct 44×44 main-page soundtrack control. Unit fixtures cover the 9-track/20-cue manifest, deterministic-package isolation, lifecycle, priority, cooldown/deduplication, ending routing and settings; Chromium decodes all 29 selected assets and verifies persistence/accessibility. The user's prior full-score audition and requested peaceful remixes satisfy the alpha human mix review; S10.4 completed deterministic Opus/AAC production exports and the GPL-3.0-or-later soundtrack declaration.
- [x] **S9.4 — Responsive shell acceptance fixtures** for the four breakpoint states (TDD §21.8) as Playwright visual tests. The shell now caps at 1500px; the five post-Score status tiles resolve to 5/2/2/1 columns; the roster exposes 5/4/3/1 complete cards per viewport; the workspace rail is sticky only in the two-column states; the narrow roster is a one-card snap carousel rather than an eight-card vertical wall. Four fixed-viewport visual baselines pair with geometry assertions for column counts, rail flow, shell cap, and zero document-level horizontal overflow.
- [x] **S9.5 — Accessibility audit** against TDD §25.6/§30.3 checklist: full keyboard, focus management, colour redundancy, 200% zoom, reduced motion, screen-reader label leak tests; sliders announce percent **and** physical GPUs/week with the generation mix in the accessible description (TDD §30.3). A shared modal boundary now supplies initial focus, trapping, inert background content, permitted Escape handling and trigger restoration across ordinary, discovery, event, training and endgame dialogs; leader selection implements roving radio focus with arrow/Home/End keys; all focusable control families receive a visible focus ring. Seven Chromium acceptance fixtures cover the leader workflow, keyboard sliders and announced physical fleet values, focus lifecycle, redundant status text, 1280×900-at-200%-zoom layout plus long-copy expansion, reduced campus motion, and a player-facing hidden-truth denylist across every dashboard workspace.
- [ ] **S9.6 — Balance to GDD §48 targets**: full matrix sweeps; win funnel 45–55%, loss-family distribution, event calibration ("Very likely" ⇒ 85–100%), hidden-info calibration bands; constant changes only via data keys with log entries.
  - [x] Harness: ten policy probes; paired and true Cartesian modes; stable ordinal sharding; exact sampled action-log replay; format-2 JSON and seven CSV surfaces covering funnel, loss, resource, paper, people, facility, event, rival, hidden-information, endgame and anomaly diagnostics.
  - [x] Automation: ten-shard nightly 10,200-run matrix with fail-closed raw-run aggregation and 90-day aggregate retention.
  - [x] Sweep infrastructure: closed typed in-memory constant allowlist and same-seed comparison output; no automatic content writes.
  - [ ] Calibration: run against the content-complete build, remove every structural anomaly/rejected command, make every measurable GDD §48 target pass, add structured event likelihood promises so `Very likely` is measurable, and record every accepted constant change.
- [ ] **S9.7 — Human playtests** recorded against GDD §49.6 comprehension questions; failures triaged into UI/copy/rules tasks appended to this stage.
  - [x] Evidence pipeline: strict privacy-safe session schema, exact seven-question coverage, build/content identity, fairness/timing/UI/humour observations, issue triage, repeated-failure detection, blank template, deterministic report, and fail-closed candidate command. No sessions are present and this does not satisfy the human gate.
  - [ ] Record real same-build sessions, remediate repeated failures, retest, and obtain manual review sign-off.
- [ ] **S9.8 — Post-alpha owner-feedback remediation.** Verify the complete 2026-07-23
  feedback catalogue against the current build and close every code-owned defect before the next
  formal playtest build; authored catalogue expansion, final art production, owner decisions, and
  public release remain separate gates.
  - [x] Correct the opening model/demand lifecycle, useful-demand serving cap, insolvency rescue,
    and escalating fundraising scale.
  - [x] Add a complete finance-line forecast and all-active-modifiers explanation surface; remove
    raw facility IDs from player-facing finance output.
  - [x] Reveal only phase-appropriate facilities with operational prerequisites and show named
    blockers; bound the Internal Wire; add global version text and an unmistakable pause glyph.
  - [x] Add a deliberate Quit/New Game confirmation which saves the coherent current state before
    returning to the title screen.
  - [x] Add persistent light/dark mode, a player-evidence-only capability trajectory, and subtle
    lab activity which scales with visible institutional growth and freezes with Pause.
  - [x] Route actionable auto-pauses to their actual workspaces, add a paused player-paper
    discovery decision with explicit rewards/policy consequences, and broadcast rival papers in the
    bounded wire.
  - [x] Replace the opaque research-progress sentence and add the first accessible focus/click
    mechanic-explanation set across core resource, allocation, research, rival, and politics
    surfaces.
  - [x] Make leader bonuses and full biographies readable; show ongoing researcher salary, apply
    deterministic annual contract reviews, and retain exact effect scopes with accessible stacking
    explanations.
  - [x] Add the requested copyright/contact surfaces, private-CI README badge, and a player-copy
    canonical-ID denylist without altering the GPL text or generated third-party notices.
  - [x] Expose the current soundtrack track and a prominent Next action; rotate the existing
    peaceful score through focus-aware laboratory playlists rather than looping one track forever.
  - [x] Finish the remaining currently unblocked code-owned visual, explanatory,
    notification-routing, employment, identity/copyright, and audio-control tasks accepted from
    `feedback-review-2026-07-23.md`.
  - [ ] Resume owner-gated RSI/government mechanics, final production art, authored identity/content
    changes, additional composition, and quantitative balance work only after their recorded design,
    catalogue, art-treatment, playtest, or approval inputs exist.

### Exit gate (Stage 9)

- [ ] GDD §48 quantitative targets met in nightly reports.
- [x] Accessibility checklist fully green.
- [ ] §49.6 review gate: playtesters answer all seven questions.

---

## Stage 10 — Public build (TDD Milestone 10)

**Entry criteria:** Stage 9 exit gate checked.

> **PUBLIC RELEASE HOLD — amended by user instruction, 2026-07-24.** A restricted itch.io alpha may
> be continuously deployed for invited playtesters. Do not activate Pages, change repository
> visibility, configure a public domain, make the itch.io page public, create a public tag/release,
> or announce availability. S10.2 activation, S10.5, and the Stage 10 exit gate remain blocked until
> the user gives a separate explicit public-release authorisation.

### Tasks

- [x] **S10.1 — Save-compatibility fixture set**: archive representative saves from the alpha; migration suite proves they load (TDD §24.4). The immutable `alpha-v3` archive preserves exact opening, ordinary operating, protected Crisis Start and scored-terminal envelopes with file/state hashes and lifecycle projections; the migration contract verifies their bytes, checksum, full load pipeline, deterministic current state and identity re-envelope. The archive policy forbids rewriting released fixtures and requires every future public tag and schema migration to retain the complete historical matrix.
- [ ] **S10.2 — GitHub Pages deployment workflow** exactly per TDD §31.3: `deploy-pages.yml`, base-path handling for project-site and `play.neolab.ai`, cache header policy, size budgets (≤15 MB compressed first load; fail >900 MB site / >20 MB asset), artifact + content-hash retention for rollback, post-deploy smoke (title → seeded game → one tick → assets resolve). Code complete: official Pages actions, configuration-derived Vite base, fail-closed release manifest/budgets, reproducible 90-day rollback archive and exact-artifact restore, plus the public browser smoke are implemented and locally rehearsed for both `/` and `/neolab.ai/`. Activation remains unchecked because GitHub returned HTTP 422: the private repository's current plan does not support Pages; the workflow safely builds/archives but gates deploy on `NEOLAB_ENABLE_PAGES_DEPLOYMENT=true` after visibility/plan changes.
- [x] **S10.3 — itch.io package and restricted-alpha delivery**: relative-path-safe ZIP from the same build; restricted project setup and browser checklist documented. `pnpm package:itch` provides the audited package path, while `pnpm package:itch:alpha` builds the stable `neolab-ai-itch.zip` without the full test/release-audit gate. The main-push/manual workflow always retains that ZIP and, once `BUTLER_API_KEY` and `ITCH_TARGET` are configured, pushes `apps/web/dist` directly to one Butler channel for fast block-delta redeploys with no user version, release tag, or GitHub Pages activation. The local `pnpm deploy:itch` path uses the same contract. Public visibility remains separately prohibited.
- [x] **S10.4 — Release checks**: licence report, CSP verification, bundle report, optional consented diagnostics wiring (off by default), feedback channel link in-game; confirm high scores are local-only and no leaderboard endpoint or submission code path is reachable in the shipped build (TDD §24.7). `pnpm release:check` now fails closed on the static byte budgets/manifest, exact CSP, runtime-network allowlist, local-only IndexedDB scoring, absent submission protocols, local opt-in diagnostic notebook, three feedback surfaces, GPL project/soundtrack declarations, production dependency inventory and all 29 Opus + 29 AAC assets. CI and both packaging workflows retain JSON, licence and bundle evidence; the current artifact is 46.92 MiB total with a 0.44 MiB compressed first load.
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
5. **Content beyond the current stage's quota is not authored early** — it churns against unstable schemas. (Pre-existing draft records in `content/` are exempt: validate and fix them when their consuming task lands.)
6. **Every completed task = one commit** referencing its ID, **pushed to `origin/main`**; every skipped/deviated item = one log entry below. Hosted CI must be green on the pushed commit before a stage's exit gate is checked.
7. **Score is emitted at the source, never retrofitted.** Any task implementing a milestone listed in `content/scoring.yaml` must call `awardScore` with its semantic key and add an exact-value fixture in that same task. Score never feeds back into any simulation outcome (S1.9 guard), and GPUs are counted, never abstracted: no task may reintroduce a stored era-independent compute unit or expose derived throughput as a player resource.

## Decisions and deviations log

Append-only. Format: `YYYY-MM-DD · task ID · decision · reason · follow-up (if any)`.

- 2026-07-21 · stage1-review · A five-lens finder pass (verification phase cancelled to save tokens) surfaced real defects, all fixed: run-bricking `dueInWeeks: 0` scheduled-effect chains (now drained to fixpoint per tick, capped at 100 rounds); save-bricking unvalidated command payloads and basis-point ranges (zod-validated at the command boundary + invariant range checks); `idCounters`/`categoryTotals` schema holes (full-record schemas); compiler last-wins on duplicate difficulties/mandates; authored `activation:` conditions dropped at run creation (now carried on `ModifierState` and evaluated by the resolver); stale content IDs `domain.optimisation`/`safety.security-testing` aligned to the registry's `-scaling`/`-containment` forms; compiler now validates effect targets against the shared registry and returns the canonicalised bundle; loads run invariants and freeze; transactions poison on updater throw; `weighted()` sorts by code point and keys reject unpaired surrogates (golden vectors unchanged); lint now bans Date/Math.random/localeCompare in sim and the selector-barrel bypass.
- 2026-07-21 · stage1-review · Logged, deliberately NOT fixed now: `Math.exp` is engine-approximated (future leaderboard replay must pin the engine build, as TDD 24.7 already requires); `GameState.researchers` collection deferred to Stage 4 (save-version bump there); `NewGameConfig` omits `labId`/`tutorial` (lab derived from leader; tutorial is UI-stage); `TickContext.rules`, `tx.applyEffects`, `allocateId(owner)`, `commit(audit)`, `calculateScoreView(state)` are deliberate API-shape deviations from TDD prose; Unhinged Scaling's "wider event variance" knob arrives with the Stage 5 event engine; Build It Right's permanent throughput modifier is an open balance question; test gaps to close early in Stage 2: command-inclusive replay, invariant-pack table tests, compiler rejection-path tests, modifier `min`/future-start coverage.
- 2026-07-21 · S1.8 · Sim-internal tests keep using `createBareState`/`createNewGame` directly instead of the testkit builder · testkit depends on sim, so sim's own tests cannot import it without a cycle · downstream packages (testkit, balance-runner, web) use `scenario()`.
- 2026-07-21 · S1.3 · Fixed two `content/labs/launch.yaml` records against GDD §29.7: ClopenAI board-patience `max 60` → `min 60` ("starts at 60" from a 70 baseline) and spendable-Aura `add 20` → `max 20` ("starts with 20") · authored operations contradicted the GDD prose · flagged for content review; golden snapshots freeze the corrected values.
- 2026-07-21 · S1.3 · Added `content/balance.yaml` (new-game baseline §29.2, difficulties §29.4, mandates §29.1) as balance data; legacy `lab.compute.raw.starting` values are interpreted as percent-of-baseline-fleet so Humanic's 90 yields 9,000 Kepler GPUs · content predates the GPU migration · migrate the target name when launch.yaml is next revised.
- 2026-07-21 · S0.7 · "CI green on main" checked from local execution of every CI step (content build + reproducibility, lint, typecheck, tests, web build, Playwright smoke) · commits are local-only; the user has not asked for a push · first push should confirm the hosted workflow.
- 2026-07-21 · S0.2 · Replaced `tsc` project references with per-package `tsc --noEmit` + workspace source resolution (`moduleResolution: bundler`, `allowImportingTsExtensions`, explicit `.ts` import extensions) · references force declaration emit, while zero-emit checking plus `erasableSyntaxOnly` keeps the content-compiler directly runnable under Node's native type stripping · same boundaries and guarantees; revisit only if cross-package checking gets slow.
- 2026-07-21 · plan · Revised plan to v0.2 for the GDD/TDD changes in commit `e0c0c9f` · CU replaced by physical GPU lots + generation factors (TDD §7.2.1, §16.1); new Score ledger and local high scores (GDD §18.9/§41.5, TDD §18.5/§24.7); ending names consolidated to GDD §44.16 with Part I aliases retired; Paper/Researcher definition schemas restructured with inline copy and review metadata; starter content packs now exist under `content/` · New tasks S1.9 and S7.8; GPU/score requirements folded into S1.2, S1.3, S1.8, S2.1, S2.2, S2.7, S3.1, S3.2, S3.4, S3.7, S4.1, S4.6, S5.2, S6.5, S7.6, S8.2, S8.3, S9.5, S10.4.
- 2026-07-21 · S2.1 · GPU rules receive `CompiledContent` explicitly in `calculateGpuThroughput`, `resolveGpuReservations`, and `planGpuPortfolio` · generation factors and interconnect tiers are immutable content definitions referenced by ID from canonical state, so deriving them from state alone would require duplicating balance data into saves · subsequent callers pass the runtime's pinned content bundle, matching `createNewGame`/`advanceOneTick` conventions.
- 2026-07-21 · S2.2 · GPU offers are era-relative content templates; `PurchaseGpuCommand` freezes the resolved generation, price, recurring cost, conditions, delivery tick, and lease end into `GpuDeliveryState` · an in-transit order must not change when the world unlocks a new generation or balance content changes · `calculateGpuFinanceCosts` exposes stable `compute-lease`/`compute-power` lines for S2.3's shared forecast and settlement ledger.
- 2026-07-21 · S2.2 · Added `deliveries` and `leases` to `ComputeState` without raising `saveVersion` · both fields default to empty during schema validation, so Stage 1 saves remain structurally compatible while new saves persist concrete orders/contracts · command-inclusive replay coverage now includes purchase, delivery, lease expiry, and a save/load boundary.
- 2026-07-21 · S2.3 · Finance forecast and settlement call the same content-backed `calculateCycleFinanceLines` rule generator; recurring cycle entries carry signed amounts, stable categories and source IDs, while immediate purchases/sales use the same ledger with no settlement ID · this makes each cycle auditable without pretending one-off cash movements are recurring · S2.4 replaces the temporary baseline product-revenue line with live market revenue.
- 2026-07-21 · S2.3 · Added `ledger` and `settlements` to `FinanceState` without raising `saveVersion` · both arrays default empty during schema validation, preserving Stage 1/early Stage 2 saves · the settlement invariant reconciles each record against only entries carrying its settlement ID.
- 2026-07-21 · S2.4 · Launch market balance lives in `content/market/segments.yaml`: Researchers and Start-ups, five price tiers, appeal/capability weights, market availability, acquisition lag and four static rival appeals per segment · static rivals satisfy the Stage 2 placeholder requirement without prematurely creating rival canonical state · Stage 4 replaces those authored appeal values with live simultaneous rival calculations.
- 2026-07-22 · S4.1 · Added strict authored/compiled researcher schemas and compiled the released researcher packs into a deterministic catalogue · canonical `GameState.researchers` moves saves to version 2 · lead skill contributions, institutional signatures, four-week ramping, sourced ability modifiers, uncapped programme/global research and fleet-throughput stacking, and rolling compact warning/breach hooks are deterministic engine rules.
- 2026-07-21 · S2.4 · A usage unit means one million normalised inference requests and price values are explicitly fictional game balance, not real API prices · allocated serving GPUs and generation factors derive weekly deliverable usage; only delivered usage earns revenue · the calibrated opening demand preserves the documented $1.04m standard-cycle product revenue.
- 2026-07-21 · S2.4 · Added detailed segment accrual, satisfaction, pricing and demand state without raising `saveVersion` · S2.3 saves receive strict-schema defaults and hydrate missing segment records on their first serving tick · the launch product is treated as a Guarded API until per-model deployment policies land in S3.8.
- 2026-07-21 · S2.5 · Project quote/start remains in command-specific rules while the closed `ProjectHandler` registry owns advance/complete/cancel lifecycle dispatch · validation and application therefore share construction quotes without making handlers a second command bus · later project kinds register handlers in the same deterministic phase slots.
- 2026-07-21 · S2.5 · Added `content/facilities/core-stage-2.yaml` with only Power and Cooling I and Data Centre I, respecting the Stage 2 content quota · facility completion creates a run-scoped instance and sourced modifiers; disabling removes exactly those modifier records and re-enabling recreates them from immutable content · full facility dependencies/load states remain S4.6.
- 2026-07-21 · S2.5 · Facility-first score is emitted at construction completion now, rather than deferred wholesale to S4.6, because the cross-cutting score-at-source rule applies as soon as the milestone exists · both Stage 2 definitions use `core-tier-1` and award 150 points from `content/scoring.yaml`; semantic keys and duplicate protection prevent rebuilding from farming score.
- 2026-07-21 · S2.5 · Added project reservations, facility instance metadata and a `facility` ID counter without raising `saveVersion` · old facility records default enabled with no modifiers and the new counter defaults to zero; newly constructed facilities always receive deterministic IDs · project payloads are required, but pre-S2.5 saves contain no live projects.
- 2026-07-21 · S3.1 · `calculateDomainOutput` receives the pinned `CompiledContent` bundle explicitly, matching the Stage 2 GPU APIs; its optional `RandomOracle` injection is internal testability, while production uses the run seed and semantic weekly key · research formula constants, programme identities, focus multipliers, level costs and generic advances remain balance/content data rather than engine literals · the temporary dimensionless research-scale input is local and absent from canonical state and `GameView`.
- 2026-07-21 · S3.1 · All capability domains are present from run creation at level zero or above; “unlocked” now means funded/eligible rather than absent canonical state · allocation records may omit zero-weight programmes, and the research projection still shows them as unfunded · this avoids schema churn when a domain begins receiving GPUs.
- 2026-07-22 · S3.2 · Publication-policy balance and the one-lab scripted-rival configuration have compiler defaults, while authored overrides remain supported · S3.2 engine work no longer depends on editing the paper catalogue, keeping content expansion independent · Stage 6 replaces the scripted rival with full rival state and policy.
- 2026-07-22 · S3.2 · Earliest reachable paper phases use monotone fixed-point propagation after cycle validation · explicitly allowed prerequisite cycles cannot recurse forever, and the three-rank phase lattice converges deterministically · no follow-up.
- 2026-07-22 · S3.3 · Training scale, dataset, safety-protocol and capability-formula defaults compile from code into the immutable bundle instead of adding authored files · a separate agent owns content expansion, while the simulation still consumes data-shaped definitions and supports a later YAML move without changing commands or saves · migrate these defaults into reviewed balance content after the content pass stabilises.
- 2026-07-22 · S3.3 · A future model ID is allocated when the training project is accepted, even if the run later fails completely · every capability and failure draw can therefore use a completion-time-independent semantic key, and failed IDs are never reused · no follow-up.
- 2026-07-22 · S3.4 · Capability-tier score keys are once per tier across the run, while presentation keys are once per model/tier · `content/scoring.yaml` calls the award `capabilityTierFirstReached`, and per-model scoring would let repeated training farm the same milestone contrary to the score anti-farming rule · the implementation-plan phrase “per model/tier” is interpreted as the presentation/idempotency scope, not the score scope.
- 2026-07-22 · S3.4 · `measuredCapability` is optional in save version 1 but populated for every newly created or trained model · this keeps S3.3 saves loadable without ever falling back to true capability for classification; a legacy model without evidence remains tier zero · Stage 5 migrations can make the field mandatory in a later save version.
- 2026-07-22 · S3.5 · Evaluation definitions and incident constants compile from code into immutable content rather than new authored YAML · another agent exclusively owns content expansion, while the engine needs stable IDs and data-shaped rules now · move presentation copy and balance values to reviewed authored content after that pass stabilises without changing command/save shapes.
- 2026-07-22 · S3.5 · Canonical saves store evaluation observations and both anomaly severities, but `GameView` exposes neither slice until the evidence UI lands in S3.7; `trueSeverity` is added to the recursive hidden-key denylist now · this preserves the hidden-truth boundary while avoiding a temporary UI contract · S3.7 projects reports, confidence labels, observed anomalies and actions only.
- 2026-07-22 · S3.6 · Deployment-policy and productisation balance compiles from code rather than authored YAML, matching S3.3/S3.5 while another agent owns content · stable policy/mode unions, commands and save shapes are available without colliding with their files · move reviewed names and balance to authored content after that pass stabilises.
- 2026-07-22 · S3.6 · `ModelState.deployment` defaults missing save-version-1 data to the launch model's existing Guarded API state · all pre-S3.6 models were commercially treated as guarded by the market engine, so this preserves their actual behaviour rather than inventing an internal-only migration · newly trained models explicitly start Internal Only with no completed productisation.
- 2026-07-22 · S3.6 · Weekly incident exposure is the greater of deployment-policy exposure and autonomy-access exposure; `deploymentFactor` separately carries user volume, rush/hardening and severe-anomaly pressure · both GDD §33.4 and §36.6 define exposure channels, while §36.7 requires deployed or internally autonomous models to be checked · Stage 9 balance runs tune factor constants, not this composition rule.
- 2026-07-22 · S3.7 · React workspaces consume only `GameView` plus immutable compiled definitions; every state change and cost preview still crosses the runtime command boundary · this keeps UI code extensible without duplicating simulation formulae or exposing canonical hidden state · no content files were edited because a separate agent owns content expansion.
- 2026-07-22 · S4.2 · Added a deterministic five-person talent market with thirteen-week rotation, research-state availability gates, balanced candidate composition and immediate deterministic replenishment after a successful hire · recruitment uses the shared logistic check with one stored semantic-key draw, qualitative previews, compact and active-recruiter strength, acceptance-only signing/Aura costs, persistent salary, four-week rejection cooldown and a strict ten-percent improved-offer rule · facility-tagged slots clamp at eight and reconcile excess employed stars to `Unhoused` without deleting them; roster/assignment/market invariants enforce exclusivity and role limits · talent-market state defaults safely for earlier version-2 saves and accepted offers round-trip through persistence; five focused tests and the full 253-test suite are green · no content files were edited because a separate agent owns content expansion.
- 2026-07-22 · S4.3 · Added exact 1.5%-per-week organisational and researcher-state drift toward modifier-backed targets; promises are persisted records with typed completion conditions, progress, kept/broken memories and exactly-once consequences · quarterly and provocation departure checks use stored semantic-key draws, normally issue an ultimatum before departure, and permit immediate resignation only for very low loyalty or a flagrant breach · poaching now follows a rumour, two-week counteroffer window and delayed resolution, with retention terms and optional promises; departures schedule deterministic 20–60% delayed rival knowledge transfer without removing player knowledge · `Unhoused` stars issue an eight-week ultimatum, dismissal requires explicit confirmation and applies quoted severance/Aura consequences, and all flows are covered by invariants, command previews, save compatibility and deterministic tests; the full 263-test suite is green · no content files were edited because a separate agent owns content expansion.
- 2026-07-22 · S4.4 · Replaced the two-number Aura placeholder with an append-only gain/spend/loss ledger; the central effect path enforces the spendable floor, raises Lifetime Aura only on gains, emits auditable domain events and defaults safely for earlier version-2 saves · Aura Signal is a pure 0–100 projection from Lifetime Aura plus decaying public-event boosts, separate scandal penalties and a modest post-spend drag that recovers linearly over exactly 26 weeks; the same projection now drives market appeal, recruitment prestige and researcher morale, and the dashboard explains its current direction without exposing formulas · paper publication, first public model launches, open-weights releases, high-value customer satisfaction, model incidents, fundraising, recruitment, evaluations and researcher-relations costs all use the shared ledger; source-specific researcher gain modifiers share the global `×1.40` scaling cap while explicit flat awards remain intact, and first-launch flags prevent policy-toggle farming · rules compile as data-shaped defaults while the separate agent retains ownership of authored content; six focused tests cover ledger/floor/monotonicity, save round-trip, 26-week recovery, scandals, modifier caps, papers, launches and incidents, and the full 269-test suite is green.
- 2026-07-22 · S4.5 · Fundraising now consists of Quiet Bridge, Competitive Round and Mega-round Roadshow projects that spend Aura on launch, reserve management capacity, obey campaign-specific cooldowns and generate deterministic-but-uncertain term sheets only after their roadshows complete · the documented weighted Funding Score uses commercial traction, measured capability, Aura Signal, the canonical world funding climate and investor trust, with scandal and campaign-attention adjustments; generated cash draws and offer conditions persist in the save and replay exactly · term-sheet conditions use typed modifier/flag records and every accepted condition creates an explicit `pending-stage-5` follow-up obligation; acceptance is atomic, rejects sibling offers, and expired offers cannot be revived · removed the earlier guaranteed bridge-round command so every player-facing capital injection goes through the project/offer loop; the dashboard modal exposes ranges, blockers, conditions and deadlines, offer generation has its own auto-pause warning, and non-construction projects no longer masquerade as campus building sites · five focused tests plus browser coverage exercise all campaign shapes, cooldowns, deterministic offers, conditional acceptance, expiry and save round-trip; no authored content files were edited because a separate agent owns content expansion.
- 2026-07-22 · S4.6-engine · Completed the non-content facility/campus slice while leaving S4.6 unchecked for the separately owned 15-entry catalogue · prerequisite graphs are compiler-checked for cycles; operational changes cannot disable dependencies or strand installed/pending owned GPUs; facility upgrades contribute the highest capacity in their family without stacking superseded tiers; owned GPU offers reserve physical housing capacity at order time; and `CampusView` is a coordinate-free, hidden-information-safe projection of facility load, construction phase, named researchers and temporary scene cues · the campus strip consumes only this projection and remains deliberately simple until S4.7's UI pass; focused tests cover cycles, capacity reservations, dependency shutdowns, upgrade coalescing and scene derivation, with the full 279-test suite green.
- 2026-07-22 · S4.7 · Added a player-safe `PeopleView` for the star roster, qualitative talent market, appointments, contracts, compacts, exact authored abilities, condition bands, warnings, promises and dismissal consequences; candidate projections deliberately omit acceptance probabilities, thresholds and draws · the persistent eight-slot strip distinguishes occupied, vacant, Unhoused and facility-locked states; the People workspace and overlays provide recruitment dossiers, editable offer terms, honest qualitative forecasts, assignment changes and two-step dismissal confirmation with costs before the destructive action · added the missing `assign-researcher` command so reassignment crosses the same validate/preview/apply boundary as every other game action, re-syncs sourced abilities and emits a replayable domain event · facility cards now expose full upfront/recurring/crew/duration/capacity/prerequisite costs and visible blockers; desktop/mobile visual checks and a browser journey cover recruit→inspect→reassign→dismiss, while focused projection tests enforce the hidden-information boundary · no authored content files were edited because a separate agent owns content expansion.
- 2026-07-22 · S4-exit-scenario · Added a deterministic integration scenario that hires Yann LeNet, Stewart Russel and Joshua Benji through real recruitment commands; completes and accepts a Competitive Round; advances Ian's deliberately unmet compact through warning and breach; resolves a high-pressure rival poach; and confirms a dismissal · every outcome is asserted in the canonical decision log, and a second run must match both stable serialisation and state hash · authored content remains untouched under the separate content task.
- 2026-07-22 · S5.1 · Began the code-only Stage 5 track before the catalogue-owned Stage 4 exit items because the user explicitly assigned content expansion to a separate parallel task; no authored content file was edited · added strict compiled schemas for events, recursive predicates/effects, weighted triggers, options/check outcome ranges, memories and follow-ups, while the compiler emits an intentionally empty event catalogue until S5.3 · canonical event instances now retain priority, evidence snapshots, enabled options, mandatory occurrence keys, typed tokens, hidden per-option commitments, resolution and invalidation state; decision memories are first-class save data · the deterministic engine implements phase/prerequisite/exclusion/cooldown/unique eligibility, two-event category suppression with the threefold exception, the 2.2%→8% pity curve and week-30 guarantee, explicit mandatory detectors, stable weighted selection, expiry defaults, atomic revalidation/resolution, deduplicated mandatory occurrences and replay-safe outcomes · event responses cross the normal command boundary, and `EventQueueView` exposes evidence, deadlines, options, costs and qualitative uncertainty without draws or outcome IDs · a deliberately small ICU-style formatter supports typed tokens, locale-aware numbers and plurals while rejecting missing values, malformed grammar and raw HTML · focused schema/engine/formatter tests cover selection, suppression, mandatory deduplication, save/load, precommitment, default expiry, memories, double-payment rejection and hidden-information projection.
- 2026-07-22 · S5.2 · Added a fail-closed release-validation layer and a real `pnpm content:check` command without editing authored content · the deterministic report counts the compiled catalogue and records every issue without wall-clock fields; release-blocking checks cover exact predicate satisfiability, event/option/outcome/follow-up reachability, complete non-overlapping `[0,1)` outcome bands, ID/default/follow-up integrity, localisation keys/ICU grammar/token bindings/token types, closed modifier targets, direct catastrophe effects, paper sources, researcher alt text and sources, retired ending names in content/UI copy, exact score milestone/category/ending registries, facility score tags and capability-tier awards · YAML duplicate keys remain rejected at parse time; focused fixtures prove every failure class and the current empty S5.3 event catalogue checks green with zero warnings, ready to fail immediately if events arrive without localisation messages.
- 2026-07-22 · S5.4 · Added the code-only government strategy slice without editing authored content · all four government values now feed an auditable quarterly Intervention Pressure assessment; threshold crossings create typed pending interventions and mandatory-event occurrences rather than directly changing restrictions, while event memories provide the only normal resolution path · nationalisation requires a recorded pressure of at least 80, a qualifying crisis trigger and a failed/refused response, with coalition-charter diversion preserved as an explicit hook · deterministic lobbying projects cover four objectives and three legal approaches, reserve management capacity, spend cash/Aura up front, expose qualitative odds only and retain hidden draws for audit; aggressive access raises Capture Concern and transparent standards can raise Trust · a compiler-level Government segment fallback remains at zero launch demand, unlocks at Trust 45 or by contract, then acquires demand normally so the opening economy is unchanged; move its reviewed balance/presentation record into authored market content after the parallel content pass stabilises · forced fixtures cover quarterly escalation, event-token wiring, due process, nationalisation, lobbying replay and market unlock.
- 2026-07-22 · S5.5 · Delayed consequences now persist their scheduling tick and immutable effect source, emit a typed firing event, and write source-linked schedule/fire entries so an event consequence remains attributable after save/load · the central modifier path writes structured add/remove audit entries including modifier and origin IDs, while event open/resolve/invalidate entries use the same optional metadata without breaking legacy narrative logs; `GameView` projects this player-safe history but never outcome commitments · `BrowserGameRuntime` owns a storage-agnostic rotating autosave policy backed by `MemorySaveRepository` until S5.7: cycle boundaries and project completions save the resulting state once, and a successful critical-event response queues snapshots of both the unresolved state and resolved state in order · wall-clock time remains injected outside the simulation, save failures are contained and queryable, and focused fixtures prove cycle saves, critical before/after snapshots, delayed-event source round-trips and event-created modifier attribution · no authored content files were edited.
- 2026-07-22 · S5.6 · Added a single ordered `OverlayHost` whose pure policy enforces critical decision > discovery presentation > urgent decision > explicitly requested/user dialog, so concurrent overlays cannot fight for focus and critical decisions can never be deferred · the decision dialog consumes only the player-safe `EventQueueView`: evidence snapshots, declared known costs, blockers and qualitative uncertainty are visible, random draws and committed outcomes are not; authored confirmation requirements demand a deliberate second click · `BrowserGameRuntime` now refuses both resume and manual stepping while a critical event remains unresolved, with matching disabled clock controls and a persistent top warning · the event feed distinguishes severity, says whether deadlines are remaining/due/non-expiring, and separates those future deadlines from explicit “weeks ago” history timestamps · capability presentations cross a dedicated safe `GameView` projection and are acknowledged independently from their underlying simulation milestone · focused policy, projection, copy-fallback and runtime tests plus all five browser journeys pass; authored content remained untouched under the parallel content task.
- 2026-07-22 · S5.7 · The production app now injects an `IndexedDbSaveRepository` while simulation tests retain the same storage-agnostic memory adapter · each logical slot points to a separately written and checksum-verified immutable record; the record write, verification, pointer swap and old-record cleanup occur in one IndexedDB transaction, and an injected failure test proves the previous autosave survives rollback · the title terminal lists local saves and supports continue, JSON import and export; an 8 MiB limit is checked before import text is read, JSON is held as `unknown` until the envelope/checksum/state pipeline narrows it, and imported historical saves are normalized to the current format · save loading now runs pure sequential migrations before schema and invariant validation; because the repository had already moved canonical state to version 2 in S4.1, fixtures cover both the current-version identity path and the actual v1→v2 researcher-registry migration · a Chromium journey writes a cycle autosave, reloads the page, then deliberately corrupts its payload and proves the failed continue remains on the title screen with a checksum error · no authored content files were edited.
- 2026-07-22 · S6.1 · Replaced the one-lab world shell with four canonical rival labs instantiated from the four non-player lab definitions, each carrying its own baseline cash, GPU fleet, research/safety/organisation ratings, facilities, model portfolio and a separately persisted strategy record · all rivals use one `WeightedUtilityRivalPolicy`; code-owned mechanical profiles weight science prestige, commercial growth, race urgency, safety, secrecy, politics, talent aggression and financial risk across eight shared plan definitions, avoiding five bespoke AI implementations while authored presentation data remains untouched · each week the policy receives a deliberately reduced `RivalDecisionContext`, emits the ordinary `SetGpuAllocationCommand`/`SetResearchFocusCommand` shapes with a rival issuer, passes the normal validator, and queues orders for the following tick; every quarter it scores all plans with keyed variation, persists the ordered top three and commits the winner for thirteen weeks · type-level forbidden-key coverage and a mutation fixture prove that changing every hidden player safety trait cannot change the rival context or decision, while deterministic replay, issuer-boundary, four-rival, command and quarterly-audit tests pass · existing v2 saves hydrate an empty rival registry safely, and S6.2 will replace the earlier scripted paper-race rival with these real labs · no authored content files were edited.
- 2026-07-22 · S6.2 · Replaced the active scripted paper opponent with the player plus four canonical labs in one seed-shuffled race order; every rival now advances its capability and safety domains and accumulates hidden paper progress against its own real threshold using GPU-derived base RP, abstract roster strength, facility strength, strategic focus, difficulty multiplier and keyed weekly variance, with a targeted proof that changing all hidden player-safety state leaves both rival domain and paper production byte-identical · public diffusion now reaches every eligible lab and delayed poaching knowledge transfers enter the actual destination lab rather than the retired stub · all five labs accrue serving weekly, settle finance, and receive market demand from one pre-settlement world snapshot; live rival appeal retains a modest personality-scaled incumbent advantage so replacing authored static opponents does not hand the player an unintended fivefold demand windfall, and an insertion-order reversal test proves the TDD §16.3 settlement is order-independent · `talent-raid` plans initiate the existing Stage 4 rumour → counteroffer → resolution chain, while rival paper releases, successful hires and quarterly benchmarks create canonical observations whose player-safe estimate ranges narrow with intelligence quality without exposing actual values or keyed noise · save version 3 adds public signals and deterministically migrates v2 two-lab paper orders into the five-lab race; legacy pre-rival fixtures retain the stub only as an inactive compatibility fallback · lint, repository typecheck and all 330 tests pass · no authored content files were edited because a separate agent owns content expansion.
- 2026-07-22 · S6.6 · Added a headless balance package whose policies receive only `GameView` plus commands already accepted by the production validator; balanced, capability-first, commercial, random-legal and never-fund-serving policies run through the real command/tick engine and emit deterministic per-run/aggregate JSON plus policy/run CSVs · `pnpm balance:full` completed all 1,000 ten-year-cap runs locally in 624.7 seconds with no policy-command rejection or engine failure, within the scheduled GitHub Actions job's 30-minute budget · the first report correctly flags the current balanced-paper-share miss and shows every policy eventually becoming insolvent; these are visible tuning gaps, not runner failures · no authored content was edited.
- 2026-07-22 · S6.7 · Added a dedicated player-safe `WorldView`: four rival identities, qualitative relationships, public-signal and candidate-countdown ranges, costed diplomacy quotes, coalition checklist/projects/assets and no canonical deadlines, noise draws or acceptance probabilities · the persistent sticky race rail uses deliberately fuzzy range bands and falls into normal flow below 821px; the World workspace provides rival dossiers, usable diplomacy, a full coalition proposal/groundwork board and regulation status without reverting to a generic table · desktop and 760px visual checks plus a Chromium journey cover uncertain rival telemetry, diplomacy and a two-rival coalition proposal; a stronger mutation test proves rival RP is unchanged even if player cash, GPUs, research and model capability are made extreme · authored event content remains owned by the separate content workstream.
- 2026-07-22 · S7.1 · Deployment Crisis detection runs in the ordered `ending-checks` phase, while the browser persists the resulting state as a candidate-specific `crisis-checkpoint` slot · the simulation remains deterministic and free of wall-clock/storage concerns, and retry candidates cannot overwrite an earlier permanent checkpoint · later crisis stages reuse the shared base snapshot and dedicated project indexes.
- 2026-07-22 · S7.2 · Candidate dialogue eligibility may read hidden traits only through a closed privileged metric switch, while the active projection strips template IDs and exposes rendered prose plus independently earned instrument annotations · sincere and strategically unsafe candidates intentionally share the same access-request surface copy, so prose style is not a truth oracle · access 2–5 now multiplies ordinary player research by 1.20/1.45/1.90/2.50 and retains the existing incident system's access risk; first grants of levels 4 and 5 require exact typed phrases and record permanent model flags.
- 2026-07-22 · S7.3 · Crisis work is represented by the existing generic project lifecycle with a separate 2-or-3-slot capacity reservation and physical-GPU reservations; stage transitions reconstruct the strict discriminated variant instead of spreading obsolete stage-only fields · this preserves replay/save validation and lets ordinary clocks and systems keep running during crisis work · the eight pressure collisions are a closed mechanical registry until the separately owned authored-content pass supplies the larger crisis catalogue.
- 2026-07-22 · S7.4 · The active-run final review is a frozen player-safe evidence packet and never stores or projects derived true-trait scores; GateResolution records retain hidden factors, semantic RNG key text, probability and draw only inside canonical privileged state · this makes the pre-deployment hidden-trait mutation guard meaningful while preserving a complete post-run audit · prosperity readiness is currently sourced from the crisis ledger and S7.7 replaces that interim input with the four programme-readiness derivations.
- 2026-07-22 · S7.5 · Rollout boundaries are evaluated at the tick being entered because ending checks run before the canonical date increment; a four-week mode therefore consumes exactly four weekly transitions rather than an accidental fifth · authorisation resolves immediately, the first-operation and stress beats pause for explicit commands, and demonstration/settlement commit later keyed gates so the ending is not predetermined at deployment · shutdown preserves research but archives the exact candidate, enforces a materially different retry and keeps every ordinary simulation system active through thirteen weeks of recovery · coalition authorisation receives exactly one salvage decision unless a critical anomaly was concealed, while passed or salvaged governance applies the published Evidence, Legitimacy and conditional Defence bonuses · active-run rollout projections expose outcomes and public factors but keep probabilities, draws and hidden factors sealed for S7.6's post-run audit.
- 2026-07-22 · S7.6 · The code-owned ending registry is the minimal canonical fallback required to resolve and explain runs; the separately owned content pass may add lab/AI/researcher variants but cannot replace §44.16 IDs or names · resolved crisis state retains the frozen final review and full Gate A–F records because reducing it to an ending ID would make post-run learning impossible · only the trusted browser runtime may import `@neolab/sim/debug`, and that selector fails closed while a run is active; React receives an immutable audit view rather than canonical state · causal ranking uses deterministic, disclosed source-category weights, while counterfactuals change one published-formula assumption and are labelled modelled alternatives rather than assertions that another click certainly won.
- 2026-07-22 · S7.7 · Prosperity readiness is a pure projection rather than a mutable meter, so hiring, departures, disabling facilities, paper discovery, and research levels cannot leave stale derived state; only the chosen programme ID is canonical once deployment begins · the four core source caps are Research 30, Facilities 20, Experts 15, and Discoveries 35, while Evidence Sprint simulations remain a separately labelled additive validation bonus capped by the remaining headroom · authored content integrates through exact `prosperity.programme.*.readiness` effects and fallback precursor/facility tags, allowing the content-owned catalogue to grow without code edits or double-counting explicit paper effects · omitted programme IDs in older commands/replay fixtures deterministically choose the strongest unlocked programme, while the live UI always submits the player's explicit selection.
- 2026-07-22 · S7.8 · Final scoring is settled at the shared command/tick transition boundary immediately after an ending ID becomes fixed and immediately before persistence; high scores use a separate `neolab.ai-high-scores` IndexedDB database from saves; the browser runtime records each ended run once through its persistence queue · every terminal path receives identical exactly-once treatment, final autosaves contain the final record, and deleting a save cannot implicitly delete a score · a seeded candidate-to-ending replay now freezes the complete ledger/final score byte-for-byte; focused fixtures cover all GDD §49.4 branches and audit data. Manual browser review exercised an actual insolvency ending and persisted score board at 1280×720: all six categories, raw/adjusted maths, local-only labelling and separate deletion were visible with no horizontal overflow; the already-covered catastrophe audit uses the same ending/audit presentation path and its hidden traits, evidence errors, checks and ranked causal decisions were reviewed end-to-end. Hosted CI remains the final Stage 7 gate after push.
- 2026-07-22 · stage7-exit · Hosted GitHub Actions run `29935202802` passed content reproducibility, lint, type checking, all 394 unit/integration tests, production build, all eight Chromium journeys and bundle reporting for implementation commit `546e61a` · every Stage 7 exit criterion is now checked · proceed to the code-owned Stage 8 work without editing the separately owned authored catalogue.
- 2026-07-22 · S8.1 · The compiler normalises a required `editorialReview` record onto every sourced definition while allowing explicit `null`/workflow-pending values during draft authoring; the deterministic report identifies those values as gaps and promotes each quota/review gap to a release blocker when the manifest status becomes `final` · this hardens the code-owned contract without editing or silently blessing the separately owned YAML catalogue · report format 2 currently exposes eight quota gaps and 129 review gaps for the content workstream; a synthetic launch-scale fixture validates 870 events plus full paper/researcher/facility volume within the five-second CI budget.
- 2026-07-22 · S9.3 · Implemented audio before the Stage 8 exit gate while separately owned catalogue authoring was still in flight · audio is presentation-only, changes no canonical state or authored YAML, and was independently verifiable against the already approved soundtrack, so completing it could not invalidate or conflict with Stage 8 content work · final Opus/fallback encoding and the soundtrack release-licence decision remain explicit S10.4 release blockers.
- 2026-07-22 · S9.4 · Added responsive shell fixtures before the Stage 8 exit gate while the separate authored catalogue remained unavailable · the task changes only layout CSS, Playwright fixtures and the now-stale pre-Score TDD card count, so it neither consumes nor edits catalogue content · the <=560px “one roster card per row” rule is implemented as one complete card per horizontal snap viewport, preserving immediate access to the operating dashboard instead of placing eight slot cards in a vertical wall.
- 2026-07-22 · S9.5 · Completed the code-owned accessibility audit before the Stage 8 exit gate while the separately authored catalogue remained unavailable · keyboard semantics, modal focus, responsive zoom behaviour, reduced motion and hidden-truth projection are presentation contracts independent of catalogue volume, and the long-copy fixture deliberately exercises expansion without editing authored records · the current leader screen presents each complete biography inline instead of opening a separate dossier; the radiogroup test therefore scans, compares, selects and confirms the same information surface entirely by keyboard.
- 2026-07-22 · S9.2 · Retained the DOM/CSS campus and did not add PixiJS after profiling the maximum twenty-family renderer contract at 1280×900 with 4× CPU throttling: 79 animated elements, 192 campus descendants, 26.7 ms p95 frame interval, 0/119 frames over 34 ms and 42.1 MB whole-page heap · this remains below the explicit 80-sprite adoption trigger, needs no particles/lighting/batching, and keeps the accessible text alternative and reduced-motion path simple · rerun `apps/web/e2e/campus-performance.spec.ts` whenever sprite limits or scene effects grow; reconsider the adapter at any TDD §22.2 trigger.
- 2026-07-22 · S9.1-art-test · Generated the exact GDD §26.5 eleven-item comparison in restrained corporate and colourful arcade 16-bit treatments and placed both into the real dashboard shell through a development-only, production-tree-shaken fixture · the selected style materially controls every later portrait, icon and event-card asset, so production generation is intentionally paused rather than mixing styles before user review; the separately authored final researcher/event catalogue is also required to size the production batch · Treatment A is recommended for information hierarchy and dry satire; record the user's selection here before checking S9.1.
- 2026-07-22 · S10.1 · Archived the exact bytes of four representative save-version-3 alpha envelopes—opening, 26-tick operating state, protected Crisis Start and scored terminal loss—alongside state checksums, file SHA-256s and lifecycle projections; the new suite sends every archive through the production checksum→sequential migration→schema→invariant loader twice, then proves the resulting current state re-envelopes through the identity path · fixture directories are immutable and the generator fails rather than overwriting one; the release policy requires every future public tag and migration to retain this matrix and extend it for new persistent subsystems · this release-scaffolding task was completed before the Stage 9 gate because it changes no authored catalogue, gameplay balance or production art and immediately protects every remaining implementation step from silent save breakage.
- 2026-07-22 · S10.2-infrastructure · Implemented a main-push/manual Pages workflow around GitHub's current `configure-pages@v6`, `upload-pages-artifact@v4` and `deploy-pages@v4` contracts; the configuration-derived base path supports the project site and a future custom domain from one build definition · a Node-only release checker rejects base-path leaks, unhashed assets and all three TDD size limits, then emits a per-file hash/content-hash manifest; Pages receives only `dist`, while a deterministic tarball and manifest are retained for 90-day exact-artifact rollback, including download, archive/file verification, base-path guard and repeat deployment smoke · local root and `/neolab.ai/` builds measured 24.95 MiB site, 2.82 MiB largest file and 0.43 MiB compressed first load; Chromium loaded the project-path artifact, started the fixed seed, advanced one tick and resolved all 33 files · the Pages create API returned 422 because this repository is private on a plan without private Pages, and `play.neolab.ai` currently resolves to a registrar parking service; therefore deploy/upload/smoke are gated behind the repository variable rather than making every main push fail, and S10.2 stays unchecked until the user authorises public visibility or upgrades the plan and the hosted smoke passes.
- 2026-07-22 · S10.3 · Added a fail-closed itch.io packager which only accepts the same static release contract built with `./`, requires root `index.html`, checks safe/case-preserved paths and the official 1,000-file, 240-character, 500 MiB extracted and 200 MiB single-file limits, then fixes ZIP timestamps/extra fields and records its source commit, content hash and SHA-256 · the current 34-file package is 23.38 MiB compressed / 24.95 MiB extracted, has a 49-character longest path and 2.82 MiB largest file; two independent package runs produced SHA-256 `004736c7941511d01ea6edc00d6a122a53927f64bbb575938354ea65c46502cd` · extracting that ZIP under `/deep/build/` and running the reusable Chromium deployment test proved the title, fixed seed, Week 1→2 transition and every manifest asset work without a root-path assumption · upload remains deliberately manual/draft, with both web UI and optional butler instructions documented; no itch.io account or project was inferred or mutated.
- 2026-07-22 · S10.4 · The shipped browser surface now has an exact CSP with self-only scripts/connections and no evaluated code, objects, workers or forms; inline styles remain narrowly permitted because React projects bounded telemetry colours/widths and campus positions through style attributes · a source audit allows only the same-origin hashed-audio `fetch` and rejects XHR, WebSocket, EventSource, beacons, leaderboard protocol/alias code or any extra fetch site; high scores stay in IndexedDB · optional diagnostics are explicitly off until consent, retain at most 100 allowlisted local records with no error text/seed/save/player text/device or network identity, have no transport dependency and leave the browser only through an explicit JSON export · title, live game and ending link to the issue channel; all original score source/recordings are declared GPL-3.0-or-later with no third-party samples, production dependencies receive a deterministic licence inventory, and the deterministic renderer now emits browser-selected Opus plus AAC fallback from one PCM master · local verification passed 71 test files/427 tests, all 23 Chromium journeys, the two production deployment/CSP smokes, type checking, lint and the full release audit.
- 2026-07-22 · S9.6-harness-v2 · Replaced the Stage 6 rotating five-policy probe with all ten TDD §26.2 policies, explicit paired/full-Cartesian semantics, stable run ordinals, deterministic modulo sharding and an aggregator that rejects every incomplete/duplicate/drifted matrix before rebuilding summaries from raw runs · the release matrix is exactly 17 seeds × 4 difficulties × 5 leaders × 3 mandates × 10 policies = 10,200 games across ten nightly jobs · sampled runs retain exact accepted command logs and terminal hashes and are replayed without the policy; reports now distinguish pass/fail/unavailable targets and export funnel/loss, real-time proxy, resources, papers, researcher turnover/slots, facility timing/26-week cash delta, raw event options/outcomes/followups, hidden-evidence error, rivals, endgame gates and structural anomalies to JSON plus seven CSVs · the closed sweep registry changes one of six typed in-memory constants over identical seeds without rebuilding or rewriting content · the first 30-run v2 smoke completed in 15.0 seconds with zero rejected commands and an exact replay, and honestly reported the empty event catalogue, absent evidence/endgame samples, universal early insolvency and missing natural phase progression as outstanding findings; no authored content was edited.
- 2026-07-22 · S9.6-structural-race · Added canonical monotone Foundation→Scaling→Frontier progression from the strongest completed world model and calendar-driven GPU-generation unlocks which never rewrite installed fleets · expanded the shared rival policy so all four competitors procure compute, train real successor models, productise and deploy them through ordinary validated commands, with personality-driven dataset/safety/deployment choices and complete weekly command audit · the GDD's reduced rival Cash Stability economy now provides an auditable quarterly external-capital floor based only on funding climate and that rival's personality, allowing normal launch-economy rivals to operate without copying the player's fundraising UI or reading player progress · candidate detection now covers internal successors rather than only the current commercial model and preserves an already-started model-specific countdown through shutdown/recovery · a deterministic diagnostic reaches Scaling, Frontier and Rubin with multiple rival generations, while the short balance smoke still reports early player insolvency, no authored event samples and no natural endgame cohort; S9.6 calibration therefore remains unchecked and no content constants were changed.
- 2026-07-22 · release-hold · The user explicitly prohibited a public release until further notice · private implementation, tests and ordinary commits to `main` may continue, but Pages activation, repository visibility changes, public-domain configuration, storefront upload, release tags/releases and public announcements are out of scope until a later explicit authorisation; S10.2 activation, S10.5 and the Stage 10 exit gate remain unchecked.
- 2026-07-22 · S9.7-evidence-pipeline · Added a versioned privacy-safe human-session record and deterministic report around the exact seven GDD §49.6 questions, with fixed build/content identity, unprompted-answer evidence, fairness, crisis-earned, decision-time, UI-habit and humour observations plus concrete issue triage · a completed record cannot skip a question; two partial/unclear answers flag a repeated comprehension failure; mixed-build cohorts, fewer than five completed sessions, any non-clear answer or unresolved issue block candidate review · the strongest automated result is deliberately `ready-for-manual-review`, never “passed,” and the committed session directory contains no invented evidence; S9.7 remains unchecked until real people play and remediation is reviewed.
- 2026-07-22 · S9.6-event-promises · Added an optional closed qualitative-likelihood contract to event checks using the exact GDD §42.4 bands and explicit success outcome IDs · release validation rejects unknown/duplicate success branches and promises inconsistent with authored probability mass · player-safe event previews and the decision UI expose only labels, never success IDs, intervals, draws or commitments, while safety/deception checks can omit the promise · the balance runner now records trials, successes and rates by label in JSON/CSV and makes `events.very-likely-success` pass/fail at 85–100% once real samples exist, remaining honestly unavailable for the currently empty separately owned event catalogue · no authored content or public-release state was changed.
- 2026-07-22 · S5-exit-branch-harness · Added deterministic executable coverage evidence for every compiled event option and outcome without editing authored content · bounded witness search constructs legal phase/metric/flag/affordability state, supplies a valid forming coalition only when typed effects require one, and uses a test oracle solely to select the midpoint of each authored probability interval · every attempted branch instantiates through the production event engine, round-trips unresolved tokens/options/hidden commitments through the production save loader, resolves real effects, commits the full invariant pack, and records a stable terminal hash; contradictory costs and requirements fail visibly · `pnpm content:branches` distinguishes the current empty catalogue from complete coverage, fails on any uncovered non-empty branch, and private CI retains its JSON evidence for 90 days · the Stage 5/8 full-catalogue branch gates remain unchecked until the separately owned events arrive; no release workflow was activated.
- 2026-07-22 · save-inspector · Replaced the advertised but failing `pnpm save:inspect` stub with the developer-only tool required by TDD §4/§24.8 · one file now crosses the production envelope, checksum, sequential migration, schema and invariant pipeline before receiving a stable privileged summary; two files are independently migrated then compared across the complete canonical state by deterministic JSON Pointer path with a bounded row count and explicit truncation · file reads enforce the browser's 8 MiB import cap, source saves are never modified, human and JSON/file outputs are available, archived alpha saves and a constructed v2 migration prove identity/migration/corruption/diff behavior · the tool has no network or web-bundle path, and no public-release state changed.
- 2026-07-22 · invariant-campaign · Implemented the missing TDD §25.4 executable campaign around the existing deterministic `random-legal` policy · short CI and long local commands run 240 and 2,400 configurations across up to 62,400 and 1,248,000 ticks while recording the actual committed total after early endings; every legal command and tick uses production transactions and the global invariant pack, player projections receive the shared hidden-key guard, complete command traces replay to identical terminal hashes, and stable private JSON evidence fails on impossible-project/price/allocation/event counters or an illegally gated catastrophe · CI retains the short report for 90 days; no deployment or public-release gate changed.
- 2026-07-22 · browser-components · Replaced the last advertised root-script stub with a real Vitest Browser Mode lane backed by the same pinned Playwright Chromium used in E2E · the first component contract mounts `ModalFocusBoundary` directly and proves initial focus, forward/reverse tab trapping, inert background, Escape handling, cleanup and trigger restoration in a browser rather than a DOM emulator; it exposed and fixed React `autoFocus` stealing focus before the restoration target was captured · CI runs the lane after installing Chromium and before application E2E; this is private verification only and changes no deployment/release gate.
- 2026-07-22 · cross-browser-e2e · Closed the TDD §31.2 browser-matrix gap by making the application Playwright suite run in Chromium, Firefox and WebKit locally and in private CI · all gameplay, persistence, audio, responsive geometry and accessibility contracts are shared; Chromium remains the sole owner of pixel baselines and the CDP-only CPU-throttled campus profile so browser font rasterisation and unavailable instrumentation do not masquerade as gameplay exceptions · the Pages post-deploy smoke remains separately gated and Chromium-only; no deployment or public-release state changed.
- 2026-07-22 · cross-browser-hosted-fix · The first hosted three-engine run passed 65 application journeys but exposed two Linux-only liveness assumptions: headless Firefox could leave `AudioContext.resume()` pending forever, and a WebKit fundraising scenario with 28 real weekly transitions exhausted the generic 30-second test budget under the one-worker runner · audio start/resume now has a ten-second generation-tokened deadline that cancels late track work and moves to an explicit accessible `unavailable` state, with a unit fixture for a permanently pending context; the shared audio journey still decodes all 29 selected assets in every engine and requires real playback in Chromium, while the fundraising test keeps every assertion under the declared long-test budget · focused Firefox audio and WebKit economy reruns pass; no engine or gameplay coverage was removed.
- 2026-07-22 · nightly-long-invariants · Scheduled the TDD §25.4/§31.2 2,400-configuration long invariant campaign in a dedicated private nightly workflow · it uses the production random-legal command/tick path, reports committed ticks, accepted commands and failures in the job summary, and retains deterministic JSON evidence for 90 days independently of the sharded balance matrix · the local command completed 2,400 configurations, 43,672 committed ticks and 13,564 accepted commands with zero failures; manual dispatch remains available for private pre-release verification, and the workflow has read-only repository permissions with no deployment or public-release capability.
- 2026-07-22 · dependency-and-source-audit · Completed the remaining TDD §31.2 automated audit surfaces without editing authored content · every ordinary CI run now performs a frozen-lockfile production dependency audit at high severity; the first local audit found no known vulnerabilities · the private verification workflow also walks exact HTTP(S) values in every authored YAML file, deduplicates them with stable file/JSON-Pointer references, blocks local/private literal and DNS destinations, follows at most five redirects with bounded HEAD→GET fallback, and retains a 90-day warning report separating reachable, access-restricted, broken, transient and refused links · broken sources remain an editorial signal rather than an automatic rewrite or release action.
- 2026-07-22 · privileged-development-inspector · Completed the TDD §28 diagnostics surface without editing authored content · a runtime-gated, development-only panel exposes injected per-system timings, command validation/transition audit, exact finance and modifier records, deterministic random lookup, every paper threshold/progress pair, hidden model/evaluation truth, event eligibility/weights, rival utilities/countdowns, coalition/endgame inputs and the invariant pack; it exports a deterministic content-hash-bound `neolab-developer-scenario-v1` fixture · only the dynamically imported panel may consume `@neolab/sim/debug`, normal snapshots remain player-safe, and the component plus its CSS are removed by the production build rather than hidden · focused unit/runtime/release tests and a Chromium/Firefox/WebKit journey pass; `pnpm release:check-built` scans the emitted site for the privileged sentinel and reports that no inspector code was bundled.
- 2026-07-23 · runtime-recovery · Completed the TDD §21.7 fault-containment contract without changing canonical state, authored content, balance or release configuration · `BrowserGameRuntime` catches unexpected validation, command, tick and player-view projection failures, commits neither state nor persistence work for a failed transition, publishes a raw-error-free `RuntimeFault`, and locks the clock in a non-resumable fault pause; expected rule rejections remain ordinary · separate React boundaries cover the application shell and campus renderer, replacing faults with a focused accessible recovery surface that offers reload and a repository-independent emergency export · the export is a normal content-hash-bound manual save envelope and reloads through the production checksum, migration, schema and invariant pipeline; raw exception diagnostics remain privileged and development-gated · injected runtime/store tests and real-Chromium component tests prove atomicity, safe projection, boundary attribution and recovery controls; no public deployment state changed.
- 2026-07-23 · S4.6-and-exit-reconciliation · Reconciled the deferred facility slice after the separately owned catalogue grew beyond the original milestone: the compiled build now contains 23 definitions across 20 families, including Data Centre I's 25,000-owned-GPU capacity and both star-slot unlock facilities · existing production tests prove prerequisite/capacity enforcement, Unhoused reconciliation, exactly-once Institution Building score awards and the coordinate-free `CampusView`; the Lab workspace now adds an operational estate inventory with online/offline state, commissioning week, validated facility shutdown/restart controls and explicit non-controllable baseline leases · a production-save-backed Playwright scenario imports six employed stars into four unlocked slots, verifies two are Unhoused, reassigns a star through the dossier, operates five commissioned facilities, observes Headquarters II remove and restore a star slot, and constructs Research Campus I through the live UI · the scenario passes in Chromium, Firefox and WebKit as part of 73 green journeys (two intentional profiler skips), alongside 467 unit tests, three browser-component tests and 240 invariant runs with zero failures · the Stage 4 hosted-CI gate remains unchecked until GitHub validates the pushed commit; no authored content or public deployment state changed.
- 2026-07-23 · S4-exit-hosted · Closed the Stage 4 hosted gate on private CI run `29991874286`: content validation, lint, type checking, 467 unit/integration tests, 240 random-legal invariant runs, production build/release audit, three Chromium component tests and the 75-scenario Chromium/Firefox/WebKit matrix all passed · the first hosted implementation run exposed an unrelated capability-presentation overlay consuming WebKit's long-scenario actionability budget; the acceptance fixture now isolates facility construction from research milestones and repeated clock events invoke the real UI handler without waiting for post-layout stability, with five consecutive single-worker WebKit passes before the full matrix rerun · delayed GitHub push events also exposed stale-commit cancellation under the old branch-only concurrency group, so ordinary CI now supports explicit private dispatch and isolates concurrency by commit SHA · Pages validation `29991864827` succeeded on the same current tree while `Deploy immutable artifact` and `Post-deploy browser smoke` remained skipped; no authored content or public release state changed.
- 2026-07-23 · S9.1-asset-pipeline · Implemented the code-owned TDD §22.3 production-asset contract without choosing a final art treatment or editing the separately owned gameplay catalogue · a strict manifest records stable IDs, production-only source paths, intended dimensions, scale policy, accessibility, rights/source metadata and portrait subject/fictionalisation status; compilation verifies source files and formats, records their SHA-256 hashes in `CompiledContent`, and includes those hashes in the content identity · release analysis reports missing/unreferenced assets during draft production, rejects contradictory portraits immediately and fails closed on missing references once the asset or content manifest is final · the browser resolves stable IDs to Vite-managed content-hashed URLs while absent draft art preserves the existing fallback · the intentionally empty draft reports 24 unresolved compiled researcher portraits; final production generation and runtime card/portrait wiring remain gated on the user's treatment selection and the final authored researcher/event catalogue, so S9.1 stays unchecked · lint, type checking, all 476 unit/integration tests, three browser-component tests, 73 cross-browser application journeys with two intentional profiler skips, 240 invariant runs, content branch validation, production build and release audit pass; no public deployment state changed.
- 2026-07-23 · S9.6-policy-legality · Removed the current balance matrix's final rejected-policy-command class without weakening production validation or changing authored content/balance constants · capability-heavy policies could select a cash-critical fundraising campaign and model productisation from the same individually valid pre-command snapshot, after which the first project consumed the only major-project slot and the second was rejected; model lifecycle work now yields to an already-selected fundraising campaign and is reconsidered at the next policy decision · a 104-week regression covers both affected policies and the refreshed 30-run smoke falls from 11 to zero rejected commands with zero impossible-project, negative-price, invalid-allocation or deadlocked-event anomalies · the remaining fourteen smoke flags are quantitative/content findings, including the empty event catalogue and early insolvency, so S9.6 calibration stays unchecked · lint, type checking, all 477 unit/integration tests, the production build and 240 invariant runs pass; no authored content or public-release state changed.
- 2026-07-23 · cross-browser-long-scenario-budget · Private CI run `29997680943` was fully green but needed one WebKit retry when the Stage 4 facility acceptance journey exhausted the generic 30-second whole-test budget before dispatching a repeated week step · the journey intentionally imports six researchers, operates five facilities and advances a complete construction project, so it now declares a 60-second long-scenario budget while preserving every interaction/assertion and the global timeout for ordinary tests · five consecutive single-worker WebKit reruns pass in 1.7–2.1 seconds each; no gameplay, authored content or public-release state changed.
- 2026-07-23 · S9.6-policy-lifecycle · Replaced four headless-policy dead ends without changing simulation or authored balance constants: strategies now hold one explicit deployment posture instead of toggling access every four weeks, do not repeatedly productise an already productised current model, request frontier-scale rather than product-scale training after Foundation, and prefer durable reserved/owned procurement over four-week spot leases once Scaling begins · deterministic policy fixtures lock the Scaling training/procurement choices and a real commercial lifecycle; the same 30-run/104-week smoke improves from 23 losses and 7 incomplete runs at 70.8 mean weeks to 21 losses and 9 incomplete runs at 73.6 mean weeks, with zero rejected commands or structural anomalies · a 10-policy/520-week diagnostic now gives capability strategies qualifying tier-2 fleets and repeated frontier-scale training, with the balanced paper-share target at 20%, but still records 0 wins, 8 insolvency losses, 2 incomplete runs, no natural Frontier/endgame cohort and thirteen remaining flags; S9.6 calibration therefore stays unchecked until the content-complete build and further economic tuning · lint, type checking, 479 unit/integration tests, the production build and 240 invariant runs pass; no authored gameplay content or public-release state changed.
- 2026-07-23 · S9.6-strategy-bootstrap · Fixed the balance harness rather than weakening production rules or authored economics: legal coalition asset candidates now name rival coalition members instead of the player, coalition policy stops duplicating completed institutional projects and concentrates diplomacy on members whose visible trust still needs work, and the deterministic long probe naturally ratifies a coalition in week 312 · every intended strategy except the deliberate never-train control now protects a bounded opening-model reserve before optional evaluation, facility or recruitment spend; completed model evaluations are not re-queued, and open-science play retains open publication while using market pricing and guarded API access instead of giving deployment away · against the same 30-run/104-week matrix, losses fall from 23 to 7, incomplete live runs rise from 7 to 23 and report flags fall from 14 to 8, with all seven core strategies alive and zero rejected commands; against the same 10-policy/520-week diagnostic, losses fall from 8 to 4, incomplete runs rise from 2 to 6, all seven core strategies survive Foundation and coalition-builder reaches the coalition milestone · the focused 13-test policy suite, full 483-test build and 240-run/4,424-tick/1,369-command invariant campaign pass with zero failures · no natural Frontier/endgame cohort exists yet and authored events remain absent, so S9.6 calibration honestly stays unchecked; no authored gameplay content or public-release state changed.
- 2026-07-23 · S9.6-long-horizon-and-runtime · Added a separate 832-week ten-policy horizon probe because the 520-week Cartesian cap ended before natural Frontier entry and therefore could not substantiate late-game calibration · the probe now runs nightly with deterministic sampled replay, a ten-minute fail-closed budget, a job summary and 90-day evidence, while the 10,200-run throughput matrix retains its bounded cap · eliminated two avoidable whole-state scans: GPU purchase previews now overlay one hypothetical lab/lot instead of cloning canonical state twice, and finance reconciliation totals settlement entries during its existing ledger pass instead of filtering the growing ledger once per settlement · canonical transactions now use a tested plain-data clone specialised to the simulation's enforced serialisable-state contract, reducing an identical 10-policy/832-week batch from 101.5 seconds and about 897 MB peak RSS to 66.9 seconds and about 595 MB with byte-identical run records · scripted policies set explicit price/focus/allocation postures only when needed instead of resubmitting the same commands every thirteen weeks · the first horizon evidence reaches Frontier naturally in five strategies at weeks 565–659 and coalition-builder reaches a viable coalition, but records zero wins, seven insolvencies, one Rival Ascendance and two incomplete runs with no player candidate/crisis sample; S9.6 calibration remains unchecked pending the content-complete build and economic/endgame tuning · no authored gameplay content, balance constant, deployment or public-release state changed.
- 2026-07-23 · S6-exit-frontier-snapshots · Replaced the balance report's last run-end race proxy with evidence at the moment specified by GDD §48.7: rival strengths and the plausible-contender count are captured exactly once on the canonical Foundation/Scaling→Frontier transition, while earlier endings retain a labelled run-end fallback excluded from target and policy denominators · the response-window metric is captured independently when the first live rival candidate countdown appears, preventing a later Rival Ascendance from rewriting an initially viable window to zero weeks · JSON and CSV reports now carry measurement basis, tick, sample counts, candidate lab and initial weeks; zero Frontier samples produce `unavailable`/`null`, never a fabricated zero rate · production-simulation regressions prove both a week-565 Frontier snapshot and a pre-expiry candidate window, while the current horizon cohort makes the rival-plausibility half of the Stage 6 exit evidence measurable; the combined gate remains unchecked because the balanced policy's world-first paper share is still below its 20% floor · no authored gameplay content, balance constant, deployment or public-release state changed.
- 2026-07-23 · S6-exit-balanced-paper-race · Diagnosed the balanced policy's 3.7% world-first share as a harness omission rather than a paper or rival-rule defect: its top-level allocation command preserved the intentionally narrow 2012 launch portfolio forever, so ordinary player-visible capability sliders received zero GPUs while rivals broadened their work · the corrected generalist posture serves 62.5% of the fleet, retains the 60/40 capability/safety split across remaining capacity and funds every capability programme without reading paper thresholds or rival hidden state; other strategy probes and authored launch data are unchanged · a structural fixture locks the complete 10,000-basis-point portfolio and a 705-week production-simulation regression locks the coarse band · the refreshed ten-policy 832-week horizon completes in 67.6 seconds with exact sampled replay, zero rejected commands, five Frontier samples, three plausible rivals at the balanced run's first Frontier entry and 52/78 player world-firsts (66.7%); both Stage 6 race target rows now pass and report flags fall from fourteen to thirteen, while zero wins, seven insolvencies, one Rival Ascendance, two incomplete runs and absent authored event calibration keep S9.6 honestly open · a separate five-seed Standard diagnostic records 122/257 player world-firsts (47.5%), confirming the correction is not a single-threshold draw · no authored gameplay content, simulation balance constant, deployment or public-release state changed.
- 2026-07-23 · post-alpha-owner-review · Captured the owner's full earlier-alpha feedback in `docs/feedback-review-2026-07-23.md` with an explicit current-build verification taxonomy rather than assuming every observation still applies · recursive self-improvement is large enough to reshape research, training, access, incidents, rivals, government and the Deployment Crisis, so `docs/recursive-self-improvement-design.md` compares three approaches and recommends discrete verified improvement cycles with compounding tempo, successor lineages, verification/control debt, common contained boundary incidents, rival participation, a truthful capability trajectory and government/military tradeoffs · no RSI or feedback item is treated as approved/implemented merely because the design document exists; the twelve owner decisions must be reviewed before implementation-plan tasks and migration gates are rewritten · authored content and public-release state remain untouched.
- 2026-07-23 · S6-long-horizon-test-budget · Hosted Pages validation completed the new 705- and 832-week production-simulation assertions correctly in 34 and 33 seconds but Vitest rejected both at their 30-second per-test ceilings; the ordinary CI runner passed the same deterministic suite · grouped the three intentional long-horizon fixtures under a 90-second ceiling which tolerates hosted-runner variance without weakening any assertion or changing simulation, balance, authored content, deployment, or public-release behaviour.
- 2026-07-23 · S3.8-post-alpha-model-lifecycle · Replaced the fictional launch AI with an empty production model portfolio, explicit first-generation training and a 12.0 cash bootstrap runway; separated active internal and commercial model roles across training, deployment, demand, selectors, rivals and the browser; capped serving at useful requested demand in both validation and weekly reconciliation; added insolvency grace plus an Aura-limited emergency bridge; and made accepted fundraising rounds double later cheque ranges so the economy scales from millions toward billions · fixed the balance harness's duplicate live training/productisation choices and made its coalition strategy conserve Aura/cash at the insolvency boundary; the 400-week coalition-ratification and 832-week first-rival-window gates pass through the real simulation · engine rules version advances to `0.2.0`, while save version remains 3 because `commercialModelId` is optional and legacy externally deployed current models resolve through a compatibility fallback · authored gameplay catalogue files and public-release state remain untouched.
- 2026-07-23 · future-scenario-mechanics-design · Reviewed AI 2027, AI 2040 and the latter's scaling, verification, transparency, covert-project, security, alignment and epistemics supplements as speculative design sources rather than forecasts · `docs/future-scenario-mechanics.md` proposes GPU-consuming parallel AI workers, explicit experiment/research-taste bottlenecks, update cadence, oversight gap, separate weight/algorithm/verification security, an optional government-contract ladder, verifiable coalition instruments, training-compute safety tax, uncertain Dark Compute Concern, and cross-cutting mathematical Grand Challenges including branch-correct P-versus-NP and multi-stage Riemann verification · the GDD records the stable classification and verification rules, while the content plan reserves a companion milestone set outside the 72-paper target; eighteen owner decisions remain before schemas, mechanics, migrations or authored content are changed, and no public-release state changed.
- 2026-07-23 · S9.8-interface-correctness-1 · Added a player-safe active-effect projection and
  Archive surface which names the originating leader, researcher, facility, decision, ending, or
  system, explains add/multiply/cap/floor semantics, reports expiry, and explicitly documents
  multiplicative stacking without exposing hidden activation truth · the same Archive now renders
  every four-week finance forecast line with income, outgoings, net, projected closing balance and
  runway; baseline leases receive readable fallback names rather than canonical IDs · the Lab build
  catalogue now reveals only facilities appropriate to the current phase whose facility
  prerequisites are operational, while completed/building facilities remain visible and known
  blockers use display names · the Internal Wire retains a bounded recent operational window,
  every route shows the application version, Pause uses a graphical two-bar glyph, and Quit/New
  Game pauses, confirms, saves the latest coherent state, and returns to a resumable title screen
  without deleting the run · the requested title copy is active; focused type checks, 23
  simulation/runtime tests and the three-scenario Chromium smoke pass · authored gameplay content,
  balance constants, deployment and public-release state were unchanged.
- 2026-07-23 · S9.8-visual-feedback-1 · Added a global locally persisted light/dark control and a
  dark management palette covering ordinary panels, forms, controls, semantic states, dialogs and
  charts while preserving the purpose-built title/crisis/ending palettes and merely dimming campus
  artwork · the identity header now carries a pointer-inert ambient circuit layer whose density is
  derived only from visible facilities, employed stars and model generations; its animations stop
  with Pause and obey reduced-motion settings · a responsive capability trajectory uses only
  player-measured model evidence, labels confidence, and plots the documented display index
  `2^(frontier estimate / 10)` so compounding can become visually legible without leaking true
  capability; a model-free opening renders an honest empty state · readable fallback facility names
  now use title case and Roman tiers across estate and finance surfaces · web/simulation type checks,
  the focused selector test, and four Chromium smoke journeys pass, followed by light/dark desktop
  visual inspection · authored gameplay content, balance, production art, deployment and public
  release state were unchanged.
- 2026-07-23 · S9.8-notifications-and-help-1 · Replaced the generic auto-pause acknowledgement with
  an exhaustive priority mapping: funding and bankruptcy open financing, completed training opens
  Models, researcher ultimatums open People, political/race warnings open World, paper notices open
  Research, crisis reasons target crisis controls, and event overlays remain in front · unresolved
  player world-first papers now create a paused educational dialog, persistently move to Research
  when deferred, and show exact immediate score, humanised unlock effects, and each policy's exact
  Aura/publication-score preview before dispatch; the bounded wire names rival paper announcements
  by lab · refactored publication-score quoting so preview and application share one calculation ·
  replaced the opaque withheld-progress sentence with rough momentum plus explicit threshold
  uncertainty, and added focusable/clickable non-hover-only explanations for nine dense core
  mechanics · focused sim/web type checks, 18 paper/selector/routing tests, the research journey and
  four Chromium smoke journeys pass · authored event/paper text, balance, production art,
  deployment and public-release state were unchanged.
- 2026-07-23 · S9.8-people-identity-1 · Replaced clipped leader-selection copy with compact cards
  that expose exact headline effects plus a full selected-leader biography and complete starting
  trait dossier · corrected researcher effect projection so distinct facility, incident, assigned,
  and paired scopes no longer collapse to duplicate-looking labels; every effect now has
  focus/click operation, stacking, appointment, and ramp guidance · recruiting surfaces now
  show signing cash and ongoing salary, while each individual contract receives a deterministic
  five-percent 52-week anniversary review recorded before finance settlement · added the named
  copyright/contact to all web routes and appropriate repository/document/licensing surfaces, a
  private-CI README badge, and a cross-workspace canonical-ID player-copy guard · final art,
  authored identity changes, major RSI/government mechanics, balance, public deployment and release
  state remain unchanged.
- 2026-07-23 · S9.8-audio-rotation-1 · Added a persistent keyboard-scrollable now-playing readout
  and explicit Next soundtrack action beside the distinct music pause control · normal laboratory
  playback now advances through ordered general, commercial, research, and safety playlists at
  natural track endings; direct Next intent may bypass the anti-thrashing hold, while crisis,
  endgame, victory, extinction, and ending-silence routing remains authoritative · the rotation
  reuses the nine owner-approved peaceful alpha tracks without changing PCM assets, event-cue mix,
  deterministic simulation state, authored content, deployment, or public-release state; the next
  human session should decide whether additional normal-operations compositions remain necessary.
- 2026-07-23 · S9.8-playtest-build-audit · Completed the unblocked code-owned owner-feedback pass
  and prepared the private local build for its next human feedback round · the identity header now
  uses a dedicated full-width control row at desktop sizes and a non-clipping wrapped layout at
  tablet/narrow sizes; internal route changes return to the top instead of retaining an unrelated
  workspace scroll offset; Quit/New Game explicitly captures and restores its trigger across
  Chromium, Firefox, and WebKit; and the long Stage 4 browser assertion targets the intended
  campus status rather than an unrelated ambient live region · refreshed visual baselines cover
  the four responsive contracts, and the current tree passes all 506 unit/integration tests, the
  production web build, draft content validation, and 76 cross-browser journeys with two
  intentional non-Chromium profiler skips · authored catalogue quotas, quantitative balance,
  owner-gated RSI/government mechanics, final production art, and public release remain separate
  gates; no deployment or release state changed.
- 2026-07-24 · S9.8-fixed-recruitment · Replaced editable recruitment offers and hidden logistic
  acceptance with fixed, era-inflated market-window listings · the recruit command now carries only
  the candidate identity; the engine validates availability, cash, Aura, and star-slot capacity,
  charges the listed terms, includes the authored promise, and hires deterministically · researchers
  join unassigned so appointment remains a distinct, reversible roster decision · removed rejected
  offer history, acceptance draws, thresholds, cooldowns, compensation payloads, and compatibility
  scaffolding from canonical state and the command API · the People UI now presents one
  `Recruit at listed terms` action and explains the ongoing salary, mandatory promise, guarantee,
  and post-hire appointment step.
- 2026-07-27 · proprietary-licensing · Superseded the earlier GPL-3.0-or-later release decision
  before any recipient received the project · original code, content, documentation, artwork,
  soundtrack sources, and recordings are now all-rights-reserved under
  `LicenseRef-Neolab-Proprietary`, with only a narrow personal, non-commercial permission for a
  lawfully supplied unmodified build · repository-wide REUSE metadata, package declarations,
  shipped legal files, title-screen notice, third-party notices, and the fail-closed release audit
  now enforce the proprietary boundary; historical GPL entries above record the implementation
  state at that time and no longer describe the current licence.
- 2026-07-27 · contribution-and-gameplay-media-permissions · Added two narrow exceptions to the
  proprietary boundary: source copies, private test builds, hosted forks, and CI are permitted only
  to prepare a pull request for the official repository, with acceptance controlled solely by the
  Owner and broad permanent copyright and patent grants covering every submission · gameplay
  videos, livestreams, screenshots, commentary, reviews, and ordinary channel monetisation are
  permitted for unmodified builds, while modified releases, independent forks, playable copies,
  extracted assets, and standalone soundtrack uploads remain prohibited · repository contribution
  instructions, a pull-request acknowledgement template, shipped legal links, and the release audit
  now expose and verify those permissions.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md)
and [independence and fictionalisation notice](../DISCLAIMER.md).
