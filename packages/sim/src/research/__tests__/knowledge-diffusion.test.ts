import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { ModifierId, ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { calculateKnowledgeDiffusion } from "../research.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const ARCHITECTURES = "base:domain.architectures";

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

/** Set the campus-unlocked diffusion rate directly, as a building would. */
function setRate(state: DeepMutable<GameState>, rate: number): void {
  const id = "modifier:diffusion-fixture" as ModifierId;
  state.modifiers[id] = {
    id,
    source: { kind: "system", id: "diffusion-fixture" },
    labId: state.run.playerLabId,
    target: "lab.research.diffusionRate",
    operation: "add",
    value: rate,
    startsAt: tick(0),
    tags: [],
  };
}

/** Seat two researchers with real Architectures skill on the player roster. */
function withRoster(state: DeepMutable<GameState>): DeepMutable<GameState> {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  const seated = Object.values(state.researchers)
    .filter((researcher) => {
      const definition = content.researchers.definitions[researcher.definitionId];
      return (definition?.skills["architectures"] ?? 0) > 0;
    })
    .slice(0, 2);
  for (const researcher of seated) {
    researcher.employerLabId = state.run.playerLabId;
    researcher.employedAt = state.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    lab.roster.researcherIds.push(researcher.id);
  }
  if (lab.roster.researcherIds.length === 0) throw new Error("no seatable researchers");
  return state;
}

function diffusion(state: GameState, programId = ARCHITECTURES) {
  return calculateKnowledgeDiffusion(state, content, state.run.playerLabId, programId);
}

describe("knowledge diffusion", () => {
  it("is exactly zero before the campus unlocks it", () => {
    const result = diffusion(newState());
    expect(result.ratePerSkillPoint).toBe(0);
    expect(result.percentagePoints).toBe(0);
    expect(result.contributors).toHaveLength(0);
  });

  it("pays every employed researcher's skill in that programme's domain", () => {
    const state = withRoster(newState());
    setRate(state, 1);
    const result = diffusion(state);
    expect(result.ratePerSkillPoint).toBe(1);
    // Each contributor pays exactly skill x rate, and nobody with zero skill
    // in the domain is listed at all.
    for (const contributor of result.contributors) {
      expect(contributor.skill).toBeGreaterThan(0);
      expect(contributor.percentagePoints).toBeCloseTo(contributor.skill * 1, 10);
    }
    expect(result.percentagePoints).toBeCloseTo(
      result.contributors.reduce((sum, c) => sum + c.skill, 0),
      10,
    );
  });

  it("scales linearly with the rate the campus has unlocked", () => {
    const half = withRoster(newState());
    setRate(half, 1);
    const full = withRoster(newState());
    setRate(full, 2);
    expect(diffusion(full).percentagePoints).toBeCloseTo(
      diffusion(half).percentagePoints * 2,
      10,
    );
  });

  it("excludes the programme's own lead, who is already paid the lead bonus", () => {
    const state = withRoster(newState());
    setRate(state, 1);
    const before = diffusion(state);
    const roster = state.labs[state.run.playerLabId]?.roster.researcherIds ?? [];
    const contributor = before.contributors[0];
    if (contributor === undefined) throw new Error("fixture has no contributors");
    expect(roster).toContain(contributor.researcherId);

    const researcher = state.researchers[contributor.researcherId as ResearcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.assignment = {
      kind: "capability-program",
      targetId: ARCHITECTURES,
      role: "lead",
      assignedAt: tick(0),
    };
    const after = diffusion(state);
    expect(after.contributors.map((c) => c.researcherId)).not.toContain(
      contributor.researcherId,
    );
    expect(after.percentagePoints).toBeCloseTo(
      before.percentagePoints - contributor.percentagePoints,
      10,
    );
  });

  it("still pays that lead into every other programme", () => {
    const state = withRoster(newState());
    setRate(state, 1);
    const contributor = diffusion(state).contributors[0];
    if (contributor === undefined) throw new Error("fixture has no contributors");
    const researcher = state.researchers[contributor.researcherId as ResearcherId];
    if (researcher === undefined) throw new Error("researcher missing");
    researcher.assignment = {
      kind: "capability-program",
      targetId: ARCHITECTURES,
      role: "lead",
      assignedAt: tick(0),
    };
    const elsewhere = diffusion(state, "base:domain.reasoning-tools");
    expect(elsewhere.contributors.map((c) => c.researcherId)).toContain(
      contributor.researcherId,
    );
  });
});

describe("the campus diffusion ladder", () => {
  it("runs from zero to exactly 2.0 per ability point over six buildings", () => {
    const steps = Object.values(content.facilities).flatMap((facility) =>
      (facility.modifiers ?? [])
        .filter((modifier) => modifier.target === "lab.research.diffusionRate")
        .map((modifier) => ({
          facility: facility.displayName,
          tier: facility.tier,
          value: modifier.value,
        })),
    );
    expect(steps).toHaveLength(6);
    expect(steps.reduce((sum, step) => sum + step.value, 0)).toBeCloseTo(2, 10);
    // The last increments are the large ones, so the ceiling is late-game.
    const byTier = [...steps].sort((left, right) => left.tier - right.tier);
    expect(byTier[0]?.value).toBe(0.25);
    expect(byTier.at(-1)?.value).toBe(0.6);
  });

  it("keeps the capstone behind the rest of the ladder", () => {
    const capstone = content.facilities["base:facility.shared-kv-cache"];
    expect(capstone).toBeDefined();
    // Tier 4 so the Mirror Test can open in the Rubin era; the atrium
    // prerequisite is what actually keeps it last on the ladder.
    expect(capstone?.tier).toBe(4);
    expect(capstone?.prerequisiteFacilityIds).toContain(
      "base:facility.cross-attention-atrium",
    );
  });
});
