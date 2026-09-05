import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "../../styles/game.css";
import { ResearchProgrammeCard } from "./research-workspace.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Programme = Parameters<typeof ResearchProgrammeCard>[0]["programme"];

function programme(name: string, index: number): Programme {
  return {
    programId: `programme:${String(index)}`,
    kind: "capability",
    name,
    shortName: name,
    description: `${name} research`,
    colour: ["#ff7b42", "#3699f6", "#ef72ae", "#f5c242"][index % 4]!,
    level: 96,
    momentumLabel: "Speculative",
    allocationLabel: "342 EFLOP/s",
    researchOutputMultiplier: 1.15,
    outputLedger: {
      totalMultiplier: 1.15,
      leadPercentagePoints: 0,
      diffusionPercentagePoints: 0,
      otherEffectCount: 1,
      lines: [],
    },
    assignedResearcherPercentagePoints: 0,
    diffusion: {
      percentagePoints: 0,
      ratePerSkillPoint: 0,
      label: "No knowledge diffusion",
      contributors: [],
    },
    milestones: [],
  };
}

describe("research programme grid in Chromium", () => {
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

  it("keeps seven programmes compact and contained at the narrow breakpoint", () => {
    const names = [
      "Architectures",
      "Multimodality",
      "Optimisation",
      "Reasoning",
      "RL and Agency",
      "Robotics",
      "Scientific AI",
    ];
    act(() =>
      root.render(
        <section className="research-domain-picker">
          <section className="research-domain-picker-capability">
            <div data-programme-count={names.length}>
              {names.map((name, index) => (
                <ResearchProgrammeCard
                  key={name}
                  programme={programme(name, index)}
                  allocationSharePercent={14}
                  selected={false}
                  onSelect={() => undefined}
                  onInspectLead={() => undefined}
                  onOpenPeople={() => undefined}
                />
              ))}
            </div>
          </section>
        </section>,
      ),
    );

    const grid = mount.querySelector<HTMLElement>("[data-programme-count='7']")!;
    const cards = [...grid.querySelectorAll<HTMLElement>(".research-programme-card")];
    const rows = Map.groupBy(cards, (card) =>
      Math.round(card.getBoundingClientRect().top),
    );
    expect([...rows.values()].map((row) => row.length)).toEqual([2, 2, 2, 1]);
    expect(cards.every((card) => card.scrollWidth === card.clientWidth)).toBe(true);

    const longTitle = cards[0]!.querySelector<HTMLElement>(
      ".research-programme-heading > strong",
    )!;
    expect(longTitle.title).toBe("Architectures");
    expect(getComputedStyle(longTitle).textOverflow).toBe("ellipsis");
  });
});
