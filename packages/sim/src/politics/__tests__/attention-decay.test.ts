import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  attentionFloor,
  detectGovernmentCrisisTriggers,
  governmentAttentionTarget,
  updateGovernmentWeekly,
} from "../politics.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): DeepMutable<GameState> {
  return structuredClone(
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
}

function playerModel(state: DeepMutable<GameState>) {
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  return { lab, model };
}

function week(state: GameState): GameState {
  const tx = createTransaction(state);
  updateGovernmentWeekly(tx);
  return tx.commit({ description: "government week" }).state;
}

describe("government attention decay", () => {
  it("fades for a lab that genuinely retreats", () => {
    const state = newState();
    const { lab, model } = playerModel(state);
    // A loud past, a quiet present: nothing deployed, nothing impressive.
    lab.politics.governmentAttention = rating(80);
    model.deployment.exposure = 0;
    model.accessLevel = 0;
    if (model.measuredCapability !== undefined) {
      model.measuredCapability.frontierCapability = rating(10);
    }
    const target = governmentAttentionTarget(state, state.run.playerLabId);
    expect(target).toBeLessThan(80);

    let current: GameState = state;
    for (let index = 0; index < 26; index += 1) current = week(current);
    const after =
      current.labs[current.run.playerLabId]?.politics.governmentAttention ?? 0;
    expect(after).toBeLessThan(80);
    expect(after).toBeGreaterThanOrEqual(
      attentionFloor(current, current.run.playerLabId),
    );
  });

  it("decays slower than it climbs", () => {
    const climbing = newState();
    const climbLab = playerModel(climbing).lab;
    climbLab.politics.governmentAttention = rating(20);
    const climbModel = playerModel(climbing).model;
    if (climbModel.measuredCapability !== undefined) {
      climbModel.measuredCapability.frontierCapability = rating(90);
    }
    const climbed = week(climbing);
    const climbDelta =
      (climbed.labs[climbed.run.playerLabId]?.politics.governmentAttention ?? 0) - 20;

    const fading = newState();
    const fadeLab = playerModel(fading).lab;
    fadeLab.politics.governmentAttention = rating(90);
    const fadeModel = playerModel(fading).model;
    fadeModel.accessLevel = 0;
    if (fadeModel.measuredCapability !== undefined) {
      fadeModel.measuredCapability.frontierCapability = rating(20);
    }
    const faded = week(fading);
    const fadeDelta =
      90 - (faded.labs[faded.run.playerLabId]?.politics.governmentAttention ?? 0);

    expect(climbDelta).toBeGreaterThan(fadeDelta);
  });

  it("never fades below the floor earned by escaped weights", () => {
    const state = newState();
    const { lab, model } = playerModel(state);
    lab.politics.governmentAttention = rating(90);
    lab.autonomy.escapedWeightsAt = tick(1);
    lab.autonomy.escapeRevealedAt = tick(1);
    model.accessLevel = 0;
    if (model.measuredCapability !== undefined) {
      model.measuredCapability.frontierCapability = rating(5);
    }
    let current: GameState = state;
    for (let index = 0; index < 200; index += 1) current = week(current);
    const after =
      current.labs[current.run.playerLabId]?.politics.governmentAttention ?? 0;
    expect(after).toBeGreaterThanOrEqual(45);
  });

  it("reads deep autonomy as a visible signal", () => {
    const quiet = newState();
    const loud = newState();
    playerModel(loud).model.accessLevel = 5;
    expect(governmentAttentionTarget(loud, loud.run.playerLabId)).toBeGreaterThan(
      governmentAttentionTarget(quiet, quiet.run.playerLabId),
    );
  });

  it("opens an intervention on a quiet lab that granted lab-operator access", () => {
    const state = newState();
    const { lab, model } = playerModel(state);
    lab.politics.governmentAttention = rating(5);
    lab.politics.governmentTrust = rating(95);
    lab.politics.captureConcern = rating(0);
    model.accessLevel = 4;
    const candidates = detectGovernmentCrisisTriggers(state, state.run.playerLabId);
    expect(candidates[0]?.trigger).toBe("unsupervised-autonomy");
    expect(candidates[0]?.kind).toBe("reporting-request");
  });

  it("treats escaped weights as an emergency without bluffing about takeover", () => {
    const state = newState();
    const { lab } = playerModel(state);
    lab.politics.governmentAttention = rating(95);
    lab.politics.governmentTrust = rating(0);
    lab.autonomy.escapedWeightsAt = tick(4);
    lab.autonomy.escapeRevealedAt = tick(4);
    const candidates = detectGovernmentCrisisTriggers(state, state.run.playerLabId);
    expect(candidates[0]?.pressure.final).toBeLessThan(80);
    expect(candidates[0]?.trigger).toBe("escaped-weights");
    expect(candidates[0]?.kind).toBe("deployment-restriction");
  });

  it("does not reveal an undetected weight escape through government behaviour", () => {
    const state = newState();
    const { lab } = playerModel(state);
    lab.politics.governmentAttention = rating(95);
    lab.politics.governmentTrust = rating(0);
    lab.autonomy.escapedWeightsAt = state.run.tick;

    const hidden = detectGovernmentCrisisTriggers(state, state.run.playerLabId);
    expect(hidden[0]?.trigger).not.toBe("escaped-weights");

    state.run.tick = tick(state.run.tick + 6);
    const revealed = detectGovernmentCrisisTriggers(state, state.run.playerLabId);
    expect(revealed[0]?.trigger).toBe("escaped-weights");
  });
});
