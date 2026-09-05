import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";
import {
  advanceOneTick,
  applyCommand,
  createTransaction,
  rating,
  stableStringify,
  startPoachingAttempt,
  stateHash,
  type CommandId,
  type DeepMutable,
  type GameState,
  type ResearcherId,
} from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

const content = scenarioContent();
const ianLemon = contentId("base:researcher.ian-lemon") as unknown as ResearcherId;
const stewartRussel = contentId(
  "base:researcher.stewart-russel",
) as unknown as ResearcherId;
const joshuaBenji = contentId("base:researcher.joshua-benji") as unknown as ResearcherId;
const hires = [ianLemon, stewartRussel, joshuaBenji] as const;

function commandId(value: string): CommandId {
  return `command:stage-4:${value}` as CommandId;
}

function runPeopleAndFundingScenario(): GameState {
  let state = scenario()
    .withSeed("0123456789abcdef0123456789abcdef")
    .withPlayerLab((lab) => lab.cash(10_000).aura(1_000))
    .build();

  // The scenario is about Stage 4 consequences, not market luck: list the
  // three seeded hires in the visible market before recruiting them.
  const listed = structuredClone(state) as unknown as {
    talentMarket: { visibleResearcherIds: string[] };
  };
  listed.talentMarket.visibleResearcherIds = [
    ...new Set<string>([...hires, ...state.talentMarket.visibleResearcherIds]),
  ];
  state = listed as unknown as GameState;

  for (const [index, researcherId] of hires.entries()) {
    state = applyCommand(state, content, {
      kind: "recruit-researcher",
      meta: {
        commandId: commandId(`hire-${String(index)}`),
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      researcherId,
    }).state;
    if (state.researchers[researcherId]?.status !== "employed") {
      throw new Error(`Seeded Stage 4 recruitment failed for ${researcherId}`);
    }
  }

  state = applyCommand(state, content, {
    kind: "start-fundraising-campaign",
    meta: {
      commandId: commandId("competitive-round"),
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    campaign: "competitive-round",
  }).state;

  while (state.run.tick < 5) {
    state = advanceOneTick(state, content).state;
  }
  const fundingOfferId = state.fundraising.offerOrder.find(
    (offerId) => state.fundraising.offers[offerId]?.status === "available",
  );
  if (fundingOfferId === undefined) {
    throw new Error("Competitive Round did not create an available offer");
  }
  state = applyCommand(state, content, {
    kind: "accept-funding-offer",
    meta: {
      commandId: commandId("accept-competitive-offer"),
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    offerId: fundingOfferId,
  }).state;

  // Ian's open-output compact has no satisfying action in this scenario. The
  // engine therefore emits its warning at week 22 and breach at week 26.
  while (state.run.tick <= 26) {
    state = advanceOneTick(state, content).state;
  }

  const poachingFixture = structuredClone(state) as DeepMutable<GameState>;
  const poachingTarget = poachingFixture.researchers[stewartRussel];
  if (poachingTarget?.status !== "employed") {
    throw new Error("Scripted poaching target is no longer employed");
  }
  poachingTarget.departurePressure = rating(100);
  poachingTarget.loyalty = rating(0);
  const poachingTx = createTransaction(poachingFixture);
  startPoachingAttempt(poachingTx, content, stewartRussel, "lab:rival-1", 100);
  state = poachingTx.commit({ description: "scripted Stage 4 poaching" }).state;

  for (let week = 0; week < 6; week += 1) {
    if (state.researchers[stewartRussel]?.status === "departed") break;
    state = advanceOneTick(state, content).state;
  }
  if (
    state.researchers[stewartRussel]?.status !== "departed" ||
    state.researchers[stewartRussel]?.flags["departureReason"] !== "poached"
  ) {
    throw new Error("Seeded poaching resolution did not remove its target");
  }

  state = applyCommand(state, content, {
    kind: "dismiss-researcher",
    meta: {
      commandId: commandId("dismiss-joshua"),
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    researcherId: joshuaBenji,
    confirmed: true,
  }).state;

  return state;
}

describe("Stage 4 people, Aura, facilities, and funding scenario", () => {
  it("records every consequence and replays the integrated chain exactly", () => {
    const first = runPeopleAndFundingScenario();
    const replay = runPeopleAndFundingScenario();
    const summaries = first.decisionLog.map((entry) => entry.summary);

    expect(
      hires.every(
        (researcherId) => first.researchers[researcherId]?.employedAt !== undefined,
      ),
    ).toBe(true);
    expect(first.researchers[ianLemon]?.compact.status).toBe("breached");
    expect(first.researchers[stewartRussel]).toMatchObject({
      status: "departed",
      poaching: { stage: "resolved", outcome: "departed" },
      flags: { departureReason: "poached" },
    });
    expect(first.researchers[joshuaBenji]).toMatchObject({
      status: "departed",
      flags: { departureReason: "dismissed" },
    });
    expect(
      first.fundraising.offerOrder.some(
        (offerId) => first.fundraising.offers[offerId]?.status === "accepted",
      ),
    ).toBe(true);

    for (const fragment of [
      "Yann LeNet joined the lab at the listed terms",
      "Stewart Russel joined the lab at the listed terms",
      "Joshua Benji joined the lab at the listed terms",
      "Seed fundraising started via Competitive round",
      "Seed closed: accepted",
      "Yann LeNet's promise is due soon",
      "Yann LeNet's promise was broken",
      "unusually long conference conversation",
      "made Stewart Russel an explicit offer",
      "Stewart Russel left the lab (poached)",
      "Joshua Benji left the lab (dismissed)",
    ]) {
      expect(summaries.some((summary) => summary.includes(fragment))).toBe(true);
    }
    expect(summaries.join("\n")).not.toMatch(/base:researcher|run:lab:rival|lab:rival-/);
    expect(summaries.join("\n")).not.toContain("knowledge-transfer rules");
    expect(stableStringify(replay)).toBe(stableStringify(first));
    expect(stateHash(replay)).toBe(stateHash(first));
  });
});
