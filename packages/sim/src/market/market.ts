import type {
  CompiledContent,
  MarketSegmentDefinition,
  PublicPriceTier,
} from "@neolab/content-schema";

import { TERAFLOPS_PER_TRAINING_FACTOR } from "../compute/flops.ts";
import {
  calculateGpuThroughput,
  planGpuPortfolio,
  planGpuPortfolioWithServingTarget,
  resolveGpuReservations,
  servingFleetShareGpus,
} from "../compute/gpu-portfolio.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import { GOVERNMENT_SEGMENT_ID } from "../politics/politics.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type {
  GameState,
  GpuAllocationState,
  MarketSegmentState,
  MarketState,
  ModelState,
} from "../model/state.ts";
import {
  cashMillions,
  fraction,
  gpuCount,
  rating,
  type CashMillions,
  type Tick,
} from "../model/units.ts";
import { compareCodePoints } from "../random/oracle.ts";

export const MARKET_CYCLE_WEEKS = 4;

export const SERVING_AURA_LADDER = [
  { minimumFulfilment: 0.9, aura: 2 },
  { minimumFulfilment: 0.5, aura: 1 },
] as const;

export const PUBLIC_PRICE_TIERS: readonly PublicPriceTier[] = [
  "free-preview",
  "cheap",
  "market",
  "premium",
  "scarcity",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundMoney(value: number): CashMillions {
  return cashMillions(round(value));
}

/**
 * Aura earned from a four-week serving cycle. Demand must genuinely exist;
 * the three customer segments are combined before the fulfilment ladder is
 * applied once to the lab as a whole.
 */
export function servingAuraForUsage(
  requestedTeraflops: number,
  deliveredTeraflops: number,
): number {
  if (!Number.isFinite(requestedTeraflops) || !Number.isFinite(deliveredTeraflops)) {
    throw new RangeError("Serving usage must be finite");
  }
  if (requestedTeraflops <= 0) return 0;
  const fulfilment = clamp(deliveredTeraflops / requestedTeraflops, 0, 1);
  return (
    SERVING_AURA_LADDER.find((step) => fulfilment >= step.minimumFulfilment)?.aura ?? 0
  );
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function requireSegment(
  content: CompiledContent,
  segmentId: string,
): MarketSegmentDefinition {
  const segment = content.market.segments[segmentId];
  if (segment === undefined) throw new Error(`Unknown customer segment ${segmentId}`);
  return segment;
}

export function resolveCommercialModelId(
  state: Readonly<GameState>,
  labId: LabId,
): ModelState["id"] | undefined {
  const lab = requireLab(state, labId);
  if (
    lab.models.commercialModelId !== undefined &&
    state.models[lab.models.commercialModelId] !== undefined
  ) {
    return lab.models.commercialModelId;
  }

  // Saves created before the active/commercial split stored only currentModelId.
  // Treat an externally deployed legacy current model as commercial without
  // mutating the loaded run.
  const legacy =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  return legacy === undefined || legacy.deployment.policy === "internal-only"
    ? undefined
    : legacy.id;
}

function commercialModel(
  state: Readonly<GameState>,
  labId: LabId,
): ModelState | undefined {
  const modelId = resolveCommercialModelId(state, labId);
  return modelId === undefined ? undefined : state.models[modelId];
}

function capabilityValue(model: ModelState, key: string): number {
  const values: Readonly<Record<string, number>> = {
    language: model.trueCapability.language,
    reasoning: model.trueCapability.reasoning,
    agency: model.trueCapability.agency,
    toolUse: model.trueCapability.toolUse,
    multimodality: model.trueCapability.multimodality,
    scientificAbility: model.trueCapability.scientificAbility,
    embodiment: model.trueCapability.embodiment,
  };
  const value = values[key];
  if (value === undefined) throw new Error(`Unknown market capability key ${key}`);
  return value;
}

function relevantCapability(
  model: ModelState | undefined,
  segment: MarketSegmentDefinition,
): number {
  if (model === undefined) return 0;
  return Object.entries(segment.capabilityWeights).reduce(
    (sum, [key, weight]) => sum + capabilityValue(model, key) * weight,
    0,
  );
}

/** The same weighted blend, read from the lab's measured evidence. */
function measuredRelevantCapability(
  model: ModelState | undefined,
  segment: MarketSegmentDefinition,
): number {
  const measured = model?.measuredCapability?.values;
  if (measured === undefined) return 0;
  return Object.entries(segment.capabilityWeights).reduce(
    (sum, [key, weight]) => sum + (measured[key as keyof typeof measured] ?? 0) * weight,
    0,
  );
}

export interface AppealBreakdown {
  readonly segmentId: string;
  readonly relevantCapability: number;
  readonly productQuality: number;
  readonly reliability: number;
  readonly governmentTrust: number;
  readonly incidentPenalty: number;
  readonly accessPenalty: number;
  readonly deploymentAppealAdjustment: number;
  readonly final: number;
}

export function calculateSegmentAppeal(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  segmentId: string,
  /**
   * Player-facing projections pass "measured" so the breakdown is built from
   * the lab's own evidence rather than the truth the market actually responds
   * to. The engine keeps reading the truth -- customers meet the real model --
   * but a view that read it would leak hidden state, which the GameView
   * invariant test enforces.
   */
  capabilitySource: "true" | "measured" = "true",
): AppealBreakdown {
  const lab = requireLab(state, labId);
  const segment = requireSegment(content, segmentId);
  const model = commercialModel(state, labId);
  const capability =
    capabilitySource === "measured"
      ? measuredRelevantCapability(model, segment)
      : relevantCapability(model, segment);
  const productQuality = model?.productQuality ?? 0;
  const reliability = model?.reliability ?? 0;
  const governmentTrust =
    segment.id === GOVERNMENT_SEGMENT_ID ? lab.politics.governmentTrust : 0;
  const incidentPenalty = 0;
  const deployment =
    model === undefined
      ? undefined
      : content.deployment.policies[model.deployment.policy];
  const accessPenalty = model === undefined ? 100 : 0;
  const deploymentAppealAdjustment = deployment?.marketAppealAdjustment ?? -100;
  const weights = segment.appealWeights;
  const final = clamp(
    capability * weights.capability +
      productQuality * weights.productQuality +
      reliability * weights.reliability +
      governmentTrust * weights.governmentTrust -
      incidentPenalty -
      accessPenalty +
      deploymentAppealAdjustment,
    0,
    100,
  );
  return {
    segmentId,
    relevantCapability: capability,
    productQuality,
    reliability,
    governmentTrust,
    incidentPenalty,
    accessPenalty,
    deploymentAppealAdjustment,
    final,
  };
}

function softmaxPlayerShare(
  playerAppeal: number,
  rivalAppeals: readonly number[],
  temperature: number,
): number {
  const maximum = Math.max(playerAppeal, ...rivalAppeals);
  const playerWeight = Math.exp((playerAppeal - maximum) / temperature);
  const denominator =
    playerWeight +
    rivalAppeals.reduce(
      (sum, appeal) => sum + Math.exp((appeal - maximum) / temperature),
      0,
    );
  return denominator === 0 ? 0 : playerWeight / denominator;
}

function liveSegmentShare(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  segment: MarketSegmentDefinition,
  capabilitySource: "true" | "measured",
): number {
  if (Object.keys(state.world.rivals).length === 0) {
    return softmaxPlayerShare(
      calculateSegmentAppeal(state, content, labId, segment.id, capabilitySource).final,
      segment.staticRivalAppeals,
      content.market.softmaxTemperature,
    );
  }
  if (!isMarketSegmentUnlocked(state, labId, segment.id)) return 0;
  const participants = Object.values(state.labs)
    .filter((lab) => isMarketSegmentUnlocked(state, lab.id, segment.id))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const appeals = participants.map((lab) => ({
    labId: lab.id,
    appeal: calculateSegmentAppeal(
      state,
      content,
      lab.id,
      segment.id,
      lab.id === labId ? capabilitySource : "true",
    ).final,
  }));
  const maximum = Math.max(...appeals.map((entry) => entry.appeal));
  const weights = appeals.map((entry) => ({
    labId: entry.labId,
    weight: Math.exp((entry.appeal - maximum) / content.market.softmaxTemperature),
  }));
  const denominator = weights.reduce((sum, entry) => sum + entry.weight, 0);
  const own = weights.find((entry) => entry.labId === labId)?.weight ?? 0;
  return denominator === 0 ? 0 : own / denominator;
}

function initialSegmentState(
  definition: MarketSegmentDefinition,
  content: CompiledContent,
  startingShare: number,
): MarketSegmentState {
  return {
    // Legacy cache field retained in the pre-release save schema. Its opening
    // value is preserved for deterministic state compatibility, but no market
    // rule converges toward or reads it as a demand stock.
    desiredUsagePerCycle: round(definition.globalUsagePerCycle * startingShare),
    satisfaction: rating(content.market.startingSatisfaction),
    accruedRequestedUsage: 0,
    accruedDeliveredUsage: 0,
    accruedRevenueMillions: cashMillions(0),
    lastCycleRequestedUsage: 0,
    lastCycleDeliveredUsage: 0,
    lastCycleRevenueMillions: cashMillions(0),
    lastCycleSatisfactionDelta: 0,
  };
}

function initialShareForSegment(
  definition: MarketSegmentDefinition,
  startingShare: number,
): number {
  return definition.id === GOVERNMENT_SEGMENT_ID ? 0 : startingShare;
}

export function createInitialMarketState(
  content: CompiledContent,
  startingShare: number,
): MarketState {
  return {
    marketShare: fraction(startingShare),
    priceTier: "market",
    priceChangeTicks: [],
    monetisationEfficiency: fraction(content.market.monetisationEfficiency),
    weeksAccruedThisCycle: 0,
    segments: Object.fromEntries(
      Object.values(content.market.segments).map((segment) => [
        segment.id,
        initialSegmentState(
          segment,
          content,
          initialShareForSegment(segment, startingShare),
        ),
      ]),
    ),
  };
}

/** Hydrate S2.3 saves whose market slice predates segment state. */
export function initialiseMarketIfNeeded(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
): void {
  const lab = requireLab(tx.read(), labId);
  const missing = Object.values(content.market.segments).filter(
    (segment) => lab.market.segments[segment.id] === undefined,
  );
  if (missing.length === 0) return;
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab === undefined) throw new Error(`Unknown lab ${labId}`);
    for (const segment of missing) {
      mutableLab.market.segments[segment.id] = initialSegmentState(
        segment,
        content,
        initialShareForSegment(segment, mutableLab.market.marketShare),
      );
    }
  });
}

/**
 * Worldwide instantaneous inference demand at a given relevant capability.
 *
 * The returned value is a compute rate in TFLOP/s. Capability 0 starts at
 * 80 PFLOP/s under the authored balance and capability 88 reaches 800 EFLOP/s.
 */
export function globalServingDemandTeraflops(
  content: CompiledContent,
  capability: number,
): number {
  return (
    content.market.baseGlobalServingDemandTeraflops *
    10 ** (clamp(capability, 0, 100) / content.market.servingDemandCapabilityDivisor)
  );
}

/**
 * How much more customers pay for each delivered FLOP than at capability zero.
 * Demand creates new uses exponentially; unit value rises much more slowly and
 * is bounded at 6x under the authored coefficient of five.
 */
export function deliveredFlopValueMultiplier(
  content: CompiledContent,
  capability: number,
): number {
  const normalisedCapability = clamp(capability, 0, 100) / 100;
  return (
    1 + content.market.valuePerDeliveredFlopQuadraticFactor * normalisedCapability ** 2
  );
}

/** Worldwide revenue opportunity for one four-week cycle, in $m. */
export function globalRevenueOpportunityMillionsPerCycle(
  content: CompiledContent,
  capability: number,
): CashMillions {
  const demandGrowth =
    globalServingDemandTeraflops(content, capability) /
    content.market.baseGlobalServingDemandTeraflops;
  return roundMoney(
    content.market.baseGlobalRevenueMillionsPerCycle *
      demandGrowth *
      deliveredFlopValueMultiplier(content, capability),
  );
}

function servingComputePerRequest(state: Readonly<GameState>, labId: LabId): number {
  return resolveModifierValue(state, "serving.computePerRequest", 1, {
    labId,
    includeUnscoped: labId === state.run.playerLabId,
    clampMin: 0.05,
  }).final;
}

/**
 * Legacy content calls this acquisition rate. The market no longer retains or
 * converges a demand stock: these effects now change the immediately
 * addressable share of the market instead.
 */
function marketReachMultiplier(state: Readonly<GameState>, labId: LabId): number {
  return resolveModifierValue(state, "lab.market.acquisitionRate", 1, {
    labId,
    includeUnscoped: labId === state.run.playerLabId,
    clampMin: 0,
  }).final;
}

function servingCapacityTeraflopsForTarget(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  servingTargetPhysicalGpus: number,
): number {
  return capacityOfPlan(
    state,
    content,
    labId,
    planGpuPortfolioWithServingTarget(state, content, labId, servingTargetPhysicalGpus),
  );
}

function servingCapacityTeraflops(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  allocationOverride?: GpuAllocationState,
): number {
  return capacityOfPlan(
    state,
    content,
    labId,
    planGpuPortfolio(state, content, labId, allocationOverride),
  );
}

function capacityOfPlan(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  plan: ReturnType<typeof planGpuPortfolio>,
): number {
  const physicalGpuByLot = Object.fromEntries(
    plan.allocation.lots.map((lot) => [lot.lotId, lot.servingPhysicalGpus]),
  );
  // Serving factors share the same 4-TFLOP/s generation anchor as training
  // factors. The result includes generation, lot availability, power,
  // interconnect and workload-throughput modifiers.
  return (
    calculateGpuThroughput(state, content, labId, "serving", {
      physicalGpuByLot,
    }).final * TERAFLOPS_PER_TRAINING_FACTOR
  );
}

export interface SegmentUsageForecast {
  readonly segmentId: string;
  readonly unlocked: boolean;
  readonly lockReason?: string;
  readonly appeal: AppealBreakdown;
  readonly softmaxShare: number;
  readonly globalServingDemandTeraflops: number;
  readonly requestedTeraflops: number;
  readonly deliveredTeraflops: number;
  readonly unmetTeraflops: number;
  readonly valuePerDeliveredFlopMultiplier: number;
  readonly potentialRevenueMillionsPerCycle: CashMillions;
  readonly grossRevenueMillionsThisWeek: CashMillions;
}

export function isMarketSegmentUnlocked(
  state: Readonly<GameState>,
  labId: LabId,
  segmentId: string,
): boolean {
  if (segmentId !== GOVERNMENT_SEGMENT_ID) return true;
  const lab = requireLab(state, labId);
  return (
    lab.politics.governmentTrust >= 45 ||
    lab.flags["market:government-segment-unlocked"] === true
  );
}

export interface UsageForecast {
  readonly servingCapacityTeraflops: number;
  readonly requestedTeraflops: number;
  readonly deliveredTeraflops: number;
  readonly unmetTeraflops: number;
  readonly revenueMillionsThisWeek: CashMillions;
  readonly segments: readonly SegmentUsageForecast[];
  readonly deploymentPolicy: import("@neolab/content-schema").DeploymentPolicy;
}

export interface ServingDemandCap {
  /** Physical GPUs whose delivered throughput exactly covers demand. */
  readonly maximumPhysicalGpus: number;
  readonly requestedTeraflops: number;
  /** Whole fleet, the denominator the player's ceiling is measured against. */
  readonly fleetPhysicalGpus: number;
  readonly fullFleetCapacityTeraflops: number;
}

export function forecastUsage(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  capabilitySource: "true" | "measured" = "true",
): UsageForecast {
  const capacityTeraflops = servingCapacityTeraflops(state, content, labId);
  const model = commercialModel(state, labId);
  const deployment =
    model === undefined
      ? content.deployment.policies["internal-only"]
      : content.deployment.policies[model.deployment.policy];
  const perRequestCompute = servingComputePerRequest(state, labId);
  const marketReach = marketReachMultiplier(state, labId);
  const segmentRows = Object.values(content.market.segments).map((segment) => {
    const unlocked = isMarketSegmentUnlocked(state, labId, segment.id);
    const appeal = calculateSegmentAppeal(
      state,
      content,
      labId,
      segment.id,
      capabilitySource,
    );
    const share = liveSegmentShare(state, content, labId, segment, capabilitySource);
    const globalDemand = globalServingDemandTeraflops(content, appeal.relevantCapability);
    const rawRequestedTeraflops =
      globalDemand *
      segment.servingComputeShare *
      share *
      deployment.marketDemandMultiplier *
      perRequestCompute *
      marketReach;
    const globalRevenue = globalRevenueOpportunityMillionsPerCycle(
      content,
      appeal.relevantCapability,
    );
    const valuePerDeliveredFlop = deliveredFlopValueMultiplier(
      content,
      appeal.relevantCapability,
    );
    const rawRevenueMillionsPerCycle =
      globalRevenue *
      segment.revenueShare *
      share *
      deployment.revenueMultiplier *
      marketReach;
    // Commercial-ceiling modifiers represent how much of an otherwise
    // addressable market this lab can reach. They change both customer compute
    // and the associated revenue, but never the value of an already delivered
    // unit through a hidden price.
    const requestedTeraflops = !unlocked
      ? 0
      : labId === state.run.playerLabId
        ? resolveModifierValue(state, "lab.market.demandCeiling", rawRequestedTeraflops, {
            clampMin: 0,
          }).final
        : rawRequestedTeraflops;
    const potentialRevenueMillionsPerCycle = !unlocked
      ? 0
      : labId === state.run.playerLabId
        ? resolveModifierValue(
            state,
            "lab.market.demandCeiling",
            rawRevenueMillionsPerCycle,
            { clampMin: 0 },
          ).final
        : rawRevenueMillionsPerCycle;
    return {
      segment,
      unlocked,
      appeal,
      share,
      globalDemand,
      valuePerDeliveredFlop,
      requestedTeraflops,
      potentialRevenueMillionsPerCycle,
    };
  });
  const requestedTeraflops = segmentRows.reduce(
    (sum, row) => sum + row.requestedTeraflops,
    0,
  );
  const deliveredTeraflops = Math.min(capacityTeraflops, requestedTeraflops);
  const deliveryFraction =
    requestedTeraflops === 0 ? 1 : deliveredTeraflops / requestedTeraflops;
  const segments = segmentRows.map((row): SegmentUsageForecast => {
    const segmentDeliveredTeraflops = row.requestedTeraflops * deliveryFraction;
    const weeklyRevenue =
      (row.potentialRevenueMillionsPerCycle / MARKET_CYCLE_WEEKS) * deliveryFraction;
    return {
      segmentId: row.segment.id,
      unlocked: row.unlocked,
      ...(row.unlocked
        ? {}
        : { lockReason: "Requires Government Trust 45 or a government contract" }),
      appeal: row.appeal,
      softmaxShare: row.share,
      globalServingDemandTeraflops: round(row.globalDemand),
      requestedTeraflops: round(row.requestedTeraflops),
      deliveredTeraflops: round(segmentDeliveredTeraflops),
      unmetTeraflops: round(row.requestedTeraflops - segmentDeliveredTeraflops),
      valuePerDeliveredFlopMultiplier: round(row.valuePerDeliveredFlop),
      potentialRevenueMillionsPerCycle: roundMoney(row.potentialRevenueMillionsPerCycle),
      grossRevenueMillionsThisWeek: roundMoney(weeklyRevenue),
    };
  });
  return {
    servingCapacityTeraflops: round(capacityTeraflops),
    requestedTeraflops: round(requestedTeraflops),
    deliveredTeraflops: round(deliveredTeraflops),
    unmetTeraflops: round(requestedTeraflops - deliveredTeraflops),
    revenueMillionsThisWeek: roundMoney(
      segments.reduce((sum, segment) => sum + segment.grossRevenueMillionsThisWeek, 0),
    ),
    segments,
    deploymentPolicy: deployment.policy,
  };
}

/**
 * Fewest physical GPUs whose delivered throughput covers current demand.
 *
 * The monotone binary search honours reservations, heterogeneous generations,
 * integer allocation, outages and serving modifiers, none of which let a
 * closed form work. `maximumPhysicalGpus` is the demand term of the serving
 * waterfall; serving never grows past it, so surplus fleet reaches research
 * instead of idling on customers who are already fully served.
 */
export function calculateServingDemandCap(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  capabilitySource: "true" | "measured" = "true",
): ServingDemandCap {
  const lab = requireLab(state, labId);
  const requestedTeraflops = forecastUsage(
    state,
    content,
    labId,
    capabilitySource,
  ).requestedTeraflops;
  const availablePhysicalGpus = Object.values(
    resolveGpuReservations(state, content, labId).remainingByLot,
  ).reduce((sum, count) => sum + count, 0);
  const fleetPhysicalGpus = lab.compute.lots.reduce(
    (sum, lot) => sum + lot.physicalCount,
    0,
  );
  const capacityAt = (servingGpus: number): number =>
    servingCapacityTeraflopsForTarget(state, content, labId, servingGpus);
  const fullFleetCapacityTeraflops = capacityAt(availablePhysicalGpus);
  if (requestedTeraflops <= 0) {
    return {
      maximumPhysicalGpus: 0,
      requestedTeraflops: 0,
      fleetPhysicalGpus,
      fullFleetCapacityTeraflops: round(fullFleetCapacityTeraflops),
    };
  }
  if (fullFleetCapacityTeraflops <= requestedTeraflops) {
    return {
      maximumPhysicalGpus: availablePhysicalGpus,
      requestedTeraflops,
      fleetPhysicalGpus,
      fullFleetCapacityTeraflops: round(fullFleetCapacityTeraflops),
    };
  }

  let low = 0;
  let high = availablePhysicalGpus;
  while (low < high) {
    const candidate = Math.floor((low + high) / 2);
    if (capacityAt(candidate) >= requestedTeraflops) high = candidate;
    else low = candidate + 1;
  }
  return {
    maximumPhysicalGpus: low,
    requestedTeraflops,
    fleetPhysicalGpus,
    fullFleetCapacityTeraflops: round(fullFleetCapacityTeraflops),
  };
}

/**
 * Settle this week's serving grant: the smallest of the player's fleet-share
 * ceiling, what demand can actually absorb, and the hardware reservations have
 * left behind. Recomputed from scratch every tick and in both directions, so a
 * grant can never stick low after the fleet or demand moves. Research is the
 * residual and needs no decision of its own.
 */
export function settledServingPhysicalGpusFor(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  allocation: GpuAllocationState,
): number {
  const lab = requireLab(state, labId);
  const available = Object.values(
    resolveGpuReservations(state, content, labId).remainingByLot,
  ).reduce((sum, count) => sum + count, 0);
  return Math.min(
    servingFleetShareGpus(lab, allocation),
    calculateServingDemandCap(state, content, labId).maximumPhysicalGpus,
    available,
  );
}

export function settledServingPhysicalGpus(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): number {
  return settledServingPhysicalGpusFor(
    state,
    content,
    labId,
    requireLab(state, labId).compute.allocation,
  );
}

export function settleServingAllocation(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
): void {
  const state = tx.read();
  const lab = requireLab(state, labId);
  const settled = settledServingPhysicalGpus(state, content, labId);
  if (lab.compute.servingPhysicalGpus === settled) return;
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab === undefined) throw new Error(`Unknown lab ${labId}`);
    mutableLab.compute.servingPhysicalGpus = gpuCount(settled);
  });
}

/**
 * How much standing a segment gains for the share of its demand that was met.
 *
 * Serving everything you are asked for earns the full amount; serving part of
 * it earns proportionally less, down to nothing. It never goes negative.
 * Unmet demand is a symptom of success -- the fleet is smaller than the
 * appetite for the product -- and charging for it made satisfaction fall
 * exactly as a lab grew, while the remedy, more GPUs, is the thing it cannot
 * yet afford. Neglect is still felt through capability and reliability, which
 * do go negative.
 */
export function deliverySatisfactionDelta(fulfilment: number): number {
  return DELIVERY_SATISFACTION_GAIN * clamp(fulfilment, 0, 1);
}

/** Standing earned by a segment whose demand is met in full, per cycle. */
export const DELIVERY_SATISFACTION_GAIN = 3;

/** Exact accrued revenue plus a current-plan estimate for unelapsed cycle weeks. */
export function projectMarketCycleRevenue(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  capabilitySource: "true" | "measured" = "true",
): CashMillions {
  const lab = requireLab(state, labId);
  const accrued = Object.values(lab.market.segments).reduce(
    (sum, segment) => sum + segment.accruedRevenueMillions,
    0,
  );
  const remainingWeeks = Math.max(
    0,
    MARKET_CYCLE_WEEKS - lab.market.weeksAccruedThisCycle,
  );
  const estimatedRemaining = forecastUsage(
    state,
    content,
    labId,
    capabilitySource,
  ).revenueMillionsThisWeek;
  return roundMoney(accrued + estimatedRemaining * remainingWeeks);
}

export interface ProjectedServingAura {
  /** Aura the current standing would earn when this cycle settles. */
  readonly perCycle: number;
  readonly requestedTeraflops: number;
  readonly deliveredTeraflops: number;
  readonly fulfilment: number;
}

/**
 * Project the cycle award from usage already delivered plus the current plan
 * repeated through the unelapsed weeks. This is the same aggregate rule used
 * at settlement, so the overview and allocation preview can explain the award.
 */
export function projectServingAura(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  capabilitySource: "true" | "measured" = "true",
): ProjectedServingAura {
  const lab = state.labs[labId];
  if (lab === undefined) {
    return {
      perCycle: 0,
      requestedTeraflops: 0,
      deliveredTeraflops: 0,
      fulfilment: 0,
    };
  }
  const forecast = forecastUsage(state, content, labId, capabilitySource);
  const remainingWeeks = Math.max(
    0,
    MARKET_CYCLE_WEEKS - lab.market.weeksAccruedThisCycle,
  );
  const requestedTeraflops = Object.values(lab.market.segments).reduce(
    (sum, segment) => sum + segment.accruedRequestedUsage,
    forecast.requestedTeraflops * remainingWeeks,
  );
  const deliveredTeraflops = Object.values(lab.market.segments).reduce(
    (sum, segment) => sum + segment.accruedDeliveredUsage,
    forecast.deliveredTeraflops * remainingWeeks,
  );
  return {
    perCycle: servingAuraForUsage(requestedTeraflops, deliveredTeraflops),
    requestedTeraflops,
    deliveredTeraflops,
    fulfilment:
      requestedTeraflops <= 0 ? 0 : clamp(deliveredTeraflops / requestedTeraflops, 0, 1),
  };
}

export function accrueWeeklyUsage(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
): UsageForecast {
  initialiseMarketIfNeeded(tx, content, labId);
  settleServingAllocation(tx, content, labId);
  const state = tx.read();
  const lab = requireLab(state, labId);
  if (lab.market.weeksAccruedThisCycle >= MARKET_CYCLE_WEEKS) {
    throw new Error(`Market cycle for ${labId} accrued more than four weeks`);
  }
  const forecast = forecastUsage(state, content, labId);
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab === undefined) throw new Error(`Unknown lab ${labId}`);
    mutableLab.market.weeksAccruedThisCycle += 1;
    for (const row of forecast.segments) {
      const segment = mutableLab.market.segments[row.segmentId];
      if (segment === undefined) throw new Error(`Missing segment ${row.segmentId}`);
      segment.accruedRequestedUsage = round(
        segment.accruedRequestedUsage + row.requestedTeraflops,
      );
      segment.accruedDeliveredUsage = round(
        segment.accruedDeliveredUsage + row.deliveredTeraflops,
      );
      segment.accruedRevenueMillions = roundMoney(
        segment.accruedRevenueMillions + row.grossRevenueMillionsThisWeek,
      );
    }
  });
  return forecast;
}

export interface MarketSettlement {
  readonly segmentId: string;
  readonly requestedTeraflops: number;
  readonly deliveredTeraflops: number;
  readonly revenueMillions: CashMillions;
  readonly satisfactionBefore: number;
  readonly satisfactionDelta: number;
  readonly satisfactionAfter: number;
  readonly currentDemandTeraflops: number;
}

interface PreparedMarketSettlement {
  readonly labId: LabId;
  readonly settlements: readonly MarketSettlement[];
  readonly servingAura: number;
  readonly marketShare: number;
}

function prepareMarketSettlement(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  _settledAt: Tick,
): PreparedMarketSettlement {
  const lab = requireLab(state, labId);
  if (lab.market.weeksAccruedThisCycle !== MARKET_CYCLE_WEEKS) {
    throw new Error(
      `Cannot settle ${labId} market after ${String(lab.market.weeksAccruedThisCycle)} weeks`,
    );
  }
  const usageForecast = forecastUsage(state, content, labId);
  const model = commercialModel(state, labId);
  const settlements = Object.values(content.market.segments).map(
    (definition): MarketSettlement => {
      const stored = lab.market.segments[definition.id];
      const forecast = usageForecast.segments.find(
        (candidate) => candidate.segmentId === definition.id,
      );
      if (stored === undefined || forecast === undefined) {
        throw new Error(`Missing market segment ${definition.id}`);
      }
      const fulfilment =
        stored.accruedRequestedUsage === 0
          ? 1
          : stored.accruedDeliveredUsage / stored.accruedRequestedUsage;
      const deliveryDelta = deliverySatisfactionDelta(fulfilment);
      const reliabilityDelta = clamp(((model?.reliability ?? 0) - 50) * 0.08, -8, 4);
      const capabilityDelta = clamp(
        (forecast.appeal.relevantCapability - definition.rivalCapabilityBenchmark) * 0.3,
        -6,
        6,
      );
      const satisfactionDelta = round(deliveryDelta + reliabilityDelta + capabilityDelta);
      const satisfactionAfter = clamp(stored.satisfaction + satisfactionDelta, 0, 100);
      return {
        segmentId: definition.id,
        requestedTeraflops: stored.accruedRequestedUsage,
        deliveredTeraflops: stored.accruedDeliveredUsage,
        revenueMillions: stored.accruedRevenueMillions,
        satisfactionBefore: stored.satisfaction,
        satisfactionDelta,
        satisfactionAfter,
        currentDemandTeraflops: forecast.requestedTeraflops,
      };
    },
  );
  const requestedTeraflops = settlements.reduce(
    (sum, settlement) => sum + settlement.requestedTeraflops,
    0,
  );
  const deliveredTeraflops = settlements.reduce(
    (sum, settlement) => sum + settlement.deliveredTeraflops,
    0,
  );
  const servingAura = servingAuraForUsage(requestedTeraflops, deliveredTeraflops);
  const marketShare = usageForecast.segments.reduce((sum, segment) => {
    const definition = content.market.segments[segment.segmentId];
    return sum + segment.softmaxShare * (definition?.revenueShare ?? 0);
  }, 0);
  return { labId, settlements, servingAura, marketShare };
}

function commitMarketSettlements(
  tx: SimulationTransaction,
  content: CompiledContent,
  prepared: readonly PreparedMarketSettlement[],
  settledAt: Tick,
): void {
  tx.update((draft) => {
    for (const result of prepared) {
      const mutableLab = draft.labs[result.labId];
      if (mutableLab === undefined) throw new Error(`Unknown lab ${result.labId}`);
      for (const settlement of result.settlements) {
        const segment = mutableLab.market.segments[settlement.segmentId];
        if (segment === undefined) {
          throw new Error(`Missing segment ${settlement.segmentId}`);
        }
        segment.desiredUsagePerCycle = settlement.currentDemandTeraflops;
        segment.satisfaction = rating(settlement.satisfactionAfter);
        segment.lastCycleRequestedUsage = settlement.requestedTeraflops;
        segment.lastCycleDeliveredUsage = settlement.deliveredTeraflops;
        segment.lastCycleRevenueMillions = settlement.revenueMillions;
        segment.lastCycleSatisfactionDelta = settlement.satisfactionDelta;
        segment.accruedRequestedUsage = 0;
        segment.accruedDeliveredUsage = 0;
        segment.accruedRevenueMillions = cashMillions(0);
      }
      mutableLab.market.weeksAccruedThisCycle = 0;
      mutableLab.market.marketShare = fraction(clamp(result.marketShare, 0, 1));
      if (
        mutableLab.market.pendingPriceTier !== undefined &&
        mutableLab.market.pendingPriceTier !== mutableLab.market.priceTier
      ) {
        mutableLab.market.priceTier = mutableLab.market.pendingPriceTier;
        mutableLab.market.priceChangeTicks = [
          ...mutableLab.market.priceChangeTicks.filter(
            (changedAt) => settledAt - changedAt <= 8,
          ),
          settledAt,
        ];
      }
      delete mutableLab.market.pendingPriceTier;
    }
  });
  for (const result of prepared) {
    if (result.servingAura > 0) {
      applyEffect(
        tx,
        {
          kind: "add-resource",
          subject: { type: "lab", labId: result.labId },
          resource: "aura-spendable",
          amount: result.servingAura,
          auraChangeKind: "gain",
          auraCategory: "customer-serving",
          auraSignalImpact: result.servingAura * content.aura.servingSignalImpactPerAura,
        },
        { kind: "system", id: "market.serving" },
      );
    }
  }
}

export function settleMarketCycle(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  settledAt: Tick,
): readonly MarketSettlement[] {
  initialiseMarketIfNeeded(tx, content, labId);
  const prepared = prepareMarketSettlement(tx.read(), content, labId, settledAt);
  commitMarketSettlements(tx, content, [prepared], settledAt);
  return prepared.settlements;
}

/** TDD 16.3: snapshot every appeal first, then commit all live-lab results once. */
export function settleWorldMarketCycle(
  tx: SimulationTransaction,
  content: CompiledContent,
  settledAt: Tick,
): Readonly<Record<string, readonly MarketSettlement[]>> {
  const labIds = Object.keys(tx.read().labs).sort() as LabId[];
  for (const labId of labIds) initialiseMarketIfNeeded(tx, content, labId);
  const snapshot = tx.read();
  const prepared = labIds.map((labId) =>
    prepareMarketSettlement(snapshot, content, labId, settledAt),
  );
  commitMarketSettlements(tx, content, prepared, settledAt);
  return Object.fromEntries(prepared.map((result) => [result.labId, result.settlements]));
}
