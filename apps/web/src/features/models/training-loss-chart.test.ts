import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameView } from "../../runtime/index.ts";
import { TrainingLossChart } from "./training-loss-chart.tsx";

type TrainingTelemetry = GameView["models"]["trainingTelemetry"];

describe("TrainingLossChart", () => {
  it("renders comparable history, current telemetry, and a diverged baseline", () => {
    const telemetry: TrainingTelemetry = {
      curves: [
        {
          projectId: "history",
          label: "Aquarius-1",
          role: "history",
          status: "completed",
          attemptNumber: 1,
          scaleLabel: "Prototype",
          postureLabel: "Normal",
          points: [
            { trainingFractionBasisPoints: 0, validationPerplexity: 122 },
            { trainingFractionBasisPoints: 10_000, validationPerplexity: 31 },
          ],
          latestPerplexity: 31,
        },
        {
          projectId: "failed",
          label: "Run 2 · Product (failed)",
          role: "failed-baseline",
          status: "failed",
          attemptNumber: 2,
          scaleLabel: "Product",
          postureLabel: "YOLO",
          points: [
            { trainingFractionBasisPoints: 0, validationPerplexity: 150 },
            { trainingFractionBasisPoints: 6_500, validationPerplexity: 42 },
            { trainingFractionBasisPoints: 7_000, validationPerplexity: 255 },
          ],
          latestPerplexity: 255,
          failedAtBasisPoints: 7_000,
        },
        {
          projectId: "current",
          label: "Run 3 · Frontier",
          role: "current",
          status: "active",
          attemptNumber: 3,
          scaleLabel: "Frontier",
          postureLabel: "Conservative",
          points: [
            { trainingFractionBasisPoints: 0, validationPerplexity: 114 },
            { trainingFractionBasisPoints: 2_500, validationPerplexity: 58.2 },
          ],
          latestPerplexity: 58.2,
        },
      ],
      omittedSuccessfulRuns: 2,
      maximumHistoricalRuns: 10,
    };

    const markup = renderToStaticMarkup(createElement(TrainingLossChart, { telemetry }));

    expect(markup).toContain("Training fraction complete");
    expect(markup).toContain("Validation perplexity");
    expect(markup).toContain("latest failed baseline");
    expect(markup).toContain("DIVERGED");
    expect(markup).toContain("2 older successful runs are omitted");
    expect(markup).not.toContain("evidence for stronger language and reasoning");
    expect(markup).not.toContain("it says nothing about alignment");
    expect(markup).toContain("<desc");
  });

  it("explains a queued run before its first observation", () => {
    const telemetry: TrainingTelemetry = {
      curves: [
        {
          projectId: "queued",
          label: "Run 1 · Prototype",
          role: "current",
          status: "queued",
          attemptNumber: 1,
          scaleLabel: "Prototype",
          postureLabel: "Normal",
          points: [],
        },
      ],
      omittedSuccessfulRuns: 0,
      maximumHistoricalRuns: 10,
    };

    const markup = renderToStaticMarkup(createElement(TrainingLossChart, { telemetry }));

    expect(markup).toContain("QUEUED // AWAITING FIRST OPTIMISATION STEP");
    expect(markup).toContain("no observations yet");
  });
});
