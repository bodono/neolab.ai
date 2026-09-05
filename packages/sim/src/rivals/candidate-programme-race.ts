import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { fleetTeraflops } from "../compute/flops.ts";
import {
  AGI_COMPONENT_RULES,
  AGI_COMPONENT_TYPES,
  agiComponentFlag,
  isEraReached,
} from "../endgame/candidate-programme.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type { AgiComponentType, GameState } from "../model/state.ts";
import { tick } from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import { rivalInfrastructureFacilityReady } from "./infrastructure.ts";
import { calculateRivalProgressMultiplier } from "./pacing.ts";

/**
 * Rivals run the Candidate Programme too. Their campus is off-screen, but its
 * authored prerequisite chains and lead times are real, as are research
 * readiness, fleet capacity, and the cash needed to buy that fleet. Their
 * candidate countdowns cannot start until all four works stand.
 */
export const RIVAL_CONCURRENT_COMPONENT_BUILDS = 2;
export const RIVAL_AGI_RESEARCH_LEVEL = 70;
export const RIVAL_AGI_START_CHANCE_MIN = 0.2;
export const RIVAL_AGI_START_CHANCE_MAX = 0.3;

const MAX_ANNOUNCEMENTS = 64;

export function agiComponentBuildingFlag(componentType: AgiComponentType): string {
  return `agi-component:${componentType}:building-since`;
}

/** The authored urgency range maps onto a restrained 20–30% weekly start roll. */
export function rivalAgiComponentStartChance(raceUrgency: number): number {
  const boundedUrgency = Math.max(0, Math.min(100, raceUrgency));
  return (
    RIVAL_AGI_START_CHANCE_MIN +
    (RIVAL_AGI_START_CHANCE_MAX - RIVAL_AGI_START_CHANCE_MIN) * (boundedUrgency / 100)
  );
}

function rivalResearchReady(
  state: Readonly<GameState>,
  labId: LabId,
  componentType: AgiComponentType,
): boolean {
  const lab = state.labs[labId];
  const programId = AGI_COMPONENT_RULES[componentType].requirement.researchProgramId;
  if (lab === undefined || programId === undefined) return false;
  const level =
    lab.research.domains[programId]?.level ??
    lab.research.safetyPrograms[programId]?.level ??
    0;
  return level >= RIVAL_AGI_RESEARCH_LEVEL;
}

function buildingComputeBurden(state: Readonly<GameState>, labId: LabId): number {
  const lab = state.labs[labId];
  if (lab === undefined) return 0;
  return AGI_COMPONENT_TYPES.reduce((sum, componentType) => {
    return typeof lab.flags[agiComponentBuildingFlag(componentType)] === "number"
      ? sum + AGI_COMPONENT_RULES[componentType].reservedTeraflops
      : sum;
  }, 0);
}

/**
 * Rivals must own enough real hardware to carry the work. Existing concurrent
 * Candidate Programme construction also counts against that capacity.
 */
export function rivalFleetSupportsAgiComponent(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  componentType: AgiComponentType,
  includeBuildingBurden = true,
): boolean {
  const burden =
    AGI_COMPONENT_RULES[componentType].reservedTeraflops +
    (includeBuildingBurden ? buildingComputeBurden(state, labId) : 0);
  return fleetTeraflops(state, content, labId) >= burden;
}

/** Public for balance tests: all concrete prerequisites before construction. */
export function rivalAgiComponentPrerequisitesMet(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  componentType: AgiComponentType,
): boolean {
  const facilityId = AGI_COMPONENT_RULES[componentType].requirement.facilityId;
  return (
    isEraReached(state, content, AGI_COMPONENT_RULES[componentType].eraGenerationId) &&
    rivalResearchReady(state, labId, componentType) &&
    facilityId !== undefined &&
    rivalInfrastructureFacilityReady(state, labId, facilityId as ContentId) &&
    rivalFleetSupportsAgiComponent(state, content, labId, componentType, false)
  );
}

/**
 * Difficulty represents the pace of the entire rival programme, not only its
 * research output. Keep the authored player duration as the baseline and
 * round to whole simulation weeks after applying the global rival pace.
 */
export function rivalAgiComponentDurationWeeks(
  state: Readonly<GameState>,
  componentType: AgiComponentType,
): number {
  const progressMultiplier = Math.max(0.1, calculateRivalProgressMultiplier(state));
  return Math.max(
    1,
    Math.round(AGI_COMPONENT_RULES[componentType].durationWeeks / progressMultiplier),
  );
}

/** Started/completed counts for a lab, for rival-watch intel. */
export function agiComponentProgress(
  state: Readonly<GameState>,
  labId: LabId,
): { readonly building: number; readonly completed: number } {
  const lab = state.labs[labId];
  if (lab === undefined) return { building: 0, completed: 0 };
  let building = 0;
  let completed = 0;
  for (const componentType of AGI_COMPONENT_TYPES) {
    if (lab.flags[agiComponentFlag(componentType)] === true) completed += 1;
    else if (typeof lab.flags[agiComponentBuildingFlag(componentType)] === "number") {
      building += 1;
    }
  }
  return { building, completed };
}

function announce(
  tx: SimulationTransaction,
  labId: LabId,
  componentType: AgiComponentType,
  kind: "started" | "completed",
): void {
  const rule = AGI_COMPONENT_RULES[componentType];
  tx.update((draft) => {
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        kind === "started"
          ? `Rival watch: ${labId} has broken ground on ${rule.displayName}.`
          : `Rival watch: ${labId} has completed ${rule.displayName}.`,
      category: "narrative",
      source: { kind: "system", id: `rival-agi-component:${labId}:${componentType}` },
      relatedIds: [labId],
    });
    draft.world.rivalComponentAnnouncements = [
      ...draft.world.rivalComponentAnnouncements,
      { labId, componentType, kind, tick: draft.run.tick },
    ].slice(-MAX_ANNOUNCEMENTS);
  });
  tx.emit(
    kind === "started"
      ? { kind: "rival-agi-component-started", labId, componentType }
      : { kind: "rival-agi-component-completed", labId, componentType },
  );
}

/**
 * Weekly rival Candidate Programme step: finish due works, then break ground
 * on the next one (up to two concurrent). Every work requires the rival's own
 * level-70 research, the same named prerequisite facility chain as the player,
 * and real fleet capacity. Start timing is then jittered at 20–30% per rival
 * and week so the field spreads out.
 */
export function advanceRivalCandidateProgramme(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const state = tx.read();
  const anyWorkOpen = AGI_COMPONENT_TYPES.some((componentType) =>
    isEraReached(state, content, AGI_COMPONENT_RULES[componentType].eraGenerationId),
  );
  if (state.run.status !== "active" || !anyWorkOpen) return;
  for (const labId of Object.keys(state.world.rivals).sort() as LabId[]) {
    const lab = tx.read().labs[labId];
    if (lab === undefined || lab.control !== "rival") continue;

    // Complete works whose build time has elapsed.
    for (const componentType of AGI_COMPONENT_TYPES) {
      const since = lab.flags[agiComponentBuildingFlag(componentType)];
      if (typeof since !== "number") continue;
      if (
        tx.read().run.tick - since <
        rivalAgiComponentDurationWeeks(tx.read(), componentType)
      ) {
        continue;
      }
      tx.update((draft) => {
        const mutable = draft.labs[labId];
        if (mutable === undefined) throw new Error(`Unknown rival ${labId}`);
        delete mutable.flags[agiComponentBuildingFlag(componentType)];
        mutable.flags[agiComponentFlag(componentType)] = true;
      });
      announce(tx, labId, componentType, "completed");
    }

    // Break ground on the next work if a build slot is free.
    const progress = agiComponentProgress(tx.read(), labId);
    if (progress.building >= RIVAL_CONCURRENT_COMPONENT_BUILDS) continue;
    const next = AGI_COMPONENT_TYPES.find((componentType) => {
      const current = tx.read().labs[labId];
      return (
        current !== undefined &&
        rivalAgiComponentPrerequisitesMet(tx.read(), content, labId, componentType) &&
        rivalFleetSupportsAgiComponent(tx.read(), content, labId, componentType) &&
        current.flags[agiComponentFlag(componentType)] !== true &&
        typeof current.flags[agiComponentBuildingFlag(componentType)] !== "number"
      );
    });
    if (next === undefined) continue;
    const urgency = tx.read().world.rivals[labId]?.personality.raceUrgency ?? 50;
    const startChance = rivalAgiComponentStartChance(urgency);
    const roll = random.uniform(
      randomKey("rival-agi-component", labId, next, String(tx.read().run.tick), "start"),
    );
    if (roll > startChance) continue;
    tx.update((draft) => {
      const mutable = draft.labs[labId];
      if (mutable === undefined) throw new Error(`Unknown rival ${labId}`);
      mutable.flags[agiComponentBuildingFlag(next)] = tick(draft.run.tick);
    });
    announce(tx, labId, next, "started");
  }
}
