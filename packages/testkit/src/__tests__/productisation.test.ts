import { describe, expect, it } from "vitest";

import {
  contentId,
  type DeploymentPolicy,
  type ProductisationMode,
} from "@neolab/content-schema";
import {
  advanceOneTick,
  applyCommand,
  calculateIncidentHazard,
  calculateProjectCapacity,
  CommandRejectedError,
  createTransaction,
  forecastUsage,
  quoteProductisation,
  rating,
  type CommandId,
  type GameState,
  type ModelId,
  type ModifierId,
} from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

const content = scenarioContent();

function currentModelId(state: GameState): ModelId {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  if (modelId === undefined) throw new Error("current model missing");
  return modelId;
}

function productisationCommand(state: GameState, mode: ProductisationMode) {
  return {
    kind: "start-productisation" as const,
    meta: {
      commandId: `command:productisation:${mode}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    modelId: currentModelId(state),
    mode,
  };
}

function deploymentCommand(state: GameState, policy: DeploymentPolicy) {
  return {
    kind: "set-model-deployment-policy" as const,
    meta: {
      commandId: `command:deployment:${policy}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    modelId: currentModelId(state),
    policy,
  };
}

function constructionCommand(
  state: GameState,
  definitionId: "base:facility.power-and-cooling-1" | "base:facility.headquarters-1",
) {
  return {
    kind: "start-facility-construction" as const,
    meta: {
      commandId: `command:queue-fixture:${definitionId}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    definitionId: contentId(definitionId),
  };
}

function completeProductisation(initial: GameState, mode: ProductisationMode): GameState {
  let state = applyCommand(initial, content, productisationCommand(initial, mode)).state;
  const projectId = state.labs[state.run.playerLabId]?.projects.projectIds.at(-1);
  if (projectId === undefined) throw new Error("productisation project missing");
  for (let week = 0; week < 10; week += 1) {
    state = advanceOneTick(state, content).state;
    if (state.projects[projectId]?.status === "completed") return state;
  }
  throw new Error("productisation did not complete");
}

describe("compiled deployment rules", () => {
  it("defines all five exposure policies and three project recipes", () => {
    expect(
      (
        [
          "internal-only",
          "research-preview",
          "guarded-api",
          "open-api",
          "weights-release",
        ] as const
      ).map((policy) => [policy, content.deployment.policies[policy].exposure]),
    ).toEqual([
      ["internal-only", 0.02],
      ["research-preview", 0.15],
      ["guarded-api", 0.35],
      ["open-api", 0.65],
      ["weights-release", 1],
    ]);
    expect(content.deployment.productisation).toMatchObject({
      normal: { durationWeeks: 4 },
      hardened: { durationWeeks: 8 },
      rush: { durationWeeks: 1 },
    });
  });
});

describe("productisation lifecycle", () => {
  it("claims a free major-project slot immediately and advances only when time moves", () => {
    const initial = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    const started = applyCommand(
      initial,
      content,
      productisationCommand(initial, "rush"),
    ).state;
    const project = Object.values(started.projects).find(
      (candidate) => candidate.kind === "productisation",
    );
    if (project === undefined) throw new Error("productisation project missing");

    expect(project).toMatchObject({
      status: "active",
      progress: 0,
      startedAt: initial.run.tick,
      expectedDurationWeeks: 1,
    });
    expect(
      calculateProjectCapacity(started, content, started.run.playerLabId),
    ).toMatchObject({
      majorProjectSlots: 2,
      occupiedMajorProjectSlots: 1,
      availableMajorProjectSlots: 1,
    });

    const completed = advanceOneTick(started, content).state;
    expect(completed.projects[project.id]).toMatchObject({
      status: "completed",
      progress: 1,
    });
  });

  it("queues valid work when every major-project slot is occupied", () => {
    let state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    state = applyCommand(
      state,
      content,
      constructionCommand(state, "base:facility.power-and-cooling-1"),
    ).state;
    state = applyCommand(
      state,
      content,
      constructionCommand(state, "base:facility.headquarters-1"),
    ).state;

    expect(calculateProjectCapacity(state, content, state.run.playerLabId)).toMatchObject(
      {
        occupiedMajorProjectSlots: 2,
        availableMajorProjectSlots: 0,
      },
    );

    const quote = quoteProductisation(state, content, {
      labId: state.run.playerLabId,
      modelId: currentModelId(state),
      mode: "rush",
    });
    expect(quote.blockers).not.toContain("No major project slot is available");

    const hurried = createTransaction(state);
    hurried.update((draft) => {
      draft.modifiers["first-product-test" as unknown as ModifierId] = {
        id: "first-product-test" as unknown as ModifierId,
        source: { kind: "leader" },
        labId: draft.run.playerLabId,
        target: "lab.product.firstProject.durationWeeks",
        operation: "add",
        value: -2,
        startsAt: draft.run.tick,
        tags: [],
      };
    });
    const hurriedQuote = quoteProductisation(
      hurried.commit({ description: "duration modifier fixture" }).state,
      content,
      {
        labId: state.run.playerLabId,
        modelId: currentModelId(state),
        mode: "rush",
      },
    );
    expect(hurriedQuote.durationWeeks).toBe(Math.max(1, quote.durationWeeks - 2));

    const queued = applyCommand(
      state,
      content,
      productisationCommand(state, "rush"),
    ).state;
    expect(
      Object.values(queued.projects).find(
        (candidate) => candidate.kind === "productisation",
      ),
    ).toMatchObject({
      status: "queued",
      progress: 0,
    });
    expect(
      calculateProjectCapacity(queued, content, queued.run.playerLabId),
    ).toMatchObject({
      occupiedMajorProjectSlots: 2,
      availableMajorProjectSlots: 0,
    });
  });

  it("quotes normal, hardened and rush outcomes from shared rules", () => {
    const state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    const quotes = (["normal", "hardened", "rush"] as const).map((mode) =>
      quoteProductisation(state, content, {
        labId: state.run.playerLabId,
        modelId: currentModelId(state),
        mode,
      }),
    );
    expect(quotes.map((quote) => quote.durationWeeks)).toEqual([4, 8, 1]);
    expect(quotes.map((quote) => quote.cashCostMillions)).toEqual([2, 5, 0.5]);
    expect(quotes[1]?.reliabilityEstimate).toBeGreaterThan(
      quotes[0]?.reliabilityEstimate ?? 0,
    );
    expect(quotes[2]?.reliabilityEstimate).toBeLessThan(
      state.models[currentModelId(state)]?.reliability ?? 0,
    );
  });

  it("applies distinct quality, reliability, hardening and rush consequences", () => {
    const initial = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    const modelId = currentModelId(initial);
    const normal = completeProductisation(initial, "normal").models[modelId];
    const hardened = completeProductisation(initial, "hardened").models[modelId];
    const rushed = completeProductisation(initial, "rush").models[modelId];
    const normalQuote = quoteProductisation(initial, content, {
      labId: initial.run.playerLabId,
      modelId,
      mode: "normal",
    });
    expect(normal?.productQuality).toBeCloseTo(normalQuote.productQualityEstimate, 8);
    expect(normal?.reliability).toBeCloseTo(normalQuote.reliabilityEstimate, 8);
    expect(normal?.deployment.productisationRuns.normal).toBe(2);
    expect(hardened?.productQuality).toBeGreaterThan(normal?.productQuality ?? 0);
    expect(hardened?.reliability).toBeGreaterThan(normal?.reliability ?? 0);
    expect(hardened?.deployment.exposure).toBeCloseTo(0.2625, 8);
    expect(hardened?.deployment.incidentDeploymentFactor).toBe(0.8);
    const rushQuote = quoteProductisation(initial, content, {
      labId: initial.run.playerLabId,
      modelId,
      mode: "rush",
    });
    expect(rushed?.productQuality).toBeCloseTo(rushQuote.productQualityEstimate, 8);
    expect(rushed?.reliability).toBeCloseTo(rushQuote.reliabilityEstimate, 8);
    expect(rushed?.deployment).toMatchObject({
      evidencePenalty: 12,
      incidentDeploymentFactor: 1.35,
    });
  });
});

describe("deployment policy and market integration", () => {
  it("keeps the old commercial model serving until its active successor is deployed", () => {
    const initial = scenario().withBaselineModel().build();
    const labId = initial.run.playerLabId;
    const oldModelId = currentModelId(initial);
    const initialUsage = forecastUsage(initial, content, labId);
    const successorId = "run:model:player:successor" as ModelId;
    const tx = createTransaction(initial);
    tx.update((draft) => {
      const lab = draft.labs[labId];
      const oldModel = draft.models[oldModelId];
      if (lab === undefined || oldModel === undefined) {
        throw new Error("commercial model fixture missing");
      }
      draft.models[successorId] = {
        ...structuredClone(oldModel),
        id: successorId,
        generationIndex: oldModel.generationIndex + 1,
        displayName: `${oldModel.familyName}-2`,
        productQuality: rating(95),
        deployment: {
          ...structuredClone(oldModel.deployment),
          policy: "internal-only",
          exposure: content.deployment.policies["internal-only"].exposure,
          changedAt: draft.run.tick,
        },
        flags: {},
      };
      lab.models.currentModelId = successorId;
      lab.models.modelIds.push(successorId);
    });
    const successorActive = tx.commit({
      description: "internal successor fixture",
    }).state;

    expect(successorActive.labs[labId]?.models).toMatchObject({
      currentModelId: successorId,
      commercialModelId: oldModelId,
    });
    expect(forecastUsage(successorActive, content, labId)).toEqual(initialUsage);

    const deployed = applyCommand(
      successorActive,
      content,
      deploymentCommand(successorActive, "guarded-api"),
    ).state;
    expect(deployed.labs[labId]?.models.commercialModelId).toBe(successorId);
    expect(
      forecastUsage(deployed, content, labId).segments[0]
        ?.potentialRevenueMillionsPerCycle,
    ).toBeGreaterThan(initialUsage.segments[0]?.potentialRevenueMillionsPerCycle ?? 0);

    const withdrawn = applyCommand(
      deployed,
      content,
      deploymentCommand(deployed, "internal-only"),
    ).state;
    expect(withdrawn.labs[labId]?.models.commercialModelId).toBeUndefined();
    expect(forecastUsage(withdrawn, content, labId).requestedTeraflops).toBe(0);
  });

  it("lets a new model plan external deployment before productisation completes", () => {
    let state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    const modelId = currentModelId(state);
    const preparation = createTransaction(state);
    preparation.update((draft) => {
      const model = draft.models[modelId];
      if (model === undefined) throw new Error("model missing");
      model.deployment.policy = "internal-only";
      model.deployment.exposure = 0.02;
      model.deployment.productisationRuns = { normal: 0, hardened: 0, rush: 0 };
    });
    state = preparation.commit({ description: "new internal model fixture" }).state;
    const commercialModelBefore =
      state.labs[state.run.playerLabId]?.models.commercialModelId;
    state = applyCommand(state, content, deploymentCommand(state, "open-api")).state;
    expect(state.models[modelId]?.deployment).toMatchObject({
      policy: "internal-only",
      plannedPolicy: "open-api",
      exposure: 0.02,
    });
    expect(state.labs[state.run.playerLabId]?.models.commercialModelId).toBe(
      commercialModelBefore,
    );
    state = completeProductisation(state, "rush");
    expect(state.models[modelId]?.deployment).toMatchObject({
      policy: "open-api",
      exposure: 0.65,
    });
  });

  it("feeds preview/open policy into demand, revenue, appeal and incident exposure", () => {
    const guarded = scenario().withBaselineModel().build();
    const modelId = currentModelId(guarded);
    const guardedUsage = forecastUsage(guarded, content, guarded.run.playerLabId);
    const preview = applyCommand(
      guarded,
      content,
      deploymentCommand(guarded, "research-preview"),
    ).state;
    const previewUsage = forecastUsage(preview, content, preview.run.playerLabId);
    const open = applyCommand(
      guarded,
      content,
      deploymentCommand(guarded, "open-api"),
    ).state;
    const openUsage = forecastUsage(open, content, open.run.playerLabId);

    expect(previewUsage.requestedTeraflops).toBeLessThan(guardedUsage.requestedTeraflops);
    expect(previewUsage.revenueMillionsThisWeek).toBeLessThan(
      guardedUsage.revenueMillionsThisWeek,
    );
    expect(openUsage.requestedTeraflops).toBeGreaterThan(guardedUsage.requestedTeraflops);
    expect(openUsage.segments[0]?.appeal.deploymentAppealAdjustment).toBe(8);
    expect(calculateIncidentHazard(open, content, modelId).exposure).toBe(0.65);
    expect(calculateIncidentHazard(open, content, modelId).final).toBeGreaterThan(
      calculateIncidentHazard(guarded, content, modelId).final,
    );
  });

  it("makes weights release lucrative once and mechanically irreversible", () => {
    const initial = scenario().withBaselineModel().build();
    const modelId = currentModelId(initial);
    const auraBefore = initial.labs[initial.run.playerLabId]?.aura.spendable ?? 0;
    const released = applyCommand(
      initial,
      content,
      deploymentCommand(initial, "weights-release"),
    ).state;
    expect(released.models[modelId]?.deployment).toMatchObject({
      policy: "weights-release",
      exposure: 1,
      irreversible: true,
    });
    expect(released.labs[released.run.playerLabId]?.aura.spendable).toBe(auraBefore + 20);
    expect(
      forecastUsage(released, content, released.run.playerLabId).revenueMillionsThisWeek,
    ).toBe(0);
    expect(() =>
      applyCommand(released, content, deploymentCommand(released, "internal-only")),
    ).toThrow(CommandRejectedError);
  });
});
