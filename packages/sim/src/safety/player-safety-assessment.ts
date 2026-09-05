import type { SafetyTarget } from "../evaluations/safety-readout.ts";

export type SafetyAssessmentTone =
  "unknown" | "reassuring" | "guarded" | "high" | "severe";

export interface VisibleSafetyFinding {
  readonly target: SafetyTarget;
  readonly minimum?: number;
  readonly maximum?: number;
}

/**
 * A compact, entirely player-safe summary of four different questions:
 * what the weights appear to want, how well the lab can contain them, how
 * credible the evidence is, and how much reach the model currently has.
 *
 * This is deliberately an assessment band, not a second hidden-risk score.
 * The range is calculated only from values already visible to the player.
 */
export interface PlayerSafetyAssessment {
  readonly currentRisk: {
    readonly label: string;
    readonly tone: SafetyAssessmentTone;
    readonly summary: string;
    readonly plausibleRange?: string;
  };
  readonly modelSafety: {
    readonly label: string;
    readonly tone: SafetyAssessmentTone;
    readonly evaluatedTargets: number;
    readonly totalTargets: 4;
  };
  readonly labDefence: {
    readonly score: number;
    readonly label: string;
    readonly practicalControl: number;
    readonly securityPosture: number;
    readonly safetyCulture: number;
    readonly incidentReductionPercent: number;
  };
  readonly evidence: {
    readonly score: number;
    readonly label: string;
    readonly effectiveQuality: number;
    readonly reportCount: number;
    readonly independentReportCount: number;
    readonly evaluatedTargets: number;
    readonly totalTargets: 4;
  };
  readonly access: {
    readonly level: number;
    readonly label: string;
    readonly deploymentLabel: string;
    readonly exposurePercent: number;
    readonly tone: SafetyAssessmentTone;
  };
}

interface PlayerSafetyAssessmentInput {
  readonly findings: readonly VisibleSafetyFinding[];
  readonly practicalControl: number;
  readonly securityPosture: number;
  readonly safetyCulture: number;
  readonly effectiveEvaluationQuality: number;
  readonly reportCount: number;
  readonly independentReportCount: number;
  readonly accessLevel: number;
  readonly deploymentLabel: string;
  readonly exposurePercent: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function findingRange(
  findings: readonly VisibleSafetyFinding[],
  target: SafetyTarget,
): readonly [number, number] {
  const finding = findings.find((candidate) => candidate.target === target);
  return finding?.minimum === undefined || finding.maximum === undefined
    ? [0, 100]
    : [clamp(finding.minimum), clamp(finding.maximum)];
}

function band(value: number): { readonly rank: number; readonly label: string } {
  if (value < 25) return { rank: 0, label: "Low" };
  if (value < 45) return { rank: 1, label: "Guarded" };
  if (value < 65) return { rank: 2, label: "High" };
  return { rank: 3, label: "Severe" };
}

function toneForRank(rank: number): SafetyAssessmentTone {
  return rank === 0
    ? "reassuring"
    : rank === 1
      ? "guarded"
      : rank === 2
        ? "high"
        : "severe";
}

function accessLabel(level: number): string {
  switch (Math.round(level)) {
    case 0:
      return "Isolated";
    case 1:
      return "Fixed sandbox";
    case 2:
      return "Supervised tools";
    case 3:
      return "Material access";
    case 4:
      return "Privileged access";
    default:
      return "Root + external network";
  }
}

function evidenceLabel(score: number): string {
  if (score < 10) return "No evidence";
  if (score < 40) return "Limited";
  if (score < 65) return "Developing";
  if (score < 85) return "Strong";
  return "Exceptional";
}

function defenceLabel(score: number): string {
  if (score < 25) return "Fragile";
  if (score < 50) return "Developing";
  if (score < 75) return "Strong";
  return "Fortified";
}

export function derivePlayerSafetyAssessment(
  input: PlayerSafetyAssessmentInput,
): PlayerSafetyAssessment {
  const alignment = findingRange(input.findings, "true-alignment");
  const corrigibility = findingRange(input.findings, "corrigibility");
  const deceptiveIntent = findingRange(input.findings, "deceptive-capability");
  const awareness = findingRange(input.findings, "situational-awareness");
  const evaluatedTargets = input.findings.filter(
    (finding) => finding.minimum !== undefined && finding.maximum !== undefined,
  ).length;

  // Best/worst plausible model concern from the displayed intervals. High
  // alignment and corrigibility reduce concern; measured deceptive intent
  // raises it directly, while awareness increases the hazard of granting reach.
  const intentConcernLow = 100 - (0.7 * alignment[1] + 0.3 * corrigibility[1]);
  const intentConcernHigh = 100 - (0.7 * alignment[0] + 0.3 * corrigibility[0]);
  const hazardLow = 0.65 * deceptiveIntent[0] + 0.35 * awareness[0];
  const hazardHigh = 0.65 * deceptiveIntent[1] + 0.35 * awareness[1];
  const modelConcernLow = 0.65 * intentConcernLow + 0.35 * hazardLow;
  const modelConcernHigh = 0.65 * intentConcernHigh + 0.35 * hazardHigh;

  // This is the same 70/30 operational-defence blend used by the incident
  // engine. Culture remains visible separately because it changes incident
  // pressure rather than pretending the lab has stronger locks.
  const operationalDefence = clamp(
    0.7 * input.practicalControl + 0.3 * input.securityPosture,
  );
  const accessPressure = clamp(
    Math.max((input.accessLevel / 5) * 100, input.exposurePercent),
  );
  const residualDefencePressure = 100 - operationalDefence * 0.75;
  const riskLow = clamp(
    0.55 * modelConcernLow + 0.25 * accessPressure + 0.2 * residualDefencePressure,
  );
  const riskHigh = clamp(
    0.55 * modelConcernHigh + 0.25 * accessPressure + 0.2 * residualDefencePressure,
  );
  const lowBand = band(riskLow);
  const highBand = band(riskHigh);
  const riskLabel =
    lowBand.rank === highBand.rank
      ? highBand.label
      : `${lowBand.label}–${highBand.label}`;
  const riskIsRange = lowBand.rank !== highBand.rank;

  // Evaluation quality is the lab's capacity to produce good evidence, not
  // evidence by itself. Until at least one trait or report exists, the player
  // should see "No evidence" even if the lab's evaluators are excellent.
  const evidenceScore =
    evaluatedTargets === 0 && input.reportCount === 0
      ? 0
      : Math.round(
          clamp(
            0.45 * input.effectiveEvaluationQuality +
              0.4 * ((evaluatedTargets / 4) * 100) +
              0.15 * (input.independentReportCount > 0 ? 100 : 0),
          ),
        );

  let modelSafetyLabel = "Unknown";
  let modelSafetyTone: SafetyAssessmentTone = "unknown";
  if (evaluatedTargets > 0) {
    const concerning =
      alignment[1] < 45 ||
      corrigibility[1] < 45 ||
      deceptiveIntent[0] > 55 ||
      awareness[0] > 70;
    const reassuring =
      evaluatedTargets === 4 &&
      alignment[0] >= 65 &&
      corrigibility[0] >= 65 &&
      deceptiveIntent[1] <= 35 &&
      awareness[1] <= 65;
    modelSafetyLabel = concerning ? "Concerning" : reassuring ? "Encouraging" : "Mixed";
    modelSafetyTone = concerning ? "high" : reassuring ? "reassuring" : "guarded";
  }

  const roundedDefence = Math.round(operationalDefence);
  const roundedAccess = Math.max(0, Math.min(5, Math.round(input.accessLevel)));
  const accessRiskBand = band(accessPressure);
  return {
    currentRisk: {
      label: evaluatedTargets === 0 ? "Unknown" : riskIsRange ? "Uncertain" : riskLabel,
      tone: toneForRank(highBand.rank),
      ...(riskIsRange ? { plausibleRange: riskLabel } : {}),
      summary:
        evaluatedTargets === 0
          ? "Safety is unknown; the range stays broad until evaluations produce evidence."
          : "This band combines the visible safety ranges, current access and operational defence.",
    },
    modelSafety: {
      label: modelSafetyLabel,
      tone: modelSafetyTone,
      evaluatedTargets,
      totalTargets: 4,
    },
    labDefence: {
      score: roundedDefence,
      label: defenceLabel(roundedDefence),
      practicalControl: Math.round(input.practicalControl),
      securityPosture: Math.round(input.securityPosture),
      safetyCulture: Math.round(input.safetyCulture),
      incidentReductionPercent: Math.round(operationalDefence * 0.75),
    },
    evidence: {
      score: evidenceScore,
      label: evidenceLabel(evidenceScore),
      effectiveQuality: Math.round(input.effectiveEvaluationQuality),
      reportCount: input.reportCount,
      independentReportCount: input.independentReportCount,
      evaluatedTargets,
      totalTargets: 4,
    },
    access: {
      level: roundedAccess,
      label: accessLabel(roundedAccess),
      deploymentLabel: input.deploymentLabel,
      exposurePercent: Math.round(clamp(input.exposurePercent)),
      tone: roundedAccess === 0 ? "reassuring" : toneForRank(accessRiskBand.rank),
    },
  };
}
