import type { GameState, ModifierState } from "../model/state.ts";
import { isModifierTarget } from "./modifier-targets.ts";

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
  readonly clampMin?: number;
  readonly clampMax?: number;
}

/**
 * Resolve every active modifier for a target in the canonical order:
 * min/max constraints, then additive changes, then multiplicative changes,
 * then final clamps (TDD section 11.2). Within an operation class,
 * modifiers apply in stable modifier-ID order.
 */
export function resolveModifierValue(
  state: GameState,
  target: string,
  base: number,
  options: ResolveOptions = {},
): ModifierBreakdown {
  if (!isModifierTarget(target)) {
    throw new Error(`resolveModifierValue: unknown target "${target}"`);
  }
  const now = state.run.tick;
  const active = Object.values(state.modifiers)
    .filter(
      (modifier) =>
        modifier.target === target &&
        modifier.startsAt <= now &&
        (modifier.endsAt === undefined || now < modifier.endsAt),
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
