import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { ModifierId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";
import {
  effectivePracticalControlStrength,
  PRACTICAL_CONTROL_BONUS_TARGET,
} from "../effective-safety.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

describe("effective practical control", () => {
  it("counts the standing bonus from the lab's control facilities", () => {
    const state = structuredClone(
      createNewGame(
        {
          seed: seed128("0123456789abcdef0123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-it-right"),
        },
        content,
      ),
    ) as DeepMutable<GameState>;
    const before = effectivePracticalControlStrength(state);

    for (const definitionId of [
      "base:facility.alignment-institute-1",
      "base:facility.secure-bunker-1",
    ] as const) {
      const bonus = content.facilities[definitionId]?.modifiers.find(
        (modifier) => modifier.target === PRACTICAL_CONTROL_BONUS_TARGET,
      );
      if (bonus === undefined) throw new Error(`${definitionId} lacks a control bonus`);
      const id = `modifier:test:${definitionId}` as ModifierId;
      state.modifiers[id] = {
        id,
        source: { kind: "facility", id: `facility:test:${definitionId}` },
        labId: state.run.playerLabId,
        target: bonus.target,
        operation: bonus.operation,
        value: bonus.value,
        startsAt: state.run.tick,
        tags: ["facility"],
      };
    }

    // The control review used to be a lab's only repeatable source; the
    // Alignment Institute and the Secure Bunker now stand in for it.
    expect(effectivePracticalControlStrength(state)).toBe(before + 25);
  });
});
