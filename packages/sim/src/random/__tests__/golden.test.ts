import { describe, expect, it } from "vitest";

import golden from "../__fixtures__/golden-vectors.json";
import { randomKey } from "../key.ts";
import { RANDOM_CONTRACT_VERSION, RandomOracleV1 } from "../oracle.ts";
import { seed128 } from "../seed.ts";

/**
 * These vectors FREEZE the V1 randomness contract. If this test fails, do not
 * update the fixture: the behaviour change breaks every existing run and must
 * ship as a RandomOracleV2 instead (TDD section 10.2).
 */
describe("RandomOracleV1 golden vectors", () => {
  it("matches the frozen contract version", () => {
    expect(golden.contractVersion).toBe(RANDOM_CONTRACT_VERSION);
  });

  it("replays all committed vectors exactly", () => {
    expect(golden.vectors.length).toBeGreaterThanOrEqual(100);
    for (const vector of golden.vectors) {
      const oracle = new RandomOracleV1(seed128(vector.seed));
      const key = randomKey(...vector.key);
      switch (vector.method) {
        case "uniform":
          expect(oracle.uniform(key)).toBe(vector.value);
          break;
        case "integer": {
          const [min, max] = vector.args as [number, number];
          expect(oracle.integer(key, min, max)).toBe(vector.value);
          break;
        }
        case "triangular": {
          const [min, mode, max] = vector.args as [number, number, number];
          expect(oracle.triangular(key, min, mode, max)).toBe(vector.value);
          break;
        }
        case "weighted": {
          const [weights] = vector.args as unknown as [Record<string, number>];
          expect(oracle.weighted(key, weights)).toBe(vector.value);
          break;
        }
        case "shuffle": {
          const [values] = vector.args as unknown as [readonly string[]];
          expect(oracle.shuffle(key, values)).toEqual(vector.value);
          break;
        }
        default:
          throw new Error(`Unknown golden method ${String(vector.method)}`);
      }
    }
  });
});
