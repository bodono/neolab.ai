import type { CompiledContent, ResearcherDefinition } from "@neolab/content-schema";

import { calculateAuraSignal } from "../aura/aura.ts";
import { applyEffects } from "../engine/effect-executor.ts";
import { formatValuation } from "../finance/valuation.ts";
import { resolveCheck } from "../engine/checks.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { invalidateResearcherUltimatumEvents } from "../events/researcher-ultimatum-lifecycle.ts";
import { frontierLeadShare } from "../engine/world-progression.ts";
import type { LabId, ResearcherId } from "../model/ids.ts";
import type {
  GameState,
  LabState,
  ResearcherDepartureCheckState,
  ResearcherMemoryEffectState,
  ResearcherPromiseConditionState,
  ResearcherState,
} from "../model/state.ts";
import { cashMillions, fraction, rating, tick, type Tick } from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { recordRivalPublicSignal } from "../rivals/signals.ts";
import {
  addResearcherPromise,
  recordResearcherMemory,
  ZERO_RESEARCHER_MEMORY_EFFECT,
} from "./promises.ts";
import {
  researcherSkillForAssignment,
  syncResearcherAbilityModifiers,
} from "./researchers.ts";
import {
  reconcileResearcherHousing,
  researcherSalaryMarketMultiplier,
} from "./talent-market.ts";

/**
 * Departure pressure carried by a lab that is alone at the frontier. Working on
 * the best model in the world makes you the most-headhunted person in the
 * industry, so the lead itself costs retention.
 */
const FRONTIER_PULL_PRESSURE = 15;

export const ORGANISATION_DRIFT_RATE = 0.015;
export const RESEARCHER_CONTRACT_REVIEW_WEEKS = 52;
export const ACCEPTED_ULTIMATUM_PROTECTION_WEEKS = 52;
export const ORGANISATION_TARGET_FLAGS = {
  boardPatience: "rating-target:boardPatience",
  internalCandour: "rating-target:internalCandour",
  safetyCulture: "rating-target:safetyCulture",
} as const;

/**
 * Accepting an ultimatum is a genuine retention settlement, not merely a
 * rating boost. Routine departure checks and new rival approaches pause while
 * the protected arrangement is active; a fresh player-caused breach can still
 * provoke another crisis.
 */
export function hasAcceptedUltimatumProtection(
  researcher: Readonly<ResearcherState>,
  currentTick: Tick,
): boolean {
  return (
    researcher.ultimatum?.status === "accepted" &&
    researcher.ultimatum.resolvedAt !== undefined &&
    currentTick - researcher.ultimatum.resolvedAt < ACCEPTED_ULTIMATUM_PROTECTION_WEEKS
  );
}

const ORGANISATION_TARGET_MODIFIERS = {
  boardPatience: "lab.organisation.boardPatienceTarget",
  internalCandour: "lab.organisation.internalCandourTarget",
  safetyCulture: "lab.organisation.safetyCultureTarget",
} as const;

type OrganisationRatingKey = keyof typeof ORGANISATION_TARGET_FLAGS;

export interface OrganisationRatingDrift {
  readonly key: OrganisationRatingKey;
  readonly oldValue: number;
  readonly target: number;
  readonly newValue: number;
}

export interface ResearcherStateTargets {
  readonly morale: number;
  readonly loyalty: number;
  readonly burnout: number;
  readonly departurePressure: number;
}

export interface ResearcherSalaryAdjustment {
  readonly researcherId: ResearcherId;
  readonly previousSalaryPerCycle: number;
  readonly nextSalaryPerCycle: number;
}

export interface DeparturePressureBreakdown {
  readonly researcherId: ResearcherId;
  readonly lowMorale: number;
  readonly lowLoyalty: number;
  readonly burnout: number;
  readonly unhoused: number;
  readonly compact: number;
  readonly brokenPromises: number;
  readonly rivalContact: number;
  readonly frontierPull: number;
  readonly target: number;
}

export interface RetentionPromiseInput {
  readonly label: string;
  readonly dueInWeeks: number;
  readonly condition: ResearcherPromiseConditionState;
  readonly severity: "minor" | "major" | "flagrant";
  readonly keptMemory: ResearcherMemoryEffectState;
  readonly brokenMemory: ResearcherMemoryEffectState;
}

export interface RetentionOfferInput {
  readonly package: "reassurance" | "serious";
  readonly promise?: RetentionPromiseInput;
}

export interface RetentionOfferPreview {
  readonly researcherId: ResearcherId;
  readonly signingCash: number;
  readonly auraSpend: number;
  readonly strengthGain: number;
  readonly currentPlayerRetentionStrength: number;
  readonly resultingPlayerRetentionStrength: number;
  readonly resolvesAt: number;
  readonly blockers: readonly string[];
}

export interface DismissalQuote {
  readonly researcherId: ResearcherId;
  readonly severanceCash: number;
  readonly auraLoss: number;
  readonly knowledgeTransferFraction: number;
  readonly blockers: readonly string[];
}

export type UltimatumResponse = "accept-conditions" | "wish-well";

export interface UltimatumResponsePreview {
  readonly researcherId: ResearcherId;
  readonly response: UltimatumResponse;
  readonly auraCost: number;
  readonly createsPromise: boolean;
  readonly blockers: readonly string[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function drift(oldValue: number, target: number): number {
  return clamp(oldValue + (target - oldValue) * ORGANISATION_DRIFT_RATE);
}

function requireLab(state: Readonly<GameState>, labId: LabId): LabState {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function requireResearcher(
  state: Readonly<GameState>,
  researcherId: ResearcherId,
): ResearcherState {
  const researcher = state.researchers[researcherId];
  if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
  return researcher;
}

function requireDefinition(
  content: CompiledContent,
  researcher: ResearcherState,
): ResearcherDefinition {
  const definition = content.researchers.definitions[researcher.definitionId];
  if (definition === undefined) {
    throw new Error(`Missing researcher definition ${researcher.definitionId}`);
  }
  return definition;
}

function researcherDisplayName(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcherId: ResearcherId,
): string {
  return requireDefinition(content, requireResearcher(state, researcherId)).displayName;
}

function rivalLabDisplayName(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: string,
): string {
  const lab = state.labs[labId as LabId];
  return lab === undefined
    ? "A rival lab"
    : (content.labs[lab.definitionId]?.displayName ?? "A rival lab");
}

function currentOrganisationValue(lab: LabState, key: OrganisationRatingKey): number {
  switch (key) {
    case "boardPatience":
      return lab.organisation.boardPatience;
    case "internalCandour":
      return lab.organisation.hiddenInternalCandour;
    case "safetyCulture":
      return lab.safety.safetyCulture;
  }
}

/**
 * Standing floor under safety culture, for permanent sources such as a
 * researcher on staff. The *Target modifiers above resolve against the current
 * value, so "add 3" means "aim three points above wherever you are" -- a
 * treadmill that is fine for the time-limited event nudges that use it but
 * climbs forever behind a permanent one. A floor says what a researcher
 * actually promises: while they are here, culture does not sit below this.
 */
export const SAFETY_CULTURE_FLOOR_MODIFIER = "lab.organisation.safetyCultureFloor";
/** Neutral culture, the floor before any modifier lifts it. */
export const SAFETY_CULTURE_FLOOR_BASE = 50;

/** Apply the exact GDD 31.4 weekly equilibrium drift to organisation ratings. */
export function updateOrganisationRatings(
  tx: SimulationTransaction,
): readonly OrganisationRatingDrift[] {
  const state = tx.read();
  const lab = requireLab(state, state.run.playerLabId);
  const changes = (Object.keys(ORGANISATION_TARGET_FLAGS) as OrganisationRatingKey[]).map(
    (key): OrganisationRatingDrift => {
      const oldValue = currentOrganisationValue(lab, key);
      const flagged = lab.flags[ORGANISATION_TARGET_FLAGS[key]];
      const baseTarget = typeof flagged === "number" ? flagged : oldValue;
      const target = resolveModifierValue(
        state,
        ORGANISATION_TARGET_MODIFIERS[key],
        baseTarget,
        { clampMin: 0, clampMax: 100 },
      ).final;
      const drifted = drift(oldValue, target);
      if (key !== "safetyCulture") return { key, oldValue, target, newValue: drifted };
      // Pull up to the floor, never down: a lab that has earned better culture
      // than its floor keeps it.
      const floor = resolveModifierValue(
        state,
        SAFETY_CULTURE_FLOOR_MODIFIER,
        SAFETY_CULTURE_FLOOR_BASE,
        { clampMin: 0, clampMax: 100 },
      ).final;
      return {
        key,
        oldValue,
        target: Math.max(target, floor),
        newValue: Math.max(drifted, Math.min(floor, oldValue + 1)),
      };
    },
  );
  tx.update((draft) => {
    const mutable = draft.labs[state.run.playerLabId];
    if (mutable === undefined) throw new Error("Player lab missing");
    for (const change of changes) {
      switch (change.key) {
        case "boardPatience":
          mutable.organisation.boardPatience = rating(change.newValue);
          break;
        case "internalCandour":
          mutable.organisation.hiddenInternalCandour = rating(change.newValue);
          break;
        case "safetyCulture":
          mutable.safety.safetyCulture = rating(change.newValue);
          break;
      }
    }
  });
  return changes;
}

/**
 * Apply a visible five-percent market/seniority review on each researcher's
 * individual 52-week contract anniversary. The agreed-at tick remains the
 * immutable anniversary anchor, so save/load and replay cannot double-apply a
 * review.
 */
export function advanceResearcherSalaryReviews(
  tx: SimulationTransaction,
  content: CompiledContent,
): readonly ResearcherSalaryAdjustment[] {
  const state = tx.read();
  const reviewAt = state.run.tick + 1;
  const adjustments = Object.values(state.researchers)
    .filter(
      (researcher) =>
        (researcher.status === "employed" || researcher.status === "sabbatical") &&
        researcher.contract !== undefined &&
        reviewAt > researcher.contract.agreedAt &&
        (reviewAt - researcher.contract.agreedAt) % RESEARCHER_CONTRACT_REVIEW_WEEKS ===
          0,
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((researcher): ResearcherSalaryAdjustment => {
      const previousSalaryPerCycle = researcher.contract?.salaryPerCycle ?? 0;
      // The review re-marks the contract to the same market that prices new
      // listings: base pay times inflation times the AGI-proximity boom. A
      // star signed cheap early therefore becomes expensive to keep as the
      // world frontier advances -- with up to a year of lag, which is the
      // player's window to enjoy the discount. Salaries never fall: the
      // frontier only rises, and the floor keeps a quiet year from reading
      // as a pay cut.
      const definition = content.researchers.definitions[researcher.definitionId];
      const marked =
        (definition?.contract.baseSalaryPerCycle ?? previousSalaryPerCycle) *
        researcherSalaryMarketMultiplier(state, reviewAt);
      const nextSalaryPerCycle = Math.max(
        previousSalaryPerCycle,
        Math.round(marked * 100) / 100,
      );
      return {
        researcherId: researcher.id,
        previousSalaryPerCycle,
        nextSalaryPerCycle,
      };
    });
  if (adjustments.length === 0) return adjustments;
  tx.update((draft) => {
    for (const adjustment of adjustments) {
      const researcher = draft.researchers[adjustment.researcherId];
      if (researcher?.contract === undefined) continue;
      researcher.contract.salaryPerCycle = cashMillions(adjustment.nextSalaryPerCycle);
      if (researcher.employerLabId !== draft.run.playerLabId) continue;
      const definition = content.researchers.definitions[researcher.definitionId];
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${definition?.displayName ?? "A star researcher"} received the annual market review: ${formatValuation(adjustment.previousSalaryPerCycle)} → ${formatValuation(adjustment.nextSalaryPerCycle)} per cycle (${adjustment.previousSalaryPerCycle > 0 ? `+${String(Math.round((adjustment.nextSalaryPerCycle / adjustment.previousSalaryPerCycle - 1) * 100))}%` : "new mark"}).`,
        category: "researcher-contract-adjustment",
        source: { kind: "researcher", id: researcher.definitionId },
        relatedIds: [researcher.id],
      });
    }
  });
  return adjustments;
}

function recentMemoryCount(
  state: Readonly<GameState>,
  researcher: ResearcherState,
  kind: ResearcherState["memories"][number]["kind"],
): number {
  return researcher.memories.filter(
    (memory) => memory.kind === kind && state.run.tick - memory.occurredAt <= 52,
  ).length;
}

export function calculateDeparturePressure(
  state: Readonly<GameState>,
  researcherId: ResearcherId,
): DeparturePressureBreakdown {
  const researcher = requireResearcher(state, researcherId);
  const lowMorale = Math.max(0, 50 - researcher.morale) * 0.8;
  const lowLoyalty = Math.max(0, 45 - researcher.loyalty) * 0.9;
  const burnout = Math.max(0, researcher.burnout - 50) * 0.85;
  const unhoused = researcher.housing === "unhoused" ? 18 : 0;
  const compact =
    researcher.compact.status === "breached"
      ? 15
      : researcher.compact.status === "warning"
        ? 5
        : 0;
  const brokenPromises = recentMemoryCount(state, researcher, "promise-broken") * 12;
  const rivalContact =
    researcher.poaching !== undefined && researcher.poaching.stage !== "resolved"
      ? 12
      : 0;
  const frontierPull =
    researcher.employerLabId === undefined
      ? 0
      : frontierLeadShare(state, researcher.employerLabId) * FRONTIER_PULL_PRESSURE;
  const raw =
    lowMorale +
    lowLoyalty +
    burnout +
    unhoused +
    compact +
    brokenPromises +
    rivalContact +
    frontierPull;
  const target = resolveModifierValue(state, "researcher.departurePressure", raw, {
    clampMin: 0,
    clampMax: 100,
  }).final;
  return {
    researcherId,
    lowMorale,
    lowLoyalty,
    burnout,
    unhoused,
    compact,
    brokenPromises,
    rivalContact,
    frontierPull,
    target,
  };
}

export function calculateResearcherStateTargets(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcherId: ResearcherId,
): ResearcherStateTargets {
  const researcher = requireResearcher(state, researcherId);
  const definition = requireDefinition(content, researcher);
  const lab = requireLab(state, state.run.playerLabId);
  const skill =
    researcher.assignment === undefined
      ? 0
      : (definition.skills[researcherSkillForAssignment(researcher.assignment)] ?? 0);
  const safetyAffinity =
    (definition.skills["alignmentControl"] ?? 0) +
    (definition.skills["interpretabilityEvals"] ?? 0) +
    (definition.skills["securityContainment"] ?? 0);
  const compactPenalty =
    researcher.compact.status === "breached"
      ? 22
      : researcher.compact.status === "warning"
        ? 8
        : 0;
  // Base raised 42 -> 44. The research-freedom term that used to sit in this
  // sum contributed (freedom - 50) * 0.18 for open-science researchers, about
  // +1.8 at the starting value of 60. Folding a comparable amount into the base
  // keeps morale where it was, for every researcher rather than only the
  // open-science ones, and without a stat the player could not interpret.
  const moraleBase =
    44 +
    skill * 6 +
    (safetyAffinity / 15) * (lab.safety.safetyCulture / 100) * 10 +
    Math.min(8, calculateAuraSignal(state, content, lab.id).final / 20) -
    (researcher.housing === "unhoused" ? 20 : 0) -
    researcher.burnout * 0.2 -
    compactPenalty;
  const morale = resolveModifierValue(state, "researcher.moraleTarget", moraleBase, {
    clampMin: 0,
    clampMax: 100,
  }).final;
  const tenureWeeks = Math.max(
    0,
    state.run.tick - (researcher.employedAt ?? state.run.tick),
  );
  const loyaltyBase =
    48 +
    Math.min(18, tenureWeeks / 26) +
    (researcher.morale - 50) * 0.2 -
    (researcher.poaching !== undefined && researcher.poaching.stage !== "resolved"
      ? 12
      : 0) -
    (researcher.compact.status === "breached" ? 10 : 0);
  const loyalty = resolveModifierValue(state, "researcher.loyalty", loyaltyBase, {
    clampMin: 0,
    clampMax: 100,
  }).final;
  const assignedProject =
    researcher.assignment?.targetId === undefined
      ? undefined
      : Object.values(state.projects).find(
          (project) => project.id === researcher.assignment?.targetId,
        );
  const recentIncidents = state.incidents.filter(
    (incident) => state.run.tick - incident.occurredAt <= 13,
  ).length;
  const crunch = lab.flags["organisation:crunch"] === true ? 25 : 0;
  const projectLoad = assignedProject?.status === "active" ? 20 : 0;
  const autonomyLoad = Math.max(
    0,
    ...Object.values(state.models)
      .filter((model) => model.ownerLabId === state.run.playerLabId)
      .map((model) => (model.accessLevel >= 3 ? 8 : 0)),
  );
  const burnoutBase =
    researcher.status === "sabbatical"
      ? 0
      : 12 +
        crunch +
        projectLoad +
        Math.min(15, recentIncidents * 5) +
        autonomyLoad +
        (researcher.housing === "unhoused" ? 10 : 0);
  const burnout = resolveModifierValue(state, "researcher.burnoutTarget", burnoutBase, {
    clampMin: 0,
    clampMax: 100,
  }).final;
  return {
    morale,
    loyalty,
    burnout,
    departurePressure: calculateDeparturePressure(state, researcherId).target,
  };
}

/** Drift all active researcher ratings toward their current policy-dependent targets. */
export function updateResearcherStates(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  const targets = Object.values(state.researchers)
    .filter(
      (researcher) =>
        researcher.status === "employed" || researcher.status === "sabbatical",
    )
    .map((researcher) => ({
      researcherId: researcher.id,
      targets: calculateResearcherStateTargets(state, content, researcher.id),
    }));
  tx.update((draft) => {
    for (const entry of targets) {
      const researcher = draft.researchers[entry.researcherId];
      if (researcher === undefined) continue;
      researcher.morale = rating(drift(researcher.morale, entry.targets.morale));
      researcher.loyalty = rating(drift(researcher.loyalty, entry.targets.loyalty));
      researcher.burnout = rating(drift(researcher.burnout, entry.targets.burnout));
      researcher.departurePressure = rating(
        drift(researcher.departurePressure, entry.targets.departurePressure),
      );
      if (
        researcher.status === "employed" &&
        researcher.housing === "unhoused" &&
        researcher.unhousedSince === undefined
      ) {
        researcher.unhousedSince = draft.run.tick;
      }
    }
  });
}

function hasRecentFlagrantBreach(
  state: Readonly<GameState>,
  researcher: ResearcherState,
): boolean {
  return researcher.memories.some(
    (memory) =>
      memory.kind === "promise-broken" &&
      memory.flagrant &&
      state.run.tick - memory.occurredAt <= 13,
  );
}

function transferFraction(lab: LabState, researcher: ResearcherState): number {
  return clamp(
    0.6 - lab.safety.securityPosture / 250 - researcher.loyalty / 500,
    0.2,
    0.6,
  );
}

function snapshotKnowledgeTransfer(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcher: ResearcherState,
  sourceLabId: LabId,
  rivalLabId: string,
) {
  const lab = requireLab(state, sourceLabId);
  const definition = requireDefinition(content, researcher);
  const fractionValue = transferFraction(lab, researcher);
  const progressByPaper = Object.fromEntries(
    definition.paperHooks.ids.flatMap((paperId) => {
      const progress = lab.research.paperProgress[paperId] ?? 0;
      const discovery = state.world.paperRace.discoveries[paperId];
      const isSecret =
        discovery === undefined || discovery.publicationPolicy === "keep-secret";
      return progress > 0 && isSecret ? [[paperId, progress * fractionValue]] : [];
    }),
  );
  return {
    rivalLabId,
    scheduledAt: state.run.tick,
    dueAt: tick(state.run.tick + 4 + Math.floor(lab.safety.securityPosture / 25)),
    fraction: fraction(fractionValue),
    progressByPaper,
  };
}

export function departResearcher(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
  reason: "voluntary" | "poached" | "dismissed" | "ultimatum-expired",
  rivalLabId = content.papers.rules.rivalStub.labId,
): void {
  const state = tx.read();
  const researcher = requireResearcher(state, researcherId);
  const researcherName = requireDefinition(content, researcher).displayName;
  const rivalLabName = rivalLabDisplayName(state, content, rivalLabId);
  if (researcher.status !== "employed" && researcher.status !== "sabbatical") {
    throw new Error(`${researcherId} is not employed`);
  }
  const labId = researcher.employerLabId;
  if (labId === undefined) throw new Error(`${researcherId} has no employer`);
  const pendingUltimatumId =
    researcher.ultimatum?.status === "pending" ? researcher.ultimatum.id : undefined;
  const knowledgeTransfer = snapshotKnowledgeTransfer(
    state,
    content,
    researcher,
    labId,
    rivalLabId,
  );
  recordResearcherMemory(tx, researcherId, {
    kind: "departure",
    summary: `${researcherName} departed (${reason})`,
    effect: ZERO_RESEARCHER_MEMORY_EFFECT,
    flagrant: false,
  });
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    const lab = draft.labs[labId];
    if (mutable === undefined || lab === undefined)
      throw new Error("Departure target missing");
    mutable.status = "departed";
    mutable.housing = "unhoused";
    delete mutable.unhousedSince;
    delete mutable.employerLabId;
    delete mutable.assignment;
    if (mutable.ultimatum?.status === "pending") {
      mutable.ultimatum.status = "expired";
      mutable.ultimatum.resolvedAt = draft.run.tick;
    }
    mutable.knowledgeTransfer = structuredClone(knowledgeTransfer);
    mutable.flags["departureReason"] = reason;
    mutable.flags["nextEmployer"] = rivalLabId;
    lab.roster.researcherIds = lab.roster.researcherIds.filter(
      (candidateId) => candidateId !== researcherId,
    );
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${researcherName} left the lab (${reason}).`,
      category: "narrative",
      source: { kind: "researcher", id: researcher.definitionId },
      relatedIds: [labId, researcherId],
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `researcher.departed:${researcherId}:${reason}`,
    });
    if (labId === draft.run.playerLabId) {
      const key = `researcher-departure:${researcherId}:${String(draft.run.tick)}`;
      if (!draft.presentationQueue.some((item) => item.key === key)) {
        draft.presentationQueue.push({
          key,
          kind: "researcher-departure",
          attention: "modal",
          researcherId,
          definitionId: mutable.definitionId,
          reason,
          ...(reason === "poached" ? { rivalLabId } : {}),
          createdAt: draft.run.tick,
        });
      }
    }
  });
  if (pendingUltimatumId !== undefined) {
    invalidateResearcherUltimatumEvents(
      tx,
      researcherId,
      pendingUltimatumId,
      "The researcher departed before the ultimatum event was resolved",
    );
  }
  syncResearcherAbilityModifiers(tx, content, researcherId);
  reconcileResearcherHousing(tx, labId);
  tx.emit({
    kind: "researcher-departed",
    researcherId,
    researcherName,
    formerLabId: labId,
    reason,
    rivalLabId,
  });
  if (reason === "poached" && state.world.rivals[rivalLabId as LabId] !== undefined) {
    recordRivalPublicSignal(tx, {
      labId: rivalLabId as LabId,
      kind: "hire",
      subjectId: researcherId,
      actualValue: researcher.ambition,
      baseErrorRadius: 6,
      summary: `${rivalLabName} hired ${researcherName}.`,
    });
  }
  if (labId === state.run.playerLabId) {
    tx.requestAutoPause("resignation-ultimatum");
  }
}

function issueUltimatum(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
  reason: ResearcherDepartureCheckState["reason"],
): void {
  const now = tx.read().run.tick;
  const researcherName = researcherDisplayName(tx.read(), content, researcherId);
  const id = tx.allocateId("people", "world");
  tx.update((draft) => {
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
    researcher.ultimatum = {
      id,
      reason,
      issuedAt: now,
      expiresAt: tick(now + 4),
      status: "pending",
    };
    draft.decisionLog.push({
      tick: now,
      summary: `${researcherName} issued a resignation ultimatum; respond within four weeks.`,
    });
  });
  recordResearcherMemory(tx, researcherId, {
    kind: "ultimatum-issued",
    summary: "Resignation ultimatum issued",
    effect: ZERO_RESEARCHER_MEMORY_EFFECT,
    flagrant: false,
  });
  tx.emit({
    kind: "researcher-ultimatum-issued",
    researcherId,
    ultimatumId: id,
    reason,
    expiresAt: tick(now + 4),
  });
  tx.requestAutoPause("resignation-ultimatum");
}

export function checkResearcherDeparture(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
  reason: ResearcherDepartureCheckState["reason"],
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): ResearcherDepartureCheckState {
  const state = tx.read();
  const researcher = requireResearcher(state, researcherId);
  if (researcher.status !== "employed" && researcher.status !== "sabbatical") {
    throw new Error(`${researcherId} is not employed`);
  }
  if (researcher.ultimatum?.status === "pending") {
    throw new Error(`${researcherId} already has a pending ultimatum`);
  }
  const provocationBonus = reason === "quarterly" ? 0 : 20;
  const effectivePressure = clamp(researcher.departurePressure + provocationBonus);
  const resolution = resolveCheck(
    oracle,
    randomKey("researcher-departure", researcherId, String(state.run.tick), reason),
    {
      strength: effectivePressure,
      difficulty: 65,
      minimumProbability: 0.02,
      maximumProbability: 0.9,
    },
  );
  const immediateDeparture =
    resolution.success &&
    (researcher.loyalty < 15 || hasRecentFlagrantBreach(state, researcher));
  const outcome: ResearcherDepartureCheckState["outcome"] = !resolution.success
    ? "stayed"
    : immediateDeparture
      ? "departed"
      : "ultimatum";
  const check: ResearcherDepartureCheckState = {
    checkedAt: state.run.tick,
    reason,
    pressure: rating(effectivePressure),
    probability: fraction(resolution.probability),
    draw: fraction(resolution.draw),
    outcome,
  };
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    if (mutable === undefined) throw new Error(`Unknown researcher ${researcherId}`);
    mutable.departureChecks.push(structuredClone(check));
  });
  if (outcome === "departed") {
    departResearcher(tx, content, researcherId, "voluntary");
  } else if (outcome === "ultimatum") {
    issueUltimatum(tx, content, researcherId, reason);
  }
  return check;
}

export function startPoachingAttempt(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
  rivalLabId: string,
  rivalOfferStrength: number,
): void {
  const state = tx.read();
  const researcher = requireResearcher(state, researcherId);
  const researcherName = requireDefinition(content, researcher).displayName;
  const rivalLabName = rivalLabDisplayName(state, content, rivalLabId);
  if (researcher.status !== "employed" || researcher.employerLabId === undefined) {
    throw new Error(`${researcherId} is not employed by a recruitable lab`);
  }
  if (researcher.poaching !== undefined && researcher.poaching.stage !== "resolved") {
    throw new Error(`${researcherId} already has an active poaching approach`);
  }
  if (hasAcceptedUltimatumProtection(researcher, state.run.tick)) {
    throw new Error(`${researcherId} is covered by an accepted retention settlement`);
  }
  if (!Number.isFinite(rivalOfferStrength)) {
    throw new RangeError("Rival offer strength must be finite");
  }
  const id = tx.allocateId("people", "world");
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    if (mutable === undefined) throw new Error(`Unknown researcher ${researcherId}`);
    mutable.poaching = {
      id,
      rivalLabId,
      stage: "rumour",
      signalledAt: state.run.tick,
      counterofferAt: tick(state.run.tick + 2),
      resolvesAt: tick(state.run.tick + 4),
      rivalOfferStrength,
      playerRetentionStrength: 0,
    };
    draft.decisionLog.push({
      tick: state.run.tick,
      summary: `${researcherName} was seen in an unusually long conference conversation with ${rivalLabName}.`,
    });
    if (researcher.employerLabId === draft.run.playerLabId) {
      const key = `researcher-poaching:${id}`;
      if (!draft.presentationQueue.some((item) => item.key === key)) {
        draft.presentationQueue.push({
          key,
          kind: "researcher-poaching",
          attention: "modal",
          researcherId,
          poachingId: id,
          rivalLabId,
          createdAt: draft.run.tick,
        });
      }
    }
  });
  recordResearcherMemory(tx, researcherId, {
    kind: "poaching-contact",
    summary: `Poaching contact from ${rivalLabName}`,
    effect: { morale: 0, loyalty: -3, burnout: 0, departurePressure: 5 },
    flagrant: false,
  });
  tx.emit({
    kind: "researcher-poaching-rumour",
    researcherId,
    poachingId: id,
    rivalLabId,
  });
  tx.requestAutoPause("resignation-ultimatum");
}

export function quoteRetentionOffer(
  state: Readonly<GameState>,
  labId: LabId,
  researcherId: ResearcherId,
  offer: RetentionOfferInput,
): RetentionOfferPreview {
  const researcher = requireResearcher(state, researcherId);
  const lab = requireLab(state, labId);
  const salaryPerCycle = Math.max(0.01, researcher.contract?.salaryPerCycle ?? 1);
  const signingCash =
    offer.package === "serious" ? salaryPerCycle * 1.5 : salaryPerCycle * 0.5;
  const auraSpend = offer.package === "serious" ? 1 : 0;
  const blockers: string[] = [];
  const poaching = researcher.poaching;
  if (
    researcher.employerLabId !== labId ||
    researcher.status !== "employed" ||
    poaching === undefined ||
    poaching.stage === "resolved"
  ) {
    blockers.push("No active poaching approach for this researcher");
  } else if (state.run.tick >= poaching.resolvesAt) {
    blockers.push("The counteroffer window has closed");
  } else if (poaching.playerRetentionStrength > 0) {
    blockers.push("A retention response is already on record");
  }
  if (lab.finance.cash < signingCash) blockers.push("Insufficient cash");
  if (lab.aura.spendable < auraSpend) blockers.push("Insufficient Aura");
  const strengthGain =
    (offer.package === "serious" ? 13 : 3) + (offer.promise === undefined ? 0 : 12);
  return {
    researcherId,
    signingCash,
    auraSpend,
    strengthGain,
    currentPlayerRetentionStrength: poaching?.playerRetentionStrength ?? 0,
    resultingPlayerRetentionStrength:
      (poaching?.playerRetentionStrength ?? 0) + strengthGain,
    resolvesAt: poaching?.resolvesAt ?? state.run.tick,
    blockers,
  };
}

export function submitRetentionOffer(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
  offer: RetentionOfferInput,
): RetentionOfferPreview {
  const researcherName = researcherDisplayName(tx.read(), content, researcherId);
  const preview = quoteRetentionOffer(tx.read(), labId, researcherId, offer);
  if (preview.blockers.length > 0) throw new Error(preview.blockers.join("; "));
  applyEffects(
    tx,
    [
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount: -preview.signingCash,
        financeCategory: "payroll-research",
      },
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: -preview.auraSpend,
        auraChangeKind: "spend",
        auraCategory: "researcher-relations",
      },
    ],
    { kind: "researcher", id: researcherId },
  );
  tx.update((draft) => {
    const researcher = draft.researchers[researcherId];
    if (researcher?.poaching === undefined) throw new Error("Poaching state missing");
    researcher.poaching.playerRetentionStrength =
      preview.resultingPlayerRetentionStrength;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Retention offer submitted to ${researcherName}.`,
    });
  });
  if (offer.promise !== undefined) {
    addResearcherPromise(tx, { researcherId, ...offer.promise });
  }
  recordResearcherMemory(tx, researcherId, {
    kind: "retention-offer",
    summary: "Retention offer submitted",
    effect: {
      morale: Math.min(8, preview.auraSpend / 2),
      loyalty: offer.promise === undefined ? 0 : 3,
      burnout: 0,
      departurePressure: -5,
    },
    flagrant: false,
  });
  tx.emit({
    kind: "researcher-retention-offer",
    researcherId,
    strengthGain: preview.strengthGain,
  });
  return preview;
}

export function quoteDismissal(
  state: Readonly<GameState>,
  _content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
): DismissalQuote {
  const researcher = requireResearcher(state, researcherId);
  const lab = requireLab(state, labId);
  const severanceCash = (researcher.contract?.salaryPerCycle ?? 0) * 2;
  const auraLoss = Math.max(2, Math.ceil((100 - researcher.loyalty) / 20));
  const blockers: string[] = [];
  if (researcher.employerLabId !== labId || researcher.status === "departed") {
    blockers.push("Researcher is not employed by this lab");
  }
  if (lab.finance.cash < severanceCash) blockers.push("Insufficient cash");
  if (lab.aura.spendable < auraLoss) blockers.push("Insufficient Aura");
  return {
    researcherId,
    severanceCash,
    auraLoss,
    knowledgeTransferFraction: transferFraction(lab, researcher),
    blockers,
  };
}

export function dismissResearcher(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
): DismissalQuote {
  const quote = quoteDismissal(tx.read(), content, labId, researcherId);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  applyEffects(
    tx,
    [
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount: -quote.severanceCash,
        financeCategory: "payroll-research",
      },
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: -quote.auraLoss,
        auraChangeKind: "loss",
        auraCategory: "researcher-relations",
        auraSignalImpact: -quote.auraLoss,
      },
    ],
    { kind: "researcher", id: researcherId },
  );
  departResearcher(tx, content, researcherId, "dismissed");
  return quote;
}

export function quoteUltimatumResponse(
  state: Readonly<GameState>,
  labId: LabId,
  researcherId: ResearcherId,
  response: UltimatumResponse,
): UltimatumResponsePreview {
  const researcher = requireResearcher(state, researcherId);
  const lab = requireLab(state, labId);
  const auraCost = response === "accept-conditions" ? 3 : 0;
  const blockers: string[] = [];
  if (
    researcher.employerLabId !== labId ||
    researcher.ultimatum === undefined ||
    researcher.ultimatum.status !== "pending"
  ) {
    blockers.push("Researcher has no pending ultimatum");
  } else if (state.run.tick >= researcher.ultimatum.expiresAt) {
    blockers.push("The ultimatum response window has closed");
  }
  if (response === "accept-conditions" && researcher.assignment === undefined) {
    blockers.push("Cannot accept conditions without a current assignment");
  }
  if (lab.aura.spendable < auraCost) blockers.push("Insufficient Aura");
  return {
    researcherId,
    response,
    auraCost,
    createsPromise: response === "accept-conditions",
    blockers,
  };
}

/**
 * Record a negotiated retention settlement after its authored costs and
 * concessions have been applied. Both the People workspace and the mandatory
 * decision-event popup use this path so accepting the same ultimatum cannot
 * produce different retention rules.
 */
export function acceptUltimatumSettlement(
  tx: SimulationTransaction,
  researcherId: ResearcherId,
): void {
  const researcher = requireResearcher(tx.read(), researcherId);
  if (researcher.ultimatum?.status === "accepted") return;
  if (researcher.ultimatum?.status !== "pending") {
    throw new Error("Researcher has no pending ultimatum to settle");
  }
  if (researcher.assignment !== undefined) {
    addResearcherPromise(tx, {
      researcherId,
      label: "One-year protected working arrangement",
      dueInWeeks: ACCEPTED_ULTIMATUM_PROTECTION_WEEKS,
      condition: {
        kind: "assignment-maintained",
        assignmentKind: researcher.assignment.kind,
        ...(researcher.assignment.targetId === undefined
          ? {}
          : { targetId: researcher.assignment.targetId }),
        requiredWeeks: ACCEPTED_ULTIMATUM_PROTECTION_WEEKS,
      },
      severity: "flagrant",
      keptMemory: { morale: 5, loyalty: 10, burnout: -5, departurePressure: -10 },
      brokenMemory: {
        morale: -20,
        loyalty: -20,
        burnout: 5,
        departurePressure: 25,
      },
    });
  }
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    if (mutable?.ultimatum === undefined) throw new Error("Ultimatum missing");
    mutable.ultimatum.status = "accepted";
    mutable.ultimatum.response = "accept-conditions";
    mutable.ultimatum.resolvedAt = draft.run.tick;
    if (mutable.housing === "unhoused") mutable.unhousedSince = draft.run.tick;
  });
  recordResearcherMemory(tx, researcherId, {
    kind: "ultimatum-resolved",
    summary: "Ultimatum conditions accepted",
    effect: { morale: 20, loyalty: 10, burnout: 0, departurePressure: -20 },
    flagrant: false,
  });
  tx.emit({
    kind: "researcher-ultimatum-resolved",
    researcherId,
    response: "accept-conditions",
  });
}

export function respondToUltimatum(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
  response: UltimatumResponse,
): void {
  const state = tx.read();
  const researcher = requireResearcher(state, researcherId);
  const ultimatumId = researcher.ultimatum?.id;
  const preview = quoteUltimatumResponse(state, labId, researcherId, response);
  if (preview.blockers.length > 0) throw new Error(preview.blockers.join("; "));
  if (response === "wish-well") {
    tx.update((draft) => {
      const mutable = draft.researchers[researcherId];
      if (mutable?.ultimatum === undefined) throw new Error("Ultimatum missing");
      mutable.ultimatum.status = "resolved";
      mutable.ultimatum.response = response;
      mutable.ultimatum.resolvedAt = draft.run.tick;
    });
    if (ultimatumId !== undefined) {
      invalidateResearcherUltimatumEvents(
        tx,
        researcherId,
        ultimatumId,
        "Ultimatum resolved through the People workspace",
      );
    }
    departResearcher(tx, content, researcherId, "voluntary");
    return;
  }
  if (researcher.assignment === undefined) {
    throw new Error("Cannot accept conditions without a current assignment");
  }
  applyEffects(
    tx,
    [
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: -preview.auraCost,
        auraChangeKind: "spend",
        auraCategory: "researcher-relations",
      },
    ],
    { kind: "researcher", id: researcherId },
  );
  acceptUltimatumSettlement(tx, researcherId);
  if (ultimatumId !== undefined) {
    invalidateResearcherUltimatumEvents(
      tx,
      researcherId,
      ultimatumId,
      "Ultimatum resolved through the People workspace",
    );
  }
}

function advanceKnowledgeTransfers(tx: SimulationTransaction): void {
  const state = tx.read();
  for (const researcher of Object.values(state.researchers)) {
    const transfer = researcher.knowledgeTransfer;
    if (
      transfer === undefined ||
      transfer.completedAt !== undefined ||
      transfer.dueAt > state.run.tick
    ) {
      continue;
    }
    tx.update((draft) => {
      const mutable = draft.researchers[researcher.id];
      if (mutable?.knowledgeTransfer === undefined) return;
      const rivalLab = draft.labs[transfer.rivalLabId as LabId];
      for (const [paperId, progress] of Object.entries(
        mutable.knowledgeTransfer.progressByPaper,
      )) {
        const paperProgress =
          rivalLab?.research.paperProgress ?? draft.world.paperRace.rival.paperProgress;
        paperProgress[paperId] = (paperProgress[paperId] ?? 0) + progress;
      }
      mutable.knowledgeTransfer.completedAt = draft.run.tick;
    });
    tx.emit({
      kind: "researcher-knowledge-transferred",
      researcherId: researcher.id,
      rivalLabId: transfer.rivalLabId,
      fraction: transfer.fraction,
    });
  }
}

function advancePoaching(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
): void {
  const state = tx.read();
  const researcher = requireResearcher(state, researcherId);
  const researcherName = requireDefinition(content, researcher).displayName;
  const poaching = researcher.poaching;
  if (poaching === undefined || poaching.stage === "resolved") return;
  const rivalLabName = rivalLabDisplayName(state, content, poaching.rivalLabId);
  if (poaching.stage === "rumour" && state.run.tick >= poaching.counterofferAt) {
    tx.update((draft) => {
      const mutable = draft.researchers[researcherId];
      if (mutable?.poaching === undefined) return;
      mutable.poaching.stage = "counteroffer";
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${rivalLabName} made ${researcherName} an explicit offer.`,
      });
    });
    tx.emit({
      kind: "researcher-poaching-counteroffer",
      researcherId,
      poachingId: poaching.id,
      rivalLabId: poaching.rivalLabId,
      resolvesAt: poaching.resolvesAt,
    });
  }
  const live = requireResearcher(tx.read(), researcherId);
  const current = live.poaching;
  if (
    current === undefined ||
    current.stage === "resolved" ||
    tx.read().run.tick < current.resolvesAt
  ) {
    return;
  }
  const strength =
    live.departurePressure +
    current.rivalOfferStrength +
    Math.max(0, 50 - live.loyalty) * 0.5 -
    current.playerRetentionStrength;
  const resolution = resolveCheck(
    new RandomOracleV1(tx.read().run.seed),
    randomKey("researcher-poaching", current.id, "resolution"),
    { strength, difficulty: 60, minimumProbability: 0.05, maximumProbability: 0.95 },
  );
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    if (mutable?.poaching === undefined) return;
    mutable.poaching.stage = "resolved";
    mutable.poaching.departureProbability = fraction(resolution.probability);
    mutable.poaching.draw = fraction(resolution.draw);
    mutable.poaching.outcome = resolution.success ? "departed" : "stayed";
    mutable.poaching.resolvedAt = draft.run.tick;
    draft.presentationQueue = draft.presentationQueue.filter(
      (item) => item.kind !== "researcher-poaching" || item.poachingId !== current.id,
    );
    if (!resolution.success) {
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          current.playerRetentionStrength > 0
            ? `${researcherName} accepted the lab's retention offer, rejected ${rivalLabName}'s approach, and will stay.`
            : `${researcherName} rejected ${rivalLabName}'s offer and will stay at the lab.`,
      });
    }
  });
  if (resolution.success) {
    tx.emit({
      kind: "researcher-poaching-resolved",
      researcherId,
      rivalLabId: current.rivalLabId,
      departed: true,
      probability: resolution.probability,
      draw: resolution.draw,
    });
    departResearcher(tx, content, researcherId, "poached", current.rivalLabId);
  } else {
    recordResearcherMemory(tx, researcherId, {
      kind: "poaching-resolved",
      summary: `Stayed after ${rivalLabName}'s offer`,
      effect: { morale: 2, loyalty: 5, burnout: 0, departurePressure: -10 },
      flagrant: false,
    });
    tx.emit({
      kind: "researcher-poaching-resolved",
      researcherId,
      rivalLabId: current.rivalLabId,
      departed: false,
      probability: resolution.probability,
      draw: resolution.draw,
    });
  }
}

/** Advance signal chains, ultimatums, checks, and delayed knowledge transfer. */
export function advanceResearcherCrises(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  advanceKnowledgeTransfers(tx);
  const researcherIds = Object.values(tx.read().researchers)
    .filter(
      (researcher) =>
        researcher.status === "employed" || researcher.status === "sabbatical",
    )
    .map((researcher) => researcher.id);
  for (const researcherId of researcherIds) {
    let researcher = requireResearcher(tx.read(), researcherId);
    if (researcher.status !== "employed" && researcher.status !== "sabbatical") {
      continue;
    }
    if (
      researcher.ultimatum?.status === "pending" &&
      tx.read().run.tick >= researcher.ultimatum.expiresAt
    ) {
      departResearcher(tx, content, researcherId, "ultimatum-expired");
      continue;
    }
    advancePoaching(tx, content, researcherId);
    researcher = requireResearcher(tx.read(), researcherId);
    if (researcher.status !== "employed" && researcher.status !== "sabbatical") {
      continue;
    }
    if (researcher.ultimatum?.status === "pending") continue;
    if (researcher.poaching !== undefined && researcher.poaching.stage !== "resolved") {
      continue;
    }
    if (
      researcher.status === "employed" &&
      researcher.housing === "unhoused" &&
      researcher.unhousedSince !== undefined &&
      tx.read().run.tick - researcher.unhousedSince >= 8
    ) {
      issueUltimatum(tx, content, researcherId, "provocation");
      continue;
    }
    const flagrantBreach = researcher.memories.some(
      (memory) =>
        memory.kind === "promise-broken" &&
        memory.flagrant &&
        memory.occurredAt === tx.read().run.tick,
    );
    const compactBreach = researcher.compact.breachedAt === tx.read().run.tick;
    if (flagrantBreach || compactBreach) {
      checkResearcherDeparture(
        tx,
        content,
        researcherId,
        flagrantBreach ? "promise-breach" : "compact-breach",
      );
      continue;
    }
    if (
      tx.read().run.tick > 0 &&
      tx.read().run.tick % 13 === 0 &&
      !hasAcceptedUltimatumProtection(researcher, tx.read().run.tick) &&
      !researcher.departureChecks.some((check) => check.checkedAt === tx.read().run.tick)
    ) {
      checkResearcherDeparture(tx, content, researcherId, "quarterly");
    }
  }
}

export function startingOrganisationTargetFlags(lab: LabState): Record<string, number> {
  return {
    [ORGANISATION_TARGET_FLAGS.boardPatience]: lab.organisation.boardPatience,
    [ORGANISATION_TARGET_FLAGS.internalCandour]: lab.organisation.hiddenInternalCandour,
    [ORGANISATION_TARGET_FLAGS.safetyCulture]: lab.safety.safetyCulture,
  };
}
