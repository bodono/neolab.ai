import { satisfiesAgiCandidateRequirements } from "../endgame/candidate-programme.ts";
import type {
  CapabilityTierDefinition,
  CompiledContent,
  ContentId,
} from "@neolab/content-schema";

import { awardScore } from "../engine/score.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { ModelId } from "../model/ids.ts";
import type { GameState, ModelState } from "../model/state.ts";

export interface CapabilityTierView {
  readonly id: ContentId;
  readonly level: number;
  readonly name: string;
  readonly summary: string;
  readonly frontierCapabilityEstimate: number;
  readonly confidence: "low" | "medium" | "high";
  readonly progressToNextTier:
    "early" | "developing" | "approaching" | "breakthrough-imminent" | "top-tier";
  readonly unlockTags: readonly string[];
}

/**
 * The tier is the band, and nothing else.
 *
 * It used to be a band floor AND a checklist of attribute thresholds,
 * productisation stats and evaluation flags. That produced a model with a
 * frontier estimate of 72 sitting at tier 2 because its reliability was 30 --
 * a stat training never writes -- and, because four of the checklist flags were
 * read by this file and written by nothing anywhere, it left tiers 5, 6 and 8
 * permanently unreachable.
 *
 * Capability is exact from the moment training ends, so the honest reading of
 * "how advanced is this model" is the capability number itself. Nothing about
 * safety belongs here: the ladder must never be a thing the player has to buy
 * caution to climb.
 */
function tierSatisfied(tier: CapabilityTierDefinition, model: ModelState): boolean {
  const frontierCapability = model.measuredCapability?.frontierCapability;
  return (
    frontierCapability !== undefined &&
    frontierCapability >= tier.nominalFrontierCapability.min
  );
}

function requireModel(state: Readonly<GameState>, modelId: ModelId): ModelState {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  return model;
}

export function classifyCapabilityTier(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
): CapabilityTierView {
  const model = requireModel(state, modelId);
  const ordered = content.capabilityTiers.orderedIds
    .map((id) => content.capabilityTiers.definitions[id])
    .filter((tier): tier is CapabilityTierDefinition => tier !== undefined);
  const tier = [...ordered]
    .reverse()
    .find((candidate) => tierSatisfied(candidate, model));
  const selected = tier ?? ordered[0];
  if (selected === undefined) throw new Error("Capability tier zero is missing");
  const next = ordered.find((candidate) => candidate.level === selected.level + 1);
  const frontierCapabilityEstimate = model.measuredCapability?.frontierCapability ?? 0;
  const progressToNextTier = (() => {
    if (next === undefined) return "top-tier" as const;
    const span = Math.max(
      1,
      next.nominalFrontierCapability.min - selected.nominalFrontierCapability.min,
    );
    const ratio = Math.max(
      0,
      Math.min(
        1,
        (frontierCapabilityEstimate - selected.nominalFrontierCapability.min) / span,
      ),
    );
    const index = ratio < 0.25 ? 0 : ratio < 0.5 ? 1 : ratio < 0.75 ? 2 : 3;
    return content.capabilityTiers.progressPresentation[index] ?? "developing";
  })();
  return {
    id: selected.id,
    level: selected.level,
    name: selected.name,
    summary: selected.summary,
    frontierCapabilityEstimate,
    confidence: model.measuredCapability?.confidence ?? "low",
    progressToNextTier,
    unlockTags: selected.unlockTags,
  };
}

/**
 * Candidacy requires the four Candidate Programme works and the canonical
 * capability thresholds. Compute affects the capability achieved by training,
 * but is deliberately not checked as an additional requirement.
 */
export function isApparentAgiCandidate(
  state: Readonly<GameState>,
  model: ModelState,
): boolean {
  const evidence = model.measuredCapability;
  return (
    evidence !== undefined &&
    satisfiesAgiCandidateRequirements(
      state,
      model.ownerLabId,
      evidence.values,
      evidence.frontierCapability,
    )
  );
}

function tierScoreRule(content: CompiledContent): {
  readonly category: "score.race-operations";
  readonly pointsByTier: unknown;
} {
  const raw = content.scoreRules.awardTables.raceAwards["capabilityTierFirstReached"];
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { category?: unknown }).category !== "score.race-operations"
  ) {
    throw new Error("Invalid capability-tier score rule");
  }
  return raw as {
    readonly category: "score.race-operations";
    readonly pointsByTier: unknown;
  };
}

function scoreForTier(content: CompiledContent, level: number): number {
  const table = tierScoreRule(content).pointsByTier;
  if (table === null || typeof table !== "object") return 0;
  const value = (table as Readonly<Record<string, unknown>>)[String(level)];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function milestoneAttention(
  state: Readonly<GameState>,
  model: ModelState,
  tierLevel: number,
): "modal" | "side" {
  if (model.ownerLabId === state.run.playerLabId) return "modal";
  if (tierLevel >= 7) return "modal";
  if (tierLevel <= 5) return "side";
  const anotherRivalReachedTierSix = Object.values(state.models).some(
    (candidate) =>
      candidate.ownerLabId !== model.ownerLabId &&
      candidate.ownerLabId !== state.run.playerLabId &&
      candidate.flags["capability-tier-reached:6"] === true,
  );
  return anotherRivalReachedTierSix ? "side" : "modal";
}

const HIGHEST_ANNOUNCED_CAPABILITY_TIER_FLAG = "capability-tier-highest-announced";
const CAPABILITY_TIER_REACHED_FLAG_PREFIX = "capability-tier-reached:";

function highestAnnouncedCapabilityTier(model: ModelState): number {
  const recorded = model.flags[HIGHEST_ANNOUNCED_CAPABILITY_TIER_FLAG];
  const recordedLevel =
    typeof recorded === "number" && Number.isFinite(recorded) ? Math.floor(recorded) : -1;
  const legacyLevel = Object.entries(model.flags).reduce((highest, [key, value]) => {
    if (value !== true || !key.startsWith(CAPABILITY_TIER_REACHED_FLAG_PREFIX)) {
      return highest;
    }
    const level = Number(key.slice(CAPABILITY_TIER_REACHED_FLAG_PREFIX.length));
    return Number.isInteger(level) && level >= 0 ? Math.max(highest, level) : highest;
  }, -1);
  return Math.max(recordedLevel, legacyLevel);
}

function highestRelevantAnnouncementTier(
  state: Readonly<GameState>,
  model: ModelState,
): number {
  if (model.ownerLabId === state.run.playerLabId) {
    return highestAnnouncedCapabilityTier(model);
  }
  // Rival milestone news describes the laboratory's frontier, not the novelty
  // of a checkpoint name. A successor at the same or a lower tier is therefore
  // not news, even though that individual model has no announcement flags yet.
  return Object.values(state.models)
    .filter((candidate) => candidate.ownerLabId === model.ownerLabId)
    .reduce(
      (highest, candidate) =>
        Math.max(highest, highestAnnouncedCapabilityTier(candidate)),
      -1,
    );
}

function rivalMilestoneNewsHidden(
  state: Readonly<GameState>,
  model: ModelState,
): boolean {
  if (model.ownerLabId === state.run.playerLabId) return false;
  const playerLab = state.labs[state.run.playerLabId];
  if (playerLab?.flags["campaign:progressive"] !== true) return false;
  const stage = playerLab.flags["campaign:lab-maturity-stage"];
  return stage === "garage" || stage === "cluster";
}

export function processCapabilityTierMilestones(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
): CapabilityTierView {
  const tier = classifyCapabilityTier(tx.read(), content, modelId);
  const model = requireModel(tx.read(), modelId);
  const presentationKey = `capability-tier:${modelId}:${tier.id}`;
  const highestAnnouncedTier = highestRelevantAnnouncementTier(tx.read(), model);
  const alreadyAnnounced = tier.level <= highestAnnouncedTier;
  const newsHidden = rivalMilestoneNewsHidden(tx.read(), model);
  if (
    !alreadyAnnounced &&
    (newsHidden ||
      !tx.read().presentationQueue.some((item) => item.key === presentationKey))
  ) {
    const attention = milestoneAttention(tx.read(), model, tier.level);
    tx.update((draft) => {
      // If capability jumped again before the previous milestone was seen, show
      // only the highest milestone. Rival announcements collapse across every
      // model from that lab because the laboratory's frontier is what matters.
      draft.presentationQueue = draft.presentationQueue.filter((item) => {
        if (item.kind !== "capability-tier") return true;
        if (model.ownerLabId === draft.run.playerLabId) {
          return item.modelId !== modelId;
        }
        return draft.models[item.modelId]?.ownerLabId !== model.ownerLabId;
      });
      if (!newsHidden) {
        draft.presentationQueue.push({
          key: presentationKey,
          kind: "capability-tier",
          attention,
          definitionId: tier.id,
          modelId,
          createdAt: draft.run.tick,
        });
      }
      const mutableModel = draft.models[modelId];
      if (mutableModel === undefined) throw new Error(`Unknown model ${modelId}`);
      mutableModel.flags[HIGHEST_ANNOUNCED_CAPABILITY_TIER_FLAG] = tier.level;
      for (let level = 0; level <= tier.level; level += 1) {
        mutableModel.flags[`${CAPABILITY_TIER_REACHED_FLAG_PREFIX}${String(level)}`] =
          true;
      }
    });
    tx.emit({
      kind: "capability-tier-reached",
      modelId,
      tierId: tier.id,
      level: tier.level,
    });
  }
  const scoreRule = tierScoreRule(content);
  if (model.ownerLabId === tx.read().run.playerLabId) {
    for (let level = 1; level <= tier.level; level += 1) {
      const key = `race/capability-tier-first/${String(level)}`;
      const amount = scoreForTier(content, level);
      if (amount > 0 && tx.read().score.awardedKeys[key] !== true) {
        awardScore(tx, {
          key,
          categoryId: scoreRule.category,
          amount,
          source: { kind: "system", id: modelId },
          explanationKey: "score.capability-tier.first-reached",
        });
      }
    }
  }
  return tier;
}
