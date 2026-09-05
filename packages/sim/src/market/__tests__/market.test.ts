import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { planGpuPortfolio } from "../../compute/gpu-portfolio.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { CommandId, ModifierId, ProjectId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { basisPoints, cashMillions, gpuCount, rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { forecastFinance } from "../../finance/finance.ts";
import {
  accrueWeeklyUsage,
  calculateSegmentAppeal,
  calculateServingDemandCap,
  deliveredFlopValueMultiplier,
  forecastUsage,
  globalRevenueOpportunityMillionsPerCycle,
  globalServingDemandTeraflops,
  servingAuraForUsage,
} from "../market.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
}

function openingState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.thomas-hassabi"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function mutate(
  state: GameState,
  update: (draft: DeepMutable<GameState>) => void,
): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  update(draft);
  return draft;
}

function advance(state: GameState, ticks: number): GameState {
  let current = state;
  for (let index = 0; index < ticks; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

describe("segment appeal and usage forecast", () => {
  it("starts with no demand until a model is trained and deployed", () => {
    const state = openingState();
    const usage = forecastUsage(state, content, state.run.playerLabId);
    expect(usage).toMatchObject({
      requestedTeraflops: 0,
      deliveredTeraflops: 0,
      unmetTeraflops: 0,
      revenueMillionsThisWeek: 0,
    });
    expect(usage.segments.every((segment) => segment.requestedTeraflops === 0)).toBe(
      true,
    );
  });

  it("uses the authored appeal formula and reports serving in effective TFLOP/s", () => {
    const state = newState();
    const appeal = calculateSegmentAppeal(
      state,
      content,
      state.run.playerLabId,
      "base:segment.researchers",
    );
    expect(appeal).toMatchObject({
      productQuality: 12,
      reliability: 35,
      final: 12.785,
    });
    expect(appeal.relevantCapability).toBeCloseTo(7.9, 9);

    const appealWeights =
      content.market.segments["base:segment.researchers"]?.appealWeights;
    expect(appealWeights).toEqual({
      capability: 0.65,
      productQuality: 0.2,
      reliability: 0.15,
      governmentTrust: 0,
    });

    const usage = forecastUsage(state, content, state.run.playerLabId);
    expect(usage.servingCapacityTeraflops).toBe(3_600);
    expect(usage.requestedTeraflops).toBeGreaterThan(0);
    expect(usage.deliveredTeraflops).toBe(
      Math.min(usage.servingCapacityTeraflops, usage.requestedTeraflops),
    );
    expect(usage.revenueMillionsThisWeek).toBeGreaterThan(0.26);
    expect(usage.segments).toHaveLength(3);
    expect(usage.segments.every((segment) => segment.softmaxShare > 0)).toBe(true);
    const government = usage.segments.find(
      (segment) => segment.segmentId === "base:segment.government",
    );
    expect(government?.unlocked).toBe(true);
    expect(government?.requestedTeraflops).toBeGreaterThan(0);
  });

  it("makes Government Trust the largest source of government appeal", () => {
    const state = newState();
    const government = content.market.segments["base:segment.government"];
    expect(government?.appealWeights).toEqual({
      capability: 0.35,
      productQuality: 0.05,
      reliability: 0.1,
      governmentTrust: 0.5,
    });

    const lowTrust = mutate(state, (draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.politics.governmentTrust = rating(0);
    });
    const highTrust = mutate(state, (draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.politics.governmentTrust = rating(100);
    });
    const appealAt = (candidate: GameState): number =>
      calculateSegmentAppeal(
        candidate,
        content,
        candidate.run.playerLabId,
        "base:segment.government",
      ).final;

    expect(appealAt(highTrust) - appealAt(lowTrust)).toBe(50);
  });

  it("uses the agreed capability curves for worldwide demand and revenue", () => {
    expect(globalServingDemandTeraflops(content, 0)).toBe(80_000);
    expect(globalServingDemandTeraflops(content, 88)).toBeCloseTo(800_000_000, 3);
    const calibration = [
      { capability: 0, valueMultiplier: 1, revenueMillions: 25 },
      { capability: 20, valueMultiplier: 1.2, revenueMillions: 243.339249 },
      { capability: 40, valueMultiplier: 1.8, revenueMillions: 2_960.699511 },
      { capability: 60, valueMultiplier: 2.8, revenueMillions: 37_356.894618 },
      { capability: 80, valueMultiplier: 4.2, revenueMillions: 454_519.934514 },
      { capability: 100, valueMultiplier: 6, revenueMillions: 5_266_787.601323 },
    ] as const;
    for (const row of calibration) {
      expect(deliveredFlopValueMultiplier(content, row.capability)).toBeCloseTo(
        row.valueMultiplier,
        10,
      );
      expect(
        globalRevenueOpportunityMillionsPerCycle(content, row.capability),
      ).toBeCloseTo(row.revenueMillions, 6);
    }
  });

  it("never earns revenue for requested usage the fleet cannot deliver", () => {
    const state = mutate(newState(), (draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.compute.allocation.servingFleetShareBasisPoints = basisPoints(0);
      // The ceiling is intent; the grant is what the week actually runs on, and
      // a direct state edit has to set both because no tick settles it here.
      lab.compute.servingPhysicalGpus = gpuCount(0);
    });
    const usage = forecastUsage(state, content, state.run.playerLabId);
    const finance = forecastFinance(state, content, state.run.playerLabId);

    expect(usage.requestedTeraflops).toBeGreaterThan(0);
    expect(usage.deliveredTeraflops).toBe(0);
    expect(usage.unmetTeraflops).toBe(usage.requestedTeraflops);
    expect(usage.revenueMillionsThisWeek).toBe(0);
    expect(finance.incomeMillionsPerCycle).toBe(0);
    expect(finance.netMillionsPerCycle).toBeLessThan(0);
  });

  it("leaves the surplus to research when demand is below the ceiling", () => {
    // The ceiling is a maximum, not a promise. Asking for more of the fleet
    // than customers can absorb is legal and simply hands the difference to
    // research, so nothing needs reclaiming afterwards.
    const state = mutate(newState(), (draft) => {
      draft.modifiers["small-demand" as unknown as ModifierId] = {
        id: "small-demand" as unknown as ModifierId,
        labId: draft.run.playerLabId,
        target: "lab.market.demandCeiling",
        operation: "multiply",
        value: 0.01,
        source: { kind: "system" },
        startsAt: tick(0),
        tags: [],
      };
    });
    const labId = state.run.playerLabId;
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error("player lab missing");
    const cap = calculateServingDemandCap(state, content, labId);
    expect(cap.maximumPhysicalGpus).toBeGreaterThan(0);
    expect(cap.maximumPhysicalGpus).toBeLessThan(cap.fleetPhysicalGpus);

    const overAmbitious = validateCommand(state, content, {
      kind: "set-gpu-allocation",
      meta: {
        commandId: "command:over-demand" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId,
      allocation: {
        ...lab.compute.allocation,
        servingFleetShareBasisPoints: basisPoints(10_000),
      },
    });
    expect(overAmbitious.ok).toBe(true);

    const tx = createTransaction(state);
    accrueWeeklyUsage(tx, content, labId);
    const settled = tx.commit({ description: "settle serving" }).state;
    const settledLab = settled.labs[labId];

    // Serving stops at demand; the ceiling the player chose is untouched.
    expect(settledLab?.compute.servingPhysicalGpus).toBe(cap.maximumPhysicalGpus);
    expect(settledLab?.compute.allocation.servingFleetShareBasisPoints).toBe(
      lab.compute.allocation.servingFleetShareBasisPoints,
    );
    expect(forecastUsage(settled, content, labId).unmetTeraflops).toBeCloseTo(0, 6);
  });

  it("takes reservations out of research first and refills serving first", () => {
    // The waterfall: reservations, then serving up to demand, then research on
    // whatever survives. A project may only reach serving once research has
    // nothing left to give, and serving is made whole again before research.
    const state = mutate(newState(), (draft) => {
      draft.modifiers["small-demand" as unknown as ModifierId] = {
        id: "small-demand" as unknown as ModifierId,
        labId: draft.run.playerLabId,
        target: "lab.market.demandCeiling",
        operation: "multiply",
        value: 0.01,
        source: { kind: "system" },
        startsAt: tick(0),
        tags: [],
      };
    });
    const labId = state.run.playerLabId;
    const fleet =
      state.labs[labId]?.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0) ??
      0;
    const demandGpus = calculateServingDemandCap(
      state,
      content,
      labId,
    ).maximumPhysicalGpus;

    const withReservation = (input: GameState, gpus: number): GameState =>
      mutate(input, (draft) => {
        const lab = draft.labs[draft.run.playerLabId];
        if (lab === undefined) throw new Error("player lab missing");
        lab.compute.reservations =
          gpus === 0
            ? []
            : [{ projectId: "project:reserved" as ProjectId, gpus: gpuCount(gpus) }];
      });
    const settle = (input: GameState): GameState => {
      const tx = createTransaction(input);
      accrueWeeklyUsage(tx, content, labId);
      return tx.commit({ description: "settle serving" }).state;
    };
    const servingOf = (input: GameState): number =>
      input.labs[labId]?.compute.servingPhysicalGpus ?? -1;
    const researchOf = (input: GameState): number =>
      planGpuPortfolio(input, content, labId).allocation.researchPhysicalGpus;

    // Idle: serving covers demand, research takes the rest of the fleet.
    const idle = settle(state);
    expect(servingOf(idle)).toBe(demandGpus);
    expect(researchOf(idle)).toBe(fleet - demandGpus);

    // A reservation research can absorb leaves serving untouched.
    const modest = settle(withReservation(idle, fleet - demandGpus));
    expect(servingOf(modest)).toBe(demandGpus);
    expect(researchOf(modest)).toBe(0);

    // Beyond that, research is already empty and serving is squeezed.
    const heavy = settle(withReservation(modest, fleet - 1));
    expect(servingOf(heavy)).toBe(1);
    expect(researchOf(heavy)).toBe(0);

    // Releasing refills serving before research -- and crucially recovers, which
    // the old one-directional demand cap could not do.
    const released = settle(withReservation(heavy, 0));
    expect(servingOf(released)).toBe(demandGpus);
    expect(researchOf(released)).toBe(fleet - demandGpus);
  });
});

describe("market accrual and settlement", () => {
  it("accrues four served weeks and settles capability-scaled product revenue", () => {
    const state = newState();
    const openingForecast = forecastUsage(state, content, state.run.playerLabId);
    const settled = advance(state, 4);
    const lab = settled.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    const productRevenue = lab.finance.ledger.find(
      (entry) => entry.category === "product-revenue",
    );

    expect(productRevenue?.amountMillions).toBeGreaterThan(1.04);
    expect(lab.market.weeksAccruedThisCycle).toBe(0);
    const consumers = lab.market.segments["base:segment.researchers"];
    expect(consumers?.lastCycleRequestedUsage).toBeGreaterThan(0);
    expect(consumers?.lastCycleDeliveredUsage).toBeGreaterThanOrEqual(0);
    expect(consumers?.lastCycleRevenueMillions).toBeGreaterThanOrEqual(0);
    expect(consumers).toMatchObject({
      accruedRequestedUsage: 0,
      accruedDeliveredUsage: 0,
      accruedRevenueMillions: 0,
    });
    expect(consumers?.desiredUsagePerCycle).toBeCloseTo(
      openingForecast.segments.find(
        (segment) => segment.segmentId === "base:segment.researchers",
      )?.requestedTeraflops ?? 0,
      3,
    );
  });

  it("turns a total serving shortage into zero revenue and lower satisfaction", () => {
    const state = mutate(newState(), (draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.finance.cash = cashMillions(100);
      lab.compute.allocation.servingFleetShareBasisPoints = basisPoints(0);
    });
    const settled = advance(state, 4);
    const lab = settled.labs[state.run.playerLabId];
    const researchers = lab?.market.segments["base:segment.researchers"];
    expect(researchers?.lastCycleRequestedUsage).toBeGreaterThan(0);
    expect(researchers?.lastCycleDeliveredUsage).toBe(0);
    expect(researchers?.lastCycleRevenueMillions).toBe(0);
    expect(researchers?.satisfaction).toBeLessThan(60);
    expect(
      lab?.finance.ledger.find((entry) => entry.category === "product-revenue")
        ?.amountMillions,
    ).toBe(0);
  });

  it.each([
    [0, 0, 0],
    [100, 49.999, 0],
    [100, 50, 1],
    [100, 89.999, 1],
    [100, 90, 2],
    [100, 100, 2],
  ])(
    "awards %s requested and %s delivered as %s Aura",
    (requested, delivered, expected) => {
      expect(servingAuraForUsage(requested, delivered)).toBe(expected);
    },
  );

  it("awards one aggregate serving Aura payment at market settlement", () => {
    const state = mutate(newState(), (draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.finance.cash = cashMillions(100);
      lab.compute.allocation.servingFleetShareBasisPoints = basisPoints(10_000);
      for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(100_000);
      lab.compute.servingPhysicalGpus = gpuCount(
        lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0),
      );
      for (const segment of Object.values(lab.market.segments)) {
        segment.satisfaction = rating(0);
      }
    });
    const usage = forecastUsage(state, content, state.run.playerLabId);
    const expected = servingAuraForUsage(
      usage.requestedTeraflops,
      usage.deliveredTeraflops,
    );
    expect(expected).toBe(2);
    const before = state.labs[state.run.playerLabId]?.aura.spendable;
    const lifetimeBefore = state.labs[state.run.playerLabId]?.aura.lifetime;
    const settled = advance(state, 4);
    const lab = settled.labs[state.run.playerLabId];
    expect(lab?.aura.spendable).toBe((before ?? 0) + expected);
    expect(lab?.aura.lifetime).toBe((lifetimeBefore ?? 0) + expected);
    const entries = lab?.aura.ledger.filter(
      (entry) => entry.category === "customer-serving",
    );
    expect(entries).toHaveLength(expected > 0 ? 1 : 0);
    if (expected > 0) expect(entries?.[0]?.appliedDelta).toBe(expected);
  });

  it("does not award serving Aura when customer demand is zero", () => {
    const state = openingState();
    const before = state.labs[state.run.playerLabId]?.aura.spendable;
    const settled = advance(state, 4);
    const lab = settled.labs[state.run.playerLabId];
    expect(lab?.aura.spendable).toBe(before);
    expect(lab?.aura.ledger.some((entry) => entry.category === "customer-serving")).toBe(
      false,
    );
  });

  it("reduces requested serving compute under inference-efficiency modifiers", () => {
    const base = newState();
    const efficient = mutate(base, (draft) => {
      draft.modifiers["serving-test" as unknown as ModifierId] = {
        id: "serving-test" as unknown as ModifierId,
        target: "serving.computePerRequest",
        operation: "multiply",
        value: 0.5,
        source: { kind: "system" },
        startsAt: tick(0),
        tags: [],
      };
    });
    const plain = forecastUsage(base, content, base.run.playerLabId);
    const boosted = forecastUsage(efficient, content, efficient.run.playerLabId);
    expect(boosted.servingCapacityTeraflops).toBe(plain.servingCapacityTeraflops);
    expect(boosted.requestedTeraflops).toBeCloseTo(plain.requestedTeraflops * 0.5, 5);
  });

  it("raises every unlocked segment's demand and revenue under a commercial-ceiling modifier", () => {
    const base = newState();
    const boosted = mutate(base, (draft) => {
      draft.modifiers["ceiling-test" as unknown as ModifierId] = {
        id: "ceiling-test" as unknown as ModifierId,
        labId: draft.run.playerLabId,
        target: "lab.market.demandCeiling",
        operation: "multiply",
        value: 1.5,
        source: { kind: "leader" },
        startsAt: tick(0),
        tags: [],
      };
    });
    const before = forecastUsage(base, content, base.run.playerLabId).segments;
    const after = forecastUsage(boosted, content, boosted.run.playerLabId).segments;
    for (const segment of before) {
      const boostedSegment = after.find(
        (candidate) => candidate.segmentId === segment.segmentId,
      );
      if (boostedSegment === undefined) throw new Error("segment missing");
      if (!segment.unlocked) {
        expect(boostedSegment.requestedTeraflops).toBe(0);
        continue;
      }
      expect(boostedSegment.requestedTeraflops).toBeCloseTo(
        segment.requestedTeraflops * 1.5,
        5,
      );
      expect(boostedSegment.potentialRevenueMillionsPerCycle).toBeCloseTo(
        segment.potentialRevenueMillionsPerCycle * 1.5,
        5,
      );
    }
  });

  it("applies market-reach effects immediately without a demand ramp or decay", () => {
    const base = newState();
    const restricted = mutate(base, (draft) => {
      draft.modifiers["reach-test" as unknown as ModifierId] = {
        id: "reach-test" as unknown as ModifierId,
        labId: draft.run.playerLabId,
        target: "lab.market.acquisitionRate",
        operation: "multiply",
        value: 0.5,
        source: { kind: "system" },
        startsAt: tick(0),
        tags: [],
      };
    });
    const before = forecastUsage(base, content, base.run.playerLabId);
    const after = forecastUsage(restricted, content, restricted.run.playerLabId);

    expect(after.requestedTeraflops).toBeCloseTo(before.requestedTeraflops * 0.5, 5);
    expect(
      after.segments.reduce(
        (sum, segment) => sum + segment.potentialRevenueMillionsPerCycle,
        0,
      ),
    ).toBeCloseTo(
      before.segments.reduce(
        (sum, segment) => sum + segment.potentialRevenueMillionsPerCycle,
        0,
      ) * 0.5,
      5,
    );
  });
});

describe("public price policy", () => {
  it("rejects unknown and unchanged price tiers at the command boundary", () => {
    const state = newState();
    const base = {
      kind: "set-public-price" as const,
      meta: {
        commandId: "command:bad-price" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player" as const,
      },
      labId: state.run.playerLabId,
    };
    const unknown = validateCommand(state, content, {
      ...base,
      priceTier: "whatever-the-board-will-tolerate" as never,
    });
    const unchanged = validateCommand(state, content, {
      ...base,
      priceTier: "market",
    });
    expect(unknown).toMatchObject({
      ok: false,
      errors: [{ code: "unknown-price-tier" }],
    });
    expect(unchanged).toMatchObject({
      ok: false,
      errors: [{ code: "price-unchanged" }],
    });
  });

  it("queues a validated tier and applies it only at the next cycle boundary", () => {
    const state = newState();
    const applied = applyCommand(state, content, {
      kind: "set-public-price",
      meta: {
        commandId: "command:price-premium" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      priceTier: "premium",
    });
    expect(applied.state.labs[state.run.playerLabId]?.market).toMatchObject({
      priceTier: "market",
      pendingPriceTier: "premium",
    });
    expect(advance(applied.state, 3).labs[state.run.playerLabId]?.market.priceTier).toBe(
      "market",
    );
    const changed = advance(applied.state, 4);
    expect(changed.labs[state.run.playerLabId]?.market).toMatchObject({
      priceTier: "premium",
      priceChangeTicks: [4],
    });
  });
});
