import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

import {
  contentId,
  isContentId,
  type AssetCatalogueDefinition,
  type AssetDefinition,
  type AssetManifestFile,
  type ContentId,
} from "@neolab/content-schema";

import { ContentFileError } from "./yaml-io.ts";

const MEDIA_TYPES = {
  ".gif": "image/gif",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
} as const;

function canonicalAssetReference(draft: string, filePath: string): ContentId {
  if (draft.includes(":")) {
    if (!isContentId(draft)) {
      throw new ContentFileError(
        filePath,
        undefined,
        undefined,
        `invalid asset ID "${draft}"`,
      );
    }
    return contentId(draft);
  }
  if (draft.includes(".")) return contentId(`base:${draft}`);
  throw new ContentFileError(
    filePath,
    undefined,
    undefined,
    `cannot canonicalise asset reference "${draft}"`,
  );
}

function validateSourcePath(
  repoRoot: string,
  sourcePath: string,
  manifestPath: string,
): string {
  const segments = sourcePath.split("/");
  if (
    !sourcePath.startsWith("design/production/") ||
    isAbsolute(sourcePath) ||
    sourcePath.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new ContentFileError(
      manifestPath,
      undefined,
      undefined,
      `asset sourcePath must be a canonical repository-relative POSIX path under design/production/: ${sourcePath}`,
    );
  }
  const absolutePath = resolve(repoRoot, sourcePath);
  const repoRelative = relative(repoRoot, absolutePath).replaceAll("\\", "/");
  if (repoRelative !== sourcePath || repoRelative.startsWith("../")) {
    throw new ContentFileError(
      manifestPath,
      undefined,
      undefined,
      `asset sourcePath escapes the repository: ${sourcePath}`,
    );
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new ContentFileError(
      manifestPath,
      undefined,
      undefined,
      `asset source file does not exist: ${sourcePath}`,
    );
  }
  return absolutePath;
}

function mediaType(
  sourcePath: string,
  manifestPath: string,
): AssetDefinition["mediaType"] {
  const extension = extname(sourcePath).toLowerCase() as keyof typeof MEDIA_TYPES;
  const value = MEDIA_TYPES[extension];
  if (value === undefined) {
    throw new ContentFileError(
      manifestPath,
      undefined,
      undefined,
      `unsupported asset extension for ${sourcePath}; expected PNG, WebP, SVG, or GIF`,
    );
  }
  return value;
}

/** Compile and validate the TDD §22.3 asset manifest without resolving browser URLs. */
export function compileAssetCatalogue(
  repoRoot: string,
  manifest: AssetManifestFile,
  manifestPath: string,
): AssetCatalogueDefinition {
  const definitions: Record<string, AssetDefinition> = {};
  for (const authored of manifest.assets) {
    const id = canonicalAssetReference(authored.id, manifestPath);
    if (definitions[id] !== undefined) {
      throw new ContentFileError(
        manifestPath,
        undefined,
        undefined,
        `duplicate asset ID ${id}`,
      );
    }
    const absolutePath = validateSourcePath(repoRoot, authored.sourcePath, manifestPath);
    definitions[id] = {
      id,
      kind: authored.kind,
      sourcePath: authored.sourcePath,
      sourceSha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      mediaType: mediaType(authored.sourcePath, manifestPath),
      pixelDimensions: authored.pixelDimensions,
      scalePolicy: authored.scalePolicy,
      accessibility: authored.accessibility,
      rights: {
        copyrightHolder: authored.rights.copyrightHolder,
        licence: authored.rights.licence,
        sourceNotes: authored.rights.sourceNotes,
        ...(authored.rights.sourceUrl === undefined
          ? {}
          : { sourceUrl: authored.rights.sourceUrl }),
      },
      ...(authored.portrait === undefined
        ? {}
        : {
            portrait: {
              subjectId: canonicalAssetReference(
                authored.portrait.subjectId,
                manifestPath,
              ),
              fictionalisationStatus: authored.portrait.fictionalisationStatus,
            },
          }),
    };
  }
  return {
    status: manifest.status,
    definitions,
    orderedIds: Object.keys(definitions)
      .sort()
      .map((id) => contentId(id)),
  };
}
