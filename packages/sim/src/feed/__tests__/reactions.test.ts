import { describe, expect, it } from "vitest";

import { contentId, validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { ProjectId, ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { tick } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { advanceResearcherReactions } from "../reactions.ts";

const content = validateCompiledContent(rawBundle);
const kingman = contentId("base:researcher.diederik-kingman") as unknown as ResearcherId;
const benji = contentId("base:researcher.joshua-benji") as unknown as ResearcherId;

function newState(): DeepMutable<GameState> {
  return structuredClone(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
}

function employ(draft: DeepMutable<GameState>, researcherId: ResearcherId): void {
  const researcher = draft.researchers[researcherId];
  const lab = draft.labs[draft.run.playerLabId];
  if (researcher === undefined || lab === undefined) throw new Error("fixture missing");
  researcher.employerLabId = draft.run.playerLabId;
  researcher.employedAt = draft.run.tick;
  researcher.status = "employed";
  researcher.housing = "housed";
  researcher.compact = {
    includedInOffer: true,
    windowStartedAt: draft.run.tick,
    status: "tracking",
  };
  lab.roster.researcherIds.push(researcherId);
}

function employKingman(draft: DeepMutable<GameState>): void {
  employ(draft, kingman);
}

function trainingFailure(state: GameState) {
  return {
    kind: "training-failure-check",
    labId: state.run.playerLabId,
    projectId: "project:test-run" as ProjectId,
    checkpoint: 0.3,
    outcome: "delay-and-cost",
    delayWeeks: 2,
  } as const;
}

describe("researcher reactions", () => {
  // Diederik Kingman is authored with a reaction to "unstable-training":
  // a real training failure this week must let him speak in the feed.
  it("lets an employed researcher react to a real training failure", () => {
    const draft = newState();
    employKingman(draft);
    const tx = createTransaction(draft);
    tx.emit(trainingFailure(draft));
    advanceResearcherReactions(tx, content, new RandomOracleV1(draft.run.seed));
    const state = tx.commit({ description: "reaction test" }).state;

    const reaction = state.decisionLog.find((entry) => entry.category === "reaction");
    expect(reaction).toBeDefined();
    expect(reaction?.summary).toContain("Diederik Kingman:");
    expect(reaction?.source).toEqual({
      kind: "researcher",
      id: "base:researcher.diederik-kingman",
    });
    expect(
      state.labs[state.run.playerLabId]?.flags[
        `reaction:${reaction?.relatedIds?.[0] ?? ""}:lastAt`
      ],
    ).toBe(state.run.tick);
  });

  it("stays silent without a matching employed researcher", () => {
    const draft = newState();
    const tx = createTransaction(draft);
    tx.emit(trainingFailure(draft));
    advanceResearcherReactions(tx, content, new RandomOracleV1(draft.run.seed));
    const state = tx.commit({ description: "no reactor" }).state;
    expect(state.decisionLog.some((entry) => entry.category === "reaction")).toBe(false);
  });

  it("reacts to a visibly starved safety allocation", () => {
    // Joshua Benji is authored with a "safety-budget-cut" reaction; a safety
    // share under 10% is a standing condition he can see on the allocation
    // screen, so it needs no event to fire.
    const draft = newState();
    employ(draft, benji);
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.compute.allocation.capabilityBasisPoints = 9_600 as never;
    const tx = createTransaction(draft);
    advanceResearcherReactions(tx, content, new RandomOracleV1(draft.run.seed));
    const state = tx.commit({ description: "condition reaction" }).state;
    const reaction = state.decisionLog.find((entry) => entry.category === "reaction");
    expect(reaction?.relatedIds).toEqual(["safety-budget-cut"]);
    expect(reaction?.summary).toContain("Joshua Benji:");
  });

  it("reacts when a disclosure option is actually chosen", () => {
    const draft = newState();
    employ(draft, benji);
    const tx = createTransaction(draft);
    tx.emit({
      kind: "decision-event-resolved",
      instanceId: "run:event:test" as never,
      definitionId: contentId("base:event.test"),
      optionId: "disclose",
      resolutionKind: "player",
    });
    advanceResearcherReactions(tx, content, new RandomOracleV1(draft.run.seed));
    const state = tx.commit({ description: "disclosure reaction" }).state;
    const reaction = state.decisionLog.find((entry) => entry.category === "reaction");
    expect(reaction?.relatedIds).toEqual(["voluntary-disclosure"]);
    expect(reaction?.summary).toContain("Candour is expensive once.");
  });

  it("ignores another lab's week and honours the per-tag cooldown", () => {
    const draft = newState();
    employKingman(draft);
    const rivalLabId = Object.values(draft.labs).find(
      (lab) => lab.control === "rival",
    )?.id;
    if (rivalLabId === undefined) throw new Error("rival lab missing");

    const rivalTx = createTransaction(draft);
    rivalTx.emit({ ...trainingFailure(draft), labId: rivalLabId });
    advanceResearcherReactions(rivalTx, content, new RandomOracleV1(draft.run.seed));
    expect(
      rivalTx.read().decisionLog.some((entry) => entry.category === "reaction"),
    ).toBe(false);

    // Same failure again within the cooldown window: the corridor has already
    // said its piece about this tag.
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    for (const reaction of content.researchers.definitions[
      "base:researcher.diederik-kingman"
    ]?.eventReactions ?? []) {
      lab.flags[`reaction:${reaction.triggerTag}:lastAt`] = tick(draft.run.tick);
    }
    lab.flags["reaction:technical-failure:lastAt"] = tick(draft.run.tick);
    lab.flags["reaction:training-run-failure:lastAt"] = tick(draft.run.tick);
    lab.flags["reaction:fine-tuning-instability:lastAt"] = tick(draft.run.tick);
    lab.flags["reaction:vanishing-signal:lastAt"] = tick(draft.run.tick);
    lab.flags["reaction:unstable-training:lastAt"] = tick(draft.run.tick);
    const cooled = createTransaction(draft);
    cooled.emit(trainingFailure(draft));
    advanceResearcherReactions(cooled, content, new RandomOracleV1(draft.run.seed));
    expect(cooled.read().decisionLog.some((entry) => entry.category === "reaction")).toBe(
      false,
    );
  });
});
