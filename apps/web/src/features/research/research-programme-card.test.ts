import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProgrammeOutputLedger, ResearchProgrammeCard } from "./research-workspace.tsx";

type Programme = Parameters<typeof ResearchProgrammeCard>[0]["programme"];

const programme: Programme = {
  programId: "base:research-program.architectures",
  kind: "capability",
  name: "Architectures",
  shortName: "Architectures",
  description: "Builds the structures that make larger models useful.",
  colour: "#ff7b42",
  level: 8,
  momentumLabel: "Promising",
  allocationLabel: "860 TFLOP/s",
  researchOutputMultiplier: 1.25,
  outputLedger: {
    totalMultiplier: 1.25,
    leadPercentagePoints: 15,
    diffusionPercentagePoints: 5,
    otherEffectCount: 2,
    lines: [
      {
        group: "lead",
        sourceKind: "programme lead",
        sourceLabel: "Ada Exempler",
        effectLabel: "+15%",
        explanation: "Lead skill 5/5 adds +15% to the starting multiplier.",
        tone: "positive",
        temporary: false,
      },
      {
        group: "diffusion",
        sourceKind: "knowledge diffusion",
        sourceLabel: "Lin Example",
        effectLabel: "+5%",
        explanation: "Skill 5/5 contributes through the collaboration network.",
        tone: "positive",
        temporary: false,
      },
      {
        group: "effect",
        sourceKind: "facility",
        sourceLabel: "Collaboration Hall",
        effectLabel: "+10%",
        explanation: "Architectures research output is multiplied by 1.1.",
        tone: "positive",
        temporary: false,
      },
      {
        group: "effect",
        sourceKind: "decision outcome",
        sourceLabel: "Decision · Internal review",
        effectLabel: "−5%",
        explanation: "Capability research output is multiplied by 0.95.",
        tone: "negative",
        temporary: true,
        remainingWeeks: 7,
      },
    ],
  },
  assignedResearcherPercentagePoints: 15,
  diffusion: {
    percentagePoints: 5,
    ratePerSkillPoint: 0.5,
    label: "+5% from knowledge diffusion",
    contributors: [
      {
        name: "Ada Exempler",
        skill: 5,
        percentagePoints: 2.5,
      },
    ],
  },
  milestones: [],
};

describe("research programme card lead slot", () => {
  it("shows the lead portrait and the complete applied output breakdown", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearchProgrammeCard, {
        programme,
        allocationSharePercent: 14,
        selected: true,
        lead: {
          researcherId: "run:researcher:ada",
          displayName: "Ada Exempler",
          portraitAssetId: "base:portrait.ada",
          portraitAltText: "Pixel portrait of Ada Exempler",
        },
        onSelect: vi.fn(),
        onInspectLead: vi.fn(),
        onOpenPeople: vi.fn(),
      }),
    );
    const text = markup.replace(/<[^>]+>/g, "");

    expect(markup).toContain("Ada Exempler");
    expect(markup).toContain("programme-lead-portrait");
    expect(markup).toContain('<strong title="Architectures">Architectures</strong>');
    expect(text).toContain("LEVEL8/100");
    expect(text).toContain("NEXT · LEVEL 9");
    expect(text).toContain("Est. 34–62% · Promising");
    expect(text).toContain("RESEARCH COMPUTE860 TFLOP/sFLOP/s → level progress");
    expect(markup).toContain("left:34%");
    expect(markup).toContain("width:28%");
    expect(text).toContain("+25% total output");
    expect(text).toContain("lead +15%");
    expect(text).toContain("diffusion +5.0%");
    expect(text).toContain("effects +4.2%");
    expect(markup).toContain("Inspect or reassign Ada Exempler");

    const firstButton = markup.indexOf("<button");
    const firstButtonClose = markup.indexOf("</button>", firstButton);
    const secondButton = markup.indexOf("<button", firstButton + 1);
    expect(firstButtonClose).toBeLessThan(secondButton);
  });

  it("uses the empty portrait slot as a route to People", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearchProgrammeCard, {
        programme: {
          ...programme,
          researchOutputMultiplier: 1.05,
          assignedResearcherPercentagePoints: 0,
        },
        allocationSharePercent: 14,
        selected: false,
        onSelect: vi.fn(),
        onInspectLead: vi.fn(),
        onOpenPeople: vi.fn(),
      }),
    );
    const text = markup.replace(/<[^>]+>/g, "");

    expect(markup).toContain("programme-lead-slot empty");
    expect(text).toContain("Appoint lead");
    expect(text).toContain("+5.0% total output");
    expect(markup).toContain("Open People to appoint a lead for Architectures");
  });

  it("survives a stale pre-selector-update view during hot reload", () => {
    const staleProgramme = {
      ...programme,
      researchOutputMultiplier: undefined,
      assignedResearcherPercentagePoints: undefined,
      outputLedger: undefined,
    } as unknown as Programme;

    const markup = renderToStaticMarkup(
      createElement(ResearchProgrammeCard, {
        programme: staleProgramme,
        allocationSharePercent: 14,
        selected: false,
        onSelect: vi.fn(),
        onInspectLead: vi.fn(),
        onOpenPeople: vi.fn(),
      }),
    );
    const text = markup.replace(/<[^>]+>/g, "");

    expect(text).toContain("0% total output");
    expect(text).toContain("lead 0%");
    expect(text).toContain("diffusion 0%");
    expect(text).toContain("effects 0%");
    expect(text).not.toContain("NaN");
  });
});

describe("programme output ledger", () => {
  it("shows the canonical total and every positive and negative source", () => {
    const markup = renderToStaticMarkup(
      createElement(ProgrammeOutputLedger, { programme }),
    );
    const text = markup.replace(/<[^>]+>/g, "");

    expect(text).toContain("PROGRAMME OUTPUT");
    expect(text).toContain("+25% research output");
    expect(text).toContain("Lead +15% · diffusion +5.0% · 2 other effects");
    expect(text).toContain("4 sources");
    expect(text).toContain("Programme lead");
    expect(text).toContain("Knowledge diffusion");
    expect(text).toContain("Other bonuses &amp; penalties");
    expect(text).toContain("+4.2%");
    expect(text).toContain("Ada Exempler");
    expect(text).toContain("Lin Example");
    expect(text).toContain("Collaboration Hall");
    expect(text).toContain("Decision · Internal review");
    expect(text).toContain("+10%");
    expect(text).toContain("−5%");
    expect(text).toContain("7 weeks remaining");
    expect(text).toContain("Canonical total +25%");
    expect(markup).toContain('<li class="positive">');
    expect(markup).toContain('<li class="negative">');
  });

  it("survives a live runtime whose projector predates the source ledger", () => {
    const staleProgramme = {
      ...programme,
      outputLedger: undefined,
    } as unknown as Programme;
    const markup = renderToStaticMarkup(
      createElement(ProgrammeOutputLedger, { programme: staleProgramme }),
    );
    const text = markup.replace(/<[^>]+>/g, "");

    expect(text).toContain("+25% research output");
    expect(text).toContain("Refresh for details");
    expect(text).toContain("Detailed sources will appear after one page refresh");
    expect(text).not.toContain("NaN");
  });
});
