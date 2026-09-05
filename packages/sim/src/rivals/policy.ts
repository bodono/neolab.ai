import type {
  CompiledContent,
  ContentId,
  DeploymentPolicy,
  ProductisationMode,
  TrainingPosture,
} from "@neolab/content-schema";

import type {
  BuyGpusCommand,
  SellGpusCommand,
  SetGpuAllocationCommand,
  SetModelDeploymentPolicyCommand,
  StartProductisationCommand,
  StartTrainingRunCommand,
} from "../commands/types.ts";
import { validateCommand } from "../commands/validate.ts";
import {
  buyGpus,
  quoteGpuPurchase,
  quoteGpuSale,
  sellGpus,
} from "../compute/gpu-market.ts";
import {
  fleetTeraflops,
  generationTeraflopsPerGpu,
  teraflopsForTotalFlop,
} from "../compute/flops.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { calculateFacilityCapacity } from "../facilities/facilities.ts";
import { currentMark } from "../finance/valuation.ts";
import {
  FRONTIER_PHASE_FRONTIER_CAPABILITY,
  SCALING_PHASE_FRONTIER_CAPABILITY,
} from "../engine/world-progression.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import type { CommandId, LabId, ModelId, ResearcherId } from "../model/ids.ts";
import type {
  GamePhase,
  GameState,
  GpuAllocationState,
  RivalPersonalityKey,
  RivalPersonalityState,
  RivalPlanScoreState,
  RivalQuarterPlanDecisionState,
  RivalStrategicPlanId,
  RivalStrategyState,
} from "../model/state.ts";
import { calculateServingDemandCap, resolveCommercialModelId } from "../market/market.ts";
import { basisPoints, rating, tick, type Rating, type Tick } from "../model/units.ts";
import {
  quoteProductisation,
  setModelDeploymentPolicy,
  startProductisation,
} from "../productisation/productisation.ts";
import { randomKey } from "../random/key.ts";
import { compareCodePoints, type RandomOracle } from "../random/oracle.ts";
import {
  hasAcceptedUltimatumProtection,
  startPoachingAttempt,
} from "../researchers/people.ts";
import {
  quoteTrainingRun,
  startTrainingRun,
  trainingTrackRecord,
  type TrainingQuote,
} from "../training/training.ts";
import { isProgressiveCampaign, labMaturityStage } from "../campaign/lab-maturity.ts";
import { recordRivalPublicSignal } from "./signals.ts";

// Recruiting approaches are memorable interruptions, not quarterly admin.
// Review the market once per year and let the most interested rival make one
// approach. This also keeps the mechanic alive when every rival's primary plan
// is frontier training rather than requiring one to devote a whole quarter to
// a talent raid.
const TALENT_RAID_INTERVAL_WEEKS = 52;
const NEW_HIRE_POACHING_PROTECTION_WEEKS = 52;
const RESEARCHER_POACHING_COOLDOWN_WEEKS = 52;
const MAX_APPROACHES_PER_RAID = 1;

/**
 * Rival campuses are deliberately abstract, but their fleet scale must still
 * track the same physical milestones the player builds. Once the hardware race
 * reaches the largest datacentre eras, targets step through the player-facing
 * Hyperscale Campus, Gigawatt Complex, and Basilica capacities.
 */
const RIVAL_LATE_ERA_FLEET_TARGETS: Readonly<Record<string, number>> = {
  "base:gpu.hopper": 80_000,
  "base:gpu.blackwell": 250_000,
  "base:gpu.rubin": 800_000,
  "base:gpu.markov": 2_500_000,
  "base:gpu.kolmogorov": 2_500_000,
};

/** One sovereign-scale procurement tranche, in units of one thousand GPUs. */
export const RIVAL_MAX_GPU_ORDER_THOUSANDS = 800;

function largestAffordableGpuOrder(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  generationId: ContentId,
  maximumThousandUnits: number,
): number {
  let lower = 1;
  let upper = Math.max(0, Math.floor(maximumThousandUnits));
  let affordable = 0;
  while (lower <= upper) {
    const candidate = Math.floor((lower + upper) / 2);
    const quote = quoteGpuPurchase(state, content, labId, generationId, candidate);
    if (quote.canPurchase) {
      affordable = candidate;
      lower = candidate + 1;
    } else {
      upper = candidate - 1;
    }
  }
  return affordable;
}

/**
 * How large a fleet a rival is building toward. Keyed on whether it is chasing
 * the frontier rather than on a scale band, now that runs are sized rather than
 * picked from a list; the numbers are unchanged.
 */
export function rivalFleetTargetEraGpuEquivalents(
  state: Readonly<GameState>,
  frontierAmbition: boolean,
): number {
  return (
    RIVAL_LATE_ERA_FLEET_TARGETS[state.world.currentGpuGenerationId] ??
    (frontierAmbition ? 25_000 : state.run.phase === "scaling" ? 20_000 : 15_000)
  );
}

export interface RivalDecisionContext {
  readonly tick: Tick;
  readonly quarterIndex: number;
  readonly world: {
    readonly phase: GamePhase;
    readonly publishedPaperCount: number;
  };
  readonly lab: {
    readonly labId: LabId;
    readonly labDefinitionId: ContentId;
    readonly cashStability: Rating;
    readonly computeCapacity: number;
    readonly capabilityLevel: Rating;
    readonly safetyReadiness: Rating;
    readonly governmentTrust: Rating;
    readonly marketShare: Rating;
    readonly allocation: GpuAllocationState;
    readonly servingDemandCapBasisPoints: number;
    readonly capabilityProgramIds: readonly ContentId[];
    readonly safetyProgramIds: readonly ContentId[];
  };
  readonly personality: RivalPersonalityState;
  readonly currentPlanId: RivalStrategicPlanId;
}

export interface RivalPlanDefinition {
  readonly id: RivalStrategicPlanId;
  readonly baseUtility: number;
  readonly personalityWeights: Partial<Record<RivalPersonalityKey, number>>;
  readonly commitmentWeeks: number;
  readonly servingFleetShareBasisPoints: number;
  readonly capabilityBasisPoints: number;
  readonly focus: "capability" | "safety";
}

export interface RivalPlanSelection {
  readonly selected: RivalPlanScoreState;
  readonly topPlans: readonly RivalPlanScoreState[];
}

export interface RivalPolicy {
  chooseQuarterPlan(
    context: RivalDecisionContext,
    random: RandomOracle,
  ): RivalPlanSelection;
  chooseWeeklyCommands(context: RivalDecisionContext): readonly RivalPolicyCommand[];
}

export type RivalPolicyCommand =
  | SetGpuAllocationCommand
  | BuyGpusCommand
  | SellGpusCommand
  | StartTrainingRunCommand
  | StartProductisationCommand
  | SetModelDeploymentPolicyCommand;

const DEFAULT_PERSONALITY: RivalPersonalityState = Object.freeze({
  sciencePrestige: rating(65),
  commercialGrowth: rating(65),
  raceUrgency: rating(65),
  safetyCommitment: rating(60),
  secrecy: rating(55),
  politicalCooperation: rating(60),
  talentAggression: rating(60),
  financialRisk: rating(60),
});

/** Mechanical data only; presentation copy remains in authored content. */
export const RIVAL_PERSONALITIES: Readonly<Record<string, RivalPersonalityState>> =
  Object.freeze({
    "base:lab.deepbrain": Object.freeze({
      sciencePrestige: rating(95),
      commercialGrowth: rating(60),
      raceUrgency: rating(74),
      safetyCommitment: rating(76),
      secrecy: rating(45),
      politicalCooperation: rating(78),
      talentAggression: rating(55),
      financialRisk: rating(48),
    }),
    "base:lab.deepsearch": Object.freeze({
      sciencePrestige: rating(82),
      commercialGrowth: rating(76),
      raceUrgency: rating(91),
      safetyCommitment: rating(48),
      secrecy: rating(88),
      politicalCooperation: rating(44),
      talentAggression: rating(67),
      financialRisk: rating(72),
    }),
    "base:lab.humanic": Object.freeze({
      sciencePrestige: rating(78),
      commercialGrowth: rating(55),
      raceUrgency: rating(66),
      safetyCommitment: rating(96),
      secrecy: rating(42),
      politicalCooperation: rating(88),
      talentAggression: rating(44),
      financialRisk: rating(34),
    }),
    "base:lab.openmind": Object.freeze({
      sciencePrestige: rating(87),
      commercialGrowth: rating(88),
      raceUrgency: rating(97),
      safetyCommitment: rating(58),
      secrecy: rating(65),
      politicalCooperation: rating(62),
      talentAggression: rating(78),
      financialRisk: rating(87),
    }),
    "base:lab.xmind": Object.freeze({
      sciencePrestige: rating(58),
      commercialGrowth: rating(86),
      raceUrgency: rating(100),
      safetyCommitment: rating(32),
      secrecy: rating(28),
      politicalCooperation: rating(30),
      talentAggression: rating(92),
      financialRisk: rating(96),
    }),
  });

export const RIVAL_PLAN_DEFINITIONS: readonly RivalPlanDefinition[] = Object.freeze([
  {
    id: "balanced-research",
    baseUtility: 38,
    personalityWeights: { sciencePrestige: 0.12, safetyCommitment: 0.05 },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 4000,
    capabilityBasisPoints: 6800,
    focus: "capability",
  },
  {
    id: "publish-sprint",
    baseUtility: 24,
    personalityWeights: { sciencePrestige: 0.28, secrecy: -0.11 },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 2500,
    capabilityBasisPoints: 7800,
    focus: "capability",
  },
  {
    id: "frontier-training",
    baseUtility: 20,
    personalityWeights: { raceUrgency: 0.31, financialRisk: 0.12 },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 1500,
    capabilityBasisPoints: 9000,
    focus: "capability",
  },
  {
    id: "commercial-consolidation",
    baseUtility: 22,
    personalityWeights: { commercialGrowth: 0.3, financialRisk: -0.05 },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 7600,
    capabilityBasisPoints: 6200,
    focus: "capability",
  },
  {
    id: "safety-stand-down",
    baseUtility: 18,
    personalityWeights: { safetyCommitment: 0.34, raceUrgency: -0.08 },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 2800,
    capabilityBasisPoints: 1800,
    focus: "safety",
  },
  {
    id: "talent-raid",
    baseUtility: 18,
    personalityWeights: { talentAggression: 0.34, commercialGrowth: 0.06 },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 4300,
    capabilityBasisPoints: 7000,
    focus: "capability",
  },
  {
    id: "government-partnership",
    baseUtility: 17,
    personalityWeights: {
      politicalCooperation: 0.32,
      secrecy: -0.06,
      commercialGrowth: 0.04,
    },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 5200,
    capabilityBasisPoints: 5600,
    focus: "safety",
  },
  {
    id: "coalition-outreach",
    baseUtility: 8,
    personalityWeights: {
      politicalCooperation: 0.28,
      safetyCommitment: 0.18,
      secrecy: -0.08,
    },
    commitmentWeeks: 13,
    servingFleetShareBasisPoints: 3600,
    capabilityBasisPoints: 4800,
    focus: "safety",
  },
]);

function clampRating(value: number): Rating {
  return rating(Math.max(0, Math.min(100, Math.round(value))));
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function situationalUtility(
  planId: RivalStrategicPlanId,
  context: RivalDecisionContext,
): number {
  switch (planId) {
    case "balanced-research":
      return context.world.phase === "foundation" ? 10 : 2;
    case "publish-sprint":
      return context.world.publishedPaperCount < 4 ? 8 : 1;
    case "frontier-training":
      return (
        context.lab.capabilityLevel * 0.16 +
        context.lab.computeCapacity / 20_000 +
        (context.world.phase === "foundation" ? -18 : 8)
      );
    case "commercial-consolidation":
      return (100 - context.lab.cashStability) * 0.23 + context.lab.marketShare * 0.08;
    case "safety-stand-down":
      return (100 - context.lab.safetyReadiness) * 0.26;
    case "talent-raid":
      // The engineeringQuality * 0.08 term contributed a fixed 4 for every
      // run; folded in as a constant when the engineering-quality stat was
      // removed.
      return 4;
    case "government-partnership":
      return (
        // The (100 - fundingClimate) * 0.08 term contributed a fixed 4 for every
        // run; folded in as a constant when the climate stat was removed.
        context.lab.governmentTrust * 0.12 + 4
      );
    case "coalition-outreach":
      return context.world.phase === "frontier" || context.world.phase === "crisis"
        ? 26
        : -20;
  }
}

function scorePlan(
  definition: RivalPlanDefinition,
  context: RivalDecisionContext,
  random: RandomOracle,
): RivalPlanScoreState {
  const personalityUtility = Object.entries(definition.personalityWeights).reduce(
    (total, [key, weight]) =>
      total + context.personality[key as RivalPersonalityKey] * (weight ?? 0),
    0,
  );
  const situation = situationalUtility(definition.id, context);
  const variation = random.triangular(
    randomKey(
      "rival-plan",
      context.lab.labId,
      String(context.quarterIndex),
      definition.id,
    ),
    -4,
    0,
    4,
  );
  return {
    planId: definition.id,
    baseUtility: definition.baseUtility,
    personalityUtility,
    situationalUtility: situation,
    variation,
    totalUtility: definition.baseUtility + personalityUtility + situation + variation,
  };
}

function planDefinition(planId: RivalStrategicPlanId): RivalPlanDefinition {
  const definition = RIVAL_PLAN_DEFINITIONS.find((candidate) => candidate.id === planId);
  if (definition === undefined) throw new Error(`Unknown rival plan ${planId}`);
  return definition;
}

function allocationsEqual(left: GpuAllocationState, right: GpuAllocationState): boolean {
  const recordsEqual = (
    leftRecord: Readonly<Record<string, number>>,
    rightRecord: Readonly<Record<string, number>>,
  ): boolean => {
    const keys = [
      ...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]),
    ].sort();
    return keys.every((key) => leftRecord[key] === rightRecord[key]);
  };
  return (
    left.servingFleetShareBasisPoints === right.servingFleetShareBasisPoints &&
    left.capabilityBasisPoints === right.capabilityBasisPoints &&
    recordsEqual(left.capabilityDomainWeights, right.capabilityDomainWeights) &&
    recordsEqual(left.safetyProgramWeights, right.safetyProgramWeights)
  );
}

const SCALING_DOMAIN_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  "base:domain.architectures": 2750,
  "base:domain.optimisation-scaling": 2500,
  "base:domain.multimodality": 1000,
  "base:domain.reasoning-tools": 1750,
  "base:domain.reinforcement-agency": 1500,
  "base:domain.scientific-ai": 500,
  "base:domain.robotics-embodiment": 0,
});

const FRONTIER_DOMAIN_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  "base:domain.architectures": 1500,
  "base:domain.optimisation-scaling": 1500,
  "base:domain.multimodality": 1000,
  "base:domain.reasoning-tools": 2600,
  "base:domain.reinforcement-agency": 2200,
  "base:domain.scientific-ai": 700,
  "base:domain.robotics-embodiment": 500,
});

function phaseDomainWeights(context: RivalDecisionContext) {
  const target =
    context.world.phase === "frontier" || context.world.phase === "crisis"
      ? FRONTIER_DOMAIN_WEIGHTS
      : context.world.phase === "scaling"
        ? SCALING_DOMAIN_WEIGHTS
        : undefined;
  if (target === undefined) return context.lab.allocation.capabilityDomainWeights;
  const available = Object.fromEntries(
    context.lab.capabilityProgramIds.map((programId) => [
      programId,
      basisPoints(target[programId] ?? 0),
    ]),
  );
  return Object.values(available).reduce((sum, weight) => sum + weight, 0) === 10_000
    ? available
    : context.lab.allocation.capabilityDomainWeights;
}

export class WeightedUtilityRivalPolicy implements RivalPolicy {
  chooseQuarterPlan(
    context: RivalDecisionContext,
    random: RandomOracle,
  ): RivalPlanSelection {
    const scores = RIVAL_PLAN_DEFINITIONS.map((definition) =>
      scorePlan(definition, context, random),
    ).sort(
      (left, right) =>
        right.totalUtility - left.totalUtility || (left.planId < right.planId ? -1 : 1),
    );
    const topPlans = scores.slice(0, 3);
    const selected = topPlans[0];
    if (selected === undefined || topPlans.length !== 3) {
      throw new Error("Rival policy produced fewer than three plans");
    }
    return { selected, topPlans };
  }

  chooseWeeklyCommands(context: RivalDecisionContext): readonly RivalPolicyCommand[] {
    const definition = planDefinition(context.currentPlanId);
    const allocation: GpuAllocationState = {
      ...context.lab.allocation,
      servingFleetShareBasisPoints: basisPoints(
        Math.min(
          definition.servingFleetShareBasisPoints,
          context.lab.servingDemandCapBasisPoints,
        ),
      ),
      capabilityBasisPoints: basisPoints(definition.capabilityBasisPoints),
      capabilityDomainWeights: phaseDomainWeights(context),
    };
    const commandPrefix = `rival:${context.lab.labId}:${String(context.tick)}`;
    const commands: RivalPolicyCommand[] = [];
    if (!allocationsEqual(allocation, context.lab.allocation)) {
      commands.push({
        kind: "set-gpu-allocation",
        meta: {
          commandId: `${commandPrefix}:allocation` as CommandId,
          expectedTick: context.tick,
          issuedBy: "rival",
        },
        labId: context.lab.labId,
        allocation,
      } satisfies SetGpuAllocationCommand);
    }
    return commands;
  }
}

export function createInitialRivalStrategy(
  labId: LabId,
  labDefinitionId: ContentId,
): RivalStrategyState {
  const personality = RIVAL_PERSONALITIES[labDefinitionId] ?? DEFAULT_PERSONALITY;
  return {
    labId,
    labDefinitionId,
    personality,
    currentPlanId: "balanced-research",
    planStartedAt: tick(0),
    planEndsAt: tick(13),
    quarterlyDecisions: [],
    weeklyCommands: [],
    relationship: {
      trust: Math.round((personality.politicalCooperation - 50) * 0.3),
      strategicFear: Math.round(
        (personality.raceUrgency + personality.secrecy - 100) * 0.2,
      ),
      dependence: Math.round((personality.commercialGrowth - 50) * 0.1),
      perceivedHonesty: Math.round(
        (personality.politicalCooperation - personality.secrecy) * 0.2,
      ),
    },
    agreements: [],
    diplomacyHistory: [],
    incidents: [],
  };
}

export function createRivalDecisionContext(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): RivalDecisionContext {
  const strategy = state.world.rivals[labId];
  const lab = state.labs[labId];
  if (strategy === undefined || lab === undefined || lab.control !== "rival") {
    throw new Error(`Unknown rival lab ${labId}`);
  }
  const capabilityPrograms = Object.entries(lab.research.domains).sort(
    ([leftId, left], [rightId, right]) =>
      right.level - left.level || (leftId < rightId ? -1 : 1),
  );
  const safetyPrograms = Object.entries(lab.research.safetyPrograms).sort(
    ([leftId, left], [rightId, right]) =>
      right.level - left.level || (leftId < rightId ? -1 : 1),
  );
  return {
    tick: state.run.tick,
    quarterIndex: Math.floor(state.run.tick / 13),
    world: {
      phase: state.run.phase,
      publishedPaperCount: Object.values(state.world.paperRace.discoveries).filter(
        (discovery) => discovery.publicationPolicy !== undefined,
      ).length,
    },
    lab: {
      labId,
      labDefinitionId: lab.definitionId,
      cashStability: clampRating(50 + lab.finance.cash * 1.5),
      computeCapacity: lab.compute.lots.reduce(
        (total, lot) => total + lot.physicalCount * lot.availableFraction,
        0,
      ),
      capabilityLevel: clampRating(
        average(capabilityPrograms.map(([, domain]) => domain.level)),
      ),
      safetyReadiness: clampRating(
        average([
          ...safetyPrograms.map(([, program]) => program.level),
          lab.safety.safetyCulture,
          lab.safety.evalQuality,
          lab.safety.practicalControlStrength,
        ]),
      ),
      governmentTrust: lab.politics.governmentTrust,
      marketShare: clampRating(lab.market.marketShare * 100),
      allocation: lab.compute.allocation,
      servingDemandCapBasisPoints: (() => {
        const cap = calculateServingDemandCap(state, content, labId);
        return cap.fleetPhysicalGpus === 0
          ? 0
          : Math.round((cap.maximumPhysicalGpus * 10_000) / cap.fleetPhysicalGpus);
      })(),
      capabilityProgramIds: capabilityPrograms.map(([id]) => id as ContentId),
      safetyProgramIds: safetyPrograms.map(([id]) => id as ContentId),
    },
    personality: strategy.personality,
    currentPlanId: strategy.currentPlanId,
  };
}

const DEFAULT_POLICY = new WeightedUtilityRivalPolicy();

function newestRivalModel(
  state: Readonly<GameState>,
  labId: LabId,
): Readonly<GameState["models"][ModelId]> | undefined {
  const lab = state.labs[labId];
  if (lab === undefined) return undefined;
  return lab.models.modelIds
    .map((modelId) => state.models[modelId])
    .filter((model): model is NonNullable<typeof model> => model !== undefined)
    .sort(
      (left, right) =>
        right.generationIndex - left.generationIndex ||
        compareCodePoints(left.id, right.id),
    )[0];
}

function hasOpenProject(
  state: Readonly<GameState>,
  labId: LabId,
  kind: "training" | "productisation",
  modelId?: ModelId,
): boolean {
  const lab = state.labs[labId];
  return (
    lab?.projects.projectIds.some((projectId) => {
      const project = state.projects[projectId];
      if (
        project === undefined ||
        project.payload.kind !== kind ||
        ["completed", "cancelled", "failed"].includes(project.status)
      ) {
        return false;
      }
      return kind !== "productisation" || modelId === undefined
        ? true
        : project.payload.kind === "productisation" &&
            project.payload.modelId === modelId;
    }) ?? false
  );
}

function latestTrainingAttemptTick(state: Readonly<GameState>, labId: LabId): number {
  const lab = state.labs[labId];
  const modelTick = newestRivalModel(state, labId)?.trainedAt ?? 0;
  const projectTick =
    lab?.projects.projectIds.reduce((latest, projectId) => {
      const project = state.projects[projectId];
      return project?.payload.kind === "training"
        ? Math.max(latest, project.createdAt)
        : latest;
    }, 0) ?? 0;
  return Math.max(modelTick, projectTick);
}

/** Rival capability bands mirror the race's broad phases without letting the
 * global leader pull every lagging lab onto frontier-scale runs immediately. */
export const RIVAL_SCALING_TRAINING_CAPABILITY = SCALING_PHASE_FRONTIER_CAPABILITY;
export const RIVAL_FRONTIER_TRAINING_CAPABILITY = FRONTIER_PHASE_FRONTIER_CAPABILITY;

function rivalFrontierCapability(state: Readonly<GameState>, labId: LabId): number {
  const newest = newestRivalModel(state, labId);
  return newest === undefined ? 0 : calculateFrontierCapability(newest.trueCapability);
}

/** Deliberate recovery after a run, added to the strategic training cadence. */
export function rivalPostTrainingCooldownWeeks(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  const plan = state.world.rivals[labId]?.currentPlanId;
  return plan === "frontier-training" ? 6 : plan === "safety-stand-down" ? 10 : 8;
}

export function rivalTrainingIntervalWeeks(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  const strategy = state.world.rivals[labId];
  const frontierCapability = rivalFrontierCapability(state, labId);
  const base =
    frontierCapability < RIVAL_SCALING_TRAINING_CAPABILITY
      ? 26
      : frontierCapability < RIVAL_FRONTIER_TRAINING_CAPABILITY
        ? 24
        : 18;
  const planAdjustment =
    strategy?.currentPlanId === "frontier-training"
      ? -5
      : strategy?.currentPlanId === "safety-stand-down"
        ? 8
        : 0;
  return (
    Math.max(13, base + planAdjustment) + rivalPostTrainingCooldownWeeks(state, labId)
  );
}

/**
 * How long a rival is willing to run. This used to pick a scale band; with size
 * as the input, ambition shows up as weeks -- a rival chasing the frontier ties
 * its fleet up for longer. The two values are the old frontier and product base
 * durations, so rival runs come out the size they always did.
 */
export function rivalTrainingDurationWeeks(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  return rivalFrontierCapability(state, labId) >= RIVAL_FRONTIER_TRAINING_CAPABILITY
    ? 15
    : 9;
}

function chooseTrainingPosture(
  state: Readonly<GameState>,
  labId: LabId,
): TrainingPosture {
  const strategy = state.world.rivals[labId];
  if (strategy === undefined) return "normal";
  if (
    strategy.personality.safetyCommitment >= 80 ||
    strategy.currentPlanId === "safety-stand-down"
  ) {
    return "conservative";
  }
  if (
    strategy.personality.safetyCommitment <= 45 ||
    (strategy.currentPlanId === "frontier-training" &&
      strategy.personality.raceUrgency >= 90)
  ) {
    return "yolo";
  }
  return "normal";
}

/**
 * A rival scales from compute it has actually made work, rather than treating a
 * newly delivered fleet as proof that it can immediately operate an arbitrarily
 * larger run. Aggressive labs still accept a much steeper step and the larger
 * failure budget of YOLO; cautious labs build a steadier experimental ladder.
 */
export const RIVAL_TRAINING_MAX_STRETCH: Readonly<Record<TrainingPosture, number>> =
  Object.freeze({
    conservative: 1.5,
    normal: 2,
    yolo: 3,
  });

export const RIVAL_TRAINING_MAX_TOTAL_LOSS: Readonly<Record<TrainingPosture, number>> =
  Object.freeze({
    conservative: 0.12,
    normal: 0.22,
    yolo: 0.38,
  });

/**
 * Before its first capability-qualified artifact, a rival deliberately climbs
 * the frontier instead of converting a newly completed datacentre into an
 * immediate FC-100 run. Below capability breadth territory, it targets an
 * eight-point step. Once close, personality moves the intended first crossing
 * through roughly FC 93-95. The ordinary player-visible forecast is used to
 * size the run; this does not inspect the future model or its SI draw. Keeping
 * the first crossing near the gate matters: FC 100 is guaranteed genuine SI,
 * while a lower qualifying result leaves False Dawn as a real race outcome.
 */
export function rivalPreCandidateTrainingCapabilityTarget(
  state: Readonly<GameState>,
  labId: LabId,
): number | undefined {
  const frontierCapability = rivalFrontierCapability(state, labId);
  // Crossing the capability gate can happen before the four works are ready.
  // Do not remove the governor merely because FC reached 88: that allowed the
  // rival to train an FC-100 replacement while waiting for its programme and
  // nominate the replacement, erasing False Dawn from ordinary play. Once a
  // countdown has actually begun, later attempts may scale beyond this first-
  // candidacy governor (important after a genuine False Dawn).
  if (
    state.domainLog.some((entry) => entry.code.startsWith(`rival-candidate:${labId}:`))
  ) {
    return undefined;
  }
  if (frontierCapability < 80) {
    return Math.min(87.5, frontierCapability + 8);
  }
  const raceUrgency = state.world.rivals[labId]?.personality.raceUrgency ?? 50;
  return Math.min(95, Math.max(frontierCapability + 2.5, 92.5 + raceUrgency * 0.025));
}

const RIVAL_PRE_CANDIDATE_FORECAST_HEADROOM = 6;

function quoteFitsPreCandidateCapabilityTarget(
  quote: Readonly<TrainingQuote>,
  capabilityTarget: number | undefined,
): boolean {
  return (
    capabilityTarget === undefined ||
    (quote.estimatedFrontierCapability <= capabilityTarget &&
      quote.estimatedFrontierCapabilityRange[1] <=
        capabilityTarget + RIVAL_PRE_CANDIDATE_FORECAST_HEADROOM)
  );
}

function chooseRivalTrainingCommand(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  newestModelId: ModelId,
  durationWeeks: number,
): StartTrainingRunCommand | undefined {
  const posture = chooseTrainingPosture(state, labId);
  const capabilityTarget = rivalPreCandidateTrainingCapabilityTarget(state, labId);
  const baseCommand: StartTrainingRunCommand = {
    kind: "start-training-run",
    meta: rivalCommandMeta(state, labId, `train:${String(durationWeeks)}w`),
    labId,
    parentModelId: newestModelId,
    durationWeeks,
    posture,
  };
  const defaultQuote = quoteTrainingRun(state, content, baseCommand);
  if (defaultQuote.blockers.length > 0) return undefined;

  const record = trainingTrackRecord(state, labId);
  const fleetAmbition = Math.floor(fleetTeraflops(state, content, labId) * 0.6);
  const provenScaleCeiling =
    record.bestRunFlop <= 0
      ? defaultQuote.committedTeraflops
      : teraflopsForTotalFlop(
          record.bestRunFlop * RIVAL_TRAINING_MAX_STRETCH[posture],
          durationWeeks,
        );
  const desiredCommitment = Math.max(
    defaultQuote.floorTeraflops,
    Math.floor(Math.min(fleetAmbition, provenScaleCeiling)),
  );
  const desiredCommand = {
    ...baseCommand,
    committedTeraflops: desiredCommitment,
  } satisfies StartTrainingRunCommand;
  const desiredQuote = quoteTrainingRun(state, content, desiredCommand);
  if (
    desiredQuote.blockers.length === 0 &&
    desiredQuote.reliability.totalLoss <= RIVAL_TRAINING_MAX_TOTAL_LOSS[posture] &&
    quoteFitsPreCandidateCapabilityTarget(desiredQuote, capabilityTarget)
  ) {
    return desiredCommand;
  }

  // Search the legal range for the largest run inside this lab's chosen loss
  // budget. The quote is the same forecast the player sees and the simulation
  // later resolves, so this does not give rivals hidden knowledge or special
  // checkpoint rules.
  let safeCommand: StartTrainingRunCommand | undefined;
  let lower = defaultQuote.floorTeraflops;
  let upper = desiredCommitment;
  for (let attempt = 0; attempt < 12 && lower <= upper; attempt += 1) {
    const commitment = Math.floor((lower + upper) / 2);
    const command = {
      ...baseCommand,
      committedTeraflops: commitment,
    } satisfies StartTrainingRunCommand;
    const quote = quoteTrainingRun(state, content, command);
    if (
      quote.blockers.length === 0 &&
      quote.reliability.totalLoss <= RIVAL_TRAINING_MAX_TOTAL_LOSS[posture] &&
      quoteFitsPreCandidateCapabilityTarget(quote, capabilityTarget)
    ) {
      safeCommand = command;
      lower = commitment + 1;
    } else {
      upper = commitment - 1;
    }
  }
  if (safeCommand !== undefined) return safeCommand;

  // A new hardware floor can itself be a stretch. In that case the rival must
  // either accept the smallest legal experiment or stop training forever; the
  // former preserves the intended race while remaining an honest gamble.
  const minimumCommand = {
    ...baseCommand,
    committedTeraflops: defaultQuote.floorTeraflops,
  } satisfies StartTrainingRunCommand;
  const minimumQuote = quoteTrainingRun(state, content, minimumCommand);
  return minimumQuote.blockers.length === 0 &&
    quoteFitsPreCandidateCapabilityTarget(minimumQuote, capabilityTarget)
    ? minimumCommand
    : undefined;
}

function chooseProductisationMode(
  state: Readonly<GameState>,
  labId: LabId,
): ProductisationMode {
  const personality = state.world.rivals[labId]?.personality;
  if (personality === undefined) return "normal";
  if (personality.safetyCommitment >= 80) return "hardened";
  if (personality.raceUrgency >= 90 && personality.safetyCommitment < 50) return "rush";
  return "normal";
}

function chooseDeploymentPolicy(
  state: Readonly<GameState>,
  labId: LabId,
): DeploymentPolicy {
  const personality = state.world.rivals[labId]?.personality;
  return personality !== undefined &&
    personality.commercialGrowth >= 80 &&
    personality.safetyCommitment < 75 &&
    personality.secrecy < 80
    ? "open-api"
    : "guarded-api";
}

function rivalCommandMeta(
  state: Readonly<GameState>,
  labId: LabId,
  action: string,
): RivalPolicyCommand["meta"] {
  return {
    commandId: `rival:${labId}:${String(state.run.tick)}:${action}` as CommandId,
    expectedTick: state.run.tick,
    issuedBy: "rival",
  };
}

function buildRivalOperationalCommand(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): RivalPolicyCommand | undefined {
  const lab = state.labs[labId];
  const newest = newestRivalModel(state, labId);
  if (lab === undefined) return undefined;

  if (newest === undefined) {
    if (hasOpenProject(state, labId, "training")) return undefined;
    // Opening run: prototype-sized, the length the prototype band used to be.
    const command: StartTrainingRunCommand = {
      kind: "start-training-run",
      meta: rivalCommandMeta(state, labId, "train:first"),
      labId,
      durationWeeks: 5,
      posture: chooseTrainingPosture(state, labId),
    };
    return quoteTrainingRun(state, content, command).blockers.length === 0
      ? command
      : undefined;
  }

  const productisationRuns = Object.values(newest.deployment.productisationRuns).reduce(
    (sum, runs) => sum + runs,
    0,
  );
  const commercialModelId = resolveCommercialModelId(state, labId);
  if (
    newest.id !== commercialModelId &&
    productisationRuns === 0 &&
    !hasOpenProject(state, labId, "productisation", newest.id)
  ) {
    const command: StartProductisationCommand = {
      kind: "start-productisation",
      meta: rivalCommandMeta(state, labId, `productise:${newest.id}`),
      labId,
      modelId: newest.id,
      mode: chooseProductisationMode(state, labId),
    };
    if (quoteProductisation(state, content, command).blockers.length === 0)
      return command;
  }
  if (
    newest.id !== commercialModelId &&
    productisationRuns > 0 &&
    newest.deployment.policy === "internal-only"
  ) {
    return {
      kind: "set-model-deployment-policy",
      meta: rivalCommandMeta(state, labId, `deploy:${newest.id}`),
      labId,
      modelId: newest.id,
      policy: chooseDeploymentPolicy(state, labId),
    } satisfies SetModelDeploymentPolicyCommand;
  }

  const durationWeeks = rivalTrainingDurationWeeks(state, labId);
  const trainingDue =
    state.run.tick - latestTrainingAttemptTick(state, labId) >=
    rivalTrainingIntervalWeeks(state, labId);
  if (trainingDue && !hasOpenProject(state, labId, "training")) {
    const command = chooseRivalTrainingCommand(
      state,
      content,
      labId,
      newest.id,
      durationWeeks,
    );
    if (command !== undefined) return command;
  }

  return chooseRivalFleetCommand(state, content, labId, durationWeeks >= 15);
}

/**
 * Rivals pursue a current-era-equivalent throughput target within the same
 * physical campus ceiling available to the player. At a full campus they
 * retire the oldest unreserved generation before ordering its replacement.
 */
export function chooseRivalFleetCommand(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  frontierAmbition: boolean,
): BuyGpusCommand | SellGpusCommand | undefined {
  const lab = state.labs[labId];
  if (lab === undefined || lab.control !== "rival") return undefined;
  const currentGeneration = content.gpuGenerations[state.world.currentGpuGenerationId];
  const eraGpuTeraflops =
    currentGeneration === undefined ? 4 : generationTeraflopsPerGpu(currentGeneration);
  const targetEraGpuEquivalents = rivalFleetTargetEraGpuEquivalents(
    state,
    frontierAmbition,
  );
  const supportedPhysicalGpus = calculateFacilityCapacity(
    state,
    content,
    labId,
  ).supportedOwnedGpuCount;
  const capacityConstrainedTarget = Math.min(
    targetEraGpuEquivalents,
    supportedPhysicalGpus,
  );
  const committedTeraflopsTotal =
    lab.compute.lots.reduce((sum, lot) => {
      const generation = content.gpuGenerations[lot.generationId];
      return generation === undefined
        ? sum
        : sum + lot.physicalCount * generationTeraflopsPerGpu(generation);
    }, 0) +
    lab.compute.deliveries.reduce((sum, delivery) => {
      const generation = content.gpuGenerations[delivery.generationId];
      return generation === undefined
        ? sum
        : sum + delivery.physicalCount * generationTeraflopsPerGpu(generation);
    }, 0);
  const committedEraGpuEquivalents = committedTeraflopsTotal / eraGpuTeraflops;
  const committedPhysicalGpus =
    lab.compute.lots.reduce(
      (sum, lot) => sum + (lot.ownership === "owned" ? lot.physicalCount : 0),
      0,
    ) +
    lab.compute.deliveries.reduce(
      (sum, delivery) =>
        sum + (delivery.ownership === "owned" ? delivery.physicalCount : 0),
      0,
    );
  // One order per month keeps rival fleet growth gradual, matching the old
  // lease cadence instead of teleporting to the era target in a week.
  const lastOrderFlag = lab.flags["rival:last-gpu-order-at"];
  const lastOrderAt = typeof lastOrderFlag === "number" ? lastOrderFlag : -100;
  const throughputDeficitThousandUnits = Math.min(
    RIVAL_MAX_GPU_ORDER_THOUSANDS,
    Math.max(
      0,
      Math.ceil((capacityConstrainedTarget - committedEraGpuEquivalents) / 1_000),
    ),
  );
  const physicalExcessThousandUnits = Math.max(
    0,
    Math.ceil((committedPhysicalGpus - capacityConstrainedTarget) / 1_000),
  );
  if (
    (throughputDeficitThousandUnits > 0 || physicalExcessThousandUnits > 0) &&
    state.run.tick - lastOrderAt >= 4
  ) {
    const desiredThousandUnits = Math.min(
      RIVAL_MAX_GPU_ORDER_THOUSANDS,
      throughputDeficitThousandUnits + physicalExcessThousandUnits,
    );
    const physicalHeadroom = Math.max(
      0,
      capacityConstrainedTarget - committedPhysicalGpus,
    );
    const purchasableThousandUnits = Math.min(
      desiredThousandUnits,
      Math.floor(physicalHeadroom / 1_000),
    );
    if (physicalExcessThousandUnits > 0 || purchasableThousandUnits === 0) {
      const generations = [...new Set(lab.compute.lots.map((lot) => lot.generationId))]
        .filter(
          (generationId) =>
            generationId !== state.world.currentGpuGenerationId ||
            committedPhysicalGpus > capacityConstrainedTarget,
        )
        .sort((left, right) => {
          const leftYear = content.gpuGenerations[left]?.nominalYear ?? 0;
          const rightYear = content.gpuGenerations[right]?.nominalYear ?? 0;
          return leftYear - rightYear || (left < right ? -1 : left > right ? 1 : 0);
        });
      for (const generationId of generations) {
        const available = quoteGpuSale(
          state,
          content,
          labId,
          generationId,
          1,
        ).sellablePhysicalGpus;
        const thousandUnits = Math.min(
          desiredThousandUnits,
          RIVAL_MAX_GPU_ORDER_THOUSANDS,
          Math.floor(available / 1_000),
        );
        if (thousandUnits <= 0) continue;
        return {
          kind: "sell-gpus",
          meta: rivalCommandMeta(state, labId, `refresh:${generationId}`),
          labId,
          generationId,
          thousandUnits,
        } satisfies SellGpusCommand;
      }
      return undefined;
    }
    // Capital constrains the order without turning a large strategic target
    // into an all-or-nothing purchase. Rivals buy the largest tranche their
    // existing cash and completed campus can support; no shortfall is minted.
    const affordableThousandUnits = largestAffordableGpuOrder(
      state,
      content,
      labId,
      state.world.currentGpuGenerationId,
      purchasableThousandUnits,
    );
    if (affordableThousandUnits <= 0) return undefined;
    return {
      kind: "buy-gpus",
      meta: rivalCommandMeta(state, labId, "compute"),
      labId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: affordableThousandUnits,
    } satisfies BuyGpusCommand;
  }
  return undefined;
}

/**
 * Both halves of a fleet refresh spend the same monthly order slot. Retiring
 * hardware opens the campus headroom that the replacement purchase needs, so a
 * retirement that did not stamp this would let the pair run on consecutive
 * weeks and outpace the cadence the gate exists to impose.
 */
function stampRivalFleetOrder(tx: SimulationTransaction, labId: LabId): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab !== undefined) {
      lab.flags["rival:last-gpu-order-at"] = draft.run.tick;
    }
  });
}

function executeRivalOperationalCommand(
  tx: SimulationTransaction,
  content: CompiledContent,
  command: RivalPolicyCommand,
): void {
  switch (command.kind) {
    case "buy-gpus":
      buyGpus(tx, content, command.labId, command.generationId, command.thousandUnits);
      stampRivalFleetOrder(tx, command.labId);
      return;
    case "sell-gpus":
      sellGpus(tx, content, command.labId, command.generationId, command.thousandUnits);
      stampRivalFleetOrder(tx, command.labId);
      return;
    case "start-training-run":
      startTrainingRun(tx, content, command);
      return;
    case "start-productisation":
      startProductisation(tx, content, command);
      return;
    case "set-model-deployment-policy":
      setModelDeploymentPolicy(
        tx,
        content,
        command.labId,
        command.modelId,
        command.policy,
      );
      return;
    case "set-gpu-allocation":
      throw new Error(`Queued rival command ${command.kind} reached immediate execution`);
  }
}

function operationalCommandSummary(command: RivalPolicyCommand): string {
  switch (command.kind) {
    case "buy-gpus":
      return `Procured ${String(command.thousandUnits * 1000)} ${command.generationId} GPUs`;
    case "sell-gpus":
      return `Retired ${String(command.thousandUnits * 1000)} ${command.generationId} GPUs`;
    case "start-training-run":
      return `Started a ${String(command.durationWeeks ?? 0)}-week training run`;
    case "start-productisation":
      return `Started ${command.mode} productisation for ${command.modelId}`;
    case "set-model-deployment-policy":
      return `Deployed ${command.modelId} through ${command.policy}`;
    case "set-gpu-allocation":
      return `Serving ${String(command.allocation.servingFleetShareBasisPoints)}bp; capability ${String(command.allocation.capabilityBasisPoints)}bp`;
  }
}

export function queueRivalWeeklyCommands(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    const context = createRivalDecisionContext(tx.read(), content, labId);
    const queuedCommands = DEFAULT_POLICY.chooseWeeklyCommands(context);
    for (const proposedCommand of queuedCommands) {
      const command =
        proposedCommand.kind === "set-gpu-allocation"
          ? {
              ...proposedCommand,
              allocation: proposedCommand.allocation,
            }
          : proposedCommand;
      const validation = validateCommand(tx.read(), content, command);
      if (!validation.ok) {
        throw new Error(
          `Rival command ${command.meta.commandId} was invalid: ${validation.errors
            .map((error) => error.code)
            .join(", ")}`,
        );
      }
      tx.update((draft) => {
        draft.run.queuedOrders = draft.run.queuedOrders.filter(
          (order) => !(order.kind === command.kind && order.labId === command.labId),
        );
        if (command.kind === "set-gpu-allocation") {
          draft.run.queuedOrders.push({
            kind: command.kind,
            labId: command.labId,
            allocation: structuredClone(command.allocation),
          });
        } else {
          throw new Error(
            `Immediate rival command ${command.kind} entered the order queue`,
          );
        }
        const strategy = draft.world.rivals[labId];
        if (strategy === undefined) throw new Error(`Missing rival strategy ${labId}`);
        strategy.weeklyCommands.push({
          tick: draft.run.tick,
          commandId: command.meta.commandId,
          kind: command.kind,
          summary: operationalCommandSummary(command),
        });
      });
    }

    const operationalCommand = buildRivalOperationalCommand(tx.read(), content, labId);
    if (operationalCommand !== undefined) {
      const validation = validateCommand(tx.read(), content, operationalCommand);
      if (!validation.ok) {
        throw new Error(
          `Rival command ${operationalCommand.meta.commandId} was invalid: ${validation.errors
            .map((error) => error.code)
            .join(", ")}`,
        );
      }
      executeRivalOperationalCommand(tx, content, operationalCommand);
      tx.update((draft) => {
        const strategy = draft.world.rivals[labId];
        if (strategy === undefined) throw new Error(`Missing rival strategy ${labId}`);
        strategy.weeklyCommands.push({
          tick: draft.run.tick,
          commandId: operationalCommand.meta.commandId,
          kind: operationalCommand.kind,
          summary: operationalCommandSummary(operationalCommand),
        });
      });
    }

    const commandCount =
      queuedCommands.length + (operationalCommand === undefined ? 0 : 1);
    if (commandCount > 0) {
      tx.emit({ kind: "rival-commands-issued", labId, count: commandCount });
    }
  }
}

/**
 * Rivals use the GDD's aggregated Cash Stability economy rather than running
 * player-facing fundraising projects. Once per quarter this converts their
 * scientific standing, commercial appetite, and current valuation into a
 * bounded external-capital floor. The transfer is still a real, auditable
 * cash ledger entry and never depends on the player's progress.
 */
export function recapitaliseRivals(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  const quarterIndex = Math.floor((state.run.tick + 1) / 13);
  for (const labId of Object.keys(state.world.rivals).sort() as LabId[]) {
    const strategy = tx.read().world.rivals[labId];
    const lab = tx.read().labs[labId];
    if (strategy === undefined || lab === undefined) continue;
    const ordinaryCashFloor = Math.max(
      50,
      Math.round(
        // The 0.4 * fundingClimate term went with the constant it read. Its
        // contribution was a fixed 20 for every run, folded into the base.
        (45 +
          strategy.personality.sciencePrestige * 0.2 +
          strategy.personality.commercialGrowth * 0.2) *
          100,
      ) / 100,
    );
    // Rivals can convert a bounded share of their market value into quarterly
    // growth capital. Unlike the former exact-shortfall bailout, this reserve
    // is determined before any purchase and can be insufficient for the next
    // hardware tranche. Capability, revenue, incidents, and the capital cycle
    // therefore constrain when scaling is actually affordable.
    const investableValuationReserve =
      Math.round(currentMark(tx.read(), content, labId) * 0.02 * 100) / 100;
    const targetCashMillions = Math.max(ordinaryCashFloor, investableValuationReserve);
    const amount = targetCashMillions - lab.finance.cash;
    if (amount <= 0) continue;
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount,
        financeCategory: "grant",
      },
      {
        kind: "system",
        id: `rival-capital:${labId}:quarter:${String(quarterIndex)}`,
      },
    );
  }
}

/**
 * Talent approaches are reviewed yearly. A newly hired researcher is protected
 * for their first year; after any later approach resolves, that individual has
 * a further one-year cooldown. The strongest eligible approach wins, so the
 * mechanic survives even when rivals are primarily focused on model training.
 */
export function advanceRivalTalentMoves(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const state = tx.read();
  if (isProgressiveCampaign(state) && labMaturityStage(state) !== "frontier") {
    return;
  }
  if (state.run.tick === 0 || state.run.tick % TALENT_RAID_INTERVAL_WEEKS !== 0) {
    return;
  }
  const candidates = Object.values(state.researchers)
    .filter((researcher) => {
      if (
        researcher.status !== "employed" ||
        researcher.employerLabId !== state.run.playerLabId
      ) {
        return false;
      }
      if (
        researcher.employedAt !== undefined &&
        state.run.tick - researcher.employedAt < NEW_HIRE_POACHING_PROTECTION_WEEKS
      ) {
        return false;
      }
      if (hasAcceptedUltimatumProtection(researcher, state.run.tick)) return false;
      if (researcher.poaching === undefined) return true;
      if (researcher.poaching.stage !== "resolved") return false;
      const previousApproachEndedAt =
        researcher.poaching.resolvedAt ?? researcher.poaching.resolvesAt;
      return (
        state.run.tick - previousApproachEndedAt >= RESEARCHER_POACHING_COOLDOWN_WEEKS
      );
    })
    .sort((left, right) => compareCodePoints(left.id, right.id));
  if (candidates.length === 0) return;
  const proposals: Array<{
    readonly labId: LabId;
    readonly researcherId: (typeof candidates)[number]["id"];
    readonly score: number;
    readonly offerStrength: number;
  }> = [];
  for (const labId of Object.keys(state.world.rivals).sort() as LabId[]) {
    const strategy = tx.read().world.rivals[labId];
    if (strategy === undefined) continue;
    if (
      strategy.agreements.some(
        (agreement) =>
          agreement.action === "non-poaching-agreement" &&
          agreement.expiresAt > state.run.tick,
      )
    ) {
      continue;
    }
    const shortlist = candidates
      .filter((candidate) => {
        const live = tx.read().researchers[candidate.id];
        return (
          live !== undefined &&
          (live.poaching === undefined || live.poaching.stage === "resolved")
        );
      })
      .map((candidate) => ({
        candidate,
        score:
          candidate.ambition +
          (100 - candidate.loyalty) +
          random.uniform(
            randomKey("rival-talent", labId, String(state.run.tick), candidate.id),
          ) *
            20,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          compareCodePoints(left.candidate.id, right.candidate.id),
      )
      .slice(0, MAX_APPROACHES_PER_RAID)
      .map((entry) => entry.candidate);
    for (const target of shortlist) {
      const offerStrength =
        35 +
        strategy.personality.talentAggression * 0.35 +
        random.uniform(
          randomKey("rival-talent", labId, String(state.run.tick), target.id, "offer"),
        ) *
          15;
      proposals.push({
        labId,
        researcherId: target.id,
        score:
          target.ambition +
          (100 - target.loyalty) +
          strategy.personality.talentAggression * 0.25 +
          (strategy.currentPlanId === "talent-raid" ? 15 : 0),
        offerStrength,
      });
    }
  }
  const ranked = proposals.sort(
    (left, right) =>
      right.score - left.score ||
      compareCodePoints(left.labId, right.labId) ||
      compareCodePoints(left.researcherId, right.researcherId),
  );
  const approached = new Set<ResearcherId>();
  for (const proposal of ranked) {
    if (approached.size >= MAX_APPROACHES_PER_RAID) break;
    if (approached.has(proposal.researcherId)) continue;
    approached.add(proposal.researcherId);
    startPoachingAttempt(
      tx,
      content,
      proposal.researcherId,
      proposal.labId,
      proposal.offerStrength,
    );
  }
}

export function updateRivalQuarterPlans(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const quarterIndex = Math.floor((tx.read().run.tick + 1) / 13);
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    const context = {
      ...createRivalDecisionContext(tx.read(), content, labId),
      quarterIndex,
    };
    const selection = DEFAULT_POLICY.chooseQuarterPlan(context, random);
    const definition = planDefinition(selection.selected.planId);
    const decision: RivalQuarterPlanDecisionState = {
      quarterIndex,
      selectedAt: tx.read().run.tick,
      selectedPlanId: selection.selected.planId,
      topPlans: selection.topPlans,
    };
    tx.update((draft) => {
      const strategy = draft.world.rivals[labId];
      if (strategy === undefined) throw new Error(`Missing rival strategy ${labId}`);
      strategy.currentPlanId = selection.selected.planId;
      strategy.planStartedAt = draft.run.tick;
      strategy.planEndsAt = tick(draft.run.tick + definition.commitmentWeeks);
      strategy.quarterlyDecisions.push({
        ...decision,
        topPlans: decision.topPlans.map((plan) => ({ ...plan })),
      });
    });
    tx.emit({
      kind: "rival-plan-selected",
      labId,
      planId: selection.selected.planId,
      quarterIndex,
    });
    const modelId = tx.read().labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : tx.read().models[modelId];
    const alreadyReported =
      model !== undefined &&
      tx
        .read()
        .world.rivalSignals.some(
          (signal) =>
            signal.labId === labId &&
            signal.kind === "benchmark" &&
            signal.subjectId === model.id,
        );
    if (model !== undefined && !alreadyReported) {
      const capability = calculateFrontierCapability(model.trueCapability);
      const lab = tx.read().labs[labId];
      const labName =
        lab === undefined
          ? "A rival lab"
          : (content.labs[lab.definitionId]?.displayName ?? "A rival lab");
      recordRivalPublicSignal(tx, {
        labId,
        kind: "benchmark",
        subjectId: model.id,
        actualValue: capability,
        baseErrorRadius: 15,
        summary: `${labName} reported a new benchmark result for ${model.displayName}.`,
      });
    }
  }
}
