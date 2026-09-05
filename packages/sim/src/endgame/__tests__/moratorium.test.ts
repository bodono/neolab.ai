import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelsForTest, createBareState } from "../../model/fixture.ts";
import type { EventInstanceId, LabId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import type { RandomKey } from "../../random/key.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import { projectMoratoriumForecastView } from "../../selectors/endgame-view.ts";
import {
  durableMoratoriumForecast,
  resolveDurableMoratoriumGate,
  sharedStandardsMoratoriumBonus,
} from "../moratorium.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

const fixedOracle: RandomOracle = {
  uniform(_key: RandomKey): number {
    return 0.5;
  },
  integer(_key, minimum): number {
    return minimum;
  },
  triangular(_key, _minimum, mode): number {
    return mode;
  },
  weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
    const first = Object.keys(weights)[0] as T | undefined;
    if (first === undefined) throw new Error("No weighted values");
    return first;
  },
  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  },
};

function stateWithAppeals(count: number): GameState {
  const state = structuredClone(createBareState()) as DeepMutable<GameState>;
  for (let index = 0; index < count; index += 1) {
    state.decisionMemories.push({
      key: "rival.candidate.standards-called",
      sourceEventInstanceId:
        `event-instance:standards:${String(index)}` as EventInstanceId,
      subjects: [{ type: "lab", labId: state.run.playerLabId }],
      valence: 0.4,
      tags: ["shared-standards", "long-pause-groundwork"],
      createdAt: state.run.tick,
    });
  }
  return state;
}

describe("durable moratorium groundwork", () => {
  it("adds six strength per public standards appeal and caps the advantage", () => {
    expect(sharedStandardsMoratoriumBonus(stateWithAppeals(0))).toBe(0);
    expect(sharedStandardsMoratoriumBonus(stateWithAppeals(1))).toBe(6);
    expect(sharedStandardsMoratoriumBonus(stateWithAppeals(3))).toBe(18);
    expect(sharedStandardsMoratoriumBonus(stateWithAppeals(8))).toBe(24);
  });

  it("ignores groundwork belonging to another lab", () => {
    const state = structuredClone(stateWithAppeals(1)) as DeepMutable<GameState>;
    const firstMemory = state.decisionMemories[0];
    if (firstMemory === undefined) throw new Error("Standards memory missing");
    firstMemory.subjects = [{ type: "entity", id: "lab:rival:standards" }];
    expect(sharedStandardsMoratoriumBonus(state)).toBe(0);
  });

  it("uses the same published forecast for the eventual gate", () => {
    const state = stateWithAppeals(2);
    const forecast = durableMoratoriumForecast(state, content, 70);
    const resolution = resolveDurableMoratoriumGate(state, content, fixedOracle, {
      modelId: "run:model:player:0000" as never,
      reviewerIndependence: 70,
      context: "post-retirement",
    });
    expect(resolution.strength).toBe(forecast.strength);
    expect(resolution.difficulty).toBe(forecast.difficulty);
    expect(resolution.probability).toBe(forecast.probability);
  });

  it("values programmes by diplomatic relevance rather than raw count", () => {
    const state = structuredClone(stateWithAppeals(0)) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    const baseline = durableMoratoriumForecast(state, content, 70);
    lab.politics.programmes = [
      "safety-standards-partnership",
      "public-sector-contract",
      "defence-applications",
      "national-champion",
    ];
    const supported = durableMoratoriumForecast(state, content, 70);
    expect(supported.strength).toBe(baseline.strength + 10);
    expect(
      supported.positiveFactors.find((factor) => factor.id === "government-programmes")
        ?.contribution,
    ).toBe(10);
  });

  it("makes a near-candidate rival materially harder to bind than an early programme", () => {
    const state = structuredClone(
      addBaselineModelsForTest(
        createNewGame(
          {
            seed: seed128("1234567890abcdef1234567890abcdef"),
            difficultyId: contentId("base:difficulty.standard"),
            leaderId: contentId("base:leader.thomas-hassabi"),
            mandateId: contentId("base:mandate.build-the-science"),
          },
          content,
        ),
        content,
      ),
    ) as DeepMutable<GameState>;
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rival = rivalId === undefined ? undefined : state.labs[rivalId];
    const modelId = rival?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (rivalId === undefined || rival === undefined || model === undefined) {
      throw new Error("Populated rival fixture missing");
    }
    for (const trait of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[trait] = rating(0);
    }
    for (const component of AGI_COMPONENT_TYPES) {
      delete rival.flags[agiComponentFlag(component)];
    }
    const early = durableMoratoriumForecast(state, content, 70);
    const earlyPressure = early.rivalPressure.find(
      (candidate) => candidate.labId === rivalId,
    )?.contribution;

    for (const trait of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[trait] = rating(100);
    }
    for (const component of AGI_COMPONENT_TYPES) {
      rival.flags[agiComponentFlag(component)] = true;
    }
    const nearCandidate = durableMoratoriumForecast(state, content, 70);
    const nearPressure = nearCandidate.rivalPressure.find(
      (candidate) => candidate.labId === rivalId,
    )?.contribution;
    expect(earlyPressure).toBe(0);
    expect(nearPressure).toBe(8);
    expect(nearCandidate.difficulty).toBeGreaterThan(early.difficulty);
    expect(nearCandidate.probability).toBeLessThan(early.probability);
  });

  it("does not expose hidden rival capability through the player forecast", () => {
    const state = structuredClone(
      addBaselineModelsForTest(
        createNewGame(
          {
            seed: seed128("abcdef1234567890abcdef1234567890"),
            difficultyId: contentId("base:difficulty.standard"),
            leaderId: contentId("base:leader.thomas-hassabi"),
            mandateId: contentId("base:mandate.build-the-science"),
          },
          content,
        ),
        content,
      ),
    ) as DeepMutable<GameState>;
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    const rival = rivalId === undefined ? undefined : state.labs[rivalId];
    const modelId = rival?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (rivalId === undefined || model === undefined) {
      throw new Error("Populated rival fixture missing");
    }
    const before = projectMoratoriumForecastView(state, content, 70, {
      [rivalId]: 50,
    });
    for (const trait of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[trait] = rating(100);
    }
    const after = projectMoratoriumForecastView(state, content, 70, {
      [rivalId]: 50,
    });
    expect(after).toEqual(before);
  });
});
