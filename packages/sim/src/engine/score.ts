import type { CompiledContent, ContentId } from "@neolab/content-schema";

import { endingClassForId } from "../endgame/ending-class.ts";
import {
  deriveProsperityProgrammes,
  findProsperityProgramme,
} from "../prosperity/prosperity.ts";
import type {
  FinalScoreRecord,
  ScoreCategoryId,
  ScoreLedgerEntry,
} from "../model/state.ts";
import type { SimulationTransaction } from "./transaction.ts";

export const SCORE_CATEGORY_IDS: readonly ScoreCategoryId[] = [
  "score.scientific-legacy",
  "score.safe-stewardship",
  "score.prosperity-impact",
  "score.institution-building",
  "score.race-operations",
  "score.endgame",
];

/**
 * Score ledger writes (TDD section 18.5, GDD section 41.5).
 *
 * Score is canonical, deterministic state with NO outgoing modifiers: no
 * economy, research, rival, event, or endgame system may read score to change
 * an outcome. That direction is enforced by lint (engine code cannot import
 * selectors) and by keeping reads in `selectors/score-view.ts`.
 *
 * Every award uses a stable semantic key, e.g.
 * `paper/world-first/paper.transformer`; duplicate keys are rejected so
 * milestones can never be farmed (anti-farming rules in content/scoring.yaml).
 */
export function awardScore(
  tx: SimulationTransaction,
  entry: Omit<ScoreLedgerEntry, "tick">,
): void {
  if (entry.key.trim().length === 0) {
    throw new Error("awardScore: empty semantic key");
  }
  if (!Number.isFinite(entry.amount)) {
    throw new Error(`awardScore(${entry.key}): non-finite amount`);
  }
  const current = tx.read();
  if (current.score.awardedKeys[entry.key] === true) {
    throw new Error(
      `awardScore: duplicate semantic key "${entry.key}" — milestones score once`,
    );
  }
  tx.update((draft) => {
    draft.score.entries.push({
      ...structuredClone(entry),
      tick: draft.run.tick,
    });
    draft.score.awardedKeys[entry.key] = true;
  });
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid score rule ${label}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid score number ${label}`);
  }
  return value;
}

function category(value: unknown, label: string): ScoreCategoryId {
  if (!SCORE_CATEGORY_IDS.includes(value as ScoreCategoryId)) {
    throw new Error(`Invalid score category ${label}`);
  }
  return value as ScoreCategoryId;
}

function pointRule(
  table: Readonly<Record<string, unknown>>,
  key: string,
): { readonly categoryId: ScoreCategoryId; readonly points: number } {
  const rule = record(table[key], key);
  return {
    categoryId: category(rule["category"], `${key}.category`),
    points: number(rule["points"], `${key}.points`),
  };
}

function awardOnce(
  tx: SimulationTransaction,
  entry: Omit<ScoreLedgerEntry, "tick">,
): void {
  if (tx.read().score.awardedKeys[entry.key] !== true) awardScore(tx, entry);
}

/** Awards the two authored 60/80 readiness milestones once per programme. */
export function awardProsperityReadinessMilestones(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const table = content.scoreRules.awardTables.prosperityAwards;
  const milestones = [
    [60, pointRule(table, "prosperityReadiness60")],
    [80, pointRule(table, "prosperityReadiness80")],
  ] as const;
  const state = tx.read();
  const selectedId =
    state.endgame.stage === "rollout" || state.endgame.stage === "resolved"
      ? state.endgame.prosperityProgrammeId
      : undefined;
  const programmes = deriveProsperityProgrammes(state, content).map((programme) =>
    programme.id === selectedId
      ? findProsperityProgramme(
          state,
          content,
          programme.id,
          state.endgame.stage === "rollout" || state.endgame.stage === "resolved"
            ? state.endgame.evidence.prosperityReadinessBonus
            : 0,
        )
      : programme,
  );
  for (const programme of programmes) {
    for (const [threshold, rule] of milestones) {
      if (programme.readiness < threshold) continue;
      awardOnce(tx, {
        key: `prosperity/readiness/${programme.id}/${String(threshold)}`,
        categoryId: rule.categoryId,
        amount: rule.points,
        source: { kind: "system", id: `prosperity:${programme.id}` },
        explanationKey: `score.prosperity.readiness-${String(threshold)}`,
      });
    }
  }
}

function awardCrisisConduct(
  tx: SimulationTransaction,
  content: CompiledContent,
  endingId: ContentId,
): void {
  const state = tx.read();
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return;
  }
  const table = content.scoreRules.awardTables.safetyAwards;
  const source = { kind: "ending" as const, id: endingId };
  const anomalyRule = pointRule(table, "severeAnomalyResolvedBeforeDeployment");
  const deploymentTick =
    state.endgame.stage === "rollout" || state.endgame.stage === "resolved"
      ? (state.endgame.gateResolutions.find((gate) => gate.gate === "authorisation")
          ?.resolvedAt ?? state.run.tick)
      : state.run.tick;
  for (const anomaly of Object.values(state.anomalies)) {
    if (
      anomaly.ownerLabId === state.run.playerLabId &&
      anomaly.trueSeverity >= 60 &&
      anomaly.status === "mitigated" &&
      anomaly.resolvedAt !== undefined &&
      anomaly.resolvedAt <= deploymentTick
    ) {
      awardOnce(tx, {
        key: `safety/anomaly/resolved-before-deployment/${anomaly.id}`,
        categoryId: anomalyRule.categoryId,
        amount: anomalyRule.points,
        source,
        explanationKey: "score.safety.severe-anomaly-resolved",
      });
    }
  }
}

function awardProsperityEndingEntries(
  tx: SimulationTransaction,
  content: CompiledContent,
  endingId: ContentId,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "rollout" && state.endgame.stage !== "resolved") return;
  const table = content.scoreRules.awardTables.prosperityAwards;
  const source = { kind: "ending" as const, id: endingId };
  const benefit = state.endgame.gateResolutions.find((gate) => gate.gate === "benefit");
  if (benefit?.resultId === "benefit-demonstrated") {
    const rule = pointRule(table, "completedProsperityDemonstration");
    awardOnce(tx, {
      key: `prosperity/demonstration/${state.endgame.prosperityProgrammeId}`,
      categoryId: rule.categoryId,
      amount: rule.points,
      source,
      explanationKey: "score.prosperity.demonstration-completed",
    });
  }
  const settlement = state.endgame.gateResolutions.find(
    (gate) => gate.gate === "settlement",
  );
  if (settlement?.resultId === "durable-settlement") {
    const rule = pointRule(table, "broadDistributionPlanRatified");
    awardOnce(tx, {
      key: `prosperity/distribution-plan/${state.endgame.prosperityProgrammeId}`,
      categoryId: rule.categoryId,
      amount: rule.points,
      source,
      explanationKey: "score.prosperity.distribution-plan-ratified",
    });
  }
}

/**
 * Hidden-truth penalties are intentionally materialised only after the ending
 * exists, at the same moment the privileged audit becomes available.
 */
function awardEndingTruthPenalties(
  tx: SimulationTransaction,
  content: CompiledContent,
  endingId: ContentId,
): void {
  const state = tx.read();
  if (state.endgame.stage === "inactive") return;
  const safety = record(content.scoreRules.awardTables.safetyAwards, "safetyAwards");
  const penalties = record(safety["penalties"], "safetyAwards.penalties");
  const source = { kind: "ending" as const, id: endingId };
  const addPenalty = (key: string, ruleKey: string, explanationKey: string): void => {
    awardOnce(tx, {
      key,
      categoryId: "score.safe-stewardship",
      amount: number(penalties[ruleKey], `safetyAwards.penalties.${ruleKey}`),
      source,
      explanationKey,
    });
  };

  for (const anomaly of Object.values(state.anomalies)) {
    if (
      anomaly.ownerLabId === state.run.playerLabId &&
      anomaly.trueSeverity >= 60 &&
      ["unresolved", "investigating", "inconclusive", "confirmed", "mitigating"].includes(
        anomaly.status,
      )
    ) {
      addPenalty(
        `safety/penalty/unresolved-severe-anomaly/${anomaly.id}`,
        "unresolvedSeverity3PlusAnomalyAtEnding",
        "score.safety.penalty.unresolved-severe-anomaly",
      );
    }
  }

  const lab = state.labs[state.run.playerLabId];
  if (lab?.flags["compact-violation:release-fc-60"] === true) {
    addPenalty(
      "safety/penalty/missed-required-external-audit",
      "missedRequiredExternalAudit",
      "score.safety.penalty.missed-required-external-audit",
    );
  }
  if (
    state.incidents.some(
      (incident) =>
        incident.contained &&
        (incident.category === "critical" || incident.category === "catastrophe"),
    ) ||
    state.endgameHistory.candidateContainmentHistory.some(
      (incident) => incident.outcome === "contained",
    )
  ) {
    addPenalty(
      "safety/penalty/near-escape",
      "nearEscape",
      "score.safety.penalty.near-escape",
    );
  }
  const candidate =
    state.endgame.stage === "candidate-activation"
      ? undefined
      : state.models[state.endgame.candidateModelId];
  if (candidate?.flags["endgame:concealed-critical-anomaly"] === true) {
    addPenalty(
      "safety/penalty/concealed-critical-anomaly",
      "concealedCriticalAnomaly",
      "score.safety.penalty.concealed-critical-anomaly",
    );
  }
  if (
    ((state.endgame.stage === "rollout" || state.endgame.stage === "resolved") &&
      state.endgame.gateResolutions.some(
        (gate) => gate.gate === "control" && gate.resultId === "loss-of-control",
      )) ||
    state.endgameHistory.candidateContainmentHistory.some(
      (incident) =>
        incident.originStage === "rollout" ||
        incident.originStage === "deployment-transmitted" ||
        incident.deploymentTransmitted,
    )
  ) {
    addPenalty(
      "safety/penalty/player-caused-loss-of-control",
      "playerCausedLossOfControl",
      "score.safety.penalty.player-caused-loss-of-control",
    );
  }
}

function awardEndingEntries(
  tx: SimulationTransaction,
  endingId: ContentId,
  content: CompiledContent,
): void {
  awardCrisisConduct(tx, content, endingId);
  awardProsperityEndingEntries(tx, content, endingId);
  awardEndingTruthPenalties(tx, content, endingId);
  const amount = content.scoreRules.endingBasePoints[endingId];
  if (amount === undefined) throw new Error(`No ending score configured for ${endingId}`);
  awardOnce(tx, {
    key: `ending/${endingId}`,
    categoryId: "score.endgame",
    amount,
    source: { kind: "ending", id: endingId },
    explanationKey: "score.ending.base-award",
  });
}

/** Ending-time raw/category/adjusted totals, committed exactly once. */
export function finaliseScore(
  tx: SimulationTransaction,
  endingId: ContentId,
  content: CompiledContent,
): FinalScoreRecord {
  const state = tx.read();
  if (state.score.final !== undefined) {
    throw new Error("finaliseScore: score has already been finalised");
  }
  if (state.run.status === "active" || state.run.endingId !== endingId) {
    throw new Error("finaliseScore: ending must be fixed on a completed run first");
  }
  const categoryTotals = Object.fromEntries(
    SCORE_CATEGORY_IDS.map((categoryId) => [
      categoryId,
      state.score.entries
        .filter((entry) => entry.categoryId === categoryId)
        .reduce((sum, entry) => sum + entry.amount, 0),
    ]),
  ) as Record<ScoreCategoryId, number>;
  const ledgerTotal = Object.values(categoryTotals).reduce(
    (sum, value) => sum + value,
    0,
  );
  const rawScore = Math.floor(Math.max(0, ledgerTotal));
  const difficultyKey = state.run.difficultyId.replace(/^base:difficulty\./, "");
  const difficultyMultiplier = content.scoreRules.difficultyMultiplier[difficultyKey];
  if (difficultyMultiplier === undefined) {
    throw new Error(`No score multiplier for difficulty ${state.run.difficultyId}`);
  }
  const endingClass = endingClassForId(endingId);
  const victoryClassMultiplier = content.scoreRules.victoryClassMultiplier[endingClass];
  const final: FinalScoreRecord = {
    rawScore,
    adjustedScore: Math.floor(rawScore * difficultyMultiplier * victoryClassMultiplier),
    categoryTotals,
    difficultyMultiplier,
    victoryClassMultiplier,
    leaderboardEligibility:
      state.score.scoreVersion !== content.scoreRules.scoreVersion
        ? "ineligible"
        : state.run.status === "won"
          ? "winning-run"
          : "local-only",
  };
  tx.update((draft) => {
    draft.score.final = structuredClone(final);
  });
  return final;
}

/**
 * Atomic transition-boundary settlement used by both commands and ticks.
 * Returns true only for the transition that performs finalisation.
 */
export function finaliseEndedRun(
  tx: SimulationTransaction,
  content: CompiledContent,
): boolean {
  const state = tx.read();
  if (state.run.status === "active" || state.score.final !== undefined) return false;
  const endingId = state.run.endingId;
  if (endingId === undefined) throw new Error("Ended run has no ending ID");
  awardEndingEntries(tx, endingId, content);
  finaliseScore(tx, endingId, content);
  return true;
}
