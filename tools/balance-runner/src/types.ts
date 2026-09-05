import type {
  CompiledContent,
  ContentId,
  EventLikelihoodLabel,
} from "@neolab/content-schema";
import type { GameCommand, GamePhase, GameView, Seed128 } from "@neolab/sim";

/** Closed policy catalogue required by TDD section 26.2. */
export const POLICY_IDS = [
  "balanced",
  "capability-first",
  "commercial",
  "open-science",
  "safety-institution",
  "secretive-proprietary",
  "coalition-builder",
  "random-legal",
  "never-fund-serving",
  "never-train-model",
] as const;

export type PolicyId = (typeof POLICY_IDS)[number];

export const CORE_STRATEGY_POLICY_IDS: readonly PolicyId[] = [
  "balanced",
  "capability-first",
  "commercial",
  "open-science",
  "safety-institution",
  "secretive-proprietary",
  "coalition-builder",
];

export const BAD_BASELINE_POLICY_IDS: readonly PolicyId[] = [
  "never-fund-serving",
  "never-train-model",
];

export type CommandCategory =
  | "event"
  | "research-choice"
  | "publication"
  | "allocation"
  | "price"
  | "fundraising"
  | "funding-offer"
  | "gpu"
  | "facility"
  | "training"
  | "evaluation"
  | "anomaly"
  | "productisation"
  | "deployment-policy"
  | "recruitment"
  | "people"
  | "lobbying"
  | "diplomacy"
  | "coalition"
  | "crisis"
  | "deployment"
  | "rollout";

export type StrategyTag =
  | "mandatory"
  | "balanced"
  | "capability"
  | "commercial"
  | "safety"
  | "prestige"
  | "secretive"
  | "coalition"
  | "cash"
  | "serving-zero"
  | "training-zero"
  | "cautious"
  | "aggressive";

export interface AvailableCommandView {
  readonly id: string;
  readonly category: CommandCategory;
  readonly command: GameCommand;
  readonly summary: string;
  readonly tags: readonly StrategyTag[];
  readonly cashCostMillions: number;
  readonly cashGainMillions: number;
}

/** The policy boundary contains only the normal player projection. */
export interface PolicyView {
  readonly game: GameView;
  readonly seed: Seed128;
  readonly policyId: PolicyId;
}

export interface SimulationPolicy {
  readonly id: PolicyId;
  decide(
    view: Readonly<PolicyView>,
    available: readonly AvailableCommandView[],
  ): readonly GameCommand[];
}

export type BalanceMatrixMode = "independent" | "paired" | "cartesian";

export interface BalanceShard {
  readonly index: number;
  readonly count: number;
}

export interface BalanceRunRequest {
  readonly seeds: readonly Seed128[];
  readonly difficultyIds: readonly ContentId[];
  readonly leaderIds: readonly ContentId[];
  readonly mandateIds: readonly ContentId[];
  readonly policies: readonly SimulationPolicy[];
  readonly maxTicks: number;
  readonly traceSampleRate: number;
  /**
   * `cartesian` is the release-quality matrix. `paired` compares every policy
   * in the same worlds. `independent` cycles policies across distinct worlds.
   */
  readonly matrixMode?: BalanceMatrixMode;
  readonly shard?: BalanceShard;
  readonly content?: CompiledContent;
}

export interface BalanceRunSpecification {
  readonly ordinal: number;
  readonly runKey: string;
  readonly seed: Seed128;
  readonly policyId: PolicyId;
  readonly difficultyId: ContentId;
  readonly leaderId: ContentId;
  readonly mandateId: ContentId;
}

export interface RivalCompetitivenessResult {
  /** First canonical Frontier entry when available; run end is diagnostic fallback only. */
  readonly plausibilityMeasurement: "frontier-entry" | "run-end-fallback";
  readonly plausibilityMeasuredAtTick: number;
  readonly plausibleContenderCount: number;
  readonly atLeastTwoPlausible: boolean;
  readonly leadingRivalLabId?: string;
  /** Captured when the first live rival candidate countdown becomes observable to the runner. */
  readonly responseWindowMeasuredAtTick?: number;
  readonly responseWindowRivalLabId?: string;
  readonly leadingRivalCandidateWeeksRemaining?: number;
  readonly viableResponseWindow?: boolean;
  /** Public candidacy history, retained so a live countdown is not mistaken for a win. */
  readonly candidateOutcomes: RivalCandidateOutcomeMetrics;
  readonly safetyPausePlanSelections: number;
  readonly commercialPlanSelections: number;
  readonly cooperationPlanSelections: number;
}

export type RivalCandidateOutcome =
  | "countdown-started"
  | "containment-incident"
  | "false-dawn"
  | "emergency-containment"
  | "deployment-delay"
  | "rival-ascendance"
  | "catastrophe";

export interface RivalCandidateOutcomeEntry {
  readonly tick: number;
  readonly labId: string;
  readonly modelId: string;
  readonly outcome: RivalCandidateOutcome;
}

export interface RivalCandidateOutcomeMetrics {
  readonly countdownStarts: number;
  /** Distinct lab/model artifacts that entered a countdown. */
  readonly uniqueCandidateArtifacts: number;
  /** Countdown exits, excluding an intermediate deployment delay. */
  readonly countdownClosures: number;
  /** Every expiry draw, including delays that keep a countdown alive. */
  readonly resolutionAttempts: number;
  /** Run-ending rival deployments: ascendance plus catastrophe. */
  readonly terminalDeployments: number;
  readonly containmentIncidents: number;
  readonly falseDawns: number;
  readonly emergencyContainments: number;
  readonly deploymentDelays: number;
  readonly successfulDeployments: number;
  readonly catastrophes: number;
  readonly activeCountdownsAtEnd: number;
  /** Candidate lineage priors observed among distinct started artifacts. */
  readonly candidatePriorSamples: number;
  readonly firstQualifyingCapabilityMin?: number;
  readonly firstQualifyingCapabilityMean?: number;
  readonly firstQualifyingCapabilityMax?: number;
  readonly superintelligencePriorMean?: number;
  readonly guaranteedGenuineCandidates: number;
  readonly notGenuineCandidates: number;
  readonly firstCountdownStartedAt?: number;
  readonly firstResolvedAt?: number;
  readonly lastResolvedAt?: number;
  readonly timeline: readonly RivalCandidateOutcomeEntry[];
}

export type LossFamily =
  | "rival-ascendance"
  | "bankruptcy-or-mission-capture"
  | "regulation-or-nationalisation"
  | "capability-or-prosperity"
  | "loss-of-control"
  | "other"
  | "not-a-loss";

/** The three terminal outcome groups used for top-level ending balance. */
export type EndingOutcome =
  "player-victory" | "non-extinction-loss" | "human-extinction" | "incomplete";

export interface BalanceMilestones {
  readonly survivedFoundation: boolean;
  readonly competitiveEnteringFrontier: boolean;
  readonly candidateOrViableCoalition: boolean;
  readonly reachedFinalDeploymentChoice: boolean;
  readonly victory: boolean;
}

export interface BalanceCommandLogEntry {
  readonly tick: number;
  readonly command: GameCommand;
}

export interface BalanceReplayLog {
  readonly commands: readonly BalanceCommandLogEntry[];
  readonly finalStateHash: string;
}

export interface ResearcherRunMetrics {
  readonly hires: number;
  readonly departures: number;
  readonly employedAtEnd: number;
  readonly starSlotsAtEnd: number;
  readonly meanSlotUtilisation: number;
}

export interface FacilityBuildMetric {
  readonly definitionId: ContentId;
  readonly completedAt: number;
  readonly upfrontCostMillions: number;
  /** Confounded diagnostic, not a causal ROI claim. Null when 26 weeks were unavailable. */
  readonly cashDeltaAfter26Weeks: number | null;
}

export interface EventRunMetrics {
  readonly ordinaryDecisionCount: number;
  readonly stateConditionedCount: number;
  readonly categories: Readonly<Record<string, number>>;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly likelihoodPromises: Readonly<
    Partial<
      Record<
        EventLikelihoodLabel,
        { readonly trials: number; readonly successes: number }
      >
    >
  >;
  readonly delayedFollowUpWeeks: readonly number[];
}

export interface HiddenInformationRunMetrics {
  readonly weakEvidenceCases: number;
  readonly weakEvidenceWrongCategory: number;
  readonly strongEvidenceCases: number;
  readonly strongEvidenceWrongCategory: number;
  readonly catastrophes: number;
  readonly catastrophesWithLegibleWarning: number;
  readonly fairCatastrophes: number;
}

export interface EndgameRunMetrics {
  readonly furthestStage: string;
  readonly crisisStartedAt?: number;
  /** Maximum contiguous simulation weeks spent in each observed endgame stage. */
  readonly stageDwellWeeks: Readonly<Record<string, number>>;
  /** Stages whose dwell exceeded the stage-specific harness allowance. */
  readonly stalledStageIds: readonly string[];
  readonly gateResults: Readonly<Record<string, string>>;
  readonly gateProbabilities: Readonly<Record<string, number>>;
  /**
   * Oracle-only terminal diagnostics used to tune causal ending variants.
   * Never projected into the player-facing game view.
   */
  readonly resolutionInputs?: {
    readonly deploymentModeId: string;
    readonly capabilityResult: string;
    readonly remainingDefence: number;
    readonly legitimacy: number;
    readonly accessLevel: number;
    readonly evidenceConfidence: string;
    readonly offensiveAgency: number;
    readonly deceptiveCapability: number;
  };
}

export interface BalanceAnomalyCounts {
  readonly impossibleProjects: number;
  readonly negativePrices: number;
  readonly invalidAllocations: number;
  readonly deadlockedEvents: number;
}

export interface BalanceRunResult {
  readonly ordinal: number;
  readonly runKey: string;
  readonly seed: Seed128;
  readonly policyId: PolicyId;
  readonly difficultyId: ContentId;
  readonly leaderId: ContentId;
  readonly mandateId: ContentId;
  readonly status: "won" | "lost" | "incomplete";
  readonly endingId: string;
  readonly endingOutcome: EndingOutcome;
  readonly lossFamily: LossFamily;
  readonly ticks: number;
  readonly estimatedRealMinutes: number;
  readonly score: number;
  readonly phaseEntryTicks: Partial<Readonly<Record<GamePhase, number>>>;
  readonly milestones: BalanceMilestones;
  readonly playerWorldFirstPapers: number;
  readonly totalDiscoveredPapers: number;
  readonly playerWorldFirstShare: number;
  readonly paperOwnership: Readonly<Record<string, number>>;
  readonly eventDefinitions: Readonly<Record<string, number>>;
  readonly eventOptions: Readonly<Record<string, number>>;
  readonly rivalCompetitiveness: RivalCompetitivenessResult;
  readonly researchers: ResearcherRunMetrics;
  readonly facilities: readonly FacilityBuildMetric[];
  readonly events: EventRunMetrics;
  readonly hiddenInformation: HiddenInformationRunMetrics;
  readonly endgame: EndgameRunMetrics;
  readonly anomalies: BalanceAnomalyCounts;
  readonly rejectedPolicyCommands: number;
  readonly rejectedPolicyCommandReasons: Readonly<Record<string, number>>;
  readonly replay?: BalanceReplayLog;
  readonly trace?: readonly BalanceTracePoint[];
}

export interface BalanceTracePoint {
  readonly tick: number;
  readonly phase: GamePhase;
  readonly cashMillions: number;
  readonly physicalGpus: number;
  readonly aura: number;
  readonly capabilityResearchPoints: number;
  readonly safetyResearchPoints: number;
  readonly safetyEvidence: number;
  readonly frontierCapability: number;
  /** Visible research levels used to explain why model capability has stalled. */
  readonly capabilityDomainLevels: Readonly<Record<string, number>>;
  /** Current model's measured dimensions; absent before the first evaluation. */
  readonly measuredCapability: Readonly<Record<string, number>>;
  readonly strongestMeasuredModelId?: string;
  readonly strongestFrontierCapability: number;
  readonly strongestMeasuredCapability: Readonly<Record<string, number>>;
  /** Oracle-only balance diagnostic. Never projected into the player-facing view. */
  readonly strongestTrueFrontierCapability: number;
  /** Oracle-only balance diagnostic. Never projected into the player-facing view. */
  readonly strongestTrueCapability: Readonly<Record<string, number>>;
  readonly strongestModelTrainedAtTick?: number;
  readonly strongestModelGeneration?: number;
  readonly strongestModelScaleScore?: number;
  readonly strongestModelCapabilityPenalty?: number;
  readonly strongestModelFailureOutcomes?: readonly string[];
  readonly score: number;
  readonly discoveredPapers: number;
  readonly employedResearchers: number;
  readonly starSlots: number;
  readonly completedFacilities: number;
  readonly activeProjects: number;
  readonly eventInstances: number;
}

export interface BalancePolicySummary {
  readonly policyId: PolicyId;
  readonly runs: number;
  readonly wins: number;
  readonly losses: number;
  readonly incomplete: number;
  readonly winRate: number;
  readonly meanTicks: number;
  readonly meanEstimatedRealMinutes: number;
  readonly meanScore: number;
  readonly playerWorldFirstShare: number;
  readonly rivalFrontierEntrySamples: number;
  readonly atLeastTwoPlausibleRivalsRate: number | null;
  readonly viableResponseWindowRate: number | null;
}

export type ReportDimension = "policy" | "difficulty" | "leader" | "mandate";

export interface BalanceDimensionSummary {
  readonly dimension: ReportDimension;
  readonly value: string;
  readonly runs: number;
  readonly wins: number;
  readonly losses: number;
  readonly incomplete: number;
  readonly winRate: number;
  readonly meanTicks: number;
  readonly meanEstimatedRealMinutes: number;
  readonly meanScore: number;
}

export interface BalanceCurvePoint {
  readonly tick: number;
  readonly samples: number;
  readonly meanCashMillions: number;
  readonly meanPhysicalGpus: number;
  readonly meanAura: number;
  readonly meanCapabilityResearchPoints: number;
  readonly meanSafetyResearchPoints: number;
  readonly meanSafetyEvidence: number;
  readonly meanFrontierCapability: number;
  readonly meanEmployedResearchers: number;
  readonly meanCompletedFacilities: number;
}

export interface BalanceTargetResult {
  readonly id: string;
  readonly status: "pass" | "fail" | "unavailable";
  readonly sampleSize: number;
  readonly actual: number | null;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly note: string;
}

export interface BalanceReport {
  readonly reportFormat: 2;
  readonly generatedAt: string;
  readonly elapsedMilliseconds: number;
  readonly runCount: number;
  readonly requestedMaxTicks: number;
  readonly traceSampleRate: number;
  readonly content: {
    readonly version: string;
    readonly hash: string;
    readonly leaders: number;
    readonly researchers: number;
    readonly papers: number;
    readonly facilities: number;
    readonly events: number;
  };
  readonly matrix: {
    readonly mode: BalanceMatrixMode;
    readonly totalConfigurations: number;
    readonly shard?: BalanceShard;
    readonly seeds: number;
    readonly policies: number;
    readonly difficulties: number;
    readonly leaders: number;
    readonly mandates: number;
  };
  readonly winFunnel: {
    readonly won: number;
    readonly lost: number;
    readonly incomplete: number;
    readonly endings: Readonly<Record<string, number>>;
    readonly milestones: Readonly<Record<keyof BalanceMilestones, number>>;
  };
  readonly endingOutcomes: Readonly<Record<EndingOutcome, number>>;
  readonly lossFamilies: Readonly<Record<LossFamily, number>>;
  readonly policySummaries: readonly BalancePolicySummary[];
  readonly dimensionSummaries: readonly BalanceDimensionSummary[];
  readonly resourceCurves: readonly BalanceCurvePoint[];
  readonly paperOwnership: Readonly<Record<string, number>>;
  readonly researcherMetrics: {
    readonly hires: number;
    readonly departures: number;
    readonly meanSlotUtilisation: number;
  };
  readonly facilityMetrics: Readonly<
    Record<
      string,
      {
        readonly completions: number;
        readonly meanCompletionTick: number;
        readonly meanUpfrontCostMillions: number;
        readonly meanCashDeltaAfter26Weeks: number | null;
      }
    >
  >;
  readonly eventFrequency: Readonly<Record<string, number>>;
  readonly eventOptionFrequency: Readonly<Record<string, number>>;
  readonly eventOutcomeFrequency: Readonly<Record<string, number>>;
  readonly eventCalibration: {
    readonly ordinaryEventsPerRun: number;
    readonly stateConditionedRate: number | null;
    readonly maximumCategoryShare: number | null;
    readonly offeredOptionsSelectedRate: number | null;
    readonly veryLikelySuccessRate: number | null;
    readonly likelihoodPromises: Readonly<
      Partial<
        Record<
          EventLikelihoodLabel,
          {
            readonly trials: number;
            readonly successes: number;
            readonly successRate: number;
          }
        >
      >
    >;
    readonly delayedFollowUpsWithin4To26WeeksRate: number | null;
  };
  readonly hiddenInformationCalibration: {
    readonly weakEvidenceWrongCategoryRate: number | null;
    readonly strongEvidenceWrongCategoryRate: number | null;
    readonly catastrophesWithLegibleWarningRate: number | null;
    readonly fairCatastropheRate: number | null;
  };
  readonly rivalCompetitiveness: {
    readonly frontierEntrySamples: number;
    readonly atLeastTwoPlausibleRate: number | null;
    readonly viableResponseWindowRate: number | null;
    readonly candidateOutcomes: Omit<RivalCandidateOutcomeMetrics, "timeline">;
    readonly safetyPausePlanSelections: number;
    readonly commercialPlanSelections: number;
    readonly cooperationPlanSelections: number;
  };
  readonly endgame: {
    readonly furthestStages: Readonly<Record<string, number>>;
    readonly gateResults: Readonly<Record<string, number>>;
    readonly stalledStages: Readonly<Record<string, number>>;
  };
  readonly anomalyCounts: BalanceAnomalyCounts;
  readonly targets: readonly BalanceTargetResult[];
  readonly flags: readonly string[];
  readonly runs: readonly BalanceRunResult[];
}
