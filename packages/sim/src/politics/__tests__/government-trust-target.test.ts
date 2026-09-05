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
import type { ModifierId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  SAFETY_CULTURE_FLOOR_BASE,
  SAFETY_CULTURE_FLOOR_MODIFIER,
  updateOrganisationRatings,
} from "../../researchers/people.ts";
import { GOVERNMENT_TRUST_FLOOR_MODIFIER, updateGovernmentWeekly } from "../politics.ts";

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

/** Stand in for a researcher passive that raises the standing trust floor. */
function setTrustTarget(state: DeepMutable<GameState>, add: number): void {
  const id = "modifier:trust-target-fixture" as ModifierId;
  state.modifiers[id] = {
    id,
    source: { kind: "researcher", id: "trust-target-fixture" },
    labId: state.run.playerLabId,
    target: GOVERNMENT_TRUST_FLOOR_MODIFIER,
    operation: "add",
    value: add,
    startsAt: tick(0),
    tags: [],
  };
}

function trustAfterWeeks(state: DeepMutable<GameState>, weeks: number): number {
  let current: GameState = state;
  for (let index = 0; index < weeks; index += 1) {
    const tx = createTransaction(current);
    updateGovernmentWeekly(tx);
    current = tx.commit({ description: "week" }).state;
  }
  const lab = current.labs[current.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  return Number(lab.politics.governmentTrust);
}

describe("the standing government-trust floor", () => {
  it("leaves trust alone when nothing raises the floor", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    const before = Number(lab.politics.governmentTrust);
    expect(trustAfterWeeks(state, 5)).toBe(before);
  });

  it("pulls trust up to the floor and then stops", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.politics.governmentTrust = rating(50);
    setTrustTarget(state, 4);

    // A whole point a week while the gap is open, then it settles exactly on
    // the floor rather than climbing past it.
    expect(trustAfterWeeks(structuredClone(state), 1)).toBe(51);
    expect(trustAfterWeeks(structuredClone(state), 4)).toBe(54);
    expect(trustAfterWeeks(structuredClone(state), 12)).toBe(54);
  });

  it("never drags down a lab that has earned better standing than the floor", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.politics.governmentTrust = rating(80);
    setTrustTarget(state, 4);
    expect(trustAfterWeeks(state, 20)).toBe(80);
  });

  it("is what the policy researchers' passives now aim at", () => {
    // The nine that used to point at one-time .starting grants, which did
    // nothing at all for anyone hired after week zero.
    const trustEffects = Object.values(content.researchers.definitions).flatMap(
      (definition) =>
        [definition.signature, definition.passive]
          .flatMap((ability) => ability?.effects ?? [])
          .filter((effect) => effect.target === GOVERNMENT_TRUST_FLOOR_MODIFIER),
    );
    // 8 since Shane Legge's passive moved here from a duplicated evidence effect.
    expect(trustEffects).toHaveLength(8);
    // No zero-value promises: every one of them has to move the needle.
    for (const effect of trustEffects) {
      expect(Math.abs(effect.value)).toBeGreaterThan(0);
    }
  });

  it("leaves no one-time .starting grant behind on a researcher", () => {
    const stale = Object.values(content.researchers.definitions).flatMap((definition) =>
      [definition.signature, definition.passive]
        .flatMap((ability) => ability?.effects ?? [])
        .filter((effect) => effect.target.endsWith(".starting"))
        .map((effect) => `${definition.displayName}: ${effect.target}`),
    );
    expect(stale).toEqual([]);
  });
});

describe("the standing safety-culture floor", () => {
  function cultureAfterWeeks(state: DeepMutable<GameState>, weeks: number): number {
    let current: GameState = state;
    for (let index = 0; index < weeks; index += 1) {
      const tx = createTransaction(current);
      updateOrganisationRatings(tx);
      current = tx.commit({ description: "week" }).state;
    }
    const lab = current.labs[current.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    return Number(lab.safety.safetyCulture);
  }

  function setCultureFloor(state: DeepMutable<GameState>, add: number): void {
    const id = "modifier:culture-floor-fixture" as ModifierId;
    state.modifiers[id] = {
      id,
      source: { kind: "researcher", id: "culture-floor-fixture" },
      labId: state.run.playerLabId,
      target: SAFETY_CULTURE_FLOOR_MODIFIER,
      operation: "add",
      value: add,
      startsAt: tick(0),
      tags: [],
    };
  }

  it("lifts a weak culture to the floor and holds it there", () => {
    const state = newState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.safety.safetyCulture = rating(40);
    setCultureFloor(state, 4);
    expect(cultureAfterWeeks(structuredClone(state), 30)).toBe(54);
  });

  it("does not disturb a lab whose culture already beats the floor", () => {
    // The equilibrium drift already pulls a high culture back toward its
    // natural target; the floor must neither add to that fall nor arrest it,
    // so the run with a floor has to match the run without one exactly.
    const bare = newState();
    const withFloor = newState();
    for (const state of [bare, withFloor]) {
      const lab = state.labs[state.run.playerLabId];
      if (lab === undefined) throw new Error("player lab missing");
      lab.safety.safetyCulture = rating(85);
    }
    setCultureFloor(withFloor, 4);
    const settled = cultureAfterWeeks(bare, 30);
    expect(settled).toBeGreaterThan(SAFETY_CULTURE_FLOOR_BASE + 4);
    expect(cultureAfterWeeks(withFloor, 30)).toBe(settled);
  });

  it("is what the two safety-culture passives now aim at", () => {
    const effects = Object.values(content.researchers.definitions).flatMap((definition) =>
      [definition.signature, definition.passive]
        .flatMap((ability) => ability?.effects ?? [])
        .filter((effect) => effect.target === SAFETY_CULTURE_FLOOR_MODIFIER),
    );
    expect(effects).toHaveLength(2);
    for (const effect of effects) expect(Math.abs(effect.value)).toBeGreaterThan(0);
  });
});
