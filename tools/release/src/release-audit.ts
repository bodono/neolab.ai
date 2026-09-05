import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { verifyStaticBuild, type ReleaseManifestV1 } from "./static-build.ts";

const REPOSITORY_ROOT = resolve(dirname(import.meta.filename), "../../..");
const UMAMI_SCRIPT_ORIGIN = "https://cloud.umami.is";
const UMAMI_COLLECTOR_ORIGIN = "https://gateway.umami.is";
const REQUIRED_CSP = Object.freeze({
  "default-src": ["'self'"],
  "base-uri": ["'none'"],
  "object-src": ["'none'"],
  "script-src": ["'self'", UMAMI_SCRIPT_ORIGIN],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:"],
  "media-src": ["'self'", "blob:"],
  // Umami Cloud moved collection to gateway.umami.is in June 2026. Keep the
  // collector exact rather than granting every present and future subdomain.
  "connect-src": ["'self'", UMAMI_COLLECTOR_ORIGIN],
  "font-src": ["'self'"],
  "worker-src": ["'none'"],
  "form-action": ["'none'"],
});
const NETWORK_PRIMITIVES = [
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
] as const;
const AUDIO_FETCH_FILE = "apps/web/src/audio/web-audio-manager.ts";
const FEEDBACK_URL =
  "https://github.com/bodono/neolab.ai-feeback/issues/new?template=feedback.md";
const DEVELOPER_INSPECTOR_SENTINEL = "NEOLAB_PRIVILEGED_INSPECTOR_V1";
const PROJECT_LICENCE = "LicenseRef-Neolab-Proprietary";
const LEGAL_BUNDLE_NOTICE = "Neolab.ai — proprietary software and content.";
const LEGAL_FILES = [
  "LICENSE",
  "COPYRIGHT.md",
  "CONTRIBUTING.md",
  "DISCLAIMER.md",
  "THIRD_PARTY_NOTICES.md",
] as const;

interface LicenseListEntry {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
  readonly author?: string;
  readonly homepage?: string;
}

export interface ProductionLicenseRecord {
  readonly package: string;
  readonly version: string;
  readonly licence: string;
  readonly author?: string;
  readonly homepage?: string;
}

export interface ReleaseAuditReport {
  readonly formatVersion: 1;
  readonly sourceCommit: string;
  readonly contentHash: string;
  readonly basePath: string;
  readonly generatedAt: "release-build";
  readonly checks: {
    readonly csp: {
      readonly passed: true;
      readonly directives: Readonly<Record<string, readonly string[]>>;
      readonly inlineStyleReason: string;
    };
    readonly privacy: {
      readonly passed: true;
      readonly diagnosticsDefault: "off";
      readonly productAnalytics: "configured anonymous milestones and sanitised crash fingerprints";
      readonly analyticsProvider: "Hosted Umami Cloud";
      readonly analyticsControl: "automatic in configured production builds";
      readonly onlyRuntimeFetch: typeof AUDIO_FETCH_FILE;
      readonly fetchPurpose: "same-origin content-hashed audio";
      readonly feedbackChannel: typeof FEEDBACK_URL;
    };
    readonly highScores: {
      readonly passed: true;
      readonly storage: "IndexedDB in the player's browser";
      readonly globalLeaderboard: false;
      readonly submissionCodeReachable: false;
    };
    readonly developerTools: {
      readonly passed: true;
      readonly privilegedInspectorBundled: false;
    };
    readonly legal: {
      readonly passed: true;
      readonly files: typeof LEGAL_FILES;
      readonly ownershipMapping: ".reuse/dep5";
    };
    readonly audio: {
      readonly passed: true;
      readonly opusAssets: number;
      readonly aacFallbackAssets: number;
      readonly sourceAndRecordingsLicence: typeof PROJECT_LICENCE;
    };
    readonly licences: {
      readonly passed: true;
      readonly project: typeof PROJECT_LICENCE;
      readonly productionPackages: number;
      readonly records: readonly ProductionLicenseRecord[];
    };
  };
  readonly bundle: {
    readonly totalBytes: number;
    readonly compressedInitialBytes: number;
    readonly fileCount: number;
    readonly byExtension: readonly {
      readonly extension: string;
      readonly files: number;
      readonly bytes: number;
    }[];
    readonly largest: readonly {
      readonly path: string;
      readonly bytes: number;
    }[];
  };
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

function fromRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(REPOSITORY_ROOT, path);
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

export function parseCsp(indexHtml: string): Readonly<Record<string, readonly string[]>> {
  const meta = indexHtml.match(
    /<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i,
  )?.[0];
  const contentMatch = meta?.match(/\bcontent=(["'])(.*?)\1/i);
  const content = contentMatch?.[2];
  if (content === undefined) throw new Error("index.html has no CSP meta policy");
  return Object.fromEntries(
    content
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        if (name === undefined) throw new Error("CSP contains an empty directive");
        return [name, values] as const;
      }),
  );
}

export function verifyCsp(
  indexHtml: string,
): Readonly<Record<string, readonly string[]>> {
  const actual = parseCsp(indexHtml);
  for (const [name, values] of Object.entries(REQUIRED_CSP)) {
    if (JSON.stringify(actual[name]) !== JSON.stringify(values)) {
      throw new Error(
        `CSP ${name} must be ${values.join(" ")}; got ${(actual[name] ?? []).join(" ")}`,
      );
    }
  }
  const serialised = JSON.stringify(actual);
  if (serialised.includes("'unsafe-eval'") || serialised.includes("http:")) {
    throw new Error("CSP permits unsafe evaluation or insecure HTTP resources");
  }
  return actual;
}

function readProductionLicences(root: string): readonly ProductionLicenseRecord[] {
  const listed = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (listed.error !== undefined) throw listed.error;
  if (listed.status !== 0) {
    throw new Error(`pnpm licence inventory failed: ${listed.stderr}`);
  }
  const buckets = JSON.parse(listed.stdout) as Record<string, LicenseListEntry[]>;
  return Object.entries(buckets)
    .flatMap(([bucket, entries]) =>
      entries.flatMap((entry) =>
        entry.versions.map((version) => ({
          package: entry.name,
          version,
          licence: entry.license || bucket,
          ...(entry.author === undefined ? {} : { author: entry.author }),
          ...(entry.homepage === undefined ? {} : { homepage: entry.homepage }),
        })),
      ),
    )
    .sort((left, right) =>
      `${left.package}@${left.version}`.localeCompare(
        `${right.package}@${right.version}`,
      ),
    );
}

function verifyRuntimeNetworkSurface(root: string): void {
  const sourceRoot = join(root, "apps/web/src");
  const files = walk(sourceRoot).filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  const fetchFiles: string[] = [];
  for (const path of files) {
    const repositoryPath = `apps/web/src/${path}`;
    const source = readFileSync(join(sourceRoot, path), "utf8");
    if (/\bfetch\s*\(/.test(source)) fetchFiles.push(repositoryPath);
    for (const primitive of NETWORK_PRIMITIVES) {
      if (source.includes(primitive)) {
        throw new Error(
          `Shipped source contains forbidden network primitive ${primitive}: ${repositoryPath}`,
        );
      }
    }
  }
  if (JSON.stringify(fetchFiles) !== JSON.stringify([AUDIO_FETCH_FILE])) {
    throw new Error(
      `Runtime fetch allowlist changed: ${fetchFiles.join(", ") || "none"}`,
    );
  }
  const audioSource = readFileSync(join(root, AUDIO_FETCH_FILE), "utf8");
  if (
    !audioSource.includes("Audio request failed") ||
    !audioSource.includes("fetch(url)")
  ) {
    throw new Error("The allowlisted fetch is no longer the local audio loader");
  }

  const analyticsConfig = readFileSync(
    join(root, "apps/web/src/telemetry/analytics-config.ts"),
    "utf8",
  );
  const analyticsProvider = readFileSync(
    join(root, "apps/web/src/telemetry/umami-provider.ts"),
    "utf8",
  );
  if (!analyticsConfig.includes('scriptUrl: "https://cloud.umami.is/script.js"')) {
    throw new Error("Hosted analytics script is not restricted to Umami Cloud");
  }
  if (!analyticsProvider.includes('dataset["autoTrack"] = "false"')) {
    throw new Error("Hosted analytics must keep automatic page tracking disabled");
  }
  if (!analyticsProvider.includes('dataset["excludeSearch"] = "true"')) {
    throw new Error("Hosted analytics must exclude URL query strings");
  }

  const appSource = files
    .map((path) => readFileSync(join(sourceRoot, path), "utf8"))
    .join("\n");
  if (appSource.includes("LeaderboardSubmission") || appSource.includes("playerAlias")) {
    throw new Error("Shipped app contains future leaderboard submission protocol code");
  }
  if (!appSource.includes("new IndexedDbHighScoreRepository()")) {
    throw new Error(
      "Shipped app is not wired to the local IndexedDB high-score repository",
    );
  }
  if (!appSource.includes(FEEDBACK_URL)) {
    throw new Error("Shipped app has no feedback channel link");
  }
  const diagnostics = readFileSync(
    join(root, "apps/web/src/runtime/local-diagnostics.ts"),
    "utf8",
  );
  if (
    !diagnostics.includes('this.#enabled = this.#safeGet(CONSENT_KEY) === "true"') ||
    !diagnostics.includes("automaticTransmission: false")
  ) {
    throw new Error(
      "Local diagnostics no longer have an explicit off/no-transmit contract",
    );
  }
}

function verifyLegalFiles(root: string, distDirectory: string): void {
  const licencePath = join(root, "LICENSE");
  if (!existsSync(licencePath)) throw new Error("Project LICENSE is missing");
  const projectLicence = readFileSync(licencePath, "utf8");
  const normalisedProjectLicence = projectLicence.replace(/\s+/g, " ");
  const requiredLicenceLanguage = [
    "NEOLAB.AI PROPRIETARY SOFTWARE AND CONTENT LICENCE",
    "Version 1.0 — effective 27 July 2026",
    "All rights reserved.",
    "personal, non-commercial",
    "unmodified object-code build",
    "3.4 GAMEPLAY MEDIA PERMISSION",
    "3.5 CONTRIBUTION-ONLY SOURCE PERMISSION",
    "5. MANDATORY LEGAL EXCEPTIONS",
    "6. CONTRIBUTIONS AND FEEDBACK",
    "9. DIGITAL-CONTENT AND CONSUMER RIGHTS",
  ];
  for (const phrase of requiredLicenceLanguage) {
    if (!normalisedProjectLicence.includes(phrase)) {
      throw new Error(`Project licence is missing required language: ${phrase}`);
    }
  }

  const reuseLicencePath = join(root, "LICENSES/LicenseRef-Neolab-Proprietary.txt");
  if (!existsSync(reuseLicencePath)) {
    throw new Error("REUSE proprietary licence copy is missing");
  }
  if (readFileSync(reuseLicencePath, "utf8") !== projectLicence) {
    throw new Error("Root and REUSE proprietary licence texts do not match");
  }

  const copyright = readFileSync(join(root, "COPYRIGHT.md"), "utf8");
  if (
    !copyright.includes("All rights reserved") ||
    !copyright.includes("Brendan O'Donoghue")
  ) {
    throw new Error("Copyright and ownership notice is incomplete");
  }
  const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
  if (
    !contributing.includes("Contribution workflow") ||
    !contributing.includes("Terms of submission") ||
    !contributing.includes("Gameplay media")
  ) {
    throw new Error("Contribution terms are missing or incomplete");
  }
  const ownershipMapping = readFileSync(join(root, ".reuse/dep5"), "utf8");
  if (
    !ownershipMapping.includes("Copyright: 2026 Brendan O'Donoghue") ||
    !ownershipMapping.includes(`License: ${PROJECT_LICENCE}`)
  ) {
    throw new Error("Repository-wide copyright and licence mapping is incomplete");
  }

  const soundtrackReadme = readFileSync(join(root, "soundtrack/README.md"), "utf8");
  const normalisedSoundtrackReadme = soundtrackReadme.replace(/\s+/g, " ");
  if (
    !normalisedSoundtrackReadme.includes("proprietary") ||
    !normalisedSoundtrackReadme.includes("all rights are reserved")
  ) {
    throw new Error("Soundtrack proprietary licence declaration is not explicit");
  }

  for (const path of LEGAL_FILES) {
    const sourcePath = join(root, path);
    const builtPath = join(distDirectory, path);
    if (!existsSync(sourcePath)) throw new Error(`Legal source file is missing: ${path}`);
    if (!existsSync(builtPath)) throw new Error(`Built legal file is missing: ${path}`);
    if (readFileSync(builtPath, "utf8") !== readFileSync(sourcePath, "utf8")) {
      throw new Error(`Built legal file differs from its source: ${path}`);
    }
  }

  const javascriptBundles = walk(distDirectory).filter((path) => path.endsWith(".js"));
  if (javascriptBundles.length === 0) {
    throw new Error("Production build contains no JavaScript bundles");
  }
  for (const path of javascriptBundles) {
    const bundle = readFileSync(join(distDirectory, path), "utf8");
    if (
      !bundle.startsWith("/*!") ||
      !bundle.includes(LEGAL_BUNDLE_NOTICE) ||
      !bundle.includes("Copyright © 2026 Brendan O'Donoghue") ||
      !bundle.includes("See the LICENSE file distributed with this build")
    ) {
      throw new Error(`Production JavaScript bundle lacks its legal notice: ${path}`);
    }
  }
}

function verifyThirdPartyNotices(
  root: string,
  records: readonly ProductionLicenseRecord[],
): void {
  const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const record of records) {
    for (const expected of [record.package, record.version, record.licence]) {
      if (!notices.includes(expected)) {
        throw new Error(
          `Third-party notices omit ${record.package}@${record.version} ${record.licence}`,
        );
      }
    }
  }
  const requiredCopyrightNotices = [
    "Copyright © 2022 Paul Miller",
    "Copyright © Microsoft Corporation",
    "Copyright © 2017–2018 Fredrik Nicol",
    "Copyright © Meta Platforms, Inc. and affiliates",
    "Copyright © 2025 Colin McDonnell",
    "Copyright © 2019 Paul Henschel",
    "Copyright Eemeli Aro",
  ];
  for (const notice of requiredCopyrightNotices) {
    if (!notices.includes(notice)) {
      throw new Error(`Third-party copyright notice is missing: ${notice}`);
    }
  }
}

export function verifyProductionExcludesDeveloperInspector(distDirectory: string): void {
  const root = resolve(distDirectory);
  const textFiles = walk(root).filter((path) => /\.(?:css|html|js)$/.test(path));
  for (const path of textFiles) {
    const source = readFileSync(join(root, path), "utf8");
    if (source.includes(DEVELOPER_INSPECTOR_SENTINEL)) {
      throw new Error(
        `Production bundle contains privileged developer inspector code: ${path}`,
      );
    }
  }
}

function bundleBreakdown(manifest: ReleaseManifestV1): ReleaseAuditReport["bundle"] {
  const buckets = new Map<string, { files: number; bytes: number }>();
  for (const file of manifest.files) {
    const extension = extname(file.path).toLowerCase() || "[none]";
    const current = buckets.get(extension) ?? { files: 0, bytes: 0 };
    buckets.set(extension, {
      files: current.files + 1,
      bytes: current.bytes + file.bytes,
    });
  }
  return {
    totalBytes: manifest.budgets.site.bytes,
    compressedInitialBytes: manifest.budgets.compressedFirstLoad.bytes,
    fileCount: manifest.files.length + 1,
    byExtension: Array.from(buckets, ([extension, value]) => ({
      extension,
      ...value,
    })).sort(
      (left, right) =>
        right.bytes - left.bytes || left.extension.localeCompare(right.extension),
    ),
    largest: [...manifest.files]
      .sort(
        (left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path),
      )
      .slice(0, 15)
      .map(({ path, bytes }) => ({ path, bytes })),
  };
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function writeReports(report: ReleaseAuditReport, outputDirectory: string): void {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, "release-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const licences = [
    "# Production licence report",
    "",
    `Project and original soundtrack: **${PROJECT_LICENCE}**. All rights reserved.`,
    "",
    "The soundtrack is generated from repository source and incorporates no third-party samples or recordings.",
    "",
    "Production dependencies remain subject to the separate licences listed below and in `THIRD_PARTY_NOTICES.md`.",
    "",
    "| Package | Version | Licence | Homepage |",
    "|---|---:|---|---|",
    ...report.checks.licences.records.map(
      (record) =>
        `| ${record.package} | ${record.version} | ${record.licence} | ${record.homepage ?? "—"} |`,
    ),
    "",
  ].join("\n");
  writeFileSync(join(outputDirectory, "production-licences.md"), licences);

  const bundle = [
    "# Static bundle report",
    "",
    `- Source: \`${report.sourceCommit}\``,
    `- Content hash: \`${report.contentHash}\``,
    `- Total static site: **${formatMiB(report.bundle.totalBytes)}**`,
    `- Compressed initial load: **${formatMiB(report.bundle.compressedInitialBytes)}**`,
    `- Files including manifest: **${report.bundle.fileCount}**`,
    `- Audio: **${report.checks.audio.opusAssets} Opus + ${report.checks.audio.aacFallbackAssets} AAC fallback assets**`,
    "",
    "## By extension",
    "",
    "| Extension | Files | Bytes |",
    "|---|---:|---:|",
    ...report.bundle.byExtension.map(
      (row) => `| ${row.extension} | ${row.files} | ${formatMiB(row.bytes)} |`,
    ),
    "",
    "## Largest files",
    "",
    "| Path | Bytes |",
    "|---|---:|",
    ...report.bundle.largest.map((row) => `| ${row.path} | ${formatMiB(row.bytes)} |`),
    "",
  ].join("\n");
  writeFileSync(join(outputDirectory, "bundle-report.md"), bundle);
}

export function auditRelease(options: {
  readonly repositoryRoot: string;
  readonly distDirectory: string;
  readonly outputDirectory: string;
}): ReleaseAuditReport {
  const root = resolve(options.repositoryRoot);
  const distDirectory = resolve(options.distDirectory);
  const manifest = verifyStaticBuild(distDirectory);
  verifyLegalFiles(root, distDirectory);
  const csp = verifyCsp(readFileSync(join(distDirectory, "index.html"), "utf8"));
  verifyProductionExcludesDeveloperInspector(distDirectory);
  verifyRuntimeNetworkSurface(root);
  const licences = readProductionLicences(root);
  if (licences.length === 0 || licences.some((record) => record.licence.trim() === "")) {
    throw new Error("Production dependency licence inventory is incomplete");
  }
  verifyThirdPartyNotices(root, licences);
  const opusAssets = manifest.files.filter((file) => file.path.endsWith(".opus")).length;
  const aacFallbackAssets = manifest.files.filter((file) =>
    file.path.endsWith(".m4a"),
  ).length;
  // 47 since The Last Evaluation was retired from the catalogue; its files
  // remain in soundtrack/ but are no longer imported, so they never reach dist.
  const EXPECTED_AUDIO_ASSETS = 47;
  if (opusAssets !== aacFallbackAssets) {
    throw new Error(
      `Release audio must ship every track in both codecs; got ${String(opusAssets)} Opus and ${String(aacFallbackAssets)} AAC`,
    );
  }
  if (opusAssets !== EXPECTED_AUDIO_ASSETS) {
    throw new Error(
      `Release audio must contain ${String(EXPECTED_AUDIO_ASSETS)} Opus and ${String(EXPECTED_AUDIO_ASSETS)} AAC assets; got ${String(opusAssets)}. Update EXPECTED_AUDIO_ASSETS when tracks are added or removed on purpose.`,
    );
  }

  const report: ReleaseAuditReport = {
    formatVersion: 1,
    sourceCommit: manifest.sourceCommit,
    contentHash: manifest.contentHash,
    basePath: manifest.basePath,
    generatedAt: "release-build",
    checks: {
      csp: {
        passed: true,
        directives: csp,
        inlineStyleReason:
          "React uses bounded inline style attributes for player-visible telemetry and campus placement; external scripts are restricted to Hosted Umami Cloud without unsafe-eval.",
      },
      privacy: {
        passed: true,
        diagnosticsDefault: "off",
        productAnalytics:
          "configured anonymous milestones and sanitised crash fingerprints",
        analyticsProvider: "Hosted Umami Cloud",
        analyticsControl: "automatic in configured production builds",
        onlyRuntimeFetch: AUDIO_FETCH_FILE,
        fetchPurpose: "same-origin content-hashed audio",
        feedbackChannel: FEEDBACK_URL,
      },
      highScores: {
        passed: true,
        storage: "IndexedDB in the player's browser",
        globalLeaderboard: false,
        submissionCodeReachable: false,
      },
      developerTools: {
        passed: true,
        privilegedInspectorBundled: false,
      },
      legal: {
        passed: true,
        files: LEGAL_FILES,
        ownershipMapping: ".reuse/dep5",
      },
      audio: {
        passed: true,
        opusAssets,
        aacFallbackAssets,
        sourceAndRecordingsLicence: PROJECT_LICENCE,
      },
      licences: {
        passed: true,
        project: PROJECT_LICENCE,
        productionPackages: licences.length,
        records: licences,
      },
    },
    bundle: bundleBreakdown(manifest),
  };
  writeReports(report, resolve(options.outputDirectory));
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const report = auditRelease({
    repositoryRoot: REPOSITORY_ROOT,
    distDirectory: fromRoot(valueAfter(args, "--dist") ?? "apps/web/dist"),
    outputDirectory: fromRoot(valueAfter(args, "--output") ?? "artifacts/release-checks"),
  });
  console.log(
    JSON.stringify(
      {
        sourceCommit: report.sourceCommit,
        contentHash: report.contentHash,
        totalMiB: Number((report.bundle.totalBytes / 1024 / 1024).toFixed(2)),
        compressedInitialMiB: Number(
          (report.bundle.compressedInitialBytes / 1024 / 1024).toFixed(2),
        ),
        productionPackages: report.checks.licences.productionPackages,
        audio: `${String(report.checks.audio.opusAssets)} Opus + ${String(report.checks.audio.aacFallbackAssets)} AAC`,
        diagnostics: "off; local export only",
        highScores: "local IndexedDB only",
        developerInspector: "excluded from production bytes",
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === resolve(import.meta.filename)) main();
