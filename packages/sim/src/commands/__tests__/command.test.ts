import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId, LabId } from "../../model/ids.ts";
import type { GameState, GpuAllocationState } from "../../model/state.ts";
import { basisPoints, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { applyCommand, CommandRejectedError } from "../apply.ts";
import type { SetGpuAllocationCommand } from "../types.ts";
import { validateCommand } from "../validate.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.sam-altmann"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function goodAllocation(): GpuAllocationState {
  return {
    servingBasisPoints: basisPoints(6000),
    capabilityBasisPoints: basisPoints(8000),
    capabilityDomainWeights: {
      "base:domain.architectures": basisPoints(5000),
      "base:domain.optimisation-scaling": basisPoints(2000),
      "base:domain.data-representation": basisPoints(3000),
    },
    safetyProgramWeights: {
      "base:safety.alignment-control": basisPoints(5000),
      "base:safety.interpretability-evals": basisPoints(4000),
      "base:safety.security-containment": basisPoints(1000),
    },
  };
}

function command(
  state: GameState,
  overrides: Partial<SetGpuAllocationCommand> = {},
): SetGpuAllocationCommand {
  return {
    kind: "set-gpu-allocation",
    meta: {
      commandId: "cmd-0001" as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    allocation: goodAllocation(),
    ...overrides,
  };
}

describe("validateCommand", () => {
  it("accepts a valid allocation with a next-tick preview", () => {
    const state = newState();
    const validation = validateCommand(state, content, command(state));
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.takesEffectAtTick).toBe(state.run.tick + 1);
    }
  });

  it("rejects stale commands issued for a different tick", () => {
    const state = newState();
    const stale = command(state);
    const validation = validateCommand(state, content, {
      ...stale,
      meta: { ...stale.meta, expectedTick: tick(5) },
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.map((error) => error.code)).toContain("stale-command");
    }
  });

  it("rejects allocations whose weights do not sum to 10000", () => {
    const state = newState();
    const bad = command(state, {
      allocation: {
        ...goodAllocation(),
        capabilityDomainWeights: {
          "base:domain.architectures": basisPoints(5000),
          "base:domain.optimisation-scaling": basisPoints(2000),
          "base:domain.data-representation": basisPoints(2000),
        },
      },
    });
    const validation = validateCommand(state, content, bad);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.map((error) => error.code)).toContain("allocation-sum");
    }
  });

  it("rejects allocations referencing locked domains", () => {
    const state = newState();
    const bad = command(state, {
      allocation: {
        ...goodAllocation(),
        capabilityDomainWeights: {
          "base:domain.architectures": basisPoints(5000),
          "base:domain.robotics-embodiment": basisPoints(5000),
        },
      },
    });
    const validation = validateCommand(state, content, bad);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.map((error) => error.code)).toContain("unknown-domain");
    }
  });

  it("rejects commands for unknown or rival labs", () => {
    const state = newState();
    const validation = validateCommand(
      state,
      content,
      command(state, { labId: "lab:rival-1" as LabId }),
    );
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.map((error) => error.code)).toContain("unknown-lab");
    }
  });
});

describe("applyCommand", () => {
  it("queues the order, emits a domain event, and leaves the input untouched", () => {
    const state = newState();
    const snapshot = JSON.stringify(state);
    const result = applyCommand(state, content, command(state));

    expect(JSON.stringify(state)).toBe(snapshot);
    expect(result.state).not.toBe(state);
    expect(result.state.run.queuedOrders).toHaveLength(1);
    expect(result.state.run.queuedOrders[0]?.kind).toBe("set-gpu-allocation");
    expect(result.domainEvents).toEqual([
      { kind: "order-queued", labId: state.run.playerLabId, order: "set-gpu-allocation" },
    ]);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.run)).toBe(true);
  });

  it("replaces an earlier queued allocation for the same lab (last order wins)", () => {
    const state = newState();
    const first = applyCommand(state, content, command(state));
    const second = applyCommand(
      first.state,
      content,
      command(first.state, {
        allocation: { ...goodAllocation(), servingBasisPoints: basisPoints(2500) },
      }),
    );
    expect(second.state.run.queuedOrders).toHaveLength(1);
    expect(second.state.run.queuedOrders[0]?.allocation.servingBasisPoints).toBe(2500);
  });

  it("throws CommandRejectedError on invalid commands without touching state", () => {
    const state = newState();
    const snapshot = JSON.stringify(state);
    const stale = command(state);
    expect(() =>
      applyCommand(state, content, {
        ...stale,
        meta: { ...stale.meta, expectedTick: tick(99) },
      }),
    ).toThrow(CommandRejectedError);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("SimulationTransaction", () => {
  it("a throwing updater leaves the input state untouched", () => {
    const state = newState();
    const snapshot = JSON.stringify(state);
    const tx = createTransaction(state);
    expect(() => {
      tx.update((draft) => {
        draft.labs[state.run.playerLabId] = undefined as never;
        throw new Error("mid-transition failure");
      });
    }).toThrow("mid-transition failure");
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("cannot be used after commit", () => {
    const tx = createTransaction(newState());
    tx.commit({ description: "test" });
    expect(() => {
      tx.update(() => undefined);
    }).toThrow(/after commit/);
    expect(() => tx.commit({ description: "again" })).toThrow(/after commit/);
  });

  it("allocateId increments the namespace counter and formats deterministically", () => {
    const state = newState();
    const tx = createTransaction(state);
    expect(tx.allocateId("project", "player")).toBe("run:project:player:0000");
    expect(tx.allocateId("project", "player")).toBe("run:project:player:0001");
    expect(tx.allocateId("event", "world")).toBe("run:event:world:0000");
    const result = tx.commit({ description: "ids" });
    expect(result.state.run.idCounters.project).toBe(2);
    expect(result.state.run.idCounters.event).toBe(1);
  });

  it("commit rejects invariant-violating drafts", () => {
    const state = newState();
    const tx = createTransaction(state);
    tx.update((draft) => {
      const lab = draft.labs[state.run.playerLabId];
      if (lab === undefined) throw new Error("missing lab");
      lab.compute.allocation.capabilityDomainWeights["base:domain.architectures"] =
        basisPoints(1);
    });
    expect(() => tx.commit({ description: "broken" })).toThrow(/allocation-sum/);
  });
});
