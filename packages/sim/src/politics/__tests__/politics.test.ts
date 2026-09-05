import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
  type EventDefinition,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { resolveModifierValue } from "../../engine/modifier-resolver.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CommandId, LabId, ModifierId } from "../../model/ids.ts";
import { rating, tick } from "../../model/units.ts";
import { forecastUsage } from "../../market/market.ts";
import { seed128 } from "../../random/seed.ts";
import { stableStringify } from "../../persistence/hash.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import {
  PROGRAMME_EXIT_TRUST_COST,
  GOVERNMENT_PROGRAMMES,
  attentionFloor,
  calculateInterventionPressure,
  detectGovernmentCrisisTriggers,
  governmentAttentionTarget,
  governmentProgrammeEndgameBenefits,
  joinGovernmentProgramme,
  leaveGovernmentProgramme,
  quoteGovernmentProgramme,
  quoteGovernmentProgrammeExit,
  reconcileGovernmentProgrammeModifiers,
  settleGovernmentProgrammes,
  updateGovernmentWeekly,
  GOVERNMENT_SEGMENT_ID,
  quoteLobbyingProject,
} from "../politics.ts";

const compiled: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed: seed128("0123456789abcdef0123456789abcdef"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.sam-altmann"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      compiled,
    ),
    compiled,
  );
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function forcedPoliticalCrisis(): GameState {
  const state = mutable(newState());
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  if (lab === undefined || modelId === undefined) {
    throw new Error("missing player fixture");
  }
  state.run.tick = tick(12);
  state.run.calendar = calendarFromTick(12);
  lab.politics.governmentAttention = rating(100);
  lab.politics.governmentTrust = rating(0);
  lab.politics.captureConcern = rating(100);
  lab.politics.strategicDependence = rating(0);
  lab.flags["politics:defied-lawful-order"] = true;
  state.incidents.push({
    key: "forced-political-crisis",
    modelId,
    occurredAt: tick(12),
    observedSeverity: rating(100),
    category: "major",
    contained: true,
    catastropheLegal: false,
    audit: ["forced fixture"],
  });
  return state;
}

function governmentEvent(): EventDefinition {
  return {
    id: contentId("base:event.politics.nationalisation-response"),
    version: 1,
    category: "politics",
    severity: "critical",
    phase: "any",
    trigger: {
      kind: "mandatory",
      detector: "government-nationalisation",
      priority: 100,
    },
    prerequisites: { type: "always" },
    baseWeight: 0,
    weightModifiers: [],
    cooldown: { group: "government-nationalisation", weeks: 0 },
    unique: false,
    titleKey: "event.politics.nationalisation.title",
    bodyKey: "event.politics.nationalisation.body",
    evidence: [],
    tokenBindings: [
      { token: "INTERVENTION_ID", source: "trigger-text" },
      { token: "INTERVENTION_PRESSURE", source: "trigger-number" },
      { token: "INTERVENTION_TRIGGER", source: "trigger-text" },
    ],
    options: [
      {
        id: "defy",
        labelKey: "event.politics.nationalisation.defy.label",
        requirements: { type: "always" },
        knownCosts: [],
        previewKey: "event.politics.nationalisation.defy.preview",
        immediateEffects: [],
        checks: [],
        memories: [
          {
            key: "government-response",
            subjects: [{ type: "player-lab" }],
            tags: ["government-response:failed"],
          },
        ],
        confirmationRequired: true,
      },
    ],
    followUps: [],
    telemetryTags: ["government-intervention"],
  };
}

function withGovernmentEvent(): CompiledContent {
  const definition = governmentEvent();
  return {
    ...compiled,
    events: {
      definitions: { [definition.id]: definition },
      orderedIds: [definition.id],
    },
  };
}

describe("government pressure and due process", () => {
  it("exposes an auditable weighted pressure formula and strategic mitigation", () => {
    const state = newState();
    const baseline = calculateInterventionPressure(state, state.run.playerLabId);
    expect(baseline.final).toBeCloseTo(
      baseline.attentionContribution +
        baseline.distrustContribution +
        baseline.systemicRiskContribution +
        baseline.captureConcernContribution +
        baseline.publicFearContribution -
        baseline.strategicValueMitigation,
      5,
    );

    const protectedState = mutable(state);
    const lab = protectedState.labs[protectedState.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.strategicDependence = rating(80);
    const protectedPressure = calculateInterventionPressure(
      protectedState,
      protectedState.run.playerLabId,
    );
    expect(protectedPressure.strategicValueMitigation).toBe(20);
    expect(protectedPressure.final).toBeLessThan(baseline.final);
  });

  it("drifts attention upward toward visible capability and applies band teeth", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    // The fixture's baseline model gives the state something to watch: the
    // target tracks apparent capability, and attention ratchets toward it.
    const target = governmentAttentionTarget(state, state.run.playerLabId);
    expect(target).toBeGreaterThan(lab.politics.governmentAttention);
    const week = createTransaction(state);
    updateGovernmentWeekly(week);
    const weekResult = week.commit({ description: "attention week" }).state;
    const drifted =
      weekResult.labs[state.run.playerLabId]?.politics.governmentAttention ?? 0;
    expect(drifted).toBeGreaterThan(lab.politics.governmentAttention);
    expect(drifted).toBeLessThanOrEqual(Math.ceil(target));

    // Force the reporting band via distrust and check the standing modifier.
    lab.politics.governmentTrust = rating(0);
    lab.politics.governmentAttention = rating(60);
    const banded = createTransaction(state);
    updateGovernmentWeekly(banded);
    const bandedResult = banded.commit({ description: "band week" }).state;
    const bandModifiers = Object.values(bandedResult.modifiers).filter((modifier) =>
      modifier.tags.includes("politics-pressure-band"),
    );
    expect(bandModifiers.length).toBeGreaterThan(0);
    const again = createTransaction(bandedResult);
    updateGovernmentWeekly(again);
    const stable = again.commit({ description: "stable band week" }).state;
    expect(
      Object.values(stable.modifiers).filter((modifier) =>
        modifier.tags.includes("politics-pressure-band"),
      ),
    ).toHaveLength(bandModifiers.length);
  });

  it("watches a runaway frontier leader harder than the rest of the field", () => {
    const level = mutable(newState());
    const labIds = Object.keys(level.labs).sort() as LabId[];
    for (const labId of labIds) {
      const modelId = level.labs[labId]?.models.modelIds[0];
      const model = modelId === undefined ? undefined : level.models[modelId];
      if (model === undefined) throw new Error("lead fixture missing");
      for (const key of Object.keys(
        model.trueCapability,
      ) as (keyof typeof model.trueCapability)[]) {
        model.trueCapability[key] = rating(40);
      }
    }
    const levelTarget = governmentAttentionTarget(level, level.run.playerLabId);

    // Pulling clear of everyone else buys attention on its own — the published
    // evals the state can see are untouched.
    const ahead = mutable(level);
    const aheadModelId = ahead.labs[ahead.run.playerLabId]?.models.modelIds[0];
    const aheadModel =
      aheadModelId === undefined ? undefined : ahead.models[aheadModelId];
    if (aheadModel === undefined) throw new Error("lead fixture missing");
    for (const key of Object.keys(
      aheadModel.trueCapability,
    ) as (keyof typeof aheadModel.trueCapability)[]) {
      aheadModel.trueCapability[key] = rating(90);
    }
    expect(governmentAttentionTarget(ahead, ahead.run.playerLabId)).toBe(
      levelTarget + 20,
    );

    // A rival running away instead leaves the player where they were.
    const rivalId = labIds.find((labId) => labId !== level.run.playerLabId);
    if (rivalId === undefined) throw new Error("rival fixture missing");
    const behind = mutable(level);
    const rivalModelId = behind.labs[rivalId]?.models.modelIds[0];
    const rivalModel =
      rivalModelId === undefined ? undefined : behind.models[rivalModelId];
    if (rivalModel === undefined) throw new Error("rival fixture missing");
    for (const key of Object.keys(
      rivalModel.trueCapability,
    ) as (keyof typeof rivalModel.trueCapability)[]) {
      rivalModel.trueCapability[key] = rating(90);
    }
    expect(governmentAttentionTarget(behind, behind.run.playerLabId)).toBe(levelTarget);
  });

  it("uses one shared annual cooldown for ordinary government interventions", () => {
    const makeCoolingState = (atTick: number): GameState => {
      const state = mutable(newState());
      const lab = state.labs[state.run.playerLabId];
      if (lab === undefined) throw new Error("missing player lab");
      state.run.tick = tick(atTick);
      state.run.calendar = calendarFromTick(atTick);
      lab.politics.governmentAttention = rating(75);
      lab.politics.governmentTrust = rating(40);
      lab.politics.captureConcern = rating(20);
      lab.politics.strategicDependence = rating(0);
      lab.politics.interventions.push({
        id: "government-action:previous-reporting",
        kind: "reporting-request",
        trigger: "quarterly-pressure",
        createdAt: tick(13),
        quarterIndex: 1,
        pressureAtTrigger: rating(40),
        status: "resolved",
        response: "satisfied",
        resolvedAt: tick(14),
      });
      const detected = detectGovernmentCrisisTriggers(state, state.run.playerLabId)[0];
      expect(detected?.kind).not.toBe("nationalisation-crisis");
      return state;
    };

    const oneQuarterLater = makeCoolingState(25);
    const blocked = advanceOneTick(oneQuarterLater, compiled).state;
    expect(blocked.labs[blocked.run.playerLabId]?.politics.interventions).toHaveLength(1);

    const fourQuartersLater = makeCoolingState(64);
    const reopened = advanceOneTick(fourQuartersLater, compiled).state;
    expect(reopened.labs[reopened.run.playerLabId]?.politics.interventions).toHaveLength(
      2,
    );
  });

  it("does not repeat a deployment restriction until three years have passed", () => {
    const makeRestrictedState = (atTick: number): GameState => {
      const state = mutable(newState());
      const lab = state.labs[state.run.playerLabId];
      if (lab === undefined) throw new Error("missing player lab");
      state.run.tick = tick(atTick);
      state.run.calendar = calendarFromTick(atTick);
      lab.politics.governmentAttention = rating(100);
      lab.politics.governmentTrust = rating(0);
      lab.politics.captureConcern = rating(100);
      lab.politics.strategicDependence = rating(0);
      lab.politics.interventions.push({
        id: "government-action:previous-restriction",
        kind: "deployment-restriction",
        trigger: "quarterly-pressure",
        createdAt: tick(13),
        quarterIndex: 1,
        pressureAtTrigger: rating(70),
        status: "resolved",
        response: "negotiated",
        resolvedAt: tick(14),
      });
      expect(detectGovernmentCrisisTriggers(state, state.run.playerLabId)[0]?.kind).toBe(
        "deployment-restriction",
      );
      return state;
    };

    const afterOneYear = advanceOneTick(makeRestrictedState(64), compiled).state;
    expect(
      afterOneYear.labs[afterOneYear.run.playerLabId]?.politics.interventions,
    ).toHaveLength(1);

    const afterThreeYears = advanceOneTick(makeRestrictedState(168), compiled).state;
    expect(
      afterThreeYears.labs[afterThreeYears.run.playerLabId]?.politics.interventions,
    ).toHaveLength(2);
  });

  it("does not reopen a nationalisation proceeding after a durable settlement", () => {
    const state = mutable(forcedPoliticalCrisis());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.interventions.push({
      id: "government-action:settled-nationalisation",
      kind: "nationalisation-crisis",
      trigger: "lawful-order-defiance",
      createdAt: tick(0),
      quarterIndex: 0,
      pressureAtTrigger: rating(90),
      status: "resolved",
      response: "negotiated",
      resolvedAt: tick(1),
    });

    expect(detectGovernmentCrisisTriggers(state, state.run.playerLabId)).toEqual([]);
  });

  it("turns a quarterly crisis threshold into a pending mandatory event", () => {
    const result = advanceOneTick(forcedPoliticalCrisis(), withGovernmentEvent());
    const lab = result.state.labs[result.state.run.playerLabId];
    const intervention = lab?.politics.interventions[0];

    expect(result.state.run.tick).toBe(13);
    expect(lab?.politics.quarterlyAssessments).toHaveLength(1);
    expect(intervention).toMatchObject({
      kind: "nationalisation-crisis",
      trigger: "lawful-order-defiance",
      status: "pending-event",
    });
    expect(intervention?.pressureAtTrigger).toBeGreaterThanOrEqual(80);
    expect(result.autoPauseReasons).not.toContain("government-intervention");
    expect(
      result.domainEvents.some(
        (event) => event.kind === "government-intervention-triggered",
      ),
    ).toBe(true);
    expect(result.state.run.status).toBe("active");
  });

  it("requires the crisis, qualifying trigger, and failed event response before nationalisation", () => {
    const content = withGovernmentEvent();
    const quarter = advanceOneTick(forcedPoliticalCrisis(), content).state;
    const opened = advanceOneTick(quarter, content).state;
    const instance = Object.values(opened.eventInstances)[0];
    if (instance === undefined) throw new Error("government event did not open");
    expect(instance.tokens["INTERVENTION_ID"]).toMatch(/^run:government-action:/);
    expect(opened.run.status).toBe("active");

    const decision = applyCommand(opened, content, {
      kind: "respond-to-decision-event",
      meta: {
        commandId: "command:government-defiance" as CommandId,
        expectedTick: opened.run.tick,
        issuedBy: "player",
      },
      instanceId: instance.id,
      optionId: "defy",
    }).state;
    expect(decision.run.status).toBe("active");

    const nationalised = advanceOneTick(decision, content).state;
    expect(nationalised.run.status).toBe("lost");
    expect(nationalised.run.endingId).toBe("base:ending.nationalised-future");
    const intervention =
      nationalised.labs[nationalised.run.playerLabId]?.politics.interventions[0];
    expect(intervention).toMatchObject({
      status: "failed",
      response: "failed",
      nationalisationEligibleAtResolution: true,
    });
  });
});

describe("lobbying projects and the government market", () => {
  it("quotes ranges rather than exact odds and resolves lobbying deterministically", () => {
    const state = newState();
    const quote = quoteLobbyingProject(
      state,
      compiled,
      state.run.playerLabId,
      "gain-grant",
      "aggressive-access",
    );
    expect(quote.chanceRange[1]).toBeGreaterThan(quote.chanceRange[0]);
    expect("probability" in quote).toBe(false);

    const discounted = structuredClone(state) as DeepMutable<GameState>;
    discounted.modifiers["coalition-cost-test" as unknown as ModifierId] = {
      id: "coalition-cost-test" as unknown as ModifierId,
      source: { kind: "leader" },
      target: "action.tag.coalition.auraCost",
      operation: "multiply",
      value: 0.5,
      startsAt: tick(0),
      tags: [],
    };
    const coalitionPlain = quoteLobbyingProject(
      state,
      compiled,
      state.run.playerLabId,
      "support-coalition",
      "aggressive-access",
    );
    const coalitionCheap = quoteLobbyingProject(
      discounted,
      compiled,
      state.run.playerLabId,
      "support-coalition",
      "aggressive-access",
    );
    expect(coalitionCheap.auraCost).toBe(Math.round(coalitionPlain.auraCost * 0.5));
    const grantCheap = quoteLobbyingProject(
      discounted,
      compiled,
      state.run.playerLabId,
      "gain-grant",
      "aggressive-access",
    );
    expect(grantCheap.auraCost).toBe(quote.auraCost);

    const command = {
      kind: "start-lobbying-project" as const,
      meta: {
        commandId: "command:lobbying" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player" as const,
      },
      labId: state.run.playerLabId,
      objective: "gain-grant" as const,
      approach: "aggressive-access" as const,
    };
    const firstStart = applyCommand(state, compiled, command).state;
    const secondStart = applyCommand(state, compiled, command).state;
    const startingLab = state.labs[state.run.playerLabId];
    if (startingLab === undefined) throw new Error("missing player lab");
    expect(firstStart.labs[firstStart.run.playerLabId]?.politics.captureConcern).toBe(8);
    expect(firstStart.labs[firstStart.run.playerLabId]?.aura.spendable).toBe(
      startingLab.aura.spendable - quote.auraCost,
    );

    const finish = (initial: GameState): GameState => {
      let current = initial;
      for (let week = 0; week < quote.durationWeeks + 1; week += 1) {
        current = advanceOneTick(current, compiled).state;
      }
      return current;
    };
    const first = finish(firstStart);
    const second = finish(secondStart);
    expect(stableStringify(first)).toBe(stableStringify(second));
    const project = Object.values(first.projects).find(
      (candidate) => candidate.kind === "lobbying",
    );
    expect(project?.status).toBe("completed");
    if (
      project?.payload.kind !== "lobbying" ||
      project.payload.resolution === undefined
    ) {
      throw new Error("missing lobbying resolution");
    }
    expect(typeof project.payload.resolution.success).toBe("boolean");
    expect(typeof project.payload.resolution.probability).toBe("number");
    expect(typeof project.payload.resolution.draw).toBe("number");
  });

  it("unlocks Government customers at Trust 45 or by explicit contract", () => {
    expect(compiled.market.segments[GOVERNMENT_SEGMENT_ID]?.displayName).toBe(
      "Government",
    );
    const locked = mutable(newState());
    const lab = locked.labs[locked.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.governmentTrust = rating(44);
    const lockedRow = forecastUsage(
      locked,
      compiled,
      locked.run.playerLabId,
    ).segments.find((segment) => segment.segmentId === GOVERNMENT_SEGMENT_ID);
    expect(lockedRow).toMatchObject({ unlocked: false, requestedTeraflops: 0 });

    lab.flags["market:government-segment-unlocked"] = true;
    const unlockedRow = forecastUsage(
      locked,
      compiled,
      locked.run.playerLabId,
    ).segments.find((segment) => segment.segmentId === GOVERNMENT_SEGMENT_ID);
    expect(unlockedRow?.unlocked).toBe(true);

    const view = projectGameView(locked, compiled, {
      viewerLabId: locked.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(view.politics.lobbyingOptions).toHaveLength(12);
    expect(
      view.market.segments.find((segment) => segment.segmentId === GOVERNMENT_SEGMENT_ID)
        ?.unlocked,
    ).toBe(true);
  });
});

describe("government programmes ladder", () => {
  it("gates, joins, applies standing effects, grants quarterly, and charges exits", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");

    // Locked below the trust threshold.
    lab.politics.governmentTrust = rating(20);
    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "safety-standards-partnership",
      ).canJoin,
    ).toBe(false);

    lab.politics.governmentTrust = rating(60);
    const attentionBefore = lab.politics.governmentAttention;
    const joinTx = createTransaction(state);
    joinGovernmentProgramme(
      joinTx,
      compiled,
      state.run.playerLabId,
      "safety-standards-partnership",
    );
    const joined = joinTx.commit({ description: "join partnership" }).state;
    const joinedLab = joined.labs[state.run.playerLabId];
    expect(joinedLab?.politics.programmes).toContain("safety-standards-partnership");
    expect(joinedLab?.politics.governmentAttention).toBe(attentionBefore + 5);
    const standing = Object.values(joined.modifiers).filter((modifier) =>
      modifier.tags.includes("government-programme"),
    );
    expect(standing).toContainEqual(
      expect.objectContaining({ target: "lab.evaluation.cashCost", value: 0.85 }),
    );

    // Quarterly settlement pays grants and drifts trust.
    const cashBefore = joinedLab?.finance.cash ?? 0;
    const trustBefore = joinedLab?.politics.governmentTrust ?? 0;
    const settleTx = createTransaction(joined);
    settleGovernmentProgrammes(settleTx, compiled, state.run.playerLabId);
    const settled = settleTx.commit({ description: "quarter" }).state;
    expect(settled.labs[state.run.playerLabId]?.politics.governmentTrust).toBe(
      trustBefore + 3,
    );
    expect(settled.labs[state.run.playerLabId]?.finance.cash).toBe(cashBefore);

    // Leaving removes the standing modifiers and burns trust.
    const leaveTx = createTransaction(settled);
    leaveGovernmentProgramme(
      leaveTx,
      state.run.playerLabId,
      "safety-standards-partnership",
    );
    const left = leaveTx.commit({ description: "leave partnership" }).state;
    expect(left.labs[state.run.playerLabId]?.politics.programmes).toHaveLength(0);
    expect(
      Object.values(left.modifiers).filter((modifier) =>
        modifier.tags.includes("government-programme"),
      ),
    ).toHaveLength(0);
    expect(left.labs[state.run.playerLabId]?.politics.governmentTrust).toBe(
      trustBefore + 3 - PROGRAMME_EXIT_TRUST_COST,
    );
  });

  it("indexes quarterly grants to current accelerator prices", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    const payments = () =>
      (
        ["public-sector-contract", "defence-applications", "national-champion"] as const
      ).map(
        (programmeId) =>
          quoteGovernmentProgramme(state, compiled, state.run.playerLabId, programmeId)
            .quarterlyCashMillions,
      );

    // The opening generation uses the protective floors.
    expect(payments()).toEqual([25, 100, 250]);

    state.world.currentGpuGenerationId = contentId("base:gpu.ampere");
    expect(payments()).toEqual([46, 184, 460]);

    state.world.currentGpuGenerationId = contentId("base:gpu.blackwell");
    expect(payments()).toEqual([200, 800, 2_000]);

    state.world.currentGpuGenerationId = contentId("base:gpu.markov");
    expect(payments()).toEqual([840, 3_360, 8_400]);

    state.world.currentGpuGenerationId = contentId("base:gpu.kolmogorov");
    expect(payments()).toEqual([1_700, 6_800, 17_000]);
    lab.politics.programmes = [
      "public-sector-contract",
      "defence-applications",
      "national-champion",
    ];
    const cashBefore = lab.finance.cash;
    const tx = createTransaction(state);
    settleGovernmentProgrammes(tx, compiled, state.run.playerLabId);
    const settled = tx.commit({ description: "defence quarter" }).state;
    expect(settled.labs[state.run.playerLabId]?.finance.cash).toBe(cashBefore + 25_500);
  });

  it("gives each rung distinct, stacking endgame value", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.programmes = [
      "safety-standards-partnership",
      "public-sector-contract",
      "defence-applications",
      "national-champion",
    ];
    expect(governmentProgrammeEndgameBenefits(state, state.run.playerLabId)).toEqual({
      moratorium: 10,
      emergencyResponse: 18,
      licensedDeploymentFit: 25,
    });
  });

  it("requires each previous rung and exits dependent programmes with it", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.governmentTrust = rating(100);
    lab.politics.strategicDependence = rating(100);

    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "public-sector-contract",
      ).blockers,
    ).toContain("Requires enrolment in Safety Standards Partnership");

    lab.politics.programmes.push("safety-standards-partnership");
    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "public-sector-contract",
      ).canJoin,
    ).toBe(true);
    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "defence-applications",
      ).blockers,
    ).toContain("Requires enrolment in Public-Sector Contract");

    lab.politics.programmes.push("public-sector-contract");
    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "defence-applications",
      ).blockers,
    ).not.toContain("Requires enrolment in Public-Sector Contract");
    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "national-champion",
      ).blockers,
    ).toContain("Requires enrolment in Defence Applications Programme");

    lab.politics.programmes.push("defence-applications");
    expect(
      quoteGovernmentProgramme(
        state,
        compiled,
        state.run.playerLabId,
        "national-champion",
      ).canJoin,
    ).toBe(true);

    lab.politics.programmes.push("national-champion");
    expect(
      quoteGovernmentProgrammeExit(state, state.run.playerLabId, "defence-applications"),
    ).toEqual({
      programmeIds: ["defence-applications", "national-champion"],
      programmeNames: ["Defence Applications Programme", "National Champion Track"],
      trustCost: PROGRAMME_EXIT_TRUST_COST * 2,
    });
    const leaveTx = createTransaction(state);
    leaveGovernmentProgramme(leaveTx, state.run.playerLabId, "defence-applications");
    const leftEarlierRung = leaveTx.commit({
      description: "leave earlier programme after advancing",
    }).state;
    expect(leftEarlierRung.labs[state.run.playerLabId]?.politics.programmes).toEqual([
      "safety-standards-partnership",
      "public-sector-contract",
    ]);
    expect(leftEarlierRung.labs[state.run.playerLabId]?.politics.governmentTrust).toBe(
      100 - PROGRAMME_EXIT_TRUST_COST * 2,
    );
    expect(
      Object.values(leftEarlierRung.modifiers).filter((modifier) =>
        [
          "politics:programme:lab:player:defence-applications",
          "politics:programme:lab:player:national-champion",
        ].includes(modifier.source.id ?? ""),
      ),
    ).toHaveLength(0);
  });

  it("quotes the full downstream exit cascade before the player commits", () => {
    const state = mutable(newState());
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.programmes = [
      "safety-standards-partnership",
      "public-sector-contract",
      "defence-applications",
      "national-champion",
    ];

    expect(
      [
        "safety-standards-partnership",
        "public-sector-contract",
        "defence-applications",
        "national-champion",
      ].map((programmeId) => {
        const quote = quoteGovernmentProgrammeExit(
          state,
          state.run.playerLabId,
          programmeId as keyof typeof GOVERNMENT_PROGRAMMES,
        );
        return [quote.programmeIds.length, quote.trustCost];
      }),
    ).toEqual([
      [4, 40],
      [3, 30],
      [2, 20],
      [1, 10],
    ]);
  });

  it("makes every programme carry a material operational or political downside", () => {
    const standardsState = mutable(newState());
    const standardsLab = standardsState.labs[standardsState.run.playerLabId];
    if (standardsLab === undefined) throw new Error("missing player lab");
    standardsLab.politics.governmentTrust = rating(60);
    const standardsResearchBefore = resolveModifierValue(
      standardsState,
      "lab.research.capability.output",
      1,
      { labId: standardsState.run.playerLabId },
    ).final;
    const standardsTx = createTransaction(standardsState);
    joinGovernmentProgramme(
      standardsTx,
      compiled,
      standardsState.run.playerLabId,
      "safety-standards-partnership",
    );
    const standards = standardsTx.commit({ description: "join standards" }).state;
    expect(
      resolveModifierValue(standards, "lab.research.capability.output", 1, {
        labId: standards.run.playerLabId,
      }).final,
    ).toBeCloseTo(standardsResearchBefore * 0.95);

    const contractState = mutable(newState());
    const contractLab = contractState.labs[contractState.run.playerLabId];
    if (contractLab === undefined) throw new Error("missing player lab");
    contractLab.politics.governmentTrust = rating(60);
    contractLab.politics.programmes.push("safety-standards-partnership");
    const contractAttention = contractLab.politics.governmentAttention;
    const contractRevenueBefore = resolveModifierValue(
      contractState,
      "lab.revenue.all",
      100,
      { labId: contractState.run.playerLabId },
    ).final;
    const contractDurationBefore = resolveModifierValue(
      contractState,
      "lab.product.durationWeeks",
      10,
      { labId: contractState.run.playerLabId },
    ).final;
    const contractTx = createTransaction(contractState);
    joinGovernmentProgramme(
      contractTx,
      compiled,
      contractState.run.playerLabId,
      "public-sector-contract",
    );
    const contract = contractTx.commit({ description: "join contract" }).state;
    expect(contract.labs[contract.run.playerLabId]?.politics.governmentAttention).toBe(
      contractAttention + 6,
    );
    expect(
      resolveModifierValue(contract, "lab.revenue.all", 100, {
        labId: contract.run.playerLabId,
      }).final,
    ).toBeCloseTo(contractRevenueBefore * 0.92);
    expect(
      resolveModifierValue(contract, "lab.product.durationWeeks", 10, {
        labId: contract.run.playerLabId,
      }).final,
    ).toBeCloseTo(contractDurationBefore * 1.1);

    expect(GOVERNMENT_PROGRAMMES["defence-applications"].standingModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "lab.incident.hazard",
          value: 1.35,
        }),
        expect.objectContaining({
          target: "lab.research.safety.output",
          value: 0.9,
        }),
        expect.objectContaining({ target: "researcher.moraleTarget", value: -5 }),
      ]),
    );

    const championState = mutable(newState());
    const championLab = championState.labs[championState.run.playerLabId];
    if (championLab === undefined) throw new Error("missing player lab");
    championLab.politics.strategicDependence = rating(60);
    championLab.politics.programmes.push("defence-applications");
    const championAttention = championLab.politics.governmentAttention;
    const championAcquisitionBefore = resolveModifierValue(
      championState,
      "lab.market.acquisitionRate",
      100,
      { labId: championState.run.playerLabId },
    ).final;
    const championGpuPriceBefore = resolveModifierValue(
      championState,
      "lab.compute.ownedPurchasePrice",
      100,
      { labId: championState.run.playerLabId },
    ).final;
    const championTx = createTransaction(championState);
    joinGovernmentProgramme(
      championTx,
      compiled,
      championState.run.playerLabId,
      "national-champion",
    );
    const champion = championTx.commit({ description: "join champion" }).state;
    expect(champion.labs[champion.run.playerLabId]?.politics.governmentAttention).toBe(
      championAttention + 15,
    );
    expect(
      resolveModifierValue(champion, "lab.market.acquisitionRate", 100, {
        labId: champion.run.playerLabId,
      }).final,
    ).toBeCloseTo(championAcquisitionBefore * 0.8);
    expect(
      resolveModifierValue(champion, "lab.compute.ownedPurchasePrice", 100, {
        labId: champion.run.playerLabId,
      }).final,
    ).toBeCloseTo(championGpuPriceBefore * 0.85);
    expect(attentionFloor(champion, champion.run.playerLabId)).toBeGreaterThanOrEqual(50);
  });

  it("reconciles the new trade-offs into existing programme enrolments", () => {
    const legacy = mutable(newState());
    const lab = legacy.labs[legacy.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.politics.programmes.push("safety-standards-partnership");
    const tx = createTransaction(legacy);
    reconcileGovernmentProgrammeModifiers(tx, legacy.run.playerLabId);
    const reconciled = tx.commit({ description: "reconcile programme terms" }).state;
    const programmeModifiers = Object.values(reconciled.modifiers).filter(
      (modifier) =>
        modifier.tags.includes("government-programme") &&
        modifier.tags.includes("safety-standards-partnership"),
    );

    expect(programmeModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "lab.evaluation.cashCost", value: 0.85 }),
        expect.objectContaining({
          target: "lab.research.capability.output",
          value: 0.95,
        }),
      ]),
    );
    expect(programmeModifiers).toHaveLength(2);

    const secondTx = createTransaction(reconciled);
    reconcileGovernmentProgrammeModifiers(secondTx, reconciled.run.playerLabId);
    const second = secondTx.commit({ description: "idempotent reconcile" }).state;
    expect(Object.keys(second.modifiers)).toEqual(Object.keys(reconciled.modifiers));
  });
});
