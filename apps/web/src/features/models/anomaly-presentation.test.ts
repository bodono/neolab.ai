import { describe, expect, it } from "vitest";

import {
  anomalyPresentationKey,
  selectAnomalyForPresentation,
  type PresentableAnomaly,
} from "./anomaly-presentation.ts";

function anomaly(status: PresentableAnomaly["status"]): PresentableAnomaly {
  return {
    anomalyId: "anomaly:test",
    sourceEvaluationId: "evaluation:test",
    underlyingCase: "alignment",
    observationCount: 1,
    createdAtTick: 12,
    observedSeverity: 80,
    severityLabel: "Critical",
    status,
    investigationAttempts: status === "unresolved" ? 0 : 1,
    actionQuote: {
      cashCostMillions: 50,
      auraCost: 36,
      durationWeeks: 8,
      majorProjectSlots: 1,
      mitigationControlBonus: 5,
      mitigationSecurityBonus: 5,
    },
  };
}

describe("anomaly popup selection", () => {
  it("treats investigation results as a new presentation lifecycle", () => {
    const confirmed = anomaly("confirmed");
    const priorAcknowledgement = new Set(["anomaly:test:unresolved:0:1"]);

    expect(
      selectAnomalyForPresentation({
        acknowledgedKeys: priorAcknowledgement,
        activeAnomalyId: undefined,
        anomalyDetectionPending: false,
        investigationCompletionPending: true,
        models: [{ anomalies: [confirmed] }],
      })?.anomaly,
    ).toBe(confirmed);
    expect(anomalyPresentationKey(confirmed)).toBe("anomaly:test:confirmed:1:1");
  });

  it("presents each repeated inconclusive follow-up once", () => {
    const first = anomaly("inconclusive");
    const second = { ...first, investigationAttempts: 2 };

    expect(anomalyPresentationKey(first)).toBe("anomaly:test:inconclusive:1:1");
    expect(
      selectAnomalyForPresentation({
        acknowledgedKeys: new Set([anomalyPresentationKey(first)]),
        activeAnomalyId: undefined,
        anomalyDetectionPending: false,
        investigationCompletionPending: true,
        models: [{ anomalies: [second] }],
      })?.anomaly,
    ).toBe(second);
  });

  it("does not reopen old results without their completion pause", () => {
    expect(
      selectAnomalyForPresentation({
        acknowledgedKeys: new Set(),
        activeAnomalyId: undefined,
        anomalyDetectionPending: false,
        investigationCompletionPending: false,
        models: [{ anomalies: [anomaly("resolved")] }],
      }),
    ).toBeUndefined();
  });

  it("still presents newly detected unresolved anomalies immediately", () => {
    expect(
      selectAnomalyForPresentation({
        acknowledgedKeys: new Set(),
        activeAnomalyId: undefined,
        anomalyDetectionPending: true,
        investigationCompletionPending: false,
        models: [{ anomalies: [anomaly("unresolved")] }],
      })?.anomaly.status,
    ).toBe("unresolved");
  });

  it("presents a reproduced case after its earlier lifecycle was acknowledged", () => {
    const original = anomaly("unresolved");
    const reproduced = { ...original, observationCount: 2 };

    expect(
      selectAnomalyForPresentation({
        acknowledgedKeys: new Set([anomalyPresentationKey(original)]),
        activeAnomalyId: undefined,
        anomalyDetectionPending: true,
        investigationCompletionPending: false,
        models: [{ anomalies: [reproduced] }],
      })?.anomaly,
    ).toBe(reproduced);
  });

  it("presents a reproduced mitigated case as confirmed on its detection pause", () => {
    const original = anomaly("confirmed");
    const reproduced = { ...original, observationCount: 2 };

    expect(
      selectAnomalyForPresentation({
        acknowledgedKeys: new Set([anomalyPresentationKey(original)]),
        activeAnomalyId: undefined,
        anomalyDetectionPending: true,
        investigationCompletionPending: false,
        models: [{ anomalies: [reproduced] }],
      })?.anomaly,
    ).toBe(reproduced);
  });
});
