import { accessAcceleration, CANDIDATE_ACCESS_RULES } from "../endgame/access.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type {
  AutonomyAccessLevel,
  GameState,
  ModelState,
  RivalStrategicPlanId,
} from "../model/state.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import {
  driftAutonomySafety,
  STANDING_AUTONOMY_REQUIREMENTS,
} from "../models/autonomy.ts";
import { recordRivalPublicSignal } from "./signals.ts";

const ACCESS_LEVELS = [0, 1, 2, 3, 4, 5] as const;

const PLAN_APPETITE_BONUS: Readonly<Record<RivalStrategicPlanId, number>> = {
  "balanced-research": 0,
  "publish-sprint": 5,
  "frontier-training": 15,
  "commercial-consolidation": 0,
  "safety-stand-down": -100,
  "talent-raid": 5,
  "government-partnership": -10,
  "coalition-outreach": -10,
};

/** Capability evidence a rival uses when deciding how much access to grant. */
export function rivalAutonomyCapability(model: Readonly<ModelState>): number {
  return (
    model.measuredCapability?.frontierCapability ??
    calculateFrontierCapability(model.trueCapability)
  );
}

/**
 * Rival access appetite is driven only by that rival's own policy and model.
 * High-urgency labs use every unlocked rung; safety-led labs still use
 * supervised tools, but stop short of lab control and root access.
 */
export function chooseRivalAutonomyLevel(
  state: Readonly<GameState>,
  labId: LabId,
): AutonomyAccessLevel {
  const lab = state.labs[labId];
  const strategy = state.world.rivals[labId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (
    lab === undefined ||
    lab.control !== "rival" ||
    strategy === undefined ||
    model === undefined
  ) {
    return 0;
  }

  const capability = rivalAutonomyCapability(model);
  const unlocked = ACCESS_LEVELS.filter(
    (level) => capability >= STANDING_AUTONOMY_REQUIREMENTS[level].frontierCapability,
  ).at(-1);
  if (unlocked === undefined || unlocked === 0) return 0;
  if (strategy.currentPlanId === "safety-stand-down") {
    return Math.min(unlocked, 1) as AutonomyAccessLevel;
  }

  const appetite =
    strategy.personality.raceUrgency +
    strategy.personality.financialRisk * 0.25 -
    strategy.personality.safetyCommitment * 0.75 +
    PLAN_APPETITE_BONUS[strategy.currentPlanId];
  const willingCeiling: AutonomyAccessLevel =
    appetite >= 55 ? 5 : appetite >= 35 ? 4 : appetite >= 15 ? 3 : 2;
  return Math.min(unlocked, willingCeiling) as AutonomyAccessLevel;
}

/** Research acceleration delivered by the rival's current RSI permissions. */
export function rivalAutonomyMultiplier(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  const modelId = state.labs[labId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) return 1;
  return accessAcceleration(
    CANDIDATE_ACCESS_RULES[model.accessLevel],
    rivalAutonomyCapability(model),
  );
}

/**
 * Set each rival's standing access for the week, emit an intelligence-filtered
 * public signal when policy changes, and apply the same hidden safety drift as
 * the player's Autonomy Programme.
 */
export function advanceRivalAutonomy(tx: SimulationTransaction): void {
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    const state = tx.read();
    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) continue;
    const previousLevel = model.accessLevel;
    const level = chooseRivalAutonomyLevel(state, labId);

    tx.update((draft) => {
      const mutable = draft.models[model.id];
      if (mutable === undefined) return;
      mutable.accessLevel = level;
      if (mutable.candidateArtifact !== undefined) {
        mutable.candidateArtifact.maximumAccessEver = Math.max(
          mutable.candidateArtifact.maximumAccessEver,
          level,
        ) as AutonomyAccessLevel;
      }
      driftAutonomySafety(mutable);
      if (level !== previousLevel) {
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary:
            level > previousLevel
              ? `Rival watch: ${labId} expanded model-directed research access to level ${String(level)}.`
              : `Rival watch: ${labId} reduced model-directed research access to level ${String(level)}.`,
          category: "narrative",
          source: { kind: "system", id: `rival-autonomy:${labId}` },
          relatedIds: [labId, model.id],
        });
      }
    });

    if (level !== previousLevel) {
      recordRivalPublicSignal(tx, {
        labId,
        kind: "autonomy",
        subjectId: model.id,
        actualValue: level,
        baseErrorRadius: 0.75,
        summary:
          level > previousLevel
            ? "Analysts report an expansion of model-directed research access."
            : "Analysts report a partial rollback of model-directed research access.",
      });
    }
  }
}
