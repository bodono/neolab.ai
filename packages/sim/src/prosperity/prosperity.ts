import type { CompiledContent, PaperDefinition } from "@neolab/content-schema";

import type { GameState, ProsperityProgrammeId } from "../model/state.ts";
import { isPublicPaperDiscovery } from "../research/papers.ts";
export type { ProsperityProgrammeId } from "../model/state.ts";

export interface ProsperityProgrammeDefinition {
  readonly id: ProsperityProgrammeId;
  readonly effectSlug: "medicine" | "clean-energy" | "materials" | "public-knowledge";
  readonly displayName: string;
  readonly shortName: string;
  readonly description: string;
  readonly researchWeights: Readonly<Record<string, number>>;
  readonly expertSkillWeights: Readonly<Record<string, number>>;
  readonly facilityTagWeights: Readonly<Record<string, number>>;
  readonly precursorTagWeights: Readonly<Record<string, number>>;
  readonly demonstrationDifficulty: number;
}

const SCIENTIFIC_AI = "base:domain.scientific-ai";
const ARCHITECTURES = "base:domain.architectures";
const OPTIMISATION_SCALING = "base:domain.optimisation-scaling";
const ROBOTICS_EMBODIMENT = "base:domain.robotics-embodiment";
const REASONING_TOOLS = "base:domain.reasoning-tools";
const MULTIMODALITY = "base:domain.multimodality";

/**
 * Closed code-owned programme registry. Authored discoveries and facilities contribute through
 * tags/effects, so adding content does not require changing the simulation formula.
 */
export const PROSPERITY_PROGRAMMES: Readonly<
  Record<ProsperityProgrammeId, ProsperityProgrammeDefinition>
> = {
  "medicine-biological-discovery": {
    id: "medicine-biological-discovery",
    effectSlug: "medicine",
    displayName: "Medicine and biological discovery",
    shortName: "Medicine",
    description:
      "Validated biological discovery, therapeutic design, and delivery capacity—not a press-release cure.",
    researchWeights: { [SCIENTIFIC_AI]: 0.8, [ARCHITECTURES]: 0.2 },
    expertSkillWeights: { scientificAi: 0.7, dataRepresentation: 0.3 },
    facilityTagWeights: { prosperity: 4, science: 4, medicine: 12 },
    precursorTagWeights: { "prosperity-medicine": 8, medicine: 4 },
    demonstrationDifficulty: 68,
  },
  "clean-energy-climate-repair": {
    id: "clean-energy-climate-repair",
    effectSlug: "clean-energy",
    displayName: "Clean energy and climate repair",
    shortName: "Energy & climate",
    description:
      "Energy control, carbon removal, and infrastructure prepared for an independently checked demonstration.",
    researchWeights: { [SCIENTIFIC_AI]: 0.75, [OPTIMISATION_SCALING]: 0.25 },
    expertSkillWeights: { scientificAi: 0.7, optimisationScaling: 0.3 },
    facilityTagWeights: { prosperity: 4, science: 4, energy: 12 },
    precursorTagWeights: {
      "prosperity-climate": 8,
      "clean-energy": 5,
      climate: 4,
    },
    demonstrationDifficulty: 60,
  },
  "materials-manufacturing-abundance": {
    id: "materials-manufacturing-abundance",
    effectSlug: "materials",
    displayName: "Materials, manufacturing, and abundance",
    shortName: "Materials & abundance",
    description:
      "New materials and bounded physical production with the factories, robotics, and controls to deliver them.",
    researchWeights: { [SCIENTIFIC_AI]: 0.55, [ROBOTICS_EMBODIMENT]: 0.45 },
    expertSkillWeights: { scientificAi: 0.5, roboticsEmbodiment: 0.5 },
    facilityTagWeights: { prosperity: 4, science: 4, manufacturing: 12 },
    precursorTagWeights: {
      "prosperity-materials": 8,
      "materials-discovery": 8,
      materials: 4,
      manufacturing: 4,
      prosperity: 3,
    },
    demonstrationDifficulty: 66,
  },
  "public-knowledge-institutions": {
    id: "public-knowledge-institutions",
    effectSlug: "public-knowledge",
    displayName: "Public knowledge, education, and institutions",
    shortName: "Public knowledge",
    description:
      "Education and public reasoning tools paired with institutions capable of distributing access fairly.",
    researchWeights: {
      [REASONING_TOOLS]: 0.65,
      [MULTIMODALITY]: 0.35,
    },
    expertSkillWeights: {
      reasoningTools: 0.35,
      multimodality: 0.25,
      product: 0.2,
      politics: 0.2,
    },
    facilityTagWeights: { "public-institution": 12 },
    precursorTagWeights: { "public-knowledge": 8, education: 4 },
    demonstrationDifficulty: 56,
  },
};

export const PROSPERITY_PROGRAMME_IDS = Object.freeze(
  Object.keys(PROSPERITY_PROGRAMMES) as ProsperityProgrammeId[],
);

export interface FacilityProsperityReadinessContribution {
  readonly programmeId: ProsperityProgrammeId;
  readonly programmeName: string;
  readonly amount: number;
}

/**
 * Exact readiness added by one operational facility. Shared by the rules and
 * facility presentation so a tooltip cannot drift away from the endgame
 * calculation.
 */
export function facilityProsperityReadinessContributions(
  facilityTags: readonly string[],
): readonly FacilityProsperityReadinessContribution[] {
  return PROSPERITY_PROGRAMME_IDS.flatMap((programmeId) => {
    const definition = PROSPERITY_PROGRAMMES[programmeId];
    const amount = Object.entries(definition.facilityTagWeights).reduce(
      (sum, [tag, weight]) => sum + (facilityTags.includes(tag) ? weight : 0),
      0,
    );
    return amount <= 0
      ? []
      : [
          {
            programmeId,
            programmeName: definition.shortName,
            amount,
          },
        ];
  });
}

export interface ProsperityContributionSource {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
}

export interface ProsperityProgrammeReadiness {
  readonly id: ProsperityProgrammeId;
  readonly displayName: string;
  readonly shortName: string;
  readonly description: string;
  readonly unlocked: boolean;
  readonly research: number;
  readonly facilities: number;
  readonly experts: number;
  readonly discoveries: number;
  readonly crisisValidation: number;
  readonly baseReadiness: number;
  readonly readiness: number;
  readonly demonstrationDifficulty: number;
  readonly facilitySources: readonly ProsperityContributionSource[];
  readonly expertSources: readonly ProsperityContributionSource[];
  readonly discoverySources: readonly ProsperityContributionSource[];
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function weightedLevel(
  values: Readonly<Record<string, { readonly level: number }>>,
  weights: Readonly<Record<string, number>>,
): number {
  return Object.entries(weights).reduce(
    (total, [id, weight]) => total + (values[id]?.level ?? 0) * weight,
    0,
  );
}

function facilityContributions(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: ProsperityProgrammeDefinition,
): readonly ProsperityContributionSource[] {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return [];
  return lab.facilities.instances.flatMap((instance) => {
    const facility = content.facilities[instance.definitionId];
    if (facility === undefined) return [];
    const amount =
      facilityProsperityReadinessContributions(facility.tags).find(
        (contribution) => contribution.programmeId === definition.id,
      )?.amount ?? 0;
    return amount <= 0
      ? []
      : [
          {
            id: instance.id ?? instance.definitionId,
            label: facility.displayName,
            amount,
          },
        ];
  });
}

function expertContributions(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: ProsperityProgrammeDefinition,
): readonly ProsperityContributionSource[] {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return [];
  return lab.roster.researcherIds
    .flatMap((researcherId) => {
      const researcher = state.researchers[researcherId];
      const authored =
        researcher === undefined
          ? undefined
          : content.researchers.definitions[researcher.definitionId];
      if (
        researcher === undefined ||
        authored === undefined ||
        researcher.status !== "employed" ||
        researcher.employerLabId !== lab.id ||
        researcher.housing !== "housed"
      ) {
        return [];
      }
      const weightedSkill = Object.entries(definition.expertSkillWeights).reduce(
        (sum, [skill, weight]) => sum + (authored.skills[skill] ?? 0) * weight,
        0,
      );
      // Skill 1–2 is useful background; a flagship programme requires genuine domain depth.
      const amount = rounded(clamp((weightedSkill - 2) * 2.5, 0, 7.5));
      return amount <= 0
        ? []
        : [{ id: researcher.id, label: authored.displayName, amount }];
    })
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .slice(0, 2);
}

function explicitDiscoveryContribution(
  paper: Readonly<PaperDefinition>,
  definition: ProsperityProgrammeDefinition,
): number {
  const target = `prosperity.programme.${definition.effectSlug}.readiness`;
  return paper.unlockEffects.reduce((sum, effect) => {
    return effect.target === target &&
      effect.operation === "add" &&
      typeof effect.value === "number"
      ? sum + effect.value
      : sum;
  }, 0);
}

function discoveryContributions(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: ProsperityProgrammeDefinition,
): readonly ProsperityContributionSource[] {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return [];
  const knownPaperIds = [
    ...lab.research.discoveredPaperIds,
    ...Object.values(state.world.paperRace.discoveries)
      .filter(isPublicPaperDiscovery)
      .map((discovery) => discovery.paperId),
  ].filter((paperId, index, all) => all.indexOf(paperId) === index);
  return knownPaperIds.flatMap((paperId) => {
    const paper = content.papers.definitions[paperId];
    if (paper === undefined) return [];
    const explicit = explicitDiscoveryContribution(paper, definition);
    const precursor = Object.entries(definition.precursorTagWeights).reduce(
      (best, [tag, amount]) => (paper.tags.includes(tag) ? Math.max(best, amount) : best),
      0,
    );
    // Explicit readiness effects already include the paper's precursor value.
    const amount = explicit > 0 ? explicit : precursor;
    return amount <= 0 ? [] : [{ id: paper.id, label: paper.title, amount }];
  });
}

/** Pure readiness derivation. Score is never stored and cannot drift from its sources. */
export function deriveProsperityProgrammes(
  state: Readonly<GameState>,
  content: CompiledContent,
  crisisValidation = 0,
): readonly ProsperityProgrammeReadiness[] {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return [];
  return PROSPERITY_PROGRAMME_IDS.map((id) => {
    const definition = PROSPERITY_PROGRAMMES[id];
    const researchLevel = weightedLevel(lab.research.domains, definition.researchWeights);
    const research = rounded(clamp(researchLevel * 0.3, 0, 30));
    const facilitySources = facilityContributions(state, content, definition);
    const expertSources = expertContributions(state, content, definition);
    const discoverySources = discoveryContributions(state, content, definition);
    const facilities = rounded(
      clamp(
        facilitySources.reduce((sum, source) => sum + source.amount, 0),
        0,
        20,
      ),
    );
    const experts = rounded(
      clamp(
        expertSources.reduce((sum, source) => sum + source.amount, 0),
        0,
        15,
      ),
    );
    const discoveries = rounded(
      clamp(
        discoverySources.reduce((sum, source) => sum + source.amount, 0),
        0,
        35,
      ),
    );
    const baseReadiness = rounded(clamp(research + facilities + experts + discoveries));
    const validation = rounded(clamp(crisisValidation, 0, 100 - baseReadiness));
    const readiness = rounded(clamp(baseReadiness + validation));
    const unlocked =
      state.run.phase !== "foundation" ||
      researchLevel >= 20 ||
      facilities > 0 ||
      discoveries > 0;
    return {
      id,
      displayName: definition.displayName,
      shortName: definition.shortName,
      description: definition.description,
      unlocked,
      research,
      facilities,
      experts,
      discoveries,
      crisisValidation: validation,
      baseReadiness,
      readiness,
      demonstrationDifficulty: definition.demonstrationDifficulty,
      facilitySources,
      expertSources,
      discoverySources,
    };
  });
}

export function bestProsperityProgramme(
  state: Readonly<GameState>,
  content: CompiledContent,
  crisisValidation = 0,
): ProsperityProgrammeReadiness {
  const programmes = deriveProsperityProgrammes(state, content, crisisValidation);
  const best = [...programmes]
    .filter((programme) => programme.unlocked)
    .sort(
      (left, right) =>
        right.readiness - left.readiness ||
        PROSPERITY_PROGRAMME_IDS.indexOf(left.id) -
          PROSPERITY_PROGRAMME_IDS.indexOf(right.id),
    )[0];
  if (best !== undefined) return best;
  const fallback = programmes[0];
  if (fallback === undefined) throw new Error("Prosperity programme registry is empty");
  return fallback;
}

export function findProsperityProgramme(
  state: Readonly<GameState>,
  content: CompiledContent,
  id: ProsperityProgrammeId,
  crisisValidation = 0,
): ProsperityProgrammeReadiness {
  const programme = deriveProsperityProgrammes(state, content, crisisValidation).find(
    (candidate) => candidate.id === id,
  );
  if (programme === undefined) throw new Error(`Unknown Prosperity Programme ${id}`);
  return programme;
}
