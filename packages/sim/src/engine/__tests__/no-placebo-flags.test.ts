import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RECORD_ONLY_FLAGS } from "../consumed-targets.ts";

/**
 * The flag half of the no-placebo invariant.
 *
 * `no-placebo-targets.test.ts` holds every modifier target against a manifest,
 * which is why the researcher audit could be made systematic. Nothing did the
 * same for lab flags, and nine dead `funding:*` flags survived in consequence:
 * written by set-flag, stored, rendered as term-sheet copy, read by nothing.
 * See docs/funding-conditions-audit.md §5.1.
 *
 * KNOWN LIMITATION, stated so nobody mistakes this for total coverage. It
 * matches flags written as a bare literal (`flag: "x"`). It cannot see a flag
 * written through a variable, which is precisely how the funding catalogue did
 * it (`flag: condition.flag`). That specific hole is closed structurally
 * instead -- funding conditions may no longer be of kind "flag" at all, which
 * `fundraising.test.ts` asserts. Nor does it see template-built keys
 * (`agi-component:${type}:complete`), which are read the same way they are
 * written and would produce nothing but false positives here.
 *
 * What it does catch is the common case: someone adds a literal flag, means to
 * wire a reader, and never does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

function collectFiles(root: string, extensions: readonly string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      results.push(...collectFiles(path, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      results.push(path);
    }
  }
  return results;
}

const source = [
  ...collectFiles(join(repoRoot, "packages", "sim", "src"), [".ts"]),
  ...collectFiles(join(repoRoot, "apps", "web", "src"), [".ts", ".tsx"]),
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const contentSource = collectFiles(join(repoRoot, "content"), [".yaml"])
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/** Flags written as a bare literal, in sim/web source and in authored content. */
const writtenFlags = new Set<string>([
  ...[...source.matchAll(/flag:\s*"([^"]+)"/g)].map((match) => match[1] ?? ""),
  ...[...contentSource.matchAll(/set-flag[^}]*?flag:\s*"([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  ),
]);

/** Flags read by literal index, `lab.flags["x"]`. */
const readFlags = new Set(
  [...source.matchAll(/\.flags\[\s*"([^"]+)"\s*\]/g)].map((match) => match[1] ?? ""),
);

describe("no-placebo flag invariant", () => {
  it("finds source, content, and flags on both sides", () => {
    expect(source.length).toBeGreaterThan(100_000);
    expect(contentSource.length).toBeGreaterThan(10_000);
    expect(writtenFlags.size).toBeGreaterThan(0);
    expect(readFlags.size).toBeGreaterThan(10);
  });

  it("every literally-written flag is read, or declared deliberately inert", () => {
    // The assertion that would have caught the funding flags had they been
    // written literally: a flag nothing reads is a flag that does nothing,
    // however convincing the copy attached to it.
    const unaccounted = [...writtenFlags]
      .filter((flag) => !readFlags.has(flag))
      .filter((flag) => !RECORD_ONLY_FLAGS.includes(flag))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  it("never shelters a flag that is actually read", () => {
    // The mirror of the target invariant's contradiction check: an entry on the
    // inert list that turns out to have a reader is a stale declaration, and
    // leaving it there would hide a future regression.
    const contradictions = RECORD_ONLY_FLAGS.filter((flag) => readFlags.has(flag));
    expect(contradictions).toEqual([]);
  });

  it("declares nothing that is never written either", () => {
    const orphaned = RECORD_ONLY_FLAGS.filter((flag) => !writtenFlags.has(flag));
    expect(orphaned).toEqual([]);
  });
});
