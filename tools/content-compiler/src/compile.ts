import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  authoringManifestSchema,
  type AuthoringManifest,
  type CompiledBundle,
} from "@neolab/content-schema";

import { ContentFileError, parseYamlFile } from "./yaml-io.ts";

export interface CompileResult {
  readonly bundle: CompiledBundle;
  readonly outputPath: string;
}

/**
 * Recursively sort object keys so the emitted bundle is byte-reproducible
 * regardless of authoring order (TDD section 12.3 step 12).
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, canonicalise(child)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function compileContent(repoRoot: string): CompileResult {
  const manifestPath = join(repoRoot, "content", "manifest.yaml");
  const raw = parseYamlFile(manifestPath);

  const parsed = authoringManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined ? "" : issue.path.join(".");
    const message = issue === undefined ? "invalid manifest" : issue.message;
    throw new ContentFileError(
      manifestPath,
      undefined,
      undefined,
      `schema violation at "${path}": ${message}`,
    );
  }
  const manifest: AuthoringManifest = parsed.data;

  const hashable = canonicalise({
    bundleFormat: 1,
    contentVersion: manifest.contentVersion,
    authoringManifest: manifest,
  });
  const bundleHash = createHash("sha256").update(JSON.stringify(hashable)).digest("hex");

  const bundle: CompiledBundle = {
    bundleFormat: 1,
    manifest: {
      contentVersion: manifest.contentVersion,
      bundleHash,
    },
    authoringManifest: manifest,
  };

  const outputPath = join(
    repoRoot,
    "packages",
    "content",
    "generated",
    "content.bundle.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(canonicalise(bundle), null, 2)}\n`);

  return { bundle, outputPath };
}
