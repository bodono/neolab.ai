import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { LabId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState, GpuAllocationState } from "../../model/state.ts";
import { basisPoints, rating } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import {
  advancePaperRace,
  derivePaperBreakthroughChance,
  derivePaperFocusProgrammeIds,
  listEligiblePapers,
} from "../papers.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const backprop = contentId("base:paper.backpropagation");
const architectures = contentId("base:domain.architectures");
const optimisation = contentId("base:domain.optimisation-scaling");
const interpretability = contentId("base:safety.interpretability-evals");
const discount = content.papers.rules.playerFocus.levelDiscount;
const backpropLevel = content.papers.definitions[backprop]?.breakthroughRequirement.level;

function newState(): DeepMutable<GameState> {
  return structuredClone(
    addBaselineModelsForTest(
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
    ),
  ) as DeepMutable<GameState>;
}

/**
 * An allocation giving `focus` `weight` basis points of its pool (capability
 * or safety) and splitting the rest of that pool across the other programmes.
 */
function allocation(
  capabilityBasisPoints: number,
  focus: string,
  weight: number,
): GpuAllocationState {
  const split = (ids: readonly string[]): Record<string, number> => {
    const focused = ids.includes(focus);
    const others = ids.filter((id) => id !== focus);
    const pool = focused ? 10_000 - weight : 10_000;
    const weights: Record<string, number> = {};
    let assigned = 0;
    others.forEach((id, index) => {
      const share =
        index === others.length - 1 ? pool - assigned : Math.floor(pool / others.length);
      weights[id] = share;
      assigned += share;
    });
    if (focused) weights[focus] = weight;
    return weights;
  };
  return {
    servingFleetShareBasisPoints: basisPoints(0),
    capabilityBasisPoints: basisPoints(capabilityBasisPoints),
    capabilityDomainWeights: Object.fromEntries(
      Object.entries(split(Object.keys(content.research.capabilityDomains))).map(
        ([id, value]) => [id, basisPoints(value)],
      ),
    ),
    safetyProgramWeights: Object.fromEntries(
      Object.entries(split(Object.keys(content.research.safetyPrograms))).map(
        ([id, value]) => [id, basisPoints(value)],
      ),
    ),
  };
}

function setLevels(
  state: DeepMutable<GameState>,
  labId: LabId,
  architectureLevel: number,
  optimisationLevel: number,
): void {
  const lab = state.labs[labId];
  const architectureState = lab?.research.domains[architectures];
  const optimisationState = lab?.research.domains[optimisation];
  if (architectureState === undefined || optimisationState === undefined) {
    throw new Error(`Missing programmes for ${labId}`);
  }
  architectureState.level = rating(architectureLevel);
  optimisationState.level = rating(optimisationLevel);
  const paperLevels = state.world.rivals[labId]?.paperLevels;
  if (paperLevels !== undefined) {
    paperLevels[architectures] = { level: rating(architectureLevel), levelProgressRp: 0 };
    paperLevels[optimisation] = { level: rating(optimisationLevel), levelProgressRp: 0 };
  }
}

function eligibleIds(state: Readonly<GameState>, labId: string): string[] {
  return listEligiblePapers(state, content, labId).map((paper) => paper.paperId);
}

describe("player paper focus", () => {
  it("reads its rule from content", () => {
    expect(content.papers.rules.playerFocus).toEqual({
      researchComputeShare: 0.3,
      levelDiscount: 4,
    });
  });

  it("counts a programme with at least the threshold share of all research compute", () => {
    const state = newState();
    const player = state.labs[state.run.playerLabId];
    if (player === undefined) throw new Error("player missing");

    // The opening allocation spreads research; nothing is a focus.
    expect(derivePaperFocusProgrammeIds(state, content, state.run.playerLabId).size).toBe(
      0,
    );

    // 60% capability x 50% = exactly 30%.
    player.compute.allocation = allocation(6_000, architectures, 5_000);
    expect([
      ...derivePaperFocusProgrammeIds(state, content, state.run.playerLabId),
    ]).toEqual([architectures]);

    // One basis point less is below the threshold.
    player.compute.allocation = allocation(6_000, architectures, 4_999);
    expect(derivePaperFocusProgrammeIds(state, content, state.run.playerLabId).size).toBe(
      0,
    );

    // Safety programmes count against the same total: 40% safety x 75% = 30%.
    player.compute.allocation = allocation(6_000, interpretability, 7_500);
    expect([
      ...derivePaperFocusProgrammeIds(state, content, state.run.playerLabId),
    ]).toEqual([interpretability]);
  });

  it("never gives a rival a focus", () => {
    const state = newState();
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rival = rivalId === undefined ? undefined : state.labs[rivalId];
    if (rivalId === undefined || rival === undefined) throw new Error("rival missing");
    rival.compute.allocation = allocation(10_000, architectures, 10_000);
    expect(derivePaperFocusProgrammeIds(state, content, rivalId).size).toBe(0);
  });

  it("lowers a focus paper's breakthrough level for the player only", () => {
    if (backpropLevel === undefined) throw new Error("backprop missing");
    const state = newState();
    const playerId = state.run.playerLabId;
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const player = state.labs[playerId];
    const rival = rivalId === undefined ? undefined : state.labs[rivalId];
    if (rivalId === undefined || player === undefined || rival === undefined) {
      throw new Error("fixture missing");
    }
    const discounted = backpropLevel - discount;
    setLevels(state, playerId, discounted, 3);
    setLevels(state, rivalId, discounted, 3);

    // Without a focus the player is below the authored level.
    expect(eligibleIds(state, playerId)).not.toContain(backprop);

    player.compute.allocation = allocation(6_000, architectures, 5_000);
    rival.compute.allocation = allocation(6_000, architectures, 5_000);
    expect(eligibleIds(state, playerId)).toContain(backprop);
    expect(derivePaperBreakthroughChance(state, content, playerId, backprop)).toBeCloseTo(
      content.papers.rules.breakthroughChance.basePerWeek,
      9,
    );
    // The same allocation earns a rival nothing.
    expect(eligibleIds(state, rivalId)).not.toContain(backprop);

    // One level short of the discounted requirement is still short.
    setLevels(state, playerId, discounted - 1, 3);
    expect(eligibleIds(state, playerId)).not.toContain(backprop);

    // Each level above the discounted requirement adds the usual chance.
    setLevels(state, playerId, discounted + 2, 3);
    expect(derivePaperBreakthroughChance(state, content, playerId, backprop)).toBeCloseTo(
      content.papers.rules.breakthroughChance.basePerWeek +
        2 * content.papers.rules.breakthroughChance.perLevelAbove,
      9,
    );
  });

  it("does not discount a paper's authored prerequisite levels", () => {
    if (backpropLevel === undefined) throw new Error("backprop missing");
    const state = newState();
    const playerId = state.run.playerLabId;
    const player = state.labs[playerId];
    if (player === undefined) throw new Error("player missing");
    player.compute.allocation = allocation(6_000, optimisation, 5_000);
    // Backpropagation needs Optimisation 3 before it can roll at all; a focus
    // on Optimisation does not lower that, and a focus elsewhere does not
    // lower the Architectures breakthrough level.
    setLevels(state, playerId, backpropLevel, 2);
    expect(eligibleIds(state, playerId)).not.toContain(backprop);
    setLevels(state, playerId, backpropLevel - 1, 3);
    expect(eligibleIds(state, playerId)).not.toContain(backprop);
    setLevels(state, playerId, backpropLevel, 3);
    expect(eligibleIds(state, playerId)).toContain(backprop);
  });

  it("rolls the weekly race at the discounted level", () => {
    if (backpropLevel === undefined) throw new Error("backprop missing");
    const state = newState();
    const playerId = state.run.playerLabId;
    const player = state.labs[playerId];
    if (player === undefined) throw new Error("player missing");
    player.compute.allocation = allocation(6_000, architectures, 5_000);
    setLevels(state, playerId, backpropLevel - discount, 3);
    const tx = createTransaction(state);
    const checks = advancePaperRace(tx, content, new RandomOracleV1(state.run.seed));
    const line = checks.find(
      (check) => check.labId === playerId && check.paperId === backprop,
    );
    expect(line).toMatchObject({
      requiredLevel: backpropLevel - discount,
      currentLevel: backpropLevel - discount,
    });
  });

  it("shows the focus and its rule in the research view", () => {
    const state = newState();
    const player = state.labs[state.run.playerLabId];
    if (player === undefined) throw new Error("player missing");
    player.compute.allocation = allocation(7_000, architectures, 5_000);
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(view.research.paperFocusRule).toEqual({
      researchComputeSharePercent: 30,
      levelDiscount: discount,
    });
    const focused = view.research.techTree.programmes
      .filter((programme) => programme.paperFocus)
      .map((programme) => programme.programId);
    expect(focused).toEqual([architectures]);
  });
});
