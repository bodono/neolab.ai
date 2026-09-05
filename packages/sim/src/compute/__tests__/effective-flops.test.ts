import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { ModifierId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import { quoteTrainingRun } from "../../training/training.ts";
import {
  THROUGHPUT_TARGET,
  effectiveTeraflopsPerGpu,
  fleetThroughputMultiplier,
  fleetTeraflops,
  generationTeraflopsPerGpu,
} from "../flops.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): DeepMutable<GameState> {
  return structuredClone(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
}

function addThroughput(
  state: DeepMutable<GameState>,
  value: number,
  kind: "facility" | "researcher" = "facility",
): void {
  const id = `modifier:throughput-${kind}` as ModifierId;
  state.modifiers[id] = {
    id,
    source: { kind, id: `${kind}-fixture` },
    labId: state.run.playerLabId,
    target: THROUGHPUT_TARGET,
    operation: "multiply",
    value,
    startsAt: tick(0),
    tags: [],
  };
}

describe("effective FLOPS", () => {
  it("is the bare hardware spec when nothing improves the fleet", () => {
    const state = newState();
    expect(fleetThroughputMultiplier(state, state.run.playerLabId)).toBe(1);
    const kepler = content.gpuGenerations["base:gpu.kepler"];
    if (kepler === undefined) throw new Error("Kepler missing");
    expect(effectiveTeraflopsPerGpu(state, state.run.playerLabId, kepler)).toBe(
      generationTeraflopsPerGpu(kepler),
    );
  });

  it("reports the fleet FLOPS the simulation actually uses, not the spec sheet", () => {
    // The whole point of folding throughput into the per-GPU rating: the
    // overview used to show bare hardware ratings while training ran on a
    // modified number, so the headline figure and the compute a run received
    // silently disagreed.
    const bare = newState();
    const boosted = newState();
    addThroughput(boosted, 1.25);

    const specTeraflops = fleetTeraflops(bare, content, bare.run.playerLabId);
    expect(specTeraflops).toBeGreaterThan(0);
    expect(fleetTeraflops(boosted, content, boosted.run.playerLabId)).toBeCloseTo(
      specTeraflops * 1.25,
      6,
    );
  });

  it("counts a researcher and a facility once each, multiplicatively", () => {
    const state = newState();
    addThroughput(state, 1.2, "facility");
    addThroughput(state, 1.1, "researcher");
    expect(fleetThroughputMultiplier(state, state.run.playerLabId)).toBeCloseTo(
      1.2 * 1.1,
      10,
    );
  });

  it("quotes training commitments against effective rather than bare fleet FLOP/s", () => {
    const state = newState();
    addThroughput(state, 1.25);
    const effectiveFleet = fleetTeraflops(state, content, state.run.playerLabId);
    const physicalFleet = state.labs[state.run.playerLabId]?.compute.lots.reduce(
      (sum, lot) => sum + lot.physicalCount,
      0,
    );
    if (physicalFleet === undefined) throw new Error("player lab missing");

    const quote = quoteTrainingRun(state, content, {
      labId: state.run.playerLabId,
      posture: "normal",
      committedTeraflops: effectiveFleet,
      durationWeeks: 8,
    });

    expect(quote.blockers).toEqual([]);
    expect(quote.availableTeraflops).toBeCloseTo(effectiveFleet, 6);
    expect(quote.committedTeraflops).toBeCloseTo(effectiveFleet, 6);
    expect(quote.reservedPhysicalGpus).toBe(physicalFleet);

    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(view.compute.ratedTeraflops * view.compute.throughputMultiplier).toBeCloseTo(
      view.compute.totalTeraflops,
      6,
    );
    expect(view.compute.throughputMultiplier).toBeCloseTo(1.25, 6);
    expect(view.compute.throughputEffects).toEqual([
      expect.objectContaining({
        sourceKind: "facility",
        effectLabel: "×1.25 (+25%)",
      }),
    ]);
  });

  it("stacks researcher throughput bonuses in full", () => {
    const state = newState();
    addThroughput(state, 10, "researcher");
    expect(fleetThroughputMultiplier(state, state.run.playerLabId)).toBeCloseTo(10, 10);
  });

  it("keeps the hardware spec lab-independent", () => {
    // Spec sheets in the procurement and generation dialogs must keep showing
    // what the silicon does, not what one lab gets out of it.
    const state = newState();
    addThroughput(state, 2);
    const kepler = content.gpuGenerations["base:gpu.kepler"];
    if (kepler === undefined) throw new Error("Kepler missing");
    expect(generationTeraflopsPerGpu(kepler)).toBe(4);
    expect(effectiveTeraflopsPerGpu(state, state.run.playerLabId, kepler)).toBe(8);
  });

  it("does not leak one lab's modifiers into another lab's fleet", () => {
    // resolveModifierValue defaults labId to the PLAYER lab, so every call site
    // that omitted it was resolving player modifiers for rivals too.
    const state = newState();
    const rivalId = Object.keys(state.labs).find((id) => id !== state.run.playerLabId);
    if (rivalId === undefined) throw new Error("no rival lab");
    const id = "modifier:player-only" as ModifierId;
    state.modifiers[id] = {
      id,
      source: { kind: "facility", id: "player-facility" },
      target: THROUGHPUT_TARGET,
      operation: "multiply",
      value: 1.5,
      startsAt: tick(0),
      labId: state.run.playerLabId,
      tags: [],
    };
    expect(fleetThroughputMultiplier(state, state.run.playerLabId)).toBeCloseTo(1.5, 10);
    expect(
      fleetThroughputMultiplier(state, rivalId as typeof state.run.playerLabId),
    ).toBe(1);
  });
});
