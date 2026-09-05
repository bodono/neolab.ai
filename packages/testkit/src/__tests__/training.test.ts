import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";
import {
  advanceOneTick,
  advanceTrainingProject,
  applyCommand,
  CAPABILITY_FLOP_FLOOR,
  CAPABILITY_POINTS_PER_DECADE,
  createSaveEnvelope,
  createTransaction,
  gpuCount,
  loadSaveEnvelope,
  quoteTrainingRun,
  rating,
  stateHash,
  TRAINING_FAILURE_COOLDOWN_WEEKS,
  UPPER_CURVE_COMPUTE_SHIFT,
  UPPER_CURVE_REFERENCE_SCORE,
  trainingScaleScore,
  trainingPostureDefinition,
  validateCommand,
  type CommandId,
  type DeepMutable,
  type GameState,
  type LabState,
  type RandomKey,
  type RandomOracle,
} from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

const content = scenarioContent();

function request(
  state: GameState,
  posture: "conservative" | "normal" | "yolo" = "normal",
) {
  return {
    labId: state.run.playerLabId,
    posture,
  } as const;
}

function startCommand(
  state: GameState,
  posture: "conservative" | "normal" | "yolo" = "normal",
) {
  return {
    kind: "start-training-run" as const,
    meta: {
      commandId: `command:training:${posture}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    ...request(state, posture),
  };
}

describe("training quotes", () => {
  it("exposes a clear capability-versus-reliability trade-off across postures", () => {
    const conservative = trainingPostureDefinition("conservative");
    const normal = trainingPostureDefinition("normal");
    const yolo = trainingPostureDefinition("yolo");

    // Conservative remains a proportional output trade-off. YOLO now gets its
    // upside from literal effective compute rather than multiplying the final
    // Cobb-Douglas product.
    expect(conservative.capabilityMultiplier).toBeLessThan(normal.capabilityMultiplier);
    expect(normal.capabilityMultiplier).toBe(1);
    expect(yolo.capabilityMultiplier).toBe(1);
    expect(conservative.effectiveComputeMultiplier).toBe(1);
    expect(normal.effectiveComputeMultiplier).toBe(1);
    expect(yolo.effectiveComputeMultiplier).toBe(3);

    // Success and safety stay flat, and correctly so: both land on bounded
    // scales (a probability, and a 0-100 quality), so a fixed shift is the
    // same size of decision in week 5 and week 400.
    expect(conservative.successDifficultyDelta).toBeLessThan(
      normal.successDifficultyDelta,
    );
    expect(normal.successDifficultyDelta).toBeLessThan(yolo.successDifficultyDelta);
    expect(normal.successDifficultyDelta).toBe(0);
    expect(conservative.outcomeAdjustmentRanges.trueAlignment).toEqual([4.5, 4.5]);
    expect(yolo.outcomeAdjustmentRanges.trueAlignment).toEqual([-18, -12]);
    expect(yolo.outcomeAdjustmentRanges.corrigibility).toEqual([-18, -12]);
    expect(yolo.outcomeAdjustmentRanges.situationalAwareness).toEqual([0, 0]);
    expect(yolo.outcomeAdjustmentRanges.deceptiveIntent).toEqual([12, 18]);
    expect(yolo.outcomeAdjustmentRanges.reliability).toEqual([-8, -5]);
  });

  it("keeps every posture lever in one inspectable definition", () => {
    // Posture used to point at a dataset policy and a safety protocol, which
    // between them hid nine authored fields the player never saw -- including
    // a per-attribute data-fitness vector and a "scrape everything" corpus.
    for (const posture of ["conservative", "normal", "yolo"] as const) {
      expect(Object.keys(trainingPostureDefinition(posture)).sort()).toEqual([
        "capabilityMultiplier",
        "displayName",
        "effectiveComputeMultiplier",
        "outcomeAdjustmentRanges",
        "posture",
        "successDifficultyDelta",
      ]);
    }
  });

  it("makes YOLO exactly three times as compute-effective for capability", () => {
    const physicalFlop = 2e27;
    expect(trainingScaleScore(physicalFlop, "yolo")).toBeCloseTo(
      trainingScaleScore(physicalFlop * 3, "normal"),
      10,
    );
  });

  it("moves the score-90 compute point three times right on the upper curve", () => {
    const legacyPointsPerDecade = 15.15;
    const legacyFlop =
      CAPABILITY_FLOP_FLOOR * 10 ** (UPPER_CURVE_REFERENCE_SCORE / legacyPointsPerDecade);
    const revisedFlop =
      CAPABILITY_FLOP_FLOOR *
      10 ** (UPPER_CURVE_REFERENCE_SCORE / CAPABILITY_POINTS_PER_DECADE);
    expect(revisedFlop / legacyFlop).toBeCloseTo(UPPER_CURVE_COMPUTE_SHIFT, 10);
  });

  it("names a run from what it adds up to, and reserves strongest lots first", () => {
    // 40,000 Volta-class GPUs while the world era is still Kepler. The player
    // commits FLOP/s and weeks; the band is what that gets CALLED. Kepler-era
    // GPU = 4 TFLOP/s, Volta = 28, so dense Volta lots cover a commitment with
    // far fewer physical cards.
    const state = scenario()
      .withPlayerLab((lab) => lab.cash(200).gpus("gpu.volta", 40_000))
      .build();

    // 2,000 era-GPUs for 5 weeks = 10,000 era-GPU-weeks: a Prototype.
    const small = quoteTrainingRun(state, content, {
      ...request(state),
      committedTeraflops: 8_000,
      durationWeeks: 5,
    });
    expect(small).toMatchObject({
      durationWeeks: 5,
      committedTeraflops: 8_000,
      reservedPhysicalGpus: 286,
      blockers: [],
    });

    // Same commitment held for 9 weeks crosses into Product at 18,000.
    const medium = quoteTrainingRun(state, content, {
      ...request(state),
      committedTeraflops: 8_000,
      durationWeeks: 9,
    });
    expect(medium.scale).toBe("product");
    expect(medium.reservedPhysicalGpus).toBe(286);

    // 5,000 era-GPUs for 15 weeks = 75,000: Frontier, on the nose.
    const large = quoteTrainingRun(state, content, {
      ...request(state),
      committedTeraflops: 20_000,
      durationWeeks: 15,
    });
    expect(large.scale).toBe("frontier");
    expect(large.reservedPhysicalGpus).toBe(715);
    expect(large.reservationGenerationCounts).toEqual({
      [contentId("base:gpu.volta")]: 715,
    });
  });

  it("reaches every band by holding the commitment and changing only the weeks", () => {
    // The point of the redesign: one dial moving turns a Prototype into a
    // Frontier run, because total FLOP is commitment x weeks.
    const state = scenario()
      .withPlayerLab((lab) => lab.cash(400).gpus("gpu.volta", 40_000))
      .build();
    // 8,000 TFLOP/s is 2,000 Kepler-equivalents, so the thresholds land at
    // 9 weeks (18,000) and 37.5 weeks (75,000).
    const bandAt = (durationWeeks: number) =>
      quoteTrainingRun(state, content, {
        ...request(state),
        committedTeraflops: 8_000,
        durationWeeks,
      }).scale;
    expect(bandAt(4)).toBe("prototype");
    expect(bandAt(9)).toBe("product");
    expect(bandAt(38)).toBe("frontier");
  });

  it("defaults to a high-end prototype for the current era", () => {
    const state = scenario()
      .withPlayerLab((lab) => lab.cash(200).gpus("gpu.volta", 40_000))
      .build();
    const quote = quoteTrainingRun(state, content, request(state));
    // 2,000 Kepler-equivalents, 8 weeks: a large Prototype, not the bare floor.
    expect(quote.committedTeraflops).toBe(8_000);
    expect(quote.durationWeeks).toBe(8);
    expect(quote.scale).toBe("prototype");
    expect(quote.blockers).toEqual([]);
  });

  it("lets the player commit more FLOPS than the floor", () => {
    const state = scenario()
      .withPlayerLab((lab) => lab.cash(200).gpus("gpu.volta", 40_000))
      .build();
    const sized = quoteTrainingRun(state, content, {
      ...request(state),
      committedTeraflops: 200_000,
    });
    expect(sized.committedTeraflops).toBe(200_000);
    expect(sized.reservedPhysicalGpus).toBe(Math.ceil(200_000 / 28));
    expect(sized.blockers).toEqual([]);

    const overcommitted = quoteTrainingRun(state, content, {
      ...request(state),
      committedTeraflops: 2_000_000,
    });
    expect(
      overcommitted.blockers.some((blocker) => blocker.includes("unreserved fleet")),
    ).toBe(true);
  });

  it("forecasts a capability range and compares it with the current model", () => {
    const state = scenario()
      .withBaselineModel()
      .withPlayerLab((lab) => lab.cash(200).gpus("gpu.volta", 40_000))
      .build();
    const floor = quoteTrainingRun(state, content, request(state));
    const larger = quoteTrainingRun(state, content, {
      ...request(state),
      committedTeraflops: 200_000,
    });

    expect(floor.estimatedFrontierCapabilityRange[0]).toBeLessThanOrEqual(
      floor.estimatedFrontierCapability,
    );
    expect(floor.estimatedFrontierCapability).toBeLessThanOrEqual(
      floor.estimatedFrontierCapabilityRange[1],
    );
    expect(larger.estimatedFrontierCapability).toBeGreaterThan(
      floor.estimatedFrontierCapability,
    );
    const comparison = floor.currentModelComparison;
    expect(comparison).toBeDefined();
    if (comparison === undefined) throw new Error("current model comparison missing");
    expect(comparison.modelId).toBe(
      state.labs[state.run.playerLabId]?.models.currentModelId,
    );
    expect(comparison.displayName.length).toBeGreaterThan(0);
    expect(Number.isFinite(comparison.measuredFrontierCapability)).toBe(true);
    expect(comparison.estimatedDeltaRange.every(Number.isFinite)).toBe(true);
  });

  it("bundles the old recipe choices into three legible run postures", () => {
    const state = scenario()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    const yolo = quoteTrainingRun(state, content, request(state, "yolo"));
    const conservative = quoteTrainingRun(state, content, request(state, "conservative"));

    // Posture no longer moves cash or schedule. Those came from the deleted
    // dataset/protocol multipliers, and duration is about to become a direct
    // player input rather than something a posture quietly nudges.
    expect(yolo.cashCostMillions).toBe(conservative.cashCostMillions);
    expect(yolo.durationWeeks).toBe(conservative.durationWeeks);
  });
});

describe("faster training means more compute, not less", () => {
  it("has retired the duration target that made faster training weaker", () => {
    // Total FLOP is committedTeraflops x durationWeeks and weekly throughput
    // carries no duration term, so a "Frontier training duration x0.95"
    // modifier removed 5% of a run's compute and handed back a WEAKER model --
    // while being labelled a benefit everywhere it appeared. The target is
    // gone; "faster training" is now throughput, which is unambiguously more
    // FLOP per committed week.
    const authored = JSON.stringify(content);
    expect(authored).not.toContain("lab.training.frontier.duration");
  });
});

describe("training project lifecycle", () => {
  it("trains the first model, selects it as active, and replays across save/load", () => {
    let state = scenario()
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    expect(state.labs[state.run.playerLabId]?.models).toEqual({ modelIds: [] });

    const started = applyCommand(state, content, startCommand(state));
    state = started.state;
    const projectId = state.labs[state.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");
    const frozen = state.projects[projectId];
    expect(frozen?.payload).toMatchObject({
      kind: "training",
      reservedPhysicalGpus: 2_000,
      cashCostMillions: 1.28,
      weeksElapsed: 0,
      accumulatedTeraflopWeeks: 0,
    });
    expect(state.labs[state.run.playerLabId]?.compute.reservations).toEqual([
      expect.objectContaining({ projectId, gpus: 2_000 }),
    ]);

    for (let week = 0; week < 20; week += 1) {
      state = advanceOneTick(state, content).state;
      if (state.projects[projectId]?.status !== "active") break;
    }
    const completed = state.projects[projectId];
    expect(completed?.status).toBe("completed");
    expect(completed?.payload.kind).toBe("training");
    if (completed?.payload.kind !== "training") return;
    expect(completed.payload.failureChecks.map((check) => check.checkpoint)).toEqual([
      0.35, 0.7, 1,
    ]);
    expect(completed.payload.completionReport).toBeDefined();
    expect(completed.payload.completionReport?.regressions).toEqual([]);
    expect(state.models[completed.payload.futureModelId]).toBeDefined();
    const trainedModel = state.models[completed.payload.futureModelId];
    expect(trainedModel).toMatchObject({
      generationIndex: 0,
      familyName: "GBT",
      displayName: "GBT-1",
    });
    expect(trainedModel?.evaluations).toHaveLength(1);
    expect(
      trainedModel === undefined
        ? undefined
        : state.evaluations[trainedModel.evaluations[0]!]?.definitionId,
    ).toBe(content.evaluations.baselineEvaluationId);
    expect(trainedModel?.measuredCapability?.evidenceFlags).toContain(
      "evaluation:baseline:completed",
    );
    expect(state.labs[state.run.playerLabId]?.models.modelIds).toContain(
      completed.payload.futureModelId,
    );
    expect(state.labs[state.run.playerLabId]?.models.currentModelId).toBe(
      completed.payload.futureModelId,
    );
    expect(state.labs[state.run.playerLabId]?.models.commercialModelId).toBeUndefined();
    expect(state.labs[state.run.playerLabId]?.compute.reservations).toEqual([]);
    expect(state.run.autoPauseReasons).toContain("training-complete");

    const envelope = createSaveEnvelope(state, {
      saveId: "training-golden",
      slotType: "manual",
      displayName: "Training golden",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T00:00:00.000Z",
    });
    expect(stateHash(loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state)).toBe(
      stateHash(state),
    );
  });

  it("keeps the original reservation when later fleet capacity changes", () => {
    const initial = scenario()
      .withPlayerLab((lab) => lab.cash(100).gpus("gpu.volta", 40_000))
      .build();
    const started = applyCommand(initial, content, {
      ...startCommand(initial),
      committedTeraflops: 8_000,
      durationWeeks: 9,
    }).state;
    const projectId = started.labs[started.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");
    const before = started.projects[projectId];
    if (before?.payload.kind !== "training") throw new Error("training payload missing");

    const expanded = createTransaction(started);
    expanded.update((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      const lot = lab.compute.lots[0];
      if (lot === undefined) throw new Error("GPU lot missing");
      lot.physicalCount = gpuCount(80_000);
    });
    const after = expanded.commit({ description: "expand fleet" }).state;
    const payload = after.projects[projectId]?.payload;
    expect(payload).toMatchObject({
      kind: "training",
      reservedPhysicalGpus: before.payload.reservedPhysicalGpus,
      cashCostMillions: before.payload.cashCostMillions,
    });
  });
});

class ForcedFailureOracle implements RandomOracle {
  uniform(key: RandomKey): number {
    return key.segments.includes("failure-severity") ? 0.1 : 0.99;
  }

  integer(_key: RandomKey, minInclusive: number): number {
    return minInclusive;
  }

  triangular(_key: RandomKey, _min: number, mode: number): number {
    return mode;
  }

  weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
    const first = Object.keys(weights)[0] as T | undefined;
    if (first === undefined) throw new Error("empty forced weights");
    return first;
  }

  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  }
}

describe("training failure checks", () => {
  it("loses a doomed run at whichever checkpoint it breaks on", () => {
    let state = scenario()
      .withPlayerLab((lab) => lab.cash(200).gpus("gpu.volta", 40_000))
      .build();
    // Frontier-sized, on YOLO posture, far past anything the lab has run
    // before: every checkpoint fails and the severity draw is 0.1, so this run
    // is doomed. It used to be losable ONLY at the final checkpoint -- which
    // capped total loss at 2.22% for any inputs and made a more reckless run
    // LESS likely to be lost, because it broke at an earlier checkpoint that
    // could not be fatal. Now any checkpoint can end it, weighted by how far
    // in the run had got.
    state = applyCommand(state, content, {
      ...startCommand(state),
      posture: "yolo",
      committedTeraflops: 20_000,
      durationWeeks: 30,
    }).state;
    const projectId = state.labs[state.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");
    const activated = createTransaction(state);
    activated.update((draft) => {
      const project = draft.projects[projectId];
      if (project === undefined) throw new Error("training project missing");
      project.status = "active";
      project.startedAt = draft.run.tick;
    });
    state = activated.commit({ description: "activate forced failure" }).state;

    for (let week = 0; week < 30; week += 1) {
      const tx = createTransaction(state);
      advanceTrainingProject(tx, content, projectId, new ForcedFailureOracle());
      state = tx.commit({ description: "forced training failure week" }).state;
      if (state.projects[projectId]?.status === "failed") break;
    }
    const failed = state.projects[projectId];
    expect(failed?.status).toBe("failed");
    if (failed?.payload.kind !== "training") return;
    const lost = failed.payload.failureChecks.find(
      (check) => check.outcome === "total-loss",
    );
    expect(lost).toBeDefined();
    // A run this bad breaks on the first checkpoint rather than limping to the
    // last one; the old rule would have carried it all the way to checkpoint 1.
    expect(lost?.checkpoint).toBe(0.35);
    expect(lost?.successProbability).toBeLessThanOrEqual(0.65);
    expect(state.models[failed.payload.futureModelId]).toBeUndefined();
    expect(state.labs[state.run.playerLabId]?.compute.reservations).toEqual([]);
    expect(state.run.autoPauseReasons).toContain("training-failed");
    expect(state.run.autoPauseReasons).not.toContain("training-complete");

    // A failed run sets a debugging cooldown and a recovery bonus, and blocks
    // starting a new run until the cooldown lifts.
    const failedLab = state.labs[state.run.playerLabId];
    expect(failedLab?.flags["training:next-run-recovery"]).toBe(true);
    expect(failedLab?.flags["training:failure-cooldown-until"]).toBe(
      state.run.tick + TRAINING_FAILURE_COOLDOWN_WEEKS,
    );
    const cooldownQuote = quoteTrainingRun(state, content, request(state));
    expect(cooldownQuote.blockers).toContain(
      `The team is debugging the last failed run — new training unlocks in ${String(TRAINING_FAILURE_COOLDOWN_WEEKS)} weeks`,
    );

    // Existing saves may contain the former four-week absolute deadline. The
    // recorded failure checkpoint must still enforce the new eight-week
    // minimum without requiring a save migration.
    const legacyDeadline = createTransaction(state);
    legacyDeadline.update((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.flags["training:failure-cooldown-until"] = draft.run.tick + 4;
    });
    const legacyState = legacyDeadline.commit({
      description: "restore legacy training cooldown",
    }).state;
    expect(
      quoteTrainingRun(legacyState, content, request(legacyState)).blockers,
    ).toContain(
      `The team is debugging the last failed run — new training unlocks in ${String(TRAINING_FAILURE_COOLDOWN_WEEKS)} weeks`,
    );

    const cooldownValidation = validateCommand(state, content, startCommand(state));
    expect(cooldownValidation.ok).toBe(false);
    if (!cooldownValidation.ok) {
      expect(cooldownValidation.errors).toContainEqual(
        expect.objectContaining({
          code: "training-failure-cooldown",
        }),
      );
    }

    for (let week = 1; week < TRAINING_FAILURE_COOLDOWN_WEEKS; week += 1) {
      state = advanceOneTick(state, content).state;
    }
    expect(quoteTrainingRun(state, content, request(state)).blockers).toContain(
      "The team is debugging the last failed run — new training unlocks in 1 week",
    );

    state = advanceOneTick(state, content).state;
    expect(
      quoteTrainingRun(state, content, request(state)).blockers.some((blocker) =>
        blocker.includes("debugging the last failed run"),
      ),
    ).toBe(false);
    expect(state.labs[state.run.playerLabId]?.flags["training:next-run-recovery"]).toBe(
      true,
    );
  });
});

describe("hidden safety generation", () => {
  function trainWithPosture(
    posture: "conservative" | "normal" | "yolo",
    alignmentResearchLevel?: number,
  ): GameState {
    // A YOLO opener on a starting lab has a real chance of being lost outright
    // -- correct behaviour, but it makes the comparison this test is actually
    // about impossible to run. The seed is chosen so all three postures finish.
    let state = scenario()
      .withSeed("1234567890abcdef1234567890abcdef")
      .withPlayerLab((lab) => lab.cash(100))
      .build();
    if (alignmentResearchLevel !== undefined) {
      const lab = state.labs[state.run.playerLabId] as DeepMutable<LabState> | undefined;
      if (lab === undefined) throw new Error("player lab missing");
      const alignment = lab.research.safetyPrograms["base:safety.alignment-control"];
      if (alignment === undefined) {
        throw new Error("alignment research fixture missing");
      }
      alignment.level = rating(alignmentResearchLevel);
    }
    state = applyCommand(state, content, {
      ...startCommand(state),
      posture,
    }).state;
    const projectId = state.labs[state.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");
    for (let week = 0; week < 40; week += 1) {
      state = advanceOneTick(state, content).state;
      if (state.projects[projectId]?.status === "completed") return state;
    }
    throw new Error("training did not complete");
  }

  it("generates capability and intent safety separately and rewards conservative posture", () => {
    const yolo = trainWithPosture("yolo");
    const conservative = trainWithPosture("conservative");
    const yoloModels = yolo.labs[yolo.run.playerLabId]?.models.modelIds ?? [];
    const conservativeModels =
      conservative.labs[conservative.run.playerLabId]?.models.modelIds ?? [];
    const yoloModelId = yoloModels.at(-1);
    const conservativeModelId = conservativeModels.at(-1);
    if (yoloModelId === undefined || conservativeModelId === undefined) {
      throw new Error("trained model ID missing");
    }
    const yoloModel = yolo.models[yoloModelId];
    const conservativeModel = conservative.models[conservativeModelId];
    if (yoloModel === undefined || conservativeModel === undefined) {
      throw new Error("trained model missing");
    }

    expect(Object.values(yoloModel.hiddenSafety)).toHaveLength(6);
    expect(yoloModel.hiddenSafety.generatedByRandomContract).toBe(
      yolo.randomContractVersion,
    );
    expect(conservativeModel.hiddenSafety.trueAlignment).toBeGreaterThan(
      yoloModel.hiddenSafety.trueAlignment,
    );
    expect(conservativeModel.hiddenSafety.corrigibility).toBeGreaterThan(
      yoloModel.hiddenSafety.corrigibility,
    );
    expect(conservativeModel.hiddenSafety.deceptiveIntent).toBeLessThan(
      yoloModel.hiddenSafety.deceptiveIntent,
    );
    expect(yoloModel.reliability).toBeGreaterThanOrEqual(22);
    expect(yoloModel.reliability).toBeLessThanOrEqual(25);
  });

  it("makes accumulated alignment research materially improve frontier model safety", () => {
    const openingResearch = trainWithPosture("normal", 8);
    const matureResearch = trainWithPosture("normal", 80);
    const openingModelId =
      openingResearch.labs[openingResearch.run.playerLabId]?.models.modelIds.at(-1);
    const matureModelId =
      matureResearch.labs[matureResearch.run.playerLabId]?.models.modelIds.at(-1);
    const openingModel =
      openingModelId === undefined ? undefined : openingResearch.models[openingModelId];
    const matureModel =
      matureModelId === undefined ? undefined : matureResearch.models[matureModelId];
    if (openingModel === undefined || matureModel === undefined) {
      throw new Error("trained model missing");
    }

    expect(matureModel.hiddenSafety.trueAlignment).toBeGreaterThan(
      openingModel.hiddenSafety.trueAlignment + 20,
    );
    expect(matureModel.hiddenSafety.corrigibility).toBeGreaterThan(
      openingModel.hiddenSafety.corrigibility + 20,
    );
    // Alignment lowers deceptive capability, but both runs can meet the zero
    // floor. Interpretability and Security have separate evidence/defence roles
    // and are intentionally held constant in this integration check.
    expect(matureModel.hiddenSafety.deceptiveCapability).toBeLessThanOrEqual(
      openingModel.hiddenSafety.deceptiveCapability,
    );
  });
});
