import type {
  CompiledContent,
  EvaluationDefinition,
  EvaluationProgramme,
} from "@neolab/content-schema";

import type { ModelId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";

export type SafetyPracticeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface SafetyPracticeProfile {
  readonly score: number;
  readonly level: SafetyPracticeLevel;
  readonly label: string;
  readonly currentThreshold: number;
  readonly nextThreshold?: number;
  readonly pointsToNextLevel: number;
  readonly durationMultiplier: number;
  readonly cashCostMultiplier: number;
  readonly confidenceRadiusReduction: number;
  readonly anomalyDetectionBonus: number;
}

export interface SafetyCaseCoverage {
  readonly programme: Exclude<EvaluationProgramme, "baseline">;
  readonly label: string;
  readonly complete: boolean;
  readonly reportCount: number;
}

export interface ModelSafetyCase {
  readonly score: number;
  readonly label:
    "No case" | "Preliminary" | "Partial" | "Substantial" | "Strong" | "Exceptional";
  readonly coverage: readonly SafetyCaseCoverage[];
  readonly warningSignalsResolved: number;
  /** Deliberately closed without reaching a conclusion; uncertainty remains. */
  readonly warningSignalsDismissed: number;
  /** Signals on which the player can still take an investigation action. */
  readonly warningSignalsOpen: number;
}

const LEVELS = [
  {
    threshold: 0,
    level: 1,
    label: "Ad hoc",
    durationMultiplier: 1,
    cashCostMultiplier: 1,
    confidenceRadiusReduction: 0,
  },
  {
    threshold: 2,
    level: 2,
    label: "Repeatable checks",
    durationMultiplier: 0.96,
    cashCostMultiplier: 0.97,
    confidenceRadiusReduction: 1,
  },
  {
    threshold: 5,
    level: 3,
    label: "Dedicated evaluation team",
    durationMultiplier: 0.92,
    cashCostMultiplier: 0.95,
    confidenceRadiusReduction: 2,
  },
  {
    threshold: 10,
    level: 4,
    label: "Established red-team practice",
    durationMultiplier: 0.88,
    cashCostMultiplier: 0.92,
    confidenceRadiusReduction: 3,
  },
  {
    threshold: 17,
    level: 5,
    label: "Integrated safety testing",
    durationMultiplier: 0.84,
    cashCostMultiplier: 0.89,
    confidenceRadiusReduction: 4,
  },
  {
    threshold: 27,
    level: 6,
    label: "Independent assurance office",
    durationMultiplier: 0.8,
    cashCostMultiplier: 0.86,
    confidenceRadiusReduction: 4,
  },
  {
    threshold: 40,
    level: 7,
    label: "Frontier assurance programme",
    durationMultiplier: 0.75,
    cashCostMultiplier: 0.83,
    confidenceRadiusReduction: 5,
  },
  {
    threshold: 57,
    level: 8,
    label: "Multi-generation safety programme",
    durationMultiplier: 0.7,
    cashCostMultiplier: 0.8,
    confidenceRadiusReduction: 6,
  },
  {
    threshold: 77,
    level: 9,
    label: "Safety-led institution",
    durationMultiplier: 0.65,
    cashCostMultiplier: 0.78,
    confidenceRadiusReduction: 7,
  },
  {
    threshold: 100,
    level: 10,
    label: "Institutional reflex",
    durationMultiplier: 0.6,
    cashCostMultiplier: 0.75,
    confidenceRadiusReduction: 8,
  },
] as const;

/**
 * Total Safety Practice XP available from one fully novel, fully evaluated
 * model at each capability tier. The five authored rung values are relative
 * depth weights; this table sets the actual institutional-learning budget.
 * Two complete dossiers at each of tiers 5, 6 and 7 pay exactly 100 XP.
 */
export const SAFETY_PRACTICE_DOSSIER_XP_BY_TIER = [
  0, 1, 1, 2, 3, 14, 17, 19, 22,
] as const;

export function safetyPracticeXpForEvaluation(
  content: CompiledContent,
  definition: EvaluationDefinition,
  capabilityTier: number,
): number {
  if (!definition.playerStartable || definition.practiceXp <= 0) return 0;
  const tier = Math.max(
    0,
    Math.min(SAFETY_PRACTICE_DOSSIER_XP_BY_TIER.length - 1, capabilityTier),
  );
  const dossierBudget = SAFETY_PRACTICE_DOSSIER_XP_BY_TIER[tier] ?? 0;
  const ladder = Object.values(content.evaluations.definitions)
    .filter((candidate) => candidate.playerStartable && candidate.practiceXp > 0)
    .sort((left, right) => left.ladderRung - right.ladderRung);
  const totalWeight = ladder.reduce((sum, candidate) => sum + candidate.practiceXp, 0);
  if (totalWeight <= 0 || dossierBudget <= 0) return 0;
  const priorWeight = ladder
    .filter((candidate) => candidate.ladderRung < definition.ladderRung)
    .reduce((sum, candidate) => sum + candidate.practiceXp, 0);
  const throughThisRung = priorWeight + definition.practiceXp;
  // Use cumulative hundredths so every rung visibly contributes, including
  // the low-tier dossiers whose entire budget may be only one point. The
  // cumulative subtraction preserves the exact full-dossier budget.
  const xpThroughThisRung =
    Math.round((throughThisRung / totalWeight) * dossierBudget * 100) / 100;
  const xpBeforeThisRung =
    Math.round((priorWeight / totalWeight) * dossierBudget * 100) / 100;
  return Math.round((xpThroughThisRung - xpBeforeThisRung) * 100) / 100;
}

export function safetyPracticeProfile(practiceXp: number): SafetyPracticeProfile {
  const score = Math.max(0, Math.min(100, practiceXp));
  const current =
    [...LEVELS].reverse().find((candidate) => score >= candidate.threshold) ?? LEVELS[0];
  const next = LEVELS.find((candidate) => candidate.threshold > score);
  return {
    score,
    level: current.level,
    label: current.label,
    currentThreshold: current.threshold,
    ...(next === undefined ? {} : { nextThreshold: next.threshold }),
    pointsToNextLevel: next === undefined ? 0 : Math.max(0, next.threshold - score),
    durationMultiplier: current.durationMultiplier,
    cashCostMultiplier: current.cashCostMultiplier,
    confidenceRadiusReduction: current.confidenceRadiusReduction,
    // Detection improves continuously with effective evaluation quality rather
    // than jumping only when the institution crosses a named practice tier.
    anomalyDetectionBonus: score * 0.004,
  };
}

export function safetyCaseGainForProgramme(
  programme: EvaluationProgramme,
  priorProgrammeReportsForModel: number,
): number {
  if (programme === "baseline") return 0;
  if (programme === "alignment-interpretability") {
    // The three alignment-focused rungs are the interview, red team, and
    // interpretability audit respectively. Their assurance value rises with
    // the cost and depth of the work.
    return [5, 10, 25][priorProgrammeReportsForModel] ?? 0;
  }
  if (programme === "autonomy-containment") {
    return priorProgrammeReportsForModel === 0 ? 20 : 0;
  }
  // The independent audit is the most expensive and least conflicted rung.
  return priorProgrammeReportsForModel === 0 ? 30 : 0;
}

// Capability needs no case: it is exact from training. A safety case is made
// of the three programmes that examine what only evaluation can see.
const CASE_PROGRAMMES = [
  ["alignment-interpretability", "Alignment assessed"],
  ["autonomy-containment", "Autonomy and containment tested"],
  ["independent-audit", "Independent review"],
] as const satisfies ReadonlyArray<
  readonly [Exclude<EvaluationProgramme, "baseline">, string]
>;

export function calculateModelSafetyCase(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
): ModelSafetyCase {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  let score = 0;
  const coverage = CASE_PROGRAMMES.map(([programme, label]) => {
    const reportCount = model.evaluations.filter((evaluationId) => {
      const evaluation = state.evaluations[evaluationId];
      const definition =
        evaluation === undefined
          ? undefined
          : content.evaluations.definitions[evaluation.definitionId];
      return definition?.programme === programme;
    }).length;
    for (let reportIndex = 0; reportIndex < reportCount; reportIndex += 1) {
      score += safetyCaseGainForProgramme(programme, reportIndex);
    }
    return {
      programme,
      label,
      complete: reportCount > 0,
      reportCount,
    };
  });
  const anomalies = model.anomalies
    .map((anomalyId) => state.anomalies[anomalyId])
    .filter((anomaly) => anomaly !== undefined);
  const warningSignalsResolved = anomalies.filter(
    (anomaly) => anomaly.status === "resolved" || anomaly.status === "mitigated",
  ).length;
  const warningSignalsDismissed = anomalies.filter(
    (anomaly) => anomaly.status === "dismissed",
  ).length;
  const warningSignalsOpen = anomalies.filter(
    (anomaly) =>
      anomaly.status === "unresolved" ||
      anomaly.status === "investigating" ||
      anomaly.status === "inconclusive" ||
      anomaly.status === "confirmed" ||
      anomaly.status === "mitigating",
  ).length;
  score = Math.min(100, score + Math.min(10, warningSignalsResolved * 5));
  return {
    score,
    label:
      score === 0
        ? "No case"
        : score < 30
          ? "Preliminary"
          : score < 55
            ? "Partial"
            : score < 75
              ? "Substantial"
              : score < 90
                ? "Strong"
                : "Exceptional",
    coverage,
    warningSignalsResolved,
    warningSignalsDismissed,
    warningSignalsOpen,
  };
}

export function priorProgrammeReportCount(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
  definition: EvaluationDefinition,
): number {
  const model = state.models[modelId];
  if (model === undefined) return 0;
  return model.evaluations.filter((evaluationId) => {
    const evaluation = state.evaluations[evaluationId];
    const candidate =
      evaluation === undefined
        ? undefined
        : content.evaluations.definitions[evaluation.definitionId];
    return candidate?.programme === definition.programme;
  }).length;
}
