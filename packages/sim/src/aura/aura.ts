import type { AuraRulesDefinition, CompiledContent } from "@neolab/content-schema";

import { applyEffect } from "../engine/effect-executor.ts";
import type { ModifierContribution } from "../engine/modifier-resolver.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId } from "../model/ids.ts";
import type { AuraLedgerEntry, GameState } from "../model/state.ts";
import type { Tick } from "../model/units.ts";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Additive multiplier growth for each point of measured world capability. */
export const AURA_MARKET_PRESSURE_PER_CAPABILITY_POINT = 0.025;

export interface AuraMarketPressureQuote {
  readonly baseAuraCost: number;
  readonly worldFrontierCapability: number;
  readonly marketPressureMultiplier: number;
  readonly globalMarketPressureAuraCost: number;
  readonly marketAdjustedAuraCost: number;
}

/**
 * Hiring and fundraising compete in one global market for prestige. Every ten
 * points of measured world frontier capability add 25 percentage points to
 * their Aura multiplier. The final cost rounds upward to whole Aura.
 */
export function quoteAuraMarketPressure(
  state: Readonly<GameState>,
  baseAuraCost: number,
): AuraMarketPressureQuote {
  const worldFrontierCapability = Math.max(
    0,
    ...Object.values(state.models).map(
      (model) => model.measuredCapability?.frontierCapability ?? 0,
    ),
  );
  const marketPressureMultiplier =
    1 + worldFrontierCapability * AURA_MARKET_PRESSURE_PER_CAPABILITY_POINT;
  const marketAdjustedAuraCost = Math.ceil(baseAuraCost * marketPressureMultiplier);
  return {
    baseAuraCost,
    worldFrontierCapability,
    marketPressureMultiplier,
    globalMarketPressureAuraCost: marketAdjustedAuraCost - baseAuraCost,
    marketAdjustedAuraCost,
  };
}

function remainingFraction(ageWeeks: number, recoveryWeeks: number): number {
  return clamp(1 - ageWeeks / recoveryWeeks, 0, 1);
}

function applyContributions(
  base: number,
  contributions: readonly ModifierContribution[],
): number {
  let value = base;
  const ordered = [...contributions].sort((left, right) =>
    left.modifierId < right.modifierId ? -1 : left.modifierId > right.modifierId ? 1 : 0,
  );
  for (const contribution of ordered) {
    if (contribution.operation === "min") value = Math.min(value, contribution.value);
    if (contribution.operation === "max") value = Math.max(value, contribution.value);
  }
  for (const contribution of ordered) {
    if (contribution.operation === "add") value += contribution.value;
  }
  for (const contribution of ordered) {
    if (contribution.operation === "multiply") value *= contribution.value;
  }
  return value;
}

export interface AuraGainBreakdown {
  readonly base: number;
  readonly targets: readonly string[];
  readonly researcherApplied: number;
  readonly finalUnrounded: number;
  readonly final: number;
  readonly contributions: readonly ModifierContribution[];
}

/**
 * Resolve one public Aura gain through every applicable modifier target.
 * Researcher contributions across several applicable target families stack in
 * full. Explicit flat awards remain flat rather than being multiplied.
 */
export function calculateAuraGain(
  state: Readonly<GameState>,
  base: number,
  targets: readonly string[],
): AuraGainBreakdown {
  const uniqueTargets = [...new Set(targets)].sort();
  const contributions = uniqueTargets.flatMap(
    (target) => resolveModifierValue(state, target, base).contributions,
  );
  const researcherContributions = contributions.filter(
    (contribution) => contribution.sourceKind === "researcher",
  );
  const otherContributions = contributions.filter(
    (contribution) => contribution.sourceKind !== "researcher",
  );
  // Explicit flat awards such as "+2 Aura for a replicated paper" remain flat
  // and still work from base 0.
  const researcherFlat = researcherContributions
    .filter((contribution) => contribution.operation === "add")
    .reduce((sum, contribution) => sum + contribution.value, 0);
  const researcherScaling = researcherContributions.filter(
    (contribution) => contribution.operation !== "add",
  );
  const researcherApplied = applyContributions(base, researcherScaling) + researcherFlat;
  const finalUnrounded = Math.max(
    0,
    applyContributions(researcherApplied, otherContributions),
  );
  return {
    base,
    targets: uniqueTargets,
    researcherApplied,
    finalUnrounded,
    final: Math.round(finalUnrounded),
    contributions,
  };
}

export interface AuraSignalBreakdown {
  readonly lifetimeBase: number;
  readonly recentPublicEvents: number;
  readonly scandalPenalty: number;
  readonly final: number;
  readonly recoveryWeeks: number;
  readonly activeEntryIds: readonly string[];
}

/** Pure, player-visible Aura Signal derivation (GDD 38.1–38.2). */
/**
 * Spending aura no longer dents public standing.
 *
 * It used to subtract |amount| x 0.25, decaying over 26 weeks, so a 20-aura
 * evaluation cost 5 signal points for half a year on top of the aura itself.
 * Aura's main sink IS evaluations, so the penalty fell hardest on the most
 * safety-conscious play, and it stacked with the cold-start problem: a lab with
 * no lifetime aura to spend was already the one that could not raise.
 *
 * Lifetime aura is cumulative and never falls, so what the lab has DONE still
 * sets its standing. Calling in goodwill is simply no longer read as a scandal.
 */
export function calculateAuraSignal(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): AuraSignalBreakdown {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const rules = content.aura;
  const lifetimeBase = clamp(
    lab.aura.lifetime * rules.lifetimeSignalPerAura,
    0,
    rules.signalMaximum,
  );
  let recentPublicEvents = 0;
  let scandalPenalty = 0;
  const activeEntryIds: string[] = [];
  for (const entry of lab.aura.ledger) {
    const age = Math.max(0, state.run.tick - entry.occurredAt);
    const eventRemaining = remainingFraction(age, rules.publicEventRecoveryWeeks);
    let active = false;
    if (entry.signalImpact > 0 && eventRemaining > 0) {
      recentPublicEvents += entry.signalImpact * eventRemaining;
      active = true;
    } else if (entry.signalImpact < 0 && eventRemaining > 0) {
      scandalPenalty += Math.abs(entry.signalImpact) * eventRemaining;
      active = true;
    }
    if (active) activeEntryIds.push(entry.id);
  }
  return {
    lifetimeBase,
    recentPublicEvents,
    scandalPenalty,
    final: clamp(
      lifetimeBase + recentPublicEvents - scandalPenalty,
      0,
      rules.signalMaximum,
    ),
    recoveryWeeks: rules.publicEventRecoveryWeeks,
    activeEntryIds,
  };
}

/**
 * The one standing target a building can carry: Aura paid every cycle, simply
 * for existing.
 *
 * Every other Aura source is an event -- a paper lands, a model ships, a
 * segment is delighted -- and all of them presuppose the lab already has
 * output. That left the opening of a run with no route to standing at all:
 * fundraising wants Aura, Aura wants published work, published work wants
 * compute, and compute wants the money. Institutions break the loop. A press
 * office or a public seminar hall earns a little standing per cycle from the
 * day it opens, so a lab with nothing shipped is still visible.
 *
 * Resolved against base 0, so authored effects are flat `add` amounts and read
 * exactly as written.
 */
export const STANDING_INCOME_TARGET = "lab.aura.standingIncome";

export interface StandingIncomeBreakdown {
  /** Aura paid per cycle, rounded to whole points as the ledger stores them. */
  readonly perCycle: number;
  readonly contributions: readonly ModifierContribution[];
}

export function auraStandingIncome(
  state: Readonly<GameState>,
  labId: LabId,
): StandingIncomeBreakdown {
  const resolved = resolveModifierValue(state, STANDING_INCOME_TARGET, 0, { labId });
  return {
    perCycle: Math.max(0, Math.round(resolved.final)),
    contributions: resolved.contributions,
  };
}

/**
 * Pay every lab its standing income for the cycle just settled.
 *
 * Called once at the cycle boundary, on the same beat as market settlement, so
 * "per cycle" means the same thing everywhere a player reads it.
 */
export function payAuraStandingIncome(tx: SimulationTransaction, settledAt: Tick): void {
  const labIds = Object.keys(tx.read().labs).sort() as LabId[];
  for (const labId of labIds) {
    const income = auraStandingIncome(tx.read(), labId);
    if (income.perCycle <= 0) continue;
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: income.perCycle,
        auraChangeKind: "gain",
        auraCategory: "institution",
        // Standing income is public by construction -- it comes from things
        // the outside world can see -- so it moves the fundraising signal on
        // the same terms as a satisfied customer.
        auraSignalImpact: income.perCycle * STANDING_INCOME_SIGNAL_IMPACT_PER_AURA,
      },
      { kind: "system", id: `aura.standingIncome:${String(settledAt)}` },
    );
  }
}

/** Signal earned per point of standing income, matching customer satisfaction. */
export const STANDING_INCOME_SIGNAL_IMPACT_PER_AURA = 1;

export function modelLaunchBaseAura(
  rules: AuraRulesDefinition,
  measuredCapability: number,
): number {
  return (
    rules.modelLaunchAwards.find(
      (band) => measuredCapability <= band.maximumMeasuredCapability,
    )?.aura ??
    rules.modelLaunchAwards.at(-1)?.aura ??
    0
  );
}

export function latestAuraEntries(
  state: Readonly<GameState>,
  labId: LabId,
  limit = 8,
): readonly AuraLedgerEntry[] {
  const ledger = state.labs[labId]?.aura.ledger ?? [];
  return ledger.slice(Math.max(0, ledger.length - limit)).reverse();
}
