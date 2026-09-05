import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";
import { modelHasExternalIncidentExposure } from "../incidents.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

describe("incident safety invariants", () => {
  it("does not treat the crisis calendar phase as external model access", () => {
    const state = structuredClone(
      addBaselineModelForTest(
        createNewGame(
          {
            seed: seed128("b123456789abcdefb123456789abcdef"),
            difficultyId: contentId("base:difficulty.standard"),
            leaderId: contentId("base:leader.thomas-hassabi"),
            mandateId: contentId("base:mandate.build-the-science"),
          },
          content,
        ),
        content,
      ),
    ) as DeepMutable<GameState>;
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    state.run.phase = "crisis";
    model.accessLevel = 1;
    model.deployment.policy = "internal-only";
    model.deployment.exposure = 0;

    expect(modelHasExternalIncidentExposure(state, model)).toBe(false);

    model.deployment.policy = "guarded-api";
    expect(modelHasExternalIncidentExposure(state, model)).toBe(true);
  });
});
