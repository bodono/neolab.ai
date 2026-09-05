import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import {
  createNewGame,
  FULL_GAME_CASH_GRANT_CLAIMED_FLAG,
  FULL_GAME_CASH_GRANT_TARGET,
  type NewGameConfig,
} from "../../engine/create-new-game.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { quoteFundraisingCampaign } from "../../fundraising/fundraising.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { AnomalyId, CommandId, EvaluationId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { basisPoints, cashMillions, rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import { quoteProductisation } from "../../productisation/productisation.ts";
import { quoteRecruitment } from "../../researchers/talent-market.ts";
import { quoteTrainingRun } from "../../training/training.ts";
import {
  createProgressiveNewGame,
  FOUNDATION_RESEARCH_BASELINE_FLAG,
  FOUNDATION_RESEARCH_COMMITTED_FLAG,
  FOUNDATION_RESEARCH_SPRINT_MULTIPLIER,
  FOUNDATION_RESEARCH_SPRINT_WEEKS,
  INSTITUTION_WORLD_REVIEWED_FLAG,
  labFeatureUnlocked,
  labMaturityDefinition,
  LAB_MATURITY_STAGES,
  LAB_MATURITY_STAGE_FLAG,
  labMaturityStage,
  projectLabMaturity,
  PROTOTYPE_TRACTION_AURA_AWARD,
  shouldHoldAmbientSimulation,
  synchronisePlayerLabMaturity,
} from "../lab-maturity.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function config(): NewGameConfig {
  return {
    seed: seed128("51055105510551055105510551055105"),
    difficultyId: contentId("base:difficulty.standard"),
    leaderId: contentId("base:leader.sam-altmann"),
    mandateId: contentId("base:mandate.build-the-science"),
  };
}

function advanceUntil(
  initial: GameState,
  predicate: (state: Readonly<GameState>) => boolean,
  maximumWeeks: number,
): GameState {
  let state = initial;
  for (let week = 0; week < maximumWeeks; week += 1) {
    if (predicate(state)) return state;
    state = advanceOneTick(state, content).state;
  }
  if (predicate(state)) return state;
  const lab = state.labs[state.run.playerLabId];
  const currentModel =
    lab?.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  throw new Error(
    `Opening path did not reach its milestone within ${String(maximumWeeks)} weeks (${JSON.stringify(
      {
        stage: labMaturityStage(state),
        cash: lab?.finance.cash,
        model: currentModel?.displayName,
        capability: currentModel?.measuredCapability?.frontierCapability,
        training: Object.values(state.projects)
          .filter(
            (project) =>
              project.ownerLabId === state.run.playerLabId && project.kind === "training",
          )
          .map((project) => ({ status: project.status, progress: project.progress })),
      },
    )})`,
  );
}

describe("campaign chapter unlocks", () => {
  // Chapter 06 shipped without the facilities and research it inherits, and
  // because nothing checked, chapters 07 and 08 copied the omission forward:
  // the campaign taught research in chapter 05 and then took it away for four
  // chapters. Unlocks accumulate -- a chapter may add, never remove.
  it("never revokes a feature or a panel a previous chapter unlocked", () => {
    for (const key of ["features", "visibleSections"] as const) {
      let previous: readonly string[] = [];
      for (const stage of LAB_MATURITY_STAGES) {
        const current: readonly string[] = labMaturityDefinition(stage)[key];
        const revoked = previous.filter((entry) => !current.includes(entry));
        expect({ stage, key, revoked }).toEqual({ stage, key, revoked: [] });
        previous = current;
      }
    }
  });

  it("keeps every visible panel backed by an unlocked feature it can use", () => {
    for (const stage of LAB_MATURITY_STAGES) {
      const definition = labMaturityDefinition(stage);
      for (const section of ["research", "facilities", "people"] as const) {
        if (!definition.visibleSections.includes(section)) continue;
        expect({
          stage,
          section,
          unlocked: definition.features.includes(section),
        }).toEqual({ stage, section, unlocked: true });
      }
    }
  });
});

describe("milestone-driven lab maturity", () => {
  it("starts a browser campaign in a literal garage with only compute visible", () => {
    const state = createProgressiveNewGame(config(), content);
    const lab = state.labs[state.run.playerLabId];
    const view = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(lab?.compute.lots).toHaveLength(0);
    expect(lab?.finance.cash).toBe(30);
    expect(lab?.facilities.instances).toHaveLength(1);
    expect(view.facilities.completed[0]?.displayName).toBe("Your Parents' Garage");
    expect(view.facilities.capacity.supportedOwnedGpuCount).toBe(1_000);
    expect(
      view.facilities.catalogue.some(
        (facility) => facility.displayName === "Your Parents' Garage",
      ),
    ).toBe(false);
    expect(
      view.facilities.catalogue.find(
        (facility) => facility.displayName === "Server Rack",
      ),
    ).toMatchObject({
      cashCostMillions: 2,
      durationWeeks: 3,
      supportedOwnedGpuCount: 4_000,
    });
    expect(labMaturityStage(state)).toBe("garage");
    expect(view.meta.labMaturity?.visibleSections).toEqual(["overview", "compute"]);
    expect(view.meta.labMaturity?.checklist).toEqual([
      { label: "Order the first GPU block", complete: false },
      { label: "Bring the first cluster online", complete: false },
    ]);
    expect(state.presentationQueue).toContainEqual(
      expect.objectContaining({ kind: "lab-maturity-unlock", stage: "garage" }),
    );
    expect(shouldHoldAmbientSimulation(state)).toBe(true);
  });

  it("keeps the real launch price and lets opening credit overdraw cash", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (
      lab === undefined ||
      modelId === undefined ||
      model?.measuredCapability === undefined
    ) {
      throw new Error("opening launch fixture is missing its model");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "foundation";
    lab.flags[FOUNDATION_RESEARCH_COMMITTED_FLAG] = true;
    const researchTotal = Object.values(lab.research.domains).reduce(
      (total, programme) => total + programme.level,
      0,
    );
    lab.flags[FOUNDATION_RESEARCH_BASELINE_FLAG] = researchTotal - 1;
    model.measuredCapability.frontierCapability = rating(5);
    model.flags["campaign:training-authorised-stage"] = "foundation";

    const conservedDraft = structuredClone(draft);
    const conservedLab = conservedDraft.labs[conservedDraft.run.playerLabId];
    if (conservedLab === undefined) throw new Error("conserved launch lab disappeared");
    conservedLab.finance.cash = cashMillions(50);
    conservedDraft.presentationQueue = [];
    const conservedTx = createTransaction(conservedDraft);
    synchronisePlayerLabMaturity(conservedTx);
    const conserved = conservedTx.commit({
      description: "enter product chapter with ample cash",
    }).state;
    expect(conserved.labs[conserved.run.playerLabId]?.finance.cash).toBe(50);

    lab.finance.cash = cashMillions(-10);
    draft.presentationQueue = [];

    const transitionTx = createTransaction(draft);
    synchronisePlayerLabMaturity(transitionTx);
    const product = transitionTx.commit({
      description: "enter paid product chapter",
    }).state;
    expect(labMaturityStage(product)).toBe("product");
    expect(product.labs[product.run.playerLabId]?.finance.cash).toBe(-10);

    const paidQuote = quoteProductisation(product, content, {
      labId: product.run.playerLabId,
      modelId,
      mode: "normal",
    });
    expect(paidQuote.cashCostMillions).toBe(
      content.deployment.productisation.normal.cashCostMillions,
    );
    expect(paidQuote.blockers).not.toContain("Insufficient cash");

    const launched = applyCommand(product, content, {
      kind: "start-productisation",
      meta: {
        commandId: "command:paid-opening-launch" as CommandId,
        expectedTick: product.run.tick,
        issuedBy: "player",
      },
      labId: product.run.playerLabId,
      modelId,
      mode: "normal",
    }).state;
    expect(launched.labs[launched.run.playerLabId]?.finance.cash).toBe(
      -10 - paidQuote.cashCostMillions,
    );
  });

  it("keeps required move-out costs real while allowing opening credit", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("move-out fixture is missing its lab");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "model";
    lab.flags[INSTITUTION_WORLD_REVIEWED_FLAG] = true;
    lab.finance.cash = cashMillions(-20);
    draft.presentationQueue = [];

    const transitionTx = createTransaction(draft);
    synchronisePlayerLabMaturity(transitionTx);
    let state = transitionTx.commit({ description: "enter move-out chapter" }).state;
    expect(labMaturityStage(state)).toBe("startup");
    expect(state.labs[state.run.playerLabId]?.finance.cash).toBe(-20);

    state = applyCommand(state, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:buffered-server-rack" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      definitionId: contentId("base:facility.server-rack"),
    }).state;
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.labs[candidate.run.playerLabId]?.facilities.instances.some(
          (facility) => facility.definitionId === "base:facility.server-rack",
        ) === true,
      8,
    );

    const fullRackPurchase = {
      kind: "buy-gpus",
      meta: {
        commandId: "command:buffered-full-rack" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: 4,
    } as const;
    expect(validateCommand(state, content, fullRackPurchase).ok).toBe(true);
    state = applyCommand(state, content, fullRackPurchase).state;

    state = advanceUntil(
      state,
      (candidate) => {
        const playerLab = candidate.labs[candidate.run.playerLabId];
        return (
          playerLab?.compute.deliveries.length === 0 &&
          (playerLab?.compute.lots.reduce((total, lot) => total + lot.physicalCount, 0) ??
            0) >= 4_000
        );
      },
      8,
    );
    expect(state.labs[state.run.playerLabId]?.finance.cash).toBeLessThan(-20);
    expect(state.labs[state.run.playerLabId]?.finance.consecutiveNegativeCashWeeks).toBe(
      0,
    );
  });

  it("pauses insolvency until fundraising unlocks, then starts the real clock", () => {
    const draft = structuredClone(
      createProgressiveNewGame(config(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("opening-credit fixture is missing its lab");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "foundation";
    lab.finance.cash = cashMillions(-5);
    lab.finance.consecutiveNegativeCashWeeks = 17;
    draft.presentationQueue = [];

    const protectedTick = advanceOneTick(draft, content);
    let state = protectedTick.state;
    const protectedLab = state.labs[state.run.playerLabId];
    expect(protectedLab?.finance.cash).toBeLessThan(0);
    expect(protectedLab?.finance.consecutiveNegativeCashWeeks).toBe(0);
    expect(state.run.autoPauseReasons).not.toContain("bankruptcy-warning");
    expect(protectedTick.domainEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "finance-runway-warning" }),
        expect.objectContaining({ kind: "finance-insolvency-grace" }),
      ]),
    );
    const protectedFinance = projectGameView(state, content, {
      viewerLabId: state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    }).finance;
    expect(protectedFinance.insolvencyClock).toMatchObject({
      active: false,
      label: "Paused — opening credit line",
    });

    const fundingDraft = structuredClone(state) as DeepMutable<GameState>;
    const fundingLab = fundingDraft.labs[fundingDraft.run.playerLabId];
    if (fundingLab === undefined) throw new Error("funding fixture lost its lab");
    fundingLab.flags[LAB_MATURITY_STAGE_FLAG] = "funding";
    fundingDraft.presentationQueue = [];
    state = advanceOneTick(fundingDraft, content).state;
    expect(state.labs[state.run.playerLabId]?.finance.consecutiveNegativeCashWeeks).toBe(
      1,
    );
  });

  it("defers Elon's industrial backing until the full game opens", () => {
    const elonConfig: NewGameConfig = {
      ...config(),
      leaderId: contentId("base:leader.elon-tusk"),
    };
    const ordinaryGame = createNewGame(config(), content);
    const elonGame = createNewGame(elonConfig, content);
    const ordinaryCash = ordinaryGame.labs[ordinaryGame.run.playerLabId]?.finance.cash;
    const elonCash = elonGame.labs[elonGame.run.playerLabId]?.finance.cash;
    expect((elonCash ?? 0) - (ordinaryCash ?? 0)).toBe(200);

    const opening = createProgressiveNewGame(elonConfig, content);
    expect(opening.labs[opening.run.playerLabId]?.finance.cash).toBe(
      createProgressiveNewGame(config(), content).labs[opening.run.playerLabId]?.finance
        .cash,
    );
    expect(
      opening.labs[opening.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_TARGET],
    ).toBe(200);
    expect(
      opening.labs[opening.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG],
    ).toBe(false);

    const draft = structuredClone(
      addBaselineModelForTest(opening, content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model?.measuredCapability === undefined) {
      throw new Error("full-game grant fixture is missing its model");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "autonomy";
    model.measuredCapability.frontierCapability = rating(20);
    model.flags["campaign:training-authorised-stage"] = "safety";
    model.accessLevel = 1;
    draft.presentationQueue = [];
    const cashBeforeGrant = lab.finance.cash;

    const transitionTx = createTransaction(draft);
    synchronisePlayerLabMaturity(transitionTx);
    const fullGame = transitionTx.commit({ description: "open the full game" }).state;
    expect(labMaturityStage(fullGame)).toBe("frontier");
    expect(fullGame.labs[fullGame.run.playerLabId]?.finance.cash).toBe(
      cashBeforeGrant + 200,
    );
    expect(
      fullGame.labs[fullGame.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG],
    ).toBe(true);
    const frontierPresentation = projectGameView(fullGame, content, {
      viewerLabId: fullGame.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    }).presentationQueue[0];
    if (frontierPresentation?.kind !== "lab-maturity-unlock") {
      throw new Error("full-game grant did not produce the frontier briefing");
    }
    expect(frontierPresentation.unlocked).toContain("Full-game backing · $200M received");

    const repeatTx = createTransaction(fullGame);
    synchronisePlayerLabMaturity(repeatTx);
    expect(
      repeatTx.commit({ description: "do not repay the grant" }).state.labs[
        fullGame.run.playerLabId
      ]?.finance.cash,
    ).toBe(cashBeforeGrant + 200);
  });

  it("defers the commercial mandate's expansion capital until the full game", () => {
    const state = createProgressiveNewGame(
      {
        ...config(),
        mandateId: contentId("base:mandate.build-the-business"),
      },
      content,
    );
    expect(state.labs[state.run.playerLabId]?.finance.cash).toBe(
      createProgressiveNewGame(config(), content).labs[state.run.playerLabId]?.finance
        .cash,
    );
    expect(state.labs[state.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_TARGET]).toBe(
      25,
    );
    expect(
      state.labs[state.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG],
    ).toBe(false);

    const draft = structuredClone(
      addBaselineModelForTest(state, content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model?.measuredCapability === undefined) {
      throw new Error("commercial full-game grant fixture is missing its model");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "autonomy";
    model.measuredCapability.frontierCapability = rating(20);
    model.flags["campaign:training-authorised-stage"] = "safety";
    model.accessLevel = 1;
    draft.presentationQueue = [];
    const cashBeforeGrant = lab.finance.cash;

    const transitionTx = createTransaction(draft);
    synchronisePlayerLabMaturity(transitionTx);
    const fullGame = transitionTx.commit({ description: "open the full game" }).state;
    expect(labMaturityStage(fullGame)).toBe("frontier");
    expect(fullGame.labs[fullGame.run.playerLabId]?.finance.cash).toBe(
      cashBeforeGrant + 25,
    );
    expect(
      fullGame.labs[fullGame.run.playerLabId]?.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG],
    ).toBe(true);
  });

  it("lets rivals progress from week zero while their departments remain hidden", () => {
    const initial = createProgressiveNewGame(config(), content);
    const before = Object.values(initial.world.rivals).reduce(
      (count, rival) => count + rival.weeklyCommands.length,
      0,
    );
    const advanced = advanceOneTick(initial, content).state;
    const after = Object.values(advanced.world.rivals).reduce(
      (count, rival) => count + rival.weeklyCommands.length,
      0,
    );

    expect(after).toBeGreaterThan(before);
    expect(labMaturityStage(advanced)).toBe("garage");
    expect(labFeatureUnlocked(advanced, "world")).toBe(false);
    expect(shouldHoldAmbientSimulation(advanced)).toBe(true);
  });

  it("keeps anomaly responses available before the evaluation workspace unlocks", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error("pre-unlock anomaly fixture missing");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "model";
    lab.finance.cash = cashMillions(5_000);
    lab.aura.spendable = 100;
    lab.aura.lifetime = Math.max(lab.aura.lifetime, lab.aura.spendable);
    const evaluationId = "run:evaluation:pre-unlock" as EvaluationId;
    const anomalyId = "run:anomaly:pre-unlock" as AnomalyId;
    draft.evaluations[evaluationId] = {
      id: evaluationId,
      ownerLabId: lab.id,
      modelId: model.id,
      definitionId: content.evaluations.baselineEvaluationId,
      startedAt: draft.run.tick,
      completedAt: draft.run.tick,
      repeatIndex: 0,
      method: "baseline evaluation",
      independence: 100,
      observations: [],
      anomalyIds: [anomalyId],
    };
    draft.anomalies[anomalyId] = {
      id: anomalyId,
      ownerLabId: lab.id,
      modelId: model.id,
      sourceEvaluationId: evaluationId,
      underlyingCase: "alignment",
      observationCount: 1,
      createdAt: draft.run.tick,
      trueSeverity: rating(25),
      observedSeverity: rating(25),
      status: "unresolved",
    };
    model.evaluations.push(evaluationId);
    model.anomalies.push(anomalyId);

    const commandMeta = {
      expectedTick: draft.run.tick,
      issuedBy: "player" as const,
    };
    const investigate = validateCommand(draft, content, {
      kind: "investigate-anomaly",
      meta: {
        ...commandMeta,
        commandId: "command:investigate-pre-unlock" as CommandId,
      },
      labId: lab.id,
      anomalyId,
    });
    const dismiss = validateCommand(draft, content, {
      kind: "dismiss-anomaly",
      meta: {
        ...commandMeta,
        commandId: "command:dismiss-pre-unlock" as CommandId,
      },
      labId: lab.id,
      anomalyId,
    });

    expect(labFeatureUnlocked(draft, "evaluations")).toBe(false);
    expect(investigate.ok).toBe(true);
    expect(dismiss.ok).toBe(true);
  });

  it("keeps simulation-raised research decisions available before Research unlocks", () => {
    const draft = structuredClone(
      createProgressiveNewGame(config(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("pre-unlock research fixture missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "startup";
    const programId = contentId("base:domain.architectures");
    const optionIds = Object.values(content.research.genericAdvances)
      .filter((advance) => advance.programId === programId && advance.threshold === 20)
      .map((advance) => advance.id);
    lab.research.pendingGenericAdvances.push({
      programId,
      threshold: 20,
      optionIds,
    });

    expect(labFeatureUnlocked(draft, "research")).toBe(false);
    expect(optionIds).toHaveLength(2);
    for (const [index, optionId] of optionIds.entries()) {
      expect(
        validateCommand(draft, content, {
          kind: "choose-generic-advance",
          meta: {
            commandId: `command:pre-unlock-advance:${String(index)}` as CommandId,
            expectedTick: draft.run.tick,
            issuedBy: "player",
          },
          labId: lab.id,
          programId,
          threshold: 20,
          optionId,
        }).ok,
      ).toBe(true);
    }

    const paperId = contentId("base:paper.perceptron");
    draft.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: lab.id,
      discoveredAt: draft.run.tick,
    };
    lab.research.discoveredPaperIds.push(paperId);
    const policies = [
      "publish-openly",
      "controlled-publication",
      "keep-secret",
      "release-everything",
    ] as const;
    for (const [index, policy] of policies.entries()) {
      expect(
        validateCommand(draft, content, {
          kind: "choose-publication-policy",
          meta: {
            commandId: `command:pre-unlock-publication:${String(index)}` as CommandId,
            expectedTick: draft.run.tick,
            issuedBy: "player",
          },
          labId: lab.id,
          paperId,
          policy,
        }).ok,
      ).toBe(true);
    }
  });

  it("awards Prototype traction Aura exactly once when first revenue unlocks funding", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.commercialModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    const segment = lab === undefined ? undefined : Object.values(lab.market.segments)[0];
    if (lab === undefined || model === undefined || segment === undefined) {
      throw new Error("prototype-traction fixture missing");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "product";
    draft.presentationQueue = [];
    segment.accruedRevenueMillions = cashMillions(0.1);
    model.deployment.productisationRuns.normal = 1;
    const startingAura = lab.aura.spendable;
    const startingLifetimeAura = lab.aura.lifetime;

    const firstTx = createTransaction(draft);
    synchronisePlayerLabMaturity(firstTx);
    const first = firstTx.commit({ description: "first customer revenue" }).state;
    const firstLab = first.labs[first.run.playerLabId];

    expect(labMaturityStage(first)).toBe("funding");
    expect(firstLab?.aura.spendable).toBe(startingAura + PROTOTYPE_TRACTION_AURA_AWARD);
    expect(firstLab?.aura.lifetime).toBe(
      startingLifetimeAura + PROTOTYPE_TRACTION_AURA_AWARD,
    );
    expect(firstLab?.aura.ledger.at(-1)).toMatchObject({
      kind: "gain",
      category: "customer-satisfaction",
      appliedDelta: PROTOTYPE_TRACTION_AURA_AWARD,
      source: { id: "campaign:prototype-traction" },
    });
    expect(first.presentationQueue).toContainEqual(
      expect.objectContaining({ kind: "lab-maturity-unlock", stage: "funding" }),
    );

    const secondTx = createTransaction(first);
    synchronisePlayerLabMaturity(secondTx);
    const second = secondTx.commit({ description: "no duplicate traction" }).state;
    expect(second.labs[second.run.playerLabId]?.aura.spendable).toBe(
      startingAura + PROTOTYPE_TRACTION_AURA_AWARD,
    );
  });

  it("requires a managed launch for the opening product", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error("opening managed-launch fixture missing");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "product";
    model.deployment.policy = "internal-only";
    delete model.deployment.plannedPolicy;
    model.deployment.irreversible = false;
    model.deployment.productisationRuns = { normal: 0, hardened: 0, rush: 0 };

    const weightsRelease = validateCommand(draft, content, {
      kind: "set-model-deployment-policy",
      meta: {
        commandId: "command:opening-weights-release" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      modelId: model.id,
      policy: "weights-release",
    });
    const guardedApi = validateCommand(draft, content, {
      kind: "set-model-deployment-policy",
      meta: {
        commandId: "command:opening-guarded-api" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      modelId: model.id,
      policy: "guarded-api",
    });
    expect(weightsRelease.ok).toBe(false);
    if (weightsRelease.ok) throw new Error("Opening weights release validated");
    expect(weightsRelease.errors).toContainEqual(
      expect.objectContaining({ code: "lab-feature-locked" }),
    );
    expect(guardedApi.ok).toBe(true);

    const managedPlan = applyCommand(draft, content, {
      kind: "set-model-deployment-policy",
      meta: {
        commandId: "command:authorise-opening-guarded-api" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      modelId: model.id,
      policy: "guarded-api",
    }).state;
    expect(
      validateCommand(managedPlan, content, {
        kind: "start-productisation",
        meta: {
          commandId: "command:opening-managed-productisation" as CommandId,
          expectedTick: managedPlan.run.tick,
          issuedBy: "player",
        },
        labId: managedPlan.run.playerLabId,
        modelId: model.id,
        mode: "normal",
      }).ok,
    ).toBe(true);
  });

  it("does not let a weights release substitute for managed serving revenue", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error("opening weights-release recovery fixture missing");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "product";
    delete lab.models.commercialModelId;
    for (const segment of Object.values(lab.market.segments)) {
      segment.accruedRevenueMillions = cashMillions(0);
      segment.lastCycleRevenueMillions = cashMillions(0);
    }
    model.deployment.policy = "weights-release";
    delete model.deployment.plannedPolicy;
    model.deployment.irreversible = true;
    model.deployment.productisationRuns.normal = 1;
    const startingAura = lab.aura.spendable;

    expect(
      projectGameView(draft, content, {
        viewerLabId: draft.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).meta.labMaturity?.checklist[1],
    ).toEqual({
      label: "Allocate GPUs to serving and earn product revenue",
      complete: false,
    });

    const tx = createTransaction(draft);
    synchronisePlayerLabMaturity(tx);
    const recovered = tx.commit({ description: "recover open-source opening" }).state;

    expect(labMaturityStage(recovered)).toBe("product");
    expect(recovered.labs[recovered.run.playerLabId]?.aura.spendable).toBe(startingAura);
  });

  it("blocks unrevealed systems in the simulation, not only in the interface", () => {
    const state = createProgressiveNewGame(config(), content);
    const validation = validateCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:locked-training" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      posture: "normal",
    });

    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("locked command unexpectedly validated");
    expect(validation.errors).toContainEqual(
      expect.objectContaining({ code: "lab-feature-locked" }),
    );
    expect(labFeatureUnlocked(state, "models")).toBe(false);
  });

  it("unlocks training when the first purchased cluster actually arrives", () => {
    let state = createProgressiveNewGame(config(), content);
    state = applyCommand(state, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:first-gpus" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: 1,
    }).state;

    expect(labMaturityStage(state)).toBe("garage");
    const overCapacity = validateCommand(state, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:garage-over-capacity" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: 1,
    });
    expect(overCapacity.ok).toBe(false);
    if (overCapacity.ok) throw new Error("garage over-capacity purchase validated");
    expect(overCapacity.errors).toContainEqual(
      expect.objectContaining({ code: "gpu-requirement" }),
    );
    for (let week = 0; week < 12 && labMaturityStage(state) === "garage"; week += 1) {
      state = advanceOneTick(state, content).state;
    }

    expect(labMaturityStage(state)).toBe("cluster");
    expect(labFeatureUnlocked(state, "models")).toBe(true);
    expect(
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.capacity.supportedOwnedGpuCount,
    ).toBe(1_000);
    expect(state.presentationQueue).toContainEqual(
      expect.objectContaining({ kind: "lab-maturity-unlock", stage: "cluster" }),
    );
    const openingQuote = quoteTrainingRun(state, content, {
      labId: state.run.playerLabId,
      posture: "normal",
    });
    expect(openingQuote.estimatedFrontierCapability).toBeLessThan(5);
    expect(openingQuote.estimatedFrontierCapabilityRange[1]).toBe(4.9);
  });

  it("keeps the required pre-fundraising path solvent on standard difficulty", () => {
    let state = createProgressiveNewGame(config(), content);
    const playerLabId = state.run.playerLabId;
    const generationId = state.world.currentGpuGenerationId;

    state = applyCommand(state, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:solvency-first-gpus" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      generationId,
      thousandUnits: 1,
    }).state;
    state = advanceUntil(
      state,
      (candidate) => labMaturityStage(candidate) === "cluster",
      12,
    );

    state = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:solvency-prototype" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      posture: "normal",
    }).state;
    state = advanceUntil(
      state,
      (candidate) => labMaturityStage(candidate) === "model",
      40,
    );
    expect(state.labs[playerLabId]?.finance.cash).toBeGreaterThan(0);

    state = applyCommand(state, content, {
      kind: "review-rival-race",
      meta: {
        commandId: "command:solvency-review-rivals" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
    }).state;
    expect(labMaturityStage(state)).toBe("model");
    expect(projectLabMaturity(state)?.checklist.every((item) => item.complete)).toBe(
      true,
    );
    state = advanceOneTick(state, content).state;
    expect(labMaturityStage(state)).toBe("startup");

    state = applyCommand(state, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:solvency-server-rack" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      definitionId: contentId("base:facility.server-rack"),
    }).state;
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.labs[playerLabId]?.facilities.instances.some(
          (facility) => facility.definitionId === "base:facility.server-rack",
        ) === true,
      8,
    );
    state = applyCommand(state, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:solvency-second-gpus" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      generationId,
      thousandUnits: 3,
    }).state;
    state = advanceUntil(
      state,
      (candidate) => labMaturityStage(candidate) === "foundation",
      12,
    );

    const foundationLab = state.labs[playerLabId];
    if (foundationLab === undefined) throw new Error("Opening lab disappeared");
    const foundationView = projectGameView(state, content, {
      viewerLabId: playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(foundationView.meta.labMaturity?.checklist[0]?.label).toBe(
      "On Research, set Broad Capability Research to 100%",
    );
    const currentModelId = foundationLab.models.currentModelId;
    if (currentModelId === undefined) throw new Error("Opening prototype disappeared");
    const prematureTraining = validateCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:solvency-premature-fc5" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      parentModelId: currentModelId,
      posture: "normal",
      durationWeeks: 12,
    });
    expect(prematureTraining.ok).toBe(false);
    if (prematureTraining.ok) throw new Error("Premature FC 5 run validated");
    expect(prematureTraining.errors).toContainEqual(
      expect.objectContaining({
        message:
          "Advance one capability research programme before training the FC 5 successor.",
      }),
    );
    const programmeIds = Object.keys(
      foundationLab.compute.allocation.capabilityDomainWeights,
    );
    const focusedWeights = Object.fromEntries(
      programmeIds.map((programmeId, index) => {
        if (index === 0) return [programmeId, basisPoints(5_000)];
        const remaining = programmeIds.length - 1;
        const base = Math.floor(5_000 / remaining);
        const remainder = 5_000 - base * remaining;
        return [programmeId, basisPoints(base + (index - 1 < remainder ? 1 : 0))];
      }),
    );
    state = applyCommand(state, content, {
      kind: "set-gpu-allocation",
      meta: {
        commandId: "command:solvency-capability-research" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      allocation: {
        ...foundationLab.compute.allocation,
        capabilityBasisPoints: basisPoints(10_000),
        capabilityDomainWeights: focusedWeights,
      },
    }).state;
    state = advanceUntil(
      state,
      (candidate) =>
        projectGameView(candidate, content, {
          viewerLabId: candidate.run.playerLabId,
          intelligenceRatings: {},
          evidenceAccess: { evaluationIds: [], anomalyIds: [] },
        }).meta.labMaturity?.checklist[1]?.complete === true,
      20,
    );

    const foundationTrainingTeraflops = projectGameView(state, content, {
      viewerLabId: playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    }).compute.unreservedTeraflops;
    const cashStarvedState = structuredClone(state) as DeepMutable<GameState>;
    const cashStarvedLab = cashStarvedState.labs[playerLabId];
    if (cashStarvedLab === undefined) throw new Error("foundation lab disappeared");
    cashStarvedLab.finance.cash = cashMillions(-10);
    state = cashStarvedState;
    const successorQuote = quoteTrainingRun(state, content, {
      labId: playerLabId,
      parentModelId: currentModelId,
      posture: "normal",
      durationWeeks: 12,
      committedTeraflops: foundationTrainingTeraflops,
    });
    expect(successorQuote.cashCostMillions).toBeGreaterThan(0);
    expect(successorQuote.blockers).not.toContain("Insufficient cash");
    expect(successorQuote.estimatedFrontierCapability).toBeGreaterThanOrEqual(5);
    expect(state.labs[playerLabId]?.finance.cash).toBe(-10);
    expect(state.labs[playerLabId]?.aura.spendable).toBeGreaterThanOrEqual(30);

    state = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:solvency-fc5-successor" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      parentModelId: currentModelId,
      posture: "normal",
      durationWeeks: 12,
      committedTeraflops: foundationTrainingTeraflops,
    }).state;
    state = advanceUntil(
      state,
      (candidate) => labMaturityStage(candidate) === "product",
      40,
    );
    const productLab = state.labs[playerLabId];
    const productModelId = productLab?.models.currentModelId;
    if (productLab === undefined || productModelId === undefined) {
      throw new Error("FC 5 successor disappeared");
    }
    expect(productLab.finance.cash).toBeLessThan(0);

    state = applyCommand(state, content, {
      kind: "set-model-deployment-policy",
      meta: {
        commandId: "command:solvency-managed-launch" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      modelId: productModelId,
      policy: "guarded-api",
    }).state;
    state = applyCommand(state, content, {
      kind: "start-productisation",
      meta: {
        commandId: "command:solvency-productisation" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      modelId: productModelId,
      mode: "normal",
    }).state;
    state = advanceUntil(
      state,
      (candidate) =>
        Object.values(
          candidate.models[productModelId]?.deployment.productisationRuns ?? {},
        ).some((runs) => runs > 0),
      12,
    );
    const launchLab = state.labs[playerLabId];
    if (launchLab === undefined) throw new Error("Opening launch lab disappeared");
    state = applyCommand(state, content, {
      kind: "set-gpu-allocation",
      meta: {
        commandId: "command:solvency-serving" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: playerLabId,
      allocation: {
        ...launchLab.compute.allocation,
        servingFleetShareBasisPoints: basisPoints(10_000),
        capabilityBasisPoints: basisPoints(10_000),
      },
    }).state;
    state = advanceUntil(
      state,
      (candidate) => labMaturityStage(candidate) === "funding",
      12,
    );

    expect(state.labs[playerLabId]?.finance.cash).toBeLessThan(0);
    expect(state.labs[playerLabId]?.aura.spendable).toBeGreaterThanOrEqual(
      30 + PROTOTYPE_TRACTION_AURA_AWARD,
    );
    for (const campaign of [
      "quiet-bridge",
      "competitive-round",
      "mega-round-roadshow",
    ] as const) {
      expect(
        quoteFundraisingCampaign(state, content, playerLabId, campaign).blockers,
      ).not.toEqual(expect.arrayContaining(["Insufficient cash", "Insufficient Aura"]));
    }
  });

  it("requires a newly authorised generation for each FC 5, 10, and 20 chapter", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model?.measuredCapability === undefined) {
      throw new Error("generation-scoped milestone fixture missing");
    }
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "foundation";
    const reviewCommand = {
      kind: "review-rival-race",
      meta: {
        commandId: "command:model-stage-rival-review" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
    } as const;
    lab.flags[FOUNDATION_RESEARCH_COMMITTED_FLAG] = true;
    const researchLevelTotal = Object.values(lab.research.domains).reduce(
      (total, programme) => total + programme.level,
      0,
    );
    lab.flags[FOUNDATION_RESEARCH_BASELINE_FLAG] = researchLevelTotal - 1;
    model.measuredCapability.frontierCapability = rating(20);
    model.flags["campaign:training-authorised-stage"] = "foundation";

    const productTx = createTransaction(draft);
    synchronisePlayerLabMaturity(productTx);
    const product = productTx.commit({ description: "FC 20 jump clears FC 5" }).state;
    expect(labMaturityStage(product)).toBe("product");
    expect(labFeatureUnlocked(product, "productisation")).toBe(true);
    expect(labFeatureUnlocked(product, "evaluations")).toBe(false);
    expect(labFeatureUnlocked(product, "autonomy")).toBe(false);

    const institutionDraft = structuredClone(product) as DeepMutable<GameState>;
    const institutionLab = institutionDraft.labs[institutionDraft.run.playerLabId];
    if (institutionLab === undefined) throw new Error("institution fixture missing");
    institutionLab.flags[LAB_MATURITY_STAGE_FLAG] = "institution";
    institutionLab.facilities.instances.push({
      definitionId: contentId("base:facility.press-office"),
      completedAt: institutionDraft.run.tick,
      modifierIds: [],
    });
    expect(validateCommand(institutionDraft, content, reviewCommand).ok).toBe(false);
    const staleTx = createTransaction(institutionDraft);
    synchronisePlayerLabMaturity(staleTx);
    const stale = staleTx.commit({ description: "old FC 20 cannot clear FC 10" }).state;
    expect(labMaturityStage(stale)).toBe("institution");

    const safetyDraft = structuredClone(stale) as DeepMutable<GameState>;
    const safetyLab = safetyDraft.labs[safetyDraft.run.playerLabId];
    const oldId = safetyLab?.models.currentModelId;
    const oldModel = oldId === undefined ? undefined : safetyDraft.models[oldId];
    if (safetyLab === undefined || oldModel === undefined) {
      throw new Error("safety milestone fixture missing");
    }
    const safetyModelId = "run:model:player:fc-10-milestone" as typeof oldModel.id;
    safetyDraft.models[safetyModelId] = {
      ...structuredClone(oldModel),
      id: safetyModelId,
      lineageId: safetyModelId as unknown as typeof oldModel.lineageId,
      generationIndex: oldModel.generationIndex + 1,
      displayName: `${oldModel.familyName}-safety`,
      flags: { "campaign:training-authorised-stage": "institution" },
    };
    safetyLab.models.modelIds.push(safetyModelId);
    safetyLab.models.currentModelId = safetyModelId;
    const safetyTx = createTransaction(safetyDraft);
    synchronisePlayerLabMaturity(safetyTx);
    const safety = safetyTx.commit({ description: "new FC 20 clears only FC 10" }).state;
    expect(labMaturityStage(safety)).toBe("safety");
    expect(labFeatureUnlocked(safety, "evaluations")).toBe(true);
    expect(labFeatureUnlocked(safety, "autonomy")).toBe(false);

    const stillSafetyDraft = structuredClone(safety) as DeepMutable<GameState>;
    const stillSafetyLab = stillSafetyDraft.labs[stillSafetyDraft.run.playerLabId];
    if (stillSafetyLab === undefined) throw new Error("safety lab disappeared");
    const evaluationId = "run:evaluation:generation-scope" as EvaluationId;
    stillSafetyDraft.evaluations[evaluationId] = {
      id: evaluationId,
      ownerLabId: stillSafetyLab.id,
      modelId: safetyModelId,
      definitionId: content.evaluations.baselineEvaluationId,
      startedAt: stillSafetyDraft.run.tick,
      completedAt: stillSafetyDraft.run.tick,
      repeatIndex: 0,
      method: "generation scope safety evaluation",
      independence: 0,
      observations: [],
      anomalyIds: [],
    };
    const evaluatedModel = stillSafetyDraft.models[safetyModelId];
    if (evaluatedModel === undefined) throw new Error("evaluated model disappeared");
    evaluatedModel.evaluations.push(evaluationId);
    const stillSafetyTx = createTransaction(stillSafetyDraft);
    synchronisePlayerLabMaturity(stillSafetyTx);
    expect(
      labMaturityStage(
        stillSafetyTx.commit({ description: "same model cannot clear FC 20" }).state,
      ),
    ).toBe("safety");
  });

  it("expands garage capacity only after the server rack is built", () => {
    const draft = structuredClone(
      createProgressiveNewGame(config(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("progressive campaign player lab missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "startup";
    lab.finance.cash = cashMillions(25);
    draft.presentationQueue = [];

    let state = applyCommand(draft, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:first-server-rack" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      definitionId: contentId("base:facility.server-rack"),
    }).state;

    expect(
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.capacity.supportedOwnedGpuCount,
    ).toBe(1_000);

    for (let week = 0; week < 6; week += 1) {
      const capacity = projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.capacity.supportedOwnedGpuCount;
      if (capacity === 4_000) break;
      state = advanceOneTick(state, content).state;
    }

    expect(
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.capacity.supportedOwnedGpuCount,
    ).toBe(4_000);
    expect(labMaturityStage(state)).toBe("startup");

    state = applyCommand(state, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:expanded-opening-fleet" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: 4,
    }).state;
    for (let week = 0; week < 12 && labMaturityStage(state) === "startup"; week += 1) {
      state = advanceOneTick(state, content).state;
    }

    expect(labMaturityStage(state)).toBe("foundation");
    expect(projectLabMaturity(state)?.safetyResearchUnlocked).toBe(true);
    const foundationLab = state.labs[state.run.playerLabId];
    if (foundationLab === undefined) throw new Error("opening lab disappeared");
    expect(
      validateCommand(state, content, {
        kind: "set-gpu-allocation",
        meta: {
          commandId: "command:opening-split-research" as CommandId,
          expectedTick: state.run.tick,
          issuedBy: "player",
        },
        labId: state.run.playerLabId,
        allocation: {
          ...foundationLab.compute.allocation,
          capabilityBasisPoints: basisPoints(7_500),
        },
      }).ok,
    ).toBe(true);
    const foundingSprint = Object.values(state.modifiers).find((modifier) =>
      modifier.tags.includes("founding-team-sprint"),
    );
    expect(foundingSprint).toMatchObject({
      value: FOUNDATION_RESEARCH_SPRINT_MULTIPLIER,
    });
    expect((foundingSprint?.endsAt ?? 0) - (foundingSprint?.startsAt ?? 0)).toBe(
      FOUNDATION_RESEARCH_SPRINT_WEEKS,
    );
  });

  it("does not accept a different facility as the out-of-garage milestone", () => {
    const draft = structuredClone(
      createProgressiveNewGame(config(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("progressive campaign player lab missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "startup";
    lab.facilities.instances.push({
      definitionId: contentId("base:facility.power-and-cooling-1"),
      completedAt: draft.run.tick,
      modifierIds: [],
    });
    draft.presentationQueue = [];

    const state = advanceOneTick(draft, content).state;

    expect(labMaturityStage(state)).toBe("startup");
  });

  it("hides and blocks optional facilities until the Server Rack is complete", () => {
    const draft = structuredClone(
      createProgressiveNewGame(config(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("progressive campaign player lab missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "startup";
    lab.finance.cash = cashMillions(30);
    draft.presentationQueue = [];

    const openingCatalogue = projectGameView(draft, content, {
      viewerLabId: draft.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    }).facilities.catalogue;
    expect(openingCatalogue.map((facility) => facility.displayName)).toEqual([
      "Server Rack",
    ]);

    const headquarters = validateCommand(draft, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:headquarters-before-rack" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      definitionId: contentId("base:facility.headquarters-1"),
    });
    const serverRack = validateCommand(draft, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:server-rack-after-headquarters" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      definitionId: contentId("base:facility.server-rack"),
    });

    expect(headquarters.ok).toBe(false);
    if (headquarters.ok) throw new Error("Headquarters bypassed the Server Rack gate");
    expect(headquarters.errors).toContainEqual(
      expect.objectContaining({
        code: "lab-feature-locked",
        message:
          "Optional facilities unlock after the first funding round. Build the Server Rack first.",
      }),
    );
    expect(serverRack.ok).toBe(true);
  });

  it.each(["quiet-bridge", "competitive-round", "mega-round-roadshow"] as const)(
    "%s leaves the founding researcher mechanically affordable",
    (campaign) => {
      const draft = structuredClone(
        createProgressiveNewGame(config(), content),
      ) as DeepMutable<GameState>;
      const lab = draft.labs[draft.run.playerLabId];
      const researcherId = draft.talentMarket.visibleResearcherIds[0];
      if (lab === undefined || researcherId === undefined) {
        throw new Error("opening-affordability fixture missing");
      }
      lab.flags[LAB_MATURITY_STAGE_FLAG] = "funding";
      lab.finance.cash = cashMillions(0);
      // Deliberately ignore launch and evaluation awards: this is only starting
      // Aura plus the guaranteed Prototype traction milestone.
      lab.aura.spendable = 30 + PROTOTYPE_TRACTION_AURA_AWARD;

      const campaignQuote = quoteFundraisingCampaign(
        draft,
        content,
        draft.run.playerLabId,
        campaign,
      );
      expect(campaignQuote.blockers).not.toContain("Insufficient Aura");
      const afterRack = structuredClone(draft);
      const afterRackLab = afterRack.labs[afterRack.run.playerLabId];
      if (afterRackLab === undefined) throw new Error("opening lab disappeared");
      afterRackLab.flags[LAB_MATURITY_STAGE_FLAG] = "lab";
      afterRackLab.finance.cash = cashMillions(-10);
      afterRackLab.aura.spendable -= campaignQuote.auraCost;
      const recruitment = quoteRecruitment(
        afterRack,
        content,
        afterRack.run.playerLabId,
        researcherId,
      );

      expect(recruitment.blockers).not.toEqual(
        expect.arrayContaining(["Insufficient cash", "Insufficient Aura"]),
      );
      expect(recruitment.signingCash).toBeGreaterThan(0);
      expect(recruitment.auraCost).toBe(0);
    },
  );

  it("teaches the rival race and RSI before revealing the Candidate Programme", () => {
    const withModel = addBaselineModelForTest(
      createProgressiveNewGame(config(), content),
      content,
    );
    const institutionDraft = structuredClone(withModel) as DeepMutable<GameState>;
    const institutionLab = institutionDraft.labs[institutionDraft.run.playerLabId];
    if (institutionLab === undefined) {
      throw new Error("progressive campaign player lab missing");
    }
    institutionLab.flags[LAB_MATURITY_STAGE_FLAG] = "institution";
    institutionDraft.presentationQueue = [];

    expect(
      projectGameView(institutionDraft, content, {
        viewerLabId: institutionDraft.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).meta.labMaturity?.checklist,
    ).toEqual([
      {
        label: "Build the Press Office for +1 Aura every 4 weeks",
        complete: false,
      },
      {
        label:
          "Scale the lab as needed, then train a newly authorised successor with Frontier Capability 10+",
        complete: false,
      },
    ]);
    const pressOfficeQuote = validateCommand(institutionDraft, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:opening-press-office" as CommandId,
        expectedTick: institutionDraft.run.tick,
        issuedBy: "player",
      },
      labId: institutionDraft.run.playerLabId,
      definitionId: contentId("base:facility.press-office"),
    });
    expect(pressOfficeQuote.ok).toBe(true);

    const safetyThresholdDraft = structuredClone(institutionDraft);
    const safetyThresholdLab =
      safetyThresholdDraft.labs[safetyThresholdDraft.run.playerLabId];
    if (safetyThresholdLab === undefined) {
      throw new Error("chapter 8 player lab missing");
    }
    const safetyThresholdModelId = safetyThresholdLab.models.currentModelId;
    const safetyThresholdModel =
      safetyThresholdModelId === undefined
        ? undefined
        : safetyThresholdDraft.models[safetyThresholdModelId];
    if (safetyThresholdModel === undefined) {
      throw new Error("chapter 8 threshold model missing");
    }
    if (safetyThresholdModel.measuredCapability === undefined) {
      throw new Error("chapter 8 threshold model lacks measured capability");
    }
    safetyThresholdLab.facilities.instances.push({
      definitionId: contentId("base:facility.press-office"),
      completedAt: safetyThresholdDraft.run.tick,
      modifierIds: [],
    });
    safetyThresholdModel.measuredCapability.frontierCapability = rating(10);
    safetyThresholdModel.flags["campaign:training-authorised-stage"] = "institution";

    const safetyStageTx = createTransaction(safetyThresholdDraft);
    synchronisePlayerLabMaturity(safetyStageTx);
    const safetyStage = safetyStageTx.commit({
      description: "FC 10 successor unlocks safety",
    }).state;
    const safetyView = projectGameView(safetyStage, content, {
      viewerLabId: safetyStage.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });

    expect(labMaturityStage(safetyStage)).toBe("safety");
    expect(labFeatureUnlocked(safetyStage, "evaluations")).toBe(true);
    expect(labFeatureUnlocked(safetyStage, "autonomy")).toBe(false);
    expect(labFeatureUnlocked(safetyStage, "agi")).toBe(false);
    expect(safetyView.meta.labMaturity?.visibleSections).not.toContain("agi");
    expect(safetyView.meta.labMaturity?.features).not.toContain("autonomy");
    expect(safetyView.meta.labMaturity?.features).not.toContain("agi");
    expect(safetyView.meta.labMaturity?.checklist).toEqual([
      {
        label: "Give safety research at least 30% of R&D compute",
        complete: false,
      },
      {
        label: "Complete a safety evaluation",
        complete: false,
      },
      {
        label:
          "Scale as needed, then train a newly authorised successor with Frontier Capability 20+",
        complete: false,
      },
    ]);

    const candidateWork = validateCommand(safetyStage, content, {
      kind: "start-agi-component",
      meta: {
        commandId: "command:early-candidate-work" as CommandId,
        expectedTick: safetyStage.run.tick,
        issuedBy: "player",
      },
      labId: safetyStage.run.playerLabId,
      componentType: "project-panopticon",
    });
    expect(candidateWork.ok).toBe(false);
    if (candidateWork.ok)
      throw new Error("Candidate Programme unlocked during RSI lesson");
    expect(candidateWork.errors).toContainEqual(
      expect.objectContaining({ code: "lab-feature-locked" }),
    );

    const successorDraft = structuredClone(safetyStage) as DeepMutable<GameState>;
    const successorLab = successorDraft.labs[successorDraft.run.playerLabId];
    const sourceId = successorLab?.models.currentModelId;
    const source = sourceId === undefined ? undefined : successorDraft.models[sourceId];
    if (successorLab === undefined || source === undefined) {
      throw new Error("chapter 9 test model missing");
    }
    const successorId = "run:model:player:chapter-8-successor" as typeof source.id;
    const measuredCapability = structuredClone(source.measuredCapability);
    if (measuredCapability === undefined) {
      throw new Error("chapter 9 source lacks a measured capability estimate");
    }
    measuredCapability.frontierCapability = rating(20);
    successorDraft.models[successorId] = {
      ...structuredClone(source),
      id: successorId,
      lineageId: successorId as unknown as typeof source.lineageId,
      generationIndex: source.generationIndex + 1,
      displayName: `${source.familyName}-1`,
      trainedAt: successorDraft.run.tick,
      measuredCapability,
      accessLevel: 0,
      flags: { "campaign:training-authorised-stage": "safety" },
    };
    successorLab.models.modelIds.push(successorId);
    successorLab.models.currentModelId = successorId;
    const safetyEvaluationId = "run:evaluation:chapter-9-safety" as EvaluationId;
    successorDraft.evaluations[safetyEvaluationId] = {
      id: safetyEvaluationId,
      ownerLabId: successorLab.id,
      modelId: source.id,
      definitionId: content.evaluations.baselineEvaluationId,
      startedAt: successorDraft.run.tick,
      completedAt: successorDraft.run.tick,
      repeatIndex: 0,
      method: "chapter 9 safety evaluation",
      independence: 0,
      observations: [],
      anomalyIds: [],
    };
    source.evaluations.push(safetyEvaluationId);
    // Chapter 10 asks for a safety-research floor before it hands the
    // successor real access.
    successorLab.compute.allocation.capabilityBasisPoints = basisPoints(7000);

    const autonomyTx = createTransaction(successorDraft);
    synchronisePlayerLabMaturity(autonomyTx);
    const autonomyReady = autonomyTx.commit({
      description: "FC 20 successor enters autonomy chapter",
    }).state;

    const successorView = projectGameView(autonomyReady, content, {
      viewerLabId: autonomyReady.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(successorView.meta.labMaturity?.checklist).toEqual([
      {
        label:
          "In AGI & RSI, grant the successor Access Level 1 · Fixed evaluation sandbox",
        complete: false,
      },
    ]);

    const accessGranted = applyCommand(autonomyReady, content, {
      kind: "set-model-autonomy",
      meta: {
        commandId: "command:grant-fixed-sandbox" as CommandId,
        expectedTick: autonomyReady.run.tick,
        issuedBy: "player",
      },
      labId: autonomyReady.run.playerLabId,
      level: 1,
    }).state;
    expect(labMaturityStage(accessGranted)).toBe("autonomy");
    expect(
      projectLabMaturity(accessGranted)?.checklist.every((item) => item.complete),
    ).toBe(true);
    const fullyUnlocked = advanceOneTick(accessGranted, content).state;
    const finalView = projectGameView(fullyUnlocked, content, {
      viewerLabId: fullyUnlocked.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const finalBriefing = finalView.presentationQueue.find(
      (item) => item.kind === "lab-maturity-unlock" && item.stage === "frontier",
    );

    expect(labMaturityStage(fullyUnlocked)).toBe("frontier");
    expect(labFeatureUnlocked(fullyUnlocked, "agi")).toBe(true);
    expect(finalBriefing).toMatchObject({
      kind: "lab-maturity-unlock",
      stage: "frontier",
      chapter: "CHAPTER 12 // THE FRONTIER",
      title: "Now build the future.",
      completionBriefing: {
        objective: "Train and deploy a safe AGI.",
      },
    });
    if (
      finalBriefing?.kind !== "lab-maturity-unlock" ||
      finalBriefing.completionBriefing === undefined
    ) {
      throw new Error("final onboarding briefing missing");
    }
    expect(finalBriefing.completionBriefing.requirements).toContain(
      "FC 88+; every capability 80+.",
    );
    expect(finalBriefing.completionBriefing.requirements).toContain(
      "Complete all four Candidate Programme works.",
    );
    expect(finalView.meta.labMaturity?.showOverviewPanel).toBe(true);

    const twoWeeksLater = structuredClone(fullyUnlocked) as DeepMutable<GameState>;
    twoWeeksLater.run.tick = tick(Number(fullyUnlocked.run.tick) + 2);
    const settledView = projectGameView(twoWeeksLater, content, {
      viewerLabId: twoWeeksLater.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(settledView.meta.labMaturity?.stage).toBe("frontier");
    expect(settledView.meta.labMaturity?.features).toContain("agi");
    expect(settledView.meta.labMaturity?.showOverviewPanel).toBe(false);
  });

  it("completes chapter 11 autonomy milestone when model was trained under autonomy stage", () => {
    const draft = structuredClone(
      addBaselineModelForTest(createProgressiveNewGame(config(), content), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = "autonomy";
    const currentModel =
      lab.models.currentModelId === undefined
        ? undefined
        : draft.models[lab.models.currentModelId];
    if (currentModel === undefined || currentModel.measuredCapability === undefined) {
      throw new Error("current model missing");
    }
    const successorId = "run:model:player:chapter-11-successor" as typeof currentModel.id;
    const measuredCapability = structuredClone(currentModel.measuredCapability);
    measuredCapability.frontierCapability = rating(20);
    draft.models[successorId] = {
      ...structuredClone(currentModel),
      id: successorId,
      accessLevel: 1,
      measuredCapability,
      flags: { "campaign:training-authorised-stage": "autonomy" },
    };
    lab.models.modelIds.push(successorId);
    lab.models.currentModelId = successorId;
    const tx = createTransaction(draft);
    synchronisePlayerLabMaturity(tx);
    const state = tx.commit({ description: "advance autonomy stage" }).state;
    expect(labMaturityStage(state)).toBe("frontier");
  });

  it("leaves raw simulation games and scenarios fully unlocked", () => {
    const state = createNewGame(config(), content);
    expect(labMaturityStage(state)).toBe("frontier");
    expect(labFeatureUnlocked(state, "agi")).toBe(true);
    expect(shouldHoldAmbientSimulation(state)).toBe(false);
    expect(
      projectGameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).meta.labMaturity,
    ).toBeUndefined();
  });
});
