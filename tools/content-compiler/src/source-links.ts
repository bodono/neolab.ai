import { lookup } from "node:dns/promises";
import { readdirSync } from "node:fs";
import { isIP } from "node:net";
import { join, relative, sep } from "node:path";

import { parseYamlFile } from "./yaml-io.ts";

export type SourceLinkStatus =
  "reachable" | "restricted" | "broken" | "transient-error" | "unsafe";

export interface SourceLinkReference {
  readonly file: string;
  readonly pointer: string;
}

export interface SourceLinkCandidate {
  readonly url: string;
  readonly references: readonly SourceLinkReference[];
}

export interface SourceLinkRequestResult {
  readonly status: number;
  readonly finalUrl: string;
  readonly redirectCount: number;
}

export interface SourceLinkResult extends SourceLinkCandidate {
  readonly status: SourceLinkStatus;
  readonly method?: "HEAD" | "GET";
  readonly httpStatus?: number;
  readonly finalUrl?: string;
  readonly redirectCount?: number;
  readonly detail?: string;
}

export interface SourceLinkReport {
  readonly format: 1;
  readonly checkedAt: string;
  readonly summary: Readonly<Record<SourceLinkStatus | "total", number>>;
  readonly links: readonly SourceLinkResult[];
}

export interface SourceLinkCheckerOptions {
  readonly checkedAt: string;
  readonly concurrency?: number;
  readonly request?: (
    url: string,
    method: "HEAD" | "GET",
  ) => Promise<SourceLinkRequestResult>;
}

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MILLISECONDS = 12_000;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function listYamlFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => compareText(left.name, right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listYamlFiles(path));
    if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(path);
  }
  return files;
}

function exactHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function collectFromValue(
  value: unknown,
  file: string,
  pointer: string,
  byUrl: Map<string, SourceLinkReference[]>,
): void {
  if (typeof value === "string") {
    const url = exactHttpUrl(value);
    if (url !== undefined) {
      const references = byUrl.get(url) ?? [];
      references.push({ file, pointer: pointer === "" ? "/" : pointer });
      byUrl.set(url, references);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      collectFromValue(child, file, `${pointer}/${String(index)}`, byUrl);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const key of Object.keys(value).sort(compareText)) {
    collectFromValue(
      (value as Record<string, unknown>)[key],
      file,
      `${pointer}/${pointerSegment(key)}`,
      byUrl,
    );
  }
}

/** Collect exact HTTP(S) values from every authored YAML file without modifying it. */
export function collectSourceLinks(contentRoot: string): readonly SourceLinkCandidate[] {
  const byUrl = new Map<string, SourceLinkReference[]>();
  for (const path of listYamlFiles(contentRoot)) {
    const file = ["content", relative(contentRoot, path).split(sep).join("/")].join("/");
    collectFromValue(parseYamlFile(path), file, "", byUrl);
  }
  return [...byUrl.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([url, references]) => ({
      url,
      references: references.sort((left, right) =>
        compareText(`${left.file}${left.pointer}`, `${right.file}${right.pointer}`),
      ),
    }));
}

function unsafeIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function unsafeIpAddress(address: string): boolean {
  if (isIP(address) === 4) return unsafeIpv4(address);
  if (isIP(address) !== 6) return true;
  const normalised = address.toLowerCase();
  if (normalised.startsWith("::ffff:")) {
    const embedded = normalised.slice("::ffff:".length);
    return isIP(embedded) !== 4 || unsafeIpv4(embedded);
  }
  return (
    normalised === "::" ||
    normalised === "::1" ||
    normalised.startsWith("fc") ||
    normalised.startsWith("fd") ||
    /^fe[89ab]/.test(normalised) ||
    normalised.startsWith("ff")
  );
}

function normaliseHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

export function isPotentiallyPublicHostname(hostname: string): boolean {
  const normalised = normaliseHostname(hostname);
  if (
    normalised === "localhost" ||
    normalised.endsWith(".localhost") ||
    normalised.endsWith(".local") ||
    normalised.endsWith(".internal") ||
    normalised.endsWith(".lan")
  ) {
    return false;
  }
  return isIP(normalised) === 0 || !unsafeIpAddress(normalised);
}

async function assertPublicDestination(url: URL): Promise<void> {
  const hostname = normaliseHostname(url.hostname);
  if (!isPotentiallyPublicHostname(hostname)) {
    throw new Error(`refused non-public hostname ${hostname}`);
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => unsafeIpAddress(address))
  ) {
    throw new Error(`refused non-public address for ${hostname}`);
  }
}

async function defaultRequest(
  originalUrl: string,
  method: "HEAD" | "GET",
): Promise<SourceLinkRequestResult> {
  let current = new URL(originalUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicDestination(current);
    const response = await fetch(current, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MILLISECONDS),
      headers:
        method === "GET"
          ? {
              Accept: "text/html,application/pdf;q=0.9,*/*;q=0.1",
              Range: "bytes=0-0",
              "User-Agent": "NeolabSourceLinkMonitor/1.0",
            }
          : { Accept: "*/*", "User-Agent": "NeolabSourceLinkMonitor/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (location === null) {
        return { status: response.status, finalUrl: current.href, redirectCount };
      }
      if (redirectCount === MAX_REDIRECTS) throw new Error("too many redirects");
      current = new URL(location, current);
      continue;
    }
    await response.body?.cancel();
    return { status: response.status, finalUrl: current.href, redirectCount };
  }
  throw new Error("too many redirects");
}

function classifyHttpStatus(status: number): SourceLinkStatus {
  if (status >= 200 && status < 400) return "reachable";
  if ([401, 403, 405, 406, 407, 429, 451, 999].includes(status)) return "restricted";
  if (status === 404 || status === 410) return "broken";
  if (status >= 500) return "transient-error";
  return "broken";
}

function resultFromResponse(
  candidate: SourceLinkCandidate,
  method: "HEAD" | "GET",
  response: SourceLinkRequestResult,
): SourceLinkResult {
  return {
    ...candidate,
    status: classifyHttpStatus(response.status),
    method,
    httpStatus: response.status,
    finalUrl: response.finalUrl,
    redirectCount: response.redirectCount,
  };
}

async function checkOne(
  candidate: SourceLinkCandidate,
  request: NonNullable<SourceLinkCheckerOptions["request"]>,
): Promise<SourceLinkResult> {
  try {
    const head = await request(candidate.url, "HEAD");
    if (head.status !== 403 && head.status !== 405) {
      return resultFromResponse(candidate, "HEAD", head);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith("refused non-public")) {
      return { ...candidate, status: "unsafe", detail };
    }
  }
  try {
    return resultFromResponse(candidate, "GET", await request(candidate.url, "GET"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...candidate,
      status: detail.startsWith("refused non-public") ? "unsafe" : "transient-error",
      detail,
    };
  }
}

export async function checkSourceLinks(
  candidates: readonly SourceLinkCandidate[],
  options: SourceLinkCheckerOptions,
): Promise<SourceLinkReport> {
  const request = options.request ?? defaultRequest;
  const concurrency = Math.min(
    candidates.length || 1,
    Math.max(1, Math.floor(options.concurrency ?? 4)),
  );
  const links = new Array<SourceLinkResult>(candidates.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        const candidate = candidates[index];
        if (candidate !== undefined) links[index] = await checkOne(candidate, request);
      }
    }),
  );
  const summary: Record<SourceLinkStatus | "total", number> = {
    total: links.length,
    reachable: 0,
    restricted: 0,
    broken: 0,
    "transient-error": 0,
    unsafe: 0,
  };
  for (const link of links) summary[link.status] += 1;
  return { format: 1, checkedAt: options.checkedAt, summary, links };
}
