import type { CompiledContent, ContentId } from "@neolab/content-schema";

import type { GpuLotId, LabId } from "../model/ids.ts";
import type {
  GameState,
  GpuAllocationState,
  GpuLotState,
  GpuReservationState,
} from "../model/state.ts";
import { gpuCount } from "../model/units.ts";
import {
  resolveModifierValue,
  type ModifierContribution,
} from "../engine/modifier-resolver.ts";

const BASIS_POINT_TOTAL = 10_000;

/** A leaf allocation below this size consumes GPUs but produces no progress. */
export const MINIMUM_FUNDED_PROGRAM_GPUS = 200;

/** Stage 3 consumes this tick-stamped flag during the research phase. */
export const CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG =
  "research.capabilityContextSwitchPenaltyAtTick";

export type GpuWorkload = "training" | "serving";

export interface GpuSelection {
  /** If omitted, the entire portfolio is selected. Unlisted lots select zero GPUs. */
  readonly physicalGpuByLot?: Readonly<Record<string, number>>;
  /** Required fabric tier for this workload; lower-tier lots remain usable at a penalty. */
  readonly minimumInterconnectTier?: number;
  /** Optional power available in the same authored balance units as `powerPerThousand`. */
  readonly powerCapacity?: number;
}

export interface GpuGenerationThroughputLine {
  readonly generationId: ContentId;
  readonly physicalGpus: number;
  readonly workloadFactor: number;
  readonly weightedAvailability: number;
  readonly weightedInterconnectMultiplier: number;
  readonly powerDemand: number;
  readonly throughputBeforeSoftware: number;
}

export interface GpuThroughputBreakdown {
  readonly workload: GpuWorkload;
  readonly physicalGpus: number;
  readonly availabilityAdjustedPhysicalGpus: number;
  readonly generations: readonly GpuGenerationThroughputLine[];
  readonly softwareEfficiency: number;
  readonly powerDemand: number;
  readonly powerCapacity?: number;
  readonly powerMultiplier: number;
  readonly throughputBeforeSoftware: number;
  readonly throughputBeforeModifiers: number;
  readonly modifierContributions: readonly ModifierContribution[];
  /** Internal formula input. This value is never an owned or player-facing resource. */
  readonly final: number;
}

export interface LotGpuAllocation {
  readonly lotId: GpuLotId;
  readonly physicalGpus: number;
}

export interface ReservationResolution {
  readonly projectId: GpuReservationState["projectId"];
  readonly requestedPhysicalGpus: number;
  readonly allocatedPhysicalGpus: number;
  readonly unmetPhysicalGpus: number;
  readonly generationIds?: readonly ContentId[];
  readonly minimumInterconnectTier?: number;
  readonly allocations: readonly LotGpuAllocation[];
}

export interface ReservationPlan {
  readonly reservations: readonly ReservationResolution[];
  readonly reservedPhysicalGpus: number;
  readonly unmetPhysicalGpus: number;
  readonly reservedByLot: Readonly<Record<string, number>>;
  readonly remainingByLot: Readonly<Record<string, number>>;
}

export interface ProgramGpuAllocation {
  readonly programId: string;
  readonly physicalGpus: number;
  readonly progressEligiblePhysicalGpus: number;
  readonly strandedPhysicalGpus: number;
  readonly isFunded: boolean;
}

export interface LotDiscretionaryAllocation {
  readonly lotId: GpuLotId;
  readonly totalPhysicalGpus: number;
  readonly servingPhysicalGpus: number;
  readonly researchPhysicalGpus: number;
  readonly capabilityPhysicalGpus: number;
  readonly safetyPhysicalGpus: number;
  readonly capabilityPrograms: Readonly<Record<string, number>>;
  readonly safetyPrograms: Readonly<Record<string, number>>;
}

export interface GpuAllocationPlan {
  readonly totalPhysicalGpus: number;
  readonly servingPhysicalGpus: number;
  readonly researchPhysicalGpus: number;
  readonly capabilityPhysicalGpus: number;
  readonly safetyPhysicalGpus: number;
  readonly capabilityPrograms: readonly ProgramGpuAllocation[];
  readonly safetyPrograms: readonly ProgramGpuAllocation[];
  readonly lots: readonly LotDiscretionaryAllocation[];
}

export interface GpuPortfolioPlan {
  readonly reservations: ReservationPlan;
  readonly allocation: GpuAllocationPlan;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${label} must be finite and non-negative, got ${String(value)}`,
    );
  }
}

function sortedLots(lots: readonly GpuLotState[]): readonly GpuLotState[] {
  const ordered = [...lots].sort((left, right) => compareIds(left.id, right.id));
  const seen = new Set<string>();
  for (const lot of ordered) {
    requireNonNegativeInteger(lot.physicalCount, `GPU lot ${lot.id}`);
    if (seen.has(lot.id)) {
      throw new Error(`Duplicate GPU lot ID ${lot.id}`);
    }
    seen.add(lot.id);
  }
  return ordered;
}

/**
 * Hamilton/largest-remainder apportionment. Stable ID order resolves exact ties.
 * The returned integer values sum exactly to `total`.
 */
function apportion(
  total: number,
  weightedTargets: readonly { readonly id: string; readonly weight: number }[],
): Readonly<Record<string, number>> {
  requireNonNegativeInteger(total, "Apportionment total");
  const targets = [...weightedTargets].sort((left, right) =>
    compareIds(left.id, right.id),
  );
  if (targets.length === 0) {
    if (total === 0) return {};
    throw new Error("Cannot apportion a positive total across zero targets");
  }
  const seen = new Set<string>();
  let weightTotal = 0;
  for (const target of targets) {
    if (seen.has(target.id)) throw new Error(`Duplicate allocation target ${target.id}`);
    seen.add(target.id);
    requireNonNegativeInteger(target.weight, `Weight for ${target.id}`);
    weightTotal += target.weight;
  }
  if (weightTotal <= 0) {
    if (total === 0) return Object.fromEntries(targets.map((target) => [target.id, 0]));
    throw new Error("Cannot apportion a positive total with zero total weight");
  }

  const rows = targets.map((target) => {
    const numerator = total * target.weight;
    return {
      id: target.id,
      value: Math.floor(numerator / weightTotal),
      remainder: numerator % weightTotal,
    };
  });
  const remaining = total - rows.reduce((sum, row) => sum + row.value, 0);
  const remainderOrder = [...rows].sort(
    (left, right) => right.remainder - left.remainder || compareIds(left.id, right.id),
  );
  for (let index = 0; index < remaining; index += 1) {
    const row = remainderOrder[index];
    if (row === undefined) throw new Error("Largest-remainder apportionment overflow");
    row.value += 1;
  }
  return Object.fromEntries(rows.map((row) => [row.id, row.value]));
}

function requireBasisPointWeights(
  weights: Readonly<Record<string, number>>,
  label: string,
): readonly { readonly id: string; readonly weight: number }[] {
  const entries = Object.entries(weights).map(([id, weight]) => ({ id, weight }));
  for (const entry of entries) {
    requireNonNegativeInteger(entry.weight, `${label} weight ${entry.id}`);
    if (entry.weight > BASIS_POINT_TOTAL) {
      throw new RangeError(
        `${label} weight ${entry.id} exceeds ${String(BASIS_POINT_TOTAL)}`,
      );
    }
  }
  const sum = entries.reduce((total, entry) => total + entry.weight, 0);
  if (sum !== BASIS_POINT_TOTAL) {
    throw new Error(`${label} weights must sum to 10000, got ${String(sum)}`);
  }
  return entries;
}

/** Draw an integer request proportionally from remaining lot capacities. */
function drawProportionally(
  requested: number,
  capacityByLot: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  requireNonNegativeInteger(requested, "GPU request");
  const capacities = Object.entries(capacityByLot)
    .map(([id, weight]) => ({ id, weight }))
    .sort((left, right) => compareIds(left.id, right.id));
  const capacity = capacities.reduce((sum, row) => sum + row.weight, 0);
  if (requested > capacity) {
    throw new RangeError(
      `GPU request ${String(requested)} exceeds available capacity ${String(capacity)}`,
    );
  }
  if (capacity === 0) return Object.fromEntries(capacities.map((row) => [row.id, 0]));
  return apportion(requested, capacities);
}

function subtractAllocation(
  capacityByLot: Readonly<Record<string, number>>,
  allocationByLot: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(capacityByLot).map(([lotId, capacity]) => {
      const used = allocationByLot[lotId] ?? 0;
      if (used > capacity) throw new Error(`GPU allocation exceeds lot ${lotId}`);
      return [lotId, capacity - used];
    }),
  );
}

function makeProgramAllocation(
  programId: string,
  physicalGpus: number,
): ProgramGpuAllocation {
  const isFunded = physicalGpus >= MINIMUM_FUNDED_PROGRAM_GPUS;
  return {
    programId,
    physicalGpus,
    progressEligiblePhysicalGpus: isFunded ? physicalGpus : 0,
    strandedPhysicalGpus: isFunded ? 0 : physicalGpus,
    isFunded,
  };
}

function assignProgramsToLots(
  programTotals: Readonly<Record<string, number>>,
  parentByLot: Readonly<Record<string, number>>,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const programIds = Object.keys(programTotals).sort(compareIds);
  let remainingByLot = { ...parentByLot };
  const byProgram: Record<string, Readonly<Record<string, number>>> = {};
  for (const [index, programId] of programIds.entries()) {
    const isLast = index === programIds.length - 1;
    const allocation = isLast
      ? remainingByLot
      : drawProportionally(programTotals[programId] ?? 0, remainingByLot);
    byProgram[programId] = allocation;
    remainingByLot = { ...subtractAllocation(remainingByLot, allocation) };
  }
  return byProgram;
}

/**
 * Resolve fixed reservations before the serving/R&D hierarchy. Reservation order is
 * canonical state order; eligible lots are always apportioned in stable lot-ID order.
 */
export function resolveGpuReservations(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): ReservationPlan {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`resolveGpuReservations: unknown lab ${labId}`);
  const lots = sortedLots(lab.compute.lots);
  let remainingByLot: Readonly<Record<string, number>> = Object.fromEntries(
    lots.map((lot) => [lot.id, lot.physicalCount]),
  );
  const resolutions: ReservationResolution[] = [];

  for (const reservation of lab.compute.reservations) {
    requireNonNegativeInteger(reservation.gpus, `Reservation ${reservation.projectId}`);
    if (
      reservation.minimumInterconnectTier !== undefined &&
      (!Number.isInteger(reservation.minimumInterconnectTier) ||
        reservation.minimumInterconnectTier < 1)
    ) {
      throw new RangeError(
        `Reservation ${reservation.projectId} has invalid interconnect tier`,
      );
    }
    const eligibleByLot = Object.fromEntries(
      lots.map((lot) => {
        const generation = content.gpuGenerations[lot.generationId];
        if (generation === undefined) {
          throw new Error(`Unknown GPU generation ${lot.generationId} on lot ${lot.id}`);
        }
        const generationAllowed =
          reservation.generationIds === undefined ||
          reservation.generationIds.length === 0 ||
          reservation.generationIds.includes(lot.generationId);
        const interconnectAllowed =
          reservation.minimumInterconnectTier === undefined ||
          generation.interconnectTier >= reservation.minimumInterconnectTier;
        return [
          lot.id,
          generationAllowed && interconnectAllowed ? (remainingByLot[lot.id] ?? 0) : 0,
        ];
      }),
    );
    const eligible = Object.values(eligibleByLot).reduce((sum, count) => sum + count, 0);
    const allocated = Math.min(reservation.gpus, eligible);
    const allocationByLot = drawProportionally(allocated, eligibleByLot);
    remainingByLot = subtractAllocation(remainingByLot, allocationByLot);
    resolutions.push({
      projectId: reservation.projectId,
      requestedPhysicalGpus: reservation.gpus,
      allocatedPhysicalGpus: allocated,
      unmetPhysicalGpus: reservation.gpus - allocated,
      ...(reservation.generationIds === undefined
        ? {}
        : { generationIds: [...reservation.generationIds] }),
      ...(reservation.minimumInterconnectTier === undefined
        ? {}
        : { minimumInterconnectTier: reservation.minimumInterconnectTier }),
      allocations: Object.entries(allocationByLot)
        .filter(([, count]) => count > 0)
        .sort(([left], [right]) => compareIds(left, right))
        .map(([lotId, physicalGpus]) => ({ lotId: lotId as GpuLotId, physicalGpus })),
    });
  }

  const reservedByLot = Object.fromEntries(
    lots.map((lot) => [lot.id, lot.physicalCount - (remainingByLot[lot.id] ?? 0)]),
  );
  return {
    reservations: resolutions,
    reservedPhysicalGpus: Object.values(reservedByLot).reduce(
      (sum, count) => sum + count,
      0,
    ),
    unmetPhysicalGpus: resolutions.reduce(
      (sum, reservation) => sum + reservation.unmetPhysicalGpus,
      0,
    ),
    reservedByLot,
    remainingByLot,
  };
}

/**
 * Convert basis-point requests into exact integer physical-GPU allocations.
 * Allocation uses nominal physical assets; outages remain an explicit throughput factor.
 */
export function normaliseAllocation(
  requested: GpuAllocationState,
  availableLots: readonly GpuLotState[],
): GpuAllocationPlan {
  requireNonNegativeInteger(requested.servingBasisPoints, "Serving basis points");
  requireNonNegativeInteger(requested.capabilityBasisPoints, "Capability basis points");
  if (
    requested.servingBasisPoints > BASIS_POINT_TOTAL ||
    requested.capabilityBasisPoints > BASIS_POINT_TOTAL
  ) {
    throw new RangeError("Allocation basis points must not exceed 10000");
  }
  const domainWeights = requireBasisPointWeights(
    requested.capabilityDomainWeights,
    "Capability domain",
  );
  const safetyWeights = requireBasisPointWeights(
    requested.safetyProgramWeights,
    "Safety programme",
  );
  const lots = sortedLots(availableLots);
  const totalPhysicalGpus = lots.reduce((sum, lot) => sum + lot.physicalCount, 0);

  const topLevel = apportion(totalPhysicalGpus, [
    { id: "research", weight: BASIS_POINT_TOTAL - requested.servingBasisPoints },
    { id: "serving", weight: requested.servingBasisPoints },
  ]);
  const servingPhysicalGpus = topLevel["serving"] ?? 0;
  const researchPhysicalGpus = topLevel["research"] ?? 0;
  const researchSplit = apportion(researchPhysicalGpus, [
    { id: "capability", weight: requested.capabilityBasisPoints },
    { id: "safety", weight: BASIS_POINT_TOTAL - requested.capabilityBasisPoints },
  ]);
  const capabilityPhysicalGpus = researchSplit["capability"] ?? 0;
  const safetyPhysicalGpus = researchSplit["safety"] ?? 0;
  const capabilityTotals = apportion(capabilityPhysicalGpus, domainWeights);
  const safetyTotals = apportion(safetyPhysicalGpus, safetyWeights);

  const totalByLot = Object.fromEntries(lots.map((lot) => [lot.id, lot.physicalCount]));
  const servingByLot = drawProportionally(servingPhysicalGpus, totalByLot);
  const researchByLot = subtractAllocation(totalByLot, servingByLot);
  const capabilityByLot = drawProportionally(capabilityPhysicalGpus, researchByLot);
  const safetyByLot = subtractAllocation(researchByLot, capabilityByLot);
  const capabilityProgramsByLot = assignProgramsToLots(capabilityTotals, capabilityByLot);
  const safetyProgramsByLot = assignProgramsToLots(safetyTotals, safetyByLot);

  const plan: GpuAllocationPlan = {
    totalPhysicalGpus,
    servingPhysicalGpus,
    researchPhysicalGpus,
    capabilityPhysicalGpus,
    safetyPhysicalGpus,
    capabilityPrograms: Object.entries(capabilityTotals)
      .sort(([left], [right]) => compareIds(left, right))
      .map(([programId, physicalGpus]) => makeProgramAllocation(programId, physicalGpus)),
    safetyPrograms: Object.entries(safetyTotals)
      .sort(([left], [right]) => compareIds(left, right))
      .map(([programId, physicalGpus]) => makeProgramAllocation(programId, physicalGpus)),
    lots: lots.map((lot) => ({
      lotId: lot.id,
      totalPhysicalGpus: lot.physicalCount,
      servingPhysicalGpus: servingByLot[lot.id] ?? 0,
      researchPhysicalGpus: researchByLot[lot.id] ?? 0,
      capabilityPhysicalGpus: capabilityByLot[lot.id] ?? 0,
      safetyPhysicalGpus: safetyByLot[lot.id] ?? 0,
      capabilityPrograms: Object.fromEntries(
        Object.entries(capabilityProgramsByLot).map(([programId, byLot]) => [
          programId,
          byLot[lot.id] ?? 0,
        ]),
      ),
      safetyPrograms: Object.fromEntries(
        Object.entries(safetyProgramsByLot).map(([programId, byLot]) => [
          programId,
          byLot[lot.id] ?? 0,
        ]),
      ),
    })),
  };
  assertGpuAllocationPlan(plan);
  return plan;
}

/** Resolve reservations, then normalise only the remaining physical portfolio. */
export function planGpuPortfolio(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): GpuPortfolioPlan {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`planGpuPortfolio: unknown lab ${labId}`);
  const reservations = resolveGpuReservations(state, content, labId);
  const remainingLots = lab.compute.lots.map((lot) => ({
    ...lot,
    physicalCount: gpuCount(reservations.remainingByLot[lot.id] ?? 0),
  }));
  return {
    reservations,
    allocation: normaliseAllocation(lab.compute.allocation, remainingLots),
  };
}

export interface GpuAllocationPlanViolation {
  readonly code: string;
  readonly detail: string;
}

/** Derived-plan invariant pack; kept separate from canonical-state invariants. */
export function collectGpuAllocationPlanViolations(
  plan: GpuAllocationPlan,
  tolerance = 1e-9,
): readonly GpuAllocationPlanViolation[] {
  const violations: GpuAllocationPlanViolation[] = [];
  const checkSum = (code: string, parent: number, children: readonly number[]): void => {
    const sum = children.reduce((total, child) => total + child, 0);
    if (Math.abs(parent - sum) > tolerance) {
      violations.push({ code, detail: `${String(parent)} != ${String(sum)}` });
    }
  };
  const allCounts = [
    plan.totalPhysicalGpus,
    plan.servingPhysicalGpus,
    plan.researchPhysicalGpus,
    plan.capabilityPhysicalGpus,
    plan.safetyPhysicalGpus,
    ...plan.capabilityPrograms.flatMap((program) => [
      program.physicalGpus,
      program.progressEligiblePhysicalGpus,
      program.strandedPhysicalGpus,
    ]),
    ...plan.safetyPrograms.flatMap((program) => [
      program.physicalGpus,
      program.progressEligiblePhysicalGpus,
      program.strandedPhysicalGpus,
    ]),
    ...plan.lots.flatMap((lot) => [
      lot.totalPhysicalGpus,
      lot.servingPhysicalGpus,
      lot.researchPhysicalGpus,
      lot.capabilityPhysicalGpus,
      lot.safetyPhysicalGpus,
      ...Object.values(lot.capabilityPrograms),
      ...Object.values(lot.safetyPrograms),
    ]),
  ];
  if (allCounts.some((count) => !Number.isInteger(count) || count < 0)) {
    violations.push({ code: "integer-count", detail: "plan has a non-integer count" });
  }
  checkSum("top-level", plan.totalPhysicalGpus, [
    plan.servingPhysicalGpus,
    plan.researchPhysicalGpus,
  ]);
  checkSum("research-split", plan.researchPhysicalGpus, [
    plan.capabilityPhysicalGpus,
    plan.safetyPhysicalGpus,
  ]);
  checkSum(
    "capability-programmes",
    plan.capabilityPhysicalGpus,
    plan.capabilityPrograms.map((program) => program.physicalGpus),
  );
  checkSum(
    "safety-programmes",
    plan.safetyPhysicalGpus,
    plan.safetyPrograms.map((program) => program.physicalGpus),
  );
  for (const program of [...plan.capabilityPrograms, ...plan.safetyPrograms]) {
    checkSum(`program:${program.programId}:funding`, program.physicalGpus, [
      program.progressEligiblePhysicalGpus,
      program.strandedPhysicalGpus,
    ]);
  }
  for (const lot of plan.lots) {
    checkSum(`lot:${lot.lotId}:top-level`, lot.totalPhysicalGpus, [
      lot.servingPhysicalGpus,
      lot.researchPhysicalGpus,
    ]);
    checkSum(`lot:${lot.lotId}:research-split`, lot.researchPhysicalGpus, [
      lot.capabilityPhysicalGpus,
      lot.safetyPhysicalGpus,
    ]);
    checkSum(
      `lot:${lot.lotId}:capability-programmes`,
      lot.capabilityPhysicalGpus,
      Object.values(lot.capabilityPrograms),
    );
    checkSum(
      `lot:${lot.lotId}:safety-programmes`,
      lot.safetyPhysicalGpus,
      Object.values(lot.safetyPrograms),
    );
  }
  checkSum(
    "lot-total",
    plan.totalPhysicalGpus,
    plan.lots.map((lot) => lot.totalPhysicalGpus),
  );
  checkSum(
    "lot-serving",
    plan.servingPhysicalGpus,
    plan.lots.map((lot) => lot.servingPhysicalGpus),
  );
  checkSum(
    "lot-research",
    plan.researchPhysicalGpus,
    plan.lots.map((lot) => lot.researchPhysicalGpus),
  );
  checkSum(
    "lot-capability",
    plan.capabilityPhysicalGpus,
    plan.lots.map((lot) => lot.capabilityPhysicalGpus),
  );
  checkSum(
    "lot-safety",
    plan.safetyPhysicalGpus,
    plan.lots.map((lot) => lot.safetyPhysicalGpus),
  );
  for (const program of plan.capabilityPrograms) {
    checkSum(
      `lot-capability-program:${program.programId}`,
      program.physicalGpus,
      plan.lots.map((lot) => lot.capabilityPrograms[program.programId] ?? 0),
    );
  }
  for (const program of plan.safetyPrograms) {
    checkSum(
      `lot-safety-program:${program.programId}`,
      program.physicalGpus,
      plan.lots.map((lot) => lot.safetyPrograms[program.programId] ?? 0),
    );
  }
  return violations;
}

export function assertGpuAllocationPlan(plan: GpuAllocationPlan): void {
  const violations = collectGpuAllocationPlanViolations(plan);
  if (violations.length > 0) {
    throw new Error(
      `GPU allocation invariant violation(s): ${violations
        .map((violation) => `${violation.code}: ${violation.detail}`)
        .join(" | ")}`,
    );
  }
}

/**
 * Derive workload throughput from physical GPUs and immutable generation balance data.
 * Compiled content is explicit because canonical saves store only generation IDs.
 */
export function calculateGpuThroughput(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  workload: GpuWorkload,
  selection: GpuSelection = {},
): GpuThroughputBreakdown {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`calculateGpuThroughput: unknown lab ${labId}`);
  const lots = sortedLots(lab.compute.lots);
  if (
    selection.minimumInterconnectTier !== undefined &&
    (!Number.isInteger(selection.minimumInterconnectTier) ||
      selection.minimumInterconnectTier < 1)
  ) {
    throw new RangeError("minimumInterconnectTier must be a positive integer");
  }
  if (selection.powerCapacity !== undefined) {
    requireFiniteNonNegative(selection.powerCapacity, "Power capacity");
  }
  const lotIds = new Set<string>(lots.map((lot) => lot.id));
  for (const [lotId, count] of Object.entries(selection.physicalGpuByLot ?? {})) {
    if (!lotIds.has(lotId))
      throw new Error(`GPU selection references unknown lot ${lotId}`);
    requireNonNegativeInteger(count, `GPU selection for ${lotId}`);
  }

  const selected = lots.map((lot) => {
    const physicalGpus =
      selection.physicalGpuByLot === undefined
        ? lot.physicalCount
        : (selection.physicalGpuByLot[lot.id] ?? 0);
    if (physicalGpus > lot.physicalCount) {
      throw new RangeError(
        `GPU selection for ${lot.id} exceeds lot count ${String(lot.physicalCount)}`,
      );
    }
    const generation = content.gpuGenerations[lot.generationId];
    if (generation === undefined) {
      throw new Error(`Unknown GPU generation ${lot.generationId} on lot ${lot.id}`);
    }
    return { lot, generation, physicalGpus };
  });
  const powerDemand = selected.reduce(
    (sum, row) => sum + (row.physicalGpus / 1000) * row.generation.powerPerThousand,
    0,
  );
  const powerMultiplier =
    powerDemand === 0 || selection.powerCapacity === undefined
      ? 1
      : Math.min(1, selection.powerCapacity / powerDemand);

  const generationRows = new Map<
    ContentId,
    {
      physicalGpus: number;
      workloadFactor: number;
      availabilityGpuSum: number;
      interconnectGpuSum: number;
      powerDemand: number;
      throughputBeforeSoftware: number;
    }
  >();
  let availabilityAdjustedPhysicalGpus = 0;
  for (const row of selected) {
    const factor =
      workload === "training"
        ? row.generation.trainingFactor
        : row.generation.servingFactor;
    const interconnectMultiplier =
      selection.minimumInterconnectTier === undefined
        ? 1
        : Math.min(
            1,
            row.generation.interconnectTier / selection.minimumInterconnectTier,
          );
    const throughput =
      row.physicalGpus *
      factor *
      row.lot.availableFraction *
      powerMultiplier *
      interconnectMultiplier;
    availabilityAdjustedPhysicalGpus += row.physicalGpus * row.lot.availableFraction;
    const existing = generationRows.get(row.generation.id) ?? {
      physicalGpus: 0,
      workloadFactor: factor,
      availabilityGpuSum: 0,
      interconnectGpuSum: 0,
      powerDemand: 0,
      throughputBeforeSoftware: 0,
    };
    existing.physicalGpus += row.physicalGpus;
    existing.availabilityGpuSum += row.physicalGpus * row.lot.availableFraction;
    existing.interconnectGpuSum += row.physicalGpus * interconnectMultiplier;
    existing.powerDemand += (row.physicalGpus / 1000) * row.generation.powerPerThousand;
    existing.throughputBeforeSoftware += throughput;
    generationRows.set(row.generation.id, existing);
  }
  const generations = [...generationRows.entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([generationId, row]): GpuGenerationThroughputLine => ({
      generationId,
      physicalGpus: row.physicalGpus,
      workloadFactor: row.workloadFactor,
      weightedAvailability:
        row.physicalGpus === 0 ? 1 : row.availabilityGpuSum / row.physicalGpus,
      weightedInterconnectMultiplier:
        row.physicalGpus === 0 ? 1 : row.interconnectGpuSum / row.physicalGpus,
      powerDemand: row.powerDemand,
      throughputBeforeSoftware: row.throughputBeforeSoftware,
    }));
  const throughputBeforeSoftware = generations.reduce(
    (sum, generation) => sum + generation.throughputBeforeSoftware,
    0,
  );
  const throughputBeforeModifiers =
    throughputBeforeSoftware * lab.compute.softwareEfficiency;
  const modifierBreakdown = resolveModifierValue(
    state,
    "lab.compute.workloadThroughput",
    throughputBeforeModifiers,
    { clampMin: 0 },
  );
  return {
    workload,
    physicalGpus: selected.reduce((sum, row) => sum + row.physicalGpus, 0),
    availabilityAdjustedPhysicalGpus,
    generations,
    softwareEfficiency: lab.compute.softwareEfficiency,
    powerDemand,
    ...(selection.powerCapacity === undefined
      ? {}
      : { powerCapacity: selection.powerCapacity }),
    powerMultiplier,
    throughputBeforeSoftware,
    throughputBeforeModifiers,
    modifierContributions: modifierBreakdown.contributions,
    final: modifierBreakdown.final,
  };
}

/** True only when any capability-domain allocation moves by more than 25 points. */
export function hasLargeCapabilityDomainSwing(
  previous: GpuAllocationState,
  next: GpuAllocationState,
): boolean {
  const domainIds = new Set([
    ...Object.keys(previous.capabilityDomainWeights),
    ...Object.keys(next.capabilityDomainWeights),
  ]);
  return [...domainIds].some(
    (domainId) =>
      Math.abs(
        (previous.capabilityDomainWeights[domainId] ?? 0) -
          (next.capabilityDomainWeights[domainId] ?? 0),
      ) > 2500,
  );
}
