import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { LabId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { validateGameState } from "../../model/schema.ts";
import { seed128 } from "../../random/seed.ts";
import { quoteTrainingRun, startTrainingRun } from "../../training/training.ts";
import { createNewGame } from "../create-new-game.ts";
import { createTransaction } from "../transaction.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  let state = addBaselineModelForTest(
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
  for (const rivalId of Object.keys(state.world.rivals).sort() as LabId[]) {
    state = addBaselineModelForTest(state, content, rivalId);
  }
  return state;
}

describe("run entity IDs", () => {
  it("number per owner, while the global counter keeps completion order", () => {
    const tx = createTransaction(newState());
    expect(tx.allocateId("project", "lab:player")).toBe("run:project:lab:player:0000");
    expect(tx.allocateId("project", "lab:rival")).toBe("run:project:lab:rival:0000");
    expect(tx.allocateId("project", "lab:player")).toBe("run:project:lab:player:0001");
    const state = tx.commit({ description: "ids" }).state;
    expect(state.run.idCounters.project).toBe(3);
    expect(state.run.ownerIdCounters["lab:player"]?.project).toBe(2);
    expect(validateGameState(state).run.ownerIdCounters).toEqual(
      state.run.ownerIdCounters,
    );
  });

  it("keep a rival's next model, and the draws keyed on it, independent of the player", () => {
    const state = newState();
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    if (rivalId === undefined) throw new Error("rival fixture missing");
    const before = quoteTrainingRun(state, content, {
      labId: rivalId,
      posture: "normal",
    });

    const tx = createTransaction(state);
    startTrainingRun(tx, content, { labId: state.run.playerLabId, posture: "normal" });
    const afterPlayerTrains = tx.commit({ description: "player trains" }).state;
    const after = quoteTrainingRun(afterPlayerTrains, content, {
      labId: rivalId,
      posture: "normal",
    });

    expect(after.futureModelId).toBe(before.futureModelId);
    expect(after.futureProjectId).toBe(before.futureProjectId);
  });
});
