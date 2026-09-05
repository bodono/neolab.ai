import { describe, expect, it } from "vitest";

import { assetManifestFileSchema } from "../assets.ts";

const portrait = {
  id: "portrait.researcher.example",
  kind: "portrait",
  sourcePath: "design/production/researchers/example.png",
  pixelDimensions: { width: 32, height: 32 },
  scalePolicy: "integer-pixel",
  accessibility: {
    decorative: false,
    altText: "Pixel portrait of Example Researcher",
  },
  rights: {
    copyrightHolder: "Neolab.ai contributors",
    licence: "LicenseRef-Neolab-Proprietary",
    sourceNotes: ["Generated in-house without third-party samples."],
  },
  portrait: {
    subjectId: "researcher.example",
    fictionalisationStatus: "fictionalized-real-person",
  },
} as const;

describe("asset manifest schema", () => {
  it("accepts a fully sourced, accessible fictionalized portrait", () => {
    expect(
      assetManifestFileSchema.parse({
        schemaVersion: 1,
        status: "draft",
        assets: [portrait],
      }),
    ).toEqual({
      schemaVersion: 1,
      status: "draft",
      assets: [portrait],
    });
  });

  it("requires portrait metadata only on portrait assets", () => {
    expect(
      assetManifestFileSchema.safeParse({
        schemaVersion: 1,
        status: "draft",
        assets: [{ ...portrait, portrait: undefined }],
      }).success,
    ).toBe(false);
    expect(
      assetManifestFileSchema.safeParse({
        schemaVersion: 1,
        status: "draft",
        assets: [{ ...portrait, kind: "icon" }],
      }).success,
    ).toBe(false);
  });

  it("requires either meaningful alt text or an exact decorative declaration", () => {
    expect(
      assetManifestFileSchema.safeParse({
        schemaVersion: 1,
        status: "draft",
        assets: [
          {
            ...portrait,
            accessibility: { decorative: false, altText: "" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      assetManifestFileSchema.safeParse({
        schemaVersion: 1,
        status: "draft",
        assets: [
          {
            ...portrait,
            accessibility: { decorative: true, altText: "Conflicting copy" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
