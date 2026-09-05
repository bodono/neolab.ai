import { describe, expect, it } from "vitest";

import {
  calculateAnomalyInvestigationOutcomeProbabilities,
  sampleAnomalyInvestigationOutcome,
} from "../evaluations.ts";

describe("anomaly investigation calibration", () => {
  it("uses Eval Quality to replace deterministic closure with uncertainty", () => {
    const weak = calculateAnomalyInvestigationOutcomeProbabilities({
      trueSeverity: 60,
      evalQuality: 0,
    });
    const strong = calculateAnomalyInvestigationOutcomeProbabilities({
      trueSeverity: 60,
      evalQuality: 100,
    });

    expect(weak.confirmed + weak.inconclusive + weak.resolved).toBeCloseTo(1, 12);
    expect(strong.confirmed + strong.inconclusive + strong.resolved).toBeCloseTo(1, 12);
    expect(weak.inconclusive).toBeCloseTo(0.65, 8);
    expect(strong.inconclusive).toBeCloseTo(0.1, 8);
    expect(strong.confirmed).toBeGreaterThan(0.8);
    expect(strong.resolved).toBeLessThan(0.1);
  });

  it("usually clears low-danger false alarms once evidence quality is strong", () => {
    const falseAlarm = calculateAnomalyInvestigationOutcomeProbabilities({
      trueSeverity: 20,
      evalQuality: 100,
    });
    const seriousWarning = calculateAnomalyInvestigationOutcomeProbabilities({
      trueSeverity: 80,
      evalQuality: 100,
    });

    expect(falseAlarm.resolved).toBeGreaterThan(0.85);
    expect(falseAlarm.confirmed).toBeLessThan(0.05);
    expect(seriousWarning.confirmed).toBeGreaterThan(0.89);
    expect(seriousWarning.resolved).toBeLessThan(0.01);
  });

  it("samples all three outcomes instead of applying a hard threshold", () => {
    const probabilities = {
      confirmed: 0.3,
      resolved: 0.25,
      inconclusive: 0.45,
    } as const;

    expect(sampleAnomalyInvestigationOutcome(probabilities, 0.1)).toBe("confirmed");
    expect(sampleAnomalyInvestigationOutcome(probabilities, 0.4)).toBe("resolved");
    expect(sampleAnomalyInvestigationOutcome(probabilities, 0.9)).toBe("inconclusive");
  });

  it("keeps four identical follow-up results uncommon around the ambiguous boundary", () => {
    const probabilities = calculateAnomalyInvestigationOutcomeProbabilities({
      trueSeverity: 44,
      evalQuality: 50,
    });
    const fourOfTheSame =
      probabilities.confirmed ** 4 +
      probabilities.inconclusive ** 4 +
      probabilities.resolved ** 4;

    expect(fourOfTheSame).toBeLessThan(0.05);
  });
});
