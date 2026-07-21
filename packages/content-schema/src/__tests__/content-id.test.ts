import { describe, expect, it } from "vitest";

import { contentId, isContentId } from "../content-id.ts";

describe("contentId", () => {
  it("accepts namespaced dotted IDs", () => {
    expect(contentId("base:leader.thomas_hassabi")).toBe("base:leader.thomas_hassabi");
    expect(contentId("base:event.ai.root_access_request")).toBe(
      "base:event.ai.root_access_request",
    );
    expect(contentId("base:paper.attention_is_all_you_need")).toBe(
      "base:paper.attention_is_all_you_need",
    );
    expect(contentId("expansion-1:lab.sixth_lab")).toBe("expansion-1:lab.sixth_lab");
  });

  it("rejects malformed IDs", () => {
    for (const bad of [
      "",
      "no-namespace",
      "Base:leader.thomas", // upper case
      "base:", // empty name
      ":leader.thomas", // empty namespace
      "base:leader thomas", // whitespace
      "base:leader.thomas!", // punctuation
      "base::leader.thomas", // double separator is not a valid name start
    ]) {
      expect(isContentId(bad), bad).toBe(false);
      expect(() => contentId(bad), bad).toThrow(RangeError);
    }
  });
});
