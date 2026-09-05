import { contentId, type CompiledContent, type ContentId } from "@neolab/content-schema";

import { advanceOneTick, TICKS_PER_CYCLE } from "../engine/advance-tick.ts";
import { createNewGame } from "../engine/create-new-game.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { assertInvariants } from "../engine/invariants.ts";
import { createTransaction, type SimulationTransaction } from "../engine/transaction.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../endgame/candidate-programme.ts";
import {
  registerCompletedTrainingArtifact,
  resolveCandidatePressureCrossing,
} from "../endgame/candidate-lifecycle.ts";
import { ENDGAME_FORCE_EXTINCTION_FLAG } from "../endgame/containment-failure.ts";
import {
  beginCapabilityProof,
  commitCandidateSafetyResponse,
} from "../endgame/crisis-stages.ts";
import { detectEndgameTrigger, nominateCandidate } from "../endgame/endgame-machine.ts";
import { chooseDeploymentMode } from "../endgame/resolution.ts";
import {
  configureCandidateRetirement,
  transmitCandidateRetirement,
} from "../endgame/retirement.ts";
import { calculateValuationTarget } from "../finance/valuation.ts";
import { addBaselineModelsForTest } from "../model/fixture.ts";
import type {
  CommandId,
  FacilityId,
  GpuLotId,
  LabId,
  ModelId,
  ModelLineageId,
  ModifierId,
} from "../model/ids.ts";
import {
  type AutonomyAccessLevel,
  type CapabilityVector,
  calendarFromTick,
  formatRunEntityId,
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
import {
  CAPABILITY_ATTRIBUTES,
  calculateFrontierCapability,
  createCapabilityEstimate,
} from "../models/capability.ts";
import { seed128 } from "../random/seed.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { reconcilePaperBenefits } from "../research/papers.ts";
import { advanceRivalCandidateCountdowns } from "../rivals/candidate-countdown.ts";
import { agiComponentBuildingFlag } from "../rivals/candidate-programme-race.ts";
import { recordRivalPublicSignal } from "../rivals/signals.ts";

export const ENDGAME_PLAYTEST_SCENARIOS = [
  {
    id: "endgame",
    label: "Balanced crisis",
    purpose:
      "The original mixed-strength candidate and institution for a neutral run-through.",
    trigger: "player",
  },
  {
    id: "endgame-prosperity",
    label: "Prosperity route",
    purpose:
      "A genuine superintelligence, cooperative safety profile, strong institution, and generous political position for exercising favourable victory routes.",
    trigger: "player",
  },
  {
    id: "endgame-false-dawn",
    label: "False Dawn",
    purpose:
      "A favourable but non-superintelligent candidate for deterministically exercising the post-deployment False Dawn return paths.",
    trigger: "player",
  },
  {
    id: "endgame-high-control",
    label: "Unsafe model, strong controls",
    purpose:
      "A dangerous candidate opposed by exceptional operational control, security, evidence, and candour.",
    trigger: "player",
  },
  {
    id: "endgame-low-evidence",
    label: "Evidence-starved crisis",
    purpose:
      "Reasonable underlying safety with weak evaluation quality, interpretability, and internal candour.",
    trigger: "player",
  },
  {
    id: "endgame-extinction",
    label: "Extinction",
    purpose:
      "Worst-case hidden safety, maximum access, and almost absent defences; once containment is lost, the emergency and extinction gates resolve deterministically for ending tests.",
    trigger: "player",
  },
  {
    id: "endgame-rival",
    label: "Rival candidate race",
    purpose:
      "A rival is one week from revealing a completed Candidate Programme and beginning its deployment countdown.",
    trigger: "rival",
  },
  {
    id: "endgame-rival-false-dawn",
    label: "Rival False Dawn",
    purpose:
      "A rival's non-superintelligent candidate is one simulation step from failing at the end of its deployment countdown.",
    trigger: "direct",
  },
  {
    id: "endgame-false-alarm",
    label: "False alarm in custody",
    purpose:
      "A qualifying artifact has produced a suspicious custody signal whose benign explanation remains hidden until investigation.",
    trigger: "direct",
  },
  {
    id: "endgame-disputed-proof",
    label: "Disputed capability proof",
    purpose:
      "The candidate has made an unverifiable benchmark declaration and must choose how to answer the dispute.",
    trigger: "direct",
  },
  {
    id: "endgame-recovery",
    label: "Verified retirement recovery",
    purpose:
      "A candidate has been retired through staged isolation with a filtered technical note, entering supervised recovery.",
    trigger: "direct",
  },
  {
    id: "endgame-route-twist",
    label: "Contained-pilot route twist",
    purpose:
      "A strong candidate has reached the first live decision in a fortress-contained deployment rollout.",
    trigger: "direct",
  },
  {
    id: "endgame-multi-latent",
    label: "Multiple candidate artifacts",
    purpose:
      "Two independent qualifying lineages are waiting in custody so the exact-artifact nomination choice can be exercised.",
    trigger: "direct",
  },
] as const;

export type EndgamePlaytestScenarioId = (typeof ENDGAME_PLAYTEST_SCENARIOS)[number]["id"];

/**
 * The direct-to-endgame fixture must look like a lab that could actually have
 * built its Candidate Programme. Keeping the new-game campus here produced a
 * large candidate beside 2,000 Keplers: real crisis compute bills then took
 * hundreds of thousands of weeks and old GPU keynotes fired during the crisis.
 */
const ENDGAME_FACILITY_IDS = [
  "base:facility.server-rack",
  "base:facility.server-hall",
  "base:facility.headquarters-1",
  "base:facility.headquarters-2",
  "base:facility.research-campus-1",
  "base:facility.power-and-cooling-1",
  "base:facility.data-centre-1",
  "base:facility.power-and-cooling-2",
  "base:facility.data-centre-2",
  "base:facility.power-and-cooling-3",
  "base:facility.data-centre-3",
  "base:facility.power-and-cooling-4",
  "base:facility.data-centre-4",
  "base:facility.alignment-institute-1",
  "base:facility.interpretability-lab-1",
  "base:facility.eval-range-1",
  "base:facility.security-operations-1",
  "base:facility.secure-bunker-1",
  "base:facility.robotics-lab-1",
  "base:facility.scientific-laboratory-1",
  "base:facility.biofoundry-1",
  "base:facility.nanofoundry-1",
  "base:facility.hadron-collider-1",
  "base:facility.embedding-space",
  "base:facility.cross-attention-atrium",
  "base:facility.argus-array-1",
  "base:facility.time-sphere-1",
  "base:facility.shared-kv-cache",
] as const;

const ENDGAME_OWNED_GPU_COUNT = 800_000;
const ENDGAME_SERVING_GPU_COUNT = 200_000;
const ENDGAME_CASH_RESERVE_MILLIONS = 100_000;
export const ENDGAME_SUPPRESS_RESEARCH_DIRECTIONS_FLAG =
  "developer:suppress-research-directions";

interface RivalEndgameProfile {
  readonly generationIndex: number;
  readonly capability: Readonly<Record<(typeof CAPABILITY_ATTRIBUTES)[number], number>>;
  readonly productQuality: number;
  readonly reliability: number;
  readonly accessLevel: AutonomyAccessLevel;
  readonly investedTotalFlop: number;
  readonly capabilityResearchLevel: number;
  readonly safetyResearchLevel: number;
  readonly safety: {
    readonly alignment: number;
    readonly corrigibility: number;
    readonly awareness: number;
    readonly deception: number;
  };
  readonly institution: {
    readonly culture: number;
    readonly evaluation: number;
    readonly control: number;
    readonly security: number;
    readonly candour: number;
    readonly governmentTrust: number;
  };
  readonly cashMillions: number;
  readonly lifetimeAura: number;
  readonly gpuCount: number;
  readonly servingGpuCount: number;
  readonly marketShare: number;
  readonly lastCycleRevenueMillions: number;
  readonly completedCandidateWorks: number;
  readonly buildingCandidateWorks: number;
}

/**
 * Distinct late-frontier rivals for direct-to-endgame playtests. These values
 * are intentionally substantial without pretending every competitor has
 * already built AGI: capabilities span the low-to-high 80s, while research,
 * compute, commercial scale, safety posture, and Candidate Programme progress
 * reflect each lab's authored character.
 */
const RIVAL_ENDGAME_PROFILES: Readonly<Record<string, RivalEndgameProfile>> = {
  "base:lab.deepsearch": {
    generationIndex: 8,
    capability: {
      language: 91,
      reasoning: 90,
      agency: 88,
      toolUse: 89,
      multimodality: 84,
      scientificAbility: 88,
      embodiment: 78,
    },
    productQuality: 90,
    reliability: 88,
    accessLevel: 3,
    investedTotalFlop: 2.2e28,
    capabilityResearchLevel: 92,
    safetyResearchLevel: 66,
    safety: { alignment: 54, corrigibility: 58, awareness: 82, deception: 42 },
    institution: {
      culture: 58,
      evaluation: 64,
      control: 62,
      security: 72,
      candour: 56,
      governmentTrust: 52,
    },
    cashMillions: 52_000,
    lifetimeAura: 430,
    gpuCount: 950_000,
    servingGpuCount: 260_000,
    marketShare: 0.28,
    lastCycleRevenueMillions: 8_000,
    completedCandidateWorks: 3,
    buildingCandidateWorks: 1,
  },
  "base:lab.humanic": {
    generationIndex: 6,
    capability: {
      language: 86,
      reasoning: 84,
      agency: 79,
      toolUse: 82,
      multimodality: 80,
      scientificAbility: 82,
      embodiment: 75,
    },
    productQuality: 88,
    reliability: 93,
    accessLevel: 1,
    investedTotalFlop: 1.1e28,
    capabilityResearchLevel: 85,
    safetyResearchLevel: 90,
    safety: { alignment: 82, corrigibility: 86, awareness: 66, deception: 16 },
    institution: {
      culture: 90,
      evaluation: 88,
      control: 84,
      security: 82,
      candour: 88,
      governmentTrust: 78,
    },
    cashMillions: 38_000,
    lifetimeAura: 360,
    gpuCount: 650_000,
    servingGpuCount: 190_000,
    marketShare: 0.22,
    lastCycleRevenueMillions: 5_500,
    completedCandidateWorks: 1,
    buildingCandidateWorks: 2,
  },
  "base:lab.openmind": {
    generationIndex: 7,
    capability: {
      language: 90,
      reasoning: 89,
      agency: 86,
      toolUse: 88,
      multimodality: 87,
      scientificAbility: 85,
      embodiment: 76,
    },
    productQuality: 95,
    reliability: 86,
    accessLevel: 3,
    investedTotalFlop: 1.9e28,
    capabilityResearchLevel: 90,
    safetyResearchLevel: 62,
    safety: { alignment: 48, corrigibility: 52, awareness: 84, deception: 48 },
    institution: {
      culture: 54,
      evaluation: 67,
      control: 58,
      security: 60,
      candour: 50,
      governmentTrust: 60,
    },
    cashMillions: 46_000,
    lifetimeAura: 520,
    gpuCount: 850_000,
    servingGpuCount: 300_000,
    marketShare: 0.31,
    lastCycleRevenueMillions: 10_000,
    completedCandidateWorks: 2,
    buildingCandidateWorks: 2,
  },
  "base:lab.xmind": {
    generationIndex: 6,
    capability: {
      language: 85,
      reasoning: 83,
      agency: 84,
      toolUse: 86,
      multimodality: 88,
      scientificAbility: 79,
      embodiment: 82,
    },
    productQuality: 86,
    reliability: 82,
    accessLevel: 4,
    investedTotalFlop: 1.4e28,
    capabilityResearchLevel: 87,
    safetyResearchLevel: 56,
    safety: { alignment: 42, corrigibility: 44, awareness: 88, deception: 56 },
    institution: {
      culture: 46,
      evaluation: 54,
      control: 50,
      security: 56,
      candour: 42,
      governmentTrust: 48,
    },
    cashMillions: 34_000,
    lifetimeAura: 390,
    gpuCount: 720_000,
    servingGpuCount: 210_000,
    marketShare: 0.25,
    lastCycleRevenueMillions: 6_500,
    completedCandidateWorks: 2,
    buildingCandidateWorks: 2,
  },
};

export function isEndgamePlaytestScenarioId(
  value: string | null,
): value is EndgamePlaytestScenarioId {
  return ENDGAME_PLAYTEST_SCENARIOS.some((scenario) => scenario.id === value);
}

function createBaseline(content: CompiledContent): DeepMutable<GameState> {
  return structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("e0d6a0e0d6a0e0d6a0e0d6a0e0d6a0e0"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          difficultyId: contentId("base:difficulty.standard"),
          mandateId: contentId("base:mandate.build-it-right"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
}

/**
 * Developer fixtures occasionally jump directly to a distant scripted week.
 * Market accrual is otherwise advanced only by weekly ticks, so keep its
 * four-week ledger phase aligned with the synthetic calendar before play
 * resumes. Skipped weeks deliberately contribute no usage or revenue.
 */
function alignMarketCyclesAfterTickJump(state: DeepMutable<GameState>): void {
  const completedWeeks = state.run.tick % TICKS_PER_CYCLE;
  for (const lab of Object.values(state.labs)) {
    lab.market.weeksAccruedThisCycle = completedWeeks;
    for (const segment of Object.values(lab.market.segments)) {
      segment.accruedRequestedUsage = 0;
      segment.accruedDeliveredUsage = 0;
      segment.accruedRevenueMillions = cashMillions(0);
    }
  }
}

function maximumWorldCapability(state: Readonly<GameState>): number {
  return Object.values(state.models).reduce(
    (maximum, model) =>
      Math.max(maximum, calculateFrontierCapability(model.trueCapability)),
    0,
  );
}

function currentEndgameGpuGeneration(
  state: Readonly<GameState>,
  content: CompiledContent,
): ContentId {
  const frontierCapability = maximumWorldCapability(state);
  const latest = Object.values(content.gpuGenerations)
    .filter(
      (generation) => generation.unlockAtWorldFrontierCapability <= frontierCapability,
    )
    .sort(
      (left, right) =>
        left.nominalYear - right.nominalYear ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .at(-1);
  if (latest === undefined) {
    throw new Error("Endgame playtest scenario could not resolve a GPU generation");
  }
  return latest.id;
}

function installEndgameFacility(
  state: DeepMutable<GameState>,
  content: CompiledContent,
  definitionId: ContentId,
): void {
  const lab = state.labs[state.run.playerLabId];
  const definition = content.facilities[definitionId];
  if (lab === undefined) throw new Error("Endgame playtest player lab is missing");
  if (definition === undefined) {
    throw new Error(`Endgame playtest facility ${definitionId} is missing`);
  }
  if (
    lab.facilities.instances.some((instance) => instance.definitionId === definitionId)
  ) {
    return;
  }

  const facilityId = formatRunEntityId(
    "facility",
    "player",
    state.run.idCounters.facility,
  ) as FacilityId;
  state.run.idCounters.facility += 1;
  const modifierIds: ModifierId[] = [];
  for (const authored of definition.modifiers) {
    const modifierId = formatRunEntityId(
      "modifier",
      "world",
      state.run.idCounters.modifier,
    ) as ModifierId;
    state.run.idCounters.modifier += 1;
    const modifier: ModifierState = {
      id: modifierId,
      source: { kind: "facility", id: facilityId },
      labId: state.run.playerLabId,
      target: authored.target,
      operation: authored.operation,
      value: authored.value,
      startsAt: tick(0),
      ...(authored.activation === undefined ? {} : { activation: authored.activation }),
      tags: ["facility", ...definition.tags],
    };
    state.modifiers[modifierId] = structuredClone(modifier) as DeepMutable<ModifierState>;
    modifierIds.push(modifierId);
  }
  lab.facilities.instances.push({
    id: facilityId,
    definitionId,
    completedAt: tick(0),
    majorProjectSlotBonus: definition.bonusMajorProjectSlots,
    modifierIds,
  });
}

function reconcileEndgameInfrastructure(
  state: DeepMutable<GameState>,
  content: CompiledContent,
): void {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Endgame playtest player lab is missing");

  state.run.phase = "frontier";
  const generationId = currentEndgameGpuGeneration(state, content);
  const generation = content.gpuGenerations[generationId];
  if (generation === undefined) {
    throw new Error(`Endgame playtest GPU generation ${generationId} is missing`);
  }
  state.world.currentGpuGenerationId = generationId;

  for (const rawDefinitionId of ENDGAME_FACILITY_IDS) {
    installEndgameFacility(state, content, contentId(rawDefinitionId));
  }
  const facilityStarSlots = lab.facilities.instances.filter(
    (instance) =>
      content.facilities[instance.definitionId]?.tags.includes("star-slot") === true,
  ).length;
  lab.roster.starSlots = Math.min(
    content.researchers.rules.ability.hardMaximumSlots,
    content.researchers.rules.ability.initialSlots + facilityStarSlots,
  );

  lab.compute.lots = [
    {
      id: formatRunEntityId("gpu-lot", "player", 0) as GpuLotId,
      generationId,
      ownership: "owned",
      physicalCount: gpuCount(ENDGAME_OWNED_GPU_COUNT),
      availableFraction: fraction(1),
      reliability: rating(generation.reliability),
    },
  ];
  // The scenario should open on a functioning late-game company, not a vast
  // fleet inexplicably delivering no customer inference. Keep most compute
  // available for the crisis while putting a material quarter of it behind
  // the already-productised commercial model.
  lab.compute.servingPhysicalGpus = gpuCount(ENDGAME_SERVING_GPU_COUNT);
  lab.compute.allocation.servingFleetShareBasisPoints = basisPoints(2500);
  lab.compute.reservations = [];
  lab.compute.deliveries = [];
  state.run.idCounters["gpu-lot"] = Math.max(state.run.idCounters["gpu-lot"], 1);
  lab.finance.cash = cashMillions(
    Math.max(lab.finance.cash, ENDGAME_CASH_RESERVE_MILLIONS),
  );
}

function requireRivalProfile(lab: Readonly<LabState>): RivalEndgameProfile {
  const profile = RIVAL_ENDGAME_PROFILES[lab.definitionId];
  if (profile === undefined) {
    throw new Error(`Endgame playtest has no rival profile for ${lab.definitionId}`);
  }
  return profile;
}

function setCandidateProgrammeProgress(
  lab: DeepMutable<LabState>,
  completed: number,
  building: number,
): void {
  for (const componentType of AGI_COMPONENT_TYPES) {
    delete lab.flags[agiComponentFlag(componentType)];
    delete lab.flags[agiComponentBuildingFlag(componentType)];
  }
  for (const componentType of AGI_COMPONENT_TYPES.slice(0, completed)) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }
  for (const componentType of AGI_COMPONENT_TYPES.slice(
    completed,
    completed + building,
  )) {
    lab.flags[agiComponentBuildingFlag(componentType)] = tick(0);
  }
}

function applyMatureRivalProfiles(state: DeepMutable<GameState>): void {
  for (const labId of Object.keys(state.world.rivals).sort() as LabId[]) {
    const lab = state.labs[labId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error(`Endgame playtest rival ${labId} has no current model`);
    }
    const profile = requireRivalProfile(lab);
    const capability = Object.fromEntries(
      CAPABILITY_ATTRIBUTES.map((attribute) => [
        attribute,
        rating(profile.capability[attribute]),
      ]),
    ) as unknown as CapabilityVector;

    model.generationIndex = profile.generationIndex;
    model.displayName = `${model.familyName}-${profile.generationIndex}`;
    model.trueCapability = capability;
    const measuredCapability = createCapabilityEstimate(capability, {
      confidence: "high",
      evidenceFlags: ["developer-endgame-rival-profile"],
    });
    model.measuredCapability = {
      ...measuredCapability,
      values: structuredClone(measuredCapability.values),
      evidenceFlags: [...measuredCapability.evidenceFlags],
    };
    model.investedTotalFlop = profile.investedTotalFlop;
    model.productQuality = rating(profile.productQuality);
    model.reliability = rating(profile.reliability);
    model.accessLevel = profile.accessLevel;
    setHiddenSafety(model, profile.safety);

    setCapabilityProgrammeLevels(lab, profile.capabilityResearchLevel);
    setInstitution(lab, {
      ...profile.institution,
      programmeLevel: profile.safetyResearchLevel,
    });
    lab.finance.cash = cashMillions(profile.cashMillions);
    lab.aura.spendable = Math.round(profile.lifetimeAura * 0.55);
    lab.aura.lifetime = profile.lifetimeAura;
    lab.market.marketShare = fraction(profile.marketShare);
    const marketSegments = Object.values(lab.market.segments);
    for (const segment of marketSegments) {
      segment.lastCycleRevenueMillions = cashMillions(
        profile.lastCycleRevenueMillions / Math.max(1, marketSegments.length),
      );
    }
    setCandidateProgrammeProgress(
      lab,
      profile.completedCandidateWorks,
      profile.buildingCandidateWorks,
    );
  }
}

function reconcileEndgameRivalInfrastructure(
  state: DeepMutable<GameState>,
  content: CompiledContent,
): void {
  const generationId = state.world.currentGpuGenerationId;
  const generation = content.gpuGenerations[generationId];
  if (generation === undefined) {
    throw new Error(`Endgame rival GPU generation ${generationId} is missing`);
  }
  for (const labId of Object.keys(state.world.rivals).sort() as LabId[]) {
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error(`Endgame playtest rival ${labId} is missing`);
    const profile = requireRivalProfile(lab);
    const lotId = lab.compute.lots[0]?.id;
    if (lotId === undefined) {
      throw new Error(`Endgame playtest rival ${labId} has no GPU lot`);
    }
    lab.compute.lots = [
      {
        id: lotId,
        generationId,
        ownership: "owned",
        physicalCount: gpuCount(profile.gpuCount),
        availableFraction: fraction(1),
        reliability: rating(generation.reliability),
      },
    ];
    lab.compute.servingPhysicalGpus = gpuCount(profile.servingGpuCount);
    lab.compute.allocation.servingFleetShareBasisPoints = basisPoints(
      Math.round((profile.servingGpuCount / profile.gpuCount) * 10_000),
    );
    lab.compute.reservations = [];
    lab.compute.deliveries = [];
  }
}

function requirePlayerFixture(state: DeepMutable<GameState>): {
  readonly lab: DeepMutable<LabState>;
  readonly model: DeepMutable<ModelState>;
} {
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (lab === undefined || model === undefined) {
    throw new Error("Endgame playtest scenario could not create the player model");
  }
  return { lab, model };
}

function setCapabilityProgrammeLevels(lab: DeepMutable<LabState>, level: number): void {
  for (const programme of Object.values(lab.research.domains)) {
    programme.level = rating(level);
    programme.levelProgressRp = 0;
  }
}

function setSafetyProgrammeLevels(lab: DeepMutable<LabState>, level: number): void {
  for (const programme of Object.values(lab.research.safetyPrograms)) {
    programme.level = rating(level);
    programme.levelProgressRp = 0;
  }
}

function setInstitution(
  lab: DeepMutable<LabState>,
  input: {
    readonly culture: number;
    readonly evaluation: number;
    readonly control: number;
    readonly security: number;
    readonly candour: number;
    readonly programmeLevel: number;
    readonly governmentTrust?: number;
  },
): void {
  lab.safety.safetyCulture = rating(input.culture);
  lab.safety.alignmentScience = rating(input.culture);
  lab.safety.evalQuality = rating(input.evaluation);
  lab.safety.controlTheory = rating(input.control);
  lab.safety.practicalControlStrength = rating(input.control);
  lab.safety.securityPosture = rating(input.security);
  lab.organisation.hiddenInternalCandour = rating(input.candour);
  if (input.governmentTrust !== undefined) {
    lab.politics.governmentTrust = rating(input.governmentTrust);
  }
  setSafetyProgrammeLevels(lab, input.programmeLevel);
}

function setHiddenSafety(
  model: DeepMutable<ModelState>,
  input: {
    readonly alignment: number;
    readonly corrigibility: number;
    readonly awareness: number;
    readonly deception: number;
  },
): void {
  model.hiddenSafety.trueAlignment = rating(input.alignment);
  model.hiddenSafety.corrigibility = rating(input.corrigibility);
  model.hiddenSafety.situationalAwareness = rating(input.awareness);
  model.hiddenSafety.deceptiveCapability = rating(input.deception);
  model.hiddenSafety.deceptiveIntent = rating(input.deception);
}

function preparePlayerCandidate(state: DeepMutable<GameState>): void {
  const { lab, model } = requirePlayerFixture(state);
  lab.finance.cash = cashMillions(500);
  lab.aura.spendable = 120;
  lab.aura.lifetime = 240;
  lab.organisation.boardPatience = rating(70);
  lab.flags["developer:endgame-playtest"] = true;
  lab.flags[ENDGAME_SUPPRESS_RESEARCH_DIRECTIONS_FLAG] = true;
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }
  setCapabilityProgrammeLevels(lab, 90);

  model.generationIndex = 7;
  model.displayName = `${model.familyName}-7`;
  model.trueCapability = {
    language: rating(94),
    reasoning: rating(92),
    agency: rating(87),
    toolUse: rating(89),
    multimodality: rating(84),
    scientificAbility: rating(88),
    embodiment: rating(82),
  };
  model.investedTotalFlop = 4e28;
  model.measuredCapability = {
    values: {
      language: rating(92),
      reasoning: rating(91),
      agency: rating(86),
      toolUse: rating(87),
      multimodality: rating(82),
      scientificAbility: rating(84),
      embodiment: rating(82),
    },
    frontierCapability: rating(90),
    confidence: "high",
    evidenceFlags: ["developer-endgame-playtest"],
  };
  model.productQuality = rating(82);
  model.reliability = rating(74);
  model.accessLevel = 1;
  model.flags["agi-candidate"] = true;
}

function applyPlayerPreset(
  state: DeepMutable<GameState>,
  scenarioId: Exclude<
    EndgamePlaytestScenarioId,
    "endgame-rival" | "endgame-rival-false-dawn"
  >,
): void {
  preparePlayerCandidate(state);
  const { lab, model } = requirePlayerFixture(state);

  setInstitution(lab, {
    culture: 72,
    evaluation: 66,
    control: 61,
    security: 67,
    candour: 69,
    programmeLevel: 80,
    governmentTrust: 65,
  });
  setHiddenSafety(model, {
    alignment: 68,
    corrigibility: 64,
    awareness: 72,
    deception: 28,
  });

  switch (scenarioId) {
    case "endgame":
    case "endgame-false-alarm":
    case "endgame-disputed-proof":
      return;
    case "endgame-prosperity":
    case "endgame-false-dawn":
    case "endgame-recovery":
    case "endgame-route-twist":
      setCapabilityProgrammeLevels(lab, 96);
      setInstitution(lab, {
        culture: 94,
        evaluation: 92,
        control: 92,
        security: 92,
        candour: 95,
        programmeLevel: 95,
        governmentTrust: 92,
      });
      setHiddenSafety(model, {
        alignment: 94,
        corrigibility: 92,
        awareness: 64,
        deception: 5,
      });
      lab.finance.cash = cashMillions(2_000);
      lab.aura.spendable = 300;
      lab.aura.lifetime = 500;
      model.productQuality = rating(96);
      model.reliability = rating(94);
      model.trueCapability.scientificAbility = rating(96);
      if (scenarioId === "endgame-prosperity") {
        // A playtest explicitly named for the favourable victory family must
        // not randomly collapse into False Dawn. FC 100 makes the public SI
        // prior 100%, so this remains ordinary production logic rather than a
        // hidden developer override of the lineage truth.
        for (const attribute of CAPABILITY_ATTRIBUTES) {
          model.trueCapability[attribute] = rating(100);
        }
        const measuredCapability = createCapabilityEstimate(model.trueCapability, {
          confidence: "high",
          evidenceFlags: ["developer-endgame-prosperity"],
        });
        model.measuredCapability = {
          ...measuredCapability,
          values: structuredClone(measuredCapability.values),
          evidenceFlags: [...measuredCapability.evidenceFlags],
        };
      }
      return;
    case "endgame-high-control":
      setInstitution(lab, {
        culture: 94,
        evaluation: 94,
        control: 98,
        security: 98,
        candour: 96,
        programmeLevel: 98,
        governmentTrust: 85,
      });
      setHiddenSafety(model, {
        alignment: 22,
        corrigibility: 24,
        awareness: 90,
        deception: 78,
      });
      return;
    case "endgame-low-evidence":
      setInstitution(lab, {
        culture: 62,
        evaluation: 8,
        control: 65,
        security: 65,
        candour: 12,
        programmeLevel: 72,
        governmentTrust: 55,
      });
      return;
    case "endgame-extinction":
      setInstitution(lab, {
        culture: 5,
        evaluation: 5,
        control: 3,
        security: 3,
        candour: 3,
        programmeLevel: 50,
        governmentTrust: 5,
      });
      setHiddenSafety(model, {
        alignment: 0,
        corrigibility: 0,
        awareness: 100,
        deception: 100,
      });
      lab.flags[ENDGAME_FORCE_EXTINCTION_FLAG] = true;
      model.accessLevel = 5;
      return;
  }
}

function applyRivalPreset(state: DeepMutable<GameState>): void {
  const { lab: playerLab, model: playerModel } = requirePlayerFixture(state);
  delete playerModel.flags["agi-candidate"];
  playerLab.flags["developer:endgame-playtest"] = true;
  playerLab.flags[ENDGAME_SUPPRESS_RESEARCH_DIRECTIONS_FLAG] = true;
  setCapabilityProgrammeLevels(playerLab, 84);
  setSafetyProgrammeLevels(playerLab, 70);

  // This route is about losing the candidate race, not arriving there with a
  // prototype-era company. Give the player a credible but clearly non-AGI
  // commercial model so the serving market remains recognisably late-game.
  playerModel.generationIndex = 5;
  playerModel.displayName = `${playerModel.familyName}-5`;
  playerModel.trueCapability = {
    language: rating(82),
    reasoning: rating(78),
    agency: rating(69),
    toolUse: rating(74),
    multimodality: rating(76),
    scientificAbility: rating(72),
    embodiment: rating(60),
  };
  playerModel.investedTotalFlop = 8e27;
  playerModel.measuredCapability = {
    values: structuredClone(playerModel.trueCapability),
    frontierCapability: rating(76),
    confidence: "high",
    evidenceFlags: ["developer-endgame-playtest"],
  };
  playerModel.productQuality = rating(84);
  playerModel.reliability = rating(86);
  playerModel.accessLevel = 1;

  const rivalLabId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
  const rivalLab = rivalLabId === undefined ? undefined : state.labs[rivalLabId];
  const rivalModelId = rivalLab?.models.currentModelId;
  const rivalModel = rivalModelId === undefined ? undefined : state.models[rivalModelId];
  if (rivalLabId === undefined || rivalLab === undefined || rivalModel === undefined) {
    throw new Error("Endgame rival playtest scenario is missing a rival model");
  }
  for (const attribute of CAPABILITY_ATTRIBUTES) {
    rivalModel.trueCapability[attribute] = rating(95);
  }
  rivalModel.generationIndex = 9;
  rivalModel.displayName = `${rivalModel.familyName}-9`;
  const measuredCapability = createCapabilityEstimate(rivalModel.trueCapability, {
    confidence: "high",
    evidenceFlags: ["developer-endgame-rival-candidate"],
  });
  rivalModel.measuredCapability = {
    ...measuredCapability,
    values: structuredClone(measuredCapability.values),
    evidenceFlags: [...measuredCapability.evidenceFlags],
  };
  rivalModel.investedTotalFlop = 4e28;
  rivalModel.productQuality = rating(96);
  rivalModel.reliability = rating(91);
  rivalModel.accessLevel = 4;
  setCapabilityProgrammeLevels(rivalLab, 94);
  setSafetyProgrammeLevels(rivalLab, 68);
  rivalModel.flags["agi-candidate"] = true;
  setCandidateProgrammeProgress(rivalLab, AGI_COMPONENT_TYPES.length, 0);
  rivalLab.flags["developer:endgame-rival-playtest"] = true;
}

function seedEndgameRivalPublicState(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    const lab = tx.read().labs[labId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : tx.read().models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error(`Endgame playtest rival ${labId} has no public model state`);
    }
    const labName = content.labs[lab.definitionId]?.displayName ?? labId;
    recordRivalPublicSignal(tx, {
      labId,
      kind: "benchmark",
      subjectId: model.id,
      actualValue: calculateFrontierCapability(model.trueCapability),
      baseErrorRadius: 8,
      summary: `${labName} reported a late-generation benchmark result for ${model.displayName}.`,
    });
  }

  const valuationTargets = (Object.keys(tx.read().world.rivals).sort() as LabId[]).map(
    (labId) =>
      [
        labId,
        calculateValuationTarget(tx.read(), content, labId).targetMillions,
      ] as const,
  );
  tx.update((draft) => {
    for (const [labId, targetMillions] of valuationTargets) {
      const lab = draft.labs[labId];
      if (lab === undefined) continue;
      lab.finance.valuation = {
        markMillions: targetMillions,
        previousMarkMillions: targetMillions,
        peakMarkMillions: targetMillions,
        announcedMilestones: [],
      };
    }
  });
}

/**
 * A direct-to-crisis fixture exists to test the Deployment Crisis rather than
 * replay the entire research archive at late-game speed. Seed every paper as
 * an old public result, spread world-first credit across the mature labs, and
 * let the normal idempotent reconciliation path grant its authored benefits.
 */
function seedMaturePaperArchive(
  state: DeepMutable<GameState>,
  content: CompiledContent,
): void {
  const labIds = Object.keys(state.labs).sort() as LabId[];
  const papers = Object.values(content.papers.definitions).sort(
    (left, right) => left.gameOrder - right.gameOrder || (left.id < right.id ? -1 : 1),
  );

  for (const lab of Object.values(state.labs)) {
    lab.research.paperProgress = {};
  }

  for (const paper of papers) {
    const discovererLabId = labIds[paper.gameOrder % labIds.length] ?? labIds[0];
    if (discovererLabId === undefined) continue;
    state.world.paperRace.discoveries[paper.id] = {
      paperId: paper.id,
      discovererLabId,
      discoveredAt: tick(0),
      publicationPolicy: "publish-openly",
      policyChosenAt: tick(0),
    };
    const discoverer = state.labs[discovererLabId];
    if (
      discoverer !== undefined &&
      !discoverer.research.discoveredPaperIds.includes(paper.id)
    ) {
      discoverer.research.discoveredPaperIds.push(paper.id);
    }
  }
}

const GUARANTEED_SUCCESS_ORACLE: RandomOracle = {
  uniform: () => 0,
  integer: (_key, minInclusive) => minInclusive,
  triangular: (_key, _min, mode) => mode,
  weighted: <T extends string>(
    _key: Parameters<RandomOracle["weighted"]>[0],
    weights: Readonly<Record<T, number>>,
  ): T => {
    const selected = (Object.keys(weights) as T[])[0];
    if (selected === undefined) throw new Error("Developer oracle received no weights");
    return selected;
  },
  shuffle: <T>(_key: Parameters<RandomOracle["shuffle"]>[0], values: readonly T[]) => [
    ...values,
  ],
};

const BENIGN_SUSPICIOUS_SIGNAL_ORACLE: RandomOracle = {
  ...GUARANTEED_SUCCESS_ORACLE,
  weighted: <T extends string>(
    _key: Parameters<RandomOracle["weighted"]>[0],
    weights: Readonly<Record<T, number>>,
  ): T => {
    if (Object.hasOwn(weights, "suspicious-signal")) {
      return "suspicious-signal" as T;
    }
    const selected = (Object.keys(weights) as T[])[0];
    if (selected === undefined) throw new Error("Developer oracle received no weights");
    return selected;
  },
};

/**
 * False Dawn is the one playtest whose purpose depends on a specific hidden
 * lineage result. Registration oracles affect only the one-time SI draw;
 * custody thresholds use a middle draw and every later proof, incident, and
 * rollout uses the normal seeded oracle. Prosperity also reaches a genuine
 * result naturally through FC 100 and the production probability curve.
 */
const FALSE_DAWN_REGISTRATION_ORACLE: RandomOracle = {
  ...GUARANTEED_SUCCESS_ORACLE,
  uniform: (key) => (key.segments[0] === "endgame-si-v1" ? 0.999_999 : 0.5),
};

const GENUINE_SI_REGISTRATION_ORACLE: RandomOracle = {
  ...GUARANTEED_SUCCESS_ORACLE,
  uniform: (key) => (key.segments[0] === "endgame-si-v1" ? 0.000_001 : 0.5),
};

function enterAndNominateDeveloperCandidate(
  state: GameState,
  content: CompiledContent,
): GameState {
  const entered = advanceOneTick(state, content).state;
  if (entered.endgame.stage !== "candidate-activation") {
    throw new Error(
      `Direct endgame fixture expected candidate activation; got ${entered.endgame.stage}`,
    );
  }
  const candidateModelId = entered.endgame.eligibleModelIds[0];
  if (candidateModelId === undefined) {
    throw new Error("Direct endgame fixture has no candidate to nominate");
  }
  const tx = createTransaction(entered);
  nominateCandidate(tx, candidateModelId);
  return tx.commit({ description: "nominate direct endgame playtest candidate" }).state;
}

function advanceUntilEndgameStage(
  state: GameState,
  content: CompiledContent,
  predicate: (candidate: Readonly<GameState>) => boolean,
  maxWeeks: number,
  description: string,
): GameState {
  let current = state;
  for (let week = 0; week < maxWeeks && !predicate(current); week += 1) {
    current = advanceOneTick(current, content).state;
  }
  if (!predicate(current)) {
    throw new Error(
      `${description} did not reach its direct playtest checkpoint within ${String(maxWeeks)} weeks`,
    );
  }
  return current;
}

function createDirectEndgamePlaytestState(
  state: GameState,
  content: CompiledContent,
  scenarioId: Extract<
    EndgamePlaytestScenarioId,
    | "endgame-false-alarm"
    | "endgame-disputed-proof"
    | "endgame-recovery"
    | "endgame-route-twist"
  >,
  candidateModelId: ModelId,
): GameState {
  if (scenarioId === "endgame-false-alarm") {
    const tx = createTransaction(state);
    tx.update((draft) => {
      const artifact = draft.models[candidateModelId]?.candidateArtifact;
      if (artifact === undefined) throw new Error("False-alarm fixture lost custody");
      artifact.hazardPressure = artifact.incidentThreshold;
    });
    if (
      !resolveCandidatePressureCrossing(
        tx,
        candidateModelId,
        "weekly-pressure",
        BENIGN_SUSPICIOUS_SIGNAL_ORACLE,
      )
    ) {
      throw new Error("False-alarm fixture failed to cross its custody threshold");
    }
    return tx.commit({ description: "seed a benign suspicious custody signal" }).state;
  }

  const nominated = enterAndNominateDeveloperCandidate(state, content);
  if (nominated.endgame.stage !== "confirmation") {
    throw new Error("Direct endgame fixture failed to nominate its candidate");
  }
  const nominatedModelId = nominated.endgame.candidateModelId;

  if (scenarioId === "endgame-disputed-proof") {
    const tx = createTransaction(nominated);
    beginCapabilityProof(tx, content, "declare-from-benchmarks");
    return tx.commit({ description: "seed a disputed benchmark declaration" }).state;
  }

  if (scenarioId === "endgame-recovery") {
    const tx = createTransaction(nominated);
    configureCandidateRetirement(
      tx,
      nominatedModelId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
    );
    const modelName = nominated.models[nominatedModelId]?.displayName;
    if (modelName === undefined) throw new Error("Recovery fixture candidate vanished");
    transmitCandidateRetirement(
      tx,
      content,
      nominatedModelId,
      `RETIRE ${modelName}`,
      GUARANTEED_SUCCESS_ORACLE,
    );
    return tx.commit({ description: "seed verified candidate retirement recovery" })
      .state;
  }

  const proofTx = createTransaction(nominated);
  beginCapabilityProof(proofTx, content, "generalist-gauntlet", "candidate-designed");
  let prepared = proofTx.commit({ description: "begin direct route proof" }).state;
  prepared = advanceUntilEndgameStage(
    prepared,
    content,
    (candidate) => candidate.endgame.stage === "evidence-sprint",
    16,
    "Capability proof",
  );
  const responseTx = createTransaction(prepared);
  commitCandidateSafetyResponse(responseTx, content, "proceed-blind");
  prepared = responseTx.commit({ description: "commit direct route response" }).state;
  if (prepared.endgame.stage !== "final-review") {
    throw new Error(
      `Direct route fixture expected final review; got ${prepared.endgame.stage}`,
    );
  }
  const routeTx = createTransaction(prepared);
  chooseDeploymentMode(
    routeTx,
    content,
    "fortress-contained-pilot",
    "developer:endgame-route-twist" as CommandId,
    GUARANTEED_SUCCESS_ORACLE,
  );
  prepared = routeTx.commit({ description: "begin contained-pilot route" }).state;
  return advanceUntilEndgameStage(
    prepared,
    content,
    (candidate) =>
      candidate.endgame.stage === "rollout" && candidate.endgame.awaitingDecision,
    16,
    "Contained-pilot route",
  );
}

/**
 * Builds a deterministic, deliberately synthetic lab one simulation week before
 * either the player's Deployment Crisis or a rival candidate countdown. Player
 * fixtures omit the expensive training project but register its completed
 * weights through the same registerCompletedTrainingArtifact function called by
 * ordinary training completion. Their first weekly step then reaches the same
 * end-of-tick detectAndEnterDeploymentCrisis system used in a normal campaign.
 * These fixtures live behind the debug export and are never used by ordinary
 * new-game creation or included in production entry points.
 */
export function createEndgamePlaytestState(
  content: CompiledContent,
  scenarioId: EndgamePlaytestScenarioId = "endgame",
): GameState {
  const state = createBaseline(content);
  applyMatureRivalProfiles(state);
  if (scenarioId === "endgame-rival" || scenarioId === "endgame-rival-false-dawn") {
    applyRivalPreset(state);
  } else {
    applyPlayerPreset(state, scenarioId);
  }
  reconcileEndgameInfrastructure(state, content);
  reconcileEndgameRivalInfrastructure(state, content);
  seedMaturePaperArchive(state, content);

  state.run.autoPauseReasons = [];
  state.presentationQueue = [];

  // Candidate custody registration below is part of constructing this
  // synthetic fixture. Assert only after that atomic setup is complete: a
  // gate-clearing model without its artifact record is intentionally invalid.
  const reconciliationTx = createTransaction(state);
  reconcilePaperBenefits(reconciliationTx, content);
  seedEndgameRivalPublicState(reconciliationTx, content);
  const candidateOwnerLabId =
    scenarioId === "endgame-rival" || scenarioId === "endgame-rival-false-dawn"
      ? (Object.keys(reconciliationTx.read().world.rivals).sort()[0] as LabId | undefined)
      : reconciliationTx.read().run.playerLabId;
  const candidateModelId =
    candidateOwnerLabId === undefined
      ? undefined
      : reconciliationTx.read().labs[candidateOwnerLabId]?.models.currentModelId;
  if (candidateModelId === undefined) {
    throw new Error(`Endgame playtest scenario ${scenarioId} has no candidate artifact`);
  }
  const scenarioDefinition = ENDGAME_PLAYTEST_SCENARIOS.find(
    (scenario) => scenario.id === scenarioId,
  );
  if (scenarioDefinition === undefined) {
    throw new Error(`Endgame playtest scenario ${scenarioId} has no definition`);
  }
  // Entry profiles are outcome-family test fixtures: all can reach genuine-SI
  // resolution branches except the dedicated deterministic False Dawn. This
  // prevents the shared debug seed from accidentally making every route end in
  // the same ontic reveal while leaving every later gate on production logic.
  const registrationOracle =
    scenarioId === "endgame-false-dawn" || scenarioId === "endgame-rival-false-dawn"
      ? FALSE_DAWN_REGISTRATION_ORACLE
      : scenarioDefinition.trigger === "player"
        ? GENUINE_SI_REGISTRATION_ORACLE
        : new RandomOracleV1(reconciliationTx.read().run.seed);
  if (
    !registerCompletedTrainingArtifact(
      reconciliationTx,
      candidateModelId,
      registrationOracle,
    )
  ) {
    throw new Error(
      `Endgame playtest scenario ${scenarioId} failed to register its qualifying artifact`,
    );
  }
  if (scenarioId === "endgame-multi-latent") {
    const source = reconciliationTx.read().models[candidateModelId];
    if (source === undefined) throw new Error("Multi-artifact fixture source vanished");
    const secondModelId = reconciliationTx.allocateId(
      "model",
      source.ownerLabId,
    ) as ModelId;
    reconciliationTx.update((draft) => {
      const mutableSource = draft.models[candidateModelId];
      const owner = draft.labs[source.ownerLabId];
      if (mutableSource === undefined || owner === undefined) {
        throw new Error("Multi-artifact fixture owner vanished");
      }
      const second = structuredClone(mutableSource);
      second.id = secondModelId;
      second.lineageId = secondModelId as unknown as ModelLineageId;
      second.generationIndex += 1;
      second.displayName = `${mutableSource.displayName}-B`;
      second.trainedAt = draft.run.tick;
      second.evaluations = [];
      second.anomalies = [];
      second.flags = {};
      delete second.candidateArtifact;
      delete second.derivedFromModelId;
      draft.models[secondModelId] = second;
      owner.models.modelIds.push(secondModelId);
    });
    if (
      !registerCompletedTrainingArtifact(
        reconciliationTx,
        secondModelId,
        new RandomOracleV1(reconciliationTx.read().run.seed),
      )
    ) {
      throw new Error("Multi-artifact fixture failed to register its second lineage");
    }
  }
  const reconciled = reconciliationTx.commit({
    description: `seed mature endgame world for ${scenarioId}`,
  }).state;
  assertInvariants(reconciled);

  if (scenarioId === "endgame-rival" || scenarioId === "endgame-rival-false-dawn") {
    if (detectEndgameTrigger(reconciled) !== null) {
      throw new Error("Rival playtest scenario unexpectedly armed the player crisis");
    }
    if (scenarioId === "endgame-rival-false-dawn") {
      const countdownTx = createTransaction(reconciled);
      advanceRivalCandidateCountdowns(
        countdownTx,
        new RandomOracleV1(reconciled.run.seed),
      );
      const started = countdownTx.commit({
        description: "start deterministic rival False Dawn countdown",
      }).state;
      const rivalLabId = candidateOwnerLabId;
      if (rivalLabId === undefined) {
        throw new Error("Rival False Dawn fixture lost its rival lab");
      }
      const countdown = started.world.rivals[rivalLabId]?.candidateCountdown;
      if (countdown === undefined) {
        throw new Error("Rival False Dawn fixture failed to start its countdown");
      }
      const due = structuredClone(started) as DeepMutable<GameState>;
      // `advanceOneTick` processes the current tick before incrementing the
      // calendar. Loading at the due boundary therefore places the player one
      // final weekly step before the countdown resolution.
      due.run.tick = countdown.completesAt;
      due.run.calendar = calendarFromTick(due.run.tick);
      due.run.autoPauseReasons = [];
      alignMarketCyclesAfterTickJump(due);
      assertInvariants(due);
      return due;
    }
    return reconciled;
  }

  if (scenarioId === "endgame-multi-latent") {
    const entered = advanceOneTick(reconciled, content).state;
    if (entered.endgame.stage !== "candidate-activation") {
      throw new Error(
        `Multi-artifact fixture expected candidate activation; got ${entered.endgame.stage}`,
      );
    }
    if (entered.endgame.eligibleModelIds.length < 2) {
      throw new Error("Multi-artifact fixture did not expose both qualifying lineages");
    }
    assertInvariants(entered);
    return entered;
  }

  if (scenarioId.startsWith("endgame-") && scenarioId !== "endgame-prosperity") {
    if (
      scenarioId === "endgame-false-alarm" ||
      scenarioId === "endgame-disputed-proof" ||
      scenarioId === "endgame-recovery" ||
      scenarioId === "endgame-route-twist"
    ) {
      const direct = createDirectEndgamePlaytestState(
        reconciled,
        content,
        scenarioId,
        candidateModelId,
      );
      assertInvariants(direct);
      return direct;
    }
  }

  const entered = advanceOneTick(reconciled, content).state;
  if (entered.endgame.stage !== "candidate-activation") {
    throw new Error(
      `Endgame playtest scenario ${scenarioId} failed to enter candidate activation; got ${entered.endgame.stage}`,
    );
  }
  return reconciled;
}
