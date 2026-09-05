import { describe, expect, it } from "vitest";

import {
  loadBrowserCompiledContent,
  type AssetDefinition,
  type CompiledContent,
} from "@neolab/content/browser";

import { assetModuleKey, resolveAsset } from "../asset-registry.ts";

const compiled = loadBrowserCompiledContent();

function contentWithAsset(definition: AssetDefinition): CompiledContent {
  return {
    ...compiled,
    assets: {
      status: "draft",
      definitions: { [definition.id]: definition },
      orderedIds: [definition.id],
    },
  };
}

describe("browser asset registry", () => {
  it("resolves stable IDs to Vite-managed URLs without exposing paths upstream", () => {
    const definition: AssetDefinition = {
      id: "base:portrait.researcher.test" as AssetDefinition["id"],
      kind: "portrait",
      sourcePath: "design/production/researchers/test.png",
      sourceSha256: "a".repeat(64),
      mediaType: "image/png",
      pixelDimensions: { width: 32, height: 32 },
      scalePolicy: "integer-pixel",
      accessibility: { decorative: false, altText: "Test researcher portrait" },
      rights: {
        copyrightHolder: "Neolab.ai contributors",
        licence: "LicenseRef-Neolab-Proprietary",
        sourceNotes: ["Synthetic unit-test definition."],
      },
      portrait: {
        subjectId: "base:researcher.test" as AssetDefinition["id"],
        fictionalisationStatus: "fictional-person",
      },
    };
    const content = contentWithAsset(definition);
    const key = assetModuleKey(definition.sourcePath);

    expect(
      resolveAsset(content, definition.id, { [key]: "/assets/test-a1b2.png" }),
    ).toEqual({
      definition,
      url: "/assets/test-a1b2.png",
    });
  });

  it("returns an explicit fallback for unknown IDs or source files absent from a draft", () => {
    expect(resolveAsset(compiled, "base:portrait.researcher.missing", {})).toBe(
      undefined,
    );
    const definition: AssetDefinition = {
      id: "base:ui.test" as AssetDefinition["id"],
      kind: "ui",
      sourcePath: "design/production/ui/test.svg",
      sourceSha256: "b".repeat(64),
      mediaType: "image/svg+xml",
      pixelDimensions: { width: 16, height: 16 },
      scalePolicy: "contain",
      accessibility: { decorative: true },
      rights: {
        copyrightHolder: "Neolab.ai contributors",
        licence: "LicenseRef-Neolab-Proprietary",
        sourceNotes: ["Synthetic unit-test definition."],
      },
    };
    expect(resolveAsset(contentWithAsset(definition), definition.id, {})).toBe(undefined);
  });
});
