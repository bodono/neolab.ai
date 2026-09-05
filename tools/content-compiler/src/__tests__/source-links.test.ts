import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkSourceLinks,
  collectSourceLinks,
  isPotentiallyPublicHostname,
  type SourceLinkRequestResult,
} from "../source-links.ts";

describe("source link collection", () => {
  it("walks authored YAML deterministically and deduplicates references", () => {
    const root = mkdtempSync(join(tmpdir(), "neolab-source-links-"));
    mkdirSync(join(root, "nested"));
    writeFileSync(
      join(root, "a.yaml"),
      "source: https://example.com/paper\nnotes:\n  - not-a-url\n",
    );
    writeFileSync(
      join(root, "nested", "b.yml"),
      "sources:\n  - https://example.com/paper\n  - http://example.org/profile\n",
    );

    expect(collectSourceLinks(root)).toEqual([
      {
        url: "http://example.org/profile",
        references: [{ file: "content/nested/b.yml", pointer: "/sources/1" }],
      },
      {
        url: "https://example.com/paper",
        references: [
          { file: "content/a.yaml", pointer: "/source" },
          { file: "content/nested/b.yml", pointer: "/sources/0" },
        ],
      },
    ]);
  });
});

describe("source link checking", () => {
  it("falls back from rejected HEAD requests and reports every status without failing", async () => {
    const calls: string[] = [];
    const responses: Record<string, number | "throw"> = {
      "https://broken.example/|HEAD": 404,
      "https://down.example/|HEAD": 503,
      "https://fallback.example/|HEAD": 405,
      "https://fallback.example/|GET": 200,
      "https://not-acceptable.example/|HEAD": 406,
      "https://ok.example/|HEAD": 204,
      "https://private.example/|HEAD": "throw",
      "https://private.example/|GET": "throw",
      "https://restricted.example/|HEAD": 429,
      "https://vendor-block.example/|HEAD": 999,
    };
    const request = (
      url: string,
      method: "HEAD" | "GET",
    ): Promise<SourceLinkRequestResult> => {
      calls.push(`${url}|${method}`);
      const response = responses[`${url}|${method}`];
      if (response === "throw") {
        return Promise.reject(new Error("refused non-public address for host"));
      }
      if (response === undefined) return Promise.reject(new Error("missing fixture"));
      return Promise.resolve({ status: response, finalUrl: url, redirectCount: 0 });
    };
    const candidates = Object.keys(responses)
      .filter((key) => key.endsWith("|HEAD"))
      .map((key) => ({ url: key.slice(0, -5), references: [] }));

    const report = await checkSourceLinks(candidates, {
      checkedAt: "2026-07-22T00:00:00.000Z",
      concurrency: 3,
      request,
    });

    expect(report.summary).toEqual({
      total: 8,
      reachable: 2,
      restricted: 3,
      broken: 1,
      "transient-error": 1,
      unsafe: 1,
    });
    expect(
      report.links.map(({ url, status, method }) => ({ url, status, method })),
    ).toEqual([
      { url: "https://broken.example/", status: "broken", method: "HEAD" },
      { url: "https://down.example/", status: "transient-error", method: "HEAD" },
      { url: "https://fallback.example/", status: "reachable", method: "GET" },
      {
        url: "https://not-acceptable.example/",
        status: "restricted",
        method: "HEAD",
      },
      { url: "https://ok.example/", status: "reachable", method: "HEAD" },
      { url: "https://private.example/", status: "unsafe", method: undefined },
      { url: "https://restricted.example/", status: "restricted", method: "HEAD" },
      { url: "https://vendor-block.example/", status: "restricted", method: "HEAD" },
    ]);
    expect(calls).toContain("https://fallback.example/|GET");
  });

  it("rejects literal local and private destinations before requests", () => {
    expect(isPotentiallyPublicHostname("localhost")).toBe(false);
    expect(isPotentiallyPublicHostname("service.internal")).toBe(false);
    expect(isPotentiallyPublicHostname("127.0.0.1")).toBe(false);
    expect(isPotentiallyPublicHostname("169.254.169.254")).toBe(false);
    expect(isPotentiallyPublicHostname("10.0.0.4")).toBe(false);
    expect(isPotentiallyPublicHostname("::1")).toBe(false);
    expect(isPotentiallyPublicHostname("example.com")).toBe(true);
    expect(isPotentiallyPublicHostname("8.8.8.8")).toBe(true);
  });
});
