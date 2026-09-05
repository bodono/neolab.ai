import { describe, expect, it } from "vitest";

import { formatEventMessage } from "../message-format.ts";

describe("formatEventMessage", () => {
  it("formats named tokens, locale-aware numbers, and nested ICU plurals", () => {
    expect(
      formatEventMessage(
        "{AI_NAME} requested {GPU_COUNT, number} {GPU_COUNT, plural, one {GPU} other {GPUs}}; {WEEK_COUNT, plural, =0 {the deadline is now} one {# week remains} other {# weeks remain}}.",
        { AI_NAME: "GBT", GPU_COUNT: 12_000, WEEK_COUNT: 2 },
      ),
    ).toBe("GBT requested 12,000 GPUs; 2 weeks remain.");
  });

  it("rejects missing tokens, invalid formatter types, malformed braces, and HTML", () => {
    expect(() => formatEventMessage("Hello {RESEARCHER}", {})).toThrow(
      "missing token RESEARCHER",
    );
    expect(() => formatEventMessage("{COUNT, date}", { COUNT: 2 })).toThrow(
      "Unsupported event message formatter",
    );
    expect(() => formatEventMessage("{COUNT", { COUNT: 2 })).toThrow(
      "unmatched opening brace",
    );
    expect(() => formatEventMessage("<strong>Warning</strong>", {})).toThrow(
      "cannot contain raw HTML",
    );
  });
});
