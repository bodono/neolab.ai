import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  BrowserGameRuntime,
  ClockView,
  GameView,
  RuntimeFault,
} from "../runtime/index.ts";

export type AppRoute = "title" | "new-game" | "game";
export type PrimarySection = "operations" | "research" | "people" | "campus";

export interface OverlayState {
  readonly kind: "researcher" | "facility" | "decision";
  readonly entityId?: string;
}

/**
 * This store is intentionally a view cache plus ephemeral interface state.
 * It has no dispatch/apply/tick action and never receives canonical GameState.
 */
export interface WebStoreState {
  readonly gameView: GameView | undefined;
  readonly clockView: ClockView | undefined;
  readonly runtimeFault: RuntimeFault | undefined;
  readonly route: AppRoute;
  readonly selectedPrimarySection: PrimarySection;
  readonly openOverlay: OverlayState | undefined;
  readonly reducedMotion: boolean;
  readonly runtimeStatus: "none" | "loading" | "ready" | "error";
  readonly runtimeError: string | undefined;
  navigate(route: AppRoute): void;
  selectPrimarySection(section: PrimarySection): void;
  open(overlay: OverlayState): void;
  closeOverlay(): void;
  setReducedMotion(enabled: boolean): void;
}

export type GameStore = StoreApi<WebStoreState>;

export interface RuntimeStoreBridge {
  readonly store: GameStore;
  dispose(): void;
}

export function createRuntimeStoreBridge(
  runtime: BrowserGameRuntime,
): RuntimeStoreBridge {
  const initial = runtime.getSnapshot();
  const store = createStore<WebStoreState>()((set) => ({
    gameView: initial.gameView,
    clockView: initial.clockView,
    runtimeFault: initial.fault,
    route: "game",
    selectedPrimarySection: "operations",
    openOverlay: undefined,
    reducedMotion: false,
    runtimeStatus: "ready",
    runtimeError: undefined,
    navigate: (route) => {
      set({ route });
    },
    selectPrimarySection: (selectedPrimarySection) => {
      set({ selectedPrimarySection });
    },
    open: (openOverlay) => {
      set({ openOverlay });
    },
    closeOverlay: () => {
      set({ openOverlay: undefined });
    },
    setReducedMotion: (reducedMotion) => {
      set({ reducedMotion });
    },
  }));

  const unsubscribe = runtime.subscribe((snapshot) => {
    store.setState({
      gameView: snapshot.gameView,
      clockView: snapshot.clockView,
      runtimeFault: snapshot.fault,
      runtimeStatus: snapshot.fault === undefined ? "ready" : "error",
      runtimeError:
        snapshot.fault === undefined
          ? undefined
          : "The simulation is paused for recovery.",
    });
  });

  return {
    store,
    dispose(): void {
      unsubscribe();
    },
  };
}
