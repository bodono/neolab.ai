import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ReleaseManifestV1 } from "./static-build.ts";
import {
  ITCH_HTML_LIMITS,
  packageItchBuild,
  validateItchFileSet,
} from "./package-itch.ts";

function manifest(basePath = "./"): ReleaseManifestV1 {
  return {
    formatVersion: 1,
    sourceCommit: "test",
    basePath,
    contentVersion: "test",
    contentHash: "a".repeat(64),
    cachePolicy: {
      immutable: "assets/* (content-hashed; long-lived where host permits)",
      revalidate: "index.html and release-manifest.json",
      githubPagesLimitation:
        "GitHub Pages does not expose per-file Cache-Control configuration",
    },
    budgets: {
      site: { bytes: 2, limitBytes: 3 },
      largestAsset: { path: "index.html", bytes: 1, limitBytes: 2 },
      compressedFirstLoad: {
        bytes: 1,
        limitBytes: 2,
        files: ["index.html"],
        excludesGestureLoadedAudio: true,
      },
    },
    files: [
      {
        path: "index.html",
        bytes: 1,
        sha256: "a".repeat(64),
        cachePolicy: "revalidate",
        initialLoad: true,
      },
    ],
  };
}

describe("itch.io package contract", () => {
  it("accepts a root index and release manifest under the official limits", () => {
    const directory = `${process.env["TMPDIR"] ?? "/tmp"}/neolab-itch-${String(process.pid)}`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "index.html"), "x");
    writeFileSync(join(directory, "release-manifest.json"), "{}");
    expect(validateItchFileSet(directory, manifest())).toMatchObject({
      paths: ["index.html", "release-manifest.json"],
      largestFileBytes: 2,
    });
  });

  it("rejects project-site paths and exposes the official HTML limits", () => {
    expect(() => validateItchFileSet("/missing", manifest("/neolab.ai/"))).toThrow(
      "relative base",
    );
    expect(ITCH_HTML_LIMITS).toEqual({
      files: 1_000,
      pathCharacters: 240,
      extractedBytes: 500 * 1024 * 1024,
      singleFileBytes: 200 * 1024 * 1024,
    });
  });

  it("replaces the stable alpha ZIP instead of inventing a user-facing version", () => {
    const root = `${process.env["TMPDIR"] ?? "/tmp"}/neolab-itch-package-${String(process.pid)}`;
    const dist = join(root, "dist");
    const output = join(root, "output");
    const content = join(root, "content.json");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, ".nojekyll"), "");
    writeFileSync(join(dist, "index.html"), '<script src="./app.js"></script>');
    writeFileSync(join(dist, "app.js"), "console.log('one')");
    writeFileSync(
      content,
      JSON.stringify({
        manifest: { contentVersion: "test", bundleHash: "a".repeat(64) },
      }),
    );

    const first = packageItchBuild({
      distDirectory: dist,
      contentBundlePath: content,
      sourceCommit: "first",
      outputDirectory: output,
    });
    writeFileSync(join(dist, "app.js"), "console.log('two')");
    const second = packageItchBuild({
      distDirectory: dist,
      contentBundlePath: content,
      sourceCommit: "second",
      outputDirectory: output,
    });

    expect(first.zipFile).toBe("neolab-ai-itch.zip");
    expect(second.zipFile).toBe("neolab-ai-itch.zip");
    expect(second.sourceCommit).toBe("second");
    expect(readFileSync(join(output, second.zipFile))).toHaveLength(second.zipBytes);
  });
});
