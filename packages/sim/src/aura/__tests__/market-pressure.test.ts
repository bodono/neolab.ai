import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { LabId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { quoteAuraMarketPressure } from "../aura.ts";

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

describe("Aura market pressure", () => {
  it("prices from visible capability, not a rival's hidden truth", () => {
    const state = newState();
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rivalModelId =
      rivalId === undefined ? undefined : state.labs[rivalId]?.models.modelIds[0];
    const rivalModel =
      rivalModelId === undefined ? undefined : state.models[rivalModelId];
    if (rivalId === undefined || rivalModel?.measuredCapability === undefined) {
      throw new Error("rival model fixture missing");
    }
    state.world.rivalSignals = [];
    rivalModel.measuredCapability.frontierCapability = rating(90);
    const unreported = quoteAuraMarketPressure(state, 10);
    expect(unreported.worldFrontierCapability).toBeLessThan(90);

    state.world.rivalSignals.push({
      id: `rival-signal:${rivalId}:benchmark:${rivalModel.id}:0`,
      labId: rivalId,
      kind: "benchmark",
      occurredAt: state.run.tick,
      subjectId: rivalModel.id,
      actualValue: 30,
      noiseUnit: 0,
      baseErrorRadius: 15,
      summary: "A rival reported a new benchmark result.",
    });
    const reported = quoteAuraMarketPressure(state, 10);
    expect(reported.worldFrontierCapability).toBe(30);
    expect(reported.marketPressureMultiplier).toBeCloseTo(1.75, 10);
  });
});
