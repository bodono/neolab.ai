import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { loadBrowserCompiledContent } from "@neolab/content/browser";
import type {
  HighScoreBoard,
  HighScoreEntry,
  HighScoreRepository,
  LoadSaveResult,
  NewGameConfig,
  SaveMetadata,
  SaveRepository,
} from "@neolab/sim/public";
import { createGuidedTutorialGame } from "@neolab/sim/public";

import { createRuntimeStoreBridge } from "./game-store.ts";
import { APPLICATION_VERSION, ApplicationVersion } from "./application-version.tsx";
import { LeaderFavicon } from "./leader-favicon.tsx";
import { ThemeControl } from "./theme-control.tsx";
import { RuntimeProvider, type GameSession } from "./runtime-provider.tsx";
import { AudioProvider, useAudio } from "../audio/audio-provider.tsx";
import { LocalStorageAudioSettingsRepository } from "../audio/audio-settings.ts";
import { WebAudioManager } from "../audio/web-audio-manager.ts";
import {
  BrowserGameRuntime,
  LocalDiagnostics,
  IndexedDbHighScoreRepository,
  IndexedDbSaveRepository,
} from "../runtime/index.ts";
import { GameShell } from "../screens/game-shell.tsx";
import { ApplicationErrorBoundary } from "../features/recovery/runtime-recovery.tsx";
import { HighScoresScreen } from "../screens/high-scores-screen.tsx";
import { NewGameScreen } from "../screens/new-game-screen.tsx";
import { TitleScreen } from "../screens/title-screen.tsx";
import { AnalyticsClient } from "../telemetry/analytics-client.ts";
import { resolveAnalyticsConfig } from "../telemetry/analytics-config.ts";
import {
  observeRuntimeAnalytics,
  type RunAnalyticsSource,
} from "../telemetry/runtime-analytics-observer.ts";

const content = loadBrowserCompiledContent();
const DevelopmentInspector = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import("../features/developer/development-inspector.tsx");
      return { default: module.DevelopmentInspector };
    })
  : undefined;

export function NeolabApp(): ReactElement {
  const audioManager = useMemo(() => new WebAudioManager(), []);
  const audioSettingsRepository = useMemo(
    () => new LocalStorageAudioSettingsRepository(),
    [],
  );

  return (
    <AudioProvider manager={audioManager} repository={audioSettingsRepository}>
      <NeolabRoutes />
      <ApplicationVersion />
    </AudioProvider>
  );
}

function NeolabRoutes(): ReactElement {
  const audio = useAudio();
  const analytics = useMemo(() => {
    const config = resolveAnalyticsConfig(import.meta.env, window.location);
    const storage = safelyReadLocalStorage();
    return new AnalyticsClient({
      ...(config === undefined ? {} : { config }),
      ...(storage === undefined ? {} : { storage }),
      applicationVersion: APPLICATION_VERSION,
      browser: { window, document },
    });
  }, []);
  const appLoadedTracked = useRef(false);
  const [route, setRoute] = useState<"title" | "new-game" | "game" | "high-scores">(
    "title",
  );
  const [session, setSession] = useState<GameSession>();
  const [runAnalytics, setRunAnalytics] = useState<{
    readonly runtime: BrowserGameRuntime;
    readonly source: RunAnalyticsSource;
    readonly newGameConfig?: NewGameConfig;
  }>();
  const [saves, setSaves] = useState<readonly SaveMetadata[]>([]);
  const [persistenceBusy, setPersistenceBusy] = useState(false);
  const [persistenceMessage, setPersistenceMessage] = useState<string>();
  const [persistenceError, setPersistenceError] = useState<string>();
  const saveRepository = useMemo<SaveRepository>(() => new IndexedDbSaveRepository(), []);
  const highScoreRepository = useMemo<HighScoreRepository>(
    () => new IndexedDbHighScoreRepository(),
    [],
  );
  const [highScoreBoards, setHighScoreBoards] = useState<
    Record<HighScoreBoard, readonly HighScoreEntry[]>
  >({ "all-finished-runs": [], "winning-runs": [] });
  const [highScoreBusy, setHighScoreBusy] = useState(false);
  const [highScoreError, setHighScoreError] = useState<string>();
  const diagnostics = useMemo(() => new LocalDiagnostics(), []);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState(() =>
    diagnostics.getSnapshot(),
  );

  const openState = useCallback(
    (state: LoadSaveResult["state"], source: RunAnalyticsSource = "resume"): void => {
      const runtime = new BrowserGameRuntime(state, content, {
        saveRepository,
        highScoreRepository,
        enableDevelopmentTools: import.meta.env.DEV,
        onRuntimeFault: (fault, error) => analytics.trackRuntimeFault(fault, error),
      });
      const bridge = createRuntimeStoreBridge(runtime);
      setSession({ runtime, bridge, content });
      setRunAnalytics({ runtime, source });
      setRoute("game");
    },
    [analytics, highScoreRepository, saveRepository],
  );

  useEffect(() => {
    if (appLoadedTracked.current) return;
    appLoadedTracked.current = true;
    analytics.track("app_loaded", { visit_id: analytics.visitId });
  }, [analytics]);

  useEffect(() => () => analytics.dispose(), [analytics]);

  useEffect(() => {
    if (runAnalytics === undefined) return;
    return observeRuntimeAnalytics({
      runtime: runAnalytics.runtime,
      analytics,
      source: runAnalytics.source,
      ...(runAnalytics.newGameConfig === undefined
        ? {}
        : { newGameConfig: runAnalytics.newGameConfig }),
    });
  }, [analytics, runAnalytics]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [route]);

  useEffect(() => {
    const unsubscribe = diagnostics.subscribe(setDiagnosticsSnapshot);
    diagnostics.record({ name: "app-opened" });
    return unsubscribe;
  }, [diagnostics]);

  useEffect(
    () => () => {
      session?.bridge.dispose();
      session?.runtime.dispose();
    },
    [session],
  );

  useEffect(() => {
    if (route !== "title") return;
    let active = true;
    setPersistenceBusy(true);
    void saveRepository
      .list()
      .then((listed) => {
        if (!active) return;
        setSaves(listed);
        setPersistenceError(undefined);
      })
      .catch((error: unknown) => {
        if (!active) return;
        diagnostics.record({ name: "operation-failed", operation: "list-saves" });
        setPersistenceError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setPersistenceBusy(false);
      });
    return () => {
      active = false;
    };
  }, [diagnostics, route, saveRepository]);

  useEffect(() => {
    if (route !== "high-scores") return;
    let active = true;
    setHighScoreBusy(true);
    void Promise.all([
      highScoreRepository.list("all-finished-runs"),
      highScoreRepository.list("winning-runs"),
    ])
      .then(([all, winning]) => {
        if (active) {
          setHighScoreBoards({
            "all-finished-runs": all,
            "winning-runs": winning,
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          diagnostics.record({ name: "operation-failed", operation: "list-scores" });
          setHighScoreError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (active) setHighScoreBusy(false);
      });
    return () => {
      active = false;
    };
  }, [diagnostics, highScoreRepository, route]);

  useEffect(() => {
    if (!import.meta.env.DEV || route !== "title" || session !== undefined) return;
    const scenarioId = new URLSearchParams(window.location.search).get("scenario");
    if (scenarioId === null) return;
    let active = true;
    setPersistenceBusy(true);
    setPersistenceError(undefined);
    void import("@neolab/sim/debug")
      .then(({ createEndgamePlaytestState, isEndgamePlaytestScenarioId }) => {
        if (!active) return;
        if (!isEndgamePlaytestScenarioId(scenarioId)) {
          throw new Error(`Unknown development scenario: ${scenarioId}`);
        }
        openState(createEndgamePlaytestState(content, scenarioId), "scenario");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPersistenceError(
          error instanceof Error
            ? `Could not load the endgame playtest: ${error.message}`
            : `Could not load the endgame playtest: ${String(error)}`,
        );
      })
      .finally(() => {
        if (active) setPersistenceBusy(false);
      });
    return () => {
      active = false;
    };
  }, [openState, route, session]);

  function launch(config: NewGameConfig): void {
    diagnostics.record({
      name: "game-started",
      leaderId: config.leaderId,
      difficultyId: config.difficultyId,
      mandateId: config.mandateId,
    });
    const runtime = BrowserGameRuntime.createNew(config, content, {
      saveRepository,
      highScoreRepository,
      enableDevelopmentTools: import.meta.env.DEV,
      newGameMode:
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).get("campaign") === "classic"
          ? "classic"
          : "progressive",
      onRuntimeFault: (fault, error) => analytics.trackRuntimeFault(fault, error),
    });
    const bridge = createRuntimeStoreBridge(runtime);
    setSession({ runtime, bridge, content });
    setRunAnalytics({ runtime, source: "new", newGameConfig: config });
    setRoute("game");
  }

  function launchTutorial(): void {
    audio.startMuted();
    diagnostics.record({
      name: "game-started",
      leaderId: "base:leader.thomas-hassabi",
      difficultyId: "base:difficulty.standard",
      mandateId: "base:mandate.build-the-science",
    });
    const runtime = new BrowserGameRuntime(createGuidedTutorialGame(content), content, {
      saveRepository,
      highScoreRepository,
      // Tutorial progress must never replace the player's ordinary autosave.
      autosaveId: "tutorial-autosave",
      enableDevelopmentTools: import.meta.env.DEV,
      onRuntimeFault: (fault, error) => analytics.trackRuntimeFault(fault, error),
    });
    const bridge = createRuntimeStoreBridge(runtime);
    setSession({ runtime, bridge, content });
    setRunAnalytics({ runtime, source: "tutorial" });
    setRoute("game");
  }

  async function loadSave(saveId: string): Promise<void> {
    setPersistenceBusy(true);
    setPersistenceError(undefined);
    setPersistenceMessage(undefined);
    try {
      const loaded = await saveRepository.load(saveId);
      diagnostics.record({
        name: "save-loaded",
        slotType: saves.find((save) => save.saveId === saveId)?.slotType ?? "unknown",
      });
      openState(loaded.state);
    } catch (error) {
      diagnostics.record({ name: "operation-failed", operation: "load-save" });
      setRoute("title");
      setPersistenceError(
        error instanceof Error
          ? error.message
          : `Save could not be loaded: ${String(error)}`,
      );
    } finally {
      setPersistenceBusy(false);
    }
  }

  async function importSave(file: File): Promise<void> {
    setPersistenceBusy(true);
    setPersistenceError(undefined);
    setPersistenceMessage(undefined);
    try {
      const imported = await saveRepository.import(file);
      setSaves(await saveRepository.list());
      setPersistenceMessage(`Imported ${imported.metadata.displayName}.`);
    } catch (error) {
      diagnostics.record({ name: "operation-failed", operation: "import-save" });
      setPersistenceError(error instanceof Error ? error.message : String(error));
    } finally {
      setPersistenceBusy(false);
    }
  }

  async function exportSave(save: SaveMetadata): Promise<void> {
    setPersistenceBusy(true);
    setPersistenceError(undefined);
    setPersistenceMessage(undefined);
    try {
      const blob = await saveRepository.export(save.saveId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${save.saveId.replaceAll(/[^a-zA-Z0-9._-]/g, "-")}.neolab-save.json`;
      link.click();
      URL.revokeObjectURL(url);
      setPersistenceMessage(`Exported ${save.displayName}.`);
    } catch (error) {
      diagnostics.record({ name: "operation-failed", operation: "export-save" });
      setPersistenceError(error instanceof Error ? error.message : String(error));
    } finally {
      setPersistenceBusy(false);
    }
  }

  async function restart(): Promise<string | undefined> {
    try {
      await session?.runtime.saveForExit();
    } catch (error) {
      diagnostics.record({ name: "operation-failed", operation: "save-before-exit" });
      return error instanceof Error ? error.message : String(error);
    }
    session?.bridge.dispose();
    session?.runtime.dispose();
    setSession(undefined);
    setRunAnalytics(undefined);
    setRoute("title");
    return undefined;
  }

  async function showHighScores(): Promise<void> {
    setHighScoreBusy(true);
    setHighScoreError(undefined);
    try {
      await session?.runtime.flushAutosaves();
    } catch (error) {
      diagnostics.record({ name: "operation-failed", operation: "delete-score" });
      setHighScoreError(error instanceof Error ? error.message : String(error));
    }
    session?.bridge.dispose();
    session?.runtime.dispose();
    setSession(undefined);
    setRunAnalytics(undefined);
    setRoute("high-scores");
  }

  async function showEndingHighScores(): Promise<void> {
    setHighScoreBusy(true);
    setHighScoreError(undefined);
    try {
      await session?.runtime.flushAutosaves();
      const [all, winning] = await Promise.all([
        highScoreRepository.list("all-finished-runs"),
        highScoreRepository.list("winning-runs"),
      ]);
      setHighScoreBoards({
        "all-finished-runs": all,
        "winning-runs": winning,
      });
    } catch (error) {
      diagnostics.record({ name: "operation-failed", operation: "list-scores" });
      setHighScoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setHighScoreBusy(false);
    }
  }

  function exportDiagnostics(): void {
    const blob = new Blob([diagnostics.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "neolab-local-diagnostics.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteHighScore(runId: string): Promise<void> {
    setHighScoreBusy(true);
    setHighScoreError(undefined);
    try {
      await highScoreRepository.delete(runId);
      const [all, winning] = await Promise.all([
        highScoreRepository.list("all-finished-runs"),
        highScoreRepository.list("winning-runs"),
      ]);
      setHighScoreBoards({ "all-finished-runs": all, "winning-runs": winning });
    } catch (error) {
      setHighScoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setHighScoreBusy(false);
    }
  }

  if (route === "title") {
    return (
      <>
        <TitleScreen
          saves={saves}
          persistenceBusy={persistenceBusy}
          persistenceMessage={persistenceMessage}
          persistenceError={persistenceError}
          diagnostics={diagnosticsSnapshot}
          onStartWithSound={() => {
            audio.startWithSound();
            analytics.track("game_setup_opened", { visit_id: analytics.visitId });
            setRoute("new-game");
          }}
          onStartMuted={() => {
            audio.startMuted();
            analytics.track("game_setup_opened", { visit_id: analytics.visitId });
            setRoute("new-game");
          }}
          onTutorial={launchTutorial}
          onHighScores={() => void showHighScores()}
          onLoad={(saveId) => void loadSave(saveId)}
          onImport={(file) => void importSave(file)}
          onExport={(save) => void exportSave(save)}
          onSetDiagnosticsEnabled={(enabled) => diagnostics.setEnabled(enabled)}
          onExportDiagnostics={exportDiagnostics}
          onClearDiagnostics={() => diagnostics.clear()}
        />
        <ThemeControl />
      </>
    );
  }
  if (route === "high-scores") {
    return (
      <>
        <HighScoresScreen
          boards={highScoreBoards}
          busy={highScoreBusy}
          error={highScoreError}
          onBack={() => setRoute("title")}
          onDelete={(runId) => void deleteHighScore(runId)}
        />
        <ThemeControl />
      </>
    );
  }
  if (route === "new-game") {
    return (
      <>
        <NewGameScreen
          content={content}
          onBack={() => setRoute("title")}
          onLaunch={launch}
        />
        <ThemeControl />
      </>
    );
  }
  if (session === undefined) {
    return (
      <>
        <main className="boot-screen">Starting lab…</main>
        <ThemeControl />
      </>
    );
  }
  return (
    <RuntimeProvider session={session}>
      <LeaderFavicon />
      <ApplicationErrorBoundary runtime={session.runtime}>
        <GameShell
          onRestart={restart}
          onHighScores={() => void showEndingHighScores()}
          highScoreBoards={highScoreBoards}
          highScoreBusy={highScoreBusy}
          highScoreError={highScoreError}
          onDeleteHighScore={(runId) => void deleteHighScore(runId)}
        />
        {DevelopmentInspector === undefined ? null : (
          <Suspense fallback={null}>
            <DevelopmentInspector />
          </Suspense>
        )}
      </ApplicationErrorBoundary>
    </RuntimeProvider>
  );
}

function safelyReadLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
