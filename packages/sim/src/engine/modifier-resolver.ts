import type {
  GameState,
  LabState,
  ModifierActivation,
  ModifierState,
} from "../model/state.ts";
import type { LabId } from "../model/ids.ts";
import { isModifierTarget } from "./modifier-targets.ts";

/**
 * Closed registry of activation metrics used by authored `activation:` blocks
 * (content naming, not the predicate MetricRegistry). Unknown metrics throw:
 * a dormant-forever modifier would be a silent content bug.
 */
const ACTIVATION_METRICS: Readonly<Record<string, (lab: LabState) => number>> = {
  "lab.culture.safety": (lab) => lab.safety.safetyCulture,
};

export function evaluateModifierActivation(
  state: Readonly<GameState>,
  activation: ModifierActivation,
): boolean {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) {
    throw new Error("evaluateModifierActivation: player lab missing");
  }
  switch (activation.type) {
    case "metric-below": {
      const read = ACTIVATION_METRICS[activation.metric];
      if (read === undefined) {
        throw new Error(
          `Unknown activation metric "${activation.metric}" — register it in ACTIVATION_METRICS`,
        );
      }
      return read(lab) < activation.value;
    }
    case "flag-absent":
      return !(activation.flag in lab.flags);
    case "all":
      return activation.items.every((item) => evaluateModifierActivation(state, item));
  }
}

export interface ModifierContribution {
  readonly modifierId: string;
  readonly sourceKind: string;
  readonly sourceId?: string;
  readonly operation: ModifierState["operation"];
  readonly value: number;
}

/** Tooltip-ready breakdown from the same resolver the rules use (TDD 11.2). */
export interface ModifierBreakdown {
  readonly target: string;
  readonly base: number;
  readonly afterConstraints: number;
  readonly afterAdditive: number;
  readonly final: number;
  readonly contributions: readonly ModifierContribution[];
}

export interface ResolveOptions {
  /** Lab receiving the value. Defaults to the player lab for existing callers. */
  readonly labId?: LabId;
  /** Rival projections can exclude legacy player-only unscoped modifiers. */
  readonly includeUnscoped?: boolean;
  readonly clampMin?: number;
  readonly clampMax?: number;
  readonly includeSourceKinds?: readonly ModifierState["source"]["kind"][];
  readonly excludeSourceKinds?: readonly ModifierState["source"]["kind"][];
}

/**
 * Resolve every active modifier for a target in the canonical order:
 * min/max constraints, then additive changes, then multiplicative changes,
 * then final clamps (TDD section 11.2). Within an operation class,
 * modifiers apply in stable modifier-ID order.
 */
export function resolveModifierValue(
  state: Readonly<GameState>,
  target: string,
  base: number,
  options: ResolveOptions = {},
): ModifierBreakdown {
  if (!isModifierTarget(target)) {
    throw new Error(`resolveModifierValue: unknown target "${target}"`);
  }
  const now = state.run.tick;
  const labId = options.labId ?? state.run.playerLabId;
  const includeUnscoped = options.includeUnscoped ?? true;
  const isLabTarget = target.startsWith("lab.");
  const active = Object.values(state.modifiers)
    .filter(
      (modifier) =>
        modifier.target === target &&
        (isLabTarget
          ? modifier.labId === labId
          : (modifier.labId === undefined && includeUnscoped) ||
            modifier.labId === labId) &&
        modifier.startsAt <= now &&
        (modifier.endsAt === undefined || now < modifier.endsAt) &&
        (options.includeSourceKinds === undefined ||
          options.includeSourceKinds.includes(modifier.source.kind)) &&
        (options.excludeSourceKinds === undefined ||
          !options.excludeSourceKinds.includes(modifier.source.kind)) &&
        (modifier.activation === undefined ||
          evaluateModifierActivation(state, modifier.activation)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const contributions: ModifierContribution[] = active.map((modifier) => ({
    modifierId: modifier.id,
    sourceKind: modifier.source.kind,
    ...(modifier.source.id === undefined ? {} : { sourceId: modifier.source.id }),
    operation: modifier.operation,
    value: modifier.value,
  }));

  let value = base;
  for (const modifier of active) {
    if (modifier.operation === "min") {
      value = Math.min(value, modifier.value);
    } else if (modifier.operation === "max") {
      value = Math.max(value, modifier.value);
    }
  }
  const afterConstraints = value;

  for (const modifier of active) {
    if (modifier.operation === "add") {
      value += modifier.value;
    }
  }
  const afterAdditive = value;

  for (const modifier of active) {
    if (modifier.operation === "multiply") {
      value *= modifier.value;
    }
  }

  if (options.clampMin !== undefined) {
    value = Math.max(options.clampMin, value);
  }
  if (options.clampMax !== undefined) {
    value = Math.min(options.clampMax, value);
  }

  return {
    target,
    base,
    afterConstraints,
    afterAdditive,
    final: value,
    contributions,
  };
}

export interface ResearcherStackOptions {
  readonly labId?: LabId;
  readonly includeUnscoped?: boolean;
}

/**
 * Resolve just the researcher-sourced slice of a target. Researcher effects
 * stack in full; player-visible bonuses and penalties are never suppressed by
 * a hidden researcher-only ceiling or floor.
 */
export function resolveResearcherStack(
  state: Readonly<GameState>,
  target: string,
  base = 1,
  options: ResearcherStackOptions = {},
): ModifierBreakdown {
  return resolveModifierValue(state, target, base, {
    ...(options.labId === undefined ? {} : { labId: options.labId }),
    ...(options.includeUnscoped === undefined
      ? {}
      : { includeUnscoped: options.includeUnscoped }),
    includeSourceKinds: ["researcher"],
  });
}
