import {
  advanceOneTick,
  applyCommand,
  CommandRejectedError,
  createSaveEnvelope,
  createNewGame,
  createProgressiveNewGame,
  createHighScoreEntry,
  endgameClockStopReason,
  MemoryHighScoreRepository,
  MemorySaveRepository,
  projectGameView,
  validateCommand,
  type AutoPauseReason,
  type CommandValidation,
  type DomainEvent,
  type GameCommand,
  type GameView,
  type HighScoreRepository,
  type NewGameConfig,
  type PlayerKnowledgeContext,
  type SaveRepository,
  type TickInstrumentation,
  type TickSystemTiming,
  type TransitionResult,
} from "@neolab/sim/public";
import { projectPostRunAudit, type PostRunAuditView } from "@neolab/sim/debug";

import {
  AnimationFrameClockDriver,
  type ActiveClockSpeed,
  type AnimationFrameScheduler,
  type ClockBalance,
  type ClockPauseReason,
  type ClockView,
  type ResumeResult,
  type TickConsumptionResult,
} from "./animation-frame-clock-driver.ts";
type CanonicalGameState = ReturnType<typeof createNewGame>;
type CompiledContent = Parameters<typeof createNewGame>[1];

export interface RuntimeReceipt {
  readonly tick: number;
  readonly description: string;
  readonly commandId?: string;
  readonly domainEvents: readonly DomainEvent[];
  readonly autoPauseReasons: readonly AutoPauseReason[];
  readonly autosaveTriggers: readonly AutosaveTrigger[];
  readonly fault?: RuntimeFault;
}

export type RuntimeFaultKind = "simulation" | "presentation";

export type RuntimeFaultScope =
  | "command-validation"
  | "command-transition"
  | "tick-transition"
  | "view-projection"
  | "application-shell"
  | "campus-renderer";

/**
 * Player-safe presentation metadata. The raw exception never enters GameState,
 * ordinary snapshots, or saves. It is retained only for an explicit crash
 * diagnostic export and, when enabled, the privileged development snapshot.
 */
export interface RuntimeFault {
  readonly faultId: string;
  readonly kind: RuntimeFaultKind;
  readonly scope: RuntimeFaultScope;
  readonly code: "simulation-transition-failed" | "presentation-render-failed";
  readonly tick: number;
}

export interface EmergencySaveExport {
  readonly blob: Blob;
  readonly filename: string;
  readonly fault?: RuntimeFault;
}

export interface RuntimeDiagnosticMetadata {
  readonly applicationVersion?: string;
  readonly pageUrl?: string;
  readonly userAgent?: string;
}

export interface RuntimeDiagnosticExport {
  readonly blob: Blob;
  readonly filename: string;
  readonly fault: RuntimeFault;
}

export type AutosaveReason =
  | "cycle-boundary"
  | "major-project-completed"
  | "critical-event-resolution"
  | "crisis-start"
  | "auto-pause-cleared"
  | "presentation-acknowledged"
  | "manual-exit"
  | "run-ended";

export interface AutosaveTrigger {
  readonly reason: AutosaveReason;
  readonly timing: "before" | "after";
}

export interface AutosaveStatus {
  readonly pendingWrites: number;
  readonly completedWrites: number;
  readonly lastCompletedTriggers: readonly AutosaveTrigger[];
  readonly lastError?: string;
}

export interface RuntimeSnapshot {
  readonly gameView: GameView;
  readonly clockView: ClockView;
  readonly lastReceipt?: RuntimeReceipt;
  readonly fault?: RuntimeFault;
}

export interface RuntimeCommandValidationDiagnostic {
  readonly command: GameCommand;
  readonly validation: CommandValidation;
}

export interface RuntimeTransitionDiagnostic {
  readonly kind: "command" | "tick";
  readonly description: string;
  readonly commandId?: string;
  readonly durationMilliseconds: number;
  readonly systemTimings: readonly TickSystemTiming[];
  readonly domainEvents: readonly DomainEvent[];
  readonly autoPauseReasons: readonly AutoPauseReason[];
}

/** Privileged raw state is available only when explicitly enabled in development. */
export interface RuntimeDevelopmentSnapshot {
  readonly canonicalState: unknown;
  readonly currentTickPhase: string;
  readonly lastCommandValidation?: RuntimeCommandValidationDiagnostic;
  readonly lastTransition?: RuntimeTransitionDiagnostic;
  readonly lastFault?: RuntimeDevelopmentFaultDiagnostic;
}

export interface RuntimeDevelopmentFaultDiagnostic {
  readonly fault: RuntimeFault;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly stack?: string;
}

export type BrowserPostRunAudit = PostRunAuditView;

export type RuntimeListener = (snapshot: RuntimeSnapshot) => void;
export type Unsubscribe = () => void;

export interface BrowserGameRuntimeOptions {
  readonly scheduler?: AnimationFrameScheduler;
  readonly clockBalance?: ClockBalance;
  /** Memory by default for tests; the production app injects IndexedDB. */
  readonly saveRepository?: SaveRepository;
  /** Separate durable summaries; production injects its own IndexedDB database. */
  readonly highScoreRepository?: HighScoreRepository;
  readonly nowIso?: () => string;
  readonly nowMilliseconds?: () => number;
  readonly autosaveId?: string;
  /** Must be a compile-time false value in production entry points. */
  readonly enableDevelopmentTools?: boolean;
  /** Test seam for proving fault containment; production uses the sim export. */
  readonly advanceTick?: typeof advanceOneTick;
  /** Test seam for proving command fault containment. */
  readonly applyGameCommand?: typeof applyCommand;
  /** Test seam for proving projection failure atomicity. */
  readonly projectView?: typeof projectGameView;
  /** Privileged, write-only crash hook. Callers must sanitise before transmission. */
  readonly onRuntimeFault?: (fault: RuntimeFault, error: unknown) => void;
  /** Development/test seam for exercising mature workspaces without replaying the opening. */
  readonly newGameMode?: "progressive" | "classic";
}

class ViewProjectionError extends Error {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Player-safe projection failed");
    this.name = "ViewProjectionError";
    this.cause = cause;
  }
}

/** The only normal browser owner of canonical (and potentially hidden) state. */
export class BrowserGameRuntime {
  readonly #content: CompiledContent;
  readonly #listeners = new Set<RuntimeListener>();
  readonly #clock: AnimationFrameClockDriver;
  readonly #saveRepository: SaveRepository;
  readonly #highScoreRepository: HighScoreRepository;
  readonly #nowIso: () => string;
  readonly #nowMilliseconds: () => number;
  readonly #autosaveId: string;
  readonly #developmentToolsEnabled: boolean;
  readonly #advanceTick: typeof advanceOneTick;
  readonly #applyGameCommand: typeof applyCommand;
  readonly #projectView: typeof projectGameView;
  readonly #onRuntimeFault: BrowserGameRuntimeOptions["onRuntimeFault"];

  #state: CanonicalGameState;
  #view: GameView;
  #lastReceipt: RuntimeReceipt | undefined;
  #currentTickPhase = "idle";
  #lastCommandValidation: RuntimeCommandValidationDiagnostic | undefined;
  #lastTransition: RuntimeTransitionDiagnostic | undefined;
  #fault: RuntimeFault | undefined;
  #lastFault: RuntimeDevelopmentFaultDiagnostic | undefined;
  #faultCounter = 0;
  #saveQueue: Promise<void> = Promise.resolve();
  #pendingSaveWrites = 0;
  #completedSaveWrites = 0;
  #lastCompletedSaveTriggers: readonly AutosaveTrigger[] = [];
  #lastSaveError: string | undefined;
  readonly #recordedHighScoreRunIds = new Set<string>();
  #disposed = false;

  constructor(
    state: CanonicalGameState,
    content: CompiledContent,
    options: BrowserGameRuntimeOptions = {},
  ) {
    this.#state = state;
    this.#content = content;
    this.#saveRepository = options.saveRepository ?? new MemorySaveRepository();
    this.#highScoreRepository =
      options.highScoreRepository ?? new MemoryHighScoreRepository();
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#nowMilliseconds =
      options.nowMilliseconds ?? (() => globalThis.performance?.now() ?? Date.now());
    this.#autosaveId = options.autosaveId ?? "autosave";
    this.#developmentToolsEnabled = options.enableDevelopmentTools === true;
    this.#advanceTick = options.advanceTick ?? advanceOneTick;
    this.#applyGameCommand = options.applyGameCommand ?? applyCommand;
    this.#projectView = options.projectView ?? projectGameView;
    this.#onRuntimeFault = options.onRuntimeFault;
    this.#view = this.#projectView(state, content, knowledgeContext(state));
    this.#clock = new AnimationFrameClockDriver(
      this.#consumeTick,
      this.#publish,
      options.scheduler,
      options.clockBalance,
    );
  }

  static createNew(
    config: NewGameConfig,
    content: CompiledContent,
    options: BrowserGameRuntimeOptions = {},
  ): BrowserGameRuntime {
    return new BrowserGameRuntime(
      options.newGameMode === "classic"
        ? createNewGame(config, content)
        : createProgressiveNewGame(config, content),
      content,
      options,
    );
  }

  getView(): GameView {
    return this.#view;
  }

  getClock(): ClockView {
    return this.#clock.getView();
  }

  getSnapshot(): RuntimeSnapshot {
    return Object.freeze({
      gameView: this.#view,
      clockView: this.#clock.getView(),
      ...(this.#lastReceipt === undefined ? {} : { lastReceipt: this.#lastReceipt }),
      ...(this.#fault === undefined ? {} : { fault: this.#fault }),
    });
  }

  getPostRunAudit(): BrowserPostRunAudit {
    this.#assertUsable();
    return projectPostRunAudit(this.#state, this.#content);
  }

  readDevelopmentSnapshot(): RuntimeDevelopmentSnapshot {
    this.#assertUsable();
    if (!this.#developmentToolsEnabled) {
      throw new Error("Privileged development tools are disabled in this build");
    }
    return Object.freeze({
      canonicalState: this.#state,
      currentTickPhase: this.#currentTickPhase,
      ...(this.#lastCommandValidation === undefined
        ? {}
        : { lastCommandValidation: this.#lastCommandValidation }),
      ...(this.#lastTransition === undefined
        ? {}
        : { lastTransition: this.#lastTransition }),
      ...(this.#lastFault === undefined ? {} : { lastFault: this.#lastFault }),
    });
  }

  getAutosaveStatus(): AutosaveStatus {
    return Object.freeze({
      pendingWrites: this.#pendingSaveWrites,
      completedWrites: this.#completedSaveWrites,
      lastCompletedTriggers: Object.freeze([...this.#lastCompletedSaveTriggers]),
      ...(this.#lastSaveError === undefined ? {} : { lastError: this.#lastSaveError }),
    });
  }

  async flushAutosaves(): Promise<void> {
    await this.#saveQueue;
    if (this.#lastSaveError !== undefined) {
      throw new Error(`Persistence failed: ${this.#lastSaveError}`);
    }
  }

  /** Persist the latest coherent state before deliberately leaving the run. */
  async saveForExit(): Promise<void> {
    this.#assertUsable();
    const trigger: AutosaveTrigger = {
      reason: "manual-exit",
      timing: "after",
    };
    this.#enqueueAutosave(this.#state, [trigger]);
    await this.flushAutosaves();
  }

  subscribe(listener: RuntimeListener): Unsubscribe {
    this.#assertUsable();
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispatch(command: GameCommand): RuntimeReceipt {
    this.#assertUsable();
    if (this.#fault !== undefined) return this.#faultReceipt(this.#fault);
    const startedAt = this.#developmentToolsEnabled ? this.#nowMilliseconds() : 0;
    try {
      if (this.#developmentToolsEnabled) {
        this.#recordCommandValidation(
          command,
          validateCommand(this.#state, this.#content, command),
        );
      }
      const before = this.#state;
      const criticalResolution = this.#isCriticalEventResponse(command);
      const result = this.#applyGameCommand(this.#state, this.#content, command);
      const triggers: AutosaveTrigger[] = [];
      if (criticalResolution) {
        const beforeTrigger = {
          reason: "critical-event-resolution" as const,
          timing: "before" as const,
        };
        triggers.push(beforeTrigger);
        this.#enqueueAutosave(before, [beforeTrigger]);
      }
      const afterTriggers = transitionAutosaveTriggers(result);
      if (criticalResolution) {
        afterTriggers.push({
          reason: "critical-event-resolution",
          timing: "after",
        });
      }
      triggers.push(...afterTriggers);
      const receipt = this.#commitTransition(result, triggers);
      this.#recordTransition("command", result, startedAt, []);
      this.#enqueueTransitionSaves(result.state, afterTriggers);
      this.#clock.acceptExternalOutcome({
        autoPauseReasons: result.autoPauseReasons,
        runStatus: result.state.run.status,
      });
      return receipt;
    } catch (error) {
      if (error instanceof CommandRejectedError) throw error;
      return this.#faultReceipt(
        this.#captureFault(
          "simulation",
          error instanceof ViewProjectionError ? "view-projection" : "command-transition",
          error instanceof ViewProjectionError ? error.cause : error,
        ),
      );
    }
  }

  validate(command: GameCommand): CommandValidation {
    this.#assertUsable();
    if (this.#fault !== undefined) return runtimeFaultValidation();
    try {
      const validation = validateCommand(this.#state, this.#content, command);
      if (this.#developmentToolsEnabled) {
        this.#recordCommandValidation(command, validation);
      }
      return validation;
    } catch (error) {
      this.#captureFault("simulation", "command-validation", error);
      return runtimeFaultValidation();
    }
  }

  setSpeed(speed: ActiveClockSpeed): void {
    this.#assertUsable();
    if (this.#fault !== undefined) return;
    if (this.#hasBlockingEndgameDecision()) {
      this.#clock.pause();
      return;
    }
    this.#clock.setSpeed(speed);
  }

  pause(reason: ClockPauseReason = "manual"): void {
    this.#clock.pause(this.#fault === undefined ? reason : "runtime-fault");
  }

  resume(): ResumeResult {
    this.#assertUsable();
    if (this.#fault !== undefined) {
      return { resumed: false, reason: "runtime-fault" };
    }
    if (
      this.#hasBlockingCriticalEvent() ||
      this.#hasBlockingResearchDirection() ||
      this.#hasBlockingEndgameDecision()
    ) {
      return { resumed: false, reason: "blocking-decision" };
    }
    const result = this.#clock.resume();
    if (result.resumed && this.#state.run.autoPauseReasons.length > 0) {
      const nextState = {
        ...this.#state,
        run: {
          ...this.#state.run,
          autoPauseReasons: [],
        },
      } as CanonicalGameState;
      this.#state = nextState;
      this.#view = this.#projectView(
        nextState,
        this.#content,
        knowledgeContext(nextState),
      );
      this.#enqueueAutosave(nextState, [
        { reason: "auto-pause-cleared", timing: "after" },
      ]);
      this.#publish();
    }
    return result;
  }

  acknowledgePresentation(key: string): boolean {
    this.#assertUsable();
    if (this.#fault !== undefined) return false;
    const acknowledgedItem = this.#state.presentationQueue.find(
      (item) => item.key === key,
    );
    if (acknowledgedItem === undefined) return false;
    // False Dawn presents a mandatory, mechanically consequential fork. It
    // must be consumed by choose-false-dawn-path, never by the generic close
    // path used for informational presentations.
    if (acknowledgedItem.kind === "endgame-return") return false;
    let models = this.#state.models;
    if (acknowledgedItem.kind === "capability-tier") {
      const model = this.#state.models[acknowledgedItem.modelId];
      const tier =
        this.#content.capabilityTiers.definitions[acknowledgedItem.definitionId];
      if (model !== undefined && tier !== undefined) {
        const flags = { ...model.flags };
        const recordedHighest = flags["capability-tier-highest-announced"];
        flags["capability-tier-highest-announced"] = Math.max(
          typeof recordedHighest === "number" && Number.isFinite(recordedHighest)
            ? recordedHighest
            : -1,
          tier.level,
        );
        for (let level = 0; level <= tier.level; level += 1) {
          flags[`capability-tier-reached:${String(level)}`] = true;
        }
        models = {
          ...models,
          [acknowledgedItem.modelId]: {
            ...model,
            flags,
          },
        };
      }
    }
    const nextState = {
      ...this.#state,
      models,
      presentationQueue: this.#state.presentationQueue.filter((item) => item.key !== key),
    } as CanonicalGameState;
    this.#state = nextState;
    this.#view = this.#projectView(nextState, this.#content, knowledgeContext(nextState));
    this.#enqueueAutosave(nextState, [
      { reason: "presentation-acknowledged", timing: "after" },
    ]);
    this.#publish();
    return true;
  }

  stepOneTick(): RuntimeReceipt {
    this.#assertUsable();
    if (this.#fault !== undefined) return this.#faultReceipt(this.#fault);
    if (this.#hasBlockingCriticalEvent()) {
      throw new Error("Cannot advance while a critical decision is unresolved");
    }
    if (this.#hasBlockingResearchDirection()) {
      throw new Error("Cannot advance while a research direction is unresolved");
    }
    if (this.#hasBlockingEndgameDecision()) {
      throw new Error("Cannot advance during an exclusive endgame decision");
    }
    this.#clock.stepOneTick();
    const receipt = this.#lastReceipt;
    if (receipt === undefined) throw new Error("Tick completed without a receipt");
    return receipt;
  }

  /** Called by React error boundaries; raw errors never enter player-visible state. */
  reportPresentationFault(
    scope: Extract<RuntimeFaultScope, "application-shell" | "campus-renderer">,
    error: unknown,
  ): RuntimeFault {
    this.#assertUsable();
    return this.#captureFault("presentation", scope, error);
  }

  /**
   * Serialises the last coherent canonical state without depending on the
   * save repository. It remains available after runtime or presentation faults.
   */
  createEmergencySave(): EmergencySaveExport {
    this.#assertUsable();
    const tickNumber = this.#state.run.tick;
    const lab = this.#state.labs[this.#state.run.playerLabId];
    const labName =
      (lab === undefined
        ? undefined
        : this.#content.labs[lab.definitionId]?.displayName) ?? "Neolab";
    const stem =
      `neolab-emergency-${this.#state.run.runId}-tick-${String(tickNumber).padStart(4, "0")}`.replaceAll(
        /[^a-zA-Z0-9._-]/g,
        "-",
      );
    const envelope = createSaveEnvelope(this.#state, {
      saveId: `emergency-${this.#state.run.runId}-${String(tickNumber)}`,
      slotType: "manual",
      displayName: `${labName} Emergency Recovery`,
      contentHash: this.#content.manifest.bundleHash,
      nowIso: safeNowIso(this.#nowIso),
    });
    return Object.freeze({
      blob: new Blob([JSON.stringify(envelope, null, 2)], {
        type: "application/json",
      }),
      filename: `${stem}.neolab-save.json`,
      ...(this.#fault === undefined ? {} : { fault: this.#fault }),
    });
  }

  /**
   * Exports the captured exception and stack trace without exporting canonical
   * game state. Players can deliberately attach this file to a bug report.
   */
  createFaultDiagnosticReport(
    metadata: RuntimeDiagnosticMetadata = {},
  ): RuntimeDiagnosticExport {
    this.#assertUsable();
    const fault = this.#fault;
    const diagnostic = this.#lastFault;
    if (fault === undefined || diagnostic === undefined) {
      throw new Error("No runtime fault is available for diagnostic export");
    }
    const report = Object.freeze({
      format: "neolab-runtime-diagnostic-v1",
      generatedAtIso: safeNowIso(this.#nowIso),
      fault,
      exception: Object.freeze({
        name: diagnostic.errorName,
        message: diagnostic.errorMessage,
        ...(diagnostic.stack === undefined ? {} : { stack: diagnostic.stack }),
      }),
      runtime: Object.freeze({
        lastCoherentTick: this.#state.run.tick,
        contentBundleHash: this.#content.manifest.bundleHash,
      }),
      client: Object.freeze({
        ...(metadata.applicationVersion === undefined
          ? {}
          : { applicationVersion: metadata.applicationVersion }),
        ...(metadata.pageUrl === undefined ? {} : { pageUrl: metadata.pageUrl }),
        ...(metadata.userAgent === undefined ? {} : { userAgent: metadata.userAgent }),
      }),
    });
    const filename = `neolab-crash-${fault.faultId.replaceAll(
      /[^a-zA-Z0-9._-]/g,
      "-",
    )}-week-${String(fault.tick)}.json`;
    return Object.freeze({
      blob: new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      }),
      filename,
      fault,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#clock.dispose();
    this.#listeners.clear();
    this.#disposed = true;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("BrowserGameRuntime is disposed");
  }

  readonly #consumeTick = (): TickConsumptionResult => {
    const startedAt = this.#developmentToolsEnabled ? this.#nowMilliseconds() : 0;
    const systemTimings: TickSystemTiming[] = [];
    const instrumentation: TickInstrumentation | undefined = this.#developmentToolsEnabled
      ? {
          nowMilliseconds: this.#nowMilliseconds,
          onSystemStart: ({ phase }) => {
            this.#currentTickPhase = phase;
          },
          onSystemComplete: (timing) => {
            systemTimings.push(timing);
          },
        }
      : undefined;
    try {
      const result = this.#advanceTick(this.#state, this.#content, instrumentation);
      const triggers = transitionAutosaveTriggers(result);
      this.#commitTransition(result, triggers);
      this.#recordTransition("tick", result, startedAt, systemTimings);
      this.#enqueueTransitionSaves(result.state, triggers);
      return {
        autoPauseReasons: result.autoPauseReasons,
        runStatus: result.state.run.status,
      };
    } catch (error) {
      this.#captureFault(
        "simulation",
        error instanceof ViewProjectionError ? "view-projection" : "tick-transition",
        error instanceof ViewProjectionError ? error.cause : error,
      );
      return {
        autoPauseReasons: Object.freeze([]),
        runStatus: this.#state.run.status,
      };
    } finally {
      this.#currentTickPhase = "idle";
    }
  };

  #recordCommandValidation(command: GameCommand, validation: CommandValidation): void {
    this.#lastCommandValidation = Object.freeze({
      command: structuredClone(command),
      validation: structuredClone(validation),
    });
  }

  #recordTransition(
    kind: RuntimeTransitionDiagnostic["kind"],
    result: TransitionResult,
    startedAt: number,
    systemTimings: readonly TickSystemTiming[],
  ): void {
    if (!this.#developmentToolsEnabled) return;
    this.#lastTransition = Object.freeze({
      kind,
      description: result.audit.description,
      ...(result.audit.commandId === undefined
        ? {}
        : { commandId: result.audit.commandId }),
      durationMilliseconds: Math.max(0, this.#nowMilliseconds() - startedAt),
      systemTimings: Object.freeze(
        systemTimings.map((timing) => Object.freeze({ ...timing })),
      ),
      domainEvents: Object.freeze([...result.domainEvents]),
      autoPauseReasons: Object.freeze([...result.autoPauseReasons]),
    });
  }

  #commitTransition(
    result: TransitionResult,
    autosaveTriggers: readonly AutosaveTrigger[] = [],
  ): RuntimeReceipt {
    let nextView: GameView;
    try {
      nextView = this.#projectView(
        result.state,
        this.#content,
        knowledgeContext(result.state),
      );
    } catch (error) {
      throw new ViewProjectionError(error);
    }
    this.#state = result.state;
    this.#view = nextView;
    const receipt: RuntimeReceipt = Object.freeze({
      tick: result.state.run.tick,
      description: result.audit.description,
      ...(result.audit.commandId === undefined
        ? {}
        : { commandId: result.audit.commandId }),
      domainEvents: Object.freeze([...result.domainEvents]),
      autoPauseReasons: Object.freeze([...result.autoPauseReasons]),
      autosaveTriggers: Object.freeze([...autosaveTriggers]),
    });
    this.#lastReceipt = receipt;
    return receipt;
  }

  #captureFault(
    kind: RuntimeFaultKind,
    scope: RuntimeFaultScope,
    error: unknown,
  ): RuntimeFault {
    if (this.#fault !== undefined) return this.#fault;
    this.#faultCounter += 1;
    const fault = Object.freeze({
      faultId: `runtime-fault:${String(this.#faultCounter)}`,
      kind,
      scope,
      code:
        kind === "simulation"
          ? ("simulation-transition-failed" as const)
          : ("presentation-render-failed" as const),
      tick: this.#state.run.tick,
    });
    this.#fault = fault;
    this.#lastReceipt = this.#faultReceipt(fault);
    const normalised = normaliseError(error);
    this.#lastFault = Object.freeze({ fault, ...normalised });
    try {
      this.#onRuntimeFault?.(fault, error);
    } catch {
      // Observability can never turn a recoverable runtime fault into a second fault.
    }
    this.#clock.pause("runtime-fault");
    return fault;
  }

  #faultReceipt(fault: RuntimeFault): RuntimeReceipt {
    const existing = this.#lastReceipt;
    if (existing?.fault?.faultId === fault.faultId) return existing;
    const receipt = Object.freeze({
      tick: this.#state.run.tick,
      description: "Runtime paused after an unexpected fault",
      domainEvents: Object.freeze([]),
      autoPauseReasons: Object.freeze([]),
      autosaveTriggers: Object.freeze([]),
      fault,
    });
    this.#lastReceipt = receipt;
    return receipt;
  }

  #isCriticalEventResponse(command: GameCommand): boolean {
    if (command.kind !== "respond-to-decision-event") return false;
    const instance = this.#state.eventInstances[command.instanceId];
    if (instance?.status !== "unresolved") return false;
    return (
      this.#content.events.definitions[instance.definitionId]?.severity === "critical"
    );
  }

  #hasBlockingCriticalEvent(): boolean {
    return this.#view.eventQueue.items.some((item) => item.severity === "critical");
  }

  #hasBlockingResearchDirection(): boolean {
    const playerLab = this.#state.labs[this.#state.run.playerLabId];
    return (playerLab?.research.pendingGenericAdvances.length ?? 0) > 0;
  }

  #hasBlockingEndgameDecision(): boolean {
    return endgameClockStopReason(this.#state) !== undefined;
  }

  #enqueueAutosave(
    state: CanonicalGameState,
    triggers: readonly AutosaveTrigger[],
  ): void {
    this.#enqueueSave(state, triggers, this.#autosaveId, "autosave");
  }

  #enqueueTransitionSaves(
    state: CanonicalGameState,
    triggers: readonly AutosaveTrigger[],
  ): void {
    const ordinary = triggers.filter((trigger) => trigger.reason !== "crisis-start");
    const crisis = triggers.filter((trigger) => trigger.reason === "crisis-start");
    if (ordinary.length > 0) this.#enqueueAutosave(state, ordinary);
    if (crisis.length > 0) {
      const candidateId =
        state.endgame.stage !== "inactive" && "candidateModelId" in state.endgame
          ? state.endgame.candidateModelId
          : "unknown-candidate";
      this.#enqueueSave(
        state,
        crisis,
        `crisis-start-${state.run.runId}-${candidateId}`,
        "crisis-checkpoint",
      );
    }
    // The tutorial is an intentionally quiet, generously funded sandbox. It
    // can be resumed and explored, but must never enter competitive boards.
    if (
      !this.#view.meta.guidedTutorial &&
      triggers.some((trigger) => trigger.reason === "run-ended")
    ) {
      this.#enqueueHighScore(state);
    }
  }

  #enqueueHighScore(state: CanonicalGameState): void {
    if (this.#recordedHighScoreRunIds.has(state.run.runId)) return;
    const entry = createHighScoreEntry(state, this.#content, this.#nowIso());
    this.#recordedHighScoreRunIds.add(state.run.runId);
    this.#saveQueue = this.#saveQueue.then(async () => {
      try {
        await this.#highScoreRepository.record(entry);
        this.#lastSaveError = undefined;
      } catch (error) {
        this.#lastSaveError = error instanceof Error ? error.message : String(error);
        this.#recordedHighScoreRunIds.delete(state.run.runId);
      }
    });
  }

  #enqueueSave(
    state: CanonicalGameState,
    triggers: readonly AutosaveTrigger[],
    saveId: string,
    slotType: "autosave" | "crisis-checkpoint",
  ): void {
    const capturedState = state;
    const capturedTriggers = Object.freeze([...triggers]);
    const lab = state.labs[state.run.playerLabId];
    const nowIso = this.#nowIso();
    const displayName = `${
      (lab === undefined
        ? undefined
        : this.#content.labs[lab.definitionId]?.displayName) ?? "Neolab"
    } ${slotType === "crisis-checkpoint" ? "Crisis Start" : "Autosave"}`;
    this.#pendingSaveWrites += 1;
    this.#saveQueue = this.#saveQueue.then(async () => {
      try {
        await this.#saveRepository.write({
          state: capturedState,
          saveId,
          slotType,
          displayName,
          contentHash: this.#content.manifest.bundleHash,
          nowIso,
        });
        this.#completedSaveWrites += 1;
        this.#lastCompletedSaveTriggers = capturedTriggers;
        this.#lastSaveError = undefined;
      } catch (error) {
        this.#lastSaveError = error instanceof Error ? error.message : String(error);
      } finally {
        this.#pendingSaveWrites -= 1;
      }
    });
  }

  readonly #publish = (): void => {
    if (this.#disposed) return;
    const snapshot = this.getSnapshot();
    for (const listener of [...this.#listeners]) listener(snapshot);
  };
}

function runtimeFaultValidation(): CommandValidation {
  return Object.freeze({
    ok: false,
    errors: Object.freeze([
      Object.freeze({
        code: "runtime-fault",
        message: "The simulation is paused for recovery.",
      }),
    ]),
  });
}

function normaliseError(error: unknown): {
  readonly errorName: string;
  readonly errorMessage: string;
  readonly stack?: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { errorName: "UnknownError", errorMessage: String(error) };
}

function safeNowIso(nowIso: () => string): string {
  try {
    return nowIso();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

function transitionAutosaveTriggers(result: TransitionResult): AutosaveTrigger[] {
  const reasons = new Set<AutosaveReason>();
  for (const event of result.domainEvents) {
    if (event.kind === "cycle-boundary") reasons.add("cycle-boundary");
    if (event.kind === "project-completed") reasons.add("major-project-completed");
    if (event.kind === "endgame-crisis-started") reasons.add("crisis-start");
    if (event.kind === "run-ended") reasons.add("run-ended");
  }
  return [...reasons].map((reason) => ({ reason, timing: "after" as const }));
}

function knowledgeContext(state: CanonicalGameState): PlayerKnowledgeContext {
  const lab = state.labs[state.run.playerLabId];
  const models = lab?.models.modelIds.map((modelId) => state.models[modelId]) ?? [];
  return {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: {},
    evidenceAccess: {
      evaluationIds: models.flatMap((model) => model?.evaluations ?? []),
      anomalyIds: models.flatMap((model) => model?.anomalies ?? []),
    },
  };
}
