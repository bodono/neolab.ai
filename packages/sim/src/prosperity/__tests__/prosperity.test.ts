import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { FacilityId, LabId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import {
  PROSPERITY_PROGRAMMES,
  PROSPERITY_PROGRAMME_IDS,
  deriveProsperityProgrammes,
} from "../prosperity.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function fixture(): DeepMutable<GameState> {
  return structuredClone(
    createNewGame(
      {
        seed: seed128("cafebabecafebabecafebabecafebabe"),
        difficultyId: contentId("base:difficulty.standard"),
        leaderId: contentId("base:leader.thomas-hassabi"),
        mandateId: contentId("base:mandate.build-the-science"),
      },
      content,
    ),
  ) as DeepMutable<GameState>;
}

describe("Prosperity Programmes", () => {
  it("has the four canonical programmes in a deterministic order", () => {
    expect(PROSPERITY_PROGRAMME_IDS).toEqual([
      "medicine-biological-discovery",
      "clean-energy-climate-repair",
      "materials-manufacturing-abundance",
      "public-knowledge-institutions",
    ]);
    expect(
      Object.values(PROSPERITY_PROGRAMMES).map((programme) => programme.displayName),
    ).toEqual([
      "Medicine and biological discovery",
      "Clean energy and climate repair",
      "Materials, manufacturing, and abundance",
      "Public knowledge, education, and institutions",
    ]);
  });

  it("derives readiness from capped research, facilities, experts, and discoveries", () => {
    const state = fixture();
    state.run.phase = "scaling";
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    lab.research.domains["base:domain.scientific-ai"] = {
      level: rating(60),
      levelProgressRp: 0,
      totalResearchPoints: 0,
      weeklyMomentum: 0,
    };
    lab.research.domains["base:domain.architectures"] = {
      level: rating(40),
      levelProgressRp: 0,
      totalResearchPoints: 0,
      weeklyMomentum: 0,
    };
    lab.facilities.instances = [
      {
        id: "facility:scientific" as FacilityId,
        definitionId: contentId("base:facility.scientific-laboratory-1"),
        completedAt: tick(10),
        modifierIds: [],
      },
      {
        id: "facility:biofoundry" as FacilityId,
        definitionId: contentId("base:facility.biofoundry-1"),
        completedAt: tick(20),
        modifierIds: [],
      },
    ];
    const jon = Object.values(state.researchers).find(
      (researcher) => researcher.definitionId === "base:researcher.jon-jumper",
    );
    if (jon === undefined) throw new Error("Jon Jumper fixture missing");
    for (const researcher of Object.values(state.researchers)) {
      delete researcher.employerLabId;
      researcher.status = "available";
    }
    jon.employerLabId = lab.id;
    jon.status = "employed";
    jon.housing = "housed";
    lab.roster.researcherIds = [jon.id];
    lab.research.discoveredPaperIds = [
      contentId("base:paper.alphafold2-protein-structure"),
      contentId("base:paper.adaptive-oncogene-silencing-platform"),
    ];

    const medicine = deriveProsperityProgrammes(state, content, 6).find(
      (programme) => programme.id === "medicine-biological-discovery",
    );
    expect(medicine).toMatchObject({
      unlocked: true,
      research: 16.8,
      facilities: 20,
      experts: 7.5,
      discoveries: 34,
      baseReadiness: 78.3,
      crisisValidation: 6,
      readiness: 84.3,
    });
    expect(medicine?.facilitySources.map((source) => source.label)).toEqual([
      "Scientific Laboratory I",
      "Biofoundry",
    ]);
    expect(medicine?.expertSources.map((source) => source.label)).toEqual(["Jon Jumper"]);
    expect(medicine?.discoverySources.map((source) => source.amount)).toEqual([12, 22]);
  });

  it("counts a rival publication immediately but not a rival secret paper", () => {
    const state = fixture();
    const paperId = contentId("base:paper.alphafold2-protein-structure");
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    if (rivalId === undefined) throw new Error("Rival fixture missing");
    state.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: rivalId,
      discoveredAt: tick(4),
      publicationPolicy: "keep-secret",
      policyChosenAt: tick(4),
    };
    const mutableDiscovery = state.world.paperRace.discoveries[paperId];
    if (mutableDiscovery === undefined) throw new Error("Discovery fixture missing");

    const medicineSources = () =>
      deriveProsperityProgrammes(state, content)
        .find((programme) => programme.id === "medicine-biological-discovery")
        ?.discoverySources.map((source) => source.amount);
    expect(medicineSources()).toEqual([]);

    mutableDiscovery.publicationPolicy = "publish-openly";
    expect(medicineSources()).toEqual([12]);
  });

  it("finds a clearly labelled fictional future discovery for every programme", () => {
    for (const programme of Object.values(PROSPERITY_PROGRAMMES)) {
      const target = `prosperity.programme.${programme.effectSlug}.readiness`;
      const fixtures = Object.values(content.papers.definitions).filter(
        (paper) =>
          paper.historicity === "fictional-future" &&
          paper.fictionalLabel === "FICTIONAL FUTURE PAPER" &&
          paper.unlockEffects.some(
            (effect) =>
              effect.target === target &&
              effect.operation === "add" &&
              typeof effect.value === "number" &&
              effect.value > 0,
          ),
      );
      expect(fixtures.length, programme.id).toBeGreaterThan(0);
    }
  });
});
