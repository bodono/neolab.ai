import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useStore } from "zustand";

import type { loadBrowserCompiledContent } from "@neolab/content/browser";

import type { RuntimeStoreBridge } from "./game-store.ts";
import type { BrowserGameRuntime } from "../runtime/index.ts";

export type BrowserContent = ReturnType<typeof loadBrowserCompiledContent>;

export interface GameSession {
  readonly runtime: BrowserGameRuntime;
  readonly bridge: RuntimeStoreBridge;
  readonly content: BrowserContent;
}

const SessionContext = createContext<GameSession | undefined>(undefined);

export function RuntimeProvider({
  session,
  children,
}: {
  readonly session: GameSession;
  readonly children: ReactNode;
}): ReactElement {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useGameSession(): GameSession {
  const session = useContext(SessionContext);
  if (session === undefined) throw new Error("Game session is not available");
  return session;
}

export function useGameStore<T>(
  selector: (state: ReturnType<GameSession["bridge"]["store"]["getState"]>) => T,
): T {
  const { bridge } = useGameSession();
  return useStore(bridge.store, selector);
}
