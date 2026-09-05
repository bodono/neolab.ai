import type { CompiledContent } from "@neolab/content-schema";

import { calculateAuraSignal } from "../aura/aura.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type { GameState, LabState, ValuationState } from "../model/state.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

/**
 * Lab valuation: what the market believes a lab is worth, in $m.
 *
 * The mark is a belief, not an accounting fact. It reads ONLY player-visible
 * signals — measured capability, booked revenue, public standing, investor
 * trust, funding climate, disclosed incidents, government action. Hidden model
 * truth must never reach it: a deceptively misaligned model with excellent
 * published benchmarks is supposed to command a magnificent valuation, and
 * that gap between price and reality is the point.
 *
 * The mark moves toward its target in log space with momentum, so it trends
 * and overshoots like a market instead of teleporting.
 */

/** The single tuning surface for the valuation arc. */
export const VALUATION_TUNING = {
  /** Floor: a lab with a building and a payroll is never worth nothing. */
  floorMillions: 25,
  /**
   * Option value of the capability itself: base * exp(k * capability).
   *
   * Base raised 40 -> 90 on 2026-07-30. The mark is floored at the lab's cash,
   * and a lab starts with $45m against a capability-3 option value of $52m that
   * the multipliers below then cut to about $16m -- so for the whole early game
   * the mark WAS the bank balance, and rounds, which scale with the mark, did
   * not grow as the lab did. The exponent is unchanged: the problem was the
   * height of the curve where it starts, not its steepness.
   */
  capabilityOptionBase: 90,
  /**
   * Exponent raised 0.085 -> 0.11 on 2026-07-30, to make the curve take off.
   *
   * The base sets where the curve starts and this sets how hard it climbs, and
   * the climb was too shallow for a game whose arc is a lab accelerating toward
   * AGI. It also left the valuation milestone ladder mis-scaled: at 0.085 the
   * trillion-dollar milestone needed capability 109 on a 0-100 scale, so it
   * could never fire from the option value at all -- only via the x8 candidate
   * repricing. At 0.11 it lands at capability 85, the unicorn at 22 instead of
   * 28, and the decacorn at 43 instead of 55.
   *
   * The early game is deliberately barely touched: at capability 3 this moves
   * $116m to $127m, well under the cash floor that prices a young lab anyway.
   * The steepening is all in the back half, which is the part that should feel
   * like a takeoff.
   *
   * Set to 0.12 for the top of the curve. Capability 85 with strong standing,
   * trust and climate, plus the x3 near-frontier repricing, lands near $16T; a
   * confirmed AGI candidate at x8 reaches roughly $44T. The option value alone
   * at that capability is about $2.4T, so the headline at the end of a winning
   * run is dominated by the repricing -- which is the intended story: the market
   * re-rates the lab once it believes the thing is actually close.
   *
   * The milestone ladder now spans the capability range properly. At the old
   * 0.085 the trillion-dollar milestone needed capability 109 on a 0-100 scale
   * and could never fire from the option value at all; it now lands at 78.
   */
  capabilityExponent: 0.12,
  /** Cycles per year, for annualising last-cycle revenue. */
  cyclesPerYear: 13,
  /**
   * Annual revenue multiple. Was interpolated 8..22 by funding climate, which
   * was a constant 50 for the life of every run, so this only ever evaluated to
   * 15. Now written as the constant it always was.
   */
  revenueMultiple: 15,
  /**
   * Owned assets count toward the market's floor at this fraction of what they
   * cost. Deliberately above the 0.25 GPU resale fraction: a fire sale is not
   * what a going concern is worth, and pricing hardware at scrap created a
   * perverse incentive -- with the floor binding, spending cash on GPUs LOWERED
   * the mark, so buying the thing the game is about made a lab poorer on paper
   * and shrank its next round.
   */
  ownedAssetValueFraction: 0.75,
  /**
   * Research depth multiplies the capability option value rather than sitting
   * in the floor: it is not sellable, it is the pipeline that makes the next
   * model better, and the market pays for the belief that a lab can push
   * further. Kept modest because it partly double-counts -- deep research is
   * already why the current model is as capable as it is.
   */
  researchDepthSpan: 0.5,
  /**
   * Three independent multipliers, each with a floor -- and they multiply. At
   * the old floors a lab with low aura, low investor trust and a cold climate
   * was marked at 0.6 * 0.7 * 0.75 = 31.5% of its computed worth: three
   * haircuts compounding at exactly the moment it is weakest, the same shape as
   * the Aura cold start. Floors raised on 2026-07-30 so the compounded worst
   * case is 51% rather than 31.5%; the spans are unchanged, so a lab that earns
   * standing, trust and a warm climate still reaches the same ceiling.
   */
  /** Public standing multiplier range, from aura signal. */
  hypeMin: 0.75,
  hypeSpan: 0.65,
  /**
   * Repricing once a candidate is publicly confirmed.
   *
   * Raised 8 -> 200 on 2026-07-30. Eight was a re-rating; this is the market
   * concluding the lab has built the thing. A confirmed candidate at capability
   * 85 with strong standing now prices near $1.1 quadrillion, and at capability
   * 100 around $6.6 quadrillion -- which is the intended scale for actually
   * getting there, and is why formatValuation grew a quadrillion rung.
   *
   * It is deliberately enormous relative to nearFrontierMultiplier (3). The gap
   * between "close" and "confirmed" should be the largest single jump in the
   * game, because that is the moment the run is about.
   */
  agiCandidateMultiplier: 200,
  /** Repricing as measured capability closes on the candidacy threshold. */
  nearFrontierMultiplier: 3,
  nearFrontierCapability: 80,
  /** Fraction of the log-gap closed each week. */
  momentum: 0.15,
  /** Symmetric weekly noise, as a fraction of the mark. */
  weeklyNoise: 0.015,
  /** Immediate multiplicative shock when an incident lands this week. */
  incidentShock: {
    minor: 0.98,
    serious: 0.9,
    major: 0.7,
    critical: 0.4,
    catastrophe: 0.1,
  },
  /** Sustained haircut while incidents remain recent (13-week window). */
  recentIncidentHaircutPerSeverity: 0.005,
  /** Haircut while a government intervention is unresolved or failed. */
  pendingInterventionHaircut: 0.88,
  failedInterventionHaircut: 0.8,
} as const;

const RECENT_INCIDENT_WEEKS = 13;

export interface ValuationBreakdown {
  readonly revenueValueMillions: number;
  readonly capabilityValueMillions: number;
  readonly hypeMultiplier: number;
  readonly repricingMultiplier: number;
  readonly haircutMultiplier: number;
  /**
   * What the lab owns: cash plus hardware plus buildings. Always part of the
   * price, never merely a floor under it -- a datacentre full of GPUs does not
   * stop being worth anything the moment the capability option value overtakes
   * it. As a floor these terms also vanished from the panel exactly when a
   * player started wanting to see them.
   */
  readonly assetValueMillions: number;
  readonly cashMillions: number;
  readonly gpuFleetValueMillions: number;
  readonly facilitiesValueMillions: number;
  /** Revenue and capability after every multiplier: the going-concern half. */
  readonly goingConcernMillions: number;
  /** Research depth, folded into the capability option value. */
  readonly researchDepthMultiplier: number;
  readonly targetMillions: number;
}

/**
 * Mean research level across every capability domain and safety programme,
 * normalised to 0..1. Depth, not breadth of any one field.
 */
function researchDepth(lab: LabState): number {
  const levels = [
    ...Object.values(lab.research.domains).map((domain) => domain.level),
    ...Object.values(lab.research.safetyPrograms).map((program) => program.level),
  ];
  if (levels.length === 0) return 0;
  const mean = levels.reduce((sum, level) => sum + level, 0) / levels.length;
  return Math.min(1, Math.max(0, mean / 100));
}

/**
 * What the lab is worth broken up: cash, plus owned hardware and buildings at
 * `ownedAssetValueFraction` of what they cost. Leased and cloud GPUs are
 * excluded -- the lab does not own them.
 */
interface BookValue {
  readonly cashMillions: number;
  readonly gpuFleetMillions: number;
  readonly facilitiesMillions: number;
  readonly totalMillions: number;
}

function bookValue(
  state: Readonly<GameState>,
  content: CompiledContent,
  lab: LabState,
): BookValue {
  const fraction = VALUATION_TUNING.ownedAssetValueFraction;
  const hardware = lab.compute.lots.reduce((sum, lot) => {
    if (lot.ownership !== "owned") return sum;
    const generation = content.gpuGenerations[lot.generationId];
    if (generation === undefined) return sum;
    const thousands = lot.physicalCount / 1_000;
    return sum + thousands * generation.gameCostMillionsPerThousand * fraction;
  }, 0);
  const buildings = lab.facilities.instances.reduce((sum, instance) => {
    const definition = content.facilities[instance.definitionId];
    return sum + (definition?.cashCostMillions ?? 0) * fraction;
  }, 0);
  return {
    cashMillions: lab.finance.cash,
    gpuFleetMillions: hardware,
    facilitiesMillions: buildings,
    totalMillions: lab.finance.cash + hardware + buildings,
  };
}

function requireLab(state: Readonly<GameState>, labId: LabId): LabState {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

/**
 * Publicly legible capability for a lab. For the player this is the measured
 * estimate their own evaluations produced — never trueCapability.
 */
function visibleCapability(state: Readonly<GameState>, lab: LabState): number {
  const modelId = lab.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) return 0;
  const measured = model.measuredCapability?.frontierCapability;
  if (measured !== undefined) return measured;
  // Rivals carry no measured estimate of their own; the market prices the
  // capability their releases have demonstrated.
  return lab.control === "rival" ? calculateFrontierCapability(model.trueCapability) : 0;
}

function hasConfirmedCandidate(state: Readonly<GameState>, lab: LabState): boolean {
  return lab.models.modelIds.some(
    (modelId) => state.models[modelId]?.flags["agi-candidate"] === true,
  );
}

function recentIncidentHaircut(state: Readonly<GameState>, labId: LabId): number {
  const worst = state.incidents
    .filter(
      (incident) =>
        state.models[incident.modelId]?.ownerLabId === labId &&
        state.run.tick - incident.occurredAt <= RECENT_INCIDENT_WEEKS,
    )
    .reduce((max, incident) => Math.max(max, incident.observedSeverity), 0);
  return Math.max(0.5, 1 - worst * VALUATION_TUNING.recentIncidentHaircutPerSeverity);
}

function governmentHaircut(lab: LabState): number {
  let multiplier = 1;
  for (const intervention of lab.politics.interventions) {
    if (intervention.status === "pending-event") {
      multiplier *= VALUATION_TUNING.pendingInterventionHaircut;
    } else if (intervention.status === "failed") {
      multiplier *= VALUATION_TUNING.failedInterventionHaircut;
    }
  }
  return Math.max(0.35, multiplier);
}

export function calculateValuationTarget(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): ValuationBreakdown {
  const lab = requireLab(state, labId);
  const tuning = VALUATION_TUNING;
  const cycleRevenue = Object.values(lab.market.segments).reduce(
    (sum, segment) => sum + segment.lastCycleRevenueMillions,
    0,
  );
  const revenueValueMillions =
    cycleRevenue * tuning.cyclesPerYear * tuning.revenueMultiple;

  const capability = visibleCapability(state, lab);
  const researchDepthMultiplier = 1 + researchDepth(lab) * tuning.researchDepthSpan;
  const capabilityValueMillions =
    tuning.capabilityOptionBase *
    Math.exp(tuning.capabilityExponent * capability) *
    researchDepthMultiplier;

  const auraSignal = calculateAuraSignal(state, content, labId).final;
  const hypeMultiplier = tuning.hypeMin + (auraSignal / 100) * tuning.hypeSpan;

  const repricingMultiplier = hasConfirmedCandidate(state, lab)
    ? tuning.agiCandidateMultiplier
    : capability >= tuning.nearFrontierCapability
      ? tuning.nearFrontierMultiplier
      : 1;

  const haircutMultiplier = recentIncidentHaircut(state, labId) * governmentHaircut(lab);

  const book = bookValue(state, content, lab);
  // Assets ADD to the option value; they are not a floor under it. A lab is
  // worth what it owns plus what the market believes it can build -- a
  // datacentre full of GPUs does not stop being worth anything the moment the
  // capability option value overtakes it. As a floor these terms vanished from
  // the panel the moment they stopped binding, which is exactly when a player
  // starts wanting to see them.
  const goingConcernMillions =
    (revenueValueMillions + capabilityValueMillions) *
    hypeMultiplier *
    repricingMultiplier *
    haircutMultiplier;
  const targetMillions = Math.max(
    tuning.floorMillions,
    book.totalMillions + goingConcernMillions,
  );

  return {
    assetValueMillions: book.totalMillions,
    goingConcernMillions,
    cashMillions: book.cashMillions,
    gpuFleetValueMillions: book.gpuFleetMillions,
    facilitiesValueMillions: book.facilitiesMillions,
    researchDepthMultiplier,
    revenueValueMillions,
    capabilityValueMillions,
    hypeMultiplier,
    repricingMultiplier,
    haircutMultiplier,
    targetMillions,
  };
}

/** Immediate multiplicative shock from incidents that landed this very week. */
function thisWeekIncidentShock(state: Readonly<GameState>, labId: LabId): number {
  return state.incidents
    .filter(
      (incident) =>
        incident.occurredAt === state.run.tick &&
        state.models[incident.modelId]?.ownerLabId === labId,
    )
    .reduce(
      (shock, incident) => shock * VALUATION_TUNING.incidentShock[incident.category],
      1,
    );
}

const MILESTONES: readonly {
  readonly key: string;
  readonly atMillions: number;
  readonly summary: string;
}[] = [
  {
    key: "valuation:unicorn",
    atMillions: 1_000,
    summary:
      "The lab is now valued at a billion dollars. Somebody has ordered a cake; nobody has ordered more GPUs.",
  },
  {
    key: "valuation:decacorn",
    atMillions: 10_000,
    summary:
      "The lab is now valued at ten billion dollars. The recruiters have noticed, and so has everyone the recruiters call.",
  },
  {
    key: "valuation:hectocorn",
    atMillions: 100_000,
    summary:
      "The lab is now valued at a hundred billion dollars, a figure that has stopped meaning anything to the people who work here.",
  },
  {
    key: "valuation:trillion",
    atMillions: 1_000_000,
    summary:
      "The lab is now valued at one trillion dollars. The evaluation backlog is unaffected.",
  },
];

/** Compact money formatting shared by feed prose and the UI. */
export function formatValuation(millions: number): string {
  const sign = millions < 0 ? "−" : "";
  const magnitude = Math.abs(millions);
  // A lab that actually gets there is repriced into quadrillions, so the ladder
  // needs a rung above trillions or the headline of a winning run renders as
  // "$1000000.00T".
  const [scale, suffix, digits] =
    magnitude >= 1_000_000_000
      ? [1_000_000_000, "Q", 2]
      : magnitude >= 1_000_000
        ? [1_000_000, "T", 2]
        : magnitude >= 1_000
          ? [1_000, "B", 1]
          : [1, "M", 2];
  const display = (magnitude / scale).toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, "");
  return `${sign}$${display}${suffix}`;
}

export function marketMood(current: number, previous: number): string {
  if (previous <= 0) return "unpriced";
  const change = (current - previous) / previous;
  if (change >= 0.06) return "rerating";
  if (change >= 0.015) return "frothy";
  if (change <= -0.06) return "repricing";
  if (change <= -0.015) return "wobbly";
  return "steady";
}

function seedValuation(mark: number): ValuationState {
  return {
    markMillions: mark,
    previousMarkMillions: mark,
    peakMarkMillions: mark,
    announcedMilestones: [],
  };
}

/**
 * Weekly mark update for every lab. Rival marks are computed on the same
 * footing as the player's; the player only ever sees them through the noisy
 * projection in the selectors.
 */
export function advanceValuations(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const state = tx.read();
  const labIds = Object.keys(state.labs).sort() as LabId[];
  const tuning = VALUATION_TUNING;
  const updates: { labId: LabId; valuation: ValuationState }[] = [];
  const milestones: { key: string; summary: string }[] = [];

  for (const labId of labIds) {
    const lab = state.labs[labId];
    if (lab === undefined) continue;
    const target = calculateValuationTarget(state, content, labId).targetMillions;
    const existing = lab.finance.valuation;
    if (existing === undefined) {
      // First observation: start at fair value rather than drifting up from zero.
      updates.push({ labId, valuation: seedValuation(target) });
      continue;
    }

    const shocked = existing.markMillions * thisWeekIncidentShock(state, labId);
    const current = Math.max(tuning.floorMillions, shocked);
    const noise =
      (random.uniform(randomKey("valuation", labId, String(state.run.tick))) - 0.5) *
      2 *
      tuning.weeklyNoise;
    const logNext =
      Math.log(current) +
      (Math.log(target) - Math.log(current)) * tuning.momentum +
      noise;
    // Floored at cash as well as at the absolute minimum. The TARGET is floored
    // at cash, but the mark only drifts toward it at `momentum` a week, so a lab
    // that has just raised showed a valuation a little UNDER its own bank
    // balance -- $358m of market value against $364.3m in the account, which
    // reads as a mistake however defensible the drift is.
    const next = Math.max(tuning.floorMillions, lab.finance.cash, Math.exp(logNext));

    const announced = [...existing.announcedMilestones];
    if (labId === state.run.playerLabId) {
      for (const milestone of MILESTONES) {
        if (next >= milestone.atMillions && !announced.includes(milestone.key)) {
          announced.push(milestone.key);
          milestones.push({ key: milestone.key, summary: milestone.summary });
        }
      }
    }

    updates.push({
      labId,
      valuation: {
        ...existing,
        markMillions: next,
        previousMarkMillions: existing.markMillions,
        // Saves written before the peak was tracked start it here.
        peakMarkMillions: Math.max(existing.peakMarkMillions ?? 0, next),
        announcedMilestones: announced,
      },
    });
  }

  tx.update((draft) => {
    for (const update of updates) {
      const lab = draft.labs[update.labId];
      if (lab === undefined) continue;
      lab.finance.valuation = structuredClone(
        update.valuation,
      ) as DeepMutable<ValuationState>;
    }
    for (const milestone of milestones) {
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: milestone.summary,
        category: "narrative",
        source: { kind: "system", id: milestone.key },
      });
    }
  });
}

/** Current mark for a lab, falling back to its fair value before the first tick. */
export function currentMark(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): number {
  return (
    state.labs[labId]?.finance.valuation?.markMillions ??
    calculateValuationTarget(state, content, labId).targetMillions
  );
}

/**
 * What the player is told a rival is worth.
 *
 * Rivals do not raise, announce, or run campaigns — their true mark is
 * computed weekly from the economic state they already carry. The player sees
 * that mark through an offset that is re-drawn only once a quarter and then
 * bucketed coarsely, so week-to-week movement in the reported figure is
 * dominated by rumour rather than by the rival's actual week. Real trends
 * still surface at quarter resolution; precise state cannot be inverted.
 */
export function reportedRivalValuation(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  intelligenceRating: number,
  random: RandomOracle,
): {
  readonly lowMillions: number;
  readonly highMillions: number;
  readonly label: string;
} {
  const trueMark = currentMark(state, content, labId);
  const quarter = Math.floor(state.run.tick / 13);
  // Better intelligence narrows the band; it never removes it.
  const radius = 0.55 - Math.min(0.35, (intelligenceRating / 100) * 0.35);
  const offsetDraw = random.uniform(
    randomKey("valuation", "rival", labId, "quarter", String(quarter)),
  );
  const offset = 1 + (offsetDraw - 0.5) * 2 * radius;
  // Only the centre is bucketed: that is what destroys the precision an
  // attacker would need. The band around it stays a readable spread rather
  // than collapsing into the same bucket at both ends.
  const centre = bucketValuation(
    Math.max(VALUATION_TUNING.floorMillions, trueMark * offset),
  );
  const low = centre * (1 - radius * 0.5);
  const high = centre * (1 + radius * 0.5);
  return {
    lowMillions: low,
    highMillions: high,
    label: `${formatValuation(low)}–${formatValuation(high)}`,
  };
}

/**
 * Coarse bucketing so a reported figure cannot be read back into precise rival
 * state. Seven steps per decade is coarse enough that the number carries no
 * usable precision, but fine enough that two genuinely different rivals do not
 * collapse onto the same figure.
 */
const BUCKET_STEPS = [1, 1.5, 2, 3, 5, 7, 10] as const;

export function bucketValuation(millions: number): number {
  if (millions <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(millions));
  const normalised = millions / magnitude;
  const step =
    BUCKET_STEPS.find(
      (candidate, index) =>
        normalised < (candidate + (BUCKET_STEPS[index + 1] ?? 10)) / 2,
    ) ?? 10;
  return step * magnitude;
}
