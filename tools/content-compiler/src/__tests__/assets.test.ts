import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AssetManifestFile } from "@neolab/content-schema";

import { compileAssetCatalogue } from "../assets.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function fixture(): {
  readonly root: string;
  readonly manifestPath: string;
  readonly sourcePath: string;
  readonly source: string;
  readonly manifest: AssetManifestFile;
} {
  const root = mkdtempSync(join(tmpdir(), "neolab-assets-"));
  roots.push(root);
  const sourcePath = "design/production/researchers/example.svg";
  const absolutePath = join(root, sourcePath);
  mkdirSync(join(root, "design", "production", "researchers"), { recursive: true });
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>';
  writeFileSync(absolutePath, source);
  return {
    root,
    manifestPath: join(root, "design", "assets", "manifest.yaml"),
    sourcePath,
    source,
    manifest: {
      schemaVersion: 1,
      status: "draft",
      assets: [
        {
          id: "portrait.researcher.example",
          kind: "portrait",
          sourcePath,
          pixelDimensions: { width: 32, height: 32 },
          scalePolicy: "integer-pixel",
          accessibility: {
            decorative: false,
            altText: "Pixel portrait of Example Researcher",
          },
          rights: {
            copyrightHolder: "Neolab.ai contributors",
            licence: "LicenseRef-Neolab-Proprietary",
            sourceNotes: ["Synthetic compiler fixture."],
          },
          portrait: {
            subjectId: "researcher.example",
            fictionalisationStatus: "fictionalized-real-person",
          },
        },
      ],
    },
  };
}

describe("asset compiler", () => {
  it("canonicalises IDs, verifies files, derives media type, and hashes source bytes", () => {
    const input = fixture();
    expect(compileAssetCatalogue(input.root, input.manifest, input.manifestPath)).toEqual(
      {
        status: "draft",
        definitions: {
          "base:portrait.researcher.example": {
            id: "base:portrait.researcher.example",
            kind: "portrait",
            sourcePath: input.sourcePath,
            sourceSha256: createHash("sha256").update(input.source).digest("hex"),
            mediaType: "image/svg+xml",
            pixelDimensions: { width: 32, height: 32 },
            scalePolicy: "integer-pixel",
            accessibility: {
              decorative: false,
              altText: "Pixel portrait of Example Researcher",
            },
            rights: {
              copyrightHolder: "Neolab.ai contributors",
              licence: "LicenseRef-Neolab-Proprietary",
              sourceNotes: ["Synthetic compiler fixture."],
            },
            portrait: {
              subjectId: "base:researcher.example",
              fictionalisationStatus: "fictionalized-real-person",
            },
          },
        },
        orderedIds: ["base:portrait.researcher.example"],
      },
    );
  });

  it("rejects paths outside production, traversal, missing files, unsupported formats, and duplicate IDs", () => {
    const input = fixture();
    const definition = input.manifest.assets[0];
    if (definition === undefined) throw new Error("asset fixture missing");
    expect(() =>
      compileAssetCatalogue(
        input.root,
        {
          ...input.manifest,
          assets: [{ ...definition, sourcePath: "design/art-direction/concept.png" }],
        },
        input.manifestPath,
      ),
    ).toThrow(/under design\/production/);
    expect(() =>
      compileAssetCatalogue(
        input.root,
        {
          ...input.manifest,
          assets: [{ ...definition, sourcePath: "../secret.png" }],
        },
        input.manifestPath,
      ),
    ).toThrow(/canonical repository-relative POSIX path|escapes the repository/);
    expect(() =>
      compileAssetCatalogue(
        input.root,
        {
          ...input.manifest,
          assets: [{ ...definition, sourcePath: "design/production/missing.png" }],
        },
        input.manifestPath,
      ),
    ).toThrow(/does not exist/);

    const unsupportedPath = "design/production/researchers/example.txt";
    writeFileSync(join(input.root, unsupportedPath), "not an image");
    expect(() =>
      compileAssetCatalogue(
        input.root,
        {
          ...input.manifest,
          assets: [{ ...definition, sourcePath: unsupportedPath }],
        },
        input.manifestPath,
      ),
    ).toThrow(/unsupported asset extension/);
    expect(() =>
      compileAssetCatalogue(
        input.root,
        { ...input.manifest, assets: [definition, definition] },
        input.manifestPath,
      ),
    ).toThrow(/duplicate asset ID/);
  });
});
