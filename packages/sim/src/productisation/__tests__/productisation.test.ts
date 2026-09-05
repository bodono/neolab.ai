import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { applyEffect } from "../../engine/effect-executor.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  completeProductisation,
  labLaunchExperience,
  quoteProductisation,
  startProductisation,
} from "../productisation.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
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

describe("productisation duration modifiers", () => {
  it("completes safely when a hot-reloaded tab still holds the previous recipe shape", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("baseline productisation fixture missing");
    }

    const startTx = createTransaction(state);
    const projectId = startProductisation(startTx, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    const started = startTx.commit({ description: "start productisation" }).state;
    const readyTx = createTransaction(started);
    readyTx.update((draft) => {
      const project = draft.projects[projectId];
      if (project === undefined) throw new Error("productisation project missing");
      project.status = "active";
      project.startedAt = draft.run.tick;
      project.progress = 1;
    });
    const ready = readyTx.commit({ description: "ready productisation" }).state;

    const staleContent = structuredClone(content);
    const staleRecipe = staleContent.deployment.productisation
      .normal as unknown as Record<string, unknown>;
    staleRecipe["productQualityTowardEngineering"] =
      staleRecipe["productQualityTowardTarget"];
    staleRecipe["reliabilityTowardEngineering"] = staleRecipe["reliabilityTowardTarget"];
    delete staleRecipe["productQualityTowardTarget"];
    delete staleRecipe["reliabilityTowardTarget"];

    const completionTx = createTransaction(ready);
    completeProductisation(completionTx, staleContent, projectId);
    const completed = completionTx.commit({
      description: "complete productisation",
    }).state;
    expect(completed.models[modelId]?.productQuality).toBeGreaterThan(
      state.models[modelId]?.productQuality ?? 0,
    );
    expect(completed.models[modelId]?.reliability).toBeGreaterThan(
      state.models[modelId]?.reliability ?? 0,
    );
  });

  it("turns capability, optimisation research and launch experience into stronger releases", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error("release progression fixture missing");
    }

    const opening = quoteProductisation(state, content, {
      labId: lab.id,
      modelId: model.id,
      mode: "normal",
    });
    const optimisation = lab.research.domains["base:domain.optimisation-scaling"];
    if (optimisation === undefined) throw new Error("optimisation fixture missing");
    optimisation.level = rating(80);
    if (model.measuredCapability === undefined) {
      throw new Error("measured capability fixture missing");
    }
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(88);
    }
    model.measuredCapability.frontierCapability = rating(88);
    model.deployment.productisationRuns.normal = 20;
    model.flags["training:posture"] = "conservative";

    const experienced = quoteProductisation(state, content, {
      labId: lab.id,
      modelId: model.id,
      mode: "hardened",
    });

    expect(experienced.productQualityEstimate).toBeGreaterThan(
      opening.productQualityEstimate,
    );
    expect(experienced.reliabilityEstimate).toBeGreaterThan(opening.reliabilityEstimate);
    expect(experienced.productQualityEstimate).toBeGreaterThanOrEqual(75);
    expect(experienced.reliabilityEstimate).toBeGreaterThanOrEqual(75);
    expect(experienced.engineeringBreakdown?.frontierCapability).toBeCloseTo(88, 8);
    expect(experienced.engineeringBreakdown).toMatchObject({
      optimisationResearch: 80,
      launchExperience: 20,
      maximumLaunchExperience: 20,
      trainingPosture: "conservative",
    });
  });

  it("builds launch experience gradually across twenty completed launches", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error("launch-experience fixture missing");
    }

    model.deployment.productisationRuns.normal = 5;
    const fiveLaunches = quoteProductisation(state, content, {
      labId: lab.id,
      modelId: model.id,
      mode: "normal",
    });
    model.deployment.productisationRuns.normal = 20;
    const twentyLaunches = quoteProductisation(state, content, {
      labId: lab.id,
      modelId: model.id,
      mode: "normal",
    });
    model.deployment.productisationRuns.normal = 25;

    expect(fiveLaunches.engineeringBreakdown?.launchExperience).toBe(5);
    expect(twentyLaunches.engineeringBreakdown?.launchExperience).toBe(20);
    expect(twentyLaunches.productQualityEstimate).toBeGreaterThan(
      fiveLaunches.productQualityEstimate,
    );
    expect(twentyLaunches.reliabilityEstimate).toBeGreaterThan(
      fiveLaunches.reliabilityEstimate,
    );
    expect(labLaunchExperience(state, lab.id)).toBe(20);
  });

  it("makes hardened engineering meaningfully stronger than normal and rush", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("release posture fixture missing");
    }
    const quote = (mode: "normal" | "hardened" | "rush") =>
      quoteProductisation(state, content, { labId: lab.id, modelId, mode });

    expect(quote("hardened").productQualityEstimate).toBeGreaterThan(
      quote("normal").productQualityEstimate,
    );
    expect(quote("normal").productQualityEstimate).toBeGreaterThan(
      quote("rush").productQualityEstimate,
    );
    expect(quote("hardened").reliabilityEstimate).toBeGreaterThan(
      quote("normal").reliabilityEstimate,
    );
    expect(quote("normal").reliabilityEstimate).toBeGreaterThan(
      quote("rush").reliabilityEstimate,
    );
  });

  it("applies recurring modifiers to every authorised productisation project", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("baseline productisation fixture missing");
    }

    const modifierTx = createTransaction(state);
    applyEffect(
      modifierTx,
      {
        kind: "add-modifier",
        target: "lab.product.durationWeeks",
        operation: "multiply",
        value: 0.5,
      },
      { kind: "researcher", id: "test:recurring-product-instinct" },
    );
    const modified = modifierTx.commit({
      description: "recurring product modifier",
    }).state;

    const first = quoteProductisation(modified, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    expect(first.durationWeeks).toBe(2);
    expect(first.blockers).toEqual([]);

    const startTx = createTransaction(modified);
    startProductisation(startTx, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    const started = startTx.commit({ description: "first productisation" }).state;

    const second = quoteProductisation(started, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    expect(second.durationWeeks).toBe(2);
  });

  it("applies first-project modifiers to exactly the first authorisation", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("baseline productisation fixture missing");
    }

    const modifierTx = createTransaction(state);
    applyEffect(
      modifierTx,
      {
        kind: "add-modifier",
        target: "lab.product.firstProject.durationWeeks",
        operation: "multiply",
        value: 0.5,
      },
      { kind: "researcher", id: "test:first-product-instinct" },
    );
    const modified = modifierTx.commit({ description: "first product modifier" }).state;

    const first = quoteProductisation(modified, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    expect(first.durationWeeks).toBe(2);
    expect(first.blockers).toEqual([]);

    const startTx = createTransaction(modified);
    const firstProjectId = startProductisation(startTx, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    const started = startTx.commit({ description: "first productisation" }).state;
    expect(started.projects[firstProjectId]?.expectedDurationWeeks).toBe(2);

    const second = quoteProductisation(started, content, {
      labId: lab.id,
      modelId,
      mode: "normal",
    });
    expect(second.durationWeeks).toBe(4);
  });
});
