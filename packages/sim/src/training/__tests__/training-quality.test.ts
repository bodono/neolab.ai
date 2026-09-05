import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { CommandId, ModelId, ProjectId } from "../../model/ids.ts";
import type {
  GameState,
  ModelState,
  ProjectPayload,
  ProjectState,
} from "../../model/state.ts";
import { cashMillions, rating } from "../../model/units.ts";
import type { RandomKey } from "../../random/key.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { projectTrainingLossTelemetry } from "../loss-curve.ts";
import {
  trainingQualityCapabilityAdjustment,
  trainingQualitySignal,
} from "../training-quality.ts";
import {
  calculateFrontierCapability,
  CAPABILITY_ATTRIBUTES,
} from "../../models/capability.ts";
import { completeTrainingRun, TRAINING_FAILURE_COOLDOWN_WEEKS } from "../training.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

type MutableTrainingProject = DeepMutable<ProjectState> & {
  payload: DeepMutable<Extract<ProjectPayload, { kind: "training" }>>;
};

class ControlledTrainingOracle implements RandomOracle {
  private readonly qualityScore: number;
  private readonly capabilityNoise: number;

  constructor(qualityScore: number, capabilityNoise = 0) {
    this.qualityScore = qualityScore;
    this.capabilityNoise = capabilityNoise;
  }

  uniform(): number {
    return 0.5;
  }

  integer(_key: RandomKey, minimum: number): number {
    return minimum;
  }

  triangular(key: RandomKey, _minimum: number, mode: number, _maximum: number): number {
    if (key.segments[0] === "training-quality-v1") return this.qualityScore;
    if (key.segments[0] === "training" && key.segments[2] === "capability") {
      return this.capabilityNoise;
    }
    return mode;
  }

  weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
    const candidate = (Object.keys(weights) as T[]).find(
      (key) => (weights[key] ?? 0) > 0,
    );
    if (candidate === undefined) throw new Error("test oracle received no candidate");
    return candidate;
  }

  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  }
}

class HiddenSafetyTailOracle extends ControlledTrainingOracle {
  private readonly tail: "lower" | "upper";

  constructor(tail: "lower" | "upper") {
    super(1);
    this.tail = tail;
  }

  override triangular(
    key: RandomKey,
    minimum: number,
    mode: number,
    maximum: number,
  ): number {
    if (key.segments[0] === "training" && key.segments[2] === "hidden-safety") {
      return this.tail === "lower" ? minimum : maximum;
    }
    return super.triangular(key, minimum, mode, maximum);
  }
}

function readyTrainingState(): {
  readonly state: GameState;
  readonly projectId: ProjectId;
  readonly futureModelId: ModelId;
} {
  const initial = addBaselineModelForTest(
    createNewGame(
      {
        seed: seed128("abcdef0123456789abcdef0123456789"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
  const lab = initial.labs[initial.run.playerLabId];
  if (lab?.models.currentModelId === undefined) {
    throw new Error("training-quality fixture is missing its parent model");
  }
  const started = applyCommand(initial, content, {
    kind: "start-training-run",
    meta: {
      commandId: "command:test-training-quality" as CommandId,
      expectedTick: initial.run.tick,
      issuedBy: "player",
    },
    labId: initial.run.playerLabId,
    parentModelId: lab.models.currentModelId,
    durationWeeks: 5,
    posture: "normal",
  }).state;
  const state = structuredClone(started) as DeepMutable<GameState>;
  const project = state.labs[state.run.playerLabId]?.projects.projectIds
    .map((projectId) => state.projects[projectId])
    .find((candidate) => candidate?.payload.kind === "training");
  if (project?.payload.kind !== "training") {
    throw new Error("training-quality fixture is missing its project");
  }
  const trainingProject = project as MutableTrainingProject;
  trainingProject.status = "active";
  trainingProject.progress = 1;
  trainingProject.payload.weeksElapsed = trainingProject.expectedDurationWeeks;
  trainingProject.payload.accumulatedTeraflopWeeks =
    trainingProject.payload.committedTeraflops * trainingProject.expectedDurationWeeks;
  trainingProject.payload.failureChecks = [
    {
      checkpoint: 1,
      checkedAt: state.run.tick,
      successProbability: 1,
      draw: 0,
      outcome: "none",
      delayWeeks: 0,
      extraCostMillions: cashMillions(0),
      capabilityPenalty: 0,
    },
  ];
  return {
    state,
    projectId: trainingProject.id,
    futureModelId: trainingProject.payload.futureModelId,
  };
}

function completedModel(
  state: GameState,
  projectId: ProjectId,
  futureModelId: ModelId,
  oracle: RandomOracle,
): Readonly<ModelState> {
  const tx = createTransaction(state);
  completeTrainingRun(tx, content, projectId, oracle);
  const model = tx.read().models[futureModelId];
  if (model === undefined) throw new Error("training completion produced no model");
  return model;
}

describe("shared training quality", () => {
  it("caps the progressive opening prototype below Frontier Capability 5", () => {
    const { state, projectId, futureModelId } = readyTrainingState();
    const mutableState = state as DeepMutable<GameState>;
    const lab = mutableState.labs[state.run.playerLabId];
    const project = mutableState.projects[projectId];
    if (lab === undefined || project?.payload.kind !== "training") {
      throw new Error("opening prototype fixture missing");
    }
    lab.flags["campaign:progressive"] = true;
    lab.flags["campaign:lab-maturity-stage"] = "cluster";
    project.payload.campaignMaturityStageAtAuthorisation = "cluster";

    const model = completedModel(
      mutableState,
      projectId,
      futureModelId,
      new ControlledTrainingOracle(1, 12),
    );

    expect(
      Math.max(
        ...CAPABILITY_ATTRIBUTES.map((attribute) => model.trueCapability[attribute]),
      ),
    ).toBe(4.9);
    expect(calculateFrontierCapability(model.trueCapability)).toBeLessThan(5);
    expect(model.measuredCapability?.frontierCapability).toBeLessThan(5);
    expect(model.flags["campaign:training-authorised-stage"]).toBe("cluster");
  });

  it("advances the visible family name after a synthetic endgame candidate", () => {
    const { state, projectId, futureModelId } = readyTrainingState();
    const mutableState = state as DeepMutable<GameState>;
    const lab = mutableState.labs[state.run.playerLabId];
    const predecessorId = lab?.models.currentModelId;
    const predecessor =
      predecessorId === undefined ? undefined : mutableState.models[predecessorId];
    if (predecessor === undefined) throw new Error("endgame candidate fixture missing");
    predecessor.generationIndex = 7;
    predecessor.familyName = "Aquarius";
    predecessor.displayName = "Aquarius-7";

    const successor = completedModel(
      mutableState,
      projectId,
      futureModelId,
      new ControlledTrainingOracle(1),
    );

    expect(successor.generationIndex).toBe(8);
    expect(successor.displayName).toBe("Aquarius-8");
  });

  it("does not let an already-running success shorten a failure cooldown", () => {
    const { state, projectId } = readyTrainingState();
    const mutableState = state as DeepMutable<GameState>;
    const lab = mutableState.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("training cooldown fixture missing");
    const cooldownUntil = state.run.tick + TRAINING_FAILURE_COOLDOWN_WEEKS;
    lab.flags["training:failure-cooldown-until"] = cooldownUntil;
    lab.flags["training:next-run-recovery"] = true;

    const tx = createTransaction(state);
    completeTrainingRun(tx, content, projectId, new ControlledTrainingOracle(1));
    tx.update((draft) => {
      const project = draft.projects[projectId];
      if (project === undefined) throw new Error("training project missing");
      project.status = "completed";
      project.progress = 1;
    });
    const result = tx.commit({ description: "complete parallel training" }).state;

    expect(
      result.labs[result.run.playerLabId]?.flags["training:failure-cooldown-until"],
    ).toBe(cooldownUntil);
    expect(result.labs[result.run.playerLabId]?.flags["training:next-run-recovery"]).toBe(
      true,
    );
  });

  it("revokes predecessor autonomy when a successor becomes current", () => {
    const { state, projectId, futureModelId } = readyTrainingState();
    const mutableState = state as DeepMutable<GameState>;
    const lab = mutableState.labs[state.run.playerLabId];
    const predecessorId = lab?.models.currentModelId;
    const predecessor =
      predecessorId === undefined ? undefined : mutableState.models[predecessorId];
    if (lab === undefined || predecessor === undefined) {
      throw new Error("training succession fixture missing");
    }
    predecessor.accessLevel = 5;
    lab.autonomy.undetectedPressure = 2;

    const tx = createTransaction(state);
    completeTrainingRun(tx, content, projectId, new ControlledTrainingOracle(1));
    tx.update((draft) => {
      const project = draft.projects[projectId];
      if (project === undefined) throw new Error("training project missing");
      project.status = "completed";
      project.progress = 1;
    });
    const result = tx.commit({ description: "complete successor training" }).state;

    expect(result.models[predecessor.id]?.accessLevel).toBe(0);
    expect(result.models[futureModelId]?.accessLevel).toBe(0);
    expect(result.labs[result.run.playerLabId]?.models.currentModelId).toBe(
      futureModelId,
    );
    expect(result.labs[result.run.playerLabId]?.autonomy.undetectedPressure).toBe(0);
  });

  it("makes lower final perplexity predict stronger language and reasoning", () => {
    const { state, projectId, futureModelId } = readyTrainingState();
    const lowQualityOracle = new ControlledTrainingOracle(-1);
    const highQualityOracle = new ControlledTrainingOracle(1);
    const lowCurve = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
      lowQualityOracle,
    ).curves[0];
    const highCurve = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
      highQualityOracle,
    ).curves[0];
    if (
      lowCurve?.latestPerplexity === undefined ||
      highCurve?.latestPerplexity === undefined
    ) {
      throw new Error("training-quality fixture produced no loss endpoint");
    }
    const lowModel = completedModel(state, projectId, futureModelId, lowQualityOracle);
    const highModel = completedModel(state, projectId, futureModelId, highQualityOracle);

    expect(highCurve.latestPerplexity).toBeLessThan(lowCurve.latestPerplexity);
    expect(highModel.trueCapability.language).toBeGreaterThan(
      lowModel.trueCapability.language,
    );
    expect(highModel.trueCapability.reasoning).toBeGreaterThan(
      lowModel.trueCapability.reasoning,
    );
    expect(highModel.trueCapability.agency).toBe(lowModel.trueCapability.agency);
    expect(highModel.trueCapability.toolUse).toBe(lowModel.trueCapability.toolUse);
  });

  it("retains independent outcome uncertainty at the same plotted perplexity", () => {
    const { state, projectId, futureModelId } = readyTrainingState();
    const unluckyOutcomeOracle = new ControlledTrainingOracle(0.5, -4);
    const luckyOutcomeOracle = new ControlledTrainingOracle(0.5, 4);
    const unluckyCurve = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
      unluckyOutcomeOracle,
    );
    const luckyCurve = projectTrainingLossTelemetry(
      state,
      content,
      state.run.playerLabId,
      luckyOutcomeOracle,
    );
    const unluckyModel = completedModel(
      state,
      projectId,
      futureModelId,
      unluckyOutcomeOracle,
    );
    const luckyModel = completedModel(
      state,
      projectId,
      futureModelId,
      luckyOutcomeOracle,
    );

    expect(luckyCurve).toEqual(unluckyCurve);
    expect(luckyModel.trueCapability.language).toBeGreaterThan(
      unluckyModel.trueCapability.language,
    );
    expect(luckyModel.trueCapability.reasoning).toBeGreaterThan(
      unluckyModel.trueCapability.reasoning,
    );
  });

  it("has no direct capability contribution outside the intended attributes", () => {
    const oracle = new ControlledTrainingOracle(1);
    const modelId = "run:model:player:quality-contract" as ModelId;
    const quality = trainingQualitySignal(oracle, modelId);

    expect(quality.score).toBe(1);
    expect(quality.perplexityFloorMultiplier).toBeLessThan(1);
    expect(trainingQualityCapabilityAdjustment(quality.score, "language")).toBe(4);
    expect(trainingQualityCapabilityAdjustment(quality.score, "reasoning")).toBe(2.5);
    expect(trainingQualityCapabilityAdjustment(quality.score, "agency")).toBe(0);
    expect(trainingQualityCapabilityAdjustment(quality.score, "toolUse")).toBe(0);
    expect(trainingQualityCapabilityAdjustment(quality.score, "embodiment")).toBe(0);
  });

  it("does not let safety investment alter the loss curve", () => {
    const { state } = readyTrainingState();
    const saferState = structuredClone(state) as DeepMutable<GameState>;
    const lab = saferState.labs[saferState.run.playerLabId];
    if (lab === undefined) throw new Error("player lab fixture missing");
    lab.safety.safetyCulture = rating(100);
    lab.safety.alignmentScience = rating(100);
    lab.safety.controlTheory = rating(100);
    const alignment = lab.research.safetyPrograms["base:safety.alignment-control"];
    const interpretability =
      lab.research.safetyPrograms["base:safety.interpretability-evals"];
    const containment = lab.research.safetyPrograms["base:safety.security-containment"];
    if (
      alignment === undefined ||
      interpretability === undefined ||
      containment === undefined
    ) {
      throw new Error("safety programme fixture missing");
    }
    alignment.level = rating(100);
    interpretability.level = rating(100);
    containment.level = rating(100);

    expect(
      projectTrainingLossTelemetry(saferState, content, saferState.run.playerLabId),
    ).toEqual(projectTrainingLossTelemetry(state, content, state.run.playerLabId));
  });

  it("keeps Security and Containment out of intrinsic model safety", () => {
    const low = readyTrainingState();
    const highState = structuredClone(low.state) as DeepMutable<GameState>;
    const lowLab = low.state.labs[low.state.run.playerLabId];
    const highLab = highState.labs[highState.run.playerLabId];
    const lowSecurity =
      lowLab?.research.safetyPrograms["base:safety.security-containment"];
    const highSecurity =
      highLab?.research.safetyPrograms["base:safety.security-containment"];
    if (lowSecurity === undefined || highSecurity === undefined) {
      throw new Error("security research fixture missing");
    }
    (lowSecurity as DeepMutable<typeof lowSecurity>).level = rating(0);
    highSecurity.level = rating(100);

    const lowModel = completedModel(
      low.state,
      low.projectId,
      low.futureModelId,
      new HiddenSafetyTailOracle("lower"),
    );
    const highModel = completedModel(
      highState,
      low.projectId,
      low.futureModelId,
      new HiddenSafetyTailOracle("lower"),
    );
    expect(highModel.hiddenSafety).toEqual(lowModel.hiddenSafety);
  });

  it("makes Alignment and Control the primary intrinsic-safety programme", () => {
    const low = readyTrainingState();
    const highState = structuredClone(low.state) as DeepMutable<GameState>;
    const lowLab = low.state.labs[low.state.run.playerLabId];
    const highLab = highState.labs[highState.run.playerLabId];
    const lowAlignment = lowLab?.research.safetyPrograms["base:safety.alignment-control"];
    const highAlignment =
      highLab?.research.safetyPrograms["base:safety.alignment-control"];
    if (lowAlignment === undefined || highAlignment === undefined) {
      throw new Error("alignment research fixture missing");
    }
    (lowAlignment as DeepMutable<typeof lowAlignment>).level = rating(0);
    highAlignment.level = rating(100);
    const oracle = new ControlledTrainingOracle(1);
    const lowModel = completedModel(low.state, low.projectId, low.futureModelId, oracle);
    const highModel = completedModel(highState, low.projectId, low.futureModelId, oracle);

    expect(highModel.hiddenSafety.trueAlignment).toBeGreaterThan(
      lowModel.hiddenSafety.trueAlignment,
    );
    expect(highModel.hiddenSafety.corrigibility).toBeGreaterThan(
      lowModel.hiddenSafety.corrigibility,
    );
    expect(highModel.hiddenSafety.deceptiveCapability).toBe(
      lowModel.hiddenSafety.deceptiveCapability,
    );
    expect(highModel.hiddenSafety.deceptiveIntent).toBeLessThan(
      lowModel.hiddenSafety.deceptiveIntent,
    );
    expect(highModel.hiddenSafety.situationalAwareness).toBe(
      lowModel.hiddenSafety.situationalAwareness,
    );
  });

  it("uses Interpretability to narrow training-time safety surprises without shifting the mean", () => {
    const low = readyTrainingState();
    const highState = structuredClone(low.state) as DeepMutable<GameState>;
    const lowLab = low.state.labs[low.state.run.playerLabId];
    const highLab = highState.labs[highState.run.playerLabId];
    const lowInterpretability =
      lowLab?.research.safetyPrograms["base:safety.interpretability-evals"];
    const highInterpretability =
      highLab?.research.safetyPrograms["base:safety.interpretability-evals"];
    if (lowInterpretability === undefined || highInterpretability === undefined) {
      throw new Error("interpretability research fixture missing");
    }
    (lowInterpretability as DeepMutable<typeof lowInterpretability>).level = rating(0);
    highInterpretability.level = rating(100);

    const lowModel = completedModel(
      low.state,
      low.projectId,
      low.futureModelId,
      new HiddenSafetyTailOracle("lower"),
    );
    const highModel = completedModel(
      highState,
      low.projectId,
      low.futureModelId,
      new HiddenSafetyTailOracle("lower"),
    );
    const centreState = structuredClone(low.state) as DeepMutable<GameState>;
    const centreModel = completedModel(
      centreState,
      low.projectId,
      low.futureModelId,
      new ControlledTrainingOracle(1),
    );
    const targets = [
      "trueAlignment",
      "corrigibility",
      "situationalAwareness",
      "deceptiveCapability",
      "deceptiveIntent",
    ] as const;
    let lowDistance = 0;
    let highDistance = 0;
    for (const target of targets) {
      const lowTargetDistance = Math.abs(
        lowModel.hiddenSafety[target] - centreModel.hiddenSafety[target],
      );
      const highTargetDistance = Math.abs(
        highModel.hiddenSafety[target] - centreModel.hiddenSafety[target],
      );
      expect(highTargetDistance).toBeLessThanOrEqual(lowTargetDistance);
      lowDistance += lowTargetDistance;
      highDistance += highTargetDistance;
    }
    expect(highDistance).toBeLessThan(lowDistance);
  });
});

/**
 * A finished run tells you what you built. Capability used to be measured --
 * absent until an evaluation produced a noisy reading -- which meant a model
 * sat at tier 0 until the player paid to learn what they already owned, and
 * left the tier ladder gated on evidence rather than on the thing itself.
 * Only safety is bought with evaluations now.
 */
describe("capability is known exactly when training finishes", () => {
  it("hands back a measured capability identical to the truth, before any evaluation", () => {
    const { state, projectId, futureModelId } = readyTrainingState();
    const model = completedModel(
      state,
      projectId,
      futureModelId,
      new ControlledTrainingOracle(1),
    );

    const evidence = model.measuredCapability;
    if (evidence === undefined) throw new Error("a trained model must know itself");
    // A free baseline evaluation resolves as part of completion, which is
    // precisely what used to inject noise here. Capability must come through it
    // untouched -- the evaluation is buying safety evidence and nothing else.
    expect(model.evaluations).toHaveLength(1);
    expect(evidence.values).toEqual(model.trueCapability);
    expect(evidence.confidence).toBe("high");
    expect(evidence.frontierCapability).toBeCloseTo(
      calculateFrontierCapability(model.trueCapability),
      5,
    );
  });
});
