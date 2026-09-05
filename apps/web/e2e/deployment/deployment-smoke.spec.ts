import { expect, test } from "@playwright/test";

import { enterSeededLab } from "../helpers/campaign-opening.ts";

interface ReleaseManifest {
  readonly sourceCommit: string;
  readonly basePath: string;
  readonly contentHash: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

function deployedUrl(): URL {
  const value = process.env["NEOLAB_DEPLOYMENT_URL"];
  if (value === undefined) throw new Error("NEOLAB_DEPLOYMENT_URL is required");
  return new URL(value.endsWith("/") ? value : `${value}/`);
}

test("deployed artifact opens, advances a seeded game, and resolves every asset", async ({
  page,
  request,
}) => {
  const root = deployedUrl();
  const failedRequests: string[] = [];
  const cspViolations: string[] = [];
  const analyticsCollections: string[] = [];
  page.on("request", (request) => {
    if (request.url() === "https://gateway.umami.is/api/send") {
      analyticsCollections.push(request.method());
    }
  });
  page.on("requestfailed", (failed) => {
    failedRequests.push(
      `${failed.method()} ${failed.url()}: ${failed.failure()?.errorText}`,
    );
  });
  page.on("console", (message) => {
    if (message.text().toLowerCase().includes("content security policy")) {
      cspViolations.push(message.text());
    }
  });

  const response = await page.goto(root.href, { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: /neolab\.ai/i })).toBeVisible();
  await expect.poll(() => analyticsCollections).toContain("POST");
  await page.getByText("Privacy, diagnostics & feedback").click();
  await expect(page.getByLabel("Keep a local diagnostic notebook")).not.toBeChecked();
  await expect(page.getByRole("link", { name: /Report an issue/ })).toHaveAttribute(
    "href",
    "https://github.com/bodono/neolab.ai-feeback/issues/new?template=feedback.md",
  );

  const manifestResponse = await request.get(new URL("release-manifest.json", root).href);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as ReleaseManifest;
  expect(manifest.contentHash).toMatch(/^[0-9a-f]{64}$/);
  const manifestPath =
    manifest.basePath === "./"
      ? new URL(".", root).pathname
      : new URL(manifest.basePath, root.origin).pathname;
  expect(manifestPath).toBe(root.pathname);
  const expectedCommit = process.env["NEOLAB_EXPECTED_COMMIT"];
  if (expectedCommit !== undefined) expect(manifest.sourceCommit).toBe(expectedCommit);

  // Pages consumes .nojekyll to disable Jekyll and never serves it, so it is
  // published-but-unfetchable by design and a reachability check on it fails
  // every deployment. Its presence in the artifact is what matters, and the
  // packaging step already asserts that.
  const unservedByDesign = new Set([".nojekyll"]);
  const assetChecks = await Promise.all(
    manifest.files
      .filter((file) => !unservedByDesign.has(file.path))
      .map(async (file) => {
        const assetUrl = new URL(file.path, root);
        expect(assetUrl.origin).toBe(root.origin);
        expect(assetUrl.pathname.startsWith(root.pathname)).toBe(true);
        const assetResponse = await request.head(assetUrl.href);
        return { path: file.path, status: assetResponse.status() };
      }),
  );
  expect(
    assetChecks.filter((asset) => asset.status < 200 || asset.status >= 400),
  ).toEqual([]);

  await enterSeededLab(page, { seed: "0123456789abcdef0123456789abcdef" });
  await page.getByRole("button", { name: "Step one week" }).click();
  await expect(page.getByText("WEEK 2", { exact: true })).toBeVisible();
  expect(failedRequests).toEqual([]);
  expect(cspViolations).toEqual([]);
});

test("content security policy blocks cross-origin runtime connections", async ({
  page,
}) => {
  await page.goto(deployedUrl().href);
  const result = await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/neolab-csp-probe");
      return "connection-allowed";
    } catch (error) {
      return error instanceof Error ? error.name : "connection-blocked";
    }
  });
  expect(result).not.toBe("connection-allowed");
});
