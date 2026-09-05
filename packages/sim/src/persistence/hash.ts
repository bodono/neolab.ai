import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { GameState } from "../model/state.ts";

/**
 * Key-order-independent JSON serialisation. Two states that are deep-equal
 * always produce identical bytes, so hashes are comparable across replays.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, sortKeys(child)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

const encoder = new TextEncoder();

export function hashJson(value: unknown): string {
  return bytesToHex(sha256(encoder.encode(stableStringify(value))));
}

/** Deterministic state hash for replay comparison (TDD section 24.6). */
export function stateHash(state: GameState): string {
  return hashJson(state);
}
