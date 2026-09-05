import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RolloutDecisionDialog } from "./rollout-decision-dialog.tsx";

type Actions = ComponentProps<typeof RolloutDecisionDialog>["actions"];

const actions = {
  kind: "rollout",
  currentBeat: "first-operation",
  awaitingDecision: true,
  decisionContext: {
    eyebrow: "MANIFESTED RISK // BOUNDARY RECOGNISED",
    title: "The Candidate Identifies The Evaluation Environment.",
    body: "It correctly names hidden features of the test harness.",
    tone: "hazard",
  },
  options: [
    {
      id: "move-to-blinded-reserve",
      label: "Move to the blinded reserve environment",
      consequence: "Adds two weeks and restores a cleaner separation.",
    },
    {
      id: "push-through",
      label: "Continue with the recognised environment",
      consequence: "Keeps tempo while making reassuring observations harder to trust.",
    },
  ],
} as unknown as Actions;

describe("RolloutDecisionDialog", () => {
  it("presents every route twist as a focused dialog with explicit deferral", () => {
    const html = renderToStaticMarkup(
      createElement(RolloutDecisionDialog, {
        actions,
        onChoose: vi.fn(),
        onDefer: vi.fn(),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("The Candidate Identifies The Evaluation Environment.");
    expect(html).toContain("Move to the blinded reserve environment");
    expect(html).toContain("Continue with the recognised environment");
    expect(html).toContain("World clocks resume after this window");
    expect(html).toContain('class="secondary rollout-decision-defer"');
    expect(html).toContain("Decide later");
  });
});
