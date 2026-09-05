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
import type { GameState } from "../../model/state.ts";
import { startConstructionProject } from "../../projects/project-framework.ts";
import { seed128 } from "../../random/seed.ts";
import { completeFacilityConstruction } from "../facilities.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

const starSlotDefinitions = Object.values(content.facilities)
  .filter((definition) => definition.tags.includes("star-slot"))
  .sort((a, b) => a.tier - b.tier);

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

describe("star-researcher slots", () => {
  it("every advertised slot is openable: buildable facilities cover the hard maximum", () => {
    // The roster panel shows hardMaximumSlots slots. Slots the content cannot
    // unlock are dead UI -- the read-but-never-written failure mode again.
    const rules = content.researchers.rules.ability;
    expect(rules.initialSlots + starSlotDefinitions.length).toBeGreaterThanOrEqual(
      rules.hardMaximumSlots,
    );
  });

  it("the unlock ladder is exactly one facility per tier, one through five", () => {
    expect(starSlotDefinitions.map((definition) => definition.tier)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("completing each slot facility raises the ceiling one step to the hard maximum", () => {
    const tx = createTransaction(newState());
    const labId = tx.read().run.playerLabId;
    expect(tx.read().labs[labId]?.roster.starSlots).toBe(3);
    const expectedLadder = [4, 5, 6, 7, 8];
    starSlotDefinitions.forEach((definition, index) => {
      const projectId = startConstructionProject(tx, content, labId, definition.id);
      completeFacilityConstruction(tx, content, labId, projectId);
      expect(tx.read().labs[labId]?.roster.starSlots).toBe(expectedLadder[index]);
    });
  });

  it("reconciliation derives the ceiling from built facilities instead of incrementing", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.roster.starSlots = 0;
    const tx = createTransaction(state);
    const definition = starSlotDefinitions[0];
    if (definition === undefined) throw new Error("no star-slot facilities in content");
    const projectId = startConstructionProject(
      tx,
      content,
      state.run.playerLabId,
      definition.id,
    );
    completeFacilityConstruction(tx, content, state.run.playerLabId, projectId);
    expect(tx.read().labs[state.run.playerLabId]?.roster.starSlots).toBe(4);
  });
});
