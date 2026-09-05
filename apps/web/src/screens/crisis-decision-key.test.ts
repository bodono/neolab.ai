import { describe, expect, it } from "vitest";

import type { GameView } from "../runtime/index.ts";
import { crisisDecisionKey } from "./crisis-decision-key.ts";

type ActiveEndgameView = Extract<GameView["endgame"], { readonly active: true }>;
type StageActions = ActiveEndgameView["stageActions"];

function crisisView(actions: StageActions): GameView {
  return {
    endgame: {
      active: true,
      candidate: { modelId: "model:player:7" },
      crisisStartedAtTick: 88,
      stageActions: actions,
    },
  } as unknown as GameView;
}

function confirmationActions(input: {
  readonly committed: boolean;
  readonly historyLength: number;
}): StageActions {
  return {
    kind: "confirmation",
    committed: input.committed,
    history: Array.from({ length: input.historyLength }, (_, index) => ({
      id: `proof:${String(index)}`,
    })),
  } as unknown as StageActions;
}

describe("crisisDecisionKey", () => {
  it("does not block the dashboard while a committed capability proof is underway", () => {
    expect(
      crisisDecisionKey(
        crisisView(confirmationActions({ committed: true, historyLength: 0 })),
      ),
    ).toBeUndefined();
  });

  it("treats a returned confirmation after a dispute as a fresh decision", () => {
    const firstAttempt = crisisDecisionKey(
      crisisView(confirmationActions({ committed: false, historyLength: 0 })),
    );
    const secondAttempt = crisisDecisionKey(
      crisisView(confirmationActions({ committed: false, historyLength: 1 })),
    );

    expect(firstAttempt).toBe("model:player:7:88:confirmation:0");
    expect(secondAttempt).toBe("model:player:7:88:confirmation:1");
    expect(secondAttempt).not.toBe(firstAttempt);
  });

  it("retains stable keys for other blocking crisis stages", () => {
    const key = crisisDecisionKey(
      crisisView({ kind: "pressure-collision" } as unknown as StageActions),
    );

    expect(key).toBe("model:player:7:88:pressure-collision");
  });
});
