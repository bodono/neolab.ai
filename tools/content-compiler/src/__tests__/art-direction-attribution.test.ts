import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateCompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../packages/content/generated/content.bundle.json";
import { parseYamlFile } from "../yaml-io.ts";

interface ArtDirectionManifest {
  readonly assets?: readonly {
    readonly portraitSubjects?: readonly {
      readonly character?: string;
      readonly inspiration?: string;
    }[];
  }[];
}

describe("art-direction portrait attribution", () => {
  it("uses the current fictional display name for every cited inspiration", () => {
    const content = validateCompiledContent(rawBundle);
    const displayNameByInspiration = new Map<string, string>([
      ...Object.values(content.leaders).map(
        (leader) => [leader.inspirationName, leader.displayName] as const,
      ),
      ...Object.values(content.researchers.definitions).map(
        (researcher) => [researcher.inspirationName, researcher.displayName] as const,
      ),
    ]);
    const manifest = parseYamlFile(
      join(process.cwd(), "design", "art-direction", "manifest.yaml"),
    ) as ArtDirectionManifest;
    const portraitSubjects =
      manifest.assets?.flatMap((asset) => asset.portraitSubjects ?? []) ?? [];

    expect(portraitSubjects.length).toBeGreaterThan(0);
    for (const subject of portraitSubjects) {
      expect(subject.inspiration).toBeTypeOf("string");
      expect(subject.character).toBeTypeOf("string");
      const expectedCharacter = displayNameByInspiration.get(subject.inspiration ?? "");
      expect(
        expectedCharacter,
        `Unknown portrait inspiration: ${subject.inspiration ?? "<missing>"}`,
      ).toBeDefined();
      expect(subject.character).toBe(expectedCharacter);
    }
  });
});
