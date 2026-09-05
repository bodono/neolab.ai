import type {
  AuthoredEffect,
  CompiledContent,
  ContentId,
  LeaderDefinition,
  NewGameBalance,
} from "@neolab/content-schema";
import { GRANT_TARGET_LIST } from "@neolab/content-schema";

import type {
  FacilityId,
  GpuLotId,
  LabId,
  ModifierId,
  ResearcherId,
  RunId,
} from "../model/ids.ts";
import {
  createInitialMarketState,
  settledServingPhysicalGpus,
} from "../market/market.ts";
import { validateGameState } from "../model/schema.ts";
import {
  calendarFromTick,
  ENGINE_RULES_VERSION,
  formatRunEntityId,
  SAVE_VERSION,
  type EffectSource,
  type GameState,
  type LabState,
  type ModifierState,
  type RivalStrategyState,
} from "../model/state.ts";
import {
  basisPoints,
  cashMillions,
  fraction,
  gpuCount,
  rating,
  tick,
} from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import { RANDOM_CONTRACT_VERSION, RandomOracleV1 } from "../random/oracle.ts";
import { isModifierTarget } from "./modifier-targets.ts";
import { deepFreeze } from "./transaction.ts";
import type { Seed128 } from "../random/seed.ts";
import { createInitialTalentMarketState } from "../researchers/talent-market.ts";
import { startingOrganisationTargetFlags } from "../researchers/people.ts";
import { createInitialRivalStrategy } from "../rivals/policy.ts";

/** New-game configuration (TDD section 21.5). */
export interface NewGameConfig {
  readonly seed: Seed128;
  readonly difficultyId: ContentId;
  readonly leaderId: ContentId;
  readonly mandateId: ContentId;
}

const PLAYER_LAB_ID = "lab:player" as LabId;
/**
 * Replacing the old free deployed model creates a real pre-revenue interval.
 * This runway keeps the opening decision meaningful without making ordinary
 * first-model training an accidental insolvency trap.
 */
export const FIRST_MODEL_BOOTSTRAP_RUNWAY_MILLIONS = 27;
export const FULL_GAME_CASH_GRANT_TARGET = "lab.finance.cash.fullGameGrant";
export const FULL_GAME_CASH_GRANT_CLAIMED_FLAG = "campaign:full-game-cash-grant-claimed";

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
  "lab.culture.safety.starting": ratingTarget("safetyCulture"),
  "lab.culture.internalCandour.starting": ratingTarget("internalCandour"),
  "lab.evals.quality.starting": ratingTarget("evalQuality"),
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
  "lab.research.alignment.startingLevel": domainTarget("base:safety.alignment-control"),
};

/** One-time grants recorded as lab flags rather than persistent modifiers. */
const GRANT_TARGETS: ReadonlySet<string> = new Set(GRANT_TARGET_LIST);

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
      ...(effect.target.startsWith("lab.") ? { labId: PLAYER_LAB_ID } : {}),
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

function applyLeaderResearchStartingEffects(
  draft: MutableDraft,
  leader: LeaderDefinition,
): void {
  const effects = [
    ...leader.labModifiers.flatMap((group) => group.effects),
    ...leader.headlineBonus.effects,
  ];
  for (const effect of effects) {
    if (
      !effect.target.startsWith("lab.research.") ||
      !effect.target.endsWith(".startingLevel")
    ) {
      continue;
    }
    const applyStartingEffect = STARTING_TARGETS[effect.target];
    if (applyStartingEffect === undefined) {
      throw new Error(
        `Unknown research starting target "${effect.target}" from leader:${leader.id}`,
      );
    }
    applyStartingEffect(draft, effect);
  }
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
  // Incident pressure stays a scalar read directly by calculateIncidentHazard;
  // authoring it as a modifier too would double-count now the target is wired.
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
  const fullGameCashGrant = draft.flags[FULL_GAME_CASH_GRANT_TARGET];
  if (typeof fullGameCashGrant === "number" && fullGameCashGrant > 0) {
    draft.cash += fullGameCashGrant;
    draft.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG] = true;
  }
  draft.cash += FIRST_MODEL_BOOTSTRAP_RUNWAY_MILLIONS;
  // Lifetime Aura can never sit below spendable Aura (GDD section 38.1).
  draft.auraLifetime = Math.max(draft.auraLifetime, draft.auraSpendable);
  draft.flags["model:first-product-quality"] = draft.modelProductQuality;

  const ownedGpus = Math.round(balance.gpus.owned * draft.gpuScale);

  const playerLab: LabState = {
    id: PLAYER_LAB_ID,
    definitionId: lab.id,
    control: "player",
    finance: {
      cash: cashMillions(draft.cash),
      ledger: [],
      settlements: [],
      consecutiveNegativeCashWeeks: 0,
    },
    aura: {
      spendable: draft.auraSpendable,
      lifetime: draft.auraLifetime,
      ledger: [],
    },
    compute: {
      servingPhysicalGpus: gpuCount(0),
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
      ],
      allocation: {
        // No lab owns a trained/deployed model at launch, so every unreserved
        // GPU begins in R&D instead of silently serving nonexistent demand.
        servingFleetShareBasisPoints: basisPoints(0),
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
      deliveries: [],
    },
    research: {
      domains: Object.fromEntries(
        Object.entries(draft.domains).map(([domainId, level]) => [
          domainId,
          {
            level: rating(level),
            levelProgressRp: 0,
            totalResearchPoints: 0,
            weeklyMomentum: 0,
          },
        ]),
      ),
      safetyPrograms: Object.fromEntries(
        Object.entries(balance.safetyProgramLevels).map(([programId, level]) => [
          programId,
          {
            level: rating(level),
            levelProgressRp: 0,
            totalResearchPoints: 0,
            weeklyMomentum: 0,
          },
        ]),
      ),
      pendingGenericAdvances: [],
      genericAdvances: {},
      paperProgress: {},
      discoveredPaperIds: [],
      diffusionKnowledge: {},
    },
    safety: {
      safetyCulture: rating(requireNumber(draft.ratings, "safetyCulture", "ratings")),
      alignmentScience: rating(
        requireNumber(draft.ratings, "alignmentScience", "ratings"),
      ),
      practiceXp: rating(0),
      evalQuality: rating(requireNumber(draft.ratings, "evalQuality", "ratings")),
      controlTheory: rating(requireNumber(draft.ratings, "controlTheory", "ratings")),
      practicalControlStrength: rating(
        requireNumber(draft.ratings, "practicalControlStrength", "ratings"),
      ),
      securityPosture: rating(requireNumber(draft.ratings, "securityPosture", "ratings")),
    },
    organisation: {
      boardPatience: rating(requireNumber(draft.ratings, "boardPatience", "ratings")),
      hiddenInternalCandour: rating(
        requireNumber(draft.ratings, "internalCandour", "ratings"),
      ),
      generalResearchers: balance.generalResearchers,
      engineersAndOps: balance.engineersAndOps,
    },
    roster: { starSlots: balance.starSlots, researcherIds: [] },
    facilities: {
      instances: balance.facilities.map((definitionId, index) => ({
        id: formatRunEntityId("facility", "player", index) as FacilityId,
        definitionId,
        completedAt: tick(0),
        majorProjectSlotBonus: 0,
        modifierIds: [],
      })),
    },
    market: createInitialMarketState(content, balance.marketShare),
    autonomy: { escalations: [], undetectedPressure: 0 },
    politics: {
      governmentAttention: rating(
        requireNumber(draft.ratings, "governmentAttention", "ratings"),
      ),
      governmentTrust: rating(requireNumber(draft.ratings, "governmentTrust", "ratings")),
      strategicDependence: rating(0),
      captureConcern: rating(0),
      programmes: [],
      quarterlyAssessments: [],
      interventions: [],
    },
    models: { modelIds: [] },
    projects: { projectIds: [] },
    flags: draft.flags,
  };
  Object.assign(draft.flags, startingOrganisationTargetFlags(playerLab));

  const rivalDefinitions = Object.values(content.labs)
    .filter((definition) => definition.id !== lab.id)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  if (rivalDefinitions.length !== 4) {
    throw new Error(
      `New games require exactly four rival labs, found ${String(rivalDefinitions.length)}`,
    );
  }
  const rivalLabs: Record<string, LabState> = {};
  const rivalStrategies: Record<string, RivalStrategyState> = {};
  for (const [index, definition] of rivalDefinitions.entries()) {
    const rivalLeader = content.leaders[definition.leaderId];
    if (rivalLeader === undefined) {
      throw new Error(
        `Rival lab ${definition.id} references unknown launch leader ${definition.leaderId}`,
      );
    }
    const rivalBaseline = buildDraft(balance);
    applyLeaderResearchStartingEffects(rivalBaseline, rivalLeader);
    const owner = `rival-${String(index)}`;
    const rivalLabId = formatRunEntityId("lab", "rival", index) as LabId;
    const rivalStrategy = createInitialRivalStrategy(rivalLabId, definition.id);
    const rivalLab: LabState = {
      ...structuredClone(playerLab),
      id: rivalLabId,
      definitionId: definition.id,
      control: "rival",
      finance: {
        cash: cashMillions(rivalBaseline.cash),
        ledger: [],
        settlements: [],
        consecutiveNegativeCashWeeks: 0,
      },
      aura: {
        spendable: rivalBaseline.auraSpendable,
        lifetime: Math.max(rivalBaseline.auraLifetime, rivalBaseline.auraSpendable),
        ledger: [],
      },
      compute: {
        ...structuredClone(playerLab.compute),
        lots: [
          {
            id: formatRunEntityId("gpu-lot", owner, 0) as GpuLotId,
            generationId: balance.gpus.generationId,
            ownership: "owned",
            physicalCount: gpuCount(balance.gpus.owned),
            availableFraction: fraction(1),
            reliability: rating(
              content.gpuGenerations[balance.gpus.generationId]?.reliability ?? 60,
            ),
          },
        ],
        reservations: [],
        deliveries: [],
      },
      research: {
        domains: Object.fromEntries(
          Object.entries(rivalBaseline.domains).map(([domainId, level]) => [
            domainId,
            {
              level: rating(level),
              levelProgressRp: 0,
              totalResearchPoints: 0,
              weeklyMomentum: 0,
            },
          ]),
        ),
        safetyPrograms: Object.fromEntries(
          Object.entries(balance.safetyProgramLevels).map(([programId, level]) => [
            programId,
            {
              level: rating(level),
              levelProgressRp: 0,
              totalResearchPoints: 0,
              weeklyMomentum: 0,
            },
          ]),
        ),
        pendingGenericAdvances: [],
        genericAdvances: {},
        paperProgress: {},
        discoveredPaperIds: [],
        diffusionKnowledge: {},
      },
      safety: {
        safetyCulture: rating(
          requireNumber(rivalBaseline.ratings, "safetyCulture", "ratings"),
        ),
        alignmentScience: rating(
          requireNumber(rivalBaseline.ratings, "alignmentScience", "ratings"),
        ),
        practiceXp: rating(0),
        evalQuality: rating(
          requireNumber(rivalBaseline.ratings, "evalQuality", "ratings"),
        ),
        controlTheory: rating(
          requireNumber(rivalBaseline.ratings, "controlTheory", "ratings"),
        ),
        practicalControlStrength: rating(
          requireNumber(rivalBaseline.ratings, "practicalControlStrength", "ratings"),
        ),
        securityPosture: rating(
          requireNumber(rivalBaseline.ratings, "securityPosture", "ratings"),
        ),
      },
      organisation: {
        boardPatience: rating(
          requireNumber(rivalBaseline.ratings, "boardPatience", "ratings"),
        ),
        hiddenInternalCandour: rating(
          requireNumber(rivalBaseline.ratings, "internalCandour", "ratings"),
        ),
        generalResearchers: balance.generalResearchers,
        engineersAndOps: balance.engineersAndOps,
      },
      roster: { starSlots: balance.starSlots, researcherIds: [] },
      facilities: {
        instances: balance.facilities.map((definitionId, facilityIndex) => ({
          id: formatRunEntityId("facility", owner, facilityIndex) as FacilityId,
          definitionId,
          completedAt: tick(0),
          majorProjectSlotBonus: 0,
          modifierIds: [],
        })),
      },
      market: createInitialMarketState(content, balance.marketShare),
      autonomy: { escalations: [], undetectedPressure: 0 },
      politics: {
        governmentAttention: rating(
          requireNumber(rivalBaseline.ratings, "governmentAttention", "ratings"),
        ),
        governmentTrust: rating(
          requireNumber(rivalBaseline.ratings, "governmentTrust", "ratings"),
        ),
        strategicDependence: rating(0),
        captureConcern: rating(0),
        programmes: [],
        quarterlyAssessments: [],
        interventions: [],
      },
      models: { modelIds: [] },
      projects: { projectIds: [] },
      flags: {
        "model:first-product-quality": rivalBaseline.modelProductQuality,
      },
    };
    Object.assign(rivalLab.flags, startingOrganisationTargetFlags(rivalLab));
    rivalLabs[rivalLabId] = rivalLab;
    rivalStrategies[rivalLabId] = rivalStrategy;
  }

  const modifiers = Object.fromEntries(
    application.modifiers.map((modifier) => [modifier.id, modifier]),
  );
  const researchers = Object.fromEntries(
    content.researchers.orderedIds.map((definitionId) => {
      const researcherId = definitionId as unknown as ResearcherId;
      return [
        researcherId,
        {
          id: researcherId,
          definitionId,
          status: "available" as const,
          housing: "unhoused" as const,
          morale: rating(60),
          loyalty: rating(50),
          burnout: rating(10),
          ambition: rating(60),
          departurePressure: rating(0),
          compact: {
            includedInOffer: false,
            status: "not-applicable" as const,
          },
          promises: [],
          memories: [],
          departureChecks: [],
          flags: {},
        },
      ];
    }),
  );

  let state: GameState = {
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
        lab: rivalDefinitions.length,
        model: 0,
        project: 0,
        event: 0,
        modifier: application.nextModifierIndex,
        facility: balance.facilities.length,
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
      currentGpuGenerationId: balance.gpus.generationId,
      eventCooldowns: {},
      paperRace: {
        labOrder: new RandomOracleV1(config.seed).shuffle(
          randomKey("paper", "lab-order"),
          [PLAYER_LAB_ID, ...(Object.keys(rivalStrategies) as LabId[])],
        ),
        discoveries: {},
        rival: {
          labId: content.papers.rules.rivalStub.labId,
          displayName: content.papers.rules.rivalStub.displayName,
          domainLevels: Object.fromEntries(
            [
              ...Object.keys(content.research.capabilityDomains),
              ...Object.keys(content.research.safetyPrograms),
            ].map((programmeId) => [
              programmeId,
              rating(content.papers.rules.rivalStub.domainLevel),
            ]),
          ),
          paperProgress: {},
          discoveredPaperIds: [],
          diffusionKnowledge: {},
        },
      },
      rivals: rivalStrategies,
      rivalSignals: [],
      rivalComponentAnnouncements: [],
      rivalCrisisStageAnnouncements: [],
      coalitions: {},
    },
    labs: { [PLAYER_LAB_ID]: playerLab, ...rivalLabs },
    models: {},
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
    researchers,
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
    modifiers,
    scheduledEffects: [],
    decisionLog: [],
    domainLog: [],
    score: {
      scoreVersion: content.scoreRules.scoreVersion,
      entries: [],
      awardedKeys: {},
    },
    presentationQueue: [],
    endgame: { stage: "inactive" },
  };

  state = {
    ...state,
    talentMarket: createInitialTalentMarketState(state, content),
  };

  // Settle the opening serving grant so a new run reads correctly before its
  // first tick; every later week recomputes it the same way.
  state = {
    ...state,
    labs: Object.fromEntries(
      Object.entries(state.labs).map(([id, lab]) => [
        id,
        {
          ...lab,
          compute: {
            ...lab.compute,
            servingPhysicalGpus: gpuCount(
              settledServingPhysicalGpus(state, content, lab.id),
            ),
          },
        },
      ]),
    ),
  };

  return deepFreeze(validateGameState(state));
}
