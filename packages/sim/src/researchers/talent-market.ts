import type {
  CompiledContent,
  ContentId,
  ResearcherDefinition,
  ResearcherUnlockDefinition,
} from "@neolab/content-schema";

import { quoteAuraMarketPressure, type AuraMarketPressureQuote } from "../aura/aura.ts";
import { applyEffects } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ResearcherId } from "../model/ids.ts";
import type { GamePhase, GameState, TalentMarketState } from "../model/state.ts";
import { cashMillions, tick } from "../model/units.ts";
import { isProgressiveOpeningCreditAvailable } from "../campaign/progressive-opening.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  researcherSkillForAssignment,
  syncResearcherAbilityModifiers,
} from "./researchers.ts";

/**
 * The market turns over faster than a quarter so new faces keep arriving: an
 * eight-week board means roughly six fresh shortlists a year.
 */
export const TALENT_MARKET_REFRESH_WEEKS = 8;
const TALENT_MARKET_SIZE = 6;
const FOUNDING_HIRE_GUARANTEE_USED_FLAG = "campaign:founding-hire-guarantee-used";

export interface RecruitmentQuote {
  readonly researcherId: ResearcherId;
  readonly listedAtTick: number;
  readonly salaryPerCycle: number;
  readonly signingCash: number;
  readonly auraCost: number;
  readonly auraCostBreakdown: AuraMarketPressureQuote;
  readonly foundingHireGuarantee?: {
    readonly cashReliefMillions: number;
    readonly auraRelief: number;
  };
  readonly blockers: readonly string[];
}

export interface RecruitmentResult {
  readonly researcherId: ResearcherId;
}

function requirePlayerLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function maxFrontierCapability(state: Readonly<GameState>): number {
  return Math.max(
    0,
    ...Object.values(state.models).map(
      (model) => model.measuredCapability?.frontierCapability ?? 0,
    ),
  );
}

const PHASE_ORDER: readonly GamePhase[] = ["foundation", "scaling", "frontier", "crisis"];

function unlockSatisfied(
  state: Readonly<GameState>,
  content: CompiledContent,
  unlock: ResearcherUnlockDefinition,
): boolean {
  const labs = Object.values(state.labs);
  if ("yearAtLeast" in unlock) return state.run.calendar.year >= unlock.yearAtLeast;
  if ("domainLevelAtLeast" in unlock) {
    return labs.some((lab) =>
      Object.values(lab.research.domains).some(
        (domain) => domain.level >= unlock.domainLevelAtLeast,
      ),
    );
  }
  if ("safetyDomainLevelAtLeast" in unlock) {
    return labs.some((lab) =>
      Object.values(lab.research.safetyPrograms).some(
        (program) => program.level >= unlock.safetyDomainLevelAtLeast,
      ),
    );
  }
  if ("modelFcAtLeast" in unlock) {
    return maxFrontierCapability(state) >= unlock.modelFcAtLeast;
  }
  if ("discoveredTag" in unlock) {
    return Object.keys(state.world.paperRace.discoveries).some((paperId) =>
      content.papers.definitions[paperId]?.tags.includes(unlock.discoveredTag),
    );
  }
  if ("domainUnlocked" in unlock) {
    return labs.some(
      (lab) => (lab.research.domains[unlock.domainUnlocked]?.level ?? 0) > 0,
    );
  }
  if ("facilityOwned" in unlock || "facilityCompleted" in unlock) {
    const facilityId =
      "facilityOwned" in unlock ? unlock.facilityOwned : unlock.facilityCompleted;
    return labs.some((lab) =>
      lab.facilities.instances.some((instance) => instance.definitionId === facilityId),
    );
  }
  return PHASE_ORDER.indexOf(state.run.phase) >= PHASE_ORDER.indexOf(unlock.phaseAtLeast);
}

export function isResearcherAvailable(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcherId: ResearcherId,
): boolean {
  const researcher = state.researchers[researcherId];
  const definition =
    researcher === undefined
      ? undefined
      : content.researchers.definitions[researcher.definitionId];
  if (
    researcher === undefined ||
    definition === undefined ||
    researcher.status !== "available" ||
    researcher.employerLabId !== undefined
  ) {
    return false;
  }
  // Every era's researchers sample into every market: era waves created a
  // lock-in where low turnover kept the founding cohort on the shelf for
  // years. poolWeight still shapes rarity; unlockAny conditions stay earned.
  return (
    definition.availability.unlockAny.length === 0 ||
    definition.availability.unlockAny.some((unlock) =>
      unlockSatisfied(state, content, unlock),
    )
  );
}

function weightedRank(
  oracle: RandomOracle,
  refreshIndex: number,
  definitions: readonly ResearcherDefinition[],
): readonly ResearcherDefinition[] {
  return [...definitions].sort((left, right) => {
    const leftDraw = Math.max(
      Number.EPSILON,
      oracle.uniform(randomKey("talent-market", String(refreshIndex), left.id)),
    );
    const rightDraw = Math.max(
      Number.EPSILON,
      oracle.uniform(randomKey("talent-market", String(refreshIndex), right.id)),
    );
    const leftScore = -Math.log(leftDraw) / left.availability.poolWeight;
    const rightScore = -Math.log(rightDraw) / right.availability.poolWeight;
    return leftScore - rightScore || (left.id < right.id ? -1 : 1);
  });
}

function weakestProgrammeSkill(state: Readonly<GameState>): string {
  const lab = requirePlayerLab(state, state.run.playerLabId);
  const weakest = Object.entries({
    ...lab.research.domains,
    ...lab.research.safetyPrograms,
  }).sort(([, left], [, right]) => left.level - right.level)[0]?.[0];
  return weakest === undefined
    ? "management"
    : researcherSkillForAssignment({
        kind: weakest.startsWith("base:safety.")
          ? "safety-program"
          : "capability-program",
        targetId: weakest,
        role: "lead",
        assignedAt: state.run.tick,
      });
}

/**
 * Deterministic six-candidate composition: two randomly selected coverage
 * lanes keep the slate useful, while four places remain fully open.
 */
export function generateTalentMarketCandidates(
  state: Readonly<GameState>,
  content: CompiledContent,
  refreshIndex: number,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
): readonly ResearcherId[] {
  const eligible = content.researchers.orderedIds
    .filter((id) => isResearcherAvailable(state, content, id as unknown as ResearcherId))
    .map((id) => content.researchers.definitions[id])
    .filter((definition): definition is ResearcherDefinition => definition !== undefined);
  const ranked = weightedRank(oracle, refreshIndex, eligible);
  const selected = new Set<ContentId>();
  const addRandomFit = (filter: (definition: ResearcherDefinition) => boolean): void => {
    const candidate = ranked.find(
      (definition) => !selected.has(definition.id) && filter(definition),
    );
    if (candidate !== undefined) selected.add(candidate.id);
  };

  addRandomFit(
    (definition) =>
      ["alignmentControl", "interpretabilityEvals", "securityContainment"].reduce(
        (sum, skill) => sum + (definition.skills[skill] ?? 0),
        0,
      ) >= 8,
  );
  const weakestSkill = weakestProgrammeSkill(state);
  addRandomFit((definition) => (definition.skills[weakestSkill] ?? 0) >= 3);

  for (const definition of ranked) {
    if (selected.size >= TALENT_MARKET_SIZE) break;
    selected.add(definition.id);
  }
  return [...selected].map((id) => id as unknown as ResearcherId);
}

export function createInitialTalentMarketState(
  state: Readonly<GameState>,
  content: CompiledContent,
): TalentMarketState {
  return {
    refreshIndex: 0,
    lastRefreshedAt: state.run.tick,
    nextRefreshAt: tick(state.run.tick + TALENT_MARKET_REFRESH_WEEKS),
    visibleResearcherIds: generateTalentMarketCandidates(state, content, 0),
  };
}

export function refreshTalentMarket(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  if (state.run.tick < state.talentMarket.nextRefreshAt) {
    replenishTalentMarket(tx, content);
    return;
  }
  const refreshIndex = state.talentMarket.refreshIndex + 1;
  const candidates = generateTalentMarketCandidates(state, content, refreshIndex);
  tx.update((draft) => {
    draft.talentMarket.refreshIndex = refreshIndex;
    draft.talentMarket.lastRefreshedAt = state.run.tick;
    draft.talentMarket.nextRefreshAt = tick(state.run.tick + TALENT_MARKET_REFRESH_WEEKS);
    draft.talentMarket.visibleResearcherIds = [...candidates];
  });
  tx.emit({
    kind: "talent-market-refreshed",
    refreshIndex,
    candidateIds: candidates,
  });
}

function replenishTalentMarket(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const state = tx.read();
  if (state.talentMarket.visibleResearcherIds.length >= TALENT_MARKET_SIZE) return;
  const visible = new Set(state.talentMarket.visibleResearcherIds);
  for (const researcherId of generateTalentMarketCandidates(
    state,
    content,
    state.talentMarket.refreshIndex,
  )) {
    if (visible.size >= TALENT_MARKET_SIZE) break;
    visible.add(researcherId);
  }
  for (const definitionId of content.researchers.orderedIds) {
    if (visible.size >= TALENT_MARKET_SIZE) break;
    const researcherId = definitionId as unknown as ResearcherId;
    if (isResearcherAvailable(state, content, researcherId)) visible.add(researcherId);
  }
  tx.update((draft) => {
    draft.talentMarket.visibleResearcherIds = [...visible];
  });
}

const RECRUITMENT_CASH_INFLATION_PER_YEAR = 1.06;
/**
 * Researcher pay doubles every this many points of WORLD frontier capability,
 * on top of ordinary yearly inflation. The people who can build the frontier
 * are priced by how close the frontier is to AGI, not by the calendar -- and
 * because the market watches the best model anywhere, a rival's breakthrough
 * raises your payroll too. Frontier capability tops out at 100, so the boom
 * multiplier is naturally bounded at 2^5 = 32x: near-AGI salaries are meant
 * to be a line item the player genuinely feels, never the dominating cost
 * next to a frontier fleet.
 */
export const SALARY_FRONTIER_DOUBLING_POINTS = 20;
/**
 * Ordinary staff -- engineers, ops, and the general researcher pool -- ride
 * the same boom on a gentler curve: doubling every 30 points caps at ~10x
 * against the stars' 32x. The closer a role sits to irreplaceable frontier
 * talent, the steeper its market.
 */
export const STAFF_SALARY_FRONTIER_DOUBLING_POINTS = 30;

function roundListedCash(value: number): number {
  return Math.round(value * 20) / 20;
}

/**
 * The single price rule for researcher pay: ordinary inflation times the
 * AGI-proximity boom. Listings use it at market-refresh time; annual contract
 * reviews use it to re-mark existing salaries to the same market, so a star
 * signed cheap in the foundation era becomes expensive to KEEP as the finish
 * line approaches.
 */
export function researcherSalaryMarketMultiplier(
  state: Readonly<GameState>,
  atTick: number,
): number {
  const marketYear = Math.floor(atTick / 52);
  return (
    RECRUITMENT_CASH_INFLATION_PER_YEAR ** marketYear *
    2 ** (maxFrontierCapability(state) / SALARY_FRONTIER_DOUBLING_POINTS)
  );
}

function listedCashInflation(state: Readonly<GameState>): number {
  return researcherSalaryMarketMultiplier(state, state.talentMarket.lastRefreshedAt);
}

/**
 * The staff variant of the price rule, applied to the engineering & ops and
 * general-researcher payroll lines every cycle. No contract lag here: bulk
 * payroll tracks the market immediately, which keeps headcount a live cost
 * decision late in the race rather than a bargain locked in early.
 */
export function staffPayrollMarketMultiplier(
  state: Readonly<GameState>,
  atTick: number,
): number {
  const marketYear = Math.floor(atTick / 52);
  return (
    RECRUITMENT_CASH_INFLATION_PER_YEAR ** marketYear *
    2 ** (maxFrontierCapability(state) / STAFF_SALARY_FRONTIER_DOUBLING_POINTS)
  );
}

export function quoteRecruitment(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
): RecruitmentQuote {
  const lab = requirePlayerLab(state, labId);
  const researcher = state.researchers[researcherId];
  const definition =
    researcher === undefined
      ? undefined
      : content.researchers.definitions[researcher.definitionId];
  if (researcher === undefined || definition === undefined) {
    throw new Error(`Unknown researcher ${researcherId}`);
  }
  const cashInflation = listedCashInflation(state);
  const recommendedSalary = roundListedCash(
    definition.contract.baseSalaryPerCycle * cashInflation,
  );
  const listedSigning = roundListedCash(
    definition.contract.baseSigningCash * cashInflation,
  );
  const auraCostBreakdown = quoteAuraMarketPressure(state, definition.contract.auraCost);
  const listedAuraCost = auraCostBreakdown.marketAdjustedAuraCost;
  const foundingHireGuaranteeActive =
    isProgressiveOpeningCreditAvailable(state, labId, "recruitment") &&
    lab.flags[FOUNDING_HIRE_GUARANTEE_USED_FLAG] !== true;
  const cashReliefMillions = 0;
  const auraRelief = foundingHireGuaranteeActive ? listedAuraCost : 0;
  const recommendedSigning = listedSigning - cashReliefMillions;
  const auraCost = listedAuraCost - auraRelief;
  const blockers: string[] = [];
  if (!state.talentMarket.visibleResearcherIds.includes(researcherId)) {
    blockers.push("Candidate is not in the current talent market");
  }
  if (researcher.status !== "available" || researcher.employerLabId !== undefined) {
    blockers.push("Candidate already has an employer");
  }
  if (
    Math.max(0, lab.finance.cash) < recommendedSigning &&
    !foundingHireGuaranteeActive
  ) {
    blockers.push("Insufficient cash");
  }
  if (Math.max(0, lab.aura.spendable) < auraCost) blockers.push("Insufficient Aura");
  const housedCount = lab.roster.researcherIds.filter(
    (id) => state.researchers[id]?.housing === "housed",
  ).length;
  if (housedCount >= lab.roster.starSlots)
    blockers.push("No vacant star-researcher slot");
  return {
    researcherId,
    listedAtTick: state.talentMarket.lastRefreshedAt,
    salaryPerCycle: recommendedSalary,
    signingCash: recommendedSigning,
    auraCost,
    auraCostBreakdown,
    ...(foundingHireGuaranteeActive
      ? { foundingHireGuarantee: { cashReliefMillions, auraRelief } }
      : {}),
    blockers,
  };
}

export function recruitResearcher(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  researcherId: ResearcherId,
): RecruitmentResult {
  const state = tx.read();
  const quote = quoteRecruitment(state, content, labId, researcherId);
  if (quote.blockers.length > 0) {
    throw new Error(quote.blockers.join("; "));
  }
  tx.update((draft) => {
    draft.decisionLog.push({
      tick: state.run.tick,
      summary: `${content.researchers.definitions[draft.researchers[researcherId]?.definitionId ?? ""]?.displayName ?? researcherId} joined the lab at the listed terms.`,
    });
  });
  applyEffects(
    tx,
    [
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount: -quote.signingCash,
        financeCategory: "payroll-research",
      },
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: -quote.auraCost,
        auraChangeKind: "spend",
        auraCategory: "recruitment",
      },
    ],
    { kind: "researcher", id: researcherId },
  );
  tx.update((draft) => {
    const researcher = draft.researchers[researcherId];
    const lab = draft.labs[labId];
    if (researcher === undefined || lab === undefined) {
      throw new Error("Recruitment target disappeared");
    }
    if (quote.foundingHireGuarantee !== undefined) {
      lab.flags[FOUNDING_HIRE_GUARANTEE_USED_FLAG] = true;
    }
    researcher.employerLabId = labId;
    researcher.employedAt = state.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    delete researcher.unhousedSince;
    delete researcher.assignment;
    researcher.contract = {
      salaryPerCycle: cashMillions(quote.salaryPerCycle),
      signingCash: cashMillions(quote.signingCash),
      auraCost: quote.auraCost,
      agreedAt: state.run.tick,
    };
    researcher.compact = {
      includedInOffer: true,
      windowStartedAt: state.run.tick,
      status: "tracking",
    };
    lab.roster.researcherIds.push(researcherId);
    draft.talentMarket.visibleResearcherIds =
      draft.talentMarket.visibleResearcherIds.filter((id) => id !== researcherId);
  });
  replenishTalentMarket(tx, content);
  syncResearcherAbilityModifiers(tx, content, researcherId);
  tx.emit({
    kind: "researcher-recruited",
    labId,
    researcherId,
  });
  return {
    researcherId,
  };
}

/** Recompute which employed stars occupy the hard facility-backed slots. */
export function reconcileResearcherHousing(
  tx: SimulationTransaction,
  labId: LabId,
): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    let housed = 0;
    for (const researcherId of lab.roster.researcherIds) {
      const researcher = draft.researchers[researcherId];
      if (researcher === undefined) continue;
      const next = housed < lab.roster.starSlots ? "housed" : "unhoused";
      researcher.housing = next;
      if (next === "housed") {
        delete researcher.unhousedSince;
        housed += 1;
      } else if (
        researcher.status === "employed" &&
        researcher.unhousedSince === undefined
      ) {
        researcher.unhousedSince = draft.run.tick;
      }
    }
  });
}
