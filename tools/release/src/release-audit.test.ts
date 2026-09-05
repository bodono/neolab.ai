import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  parseCsp,
  verifyCsp,
  verifyProductionExcludesDeveloperInspector,
} from "./release-audit.ts";

const productionIndex = readFileSync(
  resolve(dirname(import.meta.filename), "../../../apps/web/index.html"),
  "utf8",
);

describe("release security audit", () => {
  it("parses the complete static CSP policy", () => {
    expect(
      parseCsp(`
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self'; object-src 'none'" />
      `),
    ).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "object-src": ["'none'"],
    });
  });

  it("rejects a document without a policy", () => {
    expect(() => parseCsp("<title>Neolab.ai</title>")).toThrow("no CSP");
  });

  it("allows only Umami's exact script and collection hosts", () => {
    const policy = verifyCsp(productionIndex);
    expect(policy["script-src"]).toEqual(["'self'", "https://cloud.umami.is"]);
    expect(policy["connect-src"]).toEqual(["'self'", "https://gateway.umami.is"]);
  });

  it("rejects a wildcard Umami collection permission", () => {
    expect(() =>
      verifyCsp(
        productionIndex.replace("https://gateway.umami.is", "https://*.umami.is"),
      ),
    ).toThrow("CSP connect-src must be");
  });

  it("fails closed if privileged inspector code reaches production bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "neolab-release-inspector-"));
    try {
      mkdirSync(join(directory, "assets"));
      writeFileSync(join(directory, "index.html"), "<main>Neolab.ai</main>");
      writeFileSync(join(directory, "assets/app.js"), "console.log('ordinary app')");
      expect(() => verifyProductionExcludesDeveloperInspector(directory)).not.toThrow();

      writeFileSync(
        join(directory, "assets/debug.js"),
        "const marker = 'NEOLAB_PRIVILEGED_INSPECTOR_V1'",
      );
      expect(() => verifyProductionExcludesDeveloperInspector(directory)).toThrow(
        "privileged developer inspector",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
