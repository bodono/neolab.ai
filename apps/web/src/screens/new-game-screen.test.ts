import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";

import type { BrowserContent } from "../app/runtime-provider.tsx";
import {
  initialNewGameOpening,
  NEW_GAME_OPENING_STORAGE_KEY,
  NewGameScreen,
} from "./new-game-screen.tsx";

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
    // The full profile stays in the page, behind a disclosure after its first paragraph.
    expect(markup).toContain("Read full profile");
    const laterParagraph = selected.biography.split(/\n+/u)[1]?.trim();
    expect(laterParagraph).toBeTruthy();
    expect(markup).toContain(laterParagraph!.slice(0, 40));
    expect(markup).toContain("The character’s gameplay");
    expect(markup).not.toContain("Continue real-world profile");
  });
});

describe("new-game opening preselection", () => {
  const storage = (value: string | null): Storage =>
    ({
      getItem: (key: string) => (key === NEW_GAME_OPENING_STORAGE_KEY ? value : null),
    }) as unknown as Storage;

  it("defaults to the guided chapters", () => {
    expect(initialNewGameOpening("", storage(null))).toBe("progressive");
    expect(initialNewGameOpening("", undefined)).toBe("progressive");
  });

  it("remembers an unlocked opening and honours ?campaign=classic", () => {
    expect(initialNewGameOpening("", storage("classic"))).toBe("classic");
    expect(initialNewGameOpening("?campaign=classic", storage(null))).toBe("classic");
  });

  it("falls back to the chapters when storage is unavailable", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(initialNewGameOpening("", blocked)).toBe("progressive");
  });
});
