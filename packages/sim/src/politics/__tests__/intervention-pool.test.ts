import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { collectMandatoryTriggers } from "../../events/event-engine.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState, GovernmentInterventionState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function stateWith(options: {
  readonly kind: GovernmentInterventionState["kind"];
  readonly trust: number;
  readonly attention: number;
  readonly incidents: number;
}): GameState {
  const draft = structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("0123456789abcdef0123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  if (lab === undefined || modelId === undefined) throw new Error("fixture missing");
  draft.run.tick = tick(30);
  lab.politics.governmentTrust = rating(options.trust);
  lab.politics.governmentAttention = rating(options.attention);
  lab.politics.interventions.push({
    id: "intervention:pool-fixture",
    kind: options.kind,
    trigger: "quarterly-pressure",
    createdAt: tick(30),
    quarterIndex: 2,
    pressureAtTrigger: rating(60),
    status: "pending-event",
  });
  for (let index = 0; index < options.incidents; index += 1) {
    draft.incidents.push({
      key: `pool-fixture-${String(index)}`,
      modelId,
      occurredAt: tick(28),
      observedSeverity: rating(70),
      category: "serious",
      contained: false,
      catastropheLegal: false,
      audit: [],
    });
  }
  return draft;
}

/** Every situation must select exactly one event, or the ladder stalls. */
describe("the government intervention event pool", () => {
  const cases = [
    {
      name: "clean, low-profile lab",
      kind: "reporting-request",
      trust: 60,
      attention: 40,
      incidents: 0,
    },
    {
      name: "lab with an incident on file",
      kind: "reporting-request",
      trust: 60,
      attention: 40,
      incidents: 2,
    },
    {
      name: "clean but highly watched lab",
      kind: "reporting-request",
      trust: 60,
      attention: 85,
      incidents: 0,
    },
    {
      name: "trusted lab facing licensing",
      kind: "licensing-action",
      trust: 60,
      attention: 70,
      incidents: 0,
    },
    {
      name: "distrusted lab facing licensing",
      kind: "licensing-action",
      trust: 10,
      attention: 70,
      incidents: 0,
    },
  ] as const;

  for (const testCase of cases) {
    it(`selects exactly one event for a ${testCase.name}`, () => {
      const state = stateWith(testCase);
      const triggers = collectMandatoryTriggers(state, content).filter((candidate) =>
        candidate.triggerKey.startsWith("government-intervention:"),
      );
      expect(triggers).toHaveLength(1);
    });
  }

  it("varies the event by circumstance within one intervention kind", () => {
    const chosen = cases
      .filter((testCase) => testCase.kind === "reporting-request")
      .map((testCase) => {
        const triggers = collectMandatoryTriggers(stateWith(testCase), content).filter(
          (candidate) => candidate.triggerKey.startsWith("government-intervention:"),
        );
        return triggers[0]?.definitionId;
      });
    expect(new Set(chosen).size).toBe(chosen.length);
  });
});
