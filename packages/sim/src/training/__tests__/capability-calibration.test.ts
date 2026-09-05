import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { generationTeraflopsPerGpu, totalFlopInvested } from "../../compute/flops.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  TRAINING_REFERENCE_WEEKS,
  forecastTrainingFrontierCapability,
  trainingCheckpointOdds,
  trainingEraGpuWeeks,
  trainingReliabilityForecast,
  trainingRiskAdjustment,
  trainingRunComplexity,
} from "../training.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function stateWithUniformCapabilityResearch(level: number): GameState {
  const state = structuredClone(
    createNewGame(
      {
        seed: seed128("fedcba9876543210fedcba9876543210"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Capability calibration fixture has no lab");
  for (const domain of Object.values(lab.research.domains)) {
    domain.level = rating(level);
  }
  return state;
}

function runFlop(generationId: string, physicalGpus: number, weeks: number): number {
  const generation = content.gpuGenerations[generationId];
  if (generation === undefined) throw new Error(`Unknown test GPU ${generationId}`);
  return totalFlopInvested(generationTeraflopsPerGpu(generation) * physicalGpus, weeks);
}

describe("capability research effectiveness calibration", () => {
  it("keeps broadly level-80 research valuable beyond practical candidacy", () => {
    expect(content.training.capabilityFormula.researchEffectivenessMultiplier).toBe(1.18);
    const state = stateWithUniformCapabilityResearch(80);
    const forecast = forecastTrainingFrontierCapability(
      state,
      content,
      state.run.playerLabId,
      "normal",
      Number.MAX_VALUE,
    );

    expect(forecast.expected).toBe(96.6);
  });

  it("makes a sensibly scaled 800k-Rubin run a viable candidacy attempt at research 80", () => {
    const state = stateWithUniformCapabilityResearch(80);
    const totalFlop = runFlop("base:gpu.rubin", 800_000, 26);
    const forecast = forecastTrainingFrontierCapability(
      state,
      content,
      state.run.playerLabId,
      "normal",
      totalFlop,
    );
    const rubin = content.gpuGenerations["base:gpu.rubin"];
    if (rubin === undefined) throw new Error("Rubin calibration fixture missing");
    const risk = trainingRiskAdjustment(
      {
        completedRuns: 12,
        bestRunFlop: totalFlop / 2,
        bestCapability: 80,
      },
      totalFlop,
      26,
      runFlop(
        "base:gpu.rubin",
        content.training.eraReferencePhysicalGpus,
        TRAINING_REFERENCE_WEEKS,
      ),
    );
    const eraGpuWeeks = trainingEraGpuWeeks(
      generationTeraflopsPerGpu(rubin) * 800_000,
      26,
      generationTeraflopsPerGpu(rubin),
    );
    const reliability = trainingReliabilityForecast(
      content.training.failureCheckpoints,
      trainingCheckpointOdds({
        complexity: trainingRunComplexity(eraGpuWeeks, content.training.scales),
        postureDifficultyDelta: 0,
        interruption: 0,
        reliability: rubin.reliability,
        hasTechnicalLead: true,
        risk,
        hazardMultiplier: 1,
        recoveryActive: false,
      }),
    );

    expect(forecast.expected).toBe(89.8);
    expect(reliability.totalLoss).toBeLessThan(0.01);
    expect(reliability.cleanRun).toBeGreaterThan(0.69);
    expect(reliability.cleanRun + reliability.setback).toBeGreaterThan(0.99);
  });

  it("preserves substantial late research value on a full Kolmogorov run", () => {
    const totalFlop = runFlop("base:gpu.kolmogorov", 2_500_000, 26);
    const expectedAt = (researchLevel: number): number => {
      const state = stateWithUniformCapabilityResearch(researchLevel);
      return forecastTrainingFrontierCapability(
        state,
        content,
        state.run.playerLabId,
        "normal",
        totalFlop,
      ).expected;
    };

    expect(expectedAt(80)).toBe(95.6);
    expect(expectedAt(90)).toBe(100);
    expect(expectedAt(100)).toBe(100);
  });
});
