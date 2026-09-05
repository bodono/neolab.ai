import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { agiComponentFlag } from "../../endgame/candidate-programme.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { LabId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { agiComponentBuildingFlag } from "../../rivals/candidate-programme-race.ts";
import { projectGameView } from "../game-view.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

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

function view(state: GameState) {
  return projectGameView(state, content, {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: Object.fromEntries(
      Object.keys(state.world.rivals).map((labId) => [labId, 80]),
    ),
    evidenceAccess: { evaluationIds: [], anomalyIds: [] },
  });
}

function firstRival(state: GameState): LabId {
  const labId = Object.keys(state.world.rivals).sort()[0];
  if (labId === undefined) throw new Error("no rivals");
  return labId as LabId;
}

function activateCountdown(
  state: DeepMutable<GameState>,
  labId: LabId,
  completesAt: number,
  capability: number,
): void {
  const rival = state.world.rivals[labId];
  const modelId = state.labs[labId]?.models.currentModelId;
  if (rival === undefined || modelId === undefined)
    throw new Error("rival fixture missing");
  rival.candidateCountdown = {
    modelId,
    startedAt: tick(0),
    completesAt: tick(completesAt),
    status: "active",
    modifiers: {
      baseWeeks: completesAt,
      safetyCommitmentWeeks: 0,
      raceUrgencyWeeks: 0,
      politicalProcessWeeks: 0,
      incidentDelayWeeks: 0,
      sharedStandardsWeeks: 0,
      finalWeeks: completesAt,
    },
    estimateNoiseUnit: 0,
    finalYearWarningIssued: false,
  };
  state.world.rivalSignals.push({
    id: `signal:${labId}:candidate`,
    labId,
    kind: "candidate",
    occurredAt: tick(0),
    subjectId: modelId,
    actualValue: capability,
    noiseUnit: 0,
    baseErrorRadius: 0,
    summary: "A rival candidate entered its deployment countdown.",
  });
}

describe("the AGI race horizon", () => {
  it("names the closest rival instead of counting down a calendar constant", () => {
    const projected = view(newState());
    const leader = projected.meta.raceEscalation.leader;
    expect(leader).toBeDefined();
    expect(leader?.labName.length ?? 0).toBeGreaterThan(0);
    expect(leader?.phase).toBe("capability");
    expect(leader?.worksTotal).toBe(4);
  });

  it("promotes a rival that has started its Candidate Programme", () => {
    const state = newState();
    const labId = firstRival(state);
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error("rival missing");
    lab.flags[agiComponentFlag("project-panopticon")] = true;
    lab.flags[agiComponentBuildingFlag("world-engine")] = tick(4);

    const leader = view(state).meta.raceEscalation.leader;
    expect(leader?.labId).toBe(labId);
    expect(leader?.phase).toBe("programme");
    expect(leader?.worksComplete).toBe(1);
    expect(leader?.worksBuilding).toBe(1);
  });

  it("ranks a programme-building rival above a merely capable one", () => {
    const state = newState();
    const rivals = Object.keys(state.world.rivals).sort() as LabId[];
    const builder = rivals[1];
    const capable = rivals[0];
    if (builder === undefined || capable === undefined) throw new Error("need rivals");
    const builderLab = state.labs[builder];
    const capableModelId = state.labs[capable]?.models.currentModelId;
    const capableModel =
      capableModelId === undefined ? undefined : state.models[capableModelId];
    if (builderLab === undefined || capableModel === undefined) {
      throw new Error("fixture missing");
    }
    builderLab.flags[agiComponentFlag("project-panopticon")] = true;
    capableModel.trueCapability.reasoning = rating(95);
    capableModel.trueCapability.language = rating(95);

    expect(view(state).meta.raceEscalation.leader?.labId).toBe(builder);
  });

  it("ranks the most imminent live countdown ahead of a more capable rival", () => {
    const state = newState();
    const rivals = Object.keys(state.world.rivals).sort() as LabId[];
    const moreCapable = rivals[0];
    const moreImminent = rivals[1];
    if (moreCapable === undefined || moreImminent === undefined) {
      throw new Error("need two rivals");
    }
    activateCountdown(state, moreCapable, 20, 95);
    activateCountdown(state, moreImminent, 6, 80);

    const leader = view(state).meta.raceEscalation.leader;
    expect(leader?.labId).toBe(moreImminent);
    expect(leader?.phase).toBe("countdown");
  });

  it("uses capability to break a tie between equally imminent countdowns", () => {
    const state = newState();
    const rivals = Object.keys(state.world.rivals).sort() as LabId[];
    const moreCapable = rivals[0];
    const lessCapable = rivals[1];
    if (moreCapable === undefined || lessCapable === undefined) {
      throw new Error("need two rivals");
    }
    activateCountdown(state, moreCapable, 10, 95);
    activateCountdown(state, lessCapable, 10, 80);

    expect(view(state).meta.raceEscalation.leader?.labId).toBe(moreCapable);
  });

  it("does not expose a fixed calendar backstop", () => {
    const projected = view(newState());
    expect(projected.meta.raceEscalation).not.toHaveProperty("escalationYear");
    expect(projected.meta.raceEscalation).not.toHaveProperty("escalationTick");
    expect(projected.meta.raceEscalation).not.toHaveProperty("weeksUntilEscalation");
    expect(projected.meta.raceEscalation.leader?.phase).not.toBe("countdown");
  });
});
