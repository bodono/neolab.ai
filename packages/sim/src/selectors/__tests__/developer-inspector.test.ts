import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { seed128 } from "../../random/seed.ts";
import {
  DEVELOPER_INSPECTOR_BUNDLE_SENTINEL,
  exportDeveloperScenarioFixture,
  lookupDeveloperRandom,
  projectDeveloperInspector,
} from "../developer-inspector.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function state() {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
}

describe("privileged developer inspector", () => {
  it("projects canonical diagnostics including hidden truth and exact race inputs", () => {
    const canonical = state();
    const view = projectDeveloperInspector(canonical, content);
    const playerModel = view.models.find(
      (model) => model.ownerLabId === canonical.run.playerLabId,
    );
    if (playerModel === undefined) throw new Error("player model missing");

    expect(view.sentinel).toBe(DEVELOPER_INSPECTOR_BUNDLE_SENTINEL);
    expect(view.run).toMatchObject({ tick: 0, status: "active" });
    expect(view.invariants).toEqual([]);
    expect(view.finance).toHaveLength(5);
    expect(playerModel.hiddenSafety).toEqual(
      canonical.models[playerModel.modelId]?.hiddenSafety,
    );
    expect(playerModel).toMatchObject({
      isCurrentModel: true,
      isCommercialModel: true,
    });
    expect(view.papers).toHaveLength(5);
    expect(view.papers[0]?.papers).toHaveLength(
      Object.keys(content.papers.definitions).length,
    );
    expect(view.rivals).toHaveLength(4);
    expect(view.events.opportunityChance).toBeGreaterThan(0);
    expect(view.endgame.scoreInputs).toMatchObject({
      status: "unavailable",
      reason: "Deployment Crisis inactive",
    });
  });

  it("looks up stable keyed random values without consuming global state", () => {
    const canonical = state();
    const first = lookupDeveloperRandom(canonical, ["training", "fixture", "quality"]);
    const repeat = lookupDeveloperRandom(canonical, ["training", "fixture", "quality"]);
    const other = lookupDeveloperRandom(canonical, ["training", "fixture", "safety"]);

    expect(first).toEqual(repeat);
    expect(first.key).toBe("training/fixture/quality");
    expect(first.uniform).toBeGreaterThanOrEqual(0);
    expect(first.uniform).toBeLessThan(1);
    expect(other.uniform).not.toBe(first.uniform);
  });

  it("exports a deterministic, directly loadable scenario fixture", () => {
    const canonical = state();
    const first = exportDeveloperScenarioFixture(canonical, content);
    const repeat = exportDeveloperScenarioFixture(canonical, content);

    expect(first).toEqual(repeat);
    expect(first).toMatchObject({
      format: "neolab-developer-scenario-v1",
      contentHash: content.manifest.bundleHash,
      tick: 0,
      expected: {
        runStatus: "active",
        endgameStage: "inactive",
        invariantViolationCodes: [],
      },
    });
    expect(first.canonicalState).toEqual(canonical);
  });

  it("rejects arbitrary objects at the privileged boundary", () => {
    expect(() => projectDeveloperInspector({ hiddenSafety: true }, content)).toThrow(
      "Invalid game state",
    );
    expect(() => lookupDeveloperRandom(state(), [])).toThrow("at least one segment");
  });
});
