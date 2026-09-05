import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";

import type { BrowserContent } from "../app/runtime-provider.tsx";
import { NewGameScreen } from "./new-game-screen.tsx";

describe("new-game leader attribution", () => {
  it("shows the real inspiration and sourced summary on selection and detail", () => {
    const base = loadBrowserCompiledContent();
    const selectedId = "base:leader.thomas-hassabi";
    const summary =
      "co-founded a documented research lab and led a cited scientific programme.";
    const content: BrowserContent = {
      ...base,
      leaders: Object.fromEntries(
        Object.entries(base.leaders).map(([id, leader]) => [
          id,
          id === selectedId ? { ...leader, inspirationSummary: summary } : leader,
        ]),
      ),
    };

    const markup = renderToStaticMarkup(
      createElement(NewGameScreen, {
        content,
        onBack: vi.fn(),
        onLaunch: vi.fn(),
      }),
    );

    const selected = content.leaders[selectedId];
    if (selected === undefined) throw new Error("leader fixture missing");
    expect(markup).toContain("REAL-WORLD PROFILE");
    expect(markup).toContain(selected.inspirationName);
    expect(markup).toContain(summary);
    expect(markup).toContain('class="dossier-biography"');
    expect(markup).toContain("The character’s gameplay");
    expect(markup).not.toContain("Continue real-world profile");
  });
});
