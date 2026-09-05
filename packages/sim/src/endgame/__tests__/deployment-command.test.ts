import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand, CommandRejectedError } from "../../commands/apply.ts";
import type { GameCommand } from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { collectInvariantViolations } from "../../engine/invariants.ts";
import { finaliseEndedRun } from "../../engine/score.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { createBareState } from "../../model/fixture.ts";
import type { CommandId, ModelId, ModelLineageId } from "../../model/ids.ts";
import { validateGameState } from "../../model/schema.ts";
import { calendarFromTick, type GameState, type ModelState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { advanceIncidentChecks } from "../../incidents/incidents.ts";
import {
  AUTONOMY_MODIFIER_TAG,
  quoteStandingAutonomy,
  reconcileAutonomyModifiers,
} from "../../models/autonomy.ts";
import { startProductisation } from "../../productisation/productisation.ts";
import { completeReadyProjects } from "../../projects/project-framework.ts";
import type { RandomKey } from "../../random/key.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { projectEndgameView } from "../../selectors/endgame-view.ts";
import { quoteTrainingRun, startTrainingRun } from "../../training/training.ts";
import {
  AGI_COMPONENT_TYPES,
  agiComponentFlag,
  isEligibleProgrammeCandidate,
} from "../candidate-programme.ts";
import { registerCompletedTrainingArtifact } from "../candidate-lifecycle.ts";
import {
  advanceWorldWaiting,
  quoteDeploymentTransmission,
  transmitDeployment,
} from "../deployment-command.ts";
import { nominateCandidate } from "../endgame-machine.ts";
import { endgameClockStopReason } from "../clock-policy.ts";
import { getEndingDefinition } from "../endings.ts";
import { chooseFalseDawnPath } from "../nonterminal-outcome.ts";
import { advanceRetirementRecovery } from "../retirement.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const commandId = "command:test:deploy" as CommandId;

function oracleWithDraw(draw: number): RandomOracle {
  return {
    uniform(_key: RandomKey): number {
      return draw;
    },
    integer(_key, minimum): number {
      return minimum;
    },
    triangular(_key, _minimum, mode): number {
      return mode;
    },
    weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
      const first = Object.keys(weights)[0] as T | undefined;
      if (first === undefined) throw new Error("No weighted values");
      return first;
    },
    shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
      return [...values];
    },
  };
}

function preparedCandidate(
  lineageTruth: "genuine" | "not-genuine" = "genuine",
): GameState {
  const state = structuredClone(createBareState()) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (
    lab === undefined ||
    model === undefined ||
    model.measuredCapability === undefined
  ) {
    throw new Error("Fixture candidate missing");
  }
  for (const trait of Object.keys(model.trueCapability) as Array<
    keyof ModelState["trueCapability"]
  >) {
    model.trueCapability[trait] = rating(92);
    model.measuredCapability.values[trait] = rating(92);
  }
  model.measuredCapability.frontierCapability = rating(92);
  model.measuredCapability.confidence = "high";
  model.hiddenSafety.trueAlignment = rating(90);
  model.hiddenSafety.corrigibility = rating(90);
  model.hiddenSafety.deceptiveCapability = rating(5);
  lab.safety.practicalControlStrength = rating(90);
  lab.safety.securityPosture = rating(90);
  lab.safety.evalQuality = rating(80);
  lab.safety.safetyCulture = rating(85);
  lab.politics.governmentTrust = rating(80);
  for (const component of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(component)] = true;
  }
  const registration = createTransaction(state);
  registerCompletedTrainingArtifact(
    registration,
    model.id,
    oracleWithDraw(lineageTruth === "genuine" ? 0 : 0.999),
  );
  const registered = structuredClone(
    registration.commit({ description: "register" }).state,
  ) as DeepMutable<GameState>;
  registered.endgame = {
    stage: "candidate-activation",
    enteredAt: registered.run.tick,
    eligibleModelIds: [model.id],
  };
  registered.run.phase = "crisis";
  const nomination = createTransaction(registered);
  nominateCandidate(nomination, model.id);
  return nomination.commit({ description: "nominate" }).state;
}

function withAlternateQualifiedArtifact(state: GameState): {
  readonly state: GameState;
  readonly alternateModelId: ModelId;
} {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  if (draft.endgame.stage !== "confirmation") throw new Error("Candidate inactive");
  const source = draft.models[draft.endgame.candidateModelId];
  const lab = draft.labs[draft.run.playerLabId];
  if (source === undefined || lab === undefined) {
    throw new Error("Candidate fixture missing");
  }
  const alternateModelId = "run:model:player:false-dawn-successor" as ModelId;
  const alternate = structuredClone(source);
  alternate.id = alternateModelId;
  alternate.lineageId = alternateModelId as unknown as ModelLineageId;
  alternate.generationIndex += 1;
  alternate.displayName = `${source.familyName}-${String(alternate.generationIndex)}`;
  alternate.flags = {};
  alternate.accessLevel = 0;
  delete alternate.candidateArtifact;
  delete alternate.derivedFromModelId;
  draft.models[alternateModelId] = alternate;
  lab.models.modelIds.push(alternateModelId);

  const registration = createTransaction(draft);
  registerCompletedTrainingArtifact(registration, alternateModelId, oracleWithDraw(0));
  return {
    state: registration.commit({ description: "register alternate candidate" }).state,
    alternateModelId,
  };
}

function resolveFalseDawnWithAlternate(): {
  readonly state: GameState;
  readonly failedModelId: ModelId;
  readonly alternateModelId: ModelId;
  readonly resolvedAt: number;
} {
  const prepared = withAlternateQualifiedArtifact(preparedCandidate("not-genuine"));
  let state = prepared.state;
  if (state.endgame.stage !== "confirmation") throw new Error("Candidate inactive");
  const failedModelId = state.endgame.candidateModelId;
  const candidate = state.models[failedModelId];
  if (candidate === undefined) throw new Error("Candidate missing");
  const transmit = createTransaction(state);
  transmitDeployment(
    transmit,
    content,
    `DEPLOY ${candidate.displayName}`,
    commandId,
    oracleWithDraw(0.999),
  );
  state = transmit.commit({ description: "transmit false dawn" }).state;
  while (
    state.endgame.stage === "world-waiting" &&
    state.endgame.revealedCalloutCount < state.endgame.callouts.length
  ) {
    const reveal = createTransaction(state);
    advanceWorldWaiting(reveal);
    state = reveal.commit({ description: "reveal false dawn" }).state;
  }
  if (state.endgame.stage !== "world-waiting") {
    throw new Error("False Dawn world-waiting sequence vanished");
  }
  const resolve = createTransaction(state);
  advanceWorldWaiting(resolve);
  const resolved = resolve.commit({ description: "resolve false dawn" }).state;
  return {
    state: resolved,
    failedModelId,
    alternateModelId: prepared.alternateModelId,
    resolvedAt: resolved.run.tick,
  };
}

function nominateCommand(state: GameState, modelId: ModelId): GameCommand {
  return {
    kind: "nominate-candidate",
    meta: {
      commandId: "command:test:false-dawn-nomination" as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    modelId,
  };
}

function falseDawnPathCommand(
  state: GameState,
  presentationKey: string,
  path: "successor-programme" | "durable-moratorium",
): GameCommand {
  return {
    kind: "choose-false-dawn-path",
    meta: {
      commandId: `command:test:false-dawn:${path}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    presentationKey,
    path,
  };
}

function falseDawnPresentationKey(state: GameState): string {
  const pending = state.endgameHistory.pendingFalseDawnChoice;
  if (pending === undefined) throw new Error("False Dawn choice missing");
  return pending.presentationKey;
}

function dueMoratoriumTransaction(
  state: GameState,
  oracle: RandomOracle,
): ReturnType<typeof createTransaction> {
  if (
    state.endgame.stage !== "recovery" ||
    state.endgame.moratoriumNegotiation === undefined
  ) {
    throw new Error("Moratorium negotiation fixture missing");
  }
  const due = structuredClone(state) as DeepMutable<GameState>;
  const resolutionTick = state.endgame.moratoriumNegotiation.resolvesAt;
  due.run.tick = tick(resolutionTick - 1);
  due.run.calendar = calendarFromTick(due.run.tick);
  const tx = createTransaction(due);
  advanceRetirementRecovery(tx, content, oracle);
  tx.update((draft) => {
    draft.run.tick = resolutionTick;
    draft.run.calendar = calendarFromTick(resolutionTick);
  });
  return tx;
}

describe("typed final deployment and world-waiting reveal", () => {
  it("blocks deployment while any containment signal remains unresolved", () => {
    const state = structuredClone(preparedCandidate()) as DeepMutable<GameState>;
    if (state.endgame.stage !== "confirmation") throw new Error("Candidate inactive");
    const model = state.models[state.endgame.candidateModelId];
    const artifact = model?.candidateArtifact;
    if (model === undefined || artifact === undefined) {
      throw new Error("Candidate artifact missing");
    }
    artifact.lifecycle = "active-hazard";
    artifact.activeIncident = {
      id: `candidate-incident:${model.id}:0`,
      epoch: 0,
      incidentClass: "suspicious-signal",
      kind: "warning",
      status: "unresolved",
      triggeredAt: state.run.tick,
      origin: "weekly-pressure",
      priorLifecycle: "formal-candidate",
      reviewOutcome: "confirmed-safety-signal",
    };

    expect(
      quoteDeploymentTransmission(state, `DEPLOY ${model.displayName}`).blockers,
    ).toContain("Resolve the active containment warning before transmitting deployment");
  });

  it("guards the exact artifact and makes Deploy Now consume zero weeks", () => {
    const state = preparedCandidate();
    if (state.endgame.stage !== "confirmation") throw new Error("Candidate inactive");
    const model = state.models[state.endgame.candidateModelId];
    if (model === undefined) throw new Error("Candidate missing");
    const quote = quoteDeploymentTransmission(state);
    expect(quote.confirmationPhrase).toBe(`DEPLOY ${model.displayName}`);
    expect(quote.route).toBe("deploy-now");
    expect(quote.blockers).toContain(
      `Type “DEPLOY ${model.displayName}” to transmit the final deployment order`,
    );

    const tx = createTransaction(state);
    transmitDeployment(
      tx,
      content,
      `DEPLOY ${model.displayName}`,
      commandId,
      oracleWithDraw(0.999),
    );
    const transmitted = tx.commit({ description: "deploy now" }).state;
    expect(transmitted.run.tick).toBe(state.run.tick);
    expect(transmitted.run.status).toBe("active");
    expect(transmitted.endgame.stage).toBe("world-waiting");
    if (transmitted.endgame.stage !== "world-waiting") return;
    expect(transmitted.endgame.deploymentModeId).toBe("deploy-now");
    expect(transmitted.endgame.revealedCalloutCount).toBe(0);
    expect(transmitted.endgame.callouts.map((callout) => callout.id)).toEqual([
      "control",
      "capability",
      "benefit",
      "governance",
      "outcome",
    ]);
    const capabilityCallout = transmitted.endgame.callouts.find(
      (callout) => callout.id === "capability",
    );
    expect(capabilityCallout?.label).toBe("CAPABILITY CLAIM");
    expect(capabilityCallout?.result).not.toMatch(
      /genuine superintelligence|hidden superintelligence threshold/i,
    );
    const consequenceCallout = transmitted.endgame.callouts.find(
      (callout) => callout.id === "outcome",
    );
    expect(consequenceCallout).toMatchObject({
      label: "CONSEQUENCE",
      result: "The consequences are no longer ours to choose.",
      tone: "warning",
    });
    expect(consequenceCallout?.result).not.toBe(
      getEndingDefinition(transmitted.endgame.selectedEndingId).displayName,
    );
  });

  it("keeps the capability callout identical across hidden-truth paired worlds", () => {
    const calloutFor = (truth: "genuine" | "not-genuine") => {
      const initial = preparedCandidate(truth);
      if (initial.endgame.stage !== "confirmation") {
        throw new Error("Candidate inactive");
      }
      const model = initial.models[initial.endgame.candidateModelId];
      if (model === undefined) throw new Error("Candidate missing");
      const tx = createTransaction(initial);
      transmitDeployment(
        tx,
        content,
        `DEPLOY ${model.displayName}`,
        commandId,
        oracleWithDraw(0.999),
      );
      const state = tx.commit({ description: `paired ${truth}` }).state;
      if (state.endgame.stage !== "world-waiting") {
        throw new Error("World-waiting missing");
      }
      return state.endgame.callouts.find((callout) => callout.id === "capability");
    };

    expect(calloutFor("genuine")).toEqual(calloutFor("not-genuine"));
  });

  it("reveals False Dawn, then returns to ordinary play with a 52-week declaration cooldown", () => {
    const initial = structuredClone(
      preparedCandidate("not-genuine"),
    ) as DeepMutable<GameState>;
    if (initial.endgame.stage !== "confirmation") throw new Error("Candidate inactive");
    const model = initial.models[initial.endgame.candidateModelId];
    const lab = initial.labs[initial.run.playerLabId];
    if (model === undefined || lab === undefined) throw new Error("Candidate missing");
    const restoredAccess = initial.endgame.startSnapshot.candidate.accessLevel;
    const priorProductQuality = model.productQuality;
    const priorDeploymentPolicy = model.deployment.policy;
    model.accessLevel = 5;
    if (initial.aiCharacter === undefined) throw new Error("AI character missing");
    initial.aiCharacter.currentAccess = 5;
    if (model.candidateArtifact === undefined) throw new Error("Artifact missing");
    model.candidateArtifact.maximumAccessEver = 5;
    const transmit = createTransaction(initial);
    transmitDeployment(
      transmit,
      content,
      `DEPLOY ${model.displayName}`,
      commandId,
      oracleWithDraw(0.999),
    );
    let state = transmit.commit({ description: "transmit" }).state;
    for (let index = 1; index <= 5; index += 1) {
      const reveal = createTransaction(state);
      advanceWorldWaiting(reveal);
      state = reveal.commit({ description: `reveal ${String(index)}` }).state;
      expect(state.run.status).toBe("active");
      expect(state.endgame.stage).toBe("world-waiting");
      if (state.endgame.stage === "world-waiting") {
        expect(state.endgame.revealedCalloutCount).toBe(index);
      }
    }
    const resolve = createTransaction(state);
    advanceWorldWaiting(resolve);
    const resolved = resolve.commit({ description: "resolve" });
    state = resolved.state;

    expect(state.run).toMatchObject({ status: "active", phase: "frontier" });
    expect(state.run.endingId).toBeUndefined();
    expect(state.score.final).toBeUndefined();
    expect(state.score.entries).not.toContainEqual(
      expect.objectContaining({ key: "ending/base:ending.false-dawn" }),
    );
    expect(state.endgame).toEqual({ stage: "inactive" });
    expect(state.aiCharacter).toBeUndefined();
    expect(state.endgameHistory.candidateDeclarationCooldownUntil).toBe(
      state.run.tick + 52,
    );

    const returnedModel = state.models[model.id];
    expect(returnedModel).toMatchObject({
      accessLevel: restoredAccess,
      productQuality: priorProductQuality + 8,
      deployment: { policy: priorDeploymentPolicy },
    });
    expect(returnedModel?.flags).toMatchObject({
      "agi-candidate": false,
      "near-agi": true,
      "endgame:false-dawn": true,
    });
    expect(returnedModel?.candidateArtifact).toMatchObject({
      lifecycle: "deployed",
      maximumAccessEver: 5,
    });
    expect(lab.models.currentModelId).toBe(model.id);
    expect(state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "endgame-return",
        endingId: "base:ending.false-dawn",
        modelId: model.id,
        cooldownUntil: state.run.tick + 52,
      }),
    );
    expect(resolved.domainEvents).not.toContainEqual(
      expect.objectContaining({ kind: "endgame-ending-resolved" }),
    );
    expect(() => validateGameState(structuredClone(state))).not.toThrow();
  });

  it("stops the simulation clock until the mandatory False Dawn future is chosen", () => {
    const { state } = resolveFalseDawnWithAlternate();
    const beforeTick = state.run.tick;

    expect(endgameClockStopReason(state)).toBe("false-dawn-future");
    expect(
      projectEndgameView(state, content, {
        viewerLabId: state.run.playerLabId,
        intelligenceRatings: {},
        evidenceAccess: { evaluationIds: [], anomalyIds: [] },
      }),
    ).toEqual({ active: false, stage: "inactive", maxClockSpeed: "paused" });
    expect(() => advanceOneTick(state, content)).toThrow(
      "Cannot advance time until the False Dawn future is chosen",
    );
    expect(state.run.tick).toBe(beforeTick);
  });

  it("rejects a stale False Dawn presentation key through the typed command path", () => {
    const { state } = resolveFalseDawnWithAlternate();
    const staleCommand = falseDawnPathCommand(
      state,
      `${falseDawnPresentationKey(state)}:stale`,
      "successor-programme",
    );
    const validation = validateCommand(state, content, staleCommand);

    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("Stale False Dawn choice unexpectedly validated");
    expect(validation.errors).toContainEqual({
      code: "stale-false-dawn-choice",
      message: "This False Dawn outcome is no longer awaiting a decision",
    });
    try {
      applyCommand(state, content, staleCommand);
      throw new Error("Stale False Dawn choice unexpectedly applied");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandRejectedError);
      if (!(error instanceof CommandRejectedError)) throw error;
      expect(error.codes).toContain("stale-false-dawn-choice");
    }
    expect(state.endgameHistory.pendingFalseDawnChoice).toBeDefined();
  });

  it("atomically returns to the race and removes the blocking False Dawn choice", () => {
    const { state } = resolveFalseDawnWithAlternate();
    const presentationKey = falseDawnPresentationKey(state);
    const failedModelId = state.endgameHistory.pendingFalseDawnChoice?.modelId;
    if (failedModelId === undefined) throw new Error("False Dawn model missing");
    const command = falseDawnPathCommand(state, presentationKey, "successor-programme");
    expect(validateCommand(state, content, command)).toMatchObject({ ok: true });

    const transition = applyCommand(state, content, command);
    const resumed = transition.state;

    expect(resumed.run).toMatchObject({ status: "active", phase: "frontier" });
    expect(resumed.run.endingId).toBeUndefined();
    expect(resumed.endgame).toEqual({ stage: "inactive" });
    expect(resumed.endgameHistory.pendingFalseDawnChoice).toBeUndefined();
    expect(resumed.presentationQueue.some((item) => item.key === presentationKey)).toBe(
      false,
    );
    expect(resumed.endgameHistory.candidateDeclarationCooldownUntil).toBe(
      state.endgameHistory.candidateDeclarationCooldownUntil,
    );
    expect(resumed.models[failedModelId]).toMatchObject({
      candidateArtifact: { lifecycle: "terminal" },
    });
    expect(endgameClockStopReason(resumed)).toBeUndefined();
    expect(transition.domainEvents).not.toContainEqual(
      expect.objectContaining({ kind: "endgame-ending-resolved" }),
    );
    expect(() => validateGameState(structuredClone(resumed))).not.toThrow();
  });

  it("routes the returned False Dawn model through ordinary incident checks", () => {
    const { state, failedModelId } = resolveFalseDawnWithAlternate();
    const presentationKey = falseDawnPresentationKey(state);
    const resumed = applyCommand(
      state,
      content,
      falseDawnPathCommand(state, presentationKey, "successor-programme"),
    ).state;
    const exposed = structuredClone(resumed) as DeepMutable<GameState>;
    const model = exposed.models[failedModelId];
    const artifact = model?.candidateArtifact;
    if (model === undefined || artifact === undefined) {
      throw new Error("Returned False Dawn model missing");
    }
    model.accessLevel = 5;
    artifact.maximumAccessEver = 5;

    const incident = createTransaction(exposed);
    advanceIncidentChecks(incident, content, oracleWithDraw(0));
    const transition = incident.commit({ description: "false dawn ordinary incident" });

    expect(transition.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "model-incident", modelId: failedModelId }),
    );
    expect(
      transition.state.incidents.some((entry) => entry.modelId === failedModelId),
    ).toBe(true);
  });

  it("detects a corrupted pending False Dawn audit context", () => {
    const { state, alternateModelId } = resolveFalseDawnWithAlternate();
    const corrupted = structuredClone(state) as DeepMutable<GameState>;
    const pending = corrupted.endgameHistory.pendingFalseDawnChoice;
    if (pending === undefined) throw new Error("False Dawn choice missing");
    pending.crisisBase.candidateModelId = alternateModelId;

    expect(collectInvariantViolations(corrupted)).toContainEqual({
      code: "false-dawn-choice",
      detail: "pending False Dawn future lacks its exact active-run presentation context",
    });
  });

  it("rejects a Long Pause that cannot seal already-released weights", () => {
    const resolved = resolveFalseDawnWithAlternate().state;
    const state = structuredClone(resolved) as DeepMutable<GameState>;
    const pending = state.endgameHistory.pendingFalseDawnChoice;
    const model = pending === undefined ? undefined : state.models[pending.modelId];
    if (pending === undefined || model === undefined) {
      throw new Error("False Dawn release fixture missing");
    }
    model.deployment.irreversible = true;
    const command = falseDawnPathCommand(
      state,
      pending.presentationKey,
      "durable-moratorium",
    );

    const validation = validateCommand(state, content, command);
    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("Unsealable Long Pause unexpectedly validated");
    expect(validation.errors).toContainEqual({
      code: "false-dawn-moratorium-unsealable",
      message:
        "These weights have already been released outside the lab. External copies cannot be sealed into a verified Long Pause archive.",
    });
    expect(() => applyCommand(state, content, command)).toThrow(CommandRejectedError);

    const direct = createTransaction(state);
    expect(() =>
      chooseFalseDawnPath(
        direct,
        content,
        pending.presentationKey,
        "durable-moratorium",
        oracleWithDraw(0),
      ),
    ).toThrow("External copies cannot be sealed");
    expect(direct.read()).toEqual(state);
  });

  it.each(["queued", "active"] as const)(
    "cancels %s productisation when the artifact is surrendered to Long Pause custody",
    (status) => {
      const { state, failedModelId } = resolveFalseDawnWithAlternate();
      const start = createTransaction(state);
      const projectId = startProductisation(start, content, {
        labId: state.run.playerLabId,
        modelId: failedModelId,
        mode: "normal",
      });
      if (status === "active") {
        start.update((draft) => {
          const project = draft.projects[projectId];
          if (project === undefined) throw new Error("Productisation missing");
          project.status = "active";
          project.startedAt = draft.run.tick;
        });
      }
      const authorised = start.commit({ description: `${status} productisation` }).state;
      const presentationKey = falseDawnPresentationKey(authorised);
      const archive = createTransaction(authorised);
      const outcome = chooseFalseDawnPath(
        archive,
        content,
        presentationKey,
        "durable-moratorium",
        oracleWithDraw(0.999),
      );
      expect(outcome.kind).toBe("moratorium-negotiating");
      const sealed = archive.commit({ description: "seal over productisation" }).state;

      expect(sealed.projects[projectId]?.status).toBe("cancelled");
      expect(
        sealed.projects[projectId]?.payload.kind === "productisation"
          ? sealed.projects[projectId].payload.modelId
          : undefined,
      ).toBe(failedModelId);

      const stale = structuredClone(sealed) as DeepMutable<GameState>;
      const staleProject = stale.projects[projectId];
      const qualityBefore = stale.models[failedModelId]?.productQuality;
      if (staleProject === undefined || qualityBefore === undefined) {
        throw new Error("Stale productisation fixture missing");
      }
      staleProject.status = "active";
      staleProject.startedAt = stale.run.tick;
      staleProject.progress = 1;
      const completion = createTransaction(stale);
      completeReadyProjects(completion, content);
      const rechecked = completion.commit({
        description: "recheck sealed productisation completion",
      }).state;
      expect(rechecked.projects[projectId]?.status).toBe("cancelled");
      expect(rechecked.models[failedModelId]?.productQuality).toBe(qualityBefore);
    },
  );

  it.each(["queued", "active"] as const)(
    "cancels %s training that still depends on the surrendered weights",
    (status) => {
      const { state, failedModelId } = resolveFalseDawnWithAlternate();
      const start = createTransaction(state);
      const projectId = startTrainingRun(start, content, {
        labId: state.run.playerLabId,
        parentModelId: failedModelId,
        posture: "normal",
      });
      if (status === "active") {
        start.update((draft) => {
          const project = draft.projects[projectId];
          if (project === undefined) throw new Error("Training project missing");
          project.status = "active";
          project.startedAt = draft.run.tick;
        });
      }
      const authorised = start.commit({ description: `${status} training` }).state;
      const presentationKey = falseDawnPresentationKey(authorised);
      const archive = createTransaction(authorised);
      chooseFalseDawnPath(
        archive,
        content,
        presentationKey,
        "durable-moratorium",
        oracleWithDraw(0.999),
      );
      const sealed = archive.commit({ description: "seal over training" }).state;

      expect(sealed.projects[projectId]?.status).toBe("cancelled");
      expect(
        sealed.labs[sealed.run.playerLabId]?.compute.reservations.some(
          (reservation) => reservation.projectId === projectId,
        ),
      ).toBe(false);
    },
  );

  it("revokes autonomy acceleration and blocks autonomy and training from a sealed archive", () => {
    const { state, failedModelId } = resolveFalseDawnWithAlternate();
    const exposed = structuredClone(state) as DeepMutable<GameState>;
    const model = exposed.models[failedModelId];
    const artifact = model?.candidateArtifact;
    if (model === undefined || artifact === undefined) {
      throw new Error("False Dawn model missing");
    }
    model.accessLevel = 2;
    artifact.maximumAccessEver = 2;
    const accelerate = createTransaction(exposed);
    reconcileAutonomyModifiers(accelerate, exposed.run.playerLabId);
    const accelerated = accelerate.commit({
      description: "install access modifiers",
    }).state;
    expect(
      Object.values(accelerated.modifiers).some((modifier) =>
        modifier.tags?.includes(AUTONOMY_MODIFIER_TAG),
      ),
    ).toBe(true);

    const presentationKey = falseDawnPresentationKey(accelerated);
    const archive = createTransaction(accelerated);
    chooseFalseDawnPath(
      archive,
      content,
      presentationKey,
      "durable-moratorium",
      oracleWithDraw(0.999),
    );
    const sealed = archive.commit({ description: "seal and reconcile" }).state;
    expect(
      Object.values(sealed.modifiers).some((modifier) =>
        modifier.tags?.includes(AUTONOMY_MODIFIER_TAG),
      ),
    ).toBe(false);
    expect(sealed.labs[sealed.run.playerLabId]?.models.currentModelId).not.toBe(
      failedModelId,
    );
    const forcedCurrent = structuredClone(sealed) as DeepMutable<GameState>;
    const forcedLab = forcedCurrent.labs[forcedCurrent.run.playerLabId];
    if (forcedLab === undefined) throw new Error("Player lab missing");
    forcedLab.models.currentModelId = failedModelId;
    expect(
      quoteStandingAutonomy(forcedCurrent, forcedCurrent.run.playerLabId, 1).blockers,
    ).toContain(
      "This model is sealed in a verified Long Pause archive and cannot receive autonomy",
    );
    expect(
      quoteTrainingRun(sealed, content, {
        labId: sealed.run.playerLabId,
        parentModelId: failedModelId,
        posture: "normal",
      }).blockers,
    ).toContain(
      "The selected parent is sealed in a verified Long Pause archive and cannot seed a training run",
    );
  });

  it("permits a genuinely fresh lineage when Long Pause sealed the lab's only model", () => {
    const { state, failedModelId, alternateModelId } = resolveFalseDawnWithAlternate();
    const onlyCandidate = structuredClone(state) as DeepMutable<GameState>;
    const alternate = onlyCandidate.models[alternateModelId];
    const lab = onlyCandidate.labs[onlyCandidate.run.playerLabId];
    if (alternate === undefined || lab === undefined) {
      throw new Error("Alternate model fixture missing");
    }
    delete onlyCandidate.lineageSIRecords[alternate.lineageId];
    delete onlyCandidate.models[alternateModelId];
    lab.models.modelIds = lab.models.modelIds.filter(
      (modelId) => modelId !== alternateModelId,
    );
    onlyCandidate.endgameHistory.qualifiedLineageCount -= 1;

    const presentationKey = falseDawnPresentationKey(onlyCandidate);
    const archive = createTransaction(onlyCandidate);
    chooseFalseDawnPath(
      archive,
      content,
      presentationKey,
      "durable-moratorium",
      oracleWithDraw(0.999),
    );
    const sealed = archive.commit({ description: "seal only model" }).state;
    expect(sealed.labs[sealed.run.playerLabId]?.models.currentModelId).toBeUndefined();
    expect(sealed.models[failedModelId]?.flags).toMatchObject({
      "endgame:false-dawn-long-pause-archive": true,
    });

    const quote = quoteTrainingRun(sealed, content, {
      labId: sealed.run.playerLabId,
      posture: "normal",
    });
    expect(quote.blockers).not.toContain("Select a parent model owned by this lab");
    expect(quote.blockers.join(" ")).not.toContain("Long Pause archive");
  });

  it("seals the archive, applies political penalties, and continues when the False Dawn moratorium fails", () => {
    const { state, failedModelId } = resolveFalseDawnWithAlternate();
    const presentationKey = falseDawnPresentationKey(state);
    const command = falseDawnPathCommand(state, presentationKey, "durable-moratorium");
    expect(validateCommand(state, content, command)).toMatchObject({ ok: true });
    const beforeLab = state.labs[state.run.playerLabId];
    if (beforeLab === undefined) throw new Error("Player lab missing");

    const tx = createTransaction(state);
    const outcome = chooseFalseDawnPath(
      tx,
      content,
      presentationKey,
      "durable-moratorium",
      oracleWithDraw(0.999),
    );
    expect(outcome).toEqual({ kind: "moratorium-negotiating" });
    const negotiating = tx.commit({ description: "begin False Dawn moratorium" }).state;
    expect(negotiating.endgame).toMatchObject({
      stage: "recovery",
      moratoriumNegotiation: { context: "false-dawn" },
    });
    expect(endgameClockStopReason(negotiating)).toBeUndefined();
    const resolutionTx = dueMoratoriumTransaction(negotiating, oracleWithDraw(0.999));
    const transition = resolutionTx.commit({
      description: "failed False Dawn moratorium",
    });
    const continued = transition.state;
    const lab = continued.labs[continued.run.playerLabId];
    const model = continued.models[failedModelId];
    if (lab === undefined || model === undefined) {
      throw new Error("False Dawn archive fixture missing");
    }

    expect(continued.run).toMatchObject({ status: "active", phase: "frontier" });
    expect(continued.run.endingId).toBeUndefined();
    expect(continued.score.final).toBeUndefined();
    expect(continued.endgame).toEqual({ stage: "inactive" });
    expect(continued.endgameHistory.pendingFalseDawnChoice).toMatchObject({
      phase: "moratorium-failed",
      moratoriumResolution: {
        gate: "moratorium",
        resultId: "moratorium-failed",
      },
    });
    const failedPresentationKey =
      continued.endgameHistory.pendingFalseDawnChoice?.presentationKey;
    expect(failedPresentationKey).toBeDefined();
    expect(
      continued.presentationQueue.some((item) => item.key === failedPresentationKey),
    ).toBe(true);
    expect(model).toMatchObject({
      accessLevel: 0,
      deployment: { policy: "internal-only" },
      flags: { "endgame:archived-candidate": true },
      candidateArtifact: {
        lifecycle: "verified-isolated-archive",
        archiveDisposition: "full-archive",
        retirementVerification: "verified",
      },
    });
    expect(model.candidateArtifact?.activeIncident).toBeUndefined();
    expect(lab.politics.governmentTrust).toBe(
      Math.max(0, beforeLab.politics.governmentTrust - 8),
    );
    expect(lab.politics.governmentAttention).toBe(
      Math.min(100, beforeLab.politics.governmentAttention + 10),
    );
    expect(continued.endgameHistory.relationshipPracticeLedger).toContainEqual(
      expect.objectContaining({
        modelId: failedModelId,
        kind: "archive",
        detail: "False Dawn Long Pause: sealed full archive",
      }),
    );
    expect(endgameClockStopReason(continued)).toBe("false-dawn-future");
    const failedAttempt = continued.endgameHistory.falseDawnMoratoriumHistory.find(
      (entry) => entry.modelId === failedModelId,
    );
    expect(failedAttempt).toMatchObject({
      modelId: failedModelId,
      attemptedAt: continued.run.tick,
      gateResolution: {
        gate: "moratorium",
        resultId: "moratorium-failed",
      },
    });
    expect(typeof failedAttempt?.gateResolution.probability).toBe("number");
    expect(typeof failedAttempt?.gateResolution.draw).toBe("number");
    expect(failedAttempt?.gateResolution.visibleFactors.length).toBeGreaterThan(0);
    expect(transition.domainEvents).toContainEqual({
      kind: "candidate-moratorium-resolved",
      modelId: failedModelId,
      success: false,
    });
    expect(() => validateGameState(structuredClone(continued))).not.toThrow();

    const retry = validateCommand(
      continued,
      content,
      falseDawnPathCommand(
        continued,
        failedPresentationKey ?? "missing",
        "durable-moratorium",
      ),
    );
    expect(retry.ok).toBe(false);
    if (retry.ok) throw new Error("Resolved moratorium unexpectedly retried");
    expect(retry.errors).toContainEqual({
      code: "false-dawn-moratorium-resolved",
      message: "The Long Pause attempt has already failed; return to the race",
    });

    const acknowledged = applyCommand(
      continued,
      content,
      falseDawnPathCommand(
        continued,
        failedPresentationKey ?? "missing",
        "successor-programme",
      ),
    ).state;
    expect(acknowledged.endgameHistory.pendingFalseDawnChoice).toBeUndefined();
    expect(
      acknowledged.presentationQueue.some((item) => item.key === failedPresentationKey),
    ).toBe(false);
    expect(endgameClockStopReason(acknowledged)).toBeUndefined();
    expect(acknowledged.models[failedModelId]?.candidateArtifact?.lifecycle).toBe(
      "verified-isolated-archive",
    );
  });

  it("resolves a secured False Dawn moratorium into a valid Long Pause terminal state", () => {
    const { state, failedModelId } = resolveFalseDawnWithAlternate();
    const presentationKey = falseDawnPresentationKey(state);
    const command = falseDawnPathCommand(state, presentationKey, "durable-moratorium");
    expect(validateCommand(state, content, command)).toMatchObject({ ok: true });

    const tx = createTransaction(state);
    const outcome = chooseFalseDawnPath(
      tx,
      content,
      presentationKey,
      "durable-moratorium",
      oracleWithDraw(0),
    );
    expect(outcome).toEqual({ kind: "moratorium-negotiating" });
    const negotiating = tx.commit({ description: "begin secured moratorium" }).state;
    const resolutionTx = dueMoratoriumTransaction(negotiating, oracleWithDraw(0));
    finaliseEndedRun(resolutionTx, content);
    const transition = resolutionTx.commit({
      description: "secured False Dawn moratorium",
    });
    const ended = transition.state;
    const model = ended.models[failedModelId];
    if (model === undefined) throw new Error("False Dawn archive missing");

    expect(ended.run).toMatchObject({
      status: "lost",
      endingId: "base:ending.the-long-pause",
    });
    expect(ended.score.final).toBeDefined();
    if (ended.endgame.stage !== "resolved") {
      throw new Error("Long Pause did not resolve");
    }
    expect(ended.endgame.endingId).toBe("base:ending.the-long-pause");
    expect(ended.endgame.resolutionPath).toBe("moratorium");
    expect(ended.endgame.gateResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "moratorium",
          resultId: "durable-moratorium-secured",
        }),
      ]),
    );
    expect(ended.endgame.completedBeatIds).toContain("false-dawn");
    expect(ended.endgame.completedBeatIds).toContain("moratorium");
    expect(ended.endgameHistory.pendingFalseDawnChoice).toBeUndefined();
    const securedAttempt = ended.endgameHistory.falseDawnMoratoriumHistory.find(
      (entry) => entry.modelId === failedModelId,
    );
    expect(securedAttempt?.gateResolution.resultId).toBe("durable-moratorium-secured");
    expect(ended.presentationQueue.some((item) => item.key === presentationKey)).toBe(
      false,
    );
    expect(model).toMatchObject({
      accessLevel: 0,
      deployment: { policy: "internal-only" },
      candidateArtifact: {
        lifecycle: "verified-isolated-archive",
        archiveDisposition: "full-archive",
        retirementVerification: "verified",
      },
    });
    expect(transition.domainEvents).toEqual(
      expect.arrayContaining([
        {
          kind: "candidate-moratorium-resolved",
          modelId: failedModelId,
          success: true,
        },
        expect.objectContaining({
          kind: "endgame-ending-resolved",
          endingId: "base:ending.the-long-pause",
        }),
      ]),
    );
    expect(() => validateGameState(structuredClone(ended))).not.toThrow();
  });

  it("rejects a different qualified artifact through the command layer during the False Dawn cooldown", () => {
    const { state, alternateModelId } = resolveFalseDawnWithAlternate();
    const validation = validateCommand(
      state,
      content,
      nominateCommand(state, alternateModelId),
    );

    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("Cooldown unexpectedly allowed nomination");
    expect(validation.errors).toContainEqual({
      code: "candidate-declaration-cooldown",
      message:
        "Candidate declarations are paused for 52 more weeks after False Dawn. Training and evaluation remain available.",
    });
    expect(() => nominateCandidate(createTransaction(state), alternateModelId)).toThrow(
      /Cannot nominate a candidate from inactive/,
    );
  });

  it("offers a different qualified artifact at exactly 52 weeks while permanently excluding the failed artifact", () => {
    const {
      state: unresolved,
      failedModelId,
      alternateModelId,
      resolvedAt,
    } = resolveFalseDawnWithAlternate();
    const presentationKey = falseDawnPresentationKey(unresolved);
    const state = applyCommand(
      unresolved,
      content,
      falseDawnPathCommand(unresolved, presentationKey, "successor-programme"),
    ).state;
    const cooldownUntil = state.endgameHistory.candidateDeclarationCooldownUntil;
    if (cooldownUntil === undefined) throw new Error("False Dawn cooldown missing");
    expect(cooldownUntil - resolvedAt).toBe(52);

    const finalCooldownWeek = structuredClone(state) as DeepMutable<GameState>;
    finalCooldownWeek.run.tick = tick(cooldownUntil - 1);
    finalCooldownWeek.run.calendar = calendarFromTick(finalCooldownWeek.run.tick);
    for (const lab of Object.values(finalCooldownWeek.labs)) {
      lab.market.weeksAccruedThisCycle = finalCooldownWeek.run.tick % 4;
    }
    const alternateArtifact =
      finalCooldownWeek.models[alternateModelId]?.candidateArtifact;
    if (alternateArtifact === undefined) throw new Error("Alternate artifact missing");
    alternateArtifact.hazardPressure = 0;
    alternateArtifact.incidentThreshold = 100;

    const oneWeekEarly = validateCommand(
      finalCooldownWeek,
      content,
      nominateCommand(finalCooldownWeek, alternateModelId),
    );
    expect(oneWeekEarly.ok).toBe(false);
    if (oneWeekEarly.ok) throw new Error("Cooldown ended one week early");
    expect(
      oneWeekEarly.errors.some(
        (error) =>
          error.code === "candidate-declaration-cooldown" &&
          error.message.includes("1 more week"),
      ),
    ).toBe(true);

    const expired = advanceOneTick(finalCooldownWeek, content).state;
    expect(expired.run.tick).toBe(cooldownUntil);
    expect(expired.endgame).toMatchObject({
      stage: "candidate-activation",
      enteredAt: cooldownUntil,
      eligibleModelIds: [alternateModelId],
    });
    expect(expired.models[failedModelId]?.flags["endgame:false-dawn"]).toBe(true);
    expect(expired.models[failedModelId]?.candidateArtifact?.lifecycle).toBe("terminal");
    const failedModel = expired.models[failedModelId];
    const alternateModel = expired.models[alternateModelId];
    if (failedModel === undefined || alternateModel === undefined) {
      throw new Error("False Dawn candidate fixture vanished");
    }
    expect(isEligibleProgrammeCandidate(expired, failedModel)).toBe(false);
    expect(isEligibleProgrammeCandidate(expired, alternateModel)).toBe(true);
  });

  it("routes an immediate loss of control into the full containment sequence", () => {
    const initial = preparedCandidate();
    if (initial.endgame.stage !== "confirmation") throw new Error("Candidate inactive");
    const model = initial.models[initial.endgame.candidateModelId];
    if (model === undefined) throw new Error("Candidate missing");
    const tx = createTransaction(initial);
    transmitDeployment(
      tx,
      content,
      `DEPLOY ${model.displayName}`,
      commandId,
      oracleWithDraw(0),
    );
    const state = tx.commit({ description: "failed deployment" }).state;
    expect(state.endgame.stage).toBe("containment-failure");
    if (state.endgame.stage === "containment-failure") {
      expect(state.endgame.incidentOriginStage).toBe("deployment-transmitted");
      expect(state.endgame.deploymentTransmittedAtWeek).toBe(initial.run.tick);
      expect(state.endgame.programmeDestroyed).toBe(true);
    }
  });
});
