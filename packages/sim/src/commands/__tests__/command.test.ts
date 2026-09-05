import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId, LabId } from "../../model/ids.ts";
import type { GameState, GpuAllocationState } from "../../model/state.ts";
import { basisPoints, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { applyCommand, CommandRejectedError } from "../apply.ts";
import type { GameCommand, SetGpuAllocationCommand } from "../types.ts";
import { validateCommand } from "../validate.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelForTest(
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

function goodAllocation(): GpuAllocationState {
  return {
    servingFleetShareBasisPoints: basisPoints(0),
    capabilityBasisPoints: basisPoints(8000),
    capabilityDomainWeights: {
      "base:domain.architectures": basisPoints(8000),
      "base:domain.optimisation-scaling": basisPoints(2000),
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
      expect(validation.preview.gpuAllocationPlan).toMatchObject({
        totalPhysicalGpus: 2_000,
        servingPhysicalGpus: 0,
        researchPhysicalGpus: 2_000,
      });
      const consequences = validation.preview.gpuAllocationConsequences;
      expect(consequences).toBeDefined();
      expect(Number.isFinite(consequences?.netMillionsPerCycle)).toBe(true);
      expect(Number.isFinite(consequences?.deliveredTeraflops)).toBe(true);
      expect(Number.isFinite(consequences?.projectedRevenueMillionsPerCycle)).toBe(true);
      expect(Number.isFinite(consequences?.projectedServingAuraPerCycle)).toBe(true);
      expect(Number.isFinite(consequences?.projectedServingFulfilment)).toBe(true);
      expect(consequences?.segments).toHaveLength(
        Object.keys(content.market.segments).length,
      );
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
        },
      },
    });
    const validation = validateCommand(state, content, bad);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.map((error) => error.code)).toContain("allocation-sum");
    }
  });

  it("rejects allocations referencing unknown domains", () => {
    const state = newState();
    const bad = command(state, {
      allocation: {
        ...goodAllocation(),
        capabilityDomainWeights: {
          "base:domain.architectures": basisPoints(5000),
          "base:domain.quantum-cats": basisPoints(5000),
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

  it("rejects a retired hot-reloaded command without crashing validation", () => {
    const state = newState();
    const retiredCommand = {
      kind: "set-facility-enabled",
      meta: {
        commandId: "cmd-retired-facility-toggle" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      facilityId: "run:facility:player:0001",
      enabled: true,
    } as unknown as GameCommand;

    expect(validateCommand(state, content, retiredCommand)).toEqual({
      ok: false,
      errors: [
        {
          code: "unsupported-command",
          message:
            'Command "set-facility-enabled" is no longer supported; refresh the page to load the current controls',
        },
      ],
    });
  });

  it.each([
    "choose-crisis-confirmation",
    "choose-containment-posture",
    "start-crisis-project",
    "commit-evidence-sprint",
  ])("rejects the removed v1 endgame command %s", (kind) => {
    const state = newState();
    const retiredCommand = {
      kind,
      meta: {
        commandId: `cmd-retired-${kind}` as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
    } as unknown as GameCommand;

    const validation = validateCommand(state, content, retiredCommand);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors).toEqual([
        {
          code: "unsupported-command",
          message: `Command "${kind}" is no longer supported; refresh the page to load the current controls`,
        },
      ]);
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
        allocation: { ...goodAllocation(), capabilityBasisPoints: basisPoints(7000) },
      }),
    );
    expect(second.state.run.queuedOrders).toHaveLength(1);
    const queued = second.state.run.queuedOrders[0];
    expect(queued?.kind).toBe("set-gpu-allocation");
    expect(
      queued?.kind === "set-gpu-allocation"
        ? queued.allocation.capabilityBasisPoints
        : undefined,
    ).toBe(7000);
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
