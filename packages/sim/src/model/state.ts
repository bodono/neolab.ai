import type { ContentId } from "@neolab/content-schema";

import type {
  AnomalyId,
  EvaluationId,
  EventInstanceId,
  GpuLotId,
  LabId,
  ModelId,
  ModifierId,
  ProjectId,
  ResearcherId,
  RunId,
} from "./ids.ts";
import type {
  BasisPoints,
  CashMillions,
  Fraction,
  GpuCount,
  Rating,
  Tick,
} from "./units.ts";
import type { Seed128 } from "../random/seed.ts";

/**
 * Canonical, fully serialisable game state (TDD section 7).
 *
 * Rules: plain data only — no Date, Map, Set, class instances, functions, or
 * non-finite numbers. Entity collections are Record<Id, State> plus explicit
 * order arrays where order matters. Hidden truth lives in clearly named
 * fields (e.g. `hiddenSafety`) and never leaks through normal selectors.
 *
 * Slices marked "grows in Stage N" are structurally present but minimally
 * populated; they gain fields with their implementing plan task.
 */

export type GamePhase = "foundation" | "scaling" | "frontier" | "crisis";

export type FlagValue = string | number | boolean;

export type IdNamespace =
  | "lab"
  | "model"
  | "project"
  | "event"
  | "modifier"
  | "gpu-lot"
  | "evaluation"
  | "anomaly"
  | "coalition"
  | "scheduled";

export interface GameCalendar {
  /** Calendar year shown to the player; starts at 2012 (GDD section 29.2). */
  readonly year: number;
  /** 1-based week within the year, 1..52. Kept consistent with `tick` by invariant. */
  readonly week: number;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** Queued player orders applying at the next tick (TDD section 8.3). Grows in Stage 2. */
export interface QueuedOrderState {
  readonly kind: "set-gpu-allocation";
  readonly labId: LabId;
  readonly allocation: GpuAllocationState;
}

export type AutoPauseReason =
  | "critical-event"
  | "training-complete"
  | "world-first-paper"
  | "resignation-ultimatum"
  | "bankruptcy-warning"
  | "rival-final-year"
  | "crisis-stage"
  | "manual";

export interface RunState {
  readonly runId: RunId;
  readonly seed: Seed128;
  readonly difficultyId: ContentId;
  readonly playerLabId: LabId;
  readonly tick: Tick;
  readonly calendar: GameCalendar;
  readonly phase: GamePhase;
  readonly status: "active" | "won" | "lost";
  readonly endingId?: ContentId;
  readonly queuedOrders: readonly QueuedOrderState[];
  readonly autoPauseReasons: readonly AutoPauseReason[];
  readonly idCounters: Readonly<Record<IdNamespace, number>>;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** World-level shared state (TDD section 31.1 subset). Grows in Stages 2-6. */
export interface WorldState {
  /** 0-100 index of how generous funding markets currently are. */
  readonly fundingClimate: Rating;
  /** Content ID of the newest generally available GPU generation. */
  readonly currentGpuGenerationId: ContentId;
  /** Cooldown bookkeeping for event groups, keyed by cooldown group name. */
  readonly eventCooldowns: Readonly<Record<string, Tick>>;
}

// ---------------------------------------------------------------------------
// GPU portfolio (TDD section 7.2.1)
// ---------------------------------------------------------------------------

export interface GpuLotState {
  readonly id: GpuLotId;
  readonly generationId: ContentId;
  readonly ownership: "owned" | "leased" | "cloud";
  /** Non-negative integer count of physical GPUs. Never a derived capacity. */
  readonly physicalCount: GpuCount;
  /** Portion currently usable (outages, maintenance, seizure). */
  readonly availableFraction: Fraction;
  readonly reliability: Rating;
}

/**
 * Allocation hierarchy stored as integer basis points (TDD section 16.1).
 * Weights within each level sum to exactly 10000; invariants enforce it.
 */
export interface GpuAllocationState {
  /** Serving share of unreserved GPUs; remainder goes to R&D. */
  readonly servingBasisPoints: BasisPoints;
  /** Capability share of R&D; remainder goes to safety. */
  readonly capabilityBasisPoints: BasisPoints;
  /** Weights across unlocked capability domains; sums to 10000. */
  readonly capabilityDomainWeights: Readonly<Record<string, BasisPoints>>;
  /** Weights across safety programmes; sums to 10000. */
  readonly safetyProgramWeights: Readonly<Record<string, BasisPoints>>;
}

/** A fixed physical-GPU reservation held by a project or contract. */
export interface GpuReservationState {
  readonly projectId: ProjectId;
  readonly gpus: GpuCount;
  /** Restricts which generations may serve the reservation, if any. */
  readonly generationIds?: readonly ContentId[];
}

export interface ComputeState {
  readonly lots: readonly GpuLotState[];
  readonly allocation: GpuAllocationState;
  readonly reservations: readonly GpuReservationState[];
  /** Software/scheduling efficiency multiplier, starts near 1.0. */
  readonly softwareEfficiency: number;
}

// ---------------------------------------------------------------------------
// Lab slices
// ---------------------------------------------------------------------------

/** Finance slice (GDD section 8.1). Ledger and contracts land in Stage 2. */
export interface FinanceState {
  readonly cash: CashMillions;
}

export interface AuraState {
  readonly spendable: number;
  /** Never decreases (GDD section 38.1). */
  readonly lifetime: number;
}

/** Visible research state per domain (GDD section 34.1). Grows in Stage 3. */
export interface DomainState {
  readonly level: Rating;
}

export interface ResearchState {
  readonly domains: Readonly<Record<string, DomainState>>;
}

/** Safety-science levels and operational safety (GDD section 36.1). */
export interface LabSafetyState {
  readonly safetyCulture: Rating;
  readonly alignmentScience: Rating;
  readonly evalQuality: Rating;
  readonly controlTheory: Rating;
  readonly practicalControlStrength: Rating;
  readonly securityPosture: Rating;
}

/** Organisational ratings (GDD section 31.3). */
export interface OrganisationState {
  readonly engineeringQuality: Rating;
  readonly managementCapacity: Rating;
  readonly researchFreedom: Rating;
  readonly boardPatience: Rating;
  /** HIDDEN: never projected into player views (GDD section 31.3). */
  readonly hiddenInternalCandour: Rating;
  readonly generalResearchers: number;
  readonly engineersAndOps: number;
}

export interface RosterState {
  readonly starSlots: number;
  readonly researcherIds: readonly ResearcherId[];
}

export interface FacilityInstanceState {
  readonly definitionId: ContentId;
  readonly completedAt: Tick;
}

export interface FacilityPortfolioState {
  readonly instances: readonly FacilityInstanceState[];
}

/** Commercial state (GDD section 33). Grows in Stage 2. */
export interface MarketState {
  readonly marketShare: Fraction;
}

/** Government relationship values (GDD section 38.3). */
export interface PoliticsState {
  readonly governmentAttention: Rating;
  readonly governmentTrust: Rating;
  readonly strategicDependence: Rating;
  readonly captureConcern: Rating;
}

export interface LabModelPortfolioState {
  readonly currentModelId?: ModelId;
  readonly modelIds: readonly ModelId[];
}

export interface LabProjectIndex {
  readonly projectIds: readonly ProjectId[];
}

export interface LabState {
  readonly id: LabId;
  readonly definitionId: ContentId;
  readonly control: "player" | "rival";
  readonly finance: FinanceState;
  readonly aura: AuraState;
  readonly compute: ComputeState;
  readonly research: ResearchState;
  readonly safety: LabSafetyState;
  readonly organisation: OrganisationState;
  readonly roster: RosterState;
  readonly facilities: FacilityPortfolioState;
  readonly market: MarketState;
  readonly politics: PoliticsState;
  readonly models: LabModelPortfolioState;
  readonly projects: LabProjectIndex;
  readonly flags: Readonly<Record<string, FlagValue>>;
}

// ---------------------------------------------------------------------------
// Models (TDD section 15.1)
// ---------------------------------------------------------------------------

export interface CapabilityVector {
  readonly language: Rating;
  readonly reasoning: Rating;
  readonly agency: Rating;
  readonly toolUse: Rating;
  readonly multimodality: Rating;
  readonly scientificAbility: Rating;
  readonly embodiment: Rating;
}

/** HIDDEN model truth. Excluded from `@neolab/sim/public` exports. */
export interface HiddenModelSafetyState {
  readonly trueAlignment: Rating;
  readonly corrigibility: Rating;
  readonly situationalAwareness: Rating;
  readonly deceptiveCapability: Rating;
  readonly generatedByRandomContract: number;
}

export type AutonomyAccessLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface ModelState {
  readonly id: ModelId;
  readonly ownerLabId: LabId;
  readonly generationIndex: number;
  readonly familyName: string;
  readonly displayName: string;
  readonly trainedAt: Tick;
  readonly trueCapability: CapabilityVector;
  readonly generality: Rating;
  readonly productQuality: Rating;
  readonly reliability: Rating;
  readonly accessLevel: AutonomyAccessLevel;
  readonly evaluations: readonly EvaluationId[];
  readonly anomalies: readonly AnomalyId[];
  readonly hiddenSafety: HiddenModelSafetyState;
  readonly flags: Readonly<Record<string, FlagValue>>;
}

// ---------------------------------------------------------------------------
// Projects, events, modifiers, scheduling (grow in Stages 2 and 5)
// ---------------------------------------------------------------------------

export type ProjectKind = "construction" | "training" | "evaluation";

export interface ProjectState {
  readonly id: ProjectId;
  readonly ownerLabId: LabId;
  readonly definitionId: ContentId;
  readonly kind: ProjectKind;
  readonly status: "queued" | "active" | "paused" | "completed" | "cancelled" | "failed";
  readonly createdAt: Tick;
  readonly startedAt?: Tick;
  readonly expectedDurationWeeks: number;
  /** 0..1 progress toward completion. */
  readonly progress: number;
  readonly completionOrder: number;
}

export interface EventInstanceState {
  readonly id: EventInstanceId;
  readonly definitionId: ContentId;
  readonly definitionVersion: number;
  readonly createdAt: Tick;
  readonly expiresAt?: Tick;
  readonly status: "unresolved" | "resolved" | "expired" | "invalidated";
  readonly tokens: Readonly<Record<string, string>>;
}

export type ModifierOperation = "add" | "multiply" | "min" | "max";

export interface EffectSource {
  readonly kind: "system" | "event" | "researcher" | "facility" | "leader" | "ending";
  readonly id?: string;
}

export interface ModifierState {
  readonly id: ModifierId;
  readonly source: EffectSource;
  readonly target: string;
  readonly operation: ModifierOperation;
  readonly value: number;
  readonly startsAt: Tick;
  readonly endsAt?: Tick;
  readonly tags: readonly string[];
}

export interface ScheduledEffectState {
  readonly id: string;
  readonly dueAt: Tick;
  readonly source: EffectSource;
  /** Serialisable effect payload applied in the delayed-effects phase. */
  readonly effects: readonly import("./effects.ts").Effect[];
}

export interface DecisionLogEntry {
  readonly tick: Tick;
  readonly summary: string;
}

export interface DomainLogEntry {
  readonly tick: Tick;
  readonly code: string;
}

// ---------------------------------------------------------------------------
// Score ledger (TDD section 18.5)
// ---------------------------------------------------------------------------

export type ScoreCategoryId =
  | "score.scientific-legacy"
  | "score.safe-stewardship"
  | "score.prosperity-impact"
  | "score.institution-building"
  | "score.race-operations"
  | "score.endgame";

export interface ScoreLedgerEntry {
  /** Semantic milestone key, e.g. `paper/world-first/paper.transformer`. */
  readonly key: string;
  readonly tick: Tick;
  readonly categoryId: ScoreCategoryId;
  readonly amount: number;
  readonly source: EffectSource;
  readonly explanationKey: string;
}

export interface FinalScoreRecord {
  readonly rawScore: number;
  readonly adjustedScore: number;
  readonly categoryTotals: Readonly<Record<ScoreCategoryId, number>>;
  readonly difficultyMultiplier: number;
  readonly victoryClassMultiplier: number;
  readonly leaderboardEligibility: "winning-run" | "local-only" | "ineligible";
}

/** Score never feeds back into any simulation outcome (TDD section 18.5). */
export interface ScoreState {
  readonly scoreVersion: string;
  readonly entries: readonly ScoreLedgerEntry[];
  readonly awardedKeys: Readonly<Record<string, true>>;
  readonly final?: FinalScoreRecord;
}

// ---------------------------------------------------------------------------
// Endgame (grows in Stage 7)
// ---------------------------------------------------------------------------

export type EndgameState = { readonly stage: "inactive" };

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

export interface GameState {
  readonly saveVersion: number;
  readonly engineRulesVersion: string;
  readonly contentVersion: string;
  readonly randomContractVersion: number;
  readonly run: RunState;
  readonly world: WorldState;
  readonly labs: Readonly<Record<LabId, LabState>>;
  readonly models: Readonly<Record<ModelId, ModelState>>;
  readonly projects: Readonly<Record<ProjectId, ProjectState>>;
  readonly eventInstances: Readonly<Record<EventInstanceId, EventInstanceState>>;
  readonly modifiers: Readonly<Record<ModifierId, ModifierState>>;
  readonly scheduledEffects: readonly ScheduledEffectState[];
  readonly decisionLog: readonly DecisionLogEntry[];
  readonly domainLog: readonly DomainLogEntry[];
  readonly score: ScoreState;
  readonly endgame: EndgameState;
}

export const SAVE_VERSION = 1;
export const ENGINE_RULES_VERSION = "0.1.0";

/** Calendar maths: 52 weeks per displayed year, starting 2012 week 1. */
export const CALENDAR_START_YEAR = 2012;
export const WEEKS_PER_YEAR = 52;

export function calendarFromTick(tickValue: number): GameCalendar {
  const year = CALENDAR_START_YEAR + Math.floor(tickValue / WEEKS_PER_YEAR);
  const week = (tickValue % WEEKS_PER_YEAR) + 1;
  return { year, week };
}

/** Deterministic run-entity ID, e.g. `run:model:player:0007` (TDD section 7.1). */
export function formatRunEntityId(
  namespace: IdNamespace,
  owner: string,
  counter: number,
): string {
  if (!Number.isInteger(counter) || counter < 0) {
    throw new RangeError(
      `ID counter must be a non-negative integer, got ${String(counter)}`,
    );
  }
  return `run:${namespace}:${owner}:${String(counter).padStart(4, "0")}`;
}
