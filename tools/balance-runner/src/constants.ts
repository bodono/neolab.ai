import type { CompiledContent } from "@neolab/content-schema";

export const BALANCE_CONSTANT_KEYS = [
  "economy.startingCash",
  "economy.startingOwnedGpus",
  "economy.fundingClimate",
  "research.baseRpCoefficient",
  "research.teraflopScaleDivisor",
  "facilities.baselineOwnedGpuCapacity",
] as const;

export type BalanceConstantKey = (typeof BALANCE_CONSTANT_KEYS)[number];

export interface BalanceConstantOverride {
  readonly key: BalanceConstantKey;
  readonly value: number;
}

function validateOverride(override: BalanceConstantOverride): void {
  if (!Number.isFinite(override.value)) {
    throw new Error(`${override.key} must be finite`);
  }
  switch (override.key) {
    case "economy.startingCash":
      if (override.value < 0) throw new Error(`${override.key} must be non-negative`);
      return;
    case "economy.startingOwnedGpus":
    case "facilities.baselineOwnedGpuCapacity":
      if (!Number.isInteger(override.value) || override.value <= 0) {
        throw new Error(`${override.key} must be a positive integer`);
      }
      return;
    case "economy.fundingClimate":
      if (override.value < 0 || override.value > 100) {
        throw new Error(`${override.key} must be in [0, 100]`);
      }
      return;
    case "research.baseRpCoefficient":
    case "research.teraflopScaleDivisor":
      if (override.value <= 0) throw new Error(`${override.key} must be positive`);
  }
}

/**
 * Applies allowlisted numerical overrides to an in-memory clone. The source
 * bundle and generated content files are never mutated or rebuilt.
 */
export function applyBalanceConstantOverrides(
  content: CompiledContent,
  overrides: readonly BalanceConstantOverride[],
): CompiledContent {
  const clone = structuredClone(content);
  const mutable = clone as unknown as {
    balance: {
      newGame: {
        cash: number;
        fundingClimate: number;
        gpus: { owned: number };
      };
      facilities: { baselineOwnedGpuCapacity: number };
    };
    research: {
      rules: {
        baseCoefficient: number;
        teraflopScaleDivisor: number;
      };
    };
  };
  const seen = new Set<BalanceConstantKey>();
  for (const override of overrides) {
    validateOverride(override);
    if (seen.has(override.key)) throw new Error(`Duplicate override ${override.key}`);
    seen.add(override.key);
    switch (override.key) {
      case "economy.startingCash":
        mutable.balance.newGame.cash = override.value;
        break;
      case "economy.startingOwnedGpus":
        mutable.balance.newGame.gpus.owned = override.value;
        break;
      case "economy.fundingClimate":
        mutable.balance.newGame.fundingClimate = override.value;
        break;
      case "research.baseRpCoefficient":
        mutable.research.rules.baseCoefficient = override.value;
        break;
      case "research.teraflopScaleDivisor":
        mutable.research.rules.teraflopScaleDivisor = override.value;
        break;
      case "facilities.baselineOwnedGpuCapacity":
        mutable.balance.facilities.baselineOwnedGpuCapacity = override.value;
        break;
    }
  }
  return clone;
}
