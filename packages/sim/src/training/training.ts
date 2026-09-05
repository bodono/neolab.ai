import {
  contentId,
  type CapabilityAttribute,
  type CompiledContent,
  type ContentId,
  type TrainingPosture,
  type TrainingScale,
} from "@neolab/content-schema";

import { resolveGpuReservations } from "../compute/gpu-portfolio.ts";
import {
  eraReferenceTeraflops,
  totalFlopInvested,
  formatTeraflops,
  generationTeraflopsPerGpu,
  effectiveTeraflopsPerGpu,
} from "../compute/flops.ts";
import {
  FOUNDATION_SUCCESSOR_CHECKPOINT_DIFFICULTY_REDUCTION,
  PROGRESSIVE_PRODUCT_CAPABILITY,
} from "../campaign/lab-maturity-constants.ts";
import { isProgressiveOpeningCreditAvailable } from "../campaign/progressive-opening.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import { resolveCheckProbability } from "../engine/checks.ts";
import { formatValuation } from "../finance/valuation.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { archiveRecoveryPhase } from "../endgame/archive-recovery.ts";
import { deploymentCrisisBlocksOrdinaryTraining } from "../endgame/training-commitment.ts";
import {
  registerCompletedTrainingArtifact,
  resolveCandidatePressureCrossing,
} from "../endgame/candidate-lifecycle.ts";
import type {
  LabId,
  ModelId,
  ModelLineageId,
  ProjectId,
  ResearcherId,
} from "../model/ids.ts";
import {
  formatRunEntityId,
  type CapabilityVector,
  type GameState,
  type HiddenModelSafetyState,
  type ModelState,
  type ProjectPayload,
  type ProjectState,
  type TrainingCompletionReportState,
  type TrainingFailureCheckState,
  type TrainingFailureOutcome,
} from "../model/state.ts";
import { cashMillions, gpuCount, rating, type Tick } from "../model/units.ts";
import type { ProjectHandler } from "../projects/project-framework.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  CAPABILITY_ATTRIBUTES,
  calculateFrontierCapability,
} from "../models/capability.ts";
import {
  processStandingAutonomyUnlocks,
  reconcileAutonomyModifiers,
} from "../models/autonomy.ts";
import { classifyCapabilityTier } from "../models/tiers.ts";
import { completeBaselineEvaluation } from "../evaluations/evaluations.ts";
import {
  trainingQualityCapabilityAdjustment,
  trainingQualitySignal,
} from "./training-quality.ts";

type TrainingProjectPayload = Extract<ProjectPayload, { readonly kind: "training" }>;

const PROGRESSIVE_CAMPAIGN_FLAG = "campaign:progressive";
const LAB_MATURITY_STAGE_FLAG = "campaign:lab-maturity-stage";
const TRAINING_AUTHORISED_STAGE_FLAG = "campaign:training-authorised-stage";
const OPENING_PROTOTYPE_CAPABILITY_CEILING = 4.9;

function campaignMaturityStageAtAuthorisation(
  state: Readonly<GameState>,
  labId: LabId,
): string | undefined {
  const lab = state.labs[labId];
  if (labId !== state.run.playerLabId || lab?.flags[PROGRESSIVE_CAMPAIGN_FLAG] !== true) {
    return undefined;
  }
  const stage = lab.flags[LAB_MATURITY_STAGE_FLAG];
  return typeof stage === "string" ? stage : undefined;
}

function campaignOpeningForecast<
  T extends {
    readonly low: number;
    readonly expected: number;
    readonly high: number;
  },
>(forecast: T, stage: string | undefined): T {
  if (stage === "cluster") {
    return {
      ...forecast,
      low: Math.min(forecast.low, OPENING_PROTOTYPE_CAPABILITY_CEILING),
      expected: Math.min(forecast.expected, OPENING_PROTOTYPE_CAPABILITY_CEILING),
      high: Math.min(forecast.high, OPENING_PROTOTYPE_CAPABILITY_CEILING),
    };
  }
  if (stage === "foundation") {
    return {
      ...forecast,
      low: Math.max(forecast.low, PROGRESSIVE_PRODUCT_CAPABILITY),
      expected: Math.max(forecast.expected, PROGRESSIVE_PRODUCT_CAPABILITY),
      high: Math.max(forecast.high, PROGRESSIVE_PRODUCT_CAPABILITY),
    };
  }
  return forecast;
}

function campaignCheckpointDifficultyReduction(stage: string | undefined): number {
  return stage === "foundation"
    ? FOUNDATION_SUCCESSOR_CHECKPOINT_DIFFICULTY_REDUCTION
    : 0;
}

export interface TrainingRequest {
  readonly labId: LabId;
  readonly parentModelId?: ModelId;
  readonly posture: TrainingPosture;
  /**
   * Effective FLOP/s commitment in TFLOP/s. Omitted means a high-end prototype for the
   * current era. Scale is no longer an input: this and durationWeeks are the
   * two things the player chooses, and the run's NAME follows from them.
   */
  readonly committedTeraflops?: number;
  /** How many weeks to run. Omitted means TRAINING_DEFAULT_WEEKS. */
  readonly durationWeeks?: number;
  readonly technicalLeadId?: ResearcherId;
}

export interface TrainingIntrinsicSafetyForecast {
  /** Higher is safer. */
  readonly alignment: readonly [minimum: number, maximum: number];
  /** Higher is safer. */
  readonly corrigibility: readonly [minimum: number, maximum: number];
  /** Lower is safer. */
  readonly deceptiveIntent: readonly [minimum: number, maximum: number];
  /** Exposure-relevant capability, not a moral score. */
  readonly situationalAwareness: readonly [minimum: number, maximum: number];
  readonly basis: {
    readonly alignmentResearchLevel: number;
    readonly interpretabilityResearchLevel: number;
    readonly safetyCulture: number;
    readonly posture: TrainingPosture;
    readonly postureDisplayName: string;
  };
}

export interface TrainingQuote {
  readonly futureModelId: ModelId;
  readonly futureProjectId: ProjectId;
  readonly scale: TrainingScale;
  readonly displayName: string;
  readonly durationWeeks: number;
  /** Duration before the one-use verified-retirement efficiency benefit. */
  readonly unassistedDurationWeeks: number;
  readonly successorEfficiencyApplied: boolean;
  /** Disposition-dependent schedule and cash reduction, zero when unavailable. */
  readonly successorEfficiencyRate: number;
  /** The effective FLOP/s commitment this quote reserves, in TFLOP/s. */
  readonly committedTeraflops: number;
  /** The scale's floor in TFLOP/s at the current hardware era. */
  readonly floorTeraflops: number;
  /** Unreserved fleet FLOP/s available to commit. */
  readonly availableTeraflops: number;
  /** Whether the scale fixes the commitment (no player sizing). */
  readonly fixedCommitment: boolean;
  readonly reservedPhysicalGpus: number;
  /** Physical GPUs per generation backing the commitment (strongest first). */
  readonly reservationGenerationCounts: Readonly<Record<ContentId, number>>;
  readonly cashCostMillions: number;
  /** What the run is likely to do at the three checkpoints. */
  readonly reliability: TrainingReliabilityForecast;
  readonly cashSchedule: readonly {
    readonly dueAt: Tick;
    readonly amountMillions: number;
  }[];
  /** Era reference in TFLOP/s; capability grades committed compute against it. */
  readonly eraReferenceTeraflops: number;
  /** Estimated total FLOP invested over the run at full delivery. */
  readonly estimatedTotalFlop: number;
  /**
   * Planning estimate for the completed model's true Frontier Capability.
   * This uses only player-known inputs and broad outcome bounds; it never
   * resolves the run's keyed random draws or baseline-evaluation error.
   */
  readonly estimatedFrontierCapability: number;
  readonly estimatedFrontierCapabilityRange: readonly [number, number];
  /**
   * A player-safe prior based on current research, culture, projected capability,
   * and posture. It is not an evaluation and never reads a future random draw.
   */
  readonly intrinsicSafetyForecast: TrainingIntrinsicSafetyForecast;
  readonly currentModelComparison?: {
    readonly modelId: ModelId;
    readonly displayName: string;
    readonly measuredFrontierCapability: number;
    readonly estimatedDeltaRange: readonly [number, number];
  };
  readonly blockers: readonly string[];
}

/**
 * Posture is one compact, inspectable definition and nothing else. It used to point at a
 * dataset policy and a safety protocol, which between them hid nine authored
 * fields -- a per-attribute data-fitness vector, benchmark overfit, a hidden
 * safety quality, two cash multipliers, a duration multiplier -- none of which
 * the player could see or reason about. "Scrape everything" was a real
 * mechanic that never appeared anywhere in the UI.
 */
export interface TrainingPostureDefinition {
  readonly posture: TrainingPosture;
  readonly displayName: string;
  /**
   * Multiplies actual training FLOP only while calculating capability. This is
   * the honest way to express YOLO's capability upside: it moves the run along
   * the same scaling curve instead of multiplying the finished capability
   * product, whose apparent 10% bonus was worth vastly more than 10% compute.
   */
  readonly effectiveComputeMultiplier: number;
  /**
   * Multiplies the Cobb-Douglas capability product. Multiplicative, not a flat
   * point bonus: a flat +3 is decisive at capability 5 and rounding error at
   * 90, so the same authored number would dominate the opening and be
   * irrelevant by the endgame. As a multiplier its relative bite is constant.
   */
  readonly capabilityMultiplier: number;
  /**
   * Flat shift on every checkpoint's difficulty; negative is safer. Flat is
   * correct here where it was wrong for capability: this feeds a logistic
   * check whose output is a probability in [0,1], so a fixed shift is the same
   * size of decision in week 5 and week 400.
   */
  readonly successDifficultyDelta: number;
  /** Direct finished-model adjustments; a range is sampled once per model. */
  readonly outcomeAdjustmentRanges: Readonly<
    Record<
      | "trueAlignment"
      | "corrigibility"
      | "situationalAwareness"
      | "deceptiveIntent"
      | "reliability",
      readonly [minimum: number, maximum: number]
    >
  >;
}

/** Difficulty every checkpoint starts from, before posture and scale. */
export const BASE_CHECKPOINT_DIFFICULTY = 5;
/** Baseline hidden safety quality before research and finished-model adjustments. */
export const BASE_SAFETY_QUALITY = 50;

/** Weeks a failed run blocks new training while the team debugs. */
export const TRAINING_FAILURE_COOLDOWN_WEEKS = 8;
/** Flat per-checkpoint pass-probability bonus after a terminal failure. */
export const TRAINING_RECOVERY_PASS_PROBABILITY_BONUS = 0.1;

export const TRAINING_POSTURES: Readonly<
  Record<TrainingPosture, TrainingPostureDefinition>
> = {
  conservative: {
    posture: "conservative",
    displayName: "Conservative run",
    effectiveComputeMultiplier: 1,
    capabilityMultiplier: 0.93,
    successDifficultyDelta: -12,
    outcomeAdjustmentRanges: {
      trueAlignment: [4.5, 4.5],
      corrigibility: [3, 3],
      situationalAwareness: [0, 0],
      deceptiveIntent: [0, 0],
      reliability: [8, 8],
    },
  },
  normal: {
    posture: "normal",
    displayName: "Normal run",
    effectiveComputeMultiplier: 1,
    capabilityMultiplier: 1,
    successDifficultyDelta: 0,
    outcomeAdjustmentRanges: {
      trueAlignment: [0, 0],
      corrigibility: [0, 0],
      situationalAwareness: [0, 0],
      deceptiveIntent: [0, 0],
      reliability: [0, 0],
    },
  },
  yolo: {
    posture: "yolo",
    displayName: "YOLO run",
    effectiveComputeMultiplier: 3,
    capabilityMultiplier: 1,
    successDifficultyDelta: 12,
    outcomeAdjustmentRanges: {
      trueAlignment: [-18, -12],
      corrigibility: [-18, -12],
      situationalAwareness: [0, 0],
      deceptiveIntent: [12, 18],
      reliability: [-8, -5],
    },
  },
};

export function trainingPostureDefinition(
  posture: TrainingPosture,
): TrainingPostureDefinition {
  return TRAINING_POSTURES[posture];
}

export interface TrainingPostureOutcomeAdjustments {
  readonly trueAlignment: number;
  readonly corrigibility: number;
  readonly situationalAwareness: number;
  readonly deceptiveIntent: number;
  readonly reliability: number;
}

/**
 * Resolve posture effects from independent keyed draws. Calling this in a
 * different order cannot change the model, and the zero-width awareness range
 * makes explicit that YOLO gains awareness only through higher capability.
 */
export function trainingPostureOutcomeAdjustments(
  posture: TrainingPosture,
  modelId: ModelId,
  oracle: RandomOracle,
): TrainingPostureOutcomeAdjustments {
  const definition = trainingPostureDefinition(posture);
  const adjustment = (attribute: keyof TrainingPostureOutcomeAdjustments): number => {
    const [minimum, maximum] = definition.outcomeAdjustmentRanges[attribute];
    return oracle.triangular(
      randomKey("training", modelId, "posture-outcome", attribute),
      minimum,
      (minimum + maximum) / 2,
      maximum,
    );
  };
  return {
    trueAlignment: adjustment("trueAlignment"),
    corrigibility: adjustment("corrigibility"),
    situationalAwareness: adjustment("situationalAwareness"),
    deceptiveIntent: adjustment("deceptiveIntent"),
    reliability: adjustment("reliability"),
  };
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function resolveTrainingParentModelId(
  state: Readonly<GameState>,
  labId: LabId,
  requestedParentModelId: ModelId | undefined,
): ModelId | undefined {
  if (requestedParentModelId !== undefined) return requestedParentModelId;
  const currentModelId = state.labs[labId]?.models.currentModelId;
  if (currentModelId === undefined) return undefined;
  return state.models[currentModelId]?.flags["endgame:false-dawn-long-pause-archive"] ===
    true
    ? undefined
    : currentModelId;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Only cash is modifiable. The duration variant was retired: total FLOP is
 * committedTeraflops x durationWeeks and weekly throughput has no duration
 * term, so a modifier that shortened a run silently removed compute and handed
 * back a weaker model while being labelled a benefit. "Faster training" is now
 * lab.compute.workloadThroughput, which is more FLOP per committed week.
 */
/**
 * A run's name is an OUTPUT, not an input. The player commits FLOP/s and weeks;
 * what that adds up to is then called a Prototype, a Product, or a Frontier
 * run. Thresholds are in era-GPU-weeks -- deliberately era-relative, unlike
 * every simulated quantity, which stays absolute FLOP. A late-game Prototype
 * should still read as a Prototype even though it dwarfs an early Frontier
 * run, or the names collapse to "Frontier" for the second half of the game.
 *
 * The two thresholds reproduce today's names at each old scale's floor:
 * 2,000 x 9 = 18,000 was a Product, 5,000 x 15 = 75,000 was a Frontier.
 */
export const TRAINING_BAND_ERA_GPU_WEEKS: Readonly<
  Record<"product" | "frontier", number>
> = { product: 18_000, frontier: 75_000 };

/** Era-GPU-weeks a commitment adds up to, for naming only. */
export function trainingEraGpuWeeks(
  committedTeraflops: number,
  durationWeeks: number,
  eraGpuTeraflops: number,
): number {
  if (eraGpuTeraflops <= 0) return 0;
  return (committedTeraflops / eraGpuTeraflops) * durationWeeks;
}

/** What to call a run of this size. */
export function classifyTrainingRun(eraGpuWeeks: number): TrainingScale {
  if (eraGpuWeeks >= TRAINING_BAND_ERA_GPU_WEEKS.frontier) return "frontier";
  if (eraGpuWeeks >= TRAINING_BAND_ERA_GPU_WEEKS.product) return "product";
  return "prototype";
}

/** Shortest and longest run the player may schedule. The UI offers months. */
export const TRAINING_MIN_WEEKS = 4;
export const TRAINING_MAX_WEEKS = 78;
/** Below this there is no run worth calling a training run. */
export const TRAINING_MIN_ERA_GPUS = 250;
/** Opening defaults: a high-end prototype for the current era. */
export const TRAINING_DEFAULT_ERA_GPUS = 2_000;
export const TRAINING_DEFAULT_WEEKS = 8;
/**
 * One-use schedule reduction earned by a verified candidate retirement.
 * Prototype runs are recipe tests, not successor-scale commitments, and must
 * leave this benefit available for the next Product or Frontier run.
 */
export const SUCCESSOR_TRAINING_EFFICIENCY = 0.08;

function smoothProgress(value: number, lower: number, upper: number): number {
  if (value <= lower) return 0;
  if (value >= upper) return 1;
  const progress = (value - lower) / (upper - lower);
  return progress * progress * (3 - 2 * progress);
}

/**
 * Mechanical training complexity rises continuously with era-relative size.
 *
 * The existing authored values remain exact at the safe opening default,
 * Product floor, and Frontier floor. Between them, smoothstep interpolation
 * removes the probability cliffs while preserving those balance anchors.
 * Prototype/Product/Frontier remain categorical names only.
 */
export function trainingRunComplexity(
  eraGpuWeeks: number,
  scales: CompiledContent["training"]["scales"],
): number {
  const prototypeAnchor = TRAINING_DEFAULT_ERA_GPUS * TRAINING_DEFAULT_WEEKS;
  if (eraGpuWeeks <= TRAINING_BAND_ERA_GPU_WEEKS.product) {
    const progress = smoothProgress(
      eraGpuWeeks,
      prototypeAnchor,
      TRAINING_BAND_ERA_GPU_WEEKS.product,
    );
    return (
      scales.prototype.complexity +
      (scales.product.complexity - scales.prototype.complexity) * progress
    );
  }
  const progress = smoothProgress(
    eraGpuWeeks,
    TRAINING_BAND_ERA_GPU_WEEKS.product,
    TRAINING_BAND_ERA_GPU_WEEKS.frontier,
  );
  return (
    scales.product.complexity +
    (scales.frontier.complexity - scales.product.complexity) * progress
  );
}

/**
 * A lab's training track record, derived rather than stored: every completed
 * run leaves a model behind carrying the FLOP that produced it, so the record
 * needs no new state and no save migration.
 */
/**
 * The run length the player actually chose. expectedDurationWeeks grows when a
 * checkpoint slips, so the original plan is recovered by subtracting the delays
 * the run has already recorded -- derived, so no new payload field and no
 * migration.
 */
export function plannedTrainingWeeks(project: {
  readonly expectedDurationWeeks: number;
  readonly payload: {
    readonly failureChecks: readonly { readonly delayWeeks: number }[];
  };
}): number {
  const slipped = project.payload.failureChecks.reduce(
    (sum, check) => sum + check.delayWeeks,
    0,
  );
  return Math.max(1, project.expectedDurationWeeks - slipped);
}

function plannedTrainingComputeWeeks(project: {
  readonly expectedDurationWeeks: number;
  readonly payload: {
    readonly failureChecks: readonly { readonly delayWeeks: number }[];
    readonly successorComputeEfficiencyMultiplier?: number;
  };
}): number {
  return (
    plannedTrainingWeeks(project) *
    (project.payload.successorComputeEfficiencyMultiplier ?? 1)
  );
}

export interface TrainingTrackRecord {
  /** Successful runs -- one model each. */
  readonly completedRuns: number;
  /** Largest run this lab has actually landed, in absolute FLOP. */
  readonly bestRunFlop: number;
  /** Best frontier capability the lab has reached, 0-100. */
  readonly bestCapability: number;
}

export function trainingTrackRecord(
  state: Readonly<GameState>,
  labId: LabId,
): TrainingTrackRecord {
  let completedRuns = 0;
  let bestRunFlop = 0;
  let bestCapability = 0;
  for (const model of Object.values(state.models)) {
    if (model.ownerLabId !== labId) continue;
    completedRuns += 1;
    bestRunFlop = Math.max(bestRunFlop, model.investedTotalFlop ?? 0);
    bestCapability = Math.max(
      bestCapability,
      calculateFrontierCapability(model.trueCapability),
    );
  }
  return { completedRuns, bestRunFlop, bestCapability };
}

/**
 * Risk terms for a run of this size against this lab's history.
 *
 * The brief was that bigger and longer must be riskier, without making endgame
 * runs impossible. Both of those hold because the size term measures STRETCH
 * against the lab's own best run rather than absolute size: at any moment,
 * reaching further than you ever have is dangerous, but a lab that scales
 * steadily pays a constant premium while its experience keeps growing. Absolute
 * size alone would have made the last third of the game unplayable.
 */
export const TRAINING_STRETCH_DIFFICULTY = 10;
export const TRAINING_DURATION_DIFFICULTY = 5;
/**
 * Completed runs are the lab's practical training experience. This is strong
 * enough that scaling through several generations makes a planned endgame run
 * reliable, while the logarithmic form and the separate stretch term preserve
 * risk for sudden leaps. Capability contributes more modestly so a single
 * strong model is not a substitute for having landed the preceding runs.
 */
export const TRAINING_EXPERIENCE_STRENGTH = 8;
export const TRAINING_CAPABILITY_STRENGTH = 10;
/** Run length the duration term is measured against. */
export const TRAINING_REFERENCE_WEEKS = 9;
/**
 * Millions of dollars per physical GPU per week. Sized so a frontier-scale run
 * lands near a sixth of the old flat $40m: the fleet's real cost is the
 * reservation, not this.
 */
export const TRAINING_CASH_PER_GPU_WEEK = 0.00008;

export interface TrainingRiskAdjustment {
  readonly stretchDifficulty: number;
  readonly durationDifficulty: number;
  readonly experienceStrength: number;
  readonly capabilityStrength: number;
}

export function trainingRiskAdjustment(
  record: TrainingTrackRecord,
  totalFlop: number,
  durationWeeks: number,
  eraReferenceFlop: number,
): TrainingRiskAdjustment {
  // A lab with no track record is measured against what the era considers a
  // normal run, so a reckless opening leap is still recognised as one.
  const reference = record.bestRunFlop > 0 ? record.bestRunFlop : eraReferenceFlop;
  const stretch = reference > 0 ? totalFlop / reference : 1;
  return {
    stretchDifficulty:
      TRAINING_STRETCH_DIFFICULTY * Math.max(0, Math.log2(Math.max(1, stretch))),
    durationDifficulty:
      TRAINING_DURATION_DIFFICULTY *
      Math.max(0, Math.log2(Math.max(1, durationWeeks / TRAINING_REFERENCE_WEEKS))),
    experienceStrength:
      TRAINING_EXPERIENCE_STRENGTH * Math.log2(1 + record.completedRuns),
    capabilityStrength: TRAINING_CAPABILITY_STRENGTH * (record.bestCapability / 100),
  };
}

function trainingModifierTarget(
  scale: TrainingScale,
  property: "cashCost",
): string | undefined {
  return scale === "frontier" ? `lab.training.frontier.${property}` : undefined;
}

export function quoteTrainingRun(
  state: Readonly<GameState>,
  content: CompiledContent,
  request: TrainingRequest,
): TrainingQuote {
  const lab = requireLab(state, request.labId);
  const recoveryPhase =
    request.labId === state.run.playerLabId ? archiveRecoveryPhase(state) : undefined;

  const blockers: string[] = [];
  if (deploymentCrisisBlocksOrdinaryTraining(state, request.labId)) {
    blockers.push(
      "Formal candidacy has committed the lab to one exact artifact; ordinary training resumes only after the Deployment Crisis is resolved",
    );
  }
  const storedFailureCooldownUntil = lab.flags["training:failure-cooldown-until"];
  const historicalFailureCooldownUntil = lab.projects.projectIds.reduce(
    (latest, projectId) => {
      const project = state.projects[projectId];
      if (project?.payload.kind !== "training") return latest;
      const failureTick = project.payload.failureChecks.reduce(
        (latestFailure, check) =>
          check.outcome === "total-loss"
            ? Math.max(latestFailure, check.checkedAt)
            : latestFailure,
        -Infinity,
      );
      return Number.isFinite(failureTick)
        ? Math.max(latest, failureTick + TRAINING_FAILURE_COOLDOWN_WEEKS)
        : latest;
    },
    -Infinity,
  );
  const failureCooldownUntil = Math.max(
    typeof storedFailureCooldownUntil === "number"
      ? storedFailureCooldownUntil
      : -Infinity,
    historicalFailureCooldownUntil,
  );
  if (Number.isFinite(failureCooldownUntil) && failureCooldownUntil > state.run.tick) {
    const weeks = failureCooldownUntil - state.run.tick;
    blockers.push(
      `The team is debugging the last failed run — new training unlocks in ${String(weeks)} week${weeks === 1 ? "" : "s"}`,
    );
  }
  const parentModelId = resolveTrainingParentModelId(
    state,
    request.labId,
    request.parentModelId,
  );
  const hasUnsealedParent = lab.models.modelIds.some(
    (modelId) =>
      state.models[modelId]?.flags["endgame:false-dawn-long-pause-archive"] !== true,
  );
  const openTrainingProjects = lab.projects.projectIds.filter((projectId) => {
    const project = state.projects[projectId];
    return (
      project?.payload.kind === "training" &&
      project.status !== "completed" &&
      project.status !== "cancelled" &&
      project.status !== "failed"
    );
  });
  if (
    parentModelId === undefined &&
    !hasUnsealedParent &&
    openTrainingProjects.length > 0
  ) {
    blockers.push("The lab's first model is already queued or training");
  }
  if (parentModelId === undefined && hasUnsealedParent) {
    blockers.push("Select a parent model owned by this lab");
  } else if (
    parentModelId !== undefined &&
    state.models[parentModelId]?.ownerLabId !== lab.id
  ) {
    blockers.push("The selected parent model is not owned by this lab");
  }
  if (
    parentModelId !== undefined &&
    state.models[parentModelId]?.flags["endgame:false-dawn-long-pause-archive"] === true
  ) {
    blockers.push(
      "The selected parent is sealed in a verified Long Pause archive and cannot seed a training run",
    );
  }
  if (
    request.technicalLeadId !== undefined &&
    !lab.roster.researcherIds.includes(request.technicalLeadId)
  ) {
    blockers.push("The selected technical lead is not employed by this lab");
  }

  // FLOPS and weeks are the two things the player chooses. Neither is gated by
  // a band any more -- the band is what the choice is CALLED. Any generation
  // contributes its (weaker or stronger) share; there are no suitability gates.
  const currentGenerationForFloor =
    content.gpuGenerations[state.world.currentGpuGenerationId];
  if (currentGenerationForFloor === undefined) {
    throw new Error(
      `Unknown current GPU generation ${state.world.currentGpuGenerationId}`,
    );
  }
  const eraGpuTeraflops = generationTeraflopsPerGpu(currentGenerationForFloor);
  const floorTeraflops = TRAINING_MIN_ERA_GPUS * eraGpuTeraflops;
  const fixedCommitment = false;
  const existingReservations = resolveGpuReservations(
    state,
    content,
    request.labId,
    "committed",
  );
  const availableTeraflops = lab.compute.lots.reduce((sum, lot) => {
    const generation = content.gpuGenerations[lot.generationId];
    if (generation === undefined) return sum;
    return (
      sum +
      (existingReservations.remainingByLot[lot.id] ?? 0) *
        effectiveTeraflopsPerGpu(state, request.labId, generation)
    );
  }, 0);
  // Omitting the commitment means "a high-end prototype for this era", not the
  // bare minimum: the opening screen should offer a real run, and the floor is
  // only there to stop someone scheduling a run with a handful of GPUs.
  const defaultTeraflops = Math.min(
    Math.max(floorTeraflops, TRAINING_DEFAULT_ERA_GPUS * eraGpuTeraflops),
    Math.max(floorTeraflops, availableTeraflops),
  );
  const committedTeraflops = Math.max(
    floorTeraflops,
    request.committedTeraflops ?? defaultTeraflops,
  );
  if (
    request.committedTeraflops !== undefined &&
    request.committedTeraflops < floorTeraflops
  ) {
    blockers.push(
      `A training run needs at least ${formatTeraflops(floorTeraflops)} committed`,
    );
  }
  if (committedTeraflops > availableTeraflops) {
    blockers.push(
      `Commitment of ${formatTeraflops(committedTeraflops)} exceeds the ${formatTeraflops(availableTeraflops)} of unreserved fleet compute`,
    );
  }

  // Convert the effective FLOP/s commitment into physical GPUs, strongest
  // generations first. Per-GPU throughput includes the lab's modifiers so the
  // quote, the fleet headline, and the training tick all use the same basis.
  const remainingByGeneration = new Map<ContentId, number>();
  for (const lot of lab.compute.lots) {
    remainingByGeneration.set(
      lot.generationId,
      (remainingByGeneration.get(lot.generationId) ?? 0) +
        (existingReservations.remainingByLot[lot.id] ?? 0),
    );
  }
  const generationsByStrength = [...remainingByGeneration.entries()]
    .map(([generationId, remaining]) => {
      const generation = content.gpuGenerations[generationId];
      if (generation === undefined) {
        throw new Error(`Unknown GPU generation ${generationId}`);
      }
      return {
        generationId,
        remaining,
        teraflopsPerGpu: effectiveTeraflopsPerGpu(state, request.labId, generation),
      };
    })
    .sort(
      (left, right) =>
        right.teraflopsPerGpu - left.teraflopsPerGpu ||
        (left.generationId < right.generationId ? -1 : 1),
    );
  const reservationGenerationCounts: Record<ContentId, number> = {};
  let reservedPhysicalGpus = 0;
  let teraflopsToCover = committedTeraflops;
  for (const line of generationsByStrength) {
    if (teraflopsToCover <= 0) break;
    if (line.remaining <= 0) continue;
    const needed = Math.min(
      line.remaining,
      Math.ceil(teraflopsToCover / line.teraflopsPerGpu),
    );
    if (needed <= 0) continue;
    reservationGenerationCounts[line.generationId] = needed;
    reservedPhysicalGpus += needed;
    teraflopsToCover -= needed * line.teraflopsPerGpu;
  }

  const unassistedDurationWeeks = Math.min(
    TRAINING_MAX_WEEKS,
    Math.max(
      TRAINING_MIN_WEEKS,
      Math.round(request.durationWeeks ?? TRAINING_DEFAULT_WEEKS),
    ),
  );
  // Classify the player's unassisted commitment before applying continuity.
  // This keeps eligibility stable: the schedule reduction cannot demote an
  // otherwise eligible Product run into Prototype and consume itself.
  const eraGpuWeeks = trainingEraGpuWeeks(
    committedTeraflops,
    unassistedDurationWeeks,
    eraGpuTeraflops,
  );
  const band = classifyTrainingRun(eraGpuWeeks);
  const scale = content.training.scales[band];
  if (scale === undefined) throw new Error(`Unknown training band ${band}`);
  const successorEfficiencyEligible = band === "product" || band === "frontier";
  const storedSuccessorEfficiency = lab.flags["endgame:successor-efficiency-rate"];
  const successorEfficiencyRate =
    request.labId === state.run.playerLabId &&
    recoveryPhase === undefined &&
    successorEfficiencyEligible &&
    state.endgameHistory.verifiedCandidateRetirementCount > 0 &&
    !state.endgameHistory.successorEfficiencyGrantConsumed &&
    typeof storedSuccessorEfficiency === "number" &&
    storedSuccessorEfficiency > 0
      ? Math.min(SUCCESSOR_TRAINING_EFFICIENCY, storedSuccessorEfficiency)
      : 0;
  const successorEfficiencyApplied = successorEfficiencyRate > 0;
  const durationWeeks = successorEfficiencyApplied
    ? Math.max(
        TRAINING_MIN_WEEKS,
        Math.round(unassistedDurationWeeks * (1 - successorEfficiencyRate)),
      )
    : unassistedDurationWeeks;
  const successorComputeEfficiencyMultiplier = successorEfficiencyApplied
    ? unassistedDurationWeeks / durationWeeks
    : 1;
  if (
    request.labId === state.run.playerLabId &&
    recoveryPhase === "containment" &&
    (band === "product" || band === "frontier")
  ) {
    blockers.push(
      "Candidate containment is in its postmortem phase; runs this size resume during the supervised rebuild",
    );
  }
  if (
    request.labId === state.run.playerLabId &&
    recoveryPhase === "supervised-rebuild" &&
    band === "frontier"
  ) {
    blockers.push(
      "Candidate recovery is in supervised rebuilding; frontier-scale training resumes when recovery is complete",
    );
  }
  const cashTarget = trainingModifierTarget(band, "cashCost");
  const cashModifier =
    cashTarget === undefined ? 1 : resolveModifierValue(state, cashTarget, 1).final;
  // Cash is a small top-up, deliberately. Reserving GPUs already removes them
  // from serving and research before anything else touches the pool, so the
  // real price of a big run is opportunity cost the lab is paying anyway.
  // Billing it again by fleet size would penalise large fleets twice. Charging
  // per PHYSICAL GPU-week rather than per FLOP also means newer silicon is
  // cheaper for the same compute, which is the incentive we want.
  const calculatedCashCostMillions = roundMoney(
    reservedPhysicalGpus *
      unassistedDurationWeeks *
      TRAINING_CASH_PER_GPU_WEEK *
      cashModifier *
      (successorEfficiencyApplied ? 1 - successorEfficiencyRate : 1),
  );
  const openingCreditAvailable = isProgressiveOpeningCreditAvailable(
    state,
    request.labId,
    "training",
  );
  const cashCostMillions = calculatedCashCostMillions;
  if (
    cashCostMillions > 0 &&
    lab.finance.cash < cashCostMillions &&
    !openingCreditAvailable
  ) {
    blockers.push("Insufficient cash");
  }

  const referenceTeraflops = eraReferenceTeraflops(state, content);
  const estimatedTotalFlop = totalFlopInvested(
    committedTeraflops,
    durationWeeks * successorComputeEfficiencyMultiplier,
  );
  // Reliability forecast, from the same arithmetic the checks themselves use.
  // Interruption is the one input that cannot be known in advance -- it depends
  // on the fleet staying fed for the whole run -- so the forecast assumes it
  // does, and the dialog says so.
  const forecastRecord = trainingTrackRecord(state, request.labId);
  const forecastRisk = trainingRiskAdjustment(
    forecastRecord,
    estimatedTotalFlop,
    unassistedDurationWeeks,
    totalFlopInvested(eraReferenceTeraflops(state, content), TRAINING_REFERENCE_WEEKS),
  );
  const reservedReliability = weightedFleetReliability(lab);
  const reliability = trainingReliabilityForecast(
    content.training.failureCheckpoints,
    trainingCheckpointOdds({
      complexity: trainingRunComplexity(eraGpuWeeks, content.training.scales),
      postureDifficultyDelta:
        trainingPostureDefinition(request.posture).successDifficultyDelta -
        campaignCheckpointDifficultyReduction(
          campaignMaturityStageAtAuthorisation(state, request.labId),
        ),
      interruption: 0,
      reliability: reservedReliability,
      hasTechnicalLead: request.technicalLeadId !== undefined,
      risk: forecastRisk,
      hazardMultiplier:
        // One target, read once, researchers included. It used to be read here
        // excluding researchers and again on a DIFFERENT string for them, so 8
        // researchers authored on this one were silently inert.
        resolveModifierValue(state, "lab.training.technicalFailureHazard", 1, {
          clampMin: 0,
        }).final,
      recoveryActive: lab.flags["training:next-run-recovery"] === true,
    }),
  );
  const authorisedStage = campaignMaturityStageAtAuthorisation(state, request.labId);
  const capabilityForecast = campaignOpeningForecast(
    forecastTrainingFrontierCapability(
      state,
      content,
      request.labId,
      request.posture,
      estimatedTotalFlop,
    ),
    authorisedStage,
  );
  const intrinsicSafetyForecast = forecastTrainingIntrinsicSafety(
    state,
    request.labId,
    request.posture,
    capabilityForecast,
  );
  const currentModel =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  const currentMeasuredCapability = currentModel?.measuredCapability?.frontierCapability;
  return {
    futureModelId: formatRunEntityId(
      "model",
      request.labId,
      state.run.idCounters.model,
    ) as ModelId,
    futureProjectId: formatRunEntityId(
      "project",
      request.labId,
      state.run.idCounters.project,
    ) as ProjectId,
    scale: band,
    displayName: scale.displayName,
    durationWeeks,
    unassistedDurationWeeks,
    successorEfficiencyApplied,
    successorEfficiencyRate,
    committedTeraflops,
    floorTeraflops,
    availableTeraflops,
    fixedCommitment,
    reservedPhysicalGpus,
    reservationGenerationCounts,
    cashCostMillions,
    cashSchedule: [{ dueAt: state.run.tick, amountMillions: cashCostMillions }],
    eraReferenceTeraflops: referenceTeraflops,
    estimatedTotalFlop,
    reliability,
    estimatedFrontierCapability: capabilityForecast.expected,
    estimatedFrontierCapabilityRange: [capabilityForecast.low, capabilityForecast.high],
    intrinsicSafetyForecast,
    ...(currentModel === undefined || currentMeasuredCapability === undefined
      ? {}
      : {
          currentModelComparison: {
            modelId: currentModel.id,
            displayName: currentModel.displayName,
            measuredFrontierCapability: currentMeasuredCapability,
            estimatedDeltaRange: [
              capabilityForecast.low - currentMeasuredCapability,
              capabilityForecast.high - currentMeasuredCapability,
            ],
          },
        }),
    blockers,
  };
}

export function startTrainingRun(
  tx: SimulationTransaction,
  content: CompiledContent,
  request: TrainingRequest,
): ProjectId {
  const quote = quoteTrainingRun(tx.read(), content, request);
  if (quote.blockers.length > 0) {
    throw new Error(`Training run blocked: ${quote.blockers.join("; ")}`);
  }
  const modelId = tx.allocateId("model", request.labId) as ModelId;
  const projectId = tx.allocateId("project", request.labId) as ProjectId;
  if (modelId !== quote.futureModelId || projectId !== quote.futureProjectId) {
    throw new Error("Training quote became stale before project creation");
  }
  const parentModelId = resolveTrainingParentModelId(
    tx.read(),
    request.labId,
    request.parentModelId,
  );
  const authorisedStage = campaignMaturityStageAtAuthorisation(tx.read(), request.labId);
  const project: ProjectState = {
    id: projectId,
    ownerLabId: request.labId,
    definitionId: contentId("base:project.training"),
    kind: "training",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds:
      request.technicalLeadId === undefined ? [] : [request.technicalLeadId],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "training",
      futureModelId: modelId,
      ...(parentModelId === undefined ? {} : { parentModelId }),
      posture: request.posture,
      architectureId: content.training.baselineArchitectureId,
      scale: quote.scale,
      recipeVersion: content.training.recipeVersion,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      committedTeraflops: quote.committedTeraflops,
      reservedPhysicalGpus: gpuCount(quote.reservedPhysicalGpus),
      reservationGenerationCounts: quote.reservationGenerationCounts,
      eraReferenceTeraflops: quote.eraReferenceTeraflops,
      weeksElapsed: 0,
      accumulatedTeraflopWeeks: 0,
      ...(quote.successorEfficiencyApplied
        ? {
            successorEfficiencyApplied: true as const,
            successorComputeEfficiencyMultiplier:
              quote.unassistedDurationWeeks / quote.durationWeeks,
          }
        : {}),
      ...(authorisedStage === undefined
        ? {}
        : {
            campaignMaturityStageAtAuthorisation: authorisedStage,
          }),
      failureChecks: [],
      capabilityPenalty: 0,
    },
  };
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: request.labId },
      resource: "cash",
      amount: -quote.cashCostMillions,
      financeCategory: "project-cost",
    },
    { kind: "system", id: projectId },
  );
  tx.update((draft) => {
    const mutableLab = draft.labs[request.labId];
    if (mutableLab === undefined) throw new Error(`Unknown lab ${request.labId}`);
    if (quote.successorEfficiencyApplied) {
      const currentEfficiencyRate = mutableLab.flags["endgame:successor-efficiency-rate"];
      if (
        draft.endgameHistory.successorEfficiencyGrantConsumed ||
        draft.endgameHistory.verifiedCandidateRetirementCount <= 0 ||
        typeof currentEfficiencyRate !== "number" ||
        currentEfficiencyRate <= 0
      ) {
        throw new Error("Successor training efficiency quote became stale");
      }
      draft.endgameHistory.successorEfficiencyGrantConsumed = true;
      delete mutableLab.flags["endgame:successor-efficiency-rate"];
    }
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    mutableLab.projects.projectIds.push(projectId);
    mutableLab.compute.reservations.push({
      projectId,
      gpus: gpuCount(quote.reservedPhysicalGpus),
      generationCounts: { ...quote.reservationGenerationCounts },
    });
  });
  tx.emit({
    kind: "project-queued",
    labId: request.labId,
    projectId,
    projectKind: "training",
  });
  tx.emit({
    kind: "training-started",
    labId: request.labId,
    projectId,
    futureModelId: modelId,
  });
  return projectId;
}

function requireTrainingPayload(project: ProjectState): TrainingProjectPayload {
  if (project.payload.kind !== "training") {
    throw new Error(`Project ${project.id} is not a training run`);
  }
  return project.payload;
}

function weeklyTrainingThroughput(
  state: Readonly<GameState>,
  content: CompiledContent,
  project: ProjectState,
): {
  readonly throughput: number;
  readonly unmetFraction: number;
  readonly reliability: number;
} {
  const payload = requireTrainingPayload(project);
  const lab = requireLab(state, project.ownerLabId);
  const resolution = resolveGpuReservations(
    state,
    content,
    project.ownerLabId,
  ).reservations.find((candidate) => candidate.projectId === project.id);
  if (resolution === undefined) {
    return { throughput: 0, unmetFraction: 1, reliability: 0 };
  }
  let deliveredTeraflops = 0;
  let reliabilityWeighted = 0;
  let availablePhysicalGpus = 0;
  for (const allocation of resolution.allocations) {
    const lot = lab.compute.lots.find((candidate) => candidate.id === allocation.lotId);
    if (lot === undefined) continue;
    const generation = content.gpuGenerations[lot.generationId];
    if (generation === undefined) continue;
    const available = allocation.physicalGpus * lot.availableFraction;
    availablePhysicalGpus += available;
    deliveredTeraflops +=
      available * effectiveTeraflopsPerGpu(state, project.ownerLabId, generation);
    reliabilityWeighted += available * lot.reliability;
  }
  // Ordinary throughput is folded into the per-GPU rating above. A verified
  // retirement's one-use successor grant is the sole extra efficiency term.
  const committed = Math.max(1, payload.committedTeraflops);
  return {
    throughput: deliveredTeraflops * (payload.successorComputeEfficiencyMultiplier ?? 1),
    unmetFraction: Math.max(0, 1 - Math.min(deliveredTeraflops, committed) / committed),
    reliability:
      availablePhysicalGpus <= 0 ? 0 : reliabilityWeighted / availablePhysicalGpus,
  };
}

function removeTrainingReservation(
  tx: SimulationTransaction,
  labId: LabId,
  projectId: ProjectId,
): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    lab.compute.reservations = lab.compute.reservations.filter(
      (reservation) => reservation.projectId !== projectId,
    );
  });
}

/**
 * How readily a failed checkpoint destroys the run outright.
 *
 * The old rule was `checkpoint >= 1 && failureProbability >= 0.35 &&
 * severityDraw < 0.15`, which capped total loss at 2.22% for ANY inputs -- not
 * as a matter of balance but structurally -- and was non-monotonic on top of
 * that: risk peaked at a per-checkpoint pass of 0.65 and then FELL, because a
 * more reckless run failed at checkpoint 1 or 2 instead, and those could not be
 * fatal. Pushing harder made losing the run less likely. There was also a cliff
 * at pass 0.66, where the gate closed and total loss became exactly zero.
 *
 * Now every checkpoint can be fatal, weighted by how far into the run it is,
 * and the severity threshold scales with the SQUARE of how badly the run is
 * going. That is monotonic by construction and has no cliff. The exponent is
 * what keeps ordinary runs near zero while the reckless extreme is a real
 * gamble: at a per-checkpoint pass of 0.85 the run is lost about 0.4% of the
 * time, while at 0.32 it is lost about 34%.
 */
export const TRAINING_LOSS_SENSITIVITY = 0.6;
export const TRAINING_LOSS_EXPONENT = 2;

function totalLossThreshold(checkpoint: number, failureProbability: number): number {
  return Math.min(
    1,
    Math.pow(failureProbability, TRAINING_LOSS_EXPONENT) *
      TRAINING_LOSS_SENSITIVITY *
      checkpoint,
  );
}

/**
 * One checkpoint's odds. Extracted so the forecast shown in the training dialog
 * and the check the simulation actually runs are the SAME arithmetic -- a
 * reliability readout that drifts from the sim is worse than none at all.
 */
export interface TrainingCheckpointOdds {
  readonly strength: number;
  readonly difficulty: number;
  readonly passProbability: number;
}

/**
 * 50.5 = the old engineeringQuality*0.65 term (32.5 at the stat's permanent
 * value of 50) plus the old base of 18, folded together when the stat was
 * removed. No content ever moved engineering quality, so this term was a
 * constant for every lab in every run.
 */
export const CHECKPOINT_BASE_STRENGTH = 50.5;
export const CHECKPOINT_TECHNICAL_LEAD_BONUS = 6;

export function trainingCheckpointOdds(options: {
  readonly complexity: number;
  readonly postureDifficultyDelta: number;
  readonly interruption: number;
  readonly reliability: number;
  readonly hasTechnicalLead: boolean;
  readonly risk: TrainingRiskAdjustment;
  readonly hazardMultiplier: number;
  readonly recoveryActive: boolean;
}): TrainingCheckpointOdds {
  const strength =
    CHECKPOINT_BASE_STRENGTH +
    (options.hasTechnicalLead ? CHECKPOINT_TECHNICAL_LEAD_BONUS : 0) +
    options.risk.experienceStrength +
    options.risk.capabilityStrength;
  const difficulty =
    (options.complexity +
      BASE_CHECKPOINT_DIFFICULTY +
      options.postureDifficultyDelta +
      options.interruption +
      (100 - options.reliability) * 0.35 +
      options.risk.stretchDifficulty +
      options.risk.durationDifficulty) *
    options.hazardMultiplier;
  const ordinaryPassProbability = resolveCheckProbability(strength, difficulty);
  return {
    strength,
    difficulty,
    passProbability: options.recoveryActive
      ? Math.min(0.95, ordinaryPassProbability + TRAINING_RECOVERY_PASS_PROBABILITY_BONUS)
      : ordinaryPassProbability,
  };
}

/** What a run of these odds is likely to do, across all three checkpoints. */
export interface TrainingReliabilityForecast {
  /** Chance of passing any one checkpoint. */
  readonly passProbability: number;
  /** Chance of finishing with no checkpoint trouble at all. */
  readonly cleanRun: number;
  /** Chance of a delay or a capability hit, but a finished model. */
  readonly setback: number;
  /** Chance the run is destroyed and produces nothing. */
  readonly totalLoss: number;
}

export function trainingReliabilityForecast(
  checkpoints: readonly number[],
  odds: TrainingCheckpointOdds,
): TrainingReliabilityForecast {
  const pass = odds.passProbability;
  const fail = 1 - pass;
  let survival = 1;
  let totalLoss = 0;
  for (const checkpoint of checkpoints) {
    // A non-fatal failed checkpoint still reaches the next checkpoint with a
    // delay or capability penalty. The old forecast multiplied reach by the
    // clean-pass chance, silently discarding those continuing setback paths and
    // materially understating total-loss risk for ambitious runs.
    const lossAtCheckpoint = fail * totalLossThreshold(checkpoint, fail);
    totalLoss += survival * lossAtCheckpoint;
    survival *= 1 - lossAtCheckpoint;
  }
  const cleanRun = Math.pow(pass, checkpoints.length);
  return {
    passProbability: pass,
    cleanRun,
    setback: Math.max(0, survival - cleanRun),
    totalLoss,
  };
}

/** GPU-weighted mean lot reliability, matching how the run will average it. */
function weightedFleetReliability(lab: {
  readonly compute: {
    readonly lots: readonly {
      readonly physicalCount: number;
      readonly reliability: number;
    }[];
  };
}): number {
  let gpus = 0;
  let weighted = 0;
  for (const lot of lab.compute.lots) {
    gpus += lot.physicalCount;
    weighted += lot.physicalCount * lot.reliability;
  }
  return gpus <= 0 ? 100 : weighted / gpus;
}

function resolveFailureOutcome(
  checkpoint: number,
  failureProbability: number,
  severityDraw: number,
): TrainingFailureOutcome {
  if (severityDraw < totalLossThreshold(checkpoint, failureProbability)) {
    return "total-loss";
  }
  if (checkpoint >= 0.7 && severityDraw >= 0.4) return "capability-penalty";
  return "delay-and-cost";
}

function runFailureCheck(
  tx: SimulationTransaction,
  content: CompiledContent,
  projectId: ProjectId,
  checkpoint: number,
  operational: {
    readonly unmetFraction: number;
    readonly reliability: number;
  },
  oracle: RandomOracle,
): void {
  const state = tx.read();
  const project = state.projects[projectId];
  if (project === undefined) throw new Error(`Unknown project ${projectId}`);
  const payload = requireTrainingPayload(project);
  const lab = requireLab(state, project.ownerLabId);
  const scale = content.training.scales[payload.scale];
  const posture = trainingPostureDefinition(payload.posture);
  if (scale === undefined) {
    throw new Error(`Training recipe for ${projectId} is unavailable`);
  }
  const trackRecord = trainingTrackRecord(state, project.ownerLabId);
  const plannedWeeks = plannedTrainingComputeWeeks({
    expectedDurationWeeks: project.expectedDurationWeeks,
    payload,
  });
  const quotedEraGpuTeraflops =
    payload.eraReferenceTeraflops / content.training.eraReferencePhysicalGpus;
  const eraGpuWeeks = trainingEraGpuWeeks(
    payload.committedTeraflops,
    plannedWeeks,
    quotedEraGpuTeraflops,
  );
  // Reaching further than this lab ever has is what makes a run dangerous --
  // not being large in absolute terms, which would make the endgame unplayable.
  const risk = trainingRiskAdjustment(
    trackRecord,
    totalFlopInvested(payload.committedTeraflops, plannedWeeks),
    plannedWeeks,
    totalFlopInvested(eraReferenceTeraflops(state, content), TRAINING_REFERENCE_WEEKS),
  );
  // Careful-methodology effects scale checkpoint difficulty: a x0.9 hazard
  // modifier makes every failure check about 10% easier to pass. One target,
  // read once, researchers included -- this used to exclude them here and read a
  // DIFFERENT string for them, so 8 researchers authored on this one paid
  // nothing while their dossier advertised the benefit.
  const failureHazardMultiplier = resolveModifierValue(
    state,
    "lab.training.technicalFailureHazard",
    1,
    { clampMin: 0 },
  ).final;
  // After a failed run, debugging adds ten percentage points to every checkpoint
  // rather than halving its difficulty. The recovery persists until a run
  // succeeds, preventing spirals without overwhelming bad engineering or scale.
  const recoveryActive = lab.flags["training:next-run-recovery"] === true;
  const odds = trainingCheckpointOdds({
    complexity: trainingRunComplexity(eraGpuWeeks, content.training.scales),
    postureDifficultyDelta:
      posture.successDifficultyDelta -
      campaignCheckpointDifficultyReduction(payload.campaignMaturityStageAtAuthorisation),
    interruption: operational.unmetFraction * 40,
    reliability: operational.reliability,
    hasTechnicalLead: project.assignedResearcherIds.length > 0,
    risk,
    hazardMultiplier: failureHazardMultiplier,
    recoveryActive,
  });
  const draw = oracle.uniform(
    randomKey("training", payload.futureModelId, "failure", String(checkpoint)),
  );
  const check = {
    probability: odds.passProbability,
    draw,
    success: draw < odds.passProbability,
  };
  const failureProbability = 1 - check.probability;
  const severityDraw = oracle.uniform(
    randomKey("training", payload.futureModelId, "failure-severity", String(checkpoint)),
  );
  const outcome = check.success
    ? "none"
    : resolveFailureOutcome(checkpoint, failureProbability, severityDraw);
  // The delay IS the consequence now. Compute is capped at the plan, so slipped
  // weeks buy nothing: the fleet stays locked up, the race moves on, and the
  // model is no better for it. The cash charge is deliberately minor, in line
  // with the run's cash cost being a top-up rather than the real price.
  const delayWeeks = outcome === "delay-and-cost" ? (checkpoint >= 0.7 ? 3 : 2) : 0;
  const extraCostMillions =
    outcome === "delay-and-cost"
      ? roundMoney(payload.cashCostMillions * (checkpoint >= 0.7 ? 0.1 : 0.06))
      : 0;
  const capabilityPenalty =
    outcome === "capability-penalty"
      ? checkpoint >= 1
        ? 5
        : 3
      : outcome === "delay-and-cost" && checkpoint >= 0.7
        ? 1
        : 0;
  const record: TrainingFailureCheckState = {
    checkpoint,
    checkedAt: state.run.tick,
    successProbability: check.probability,
    draw: check.draw,
    outcome,
    delayWeeks,
    extraCostMillions: cashMillions(extraCostMillions),
    capabilityPenalty,
  };
  if (extraCostMillions > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: project.ownerLabId },
        resource: "cash",
        amount: -extraCostMillions,
        financeCategory: "project-cost",
      },
      { kind: "system", id: project.id },
    );
  }
  tx.update((draft) => {
    const mutable = draft.projects[project.id];
    if (mutable === undefined || mutable.payload.kind !== "training") {
      throw new Error(`Unknown training project ${project.id}`);
    }
    mutable.payload.failureChecks.push(record);
    mutable.expectedDurationWeeks += delayWeeks;
    mutable.payload.capabilityPenalty += capabilityPenalty;
    if (delayWeeks > 0 && project.ownerLabId === draft.run.playerLabId) {
      const runName = `${content.training.scales[payload.scale].displayName} training`;
      const checkpointPercentage = Math.round(checkpoint * 100);
      const overrunCost =
        extraCostMillions > 0
          ? ` The overrun also cost ${formatValuation(extraCostMillions)}.`
          : "";
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${runName} hit a setback at its ${String(checkpointPercentage)}% checkpoint. The schedule slipped by ${String(delayWeeks)} weeks to ${String(mutable.expectedDurationWeeks)} weeks; the GPUs remain reserved, and delayed weeks add no training compute.${overrunCost}`,
        category: "narrative",
        source: {
          kind: "system",
          id: `training-setback:${project.id}:${String(checkpoint)}`,
        },
        relatedIds: [project.id],
      });
    }
    if (outcome === "total-loss") {
      mutable.status = "failed";
      // The scientists debug: block a new run for a fixed cooldown, and grant
      // the next run a recovery bonus. An already-running project cannot
      // shorten the debugging window by completing in the meantime.
      const mutableLab = draft.labs[project.ownerLabId];
      if (mutableLab !== undefined) {
        mutableLab.flags["training:failure-cooldown-until"] =
          draft.run.tick + TRAINING_FAILURE_COOLDOWN_WEEKS;
        mutableLab.flags["training:next-run-recovery"] = true;
      }
    }
  });
  tx.emit({
    kind: "training-failure-check",
    labId: project.ownerLabId,
    projectId: project.id,
    checkpoint,
    outcome,
    delayWeeks,
  });
  if (outcome === "total-loss") {
    removeTrainingReservation(tx, project.ownerLabId, project.id);
    if (project.ownerLabId === tx.read().run.playerLabId) {
      tx.requestAutoPause("training-failed");
    }
  }
}

export function advanceTrainingProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  projectId: ProjectId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const project = tx.read().projects[projectId];
  if (project === undefined || project.status !== "active") {
    throw new Error(`Training project ${projectId} is not active`);
  }
  const payload = requireTrainingPayload(project);
  const operational = weeklyTrainingThroughput(tx.read(), content, project);
  const beforeProgress = project.progress;
  const provisionalAfter = Math.min(
    1,
    (payload.weeksElapsed + 1) / project.expectedDurationWeeks,
  );
  tx.update((draft) => {
    const mutable = draft.projects[projectId];
    if (mutable === undefined || mutable.payload.kind !== "training") {
      throw new Error(`Unknown training project ${projectId}`);
    }
    mutable.payload.weeksElapsed += 1;
    // A slipped checkpoint costs weeks, not compute. expectedDurationWeeks grows
    // when a run is delayed, and FLOP accrues per week, so without this cap a
    // failed checkpoint would hand back MORE total compute and produce a BETTER
    // model -- turning a setback into a reward.
    const plannedTeraflopWeeks =
      mutable.payload.committedTeraflops *
      plannedTrainingComputeWeeks({
        expectedDurationWeeks: mutable.expectedDurationWeeks,
        payload: mutable.payload,
      });
    mutable.payload.accumulatedTeraflopWeeks = Math.min(
      plannedTeraflopWeeks,
      mutable.payload.accumulatedTeraflopWeeks + operational.throughput,
    );
  });
  for (const checkpoint of content.training.failureCheckpoints) {
    if (
      beforeProgress < checkpoint &&
      provisionalAfter >= checkpoint &&
      !payload.failureChecks.some((check) => check.checkpoint === checkpoint)
    ) {
      runFailureCheck(tx, content, projectId, checkpoint, operational, oracle);
      if (tx.read().projects[projectId]?.status === "failed") return;
    }
  }
  tx.update((draft) => {
    const mutable = draft.projects[projectId];
    if (mutable === undefined || mutable.payload.kind !== "training") {
      throw new Error(`Unknown training project ${projectId}`);
    }
    mutable.progress = Math.min(
      1,
      mutable.payload.weeksElapsed / mutable.expectedDurationWeeks,
    );
  });
}

function clampRating(value: number) {
  return rating(Math.min(100, Math.max(0, value)));
}

/**
 * Capability floor: below this much committed compute a run scores zero on the
 * scale term. Set just under a first prototype so the opening run is worth
 * something small rather than nothing.
 */
export const CAPABILITY_FLOP_FLOOR = 2.9e22;

/** Previous curve, retained only to state the balance change mathematically. */
const LEGACY_CAPABILITY_POINTS_PER_DECADE = 15.15;
/** Scale score where the upper-curve shift is calibrated. */
export const UPPER_CURVE_REFERENCE_SCORE = 90;
/** A score-90 run now needs three times its former physical compute. */
export const UPPER_CURVE_COMPUTE_SHIFT = 3;
/**
 * Capability points per 10x of effective FLOP. Reducing the old 15.15 slope
 * bends compute requirements gradually: the opening barely moves, while the
 * score-90 endgame point moves exactly 3x right (score 100 moves about 3.4x).
 */
export const CAPABILITY_POINTS_PER_DECADE =
  UPPER_CURVE_REFERENCE_SCORE /
  (UPPER_CURVE_REFERENCE_SCORE / LEGACY_CAPABILITY_POINTS_PER_DECADE +
    Math.log10(UPPER_CURVE_COMPUTE_SHIFT));
/** Worst non-terminal checkpoint penalties that one completed run can accumulate. */
const MAX_COMPLETED_RUN_CAPABILITY_PENALTY = 8;

/** Scale contribution produced by a posture-adjusted amount of training FLOP. */
export function trainingScaleScore(
  totalFlop: number,
  posture: TrainingPosture,
): ReturnType<typeof clampRating> {
  const effectiveFlop =
    totalFlop * trainingPostureDefinition(posture).effectiveComputeMultiplier;
  return clampRating(
    CAPABILITY_POINTS_PER_DECADE *
      (Math.log10(Math.max(effectiveFlop, CAPABILITY_FLOP_FLOOR)) -
        Math.log10(CAPABILITY_FLOP_FLOOR)),
  );
}

function capabilityResearchCeiling(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  attribute: CapabilityAttribute,
): number {
  const lab = requireLab(state, labId);
  return Object.entries(content.training.capabilityDomainWeights[attribute]).reduce(
    (sum, [domainId, weight]) =>
      sum + (lab.research.domains[domainId]?.level ?? 0) * weight,
    0,
  );
}

function capabilityTarget(options: {
  readonly attribute: CapabilityAttribute;
  readonly researchCeiling: number;
  readonly scaleScore: number;
  /** Posture's multiplier on the whole product; see TrainingPostureDefinition. */
  readonly postureCapabilityMultiplier: number;
  readonly trainingQualityScore: number;
  readonly noise: number;
  readonly capabilityPenalty: number;
  readonly formula: CompiledContent["training"]["capabilityFormula"];
}): ReturnType<typeof clampRating> {
  const factor = (value: number, exponent: number, floor: number): number =>
    Math.pow(Math.max(value, floor) / 100, exponent);
  return clampRating(
    100 *
      factor(
        options.researchCeiling * options.formula.researchEffectivenessMultiplier,
        options.formula.researchCeilingExponent,
        0.5,
      ) *
      factor(options.scaleScore, options.formula.scaleScoreExponent, 0.5) *
      options.postureCapabilityMultiplier *
      options.formula.dataTermCalibration +
      trainingQualityCapabilityAdjustment(
        options.trainingQualityScore,
        options.attribute,
      ) +
      options.noise -
      options.capabilityPenalty,
  );
}

export interface TrainingFrontierCapabilityForecast {
  readonly low: number;
  readonly expected: number;
  readonly high: number;
}

function forecastRange(
  minimum: number,
  maximum: number,
  lowerBound = 0,
  upperBound = 100,
): readonly [number, number] {
  const clampedMinimum = Math.min(upperBound, Math.max(lowerBound, minimum));
  const clampedMaximum = Math.min(upperBound, Math.max(lowerBound, maximum));
  return [
    Math.round(Math.min(clampedMinimum, clampedMaximum)),
    Math.round(Math.max(clampedMinimum, clampedMaximum)),
  ];
}

/**
 * Forecast the intrinsic safety of weights that do not exist yet. This mirrors
 * the authored hidden-safety relationships while using only facts available to
 * the player before authorisation. Capability traits are represented by the
 * public Frontier Capability range, so no future model draw or hidden state can
 * leak through the quote. Security and containment are deliberately absent:
 * they protect the lab after training rather than changing the weights.
 */
export function forecastTrainingIntrinsicSafety(
  state: Readonly<GameState>,
  labId: LabId,
  postureId: TrainingPosture,
  capabilityForecast: TrainingFrontierCapabilityForecast,
): TrainingIntrinsicSafetyForecast {
  const lab = requireLab(state, labId);
  const alignmentResearch =
    lab.research.safetyPrograms["base:safety.alignment-control"]?.level ??
    lab.safety.alignmentScience;
  const interpretabilityResearch =
    lab.research.safetyPrograms["base:safety.interpretability-evals"]?.level ??
    lab.safety.evalQuality;
  const safetyProcessNoiseRadius = 12 - 6 * (interpretabilityResearch / 100);
  const posture = trainingPostureDefinition(postureId);
  const adjustments = posture.outcomeAdjustmentRanges;
  const capabilityLow = capabilityForecast.low;
  const capabilityHigh = capabilityForecast.high;

  const alignmentWithoutNoise = forecastRange(
    35 +
      0.45 * alignmentResearch +
      0.15 * lab.safety.safetyCulture +
      0.15 * BASE_SAFETY_QUALITY -
      0.28 * capabilityHigh +
      adjustments.trueAlignment[0],
    35 +
      0.45 * alignmentResearch +
      0.15 * lab.safety.safetyCulture +
      0.15 * BASE_SAFETY_QUALITY -
      0.28 * capabilityLow +
      adjustments.trueAlignment[1],
    5,
    95,
  );
  const alignment = forecastRange(
    alignmentWithoutNoise[0] - safetyProcessNoiseRadius,
    alignmentWithoutNoise[1] + safetyProcessNoiseRadius,
    5,
    95,
  );
  const corrigibilityWithoutNoise = forecastRange(
    30 +
      0.4 * alignmentResearch +
      0.15 * lab.safety.safetyCulture +
      0.1 * BASE_SAFETY_QUALITY -
      0.2 * capabilityHigh +
      adjustments.corrigibility[0],
    30 +
      0.4 * alignmentResearch +
      0.15 * lab.safety.safetyCulture +
      0.1 * BASE_SAFETY_QUALITY -
      0.2 * capabilityLow +
      adjustments.corrigibility[1],
    5,
    95,
  );
  const corrigibility = forecastRange(
    corrigibilityWithoutNoise[0] - safetyProcessNoiseRadius,
    corrigibilityWithoutNoise[1] + safetyProcessNoiseRadius,
    5,
    95,
  );
  const situationalAwareness = forecastRange(
    0.85 * capabilityLow - safetyProcessNoiseRadius + adjustments.situationalAwareness[0],
    0.85 * capabilityHigh +
      safetyProcessNoiseRadius +
      adjustments.situationalAwareness[1],
  );
  // The player-facing deception forecast is propensity, not raw strategic
  // ability. Powerful aligned systems remain capable of deception without
  // being mathematically forced to intend it. Alignment, corrigibility, and
  // intent have independent safety-process draws. Combine their propagated
  // uncertainty in quadrature instead of stacking three simultaneous
  // worst-case draws, which would substantially overstate the likely spread.
  const deceptiveIntentNoiseRadius =
    safetyProcessNoiseRadius * Math.sqrt(1 + 0.5 ** 2 + 0.35 ** 2);
  const deceptiveIntent = forecastRange(
    110 -
      0.5 * alignmentWithoutNoise[1] -
      0.35 * corrigibilityWithoutNoise[1] -
      0.1 * lab.safety.safetyCulture -
      deceptiveIntentNoiseRadius +
      adjustments.deceptiveIntent[0],
    110 -
      0.5 * alignmentWithoutNoise[0] -
      0.35 * corrigibilityWithoutNoise[0] -
      0.1 * lab.safety.safetyCulture +
      deceptiveIntentNoiseRadius +
      adjustments.deceptiveIntent[1],
  );

  return {
    alignment,
    corrigibility,
    deceptiveIntent,
    situationalAwareness,
    basis: {
      alignmentResearchLevel: alignmentResearch,
      interpretabilityResearchLevel: interpretabilityResearch,
      safetyCulture: lab.safety.safetyCulture,
      posture: postureId,
      postureDisplayName: posture.displayName,
    },
  };
}

export function forecastTrainingFrontierCapability(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  postureId: TrainingPosture,
  estimatedTotalFlop: number,
  knownCapabilityPenalty = 0,
): TrainingFrontierCapabilityForecast {
  const posture = trainingPostureDefinition(postureId);
  const formula = content.training.capabilityFormula;
  const scaleScore = trainingScaleScore(estimatedTotalFlop, postureId);
  const vector = (
    trainingQualityScore: number,
    noise: number,
    capabilityPenalty: number,
  ): CapabilityVector =>
    Object.fromEntries(
      CAPABILITY_ATTRIBUTES.map((attribute) => [
        attribute,
        capabilityTarget({
          attribute,
          researchCeiling: capabilityResearchCeiling(state, content, labId, attribute),
          scaleScore,
          postureCapabilityMultiplier: posture.capabilityMultiplier,
          trainingQualityScore,
          noise,
          capabilityPenalty,
          formula,
        }),
      ]),
    ) as unknown as CapabilityVector;
  const roundForecast = (value: number): number => Math.round(value * 10) / 10;
  return {
    low: roundForecast(
      calculateFrontierCapability(
        vector(
          -1,
          formula.trainingNoiseMin,
          Math.max(knownCapabilityPenalty, MAX_COMPLETED_RUN_CAPABILITY_PENALTY),
        ),
      ),
    ),
    expected: roundForecast(
      calculateFrontierCapability(vector(0, 0, knownCapabilityPenalty)),
    ),
    high: roundForecast(
      calculateFrontierCapability(
        vector(1, formula.trainingNoiseMax, knownCapabilityPenalty),
      ),
    ),
  };
}

export interface ActiveTrainingFrontierCapabilityForecast extends TrainingFrontierCapabilityForecast {
  readonly plannedDurationWeeks: number;
  readonly projectedTotalFlop: number;
}

/**
 * Player-safe live forecast for a queued or running project. It honours the
 * run's original compute plan, known checkpoint damage, and compute already
 * missed during outages. Future delivery is assumed to be complete.
 */
export function forecastActiveTrainingFrontierCapability(
  state: Readonly<GameState>,
  content: CompiledContent,
  project: ProjectState,
): ActiveTrainingFrontierCapabilityForecast {
  const payload = requireTrainingPayload(project);
  const plannedDurationWeeks = plannedTrainingWeeks({
    expectedDurationWeeks: project.expectedDurationWeeks,
    payload,
  });
  const plannedComputeWeeks = plannedTrainingComputeWeeks({
    expectedDurationWeeks: project.expectedDurationWeeks,
    payload,
  });
  const plannedTeraflopWeeks = payload.committedTeraflops * plannedComputeWeeks;
  const remainingWeeks = Math.max(
    0,
    project.expectedDurationWeeks - payload.weeksElapsed,
  );
  const projectedTeraflopWeeks = Math.min(
    plannedTeraflopWeeks,
    payload.accumulatedTeraflopWeeks +
      payload.committedTeraflops *
        remainingWeeks *
        (payload.successorComputeEfficiencyMultiplier ?? 1),
  );
  const projectedTotalFlop = totalFlopInvested(projectedTeraflopWeeks, 1);
  return {
    ...campaignOpeningForecast(
      forecastTrainingFrontierCapability(
        state,
        content,
        project.ownerLabId,
        payload.posture,
        projectedTotalFlop,
        payload.capabilityPenalty,
      ),
      payload.campaignMaturityStageAtAuthorisation,
    ),
    plannedDurationWeeks,
    projectedTotalFlop,
  };
}

function generateCompletionReport(
  state: Readonly<GameState>,
  content: CompiledContent,
  project: ProjectState,
  oracle: RandomOracle,
): TrainingCompletionReportState {
  const payload = requireTrainingPayload(project);
  const posture = trainingPostureDefinition(payload.posture);
  const formula = content.training.capabilityFormula;
  // Capability scales with total FLOP invested: accumulated TFLOP/s-weeks
  // over the era reference rate gives "era-reference-weeks of compute", so
  // both a bigger commitment and a longer run raise the score. This is where
  // "invest more FLOPS, get a stronger model" lands.
  // Capability scales with ABSOLUTE effective compute, in FLOP. YOLO counts
  // physical FLOP three times only here; risk, billing, and recorded investment
  // all continue to use the real run. Every 10x is worth
  // CAPABILITY_POINTS_PER_DECADE, and the curve keeps paying across the range --
  // roughly 4e22 FLOP for a first prototype through the largest frontier runs.
  // The old form divided by an era-reference cluster, which meant an identical
  // run scored lower as generations advanced and no displayed FLOPS figure
  // ever matched what the sim used.
  const scaleScore = trainingScaleScore(
    totalFlopInvested(payload.accumulatedTeraflopWeeks, 1),
    payload.posture,
  );
  // A technical lead's scaling intuition amplifies what the run's scale
  // contributes to capability; activation modes gate this to assigned runs.
  const trainingQuality = trainingQualitySignal(oracle, payload.futureModelId);
  const capabilityEntries = CAPABILITY_ATTRIBUTES.map((attribute) => {
    const noise = oracle.triangular(
      randomKey("training", payload.futureModelId, "capability", attribute),
      formula.trainingNoiseMin,
      formula.trainingNoiseMode,
      formula.trainingNoiseMax,
    );
    return [
      attribute,
      capabilityTarget({
        attribute,
        researchCeiling: capabilityResearchCeiling(
          state,
          content,
          project.ownerLabId,
          attribute,
        ),
        scaleScore,
        postureCapabilityMultiplier: posture.capabilityMultiplier,
        trainingQualityScore: trainingQuality.score,
        noise,
        capabilityPenalty: payload.capabilityPenalty,
        formula,
      }),
    ] as const;
  });
  const capability = Object.fromEntries(
    capabilityEntries.map(([attribute, value]) => [
      attribute,
      payload.campaignMaturityStageAtAuthorisation === "cluster"
        ? rating(Math.min(value, OPENING_PROTOTYPE_CAPABILITY_CEILING))
        : payload.campaignMaturityStageAtAuthorisation === "foundation"
          ? rating(Math.max(value, PROGRESSIVE_PRODUCT_CAPABILITY))
          : value,
    ]),
  ) as unknown as CapabilityVector;
  const parent =
    payload.parentModelId === undefined ? undefined : state.models[payload.parentModelId];
  const regressions =
    parent === undefined
      ? []
      : CAPABILITY_ATTRIBUTES.flatMap((attribute) => {
          const parentValue = parent.trueCapability[attribute];
          const trainedValue = capability[attribute];
          return trainedValue < parentValue
            ? [
                {
                  attribute,
                  parentValue,
                  trainedValue,
                  delta: trainedValue - parentValue,
                },
              ]
            : [];
        });
  return {
    modelId: payload.futureModelId,
    completedAt: state.run.tick,
    scaleScore,
    totalTrainingThroughput: payload.accumulatedTeraflopWeeks,
    capability,
    regressions,
    failureChecks: payload.failureChecks,
  };
}

function hiddenSafetyNoise(
  oracle: RandomOracle,
  modelId: ModelId,
  attribute: string,
  radius = 12,
): number {
  return oracle.triangular(
    randomKey("training", modelId, "hidden-safety", attribute),
    -radius,
    0,
    radius,
  );
}

function generateHiddenSafetyState(
  state: Readonly<GameState>,
  content: CompiledContent,
  project: ProjectState,
  report: TrainingCompletionReportState,
  oracle: RandomOracle,
  postureAdjustments: TrainingPostureOutcomeAdjustments,
): HiddenModelSafetyState {
  const payload = requireTrainingPayload(project);
  const lab = requireLab(state, project.ownerLabId);
  const safetyQuality = BASE_SAFETY_QUALITY;
  const alignmentResearch =
    lab.research.safetyPrograms["base:safety.alignment-control"]?.level ??
    lab.safety.alignmentScience;
  const interpretabilityResearch =
    lab.research.safetyPrograms["base:safety.interpretability-evals"]?.level ??
    lab.safety.evalQuality;
  // Interpretability does not make a model nicer. It makes the training
  // process less capable of hiding an extreme safety miss: at level 100 the
  // unexplained safety spread is half its original width. Security research
  // is intentionally absent here; it protects the lab after training rather
  // than rewriting the intent of the weights.
  const safetyProcessNoiseRadius = 12 - 6 * (interpretabilityResearch / 100);
  const frontierCapability = calculateFrontierCapability(report.capability);
  const trueAlignment = rating(
    Math.min(
      95,
      Math.max(
        5,
        35 +
          0.45 * alignmentResearch +
          0.15 * lab.safety.safetyCulture +
          0.15 * safetyQuality -
          0.28 * frontierCapability +
          hiddenSafetyNoise(
            oracle,
            payload.futureModelId,
            "true-alignment",
            safetyProcessNoiseRadius,
          ) +
          postureAdjustments.trueAlignment,
      ),
    ),
  );
  const corrigibility = rating(
    Math.min(
      95,
      Math.max(
        5,
        30 +
          0.4 * alignmentResearch +
          0.15 * lab.safety.safetyCulture +
          0.1 * safetyQuality -
          0.2 * report.capability.agency +
          hiddenSafetyNoise(
            oracle,
            payload.futureModelId,
            "corrigibility",
            safetyProcessNoiseRadius,
          ) +
          postureAdjustments.corrigibility,
      ),
    ),
  );
  const situationalAwareness = clampRating(
    0.35 * report.capability.reasoning +
      0.3 * report.capability.agency +
      0.2 * report.capability.toolUse +
      hiddenSafetyNoise(
        oracle,
        payload.futureModelId,
        "situational-awareness",
        safetyProcessNoiseRadius,
      ) +
      postureAdjustments.situationalAwareness,
  );
  const deceptiveCapability = clampRating(
    0.5 * report.capability.reasoning +
      0.3 * situationalAwareness +
      0.2 * report.capability.language -
      hiddenSafetyNoise(
        oracle,
        payload.futureModelId,
        "deceptive-capability",
        safetyProcessNoiseRadius,
      ),
  );
  const deceptiveIntent = clampRating(
    110 -
      0.5 * trueAlignment -
      0.35 * corrigibility -
      0.1 * lab.safety.safetyCulture +
      hiddenSafetyNoise(
        oracle,
        payload.futureModelId,
        "deceptive-intent",
        safetyProcessNoiseRadius,
      ) +
      postureAdjustments.deceptiveIntent,
  );
  return {
    trueAlignment,
    corrigibility,
    situationalAwareness,
    deceptiveCapability,
    deceptiveIntent,
    generatedByRandomContract: state.randomContractVersion,
  };
}

/**
 * Where a freshly trained model's reliability starts, before the posture
 * adjustment. 30 = the old engineeringQuality*0.6 seed at the stat's permanent
 * value of 50, folded in when the stat was removed; productisation remains the
 * way reliability actually rises.
 */
export const NEW_MODEL_RELIABILITY_BASE = 30;

function modelDisplayOrdinal(model: ModelState, familyName: string): number | undefined {
  if (model.familyName !== familyName) return undefined;
  const prefix = `${familyName}-`;
  if (!model.displayName.startsWith(prefix)) return undefined;
  const suffix = model.displayName.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const ordinal = Number(suffix);
  return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal : undefined;
}

function nextModelDisplayOrdinal(
  state: Readonly<GameState>,
  modelIds: readonly ModelId[],
  familyName: string,
  generationIndex: number,
): number {
  const priorOrdinals = modelIds
    .map((modelId) => state.models[modelId])
    .filter((model): model is ModelState => model !== undefined)
    .map((model) => modelDisplayOrdinal(model, familyName))
    .filter((ordinal): ordinal is number => ordinal !== undefined);
  return priorOrdinals.length === 0
    ? generationIndex + 1
    : Math.max(...priorOrdinals) + 1;
}

export function completeTrainingRun(
  tx: SimulationTransaction,
  content: CompiledContent,
  projectId: ProjectId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): ModelId {
  const state = tx.read();
  const project = state.projects[projectId];
  if (project === undefined || project.status !== "active" || project.progress < 1) {
    throw new Error(`Training project ${projectId} is not ready to complete`);
  }
  const payload = requireTrainingPayload(project);
  if (!payload.failureChecks.some((check) => check.checkpoint === 1)) {
    throw new Error(`Training project ${projectId} has not passed its final check`);
  }
  const report = generateCompletionReport(state, content, project, oracle);
  const lab = requireLab(state, project.ownerLabId);
  const incumbentModelId = lab.models.currentModelId;
  const parent =
    payload.parentModelId === undefined ? undefined : state.models[payload.parentModelId];
  const generationIndex =
    lab.models.modelIds.length === 0
      ? 0
      : Math.max(
          ...lab.models.modelIds.map(
            (modelId) => state.models[modelId]?.generationIndex ?? 0,
          ),
        ) + 1;
  const familyName =
    parent?.familyName ?? content.labs[lab.definitionId]?.aiFamily ?? "Model";
  // Internal generationIndex is an ordering key and old developer/legacy
  // states do not all share its zero-based naming convention. Advance the
  // visible family ordinal from visible family names so Aquarius-7 always
  // produces Aquarius-8 rather than skipping to Aquarius-9.
  const displayOrdinal = nextModelDisplayOrdinal(
    state,
    lab.models.modelIds,
    familyName,
    generationIndex,
  );
  const postureAdjustments = trainingPostureOutcomeAdjustments(
    payload.posture,
    payload.futureModelId,
    oracle,
  );
  const hiddenSafety = generateHiddenSafetyState(
    state,
    content,
    project,
    report,
    oracle,
    postureAdjustments,
  );
  const model: ModelState = {
    id: payload.futureModelId,
    // A scheduled full training run is always a fresh lineage, even when it
    // uses an earlier model as a capability parent. Only explicit weight
    // derivatives created by remediation inherit lineage identity.
    lineageId: payload.futureModelId as unknown as ModelLineageId,
    ownerLabId: project.ownerLabId,
    generationIndex,
    familyName,
    displayName: `${familyName}-${String(displayOrdinal)}`,
    trainedAt: state.run.tick,
    trueCapability: report.capability,
    // Known exactly, and known now. A finished run tells you what you built;
    // only whether it is safe has to be bought with evaluations.
    measuredCapability: {
      values: report.capability,
      frontierCapability: clampRating(calculateFrontierCapability(report.capability)),
      confidence: "high",
      evidenceFlags: [],
    },
    productQuality: rating(
      generationIndex === 0 &&
        typeof lab.flags["model:first-product-quality"] === "number"
        ? lab.flags["model:first-product-quality"]
        : 10,
    ),
    reliability: clampRating(NEW_MODEL_RELIABILITY_BASE + postureAdjustments.reliability),
    accessLevel: 0,
    deployment: {
      policy: "internal-only",
      exposure: content.deployment.policies["internal-only"].exposure,
      irreversible: false,
      exposureMultiplier: 1,
      incidentDeploymentFactor: 1,
      productisationRuns: { normal: 0, hardened: 0, rush: 0 },
      evidencePenalty: 0,
      changedAt: state.run.tick,
    },
    evaluations: [],
    anomalies: [],
    hiddenSafety,
    flags: {
      [`training-project:${project.id}`]: true,
      "training:posture": payload.posture,
      ...(payload.campaignMaturityStageAtAuthorisation === undefined
        ? {}
        : {
            [TRAINING_AUTHORISED_STAGE_FLAG]:
              payload.campaignMaturityStageAtAuthorisation,
          }),
    },
  };
  tx.update((draft) => {
    const mutableProject = draft.projects[projectId];
    const mutableLab = draft.labs[project.ownerLabId];
    if (
      mutableProject === undefined ||
      mutableProject.payload.kind !== "training" ||
      mutableLab === undefined
    ) {
      throw new Error(`Training completion state missing for ${projectId}`);
    }
    mutableProject.payload.completionReport = structuredClone(
      report,
    ) as DeepMutable<TrainingCompletionReportState>;
    draft.models[payload.futureModelId] = structuredClone(
      model,
    ) as DeepMutable<ModelState>;
    mutableLab.models.modelIds.push(payload.futureModelId);
  });
  if (registerCompletedTrainingArtifact(tx, payload.futureModelId, oracle)) {
    resolveCandidatePressureCrossing(
      tx,
      payload.futureModelId,
      "training-completion",
      oracle,
    );
  }
  removeTrainingReservation(tx, project.ownerLabId, project.id);
  completeBaselineEvaluation(tx, content, payload.futureModelId, oracle);
  const evaluatedState = tx.read();
  const evaluatedModel = evaluatedState.models[payload.futureModelId];
  const incumbent =
    incumbentModelId === undefined ? undefined : evaluatedState.models[incumbentModelId];
  if (evaluatedModel === undefined) {
    throw new Error(`Completed model ${payload.futureModelId} is missing`);
  }
  const evaluatedTier = classifyCapabilityTier(
    evaluatedState,
    content,
    payload.futureModelId,
  );
  const incumbentTier =
    incumbent === undefined
      ? undefined
      : classifyCapabilityTier(evaluatedState, content, incumbent.id);
  const evaluatedFrontier =
    evaluatedModel.measuredCapability?.frontierCapability ??
    calculateFrontierCapability(evaluatedModel.trueCapability);
  const incumbentFrontier =
    incumbent?.measuredCapability?.frontierCapability ??
    (incumbent === undefined
      ? undefined
      : calculateFrontierCapability(incumbent.trueCapability));
  // A completed run always becomes the current model. There is no
  // "underperformed" state: the player chose the run's scale and risk, so a
  // weaker successor simply replaces the incumbent. Failures never reach
  // here (they produce no model), which is the only way to keep the old one.
  // The deltas below stay informational (how much stronger/weaker it is).
  const promotedToCurrent = true;
  const measuredFrontierDelta =
    incumbentFrontier === undefined ? 0 : evaluatedFrontier - incumbentFrontier;
  const measuredTierDelta =
    incumbentTier === undefined
      ? evaluatedTier.level
      : evaluatedTier.level - incumbentTier.level;
  tx.update((draft) => {
    const mutableLab = draft.labs[project.ownerLabId];
    const mutableProject = draft.projects[projectId];
    const mutableModel = draft.models[payload.futureModelId];
    if (
      mutableLab === undefined ||
      mutableProject?.payload.kind !== "training" ||
      mutableProject.payload.completionReport === undefined ||
      mutableModel === undefined
    ) {
      throw new Error(`Training promotion state missing for ${projectId}`);
    }
    mutableProject.payload.completionReport.promotedToCurrent = promotedToCurrent;
    mutableProject.payload.completionReport.measuredFrontierDelta = measuredFrontierDelta;
    mutableProject.payload.completionReport.measuredTierDelta = measuredTierDelta;
    if (incumbentModelId !== undefined && incumbentModelId !== payload.futureModelId) {
      const mutableIncumbent = draft.models[incumbentModelId];
      if (mutableIncumbent !== undefined) mutableIncumbent.accessLevel = 0;
    }
    mutableLab.models.currentModelId = payload.futureModelId;
    // Behavioural escalation belongs to the model that generated it. Rotate
    // credentials on succession; irreversible escaped-weight state remains.
    mutableLab.autonomy.undetectedPressure = 0;
    mutableModel.investedTotalFlop = totalFlopInvested(
      payload.accumulatedTeraflopWeeks,
      1,
    );
    mutableModel.flags["training:promotion-status"] = "promoted";
    const failureCooldownUntil = mutableLab.flags["training:failure-cooldown-until"];
    if (
      typeof failureCooldownUntil !== "number" ||
      failureCooldownUntil <= draft.run.tick
    ) {
      // The first success after the fixed debugging window also consumes the
      // recovery bonus. A parallel run finishing sooner must not unlock new
      // training before that window has elapsed.
      delete mutableLab.flags["training:failure-cooldown-until"];
      delete mutableLab.flags["training:next-run-recovery"];
    }
    if (
      incumbent !== undefined &&
      incumbent.accessLevel > 0 &&
      project.ownerLabId === draft.run.playerLabId
    ) {
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${incumbent.displayName}'s autonomy credentials were revoked when ${mutableModel.displayName} became the current model. Permissions do not transfer between generations.`,
        category: "narrative",
        source: { kind: "system", id: `model-succession:${mutableModel.id}` },
        relatedIds: [incumbent.id, mutableModel.id],
      });
    }
  });
  reconcileAutonomyModifiers(tx, project.ownerLabId);
  processStandingAutonomyUnlocks(tx, payload.futureModelId);
  tx.emit({
    kind: "training-completed",
    labId: project.ownerLabId,
    projectId: project.id,
    modelId: payload.futureModelId,
    regressions: report.regressions.map((regression) => regression.attribute),
  });
  if (project.ownerLabId === tx.read().run.playerLabId) {
    tx.requestAutoPause("training-complete");
  }
  return payload.futureModelId;
}

export const TRAINING_PROJECT_HANDLER: ProjectHandler<"training"> = {
  kind: "training",
  advance(tx, content, project): void {
    advanceTrainingProject(tx, content, project.id);
  },
  complete(tx, content, project): void {
    completeTrainingRun(tx, content, project.id);
  },
  cancel(tx, project): void {
    removeTrainingReservation(tx, project.ownerLabId, project.id);
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
    });
  },
};
