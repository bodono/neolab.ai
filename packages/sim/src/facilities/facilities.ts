import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { awardScore } from "../engine/score.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { FacilityId, LabId, ModifierId, ProjectId } from "../model/ids.ts";
import type { FacilityInstanceState, GameState, ModifierState } from "../model/state.ts";
import { cashMillions, tick, type CashMillions, type Tick } from "../model/units.ts";
import { reconcileResearcherHousing } from "../researchers/talent-market.ts";
import { isProgressiveOpeningCreditAvailable } from "../campaign/progressive-opening.ts";

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function requireDefinition(content: CompiledContent, definitionId: ContentId) {
  const definition = content.facilities[definitionId];
  if (definition === undefined) throw new Error(`Unknown facility ${definitionId}`);
  return definition;
}

function baselineOwnedGpuCapacity(content: CompiledContent): number {
  const legacyCompatibleBalance = content.balance as typeof content.balance & {
    readonly facilities?: { readonly baselineOwnedGpuCapacity?: number };
  };
  return legacyCompatibleBalance.facilities?.baselineOwnedGpuCapacity ?? 15_000;
}

function reconcileFacilityStarSlots(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    const enabledSlotFacilities = lab.facilities.instances.filter(
      (instance) =>
        content.facilities[instance.definitionId]?.tags.includes("star-slot") === true,
    ).length;
    lab.roster.starSlots = Math.min(
      content.researchers.rules.ability.hardMaximumSlots,
      content.researchers.rules.ability.initialSlots + enabledSlotFacilities,
    );
  });
  reconcileResearcherHousing(tx, labId);
}

export interface FacilityCapacityView {
  readonly supportedOwnedGpuCount: number;
  readonly installedOwnedGpuCount: number;
  readonly pendingOwnedGpuCount: number;
  readonly ownedGpuHeadroom: number;
}

function supportedOwnedGpuCount(
  baselineOwnedGpuCapacity: number,
  definitions: readonly CompiledContent["facilities"][string][],
): number {
  const maximumByFamily = new Map<string, number>();
  for (const definition of definitions) {
    maximumByFamily.set(
      definition.family,
      Math.max(
        maximumByFamily.get(definition.family) ?? 0,
        definition.supportedOwnedGpuCount,
      ),
    );
  }
  return Math.max(
    baselineOwnedGpuCapacity,
    [...maximumByFamily.values()].reduce((sum, capacity) => sum + capacity, 0),
  );
}

/**
 * Rival campuses are not rendered, but their infrastructure is no longer
 * free. These flags record the same authored facilities after their normal
 * prerequisite chains and construction times have elapsed.
 */
export function rivalFacilityCompleteFlag(definitionId: ContentId): string {
  return `rival:facility:${definitionId}:complete`;
}

export function hasOperationalFacility(
  state: Readonly<GameState>,
  labId: LabId,
  definitionId: ContentId,
): boolean {
  const lab = requireLab(state, labId);
  return (
    lab.facilities.instances.some((instance) => instance.definitionId === definitionId) ||
    lab.flags[rivalFacilityCompleteFlag(definitionId)] === true
  );
}

export function calculateFacilityCapacity(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): FacilityCapacityView {
  const lab = requireLab(state, labId);
  const enabledDefinitionIds = new Set(
    lab.facilities.instances.map((instance) => instance.definitionId),
  );
  if (lab.control === "rival") {
    for (const definition of Object.values(content.facilities)) {
      if (lab.flags[rivalFacilityCompleteFlag(definition.id)] === true) {
        enabledDefinitionIds.add(definition.id);
      }
    }
  }
  const enabledDefinitions = [...enabledDefinitionIds]
    .map((definitionId) => content.facilities[definitionId])
    .filter((definition) => definition !== undefined);
  const installedOwnedGpuCount = lab.compute.lots
    .filter((lot) => lot.ownership === "owned")
    .reduce((sum, lot) => sum + lot.physicalCount, 0);
  const pendingOwnedGpuCount = lab.compute.deliveries
    .filter((delivery) => delivery.ownership === "owned")
    .reduce((sum, delivery) => sum + delivery.physicalCount, 0);
  const ownedGpuCapacity = supportedOwnedGpuCount(
    baselineOwnedGpuCapacity(content),
    enabledDefinitions,
  );
  return {
    supportedOwnedGpuCount: ownedGpuCapacity,
    installedOwnedGpuCount,
    pendingOwnedGpuCount,
    ownedGpuHeadroom: Math.max(
      0,
      ownedGpuCapacity - installedOwnedGpuCount - pendingOwnedGpuCount,
    ),
  };
}

export interface ConstructionQuote {
  readonly definitionId: ContentId;
  readonly displayName: string;
  readonly upfrontCostMillions: CashMillions;
  readonly operatingCostMillionsPerCycle: CashMillions;
  readonly durationWeeks: number;
  readonly majorProjectSlotsRequired: number;
  readonly prerequisiteFacilityIds: readonly ContentId[];
  readonly blockers: readonly string[];
}

const RUBIN_GENERATION_ID = "base:gpu.rubin";
const MARKOV_GENERATION_ID = "base:gpu.markov";

export function facilityTierLimit(
  state: Readonly<GameState>,
  content: CompiledContent,
): number {
  if (state.run.phase === "foundation") return 1;
  if (state.run.phase === "scaling") return 2;
  const current = content.gpuGenerations[state.world.currentGpuGenerationId];
  const rubin = content.gpuGenerations[RUBIN_GENERATION_ID];
  const markov = content.gpuGenerations[MARKOV_GENERATION_ID];
  if (current === undefined || rubin === undefined || markov === undefined) return 3;
  if (current.nominalYear >= markov.nominalYear) return 5;
  if (current.nominalYear >= rubin.nominalYear) return 4;
  return 3;
}

function facilityTierBlocker(tier: number): string {
  if (tier >= 5) return "Requires Markov-era hardware";
  if (tier >= 4) return "Requires Rubin-era hardware";
  if (tier >= 3) return "Requires the frontier phase";
  if (tier >= 2) return "Requires the scaling phase";
  return "Facility is not yet available";
}

export function facilityConstructionMajorProjectSlots(
  definition: CompiledContent["facilities"][string],
): number {
  return definition.tier >= 4 ? 2 : 1;
}

export function facilityScoreMilestoneKey(definitionId: ContentId): string {
  return `facility/completion/${definitionId}`;
}

export function quoteFacilityConstruction(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  definitionId: ContentId,
): ConstructionQuote {
  const lab = requireLab(state, labId);
  const definition = requireDefinition(content, definitionId);
  const openingCreditAvailable = isProgressiveOpeningCreditAvailable(
    state,
    labId,
    "facility-construction",
    definitionId,
  );
  const upfrontCostMillions = cashMillions(definition.cashCostMillions);
  const blockers: string[] = [];
  if (definition.tags.includes("campaign-start-only")) {
    blockers.push("Starting location is not available for construction");
  }
  if (definition.tier > facilityTierLimit(state, content)) {
    blockers.push(facilityTierBlocker(definition.tier));
  }
  if (
    upfrontCostMillions > 0 &&
    lab.finance.cash < upfrontCostMillions &&
    !openingCreditAvailable
  ) {
    blockers.push("Insufficient cash");
  }
  if (
    lab.facilities.instances.some((instance) => instance.definitionId === definitionId)
  ) {
    blockers.push("Facility already completed");
  }
  const alreadyQueued = lab.projects.projectIds.some((projectId) => {
    const project = state.projects[projectId];
    return (
      project !== undefined &&
      project.status !== "cancelled" &&
      project.status !== "failed" &&
      project.payload.kind === "construction" &&
      project.payload.facilityDefinitionId === definitionId
    );
  });
  if (alreadyQueued) blockers.push("Facility already under construction");
  for (const prerequisiteId of definition.prerequisiteFacilityIds) {
    const satisfied = lab.facilities.instances.some(
      (instance) => instance.definitionId === prerequisiteId,
    );
    if (!satisfied) {
      blockers.push(`Requires ${requireDefinition(content, prerequisiteId).displayName}`);
    }
  }
  return {
    definitionId,
    displayName: definition.displayName,
    upfrontCostMillions,
    operatingCostMillionsPerCycle: cashMillions(definition.operatingCostMillionsPerCycle),
    durationWeeks: definition.durationWeeks,
    majorProjectSlotsRequired: facilityConstructionMajorProjectSlots(definition),
    prerequisiteFacilityIds: definition.prerequisiteFacilityIds,
    blockers,
  };
}

function facilityCompletionPoints(content: CompiledContent, scoreTag: string): number {
  const raw = content.scoreRules.awardTables.institutionAwards["facilityFirstCompletion"];
  if (raw === null || typeof raw !== "object") {
    throw new Error("Missing facilityFirstCompletion scoring rule");
  }
  const points = (raw as { pointsByDefinitionTag?: unknown }).pointsByDefinitionTag;
  if (points === null || typeof points !== "object") {
    throw new Error("Facility scoring rule lacks pointsByDefinitionTag");
  }
  const amount = (points as Readonly<Record<string, unknown>>)[scoreTag];
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error(`No facility score for definition tag ${scoreTag}`);
  }
  return amount;
}

function createFacilityModifiers(
  tx: SimulationTransaction,
  definition: CompiledContent["facilities"][string],
  facilityId: FacilityId,
  ownerLabId: LabId,
  startsAt: Tick,
): readonly ModifierId[] {
  const modifierIds: ModifierId[] = [];
  for (const authored of definition.modifiers) {
    const modifierId = tx.allocateId("modifier", "world") as ModifierId;
    const modifier: ModifierState = {
      id: modifierId,
      source: { kind: "facility", id: facilityId },
      labId: ownerLabId,
      target: authored.target,
      operation: authored.operation,
      value: authored.value,
      startsAt,
      ...(authored.activation === undefined ? {} : { activation: authored.activation }),
      tags: ["facility", ...definition.tags],
    };
    tx.update((draft) => {
      draft.modifiers[modifierId] = structuredClone(
        modifier,
      ) as DeepMutable<ModifierState>;
    });
    modifierIds.push(modifierId);
  }
  return modifierIds;
}

export function completeFacilityConstruction(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  projectId: ProjectId,
): FacilityInstanceState {
  const project = tx.read().projects[projectId];
  if (
    project === undefined ||
    project.ownerLabId !== labId ||
    project.payload.kind !== "construction"
  ) {
    throw new Error(`Project ${projectId} is not a construction project for ${labId}`);
  }
  const definition = requireDefinition(content, project.payload.facilityDefinitionId);
  const facilityId = tx.allocateId("facility", labId) as FacilityId;
  const completedAt = tick(tx.read().run.tick + 1);
  const modifierIds = createFacilityModifiers(
    tx,
    definition,
    facilityId,
    labId,
    completedAt,
  );
  const instance: FacilityInstanceState = {
    id: facilityId,
    definitionId: definition.id,
    completedAt,
    majorProjectSlotBonus: definition.bonusMajorProjectSlots,
    modifierIds,
  };
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    lab.facilities.instances.push(
      structuredClone(instance) as DeepMutable<FacilityInstanceState>,
    );
  });
  if (definition.tags.includes("star-slot")) {
    reconcileFacilityStarSlots(tx, content, labId);
  }

  const scoreKey = facilityScoreMilestoneKey(definition.id);
  if (
    labId === tx.read().run.playerLabId &&
    tx.read().score.awardedKeys[scoreKey] !== true
  ) {
    awardScore(tx, {
      key: scoreKey,
      categoryId: "score.institution-building",
      amount: facilityCompletionPoints(content, definition.scoreTag),
      source: { kind: "facility", id: facilityId },
      explanationKey: "score.facility.first",
    });
  }
  return instance;
}
