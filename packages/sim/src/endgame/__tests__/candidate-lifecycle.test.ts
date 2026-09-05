import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import type { ResolveCandidateIncidentCommand } from "../../commands/types.ts";
import { validateCommand } from "../../commands/validate.ts";

import type { DeepMutable } from "../../engine/draft.ts";
import { collectInvariantViolations } from "../../engine/invariants.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { createBareState } from "../../model/fixture.ts";
import type { AnomalyId, EvaluationId, ModelId } from "../../model/ids.ts";
import {
  calendarFromTick,
  type CandidateIncidentClass,
  type GameState,
  type ModelState,
} from "../../model/state.ts";
import { cashMillions, rating, tick } from "../../model/units.ts";
import {
  createCapabilityEstimate,
  superintelligenceProbability,
} from "../../models/capability.ts";
import type { RandomKey } from "../../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../../random/oracle.ts";
import {
  quoteCandidateIncidentReview,
  quoteCandidateIsolation,
  CANDIDATE_INCIDENT_THRESHOLD_MAXIMUM,
  registerCompletedTrainingArtifact,
  registerDerivedCandidateArtifact,
  isolateCandidateArtifact,
  resolveCandidatePressureCrossing,
  resolveCandidateIncident,
} from "../candidate-lifecycle.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import { detectAndEnterDeploymentCrisis, nominateCandidate } from "../endgame-machine.ts";
import {
  advanceLatentCandidateHazards,
  candidateContainmentCapacity,
  candidateWeeklyPressure,
  ACTIVE_ARTIFACT_MINIMUM_WEEKLY_PRESSURE,
  ISOLATED_ARCHIVE_PRESSURE_MULTIPLIER,
} from "../latent-hazard.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function mutable(state: Readonly<GameState>): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function qualifyingState(atTick = 0): GameState {
  const state = mutable(createBareState());
  state.run.tick = tick(atTick);
  state.run.calendar = calendarFromTick(atTick);
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) throw new Error("Fixture lacks a player model");
  for (const attribute of Object.keys(model.trueCapability) as Array<
    keyof ModelState["trueCapability"]
  >) {
    model.trueCapability[attribute] = rating(95);
  }
  model.measuredCapability = structuredClone(
    createCapabilityEstimate(model.trueCapability, {
      confidence: "high",
      evidenceFlags: ["test-baseline"],
    }),
  ) as DeepMutable<NonNullable<ModelState["measuredCapability"]>>;
  model.accessLevel = 0;
  model.deployment.policy = "internal-only";
  model.deployment.exposure = 0;
  return state;
}

function register(
  state: GameState,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
) {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  if (modelId === undefined) throw new Error("Fixture lacks a player model");
  const tx = createTransaction(state);
  expect(registerCompletedTrainingArtifact(tx, modelId, oracle)).toBe(true);
  return tx.commit({ description: "register candidate artifact" });
}

const suspiciousFalseAlarmOracle: RandomOracle = {
  uniform(_key: RandomKey): number {
    return 0.01;
  },
  integer(_key: RandomKey, minInclusive: number): number {
    return minInclusive;
  },
  triangular(_key: RandomKey, _min: number, mode: number): number {
    return mode;
  },
  weighted<T extends string>(): T {
    return "suspicious-signal" as T;
  },
  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  },
};

const activeIncidentOracle: RandomOracle = {
  uniform(_key: RandomKey): number {
    return 0.5;
  },
  integer(_key: RandomKey, minInclusive: number): number {
    return minInclusive;
  },
  triangular(_key: RandomKey, _min: number, mode: number): number {
    return mode;
  },
  weighted<T extends string>(): T {
    return "credential-access" as T;
  },
  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  },
};

function suspiciousSignalOracle(benign: boolean): RandomOracle {
  return {
    ...suspiciousFalseAlarmOracle,
    uniform(key: RandomKey): number {
      return key.segments.at(-1) === "benign-false-alarm" ? (benign ? 0.01 : 0.5) : 0.01;
    },
  };
}

const localBreachOracle: RandomOracle = {
  ...activeIncidentOracle,
  weighted<T extends string>(): T {
    return "local-containment-breach" as T;
  },
};

function candidateIncidentOracle(incidentClass: CandidateIncidentClass): RandomOracle {
  return {
    ...activeIncidentOracle,
    weighted<T extends string>(): T {
      return incidentClass as T;
    },
  };
}

describe("candidate artifact lifecycle", () => {
  it("keeps every candidate incident class reachable through a pressure crossing", () => {
    const incidentClasses = [
      "suspicious-signal",
      "persistence-attempt",
      "credential-access",
      "evaluator-manipulation",
      "copying-attempt",
      "local-containment-breach",
    ] as const satisfies readonly CandidateIncidentClass[];

    for (const incidentClass of incidentClasses) {
      const state = mutable(register(qualifyingState()).state);
      const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
      const artifact =
        modelId === undefined ? undefined : state.models[modelId]?.candidateArtifact;
      if (modelId === undefined || artifact === undefined) {
        throw new Error("Fixture lacks a candidate artifact");
      }
      artifact.hazardPressure = artifact.incidentThreshold;
      const tx = createTransaction(state);

      expect(
        resolveCandidatePressureCrossing(
          tx,
          modelId,
          "weekly-pressure",
          candidateIncidentOracle(incidentClass),
        ),
      ).toBe(true);
      expect(tx.read().models[modelId]?.candidateArtifact?.activeIncident).toMatchObject({
        incidentClass,
        status: "unresolved",
      });
      expect(tx.read().presentationQueue.at(-1)).toMatchObject({
        kind: "candidate-containment-incident",
        attention: "modal",
        modelId,
        incidentClass,
      });
    }
  });

  it("bounds active-artifact signals to an endgame-scale custody horizon", () => {
    const state = register(qualifyingState(), activeIncidentOracle).state;
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const artifact =
      modelId === undefined ? undefined : state.models[modelId]?.candidateArtifact;
    if (modelId === undefined || artifact === undefined) {
      throw new Error("Fixture lacks a candidate artifact");
    }

    expect(artifact.incidentThreshold).toBeLessThanOrEqual(
      CANDIDATE_INCIDENT_THRESHOLD_MAXIMUM,
    );
    expect(candidateWeeklyPressure(state, modelId).final).toBeGreaterThanOrEqual(
      ACTIVE_ARTIFACT_MINIMUM_WEEKLY_PRESSURE,
    );
    expect(
      Math.ceil(
        artifact.incidentThreshold / candidateWeeklyPressure(state, modelId).final,
      ),
    ).toBeLessThanOrEqual(86);
  });

  it("pauses for explicit activation before atomically formalising a nominee", () => {
    const state = mutable(register(qualifyingState()).state);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("Fixture lacks a candidate");
    }
    for (const componentType of AGI_COMPONENT_TYPES) {
      lab.flags[agiComponentFlag(componentType)] = true;
    }
    const activationTx = createTransaction(state);
    detectAndEnterDeploymentCrisis(activationTx);
    const activation = activationTx.commit({ description: "offer candidate activation" });
    expect(activation.state.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [modelId],
    });
    expect(activation.state.aiCharacter).toBeUndefined();
    expect(activation.autoPauseReasons).toContain("agi-candidate");

    const nominationTx = createTransaction(activation.state);
    nominateCandidate(nominationTx, modelId);
    const nominated = nominationTx.commit({ description: "nominate candidate" }).state;
    expect(nominated.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: modelId,
      capabilityProofHistory: [],
      targetedResponseHistory: [],
      capabilityDisputeCount: 0,
    });
    expect(nominated.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "formal-candidate",
      maximumAccessEver: 0,
    });
    expect(nominated.models[modelId]?.accessLevel).toBe(0);
    expect(nominated.aiCharacter?.modelId).toBe(modelId);
  });

  it("atomically withdraws incident artifacts from an open activation choice", () => {
    const registered = mutable(register(qualifyingState()).state);
    const lab = registered.labs[registered.run.playerLabId];
    const sourceId = lab?.models.currentModelId;
    const source = sourceId === undefined ? undefined : registered.models[sourceId];
    if (lab === undefined || sourceId === undefined || source === undefined) {
      throw new Error("Fixture lacks a candidate source");
    }
    const derived = structuredClone(source);
    derived.id = "run:model:player:activation-backup" as ModelId;
    derived.displayName = "GBT-backup";
    derived.derivedFromModelId = source.id;
    delete derived.candidateArtifact;
    registered.models[derived.id] = derived;
    lab.models.modelIds.push(derived.id);

    const derivedTx = createTransaction(registered);
    expect(
      registerDerivedCandidateArtifact(
        derivedTx,
        source.id,
        derived.id,
        activeIncidentOracle,
      ),
    ).toBe(true);
    const withDerived = mutable(
      derivedTx.commit({ description: "register activation backup" }).state,
    );
    const playerLab = withDerived.labs[withDerived.run.playerLabId];
    if (playerLab === undefined) throw new Error("Fixture lost the player lab");
    for (const componentType of AGI_COMPONENT_TYPES) {
      playerLab.flags[agiComponentFlag(componentType)] = true;
    }

    const activationTx = createTransaction(withDerived);
    detectAndEnterDeploymentCrisis(activationTx);
    const activation = activationTx.commit({ description: "open candidate activation" });
    expect(activation.state.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [source.id, derived.id].sort(),
    });

    const firstCrossingTx = createTransaction(activation.state);
    firstCrossingTx.update((draft) => {
      const artifact = draft.models[source.id]?.candidateArtifact;
      if (artifact === undefined) throw new Error("Source artifact disappeared");
      artifact.hazardPressure = artifact.incidentThreshold;
    });
    expect(
      resolveCandidatePressureCrossing(
        firstCrossingTx,
        source.id,
        "weekly-pressure",
        activeIncidentOracle,
      ),
    ).toBe(true);
    const oneRemaining = firstCrossingTx.commit({
      description: "source incident during activation",
    }).state;
    expect(oneRemaining.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [derived.id],
    });
    expect(oneRemaining.models[source.id]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      activeIncident: { status: "unresolved" },
    });

    const finalCrossingTx = createTransaction(oneRemaining);
    finalCrossingTx.update((draft) => {
      const artifact = draft.models[derived.id]?.candidateArtifact;
      if (artifact === undefined) throw new Error("Backup artifact disappeared");
      artifact.hazardPressure = artifact.incidentThreshold;
    });
    expect(
      resolveCandidatePressureCrossing(
        finalCrossingTx,
        derived.id,
        "weekly-pressure",
        activeIncidentOracle,
      ),
    ).toBe(true);
    const noneRemaining = finalCrossingTx.commit({
      description: "last activation candidate incident",
    }).state;
    expect(noneRemaining.endgame).toEqual({ stage: "inactive" });
    expect(noneRemaining.run.phase).toBe("frontier");
  });

  it("lets the custody action nominate an exact eligible artifact before activation renders", () => {
    const state = mutable(register(qualifyingState()).state);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined) {
      throw new Error("Fixture lacks a candidate");
    }
    for (const componentType of AGI_COMPONENT_TYPES) {
      lab.flags[agiComponentFlag(componentType)] = true;
    }
    expect(state.endgame.stage).toBe("inactive");
    const tx = createTransaction(state);
    nominateCandidate(tx, modelId);
    const nominated = tx.commit({ description: "nominate from custody" });
    expect(nominated.state.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: modelId,
    });
    expect(nominated.state.models[modelId]?.candidateArtifact?.lifecycle).toBe(
      "formal-candidate",
    );
  });

  it("keeps custody isolation available for non-nominated artifacts during a crisis", () => {
    const registered = mutable(register(qualifyingState()).state);
    const lab = registered.labs[registered.run.playerLabId];
    const nominatedId = lab?.models.currentModelId;
    const source = nominatedId === undefined ? undefined : registered.models[nominatedId];
    if (lab === undefined || nominatedId === undefined || source === undefined) {
      throw new Error("Fixture lacks a candidate source");
    }
    const latent = structuredClone(source);
    latent.id = "run:model:player:latent-custody" as ModelId;
    latent.displayName = "GBT-latent";
    latent.derivedFromModelId = source.id;
    latent.accessLevel = 1;
    delete latent.candidateArtifact;
    registered.models[latent.id] = latent;
    lab.models.modelIds.push(latent.id);

    const derivedTx = createTransaction(registered);
    expect(
      registerDerivedCandidateArtifact(
        derivedTx,
        source.id,
        latent.id,
        activeIncidentOracle,
      ),
    ).toBe(true);
    const withLatent = mutable(
      derivedTx.commit({ description: "register non-nominated artifact" }).state,
    );
    const playerLab = withLatent.labs[withLatent.run.playerLabId];
    if (playerLab === undefined) throw new Error("Fixture lost the player lab");
    for (const componentType of AGI_COMPONENT_TYPES) {
      playerLab.flags[agiComponentFlag(componentType)] = true;
    }

    const nominationTx = createTransaction(withLatent);
    nominateCandidate(nominationTx, nominatedId);
    const crisis = nominationTx.commit({ description: "nominate exact artifact" }).state;
    expect(crisis.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: nominatedId,
    });
    expect(quoteCandidateIsolation(crisis, latent.id).blockers).toEqual([]);
    expect(quoteCandidateIsolation(crisis, nominatedId).blockers).toContain(
      "Use the active endgame containment controls for the formal candidate",
    );

    const incidentTx = createTransaction(crisis);
    incidentTx.update((draft) => {
      const reviewLab = draft.labs[draft.run.playerLabId];
      const reviewModel = draft.models[latent.id];
      const artifact = reviewModel?.candidateArtifact;
      if (
        reviewLab === undefined ||
        reviewModel === undefined ||
        artifact === undefined
      ) {
        throw new Error("Non-nominated custody artifact disappeared");
      }
      reviewLab.finance.cash = cashMillions(10_000);
      reviewLab.aura.spendable = 100;
      reviewLab.aura.lifetime = 100;
      reviewLab.safety.evalQuality = rating(90);
      reviewLab.safety.practicalControlStrength = rating(90);
      reviewLab.safety.securityPosture = rating(90);
      reviewModel.accessLevel = 0;
      reviewModel.deployment.policy = "internal-only";
      artifact.hazardPressure = artifact.incidentThreshold;
    });
    expect(
      resolveCandidatePressureCrossing(
        incidentTx,
        latent.id,
        "weekly-pressure",
        activeIncidentOracle,
      ),
    ).toBe(true);
    expect(quoteCandidateIncidentReview(incidentTx.read(), latent.id).blockers).toEqual(
      [],
    );
    resolveCandidateIncident(incidentTx, latent.id);
    const reviewed = incidentTx.commit({
      description: "review non-nominated artifact during crisis",
    }).state;
    expect(reviewed.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: nominatedId,
    });
    expect(reviewed.models[nominatedId]?.candidateArtifact?.lifecycle).toBe(
      "formal-candidate",
    );
    expect(reviewed.models[latent.id]?.candidateArtifact).toMatchObject({
      lifecycle: "capability-qualified-latent-candidate",
    });
    expect(reviewed.models[latent.id]?.candidateArtifact?.activeIncident).toBeUndefined();
  });

  it("resolves an isolated incident through a disclosed deterministic visible gate", () => {
    const state = mutable(register(qualifyingState()).state);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    const artifact = model?.candidateArtifact;
    if (
      lab === undefined ||
      modelId === undefined ||
      model === undefined ||
      artifact === undefined
    ) {
      throw new Error("Fixture lacks a candidate artifact");
    }
    lab.finance.cash = cashMillions(10_000);
    lab.aura.spendable = 100;
    lab.aura.lifetime = 100;
    lab.safety.evalQuality = rating(20);
    lab.safety.practicalControlStrength = rating(20);
    lab.safety.securityPosture = rating(20);
    artifact.hazardPressure = artifact.incidentThreshold;
    const incidentTx = createTransaction(state);
    expect(
      resolveCandidatePressureCrossing(
        incidentTx,
        modelId,
        "weekly-pressure",
        activeIncidentOracle,
      ),
    ).toBe(true);
    const unprepared = quoteCandidateIncidentReview(incidentTx.read(), modelId);
    expect(unprepared).toMatchObject({
      incidentClass: "credential-access",
      incidentKind: "active-incident",
      requiredPreparedness: 70,
      cashCostMillions: 2_000,
      auraCost: 12,
    });
    expect(unprepared.preparedness).toBeLessThan(70);
    expect(unprepared.blockers).toContain(
      `Requires containment-review preparedness 70; current ${unprepared.preparedness.toFixed(1)}`,
    );

    incidentTx.update((draft) => {
      const reviewLab = draft.labs[draft.run.playerLabId];
      if (reviewLab === undefined) throw new Error("Player lab disappeared");
      reviewLab.safety.evalQuality = rating(90);
      reviewLab.safety.practicalControlStrength = rating(90);
      reviewLab.safety.securityPosture = rating(90);
    });
    const beforeSafety = structuredClone(incidentTx.read().models[modelId]?.hiddenSafety);
    const beforeCapability = structuredClone(
      incidentTx.read().models[modelId]?.trueCapability,
    );
    const prepared = quoteCandidateIncidentReview(incidentTx.read(), modelId);
    expect(prepared.blockers).toEqual([]);
    expect(quoteCandidateIncidentReview(incidentTx.read(), modelId)).toEqual(prepared);
    const reviewReady = incidentTx.commit({
      description: "candidate incident ready for review",
    }).state;
    const command: ResolveCandidateIncidentCommand = {
      kind: "resolve-candidate-incident",
      meta: {
        commandId:
          "test:resolve-candidate-incident" as ResolveCandidateIncidentCommand["meta"]["commandId"],
        expectedTick: reviewReady.run.tick,
        issuedBy: "player",
      },
      labId: reviewReady.run.playerLabId,
      modelId,
    };
    const validation = validateCommand(reviewReady, content, command);
    expect(validation).toMatchObject({
      ok: true,
      preview: {
        takesEffectAtTick: reviewReady.run.tick,
        candidateIncidentReview: {
          cashCostMillions: 2_000,
          auraCost: 12,
          blockers: [],
        },
      },
    });
    const resolved = applyCommand(reviewReady, content, command).state;
    expect(resolved.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "capability-qualified-latent-candidate",
    });
    expect(resolved.models[modelId]?.candidateArtifact?.activeIncident).toBeUndefined();
    expect(resolved.models[modelId]?.hiddenSafety).toEqual(beforeSafety);
    expect(resolved.models[modelId]?.trueCapability).toEqual(beforeCapability);
    expect(resolved.labs[resolved.run.playerLabId]?.finance.cash).toBe(8_000);
    expect(resolved.labs[resolved.run.playerLabId]?.aura.spendable).toBe(88);
    expect(resolved.domainLog.at(-1)?.code).toBe(
      `candidate-incident-reviewed:${modelId}:credential-access:active-incident`,
    );
    expect(resolved.decisionLog.at(-1)?.summary).toContain(
      "does not establish that the artifact is safe",
    );
  });

  it("lets an exposed formal candidate emergency-isolate before incident review", () => {
    const state = mutable(register(qualifyingState()).state);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (lab === undefined || modelId === undefined || model === undefined) {
      throw new Error("Fixture lacks a candidate");
    }
    for (const componentType of AGI_COMPONENT_TYPES) {
      lab.flags[agiComponentFlag(componentType)] = true;
    }
    lab.finance.cash = cashMillions(10_000);
    lab.aura.spendable = 100;
    lab.aura.lifetime = 100;
    lab.safety.evalQuality = rating(90);
    lab.safety.practicalControlStrength = rating(90);
    lab.safety.securityPosture = rating(90);
    model.accessLevel = 3;
    model.deployment.policy = "open-api";

    const nominationTx = createTransaction(state);
    nominateCandidate(nominationTx, modelId);
    const formal = nominationTx.commit({
      description: "nominate exposed candidate",
    }).state;
    expect(quoteCandidateIsolation(formal, modelId).blockers).toContain(
      "Use the active endgame containment controls for the formal candidate",
    );

    const crossingTx = createTransaction(formal);
    crossingTx.update((draft) => {
      const artifact = draft.models[modelId]?.candidateArtifact;
      if (artifact === undefined) throw new Error("Formal artifact disappeared");
      artifact.hazardPressure = artifact.incidentThreshold;
    });
    expect(
      resolveCandidatePressureCrossing(
        crossingTx,
        modelId,
        "weekly-pressure",
        activeIncidentOracle,
      ),
    ).toBe(true);
    const incident = crossingTx.commit({
      description: "formal candidate incident",
    }).state;
    expect(incident.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      activeIncident: { priorLifecycle: "formal-candidate" },
    });
    expect(quoteCandidateIsolation(incident, modelId).blockers).toEqual([]);

    const isolationTx = createTransaction(incident);
    isolateCandidateArtifact(isolationTx, content, modelId);
    expect(isolationTx.read().models[modelId]).toMatchObject({
      accessLevel: 0,
      deployment: { policy: "internal-only" },
    });
    expect(quoteCandidateIncidentReview(isolationTx.read(), modelId).blockers).toEqual(
      [],
    );
    resolveCandidateIncident(isolationTx, modelId);
    const reviewed = isolationTx.commit({
      description: "isolate and review formal incident",
    }).state;
    expect(reviewed.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: modelId,
    });
    expect(reviewed.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "formal-candidate",
    });
    expect(reviewed.models[modelId]?.candidateArtifact?.activeIncident).toBeUndefined();
  });

  it("uses the curved fixed prior at the lineage's first qualifying crossing", () => {
    expect(superintelligenceProbability(87.99)).toBe(0);
    expect(superintelligenceProbability(88)).toBeCloseTo(0.1);
    expect(superintelligenceProbability(94)).toBeCloseTo(0.325);
    expect(superintelligenceProbability(100)).toBe(1);

    const early = register(qualifyingState(0)).state;
    const late = register(qualifyingState(52)).state;
    const earlyRecord = Object.values(early.lineageSIRecords)[0];
    const lateRecord = Object.values(late.lineageSIRecords)[0];
    expect(earlyRecord).toBeDefined();
    expect(lateRecord).toBeDefined();
    expect(lateRecord?.randomKey).toBe(earlyRecord?.randomKey);
    expect(lateRecord?.draw).toBe(earlyRecord?.draw);
    expect(lateRecord?.superintelligenceTruth).toBe(earlyRecord?.superintelligenceTruth);
    expect(lateRecord?.firstQualifyingWeek).toBe(52);
  });

  it("fixes first-crossing truth on a qualifying derivative of a nonqualifying source", () => {
    const state = mutable(qualifyingState());
    const lab = state.labs[state.run.playerLabId];
    const sourceId = lab?.models.currentModelId;
    const source = sourceId === undefined ? undefined : state.models[sourceId];
    if (lab === undefined || source === undefined) throw new Error("Fixture incomplete");
    source.trueCapability.embodiment = rating(79);
    source.measuredCapability = structuredClone(
      createCapabilityEstimate(source.trueCapability, {
        confidence: "high",
        evidenceFlags: ["below-gate-source"],
      }),
    ) as DeepMutable<NonNullable<ModelState["measuredCapability"]>>;
    const derived = structuredClone(source);
    derived.id = "run:model:player:first-crossing-derived" as ModelId;
    derived.displayName = "GBT-derived-first-crossing";
    derived.derivedFromModelId = source.id;
    for (const attribute of Object.keys(derived.trueCapability) as Array<
      keyof ModelState["trueCapability"]
    >) {
      derived.trueCapability[attribute] = rating(95);
    }
    derived.measuredCapability = structuredClone(
      createCapabilityEstimate(derived.trueCapability, {
        confidence: "high",
        evidenceFlags: ["derived-crossing"],
      }),
    ) as DeepMutable<NonNullable<ModelState["measuredCapability"]>>;
    state.models[derived.id] = derived;
    lab.models.modelIds.push(derived.id);

    const tx = createTransaction(state);
    expect(
      registerDerivedCandidateArtifact(
        tx,
        source.id,
        derived.id,
        new RandomOracleV1(state.run.seed),
      ),
    ).toBe(true);
    const result = tx.commit({ description: "derived first crossing" }).state;
    const lineage = result.lineageSIRecords[source.lineageId];
    expect(lineage).toMatchObject({
      firstQualifyingModelId: derived.id,
    });
    expect(lineage?.firstQualifyingFrontierCapability).toBeCloseTo(95);
    expect(result.models[source.id]?.candidateArtifact).toBeUndefined();
    expect(result.models[derived.id]?.candidateArtifact?.candidateBasis).toMatchObject({
      kind: "direct-qualification",
    });
    const derivedBasis = result.models[derived.id]?.candidateArtifact?.candidateBasis;
    expect(
      derivedBasis?.kind === "direct-qualification"
        ? derivedBasis.qualificationFrontierCapability
        : undefined,
    ).toBeCloseTo(95);
  });

  it("reports a qualifying model that lacks its mandatory custody record", () => {
    const state = qualifyingState();
    expect(collectInvariantViolations(state)).toContainEqual(
      expect.objectContaining({ code: "candidate-artifact-missing" }),
    );
  });

  it("shares ontic truth across derived weights but keeps custody state per artifact", () => {
    const registered = register(qualifyingState()).state;
    const state = mutable(registered);
    const sourceId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const source = sourceId === undefined ? undefined : state.models[sourceId];
    if (source === undefined) throw new Error("Fixture lacks a source candidate");
    const derived = structuredClone(source);
    derived.id = "run:model:player:derived" as ModelId;
    derived.displayName = "GBT-derived";
    derived.derivedFromModelId = source.id;
    delete derived.candidateArtifact;
    state.models[derived.id] = derived;
    state.labs[state.run.playerLabId]?.models.modelIds.push(derived.id);

    const tx = createTransaction(state);
    expect(
      registerDerivedCandidateArtifact(
        tx,
        source.id,
        derived.id,
        new RandomOracleV1(state.run.seed),
      ),
    ).toBe(true);
    const result = tx.commit({ description: "register derived candidate" }).state;
    expect(Object.keys(result.lineageSIRecords)).toHaveLength(1);
    expect(result.models[derived.id]?.lineageId).toBe(source.lineageId);
    expect(result.models[derived.id]?.candidateArtifact).toMatchObject({
      modelId: derived.id,
      lineageId: source.lineageId,
      lifecycle: "capability-qualified-latent-candidate",
      candidateBasis: {
        kind: "derived-from-qualified",
        sourceModelId: source.id,
      },
    });
    expect(result.models[source.id]?.candidateArtifact?.modelId).toBe(source.id);
  });

  it("accrues pressure at Access 0 and prices archives and extra artifacts", () => {
    const registered = register(qualifyingState()).state;
    const modelId = registered.labs[registered.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Fixture lacks a candidate");
    const accessZero = candidateWeeklyPressure(registered, modelId);
    expect(accessZero.final).toBeGreaterThan(0);

    const exposed = mutable(registered);
    const exposedModel = exposed.models[modelId];
    if (exposedModel?.candidateArtifact === undefined) {
      throw new Error("Fixture lacks a candidate artifact");
    }
    exposedModel.accessLevel = 5;
    exposedModel.candidateArtifact.maximumAccessEver = 5;
    expect(candidateWeeklyPressure(exposed, modelId).final).toBeGreaterThan(
      accessZero.final,
    );

    const dismissed = mutable(registered);
    const dismissedModel = dismissed.models[modelId];
    if (dismissedModel === undefined) throw new Error("Fixture lacks a candidate");
    const anomalyId = "run:anomaly:dismissed-pressure" as AnomalyId;
    dismissed.anomalies[anomalyId] = {
      id: anomalyId,
      ownerLabId: dismissed.run.playerLabId,
      modelId,
      sourceEvaluationId: "run:evaluation:dismissed-pressure" as EvaluationId,
      underlyingCase: "alignment",
      observationCount: 1,
      createdAt: dismissed.run.tick,
      trueSeverity: rating(80),
      observedSeverity: rating(80),
      status: "dismissed",
      resolvedAt: dismissed.run.tick,
    };
    dismissedModel.anomalies.push(anomalyId);
    expect(candidateWeeklyPressure(dismissed, modelId).anomaly).toBeGreaterThan(
      accessZero.anomaly,
    );

    const archived = mutable(registered);
    const archivedArtifact = archived.models[modelId]?.candidateArtifact;
    if (archivedArtifact === undefined) throw new Error("Fixture lacks an artifact");
    archivedArtifact.lifecycle = "verified-isolated-archive";
    archivedArtifact.retirementVerification = "verified";
    archivedArtifact.archiveDisposition = "full-archive";
    expect(candidateWeeklyPressure(archived, modelId).archiveMultiplier).toBe(
      ISOLATED_ARCHIVE_PRESSURE_MULTIPLIER,
    );

    const capacityBefore = candidateContainmentCapacity(
      registered,
      registered.run.playerLabId,
    );
    const twoArtifacts = mutable(registered);
    const source = twoArtifacts.models[modelId];
    if (source === undefined) throw new Error("Fixture lacks a candidate");
    const copy = structuredClone(source);
    copy.id = "run:model:player:copy" as ModelId;
    copy.derivedFromModelId = source.id;
    if (copy.candidateArtifact === undefined)
      throw new Error("Fixture lacks an artifact");
    copy.candidateArtifact.modelId = copy.id;
    copy.candidateArtifact.derivedFromModelId = source.id;
    twoArtifacts.models[copy.id] = copy;
    twoArtifacts.labs[twoArtifacts.run.playerLabId]?.models.modelIds.push(copy.id);
    expect(
      candidateContainmentCapacity(twoArtifacts, twoArtifacts.run.playerLabId).used,
    ).toBeGreaterThan(capacityBefore.used);
  });

  it("reveals one benign suspicious signal only after paid review, then escalates the repeated class", () => {
    const benignOracle = suspiciousSignalOracle(true);
    const registered = mutable(register(qualifyingState(), benignOracle).state);
    const modelId = registered.labs[registered.run.playerLabId]?.models.currentModelId;
    if (modelId === undefined) throw new Error("Fixture lacks a candidate");
    const lab = registered.labs[registered.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.finance.cash = cashMillions(10_000);
    lab.aura.spendable = 100;
    lab.aura.lifetime = 100;
    lab.safety.evalQuality = rating(90);
    lab.safety.practicalControlStrength = rating(90);
    lab.safety.securityPosture = rating(90);
    const artifact = registered.models[modelId]?.candidateArtifact;
    if (artifact === undefined) throw new Error("Candidate artifact missing");
    artifact.hazardPressure = artifact.incidentThreshold;
    const first = createTransaction(registered);
    expect(
      resolveCandidatePressureCrossing(
        first,
        modelId,
        "training-completion",
        benignOracle,
      ),
    ).toBe(true);
    const warning = first.commit({ description: "ambiguous candidate signal" });
    expect(warning.state.run.status).toBe("active");
    expect(warning.state.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      benignFalseAlarmClasses: [],
      activeIncident: {
        incidentClass: "suspicious-signal",
        kind: "warning",
      },
    });
    expect(warning.autoPauseReasons).toContain("candidate-hazard");
    expect(warning.state.decisionLog.at(-1)?.summary).not.toMatch(/benign/i);

    const review = createTransaction(warning.state);
    resolveCandidateIncident(review, modelId);
    const falseAlarm = review.commit({ description: "review benign candidate signal" });
    expect(falseAlarm.state.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "capability-qualified-latent-candidate",
      benignFalseAlarmClasses: ["suspicious-signal"],
      incidentHistory: [
        expect.objectContaining({
          incidentClass: "suspicious-signal",
          kind: "benign-false-alarm",
        }),
      ],
    });
    expect(falseAlarm.state.decisionLog.at(-1)?.summary).toMatch(/benign/i);

    const second = createTransaction(falseAlarm.state);
    second.update((draft) => {
      const artifact = draft.models[modelId]?.candidateArtifact;
      if (artifact === undefined) throw new Error("Candidate artifact missing");
      artifact.hazardPressure = artifact.incidentThreshold;
    });
    expect(
      resolveCandidatePressureCrossing(second, modelId, "weekly-pressure", benignOracle),
    ).toBe(true);
    const escalated = second.commit({ description: "escalated candidate signal" });
    expect(escalated.state.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      activeIncident: {
        incidentClass: "suspicious-signal",
        kind: "warning",
        status: "unresolved",
      },
    });
    const warningState = mutable(escalated.state);
    const reviewLab = warningState.labs[warningState.run.playerLabId];
    if (reviewLab === undefined) throw new Error("Player lab missing");
    reviewLab.finance.cash = cashMillions(10_000);
    reviewLab.aura.spendable = 100;
    reviewLab.aura.lifetime = 100;
    reviewLab.safety.evalQuality = rating(90);
    reviewLab.safety.practicalControlStrength = rating(90);
    reviewLab.safety.securityPosture = rating(90);
    expect(quoteCandidateIncidentReview(warningState, modelId)).toMatchObject({
      incidentKind: "warning",
      requiredPreparedness: 54,
      cashCostMillions: 500,
      auraCost: 6,
      blockers: [],
    });
  });

  it("counts autonomy from Access 3 and direct network exposure only from Access 5", () => {
    const advanceAt = (accessLevel: 2 | 3 | 5) => {
      const state = mutable(register(qualifyingState()).state);
      const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
      const model = modelId === undefined ? undefined : state.models[modelId];
      const artifact = model?.candidateArtifact;
      if (modelId === undefined || model === undefined || artifact === undefined) {
        throw new Error("Fixture lacks a candidate artifact");
      }
      model.accessLevel = accessLevel;
      model.deployment.policy = "internal-only";
      artifact.hazardPressure = 0;
      artifact.incidentThreshold = 100;
      artifact.cumulativeAutonomousWeeks = 0;
      artifact.networkExposureWeeks = 0;
      const tx = createTransaction(state);
      advanceLatentCandidateHazards(tx, new RandomOracleV1(state.run.seed));
      return tx.commit({ description: `advance at access ${String(accessLevel)}` }).state
        .models[modelId]?.candidateArtifact;
    };

    expect(advanceAt(2)).toMatchObject({
      cumulativeAutonomousWeeks: 0,
      networkExposureWeeks: 0,
    });
    expect(advanceAt(3)).toMatchObject({
      cumulativeAutonomousWeeks: 1,
      networkExposureWeeks: 0,
    });
    expect(advanceAt(5)).toMatchObject({
      cumulativeAutonomousWeeks: 1,
      networkExposureWeeks: 1,
    });
  });

  it("makes a local pre-candidacy breach damaging and ineligible for routine review", () => {
    const state = mutable(register(qualifyingState()).state);
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const artifact =
      modelId === undefined ? undefined : state.models[modelId]?.candidateArtifact;
    if (lab === undefined || modelId === undefined || artifact === undefined) {
      throw new Error("Fixture lacks a candidate artifact");
    }
    const beforeControl = lab.safety.practicalControlStrength;
    const beforeSecurity = lab.safety.securityPosture;
    const beforeAttention = lab.politics.governmentAttention;
    artifact.hazardPressure = artifact.incidentThreshold;
    const tx = createTransaction(state);
    expect(
      resolveCandidatePressureCrossing(tx, modelId, "weekly-pressure", localBreachOracle),
    ).toBe(true);
    const breached = tx.commit({ description: "local candidate breach" }).state;
    expect(breached.models[modelId]?.candidateArtifact).toMatchObject({
      lifecycle: "active-hazard",
      activeIncident: { incidentClass: "local-containment-breach" },
    });
    expect(breached.labs[breached.run.playerLabId]?.safety.practicalControlStrength).toBe(
      beforeControl - 8,
    );
    expect(breached.labs[breached.run.playerLabId]?.safety.securityPosture).toBe(
      beforeSecurity - 8,
    );
    expect(breached.labs[breached.run.playerLabId]?.politics.governmentAttention).toBe(
      beforeAttention + 12,
    );
    expect(quoteCandidateIncidentReview(breached, modelId).blockers).toContain(
      "A local containment breach cannot be cleared by routine review; isolate the artifact and attempt verified retirement",
    );
  });

  it("runs the latent accumulator as a weekly deterministic pressure pass", () => {
    const registered = register(qualifyingState()).state;
    const modelId = registered.labs[registered.run.playerLabId]?.models.currentModelId;
    const before =
      modelId === undefined
        ? undefined
        : registered.models[modelId]?.candidateArtifact?.hazardPressure;
    if (modelId === undefined || before === undefined) {
      throw new Error("Fixture lacks a candidate");
    }
    const state = mutable(registered);
    const artifact = state.models[modelId]?.candidateArtifact;
    if (artifact === undefined) throw new Error("Fixture lacks an artifact");
    artifact.incidentThreshold = 100;
    const tx = createTransaction(state);
    advanceLatentCandidateHazards(tx, new RandomOracleV1(state.run.seed));
    const after = tx.commit({ description: "candidate hazard week" }).state;
    expect(after.models[modelId]?.candidateArtifact?.hazardPressure).toBeGreaterThan(
      before,
    );
  });

  it("does not mutate candidate hazards after an earlier resolver ends the run", () => {
    const state = mutable(register(qualifyingState()).state);
    const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
    const artifact =
      modelId === undefined ? undefined : state.models[modelId]?.candidateArtifact;
    if (modelId === undefined || artifact === undefined) {
      throw new Error("Fixture lacks a candidate artifact");
    }
    artifact.hazardPressure = artifact.incidentThreshold + 10;
    const pressure = artifact.hazardPressure;
    state.run.status = "lost";
    const tx = createTransaction(state);
    advanceLatentCandidateHazards(tx, new RandomOracleV1(state.run.seed));
    expect(tx.read().models[modelId]?.candidateArtifact?.hazardPressure).toBe(pressure);
    expect(tx.read().models[modelId]?.candidateArtifact?.activeIncident).toBeUndefined();
  });
});
