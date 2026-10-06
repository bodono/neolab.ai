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
  CHECKPOINT_TECHNICAL_LEAD_BONUS,
  TRAINING_REFERENCE_WEEKS,
  effectiveCapabilityResearch,
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
  it("needs research 100 for Frontier Capability 100, even with unlimited compute", () => {
    const formula = content.training.capabilityFormula;
    expect(formula.researchEffectivenessMultiplier).toBe(1.18);
    expect(formula.researchEffectivenessTaperStart).toBe(60);
    expect(formula.researchEffectivenessAtMaximum).toBe(1);
    const expectedAt = (researchLevel: number): number => {
      const state = stateWithUniformCapabilityResearch(researchLevel);
      return forecastTrainingFrontierCapability(
        state,
        content,
        state.run.playerLabId,
        "normal",
        Number.MAX_VALUE,
      ).expected;
    };

    // Level 80 clears the candidate gate (88) but is far from certain to be
    // genuine; every level above it still raises the odds, up to 100.
    expect(expectedAt(80)).toBe(92.1);
    expect(expectedAt(90)).toBe(96.4);
    expect(expectedAt(100)).toBe(100);
  });

  it("leaves research below the taper exactly as boosted as before", () => {
    const formula = content.training.capabilityFormula;
    expect(effectiveCapabilityResearch(50, formula)).toBeCloseTo(59, 10);
    expect(effectiveCapabilityResearch(60, formula)).toBeCloseTo(70.8, 10);
    expect(effectiveCapabilityResearch(80, formula)).toBeCloseTo(87.2, 10);
    expect(effectiveCapabilityResearch(100, formula)).toBeCloseTo(100, 10);
  });

  it("makes a sensibly scaled 800k-Rubin run a viable candidacy attempt at research 87", () => {
    const state = stateWithUniformCapabilityResearch(87);
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
        technicalLeadBonus: CHECKPOINT_TECHNICAL_LEAD_BONUS,
        risk,
        hazardMultiplier: 1,
        recoveryActive: false,
      }),
    );

    expect(forecast.expected).toBe(88.4);
    expect(reliability.totalLoss).toBeLessThan(0.01);
    expect(reliability.cleanRun).toBeGreaterThan(0.69);
    expect(reliability.cleanRun + reliability.setback).toBeGreaterThan(0.99);
  });

  it("rewards every research level up to 100 on a full Kolmogorov run", () => {
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

    expect(expectedAt(80)).toBe(91.1);
    expect(expectedAt(90)).toBe(95.4);
    expect(expectedAt(100)).toBe(98.9);
  });
});
