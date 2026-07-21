import type { GameState } from "../model/state.ts";

/**
 * Content prerequisites as a closed AST (TDD section 11.3). Authored data can
 * only reference registered metrics — never arbitrary state paths.
 */

export type ComparisonOp = "lt" | "lte" | "gt" | "gte" | "eq";

export type Predicate =
  | { readonly type: "all"; readonly items: readonly Predicate[] }
  | { readonly type: "any"; readonly items: readonly Predicate[] }
  | { readonly type: "not"; readonly item: Predicate }
  | {
      readonly type: "compare";
      readonly metric: MetricKey;
      readonly op: ComparisonOp;
      readonly value: number;
    }
  | { readonly type: "has-flag"; readonly flag: string; readonly value?: boolean };

export type MetricKey =
  | "run.tick"
  | "player.cash"
  | "player.aura.spendable"
  | "player.safety.safetyCulture"
  | "player.safety.evalQuality"
  | "player.organisation.managementCapacity"
  | "player.organisation.boardPatience"
  | "player.politics.governmentTrust"
  | "player.politics.governmentAttention"
  | "player.gpus.total";

interface MetricDefinition {
  /** Whether the metric may appear in player-visible preview copy (TDD 11.3). */
  readonly playerVisible: boolean;
  read(state: GameState): number;
}

function playerLab(state: GameState) {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) {
    throw new Error("Metric evaluation: player lab missing");
  }
  return lab;
}

export const METRIC_REGISTRY: Readonly<Record<MetricKey, MetricDefinition>> = {
  "run.tick": { playerVisible: true, read: (state) => state.run.tick },
  "player.cash": { playerVisible: true, read: (state) => playerLab(state).finance.cash },
  "player.aura.spendable": {
    playerVisible: true,
    read: (state) => playerLab(state).aura.spendable,
  },
  "player.safety.safetyCulture": {
    playerVisible: true,
    read: (state) => playerLab(state).safety.safetyCulture,
  },
  "player.safety.evalQuality": {
    playerVisible: true,
    read: (state) => playerLab(state).safety.evalQuality,
  },
  "player.organisation.managementCapacity": {
    playerVisible: true,
    read: (state) => playerLab(state).organisation.managementCapacity,
  },
  "player.organisation.boardPatience": {
    playerVisible: true,
    read: (state) => playerLab(state).organisation.boardPatience,
  },
  "player.politics.governmentTrust": {
    playerVisible: true,
    read: (state) => playerLab(state).politics.governmentTrust,
  },
  "player.politics.governmentAttention": {
    playerVisible: true,
    read: (state) => playerLab(state).politics.governmentAttention,
  },
  "player.gpus.total": {
    playerVisible: true,
    read: (state) =>
      playerLab(state).compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0),
  },
};

export function readMetric(state: GameState, metric: MetricKey): number {
  const definition: MetricDefinition | undefined = METRIC_REGISTRY[metric];
  if (definition === undefined) {
    throw new Error(`Unknown metric "${String(metric)}"`);
  }
  return definition.read(state);
}

export function evaluatePredicate(state: GameState, predicate: Predicate): boolean {
  switch (predicate.type) {
    case "all":
      return predicate.items.every((item) => evaluatePredicate(state, item));
    case "any":
      return predicate.items.some((item) => evaluatePredicate(state, item));
    case "not":
      return !evaluatePredicate(state, predicate.item);
    case "compare": {
      const actual = readMetric(state, predicate.metric);
      switch (predicate.op) {
        case "lt":
          return actual < predicate.value;
        case "lte":
          return actual <= predicate.value;
        case "gt":
          return actual > predicate.value;
        case "gte":
          return actual >= predicate.value;
        case "eq":
          return actual === predicate.value;
      }
      break;
    }
    case "has-flag": {
      const lab = state.labs[state.run.playerLabId];
      const present = lab !== undefined && predicate.flag in lab.flags;
      return predicate.value === undefined || predicate.value ? present : !present;
    }
  }
  throw new Error("Unreachable predicate branch");
}
