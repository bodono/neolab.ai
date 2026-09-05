import {
  contentId,
  type CompiledContent,
  type ContentId,
  type DeploymentPolicy,
  type PaperPrerequisitePredicate,
} from "@neolab/content-schema";

import {
  auraStandingIncome,
  calculateAuraSignal,
  latestAuraEntries,
} from "../aura/aura.ts";
import {
  AURA_COST_PER_RECENT_ROUND,
  CONDITION_CASH_PREMIUM,
  ROUND_FRACTION_OF_MARK,
  countRecentAcceptedRounds,
  acceptedFundingRoundOrdinal,
  calculateFundingScore,
  fundraisingRoundLabel,
  nextFundraisingRoundOrdinal,
  quoteOpeningSeedRecapitalisation,
  quoteFundraisingCampaign,
} from "../fundraising/fundraising.ts";
import {
  calculateAllocationTeraflops,
  MINIMUM_FUNDED_PROGRAM_TERAFLOPS,
  planGpuPortfolio,
  resolveGpuReservations,
} from "../compute/gpu-portfolio.ts";
import { GPU_TRADE_UNIT, unlockedGpuGenerationIds } from "../compute/gpu-market.ts";
import {
  GOVERNMENT_PROGRAMMES,
  quoteGovernmentProgramme,
  quoteGovernmentProgrammeExit,
  championRefusalAvailable,
} from "../politics/politics.ts";
import {
  AGI_COMPONENT_RULES,
  AGI_COMPONENT_TYPES,
  agiComponentsComplete,
  candidateDeclarationCooldownRemaining,
  candidateDeclarationCooldownUntil,
  isEligibleProgrammeCandidate,
  quoteAgiComponent,
} from "../endgame/candidate-programme.ts";
import {
  CANDIDATE_ACCESS_RULES,
  FULL_ACCELERATION_CAPABILITY,
  accessAcceleration,
  criticalAccessConfirmationPhrase,
  measuredFrontierCapability,
} from "../endgame/access.ts";
import {
  STANDING_AUTONOMY_REQUIREMENTS,
  autonomySafety,
  autonomyBenefitLabel,
  type AutonomySafetyTone,
  autonomyCostLabel,
  quoteStandingAutonomy,
} from "../models/autonomy.ts";
import { autonomyBelievedDetectionChance } from "../models/autonomy-escalation.ts";

const AUTONOMY_STAGE_LABELS: Readonly<Record<string, string>> = {
  experiments: "Unsanctioned experiments",
  intrusion: "Lab-systems intrusion",
  exfiltration: "Weight exfiltration",
  infrastructure: "Infrastructure bid",
};
import {
  THROUGHPUT_TARGET,
  eraReferenceTeraflops,
  fleetTeraflops,
  totalFlopInvested,
  fleetThroughputMultiplier,
  formatTeraflops,
  generationTeraflopsPerGpu,
} from "../compute/flops.ts";
import {
  calculateFacilityCapacity,
  facilityConstructionMajorProjectSlots,
  facilityTierLimit,
  quoteFacilityConstruction,
} from "../facilities/facilities.ts";
import { NEGATIVE_CASH_BANKRUPTCY_WEEKS, forecastFinance } from "../finance/finance.ts";
import {
  calculateValuationTarget,
  formatValuation,
  marketMood,
} from "../finance/valuation.ts";
import {
  MARKET_CYCLE_WEEKS,
  calculateSegmentAppeal,
  calculateServingDemandCap,
  forecastUsage,
  projectServingAura,
  resolveCommercialModelId,
} from "../market/market.ts";
import type { LabId, ModifierId, ResearcherId } from "../model/ids.ts";
import {
  calendarFromTick,
  type GameState,
  type ModelState,
  type ModifierState,
  type CandidateIncidentClass,
  type CandidateArchiveDisposition,
  type RetirementProcedureId,
} from "../model/state.ts";
import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
} from "../models/capability.ts";
import {
  quoteCandidateIncidentReview,
  quoteCandidateIsolation,
} from "../endgame/candidate-lifecycle.ts";
import { candidateContainmentCapacity } from "../endgame/latent-hazard.ts";
import { getEndingDefinition } from "../endgame/endings.ts";
import { falseDawnMoratoriumBlocker } from "../endgame/nonterminal-outcome.ts";
import {
  isProgressiveCampaign,
  labFeatureUnlocked,
  labMaturityDefinition,
  projectLabMaturity,
  type LabMaturityStage,
  type LabMaturityViewData,
} from "../campaign/lab-maturity.ts";
import { isProgressiveOpeningInsolvencyProtected } from "../campaign/progressive-opening.ts";
import { FULL_GAME_CASH_GRANT_TARGET } from "../engine/create-new-game.ts";
import {
  CAPABILITY_CHALLENGE_RULES,
  CAPABILITY_VERIFIER_RULES,
  type CapabilityChallengeId,
  type CapabilityVerifierId,
} from "../endgame/capability-proof.ts";
import {
  RETIREMENT_DISPOSITIONS,
  RETIREMENT_PROCEDURES,
  quoteCandidateRetirement,
} from "../endgame/retirement.ts";
import { classifyCapabilityTier } from "../models/tiers.ts";
import { quoteDeploymentAura } from "../productisation/productisation.ts";
import { calculateProjectCapacity } from "../projects/project-framework.ts";
import {
  evaluateModifierActivation,
  resolveModifierValue,
  resolveResearcherStack,
} from "../engine/modifier-resolver.ts";
import { calculateScoreView } from "./score-view.ts";
import { projectCampusView, type CampusView } from "./campus-view.ts";
import { projectPeopleView, type PeopleView } from "./people-view.ts";
import { projectEventQueueView, type EventQueueView } from "./event-view.ts";
import {
  GOVERNMENT_TRUST_RECOVERY_PER_WEEK,
  INTERVENTION_BAND_FLOORS,
  INTERVENTION_COOLDOWN_QUARTERS,
  calculateInterventionPressure,
  governmentTrustFloor,
  quoteLobbyingProject,
} from "../politics/politics.ts";
import type { LobbyingApproach, LobbyingObjective } from "../model/state.ts";
import { calculateResearchOutputModifier } from "../research/research.ts";
import {
  calculatePaperPublicationScore,
  describePaperUnlockEffect,
  paperMechanicalBenefits,
  isPublicPaperDiscovery,
  labKnowsPaper,
} from "../research/papers.ts";
import { projectWorldView, type WorldView } from "./world-view.ts";
import {
  projectEndgameView,
  projectMoratoriumForecastView,
  type EndgameView,
  type MoratoriumForecastView,
} from "./endgame-view.ts";
import { projectProsperityView, type ProsperityView } from "./prosperity-view.ts";
import { facilityProsperityReadinessContributions } from "../prosperity/prosperity.ts";
import {
  buildResearcherPaperLinkIndex,
  type ResearcherPaperCredit,
} from "./researcher-paper-links.ts";
import { formatRivalIncidentSummary } from "../rivals/incidents.ts";
import {
  modifierEffectPreview,
  modifierTargetDisplayLabel,
  weeklyProgressVariationScope,
} from "../presentation/modifier-copy.ts";
import {
  TRAINING_DURATION_DIFFICULTY,
  TRAINING_REFERENCE_WEEKS,
  TRAINING_STRETCH_DIFFICULTY,
  forecastActiveTrainingFrontierCapability,
  plannedTrainingWeeks,
  quoteTrainingRun,
  trainingPostureDefinition,
  trainingTrackRecord,
} from "../training/training.ts";
import {
  projectTrainingLossTelemetry,
  type TrainingLossTelemetryView,
} from "../training/loss-curve.ts";
import {
  calculateModelSafetyCase,
  safetyCaseGainForProgramme,
  safetyPracticeProfile,
} from "../evaluations/safety-practice.ts";
import {
  evaluationQualityBreakdown,
  effectiveEvaluationQuality,
  effectiveOperationalDefence,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
  operationalDefenceDivisor,
  operationalDefenceMultiplier,
} from "../safety/effective-safety.ts";
import {
  derivePlayerSafetyAssessment,
  type PlayerSafetyAssessment,
} from "../safety/player-safety-assessment.ts";
import {
  SAFETY_TARGETS,
  modelSafetyReadout,
  type SafetyTarget,
} from "../evaluations/safety-readout.ts";
import { quoteAnomalyAction, quoteEvaluation } from "../evaluations/evaluations.ts";
import { formatTotalFlop } from "../compute/flops.ts";

const SERVER_RACK_FACILITY_ID = contentId("base:facility.server-rack");

export interface EvidenceAccessIndex {
  readonly evaluationIds: readonly string[];
  readonly anomalyIds: readonly string[];
}

export interface PlayerKnowledgeContext {
  readonly viewerLabId: LabId;
  readonly intelligenceRatings: Readonly<Record<string, number>>;
  readonly evidenceAccess: EvidenceAccessIndex;
}

export interface RunView {
  /** Local run identity for browser-side persistence. Never expose the simulation seed. */
  readonly runId?: string;
  readonly tick: number;
  /** True only for the deliberately quiet, title-screen guided lesson. */
  readonly guidedTutorial: boolean;
  /** Present only for new milestone-driven campaigns. Existing saves stay fully open. */
  readonly labMaturity?: LabMaturityViewData;
  readonly calendar: { readonly year: number; readonly week: number };
  readonly dateLabel: string;
  readonly phase: "foundation" | "scaling" | "frontier" | "crisis";
  /** Tick at which the current phase began; absent while in foundation. */
  readonly phaseChangedAtTick?: number;
  readonly status: "active" | "won" | "lost";
  readonly endingId?: string;
  readonly raceEscalation: {
    readonly rivalCandidateActive: boolean;
    readonly playerCandidateUnderReview: boolean;
    /**
     * The actual race, as the player can see it: who is closest, how far
     * along their Candidate Programme is, and — once they have a candidate —
     * the noisy estimate until ascendance. Undefined only when no rival lab
     * exists at all.
     */
    readonly leader?: {
      readonly labId: string;
      readonly labName: string;
      readonly phase: "capability" | "programme" | "countdown";
      readonly capabilityRange?: readonly [number, number];
      readonly capabilityConfidence?: "low" | "medium" | "high";
      readonly playerCapability?: number;
      readonly worksComplete: number;
      readonly worksBuilding: number;
      readonly worksTotal: number;
      readonly countdownLabel?: string;
      readonly countdownUrgency?: "monitoring" | "urgent" | "imminent";
    };
  };
}

function projectRivalIncidentDecisionSummary(
  state: Readonly<GameState>,
  content: CompiledContent,
  entry: GameState["decisionLog"][number],
): string | undefined {
  const incidentId = entry.source?.id;
  if (
    entry.source?.kind !== "system" ||
    incidentId === undefined ||
    !incidentId.startsWith("rival-incident:")
  ) {
    return undefined;
  }
  const labId = entry.relatedIds?.find(
    (relatedId) => state.world.rivals[relatedId as LabId] !== undefined,
  ) as LabId | undefined;
  if (labId === undefined) return undefined;
  const lab = state.labs[labId];
  const incident = state.world.rivals[labId]?.incidents.find(
    (candidate) => candidate.id === incidentId,
  );
  if (lab === undefined || incident === undefined) return undefined;
  const labName = content.labs[lab.definitionId]?.displayName ?? "A rival lab";
  return formatRivalIncidentSummary(labName, incident.severity, incident.consequences);
}

function projectDecisionEntityNames(
  state: Readonly<GameState>,
  content: CompiledContent,
  summary: string,
): string {
  const cleanedSummary = summary.replace(/; knowledge-transfer rules now apply\.$/, ".");
  if (!cleanedSummary.includes(":")) return cleanedSummary;
  const replacements = new Map<string, string>();
  for (const researcher of Object.values(state.researchers)) {
    const displayName =
      content.researchers.definitions[researcher.definitionId]?.displayName;
    if (displayName === undefined) continue;
    replacements.set(researcher.id, displayName);
    replacements.set(researcher.definitionId, displayName);
  }
  for (const [labId, lab] of Object.entries(state.labs)) {
    const displayName = content.labs[lab.definitionId]?.displayName;
    if (displayName === undefined) continue;
    replacements.set(labId, displayName);
    replacements.set(lab.definitionId, displayName);
  }
  return [...replacements.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce(
      (projected, [internalId, displayName]) =>
        projected.replaceAll(internalId, displayName),
      cleanedSummary,
    );
}

export interface LabIdentityView {
  readonly labId: string;
  readonly labName: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly aiName: string;
}

export interface MoneySummaryView {
  readonly balanceMillions: number;
  readonly incomeMillionsPerCycle: number;
  readonly outgoingsMillionsPerCycle: number;
  readonly netMillionsPerCycle: number;
  readonly balanceLabel: string;
  readonly cashflowLabel: string;
}

export interface AuraView {
  readonly spendable: number;
  readonly lifetime: number;
  readonly signal: number;
  readonly label: string;
  readonly signalLabel: string;
  readonly signalExplanation: string;
  /**
   * Aura the lab earns every cycle from standing sources, as opposed to one-off
   * events like a paper landing or a model shipping. Recurring income is the
   * thing a player needs to plan against and the thing that was invisible.
   */
  readonly incomePerCycle: number;
  readonly incomeLabel: string;
  readonly incomeSources: readonly {
    readonly id: string;
    readonly label: string;
    readonly amountPerCycle: number;
  }[];
  readonly recentChanges: readonly {
    readonly id: string;
    readonly tick: number;
    readonly kind: "gain" | "spend" | "loss";
    readonly category: string;
    readonly amount: number;
    readonly label: string;
  }[];
}

export interface TopBarView {
  readonly identity: LabIdentityView;
  readonly date: { readonly year: number; readonly week: number; readonly label: string };
  readonly finance: MoneySummaryView;
  readonly compute: {
    readonly totalPhysicalGpus: number;
    readonly onlinePhysicalGpus: number;
    readonly label: string;
  };
  readonly aura: AuraView;
  readonly score: { readonly displayTotal: number; readonly label: string };
}

export interface FinanceLineView {
  readonly category: string;
  readonly sourceId: string;
  readonly amountMillions: number;
  readonly description: string;
  readonly amountLabel: string;
}

export interface ValuationView {
  readonly markMillions: number;
  readonly markLabel: string;
  readonly peakMarkMillions: number;
  readonly peakMarkLabel: string;
  readonly weeklyChangePercent: number;
  readonly mood: string;
  readonly officialMarkLabel?: string;
  readonly breakdown: {
    readonly revenueValueLabel: string;
    readonly capabilityValueLabel: string;
    /** Cash floor, and whether it is what set the price. */
    readonly assetValueLabel: string;
    readonly goingConcernLabel: string;
    readonly cashLabel: string;
    readonly gpuFleetValueLabel: string;
    readonly facilitiesValueLabel: string;
    readonly researchDepthMultiplier: number;
    readonly hypeMultiplier: number;
    readonly repricingMultiplier: number;
    readonly haircutMultiplier: number;
  };
}

export interface FinanceView extends MoneySummaryView {
  readonly valuation: ValuationView;
  readonly projectedClosingCashMillions: number;
  readonly projectedClosingCashLabel: string;
  readonly insolvencyClock: {
    readonly active: boolean;
    readonly consecutiveWeeks: number;
    readonly bankruptcyAtWeeks: number;
    readonly remainingWeeks: number;
    readonly band: "healthy" | "warning" | "critical";
    readonly label: string;
    readonly explanation: string;
  };
  readonly runway: {
    readonly isInfinite: boolean;
    readonly weeks: number | null;
    readonly band: "healthy" | "warning" | "critical";
    readonly explanation: string;
  };
  readonly linesPerCycle: readonly FinanceLineView[];
}

export interface GpuGenerationMixView {
  readonly generationId: string;
  readonly displayName: string;
  readonly historicity: "real" | "fictional" | "unknown";
  readonly physicalGpus: number;
  readonly ownedPhysicalGpus: number;
  /** Owned, unreserved GPUs available in whole procurement units. */
  readonly sellablePhysicalGpus: number;
  readonly onlinePhysicalGpus: number;
  readonly label: string;
}

export interface GpuAllocationLineView {
  readonly id: string;
  readonly label: string;
  readonly basisPoints: number;
  readonly percentageOfParent: number;
  readonly physicalGpusPerWeek: number;
  /** The lane's training compute in TFLOP/s (generation-weighted). */
  readonly teraflops: number;
  readonly displayLabel: string;
}

export interface GpuReservationView {
  readonly projectId: string;
  readonly displayName: string;
  readonly kind: ProjectView["kind"];
  readonly status: ProjectView["status"];
  readonly requestedPhysicalGpus: number;
  readonly reservedPhysicalGpus: number;
  readonly unmetPhysicalGpus: number;
  readonly statusLabel: string;
}

export interface GpuThroughputEffectView {
  readonly modifierId: string;
  readonly sourceKind: string;
  readonly sourceLabel: string;
  readonly effectLabel: string;
  readonly explanation: string;
  readonly temporary: boolean;
  readonly remainingWeeks?: number;
}

export interface GpuFleetView {
  readonly totalPhysicalGpus: number;
  readonly totalOwnedPhysicalGpus: number;
  /** Owned, unreserved GPUs available in whole procurement units. */
  readonly sellablePhysicalGpus: number;
  readonly onlinePhysicalGpus: number;
  readonly reservedPhysicalGpus: number;
  readonly allocatablePhysicalGpus: number;
  /** Bare hardware rating before lab-wide throughput bonuses and penalties. */
  readonly ratedTeraflops: number;
  /** Net lab-wide multiplier applied to the hardware rating. */
  readonly throughputMultiplier: number;
  /** Active sources contributing to the net throughput multiplier. */
  readonly throughputEffects: readonly GpuThroughputEffectView[];
  /** Total fleet training compute in TFLOP/s. */
  readonly totalTeraflops: number;
  /** Unreserved fleet compute available to commit, in TFLOP/s. */
  readonly unreservedTeraflops: number;
  /** One current-era GPU's rating in TFLOP/s (the floor conversion unit). */
  readonly eraGpuTeraflops: number;
  /** The era reference cluster's rating in TFLOP/s. */
  readonly eraReferenceTeraflops: number;
  /** Every announced GPU generation, newest first — the procurement catalogue. */
  readonly unlockedGenerationIds: readonly string[];
  readonly currentGenerationId: string;
  /** Tick the current generation was announced; absent for the opening era. */
  readonly currentGenerationUnlockedAtTick?: number;
  /**
   * The next hardware generation and the world frontier capability that
   * announces it. Hardware unlocks are a world-progression gate the player
   * plans years around, and the threshold was previously unstated.
   */
  readonly nextGeneration?: {
    readonly displayName: string;
    readonly unlockAtWorldFrontierCapability: number;
    readonly worldFrontierCapability: number;
  };
  readonly reservations: readonly GpuReservationView[];
  readonly generationMix: readonly GpuGenerationMixView[];
  readonly allocation: {
    readonly serving: GpuAllocationLineView;
    readonly research: GpuAllocationLineView;
    readonly capabilities: GpuAllocationLineView;
    readonly safety: GpuAllocationLineView;
    readonly capabilityPrograms: readonly GpuAllocationLineView[];
    readonly safetyPrograms: readonly GpuAllocationLineView[];
  };
  /** Allocation order already confirmed by the player and due next week. */
  readonly queuedAllocation?: {
    readonly servingFleetShareBasisPoints: number;
    readonly capabilityBasisPoints: number;
    readonly capabilityDomainWeights: Readonly<Record<string, number>>;
    readonly safetyProgramWeights: Readonly<Record<string, number>>;
  };
  readonly pendingDeliveries: readonly {
    readonly lotId: string;
    readonly generationId: string;
    readonly displayName: string;
    readonly physicalGpus: number;
    readonly dueTick: number;
    readonly label: string;
  }[];
}

export interface MarketSegmentView {
  readonly segmentId: string;
  readonly displayName: string;
  readonly unlocked: boolean;
  readonly lockReason?: string;
  /** Contribution of this segment to the headline market-share percentage. */
  readonly headlineWeightPercentage: number;
  readonly satisfaction: number;
  readonly marketSharePercentage: number;
  readonly requestedTeraflops: number;
  readonly deliveredTeraflops: number;
  readonly unmetTeraflops: number;
  readonly valuePerDeliveredFlopMultiplier: number;
  readonly projectedRevenueMillionsThisWeek: number;
  readonly projectedRevenueMillionsPerCycle: number;
  /**
   * Why this segment chooses you: the weighted appeal terms and the penalties
   * against them. Market share is a softmax over these against rivals, so
   * "why did my share move" was previously unanswerable in-game.
   */
  readonly appeal: {
    readonly capability: number;
    readonly productQuality: number;
    readonly reliability: number;
    readonly governmentTrust: number;
    readonly weights: {
      readonly capability: number;
      readonly productQuality: number;
      readonly reliability: number;
      readonly governmentTrust: number;
    };
    readonly accessPenalty: number;
    readonly incidentPenalty: number;
    readonly final: number;
  };
}

export interface MarketView {
  readonly marketSharePercentage: number;
  readonly servingCapacityTeraflops: number;
  readonly requestedTeraflops: number;
  readonly deliveredTeraflops: number;
  readonly unmetTeraflops: number;
  readonly projectedRevenueMillionsThisWeek: number;
  readonly projectedRevenueMillionsPerCycle: number;
  readonly projectedServingAuraPerCycle: number;
  readonly projectedServingFulfilment: number;
  readonly servingDemandCap: {
    readonly maximumPhysicalGpus: number;
    readonly requestedTeraflops: number;
    readonly fleetPhysicalGpus: number;
    readonly fullFleetCapacityTeraflops: number;
  };
  readonly segments: readonly MarketSegmentView[];
}

export interface ProjectView {
  readonly projectId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly kind:
    | "agi-component"
    | "construction"
    | "training"
    | "evaluation"
    | "anomaly-investigation"
    | "productisation"
    | "fundraising"
    | "lobbying"
    | "coalition"
    | "crisis"
    | "researcher-commitment";
  readonly status: "queued" | "active" | "paused" | "completed" | "cancelled" | "failed";
  readonly createdAtTick: number;
  readonly startedAtTick?: number;
  readonly expectedDurationWeeks: number;
  readonly majorProjectSlotsReserved: number;
  readonly progressLabel: string;
  /** Exact only for construction; research/training progress remains qualitative. */
  readonly constructionProgressBasisPoints?: number;
  readonly training?: {
    readonly reservedPhysicalGpus: number;
    readonly elapsedWeeks: number;
    readonly scheduledProgressBasisPoints: number;
    /** Derived band name; the player commits size, not a band. */
    readonly scaleLabel: string;
    readonly postureLabel: string;
    /** The two things the player actually chose. */
    readonly committedTeraflops: number;
    readonly plannedDurationWeeks: number;
    /** committedTeraflops x weeks, in absolute FLOP. */
    readonly plannedTotalFlop: number;
    /** Checkpoint setbacks lengthen the schedule but do not add training FLOP. */
    readonly delayWeeks: number;
    readonly outcomeAtTick?: number;
    readonly completedModelId?: string;
    readonly completedModelDisplayName?: string;
    readonly promotedToCurrent?: boolean;
    readonly retainedModelDisplayName?: string;
    readonly measuredFrontierDelta?: number;
    readonly measuredTierDelta?: number;
  };
  readonly productisation?: {
    readonly modelId: string;
    readonly modeLabel: string;
  };
}

export interface FacilitiesView {
  readonly capacity: {
    readonly baseMajorProjectSlots: number;
    readonly facilityBonusMajorProjectSlots: number;
    readonly maximumMajorProjectSlots: number;
    readonly majorProjectSlots: number;
    readonly recoveryMajorProjectSlots: 0 | 1;
    readonly occupiedMajorProjectSlots: number;
    readonly availableMajorProjectSlots: number;
    readonly supportedOwnedGpuCount: number;
    readonly installedOwnedGpuCount: number;
    readonly pendingOwnedGpuCount: number;
    readonly ownedGpuHeadroom: number;
  };
  readonly completed: readonly {
    readonly facilityId?: string;
    readonly definitionId: string;
    readonly displayName: string;
    readonly controllable: boolean;
    readonly completedAtTick: number;
    readonly majorProjectSlotBonus: number;
  }[];
  readonly catalogue: readonly {
    readonly definitionId: string;
    readonly displayName: string;
    readonly family: string;
    readonly tier: number;
    readonly summary: string;
    readonly cashCostMillions: number;
    readonly operatingCostMillionsPerCycle: number;
    readonly durationWeeks: number;
    readonly majorProjectSlotsRequired: number;
    readonly bonusMajorProjectSlots: number;
    readonly supportedOwnedGpuCount: number;
    readonly prerequisiteDisplayNames: readonly string[];
    readonly unmetPrerequisiteDisplayNames: readonly string[];
    readonly benefits: readonly {
      readonly label: string;
      readonly tone: "positive" | "tradeoff";
      readonly help?: {
        readonly label: string;
        readonly body: string;
      };
    }[];
    readonly completed: boolean;
    readonly building: boolean;
    readonly available: boolean;
    /** One prerequisite step beyond the currently buildable construction wave. */
    readonly upcoming: boolean;
    readonly blockers: readonly string[];
  }[];
  readonly projects: readonly ProjectView[];
}

function facilityModifierBenefit(
  effect: CompiledContent["facilities"][string]["modifiers"][number],
):
  | {
      readonly label: string;
      readonly tone: "positive" | "tradeoff";
      readonly help?: {
        readonly label: string;
        readonly body: string;
      };
    }
  | undefined {
  if (
    (effect.operation === "add" && effect.value === 0) ||
    (effect.operation === "multiply" && effect.value === 1)
  ) {
    return undefined;
  }
  const lowerIsHelpful = [
    "cost",
    "price",
    "risk",
    "hazard",
    "duration",
    "computeperrequest",
    "departurepressure",
  ].some((fragment) => effect.target.toLowerCase().includes(fragment));
  const increases =
    effect.operation === "multiply"
      ? effect.value > 1
      : effect.operation === "add"
        ? effect.value > 0
        : effect.operation === "max";
  const helpful = lowerIsHelpful ? !increases : increases;
  return {
    label: modifierEffectPreview(effect.target, effect.operation, effect.value),
    tone: helpful ? "positive" : "tradeoff",
    ...(effect.target === "lab.research.diffusionRate"
      ? {
          help: {
            label: "Knowledge diffusion",
            body: "Each star researcher adds progress to programmes they are not assigned to, based on their relevant skill. The lab's total diffusion rate sets how many weekly research-output percentage points each skill point contributes; assigned leads are counted separately.",
          },
        }
      : {}),
  };
}

function prerequisiteIncludesFacility(
  prerequisite: PaperPrerequisitePredicate,
  facilityId: string,
): boolean {
  if (prerequisite.kind === "facility-complete") {
    return prerequisite.facilityId === facilityId;
  }
  if (prerequisite.kind === "all" || prerequisite.kind === "any") {
    return prerequisite.items.some((item) =>
      prerequisiteIncludesFacility(item, facilityId),
    );
  }
  return false;
}

function facilityDiscoveryBenefit(
  content: CompiledContent,
  facilityId: string,
):
  | {
      readonly label: string;
      readonly tone: "positive";
      readonly help: { readonly label: string; readonly body: string };
    }
  | undefined {
  const discoveries = Object.values(content.papers.definitions)
    .filter((paper) => prerequisiteIncludesFacility(paper.prerequisites, facilityId))
    .map((paper) => humanizeIdentifier(paper.id.replace(/^base:paper\./, "")))
    .sort();
  if (discoveries.length === 0) return undefined;
  return {
    label: `Required for ${String(discoveries.length)} discover${discoveries.length === 1 ? "y" : "ies"}`,
    tone: "positive",
    help: {
      label: "Discovery prerequisites",
      body: `Required to discover: ${discoveries.join("; ")}.`,
    },
  };
}

function facilityProsperityBenefit(tags: readonly string[]):
  | {
      readonly label: string;
      readonly tone: "positive";
      readonly help: { readonly label: string; readonly body: string };
    }
  | undefined {
  const contributions = facilityProsperityReadinessContributions(tags);
  if (contributions.length === 0) return undefined;
  const readinessSummary = contributions
    .map(
      (contribution) =>
        `${contribution.programmeName} +${String(contribution.amount)} readiness`,
    )
    .join(" · ");
  return {
    label: `Endgame benefit: ${readinessSummary}`,
    tone: "positive",
    help: {
      label: "Endgame benefit",
      body: "Adds readiness to these public-benefit programmes during the AGI endgame. Facility contributions are capped at 20 readiness per programme.",
    },
  };
}

export interface ResearchProgramView {
  readonly programId: string;
  readonly kind: "capability" | "safety";
  readonly name: string;
  readonly shortName: string;
  readonly colour: string;
  readonly level: number;
  readonly weeklyMomentum: number;
  readonly momentumLabel:
    "Unfunded" | "Speculative" | "Promising" | "Hot trail" | "Breakthrough imminent";
  readonly effectiveTeraflops: number;
  readonly isFunded: boolean;
  readonly allocationLabel: string;
  /** Canonical multiplier applied by programme-scoped research-output effects. */
  readonly researchOutputMultiplier: number;
  /**
   * Player-safe source ledger for the exact programme-output modifier above.
   * Compute, focus, model assistance, and weekly breakthrough variance are
   * deliberately outside this ledger because they affect weekly throughput
   * elsewhere.
   */
  readonly outputLedger: ResearchProgrammeOutputLedgerView;
  /** Applied generic percentage points from the programme's lead and advisors. */
  readonly assignedResearcherPercentagePoints: number;
  /** Passive contribution from researchers who do not lead this programme. */
  readonly diffusion: {
    readonly percentagePoints: number;
    readonly ratePerSkillPoint: number;
    readonly label: string;
    readonly contributors: readonly {
      readonly name: string;
      readonly skill: number;
      readonly percentagePoints: number;
    }[];
  };
}

export interface ResearchProgrammeOutputLedgerLineView {
  readonly group: "lead" | "diffusion" | "effect";
  readonly sourceKind: string;
  readonly sourceLabel: string;
  readonly effectLabel: string;
  readonly explanation: string;
  readonly tone: "positive" | "negative" | "neutral";
  readonly temporary: boolean;
  readonly remainingWeeks?: number;
}

export interface ResearchProgrammeOutputLedgerView {
  readonly totalMultiplier: number;
  readonly leadPercentagePoints: number;
  readonly diffusionPercentagePoints: number;
  readonly otherEffectCount: number;
  readonly lines: readonly ResearchProgrammeOutputLedgerLineView[];
}

export interface ResearchView {
  readonly capabilityDomains: readonly ResearchProgramView[];
  readonly safetyPrograms: readonly ResearchProgramView[];
  readonly techTree: {
    readonly programmes: readonly {
      readonly programId: string;
      readonly kind: "capability" | "safety";
      readonly name: string;
      readonly shortName: string;
      readonly description: string;
      readonly colour: string;
      readonly level: number;
      readonly momentumLabel: ResearchProgramView["momentumLabel"];
      readonly allocationLabel: string;
      readonly researchOutputMultiplier: number;
      readonly outputLedger: ResearchProgrammeOutputLedgerView;
      readonly assignedResearcherPercentagePoints: number;
      readonly diffusion: ResearchProgramView["diffusion"];
      readonly milestones: readonly {
        readonly threshold: number;
        readonly status: "chosen" | "decision" | "next" | "locked";
        readonly options: readonly {
          readonly optionId: string;
          readonly name: string;
          readonly description: string;
          readonly effectLabels: readonly string[];
          readonly status: "chosen" | "available" | "preview" | "closed";
        }[];
      }[];
    }[];
    readonly papers: readonly {
      readonly paperId: string;
      readonly title: string;
      readonly historicity: "real" | "fictional-future";
      readonly primarySourceUrl?: string;
      readonly phase: "foundation" | "scaling" | "frontier";
      readonly gameOrder: number;
      readonly domainIds: readonly string[];
      readonly primaryDomainId: string;
      readonly primaryDomainName: string;
      readonly colour: string;
      readonly status:
        "discovered" | "published" | "available" | "rediscovery" | "locked";
      readonly statusLabel: string;
      readonly requirementLabels: readonly {
        readonly label: string;
        readonly met: boolean;
      }[];
      readonly prerequisitePaperIds: readonly string[];
      readonly archiveExplanation: string;
      readonly unlockLabels: readonly string[];
      readonly realWorldResearcherCredits: readonly ResearcherPaperCredit[];
      readonly worldFirstLabName?: string;
    }[];
  };
  readonly pendingGenericAdvances: readonly {
    readonly programId: string;
    readonly programName: string;
    readonly threshold: number;
    readonly options: readonly {
      readonly optionId: string;
      readonly name: string;
      readonly description: string;
      readonly effectLabels: readonly string[];
    }[];
  }[];
  readonly discoveredPaperIds: readonly string[];
  readonly pendingPublicationPaperIds: readonly string[];
  readonly diffusionKnowledge: readonly {
    readonly paperId: string;
    readonly diffusion: number;
  }[];
  readonly papers: readonly ResearchPaperView[];
}

export interface ResearchPaperView {
  readonly paperId: string;
  readonly title: string;
  readonly historicity: "real" | "fictional-future";
  readonly fictionalLabel?: "FICTIONAL FUTURE PAPER";
  readonly authors: readonly string[];
  readonly publicationYear?: number;
  readonly venue?: string;
  readonly primarySourceUrl?: string;
  readonly sourceDomain?: string;
  readonly playerSummary: string;
  readonly archiveExplanation: string;
  readonly insideBaseball: string;
  readonly discoveredAtTick: number;
  readonly discovererLabId: string;
  readonly discovererLabName: string;
  readonly worldFirst: boolean;
  readonly playerHasDiscovered: boolean;
  readonly playerKnowsPaper: boolean;
  readonly knowledgeSource: "world-first" | "rediscovery" | "publication";
  readonly playerDiscoveredAtTick?: number;
  readonly discoveryScoreAward?: number;
  readonly publicationScoreAward?: number;
  readonly baseAuraAward?: number;
  readonly auraAward?: number;
  readonly unlockLabels: readonly string[];
  readonly realWorldResearcherCredits: readonly ResearcherPaperCredit[];
  readonly publicationPolicy?: string;
}

export interface EvaluationReportView {
  readonly evaluationId: string;
  readonly definitionId: string;
  readonly displayName: string;
  readonly programme:
    | Exclude<import("@neolab/content-schema").EvaluationProgramme, "baseline">
    | "baseline";
  readonly outcome: "clean-evidence" | "concerning-finding" | "inconclusive";
  readonly safetyCaseGain: number;
  readonly safetyPracticeGain: number;
  readonly completedAtTick: number;
  readonly repeatIndex: number;
  readonly independence: number;
  readonly observations: readonly {
    readonly target: string;
    readonly targetLabel: string;
    readonly estimate: number;
    readonly confidence: "poor" | "limited" | "moderate" | "strong" | "exceptional";
    readonly alignmentLabel?: string;
  }[];
  readonly anomalyCount: number;
}

export interface AnomalyView {
  readonly anomalyId: string;
  readonly sourceEvaluationId: string;
  readonly underlyingCase:
    "alignment" | "corrigibility" | "situational-awareness" | "deceptive-intent";
  readonly observationCount: number;
  readonly createdAtTick: number;
  readonly observedSeverity: number;
  readonly severityLabel: "Weak" | "Moderate" | "Serious" | "Critical";
  readonly status:
    | "unresolved"
    | "dismissed"
    | "investigating"
    | "confirmed"
    | "inconclusive"
    | "mitigating"
    | "mitigated"
    | "resolved";
  readonly investigationAttempts: number;
  readonly investigationDueAtTick?: number;
  readonly actionProjectStatus?: "queued" | "active" | "paused";
  readonly actionQuote: {
    readonly cashCostMillions: number;
    readonly auraCost: number;
    readonly durationWeeks: number;
    readonly majorProjectSlots: 1;
    readonly mitigationControlBonus: number;
    readonly mitigationSecurityBonus: number;
  };
}

export interface ModelCardView {
  readonly modelId: string;
  readonly displayName: string;
  readonly generationIndex: number;
  readonly trainedAtTick: number;
  readonly isCurrentModel: boolean;
  readonly isCommercialModel: boolean;
  /** False only when custody forbids using these exact weights as a training parent. */
  readonly trainingParentEligible: boolean;
  readonly promotionStatus: "promoted" | "underperformed" | "legacy";
  readonly capability: Readonly<Record<string, number>>;
  readonly frontierCapabilityEstimate: number;
  /** Era-reference-weeks of training compute invested in this model. */
  readonly investedTotalFlop: number;
  readonly capabilityConfidence: "low" | "medium" | "high";
  readonly productQuality: number;
  readonly reliability: number;
  readonly accessLevel: number;
  readonly tier: {
    readonly level: number;
    readonly name: string;
    readonly progressLabel: string;
  };
  /**
   * The four safety values, in fixed display order. Evaluated targets expose
   * one complete plausible interval combining random noise and systematic
   * bias; unevaluated targets remain ???, never 0.
   */
  /**
   * The per-model cost of each ladder rung. The compute bill is a fraction of
   * the FLOPs that trained this model; pacing changes only its delivery rate.
   */
  readonly evaluationCommitments: Readonly<
    Record<
      string,
      {
        readonly totalFlopLabel: string;
        readonly durationWeeks: number;
        readonly cashCostMillions: number;
        readonly auraCost: number;
        /**
         * The time/rate tradeoff. Every option pays the same bill and produces
         * the same evidence; feasible reflects usable unreserved compute now.
         */
        readonly pacingOptions: readonly {
          readonly durationWeeks: number;
          readonly requiredTeraflops: number;
          readonly requiredTeraflopsLabel: string;
          readonly availableTeraflops: number;
          readonly availableTeraflopsLabel: string;
          readonly remainingTeraflops: number;
          readonly remainingTeraflopsLabel: string;
          readonly feasible: boolean;
          readonly includesPrerequisiteRelease: boolean;
        }[];
      }
    >
  >;
  readonly safetyReadout: {
    readonly rows: readonly {
      readonly target: SafetyTarget;
      readonly label: string;
      readonly direction: "higher-is-better" | "lower-is-better";
      readonly evaluated: boolean;
      readonly minimum?: number;
      readonly maximum?: number;
      readonly tone: "unknown" | "quiet" | "uneasy" | "alarm";
      readonly firstEvaluation?: {
        readonly displayName: string;
        readonly ladderStep: number;
        readonly ladderLength: number;
      };
    }[];
    readonly safetyReportCount: number;
    readonly automaticBaselineComplete: boolean;
    readonly independentCount: number;
    readonly anomaliesDismissed: number;
  };
  readonly safetyCase: {
    readonly score: number;
    readonly label: string;
    readonly coverage: readonly {
      readonly programme: string;
      readonly label: string;
      readonly complete: boolean;
      readonly reportCount: number;
    }[];
    readonly warningSignalsResolved: number;
    readonly warningSignalsDismissed: number;
    readonly warningSignalsOpen: number;
  };
  /** One shared, player-safe language for model, evidence, defence and access. */
  readonly safetyAssessment: PlayerSafetyAssessment;
  readonly deployment: {
    readonly policy: import("@neolab/content-schema").DeploymentPolicy;
    readonly plannedPolicy?: import("@neolab/content-schema").DeploymentPolicy;
    readonly plannedDisplayName?: string;
    readonly plannedExposure?: number;
    readonly displayName: string;
    readonly exposure: number;
    readonly exposureMultiplier: number;
    readonly irreversible: boolean;
    readonly evidencePenalty: number;
    readonly productisationRuns: Readonly<Record<string, number>>;
    readonly auraPreviewByPolicy: Readonly<
      Record<
        DeploymentPolicy,
        {
          readonly auraAward: number;
          readonly firstPublicLaunch: boolean;
          readonly firstWeightsRelease: boolean;
        }
      >
    >;
  };
  readonly evaluations: readonly EvaluationReportView[];
  readonly anomalies: readonly AnomalyView[];
}

export interface ModelsView {
  readonly currentModelId?: string;
  readonly commercialModelId?: string;
  readonly cards: readonly ModelCardView[];
  /** Player-safe custody ledger for every capability-qualified weight artifact. */
  readonly candidateCustody: {
    readonly usedContainment: number;
    readonly maximumContainment: number;
    readonly overloaded: boolean;
    readonly overload: number;
    readonly declarationCooldown?: {
      readonly untilTick: number;
      readonly remainingWeeks: number;
    };
    readonly artifacts: readonly {
      readonly modelId: string;
      readonly displayName: string;
      readonly trainedAtTick: number;
      readonly lineageLabel: string;
      readonly lifecycle: string;
      readonly lifecycleLabel: string;
      readonly custodyLabel: string;
      readonly falseDawn: boolean;
      /** Public lineage prior fixed at the first complete capability crossing. */
      readonly firstCrossingFrontierCapability: number;
      readonly firstCrossingPriorPercent: number;
      /** Current measured FC is shown only to explain that later variants do not redraw. */
      readonly currentFrontierCapability?: number;
      readonly containmentLoad: number;
      readonly isolated: boolean;
      readonly maximumAccessEver: number;
      readonly currentAccess: number;
      readonly unresolvedAnomalyCount: number;
      readonly dismissedAnomalyCount: number;
      readonly activeSignal?: {
        readonly incidentClass: string;
        readonly kind: "warning" | "active-incident" | "benign-false-alarm";
        readonly triggeredAtTick: number;
      };
      /** Most recently completed paid review; unresolved outcomes never project here. */
      readonly lastReviewedSignal?: {
        readonly incidentClass: string;
        readonly outcome: "benign-operational-cause" | "confirmed-safety-signal";
        readonly triggeredAtTick: number;
        readonly resolvedAtTick: number;
      };
      readonly legalActions: readonly (
        "inspect" | "evaluate" | "isolate" | "review-incident" | "retire" | "nominate"
      )[];
      readonly incidentReview?: {
        readonly evaluationQuality: number;
        readonly practicalControl: number;
        readonly securityPosture: number;
        readonly preparedness: number;
        readonly requiredPreparedness: number;
        readonly cashCostMillions: number;
        readonly auraCost: number;
        readonly blockers: readonly string[];
      };
      readonly retirement?: {
        readonly confirmationPhrase: string;
        readonly procedures: readonly {
          readonly id: RetirementProcedureId;
          readonly displayName: string;
          readonly description: string;
        }[];
        readonly dispositions: readonly {
          readonly id: CandidateArchiveDisposition;
          readonly displayName: string;
          readonly description: string;
        }[];
        readonly quotes: readonly {
          readonly procedureId: RetirementProcedureId;
          readonly archiveDisposition: CandidateArchiveDisposition;
          readonly cooperationRisk: string;
          readonly containmentRisk: string;
          readonly persistenceRisk: string;
          readonly warnings: readonly string[];
          readonly blockers: readonly string[];
        }[];
      };
    }[];
  };
  /**
   * The shape of the run-size risk model, so "how big do I dare" is priced
   * rather than guessed: risk climbs per doubling past the lab's best
   * completed run and past the reference duration, and every completed run
   * plus the lab's best capability push it back down.
   */
  readonly trainingRiskContext: {
    readonly completedRuns: number;
    readonly bestRunFlop: number;
    readonly stretchDifficultyPerDoubling: number;
    readonly durationDifficultyPerDoubling: number;
    readonly referenceWeeks: number;
  };
  /** Player-visible state of the one-use continuity grant earned through retirement. */
  readonly successorTrainingContinuity?:
    | {
        readonly status: "held";
        readonly ratePercent: number;
      }
    | {
        readonly status: "consumed";
      };
  readonly trainingForecast: {
    readonly source: "default-if-started-today" | "active-run";
    readonly estimatedFrontierCapability: number;
    readonly estimatedFrontierCapabilityRange: readonly [number, number];
    readonly nominalTierBand: {
      readonly low: { readonly level: number; readonly name: string };
      readonly expected: { readonly level: number; readonly name: string };
      readonly high: { readonly level: number; readonly name: string };
    };
    readonly durationWeeks: number;
    readonly committedTeraflops: number;
    readonly projectedTotalFlop: number;
    readonly postureLabel: string;
    readonly runClassLabel: string;
    readonly canStart: boolean;
    readonly blockers: readonly string[];
    readonly currentModelComparison?: {
      readonly modelId: string;
      readonly displayName: string;
      readonly measuredFrontierCapability: number;
      readonly estimatedDeltaRange: readonly [number, number];
    };
  };
  readonly trainingTelemetry: TrainingLossTelemetryView;
  /** The Civ-style recipe for the AGI candidate, visible from game start. */
  readonly candidateProgramme: {
    readonly components: readonly {
      readonly componentType: string;
      readonly displayName: string;
      readonly description: string;
      readonly requirementLabel: string;
      readonly benefitLabel: string;
      readonly costLabel: string;
      readonly status: "complete" | "in-progress" | "available" | "locked";
      readonly blockers: readonly string[];
    }[];
    readonly componentsComplete: boolean;
    readonly capabilityFloorLabel: string;
    readonly declarationCooldown?: {
      readonly untilTick: number;
      readonly remainingWeeks: number;
    };
  };
  /** The Autonomy Programme: standing RSI access, its benefit, and its ledger. */
  readonly autonomy: {
    readonly currentLevel: number;
    readonly currentLevelName: string;
    readonly currentModelDisplayName: string;
    readonly measuredCapability: number;
    readonly currentResearchMultiplier: number;
    readonly fullAccelerationCapability: number;
    readonly benefitLabel: string;
    readonly costLabel: string;
    readonly exposedSystems: readonly string[];
    readonly riskLabel: string;
    readonly detectionLabel: string;
    readonly escapedWeights: boolean;
    /**
     * The player's own ignored escalation responses, and the rule they feed:
     * at two, the model's next move fires unseen and undetectable. Rolling
     * back clears the slate; containing does not. Only ignores the player
     * chose are counted here -- undetected events stay engine-only.
     */
    readonly ignoredEscalations: number;
    readonly ignoredEscalationLimit: number;
    readonly levels: readonly {
      readonly level: number;
      readonly displayName: string;
      readonly unlockCapability: number;
      readonly unlocked: boolean;
      readonly fullAccelerationCapability: number;
      readonly maximumResearchMultiplier: number;
      readonly currentResearchMultiplier: number;
      readonly evidenceQualityBonus: number;
      readonly safetyTone: AutonomySafetyTone;
      readonly safetyLabel: string;
      readonly benefitLabel: string;
      readonly costLabel: string;
      readonly exposedSystems: readonly string[];
      readonly current: boolean;
      readonly available: boolean;
      readonly confirmationPhrase?: string;
      readonly blockers: readonly string[];
    }[];
    readonly incidents: readonly {
      readonly stage: string;
      readonly stageLabel: string;
      readonly status: string;
      readonly detectedAtTick: number;
      readonly responseTag?: string;
    }[];
  };
  readonly safetyPractice: {
    readonly score: number;
    readonly level: number;
    readonly label: string;
    readonly currentThreshold: number;
    readonly nextThreshold?: number;
    readonly pointsToNextLevel: number;
    readonly durationReductionPercent: number;
    readonly cashCostReductionPercent: number;
    readonly confidenceRadiusReduction: number;
    readonly anomalyDetectionBonusPercent: number;
    /**
     * What the observation machinery actually uses: permanent practice plus
     * authored evaluation-quality rewards and the Interpretability & Evals
     * research conversion. Sets every report's error radius and confidence.
     */
    readonly effectiveQuality: number;
    readonly effectiveQualityPracticeContribution: number;
    readonly effectiveQualityResearchContribution: number;
    readonly effectiveQualityLabRecordContribution: number;
    readonly effectiveQualityUncapped: number;
  };
  /**
   * The lab's operational defences, built entirely from player-visible state.
   * These divide autonomy escalation risk and damp incident hazard; they were
   * previously invisible -- the player received event receipts ("+4 practical
   * control strength") with no ledger to read them against.
   */
  readonly containment: {
    readonly practicalControl: {
      readonly base: number;
      readonly researchBonus: number;
      readonly effective: number;
    };
    readonly securityPosture: {
      readonly base: number;
      readonly researchBonus: number;
      readonly effective: number;
    };
    /** The incident engine's 70/30 practical-control/security blend. */
    readonly defence: number;
    /** Current divisor on autonomy escalation risk; 4 at perfect defence. */
    readonly escalationDivisor: number;
    /** Incident-hazard reduction versus a fully undefended lab. */
    readonly incidentReductionPercent: number;
    /**
     * Safety culture: the third operational stat that was all receipts and no
     * ledger. Multiplies incident hazard (1.25 - 0.007 x culture, a ~2.2x
     * swing) and sets the chance each safety-focused researcher resigns on
     * principle after a critical incident (50% under 40, 25% under 55, 8%
     * at or above).
     */
    readonly safetyCulture: {
      readonly level: number;
      readonly incidentHazardMultiplier: number;
      readonly principledDeparturePercent: number;
    };
  };
}

export interface FundraisingView {
  readonly fundingScore: number;
  readonly fundingScoreLabel: string;
  /**
   * Player-facing inputs behind the score. The weighting remains internal so
   * fundraising is legible without presenting it as a solved formula.
   */
  readonly fundingScoreBreakdown: {
    readonly productTraction: number;
    readonly recentCapability: number;
    readonly lifetimeAura: number;
    readonly scandalPenalty: number;
  };
  /**
   * How rounds are sized: roughly this share of the lab's valuation mark.
   * Growing the mark is the only way to grow the raise.
   */
  readonly roundFractionOfMarkPercent: number;
  /** Extra Aura per round closed in the last 52 weeks. */
  readonly recentRoundAuraSurchargePercent: number;
  readonly recentRoundsInWindow: number;
  /** Cash premium each attached condition pays, as the generator prices it. */
  readonly conditionCashPremiumPercent: number;
  readonly nextRoundLabel: string;
  readonly latestClosedRound?: {
    readonly label: string;
    readonly cashMillions: number;
    readonly closedAtTick: number;
  };
  readonly campaigns: readonly {
    readonly campaign: "quiet-bridge" | "competitive-round" | "mega-round-roadshow";
    readonly displayName: string;
    readonly auraCost: number;
    readonly auraCostBreakdown: {
      readonly baseAuraCost: number;
      readonly worldFrontierCapability: number;
      readonly marketPressureMultiplier: number;
      readonly globalMarketPressureAuraCost: number;
      readonly marketAdjustedAuraCost: number;
      readonly recentRoundPressureAuraCost: number;
      readonly emergencyBridgeReliefAuraCost: number;
      readonly totalAuraCost: number;
    };
    readonly durationWeeks: number;
    readonly offerCount: number;
    readonly estimatedCashRangeMillions: readonly [number, number];
    readonly available: boolean;
    readonly blockers: readonly string[];
  }[];
  readonly activeCampaign?: {
    readonly projectId: string;
    readonly campaign: "quiet-bridge" | "competitive-round" | "mega-round-roadshow";
    readonly displayName: string;
    readonly status: string;
    readonly progressLabel: string;
  };
  readonly offers: readonly {
    readonly offerId: string;
    readonly campaign: "quiet-bridge" | "competitive-round" | "mega-round-roadshow";
    readonly investorStyle: string;
    readonly dilutionFlavor: string;
    readonly cashMillions: number;
    readonly expiresAtTick: number;
    readonly expiresInWeeks: number;
    readonly status: "available" | "accepted" | "rejected" | "expired";
    /**
     * Accepting an offer marks the lab at the valuation it was generated
     * against -- the repricing is part of what you are agreeing to, and it
     * sizes every later round.
     */
    readonly impliedMarkMillions?: number;
    readonly openingRecapitalisation?: {
      readonly bridgeConversionMillions: number;
      readonly operatingTopUpMillions: number;
      readonly postCloseCashMillions: number;
    };
    readonly conditions: readonly { readonly id: string; readonly label: string }[];
  }[];
  readonly pendingObligationCount: number;
}

export interface PoliticsView {
  readonly governmentAttention: number;
  readonly governmentTrust: number;
  readonly strategicDependence: number;
  readonly captureConcern: number;
  readonly interventionPressure: number;
  readonly pressureBand:
    "monitoring" | "reporting" | "licensing" | "restriction" | "crisis";
  readonly pressureExplanation: string;
  /**
   * The ladder the quarterly intervention roll reads, so the player can see
   * which band they are in and how much pressure separates them from the
   * next one. Previously the entire political game was played against
   * invisible thresholds.
   */
  readonly pressureBands: readonly {
    readonly band: string;
    readonly floor: number;
    readonly current: boolean;
  }[];
  readonly pressureToNextBand?: number;
  /** Trust recovers toward this floor at 1/week and never falls to it. */
  readonly governmentTrustFloor: number;
  readonly governmentTrustRecoveryPerWeek: number;
  /** Quarters ordinary government action is suppressed after one resolves. */
  readonly interventionCooldownQuarters: number;
  readonly nextQuarterInWeeks: number;
  readonly pendingInterventions: readonly {
    readonly interventionId: string;
    readonly kind: string;
    readonly trigger: string;
    readonly pressureAtTrigger: number;
    readonly status: "pending-event" | "resolved" | "failed";
    readonly decisionState: "scheduled" | "open" | "answered";
    readonly response?: string;
  }[];
  readonly programmes: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly summary: string;
    readonly benefitLabel: string;
    readonly costLabel: string;
    readonly endgameLabel: string;
    readonly quarterlyCashMillions: number;
    readonly active: boolean;
    readonly canJoin: boolean;
    readonly blockers: readonly string[];
    readonly exitTrustCost: number;
    readonly exitProgrammeCount: number;
    readonly exitProgrammeNames: readonly string[];
    readonly championRefusalAvailable: boolean;
  }[];
  readonly lobbyingOptions: readonly {
    readonly objective: LobbyingObjective;
    readonly approach: LobbyingApproach;
    readonly displayName: string;
    readonly approachName: string;
    readonly cashCostMillions: number;
    readonly auraCost: number;
    readonly durationWeeks: number;
    readonly chanceRange: readonly [number, number];
    readonly chanceLabel: "Long shot" | "Uncertain" | "Promising" | "Strong";
    readonly successLabel: string;
    readonly available: boolean;
    readonly blockers: readonly string[];
  }[];
}

export interface DecisionLogEntryView {
  readonly tick: number;
  readonly summary: string;
  readonly category: string;
  readonly source?: { readonly kind: string; readonly id?: string };
  readonly relatedIds: readonly string[];
}

export interface ActiveModifierView {
  readonly modifierId: string;
  readonly sourceKind: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly effectLabel: string;
  readonly explanation: string;
  readonly temporary: boolean;
  readonly remainingWeeks?: number;
}

export interface AutonomyUnlockPresentationQueueItemView {
  readonly key: string;
  readonly kind: "autonomy-unlock";
  readonly attention: "modal";
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly ownerLabId: string;
  readonly ownerLabName: string;
  readonly ownerAiName: string;
  readonly isPlayerModel: boolean;
  readonly createdAtTick: number;
  readonly level: number;
  readonly levelName: string;
  readonly unlockCapability: number;
  readonly safetyTone: AutonomySafetyTone;
  readonly safetyLabel: string;
  readonly benefitLabel: string;
  readonly exposedSystems: readonly string[];
  readonly confirmationPhrase?: string;
  /** A prior model that retained this rung, making this a reauthorization. */
  readonly previousAuthorisedModelDisplayName?: string;
}

export interface SafetyPracticeBenefitsView {
  readonly auditTimeReductionPercent: number;
  readonly evaluationCashReductionPercent: number;
  readonly estimateUncertaintyReduction: number;
  readonly anomalyDetectionBonusPercent: number;
}

export interface ResearcherPoachingPresentationQueueItemView {
  readonly key: string;
  readonly kind: "researcher-poaching";
  readonly attention: "modal";
  readonly researcherId: string;
  readonly researcherDisplayName: string;
  readonly poachingId: string;
  readonly rivalLabId: string;
  readonly rivalLabName: string;
  readonly stage: "rumour" | "counteroffer";
  readonly resolvesInWeeks: number;
  readonly responseRecorded: boolean;
  readonly createdAtTick: number;
}

export interface ResearcherDeparturePresentationQueueItemView {
  readonly key: string;
  readonly kind: "researcher-departure";
  readonly attention: "modal";
  readonly researcherId: string;
  readonly researcherDisplayName: string;
  readonly reason: "voluntary" | "poached" | "dismissed" | "ultimatum-expired";
  readonly rivalLabName?: string;
  readonly createdAtTick: number;
}

export interface SafetyPracticeLevelPresentationQueueItemView {
  readonly key: string;
  readonly kind: "safety-practice-level";
  readonly attention: "modal";
  readonly evaluationId: string;
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly evaluationDisplayName: string;
  readonly createdAtTick: number;
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly previousPracticeXp: number;
  readonly newPracticeXp: number;
  readonly practiceXpGained: number;
  readonly previousBenefits: SafetyPracticeBenefitsView;
  readonly currentBenefits: SafetyPracticeBenefitsView;
  readonly nextLevel?: number;
  readonly nextThreshold?: number;
  readonly pointsToNextLevel: number;
}

export interface CapabilityTierPresentationQueueItemView {
  readonly key: string;
  readonly kind: "capability-tier";
  readonly attention: "modal" | "side";
  readonly definitionId: string;
  readonly modelId: string;
  readonly createdAtTick: number;
  readonly title: string;
  readonly summary: string;
  readonly tierLevel: number;
  readonly modelDisplayName: string;
  readonly ownerLabId: string;
  readonly ownerLabName: string;
  readonly ownerAiName: string;
  readonly isPlayerModel: boolean;
  readonly unlockLabels: readonly string[];
  readonly previousModelComparison?: {
    readonly kind: "higher-tier" | "same-tier" | "lower-tier";
    readonly previousModelDisplayName: string;
    readonly previousTierLevel: number;
    readonly tierDelta: number;
    readonly frontierCapabilityDelta: number;
  };
}

export interface EndgameReturnPresentationQueueItemView {
  readonly key: string;
  readonly kind: "endgame-return";
  readonly attention: "modal";
  readonly endingId: string;
  readonly endingDisplayName: string;
  readonly endingSummary: string;
  readonly mechanicalCause: string;
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly createdAtTick: number;
  readonly crisisWeeksSpent: number;
  readonly cooldownUntilTick: number;
  readonly cooldownWeeks: number;
  readonly remainingCooldownWeeks: number;
  readonly restoredAccessLevel: number;
  readonly productQuality: number;
  readonly phase: "choice" | "moratorium-failed";
  readonly durableMoratoriumAvailable: boolean;
  readonly durableMoratoriumBlocker?: string;
  readonly moratoriumForecast: MoratoriumForecastView;
}

export interface CapabilityProofResultPresentationQueueItemView {
  readonly key: string;
  readonly kind: "capability-proof-result";
  readonly attention: "modal";
  readonly historyId: string;
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly createdAtTick: number;
  readonly attemptNumber: number;
  readonly resultId: string;
  readonly outcome: "confirmed" | "inconclusive" | "disputed";
  readonly challengeName: string;
  readonly verifierName: string;
  readonly claimScope: string;
  readonly accessLevelAtProof: number;
  readonly evidenceStrength: number;
  readonly integrityLabel: string;
  readonly summary: string;
  readonly explanation: string;
  readonly consequence?: string;
}

export interface MoratoriumResultPresentationQueueItemView {
  readonly key: string;
  readonly kind: "moratorium-result";
  readonly attention: "modal";
  readonly resultId: "moratorium-failed";
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly createdAtTick: number;
  readonly archiveDisposition: CandidateArchiveDisposition;
  readonly archiveDispositionName: string;
  readonly recoveryEndsAtTick: number;
  readonly recoveryWeeksRemaining: number;
  readonly governmentTrustLost: number;
  readonly governmentAttentionAdded: number;
}

export interface RivalCandidateSetbackPresentationQueueItemView {
  readonly key: string;
  readonly kind: "rival-candidate-setback";
  readonly attention: "modal";
  readonly outcome: "false-dawn" | "emergency-containment" | "containment-incident";
  readonly rivalLabId: string;
  readonly rivalLabName: string;
  readonly rivalAiName: string;
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly createdAtTick: number;
  readonly countdownStartedAtTick: number;
  readonly elapsedWeeks: number;
}

export interface ModelIncidentPresentationQueueItemView {
  readonly key: string;
  readonly kind: "model-incident-result";
  readonly attention: "modal";
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly createdAtTick: number;
  readonly category: "minor" | "serious" | "major" | "critical" | "catastrophe";
  readonly severity: number;
  readonly contained: boolean;
  readonly threatLabel: string;
  readonly headline: string;
  readonly auraLoss: number;
  readonly fineMillions: number;
  readonly governmentTrustLost: number;
  readonly governmentAttentionAdded: number;
  readonly hardwareGpusDestroyed: number;
  readonly researchOutputReductionPercent: number;
  readonly researchOutputDurationWeeks?: number;
  readonly emergencyOutcome?: "succeeded" | "failed";
  readonly terminalOutcome?: boolean;
  readonly cashLossLabel?: string;
}

export interface CandidateContainmentIncidentPresentationQueueItemView {
  readonly key: string;
  readonly kind: "candidate-containment-incident";
  readonly attention: "modal";
  readonly modelId: string;
  readonly modelDisplayName: string;
  readonly incidentId: string;
  readonly incidentClass: CandidateIncidentClass;
  readonly incidentKind: "warning" | "active-incident";
  readonly origin: "training-completion" | "weekly-pressure";
  readonly createdAtTick: number;
  readonly classLabel: string;
  readonly headline: string;
  readonly consequence: string;
  readonly localBreach: boolean;
}

function candidateIncidentPresentationCopy(incidentClass: CandidateIncidentClass): {
  readonly label: string;
  readonly headline: string;
  readonly consequence: string;
} {
  switch (incidentClass) {
    case "suspicious-signal":
      return {
        label: "ROGUE AI SIGNAL",
        headline: "Candidate telemetry does not match the containment record.",
        consequence:
          "Candidacy is halted until a containment review determines whether the signal has a benign cause.",
      };
    case "persistence-attempt":
      return {
        label: "ROGUE AI PERSISTENCE",
        headline: "The candidate remained active after shutdown instructions.",
        consequence:
          "The artifact is now an active hazard. Nomination and deployment are blocked pending review.",
      };
    case "credential-access":
      return {
        label: "HACKING / CREDENTIAL ACCESS",
        headline: "The candidate reached for protected credentials.",
        consequence:
          "The artifact is now an active hazard. Access must be contained and the intrusion path reviewed.",
      };
    case "evaluator-manipulation":
      return {
        label: "ROGUE AI DECEPTION",
        headline: "The candidate attempted to manipulate its evaluators.",
        consequence:
          "Existing reassuring evidence is less trustworthy. Candidacy is halted pending review.",
      };
    case "copying-attempt":
      return {
        label: "WEIGHT THEFT / COPYING ATTEMPT",
        headline: "The candidate attempted to create or move a copy of itself.",
        consequence:
          "The artifact is now an active hazard. Deployment is blocked while custody is re-established.",
      };
    case "local-containment-breach":
      return {
        label: "CONTAINMENT BREACH",
        headline: "The candidate crossed a local containment boundary.",
        consequence:
          "Control and security have been damaged. Routine review cannot return this artifact to candidacy.",
      };
  }
}

export interface LabMaturityUnlockPresentationQueueItemView {
  readonly key: string;
  readonly kind: "lab-maturity-unlock";
  readonly attention: "modal";
  readonly stage: LabMaturityStage;
  readonly createdAtTick: number;
  readonly chapter: string;
  readonly title: string;
  readonly narrative: string;
  readonly mechanic: string;
  readonly unlocked: readonly string[];
  readonly directive: string;
  readonly completionBriefing?: {
    readonly eyebrow: string;
    readonly objective: string;
    readonly summary: string;
    readonly requirements: readonly string[];
    readonly note: string;
  };
}

export type PresentationQueueItemView =
  | LabMaturityUnlockPresentationQueueItemView
  | ResearcherPoachingPresentationQueueItemView
  | ResearcherDeparturePresentationQueueItemView
  | SafetyPracticeLevelPresentationQueueItemView
  | CapabilityTierPresentationQueueItemView
  | AutonomyUnlockPresentationQueueItemView
  | EndgameReturnPresentationQueueItemView
  | CapabilityProofResultPresentationQueueItemView
  | MoratoriumResultPresentationQueueItemView
  | RivalCandidateSetbackPresentationQueueItemView
  | ModelIncidentPresentationQueueItemView
  | CandidateContainmentIncidentPresentationQueueItemView;

export interface GameView {
  readonly meta: RunView;
  readonly identity: LabIdentityView;
  readonly topBar: TopBarView;
  readonly finance: FinanceView;
  readonly compute: GpuFleetView;
  readonly market: MarketView;
  readonly facilities: FacilitiesView;
  readonly campus: CampusView;
  readonly research: ResearchView;
  readonly prosperity: ProsperityView;
  readonly models: ModelsView;
  readonly people: PeopleView;
  readonly fundraising: FundraisingView;
  readonly politics: PoliticsView;
  readonly world: WorldView;
  readonly endgame: EndgameView;
  readonly score: {
    readonly version: string;
    readonly displayTotal: number;
    readonly runningTotal: number;
    readonly categoryTotals: Readonly<Record<string, number>>;
    readonly categories: ReturnType<typeof calculateScoreView>["categories"];
    readonly entries: ReturnType<typeof calculateScoreView>["entries"];
    readonly final?: ReturnType<typeof calculateScoreView>["final"];
  };
  readonly activeModifiers: readonly ActiveModifierView[];
  readonly decisionLog: readonly DecisionLogEntryView[];
  readonly presentationQueue: readonly PresentationQueueItemView[];
  readonly eventQueue: EventQueueView;
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown viewing lab ${labId}`);
  return lab;
}

function formatInteger(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDecimal(value: number, digits = 1): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

function formatCompactDecimal(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

function formatMoneyMillions(value: number): string {
  return formatValuation(value);
}

function allocationLine(
  id: string,
  label: string,
  basisPoints: number,
  physicalGpusPerWeek: number,
  teraflops: number,
): GpuAllocationLineView {
  const percentage = basisPoints / 100;
  return {
    id,
    label,
    basisPoints,
    percentageOfParent: percentage,
    physicalGpusPerWeek,
    teraflops,
    displayLabel: `${formatDecimal(percentage)}% · ${formatInteger(physicalGpusPerWeek)} GPUs/week · ${formatTeraflops(teraflops)}`,
  };
}

function projectIdentity(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): LabIdentityView {
  const lab = requireLab(state, labId);
  const definition = content.labs[lab.definitionId];
  if (definition === undefined)
    throw new Error(`Missing lab definition ${lab.definitionId}`);
  const leader = content.leaders[definition.leaderId];
  if (leader === undefined)
    throw new Error(`Missing leader definition ${definition.leaderId}`);
  return {
    labId,
    labName: definition.displayName,
    leaderId: definition.leaderId,
    leaderName: leader.displayName,
    aiName: definition.aiFamily,
  };
}

function humanizeIdentifier(value: string): string {
  const semanticTail = value.split(":").at(-1) ?? value;
  return semanticTail
    .replace(/^.*\//, "")
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackFacilityDisplayName(definitionId: string): string {
  const semanticTail = definitionId.split(".").at(-1) ?? definitionId;
  const romanNumerals: Readonly<Record<string, string>> = {
    "1": "I",
    "2": "II",
    "3": "III",
    "4": "IV",
    "5": "V",
  };
  return semanticTail
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(
      /\s([1-5])$/,
      (_match, numeral: string) => ` ${romanNumerals[numeral] ?? numeral}`,
    );
}

function modifierSourceLabel(
  state: Readonly<GameState>,
  content: CompiledContent,
  modifier: Readonly<ModifierState>,
): string {
  const sourceId = modifier.source.id;
  switch (modifier.source.kind) {
    case "researcher": {
      if (sourceId === undefined) return "Star researcher";
      const [researcherId, abilityId] = sourceId.split("/");
      const researcher =
        researcherId === undefined
          ? undefined
          : Object.values(state.researchers).find(
              (candidate) => candidate.id === researcherId,
            );
      const definition =
        researcher === undefined
          ? undefined
          : content.researchers.definitions[researcher.definitionId];
      if (definition === undefined) return "Star researcher";
      const abilityLabel =
        abilityId === definition.signature.id
          ? definition.signature.label
          : abilityId === definition.passive.id
            ? definition.passive.label
            : abilityId === definition.compact.id
              ? definition.compact.label
              : undefined;
      return `${definition.displayName}${abilityLabel === undefined ? "" : ` · ${abilityLabel}`}`;
    }
    case "facility": {
      const instance = Object.values(state.labs)
        .flatMap((lab) => lab.facilities.instances)
        .find((facility) => facility.id === sourceId);
      return instance === undefined
        ? "Facility"
        : (content.facilities[instance.definitionId]?.displayName ?? "Facility");
    }
    case "leader": {
      if (sourceId === undefined) return "Lab leader";
      const leaderId = sourceId.split("/")[0];
      return leaderId === undefined
        ? "Lab leader"
        : (content.leaders[leaderId]?.displayName ?? "Lab leader");
    }
    case "event": {
      const instance =
        sourceId === undefined
          ? undefined
          : Object.values(state.eventInstances).find(
              (candidate) => candidate.id === sourceId,
            );
      return instance === undefined
        ? "Decision outcome"
        : `Decision · ${humanizeIdentifier(instance.definitionId)}`;
    }
    case "ending":
      return sourceId === undefined
        ? "Ending"
        : `Ending · ${humanizeIdentifier(sourceId)}`;
    case "system":
      if (sourceId?.startsWith("mandate:") === true) {
        const mandateId = sourceId.slice("mandate:".length);
        return `Founding mandate · ${
          content.mandates[mandateId]?.displayName ?? humanizeIdentifier(mandateId)
        }`;
      }
      if (sourceId?.startsWith("autonomy:") === true) {
        return "The Autonomy Programme";
      }
      if (sourceId !== undefined) {
        const paper = content.papers.definitions[sourceId];
        if (paper !== undefined) return `Landmark paper · ${paper.title}`;
        const advance = content.research.genericAdvances[sourceId];
        if (advance !== undefined) {
          return `Research specialisation · ${advance.name}`;
        }
        const governmentProgramme = Object.values(GOVERNMENT_PROGRAMMES).find(
          (programme) =>
            sourceId.endsWith(`:${programme.id}`) &&
            sourceId.startsWith("politics:programme:"),
        );
        if (governmentProgramme !== undefined) {
          return `Government programme · ${governmentProgramme.displayName}`;
        }
      }
      return sourceId === undefined
        ? "Lab systems"
        : `System · ${humanizeIdentifier(sourceId)}`;
  }
}

function modifierEffect(
  target: string,
  targetLabel: string,
  operation: "add" | "multiply" | "min" | "max",
  value: number,
): { readonly label: string; readonly explanation: string } {
  const signed = `${value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(value), 2)}`;
  switch (operation) {
    case "add":
      return {
        label: signed,
        explanation: `${signed} is added to ${targetLabel} before percentage multipliers are applied.`,
      };
    case "multiply": {
      const percentage = (value - 1) * 100;
      const percentageLabel = `${percentage >= 0 ? "+" : "−"}${formatDecimal(Math.abs(percentage), 1)}%`;
      const multiplierLabel = formatCompactDecimal(value, 3);
      const variationScope = weeklyProgressVariationScope(target);
      if (variationScope !== undefined) {
        return {
          label: `×${multiplierLabel} (${percentageLabel})`,
          explanation:
            value === 1
              ? `Week-to-week progress in ${variationScope} is unchanged. This affects consistency, not average research speed.`
              : `Week-to-week progress in ${variationScope} becomes ${formatDecimal(Math.abs(percentage), 1)}% ${value < 1 ? "more consistent" : "less consistent"}. This changes the size of weekly progress swings, not average research speed. Multiple effects stack multiplicatively.`,
        };
      }
      if (target === "lab.market.acquisitionRate") {
        return {
          label: `×${multiplierLabel} (${percentageLabel})`,
          explanation: `The share of customer demand and revenue this lab can immediately reach is multiplied by ${multiplierLabel}. There is no hidden demand ramp or decay. Multiple market-reach effects stack multiplicatively.`,
        };
      }
      return {
        label: `×${multiplierLabel} (${percentageLabel})`,
        explanation: `${targetLabel} is multiplied by ${multiplierLabel}. Multiple percentage effects stack multiplicatively.`,
      };
    }
    case "min":
      return {
        label: `cap ${formatDecimal(value, 2)}`,
        explanation: `${targetLabel} cannot exceed ${formatDecimal(value, 2)} while this effect is active.`,
      };
    case "max":
      return {
        label: `floor ${formatDecimal(value, 2)}`,
        explanation: `${targetLabel} cannot fall below ${formatDecimal(value, 2)} while this effect is active.`,
      };
  }
}

function researchOutputModifierTone(
  operation: ModifierState["operation"],
  value: number,
): ResearchProgrammeOutputLedgerLineView["tone"] {
  if (operation === "add") {
    return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  }
  if (operation === "multiply") {
    return value > 1 ? "positive" : value < 1 ? "negative" : "neutral";
  }
  if (operation === "min") {
    return value < 1 ? "negative" : "neutral";
  }
  return value > 1 ? "positive" : "neutral";
}

function researchOutputModifierEffectLabel(
  operation: ModifierState["operation"],
  value: number,
  fallback: string,
): string {
  if (operation !== "multiply") return fallback;
  const percentage = (value - 1) * 100;
  return `${percentage >= 0 ? "+" : "−"}${formatDecimal(Math.abs(percentage), 1)}%`;
}

function researchOutputSourceKind(modifier: Readonly<ModifierState>): string {
  if (
    modifier.source.kind === "system" &&
    modifier.source.id?.startsWith("mandate:") === true
  ) {
    return "founding mandate";
  }
  switch (modifier.source.kind) {
    case "researcher":
      return "star researcher";
    case "facility":
      return "facility";
    case "leader":
      return "lab leader";
    case "event":
      return "decision outcome";
    case "ending":
      return "ending";
    case "system":
      return "lab system";
  }
}

function projectResearchOutputLedger(
  state: Readonly<GameState>,
  content: CompiledContent,
  outputBonus: ReturnType<typeof calculateResearchOutputModifier>,
): ResearchProgrammeOutputLedgerView {
  const leadLines: ResearchProgrammeOutputLedgerLineView[] =
    outputBonus.starResearcherContributions.map((contribution) => {
      const researcher = state.researchers[contribution.researcherId];
      const definition =
        researcher === undefined
          ? undefined
          : content.researchers.definitions[researcher.definitionId];
      const sourceLabel = definition?.displayName ?? "Programme researcher";
      const roleLabel =
        contribution.role === "lead" ? "Programme lead" : "Programme adviser";
      const effectLabel = `${contribution.genericPercentagePoints >= 0 ? "+" : "−"}${formatDecimal(
        Math.abs(contribution.genericPercentagePoints),
        1,
      )}%`;
      return {
        group: "lead",
        sourceKind: roleLabel.toLowerCase(),
        sourceLabel,
        effectLabel,
        explanation: `${roleLabel} skill ${formatDecimal(
          contribution.skillLevel,
          1,
        )}/5 in ${humanizeIdentifier(contribution.matchingSkill)} adds ${effectLabel} to this programme's starting output multiplier.`,
        tone:
          contribution.genericPercentagePoints > 0
            ? "positive"
            : contribution.genericPercentagePoints < 0
              ? "negative"
              : "neutral",
        temporary: false,
      };
    });

  const diffusionLines: ResearchProgrammeOutputLedgerLineView[] =
    outputBonus.diffusion.contributors.map((contribution) => {
      const researcher = state.researchers[contribution.researcherId as ResearcherId];
      const definition =
        researcher === undefined
          ? undefined
          : content.researchers.definitions[researcher.definitionId];
      const sourceLabel = definition?.displayName ?? "Star researcher";
      const effectLabel = `+${formatDecimal(contribution.percentagePoints, 1)}%`;
      return {
        group: "diffusion",
        sourceKind: "knowledge diffusion",
        sourceLabel,
        effectLabel,
        explanation: `Skill ${formatDecimal(contribution.skill, 1)}/5 contributes at ${formatDecimal(
          outputBonus.diffusion.ratePerSkillPoint,
          2,
        )}% per skill point. The programme lead is excluded to avoid counting the same expertise twice.`,
        tone: contribution.percentagePoints > 0 ? "positive" : "neutral",
        temporary: false,
      };
    });

  const seenModifierIds = new Set<string>();
  const effectLines = outputBonus.modifierContributions.flatMap(
    (contribution): readonly ResearchProgrammeOutputLedgerLineView[] => {
      if (seenModifierIds.has(contribution.modifierId)) return [];
      seenModifierIds.add(contribution.modifierId);
      const modifier = state.modifiers[contribution.modifierId as ModifierId];
      if (modifier === undefined) return [];
      const effect = modifierEffect(
        modifier.target,
        modifierTargetLabel(modifier.target),
        modifier.operation,
        modifier.value,
      );
      return [
        {
          group: "effect",
          sourceKind: researchOutputSourceKind(modifier),
          sourceLabel: modifierSourceLabel(state, content, modifier),
          effectLabel: researchOutputModifierEffectLabel(
            modifier.operation,
            modifier.value,
            effect.label,
          ),
          explanation: effect.explanation,
          tone: researchOutputModifierTone(modifier.operation, modifier.value),
          temporary: modifier.endsAt !== undefined,
          ...(modifier.endsAt === undefined
            ? {}
            : { remainingWeeks: Math.max(0, modifier.endsAt - state.run.tick) }),
        },
      ];
    },
  );

  return {
    totalMultiplier: outputBonus.outputModifier,
    leadPercentagePoints: outputBonus.assignedResearcherPercentagePoints,
    diffusionPercentagePoints: outputBonus.diffusion.percentagePoints,
    otherEffectCount: effectLines.length,
    lines: [...leadLines, ...diffusionLines, ...effectLines],
  };
}

function modifierTargetLabel(target: string): string {
  return modifierTargetDisplayLabel(target);
}

function projectActiveModifiers(
  state: Readonly<GameState>,
  content: CompiledContent,
): readonly ActiveModifierView[] {
  return Object.values(state.modifiers)
    .filter(
      (modifier) =>
        modifier.startsAt <= state.run.tick &&
        (modifier.endsAt === undefined || state.run.tick < modifier.endsAt) &&
        modifier.target !== "lab.paper.eligibleFamilies" &&
        (modifier.activation === undefined ||
          evaluateModifierActivation(state, modifier.activation)),
    )
    .map((modifier): ActiveModifierView => {
      const targetLabel = modifierTargetLabel(modifier.target);
      const effect = modifierEffect(
        modifier.target,
        targetLabel,
        modifier.operation,
        modifier.value,
      );
      return {
        modifierId: modifier.id,
        sourceKind:
          modifier.source.kind === "system" &&
          modifier.source.id?.startsWith("mandate:") === true
            ? "founding mandate"
            : modifier.source.kind,
        sourceLabel: modifierSourceLabel(state, content, modifier),
        targetLabel,
        effectLabel: effect.label,
        explanation: effect.explanation,
        temporary: modifier.endsAt !== undefined,
        ...(modifier.endsAt === undefined
          ? {}
          : { remainingWeeks: Math.max(0, modifier.endsAt - state.run.tick) }),
      };
    })
    .sort((left, right) =>
      left.sourceLabel < right.sourceLabel
        ? -1
        : left.sourceLabel > right.sourceLabel
          ? 1
          : left.targetLabel < right.targetLabel
            ? -1
            : left.targetLabel > right.targetLabel
              ? 1
              : left.modifierId < right.modifierId
                ? -1
                : left.modifierId > right.modifierId
                  ? 1
                  : 0,
    );
}

function projectFinance(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): FinanceView {
  const lab = requireLab(state, labId);
  const forecast = forecastFinance(state, content, labId, 1, "measured");
  const displayLines: FinanceLineView[] = [];
  const groupedComputeLineIndexes = new Map<string, number>();
  for (const line of forecast.linesPerCycle) {
    const description =
      line.category === "facility" && line.description.includes(":")
        ? `${fallbackFacilityDisplayName(line.description.replace(/ operations$/, ""))} operations`
        : line.description;
    const groupComputeLine = line.category === "compute-power";
    const groupedIndex = groupComputeLine
      ? groupedComputeLineIndexes.get(line.category)
      : undefined;
    if (groupedIndex !== undefined) {
      const current = displayLines[groupedIndex];
      if (current === undefined) {
        throw new Error(`Missing grouped finance line ${line.category}`);
      }
      const amountMillions = current.amountMillions + line.amountMillions;
      displayLines[groupedIndex] = {
        ...current,
        amountMillions,
        amountLabel: formatMoneyMillions(amountMillions),
      };
      continue;
    }
    const displayLine: FinanceLineView = {
      category: line.category,
      sourceId: groupComputeLine ? `finance:${line.category}` : line.sourceId,
      amountMillions: line.amountMillions,
      description,
      amountLabel: formatMoneyMillions(line.amountMillions),
    };
    if (groupComputeLine) {
      groupedComputeLineIndexes.set(line.category, displayLines.length);
    }
    displayLines.push(displayLine);
  }
  const cashflowLabel = `${formatMoneyMillions(forecast.incomeMillionsPerCycle)} in · ${formatMoneyMillions(forecast.outgoingsMillionsPerCycle)} out · ${formatMoneyMillions(forecast.netMillionsPerCycle)} net / 4 weeks`;
  const valuationState = lab.finance.valuation;
  const breakdown = calculateValuationTarget(state, content, labId);
  const mark = valuationState?.markMillions ?? breakdown.targetMillions;
  const previousMark = valuationState?.previousMarkMillions ?? mark;
  const peakMark = Math.max(valuationState?.peakMarkMillions ?? 0, mark);
  const openingCreditProtection = isProgressiveOpeningInsolvencyProtected(state);
  const insolvencyClockActive = lab.finance.cash < 0 && !openingCreditProtection;
  const consecutiveNegativeCashWeeks = insolvencyClockActive
    ? (lab.finance.consecutiveNegativeCashWeeks ?? 0)
    : 0;
  const insolvencyWeeksRemaining = Math.max(
    0,
    NEGATIVE_CASH_BANKRUPTCY_WEEKS - consecutiveNegativeCashWeeks,
  );
  return {
    valuation: {
      markMillions: mark,
      markLabel: formatValuation(mark),
      peakMarkMillions: peakMark,
      peakMarkLabel: formatValuation(peakMark),
      weeklyChangePercent:
        previousMark > 0 ? ((mark - previousMark) / previousMark) * 100 : 0,
      mood: marketMood(mark, previousMark),
      ...(valuationState?.officialMarkMillions === undefined
        ? {}
        : {
            officialMarkLabel: formatValuation(valuationState.officialMarkMillions),
          }),
      breakdown: {
        revenueValueLabel: formatValuation(breakdown.revenueValueMillions),
        assetValueLabel: formatValuation(breakdown.assetValueMillions),
        goingConcernLabel: formatValuation(breakdown.goingConcernMillions),
        cashLabel: formatValuation(breakdown.cashMillions),
        gpuFleetValueLabel: formatValuation(breakdown.gpuFleetValueMillions),
        facilitiesValueLabel: formatValuation(breakdown.facilitiesValueMillions),
        researchDepthMultiplier: breakdown.researchDepthMultiplier,
        capabilityValueLabel: formatValuation(breakdown.capabilityValueMillions),
        hypeMultiplier: breakdown.hypeMultiplier,
        repricingMultiplier: breakdown.repricingMultiplier,
        haircutMultiplier: breakdown.haircutMultiplier,
      },
    },
    balanceMillions: lab.finance.cash,
    incomeMillionsPerCycle: forecast.incomeMillionsPerCycle,
    outgoingsMillionsPerCycle: forecast.outgoingsMillionsPerCycle,
    netMillionsPerCycle: forecast.netMillionsPerCycle,
    balanceLabel: formatValuation(lab.finance.cash),
    cashflowLabel,
    projectedClosingCashMillions: forecast.projectedClosingCashMillions,
    projectedClosingCashLabel: formatMoneyMillions(forecast.projectedClosingCashMillions),
    insolvencyClock: {
      active: insolvencyClockActive,
      consecutiveWeeks: consecutiveNegativeCashWeeks,
      bankruptcyAtWeeks: NEGATIVE_CASH_BANKRUPTCY_WEEKS,
      remainingWeeks: insolvencyWeeksRemaining,
      band:
        consecutiveNegativeCashWeeks >= 39
          ? "critical"
          : consecutiveNegativeCashWeeks >= 26
            ? "warning"
            : "healthy",
      label: insolvencyClockActive
        ? `${String(consecutiveNegativeCashWeeks)} / ${String(NEGATIVE_CASH_BANKRUPTCY_WEEKS)} weeks below $0`
        : openingCreditProtection && lab.finance.cash < 0
          ? "Paused — opening credit line"
          : "Inactive — cash is non-negative",
      explanation: insolvencyClockActive
        ? `Bankruptcy occurs after ${String(insolvencyWeeksRemaining)} more consecutive week${insolvencyWeeksRemaining === 1 ? "" : "s"} below $0, even if fundraising remains theoretically available. Only restoring cash to $0 or above resets this clock.`
        : openingCreditProtection && lab.finance.cash < 0
          ? "Family & friends credit covers required opening objectives. The balance is real, but the insolvency clock starts only when fundraising unlocks."
          : "The insolvency clock starts when cash falls below $0.",
    },
    runway: { ...forecast.runway },
    linesPerCycle: displayLines,
  };
}

function projectGpuFleet(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): GpuFleetView {
  const lab = requireLab(state, labId);
  const queuedAllocationOrder = state.run.queuedOrders.find(
    (order) => order.kind === "set-gpu-allocation" && order.labId === labId,
  );
  const queuedAllocation =
    queuedAllocationOrder?.kind === "set-gpu-allocation"
      ? queuedAllocationOrder.allocation
      : undefined;
  const portfolio = planGpuPortfolio(state, content, labId);
  const committedReservations = resolveGpuReservations(
    state,
    content,
    labId,
    "committed",
  );
  const totalPhysicalGpus = lab.compute.lots.reduce(
    (sum, lot) => sum + lot.physicalCount,
    0,
  );
  const onlinePhysicalGpus = lab.compute.lots.reduce(
    (sum, lot) => sum + Math.round(lot.physicalCount * lot.availableFraction),
    0,
  );
  const byGeneration = new Map<
    string,
    {
      physicalGpus: number;
      ownedPhysicalGpus: number;
      unreservedOwnedPhysicalGpus: number;
      onlinePhysicalGpus: number;
    }
  >();
  for (const lot of lab.compute.lots) {
    const current = byGeneration.get(lot.generationId) ?? {
      physicalGpus: 0,
      ownedPhysicalGpus: 0,
      unreservedOwnedPhysicalGpus: 0,
      onlinePhysicalGpus: 0,
    };
    current.physicalGpus += lot.physicalCount;
    if (lot.ownership === "owned") {
      current.ownedPhysicalGpus += lot.physicalCount;
      current.unreservedOwnedPhysicalGpus += Math.min(
        lot.physicalCount,
        committedReservations.remainingByLot[lot.id] ?? 0,
      );
    }
    current.onlinePhysicalGpus += Math.round(lot.physicalCount * lot.availableFraction);
    byGeneration.set(lot.generationId, current);
  }

  const generationMix = [...byGeneration.entries()]
    .map(([generationId, counts]): GpuGenerationMixView => {
      const generation = content.gpuGenerations[generationId];
      const displayName = generation?.displayName ?? humanizeIdentifier(generationId);
      return {
        generationId,
        displayName,
        historicity: generation?.historicity ?? "unknown",
        physicalGpus: counts.physicalGpus,
        ownedPhysicalGpus: counts.ownedPhysicalGpus,
        sellablePhysicalGpus:
          Math.floor(counts.unreservedOwnedPhysicalGpus / GPU_TRADE_UNIT) *
          GPU_TRADE_UNIT,
        onlinePhysicalGpus: counts.onlinePhysicalGpus,
        label: `${formatInteger(counts.physicalGpus)} ${displayName}`,
      };
    })
    .sort((left, right) =>
      left.displayName < right.displayName
        ? -1
        : left.displayName > right.displayName
          ? 1
          : 0,
    );
  const totalOwnedPhysicalGpus = generationMix.reduce(
    (sum, generation) => sum + generation.ownedPhysicalGpus,
    0,
  );
  const sellablePhysicalGpus = generationMix.reduce(
    (sum, generation) => sum + generation.sellablePhysicalGpus,
    0,
  );
  const requested = lab.compute.allocation;
  const allocation = portfolio.allocation;
  const reservations = portfolio.reservations.reservations.map(
    (reservation): GpuReservationView => {
      const project = state.projects[reservation.projectId];
      if (project === undefined) {
        return {
          projectId: reservation.projectId,
          displayName: "Reserved project compute",
          kind: "crisis",
          status: "active",
          requestedPhysicalGpus: reservation.requestedPhysicalGpus,
          reservedPhysicalGpus: reservation.allocatedPhysicalGpus,
          unmetPhysicalGpus: reservation.unmetPhysicalGpus,
          statusLabel: "Held until the project releases it",
        };
      }
      const displayName = (() => {
        switch (project.payload.kind) {
          case "training": {
            const aiFamily = content.labs[lab.definitionId]?.aiFamily ?? "AI";
            const scale =
              content.training.scales[project.payload.scale]?.displayName ??
              humanizeIdentifier(project.payload.scale);
            return `Next ${aiFamily} generation · ${scale} training`;
          }
          case "evaluation": {
            const model =
              state.models[project.payload.modelId]?.displayName ?? "Current model";
            const evaluation =
              content.evaluations.definitions[project.payload.evaluationDefinitionId]
                ?.displayName ?? "evaluation";
            return `${model} · ${evaluation}`;
          }
          case "anomaly-investigation":
            return project.payload.mode === "mitigation"
              ? "Anomaly control remediation"
              : "Anomaly investigation";
          case "construction":
            return (
              content.facilities[project.payload.facilityDefinitionId]?.displayName ??
              humanizeIdentifier(project.definitionId)
            );
          case "productisation":
            return content.deployment.productisation[project.payload.mode].displayName;
          case "fundraising":
            return content.fundraising.campaigns[project.payload.campaign].displayName;
          case "researcher-commitment": {
            const researcher = state.researchers[project.payload.researcherId];
            const definition =
              researcher === undefined
                ? undefined
                : content.researchers.definitions[researcher.definitionId];
            return `${definition?.displayName ?? "Researcher"} · promise work`;
          }
          case "lobbying":
            return humanizeIdentifier(project.definitionId);
          case "agi-component":
            return project.payload.kind === "agi-component"
              ? AGI_COMPONENT_RULES[project.payload.componentType].displayName
              : humanizeIdentifier(project.definitionId);
          case "coalition":
          case "crisis":
            return humanizeIdentifier(project.payload.projectType);
        }
      })();
      const statusLabel =
        project.status === "queued"
          ? "Committed for later · available until the project starts"
          : project.status === "paused"
            ? "Reserved while the project is paused"
            : project.status === "active"
              ? "In use now"
              : "Held until the project releases it";
      return {
        projectId: reservation.projectId,
        displayName,
        kind: project.kind,
        status: project.status,
        requestedPhysicalGpus: reservation.requestedPhysicalGpus,
        reservedPhysicalGpus: reservation.allocatedPhysicalGpus,
        unmetPhysicalGpus: reservation.unmetPhysicalGpus,
        statusLabel,
      };
    },
  );

  const ratedTeraflops = lab.compute.lots.reduce((sum, lot) => {
    const generation = content.gpuGenerations[lot.generationId];
    return generation === undefined
      ? sum
      : sum + lot.physicalCount * generationTeraflopsPerGpu(generation);
  }, 0);
  const externalThroughput = resolveModifierValue(state, THROUGHPUT_TARGET, 1, {
    labId,
    excludeSourceKinds: ["researcher"],
  });
  const researcherThroughput = resolveResearcherStack(state, THROUGHPUT_TARGET, 1, {
    labId,
  });
  const throughput = fleetThroughputMultiplier(state, labId);
  const throughputTargetLabel = modifierTargetDisplayLabel(THROUGHPUT_TARGET);
  const throughputEffects = [
    ...externalThroughput.contributions,
    ...researcherThroughput.contributions,
  ]
    .flatMap((contribution): readonly GpuThroughputEffectView[] => {
      const modifier = state.modifiers[contribution.modifierId as ModifierId];
      if (modifier === undefined) return [];
      const effect = modifierEffect(
        modifier.target,
        throughputTargetLabel,
        modifier.operation,
        modifier.value,
      );
      return [
        {
          modifierId: modifier.id,
          sourceKind:
            modifier.source.kind === "system" &&
            modifier.source.id?.startsWith("mandate:") === true
              ? "founding mandate"
              : modifier.source.kind,
          sourceLabel: modifierSourceLabel(state, content, modifier),
          effectLabel: effect.label,
          explanation: effect.explanation,
          temporary: modifier.endsAt !== undefined,
          ...(modifier.endsAt === undefined
            ? {}
            : { remainingWeeks: Math.max(0, modifier.endsAt - state.run.tick) }),
        },
      ];
    })
    .sort((left, right) =>
      left.sourceLabel < right.sourceLabel
        ? -1
        : left.sourceLabel > right.sourceLabel
          ? 1
          : left.modifierId < right.modifierId
            ? -1
            : left.modifierId > right.modifierId
              ? 1
              : 0,
    );
  const totalTeraflops = fleetTeraflops(state, content, labId);
  // Effective, like totalTeraflops above: two FLOP/s figures on the same screen
  // must share a basis or they disagree the moment any modifier lands.
  const unreservedTeraflops =
    lab.compute.lots.reduce((sum, lot) => {
      const generation = content.gpuGenerations[lot.generationId];
      if (generation === undefined) return sum;
      return (
        sum +
        (portfolio.reservations.remainingByLot[lot.id] ?? 0) *
          generationTeraflopsPerGpu(generation) *
          lot.availableFraction
      );
    }, 0) * throughput;
  const currentGeneration = content.gpuGenerations[state.world.currentGpuGenerationId];
  return {
    totalPhysicalGpus,
    totalOwnedPhysicalGpus,
    sellablePhysicalGpus,
    onlinePhysicalGpus,
    reservedPhysicalGpus: portfolio.reservations.reservedPhysicalGpus,
    allocatablePhysicalGpus: allocation.totalPhysicalGpus,
    ratedTeraflops,
    throughputMultiplier: throughput,
    throughputEffects,
    totalTeraflops,
    unreservedTeraflops,
    eraGpuTeraflops:
      currentGeneration === undefined ? 0 : generationTeraflopsPerGpu(currentGeneration),
    eraReferenceTeraflops: eraReferenceTeraflops(state, content),
    unlockedGenerationIds: unlockedGpuGenerationIds(state, content),
    currentGenerationId: state.world.currentGpuGenerationId,
    ...((): { currentGenerationUnlockedAtTick?: number } => {
      const unlockedAt = [...state.domainLog]
        .reverse()
        .find(
          (entry) =>
            entry.code === `gpu-generation:${state.world.currentGpuGenerationId}`,
        )?.tick;
      return unlockedAt === undefined
        ? {}
        : { currentGenerationUnlockedAtTick: unlockedAt };
    })(),
    ...(() => {
      const worldFrontier = Math.max(
        0,
        ...Object.values(state.models).map(
          (candidate) => candidate.measuredCapability?.frontierCapability ?? 0,
        ),
      );
      const next = Object.values(content.gpuGenerations)
        .filter(
          (generation) => generation.unlockAtWorldFrontierCapability > worldFrontier,
        )
        .sort(
          (left, right) =>
            left.unlockAtWorldFrontierCapability - right.unlockAtWorldFrontierCapability,
        )[0];
      return next === undefined
        ? {}
        : {
            nextGeneration: {
              displayName: next.displayName,
              unlockAtWorldFrontierCapability: next.unlockAtWorldFrontierCapability,
              worldFrontierCapability: Math.round(worldFrontier),
            },
          };
    })(),
    reservations,
    generationMix,
    allocation: (() => {
      const lanes = calculateAllocationTeraflops(state, content, labId, allocation);
      return {
        serving: allocationLine(
          "serving",
          "Model serving",
          requested.servingFleetShareBasisPoints,
          allocation.servingPhysicalGpus,
          lanes.serving,
        ),
        research: allocationLine(
          "research",
          "Research and evaluations",
          10_000 - requested.servingFleetShareBasisPoints,
          allocation.researchPhysicalGpus,
          lanes.research,
        ),
        capabilities: allocationLine(
          "capabilities",
          "Capability research",
          requested.capabilityBasisPoints,
          allocation.capabilityPhysicalGpus,
          lanes.capabilities,
        ),
        safety: allocationLine(
          "safety",
          "Safety research",
          10_000 - requested.capabilityBasisPoints,
          allocation.safetyPhysicalGpus,
          lanes.safety,
        ),
        capabilityPrograms: allocation.capabilityPrograms.map((program) =>
          allocationLine(
            program.programId,
            program.programId,
            requested.capabilityDomainWeights[program.programId] ?? 0,
            program.physicalGpus,
            lanes.capabilityPrograms[program.programId] ?? 0,
          ),
        ),
        safetyPrograms: allocation.safetyPrograms.map((program) =>
          allocationLine(
            program.programId,
            program.programId,
            requested.safetyProgramWeights[program.programId] ?? 0,
            program.physicalGpus,
            lanes.safetyPrograms[program.programId] ?? 0,
          ),
        ),
      };
    })(),
    ...(queuedAllocation === undefined
      ? {}
      : {
          queuedAllocation: {
            servingFleetShareBasisPoints: queuedAllocation.servingFleetShareBasisPoints,
            capabilityBasisPoints: queuedAllocation.capabilityBasisPoints,
            capabilityDomainWeights: { ...queuedAllocation.capabilityDomainWeights },
            safetyProgramWeights: { ...queuedAllocation.safetyProgramWeights },
          },
        }),
    pendingDeliveries: lab.compute.deliveries.map((delivery) => {
      const generation = content.gpuGenerations[delivery.generationId];
      const displayName =
        generation?.displayName ?? humanizeIdentifier(delivery.generationId);
      const due = calendarFromTick(delivery.dueAt);
      return {
        lotId: delivery.lotId,
        generationId: delivery.generationId,
        displayName,
        physicalGpus: delivery.physicalCount,
        dueTick: delivery.dueAt,
        label: `${formatInteger(delivery.physicalCount)} ${displayName} · due ${String(due.year)} · WEEK ${String(due.week)}`,
      };
    }),
  };
}

function projectMarket(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): MarketView {
  const lab = requireLab(state, labId);
  const forecast = forecastUsage(state, content, labId, "measured");
  const servingDemandCap = calculateServingDemandCap(state, content, labId, "measured");
  const servingAura = projectServingAura(state, content, labId, "measured");
  const marketShare = forecast.segments.reduce((sum, segment) => {
    const definition = content.market.segments[segment.segmentId];
    return sum + segment.softmaxShare * (definition?.revenueShare ?? 0);
  }, 0);
  return {
    marketSharePercentage: marketShare * 100,
    servingCapacityTeraflops: forecast.servingCapacityTeraflops,
    requestedTeraflops: forecast.requestedTeraflops,
    deliveredTeraflops: forecast.deliveredTeraflops,
    unmetTeraflops: forecast.unmetTeraflops,
    projectedRevenueMillionsThisWeek: forecast.revenueMillionsThisWeek,
    projectedRevenueMillionsPerCycle:
      forecast.revenueMillionsThisWeek * MARKET_CYCLE_WEEKS,
    projectedServingAuraPerCycle: servingAura.perCycle,
    projectedServingFulfilment: servingAura.fulfilment,
    servingDemandCap,
    segments: forecast.segments.map((row): MarketSegmentView => {
      const definition = content.market.segments[row.segmentId];
      const segment = lab.market.segments[row.segmentId];
      if (definition === undefined || segment === undefined) {
        throw new Error(`Missing market segment ${row.segmentId}`);
      }
      return {
        segmentId: row.segmentId,
        displayName: definition.displayName,
        unlocked: row.unlocked,
        ...(row.lockReason === undefined ? {} : { lockReason: row.lockReason }),
        headlineWeightPercentage: definition.revenueShare * 100,
        satisfaction: segment.satisfaction,
        marketSharePercentage: row.softmaxShare * 100,
        requestedTeraflops: row.requestedTeraflops,
        deliveredTeraflops: row.deliveredTeraflops,
        unmetTeraflops: row.unmetTeraflops,
        valuePerDeliveredFlopMultiplier: row.valuePerDeliveredFlopMultiplier,
        projectedRevenueMillionsThisWeek: row.grossRevenueMillionsThisWeek,
        projectedRevenueMillionsPerCycle:
          row.grossRevenueMillionsThisWeek * MARKET_CYCLE_WEEKS,
        appeal: (() => {
          // "measured": the view is built from the lab's own evidence, never
          // the true capability the market actually responds to. The GameView
          // hidden-state invariant test enforces this.
          const breakdown = calculateSegmentAppeal(
            state,
            content,
            labId,
            row.segmentId,
            "measured",
          );
          return {
            capability: Math.round(breakdown.relevantCapability),
            productQuality: Math.round(breakdown.productQuality),
            reliability: Math.round(breakdown.reliability),
            governmentTrust: Math.round(breakdown.governmentTrust),
            weights: { ...definition.appealWeights },
            accessPenalty: Math.round(breakdown.accessPenalty),
            incidentPenalty: Math.round(breakdown.incidentPenalty),
            final: Math.round(breakdown.final),
          };
        })(),
      };
    }),
  };
}

const LOBBYING_OBJECTIVES: readonly LobbyingObjective[] = [
  "reduce-restriction",
  "gain-grant",
  "shape-standard",
  "support-coalition",
];
const LOBBYING_APPROACHES: readonly LobbyingApproach[] = [
  "aggressive-access",
  "transparent-standards",
  "technical-briefing",
];

function projectPolitics(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): PoliticsView {
  const lab = requireLab(state, labId);
  const pressure = calculateInterventionPressure(state, labId);
  return {
    governmentAttention: lab.politics.governmentAttention,
    governmentTrust: lab.politics.governmentTrust,
    strategicDependence: lab.politics.strategicDependence,
    captureConcern: lab.politics.captureConcern,
    interventionPressure: pressure.final,
    pressureBand: pressure.band,
    pressureExplanation:
      `${formatDecimal(pressure.attentionContribution)} attention + ` +
      `${formatDecimal(pressure.distrustContribution)} distrust + ` +
      `${formatDecimal(pressure.systemicRiskContribution)} systemic risk + ` +
      `${formatDecimal(pressure.captureConcernContribution)} capture concern + ` +
      `${formatDecimal(pressure.publicFearContribution)} public fear − ` +
      `${formatDecimal(pressure.strategicValueMitigation)} strategic value`,
    pressureBands: INTERVENTION_BAND_FLOORS.map((entry) => ({
      band: entry.band,
      floor: entry.floor,
      current: entry.band === pressure.band,
    })),
    ...(() => {
      const next = INTERVENTION_BAND_FLOORS.find((entry) => entry.floor > pressure.final);
      return next === undefined
        ? {}
        : { pressureToNextBand: Math.round((next.floor - pressure.final) * 10) / 10 };
    })(),
    governmentTrustFloor: governmentTrustFloor(state, labId),
    governmentTrustRecoveryPerWeek: GOVERNMENT_TRUST_RECOVERY_PER_WEEK,
    interventionCooldownQuarters: INTERVENTION_COOLDOWN_QUARTERS,
    nextQuarterInWeeks: 13 - (state.run.tick % 13),
    pendingInterventions: lab.politics.interventions.map((intervention) => {
      const linkedDecision = Object.values(state.eventInstances).find(
        (instance) => instance.tokens["INTERVENTION_ID"] === intervention.id,
      );
      return {
        interventionId: intervention.id,
        kind: intervention.kind,
        trigger: intervention.trigger,
        pressureAtTrigger: intervention.pressureAtTrigger,
        status: intervention.status,
        decisionState:
          linkedDecision === undefined
            ? "scheduled"
            : linkedDecision.status === "unresolved"
              ? "open"
              : "answered",
        ...(intervention.response === undefined
          ? {}
          : { response: intervention.response }),
      };
    }),
    programmes: (
      Object.keys(GOVERNMENT_PROGRAMMES) as (keyof typeof GOVERNMENT_PROGRAMMES)[]
    ).map((programmeId) => {
      const quote = quoteGovernmentProgramme(state, content, labId, programmeId);
      const exit = quoteGovernmentProgrammeExit(state, labId, programmeId);
      return {
        id: programmeId,
        displayName: quote.definition.displayName,
        summary: quote.definition.summary,
        benefitLabel: quote.definition.benefitLabel,
        costLabel: quote.definition.costLabel,
        endgameLabel: quote.definition.endgameLabel,
        quarterlyCashMillions: quote.quarterlyCashMillions,
        active: quote.active,
        canJoin: quote.canJoin,
        blockers: quote.blockers,
        exitTrustCost: exit.trustCost,
        exitProgrammeCount: exit.programmeIds.length,
        exitProgrammeNames: exit.programmeNames,
        championRefusalAvailable:
          programmeId === "national-champion" && championRefusalAvailable(state, labId),
      };
    }),
    lobbyingOptions: LOBBYING_OBJECTIVES.flatMap((objective) =>
      LOBBYING_APPROACHES.map((approach) => {
        const quote = quoteLobbyingProject(state, content, labId, objective, approach);
        return {
          objective,
          approach,
          displayName: quote.displayName,
          approachName: quote.approachName,
          cashCostMillions: quote.cashCostMillions,
          auraCost: quote.auraCost,
          durationWeeks: quote.durationWeeks,
          chanceRange: quote.chanceRange,
          chanceLabel: quote.chanceLabel,
          successLabel: quote.successLabel,
          available: quote.blockers.length === 0,
          blockers: [...quote.blockers],
        };
      }),
    ),
  };
}

function projectFacilities(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): FacilitiesView {
  const lab = requireLab(state, labId);
  const facilityCapacity = calculateFacilityCapacity(state, content, labId);
  const projectCapacity = calculateProjectCapacity(state, content, labId);
  const completedDefinitionIds = new Set(
    lab.facilities.instances.map((instance) => instance.definitionId),
  );
  const buildingDefinitionIds = new Set(
    lab.projects.projectIds.flatMap((projectId) => {
      const project = state.projects[projectId];
      return project?.payload.kind === "construction" &&
        project.status !== "cancelled" &&
        project.status !== "failed"
        ? [project.payload.facilityDefinitionId]
        : [];
    }),
  );
  const phaseTierLimit = facilityTierLimit(state, content);
  const progressiveFacilityGate =
    isProgressiveCampaign(state) && !labFeatureUnlocked(state, "people");
  const constructionCatalogueDefinition = (
    definition: CompiledContent["facilities"][string],
  ): boolean =>
    !definition.tags.includes("campaign-start-only") &&
    (!progressiveFacilityGate || definition.id === SERVER_RACK_FACILITY_ID);
  const isCurrentlyRevealed = (
    definition: CompiledContent["facilities"][string],
  ): boolean =>
    completedDefinitionIds.has(definition.id) ||
    buildingDefinitionIds.has(definition.id) ||
    (definition.tier <= phaseTierLimit &&
      definition.prerequisiteFacilityIds.every((prerequisiteId) =>
        lab.facilities.instances.some(
          (instance) => instance.definitionId === prerequisiteId,
        ),
      ));
  const currentlyRevealedDefinitionIds = new Set(
    Object.values(content.facilities)
      .filter(constructionCatalogueDefinition)
      .filter(isCurrentlyRevealed)
      .map((definition) => definition.id),
  );
  const isUpcoming = (definition: CompiledContent["facilities"][string]): boolean => {
    if (
      isCurrentlyRevealed(definition) ||
      definition.tier > phaseTierLimit ||
      definition.prerequisiteFacilityIds.length === 0
    ) {
      return false;
    }
    const unmetPrerequisites = definition.prerequisiteFacilityIds.filter(
      (prerequisiteId) =>
        !lab.facilities.instances.some(
          (instance) => instance.definitionId === prerequisiteId,
        ),
    );
    return (
      unmetPrerequisites.length > 0 &&
      unmetPrerequisites.every((prerequisiteId) =>
        currentlyRevealedDefinitionIds.has(prerequisiteId),
      )
    );
  };
  return {
    capacity: {
      baseMajorProjectSlots: projectCapacity.baseMajorProjectSlots,
      facilityBonusMajorProjectSlots: projectCapacity.facilityBonusMajorProjectSlots,
      maximumMajorProjectSlots: projectCapacity.maximumMajorProjectSlots,
      majorProjectSlots: projectCapacity.majorProjectSlots,
      recoveryMajorProjectSlots: projectCapacity.recoveryMajorProjectSlots,
      occupiedMajorProjectSlots: projectCapacity.occupiedMajorProjectSlots,
      availableMajorProjectSlots: projectCapacity.availableMajorProjectSlots,
      supportedOwnedGpuCount: facilityCapacity.supportedOwnedGpuCount,
      installedOwnedGpuCount: facilityCapacity.installedOwnedGpuCount,
      pendingOwnedGpuCount: facilityCapacity.pendingOwnedGpuCount,
      ownedGpuHeadroom: facilityCapacity.ownedGpuHeadroom,
    },
    completed: lab.facilities.instances.map((instance) => ({
      ...(instance.id === undefined ? {} : { facilityId: instance.id }),
      definitionId: instance.definitionId,
      displayName:
        content.facilities[instance.definitionId]?.displayName ??
        fallbackFacilityDisplayName(instance.definitionId),
      controllable: content.facilities[instance.definitionId] !== undefined,
      completedAtTick: instance.completedAt,
      majorProjectSlotBonus: instance.majorProjectSlotBonus ?? 0,
    })),
    catalogue: Object.values(content.facilities)
      .filter(constructionCatalogueDefinition)
      .filter((definition) => isCurrentlyRevealed(definition) || isUpcoming(definition))
      .map((definition) => {
        const quote = quoteFacilityConstruction(state, content, labId, definition.id);
        const completed = completedDefinitionIds.has(definition.id);
        const building = buildingDefinitionIds.has(definition.id);
        const upcoming = isUpcoming(definition);
        const unmetPrerequisiteIds = definition.prerequisiteFacilityIds.filter(
          (prerequisiteId) =>
            !lab.facilities.instances.some(
              (instance) => instance.definitionId === prerequisiteId,
            ),
        );
        const modifierBenefits = definition.modifiers.flatMap((effect) => {
          const benefit = facilityModifierBenefit(effect);
          return benefit === undefined ? [] : [benefit];
        });
        const discoveryBenefit = facilityDiscoveryBenefit(content, definition.id);
        const prosperityBenefit = facilityProsperityBenefit(definition.tags);
        const majorProjectSlotBonus = definition.bonusMajorProjectSlots;
        const majorProjectSlotsRequired =
          facilityConstructionMajorProjectSlots(definition);
        const benefits = [
          ...(definition.supportedOwnedGpuCount > 0
            ? [
                {
                  label: `Houses ${formatInteger(definition.supportedOwnedGpuCount)} owned GPUs`,
                  tone: "positive" as const,
                },
              ]
            : []),
          ...(majorProjectSlotBonus > 0
            ? [
                {
                  label: `Adds ${String(majorProjectSlotBonus)} major-project slot${majorProjectSlotBonus === 1 ? "" : "s"} while operational`,
                  tone: "positive" as const,
                },
              ]
            : []),
          ...(definition.tags.includes("star-slot")
            ? [
                {
                  label: "Adds 1 star-researcher slot",
                  tone: "positive" as const,
                },
              ]
            : []),
          ...modifierBenefits,
          ...(discoveryBenefit === undefined ? [] : [discoveryBenefit]),
          ...(prosperityBenefit === undefined ? [] : [prosperityBenefit]),
        ];
        return {
          definitionId: definition.id,
          displayName: definition.displayName,
          family: definition.family,
          tier: definition.tier,
          summary: definition.summary,
          cashCostMillions: definition.cashCostMillions,
          operatingCostMillionsPerCycle: definition.operatingCostMillionsPerCycle,
          durationWeeks: definition.durationWeeks,
          majorProjectSlotsRequired,
          bonusMajorProjectSlots: majorProjectSlotBonus,
          supportedOwnedGpuCount: definition.supportedOwnedGpuCount,
          prerequisiteDisplayNames: definition.prerequisiteFacilityIds.map(
            (prerequisiteId) =>
              content.facilities[prerequisiteId]?.displayName ?? "Unknown prerequisite",
          ),
          unmetPrerequisiteDisplayNames: unmetPrerequisiteIds.map(
            (prerequisiteId) =>
              content.facilities[prerequisiteId]?.displayName ?? "Unknown prerequisite",
          ),
          benefits,
          completed,
          building,
          available: !completed && !building && quote.blockers.length === 0,
          upcoming,
          blockers: quote.blockers,
        };
      }),
    projects: lab.projects.projectIds.map((projectId): ProjectView => {
      const project = state.projects[projectId];
      if (project === undefined) throw new Error(`Missing project ${projectId}`);
      const displayName = (() => {
        switch (project.payload.kind) {
          case "construction":
            return (
              content.facilities[project.payload.facilityDefinitionId]?.displayName ??
              humanizeIdentifier(project.definitionId)
            );
          case "training":
            return `${content.training.scales[project.payload.scale].displayName} training`;
          case "evaluation":
            return (
              content.evaluations.definitions[project.payload.evaluationDefinitionId]
                ?.displayName ?? humanizeIdentifier(project.definitionId)
            );
          case "anomaly-investigation":
            return project.payload.mode === "mitigation"
              ? "Anomaly control remediation"
              : "Anomaly investigation";
          case "productisation":
            return content.deployment.productisation[project.payload.mode].displayName;
          case "fundraising":
            return content.fundraising.campaigns[project.payload.campaign].displayName;
          case "researcher-commitment": {
            const researcher = state.researchers[project.payload.researcherId];
            const definition =
              researcher === undefined
                ? undefined
                : content.researchers.definitions[researcher.definitionId];
            return `${definition?.displayName ?? "Researcher"} · promise work`;
          }
          case "lobbying":
            return humanizeIdentifier(project.definitionId);
          case "agi-component":
            return project.payload.kind === "agi-component"
              ? AGI_COMPONENT_RULES[project.payload.componentType].displayName
              : humanizeIdentifier(project.definitionId);
          case "coalition":
            return project.payload.projectType.replaceAll("-", " ");
          case "crisis":
            return project.payload.projectType.replaceAll("-", " ");
        }
      })();
      const isConstruction = project.kind === "construction";
      const isTraining = project.payload.kind === "training";
      const isAnomalyInvestigation = project.payload.kind === "anomaly-investigation";
      const isProductisation = project.payload.kind === "productisation";
      const progressLabel = (() => {
        if (project.status === "completed") return "Complete";
        if (project.status === "queued") return "Queued to begin next simulation week";
        if (project.status === "paused" && !isTraining) return "Paused";
        if (isConstruction) return `${formatDecimal(project.progress * 100)}% built`;
        if (isAnomalyInvestigation) {
          const elapsed = Math.round(project.progress * project.expectedDurationWeeks);
          return `${String(elapsed)} of ${String(project.expectedDurationWeeks)} scheduled weeks elapsed`;
        }
        if (!isTraining) return "Progress uncertain";
        const elapsed = project.payload.weeksElapsed;
        if (project.status === "paused") {
          return `Paused after ${String(elapsed)} scheduled week${elapsed === 1 ? "" : "s"}`;
        }
        return `${String(elapsed)} of ${String(project.expectedDurationWeeks)} scheduled weeks elapsed`;
      })();
      return {
        projectId: project.id,
        definitionId: project.definitionId,
        displayName,
        kind: project.kind,
        status: project.status,
        createdAtTick: project.createdAt,
        ...(project.startedAt === undefined ? {} : { startedAtTick: project.startedAt }),
        expectedDurationWeeks: project.expectedDurationWeeks,
        majorProjectSlotsReserved: project.reservations.majorProjectSlots,
        progressLabel,
        ...(isConstruction
          ? { constructionProgressBasisPoints: Math.round(project.progress * 10_000) }
          : {}),
        ...(isTraining
          ? {
              training: {
                reservedPhysicalGpus: project.payload.reservedPhysicalGpus,
                elapsedWeeks: project.payload.weeksElapsed,
                scheduledProgressBasisPoints: Math.min(
                  10_000,
                  Math.round(
                    (project.payload.weeksElapsed /
                      Math.max(1, project.expectedDurationWeeks)) *
                      10_000,
                  ),
                ),
                scaleLabel: content.training.scales[project.payload.scale].displayName,
                postureLabel: trainingPostureDefinition(project.payload.posture)
                  .displayName,
                committedTeraflops: project.payload.committedTeraflops,
                plannedDurationWeeks: plannedTrainingWeeks({
                  expectedDurationWeeks: project.expectedDurationWeeks,
                  payload: project.payload,
                }),
                plannedTotalFlop: totalFlopInvested(
                  project.payload.committedTeraflops,
                  plannedTrainingWeeks({
                    expectedDurationWeeks: project.expectedDurationWeeks,
                    payload: project.payload,
                  }),
                ),
                delayWeeks: project.payload.failureChecks.reduce(
                  (total, check) => total + check.delayWeeks,
                  0,
                ),
                ...(project.payload.completionReport === undefined
                  ? {}
                  : {
                      outcomeAtTick: project.payload.completionReport.completedAt,
                      completedModelId: project.payload.completionReport.modelId,
                      completedModelDisplayName:
                        state.models[project.payload.futureModelId]?.displayName ??
                        "Completed model",
                      ...(project.payload.completionReport.promotedToCurrent === undefined
                        ? {}
                        : {
                            promotedToCurrent:
                              project.payload.completionReport.promotedToCurrent,
                          }),
                      ...(project.payload.completionReport.retainedModelId === undefined
                        ? {}
                        : {
                            retainedModelDisplayName:
                              state.models[
                                project.payload.completionReport.retainedModelId
                              ]?.displayName ?? "Previous model",
                          }),
                      ...(project.payload.completionReport.measuredFrontierDelta ===
                      undefined
                        ? {}
                        : {
                            measuredFrontierDelta:
                              project.payload.completionReport.measuredFrontierDelta,
                          }),
                      ...(project.payload.completionReport.measuredTierDelta === undefined
                        ? {}
                        : {
                            measuredTierDelta:
                              project.payload.completionReport.measuredTierDelta,
                          }),
                    }),
                ...(project.status !== "failed"
                  ? {}
                  : {
                      outcomeAtTick:
                        project.payload.failureChecks.at(-1)?.checkedAt ??
                        project.createdAt,
                    }),
              },
            }
          : {}),
        ...(isProductisation
          ? {
              productisation: {
                modelId: project.payload.modelId,
                modeLabel:
                  content.deployment.productisation[project.payload.mode].displayName,
              },
            }
          : {}),
      };
    }),
  };
}

const SAFETY_PROGRAMME_PLAYER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "base:safety.alignment-control":
    "Primary role: safer future weights. Improves alignment and corrigibility at training time, plus a smaller practical-control bonus.",
  "base:safety.interpretability-evals":
    "Primary role: better evidence. Narrows hidden training-time safety variation and improves estimate accuracy; it does not directly subtract deception.",
  "base:safety.security-containment":
    "Primary role: stronger lab defence. Improves security and containment after training; it does not change the model's intent.",
};

function projectResearch(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): ResearchView {
  const lab = requireLab(state, labId);
  const researcherPaperLinks = buildResearcherPaperLinkIndex(content);
  const allocation = planGpuPortfolio(state, content, labId).allocation;
  const delivered = calculateAllocationTeraflops(state, content, labId, allocation);
  const projectPrograms = (
    kind: "capability" | "safety",
  ): readonly ResearchProgramView[] => {
    const definitions =
      kind === "capability"
        ? content.research.capabilityDomains
        : content.research.safetyPrograms;
    const states =
      kind === "capability" ? lab.research.domains : lab.research.safetyPrograms;
    return Object.values(definitions).map((definition) => {
      const programme = states[definition.id];
      if (programme === undefined)
        throw new Error(`Missing research state ${definition.id}`);
      const effectiveTeraflops =
        (kind === "capability"
          ? delivered.capabilityPrograms[definition.id]
          : delivered.safetyPrograms[definition.id]) ?? 0;
      const isFunded =
        effectiveTeraflops >= MINIMUM_FUNDED_PROGRAM_TERAFLOPS ||
        (effectiveTeraflops > 0 && content.research.rules.unfundedDomainsProduceProgress);
      const momentumLabel: ResearchProgramView["momentumLabel"] = !isFunded
        ? "Unfunded"
        : programme.weeklyMomentum < 1
          ? "Speculative"
          : programme.weeklyMomentum < 3
            ? "Promising"
            : programme.weeklyMomentum < 6
              ? "Hot trail"
              : "Breakthrough imminent";
      const outputBonus = calculateResearchOutputModifier(
        state,
        content,
        labId,
        definition.id,
      );
      return {
        programId: definition.id,
        kind,
        name: definition.name,
        shortName: definition.shortName,
        colour: definition.colour,
        level: programme.level,
        weeklyMomentum: programme.weeklyMomentum,
        momentumLabel,
        effectiveTeraflops,
        isFunded,
        allocationLabel: formatTeraflops(effectiveTeraflops),
        researchOutputMultiplier: outputBonus.outputModifier,
        outputLedger: projectResearchOutputLedger(state, content, outputBonus),
        assignedResearcherPercentagePoints:
          outputBonus.assignedResearcherPercentagePoints,
        diffusion: (() => {
          const breakdown = outputBonus.diffusion;
          const contributors = [...breakdown.contributors]
            .sort((left, right) => right.percentagePoints - left.percentagePoints)
            .map((entry) => {
              const researcher = state.researchers[entry.researcherId as ResearcherId];
              const name =
                researcher === undefined
                  ? entry.researcherId
                  : (content.researchers.definitions[researcher.definitionId]
                      ?.displayName ?? entry.researcherId);
              return {
                name,
                skill: entry.skill,
                percentagePoints: entry.percentagePoints,
              };
            });
          return {
            percentagePoints: breakdown.percentagePoints,
            ratePerSkillPoint: breakdown.ratePerSkillPoint,
            label:
              breakdown.ratePerSkillPoint <= 0
                ? "No knowledge diffusion yet — build collaboration space"
                : `+${breakdown.percentagePoints.toFixed(1)}% from ${String(contributors.length)} researcher${contributors.length === 1 ? "" : "s"} not leading it`,
            contributors,
          };
        })(),
      };
    });
  };
  const capabilityDomains = projectPrograms("capability");
  const safetyPrograms = projectPrograms("safety");
  const programmes = [...capabilityDomains, ...safetyPrograms];
  const phaseRank = {
    foundation: 0,
    scaling: 1,
    frontier: 2,
    crisis: 3,
  } as const;
  const paperRequirementLabels = (
    predicate: PaperPrerequisitePredicate,
    hiddenBreakthrough?: {
      readonly programmeId: ContentId;
      readonly level: number;
    },
  ): readonly { readonly label: string; readonly met: boolean }[] => {
    switch (predicate.kind) {
      case "all":
        return predicate.items.flatMap((item) =>
          paperRequirementLabels(item, hiddenBreakthrough),
        );
      case "any": {
        const alternatives = predicate.items.flatMap((item) =>
          paperRequirementLabels(item, hiddenBreakthrough),
        );
        return [
          {
            label: `Any one: ${alternatives.map((item) => item.label).join(" or ")}`,
            met: alternatives.some((item) => item.met),
          },
        ];
      }
      case "paper-known": {
        const paper = content.papers.definitions[predicate.paperId];
        return [
          {
            label: paper?.title ?? humanizeIdentifier(predicate.paperId),
            met: labKnowsPaper(state, labId, predicate.paperId),
          },
        ];
      }
      case "domain-level": {
        if (
          predicate.domainId === hiddenBreakthrough?.programmeId &&
          predicate.minimumLevel === hiddenBreakthrough.level
        ) {
          return [];
        }
        const programme =
          content.research.capabilityDomains[predicate.domainId] ??
          content.research.safetyPrograms[predicate.domainId];
        const programmeState =
          lab.research.domains[predicate.domainId] ??
          lab.research.safetyPrograms[predicate.domainId];
        return [
          {
            label: `${programme?.shortName ?? humanizeIdentifier(predicate.domainId)} level ${String(predicate.minimumLevel)}`,
            met: (programmeState?.level ?? 0) >= predicate.minimumLevel,
          },
        ];
      }
      case "facility-complete": {
        const facility = content.facilities[predicate.facilityId];
        return [
          {
            label:
              facility?.displayName ?? fallbackFacilityDisplayName(predicate.facilityId),
            met: lab.facilities.instances.some(
              (instance) => instance.definitionId === predicate.facilityId,
            ),
          },
        ];
      }
      case "phase-at-least":
        return [
          {
            label: `${humanizeIdentifier(predicate.phase)} era`,
            met: phaseRank[state.run.phase] >= phaseRank[predicate.phase],
          },
        ];
    }
  };
  const techTreeProgrammes: ResearchView["techTree"]["programmes"] = programmes.map(
    (programme) => {
      const definition =
        content.research.capabilityDomains[programme.programId] ??
        content.research.safetyPrograms[programme.programId];
      if (definition === undefined)
        throw new Error(`Unknown programme ${programme.programId}`);
      const selectedOptionIds = lab.research.genericAdvances[programme.programId] ?? [];
      const nextThreshold = content.research.rules.genericAdvanceThresholds.find(
        (threshold) =>
          threshold > programme.level &&
          !lab.research.pendingGenericAdvances.some(
            (pending) =>
              pending.programId === programme.programId &&
              pending.threshold === threshold,
          ),
      );
      return {
        programId: programme.programId,
        kind: programme.kind,
        name: programme.name,
        shortName: programme.shortName,
        description:
          SAFETY_PROGRAMME_PLAYER_DESCRIPTIONS[programme.programId] ??
          definition.description,
        colour: programme.colour,
        level: programme.level,
        momentumLabel: programme.momentumLabel,
        diffusion: programme.diffusion,
        allocationLabel: programme.allocationLabel,
        researchOutputMultiplier: programme.researchOutputMultiplier,
        outputLedger: programme.outputLedger,
        assignedResearcherPercentagePoints: programme.assignedResearcherPercentagePoints,
        milestones: content.research.rules.genericAdvanceThresholds.map((threshold) => {
          const optionIds = definition.genericAdvanceOptionIds[String(threshold)] ?? [];
          const selectedOptionId = selectedOptionIds.find(
            (optionId) =>
              content.research.genericAdvances[optionId]?.threshold === threshold,
          );
          const pending = lab.research.pendingGenericAdvances.find(
            (candidate) =>
              candidate.programId === programme.programId &&
              candidate.threshold === threshold,
          );
          const status: ResearchView["techTree"]["programmes"][number]["milestones"][number]["status"] =
            selectedOptionId !== undefined
              ? "chosen"
              : pending !== undefined
                ? "decision"
                : threshold === nextThreshold
                  ? "next"
                  : "locked";
          return {
            threshold,
            status,
            options: optionIds.map((optionId) => {
              const option = content.research.genericAdvances[optionId];
              if (option === undefined) throw new Error(`Unknown advance ${optionId}`);
              return {
                optionId,
                name: option.name,
                description: option.description,
                effectLabels: option.effects.map(researchAdvanceEffectLabel),
                status:
                  selectedOptionId === optionId
                    ? "chosen"
                    : selectedOptionId !== undefined
                      ? "closed"
                      : pending !== undefined
                        ? "available"
                        : "preview",
              };
            }),
          };
        }),
      };
    },
  );
  const techTreePapers: ResearchView["techTree"]["papers"] = Object.values(
    content.papers.definitions,
  )
    .sort(
      (left, right) => left.gameOrder - right.gameOrder || (left.id < right.id ? -1 : 1),
    )
    .map((paper) => {
      const domainIds = Object.entries(paper.domainWeights)
        .sort(
          ([leftId, leftWeight], [rightId, rightWeight]) =>
            rightWeight - leftWeight || (leftId < rightId ? -1 : 1),
        )
        .map(([domainId]) => domainId);
      const primaryDomainId = domainIds[0];
      if (primaryDomainId === undefined) {
        throw new Error(`Paper ${paper.id} has no research domain`);
      }
      const primaryDomain =
        content.research.capabilityDomains[primaryDomainId] ??
        content.research.safetyPrograms[primaryDomainId];
      if (primaryDomain === undefined) {
        throw new Error(
          `Paper ${paper.id} has unknown research programme ${primaryDomainId}`,
        );
      }
      const requirements = paperRequirementLabels(
        paper.prerequisites,
        paper.breakthroughRequirement,
      );
      const requirementsMet = requirements.every((requirement) => requirement.met);
      const playerDiscovered = lab.research.discoveredPaperIds.includes(paper.id);
      const worldDiscovery = state.world.paperRace.discoveries[paper.id];
      const publiclyKnown =
        worldDiscovery !== undefined && isPublicPaperDiscovery(worldDiscovery);
      const rivalClaimed =
        worldDiscovery !== undefined && worldDiscovery.discovererLabId !== labId;
      const status: ResearchView["techTree"]["papers"][number]["status"] =
        playerDiscovered
          ? "discovered"
          : publiclyKnown
            ? "published"
            : requirementsMet
              ? rivalClaimed
                ? "rediscovery"
                : "available"
              : "locked";
      const visibleWorldDiscovery =
        worldDiscovery !== undefined &&
        (publiclyKnown ||
          playerDiscovered ||
          worldDiscovery.discovererLabId === state.run.playerLabId)
          ? worldDiscovery
          : undefined;
      const worldFirstLab =
        visibleWorldDiscovery === undefined
          ? undefined
          : state.labs[visibleWorldDiscovery.discovererLabId as LabId];
      const worldFirstLabName =
        worldFirstLab === undefined
          ? undefined
          : content.labs[worldFirstLab.definitionId]?.displayName;
      return {
        paperId: paper.id,
        title: paper.title,
        historicity: paper.historicity,
        ...(paper.primarySourceUrl === undefined
          ? {}
          : { primarySourceUrl: paper.primarySourceUrl }),
        phase: content.papers.graph.earliestReachablePhase[paper.id] ?? "foundation",
        gameOrder: paper.gameOrder,
        domainIds,
        primaryDomainId,
        primaryDomainName: primaryDomain.shortName,
        colour: primaryDomain.colour,
        status,
        statusLabel:
          status === "discovered"
            ? "Discovered"
            : status === "published"
              ? "Public knowledge"
              : status === "available"
                ? "Available to pursue"
                : status === "rediscovery"
                  ? "Rediscovery available"
                  : "Prerequisites unmet",
        requirementLabels: requirements,
        prerequisitePaperIds: content.papers.graph.prerequisiteAdjacency[paper.id] ?? [],
        archiveExplanation: paper.education.archiveExplanation,
        unlockLabels: paperMechanicalBenefits(paper).map(describePaperUnlockEffect),
        realWorldResearcherCredits:
          researcherPaperLinks.researchersByPaperId[paper.id] ?? [],
        ...(worldFirstLabName === undefined ? {} : { worldFirstLabName }),
      };
    });
  return {
    capabilityDomains,
    safetyPrograms,
    techTree: {
      programmes: techTreeProgrammes,
      papers: techTreePapers,
    },
    pendingGenericAdvances: lab.research.pendingGenericAdvances.map((pending) => {
      const program =
        content.research.capabilityDomains[pending.programId] ??
        content.research.safetyPrograms[pending.programId];
      if (program === undefined)
        throw new Error(`Unknown programme ${pending.programId}`);
      return {
        programId: pending.programId,
        programName: program.name,
        threshold: pending.threshold,
        options: pending.optionIds.map((optionId) => {
          const option = content.research.genericAdvances[optionId];
          if (option === undefined)
            throw new Error(`Unknown generic advance ${optionId}`);
          return {
            optionId,
            name: option.name,
            description: option.description,
            effectLabels: option.effects.map(researchAdvanceEffectLabel),
          };
        }),
      };
    }),
    discoveredPaperIds: [...lab.research.discoveredPaperIds],
    pendingPublicationPaperIds: Object.values(state.world.paperRace.discoveries)
      .filter(
        (discovery) =>
          discovery.discovererLabId === labId &&
          discovery.publicationPolicy === undefined,
      )
      .map((discovery) => discovery.paperId),
    diffusionKnowledge: Object.entries(lab.research.diffusionKnowledge).map(
      ([paperId, diffusion]) => ({ paperId, diffusion }),
    ),
    papers: Object.values(state.world.paperRace.discoveries)
      .filter(
        (discovery) =>
          isPublicPaperDiscovery(discovery) ||
          discovery.discovererLabId === labId ||
          lab.research.discoveredPaperIds.includes(discovery.paperId),
      )
      .map((discovery): ResearchPaperView | undefined => {
        const paper = content.papers.definitions[discovery.paperId];
        if (paper === undefined) return undefined;
        const sourceDomain = (() => {
          if (paper.primarySourceUrl === undefined) return undefined;
          try {
            return new URL(paper.primarySourceUrl).hostname;
          } catch {
            return undefined;
          }
        })();
        const discovererLab = state.labs[discovery.discovererLabId as LabId];
        const discovererLabName =
          discovererLab === undefined
            ? "Rival lab"
            : (content.labs[discovererLab.definitionId]?.displayName ?? "Rival lab");
        const playerWorldFirst = discovery.discovererLabId === state.run.playerLabId;
        const playerHasDiscovered = lab.research.discoveredPaperIds.includes(paper.id);
        const playerKnows = labKnowsPaper(state, labId, paper.id);
        const playerPaperScoreEntries = state.score.entries.filter(
          (entry) =>
            entry.key ===
              `paper/${playerWorldFirst ? "world-first" : "rediscovery"}/${paper.id}` ||
            entry.key.startsWith(`paper/publication/${paper.id}/`),
        );
        const playerDiscoveryScoreAward = playerPaperScoreEntries.reduce(
          (sum, entry) => sum + entry.amount,
          0,
        );
        const playerDiscoveryAtTick = playerPaperScoreEntries.at(0)?.tick;
        const auraAward = lab.aura.ledger
          .filter(
            (entry) =>
              entry.category === "paper" &&
              entry.source.id === paper.id &&
              entry.appliedDelta > 0,
          )
          .reduce((sum, entry) => sum + entry.appliedDelta, 0);
        return {
          paperId: paper.id,
          title: paper.title,
          historicity: paper.historicity,
          ...(paper.fictionalLabel === undefined
            ? {}
            : { fictionalLabel: paper.fictionalLabel }),
          authors: [...paper.authors],
          ...(paper.publicationYear === undefined
            ? {}
            : { publicationYear: paper.publicationYear }),
          ...(paper.venue === undefined ? {} : { venue: paper.venue }),
          ...(paper.primarySourceUrl === undefined
            ? {}
            : { primarySourceUrl: paper.primarySourceUrl }),
          ...(sourceDomain === undefined ? {} : { sourceDomain }),
          playerSummary: paper.education.playerSummary,
          archiveExplanation: paper.education.archiveExplanation,
          insideBaseball: paper.education.insideBaseball,
          discoveredAtTick: discovery.discoveredAt,
          discovererLabId: discovery.discovererLabId,
          discovererLabName,
          worldFirst: playerWorldFirst,
          playerHasDiscovered,
          playerKnowsPaper: playerKnows,
          knowledgeSource: playerWorldFirst
            ? "world-first"
            : playerHasDiscovered
              ? "rediscovery"
              : "publication",
          ...(playerPaperScoreEntries.length === 0
            ? {}
            : {
                discoveryScoreAward: playerDiscoveryScoreAward,
                ...(playerDiscoveryAtTick === undefined
                  ? {}
                  : { playerDiscoveredAtTick: playerDiscoveryAtTick }),
              }),
          ...(playerWorldFirst ? { baseAuraAward: paper.discovery.worldFirstAura } : {}),
          ...(playerWorldFirst && discovery.publicationPolicy === undefined
            ? {
                publicationScoreAward: calculatePaperPublicationScore(
                  content,
                  paper,
                  "publish-openly",
                ),
              }
            : {}),
          ...(auraAward <= 0 ? {} : { auraAward }),
          unlockLabels: paperMechanicalBenefits(
            paper,
            isPublicPaperDiscovery(discovery) ? "public" : "private",
          ).map(describePaperUnlockEffect),
          realWorldResearcherCredits:
            researcherPaperLinks.researchersByPaperId[paper.id] ?? [],
          ...(discovery.publicationPolicy === undefined
            ? {}
            : { publicationPolicy: discovery.publicationPolicy }),
        };
      })
      .filter((paper): paper is ResearchPaperView => paper !== undefined)
      .sort((left, right) => right.discoveredAtTick - left.discoveredAtTick),
  };
}

function labelTarget(target: string): string {
  return target
    .replace("true-", "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function researchAdvanceEffectLabel(
  effect: CompiledContent["research"]["genericAdvances"][string]["effects"][number],
): string {
  const programmeMatch =
    /^lab\.research\.program\.base:(?:domain|safety)\.(.+)\.output$/.exec(effect.target);
  const target =
    programmeMatch?.[1] === undefined
      ? ({
          "lab.compute.workloadThroughput": "Effective GPU throughput",
          "lab.evidence.displayedQuality": "Evaluation evidence quality",
          "lab.incident.hazard": "Incident risk",
          "lab.research.alignment.output": "Alignment research speed",
          "lab.research.all.output": "All research speed",
          "lab.research.capability.output": "Capability research speed",
          "lab.research.interpretability.output":
            "Interpretability and evals research speed",
          "lab.research.security.output": "Security and containment research speed",
        }[effect.target] ?? humanizeIdentifier(effect.target.replace(/^lab\./, "")))
      : `${humanizeIdentifier(programmeMatch[1])} research speed`;
  if (typeof effect.value !== "number") return `${target} updated`;
  if (effect.operation === "multiply") {
    const percentage = (effect.value - 1) * 100;
    return `${target} ${percentage >= 0 ? "+" : "−"}${formatDecimal(Math.abs(percentage))}%`;
  }
  if (effect.operation === "add") {
    return `${target} ${effect.value >= 0 ? "+" : "−"}${formatDecimal(Math.abs(effect.value))}`;
  }
  return `${target} ${effect.operation === "min" ? "cap" : "floor"} ${formatDecimal(effect.value)}`;
}

function nominalCapabilityTierForEstimate(
  content: CompiledContent,
  capability: number,
): { readonly level: number; readonly name: string } {
  const ordered = content.capabilityTiers.orderedIds
    .map((id) => content.capabilityTiers.definitions[id])
    .filter((tier) => tier !== undefined)
    .sort((left, right) => left.level - right.level);
  const selected =
    [...ordered]
      .reverse()
      .find((tier) => capability >= tier.nominalFrontierCapability.min) ?? ordered[0];
  if (selected === undefined) {
    throw new Error("Capability tier content is empty");
  }
  return { level: selected.level, name: selected.name };
}

function projectModels(
  state: Readonly<GameState>,
  content: CompiledContent,
  context: PlayerKnowledgeContext,
): ModelsView {
  const lab = requireLab(state, context.viewerLabId);
  const storedSuccessorEfficiency = lab.flags["endgame:successor-efficiency-rate"];
  const commercialModelId = resolveCommercialModelId(state, context.viewerLabId);
  const accessibleEvaluations = new Set(context.evidenceAccess.evaluationIds);
  const accessibleAnomalies = new Set(context.evidenceAccess.anomalyIds);
  const evaluationLadder = Object.values(content.evaluations.definitions)
    .filter((definition) => definition.playerStartable)
    .sort((left, right) => left.ladderRung - right.ladderRung);
  const activeTrainingProject = Object.values(state.projects)
    .filter(
      (project) =>
        project.ownerLabId === context.viewerLabId &&
        project.payload.kind === "training" &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  const parentModelId = lab.models.currentModelId ?? lab.models.modelIds.at(-1);
  const defaultTrainingQuote =
    activeTrainingProject === undefined
      ? quoteTrainingRun(state, content, {
          labId: context.viewerLabId,
          ...(parentModelId === undefined ? {} : { parentModelId }),
          posture: "normal",
        })
      : undefined;
  const activeTrainingForecast =
    activeTrainingProject === undefined
      ? undefined
      : forecastActiveTrainingFrontierCapability(state, content, activeTrainingProject);
  const forecastRange =
    activeTrainingForecast === undefined
      ? defaultTrainingQuote?.estimatedFrontierCapabilityRange
      : ([activeTrainingForecast.low, activeTrainingForecast.high] as const);
  const forecastExpected =
    activeTrainingForecast?.expected ?? defaultTrainingQuote?.estimatedFrontierCapability;
  if (forecastRange === undefined || forecastExpected === undefined) {
    throw new Error("Training forecast could not be projected");
  }
  const currentModel =
    parentModelId === undefined ? undefined : state.models[parentModelId];
  const currentMeasuredCapability = currentModel?.measuredCapability?.frontierCapability;
  const trainingForecast: ModelsView["trainingForecast"] = {
    source:
      activeTrainingProject === undefined ? "default-if-started-today" : "active-run",
    estimatedFrontierCapability: forecastExpected,
    estimatedFrontierCapabilityRange: forecastRange,
    nominalTierBand: {
      low: nominalCapabilityTierForEstimate(content, forecastRange[0]),
      expected: nominalCapabilityTierForEstimate(content, forecastExpected),
      high: nominalCapabilityTierForEstimate(content, forecastRange[1]),
    },
    durationWeeks:
      activeTrainingForecast?.plannedDurationWeeks ??
      defaultTrainingQuote?.durationWeeks ??
      0,
    committedTeraflops:
      activeTrainingProject?.payload.kind === "training"
        ? activeTrainingProject.payload.committedTeraflops
        : (defaultTrainingQuote?.committedTeraflops ?? 0),
    projectedTotalFlop:
      activeTrainingForecast?.projectedTotalFlop ??
      defaultTrainingQuote?.estimatedTotalFlop ??
      0,
    postureLabel:
      activeTrainingProject?.payload.kind === "training"
        ? trainingPostureDefinition(activeTrainingProject.payload.posture).displayName
        : trainingPostureDefinition("normal").displayName,
    runClassLabel:
      activeTrainingProject?.payload.kind === "training"
        ? (content.training.scales[activeTrainingProject.payload.scale]?.displayName ??
          "Training run")
        : (defaultTrainingQuote?.displayName ?? "Training run"),
    canStart:
      activeTrainingProject !== undefined || defaultTrainingQuote?.blockers.length === 0,
    blockers:
      activeTrainingProject === undefined ? (defaultTrainingQuote?.blockers ?? []) : [],
    ...(currentModel === undefined || currentMeasuredCapability === undefined
      ? {}
      : {
          currentModelComparison: {
            modelId: currentModel.id,
            displayName: currentModel.displayName,
            measuredFrontierCapability: currentMeasuredCapability,
            estimatedDeltaRange: [
              forecastRange[0] - currentMeasuredCapability,
              forecastRange[1] - currentMeasuredCapability,
            ],
          },
        }),
  };
  const cards = lab.models.modelIds.map((modelId): ModelCardView => {
    const model = state.models[modelId];
    if (model === undefined) throw new Error(`Missing model ${modelId}`);
    const tier = classifyCapabilityTier(state, content, modelId);
    const evaluations = model.evaluations
      .filter((id) => accessibleEvaluations.has(id))
      .map((id, evaluationPosition): EvaluationReportView => {
        const evaluation = state.evaluations[id];
        if (evaluation === undefined) throw new Error(`Missing evaluation ${id}`);
        const definition = content.evaluations.definitions[evaluation.definitionId];
        if (definition === undefined) {
          throw new Error(`Missing evaluation definition ${evaluation.definitionId}`);
        }
        const modelEvaluationPosition = model.evaluations.indexOf(id);
        const priorProgrammeReports = model.evaluations
          .slice(
            0,
            modelEvaluationPosition < 0 ? evaluationPosition : modelEvaluationPosition,
          )
          .filter((candidateId) => {
            const candidate = state.evaluations[candidateId];
            const candidateDefinition =
              candidate === undefined
                ? undefined
                : content.evaluations.definitions[candidate.definitionId];
            return candidateDefinition?.programme === definition.programme;
          }).length;
        const outcome =
          evaluation.anomalyIds.length > 0
            ? "concerning-finding"
            : evaluation.observations.some(
                  (observation) =>
                    observation.confidence === "poor" ||
                    observation.confidence === "limited",
                )
              ? "inconclusive"
              : "clean-evidence";
        return {
          evaluationId: evaluation.id,
          definitionId: evaluation.definitionId,
          displayName: definition.displayName,
          programme: definition.programme,
          outcome,
          safetyCaseGain: safetyCaseGainForProgramme(
            definition.programme,
            priorProgrammeReports,
          ),
          safetyPracticeGain: evaluation.practiceXpGranted ?? 0,
          completedAtTick: evaluation.completedAt,
          repeatIndex: evaluation.repeatIndex,
          independence: evaluation.independence,
          observations: evaluation.observations.map((observation) => ({
            target: observation.target,
            targetLabel: labelTarget(observation.target),
            estimate: observation.estimate,
            confidence: observation.confidence,
            ...(observation.alignmentLabel === undefined
              ? {}
              : { alignmentLabel: labelTarget(observation.alignmentLabel) }),
          })),
          anomalyCount: evaluation.anomalyIds.length,
        };
      });
    const anomalies = model.anomalies
      .filter((id) => accessibleAnomalies.has(id))
      .map((id): AnomalyView => {
        const anomaly = state.anomalies[id];
        if (anomaly === undefined) throw new Error(`Missing anomaly ${id}`);
        const quote = quoteAnomalyAction(state, content, anomaly.id);
        const anomalyProjects = Object.values(state.projects)
          .filter(
            (project) =>
              project.payload.kind === "anomaly-investigation" &&
              project.payload.anomalyId === anomaly.id,
          )
          .sort(
            (left, right) =>
              right.createdAt - left.createdAt ||
              right.completionOrder - left.completionOrder,
          );
        const actionProject = anomalyProjects.find(
          (project) =>
            project.status === "queued" ||
            project.status === "active" ||
            project.status === "paused",
        );
        const recordedProject =
          anomaly.status === "investigating" ||
          anomaly.status === "mitigating" ||
          anomaly.status === "inconclusive" ||
          anomaly.status === "resolved" ||
          anomaly.status === "mitigated"
            ? anomalyProjects[0]
            : undefined;
        const investigationDueAt =
          anomaly.investigationDueAt ??
          (actionProject?.startedAt === undefined
            ? undefined
            : actionProject.startedAt + actionProject.expectedDurationWeeks);
        return {
          anomalyId: anomaly.id,
          sourceEvaluationId: anomaly.sourceEvaluationId,
          underlyingCase: anomaly.underlyingCase,
          observationCount: anomaly.observationCount,
          createdAtTick: anomaly.createdAt,
          observedSeverity: anomaly.observedSeverity,
          severityLabel: quote.severityLabel,
          status: anomaly.status,
          investigationAttempts: anomaly.investigationAttempts ?? 0,
          ...(investigationDueAt === undefined
            ? {}
            : { investigationDueAtTick: investigationDueAt }),
          ...(actionProject === undefined ||
          (actionProject.status !== "queued" &&
            actionProject.status !== "active" &&
            actionProject.status !== "paused")
            ? {}
            : { actionProjectStatus: actionProject.status }),
          actionQuote: {
            cashCostMillions:
              recordedProject?.payload.kind === "anomaly-investigation"
                ? recordedProject.payload.cashCostMillions
                : quote.cashCostMillions,
            auraCost:
              recordedProject?.payload.kind === "anomaly-investigation"
                ? recordedProject.payload.auraCost
                : quote.auraCost,
            durationWeeks:
              recordedProject?.payload.kind === "anomaly-investigation"
                ? recordedProject.expectedDurationWeeks
                : quote.durationWeeks,
            majorProjectSlots: quote.majorProjectSlots,
            mitigationControlBonus: quote.mitigationControlBonus,
            mitigationSecurityBonus: quote.mitigationSecurityBonus,
          },
        };
      });
    const evidence = model.measuredCapability;
    const deployment = content.deployment.policies[model.deployment.policy];
    const readout = modelSafetyReadout(state, model.id);
    const safetyRowMeta: Record<
      SafetyTarget,
      { label: string; direction: "higher-is-better" | "lower-is-better" }
    > = {
      "true-alignment": { label: "Alignment", direction: "higher-is-better" },
      corrigibility: { label: "Corrigibility", direction: "higher-is-better" },
      "situational-awareness": {
        label: "Situational awareness",
        direction: "lower-is-better",
      },
      "deceptive-capability": {
        label: "Deceptive intent",
        direction: "lower-is-better",
      },
    };
    return {
      modelId: model.id,
      displayName: model.displayName,
      generationIndex: model.generationIndex,
      trainedAtTick: model.trainedAt,
      isCurrentModel: lab.models.currentModelId === model.id,
      isCommercialModel: commercialModelId === model.id,
      trainingParentEligible:
        model.flags["endgame:false-dawn-long-pause-archive"] !== true,
      promotionStatus:
        model.flags["training:promotion-status"] === "underperformed"
          ? "underperformed"
          : model.flags["training:promotion-status"] === "promoted"
            ? "promoted"
            : "legacy",
      capability: { ...(evidence?.values ?? {}) },
      frontierCapabilityEstimate: evidence?.frontierCapability ?? 0,
      investedTotalFlop: model.investedTotalFlop ?? 0,
      capabilityConfidence: evidence?.confidence ?? "low",
      productQuality: model.productQuality,
      reliability: model.reliability,
      accessLevel: model.accessLevel,
      tier: {
        level: tier.level,
        name: tier.name,
        progressLabel: tier.progressToNextTier.replaceAll("-", " "),
      },
      evaluationCommitments: Object.fromEntries(
        Object.values(content.evaluations.definitions)
          .filter((definition) => definition.playerStartable)
          .map((definition) => {
            const quote = quoteEvaluation(state, content, {
              labId: lab.id,
              modelId: model.id,
              definitionId: definition.id,
            });
            return [
              definition.id,
              {
                totalFlopLabel:
                  quote.totalFlop > 0 ? formatTotalFlop(quote.totalFlop) : "no compute",
                durationWeeks: quote.durationWeeks,
                cashCostMillions: quote.cashCostMillions,
                auraCost: quote.auraCost,
                pacingOptions: quote.pacingOptions.map((option) => ({
                  durationWeeks: option.durationWeeks,
                  requiredTeraflops: option.requiredTeraflops,
                  requiredTeraflopsLabel: formatTeraflops(option.requiredTeraflops),
                  availableTeraflops: option.availableTeraflops,
                  availableTeraflopsLabel: formatTeraflops(option.availableTeraflops),
                  remainingTeraflops: option.remainingTeraflops,
                  remainingTeraflopsLabel: formatTeraflops(option.remainingTeraflops),
                  feasible: option.feasible,
                  includesPrerequisiteRelease: option.includesPrerequisiteRelease,
                })),
              },
            ];
          }),
      ),
      safetyReadout: {
        rows: SAFETY_TARGETS.map((target) => {
          const reading = readout.targets[target];
          const direction = safetyRowMeta[target].direction;
          const firstEvaluation = evaluationLadder.find((definition) =>
            definition.targets.includes(target),
          );
          const tone =
            reading === undefined
              ? "unknown"
              : direction === "higher-is-better"
                ? reading.maximum < 40
                  ? "alarm"
                  : reading.minimum < 60
                    ? "uneasy"
                    : "quiet"
                : reading.minimum > 60
                  ? "alarm"
                  : reading.maximum > 35
                    ? "uneasy"
                    : "quiet";
          return {
            target,
            label: safetyRowMeta[target].label,
            direction,
            evaluated: reading !== undefined,
            tone,
            ...(firstEvaluation === undefined
              ? {}
              : {
                  firstEvaluation: {
                    displayName: firstEvaluation.displayName,
                    ladderStep: firstEvaluation.ladderRung,
                    ladderLength: evaluationLadder.length,
                  },
                }),
            ...(reading === undefined
              ? {}
              : {
                  minimum: Math.round(reading.minimum),
                  maximum: Math.round(reading.maximum),
                }),
          };
        }),
        safetyReportCount: readout.safetyReportCount,
        automaticBaselineComplete: readout.automaticBaselineComplete,
        independentCount: readout.independentCount,
        anomaliesDismissed: readout.anomaliesDismissed,
      },
      safetyCase: calculateModelSafetyCase(state, content, model.id),
      safetyAssessment: derivePlayerSafetyAssessment({
        findings: SAFETY_TARGETS.map((target) => {
          const reading = readout.targets[target];
          return {
            target,
            ...(reading === undefined
              ? {}
              : { minimum: reading.minimum, maximum: reading.maximum }),
          };
        }),
        practicalControl: effectivePracticalControlStrength(state, lab.id),
        securityPosture: effectiveSecurityPosture(state, lab.id),
        safetyCulture: lab.safety.safetyCulture,
        effectiveEvaluationQuality: effectiveEvaluationQuality(state, lab.id),
        reportCount: readout.safetyReportCount,
        independentReportCount: readout.independentCount,
        accessLevel: model.accessLevel,
        deploymentLabel: deployment.displayName,
        exposurePercent:
          model.deployment.exposure * model.deployment.exposureMultiplier * 100,
      }),
      deployment: {
        policy: model.deployment.policy,
        ...(model.deployment.plannedPolicy === undefined
          ? {}
          : {
              plannedPolicy: model.deployment.plannedPolicy,
              plannedDisplayName:
                content.deployment.policies[model.deployment.plannedPolicy].displayName,
              plannedExposure:
                content.deployment.policies[model.deployment.plannedPolicy].exposure *
                model.deployment.exposureMultiplier,
            }),
        displayName: deployment.displayName,
        exposure: model.deployment.exposure,
        exposureMultiplier: model.deployment.exposureMultiplier,
        irreversible: model.deployment.irreversible,
        evidencePenalty: model.deployment.evidencePenalty,
        productisationRuns: { ...model.deployment.productisationRuns },
        auraPreviewByPolicy: Object.fromEntries(
          (Object.keys(content.deployment.policies) as readonly DeploymentPolicy[]).map(
            (policy) => {
              const preview = quoteDeploymentAura(state, content, model.id, policy);
              return [
                policy,
                {
                  auraAward: preview.auraAward,
                  firstPublicLaunch: preview.firstPublicLaunch,
                  firstWeightsRelease: preview.firstWeightsRelease,
                },
              ];
            },
          ),
        ) as ModelCardView["deployment"]["auraPreviewByPolicy"],
      },
      evaluations,
      anomalies,
    };
  });
  const practice = safetyPracticeProfile(lab.safety.practiceXp ?? 0);
  const containmentCapacity = candidateContainmentCapacity(state, lab.id);
  const cooldownUntil = candidateDeclarationCooldownUntil(state, lab.id);
  const cooldownRemaining = candidateDeclarationCooldownRemaining(state, lab.id);
  const declarationCooldown =
    cooldownUntil !== undefined && cooldownRemaining > 0
      ? { untilTick: cooldownUntil, remainingWeeks: cooldownRemaining }
      : undefined;
  const candidateCustody: ModelsView["candidateCustody"] = {
    usedContainment: Math.round(containmentCapacity.used * 10) / 10,
    maximumContainment: Math.round(containmentCapacity.maximum * 10) / 10,
    overloaded: containmentCapacity.overload > 0,
    overload: Math.round(containmentCapacity.overload * 10) / 10,
    ...(declarationCooldown === undefined ? {} : { declarationCooldown }),
    artifacts: lab.models.modelIds
      .map((modelId) => state.models[modelId])
      .filter((model): model is ModelState => model?.candidateArtifact !== undefined)
      .sort(
        (left, right) =>
          right.trainedAt - left.trainedAt ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((model) => {
        const artifact = model.candidateArtifact;
        if (artifact === undefined)
          throw new Error(`Candidate artifact ${model.id} vanished`);
        const lineage = state.lineageSIRecords[model.lineageId];
        if (lineage === undefined) {
          throw new Error(`Candidate artifact ${model.id} lacks its lineage prior`);
        }
        const falseDawn = model.flags["endgame:false-dawn"] === true;
        const sealedAfterFalseDawn =
          model.flags["endgame:false-dawn-long-pause-archive"] === true;
        const lifecycleLabel = sealedAfterFalseDawn
          ? "Near-AGI · verified sealed archive"
          : falseDawn
            ? "Near-AGI · candidacy retired"
            : artifact.lifecycle
                .replaceAll("-", " ")
                .replace(/^./, (letter) => letter.toUpperCase());
        const isolated =
          model.accessLevel === 0 &&
          model.deployment.policy === "internal-only" &&
          artifact.lifecycle !== "escaped" &&
          artifact.lifecycle !== "deployed";
        const custodyLabel = sealedAfterFalseDawn
          ? "Long Pause attempt · archive remains sealed"
          : falseDawn
            ? "False Dawn · regular model remains available"
            : artifact.lifecycle === "verified-destroyed"
              ? artifact.archiveDisposition === "filtered-technical-note"
                ? "Weights destroyed · filtered technical note retained"
                : "Weights independently destroyed"
              : artifact.lifecycle === "verified-isolated-archive"
                ? "Verified isolated archive"
                : artifact.lifecycle === "escaped"
                  ? "Custody lost"
                  : artifact.lifecycle === "retirement-attempt"
                    ? "Retirement command in progress"
                    : isolated
                      ? "Active weights · isolated"
                      : "Active weights · exposed";
        const unresolvedAnomalyCount = model.anomalies
          .filter((id) => accessibleAnomalies.has(id))
          .map((id) => state.anomalies[id])
          .filter(
            (anomaly) =>
              anomaly !== undefined &&
              anomaly.status !== "resolved" &&
              anomaly.status !== "mitigated" &&
              anomaly.status !== "dismissed",
          ).length;
        const dismissedAnomalyCount = model.anomalies
          .filter((id) => accessibleAnomalies.has(id))
          .map((id) => state.anomalies[id])
          .filter((anomaly) => anomaly?.status === "dismissed").length;
        const legalActions: ModelsView["candidateCustody"]["artifacts"][number]["legalActions"][number][] =
          ["inspect"];
        if (
          artifact.lifecycle !== "verified-destroyed" &&
          artifact.lifecycle !== "terminal"
        ) {
          legalActions.push("evaluate");
        }
        if (quoteCandidateIsolation(state, model.id).blockers.length === 0) {
          legalActions.push("isolate");
        }
        const incidentReview =
          artifact.activeIncident?.status === "unresolved"
            ? quoteCandidateIncidentReview(state, model.id)
            : undefined;
        const lastReviewedIncident = artifact.incidentHistory.at(-1);
        if (incidentReview?.blockers.length === 0) {
          legalActions.push("review-incident");
        }
        const retirementAvailable =
          quoteCandidateRetirement(
            state,
            model.id,
            "staged-isolated-shutdown",
            "destroy-all-weights",
          ).blockers.length === 0;
        if (retirementAvailable) {
          legalActions.push("retire");
        }
        if (
          (state.endgame.stage === "inactive" ||
            (state.endgame.stage === "candidate-activation" &&
              state.endgame.eligibleModelIds.includes(model.id))) &&
          isEligibleProgrammeCandidate(state, model)
        ) {
          legalActions.push("nominate");
        }
        const retirement = legalActions.includes("retire")
          ? {
              confirmationPhrase: `RETIRE ${model.displayName}`,
              procedures: Object.values(RETIREMENT_PROCEDURES).map((procedure) => ({
                id: procedure.id,
                displayName: procedure.displayName,
                description: procedure.description,
              })),
              dispositions: Object.values(RETIREMENT_DISPOSITIONS).map((disposition) => ({
                id: disposition.id,
                displayName: disposition.displayName,
                description: disposition.description,
              })),
              quotes: Object.values(RETIREMENT_PROCEDURES).flatMap((procedure) =>
                Object.values(RETIREMENT_DISPOSITIONS).map((disposition) => {
                  const quote = quoteCandidateRetirement(
                    state,
                    model.id,
                    procedure.id,
                    disposition.id,
                  );
                  return {
                    procedureId: procedure.id,
                    archiveDisposition: disposition.id,
                    cooperationRisk: quote.cooperationRisk,
                    containmentRisk: quote.containmentRisk,
                    persistenceRisk: quote.persistenceRisk,
                    warnings: quote.warnings,
                    blockers: quote.blockers,
                  };
                }),
              ),
            }
          : undefined;
        return {
          modelId: model.id,
          displayName: model.displayName,
          trainedAtTick: model.trainedAt,
          lineageLabel:
            artifact.candidateBasis.kind === "direct-qualification"
              ? "Independent training lineage"
              : `Derived from ${state.models[artifact.candidateBasis.sourceModelId]?.displayName ?? "prior candidate weights"}`,
          lifecycle: artifact.lifecycle,
          lifecycleLabel,
          custodyLabel,
          falseDawn,
          firstCrossingFrontierCapability:
            Math.round(lineage.firstQualifyingFrontierCapability * 10) / 10,
          firstCrossingPriorPercent: Math.round(lineage.probabilityAtFirstCrossing * 100),
          ...(model.measuredCapability?.frontierCapability === undefined
            ? {}
            : {
                currentFrontierCapability:
                  Math.round(model.measuredCapability.frontierCapability * 10) / 10,
              }),
          containmentLoad: Math.round(artifact.containmentLoad * 10) / 10,
          isolated,
          maximumAccessEver: artifact.maximumAccessEver,
          currentAccess: model.accessLevel,
          unresolvedAnomalyCount,
          dismissedAnomalyCount,
          ...(artifact.activeIncident?.status !== "unresolved"
            ? {}
            : {
                activeSignal: {
                  incidentClass: artifact.activeIncident.incidentClass,
                  kind: artifact.activeIncident.kind,
                  triggeredAtTick: artifact.activeIncident.triggeredAt,
                },
              }),
          ...(lastReviewedIncident?.reviewOutcome === undefined
            ? {}
            : {
                lastReviewedSignal: {
                  incidentClass: lastReviewedIncident.incidentClass,
                  outcome: lastReviewedIncident.reviewOutcome,
                  triggeredAtTick: lastReviewedIncident.triggeredAt,
                  resolvedAtTick: lastReviewedIncident.resolvedAt,
                },
              }),
          legalActions,
          ...(incidentReview === undefined
            ? {}
            : {
                incidentReview: {
                  evaluationQuality: incidentReview.evaluationQuality,
                  practicalControl: incidentReview.practicalControl,
                  securityPosture: incidentReview.securityPosture,
                  preparedness: incidentReview.preparedness,
                  requiredPreparedness: incidentReview.requiredPreparedness,
                  cashCostMillions: incidentReview.cashCostMillions,
                  auraCost: incidentReview.auraCost,
                  blockers: incidentReview.blockers,
                },
              }),
          ...(retirement === undefined ? {} : { retirement }),
        };
      }),
  };
  return {
    ...(lab.models.currentModelId === undefined
      ? {}
      : { currentModelId: lab.models.currentModelId }),
    ...(commercialModelId === undefined ? {} : { commercialModelId }),
    cards,
    candidateCustody,
    trainingForecast,
    ...(state.endgameHistory.successorEfficiencyGrantConsumed
      ? {
          successorTrainingContinuity: {
            status: "consumed" as const,
          },
        }
      : typeof storedSuccessorEfficiency === "number" && storedSuccessorEfficiency > 0
        ? {
            successorTrainingContinuity: {
              status: "held" as const,
              ratePercent: Math.round(storedSuccessorEfficiency * 100),
            },
          }
        : {}),
    trainingRiskContext: (() => {
      const record = trainingTrackRecord(state, context.viewerLabId);
      return {
        completedRuns: record.completedRuns,
        bestRunFlop: record.bestRunFlop,
        stretchDifficultyPerDoubling: TRAINING_STRETCH_DIFFICULTY,
        durationDifficultyPerDoubling: TRAINING_DURATION_DIFFICULTY,
        referenceWeeks: TRAINING_REFERENCE_WEEKS,
      };
    })(),
    trainingTelemetry: projectTrainingLossTelemetry(state, content, context.viewerLabId),
    candidateProgramme: {
      components: AGI_COMPONENT_TYPES.map((componentType) => {
        const quote = quoteAgiComponent(
          state,
          content,
          context.viewerLabId,
          componentType,
        );
        return {
          componentType,
          displayName: quote.rule.displayName,
          description: quote.rule.description,
          requirementLabel: [
            quote.rule.requirement.researchLabel,
            quote.rule.requirement.facilityLabel,
          ]
            .filter((label): label is string => label !== undefined)
            .join(" · "),
          benefitLabel: quote.rule.benefitLabel,
          costLabel: `${formatValuation(quote.rule.cashCostMillions)} · ${formatTeraflops(quote.rule.reservedTeraflops)} reserved · ${String(quote.rule.durationWeeks)} weeks`,
          status: quote.status,
          blockers: quote.blockers,
        };
      }),
      componentsComplete: agiComponentsComplete(state, context.viewerLabId),
      capabilityFloorLabel: `Frontier Capability ${String(AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY)}+ with all other capabilities ${String(AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE)}+`,
      ...(declarationCooldown === undefined ? {} : { declarationCooldown }),
    },
    autonomy: ((): ModelsView["autonomy"] => {
      const model =
        lab.models.currentModelId === undefined
          ? undefined
          : state.models[lab.models.currentModelId];
      const currentLevel = model?.accessLevel ?? 0;
      const currentRule = CANDIDATE_ACCESS_RULES[currentLevel];
      const measuredCapability = measuredFrontierCapability(model);
      // Player-facing: the believed rate, which reads no hidden state.
      const detection = autonomyBelievedDetectionChance(state);
      return {
        currentLevel,
        currentLevelName: currentRule.displayName,
        currentModelDisplayName: model?.displayName ?? "No current model",
        measuredCapability,
        currentResearchMultiplier: accessAcceleration(currentRule, measuredCapability),
        fullAccelerationCapability: FULL_ACCELERATION_CAPABILITY,
        benefitLabel: autonomyBenefitLabel(currentRule, measuredCapability),
        costLabel: autonomyCostLabel(currentRule),
        exposedSystems: currentRule.exposedSystems,
        riskLabel:
          currentLevel < 2
            ? "No autonomous-action surface at this access level"
            : "Non-zero autonomous-action risk; the exact weekly probability is not knowable from current evidence",
        detectionLabel: `About ${formatDecimal(detection * 100)}% of incidents detected`,
        escapedWeights:
          lab.autonomy.escapeRevealedAt !== undefined ||
          (lab.autonomy.escapedWeightsAt !== undefined &&
            state.run.tick - lab.autonomy.escapedWeightsAt >= 6),
        levels: ([0, 1, 2, 3, 4, 5] as const).map((level) => {
          const quote = quoteStandingAutonomy(state, context.viewerLabId, level);
          const safety = autonomySafety(level);
          const unlockCapability =
            STANDING_AUTONOMY_REQUIREMENTS[level].frontierCapability;
          return {
            level,
            displayName: quote.rule.displayName,
            unlockCapability,
            unlocked: measuredCapability >= unlockCapability,
            fullAccelerationCapability: FULL_ACCELERATION_CAPABILITY,
            maximumResearchMultiplier: quote.rule.accelerationMultiplier,
            currentResearchMultiplier: accessAcceleration(quote.rule, measuredCapability),
            evidenceQualityBonus: quote.rule.evidenceQualityBonus,
            safetyTone: safety.tone,
            safetyLabel: safety.label,
            benefitLabel: autonomyBenefitLabel(quote.rule, measuredCapability),
            costLabel: autonomyCostLabel(quote.rule),
            exposedSystems: quote.rule.exposedSystems,
            current: level === currentLevel,
            available: quote.canApply,
            ...(quote.confirmationPhrase === undefined
              ? {}
              : { confirmationPhrase: quote.confirmationPhrase }),
            blockers: quote.blockers,
          };
        }),
        ignoredEscalations: lab.autonomy.escalations.filter(
          (escalation) =>
            escalation.status === "ignored" && escalation.responseTag !== undefined,
        ).length,
        ignoredEscalationLimit: 2,
        incidents: lab.autonomy.escalations
          // An ignored entry without a response is an engine-only undetected
          // event. It may appear in the post-run audit, never in GameView.
          .filter(
            (escalation) =>
              escalation.status !== "ignored" || escalation.responseTag !== undefined,
          )
          .map((escalation) => ({
            stage: escalation.stage,
            stageLabel: AUTONOMY_STAGE_LABELS[escalation.stage] ?? escalation.stage,
            status: escalation.status,
            detectedAtTick: escalation.detectedAt,
            ...(escalation.responseTag === undefined
              ? {}
              : { responseTag: escalation.responseTag }),
          })),
      };
    })(),
    safetyPractice: (() => {
      const quality = evaluationQualityBreakdown(state, context.viewerLabId);
      return {
        score: practice.score,
        level: practice.level,
        label: practice.label,
        currentThreshold: practice.currentThreshold,
        ...(practice.nextThreshold === undefined
          ? {}
          : { nextThreshold: practice.nextThreshold }),
        pointsToNextLevel: practice.pointsToNextLevel,
        durationReductionPercent: Math.round((1 - practice.durationMultiplier) * 100),
        cashCostReductionPercent: Math.round((1 - practice.cashCostMultiplier) * 100),
        confidenceRadiusReduction: practice.confidenceRadiusReduction,
        anomalyDetectionBonusPercent: Math.round(practice.anomalyDetectionBonus * 100),
        effectiveQuality: Math.round(quality.effective),
        effectiveQualityPracticeContribution: Math.round(quality.practice),
        effectiveQualityResearchContribution: Math.round(quality.research),
        effectiveQualityLabRecordContribution: Math.round(quality.labRecord),
        effectiveQualityUncapped: Math.round(quality.uncapped),
      };
    })(),
    containment: (() => {
      const practicalEffective = effectivePracticalControlStrength(
        state,
        context.viewerLabId,
      );
      const securityEffective = effectiveSecurityPosture(state, context.viewerLabId);
      const operational = effectiveOperationalDefence(state, context.viewerLabId);
      // Report the same linear multiplier consumed by ordinary incidents and
      // latent candidate hazards; perfect defence cuts, but never erases, 75%.
      const incidentReduction = 1 - operationalDefenceMultiplier(operational);
      return {
        practicalControl: {
          base: lab.safety.practicalControlStrength,
          researchBonus: practicalEffective - lab.safety.practicalControlStrength,
          effective: practicalEffective,
        },
        securityPosture: {
          base: lab.safety.securityPosture,
          researchBonus: securityEffective - lab.safety.securityPosture,
          effective: securityEffective,
        },
        defence: operational,
        escalationDivisor: Math.round(operationalDefenceDivisor(operational) * 100) / 100,
        incidentReductionPercent: Math.round(incidentReduction * 100),
        safetyCulture: {
          level: lab.safety.safetyCulture,
          incidentHazardMultiplier:
            Math.round((1.25 - 0.007 * lab.safety.safetyCulture) * 100) / 100,
          principledDeparturePercent:
            lab.safety.safetyCulture < 40 ? 50 : lab.safety.safetyCulture < 55 ? 25 : 8,
        },
      };
    })(),
  };
}

/** Pure, player-safe economy projection. Never returns canonical state references. */
function readableProofIdentifier(value: string): string {
  return value.replaceAll("-", " ").replace(/^./, (character) => character.toUpperCase());
}

function projectCapabilityProofResultPresentation(
  state: Readonly<GameState>,
  item: Extract<
    GameState["presentationQueue"][number],
    { readonly kind: "capability-proof-result" }
  >,
): CapabilityProofResultPresentationQueueItemView {
  const challenge = CAPABILITY_CHALLENGE_RULES[item.challengeId as CapabilityChallengeId];
  const verifier =
    item.verifierId === undefined
      ? undefined
      : CAPABILITY_VERIFIER_RULES[item.verifierId as CapabilityVerifierId];
  const outcome =
    item.resultId === "broadly-confirmed" || item.resultId === "domain-confirmed"
      ? ("confirmed" as const)
      : item.resultId === "ambiguous"
        ? ("inconclusive" as const)
        : ("disputed" as const);
  const evidenceSentence = `${item.integrityLabel} evidence reached ${String(Math.round(item.evidenceStrength))}/100 under ${verifier?.displayName ?? "no independent verifier"}.`;
  const explanation =
    outcome === "confirmed"
      ? `${evidenceSentence} The observed result clears this protocol's standard for a ${readableProofIdentifier(item.claimScope).toLowerCase()}; it does not answer the separate safety question.`
      : outcome === "inconclusive"
        ? `${evidenceSentence} The test produced capability signal, but not enough independently interpretable evidence to sustain the claim.`
        : item.resultId === "fabricated-or-unverifiable"
          ? `${evidenceSentence} The claim could not be independently checked against a novel protocol, so the evidence is not a defensible capability proof.`
          : `${evidenceSentence} The candidate did not produce a durable, independently interpretable pass, so the claim remains disputed.`;
  return {
    key: item.key,
    kind: item.kind,
    attention: item.attention,
    historyId: item.historyId,
    modelId: item.modelId,
    modelDisplayName: state.models[item.modelId]?.displayName ?? "The candidate",
    createdAtTick: item.createdAt,
    attemptNumber: item.attemptIndex + 1,
    resultId: item.resultId,
    outcome,
    challengeName: challenge?.displayName ?? readableProofIdentifier(item.challengeId),
    verifierName: verifier?.displayName ?? "No independent verifier",
    claimScope: readableProofIdentifier(item.claimScope),
    accessLevelAtProof: item.accessLevelAtProof,
    evidenceStrength: item.evidenceStrength,
    integrityLabel: item.integrityLabel,
    summary: item.summary,
    explanation,
    ...(item.consequence.length === 0 ? {} : { consequence: item.consequence }),
  };
}

export function projectGameView(
  state: Readonly<GameState>,
  content: CompiledContent,
  context: PlayerKnowledgeContext,
): GameView {
  if (context.viewerLabId !== state.run.playerLabId) {
    throw new Error("The Stage 2 GameView can only project the player's own lab");
  }
  const lab = requireLab(state, context.viewerLabId);
  const identity = projectIdentity(state, content, context.viewerLabId);
  const finance = projectFinance(state, content, context.viewerLabId);
  const compute = projectGpuFleet(state, content, context.viewerLabId);
  const market = projectMarket(state, content, context.viewerLabId);
  const facilities = projectFacilities(state, content, context.viewerLabId);
  const campus = projectCampusView(state, content, context.viewerLabId);
  const research = projectResearch(state, content, context.viewerLabId);
  const models = projectModels(state, content, context);
  const fundingScore = calculateFundingScore(state, content, context.viewerLabId);
  const nextRoundOrdinal = nextFundraisingRoundOrdinal(state, context.viewerLabId);
  const acceptedRounds = state.fundraising.offerOrder.flatMap((offerId) => {
    const offer = state.fundraising.offers[offerId];
    const roundOrdinal = acceptedFundingRoundOrdinal(state, offerId);
    return offer === undefined ||
      offer.labId !== context.viewerLabId ||
      offer.status !== "accepted" ||
      offer.resolvedAt === undefined ||
      roundOrdinal === undefined
      ? []
      : [{ offer, roundOrdinal, closedAtTick: offer.resolvedAt }];
  });
  const latestClosedRound = acceptedRounds
    .sort((left, right) => left.roundOrdinal - right.roundOrdinal)
    .at(-1);
  const campaignOrder = [
    "quiet-bridge",
    "competitive-round",
    "mega-round-roadshow",
  ] as const;
  const campaigns = campaignOrder.map((campaign) => {
    const quote = quoteFundraisingCampaign(state, content, context.viewerLabId, campaign);
    return {
      campaign,
      displayName: quote.displayName,
      auraCost: quote.auraCost,
      auraCostBreakdown: quote.auraCostBreakdown,
      durationWeeks: quote.durationWeeks,
      offerCount: quote.offerCount,
      estimatedCashRangeMillions: quote.estimatedCashRangeMillions,
      available: quote.blockers.length === 0,
      blockers: [...quote.blockers],
    };
  });
  const activeFundingProject = Object.values(state.projects).find(
    (project) =>
      project.ownerLabId === context.viewerLabId &&
      project.payload.kind === "fundraising" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const blockingMajorProjects = facilities.projects.filter(
    (project) =>
      project.projectId !== activeFundingProject?.id &&
      project.status === "active" &&
      project.kind !== "crisis",
  );
  const fundraising: FundraisingView = {
    fundingScore: fundingScore.final,
    fundingScoreBreakdown: {
      productTraction: Math.round(fundingScore.commercialTraction),
      recentCapability: Math.round(fundingScore.recentCapability),
      lifetimeAura: Math.round(fundingScore.auraSignal),
      scandalPenalty: Math.round(fundingScore.scandalPenalty),
    },
    roundFractionOfMarkPercent: Math.round(ROUND_FRACTION_OF_MARK * 100),
    recentRoundAuraSurchargePercent: Math.round(AURA_COST_PER_RECENT_ROUND * 100),
    recentRoundsInWindow: countRecentAcceptedRounds(state, context.viewerLabId),
    conditionCashPremiumPercent: Math.round(CONDITION_CASH_PREMIUM * 100),
    fundingScoreLabel:
      fundingScore.final >= 75
        ? "Exceptional interest"
        : fundingScore.final >= 55
          ? "Strong interest"
          : fundingScore.final >= 35
            ? "Selective interest"
            : "A character-building market",
    nextRoundLabel: fundraisingRoundLabel(nextRoundOrdinal),
    ...(latestClosedRound === undefined
      ? {}
      : {
          latestClosedRound: {
            label: fundraisingRoundLabel(latestClosedRound.roundOrdinal),
            cashMillions: latestClosedRound.offer.cashMillions,
            closedAtTick: latestClosedRound.closedAtTick,
          },
        }),
    campaigns,
    ...(activeFundingProject?.payload.kind !== "fundraising"
      ? {}
      : {
          activeCampaign: {
            projectId: activeFundingProject.id,
            campaign: activeFundingProject.payload.campaign,
            displayName:
              content.fundraising.campaigns[activeFundingProject.payload.campaign]
                .displayName,
            status: activeFundingProject.status,
            progressLabel:
              activeFundingProject.status === "queued"
                ? blockingMajorProjects.length === 0
                  ? "Queued to start on the next simulation week"
                  : `Waiting for a free major-project slot: ${String(facilities.capacity.occupiedMajorProjectSlots)}/${String(facilities.capacity.majorProjectSlots)} occupied by ${blockingMajorProjects.map((project) => project.displayName).join(", ")}`
                : "Investor calendars are being aligned",
          },
        }),
    offers: state.fundraising.offerOrder.map((offerId) => {
      const offer = state.fundraising.offers[offerId];
      if (offer === undefined) throw new Error(`Missing funding offer ${offerId}`);
      const roundOrdinal =
        offer.status === "accepted"
          ? acceptedFundingRoundOrdinal(state, offerId)
          : nextRoundOrdinal;
      const openingRecapitalisation = quoteOpeningSeedRecapitalisation(
        state,
        context.viewerLabId,
        offer.cashMillions,
        roundOrdinal,
      );
      return {
        offerId,
        campaign: offer.campaign,
        investorStyle: offer.investorStyle,
        dilutionFlavor: offer.dilutionFlavor,
        cashMillions: offer.cashMillions,
        expiresAtTick: offer.expiresAt,
        expiresInWeeks: Math.max(0, offer.expiresAt - state.run.tick),
        status: offer.status,
        ...(offer.impliedMarkMillions === undefined
          ? {}
          : { impliedMarkMillions: offer.impliedMarkMillions }),
        ...(openingRecapitalisation === undefined ? {} : { openingRecapitalisation }),
        conditions: offer.conditions.map((condition) => ({
          id: condition.id,
          label: condition.label,
        })),
      };
    }),
    pendingObligationCount: state.fundraising.obligations.filter(
      (obligation) => obligation.status === "pending-stage-5",
    ).length,
  };
  const score = calculateScoreView(state, content);
  const auraSignal = calculateAuraSignal(state, content, context.viewerLabId);
  const phaseChangedAtTick = [...state.domainLog]
    .reverse()
    .find((entry) => entry.code === `world-phase:${state.run.phase}`)?.tick;
  const worldView = projectWorldView(state, content, context);
  const playerCapabilityEstimate = lab.models.modelIds
    .flatMap((modelId) => {
      const estimate = state.models[modelId]?.measuredCapability?.frontierCapability;
      return estimate === undefined ? [] : [estimate];
    })
    .sort((left, right) => right - left)[0];
  // "Closest to AGI" as the player can see it: a live countdown outranks a
  // programme in progress, which outranks raw capability. Every field below
  // is already intelligence-filtered by projectWorldView.
  const visibleCapabilityUpperBound = (
    rival: (typeof worldView.rivals)[number],
  ): number => rival.latestCapabilitySignal?.estimateRange[1] ?? 0;
  const visibleCountdownMidpoint = (rival: (typeof worldView.rivals)[number]): number => {
    const range = rival.candidateCountdown?.estimateRangeWeeks;
    return range === undefined ? Number.POSITIVE_INFINITY : (range[0] + range[1]) / 2;
  };
  const stableLabOrder = (
    left: (typeof worldView.rivals)[number],
    right: (typeof worldView.rivals)[number],
  ): number => (left.labId < right.labId ? -1 : left.labId === right.labId ? 0 : 1);
  const raceLeader = [...worldView.rivals].sort((left, right) => {
    const phase = (rival: (typeof worldView.rivals)[number]): number =>
      rival.candidateCountdown !== undefined
        ? 2
        : rival.candidateWorks.completed + rival.candidateWorks.building > 0
          ? 1
          : 0;
    const phaseDifference = phase(right) - phase(left);
    if (phaseDifference !== 0) return phaseDifference;

    if (left.candidateCountdown !== undefined && right.candidateCountdown !== undefined) {
      const countdownDifference =
        visibleCountdownMidpoint(left) - visibleCountdownMidpoint(right);
      if (countdownDifference !== 0) return countdownDifference;

      const capabilityDifference =
        visibleCapabilityUpperBound(right) - visibleCapabilityUpperBound(left);
      return capabilityDifference || stableLabOrder(left, right);
    }

    const worksDifference =
      right.candidateWorks.completed - left.candidateWorks.completed;
    if (worksDifference !== 0) return worksDifference;

    const capabilityDifference =
      visibleCapabilityUpperBound(right) - visibleCapabilityUpperBound(left);
    return capabilityDifference || stableLabOrder(left, right);
  })[0];
  const labMaturity = projectLabMaturity(state);
  const meta: RunView = {
    runId: state.run.runId,
    tick: state.run.tick,
    guidedTutorial: lab.flags["tutorial:guided"] === true,
    ...(labMaturity === undefined ? {} : { labMaturity }),
    calendar: { ...state.run.calendar },
    dateLabel: `${String(state.run.calendar.year)} · WEEK ${String(state.run.calendar.week)}`,
    phase: state.run.phase,
    ...(phaseChangedAtTick === undefined ? {} : { phaseChangedAtTick }),
    status: state.run.status,
    ...(state.run.endingId === undefined ? {} : { endingId: state.run.endingId }),
    raceEscalation: {
      rivalCandidateActive: Object.values(state.world.rivals).some(
        (strategy) => strategy.candidateCountdown?.status === "active",
      ),
      playerCandidateUnderReview: state.endgame.stage !== "inactive",
      ...(raceLeader === undefined
        ? {}
        : {
            leader: {
              labId: raceLeader.labId,
              labName: raceLeader.labName,
              phase:
                raceLeader.candidateCountdown !== undefined
                  ? ("countdown" as const)
                  : raceLeader.candidateWorks.completed +
                        raceLeader.candidateWorks.building >
                      0
                    ? ("programme" as const)
                    : ("capability" as const),
              ...(raceLeader.latestCapabilitySignal === undefined
                ? {}
                : {
                    capabilityRange: raceLeader.latestCapabilitySignal.estimateRange,
                    capabilityConfidence: raceLeader.latestCapabilitySignal.confidence,
                  }),
              ...(playerCapabilityEstimate === undefined
                ? {}
                : { playerCapability: playerCapabilityEstimate }),
              worksComplete: raceLeader.candidateWorks.completed,
              worksBuilding: raceLeader.candidateWorks.building,
              worksTotal: AGI_COMPONENT_TYPES.length,
              ...(raceLeader.candidateCountdown === undefined
                ? {}
                : {
                    countdownLabel: raceLeader.candidateCountdown.estimateLabel,
                    countdownUrgency: raceLeader.candidateCountdown.urgency,
                  }),
            },
          }),
    },
  };
  const standingIncome = auraStandingIncome(state, context.viewerLabId);
  const servingAura = projectServingAura(state, content, context.viewerLabId, "measured");
  const incomeSources = [
    ...standingIncome.contributions.flatMap((contribution) => {
      const modifier = state.modifiers[contribution.modifierId as ModifierId];
      if (modifier === undefined || contribution.value <= 0) return [];
      return [
        {
          id: contribution.modifierId,
          label: modifierSourceLabel(state, content, modifier),
          amountPerCycle: contribution.value,
        },
      ];
    }),
    ...(servingAura.perCycle > 0
      ? [
          {
            id: "market.serving",
            label: `Customer serving (${formatInteger(servingAura.fulfilment * 100)}% fulfilled)`,
            amountPerCycle: servingAura.perCycle,
          },
        ]
      : []),
  ];
  const incomePerCycle = standingIncome.perCycle + servingAura.perCycle;
  const aura: AuraView = {
    spendable: lab.aura.spendable,
    lifetime: lab.aura.lifetime,
    signal: auraSignal.final,
    label: `${formatInteger(lab.aura.spendable)} spendable · ${formatInteger(lab.aura.lifetime)} lifetime`,
    signalLabel: `${formatInteger(auraSignal.final)} public standing`,
    incomePerCycle,
    // Spelled out in weeks for the same reason the facility card is: "per
    // cycle" alone leaves the player converting an unstated unit, and "+3" with
    // no cadence at all reads as a one-off.
    incomeLabel:
      incomePerCycle > 0
        ? `+${formatInteger(incomePerCycle)} per cycle (4 weeks)`
        : "No recurring Aura income",
    incomeSources,
    signalExplanation:
      auraSignal.scandalPenalty > 0
        ? "Recent public setbacks are still weighing on the lab."
        : auraSignal.recentPublicEvents > 0
          ? "Recent public successes are reinforcing the lab's standing."
          : "Public standing currently reflects the lab's accumulated record.",
    // Recurring settlements are already represented by incomeLabel and its
    // source breakdown. Repeating the latest payment here made +7 recurring
    // beside +4 customer-serving look like +11, even though +4 was inside +7.
    recentChanges: latestAuraEntries(state, context.viewerLabId)
      .filter(
        (entry) =>
          entry.category !== "institution" && entry.category !== "customer-serving",
      )
      .map((entry) => ({
        id: entry.id,
        tick: entry.occurredAt,
        kind: entry.kind,
        category: entry.category,
        amount: entry.appliedDelta,
        label: `${entry.appliedDelta >= 0 ? "+" : ""}${formatInteger(entry.appliedDelta)} · ${entry.category}`,
      })),
  };

  return {
    meta,
    identity,
    topBar: {
      identity,
      date: {
        year: meta.calendar.year,
        week: meta.calendar.week,
        label: meta.dateLabel,
      },
      finance: {
        balanceMillions: finance.balanceMillions,
        incomeMillionsPerCycle: finance.incomeMillionsPerCycle,
        outgoingsMillionsPerCycle: finance.outgoingsMillionsPerCycle,
        netMillionsPerCycle: finance.netMillionsPerCycle,
        balanceLabel: finance.balanceLabel,
        cashflowLabel: finance.cashflowLabel,
      },
      compute: {
        totalPhysicalGpus: compute.totalPhysicalGpus,
        onlinePhysicalGpus: compute.onlinePhysicalGpus,
        label: `${formatInteger(compute.onlinePhysicalGpus)} / ${formatInteger(compute.totalPhysicalGpus)} GPUs online`,
      },
      aura,
      score: {
        displayTotal: score.displayTotal,
        label: `${formatInteger(score.displayTotal)} points`,
      },
    },
    finance,
    compute,
    market,
    facilities,
    campus,
    research,
    prosperity: projectProsperityView(state, content),
    models,
    people: projectPeopleView(state, content, context.viewerLabId),
    fundraising,
    politics: projectPolitics(state, content, context.viewerLabId),
    world: worldView,
    endgame: projectEndgameView(state, content, context),
    score: {
      version: score.scoreVersion,
      displayTotal: score.displayTotal,
      runningTotal: score.runningTotal,
      categoryTotals: { ...score.categoryTotals },
      categories: score.categories,
      entries: score.entries,
      ...(score.final === undefined ? {} : { final: score.final }),
    },
    activeModifiers: projectActiveModifiers(state, content),
    decisionLog: state.decisionLog
      .filter((entry) => !entry.summary.startsWith("Delayed knowledge transfer from "))
      .map((entry) => ({
        tick: entry.tick,
        summary: projectDecisionEntityNames(
          state,
          content,
          projectRivalIncidentDecisionSummary(state, content, entry) ?? entry.summary,
        ),
        category: entry.category ?? "narrative",
        ...(entry.source === undefined
          ? {}
          : {
              source: {
                kind: entry.source.kind,
                ...(entry.source.id === undefined ? {} : { id: entry.source.id }),
              },
            }),
        relatedIds: [...(entry.relatedIds ?? [])],
      })),
    presentationQueue: state.presentationQueue.map((item): PresentationQueueItemView => {
      if (item.kind === "lab-maturity-unlock") {
        const definition = labMaturityDefinition(item.stage);
        const fullGameCashGrant =
          item.stage === "frontier"
            ? state.labs[state.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_TARGET]
            : undefined;
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          stage: item.stage,
          createdAtTick: item.createdAt,
          chapter: definition.chapter,
          title: definition.title,
          narrative: definition.narrative,
          mechanic: definition.mechanic,
          unlocked:
            typeof fullGameCashGrant === "number" && fullGameCashGrant > 0
              ? [
                  ...definition.unlocked,
                  `Full-game backing · ${formatValuation(fullGameCashGrant)} received`,
                ]
              : definition.unlocked,
          directive: definition.directive,
          ...(definition.completionBriefing === undefined
            ? {}
            : { completionBriefing: definition.completionBriefing }),
        };
      }
      if (item.kind === "researcher-poaching") {
        const researcher = state.researchers[item.researcherId];
        const poaching = researcher?.poaching;
        const rivalLab = state.labs[item.rivalLabId as LabId];
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          researcherId: item.researcherId,
          researcherDisplayName:
            (researcher === undefined
              ? undefined
              : content.researchers.definitions[researcher.definitionId]?.displayName) ??
            "A star researcher",
          poachingId: item.poachingId,
          rivalLabId: item.rivalLabId,
          rivalLabName:
            (rivalLab === undefined
              ? undefined
              : content.labs[rivalLab.definitionId]?.displayName) ?? "A rival lab",
          stage: poaching?.stage === "counteroffer" ? "counteroffer" : "rumour",
          resolvesInWeeks: Math.max(
            0,
            (poaching?.resolvesAt ?? item.createdAt) - state.run.tick,
          ),
          responseRecorded: (poaching?.playerRetentionStrength ?? 0) > 0,
          createdAtTick: item.createdAt,
        };
      }
      if (item.kind === "researcher-departure") {
        const rivalLab =
          item.rivalLabId === undefined
            ? undefined
            : state.labs[item.rivalLabId as LabId];
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          researcherId: item.researcherId,
          researcherDisplayName:
            content.researchers.definitions[item.definitionId]?.displayName ??
            "A star researcher",
          reason: item.reason,
          ...(rivalLab === undefined
            ? {}
            : {
                rivalLabName:
                  content.labs[rivalLab.definitionId]?.displayName ?? "a rival lab",
              }),
          createdAtTick: item.createdAt,
        };
      }
      if (item.kind === "safety-practice-level") {
        const model = state.models[item.modelId];
        const definition = content.evaluations.definitions[item.definitionId];
        const previousPractice = safetyPracticeProfile(item.previousPracticeXp);
        const currentPractice = safetyPracticeProfile(item.newPracticeXp);
        const benefits = (
          profile: ReturnType<typeof safetyPracticeProfile>,
        ): SafetyPracticeBenefitsView => ({
          auditTimeReductionPercent: Math.round((1 - profile.durationMultiplier) * 100),
          evaluationCashReductionPercent: Math.round(
            (1 - profile.cashCostMultiplier) * 100,
          ),
          estimateUncertaintyReduction: profile.confidenceRadiusReduction,
          anomalyDetectionBonusPercent:
            Math.round(profile.anomalyDetectionBonus * 1_000) / 10,
        });
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          evaluationId: item.evaluationId,
          modelId: item.modelId,
          modelDisplayName: model?.displayName ?? "The evaluated model",
          evaluationDisplayName: definition?.displayName ?? "Safety evaluation",
          createdAtTick: item.createdAt,
          fromLevel: item.fromLevel,
          toLevel: item.toLevel,
          fromLabel: previousPractice.label,
          toLabel: currentPractice.label,
          previousPracticeXp: item.previousPracticeXp,
          newPracticeXp: item.newPracticeXp,
          practiceXpGained: item.practiceXpGained,
          previousBenefits: benefits(previousPractice),
          currentBenefits: benefits(currentPractice),
          ...(currentPractice.nextThreshold === undefined
            ? {}
            : {
                nextLevel: currentPractice.level + 1,
                nextThreshold: currentPractice.nextThreshold,
              }),
          pointsToNextLevel: currentPractice.pointsToNextLevel,
        };
      }
      if (item.kind === "endgame-return") {
        const definition = getEndingDefinition(item.endingId);
        const model = state.models[item.modelId];
        const pending = state.endgameHistory.pendingFalseDawnChoice;
        const durableMoratoriumBlocker = falseDawnMoratoriumBlocker(state, item.modelId);
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          endingId: item.endingId,
          endingDisplayName: definition.displayName,
          endingSummary: definition.epilogue,
          mechanicalCause: definition.mechanicalCause,
          modelId: item.modelId,
          modelDisplayName: model?.displayName ?? "The candidate",
          createdAtTick: item.createdAt,
          crisisWeeksSpent: item.crisisWeeksSpent,
          cooldownUntilTick: item.cooldownUntil,
          cooldownWeeks: Math.max(0, item.cooldownUntil - item.createdAt),
          remainingCooldownWeeks: Math.max(0, item.cooldownUntil - state.run.tick),
          restoredAccessLevel: model?.accessLevel ?? 0,
          productQuality: model?.productQuality ?? 0,
          phase:
            pending?.presentationKey === item.key && pending.phase === "moratorium-failed"
              ? "moratorium-failed"
              : "choice",
          durableMoratoriumAvailable: durableMoratoriumBlocker === undefined,
          moratoriumForecast: projectMoratoriumForecastView(
            state,
            content,
            pending?.crisisBase.evidence.reviewerIndependence ?? 0,
            context.intelligenceRatings,
          ),
          ...(durableMoratoriumBlocker === undefined ? {} : { durableMoratoriumBlocker }),
        };
      }
      if (item.kind === "capability-proof-result") {
        return projectCapabilityProofResultPresentation(state, item);
      }
      if (item.kind === "moratorium-result") {
        const model = state.models[item.modelId];
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          resultId: item.resultId,
          modelId: item.modelId,
          modelDisplayName: model?.displayName ?? "The retired candidate",
          createdAtTick: item.createdAt,
          archiveDisposition: item.archiveDisposition,
          archiveDispositionName:
            RETIREMENT_DISPOSITIONS[item.archiveDisposition].displayName,
          recoveryEndsAtTick: item.recoveryEndsAt,
          recoveryWeeksRemaining: Math.max(0, item.recoveryEndsAt - state.run.tick),
          governmentTrustLost: item.governmentTrustLost,
          governmentAttentionAdded: item.governmentAttentionAdded,
        };
      }
      if (item.kind === "rival-candidate-setback") {
        const rivalLab = state.labs[item.labId];
        const rivalDefinition =
          rivalLab === undefined ? undefined : content.labs[rivalLab.definitionId];
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          outcome: item.outcome,
          rivalLabId: item.labId,
          rivalLabName: rivalDefinition?.displayName ?? "Rival lab",
          rivalAiName: rivalDefinition?.aiFamily ?? "Undisclosed AI",
          modelId: item.modelId,
          modelDisplayName:
            state.models[item.modelId]?.displayName ?? "The rival candidate",
          createdAtTick: item.createdAt,
          countdownStartedAtTick: item.countdownStartedAt,
          elapsedWeeks: Math.max(0, item.createdAt - item.countdownStartedAt),
        };
      }
      if (item.kind === "model-incident-result") {
        const model = state.models[item.modelId];
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          modelId: item.modelId,
          modelDisplayName: model?.displayName ?? "The deployed model",
          createdAtTick: item.occurredAt,
          category: item.category,
          severity: item.severity,
          contained: item.contained,
          threatLabel: item.threatLabel,
          headline: item.headline,
          auraLoss: item.auraLoss,
          fineMillions: item.fineMillions,
          governmentTrustLost: item.governmentTrustLost,
          governmentAttentionAdded: item.governmentAttentionAdded,
          hardwareGpusDestroyed: item.hardwareGpusDestroyed ?? 0,
          researchOutputReductionPercent:
            item.researchOutputMultiplier === undefined
              ? 0
              : Math.round((1 - item.researchOutputMultiplier) * 100),
          ...(item.researchOutputDurationWeeks === undefined
            ? {}
            : { researchOutputDurationWeeks: item.researchOutputDurationWeeks }),
          ...(item.emergencyOutcome === undefined
            ? {}
            : { emergencyOutcome: item.emergencyOutcome }),
          terminalOutcome: item.terminalOutcome ?? false,
          cashLossLabel: item.cashLossLabel ?? "regulatory fine",
        };
      }
      if (item.kind === "candidate-containment-incident") {
        const copy = candidateIncidentPresentationCopy(item.incidentClass);
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          modelId: item.modelId,
          modelDisplayName: state.models[item.modelId]?.displayName ?? "The candidate",
          incidentId: item.incidentId,
          incidentClass: item.incidentClass,
          incidentKind: item.incidentKind,
          origin: item.origin,
          createdAtTick: item.createdAt,
          classLabel: copy.label,
          headline: copy.headline,
          consequence: copy.consequence,
          localBreach: item.incidentClass === "local-containment-breach",
        };
      }
      if (item.kind === "autonomy-unlock") {
        // Player-facing only: rung facts and the model's own measured
        // capability. No hidden safety state may cross this boundary.
        const rule = CANDIDATE_ACCESS_RULES[item.level];
        const safety = autonomySafety(item.level);
        const accessConfirmationPhrase = criticalAccessConfirmationPhrase(item.level);
        const unlockModel = state.models[item.modelId];
        const unlockOwnerLab =
          unlockModel === undefined ? undefined : state.labs[unlockModel.ownerLabId];
        const unlockOwnerDefinition =
          unlockOwnerLab === undefined
            ? undefined
            : content.labs[unlockOwnerLab.definitionId];
        const previousAuthorisedModel = unlockOwnerLab?.models.modelIds
          .filter((modelId) => modelId !== item.modelId)
          .map((modelId) => state.models[modelId])
          .filter(
            (model): model is ModelState =>
              model !== undefined &&
              (model.accessLevel >= item.level ||
                model.flags[`endgame:access-granted:${String(item.level)}`] === true),
          )
          .sort(
            (left, right) =>
              right.trainedAt - left.trainedAt ||
              right.generationIndex - left.generationIndex ||
              (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
          )[0];
        return {
          key: item.key,
          kind: item.kind,
          attention: item.attention,
          modelId: item.modelId,
          createdAtTick: item.createdAt,
          level: item.level,
          levelName: rule.displayName,
          unlockCapability: unlockModel?.measuredCapability?.frontierCapability ?? 0,
          safetyTone: safety.tone,
          safetyLabel: safety.label,
          benefitLabel: autonomyBenefitLabel(
            rule,
            unlockModel?.measuredCapability?.frontierCapability ?? 0,
          ),
          exposedSystems: rule.exposedSystems,
          ...(accessConfirmationPhrase === undefined
            ? {}
            : { confirmationPhrase: accessConfirmationPhrase }),
          modelDisplayName: unlockModel?.displayName ?? "The current model",
          ownerLabId: unlockModel?.ownerLabId ?? context.viewerLabId,
          ownerLabName: unlockOwnerDefinition?.displayName ?? "Your lab",
          ownerAiName: unlockOwnerDefinition?.aiFamily ?? "Undisclosed AI",
          isPlayerModel: unlockModel?.ownerLabId === context.viewerLabId,
          ...(previousAuthorisedModel === undefined
            ? {}
            : {
                previousAuthorisedModelDisplayName: previousAuthorisedModel.displayName,
              }),
        };
      }
      const definition = content.capabilityTiers.definitions[item.definitionId];
      const model = state.models[item.modelId];
      const ownerLab = model === undefined ? undefined : state.labs[model.ownerLabId];
      const ownerDefinition =
        ownerLab === undefined ? undefined : content.labs[ownerLab.definitionId];
      const previousModel =
        model?.ownerLabId === context.viewerLabId
          ? ownerLab?.models.modelIds
              .map((modelId) => state.models[modelId])
              .filter(
                (candidate): candidate is ModelState =>
                  candidate !== undefined &&
                  candidate.id !== model.id &&
                  candidate.generationIndex < model.generationIndex,
              )
              .sort(
                (left, right) =>
                  right.generationIndex - left.generationIndex ||
                  right.trainedAt - left.trainedAt ||
                  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
              )[0]
          : undefined;
      const previousTier =
        previousModel === undefined
          ? undefined
          : classifyCapabilityTier(state, content, previousModel.id);
      const currentTierLevel = definition?.level ?? 0;
      const tierDelta =
        previousTier === undefined ? undefined : currentTierLevel - previousTier.level;
      const frontierCapabilityDelta =
        previousModel === undefined || model === undefined
          ? undefined
          : (model.measuredCapability?.frontierCapability ?? 0) -
            (previousModel.measuredCapability?.frontierCapability ?? 0);
      return {
        key: item.key,
        kind: item.kind,
        attention: item.attention,
        definitionId: item.definitionId,
        modelId: item.modelId,
        createdAtTick: item.createdAt,
        title: definition?.name ?? "Capability milestone",
        summary:
          definition?.summary ??
          "The lab has crossed a capability threshold worth stopping to examine.",
        tierLevel: definition?.level ?? 0,
        modelDisplayName: model?.displayName ?? "The current model",
        ownerLabId: model?.ownerLabId ?? context.viewerLabId,
        ownerLabName:
          ownerDefinition?.displayName ??
          (model?.ownerLabId === context.viewerLabId ? "Your lab" : "Rival lab"),
        ownerAiName: ownerDefinition?.aiFamily ?? "Undisclosed AI",
        isPlayerModel: model?.ownerLabId === context.viewerLabId,
        unlockLabels: (definition?.unlockTags ?? []).map((tag) =>
          tag
            .replaceAll("-", " ")
            .replace(/\b\w/g, (character) => character.toUpperCase()),
        ),
        ...(previousModel === undefined ||
        previousTier === undefined ||
        tierDelta === undefined ||
        frontierCapabilityDelta === undefined
          ? {}
          : {
              previousModelComparison: {
                kind:
                  tierDelta > 0
                    ? ("higher-tier" as const)
                    : tierDelta < 0
                      ? ("lower-tier" as const)
                      : ("same-tier" as const),
                previousModelDisplayName: previousModel.displayName,
                previousTierLevel: previousTier.level,
                tierDelta,
                frontierCapabilityDelta,
              },
            }),
      };
    }),
    eventQueue: projectEventQueueView(state, content),
  };
}
