import type {
  CompiledContent,
  ContentId,
  PaperDefinition,
  PaperPrerequisitePredicate,
  PublicationPolicy,
} from "@neolab/content-schema";

import { calculateAuraGain } from "../aura/aura.ts";
import { isModifierTarget } from "../engine/modifier-targets.ts";
import { CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG } from "../compute/gpu-portfolio.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { awardScore } from "../engine/score.ts";
import { isFlavourUnlockTarget } from "../engine/consumed-targets.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type { GamePhase, GameState } from "../model/state.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  recordResearcherCompactActions,
  recordResearcherPublicationCompactEvent,
} from "../researchers/compacts.ts";
import { rivalPaperLevel } from "../rivals/research.ts";
import { recordRivalPublicSignal } from "../rivals/signals.ts";

/** Each open release the lab has already made shrinks the next one's Aura. */
const OPEN_RELEASE_NOVELTY_DECAY = 0.93;
/** Open publication never becomes worthless, just unremarkable. */
const OPEN_RELEASE_NOVELTY_FLOOR = 0.2;
/** Independent rediscovery earns a little credit, never the world-first prize. */
const REDISCOVERY_PRESTIGE_MULTIPLIER = 0.2;
const PAPER_EFFECTS_APPLIED_FLAG_PREFIX = "paper-effects-applied:";
const PAPER_PUBLIC_GLOBAL_EFFECTS_FLAG_PREFIX = "paper-public-effects-applied:";
const BASIS_POINTS = 10_000;

export interface EligiblePaper {
  readonly paperId: ContentId;
  readonly title: string;
  readonly gameOrder: number;
}

export interface PaperBreakthroughCheck {
  readonly paperId: ContentId;
  readonly labId: string;
  readonly programmeId: ContentId;
  readonly requiredLevel: number;
  readonly currentLevel: number;
  readonly probability: number;
  readonly draw: number;
  readonly success: boolean;
}

interface PaperKnowledge {
  readonly knownPaperIds: ReadonlySet<ContentId>;
  readonly domainLevels: Readonly<Record<string, number>>;
  readonly facilityIds: ReadonlySet<string>;
  readonly phase: GamePhase;
}

function phaseRank(phase: GamePhase | "foundation" | "scaling" | "frontier"): number {
  return phase === "foundation" ? 0 : phase === "scaling" ? 1 : 2;
}

/**
 * The compiler appends each paper's hidden breakthrough requirement to its
 * prerequisites as a domain-level item. A focus discount lowers that one item
 * only; authored prerequisite levels, even on the same programme, still apply.
 */
interface BreakthroughGate {
  readonly programmeId: string;
  readonly authoredLevel: number;
  readonly requiredLevel: number;
}

function evaluatePrerequisite(
  predicate: PaperPrerequisitePredicate,
  knowledge: PaperKnowledge,
  gate?: BreakthroughGate,
): boolean {
  switch (predicate.kind) {
    case "all":
      return predicate.items.every((item) => evaluatePrerequisite(item, knowledge, gate));
    case "any":
      return predicate.items.some((item) => evaluatePrerequisite(item, knowledge, gate));
    case "paper-known":
      return knowledge.knownPaperIds.has(predicate.paperId);
    case "domain-level": {
      const minimumLevel =
        gate !== undefined &&
        predicate.domainId === gate.programmeId &&
        predicate.minimumLevel === gate.authoredLevel
          ? gate.requiredLevel
          : predicate.minimumLevel;
      return (knowledge.domainLevels[predicate.domainId] ?? 0) >= minimumLevel;
    }
    case "facility-complete":
      return knowledge.facilityIds.has(predicate.facilityId);
    case "phase-at-least":
      return phaseRank(knowledge.phase) >= phaseRank(predicate.phase);
  }
}

export function isPublicPaperDiscovery(
  discovery: Readonly<GameState["world"]["paperRace"]["discoveries"][string]>,
): boolean {
  return (
    discovery.publicationPolicy !== undefined &&
    discovery.publicationPolicy !== "keep-secret"
  );
}

export function labKnowsPaper(
  state: Readonly<GameState>,
  labId: string,
  paperId: ContentId,
): boolean {
  const lab = state.labs[labId as LabId];
  const discovered =
    lab === undefined
      ? state.world.paperRace.rival.discoveredPaperIds.includes(paperId)
      : lab.research.discoveredPaperIds.includes(paperId);
  if (discovered) return true;
  const worldDiscovery = state.world.paperRace.discoveries[paperId];
  return worldDiscovery !== undefined && isPublicPaperDiscovery(worldDiscovery);
}

function knownPaperIds(
  state: Readonly<GameState>,
  discoveredPaperIds: readonly ContentId[],
): ReadonlySet<ContentId> {
  return new Set([
    ...discoveredPaperIds,
    ...Object.values(state.world.paperRace.discoveries)
      .filter(isPublicPaperDiscovery)
      .map((discovery) => discovery.paperId),
  ]);
}

function canonicalLabKnowledge(state: Readonly<GameState>, labId: LabId): PaperKnowledge {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  // Rivals race for papers on their hidden paper levels, which leave out most
  // of their off-screen research boost; the player races on real levels.
  const rival = lab.control === "rival";
  return {
    knownPaperIds: knownPaperIds(state, lab.research.discoveredPaperIds),
    domainLevels: Object.fromEntries(
      [
        ...Object.entries(lab.research.domains),
        ...Object.entries(lab.research.safetyPrograms),
      ].map(([id, programme]) => [
        id,
        rival ? rivalPaperLevel(state, labId, id) : programme.level,
      ]),
    ),
    facilityIds: new Set(
      lab.facilities.instances.map((facility) => facility.definitionId),
    ),
    phase: state.run.phase,
  };
}

function rivalKnowledge(state: Readonly<GameState>): PaperKnowledge {
  const rival = state.world.paperRace.rival;
  return {
    knownPaperIds: knownPaperIds(state, rival.discoveredPaperIds),
    domainLevels: rival.domainLevels,
    facilityIds: new Set(),
    phase: state.run.phase,
  };
}

function labKnowledge(state: Readonly<GameState>, labId: string): PaperKnowledge {
  return state.labs[labId as LabId] === undefined
    ? rivalKnowledge(state)
    : canonicalLabKnowledge(state, labId as LabId);
}

/**
 * The lab's paper-focus programmes: those receiving at least the authored
 * share of all its research compute (capability plus safety) under the
 * current allocation. Only the player has a focus; a rival's set is empty.
 * Exact basis-point arithmetic, so a share on the threshold always counts.
 */
export function derivePaperFocusProgrammeIds(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
  allocation = state.labs[labId as LabId]?.compute.allocation,
): ReadonlySet<string> {
  const lab = state.labs[labId as LabId];
  if (lab === undefined || allocation === undefined || labId !== state.run.playerLabId) {
    return new Set();
  }
  // Shares are products of two basis-point fractions, so compare in units of
  // 1/10,000^2 of research compute.
  const thresholdUnits = Math.round(
    content.papers.rules.playerFocus.researchComputeShare * BASIS_POINTS ** 2,
  );
  const capabilityBasisPoints = allocation.capabilityBasisPoints;
  const shares: [string, number][] = [
    ...Object.entries(allocation.capabilityDomainWeights).map(
      ([programmeId, weight]): [string, number] => [
        programmeId,
        capabilityBasisPoints * weight,
      ],
    ),
    ...Object.entries(allocation.safetyProgramWeights).map(
      ([programmeId, weight]): [string, number] => [
        programmeId,
        (BASIS_POINTS - capabilityBasisPoints) * weight,
      ],
    ),
  ];
  return new Set(
    shares
      .filter(([, units]) => units > 0 && units >= thresholdUnits)
      .map(([programmeId]) => programmeId),
  );
}

/** The programme level this paper needs from a lab with the given focus set. */
export function paperRequiredLevel(
  content: CompiledContent,
  paper: PaperDefinition,
  focusProgrammeIds: ReadonlySet<string>,
): number {
  const authored = paper.breakthroughRequirement.level;
  return focusProgrammeIds.has(paper.breakthroughRequirement.programmeId)
    ? Math.max(0, authored - content.papers.rules.playerFocus.levelDiscount)
    : authored;
}

/** Everything a lab's weekly paper rolls read, computed once per lab. */
interface LabPaperRaceContext {
  readonly knowledge: PaperKnowledge;
  readonly focusProgrammeIds: ReadonlySet<string>;
}

function labPaperRaceContext(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
): LabPaperRaceContext {
  return {
    knowledge: labKnowledge(state, labId),
    focusProgrammeIds: derivePaperFocusProgrammeIds(state, content, labId),
  };
}

function breakthroughGate(
  content: CompiledContent,
  paper: PaperDefinition,
  focusProgrammeIds: ReadonlySet<string>,
): BreakthroughGate {
  return {
    programmeId: paper.breakthroughRequirement.programmeId,
    authoredLevel: paper.breakthroughRequirement.level,
    requiredLevel: paperRequiredLevel(content, paper, focusProgrammeIds),
  };
}

function isEligible(
  content: CompiledContent,
  paper: PaperDefinition,
  context: LabPaperRaceContext,
): boolean {
  if (context.knowledge.knownPaperIds.has(paper.id)) return false;
  return evaluatePrerequisite(
    paper.prerequisites,
    context.knowledge,
    breakthroughGate(content, paper, context.focusProgrammeIds),
  );
}

function eligiblePapers(
  content: CompiledContent,
  context: LabPaperRaceContext,
): readonly PaperDefinition[] {
  return Object.values(content.papers.definitions)
    .filter((paper) => isEligible(content, paper, context))
    .sort(
      (left, right) => left.gameOrder - right.gameOrder || (left.id < right.id ? -1 : 1),
    );
}

export function listEligiblePapers(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
): readonly EligiblePaper[] {
  return eligiblePapers(content, labPaperRaceContext(state, content, labId)).map(
    (paper) => ({
      paperId: paper.id,
      title: paper.title,
      gameOrder: paper.gameOrder,
    }),
  );
}

function breakthroughChance(
  content: CompiledContent,
  paper: PaperDefinition,
  context: LabPaperRaceContext,
): number {
  if (!isEligible(content, paper, context)) return 0;
  const currentLevel =
    context.knowledge.domainLevels[paper.breakthroughRequirement.programmeId] ?? 0;
  const requiredLevel = paperRequiredLevel(content, paper, context.focusProgrammeIds);
  if (currentLevel < requiredLevel) return 0;
  const rules = content.papers.rules.breakthroughChance;
  return Math.min(
    rules.maximum,
    rules.basePerWeek + (currentLevel - requiredLevel) * rules.perLevelAbove,
  );
}

export function derivePaperBreakthroughChance(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
  paperId: ContentId,
): number {
  const paper = content.papers.definitions[paperId];
  if (paper === undefined) throw new Error(`Unknown paper ${paperId}`);
  return breakthroughChance(content, paper, labPaperRaceContext(state, content, labId));
}

/**
 * The level a lab races for a paper on and the level the paper needs from it:
 * a rival's hidden paper level and a player focus discount both apply.
 */
export function describePaperRaceStanding(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
  paperId: ContentId,
): { readonly currentLevel: number; readonly requiredLevel: number } {
  const paper = content.papers.definitions[paperId];
  if (paper === undefined) throw new Error(`Unknown paper ${paperId}`);
  const context = labPaperRaceContext(state, content, labId);
  return {
    currentLevel:
      context.knowledge.domainLevels[paper.breakthroughRequirement.programmeId] ?? 0,
    requiredLevel: paperRequiredLevel(content, paper, context.focusProgrammeIds),
  };
}

function paperBreakthroughCheck(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
  paper: PaperDefinition,
  context: LabPaperRaceContext,
  oracle: RandomOracle,
): PaperBreakthroughCheck {
  const programmeId = paper.breakthroughRequirement.programmeId;
  const currentLevel = context.knowledge.domainLevels[programmeId] ?? 0;
  const probability = breakthroughChance(content, paper, context);
  const draw = oracle.uniform(
    randomKey("paper", "weekly-breakthrough", labId, paper.id, String(state.run.tick)),
  );
  return {
    paperId: paper.id,
    labId,
    programmeId,
    requiredLevel: paperRequiredLevel(content, paper, context.focusProgrammeIds),
    currentLevel,
    probability,
    draw,
    success: draw < probability,
  };
}

function paperScoreRule(
  content: CompiledContent,
  key: "worldFirst" | "independentlyRediscovered",
): { readonly category: "score.scientific-legacy"; readonly formula: string } {
  const raw = content.scoreRules.awardTables.paperAwards[key];
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as { category?: unknown }).category !== "score.scientific-legacy" ||
    typeof (raw as { formula?: unknown }).formula !== "string"
  ) {
    throw new Error(`Invalid paper score rule ${key}`);
  }
  return raw as {
    readonly category: "score.scientific-legacy";
    readonly formula: string;
  };
}

function awardPaperDiscoveryScore(
  tx: SimulationTransaction,
  content: CompiledContent,
  paper: PaperDefinition,
  worldFirst: boolean,
): void {
  const rule = paperScoreRule(
    content,
    worldFirst ? "worldFirst" : "independentlyRediscovered",
  );
  const amount = worldFirst
    ? paper.discovery.worldFirstAura * 100
    : Math.floor(paper.discovery.worldFirstAura * 100 * REDISCOVERY_PRESTIGE_MULTIPLIER);
  awardScore(tx, {
    key: `paper/${worldFirst ? "world-first" : "rediscovery"}/${paper.id}`,
    categoryId: rule.category,
    amount,
    source: { kind: "system", id: paper.id },
    explanationKey: worldFirst ? "score.paper.world-first" : "score.paper.rediscovery",
  });
}

function humanizePaperIdentifier(value: string): string {
  return value
    .replaceAll("-", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPaperNumber(value: number): string {
  const rounded = String(Number(value.toFixed(1)));
  const [integer = "0", fraction] = rounded.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Player-facing label shared by the archive and publication preview. */
export function describePaperUnlockEffect(
  effect: PaperDefinition["unlockEffects"][number],
): string {
  if (effect.operation === "unlock") {
    const name = effect.target.startsWith("research.family.")
      ? effect.target.replace("research.family.", "")
      : (effect.target.split(".").at(-1) ?? effect.target);
    return isFlavourUnlockTarget(effect.target)
      ? `Research lineage recorded: ${humanizePaperIdentifier(name)} (no direct bonus)`
      : `Unlocks ${humanizePaperIdentifier(name)}`;
  }
  const target = (() => {
    const researchDomain = /^lab\.research\.domain\.(.+)\.output$/.exec(effect.target);
    if (researchDomain?.[1] !== undefined) {
      return `${humanizePaperIdentifier(researchDomain[1])} research output`;
    }
    const prosperity = /^prosperity\.programme\.(.+)\.readiness$/.exec(effect.target);
    if (prosperity?.[1] !== undefined) {
      return `${humanizePaperIdentifier(prosperity[1])} prosperity readiness`;
    }
    return (
      {
        "lab.evals.quality": "Evaluation practice",
        "lab.evidence.displayedQuality": "Evaluation evidence quality",
        "lab.culture.safety.starting": "Safety culture",
        "lab.incident.hazard": "Incident risk",
        "lab.research.alignment.output": "Alignment research output",
        "lab.research.interpretability.output":
          "Interpretability and evals research output",
        "lab.research.security.output": "Security and containment research output",
        "lab.training.technicalFailureHazard": "Technical training failure risk",
        "lab.compute.ownedPowerCost": "Owned-GPU operating cost",
        "lab.costs.fixed": "Fixed operating cost",
        "serving.computePerRequest": "Serving compute per request",
        "world.rival.progress": "Global rival research speed",
      }[effect.target] ?? humanizePaperIdentifier(effect.target.replace(/^lab\./, ""))
    );
  })();
  if (typeof effect.value !== "number") return `${target} updated`;
  if (effect.operation === "multiply") {
    const percentage = (effect.value - 1) * 100;
    return `${target} ${percentage >= 0 ? "+" : "−"}${formatPaperNumber(Math.abs(percentage))}%`;
  }
  if (effect.operation === "add") {
    return `${target} ${effect.value >= 0 ? "+" : "−"}${formatPaperNumber(Math.abs(effect.value))}`;
  }
  return `${target} ${effect.operation === "min" ? "capped at" : "minimum"} ${formatPaperNumber(effect.value)}`;
}

function isNoOpPaperEffect(effect: PaperDefinition["unlockEffects"][number]): boolean {
  if (typeof effect.value !== "number") return false;
  return (
    (effect.operation === "add" && effect.value === 0) ||
    (effect.operation === "multiply" && effect.value === 1)
  );
}

/**
 * Effects suitable for a player-facing benefit list. Research-family flags
 * preserve the paper's lineage in state but do not gate or modify anything,
 * so presenting them as gameplay unlocks would be false. Private discoveries
 * also exclude world effects, which apply only when the result is published.
 */
export function paperMechanicalBenefits(
  paper: PaperDefinition,
  scope: "private" | "public" = "public",
): readonly PaperDefinition["unlockEffects"][number][] {
  return paper.unlockEffects.filter(
    (effect) =>
      !isNoOpPaperEffect(effect) &&
      !isFlavourUnlockTarget(effect.target) &&
      (scope === "public" || !effect.target.startsWith("world.")),
  );
}

export function describePaperScientificPayload(
  paper: PaperDefinition,
  scope: "private" | "public" = "public",
): string {
  const effects = paperMechanicalBenefits(paper, scope);
  return effects.length === 0
    ? "No additional mechanical unlocks"
    : effects.map(describePaperUnlockEffect).join("; ");
}

/**
 * Papers reward the field they claim to reward. Domain-specific research
 * boosts route to the per-programme target the resolver reads; recognised
 * lab-wide targets pass through unchanged. Returns undefined for targets
 * with no mechanical home (kept as audit flags until their copy is retired).
 */
function routePaperModifierTarget(target: string): string | undefined {
  const domain = /^lab\.research\.domain\.([a-z0-9-]+)\.output$/.exec(target);
  if (domain?.[1] !== undefined) {
    return `lab.research.program.base:domain.${domain[1]}.output`;
  }
  return isModifierTarget(target) ? target : undefined;
}

function reconcileMissingPaperModifierEffects(
  tx: SimulationTransaction,
  paper: PaperDefinition,
  labId: LabId,
): void {
  for (const effect of paper.unlockEffects) {
    if (
      isNoOpPaperEffect(effect) ||
      effect.target.startsWith("world.") ||
      effect.operation === "unlock" ||
      (effect.operation === "add" &&
        (effect.target === "lab.culture.safety.starting" ||
          effect.target === "lab.evals.quality")) ||
      typeof effect.value !== "number"
    ) {
      continue;
    }
    const routed = routePaperModifierTarget(effect.target);
    if (routed === undefined) continue;
    const alreadyApplied = Object.values(tx.read().modifiers).some(
      (modifier) =>
        modifier.source.id === paper.id &&
        modifier.labId === labId &&
        modifier.target === routed &&
        modifier.operation === effect.operation &&
        modifier.tags.includes("paper-unlock") &&
        modifier.tags.includes(effect.target),
    );
    if (alreadyApplied) continue;
    applyEffect(
      tx,
      {
        kind: "add-modifier",
        subject: { type: "lab", labId },
        target: routed,
        operation: effect.operation,
        value: effect.value,
        tags: ["paper-unlock", paper.id, effect.target],
      },
      { kind: "system", id: paper.id },
    );
  }
}

function applyPaperUnlocks(
  tx: SimulationTransaction,
  paper: PaperDefinition,
  labId: LabId,
): void {
  const marker = `${PAPER_EFFECTS_APPLIED_FLAG_PREFIX}${paper.id}`;
  const lab = tx.read().labs[labId];
  if (lab === undefined) throw new Error(`Unknown paper-benefit lab ${labId}`);
  if (lab.flags[marker] === true) {
    reconcileMissingPaperModifierEffects(tx, paper, labId);
    return;
  }
  for (const effect of paper.unlockEffects) {
    if (isNoOpPaperEffect(effect)) continue;
    // World effects are consequences of making knowledge public, not a private
    // scientific advantage belonging to one lab.
    if (effect.target.startsWith("world.")) continue;
    if (effect.operation === "unlock") {
      applyEffect(
        tx,
        {
          kind: "set-flag",
          subject: { type: "lab", labId },
          flag: effect.target,
          value: true,
        },
        { kind: "system", id: paper.id },
      );
      continue;
    }
    if (
      effect.target === "lab.culture.safety.starting" &&
      effect.operation === "add" &&
      typeof effect.value === "number"
    ) {
      applyEffect(
        tx,
        {
          kind: "add-rating",
          subject: { type: "lab", labId },
          rating: "safetyCulture",
          amount: effect.value,
        },
        { kind: "system", id: paper.id },
      );
      continue;
    }
    if (
      effect.target === "lab.evals.quality" &&
      effect.operation === "add" &&
      typeof effect.value === "number"
    ) {
      applyEffect(
        tx,
        {
          kind: "add-rating",
          subject: { type: "lab", labId },
          rating: "evalQuality",
          amount: effect.value,
        },
        { kind: "system", id: paper.id },
      );
      continue;
    }
    const routed =
      typeof effect.value === "number"
        ? routePaperModifierTarget(effect.target)
        : undefined;
    if (routed !== undefined && typeof effect.value === "number") {
      applyEffect(
        tx,
        {
          kind: "add-modifier",
          subject: { type: "lab", labId },
          target: routed,
          operation: effect.operation,
          value: effect.value,
          tags: ["paper-unlock", paper.id, effect.target],
        },
        { kind: "system", id: paper.id },
      );
      continue;
    }
    applyEffect(
      tx,
      {
        kind: "set-flag",
        subject: { type: "lab", labId },
        flag: `paper-effect:${paper.id}:${effect.target}:${effect.operation}`,
        value: effect.value,
      },
      { kind: "system", id: paper.id },
    );
  }
  applyEffect(
    tx,
    {
      kind: "set-flag",
      subject: { type: "lab", labId },
      flag: marker,
      value: true,
    },
    { kind: "system", id: paper.id },
  );
}

function applyPublicGlobalPaperEffects(
  tx: SimulationTransaction,
  paper: PaperDefinition,
): void {
  const playerLabId = tx.read().run.playerLabId;
  const marker = `${PAPER_PUBLIC_GLOBAL_EFFECTS_FLAG_PREFIX}${paper.id}`;
  if (tx.read().labs[playerLabId]?.flags[marker] === true) return;
  for (const effect of paper.unlockEffects) {
    if (
      isNoOpPaperEffect(effect) ||
      !effect.target.startsWith("world.") ||
      typeof effect.value !== "number" ||
      effect.operation === "unlock"
    ) {
      continue;
    }
    const routed = routePaperModifierTarget(effect.target);
    if (routed === undefined) continue;
    applyEffect(
      tx,
      {
        kind: "add-modifier",
        target: routed,
        operation: effect.operation,
        value: effect.value,
        tags: ["paper-public-unlock", paper.id, effect.target],
      },
      { kind: "system", id: paper.id },
    );
  }
  applyEffect(
    tx,
    {
      kind: "set-flag",
      subject: { type: "player-lab" },
      flag: marker,
      value: true,
    },
    { kind: "system", id: paper.id },
  );
}

function grantPublishedPaperBenefits(
  tx: SimulationTransaction,
  paper: PaperDefinition,
): void {
  for (const labId of Object.keys(tx.read().labs).sort() as LabId[]) {
    applyPaperUnlocks(tx, paper, labId);
  }
  applyPublicGlobalPaperEffects(tx, paper);
}

function awardRediscoveryPrestige(
  tx: SimulationTransaction,
  content: CompiledContent,
  paper: PaperDefinition,
): void {
  awardPaperDiscoveryScore(tx, content, paper, false);
  const rawAura = Math.max(
    1,
    Math.round(paper.discovery.worldFirstAura * REDISCOVERY_PRESTIGE_MULTIPLIER),
  );
  const award = calculateAuraGain(tx.read(), rawAura, [
    "aura.worldFirstCapabilityPaperGain",
  ]);
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "player-lab" },
      resource: "aura-spendable",
      amount: award.final,
      auraChangeKind: "gain",
      auraCategory: "paper",
      auraSignalImpact: award.final * content.aura.paperSignalImpactPerAura,
    },
    { kind: "system", id: paper.id },
  );
}

function recordDiscovery(
  tx: SimulationTransaction,
  content: CompiledContent,
  paper: PaperDefinition,
  labId: string,
  worldFirst: boolean,
): void {
  const isPlayer = labId === tx.read().run.playerLabId;
  tx.update((draft) => {
    const lab = draft.labs[labId as LabId];
    if (lab !== undefined) {
      if (!lab.research.discoveredPaperIds.includes(paper.id)) {
        lab.research.discoveredPaperIds.push(paper.id);
      }
    } else if (!draft.world.paperRace.rival.discoveredPaperIds.includes(paper.id)) {
      draft.world.paperRace.rival.discoveredPaperIds.push(paper.id);
    }
    if (worldFirst) {
      draft.world.paperRace.discoveries[paper.id] = {
        paperId: paper.id,
        discovererLabId: labId,
        discoveredAt: draft.run.tick,
      };
    }
  });
  const canonicalLab = tx.read().labs[labId as LabId];
  if (canonicalLab !== undefined) {
    applyPaperUnlocks(tx, paper, canonicalLab.id);
  }
  if (isPlayer && !worldFirst) {
    awardRediscoveryPrestige(tx, content, paper);
  }
  tx.emit({ kind: "paper-discovered", paperId: paper.id, labId, worldFirst });
  // A world-first discovery still needs the player's publication decision.
  // Rediscoveries are informational and surface through the side-notice lane.
  if (isPlayer && worldFirst) tx.requestAutoPause("paper-discovered");
}

/**
 * Development saves from the diffusion-era engine can contain unscoped paper
 * modifiers. They were only ever awarded for player discoveries; pin them to
 * the player before reconciling the new immediate-publication rules.
 */
function scopeLegacyPaperModifiers(tx: SimulationTransaction): void {
  const playerLabId = tx.read().run.playerLabId;
  const legacyIds = Object.values(tx.read().modifiers)
    .filter(
      (modifier) =>
        modifier.labId === undefined && modifier.tags.includes("paper-unlock"),
    )
    .map((modifier) => modifier.id);
  if (legacyIds.length === 0) return;
  tx.update((draft) => {
    for (const modifierId of legacyIds) {
      const modifier = draft.modifiers[modifierId];
      if (modifier !== undefined) modifier.labId = playerLabId;
    }
  });
}

/**
 * Paper benefits are authored content, so balance corrections must also reach
 * modifiers already stored in a save. Match each paper modifier through the
 * original authored target retained in its tags and refresh its numerical
 * value without granting the paper a second time.
 */
function reconcilePaperModifierValues(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  tx.update((draft) => {
    for (const modifier of Object.values(draft.modifiers)) {
      if (
        !modifier.tags.includes("paper-unlock") &&
        !modifier.tags.includes("paper-public-unlock")
      ) {
        continue;
      }
      const paperId = modifier.source.id;
      const paper =
        paperId === undefined ? undefined : content.papers.definitions[paperId];
      if (paper === undefined) continue;
      const effect = paper.unlockEffects.find(
        (candidate) =>
          typeof candidate.value === "number" &&
          candidate.operation === modifier.operation &&
          modifier.tags.includes(candidate.target) &&
          routePaperModifierTarget(candidate.target) === modifier.target,
      );
      if (effect !== undefined && typeof effect.value === "number") {
        modifier.value = effect.value;
      }
    }
  });
}

function legacyPaperEffectsAppearApplied(
  state: Readonly<GameState>,
  paper: PaperDefinition,
  labId: LabId,
): boolean {
  const lab = state.labs[labId];
  if (lab === undefined) return false;
  return paper.unlockEffects.some((effect) => {
    if (effect.operation === "unlock") return lab.flags[effect.target] === effect.value;
    if (effect.target === "lab.evals.quality" && effect.operation === "add") {
      return false;
    }
    const fallbackFlag = `paper-effect:${paper.id}:${effect.target}:${effect.operation}`;
    if (fallbackFlag in lab.flags) return true;
    return Object.values(state.modifiers).some(
      (modifier) =>
        modifier.source.id === paper.id &&
        modifier.labId === labId &&
        modifier.tags.includes("paper-unlock") &&
        modifier.tags.includes(effect.target),
    );
  });
}

/**
 * Idempotently upgrades old saves and guarantees that every public paper has
 * paid its scientific payload to every canonical lab before this week's
 * breakthrough checks.
 */
export function reconcilePaperBenefits(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  scopeLegacyPaperModifiers(tx);
  reconcilePaperModifierValues(tx, content);
  const playerLabId = tx.read().run.playerLabId;
  for (const labId of Object.keys(tx.read().labs).sort() as LabId[]) {
    const discoveredPaperIds = tx.read().labs[labId]?.research.discoveredPaperIds ?? [];
    for (const paperId of discoveredPaperIds) {
      const paper = content.papers.definitions[paperId];
      if (paper === undefined) continue;
      const marker = `${PAPER_EFFECTS_APPLIED_FLAG_PREFIX}${paper.id}`;
      if (tx.read().labs[labId]?.flags[marker] === true) {
        applyPaperUnlocks(tx, paper, labId);
        continue;
      }
      if (
        labId === playerLabId &&
        legacyPaperEffectsAppearApplied(tx.read(), paper, labId)
      ) {
        // The old engine applied player benefits immediately but had no marker.
        // Mark them without duplicating ratings or modifiers.
        applyEffect(
          tx,
          {
            kind: "set-flag",
            subject: { type: "lab", labId },
            flag: marker,
            value: true,
          },
          { kind: "system", id: paper.id },
        );
        applyPaperUnlocks(tx, paper, labId);
      } else {
        applyPaperUnlocks(tx, paper, labId);
      }
    }
  }
  for (const discovery of Object.values(tx.read().world.paperRace.discoveries)) {
    if (!isPublicPaperDiscovery(discovery)) continue;
    const paper = content.papers.definitions[discovery.paperId];
    if (paper !== undefined) grantPublishedPaperBenefits(tx, paper);
  }
}

export function calculatePublicationScoreBonus(
  content: CompiledContent,
  paper: PaperDefinition,
  policy: PublicationPolicy,
): number {
  const bonuses = content.scoreRules.awardTables.paperAwards["publicationBonuses"];
  const bonusRule =
    bonuses !== null && typeof bonuses === "object"
      ? (bonuses as Record<string, unknown>)[policy]
      : undefined;
  const multiplier =
    bonusRule !== null && typeof bonusRule === "object"
      ? (bonusRule as { multiplierOnPaperAward?: unknown }).multiplierOnPaperAward
      : undefined;
  return typeof multiplier === "number" && multiplier > 0
    ? Math.floor(paper.discovery.worldFirstAura * 100 * multiplier)
    : 0;
}

export function calculatePaperPublicationAura(
  state: Readonly<GameState>,
  content: CompiledContent,
  paper: PaperDefinition,
  policy: PublicationPolicy,
  discovererLabId: string,
): number {
  if (policy === "keep-secret") return 0;
  const rule = content.papers.rules.publicationPolicies[policy];
  const openRelease = policy === "publish-openly" || policy === "release-everything";
  const priorOpenReleases = Object.values(state.world.paperRace.discoveries).filter(
    (candidate) =>
      candidate.discovererLabId === discovererLabId &&
      candidate.paperId !== paper.id &&
      (candidate.publicationPolicy === "publish-openly" ||
        candidate.publicationPolicy === "release-everything"),
  ).length;
  const noveltyMultiplier = openRelease
    ? Math.max(
        OPEN_RELEASE_NOVELTY_FLOOR,
        OPEN_RELEASE_NOVELTY_DECAY ** priorOpenReleases,
      )
    : 1;
  const rawAward = Math.max(
    1,
    Math.round(paper.discovery.worldFirstAura * rule.auraMultiplier * noveltyMultiplier),
  );
  return calculateAuraGain(state, rawAward, [
    "aura.worldFirstCapabilityPaperGain",
    ...(openRelease ? ["aura.openPaperModelOrDatasetGain"] : []),
  ]).final;
}

export function calculatePaperPublicationScore(
  content: CompiledContent,
  paper: PaperDefinition,
  policy: PublicationPolicy,
): number {
  if (policy === "keep-secret") return 0;
  return (
    paper.discovery.worldFirstAura * 100 +
    calculatePublicationScoreBonus(content, paper, policy)
  );
}

export function choosePublicationPolicy(
  tx: SimulationTransaction,
  content: CompiledContent,
  paperId: ContentId,
  policy: PublicationPolicy,
): void {
  const paper = content.papers.definitions[paperId];
  const discovery = tx.read().world.paperRace.discoveries[paperId];
  if (paper === undefined || discovery === undefined)
    throw new Error(`Unknown discovery ${paperId}`);
  if (discovery.publicationPolicy !== undefined)
    throw new Error(`${paperId} already has a policy`);
  reconcilePaperBenefits(tx, content);
  const publicRelease = policy !== "keep-secret";
  tx.update((draft) => {
    const mutable = draft.world.paperRace.discoveries[paperId];
    if (mutable === undefined) throw new Error(`Missing discovery ${paperId}`);
    mutable.publicationPolicy = policy;
    mutable.policyChosenAt = draft.run.tick;
  });
  if (publicRelease) grantPublishedPaperBenefits(tx, paper);
  if (discovery.discovererLabId === tx.read().run.playerLabId) {
    const openRelease = policy === "publish-openly" || policy === "release-everything";
    const auraAward = calculatePaperPublicationAura(
      tx.read(),
      content,
      paper,
      policy,
      discovery.discovererLabId,
    );
    if (auraAward > 0) {
      applyEffect(
        tx,
        {
          kind: "add-resource",
          subject: { type: "player-lab" },
          resource: "aura-spendable",
          amount: auraAward,
          auraChangeKind: "gain",
          auraCategory: "paper",
          auraSignalImpact: auraAward * content.aura.paperSignalImpactPerAura,
        },
        { kind: "system", id: paper.id },
      );
    }
    applyEffect(
      tx,
      {
        kind: "set-flag",
        subject: { type: "player-lab" },
        flag: `paper.policy.${paper.id}`,
        value: policy,
      },
      { kind: "system", id: paper.id },
    );
    if (publicRelease) {
      awardPaperDiscoveryScore(tx, content, paper, true);
      const publicationScoreBonus = calculatePublicationScoreBonus(
        content,
        paper,
        policy,
      );
      if (publicationScoreBonus > 0) {
        awardScore(tx, {
          key: `paper/publication/${paper.id}/${policy}`,
          categoryId: "score.scientific-legacy",
          amount: publicationScoreBonus,
          source: { kind: "system", id: paper.id },
          explanationKey: `score.paper.publication.${policy}`,
        });
      }
    }
    recordResearcherPublicationCompactEvent(
      tx,
      content,
      tx.read().run.playerLabId,
      paper.tags,
      policy,
    );
    if (openRelease) {
      recordResearcherCompactActions(tx, content, tx.read().run.playerLabId, [
        "open-paper",
      ]);
    }
  }
  tx.emit({ kind: "paper-publication-policy-chosen", paperId, policy });
}

function publicationPolicyForRival(
  state: Readonly<GameState>,
  labId: LabId,
  paperId: ContentId,
): PublicationPolicy {
  const personality = state.world.rivals[labId]?.personality;
  if (personality === undefined) return "publish-openly";
  if (personality.secrecy >= 95) return "keep-secret";
  if (personality.secrecy <= 5) return "publish-openly";
  const draw = new RandomOracleV1(state.run.seed).uniform(
    randomKey("paper", "rival-publication-policy", labId, paperId),
  );
  return draw < deriveRivalPublicationChance(state, labId)
    ? "publish-openly"
    : "keep-secret";
}

/**
 * Rivals are culturally inclined to publish ordinary early science, but become
 * more guarded as the race approaches the frontier. Personality shifts the
 * tendency without making every rival behave identically.
 */
export function deriveRivalPublicationChance(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  const baseChance: Readonly<Record<GamePhase, number>> = {
    foundation: 0.92,
    scaling: 0.76,
    frontier: 0.36,
    crisis: 0.16,
  };
  const secrecy = state.world.rivals[labId]?.personality.secrecy ?? 50;
  return Math.min(
    0.98,
    Math.max(0.02, baseChance[state.run.phase] - (secrecy - 50) * 0.006),
  );
}

function activePaperLabIds(state: Readonly<GameState>): readonly string[] {
  return Object.keys(state.world.rivals).length === 0
    ? state.world.paperRace.labOrder
    : state.world.paperRace.labOrder.filter(
        (labId) => state.labs[labId as LabId] !== undefined,
      );
}

/**
 * Roll one seeded breakthrough check for every lab/paper pair whose authored
 * paper, facility, era, and research-level requirements are met. Research
 * output buys programme levels; it is never counted a second time on a hidden
 * paper progress bar. A rival's levels here are its hidden paper levels (its
 * research less most of its off-screen boost), and a player focus programme's
 * papers need `playerFocus.levelDiscount` fewer levels.
 */
export function advancePaperRace(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): readonly PaperBreakthroughCheck[] {
  reconcilePaperBenefits(tx, content);
  const state = tx.read();
  const labIds = activePaperLabIds(state);
  const checks = labIds.flatMap((labId) => {
    // Knowledge, paper levels and the focus set are read once per lab per week.
    const context = labPaperRaceContext(state, content, labId);
    return eligiblePapers(content, context).map((paper) =>
      paperBreakthroughCheck(state, content, labId, paper, context, oracle),
    );
  });
  const successful = new Set(
    checks
      .filter((check) => check.success)
      .map((check) => `${check.labId}\u0000${check.paperId}`),
  );
  const paperOrder = Object.values(content.papers.definitions).sort(
    (left, right) => left.gameOrder - right.gameOrder || (left.id < right.id ? -1 : 1),
  );
  for (const paper of paperOrder) {
    const discoveringLabs = labIds.filter(
      (labId) =>
        successful.has(`${labId}\u0000${paper.id}`) &&
        !labKnowledge(tx.read(), labId).knownPaperIds.has(paper.id),
    );
    if (discoveringLabs.length === 0) continue;

    const existingWorldFirst = tx.read().world.paperRace.discoveries[paper.id];
    let worldFirstLab: string | undefined;

    if (existingWorldFirst === undefined) {
      if (discoveringLabs.length === 1) {
        worldFirstLab = discoveringLabs[0];
      } else {
        const winnerIndex = oracle.integer(
          randomKey("paper-race", "world-first", String(tx.read().run.tick), paper.id),
          0,
          discoveringLabs.length - 1,
        );
        worldFirstLab = discoveringLabs[winnerIndex];
      }
    }

    if (worldFirstLab !== undefined) {
      recordDiscovery(tx, content, paper, worldFirstLab, true);
      if (tx.read().world.rivals[worldFirstLab as LabId] !== undefined) {
        const rivalLabId = worldFirstLab as LabId;
        const policy = publicationPolicyForRival(tx.read(), rivalLabId, paper.id);
        choosePublicationPolicy(tx, content, paper.id, policy);
        const rivalLab = tx.read().labs[rivalLabId];
        if (policy !== "keep-secret" && rivalLab !== undefined) {
          const relevantLevels = Object.keys(paper.domainWeights).map(
            (domainId) => rivalLab.research.domains[domainId]?.level ?? 0,
          );
          const actualValue =
            relevantLevels.length === 0
              ? 0
              : relevantLevels.reduce<number>((sum, value) => sum + value, 0) /
                relevantLevels.length;
          recordRivalPublicSignal(tx, {
            labId: rivalLabId,
            kind: "release",
            subjectId: paper.id,
            actualValue,
            baseErrorRadius: 10,
            summary: `${paper.title} is now public. Your lab immediately received: ${describePaperScientificPayload(paper)}.`,
          });
        }
      }
    }

    for (const labId of discoveringLabs) {
      if (labId === worldFirstLab) continue;
      recordDiscovery(tx, content, paper, labId, false);
    }
  }
  tx.update((draft) => {
    for (const lab of Object.values(draft.labs)) {
      if (lab.flags[CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG] === draft.run.tick) {
        delete lab.flags[CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG];
      }
    }
  });
  return checks;
}
