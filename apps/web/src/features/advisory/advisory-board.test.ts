import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import {
  createNewGame,
  seed128,
  type GameView,
  type NewGameConfig,
} from "@neolab/sim/public";
import { withBaselineModels } from "@neolab/testkit";

import { BrowserGameRuntime } from "../../runtime/index.ts";
import { buildAdvisoryRecommendations } from "./advisory-board.tsx";

const content = loadCompiledContent();

function firstId<T>(record: Readonly<Record<string, T>>, label: string): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error(`No ${label} content is available`);
  return id;
}

function viewWithAnomaly(): GameView {
  const state = withBaselineModels(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: firstId(
          content.difficulties,
          "difficulty",
        ) as NewGameConfig["difficultyId"],
        leaderId: firstId(content.leaders, "leader") as NewGameConfig["leaderId"],
        mandateId: firstId(content.mandates, "mandate") as NewGameConfig["mandateId"],
      },
      content,
    ),
    content,
  );
  const runtime = new BrowserGameRuntime(state, content, {
    scheduler: {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    },
  });
  const view = runtime.getView();
  return {
    ...view,
    models: {
      ...view.models,
      cards: view.models.cards.map((model) =>
        model.modelId === view.models.currentModelId
          ? {
              ...model,
              anomalies: [
                {
                  anomalyId: "anomaly:test",
                  sourceEvaluationId: "evaluation:test",
                  underlyingCase: "alignment" as const,
                  observationCount: 1,
                  createdAtTick: view.meta.tick,
                  observedSeverity: 80,
                  severityLabel: "Critical" as const,
                  status: "unresolved" as const,
                  investigationAttempts: 0,
                  actionQuote: {
                    cashCostMillions: 50,
                    auraCost: 36,
                    durationWeeks: 8,
                    majorProjectSlots: 1,
                    mitigationControlBonus: 5,
                    mitigationSecurityBonus: 5,
                  },
                },
              ],
            }
          : model,
      ),
    },
  };
}

describe("advisory board navigation", () => {
  it("routes the Open evaluations recommendation to the evaluations workspace", () => {
    const recommendation = buildAdvisoryRecommendations(viewWithAnomaly(), true).find(
      (item) => item.id === "investigate-anomalies",
    );

    expect(recommendation).toMatchObject({
      actionLabel: "Open evaluations",
      destination: "evaluations",
    });
  });
});
