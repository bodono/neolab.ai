import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { DomainEvent } from "../../engine/domain-events.ts";
import { collectInvariantViolations } from "../../engine/invariants.ts";
import type { CommandId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import {
  calculateCycleFinanceLines,
  calculateRunway,
  FINANCE_HISTORY_RETENTION_WEEKS,
  forecastFinance,
} from "../finance.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
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

function withCash(state: GameState, cash: number): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("test lab missing");
  lab.finance.cash = cashMillions(cash);
  return draft;
}

function withNegativeCashWeeks(state: GameState, weeks: number): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("test lab missing");
  lab.finance.consecutiveNegativeCashWeeks = weeks;
  return draft;
}

function advance(
  state: GameState,
  count: number,
): { readonly state: GameState; readonly events: readonly DomainEvent[] } {
  let current = state;
  const events: DomainEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = advanceOneTick(current, content);
    current = result.state;
    events.push(...result.domainEvents);
  }
  return { state: current, events };
}

describe("finance forecast and runway", () => {
  it("matches the pre-model opening burn and bootstrap runway", () => {
    const state = newState();
    const forecast = forecastFinance(state, content, state.run.playerLabId);

    expect(forecast.incomeMillionsPerCycle).toBe(0);
    expect(forecast.outgoingsMillionsPerCycle).toBeCloseTo(3.335, 9);
    expect(forecast.netMillionsPerCycle).toBeCloseTo(-3.335, 9);
    expect(forecast.runway).toMatchObject({
      isInfinite: false,
      band: "healthy",
    });
    expect(forecast.runway.weeks).toBeCloseTo((45 / 3.335) * 4, 9);
    expect(
      forecast.linesPerCycle.reduce((sum, line) => sum + line.amountMillions, 0),
    ).toBeCloseTo(forecast.netMillionsPerCycle, 9);
  });

  it("returns an explained infinity for non-negative cashflow", () => {
    expect(calculateRunway(cashMillions(10), cashMillions(0))).toEqual({
      isInfinite: true,
      weeks: null,
      band: "healthy",
      explanation: "Projected cashflow is non-negative at the current plan.",
    });
    expect(calculateRunway(cashMillions(1), cashMillions(-0.01)).weeks).toBe(40);
  });
});

describe("cycle settlement", () => {
  it("writes signed ledger entries that exactly reconcile opening and closing cash", () => {
    const state = newState();
    const result = advance(state, 4);
    const finance = result.state.labs[state.run.playerLabId]?.finance;
    const settlement = finance?.settlements[0];
    if (finance === undefined || settlement === undefined) {
      throw new Error("settlement missing");
    }
    const entries = finance.ledger.filter(
      (entry) => entry.settlementId === settlement.id,
    );
    const entryTotal = entries.reduce((sum, entry) => sum + entry.amountMillions, 0);

    expect(settlement.openingCashMillions).toBe(45);
    expect(entryTotal).toBeCloseTo(-3.335, 9);
    expect(settlement.closingCashMillions).toBeCloseTo(41.665, 9);
    expect(finance.cash).toBe(settlement.closingCashMillions);
    expect(settlement.openingCashMillions + entryTotal).toBeCloseTo(
      settlement.closingCashMillions,
      9,
    );
    expect(result.events).toContainEqual({
      kind: "cycle-settled",
      tick: 3,
      labId: state.run.playerLabId,
      netMillions: -3.335,
      closingCashMillions: 41.665,
    });
  });

  it("emits critical runway warnings and auto-pauses before insolvency", () => {
    const state = withCash(newState(), 4);
    const result = advance(state, 4);
    expect(result.state.run.status).toBe("active");
    expect(result.state.run.autoPauseReasons).toContain("bankruptcy-warning");
    expect(result.events).toContainEqual(
      expect.objectContaining({
        kind: "finance-runway-warning",
        band: "critical",
      }),
    );
  });

  it("pauses with negative cash during the one-year insolvency grace period", () => {
    const state = withCash(newState(), 1);
    const result = advance(state, 4);
    expect(result.state.run.status).toBe("active");
    expect(result.state.run.autoPauseReasons).toContain("bankruptcy-warning");
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: "finance-insolvency-grace" }),
    );
  });

  it("keeps the insolvency clock running without repeated pauses during an active fundraiser", () => {
    const prepared = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = prepared.labs[prepared.run.playerLabId];
    if (lab === undefined) throw new Error("test lab missing");
    lab.aura.spendable = 100;
    lab.aura.lifetime = 100;
    const started = applyCommand(prepared, content, {
      kind: "start-fundraising-campaign",
      meta: {
        commandId: "command:active-insolvency-roadshow" as CommandId,
        expectedTick: prepared.run.tick,
        issuedBy: "player",
      },
      labId: prepared.run.playerLabId,
      campaign: "mega-round-roadshow",
    }).state;

    const duringRoadshow = advance(withCash(started, -1), 4);
    expect(
      Object.values(duringRoadshow.state.projects).some(
        (project) => project.kind === "fundraising" && project.status === "active",
      ),
    ).toBe(true);
    expect(
      duringRoadshow.state.labs[started.run.playerLabId]?.finance
        .consecutiveNegativeCashWeeks,
    ).toBe(4);
    expect(duringRoadshow.state.run.autoPauseReasons).not.toContain("bankruptcy-warning");

    const afterRoadshow = advance(duringRoadshow.state, 8);
    expect(
      Object.values(afterRoadshow.state.projects).some(
        (project) => project.kind === "fundraising" && project.status === "active",
      ),
    ).toBe(false);
    expect(afterRoadshow.state.run.autoPauseReasons).toContain("bankruptcy-warning");
  });

  it("warns at six and nine months of consecutive negative cash", () => {
    const sixMonthState = withNegativeCashWeeks(withCash(newState(), -1), 25);
    const sixMonthResult = advanceOneTick(sixMonthState, content);
    expect(
      sixMonthResult.state.labs[sixMonthState.run.playerLabId]?.finance
        .consecutiveNegativeCashWeeks,
    ).toBe(26);
    expect(sixMonthResult.state.run.status).toBe("active");
    expect(sixMonthResult.state.run.autoPauseReasons).toContain("bankruptcy-warning");
    expect(sixMonthResult.domainEvents).toContainEqual({
      kind: "finance-negative-balance-warning",
      labId: sixMonthState.run.playerLabId,
      cashMillions: -1,
      consecutiveWeeks: 26,
      bankruptcyAtWeeks: 52,
    });

    const nineMonthState = withNegativeCashWeeks(withCash(sixMonthResult.state, -1), 38);
    const nineMonthResult = advanceOneTick(nineMonthState, content);
    expect(
      nineMonthResult.state.labs[nineMonthState.run.playerLabId]?.finance
        .consecutiveNegativeCashWeeks,
    ).toBe(39);
    expect(nineMonthResult.domainEvents).toContainEqual({
      kind: "finance-negative-balance-warning",
      labId: nineMonthState.run.playerLabId,
      cashMillions: -1,
      consecutiveWeeks: 39,
      bankruptcyAtWeeks: 52,
    });
  });

  it("resets the negative-cash streak only after cash is restored", () => {
    const negative = withNegativeCashWeeks(withCash(newState(), -1), 39);
    const stillNegative = advanceOneTick(negative, content).state;
    expect(
      stillNegative.labs[stillNegative.run.playerLabId]?.finance
        .consecutiveNegativeCashWeeks,
    ).toBe(40);

    const restored = advanceOneTick(withCash(stillNegative, 0), content).state;
    expect(
      restored.labs[restored.run.playerLabId]?.finance.consecutiveNegativeCashWeeks,
    ).toBe(0);
  });

  it("declares bankruptcy at 52 consecutive negative weeks", () => {
    const state = withNegativeCashWeeks(withCash(newState(), -1), 51);

    const result = advanceOneTick(state, content);
    expect(result.state.run.status).toBe("lost");
    expect(result.state.run.endingId).toBe(
      "base:ending.the-worlds-most-expensive-insolvency",
    );
    expect(
      result.state.labs[state.run.playerLabId]?.finance.consecutiveNegativeCashWeeks,
    ).toBe(52);
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "finance-insolvent" }),
    );
  });

  it("honours the full grace period even when no fundraising rescue remains", () => {
    const state = withCash(newState(), 1);
    const noRescue = structuredClone(state) as DeepMutable<GameState>;
    const lab = noRescue.labs[noRescue.run.playerLabId];
    if (lab === undefined) throw new Error("test lab missing");
    lab.aura.spendable = 0;
    const result = advance(noRescue, 4);
    expect(result.state.run.status).toBe("active");
    expect(result.state.run.endingId).toBeUndefined();
    expect(
      result.state.labs[noRescue.run.playerLabId]?.finance.consecutiveNegativeCashWeeks,
    ).toBe(1);
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: "finance-insolvency-grace" }),
    );
  });

  it("does not let an undersized fundraiser shorten the one-year grace period", () => {
    const state = newState();
    const started = applyCommand(state, content, {
      kind: "start-fundraising-campaign",
      meta: {
        commandId: "command:doomed-quiet-bridge" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      campaign: "quiet-bridge",
    }).state;
    const doomed = withCash(started, -50);

    const result = advanceOneTick(doomed, content);
    expect(result.state.run.status).toBe("active");
    expect(result.state.run.endingId).toBeUndefined();
    expect(
      result.state.labs[doomed.run.playerLabId]?.finance.consecutiveNegativeCashWeeks,
    ).toBe(1);
  });

  it("ends an unrescuable deficit only when its 52-week clock expires", () => {
    const state = withNegativeCashWeeks(withCash(newState(), -50), 51);
    const noRescue = structuredClone(state) as DeepMutable<GameState>;
    const lab = noRescue.labs[noRescue.run.playerLabId];
    if (lab === undefined) throw new Error("test lab missing");
    lab.aura.spendable = 0;

    const result = advanceOneTick(noRescue, content);
    expect(result.state.run.status).toBe("lost");
    expect(result.state.run.endingId).toBe(
      "base:ending.the-worlds-most-expensive-insolvency",
    );
  });

  it("prices staff payroll at the live market as the world nears AGI", () => {
    // Doubling every 30 frontier points: a world at frontier 30 pays exactly
    // twice for engineers and general researchers, with no contract lag.
    const state = newState();
    const boomState = structuredClone(state) as DeepMutable<GameState>;
    const withModel = addBaselineModelForTest(boomState, content);
    const model = Object.values(withModel.models)[0];
    if (model?.measuredCapability === undefined) throw new Error("model missing");
    (model.measuredCapability as { frontierCapability: number }).frontierCapability = 30;

    const staffLine = (target: GameState): number => {
      const line = calculateCycleFinanceLines(
        target,
        content,
        target.run.playerLabId,
      ).find((candidate) => candidate.sourceId === "staff.engineering-and-ops");
      if (line === undefined) throw new Error("engineering payroll line missing");
      return line.amountMillions;
    };
    expect(staffLine(state)).toBeLessThan(0);
    expect(staffLine(withModel)).toBeCloseTo(staffLine(state) * 2, 9);

    // Everyone is priced by the frontier, the executive suite included.
    const executiveLine = (target: GameState): number => {
      const line = calculateCycleFinanceLines(
        target,
        content,
        target.run.playerLabId,
      ).find((candidate) => candidate.sourceId === "leadership.executive");
      if (line === undefined) throw new Error("executive line missing");
      return line.amountMillions;
    };
    expect(executiveLine(state)).toBeLessThan(0);
    expect(executiveLine(withModel)).toBeCloseTo(executiveLine(state) * 2, 9);
  });

  it("reconciles every cycle over a three-year deterministic run", () => {
    const state = withCash(newState(), 1000);
    const result = advance(state, 156);
    const finance = result.state.labs[state.run.playerLabId]?.finance;
    if (finance === undefined) throw new Error("finance missing");
    expect(finance.settlements).toHaveLength(
      Math.floor(FINANCE_HISTORY_RETENTION_WEEKS / 4) + 1,
    );
    expect(finance.settlements[0]?.settledAt).toBe(
      result.state.run.tick - FINANCE_HISTORY_RETENTION_WEEKS,
    );
    for (const settlement of finance.settlements) {
      const entryTotal = finance.ledger
        .filter((entry) => entry.settlementId === settlement.id)
        .reduce((sum, entry) => sum + entry.amountMillions, 0);
      expect(settlement.openingCashMillions + entryTotal).toBeCloseTo(
        settlement.closingCashMillions,
        9,
      );
    }
    expect(result.state.run.status).toBe("active");
  }, 15_000); // This is intentionally 156 complete five-lab world ticks, not a unit test.

  it("permits only sub-cent floating-point drift in long-run reconciliation", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("finance drift fixture missing");
    const settlementId = "finance:test:long-run-drift";
    lab.finance.ledger.push({
      id: `${settlementId}:00`,
      settledAt: state.run.tick,
      settlementId,
      category: "adjustment",
      sourceId: "test.floating-point-drift",
      amountMillions: cashMillions(49.51000599999679),
      description: "Long-run floating-point drift fixture",
    });
    lab.finance.settlements.push({
      id: settlementId,
      settledAt: state.run.tick,
      openingCashMillions: cashMillions(0),
      closingCashMillions: cashMillions(49.51000600121915),
    });

    expect(
      collectInvariantViolations(state).filter(
        (violation) => violation.code === "finance-reconciliation",
      ),
    ).toEqual([]);

    const driftEntry = lab.finance.ledger[lab.finance.ledger.length - 1];
    if (driftEntry === undefined) throw new Error("finance drift entry missing");
    lab.finance.ledger[lab.finance.ledger.length - 1] = {
      ...driftEntry,
      amountMillions: cashMillions(49.5100049),
    };
    expect(
      collectInvariantViolations(state).some(
        (violation) => violation.code === "finance-reconciliation",
      ),
    ).toBe(true);
  });
});
