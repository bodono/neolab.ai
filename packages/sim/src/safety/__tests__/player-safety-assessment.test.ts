import { describe, expect, it } from "vitest";

import { derivePlayerSafetyAssessment } from "../player-safety-assessment.ts";

const reassuringFindings = [
  { target: "true-alignment" as const, minimum: 75, maximum: 90 },
  { target: "corrigibility" as const, minimum: 72, maximum: 88 },
  { target: "situational-awareness" as const, minimum: 25, maximum: 45 },
  { target: "deceptive-capability" as const, minimum: 8, maximum: 28 },
];

describe("player safety assessment", () => {
  it("keeps unevaluated model safety explicitly unknown", () => {
    const assessment = derivePlayerSafetyAssessment({
      findings: reassuringFindings.map((finding) => ({ target: finding.target })),
      practicalControl: 60,
      securityPosture: 60,
      safetyCulture: 60,
      effectiveEvaluationQuality: 40,
      reportCount: 0,
      independentReportCount: 0,
      accessLevel: 1,
      deploymentLabel: "Guarded API",
      exposurePercent: 5,
    });

    expect(assessment.modelSafety).toMatchObject({
      label: "Unknown",
      tone: "unknown",
      evaluatedTargets: 0,
    });
    expect(assessment.currentRisk).toMatchObject({
      label: "Unknown",
      plausibleRange: "Low–Severe",
    });
    expect(assessment.currentRisk.summary).toContain("unknown");
    expect(assessment.evidence).toMatchObject({
      score: 0,
      label: "No evidence",
    });
  });

  it("separates reassuring weights, strong evidence, defence and access", () => {
    const assessment = derivePlayerSafetyAssessment({
      findings: reassuringFindings,
      practicalControl: 80,
      securityPosture: 70,
      safetyCulture: 75,
      effectiveEvaluationQuality: 85,
      reportCount: 5,
      independentReportCount: 2,
      accessLevel: 1,
      deploymentLabel: "Guarded API",
      exposurePercent: 10,
    });

    expect(assessment.modelSafety.label).toBe("Encouraging");
    expect(assessment.evidence.label).toBe("Exceptional");
    expect(assessment.labDefence).toMatchObject({
      score: 77,
      label: "Fortified",
      practicalControl: 80,
      securityPosture: 70,
    });
    expect(assessment.access.label).toBe("Fixed sandbox");
  });

  it("raises the visible risk band when access expands or defence weakens", () => {
    const derive = (accessLevel: number, defence: number) =>
      derivePlayerSafetyAssessment({
        findings: reassuringFindings,
        practicalControl: defence,
        securityPosture: defence,
        safetyCulture: defence,
        effectiveEvaluationQuality: 90,
        reportCount: 5,
        independentReportCount: 2,
        accessLevel,
        deploymentLabel: accessLevel === 0 ? "Internal only" : "Open API",
        exposurePercent: accessLevel * 20,
      });

    const contained = derive(0, 90);
    const exposed = derive(5, 20);
    expect(contained.currentRisk.label).toBe("Low");
    expect(exposed.currentRisk.label).not.toBe("Low");
    expect(exposed.access.label).toBe("Root + external network");
  });
});
