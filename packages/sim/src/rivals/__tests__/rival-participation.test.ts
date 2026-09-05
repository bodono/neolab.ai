import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import {
  LAB_MATURITY_STAGE_FLAG,
  PROGRESSIVE_CAMPAIGN_FLAG,
} from "../../campaign/lab-maturity.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { accrueWeeklyUsage, settleWorldMarketCycle } from "../../market/market.ts";
import type { LabId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, fraction, gpuCount, rating, tick } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { advancePaperRace } from "../../research/papers.ts";
import { advanceRivalTalentMoves, updateRivalQuarterPlans } from "../policy.ts";
import { advanceRivalResearch, calculateRivalProgramResearch } from "../research.ts";
import { projectRivalPublicSignals } from "../signals.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const backprop = contentId("base:paper.backpropagation");
const architectures = contentId("base:domain.architectures");
const optimisation = contentId("base:domain.optimisation-scaling");

function newState(): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
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

function advance(state: GameState, weeks: number): GameState {
  let current = state;
  for (let index = 0; index < weeks; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function rivalIds(state: Readonly<GameState>): LabId[] {
  return Object.keys(state.world.rivals).sort() as LabId[];
}

function unlockBackpropForEveryLab(state: GameState): GameState {
  const draft = mutable(state);
  const paper = content.papers.definitions[backprop];
  if (paper === undefined) throw new Error("Backprop paper missing");
  for (const labId of draft.world.paperRace.labOrder) {
    const lab = draft.labs[labId as LabId];
    if (lab === undefined) continue;
    const architectureState = lab.research.domains[architectures];
    const optimisationState = lab.research.domains[optimisation];
    if (architectureState === undefined || optimisationState === undefined) {
      throw new Error(`Missing paper research programmes for ${labId}`);
    }
    architectureState.level = rating(paper.breakthroughRequirement.level);
    optimisationState.level = rating(3);
  }
  return draft;
}

describe("canonical rival participation", () => {
  it("uses all five labs in the seeded level-gated paper race", () => {
    const state = unlockBackpropForEveryLab(newState());
    expect(state.world.paperRace.labOrder).toHaveLength(5);
    expect(new Set(state.world.paperRace.labOrder)).toEqual(
      new Set([state.run.playerLabId, ...rivalIds(state)]),
    );

    const tx = createTransaction(state);
    const checks = advancePaperRace(tx, content, new RandomOracleV1(state.run.seed));
    const after = tx.commit({ description: "canonical paper race" }).state;

    for (const labId of rivalIds(state)) {
      expect(
        checks.some(
          (line) =>
            line.labId === labId &&
            line.paperId === backprop &&
            line.requiredLevel ===
              content.papers.definitions[backprop]?.breakthroughRequirement.level &&
            line.probability > 0,
        ),
      ).toBe(true);
      expect(after.labs[labId]?.research.paperProgress).toEqual({});
    }
    expect(after.world.paperRace.rival.paperProgress).toEqual({});
  });

  it("advances rival capability and safety domains instead of freezing prerequisites", () => {
    const before = newState();
    const after = advance(before, 1);
    for (const labId of rivalIds(before)) {
      expect(
        Object.values(after.labs[labId]?.research.domains ?? {}).some(
          (domain) => domain.totalResearchPoints > 0,
        ),
      ).toBe(true);
      expect(
        Object.values(after.labs[labId]?.research.safetyPrograms ?? {}).some(
          (program) => program.totalResearchPoints > 0,
        ),
      ).toBe(true);
    }
  });

  it("does not let hidden player safety state alter rival paper production", () => {
    const baseline = unlockBackpropForEveryLab(newState());
    const changed = mutable(baseline);
    const player = changed.labs[changed.run.playerLabId];
    if (player === undefined) throw new Error("player lab missing");
    player.safety.safetyCulture = rating(0);
    player.safety.alignmentScience = rating(100);
    player.safety.evalQuality = rating(0);
    player.safety.controlTheory = rating(100);
    player.safety.practicalControlStrength = rating(0);
    player.safety.securityPosture = rating(100);
    player.organisation.hiddenInternalCandour = rating(0);

    const rivalProgress = (state: GameState) => {
      const tx = createTransaction(state);
      return advancePaperRace(tx, content, new RandomOracleV1(state.run.seed))
        .filter((line) => state.world.rivals[line.labId as LabId] !== undefined)
        .map((line) => ({ ...line }))
        .sort((left, right) =>
          `${left.labId}/${left.paperId}`.localeCompare(
            `${right.labId}/${right.paperId}`,
          ),
        );
    };
    expect(rivalProgress(changed)).toEqual(rivalProgress(baseline));
    const domainProgress = (state: GameState) => {
      const tx = createTransaction(state);
      return advanceRivalResearch(tx, content, new RandomOracleV1(state.run.seed));
    };
    expect(domainProgress(changed)).toEqual(domainProgress(baseline));
  });

  it("has no player-relative rubber band in rival RP inputs", () => {
    const baseline = newState();
    const changed = mutable(baseline);
    const player = changed.labs[changed.run.playerLabId];
    const playerModelId = player?.models.currentModelId;
    const playerModel =
      playerModelId === undefined ? undefined : changed.models[playerModelId];
    const rivalLabId = rivalIds(baseline)[0];
    const programId = Object.keys(content.research.capabilityDomains).sort()[0];
    if (
      player === undefined ||
      playerModel === undefined ||
      rivalLabId === undefined ||
      programId === undefined
    ) {
      throw new Error("rubber-band fixture missing");
    }
    player.finance.cash = cashMillions(10_000);
    player.aura.spendable = 100;
    player.aura.lifetime = 100;
    for (const lot of player.compute.lots) lot.physicalCount = gpuCount(1_000_000);
    for (const domain of Object.values(player.research.domains)) {
      domain.level = rating(100);
      domain.levelProgressRp = 0;
      domain.totalResearchPoints = 1_000_000;
    }
    for (const key of Object.keys(playerModel.trueCapability) as Array<
      keyof typeof playerModel.trueCapability
    >) {
      playerModel.trueCapability[key] = rating(100);
    }
    const oracle = new RandomOracleV1(baseline.run.seed);

    expect(
      calculateRivalProgramResearch(
        changed,
        content,
        rivalLabId,
        contentId(programId),
        oracle,
      ),
    ).toEqual(
      calculateRivalProgramResearch(
        baseline,
        content,
        rivalLabId,
        contentId(programId),
        oracle,
      ),
    );
  });

  it("settles every live lab from one order-independent market snapshot", () => {
    const accrue = (state: GameState): GameState => {
      const tx = createTransaction(state);
      for (let week = 0; week < 4; week += 1) {
        for (const labId of Object.keys(tx.read().labs).sort() as LabId[]) {
          accrueWeeklyUsage(tx, content, labId);
        }
      }
      return tx.commit({ description: "accrue world market" }).state;
    };
    const accrued = accrue(newState());
    const reordered = mutable(accrued);
    reordered.labs = Object.fromEntries(Object.entries(reordered.labs).reverse());

    const settle = (state: GameState) => {
      const tx = createTransaction(state);
      settleWorldMarketCycle(tx, content, tick(4));
      const after = tx.commit({ description: "settle world market" }).state;
      return Object.fromEntries(
        Object.keys(after.labs)
          .sort()
          .map((labId) => [labId, after.labs[labId as LabId]?.market]),
      );
    };

    expect(settle(reordered)).toEqual(settle(accrued));
    for (const market of Object.values(settle(accrued))) {
      expect(market?.weeksAccruedThisCycle).toBe(0);
      expect(
        Object.values(market?.segments ?? {}).some(
          (segment) => segment.lastCycleRequestedUsage > 0,
        ),
      ).toBe(true);
    }
  });

  it("starts an annual talent approach through the ordinary Stage 4 poaching chain", () => {
    const draft = mutable(advance(newState(), 52));
    const visibleCandidates = new Set(draft.talentMarket.visibleResearcherIds);
    const researcher = Object.values(draft.researchers).find(
      (candidate) => !visibleCandidates.has(candidate.id),
    );
    const raiderId = rivalIds(draft).sort(
      (left, right) =>
        (draft.world.rivals[right]?.personality.talentAggression ?? 0) -
        (draft.world.rivals[left]?.personality.talentAggression ?? 0),
    )[0];
    if (researcher === undefined || raiderId === undefined) {
      throw new Error("talent raid fixture missing");
    }
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.employerLabId = draft.run.playerLabId;
    draft.labs[draft.run.playerLabId]?.roster.researcherIds.push(researcher.id);
    for (const strategy of Object.values(draft.world.rivals)) {
      strategy.currentPlanId = "frontier-training";
    }

    const tx = createTransaction(draft);
    advanceRivalTalentMoves(tx, content, new RandomOracleV1(draft.run.seed));
    const result = tx.commit({ description: "rival talent raid" });

    expect(result.state.researchers[researcher.id]?.poaching).toMatchObject({
      rivalLabId: raiderId,
      stage: "rumour",
      signalledAt: 52,
      counterofferAt: 54,
      resolvesAt: 56,
    });
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "researcher-poaching-rumour",
        rivalLabId: raiderId,
      }),
    );
    expect(
      Object.values(result.state.world.rivals).every(
        (strategy) => strategy.currentPlanId !== "talent-raid",
      ),
    ).toBe(true);
  });

  it("holds talent raids until the progressive unlock chapters are complete", () => {
    const draft = mutable(advance(newState(), 52));
    const visibleCandidates = new Set(draft.talentMarket.visibleResearcherIds);
    const researcher = Object.values(draft.researchers).find(
      (candidate) => !visibleCandidates.has(candidate.id),
    );
    const raiderId = rivalIds(draft)[0];
    const playerLab = draft.labs[draft.run.playerLabId];
    if (researcher === undefined || raiderId === undefined || playerLab === undefined) {
      throw new Error("protected talent raid fixture missing");
    }
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.employerLabId = draft.run.playerLabId;
    playerLab.roster.researcherIds.push(researcher.id);
    playerLab.flags[PROGRESSIVE_CAMPAIGN_FLAG] = true;
    playerLab.flags[LAB_MATURITY_STAGE_FLAG] = "lab";
    for (const strategy of Object.values(draft.world.rivals)) {
      strategy.currentPlanId =
        strategy.labId === raiderId ? "talent-raid" : "balanced-research";
    }

    const protectedTx = createTransaction(draft);
    advanceRivalTalentMoves(protectedTx, content, new RandomOracleV1(draft.run.seed));
    const protectedState = protectedTx.commit({
      description: "progressive opening blocks talent raid",
    }).state;
    expect(protectedState.researchers[researcher.id]?.poaching).toBeUndefined();

    const frontierDraft = mutable(protectedState);
    const frontierLab = frontierDraft.labs[frontierDraft.run.playerLabId];
    if (frontierLab === undefined) throw new Error("frontier lab disappeared");
    frontierLab.flags[LAB_MATURITY_STAGE_FLAG] = "frontier";
    for (const strategy of Object.values(frontierDraft.world.rivals)) {
      strategy.currentPlanId = "frontier-training";
    }
    const frontierTx = createTransaction(frontierDraft);
    advanceRivalTalentMoves(
      frontierTx,
      content,
      new RandomOracleV1(frontierDraft.run.seed),
    );
    const frontierState = frontierTx.commit({
      description: "full game permits talent raid",
    }).state;
    expect(frontierState.researchers[researcher.id]?.poaching).toMatchObject({
      stage: "rumour",
    });
  });

  it("limits talent raids to one annual approach and protects recent targets", () => {
    const draft = mutable(advance(newState(), 52));
    const visibleCandidates = new Set(draft.talentMarket.visibleResearcherIds);
    const researchers = Object.values(draft.researchers)
      .filter((candidate) => !visibleCandidates.has(candidate.id))
      .slice(0, 3);
    if (researchers.length < 3) throw new Error("talent raid fixtures missing");
    for (const researcher of researchers) {
      researcher.status = "employed";
      researcher.housing = "housed";
      researcher.employerLabId = draft.run.playerLabId;
      draft.labs[draft.run.playerLabId]?.roster.researcherIds.push(researcher.id);
    }
    const recentResearcher = researchers[0];
    const raiderId = rivalIds(draft)[0];
    if (recentResearcher === undefined || raiderId === undefined) {
      throw new Error("talent raid fixtures missing");
    }
    recentResearcher.poaching = {
      id: "run:people:recent-poaching",
      rivalLabId: raiderId,
      stage: "resolved",
      signalledAt: tick(20),
      counterofferAt: tick(22),
      resolvesAt: tick(24),
      rivalOfferStrength: 60,
      playerRetentionStrength: 0,
      departureProbability: fraction(0.5),
      draw: fraction(0.8),
      outcome: "stayed",
      resolvedAt: tick(24),
    };
    for (const strategy of Object.values(draft.world.rivals)) {
      strategy.currentPlanId = "talent-raid";
    }

    const tx = createTransaction(draft);
    advanceRivalTalentMoves(tx, content, new RandomOracleV1(draft.run.seed));
    const result = tx.commit({ description: "limited talent raid" }).state;
    const activeApproaches = researchers.filter(
      (researcher) => result.researchers[researcher.id]?.poaching?.stage === "rumour",
    );

    expect(activeApproaches).toHaveLength(1);
    expect(result.researchers[recentResearcher.id]?.poaching?.stage).toBe("resolved");
  });

  it("generates benchmark signals whose visible error narrows with intelligence", () => {
    const draft = mutable(advance(newState(), 12));
    draft.run.tick = tick(12);
    draft.run.calendar = calendarFromTick(12);
    const signalCountBefore = draft.world.rivalSignals.length;
    const tx = createTransaction(draft);
    updateRivalQuarterPlans(tx, content, new RandomOracleV1(draft.run.seed));
    const after = tx.commit({ description: "quarterly rival signals" }).state;
    expect(after.world.rivalSignals).toHaveLength(signalCountBefore + 4);

    const signal = after.world.rivalSignals[signalCountBefore];
    if (signal === undefined) throw new Error("benchmark signal missing");
    const signalOwner = after.labs[signal.labId];
    const signalOwnerName =
      signalOwner === undefined
        ? undefined
        : content.labs[signalOwner.definitionId]?.displayName;
    expect(signalOwnerName).toBeDefined();
    expect(signal.summary).toContain(`${signalOwnerName} reported`);
    expect(signal.summary).not.toContain("run:lab:rival:");
    const low = projectRivalPublicSignals(after, { [signal.labId]: 0 }).find(
      (candidate) => candidate.id === signal.id,
    );
    const high = projectRivalPublicSignals(after, { [signal.labId]: 100 }).find(
      (candidate) => candidate.id === signal.id,
    );
    if (low === undefined || high === undefined) throw new Error("signal view missing");
    expect(low.estimateRange[1] - low.estimateRange[0]).toBeGreaterThan(
      high.estimateRange[1] - high.estimateRange[0],
    );
    expect(high.confidence).toBe("high");
    expect(low).not.toHaveProperty("actualValue");
    expect(low).not.toHaveProperty("noiseUnit");

    const laterQuarter = mutable(after);
    laterQuarter.run.tick = tick(25);
    laterQuarter.run.calendar = calendarFromTick(25);
    const repeat = createTransaction(laterQuarter);
    updateRivalQuarterPlans(repeat, content, new RandomOracleV1(laterQuarter.run.seed));
    const repeated = repeat.commit({ description: "repeat benchmark subjects" }).state;
    expect(repeated.world.rivalSignals).toHaveLength(after.world.rivalSignals.length);
  });
});
