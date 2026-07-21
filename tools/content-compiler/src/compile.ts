import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  authoringManifestSchema,
  balanceFileSchema,
  contentId,
  gpuGenerationsFileSchema,
  isContentId,
  launchLeadersFileSchema,
  type AuthoredEffect,
  type CompiledContent,
  type ContentId,
  type DifficultyDefinition,
  type GpuGenerationDefinition,
  type LabDefinition,
  type LeaderDefinition,
  type MandateDefinition,
  type NamedEffectGroup,
  type NewGameBalance,
} from "@neolab/content-schema";
import type { z } from "zod";

import { ContentFileError, parseYamlFile } from "./yaml-io.ts";

export interface CompileResult {
  readonly bundle: CompiledContent;
  readonly outputPath: string;
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
  const typeDash = /^(leader|lab|facility|paper|event|researcher)-(.+)$/.exec(draft);
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
): readonly AuthoredEffect[] {
  // Effect targets are registry keys, not content IDs; passed through as-is.
  return effects;
}

export function compileContent(repoRoot: string): CompileResult {
  const contentDir = join(repoRoot, "content");

  const manifestPath = join(contentDir, "manifest.yaml");
  const manifest = parseWith(authoringManifestSchema, manifestPath);

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
        effects: canonicaliseEffects(bonus.effects),
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
      epithet: authored.epithet,
      aiFamily: authored.aiFamily,
      characteristic: authored.characteristic,
      biography: authored.biography,
      headlineBonus,
      labModifiers: authored.labModifiers.map((group) => ({
        id: group.id,
        label: group.label,
        effects: canonicaliseEffects(group.effects),
      })),
      complexity: authored.complexity,
      aiNamingStyle: authored.aiNamingStyle,
      sourceNotes: authored.sourceNotes,
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
      if (generation.manufacturer === "NVIDIA") {
        throw new ContentFileError(
          gpuPath,
          undefined,
          undefined,
          `${id}: fictional hardware must use a fictional manufacturer (GDD 29.2)`,
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

  // ----- Balance, difficulties, mandates ------------------------------------
  const balancePath = join(contentDir, "balance.yaml");
  const balanceFile = parseWith(balanceFileSchema, balancePath);

  const difficulties: Record<string, DifficultyDefinition> = {};
  for (const difficulty of balanceFile.difficulties) {
    const id = canonicalId(difficulty.id, balancePath);
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
    mandates[id] = {
      id,
      displayName: mandate.displayName,
      effects: canonicaliseEffects(mandate.effects),
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
  const canonicalDomains: Record<string, number> = {};
  for (const [domainKey, level] of Object.entries(authoredNewGame.domains)) {
    canonicalDomains[canonicalId(domainKey, balancePath)] = level;
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

  const newGame: NewGameBalance = {
    startYear: authoredNewGame.startYear,
    cash: authoredNewGame.cash,
    auraSpendable: authoredNewGame.auraSpendable,
    auraLifetime: authoredNewGame.auraLifetime,
    gpus: {
      generationId: gpuGenerationId,
      owned: authoredNewGame.gpus.owned,
      leased: authoredNewGame.gpus.leased,
    },
    softwareEfficiency: authoredNewGame.softwareEfficiency,
    startingModel: authoredNewGame.startingModel,
    marketShare: authoredNewGame.marketShare,
    starSlots: authoredNewGame.starSlots,
    generalResearchers: authoredNewGame.generalResearchers,
    engineersAndOps: authoredNewGame.engineersAndOps,
    ratings: authoredNewGame.ratings,
    domains: canonicalDomains,
    facilities: authoredNewGame.facilities.map((facility) =>
      canonicalId(facility, balancePath),
    ),
    allocation: {
      servingBasisPoints: authoredNewGame.allocation.servingBasisPoints,
      capabilityBasisPoints: authoredNewGame.allocation.capabilityBasisPoints,
      capabilityDomainWeights,
      safetyProgramWeights: canonicalWeights(
        authoredNewGame.allocation.safetyProgramWeights,
      ),
    },
    fundingClimate: authoredNewGame.fundingClimate,
  };

  // ----- Assemble -----------------------------------------------------------
  const withoutHash = {
    bundleFormat: 2 as const,
    contentVersion: manifest.contentVersion,
    authoringManifest: manifest,
    leaders,
    labs,
    gpuGenerations,
    difficulties,
    mandates,
    balance: { newGame },
  };
  const bundleHash = createHash("sha256")
    .update(JSON.stringify(canonicalise(withoutHash)))
    .digest("hex");

  const bundle: CompiledContent = {
    bundleFormat: 2,
    manifest: { contentVersion: manifest.contentVersion, bundleHash },
    authoringManifest: manifest,
    leaders,
    labs,
    gpuGenerations,
    difficulties,
    mandates,
    balance: { newGame },
  };

  const outputPath = join(
    repoRoot,
    "packages",
    "content",
    "generated",
    "content.bundle.json",
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(canonicalise(bundle), null, 2)}\n`);

  return { bundle, outputPath };
}
