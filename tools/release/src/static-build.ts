import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

export const STATIC_BUILD_BUDGETS = Object.freeze({
  siteBytes: 900 * 1024 * 1024,
  singleAssetBytes: 20 * 1024 * 1024,
  compressedFirstLoadBytes: 15 * 1024 * 1024,
});

const RELEASE_MANIFEST_FILE = "release-manifest.json";
const REPOSITORY_ROOT = resolve(dirname(import.meta.filename), "../../..");
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export interface StaticFileRecord {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly cachePolicy: "immutable" | "revalidate";
  readonly initialLoad: boolean;
}

export interface ReleaseManifestV1 {
  readonly formatVersion: 1;
  readonly sourceCommit: string;
  readonly basePath: string;
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly cachePolicy: {
    readonly immutable: "assets/* (content-hashed; long-lived where host permits)";
    readonly revalidate: "index.html and release-manifest.json";
    readonly githubPagesLimitation: "GitHub Pages does not expose per-file Cache-Control configuration";
  };
  readonly budgets: {
    readonly site: { readonly bytes: number; readonly limitBytes: number };
    readonly largestAsset: {
      readonly path: string;
      readonly bytes: number;
      readonly limitBytes: number;
    };
    readonly compressedFirstLoad: {
      readonly bytes: number;
      readonly limitBytes: number;
      readonly files: readonly string[];
      readonly excludesGestureLoadedAudio: true;
    };
  };
  readonly files: readonly StaticFileRecord[];
}

export interface InspectStaticBuildOptions {
  readonly distDirectory: string;
  readonly basePath: string;
  readonly contentBundlePath: string;
  readonly sourceCommit: string;
  readonly writeManifest: boolean;
}

interface CliOptions extends InspectStaticBuildOptions {
  readonly verifyManifest: boolean;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normaliseBasePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "./") return trimmed;
  if (!trimmed.startsWith("/")) {
    throw new Error(`Static base path must start with "/" or be "./": ${input}`);
  }
  const withTrailingSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  if (withTrailingSlash.includes("//") || withTrailingSlash.includes("..")) {
    throw new Error(`Static base path is not canonical: ${input}`);
  }
  return withTrailingSlash;
}

function walk(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute, root) : [relative(root, absolute)];
    })
    .map((path) => path.split(sep).join("/"))
    .sort();
}

function readContentIdentity(path: string): {
  readonly contentVersion: string;
  readonly contentHash: string;
} {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || !("manifest" in parsed)) {
    throw new Error(`Compiled content has no manifest: ${path}`);
  }
  const manifest = (parsed as { readonly manifest: unknown }).manifest;
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`Compiled content manifest is invalid: ${path}`);
  }
  const contentVersion = (manifest as Record<string, unknown>)["contentVersion"];
  const contentHash = (manifest as Record<string, unknown>)["bundleHash"];
  if (
    typeof contentVersion !== "string" ||
    typeof contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(contentHash)
  ) {
    throw new Error(`Compiled content identity is invalid: ${path}`);
  }
  return { contentVersion, contentHash };
}

function localAssetUrls(indexHtml: string): string[] {
  return Array.from(indexHtml.matchAll(/\b(?:href|src)=(?:"([^"]+)"|'([^']+)')/g))
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => value !== undefined)
    .filter(
      (value) =>
        !value.startsWith("data:") &&
        !value.startsWith("http://") &&
        !value.startsWith("https://") &&
        !value.startsWith("#"),
    );
}

function assetUrlToPath(url: string, basePath: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? url;
  if (basePath === "./") {
    if (withoutQuery.startsWith("/")) {
      throw new Error(`Relative build contains root-absolute asset URL: ${url}`);
    }
    return withoutQuery.replace(/^\.\//, "");
  }
  if (!withoutQuery.startsWith(basePath)) {
    throw new Error(`Asset URL ${url} does not use configured base path ${basePath}`);
  }
  return withoutQuery.slice(basePath.length);
}

function cachePolicy(path: string): StaticFileRecord["cachePolicy"] {
  if (!path.startsWith("assets/")) return "revalidate";
  if (!HASHED_ASSET.test(path)) {
    throw new Error(`Published asset is not content-hashed: ${path}`);
  }
  return "immutable";
}

function assertBudget(label: string, actual: number, limit: number): void {
  if (actual > limit) {
    throw new Error(
      `${label} is ${String(actual)} bytes; release limit is ${String(limit)} bytes`,
    );
  }
}

export function inspectStaticBuild(
  options: InspectStaticBuildOptions,
): ReleaseManifestV1 {
  const distDirectory = resolve(options.distDirectory);
  const basePath = normaliseBasePath(options.basePath);
  const indexPath = join(distDirectory, "index.html");
  if (!existsSync(indexPath))
    throw new Error(`Static build has no index.html: ${indexPath}`);
  if (!existsSync(join(distDirectory, ".nojekyll"))) {
    throw new Error("Static build must contain .nojekyll for GitHub Pages");
  }

  const indexHtml = readFileSync(indexPath, "utf8");
  const initialPaths = new Set<string>(["index.html"]);
  for (const url of localAssetUrls(indexHtml)) {
    const path = assetUrlToPath(url, basePath);
    if (path.length === 0 || !existsSync(join(distDirectory, path))) {
      throw new Error(`index.html references missing asset: ${url}`);
    }
    if (!AUDIO_EXTENSIONS.has(extname(path).toLowerCase())) initialPaths.add(path);
  }

  const paths = walk(distDirectory).filter((path) => path !== RELEASE_MANIFEST_FILE);
  const files = paths.map((path): StaticFileRecord => {
    const bytes = readFileSync(join(distDirectory, path));
    return {
      path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      cachePolicy: cachePolicy(path),
      initialLoad: initialPaths.has(path),
    };
  });
  const siteBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largestAsset = files.reduce((largest, file) =>
    file.bytes > largest.bytes ? file : largest,
  );
  const initialFiles = files.filter((file) => file.initialLoad);
  const compressedFirstLoadBytes = initialFiles.reduce(
    (sum, file) =>
      sum +
      gzipSync(readFileSync(join(distDirectory, file.path)), { level: 9 }).byteLength,
    0,
  );

  assertBudget("Published site", siteBytes, STATIC_BUILD_BUDGETS.siteBytes);
  assertBudget(
    `Largest asset (${largestAsset.path})`,
    largestAsset.bytes,
    STATIC_BUILD_BUDGETS.singleAssetBytes,
  );
  assertBudget(
    "Compressed first load",
    compressedFirstLoadBytes,
    STATIC_BUILD_BUDGETS.compressedFirstLoadBytes,
  );
  const content = readContentIdentity(options.contentBundlePath);
  const manifest: ReleaseManifestV1 = {
    formatVersion: 1,
    sourceCommit: options.sourceCommit,
    basePath,
    contentVersion: content.contentVersion,
    contentHash: content.contentHash,
    cachePolicy: {
      immutable: "assets/* (content-hashed; long-lived where host permits)",
      revalidate: "index.html and release-manifest.json",
      githubPagesLimitation:
        "GitHub Pages does not expose per-file Cache-Control configuration",
    },
    budgets: {
      site: { bytes: siteBytes, limitBytes: STATIC_BUILD_BUDGETS.siteBytes },
      largestAsset: {
        path: largestAsset.path,
        bytes: largestAsset.bytes,
        limitBytes: STATIC_BUILD_BUDGETS.singleAssetBytes,
      },
      compressedFirstLoad: {
        bytes: compressedFirstLoadBytes,
        limitBytes: STATIC_BUILD_BUDGETS.compressedFirstLoadBytes,
        files: initialFiles.map((file) => file.path),
        excludesGestureLoadedAudio: true,
      },
    },
    files,
  };
  if (options.writeManifest) {
    writeFileSync(
      join(distDirectory, RELEASE_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
  return manifest;
}

function parseManifest(path: string): ReleaseManifestV1 {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<ReleaseManifestV1>;
  if (
    value.formatVersion !== 1 ||
    typeof value.sourceCommit !== "string" ||
    typeof value.basePath !== "string" ||
    !Array.isArray(value.files)
  ) {
    throw new Error(`Release manifest is invalid: ${path}`);
  }
  return value as ReleaseManifestV1;
}

export function verifyStaticBuild(
  distDirectory: string,
  expectedBasePath?: string,
): ReleaseManifestV1 {
  const root = resolve(distDirectory);
  const manifest = parseManifest(join(root, RELEASE_MANIFEST_FILE));
  if (
    expectedBasePath !== undefined &&
    manifest.basePath !== normaliseBasePath(expectedBasePath)
  ) {
    throw new Error(
      `Archived base path ${manifest.basePath} does not match Pages base ${normaliseBasePath(expectedBasePath)}`,
    );
  }
  const actualFiles = walk(root).filter((path) => path !== RELEASE_MANIFEST_FILE);
  if (
    JSON.stringify(actualFiles) !==
    JSON.stringify(manifest.files.map((file) => file.path))
  ) {
    throw new Error("Archived file list does not match release-manifest.json");
  }
  for (const file of manifest.files) {
    const bytes = readFileSync(join(root, file.path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`Archived file does not match release manifest: ${file.path}`);
    }
  }
  assertBudget(
    "Published site",
    manifest.budgets.site.bytes,
    STATIC_BUILD_BUDGETS.siteBytes,
  );
  assertBudget(
    `Largest asset (${manifest.budgets.largestAsset.path})`,
    manifest.budgets.largestAsset.bytes,
    STATIC_BUILD_BUDGETS.singleAssetBytes,
  );
  assertBudget(
    "Compressed first load",
    manifest.budgets.compressedFirstLoad.bytes,
    STATIC_BUILD_BUDGETS.compressedFirstLoadBytes,
  );
  return manifest;
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function cliOptions(args: readonly string[]): CliOptions {
  const fromRepositoryRoot = (path: string): string =>
    isAbsolute(path) ? path : resolve(REPOSITORY_ROOT, path);
  const distDirectory = fromRepositoryRoot(valueAfter(args, "--dist") ?? "apps/web/dist");
  const verifyManifest = args.includes("--verify-manifest");
  const manifestPath = join(resolve(distDirectory), RELEASE_MANIFEST_FILE);
  const archived =
    verifyManifest && existsSync(manifestPath) ? parseManifest(manifestPath) : null;
  return {
    distDirectory,
    basePath: valueAfter(args, "--base") ?? archived?.basePath ?? "/",
    contentBundlePath: fromRepositoryRoot(
      valueAfter(args, "--content") ?? "packages/content/generated/content.bundle.json",
    ),
    sourceCommit:
      valueAfter(args, "--source") ??
      process.env["NEOLAB_SOURCE_COMMIT"] ??
      "local-uncommitted",
    writeManifest: args.includes("--write-manifest"),
    verifyManifest,
  };
}

function main(): void {
  const options = cliOptions(process.argv.slice(2));
  const manifest = options.verifyManifest
    ? verifyStaticBuild(options.distDirectory, options.basePath)
    : inspectStaticBuild(options);
  console.log(
    JSON.stringify(
      {
        sourceCommit: manifest.sourceCommit,
        basePath: manifest.basePath,
        contentHash: manifest.contentHash,
        files: manifest.files.length,
        siteMiB: Number((manifest.budgets.site.bytes / 1024 / 1024).toFixed(2)),
        largestAssetMiB: Number(
          (manifest.budgets.largestAsset.bytes / 1024 / 1024).toFixed(2),
        ),
        compressedFirstLoadMiB: Number(
          (manifest.budgets.compressedFirstLoad.bytes / 1024 / 1024).toFixed(2),
        ),
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === resolve(import.meta.filename)) main();
