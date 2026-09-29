import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { eraReferenceTeraflops } from "../../compute/flops.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { CommandId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  CHECKPOINT_TECHNICAL_LEAD_BONUS,
  classifyTrainingRun,
  forecastTrainingIntrinsicSafety,
  quoteTrainingRun,
  TRAINING_BAND_ERA_GPU_WEEKS,
  TRAINING_DEFAULT_ERA_GPUS,
  TRAINING_DEFAULT_WEEKS,
  TRAINING_RECOVERY_PASS_PROBABILITY_BONUS,
  SUCCESSOR_TRAINING_EFFICIENCY,
  trainingCheckpointOdds,
  trainingReliabilityForecast,
  trainingRunComplexity,
} from "../training.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.thomas-hassabi"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function quote(
  state: GameState,
  overrides: {
    readonly posture?: "conservative" | "normal" | "yolo";
    readonly committedTeraflops?: number;
    readonly durationWeeks?: number;
  } = {},
) {
  return quoteTrainingRun(state, content, {
    labId: state.run.playerLabId,
    posture: overrides.posture ?? "normal",
    ...(overrides.committedTeraflops === undefined
      ? {}
      : { committedTeraflops: overrides.committedTeraflops }),
    ...(overrides.durationWeeks === undefined
      ? {}
      : { durationWeeks: overrides.durationWeeks }),
  });
}

function committedTeraflopsForEraGpuWeeks(
  state: GameState,
  eraGpuWeeks: number,
  durationWeeks: number,
): number {
  const eraGpuTeraflops =
    eraReferenceTeraflops(state, content) / content.training.eraReferencePhysicalGpus;
  return (eraGpuWeeks / durationWeeks) * eraGpuTeraflops;
}

describe("the training technical lead", () => {
  it("puts the best training engineer on every run and credits their skill", () => {
    const base = newState();
    expect(quote(base).technicalLead).toBeUndefined();

    const draft = structuredClone(base) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const researcher = Object.values(draft.researchers).find(
      (candidate) =>
        (content.researchers.definitions[candidate.definitionId]?.skills["training"] ??
          0) === 5,
    );
    if (lab === undefined || researcher === undefined) {
      throw new Error("training-lead fixture missing");
    }
    researcher.status = "employed";
    researcher.employerLabId = lab.id;
    lab.roster.researcherIds.push(researcher.id);
    const led = quote(draft);
    expect(led.technicalLead).toMatchObject({
      researcherId: researcher.id,
      trainingSkill: 5,
      checkpointBonus: CHECKPOINT_TECHNICAL_LEAD_BONUS,
    });
    expect(led.reliability.passProbability).toBeGreaterThan(
      quote(base).reliability.passProbability,
    );
  });
});

describe("the training reliability forecast", () => {
  it("leaves the verified-retirement efficiency grant unused by Prototype runs", () => {
    const eligible = structuredClone(newState()) as DeepMutable<GameState>;
    eligible.endgameHistory.verifiedCandidateRetirementCount = 1;
    const eligibleLab = eligible.labs[eligible.run.playerLabId];
    if (eligibleLab === undefined) throw new Error("Player lab missing");
    eligibleLab.flags["endgame:successor-efficiency-rate"] =
      SUCCESSOR_TRAINING_EFFICIENCY;

    const prototype = quote(eligible, { durationWeeks: 4 });
    expect(prototype.scale).toBe("prototype");
    expect(prototype.successorEfficiencyApplied).toBe(false);
    expect(prototype.successorEfficiencyRate).toBe(0);
    expect(prototype.durationWeeks).toBe(prototype.unassistedDurationWeeks);

    const started = applyCommand(eligible, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:prototype-preserves-successor-efficiency" as CommandId,
        expectedTick: eligible.run.tick,
        issuedBy: "player",
      },
      labId: eligible.run.playerLabId,
      posture: "normal",
      durationWeeks: 4,
    }).state;
    expect(started.endgameHistory.successorEfficiencyGrantConsumed).toBe(false);
    expect(
      started.labs[started.run.playerLabId]?.flags["endgame:successor-efficiency-rate"],
    ).toBe(SUCCESSOR_TRAINING_EFFICIENCY);
    const projectId = started.labs[started.run.playerLabId]?.projects.projectIds[0];
    const project = projectId === undefined ? undefined : started.projects[projectId];
    expect(project?.payload).toMatchObject({ kind: "training", scale: "prototype" });
    expect(project?.payload).not.toHaveProperty("successorEfficiencyApplied");
  });

  it("spends the verified-retirement efficiency grant on the next Product run without changing planned compute", () => {
    const baseline = newState();
    const ordinary = quote(baseline, { durationWeeks: 25 });
    const eligible = structuredClone(baseline) as DeepMutable<GameState>;
    eligible.endgameHistory.verifiedCandidateRetirementCount = 1;
    const eligibleLab = eligible.labs[eligible.run.playerLabId];
    if (eligibleLab === undefined) throw new Error("Player lab missing");
    eligibleLab.flags["endgame:successor-efficiency-rate"] =
      SUCCESSOR_TRAINING_EFFICIENCY;

    const assisted = quote(eligible, { durationWeeks: 25 });
    expect(ordinary.scale).toBe("product");
    expect(assisted.scale).toBe("product");
    expect(assisted.successorEfficiencyApplied).toBe(true);
    expect(assisted.successorEfficiencyRate).toBe(SUCCESSOR_TRAINING_EFFICIENCY);
    expect(assisted.unassistedDurationWeeks).toBe(25);
    expect(assisted.durationWeeks).toBe(
      Math.round(25 * (1 - SUCCESSOR_TRAINING_EFFICIENCY)),
    );
    expect(assisted.estimatedTotalFlop).toBeCloseTo(ordinary.estimatedTotalFlop);
    expect(assisted.cashCostMillions).toBeCloseTo(
      ordinary.cashCostMillions * (1 - SUCCESSOR_TRAINING_EFFICIENCY),
      2,
    );

    const started = applyCommand(eligible, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:successor-efficiency" as CommandId,
        expectedTick: eligible.run.tick,
        issuedBy: "player",
      },
      labId: eligible.run.playerLabId,
      posture: "normal",
      durationWeeks: 25,
    }).state;
    expect(started.endgameHistory.successorEfficiencyGrantConsumed).toBe(true);
    expect(
      started.labs[started.run.playerLabId]?.flags["endgame:successor-efficiency-rate"],
    ).toBeUndefined();
    const projectId = started.labs[started.run.playerLabId]?.projects.projectIds[0];
    const project = projectId === undefined ? undefined : started.projects[projectId];
    expect(project?.payload).toMatchObject({
      kind: "training",
      successorEfficiencyApplied: true,
    });
    expect(quote(started, { durationWeeks: 25 }).successorEfficiencyApplied).toBe(false);
  });

  it("applies the filtered-note four-percent successor benefit without rounding it up", () => {
    const eligible = structuredClone(newState()) as DeepMutable<GameState>;
    eligible.endgameHistory.verifiedCandidateRetirementCount = 1;
    const lab = eligible.labs[eligible.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.flags["endgame:successor-efficiency-rate"] = 0.04;

    const assisted = quote(eligible, { durationWeeks: 25 });
    expect(assisted.successorEfficiencyApplied).toBe(true);
    expect(assisted.successorEfficiencyRate).toBe(0.04);
    expect(assisted.durationWeeks).toBe(24);
  });

  it("interpolates complexity continuously between the authored anchors", () => {
    const complexity = (eraGpuWeeks: number) =>
      trainingRunComplexity(eraGpuWeeks, content.training.scales);
    const openingAnchor = TRAINING_DEFAULT_ERA_GPUS * TRAINING_DEFAULT_WEEKS;

    expect(complexity(1_000)).toBe(content.training.scales.prototype.complexity);
    expect(complexity(openingAnchor)).toBe(content.training.scales.prototype.complexity);
    expect(complexity(17_000)).toBeCloseTo(20, 10);
    expect(complexity(TRAINING_BAND_ERA_GPU_WEEKS.product)).toBe(
      content.training.scales.product.complexity,
    );
    expect(complexity(46_500)).toBeCloseTo(38, 10);
    expect(complexity(TRAINING_BAND_ERA_GPU_WEEKS.frontier)).toBe(
      content.training.scales.frontier.complexity,
    );
    expect(complexity(100_000)).toBe(content.training.scales.frontier.complexity);

    const samples = [
      1_000,
      openingAnchor,
      17_000,
      18_000,
      30_000,
      46_500,
      60_000,
      75_000,
      100_000,
    ].map(complexity);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] ?? 0);
    }
  });

  it("changes the run label without a reliability cliff at either boundary", () => {
    const state = newState();
    const boundaries = [
      {
        eraGpuWeeks: TRAINING_BAND_ERA_GPU_WEEKS.product,
        durationWeeks: 10,
        belowLabel: "prototype",
        aboveLabel: "product",
      },
      {
        eraGpuWeeks: TRAINING_BAND_ERA_GPU_WEEKS.frontier,
        durationWeeks: 75,
        belowLabel: "product",
        aboveLabel: "frontier",
      },
    ] as const;

    for (const boundary of boundaries) {
      const belowEraGpuWeeks = boundary.eraGpuWeeks - 1;
      const aboveEraGpuWeeks = boundary.eraGpuWeeks + 1;
      expect(classifyTrainingRun(belowEraGpuWeeks)).toBe(boundary.belowLabel);
      expect(classifyTrainingRun(aboveEraGpuWeeks)).toBe(boundary.aboveLabel);

      const below = quote(state, {
        durationWeeks: boundary.durationWeeks,
        committedTeraflops: committedTeraflopsForEraGpuWeeks(
          state,
          belowEraGpuWeeks,
          boundary.durationWeeks,
        ),
      });
      const above = quote(state, {
        durationWeeks: boundary.durationWeeks,
        committedTeraflops: committedTeraflopsForEraGpuWeeks(
          state,
          aboveEraGpuWeeks,
          boundary.durationWeeks,
        ),
      });

      expect(below.scale).toBe(boundary.belowLabel);
      expect(above.scale).toBe(boundary.aboveLabel);
      expect(above.reliability.passProbability).toBeLessThanOrEqual(
        below.reliability.passProbability,
      );
      expect(
        Math.abs(above.reliability.passProbability - below.reliability.passProbability),
      ).toBeLessThan(0.001);
      expect(above.reliability.totalLoss).toBeGreaterThanOrEqual(
        below.reliability.totalLoss,
      );
    }
  });

  it("is a complete, normalised set of outcomes", () => {
    const { reliability } = quote(newState());
    expect(
      reliability.cleanRun + reliability.setback + reliability.totalLoss,
    ).toBeCloseTo(1, 10);
    for (const value of [
      reliability.cleanRun,
      reliability.setback,
      reliability.totalLoss,
      reliability.passProbability,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("keeps non-fatal setback paths exposed to later total-loss checks", () => {
    const reliability = trainingReliabilityForecast([0.35, 0.7, 1], {
      strength: 0,
      difficulty: 0,
      passProbability: 0.5,
    });

    expect(reliability.cleanRun).toBeCloseTo(0.125, 10);
    expect(reliability.setback).toBeCloseTo(0.728431015625, 10);
    expect(reliability.totalLoss).toBeCloseTo(0.146568984375, 10);
    expect(
      reliability.cleanRun + reliability.setback + reliability.totalLoss,
    ).toBeCloseTo(1, 10);
  });

  it("caps post-failure recovery at ten percentage points per checkpoint", () => {
    const ordinary = trainingCheckpointOdds({
      // Strength 50.5 versus difficulty 42.027... gives a 70% ordinary pass.
      complexity: 37.027021,
      postureDifficultyDelta: 0,
      interruption: 0,
      reliability: 100,
      technicalLeadBonus: 0,
      risk: {
        stretchDifficulty: 0,
        durationDifficulty: 0,
        experienceStrength: 0,
        capabilityStrength: 0,
      },
      hazardMultiplier: 1,
      recoveryActive: false,
    });
    const recovery = trainingCheckpointOdds({
      complexity: 37.027021,
      postureDifficultyDelta: 0,
      interruption: 0,
      reliability: 100,
      technicalLeadBonus: 0,
      risk: {
        stretchDifficulty: 0,
        durationDifficulty: 0,
        experienceStrength: 0,
        capabilityStrength: 0,
      },
      hazardMultiplier: 1,
      recoveryActive: true,
    });
    const ordinaryRun = trainingReliabilityForecast(
      content.training.failureCheckpoints,
      ordinary,
    );
    const recoveryRun = trainingReliabilityForecast(
      content.training.failureCheckpoints,
      recovery,
    );

    expect(ordinary.passProbability).toBeCloseTo(0.7, 5);
    expect(recovery.passProbability).toBeCloseTo(
      ordinary.passProbability + TRAINING_RECOVERY_PASS_PROBABILITY_BONUS,
      10,
    );
    expect(ordinaryRun.cleanRun).toBeCloseTo(0.343, 4);
    expect(recoveryRun.cleanRun).toBeCloseTo(0.512, 4);

    const alreadyExcellent = trainingCheckpointOdds({
      complexity: 0,
      postureDifficultyDelta: -12,
      interruption: 0,
      reliability: 100,
      technicalLeadBonus: CHECKPOINT_TECHNICAL_LEAD_BONUS,
      risk: {
        stretchDifficulty: 0,
        durationDifficulty: 0,
        experienceStrength: 2,
        capabilityStrength: 10,
      },
      hazardMultiplier: 1,
      recoveryActive: true,
    });
    expect(alreadyExcellent.passProbability).toBe(0.95);
  });

  it("matches the probability the simulation actually rolls against", () => {
    // The forecast and the check share trainingCheckpointOdds, so the number
    // shown in the dialog has to be the number the run is resolved against.
    // Interruption is the one input a forecast cannot know, so this fixture
    // keeps the fleet fully fed, which is exactly what the dialog claims.
    const state = newState();
    const forecast = quote(state, { durationWeeks: 8 });
    const started = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:reliability" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      posture: "normal",
      durationWeeks: 8,
    }).state;
    const projectId = started.labs[started.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");

    let current: GameState = started;
    for (let week = 0; week < 20; week += 1) {
      current = advanceOneTick(current, content).state;
      const project = current.projects[projectId];
      if (project?.payload.kind !== "training") continue;
      const check = project.payload.failureChecks[0];
      if (check !== undefined) {
        expect(check.successProbability).toBeCloseTo(
          forecast.reliability.passProbability,
          6,
        );
        return;
      }
      if (project.status === "completed" || project.status === "failed") break;
    }
    throw new Error("no checkpoint was resolved");
  });

  it("uses the recovery-adjusted forecast for the live checkpoint roll", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.flags["training:next-run-recovery"] = true;

    const forecast = quote(state, { durationWeeks: 8 });
    const started = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:recovery-reliability" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      posture: "normal",
      durationWeeks: 8,
    }).state;
    const projectId = started.labs[started.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");

    let current: GameState = started;
    for (let week = 0; week < 20; week += 1) {
      current = advanceOneTick(current, content).state;
      const project = current.projects[projectId];
      if (project?.payload.kind !== "training") continue;
      const check = project.payload.failureChecks[0];
      if (check !== undefined) {
        expect(check.successProbability).toBeCloseTo(
          forecast.reliability.passProbability,
          6,
        );
        return;
      }
      if (project.status === "completed" || project.status === "failed") break;
    }
    throw new Error("no recovery checkpoint was resolved");
  });

  it("matches the simulation at an interpolated Product complexity", () => {
    const state = newState();
    const durationWeeks = 31;
    const committedTeraflops = committedTeraflopsForEraGpuWeeks(
      state,
      46_500,
      durationWeeks,
    );
    const forecast = quote(state, { durationWeeks, committedTeraflops });
    const started = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:interpolated-reliability" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      posture: "normal",
      durationWeeks,
      committedTeraflops,
    }).state;
    const projectId = started.labs[started.run.playerLabId]?.projects.projectIds[0];
    if (projectId === undefined) throw new Error("training project missing");

    let current: GameState = started;
    for (let week = 0; week < durationWeeks; week += 1) {
      current = advanceOneTick(current, content).state;
      const project = current.projects[projectId];
      if (project?.payload.kind !== "training") continue;
      const check = project.payload.failureChecks[0];
      if (check !== undefined) {
        expect(check.successProbability).toBeCloseTo(
          forecast.reliability.passProbability,
          6,
        );
        return;
      }
      if (project.status === "completed" || project.status === "failed") break;
    }
    throw new Error("no checkpoint was resolved");
  });

  it("shows YOLO costing reliability and conservative buying it", () => {
    const state = newState();
    const conservative = quote(state, { posture: "conservative" }).reliability;
    const normal = quote(state, { posture: "normal" }).reliability;
    const yolo = quote(state, { posture: "yolo" }).reliability;

    expect(conservative.cleanRun).toBeGreaterThan(normal.cleanRun);
    expect(normal.cleanRun).toBeGreaterThan(yolo.cleanRun);
    expect(yolo.totalLoss).toBeGreaterThan(normal.totalLoss);
    expect(normal.totalLoss).toBeGreaterThan(conservative.totalLoss);
  });

  it("shows a longer run as a less reliable one", () => {
    const state = newState();
    const short = quote(state, { durationWeeks: 8 }).reliability;
    const long = quote(state, { durationWeeks: 52 }).reliability;
    expect(long.cleanRun).toBeLessThan(short.cleanRun);
    expect(long.totalLoss).toBeGreaterThan(short.totalLoss);
  });

  it("keeps an ordinary opening run overwhelmingly survivable", () => {
    // The readout has to reassure as well as warn, or players will read every
    // run as a coin flip.
    const { reliability } = quote(newState());
    expect(reliability.totalLoss).toBeLessThan(0.02);
    expect(reliability.cleanRun).toBeGreaterThan(0.5);
  });
});

describe("the pre-training intrinsic safety forecast", () => {
  const fixedCapabilityForecast = { low: 48, expected: 52, high: 56 } as const;

  it("shows Alignment and Control as the primary intrinsic-safety input", () => {
    const low = structuredClone(newState()) as DeepMutable<GameState>;
    const high = structuredClone(low);
    const lowProgramme =
      low.labs[low.run.playerLabId]?.research.safetyPrograms[
        "base:safety.alignment-control"
      ];
    const highProgramme =
      high.labs[high.run.playerLabId]?.research.safetyPrograms[
        "base:safety.alignment-control"
      ];
    if (lowProgramme === undefined || highProgramme === undefined) {
      throw new Error("alignment research fixture missing");
    }
    lowProgramme.level = rating(0);
    highProgramme.level = rating(100);

    const lowForecast = forecastTrainingIntrinsicSafety(
      low,
      low.run.playerLabId,
      "normal",
      fixedCapabilityForecast,
    );
    const highForecast = forecastTrainingIntrinsicSafety(
      high,
      high.run.playerLabId,
      "normal",
      fixedCapabilityForecast,
    );

    expect(highForecast.alignment[0]).toBeGreaterThan(lowForecast.alignment[0]);
    expect(highForecast.corrigibility[0]).toBeGreaterThan(lowForecast.corrigibility[0]);
    expect(highForecast.deceptiveIntent[1]).toBeLessThan(lowForecast.deceptiveIntent[1]);
    expect(highForecast.situationalAwareness).toEqual(lowForecast.situationalAwareness);
  });

  it("lets Interpretability narrow uncertainty without moving its centre", () => {
    const low = structuredClone(newState()) as DeepMutable<GameState>;
    const high = structuredClone(low);
    const lowProgramme =
      low.labs[low.run.playerLabId]?.research.safetyPrograms[
        "base:safety.interpretability-evals"
      ];
    const highProgramme =
      high.labs[high.run.playerLabId]?.research.safetyPrograms[
        "base:safety.interpretability-evals"
      ];
    if (lowProgramme === undefined || highProgramme === undefined) {
      throw new Error("interpretability research fixture missing");
    }
    lowProgramme.level = rating(0);
    highProgramme.level = rating(100);

    const lowForecast = forecastTrainingIntrinsicSafety(
      low,
      low.run.playerLabId,
      "normal",
      fixedCapabilityForecast,
    );
    const highForecast = forecastTrainingIntrinsicSafety(
      high,
      high.run.playerLabId,
      "normal",
      fixedCapabilityForecast,
    );
    const targets = [
      "alignment",
      "corrigibility",
      "deceptiveIntent",
      "situationalAwareness",
    ] as const;
    for (const target of targets) {
      const lowRange = lowForecast[target];
      const highRange = highForecast[target];
      expect(highRange[1] - highRange[0]).toBeLessThan(lowRange[1] - lowRange[0]);
      expect((highRange[0] + highRange[1]) / 2).toBeCloseTo(
        (lowRange[0] + lowRange[1]) / 2,
        0,
      );
    }
  });

  it("makes YOLO's intrinsic-safety penalty visible in the live quote", () => {
    const state = newState();
    const normal = quote(state, { posture: "normal" }).intrinsicSafetyForecast;
    const yolo = quote(state, { posture: "yolo" }).intrinsicSafetyForecast;

    expect(yolo.alignment[1]).toBeLessThan(normal.alignment[1]);
    expect(yolo.corrigibility[1]).toBeLessThan(normal.corrigibility[1]);
    expect(yolo.deceptiveIntent[1]).toBeGreaterThan(normal.deceptiveIntent[1]);
  });

  it("keeps Security and Containment out of the intrinsic forecast", () => {
    const low = structuredClone(newState()) as DeepMutable<GameState>;
    const high = structuredClone(low);
    const lowProgramme =
      low.labs[low.run.playerLabId]?.research.safetyPrograms[
        "base:safety.security-containment"
      ];
    const highProgramme =
      high.labs[high.run.playerLabId]?.research.safetyPrograms[
        "base:safety.security-containment"
      ];
    if (lowProgramme === undefined || highProgramme === undefined) {
      throw new Error("security research fixture missing");
    }
    lowProgramme.level = rating(0);
    highProgramme.level = rating(100);

    expect(
      forecastTrainingIntrinsicSafety(
        high,
        high.run.playerLabId,
        "normal",
        fixedCapabilityForecast,
      ),
    ).toEqual(
      forecastTrainingIntrinsicSafety(
        low,
        low.run.playerLabId,
        "normal",
        fixedCapabilityForecast,
      ),
    );
  });
});

describe("modifier scope in training quotes", () => {
  it("does not lend the player's training safeguards to a rival lab", () => {
    const state = newState();
    const rivalId = Object.keys(state.labs).find((id) => id !== state.run.playerLabId);
    if (rivalId === undefined) throw new Error("rival fixture missing");
    const rivalQuote = (candidate: GameState) =>
      quoteTrainingRun(candidate, content, {
        labId: rivalId as GameState["run"]["playerLabId"],
        posture: "normal",
      });
    const before = rivalQuote(state);
    const withPlayerSafeguard = structuredClone(state) as DeepMutable<GameState>;
    const modifierId = "modifier:test-player-hazard" as keyof GameState["modifiers"];
    withPlayerSafeguard.modifiers[modifierId] = {
      id: modifierId,
      source: { kind: "facility", id: "test-facility" },
      labId: state.run.playerLabId,
      target: "lab.training.technicalFailureHazard",
      operation: "multiply",
      value: 0.8,
      startsAt: state.run.tick,
      tags: [],
    };
    const after = rivalQuote(withPlayerSafeguard);

    expect(after.reliability.passProbability).toBe(before.reliability.passProbability);
    expect(quote(withPlayerSafeguard).reliability.passProbability).toBeGreaterThan(
      quote(state).reliability.passProbability,
    );
  });
});

describe("reserved-GPU reliability in the forecast", () => {
  it("ignores lots the run would not reserve, as the checkpoint check does", () => {
    const base = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = base.labs[base.run.playerLabId];
    const template = lab?.compute.lots[0];
    if (lab === undefined || template === undefined)
      throw new Error("fleet fixture missing");
    const hopper = {
      ...structuredClone(template),
      id: "lot:test:hopper" as typeof template.id,
      generationId: contentId("base:gpu.hopper"),
      physicalCount: 4000 as typeof template.physicalCount,
      availableFraction: 1 as typeof template.availableFraction,
      reliability: rating(88),
    };
    lab.compute.lots = [hopper];
    const hopperOnly = structuredClone(base) as GameState;
    lab.compute.lots = [
      hopper,
      {
        ...structuredClone(hopper),
        id: "lot:test:kepler" as typeof template.id,
        generationId: contentId("base:gpu.kepler"),
        reliability: rating(62),
      },
    ];
    const mixed = structuredClone(base) as GameState;
    // A run small enough for the Hopper lot alone reserves no Kepler GPUs.
    const committedTeraflops = quote(hopperOnly).availableTeraflops / 4;
    const hopperQuote = quote(hopperOnly, { committedTeraflops });
    const mixedQuote = quote(mixed, { committedTeraflops });
    expect(Object.keys(mixedQuote.reservationGenerationCounts)).toEqual([
      "base:gpu.hopper",
    ]);
    expect(mixedQuote.reliability.passProbability).toBeCloseTo(
      hopperQuote.reliability.passProbability,
      10,
    );
  });
});
