import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MechanicHelp } from "./mechanic-help.tsx";

describe("MechanicHelp", () => {
  it("uses a tappable, keyboard-accessible disclosure instead of hover alone", () => {
    const markup = renderToStaticMarkup(
      createElement(MechanicHelp, {
        label: "Major-project slots",
        children: "Queued work starts when a slot opens.",
      }),
    );

    expect(markup).toContain('<details class="mechanic-help">');
    expect(markup).toContain('aria-label="Explain Major-project slots"');
    expect(markup).toContain('<div role="note">');
    expect(markup).toContain("Queued work starts when a slot opens.");
  });
});
