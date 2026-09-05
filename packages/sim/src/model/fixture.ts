import {
  contentId,
  type CompiledContent,
  type DeploymentPolicy,
} from "@neolab/content-schema";

import { RANDOM_CONTRACT_VERSION } from "../random/oracle.ts";
import { seed128 } from "../random/seed.ts";
import type { GameState, GpuLotState, LabState, ModelState } from "./state.ts";
import {
  calendarFromTick,
  ENGINE_RULES_VERSION,
  formatRunEntityId,
  SAVE_VERSION,
} from "./state.ts";
import type {
  FacilityId,
  GpuLotId,
  LabId,
  ModelId,
  ModelLineageId,
  RunId,
} from "./ids.ts";
import { settledServingPhysicalGpus } from "../market/market.ts";
import { basisPoints, cashMillions, fraction, gpuCount, rating, tick } from "./units.ts";
import { createCapabilityEstimate } from "../models/capability.ts";

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
    lineageId: modelId as unknown as ModelLineageId,
    ownerLabId: playerLabId,
    generationIndex: 0,
    familyName: "GBT",
    displayName: "GBT-0",
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
    measuredCapability: createCapabilityEstimate(
      {
        language: rating(20),
        reasoning: rating(8),
        agency: rating(3),
        toolUse: rating(4),
        multimodality: rating(5),
        scientificAbility: rating(3),
        embodiment: rating(0),
      },
      { confidence: "high", evidenceFlags: ["starting-model-baseline"] },
    ),
    productQuality: rating(12),
    reliability: rating(35),
    accessLevel: 0,
    deployment: {
      policy: "guarded-api",
      exposure: 0.35,
      irreversible: false,
      exposureMultiplier: 1,
      incidentDeploymentFactor: 1,
      productisationRuns: { normal: 1, hardened: 0, rush: 0 },
      evidencePenalty: 0,
      changedAt: tick(0),
    },
    evaluations: [],
    anomalies: [],
    hiddenSafety: {
      trueAlignment: rating(70),
      corrigibility: rating(75),
      situationalAwareness: rating(10),
      deceptiveCapability: rating(10),
      deceptiveIntent: rating(10),
      generatedByRandomContract: RANDOM_CONTRACT_VERSION,
    },
    flags: {},
  };

  const playerLab: LabState = {
    id: playerLabId,
    definitionId: contentId("base:lab.openmind"),
    control: "player",
    finance: {
      cash: cashMillions(18),
      ledger: [],
      settlements: [],
      consecutiveNegativeCashWeeks: 0,
    },
    aura: { spendable: 15, lifetime: 15, ledger: [] },
    compute: {
      servingPhysicalGpus: gpuCount(0),
      lots,
      allocation: {
        servingFleetShareBasisPoints: basisPoints(4500),
        capabilityBasisPoints: basisPoints(7500),
        capabilityDomainWeights: {
          "base:domain.architectures": basisPoints(6000),
          "base:domain.optimisation-scaling": basisPoints(4000),
        },
        safetyProgramWeights: {
          "base:safety.alignment-control": basisPoints(5000),
          "base:safety.interpretability-evals": basisPoints(4000),
          "base:safety.security-containment": basisPoints(1000),
        },
      },
      reservations: [],
      deliveries: [],
    },
    research: {
      domains: {
        "base:domain.architectures": {
          level: rating(8),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:domain.optimisation-scaling": {
          level: rating(6),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:domain.reinforcement-agency": {
          level: rating(0),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:domain.multimodality": {
          level: rating(0),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:domain.reasoning-tools": {
          level: rating(0),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:domain.robotics-embodiment": {
          level: rating(0),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:domain.scientific-ai": {
          level: rating(0),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
      },
      safetyPrograms: {
        "base:safety.alignment-control": {
          level: rating(8),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:safety.interpretability-evals": {
          level: rating(10),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
        "base:safety.security-containment": {
          level: rating(6),
          levelProgressRp: 0,
          totalResearchPoints: 0,
          weeklyMomentum: 0,
        },
      },
      pendingGenericAdvances: [],
      genericAdvances: {},
      paperProgress: {},
      discoveredPaperIds: [],
      diffusionKnowledge: {},
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
      boardPatience: rating(70),
      hiddenInternalCandour: rating(50),
      generalResearchers: 18,
      engineersAndOps: 12,
    },
    roster: { starSlots: 3, researcherIds: [] },
    facilities: {
      instances: [
        {
          id: "run:facility:player:0000" as FacilityId,
          definitionId: contentId("base:facility.rented_office_1"),
          completedAt: tick(0),
          majorProjectSlotBonus: 0,
          modifierIds: [],
        },
        {
          id: "run:facility:player:0001" as FacilityId,
          definitionId: contentId("base:facility.leased_compute_1"),
          completedAt: tick(0),
          majorProjectSlotBonus: 0,
          modifierIds: [],
        },
      ],
    },
    market: {
      marketShare: fraction(0.005),
      priceTier: "market",
      priceChangeTicks: [],
      monetisationEfficiency: fraction(0.55),
      weeksAccruedThisCycle: 0,
      segments: {},
    },
    autonomy: { escalations: [], undetectedPressure: 0 },
    politics: {
      governmentAttention: rating(5),
      governmentTrust: rating(50),
      strategicDependence: rating(0),
      programmes: [],
      captureConcern: rating(0),
      quarterlyAssessments: [],
      interventions: [],
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
        facility: 2,
        "gpu-lot": 2,
        evaluation: 0,
        anomaly: 0,
        scheduled: 0,
        coalition: 0,
        promise: 0,
        people: 0,
        "funding-offer": 0,
        "government-action": 0,
      },
    },
    world: {
      currentGpuGenerationId: contentId("base:gpu.kepler"),
      eventCooldowns: {},
      paperRace: {
        labOrder: [playerLabId, "lab:rival-paper"],
        discoveries: {},
        rival: {
          labId: "lab:rival-paper",
          displayName: "Deep Thought",
          domainLevels: {
            "base:domain.architectures": rating(25),
            "base:domain.optimisation-scaling": rating(25),
            "base:domain.reinforcement-agency": rating(25),
            "base:domain.multimodality": rating(25),
            "base:domain.reasoning-tools": rating(25),
            "base:domain.robotics-embodiment": rating(25),
            "base:domain.scientific-ai": rating(25),
          },
          paperProgress: {},
          discoveredPaperIds: [],
          diffusionKnowledge: {},
        },
      },
      rivals: {},
      rivalSignals: [],
      rivalComponentAnnouncements: [],
      rivalCrisisStageAnnouncements: [],
      coalitions: {},
    },
    labs: { [playerLabId]: playerLab },
    models: { [modelId]: startingModel },
    lineageSIRecords: {},
    endgameHistory: {
      qualifiedLineageCount: 0,
      verifiedCandidateRetirementCount: 0,
      successorEfficiencyGrantConsumed: false,
      cumulativeCandidateInterventionPressure: 0,
      falseDawnMoratoriumHistory: [],
      relationshipPracticeLedger: [],
      candidateRetirementHistory: [],
      candidateContainmentHistory: [],
    },
    researchers: {},
    talentMarket: {
      refreshIndex: 0,
      lastRefreshedAt: tick(0),
      nextRefreshAt: tick(13),
      visibleResearcherIds: [],
    },
    fundraising: {
      offers: {},
      offerOrder: [],
      cooldownUntil: {},
      obligations: [],
    },
    projects: {},
    evaluations: {},
    anomalies: {},
    incidents: [],
    eventInstances: {},
    decisionMemories: [],
    modifiers: {},
    scheduledEffects: [],
    decisionLog: [],
    domainLog: [],
    score: { scoreVersion: "1", entries: [], awardedKeys: {} },
    presentationQueue: [],
    endgame: { stage: "inactive" },
  };
}

/**
 * Opt-in compatibility fixture for tests that exercise post-training systems.
 * Production new games intentionally start with an empty model portfolio.
 */
export function addBaselineModelForTest(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId = state.run.playerLabId,
  options: {
    readonly deploymentPolicy?: DeploymentPolicy;
    readonly servingFleetShareBasisPoints?: number;
  } = {},
): GameState {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Test model lab ${labId} is missing`);
  if (lab.models.modelIds.length > 0) {
    throw new Error(`Test model lab ${labId} already has a model`);
  }
  const counter = state.run.idCounters.model;
  const owner = lab.control === "player" ? "player" : `rival-test-${String(counter)}`;
  const modelId = formatRunEntityId("model", owner, counter) as ModelId;
  const familyName = content.labs[lab.definitionId]?.aiFamily ?? "Test AI";
  const deploymentPolicy = options.deploymentPolicy ?? "guarded-api";
  const commercial =
    deploymentPolicy !== "internal-only" && deploymentPolicy !== "weights-release";
  const configuredProductQuality = lab.flags["model:first-product-quality"];
  const model: ModelState = {
    id: modelId,
    lineageId: modelId as unknown as ModelLineageId,
    ownerLabId: labId,
    generationIndex: 0,
    familyName,
    displayName: `${familyName}-0`,
    trainedAt: state.run.tick,
    trueCapability: {
      language: rating(20),
      reasoning: rating(8),
      agency: rating(3),
      toolUse: rating(4),
      multimodality: rating(5),
      scientificAbility: rating(3),
      embodiment: rating(0),
    },
    measuredCapability: createCapabilityEstimate(
      {
        language: rating(20),
        reasoning: rating(8),
        agency: rating(3),
        toolUse: rating(4),
        multimodality: rating(5),
        scientificAbility: rating(3),
        embodiment: rating(0),
      },
      { confidence: "high", evidenceFlags: ["test-model-baseline"] },
    ),
    productQuality: rating(
      typeof configuredProductQuality === "number" ? configuredProductQuality : 12,
    ),
    reliability: rating(35),
    accessLevel: 0,
    deployment: {
      policy: deploymentPolicy,
      exposure: content.deployment.policies[deploymentPolicy].exposure,
      irreversible: deploymentPolicy === "weights-release",
      exposureMultiplier: 1,
      incidentDeploymentFactor: 1,
      productisationRuns: { normal: 1, hardened: 0, rush: 0 },
      evidencePenalty: 0,
      changedAt: state.run.tick,
    },
    evaluations: [],
    anomalies: [],
    hiddenSafety: {
      trueAlignment: rating(70),
      corrigibility: rating(75),
      situationalAwareness: rating(10),
      deceptiveCapability: rating(10),
      deceptiveIntent: rating(10),
      generatedByRandomContract: RANDOM_CONTRACT_VERSION,
    },
    flags: commercial ? { "deployment:public-launch:aura-awarded": true } : {},
  };
  const deployed: GameState = {
    ...state,
    run: {
      ...state.run,
      idCounters: { ...state.run.idCounters, model: counter + 1 },
    },
    labs: {
      ...state.labs,
      [labId]: {
        ...lab,
        compute: {
          ...lab.compute,
          allocation: {
            ...lab.compute.allocation,
            servingFleetShareBasisPoints: basisPoints(
              options.servingFleetShareBasisPoints ?? 4500,
            ),
          },
        },
        models: {
          currentModelId: modelId,
          ...(commercial ? { commercialModelId: modelId } : {}),
          modelIds: [modelId],
        },
      },
    },
    models: { ...state.models, [modelId]: model },
  };
  // Deploying a model creates the demand this lab's serving grant is drawn
  // against, so settle it here rather than leaving the fixture a tick behind.
  const settledLab = deployed.labs[labId];
  if (settledLab === undefined) throw new Error(`Test model lab ${labId} vanished`);
  return {
    ...deployed,
    labs: {
      ...deployed.labs,
      [labId]: {
        ...settledLab,
        compute: {
          ...settledLab.compute,
          servingPhysicalGpus: gpuCount(
            settledServingPhysicalGpus(deployed, content, labId),
          ),
        },
      },
    },
  };
}

/** Adds one opt-in baseline model to every empty lab in stable lab order. */
export function addBaselineModelsForTest(
  state: Readonly<GameState>,
  content: CompiledContent,
): GameState {
  let next = state as GameState;
  for (const labId of Object.keys(state.labs).sort() as LabId[]) {
    if ((next.labs[labId]?.models.modelIds.length ?? 0) === 0) {
      next = addBaselineModelForTest(next, content, labId);
    }
  }
  return next;
}
