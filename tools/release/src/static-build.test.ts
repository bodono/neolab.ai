import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectStaticBuild,
  normaliseBasePath,
  verifyStaticBuild,
} from "./static-build.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fixture(basePath: string): {
  readonly directory: string;
  readonly contentPath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "neolab-static-build-"));
  temporaryDirectories.push(directory);
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, ".nojekyll"), "");
  writeFileSync(
    join(directory, "index.html"),
    `<script src="${basePath}assets/index-abcdefgh.js"></script>`,
  );
  writeFileSync(join(directory, "assets/index-abcdefgh.js"), "console.log('ok')");
  const contentPath = join(directory, "content.json");
  writeFileSync(
    contentPath,
    JSON.stringify({
      manifest: { contentVersion: "test", bundleHash: "a".repeat(64) },
    }),
  );
  return { directory, contentPath };
}

describe("static release build contract", () => {
  it("normalises root, project-site and relative base paths", () => {
    expect(normaliseBasePath("/")).toBe("/");
    expect(normaliseBasePath("/neolab.ai")).toBe("/neolab.ai/");
    expect(normaliseBasePath("./")).toBe("./");
    expect(() => normaliseBasePath("neolab.ai/")).toThrow("must start");
    expect(() => normaliseBasePath("/neolab.ai//")).toThrow("not canonical");
  });

  it("writes and verifies a hashed project-site release manifest", () => {
    const { directory, contentPath } = fixture("/neolab.ai/");
    const manifest = inspectStaticBuild({
      distDirectory: directory,
      basePath: "/neolab.ai/",
      contentBundlePath: contentPath,
      sourceCommit: "0123456789abcdef",
      writeManifest: true,
    });
    expect(manifest.basePath).toBe("/neolab.ai/");
    expect(manifest.budgets.compressedFirstLoad.files).toEqual([
      "assets/index-abcdefgh.js",
      "index.html",
    ]);
    expect(verifyStaticBuild(directory, "/neolab.ai/").sourceCommit).toBe(
      "0123456789abcdef",
    );
  });

  it("rejects an absolute-path leak and an unhashed asset", () => {
    const absoluteLeak = fixture("/");
    expect(() =>
      inspectStaticBuild({
        distDirectory: absoluteLeak.directory,
        basePath: "/neolab.ai/",
        contentBundlePath: absoluteLeak.contentPath,
        sourceCommit: "test",
        writeManifest: false,
      }),
    ).toThrow("does not use configured base path");

    const unhashed = fixture("/neolab.ai/");
    writeFileSync(join(unhashed.directory, "assets/unhashed.js"), "bad");
    expect(() =>
      inspectStaticBuild({
        distDirectory: unhashed.directory,
        basePath: "/neolab.ai/",
        contentBundlePath: unhashed.contentPath,
        sourceCommit: "test",
        writeManifest: false,
      }),
    ).toThrow("not content-hashed");
  });

  it("detects any byte changed after archival", () => {
    const { directory, contentPath } = fixture("./");
    inspectStaticBuild({
      distDirectory: directory,
      basePath: "./",
      contentBundlePath: contentPath,
      sourceCommit: "release",
      writeManifest: true,
    });
    writeFileSync(join(directory, "assets/index-abcdefgh.js"), "tampered");
    expect(() => verifyStaticBuild(directory)).toThrow("does not match");
  });
});
