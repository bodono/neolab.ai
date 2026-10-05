/**
 * The setup page is long: leader cards, a dossier, mandates, difficulties and
 * the run seed. These cases mount it under the real stylesheet and check the
 * flow that keeps it legible: the selected leader is marked on its card, a
 * sticky summary bar carries the choices and the only launch button, the
 * dossier's profile opens with one paragraph, and at the end of the page the
 * bar settles below the run seed instead of covering it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";
import type { NewGameConfig } from "@neolab/sim/public";

import "../styles/game.css";
import {
  NEW_GAME_OPENING_STORAGE_KEY,
  NewGameScreen,
  type NewGameLaunchOptions,
} from "./new-game-screen.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const content = loadBrowserCompiledContent();

function summaryValue(mount: HTMLElement, label: string): string {
  const choice = [...mount.querySelectorAll<HTMLElement>(".setup-summary-choice")].find(
    (element) => element.querySelector("small")?.textContent === label,
  );
  return choice?.querySelector("strong")?.textContent ?? "";
}

function leaderRadio(mount: HTMLElement, name: string): HTMLButtonElement {
  const radio = [
    ...mount.querySelectorAll<HTMLButtonElement>(".leader-grid [role='radio']"),
  ].find((element) => element.querySelector(".leader-title")?.textContent === name);
  if (radio === undefined) throw new Error(`leader ${name} missing`);
  return radio;
}

describe("new-game setup flow in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;
  let onLaunch: Mock<(config: NewGameConfig, options: NewGameLaunchOptions) => void>;

  beforeEach(() => {
    window.localStorage.removeItem(NEW_GAME_OPENING_STORAGE_KEY);
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
    onLaunch = vi.fn<(config: NewGameConfig, options: NewGameLaunchOptions) => void>();
    act(() =>
      root.render(
        <NewGameScreen content={content} onBack={vi.fn()} onLaunch={onLaunch} />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    window.scrollTo(0, 0);
  });

  it("marks the chosen leader on its card and in the summary bar", () => {
    expect(summaryValue(mount, "Leader")).toBe("Dennis Hassabi");
    expect(summaryValue(mount, "Mandate")).toBe("Build the Science");
    expect(summaryValue(mount, "Difficulty")).toContain("Standard");

    const stan = leaderRadio(mount, "Stan Altmann");
    act(() => stan.click());

    expect(stan.getAttribute("aria-checked")).toBe("true");
    const badges = mount.querySelectorAll<HTMLElement>(".leader-card-badge");
    expect(badges).toHaveLength(1);
    expect(stan.contains(badges[0]!)).toBe(true);
    expect(badges[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(badges[0]!.getBoundingClientRect().width).toBeGreaterThan(0);
    // The badge is decoration: the radio's accessible name stays the card copy.
    expect(stan.textContent).toContain("Stan Altmann");
    expect(summaryValue(mount, "Leader")).toBe("Stan Altmann");

    const business = [...mount.querySelectorAll<HTMLButtonElement>(".mandate-card")].find(
      (card) => card.textContent?.includes("Build the Business"),
    )!;
    act(() => business.click());
    expect(summaryValue(mount, "Mandate")).toBe("Build the Business");

    const frontier = mount.querySelector<HTMLButtonElement>(
      ".difficulty-grid [role='radio'].hard",
    )!;
    act(() => frontier.click());
    expect(summaryValue(mount, "Difficulty")).toContain("Frontier");
  });

  it("keeps the single launch action in a sticky bar that ends below the seed", () => {
    const submits = mount.querySelectorAll<HTMLButtonElement>("button[type='submit']");
    expect(submits).toHaveLength(1);
    const launch = submits[0]!;
    expect(launch.textContent).toBe("Enter the lab →");
    const bar = launch.closest<HTMLElement>(".setup-summary-bar");
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-label")).toBe("Run summary");
    expect(getComputedStyle(bar!).position).toBe("sticky");

    window.scrollTo(0, document.documentElement.scrollHeight);
    const seed = mount.querySelector<HTMLInputElement>(".setup-options input")!;
    expect(seed.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      bar!.getBoundingClientRect().top,
    );

    act(() => leaderRadio(mount, "Mario Amodeo").click());
    act(() => launch.click());
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch.mock.calls[0]![0]).toMatchObject({
      leaderId: "base:leader.dario-amodeo",
      mandateId: "base:mandate.build-the-science",
      difficultyId: "base:difficulty.standard",
    });
  });

  it("opens with the guided chapters unless the player unlocks everything", () => {
    const launch = mount.querySelector<HTMLButtonElement>("button[type='submit']")!;
    const opening = (name: string) =>
      [
        ...mount.querySelectorAll<HTMLButtonElement>(
          "[aria-label='Opening'] [role='radio']",
        ),
      ].find(
        (element) => element.querySelector(".difficulty-name")?.textContent === name,
      )!;
    expect(opening("Guided chapters").getAttribute("aria-checked")).toBe("true");

    act(() => launch.click());
    expect(onLaunch.mock.calls[0]![1]).toEqual({ opening: "progressive" });

    act(() => opening("Everything unlocked").click());
    act(() => launch.click());
    expect(onLaunch.mock.calls[1]![1]).toEqual({ opening: "classic" });
    // The choice is remembered for the next run.
    expect(window.localStorage.getItem(NEW_GAME_OPENING_STORAGE_KEY)).toBe("classic");
  });

  it("jumps from a summary choice back to its current selection", () => {
    const mandateChoice = [
      ...mount.querySelectorAll<HTMLButtonElement>(".setup-summary-choice"),
    ].find((element) => element.querySelector("small")?.textContent === "Mandate")!;
    act(() => mandateChoice.click());
    expect(document.activeElement?.classList.contains("mandate-card")).toBe(true);
    expect(document.activeElement?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the profile with one paragraph and keeps the rest and sources reachable", () => {
    const biography = mount.querySelector<HTMLElement>(
      ".leader-detail .dossier-biography",
    )!;
    const lead = biography.querySelector<HTMLParagraphElement>(":scope > p")!;
    const more = biography.querySelector<HTMLDetailsElement>(".dossier-biography-more")!;
    const later = more.querySelector<HTMLParagraphElement>("p")!;

    expect(lead.checkVisibility()).toBe(true);
    expect(more.open).toBe(false);
    expect(later.checkVisibility()).toBe(false);
    expect(more.querySelector("summary")?.innerText).toBe("Read full profile");
    // A readable measure: the paragraph is capped near 70 characters a line.
    expect(getComputedStyle(lead).maxWidth).toBe("510px");

    act(() => more.querySelector("summary")!.click());
    expect(more.open).toBe(true);
    expect(later.checkVisibility()).toBe(true);
    expect(more.querySelector("summary")?.innerText).toBe("Show less");

    const sources = mount.querySelector<HTMLDetailsElement>(
      ".leader-detail .real-world-profile-sources",
    )!;
    expect(sources.querySelector("summary")?.textContent).toMatch(/cited sources?$/);
    expect(sources.querySelectorAll("a[href^='http']").length).toBeGreaterThan(0);
  });
});
