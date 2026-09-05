import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import { quoteGpuPurchase } from "../../compute/gpu-market.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { applyEffect } from "../../engine/effect-executor.ts";
import { rivalFacilityCompleteFlag } from "../../facilities/facilities.ts";
import type { GameCommand } from "../../commands/types.ts";
import type { GameState } from "../../model/state.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { cashMillions, rating } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { GpuLotId, LabId } from "../../model/ids.ts";
import { gpuCount, tick } from "../../model/units.ts";
import { calendarFromTick } from "../../model/state.ts";
import {
  advanceRivalTalentMoves,
  chooseRivalFleetCommand,
  createRivalDecisionContext,
  queueRivalWeeklyCommands,
  RIVAL_FRONTIER_TRAINING_CAPABILITY,
  rivalFleetTargetEraGpuEquivalents,
  RIVAL_MAX_GPU_ORDER_THOUSANDS,
  RIVAL_SCALING_TRAINING_CAPABILITY,
  rivalPreCandidateTrainingCapabilityTarget,
  rivalPostTrainingCooldownWeeks,
  rivalTrainingDurationWeeks,
  rivalTrainingIntervalWeeks,
  WeightedUtilityRivalPolicy,
  type RivalDecisionContext,
} from "../policy.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

type DeepContextKeys<T> = T extends object
  ? keyof T | DeepContextKeys<T[keyof T]>
  : never;
type ForbiddenContextKey = Extract<
  DeepContextKeys<RivalDecisionContext>,
  | "player"
  | "playerLab"
  | "playerLabId"
  | "hiddenSafety"
  | "trueCapability"
  | "trueAlignment"
  | "corrigibility"
  | "situationalAwareness"
  | "deceptiveCapability"
>;
const RIVAL_CONTEXT_HAS_NO_PLAYER_HIDDEN_KEYS: [ForbiddenContextKey] extends [never]
  ? true
  : never = true;

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

function rivalIds(state: GameState) {
  return Object.keys(state.world.rivals).sort() as (keyof typeof state.labs)[];
}

function withSolventPlayer(state: GameState): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const player = draft.labs[draft.run.playerLabId];
  if (player === undefined) throw new Error("Player lab fixture missing");
  player.finance.cash = cashMillions(1_000);
  return draft;
}

describe("weighted utility rival policy", () => {
  it("does not finance a late GPU order to its exact shortfall", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const labId = rivalIds(state)[0];
    const lab = labId === undefined ? undefined : state.labs[labId];
    if (labId === undefined || lab === undefined) {
      throw new Error("rival capital fixture missing");
    }
    const lot = lab.compute.lots[0];
    if (lot === undefined) throw new Error("rival GPU lot fixture missing");
    state.run.phase = "frontier";
    state.world.currentGpuGenerationId = contentId("base:gpu.rubin");
    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-4"))] = true;
    lot.generationId = contentId("base:gpu.rubin");
    lot.physicalCount = gpuCount(4_000);
    lab.compute.deliveries = [];
    lab.finance.cash = cashMillions(0);
    lab.flags["rival:last-gpu-order-at"] = -100;

    expect(chooseRivalFleetCommand(state, content, labId, true)).toBeUndefined();
  });

  it("buys the largest affordable tranche instead of waiting for its full target", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const labId = rivalIds(state)[0];
    const lab = labId === undefined ? undefined : state.labs[labId];
    if (labId === undefined || lab === undefined) {
      throw new Error("rival affordable tranche fixture missing");
    }
    const lot = lab.compute.lots[0];
    if (lot === undefined) throw new Error("rival GPU lot fixture missing");
    state.run.phase = "frontier";
    state.world.currentGpuGenerationId = contentId("base:gpu.rubin");
    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-4"))] = true;
    lot.generationId = contentId("base:gpu.rubin");
    lot.physicalCount = gpuCount(4_000);
    lab.compute.deliveries = [];
    lab.flags["rival:last-gpu-order-at"] = -100;

    const tenUnitQuote = quoteGpuPurchase(
      state,
      content,
      labId,
      contentId("base:gpu.rubin"),
      10,
    );
    lab.finance.cash = cashMillions(tenUnitQuote.upfrontCostMillions);

    expect(chooseRivalFleetCommand(state, content, labId, true)).toMatchObject({
      kind: "buy-gpus",
      generationId: contentId("base:gpu.rubin"),
      thousandUnits: 10,
    });
  });

  it("paces training from each rival's own capability and retains a recovery gap", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    state.run.phase = "frontier";
    const labId = rivalIds(state)[0];
    const strategy = labId === undefined ? undefined : state.world.rivals[labId];
    if (labId === undefined || strategy === undefined) {
      throw new Error("rival pacing fixture missing");
    }

    expect(RIVAL_SCALING_TRAINING_CAPABILITY).toBe(30);
    expect(RIVAL_FRONTIER_TRAINING_CAPABILITY).toBe(60);

    const modelId = state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (model === undefined) throw new Error("rival model fixture missing");
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(20);
    }
    expect(rivalTrainingDurationWeeks(state, labId)).toBe(9);

    strategy.currentPlanId = "frontier-training";
    expect(rivalPostTrainingCooldownWeeks(state, labId)).toBe(6);
    expect(rivalTrainingIntervalWeeks(state, labId)).toBe(27);
    strategy.currentPlanId = "balanced-research";
    expect(rivalPostTrainingCooldownWeeks(state, labId)).toBe(8);
    expect(rivalTrainingIntervalWeeks(state, labId)).toBe(34);
    strategy.currentPlanId = "safety-stand-down";
    expect(rivalPostTrainingCooldownWeeks(state, labId)).toBe(10);
    expect(rivalTrainingIntervalWeeks(state, labId)).toBe(44);

    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(65);
    }
    strategy.currentPlanId = "frontier-training";
    expect(rivalTrainingDurationWeeks(state, labId)).toBe(15);
    expect(rivalTrainingIntervalWeeks(state, labId)).toBe(19);
  });

  it("targets measured pre-candidacy steps instead of leaping directly to FC 100", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const labId = rivalIds(state)[0];
    const strategy = labId === undefined ? undefined : state.world.rivals[labId];
    const modelId =
      labId === undefined ? undefined : state.labs[labId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (labId === undefined || strategy === undefined || model === undefined) {
      throw new Error("rival capability-target fixture missing");
    }

    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(70);
    }
    expect(rivalPreCandidateTrainingCapabilityTarget(state, labId)).toBe(78);

    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(85);
    }
    strategy.personality.raceUrgency = rating(20);
    expect(rivalPreCandidateTrainingCapabilityTarget(state, labId)).toBe(93);
    strategy.personality.raceUrgency = rating(100);
    expect(rivalPreCandidateTrainingCapabilityTarget(state, labId)).toBe(95);

    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(88);
    }
    expect(rivalPreCandidateTrainingCapabilityTarget(state, labId)).toBe(95);
    state.domainLog.push({
      tick: state.run.tick,
      code: `rival-candidate:${labId}:${model.id}`,
    });
    expect(rivalPreCandidateTrainingCapabilityTarget(state, labId)).toBeUndefined();
  });

  it("scales late-era rival fleet targets through the major datacentre capacities", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    state.run.phase = "frontier";
    const targets = [
      ["base:gpu.hopper", 80_000],
      ["base:gpu.blackwell", 250_000],
      ["base:gpu.rubin", 800_000],
      ["base:gpu.markov", 2_500_000],
      ["base:gpu.kolmogorov", 2_500_000],
    ] as const;
    for (const [generationId, expected] of targets) {
      state.world.currentGpuGenerationId = contentId(generationId);
      expect(rivalFleetTargetEraGpuEquivalents(state, true)).toBe(expected);
    }
    expect(RIVAL_MAX_GPU_ORDER_THOUSANDS).toBe(800);
  });

  it("sells the oldest rival hardware before replacing a full 2.5m fleet", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const labId = rivalIds(state)[0];
    const lab = labId === undefined ? undefined : state.labs[labId];
    if (labId === undefined || lab === undefined) {
      throw new Error("rival fleet fixture missing");
    }
    const template = lab.compute.lots[0];
    if (template === undefined) throw new Error("rival GPU lot fixture missing");
    state.run.phase = "frontier";
    state.world.currentGpuGenerationId = contentId("base:gpu.kolmogorov");
    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-5"))] = true;
    lab.finance.cash = cashMillions(1_000_000);
    lab.compute.lots = [
      {
        ...template,
        id: "gpu-lot:test:old" as GpuLotId,
        generationId: contentId("base:gpu.markov"),
        physicalCount: gpuCount(800_000),
      },
      {
        ...template,
        id: "gpu-lot:test:current" as GpuLotId,
        generationId: contentId("base:gpu.kolmogorov"),
        physicalCount: gpuCount(1_700_000),
      },
    ];
    lab.compute.deliveries = [];
    lab.compute.reservations = [];
    lab.flags["rival:last-gpu-order-at"] = -100;

    const retirement = chooseRivalFleetCommand(state, content, labId, true);
    expect(retirement).toMatchObject({
      kind: "sell-gpus",
      generationId: contentId("base:gpu.markov"),
    });
    if (retirement?.kind !== "sell-gpus") {
      throw new Error("expected rival GPU retirement");
    }
    expect(retirement.thousandUnits).toBeGreaterThan(0);
    expect(validateCommand(state, content, retirement).ok).toBe(true);

    const afterSale = applyCommand(state, content, retirement).state;
    const replacement = chooseRivalFleetCommand(afterSale, content, labId, true);
    expect(replacement).toMatchObject({
      kind: "buy-gpus",
      generationId: contentId("base:gpu.kolmogorov"),
      thousandUnits: retirement.thousandUnits,
    });
    if (replacement?.kind !== "buy-gpus") {
      throw new Error("expected rival replacement order");
    }
    const quote = quoteGpuPurchase(
      afterSale,
      content,
      labId,
      replacement.generationId,
      replacement.thousandUnits,
    );
    expect(quote.capacity.projectedOwnedPhysicalGpus).toBeLessThanOrEqual(2_500_000);
    expect(
      quote.blockers.some((blocker) => blocker.includes("Datacentre capacity")),
    ).toBe(false);
  });

  it("actively retires excess GPUs from an already-over-cap rival fleet", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const labId = rivalIds(state)[0];
    const lab = labId === undefined ? undefined : state.labs[labId];
    if (labId === undefined || lab === undefined) {
      throw new Error("rival over-cap fixture missing");
    }
    const template = lab.compute.lots[0];
    if (template === undefined) throw new Error("rival GPU lot fixture missing");
    state.run.phase = "frontier";
    state.world.currentGpuGenerationId = contentId("base:gpu.kolmogorov");
    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-5"))] = true;
    lab.compute.lots = [
      {
        ...template,
        id: "gpu-lot:test:over-cap" as GpuLotId,
        generationId: contentId("base:gpu.kolmogorov"),
        physicalCount: gpuCount(2_600_000),
      },
    ];
    lab.compute.deliveries = [];
    lab.compute.reservations = [];
    lab.flags["rival:last-gpu-order-at"] = -100;

    const retirement = chooseRivalFleetCommand(state, content, labId, true);
    expect(retirement).toMatchObject({
      kind: "sell-gpus",
      generationId: contentId("base:gpu.kolmogorov"),
      thousandUnits: 100,
    });
    if (retirement?.kind !== "sell-gpus") {
      throw new Error("expected excess rival GPU retirement");
    }
    const corrected = applyCommand(state, content, retirement).state;
    const physicalGpus = corrected.labs[labId]?.compute.lots.reduce(
      (sum, lot) => sum + lot.physicalCount,
      0,
    );
    expect(physicalGpus).toBe(2_500_000);
  });

  it("spends the monthly order slot on a retirement, not just on a purchase", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const labId = rivalIds(state)[0];
    const lab = labId === undefined ? undefined : state.labs[labId];
    if (labId === undefined || lab === undefined) {
      throw new Error("rival cadence fixture missing");
    }
    const template = lab.compute.lots[0];
    if (template === undefined) throw new Error("rival GPU lot fixture missing");
    state.run.phase = "frontier";
    state.world.currentGpuGenerationId = contentId("base:gpu.kolmogorov");
    lab.flags[rivalFacilityCompleteFlag(contentId("base:facility.data-centre-5"))] = true;
    lab.compute.lots = [
      {
        ...template,
        id: "gpu-lot:test:cadence" as GpuLotId,
        generationId: contentId("base:gpu.kolmogorov"),
        physicalCount: gpuCount(2_600_000),
      },
    ];
    lab.compute.deliveries = [];
    lab.compute.reservations = [];
    lab.flags["rival:last-gpu-order-at"] = -100;

    expect(chooseRivalFleetCommand(state, content, labId, true)?.kind).toBe("sell-gpus");

    // A retirement opens the campus headroom the replacement purchase needs,
    // so it has to spend the same order slot; otherwise the pair runs on
    // consecutive weeks and outpaces the cadence the gate exists to impose.
    const tx = createTransaction(state);
    queueRivalWeeklyCommands(tx, content);
    const after = tx.read();
    const issued = after.world.rivals[labId]?.weeklyCommands.at(-1);
    expect(issued?.kind).toBe("sell-gpus");
    expect(after.labs[labId]?.flags["rival:last-gpu-order-at"]).toBe(after.run.tick);
  });

  it("instantiates exactly the other four lab definitions with data personalities", () => {
    const state = newState();
    const rivals = rivalIds(state);
    expect(rivals).toHaveLength(4);
    expect(
      Object.values(state.labs).filter((lab) => lab.control === "rival"),
    ).toHaveLength(4);
    expect(
      rivals.map((labId) => state.world.rivals[labId]?.labDefinitionId).sort(),
    ).toEqual(
      Object.keys(content.labs)
        .filter((labId) => labId !== state.labs[state.run.playerLabId]?.definitionId)
        .sort(),
    );
    expect(
      new Set(
        rivals.map((labId) => state.world.rivals[labId]?.personality.safetyCommitment),
      ).size,
    ).toBeGreaterThan(1);
  });

  it("produces ordinary validated command shapes for rival-owned labs", () => {
    const state = newState();
    const labId = rivalIds(state)[0];
    if (labId === undefined) throw new Error("rival fixture missing");
    const context = createRivalDecisionContext(state, content, labId);
    const commands = new WeightedUtilityRivalPolicy().chooseWeeklyCommands(context);
    // Rivals queue exactly one allocation order; the research-focus command
    // is gone with the mechanic (it was a rival-only advantage: no player
    // interface ever existed for it).
    expect(commands.map((command) => command.kind)).toEqual(["set-gpu-allocation"]);
    for (const command of commands) {
      expect(command.meta.issuedBy).toBe("rival");
      expect(validateCommand(state, content, command).ok).toBe(true);
      const forged = {
        ...command,
        meta: { ...command.meta, issuedBy: "player" as const },
      } as GameCommand;
      const validation = validateCommand(state, content, forged);
      if (validation.ok) throw new Error("forged rival command was accepted");
      expect(validation.errors).toContainEqual(
        expect.objectContaining({ code: "not-player-lab" }),
      );
    }
  });

  it("logs weekly commands and the top three quarterly utilities deterministically", () => {
    let state = newState();
    const rivalLabIds = rivalIds(state);
    const first = advanceOneTick(state, content);
    state = first.state;
    expect(
      first.domainEvents.filter((event) => event.kind === "rival-commands-issued"),
    ).toHaveLength(4);
    expect(
      state.run.queuedOrders.every(
        (order) => state.labs[order.labId]?.control === "rival",
      ),
    ).toBe(true);
    for (let week = 1; week < 13; week += 1) {
      state = advanceOneTick(state, content).state;
    }
    for (const labId of rivalLabIds) {
      const strategy = state.world.rivals[labId];
      expect(strategy?.quarterlyDecisions).toHaveLength(1);
      expect(strategy?.quarterlyDecisions[0]?.topPlans).toHaveLength(3);
      expect(strategy?.quarterlyDecisions[0]?.selectedPlanId).toBe(
        strategy?.quarterlyDecisions[0]?.topPlans[0]?.planId,
      );
      expect(strategy?.weeklyCommands.length).toBeGreaterThanOrEqual(2);
    }

    let replay = newState();
    for (let week = 0; week < 13; week += 1) {
      replay = advanceOneTick(replay, content).state;
    }
    expect(replay.world.rivals).toEqual(state.world.rivals);
  });

  it("procures compute and starts successor training through validated shared commands", () => {
    let state = withSolventPlayer(newState());
    const opening = advanceOneTick(state, content);
    state = opening.state;
    expect(
      opening.domainEvents.filter((event) => event.kind === "gpu-order-placed"),
    ).toHaveLength(4);
    for (const labId of rivalIds(state)) {
      expect(state.labs[labId]?.compute.deliveries).toHaveLength(1);
      expect(state.world.rivals[labId]?.weeklyCommands).toContainEqual(
        expect.objectContaining({ kind: "buy-gpus" }),
      );
    }

    const events = [...opening.domainEvents];
    while (state.run.tick <= 45) {
      const result = advanceOneTick(state, content);
      state = result.state;
      events.push(...result.domainEvents);
    }
    const trainingStarts = events.filter((event) => event.kind === "training-started");
    expect(
      new Set(
        trainingStarts.map((event) =>
          event.kind === "training-started" ? event.labId : "unreachable",
        ),
      ).size,
    ).toBe(4);
    for (const labId of rivalIds(state)) {
      expect(
        state.labs[labId]?.finance.ledger.some(
          (entry) =>
            entry.category === "grant" && entry.sourceId.startsWith("rival-capital:"),
        ),
      ).toBe(true);
      expect(
        state.world.rivals[labId]?.weeklyCommands.some(
          (command) => command.kind === "start-training-run",
        ),
      ).toBe(true);
      expect(
        state.labs[labId]?.projects.projectIds.some(
          (projectId) => state.projects[projectId]?.payload.kind === "training",
        ),
      ).toBe(true);
    }
  });

  it("builds a deliberate succession ladder with recovery between runs", () => {
    const opening = createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    );
    const funding = createTransaction(opening);
    applyEffect(
      funding,
      {
        kind: "add-resource",
        subject: { type: "player-lab" },
        resource: "cash",
        amount: 100_000,
      },
      { kind: "system", id: "rival-succession-test" },
    );
    let state = funding.commit({ description: "fund long-horizon test" }).state;
    const attempts = Object.fromEntries(
      rivalIds(state).map((labId) => [labId, 0]),
    ) as Record<LabId, number>;

    while (state.run.tick < 260 && state.run.status === "active") {
      const result = advanceOneTick(state, content);
      for (const event of result.domainEvents) {
        if (event.kind === "training-started" && event.labId in attempts) {
          attempts[event.labId] = (attempts[event.labId] ?? 0) + 1;
        }
      }
      state = result.state;
    }

    expect(state.run.status).toBe("active");
    for (const labId of rivalIds(state)) {
      expect(attempts[labId]).toBeGreaterThanOrEqual(4);
      expect(attempts[labId]).toBeLessThanOrEqual(7);
      expect(state.labs[labId]?.models.modelIds.length).toBeGreaterThanOrEqual(3);
    }
  }, 30_000);

  it("cannot observe or react to the player's hidden model safety", () => {
    expect(RIVAL_CONTEXT_HAS_NO_PLAYER_HIDDEN_KEYS).toBe(true);
    const base = newState();
    const altered = structuredClone(base) as DeepMutable<GameState>;
    const player = altered.labs[altered.run.playerLabId];
    const modelId = player?.models.currentModelId;
    const model = modelId === undefined ? undefined : altered.models[modelId];
    const rivalLabId = rivalIds(base)[0];
    if (model === undefined || rivalLabId === undefined) {
      throw new Error("hidden-information fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.corrigibility = rating(0);
    model.hiddenSafety.situationalAwareness = rating(100);
    model.hiddenSafety.deceptiveCapability = rating(100);

    const baselineContext = createRivalDecisionContext(base, content, rivalLabId);
    const alteredContext = createRivalDecisionContext(altered, content, rivalLabId);
    expect(alteredContext).toEqual(baselineContext);
    expect(JSON.stringify(baselineContext)).not.toMatch(
      /trueAlignment|corrigibility|situationalAwareness|deceptiveCapability|playerLab/,
    );
    const policy = new WeightedUtilityRivalPolicy();
    const random = new RandomOracleV1(base.run.seed);
    expect(policy.chooseQuarterPlan(alteredContext, random)).toEqual(
      policy.chooseQuarterPlan(baselineContext, random),
    );
  });

  it("limits each annual talent raid to one approach, even for a frontier leader", () => {
    const raidTick = 52;
    const staffed = (): DeepMutable<GameState> => {
      const draft = structuredClone(newState()) as DeepMutable<GameState>;
      draft.run.tick = tick(raidTick);
      draft.run.calendar = calendarFromTick(raidTick);
      for (const labId of rivalIds(draft)) {
        const strategy = draft.world.rivals[labId];
        if (strategy === undefined) throw new Error("raid fixture missing");
        strategy.currentPlanId = "talent-raid";
      }
      const roster = draft.labs[draft.run.playerLabId]?.roster.researcherIds;
      if (roster === undefined) throw new Error("roster fixture missing");
      for (const researcher of Object.values(draft.researchers).slice(0, 3)) {
        researcher.status = "employed";
        researcher.housing = "housed";
        researcher.employerLabId = draft.run.playerLabId;
        roster.push(researcher.id);
      }
      for (const labId of Object.keys(draft.labs).sort() as LabId[]) {
        const modelId = draft.labs[labId]?.models.modelIds[0];
        const model = modelId === undefined ? undefined : draft.models[modelId];
        if (model === undefined) throw new Error("lead fixture missing");
        for (const key of Object.keys(
          model.trueCapability,
        ) as (keyof typeof model.trueCapability)[]) {
          model.trueCapability[key] = rating(40);
        }
      }
      return draft;
    };

    const raid = (state: GameState): number => {
      const tx = createTransaction(state);
      advanceRivalTalentMoves(tx, content, new RandomOracleV1(state.run.seed));
      const after = tx.commit({ description: "raid cycle" }).state;
      return Object.values(after.researchers).filter(
        (researcher) => researcher.poaching !== undefined,
      ).length;
    };

    const level = staffed();
    expect(raid(level)).toBe(1);

    const ahead = staffed();
    const modelId = ahead.labs[ahead.run.playerLabId]?.models.modelIds[0];
    const model = modelId === undefined ? undefined : ahead.models[modelId];
    if (model === undefined) throw new Error("lead fixture missing");
    for (const key of Object.keys(
      model.trueCapability,
    ) as (keyof typeof model.trueCapability)[]) {
      model.trueCapability[key] = rating(90);
    }
    // Talent-raid pressure needs a runaway lead, not a formal AGI candidate.
    model.trueCapability.embodiment = rating(79);
    expect(raid(ahead)).toBe(1);
  });

  it("protects a new hire from poaching for their first 52 weeks", () => {
    const staffed = (): DeepMutable<GameState> => {
      const draft = structuredClone(newState()) as DeepMutable<GameState>;
      for (const labId of rivalIds(draft)) {
        const strategy = draft.world.rivals[labId];
        if (strategy === undefined) throw new Error("raid fixture missing");
        strategy.currentPlanId = "talent-raid";
      }
      const researcher = Object.values(draft.researchers)[0];
      const roster = draft.labs[draft.run.playerLabId]?.roster.researcherIds;
      if (researcher === undefined || roster === undefined) {
        throw new Error("new-hire fixture missing");
      }
      researcher.status = "employed";
      researcher.housing = "housed";
      researcher.employerLabId = draft.run.playerLabId;
      researcher.employedAt = tick(0);
      roster.push(researcher.id);
      return draft;
    };

    const raidAt = (week: number) => {
      const state = staffed();
      state.run.tick = tick(week);
      state.run.calendar = calendarFromTick(week);
      const tx = createTransaction(state);
      advanceRivalTalentMoves(tx, content, new RandomOracleV1(state.run.seed));
      return Object.values(tx.commit({ description: "raid cycle" }).state.researchers)[0]
        ?.poaching;
    };

    expect(raidAt(39)).toBeUndefined();
    expect(raidAt(52)).toMatchObject({ stage: "rumour", signalledAt: 52 });
  });

  it("does not poach during an accepted ultimatum settlement", () => {
    const draft = structuredClone(newState()) as DeepMutable<GameState>;
    draft.run.tick = tick(52);
    draft.run.calendar = calendarFromTick(52);
    for (const labId of rivalIds(draft)) {
      const strategy = draft.world.rivals[labId];
      if (strategy === undefined) throw new Error("raid fixture missing");
      strategy.currentPlanId = "talent-raid";
    }
    const researcher = Object.values(draft.researchers)[0];
    const roster = draft.labs[draft.run.playerLabId]?.roster.researcherIds;
    if (researcher === undefined || roster === undefined) {
      throw new Error("protected-settlement fixture missing");
    }
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.employerLabId = draft.run.playerLabId;
    researcher.employedAt = tick(0);
    researcher.ultimatum = {
      id: "ultimatum:protected",
      reason: "quarterly",
      issuedAt: tick(48),
      expiresAt: tick(52),
      status: "accepted",
      response: "accept-conditions",
      resolvedAt: tick(51),
    };
    roster.push(researcher.id);

    const tx = createTransaction(draft);
    advanceRivalTalentMoves(tx, content, new RandomOracleV1(draft.run.seed));
    const protectedState = tx.commit({ description: "protected raid" }).state;
    expect(protectedState.researchers[researcher.id]?.poaching).toBeUndefined();
  });
});
