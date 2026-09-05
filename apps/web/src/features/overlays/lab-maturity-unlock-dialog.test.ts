import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LabMaturityUnlockPresentationQueueItemView } from "@neolab/sim/public";

import { LabMaturityUnlockDialog } from "./lab-maturity-unlock-dialog.tsx";

describe("LabMaturityUnlockDialog", () => {
  it("ends onboarding with the real AGI objective and exact candidacy gate", () => {
    const item: LabMaturityUnlockPresentationQueueItemView = {
      key: "lab-maturity:frontier",
      kind: "lab-maturity-unlock",
      attention: "modal",
      stage: "frontier",
      createdAtTick: 42,
      chapter: "CHAPTER 09 // THE FRONTIER",
      title: "Now build the future.",
      narrative: "Every department is now operational.",
      mechanic:
        "Launch models, expand compute, invest in research, and safely deploy AGI before a rival does.",
      unlocked: ["AGI Candidate Programme", "The full game"],
      directive: "Train and deploy a safe AGI.",
      completionBriefing: {
        eyebrow: "FINAL OBJECTIVE // THE SINGULARITY",
        objective: "Train and deploy a safe AGI.",
        summary: "Candidacy is only the gate.",
        requirements: [
          "Train a model with Frontier Capability 88+ and every capability trait 80+.",
          "Complete all four Candidate Programme major works.",
          "Nominate one exact qualifying model as the candidate.",
          "Build credible safety evidence and retain human control.",
        ],
        note: "Raw training FLOP is not a candidacy gate.",
      },
    };

    const markup = renderToStaticMarkup(
      createElement(LabMaturityUnlockDialog, {
        item,
        onContinue: vi.fn(),
      }),
    );

    expect(markup).toContain("FINAL OBJECTIVE // THE SINGULARITY");
    expect(markup).toContain("HOW IT WORKS");
    expect(markup).toContain("safely deploy AGI before a rival does");
    expect(markup).toContain("Train and deploy a safe AGI.");
    expect(markup).toContain("Frontier Capability 88+");
    expect(markup).toContain("every capability trait 80+");
    expect(markup).toContain("all four Candidate Programme major works");
    expect(markup).toContain("Raw training FLOP is not a candidacy gate");
    expect(markup).toContain("Enter the full game");
    expect(markup).not.toContain("capability 30");
  });
});
