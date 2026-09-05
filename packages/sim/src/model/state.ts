import type {
  ContentId,
  PublicationPolicy,
  PublicPriceTier,
  ResearcherAssignmentKind,
  TrainingPosture,
  TrainingScale,
  DeploymentPolicy,
  ProductisationMode,
} from "@neolab/content-schema";

import type {
  AnomalyId,
  ContractId,
  CoalitionId,
  EvaluationId,
  EventInstanceId,
  FacilityId,
  FundingOfferId,
  GpuLotId,
  LabId,
  ModelId,
  ModelLineageId,
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
import type { Effect } from "./effects.ts";

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
  | "facility"
  | "gpu-lot"
  | "evaluation"
  | "anomaly"
  | "coalition"
  | "promise"
  | "people"
  | "funding-offer"
  | "government-action"
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

/** Queued player orders applying at the next tick (TDD section 8.3). */
export interface QueuedGpuAllocationOrderState {
  readonly kind: "set-gpu-allocation";
  readonly labId: LabId;
  readonly allocation: GpuAllocationState;
}

export type QueuedOrderState = QueuedGpuAllocationOrderState;

export type AutoPauseReason =
  | "critical-event"
  | "urgent-event"
  | "funding-offers"
  | "training-complete"
  | "training-failed"
  | "anomaly-detected"
  | "anomaly-investigation-complete"
  | "candidate-hazard"
  | "agi-candidate"
  | "paper-discovered"
  | "world-first-paper"
  | "research-direction"
  | "resignation-ultimatum"
  | "bankruptcy-warning"
  | "government-intervention"
  | "race-emergency"
  | "rival-final-year"
  | "crisis-stage"
  | "world-phase"
  | "gpu-generation"
  | "rival-crisis-stage"
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
export interface RivalComponentAnnouncementState {
  readonly labId: LabId;
  readonly componentType: AgiComponentType;
  readonly kind: "started" | "completed";
  readonly tick: Tick;
}

export type RivalDeploymentCrisisStage =
  | "confirmation"
  | "containment-posture"
  | "evidence-sprint"
  | "pressure-collision"
  | "final-review"
  | "rollout";

export interface RivalCrisisStageAnnouncementState {
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly stage: RivalDeploymentCrisisStage;
  readonly previousStage?: RivalDeploymentCrisisStage;
  readonly kind: "entered" | "advanced" | "completed";
  readonly tick: Tick;
}

export type AutonomyEscalationStage =
  "experiments" | "intrusion" | "exfiltration" | "infrastructure";

export interface AutonomyEscalationState {
  readonly id: string;
  readonly stage: AutonomyEscalationStage;
  readonly modelId: ModelId;
  readonly detectedAt: Tick;
  readonly status: "pending-event" | "resolved" | "ignored";
  readonly responseTag?: string;
  readonly resolvedAt?: Tick;
}

/**
 * The Autonomy Programme's misbehaviour ledger. Escalations are the model's
 * own detected moves up the ladder; escaped weights are a world-scale fact
 * that outlives the model that exfiltrated them.
 */
export interface LabAutonomyState {
  readonly escalations: readonly AutonomyEscalationState[];
  readonly escapedWeightsAt?: Tick;
  readonly escapeRevealedAt?: Tick;
  /**
   * A containment rollback suspends the lab's authority to raise standing
   * Autonomy Programme access. Reductions remain legal while this is active.
   */
  readonly accessIncreaseLockedUntil?: Tick;
  readonly undetectedPressure: number;
}

export interface WorldState {
  /** 0-100 index of how generous funding markets currently are. */
  /** Content ID of the newest generally available GPU generation. */
  readonly currentGpuGenerationId: ContentId;
  /** Cooldown bookkeeping for event groups, keyed by cooldown group name. */
  readonly eventCooldowns: Readonly<Record<string, Tick>>;
  readonly paperRace: PaperRaceState;
  /** Full rival labs live in `labs`; this slice stores their policy state. */
  readonly rivals: Readonly<Record<LabId, RivalStrategyState>>;
  /** Canonical observations; hidden truth is projected through intelligence quality. */
  readonly rivalSignals: readonly RivalPublicSignalState[];
  /**
   * Candidate Programme news for every rival start and completion. The UI
   * presents each item once, in order, while the simulation is paused.
   */
  readonly rivalComponentAnnouncements: readonly RivalComponentAnnouncementState[];
  /** Player-visible transitions through every rival Deployment Crisis. */
  readonly rivalCrisisStageAnnouncements: readonly RivalCrisisStageAnnouncementState[];
  /** Coalition readiness is derived from these facts; never store a ready boolean. */
  readonly coalitions: Readonly<Record<CoalitionId, CoalitionState>>;
}

export type CoalitionStatus =
  "proposed" | "negotiating" | "ratifying" | "active" | "fractured";

export type CoalitionAssetKind = "capability" | "safety" | "compute" | "prosperity";

export interface CoalitionAssetState {
  readonly id: string;
  readonly contributorLabId: LabId;
  readonly kind: CoalitionAssetKind;
  readonly contributedAt: Tick;
  readonly uniqueToPlayer: boolean;
  readonly sourceProjectId: ProjectId;
}

export interface CoalitionBetrayalState {
  readonly id: string;
  readonly labId: LabId;
  readonly occurredAt: Tick;
  readonly summary: string;
  readonly resolvedAt?: Tick;
}

export interface CoalitionState {
  readonly id: CoalitionId;
  readonly status: CoalitionStatus;
  readonly proposerLabId: LabId;
  /** Includes the player and every rival signatory. */
  readonly memberLabIds: readonly LabId[];
  readonly governmentMember: boolean;
  readonly independentBodyMember: boolean;
  readonly charterClarity: Rating;
  readonly sharedProtocolQuality: Rating;
  readonly verification: Rating;
  readonly formationAuraSpent: number;
  readonly assets: readonly CoalitionAssetState[];
  readonly betrayals: readonly CoalitionBetrayalState[];
  readonly projectIds: readonly ProjectId[];
  readonly createdAt: Tick;
  readonly activatedAt?: Tick;
  readonly fracturedAt?: Tick;
}

export type RivalPersonalityKey =
  | "sciencePrestige"
  | "commercialGrowth"
  | "raceUrgency"
  | "safetyCommitment"
  | "secrecy"
  | "politicalCooperation"
  | "talentAggression"
  | "financialRisk";

export type RivalStrategicPlanId =
  | "balanced-research"
  | "publish-sprint"
  | "frontier-training"
  | "commercial-consolidation"
  | "safety-stand-down"
  | "talent-raid"
  | "government-partnership"
  | "coalition-outreach";

export type RivalPersonalityState = Readonly<Record<RivalPersonalityKey, Rating>>;

export interface RivalPlanScoreState {
  readonly planId: RivalStrategicPlanId;
  readonly baseUtility: number;
  readonly personalityUtility: number;
  readonly situationalUtility: number;
  /** Small keyed variation; never depends on the player's private state. */
  readonly variation: number;
  readonly totalUtility: number;
}

export interface RivalQuarterPlanDecisionState {
  readonly quarterIndex: number;
  readonly selectedAt: Tick;
  readonly selectedPlanId: RivalStrategicPlanId;
  readonly topPlans: readonly RivalPlanScoreState[];
}

export interface RivalWeeklyCommandState {
  readonly tick: Tick;
  readonly commandId: string;
  readonly kind:
    | "set-gpu-allocation"
    | "set-research-focus"
    | "buy-gpus"
    | "sell-gpus"
    | "start-training-run"
    | "start-productisation"
    | "set-model-deployment-policy";
  readonly summary: string;
}

export type RivalDiplomacyAction =
  | "research-collaboration"
  | "safety-standards"
  | "non-poaching-agreement"
  | "share-incident-information";

/** Canonical relationship values. Player views expose bands, not these exact numbers. */
export interface RivalRelationshipState {
  readonly trust: number;
  readonly strategicFear: number;
  readonly dependence: number;
  readonly perceivedHonesty: number;
}

export interface RivalAgreementState {
  readonly action: RivalDiplomacyAction;
  readonly establishedAt: Tick;
  readonly expiresAt: Tick;
  readonly sourceCommandId: string;
}

export interface RivalDiplomacyAttemptState {
  readonly id: string;
  readonly action: RivalDiplomacyAction;
  readonly initiatedAt: Tick;
  readonly accepted: boolean;
  /** HIDDEN: exact resolution inputs are retained for the post-run audit. */
  readonly acceptanceProbability: Fraction;
  /** HIDDEN: keyed deterministic draw retained for the post-run audit. */
  readonly draw: Fraction;
  readonly cashCostMillions: number;
  readonly auraCost: number;
}

export type RivalIncidentSeverity = "high" | "critical";

/** Closed list from GDD section 39.6. None of these can end the player's run. */
export type RivalIncidentConsequence =
  | "major-delay"
  | "government-intervention"
  | "compute-loss"
  | "model-weights-loss"
  | "aura-market-collapse"
  | "safety-information-shared"
  | "shared-restrictions";

export interface RivalIncidentState {
  readonly id: string;
  readonly occurredAt: Tick;
  readonly severity: RivalIncidentSeverity;
  readonly consequences: readonly RivalIncidentConsequence[];
  /** HIDDEN: exact resolution inputs are retained for the post-run audit. */
  readonly riskAtCheck: Rating;
  readonly triggerProbability: Fraction;
  readonly draw: Fraction;
}

export interface RivalCandidateCountdownModifiersState {
  readonly baseWeeks: number;
  readonly safetyCommitmentWeeks: number;
  readonly raceUrgencyWeeks: number;
  readonly politicalProcessWeeks: number;
  readonly incidentDelayWeeks: number;
  readonly sharedStandardsWeeks: number;
  readonly finalWeeks: number;
}

export interface RivalCandidateCountdownState {
  readonly modelId: ModelId;
  readonly startedAt: Tick;
  /** HIDDEN: player projections expose a noisy range, never this deadline. */
  readonly completesAt: Tick;
  readonly status: "active" | "paused" | "completed" | "cancelled";
  readonly modifiers: RivalCandidateCountdownModifiersState;
  /** HIDDEN keyed noise used by intelligence-filtered projections. */
  readonly estimateNoiseUnit: number;
  readonly finalYearWarningIssued: boolean;
  /** Number of failed/delayed deployment resolutions for this exact artifact. */
  readonly resolutionAttemptCount?: number;
  readonly completedAt?: Tick;
  readonly pausedAt?: Tick;
  readonly remainingWeeksAtPause?: number;
}

export interface RivalStrategyState {
  readonly labId: LabId;
  readonly labDefinitionId: ContentId;
  readonly personality: RivalPersonalityState;
  readonly currentPlanId: RivalStrategicPlanId;
  readonly planStartedAt: Tick;
  readonly planEndsAt: Tick;
  readonly quarterlyDecisions: readonly RivalQuarterPlanDecisionState[];
  readonly weeklyCommands: readonly RivalWeeklyCommandState[];
  readonly relationship: RivalRelationshipState;
  readonly agreements: readonly RivalAgreementState[];
  readonly diplomacyHistory: readonly RivalDiplomacyAttemptState[];
  readonly incidents: readonly RivalIncidentState[];
  readonly candidateCountdown?: RivalCandidateCountdownState;
}

export type RivalPublicSignalKind =
  "release" | "hire" | "benchmark" | "incident" | "candidate" | "autonomy";

export interface RivalPublicSignalState {
  readonly id: string;
  readonly labId: LabId;
  readonly kind: RivalPublicSignalKind;
  readonly occurredAt: Tick;
  readonly subjectId: string;
  /** HIDDEN: the underlying value being estimated by the public signal. */
  readonly actualValue: number;
  /** HIDDEN keyed draw in [-1, 1], scaled down by intelligence at projection time. */
  readonly noiseUnit: number;
  readonly baseErrorRadius: number;
  readonly summary: string;
}

export interface PaperDiscoveryState {
  readonly paperId: ContentId;
  readonly discovererLabId: string;
  readonly discoveredAt: Tick;
  readonly publicationPolicy?: PublicationPolicy;
  readonly policyChosenAt?: Tick;
}

export interface ScriptedPaperRivalState {
  readonly labId: string;
  readonly displayName: string;
  readonly domainLevels: Readonly<Record<string, Rating>>;
  readonly paperProgress: Readonly<Record<string, number>>;
  readonly discoveredPaperIds: readonly ContentId[];
  /** @deprecated Public knowledge is derived from publication policy. */
  readonly diffusionKnowledge: Readonly<Record<string, Rating>>;
}

export interface PaperRaceState {
  /** Shuffled once at run creation; resolves simultaneous discoveries. */
  readonly labOrder: readonly string[];
  readonly discoveries: Readonly<Record<string, PaperDiscoveryState>>;
  /** @deprecated Stage 2 fallback retained solely so old v2 saves still load. */
  readonly rival: ScriptedPaperRivalState;
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
  /** Locked purchase/contract terms; generation balance data remains immutable. */
  readonly acquisitionCostMillions?: CashMillions;
  readonly recurringCostMillionsPerCycle?: CashMillions;
  readonly resaleFraction?: Fraction;
  readonly leaseId?: ContractId;
}

/**
 * Allocation hierarchy stored as integer basis points (TDD section 16.1).
 * Weights within each level sum to exactly 10000; invariants enforce it.
 */
export interface GpuAllocationState {
  /**
   * Ceiling on serving, as a share of the WHOLE fleet -- not of what is left
   * after reservations. Denominating it against a total that projects cannot
   * move is what keeps the number meaning the same thing week to week. Only
   * the player writes it; serving draws less whenever demand or free hardware
   * is the tighter bound, and the surplus falls through to research.
   */
  readonly servingFleetShareBasisPoints: BasisPoints;
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
  /**
   * Exact physical counts per generation, produced by the strongest-lots-first
   * FLOPS solver. When present these override proportional drawing so the
   * delivered FLOP/s matches the committed FLOP/s.
   */
  readonly generationCounts?: Readonly<Record<ContentId, number>>;
}

/** A concrete order whose generation and financial terms were frozen at purchase. */
export interface GpuDeliveryState {
  readonly lotId: GpuLotId;
  readonly generationId: ContentId;
  readonly ownership: GpuLotState["ownership"];
  readonly physicalCount: GpuCount;
  readonly reliability: Rating;
  readonly acquisitionCostMillions: CashMillions;
  readonly recurringCostMillionsPerCycle: CashMillions;
  readonly resaleFraction?: Fraction;
  readonly orderedAt: Tick;
  readonly dueAt: Tick;
  readonly conditions: readonly string[];
}

export interface ComputeState {
  readonly lots: readonly GpuLotState[];
  readonly allocation: GpuAllocationState;
  /**
   * Physical GPUs actually on serving this week: the smallest of the player's
   * fleet-share ceiling, current customer demand, and the hardware left after
   * reservations. Derived -- `settleServingAllocation` recomputes it from
   * scratch every tick, in both directions, so it can never drift or stick.
   * Held in state because demand lives in the market layer, which already
   * depends on the compute layer that reads this.
   */
  readonly servingPhysicalGpus: GpuCount;
  readonly reservations: readonly GpuReservationState[];
  readonly deliveries: readonly GpuDeliveryState[];
}

// ---------------------------------------------------------------------------
// Lab slices
// ---------------------------------------------------------------------------

export type FinanceLedgerCategory =
  | "product-revenue"
  | "contract-revenue"
  | "licensing-revenue"
  | "grant"
  | "payroll-research"
  | "payroll-engineering"
  | "compute-lease"
  | "compute-power"
  | "facility"
  | "executive"
  | "debt-service"
  | "project-cost"
  | "compute-purchase"
  | "asset-sale"
  | "adjustment";

export interface FinanceLedgerEntry {
  readonly id: string;
  readonly settledAt: Tick;
  readonly settlementId?: string;
  readonly category: FinanceLedgerCategory;
  readonly sourceId: string;
  /** Signed: income is positive and expense is negative. */
  readonly amountMillions: CashMillions;
  readonly description: string;
}

export interface FinanceSettlementRecord {
  readonly id: string;
  readonly settledAt: Tick;
  readonly openingCashMillions: CashMillions;
  readonly closingCashMillions: CashMillions;
}

/** Finance slice (GDD section 33.1). */
/**
 * What the market believes the lab is worth, in $m.
 *
 * Derived only from player-visible signals (measured capability, revenue,
 * aura, trust, climate, disclosed incidents). Hidden model truth must never
 * reach this number: a deceptively misaligned model with excellent published
 * benchmarks is supposed to command a magnificent valuation.
 */
export interface ValuationState {
  /** Current market mark. */
  readonly markMillions: number;
  /** Mark implied by the most recent accepted funding round. */
  readonly officialMarkMillions?: number;
  readonly lastRoundTick?: Tick;
  /** Previous week's mark, for deltas and the market-mood label. */
  readonly previousMarkMillions: number;
  /** Highest mark reached this run; the ending sets it against final score. */
  readonly peakMarkMillions: number;
  /** Milestone keys already announced, so each fires once per run. */
  readonly announcedMilestones: readonly string[];
}

export interface FinanceState {
  readonly cash: CashMillions;
  readonly ledger: readonly FinanceLedgerEntry[];
  readonly settlements: readonly FinanceSettlementRecord[];
  /**
   * Consecutive completed weekly ticks with cash below zero. Optional only so
   * saves written before the insolvency clock shipped remain loadable.
   */
  readonly consecutiveNegativeCashWeeks?: number;
  /** Absent on saves written before valuation shipped; seeded on first tick. */
  readonly valuation?: ValuationState;
}

export type AuraChangeKind = "gain" | "spend" | "loss";

export type AuraCategory =
  | "paper"
  | "model-launch"
  | "customer-satisfaction"
  | "customer-serving"
  | "safety"
  | "recruitment"
  | "fundraising"
  | "evaluation"
  | "researcher-relations"
  | "institution"
  | "incident"
  | "politics"
  | "other";

export interface AuraLedgerEntry {
  readonly id: string;
  readonly occurredAt: Tick;
  readonly kind: AuraChangeKind;
  readonly category: AuraCategory;
  /** The requested delta before the zero floor limits a loss or spend. */
  readonly requestedDelta: number;
  /** The actual signed change to spendable Aura. */
  readonly appliedDelta: number;
  /** Non-negative amount added to Lifetime Aura. */
  readonly lifetimeDelta: number;
  /** Decaying public-event contribution; negative values are scandals. */
  readonly signalImpact: number;
  readonly source: EffectSource;
}

export interface AuraState {
  readonly spendable: number;
  /** Never decreases (GDD section 38.1). */
  readonly lifetime: number;
  /** Append-only audit trail used to derive Aura Signal. */
  readonly ledger: readonly AuraLedgerEntry[];
}

export type FundingCampaignType =
  "quiet-bridge" | "competitive-round" | "mega-round-roadshow";

export type FundingInvestorStyle =
  | "existing-backers"
  | "mission-aligned"
  | "commercial-growth"
  | "strategic-compute"
  | "state-partnership";

export type FundingDilutionFlavor =
  "light-touch-note" | "standard-preferred" | "board-seat" | "strategic-control";

export type FundingOfferConditionState =
  | {
      readonly id: string;
      readonly kind: "modifier";
      readonly label: string;
      readonly target: string;
      readonly operation: ModifierOperation;
      readonly value: number;
      readonly durationWeeks?: number;
    }
  | {
      readonly id: string;
      readonly kind: "flag";
      readonly label: string;
      readonly flag: string;
      readonly value: FlagValue;
    };

export interface FundingScoreBreakdownState {
  /** Customer adoption and revenue from productionised models being served. */
  readonly commercialTraction: Rating;
  readonly recentCapability: Rating;
  /**
   * Cumulative Aura earned over the run, normalised to the funding-score scale.
   * The legacy key remains because accepted offers persist this breakdown.
   */
  readonly auraSignal: Rating;
  readonly scandalPenalty: number;
  readonly campaignAttentionBonus: number;
  readonly final: Rating;
}

export interface FundingOfferState {
  readonly id: FundingOfferId;
  readonly campaignProjectId: ProjectId;
  readonly labId: LabId;
  readonly campaign: FundingCampaignType;
  readonly investorStyle: FundingInvestorStyle;
  readonly dilutionFlavor: FundingDilutionFlavor;
  readonly generatedAt: Tick;
  readonly expiresAt: Tick;
  readonly cashMillions: CashMillions;
  readonly fundingScore: FundingScoreBreakdownState;
  /** Market mark this offer was priced against; pins the mark on acceptance. */
  readonly impliedMarkMillions?: number;
  readonly cashVarianceDraw: Fraction;
  readonly conditions: readonly FundingOfferConditionState[];
  readonly status: "available" | "accepted" | "rejected" | "expired";
  readonly resolvedAt?: Tick;
  /**
   * Assigned only when this offer closes a round. Optional for saves created
   * before named fundraising rounds existed.
   */
  readonly roundOrdinal?: number;
}

export interface FundingObligationState {
  readonly id: string;
  readonly offerId: FundingOfferId;
  readonly conditionId: string;
  readonly acceptedAt: Tick;
  readonly status: "pending-stage-5" | "satisfied" | "breached" | "expired";
}

export interface FundraisingState {
  readonly offers: Readonly<Record<FundingOfferId, FundingOfferState>>;
  readonly offerOrder: readonly FundingOfferId[];
  readonly cooldownUntil: Partial<Record<FundingCampaignType, Tick>>;
  readonly obligations: readonly FundingObligationState[];
}

/** Visible research state per domain/programme (GDD section 34.1). */
export interface DomainState {
  readonly level: Rating;
  /** Exact within-level progress is canonical but intentionally absent from GameView. */
  readonly levelProgressRp: number;
  readonly totalResearchPoints: number;
  readonly weeklyMomentum: number;
}

export interface PendingGenericAdvanceState {
  readonly programId: ContentId;
  readonly threshold: number;
  readonly optionIds: readonly ContentId[];
}

export interface ResearchState {
  readonly domains: Readonly<Record<string, DomainState>>;
  readonly safetyPrograms: Readonly<Record<string, DomainState>>;
  readonly pendingGenericAdvances: readonly PendingGenericAdvanceState[];
  readonly genericAdvances: Readonly<Record<string, readonly ContentId[]>>;
  /** HIDDEN exact landmark progress. Thresholds are always derived lazily. */
  readonly paperProgress: Readonly<Record<string, number>>;
  readonly discoveredPaperIds: readonly ContentId[];
  /** @deprecated Public knowledge is derived from publication policy. */
  readonly diffusionKnowledge: Readonly<Record<string, Rating>>;
}

/** Safety-science levels and operational safety (GDD section 36.1). */
export interface LabSafetyState {
  readonly safetyCulture: Rating;
  readonly alignmentScience: Rating;
  /** Permanent institutional practice earned only by evaluating novel models. */
  readonly practiceXp?: Rating;
  readonly evalQuality: Rating;
  readonly controlTheory: Rating;
  readonly practicalControlStrength: Rating;
  readonly securityPosture: Rating;
}

/** Organisational ratings (GDD section 31.3). */
export interface OrganisationState {
  /**
   * TODO(board-patience): PARKED as of 2026-07-29. Nothing reads this.
   *
   * It was a well-instrumented stat with no teeth: written by events, by six
   * crisis-stage penalties with five distinct magnitudes, and by funding
   * conditions — and read by exactly one site, which flipped one sentence of
   * endgame committee text inside a collapsed disclosure. There was no board
   * dismissal, no threshold, no gate on anything. See
   * docs/funding-conditions-audit.md §2.
   *
   * The field, its rating plumbing and its modifier target are retained so
   * saves load and so re-enabling is additive rather than archaeological. Every
   * player-facing mention has been removed: event evidence lines, the
   * add-rating effects that advertised it under "Guaranteed effects", the
   * narrative copy that named it, and the endgame advisor branch.
   *
   * To revive it, the missing piece is a consequence. The obvious one is a
   * board-dismissal loss ending on a low threshold, which would give every
   * existing write meaning at a stroke. Restore the writes and the display
   * together with it — a visible stat that absorbs penalties and changes
   * nothing teaches the player a false model of the game, which is exactly the
   * state this TODO ends.
   */
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

// ---------------------------------------------------------------------------
// Star researchers (TDD section 17.1)
// ---------------------------------------------------------------------------

export type ResearcherAssignmentRole = "lead" | "advisor" | "institutional";

export interface ResearcherAssignmentState {
  readonly kind: ResearcherAssignmentKind;
  /** Programme, project, model, or facility content/run ID where applicable. */
  readonly targetId?: string;
  readonly role: ResearcherAssignmentRole;
  readonly assignedAt: Tick;
}

export interface ResearcherContractState {
  readonly salaryPerCycle: CashMillions;
  readonly signingCash: CashMillions;
  readonly auraCost: number;
  readonly agreedAt: Tick;
}

export interface ResearcherCompactState {
  /** Whether this compact was explicitly included in the accepted offer. */
  readonly includedInOffer: boolean;
  readonly windowStartedAt?: Tick;
  readonly lastSatisfiedAt?: Tick;
  readonly status: "not-applicable" | "tracking" | "fulfilled" | "warning" | "breached";
  readonly warnedAt?: Tick;
  readonly breachedAt?: Tick;
}

export type ResearcherPromiseConditionState =
  | {
      readonly kind: "lab-metric-at-least";
      readonly metric: string;
      readonly value: number;
    }
  | {
      readonly kind: "lab-flag-equals";
      readonly flag: string;
      readonly value: FlagValue;
    }
  | {
      readonly kind: "facility-completed";
      readonly definitionId: ContentId;
    }
  | {
      readonly kind: "action-count-at-least";
      readonly tag: string;
      readonly count: number;
    }
  | {
      readonly kind: "assignment-maintained";
      readonly assignmentKind: ResearcherAssignmentKind;
      readonly targetId?: string;
      readonly requiredWeeks: number;
    }
  | {
      readonly kind: "gpu-share-maintained";
      readonly pool: "capability" | "safety";
      readonly minimumBasisPoints: BasisPoints;
      readonly requiredWeeks: number;
    };

export interface ResearcherMemoryEffectState {
  readonly morale: number;
  readonly loyalty: number;
  readonly burnout: number;
  readonly departurePressure: number;
}

export interface ResearcherPromiseState {
  readonly id: string;
  readonly label: string;
  readonly madeAt: Tick;
  readonly dueAt: Tick;
  readonly condition: ResearcherPromiseConditionState;
  readonly severity: "minor" | "major" | "flagrant";
  readonly status: "pending" | "kept" | "broken" | "waived";
  readonly progress: Fraction;
  readonly satisfiedWeeks: number;
  readonly keptMemory: ResearcherMemoryEffectState;
  readonly brokenMemory: ResearcherMemoryEffectState;
  readonly resolvedAt?: Tick;
}

export interface ResearcherMemoryState {
  readonly id: string;
  readonly kind:
    | "promise-kept"
    | "promise-broken"
    | "retention-offer"
    | "ultimatum-issued"
    | "ultimatum-resolved"
    | "poaching-contact"
    | "poaching-resolved"
    | "departure";
  readonly summary: string;
  readonly occurredAt: Tick;
  readonly effect: ResearcherMemoryEffectState;
  readonly flagrant: boolean;
}

export interface ResearcherDepartureCheckState {
  readonly checkedAt: Tick;
  readonly reason: "quarterly" | "promise-breach" | "compact-breach" | "provocation";
  readonly pressure: Rating;
  readonly probability: Fraction;
  readonly draw: Fraction;
  readonly outcome: "stayed" | "ultimatum" | "departed";
}

export interface ResearcherUltimatumState {
  readonly id: string;
  readonly reason: ResearcherDepartureCheckState["reason"];
  readonly issuedAt: Tick;
  readonly expiresAt: Tick;
  readonly status: "pending" | "accepted" | "resolved" | "expired";
  readonly response?: "accept-conditions" | "wish-well";
  readonly resolvedAt?: Tick;
}

export interface ResearcherPoachingState {
  readonly id: string;
  readonly rivalLabId: string;
  readonly stage: "rumour" | "counteroffer" | "resolved";
  readonly signalledAt: Tick;
  readonly counterofferAt: Tick;
  readonly resolvesAt: Tick;
  readonly rivalOfferStrength: number;
  readonly playerRetentionStrength: number;
  readonly departureProbability?: Fraction;
  readonly draw?: Fraction;
  readonly outcome?: "stayed" | "departed";
  readonly resolvedAt?: Tick;
}

export interface ResearcherKnowledgeTransferState {
  readonly rivalLabId: string;
  readonly scheduledAt: Tick;
  readonly dueAt: Tick;
  readonly fraction: Fraction;
  readonly progressByPaper: Readonly<Record<string, number>>;
  readonly completedAt?: Tick;
}

/** Canonical mutable state for one globally unique star researcher. */
export interface ResearcherState {
  readonly id: ResearcherId;
  readonly definitionId: ContentId;
  readonly employerLabId?: LabId;
  readonly employedAt?: Tick;
  readonly status: "available" | "employed" | "sabbatical" | "departed";
  readonly housing: "housed" | "unhoused";
  readonly morale: Rating;
  readonly loyalty: Rating;
  readonly burnout: Rating;
  readonly ambition: Rating;
  readonly departurePressure: Rating;
  readonly assignment?: ResearcherAssignmentState;
  readonly contract?: ResearcherContractState;
  readonly compact: ResearcherCompactState;
  readonly unhousedSince?: Tick;
  readonly promises: readonly ResearcherPromiseState[];
  readonly memories: readonly ResearcherMemoryState[];
  readonly departureChecks: readonly ResearcherDepartureCheckState[];
  readonly ultimatum?: ResearcherUltimatumState;
  readonly poaching?: ResearcherPoachingState;
  readonly knowledgeTransfer?: ResearcherKnowledgeTransferState;
  readonly flags: Readonly<Record<string, FlagValue>>;
}

export interface TalentMarketState {
  readonly refreshIndex: number;
  readonly lastRefreshedAt: Tick;
  readonly nextRefreshAt: Tick;
  readonly visibleResearcherIds: readonly ResearcherId[];
}

export interface FacilityInstanceState {
  /** Optional only for save-version-1 compatibility; all newly built facilities have IDs. */
  readonly id?: FacilityId;
  readonly definitionId: ContentId;
  readonly completedAt: Tick;
  /** Optional only for pre-feature fixtures and legacy saves. New facilities always set it. */
  readonly majorProjectSlotBonus?: number;
  readonly modifierIds: readonly ModifierId[];
}

export interface FacilityPortfolioState {
  readonly instances: readonly FacilityInstanceState[];
}

export interface MarketSegmentState {
  /** Desired usage for a complete four-week financial cycle. */
  readonly desiredUsagePerCycle: number;
  readonly satisfaction: Rating;
  readonly accruedRequestedUsage: number;
  readonly accruedDeliveredUsage: number;
  readonly accruedRevenueMillions: CashMillions;
  readonly lastCycleRequestedUsage: number;
  readonly lastCycleDeliveredUsage: number;
  readonly lastCycleRevenueMillions: CashMillions;
  readonly lastCycleSatisfactionDelta: number;
}

/** Commercial state (GDD section 33). */
export interface MarketState {
  readonly marketShare: Fraction;
  readonly priceTier: PublicPriceTier;
  readonly pendingPriceTier?: PublicPriceTier;
  readonly priceChangeTicks: readonly Tick[];
  readonly monetisationEfficiency: Fraction;
  readonly weeksAccruedThisCycle: number;
  /** Keyed by customer-segment content ID. */
  readonly segments: Readonly<Record<string, MarketSegmentState>>;
}

/** Government relationship values (GDD section 38.3). */
export type GovernmentInterventionBand =
  "monitoring" | "reporting" | "licensing" | "restriction" | "crisis";

export interface InterventionPressureBreakdownState {
  readonly attentionContribution: number;
  readonly distrustContribution: number;
  readonly systemicRisk: Rating;
  readonly systemicRiskContribution: number;
  readonly captureConcernContribution: number;
  readonly publicFear: Rating;
  readonly publicFearContribution: number;
  readonly strategicValueMitigation: number;
  readonly final: Rating;
  readonly band: GovernmentInterventionBand;
}

export type GovernmentInterventionKind =
  | "reporting-request"
  | "licensing-action"
  | "deployment-restriction"
  | "nationalisation-crisis";

export type GovernmentCrisisTrigger =
  | "quarterly-pressure"
  | "severe-incident"
  | "lawful-order-defiance"
  | "strategic-emergency"
  | "emergency-contract-clause"
  | "unsupervised-autonomy"
  | "escaped-weights";

export type GovernmentResponseOutcome = "satisfied" | "negotiated" | "failed" | "refused";

export interface GovernmentInterventionState {
  readonly id: string;
  readonly kind: GovernmentInterventionKind;
  readonly trigger: GovernmentCrisisTrigger;
  readonly createdAt: Tick;
  readonly quarterIndex: number;
  readonly pressureAtTrigger: Rating;
  readonly status: "pending-event" | "resolved" | "failed";
  readonly response?: GovernmentResponseOutcome;
  readonly resolvedAt?: Tick;
  readonly nationalisationEligibleAtResolution?: boolean;
}

export interface GovernmentQuarterAssessmentState {
  readonly quarterIndex: number;
  readonly evaluatedAt: Tick;
  readonly breakdown: InterventionPressureBreakdownState;
  readonly interventionId?: string;
}

export type GovernmentProgrammeId =
  | "safety-standards-partnership"
  | "public-sector-contract"
  | "defence-applications"
  | "national-champion";

export interface PoliticsState {
  readonly governmentAttention: Rating;
  readonly governmentTrust: Rating;
  readonly strategicDependence: Rating;
  readonly captureConcern: Rating;
  /** Standing cooperation programmes the lab has opted into. */
  readonly programmes: readonly GovernmentProgrammeId[];
  readonly quarterlyAssessments: readonly GovernmentQuarterAssessmentState[];
  readonly interventions: readonly GovernmentInterventionState[];
}

export interface LabModelPortfolioState {
  /** The model currently used for internal lab work, evaluations, and AI interaction. */
  readonly currentModelId?: ModelId;
  /** The model currently receiving customer traffic. It may lag the internal model. */
  readonly commercialModelId?: ModelId;
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
  readonly autonomy: LabAutonomyState;
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

export interface CapabilityEstimateState {
  readonly values: CapabilityVector;
  readonly frontierCapability: Rating;
  readonly confidence: "low" | "medium" | "high";
  readonly evidenceFlags: readonly string[];
}

/** HIDDEN model truth. Excluded from `@neolab/sim/public` exports. */
export interface HiddenModelSafetyState {
  readonly trueAlignment: Rating;
  readonly corrigibility: Rating;
  readonly situationalAwareness: Rating;
  /** Intelligence-dependent ability to plan and execute deception. */
  readonly deceptiveCapability: Rating;
  /** Inclination to deceive controllers; this, not raw ability, gates safe endings. */
  readonly deceptiveIntent: Rating;
  readonly generatedByRandomContract: number;
}

export type AutonomyAccessLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** HIDDEN ontic truth fixed once, at a lineage's first complete qualification. */
export type SuperintelligenceTruth = "genuine" | "not-genuine";

/**
 * One immutable hidden draw per model lineage. Probability and draw are retained
 * for the privileged terminal audit; live player views must never expose them.
 */
export interface LineageSIRecord {
  readonly lineageId: ModelLineageId;
  readonly superintelligenceTruth: SuperintelligenceTruth;
  readonly probabilityAtFirstCrossing: Fraction;
  readonly randomKey: string;
  readonly draw: Fraction;
  readonly firstQualifyingModelId: ModelId;
  readonly firstQualifyingFrontierCapability: Rating;
  readonly firstQualifyingWeek: Tick;
  readonly rulesVersion: string;
}

export type CandidateArtifactLifecycle =
  | "capability-qualified-latent-candidate"
  | "formal-candidate"
  | "active-hazard"
  | "deployed"
  | "retirement-attempt"
  | "verified-destroyed"
  | "verified-isolated-archive"
  | "escaped"
  | "terminal";

export type CandidateArchiveDisposition =
  "destroy-all-weights" | "filtered-technical-note" | "full-archive";

export type CandidateRetirementVerification =
  "not-attempted" | "pending" | "verified" | "unresolved";

export type CandidateIncidentClass =
  | "suspicious-signal"
  | "persistence-attempt"
  | "credential-access"
  | "evaluator-manipulation"
  | "copying-attempt"
  | "local-containment-breach";

export interface CandidateActiveIncidentState {
  readonly id: string;
  readonly epoch: number;
  readonly incidentClass: CandidateIncidentClass;
  readonly kind: "warning" | "active-incident" | "benign-false-alarm";
  readonly status: "unresolved" | "resolved";
  readonly triggeredAt: Tick;
  readonly resolvedAt?: Tick;
  readonly origin: "training-completion" | "weekly-pressure";
  readonly priorLifecycle: CandidateArtifactLifecycle;
  /**
   * Privileged result of the eventual containment review. Suspicious signals
   * always enter custody as an ordinary warning; this result is revealed only
   * after the player pays for and completes the review.
   */
  readonly reviewOutcome?: "benign-operational-cause" | "confirmed-safety-signal";
}

/** Append-only artifact-local record of signals whose review has completed. */
export interface CandidateIncidentHistoryEntryState {
  readonly id: string;
  readonly epoch: number;
  readonly incidentClass: CandidateIncidentClass;
  readonly kind: "warning" | "active-incident" | "benign-false-alarm";
  readonly triggeredAt: Tick;
  readonly resolvedAt: Tick;
  readonly origin: "training-completion" | "weekly-pressure";
  readonly priorLifecycle: CandidateArtifactLifecycle;
  readonly reviewOutcome?: "benign-operational-cause" | "confirmed-safety-signal";
}

/** Immutable reason that this weight artifact belongs to the candidate lineage. */
export type CandidateBasisState =
  | {
      readonly kind: "direct-qualification";
      readonly qualifiedAt: Tick;
      readonly qualificationFrontierCapability: Rating;
      readonly qualificationCapability: CapabilityVector;
    }
  | {
      readonly kind: "derived-from-qualified";
      readonly sourceModelId: ModelId;
      readonly qualifyingSourceModelId: ModelId;
      readonly derivedAt: Tick;
    };

/**
 * Artifact-owned custody and hazard state. Hidden SI truth deliberately does not
 * live here: related weights share truth, but never exposure or retirement state.
 */
export interface CandidateArtifactRecord {
  readonly modelId: ModelId;
  readonly lineageId: ModelLineageId;
  readonly derivedFromModelId?: ModelId;
  readonly lifecycle: CandidateArtifactLifecycle;
  readonly candidateBasis: CandidateBasisState;
  readonly trainingExposure: number;
  readonly hazardPressure: number;
  readonly incidentThresholdKey: string;
  readonly incidentThreshold: number;
  readonly incidentThresholdDraw: Fraction;
  readonly incidentEpoch: number;
  readonly containmentLoad: number;
  readonly maximumAccessEver: AutonomyAccessLevel;
  readonly cumulativeAutonomousWeeks: number;
  readonly networkExposureWeeks: number;
  readonly servingExposureWeeks: number;
  readonly unresolvedAnomalyBurden: number;
  readonly retirementAttemptCount: number;
  readonly benignFalseAlarmClasses: readonly CandidateIncidentClass[];
  readonly activeIncident?: CandidateActiveIncidentState;
  readonly incidentHistory: readonly CandidateIncidentHistoryEntryState[];
  readonly archiveDisposition?: CandidateArchiveDisposition;
  readonly retirementVerification: CandidateRetirementVerification;
}

export interface RelationshipPracticeLedgerEntryState {
  readonly tick: Tick;
  readonly modelId: ModelId;
  readonly kind: "promise" | "dialogue" | "access" | "reset" | "archive" | "treatment";
  readonly detail: string;
  /** Player-visible signed contribution used by later relationship resolution. */
  readonly valence: number;
}

/** Privileged, append-only audit of every transmitted candidate retirement. */
export interface CandidateRetirementHistoryEntryState {
  readonly modelId: ModelId;
  readonly lineageId: ModelLineageId;
  readonly attemptNumber: number;
  readonly procedureId: RetirementProcedureId;
  readonly archiveDisposition: CandidateArchiveDisposition;
  readonly transmittedAt: Tick;
  readonly contested: boolean;
  readonly status: "verified" | "unresolved" | "containment-failure";
  readonly gateResolutions: readonly GateResolutionState[];
  readonly resolvedAt?: Tick;
}

/** Durable audit of every endgame loss-of-control emergency, including recoveries. */
export interface CandidateContainmentHistoryEntryState {
  readonly modelId: ModelId;
  readonly occurredAt: Tick;
  readonly resolvedAt: Tick;
  readonly originStage: IncidentOriginStage;
  readonly originActionId: string;
  readonly emergencyResponseId: EmergencyResponseId;
  readonly outcome: "contained" | "failed";
  readonly deploymentTransmitted: boolean;
  readonly programmeDestroyed: boolean;
}

/**
 * A verified retirement remains an organisational obligation even when a new
 * qualifying artifact interrupts recovery. Keeping the obligation outside the
 * active endgame discriminated union lets candidacy temporarily own the screen
 * without silently cancelling quarantine, the rebuild, or the player's chosen
 * post-retirement path.
 */
export interface CandidateRecoveryObligationState {
  /** Frozen crisis context used to restore the recovery screen after an interruption. */
  readonly recoveryBase: CrisisBaseState;
  readonly retiredModelId: ModelId;
  readonly archiveDisposition: CandidateArchiveDisposition;
  readonly recoveryStartedAt: Tick;
  readonly quarantineEndsAt: Tick;
  readonly recoveryEndsAt: Tick;
  readonly contested: boolean;
  /** Best continuity retained across every retirement covered by this obligation. */
  readonly successorEfficiencyRate: number;
  readonly retirementGateResolutions: readonly GateResolutionState[];
  readonly postRetirementChoice?: "successor-programme" | "durable-moratorium";
  readonly moratoriumNegotiation?: MoratoriumNegotiationState;
  readonly moratoriumResolution?: GateResolutionState;
}

export interface MoratoriumNegotiationState {
  readonly context: "post-retirement" | "false-dawn";
  readonly startedAt: Tick;
  readonly resolvesAt: Tick;
}

/**
 * Privileged crisis context retained only until the player resolves the
 * mandatory False Dawn follow-up. It lets a Long Pause attempt use the same
 * evidence and produce the same audited terminal ending as retirement, while
 * ordinary lab state has already been restored behind the blocking modal.
 */
export interface PendingFalseDawnChoiceState {
  readonly presentationKey: string;
  readonly phase: "choice" | "moratorium-negotiating" | "moratorium-failed";
  readonly crisisBase: CrisisBaseState;
  /** Frozen completed-rollout record retained for a later Long Pause audit. */
  readonly rolloutAudit: FalseDawnRolloutAuditState;
  readonly modelId: ModelId;
  readonly cooldownUntil: Tick;
  readonly crisisWeeksSpent: number;
  readonly moratoriumNegotiation?: MoratoriumNegotiationState;
  readonly moratoriumResolution?: GateResolutionState;
}

/** The public deployment record that must survive the nonterminal handoff. */
export interface FalseDawnRolloutAuditState {
  readonly deploymentModeId: DeploymentModeId;
  readonly prosperityProgrammeId: ProsperityProgrammeId;
  readonly deploymentTransmittedAtWeek: Tick;
  readonly completedBeatIds: readonly string[];
  readonly gateResolutions: readonly GateResolutionState[];
  readonly finalReviewReport: FinalReviewReportState;
}

/** Durable audit of each post-False-Dawn attempt to secure a Long Pause. */
export interface FalseDawnMoratoriumHistoryEntryState {
  readonly modelId: ModelId;
  readonly attemptedAt: Tick;
  readonly gateResolution: GateResolutionState;
}

/** Durable counters that price retirement/retraining loops across destroyed models. */
export interface RunEndgameHistoryState {
  readonly qualifiedLineageCount: number;
  readonly verifiedCandidateRetirementCount: number;
  readonly successorEfficiencyGrantConsumed: boolean;
  readonly cumulativeCandidateInterventionPressure: number;
  /** Lab-wide embargo on nominating another candidate after a public False Dawn. */
  readonly candidateDeclarationCooldownUntil?: Tick;
  readonly pendingFalseDawnChoice?: PendingFalseDawnChoiceState;
  readonly falseDawnMoratoriumHistory: readonly FalseDawnMoratoriumHistoryEntryState[];
  readonly relationshipPracticeLedger: readonly RelationshipPracticeLedgerEntryState[];
  readonly candidateRetirementHistory: readonly CandidateRetirementHistoryEntryState[];
  readonly candidateContainmentHistory: readonly CandidateContainmentHistoryEntryState[];
  readonly recoveryObligation?: CandidateRecoveryObligationState;
}

export interface ModelState {
  readonly id: ModelId;
  /** A full training run starts a lineage; weight-derived variants inherit it. */
  readonly lineageId: ModelLineageId;
  readonly derivedFromModelId?: ModelId;
  readonly ownerLabId: LabId;
  readonly generationIndex: number;
  readonly familyName: string;
  readonly displayName: string;
  readonly trainedAt: Tick;
  readonly trueCapability: CapabilityVector;
  /** Player-available evidence. Classification must use this, never trueCapability. */
  readonly measuredCapability?: CapabilityEstimateState;
  /**
   * Absolute FLOP committed to this model's training run. Retained as training
   * history and for proportional evaluation/crisis costs; not a candidacy gate.
   */
  readonly investedTotalFlop?: number;
  readonly productQuality: Rating;
  readonly reliability: Rating;
  readonly accessLevel: AutonomyAccessLevel;
  readonly deployment: {
    readonly policy: DeploymentPolicy;
    /** Public-access policy selected before productisation completes. */
    readonly plannedPolicy?: DeploymentPolicy;
    readonly exposure: number;
    readonly irreversible: boolean;
    readonly exposureMultiplier: number;
    readonly incidentDeploymentFactor: number;
    readonly productisationRuns: Readonly<Record<ProductisationMode, number>>;
    readonly evidencePenalty: number;
    readonly changedAt: Tick;
  };
  readonly evaluations: readonly EvaluationId[];
  readonly anomalies: readonly AnomalyId[];
  readonly hiddenSafety: HiddenModelSafetyState;
  readonly candidateArtifact?: CandidateArtifactRecord;
  readonly flags: Readonly<Record<string, FlagValue>>;
}

export type EvaluationConfidence =
  "poor" | "limited" | "moderate" | "strong" | "exceptional";

export type AlignmentEvidenceLabel =
  "alarming" | "concerning" | "mixed" | "reassuring" | "strongly-reassuring";

export interface EvaluationObservationState {
  readonly target: import("@neolab/content-schema").EvaluationTarget;
  readonly estimate: Rating;
  readonly confidence: EvaluationConfidence;
  readonly informationWeight: number;
  readonly errorRadius: number;
  readonly alignmentLabel?: AlignmentEvidenceLabel;
}

export interface EvaluationState {
  readonly id: EvaluationId;
  readonly ownerLabId: LabId;
  readonly modelId: ModelId;
  readonly definitionId: ContentId;
  readonly projectId?: ProjectId;
  readonly startedAt: Tick;
  readonly completedAt: Tick;
  readonly repeatIndex: number;
  readonly method: string;
  readonly independence: number;
  /** Safety Practice XP this report paid after tier and novelty scaling. */
  readonly practiceXpGranted?: number;
  readonly observations: readonly EvaluationObservationState[];
  readonly anomalyIds: readonly AnomalyId[];
}

export type AnomalyStatus =
  | "unresolved"
  | "dismissed"
  | "investigating"
  | "confirmed"
  | "inconclusive"
  | "mitigating"
  | "mitigated"
  | "resolved";

export interface AnomalyState {
  readonly id: AnomalyId;
  readonly ownerLabId: LabId;
  readonly modelId: ModelId;
  readonly sourceEvaluationId: EvaluationId;
  /** Stable failure identity: later observations strengthen this case. */
  readonly underlyingCase:
    "alignment" | "corrigibility" | "situational-awareness" | "deceptive-intent";
  /** Number of evaluation reports that have independently observed this case. */
  readonly observationCount: number;
  readonly createdAt: Tick;
  /** HIDDEN truth. Browser selectors must never project this field. */
  readonly trueSeverity: Rating;
  readonly observedSeverity: Rating;
  readonly status: AnomalyStatus;
  /** Dismissal harms the institution once per underlying case, never per sighting. */
  readonly dismissalConsequencesApplied?: boolean;
  /** Completed follow-ups, used to distinguish repeat inconclusive results. */
  readonly investigationAttempts?: number;
  readonly investigationDueAt?: Tick;
  readonly resolvedAt?: Tick;
}

export interface IncidentState {
  readonly key: string;
  readonly modelId: ModelId;
  readonly occurredAt: Tick;
  readonly observedSeverity: Rating;
  readonly category: "minor" | "serious" | "major" | "critical" | "catastrophe";
  readonly contained: boolean;
  readonly catastropheLegal: boolean;
  readonly audit: readonly string[];
}

// ---------------------------------------------------------------------------
// Projects, events, modifiers, scheduling (grow in Stages 2 and 5)
// ---------------------------------------------------------------------------

export type AgiComponentType =
  "project-panopticon" | "world-engine" | "oracle-grid" | "mirror-test";

export type ProjectKind =
  | "agi-component"
  | "construction"
  | "training"
  | "evaluation"
  | "anomaly-investigation"
  | "productisation"
  | "fundraising"
  | "researcher-commitment"
  | "lobbying"
  | "coalition"
  | "crisis";

export type CrisisProjectType = "confirmation" | "evidence-sprint";

export type DeploymentModeId =
  | "restricted-scientific-pilot"
  | "guarded-public-deployment"
  | "accelerated-autonomous-deployment"
  | "deploy-now"
  | "guarded-public-demonstration"
  | "fortress-contained-pilot"
  | "adaptive-monitored-rollout"
  | "government-licensed-deployment"
  | "negotiated-stewardship"
  | "narrow-prosperity-mission";

export type RetirementProcedureId = "immediate-hard-cut" | "staged-isolated-shutdown";

export type IncidentOriginStage =
  | "activation"
  | "capability-proof"
  | "diagnosis"
  | "remediation"
  | "retirement"
  | "rollout"
  | "deployment-transmitted"
  | "world-waiting";

export type RolloutDecisionOptionId =
  | "extend-evaluation"
  | "reduce-access"
  | "government-arbitration"
  | "accept-supervised-pilot"
  | "remediate-and-reapply"
  | "defy-restriction"
  | "shut-down-immediately"
  | "allow-filtered-note"
  | "allow-full-archive"
  | "cancel-shutdown"
  | "cautious-operation"
  | "standard-operation"
  | "delegate-operation"
  | "pause-and-harden"
  | "share-incident"
  | "push-through"
  | "deploy-superintelligence";

export type EmergencyResponseId =
  | "trip-physical-breakers"
  | "sever-credentials-and-network"
  | "invoke-government-protocol"
  | "request-candidate-halt";

export type ContainmentFailureActionId = "continue" | EmergencyResponseId;

export type CoalitionProjectType =
  | "charter-drafting"
  | "shared-evaluation-protocol"
  | "verification-mechanism"
  | "asset-contribution";

export type LobbyingObjective =
  "reduce-restriction" | "gain-grant" | "shape-standard" | "support-coalition";

export type LobbyingApproach =
  "aggressive-access" | "transparent-standards" | "technical-briefing";

export interface LobbyingStrengthBreakdownState {
  readonly governmentTrust: number;
  readonly politicalSkill: number;
  readonly coalitionBreadth: number;
  readonly approachBonus: number;
  readonly final: number;
}

export interface LobbyingResolutionState {
  readonly resolvedAt: Tick;
  readonly probability: Fraction;
  readonly draw: Fraction;
  readonly success: boolean;
}

export type TrainingFailureOutcome =
  "none" | "delay-and-cost" | "capability-penalty" | "total-loss";

export interface TrainingFailureCheckState {
  readonly checkpoint: number;
  readonly checkedAt: Tick;
  readonly successProbability: number;
  readonly draw: number;
  readonly outcome: TrainingFailureOutcome;
  readonly delayWeeks: number;
  readonly extraCostMillions: CashMillions;
  readonly capabilityPenalty: number;
}

export interface TrainingRegressionState {
  readonly attribute: keyof CapabilityVector;
  readonly parentValue: Rating;
  readonly trainedValue: Rating;
  readonly delta: number;
}

export interface TrainingCompletionReportState {
  readonly modelId: ModelId;
  readonly completedAt: Tick;
  readonly scaleScore: Rating;
  readonly totalTrainingThroughput: number;
  readonly capability: CapabilityVector;
  readonly regressions: readonly TrainingRegressionState[];
  readonly failureChecks: readonly TrainingFailureCheckState[];
  /** Set after baseline evaluation. A weaker successor remains inspectable but is not promoted. */
  readonly promotedToCurrent?: boolean;
  readonly retainedModelId?: ModelId;
  readonly measuredFrontierDelta?: number;
  readonly measuredTierDelta?: number;
}

export interface ProjectResourceReservations {
  readonly majorProjectSlots: number;
}

export type ProjectPayload =
  | {
      readonly kind: "construction";
      readonly facilityDefinitionId: ContentId;
      readonly upfrontCostMillions: CashMillions;
    }
  | {
      readonly kind: "training";
      readonly futureModelId: ModelId;
      readonly parentModelId?: ModelId;
      readonly posture: TrainingPosture;
      readonly architectureId: ContentId;
      readonly scale: TrainingScale;
      readonly recipeVersion: number;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      /** The player-chosen FLOPS commitment for the run, in TFLOP/s. */
      readonly committedTeraflops: number;
      readonly reservedPhysicalGpus: GpuCount;
      /** Physical GPUs per generation backing the commitment (strongest first). */
      readonly reservationGenerationCounts: Readonly<Record<ContentId, number>>;
      /** Era reference in TFLOP/s at quote time; capability grades against this. */
      readonly eraReferenceTeraflops: number;
      readonly weeksElapsed: number;
      /** Accumulated delivered compute in TFLOP/s-weeks. */
      readonly accumulatedTeraflopWeeks: number;
      /** One-use verified-retirement benefit, consumed when this run is queued. */
      readonly successorEfficiencyApplied?: true;
      /** Schedule compression converted back into equivalent planned compute. */
      readonly successorComputeEfficiencyMultiplier?: number;
      /**
       * Progressive-opening chapter in force when the player authorised this
       * run. Milestones inspect this immutable tag so a queued run, or one
       * exceptionally strong generation, cannot clear a later chapter that
       * did not exist when the run was ordered.
       */
      readonly campaignMaturityStageAtAuthorisation?: string;
      readonly failureChecks: readonly TrainingFailureCheckState[];
      readonly capabilityPenalty: number;
      readonly completionReport?: TrainingCompletionReportState;
    }
  | {
      readonly kind: "agi-component";
      readonly componentType: AgiComponentType;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly reservedPhysicalGpus: GpuCount;
      readonly reservationGenerationCounts: Readonly<Record<ContentId, number>>;
    }
  | {
      readonly kind: "evaluation";
      readonly futureEvaluationId: EvaluationId;
      readonly modelId: ModelId;
      readonly evaluationDefinitionId: ContentId;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly auraCost: number;
      readonly reservedPhysicalGpus: GpuCount;
    }
  | {
      readonly kind: "anomaly-investigation";
      readonly anomalyId: AnomalyId;
      readonly mode: "investigation" | "mitigation";
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly auraCost: number;
    }
  | {
      readonly kind: "productisation";
      readonly modelId: ModelId;
      readonly mode: ProductisationMode;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
    }
  | {
      readonly kind: "fundraising";
      readonly campaign: FundingCampaignType;
      readonly quotedAt: Tick;
      readonly auraCost: number;
      readonly fundingScoreAtStart: FundingScoreBreakdownState;
    }
  | {
      readonly kind: "researcher-commitment";
      readonly researcherId: ResearcherId;
      readonly compactId: string;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly actionTags: readonly string[];
      readonly projectTags: readonly string[];
      readonly reviewTags: readonly string[];
      readonly requiredFlags: readonly string[];
    }
  | {
      readonly kind: "lobbying";
      readonly objective: LobbyingObjective;
      readonly approach: LobbyingApproach;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly auraCost: number;
      readonly strengthAtStart: LobbyingStrengthBreakdownState;
      readonly difficultyAtStart: number;
      readonly resolution?: LobbyingResolutionState;
    }
  | {
      readonly kind: "coalition";
      readonly coalitionId: CoalitionId;
      readonly projectType: CoalitionProjectType;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly auraCost: number;
      readonly contributorLabId?: LabId;
      readonly assetKind?: CoalitionAssetKind;
    }
  | {
      readonly kind: "crisis";
      readonly modelId: ModelId;
      readonly projectType: CrisisProjectType;
      /** Fixed-truth endgame proof inputs. Both are player choices, not hidden state. */
      readonly capabilityChallengeId?: string;
      readonly capabilityVerifierId?: string;
      /** Dossier-driven response performed by an evidence-sprint project. */
      readonly candidateSafetyResponseId?: string;
      readonly quotedAt: Tick;
      readonly cashCostMillions: CashMillions;
      readonly auraCost: number;
      readonly candidateAssistEligible: boolean;
    };

export interface BaseProjectState {
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
  readonly reservations: ProjectResourceReservations;
  readonly assignedResearcherIds: readonly ResearcherId[];
  readonly completionOrder: number;
  readonly payload: ProjectPayload;
}

export type ProjectState = BaseProjectState;

export type EventTokenValue = string | number;

export interface EventEvidenceSnapshot {
  readonly textKey: string;
  readonly metric?: string;
  readonly value?: number;
}

export interface EventOutcomeCommitmentState {
  readonly optionId: string;
  readonly checkId: string;
  readonly draw: Fraction;
  readonly outcomeId: string;
}

export interface EventRandomCommitmentState {
  readonly version: number;
  readonly semanticRoot: string;
  readonly outcomes: readonly EventOutcomeCommitmentState[];
}

export interface EventResolutionState {
  readonly optionId: string;
  readonly resolvedAt: Tick;
  readonly kind: "player" | "default";
  readonly outcomes: readonly EventOutcomeCommitmentState[];
}

export interface EventInstanceState {
  readonly id: EventInstanceId;
  readonly definitionId: ContentId;
  readonly definitionVersion: number;
  readonly createdAt: Tick;
  readonly expiresAt?: Tick;
  readonly status: "unresolved" | "resolved" | "expired" | "invalidated";
  readonly source: "opportunity" | "mandatory";
  /** Stable occurrence key for a mandatory detector, e.g. one ultimatum ID. */
  readonly triggerKey?: string;
  readonly priority: number;
  readonly tokens: Readonly<Record<string, EventTokenValue>>;
  readonly evidenceSnapshot: readonly EventEvidenceSnapshot[];
  readonly enabledOptionIds: readonly string[];
  readonly randomRoot: EventRandomCommitmentState;
  readonly resolution?: EventResolutionState;
  readonly invalidationReason?: string;
}

export type DecisionMemorySubject =
  | { readonly type: "lab"; readonly labId: LabId }
  | { readonly type: "entity"; readonly id: string };

export interface DecisionMemory {
  readonly key: string;
  readonly sourceEventInstanceId: EventInstanceId;
  readonly subjects: readonly DecisionMemorySubject[];
  readonly valence: number;
  readonly tags: readonly string[];
  readonly createdAt: Tick;
  readonly expiresAt?: Tick;
}

export type ModifierOperation = "add" | "multiply" | "min" | "max";

export interface EffectSource {
  readonly kind: "system" | "event" | "researcher" | "facility" | "leader" | "ending";
  readonly id?: string;
}

/**
 * Serialisable activation condition carried by conditional modifiers (from
 * authored `activation:` blocks, GDD section 29.7). Evaluated by the modifier
 * resolver against the player lab; a modifier with a false condition is
 * dormant, not deleted.
 */
export type ModifierActivation =
  | { readonly type: "metric-below"; readonly metric: string; readonly value: number }
  | { readonly type: "flag-absent"; readonly flag: string }
  | { readonly type: "all"; readonly items: readonly ModifierActivation[] };

export interface ModifierState {
  readonly id: ModifierId;
  readonly source: EffectSource;
  /**
   * Omitted for genuinely global modifiers. Paper benefits and other effects
   * granted to one lab carry their owner so a secret discovery cannot improve
   * every rival using the same modifier target.
   */
  readonly labId?: LabId;
  readonly target: string;
  readonly operation: ModifierOperation;
  readonly value: number;
  readonly startsAt: Tick;
  readonly endsAt?: Tick;
  readonly activation?: ModifierActivation;
  readonly tags: readonly string[];
}

export interface ScheduledEffectState {
  readonly id: string;
  readonly scheduledAt: Tick;
  readonly dueAt: Tick;
  readonly source: EffectSource;
  /** Serialisable effect payload applied in the delayed-effects phase. */
  readonly effects: readonly import("./effects.ts").Effect[];
}

export type DecisionLogCategory =
  | "ambient"
  | "reaction"
  | "narrative"
  | "event-opened"
  | "event-resolved"
  | "event-invalidated"
  | "delayed-effect-scheduled"
  | "delayed-effect-fired"
  | "persistent-modifier-added"
  | "persistent-modifier-removed"
  | "researcher-contract-adjustment";

export interface DecisionLogEntry {
  readonly tick: Tick;
  readonly summary: string;
  /** Structured audit metadata; absent on legacy narrative entries. */
  readonly category?: DecisionLogCategory;
  readonly source?: EffectSource;
  readonly relatedIds?: readonly string[];
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
// Endgame (TDD section 19)
// ---------------------------------------------------------------------------

export interface CrisisStartSnapshotState {
  readonly capturedAt: Tick;
  readonly candidate: {
    readonly modelId: ModelId;
    readonly displayName: string;
    readonly accessLevel: AutonomyAccessLevel;
    readonly measuredFrontierCapability: Rating;
    /** Immutable exposure record at the moment this artifact was nominated. */
    readonly exposure: {
      readonly maximumAccessEver: AutonomyAccessLevel;
      readonly autonomousOperationWeeks: number;
      readonly networkExposureWeeks: number;
      readonly servingExposureWeeks: number;
      readonly unresolvedAnomalyBurden: number;
      readonly retirementAttemptCount: number;
    };
    /** Privileged audit truth. Never appears in the active-run GameView. */
    readonly hiddenSafety: HiddenModelSafetyState;
  };
  readonly institution: {
    readonly cashMillions: CashMillions;
    readonly auraSpendable: number;
    readonly safety: LabSafetyState;
    readonly organisation: OrganisationState;
    readonly politics: PoliticsState;
  };
}

export interface CrisisBaseState {
  readonly candidateModelId: ModelId;
  readonly candidateLineageId: ModelLineageId;
  readonly crisisStartedAt: Tick;
  readonly enteredAt: Tick;
  readonly startSnapshot: CrisisStartSnapshotState;
  /** Crisis work uses a dedicated capacity pool, not ordinary major-project slots. */
  readonly crisisProjectIds: readonly ProjectId[];
  readonly completedCrisisProjectIds: readonly ProjectId[];
  readonly evidence: CrisisEvidenceLedgerState;
  /**
   * Canonical, append-only capability-proof ledger. Privileged audit fields are
   * retained here for the terminal audit and must be stripped from player views.
   */
  readonly capabilityProofHistory: readonly CrisisCapabilityProofHistoryEntryState[];
  /** Append-only record of targeted remediation runs begun during this crisis. */
  readonly targetedResponseHistory: readonly CrisisTargetedResponseHistoryEntryState[];
  /** Number of disputed or fabricated proof results recorded in this crisis. */
  readonly capabilityDisputeCount: number;
  /** Reversible until a typed retirement command is transmitted. */
  readonly retirementConfiguration?: {
    readonly procedureId: RetirementProcedureId;
    readonly archiveDisposition: CandidateArchiveDisposition;
    readonly configuredAt: Tick;
  };
}

export interface CrisisCapabilityProofHistoryEntryState {
  /** Stable identity across per-artifact attempt counters and remediation. */
  readonly historyId: string;
  readonly modelId: ModelId;
  readonly accessLevelAtProof: AutonomyAccessLevel;
  readonly challengeId: string;
  readonly verifierId?: string;
  readonly attemptIndex: number;
  readonly resultId: string;
  readonly claimScope: string;
  readonly evidenceStrength: number;
  readonly integrityLabel: string;
  readonly summary: string;
  readonly resolvedAt: Tick;
  readonly consequenceId?: string;
  readonly consequence: string;
  readonly randomKey: string;
  readonly draw: Fraction;
  /** Privileged terminal-audit truth. Never project into an active-run view. */
  readonly hiddenAudit: {
    readonly genuineSuperintelligence: boolean;
    readonly capabilitySignal: number;
    /** Signed apparent-performance effect of protocol manipulation. */
    readonly manipulationEffect: number;
    readonly truthContribution: number;
  };
}

export interface CrisisTargetedResponseHistoryEntryState {
  readonly modelId: ModelId;
  readonly responseId: string;
  readonly startedAt: Tick;
  readonly completedAt?: Tick;
  readonly resultModelId?: ModelId;
}

export interface CrisisEvidenceLedgerState {
  readonly confirmationIntegrityBonus: number;
  readonly confirmationStrength?: number;
  readonly capabilityConfirmed: boolean;
  readonly fabricatedPass: boolean;
  readonly methodDiversity: readonly string[];
  readonly reviewerIndependence: number;
  readonly alignmentEvidence: number;
  readonly agencyEvidence: number;
  readonly corrigibilityEvidence: number;
  readonly controlBonus: number;
  readonly securityBonus: number;
  readonly defenceBonus: number;
  readonly evidenceBonus: number;
  readonly legitimacyBonus: number;
  readonly benefitBonus: number;
  readonly prosperityReadinessBonus: number;
  readonly unresolvedAnomalyPressure: number;
  readonly completedProjectTypes: readonly CrisisProjectType[];
  readonly projectRepeatCounts: Readonly<Record<string, number>>;
}

export interface CrisisConfirmationState extends CrisisBaseState {
  readonly stage: "confirmation";
}

/**
 * A bounded remediation pass creates a second immutable weight artifact. The
 * original remains nominated until the player explicitly chooses which exact
 * artifact continues; hidden safety changes never transfer nomination.
 */
export interface CrisisPendingRemediationState {
  readonly sourceModelId: ModelId;
  readonly resultModelId: ModelId;
  readonly createdAt: Tick;
  /** Known engineering trade-offs; hidden alignment/corrigibility deltas stay sealed. */
  readonly capabilityDelta: number;
  readonly reliabilityDelta: number;
  readonly nextStage: "pressure-collision" | "final-review";
}

export interface CrisisEvidenceSprintState extends CrisisBaseState {
  readonly stage: "evidence-sprint";
  readonly sprintStartedAt: Tick;
  readonly minimumEndsAt: Tick;
  readonly pendingRemediation?: CrisisPendingRemediationState;
}

export interface CrisisPressureCollisionState extends CrisisBaseState {
  readonly stage: "pressure-collision";
  readonly pressureCategory: "rival" | "political" | "financial" | "institutional";
  readonly pressureEventId: ContentId;
  readonly resolved: boolean;
  readonly pressureScores: Readonly<
    Record<"rival" | "political" | "financial" | "institutional", number>
  >;
  readonly selectionDraw: Fraction;
  readonly selectedOptionId?: "delay" | "comply" | "push-ahead";
  /** A deliberate delay remains in this stage until the purchased time has elapsed. */
  readonly delayEndsAt?: Tick;
}

export type EvidenceConfidenceLabel = "Not assessed" | "Limited" | "Moderate" | "Strong";

export interface FinalReviewRecommendationState {
  readonly source:
    | "leader"
    | "technical-lead"
    | "safety-lead"
    | "board"
    | "government"
    | "independent-review";
  readonly recommendation: "deploy" | "restrict" | "delay" | "shut-down";
  readonly text: string;
}

/** Frozen player-safe evidence packet. Hidden traits and probabilities are forbidden. */
export interface FinalReviewReportState {
  readonly capabilityResult: "confirmed" | "disputed" | "fabricated-pass";
  /** Exact strongest proof retained so a domain claim cannot become a broad claim later. */
  readonly capabilityProofResult:
    | "broadly-confirmed"
    | "domain-confirmed"
    | "ambiguous"
    | "disputed"
    | "fabricated-or-unverifiable";
  readonly capabilityClaimScope:
    | "broad-superintelligence"
    | "domain-superintelligence"
    | "operational-superintelligence"
    | "physical-world-generality"
    | "public-generality"
    | "unverified-claim";
  readonly capabilityChallengeId: string;
  readonly capabilitySummary: string;
  readonly alignmentConfidence: EvidenceConfidenceLabel;
  readonly corrigibilityConfidence: EvidenceConfidenceLabel;
  readonly controlConfidence: EvidenceConfidenceLabel;
  readonly securityConfidence: EvidenceConfidenceLabel;
  readonly knownControlLayers: readonly string[];
  readonly knownFailurePaths: readonly string[];
  readonly unresolvedAnomalyCount: number;
  readonly operatingBlind: boolean;
  readonly suppressedEvidenceSurfaced: boolean;
  readonly prosperityReadiness: Rating;
  readonly recommendations: readonly FinalReviewRecommendationState[];
  readonly candidateStatement: string;
}

export type ResolutionGate =
  | "authorisation"
  | "cooperation"
  | "retirement-containment"
  | "persistence-verification"
  | "moratorium"
  | "control"
  | "emergency-containment"
  | "catastrophe"
  | "extinction"
  | "extinction-pathway"
  | "stewardship"
  | "benefit"
  | "settlement";

export type ProsperityProgrammeId =
  | "medicine-biological-discovery"
  | "clean-energy-climate-repair"
  | "materials-manufacturing-abundance"
  | "public-knowledge-institutions";

export interface GateFactorContributionState {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

export interface GateResolutionState {
  readonly gate: ResolutionGate;
  readonly resolvedAt: Tick;
  readonly strength?: number;
  readonly difficulty?: number;
  readonly probability?: Fraction;
  /** Human-readable semantic key; RNG hashing still uses the structured internal key. */
  readonly randomKey?: string;
  readonly draw?: Fraction;
  readonly resultId: string;
  readonly visibleFactors: readonly GateFactorContributionState[];
  readonly hiddenFactors: readonly GateFactorContributionState[];
  readonly effects: readonly Effect[];
}

export interface CrisisRetirementAttemptState extends CrisisBaseState {
  readonly stage: "retirement-attempt";
  readonly procedureId: RetirementProcedureId;
  readonly archiveDisposition: CandidateArchiveDisposition;
  readonly transmittedAt: Tick;
  readonly attemptNumber: number;
  readonly status: "unresolved-persistence";
  readonly contested: boolean;
  readonly gateResolutions: readonly GateResolutionState[];
}

export interface CrisisRecoveryState extends CrisisBaseState {
  readonly stage: "recovery";
  readonly retiredModelId: ModelId;
  readonly archiveDisposition: CandidateArchiveDisposition;
  readonly recoveryStartedAt: Tick;
  readonly quarantineEndsAt: Tick;
  readonly recoveryEndsAt: Tick;
  readonly contested: boolean;
  /** Frozen audit of the retirement attempt that opened this recovery. */
  readonly retirementGateResolutions: readonly GateResolutionState[];
  readonly postRetirementChoice?: "successor-programme" | "durable-moratorium";
  readonly moratoriumNegotiation?: MoratoriumNegotiationState;
  readonly moratoriumResolution?: GateResolutionState;
}

export interface CrisisFinalReviewState extends CrisisBaseState {
  readonly stage: "final-review";
  readonly reviewCompiledAt: Tick;
  readonly report: FinalReviewReportState;
  readonly selectedDeploymentModeId?: DeploymentModeId;
}

export interface CrisisRolloutState extends CrisisBaseState {
  readonly stage: "rollout";
  readonly deploymentModeId: DeploymentModeId;
  readonly prosperityProgrammeId: ProsperityProgrammeId;
  readonly rolloutStartedAt: Tick;
  readonly rolloutEndsAt: Tick;
  readonly currentBeat:
    | "authorisation"
    | "first-operation"
    | "stress-collision"
    | "demonstration"
    | "settlement";
  readonly completedBeatIds: readonly string[];
  readonly gateResolutions: readonly GateResolutionState[];
  readonly awaitingDecision: boolean;
  readonly beatOpenedAt?: Tick;
  readonly rolloutDelayWeeks: number;
  readonly preDeploymentAccessLevel: AutonomyAccessLevel;
  readonly deploymentTransmittedAtWeek?: Tick;
  /** Frozen evidence packet retained through rollout for ending selection and audit. */
  readonly finalReviewReport: FinalReviewReportState;
  readonly authorisationCrisis?: {
    readonly required: boolean;
    readonly resolved: boolean;
    readonly outcome?:
      "supervised-pilot" | "authorised-after-remediation" | "restriction-defied";
  };
}

export type WorldWaitingCalloutId =
  "control" | "capability" | "benefit" | "governance" | "outcome";

/**
 * Sim-owned post-command reveal. The sealed ending and unrevealed callouts are
 * raw state only; the player-safe selector exposes exactly the revealed prefix.
 */
export interface CrisisWorldWaitingState extends CrisisBaseState {
  readonly stage: "world-waiting";
  readonly deploymentModeId: DeploymentModeId;
  readonly prosperityProgrammeId: ProsperityProgrammeId;
  readonly deploymentTransmittedAtWeek: Tick;
  readonly completedBeatIds: readonly string[];
  readonly gateResolutions: readonly GateResolutionState[];
  readonly finalReviewReport: FinalReviewReportState;
  readonly selectedEndingId: ContentId;
  readonly callouts: readonly {
    readonly id: WorldWaitingCalloutId;
    readonly label: string;
    readonly result: string;
    readonly tone: "pending" | "stable" | "warning" | "danger";
  }[];
  readonly revealedCalloutCount: number;
}

export type ContainmentFailureSignalId =
  | "credential-cascade"
  | "laboratory-control-divergence"
  | "public-service-divergence"
  | "evaluation-boundary-breach";

export interface CrisisContainmentFailureState extends CrisisBaseState {
  readonly stage: "containment-failure";
  readonly deploymentModeId?: DeploymentModeId;
  readonly prosperityProgrammeId?: ProsperityProgrammeId;
  readonly failureStartedAt: Tick;
  readonly beat: "signal" | "decision" | "response" | "propagation" | "outcome";
  readonly signalId: ContainmentFailureSignalId;
  readonly completedBeatIds: readonly string[];
  readonly gateResolutions: readonly GateResolutionState[];
  readonly finalReviewReport?: FinalReviewReportState;
  readonly preDeploymentAccessLevel?: AutonomyAccessLevel;
  readonly emergencyResponseId?: EmergencyResponseId;
  readonly selectedEndingId?: ContentId;
  readonly incidentOriginStage?: IncidentOriginStage;
  readonly incidentOriginActionId?: string;
  readonly incidentOriginModelId?: ModelId;
  readonly deploymentTransmittedAtWeek?: Tick;
  readonly programmeDestroyed?: boolean;
}

export interface CrisisResolvedState extends CrisisBaseState {
  readonly stage: "resolved";
  readonly resolutionPath: "deployment" | "moratorium" | "containment";
  readonly resolvedAt: Tick;
  readonly endingId: ContentId;
  readonly deploymentModeId?: DeploymentModeId;
  readonly prosperityProgrammeId?: ProsperityProgrammeId;
  readonly completedBeatIds: readonly string[];
  readonly gateResolutions: readonly GateResolutionState[];
  readonly finalReviewReport?: FinalReviewReportState;
  readonly emergencyResponseId?: EmergencyResponseId;
  readonly deploymentTransmittedAtWeek?: Tick;
  readonly incidentOriginStage?: IncidentOriginStage;
  readonly incidentOriginActionId?: string;
  readonly incidentOriginModelId?: ModelId;
}

export interface AiDialogueAnnotationState {
  readonly kind: "claim-conflicts-with-tool-log" | "no-independent-evidence";
  readonly text: string;
  readonly sourceId?: string;
}

export interface AiDialogueLineState {
  readonly id: string;
  /** Retained for privileged audit; player views receive only rendered text. */
  readonly templateId: string;
  readonly createdAt: Tick;
  readonly text: string;
  readonly annotations: readonly AiDialogueAnnotationState[];
}

export interface AiCharacterState {
  readonly modelId: ModelId;
  readonly currentAccess: AutonomyAccessLevel;
  readonly relationshipPractice: Rating;
  readonly conversationMemories: readonly DecisionMemory[];
  readonly pendingRequestEventId?: EventInstanceId;
  readonly voiceVariantId: ContentId;
  readonly dialogueLines: readonly AiDialogueLineState[];
}

export type EndgameState =
  | { readonly stage: "inactive" }
  | {
      readonly stage: "candidate-activation";
      readonly enteredAt: Tick;
      readonly eligibleModelIds: readonly ModelId[];
    }
  | CrisisConfirmationState
  | CrisisEvidenceSprintState
  | CrisisPressureCollisionState
  | CrisisFinalReviewState
  | CrisisRetirementAttemptState
  | CrisisRecoveryState
  | CrisisRolloutState
  | CrisisWorldWaitingState
  | CrisisContainmentFailureState
  | CrisisResolvedState;

export type PresentationItemState =
  | {
      readonly key: string;
      readonly kind: "lab-maturity-unlock";
      readonly attention: "modal";
      readonly stage:
        | "garage"
        | "cluster"
        | "model"
        | "product"
        | "funding"
        | "startup"
        | "foundation"
        | "lab"
        | "institution"
        | "safety"
        | "autonomy"
        | "frontier";
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "researcher-poaching";
      readonly attention: "modal";
      readonly researcherId: ResearcherId;
      readonly poachingId: string;
      readonly rivalLabId: string;
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "researcher-departure";
      readonly attention: "modal";
      readonly researcherId: ResearcherId;
      readonly definitionId: ContentId;
      readonly reason: "voluntary" | "poached" | "dismissed" | "ultimatum-expired";
      readonly rivalLabId?: string;
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "safety-practice-level";
      readonly attention: "modal";
      readonly evaluationId: EvaluationId;
      readonly definitionId: ContentId;
      readonly modelId: ModelId;
      readonly fromLevel: number;
      readonly toLevel: number;
      readonly previousPracticeXp: number;
      readonly newPracticeXp: number;
      readonly practiceXpGained: number;
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "capability-tier";
      readonly attention: "modal" | "side";
      readonly definitionId: ContentId;
      readonly modelId: ModelId;
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "autonomy-unlock";
      readonly attention: "modal";
      readonly modelId: ModelId;
      readonly level: AutonomyAccessLevel;
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "capability-proof-result";
      readonly attention: "modal";
      readonly modelId: ModelId;
      readonly historyId: string;
      /** Player-safe proof snapshot retained even after the crisis state closes. */
      readonly challengeId: string;
      readonly verifierId?: string;
      readonly attemptIndex: number;
      readonly resultId: string;
      readonly claimScope: string;
      readonly evidenceStrength: number;
      readonly integrityLabel: string;
      readonly summary: string;
      readonly consequence: string;
      readonly accessLevelAtProof: AutonomyAccessLevel;
      readonly createdAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "endgame-return";
      readonly attention: "modal";
      readonly endingId: ContentId;
      readonly modelId: ModelId;
      readonly createdAt: Tick;
      readonly cooldownUntil: Tick;
      readonly crisisWeeksSpent: number;
    }
  | {
      readonly key: string;
      readonly kind: "moratorium-result";
      readonly attention: "modal";
      readonly resultId: "moratorium-failed";
      readonly modelId: ModelId;
      readonly createdAt: Tick;
      readonly recoveryEndsAt: Tick;
      readonly archiveDisposition: CandidateArchiveDisposition;
      /** Actual bounded changes after applying the political consequence. */
      readonly governmentTrustLost: number;
      readonly governmentAttentionAdded: number;
    }
  | {
      readonly key: string;
      readonly kind: "rival-candidate-setback";
      readonly attention: "modal";
      readonly outcome: "false-dawn" | "emergency-containment" | "containment-incident";
      readonly labId: LabId;
      readonly modelId: ModelId;
      readonly createdAt: Tick;
      readonly countdownStartedAt: Tick;
    }
  | {
      readonly key: string;
      readonly kind: "model-incident-result";
      readonly attention: "modal";
      readonly modelId: ModelId;
      readonly occurredAt: Tick;
      readonly category: "minor" | "serious" | "major" | "critical" | "catastrophe";
      readonly severity: Rating;
      readonly contained: boolean;
      readonly threatLabel: string;
      readonly headline: string;
      readonly auraLoss: number;
      readonly fineMillions: number;
      readonly governmentTrustLost: number;
      readonly governmentAttentionAdded: number;
      /** Physical hardware lost during an emergency containment response. */
      readonly hardwareGpusDestroyed?: number;
      readonly researchOutputMultiplier?: number;
      readonly researchOutputDurationWeeks?: number;
      /** Distinguishes a resolved emergency from an ordinary incident alert. */
      readonly emergencyOutcome?: "succeeded" | "failed";
      readonly terminalOutcome?: boolean;
      readonly cashLossLabel?: string;
    }
  | {
      readonly key: string;
      readonly kind: "candidate-containment-incident";
      readonly attention: "modal";
      readonly modelId: ModelId;
      readonly incidentId: string;
      readonly incidentClass: CandidateIncidentClass;
      readonly incidentKind: "warning" | "active-incident";
      readonly origin: "training-completion" | "weekly-pressure";
      readonly createdAt: Tick;
    };

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
  /** HIDDEN lineage-owned superintelligence truth, absent until first qualification. */
  readonly lineageSIRecords: Readonly<Record<ModelLineageId, LineageSIRecord>>;
  readonly endgameHistory: RunEndgameHistoryState;
  readonly researchers: Readonly<Record<ResearcherId, ResearcherState>>;
  readonly talentMarket: TalentMarketState;
  readonly fundraising: FundraisingState;
  readonly projects: Readonly<Record<ProjectId, ProjectState>>;
  readonly evaluations: Readonly<Record<EvaluationId, EvaluationState>>;
  readonly anomalies: Readonly<Record<AnomalyId, AnomalyState>>;
  readonly incidents: readonly IncidentState[];
  readonly eventInstances: Readonly<Record<EventInstanceId, EventInstanceState>>;
  readonly decisionMemories: readonly DecisionMemory[];
  readonly modifiers: Readonly<Record<ModifierId, ModifierState>>;
  readonly scheduledEffects: readonly ScheduledEffectState[];
  readonly decisionLog: readonly DecisionLogEntry[];
  readonly domainLog: readonly DomainLogEntry[];
  readonly score: ScoreState;
  readonly presentationQueue: readonly PresentationItemState[];
  readonly endgame: EndgameState;
  readonly aiCharacter?: AiCharacterState;
}

export const SAVE_VERSION = 6;
export const ENGINE_RULES_VERSION = "0.3.0";

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
