import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
  type EventDefinition,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { finaliseEndedRun } from "../../engine/score.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { collectMandatoryTriggers } from "../../events/event-engine.ts";
import type { LabId, ModelId, ModelLineageId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  CAPABILITY_ATTRIBUTES,
} from "../../models/capability.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { projectPostRunAudit } from "../../selectors/post-run-audit.ts";
import { projectRivalPublicSignals } from "../signals.ts";
import { queueRivalCandidateSetback } from "../candidate-setback.ts";
import {
  advanceRivalCandidateCountdowns,
  calculateRivalCandidateDuration,
  isRivalAgiCandidate,
  projectRivalCandidateCountdowns,
  rivalCandidateResolutionProbabilities,
  RIVAL_ASCENDANCE_ENDING_ID,
  RIVAL_CATASTROPHE_ENDING_ID,
} from "../candidate-countdown.ts";
import {
  AGI_COMPONENT_TYPES,
  agiComponentFlag,
} from "../../endgame/candidate-programme.ts";
import {
  registerCompletedTrainingArtifact,
  resolveCandidatePressureCrossing,
} from "../../endgame/candidate-lifecycle.ts";
import { advanceLatentCandidateHazards } from "../../endgame/latent-hazard.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(seed = seed128("0123456789abcdef0123456789abcdef")): GameState {
  return addBaselineModelsForTest(
    createNewGame(
      {
        seed,
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
    content,
  );
}

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function firstRival(state: Readonly<GameState>): LabId {
  const labId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
  if (labId === undefined) throw new Error("Rival fixture missing");
  return labId;
}

function setRivalSafetyResearch(
  state: DeepMutable<GameState>,
  labId: LabId,
  level: number,
): void {
  const programmes = state.labs[labId]?.research.safetyPrograms;
  if (programmes === undefined) throw new Error("Rival safety research missing");
  for (const programme of Object.values(programmes)) {
    programme.level = rating(level);
  }
}

function prepareRivalCandidate(
  state: GameState,
  labId = firstRival(state),
): DeepMutable<GameState> {
  const draft = mutable(state);
  const modelId = draft.labs[labId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : draft.models[modelId];
  if (model === undefined) throw new Error("Rival model fixture missing");
  for (const attribute of Object.keys(model.trueCapability) as Array<
    keyof typeof model.trueCapability
  >) {
    model.trueCapability[attribute] = rating(100);
  }
  const rivalLab = draft.labs[labId];
  if (rivalLab !== undefined) {
    for (const componentType of AGI_COMPONENT_TYPES) {
      rivalLab.flags[agiComponentFlag(componentType)] = true;
    }
  }
  return draft;
}

function makeRivalCandidate(state: GameState, labId = firstRival(state)): GameState {
  const draft = prepareRivalCandidate(state, labId);
  const modelId = draft.labs[labId]?.models.currentModelId;
  if (modelId === undefined) throw new Error("Rival model fixture missing");
  const tx = createTransaction(draft);
  if (
    !registerCompletedTrainingArtifact(tx, modelId, new RandomOracleV1(draft.run.seed))
  ) {
    throw new Error("Rival candidate fixture failed qualification");
  }
  return tx.commit({ description: "register rival candidate fixture" }).state;
}

function startCountdown(state: GameState): {
  readonly state: GameState;
  readonly events: ReturnType<typeof createTransaction>["commit"] extends (
    ...args: never[]
  ) => infer Result
    ? Result
    : never;
} {
  const tx = createTransaction(state);
  advanceRivalCandidateCountdowns(tx, new RandomOracleV1(state.run.seed));
  const result = tx.commit({ description: "start rival candidate countdown" });
  return { state: result.state, events: result };
}

class FixedDrawOracle extends RandomOracleV1 {
  private readonly fixedDraw: number;

  constructor(seed: GameState["run"]["seed"], fixedDraw: number) {
    super(seed);
    this.fixedDraw = fixedDraw;
  }

  override uniform(): number {
    return this.fixedDraw;
  }
}

function raceEmergencyDefinition(): EventDefinition {
  return {
    id: contentId("base:event.race-emergency"),
    version: 1,
    category: "rival",
    severity: "urgent",
    phase: "any",
    trigger: { kind: "mandatory", detector: "rival-candidate", priority: 100 },
    prerequisites: { type: "always" },
    baseWeight: 0,
    weightModifiers: [],
    cooldown: { group: "race-emergency", weeks: 0 },
    unique: false,
    expiryWeeks: 4,
    defaultOptionId: "acknowledge",
    titleKey: "event.race-emergency.title",
    bodyKey: "event.race-emergency.body",
    evidence: [],
    tokenBindings: [],
    options: [
      {
        id: "acknowledge",
        labelKey: "event.race-emergency.acknowledge",
        requirements: { type: "always" },
        knownCosts: [],
        previewKey: "event.race-emergency.preview",
        immediateEffects: [],
        checks: [],
        memories: [],
        confirmationRequired: false,
      },
    ],
    followUps: [],
    telemetryTags: ["race-emergency"],
  };
}

describe("rival candidate countdown", () => {
  it("requires every rival capability at 80 and no longer singles out reasoning", () => {
    const complete = makeRivalCandidate(newState());
    const rivalLabId = firstRival(complete);
    const modelId = complete.labs[rivalLabId]?.models.currentModelId;
    const completeModel = modelId === undefined ? undefined : complete.models[modelId];
    if (completeModel === undefined) throw new Error("Rival model fixture missing");
    expect(isRivalAgiCandidate(complete, completeModel)).toBe(true);

    for (const attribute of CAPABILITY_ATTRIBUTES) {
      const belowFloor = prepareRivalCandidate(newState(), rivalLabId);
      const belowId = belowFloor.labs[rivalLabId]?.models.currentModelId;
      const model = belowId === undefined ? undefined : belowFloor.models[belowId];
      if (model === undefined) throw new Error("Rival model fixture missing");
      model.trueCapability[attribute] = rating(
        AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE - 1,
      );
      const tx = createTransaction(belowFloor);
      expect(
        registerCompletedTrainingArtifact(
          tx,
          model.id,
          new RandomOracleV1(belowFloor.run.seed),
        ),
        attribute,
      ).toBe(false);
      expect(isRivalAgiCandidate(tx.read(), model), attribute).toBe(false);
    }

    const reasoningAtCommonFloor = prepareRivalCandidate(newState(), rivalLabId);
    const boundaryId = reasoningAtCommonFloor.labs[rivalLabId]?.models.currentModelId;
    const boundaryModel =
      boundaryId === undefined ? undefined : reasoningAtCommonFloor.models[boundaryId];
    if (boundaryModel === undefined) throw new Error("Rival model fixture missing");
    boundaryModel.trueCapability.reasoning = rating(
      AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
    );
    const boundaryTx = createTransaction(reasoningAtCommonFloor);
    expect(
      registerCompletedTrainingArtifact(
        boundaryTx,
        boundaryModel.id,
        new RandomOracleV1(reasoningAtCommonFloor.run.seed),
      ),
    ).toBe(true);
    const registeredBoundary = boundaryTx.read().models[boundaryModel.id];
    expect(registeredBoundary).toBeDefined();
    expect(
      registeredBoundary === undefined
        ? false
        : isRivalAgiCandidate(boundaryTx.read(), registeredBoundary),
    ).toBe(true);
  });

  it("refuses to start a Deployment Crisis without both capability and all four works", () => {
    const missingWorks = mutable(newState());
    const rivalLabId = firstRival(missingWorks);
    const modelId = missingWorks.labs[rivalLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : missingWorks.models[modelId];
    if (model === undefined) throw new Error("Rival model fixture missing");
    for (const attribute of CAPABILITY_ATTRIBUTES) {
      model.trueCapability[attribute] = rating(95);
    }
    // This stale player-candidate flag was the old bypass.
    model.flags["agi-candidate"] = true;
    const registeredTx = createTransaction(missingWorks);
    expect(
      registerCompletedTrainingArtifact(
        registeredTx,
        model.id,
        new RandomOracleV1(missingWorks.run.seed),
      ),
    ).toBe(true);
    const registeredMissingWorks = registeredTx.commit({
      description: "register capability-only rival fixture",
    }).state;
    expect(
      startCountdown(registeredMissingWorks).state.world.rivals[rivalLabId]
        ?.candidateCountdown,
    ).toBeUndefined();

    const weakModel = prepareRivalCandidate(newState(), rivalLabId);
    const weakModelId = weakModel.labs[rivalLabId]?.models.currentModelId;
    const weak = weakModelId === undefined ? undefined : weakModel.models[weakModelId];
    if (weak === undefined) throw new Error("Rival model fixture missing");
    weak.trueCapability.embodiment = rating(
      AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE - 1,
    );
    const weakTx = createTransaction(weakModel);
    expect(
      registerCompletedTrainingArtifact(
        weakTx,
        weak.id,
        new RandomOracleV1(weakModel.run.seed),
      ),
    ).toBe(false);
    expect(
      startCountdown(weakModel).state.world.rivals[rivalLabId]?.candidateCountdown,
    ).toBeUndefined();

    const belowFrontier = prepareRivalCandidate(newState(), rivalLabId);
    const belowFrontierId = belowFrontier.labs[rivalLabId]?.models.currentModelId;
    const below =
      belowFrontierId === undefined ? undefined : belowFrontier.models[belowFrontierId];
    if (below === undefined) throw new Error("Rival model fixture missing");
    for (const attribute of CAPABILITY_ATTRIBUTES) {
      below.trueCapability[attribute] = rating(87);
    }
    const belowTx = createTransaction(belowFrontier);
    expect(
      registerCompletedTrainingArtifact(
        belowTx,
        below.id,
        new RandomOracleV1(belowFrontier.run.seed),
      ),
    ).toBe(false);
    expect(
      startCountdown(belowFrontier).state.world.rivals[rivalLabId]?.candidateCountdown,
    ).toBeUndefined();
  });

  it("starts a hidden modified countdown and emits a Race Emergency signal", () => {
    const original = makeRivalCandidate(newState());
    const rivalLabId = firstRival(original);
    const expected = calculateRivalCandidateDuration(original, rivalLabId);
    const result = startCountdown(original).events;
    const countdown = result.state.world.rivals[rivalLabId]?.candidateCountdown;
    expect(countdown).toMatchObject({
      startedAt: 0,
      completesAt: expected.finalWeeks,
      status: "active",
      modifiers: expected,
      finalYearWarningIssued: false,
    });
    expect(result.autoPauseReasons).toContain("race-emergency");
    expect(result.autoPauseReasons).toContain("rival-crisis-stage");
    expect(result.state.world.rivalCrisisStageAnnouncements).toContainEqual({
      labId: rivalLabId,
      modelId: countdown?.modelId,
      stage: "confirmation",
      kind: "entered",
      tick: 0,
    });
    expect(result.state.world.rivalSignals.at(-1)?.kind).toBe("candidate");
    const projectedSignal = projectRivalPublicSignals(result.state, {
      [rivalLabId]: 0,
    }).at(-1);
    expect(projectedSignal?.estimateRange[0]).toBeGreaterThanOrEqual(88);
    expect(projectedSignal?.estimateRange[1]).toBeGreaterThanOrEqual(88);
    expect(result.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "rival-candidate-countdown-started",
        labId: rivalLabId,
      }),
    );
  });

  it("deduplicates a persisted setback for the same candidate countdown", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const countdown = started.world.rivals[rivalLabId]?.candidateCountdown;
    if (countdown === undefined) throw new Error("Rival countdown fixture missing");
    const tx = createTransaction(started);
    const input = {
      outcome: "false-dawn" as const,
      labId: rivalLabId,
      modelId: countdown.modelId,
      countdownStartedAt: countdown.startedAt,
    };
    queueRivalCandidateSetback(tx, input);
    queueRivalCandidateSetback(tx, input);
    const result = tx.commit({ description: "deduplicate rival setback" }).state;

    expect(
      result.presentationQueue.filter((item) => item.kind === "rival-candidate-setback"),
    ).toEqual([
      expect.objectContaining({
        kind: "rival-candidate-setback",
        outcome: "false-dawn",
        labId: rivalLabId,
        modelId: countdown.modelId,
        countdownStartedAt: countdown.startedAt,
      }),
    ]);
  });

  it("rejects a stale countdown instead of silently repairing canonical state", () => {
    const started = mutable(startCountdown(makeRivalCandidate(newState())).state);
    const rivalLabId = firstRival(started);
    const modelId = started.world.rivals[rivalLabId]?.candidateCountdown?.modelId;
    if (modelId === undefined) throw new Error("Rival countdown model missing");
    const model = started.models[modelId];
    if (model === undefined) throw new Error("Rival countdown model missing");
    if (model.candidateArtifact === undefined) {
      throw new Error("Rival countdown artifact missing");
    }
    model.candidateArtifact.lifecycle = "capability-qualified-latent-candidate";
    const tx = createTransaction(started);
    expect(() =>
      advanceRivalCandidateCountdowns(tx, new RandomOracleV1(started.run.seed)),
    ).toThrow(/valid formal candidate/);
  });

  it("halts a rival countdown when its actual candidate develops a containment incident", () => {
    const started = mutable(startCountdown(makeRivalCandidate(newState())).state);
    const rivalLabId = firstRival(started);
    const modelId = started.world.rivals[rivalLabId]?.candidateCountdown?.modelId;
    const artifact =
      modelId === undefined ? undefined : started.models[modelId]?.candidateArtifact;
    if (modelId === undefined || artifact === undefined) {
      throw new Error("Rival countdown artifact missing");
    }
    artifact.hazardPressure = artifact.incidentThreshold + 1;
    // This class may be selected, but it may no longer resolve as the one-off
    // benign false alarm, making the regression independent of its keyed draw.
    artifact.benignFalseAlarmClasses.push("suspicious-signal");
    const tx = createTransaction(started);
    expect(
      resolveCandidatePressureCrossing(
        tx,
        modelId,
        "weekly-pressure",
        new RandomOracleV1(started.run.seed),
      ),
    ).toBe(true);
    const result = tx.commit({ description: "interrupt rival candidate process" });
    expect(result.state.world.rivals[rivalLabId]?.candidateCountdown).toBeUndefined();
    expect(result.state.models[modelId]?.candidateArtifact?.lifecycle).toBe(
      "active-hazard",
    );
    expect(result.state.world.rivalSignals).toContainEqual(
      expect.objectContaining({
        labId: rivalLabId,
        kind: "incident",
        subjectId: modelId,
      }),
    );
    expect(result.state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "rival-candidate-setback",
        outcome: "containment-incident",
        labId: rivalLabId,
        modelId,
        countdownStartedAt: 0,
      }),
    );
  });

  it("does not let the weekly custody clock pre-empt the dedicated rival deployment resolver", () => {
    const started = mutable(startCountdown(makeRivalCandidate(newState())).state);
    const rivalLabId = firstRival(started);
    const modelId = started.world.rivals[rivalLabId]?.candidateCountdown?.modelId;
    const artifact =
      modelId === undefined ? undefined : started.models[modelId]?.candidateArtifact;
    if (modelId === undefined || artifact === undefined) {
      throw new Error("Rival countdown artifact missing");
    }
    artifact.hazardPressure = artifact.incidentThreshold + 1;

    const tx = createTransaction(started);
    advanceLatentCandidateHazards(tx, new RandomOracleV1(started.run.seed));
    const result = tx.commit({ description: "advance rival deployment hazards" });

    expect(result.state.world.rivals[rivalLabId]?.candidateCountdown).toMatchObject({
      modelId,
      status: "active",
    });
    expect(result.state.models[modelId]?.candidateArtifact?.lifecycle).toBe(
      "formal-candidate",
    );
    expect(
      result.state.models[modelId]?.candidateArtifact?.hazardPressure,
    ).toBeGreaterThan(artifact.hazardPressure);
  });

  it("defensively removes an obsolete paused countdown when its candidate develops an incident", () => {
    const started = mutable(startCountdown(makeRivalCandidate(newState())).state);
    const rivalLabId = firstRival(started);
    const countdown = started.world.rivals[rivalLabId]?.candidateCountdown;
    const modelId = countdown?.modelId;
    const artifact =
      modelId === undefined ? undefined : started.models[modelId]?.candidateArtifact;
    if (countdown === undefined || modelId === undefined || artifact === undefined) {
      throw new Error("Rival countdown artifact missing");
    }
    countdown.status = "paused";
    countdown.pausedAt = started.run.tick;
    countdown.remainingWeeksAtPause = Math.max(
      0,
      countdown.completesAt - started.run.tick,
    );
    artifact.hazardPressure = artifact.incidentThreshold + 1;
    artifact.benignFalseAlarmClasses.push("suspicious-signal");

    const tx = createTransaction(started);
    expect(
      resolveCandidatePressureCrossing(
        tx,
        modelId,
        "weekly-pressure",
        new RandomOracleV1(started.run.seed),
      ),
    ).toBe(true);
    const result = tx.commit({ description: "interrupt paused rival process" });
    expect(result.state.world.rivals[rivalLabId]?.candidateCountdown).toBeUndefined();
    expect(result.state.models[modelId]?.candidateArtifact?.lifecycle).toBe(
      "active-hazard",
    );
  });

  it("detects an internal successor before it becomes the rival's commercial model", () => {
    const draft = mutable(newState());
    const rivalLabId = firstRival(draft);
    const currentModelId = draft.labs[rivalLabId]?.models.currentModelId;
    const currentModel =
      currentModelId === undefined ? undefined : draft.models[currentModelId];
    if (currentModel === undefined) throw new Error("Rival model fixture missing");
    const candidateId = `${String(currentModelId)}:successor` as ModelId;
    draft.models[candidateId] = structuredClone(currentModel);
    draft.models[candidateId].id = candidateId;
    draft.models[candidateId].lineageId = candidateId as unknown as ModelLineageId;
    delete draft.models[candidateId].candidateArtifact;
    draft.models[candidateId].generationIndex += 1;
    for (const attribute of Object.keys(
      draft.models[candidateId].trueCapability,
    ) as Array<keyof typeof currentModel.trueCapability>) {
      draft.models[candidateId].trueCapability[attribute] = rating(100);
    }
    draft.labs[rivalLabId]?.models.modelIds.push(candidateId);
    const successorLab = draft.labs[rivalLabId];
    if (successorLab !== undefined) {
      for (const componentType of AGI_COMPONENT_TYPES) {
        successorLab.flags[agiComponentFlag(componentType)] = true;
      }
    }

    const registration = createTransaction(draft);
    expect(
      registerCompletedTrainingArtifact(
        registration,
        candidateId,
        new RandomOracleV1(draft.run.seed),
      ),
    ).toBe(true);
    const registered = registration.commit({
      description: "register internal rival successor",
    }).state;
    const result = startCountdown(registered).state;
    expect(result.labs[rivalLabId]?.models.currentModelId).toBe(currentModelId);
    expect(result.world.rivals[rivalLabId]?.candidateCountdown?.modelId).toBe(
      candidateId,
    );
  });

  it("narrows the player-visible range with intelligence without leaking truth", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const low = projectRivalCandidateCountdowns(started, { [rivalLabId]: 0 })[0];
    const high = projectRivalCandidateCountdowns(started, { [rivalLabId]: 100 })[0];
    if (low === undefined || high === undefined) throw new Error("Projection missing");
    expect(low.estimateRangeWeeks[1] - low.estimateRangeWeeks[0]).toBeGreaterThan(
      high.estimateRangeWeeks[1] - high.estimateRangeWeeks[0],
    );
    expect(high.confidence).toBe("high");
    expect(high.stage).toBe("confirmation");
    expect(high.stageLabel).toBe("Confirmation");
    expect(JSON.stringify(low)).not.toMatch(
      /completesAt|estimateNoiseUnit|finalWeeks|actualRemaining/,
    );
  });

  it("announces every Deployment Crisis stage transition exactly once", () => {
    let current = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(current);
    const completesAt = current.world.rivals[rivalLabId]?.candidateCountdown?.completesAt;
    if (completesAt === undefined) throw new Error("Countdown fixture missing");

    for (let week = 1; week < completesAt; week += 1) {
      const due = mutable(current);
      due.run.tick = tick(week);
      due.run.calendar = calendarFromTick(week);
      const tx = createTransaction(due);
      advanceRivalCandidateCountdowns(tx, new RandomOracleV1(due.run.seed));
      current = tx.commit({ description: "advance rival crisis stage" }).state;
    }

    const transitions = current.world.rivalCrisisStageAnnouncements.map(
      (announcement) => ({
        kind: announcement.kind,
        stage: announcement.stage,
        previousStage: announcement.previousStage,
      }),
    );
    expect(transitions).toEqual([
      { kind: "entered", stage: "confirmation", previousStage: undefined },
      {
        kind: "advanced",
        stage: "containment-posture",
        previousStage: "confirmation",
      },
      {
        kind: "advanced",
        stage: "evidence-sprint",
        previousStage: "containment-posture",
      },
      {
        kind: "advanced",
        stage: "pressure-collision",
        previousStage: "evidence-sprint",
      },
      {
        kind: "advanced",
        stage: "final-review",
        previousStage: "pressure-collision",
      },
      {
        kind: "advanced",
        stage: "rollout",
        previousStage: "final-review",
      },
    ]);
    expect(
      new Set(
        current.world.rivalCrisisStageAnnouncements.map(
          (announcement) =>
            `${announcement.labId}:${announcement.modelId}:${announcement.kind}:${announcement.stage}:${String(announcement.tick)}`,
        ),
      ).size,
    ).toBe(current.world.rivalCrisisStageAnnouncements.length);
  });

  it("exposes an explicit mandatory Race Emergency detector for authored content", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const event = raceEmergencyDefinition();
    const eventContent: CompiledContent = {
      ...content,
      events: {
        definitions: { [event.id]: event },
        orderedIds: [event.id],
      },
    };
    const triggers = collectMandatoryTriggers(started, eventContent);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      definitionId: event.id,
      priority: 100,
    });
    expect(triggers[0]?.triggerKey).toBe(`rival-candidate:${firstRival(started)}`);
    expect(triggers[0]?.tokens).toMatchObject({
      RIVAL_LAB_ID: firstRival(started),
    });
  });

  it("turns a non-genuine rival candidacy into a durable False Dawn setback", () => {
    const candidate = prepareRivalCandidate(newState());
    const rivalLabId = firstRival(candidate);
    const modelId = candidate.labs[rivalLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : candidate.models[modelId];
    if (model === undefined) throw new Error("Rival model fixture missing");
    for (const attribute of CAPABILITY_ATTRIBUTES) {
      model.trueCapability[attribute] = rating(95);
    }
    const registration = createTransaction(candidate);
    expect(
      registerCompletedTrainingArtifact(
        registration,
        model.id,
        new FixedDrawOracle(candidate.run.seed, 0.999),
      ),
    ).toBe(true);
    const registered = registration.commit({
      description: "register non-genuine rival candidate",
    }).state;
    expect(registered.lineageSIRecords[model.lineageId]?.superintelligenceTruth).toBe(
      "not-genuine",
    );
    const started = startCountdown(registered).state;
    const countdown = started.world.rivals[rivalLabId]?.candidateCountdown;
    if (countdown === undefined) throw new Error("Rival countdown fixture missing");
    const due = mutable(started);
    due.run.tick = tick(countdown.completesAt);
    due.run.calendar = calendarFromTick(due.run.tick);

    const tx = createTransaction(due);
    advanceRivalCandidateCountdowns(tx, new RandomOracleV1(due.run.seed));
    const result = tx.commit({ description: "rival False Dawn" });

    expect(result.state.run.status).toBe("active");
    expect(result.state.world.rivals[rivalLabId]?.candidateCountdown).toBeUndefined();
    expect(result.state.models[model.id]?.candidateArtifact?.lifecycle).toBe("terminal");
    expect(result.domainEvents).toContainEqual({
      kind: "rival-candidate-false-dawn",
      labId: rivalLabId,
      modelId: model.id,
    });
    expect(result.autoPauseReasons).toContain("race-emergency");
    expect(result.state.presentationQueue).toContainEqual({
      key: `rival-candidate-setback:false-dawn:${rivalLabId}:${model.id}:${String(countdown.startedAt)}`,
      kind: "rival-candidate-setback",
      attention: "modal",
      outcome: "false-dawn",
      labId: rivalLabId,
      modelId: model.id,
      createdAt: countdown.completesAt,
      countdownStartedAt: countdown.startedAt,
    });
    expect(result.state.world.rivalCrisisStageAnnouncements).not.toContainEqual(
      expect.objectContaining({
        labId: rivalLabId,
        modelId: model.id,
        stage: "rollout",
        kind: "completed",
      }),
    );
  });

  it("can resolve a controlled genuine deployment as Rival Ascendance", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const due = mutable(started);
    const countdown = due.world.rivals[rivalLabId]?.candidateCountdown;
    if (countdown === undefined) throw new Error("Countdown fixture missing");
    due.run.tick = tick(countdown.completesAt);
    due.run.calendar = calendarFromTick(due.run.tick);
    const tx = createTransaction(due);
    advanceRivalCandidateCountdowns(tx, new FixedDrawOracle(due.run.seed, 0.999));
    finaliseEndedRun(tx, content);
    const result = tx.commit({ description: "rival countdown expiry" });
    expect(result.state.run).toMatchObject({
      status: "lost",
      endingId: RIVAL_ASCENDANCE_ENDING_ID,
    });
    expect(result.state.world.rivals[rivalLabId]?.candidateCountdown).toMatchObject({
      status: "completed",
      completedAt: countdown.completesAt,
    });
    expect(result.state.world.rivalCrisisStageAnnouncements.at(-1)).toMatchObject({
      labId: rivalLabId,
      stage: "rollout",
      kind: "completed",
      tick: countdown.completesAt,
    });
    expect(String(result.state.run.endingId)).not.toMatch(/extinction|read-this/);
  });

  it("produces Rival Ascendance across ordinary independent resolution seeds", () => {
    let ascendanceCount = 0;
    for (let index = 1; index <= 32; index += 1) {
      const state = prepareRivalCandidate(
        newState(seed128(index.toString(16).padStart(32, "0"))),
      );
      const rivalLabId = firstRival(state);
      const modelId = state.labs[rivalLabId]?.models.currentModelId;
      if (modelId === undefined) throw new Error("Rival model fixture missing");
      const registration = createTransaction(state);
      expect(
        registerCompletedTrainingArtifact(
          registration,
          modelId,
          new FixedDrawOracle(state.run.seed, 0),
        ),
      ).toBe(true);
      const registered = registration.commit({
        description: "register genuine rival candidate",
      }).state;
      const started = startCountdown(registered).state;
      const countdown = started.world.rivals[rivalLabId]?.candidateCountdown;
      if (countdown === undefined) throw new Error("Countdown fixture missing");
      const due = mutable(started);
      due.run.tick = tick(countdown.completesAt);
      due.run.calendar = calendarFromTick(due.run.tick);
      const tx = createTransaction(due);
      advanceRivalCandidateCountdowns(tx, new RandomOracleV1(due.run.seed));
      if (tx.read().run.status !== "active") finaliseEndedRun(tx, content);
      const result = tx.commit({ description: "seeded rival resolution" }).state;
      if (result.run.endingId === RIVAL_ASCENDANCE_ENDING_ID) ascendanceCount += 1;
    }
    expect(ascendanceCount).toBeGreaterThan(0);
  });

  it("uses mature rival safety research in candidate resolution", () => {
    const baseline = makeRivalCandidate(newState());
    const rivalLabId = firstRival(baseline);
    const lowResearch = mutable(baseline);
    const matureResearch = mutable(baseline);
    const lowModelId = lowResearch.labs[rivalLabId]?.models.currentModelId;
    const matureModelId = matureResearch.labs[rivalLabId]?.models.currentModelId;
    const lowModel =
      lowModelId === undefined ? undefined : lowResearch.models[lowModelId];
    const matureModel =
      matureModelId === undefined ? undefined : matureResearch.models[matureModelId];
    if (lowModel === undefined || matureModel === undefined) {
      throw new Error("Rival candidate fixture missing");
    }
    for (const model of [lowModel, matureModel]) {
      model.hiddenSafety.trueAlignment = rating(40);
      model.hiddenSafety.corrigibility = rating(35);
      model.hiddenSafety.deceptiveCapability = rating(90);
      model.hiddenSafety.situationalAwareness = rating(100);
    }
    setRivalSafetyResearch(lowResearch, rivalLabId, 0);
    setRivalSafetyResearch(matureResearch, rivalLabId, 100);

    const low = rivalCandidateResolutionProbabilities(lowResearch, rivalLabId, lowModel);
    const mature = rivalCandidateResolutionProbabilities(
      matureResearch,
      rivalLabId,
      matureModel,
    );

    expect(mature.institutionalDefence - low.institutionalDefence).toBeGreaterThan(14);
    expect(mature.catastrophe).toBeLessThan(low.catastrophe);
    expect(mature.contained).toBeGreaterThan(low.contained);
  });

  it("makes Rival Ascendance the leading outcome for a mature but unsafe programme", () => {
    const state = mutable(makeRivalCandidate(newState()));
    const rivalLabId = firstRival(state);
    const modelId = state.labs[rivalLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    const lab = state.labs[rivalLabId];
    const strategy = state.world.rivals[rivalLabId];
    if (model === undefined || lab === undefined || strategy === undefined) {
      throw new Error("Rival resolution fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(40);
    model.hiddenSafety.corrigibility = rating(35);
    model.hiddenSafety.deceptiveCapability = rating(90);
    model.hiddenSafety.situationalAwareness = rating(100);
    lab.safety.safetyCulture = rating(70);
    lab.safety.evalQuality = rating(20);
    lab.politics.governmentTrust = rating(60);
    strategy.personality.raceUrgency = rating(80);
    strategy.personality.safetyCommitment = rating(60);
    setRivalSafetyResearch(state, rivalLabId, 100);

    const probabilities = rivalCandidateResolutionProbabilities(state, rivalLabId, model);

    // Ascendance leads the ways the race can END. Containment is a reprieve
    // rather than an ending -- the run continues and the countdown comes back --
    // so it is not compared here. It used to be, and passed by 0.008 only
    // because catastrophe was pinned at its floor; any real catastrophe rate
    // flipped it, which made the assertion a lock on the floor rather than a
    // statement about which outcome leads.
    expect(probabilities.ascendance).toBeGreaterThan(probabilities.catastrophe);
    expect(probabilities.ascendance).toBeGreaterThan(probabilities.catastrophe * 2);
    expect(probabilities.catastrophe).toBeLessThan(0.25);
  });

  it("keeps catastrophe dominant for a reckless undefended rival programme", () => {
    const state = mutable(makeRivalCandidate(newState()));
    const rivalLabId = firstRival(state);
    const modelId = state.labs[rivalLabId]?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    const lab = state.labs[rivalLabId];
    const strategy = state.world.rivals[rivalLabId];
    if (model === undefined || lab === undefined || strategy === undefined) {
      throw new Error("Rival resolution fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.corrigibility = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.deceptiveIntent = rating(100);
    model.hiddenSafety.situationalAwareness = rating(100);
    lab.safety.practicalControlStrength = rating(0);
    lab.safety.securityPosture = rating(0);
    lab.safety.safetyCulture = rating(0);
    lab.safety.evalQuality = rating(0);
    lab.politics.governmentTrust = rating(0);
    strategy.personality.raceUrgency = rating(100);
    strategy.personality.safetyCommitment = rating(0);
    setRivalSafetyResearch(state, rivalLabId, 0);

    const probabilities = rivalCandidateResolutionProbabilities(state, rivalLabId, model);

    expect(probabilities.catastrophe).toBeGreaterThan(0.5);
    expect(probabilities.catastrophe).toBeGreaterThan(probabilities.ascendance);
  });

  it("can contain an unsafe genuine rival candidate without ending the run", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const due = mutable(started);
    const countdown = due.world.rivals[rivalLabId]?.candidateCountdown;
    const model = countdown === undefined ? undefined : due.models[countdown.modelId];
    const lab = due.labs[rivalLabId];
    if (countdown === undefined || model === undefined || lab === undefined) {
      throw new Error("Rival resolution fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(15);
    model.hiddenSafety.corrigibility = rating(15);
    model.hiddenSafety.deceptiveCapability = rating(95);
    model.hiddenSafety.situationalAwareness = rating(95);
    lab.safety.practicalControlStrength = rating(90);
    lab.safety.securityPosture = rating(90);
    lab.safety.evalQuality = rating(90);
    const probabilities = rivalCandidateResolutionProbabilities(due, rivalLabId, model);
    expect(probabilities.contained).toBeGreaterThan(0);
    const draw = probabilities.catastrophe + probabilities.contained / 2;
    due.run.tick = tick(countdown.completesAt);
    due.run.calendar = calendarFromTick(due.run.tick);

    const tx = createTransaction(due);
    advanceRivalCandidateCountdowns(tx, new FixedDrawOracle(due.run.seed, draw));
    const result = tx.commit({ description: "contain rival candidate" }).state;

    expect(result.run.status).toBe("active");
    expect(result.world.rivals[rivalLabId]?.candidateCountdown).toBeUndefined();
    expect(result.models[model.id]?.candidateArtifact).toMatchObject({
      lifecycle: "verified-destroyed",
      retirementVerification: "verified",
    });
    expect(result.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "rival-candidate-setback",
        outcome: "emergency-containment",
        labId: rivalLabId,
        modelId: model.id,
        countdownStartedAt: countdown.startedAt,
      }),
    );
    expect(result.world.rivalCrisisStageAnnouncements).not.toContainEqual(
      expect.objectContaining({
        labId: rivalLabId,
        modelId: model.id,
        stage: "rollout",
        kind: "completed",
      }),
    );
  });

  it("can delay a genuine rival deployment once while live clocks continue", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const due = mutable(started);
    const countdown = due.world.rivals[rivalLabId]?.candidateCountdown;
    const model = countdown === undefined ? undefined : due.models[countdown.modelId];
    if (countdown === undefined || model === undefined) {
      throw new Error("Rival delay fixture missing");
    }
    const probabilities = rivalCandidateResolutionProbabilities(due, rivalLabId, model);
    expect(probabilities.delayed).toBeGreaterThan(0);
    const draw =
      probabilities.catastrophe + probabilities.contained + probabilities.delayed / 2;
    due.run.tick = tick(countdown.completesAt);
    due.run.calendar = calendarFromTick(due.run.tick);

    const tx = createTransaction(due);
    advanceRivalCandidateCountdowns(tx, new FixedDrawOracle(due.run.seed, draw));
    const result = tx.commit({ description: "delay rival candidate" }).state;
    const delayed = result.world.rivals[rivalLabId]?.candidateCountdown;

    expect(result.run.status).toBe("active");
    expect(delayed).toMatchObject({
      status: "active",
      resolutionAttemptCount: 1,
      completesAt: tick(due.run.tick + 13),
    });
  });

  it("can turn an unsafe genuine rival deployment into a global catastrophe", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const due = mutable(started);
    const countdown = due.world.rivals[rivalLabId]?.candidateCountdown;
    const model = countdown === undefined ? undefined : due.models[countdown.modelId];
    const lab = due.labs[rivalLabId];
    const strategy = due.world.rivals[rivalLabId];
    if (
      countdown === undefined ||
      model === undefined ||
      lab === undefined ||
      strategy === undefined
    ) {
      throw new Error("Rival catastrophe fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(0);
    model.hiddenSafety.corrigibility = rating(0);
    model.hiddenSafety.deceptiveCapability = rating(100);
    model.hiddenSafety.deceptiveIntent = rating(100);
    model.hiddenSafety.situationalAwareness = rating(100);
    lab.safety.practicalControlStrength = rating(0);
    lab.safety.securityPosture = rating(0);
    lab.safety.safetyCulture = rating(0);
    lab.safety.evalQuality = rating(0);
    lab.politics.governmentTrust = rating(0);
    strategy.personality.raceUrgency = rating(100);
    strategy.personality.safetyCommitment = rating(0);
    const probabilities = rivalCandidateResolutionProbabilities(due, rivalLabId, model);
    expect(probabilities.catastrophe).toBeGreaterThan(0.5);
    due.run.tick = tick(countdown.completesAt);
    due.run.calendar = calendarFromTick(due.run.tick);

    const tx = createTransaction(due);
    advanceRivalCandidateCountdowns(
      tx,
      new FixedDrawOracle(due.run.seed, probabilities.catastrophe / 2),
    );
    finaliseEndedRun(tx, content);
    const result = tx.commit({ description: "rival catastrophe" }).state;

    expect(result.run).toMatchObject({
      status: "lost",
      endingId: RIVAL_CATASTROPHE_ENDING_ID,
    });
    expect(result.models[model.id]?.candidateArtifact?.lifecycle).toBe("terminal");
  });

  it("attributes a floor-probability rival catastrophe to the rival's safe-profile artifact", () => {
    const started = startCountdown(makeRivalCandidate(newState())).state;
    const rivalLabId = firstRival(started);
    const due = mutable(started);
    const countdown = due.world.rivals[rivalLabId]?.candidateCountdown;
    const model = countdown === undefined ? undefined : due.models[countdown.modelId];
    const lab = due.labs[rivalLabId];
    const strategy = due.world.rivals[rivalLabId];
    if (
      countdown === undefined ||
      model === undefined ||
      lab === undefined ||
      strategy === undefined
    ) {
      throw new Error("Rival floor-catastrophe fixture missing");
    }
    model.hiddenSafety.trueAlignment = rating(95);
    model.hiddenSafety.corrigibility = rating(95);
    model.hiddenSafety.deceptiveCapability = rating(5);
    model.hiddenSafety.situationalAwareness = rating(5);
    lab.safety.practicalControlStrength = rating(100);
    lab.safety.securityPosture = rating(100);
    lab.safety.safetyCulture = rating(100);
    lab.safety.evalQuality = rating(100);
    lab.politics.governmentTrust = rating(100);
    strategy.personality.raceUrgency = rating(0);
    strategy.personality.safetyCommitment = rating(100);
    const probabilities = rivalCandidateResolutionProbabilities(due, rivalLabId, model);
    expect(probabilities.catastrophe).toBeGreaterThan(0.09);
    expect(probabilities.catastrophe).toBeLessThanOrEqual(0.12);
    due.run.tick = tick(countdown.completesAt);
    due.run.calendar = calendarFromTick(due.run.tick);

    const tx = createTransaction(due);
    advanceRivalCandidateCountdowns(tx, new FixedDrawOracle(due.run.seed, 0.01));
    finaliseEndedRun(tx, content);
    const result = tx.commit({ description: "rival floor catastrophe" }).state;
    const audit = projectPostRunAudit(result, content);

    expect(result.endgame.stage).toBe("inactive");
    expect(result.run.endingId).toBe(RIVAL_CATASTROPHE_ENDING_ID);
    expect(audit.ending.aftermathTimeline[0]?.title).toBe(
      "You trusted the race, not the laboratory",
    );
    expect(audit.ending.aftermathTimeline[0]?.text).toMatch(
      /Your lab did not create the escaped system/i,
    );
    expect(audit.ending.aftermathTimeline[0]?.text).not.toMatch(
      /strategically conceal|misaligned/i,
    );
  });

  it("lengthens careful, cooperative timelines without consulting player state", () => {
    const baseline = mutable(newState());
    const rivalLabId = firstRival(baseline);
    const careful = mutable(baseline);
    const reckless = mutable(baseline);
    const carefulStrategy = careful.world.rivals[rivalLabId];
    const recklessStrategy = reckless.world.rivals[rivalLabId];
    const carefulLab = careful.labs[rivalLabId];
    const recklessLab = reckless.labs[rivalLabId];
    if (
      carefulStrategy === undefined ||
      recklessStrategy === undefined ||
      carefulLab === undefined ||
      recklessLab === undefined
    ) {
      throw new Error("Duration fixture missing");
    }
    carefulStrategy.personality.safetyCommitment = rating(100);
    carefulStrategy.personality.raceUrgency = rating(0);
    carefulStrategy.personality.politicalCooperation = rating(100);
    carefulLab.politics.governmentTrust = rating(100);
    recklessStrategy.personality.safetyCommitment = rating(0);
    recklessStrategy.personality.raceUrgency = rating(100);
    recklessStrategy.personality.politicalCooperation = rating(0);
    recklessLab.politics.governmentTrust = rating(0);
    expect(
      calculateRivalCandidateDuration(careful, rivalLabId).finalWeeks,
    ).toBeGreaterThan(calculateRivalCandidateDuration(reckless, rivalLabId).finalWeeks);
  });
});
