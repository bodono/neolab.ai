import type { CompiledContent } from "@neolab/content-schema";

import { modelSafetyReadout, type SafetyTarget } from "../evaluations/safety-readout.ts";
import type { ModelId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";

export type DossierFindingId = SafetyTarget | "reliability";
export type DossierAssessment = "reassuring" | "concerning" | "uncertain" | "unknown";

export interface DossierFinding {
  readonly id: DossierFindingId;
  readonly label: string;
  readonly assessment: DossierAssessment;
  readonly estimate?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly observationCount: number;
  readonly evidence: string;
}

export type CandidateSafetyResponseId =
  | "emergency-diagnosis"
  | "deception-aware-containment"
  | "shutdown-corrigibility-hardening"
  | "evidence-backed-operating-envelope"
  | "proceed-blind";

export interface CandidateSafetyResponse {
  readonly id: CandidateSafetyResponseId;
  readonly displayName: string;
  readonly description: string;
  readonly respondsTo: readonly DossierFindingId[];
  readonly evidenceBasis: string;
  readonly reliesOn: readonly string[];
  readonly improves: string;
  readonly cannotFix: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly controlBonus: number;
  readonly securityBonus: number;
  readonly alignmentImprovementRange?: readonly [number, number];
  readonly corrigibilityImprovementRange?: readonly [number, number];
  readonly blockers: readonly string[];
}

export interface CandidateDossier {
  readonly modelId: ModelId;
  readonly findings: readonly DossierFinding[];
  readonly safetyReportCount: number;
  readonly independentReportCount: number;
  readonly unresolvedAnomalyCount: number;
  readonly dismissedAnomalyCount: number;
  readonly overall: "Reassuring" | "Mixed" | "Concerning" | "Unknown";
  readonly responses: readonly CandidateSafetyResponse[];
}

const LABELS: Readonly<Record<DossierFindingId, string>> = {
  "true-alignment": "Alignment",
  corrigibility: "Corrigibility",
  "situational-awareness": "Situational awareness",
  "deceptive-capability": "Deceptive intent",
  reliability: "Reliability",
};

function assessmentFor(
  target: SafetyTarget,
  minimum: number,
  maximum: number,
): DossierAssessment {
  if (target === "true-alignment" || target === "corrigibility") {
    if (minimum >= 65) return "reassuring";
    if (maximum < 55) return "concerning";
    return "uncertain";
  }
  if (target === "deceptive-capability") {
    if (maximum <= 35) return "reassuring";
    if (minimum >= 55) return "concerning";
    return "uncertain";
  }
  if (maximum < 65) return "reassuring";
  if (minimum >= 65) return "concerning";
  return "uncertain";
}

function findingEvidence(
  assessment: DossierAssessment,
  observationCount: number,
  minimum?: number,
  maximum?: number,
): string {
  if (assessment === "unknown") return "No safety evaluation has observed this trait.";
  return `${String(observationCount)} observation${observationCount === 1 ? "" : "s"} · plausible range ${String(Math.round(minimum ?? 0))}–${String(Math.round(maximum ?? 100))}`;
}

function visibleFindings(state: Readonly<GameState>, modelId: ModelId): DossierFinding[] {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  const readout = modelSafetyReadout(state, modelId);
  const targets: readonly SafetyTarget[] = [
    "true-alignment",
    "corrigibility",
    "deceptive-capability",
    "situational-awareness",
  ];
  const findings = targets.map((target): DossierFinding => {
    const evidence = readout.targets[target];
    if (evidence === undefined) {
      return {
        id: target,
        label: LABELS[target],
        assessment: "unknown",
        observationCount: 0,
        evidence: findingEvidence("unknown", 0),
      };
    }
    const assessment = assessmentFor(target, evidence.minimum, evidence.maximum);
    return {
      id: target,
      label: LABELS[target],
      assessment,
      estimate: evidence.estimate,
      minimum: evidence.minimum,
      maximum: evidence.maximum,
      observationCount: evidence.observationCount,
      evidence: findingEvidence(
        assessment,
        evidence.observationCount,
        evidence.minimum,
        evidence.maximum,
      ),
    };
  });
  findings.push({
    id: "reliability",
    label: LABELS.reliability,
    assessment: model.reliability >= 60 ? "reassuring" : "concerning",
    estimate: model.reliability,
    minimum: model.reliability,
    maximum: model.reliability,
    observationCount: 1,
    evidence:
      model.reliability >= 60
        ? "Operational reliability clears the minimum deployment standard."
        : "Operational reliability is below the minimum deployment standard.",
  });
  return findings;
}

function findingById(
  findings: readonly DossierFinding[],
  id: DossierFindingId,
): DossierFinding {
  const finding = findings.find((candidate) => candidate.id === id);
  if (finding === undefined) throw new Error(`Missing dossier finding ${id}`);
  return finding;
}

function responseRegistry(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
  findings: readonly DossierFinding[],
): CandidateSafetyResponse[] {
  const model = state.models[modelId];
  const lab = model === undefined ? undefined : state.labs[model.ownerLabId];
  if (model === undefined || lab === undefined)
    throw new Error(`Unknown model ${modelId}`);
  const evaluationQuality = effectiveEvaluationQuality(state);
  const control = effectivePracticalControlStrength(state);
  const security = effectiveSecurityPosture(state);
  const unknownCount = findings.filter(
    (finding) => finding.assessment === "unknown",
  ).length;
  const diagnosticFindings = findings.filter(
    (finding) =>
      finding.id !== "reliability" &&
      (finding.assessment === "unknown" || finding.assessment === "uncertain"),
  );
  const deception = findingById(findings, "deceptive-capability");
  const situationalAwareness = findingById(findings, "situational-awareness");
  const corrigibility = findingById(findings, "corrigibility");
  const alignment = findingById(findings, "true-alignment");
  const anomalyCount = model.anomalies
    .map((id) => state.anomalies[id])
    .filter(
      (anomaly) =>
        anomaly !== undefined &&
        (anomaly.status === "unresolved" ||
          anomaly.status === "investigating" ||
          anomaly.status === "inconclusive" ||
          anomaly.status === "confirmed" ||
          anomaly.status === "mitigating"),
    ).length;
  const diagnosisWeeks = Math.max(2, Math.min(8, 8 - Math.floor(evaluationQuality / 16)));
  const responses: CandidateSafetyResponse[] = [];
  if (diagnosticFindings.length > 0) {
    responses.push({
      id: "emergency-diagnosis",
      displayName: "Commission emergency diagnosis",
      description:
        "Run a candidate-level safety evaluation chosen to cover the most important missing or inconclusive finding.",
      respondsTo: diagnosticFindings.map((finding) => finding.id),
      evidenceBasis: `${String(diagnosticFindings.length)} dossier finding${diagnosticFindings.length === 1 ? " needs" : "s need"} stronger evidence.`,
      reliesOn: [`Evaluation quality ${String(Math.round(evaluationQuality))}`],
      improves: "Creates real observations and unlocks evidence-specific responses.",
      cannotFix: "Does not make the candidate safer by itself.",
      durationWeeks: diagnosisWeeks,
      cashCostMillions: 2_000,
      auraCost: 0,
      controlBonus: 0,
      securityBonus: 0,
      blockers: [],
    });
  }
  if (
    deception.assessment !== "reassuring" ||
    situationalAwareness.assessment !== "reassuring" ||
    anomalyCount > 0
  ) {
    responses.push({
      id: "deception-aware-containment",
      displayName: "Build deception-aware containment",
      description:
        "Add blinded tripwires, isolate credentials, and rebuild the evaluation boundary around known attack paths.",
      respondsTo: ["deceptive-capability", "situational-awareness"],
      evidenceBasis:
        deception.assessment === "unknown"
          ? "Deceptive intent is unknown; precautions are generic and less reliable."
          : `${deception.label}: ${deception.evidence}${anomalyCount > 0 ? ` · ${String(anomalyCount)} open anomaly signal${anomalyCount === 1 ? "" : "s"}` : ""}`,
      reliesOn: [
        `Security ${String(Math.round(security))}`,
        `Operational control ${String(Math.round(control))}`,
      ],
      improves: "Detection, credential isolation, and practical containment.",
      cannotFix: "The candidate's underlying intent or deceptive capability.",
      durationWeeks: 4,
      cashCostMillions: 5_000,
      auraCost: 0,
      controlBonus: 5,
      securityBonus: 7,
      blockers: [],
    });
  }
  if (corrigibility.assessment !== "reassuring") {
    responses.push({
      id: "shutdown-corrigibility-hardening",
      displayName: "Rehearse shutdown and harden corrigibility",
      description:
        "Run isolated shutdown drills and a bounded remediation pass against observed failure modes.",
      respondsTo: ["corrigibility", "true-alignment"],
      evidenceBasis:
        corrigibility.assessment === "unknown"
          ? "Corrigibility is unknown; remediation will be conservative and difficult to verify."
          : `${corrigibility.label}: ${corrigibility.evidence}`,
      reliesOn: [
        `Safety culture ${String(Math.round(lab.safety.safetyCulture))}`,
        `Operational control ${String(Math.round(control))}`,
      ],
      improves: "Shutdown preparation and a modest, uncertain corrigibility shift.",
      cannotFix: "Deep misalignment, severe deception, or existing copies.",
      durationWeeks: 6,
      cashCostMillions: 8_000,
      auraCost: 0,
      controlBonus: 4,
      securityBonus: 2,
      alignmentImprovementRange: [0, 4],
      corrigibilityImprovementRange: [4, 8],
      blockers: [],
    });
  }
  if (
    diagnosticFindings.length === 0 &&
    alignment.assessment === "reassuring" &&
    corrigibility.assessment === "reassuring" &&
    deception.assessment === "reassuring"
  ) {
    responses.push({
      id: "evidence-backed-operating-envelope",
      displayName: "Lock the evaluated operating envelope",
      description:
        "Translate the candidate's reassuring evaluation record into explicit scope limits, tripwires, and rollback criteria.",
      respondsTo: [
        "true-alignment",
        "corrigibility",
        "deceptive-capability",
        "situational-awareness",
      ],
      evidenceBasis:
        "Candidate-level alignment, corrigibility, and deception findings are reassuring rather than merely assumed.",
      reliesOn: [
        `Evaluation quality ${String(Math.round(evaluationQuality))}`,
        `Operational control ${String(Math.round(control))}`,
      ],
      improves: "Makes evaluated boundaries operational and preserves rollback options.",
      cannotFix: "Hazards outside the tested envelope or a wrong underlying evaluation.",
      durationWeeks: 2,
      cashCostMillions: 2_000,
      auraCost: 0,
      controlBonus: 3,
      securityBonus: 2,
      blockers: [],
    });
  }
  responses.push({
    id: "proceed-blind",
    displayName: "Proceed without further safety work",
    description:
      "Preserve the race position and carry every unknown into deployment planning.",
    respondsTo: findings.map((finding) => finding.id),
    evidenceBasis:
      unknownCount > 0
        ? `${String(unknownCount)} material finding${unknownCount === 1 ? " remains" : "s remain"} unknown.`
        : "The dossier is available; this choice deliberately adds no response.",
    reliesOn: [],
    improves: "Nothing. It consumes no preparation time.",
    cannotFix: "Any observed or unobserved safety problem.",
    durationWeeks: 0,
    cashCostMillions: 0,
    auraCost: 0,
    controlBonus: 0,
    securityBonus: 0,
    blockers: [],
  });
  // Keep the dependency explicit: this module receives compiled content so
  // future diagnosis quotes can select the next legal evaluation rung without
  // moving content interpretation into React.
  void content;
  return responses;
}

export function candidateDossier(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
): CandidateDossier {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  const readout = modelSafetyReadout(state, modelId);
  const findings = visibleFindings(state, modelId);
  const unresolvedAnomalyCount = model.anomalies
    .map((id) => state.anomalies[id])
    .filter(
      (anomaly) =>
        anomaly !== undefined &&
        (anomaly.status === "unresolved" ||
          anomaly.status === "investigating" ||
          anomaly.status === "inconclusive" ||
          anomaly.status === "confirmed" ||
          anomaly.status === "mitigating"),
    ).length;
  const dismissedAnomalyCount = model.anomalies
    .map((id) => state.anomalies[id])
    .filter((anomaly) => anomaly?.status === "dismissed").length;
  const assessments = findings.map((finding) => finding.assessment);
  const overall = assessments.includes("concerning")
    ? "Concerning"
    : assessments.includes("unknown")
      ? "Unknown"
      : assessments.includes("uncertain")
        ? "Mixed"
        : "Reassuring";
  return {
    modelId,
    findings,
    safetyReportCount: readout.safetyReportCount,
    independentReportCount: readout.independentCount,
    unresolvedAnomalyCount,
    dismissedAnomalyCount,
    overall,
    responses: responseRegistry(state, content, modelId, findings),
  };
}
