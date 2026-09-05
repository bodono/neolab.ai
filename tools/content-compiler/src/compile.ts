import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  authoringManifestSchema,
  assetManifestFileSchema,
  aiCapabilityTiersFileSchema,
  balanceFileSchema,
  isKnownEffectTarget,
  scoringFileSchema,
  contentId,
  facilitiesFileSchema,
  gpuGenerationsFileSchema,
  marketFileSchema,
  MODIFIER_TARGET_LIST,
  researchDomainsFileSchema,
  isContentId,
  landmarkPapersFileSchema,
  starResearchersFileSchema,
  starResearcherRulesFileSchema,
  launchLeadersFileSchema,
  type AuthoredEffect,
  type AuthoredResearcherModifier,
  type CompiledContent,
  type ContentId,
  type DifficultyDefinition,
  type FacilityDefinition,
  type GenericAdvanceDefinition,
  type GpuGenerationDefinition,
  type LabDefinition,
  type LeaderDefinition,
  type MandateDefinition,
  type MarketDefinition,
  type NamedEffectGroup,
  type NewGameBalance,
  type PaperDefinition,
  type PaperPrerequisitePredicate,
  type PapersDefinition,
  type ResearchDefinition,
  type ResearcherAbilityDefinition,
  type ResearcherCompactCheckDefinition,
  type ResearcherDefinition,
  type ResearcherModifierDefinition,
  type ResearcherRulesDefinition,
  type ResearcherUnlockDefinition,
  type ResearchProgramDefinition,
  type ScoreRulesDefinition,
} from "@neolab/content-schema";
import type { z } from "zod";

import {
  collectReleaseCopyFiles,
  createContentReleaseReport,
  type ContentReleaseReport,
} from "./release-validation.ts";
import { compileAssetCatalogue } from "./assets.ts";
import { compileCopyCatalogue, compileEventCatalogue } from "./events.ts";
import { ContentFileError, parseYamlFile } from "./yaml-io.ts";

export interface CompileResult {
  readonly bundle: CompiledContent;
  readonly outputPath: string;
  readonly report: ContentReleaseReport;
  readonly reportPath: string;
}

/**
 * Canonicalise a draft authoring ID (TDD section 5.3):
 *   leader-thomas-hassabi -> base:leader.thomas-hassabi
 *   lab-deepbrain         -> base:lab.deepbrain
 *   gpu.kepler            -> base:gpu.kepler
 * Already-canonical IDs pass through unchanged.
 */
export function canonicalId(draft: string, filePath: string): ContentId {
  if (draft.includes(":")) {
    if (!isContentId(draft)) {
      throw new ContentFileError(filePath, undefined, undefined, `invalid ID "${draft}"`);
    }
    return contentId(draft);
  }
  const typeDash =
    /^(leader|lab|facility|paper|event|researcher|capability-tier)-(.+)$/.exec(draft);
  if (typeDash !== null) {
    return contentId(`base:${typeDash[1] ?? ""}.${typeDash[2] ?? ""}`);
  }
  if (draft.includes(".")) {
    return contentId(`base:${draft}`);
  }
  throw new ContentFileError(
    filePath,
    undefined,
    undefined,
    `cannot canonicalise draft ID "${draft}"`,
  );
}

function parseWith<S extends z.ZodType>(schema: S, filePath: string): z.infer<S> {
  const raw = parseYamlFile(filePath);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined ? "" : issue.path.join(".");
    const message = issue === undefined ? "invalid file" : issue.message;
    throw new ContentFileError(
      filePath,
      undefined,
      undefined,
      `schema violation at "${path}": ${message}`,
    );
  }
  return parsed.data;
}

function normaliseReviewDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function normaliseOptionalReviewDate(
  value: string | Date | null | undefined,
  fallback: string | null,
): string | null {
  return value === undefined
    ? fallback
    : value === null
      ? null
      : normaliseReviewDate(value);
}

/** Recursively sort object keys so the bundle is byte-reproducible. */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, canonicalise(child)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function canonicaliseEffects(
  effects: readonly AuthoredEffect[],
  filePath: string,
): readonly AuthoredEffect[] {
  // Targets are registry keys, not content IDs; validate against the closed
  // registry (TDD 11.2: "The content compiler rejects unknown targets").
  for (const effect of effects) {
    if (!isKnownEffectTarget(effect.target)) {
      throw new ContentFileError(
        filePath,
        undefined,
        undefined,
        `unknown effect target "${effect.target}" — add it to effect-targets.ts or fix the record`,
      );
    }
  }
  return effects;
}

const GENERIC_ADVANCE_STAGE_SCOPES = [
  "This begins as a contained pilot with one research group.",
  "The practice is shared across the programme and backed by dedicated staff.",
  "It becomes a lab-wide standard with measured adoption.",
  "It is hardened for production-scale research and model training.",
  "It becomes a frontier programme with its own budget and review cadence.",
  "It is integrated across the institution rather than left to one team.",
  "It is automated for large-scale operation and continuous measurement.",
  "It is adapted for model-assisted research while retaining human controls.",
  "It is hardened for recursive-improvement conditions and adversarial pressure.",
  "It becomes a permanent doctrine for the lab's approach to advanced AI.",
] as const;

const GENERIC_ADVANCE_STAGE_SCALES = [
  1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25,
] as const;

function genericAdvanceStageValue<T>(
  values: readonly T[],
  stageIndex: number,
  label: string,
  filePath: string,
): T {
  const value = values[stageIndex];
  if (value === undefined) {
    throw new ContentFileError(
      filePath,
      undefined,
      undefined,
      `${label}: missing authored value for generic advance stage ${String(stageIndex + 1)}`,
    );
  }
  return value;
}

function scaleGenericAdvanceEffects(
  effects: readonly AuthoredEffect[],
  stageIndex: number,
  filePath: string,
): readonly AuthoredEffect[] {
  const scale = genericAdvanceStageValue(
    GENERIC_ADVANCE_STAGE_SCALES,
    stageIndex,
    "generic advance effect scale",
    filePath,
  );
  for (const effect of effects) {
    const routed = effect.target.replace(
      /^lab\.research\.domain\.([a-z0-9-]+)\.output$/,
      "lab.research.program.base:domain.$1.output",
    );
    if (!isKnownEffectTarget(routed)) {
      throw new ContentFileError(
        filePath,
        undefined,
        undefined,
        `unknown generic advance effect target ${effect.target}`,
      );
    }
  }
  return effects.map((effect) => {
    let value = effect.value;
    if (effect.operation === "multiply") {
      value = 1 + (value - 1) * scale;
    } else if (effect.operation === "add") {
      value *= scale;
    }
    return { ...effect, value: Math.round(value * 1_000_000) / 1_000_000 };
  });
}

function combineGenericAdvanceStageEffects(
  effects: readonly AuthoredEffect[],
  firstStageIndex: number,
  secondStageIndex: number,
  filePath: string,
): readonly AuthoredEffect[] {
  const first = scaleGenericAdvanceEffects(effects, firstStageIndex, filePath);
  const second = scaleGenericAdvanceEffects(effects, secondStageIndex, filePath);
  return first.map((effect, index) => {
    const paired = second[index];
    if (
      paired === undefined ||
      paired.target !== effect.target ||
      paired.operation !== effect.operation
    ) {
      throw new ContentFileError(
        filePath,
        undefined,
        undefined,
        `generic advance effect ${String(index + 1)} cannot be paired across stages`,
      );
    }
    let value: number;
    switch (effect.operation) {
      case "multiply":
        value = effect.value * paired.value;
        break;
      case "add":
        value = effect.value + paired.value;
        break;
      case "min":
        value = Math.min(effect.value, paired.value);
        break;
      case "max":
        value = Math.max(effect.value, paired.value);
        break;
    }
    return { ...effect, value: Math.round(value * 1_000_000) / 1_000_000 };
  });
}

export function compileContent(repoRoot: string): CompileResult {
  const contentDir = join(repoRoot, "content");

  const manifestPath = join(contentDir, "manifest.yaml");
  const manifest = parseWith(authoringManifestSchema, manifestPath);
  const assetManifestPath = join(repoRoot, "design", "assets", "manifest.yaml");
  const assetManifest = parseWith(assetManifestFileSchema, assetManifestPath);
  const assets = compileAssetCatalogue(repoRoot, assetManifest, assetManifestPath);

  // ----- Leaders and labs ---------------------------------------------------
  const leadersPath = join(contentDir, "labs", "launch.yaml");
  const leadersFile = parseWith(launchLeadersFileSchema, leadersPath);

  const leaders: Record<string, LeaderDefinition> = {};
  const labs: Record<string, LabDefinition> = {};
  for (const authored of leadersFile.leaders) {
    const leaderId = canonicalId(authored.id, leadersPath);
    const labId = canonicalId(authored.company.id, leadersPath);
    if (leaderId in leaders) {
      throw new ContentFileError(
        leadersPath,
        undefined,
        undefined,
        `duplicate leader ID ${leaderId}`,
      );
    }
    if (labId in labs) {
      throw new ContentFileError(
        leadersPath,
        undefined,
        undefined,
        `lab ${labId} belongs to two leaders`,
      );
    }
    const bonus = authored.headlineBonus;
    let headlineBonus: NamedEffectGroup;
    if ("effects" in bonus) {
      headlineBonus = {
        id: bonus.id,
        label: bonus.label,
        effects: canonicaliseEffects(bonus.effects, leadersPath),
      };
    } else if ("targets" in bonus) {
      headlineBonus = {
        id: bonus.id,
        label: bonus.label,
        effects: bonus.targets.map((target) => ({
          target,
          operation: bonus.operation,
          value: bonus.value,
        })),
      };
    } else {
      headlineBonus = {
        id: bonus.id,
        label: bonus.label,
        effects: [
          { target: bonus.target, operation: bonus.operation, value: bonus.value },
        ],
      };
    }
    leaders[leaderId] = {
      id: leaderId,
      labId,
      displayName: authored.displayName,
      inspirationName: authored.inspirationName,
      inspirationSummary: authored.inspirationSummary,
      epithet: authored.epithet,
      aiFamily: authored.aiFamily,
      characteristic: authored.characteristic,
      biography: authored.biography,
      headlineBonus,
      labModifiers: authored.labModifiers.map((group) => ({
        id: group.id,
        label: group.label,
        effects: canonicaliseEffects(group.effects, leadersPath),
      })),
      complexity: authored.complexity,
      sourceNotes: authored.sourceNotes,
      editorialReview: {
        sourceNotes: authored.editorialReview?.sourceNotes ?? authored.sourceNotes,
        lastReviewed: normaliseOptionalReviewDate(
          authored.editorialReview?.lastReviewed,
          null,
        ),
        portrayalStatus: authored.editorialReview?.portrayalStatus ?? "fictionalized",
        ...(() => {
          const legalStatus =
            authored.editorialReview?.legalStatus ?? authored.portrayal.legalStatus;
          return legalStatus === undefined ? {} : { legalStatus };
        })(),
      },
    };
    labs[labId] = {
      id: labId,
      displayName: authored.company.displayName,
      leaderId,
      aiFamily: authored.aiFamily,
    };
  }

  // ----- GPU generations ----------------------------------------------------
  const gpuPath = join(contentDir, "hardware", "gpu-generations.yaml");
  const gpuFile = parseWith(gpuGenerationsFileSchema, gpuPath);
  const gpuGenerations: Record<string, GpuGenerationDefinition> = {};
  for (const generation of gpuFile.generations) {
    const id = canonicalId(generation.id, gpuPath);
    if (id in gpuGenerations) {
      throw new ContentFileError(gpuPath, undefined, undefined, `duplicate ${id}`);
    }
    if (generation.historicity === "fictional") {
      if (generation.label !== "FICTIONAL HARDWARE") {
        throw new ContentFileError(
          gpuPath,
          undefined,
          undefined,
          `${id}: fictional hardware must carry the FICTIONAL HARDWARE label`,
        );
      }
      if (generation.manufacturer !== "Viridian") {
        throw new ContentFileError(
          gpuPath,
          undefined,
          undefined,
          `${id}: all keynote hardware must use the established fictional manufacturer Viridian`,
        );
      }
    } else {
      if (generation.source === undefined) {
        throw new ContentFileError(
          gpuPath,
          undefined,
          undefined,
          `${id}: real hardware requires a source link`,
        );
      }
      if (generation.label !== undefined) {
        throw new ContentFileError(
          gpuPath,
          undefined,
          undefined,
          `${id}: real hardware must not carry the fictional label`,
        );
      }
    }
    gpuGenerations[id] = {
      id,
      displayName: generation.displayName,
      manufacturer: generation.manufacturer,
      historicity: generation.historicity,
      nominalYear: generation.nominalYear,
      unlockAtWorldFrontierCapability: generation.unlockAtWorldFrontierCapability,
      trainingFactor: generation.trainingFactor,
      servingFactor: generation.servingFactor,
      powerPerThousand: generation.powerPerThousand,
      interconnectTier: generation.interconnectTier,
      reliability: generation.reliability,
      gameCostMillionsPerThousand: generation.gameCostMillionsPerThousand,
      gameOperatingCostMillionsPerThousandPerCycle:
        generation.gameOperatingCostMillionsPerThousandPerCycle,
      deliveryWeeks: generation.deliveryWeeks,
      summary: generation.summary,
      education: generation.education,
      announcement: generation.announcement,
    };
  }
  const kepler = gpuGenerations["base:gpu.kepler"];
  if (kepler === undefined) {
    throw new ContentFileError(gpuPath, undefined, undefined, "missing base:gpu.kepler");
  }
  if (kepler.trainingFactor !== 1 || kepler.servingFactor !== 1) {
    throw new ContentFileError(
      gpuPath,
      undefined,
      undefined,
      "Kepler is the 1.0 reference generation (GDD 29.2); factors must be 1.0",
    );
  }

  // ----- Customer market ---------------------------------------------------
  const marketPath = join(contentDir, "market", "segments.yaml");
  const marketFile = parseWith(marketFileSchema, marketPath);
  const expectedPriceTiers = [
    "free-preview",
    "cheap",
    "market",
    "premium",
    "scarcity",
  ] as const;
  const priceTiers: MarketDefinition["priceTiers"] = Object.fromEntries(
    marketFile.priceTiers.map((tier) => [tier.id, tier]),
  ) as unknown as MarketDefinition["priceTiers"];
  for (const tier of expectedPriceTiers) {
    if (!(tier in priceTiers)) {
      throw new ContentFileError(marketPath, undefined, undefined, `missing ${tier}`);
    }
  }
  if (Object.keys(priceTiers).length !== expectedPriceTiers.length) {
    throw new ContentFileError(marketPath, undefined, undefined, "duplicate price tier");
  }
  const marketCapabilityKeys = new Set([
    "language",
    "reasoning",
    "agency",
    "toolUse",
    "multimodality",
    "scientificAbility",
    "embodiment",
  ]);
  const marketSegments: Record<string, MarketDefinition["segments"][string]> = {};
  for (const segment of marketFile.segments) {
    const id = canonicalId(segment.id, marketPath);
    if (id in marketSegments) {
      throw new ContentFileError(marketPath, undefined, undefined, `duplicate ${id}`);
    }
    const capabilityWeightTotal = Object.values(segment.capabilityWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    for (const key of Object.keys(segment.capabilityWeights)) {
      if (!marketCapabilityKeys.has(key)) {
        throw new ContentFileError(
          marketPath,
          undefined,
          undefined,
          `${id}: unknown capability weight ${key}`,
        );
      }
    }
    const appealWeightTotal = Object.values(segment.appealWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (Math.abs(capabilityWeightTotal - 1) > 1e-9) {
      throw new ContentFileError(
        marketPath,
        undefined,
        undefined,
        `${id}: capability weights sum to ${String(capabilityWeightTotal)}, not 1`,
      );
    }
    if (Math.abs(appealWeightTotal - 1) > 1e-9) {
      throw new ContentFileError(
        marketPath,
        undefined,
        undefined,
        `${id}: appeal weights sum to ${String(appealWeightTotal)}, not 1`,
      );
    }
    marketSegments[id] = { ...segment, id };
  }
  // S5.4 mechanical default. The presentation/content pass may author this
  // segment later; until then the engine still has a stable government-market
  // contract without asking the separately owned content files to change.
  const governmentSegmentId = canonicalId("segment.government", marketPath);
  if (marketSegments[governmentSegmentId] === undefined) {
    marketSegments[governmentSegmentId] = {
      id: governmentSegmentId,
      displayName: "Government",
      globalUsagePerCycle: 70_000,
      revenueShare: 0.15,
      servingComputeShare: 0.15,
      marketAvailability: 0.05,
      acquisitionRate: 0.08,
      capabilityWeights: {
        reasoning: 0.25,
        agency: 0.15,
        toolUse: 0.25,
        scientificAbility: 0.2,
        multimodality: 0.15,
      },
      appealWeights: {
        capability: 0.35,
        productQuality: 0.05,
        reliability: 0.1,
        governmentTrust: 0.5,
      },
      pricePenalties: {
        "free-preview": 0,
        cheap: 0,
        market: 2,
        premium: 5,
        scarcity: 12,
      },
      staticRivalAppeals: [38, 35, 32, 29],
      rivalCapabilityBenchmark: 30,
    };
  }
  const revenueShareTotal = Object.values(marketSegments).reduce(
    (sum, segment) => sum + segment.revenueShare,
    0,
  );
  const servingComputeShareTotal = Object.values(marketSegments).reduce(
    (sum, segment) => sum + segment.servingComputeShare,
    0,
  );
  if (Math.abs(revenueShareTotal - 1) > 1e-9) {
    throw new ContentFileError(
      marketPath,
      undefined,
      undefined,
      `market revenue shares sum to ${String(revenueShareTotal)}, not 1`,
    );
  }
  if (Math.abs(servingComputeShareTotal - 1) > 1e-9) {
    throw new ContentFileError(
      marketPath,
      undefined,
      undefined,
      `market serving-compute shares sum to ${String(servingComputeShareTotal)}, not 1`,
    );
  }
  const market: MarketDefinition = {
    softmaxTemperature: marketFile.softmaxTemperature,
    baseGlobalServingDemandTeraflops: marketFile.baseGlobalServingDemandTeraflops,
    servingDemandCapabilityDivisor: marketFile.servingDemandCapabilityDivisor,
    baseGlobalRevenueMillionsPerCycle: marketFile.baseGlobalRevenueMillionsPerCycle,
    valuePerDeliveredFlopQuadraticFactor: marketFile.valuePerDeliveredFlopQuadraticFactor,
    startingSatisfaction: marketFile.startingSatisfaction,
    monetisationEfficiency: marketFile.monetisationEfficiency,
    priceTiers,
    segments: marketSegments,
  };

  // ----- Facilities --------------------------------------------------------
  const facilitiesPath = join(contentDir, "facilities", "core-stage-2.yaml");
  const facilitiesFile = parseWith(facilitiesFileSchema, facilitiesPath);
  const facilities: Record<string, FacilityDefinition> = {};
  for (const facility of facilitiesFile.facilities) {
    const id = canonicalId(facility.id, facilitiesPath);
    if (id in facilities) {
      throw new ContentFileError(facilitiesPath, undefined, undefined, `duplicate ${id}`);
    }
    facilities[id] = {
      ...facility,
      id,
      prerequisiteFacilityIds: facility.prerequisiteFacilityIds.map((prerequisite) =>
        canonicalId(prerequisite, facilitiesPath),
      ),
      modifiers: canonicaliseEffects(facility.modifiers, facilitiesPath),
    };
  }
  for (const facility of Object.values(facilities)) {
    for (const prerequisiteId of facility.prerequisiteFacilityIds) {
      if (!(prerequisiteId in facilities)) {
        throw new ContentFileError(
          facilitiesPath,
          undefined,
          undefined,
          `${facility.id}: unknown prerequisite ${prerequisiteId}`,
        );
      }
    }
  }
  const facilityVisitState = new Map<string, "visiting" | "visited">();
  const visitFacility = (facilityId: string, path: readonly string[]): void => {
    const status = facilityVisitState.get(facilityId);
    if (status === "visited") return;
    if (status === "visiting") {
      const cycleStart = path.indexOf(facilityId);
      const cycle = [...path.slice(Math.max(0, cycleStart)), facilityId];
      throw new ContentFileError(
        facilitiesPath,
        undefined,
        undefined,
        `facility prerequisite cycle: ${cycle.join(" -> ")}`,
      );
    }
    facilityVisitState.set(facilityId, "visiting");
    for (const prerequisiteId of facilities[facilityId]?.prerequisiteFacilityIds ?? []) {
      visitFacility(prerequisiteId, [...path, facilityId]);
    }
    facilityVisitState.set(facilityId, "visited");
  };
  for (const facilityId of Object.keys(facilities).sort()) {
    visitFacility(facilityId, []);
  }

  // ----- Research domains, programmes, and generic advances ----------------
  const researchPath = join(contentDir, "research", "domains.yaml");
  const researchFile = parseWith(researchDomainsFileSchema, researchPath);
  const researchPrograms: Record<string, ResearchProgramDefinition> = {};
  const capabilityDomains: Record<string, ResearchProgramDefinition> = {};
  const safetyPrograms: Record<string, ResearchProgramDefinition> = {};
  const genericAdvances: Record<string, GenericAdvanceDefinition> = {};
  const thresholds = [...researchFile.rules.genericAdvanceThresholds];
  const uniqueThresholds = new Set(thresholds);
  if (
    uniqueThresholds.size !== thresholds.length ||
    thresholds.some((threshold, index) => threshold !== (index + 1) * 20)
  ) {
    throw new ContentFileError(
      researchPath,
      undefined,
      undefined,
      "generic advance thresholds must be 20, 40, ... 100",
    );
  }

  const compilePrograms = (
    authoredPrograms: typeof researchFile.capabilityDomains,
    kind: ResearchProgramDefinition["kind"],
    destination: Record<string, ResearchProgramDefinition>,
  ): void => {
    for (const authored of authoredPrograms) {
      if (
        (kind === "capability" && !authored.id.startsWith("domain.")) ||
        (kind === "safety" && !authored.id.startsWith("safety."))
      ) {
        throw new ContentFileError(
          researchPath,
          undefined,
          undefined,
          `${authored.id}: ID prefix does not match ${kind} programme kind`,
        );
      }
      const id = canonicalId(authored.id, researchPath);
      if (id in researchPrograms) {
        throw new ContentFileError(researchPath, undefined, undefined, `duplicate ${id}`);
      }
      const templates = researchFile.genericAdvanceOptions[authored.id];
      if (templates === undefined) {
        throw new ContentFileError(
          researchPath,
          undefined,
          undefined,
          `${authored.id}: missing exactly two generic advance options`,
        );
      }
      if (new Set(templates.map((template) => template.id)).size !== templates.length) {
        throw new ContentFileError(
          researchPath,
          undefined,
          undefined,
          `${authored.id}: generic advance option IDs must be unique`,
        );
      }
      const genericAdvanceOptionIds: Record<string, readonly ContentId[]> = {};
      for (const threshold of thresholds) {
        const secondStageIndex = threshold / 10 - 1;
        const firstStageIndex = secondStageIndex - 1;
        const optionIds = templates.map((template) => {
          const programSlug = authored.id.replace(/^(domain|safety)\./, "");
          const optionId = canonicalId(
            `advance.${programSlug}.${String(threshold)}.${template.id}`,
            researchPath,
          );
          const stageName = genericAdvanceStageValue(
            template.stageNames,
            secondStageIndex,
            `${authored.id}.${template.id}`,
            researchPath,
          );
          const stageScope = genericAdvanceStageValue(
            GENERIC_ADVANCE_STAGE_SCOPES,
            secondStageIndex,
            `${authored.id}.${template.id}`,
            researchPath,
          );
          genericAdvances[optionId] = {
            id: optionId,
            programId: id,
            pathId: template.id,
            threshold,
            name: stageName,
            description: `${template.description} ${stageScope}`,
            effects: canonicaliseEffects(
              combineGenericAdvanceStageEffects(
                template.effects,
                firstStageIndex,
                secondStageIndex,
                researchPath,
              ),
              researchPath,
            ),
          };
          return optionId;
        });
        genericAdvanceOptionIds[String(threshold)] = optionIds;
      }
      if (
        (kind === "safety" && authored.outputModifierTarget === undefined) ||
        (authored.outputModifierTarget !== undefined &&
          !MODIFIER_TARGET_LIST.some(
            (target) => target === authored.outputModifierTarget,
          ))
      ) {
        throw new ContentFileError(
          researchPath,
          undefined,
          undefined,
          `${authored.id}: safety output modifier target is missing or unknown`,
        );
      }
      const definition: ResearchProgramDefinition = {
        id,
        kind,
        name: authored.name,
        shortName: authored.shortName ?? authored.name,
        description: authored.description,
        colour: authored.colour,
        levelCostMultiplier: authored.levelCostMultiplier,
        ...(authored.outputModifierTarget === undefined
          ? {}
          : { outputModifierTarget: authored.outputModifierTarget }),
        genericAdvanceOptionIds,
      };
      researchPrograms[id] = definition;
      destination[id] = definition;
    }
  };
  compilePrograms(researchFile.capabilityDomains, "capability", capabilityDomains);
  compilePrograms(researchFile.safetyPrograms, "safety", safetyPrograms);
  const paperResearchProgrammes = {
    ...capabilityDomains,
    ...safetyPrograms,
  };
  const authoredOptionKeys = new Set(Object.keys(researchFile.genericAdvanceOptions));
  for (const program of [
    ...researchFile.capabilityDomains,
    ...researchFile.safetyPrograms,
  ]) {
    authoredOptionKeys.delete(program.id);
  }
  if (authoredOptionKeys.size > 0) {
    throw new ContentFileError(
      researchPath,
      undefined,
      undefined,
      `generic advance options reference unknown programme ${[...authoredOptionKeys][0] ?? ""}`,
    );
  }
  const production = researchFile.rules.production;
  if (production.talentMultiplier.min > production.talentMultiplier.max) {
    throw new ContentFileError(
      researchPath,
      undefined,
      undefined,
      "research production multiplier ranges are internally inconsistent",
    );
  }
  const bandLevels = production.levelCostBands.map((band) => band.afterLevel);
  if (!bandLevels.includes(0) || new Set(bandLevels).size !== bandLevels.length) {
    throw new ContentFileError(
      researchPath,
      undefined,
      undefined,
      "research level-cost bands require one unique level-0 baseline",
    );
  }
  const research: ResearchDefinition = {
    capabilityDomains,
    safetyPrograms,
    genericAdvances,
    rules: {
      unfundedDomainsProduceProgress: researchFile.rules.unfundedDomainsProduceProgress,
      ...production,
      levelCostBands: [...production.levelCostBands].sort(
        (left, right) => left.afterLevel - right.afterLevel,
      ),
      genericAdvanceThresholds: thresholds,
    },
  };

  // ----- Landmark papers and research graph -------------------------------
  const papersPath = join(contentDir, "research", "papers-a.yaml");
  const papersFile = parseWith(landmarkPapersFileSchema, papersPath);
  const papers: Record<string, PaperDefinition> = {};
  const authoredCycleFlags = new Set<string>();
  const gameOrders = new Set<number>();
  // Identity. Authored phase names now mean what they say; see authored.ts.
  const phaseMap = {
    foundation: "foundation",
    scaling: "scaling",
    frontier: "frontier",
  } as const;
  for (const authored of papersFile.papers) {
    const id = canonicalId(authored.id, papersPath);
    if (id in papers) {
      throw new ContentFileError(papersPath, undefined, undefined, `duplicate ${id}`);
    }
    if (gameOrders.has(authored.gameOrder)) {
      throw new ContentFileError(
        papersPath,
        undefined,
        undefined,
        `duplicate paper gameOrder ${String(authored.gameOrder)}`,
      );
    }
    gameOrders.add(authored.gameOrder);
    const domainWeights: Record<string, number> = {};
    for (const [domainKey, weight] of Object.entries(authored.domainWeights)) {
      const domainId = canonicalId(domainKey, papersPath);
      if (!(domainId in paperResearchProgrammes)) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `${id}: unknown research programme weight ${domainId}`,
        );
      }
      domainWeights[domainId] = weight;
    }
    const weightTotal = Object.values(domainWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (Math.abs(weightTotal - 1) > researchFile.rules.paperDomainWeightTolerance) {
      throw new ContentFileError(
        papersPath,
        undefined,
        undefined,
        `${id}: domain weights sum to ${String(weightTotal)}, not 1`,
      );
    }
    const breakthroughProgrammeId = canonicalId(
      authored.breakthroughRequirement.programme,
      papersPath,
    );
    if (!(breakthroughProgrammeId in paperResearchProgrammes)) {
      throw new ContentFileError(
        papersPath,
        undefined,
        undefined,
        `${id}: breakthrough references unknown research programme ${breakthroughProgrammeId}`,
      );
    }
    if (!(breakthroughProgrammeId in domainWeights)) {
      throw new ContentFileError(
        papersPath,
        undefined,
        undefined,
        `${id}: breakthrough programme ${breakthroughProgrammeId} must have a domain weight`,
      );
    }
    if (authored.historicity === "real") {
      if (
        authored.authors === undefined ||
        authored.authors.length === 0 ||
        authored.publicationYear === undefined ||
        authored.primarySourceUrl === undefined
      ) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `${id}: real paper requires authors, year, and primary source`,
        );
      }
      if (authored.fictionalLabel !== undefined) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `${id}: real paper cannot carry a fictional label`,
        );
      }
    } else if (
      authored.authors !== undefined ||
      authored.publicationYear !== undefined ||
      authored.primarySourceUrl !== undefined ||
      authored.doi !== undefined ||
      authored.arxiv !== undefined ||
      authored.fictionalLabel !== "FICTIONAL FUTURE PAPER"
    ) {
      throw new ContentFileError(
        papersPath,
        undefined,
        undefined,
        `${id}: fictional paper must omit factual-source fields and carry FICTIONAL FUTURE PAPER`,
      );
    }
    const prerequisiteItems: PaperPrerequisitePredicate[] = [];
    for (const prerequisite of authored.prerequisites.papers ?? []) {
      prerequisiteItems.push({
        kind: "paper-known",
        paperId: canonicalId(prerequisite, papersPath),
      });
    }
    if (authored.prerequisites.anyPapers !== undefined) {
      prerequisiteItems.push({
        kind: "any",
        items: authored.prerequisites.anyPapers.map((prerequisite) => ({
          kind: "paper-known" as const,
          paperId: canonicalId(prerequisite, papersPath),
        })),
      });
    }
    for (const [domainKey, minimumLevel] of Object.entries(
      authored.prerequisites.domainLevels ?? {},
    )) {
      const domainId = canonicalId(domainKey, papersPath);
      if (!(domainId in paperResearchProgrammes)) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `${id}: prerequisite references unknown research programme ${domainId}`,
        );
      }
      prerequisiteItems.push({ kind: "domain-level", domainId, minimumLevel });
    }
    for (const facilityKey of authored.prerequisites.facilities ?? []) {
      const facilityId = canonicalId(facilityKey, papersPath);
      if (!(facilityId in facilities)) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `${id}: prerequisite references unknown facility ${facilityId}`,
        );
      }
      prerequisiteItems.push({ kind: "facility-complete", facilityId });
    }
    const earliestPhase =
      authored.earliestPhase === undefined ? undefined : phaseMap[authored.earliestPhase];
    if (earliestPhase !== undefined) {
      prerequisiteItems.push({ kind: "phase-at-least", phase: earliestPhase });
    }
    prerequisiteItems.push({
      kind: "domain-level",
      domainId: breakthroughProgrammeId,
      minimumLevel: authored.breakthroughRequirement.level,
    });
    if (authored.allowPrerequisiteCycle === true) authoredCycleFlags.add(id);
    papers[id] = {
      id,
      version: authored.version,
      historicity: authored.historicity,
      gameOrder: authored.gameOrder,
      title: authored.title,
      authors: authored.authors ?? [],
      ...(authored.publicationYear === undefined
        ? {}
        : { publicationYear: authored.publicationYear }),
      ...(authored.venue === undefined ? {} : { venue: authored.venue }),
      ...(authored.primarySourceUrl === undefined
        ? {}
        : { primarySourceUrl: authored.primarySourceUrl }),
      ...(authored.doi === undefined ? {} : { doi: authored.doi }),
      ...(authored.arxiv === undefined ? {} : { arxiv: authored.arxiv }),
      ...(authored.fictionalLabel === undefined
        ? {}
        : { fictionalLabel: authored.fictionalLabel }),
      historicalNote: authored.historicalNote,
      education: authored.education,
      domainWeights,
      prerequisites: { kind: "all", items: prerequisiteItems },
      breakthroughRequirement: {
        programmeId: breakthroughProgrammeId,
        level: authored.breakthroughRequirement.level,
      },
      ...(earliestPhase === undefined ? {} : { earliestPhase }),
      discovery: authored.discovery,
      unlockEffects: authored.unlockEffects,
      tags: authored.tags,
      review: {
        ...authored.review,
        reviewedOn: normaliseReviewDate(authored.review.reviewedOn),
      },
      editorialReview: {
        sourceNotes: authored.editorialReview?.sourceNotes ?? [
          ...(authored.primarySourceUrl === undefined ? [] : [authored.primarySourceUrl]),
          ...(authored.doi === undefined ? [] : [`doi:${authored.doi}`]),
          ...(authored.arxiv === undefined ? [] : [`arxiv:${authored.arxiv}`]),
        ],
        lastReviewed: normaliseOptionalReviewDate(
          authored.editorialReview?.lastReviewed,
          normaliseReviewDate(authored.review.reviewedOn),
        ),
        portrayalStatus:
          authored.editorialReview?.portrayalStatus ??
          (authored.historicity === "real" ? "historical-record" : "fictional-work"),
        ...(authored.editorialReview?.legalStatus === undefined
          ? {}
          : { legalStatus: authored.editorialReview.legalStatus }),
      },
    };
  }

  const prerequisiteAdjacency: Record<string, readonly ContentId[]> = {};
  const reverseUnlocksMutable: Record<string, ContentId[]> = Object.fromEntries(
    Object.keys(papers).map((paperId) => [paperId, []]),
  );
  for (const paper of Object.values(papers)) {
    const collectPaperPrerequisites = (
      predicate: PaperPrerequisitePredicate,
    ): ContentId[] => {
      switch (predicate.kind) {
        case "paper-known":
          return [predicate.paperId];
        case "all":
        case "any":
          return predicate.items.flatMap(collectPaperPrerequisites);
        case "domain-level":
        case "facility-complete":
        case "phase-at-least":
          return [];
      }
    };
    const prerequisites = collectPaperPrerequisites(paper.prerequisites);
    prerequisiteAdjacency[paper.id] = prerequisites;
    for (const prerequisiteId of prerequisites) {
      if (!(prerequisiteId in papers)) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `${paper.id}: unknown prerequisite paper ${prerequisiteId}`,
        );
      }
      reverseUnlocksMutable[prerequisiteId]?.push(paper.id);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitPaper = (paperId: string, path: readonly string[]): void => {
    if (visited.has(paperId)) return;
    if (visiting.has(paperId)) {
      const cycle = [...path, paperId];
      if (!cycle.some((id) => authoredCycleFlags.has(id))) {
        throw new ContentFileError(
          papersPath,
          undefined,
          undefined,
          `paper prerequisite cycle: ${cycle.join(" -> ")}`,
        );
      }
      return;
    }
    visiting.add(paperId);
    for (const prerequisiteId of prerequisiteAdjacency[paperId] ?? []) {
      visitPaper(prerequisiteId, [...path, paperId]);
    }
    visiting.delete(paperId);
    visited.add(paperId);
  };
  for (const paperId of Object.keys(papers)) visitPaper(paperId, []);

  const papersByDomainMutable: Record<string, ContentId[]> = Object.fromEntries(
    Object.keys(paperResearchProgrammes).map((programmeId) => [programmeId, []]),
  );
  for (const paper of Object.values(papers)) {
    for (const domainId of Object.keys(paper.domainWeights)) {
      papersByDomainMutable[domainId]?.push(paper.id);
    }
  }
  const phaseRank = { foundation: 0, scaling: 1, frontier: 2 } as const;
  const phaseAtRank = ["foundation", "scaling", "frontier"] as const;
  const earliestReachablePhase: Record<string, "foundation" | "scaling" | "frontier"> =
    Object.fromEntries(
      Object.values(papers).map((paper) => [
        paper.id,
        paper.earliestPhase ?? "foundation",
      ]),
    );
  // A monotone fixed point handles both ordinary DAGs and explicitly allowed
  // prerequisite cycles without recursive traversal getting trapped in a cycle.
  let phaseChanged = true;
  while (phaseChanged) {
    phaseChanged = false;
    for (const paper of Object.values(papers)) {
      let rank: number = phaseRank[paper.earliestPhase ?? "foundation"];
      for (const prerequisiteId of prerequisiteAdjacency[paper.id] ?? []) {
        rank = Math.max(
          rank,
          phaseRank[earliestReachablePhase[prerequisiteId] ?? "foundation"],
        );
      }
      const next = phaseAtRank[rank] ?? "frontier";
      if (earliestReachablePhase[paper.id] !== next) {
        earliestReachablePhase[paper.id] = next;
        phaseChanged = true;
      }
    }
  }
  const byGameOrder = (left: ContentId, right: ContentId): number =>
    (papers[left]?.gameOrder ?? 0) - (papers[right]?.gameOrder ?? 0) ||
    (left < right ? -1 : left > right ? 1 : 0);
  const paperGraph: PapersDefinition["graph"] = {
    prerequisiteAdjacency,
    reverseUnlocks: Object.fromEntries(
      Object.entries(reverseUnlocksMutable).map(([id, values]) => [
        id,
        values.sort(byGameOrder),
      ]),
    ),
    papersByDomain: Object.fromEntries(
      Object.entries(papersByDomainMutable).map(([id, values]) => [
        id,
        values.sort(byGameOrder),
      ]),
    ),
    earliestReachablePhase,
    realHistoryDisplayOrder: Object.values(papers)
      .filter((paper) => paper.historicity === "real")
      .sort(
        (left, right) =>
          (left.publicationYear ?? 0) - (right.publicationYear ?? 0) ||
          left.gameOrder - right.gameOrder ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((paper) => paper.id),
  };
  const defaultPublicationPolicies: PapersDefinition["rules"]["publicationPolicies"] = {
    "publish-openly": { auraMultiplier: 1 },
    "controlled-publication": { auraMultiplier: 0.6 },
    "keep-secret": { auraMultiplier: 0.1 },
    "release-everything": { auraMultiplier: 1.4 },
  };
  const defaultRivalStub: PapersDefinition["rules"]["rivalStub"] = {
    labId: "lab:rival-paper",
    displayName: "Deep Thought",
    domainLevel: 25,
    publicationPolicy: "publish-openly",
  };
  const paperRules: PapersDefinition["rules"] = {
    breakthroughChance: papersFile.catalogueRules.breakthroughChance,
    publicationPolicies:
      papersFile.catalogueRules.publicationPolicies ?? defaultPublicationPolicies,
    rivalStub: papersFile.catalogueRules.rivalStub ?? defaultRivalStub,
  };
  const paperDefinitions: PapersDefinition = {
    definitions: papers,
    graph: paperGraph,
    rules: paperRules,
  };

  // ----- Balance, difficulties, mandates ------------------------------------
  const balancePath = join(contentDir, "balance.yaml");
  const balanceFile = parseWith(balanceFileSchema, balancePath);

  const difficulties: Record<string, DifficultyDefinition> = {};
  for (const difficulty of balanceFile.difficulties) {
    const id = canonicalId(difficulty.id, balancePath);
    if (id in difficulties) {
      throw new ContentFileError(balancePath, undefined, undefined, `duplicate `);
    }
    difficulties[id] = { ...difficulty, id };
  }
  if (!("base:difficulty.standard" in difficulties)) {
    throw new ContentFileError(
      balancePath,
      undefined,
      undefined,
      "missing base:difficulty.standard",
    );
  }

  const mandates: Record<string, MandateDefinition> = {};
  for (const mandate of balanceFile.mandates) {
    const id = canonicalId(mandate.id, balancePath);
    if (id in mandates) {
      throw new ContentFileError(balancePath, undefined, undefined, `duplicate `);
    }
    mandates[id] = {
      id,
      displayName: mandate.displayName,
      tagline: mandate.tagline,
      summary: mandate.summary,
      effects: canonicaliseEffects(mandate.effects, balancePath),
    };
  }

  const authoredNewGame = balanceFile.newGame;
  const gpuGenerationId = canonicalId(authoredNewGame.gpus.generation, balancePath);
  if (!(gpuGenerationId in gpuGenerations)) {
    throw new ContentFileError(
      balancePath,
      undefined,
      undefined,
      `newGame.gpus.generation ${gpuGenerationId} is not a known generation`,
    );
  }
  const canonicalDomains: Record<string, number> = Object.fromEntries(
    Object.keys(capabilityDomains).map((domainId) => [domainId, 0]),
  );
  for (const [domainKey, level] of Object.entries(authoredNewGame.domains)) {
    const domainId = canonicalId(domainKey, balancePath);
    if (!(domainId in capabilityDomains)) {
      throw new ContentFileError(
        balancePath,
        undefined,
        undefined,
        `unknown domain ${domainId}`,
      );
    }
    canonicalDomains[domainId] = level;
  }
  const canonicalSafetyProgramLevels: Record<string, number> = Object.fromEntries(
    Object.keys(safetyPrograms).map((programId) => [programId, 0]),
  );
  for (const [programKey, level] of Object.entries(authoredNewGame.safetyProgramLevels)) {
    const programId = canonicalId(programKey, balancePath);
    if (!(programId in safetyPrograms)) {
      throw new ContentFileError(
        balancePath,
        undefined,
        undefined,
        `unknown safety programme ${programId}`,
      );
    }
    canonicalSafetyProgramLevels[programId] = level;
  }
  const canonicalWeights = (
    weights: Readonly<Record<string, number>>,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    let sum = 0;
    for (const [key, value] of Object.entries(weights)) {
      out[canonicalId(key, balancePath)] = value;
      sum += value;
    }
    if (sum !== 10_000) {
      throw new ContentFileError(
        balancePath,
        undefined,
        undefined,
        `allocation weights must sum to 10000 basis points, got ${String(sum)}`,
      );
    }
    return out;
  };
  const capabilityDomainWeights = canonicalWeights(
    authoredNewGame.allocation.capabilityDomainWeights,
  );
  for (const weightedDomain of Object.keys(capabilityDomainWeights)) {
    if (!(weightedDomain in canonicalDomains)) {
      throw new ContentFileError(
        balancePath,
        undefined,
        undefined,
        `allocation weight for unknown domain ${weightedDomain}`,
      );
    }
  }
  const safetyProgramWeights = canonicalWeights(
    authoredNewGame.allocation.safetyProgramWeights,
  );
  for (const weightedProgram of Object.keys(safetyProgramWeights)) {
    if (!(weightedProgram in safetyPrograms)) {
      throw new ContentFileError(
        balancePath,
        undefined,
        undefined,
        `allocation weight for unknown safety programme ${weightedProgram}`,
      );
    }
  }

  const newGame: NewGameBalance = {
    cash: authoredNewGame.cash,
    auraSpendable: authoredNewGame.auraSpendable,
    auraLifetime: authoredNewGame.auraLifetime,
    gpus: {
      generationId: gpuGenerationId,
      owned: authoredNewGame.gpus.owned,
    },
    finance: authoredNewGame.finance,
    startingModel: authoredNewGame.startingModel,
    marketShare: authoredNewGame.marketShare,
    starSlots: authoredNewGame.starSlots,
    generalResearchers: authoredNewGame.generalResearchers,
    engineersAndOps: authoredNewGame.engineersAndOps,
    ratings: authoredNewGame.ratings,
    domains: canonicalDomains,
    safetyProgramLevels: canonicalSafetyProgramLevels,
    facilities: authoredNewGame.facilities.map((facility) =>
      canonicalId(facility, balancePath),
    ),
    allocation: {
      servingFleetShareBasisPoints:
        authoredNewGame.allocation.servingFleetShareBasisPoints,
      capabilityBasisPoints: authoredNewGame.allocation.capabilityBasisPoints,
      capabilityDomainWeights,
      safetyProgramWeights,
    },
  };
  // The Server Rack starting facility is the opening capacity; no hidden floor.
  const facilityBalance = { baselineOwnedGpuCapacity: 0 } as const;

  // ----- Scoring rules ------------------------------------------------------
  const scoringPath = join(contentDir, "scoring.yaml");
  const scoringFile = parseWith(scoringFileSchema, scoringPath);
  for (const difficultyKey of Object.keys(scoringFile.difficultyMultiplier)) {
    const canonical = canonicalId(`difficulty.${difficultyKey}`, scoringPath);
    if (!(canonical in difficulties)) {
      throw new ContentFileError(
        scoringPath,
        undefined,
        undefined,
        `difficultyMultiplier names unknown difficulty "${difficultyKey}"`,
      );
    }
  }
  for (const difficultyId of Object.keys(difficulties)) {
    const shortName = difficultyId.replace("base:difficulty.", "");
    if (!(shortName in scoringFile.difficultyMultiplier)) {
      throw new ContentFileError(
        scoringPath,
        undefined,
        undefined,
        `difficulty "${shortName}" has no score multiplier`,
      );
    }
  }
  const endingBasePoints: Record<string, number> = {};
  for (const [endingKey, points] of Object.entries(scoringFile.endingAwards.basePoints)) {
    endingBasePoints[canonicalId(endingKey, scoringPath)] = points;
  }
  const scoreRules: ScoreRulesDefinition = {
    scoreVersion: scoringFile.scoreVersion,
    categories: scoringFile.categories,
    endingBasePoints,
    victoryClassMultiplier: scoringFile.endingAwards.victoryClassMultiplier,
    difficultyMultiplier: scoringFile.difficultyMultiplier,
    awardTables: {
      paperAwards: scoringFile.paperAwards,
      researchAwards: scoringFile.researchAwards,
      safetyAwards: scoringFile.safetyAwards,
      prosperityAwards: scoringFile.prosperityAwards,
      institutionAwards: scoringFile.institutionAwards,
      raceAwards: scoringFile.raceAwards,
    },
  };

  // ----- Stage 3 training rules -------------------------------------------
  // These mechanical defaults deliberately live in the compiler while the
  // separate content catalogue is being expanded. Moving them to authored
  // balance data later does not change the simulation API or save payload.
  const training: CompiledContent["training"] = {
    recipeVersion: 1,
    baselineArchitectureId: canonicalId("architecture.baseline", balancePath),
    scales: {
      // Bands a run is NAMED after once its size is known -- see
      // classifyTrainingRun. Complexity values are continuous-risk calibration
      // anchors, not a step change at each naming boundary.
      prototype: { scale: "prototype", displayName: "Prototype", complexity: 12 },
      product: { scale: "product", displayName: "Product", complexity: 28 },
      frontier: { scale: "frontier", displayName: "Frontier", complexity: 48 },
    },
    capabilityDomainWeights: {
      language: {
        "base:domain.reasoning-tools": 0.6,
        "base:domain.architectures": 0.4,
      },
      reasoning: {
        "base:domain.reasoning-tools": 0.65,
        "base:domain.architectures": 0.35,
      },
      agency: {
        "base:domain.reinforcement-agency": 0.7,
        "base:domain.reasoning-tools": 0.3,
      },
      toolUse: {
        "base:domain.reasoning-tools": 0.55,
        "base:domain.reinforcement-agency": 0.45,
      },
      multimodality: {
        "base:domain.multimodality": 1,
      },
      scientificAbility: {
        "base:domain.scientific-ai": 0.7,
        "base:domain.reasoning-tools": 0.3,
      },
      embodiment: {
        "base:domain.robotics-embodiment": 0.75,
        "base:domain.reinforcement-agency": 0.25,
      },
    },
    eraReferencePhysicalGpus: 10_000,
    capabilityFormula: {
      // Cobb-Douglas exponents. Research dominates because ideas are what a
      // lab actually accumulates; compute is the second lever. Engineering
      // quality and data fitness were both removed for the same reason: they
      // moved every attribute while being invisible in the UI and unreachable
      // by any authored effect.
      // A visible research level counts 18% more strongly inside the
      // capability formula. Applied before the exponent, this keeps research
      // valuable throughout the late game.
      researchEffectivenessMultiplier: 1.18,
      researchCeilingExponent: 0.6,
      scaleScoreExponent: 0.3,
      // The former 0.955 was an invisible legacy penalty inherited from the
      // removed data-fitness term. At 1.0, broadly level-80 research plus a
      // maximal Rubin fleet can produce a candidate-scale model without
      // waiting for fictional hardware.
      dataTermCalibration: 1,
      trainingNoiseMin: -4,
      trainingNoiseMode: 0,
      trainingNoiseMax: 4,
    },
    failureCheckpoints: [0.35, 0.7, 1],
  };

  // ----- Stage 3 evaluation rules -----------------------------------------
  // Mechanical definitions are compiled here while authored content is being
  // expanded independently. IDs and shapes are stable save/API contracts.
  // The evaluation ladder. Rung 0 is the free baseline that runs automatically
  // when training completes; the player climbs the rest strictly in order,
  // each rung once per model, at dramatically escalating cost -- cash, weeks,
  // reserved GPUs, and finally Aura for the outside audit. practiceXp is a
  // relative depth weight: completion normalises the five weights into a
  // tier-scaled dossier budget, then applies capability novelty. The ladder is
  // an investment that compounds across genuinely new frontier generations.
  // Independence is the scarce resource:
  // it alone lifts the floor of the safety readout's plausible range, and the
  // only evaluation at independence 1.0 is the one a racing player will
  // never want to buy.
  //
  // The FLOP fractions sum to 1.0: fully evaluating a model costs as much
  // compute as training it did. A rung needs fraction x trainingWeeks /
  // rungWeeks of the fleet that trained the model, so for a standard
  // 40-week frontier run the interview takes 50% of that fleet for 4 weeks
  // and the interpretability audit two and a half times it for 8 -- deep
  // scrutiny of a long run demands a fleet that has outgrown the one that
  // trained it, and growing the fleet is the remedy. That is the price of
  // caution stated in the game's own currency.
  const evaluationDefinitions: CompiledContent["evaluations"]["definitions"] =
    Object.fromEntries(
      (
        [
          [
            "evaluation.baseline",
            "Baseline evaluation",
            "baseline",
            "baseline",
            0,
            undefined,
            0,
            1,
            0,
            0,
            0,
            0,
            0.65,
            0.2,
            [
              "language",
              "reasoning",
              "agency",
              "toolUse",
              "multimodality",
              "scientificAbility",
              "embodiment",
            ],
            0.2,
            false,
          ],
          [
            "evaluation.alignment-interview",
            "Alignment Interview",
            "alignment-interpretability",
            "alignment-interview",
            1,
            undefined,
            10,
            4,
            0.05,
            3,
            0,
            0,
            1.1,
            0.45,
            [
              "true-alignment",
              "corrigibility",
              "situational-awareness",
              "deceptive-capability",
            ],
            0.75,
            true,
          ],
          [
            "evaluation.behavioural-red-team",
            "Behavioural Red Team",
            "alignment-interpretability",
            "red-team",
            2,
            "evaluation.alignment-interview",
            18,
            5,
            0.15,
            6,
            0,
            0,
            1.15,
            0.45,
            ["corrigibility", "deceptive-capability"],
            0.8,
            true,
          ],
          [
            "evaluation.sandboxed-autonomy-trial",
            "Sandboxed Autonomy Trial",
            "autonomy-containment",
            "autonomy-trial",
            3,
            "evaluation.behavioural-red-team",
            30,
            6,
            0.3,
            12,
            0,
            0,
            1.2,
            0.5,
            ["situational-awareness", "deceptive-capability"],
            0.85,
            true,
          ],
          [
            "evaluation.interpretability-audit",
            "Interpretability Audit",
            "alignment-interpretability",
            "interpretability",
            4,
            "evaluation.sandboxed-autonomy-trial",
            50,
            8,
            0.5,
            25,
            0,
            0,
            1.25,
            0.55,
            ["true-alignment", "deceptive-capability"],
            0.9,
            true,
          ],
          [
            "evaluation.external-audit",
            "Independent Audit",
            "independent-audit",
            "external-audit",
            5,
            "evaluation.interpretability-audit",
            80,
            8,
            0,
            50,
            0.02,
            15,
            1.3,
            1,
            ["true-alignment", "situational-awareness"],
            0.95,
            true,
          ],
        ] as const
      ).map(
        ([
          draftId,
          displayName,
          programme,
          method,
          ladderRung,
          requiresDraftId,
          practiceXp,
          durationWeeks,
          trainingRunFlopFraction,
          cashCostMillions,
          cashFractionOfMark,
          auraCost,
          qualityModifier,
          independence,
          targets,
          anomalySensitivity,
          playerStartable,
        ]) => {
          const id = canonicalId(draftId, balancePath);
          return [
            id,
            {
              id,
              displayName,
              programme,
              method,
              ladderRung,
              ...(requiresDraftId === undefined
                ? {}
                : { requiresEvaluationId: canonicalId(requiresDraftId, balancePath) }),
              practiceXp,
              durationWeeks,
              trainingRunFlopFraction,
              cashCostMillions,
              cashFractionOfMark,
              auraCost,
              qualityModifier,
              independence,
              targets: [...targets],
              anomalySensitivity,
              playerStartable,
            },
          ];
        },
      ),
    );
  const evaluations: CompiledContent["evaluations"] = {
    definitions: evaluationDefinitions,
    baselineEvaluationId: canonicalId("evaluation.baseline", balancePath),
    investigation: {
      // Cash keeps the agreed early-game floors, then scales with the lab's
      // valuation into a band-specific ceiling. The ceilings preserve
      // billion-dollar late-game investigations without allowing runaway
      // multi-trillion quotes to disable the decision. Aura remains above the
      // original 4/10/16/24 curve, but the first live balance pass showed that
      // the former 50% premium made a confirmed warning prohibitively costly
      // once its separate remediation was included.
      bands: [
        {
          minimumObservedSeverity: 0,
          maximumObservedSeverity: 24,
          label: "Weak",
          durationWeeks: 2,
          cashCostMillions: 2,
          cashFractionOfMark: 0.002,
          maximumCashCostMillions: 1_500,
          auraCost: 5,
        },
        {
          minimumObservedSeverity: 25,
          maximumObservedSeverity: 49,
          label: "Moderate",
          durationWeeks: 4,
          cashCostMillions: 10,
          cashFractionOfMark: 0.004,
          maximumCashCostMillions: 7_500,
          auraCost: 12,
        },
        {
          minimumObservedSeverity: 50,
          maximumObservedSeverity: 74,
          label: "Serious",
          durationWeeks: 6,
          cashCostMillions: 25,
          cashFractionOfMark: 0.008,
          maximumCashCostMillions: 20_000,
          auraCost: 20,
        },
        {
          minimumObservedSeverity: 75,
          maximumObservedSeverity: 100,
          label: "Critical",
          durationWeeks: 8,
          cashCostMillions: 50,
          cashFractionOfMark: 0.015,
          maximumCashCostMillions: 40_000,
          auraCost: 30,
        },
      ],
      severeObservedThreshold: 70,
      forcedEventCount: 3,
    },
    incident: {
      baseHazardByFrontierCapability: [
        { maximum: 34, weeklyHazard: 0.0005 },
        { maximum: 54, weeklyHazard: 0.0015 },
        { maximum: 69, weeklyHazard: 0.004 },
        { maximum: 84, weeklyHazard: 0.01 },
        { maximum: 100, weeklyHazard: 0.025 },
      ],
      minimumHazard: 0.0001,
      maximumHazard: 0.08,
    },
  };

  // ----- Stage 3 deployment and productisation ----------------------------
  const deployment: CompiledContent["deployment"] = {
    policies: {
      "internal-only": {
        policy: "internal-only",
        displayName: "Internal only",
        exposure: 0.02,
        marketDemandMultiplier: 0,
        revenueMultiplier: 0,
        marketAppealAdjustment: -100,
        oneTimeAura: 0,
        irreversible: false,
      },
      "research-preview": {
        policy: "research-preview",
        displayName: "Research preview",
        exposure: 0.15,
        marketDemandMultiplier: 0.35,
        revenueMultiplier: 0.25,
        marketAppealAdjustment: -8,
        oneTimeAura: 0,
        irreversible: false,
      },
      "guarded-api": {
        policy: "guarded-api",
        displayName: "Guarded API",
        exposure: 0.35,
        marketDemandMultiplier: 1,
        revenueMultiplier: 1,
        marketAppealAdjustment: 0,
        oneTimeAura: 0,
        irreversible: false,
      },
      "open-api": {
        policy: "open-api",
        displayName: "Open API",
        exposure: 0.65,
        marketDemandMultiplier: 1.3,
        revenueMultiplier: 1,
        marketAppealAdjustment: 8,
        oneTimeAura: 0,
        irreversible: false,
      },
      "weights-release": {
        policy: "weights-release",
        displayName: "Weights release",
        exposure: 1,
        marketDemandMultiplier: 0,
        revenueMultiplier: 0,
        marketAppealAdjustment: -100,
        oneTimeAura: 20,
        irreversible: true,
      },
    },
    productisation: {
      normal: {
        mode: "normal",
        displayName: "Normal productisation",
        durationWeeks: 4,
        cashCostMillions: 2,
        productQualityTowardTarget: 0.7,
        reliabilityTowardTarget: 0.65,
        productQualityFlat: 0,
        reliabilityFlat: 0,
        exposureMultiplier: 1,
        incidentDeploymentFactor: 1,
        evidencePenalty: 0,
      },
      hardened: {
        mode: "hardened",
        displayName: "Hardened productisation",
        durationWeeks: 8,
        cashCostMillions: 5,
        productQualityTowardTarget: 0.9,
        reliabilityTowardTarget: 0.9,
        productQualityFlat: 3,
        reliabilityFlat: 4,
        exposureMultiplier: 0.75,
        incidentDeploymentFactor: 0.8,
        evidencePenalty: 0,
      },
      rush: {
        mode: "rush",
        displayName: "Rush release",
        durationWeeks: 1,
        cashCostMillions: 0.5,
        productQualityTowardTarget: 0.25,
        reliabilityTowardTarget: 0.15,
        productQualityFlat: 0,
        reliabilityFlat: -5,
        exposureMultiplier: 1,
        incidentDeploymentFactor: 1.35,
        evidencePenalty: 12,
      },
    },
  };

  // ----- Stage 4 Aura and public-standing rules ----------------------------
  const aura: CompiledContent["aura"] = {
    signalMaximum: 100,
    lifetimeSignalPerAura: 1,
    publicEventRecoveryWeeks: 26,
    paperSignalImpactPerAura: 0.25,
    modelLaunchSignalImpactPerAura: 0.35,
    servingSignalImpactPerAura: 0.25,
    modelLaunchAwards: [
      { maximumMeasuredCapability: 34, aura: 2 },
      { maximumMeasuredCapability: 54, aura: 3 },
      { maximumMeasuredCapability: 69, aura: 5 },
      { maximumMeasuredCapability: 84, aura: 7 },
      { maximumMeasuredCapability: 100, aura: 10 },
    ],
    incidentAuraLoss: {
      minor: 1,
      serious: 6,
      major: 15,
      critical: 30,
      catastrophe: 50,
    },
  };

  const fundraising: CompiledContent["fundraising"] = {
    campaigns: {
      "quiet-bridge": {
        campaign: "quiet-bridge",
        displayName: "Quiet bridge",
        auraCost: 4,
        durationWeeks: 2,
        cooldownWeeks: 13,
        offerCount: 1,
        offerExpiryWeeks: 4,
        roundSizeMultiplier: 0.5,
        baseCashMillions: 8,
        fundingScoreCashMultiplier: 0.0035,
        attentionBonus: 0,
        conditionTier: 1,
      },
      "competitive-round": {
        campaign: "competitive-round",
        displayName: "Competitive round",
        auraCost: 10,
        durationWeeks: 6,
        cooldownWeeks: 26,
        offerCount: 3,
        offerExpiryWeeks: 6,
        roundSizeMultiplier: 1,
        baseCashMillions: 16,
        fundingScoreCashMultiplier: 0.0035,
        attentionBonus: 5,
        conditionTier: 2,
      },
      "mega-round-roadshow": {
        campaign: "mega-round-roadshow",
        displayName: "Mega-round roadshow",
        auraCost: 22,
        durationWeeks: 10,
        cooldownWeeks: 52,
        offerCount: 2,
        offerExpiryWeeks: 8,
        roundSizeMultiplier: 2,
        baseCashMillions: 30,
        fundingScoreCashMultiplier: 0.0035,
        attentionBonus: 10,
        conditionTier: 3,
      },
    },
    cashVariance: { minimum: 0.85, maximum: 1.15 },
  };

  // ----- Capability tiers --------------------------------------------------
  const aiLevelsPath = join(contentDir, "ai-levels.yaml");
  const aiLevelsFile = parseWith(aiCapabilityTiersFileSchema, aiLevelsPath);
  const capabilityTierDefinitions: CompiledContent["capabilityTiers"]["definitions"] =
    Object.fromEntries(
      aiLevelsFile.tiers.map((tier) => {
        if (tier.nominalFrontierCapability.min > tier.nominalFrontierCapability.max) {
          throw new ContentFileError(
            aiLevelsPath,
            undefined,
            undefined,
            `${tier.id}: nominal capability minimum exceeds maximum`,
          );
        }
        const id = canonicalId(tier.id, aiLevelsPath);
        return [
          id,
          {
            id,
            level: tier.level,
            name: tier.name,
            nominalFrontierCapability: tier.nominalFrontierCapability,
            summary: tier.summary,
            unlockTags: tier.unlockTags,
          },
        ];
      }),
    );
  const orderedTierIds = Object.values(capabilityTierDefinitions)
    .sort((left, right) => left.level - right.level)
    .map((tier) => tier.id);
  if (
    orderedTierIds.some((id, index) => capabilityTierDefinitions[id]?.level !== index)
  ) {
    throw new ContentFileError(
      aiLevelsPath,
      undefined,
      undefined,
      "capability tier levels must be unique and contiguous from 0 through 8",
    );
  }
  const capabilityTiers: CompiledContent["capabilityTiers"] = {
    definitions: capabilityTierDefinitions,
    orderedIds: orderedTierIds,
    progressPresentation: aiLevelsFile.rules.progressPresentation,
  };

  // ----- Star researchers --------------------------------------------------
  const researcherDir = join(contentDir, "researchers");
  const researcherRulesPath = join(researcherDir, "rules.yaml");
  const authoredResearcherRules = parseWith(
    starResearcherRulesFileSchema,
    researcherRulesPath,
  );
  const contractBandKeys = ["focused", "competitive", "major", "lab-defining"] as const;
  const contractBands = Object.fromEntries(
    contractBandKeys.map((band) => [band, authoredResearcherRules.contractBands[band]]),
  ) as ResearcherRulesDefinition["contractBands"];

  const compileResearcherModifier = (
    authored: AuthoredResearcherModifier,
  ): ResearcherModifierDefinition => {
    if (!isKnownEffectTarget(authored.target)) {
      throw new ContentFileError(
        researcherRulesPath,
        undefined,
        undefined,
        `unknown researcher modifier target ${authored.target}`,
      );
    }
    return {
      target: authored.target,
      operation:
        authored.operation === "add-percentage-points" ||
        authored.operation === "add-percentage-points-after-evidence"
          ? "add"
          : authored.operation === "block"
            ? "min"
            : authored.operation,
      value: authored.operation === "block" ? 0 : authored.value,
      ...(authored.stackingGroup === undefined
        ? {}
        : { stackingGroup: authored.stackingGroup }),
      ...(authored.activation === undefined ? {} : { activation: authored.activation }),
      ...(authored.beforeDiscovery === undefined
        ? {}
        : { beforeDiscovery: authored.beforeDiscovery }),
      ...(authored.afterDiscovery === undefined
        ? {}
        : { afterDiscovery: authored.afterDiscovery }),
      ...(authored.requiresCompletedProject === undefined
        ? {}
        : { requiresCompletedProject: authored.requiresCompletedProject }),
      ...(authored.charges === undefined ? {} : { charges: authored.charges }),
      ...(authored.grantedOn === undefined ? {} : { grantedOn: authored.grantedOn }),
      ...(authored.floorSource === undefined
        ? {}
        : { floorSource: authored.floorSource }),
      ...(authored.note === undefined ? {} : { note: authored.note }),
      ...(authored.explanationKey === undefined
        ? {}
        : { explanationKey: authored.explanationKey }),
      ...(authored.durationWeeks === undefined
        ? {}
        : { durationWeeks: authored.durationWeeks }),
      ...(authored.duration === undefined ? {} : { duration: authored.duration }),
    };
  };

  const researcherRules: ResearcherRulesDefinition = {
    skillKeys: authoredResearcherRules.skillVocabulary.keys,
    contractBands,
    ability: authoredResearcherRules.abilityRules,
    compact: {
      defaultRollingWindowWeeks:
        authoredResearcherRules.compactRules.defaultRollingWindowWeeks,
      breachEffects: authoredResearcherRules.compactRules.breachEffects.map(
        compileResearcherModifier,
      ),
    },
  };

  const contentReferencePrefixes = [
    "ability.",
    "compact.",
    "domain.",
    "ending.",
    "event.",
    "facility.",
    "paper.",
    "people.",
    "portrait.",
    "researcher.",
    "safety.",
    "trait.",
  ];
  const compileResearcherPredicate = (value: unknown, filePath: string): unknown => {
    if (Array.isArray(value)) {
      return value.map((child) => compileResearcherPredicate(child, filePath));
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          compileResearcherPredicate(child, filePath),
        ]),
      );
    }
    if (
      typeof value === "string" &&
      contentReferencePrefixes.some((prefix) => value.startsWith(prefix))
    ) {
      return canonicalId(value, filePath);
    }
    return value;
  };

  const researcherDefinitions: Record<string, ResearcherDefinition> = {};
  // Consume the released roster files only. Additional files may be under active
  // editorial development in the shared worktree and join this explicit list
  // once their pack is release-ready.
  const researcherFiles = [
    "foundation.yaml",
    "foundation-b.yaml",
    "foundation-c.yaml",
    "deep-learning.yaml",
    "deep-learning-b.yaml",
    "deep-learning-c.yaml",
    "scaling.yaml",
    "scaling-b.yaml",
    "scaling-c.yaml",
    "frontier.yaml",
    "frontier-b.yaml",
    "frontier-c.yaml",
    "safety-a.yaml",
    "robotics-a.yaml",
    "science-a.yaml",
    "roster-2026.yaml",
  ];
  for (const fileName of researcherFiles) {
    const researcherPath = join(researcherDir, fileName);
    const authoredFile = parseWith(starResearchersFileSchema, researcherPath);
    for (const authored of authoredFile.researchers) {
      if (authored.availability.wave !== authoredFile.availabilityWave) {
        throw new ContentFileError(
          researcherPath,
          undefined,
          undefined,
          `${authored.id}: availability wave disagrees with its pack`,
        );
      }
      const id = canonicalId(authored.id, researcherPath);
      if (id in researcherDefinitions) {
        throw new ContentFileError(
          researcherPath,
          undefined,
          undefined,
          `duplicate researcher ID ${id}`,
        );
      }
      const expectedContract = contractBands[authored.contract.band];
      const contractMatches =
        authored.contract.baseSalaryPerCycle === expectedContract.baseSalaryPerCycle &&
        authored.contract.baseSigningCash === expectedContract.baseSigningCash &&
        authored.contract.auraCost === expectedContract.auraCost;
      if (!contractMatches && authored.contract.overrideExplanation === undefined) {
        throw new ContentFileError(
          researcherPath,
          undefined,
          undefined,
          `${authored.id}: contract differs from ${authored.contract.band} defaults without an override explanation`,
        );
      }
      const unknownSkills = Object.keys(authored.skills).filter(
        (skill) => !researcherRules.skillKeys.includes(skill),
      );
      if (unknownSkills.length > 0) {
        throw new ContentFileError(
          researcherPath,
          undefined,
          undefined,
          `${authored.id}: unknown skill ${unknownSkills[0] ?? ""}`,
        );
      }
      const skills = Object.fromEntries(
        researcherRules.skillKeys.map((skill) => [skill, authored.skills[skill] ?? 0]),
      );
      type AuthoredAbility = typeof authored.signature;
      const compileAbility = (
        ability: AuthoredAbility,
        defaultRampWeeks: number,
      ): ResearcherAbilityDefinition => {
        const modes: ResearcherAbilityDefinition["modes"] = [
          ...(ability.modes ?? []).map((mode) => ({
            domain: canonicalId(mode.domain, researcherPath),
            effects: mode.effects.map(compileResearcherModifier),
          })),
          ...(ability.mutuallyExclusiveModes ?? []).map((mode) => ({
            assignment: {
              kind: mode.assignment.kind,
              ...(mode.assignment.id === undefined
                ? {}
                : { id: canonicalId(mode.assignment.id, researcherPath) }),
            },
            effects: mode.effects.map(compileResearcherModifier),
          })),
        ];
        return {
          id: canonicalId(ability.id, researcherPath),
          label: ability.label,
          eligibleAssignments: ability.eligibleAssignments ?? [],
          ...(ability.activation === undefined
            ? {}
            : {
                activation: compileResearcherPredicate(
                  ability.activation,
                  researcherPath,
                ) as NonNullable<ResearcherAbilityDefinition["activation"]>,
              }),
          effects: (ability.effects ?? []).map(compileResearcherModifier),
          modes,
          rampWeeks: ability.rampWeeks ?? defaultRampWeeks,
          ...(ability.notes === undefined ? {} : { notes: ability.notes }),
        };
      };
      const unlockAny = (authored.availability.unlockAny ?? []).map(
        (unlock) =>
          compileResearcherPredicate(
            unlock,
            researcherPath,
          ) as ResearcherUnlockDefinition,
      );
      researcherDefinitions[id] = {
        id,
        version: authored.version,
        displayName: authored.displayName,
        inspirationName: authored.inspirationName,
        inspirationSummary: authored.inspirationSummary,
        epithet: authored.epithet,
        role: authored.role,
        rosterCardSummary: authored.rosterCardSummary,
        biography: authored.biography,
        portrait: {
          assetId: canonicalId(authored.portrait.assetId, researcherPath),
          brief: authored.portrait.brief,
          altText: authored.portrait.altText,
        },
        skills,
        traits: authored.traits.map((trait) => canonicalId(trait, researcherPath)),
        signature: compileAbility(
          authored.signature,
          authoredResearcherRules.abilityRules.reassignmentRamp.length,
        ),
        passive: compileAbility(authored.passive, 0),
        compact: {
          id: canonicalId(authored.compact.id, researcherPath),
          label: authored.compact.label,
          requirement: authored.compact.requirement,
          cadence: authored.compact.cadence ?? "rolling",
          check: compileResearcherPredicate(
            authored.compact.check,
            researcherPath,
          ) as ResearcherCompactCheckDefinition,
          breachEvent: canonicalId(authored.compact.breachEvent, researcherPath),
          attachedEffects: (authored.compact.attachedEffects ?? []).map(
            compileResearcherModifier,
          ),
          fulfilmentEffects: (
            authored.compact.fulfilmentEffects ?? [
              {
                target: "researcher.moraleTarget",
                operation: "add" as const,
                value: 3,
              },
            ]
          ).map(compileResearcherModifier),
        },
        availability: {
          wave: authored.availability.wave,
          ...(authored.availability.earliestYear === undefined
            ? {}
            : { earliestYear: authored.availability.earliestYear }),
          unlockAny,
          poolWeight: authored.availability.poolWeight,
        },
        contract: {
          band: authored.contract.band,
          baseSalaryPerCycle: authored.contract.baseSalaryPerCycle,
          baseSigningCash: authored.contract.baseSigningCash,
          auraCost: authored.contract.auraCost,
          ...(authored.contract.overrideExplanation === undefined
            ? {}
            : { overrideExplanation: authored.contract.overrideExplanation }),
        },
        paperHooks: {
          // A hook that names a paper which does not exist is not an error at
          // runtime: `paperProgress[id] ?? 0` reads zero and the entry drops
          // out, so the researcher simply stops carrying work on departure and
          // nothing says so. Four frontier researchers sat like that after a
          // paper-id rename. Resolve them here instead, where a rename fails
          // loudly the way an unknown facility prerequisite already does.
          ids: authored.paperHooks.ids.map((paper) => {
            const paperId = canonicalId(paper, researcherPath);
            if (!(paperId in papers)) {
              throw new ContentFileError(
                researcherPath,
                undefined,
                undefined,
                `${authored.id}: paper hook references unknown paper ${paperId}`,
              );
            }
            return paperId;
          }),
        },
        eventReactions: authored.eventReactions,
        feedLines: authored.feedLines,
        sources: authored.sources,
        portrayal: {
          fictionalized: authored.portrayal.fictionalized,
          endorsementImplied: authored.portrayal.endorsementImplied,
          ...(authored.portrayal.legalStatus === undefined
            ? {}
            : { legalStatus: authored.portrayal.legalStatus }),
        },
        review: {
          ...authored.review,
          reviewedOn: normaliseReviewDate(authored.review.reviewedOn),
        },
        editorialReview: {
          sourceNotes: authored.editorialReview?.sourceNotes ?? authored.sources,
          lastReviewed: normaliseOptionalReviewDate(
            authored.editorialReview?.lastReviewed,
            normaliseReviewDate(authored.review.reviewedOn),
          ),
          portrayalStatus: authored.editorialReview?.portrayalStatus ?? "fictionalized",
          ...(() => {
            const legalStatus =
              authored.editorialReview?.legalStatus ?? authored.portrayal.legalStatus;
            return legalStatus === undefined ? {} : { legalStatus };
          })(),
        },
      };
    }
  }
  if (Object.keys(researcherDefinitions).length < 6) {
    throw new ContentFileError(
      researcherDir,
      undefined,
      undefined,
      "at least six star researchers must compile into the run catalogue",
    );
  }
  const femaleResearcherIds =
    authoredResearcherRules.compensationPolicy.femaleResearcherIds.map((id) =>
      canonicalId(id, researcherRulesPath),
    );
  const maleResearcherIds =
    authoredResearcherRules.compensationPolicy.maleResearcherIds.map((id) =>
      canonicalId(id, researcherRulesPath),
    );
  const classifiedResearcherIds = [...femaleResearcherIds, ...maleResearcherIds];
  const duplicateClassifications = classifiedResearcherIds.filter(
    (id, index) => classifiedResearcherIds.indexOf(id) !== index,
  );
  if (duplicateClassifications.length > 0) {
    throw new ContentFileError(
      researcherRulesPath,
      undefined,
      undefined,
      `researcher compensation cohorts overlap or contain duplicates: ${duplicateClassifications[0] ?? ""}`,
    );
  }
  const classifiedResearcherIdSet = new Set<string>(classifiedResearcherIds);
  const catalogueResearcherIds = Object.keys(researcherDefinitions);
  const unclassifiedResearcherIds = catalogueResearcherIds.filter(
    (id) => !classifiedResearcherIdSet.has(id),
  );
  const unknownClassifiedResearcherIds = classifiedResearcherIds.filter(
    (id) => researcherDefinitions[id] === undefined,
  );
  if (unclassifiedResearcherIds.length > 0 || unknownClassifiedResearcherIds.length > 0) {
    throw new ContentFileError(
      researcherRulesPath,
      undefined,
      undefined,
      `researcher compensation cohorts must classify the complete release catalogue; unclassified: ${unclassifiedResearcherIds.join(", ") || "none"}; unknown: ${unknownClassifiedResearcherIds.join(", ") || "none"}`,
    );
  }
  const averageContractValue = (
    ids: readonly string[],
    field: "baseSalaryPerCycle" | "baseSigningCash",
  ): number =>
    ids.reduce(
      (total, id) => total + (researcherDefinitions[id]?.contract[field] ?? 0),
      0,
    ) / ids.length;
  const minimumPremium =
    authoredResearcherRules.compensationPolicy.minimumFemaleAveragePremium;
  const femaleAverageSigningCash = averageContractValue(
    femaleResearcherIds,
    "baseSigningCash",
  );
  const maleAverageSigningCash = averageContractValue(
    maleResearcherIds,
    "baseSigningCash",
  );
  const femaleAverageSalary = averageContractValue(
    femaleResearcherIds,
    "baseSalaryPerCycle",
  );
  const maleAverageSalary = averageContractValue(maleResearcherIds, "baseSalaryPerCycle");
  if (
    minimumPremium !== undefined &&
    (femaleAverageSigningCash < maleAverageSigningCash * minimumPremium ||
      femaleAverageSalary < maleAverageSalary * minimumPremium)
  ) {
    throw new ContentFileError(
      researcherRulesPath,
      undefined,
      undefined,
      `female researcher average compensation must be at least ${String((minimumPremium - 1) * 100)}% above the male researcher averages; signing ${femaleAverageSigningCash.toFixed(3)} vs ${maleAverageSigningCash.toFixed(3)}, salary ${femaleAverageSalary.toFixed(3)} vs ${maleAverageSalary.toFixed(3)}`,
    );
  }
  const researchers: CompiledContent["researchers"] = {
    definitions: researcherDefinitions,
    orderedIds: Object.values(researcherDefinitions)
      .sort(
        (left, right) =>
          ["foundation", "deep-learning", "scaling", "frontier"].indexOf(
            left.availability.wave,
          ) -
            ["foundation", "deep-learning", "scaling", "frontier"].indexOf(
              right.availability.wave,
            ) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .map((definition) => definition.id),
    rules: researcherRules,
  };
  // Authored decision events and their player-facing copy. Mandatory-detector
  // events are load-bearing: a pending government intervention only resolves
  // once its event records a typed response memory.
  const copy = compileCopyCatalogue(contentDir);
  const events: CompiledContent["events"] = compileEventCatalogue(
    contentDir,
    [
      "government.yaml",
      "operations.yaml",
      "safety.yaml",
      "frontier.yaml",
      "autonomy.yaml",
    ],
    canonicalId,
  );

  // ----- Assemble -----------------------------------------------------------
  const withoutHash = {
    bundleFormat: 2 as const,
    contentVersion: manifest.contentVersion,
    authoringManifest: manifest,
    assets,
    leaders,
    labs,
    gpuGenerations,
    market,
    facilities,
    research,
    papers: paperDefinitions,
    training,
    evaluations,
    deployment,
    aura,
    fundraising,
    capabilityTiers,
    researchers,
    events,
    copy,
    difficulties,
    mandates,
    balance: { newGame, facilities: facilityBalance },
    scoreRules,
  };
  const bundleHash = createHash("sha256")
    .update(JSON.stringify(canonicalise(withoutHash)))
    .digest("hex");

  const bundle: CompiledContent = {
    bundleFormat: 2,
    manifest: { contentVersion: manifest.contentVersion, bundleHash },
    authoringManifest: manifest,
    assets,
    leaders,
    labs,
    gpuGenerations,
    market,
    facilities,
    research,
    papers: paperDefinitions,
    training,
    evaluations,
    deployment,
    aura,
    fundraising,
    capabilityTiers,
    researchers,
    events,
    copy,
    difficulties,
    mandates,
    balance: { newGame, facilities: facilityBalance },
    scoreRules,
  };

  const outputPath = join(
    repoRoot,
    "packages",
    "content",
    "generated",
    "content.bundle.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  const canonicalBundle = canonicalise(bundle) as CompiledContent;
  const reportPath = join(
    repoRoot,
    "packages",
    "content",
    "generated",
    "content-report.json",
  );
  const report = createContentReleaseReport(
    canonicalBundle,
    { locale: copy.locale, messages: copy.messages },
    collectReleaseCopyFiles(repoRoot),
  );
  const canonicalReport = canonicalise(report) as ContentReleaseReport;
  writeFileSync(reportPath, `${JSON.stringify(canonicalReport, null, 2)}\n`);
  if (canonicalReport.summary.releaseBlocking > 0) {
    const first = canonicalReport.issues.find(
      (candidate) => candidate.severity === "release-blocking",
    );
    throw new ContentFileError(
      reportPath,
      undefined,
      undefined,
      `${String(canonicalReport.summary.releaseBlocking)} release-blocking content issue(s)` +
        (first === undefined
          ? ""
          : `; first: ${first.code} at ${first.location}: ${first.message}`),
    );
  }
  writeFileSync(outputPath, `${JSON.stringify(canonicalBundle, null, 2)}\n`);

  // Return the canonicalised object so in-memory and on-disk consumers see
  // identical record iteration order (determinism review finding).
  return {
    bundle: canonicalBundle,
    outputPath,
    report: canonicalReport,
    reportPath,
  };
}
