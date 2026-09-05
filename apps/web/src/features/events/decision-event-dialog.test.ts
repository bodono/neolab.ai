import { describe, expect, it } from "vitest";

import {
  describeEventEffect,
  eventCopyFallback,
  eventLikelihoodCopy,
  formatEventEvidenceValue,
} from "./decision-event-formatters.ts";

describe("eventCopyFallback", () => {
  it("keeps authored prose and interpolates safe display tokens", () => {
    expect(
      eventCopyFallback(
        "{aiName} requests root access for {weeks} weeks",
        { aiName: "GBT", weeks: 3 },
        "body",
      ),
    ).toBe("GBT requests root access for 3 weeks");
  });

  it("turns unresolved localisation keys into readable temporary copy", () => {
    expect(eventCopyFallback("event.ai.root-access-request.title", {}, "title")).toBe(
      "Root access request",
    );
    expect(eventCopyFallback("event.ai.root-access-request.body", {}, "body")).toBe(
      "Root access request. Review the evidence and declared consequences below.",
    );
  });
});

describe("eventLikelihoodCopy", () => {
  it("shows authored qualitative promises without exposing success branches", () => {
    expect(
      eventLikelihoodCopy({
        optionId: "attempt",
        labelKey: "event.test.attempt.label",
        previewKey: "event.test.attempt.preview",
        enabled: true,
        blockers: [],
        knownCosts: [],
        immediateEffects: [],
        uncertainty: "precommitted-checks",
        likelihoodPromises: [{ checkId: "result", label: "very-likely" }],
        confirmationRequired: false,
      }),
    ).toBe("VERY LIKELY");
  });

  it("describes deterministic choices as guaranteed outcomes", () => {
    expect(
      eventLikelihoodCopy({
        optionId: "review",
        labelKey: "event.test.review.label",
        previewKey: "event.test.review.preview",
        enabled: true,
        blockers: [],
        knownCosts: [],
        immediateEffects: [],
        uncertainty: "none",
        likelihoodPromises: [],
        confirmationRequired: false,
      }),
    ).toBe("GUARANTEED OUTCOME");
  });
});

describe("formatEventEvidenceValue", () => {
  it("formats cash without leaking floating-point state", () => {
    expect(formatEventEvidenceValue("player.cash", 0.6600000000000001)).toBe("$0.7M");
    expect(formatEventEvidenceValue("player.cash", -0.04)).toBe("$0M");
  });

  it("renders counts and ratings as rounded, readable values", () => {
    expect(formatEventEvidenceValue("player.gpus.total", 12_345)).toBe("12,345");
    expect(formatEventEvidenceValue("player.organisation.boardPatience", 69.8)).toBe(
      "70",
    );
  });
});

describe("describeEventEffect", () => {
  it("describes research consistency effects without leaking internal statistic names", () => {
    expect(
      describeEventEffect({
        kind: "add-modifier",
        target: "lab.research.domain.reinforcement-agency.weeklyVarianceWidth",
        operation: "multiply",
        value: 0.7,
      }),
    ).toBe(
      "Week-to-week progress in Reinforcement Learning & Agency becomes 30% more consistent",
    );
  });

  it("makes guaranteed gains, penalties, and durations readable", () => {
    expect(
      describeEventEffect({
        kind: "add-rating",
        subject: { type: "player-lab" },
        rating: "practicalControlStrength",
        amount: 4,
      }),
    ).toBe("+4 Practical control strength");
    expect(
      describeEventEffect({
        kind: "add-rating",
        subject: { type: "player-lab" },
        rating: "safetyCulture",
        amount: -3,
      }),
    ).toBe("−3 Safety culture");
    expect(
      describeEventEffect({
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "cash",
        amount: -8_000,
      }),
    ).toBe("−$8B cash");
    expect(
      describeEventEffect({
        kind: "add-modifier",
        target: "lab.research.all.output",
        operation: "multiply",
        value: 0.97,
        durationWeeks: 13,
      }),
    ).toBe("Overall research output decreases by 3% for 13 weeks");
    expect(
      describeEventEffect({
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "aura-spendable",
        amount: -20,
        auraChangeKind: "loss",
        auraCategory: "incident",
        auraSignalImpact: -20,
      }),
    ).toBe("−20 Aura · −20 public Aura Signal");
  });
});
