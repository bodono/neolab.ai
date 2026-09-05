import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { calculateFrontierCapability } from "../models/capability.ts";
import type { LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import type { SimulationTransaction } from "./transaction.ts";

// The talent-market contract already treats a Product model at FC 30 as the
// scaling-wave trigger (GDD 37.3). The phase's 35 upper description is a tonal
// target, not a hidden hard gate.
export const SCALING_PHASE_FRONTIER_CAPABILITY = 30;
export const FRONTIER_PHASE_FRONTIER_CAPABILITY = 60;

/** Frontier-capability points clear of the field that count as a total runaway. */
const FRONTIER_LEAD_FULL_SHARE = 20;
const CAPABILITY_COMPARISON_EPSILON = 1e-9;

function clearsCapabilityThreshold(value: number, threshold: number): boolean {
  return value >= threshold - CAPABILITY_COMPARISON_EPSILON;
}

function bestFrontierCapability(
  state: Readonly<GameState>,
  include: (ownerLabId: LabId) => boolean,
): number {
  return Object.values(state.models).reduce(
    (maximum, model) =>
      include(model.ownerLabId)
        ? Math.max(maximum, calculateFrontierCapability(model.trueCapability))
        : maximum,
    0,
  );
}

function maximumWorldFrontierCapability(state: Readonly<GameState>): number {
  return bestFrontierCapability(state, () => true);
}

/**
 * How far a lab's best model sits ahead of the best model anyone else has, as a
 * share of a runaway lead: 0 while the field is level or ahead, 1 once the lab
 * is {@link FRONTIER_LEAD_FULL_SHARE} points clear on its own.
 *
 * Computed identically for every lab, so it never asks who the player is. It is
 * the world's handle on "who is out in front" — the state watches them harder
 * and rivals raid their people harder, whoever they turn out to be.
 */
export function frontierLeadShare(state: Readonly<GameState>, labId: LabId): number {
  const own = bestFrontierCapability(state, (ownerLabId) => ownerLabId === labId);
  const field = bestFrontierCapability(state, (ownerLabId) => ownerLabId !== labId);
  // Being first to train anything is not a lead. Until someone else has a model
  // there is no field to be ahead of, and the opening months would otherwise
  // read as a total runaway for whoever finished their first run first.
  if (field <= 0 || own <= field) return 0;
  return Math.min(1, (own - field) / FRONTIER_LEAD_FULL_SHARE);
}

/**
 * Advance at most one ordinary-play phase per week. A single unusually strong
 * model therefore cannot silently skip the Scaling phase and its unlocks.
 * Crisis entry remains owned by the endgame state machine.
 */
export function advanceWorldPhase(tx: SimulationTransaction): void {
  const current = tx.read().run.phase;
  if (current === "crisis") return;
  const frontierCapability = maximumWorldFrontierCapability(tx.read());
  const next =
    current === "foundation" &&
    clearsCapabilityThreshold(frontierCapability, SCALING_PHASE_FRONTIER_CAPABILITY)
      ? "scaling"
      : current === "scaling" &&
          clearsCapabilityThreshold(
            frontierCapability,
            FRONTIER_PHASE_FRONTIER_CAPABILITY,
          )
        ? "frontier"
        : undefined;
  if (next === undefined) return;
  tx.update((draft) => {
    draft.run.phase = next;
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `world-phase:${next}`,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `The global race entered the ${next} phase as frontier capability reached ${frontierCapability.toFixed(1)}.`,
      category: "narrative",
      source: { kind: "system", id: `world-phase:${next}` },
      relatedIds: [],
    });
  });
  tx.emit({
    kind: "world-phase-changed",
    previousPhase: current,
    phase: next,
    frontierCapability,
  });
  // Phase changes unlock research (papers gate on phase-at-least), so the
  // player gets an auto-pausing explanation rather than a silent shift.
  tx.requestAutoPause("world-phase");
}

/**
 * Unlock the next hardware generation when the world's research justifies it.
 * New silicon is announced when the world's maximum frontier capability
 * crosses the generation's authored threshold — a hot race pulls the
 * hardware curve forward instead of waiting for an arbitrary calendar date.
 * At most one generation advances per week, so a capability spike cannot
 * silently skip eras.
 */
export function advanceWorldGpuGeneration(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  const currentId = state.world.currentGpuGenerationId;
  const current = content.gpuGenerations[currentId];
  if (current === undefined) {
    throw new Error(`Unknown current GPU generation ${currentId}`);
  }
  const frontierCapability = maximumWorldFrontierCapability(state);
  const next = (
    Object.entries(content.gpuGenerations) as [
      ContentId,
      (typeof content.gpuGenerations)[string],
    ][]
  )
    .filter(
      ([, definition]) =>
        definition.nominalYear > current.nominalYear &&
        clearsCapabilityThreshold(
          frontierCapability,
          definition.unlockAtWorldFrontierCapability,
        ),
    )
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.nominalYear - right.nominalYear ||
        (leftId < rightId ? -1 : leftId > rightId ? 1 : 0),
    )[0];
  if (next === undefined) return;
  const [generationId, definition] = next;
  tx.update((draft) => {
    draft.world.currentGpuGenerationId = generationId;
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `gpu-generation:${generationId}`,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${definition.displayName} GPUs entered the procurement market as frontier capability reached ${frontierCapability.toFixed(1)}.`,
      category: "narrative",
      source: { kind: "system", id: `gpu-generation:${generationId}` },
      relatedIds: [generationId],
    });
  });
  tx.emit({
    kind: "gpu-generation-unlocked",
    generationId,
    nominalYear: definition.nominalYear,
  });
  // New silicon changes procurement maths for the player; announce it.
  tx.requestAutoPause("gpu-generation");
}

function hasEligibleWorldGpuGeneration(
  state: Readonly<GameState>,
  content: CompiledContent,
): boolean {
  const current = content.gpuGenerations[state.world.currentGpuGenerationId];
  if (current === undefined) return false;
  const frontierCapability = maximumWorldFrontierCapability(state);
  return Object.values(content.gpuGenerations).some(
    (definition) =>
      definition.nominalYear > current.nominalYear &&
      clearsCapabilityThreshold(
        frontierCapability,
        definition.unlockAtWorldFrontierCapability,
      ),
  );
}

/**
 * Advance at most one player-facing world milestone in a week. Hardware goes
 * first because it is the concrete event that makes a new capability regime
 * possible; an eligible phase change follows on the next weekly boundary.
 * This prevents a single strong model from burying two major announcements in
 * the same pause while preserving every unlock.
 */
export function advanceWorldPhaseAfterHardware(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  if (hasEligibleWorldGpuGeneration(tx.read(), content)) return;
  advanceWorldPhase(tx);
}
