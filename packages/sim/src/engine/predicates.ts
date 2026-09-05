import type { EventMetricKey, EventPredicateDefinition } from "@neolab/content-schema";

import type { GameState } from "../model/state.ts";
import { calculateInterventionPressure } from "../politics/politics.ts";

/**
 * Content prerequisites as a closed AST (TDD section 11.3). Authored data can
 * only reference registered metrics — never arbitrary state paths.
 */

export type ComparisonOp = "lt" | "lte" | "gt" | "gte" | "eq";
export type Predicate = EventPredicateDefinition;
export type MetricKey = EventMetricKey;

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

const RECENT_INCIDENT_WEEKS = 13;

function recentPlayerIncidents(state: GameState) {
  return state.incidents.filter(
    (incident) =>
      state.models[incident.modelId]?.ownerLabId === state.run.playerLabId &&
      state.run.tick - incident.occurredAt <= RECENT_INCIDENT_WEEKS,
  );
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
  "player.safety.practicalControl": {
    playerVisible: true,
    read: (state) => playerLab(state).safety.practicalControlStrength,
  },
  "player.safety.securityPosture": {
    playerVisible: true,
    read: (state) => playerLab(state).safety.securityPosture,
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
  "player.politics.strategicDependence": {
    playerVisible: true,
    read: (state) => playerLab(state).politics.strategicDependence,
  },
  "player.politics.captureConcern": {
    playerVisible: true,
    read: (state) => playerLab(state).politics.captureConcern,
  },
  "player.politics.interventionPressure": {
    playerVisible: true,
    read: (state) => calculateInterventionPressure(state, state.run.playerLabId).final,
  },
  "player.gpus.total": {
    playerVisible: true,
    read: (state) =>
      playerLab(state).compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0),
  },
  // Incidents the player has already been told about, within the last quarter.
  // Reading the incident log is player-visible: incidents are the sanctioned
  // reveal channel, unlike hidden model truth.
  "player.incidents.recentCount": {
    playerVisible: true,
    read: (state) => recentPlayerIncidents(state).length,
  },
  "player.incidents.recentWorstSeverity": {
    playerVisible: true,
    read: (state) =>
      recentPlayerIncidents(state).reduce(
        (worst, incident) => Math.max(worst, incident.observedSeverity),
        0,
      ),
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
    case "always":
      return true;
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
