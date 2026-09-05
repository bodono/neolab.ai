import { useEffect, useMemo, useState, type ReactElement } from "react";

import type { GameView } from "@neolab/sim/public";

import { imminentResearcherPromiseWarnings } from "./activity-notice-policy.ts";

type PresentationItem = GameView["presentationQueue"][number];
type CapabilityPresentationItem = Extract<
  PresentationItem,
  { readonly kind: "capability-tier" }
>;
function sideBatchTitle(items: readonly CapabilityPresentationItem[]): string {
  if (items.length > 1) return `${String(items.length)} rival capability signals`;
  const item = items[0];
  return item === undefined
    ? "Rival capability signal"
    : `${item.modelDisplayName} reportedly reached Tier ${String(item.tierLevel)}`;
}

export function ActivityNoticeLane({
  view,
  suppressed,
  onAcknowledgePresentation,
  onInspectRival,
  onInspectResearcher,
}: {
  readonly view: GameView;
  readonly suppressed: boolean;
  readonly onAcknowledgePresentation: (key: string) => void;
  readonly onInspectRival: (labId: string) => void;
  readonly onInspectResearcher: (researcherId: string) => void;
}): ReactElement | null {
  const [dismissedPromiseKeys, setDismissedPromiseKeys] = useState(
    () => new Set<string>(),
  );
  const [dismissedRivalComponentKeys, setDismissedRivalComponentKeys] = useState(
    () => new Set<string>(),
  );
  // Signals older than this are auto-acknowledged instead of shown: a
  // weeks-old "reportedly reached Tier N" card reads as a stale notification.
  const STALE_SIGNAL_WEEKS = 8;
  const { sideBatch, staleKeys } = useMemo(() => {
    const items = view.presentationQueue
      .filter(
        (item): item is CapabilityPresentationItem =>
          item.kind === "capability-tier" &&
          item.attention === "side" &&
          !item.isPlayerModel,
      )
      .sort((left, right) => left.createdAtTick - right.createdAtTick);
    return {
      // One combined batch rather than a per-tick parade of cards.
      sideBatch: items.filter(
        (item) => view.meta.tick - item.createdAtTick <= STALE_SIGNAL_WEEKS,
      ),
      staleKeys: items
        .filter((item) => view.meta.tick - item.createdAtTick > STALE_SIGNAL_WEEKS)
        .map((item) => item.key),
    };
  }, [view.presentationQueue, view.meta.tick]);
  const staleKeyList = staleKeys.join("|");
  useEffect(() => {
    if (staleKeyList.length === 0) return;
    for (const key of staleKeyList.split("|")) onAcknowledgePresentation(key);
  }, [staleKeyList, onAcknowledgePresentation]);
  const promiseWarnings = useMemo(
    () =>
      imminentResearcherPromiseWarnings(view.people.roster, view.meta.tick).filter(
        (warning) => !dismissedPromiseKeys.has(warning.key),
      ),
    [dismissedPromiseKeys, view.meta.tick, view.people.roster],
  );
  const promiseWarning = promiseWarnings[0];
  const rivalComponentUpdate = useMemo(
    () =>
      [...view.world.componentAnnouncements]
        .reverse()
        .find(
          (announcement) =>
            view.meta.tick - announcement.tick <= STALE_SIGNAL_WEEKS &&
            !dismissedRivalComponentKeys.has(
              `${announcement.labId}:${announcement.componentType}:${announcement.kind}`,
            ),
        ),
    [dismissedRivalComponentKeys, view.meta.tick, view.world.componentAnnouncements],
  );
  const highestTier = sideBatch.reduce(
    (highest, item) => Math.max(highest, item.tierLevel),
    0,
  );
  const sideBatchKey = sideBatch.map((item) => item.key).join("|");

  useEffect(() => {
    if (suppressed) return undefined;
    if (sideBatchKey.length > 0) {
      if (highestTier >= 5) return undefined;
      const timer = window.setTimeout(() => {
        for (const key of sideBatchKey.split("|")) onAcknowledgePresentation(key);
      }, 12_000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [highestTier, onAcknowledgePresentation, sideBatchKey, suppressed]);

  if (suppressed) return null;
  if (promiseWarning !== undefined) {
    const weekLabel =
      promiseWarning.weeksRemaining === 1
        ? "1 week"
        : `${String(promiseWarning.weeksRemaining)} weeks`;
    return (
      <aside className="activity-notice-lane promise-warning" aria-live="polite">
        <header>
          <span>
            PROMISE DEADLINE
            {promiseWarnings.length > 1
              ? ` · ${String(promiseWarnings.length)} AT RISK`
              : ""}
          </span>
          <button
            type="button"
            onClick={() =>
              setDismissedPromiseKeys(
                (current) => new Set([...current, promiseWarning.key]),
              )
            }
          >
            Dismiss
          </button>
        </header>
        <strong>
          {promiseWarning.researcherName}'s promise is due in {weekLabel}
        </strong>
        <p>
          “{promiseWarning.promiseLabel}” is still at risk. Complete its requirement
          before the review or the promise will be broken.
        </p>
        <button
          className="notice-action"
          type="button"
          onClick={() => {
            setDismissedPromiseKeys(
              (current) => new Set([...current, promiseWarning.key]),
            );
            onInspectResearcher(promiseWarning.researcherId);
          }}
        >
          Open researcher dossier
        </button>
      </aside>
    );
  }
  if (rivalComponentUpdate !== undefined) {
    const updateKey = `${rivalComponentUpdate.labId}:${rivalComponentUpdate.componentType}:${rivalComponentUpdate.kind}`;
    const dismiss = (): void => {
      setDismissedRivalComponentKeys((current) => new Set([...current, updateKey]));
    };
    return (
      <aside className="activity-notice-lane rival-component-update" aria-live="polite">
        <header>
          <span>RIVAL AGI PROGRAMME</span>
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </header>
        <strong>
          {rivalComponentUpdate.labName}{" "}
          {rivalComponentUpdate.kind === "started" ? "started" : "completed"}{" "}
          {rivalComponentUpdate.componentName}
        </strong>
        <p>
          {rivalComponentUpdate.kind === "started"
            ? "A rival AGI Candidate Programme work is now under construction."
            : "One of its four AGI Candidate Programme works is now complete."}
        </p>
        <button
          className="notice-action"
          type="button"
          onClick={() => {
            dismiss();
            onInspectRival(rivalComponentUpdate.labId);
          }}
        >
          Open rival intelligence
        </button>
      </aside>
    );
  }
  if (sideBatch.length > 0) {
    const first = sideBatch[0];
    if (first === undefined) return null;
    return (
      <aside
        className={`activity-notice-lane rival-signal tier-${String(highestTier)}`}
        aria-live={highestTier >= 5 ? "assertive" : "polite"}
      >
        <header>
          <span>{highestTier >= 5 ? "FRONTIER WARNING" : "RIVAL UPDATE"}</span>
          <button
            type="button"
            onClick={() => {
              for (const item of sideBatch) onAcknowledgePresentation(item.key);
            }}
          >
            Dismiss
          </button>
        </header>
        <strong>{sideBatchTitle(sideBatch)}</strong>
        {sideBatch.length === 1 ? (
          <p>
            {first.ownerLabName} reports {first.title}. Exact capability and safety remain
            unobservable.
          </p>
        ) : (
          <ul>
            {sideBatch.map((item) => (
              <li key={item.key}>
                {item.ownerLabName}: {item.modelDisplayName}, Tier{" "}
                {String(item.tierLevel)}
              </li>
            ))}
          </ul>
        )}
        <button
          className="notice-action"
          type="button"
          onClick={() => {
            for (const item of sideBatch) onAcknowledgePresentation(item.key);
            onInspectRival(first.ownerLabId);
          }}
        >
          Open rival intelligence
        </button>
      </aside>
    );
  }

  return null;
}
