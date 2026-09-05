import type { GameView } from "@neolab/sim/public";

export type PresentableAnomaly = GameView["models"]["cards"][number]["anomalies"][number];

export function anomalyPresentationKey(anomaly: PresentableAnomaly): string {
  // observationCount changes when a later evaluation reproduces an existing
  // underlying case. Including it makes reopened evidence present again even
  // when the case returns to a status the player acknowledged previously.
  return `${anomaly.anomalyId}:${anomaly.status}:${String(anomaly.investigationAttempts)}:${String(anomaly.observationCount)}`;
}

export function selectAnomalyForPresentation<
  TModel extends { readonly anomalies: readonly PresentableAnomaly[] },
>({
  acknowledgedKeys,
  activeAnomalyId,
  anomalyDetectionPending,
  investigationCompletionPending,
  models,
}: {
  readonly acknowledgedKeys: ReadonlySet<string>;
  readonly activeAnomalyId: string | undefined;
  readonly anomalyDetectionPending: boolean;
  readonly investigationCompletionPending: boolean;
  readonly models: readonly TModel[];
}): { readonly anomaly: PresentableAnomaly; readonly model: TModel } | undefined {
  const records = models
    .flatMap((model) => model.anomalies.map((anomaly) => ({ anomaly, model })))
    .sort(
      (left, right) =>
        right.anomaly.createdAtTick - left.anomaly.createdAtTick ||
        left.anomaly.anomalyId.localeCompare(right.anomaly.anomalyId),
    );
  const requested =
    activeAnomalyId === undefined
      ? undefined
      : records.find(({ anomaly }) => anomaly.anomalyId === activeAnomalyId);
  if (requested !== undefined) return requested;

  return records.find(({ anomaly }) => {
    if (acknowledgedKeys.has(anomalyPresentationKey(anomaly))) return false;
    if (anomaly.status === "unresolved") return true;
    if (anomalyDetectionPending && anomaly.status === "confirmed") return true;
    return (
      investigationCompletionPending &&
      (anomaly.status === "confirmed" ||
        anomaly.status === "inconclusive" ||
        anomaly.status === "resolved")
    );
  });
}
