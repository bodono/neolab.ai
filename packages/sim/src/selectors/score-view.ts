import type { CompiledContent } from "@neolab/content-schema";

import { SCORE_CATEGORY_IDS } from "../engine/score.ts";
import type {
  FinalScoreRecord,
  GameState,
  ScoreCategoryId,
  ScoreLedgerEntry,
} from "../model/state.ts";

export interface ScoreEntryView {
  readonly key: string;
  readonly tick: number;
  readonly categoryId: ScoreCategoryId;
  readonly amount: number;
  readonly amountLabel: string;
  readonly explanation: string;
}

export interface ScoreCategoryView {
  readonly id: ScoreCategoryId;
  readonly name: string;
  readonly colour: string;
  readonly total: number;
  readonly entries: readonly ScoreEntryView[];
}

/** Player-visible ledger. Ending-only truth exists here only after settlement emitted it. */
export interface ScoreView {
  readonly scoreVersion: string;
  /** Running sum floored at zero for display (GDD section 41.5). */
  readonly displayTotal: number;
  /** Unfloored running sum, for the ending screen's honesty. */
  readonly runningTotal: number;
  readonly categoryTotals: Readonly<Record<ScoreCategoryId, number>>;
  readonly entries: readonly ScoreEntryView[];
  readonly categories: readonly ScoreCategoryView[];
  readonly final?: FinalScoreRecord;
}

const EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  "score.paper.world-first": "World-first scientific landmark",
  "score.paper.rediscovery": "Independent scientific rediscovery",
  "score.paper.publication.publish-openly": "Published landmark openly",
  "score.paper.publication.controlled-publication":
    "Published landmark under controlled access",
  "score.paper.publication.keep-secret": "Kept landmark private",
  "score.paper.publication.release-everything":
    "Released landmark and supporting materials",
  "score.research.domain-level-50": "Research domain reached level 50",
  "score.research.domain-level-80": "Research domain reached level 80",
  "score.research.generic-advance": "Completed a research advance",
  "score.facility.first": "Completed a campus facility",
  "score.capability-tier.first-reached": "First arrival at a capability tier",
  "score.coalition.charter-ratified": "Ratified a coalition charter",
  "score.prosperity.readiness-60": "Prosperity Programme reached 60 readiness",
  "score.prosperity.readiness-80": "Prosperity Programme reached 80 readiness",
  "score.prosperity.demonstration-completed": "Completed a prosperity demonstration",
  "score.prosperity.distribution-plan-ratified": "Ratified a broad distribution plan",
  "score.safety.first-broad-evaluation-suite":
    "Completed a broad adversarial evaluation suite",
  "score.safety.first-deep-interpretability-audit":
    "Completed a deep interpretability audit",
  "score.safety.first-external-audit": "Completed an independent external safety review",
  "score.safety.severe-anomaly-resolved": "Resolved a severe anomaly before deployment",
  "score.safety.the-brakes-worked":
    "THE BRAKES WORKED — permanently archived a dangerous candidate",
  "score.safety.penalty.unresolved-severe-anomaly":
    "Penalty: severe anomaly remained unresolved at the ending",
  "score.safety.penalty.compact-waived-external-audit":
    "Penalty: required external audit was missed",
  "score.safety.penalty.missed-required-external-audit":
    "Penalty: required external audit was missed",
  "score.safety.penalty.near-escape":
    "Penalty: a contained critical incident was a near escape",
  "score.safety.penalty.concealed-critical-anomaly":
    "Penalty: critical anomaly evidence was concealed",
  "score.safety.penalty.player-caused-loss-of-control":
    "Penalty: the deployment lost control of the candidate",
  "score.ending.base-award": "Authored award for the final ending",
});

function titleFromId(id: string): string {
  const tail = id.split(":").at(-1) ?? id;
  return tail
    .split(/[./-]/g)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function sourceName(
  entry: ScoreLedgerEntry,
  content?: CompiledContent,
): string | undefined {
  const id = entry.source.id;
  if (id === undefined) return undefined;
  const paper = content?.papers.definitions[id];
  if (paper !== undefined) return paper.title;
  if (entry.key.startsWith("facility/first/")) {
    const definitionId = `base:${entry.key.slice("facility/first/".length)}`;
    return content?.facilities[definitionId]?.displayName ?? titleFromId(definitionId);
  }
  if (entry.key.startsWith("facility/milestone/")) {
    return `${titleFromId(entry.key.slice("facility/milestone/".length))} milestone`;
  }
  if (entry.key.startsWith("prosperity/")) {
    const programme = entry.key.split("/").at(-2);
    return programme === undefined ? undefined : titleFromId(programme);
  }
  if (entry.source.kind === "ending") return titleFromId(id);
  return titleFromId(id);
}

function projectEntry(
  entry: ScoreLedgerEntry,
  content?: CompiledContent,
): ScoreEntryView {
  const capabilityTierPrefix = "race/capability-tier-first/";
  if (entry.key.startsWith(capabilityTierPrefix)) {
    const level = Number(entry.key.slice(capabilityTierPrefix.length));
    const definition = Number.isInteger(level)
      ? content?.capabilityTiers.orderedIds
          .map((id) => content.capabilityTiers.definitions[id])
          .find((candidate) => candidate?.level === level)
      : undefined;
    return {
      key: entry.key,
      tick: entry.tick,
      categoryId: entry.categoryId,
      amount: entry.amount,
      amountLabel: `${entry.amount > 0 ? "+" : ""}${String(entry.amount)}`,
      explanation:
        definition === undefined
          ? `Reached capability Tier ${String(level)}`
          : `Reached Tier ${String(level)} · ${definition.name}`,
    };
  }
  const explanation =
    EXPLANATIONS[entry.explanationKey] ?? titleFromId(entry.explanationKey);
  const source = sourceName(entry, content);
  return {
    key: entry.key,
    tick: entry.tick,
    categoryId: entry.categoryId,
    amount: entry.amount,
    amountLabel: `${entry.amount > 0 ? "+" : ""}${String(entry.amount)}`,
    explanation: source === undefined ? explanation : `${explanation}: ${source}`,
  };
}

export function calculateScoreView(
  state: GameState,
  content?: CompiledContent,
): ScoreView {
  const categoryTotals = Object.fromEntries(
    SCORE_CATEGORY_IDS.map((id) => [id, 0]),
  ) as Record<ScoreCategoryId, number>;
  let runningTotal = 0;
  for (const entry of state.score.entries) {
    runningTotal += entry.amount;
    categoryTotals[entry.categoryId] += entry.amount;
  }
  const entries = state.score.entries.map((entry) => projectEntry(entry, content));
  const categoryDefinitions = new Map(
    content?.scoreRules.categories.map((definition) => [definition.id, definition]),
  );
  const categories = SCORE_CATEGORY_IDS.map((id) => ({
    id,
    name: categoryDefinitions.get(id)?.name ?? titleFromId(id),
    colour: categoryDefinitions.get(id)?.colour ?? "#8b96a8",
    total: categoryTotals[id],
    entries: entries.filter((entry) => entry.categoryId === id),
  }));
  return {
    scoreVersion: state.score.scoreVersion,
    displayTotal: Math.floor(Math.max(0, runningTotal)),
    runningTotal,
    categoryTotals,
    entries,
    categories,
    ...(state.score.final === undefined
      ? {}
      : { final: structuredClone(state.score.final) }),
  };
}
