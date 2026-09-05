import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GRANT_TARGET_LIST,
  MODIFIER_TARGET_LIST,
  STARTING_TARGET_LIST,
} from "@neolab/content-schema";

import {
  CONSUMED_TARGET_LITERALS,
  CONTENT_ROUTED_TARGETS,
  isConsumedTarget,
  isFlavourUnlockTarget,
  isKnownPlaceboTarget,
} from "../consumed-targets.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const simSrc = join(repoRoot, "packages", "sim", "src");
const contentDir = join(repoRoot, "content");

function collectFiles(root: string, extension: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      results.push(...collectFiles(path, extension));
    } else if (entry.name.endsWith(extension)) {
      results.push(path);
    }
  }
  return results;
}

const simSource = collectFiles(simSrc, ".ts")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const contentTargets = new Set<string>();
for (const file of collectFiles(contentDir, ".yaml")) {
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (line.includes("check: {")) continue;
    const match = /target: ([A-Za-z0-9.\-:]+)/.exec(line);
    if (match?.[1] !== undefined) contentTargets.add(match[1]);
  }
}

const STARTING_AND_GRANTS = new Set<string>([
  ...STARTING_TARGET_LIST,
  ...GRANT_TARGET_LIST,
]);

describe("no-placebo target invariant", () => {
  it("finds sim source and authored content", () => {
    expect(simSource.length).toBeGreaterThan(100_000);
    expect(contentTargets.size).toBeGreaterThan(100);
  });

  it("every consumed literal really appears in sim source", () => {
    const missing = CONSUMED_TARGET_LITERALS.filter(
      (target) => !simSource.includes(`"${target}"`),
    );
    expect(missing).toEqual([]);
  });

  it("content-routed targets exist in authored content instead", () => {
    const missing = CONTENT_ROUTED_TARGETS.filter(
      (target) => !contentTargets.has(target),
    );
    expect(missing).toEqual([]);
  });

  it("every registry entry is consumed, starting, granted, or a known placebo", () => {
    const unaccounted = MODIFIER_TARGET_LIST.filter(
      (target) =>
        !isConsumedTarget(target) &&
        !STARTING_AND_GRANTS.has(target) &&
        !isKnownPlaceboTarget(target),
    );
    expect(unaccounted).toEqual([]);
  });

  it("every content-authored target is consumed, starting, granted, or a known placebo", () => {
    const unaccounted = [...contentTargets].filter(
      (target) =>
        !isConsumedTarget(target) &&
        !STARTING_AND_GRANTS.has(target) &&
        !isFlavourUnlockTarget(target) &&
        !isKnownPlaceboTarget(target),
    );
    expect(unaccounted).toEqual([]);
  });

  it("pending lists never shelter a target the sim already consumes", () => {
    const contradictions = [...contentTargets, ...MODIFIER_TARGET_LIST].filter(
      (target) => isConsumedTarget(target) && isKnownPlaceboTarget(target),
    );
    expect(contradictions).toEqual([]);
  });
});
