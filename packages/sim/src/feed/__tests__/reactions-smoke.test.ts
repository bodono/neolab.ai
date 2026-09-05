import { describe, expect, it } from "vitest";

import { contentId, validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { applyCommand } from "../../commands/apply.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { CommandId, ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";

const content = validateCompiledContent(rawBundle);

describe("reactions over a real trajectory", () => {
  it("fires at least one in-character reaction across sixty weeks", () => {
    let state = createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    );
    const draft = structuredClone(state) as DeepMutable<GameState>;
    const kingman = contentId(
      "base:researcher.diederik-kingman",
    ) as unknown as ResearcherId;
    const lab = draft.labs[draft.run.playerLabId];
    const researcher = draft.researchers[kingman];
    if (lab === undefined || researcher === undefined) throw new Error("fixture");
    researcher.employerLabId = draft.run.playerLabId;
    researcher.employedAt = draft.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.compact = {
      includedInOffer: true,
      windowStartedAt: draft.run.tick,
      status: "tracking",
    };
    lab.roster.researcherIds.push(kingman);
    state = draft;
    state = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:smoke-train" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      ...(lab.models.currentModelId === undefined
        ? {}
        : { parentModelId: lab.models.currentModelId }),
      durationWeeks: 8,
      posture: "normal",
    }).state;
    for (let index = 0; index < 60; index += 1) {
      state = advanceOneTick(state, content).state;
      if (state.run.autoPauseReasons.length > 0) {
        const unpaused = structuredClone(state) as DeepMutable<GameState>;
        unpaused.run.autoPauseReasons = [];
        state = unpaused;
      }
    }
    const reactions = state.decisionLog.filter((entry) => entry.category === "reaction");
    expect(reactions.length).toBeGreaterThan(0);
  });
});
