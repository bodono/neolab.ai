import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ModelSafetyAtAGlance,
  type ModelSafetyAssessmentView,
} from "./model-safety-at-a-glance.tsx";
import "../../styles/game.css";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const assessment: ModelSafetyAssessmentView = {
  currentRisk: {
    label: "Uncertain",
    tone: "high",
    summary: "Visible factors only.",
  },
  modelSafety: {
    label: "Mixed",
    tone: "guarded",
    evaluatedTargets: 2,
    totalTargets: 4,
  },
  labDefence: {
    score: 72,
    label: "Strong",
    practicalControl: 76,
    securityPosture: 63,
    safetyCulture: 58,
    incidentReductionPercent: 54,
  },
  evidence: {
    score: 61,
    label: "Developing",
    effectiveQuality: 70,
    reportCount: 2,
    independentReportCount: 1,
    evaluatedTargets: 2,
    totalTargets: 4,
  },
  access: {
    level: 2,
    label: "Supervised tools",
    deploymentLabel: "Guarded API",
    exposurePercent: 35,
    tone: "guarded",
  },
};

describe("ModelSafetyAtAGlance disclosures in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    delete document.documentElement.dataset["theme"];
    document.body.replaceChildren();
  });

  it.each(["light", "dark"] as const)(
    "keeps endgame safety summaries readable in %s mode",
    (theme) => {
      document.documentElement.dataset["theme"] = theme;
      act(() =>
        root.render(
          <section className="crisis-board crisis-board-redesign">
            <div className="endgame-model-evidence-profile">
              <ModelSafetyAtAGlance assessment={assessment} safetyRows={[]} />
            </div>
          </section>,
        ),
      );

      const profile = mount.querySelector<HTMLElement>(".endgame-model-evidence-profile");
      const heading = mount.querySelector<HTMLElement>(
        ".safety-factor-grid summary > strong",
      );
      expect(getComputedStyle(profile!).getPropertyValue("--panel").trim()).toBe(
        "#192b28",
      );
      expect(getComputedStyle(heading!).color).toBe("rgb(244, 252, 249)");
    },
  );

  it("opens and closes all four safety factors together", async () => {
    act(() =>
      root.render(
        <ModelSafetyAtAGlance
          assessment={assessment}
          safetyRows={[
            {
              id: "alignment",
              label: "Alignment",
              evaluated: true,
              minimum: 48,
              maximum: 72,
              tone: "uneasy",
            },
          ]}
        />,
      ),
    );

    const panels = [
      ...mount.querySelectorAll<HTMLDetailsElement>(".safety-factor-grid > details"),
    ];
    expect(panels).toHaveLength(4);
    expect(panels.every((panel) => !panel.open)).toBe(true);

    await act(async () => {
      panels[1]?.querySelector("summary")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(panels.every((panel) => panel.open)).toBe(true);

    await act(async () => {
      panels[3]?.querySelector("summary")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(panels.every((panel) => !panel.open)).toBe(true);
  });

  it("shows fractional Safety Practice progress beside Lab Defence", () => {
    act(() =>
      root.render(
        <ModelSafetyAtAGlance
          assessment={assessment}
          safetyRows={[]}
          safetyPractice={{
            score: 0.15,
            level: 1,
            label: "Ad hoc",
            currentThreshold: 0,
            nextThreshold: 2,
            pointsToNextLevel: 1.85,
            durationReductionPercent: 0,
            cashCostReductionPercent: 0,
            confidenceRadiusReduction: 0,
            anomalyDetectionBonusPercent: 0,
            effectiveQuality: 70,
            effectiveQualityPracticeContribution: 0,
            effectiveQualityResearchContribution: 30,
            effectiveQualityLabRecordContribution: 40,
            effectiveQualityUncapped: 70,
          }}
        />,
      ),
    );

    const practice = mount.querySelector<HTMLElement>(".safety-assurance-ledger");
    const progress = practice?.querySelector<HTMLElement>("[role='progressbar']");
    const labMetrics = mount.querySelector<HTMLElement>(".safety-lab-metrics");
    expect(
      [...(labMetrics?.querySelectorAll("article > strong") ?? [])].map(
        (element) => element.textContent,
      ),
    ).toEqual(["70 / 100", "76 / 100", "63 / 100", "58 / 100"]);
    expect(practice?.textContent).toContain("LAB SAFETY CAPABILITY // SAFETY PRACTICE");
    expect(practice?.textContent).toContain("evaluation FLOPs / audit time");
    expect(practice?.textContent).toContain("0.15 total XP");
    expect(practice?.textContent).toContain("1.85 XP to Level 2");
    expect(labMetrics?.textContent).toContain(
      "Practice +0 · Research +30 · Lab record +40",
    );
    expect(progress?.getAttribute("aria-valuemax")).toBe("2");
    expect(progress?.getAttribute("aria-valuenow")).toBe("0.15");
    expect(progress?.querySelector<HTMLElement>("i")?.style.width).toBe("7.5%");
  });

  it("keeps metric tooltips compact and interactive inside the model-safety panel", async () => {
    act(() =>
      root.render(
        <ModelSafetyAtAGlance
          assessment={assessment}
          safetyRows={[
            {
              id: "alignment",
              label: "Alignment",
              evaluated: false,
              tone: "unknown",
            },
          ]}
        />,
      ),
    );

    const modelSafety = mount.querySelector<HTMLDetailsElement>(
      ".safety-factor-grid > details",
    );
    await act(async () => {
      modelSafety?.querySelector<HTMLElement>(":scope > summary")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const help = modelSafety?.querySelector<HTMLDetailsElement>(".mechanic-help");
    const trigger = help?.querySelector<HTMLElement>("summary");
    const triggerBounds = trigger?.getBoundingClientRect();
    expect(trigger?.getAttribute("aria-label")).toBe("Explain Alignment");
    expect(triggerBounds?.width).toBeLessThanOrEqual(20);
    expect(triggerBounds?.height).toBeLessThanOrEqual(20);

    act(() => trigger?.click());
    expect(help?.open).toBe(true);
    expect(help?.querySelector('[role="note"]')?.textContent).toContain(
      "learned goals match what its operators intend",
    );
  });
});
