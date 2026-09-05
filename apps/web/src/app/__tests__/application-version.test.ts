import { describe, expect, it } from "vitest";

import { resolveApplicationVersion } from "../application-version.tsx";

describe("resolveApplicationVersion", () => {
  it("reports the released tag without its leading v", () => {
    expect(resolveApplicationVersion("v1.2.3", "0.0.0")).toBe("1.2.3");
  });

  it("accepts a tag that carries no leading v", () => {
    expect(resolveApplicationVersion("1.2.3", "0.0.0")).toBe("1.2.3");
  });

  it("falls back to the package version for an untagged build", () => {
    expect(resolveApplicationVersion(undefined, "0.0.0")).toBe("0.0.0");
  });

  it("treats an empty or blank tag as untagged", () => {
    // The deploy workflow passes an empty string on its non-tag paths rather
    // than omitting the variable, so blank has to mean untagged.
    expect(resolveApplicationVersion("", "0.0.0")).toBe("0.0.0");
    expect(resolveApplicationVersion("   ", "0.0.0")).toBe("0.0.0");
  });

  it("keeps prerelease and build suffixes intact", () => {
    expect(resolveApplicationVersion("v2.0.0-rc.1", "0.0.0")).toBe("2.0.0-rc.1");
  });
});
