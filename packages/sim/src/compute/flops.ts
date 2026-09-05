import type {
  CompiledContent,
  ContentId,
  GpuGenerationDefinition,
} from "@neolab/content-schema";

import {
  resolveModifierValue,
  resolveResearcherStack,
} from "../engine/modifier-resolver.ts";
import type { GameState, GpuLotState } from "../model/state.ts";
import type { LabId } from "../model/ids.ts";

/**
 * The FLOPS anchor: one Kepler-class GPU (trainingFactor 1.0) delivers
 * 4 TFLOP/s of training compute, matching the real K40's FP32 spec. Every
 * generation's per-GPU rating is trainingFactor × this anchor, so displayed
 * FLOPS are exactly proportional to simulated training throughput — the
 * number the player sees is the number the sim uses.
 */
export const TERAFLOPS_PER_TRAINING_FACTOR = 4;

/**
 * A generation's rating as a piece of hardware, independent of who owns it.
 * Use this for spec sheets -- the procurement and generation dialogs -- and
 * effectiveTeraflopsPerGpu for anything describing a particular lab's fleet.
 */
export function generationTeraflopsPerGpu(generation: {
  readonly trainingFactor: number;
}): number {
  return generation.trainingFactor * TERAFLOPS_PER_TRAINING_FACTOR;
}

/** The modifier target every "your GPUs run better" effect writes to. */
export const THROUGHPUT_TARGET = "lab.compute.workloadThroughput";

/**
 * How much more a lab gets out of each GPU than the bare hardware spec.
 *
 * This is resolved in ONE place and folded into the per-GPU rating, rather
 * than being multiplied in separately by training, research, and serving. That
 * split was how "faster training" effects came to mean three different scopes
 * depending on which consumer read them, and how the fleet FLOPS shown on the
 * overview drifted from the FLOPS the simulation actually used.
 *
 * Researcher-sourced effects stack in full, just like every other visible
 * throughput modifier.
 */
export function fleetThroughputMultiplier(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  const external = resolveModifierValue(state, THROUGHPUT_TARGET, 1, {
    labId,
    excludeSourceKinds: ["researcher"],
  }).final;
  const researchers = resolveResearcherStack(state, THROUGHPUT_TARGET, 1, {
    labId,
  }).final;
  return Math.max(0, external * researchers);
}

/** What one of this lab's GPUs of a given generation actually delivers. */
export function effectiveTeraflopsPerGpu(
  state: Readonly<GameState>,
  labId: LabId,
  generation: { readonly trainingFactor: number },
): number {
  return generationTeraflopsPerGpu(generation) * fleetThroughputMultiplier(state, labId);
}

function requireGeneration(
  content: CompiledContent,
  generationId: string,
): GpuGenerationDefinition {
  const generation = content.gpuGenerations[generationId];
  if (generation === undefined) {
    throw new Error(`Unknown GPU generation ${generationId}`);
  }
  return generation;
}

export function lotTeraflops(content: CompiledContent, lot: GpuLotState): number {
  return (
    lot.physicalCount *
    generationTeraflopsPerGpu(requireGeneration(content, lot.generationId))
  );
}

/** Total fleet training compute in TFLOP/s (ignores reservations). */
/**
 * What the fleet actually delivers, throughput modifiers included. This is the
 * figure shown on the overview, and it used to report bare hardware ratings
 * while the simulation ran on a modified number -- so the headline FLOPS and
 * the FLOPS a training run received silently disagreed.
 */
export function fleetTeraflops(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): number {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const specTeraflops = lab.compute.lots.reduce(
    (sum, lot) => sum + lotTeraflops(content, lot),
    0,
  );
  return specTeraflops * fleetThroughputMultiplier(state, labId);
}

/**
 * The era reference in TFLOP/s: what a reference cluster of current-generation
 * GPUs delivers. Model capability grades committed compute against this.
 */
export function eraReferenceTeraflops(
  state: Readonly<GameState>,
  content: CompiledContent,
): number {
  const generation = requireGeneration(content, state.world.currentGpuGenerationId);
  return (
    content.training.eraReferencePhysicalGpus * generationTeraflopsPerGpu(generation)
  );
}

const SECONDS_PER_WEEK = 604_800;

/** Total FLOP invested by sustaining `teraflops` TFLOP/s for `weeks` weeks. */
export function totalFlopInvested(teraflops: number, weeks: number): number {
  return teraflops * 1e12 * weeks * SECONDS_PER_WEEK;
}

/** TFLOP/s required to deliver a fixed FLOP bill over `weeks` weeks. */
export function teraflopsForTotalFlop(totalFlop: number, weeks: number): number {
  if (totalFlop <= 0) return 0;
  if (!Number.isFinite(weeks) || weeks <= 0) {
    throw new RangeError(`Evaluation duration must be positive, got ${String(weeks)}`);
  }
  return totalFlop / (1e12 * weeks * SECONDS_PER_WEEK);
}

const FLOPS_UNITS: readonly (readonly [number, string])[] = [
  [1e9, "ZFLOP/s"],
  [1e6, "EFLOP/s"],
  [1e3, "PFLOP/s"],
  [1, "TFLOP/s"],
];

/** Format a TFLOP/s rate as a short human string, e.g. "4.2 PFLOP/s". */
export function formatTeraflops(teraflops: number): string {
  for (const [scale, unit] of FLOPS_UNITS) {
    if (teraflops >= scale) {
      const value = teraflops / scale;
      return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
    }
  }
  return `${teraflops.toFixed(2)} TFLOP/s`;
}

const FLOP_UNITS: readonly (readonly [number, string])[] = [
  [1e24, "yottaFLOP"],
  [1e21, "zettaFLOP"],
  [1e18, "exaFLOP"],
];

const SUPERSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

/** Format any positive total FLOP quantity in one-decimal scientific notation. */
export function formatScientificFlop(flop: number): string {
  let exponent = Math.floor(Math.log10(flop));
  let mantissa = flop / 10 ** exponent;
  if (Number(mantissa.toFixed(1)) >= 10) {
    exponent += 1;
    mantissa /= 10;
  }
  const superscriptExponent = String(exponent)
    .split("")
    .map((digit) => SUPERSCRIPT_DIGITS[digit] ?? digit)
    .join("");
  return `${mantissa.toFixed(1)} × 10${superscriptExponent} FLOP`;
}

/** Format a total FLOP quantity, e.g. "3.1 zettaFLOP". */
export function formatTotalFlop(flop: number): string {
  if (flop >= 1e27) {
    return formatScientificFlop(flop);
  }
  for (const [scale, unit] of FLOP_UNITS) {
    if (flop >= scale) {
      const value = flop / scale;
      return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
    }
  }
  return `${(flop / 1e15).toFixed(0)} petaFLOP`;
}

/**
 * Convert a FLOPS requirement into a strongest-lots-first physical
 * reservation plan against currently unreserved lots.
 */
export function planFlopsReservation(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  remainingByLot: Readonly<Record<string, number>>,
  teraflops: number,
): {
  readonly reservedPhysicalGpus: number;
  readonly generationCounts: Readonly<Record<ContentId, number>>;
  readonly availableTeraflops: number;
  readonly reservedTeraflops: number;
} {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const remainingByGeneration = new Map<
    ContentId,
    { physicalGpus: number; usableTeraflops: number }
  >();
  let availableTeraflops = 0;
  for (const lot of lab.compute.lots) {
    const generation = content.gpuGenerations[lot.generationId];
    if (generation === undefined) continue;
    const remaining = remainingByLot[lot.id] ?? 0;
    const usableTeraflops =
      remaining *
      lot.availableFraction *
      effectiveTeraflopsPerGpu(state, labId, generation);
    const current = remainingByGeneration.get(lot.generationId) ?? {
      physicalGpus: 0,
      usableTeraflops: 0,
    };
    current.physicalGpus += remaining;
    current.usableTeraflops += usableTeraflops;
    remainingByGeneration.set(lot.generationId, current);
    availableTeraflops += usableTeraflops;
  }
  const ordered = [...remainingByGeneration.entries()]
    .map(([generationId, remaining]) => ({
      generationId,
      remaining: remaining.physicalGpus,
      teraflopsPerGpu:
        remaining.physicalGpus > 0
          ? remaining.usableTeraflops / remaining.physicalGpus
          : 0,
    }))
    .filter((line) => line.teraflopsPerGpu > 0)
    .sort(
      (left, right) =>
        right.teraflopsPerGpu - left.teraflopsPerGpu ||
        (left.generationId < right.generationId ? -1 : 1),
    );
  const generationCounts: Partial<Record<ContentId, number>> = {};
  let reservedPhysicalGpus = 0;
  let reservedTeraflops = 0;
  let toCover = teraflops;
  for (const line of ordered) {
    if (toCover <= 0) break;
    if (line.remaining <= 0) continue;
    const needed = Math.min(line.remaining, Math.ceil(toCover / line.teraflopsPerGpu));
    if (needed <= 0) continue;
    generationCounts[line.generationId] = needed;
    reservedPhysicalGpus += needed;
    const generationReservation = needed * line.teraflopsPerGpu;
    reservedTeraflops += generationReservation;
    toCover -= generationReservation;
  }
  return {
    reservedPhysicalGpus,
    generationCounts: generationCounts as Readonly<Record<ContentId, number>>,
    availableTeraflops,
    reservedTeraflops,
  };
}

/** GPUs are reserved in whole thousand-lots, matching how they trade. */
export const GPU_RESERVATION_LOT = 1_000;

/**
 * Convert a FLOP bill into a fleet reservation for a fixed duration.
 * Derived, never authored: as hardware generations advance the same bill ties
 * up fewer GPUs, while bills themselves grow with the models being examined.
 * Shared by the evaluation ladder and the Deployment Crisis so one bill means
 * one thing everywhere.
 */
export function flopBillReservation(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  totalFlop: number,
  durationWeeks: number,
): number {
  if (totalFlop <= 0) return 0;
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const physicalCount = lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0);
  const teraflops = fleetTeraflops(state, content, labId);
  if (physicalCount <= 0 || teraflops <= 0) return GPU_RESERVATION_LOT;
  const perGpuFlop = totalFlopInvested(teraflops / physicalCount, durationWeeks);
  const exact = totalFlop / perGpuFlop;
  return Math.max(
    GPU_RESERVATION_LOT,
    Math.ceil(exact / GPU_RESERVATION_LOT) * GPU_RESERVATION_LOT,
  );
}

/**
 * How many weeks a reserved slice of this fleet needs to deliver a FLOP bill.
 * The inverse of `flopBillReservation`, for fixed-reservation flows such as
 * the Deployment Crisis, where the countdown makes duration the derived
 * quantity rather than the chosen one.
 */
export function flopBillWeeks(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  totalFlop: number,
  reservedGpus: number,
): number {
  if (totalFlop <= 0 || reservedGpus <= 0) return 0;
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const physicalCount = lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0);
  const teraflops = fleetTeraflops(state, content, labId);
  if (physicalCount <= 0 || teraflops <= 0) return Number.POSITIVE_INFINITY;
  const perGpuWeekFlop = totalFlopInvested(teraflops / physicalCount, 1);
  return Math.ceil(totalFlop / (reservedGpus * perGpuWeekFlop));
}
