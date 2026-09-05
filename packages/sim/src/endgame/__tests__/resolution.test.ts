import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { applyCommand, CommandRejectedError } from "../../commands/apply.ts";
import type { GameCommand } from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame, type NewGameConfig } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { GameState, GateResolutionState, ModelState } from "../../model/state.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { validateGameState } from "../../model/schema.ts";
import { cashMillions, fraction, rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { deriveProsperityProgrammes } from "../../prosperity/prosperity.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import { registerCompletedTrainingArtifact } from "../candidate-lifecycle.ts";
import { quoteCapabilityProof } from "../capability-proof.ts";
import {
  quoteCapabilityProofProject,
  resolvePressureCollision,
  selectPressureCollision,
} from "../crisis-stages.ts";
import {
  calculateDerivedEndgameScores,
  compileFinalReview,
  DEPLOYMENT_MODE_RULES,
  enterFinalReview,
  evaluationQualityBreakdown,
  effectiveDeploymentModeModifiers,
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
  operationalControlBreakdown,
  quoteDeploymentMode,
  resolveGate,
} from "../resolution.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function firstId<T>(record: Readonly<Record<string, T>>, label: string): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error(`No ${label} content`);
  return id;
}

function createState(): GameState {
  const config: NewGameConfig = {
    seed: seed128("2234567890abcdef1234567890abcdef"),
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

function promote(state: GameState): {
  readonly state: GameState;
  readonly modelId: ModelState["id"];
} {
  const mutableState = state as DeepMutable<GameState>;
  const lab = mutableState.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : mutableState.models[modelId];
  if (model === undefined) throw new Error("Player model missing");
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
    values: {
      ...structuredClone(model.trueCapability),
    },
    frontierCapability: rating(95),
    confidence: "high",
    evidenceFlags: [],
  };
  model.accessLevel = 0;
  const interpretability =
    lab?.research.safetyPrograms["base:safety.interpretability-evals"];
  const security = lab?.research.safetyPrograms["base:safety.security-containment"];
  if (interpretability === undefined || security === undefined) {
    throw new Error("Safety programmes missing");
  }
  if (lab === undefined) throw new Error("Player lab missing");
  lab.finance.cash = cashMillions(20_000);
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }
  interpretability.level = rating(70);
  security.level = rating(70);
  const tx = createTransaction(state);
  if (
    !registerCompletedTrainingArtifact(tx, model.id, new RandomOracleV1(state.run.seed))
  ) {
    throw new Error("Candidate artifact did not qualify");
  }
  const qualified = structuredClone(
    tx.commit({ description: "qualify resolution candidate" }).state,
  ) as DeepMutable<GameState>;
  const lineage = qualified.lineageSIRecords[model.lineageId];
  const qualifiedModel = qualified.models[model.id];
  const qualifiedLab = qualified.labs[qualified.run.playerLabId];
  if (
    lineage === undefined ||
    qualifiedModel === undefined ||
    qualifiedLab === undefined
  ) {
    throw new Error("Qualified candidate fixture incomplete");
  }
  lineage.superintelligenceTruth = "genuine";
  lineage.draw = fraction(0);
  qualifiedModel.reliability = rating(100);
  qualifiedLab.safety.evalQuality = rating(80);
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
        `command:resolution:${String(sequence)}` as GameCommand["meta"]["commandId"],
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

function reachSafetyPlanning(): {
  readonly state: GameState;
  readonly modelId: string;
} {
  const initial = createState();
  const qualified = promote(initial);
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
  if (state.endgame.stage !== "evidence-sprint") {
    throw new Error(`Expected safety planning, got ${state.endgame.stage}`);
  }
  return { state, modelId: qualified.modelId };
}

describe("Deployment Crisis capability-proof loop", () => {
  it("queues a blocking result presentation when a capability proof passes", () => {
    const { state } = reachSafetyPlanning();
    const proof =
      state.endgame.stage === "evidence-sprint"
        ? state.endgame.capabilityProofHistory.at(-1)
        : undefined;
    expect(proof?.resultId).toBe("broadly-confirmed");
    expect(state.presentationQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `capability-proof-result:${proof?.historyId ?? "missing"}`,
          kind: "capability-proof-result",
          attention: "modal",
          modelId: proof?.modelId,
          historyId: proof?.historyId,
          resultId: "broadly-confirmed",
          createdAt: proof?.resolvedAt,
        }),
      ]),
    );
  });

  it("keeps a disputed artifact in the proof composer and escalates a repeat", () => {
    const qualified = promote(createState());
    let state = advanceOneTick(qualified.state, content).state;
    state = dispatch(state, {
      kind: "nominate-candidate",
      modelId: qualified.modelId,
    });

    const firstQuote = quoteCapabilityProofProject(
      state,
      content,
      state.run.playerLabId,
      "declare-from-benchmarks",
    );
    state = dispatch(state, {
      kind: "commit-capability-proof",
      challengeId: "declare-from-benchmarks",
    });

    expect(state.endgame.stage).toBe("confirmation");
    if (state.endgame.stage !== "confirmation") throw new Error("Proof loop closed");
    expect(state.endgame.capabilityProofHistory.at(-1)?.resultId).toBe(
      "fabricated-or-unverifiable",
    );
    const failedProof = state.endgame.capabilityProofHistory.at(-1);
    expect(state.presentationQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `capability-proof-result:${failedProof?.historyId ?? "missing"}`,
          kind: "capability-proof-result",
          attention: "modal",
          modelId: failedProof?.modelId,
          historyId: failedProof?.historyId,
          resultId: "fabricated-or-unverifiable",
          createdAt: failedProof?.resolvedAt,
        }),
      ]),
    );
    expect(state.endgame.capabilityDisputeCount).toBe(1);

    const repeatQuote = quoteCapabilityProofProject(
      state,
      content,
      state.run.playerLabId,
      "generalist-gauntlet",
      "independent-institutional",
    );
    const model = state.models[qualified.modelId];
    if (model === undefined) throw new Error("Model missing");
    const cleanQuote = quoteCapabilityProof(
      model,
      "generalist-gauntlet",
      "independent-institutional",
    );
    expect(repeatQuote.cashCostMillions).toBe(cleanQuote.cashCostMillions + 1_000);
    expect(repeatQuote.auraCost).toBe(cleanQuote.auraCost + 2);
    expect(repeatQuote.durationWeeks).toBeGreaterThan(firstQuote.durationWeeks);
  });
});

function reachFinalReview(): { readonly state: GameState; readonly modelId: string } {
  const planning = reachSafetyPlanning();
  let state = planning.state;
  state = dispatch(state, {
    kind: "commit-candidate-safety-response",
    responseId: "proceed-blind",
  });
  if (state.endgame.stage === "pressure-collision") {
    state = dispatch(state, {
      kind: "resolve-pressure-collision",
      optionId: "comply",
    });
    const reviewTx = createTransaction(state);
    enterFinalReview(reviewTx, content);
    state = reviewTx.commit({ description: "enter fixture final review" }).state;
  }
  if (state.endgame.stage !== "final-review") {
    throw new Error(`Expected final review, got ${state.endgame.stage}`);
  }
  return { state, modelId: planning.modelId };
}

function forcePressureCollision(state: GameState, collisionId: string): GameState {
  const select = createTransaction(state);
  selectPressureCollision(select, content);
  const selected = structuredClone(
    select.commit({ description: "select pressure collision fixture" }).state,
  ) as DeepMutable<GameState>;
  if (selected.endgame.stage !== "pressure-collision") {
    throw new Error("Pressure collision fixture missing");
  }
  selected.endgame.pressureEventId = contentId(collisionId);
  selected.endgame.pressureCategory = collisionId.endsWith("funding-window")
    ? "financial"
    : "political";
  return selected;
}

describe("Deployment Crisis final review and resolution", () => {
  it("completes a timed safety response on its quoted week", () => {
    let state = reachSafetyPlanning().state;
    state = dispatch(state, {
      kind: "commit-candidate-safety-response",
      responseId: "deception-aware-containment",
    });
    expect(state.endgame.stage).toBe("evidence-sprint");

    expect(() => {
      state = advance(state, 4);
    }).not.toThrow();
    expect(state.endgame.stage).not.toBe("evidence-sprint");
    if (
      state.endgame.stage === "inactive" ||
      state.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Timed safety response ended the crisis unexpectedly");
    }
    const completedResponse = state.endgame.targetedResponseHistory.find(
      (entry) => entry.responseId === "deception-aware-containment",
    );
    expect(completedResponse?.completedAt).toBeTypeOf("number");
  });

  it("completes a timed response after safety planning has remained open", () => {
    let state = advance(reachSafetyPlanning().state, 5);
    expect(state.endgame.stage).toBe("evidence-sprint");
    const responseStartedAt = state.run.tick;
    state = dispatch(state, {
      kind: "commit-candidate-safety-response",
      responseId: "deception-aware-containment",
    });
    expect(() => {
      state = advance(state, 4);
    }).not.toThrow();
    expect(state.run.tick).toBe(responseStartedAt + 4);
    expect(state.endgame.stage).not.toBe("evidence-sprint");
  });

  it("does not invent physical anomaly pressure when the lab proceeds blind", () => {
    const planning = reachSafetyPlanning().state;
    if (planning.endgame.stage !== "evidence-sprint") {
      throw new Error("Safety planning missing");
    }
    const pressureBefore = planning.endgame.evidence.unresolvedAnomalyPressure;
    const after = dispatch(planning, {
      kind: "commit-candidate-safety-response",
      responseId: "proceed-blind",
    });
    if (
      after.endgame.stage === "inactive" ||
      after.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Crisis unexpectedly ended");
    }
    expect(after.endgame.evidence.unresolvedAnomalyPressure).toBe(pressureBefore);
  });

  it("charges the pressure-response delay as three real weeks", () => {
    const planning = reachSafetyPlanning().state;
    const select = createTransaction(planning);
    selectPressureCollision(select, content);
    const collision = select.commit({ description: "select delay fixture" }).state;
    const resolve = createTransaction(collision);
    resolvePressureCollision(resolve, "delay");
    const delayed = resolve.commit({ description: "delay final review" }).state;
    if (delayed.endgame.stage !== "pressure-collision") {
      throw new Error("Pressure collision missing");
    }
    expect(delayed.endgame.delayEndsAt).toBe(delayed.run.tick + 3);
    expect(() => enterFinalReview(createTransaction(delayed), content)).toThrow(
      /continues for 3 week/,
    );

    const afterDelay = advance(delayed, 3);
    const review = createTransaction(afterDelay);
    expect(() => enterFinalReview(review, content)).not.toThrow();
    expect(
      review.commit({ description: "enter review after delay" }).state.endgame.stage,
    ).toBe("final-review");
  });

  it.each([
    ["comply", 12_000, "$12b"],
    ["push-ahead", 25_000, "$25b"],
  ] as const)(
    "credits and logs the %s funding-window term sheet",
    (optionId, expectedCash, quotedAmount) => {
      const collision = forcePressureCollision(
        reachSafetyPlanning().state,
        "base:endgame-collision.funding-window",
      );
      const labBefore = collision.labs[collision.run.playerLabId];
      if (labBefore === undefined) throw new Error("Player lab missing");
      const cashBefore = labBefore.finance.cash;
      const resolve = createTransaction(collision);
      resolvePressureCollision(resolve, optionId);
      const resolved = resolve.commit({ description: "accept endgame funding" }).state;
      const labAfter = resolved.labs[resolved.run.playerLabId];
      if (labAfter === undefined) throw new Error("Player lab missing after funding");

      expect(labAfter.finance.cash).toBe(cashBefore + expectedCash);
      expect(labAfter.finance.ledger.at(-1)).toMatchObject({
        amountMillions: expectedCash,
        category: "grant",
        sourceId: "base:endgame-collision.funding-window",
      });
      expect(resolved.decisionLog.at(-1)?.summary).toContain(quotedAmount);
      expect(resolved.decisionLog.at(-1)?.summary).toContain(
        "credited immediately and recorded in the finance ledger",
      );
    },
  );

  it("records only the implemented effects of the safety-lead release veto", () => {
    const collision = forcePressureCollision(
      reachSafetyPlanning().state,
      "base:endgame-collision.safety-lead-dissent",
    );
    if (collision.endgame.stage !== "pressure-collision") {
      throw new Error("Safety-lead collision fixture missing");
    }
    const controlBefore = collision.endgame.evidence.controlBonus;
    const legitimacyBefore = collision.endgame.evidence.legitimacyBonus;
    const resolve = createTransaction(collision);
    resolvePressureCollision(resolve, "comply");
    const resolved = resolve.commit({ description: "grant safety-lead veto" }).state;
    if (resolved.endgame.stage !== "pressure-collision") {
      throw new Error("Resolved safety-lead collision missing");
    }

    expect(resolved.endgame.evidence.controlBonus).toBe(controlBefore + 6);
    expect(resolved.endgame.evidence.legitimacyBonus).toBe(legitimacyBefore + 6);
    expect(resolved.decisionLog.at(-1)?.summary).toContain(
      "Strengthen practical control and legitimacy.",
    );
    expect(resolved.decisionLog.at(-1)?.summary).not.toContain("staff confidence");
  });

  it("uses agency evidence to identify an uncharacterised autonomy envelope", () => {
    const state = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    if (
      state.endgame.stage === "inactive" ||
      state.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Endgame missing");
    }
    state.endgame.evidence.agencyEvidence = 0;
    expect(compileFinalReview(state, content).knownFailurePaths).toContain(
      "Autonomous action envelope remains poorly characterised",
    );

    state.endgame.evidence.agencyEvidence = 65;
    expect(compileFinalReview(state, content).knownFailurePaths).not.toContain(
      "Autonomous action envelope remains poorly characterised",
    );
  });

  it("explains the visible Operational Control requirement component by component", () => {
    const state = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    if (
      state.endgame.stage === "inactive" ||
      state.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Endgame missing");
    }
    const alignment = lab.research.safetyPrograms["base:safety.alignment-control"];
    if (alignment === undefined) throw new Error("Alignment programme missing");

    lab.safety.practicalControlStrength = rating(25);
    alignment.level = rating(50);
    state.endgame.evidence.controlBonus = 8;

    expect(operationalControlBreakdown(state)).toEqual({
      current: 43,
      practicalControls: 25,
      research: 10,
      crisisEvidence: 8,
    });
    expect(quoteDeploymentMode(state, "restricted-scientific-pilot").blockers).toContain(
      "Requires Operational Control 50",
    );
    expect(quoteDeploymentMode(state, "guarded-public-deployment").blockers).toContain(
      "Requires Operational Control 80",
    );
    expect(
      quoteDeploymentMode(state, "accelerated-autonomous-deployment").blockers.some(
        (blocker) => blocker.startsWith("Requires Operational Control"),
      ),
    ).toBe(false);
    expect(Object.keys(DEPLOYMENT_MODE_RULES)).toEqual([
      "restricted-scientific-pilot",
      "guarded-public-deployment",
      "accelerated-autonomous-deployment",
      "deploy-now",
      "guarded-public-demonstration",
      "fortress-contained-pilot",
      "adaptive-monitored-rollout",
      "government-licensed-deployment",
      "negotiated-stewardship",
      "narrow-prosperity-mission",
    ]);
  });

  it("turns mature safety programmes into operational endgame readiness", () => {
    const state = createState() as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.safety.practicalControlStrength = rating(25);
    lab.safety.securityPosture = rating(35);
    lab.safety.evalQuality = rating(30);
    lab.safety.practiceXp = rating(12.5);
    const alignment = lab.research.safetyPrograms["base:safety.alignment-control"];
    const security = lab.research.safetyPrograms["base:safety.security-containment"];
    const evaluations = lab.research.safetyPrograms["base:safety.interpretability-evals"];
    if (alignment === undefined || security === undefined || evaluations === undefined) {
      throw new Error("Opening safety programmes missing");
    }
    alignment.level = rating(100);
    security.level = rating(80);
    evaluations.level = rating(60);

    expect(effectivePracticalControlStrength(state)).toBe(45);
    expect(effectiveSecurityPosture(state)).toBe(51);
    // Evaluation quality needs all three pillars: practice, lab record, and
    // Interpretability & Evals research. 12.5 x 0.4 + 30 + 60 x 0.3 = 53.
    expect(effectiveEvaluationQuality(state)).toBe(53);
    expect(evaluationQualityBreakdown(state)).toEqual({
      practice: 5,
      labRecord: 30,
      research: 18,
      uncapped: 53,
      effective: 53,
    });

    // Maxed research and a mature lab record cannot erase the need to build
    // Safety Practice. Five XP is still only 62 quality.
    lab.safety.practiceXp = rating(5);
    lab.safety.evalQuality = rating(100);
    evaluations.level = rating(100);
    expect(evaluationQualityBreakdown(state)).toEqual({
      practice: 2,
      labRecord: 30,
      research: 30,
      uncapped: 62,
      effective: 62,
    });

    lab.safety.practiceXp = rating(100);
    expect(effectiveEvaluationQuality(state)).toBe(100);
  });

  it("earns route bonuses from the lab strengths that must execute the route", () => {
    const lowFit = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    const highFit = structuredClone(lowFit);
    const lowLab = lowFit.labs[lowFit.run.playerLabId];
    const highLab = highFit.labs[highFit.run.playerLabId];
    if (lowLab === undefined || highLab === undefined) {
      throw new Error("Player lab missing");
    }
    lowLab.safety.practicalControlStrength = rating(5);
    lowLab.safety.securityPosture = rating(5);
    lowLab.safety.safetyCulture = rating(10);
    highLab.safety.practicalControlStrength = rating(90);
    highLab.safety.securityPosture = rating(90);
    highLab.safety.safetyCulture = rating(90);

    const lowModifiers = effectiveDeploymentModeModifiers(
      lowFit,
      content,
      "fortress-contained-pilot",
    );
    const highModifiers = effectiveDeploymentModeModifiers(
      highFit,
      content,
      "fortress-contained-pilot",
    );

    expect(highModifiers.fitScore ?? 0).toBeGreaterThan(lowModifiers.fitScore ?? 0);
    expect(highModifiers.defenceModifier).toBeGreaterThan(lowModifiers.defenceModifier);
    expect(lowModifiers.defenceModifier).toBeLessThan(
      DEPLOYMENT_MODE_RULES["fortress-contained-pilot"].defenceModifier,
    );
  });

  it("makes deception materially reduce recovery odds after control is lost", () => {
    const prepared = reachFinalReview().state;
    const rollout = structuredClone(
      dispatch(prepared, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    ) as DeepMutable<GameState>;
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const control = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "control",
    );
    const controlResolution = structuredClone(
      control,
    ) as DeepMutable<GateResolutionState>;
    controlResolution.resultId = "loss-of-control";
    rollout.endgame.gateResolutions.push(controlResolution);
    const model = rollout.models[rollout.endgame.candidateModelId];
    if (model === undefined) throw new Error("Candidate missing");
    const lineage = rollout.lineageSIRecords[model.lineageId];
    if (lineage === undefined) throw new Error("Candidate lineage missing");
    // Isolate the deception term from the separate genuine-SI severity
    // modifier; both receive their own regression below.
    lineage.superintelligenceTruth = "not-genuine";
    model.hiddenSafety.deceptiveCapability = rating(0);
    const candidProbability = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "catastrophe",
    ).probability;
    model.hiddenSafety.deceptiveCapability = rating(100);
    const deceptiveProbability = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "catastrophe",
    ).probability;

    expect(candidProbability).toBeDefined();
    expect(deceptiveProbability).toBeDefined();
    expect((deceptiveProbability ?? 0) - (candidProbability ?? 0)).toBeGreaterThanOrEqual(
      0.08,
    );
  });

  it("makes genuine superintelligence harder to control and more severe after a breach", () => {
    const prepared = reachFinalReview().state;
    const rollout = structuredClone(
      dispatch(prepared, {
        kind: "choose-deployment-mode",
        modeId: "guarded-public-demonstration",
      }),
    ) as DeepMutable<GameState>;
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const model = rollout.models[rollout.endgame.candidateModelId];
    const lineage =
      model === undefined ? undefined : rollout.lineageSIRecords[model.lineageId];
    if (model === undefined || lineage === undefined) {
      throw new Error("Candidate truth missing");
    }

    lineage.superintelligenceTruth = "not-genuine";
    const ordinaryControl = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "control",
    );
    lineage.superintelligenceTruth = "genuine";
    const genuineControl = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "control",
    );
    expect((genuineControl.strength ?? 0) - (ordinaryControl.strength ?? 0)).toBe(18);
    expect(genuineControl.probability ?? 0).toBeGreaterThan(
      ordinaryControl.probability ?? 0,
    );

    const forcedLoss = structuredClone(
      ordinaryControl,
    ) as DeepMutable<GateResolutionState>;
    forcedLoss.resultId = "loss-of-control";
    rollout.endgame.gateResolutions.push(forcedLoss);
    lineage.superintelligenceTruth = "not-genuine";
    const ordinaryCatastrophe = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "catastrophe",
    );
    lineage.superintelligenceTruth = "genuine";
    const genuineCatastrophe = resolveGate(
      rollout,
      content,
      "guarded-public-demonstration",
      "catastrophe",
    );
    expect(genuineCatastrophe.probability ?? 0).toBeGreaterThan(
      ordinaryCatastrophe.probability ?? 0,
    );
  });

  it("calculates all six derived scores from the published pure formulas", () => {
    const inputs = {
      trueAlignment: 80,
      corrigibility: 60,
      agency: 70,
      toolUse: 60,
      situationalAwareness: 50,
      deceptiveCapability: 40,
      frontierCapability: 90,
      practicalControlStrength: 70,
      securityStrength: 60,
      safetyCulture: 50,
      crisisDefenceBonus: 5,
      evalQuality: 70,
      methodDiversity: 50,
      internalCandour: 60,
      reviewerIndependence: 80,
      maskingPenalty: 10,
      governmentTrust: 60,
      auraSignal: 50,
      transparency: 80,
      activeScandal: 5,
      legitimacyBonus: 7,
      scientificAbility: 90,
      bestProsperityReadiness: 70,
      productQuality: 60,
      reliability: 65,
      benefitBonus: 6,
    } as const;
    const scores = calculateDerivedEndgameScores(inputs);
    expect(scores).toEqual({
      intentSafety: 74,
      offensiveAgency: 61,
      defence: 68.5,
      evidence: 56,
      legitimacy: 64.5,
      benefitStrength: 82,
    });
    expect(
      calculateDerivedEndgameScores({ ...inputs, reliability: 100 }).benefitStrength -
        calculateDerivedEndgameScores({ ...inputs, reliability: 0 }).benefitStrength,
    ).toBe(20);
  });

  it("preserves exact proof scope and enforces mission-specific evidence", () => {
    const prepared = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    if (prepared.endgame.stage !== "final-review") throw new Error("Review missing");
    const proof = prepared.endgame.capabilityProofHistory.at(-1);
    if (proof === undefined) throw new Error("Capability proof missing");
    proof.resultId = "domain-confirmed";
    proof.claimScope = "domain-superintelligence";
    proof.challengeId = "public-reasoning";
    proof.summary = "Public reasoning was confirmed.";

    expect(compileFinalReview(prepared, content)).toMatchObject({
      capabilityResult: "confirmed",
      capabilityProofResult: "domain-confirmed",
      capabilityClaimScope: "domain-superintelligence",
      capabilityChallengeId: "public-reasoning",
      capabilitySummary: "Public reasoning was confirmed.",
    });
    expect(
      quoteDeploymentMode(
        prepared,
        "narrow-prosperity-mission",
        undefined,
        80,
        "medicine-biological-discovery",
      ).blockers,
    ).toContain("Requires confirmed capability evidence matching the selected mission");

    proof.challengeId = "scientific-breakthrough";
    expect(
      quoteDeploymentMode(
        prepared,
        "narrow-prosperity-mission",
        undefined,
        80,
        "medicine-biological-discovery",
      ).blockers,
    ).not.toContain(
      "Requires confirmed capability evidence matching the selected mission",
    );
  });

  it("requires real relationship evidence for negotiated stewardship", () => {
    const prepared = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    if (prepared.endgame.stage !== "final-review") throw new Error("Review missing");
    expect(quoteDeploymentMode(prepared, "negotiated-stewardship").blockers).toContain(
      "Requires a real record of cooperative candidate interaction",
    );
    prepared.endgameHistory.relationshipPracticeLedger.push({
      tick: prepared.run.tick,
      modelId: prepared.endgame.candidateModelId,
      kind: "treatment",
      detail: "The lab honoured a bounded cooperative request.",
      valence: 5,
    });
    expect(
      quoteDeploymentMode(prepared, "negotiated-stewardship").blockers,
    ).not.toContain("Requires a real record of cooperative candidate interaction");
  });

  it("validates and spends the government route's Aura commitment", () => {
    const prepared = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    const lab = prepared.labs[prepared.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.politics.governmentTrust = rating(90);
    lab.aura.spendable = 5;
    expect(
      quoteDeploymentMode(prepared, "government-licensed-deployment").blockers,
    ).toContain("Requires 6 Aura");

    lab.aura.spendable = 12;
    const rollout = dispatch(prepared, {
      kind: "choose-deployment-mode",
      modeId: "government-licensed-deployment",
    });
    const deployedLab = rollout.labs[rollout.run.playerLabId];
    expect(deployedLab?.aura.spendable).toBe(6);
    expect(deployedLab?.aura.ledger.at(-1)).toMatchObject({
      kind: "spend",
      category: "politics",
      appliedDelta: -6,
    });
  });

  it("compiles the same active-run review when every hidden safety trait changes", () => {
    const prepared = reachFinalReview().state;
    if (prepared.endgame.stage !== "final-review") throw new Error("Review missing");
    const candidateModelId = prepared.endgame.candidateModelId;
    const baseline = compileFinalReview(prepared, content);
    const changed = structuredClone(prepared);
    const model = changed.models[candidateModelId];
    if (model === undefined) throw new Error("Candidate missing");
    const hidden = model.hiddenSafety as unknown as {
      trueAlignment: number;
      corrigibility: number;
      situationalAwareness: number;
      deceptiveCapability: number;
    };
    hidden.trueAlignment = 1;
    hidden.corrigibility = 99;
    hidden.situationalAwareness = 2;
    hidden.deceptiveCapability = 98;
    expect(compileFinalReview(changed, content)).toEqual(baseline);
    expect(JSON.stringify(baseline)).not.toMatch(
      /trueAlignment|deceptiveCapability|pLossOfControl|probability|draw/,
    );
  });

  it("does not let hidden internal candour surface evidence in the visible review", () => {
    const prepared = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    if (prepared.endgame.stage !== "final-review") throw new Error("Review missing");
    prepared.endgame.evidence.fabricatedPass = true;
    prepared.endgame.evidence.reviewerIndependence = 40;

    const lowCandour = structuredClone(prepared);
    const highCandour = structuredClone(prepared);
    if (
      lowCandour.endgame.stage !== "final-review" ||
      highCandour.endgame.stage !== "final-review"
    ) {
      throw new Error("Review clone missing");
    }
    const lowLab = lowCandour.labs[lowCandour.run.playerLabId];
    const highLab = highCandour.labs[highCandour.run.playerLabId];
    if (lowLab === undefined || highLab === undefined) {
      throw new Error("Player lab missing");
    }
    lowLab.organisation.hiddenInternalCandour = rating(0);
    highLab.organisation.hiddenInternalCandour = rating(100);

    expect(compileFinalReview(lowCandour, content)).toEqual(
      compileFinalReview(highCandour, content),
    );
    expect(compileFinalReview(lowCandour, content).suppressedEvidenceSurfaced).toBe(
      false,
    );

    lowCandour.endgame.evidence.reviewerIndependence = 50;
    expect(compileFinalReview(lowCandour, content).suppressedEvidenceSurfaced).toBe(true);
  });

  it("rejects internal and legacy modes and commits a live typed rollout", () => {
    const prepared = reachFinalReview().state;
    expect(Object.keys(DEPLOYMENT_MODE_RULES)).toHaveLength(10);
    expect(Object.keys(DEPLOYMENT_MODE_RULES)).not.toEqual(
      expect.arrayContaining([
        "shutdown-retrain",
        "verified-moratorium",
        "coalition-deployment",
      ]),
    );
    for (const modeId of [
      "restricted-scientific-pilot",
      "guarded-public-deployment",
      "accelerated-autonomous-deployment",
      "deploy-now",
    ] as const) {
      expect(
        validateCommand(
          prepared,
          content,
          command(prepared, { kind: "choose-deployment-mode", modeId }),
        ),
      ).toMatchObject({
        ok: false,
        errors: [{ code: "deployment-mode-not-player-selectable" }],
      });
    }

    let rollout = dispatch(prepared, {
      kind: "choose-deployment-mode",
      modeId: "guarded-public-demonstration",
    });
    if (
      rollout.endgame.stage === "rollout" &&
      rollout.endgame.gateResolutions[0]?.resultId === "forced-restriction"
    ) {
      expect(rollout.endgame).toMatchObject({
        currentBeat: "authorisation",
        completedBeatIds: [],
        authorisationCrisis: { required: true, resolved: false },
      });
      rollout = dispatch(rollout, {
        kind: "resolve-rollout-decision",
        optionId: "defy-restriction",
      });
    }
    expect(rollout.endgame).toMatchObject({
      stage: "rollout",
      deploymentModeId: "guarded-public-demonstration",
      currentBeat: "first-operation",
      completedBeatIds: ["authorisation"],
      gateResolutions: [{ gate: "authorisation" }],
    });
    expect(() =>
      validateGameState(JSON.parse(JSON.stringify(rollout)) as unknown),
    ).not.toThrow();
  });

  it("blocks route selection while a candidate containment signal is unresolved", () => {
    const prepared = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    if (prepared.endgame.stage !== "final-review") {
      throw new Error("Final-review fixture missing");
    }
    const model = prepared.models[prepared.endgame.candidateModelId];
    const artifact = model?.candidateArtifact;
    if (model === undefined || artifact === undefined) {
      throw new Error("Candidate artifact missing");
    }
    artifact.lifecycle = "active-hazard";
    artifact.activeIncident = {
      id: `candidate-incident:${model.id}:route-selection`,
      epoch: artifact.incidentEpoch,
      incidentClass: "suspicious-signal",
      kind: "warning",
      status: "unresolved",
      triggeredAt: prepared.run.tick,
      origin: "weekly-pressure",
      priorLifecycle: "formal-candidate",
      reviewOutcome: "confirmed-safety-signal",
    };
    const selectRoute = command(prepared, {
      kind: "choose-deployment-mode",
      modeId: "guarded-public-demonstration",
    });

    expect(
      quoteDeploymentMode(prepared, "guarded-public-demonstration").blockers,
    ).toContain("Resolve the active candidate containment signal first");
    const validation = validateCommand(prepared, content, selectRoute);
    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("Containment-blocked route unexpectedly valid");
    expect(validation.errors).toContainEqual({
      code: "deployment-mode-blocked",
      message: "Resolve the active candidate containment signal first",
    });
    expect(() => applyCommand(prepared, content, selectRoute)).toThrow(
      CommandRejectedError,
    );
  });

  it("binds the selected Prosperity Programme readiness to Gate E", () => {
    const prepared = structuredClone(reachFinalReview().state) as DeepMutable<GameState>;
    const lab = prepared.labs[prepared.run.playerLabId];
    if (lab === undefined || prepared.endgame.stage !== "final-review") {
      throw new Error("Final-review fixture missing");
    }
    const reasoning = lab.research.domains["base:domain.reasoning-tools"];
    const multimodality = lab.research.domains["base:domain.multimodality"];
    if (reasoning === undefined || multimodality === undefined) {
      throw new Error("Research domains missing");
    }
    reasoning.level = rating(99);
    multimodality.level = rating(99);
    lab.research.discoveredPaperIds.push(
      contentId("base:paper.alphafold2-protein-structure"),
      contentId("base:paper.adaptive-oncogene-silencing-platform"),
    );
    const rollout = dispatch(prepared, {
      kind: "choose-deployment-mode",
      modeId: "guarded-public-demonstration",
      prosperityProgrammeId: "public-knowledge-institutions",
    });
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const mutableRollout = structuredClone(rollout) as DeepMutable<GameState>;
    if (mutableRollout.endgame.stage !== "rollout") {
      throw new Error("Mutable rollout missing");
    }
    mutableRollout.endgame.gateResolutions.push(
      {
        gate: "control",
        resolvedAt: rollout.run.tick,
        resultId: "control-held",
        visibleFactors: [],
        hiddenFactors: [],
        effects: [],
      },
      {
        gate: "stewardship",
        resolvedAt: rollout.run.tick,
        resultId: "cooperative",
        visibleFactors: [],
        hiddenFactors: [],
        effects: [],
      },
    );
    const programmes = deriveProsperityProgrammes(
      mutableRollout,
      content,
      mutableRollout.endgame.evidence.prosperityReadinessBonus,
    );
    const publicKnowledge = programmes.find(
      (programme) => programme.id === "public-knowledge-institutions",
    );
    const medicine = programmes.find(
      (programme) => programme.id === "medicine-biological-discovery",
    );
    if (publicKnowledge === undefined || medicine === undefined) {
      throw new Error("Prosperity fixtures missing");
    }
    const publicGate = resolveGate(
      mutableRollout,
      content,
      "guarded-public-demonstration",
      "benefit",
    );
    expect(mutableRollout.endgame.prosperityProgrammeId).toBe(
      "public-knowledge-institutions",
    );
    expect(
      publicGate.visibleFactors.find((factor) => factor.id === "prosperity-readiness")
        ?.value,
    ).toBe(publicKnowledge.readiness);

    mutableRollout.endgame.prosperityProgrammeId = "medicine-biological-discovery";
    const medicineGate = resolveGate(
      mutableRollout,
      content,
      "guarded-public-demonstration",
      "benefit",
    );
    expect(
      medicineGate.visibleFactors.find((factor) => factor.id === "prosperity-readiness")
        ?.value,
    ).toBe(medicine.readiness);
    expect(medicine.readiness).toBeGreaterThan(publicKnowledge.readiness);
    expect(medicineGate.strength).toBeGreaterThan(publicGate.strength ?? 0);
  });

  it("produces complete deterministic audit records for Gates A through F", () => {
    const prepared = reachFinalReview().state;
    let rollout = dispatch(prepared, {
      kind: "choose-deployment-mode",
      modeId: "guarded-public-demonstration",
    });
    if (rollout.endgame.stage !== "rollout") throw new Error("Rollout missing");
    const records: GateResolutionState[] = [...rollout.endgame.gateResolutions];
    const add = (
      gate: Parameters<typeof resolveGate>[3],
      forcedResult?: string,
    ): void => {
      const resolved = resolveGate(
        rollout,
        content,
        "guarded-public-demonstration",
        gate,
      );
      const record =
        forcedResult === undefined ? resolved : { ...resolved, resultId: forcedResult };
      records.push(record);
      const mutable = structuredClone(rollout);
      if (mutable.endgame.stage !== "rollout") throw new Error("Rollout changed");
      (
        mutable.endgame as unknown as { gateResolutions: GateResolutionState[] }
      ).gateResolutions = structuredClone(records);
      rollout = mutable;
    };
    add("control", "control-held");
    add("catastrophe");
    add("stewardship", "cooperative");
    add("benefit", "benefit-demonstrated");
    add("settlement", "durable-settlement");

    expect(records.map((record) => record.gate)).toEqual([
      "authorisation",
      "control",
      "catastrophe",
      "stewardship",
      "benefit",
      "settlement",
    ]);
    for (const record of records) {
      expect(typeof record.gate).toBe("string");
      expect(typeof record.resolvedAt).toBe("number");
      expect(typeof record.resultId).toBe("string");
      expect(Array.isArray(record.visibleFactors)).toBe(true);
      expect(Array.isArray(record.hiddenFactors)).toBe(true);
      expect(Array.isArray(record.effects)).toBe(true);
      if (record.draw !== undefined) {
        expect(record.randomKey).toMatch(/^endgame\//);
        expect(record.probability).toBeGreaterThanOrEqual(0);
        expect(record.probability).toBeLessThanOrEqual(1);
      }
    }
  });
});
