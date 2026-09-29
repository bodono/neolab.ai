import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import {
  facilityConstructionMajorProjectSlots,
  facilityTierLimit,
  hasOperationalFacility,
  rivalFacilityCompleteFlag,
} from "../facilities/facilities.ts";
import type { LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import { tick } from "../model/units.ts";
import {
  AGI_COMPONENT_RULES,
  AGI_COMPONENT_TYPES,
} from "../endgame/candidate-programme.ts";
import { calculateRivalProgressMultiplier } from "./pacing.ts";

/**
 * The visible player builds these roots and every prerequisite below them.
 * Rivals now do the same work off-screen rather than inheriting a finished
 * Basilica and four prerequisite facilities on day one.
 */
const RIVAL_INFRASTRUCTURE_ROOTS = [
  "base:facility.data-centre-5",
  ...AGI_COMPONENT_TYPES.map(
    (componentType) => AGI_COMPONENT_RULES[componentType].requirement.facilityId,
  ),
].filter((definitionId): definitionId is ContentId => definitionId !== undefined);

/**
 * The collider → Time Sphere chain used to begin visibly at the final unlock,
 * leaving every rival parked at 3/4 works for 146 authored weeks plus the World
 * Engine build. Rivals now prepare most of this off-screen before the public
 * late-game milestone; these durations represent the final commissioning work.
 * The dependency remains serial and the World Engine still has its full build.
 */
const RIVAL_PREPARED_LATE_FACILITY_REMAINING_FRACTION = 0.2;
const RIVAL_PREPARED_LATE_FACILITIES = new Set<ContentId>([
  "base:facility.hadron-collider-1" as ContentId,
  "base:facility.time-sphere-1" as ContentId,
]);

export function rivalFacilityBuildingFlag(definitionId: ContentId): string {
  return `rival:facility:${definitionId}:building-since`;
}

function requiredInfrastructureIds(content: CompiledContent): readonly ContentId[] {
  const required = new Set<ContentId>();
  const visit = (definitionId: ContentId): void => {
    if (required.has(definitionId)) return;
    const definition = content.facilities[definitionId];
    if (definition === undefined) {
      throw new Error(`Unknown rival infrastructure facility ${definitionId}`);
    }
    // Starting locations are inherited from campaign setup and can never be
    // commissioned later by either side.
    if (definition.tags.includes("campaign-start-only")) return;
    required.add(definitionId);
    for (const prerequisiteId of definition.prerequisiteFacilityIds) {
      visit(prerequisiteId);
    }
  };
  for (const rootId of RIVAL_INFRASTRUCTURE_ROOTS) visit(rootId);
  return [...required].sort((left, right) => {
    const leftDefinition = content.facilities[left];
    const rightDefinition = content.facilities[right];
    const leftDatacentre =
      leftDefinition?.family === "data-centre" ||
      leftDefinition?.family === "power-and-cooling";
    const rightDatacentre =
      rightDefinition?.family === "data-centre" ||
      rightDefinition?.family === "power-and-cooling";
    return (
      (leftDefinition?.tier ?? 0) - (rightDefinition?.tier ?? 0) ||
      Number(rightDatacentre) - Number(leftDatacentre) ||
      (left < right ? -1 : left > right ? 1 : 0)
    );
  });
}

export function rivalFacilityDurationWeeks(
  state: Readonly<GameState>,
  content: CompiledContent,
  definitionId: ContentId,
): number {
  const definition = content.facilities[definitionId];
  if (definition === undefined) throw new Error(`Unknown facility ${definitionId}`);
  if (RIVAL_PREPARED_LATE_FACILITIES.has(definitionId)) {
    return Math.max(
      1,
      Math.round(
        (definition.durationWeeks * RIVAL_PREPARED_LATE_FACILITY_REMAINING_FRACTION) /
          Math.max(1, calculateRivalProgressMultiplier(state)),
      ),
    );
  }
  return Math.max(
    1,
    Math.round(
      definition.durationWeeks / Math.max(0.1, calculateRivalProgressMultiplier(state)),
    ),
  );
}

export function rivalInfrastructureFacilityReady(
  state: Readonly<GameState>,
  labId: LabId,
  definitionId: ContentId,
): boolean {
  return hasOperationalFacility(state, labId, definitionId);
}

function availableConstructionSlotsWithContent(
  state: Readonly<GameState>,
  content: CompiledContent,
): number {
  // Mirrors the player's expansion from two opening slots toward five late-game
  // slots without pretending every rival has a specific named headquarters.
  return Math.min(5, 1 + facilityTierLimit(state, content));
}

function occupiedConstructionSlots(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): number {
  const lab = state.labs[labId];
  if (lab === undefined) return 0;
  return requiredInfrastructureIds(content).reduce((total, definitionId) => {
    if (typeof lab.flags[rivalFacilityBuildingFlag(definitionId)] !== "number") {
      return total;
    }
    const definition = content.facilities[definitionId];
    if (definition === undefined) {
      throw new Error(`Unknown rival infrastructure facility ${definitionId}`);
    }
    return total + facilityConstructionMajorProjectSlots(definition);
  }, 0);
}

/** Advance the off-screen campus by one week using authored dependencies. */
export function advanceRivalInfrastructure(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  if (tx.read().run.status !== "active") return;
  const requiredIds = requiredInfrastructureIds(content);
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    const lab = tx.read().labs[labId];
    if (lab === undefined || lab.control !== "rival") continue;

    for (const definitionId of requiredIds) {
      const current = tx.read().labs[labId];
      const startedAt = current?.flags[rivalFacilityBuildingFlag(definitionId)];
      if (typeof startedAt !== "number") continue;
      if (
        tx.read().run.tick - startedAt <
        rivalFacilityDurationWeeks(tx.read(), content, definitionId)
      ) {
        continue;
      }
      tx.update((draft) => {
        const mutable = draft.labs[labId];
        if (mutable === undefined) throw new Error(`Unknown rival ${labId}`);
        delete mutable.flags[rivalFacilityBuildingFlag(definitionId)];
        mutable.flags[rivalFacilityCompleteFlag(definitionId)] = true;
      });
    }

    // Break ground in authored order while slots last. A rival pays the same
    // authored price as the player and saves for the next build rather than
    // skipping ahead to a cheaper one.
    for (;;) {
      const next = nextRivalInfrastructureStart(tx.read(), content, labId);
      if (next === undefined) break;
      const cost = content.facilities[next]?.cashCostMillions ?? 0;
      if ((tx.read().labs[labId]?.finance.cash ?? 0) < cost) break;
      applyEffect(
        tx,
        {
          kind: "add-resource",
          subject: { type: "lab", labId },
          resource: "cash",
          amount: -cost,
          financeCategory: "project-cost",
        },
        { kind: "system", id: `rival-facility:${labId}:${next}` },
      );
      tx.update((draft) => {
        const mutable = draft.labs[labId];
        if (mutable === undefined) throw new Error(`Unknown rival ${labId}`);
        mutable.flags[rivalFacilityBuildingFlag(next)] = tick(draft.run.tick);
      });
    }
  }
}

/**
 * The next facility this rival would break ground on now, if it could pay:
 * the first unbuilt facility in authored order whose prerequisites stand,
 * whose tier is unlocked, and which fits the free construction slots.
 */
export function nextRivalInfrastructureStart(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): ContentId | undefined {
  const lab = state.labs[labId];
  if (lab === undefined || lab.control !== "rival") return undefined;
  const freeSlots =
    availableConstructionSlotsWithContent(state, content) -
    occupiedConstructionSlots(state, content, labId);
  if (freeSlots <= 0) return undefined;
  return requiredInfrastructureIds(content).find((definitionId) => {
    const definition = content.facilities[definitionId];
    return (
      definition !== undefined &&
      facilityConstructionMajorProjectSlots(definition) <= freeSlots &&
      definition.tier <= facilityTierLimit(state, content) &&
      !rivalInfrastructureFacilityReady(state, labId, definitionId) &&
      typeof lab.flags[rivalFacilityBuildingFlag(definitionId)] !== "number" &&
      definition.prerequisiteFacilityIds.every((prerequisiteId) =>
        rivalInfrastructureFacilityReady(state, labId, prerequisiteId),
      )
    );
  });
}
