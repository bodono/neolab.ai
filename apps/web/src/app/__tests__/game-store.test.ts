import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import { seed128, type NewGameConfig } from "@neolab/sim/public";

import { BrowserGameRuntime } from "../../runtime/index.ts";
import { createRuntimeStoreBridge } from "../game-store.ts";

const content = loadCompiledContent();

function config(): NewGameConfig {
  return {
    seed: seed128("fedcba9876543210fedcba9876543210"),
    difficultyId: "base:difficulty.standard" as NewGameConfig["difficultyId"],
    leaderId: "base:leader.sam-altmann" as NewGameConfig["leaderId"],
    mandateId: "base:mandate.build-the-science" as NewGameConfig["mandateId"],
  };
}

describe("createRuntimeStoreBridge", () => {
  it("mirrors coherent views while keeping game mutation outside Zustand", () => {
    const runtime = BrowserGameRuntime.createNew(config(), content, {
      scheduler: {
        now: () => 0,
        requestFrame: () => 1,
        cancelFrame: () => undefined,
      },
    });
    const bridge = createRuntimeStoreBridge(runtime);

    expect(bridge.store.getState().gameView?.meta.tick).toBe(0);
    bridge.store.getState().selectPrimarySection("research");
    expect(bridge.store.getState().selectedPrimarySection).toBe("research");

    runtime.stepOneTick();
    expect(bridge.store.getState().gameView?.meta.tick).toBe(1);
    expect(bridge.store.getState().clockView?.paused).toBe(true);

    const storeKeys = Object.keys(bridge.store.getState());
    expect(storeKeys).not.toContain("dispatch");
    expect(storeKeys).not.toContain("advanceOneTick");
    expect(storeKeys).not.toContain("applyCommand");

    bridge.dispose();
    runtime.stepOneTick();
    expect(bridge.store.getState().gameView?.meta.tick).toBe(1);
    runtime.dispose();
  });

  it("projects a safe runtime fault and error status without advancing the cached view", () => {
    const rawMessage = "private simulation exception detail";
    const runtime = BrowserGameRuntime.createNew(config(), content, {
      scheduler: {
        now: () => 0,
        requestFrame: () => 1,
        cancelFrame: () => undefined,
      },
      advanceTick: () => {
        throw new Error(rawMessage);
      },
    });
    const bridge = createRuntimeStoreBridge(runtime);

    runtime.stepOneTick();

    expect(bridge.store.getState()).toMatchObject({
      runtimeStatus: "error",
      runtimeError: "The simulation is paused for recovery.",
      runtimeFault: { scope: "tick-transition", tick: 0 },
    });
    expect(bridge.store.getState().gameView?.meta.tick).toBe(0);
    expect(JSON.stringify(bridge.store.getState())).not.toContain(rawMessage);
    bridge.dispose();
    runtime.dispose();
  });
});
