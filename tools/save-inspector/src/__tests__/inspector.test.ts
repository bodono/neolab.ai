import { describe, expect, it } from "vitest";

import { createNewGame, createSaveEnvelope, seed128 } from "@neolab/sim";

import rawBundle from "../../../../packages/content/generated/content.bundle.json";
import { diffSaveEnvelopes, inspectSaveEnvelope } from "../inspector.ts";

// Builds its own save rather than reading an archived one. The project does
// not support loading saves written by older builds, so the alpha-v* fixture
// archive and every migration test that consumed it were removed; keeping one
// fixture alive purely to test corruption handling would have reintroduced the
// maintenance those fixtures cost.
//
// The bundle is cast rather than validated because this package depends only
// on @neolab/sim; pulling in the content schema to re-validate a bundle the
// build already validated would be a dependency for nothing.
type NewGameArgs = Parameters<typeof createNewGame>;

function freshEnvelope(): unknown {
  const state = createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: "base:difficulty.standard",
      leaderId: "base:leader.thomas-hassabi",
      mandateId: "base:mandate.build-the-science",
    } as unknown as NewGameArgs[0],
    rawBundle as unknown as NewGameArgs[1],
  );
  return JSON.parse(
    JSON.stringify(
      createSaveEnvelope(state, {
        saveId: "inspector-test",
        slotType: "manual",
        displayName: "Inspector test",
        contentHash: state.contentVersion,
        nowIso: "2026-01-01T00:00:00.000Z",
      }),
    ),
  );
}

describe("save inspector", () => {
  it("rejects corruption and invalid diff limits", () => {
    const tampered = freshEnvelope() as { state: { run: { tick: number } } };
    tampered.state.run.tick += 1;
    expect(() => inspectSaveEnvelope(tampered)).toThrow("checksum mismatch");

    const valid = freshEnvelope();
    expect(() => diffSaveEnvelopes(valid, valid, 0)).toThrow("positive integer");
  });
});
