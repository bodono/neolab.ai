import {
  contentId,
  type CompiledContent,
  type FundraisingCampaignDefinition,
} from "@neolab/content-schema";

import {
  calculateAuraSignal,
  quoteAuraMarketPressure,
  type AuraMarketPressureQuote,
} from "../aura/aura.ts";
import { currentMark, formatValuation } from "../finance/valuation.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { FundingOfferId, LabId, ProjectId } from "../model/ids.ts";
import {
  LAB_MATURITY_STAGE_FLAG,
  PROGRESSIVE_CAMPAIGN_FLAG,
} from "../campaign/progressive-opening.ts";
import {
  formatRunEntityId,
  type FundingCampaignType,
  type FundingDilutionFlavor,
  type FundingInvestorStyle,
  type FundingOfferConditionState,
  type FundingOfferState,
  type FundingScoreBreakdownState,
  type GameState,
  type ProjectState,
} from "../model/state.ts";
import { cashMillions, fraction, rating, tick } from "../model/units.ts";
import { MARKET_CYCLE_WEEKS, resolveCommercialModelId } from "../market/market.ts";
import { calculateProjectCapacity } from "../projects/capacity.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import type { ProjectHandler } from "../projects/project-framework.ts";

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Size a campaign from the lab's pre-money valuation.
 *
 * The standard Competitive round targets roughly ROUND_FRACTION_OF_MARK. A
 * Quiet bridge targets half that amount and a Mega round twice it. Funding
 * score moves the target from 65% to 100% of that campaign scale; it does not
 * multiply an already-authored cash amount by the valuation again.
 *
 * The previous calculation did exactly that double scaling. At a $246m mark,
 * a Mega campaign's authored $80m base was multiplied by the mark-derived
 * factor and then by condition premiums, producing a $1.2bn cheque while the
 * offer still claimed to value the lab at $246m.
 */
function campaignBaseOfferMillions(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  definition: FundraisingCampaignDefinition,
  fundingScore: FundingScoreBreakdownState,
): number {
  const scoreFactor = clamp(
    FUNDING_SCORE_BASE_FACTOR +
      fundingScore.final * definition.fundingScoreCashMultiplier,
    FUNDING_SCORE_BASE_FACTOR,
    1,
  );
  const markSized =
    currentMark(state, content, labId) *
    ROUND_FRACTION_OF_MARK *
    definition.roundSizeMultiplier *
    scoreFactor;
  const modified = resolveModifierValue(
    state,
    "lab.fundraising.offerCash",
    Math.max(definition.baseCashMillions, markSized),
    { clampMin: 0 },
  ).final;
  // The authored opening floor is a real solvency floor. Founding choices may
  // make later, valuation-sized rounds smaller, but cannot turn the campaign's
  // minimum viable cheque back into the pre-prototype trap it exists to avoid.
  return Math.max(definition.baseCashMillions, modified);
}

/**
 * A round is roughly this share of the mark before campaign shaping.
 *
 * Raised 0.12 -> 0.20 on 2026-07-27 after measuring the valuation curve. A
 * lab's mark plateaus near $300m from roughly year two to year five before
 * any late repricing, so at 12% a mid-game round was ~$36m against a lab
 * whose cash regularly dipped under $20m -- survivable, but it meant a
 * constant drip of small raises (12 to 28 per run). At 20% the same run
 * needs 9 to 24 rounds, peak cash spreads less wildly across strategies
 * ($93m-$5.6bn against $74m-$30bn), and solvency is unchanged: the same
 * seven real strategies reach weeks 426-515 and lose to rival ascendance.
 */
export const ROUND_FRACTION_OF_MARK = 0.2;
/** The first institutional round leaves the formerly garage-based lab solvent. */
export const OPENING_SEED_MINIMUM_CASH_MILLIONS = 30;
/** A weak story still receives 65% of its campaign's valuation-sized target. */
const FUNDING_SCORE_BASE_FACTOR = 0.65;
/** Rounds closed inside this window make the next campaign a harder sell. */
const RECENT_ROUND_WINDOW_WEEKS = 52;
/** Extra Aura per recent round, as a fraction of the campaign's base cost. */
export const AURA_COST_PER_RECENT_ROUND = 0.15;
/** A fully established product earns half its traction score from each real input. */
const TRACTION_DELIVERY_TARGET_TERAFLOP_WEEKS = 100_000;
const TRACTION_REVENUE_TARGET_MILLIONS = 50;

export interface OpeningSeedRecapitalisationQuote {
  readonly bridgeConversionMillions: number;
  readonly operatingTopUpMillions: number;
  readonly postCloseCashMillions: number;
}

/**
 * Convert the opening family credit line into the parents' angel stake when
 * the first institutional round closes. A small operating top-up also keeps
 * the cheapest Seed structure from completing the tutorial below $30m.
 */
export function quoteOpeningSeedRecapitalisation(
  state: Readonly<GameState>,
  labId: LabId,
  offerCashMillions: number,
  roundOrdinal = nextFundraisingRoundOrdinal(state, labId),
): OpeningSeedRecapitalisationQuote | undefined {
  const lab = requireLab(state, labId);
  if (
    labId !== state.run.playerLabId ||
    lab.flags[PROGRESSIVE_CAMPAIGN_FLAG] !== true ||
    lab.flags[LAB_MATURITY_STAGE_FLAG] !== "funding" ||
    roundOrdinal !== 1
  ) {
    return undefined;
  }
  const bridgeConversionMillions = roundMoney(
    lab.finance.cash < 0 ? Math.abs(Number(lab.finance.cash)) : 0,
  );
  const cashAfterBridgeAndOffer =
    lab.finance.cash + bridgeConversionMillions + offerCashMillions;
  const operatingTopUpMillions = roundMoney(
    Math.max(0, OPENING_SEED_MINIMUM_CASH_MILLIONS - cashAfterBridgeAndOffer),
  );
  return {
    bridgeConversionMillions,
    operatingTopUpMillions,
    postCloseCashMillions: roundMoney(cashAfterBridgeAndOffer + operatingTopUpMillions),
  };
}

export function countRecentAcceptedRounds(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  return Object.values(state.fundraising.offers).filter(
    (offer) =>
      offer.labId === labId &&
      offer.status === "accepted" &&
      offer.resolvedAt !== undefined &&
      state.run.tick - offer.resolvedAt < RECENT_ROUND_WINDOW_WEEKS,
  ).length;
}

export function nextFundraisingRoundOrdinal(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  return (
    Object.values(state.fundraising.offers).filter(
      (offer) => offer.labId === labId && offer.status === "accepted",
    ).length + 1
  );
}

function seriesLetters(seriesOrdinal: number): string {
  let remaining = seriesOrdinal;
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(65 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

export function fundraisingRoundLabel(roundOrdinal: number): string {
  if (!Number.isInteger(roundOrdinal) || roundOrdinal < 1) {
    throw new Error(`Invalid fundraising round ordinal ${String(roundOrdinal)}`);
  }
  return roundOrdinal === 1 ? "Seed" : `Series ${seriesLetters(roundOrdinal - 1)}`;
}

export function acceptedFundingRoundOrdinal(
  state: Readonly<GameState>,
  offerId: FundingOfferId,
): number | undefined {
  const offer = state.fundraising.offers[offerId];
  if (offer?.status !== "accepted") return undefined;
  if (offer.roundOrdinal !== undefined) return offer.roundOrdinal;
  const offerOrder = new Map(
    state.fundraising.offerOrder.map((candidateId, index) => [candidateId, index]),
  );
  const accepted = Object.values(state.fundraising.offers)
    .filter(
      (candidate) => candidate.labId === offer.labId && candidate.status === "accepted",
    )
    .sort(
      (left, right) =>
        (left.resolvedAt ?? left.generatedAt) - (right.resolvedAt ?? right.generatedAt) ||
        (offerOrder.get(left.id) ?? 0) - (offerOrder.get(right.id) ?? 0),
    );
  const index = accepted.findIndex((candidate) => candidate.id === offerId);
  return index < 0 ? undefined : index + 1;
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

/**
 * Measure a rolling cycle of realised commercial activity.
 *
 * Market share and monetisation efficiency describe opportunity, not traction.
 * Only inference that reached customers and cash that was actually earned count.
 * During a cycle, the unfinished portion is filled with the corresponding share
 * of the previous settled cycle so the score changes smoothly week by week.
 */
function calculateCommercialTraction(
  state: Readonly<GameState>,
  labId: LabId,
): ReturnType<typeof rating> {
  if (resolveCommercialModelId(state, labId) === undefined) return rating(0);

  const lab = requireLab(state, labId);
  const completedWeeks = clamp(lab.market.weeksAccruedThisCycle, 0, MARKET_CYCLE_WEEKS);
  const previousCycleWeight = (MARKET_CYCLE_WEEKS - completedWeeks) / MARKET_CYCLE_WEEKS;
  const realised = Object.values(lab.market.segments).reduce(
    (totals, segment) => ({
      deliveredTeraflopWeeks:
        totals.deliveredTeraflopWeeks +
        segment.accruedDeliveredUsage +
        segment.lastCycleDeliveredUsage * previousCycleWeight,
      revenueMillions:
        totals.revenueMillions +
        segment.accruedRevenueMillions +
        segment.lastCycleRevenueMillions * previousCycleWeight,
    }),
    { deliveredTeraflopWeeks: 0, revenueMillions: 0 },
  );

  return rating(
    clamp(
      (realised.deliveredTeraflopWeeks / TRACTION_DELIVERY_TARGET_TERAFLOP_WEEKS) * 50 +
        (realised.revenueMillions / TRACTION_REVENUE_TARGET_MILLIONS) * 50,
    ),
  );
}

export function calculateFundingScore(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  campaignAttentionBonus = 0,
): FundingScoreBreakdownState {
  const lab = requireLab(state, labId);
  const currentModel =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  const commercialTraction = calculateCommercialTraction(state, labId);
  const recentCapability = rating(
    clamp(currentModel?.measuredCapability?.frontierCapability ?? 0),
  );
  const aura = calculateAuraSignal(state, content, labId);
  // Fundraising rewards the public standing accumulated across the whole run.
  // Short-lived positive publicity does not inflate this input; scandals are
  // still charged once as the separate penalty below.
  const auraSignal = rating(aura.lifetimeBase);
  // Weights were 0.30/0.25/0.20 plus 0.15 funding climate and 0.10 investor
  // trust. Both were removed: climate was a constant 50 for the life of every
  // run and trust only ever ratcheted downward, so between them they contributed
  // a fixed 10.75 points that no decision could move. The remaining three are
  // rescaled by 1/0.75 so the score keeps its old range instead of every lab
  // silently raising a quarter less.
  const final = rating(
    clamp(
      commercialTraction * 0.4 +
        recentCapability * 0.333 +
        auraSignal * 0.267 -
        aura.scandalPenalty +
        campaignAttentionBonus,
    ),
  );
  return {
    commercialTraction,
    recentCapability,
    auraSignal,
    scandalPenalty: aura.scandalPenalty,
    campaignAttentionBonus,
    final,
  };
}

export interface FundraisingCampaignQuote {
  readonly futureProjectId: ProjectId;
  readonly campaign: FundingCampaignType;
  readonly displayName: string;
  readonly roundOrdinal: number;
  readonly roundLabel: string;
  readonly auraCost: number;
  readonly auraCostBreakdown: AuraMarketPressureQuote & {
    readonly recentRoundPressureAuraCost: number;
    readonly emergencyBridgeReliefAuraCost: number;
    readonly totalAuraCost: number;
  };
  readonly durationWeeks: number;
  readonly offerCount: number;
  readonly cooldownUntil: number;
  readonly fundingScore: FundingScoreBreakdownState;
  readonly estimatedCashRangeMillions: readonly [number, number];
  readonly blockers: readonly string[];
}

function estimateCampaignCashRange(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  definition: FundraisingCampaignDefinition,
  fundingScore: FundingScoreBreakdownState,
): readonly [number, number] {
  const baseOffer = campaignBaseOfferMillions(
    state,
    content,
    labId,
    definition,
    fundingScore,
  );
  const maximumConditionCount = definition.conditionTier === 1 ? 1 : 2;
  return [
    Math.max(
      definition.baseCashMillions,
      roundMoney(baseOffer * content.fundraising.cashVariance.minimum),
    ),
    // The top of the range is a conditioned offer at this campaign's maximum
    // condition count, priced at the same premium the generator actually pays
    // (CONDITION_CASH_PREMIUM per condition). This used to use a stale 8%,
    // so the quote understated what strings-attached offers really pay.
    roundMoney(
      baseOffer *
        content.fundraising.cashVariance.maximum *
        (1 + maximumConditionCount * CONDITION_CASH_PREMIUM),
    ),
  ];
}

export function quoteFundraisingCampaign(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  campaign: FundingCampaignType,
): FundraisingCampaignQuote {
  const lab = requireLab(state, labId);
  const definition = content.fundraising.campaigns[campaign];
  const durationWeeks = Math.max(
    1,
    Math.round(
      resolveModifierValue(state, "lab.fundraising.duration", definition.durationWeeks)
        .final,
    ),
  );
  const fundingScore = calculateFundingScore(
    state,
    content,
    labId,
    definition.attentionBonus,
  );
  const emergencyBridge =
    campaign === "quiet-bridge" && lab.finance.cash < 0 && lab.aura.spendable > 0;
  // A lab that is permanently raising burns goodwill. Global talent/capital
  // pressure and recent-round pressure remain separate, player-visible lines.
  const recentRounds = countRecentAcceptedRounds(state, labId);
  const marketPressure = quoteAuraMarketPressure(state, definition.auraCost);
  const recentRoundPressureAuraCost = Math.ceil(
    definition.auraCost * recentRounds * AURA_COST_PER_RECENT_ROUND,
  );
  const uncappedAuraCost =
    marketPressure.marketAdjustedAuraCost + recentRoundPressureAuraCost;
  const auraCost = emergencyBridge
    ? Math.min(uncappedAuraCost, lab.aura.spendable)
    : uncappedAuraCost;
  const emergencyBridgeReliefAuraCost = uncappedAuraCost - auraCost;
  const blockers: string[] = [];
  if (auraCost <= 0 || lab.aura.spendable < auraCost) {
    blockers.push("Insufficient Aura");
  }
  if (
    Object.values(state.projects).some(
      (project) =>
        project.ownerLabId === labId &&
        project.kind === "fundraising" &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    )
  ) {
    blockers.push("A fundraising campaign is already in progress");
  }
  const currentCooldown = state.fundraising.cooldownUntil[campaign];
  if (
    !emergencyBridge &&
    currentCooldown !== undefined &&
    state.run.tick < currentCooldown
  ) {
    blockers.push(`Campaign is cooling down until week ${String(currentCooldown)}`);
  }
  const roundOrdinal = nextFundraisingRoundOrdinal(state, labId);
  return {
    futureProjectId: formatRunEntityId(
      "project",
      labId,
      state.run.idCounters.project,
    ) as ProjectId,
    campaign,
    displayName: definition.displayName,
    roundOrdinal,
    roundLabel: fundraisingRoundLabel(roundOrdinal),
    auraCost,
    auraCostBreakdown: {
      ...marketPressure,
      recentRoundPressureAuraCost,
      emergencyBridgeReliefAuraCost,
      totalAuraCost: auraCost,
    },
    durationWeeks,
    offerCount: definition.offerCount,
    cooldownUntil: state.run.tick + definition.cooldownWeeks,
    fundingScore,
    estimatedCashRangeMillions: estimateCampaignCashRange(
      state,
      content,
      labId,
      definition,
      fundingScore,
    ),
    blockers,
  };
}

/**
 * A negative settlement is recoverable while the player can still accept an
 * offer or launch a campaign large enough to cover the deficit. The tick
 * engine uses this to pause at the cliff edge instead of ending the run before
 * the player can respond.
 */
export function hasInsolvencyRescuePath(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): boolean {
  const lab = requireLab(state, labId);
  if (lab.finance.cash >= 0) return false;
  const deficit = Math.abs(Number(lab.finance.cash));
  if (
    Object.values(state.fundraising.offers).some(
      (offer) =>
        offer.labId === labId &&
        offer.status === "available" &&
        state.run.tick < offer.expiresAt &&
        offer.cashMillions >= deficit,
    )
  ) {
    return true;
  }
  const projectCapacity = calculateProjectCapacity(state, content, labId);
  // Crisis occupancy is transient — crisis projects share the pool but must
  // never turn a rescuable deficit into an instant ending, so the rescue
  // check measures room against ordinary work only.
  const rescueAvailableSlots = Math.max(
    0,
    projectCapacity.majorProjectSlots -
      (projectCapacity.occupiedMajorProjectSlots - projectCapacity.occupiedCrisisSlots),
  );
  const viableCampaignInProgress = Object.values(state.projects).some((project) => {
    if (
      project.ownerLabId !== labId ||
      project.payload.kind !== "fundraising" ||
      (project.status !== "active" && project.status !== "queued")
    ) {
      return false;
    }
    const canProgress =
      project.status === "active" ||
      project.reservations.majorProjectSlots <= rescueAvailableSlots;
    if (!canProgress) return false;
    const definition = content.fundraising.campaigns[project.payload.campaign];
    const fundingScore = calculateFundingScore(
      state,
      content,
      labId,
      definition.attentionBonus,
    );
    return (
      (estimateCampaignCashRange(state, content, labId, definition, fundingScore)[1] ??
        0) >= deficit
    );
  });
  if (viableCampaignInProgress) {
    return true;
  }
  if (rescueAvailableSlots < 1) return false;
  return (Object.keys(content.fundraising.campaigns) as FundingCampaignType[]).some(
    (campaign) => {
      const quote = quoteFundraisingCampaign(state, content, labId, campaign);
      return (
        quote.blockers.length === 0 &&
        (quote.estimatedCashRangeMillions[1] ?? 0) >= deficit
      );
    },
  );
}

export function startFundraisingCampaign(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  campaign: FundingCampaignType,
): FundraisingCampaignQuote {
  const quote = quoteFundraisingCampaign(tx.read(), content, labId, campaign);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const projectId = tx.allocateId("project", labId) as ProjectId;
  if (projectId !== quote.futureProjectId) {
    throw new Error("Fundraising quote became stale before project creation");
  }
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "aura-spendable",
      amount: -quote.auraCost,
      auraChangeKind: "spend",
      auraCategory: "fundraising",
    },
    { kind: "system", id: projectId },
  );
  const project: ProjectState = {
    id: projectId,
    ownerLabId: labId,
    definitionId: contentId(`base:project.fundraising.${campaign}`),
    kind: "fundraising",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "fundraising",
      campaign,
      quotedAt: tx.read().run.tick,
      auraCost: quote.auraCost,
      fundingScoreAtStart: quote.fundingScore,
    },
  };
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab === undefined) throw new Error(`Unknown lab ${labId}`);
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    mutableLab.projects.projectIds.push(projectId);
    draft.fundraising.cooldownUntil[campaign] = tick(quote.cooldownUntil);
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${quote.roundLabel} fundraising started via ${quote.displayName}; ${String(quote.auraCost)} Aura committed.`,
    });
  });
  tx.emit({ kind: "project-queued", labId, projectId, projectKind: "fundraising" });
  tx.emit({
    kind: "fundraising-campaign-started",
    labId,
    projectId,
    campaign,
    auraSpent: quote.auraCost,
  });
  return quote;
}

/**
 * A funding condition: a real, time-limited cost the lab carries in exchange
 * for a larger cheque.
 *
 * Every condition on this list resolves through `resolveModifierValue` against
 * a target the simulation genuinely reads. That was not previously true: ten of
 * the thirteen conditions set a lab flag nothing consumed, pointed at
 * `event.funding.*` follow-ups that were never authored, and recorded an
 * obligation no code path could ever resolve, while the dialog told the player
 * they were "recorded for future board and event follow-up". See
 * docs/funding-conditions-audit.md.
 *
 * TARGET SAFETY. Only use targets resolved by `resolveModifierValue`. Do NOT
 * use `lab.research.capability.output` or `lab.research.safety.output`: those
 * go through `resolveResearcherStack`, which passes
 * `includeSourceKinds: ["researcher"]`, so a system-sourced funding condition
 * would be silently discarded -- the exact defect this rewrite exists to undo.
 * `lab.research.all.output` is resolved normally and is the safe way to touch
 * research output.
 */
function modifierCondition(
  id: string,
  label: string,
  target: string,
  value: number,
  durationWeeks: number,
): FundingOfferConditionState {
  return {
    id,
    kind: "modifier",
    label,
    target,
    operation: "multiply",
    value,
    durationWeeks,
  };
}

interface OfferShape {
  readonly investorStyle: FundingInvestorStyle;
  readonly dilutionFlavor: FundingDilutionFlavor;
  readonly conditions: readonly FundingOfferConditionState[];
}

function selectOfferShape(shapes: readonly OfferShape[], variant: number): OfferShape {
  const shape = shapes[variant % shapes.length];
  if (shape === undefined) throw new Error("Funding offer shape catalogue is empty");
  return shape;
}

/**
 * Extra cash per condition attached.
 *
 * Was 6% while the conditions were almost entirely cosmetic, which made the
 * offer with the most strings strictly the best one and reduced the choice
 * between term sheets to a comparison of one random draw. Now that every
 * condition costs something real, the premium has to be large enough that
 * taking one is a genuine decision rather than an obvious refusal: two
 * conditions is +44% cash against, say, research -3% and all operating costs
 * +4% for two years.
 *
 * Offers carry 0, 1 or 2 conditions. Three was too many to weigh at once and
 * made the clean no-strings offer look absurd by comparison.
 */
export const CONDITION_CASH_PREMIUM = 0.22;

/** Two years: long enough to shape a strategy, short enough to plan around. */
const LONG_WINDOW = 104;
/** One year. */
const SHORT_WINDOW = 52;

/**
 * Investors want something specific, and it costs the lab something specific
 * for a bounded time. Penalties are deliberately small -- a few per cent -- but
 * they are real, so the premium they buy (§`CONDITION_CASH_PREMIUM`) is worth
 * weighing rather than accepting reflexively.
 */
const COMMERCIALISATION_PUSH = (): FundingOfferConditionState =>
  modifierCondition(
    "commercialisation-push",
    "Investors expect commercial focus: research output −3% for two years",
    "lab.research.all.output",
    0.97,
    LONG_WINDOW,
  );

const PREFERRED_HARDWARE_VENDOR = (): FundingOfferConditionState =>
  modifierCondition(
    "preferred-hardware-vendor",
    "Compute must be bought through the partner's vendor: GPU purchase price +5% for two years",
    "lab.compute.ownedPurchasePrice",
    1.05,
    LONG_WINDOW,
  );

const RESERVED_INFERENCE = (): FundingOfferConditionState =>
  modifierCondition(
    "reserved-inference",
    "Partner holds reserved inference capacity: compute per served request +6% for a year",
    "serving.computePerRequest",
    1.06,
    SHORT_WINDOW,
  );

/**
 * NOTE: `lab.costs.fixed` is the whole recurring burn -- researcher salaries,
 * engineering and ops payroll, facility operating costs, executive overhead,
 * GPU leases AND owned-GPU electricity. Owned power is therefore a *subset* of
 * it, so never pair this with AGGRESSIVE_SCALING in one offer: the player would
 * pay twice on the same electricity under two different names.
 */
const INVESTOR_REPORTING = (): FundingOfferConditionState =>
  modifierCondition(
    "investor-reporting",
    "Quarterly investor reporting and diligence: all operating costs +4% for two years",
    "lab.costs.fixed",
    1.04,
    LONG_WINDOW,
  );

const EXCLUSIVITY_TERMS = (): FundingOfferConditionState =>
  modifierCondition(
    "exclusivity-terms",
    "Exclusivity narrows the addressable market: demand ceiling −5% for a year",
    "lab.market.demandCeiling",
    0.95,
    SHORT_WINDOW,
  );

const SAFETY_ASSURANCE_REGIME = (): FundingOfferConditionState =>
  modifierCondition(
    "safety-assurance-regime",
    "Mandated external assurance on every evaluation: evaluation cash cost +12% for two years",
    "lab.evaluation.cashCost",
    1.12,
    LONG_WINDOW,
  );

/**
 * The -4% is a claim on cash, not on the mark. lab.revenue.all is resolved when
 * the cycle ledger is assembled, after the market settlement has already stored
 * the revenue that valuation prices from -- so this reduces what the lab banks
 * and leaves its valuation on gross revenue. Deliberate; see the note at the
 * resolution site in finance.ts.
 */
const REVENUE_SHARE = (): FundingOfferConditionState =>
  modifierCondition(
    "revenue-share",
    "Partner takes a revenue share: product revenue −4% for two years",
    "lab.revenue.all",
    0.96,
    LONG_WINDOW,
  );

const PROCUREMENT_THROUGH_PARTNER = (): FundingOfferConditionState =>
  modifierCondition(
    "procurement-through-partner",
    "All compute procurement routes through the partner: acquisition cost +6% for a year",
    "lab.compute.acquisitionCost",
    1.06,
    SHORT_WINDOW,
  );

const AGGRESSIVE_SCALING = (): FundingOfferConditionState =>
  modifierCondition(
    "aggressive-scaling",
    "Investors want scale over efficiency: owned-GPU power cost +7% for a year",
    "lab.compute.ownedPowerCost",
    1.07,
    SHORT_WINDOW,
  );

const PUBLICATION_RESTRAINT = (): FundingOfferConditionState =>
  modifierCondition(
    "publication-restraint",
    "Publication restraint slows internal knowledge spread: research output −2% for a year",
    "lab.research.all.output",
    0.98,
    SHORT_WINDOW,
  );

function offerShape(
  definition: FundraisingCampaignDefinition,
  variant: number,
): OfferShape {
  if (definition.conditionTier === 1) {
    return variant % 2 === 0
      ? {
          investorStyle: "existing-backers",
          dilutionFlavor: "light-touch-note",
          conditions: [],
        }
      : {
          investorStyle: "mission-aligned",
          dilutionFlavor: "standard-preferred",
          conditions: [PUBLICATION_RESTRAINT()],
        };
  }
  const competitiveShapes: readonly OfferShape[] = [
    {
      investorStyle: "mission-aligned",
      dilutionFlavor: "standard-preferred",
      conditions: [SAFETY_ASSURANCE_REGIME()],
    },
    {
      investorStyle: "commercial-growth",
      dilutionFlavor: "board-seat",
      conditions: [COMMERCIALISATION_PUSH(), INVESTOR_REPORTING()],
    },
    {
      investorStyle: "strategic-compute",
      dilutionFlavor: "standard-preferred",
      conditions: [RESERVED_INFERENCE(), PREFERRED_HARDWARE_VENDOR()],
    },
    {
      investorStyle: "state-partnership",
      dilutionFlavor: "board-seat",
      conditions: [EXCLUSIVITY_TERMS()],
    },
  ];
  if (definition.conditionTier === 2) {
    return selectOfferShape(competitiveShapes, variant);
  }
  const megaShapes: readonly OfferShape[] = [
    {
      investorStyle: "commercial-growth",
      dilutionFlavor: "strategic-control",
      conditions: [COMMERCIALISATION_PUSH(), REVENUE_SHARE()],
    },
    {
      investorStyle: "strategic-compute",
      dilutionFlavor: "strategic-control",
      // Buying, running, serving -- three distinct levers. Do not add
      // PREFERRED_HARDWARE_VENDOR here: ownedPurchasePrice and acquisitionCost
      // are chained on the same purchase (acquisitionCost resolves against the
      // output of ownedPurchasePrice), so pairing them charges +11.3% on one
      // transaction while presenting it to the player as two separate terms.
      conditions: [PROCUREMENT_THROUGH_PARTNER(), AGGRESSIVE_SCALING()],
    },
    {
      investorStyle: "state-partnership",
      dilutionFlavor: "board-seat",
      conditions: [SAFETY_ASSURANCE_REGIME(), EXCLUSIVITY_TERMS()],
    },
  ];
  return selectOfferShape(megaShapes, variant);
}

export function generateFundingOffers(
  tx: SimulationTransaction,
  content: CompiledContent,
  campaignProjectId: ProjectId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): readonly FundingOfferId[] {
  const project = tx.read().projects[campaignProjectId];
  if (
    project === undefined ||
    project.payload.kind !== "fundraising" ||
    project.status !== "active" ||
    project.progress < 1
  ) {
    throw new Error(`Fundraising project ${campaignProjectId} is not ready`);
  }
  if (
    Object.values(tx.read().fundraising.offers).some(
      (offer) => offer.campaignProjectId === campaignProjectId,
    )
  ) {
    throw new Error(`Fundraising project ${campaignProjectId} already generated offers`);
  }
  const definition = content.fundraising.campaigns[project.payload.campaign];
  const score = calculateFundingScore(
    tx.read(),
    content,
    project.ownerLabId,
    definition.attentionBonus,
  );
  const baseCash = campaignBaseOfferMillions(
    tx.read(),
    content,
    project.ownerLabId,
    definition,
    score,
  );
  // Choose one random starting point, then walk the authored catalogue. Drawing
  // a separate shape for each offer allowed the same investor terms to appear
  // twice in one roadshow, leaving cash variance as the only real distinction.
  // Every multi-offer campaign authors more shapes than it returns, so this
  // rotation preserves a random subset while guaranteeing distinct choices.
  const shapeStartVariant = oracle.integer(
    randomKey("fundraising", campaignProjectId, "shape-start"),
    0,
    11,
  );
  const offerIds: FundingOfferId[] = [];
  for (let index = 0; index < definition.offerCount; index += 1) {
    const offerId = tx.allocateId("funding-offer", project.ownerLabId) as FundingOfferId;
    const draw = oracle.uniform(
      randomKey("fundraising", campaignProjectId, "offer", String(index), "cash"),
    );
    const shape = offerShape(definition, shapeStartVariant + index);
    const cashVariance =
      content.fundraising.cashVariance.minimum +
      draw *
        (content.fundraising.cashVariance.maximum -
          content.fundraising.cashVariance.minimum);
    const conditionPremium = 1 + shape.conditions.length * CONDITION_CASH_PREMIUM;
    const cash = cashMillions(
      Math.max(
        definition.baseCashMillions,
        roundMoney(baseCash * cashVariance * conditionPremium),
      ),
    );
    const preMoneyMark = Math.max(currentMark(tx.read(), content, project.ownerLabId), 0);
    const offer: FundingOfferState = {
      id: offerId,
      campaignProjectId,
      labId: project.ownerLabId,
      campaign: project.payload.campaign,
      investorStyle: shape.investorStyle,
      dilutionFlavor: shape.dilutionFlavor,
      generatedAt: tx.read().run.tick,
      expiresAt: tick(tx.read().run.tick + definition.offerExpiryWeeks),
      cashMillions: cash,
      // A priced round is quoted post-money: the existing mark plus the new
      // capital. This keeps the valuation shown on the term sheet greater than
      // the cheque and matches the mark applied when the offer is accepted.
      impliedMarkMillions: roundMoney(preMoneyMark + cash),
      fundingScore: score,
      cashVarianceDraw: fraction(draw),
      conditions: shape.conditions,
      status: "available",
    };
    tx.update((draft) => {
      draft.fundraising.offers[offerId] = structuredClone(
        offer,
      ) as DeepMutable<FundingOfferState>;
      draft.fundraising.offerOrder.push(offerId);
    });
    offerIds.push(offerId);
  }
  tx.emit({
    kind: "fundraising-offers-generated",
    labId: project.ownerLabId,
    projectId: campaignProjectId,
    campaign: project.payload.campaign,
    offerIds,
  });
  const roundLabel = fundraisingRoundLabel(
    nextFundraisingRoundOrdinal(tx.read(), project.ownerLabId),
  );
  tx.update((draft) => {
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${roundLabel} term sheets arrived after the ${definition.displayName}: ${String(offerIds.length)} offer${offerIds.length === 1 ? " is" : "s are"} available. No cash changes hands until one is accepted.`,
      category: "narrative",
      source: { kind: "system", id: `fundraising-offers:${campaignProjectId}` },
      relatedIds: [campaignProjectId, ...offerIds],
    });
  });
  tx.requestAutoPause("funding-offers");
  return offerIds;
}

export interface FundingOfferQuote {
  readonly offer: FundingOfferState;
  readonly blockers: readonly string[];
}

export function quoteFundingOffer(
  state: Readonly<GameState>,
  labId: LabId,
  offerId: FundingOfferId,
): FundingOfferQuote {
  const offer = state.fundraising.offers[offerId];
  if (offer === undefined) throw new Error(`Unknown funding offer ${offerId}`);
  const blockers: string[] = [];
  if (offer.labId !== labId) blockers.push("Offer belongs to another lab");
  if (offer.status !== "available") blockers.push("Offer is no longer available");
  if (state.run.tick >= offer.expiresAt) blockers.push("Offer has expired");
  return { offer, blockers };
}

export function acceptFundingOffer(
  tx: SimulationTransaction,
  labId: LabId,
  offerId: FundingOfferId,
): FundingOfferQuote {
  const quote = quoteFundingOffer(tx.read(), labId, offerId);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const roundOrdinal = nextFundraisingRoundOrdinal(tx.read(), labId);
  const roundLabel = fundraisingRoundLabel(roundOrdinal);
  const openingRecapitalisation = quoteOpeningSeedRecapitalisation(
    tx.read(),
    labId,
    quote.offer.cashMillions,
    roundOrdinal,
  );
  if ((openingRecapitalisation?.bridgeConversionMillions ?? 0) > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount: openingRecapitalisation?.bridgeConversionMillions ?? 0,
        financeCategory: "grant",
      },
      { kind: "system", id: "campaign:family-bridge-conversion" },
    );
  }
  if ((openingRecapitalisation?.operatingTopUpMillions ?? 0) > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount: openingRecapitalisation?.operatingTopUpMillions ?? 0,
        financeCategory: "grant",
      },
      { kind: "system", id: "campaign:seed-operating-reserve" },
    );
  }
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "cash",
      amount: quote.offer.cashMillions,
      financeCategory: "grant",
    },
    { kind: "system", id: offerId },
  );
  for (const condition of quote.offer.conditions) {
    if (condition.kind === "modifier") {
      applyEffect(
        tx,
        {
          kind: "add-modifier",
          target: condition.target,
          operation: condition.operation,
          value: condition.value,
          ...(condition.durationWeeks === undefined
            ? {}
            : { durationWeeks: condition.durationWeeks }),
          tags: ["funding-condition", condition.id],
        },
        { kind: "system", id: offerId },
      );
    } else {
      // Legacy branch. No offer generated since the 2026-07-29 rewrite carries a
      // flag condition; this only fires for an offer already pending in a save
      // written before it. Retained so those saves load and resolve without a
      // migration, and deliberately not extended -- the flags it sets are read
      // by nothing, which is why the conditions were replaced.
      applyEffect(
        tx,
        {
          kind: "set-flag",
          subject: { type: "lab", labId },
          flag: condition.flag,
          value: condition.value,
        },
        { kind: "system", id: offerId },
      );
    }
  }
  applyEffect(
    tx,
    {
      kind: "set-flag",
      subject: { type: "lab", labId },
      flag: `funding:accepted:${offerId}`,
      value: true,
    },
    { kind: "system", id: offerId },
  );
  tx.update((draft) => {
    const accepted = draft.fundraising.offers[offerId];
    if (accepted === undefined) throw new Error(`Unknown funding offer ${offerId}`);
    accepted.status = "accepted";
    accepted.resolvedAt = draft.run.tick;
    accepted.roundOrdinal = roundOrdinal;
    for (const sibling of Object.values(draft.fundraising.offers)) {
      if (
        sibling.campaignProjectId === accepted.campaignProjectId &&
        sibling.id !== offerId &&
        sibling.status === "available"
      ) {
        sibling.status = "rejected";
        sibling.resolvedAt = draft.run.tick;
      }
    }
    // No obligation is recorded any more. Conditions are now applied in full at
    // the moment of acceptance, as time-limited modifiers that expire on their
    // own. The obligation list existed to hold conditions awaiting a "Stage 5"
    // follow-up that was never built: every entry ever created sat at
    // "pending-stage-5" for the rest of the run while the dialog told the player
    // it was "recorded for future board and event follow-up".
    //
    // The field is kept on the state so existing saves load unchanged, and the
    // invariant that obligations trace back to an accepted offer still holds
    // vacuously for new runs.
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${roundLabel} closed: accepted ${accepted.investorStyle} funding offer for ${formatValuation(accepted.cashMillions)} with ${String(accepted.conditions.length)} condition(s).`,
    });
    if (openingRecapitalisation !== undefined) {
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          `Opening recapitalisation: the family bridge converted into your parents' angel stake` +
          ` and the lab closed its Seed with ${formatValuation(openingRecapitalisation.postCloseCashMillions)} cash.`,
        category: "narrative",
        source: { kind: "system", id: "campaign:opening-recapitalisation" },
      });
    }
    // A round marks the company: the raise implies a valuation, which becomes
    // the official mark the market drifts around until the next round.
    const lab = draft.labs[labId];
    const valuation = lab?.finance.valuation;
    if (lab !== undefined && valuation !== undefined) {
      // The offer records its post-money valuation, so the card and the mark
      // applied here describe the same transaction. Older offers fall back to
      // the historical inverse rule when they do not carry this field.
      const cappedMark = Math.max(
        accepted.impliedMarkMillions ?? accepted.cashMillions / ROUND_FRACTION_OF_MARK,
        lab.finance.cash,
      );
      const previousOfficial = valuation.officialMarkMillions;
      valuation.officialMarkMillions = cappedMark;
      valuation.lastRoundTick = draft.run.tick;
      valuation.markMillions = cappedMark;
      if (previousOfficial !== undefined && cappedMark < previousOfficial) {
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `A down round: the lab is now marked below its previous valuation. Investor trust took the difference personally.`,
          category: "narrative",
          source: { kind: "system", id: `valuation:down-round:${offerId}` },
        });
      }
    }
  });
  tx.emit({
    kind: "funding-offer-accepted",
    labId,
    offerId,
    cashMillions: quote.offer.cashMillions,
    conditionCount: quote.offer.conditions.length,
    roundOrdinal,
    roundLabel,
    ...(openingRecapitalisation === undefined ? {} : { openingRecapitalisation }),
  });
  return quote;
}

export function expireFundingOffers(tx: SimulationTransaction): void {
  const expired: FundingOfferId[] = [];
  tx.update((draft) => {
    for (const offer of Object.values(draft.fundraising.offers)) {
      if (offer.status === "available" && draft.run.tick >= offer.expiresAt) {
        offer.status = "expired";
        offer.resolvedAt = draft.run.tick;
        expired.push(offer.id);
      }
    }
  });
  for (const offerId of expired) {
    tx.emit({ kind: "funding-offer-expired", offerId });
  }
}

export const FUNDRAISING_PROJECT_HANDLER: ProjectHandler<"fundraising"> = {
  kind: "fundraising",
  advance(tx, _content, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      if (mutable.startedAt === undefined) {
        throw new Error(`Active fundraising project ${project.id} has no start tick`);
      }
      mutable.progress = Math.min(
        1,
        (draft.run.tick - mutable.startedAt + 1) / mutable.expectedDurationWeeks,
      );
    });
  },
  complete(tx, content, project): void {
    generateFundingOffers(tx, content, project.id);
  },
  cancel(tx, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
    });
  },
};
