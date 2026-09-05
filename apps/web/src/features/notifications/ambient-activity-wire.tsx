import { useEffect, useMemo, useState, type ReactElement } from "react";

import type { GameView } from "@neolab/sim/public";

import {
  liveAmbientNotice,
  newestAmbientBurst,
  type AmbientNoticeSelection,
} from "./activity-notice-policy.ts";

const AMBIENT_FRESH_WEEKS = 8;
const AMBIENT_READING_TIME_MS = 12_000;

type GameAmbientNotice = AmbientNoticeSelection<GameView["decisionLog"][number]>;

function ambientLabel(entry: GameView["decisionLog"][number]): string {
  const sourceId = entry.source?.id;
  if (entry.category === "reaction") return "REACTION";
  if (sourceId === "ambient:ai") return "AI NOTE";
  if (sourceId === "ambient:campus") return "CAMPUS WIRE";
  if (sourceId === "ambient:nerves") return "OVERHEARD";
  if (sourceId === "ambient:money") return "FINANCE WIRE";
  if (sourceId?.startsWith("ambient:rival:") === true) return "RIVAL GOSSIP";
  if (entry.source?.kind === "researcher") return "LAB CHAT";
  return "LAB CHAT";
}

/**
 * A deliberately quiet home for ambient colour. It lives in the identity
 * header so consequential bottom-right notices can never cover or suppress it.
 */
export function AmbientActivityWire({
  view,
  suppressed,
}: {
  readonly view: GameView;
  readonly suppressed: boolean;
}): ReactElement | null {
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set<string>());
  const [activeBurstTick, setActiveBurstTick] = useState<number>();
  const [pinnedAmbient, setPinnedAmbient] = useState<GameAmbientNotice>();
  const latestBurst = useMemo(
    () => newestAmbientBurst(view.decisionLog),
    [view.decisionLog],
  );
  const liveAmbient = useMemo(
    () =>
      liveAmbientNotice(
        view.decisionLog,
        dismissedKeys,
        view.meta.tick,
        AMBIENT_FRESH_WEEKS,
        activeBurstTick,
      ),
    [activeBurstTick, dismissedKeys, view.decisionLog, view.meta.tick],
  );
  const displayedAmbient = pinnedAmbient ?? liveAmbient;

  useEffect(() => {
    if (!suppressed && pinnedAmbient === undefined && liveAmbient !== undefined) {
      // Simulation time can advance several weeks while this note is being
      // read. Pin the current note so a newer 4x-speed tick cannot replace it.
      setPinnedAmbient(liveAmbient);
    }
  }, [liveAmbient, pinnedAmbient, suppressed]);

  useEffect(() => {
    if (
      suppressed ||
      liveAmbient === undefined ||
      latestBurst === undefined ||
      activeBurstTick === latestBurst.tick
    ) {
      return;
    }
    // Once a fresh burst starts displaying, let every same-week item drain
    // even if 4x simulation speed advances beyond the freshness window.
    setActiveBurstTick(latestBurst.tick);
  }, [activeBurstTick, latestBurst, liveAmbient, suppressed]);

  const ambientKey = displayedAmbient?.key;
  useEffect(() => {
    if (suppressed || ambientKey === undefined) return undefined;
    const timer = window.setTimeout(() => {
      setDismissedKeys((current) => new Set([...current, ambientKey]));
      setPinnedAmbient(undefined);
    }, AMBIENT_READING_TIME_MS);
    return () => window.clearTimeout(timer);
  }, [ambientKey, suppressed]);

  const ambient = displayedAmbient?.entry;
  if (suppressed || ambient === undefined || ambientKey === undefined) return null;

  return (
    <aside className="ambient-header-wire" aria-live="polite">
      <span>{ambientLabel(ambient)} // AMBIENT</span>
      <strong title={ambient.summary}>{ambient.summary}</strong>
      <small>NO GAME EFFECT</small>
      <button
        type="button"
        aria-label="Dismiss ambient update"
        onClick={() => {
          setDismissedKeys((current) => new Set([...current, ambientKey]));
          setPinnedAmbient(undefined);
        }}
      >
        ×
      </button>
    </aside>
  );
}
