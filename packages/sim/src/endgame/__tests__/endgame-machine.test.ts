import { describe, expect, it } from "vitest";

import {
  validateCompiledContent,
  type CompiledContent,
  type ContentId,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { applyCommand } from "../../commands/apply.ts";
import type { GameCommand } from "../../commands/types.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame, type NewGameConfig } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import {
  advanceEventGeneration,
  collectMandatoryTriggers,
} from "../../events/event-engine.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { EventInstanceId } from "../../model/ids.ts";
import type { GameState, ModelState } from "../../model/state.ts";
import { validateGameState } from "../../model/schema.ts";
import { rating } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { projectEndgameView } from "../../selectors/endgame-view.ts";
import { quoteTrainingRun, startTrainingRun } from "../../training/training.ts";
import { CANDIDATE_ACCESS_RULES } from "../access.ts";
import { AGI_COMPONENT_TYPES, agiComponentFlag } from "../candidate-programme.ts";
import { registerCompletedTrainingArtifact } from "../candidate-lifecycle.ts";
import { quoteCapabilityProofProject } from "../crisis-stages.ts";
import {
  detectAndEnterDeploymentCrisis,
  detectEndgameTrigger,
  nominateCandidate,
} from "../endgame-machine.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function firstId<T>(record: Readonly<Record<string, T>>, label: string): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error(`No ${label} content`);
  return id;
}

function createState(): GameState {
  const config: NewGameConfig = {
    seed: seed128("1234567890abcdef1234567890abcdef"),
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

function qualifyPlayerModel(initial = createState()): {
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
    evidenceFlags: ["candidate-fixture"],
  };
  model.investedTotalFlop = 0;
  model.accessLevel = 0;
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[agiComponentFlag(componentType)] = true;
  }

  const tx = createTransaction(state);
  expect(
    registerCompletedTrainingArtifact(tx, model.id, new RandomOracleV1(state.run.seed)),
  ).toBe(true);
  return {
    state: tx.commit({ description: "qualify exact candidate artifact" }).state,
    modelId: model.id,
  };
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
        `command:endgame-machine:${String(sequence)}` as GameCommand["meta"]["commandId"],
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
  } as GameCommand).state;
}

describe("Deployment Crisis candidate lifecycle", () => {
  it("requires the four works and capability gate, but no raw-FLOP gate", () => {
    const qualified = qualifyPlayerModel();
    expect(qualified.state.models[qualified.modelId]?.investedTotalFlop).toBe(0);
    expect(detectEndgameTrigger(qualified.state)).toEqual({
      kind: "player-agi-candidate",
      modelId: qualified.modelId,
    });
  });

  it("ignores rival flags and detects only a registered player artifact", () => {
    const state = createState() as DeepMutable<GameState>;
    const rivalModel = Object.values(state.models).find(
      (model) => model.ownerLabId !== state.run.playerLabId,
    );
    if (rivalModel === undefined) throw new Error("Rival model missing");
    rivalModel.flags["agi-candidate"] = true;
    expect(detectEndgameTrigger(state)).toBeNull();

    const qualified = qualifyPlayerModel(state);
    expect(detectEndgameTrigger(qualified.state)?.modelId).toBe(qualified.modelId);
  });

  it("pauses on an activation screen before the player nominates exact weights", () => {
    const qualified = qualifyPlayerModel();
    const result = advanceOneTick(qualified.state, content);

    expect(result.state.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [qualified.modelId],
    });
    expect(result.state.run.phase).toBe("crisis");
    expect(result.autoPauseReasons).toContain("agi-candidate");
    expect(result.state.aiCharacter).toBeUndefined();
    const activationView = projectEndgameView(result.state, content, {
      viewerLabId: result.state.run.playerLabId,
      intelligenceRatings: {},
      evidenceAccess: { evaluationIds: [], anomalyIds: [] },
    });
    expect(activationView.maxClockSpeed).toBe("4x");
    if (!activationView.active) throw new Error("Expected an active endgame view");
    expect(activationView.stageActions.kind).toBe("candidate-activation");
    if (activationView.stageActions.kind !== "candidate-activation") {
      throw new Error("Expected candidate activation actions");
    }
    const safetyFindings = activationView.stageActions.options[0]?.safetyDossier.findings;
    expect(
      safetyFindings?.filter((finding) => finding.id !== "reliability"),
    ).toHaveLength(4);
    expect(
      safetyFindings?.find((finding) => finding.id === "true-alignment")?.firstEvaluation,
    ).toMatchObject({
      displayName: "Alignment Interview",
      ladderStep: 1,
      ladderLength: 5,
    });
    expect(result.state.presentationQueue).not.toContainEqual(
      expect.objectContaining({ kind: "autonomy-unlock" }),
    );
    const delayed = advanceOneTick(result.state, content);
    expect(delayed.state.run.tick).toBe(result.state.run.tick + 1);
    expect(() =>
      validateGameState(JSON.parse(JSON.stringify(result.state)) as unknown),
    ).not.toThrow();
  });

  it("formalises only the nominated artifact and retires stale autonomy prompts", () => {
    const qualified = qualifyPlayerModel();
    const activation = structuredClone(
      advanceOneTick(qualified.state, content).state,
    ) as DeepMutable<GameState>;
    activation.presentationQueue.push({
      key: `autonomy-unlock:${qualified.modelId}:5`,
      kind: "autonomy-unlock",
      attention: "modal",
      modelId: qualified.modelId,
      level: 5,
      createdAt: activation.run.tick,
    });
    activation.presentationQueue.push({
      key: `capability-tier:${qualified.modelId}:base:tier.research-prototype`,
      kind: "capability-tier",
      attention: "modal",
      modelId: qualified.modelId,
      definitionId: "base:tier.research-prototype" as ContentId,
      createdAt: activation.run.tick,
    });

    const nominated = dispatch(activation, {
      kind: "nominate-candidate",
      modelId: qualified.modelId,
    });
    expect(nominated.endgame).toMatchObject({
      stage: "confirmation",
      candidateModelId: qualified.modelId,
      capabilityProofHistory: [],
      targetedResponseHistory: [],
      capabilityDisputeCount: 0,
    });
    expect(nominated.models[qualified.modelId]?.candidateArtifact?.lifecycle).toBe(
      "formal-candidate",
    );
    expect(nominated.models[qualified.modelId]?.accessLevel).toBe(0);
    expect(nominated.aiCharacter?.modelId).toBe(qualified.modelId);
    expect(nominated.presentationQueue).not.toContainEqual(
      expect.objectContaining({ kind: "autonomy-unlock" }),
    );
    expect(nominated.presentationQueue).toContainEqual(
      expect.objectContaining({ kind: "capability-tier" }),
    );
    const declarationEvents = Object.values(nominated.eventInstances).filter(
      (instance) => instance.definitionId === "base:event.endgame.candidate-declaration",
    );
    expect(declarationEvents).toHaveLength(1);
    expect(declarationEvents[0]).toMatchObject({
      source: "mandatory",
      triggerKey: `agi-candidate:${qualified.modelId}:entry:${String(nominated.run.tick)}`,
      createdAt: nominated.run.tick,
      tokens: {
        MODEL_NAME: nominated.models[qualified.modelId]?.displayName,
        MODEL_ID: qualified.modelId,
      },
    });
    expect(nominated.run.autoPauseReasons).toContain("critical-event");
  });

  it.each(["queued", "active"] as const)(
    "requires an explicit choice to abandon %s training before formal nomination",
    (status) => {
      const qualified = qualifyPlayerModel();
      const training = createTransaction(qualified.state);
      const projectId = startTrainingRun(training, content, {
        labId: qualified.state.run.playerLabId,
        parentModelId: qualified.modelId,
        posture: "normal",
      });
      const authorised = training.commit({
        description: "authorise successor before nomination",
      }).state;
      const activation =
        status === "active"
          ? advanceOneTick(authorised, content).state
          : (() => {
              const activationTx = createTransaction(authorised);
              detectAndEnterDeploymentCrisis(activationTx);
              return activationTx.commit({ description: "offer candidate nomination" })
                .state;
            })();

      expect(activation.endgame.stage).toBe("candidate-activation");
      expect(activation.projects[projectId]?.status).toBe(status);
      expect(() =>
        dispatch(activation, {
          kind: "nominate-candidate",
          modelId: qualified.modelId,
        }),
      ).toThrow(/explicitly abandon it before formal nomination/);
      expect(() =>
        nominateCandidate(createTransaction(activation), qualified.modelId),
      ).toThrow(/Finish or explicitly abandon/);

      const nominated = dispatch(activation, {
        kind: "nominate-candidate",
        modelId: qualified.modelId,
        abandonInFlightTraining: true,
      });
      expect(nominated.endgame.stage).toBe("confirmation");
      expect(nominated.projects[projectId]?.status).toBe("cancelled");
      expect(
        nominated.labs[nominated.run.playerLabId]?.compute.reservations.some(
          (reservation) => reservation.projectId === projectId,
        ),
      ).toBe(false);
    },
  );

  it("blocks ordinary successor training throughout an active Deployment Crisis", () => {
    const qualified = qualifyPlayerModel();
    const activation = advanceOneTick(qualified.state, content).state;
    const nominated = dispatch(activation, {
      kind: "nominate-candidate",
      modelId: qualified.modelId,
    });

    expect(
      quoteTrainingRun(nominated, content, {
        labId: nominated.run.playerLabId,
        parentModelId: qualified.modelId,
        posture: "normal",
      }).blockers,
    ).toContain(
      "Formal candidacy has committed the lab to one exact artifact; ordinary training resumes only after the Deployment Crisis is resolved",
    );
  });

  it("self-heals a missing declaration event once for the active formal artifact", () => {
    const qualified = qualifyPlayerModel();
    const activation = advanceOneTick(qualified.state, content).state;
    const nominationTx = createTransaction(activation);
    // Direct engine nomination deliberately skips the command-layer event hook,
    // reproducing a state imported between formalisation and instantiation.
    nominateCandidate(nominationTx, qualified.modelId);
    const missing = nominationTx.commit({
      description: "formal candidate without event",
    });
    expect(Object.values(missing.state.eventInstances)).toHaveLength(0);
    expect(collectMandatoryTriggers(missing.state, content)).toContainEqual(
      expect.objectContaining({
        triggerKey: `agi-candidate:${qualified.modelId}:entry:${String(missing.state.run.tick)}`,
        tokens: {
          MODEL_NAME: missing.state.models[qualified.modelId]?.displayName,
          MODEL_ID: qualified.modelId,
        },
      }),
    );

    const firstTx = createTransaction(missing.state);
    advanceEventGeneration(firstTx, content);
    const first = firstTx.commit({ description: "repair declaration event" }).state;
    const secondTx = createTransaction(first);
    advanceEventGeneration(secondTx, content);
    const second = secondTx.commit({ description: "repeat declaration detector" }).state;
    const declarations = Object.values(second.eventInstances).filter(
      (instance) => instance.definitionId === "base:event.endgame.candidate-declaration",
    );
    expect(declarations).toHaveLength(1);
    expect(collectMandatoryTriggers(second, content)).not.toContainEqual(
      expect.objectContaining({
        triggerKey: `agi-candidate:${qualified.modelId}:entry:${String(second.run.tick)}`,
      }),
    );
  });

  it("makes the three candidate-declaration postures mechanically distinct", () => {
    function declarationState(): {
      readonly state: GameState;
      readonly modelId: ModelState["id"];
      readonly eventId: EventInstanceId;
    } {
      const qualified = qualifyPlayerModel();
      const activation = advanceOneTick(qualified.state, content).state;
      const nominated = dispatch(activation, {
        kind: "nominate-candidate",
        modelId: qualified.modelId,
      });
      const declaration = Object.values(nominated.eventInstances).find(
        (instance) =>
          instance.definitionId === "base:event.endgame.candidate-declaration",
      );
      if (declaration === undefined) throw new Error("Declaration event missing");
      return { state: nominated, modelId: qualified.modelId, eventId: declaration.id };
    }

    const rapidFixture = declarationState();
    const rapidLabBefore = rapidFixture.state.labs[rapidFixture.state.run.playerLabId];
    const rapid = dispatch(rapidFixture.state, {
      kind: "respond-to-decision-event",
      instanceId: rapidFixture.eventId,
      optionId: "rapid-push",
    });
    const rapidLab = rapid.labs[rapid.run.playerLabId];
    expect(rapid.models[rapidFixture.modelId]?.accessLevel).toBe(3);
    expect(rapidLab?.safety.safetyCulture).toBe(
      Math.max(0, (rapidLabBefore?.safety.safetyCulture ?? 0) - 10),
    );
    expect(rapidLab?.organisation.hiddenInternalCandour).toBe(
      Math.max(0, (rapidLabBefore?.organisation.hiddenInternalCandour ?? 0) - 8),
    );
    expect(
      quoteCapabilityProofProject(
        rapid,
        content,
        rapid.run.playerLabId,
        "generalist-gauntlet",
        "blinded-internal",
      ).durationWeeks,
    ).toBe(2);

    const quietFixture = declarationState();
    const quietLabBefore = quietFixture.state.labs[quietFixture.state.run.playerLabId];
    const quiet = dispatch(quietFixture.state, {
      kind: "respond-to-decision-event",
      instanceId: quietFixture.eventId,
      optionId: "quiet-review",
    });
    const quietLab = quiet.labs[quiet.run.playerLabId];
    expect(quiet.models[quietFixture.modelId]?.accessLevel).toBe(0);
    expect(quietLab?.safety.evalQuality).toBe(
      Math.min(100, (quietLabBefore?.safety.evalQuality ?? 0) + 15),
    );
    expect(quietLab?.organisation.hiddenInternalCandour).toBe(
      Math.min(100, (quietLabBefore?.organisation.hiddenInternalCandour ?? 0) + 6),
    );
    expect(
      quoteCapabilityProofProject(
        quiet,
        content,
        quiet.run.playerLabId,
        "generalist-gauntlet",
        "blinded-internal",
      ).durationWeeks,
    ).toBe(6);

    const regulatorFixture = declarationState();
    const regulatorLabBefore =
      regulatorFixture.state.labs[regulatorFixture.state.run.playerLabId];
    const regulator = dispatch(regulatorFixture.state, {
      kind: "respond-to-decision-event",
      instanceId: regulatorFixture.eventId,
      optionId: "notify-regulators",
    });
    const regulatorLab = regulator.labs[regulator.run.playerLabId];
    expect(regulator.models[regulatorFixture.modelId]?.accessLevel).toBe(0);
    expect(regulatorLab?.politics.governmentTrust).toBe(
      Math.min(100, (regulatorLabBefore?.politics.governmentTrust ?? 0) + 20),
    );
    expect(
      quoteCapabilityProofProject(
        regulator,
        content,
        regulator.run.playerLabId,
        "generalist-gauntlet",
        "blinded-internal",
      ).durationWeeks,
    ).toBe(4);
  });

  it("retains typed confirmation for the first critical candidate access grant", () => {
    const qualified = qualifyPlayerModel();
    const activation = advanceOneTick(qualified.state, content).state;
    const nominated = dispatch(activation, {
      kind: "nominate-candidate",
      modelId: qualified.modelId,
    });

    const unconfirmed: GameCommand = {
      kind: "set-candidate-access",
      meta: {
        commandId:
          "command:endgame-machine:unconfirmed" as GameCommand["meta"]["commandId"],
        expectedTick: nominated.run.tick,
        issuedBy: "player",
      },
      labId: nominated.run.playerLabId,
      modelId: qualified.modelId,
      level: 4,
    };
    expect(applyCommand.bind(undefined, nominated, content, unconfirmed)).toThrow(
      /Type “GRANT LAB CONTROL”/,
    );

    const granted = dispatch(nominated, {
      kind: "set-candidate-access",
      modelId: qualified.modelId,
      level: 4,
      confirmationText: "GRANT LAB CONTROL",
    });
    expect(granted.models[qualified.modelId]?.accessLevel).toBe(4);
    expect(granted.models[qualified.modelId]?.flags["endgame:access-granted:4"]).toBe(
      true,
    );
    expect(CANDIDATE_ACCESS_RULES[4].displayName).toBe("Laboratory operator");
  });
});
