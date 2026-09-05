import type { CompiledContent, ContentId } from "@neolab/content-schema";

import type { GpuLotId, LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import { isProgressiveOpeningCreditAvailable } from "../campaign/progressive-opening.ts";
import {
  fraction,
  gpuCount,
  rating,
  type CashMillions,
  type Tick,
} from "../model/units.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { calculateFacilityCapacity } from "../facilities/facilities.ts";
import { generationTeraflopsPerGpu } from "./flops.ts";
import { resolveGpuReservations } from "./gpu-portfolio.ts";

/** GPUs are bought and sold in blocks of one thousand. */
export const GPU_TRADE_UNIT = 1_000;

/** Selling returns a flat quarter of the catalogue price — never more. */
export const GPU_RESALE_FRACTION = 0.25;

function roundMoney(value: number): CashMillions {
  return (Math.round(value * 100) / 100) as CashMillions;
}

function formatGpuCount(value: number): string {
  // The sim layer must not use toLocale*: its output is environment-dependent
  // and would make saves and snapshots differ by host locale.
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function requireGeneration(content: CompiledContent, generationId: ContentId | string) {
  const generation = content.gpuGenerations[generationId];
  if (generation === undefined) {
    throw new Error(`Unknown GPU generation ${generationId}`);
  }
  return generation;
}

/**
 * Every generation the world has reached, newest first. Older silicon stays
 * purchasable forever — it is cheap, real compute.
 */
export function unlockedGpuGenerationIds(
  state: Readonly<GameState>,
  content: CompiledContent,
): readonly ContentId[] {
  const current = requireGeneration(content, state.world.currentGpuGenerationId);
  return (Object.keys(content.gpuGenerations) as ContentId[])
    .filter(
      (generationId) =>
        requireGeneration(content, generationId).nominalYear <= current.nominalYear,
    )
    .sort(
      (left, right) =>
        requireGeneration(content, right).nominalYear -
          requireGeneration(content, left).nominalYear ||
        (left < right ? -1 : left > right ? 1 : 0),
    );
}

export interface GpuCapacityRequirement {
  readonly supportedPhysicalGpus: number;
  readonly ownedPhysicalGpus: number;
  readonly incomingPhysicalGpus: number;
  readonly projectedOwnedPhysicalGpus: number;
  readonly met: boolean;
}

function capacityRequirement(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  additionalGpus: number,
): GpuCapacityRequirement {
  const lab = requireLab(state, labId);
  const facilityCapacity = calculateFacilityCapacity(state, content, labId);
  const supportedPhysicalGpus = facilityCapacity.supportedOwnedGpuCount;
  const ownedPhysicalGpus = lab.compute.lots.reduce(
    (sum, lot) => sum + (lot.ownership === "owned" ? lot.physicalCount : 0),
    0,
  );
  const incomingPhysicalGpus = lab.compute.deliveries.reduce(
    (sum, delivery) =>
      sum + (delivery.ownership === "owned" ? delivery.physicalCount : 0),
    0,
  );
  const projectedOwnedPhysicalGpus =
    ownedPhysicalGpus + incomingPhysicalGpus + additionalGpus;
  return {
    supportedPhysicalGpus,
    ownedPhysicalGpus,
    incomingPhysicalGpus,
    projectedOwnedPhysicalGpus,
    met: projectedOwnedPhysicalGpus <= supportedPhysicalGpus,
  };
}

export interface GpuPurchaseQuote {
  readonly generationId: ContentId;
  readonly generationDisplayName: string;
  readonly thousandUnits: number;
  readonly physicalGpuCount: number;
  readonly upfrontCostMillions: CashMillions;
  readonly recurringCostMillionsPerCycle: CashMillions;
  readonly deliveryWeeks: number;
  readonly arrivesAt: Tick;
  readonly teraflopsAdded: number;
  readonly reliability: number;
  readonly capacity: GpuCapacityRequirement;
  readonly blockers: readonly string[];
  readonly canPurchase: boolean;
}

/** Quote a direct purchase of `thousandUnits × 1,000` GPUs of a generation. */
export function quoteGpuPurchase(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  generationId: ContentId,
  thousandUnits: number,
): GpuPurchaseQuote {
  const lab = requireLab(state, labId);
  const generation = requireGeneration(content, generationId);
  const blockers: string[] = [];
  if (!Number.isInteger(thousandUnits) || thousandUnits < 1) {
    blockers.push("Orders are placed in whole 1,000-GPU units");
  }
  if (!unlockedGpuGenerationIds(state, content).includes(generationId)) {
    blockers.push(`${generation.displayName} hardware has not been announced yet`);
  }
  const physicalGpuCount = Math.max(0, thousandUnits) * GPU_TRADE_UNIT;
  const modifierScope = {
    labId,
    includeUnscoped: labId === state.run.playerLabId,
  } as const;
  // Upfront price stacks the owned-hardware discount and the general
  // acquisition modifier; recurring cost is electricity, the exclusive
  // domain of lab.compute.ownedPowerCost.
  const rawUpfront = thousandUnits * generation.gameCostMillionsPerThousand;
  const ownedUpfront = resolveModifierValue(
    state,
    "lab.compute.ownedPurchasePrice",
    rawUpfront,
    { ...modifierScope, clampMin: 0 },
  ).final;
  const calculatedUpfrontCostMillions = roundMoney(
    resolveModifierValue(state, "lab.compute.acquisitionCost", ownedUpfront, {
      ...modifierScope,
      clampMin: 0,
    }).final,
  );
  const upfrontCostMillions = calculatedUpfrontCostMillions;
  const openingCreditAvailable = isProgressiveOpeningCreditAvailable(
    state,
    labId,
    "gpu-purchase",
  );
  const recurringCostMillionsPerCycle = roundMoney(
    resolveModifierValue(
      state,
      "lab.compute.ownedPowerCost",
      thousandUnits * generation.gameOperatingCostMillionsPerThousandPerCycle,
      { ...modifierScope, clampMin: 0 },
    ).final,
  );
  const capacity = capacityRequirement(state, content, labId, physicalGpuCount);
  if (!capacity.met) {
    blockers.push(
      `Datacentre capacity supports ${formatGpuCount(capacity.supportedPhysicalGpus)} GPUs; ` +
        `this order would require ${formatGpuCount(capacity.projectedOwnedPhysicalGpus)}. Build more capacity or sell older hardware.`,
    );
  }
  if (
    upfrontCostMillions > 0 &&
    lab.finance.cash < upfrontCostMillions &&
    !openingCreditAvailable
  ) {
    blockers.push("Insufficient cash");
  }
  const deliveryWeeks = Math.max(
    1,
    Math.round(
      resolveModifierValue(
        state,
        "lab.compute.ownedDeliveryDuration",
        generation.deliveryWeeks,
        { ...modifierScope, clampMin: 1 },
      ).final,
    ),
  );
  return {
    generationId,
    generationDisplayName: generation.displayName,
    thousandUnits,
    physicalGpuCount,
    upfrontCostMillions,
    recurringCostMillionsPerCycle,
    deliveryWeeks,
    arrivesAt: (state.run.tick + deliveryWeeks) as Tick,
    teraflopsAdded: physicalGpuCount * generationTeraflopsPerGpu(generation),
    reliability: generation.reliability,
    capacity,
    blockers,
    canPurchase: blockers.length === 0,
  };
}

/** Place a direct GPU order; hardware arrives after the generation's lead time. */
export function buyGpus(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  generationId: ContentId,
  thousandUnits: number,
): GpuLotId {
  const quote = quoteGpuPurchase(tx.read(), content, labId, generationId, thousandUnits);
  if (!quote.canPurchase) {
    throw new Error(`GPU order blocked: ${quote.blockers.join("; ")}`);
  }
  const lotId = tx.allocateId("gpu-lot", labId) as GpuLotId;
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "cash",
      amount: 0 - quote.upfrontCostMillions,
      financeCategory: "compute-purchase",
    },
    { kind: "system", id: lotId },
  );
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Purchase targets unknown lab ${labId}`);
    lab.compute.deliveries.push({
      lotId,
      generationId: quote.generationId,
      ownership: "owned",
      physicalCount: gpuCount(quote.physicalGpuCount),
      reliability: rating(quote.reliability),
      acquisitionCostMillions: quote.upfrontCostMillions,
      recurringCostMillionsPerCycle: quote.recurringCostMillionsPerCycle,
      resaleFraction: fraction(GPU_RESALE_FRACTION),
      orderedAt: draft.run.tick,
      dueAt: quote.arrivesAt,
      conditions: [],
    });
  });
  tx.emit({
    kind: "gpu-order-placed",
    labId,
    lotId,
    arrivesAt: quote.arrivesAt,
  });
  return lotId;
}

export interface GpuSaleQuote {
  readonly generationId: ContentId;
  readonly generationDisplayName: string;
  readonly thousandUnits: number;
  readonly physicalGpuCount: number;
  /** Owned, unreserved GPUs of this generation that could be sold right now. */
  readonly sellablePhysicalGpus: number;
  readonly cashProceedsMillions: CashMillions;
  readonly blockers: readonly string[];
  readonly canSell: boolean;
}

/** Quote selling `thousandUnits × 1,000` owned GPUs of a generation. */
export function quoteGpuSale(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  generationId: ContentId,
  thousandUnits: number,
): GpuSaleQuote {
  const lab = requireLab(state, labId);
  const generation = requireGeneration(content, generationId);
  const blockers: string[] = [];
  if (!Number.isInteger(thousandUnits) || thousandUnits < 1) {
    blockers.push("Sales are placed in whole 1,000-GPU units");
  }
  const remainingByLot = resolveGpuReservations(
    state,
    content,
    labId,
    "committed",
  ).remainingByLot;
  const sellablePhysicalGpus = lab.compute.lots.reduce(
    (sum, lot) =>
      lot.generationId === generationId && lot.ownership === "owned"
        ? sum + Math.min(lot.physicalCount, remainingByLot[lot.id] ?? 0)
        : sum,
    0,
  );
  const physicalGpuCount = Math.max(0, thousandUnits) * GPU_TRADE_UNIT;
  if (physicalGpuCount > sellablePhysicalGpus) {
    blockers.push(
      `Only ${formatGpuCount(sellablePhysicalGpus)} unreserved ${generation.displayName} GPUs can be sold`,
    );
  }
  const cashProceedsMillions = roundMoney(
    thousandUnits * generation.gameCostMillionsPerThousand * GPU_RESALE_FRACTION,
  );
  return {
    generationId,
    generationDisplayName: generation.displayName,
    thousandUnits,
    physicalGpuCount,
    sellablePhysicalGpus,
    cashProceedsMillions,
    blockers,
    canSell: blockers.length === 0,
  };
}

/** Sell owned GPUs of a generation at the flat resale fraction, freeing capacity. */
export function sellGpus(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  generationId: ContentId,
  thousandUnits: number,
): void {
  const quote = quoteGpuSale(tx.read(), content, labId, generationId, thousandUnits);
  if (!quote.canSell) {
    throw new Error(`GPU sale blocked: ${quote.blockers.join("; ")}`);
  }
  const remainingByLot = resolveGpuReservations(
    tx.read(),
    content,
    labId,
    "committed",
  ).remainingByLot;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Sale targets unknown lab ${labId}`);
    let toRemove = quote.physicalGpuCount;
    // Oldest lots first (stable id order matches acquisition order).
    const lots = [...lab.compute.lots].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    for (const lot of lots) {
      if (toRemove <= 0) break;
      if (lot.generationId !== generationId || lot.ownership !== "owned") continue;
      const sellable = Math.min(lot.physicalCount, remainingByLot[lot.id] ?? 0);
      const removed = Math.min(sellable, toRemove);
      if (removed <= 0) continue;
      if (lot.recurringCostMillionsPerCycle !== undefined && lot.physicalCount > 0) {
        lot.recurringCostMillionsPerCycle = roundMoney(
          (lot.recurringCostMillionsPerCycle * (lot.physicalCount - removed)) /
            lot.physicalCount,
        );
      }
      lot.physicalCount = gpuCount(lot.physicalCount - removed);
      toRemove -= removed;
    }
    if (toRemove > 0) {
      throw new Error(`GPU sale could not free ${String(toRemove)} GPUs`);
    }
    lab.compute.lots = lab.compute.lots.filter((lot) => lot.physicalCount > 0);
  });
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "cash",
      amount: quote.cashProceedsMillions,
      financeCategory: "compute-purchase",
    },
    { kind: "system", id: `sell:${generationId}` },
  );
  tx.emit({
    kind: "gpu-lots-sold",
    labId,
    generationId,
    physicalGpus: quote.physicalGpuCount,
    proceedsMillions: quote.cashProceedsMillions,
  });
}

export interface GpuFinanceCostLine {
  readonly category: "compute-lease" | "compute-power";
  readonly sourceId: string;
  readonly amountMillionsPerCycle: CashMillions;
}

export interface GpuFinanceCosts {
  readonly lines: readonly GpuFinanceCostLine[];
  readonly totalMillionsPerCycle: CashMillions;
}

/** Stable finance lines consumed by S2.3's forecast and settlement ledger. */
export function calculateGpuFinanceCosts(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): GpuFinanceCosts {
  const lab = requireLab(state, labId);
  const lines = [...lab.compute.lots]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((lot): GpuFinanceCostLine => {
      const generation = requireGeneration(content, lot.generationId);
      const fallback =
        (lot.physicalCount / 1000) *
        generation.gameOperatingCostMillionsPerThousandPerCycle;
      const amount = lot.recurringCostMillionsPerCycle ?? fallback;
      return {
        category: lot.ownership === "owned" ? "compute-power" : "compute-lease",
        sourceId: lot.id,
        amountMillionsPerCycle: roundMoney(amount),
      };
    });
  return {
    lines,
    totalMillionsPerCycle: roundMoney(
      lines.reduce((sum, line) => sum + line.amountMillionsPerCycle, 0),
    ),
  };
}
