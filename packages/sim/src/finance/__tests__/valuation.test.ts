import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  advanceValuations,
  bucketValuation,
  calculateValuationTarget,
  currentMark,
  formatValuation,
  marketMood,
  reportedRivalValuation,
} from "../valuation.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelsForTest(
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

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function setMeasuredCapability(
  draft: DeepMutable<GameState>,
  frontierCapability: number,
): void {
  const lab = draft.labs[draft.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : draft.models[modelId];
  if (model?.measuredCapability === undefined) throw new Error("fixture missing");
  model.measuredCapability.frontierCapability = rating(frontierCapability);
}

describe("valuation arc", () => {
  it("starts a new lab in the tens-to-hundreds of millions", () => {
    const mark = currentMark(newState(), content, newState().run.playerLabId);
    expect(mark).toBeGreaterThan(20);
    expect(mark).toBeLessThan(500);
  });

  it("climbs orders of magnitude as measured capability grows", () => {
    const early = mutable(newState());
    setMeasuredCapability(early, 10);
    const mid = mutable(newState());
    setMeasuredCapability(mid, 50);
    const frontier = mutable(newState());
    setMeasuredCapability(frontier, 85);

    const earlyMark = calculateValuationTarget(
      early,
      content,
      early.run.playerLabId,
    ).targetMillions;
    const midMark = calculateValuationTarget(
      mid,
      content,
      mid.run.playerLabId,
    ).targetMillions;
    const frontierMark = calculateValuationTarget(
      frontier,
      content,
      frontier.run.playerLabId,
    ).targetMillions;

    expect(midMark).toBeGreaterThan(earlyMark * 10);
    expect(frontierMark).toBeGreaterThan(midMark * 10);
    // A frontier lab is worth tens of billions before any AGI repricing.
    expect(frontierMark).toBeGreaterThan(10_000);
  });

  it("reprices sharply once a candidate is confirmed", () => {
    const before = mutable(newState());
    setMeasuredCapability(before, 88);
    const after = mutable(newState());
    setMeasuredCapability(after, 88);
    const lab = after.labs[after.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : after.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.flags["agi-candidate"] = true;

    const plain = calculateValuationTarget(
      before,
      content,
      before.run.playerLabId,
    ).targetMillions;
    const repriced = calculateValuationTarget(
      after,
      content,
      after.run.playerLabId,
    ).targetMillions;
    expect(repriced).toBeGreaterThan(plain * 2);
  });

  it("never reads hidden model truth: changing trueCapability alone moves nothing", () => {
    const baseline = mutable(newState());
    const hidden = mutable(newState());
    const lab = hidden.labs[hidden.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : hidden.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    for (const key of Object.keys(
      model.trueCapability,
    ) as (keyof typeof model.trueCapability)[]) {
      model.trueCapability[key] = rating(99);
    }
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(100);

    expect(
      calculateValuationTarget(hidden, content, hidden.run.playerLabId).targetMillions,
    ).toBeCloseTo(
      calculateValuationTarget(baseline, content, baseline.run.playerLabId)
        .targetMillions,
      6,
    );
  });

  it("takes a haircut from disclosed incidents", () => {
    const clean = mutable(newState());
    const scarred = mutable(newState());
    const lab = scarred.labs[scarred.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (modelId === undefined) throw new Error("fixture missing");
    scarred.incidents.push({
      key: "valuation-incident",
      modelId,
      occurredAt: scarred.run.tick,
      observedSeverity: rating(90),
      category: "critical",
      contained: false,
      catastropheLegal: false,
      audit: ["fixture"],
    });
    expect(
      calculateValuationTarget(scarred, content, scarred.run.playerLabId)
        .haircutMultiplier,
    ).toBeLessThan(
      calculateValuationTarget(clean, content, clean.run.playerLabId).haircutMultiplier,
    );
  });

  it("applies a large immediate shock and sustained haircut after a critical incident", () => {
    const seeded = advanceOneTick(newState(), content).state;
    const clean = mutable(seeded);
    const scarred = mutable(seeded);
    const cleanLab = clean.labs[clean.run.playerLabId];
    const scarredLab = scarred.labs[scarred.run.playerLabId];
    const modelId = scarredLab?.models.currentModelId;
    if (
      cleanLab?.finance.valuation === undefined ||
      scarredLab?.finance.valuation === undefined ||
      modelId === undefined
    ) {
      throw new Error("valuation fixture missing");
    }
    for (const lab of [cleanLab, scarredLab]) {
      const valuation = lab.finance.valuation;
      if (valuation === undefined) throw new Error("valuation fixture missing");
      valuation.markMillions = 100_000;
      valuation.previousMarkMillions = 100_000;
      valuation.peakMarkMillions = 100_000;
    }
    scarred.incidents.push({
      key: "critical-market-shock",
      modelId,
      occurredAt: scarred.run.tick,
      observedSeverity: rating(84),
      category: "critical",
      contained: false,
      catastropheLegal: false,
      audit: ["fixture"],
    });

    expect(
      calculateValuationTarget(scarred, content, scarred.run.playerLabId)
        .haircutMultiplier,
    ).toBeCloseTo(0.58, 8);

    const cleanTx = createTransaction(clean);
    const scarredTx = createTransaction(scarred);
    advanceValuations(cleanTx, content, new RandomOracleV1(clean.run.seed));
    advanceValuations(scarredTx, content, new RandomOracleV1(scarred.run.seed));
    const cleanMark =
      cleanTx.read().labs[clean.run.playerLabId]?.finance.valuation?.markMillions;
    const scarredMark =
      scarredTx.read().labs[scarred.run.playerLabId]?.finance.valuation?.markMillions;
    if (cleanMark === undefined || scarredMark === undefined) {
      throw new Error("valuation result missing");
    }
    expect(scarredMark).toBeLessThan(cleanMark * 0.55);
  });

  it("remembers the peak mark even after the market gives it back", () => {
    const first = advanceOneTick(newState(), content).state;
    const peaked = mutable(first);
    const lab = peaked.labs[peaked.run.playerLabId];
    if (lab?.finance.valuation === undefined) throw new Error("valuation missing");
    lab.finance.valuation.markMillions = 900_000;
    lab.finance.valuation.peakMarkMillions = 900_000;

    // Collapse the lab: a severe incident and no capability to price.
    const modelId = lab.models.currentModelId;
    if (modelId === undefined) throw new Error("fixture missing");
    peaked.incidents.push({
      key: "collapse",
      modelId,
      occurredAt: peaked.run.tick,
      observedSeverity: rating(80),
      category: "critical",
      contained: false,
      catastropheLegal: false,
      audit: ["fixture"],
    });
    const after = advanceOneTick(peaked, content).state;
    const valuation = after.labs[after.run.playerLabId]?.finance.valuation;
    expect(valuation?.markMillions).toBeLessThan(900_000);
    expect(valuation?.peakMarkMillions).toBe(900_000);
  });

  it("seeds and then advances a mark deterministically across ticks", () => {
    const first = advanceOneTick(newState(), content).state;
    const seeded = first.labs[first.run.playerLabId]?.finance.valuation;
    expect(seeded?.markMillions).toBeGreaterThan(0);

    const second = advanceOneTick(first, content).state;
    const replay = advanceOneTick(first, content).state;
    expect(second.labs[second.run.playerLabId]?.finance.valuation?.markMillions).toBe(
      replay.labs[replay.run.playerLabId]?.finance.valuation?.markMillions,
    );
  });
});

describe("rival reported valuations", () => {
  it("buckets coarsely and holds the offset steady within a quarter", () => {
    const state = mutable(newState());
    const rivalId = Object.keys(state.world.rivals).sort()[0];
    if (rivalId === undefined) throw new Error("no rival in fixture");
    const oracle = new RandomOracleV1(state.run.seed);

    state.run.tick = tick(3);
    const earlyQuarter = reportedRivalValuation(
      state,
      content,
      rivalId as never,
      40,
      oracle,
    );
    state.run.tick = tick(10);
    const lateQuarter = reportedRivalValuation(
      state,
      content,
      rivalId as never,
      40,
      oracle,
    );
    // Same quarter: the rumour has not been re-drawn.
    expect(lateQuarter.label).toBe(earlyQuarter.label);
    expect(earlyQuarter.highMillions).toBeGreaterThan(earlyQuarter.lowMillions);
  });

  it("narrows the band as intelligence improves", () => {
    const state = newState();
    const rivalId = Object.keys(state.world.rivals).sort()[0];
    if (rivalId === undefined) throw new Error("no rival in fixture");
    const oracle = new RandomOracleV1(state.run.seed);
    const blind = reportedRivalValuation(state, content, rivalId as never, 0, oracle);
    const informed = reportedRivalValuation(
      state,
      content,
      rivalId as never,
      100,
      oracle,
    );
    const width = (band: { lowMillions: number; highMillions: number }): number =>
      band.highMillions / Math.max(1, band.lowMillions);
    expect(width(informed)).toBeLessThanOrEqual(width(blind));
  });
});

describe("valuation formatting", () => {
  it("uses compact money notation across magnitudes", () => {
    expect(formatValuation(180)).toBe("$180M");
    expect(formatValuation(4_200)).toBe("$4.2B");
    expect(formatValuation(25_000)).toBe("$25B");
    expect(formatValuation(1_100_000)).toBe("$1.1T");
    expect(formatValuation(158_297_465.14)).toBe("$158.3T");
    expect(formatValuation(1_100_000_000)).toBe("$1.1Q");
    expect(formatValuation(-4_200)).toBe("−$4.2B");
    expect(formatValuation(0.66)).toBe("$0.66M");
  });

  it("steps exactly 1000x per rung, on values held in millions", () => {
    // These boundaries are load-bearing for the endgame headline: a confirmed
    // AGI candidate is repriced into quadrillions, so an off-by-1000 anywhere in
    // the ladder would misprice the moment the whole run is about, and would be
    // easy to introduce and hard to notice. Every rung is asserted on both
    // sides of its threshold.
    expect(formatValuation(999)).toBe("$999M");
    expect(formatValuation(1_000)).toBe("$1B");

    expect(formatValuation(999_999)).toBe("$1000B");
    expect(formatValuation(1_000_000)).toBe("$1T");

    // A thousand trillion is one quadrillion, and the rung turns over there.
    expect(formatValuation(999_999_999)).toBe("$1000T");
    expect(formatValuation(1_000_000_000)).toBe("$1Q");

    expect(formatValuation(6_660_000_000)).toBe("$6.66Q");
  });

  it("labels market mood from the weekly move", () => {
    expect(marketMood(110, 100)).toBe("rerating");
    expect(marketMood(100, 100)).toBe("steady");
    expect(marketMood(90, 100)).toBe("repricing");
  });

  it("buckets coarsely without collapsing distinct labs together", () => {
    // Each bucket is its own step; nothing lands between decades.
    for (const value of [1_100, 2_900, 6_100, 9_400, 47, 780_000]) {
      const bucketed = bucketValuation(value);
      expect(bucketed).toBeGreaterThan(0);
      expect(bucketValuation(bucketed)).toBe(bucketed);
      // Coarse: never more than ~25% away from the true figure.
      expect(Math.abs(bucketed - value) / value).toBeLessThan(0.3);
    }
    // Distinct magnitudes stay distinct.
    expect(bucketValuation(1_100)).not.toBe(bucketValuation(2_900));
    expect(bucketValuation(2_900)).not.toBe(bucketValuation(6_100));
  });
});
