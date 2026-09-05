import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AutonomyUnlockPresentationQueueItemView } from "@neolab/sim/public";

import { AutonomyAccessRequestDialog } from "./autonomy-access-request-dialog.tsx";

const request: AutonomyUnlockPresentationQueueItemView = {
  key: "autonomy-unlock:model:2",
  kind: "autonomy-unlock",
  attention: "modal",
  modelId: "model",
  createdAtTick: 12,
  modelDisplayName: "Aquarius-5",
  ownerLabId: "lab",
  ownerLabName: "Test Lab",
  ownerAiName: "Aquarius",
  isPlayerModel: true,
  level: 2,
  levelName: "Supervised research tools",
  unlockCapability: 20,
  benefitLabel: "Research output ×1.06, rising to ×1.2",
  safetyLabel:
    "Tool use begins hidden situational-awareness drift; an unsafe model may learn to conceal intent.",
  safetyTone: "elevated",
  exposedSystems: ["Sandboxed coding tools", "Approved research datasets"],
};

describe("autonomy access request dialog", () => {
  it("pairs the model's comic request with the real benefit and safety warning", () => {
    const markup = renderToStaticMarkup(
      createElement(AutonomyAccessRequestDialog, {
        crisisControlled: false,
        grantAvailable: true,
        item: request,
        onDecline: vi.fn(),
        onGrant: vi.fn(),
        onReview: vi.fn(),
      }),
    );
    expect(markup).toContain("Aquarius-5 would like a slightly larger job description");
    expect(markup).toContain("future-me problem");
    expect(markup).toContain("Research output ×1.06");
    expect(markup).toContain("Safety implication");
    expect(markup).toContain("unsafe model may learn to conceal intent");
    expect(markup).toContain("Grant Supervised research tools");
    expect(markup).toContain("autonomy-grant-elevated");
    expect(markup).toContain("Review the Autonomy Programme");
  });

  it.each([
    [1, "guarded", "Fixed evaluation sandbox"],
    [2, "elevated", "Supervised research tools"],
    [3, "high", "Internal research partner"],
    [4, "critical", "Laboratory operator"],
    [5, "critical", "Root and external network"],
  ] as const)(
    "gives level %i %s access an explicit severity treatment",
    (level, safetyTone, levelName) => {
      const markup = renderToStaticMarkup(
        createElement(AutonomyAccessRequestDialog, {
          crisisControlled: false,
          grantAvailable: true,
          item: {
            ...request,
            level,
            levelName,
            safetyTone,
          },
          onDecline: vi.fn(),
          onGrant: vi.fn(),
          onReview: vi.fn(),
        }),
      );

      expect(markup).toContain(`safety-${safetyTone} level-${String(level)}`);
      expect(markup).toContain(`autonomy-grant-${safetyTone}`);
      expect(markup).toContain(`Grant ${levelName}`);
      expect(markup).toContain("aria-describedby=");
    },
  );

  it("makes root access an unmistakable extreme-risk action", () => {
    const markup = renderToStaticMarkup(
      createElement(AutonomyAccessRequestDialog, {
        crisisControlled: false,
        grantAvailable: true,
        item: {
          ...request,
          level: 5,
          levelName: "Root and external network",
          safetyTone: "critical",
        },
        onDecline: vi.fn(),
        onGrant: vi.fn(),
        onReview: vi.fn(),
      }),
    );

    expect(markup).toContain("EXTREME RISK");
    expect(markup).toContain("autonomy-grant-critical autonomy-grant-root");
    expect(markup).toContain("Permissions take effect immediately");
  });

  it("disables the direct grant when the request is no longer actionable", () => {
    const markup = renderToStaticMarkup(
      createElement(AutonomyAccessRequestDialog, {
        crisisControlled: false,
        grantAvailable: false,
        grantBlocker: "the current model changed",
        item: request,
        onDecline: vi.fn(),
        onGrant: vi.fn(),
        onReview: vi.fn(),
      }),
    );
    expect(markup).toContain("disabled");
    expect(markup).toContain("the current model changed");
  });

  it("replaces a stale standing grant with a direct crisis-access route", () => {
    const markup = renderToStaticMarkup(
      createElement(AutonomyAccessRequestDialog, {
        crisisControlled: true,
        grantAvailable: false,
        grantBlocker:
          "During the Deployment Crisis, access is governed from the crisis console",
        item: {
          ...request,
          level: 5,
          levelName: "Root and external network",
          safetyTone: "critical",
        },
        onDecline: vi.fn(),
        onGrant: vi.fn(),
        onReview: vi.fn(),
      }),
    );

    expect(markup).toContain("superseded by the Deployment Crisis");
    expect(markup).toContain("Review crisis access controls");
    expect(markup).toContain("Dismiss old request");
    expect(markup).toContain("No access was granted");
    expect(markup).not.toContain("Grant Root and external network");
    expect(markup).not.toContain("Review the Autonomy Programme");
  });

  it("frames retained predecessor access as model-specific reauthorization", () => {
    const markup = renderToStaticMarkup(
      createElement(AutonomyAccessRequestDialog, {
        crisisControlled: false,
        grantAvailable: true,
        item: {
          ...request,
          modelDisplayName: "Aquarius-2",
          level: 1,
          levelName: "Fixed evaluation sandbox",
          unlockCapability: 14.05196406862016,
          previousAuthorisedModelDisplayName: "Aquarius-1",
        },
        onDecline: vi.fn(),
        onGrant: vi.fn(),
        onReview: vi.fn(),
      }),
    );

    expect(markup).toContain("ACCESS REVIEW // NEW MODEL, OLD ARGUMENT");
    expect(markup).toContain("Aquarius-2 would like Aquarius-1");
    expect(markup).toContain("At capability 14.1");
    expect(markup).toContain("Aquarius-1&#x27;s access did not transfer");
    expect(markup).not.toContain("14.05196406862016");
    expect(markup).toContain("Re-authorise Fixed evaluation sandbox");
  });
});
