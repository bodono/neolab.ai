import { describe, expect, it } from "vitest";

import { loadCompiledContent } from "@neolab/content";
import {
  AGI_COMPONENT_TYPES,
  CommandRejectedError,
  createNewGame,
  loadSaveEnvelope,
  MemoryHighScoreRepository,
  MemorySaveRepository,
  projectGameView,
  seed128,
  superintelligenceProbability,
  type EventInstanceId,
  type GameCommand,
  type NewGameConfig,
  type WriteSaveRequest,
} from "@neolab/sim/public";
import { withBaselineModels } from "@neolab/testkit";

import type { AnimationFrameScheduler } from "../animation-frame-clock-driver.ts";
import { BrowserGameRuntime } from "../browser-game-runtime.ts";

const content = loadCompiledContent();

function firstId<T>(record: Readonly<Record<string, T>>, label: string): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error(`No ${label} content is available`);
  return id;
}

function newGameConfig(): NewGameConfig {
  return {
    seed: seed128("0123456789abcdef0123456789abcdef"),
    difficultyId: firstId(
      content.difficulties,
      "difficulty",
    ) as NewGameConfig["difficultyId"],
    leaderId: firstId(content.leaders, "leader") as NewGameConfig["leaderId"],
    mandateId: firstId(content.mandates, "mandate") as NewGameConfig["mandateId"],
  };
}

function installCandidateArtifact(
  state: ReturnType<typeof createNewGame>,
  ownerLabId: string,
  modelId: string,
  lifecycle: "capability-qualified-latent-candidate" | "formal-candidate",
  capability: 95 | 100,
): void {
  const mutable = state as unknown as {
    engineRulesVersion: string;
    run: { tick: number; seed: string };
    endgameHistory: { qualifiedLineageCount: number };
    labs: Record<
      string,
      {
        flags: Record<string, string | number | boolean>;
        safety: {
          practicalControlStrength: number;
          securityPosture: number;
          safetyCulture: number;
          evalQuality: number;
        };
      }
    >;
    models: Record<
      string,
      {
        id: string;
        lineageId: string;
        derivedFromModelId?: string;
        accessLevel: number;
        trueCapability: Record<string, number>;
        measuredCapability?: {
          values: Record<string, number>;
          frontierCapability: number;
          confidence: "high";
          evidenceFlags: string[];
        };
        hiddenSafety: {
          trueAlignment: number;
          corrigibility: number;
          situationalAwareness: number;
          deceptiveCapability: number;
        };
        candidateArtifact?: unknown;
      }
    >;
    lineageSIRecords: Record<string, unknown>;
  };
  const lab = mutable.labs[ownerLabId];
  const model = mutable.models[modelId];
  if (lab === undefined || model === undefined) {
    throw new Error("candidate fixture owner is missing");
  }
  for (const attribute of Object.keys(model.trueCapability)) {
    model.trueCapability[attribute] = capability;
  }
  model.measuredCapability = {
    values: { ...model.trueCapability },
    frontierCapability: capability,
    confidence: "high",
    evidenceFlags: ["runtime-candidate-fixture"],
  };
  for (const componentType of AGI_COMPONENT_TYPES) {
    lab.flags[`agi-component:${componentType}:complete`] = true;
  }
  model.candidateArtifact = {
    modelId: model.id,
    lineageId: model.lineageId,
    ...(model.derivedFromModelId === undefined
      ? {}
      : { derivedFromModelId: model.derivedFromModelId }),
    lifecycle,
    candidateBasis: {
      kind: "direct-qualification",
      qualifiedAt: mutable.run.tick,
      qualificationFrontierCapability: capability,
      qualificationCapability: { ...model.trueCapability },
    },
    trainingExposure: 0,
    hazardPressure: 0,
    incidentThresholdKey: [
      "candidate-hazard-v1",
      mutable.engineRulesVersion,
      mutable.run.seed,
      model.id,
      "0",
      "threshold",
    ].join("/"),
    incidentThreshold: 100,
    incidentThresholdDraw: 1,
    incidentEpoch: 0,
    containmentLoad: 1,
    maximumAccessEver: model.accessLevel,
    cumulativeAutonomousWeeks: 0,
    networkExposureWeeks: 0,
    servingExposureWeeks: 0,
    unresolvedAnomalyBurden: 0,
    retirementAttemptCount: 0,
    benignFalseAlarmClasses: [],
    incidentHistory: [],
    retirementVerification: "not-attempted",
  };
  const probability = superintelligenceProbability(capability);
  const draw = 1;
  mutable.lineageSIRecords[model.lineageId] = {
    lineageId: model.lineageId,
    superintelligenceTruth:
      probability >= 1 || draw < probability ? "genuine" : "not-genuine",
    probabilityAtFirstCrossing: probability,
    randomKey: [
      "endgame-si-v1",
      mutable.engineRulesVersion,
      mutable.run.seed,
      model.lineageId,
    ].join("/"),
    draw,
    firstQualifyingModelId: model.id,
    firstQualifyingFrontierCapability: capability,
    firstQualifyingWeek: mutable.run.tick,
    rulesVersion: mutable.engineRulesVersion,
  };
  mutable.endgameHistory.qualifiedLineageCount = Object.keys(
    mutable.lineageSIRecords,
  ).length;
}

const inertScheduler: AnimationFrameScheduler = {
  now: () => 0,
  requestFrame: () => 1,
  cancelFrame: () => undefined,
};

class RecordingSaveRepository extends MemorySaveRepository {
  readonly writes: WriteSaveRequest[] = [];

  override write(request: WriteSaveRequest): ReturnType<MemorySaveRepository["write"]> {
    this.writes.push({ ...request, state: structuredClone(request.state) });
    return super.write(request);
  }
}

function criticalEventContent(): typeof content {
  const definitionId = "base:event.test.critical-autosave";
  const definition = {
    id: definitionId,
    version: 1,
    category: "finance",
    severity: "critical",
    phase: "any",
    trigger: { kind: "mandatory", detector: "critical-runway", priority: 100 },
    prerequisites: { type: "always" },
    baseWeight: 0,
    weightModifiers: [],
    cooldown: { group: "test-critical-autosave", weeks: 0 },
    unique: false,
    titleKey: "event.test.critical-autosave.title",
    bodyKey: "event.test.critical-autosave.body",
    evidence: [],
    tokenBindings: [],
    options: [
      {
        id: "acknowledge",
        labelKey: "event.test.critical-autosave.acknowledge.label",
        requirements: { type: "always" },
        knownCosts: [],
        previewKey: "event.test.critical-autosave.acknowledge.preview",
        immediateEffects: [],
        checks: [],
        memories: [],
        confirmationRequired: true,
      },
    ],
    followUps: [],
    telemetryTags: ["test"],
  } as unknown as (typeof content.events.definitions)[string];
  return {
    ...content,
    events: {
      definitions: { [definitionId]: definition },
      orderedIds: [definition.id],
    },
  };
}

describe("BrowserGameRuntime", () => {
  it("owns canonical state and publishes only a projected player view", () => {
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
    });
    const snapshots: ReturnType<typeof runtime.getSnapshot>[] = [];
    runtime.subscribe((snapshot) => snapshots.push(snapshot));

    expect(runtime.getView().meta).toMatchObject({
      tick: 0,
      calendar: { year: 2012, week: 1 },
      status: "active",
    });
    expect(runtime.getClock().paused).toBe(true);
    expect(() => runtime.getPostRunAudit()).toThrow(/unavailable/);

    const receipt = runtime.stepOneTick();
    expect(receipt.tick).toBe(1);
    expect(runtime.getView().meta.calendar).toEqual({ year: 2012, week: 2 });
    expect(snapshots).toHaveLength(1);

    const serialised = JSON.stringify(runtime.getSnapshot());
    expect(serialised).not.toContain("hiddenSafety");
    expect(serialised).not.toContain("trueAlignment");
    expect(serialised).not.toContain('"state"');
  });

  it("rejects a retired hot-reloaded command without faulting the run", () => {
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
    });
    const retiredCommand = {
      kind: "set-facility-enabled",
      meta: {
        commandId: "command:retired-facility-toggle",
        expectedTick: 0,
        issuedBy: "player",
      },
      labId: runtime.getView().identity.labId,
      facilityId: "run:facility:player:0001",
      enabled: true,
    } as unknown as GameCommand;

    expect(runtime.validate(retiredCommand)).toMatchObject({
      ok: false,
      errors: [{ code: "unsupported-command" }],
    });
    expect(runtime.getSnapshot().fault).toBeUndefined();
    expect(runtime.stepOneTick().tick).toBe(1);
    runtime.dispose();
  });

  it("gates privileged state and records development-only transition diagnostics", () => {
    const disabled = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
    });
    expect(() => disabled.readDevelopmentSnapshot()).toThrow(
      "development tools are disabled",
    );
    disabled.dispose();

    let clock = 0;
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
      enableDevelopmentTools: true,
      nowMilliseconds: () => {
        clock += 0.5;
        return clock;
      },
    });
    const stateBefore = runtime.readDevelopmentSnapshot().canonicalState as {
      run: { playerLabId: string };
      models: Record<string, { hiddenSafety: unknown }>;
      labs: Record<string, { organisation: { hiddenInternalCandour: number } }>;
    };
    expect(stateBefore.models).toEqual({});
    expect(
      stateBefore.labs[stateBefore.run.playerLabId]?.organisation.hiddenInternalCandour,
    ).toBeDefined();

    const command = {
      kind: "set-public-price",
      meta: {
        commandId: "command:dev-inspector-invalid-tick",
        expectedTick: 99,
        issuedBy: "player",
      },
      labId: stateBefore.run.playerLabId,
      priceTier: "premium",
    } as GameCommand;
    expect(runtime.validate(command).ok).toBe(false);
    expect(runtime.readDevelopmentSnapshot().lastCommandValidation?.validation.ok).toBe(
      false,
    );

    runtime.stepOneTick();
    const diagnostic = runtime.readDevelopmentSnapshot();
    expect(diagnostic.currentTickPhase).toBe("idle");
    expect(diagnostic.lastTransition).toMatchObject({
      kind: "tick",
      description: "tick 0",
    });
    expect(diagnostic.lastTransition?.durationMilliseconds).toBeGreaterThan(0);
    expect(diagnostic.lastTransition?.systemTimings.length).toBeGreaterThan(20);
    expect(diagnostic.lastTransition?.systemTimings[0]).toMatchObject({
      systemId: "orders.apply-queued",
      phase: "apply-orders",
    });
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain("hiddenSafety");
    runtime.dispose();
  });

  it("stops accepting work after disposal", () => {
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
    });
    runtime.dispose();
    expect(() => runtime.stepOneTick()).toThrow("disposed");
  });

  it("contains an unexpected tick fault, freezes transitions, and exports the last coherent state", async () => {
    const secret = "hidden-safety-value-must-not-leak";
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
      enableDevelopmentTools: true,
      nowIso: () => "2026-07-23T00:00:00.000Z",
      advanceTick: () => {
        throw new Error(secret);
      },
    });
    const snapshots: ReturnType<typeof runtime.getSnapshot>[] = [];
    runtime.subscribe((snapshot) => snapshots.push(snapshot));

    const receipt = runtime.stepOneTick();

    expect(receipt.fault).toMatchObject({
      kind: "simulation",
      scope: "tick-transition",
      code: "simulation-transition-failed",
      tick: 0,
    });
    expect(runtime.getView().meta.tick).toBe(0);
    expect(runtime.getClock()).toMatchObject({
      paused: true,
      pauseReason: "runtime-fault",
    });
    expect(runtime.resume()).toEqual({ resumed: false, reason: "runtime-fault" });
    expect(runtime.stepOneTick()).toBe(receipt);
    expect(snapshots.at(-1)?.fault).toEqual(receipt.fault);
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain(secret);
    expect(runtime.readDevelopmentSnapshot().lastFault).toMatchObject({
      fault: receipt.fault,
      errorName: "Error",
      errorMessage: secret,
    });

    const diagnostic = runtime.createFaultDiagnosticReport({
      applicationVersion: "0.0.0-test",
      pageUrl: "https://example.test/game",
      userAgent: "NeolabTestBrowser/1",
    });
    const diagnosticJson = JSON.parse(await diagnostic.blob.text()) as Record<
      string,
      unknown
    >;
    expect(diagnostic.filename).toMatch(/^neolab-crash-runtime-fault-1-week-0\.json$/);
    expect(diagnostic.fault).toEqual(receipt.fault);
    expect(diagnosticJson).toMatchObject({
      format: "neolab-runtime-diagnostic-v1",
      fault: receipt.fault,
      exception: {
        name: "Error",
        message: secret,
      },
      runtime: {
        lastCoherentTick: 0,
      },
      client: {
        applicationVersion: "0.0.0-test",
        pageUrl: "https://example.test/game",
        userAgent: "NeolabTestBrowser/1",
      },
    });
    expect(JSON.stringify(diagnosticJson)).not.toContain("hiddenSafety");

    const emergency = runtime.createEmergencySave();
    const loaded = loadSaveEnvelope(JSON.parse(await emergency.blob.text()));
    expect(emergency.filename).toMatch(
      /^neolab-emergency-.*-tick-0000\.neolab-save\.json$/,
    );
    expect(emergency.fault).toEqual(receipt.fault);
    expect(loaded.envelope).toMatchObject({
      slotType: "manual",
      updatedAtIso: "2026-07-23T00:00:00.000Z",
    });
    expect(loaded.state.run.tick).toBe(0);
    runtime.dispose();
  });

  it("keeps command and projection failures atomic while ordinary rejections remain recoverable", () => {
    const state = createNewGame(newGameConfig(), content);
    const command = {
      kind: "set-public-price",
      meta: {
        commandId: "command:runtime-fault-test",
        expectedTick: 0,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      priceTier: "premium",
    } as GameCommand;
    const commandRuntime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
      applyGameCommand: () => {
        throw new Error("command engine exploded");
      },
    });

    expect(commandRuntime.dispatch(command).fault).toMatchObject({
      scope: "command-transition",
      tick: 0,
    });
    expect(commandRuntime.getView().meta.tick).toBe(0);
    commandRuntime.dispose();

    let projections = 0;
    const projectionRuntime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
      projectView: (...arguments_: Parameters<typeof projectGameView>) => {
        projections += 1;
        if (projections > 1) throw new Error("projection exploded");
        return projectGameView(...arguments_);
      },
    });
    expect(projectionRuntime.stepOneTick().fault).toMatchObject({
      scope: "view-projection",
      tick: 0,
    });
    expect(projectionRuntime.getView().meta.tick).toBe(0);
    projectionRuntime.dispose();

    const normalRuntime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
    });
    const staleCommand = {
      ...command,
      meta: { ...command.meta, expectedTick: 99 },
    } as GameCommand;
    expect(() => normalRuntime.dispatch(staleCommand)).toThrow(CommandRejectedError);
    expect(normalRuntime.getSnapshot().fault).toBeUndefined();
    expect(normalRuntime.stepOneTick().tick).toBe(1);
    normalRuntime.dispose();
  });

  it("rotates a real autosave at cycle boundaries", async () => {
    const repository = new RecordingSaveRepository();
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
      saveRepository: repository,
      nowIso: () => "2026-07-22T00:00:00.000Z",
    });

    for (let week = 0; week < 4; week += 1) runtime.stepOneTick();
    await runtime.flushAutosaves();

    expect(repository.writes).toHaveLength(1);
    expect(runtime.getAutosaveStatus()).toMatchObject({
      pendingWrites: 0,
      completedWrites: 1,
      lastCompletedTriggers: [{ reason: "cycle-boundary", timing: "after" }],
    });
    expect((await repository.load("autosave")).state.run.tick).toBe(4);
    runtime.dispose();
  });

  it("clears and persists acknowledged auto-pause reasons when time resumes", async () => {
    const state = structuredClone(createNewGame(newGameConfig(), content));
    (state.run.autoPauseReasons as string[]).push("training-complete");
    const repository = new RecordingSaveRepository();
    const runtime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
      saveRepository: repository,
      nowIso: () => "2026-07-23T00:00:00.000Z",
    });

    expect(runtime.getView().eventQueue.autoPauseReasons).toEqual(["training-complete"]);
    expect(runtime.resume()).toEqual({ resumed: true });
    await runtime.flushAutosaves();

    expect(runtime.getView().eventQueue.autoPauseReasons).toEqual([]);
    expect(repository.writes).toHaveLength(1);
    expect(repository.writes[0]?.state.run.autoPauseReasons).toEqual([]);
    expect(runtime.getAutosaveStatus().lastCompletedTriggers).toEqual([
      { reason: "auto-pause-cleared", timing: "after" },
    ]);
    runtime.dispose();
  });

  it("repairs milestone history when acknowledging a legacy tier popup", async () => {
    const baselineState = structuredClone(
      withBaselineModels(createNewGame(newGameConfig(), content), content),
    );
    const lab = baselineState.labs[baselineState.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : baselineState.models[modelId];
    const tier = content.capabilityTiers.orderedIds
      .map((id) => content.capabilityTiers.definitions[id])
      .find((definition) => definition?.level === 2);
    if (modelId === undefined || model === undefined || tier === undefined) {
      throw new Error("capability acknowledgement fixture is unavailable");
    }
    const key = `capability-tier:${modelId}:${tier.id}`;
    const presentation = {
      key,
      kind: "capability-tier" as const,
      attention: "modal" as const,
      definitionId: tier.id,
      modelId,
      createdAt: baselineState.run.tick,
    };
    const state = {
      ...baselineState,
      models: {
        ...baselineState.models,
        [modelId]: {
          ...model,
          flags: Object.fromEntries(
            Object.entries(model.flags).filter(
              ([flag]) =>
                flag !== "capability-tier-reached:2" &&
                flag !== "capability-tier-highest-announced",
            ),
          ),
        },
      },
      presentationQueue: [...baselineState.presentationQueue, presentation],
    };
    const repository = new RecordingSaveRepository();
    const runtime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
      saveRepository: repository,
    });

    expect(runtime.acknowledgePresentation(key)).toBe(true);
    await runtime.flushAutosaves();

    const savedModel = repository.writes[0]?.state.models[modelId];
    expect(savedModel?.flags["capability-tier-highest-announced"]).toBe(2);
    expect(savedModel?.flags["capability-tier-reached:2"]).toBe(true);
    expect(repository.writes[0]?.state.presentationQueue).toHaveLength(0);
    runtime.dispose();
  });

  it("keeps time blocked until a pending research direction is chosen", () => {
    const state = structuredClone(createNewGame(newGameConfig(), content));
    const lab = state.labs[state.run.playerLabId];
    const programme = Object.values(content.research.capabilityDomains)[0];
    const optionIds = programme?.genericAdvanceOptionIds["20"];
    if (lab === undefined || programme === undefined || optionIds === undefined) {
      throw new Error("research choice fixture is unavailable");
    }
    (
      lab.research.pendingGenericAdvances as unknown as {
        programId: typeof programme.id;
        threshold: number;
        optionIds: typeof optionIds;
      }[]
    ).push({
      programId: programme.id,
      threshold: 20,
      optionIds,
    });
    (state.run.autoPauseReasons as string[]).push("research-direction");
    const runtime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
    });

    expect(runtime.resume()).toEqual({
      resumed: false,
      reason: "blocking-decision",
    });
    expect(() => runtime.stepOneTick()).toThrow(
      "Cannot advance while a research direction is unresolved",
    );

    const optionId = optionIds[0];
    if (optionId === undefined) throw new Error("research choice option is unavailable");
    runtime.dispatch({
      kind: "choose-generic-advance",
      meta: {
        commandId: "command:test-research-direction",
        expectedTick: runtime.getView().meta.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      programId: programme.id,
      threshold: 20,
      optionId,
    } as GameCommand);
    expect(runtime.resume()).toEqual({ resumed: true });
    runtime.dispose();
  });

  it.each([
    ["sealed world-waiting reveal", { stage: "world-waiting" }],
    ["containment emergency", { stage: "containment-failure" }],
    ["unresolved retirement", { stage: "retirement-attempt" }],
    [
      "post-recovery path decision",
      {
        stage: "recovery",
        recoveryEndsAt: 0,
        postRetirementChoice: undefined,
      },
    ],
    [
      "final deployment decision",
      {
        stage: "rollout",
        currentBeat: "settlement",
        awaitingDecision: true,
      },
    ],
  ] as const)("keeps the clock frozen during the %s", (_label, endgame) => {
    const ordinaryState = createNewGame(newGameConfig(), content);
    const ordinaryRuntime = new BrowserGameRuntime(ordinaryState, content, {
      scheduler: inertScheduler,
    });
    const visibleView = ordinaryRuntime.getView();
    ordinaryRuntime.dispose();

    const blockedState = structuredClone(ordinaryState) as unknown as {
      endgame: Record<string, unknown>;
    };
    blockedState.endgame = { ...endgame };
    const runtime = new BrowserGameRuntime(
      blockedState as unknown as typeof ordinaryState,
      content,
      {
        scheduler: inertScheduler,
        projectView: () => visibleView,
      },
    );

    expect(runtime.resume()).toEqual({
      resumed: false,
      reason: "blocking-decision",
    });
    expect(() => runtime.stepOneTick()).toThrow(
      "Cannot advance during an exclusive endgame decision",
    );
    runtime.dispose();
  });

  it("saves the latest coherent state before an intentional exit", async () => {
    const repository = new RecordingSaveRepository();
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
      saveRepository: repository,
      nowIso: () => "2026-07-23T00:00:00.000Z",
    });

    runtime.stepOneTick();
    await runtime.saveForExit();

    expect(repository.writes).toHaveLength(1);
    expect(repository.writes[0]?.slotType).toBe("autosave");
    expect(runtime.getAutosaveStatus()).toMatchObject({
      pendingWrites: 0,
      completedWrites: 1,
      lastCompletedTriggers: [{ reason: "manual-exit", timing: "after" }],
    });
    expect((await repository.load("autosave")).state.run.tick).toBe(1);
    runtime.dispose();
  });

  it("saves a resumable run when leaving before the first simulation tick", async () => {
    const repository = new RecordingSaveRepository();
    const runtime = BrowserGameRuntime.createNew(newGameConfig(), content, {
      scheduler: inertScheduler,
      saveRepository: repository,
      nowIso: () => "2026-07-23T00:00:00.000Z",
    });

    await runtime.saveForExit();

    const saved = (await repository.load("autosave")).state;
    expect(saved.run).toMatchObject({ tick: 0, status: "active" });
    expect(saved.score.final).toBeUndefined();
    runtime.dispose();
  });

  it("writes a permanent Crisis Start checkpoint and preserves 4x crisis speed", async () => {
    const state = structuredClone(
      withBaselineModels(createNewGame(newGameConfig(), content), content),
    );
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (modelId === undefined || model === undefined) {
      throw new Error("player model missing");
    }
    installCandidateArtifact(
      state,
      state.run.playerLabId,
      modelId,
      "capability-qualified-latent-candidate",
      95,
    );
    const repository = new RecordingSaveRepository();
    const runtime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
      saveRepository: repository,
      nowIso: () => "2026-07-22T00:00:00.000Z",
    });

    runtime.setSpeed("4x");
    const activation = runtime.stepOneTick();
    expect(activation.autoPauseReasons).toContain("agi-candidate");
    expect(runtime.getView().endgame.stage).toBe("candidate-activation");
    expect(runtime.getView().endgame.maxClockSpeed).toBe("4x");

    const activationTick = runtime.getView().meta.tick;
    expect(runtime.resume()).toEqual({ resumed: true });
    runtime.pause();
    runtime.stepOneTick();
    expect(runtime.getView().meta.tick).toBe(activationTick + 1);
    expect(runtime.getView().endgame.stage).toBe("candidate-activation");

    const receipt = runtime.dispatch({
      kind: "nominate-candidate",
      meta: {
        commandId: "runtime-test:nominate-candidate" as GameCommand["meta"]["commandId"],
        expectedTick: runtime.getView().meta.tick as typeof state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      modelId,
    });
    await runtime.flushAutosaves();

    expect(receipt.autoPauseReasons).toContain("crisis-stage");
    expect(receipt.autosaveTriggers).toContainEqual({
      reason: "crisis-start",
      timing: "after",
    });
    expect(runtime.getClock()).toMatchObject({ paused: true, selectedSpeed: "4x" });
    runtime.setSpeed("4x");
    expect(runtime.getClock().selectedSpeed).toBe("4x");
    const checkpoint = repository.writes.find(
      (write) => write.slotType === "crisis-checkpoint",
    );
    expect(checkpoint?.slotType).toBe("crisis-checkpoint");
    expect(checkpoint?.displayName.includes("Crisis Start")).toBe(true);
    expect(checkpoint?.state.endgame.stage).toBe("confirmation");
    runtime.dispose();
  });

  it("captures snapshots immediately before and after a critical event response", async () => {
    const eventContent = criticalEventContent();
    const state = structuredClone(createNewGame(newGameConfig(), eventContent));
    const mutableLabs = state.labs as unknown as Record<
      string,
      { finance: { cash: number } }
    >;
    const lab = mutableLabs[state.run.playerLabId];
    if (lab === undefined) throw new Error("missing player lab");
    lab.finance.cash = 0.1;
    const repository = new RecordingSaveRepository();
    const runtime = new BrowserGameRuntime(state, eventContent, {
      scheduler: inertScheduler,
      saveRepository: repository,
      nowIso: () => "2026-07-22T00:00:00.000Z",
    });

    for (
      let week = 0;
      week < 4 && runtime.getView().eventQueue.items.length === 0;
      week += 1
    ) {
      runtime.stepOneTick();
    }
    await runtime.flushAutosaves();
    repository.writes.splice(0);
    const instance = runtime.getView().eventQueue.items[0];
    if (instance === undefined) throw new Error("critical event did not open");
    expect(runtime.resume()).toEqual({
      resumed: false,
      reason: "blocking-decision",
    });
    expect(() => runtime.stepOneTick()).toThrow(
      "Cannot advance while a critical decision is unresolved",
    );
    const instanceId = instance.instanceId as EventInstanceId;
    const command = {
      kind: "respond-to-decision-event",
      meta: {
        commandId: "command:test-critical-autosave",
        expectedTick: runtime.getView().meta.tick,
        issuedBy: "player",
      },
      instanceId,
      optionId: "acknowledge",
    } as GameCommand;
    const receipt = runtime.dispatch(command);
    await runtime.flushAutosaves();

    expect(receipt.autosaveTriggers).toEqual([
      { reason: "critical-event-resolution", timing: "before" },
      { reason: "critical-event-resolution", timing: "after" },
    ]);
    expect(repository.writes).toHaveLength(2);
    expect(repository.writes[0]?.state.eventInstances[instanceId]?.status).toBe(
      "unresolved",
    );
    expect(repository.writes[1]?.state.eventInstances[instanceId]?.status).toBe(
      "resolved",
    );
    expect(runtime.resume()).toEqual({ resumed: true });
    runtime.dispose();
  });

  it("finalises before the run-ended autosave and records one independent high score", async () => {
    const state = structuredClone(
      withBaselineModels(createNewGame(newGameConfig(), content), content),
    );
    const mutableRun = state.run as unknown as {
      tick: number;
      calendar: { year: number; week: number };
    };
    mutableRun.tick = 26;
    mutableRun.calendar = { year: 2012, week: 27 };
    const rivalId = Object.keys(state.world.rivals).sort()[0];
    if (rivalId === undefined) throw new Error("rival missing");
    const rival = state.world.rivals[rivalId as keyof typeof state.world.rivals];
    const modelId = state.labs[rivalId as keyof typeof state.labs]?.models.currentModelId;
    if (rival === undefined || modelId === undefined)
      throw new Error("rival model missing");
    const rivalLab = state.labs[rivalId as keyof typeof state.labs];
    const rivalModel = state.models[modelId];
    if (rivalLab === undefined || rivalModel === undefined) {
      throw new Error("rival candidate requirements missing");
    }
    installCandidateArtifact(state, rivalId, modelId, "formal-candidate", 100);
    const mutableSafety = rivalLab.safety as unknown as Record<string, number>;
    mutableSafety["practicalControlStrength"] = 100;
    mutableSafety["securityPosture"] = 100;
    mutableSafety["safetyCulture"] = 100;
    mutableSafety["evalQuality"] = 100;
    const mutableHiddenSafety = rivalModel.hiddenSafety as unknown as Record<
      string,
      number
    >;
    mutableHiddenSafety["trueAlignment"] = 100;
    mutableHiddenSafety["corrigibility"] = 100;
    mutableHiddenSafety["situationalAwareness"] = 0;
    mutableHiddenSafety["deceptiveCapability"] = 0;
    const mutableRival = rival as unknown as {
      candidateCountdown: typeof rival.candidateCountdown;
    };
    mutableRival.candidateCountdown = {
      modelId,
      startedAt: 0 as typeof state.run.tick,
      completesAt: state.run.tick,
      status: "active",
      modifiers: {
        baseWeeks: 78,
        safetyCommitmentWeeks: 0,
        raceUrgencyWeeks: -52,
        politicalProcessWeeks: 0,
        incidentDelayWeeks: 0,
        sharedStandardsWeeks: 0,
        finalWeeks: 26,
      },
      estimateNoiseUnit: 0,
      finalYearWarningIssued: false,
      resolutionAttemptCount: 1,
    };
    const saves = new RecordingSaveRepository();
    const scores = new MemoryHighScoreRepository();
    const runtime = new BrowserGameRuntime(state, content, {
      scheduler: inertScheduler,
      saveRepository: saves,
      highScoreRepository: scores,
      nowIso: () => "2026-07-22T00:00:00.000Z",
    });

    const receipt = runtime.stepOneTick();
    await runtime.flushAutosaves();

    expect(receipt.autosaveTriggers).toContainEqual({
      reason: "run-ended",
      timing: "after",
    });
    // A resolving rival countdown ends the run either by ascending or by losing
    // control of what it deployed. Which one is a seeded draw, so this asserts
    // the ordering and the single high score rather than pinning the ending --
    // it previously named rival-ascendance, which only held while the
    // catastrophe branch was floored to near-zero.
    const finalSave = saves.writes.find(
      (write) => write.state.run.endingId !== undefined,
    );
    const endingId = finalSave?.state.run.endingId;
    expect(endingId).toMatch(/rival-ascendance|the-door-opened-elsewhere/);
    expect(finalSave?.state.score.final).toEqual(
      expect.objectContaining({ rawScore: 0, adjustedScore: 0 }),
    );
    expect(await scores.list("all-finished-runs")).toEqual([
      expect.objectContaining({ runId: state.run.runId, endingId }),
    ]);
    expect(await scores.list("winning-runs")).toEqual([]);
    runtime.dispose();

    const tutorialState = structuredClone(state);
    const tutorialLab = tutorialState.labs[tutorialState.run.playerLabId];
    if (tutorialLab === undefined) throw new Error("tutorial lab missing");
    (tutorialLab.flags as Record<string, boolean>)["tutorial:guided"] = true;
    const tutorialScores = new MemoryHighScoreRepository();
    const tutorialRuntime = new BrowserGameRuntime(tutorialState, content, {
      scheduler: inertScheduler,
      highScoreRepository: tutorialScores,
    });
    tutorialRuntime.stepOneTick();
    await tutorialRuntime.flushAutosaves();

    expect(await tutorialScores.list("all-finished-runs")).toEqual([]);
    tutorialRuntime.dispose();
  });
});
