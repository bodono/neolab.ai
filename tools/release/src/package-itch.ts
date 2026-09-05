import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { inspectStaticBuild, type ReleaseManifestV1 } from "./static-build.ts";

export const ITCH_HTML_LIMITS = Object.freeze({
  files: 1_000,
  pathCharacters: 240,
  extractedBytes: 500 * 1024 * 1024,
  singleFileBytes: 200 * 1024 * 1024,
});

const REPOSITORY_ROOT = resolve(dirname(import.meta.filename), "../../..");
const FIXED_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");

export interface ItchPackageReport {
  readonly formatVersion: 1;
  readonly sourceCommit: string;
  readonly contentHash: string;
  readonly zipFile: string;
  readonly zipBytes: number;
  readonly zipSha256: string;
  readonly extractedBytes: number;
  readonly fileCount: number;
  readonly longestPathCharacters: number;
  readonly largestFileBytes: number;
  readonly limits: typeof ITCH_HTML_LIMITS;
}

function fromRepositoryRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(REPOSITORY_ROOT, path);
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertWithin(label: string, actual: number, limit: number): void {
  if (actual > limit) {
    throw new Error(`${label} is ${String(actual)}; itch.io limit is ${String(limit)}`);
  }
}

export function validateItchFileSet(
  distDirectory: string,
  manifest: ReleaseManifestV1,
): {
  readonly paths: readonly string[];
  readonly extractedBytes: number;
  readonly longestPathCharacters: number;
  readonly largestFileBytes: number;
} {
  const paths = [
    ...manifest.files.map((file) => file.path),
    "release-manifest.json",
  ].sort();
  if (!paths.includes("index.html"))
    throw new Error("itch.io ZIP needs index.html at root");
  if (manifest.basePath !== "./") {
    throw new Error(
      `itch.io build must use relative base "./", got ${manifest.basePath}`,
    );
  }
  const records = paths.map((path) => {
    if (path.startsWith("/") || path.includes("../")) {
      throw new Error(`itch.io ZIP contains unsafe path: ${path}`);
    }
    const absolute = join(distDirectory, path);
    if (!existsSync(absolute)) throw new Error(`itch.io ZIP file is missing: ${path}`);
    return { path, bytes: statSync(absolute).size };
  });
  const extractedBytes = records.reduce((sum, record) => sum + record.bytes, 0);
  const longestPathCharacters = Math.max(...records.map((record) => record.path.length));
  const largestFileBytes = Math.max(...records.map((record) => record.bytes));
  assertWithin("File count", records.length, ITCH_HTML_LIMITS.files);
  assertWithin("Longest path", longestPathCharacters, ITCH_HTML_LIMITS.pathCharacters);
  assertWithin("Extracted build", extractedBytes, ITCH_HTML_LIMITS.extractedBytes);
  assertWithin("Largest file", largestFileBytes, ITCH_HTML_LIMITS.singleFileBytes);
  return { paths, extractedBytes, longestPathCharacters, largestFileBytes };
}

export function packageItchBuild(options: {
  readonly distDirectory: string;
  readonly contentBundlePath: string;
  readonly sourceCommit: string;
  readonly outputDirectory: string;
}): ItchPackageReport {
  const distDirectory = resolve(options.distDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  const manifest = inspectStaticBuild({
    distDirectory,
    basePath: "./",
    contentBundlePath: options.contentBundlePath,
    sourceCommit: options.sourceCommit,
    writeManifest: true,
  });
  const validated = validateItchFileSet(distDirectory, manifest);
  mkdirSync(outputDirectory, { recursive: true });
  const zipName = "neolab-ai-itch.zip";
  const zipPath = join(outputDirectory, zipName);
  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  // ZIP stores DOS timestamps. Normalising every emitted file and using -X
  // removes host metadata so repeated packaging on one toolchain is byte-stable.
  for (const path of validated.paths) {
    utimesSync(join(distDirectory, path), FIXED_ZIP_DATE, FIXED_ZIP_DATE);
  }
  const zipped = spawnSync("zip", ["-X", "-q", zipPath, ...validated.paths], {
    cwd: distDirectory,
    encoding: "utf8",
  });
  if (zipped.error !== undefined) throw zipped.error;
  if (zipped.status !== 0) {
    throw new Error(`zip failed (${String(zipped.status)}): ${zipped.stderr}`);
  }
  const zipBytes = readFileSync(zipPath);
  const report: ItchPackageReport = {
    formatVersion: 1,
    sourceCommit: manifest.sourceCommit,
    contentHash: manifest.contentHash,
    zipFile: zipName,
    zipBytes: zipBytes.byteLength,
    zipSha256: sha256(zipBytes),
    extractedBytes: validated.extractedBytes,
    fileCount: validated.paths.length,
    longestPathCharacters: validated.longestPathCharacters,
    largestFileBytes: validated.largestFileBytes,
    limits: ITCH_HTML_LIMITS,
  };
  writeFileSync(
    join(outputDirectory, "itch-package.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const distDirectory = fromRepositoryRoot(valueAfter(args, "--dist") ?? "apps/web/dist");
  const contentBundlePath = fromRepositoryRoot(
    valueAfter(args, "--content") ?? "packages/content/generated/content.bundle.json",
  );
  const outputDirectory = fromRepositoryRoot(
    valueAfter(args, "--output") ?? "artifacts/itch",
  );
  const sourceCommit =
    valueAfter(args, "--source") ??
    process.env["NEOLAB_SOURCE_COMMIT"] ??
    "local-uncommitted";
  const report = packageItchBuild({
    distDirectory,
    contentBundlePath,
    sourceCommit,
    outputDirectory,
  });
  console.log(
    JSON.stringify(
      {
        ...report,
        zipFile: relative(REPOSITORY_ROOT, join(outputDirectory, report.zipFile))
          .split(sep)
          .join("/"),
        zipMiB: Number((report.zipBytes / 1024 / 1024).toFixed(2)),
        extractedMiB: Number((report.extractedBytes / 1024 / 1024).toFixed(2)),
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === resolve(import.meta.filename)) main();
