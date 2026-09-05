import type { Brand } from "@neolab/content-schema";

/**
 * 128-bit master run seed, canonicalised as exactly 32 lower-case
 * hexadecimal characters (TDD section 10.2 step 1).
 */
export type Seed128 = Brand<string, "Seed128">;

const SEED_PATTERN = /^[0-9a-f]{32}$/;

export function seed128(value: string): Seed128 {
  const normalised = (
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value
  ).toLowerCase();
  if (!SEED_PATTERN.test(normalised)) {
    throw new RangeError(
      `Seed128 must be 32 hexadecimal characters, got "${value}" ` +
        `(${String(normalised.length)} after normalisation).`,
    );
  }
  return normalised as Seed128;
}
