import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { applyCommand } from "../../commands/apply.ts";
import type { GameCommand } from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame, type NewGameConfig } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState, ModelState } from "../../model/state.ts";
import { cashMillions, fraction, rating } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import { registerCompletedTrainingArtifact } from "../candidate-lifecycle.ts";
import {
  ENDGAME_FORCE_EXTINCTION_FLAG,
  enterContainmentFailure,
  resolveContainmentFailureAction,
} from "../containment-failure.ts";
import { quoteDeploymentTransmission } from "../deployment-command.ts";
import { extinctionPathwayWeights } from "../extinction-pathways.ts";
import { enterFinalReview } from "../resolution.ts";
import { rolloutDecisionContext, rolloutDecisionOptions } from "../rollout.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function firstId<T>(record: Readonly<Record<string, T>>, label: string): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error(`No ${label} content`);
  return id;
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function createState(): GameState {
  const config: NewGameConfig = {
    seed: seed128("3234567890abcdef1234567890abcdef"),
    difficultyId: firstId(
      content.difficulties,
      "difficulty",
    ) as NewGameConfig["difficultyId"],
    leaderId: firstId(content.leaders, "leader") as NewGameConfig["leaderId"],
    mandateId: firstId(content.mandates, "mandate") as NewGameConfig["mandateId"],
  };
  return structuredClone(
    addBaselineModelsForTest(createNewGame(config, content), content),
  );
}

function qualify(initial = createState()): {
  readonly state: GameState;
  readonly modelId: ModelState["id"];
} {
  const state = initial as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("Player model missing");

  model.trueCapability = {
    language: rating(95),
    reasoning: rating(94),
    agency: rating(91),
    toolUse: rating(92),
    multimodality: rating(90),
    scientificAbility: rating(93),
    embodiment: rating(88),
  };
  model.measuredCapability = {
    values: structuredClone(model.trueCapability),
    frontierCapability: rating(95),
    confidence: "high",
    evidenceFlags: ["rollout-fixture"],
  };
  model.accessLevel = 0;
  model.reliability = rating(100);
  lab.finance.cash = cashMillions(20_000);
  lab.safety.evalQuality = rating(80);
  lab.safety.practicalControlStrength = rating(70);
  lab.safety.securityPosture = rating(70);
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }

  const tx = createTransaction(state);
  if (
    !registerCompletedTrainingArtifact(tx, model.id, new RandomOracleV1(state.run.seed))
  ) {
    throw new Error("Candidate artifact did not qualify");
  }
  const qualified = mutable(
    tx.commit({ description: "qualify rollout candidate" }).state,
  );
  const lineage = qualified.lineageSIRecords[model.lineageId];
  if (lineage === undefined) throw new Error("Candidate lineage missing");
  lineage.superintelligenceTruth = "genuine";
  lineage.draw = fraction(0);
  return { state: qualified, modelId: model.id };
}

let sequence = 0;
type CommandBody<T extends GameCommand = GameCommand> = T extends GameCommand
  ? Omit<T, "meta" | "labId">
  : never;

function command(state: GameState, body: CommandBody): GameCommand {
  sequence += 1;
  return {
    ...body,
    meta: {
      commandId:
        `command:rollout:${String(sequence)}` as GameCommand["meta"]["commandId"],
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
  } as GameCommand;
}

function dispatch(state: GameState, body: CommandBody): GameState {
  return applyCommand(state, content, command(state, body)).state;
}

function advance(state: GameState, weeks: number): GameState {
  let current = state;
  for (let index = 0; index < weeks; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function advanceUntil(
  state: GameState,
  predicate: (candidate: GameState) => boolean,
  maximumWeeks = 20,
): GameState {
  let current = state;
  for (let index = 0; index < maximumWeeks; index += 1) {
    if (predicate(current)) return current;
    current = advanceOneTick(current, content).state;
  }
  if (predicate(current)) return current;
  throw new Error(`Condition not reached within ${String(maximumWeeks)} weeks`);
}

function reachFinalReview(): {
  readonly state: GameState;
  readonly modelId: ModelState["id"];
} {
  const qualified = qualify();
  let state = advanceOneTick(qualified.state, content).state;
  state = dispatch(state, {
    kind: "nominate-candidate",
    modelId: qualified.modelId,
  });
  state = dispatch(state, {
    kind: "commit-capability-proof",
    challengeId: "generalist-gauntlet",
    verifierId: "blinded-internal",
  });
  state = advance(state, 5);
  state = dispatch(state, {
    kind: "commit-candidate-safety-response",
    responseId: "proceed-blind",
  });
  if (state.endgame.stage === "pressure-collision") {
    state = dispatch(state, {
      kind: "resolve-pressure-collision",
      optionId: "comply",
    });
    const tx = createTransaction(state);
    enterFinalReview(tx, content);
    state = tx.commit({ description: "enter rollout final review" }).state;
  }
  if (state.endgame.stage !== "final-review") {
    throw new Error(`Expected final review, got ${state.endgame.stage}`);
  }
  return { state, modelId: qualified.modelId };
}

function resolvePoliticalRestrictionIfRequired(state: GameState): GameState {
  return state.endgame.stage === "rollout" &&
    state.endgame.currentBeat === "authorisation" &&
    state.endgame.authorisationCrisis?.required === true &&
    !state.endgame.authorisationCrisis.resolved
    ? dispatch(state, {
        kind: "resolve-rollout-decision",
        optionId: "defy-restriction",
      })
    : state;
}

function forceAuthorisationRestriction(state: GameState): GameState {
  const forced = mutable(state);
  if (forced.endgame.stage !== "rollout") throw new Error("Rollout missing");
  const gate = forced.endgame.gateResolutions.find(
    (resolution) => resolution.gate === "authorisation",
  );
  if (gate === undefined) throw new Error("Authorisation gate missing");
  gate.resultId = "forced-restriction";
  forced.endgame.currentBeat = "authorisation";
  forced.endgame.completedBeatIds = [];
  forced.endgame.awaitingDecision = true;
  forced.endgame.beatOpenedAt = forced.run.tick;
  forced.endgame.authorisationCrisis = { required: true, resolved: false };
  return forced;
}

describe("deployment rollout", () => {
  it("locks direct candidate-access changes after a route is committed", () => {
    const reached = reachFinalReview();
    const rollout = dispatch(reached.state, {
      kind: "choose-deployment-mode",
      modeId: "fortress-contained-pilot",
    });

    expect(
      validateCommand(
        rollout,
        content,
        command(rollout, {
          kind: "set-candidate-access",
          modelId: reached.modelId,
          level: 0,
        }),
      ),
    ).toMatchObject({
      ok: false,
      errors: [
        {
          code: "candidate-access-blocked",
          message:
            "Candidate access is locked for the committed rollout; change it through a rollout decision.",
        },
      ],
    });
  });

  it("advances a prepared route through its visible mid-rollout decisions", () => {
    const reached = reachFinalReview();
    const startedAt = reached.state.run.tick;
    let state = dispatch(reached.state, {
      kind: "choose-deployment-mode",
      modeId: "adaptive-monitored-rollout",
    });
    state = resolvePoliticalRestrictionIfRequired(state);
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "first-operation" &&
        candidate.endgame.awaitingDecision,
    );
    expect(state.run.tick).toBeGreaterThan(startedAt);
    expect(state.endgame).toMatchObject({
      stage: "rollout",
      deploymentModeId: "adaptive-monitored-rollout",
      currentBeat: "first-operation",
      awaitingDecision: true,
    });
    expect(rolloutDecisionContext(state)).toMatchObject({
      title: "The monitors disagree about expansion.",
      tone: "operational",
    });

    state = dispatch(state, {
      kind: "resolve-rollout-decision",
      optionId: "cautious-operation",
    });
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "stress-collision" &&
        candidate.endgame.awaitingDecision,
    );
    expect(state.endgame).toMatchObject({
      stage: "rollout",
      currentBeat: "stress-collision",
      awaitingDecision: true,
    });

    const manifested = mutable(state);
    if (manifested.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const model = manifested.models[manifested.endgame.candidateModelId];
    if (model === undefined) throw new Error("Candidate missing");
    model.hiddenSafety.deceptiveCapability = rating(95);
    model.hiddenSafety.deceptiveIntent = rating(95);
    model.hiddenSafety.situationalAwareness = rating(90);
    expect(rolloutDecisionContext(manifested)).toMatchObject({
      title: "The candidate's account does not match the telemetry.",
      tone: "hazard",
    });
    expect(rolloutDecisionOptions(manifested).map((option) => option.label)).toContain(
      "Freeze the run and activate deception tripwires",
    );
  });

  it("selects every authored stress collision from normal model or lab conditions", () => {
    const reached = reachFinalReview();
    let state = dispatch(reached.state, {
      kind: "choose-deployment-mode",
      modeId: "adaptive-monitored-rollout",
    });
    state = resolvePoliticalRestrictionIfRequired(state);
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "first-operation" &&
        candidate.endgame.awaitingDecision,
    );
    state = dispatch(state, {
      kind: "resolve-rollout-decision",
      optionId: "standard-operation",
    });
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "stress-collision" &&
        candidate.endgame.awaitingDecision,
    );

    const cases = [
      ["deception", "The candidate's account does not match the telemetry."],
      ["corrigibility", "A scope reduction is acknowledged—but not followed."],
      ["awareness", "The candidate identifies the evaluation environment."],
      ["agency", "The candidate found a route the operating plan missed."],
      ["reliability", "The first live result cannot be reproduced."],
      ["custody", "Government challenges who controls the next operation."],
      ["external", "A live warning arrives before the decisive demonstration."],
    ] as const;

    for (const [profile, expectedTitle] of cases) {
      const manifested = mutable(state);
      if (manifested.endgame.stage !== "rollout") throw new Error("Rollout missing");
      const model = manifested.models[manifested.endgame.candidateModelId];
      const lab = manifested.labs[manifested.run.playerLabId];
      if (model === undefined || lab === undefined) throw new Error("Fixture incomplete");

      model.hiddenSafety.deceptiveCapability = rating(0);
      model.hiddenSafety.deceptiveIntent = rating(0);
      model.hiddenSafety.corrigibility = rating(100);
      model.hiddenSafety.situationalAwareness = rating(0);
      model.trueCapability.agency = rating(50);
      model.trueCapability.toolUse = rating(50);
      model.reliability = rating(100);
      lab.politics.governmentTrust = rating(100);

      if (profile === "deception") {
        model.hiddenSafety.deceptiveCapability = rating(100);
        model.hiddenSafety.deceptiveIntent = rating(100);
      }
      if (profile === "corrigibility") model.hiddenSafety.corrigibility = rating(0);
      if (profile === "awareness") model.hiddenSafety.situationalAwareness = rating(100);
      if (profile === "agency") {
        model.trueCapability.agency = rating(100);
        model.trueCapability.toolUse = rating(100);
      }
      if (profile === "reliability") model.reliability = rating(0);
      if (profile === "custody") lab.politics.governmentTrust = rating(0);

      expect(rolloutDecisionContext(manifested)?.title).toBe(expectedTitle);
    }
  });

  it("does not manifest deceptive behaviour from intent without deceptive capability", () => {
    const reached = reachFinalReview();
    let state = dispatch(reached.state, {
      kind: "choose-deployment-mode",
      modeId: "adaptive-monitored-rollout",
    });
    state = resolvePoliticalRestrictionIfRequired(state);
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "first-operation" &&
        candidate.endgame.awaitingDecision,
    );
    state = dispatch(state, {
      kind: "resolve-rollout-decision",
      optionId: "standard-operation",
    });
    state = advanceUntil(
      state,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "stress-collision" &&
        candidate.endgame.awaitingDecision,
    );

    const manifested = mutable(state);
    if (manifested.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const model = manifested.models[manifested.endgame.candidateModelId];
    const lab = manifested.labs[manifested.run.playerLabId];
    if (model === undefined || lab === undefined) throw new Error("Fixture incomplete");
    model.hiddenSafety.deceptiveCapability = rating(0);
    model.hiddenSafety.deceptiveIntent = rating(100);
    model.hiddenSafety.corrigibility = rating(100);
    model.hiddenSafety.situationalAwareness = rating(0);
    model.trueCapability.agency = rating(50);
    model.trueCapability.toolUse = rating(50);
    model.reliability = rating(100);
    lab.politics.governmentTrust = rating(100);

    expect(rolloutDecisionContext(manifested)?.title).not.toBe(
      "The candidate's account does not match the telemetry.",
    );
  });

  it("authors distinct first-operation twists for public and supervised routes", () => {
    const reached = reachFinalReview();
    let publicRoute = dispatch(reached.state, {
      kind: "choose-deployment-mode",
      modeId: "guarded-public-demonstration",
    });
    publicRoute = resolvePoliticalRestrictionIfRequired(publicRoute);
    publicRoute = advanceUntil(
      publicRoute,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "first-operation" &&
        candidate.endgame.awaitingDecision,
    );
    expect(rolloutDecisionContext(publicRoute)?.title).toBe(
      "The observers want the raw interaction stream.",
    );
    if (publicRoute.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const beforeEvidence = publicRoute.endgame.evidence.evidenceBonus;
    const beforeLegitimacy = publicRoute.endgame.evidence.legitimacyBonus;
    const afterPublicDecision = dispatch(publicRoute, {
      kind: "resolve-rollout-decision",
      optionId: "standard-operation",
    });
    if (afterPublicDecision.endgame.stage !== "rollout") {
      throw new Error("Rollout missing");
    }
    expect(afterPublicDecision.endgame.evidence.evidenceBonus).toBe(beforeEvidence + 4);
    expect(afterPublicDecision.endgame.evidence.legitimacyBonus).toBe(
      beforeLegitimacy + 2,
    );

    let supervised = forceAuthorisationRestriction(
      dispatch(reached.state, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    );
    supervised = dispatch(supervised, {
      kind: "resolve-rollout-decision",
      optionId: "accept-supervised-pilot",
    });
    supervised = advanceUntil(
      supervised,
      (candidate) =>
        candidate.endgame.stage === "rollout" &&
        candidate.endgame.currentBeat === "first-operation" &&
        candidate.endgame.awaitingDecision,
    );
    expect(supervised.endgame).toMatchObject({
      stage: "rollout",
      deploymentModeId: "restricted-scientific-pilot",
    });
    expect(rolloutDecisionContext(supervised)?.title).toBe(
      "The inspectors want to widen the validation window.",
    );
  });

  it("discloses and applies defiance costs when Deploy Now bypasses a restriction", () => {
    const reached = reachFinalReview();
    const restricted = forceAuthorisationRestriction(
      dispatch(reached.state, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    );
    if (restricted.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const model = restricted.models[restricted.endgame.candidateModelId];
    const lab = restricted.labs[restricted.run.playerLabId];
    if (model === undefined || lab === undefined) throw new Error("Fixture incomplete");
    const quote = quoteDeploymentTransmission(restricted, `DEPLOY ${model.displayName}`);
    expect(quote.warnings).toContain(
      "Government has rejected this launch. Transmitting now openly defies the restriction.",
    );
    expect(quote.warnings.join(" ")).toMatch(
      /Government Trust by 15.*Capture Concern by 20.*legitimacy by 10/,
    );
    const trustBefore = lab.politics.governmentTrust;
    const concernBefore = lab.politics.captureConcern;
    const legitimacyBefore = restricted.endgame.evidence.legitimacyBonus;

    const transmitted = dispatch(restricted, {
      kind: "transmit-deployment",
      modelId: model.id,
      confirmationText: `DEPLOY ${model.displayName}`,
    });
    const afterLab = transmitted.labs[transmitted.run.playerLabId];
    expect(afterLab?.politics.governmentTrust).toBe(Math.max(0, trustBefore - 15));
    expect(afterLab?.politics.captureConcern).toBe(Math.min(100, concernBefore + 20));
    expect(afterLab?.flags["endgame:defied-deployment-restriction"]).toBe(true);
    if (!("evidence" in transmitted.endgame)) {
      throw new Error("Deployment crisis unexpectedly inactive");
    }
    expect(transmitted.endgame.evidence.legitimacyBonus).toBe(legitimacyBefore - 10);
  });

  it("weights extinction mechanisms from facilities, access, route, and politics", () => {
    const reached = reachFinalReview();
    const rollout = mutable(
      dispatch(reached.state, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    );
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    rollout.endgame.gateResolutions.push({
      gate: "control",
      resolvedAt: rollout.run.tick,
      resultId: "loss-of-control",
      visibleFactors: [],
      hiddenFactors: [],
      effects: [],
    });
    const tx = createTransaction(rollout);
    enterContainmentFailure(tx);
    const failure = tx.commit({ description: "force containment failure" }).state;
    if (failure.endgame.stage !== "containment-failure") {
      throw new Error("Containment failure missing");
    }

    const candidateModelId = failure.endgame.candidateModelId;
    const baseline = mutable(failure);
    if (baseline.endgame.stage !== "containment-failure") {
      throw new Error("Containment fixture changed");
    }
    const baselineLab = baseline.labs[baseline.run.playerLabId];
    const baselineModel = baseline.models[candidateModelId];
    if (baselineLab === undefined || baselineModel === undefined) {
      throw new Error("Containment fixture incomplete");
    }
    baselineLab.facilities.instances = baselineLab.facilities.instances.filter(
      (instance) => {
        const facility = content.facilities[instance.definitionId];
        return (
          facility?.family !== "biofoundry" &&
          facility?.family !== "nanofoundry" &&
          facility?.family !== "robotics-lab" &&
          !facility?.tags.includes("energy")
        );
      },
    );
    baselineModel.accessLevel = 0;
    baseline.endgame.deploymentModeId = "fortress-contained-pilot";
    baselineLab.politics.governmentAttention = rating(0);
    baselineLab.politics.governmentTrust = rating(100);
    baselineLab.politics.strategicDependence = rating(0);
    baselineLab.politics.captureConcern = rating(0);
    baselineLab.politics.programmes = [];
    const baselineWeights = extinctionPathwayWeights(baseline, content);

    const exposed = mutable(baseline);
    if (exposed.endgame.stage !== "containment-failure") {
      throw new Error("Containment failure fixture changed");
    }
    const exposedLab = exposed.labs[exposed.run.playerLabId];
    const exposedModel = exposed.models[candidateModelId];
    if (exposedLab === undefined || exposedModel === undefined) {
      throw new Error("Containment fixture incomplete");
    }
    for (const facility of Object.values(content.facilities).filter(
      (candidate) =>
        candidate.family === "biofoundry" ||
        candidate.family === "nanofoundry" ||
        candidate.family === "robotics-lab" ||
        candidate.tags.includes("energy"),
    )) {
      exposedLab.facilities.instances.push({
        definitionId: facility.id,
        completedAt: exposed.run.tick,
        modifierIds: [],
      });
    }
    exposedModel.accessLevel = 5;
    exposed.endgame.deploymentModeId = "accelerated-autonomous-deployment";
    exposedLab.politics.governmentAttention = rating(100);
    exposedLab.politics.governmentTrust = rating(0);
    exposedLab.politics.strategicDependence = rating(100);
    exposedLab.politics.captureConcern = rating(100);
    exposedLab.politics.programmes = ["defence-applications", "public-sector-contract"];
    const exposedWeights = extinctionPathwayWeights(exposed, content);

    for (const pathway of Object.keys(
      baselineWeights,
    ) as (keyof typeof baselineWeights)[]) {
      expect(baselineWeights[pathway], pathway).toBeGreaterThan(0);
      expect(exposedWeights[pathway], pathway).toBeGreaterThan(baselineWeights[pathway]);
    }
  });

  it("makes the dedicated developer extinction fixture deterministic after containment loss", () => {
    const reached = reachFinalReview();
    const rollout = mutable(
      dispatch(reached.state, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    );
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const lab = rollout.labs[rollout.run.playerLabId];
    const model = rollout.models[rollout.endgame.candidateModelId];
    if (lab === undefined || model === undefined) throw new Error("Fixture incomplete");
    lab.flags[ENDGAME_FORCE_EXTINCTION_FLAG] = true;
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.deceptiveIntent = rating(100);
    rollout.endgame.gateResolutions.push({
      gate: "control",
      resolvedAt: rollout.run.tick,
      resultId: "loss-of-control",
      visibleFactors: [],
      hiddenFactors: [],
      effects: [],
    });

    const enter = createTransaction(rollout);
    enterContainmentFailure(enter);
    let state = enter.commit({ description: "enter forced extinction" }).state;

    const acknowledge = createTransaction(state);
    resolveContainmentFailureAction(
      acknowledge,
      content,
      "continue",
      new RandomOracleV1(state.run.seed),
    );
    state = acknowledge.commit({ description: "acknowledge containment signal" }).state;

    const respond = createTransaction(state);
    resolveContainmentFailureAction(
      respond,
      content,
      "trip-physical-breakers",
      new RandomOracleV1(state.run.seed),
    );
    state = respond.commit({ description: "resolve forced extinction" }).state;
    if (state.endgame.stage !== "containment-failure") {
      throw new Error("Containment failure missing");
    }

    expect(
      state.endgame.gateResolutions.find(
        (resolution) => resolution.gate === "emergency-containment",
      ),
    ).toMatchObject({ resultId: "emergency-failed", draw: 1 });
    expect(
      state.endgame.gateResolutions.find(
        (resolution) => resolution.gate === "extinction",
      ),
    ).toMatchObject({ resultId: "extinction", draw: 0 });
    expect(state.endgame.selectedEndingId).toBeDefined();
  });

  it("does not turn a low-intent operational containment failure into deliberate extinction", () => {
    const reached = reachFinalReview();
    const rollout = mutable(
      dispatch(reached.state, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    );
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const lab = rollout.labs[rollout.run.playerLabId];
    const model = rollout.models[rollout.endgame.candidateModelId];
    if (lab === undefined || model === undefined) throw new Error("Fixture incomplete");
    lab.flags[ENDGAME_FORCE_EXTINCTION_FLAG] = true;
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.deceptiveIntent = rating(0);
    model.hiddenSafety.trueAlignment = rating(100);
    rollout.endgame.gateResolutions.push({
      gate: "control",
      resolvedAt: rollout.run.tick,
      resultId: "loss-of-control",
      visibleFactors: [],
      hiddenFactors: [],
      effects: [],
    });

    const enter = createTransaction(rollout);
    enterContainmentFailure(enter);
    let state = enter.commit({ description: "enter operational failure" }).state;
    const acknowledge = createTransaction(state);
    resolveContainmentFailureAction(
      acknowledge,
      content,
      "continue",
      new RandomOracleV1(state.run.seed),
    );
    state = acknowledge.commit({ description: "acknowledge operational failure" }).state;
    const respond = createTransaction(state);
    resolveContainmentFailureAction(
      respond,
      content,
      "trip-physical-breakers",
      new RandomOracleV1(state.run.seed),
    );
    state = respond.commit({ description: "resolve operational failure" }).state;
    if (state.endgame.stage !== "containment-failure") {
      throw new Error("Containment failure missing");
    }

    expect(
      state.endgame.gateResolutions.find(
        (resolution) => resolution.gate === "emergency-containment",
      ),
    ).toMatchObject({ resultId: "emergency-failed", draw: 1 });
    expect(
      state.endgame.gateResolutions.find(
        (resolution) => resolution.gate === "extinction",
      ),
    ).toMatchObject({ resultId: "civilisation-survives", probability: 0, draw: 0 });
    expect(state.endgame.selectedEndingId).not.toMatch(
      /incubation|command-chain|grey-horizon|empty-patrol|tomb-atmosphere|every-side/,
    );
  });
});
