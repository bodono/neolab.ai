import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { ModifierId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import {
  modifierEffectPreview,
  modifierTargetDisplayLabel,
} from "../../presentation/modifier-copy.ts";
import { STANDING_INCOME_TARGET, auraStandingIncome } from "../aura.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): DeepMutable<GameState> {
  return structuredClone(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
}

/** Stand in for a completed facility that pays standing. */
function addStandingIncome(state: DeepMutable<GameState>, value: number): void {
  const id = `modifier:standing-${String(value)}` as ModifierId;
  state.modifiers[id] = {
    id,
    source: { kind: "facility", id: `facility-fixture-${String(value)}` },
    target: STANDING_INCOME_TARGET,
    operation: "add",
    value,
    startsAt: tick(0),
    labId: state.run.playerLabId,
    tags: [],
  };
}

function advance(state: GameState, weeks: number): GameState {
  let current = state;
  for (let week = 0; week < weeks; week += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

describe("Aura standing income", () => {
  it("pays nothing to a lab that has built nothing", () => {
    const state = newState();
    expect(auraStandingIncome(state, state.run.playerLabId).perCycle).toBe(0);
  });

  it("stacks the buildings that pay it, as authored flat amounts", () => {
    const state = newState();
    addStandingIncome(state, 1);
    addStandingIncome(state, 2);
    // add against base 0, so these read exactly as written -- 3, not a
    // multiplier in disguise.
    expect(auraStandingIncome(state, state.run.playerLabId).perCycle).toBe(3);
  });

  it("actually credits spendable Aura at the cycle boundary", () => {
    // The check that matters: not that the target is registered, but that a
    // lab holding it has MORE Aura four weeks later than one that does not.
    const bare = newState();
    const earning = newState();
    addStandingIncome(earning, 2);

    const bareAfter = advance(bare, 4).labs[bare.run.playerLabId]?.aura;
    const earningAfter = advance(earning, 4).labs[earning.run.playerLabId]?.aura;
    if (bareAfter === undefined || earningAfter === undefined) {
      throw new Error("player lab missing");
    }
    expect(earningAfter.spendable - bareAfter.spendable).toBe(2);
    expect(earningAfter.lifetime - bareAfter.lifetime).toBe(2);
  });

  it("pays once per cycle, not once per week", () => {
    const state = newState();
    addStandingIncome(state, 2);
    const bare = newState();
    // Three cycles: twelve weeks, three payments, six Aura.
    const earned =
      (advance(state, 12).labs[state.run.playerLabId]?.aura.spendable ?? 0) -
      (advance(bare, 12).labs[bare.run.playerLabId]?.aura.spendable ?? 0);
    expect(earned).toBe(6);
  });

  it("files the gain under a category a player can read back", () => {
    const state = newState();
    addStandingIncome(state, 1);
    const ledger = advance(state, 4).labs[state.run.playerLabId]?.aura.ledger ?? [];
    const entry = ledger.find((row) => row.category === "institution");
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("gain");
    expect(entry?.appliedDelta).toBe(1);
  });

  it("does not leak one lab's buildings into another lab's standing", () => {
    const state = newState();
    addStandingIncome(state, 5);
    const rivalId = Object.keys(state.labs).find((id) => id !== state.run.playerLabId);
    if (rivalId === undefined) throw new Error("no rival lab");
    expect(
      auraStandingIncome(state, rivalId as typeof state.run.playerLabId).perCycle,
    ).toBe(0);
  });

  it("ships a ladder that runs from the opening week to the endgame", () => {
    const paying = Object.values(content.facilities)
      .filter((facility) =>
        facility.modifiers.some((modifier) => modifier.target === STANDING_INCOME_TARGET),
      )
      .map((facility) => ({
        name: facility.displayName,
        cost: facility.cashCostMillions,
        aura: facility.modifiers
          .filter((modifier) => modifier.target === STANDING_INCOME_TARGET)
          .reduce((sum, modifier) => sum + modifier.value, 0),
      }))
      .sort((left, right) => left.cost - right.cost);

    expect(paying).toEqual([
      { name: "Press Office", cost: 5, aura: 1 },
      { name: "Visitor Centre", cost: 35, aura: 1 },
      { name: "The Singularity Pavilion", cost: 2750, aura: 1 },
    ]);
    // Institutions stay useful without making late-game Aura self-funding.
    expect(paying.reduce((sum, row) => sum + row.aura, 0)).toBe(3);
  });

  it("says how often it pays, on every surface that shows it", () => {
    // "+1" on its own reads as a one-off grant. The label has to carry the
    // cadence or the building looks like a worse version of a starting bonus.
    expect(modifierTargetDisplayLabel(STANDING_INCOME_TARGET)).toBe(
      "Aura per cycle (4 weeks)",
    );
    // And it must not fall through to the humanised path dump.
    expect(modifierTargetDisplayLabel(STANDING_INCOME_TARGET)).not.toContain("Standing");
    expect(modifierEffectPreview(STANDING_INCOME_TARGET, "add", 1)).toBe(
      "Aura per cycle (4 weeks) +1",
    );
  });

  it("ships buildings that carry it, reachable from an empty campus", () => {
    // The cold start is the whole reason this exists: there has to be at least
    // one source with no facility prerequisites at all.
    const paying = Object.values(content.facilities).filter((facility) =>
      facility.modifiers.some((modifier) => modifier.target === STANDING_INCOME_TARGET),
    );
    expect(paying.length).toBeGreaterThan(0);
    expect(paying.some((facility) => facility.prerequisiteFacilityIds.length === 0)).toBe(
      true,
    );
  });
});

describe("the recurring Aura readout", () => {
  it("reports nothing recurring for a lab with no buildings and no customers", () => {
    const state = newState();
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(view.topBar.aura.incomePerCycle).toBe(0);
    expect(view.topBar.aura.incomeLabel).toBe("No recurring Aura income");
    expect(view.topBar.aura.incomeSources).toEqual([]);
  });

  it("names each building and totals what they pay", () => {
    const state = newState();
    addStandingIncome(state, 1);
    addStandingIncome(state, 2);
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(view.topBar.aura.incomePerCycle).toBe(3);
    expect(view.topBar.aura.incomeLabel).toBe("+3 per cycle (4 weeks)");
    expect(
      view.topBar.aura.incomeSources.map((row) => row.amountPerCycle).sort(),
    ).toEqual([1, 2]);
    for (const row of view.topBar.aura.incomeSources) expect(row.label).not.toBe("");
  });

  it("matches what the next cycle actually pays", () => {
    // The readout is a promise. Four weeks later the lab must hold exactly what
    // the overview said it would earn.
    const state = newState();
    addStandingIncome(state, 3);
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const before = state.labs[state.run.playerLabId]?.aura.spendable ?? 0;
    const after = advance(state, 4).labs[state.run.playerLabId]?.aura.spendable ?? 0;
    expect(after - before).toBe(view.topBar.aura.incomePerCycle);
  });

  it("does not repeat recurring settlements as recent one-off changes", () => {
    const state = newState();
    addStandingIncome(state, 1);
    const settled = advance(state, 4);
    const view = projectGameView(settled, content, {
      viewerLabId: settled.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(view.topBar.aura.incomePerCycle).toBe(1);
    expect(view.topBar.aura.recentChanges).toEqual([]);
  });
});
