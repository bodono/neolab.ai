import { contentId } from "@neolab/content-schema";

import { RANDOM_CONTRACT_VERSION } from "../random/oracle.ts";
import { seed128 } from "../random/seed.ts";
import type { GameState, GpuLotState, LabState, ModelState } from "./state.ts";
import { calendarFromTick, ENGINE_RULES_VERSION, SAVE_VERSION } from "./state.ts";
import type { GpuLotId, LabId, ModelId, RunId } from "./ids.ts";
import { basisPoints, cashMillions, fraction, gpuCount, rating, tick } from "./units.ts";

/**
 * Hand-rolled minimal valid state for engine tests. NOT a new-game baseline —
 * `createNewGame` (S1.3) builds runs from content. The testkit's `scenario()`
 * builder (S1.8) wraps this.
 */
export function createBareState(): GameState {
  const playerLabId = "lab:player" as LabId;
  const modelId = "run:model:player:0000" as ModelId;

  const lots: GpuLotState[] = [
    {
      id: "run:gpu-lot:player:0000" as GpuLotId,
      generationId: contentId("base:gpu.kepler"),
      ownership: "owned",
      physicalCount: gpuCount(6000),
      availableFraction: fraction(1),
      reliability: rating(70),
    },
    {
      id: "run:gpu-lot:player:0001" as GpuLotId,
      generationId: contentId("base:gpu.kepler"),
      ownership: "leased",
      physicalCount: gpuCount(4000),
      availableFraction: fraction(1),
      reliability: rating(60),
    },
  ];

  const startingModel: ModelState = {
    id: modelId,
    ownerLabId: playerLabId,
    generationIndex: 0,
    familyName: "GPT",
    displayName: "GPT-0",
    trainedAt: tick(0),
    trueCapability: {
      language: rating(20),
      reasoning: rating(8),
      agency: rating(3),
      toolUse: rating(4),
      multimodality: rating(5),
      scientificAbility: rating(3),
      embodiment: rating(0),
    },
    generality: rating(5),
    productQuality: rating(12),
    reliability: rating(35),
    accessLevel: 0,
    evaluations: [],
    anomalies: [],
    hiddenSafety: {
      trueAlignment: rating(70),
      corrigibility: rating(75),
      situationalAwareness: rating(10),
      deceptiveCapability: rating(10),
      generatedByRandomContract: RANDOM_CONTRACT_VERSION,
    },
    flags: {},
  };

  const playerLab: LabState = {
    id: playerLabId,
    definitionId: contentId("base:lab.openmind"),
    control: "player",
    finance: { cash: cashMillions(18) },
    aura: { spendable: 15, lifetime: 15 },
    compute: {
      lots,
      allocation: {
        servingBasisPoints: basisPoints(4500),
        capabilityBasisPoints: basisPoints(7500),
        capabilityDomainWeights: {
          "base:domain.architectures": basisPoints(4000),
          "base:domain.optimisation": basisPoints(2500),
          "base:domain.data_representation": basisPoints(3500),
        },
        safetyProgramWeights: {
          "base:safety.alignment_control": basisPoints(5000),
          "base:safety.interpretability_evals": basisPoints(4000),
          "base:safety.security_testing": basisPoints(1000),
        },
      },
      reservations: [],
      softwareEfficiency: 1,
    },
    research: {
      domains: {
        "base:domain.architectures": { level: rating(8) },
        "base:domain.optimisation": { level: rating(6) },
        "base:domain.data_representation": { level: rating(10) },
      },
    },
    safety: {
      safetyCulture: rating(45),
      alignmentScience: rating(8),
      evalQuality: rating(10),
      controlTheory: rating(6),
      practicalControlStrength: rating(25),
      securityPosture: rating(35),
    },
    organisation: {
      engineeringQuality: rating(50),
      managementCapacity: rating(45),
      researchFreedom: rating(60),
      boardPatience: rating(70),
      hiddenInternalCandour: rating(50),
      generalResearchers: 18,
      engineersAndOps: 12,
    },
    roster: { starSlots: 3, researcherIds: [] },
    facilities: {
      instances: [
        {
          definitionId: contentId("base:facility.rented_office_1"),
          completedAt: tick(0),
        },
        {
          definitionId: contentId("base:facility.leased_compute_1"),
          completedAt: tick(0),
        },
      ],
    },
    market: { marketShare: fraction(0.005) },
    politics: {
      governmentAttention: rating(5),
      governmentTrust: rating(50),
      strategicDependence: rating(0),
      captureConcern: rating(0),
    },
    models: { currentModelId: modelId, modelIds: [modelId] },
    projects: { projectIds: [] },
    flags: {},
  };

  return {
    saveVersion: SAVE_VERSION,
    engineRulesVersion: ENGINE_RULES_VERSION,
    contentVersion: "0.2.0-draft",
    randomContractVersion: RANDOM_CONTRACT_VERSION,
    run: {
      runId: "run:0001" as RunId,
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      playerLabId,
      tick: tick(0),
      calendar: calendarFromTick(0),
      phase: "foundation",
      status: "active",
      queuedOrders: [],
      autoPauseReasons: [],
      idCounters: {
        lab: 0,
        model: 1,
        project: 0,
        event: 0,
        modifier: 0,
        "gpu-lot": 2,
        evaluation: 0,
        anomaly: 0,
        coalition: 0,
      },
    },
    world: {
      fundingClimate: rating(50),
      currentGpuGenerationId: contentId("base:gpu.kepler"),
      eventCooldowns: {},
    },
    labs: { [playerLabId]: playerLab },
    models: { [modelId]: startingModel },
    projects: {},
    eventInstances: {},
    modifiers: {},
    scheduledEffects: [],
    decisionLog: [],
    domainLog: [],
    score: { scoreVersion: "1", entries: [], awardedKeys: {} },
    endgame: { stage: "inactive" },
  };
}
