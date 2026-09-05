import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import {
  createProgressiveNewGame,
  LAB_MATURITY_STAGE_FLAG,
} from "../../campaign/lab-maturity.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId } from "../../model/ids.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, fraction, rating, tick } from "../../model/units.ts";
import { createSaveEnvelope, loadSaveEnvelope } from "../../persistence/envelope.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  calculateFundingScore,
  expireFundingOffers,
  fundraisingRoundLabel,
  generateFundingOffers,
  quoteFundraisingCampaign,
} from "../fundraising.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const conditionedOfferOracle: RandomOracle = {
  uniform: () => 0.5,
  integer: () => 1,
  triangular: (_key, _minimum, mode) => mode,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

function collidingOfferOracle(): RandomOracle {
  let integerCalls = 0;
  return {
    ...conditionedOfferOracle,
    // Under the old per-offer sampling, variants 1 and 0 became the same
    // catalogue entry after the offer-index offset was added.
    integer: () => (integerCalls++ === 0 ? 1 : 0),
  };
}

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

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

type Campaign = "quiet-bridge" | "competitive-round" | "mega-round-roadshow";

function campaignCommand(state: GameState, campaign: Campaign = "competitive-round") {
  return {
    kind: "start-fundraising-campaign" as const,
    meta: {
      commandId: `command:${campaign}:${String(state.run.tick)}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    campaign,
  };
}

function preparedOffers(
  initial: GameState = newState(),
  campaign: Campaign = "competitive-round",
  oracle: RandomOracle = conditionedOfferOracle,
): GameState {
  const started = applyCommand(
    initial,
    content,
    campaignCommand(initial, campaign),
  ).state;
  const projectId = Object.values(started.projects).find(
    (project) =>
      project.kind === "fundraising" &&
      (project.status === "active" || project.status === "queued"),
  )?.id;
  if (projectId === undefined) throw new Error("campaign fixture missing");
  const ready = mutable(started);
  const project = ready.projects[projectId];
  if (project === undefined) throw new Error("project fixture missing");
  project.status = "active";
  project.startedAt = ready.run.tick;
  project.progress = 1;
  const tx = createTransaction(ready);
  generateFundingOffers(tx, content, projectId, oracle);
  tx.update((draft) => {
    const mutableProject = draft.projects[projectId];
    if (mutableProject === undefined) throw new Error("project disappeared");
    mutableProject.status = "completed";
  });
  return tx.commit({ description: "prepared funding offers" }).state;
}

describe("fundraising campaigns", () => {
  it("converts the opening bridge and leaves every first Seed with $30M cash", () => {
    const opening = mutable(
      createProgressiveNewGame(
        {
          seed: seed128("0123456789abcdef0123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.sam-altmann"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
    );
    const lab = opening.labs[opening.run.playerLabId];
    if (lab === undefined) throw new Error("opening recapitalisation lab missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "funding";
    lab.finance.cash = cashMillions(-75);
    lab.aura.spendable = 100;
    lab.aura.lifetime = 100;

    const offered = preparedOffers(opening, "quiet-bridge");
    const offerId = offered.fundraising.offerOrder.find(
      (candidateId) => offered.fundraising.offers[candidateId]?.status === "available",
    );
    const offer = offerId === undefined ? undefined : offered.fundraising.offers[offerId];
    if (offerId === undefined || offer === undefined)
      throw new Error("Seed offer missing");

    const acceptedResult = applyCommand(offered, content, {
      kind: "accept-funding-offer",
      meta: {
        commandId: "command:accept-opening-seed" as CommandId,
        expectedTick: offered.run.tick,
        issuedBy: "player",
      },
      labId: offered.run.playerLabId,
      offerId,
    });

    expect(acceptedResult.state.labs[offered.run.playerLabId]?.finance.cash).toBe(
      Math.max(30, offer.cashMillions),
    );
    const fundingEvent = acceptedResult.domainEvents.find(
      (event) => event.kind === "funding-offer-accepted",
    );
    expect(fundingEvent?.kind).toBe("funding-offer-accepted");
    if (fundingEvent?.kind !== "funding-offer-accepted") {
      throw new Error("opening Seed event missing");
    }
    expect(fundingEvent.offerId).toBe(offerId);
    expect(fundingEvent.roundOrdinal).toBe(1);
    expect(fundingEvent.roundLabel).toBe("Seed");
    expect(fundingEvent.openingRecapitalisation?.bridgeConversionMillions).toBe(75);
    expect(fundingEvent.openingRecapitalisation?.postCloseCashMillions).toBe(
      Math.max(30, offer.cashMillions),
    );
    expect(
      acceptedResult.state.decisionLog.some((entry) =>
        entry.summary.includes("your parents' angel stake"),
      ),
    ).toBe(true);
  });

  it("protects the opening with real $8M, $16M, and $30M cheque floors", () => {
    const expectedFloors = {
      "quiet-bridge": 8,
      "competitive-round": 16,
      "mega-round-roadshow": 30,
    } as const;
    const state = newState();
    for (const [campaign, expectedFloor] of Object.entries(expectedFloors)) {
      const typedCampaign = campaign as keyof typeof expectedFloors;
      const definition = content.fundraising.campaigns[typedCampaign];
      const quote = quoteFundraisingCampaign(
        state,
        content,
        state.run.playerLabId,
        typedCampaign,
      );
      expect(definition.baseCashMillions).toBe(expectedFloor);
      expect(quote.estimatedCashRangeMillions[0]).toBeGreaterThanOrEqual(expectedFloor);
    }
  });

  it("labels successive successful closes Seed, Series A, and onward", () => {
    expect([1, 2, 27, 28].map(fundraisingRoundLabel)).toEqual([
      "Seed",
      "Series A",
      "Series Z",
      "Series AA",
    ]);
  });

  it("quotes all three campaign shapes and enforces campaign-specific cooldowns", () => {
    const state = newState();
    const labId = state.run.playerLabId;
    expect(
      (["quiet-bridge", "competitive-round", "mega-round-roadshow"] as const).map(
        (campaign) => {
          const quote = quoteFundraisingCampaign(state, content, labId, campaign);
          return {
            campaign,
            auraCost: quote.auraCost,
            offerCount: quote.offerCount,
            durationWeeks: quote.durationWeeks,
            hasPositiveRange:
              quote.estimatedCashRangeMillions[0] > 0 &&
              quote.estimatedCashRangeMillions[1] > quote.estimatedCashRangeMillions[0],
          };
        },
      ),
    ).toEqual([
      {
        campaign: "quiet-bridge",
        auraCost: 4,
        offerCount: 1,
        durationWeeks: 2,
        hasPositiveRange: true,
      },
      {
        campaign: "competitive-round",
        auraCost: 10,
        offerCount: 3,
        durationWeeks: 5,
        hasPositiveRange: true,
      },
      {
        campaign: "mega-round-roadshow",
        auraCost: 22,
        offerCount: 2,
        durationWeeks: 8,
        hasPositiveRange: true,
      },
    ]);

    const quietCommand = campaignCommand(state, "quiet-bridge");
    let afterCampaign = applyCommand(state, content, quietCommand).state;
    afterCampaign = advanceOneTick(afterCampaign, content).state;
    afterCampaign = advanceOneTick(afterCampaign, content).state;
    expect(
      quoteFundraisingCampaign(afterCampaign, content, labId, "quiet-bridge").blockers,
    ).toContain("Campaign is cooling down until week 13");
  });

  it("shows global and recent-round pressure as separate additive costs", () => {
    const state = mutable(addBaselineModelForTest(preparedOffers(), content));
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model?.measuredCapability === undefined) throw new Error("model fixture missing");
    model.measuredCapability.frontierCapability = rating(60);

    for (const [index, offerId] of state.fundraising.offerOrder.slice(0, 2).entries()) {
      const offer = state.fundraising.offers[offerId];
      if (offer === undefined) throw new Error("offer fixture missing");
      offer.status = "accepted";
      offer.resolvedAt = state.run.tick;
      offer.roundOrdinal = index + 1;
    }

    const quote = quoteFundraisingCampaign(
      state,
      content,
      state.run.playerLabId,
      "mega-round-roadshow",
    );
    expect(quote.auraCostBreakdown).toEqual({
      baseAuraCost: 22,
      worldFrontierCapability: 60,
      marketPressureMultiplier: 2.5,
      globalMarketPressureAuraCost: 33,
      marketAdjustedAuraCost: 55,
      recentRoundPressureAuraCost: 7,
      emergencyBridgeReliefAuraCost: 0,
      totalAuraCost: 62,
    });
    expect(quote.auraCost).toBe(62);
  });

  it("offers distinct investor terms within every multi-offer roadshow", () => {
    for (const campaign of ["competitive-round", "mega-round-roadshow"] as const) {
      const offered = preparedOffers(newState(), campaign, collidingOfferOracle());
      const offers = offered.fundraising.offerOrder.map((offerId) => {
        const offer = offered.fundraising.offers[offerId];
        if (offer === undefined) throw new Error("funding offer missing");
        return offer;
      });
      expect(new Set(offers.map((offer) => offer.investorStyle)).size).toBe(
        offers.length,
      );
      expect(
        new Set(offers.map((offer) => offer.conditions.map(({ id }) => id).join("|")))
          .size,
      ).toBe(offers.length);
    }
  });

  it("uses product traction, capability, and lifetime Aura in the funding score", () => {
    const draft = mutable(addBaselineModelForTest(newState(), content));
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("lab fixture missing");
    const segment = Object.values(lab.market.segments)[0];
    if (segment === undefined) throw new Error("market segment fixture missing");
    segment.lastCycleDeliveredUsage = 40_000;
    segment.lastCycleRevenueMillions = cashMillions(10);
    lab.market.marketShare = fraction(0.05);
    lab.market.monetisationEfficiency = fraction(0.5);
    lab.aura.lifetime = 42;
    lab.aura.ledger.push({
      id: "test:recent-publicity",
      occurredAt: tick(0),
      kind: "gain",
      category: "fundraising",
      requestedDelta: 0,
      appliedDelta: 0,
      lifetimeDelta: 0,
      signalImpact: 25,
      source: { kind: "system", id: "test:recent-publicity" },
    });
    const score = calculateFundingScore(draft, content, lab.id, 5);
    // Funding climate (0.15) and investor trust (0.10) were removed: climate was
    // a constant for the life of every run and trust only ratcheted downward, so
    // together they contributed a fixed 10.75 points no decision could move. The
    // remaining three weights are rescaled by 1/0.75 to preserve the range.
    const expected =
      score.commercialTraction * 0.4 +
      score.recentCapability * 0.333 +
      score.auraSignal * 0.267 -
      score.scandalPenalty +
      5;
    expect(score.auraSignal).toBe(42);
    expect(score.commercialTraction).toBe(30);
    expect(score.final).toBeCloseTo(expected, 10);
  });

  it("gives no product traction without a customer-facing model", () => {
    const draft = mutable(newState());
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("lab fixture missing");
    lab.market.marketShare = fraction(1);
    lab.market.monetisationEfficiency = fraction(1);
    for (const segment of Object.values(lab.market.segments)) {
      segment.accruedDeliveredUsage = 100_000;
      segment.accruedRevenueMillions = cashMillions(100);
      segment.lastCycleDeliveredUsage = 100_000;
      segment.lastCycleRevenueMillions = cashMillions(100);
    }

    expect(calculateFundingScore(draft, content, lab.id).commercialTraction).toBe(0);
  });

  it("does not mistake market share or monetisation efficiency for traction", () => {
    const draft = mutable(addBaselineModelForTest(newState(), content));
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("lab fixture missing");
    lab.market.marketShare = fraction(1);
    lab.market.monetisationEfficiency = fraction(1);

    expect(calculateFundingScore(draft, content, lab.id).commercialTraction).toBe(0);
  });

  it("rolls settled delivery and revenue out as the current cycle accrues", () => {
    const draft = mutable(addBaselineModelForTest(newState(), content));
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("lab fixture missing");
    const segment = Object.values(lab.market.segments)[0];
    if (segment === undefined) throw new Error("market segment fixture missing");
    lab.market.weeksAccruedThisCycle = 2;
    segment.lastCycleDeliveredUsage = 40_000;
    segment.lastCycleRevenueMillions = cashMillions(10);
    segment.accruedDeliveredUsage = 10_000;
    segment.accruedRevenueMillions = cashMillions(5);

    expect(calculateFundingScore(draft, content, lab.id).commercialTraction).toBe(25);
  });

  it("scales the cheque with the lab's valuation mark, not a round counter", () => {
    const base = preparedOffers();
    const labId = base.run.playerLabId;
    const modest = quoteFundraisingCampaign(base, content, labId, "quiet-bridge");

    // Re-mark the lab far higher; the same campaign should now raise more.
    const repriced = mutable(base);
    const lab = repriced.labs[labId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.finance.valuation = {
      markMillions: (lab.finance.valuation?.markMillions ?? 100) * 20,
      previousMarkMillions: lab.finance.valuation?.markMillions ?? 100,
      peakMarkMillions: (lab.finance.valuation?.markMillions ?? 100) * 20,
      announcedMilestones: [],
    };
    const rich = quoteFundraisingCampaign(repriced, content, labId, "quiet-bridge");

    expect(rich.estimatedCashRangeMillions[0]).toBeGreaterThan(
      modest.estimatedCashRangeMillions[0],
    );
    expect(rich.estimatedCashRangeMillions[1]).toBeGreaterThan(
      modest.estimatedCashRangeMillions[1],
    );
  });

  it("keeps campaign cheques below the pre-money mark and quotes post-money valuation", () => {
    const state = mutable(newState());
    const labId = state.run.playerLabId;
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error("player lab missing");
    const preMoneyMark = 246.3;
    lab.finance.valuation = {
      markMillions: preMoneyMark,
      previousMarkMillions: preMoneyMark,
      peakMarkMillions: preMoneyMark,
      announcedMilestones: [],
    };

    const ranges = (
      ["quiet-bridge", "competitive-round", "mega-round-roadshow"] as const
    ).map(
      (campaign) =>
        quoteFundraisingCampaign(state, content, labId, campaign)
          .estimatedCashRangeMillions,
    );
    expect(ranges[0]?.[1]).toBeLessThan(ranges[1]?.[1] ?? 0);
    expect(ranges[1]?.[1]).toBeLessThan(ranges[2]?.[1] ?? 0);
    for (const range of ranges) {
      expect(range[1]).toBeLessThan(preMoneyMark);
    }

    const offered = preparedOffers(state, "mega-round-roadshow");
    for (const offerId of offered.fundraising.offerOrder) {
      const offer = offered.fundraising.offers[offerId];
      if (offer === undefined) throw new Error("offer missing");
      expect(offer.cashMillions).toBeLessThan(preMoneyMark);
      expect(offer.impliedMarkMillions).toBeCloseTo(preMoneyMark + offer.cashMillions, 6);
      expect(offer.impliedMarkMillions).toBeGreaterThan(offer.cashMillions);
    }
  });
  it("spends Aura at campaign start, runs as a project, and deterministically creates three offers", () => {
    const state = newState();
    const startingAura = state.labs[state.run.playerLabId]?.aura.spendable ?? 0;
    const command = campaignCommand(state);
    const validation = validateCommand(state, content, command);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.fundraisingCampaign).toMatchObject({
        auraCost: 10,
        durationWeeks: 5,
        offerCount: 3,
      });
    }
    const started = applyCommand(state, content, command).state;
    expect(started.labs[state.run.playerLabId]?.aura.spendable).toBe(startingAura - 10);
    expect(started.labs[state.run.playerLabId]?.aura.ledger.at(-1)).toMatchObject({
      kind: "spend",
      category: "fundraising",
      appliedDelta: -10,
    });
    expect(Object.values(started.projects)).toContainEqual(
      expect.objectContaining({ kind: "fundraising", status: "active", progress: 0 }),
    );

    const advanceCampaign = (initial: GameState): GameState => {
      let current = initial;
      for (let week = 0; week < 5; week += 1) {
        current = advanceOneTick(current, content).state;
      }
      return current;
    };
    const completed = advanceCampaign(started);
    const replayed = advanceCampaign(applyCommand(state, content, command).state);
    expect(completed.fundraising.offerOrder).toHaveLength(3);
    expect(completed.fundraising.offers).toEqual(replayed.fundraising.offers);
    expect(Object.values(completed.projects)).toContainEqual(
      expect.objectContaining({ kind: "fundraising", status: "completed" }),
    );
    expect(completed.run.autoPauseReasons).toContain("funding-offers");
    const offersLog = completed.decisionLog.find(
      (entry) =>
        entry.source?.kind === "system" &&
        entry.source.id?.startsWith("fundraising-offers:") === true,
    );
    expect(offersLog?.summary).toContain(
      "term sheets arrived after the Competitive round",
    );
    expect(offersLog?.category).toBe("narrative");
    for (const offerId of completed.fundraising.offerOrder) {
      const draw = completed.fundraising.offers[offerId]?.cashVarianceDraw;
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("accepts one conditional offer atomically and records Stage 5 obligations", () => {
    const offered = preparedOffers();
    const offerId = offered.fundraising.offerOrder[0];
    const offer = offerId === undefined ? undefined : offered.fundraising.offers[offerId];
    if (offerId === undefined || offer === undefined) throw new Error("offer missing");
    expect(offer.conditions).toHaveLength(2);
    expect(offer.conditions.some((condition) => condition.kind === "modifier")).toBe(
      true,
    );
    const beforeCash = offered.labs[offered.run.playerLabId]?.finance.cash ?? 0;
    const command = {
      kind: "accept-funding-offer" as const,
      meta: {
        commandId: "command:accept-funding" as CommandId,
        expectedTick: offered.run.tick,
        issuedBy: "player" as const,
      },
      labId: offered.run.playerLabId,
      offerId,
    };
    const validation = validateCommand(offered, content, command);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.preview.fundingOffer?.offer.cashMillions).toBe(
        offer.cashMillions,
      );
    }
    const acceptedResult = applyCommand(offered, content, command);
    const accepted = acceptedResult.state;
    expect(accepted.labs[offered.run.playerLabId]?.finance.cash).toBe(
      beforeCash + offer.cashMillions,
    );
    expect(accepted.fundraising.offers[offerId]?.status).toBe("accepted");
    expect(accepted.fundraising.offers[offerId]?.roundOrdinal).toBe(1);
    expect(acceptedResult.domainEvents).toContainEqual({
      kind: "funding-offer-accepted",
      labId: offered.run.playerLabId,
      offerId,
      cashMillions: offer.cashMillions,
      conditionCount: offer.conditions.length,
      roundOrdinal: 1,
      roundLabel: "Seed",
    });
    expect(
      accepted.fundraising.offerOrder
        .filter((id) => id !== offerId)
        .map((id) => accepted.fundraising.offers[id]?.status),
    ).toEqual(["rejected", "rejected"]);
    // No obligation is recorded: conditions apply in full on acceptance and
    // expire on their own. Obligations existed only to hold conditions awaiting
    // a follow-up that was never built.
    expect(accepted.fundraising.obligations).toHaveLength(0);

    // Every condition must land as a live, time-limited modifier on a target
    // the simulation reads. This is the assertion the old suite lacked: it
    // checked that a flag had been set, which was true of ten conditions that
    // did nothing, because nothing ever read the flag.
    const applied = Object.values(accepted.modifiers).filter(
      (modifier) => modifier.source.id === offerId,
    );
    expect(applied).toHaveLength(offer.conditions.length);
    for (const modifier of applied) {
      expect(modifier.endsAt).toBeDefined();
      expect(modifier.value).not.toBe(1);
    }

    // No condition may sit on a researcher-only target. resolveResearcherStack
    // passes includeSourceKinds: ["researcher"], so a system-sourced funding
    // modifier on one would be silently discarded -- a placebo with a live-
    // looking modifier behind it.
    for (const modifier of applied) {
      expect(modifier.target).not.toBe("lab.research.capability.output");
      expect(modifier.target).not.toBe("lab.research.safety.output");
    }

    // The parked board-patience mechanic must not creep back in.
    for (const modifier of applied) {
      expect(modifier.target).not.toBe("lab.organisation.boardPatienceTarget");
    }

    // And no condition may set a lab flag, which is what made them cosmetic.
    expect(offer.conditions.every((condition) => condition.kind === "modifier")).toBe(
      true,
    );

    // No offer may charge the same underlying cost twice under two names.
    // ownedPurchasePrice and acquisitionCost are chained on one GPU purchase
    // (acquisitionCost resolves against the output of ownedPurchasePrice), and
    // ownedPowerCost is a line item inside costs.fixed.
    const targets = new Set(
      offer.conditions.flatMap((condition) =>
        condition.kind === "modifier" ? [condition.target] : [],
      ),
    );
    const overlapping: readonly (readonly [string, string])[] = [
      ["lab.compute.ownedPurchasePrice", "lab.compute.acquisitionCost"],
      ["lab.compute.ownedPowerCost", "lab.costs.fixed"],
    ];
    for (const [left, right] of overlapping) {
      expect(targets.has(left) && targets.has(right)).toBe(false);
    }
    expect(accepted.decisionLog.at(-1)?.summary).toMatch(
      /^Seed closed: accepted .+ funding offer for \$\d+(?:\.\d+)?M with \d+ condition\(s\)\.$/,
    );
    const envelope = createSaveEnvelope(accepted, {
      saveId: "fundraising-state",
      slotType: "manual",
      displayName: "Fundraising state",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-22T00:00:00.000Z",
    });
    expect(loadSaveEnvelope(envelope).state.fundraising).toEqual(accepted.fundraising);
  });

  it("advances to Series A only after the Seed offer is accepted", () => {
    const seedOffers = preparedOffers();
    const seedOfferId = seedOffers.fundraising.offerOrder.find(
      (offerId) => seedOffers.fundraising.offers[offerId]?.status === "available",
    );
    if (seedOfferId === undefined) throw new Error("Seed offer missing");
    const seed = applyCommand(seedOffers, content, {
      kind: "accept-funding-offer",
      meta: {
        commandId: "command:accept-seed" as CommandId,
        expectedTick: seedOffers.run.tick,
        issuedBy: "player",
      },
      labId: seedOffers.run.playerLabId,
      offerId: seedOfferId,
    }).state;

    expect(
      quoteFundraisingCampaign(seed, content, seed.run.playerLabId, "quiet-bridge"),
    ).toMatchObject({ roundOrdinal: 2, roundLabel: "Series A" });

    const seriesAOffers = preparedOffers(seed, "quiet-bridge");
    const seriesAOfferId = seriesAOffers.fundraising.offerOrder.find(
      (offerId) => seriesAOffers.fundraising.offers[offerId]?.status === "available",
    );
    if (seriesAOfferId === undefined) throw new Error("Series A offer missing");
    const seriesAResult = applyCommand(seriesAOffers, content, {
      kind: "accept-funding-offer",
      meta: {
        commandId: "command:accept-series-a" as CommandId,
        expectedTick: seriesAOffers.run.tick,
        issuedBy: "player",
      },
      labId: seriesAOffers.run.playerLabId,
      offerId: seriesAOfferId,
    });

    expect(seriesAResult.state.fundraising.offers[seriesAOfferId]?.roundOrdinal).toBe(2);
    expect(seriesAResult.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "funding-offer-accepted",
        offerId: seriesAOfferId,
        roundOrdinal: 2,
        roundLabel: "Series A",
      }),
    );
  });

  it("expires unaccepted offers at their declared deadline", () => {
    const offered = preparedOffers();
    const firstId = offered.fundraising.offerOrder[0];
    const expiresAt =
      firstId === undefined ? undefined : offered.fundraising.offers[firstId]?.expiresAt;
    if (expiresAt === undefined) throw new Error("expiry fixture missing");
    const due = mutable(offered);
    due.run.tick = tick(expiresAt);
    due.run.calendar = calendarFromTick(expiresAt);
    const tx = createTransaction(due);
    expireFundingOffers(tx);
    const expired = tx.commit({ description: "expire offers" }).state;
    expect(
      expired.fundraising.offerOrder.map(
        (offerId) => expired.fundraising.offers[offerId]?.status,
      ),
    ).toEqual(["expired", "expired", "expired"]);
    expect(
      quoteFundraisingCampaign(expired, content, expired.run.playerLabId, "quiet-bridge"),
    ).toMatchObject({ roundOrdinal: 1, roundLabel: "Seed" });
  });

  it("expires offers during the weekly transition that reaches their deadline", () => {
    const offered = preparedOffers();
    const firstId = offered.fundraising.offerOrder[0];
    const expiresAt =
      firstId === undefined ? undefined : offered.fundraising.offers[firstId]?.expiresAt;
    if (expiresAt === undefined) throw new Error("expiry fixture missing");
    const beforeDeadline = mutable(offered);
    beforeDeadline.run.tick = tick(expiresAt - 1);
    beforeDeadline.run.calendar = calendarFromTick(expiresAt - 1);

    const advanced = advanceOneTick(beforeDeadline, content).state;

    expect(advanced.run.tick).toBe(expiresAt);
    expect(
      advanced.fundraising.offerOrder.map(
        (offerId) => advanced.fundraising.offers[offerId]?.status,
      ),
    ).toEqual(["expired", "expired", "expired"]);
  });
});
