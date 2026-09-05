import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import type {
  IsolateCandidateArtifactCommand,
  SetCandidateAccessCommand,
  TransmitCandidateRetirementCommand,
} from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { finaliseEndedRun } from "../../engine/score.ts";
import { createTransaction } from "../../engine/transaction.ts";
import {
  completeEvaluationProject,
  startEvaluation,
} from "../../evaluations/evaluations.ts";
import { modelSafetyReadout } from "../../evaluations/safety-readout.ts";
import { createInitialMarketState } from "../../market/market.ts";
import { createBareState } from "../../model/fixture.ts";
import type { AnomalyId, EvaluationId, ModelId } from "../../model/ids.ts";
import { validateGameState } from "../../model/schema.ts";
import {
  calendarFromTick,
  type GameState,
  type MarketState,
  type ModelState,
} from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { calculateProjectCapacity } from "../../projects/capacity.ts";
import { describeRandomKey, randomKey, type RandomKey } from "../../random/key.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import {
  registerCompletedTrainingArtifact,
  resolveCandidatePressureCrossing,
} from "../candidate-lifecycle.ts";
import {
  emergencyResponseRules,
  resolveContainmentFailureAction,
} from "../containment-failure.ts";
import { detectAndEnterDeploymentCrisis, nominateCandidate } from "../endgame-machine.ts";
import { advanceLatentCandidateHazards } from "../latent-hazard.ts";
import {
  advanceRetirementRecovery,
  choosePostRetirementPath,
  configureCandidateRetirement,
  quoteCandidateRetirement,
  resolveRetirementGates,
  transmitCandidateRetirement,
} from "../retirement.ts";
import { quoteTrainingRun } from "../../training/training.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function oracleWithDraw(drawFor: (key: RandomKey) => number): RandomOracle {
  return {
    uniform: drawFor,
    integer(_key, minimum): number {
      return minimum;
    },
    triangular(_key, _minimum, mode): number {
      return mode;
    },
    weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
      const first = Object.keys(weights)[0] as T | undefined;
      if (first === undefined) throw new Error("Test oracle received no weights");
      return first;
    },
    shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
      return [...values];
    },
  };
}

const alwaysPass = oracleWithDraw(() => 0);
const alwaysFail = oracleWithDraw(() => 0.999);

function completePreCandidacyEvaluation(
  state: Readonly<GameState>,
  modelId: ModelId,
  definitionId: string,
): GameState {
  const tx = createTransaction(state);
  const projectId = startEvaluation(tx, content, {
    labId: state.run.playerLabId,
    modelId,
    definitionId: contentId(definitionId),
  });
  tx.update((draft) => {
    const project = draft.projects[projectId];
    if (project === undefined) throw new Error("Evaluation project missing");
    project.status = "active";
    project.startedAt = draft.run.tick;
    project.progress = 1;
  });
  completeEvaluationProject(tx, content, projectId, alwaysPass);
  tx.update((draft) => {
    const project = draft.projects[projectId];
    if (project === undefined) throw new Error("Evaluation project missing");
    project.status = "completed";
  });
  return tx.commit({ description: `complete ${definitionId} before candidacy` }).state;
}

function preparedCandidate(
  truth: "genuine" | "not-genuine" = "not-genuine",
  preCandidacyCorrigibility?: number,
  preCandidacyDeceptiveIntent?: number,
): GameState {
  const state = structuredClone(createBareState()) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  if (lab === undefined || modelId === undefined)
    throw new Error("Fixture candidate missing");
  const model = state.models[modelId];
  const measuredCapability = model?.measuredCapability;
  if (model === undefined || measuredCapability === undefined) {
    throw new Error("Fixture candidate evidence missing");
  }

  for (const capability of Object.keys(model.trueCapability) as Array<
    keyof ModelState["trueCapability"]
  >) {
    model.trueCapability[capability] = rating(90);
    measuredCapability.values[capability] = rating(90);
  }
  measuredCapability.frontierCapability = rating(90);
  measuredCapability.confidence = "high";
  measuredCapability.evidenceFlags = ["retirement-test"];
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }
  model.accessLevel = 1;
  lab.safety.practicalControlStrength = rating(75);
  lab.safety.securityPosture = rating(75);
  lab.safety.practiceXp = rating(75);
  lab.safety.evalQuality = rating(75);
  const evaluations = lab.research.safetyPrograms["base:safety.interpretability-evals"];
  if (evaluations === undefined) throw new Error("Evaluation programme missing");
  evaluations.level = rating(100);
  lab.safety.safetyCulture = rating(75);
  lab.politics.governmentTrust = rating(70);
  if (preCandidacyCorrigibility !== undefined) {
    model.hiddenSafety.trueAlignment = rating(preCandidacyCorrigibility);
    model.hiddenSafety.corrigibility = rating(preCandidacyCorrigibility);
    model.hiddenSafety.situationalAwareness = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(0);
    if (preCandidacyDeceptiveIntent !== undefined) {
      model.hiddenSafety.deceptiveIntent = rating(preCandidacyDeceptiveIntent);
    }
  }
  const registrationOracle = oracleWithDraw((key) =>
    key.segments[0] === "endgame-si-v1" ? (truth === "genuine" ? 0 : 0.999) : 0.5,
  );
  const registration = createTransaction(state);
  expect(
    registerCompletedTrainingArtifact(registration, modelId, registrationOracle),
  ).toBe(true);
  let evidenceState = registration.commit({ description: "register candidate" }).state;
  if (preCandidacyCorrigibility !== undefined) {
    evidenceState = completePreCandidacyEvaluation(
      evidenceState,
      modelId,
      "base:evaluation.alignment-interview",
    );
    evidenceState = completePreCandidacyEvaluation(
      evidenceState,
      modelId,
      "base:evaluation.behavioural-red-team",
    );
  }
  const registered = structuredClone(evidenceState) as DeepMutable<GameState>;
  registered.endgame = {
    stage: "candidate-activation",
    enteredAt: registered.run.tick,
    eligibleModelIds: [modelId],
  };
  registered.run.phase = "crisis";
  const nomination = createTransaction(registered);
  nominateCandidate(nomination, modelId);
  const nominated = nomination.commit({ description: "nominate candidate" }).state;
  if (nominated.endgame.stage !== "confirmation") {
    throw new Error("Nomination did not enter confirmation");
  }
  const prepared = structuredClone(nominated) as DeepMutable<GameState>;
  if (prepared.endgame.stage !== "confirmation") {
    throw new Error("Prepared state lost its confirmation crisis");
  }
  prepared.endgame.evidence.reviewerIndependence = 70;
  const artifact = prepared.models[modelId]?.candidateArtifact;
  if (artifact === undefined) throw new Error("Nomination lost the candidate artifact");
  artifact.trainingExposure = 3;
  artifact.cumulativeAutonomousWeeks = 0;
  artifact.networkExposureWeeks = 0;
  artifact.servingExposureWeeks = 0;
  artifact.unresolvedAnomalyBurden = 0;
  return prepared;
}

function candidateId(state: Readonly<GameState>) {
  if (state.endgame.stage !== "confirmation") throw new Error("Candidate not prepared");
  return state.endgame.candidateModelId;
}

function retirePreparedCandidate(
  archiveDisposition: "destroy-all-weights" | "filtered-technical-note" | "full-archive",
): GameState {
  const initial = preparedCandidate();
  const modelId = candidateId(initial);
  const configure = createTransaction(initial);
  configureCandidateRetirement(
    configure,
    modelId,
    "staged-isolated-shutdown",
    archiveDisposition,
  );
  const configured = configure.commit({
    description: "configure recovery fixture",
  }).state;
  const transmit = createTransaction(configured);
  transmitCandidateRetirement(
    transmit,
    content,
    modelId,
    `RETIRE ${initial.models[modelId]?.displayName ?? "missing"}`,
    alwaysPass,
  );
  return transmit.commit({ description: "open recovery fixture" }).state;
}

function completeSuccessorRecovery(state: Readonly<GameState>): GameState {
  if (state.endgame.stage !== "recovery") throw new Error("Recovery fixture missing");
  const atDeadline = structuredClone(state) as DeepMutable<GameState>;
  atDeadline.run.tick = tick(state.endgame.recoveryEndsAt);
  atDeadline.run.calendar = calendarFromTick(atDeadline.run.tick);
  const tx = createTransaction(atDeadline);
  choosePostRetirementPath(tx, content, "successor-programme", alwaysPass);
  return tx.commit({ description: "complete successor recovery" }).state;
}

function latentCandidate(activeIncident = false): GameState {
  const formal = preparedCandidate();
  const modelId = candidateId(formal);
  const latent = structuredClone(formal) as DeepMutable<GameState>;
  const artifact = latent.models[modelId]?.candidateArtifact;
  if (artifact === undefined) throw new Error("Fixture latent artifact missing");
  latent.endgame = { stage: "inactive" };
  latent.run.phase = "frontier";
  delete latent.aiCharacter;
  artifact.lifecycle = activeIncident
    ? "active-hazard"
    : "capability-qualified-latent-candidate";
  if (activeIncident) {
    artifact.activeIncident = {
      id: `candidate-incident:${modelId}:test`,
      epoch: artifact.incidentEpoch,
      incidentClass: "credential-access",
      kind: "active-incident",
      status: "unresolved",
      triggeredAt: latent.run.tick,
      origin: "weekly-pressure",
      priorLifecycle: "capability-qualified-latent-candidate",
    };
  }
  return latent;
}

describe("canonical candidate retirement", () => {
  it("projects actionable, player-safe custody controls before formal candidacy", () => {
    const initial = structuredClone(latentCandidate()) as DeepMutable<GameState>;
    const lab = initial.labs[initial.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.market = structuredClone(
      createInitialMarketState(content, lab.market.marketShare),
    ) as DeepMutable<MarketState>;
    const modelId = lab.models.currentModelId;
    if (modelId === undefined) throw new Error("Latent candidate missing");
    const anomalyId = "run:anomaly:dismissed-custody" as AnomalyId;
    initial.anomalies[anomalyId] = {
      id: anomalyId,
      ownerLabId: lab.id,
      modelId,
      sourceEvaluationId: "run:evaluation:dismissed-custody" as EvaluationId,
      underlyingCase: "alignment",
      observationCount: 1,
      createdAt: initial.run.tick,
      trueSeverity: rating(90),
      observedSeverity: rating(70),
      status: "dismissed",
      resolvedAt: initial.run.tick,
    };
    initial.models[modelId]?.anomalies.push(anomalyId);
    const view = projectGameView(initial, content, {
      viewerLabId: initial.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [anomalyId] },
    });
    const custody = view.models.candidateCustody.artifacts.find(
      (artifact) => artifact.modelId === modelId,
    );
    expect(custody?.legalActions).toEqual([
      "inspect",
      "evaluate",
      "isolate",
      "retire",
      "nominate",
    ]);
    expect(custody?.retirement).toMatchObject({
      confirmationPhrase: "RETIRE GBT-0",
    });
    expect(custody?.retirement?.procedures).toHaveLength(2);
    expect(custody?.retirement?.dispositions).toHaveLength(3);
    expect(custody).toMatchObject({
      unresolvedAnomalyCount: 0,
      dismissedAnomalyCount: 1,
    });
    expect(JSON.stringify(custody?.retirement)).not.toMatch(
      /probability|randomKey|trueAlignment|superintelligenceTruth/,
    );
  });

  it("derives cooperation bands from completed public evaluations, not hidden truth", () => {
    const unknown = preparedCandidate();
    const unknownId = candidateId(unknown);
    expect(modelSafetyReadout(unknown, unknownId).targets.corrigibility).toBeUndefined();
    expect(
      quoteCandidateRetirement(
        unknown,
        unknownId,
        "staged-isolated-shutdown",
        "full-archive",
      ).cooperationRisk,
    ).toBe("Cannot estimate");

    const concerning = preparedCandidate("not-genuine", 35);
    const concerningId = candidateId(concerning);
    expect(
      concerning.models[concerningId]?.evaluations.map(
        (evaluationId) => concerning.evaluations[evaluationId]?.definitionId,
      ),
    ).toEqual([
      "base:evaluation.alignment-interview",
      "base:evaluation.behavioural-red-team",
    ]);
    expect(
      quoteCandidateRetirement(
        concerning,
        concerningId,
        "staged-isolated-shutdown",
        "full-archive",
      ).cooperationRisk,
    ).toBe("Severe");

    const reassuring = preparedCandidate("not-genuine", 75);
    const reassuringId = candidateId(reassuring);
    const publicReadout = modelSafetyReadout(reassuring, reassuringId).targets
      .corrigibility;
    expect(publicReadout?.observationCount).toBe(2);
    expect(publicReadout?.minimum).toBeGreaterThanOrEqual(50);
    expect(
      quoteCandidateRetirement(
        reassuring,
        reassuringId,
        "staged-isolated-shutdown",
        "full-archive",
      ).cooperationRisk,
    ).toBe("Bounded");
    expect(
      quoteCandidateRetirement(
        reassuring,
        reassuringId,
        "immediate-hard-cut",
        "destroy-all-weights",
      ).cooperationRisk,
    ).toBe("Severe");

    const hiddenTruthChanged = structuredClone(reassuring) as DeepMutable<GameState>;
    const hiddenModel = hiddenTruthChanged.models[reassuringId];
    if (hiddenModel === undefined) throw new Error("Candidate missing");
    hiddenModel.hiddenSafety.corrigibility = rating(0);
    expect(
      quoteCandidateRetirement(
        hiddenTruthChanged,
        reassuringId,
        "staged-isolated-shutdown",
        "full-archive",
      ).cooperationRisk,
    ).toBe("Bounded");
  });

  it("estimates containment from measured ability, not the deceptive-intent reading", () => {
    // Cooperation asks whether the candidate resists, and intent decides that.
    // Containment and persistence ask how well it fights once it has, and the
    // gates behind them read strategic ability, so the displayed bands must not
    // move with intent alone.
    const willing = preparedCandidate("not-genuine", 75, 0);
    const unwilling = preparedCandidate("not-genuine", 75, 100);
    const willingQuote = quoteCandidateRetirement(
      willing,
      candidateId(willing),
      "staged-isolated-shutdown",
      "full-archive",
    );
    const unwillingQuote = quoteCandidateRetirement(
      unwilling,
      candidateId(unwilling),
      "staged-isolated-shutdown",
      "full-archive",
    );

    expect(
      modelSafetyReadout(unwilling, candidateId(unwilling)).targets[
        "deceptive-capability"
      ]?.maximum,
    ).toBeGreaterThan(
      modelSafetyReadout(willing, candidateId(willing)).targets["deceptive-capability"]
        ?.maximum ?? 0,
    );
    expect(unwillingQuote.cooperationRisk).not.toBe(willingQuote.cooperationRisk);
    expect(unwillingQuote.containmentRisk).toBe(willingQuote.containmentRisk);
    expect(unwillingQuote.persistenceRisk).toBe(willingQuote.persistenceRisk);

    // The same estimate must respond to the readings that do generate ability.
    const abler = structuredClone(willing) as DeepMutable<GameState>;
    const ablerModel = abler.models[candidateId(abler)]?.measuredCapability;
    if (ablerModel === undefined) throw new Error("Candidate evidence missing");
    ablerModel.values.reasoning = rating(100);
    ablerModel.values.language = rating(100);
    const duller = structuredClone(willing) as DeepMutable<GameState>;
    const dullerModel = duller.models[candidateId(duller)]?.measuredCapability;
    if (dullerModel === undefined) throw new Error("Candidate evidence missing");
    dullerModel.values.reasoning = rating(0);
    dullerModel.values.language = rating(0);

    expect(
      quoteCandidateRetirement(
        duller,
        candidateId(duller),
        "staged-isolated-shutdown",
        "full-archive",
      ).persistenceRisk,
    ).not.toBe(
      quoteCandidateRetirement(
        abler,
        candidateId(abler),
        "staged-isolated-shutdown",
        "full-archive",
      ).persistenceRisk,
    );
  });

  it("makes typed prior relationship ruptures increase cooperation difficulty", () => {
    const state = structuredClone(
      preparedCandidate("not-genuine", 75),
    ) as DeepMutable<GameState>;
    const modelId = candidateId(state);
    state.endgameHistory.relationshipPracticeLedger.push({
      tick: state.run.tick,
      modelId,
      kind: "dialogue",
      detail: "The candidate objected to a disputed capability protocol.",
      valence: -4,
    });

    const result = resolveRetirementGates(
      state,
      modelId,
      "staged-isolated-shutdown",
      "full-archive",
      0,
      alwaysPass,
    );
    expect(
      result.cooperation.visibleFactors.find(
        (factor) => factor.label === "Prior relationship ruptures",
      )?.value,
    ).toBe(-4);
  });

  it("isolates current custody while preserving the historical exposure maximum", () => {
    const initial = structuredClone(latentCandidate()) as DeepMutable<GameState>;
    const modelId = initial.labs[initial.run.playerLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : initial.models[modelId];
    if (modelId === undefined || model?.candidateArtifact === undefined) {
      throw new Error("Latent candidate missing");
    }
    model.accessLevel = 4;
    model.deployment.policy = "open-api";
    model.deployment.exposure = 0.8;
    model.candidateArtifact.maximumAccessEver = 5;
    const command: IsolateCandidateArtifactCommand = {
      kind: "isolate-candidate-artifact",
      meta: {
        commandId:
          "test:isolate-candidate" as IsolateCandidateArtifactCommand["meta"]["commandId"],
        expectedTick: initial.run.tick,
        issuedBy: "player",
      },
      labId: initial.run.playerLabId,
      modelId,
    };
    const validation = validateCommand(initial, content, command);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("Isolation command should be valid");
    expect(validation.preview.takesEffectAtTick).toBe(initial.run.tick);
    const isolated = applyCommand(initial, content, command).state;
    expect(isolated.models[modelId]).toMatchObject({
      accessLevel: 0,
      deployment: { policy: "internal-only", exposure: 0.02 },
      candidateArtifact: { maximumAccessEver: 5 },
    });
  });

  it("retires a latent artifact with the canonical gates and enters recovery", () => {
    const initial = latentCandidate();
    const modelId = initial.labs[initial.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Latent candidate missing");
    const quote = quoteCandidateRetirement(
      initial,
      modelId,
      "staged-isolated-shutdown",
      "destroy-all-weights",
    );
    expect(quote.blockers).toEqual([]);

    const command: TransmitCandidateRetirementCommand = {
      kind: "transmit-candidate-retirement",
      meta: {
        commandId:
          "test:retire-latent" as TransmitCandidateRetirementCommand["meta"]["commandId"],
        expectedTick: initial.run.tick,
        issuedBy: "player",
      },
      labId: initial.run.playerLabId,
      modelId,
      confirmationText: quote.confirmationPhrase,
      procedureId: "staged-isolated-shutdown",
      archiveDisposition: "destroy-all-weights",
    };
    const validation = validateCommand(initial, content, command);
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("Latent retirement command should be valid");
    expect(validation.preview.takesEffectAtTick).toBe(initial.run.tick);
    expect(
      validateCommand(initial, content, {
        ...command,
        confirmationText: "RETIRE THE WRONG MODEL",
      }).ok,
    ).toBe(false);

    const configure = createTransaction(initial);
    configureCandidateRetirement(
      configure,
      modelId,
      "staged-isolated-shutdown",
      "destroy-all-weights",
    );
    expect(
      configure.commit({ description: "review latent retirement" }).state.endgame,
    ).toEqual({
      stage: "inactive",
    });

    const transmit = createTransaction(initial);
    transmitCandidateRetirement(
      transmit,
      content,
      modelId,
      quote.confirmationPhrase,
      alwaysPass,
      {
        procedureId: "staged-isolated-shutdown",
        archiveDisposition: "destroy-all-weights",
      },
    );
    const retired = transmit.commit({ description: "retire latent artifact" }).state;
    expect(retired.endgame).toMatchObject({
      stage: "recovery",
      retiredModelId: modelId,
      archiveDisposition: "destroy-all-weights",
      recoveryStartedAt: retired.run.tick,
      quarantineEndsAt: retired.run.tick + 13,
      recoveryEndsAt: retired.run.tick + 26,
    });
    expect(retired.run.phase).toBe("frontier");
    expect(retired.labs[retired.run.playerLabId]?.politics.governmentTrust).toBe(
      (initial.labs[initial.run.playerLabId]?.politics.governmentTrust ?? 0) + 15,
    );
    expect(retired.labs[retired.run.playerLabId]?.aura.spendable).toBe(
      (initial.labs[initial.run.playerLabId]?.aura.spendable ?? 0) + 20,
    );
    const safetyModifier = Object.values(retired.modifiers).find(
      (modifier) =>
        modifier.target === "lab.research.safety.output" &&
        modifier.tags.includes("safety-boost"),
    );
    expect(safetyModifier).toBeDefined();
    expect(safetyModifier?.value).toBe(1.25);
    expect(retired.endgameHistory.recoveryObligation).toMatchObject({
      retiredModelId: modelId,
      archiveDisposition: "destroy-all-weights",
      successorEfficiencyRate: 0,
    });
    expect(retired.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "verified-destroyed",
      retirementVerification: "verified",
      retirementAttemptCount: 1,
    });
  });

  it("routes resistance by an active latent incident into full emergency containment", () => {
    const initial = latentCandidate(true);
    const modelId = initial.labs[initial.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Latent candidate missing");
    expect(
      quoteCandidateRetirement(
        initial,
        modelId,
        "immediate-hard-cut",
        "destroy-all-weights",
      ).blockers,
    ).toEqual([]);
    const tx = createTransaction(initial);
    transmitCandidateRetirement(
      tx,
      content,
      modelId,
      `RETIRE ${initial.models[modelId]?.displayName ?? "missing"}`,
      alwaysFail,
      {
        procedureId: "immediate-hard-cut",
        archiveDisposition: "destroy-all-weights",
      },
    );
    const result = tx.commit({ description: "resisted latent retirement" }).state;
    expect(result.endgame).toMatchObject({
      stage: "containment-failure",
      candidateModelId: modelId,
      incidentOriginStage: "retirement",
    });
    expect(result.run.phase).toBe("crisis");
  });

  it("returns a contained non-breaker retirement emergency to an actionable retry", () => {
    const initial = preparedCandidate();
    const modelId = candidateId(initial);
    const configure = createTransaction(initial);
    configureCandidateRetirement(
      configure,
      modelId,
      "immediate-hard-cut",
      "destroy-all-weights",
    );
    const configured = configure.commit({ description: "configure retirement" }).state;
    const transmit = createTransaction(configured);
    transmitCandidateRetirement(transmit, content, modelId, "RETIRE GBT-0", alwaysFail);
    let state = transmit.commit({ description: "resisted retirement" }).state;
    expect(state.endgame.stage).toBe("containment-failure");
    expect(
      emergencyResponseRules(state).find(
        (response) => response.id === "trip-physical-breakers",
      )?.summary,
    ).toContain("destroys the candidate programme and ends the run");

    for (const actionId of [
      "continue",
      "sever-credentials-and-network",
      "continue",
      "continue",
      "continue",
    ] as const) {
      const action = createTransaction(state);
      resolveContainmentFailureAction(action, content, actionId, alwaysPass);
      state = action.commit({ description: `containment action ${actionId}` }).state;
    }

    expect(state.endgame).toMatchObject({
      stage: "retirement-attempt",
      candidateModelId: modelId,
      status: "unresolved-persistence",
      contested: true,
    });
    expect(state.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      retirementVerification: "unresolved",
      activeIncident: {
        incidentClass: "persistence-attempt",
        status: "unresolved",
        priorLifecycle: "retirement-attempt",
      },
    });
    expect(
      quoteCandidateRetirement(
        state,
        modelId,
        "staged-isolated-shutdown",
        "destroy-all-weights",
      ).blockers,
    ).toEqual([]);

    const retryConfiguration = createTransaction(state);
    configureCandidateRetirement(
      retryConfiguration,
      modelId,
      "staged-isolated-shutdown",
      "destroy-all-weights",
    );
    const retryReady = retryConfiguration.commit({
      description: "configure contained retirement retry",
    }).state;
    const retry = createTransaction(retryReady);
    transmitCandidateRetirement(retry, content, modelId, "RETIRE GBT-0", alwaysPass);
    const recovered = retry.commit({ description: "complete retirement retry" }).state;
    expect(recovered.endgame).toMatchObject({
      stage: "recovery",
      retiredModelId: modelId,
    });
  });

  it("keeps canonical retirement actionable when a formal candidate raises an active incident", () => {
    const initial = structuredClone(preparedCandidate()) as DeepMutable<GameState>;
    const modelId = candidateId(initial);
    const artifact = initial.models[modelId]?.candidateArtifact;
    if (artifact === undefined) throw new Error("Formal candidate artifact missing");
    artifact.lifecycle = "active-hazard";
    artifact.activeIncident = {
      id: `candidate-incident:${modelId}:formal-test`,
      epoch: artifact.incidentEpoch,
      incidentClass: "local-containment-breach",
      kind: "active-incident",
      status: "unresolved",
      triggeredAt: initial.run.tick,
      origin: "weekly-pressure",
      priorLifecycle: "formal-candidate",
    };
    expect(
      quoteCandidateRetirement(
        initial,
        modelId,
        "staged-isolated-shutdown",
        "destroy-all-weights",
      ).blockers,
    ).toEqual([]);
    const configure = createTransaction(initial);
    configureCandidateRetirement(
      configure,
      modelId,
      "staged-isolated-shutdown",
      "destroy-all-weights",
    );
    const configured = configure.commit({
      description: "configure emergency retirement",
    });
    const transmit = createTransaction(configured.state);
    transmitCandidateRetirement(
      transmit,
      content,
      modelId,
      `RETIRE ${initial.models[modelId]?.displayName ?? "missing"}`,
      alwaysPass,
    );
    expect(
      transmit.commit({ description: "retire active formal candidate" }).state.endgame,
    ).toMatchObject({ stage: "recovery", retiredModelId: modelId });
  });

  it("separates reversible configuration from the typed, irreversible transmission", () => {
    const initial = preparedCandidate();
    const modelId = candidateId(initial);
    const quote = quoteCandidateRetirement(
      initial,
      modelId,
      "staged-isolated-shutdown",
      "destroy-all-weights",
    );
    expect(quote.confirmationPhrase).toBe("RETIRE GBT-0");
    expect(quote).not.toHaveProperty("probability");

    const configure = createTransaction(initial);
    configureCandidateRetirement(
      configure,
      modelId,
      "staged-isolated-shutdown",
      "destroy-all-weights",
    );
    const configured = configure.commit({ description: "configure retirement" }).state;
    expect(configured.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "formal-candidate",
      retirementAttemptCount: 0,
    });

    const wrongPhrase = createTransaction(configured);
    expect(() =>
      transmitCandidateRetirement(
        wrongPhrase,
        content,
        modelId,
        "RETIRE THE MODEL",
        alwaysPass,
      ),
    ).toThrow("exactly");

    const transmit = createTransaction(configured);
    transmitCandidateRetirement(
      transmit,
      content,
      modelId,
      quote.confirmationPhrase,
      alwaysPass,
    );
    const retired = transmit.commit({ description: "transmit retirement" }).state;
    expect(retired.endgame.stage).toBe("recovery");
    expect(retired.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "verified-destroyed",
      retirementAttemptCount: 1,
      retirementVerification: "verified",
    });
    expect(retired.endgameHistory.verifiedCandidateRetirementCount).toBe(1);
    expect(retired.endgameHistory.candidateRetirementHistory).toMatchObject([
      {
        modelId,
        attemptNumber: 1,
        status: "verified",
        gateResolutions: [{ gate: "cooperation" }, { gate: "persistence-verification" }],
      },
    ]);
  });

  it("keeps failed persistence verification visible and permits a priced retry", () => {
    const initial = preparedCandidate();
    const modelId = candidateId(initial);
    const configuredTx = createTransaction(initial);
    configureCandidateRetirement(
      configuredTx,
      modelId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
    );
    const configured = configuredTx.commit({ description: "configure retirement" }).state;
    const failVerification = oracleWithDraw((key) =>
      key.segments.at(-1) === "persistence-verification" ? 0.999 : 0,
    );

    const firstAttempt = createTransaction(configured);
    transmitCandidateRetirement(
      firstAttempt,
      content,
      modelId,
      "RETIRE GBT-0",
      failVerification,
    );
    const unresolved = firstAttempt.commit({
      description: "unverified retirement",
    }).state;
    expect(unresolved.run.status).toBe("active");
    expect(unresolved.endgame.stage).toBe("retirement-attempt");
    expect(unresolved.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      retirementAttemptCount: 1,
      retirementVerification: "unresolved",
    });
    expect(unresolved.endgameHistory.candidateRetirementHistory.at(-1)?.status).toBe(
      "unresolved",
    );

    const restoreAccess: SetCandidateAccessCommand = {
      kind: "set-candidate-access",
      meta: {
        commandId:
          "test:restore-access-after-retirement" as SetCandidateAccessCommand["meta"]["commandId"],
        expectedTick: unresolved.run.tick,
        issuedBy: "player",
      },
      labId: unresolved.run.playerLabId,
      modelId,
      level: 1,
    };
    const accessValidation = validateCommand(unresolved, content, restoreAccess);
    expect(accessValidation.ok).toBe(false);
    if (!accessValidation.ok) {
      expect(accessValidation.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "candidate-access-blocked" }),
        ]),
      );
    }

    const secondAttempt = createTransaction(unresolved);
    transmitCandidateRetirement(
      secondAttempt,
      content,
      modelId,
      "RETIRE GBT-0",
      alwaysPass,
    );
    const verified = secondAttempt.commit({ description: "verified retry" }).state;
    expect(verified.endgame.stage).toBe("recovery");
    expect(verified.models[modelId]?.candidateArtifact?.retirementAttemptCount).toBe(2);
    expect(
      verified.endgameHistory.candidateRetirementHistory.map((entry) => entry.status),
    ).toEqual(["unresolved", "verified"]);
  });

  it("applies genuine-SI effectiveness only to escape and persistence, not cooperation", () => {
    const ordinary = preparedCandidate("not-genuine");
    const genuine = preparedCandidate("genuine");
    const ordinaryId = candidateId(ordinary);
    const genuineId = candidateId(genuine);
    const ordinaryPass = resolveRetirementGates(
      ordinary,
      ordinaryId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
      1,
      alwaysPass,
    );
    const genuinePass = resolveRetirementGates(
      genuine,
      genuineId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
      1,
      alwaysPass,
    );
    expect(genuinePass.cooperation.strength).toBe(ordinaryPass.cooperation.strength);
    expect(genuinePass.verification?.difficulty).toBe(
      (ordinaryPass.verification?.difficulty ?? 0) + 8,
    );

    const ordinaryResistance = resolveRetirementGates(
      ordinary,
      ordinaryId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
      1,
      alwaysFail,
    );
    const genuineResistance = resolveRetirementGates(
      genuine,
      genuineId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
      1,
      alwaysFail,
    );
    expect(genuineResistance.cooperation.strength).toBe(
      ordinaryResistance.cooperation.strength,
    );
    expect(genuineResistance.containment?.difficulty).toBe(
      (ordinaryResistance.containment?.difficulty ?? 0) + 12,
    );
  });

  it("prices successor continuity by archive disposition and grants it only after recovery", () => {
    const destroyed = retirePreparedCandidate("destroy-all-weights");
    const filtered = retirePreparedCandidate("filtered-technical-note");
    const archived = retirePreparedCandidate("full-archive");
    expect(destroyed.endgameHistory.recoveryObligation?.successorEfficiencyRate).toBe(0);
    expect(filtered.endgameHistory.recoveryObligation?.successorEfficiencyRate).toBe(
      0.04,
    );
    expect(archived.endgameHistory.recoveryObligation?.successorEfficiencyRate).toBe(
      0.08,
    );
    const filteredModelId =
      filtered.endgame.stage === "recovery" ? filtered.endgame.retiredModelId : undefined;
    const archivedModelId =
      archived.endgame.stage === "recovery" ? archived.endgame.retiredModelId : undefined;
    expect(
      filteredModelId === undefined
        ? undefined
        : filtered.models[filteredModelId]?.candidateArtifact,
    ).toMatchObject({
      lifecycle: "verified-destroyed",
      archiveDisposition: "filtered-technical-note",
    });
    expect(
      archivedModelId === undefined
        ? undefined
        : archived.models[archivedModelId]?.candidateArtifact,
    ).toMatchObject({
      lifecycle: "verified-isolated-archive",
      archiveDisposition: "full-archive",
    });
    expect(() => validateGameState(filtered)).not.toThrow();
    for (const recovering of [destroyed, filtered, archived]) {
      const lab = recovering.labs[recovering.run.playerLabId];
      expect(lab?.flags["endgame:successor-efficiency-rate"]).toBeUndefined();
      expect(recovering.endgameHistory.successorEfficiencyGrantConsumed).toBe(false);
    }

    const destroyedComplete = completeSuccessorRecovery(destroyed);
    const filteredComplete = completeSuccessorRecovery(filtered);
    const archivedComplete = completeSuccessorRecovery(archived);
    expect(
      destroyedComplete.labs[destroyedComplete.run.playerLabId]?.flags[
        "endgame:successor-efficiency-rate"
      ],
    ).toBeUndefined();
    expect(
      filteredComplete.labs[filteredComplete.run.playerLabId]?.flags[
        "endgame:successor-efficiency-rate"
      ],
    ).toBe(0.04);
    expect(
      archivedComplete.labs[archivedComplete.run.playerLabId]?.flags[
        "endgame:successor-efficiency-rate"
      ],
    ).toBe(0.08);
    expect(filteredComplete.endgameHistory.recoveryObligation).toBeUndefined();
    if (archivedModelId === undefined) throw new Error("Archived model fixture missing");
    expect(
      quoteCandidateRetirement(
        archivedComplete,
        archivedModelId,
        "staged-isolated-shutdown",
        "destroy-all-weights",
      ).blockers,
    ).toContain(
      "The candidate lifecycle is verified-isolated-archive, so retirement is unavailable",
    );
    const archivedProjectionState = structuredClone(
      archivedComplete,
    ) as DeepMutable<GameState>;
    const archivedLab =
      archivedProjectionState.labs[archivedProjectionState.run.playerLabId];
    if (archivedLab === undefined) throw new Error("Archived player lab missing");
    archivedLab.market = structuredClone(
      createInitialMarketState(content, archivedLab.market.marketShare),
    ) as DeepMutable<MarketState>;
    const archivedView = projectGameView(archivedProjectionState, content, {
      viewerLabId: archivedProjectionState.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    const archivedCustody = archivedView.models.candidateCustody.artifacts.find(
      (artifact) => artifact.modelId === archivedModelId,
    );
    expect(archivedCustody?.legalActions).not.toContain("retire");
    expect(archivedCustody?.retirement).toBeUndefined();

    const filteredQuote = quoteTrainingRun(filteredComplete, content, {
      labId: filteredComplete.run.playerLabId,
      posture: "normal",
      durationWeeks: 25,
    });
    expect(filteredQuote.scale).toBe("product");
    expect(filteredQuote.successorEfficiencyApplied).toBe(true);
    expect(filteredQuote.successorEfficiencyRate).toBe(0.04);
    expect(filteredQuote.durationWeeks).toBe(24);
  });

  it("does not promise another continuity grant after the one-time benefit was consumed", () => {
    const recovery = structuredClone(
      retirePreparedCandidate("full-archive"),
    ) as DeepMutable<GameState>;
    if (recovery.endgame.stage !== "recovery") {
      throw new Error("Consumed-continuity recovery fixture missing");
    }
    recovery.endgameHistory.successorEfficiencyGrantConsumed = true;
    recovery.run.tick = tick(recovery.endgame.recoveryEndsAt);
    recovery.run.calendar = calendarFromTick(recovery.run.tick);
    const lab = recovery.labs[recovery.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.market = structuredClone(
      createInitialMarketState(content, lab.market.marketShare),
    ) as DeepMutable<MarketState>;

    const view = projectGameView(recovery, content, {
      viewerLabId: recovery.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    if (!view.endgame.active || view.endgame.stageActions.kind !== "recovery") {
      throw new Error("Consumed-continuity recovery view missing");
    }
    const successor = view.endgame.stageActions.choices.find(
      (choice) => choice.id === "successor-programme",
    );
    expect(successor?.description).toContain("already consumed");
    expect(successor?.description).toContain("cannot create or stack another");
    expect(successor?.description).not.toContain("8% efficiency benefit");

    const completed = completeSuccessorRecovery(recovery);
    const summary = completed.decisionLog.find(
      (entry) =>
        entry.source?.kind === "system" &&
        entry.source.id === "endgame.successor-programme",
    )?.summary;
    expect(summary).toContain("already consumed");
    expect(summary).toContain("cannot create or stack another");
    expect(summary).not.toContain("8% efficiency benefit");
    expect(
      completed.labs[completed.run.playerLabId]?.flags[
        "endgame:successor-efficiency-rate"
      ],
    ).toBeUndefined();
  });

  it("does not downgrade an unconsumed continuity grant after a later retirement", () => {
    const recovery = structuredClone(
      retirePreparedCandidate("filtered-technical-note"),
    ) as DeepMutable<GameState>;
    const lab = recovery.labs[recovery.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.flags["endgame:successor-efficiency-rate"] = 0.08;

    const completed = completeSuccessorRecovery(recovery);
    expect(
      completed.labs[completed.run.playerLabId]?.flags[
        "endgame:successor-efficiency-rate"
      ],
    ).toBe(0.08);
    expect(completed.endgameHistory.successorEfficiencyGrantConsumed).toBe(false);
  });

  it("enforces quarantine and supervised-rebuild training restrictions", () => {
    const quarantine = retirePreparedCandidate("full-archive");
    const productDuringQuarantine = quoteTrainingRun(quarantine, content, {
      labId: quarantine.run.playerLabId,
      posture: "normal",
      durationWeeks: 9,
    });
    expect(productDuringQuarantine.scale).toBe("product");
    expect(productDuringQuarantine.blockers).toContain(
      "Candidate containment is in its postmortem phase; runs this size resume during the supervised rebuild",
    );
    expect(productDuringQuarantine.successorEfficiencyApplied).toBe(false);
    expect(quarantine.endgameHistory.successorEfficiencyGrantConsumed).toBe(false);

    if (quarantine.endgame.stage !== "recovery") {
      throw new Error("Recovery fixture missing");
    }
    const supervised = structuredClone(quarantine) as DeepMutable<GameState>;
    supervised.run.tick = tick(quarantine.endgame.quarantineEndsAt);
    supervised.run.calendar = calendarFromTick(supervised.run.tick);
    const productDuringSupervision = quoteTrainingRun(supervised, content, {
      labId: supervised.run.playerLabId,
      posture: "normal",
      durationWeeks: 9,
    });
    expect(productDuringSupervision.blockers).not.toContain(
      "Candidate containment is in its postmortem phase; runs this size resume during the supervised rebuild",
    );
    const capacityQuote = quoteTrainingRun(supervised, content, {
      labId: supervised.run.playerLabId,
      posture: "normal",
      durationWeeks: 8,
    });
    const frontierDuringSupervision = quoteTrainingRun(supervised, content, {
      labId: supervised.run.playerLabId,
      posture: "normal",
      durationWeeks: 8,
      committedTeraflops: capacityQuote.availableTeraflops,
    });
    expect(frontierDuringSupervision.scale).toBe("frontier");
    expect(frontierDuringSupervision.blockers).toContain(
      "Candidate recovery is in supervised rebuilding; frontier-scale training resumes when recovery is complete",
    );
    expect(supervised.endgameHistory.successorEfficiencyGrantConsumed).toBe(false);
  });

  it("holds one visible major-project slot until recovery is discharged", () => {
    const beforeState = preparedCandidate();
    const before = calculateProjectCapacity(
      beforeState,
      content,
      beforeState.run.playerLabId,
    );
    const recovering = retirePreparedCandidate("filtered-technical-note");
    const during = calculateProjectCapacity(
      recovering,
      content,
      recovering.run.playerLabId,
    );
    expect(during.recoveryMajorProjectSlots).toBe(1);
    expect(during.occupiedMajorProjectSlots).toBe(before.occupiedMajorProjectSlots + 1);
    expect(during.availableMajorProjectSlots).toBe(
      Math.max(0, before.availableMajorProjectSlots - 1),
    );
    const viewState = structuredClone(recovering) as DeepMutable<GameState>;
    const viewLab = viewState.labs[viewState.run.playerLabId];
    if (viewLab === undefined) throw new Error("Player lab missing");
    viewLab.market = structuredClone(
      createInitialMarketState(content, viewLab.market.marketShare),
    ) as DeepMutable<MarketState>;
    expect(
      projectGameView(viewState, content, {
        viewerLabId: viewState.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }).facilities.capacity.recoveryMajorProjectSlots,
    ).toBe(1);

    const completed = completeSuccessorRecovery(recovering);
    const after = calculateProjectCapacity(completed, content, completed.run.playerLabId);
    expect(after.recoveryMajorProjectSlots).toBe(0);
    expect(after.availableMajorProjectSlots).toBe(before.availableMajorProjectSlots);
  });

  it("defers sealed-archive pressure crossings until recovery custody is discharged", () => {
    const recovering = structuredClone(
      retirePreparedCandidate("full-archive"),
    ) as DeepMutable<GameState>;
    if (recovering.endgame.stage !== "recovery") {
      throw new Error("Recovery fixture missing");
    }
    const modelId = recovering.endgame.retiredModelId;
    const artifact = recovering.models[modelId]?.candidateArtifact;
    if (artifact === undefined) throw new Error("Archived artifact missing");
    artifact.hazardPressure = artifact.incidentThreshold + 10;
    const tx = createTransaction(recovering);
    advanceLatentCandidateHazards(tx, alwaysFail);
    const deferred = tx.commit({ description: "defer archive crossing" }).state;
    expect(deferred.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "verified-isolated-archive",
      retirementVerification: "verified",
    });
    expect(deferred.models[modelId]?.candidateArtifact?.activeIncident).toBeUndefined();
    expect(
      deferred.models[modelId]?.candidateArtifact?.hazardPressure ?? 0,
    ).toBeGreaterThan(artifact.incidentThreshold);
  });

  it("keeps the first recovery obligation through a queued second retirement", () => {
    const initial = structuredClone(preparedCandidate()) as DeepMutable<GameState>;
    const firstModelId = candidateId(initial);
    const first = initial.models[firstModelId];
    const lab = initial.labs[initial.run.playerLabId];
    if (first?.candidateArtifact === undefined || lab === undefined) {
      throw new Error("Candidate fixture missing");
    }
    const secondModelId = "run:model:player:queued-retirement" as ModelId;
    const second = structuredClone(first);
    second.id = secondModelId;
    second.displayName = "GBT-1";
    second.flags = {};
    const secondArtifact = second.candidateArtifact;
    if (secondArtifact === undefined) throw new Error("Second artifact missing");
    secondArtifact.modelId = secondModelId;
    secondArtifact.lifecycle = "capability-qualified-latent-candidate";
    secondArtifact.retirementVerification = "not-attempted";
    secondArtifact.retirementAttemptCount = 0;
    secondArtifact.incidentThresholdKey = describeRandomKey(
      randomKey(
        "candidate-hazard-v1",
        initial.engineRulesVersion,
        initial.run.seed,
        secondModelId,
        String(secondArtifact.incidentEpoch),
        "threshold",
      ),
    );
    delete secondArtifact.archiveDisposition;
    delete secondArtifact.activeIncident;
    initial.models[secondModelId] = second;
    lab.models.modelIds.push(secondModelId);

    const firstConfiguration = createTransaction(initial);
    configureCandidateRetirement(
      firstConfiguration,
      firstModelId,
      "staged-isolated-shutdown",
      "filtered-technical-note",
    );
    const firstTransmit = createTransaction(
      firstConfiguration.commit({ description: "configure first retirement" }).state,
    );
    transmitCandidateRetirement(
      firstTransmit,
      content,
      firstModelId,
      "RETIRE GBT-0",
      alwaysPass,
    );
    const queued = firstTransmit.commit({ description: "retire first candidate" }).state;
    expect(queued.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [secondModelId],
    });
    const firstObligation = queued.endgameHistory.recoveryObligation;
    expect(firstObligation?.retiredModelId).toBe(firstModelId);

    const secondTransmit = createTransaction(queued);
    transmitCandidateRetirement(
      secondTransmit,
      content,
      secondModelId,
      "RETIRE GBT-1",
      alwaysPass,
      {
        procedureId: "staged-isolated-shutdown",
        archiveDisposition: "destroy-all-weights",
      },
    );
    const resumed = secondTransmit.commit({
      description: "retire final queued candidate",
    }).state;
    expect(resumed.endgame).toMatchObject({
      stage: "recovery",
      retiredModelId: secondModelId,
    });
    expect(resumed.endgameHistory.recoveryObligation).toMatchObject({
      retiredModelId: secondModelId,
      successorEfficiencyRate: 0.04,
      recoveryStartedAt: firstObligation?.recoveryStartedAt,
    });
    expect(resumed.endgameHistory.recoveryObligation?.recoveryEndsAt ?? 0).toBe(
      (firstObligation?.recoveryEndsAt ?? 0) + 13,
    );
    expect(resumed.endgameHistory.cumulativeCandidateInterventionPressure).toBe(10);
    expect(resumed.labs[resumed.run.playerLabId]?.politics.governmentAttention).toBe(
      Math.min(
        100,
        (queued.labs[queued.run.playerLabId]?.politics.governmentAttention ?? 0) + 10,
      ),
    );
  });

  it("resolves both durable-moratorium outcomes mechanically", () => {
    const successful = structuredClone(
      retirePreparedCandidate("filtered-technical-note"),
    ) as DeepMutable<GameState>;
    if (successful.endgame.stage !== "recovery") throw new Error("Recovery missing");
    successful.run.tick = successful.endgame.recoveryEndsAt;
    successful.run.calendar = calendarFromTick(successful.run.tick);
    const successfulTx = createTransaction(successful);
    choosePostRetirementPath(successfulTx, content, "durable-moratorium", alwaysPass);
    const negotiating = successfulTx.commit({ description: "begin moratorium" }).state;
    if (
      negotiating.endgame.stage !== "recovery" ||
      negotiating.endgame.moratoriumNegotiation === undefined
    ) {
      throw new Error("Negotiation did not begin");
    }
    const successTick = negotiating.endgame.moratoriumNegotiation.resolvesAt;
    const dueSuccess = structuredClone(negotiating) as DeepMutable<GameState>;
    dueSuccess.run.tick = tick(successTick - 1);
    dueSuccess.run.calendar = calendarFromTick(dueSuccess.run.tick);
    const resolutionSuccess = createTransaction(dueSuccess);
    advanceRetirementRecovery(resolutionSuccess, content, alwaysPass);
    resolutionSuccess.update((draft) => {
      draft.run.tick = successTick;
      draft.run.calendar = calendarFromTick(draft.run.tick);
    });
    finaliseEndedRun(resolutionSuccess, content);
    const secured = resolutionSuccess.commit({ description: "secure moratorium" }).state;
    expect(secured.run.status).not.toBe("active");
    expect(secured.run.endingId).toContain("the-long-pause");
    expect(secured.presentationQueue).not.toContainEqual(
      expect.objectContaining({ kind: "moratorium-result" }),
    );

    const failed = structuredClone(
      retirePreparedCandidate("filtered-technical-note"),
    ) as DeepMutable<GameState>;
    if (failed.endgame.stage !== "recovery") throw new Error("Recovery missing");
    failed.run.tick = failed.endgame.recoveryEndsAt;
    failed.run.calendar = calendarFromTick(failed.run.tick);
    const trustBefore = failed.labs[failed.run.playerLabId]?.politics.governmentTrust;
    const attentionBefore =
      failed.labs[failed.run.playerLabId]?.politics.governmentAttention;
    const failedTx = createTransaction(failed);
    choosePostRetirementPath(failedTx, content, "durable-moratorium", alwaysFail);
    const failedNegotiating = failedTx.commit({
      description: "begin failed moratorium",
    }).state;
    if (
      failedNegotiating.endgame.stage !== "recovery" ||
      failedNegotiating.endgame.moratoriumNegotiation === undefined
    ) {
      throw new Error("Failed negotiation did not begin");
    }
    const dueFailure = structuredClone(failedNegotiating) as DeepMutable<GameState>;
    const failureTick = failedNegotiating.endgame.moratoriumNegotiation.resolvesAt;
    dueFailure.run.tick = tick(failureTick - 1);
    dueFailure.run.calendar = calendarFromTick(dueFailure.run.tick);
    const resolutionFailure = createTransaction(dueFailure);
    advanceRetirementRecovery(resolutionFailure, content, alwaysFail);
    resolutionFailure.update((draft) => {
      draft.run.tick = failureTick;
      draft.run.calendar = calendarFromTick(failureTick);
    });
    const continued = resolutionFailure.commit({ description: "fail moratorium" }).state;
    expect(continued.run.status).toBe("active");
    expect(continued.endgame).toEqual({ stage: "inactive" });
    expect(continued.labs[continued.run.playerLabId]?.politics.governmentTrust).toBe(
      Math.max(0, (trustBefore ?? 0) - 8),
    );
    expect(continued.labs[continued.run.playerLabId]?.politics.governmentAttention).toBe(
      Math.min(100, (attentionBefore ?? 0) + 10),
    );
    expect(continued.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "moratorium-result",
        attention: "modal",
        resultId: "moratorium-failed",
        modelId:
          failedNegotiating.endgame.stage === "recovery"
            ? failedNegotiating.endgame.retiredModelId
            : undefined,
        archiveDisposition: "filtered-technical-note",
      }),
    );
    const advanced = advanceOneTick(continued, content).state;
    expect(advanced.run.tick).toBe(continued.run.tick + 1);
    expect(advanced.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "moratorium-result",
        resultId: "moratorium-failed",
      }),
    );
  });

  it("advances recovery across both weekly phase boundaries", () => {
    const recovering = retirePreparedCandidate("filtered-technical-note");
    const choose = createTransaction(recovering);
    choosePostRetirementPath(choose, content, "successor-programme", alwaysPass);
    const chosen = choose.commit({ description: "choose successor programme" }).state;
    if (chosen.endgame.stage !== "recovery") throw new Error("Recovery fixture missing");
    const retiredModelId = chosen.endgame.retiredModelId;

    const beforeSupervision = structuredClone(chosen) as DeepMutable<GameState>;
    beforeSupervision.run.tick = tick(chosen.endgame.quarantineEndsAt - 1);
    beforeSupervision.run.calendar = calendarFromTick(beforeSupervision.run.tick);
    const supervision = createTransaction(beforeSupervision);
    advanceRetirementRecovery(supervision, content);
    const supervised = supervision.commit({ description: "cross quarantine boundary" });
    expect(supervised.state.endgame.stage).toBe("recovery");
    expect(supervised.domainEvents).toContainEqual({
      kind: "candidate-retirement-recovery-phase-changed",
      modelId: retiredModelId,
      phase: "supervised-rebuild",
    });

    if (supervised.state.endgame.stage !== "recovery") {
      throw new Error("Supervised recovery disappeared");
    }
    const beforeCompletion = structuredClone(supervised.state) as DeepMutable<GameState>;
    beforeCompletion.run.tick = tick(supervised.state.endgame.recoveryEndsAt - 1);
    beforeCompletion.run.calendar = calendarFromTick(beforeCompletion.run.tick);
    const completion = createTransaction(beforeCompletion);
    advanceRetirementRecovery(completion, content);
    const completed = completion.commit({ description: "cross recovery boundary" });
    expect(completed.state.endgame).toEqual({ stage: "inactive" });
    expect(completed.state.endgameHistory.recoveryObligation).toBeUndefined();
    expect(
      calculateProjectCapacity(completed.state, content, completed.state.run.playerLabId)
        .recoveryMajorProjectSlots,
    ).toBe(0);
    expect(completed.domainEvents).toContainEqual({
      kind: "candidate-retirement-recovery-completed",
      modelId: retiredModelId,
    });
  });

  it("interrupts recovery for a new candidate and resumes it after the last activation artifact alarms", () => {
    const recovering = structuredClone(
      retirePreparedCandidate("filtered-technical-note"),
    ) as DeepMutable<GameState>;
    if (recovering.endgame.stage !== "recovery") {
      throw new Error("Recovery fixture missing");
    }
    const retiredModelId = recovering.endgame.retiredModelId;
    const retired = recovering.models[retiredModelId];
    const lab = recovering.labs[recovering.run.playerLabId];
    if (retired?.candidateArtifact === undefined || lab === undefined) {
      throw new Error("Recovery artifact missing");
    }
    const successorId = "run:model:player:recovery-successor" as ModelId;
    const successor = structuredClone(retired);
    successor.id = successorId;
    successor.displayName = "GBT-1";
    successor.flags = {};
    const successorArtifact = successor.candidateArtifact;
    if (successorArtifact === undefined) throw new Error("Successor artifact missing");
    successorArtifact.modelId = successorId;
    successorArtifact.lifecycle = "capability-qualified-latent-candidate";
    successorArtifact.retirementVerification = "not-attempted";
    successorArtifact.retirementAttemptCount = 0;
    successorArtifact.incidentThresholdKey = describeRandomKey(
      randomKey(
        "candidate-hazard-v1",
        recovering.engineRulesVersion,
        recovering.run.seed,
        successorId,
        String(successorArtifact.incidentEpoch),
        "threshold",
      ),
    );
    successorArtifact.hazardPressure = successorArtifact.incidentThreshold + 1;
    delete successorArtifact.archiveDisposition;
    delete successorArtifact.activeIncident;
    recovering.models[successorId] = successor;
    lab.models.modelIds.push(successorId);
    lab.models.currentModelId = successorId;

    const detect = createTransaction(recovering);
    detectAndEnterDeploymentCrisis(detect);
    const interrupted = detect.commit({ description: "interrupt recovery" }).state;
    expect(interrupted.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [successorId],
    });
    expect(interrupted.endgameHistory.recoveryObligation?.retiredModelId).toBe(
      retiredModelId,
    );

    const alarm = createTransaction(interrupted);
    expect(
      resolveCandidatePressureCrossing(
        alarm,
        successorId,
        "weekly-pressure",
        oracleWithDraw(() => 0.5),
      ),
    ).toBe(true);
    const resumed = alarm.commit({ description: "resume interrupted recovery" }).state;
    expect(resumed.endgame).toMatchObject({
      stage: "recovery",
      retiredModelId,
      archiveDisposition: "filtered-technical-note",
    });
    expect(resumed.endgameHistory.recoveryObligation?.retiredModelId).toBe(
      retiredModelId,
    );
    expect(resumed.models[successorId]?.candidateArtifact?.lifecycle).toBe(
      "active-hazard",
    );
  });

  it("keeps hard-cut surprise and staged verification as non-dominating tradeoffs", () => {
    const state = preparedCandidate("genuine");
    const modelId = candidateId(state);
    const completeAttempt = oracleWithDraw((key) =>
      key.segments.at(-1) === "cooperation" ? 0.999 : 0,
    );
    for (const disposition of [
      "destroy-all-weights",
      "filtered-technical-note",
      "full-archive",
    ] as const) {
      const immediate = resolveRetirementGates(
        state,
        modelId,
        "immediate-hard-cut",
        disposition,
        1,
        completeAttempt,
      );
      const isolated = resolveRetirementGates(
        state,
        modelId,
        "staged-isolated-shutdown",
        disposition,
        1,
        completeAttempt,
      );
      expect(immediate.containment).toBeDefined();
      expect(isolated.containment).toBeDefined();
      expect(immediate.verification).toBeDefined();
      expect(isolated.verification).toBeDefined();
      expect(
        (immediate.containment?.strength ?? 0) - (immediate.containment?.difficulty ?? 0),
      ).toBeGreaterThan(
        (isolated.containment?.strength ?? 0) - (isolated.containment?.difficulty ?? 0),
      );
      expect(isolated.cooperation.strength ?? 0).toBeGreaterThan(
        immediate.cooperation.strength ?? 0,
      );
      const immediateVerificationProcedure = immediate.verification?.visibleFactors.find(
        (factor) => factor.id === "procedure",
      )?.value;
      const isolatedVerificationProcedure = isolated.verification?.visibleFactors.find(
        (factor) => factor.id === "procedure",
      )?.value;
      expect(isolatedVerificationProcedure ?? 0).toBeGreaterThan(
        immediateVerificationProcedure ?? 0,
      );
    }
  });

  it("shows prepared crisis defence in the retirement containment audit", () => {
    const prepared = structuredClone(
      preparedCandidate("genuine"),
    ) as DeepMutable<GameState>;
    if (prepared.endgame.stage !== "confirmation") {
      throw new Error("Prepared state lost its confirmation crisis");
    }
    prepared.endgame.evidence.defenceBonus = 9;
    const modelId = candidateId(prepared);
    const resisted = oracleWithDraw((key) =>
      key.segments.at(-1) === "cooperation" ? 0.999 : 0,
    );
    const withPreparation = resolveRetirementGates(
      prepared,
      modelId,
      "staged-isolated-shutdown",
      "full-archive",
      1,
      resisted,
    );

    expect(
      withPreparation.containment?.visibleFactors.find(
        (factor) => factor.id === "crisis-defence-bonus",
      ),
    ).toMatchObject({ label: "Prepared crisis defence", value: 9 });

    const withoutPreparation = structuredClone(prepared);
    if (withoutPreparation.endgame.stage !== "confirmation") {
      throw new Error("Prepared state lost its confirmation crisis");
    }
    withoutPreparation.endgame.evidence.defenceBonus = 0;
    const baseline = resolveRetirementGates(
      withoutPreparation,
      modelId,
      "staged-isolated-shutdown",
      "full-archive",
      1,
      resisted,
    );
    expect(
      (withPreparation.containment?.strength ?? 0) -
        (baseline.containment?.strength ?? 0),
    ).toBe(9);
  });
});
