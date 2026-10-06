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
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { createSaveEnvelope, loadSaveEnvelope } from "../../persistence/envelope.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  derivePaperBreakthroughChance,
  listEligiblePapers,
} from "../../research/papers.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import {
  advanceRivalResearch,
  calculateRivalProgramResearch,
  rivalOffscreenBoost,
  rivalPaperLevel,
} from "../research.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const backprop = contentId("base:paper.backpropagation");
const architectures = contentId("base:domain.architectures");
const optimisation = contentId("base:domain.optimisation-scaling");

function newState(): GameState {
  return addBaselineModelsForTest(
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

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function rivalIds(state: Readonly<GameState>): LabId[] {
  return Object.keys(state.world.rivals).sort() as LabId[];
}

function programmeIds(): string[] {
  return [
    ...Object.keys(content.research.capabilityDomains),
    ...Object.keys(content.research.safetyPrograms),
  ].sort();
}

function realProgramme(state: Readonly<GameState>, labId: LabId, programmeId: string) {
  const lab = state.labs[labId];
  const programme =
    lab?.research.domains[programmeId] ?? lab?.research.safetyPrograms[programmeId];
  if (programme === undefined) throw new Error(`Missing ${labId} ${programmeId}`);
  return programme;
}

function advanceRivalWeeks(
  state: GameState,
  weeks: number,
  rules: CompiledContent = content,
): GameState {
  let current = state;
  for (let week = 0; week < weeks; week += 1) {
    const tx = createTransaction(current);
    advanceRivalResearch(tx, rules, new RandomOracleV1(current.run.seed));
    const committed = mutable(tx.commit({ description: "rival research week" }).state);
    committed.run.tick = tick(committed.run.tick + 1);
    committed.run.calendar = calendarFromTick(committed.run.tick);
    current = committed;
  }
  return current;
}

/** A late-campaign week: the off-screen organisation is at its full 3x. */
function atWeek(state: GameState, week: number): GameState {
  const draft = mutable(state);
  draft.run.tick = tick(week);
  draft.run.calendar = calendarFromTick(week);
  return draft;
}

function withExponent(exponent: number): CompiledContent {
  return {
    ...content,
    papers: {
      ...content.papers,
      rules: { ...content.papers.rules, rivalOffscreenBoostExponent: exponent },
    },
  };
}

describe("rival paper levels", () => {
  it("start equal to every rival programme's starting level", () => {
    const state = newState();
    for (const labId of rivalIds(state)) {
      const paperLevels = state.world.rivals[labId]?.paperLevels ?? {};
      expect(Object.keys(paperLevels).sort()).toEqual(programmeIds());
      for (const programmeId of programmeIds()) {
        expect(paperLevels[programmeId]).toEqual({
          level: realProgramme(state, labId, programmeId).level,
          levelProgressRp: 0,
        });
      }
    }
  });

  it("divide the off-screen boost back out at the authored exponent", () => {
    const state = atWeek(newState(), 520);
    const labId = rivalIds(state)[0];
    if (labId === undefined) throw new Error("rival missing");
    const output = calculateRivalProgramResearch(
      state,
      content,
      labId,
      architectures,
      new RandomOracleV1(state.run.seed),
    );
    expect(output.offscreenOrganisationMultiplier).toBe(3);
    expect(output.offscreenFacilityMultiplier).toBeGreaterThan(1);
    const boost = rivalOffscreenBoost(output);
    expect(boost).toBeGreaterThan(3);
    expect(content.papers.rules.rivalOffscreenBoostExponent).toBe(0.5);
    expect(output.paperResearchPoints).toBeCloseTo(
      output.finalResearchPoints / Math.sqrt(boost),
      9,
    );
    // The paper ledger reads the boost; the real level keeps all of it.
    expect(output.finalResearchPoints).toBeCloseTo(
      output.baseResearchPoints *
        output.rosterStrength *
        output.facilityStrength *
        output.difficultyMultiplier *
        output.weeklyVariance,
      9,
    );
  });

  it("accrue more slowly than real levels while the boosts are high", () => {
    const after = advanceRivalWeeks(atWeek(newState(), 520), 40);
    let realTotal = 0;
    let paperTotal = 0;
    for (const labId of rivalIds(after)) {
      for (const programmeId of programmeIds()) {
        const real = realProgramme(after, labId, programmeId);
        const paper = after.world.rivals[labId]?.paperLevels[programmeId];
        if (paper === undefined) throw new Error("paper level missing");
        // Never ahead of the real level.
        expect(
          paper.level < real.level ||
            (paper.level === real.level && paper.levelProgressRp <= real.levelProgressRp),
        ).toBe(true);
        realTotal += real.level;
        paperTotal += paper.level;
      }
    }
    expect(paperTotal).toBeLessThan(realTotal);
  });

  it("match real levels exactly when there is no boost to remove", () => {
    // Week 0: no off-screen organisation, facilities or autonomy yet.
    const fresh = newState();
    const labId = rivalIds(fresh)[0];
    if (labId === undefined) throw new Error("rival missing");
    const output = calculateRivalProgramResearch(
      fresh,
      content,
      labId,
      architectures,
      new RandomOracleV1(fresh.run.seed),
    );
    expect(rivalOffscreenBoost(output)).toBe(1);
    expect(output.paperResearchPoints).toBe(output.finalResearchPoints);
    const oneWeek = advanceRivalWeeks(fresh, 1);
    // With the exponent at 0 the boost is kept even late in the campaign.
    const unboosted = advanceRivalWeeks(atWeek(newState(), 520), 20, withExponent(0));
    for (const state of [oneWeek, unboosted]) {
      for (const rivalId of rivalIds(state)) {
        for (const programmeId of programmeIds()) {
          const real = realProgramme(state, rivalId, programmeId);
          expect(state.world.rivals[rivalId]?.paperLevels[programmeId]).toEqual({
            level: real.level,
            levelProgressRp: real.levelProgressRp,
          });
        }
      }
    }
  });

  it("are what the paper race reads for rivals, never above the real level", () => {
    const draft = mutable(newState());
    const labId = rivalIds(draft)[0];
    if (labId === undefined) throw new Error("rival missing");
    const paper = content.papers.definitions[backprop];
    const lab = draft.labs[labId];
    const strategy = draft.world.rivals[labId];
    if (paper === undefined || lab === undefined || strategy === undefined) {
      throw new Error("fixture missing");
    }
    const required = paper.breakthroughRequirement.level;
    const architectureState = lab.research.domains[architectures];
    const optimisationState = lab.research.domains[optimisation];
    if (architectureState === undefined || optimisationState === undefined) {
      throw new Error("programmes missing");
    }
    // Real levels clear the gate; the paper levels do not.
    architectureState.level = rating(required);
    optimisationState.level = rating(3);
    strategy.paperLevels[architectures] = {
      level: rating(required - 1),
      levelProgressRp: 0,
    };
    strategy.paperLevels[optimisation] = { level: rating(3), levelProgressRp: 0 };
    expect(rivalPaperLevel(draft, labId, architectures)).toBe(required - 1);
    expect(listEligiblePapers(draft, content, labId).map((p) => p.paperId)).not.toContain(
      backprop,
    );
    expect(derivePaperBreakthroughChance(draft, content, labId, backprop)).toBe(0);

    strategy.paperLevels[architectures] = { level: rating(required), levelProgressRp: 0 };
    expect(listEligiblePapers(draft, content, labId).map((p) => p.paperId)).toContain(
      backprop,
    );
    expect(derivePaperBreakthroughChance(draft, content, labId, backprop)).toBeCloseTo(
      content.papers.rules.breakthroughChance.basePerWeek,
      9,
    );

    // A paper level above the real level (an incident cut real progress) is
    // capped at the real level.
    strategy.paperLevels[architectures] = {
      level: rating(required + 5),
      levelProgressRp: 0,
    };
    expect(rivalPaperLevel(draft, labId, architectures)).toBe(required);
  });

  it("survive a save and load", () => {
    const draft = mutable(advanceRivalWeeks(atWeek(newState(), 520), 3));
    const labId = rivalIds(draft)[0];
    const strategy = labId === undefined ? undefined : draft.world.rivals[labId];
    if (strategy === undefined) throw new Error("rival missing");
    strategy.paperLevels[architectures] = { level: rating(3), levelProgressRp: 12.5 };
    const state = draft as GameState;
    const loaded = loadSaveEnvelope(
      createSaveEnvelope(state, {
        saveId: "rival-paper-levels",
        slotType: "manual",
        displayName: "Rival paper levels",
        contentHash: content.manifest.bundleHash,
        nowIso: "2026-10-06T12:00:00.000Z",
      }),
    );
    expect(loaded.migration.applied).toEqual([]);
    for (const rivalId of rivalIds(state)) {
      expect(loaded.state.world.rivals[rivalId]?.paperLevels).toEqual(
        state.world.rivals[rivalId]?.paperLevels,
      );
    }
    expect(loaded.state.world.rivals[labId as LabId]?.paperLevels[architectures]).toEqual(
      { level: 3, levelProgressRp: 12.5 },
    );
  });

  it("stay out of the player's view", () => {
    const state = advanceRivalWeeks(atWeek(newState(), 520), 2);
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(JSON.stringify(view)).not.toContain("paperLevels");
  });
});
