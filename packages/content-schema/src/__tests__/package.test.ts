import { describe, expect, it } from "vitest";

import { CONTENT_SCHEMA_PACKAGE } from "../index.ts";

describe("content-schema package smoke", () => {
  it("exposes its public surface", () => {
    expect(CONTENT_SCHEMA_PACKAGE).toBe("@neolab/content-schema");
  });
});
