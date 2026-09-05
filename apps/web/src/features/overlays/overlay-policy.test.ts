import { describe, expect, it } from "vitest";

import type { EventQueueItemView, PresentationQueueItemView } from "@neolab/sim/public";

import { chooseOverlay } from "./overlay-policy.ts";

function event(
  instanceId: string,
  severity: EventQueueItemView["severity"],
  priority: number,
): EventQueueItemView {
  return {
    instanceId,
    definitionId: `base:event.test.${instanceId}`,
    severity,
    category: "ai",
    source: "mandatory",
    priority,
    titleKey: `event.${instanceId}.title`,
    bodyKey: `event.${instanceId}.body`,
    tokens: {},
    evidence: [],
    createdAtTick: 3,
    deadlineLabel: "Blocking decision · no expiry",
    options: [],
  };
}

const discovery: PresentationQueueItemView = {
  key: "capability-tier:test",
  kind: "capability-tier",
  attention: "modal",
  definitionId: "base:capability-tier.test",
  modelId: "run:model:player:0001",
  createdAtTick: 2,
  title: "A milestone",
  summary: "Something has happened in a neural network.",
  tierLevel: 1,
  modelDisplayName: "Test Model-1",
  ownerLabId: "lab:player",
  ownerLabName: "Test Lab",
  ownerAiName: "Test AI",
  isPlayerModel: true,
  unlockLabels: ["Test Products"],
};

const endgameReturn: PresentationQueueItemView = {
  key: "endgame-return:false-dawn:model:1:140",
  kind: "endgame-return",
  attention: "modal",
  endingId: "base:ending.false-dawn",
  endingDisplayName: "False Dawn",
  endingSummary: "The candidate was not superintelligence.",
  mechanicalCause: "The capability claim failed.",
  modelId: "model:1",
  modelDisplayName: "Aquarius-7",
  createdAtTick: 140,
  crisisWeeksSpent: 18,
  cooldownUntilTick: 192,
  cooldownWeeks: 52,
  remainingCooldownWeeks: 52,
  restoredAccessLevel: 2,
  productQuality: 91,
  phase: "choice",
  durableMoratoriumAvailable: true,
  moratoriumForecast: {
    probabilityPercent: 50,
    strength: 67,
    difficulty: 67,
    durationWeeks: 8,
    positiveFactors: [],
    pressureFactors: [],
    rivals: [],
  },
};

const moratoriumResult: PresentationQueueItemView = {
  key: "moratorium-result:model:1:140",
  kind: "moratorium-result",
  attention: "modal",
  resultId: "moratorium-failed",
  modelId: "model:1",
  modelDisplayName: "Aquarius-7",
  createdAtTick: 140,
  archiveDisposition: "filtered-technical-note",
  archiveDispositionName: "Preserve a filtered technical note",
  recoveryEndsAtTick: 153,
  recoveryWeeksRemaining: 13,
  governmentTrustLost: 8,
  governmentAttentionAdded: 10,
};

const proofResult: PresentationQueueItemView = {
  key: "capability-proof-result:proof:model:1:0",
  kind: "capability-proof-result",
  attention: "modal",
  historyId: "proof:model:1:0",
  modelId: "model:1",
  modelDisplayName: "Aquarius-7",
  createdAtTick: 36,
  attemptNumber: 1,
  resultId: "disputed",
  outcome: "disputed",
  challengeName: "Generalist gauntlet",
  verifierName: "Independent institutional verification",
  claimScope: "Broad superintelligence",
  accessLevelAtProof: 2,
  evidenceStrength: 46,
  integrityLabel: "Durable",
  summary: "The candidate did not produce a durable pass.",
  explanation: "The evidence did not clear the protocol standard.",
  consequence: "Regulators opened an inquiry.",
};

const rivalSetback: PresentationQueueItemView = {
  key: "rival-candidate-setback:lab:rival:model:rival:80",
  kind: "rival-candidate-setback",
  attention: "modal",
  outcome: "false-dawn",
  rivalLabId: "lab:rival",
  rivalLabName: "Kestrel Systems",
  rivalAiName: "DeepSearch",
  modelId: "model:rival",
  modelDisplayName: "DeepSearch-9",
  createdAtTick: 80,
  countdownStartedAtTick: 54,
  elapsedWeeks: 26,
};

describe("overlay priority policy", () => {
  it("orders critical above discovery above urgent above ordinary decisions and user overlays", () => {
    const common = {
      presentations: [discovery],
      deferredEventIds: new Set<string>(),
      userOverlayKey: "gpu-market",
    };
    expect(
      chooseOverlay({
        ...common,
        events: [event("urgent", "urgent", 200), event("critical", "critical", 1)],
      }),
    ).toMatchObject({
      kind: "event",
      tier: "critical",
      item: { instanceId: "critical" },
    });
    expect(
      chooseOverlay({ ...common, events: [event("urgent", "urgent", 200)] }),
    ).toMatchObject({ kind: "presentation", tier: "discovery" });
    expect(
      chooseOverlay({
        ...common,
        presentations: [],
        events: [event("urgent", "urgent", 200)],
      }),
    ).toMatchObject({ kind: "event", tier: "urgent" });
    expect(chooseOverlay({ ...common, presentations: [], events: [] })).toEqual({
      kind: "user",
      tier: "user",
      key: "gpu-market",
    });
  });

  it("shows ordinary decisions once, then leaves deferred decisions in the feed", () => {
    const urgent = event("urgent", "urgent", 200);
    const decision = event("decision", "decision", 100);
    expect(
      chooseOverlay({
        events: [urgent, decision],
        presentations: [],
        deferredEventIds: new Set([urgent.instanceId]),
      }),
    ).toMatchObject({
      kind: "event",
      tier: "decision",
      item: { instanceId: "decision" },
    });
    expect(
      chooseOverlay({
        events: [urgent, decision],
        presentations: [],
        deferredEventIds: new Set([urgent.instanceId, decision.instanceId]),
      }),
    ).toBeUndefined();
    expect(
      chooseOverlay({
        events: [urgent, decision],
        presentations: [],
        deferredEventIds: new Set([urgent.instanceId, decision.instanceId]),
        requestedEventId: decision.instanceId,
      }),
    ).toMatchObject({ kind: "event", tier: "user", item: { instanceId: "decision" } });
  });

  it("never allows a critical decision to be deferred", () => {
    expect(
      chooseOverlay({
        events: [event("critical", "critical", 1)],
        presentations: [],
        deferredEventIds: new Set(["critical"]),
      }),
    ).toMatchObject({ kind: "event", tier: "critical" });
  });

  it("shows the mandatory False Dawn future ahead of stale queued overlays", () => {
    expect(
      chooseOverlay({
        events: [event("critical", "critical", 500)],
        presentations: [discovery, endgameReturn],
        deferredEventIds: new Set<string>(),
        requestedEventId: "critical",
        userOverlayKey: "crisis-decision:model:42:final-review",
      }),
    ).toEqual({ kind: "presentation", tier: "discovery", item: endgameReturn });
  });

  it("shows a rejected Long Pause result ahead of stale events and discoveries", () => {
    expect(
      chooseOverlay({
        events: [event("critical", "critical", 500)],
        presentations: [discovery, moratoriumResult],
        deferredEventIds: new Set<string>(),
      }),
    ).toEqual({ kind: "presentation", tier: "discovery", item: moratoriumResult });
  });

  it("shows every capability-proof verdict before the next crisis decision", () => {
    expect(
      chooseOverlay({
        events: [event("critical", "critical", 500)],
        presentations: [discovery, proofResult],
        deferredEventIds: new Set<string>(),
        userOverlayKey: "crisis-decision:model:42:confirmation:2",
      }),
    ).toEqual({ kind: "presentation", tier: "discovery", item: proofResult });
  });

  it("interrupts stale events with a rival candidacy setback bulletin", () => {
    expect(
      chooseOverlay({
        events: [event("critical", "critical", 500)],
        presentations: [discovery, rivalSetback],
        deferredEventIds: new Set<string>(),
        requestedEventId: "critical",
        userOverlayKey: "gpu-market",
      }),
    ).toEqual({ kind: "presentation", tier: "discovery", item: rivalSetback });
  });

  it("puts a Deployment Crisis decision ahead of discoveries and ordinary events", () => {
    const input = {
      events: [event("urgent", "urgent", 200)],
      presentations: [discovery],
      deferredEventIds: new Set<string>(),
      userOverlayKey: "crisis-decision:model:42:final-review",
    };
    expect(chooseOverlay(input)).toEqual({
      kind: "user",
      tier: "user",
      key: input.userOverlayKey,
    });
    expect(
      chooseOverlay({
        ...input,
        events: [event("critical", "critical", 1)],
      }),
    ).toMatchObject({ kind: "event", tier: "critical" });
  });

  it("mounts no competing overlay during an exclusive full-screen sequence", () => {
    expect(
      chooseOverlay({
        events: [event("critical", "critical", 500)],
        presentations: [discovery],
        deferredEventIds: new Set<string>(),
        requestedEventId: "critical",
        userOverlayKey: "gpu-market",
        exclusiveSequenceActive: true,
      }),
    ).toBeUndefined();
  });
});
