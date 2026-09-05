import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PeopleResearchSkillView } from "@neolab/sim/public";

import "../../styles/game.css";
import { ResearchSkillProfile } from "./people-workspace.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const skills: readonly PeopleResearchSkillView[] = [
  {
    programmeId: "programme:architectures",
    skillKey: "architectures",
    label: "Architectures",
    kind: "capability",
    level: 5,
    maximumLevel: 5,
    leadOutputBonusPercent: 15,
  },
  {
    programmeId: "programme:interpretability",
    skillKey: "interpretability",
    label: "Interpretability and Evals",
    kind: "safety",
    level: 3,
    maximumLevel: 5,
    leadOutputBonusPercent: 9,
  },
];

describe("compact research skill profile in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("shows left-to-right 0–5 quantity bars for the best lead fits", () => {
    act(() => root.render(<ResearchSkillProfile skills={skills} compact />));

    const meters = [...mount.querySelectorAll<HTMLElement>("[role='meter']")];
    expect(meters).toHaveLength(2);
    expect(meters.map((meter) => meter.getAttribute("aria-valuenow"))).toEqual([
      "5",
      "3",
    ]);
    expect(
      meters.map((meter) => meter.querySelector<HTMLElement>("i")?.style.width),
    ).toEqual(["100%", "60%"]);
    expect(getComputedStyle(meters[0]!).height).toBe("4px");
  });
});
