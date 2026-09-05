import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GameView } from "../../runtime/index.ts";
import { CapabilityTrajectory } from "./capability-trajectory.tsx";

function trajectoryView(): GameView {
  return {
    meta: { tick: 156 },
    models: {
      cards: [
        {
          modelId: "model:1",
          displayName: "DeepSearch-1",
          trainedAtTick: 12,
          frontierCapabilityEstimate: 4,
          capabilityConfidence: "high",
          capability: { reasoning: 4 },
        },
        {
          modelId: "model:2",
          displayName: "DeepSearch-2",
          trainedAtTick: 52,
          frontierCapabilityEstimate: 14,
          capabilityConfidence: "high",
          capability: { reasoning: 14 },
        },
        {
          modelId: "model:3",
          displayName: "DeepSearch-3",
          trainedAtTick: 80,
          frontierCapabilityEstimate: 12,
          capabilityConfidence: "medium",
          capability: { reasoning: 12 },
        },
        {
          modelId: "model:4",
          displayName: "DeepSearch-4",
          trainedAtTick: 120,
          frontierCapabilityEstimate: 34,
          capabilityConfidence: "high",
          capability: { reasoning: 34 },
        },
      ],
    },
  } as unknown as GameView;
}

describe("CapabilityTrajectory", () => {
  it("shows measured capability, frontier pace, milestones and relative doublings", () => {
    const markup = renderToStaticMarkup(
      createElement(CapabilityTrajectory, { view: trajectoryView() }),
    );

    expect(markup).toContain("How fast the frontier is moving");
    expect(markup).toContain("Current frontier");
    expect(markup).toContain(">34<");
    expect(markup).toContain("+20 FC");
    expect(markup).toContain("AGI candidate · FC 88");
    expect(markup).toContain("8× since the first model");
    expect(markup).toContain("3.0 capability doublings");
    expect(markup).toContain("DeepSearch-3");
    expect(markup).not.toContain("Display index only");
  });

  it("keeps the empty state short and actionable", () => {
    const view = {
      meta: { tick: 0 },
      models: { cards: [] },
    } as unknown as GameView;
    const markup = renderToStaticMarkup(createElement(CapabilityTrajectory, { view }));

    expect(markup).toContain("No measured model evidence yet.");
    expect(markup).toContain("Train the lab&#x27;s first model");
  });
});
