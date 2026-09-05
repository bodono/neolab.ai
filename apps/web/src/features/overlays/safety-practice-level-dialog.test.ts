import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SafetyPracticeLevelPresentationQueueItemView } from "@neolab/sim/public";

import { SafetyPracticeLevelDialog } from "./safety-practice-level-dialog.tsx";

const item: SafetyPracticeLevelPresentationQueueItemView = {
  key: "safety-practice-level:evaluation:test:6",
  kind: "safety-practice-level",
  attention: "modal",
  evaluationId: "evaluation:test",
  modelId: "model:test",
  modelDisplayName: "DeepSearch-12",
  evaluationDisplayName: "Interpretability audit",
  createdAtTick: 300,
  fromLevel: 5,
  toLevel: 6,
  fromLabel: "Integrated safety testing",
  toLabel: "Independent assurance office",
  previousPracticeXp: 39,
  newPracticeXp: 42,
  practiceXpGained: 3,
  previousBenefits: {
    auditTimeReductionPercent: 16,
    evaluationCashReductionPercent: 11,
    estimateUncertaintyReduction: 4,
    anomalyDetectionBonusPercent: 15.6,
  },
  currentBenefits: {
    auditTimeReductionPercent: 20,
    evaluationCashReductionPercent: 14,
    estimateUncertaintyReduction: 4,
    anomalyDetectionBonusPercent: 16.8,
  },
  nextLevel: 7,
  nextThreshold: 52,
  pointsToNextLevel: 10,
};

describe("SafetyPracticeLevelDialog", () => {
  it("celebrates the source, permanent benefits, gains, and next milestone", () => {
    const html = renderToStaticMarkup(
      createElement(SafetyPracticeLevelDialog, {
        item,
        onContinue: vi.fn(),
        onReview: vi.fn(),
      }),
    );

    expect(html).toContain("Safety Practice reaches Level 6.");
    expect(html).toContain("Independent assurance office");
    expect(html).toContain("Interpretability audit");
    expect(html).toContain("DeepSearch-12");
    expect(html).toContain("+3 permanent practice XP");
    expect(html).toContain("−20%");
    expect(html).toContain("evaluation FLOPs / audit time");
    expect(html).toContain("−14%");
    expect(html).toContain("+16.8%");
    expect(html).toContain("WHAT IMPROVED THIS TIME");
    expect(html).toContain("10 more permanent practice XP required");
    expect(html).toContain("Review Safety Practice");
    expect(html).toContain("Celebrate, then continue");
  });
});
