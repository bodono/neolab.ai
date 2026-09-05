import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileContent } from "../compile.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function invalidFacilityRepo(mutate: (source: string) => string): string {
  const root = mkdtempSync(join(tmpdir(), "neolab-facility-content-"));
  temporaryRoots.push(root);
  cpSync(join(process.cwd(), "content"), join(root, "content"), { recursive: true });
  cpSync(join(process.cwd(), "design", "assets"), join(root, "design", "assets"), {
    recursive: true,
  });
  const facilityPath = join(root, "content", "facilities", "core-stage-2.yaml");
  writeFileSync(facilityPath, mutate(readFileSync(facilityPath, "utf8")));
  return root;
}

describe("facility compiler rejection paths", () => {
  it("rejects a prerequisite cycle with the full cycle path", () => {
    const root = invalidFacilityRepo((source) =>
      source.replace(
        /(- id: facility\.power-and-cooling-1[\s\S]*?prerequisiteFacilityIds:) \[\]/,
        "$1 [facility.data-centre-1]",
      ),
    );
    expect(() => compileContent(root)).toThrow(
      /facility prerequisite cycle: .*power-and-cooling-1.*data-centre-1.*power-and-cooling-1/,
    );
  });
});
