import { describe, expect, it } from "vitest";

import { contentId, validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { applyCommand } from "../../commands/apply.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { CommandId, ResearcherId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { basisPoints } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";

const content = validateCompiledContent(rawBundle);
const benji = contentId("base:researcher.sammy-benji") as unknown as ResearcherId;

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.thomas-hassabi"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

function withBenjiInMarket(state: GameState): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  if (!draft.talentMarket.visibleResearcherIds.includes(benji)) {
    draft.talentMarket.visibleResearcherIds.push(benji);
  }
  return draft;
}

function meta(state: GameState, id: string) {
  return {
    commandId: `command:${id}` as CommandId,
    expectedTick: state.run.tick,
    issuedBy: "player",
  } as const;
}

describe("reactions through the real command pipeline", () => {
  // Sammy Benji is authored with a "safety-budget-cut" reaction. Recruiting
  // him and starving the safety allocation through real commands must produce
  // his line once the allocation order lands.
  it("fires the starved-safety reaction through real commands", () => {
    let state = withBenjiInMarket(newState());
    const labId = state.run.playerLabId;
    state = applyCommand(state, content, {
      kind: "recruit-researcher",
      meta: meta(state, "repro-recruit"),
      labId,
      researcherId: benji,
    }).state;
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error("lab missing");
    state = applyCommand(state, content, {
      kind: "set-gpu-allocation",
      meta: meta(state, "repro-alloc"),
      labId,
      allocation: {
        ...lab.compute.allocation,
        capabilityBasisPoints: basisPoints(9_500),
      },
    }).state;
    state = advanceOneTick(state, content).state;
    state = advanceOneTick(state, content).state;
    const reactions = state.decisionLog.filter((e) => e.category === "reaction");
    expect(state.researchers[benji]?.status).toBe("employed");
    expect(reactions.map((r) => r.summary).join("|")).toContain("Sammy Benji");
  });

  // Recruitment emits its event inside the command's own transaction, so the
  // command pipeline itself must let employed colleagues react to it.
  it("lets an employed colleague react to a recruitment command", () => {
    const reactorDefinition = Object.values(content.researchers.definitions).find(
      (definition) =>
        definition.eventReactions.some(
          (reaction) => reaction.triggerTag === "academia-industry-tension",
        ),
    );
    if (reactorDefinition === undefined) throw new Error("no reactor authored");
    const reactorId = reactorDefinition.id as unknown as ResearcherId;

    const draft = structuredClone(
      withBenjiInMarket(newState()),
    ) as DeepMutable<GameState>;
    const reactor = draft.researchers[reactorId];
    const lab = draft.labs[draft.run.playerLabId];
    if (reactor === undefined || lab === undefined) throw new Error("fixture missing");
    reactor.employerLabId = draft.run.playerLabId;
    reactor.employedAt = draft.run.tick;
    reactor.status = "employed";
    reactor.housing = "housed";
    reactor.compact = {
      includedInOffer: true,
      windowStartedAt: draft.run.tick,
      status: "tracking",
    };
    lab.roster.researcherIds.push(reactorId);
    draft.talentMarket.visibleResearcherIds =
      draft.talentMarket.visibleResearcherIds.filter((id) => id !== reactorId);

    const result = applyCommand(draft, content, {
      kind: "recruit-researcher",
      meta: meta(draft, "command-event-recruit"),
      labId: draft.run.playerLabId,
      researcherId: benji,
    }).state;
    const reaction = result.decisionLog.find((e) => e.category === "reaction");
    expect(reaction?.relatedIds).toEqual(["academia-industry-tension"]);
    expect(reaction?.summary).toContain(`${reactorDefinition.displayName}:`);
  });
});
