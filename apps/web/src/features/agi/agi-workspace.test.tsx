import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameView } from "@neolab/sim/public";

import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { AgiWorkspace } from "./agi-workspace.tsx";

function autonomyLessonView(): GameView {
  return {
    meta: {
      labMaturity: {
        features: ["autonomy"],
      },
    },
    models: {
      candidateProgramme: {
        components: [],
        capabilityFloorLabel: "Frontier Capability 88+",
      },
      autonomy: {
        currentLevel: 0,
        currentLevelName: "Air-gapped inference",
        currentModelDisplayName: "Aquarius-2",
        benefitLabel: "No research acceleration",
        riskLabel: "Contained",
        detectionLabel: "High",
        costLabel: "No government attention from access",
        ignoredEscalations: 0,
        ignoredEscalationLimit: 2,
        escapedWeights: false,
        levels: [],
        incidents: [],
      },
    },
  } as unknown as GameView;
}

describe("AGI and RSI workspace maturity", () => {
  it("shows only the Autonomy Programme during the dedicated RSI lesson", () => {
    const markup = renderToStaticMarkup(
      <AgiWorkspace runtime={{} as BrowserGameRuntime} view={autonomyLessonView()} />,
    );

    expect(markup).toContain("The Autonomy Programme");
    expect(markup).toContain("Access permissions unlock from measured capability alone");
    expect(markup).not.toContain("AGI Candidate Programme");
    expect(markup).not.toContain("Candidate works");
  });
});
