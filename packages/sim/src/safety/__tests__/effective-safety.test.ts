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
import { reconcileFacilityModifierValues } from "../../facilities/facilities.ts";
import type { FacilityId, ModifierId } from "../../model/ids.ts";
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
    expect(effectivePracticalControlStrength(state)).toBe(before + 45);
  });

  it("brings a save's existing facility bonuses up to the authored values", () => {
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
    const definitionId = contentId("base:facility.alignment-institute-1");
    const definition = content.facilities[definitionId];
    const lab = state.labs[state.run.playerLabId];
    const template = lab?.facilities.instances[0];
    if (definition === undefined || lab === undefined || template === undefined) {
      throw new Error("Facility fixture missing");
    }
    // An institute built before its practical-control bonus rose to +25.
    const facilityId = "facility:test:institute" as FacilityId;
    const modifierIds = definition.modifiers.map((authored, index) => {
      const id = `modifier:test:institute:${String(index)}` as ModifierId;
      state.modifiers[id] = {
        id,
        source: { kind: "facility", id: facilityId },
        labId: state.run.playerLabId,
        target: authored.target,
        operation: authored.operation,
        value: authored.target === PRACTICAL_CONTROL_BONUS_TARGET ? 15 : authored.value,
        startsAt: state.run.tick,
        tags: ["facility"],
      };
      return id;
    });
    lab.facilities.instances.push({
      ...template,
      id: facilityId,
      definitionId,
      modifierIds,
    });

    const tx = createTransaction(state);
    reconcileFacilityModifierValues(tx, content);
    const after = tx.commit({ description: "reconcile facility modifiers" }).state;
    const bonus = modifierIds
      .map((id) => after.modifiers[id])
      .find((modifier) => modifier?.target === PRACTICAL_CONTROL_BONUS_TARGET);
    expect(bonus?.value).toBe(25);
  });
});
