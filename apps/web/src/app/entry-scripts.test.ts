import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(
  fileURLToPath(new URL("../../index.html", import.meta.url)),
  "utf8",
);

describe("application entry scripts", () => {
  // A second page-level module once scraped the campus DOM and set
  // position:absolute on whatever text-matched a "star researcher card",
  // which collapsed the campus map for real players while every component
  // test and the profile-fixture e2e stayed green. The React tree is the only
  // thing allowed to touch the rendered game; keep the entry list to one.
  it("loads the React entry and nothing else as a module script", () => {
    const scripts = [...indexHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(scripts).toEqual(["/src/main.tsx"]);
  });
});
