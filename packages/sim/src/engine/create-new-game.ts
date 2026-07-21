import type {
  AuthoredEffect,
  CompiledContent,
  ContentId,
  LeaderDefinition,
  NewGameBalance,
} from "@neolab/content-schema";

import type { GpuLotId, LabId, ModelId, ModifierId, RunId } from "../model/ids.ts";
import { validateGameState } from "../model/schema.ts";
import {
  calendarFromTick,
  ENGINE_RULES_VERSION,
  formatRunEntityId,
  SAVE_VERSION,
  type EffectSource,
  type GameState,
  type LabState,
  type ModelState,
  type ModifierState,
} from "../model/state.ts";
import {
  basisPoints,
  cashMillions,
  fraction,
  gpuCount,
  rating,
  tick,
} from "../model/units.ts";
import { RANDOM_CONTRACT_VERSION } from "../random/oracle.ts";
import { isModifierTarget } from "./modifier-targets.ts";
import { deepFreeze } from "./transaction.ts";
import type { Seed128 } from "../random/seed.ts";

/** New-game configuration (TDD section 21.5). */
export interface NewGameConfig {
  readonly seed: Seed128;
  readonly difficultyId: ContentId;
  readonly leaderId: ContentId;
  readonly mandateId: ContentId;
}

const PLAYER_LAB_ID = "lab:player" as LabId;

/**
 * Closed mapping from `.starting` effect targets to baseline state writes.
 * An unknown starting target is a content error, never a silent no-op.
 */
type StartingApply = (draft: MutableDraft, op: AuthoredEffect) => void;

interface MutableDraft {
  cash: number;
  auraSpendable: number;
  auraLifetime: number;
  gpuScale: number;
  modelProductQuality: number;
  ratings: Record<string, number>;
  domains: Record<string, number>;
  flags: Record<string, string | number | boolean>;
}

function applyOp(current: number, effect: AuthoredEffect): number {
  switch (effect.operation) {
    case "add":
      return current + effect.value;
    case "multiply":
      return current * effect.value;
    case "min":
      return Math.min(current, effect.value);
    case "max":
      return Math.max(current, effect.value);
  }
}

const ratingTarget =
  (key: string): StartingApply =>
  (draft, effect) => {
    draft.ratings[key] = applyOp(draft.ratings[key] ?? 0, effect);
  };

const domainTarget =
  (domainId: string): StartingApply =>
  (draft, effect) => {
    draft.domains[domainId] = applyOp(draft.domains[domainId] ?? 0, effect);
  };

const STARTING_TARGETS: Readonly<Record<string, StartingApply>> = {
  "lab.culture.researchFreedom.starting": ratingTarget("researchFreedom"),
  "lab.culture.safety.starting": ratingTarget("safetyCulture"),
  "lab.culture.internalCandour.starting": ratingTarget("internalCandour"),
  "lab.evals.quality.starting": ratingTarget("evalQuality"),
  "lab.engineering.quality.starting": ratingTarget("engineeringQuality"),
  "lab.board.patience.starting": ratingTarget("boardPatience"),
  "lab.politics.governmentAttention.starting": ratingTarget("governmentAttention"),
  "lab.politics.governmentTrust.starting": ratingTarget("governmentTrust"),
  "lab.aura.spendable.starting": (draft, effect) => {
    draft.auraSpendable = applyOp(draft.auraSpendable, effect);
  },
  "lab.finance.cash.starting": (draft, effect) => {
    draft.cash = applyOp(draft.cash, effect);
  },
  // Value is percent of the baseline physical fleet (draft data predates the
  // GPU migration): min 90 means "start with 90% of the baseline GPUs".
  "lab.compute.raw.starting": (draft, effect) => {
    draft.gpuScale = applyOp(draft.gpuScale * 100, effect) / 100;
  },
  "lab.model.productQuality.starting": (draft, effect) => {
    draft.modelProductQuality = applyOp(draft.modelProductQuality, effect);
  },
  "lab.research.scientific.startingLevel": domainTarget("base:domain.scientific-ai"),
  "lab.research.robotics.startingLevel": domainTarget("base:domain.robotics-embodiment"),
  "lab.research.optimisation.startingLevel": domainTarget(
    "base:domain.optimisation-scaling",
  ),
};

/** One-time grants recorded as lab flags rather than persistent modifiers. */
const GRANT_TARGETS: ReadonlySet<string> = new Set([
  "lab.contracts.starterContract",
  "lab.paper.extraCandidatesRevealed",
]);

interface EffectApplication {
  readonly draft: MutableDraft;
  readonly modifiers: ModifierState[];
  nextModifierIndex: number;
}

function applyAuthoredEffects(
  application: EffectApplication,
  effects: readonly AuthoredEffect[],
  source: EffectSource,
): void {
  for (const effect of effects) {
    const startingApply = STARTING_TARGETS[effect.target];
    if (startingApply !== undefined) {
      startingApply(application.draft, effect);
      continue;
    }
    if (GRANT_TARGETS.has(effect.target)) {
      application.draft.flags[effect.target] = applyOp(
        typeof application.draft.flags[effect.target] === "number"
          ? (application.draft.flags[effect.target] as number)
          : 0,
        effect,
      );
      continue;
    }
    if (!isModifierTarget(effect.target)) {
      throw new Error(
        `Unknown effect target "${effect.target}" from ${source.kind}:${source.id ?? "?"}`,
      );
    }
    const id = `run:modifier:setup:${String(application.nextModifierIndex).padStart(4, "0")}`;
    application.nextModifierIndex += 1;
    application.modifiers.push({
      id: id as ModifierId,
      source,
      target: effect.target,
      operation: effect.operation,
      value: effect.value,
      startsAt: tick(0),
      // Authored activation conditions ride along so conditional bonuses
      // (GDD 29.7) stay conditional; the resolver evaluates them per tick.
      ...(effect.activation === undefined ? {} : { activation: effect.activation }),
      tags: [],
    });
  }
}

function buildDraft(balance: NewGameBalance): MutableDraft {
  return {
    cash: balance.cash,
    auraSpendable: balance.auraSpendable,
    auraLifetime: balance.auraLifetime,
    gpuScale: 1,
    modelProductQuality: balance.startingModel.productQuality,
    ratings: { ...balance.ratings },
    domains: { ...balance.domains },
    flags: {},
  };
}

function requireNumber(
  record: Readonly<Record<string, number>>,
  key: string,
  where: string,
): number {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`Missing "${key}" in ${where}`);
  }
  return value;
}

export function createNewGame(
  config: NewGameConfig,
  content: CompiledContent,
): GameState {
  const leader: LeaderDefinition | undefined = content.leaders[config.leaderId];
  if (leader === undefined) {
    throw new Error(`Unknown leader ${config.leaderId}`);
  }
  const lab = content.labs[leader.labId];
  if (lab === undefined) {
    throw new Error(`Leader ${leader.id} references unknown lab ${leader.labId}`);
  }
  const difficulty = content.difficulties[config.difficultyId];
  if (difficulty === undefined) {
    throw new Error(`Unknown difficulty ${config.difficultyId}`);
  }
  const mandate = content.mandates[config.mandateId];
  if (mandate === undefined) {
    throw new Error(`Unknown mandate ${config.mandateId}`);
  }
  const balance = content.balance.newGame;

  // Application order (TDD section 21.5): baseline -> lab modifiers ->
  // leader bonus -> difficulty -> mandate -> seeded world generation.
  const application: EffectApplication = {
    draft: buildDraft(balance),
    modifiers: [],
    nextModifierIndex: 0,
  };
  for (const group of leader.labModifiers) {
    applyAuthoredEffects(application, group.effects, {
      kind: "leader",
      id: `${leader.id}/${group.id}`,
    });
  }
  applyAuthoredEffects(application, leader.headlineBonus.effects, {
    kind: "leader",
    id: `${leader.id}/${leader.headlineBonus.id}`,
  });
  const difficultyEffects: AuthoredEffect[] = [];
  if (difficulty.revenueMultiplier !== 1) {
    difficultyEffects.push({
      target: "lab.revenue.all",
      operation: "multiply",
      value: difficulty.revenueMultiplier,
    });
  }
  if (difficulty.fixedCostMultiplier !== 1) {
    difficultyEffects.push({
      target: "lab.costs.fixed",
      operation: "multiply",
      value: difficulty.fixedCostMultiplier,
    });
  }
  if (difficulty.rivalProgressMultiplier !== 1) {
    difficultyEffects.push({
      target: "world.rival.progress",
      operation: "multiply",
      value: difficulty.rivalProgressMultiplier,
    });
  }
  if (difficulty.incidentPressureMultiplier !== 1) {
    difficultyEffects.push({
      target: "lab.incident.hazard",
      operation: "multiply",
      value: difficulty.incidentPressureMultiplier,
    });
  }
  if (difficulty.displayedEstimateQualityBonus !== 0) {
    difficultyEffects.push({
      target: "lab.evidence.displayedQuality",
      operation: "add",
      value: difficulty.displayedEstimateQualityBonus,
    });
  }
  applyAuthoredEffects(application, difficultyEffects, {
    kind: "system",
    id: `difficulty:${difficulty.id}`,
  });
  applyAuthoredEffects(application, mandate.effects, {
    kind: "system",
    id: `mandate:${mandate.id}`,
  });

  const draft = application.draft;
  // Lifetime Aura can never sit below spendable Aura (GDD section 38.1).
  draft.auraLifetime = Math.max(draft.auraLifetime, draft.auraSpendable);

  const modelId = formatRunEntityId("model", "player", 0) as ModelId;
  const startingModel: ModelState = {
    id: modelId,
    ownerLabId: PLAYER_LAB_ID,
    generationIndex: balance.startingModel.familyGenerationIndex,
    familyName: leader.aiFamily,
    displayName: `${leader.aiFamily}-${String(balance.startingModel.familyGenerationIndex)}`,
    trainedAt: tick(0),
    trueCapability: {
      language: rating(
        requireNumber(
          balance.startingModel.capability,
          "language",
          "startingModel.capability",
        ),
      ),
      reasoning: rating(
        requireNumber(
          balance.startingModel.capability,
          "reasoning",
          "startingModel.capability",
        ),
      ),
      agency: rating(
        requireNumber(
          balance.startingModel.capability,
          "agency",
          "startingModel.capability",
        ),
      ),
      toolUse: rating(
        requireNumber(
          balance.startingModel.capability,
          "toolUse",
          "startingModel.capability",
        ),
      ),
      multimodality: rating(
        requireNumber(
          balance.startingModel.capability,
          "multimodality",
          "startingModel.capability",
        ),
      ),
      scientificAbility: rating(
        requireNumber(
          balance.startingModel.capability,
          "scientificAbility",
          "startingModel.capability",
        ),
      ),
      embodiment: rating(
        requireNumber(
          balance.startingModel.capability,
          "embodiment",
          "startingModel.capability",
        ),
      ),
    },
    generality: rating(balance.startingModel.generality),
    productQuality: rating(draft.modelProductQuality),
    reliability: rating(balance.startingModel.reliability),
    accessLevel: 0,
    evaluations: [],
    anomalies: [],
    hiddenSafety: {
      trueAlignment: rating(
        requireNumber(
          balance.startingModel.hiddenSafety,
          "trueAlignment",
          "startingModel.hiddenSafety",
        ),
      ),
      corrigibility: rating(
        requireNumber(
          balance.startingModel.hiddenSafety,
          "corrigibility",
          "startingModel.hiddenSafety",
        ),
      ),
      situationalAwareness: rating(
        requireNumber(
          balance.startingModel.hiddenSafety,
          "situationalAwareness",
          "startingModel.hiddenSafety",
        ),
      ),
      deceptiveCapability: rating(
        requireNumber(
          balance.startingModel.hiddenSafety,
          "deceptiveCapability",
          "startingModel.hiddenSafety",
        ),
      ),
      generatedByRandomContract: RANDOM_CONTRACT_VERSION,
    },
    flags: {},
  };

  const ownedGpus = Math.round(balance.gpus.owned * draft.gpuScale);
  const leasedGpus = Math.round(balance.gpus.leased * draft.gpuScale);

  const playerLab: LabState = {
    id: PLAYER_LAB_ID,
    definitionId: lab.id,
    control: "player",
    finance: { cash: cashMillions(draft.cash) },
    aura: { spendable: draft.auraSpendable, lifetime: draft.auraLifetime },
    compute: {
      lots: [
        {
          id: formatRunEntityId("gpu-lot", "player", 0) as GpuLotId,
          generationId: balance.gpus.generationId,
          ownership: "owned",
          physicalCount: gpuCount(ownedGpus),
          availableFraction: fraction(1),
          reliability: rating(
            content.gpuGenerations[balance.gpus.generationId]?.reliability ?? 60,
          ),
        },
        {
          id: formatRunEntityId("gpu-lot", "player", 1) as GpuLotId,
          generationId: balance.gpus.generationId,
          ownership: "leased",
          physicalCount: gpuCount(leasedGpus),
          availableFraction: fraction(1),
          reliability: rating(
            content.gpuGenerations[balance.gpus.generationId]?.reliability ?? 60,
          ),
        },
      ],
      allocation: {
        servingBasisPoints: basisPoints(balance.allocation.servingBasisPoints),
        capabilityBasisPoints: basisPoints(balance.allocation.capabilityBasisPoints),
        capabilityDomainWeights: Object.fromEntries(
          Object.entries(balance.allocation.capabilityDomainWeights).map(
            ([key, value]) => [key, basisPoints(value)],
          ),
        ),
        safetyProgramWeights: Object.fromEntries(
          Object.entries(balance.allocation.safetyProgramWeights).map(([key, value]) => [
            key,
            basisPoints(value),
          ]),
        ),
      },
      reservations: [],
      softwareEfficiency: balance.softwareEfficiency,
    },
    research: {
      domains: Object.fromEntries(
        Object.entries(draft.domains).map(([domainId, level]) => [
          domainId,
          { level: rating(level) },
        ]),
      ),
    },
    safety: {
      safetyCulture: rating(requireNumber(draft.ratings, "safetyCulture", "ratings")),
      alignmentScience: rating(
        requireNumber(draft.ratings, "alignmentScience", "ratings"),
      ),
      evalQuality: rating(requireNumber(draft.ratings, "evalQuality", "ratings")),
      controlTheory: rating(requireNumber(draft.ratings, "controlTheory", "ratings")),
      practicalControlStrength: rating(
        requireNumber(draft.ratings, "practicalControlStrength", "ratings"),
      ),
      securityPosture: rating(requireNumber(draft.ratings, "securityPosture", "ratings")),
    },
    organisation: {
      engineeringQuality: rating(
        requireNumber(draft.ratings, "engineeringQuality", "ratings"),
      ),
      managementCapacity: rating(
        requireNumber(draft.ratings, "managementCapacity", "ratings"),
      ),
      researchFreedom: rating(requireNumber(draft.ratings, "researchFreedom", "ratings")),
      boardPatience: rating(requireNumber(draft.ratings, "boardPatience", "ratings")),
      hiddenInternalCandour: rating(
        requireNumber(draft.ratings, "internalCandour", "ratings"),
      ),
      generalResearchers: balance.generalResearchers,
      engineersAndOps: balance.engineersAndOps,
    },
    roster: { starSlots: balance.starSlots, researcherIds: [] },
    facilities: {
      instances: balance.facilities.map((definitionId) => ({
        definitionId,
        completedAt: tick(0),
      })),
    },
    market: { marketShare: fraction(balance.marketShare) },
    politics: {
      governmentAttention: rating(
        requireNumber(draft.ratings, "governmentAttention", "ratings"),
      ),
      governmentTrust: rating(requireNumber(draft.ratings, "governmentTrust", "ratings")),
      strategicDependence: rating(0),
      captureConcern: rating(0),
    },
    models: { currentModelId: modelId, modelIds: [modelId] },
    projects: { projectIds: [] },
    flags: draft.flags,
  };

  const modifiers = Object.fromEntries(
    application.modifiers.map((modifier) => [modifier.id, modifier]),
  );

  const state: GameState = {
    saveVersion: SAVE_VERSION,
    engineRulesVersion: ENGINE_RULES_VERSION,
    contentVersion: content.manifest.contentVersion,
    randomContractVersion: RANDOM_CONTRACT_VERSION,
    run: {
      runId: `run:${config.seed.slice(0, 12)}` as RunId,
      seed: config.seed,
      difficultyId: difficulty.id,
      playerLabId: PLAYER_LAB_ID,
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
        modifier: application.nextModifierIndex,
        "gpu-lot": 2,
        evaluation: 0,
        anomaly: 0,
        scheduled: 0,
        coalition: 0,
      },
    },
    world: {
      fundingClimate: rating(balance.fundingClimate),
      currentGpuGenerationId: balance.gpus.generationId,
      eventCooldowns: {},
    },
    labs: { [PLAYER_LAB_ID]: playerLab },
    models: { [modelId]: startingModel },
    projects: {},
    eventInstances: {},
    modifiers,
    scheduledEffects: [],
    decisionLog: [],
    domainLog: [],
    score: {
      scoreVersion: content.scoreRules.scoreVersion,
      entries: [],
      awardedKeys: {},
    },
    endgame: { stage: "inactive" },
  };

  return deepFreeze(validateGameState(state));
}
