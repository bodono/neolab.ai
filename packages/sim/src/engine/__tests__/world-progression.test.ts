import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import type { DeepMutable } from "../draft.ts";
import { createTransaction } from "../transaction.ts";
import { createNewGame } from "../create-new-game.ts";
import type { LabId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import {
  advanceWorldGpuGeneration,
  advanceWorldPhase,
  advanceWorldPhaseAfterHardware,
  FRONTIER_PHASE_FRONTIER_CAPABILITY,
  frontierLeadShare,
} from "../world-progression.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
}

function withWorldCapability(state: GameState, value: number): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const rivalId = Object.keys(draft.world.rivals).sort()[0] as LabId | undefined;
  const modelId =
    rivalId === undefined ? undefined : draft.labs[rivalId]?.models.modelIds[0];
  const model = modelId === undefined ? undefined : draft.models[modelId];
  if (model === undefined) throw new Error("rival model fixture missing");
  for (const key of Object.keys(
    model.trueCapability,
  ) as (keyof typeof model.trueCapability)[]) {
    model.trueCapability[key] = rating(value);
  }
  return draft;
}

function withEveryModelCapability(state: GameState, value: number): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  for (const model of Object.values(draft.models)) {
    for (const key of Object.keys(
      model.trueCapability,
    ) as (keyof typeof model.trueCapability)[]) {
      model.trueCapability[key] = rating(value);
    }
  }
  return draft;
}

function withLabCapability(state: GameState, labId: LabId, value: number): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const modelId = draft.labs[labId]?.models.modelIds[0];
  const model = modelId === undefined ? undefined : draft.models[modelId];
  if (model === undefined) throw new Error(`model fixture missing for ${labId}`);
  for (const key of Object.keys(
    model.trueCapability,
  ) as (keyof typeof model.trueCapability)[]) {
    model.trueCapability[key] = rating(value);
  }
  return draft;
}

describe("world progression", () => {
  it("enters the frontier phase at world FC 60", () => {
    expect(FRONTIER_PHASE_FRONTIER_CAPABILITY).toBe(60);
  });

  it("spaces GPU generations across the capability race", () => {
    const ladder = Object.values(content.gpuGenerations)
      .sort((left, right) => left.nominalYear - right.nominalYear)
      .map((generation) => [
        generation.displayName,
        generation.unlockAtWorldFrontierCapability,
      ]);

    expect(ladder).toEqual([
      ["Kepler", 0],
      ["Maxwell", 8],
      ["Pascal", 18],
      ["Volta", 28],
      ["Turing", 38],
      ["Ampere", 48],
      ["Hopper", 58],
      ["Blackwell", 68],
      ["Rubin", 78],
      ["Markov", 86],
      ["Kolmogorov", 94],
    ]);
  });

  it("advances one capability-driven phase per week and never regresses", () => {
    const highCapability = withWorldCapability(newState(), 70);
    const scalingTx = createTransaction(highCapability);
    advanceWorldPhase(scalingTx);
    const scaling = scalingTx.commit({ description: "scaling" });
    expect(scaling.state.run.phase).toBe("scaling");
    expect(scaling.domainEvents).toContainEqual({
      kind: "world-phase-changed",
      previousPhase: "foundation",
      phase: "scaling",
      frontierCapability: 70,
    });

    expect(scaling.state.run.autoPauseReasons).toContain("world-phase");
    expect(
      projectGameView(scaling.state, content, {
        viewerLabId: scaling.state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).meta.phaseChangedAtTick,
    ).toBe(scaling.state.run.tick);

    const frontierTx = createTransaction(scaling.state);
    advanceWorldPhase(frontierTx);
    const frontier = frontierTx.commit({ description: "frontier" });
    expect(frontier.state.run.phase).toBe("frontier");

    const weakened = withWorldCapability(frontier.state, 5) as DeepMutable<GameState>;
    const noRegressionTx = createTransaction(weakened);
    advanceWorldPhase(noRegressionTx);
    expect(noRegressionTx.commit({ description: "no regression" }).state.run.phase).toBe(
      "frontier",
    );
  });

  it("unlocks GPU generations from world capability, one step per week", () => {
    const opening = newState();
    const openingLots = structuredClone(
      opening.labs[opening.run.playerLabId]?.compute.lots ?? [],
    );
    // Below Maxwell's threshold nothing unlocks.
    const idleTx = createTransaction(withEveryModelCapability(opening, 5));
    advanceWorldGpuGeneration(idleTx, content);
    expect(
      idleTx.commit({ description: "idle" }).state.world.currentGpuGenerationId,
    ).toBe("base:gpu.kepler");

    // A capability spike unlocks exactly one generation per week — no era
    // skipping — and announces it with an auto-pause.
    const spiked = withWorldCapability(opening, 40);
    const tx = createTransaction(spiked);
    advanceWorldGpuGeneration(tx, content);
    const result = tx.commit({ description: "hardware era" });
    expect(result.state.world.currentGpuGenerationId).toBe("base:gpu.maxwell");
    expect(result.state.run.autoPauseReasons).toContain("gpu-generation");
    expect(result.state.labs[result.state.run.playerLabId]?.compute.lots).toEqual(
      openingLots,
    );
    expect(result.domainEvents).toContainEqual({
      kind: "gpu-generation-unlocked",
      generationId: "base:gpu.maxwell",
      nominalYear: 2014,
    });

    const nextTx = createTransaction(result.state);
    advanceWorldGpuGeneration(nextTx, content);
    expect(
      nextTx.commit({ description: "second step" }).state.world.currentGpuGenerationId,
    ).toBe("base:gpu.pascal");
  });

  it("separates a Hopper unlock from the frontier phase", () => {
    const draft = structuredClone(
      withWorldCapability(newState(), 60),
    ) as DeepMutable<GameState>;
    draft.run.phase = "scaling";
    draft.world.currentGpuGenerationId = contentId("base:gpu.ampere");

    const hardwareTx = createTransaction(draft);
    advanceWorldPhaseAfterHardware(hardwareTx, content);
    advanceWorldGpuGeneration(hardwareTx, content);
    const hardware = hardwareTx.commit({ description: "Hopper first" });
    expect(hardware.state.world.currentGpuGenerationId).toBe("base:gpu.hopper");
    expect(hardware.state.run.phase).toBe("scaling");
    expect(hardware.state.run.autoPauseReasons).toContain("gpu-generation");

    const phaseTx = createTransaction(hardware.state);
    advanceWorldPhaseAfterHardware(phaseTx, content);
    advanceWorldGpuGeneration(phaseTx, content);
    const phase = phaseTx.commit({ description: "frontier second" });
    expect(phase.state.world.currentGpuGenerationId).toBe("base:gpu.hopper");
    expect(phase.state.run.phase).toBe("frontier");
    expect(phase.state.run.autoPauseReasons).toContain("world-phase");
  });

  // The world's handle on "who is out in front". It never asks who the player
  // is, so the same lead reads the same whether a rival or the player holds it.
  it("scores the frontier lead the same way for every lab", () => {
    const base = newState();
    const labIds = Object.keys(base.labs).sort() as LabId[];
    const [first, second] = labIds;
    if (first === undefined || second === undefined) {
      throw new Error("lead fixture missing");
    }
    const level = labIds.reduce(
      (state, labId) => withLabCapability(state, labId, 40),
      base,
    );
    for (const labId of labIds) expect(frontierLeadShare(level, labId)).toBe(0);

    // Ten points clear of a twenty-point runaway is half a lead; the field
    // behind it scores zero however far back it falls.
    const halfClear = withLabCapability(level, first, 50);
    expect(frontierLeadShare(halfClear, first)).toBeCloseTo(0.5);
    expect(frontierLeadShare(halfClear, second)).toBe(0);

    // A runaway saturates at one, and hands the identical score to whichever
    // lab holds it.
    const runaway = withLabCapability(level, first, 90);
    expect(frontierLeadShare(runaway, first)).toBe(1);
    const mirrored = withLabCapability(level, second, 90);
    expect(frontierLeadShare(mirrored, second)).toBe(1);
    expect(frontierLeadShare(mirrored, first)).toBe(0);
  });
});
