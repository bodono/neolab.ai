export interface AmbientLogEntry {
  readonly tick: number;
  readonly summary: string;
  readonly category: string;
}

export interface AmbientNoticeSelection<T extends AmbientLogEntry> {
  readonly entry: T;
  readonly key: string;
}

export interface AmbientNoticeBurst<T extends AmbientLogEntry> {
  readonly tick: number;
  readonly items: readonly AmbientNoticeSelection<T>[];
}

export interface ResearcherPromiseNoticeInput {
  readonly researcherId: string;
  readonly displayName: string;
  readonly compact: { readonly label: string };
  readonly compactStatus:
    "not-applicable" | "tracking" | "fulfilled" | "warning" | "breached";
  readonly compactReview: {
    readonly includedInOffer: boolean;
    readonly reviewInWeeks?: number;
  };
  readonly promises: readonly {
    readonly id: string;
    readonly label: string;
    readonly status: "pending" | "kept" | "broken" | "waived";
    readonly dueAtTick: number;
  }[];
}

export interface ResearcherPromiseWarning {
  readonly key: string;
  readonly researcherId: string;
  readonly researcherName: string;
  readonly promiseLabel: string;
  readonly weeksRemaining: number;
}

export function imminentResearcherPromiseWarnings(
  researchers: readonly ResearcherPromiseNoticeInput[],
  currentTick: number,
  warningWeeks = 2,
): readonly ResearcherPromiseWarning[] {
  const warnings = researchers.flatMap((researcher) => {
    const compactWeeks = researcher.compactReview.reviewInWeeks;
    const compactDeadline =
      compactWeeks === undefined ? undefined : currentTick + compactWeeks;
    const compactWarning: readonly ResearcherPromiseWarning[] =
      researcher.compactReview.includedInOffer &&
      compactWeeks !== undefined &&
      compactWeeks > 0 &&
      compactWeeks <= warningWeeks &&
      researcher.compactStatus !== "fulfilled" &&
      researcher.compactStatus !== "breached" &&
      researcher.compactStatus !== "not-applicable"
        ? [
            {
              key: `compact:${researcher.researcherId}:${String(compactDeadline)}`,
              researcherId: researcher.researcherId,
              researcherName: researcher.displayName,
              promiseLabel: researcher.compact.label,
              weeksRemaining: compactWeeks,
            },
          ]
        : [];
    const explicitWarnings = researcher.promises.flatMap((promise) => {
      const weeksRemaining = promise.dueAtTick - currentTick;
      return promise.status === "pending" &&
        weeksRemaining > 0 &&
        weeksRemaining <= warningWeeks
        ? [
            {
              key: `promise:${researcher.researcherId}:${promise.id}:${String(promise.dueAtTick)}`,
              researcherId: researcher.researcherId,
              researcherName: researcher.displayName,
              promiseLabel: promise.label,
              weeksRemaining,
            },
          ]
        : [];
    });
    return [...compactWarning, ...explicitWarnings];
  });
  return warnings.sort(
    (left, right) =>
      left.weeksRemaining - right.weeksRemaining ||
      left.researcherName.localeCompare(right.researcherName) ||
      left.key.localeCompare(right.key),
  );
}

/** Feed chatter that also surfaces as a transient side notice. */
function isChatterEntry(entry: AmbientLogEntry): boolean {
  return entry.category === "ambient" || entry.category === "reaction";
}

export function newestAmbientBurst<T extends AmbientLogEntry>(
  entries: readonly T[],
): AmbientNoticeBurst<T> | undefined {
  let newestTick: number | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && isChatterEntry(entry)) {
      newestTick = entry.tick;
      break;
    }
  }
  if (newestTick === undefined) return undefined;
  return {
    tick: newestTick,
    items: entries
      .filter((entry) => isChatterEntry(entry) && entry.tick === newestTick)
      .map((entry) => ({
        entry,
        key: `${String(entry.tick)}:${entry.summary}`,
      })),
  };
}

export function liveAmbientNotice<T extends AmbientLogEntry>(
  entries: readonly T[],
  dismissedKeys: ReadonlySet<string>,
  currentTick: number,
  maximumAgeWeeks: number,
  activeBurstTick?: number,
): AmbientNoticeSelection<T> | undefined {
  const burst = newestAmbientBurst(entries);
  if (
    burst === undefined ||
    (burst.tick !== activeBurstTick && currentTick - burst.tick > maximumAgeWeeks)
  ) {
    return undefined;
  }
  return burst.items.find((item) => !dismissedKeys.has(item.key));
}
