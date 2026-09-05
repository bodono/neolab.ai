import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type {
  GameState,
  RivalPublicSignalKind,
  RivalPublicSignalState,
} from "../model/state.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import { AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY } from "../models/capability.ts";

export interface RecordRivalPublicSignalInput {
  readonly labId: LabId;
  readonly kind: RivalPublicSignalKind;
  readonly subjectId: string;
  readonly actualValue: number;
  readonly baseErrorRadius: number;
  readonly summary: string;
}

export interface RivalPublicSignalView {
  readonly id: string;
  readonly labId: LabId;
  readonly kind: RivalPublicSignalKind;
  readonly occurredAt: number;
  readonly subjectId: string;
  readonly estimate: number;
  readonly estimateRange: readonly [number, number];
  readonly confidence: "low" | "medium" | "high";
  readonly summary: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function recordRivalPublicSignal(
  tx: SimulationTransaction,
  input: RecordRivalPublicSignalInput,
): RivalPublicSignalState {
  if (tx.read().world.rivals[input.labId] === undefined) {
    throw new Error(`Cannot record a public signal for non-rival ${input.labId}`);
  }
  if (!Number.isFinite(input.actualValue) || input.baseErrorRadius < 0) {
    throw new RangeError("Rival public signal values must be finite and non-negative");
  }
  const id = [
    "rival-signal",
    input.labId,
    input.kind,
    input.subjectId,
    String(tx.read().run.tick),
  ].join(":");
  const existing = tx.read().world.rivalSignals.find((signal) => signal.id === id);
  if (existing !== undefined) return existing;
  const oracle = new RandomOracleV1(tx.read().run.seed);
  const signal: RivalPublicSignalState = {
    id,
    labId: input.labId,
    kind: input.kind,
    occurredAt: tx.read().run.tick,
    subjectId: input.subjectId,
    actualValue: input.actualValue,
    noiseUnit:
      oracle.uniform(
        randomKey(
          "rival-signal",
          input.labId,
          input.kind,
          input.subjectId,
          String(tx.read().run.tick),
        ),
      ) *
        2 -
      1,
    baseErrorRadius: input.baseErrorRadius,
    summary: input.summary,
  };
  tx.update((draft) => {
    draft.world.rivalSignals.push(structuredClone(signal));
  });
  tx.emit({
    kind: "rival-public-signal",
    labId: input.labId,
    signalId: id,
    signalKind: input.kind,
    subjectId: input.subjectId,
    summary: input.summary,
  });
  return signal;
}

/** Player-safe projection: canonical truth and the keyed noise draw never cross it. */
export function projectRivalPublicSignals(
  state: Readonly<GameState>,
  intelligenceRatings: Readonly<Record<string, number>>,
): readonly RivalPublicSignalView[] {
  return state.world.rivalSignals.map((signal) => {
    const intelligence = clamp(intelligenceRatings[signal.labId] ?? 25, 0, 100);
    const errorRadius = signal.baseErrorRadius * (1 - intelligence * 0.008);
    const estimate = signal.actualValue + signal.noiseUnit * errorRadius;
    const maximumValue = signal.kind === "autonomy" ? 5 : 100;
    // A credible candidate report is stronger evidence than a noisy benchmark:
    // its displayed range must remain compatible with the candidacy threshold.
    const minimumValue =
      signal.kind === "candidate" ? AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY : 0;
    return {
      id: signal.id,
      labId: signal.labId,
      kind: signal.kind,
      occurredAt: signal.occurredAt,
      subjectId: signal.subjectId,
      estimate: round(clamp(estimate, minimumValue, maximumValue)),
      estimateRange: [
        round(clamp(estimate - errorRadius, minimumValue, maximumValue)),
        round(clamp(estimate + errorRadius, minimumValue, maximumValue)),
      ],
      confidence: intelligence >= 75 ? "high" : intelligence >= 45 ? "medium" : "low",
      summary: signal.summary,
    };
  });
}
