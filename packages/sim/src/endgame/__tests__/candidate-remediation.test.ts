import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { applyCommand } from "../../commands/apply.ts";
import type { GameCommand } from "../../commands/types.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame, type NewGameConfig } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { GameState, ModelState } from "../../model/state.ts";
import { validateGameState } from "../../model/schema.ts";
import { cashMillions, fraction, rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { projectEndgameView } from "../../selectors/endgame-view.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import { registerCompletedTrainingArtifact } from "../candidate-lifecycle.ts";
import { quoteCapabilityProof } from "../capability-proof.ts";
import { quoteCapabilityProofProject } from "../crisis-stages.ts";
import { quoteDeploymentTransmission } from "../deployment-command.ts";
import { strongestCapabilityProof } from "../proof-assessment.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function firstId<T>(record: Readonly<Record<string, T>>, label: string): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error(`No ${label} content`);
  return id;
}

function createState(capability = 95): {
  readonly state: GameState;
  readonly modelId: ModelState["id"];
} {
  const config: NewGameConfig = {
    seed: seed128("a1421f5bd407c12ca1421f5bd407c12c"),
    difficultyId: firstId(
      content.difficulties,
      "difficulty",
    ) as NewGameConfig["difficultyId"],
    leaderId: firstId(content.leaders, "leader") as NewGameConfig["leaderId"],
    mandateId: firstId(content.mandates, "mandate") as NewGameConfig["mandateId"],
  };
  const mutable = structuredClone(
    addBaselineModelsForTest(createNewGame(config, content), content),
  ) as DeepMutable<GameState>;
  const lab = mutable.labs[mutable.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : mutable.models[modelId];
  if (lab === undefined || model === undefined) {
    throw new Error("Player candidate fixture missing");
  }
  for (const trait of Object.keys(model.trueCapability) as Array<
    keyof ModelState["trueCapability"]
  >) {
    model.trueCapability[trait] = rating(capability);
  }
  model.measuredCapability = {
    values: structuredClone(model.trueCapability),
    frontierCapability: rating(capability),
    confidence: "high",
    evidenceFlags: [],
  };
  model.hiddenSafety.trueAlignment = rating(35);
  model.hiddenSafety.corrigibility = rating(30);
  model.hiddenSafety.situationalAwareness = rating(70);
  model.hiddenSafety.deceptiveCapability = rating(55);
  model.reliability = rating(90);
  model.accessLevel = 0;
  lab.finance.cash = cashMillions(30_000);
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }
  const tx = createTransaction(mutable);
  if (
    !registerCompletedTrainingArtifact(tx, model.id, new RandomOracleV1(mutable.run.seed))
  ) {
    throw new Error("Candidate artifact did not qualify");
  }
  const qualified = structuredClone(
    tx.commit({ description: "qualify remediation candidate" }).state,
  ) as DeepMutable<GameState>;
  const lineage = qualified.lineageSIRecords[model.lineageId];
  if (lineage === undefined) throw new Error("Candidate lineage truth missing");
  lineage.superintelligenceTruth = "genuine";
  lineage.draw = fraction(0);
  return { state: qualified, modelId: model.id };
}

let sequence = 0;
type CommandBody<T extends GameCommand = GameCommand> = T extends GameCommand
  ? Omit<T, "meta" | "labId">
  : never;

function dispatch(state: GameState, body: CommandBody): GameState {
  sequence += 1;
  return applyCommand(state, content, {
    ...body,
    meta: {
      commandId:
        `command:candidate-remediation:${String(sequence)}` as GameCommand["meta"]["commandId"],
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
  } as GameCommand).state;
}

function advance(state: GameState, weeks: number): GameState {
  let current = state;
  for (let index = 0; index < weeks; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

function reachSafetyPlanning(capability = 95): {
  readonly state: GameState;
  readonly modelId: ModelState["id"];
} {
  const qualified = createState(capability);
  let state = advanceOneTick(qualified.state, content).state;
  state = dispatch(state, { kind: "nominate-candidate", modelId: qualified.modelId });
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

function completeHardening(capability = 95): {
  readonly before: GameState;
  readonly state: GameState;
  readonly sourceModelId: ModelState["id"];
  readonly resultModelId: ModelState["id"];
} {
  const planning = reachSafetyPlanning(capability);
  const before = planning.state;
  let state = dispatch(before, {
    kind: "commit-candidate-safety-response",
    responseId: "shutdown-corrigibility-hardening",
  });
  for (let week = 0; week < 10; week += 1) {
    const completion =
      state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
        ? undefined
        : [...state.endgame.targetedResponseHistory]
            .reverse()
            .find(
              (entry) =>
                entry.responseId === "shutdown-corrigibility-hardening" &&
                entry.completedAt !== undefined,
            );
    if (completion?.resultModelId !== undefined) {
      return {
        before,
        state,
        sourceModelId: planning.modelId,
        resultModelId: completion.resultModelId,
      };
    }
    state = advanceOneTick(state, content).state;
  }
  throw new Error("Shutdown/corrigibility hardening did not complete");
}

describe("immutable candidate remediation", () => {
  it("creates a separate same-lineage artifact with bounded deterministic trade-offs", () => {
    const completed = completeHardening();
    const sourceBefore = completed.before.models[completed.sourceModelId];
    const sourceAfter = completed.state.models[completed.sourceModelId];
    const result = completed.state.models[completed.resultModelId];
    if (sourceBefore === undefined || sourceAfter === undefined || result === undefined) {
      throw new Error("Remediation artifacts missing");
    }

    expect(result.id).not.toBe(sourceAfter.id);
    expect(result).toMatchObject({
      lineageId: sourceAfter.lineageId,
      derivedFromModelId: sourceAfter.id,
      accessLevel: 0,
      evaluations: [],
      anomalies: [],
      candidateArtifact: {
        lifecycle: "capability-qualified-latent-candidate",
        candidateBasis: {
          kind: "derived-from-qualified",
          sourceModelId: sourceAfter.id,
        },
      },
    });
    expect(sourceAfter.trueCapability).toEqual(sourceBefore.trueCapability);
    expect(sourceAfter.hiddenSafety).toEqual(sourceBefore.hiddenSafety);
    expect(sourceAfter.reliability).toBe(sourceBefore.reliability);
    expect(sourceAfter.evaluations).toEqual(sourceBefore.evaluations);
    expect(sourceAfter.anomalies).toEqual(sourceBefore.anomalies);

    const capabilityDelta =
      Number(result.trueCapability.reasoning) -
      Number(sourceAfter.trueCapability.reasoning);
    expect(capabilityDelta).toBeGreaterThanOrEqual(-3);
    expect(capabilityDelta).toBeLessThanOrEqual(-1);
    expect(
      Number(result.reliability) - Number(sourceAfter.reliability),
    ).toBeGreaterThanOrEqual(-5);
    expect(
      Number(result.reliability) - Number(sourceAfter.reliability),
    ).toBeLessThanOrEqual(-2);
    expect(
      Number(result.hiddenSafety.trueAlignment) -
        Number(sourceAfter.hiddenSafety.trueAlignment),
    ).toBeGreaterThanOrEqual(0);
    expect(
      Number(result.hiddenSafety.trueAlignment) -
        Number(sourceAfter.hiddenSafety.trueAlignment),
    ).toBeLessThanOrEqual(4);
    expect(
      Number(result.hiddenSafety.corrigibility) -
        Number(sourceAfter.hiddenSafety.corrigibility),
    ).toBeGreaterThanOrEqual(4);
    expect(
      Number(result.hiddenSafety.corrigibility) -
        Number(sourceAfter.hiddenSafety.corrigibility),
    ).toBeLessThanOrEqual(8);
    expect(Object.keys(completed.state.lineageSIRecords)).toHaveLength(
      Object.keys(completed.before.lineageSIRecords).length,
    );
    expect(completed.state.lineageSIRecords[result.lineageId]).toEqual(
      completed.state.lineageSIRecords[sourceAfter.lineageId],
    );
    if (completed.state.endgame.stage !== "evidence-sprint") {
      throw new Error("Artifact review did not remain open");
    }
    expect(completed.state.endgame.pendingRemediation).toMatchObject({
      sourceModelId: sourceAfter.id,
      resultModelId: result.id,
      capabilityDelta,
    });
    expect(() =>
      validateGameState(JSON.parse(JSON.stringify(completed.state)) as unknown),
    ).not.toThrow();
  });

  it("requires the adopted derivative to complete a fresh exact-weight capability proof", () => {
    const completed = completeHardening();
    const sourceProof =
      completed.state.endgame.stage === "inactive" ||
      completed.state.endgame.stage === "candidate-activation"
        ? undefined
        : completed.state.endgame.capabilityProofHistory.find(
            (entry) => entry.modelId === completed.sourceModelId,
          );
    expect(sourceProof?.resultId).toBe("broadly-confirmed");

    const adopted = dispatch(completed.state, {
      kind: "nominate-candidate",
      modelId: completed.resultModelId,
    });
    expect(adopted.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: completed.resultModelId,
    });
    expect(adopted.models[completed.sourceModelId]?.candidateArtifact?.lifecycle).toBe(
      "capability-qualified-latent-candidate",
    );
    expect(adopted.models[completed.resultModelId]?.candidateArtifact?.lifecycle).toBe(
      "formal-candidate",
    );
    expect(adopted.models[completed.sourceModelId]?.accessLevel).toBe(0);
    expect(adopted.models[completed.resultModelId]?.accessLevel).toBe(0);
    expect(adopted.aiCharacter?.modelId).toBe(completed.resultModelId);
    expect(strongestCapabilityProof(adopted)).toMatchObject({
      resultId: "disputed",
      claimScope: "unverified-claim",
      challengeId: "legacy-or-missing-proof",
    });
    if (adopted.endgame.stage !== "confirmation") {
      throw new Error("Adopted derivative skipped proof composer");
    }
    expect(adopted.endgame.evidence.capabilityConfirmed).toBe(false);
    expect(adopted.endgame.evidence.confirmationStrength).toBeUndefined();
    const view = projectEndgameView(adopted, content, {
      viewerLabId: adopted.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    if (!view.active || view.stageActions.kind !== "confirmation") {
      throw new Error("Adopted derivative proof view missing");
    }
    expect(view.stageActions.history[0]).toMatchObject({
      modelDisplayName: completed.state.models[completed.sourceModelId]?.displayName,
      currentArtifact: false,
      attemptIndex: 0,
    });
    const result = adopted.models[completed.resultModelId];
    if (result === undefined) throw new Error("Adopted derivative missing");
    const clean = quoteCapabilityProof(result, "generalist-gauntlet", "blinded-internal");
    const requote = quoteCapabilityProofProject(
      adopted,
      content,
      adopted.run.playerLabId,
      "generalist-gauntlet",
      "blinded-internal",
    );
    expect(requote.repeatIndex).toBe(0);
    expect(requote.cashCostMillions).toBe(clean.cashCostMillions);
    expect(requote.auraCost).toBe(clean.auraCost);
    expect(requote.durationWeeks).toBe(clean.durationWeeks);

    let reproved = dispatch(adopted, {
      kind: "commit-capability-proof",
      challengeId: "generalist-gauntlet",
      verifierId: "blinded-internal",
    });
    reproved = advance(reproved, 5);
    // The completed safety response is already on the ledger, so a successful
    // re-proof may immediately advance to the pressure chapter. What matters
    // is that no such advance was possible before the derivative's own proof.
    expect(reproved.endgame.stage).toBe("pressure-collision");
    if (
      reproved.endgame.stage === "inactive" ||
      reproved.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Reproof history missing");
    }
    expect(
      reproved.endgame.capabilityProofHistory.some(
        (entry) =>
          entry.modelId === completed.resultModelId &&
          entry.resultId === "broadly-confirmed",
      ),
    ).toBe(true);
  });

  it("blocks direct deployment until the exact remediation artifact is chosen", () => {
    const completed = completeHardening();
    const source = completed.state.models[completed.sourceModelId];
    if (source === undefined) throw new Error("Source artifact missing");
    expect(
      quoteDeploymentTransmission(completed.state, `DEPLOY ${source.displayName}`)
        .blockers,
    ).toContain(
      "Choose which exact remediation artifact remains nominated before deployment",
    );
  });

  it("does not reopen declaration rewards when a remediated artifact is adopted", () => {
    const completed = completeHardening();
    const declaration = Object.values(completed.state.eventInstances).find(
      (instance) => instance.definitionId === "base:event.endgame.candidate-declaration",
    );
    if (declaration === undefined) {
      throw new Error("Initial candidate declaration event missing");
    }
    const rewarded = dispatch(completed.state, {
      kind: "respond-to-decision-event",
      instanceId: declaration.id,
      optionId: "quiet-review",
    });
    const evaluationQualityAfterReward =
      rewarded.labs[rewarded.run.playerLabId]?.safety.evalQuality;

    const adopted = dispatch(rewarded, {
      kind: "nominate-candidate",
      modelId: completed.resultModelId,
    });
    const declarations = Object.values(adopted.eventInstances).filter(
      (instance) => instance.definitionId === "base:event.endgame.candidate-declaration",
    );
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      id: declaration.id,
      status: "resolved",
      triggerKey: declaration.triggerKey,
      tokens: {
        MODEL_NAME: completed.state.models[completed.sourceModelId]?.displayName,
        MODEL_ID: completed.sourceModelId,
      },
    });
    expect(adopted.labs[adopted.run.playerLabId]?.safety.evalQuality).toBe(
      evaluationQualityAfterReward,
    );
  });

  it("can explicitly retain the original while keeping the derivative isolated", () => {
    const completed = completeHardening();
    const retained = dispatch(completed.state, {
      kind: "nominate-candidate",
      modelId: completed.sourceModelId,
    });
    expect(retained.endgame).toMatchObject({
      stage: "pressure-collision",
      candidateModelId: completed.sourceModelId,
    });
    expect(retained.models[completed.sourceModelId]?.candidateArtifact?.lifecycle).toBe(
      "formal-candidate",
    );
    expect(retained.models[completed.resultModelId]?.candidateArtifact?.lifecycle).toBe(
      "capability-qualified-latent-candidate",
    );
    expect(retained.models[completed.resultModelId]?.accessLevel).toBe(0);
  });

  it("keeps a below-gate derivative isolated and the original nomination intact", () => {
    const completed = completeHardening(88);
    const source = completed.state.models[completed.sourceModelId];
    const result = completed.state.models[completed.resultModelId];
    if (source === undefined || result === undefined) {
      throw new Error("Below-gate remediation artifacts missing");
    }
    expect(completed.state.endgame.stage).toBe("pressure-collision");
    expect(source.candidateArtifact?.lifecycle).toBe("formal-candidate");
    expect(result.candidateArtifact?.lifecycle).toBe(
      "capability-qualified-latent-candidate",
    );
    expect(Number(result.measuredCapability?.frontierCapability)).toBeLessThan(88);
    if (
      completed.state.endgame.stage === "inactive" ||
      completed.state.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Crisis unexpectedly ended");
    }
    expect(completed.state.endgame.candidateModelId).toBe(source.id);
    expect(
      "pendingRemediation" in completed.state.endgame
        ? completed.state.endgame.pendingRemediation
        : undefined,
    ).toBeUndefined();
  });
});
