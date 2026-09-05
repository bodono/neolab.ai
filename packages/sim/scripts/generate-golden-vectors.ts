/**
 * One-off generator for the RandomOracleV1 golden vectors (TDD section 10.2).
 *
 * Run from packages/sim:  node scripts/generate-golden-vectors.ts
 *
 * The committed fixture freezes the V1 contract: any refactor that changes a
 * single value is a breaking change and must become a V2 oracle instead.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { randomKey } from "../src/random/key.ts";
import { RandomOracleV1 } from "../src/random/oracle.ts";
import { seed128 } from "../src/random/seed.ts";

const SEEDS = [
  "00000000000000000000000000000000",
  "0123456789abcdef0123456789abcdef",
  "ffffffffffffffffffffffffffffffff",
  "8badf00d8badf00d8badf00d8badf00d",
  "1cedc0ffee1cedc0ffee1cedc0ffee1c",
];

interface Vector {
  readonly seed: string;
  readonly key: readonly string[];
  readonly method: string;
  readonly args: readonly unknown[];
  readonly value: unknown;
}

const vectors: Vector[] = [];

for (const seedHex of SEEDS) {
  const oracle = new RandomOracleV1(seed128(seedHex));

  for (let i = 0; i < 12; i += 1) {
    const key = ["golden", "uniform", String(i)];
    vectors.push({
      seed: seedHex,
      key,
      method: "uniform",
      args: [],
      value: oracle.uniform(randomKey(...key)),
    });
  }
  for (let i = 0; i < 4; i += 1) {
    const key = ["golden", "integer", String(i)];
    vectors.push({
      seed: seedHex,
      key,
      method: "integer",
      args: [0, 99],
      value: oracle.integer(randomKey(...key), 0, 99),
    });
  }
  for (let i = 0; i < 4; i += 1) {
    const key = ["golden", "triangular", String(i)];
    vectors.push({
      seed: seedHex,
      key,
      method: "triangular",
      args: [0.9, 1, 1.1],
      value: oracle.triangular(randomKey(...key), 0.9, 1, 1.1),
    });
  }
  for (let i = 0; i < 2; i += 1) {
    const key = ["golden", "weighted", String(i)];
    vectors.push({
      seed: seedHex,
      key,
      method: "weighted",
      args: [{ alpha: 1, beta: 2, gamma: 3, delta: 0 }],
      value: oracle.weighted(randomKey(...key), {
        alpha: 1,
        beta: 2,
        gamma: 3,
        delta: 0,
      }),
    });
  }
  {
    const key = ["golden", "shuffle"];
    vectors.push({
      seed: seedHex,
      key,
      method: "shuffle",
      args: [["a", "b", "c", "d", "e", "f", "g", "h"]],
      value: oracle.shuffle(randomKey(...key), ["a", "b", "c", "d", "e", "f", "g", "h"]),
    });
  }
}

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "random",
  "__fixtures__",
  "golden-vectors.json",
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ contractVersion: 1, vectors }, null, 2)}\n`);
console.log(`wrote ${String(vectors.length)} vectors -> ${outPath}`);
