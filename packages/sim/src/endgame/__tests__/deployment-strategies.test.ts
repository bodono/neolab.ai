import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { deploymentStrategies } from "../deployment-strategies.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function stateAndModel(): { state: DeepMutable<GameState>; modelId: string } {
  const state = structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("00112233445566778899aabbccddeeff"),
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
  if (modelId === undefined) throw new Error("Player model missing");
  return { state, modelId };
}

describe("endgame deployment strategy fit", () => {
  it("keeps Deploy Now zero-week, always visible, and explicitly reckless", () => {
    const { state, modelId } = stateAndModel();
    const route = deploymentStrategies(state, content, modelId as never).find(
      (candidate) => candidate.id === "deploy-now",
    );
    expect(route).toMatchObject({
      durationWeeks: 0,
      fitGrade: "Reckless",
      blockers: [],
    });
  });

  it("improving control and security cannot worsen fortress fit", () => {
    const { state, modelId } = stateAndModel();
    const before = deploymentStrategies(state, content, modelId as never).find(
      (candidate) => candidate.id === "fortress-contained-pilot",
    );
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined || before === undefined) throw new Error("Fixture missing");
    lab.safety.practicalControlStrength = rating(100);
    lab.safety.securityPosture = rating(100);
    lab.safety.safetyCulture = rating(100);
    const after = deploymentStrategies(state, content, modelId as never).find(
      (candidate) => candidate.id === "fortress-contained-pilot",
    );
    expect(after?.fitScore).toBeGreaterThan(before.fitScore);
    expect(after?.fitGrade).toBe("Prepared");
  });

  it("does not use a coalition as a route or a fit input", () => {
    const { state, modelId } = stateAndModel();
    const routes = deploymentStrategies(state, content, modelId as never);
    expect(routes.some((route) => route.id.includes("coalition"))).toBe(false);
    expect(
      routes.find((route) => route.id === "government-licensed-deployment"),
    ).toBeDefined();
  });

  it("turns standing government programmes into visible licensed-route fit", () => {
    const { state, modelId } = stateAndModel();
    const before = deploymentStrategies(state, content, modelId as never).find(
      (candidate) => candidate.id === "government-licensed-deployment",
    );
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined || before === undefined) throw new Error("Fixture missing");
    lab.politics.programmes = [
      "safety-standards-partnership",
      "public-sector-contract",
      "defence-applications",
      "national-champion",
    ];
    const after = deploymentStrategies(state, content, modelId as never).find(
      (candidate) => candidate.id === "government-licensed-deployment",
    );
    expect(after?.fitScore).toBe(before.fitScore + 25);
    expect(after?.reliesOn).toContain("Standing programme fit +25");
  });
});
