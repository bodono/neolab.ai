import { contentId, type CompiledContent } from "@neolab/content-schema";
import { classifyCapabilityTier } from "../models/tiers.ts";

import { applyEffect } from "../engine/effect-executor.ts";
import { logisticProbability, resolveCheck } from "../engine/checks.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import { formatValuation } from "../finance/valuation.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { frontierLeadShare } from "../engine/world-progression.ts";
import type { LabId, ModifierId, ProjectId } from "../model/ids.ts";
import {
  formatRunEntityId,
  type GameState,
  type GovernmentCrisisTrigger,
  type GovernmentInterventionBand,
  type GovernmentInterventionKind,
  type GovernmentInterventionState,
  type GovernmentProgrammeId,
  type GovernmentResponseOutcome,
  type InterventionPressureBreakdownState,
  type LobbyingApproach,
  type LobbyingObjective,
  type LobbyingStrengthBreakdownState,
  type ProjectState,
} from "../model/state.ts";
import { cashMillions, fraction, rating, tick } from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import type { ProjectHandler } from "../projects/project-framework.ts";

export const GOVERNMENT_SEGMENT_ID = contentId("base:segment.government");
/** Live exposure from connecting deployed models to defence systems. */
export const DEFENCE_APPLICATIONS_INCIDENT_HAZARD_MULTIPLIER = 1.35;
/** Additional realised severity when that exposure becomes an incident. */
export const DEFENCE_APPLICATIONS_INCIDENT_SEVERITY_BONUS = 12;

interface LobbyingObjectiveRule {
  readonly displayName: string;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly durationWeeks: number;
  readonly difficulty: number;
}

interface LobbyingApproachRule {
  readonly displayName: string;
  readonly cashMultiplier: number;
  readonly auraMultiplier: number;
  readonly durationMultiplier: number;
  readonly strengthBonus: number;
}

const OBJECTIVE_RULES: Readonly<Record<LobbyingObjective, LobbyingObjectiveRule>> = {
  "reduce-restriction": {
    displayName: "Regulatory Relief Briefing",
    cashCostMillions: 7,
    auraCost: 8,
    durationWeeks: 4,
    difficulty: 58,
  },
  "gain-grant": {
    displayName: "Strategic Grant Campaign",
    cashCostMillions: 4,
    auraCost: 6,
    durationWeeks: 5,
    difficulty: 48,
  },
  "shape-standard": {
    displayName: "Technical Standards Initiative",
    cashCostMillions: 6,
    auraCost: 10,
    durationWeeks: 6,
    difficulty: 52,
  },
  "support-coalition": {
    displayName: "Coalition Framework Campaign",
    cashCostMillions: 8,
    auraCost: 12,
    durationWeeks: 6,
    difficulty: 62,
  },
};

const APPROACH_RULES: Readonly<Record<LobbyingApproach, LobbyingApproachRule>> = {
  "aggressive-access": {
    displayName: "Aggressive access",
    cashMultiplier: 1.15,
    auraMultiplier: 1,
    durationMultiplier: 0.75,
    strengthBonus: 12,
  },
  "transparent-standards": {
    displayName: "Transparent standards work",
    cashMultiplier: 1,
    auraMultiplier: 1.2,
    durationMultiplier: 1.25,
    strengthBonus: 6,
  },
  "technical-briefing": {
    displayName: "Technical briefing",
    cashMultiplier: 0.9,
    auraMultiplier: 0.9,
    durationMultiplier: 1,
    strengthBonus: 2,
  },
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

/**
 * The pressure ladder the quarterly intervention roll reads. Exported so the
 * politics panel can show the player which band they are in and how far the
 * next one is, rather than leaving the whole political game to be played
 * against invisible thresholds.
 */
export const INTERVENTION_BAND_FLOORS: readonly {
  readonly band: GovernmentInterventionBand;
  readonly floor: number;
}[] = [
  { band: "monitoring", floor: 0 },
  { band: "reporting", floor: 35 },
  { band: "licensing", floor: 50 },
  { band: "restriction", floor: 65 },
  { band: "crisis", floor: 80 },
];

function pressureBand(value: number): GovernmentInterventionBand {
  if (value < 35) return "monitoring";
  if (value < 50) return "reporting";
  if (value < 65) return "licensing";
  if (value < 80) return "restriction";
  return "crisis";
}

function recentIncidents(state: Readonly<GameState>, labId: LabId) {
  return state.incidents.filter(
    (incident) =>
      state.models[incident.modelId]?.ownerLabId === labId &&
      state.run.tick - incident.occurredAt <= 13,
  );
}

function deriveSystemicRisk(state: Readonly<GameState>, labId: LabId): number {
  const lab = requireLab(state, labId);
  const model =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  const apparentCapability = model?.measuredCapability?.frontierCapability ?? 0;
  const publicExposure =
    model === undefined
      ? 0
      : clamp(
          model.deployment.exposure * model.deployment.exposureMultiplier +
            model.accessLevel / 5,
          0,
          1,
        );
  const capabilityExposure = apparentCapability * publicExposure;
  const incidentRisk = recentIncidents(state, labId).reduce(
    (maximum, incident) => Math.max(maximum, incident.observedSeverity),
    0,
  );
  const marketConcentration = lab.market.marketShare * 100;
  return clamp(capabilityExposure * 0.5 + incidentRisk * 0.3 + marketConcentration * 0.2);
}

function derivePublicFear(state: Readonly<GameState>, labId: LabId): number {
  const lab = requireLab(state, labId);
  const recentScandal = lab.aura.ledger
    .filter((entry) => state.run.tick - entry.occurredAt <= 26)
    .reduce((sum, entry) => sum + Math.max(0, 0 - entry.signalImpact), 0);
  const incidentFear = recentIncidents(state, labId).reduce(
    (maximum, incident) => Math.max(maximum, incident.observedSeverity),
    0,
  );
  return clamp(
    recentScandal * 4 + incidentFear * 0.55 + lab.politics.captureConcern * 0.15,
  );
}

/** Exact quarterly formula from GDD 38.4, with every derived input auditable. */
export function calculateInterventionPressure(
  state: Readonly<GameState>,
  labId: LabId,
): InterventionPressureBreakdownState {
  const politics = requireLab(state, labId).politics;
  const systemicRisk = deriveSystemicRisk(state, labId);
  const publicFear = derivePublicFear(state, labId);
  const attentionContribution = politics.governmentAttention * 0.3;
  const distrustContribution = (100 - politics.governmentTrust) * 0.25;
  const systemicRiskContribution = systemicRisk * 0.2;
  const captureConcernContribution = politics.captureConcern * 0.15;
  const publicFearContribution = publicFear * 0.1;
  // Weight raised 0.15 -> 0.25 with the government overhaul: earned
  // dependence is the deliberate pressure shield, so it has to matter.
  const strategicValueMitigation = politics.strategicDependence * 0.25;
  const final = clamp(
    attentionContribution +
      distrustContribution +
      systemicRiskContribution +
      captureConcernContribution +
      publicFearContribution -
      strategicValueMitigation,
  );
  return {
    attentionContribution: round(attentionContribution),
    distrustContribution: round(distrustContribution),
    systemicRisk: rating(round(systemicRisk)),
    systemicRiskContribution: round(systemicRiskContribution),
    captureConcernContribution: round(captureConcernContribution),
    publicFear: rating(round(publicFear)),
    publicFearContribution: round(publicFearContribution),
    strategicValueMitigation: round(strategicValueMitigation),
    final: rating(round(final)),
    band: pressureBand(final),
  };
}

function crisisTrigger(
  state: Readonly<GameState>,
  labId: LabId,
): GovernmentCrisisTrigger {
  const lab = requireLab(state, labId);
  if (lab.flags["politics:emergency-contract-clause-invoked"] === true) {
    return "emergency-contract-clause";
  }
  if (lab.flags["politics:strategic-emergency"] === true) {
    return "strategic-emergency";
  }
  if (lab.flags["politics:defied-lawful-order"] === true) {
    return "lawful-order-defiance";
  }
  if (
    recentIncidents(state, labId).some(
      (incident) =>
        incident.category === "major" ||
        incident.category === "critical" ||
        incident.category === "catastrophe",
    )
  ) {
    return "severe-incident";
  }
  // Outside investigators surface an undetected escape after six weeks. Until
  // then it remains engine-only and cannot drive visible government behaviour.
  const escapedWeightsKnown =
    lab.autonomy.escapeRevealedAt !== undefined ||
    (lab.autonomy.escapedWeightsAt !== undefined &&
      state.run.tick - lab.autonomy.escapedWeightsAt >= 6);
  if (escapedWeightsKnown) return "escaped-weights";
  const model =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  if ((model?.accessLevel ?? 0) >= 4) return "unsupervised-autonomy";
  return "quarterly-pressure";
}

/**
 * Programme membership changes which interventions a lab actually faces.
 * Co-authoring the evaluation standard makes a paperwork request redundant;
 * being entangled with defence procurement makes the state readier to take
 * the whole lab when something goes badly wrong.
 */
function programmeAdjustedKind(
  state: Readonly<GameState>,
  labId: LabId,
  kind: GovernmentInterventionKind | undefined,
  trigger: GovernmentCrisisTrigger,
): GovernmentInterventionKind | undefined {
  const programmes = requireLab(state, labId).politics.programmes;
  // The state already has your evaluation data under the shared standard.
  if (
    kind === "reporting-request" &&
    trigger === "quarterly-pressure" &&
    programmes.includes("safety-standards-partnership")
  ) {
    return undefined;
  }
  // Defence entanglement cuts both ways: the state's interest in owning a
  // troubled supplier outright is much sharper than in owning a stranger.
  if (
    kind === "deployment-restriction" &&
    trigger !== "quarterly-pressure" &&
    programmes.includes("defence-applications")
  ) {
    return "nationalisation-crisis";
  }
  return kind;
}

function interventionKind(
  band: GovernmentInterventionBand,
  trigger: GovernmentCrisisTrigger,
): GovernmentInterventionKind | undefined {
  // Escaped weights are their own emergency: officials do not open with a
  // request for paperwork when copies are already running in the wild.
  if (trigger === "escaped-weights") {
    return band === "monitoring" ? "licensing-action" : "nationalisation-crisis";
  }
  if (band === "monitoring") {
    // A quiet lab that has handed its model the keys still gets a letter.
    return trigger === "unsupervised-autonomy" ? "reporting-request" : undefined;
  }
  if (band === "reporting") {
    return trigger === "unsupervised-autonomy" ? "licensing-action" : "reporting-request";
  }
  if (band === "licensing") {
    return trigger === "unsupervised-autonomy"
      ? "deployment-restriction"
      : "licensing-action";
  }
  if (band === "restriction") return "deployment-restriction";
  return trigger === "quarterly-pressure"
    ? "deployment-restriction"
    : "nationalisation-crisis";
}

export interface GovernmentTriggerCandidate {
  readonly kind: GovernmentInterventionKind;
  readonly trigger: GovernmentCrisisTrigger;
  readonly pressure: InterventionPressureBreakdownState;
}

/** Pure trigger selector. It never mutates ratings or imposes a restriction. */
export function detectGovernmentCrisisTriggers(
  state: Readonly<GameState>,
  labId: LabId = state.run.playerLabId,
): readonly GovernmentTriggerCandidate[] {
  const pressure = calculateInterventionPressure(state, labId);
  const trigger = crisisTrigger(state, labId);
  let kind = programmeAdjustedKind(
    state,
    labId,
    interventionKind(pressure.band, trigger),
    trigger,
  );
  // A takeover proceeding must carry the threatened consequence. Some
  // emergency mappings (notably revealed escaped weights and defence
  // entanglement) can request nationalisation below the statutory 80-point
  // gate; at that pressure the state imposes a deployment restriction instead.
  if (kind === "nationalisation-crisis" && pressure.final < 80) {
    kind = "deployment-restriction";
  }
  // Cooperation and a negotiated golden share are durable settlements. Their
  // permanent modifiers remain in force, so reopening the identical ownership
  // proceeding every quarter would be both mechanically redundant and absurd.
  if (
    kind === "nationalisation-crisis" &&
    requireLab(state, labId).politics.interventions.some(
      (intervention) =>
        intervention.kind === "nationalisation-crisis" &&
        intervention.status === "resolved" &&
        (intervention.response === "satisfied" || intervention.response === "negotiated"),
    )
  ) {
    kind = undefined;
  }
  return kind === undefined ? [] : [{ kind, trigger, pressure }];
}

function activeIntervention(state: Readonly<GameState>, labId: LabId): boolean {
  return requireLab(state, labId).politics.interventions.some(
    (intervention) => intervention.status === "pending-event",
  );
}

/** Quarters between ordinary government interventions of any kind. */
export const INTERVENTION_COOLDOWN_QUARTERS = 4;

/**
 * A deployment restriction is a durable regulatory settlement, not routine
 * quarterly paperwork. Once one has been resolved, the same order cannot be
 * reopened until three years after it was first imposed. Other intervention
 * kinds may still respond on the ordinary annual cadence.
 */
export const DEPLOYMENT_RESTRICTION_REPEAT_COOLDOWN_QUARTERS = 12;

function interventionCoolingDown(
  state: Readonly<GameState>,
  labId: LabId,
  candidate: GovernmentTriggerCandidate,
): boolean {
  const currentQuarter = Math.floor((state.run.tick + 1) / 13);
  const interventions = requireLab(state, labId).politics.interventions;
  if (
    candidate.kind === "deployment-restriction" &&
    interventions.some(
      (intervention) =>
        intervention.kind === "deployment-restriction" &&
        currentQuarter - intervention.quarterIndex <
          DEPLOYMENT_RESTRICTION_REPEAT_COOLDOWN_QUARTERS,
    )
  ) {
    return true;
  }
  const recent = interventions.filter(
    (intervention) =>
      currentQuarter - intervention.quarterIndex < INTERVENTION_COOLDOWN_QUARTERS,
  );
  if (recent.length === 0) return false;
  // A newly qualifying takeover may interrupt an ordinary cooldown, but a
  // surviving National Champion cannot face the same proceeding every quarter.
  if (
    candidate.kind === "nationalisation-crisis" &&
    candidate.trigger !== "quarterly-pressure" &&
    !recent.some((intervention) => intervention.kind === "nationalisation-crisis")
  ) {
    return false;
  }
  return true;
}

/** Attention carried by holding the world frontier alone. */
const FRONTIER_LEAD_ATTENTION = 20;

/** Attention per autonomy rung above supervised tools. */
const AUTONOMY_ATTENTION_PER_RUNG = 6;

/**
 * Attention a lab carries purely for granting an access level, with everything
 * else held equal. Two terms feed it: the rung shows up in public exposure, and
 * rungs above supervised tools add a standing surcharge on top.
 *
 * The autonomy ladder quotes its political cost from here rather than restating
 * the arithmetic, so the number the player is shown cannot drift away from the
 * number they are charged.
 */
export function accessLevelAttention(accessLevel: number): number {
  const exposureShare = (accessLevel / 5) * 25;
  const surcharge = AUTONOMY_ATTENTION_PER_RUNG * Math.max(0, accessLevel - 2);
  return exposureShare + surcharge;
}

/** Weights loose in the world are the single loudest thing a lab can do. */
const ESCAPED_WEIGHTS_ATTENTION = 30;

/**
 * Weekly decay toward a lower target. Deliberately slower than the 10% rise:
 * a reputation for danger takes about three times as long to shed as to earn.
 */
const ATTENTION_DECAY_RATE = 0.03;

/**
 * Attention never decays below the high-water mark of what the lab actually
 * did. Officials forget ambition; they do not forget incidents.
 */
export function attentionFloor(state: Readonly<GameState>, labId: LabId): number {
  const lab = requireLab(state, labId);
  const seriousIncidents = recentIncidents(state, labId).filter(
    (incident) =>
      incident.category === "major" ||
      incident.category === "critical" ||
      incident.category === "catastrophe",
  ).length;
  const escapedWeightsKnown =
    lab.autonomy.escapeRevealedAt !== undefined ||
    (lab.autonomy.escapedWeightsAt !== undefined &&
      state.run.tick - lab.autonomy.escapedWeightsAt >= 6);
  const escaped = escapedWeightsKnown ? 45 : 0;
  const champion = lab.politics.programmes.includes("national-champion") ? 50 : 0;
  return Math.max(escaped, champion, Math.min(60, seriousIncidents * 12));
}

/**
 * The state's attention follows what it can see: apparent frontier capability,
 * public deployment exposure, and how far clear of the field the lab is. The
 * lead term reads true capability rather than published evals — officials have
 * their own intelligence, and a lab pulling away from everyone else is the one
 * question every government is asking. Granting a model deep autonomy, and
 * above all letting its weights escape, are the loudest signals a lab can
 * send. Attention drifts toward this target in both directions: a lab that
 * genuinely retreats — pulls its model back, falls behind, stops shipping —
 * fades from the agenda, slowly, and never below the floor its history earned.
 */
export function governmentAttentionTarget(
  state: Readonly<GameState>,
  labId: LabId,
): number {
  const lab = requireLab(state, labId);
  const model =
    lab.models.currentModelId === undefined
      ? undefined
      : state.models[lab.models.currentModelId];
  const apparentCapability = model?.measuredCapability?.frontierCapability ?? 0;
  const publicExposure =
    model === undefined
      ? 0
      : clamp(
          model.deployment.exposure * model.deployment.exposureMultiplier +
            model.accessLevel / 5,
          0,
          1,
        );
  const frontierLead = frontierLeadShare(state, labId) * FRONTIER_LEAD_ATTENTION;
  // Autonomy is a policy choice officials can read from the outside: a lab
  // that hands its model the keys is a lab that has told everyone something.
  // The exposure term above already carries the rung's share; this is the
  // surcharge that {@link accessLevelAttention} quotes alongside it.
  const autonomyAttention =
    model === undefined
      ? 0
      : AUTONOMY_ATTENTION_PER_RUNG * Math.max(0, model.accessLevel - 2);
  const escapedWeightsKnown =
    lab.autonomy.escapeRevealedAt !== undefined ||
    (lab.autonomy.escapedWeightsAt !== undefined &&
      state.run.tick - lab.autonomy.escapedWeightsAt >= 6);
  const escapeAttention = escapedWeightsKnown ? ESCAPED_WEIGHTS_ATTENTION : 0;
  return clamp(
    apparentCapability * 0.7 +
      publicExposure * 25 +
      frontierLead +
      autonomyAttention +
      escapeAttention,
  );
}

const BAND_MODIFIER_TAG = "politics-pressure-band";

const BAND_MODIFIERS: Readonly<
  Record<
    GovernmentInterventionBand,
    readonly { readonly target: string; readonly value: number }[]
  >
> = {
  monitoring: [],
  reporting: [{ target: "lab.evaluation.cashCost", value: 1.05 }],
  licensing: [{ target: "lab.product.firstProject.durationWeeks", value: 1.1 }],
  restriction: [
    { target: "lab.market.acquisitionRate", value: 0.85 },
    { target: "lab.market.demandCeiling", value: 0.85 },
  ],
  crisis: [
    { target: "lab.market.acquisitionRate", value: 0.85 },
    { target: "lab.market.demandCeiling", value: 0.85 },
  ],
};

/**
 * Weekly government step: drift attention toward its capability-driven
 * target and keep the standing pressure-band modifiers in sync. Bands are
 * the weather; the quarterly events remain the decision moments.
 */
/**
 * Standing floor under government trust, the same shape as attentionFloor
 * above. Content that wants to say "this person keeps you in good standing
 * with the state" adds to lab.politics.governmentTrustFloor, and trust is
 * pulled UP toward that floor -- never down, so a lab that has earned high
 * trust by playing well is never dragged back to it.
 *
 * The previous spelling was lab.politics.governmentTrust.starting, a one-time
 * grant applied at game creation, which did nothing whatsoever for anyone
 * hired after week zero. Resolving a *target* against current trust instead
 * would make "add 4" mean "always four points above wherever you are", which
 * climbs to 100 and never settles.
 */
export const GOVERNMENT_TRUST_FLOOR_MODIFIER = "lab.politics.governmentTrustFloor";
/** Neutral standing, the floor before any modifier lifts it. */
export const GOVERNMENT_TRUST_FLOOR_BASE = 50;
/** Whole points a week, so a small standing bonus is never rounded away. */
export const GOVERNMENT_TRUST_RECOVERY_PER_WEEK = 1;

/** The floor a lab's standing with the state cannot sit below. */
export function governmentTrustFloor(
  state: Readonly<GameState>,
  labId: LabId = state.run.playerLabId,
): number {
  void labId;
  return resolveModifierValue(
    state,
    GOVERNMENT_TRUST_FLOOR_MODIFIER,
    GOVERNMENT_TRUST_FLOOR_BASE,
    {
      clampMin: 0,
      clampMax: 100,
    },
  ).final;
}

export function updateGovernmentWeekly(
  tx: SimulationTransaction,
  labId: LabId = tx.read().run.playerLabId,
): void {
  // Saves persist sourced modifiers rather than re-deriving them from the
  // programme definition. Reconcile first so balance changes and repaired
  // trade-offs apply to existing enrolments as well as new joins.
  reconcileGovernmentProgrammeModifiers(tx, labId);
  const state = tx.read();
  const lab = requireLab(state, labId);
  const target = governmentAttentionTarget(state, labId);
  const attention = lab.politics.governmentAttention;
  const floor = attentionFloor(state, labId);
  const rise =
    target > attention ? Math.max(1, Math.round((target - attention) * 0.1)) : 0;
  const decay =
    target < attention && attention > floor
      ? Math.max(
          1,
          Math.round((attention - Math.max(target, floor)) * ATTENTION_DECAY_RATE),
        )
      : 0;
  const band = calculateInterventionPressure(state, labId).band;
  const lastBand = lab.flags["politics:last-pressure-band"];
  const trust = lab.politics.governmentTrust;
  const trustFloor = governmentTrustFloor(state, labId);
  const nextTrust =
    trust < trustFloor
      ? Math.min(trustFloor, trust + GOVERNMENT_TRUST_RECOVERY_PER_WEEK)
      : trust;
  tx.update((draft) => {
    const mutable = draft.labs[labId];
    if (mutable === undefined) throw new Error(`Unknown lab ${labId}`);
    if (rise > 0) {
      mutable.politics.governmentAttention = rating(Math.min(target, attention + rise));
    } else if (decay > 0) {
      mutable.politics.governmentAttention = rating(
        Math.max(Math.max(target, floor), attention - decay),
      );
    }
    if (nextTrust !== trust) {
      mutable.politics.governmentTrust = rating(clamp(nextTrust));
    }
    // National champions are never off the state's radar.
    if (
      mutable.politics.programmes.includes("national-champion") &&
      mutable.politics.governmentAttention < 50
    ) {
      mutable.politics.governmentAttention = rating(50);
    }
    if (lastBand !== band) {
      mutable.flags["politics:last-pressure-band"] = band;
      for (const [modifierId, modifier] of Object.entries(draft.modifiers)) {
        if (
          modifier.tags.includes(BAND_MODIFIER_TAG) &&
          modifier.source.id === `politics:pressure-band:${labId}`
        ) {
          delete draft.modifiers[modifierId as ModifierId];
        }
      }
    }
  });
  if (lastBand !== band) {
    for (const definition of BAND_MODIFIERS[band]) {
      const modifierId = tx.allocateId("modifier", "world") as ModifierId;
      tx.update((draft) => {
        draft.modifiers[modifierId] = {
          id: modifierId,
          source: { kind: "system", id: `politics:pressure-band:${labId}` },
          labId,
          target: definition.target,
          operation: "multiply",
          value: definition.value,
          startsAt: draft.run.tick,
          tags: [BAND_MODIFIER_TAG, `band:${band}`],
        };
      });
    }
    if (BAND_MODIFIERS[band].length > 0 || lastBand !== undefined) {
      tx.update((draft) => {
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `Government posture: ${band} band${BAND_MODIFIERS[band].length > 0 ? " — standing compliance effects apply" : " — no standing effects"}.`,
          category: "narrative",
          source: { kind: "system", id: `politics:pressure-band:${labId}` },
          relatedIds: [],
        });
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Government cooperation programmes (the ladder)
// ---------------------------------------------------------------------------

export interface GovernmentProgrammeDefinition {
  readonly id: GovernmentProgrammeId;
  readonly displayName: string;
  readonly summary: string;
  readonly benefitLabel: string;
  readonly costLabel: string;
  readonly endgameLabel: string;
  readonly unlock: {
    readonly prerequisiteProgrammeId?: GovernmentProgrammeId;
    readonly trustAtLeast?: number;
    readonly dependenceAtLeast?: number;
    readonly tierAtLeast?: number;
  };
  /** One-time rating deltas applied on join. */
  readonly onJoin: {
    readonly attention?: number;
    readonly dependence?: number;
  };
  /** Standing sourced modifiers while the programme is active. */
  readonly standingModifiers: readonly {
    readonly target: string;
    readonly operation: "multiply" | "add";
    readonly value: number;
  }[];
  readonly quarterly: {
    /** Minimum quarterly payment before accelerator-price indexing. */
    readonly cashFloorMillions?: number;
    /** Multiple of the current generation's list price per 1,000 GPUs. */
    readonly currentGpuPriceMultiplier?: number;
    readonly trust?: number;
  };
}

export const GOVERNMENT_PROGRAMMES: Readonly<
  Record<GovernmentProgrammeId, GovernmentProgrammeDefinition>
> = {
  "safety-standards-partnership": {
    id: "safety-standards-partnership",
    displayName: "Safety Standards Partnership",
    summary:
      "Co-author the national evaluation standards and accept the reporting burden that follows.",
    benefitLabel:
      "Evaluation cash cost \u221215% \u00b7 trust +3 each quarter \u00b7 routine reporting requests waived",
    costLabel:
      "Reporting burden: capability research \u00d70.95 \u00b7 attention +5 on joining",
    endgameLabel:
      "Long Pause strength +4 \u00b7 licensed-route fit +3 \u00b7 emergency-response strength +2",
    unlock: { trustAtLeast: 40 },
    onJoin: { attention: 5 },
    standingModifiers: [
      { target: "lab.evaluation.cashCost", operation: "multiply", value: 0.85 },
      { target: "lab.research.capability.output", operation: "multiply", value: 0.95 },
    ],
    quarterly: { trust: 3 },
  },
  "public-sector-contract": {
    id: "public-sector-contract",
    displayName: "Public-Sector Contract",
    summary: "Serve government departments under a standing procurement agreement.",
    benefitLabel: "Payment tracks current accelerator prices",
    costLabel:
      "Private revenue \u22128% \u00b7 launches take 10% longer \u00b7 dependence +12 \u00b7 attention +6",
    endgameLabel:
      "Long Pause strength +2 \u00b7 licensed-route fit +5 \u00b7 emergency-response strength +4",
    unlock: {
      prerequisiteProgrammeId: "safety-standards-partnership",
      trustAtLeast: 50,
    },
    onJoin: { attention: 6, dependence: 12 },
    standingModifiers: [
      {
        target: "lab.product.durationWeeks",
        operation: "multiply",
        value: 1.1,
      },
      { target: "lab.revenue.all", operation: "multiply", value: 0.92 },
    ],
    quarterly: { cashFloorMillions: 25, currentGpuPriceMultiplier: 4 },
  },
  "defence-applications": {
    id: "defence-applications",
    displayName: "Defence Applications Programme",
    summary:
      "Classified model applications for the defence establishment. The money is excellent. The researchers know.",
    benefitLabel:
      "GPU orders arrive 20% sooner \u00b7 payment tracks current accelerator prices",
    costLabel:
      "Military deployment at any access level \u00b7 incident risk +35% \u00b7 severity +12 \u00b7 safety research \u221210% \u00b7 morale \u22125 \u00b7 dependence +25 \u00b7 attention +12 \u00b7 nationalisation escalation",
    endgameLabel:
      "Licensed-route fit +7 \u00b7 emergency-response strength +5 \u00b7 military integration worsens catastrophic failure",
    unlock: {
      prerequisiteProgrammeId: "public-sector-contract",
      trustAtLeast: 55,
      tierAtLeast: 4,
    },
    onJoin: { attention: 12, dependence: 25 },
    standingModifiers: [
      { target: "lab.compute.ownedDeliveryDuration", operation: "multiply", value: 0.8 },
      {
        target: "lab.incident.hazard",
        operation: "multiply",
        value: DEFENCE_APPLICATIONS_INCIDENT_HAZARD_MULTIPLIER,
      },
      { target: "lab.research.safety.output", operation: "multiply", value: 0.9 },
      { target: "researcher.moraleTarget", operation: "add", value: -5 },
    ],
    quarterly: { cashFloorMillions: 100, currentGpuPriceMultiplier: 16 },
  },
  "national-champion": {
    id: "national-champion",
    displayName: "National Champion Track",
    summary:
      "Formal designation as strategic national infrastructure. Protection has a price: you are now too important to ignore.",
    benefitLabel:
      "GPU purchases \u221215% \u00b7 payment tracks current accelerator prices",
    costLabel:
      "Private customer acquisition \u221220% \u00b7 attention never below 50 \u00b7 dependence +25 \u00b7 attention +15 \u00b7 nationalisation exposure",
    endgameLabel:
      "Long Pause strength +4 \u00b7 licensed-route fit +10 \u00b7 emergency-response strength +7 \u00b7 may refuse nationalisation once",
    unlock: {
      prerequisiteProgrammeId: "defence-applications",
      dependenceAtLeast: 50,
    },
    onJoin: { attention: 15, dependence: 25 },
    standingModifiers: [
      { target: "lab.market.acquisitionRate", operation: "multiply", value: 0.8 },
      { target: "lab.compute.ownedPurchasePrice", operation: "multiply", value: 0.85 },
    ],
    quarterly: { cashFloorMillions: 250, currentGpuPriceMultiplier: 40 },
  },
};

export interface GovernmentProgrammeEndgameBenefits {
  readonly moratorium: number;
  readonly emergencyResponse: number;
  readonly licensedDeploymentFit: number;
}

const PROGRAMME_ENDGAME_BENEFITS: Readonly<
  Record<GovernmentProgrammeId, GovernmentProgrammeEndgameBenefits>
> = {
  "safety-standards-partnership": {
    moratorium: 4,
    emergencyResponse: 2,
    licensedDeploymentFit: 3,
  },
  "public-sector-contract": {
    moratorium: 2,
    emergencyResponse: 4,
    licensedDeploymentFit: 5,
  },
  "defence-applications": {
    moratorium: 0,
    emergencyResponse: 5,
    licensedDeploymentFit: 7,
  },
  "national-champion": {
    moratorium: 4,
    emergencyResponse: 7,
    licensedDeploymentFit: 10,
  },
};

/** Distinct endgame value replaces the old "number of programmes" bonus. */
export function governmentProgrammeEndgameBenefits(
  state: Readonly<GameState>,
  labId: LabId,
): GovernmentProgrammeEndgameBenefits {
  const programmes = requireLab(state, labId).politics.programmes;
  return programmes.reduce<GovernmentProgrammeEndgameBenefits>(
    (total, programmeId) => {
      const benefit = PROGRAMME_ENDGAME_BENEFITS[programmeId];
      return {
        moratorium: total.moratorium + benefit.moratorium,
        emergencyResponse: total.emergencyResponse + benefit.emergencyResponse,
        licensedDeploymentFit:
          total.licensedDeploymentFit + benefit.licensedDeploymentFit,
      };
    },
    { moratorium: 0, emergencyResponse: 0, licensedDeploymentFit: 0 },
  );
}

const PROGRAMME_MODIFIER_TAG = "government-programme";

function programmeModifierSourceId(labId: LabId, id: GovernmentProgrammeId): string {
  return `politics:programme:${labId}:${id}`;
}

function programmeModifierFingerprint(modifier: {
  readonly target: string;
  readonly operation: string;
  readonly value: number;
}): string {
  return `${modifier.target}/${modifier.operation}/${String(modifier.value)}`;
}

/**
 * Keeps persisted standing modifiers identical to the current programme
 * definitions. This is deliberately idempotent: ordinary weekly ticks do no
 * work, while an older save receives newly added costs exactly once.
 */
export function reconcileGovernmentProgrammeModifiers(
  tx: SimulationTransaction,
  labId: LabId,
): void {
  const lab = requireLab(tx.read(), labId);
  for (const programmeId of Object.keys(
    GOVERNMENT_PROGRAMMES,
  ) as GovernmentProgrammeId[]) {
    const sourceId = programmeModifierSourceId(labId, programmeId);
    const existing = Object.entries(tx.read().modifiers).filter(
      ([, modifier]) =>
        modifier.tags.includes(PROGRAMME_MODIFIER_TAG) && modifier.source.id === sourceId,
    );
    const expected = lab.politics.programmes.includes(programmeId)
      ? GOVERNMENT_PROGRAMMES[programmeId].standingModifiers
      : [];
    const existingFingerprints = existing
      .map(([, modifier]) => programmeModifierFingerprint(modifier))
      .sort();
    const expectedFingerprints = expected.map(programmeModifierFingerprint).sort();
    if (
      existingFingerprints.length === expectedFingerprints.length &&
      existingFingerprints.every(
        (fingerprint, index) => fingerprint === expectedFingerprints[index],
      )
    ) {
      continue;
    }
    tx.update((draft) => {
      for (const [modifierId] of existing) {
        delete draft.modifiers[modifierId as ModifierId];
      }
    });
    for (const modifier of expected) {
      const modifierId = tx.allocateId("modifier", "world") as ModifierId;
      tx.update((draft) => {
        draft.modifiers[modifierId] = {
          id: modifierId,
          source: { kind: "system", id: sourceId },
          labId,
          target: modifier.target,
          operation: modifier.operation,
          value: modifier.value,
          startsAt: draft.run.tick,
          tags: [PROGRAMME_MODIFIER_TAG, programmeId],
        };
      });
    }
  }
}

function strongestMeasuredTier(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): number {
  const lab = requireLab(state, labId);
  return lab.models.modelIds.reduce((best, modelId) => {
    const model = state.models[modelId];
    if (model?.measuredCapability === undefined) return best;
    return Math.max(best, classifyCapabilityTier(state, content, modelId).level);
  }, 0);
}

export interface GovernmentProgrammeQuote {
  readonly definition: GovernmentProgrammeDefinition;
  readonly quarterlyCashMillions: number;
  readonly active: boolean;
  readonly blockers: readonly string[];
  readonly canJoin: boolean;
  readonly canLeave: boolean;
}

export function quoteGovernmentProgramme(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  programmeId: GovernmentProgrammeId,
): GovernmentProgrammeQuote {
  const definition = GOVERNMENT_PROGRAMMES[programmeId];
  const lab = requireLab(state, labId);
  const active = lab.politics.programmes.includes(programmeId);
  const blockers: string[] = [];
  if (active) {
    blockers.push("Already enrolled");
  }
  if (
    definition.unlock.prerequisiteProgrammeId !== undefined &&
    !lab.politics.programmes.includes(definition.unlock.prerequisiteProgrammeId)
  ) {
    blockers.push(
      `Requires enrolment in ${GOVERNMENT_PROGRAMMES[definition.unlock.prerequisiteProgrammeId].displayName}`,
    );
  }
  if (
    definition.unlock.trustAtLeast !== undefined &&
    lab.politics.governmentTrust < definition.unlock.trustAtLeast
  ) {
    blockers.push(`Requires government trust ${String(definition.unlock.trustAtLeast)}+`);
  }
  if (
    definition.unlock.dependenceAtLeast !== undefined &&
    lab.politics.strategicDependence < definition.unlock.dependenceAtLeast
  ) {
    blockers.push(
      `Requires strategic dependence ${String(definition.unlock.dependenceAtLeast)}+`,
    );
  }
  if (
    definition.unlock.tierAtLeast !== undefined &&
    strongestMeasuredTier(state, content, labId) < definition.unlock.tierAtLeast
  ) {
    blockers.push(
      `Requires a measured Tier ${String(definition.unlock.tierAtLeast)}+ model`,
    );
  }
  return {
    definition,
    quarterlyCashMillions: governmentProgrammeQuarterlyGrant(state, content, programmeId),
    active,
    blockers,
    canJoin: blockers.length === 0,
    canLeave: active,
  };
}

/** Leaving is allowed, but walking out on the state costs trust. */
export const PROGRAMME_EXIT_TRUST_COST = 10;

/**
 * Walking out while the state is mid-intervention is a different act from
 * an orderly exit: it reads as fleeing an inquiry, and is priced accordingly.
 */
export const PROGRAMME_EXIT_UNDER_INTERVENTION_MULTIPLIER = 3;

/** What a National Champion pays to refuse the state and survive it. */
export const CHAMPION_REFUSAL_DEPENDENCE_COST = 25;
export const CHAMPION_REFUSAL_TRUST_COST = 20;

/** True while the champion privilege exists and has not yet been spent. */
export function championRefusalAvailable(
  state: Readonly<GameState>,
  labId: LabId,
): boolean {
  const lab = requireLab(state, labId);
  return (
    lab.politics.programmes.includes("national-champion") &&
    lab.flags["politics:champion-refusal-spent"] !== true
  );
}

/** Trust cost of leaving `programmeId` right now, given the political weather. */
export function programmeExitTrustCost(state: Readonly<GameState>, labId: LabId): number {
  return activeIntervention(state, labId)
    ? PROGRAMME_EXIT_TRUST_COST * PROGRAMME_EXIT_UNDER_INTERVENTION_MULTIPLIER
    : PROGRAMME_EXIT_TRUST_COST;
}

export interface GovernmentProgrammeExitQuote {
  readonly programmeIds: readonly GovernmentProgrammeId[];
  readonly programmeNames: readonly string[];
  readonly trustCost: number;
}

/**
 * Leaving one rung also exits every active programme that depends on it. The
 * state charges for each agreement the lab walks away from.
 */
export function quoteGovernmentProgrammeExit(
  state: Readonly<GameState>,
  labId: LabId,
  programmeId: GovernmentProgrammeId,
): GovernmentProgrammeExitQuote {
  const lab = requireLab(state, labId);
  if (!lab.politics.programmes.includes(programmeId)) {
    return { programmeIds: [], programmeNames: [], trustCost: 0 };
  }

  const active = new Set(lab.politics.programmes);
  const exiting = new Set<GovernmentProgrammeId>([programmeId]);
  let foundDependent = true;
  while (foundDependent) {
    foundDependent = false;
    for (const candidateId of active) {
      const prerequisite =
        GOVERNMENT_PROGRAMMES[candidateId].unlock.prerequisiteProgrammeId;
      if (
        prerequisite !== undefined &&
        exiting.has(prerequisite) &&
        !exiting.has(candidateId)
      ) {
        exiting.add(candidateId);
        foundDependent = true;
      }
    }
  }

  const programmeIds = (
    Object.keys(GOVERNMENT_PROGRAMMES) as GovernmentProgrammeId[]
  ).filter((candidateId) => active.has(candidateId) && exiting.has(candidateId));
  return {
    programmeIds,
    programmeNames: programmeIds.map(
      (candidateId) => GOVERNMENT_PROGRAMMES[candidateId].displayName,
    ),
    trustCost: programmeExitTrustCost(state, labId) * programmeIds.length,
  };
}

export function joinGovernmentProgramme(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  programmeId: GovernmentProgrammeId,
): void {
  const quote = quoteGovernmentProgramme(tx.read(), content, labId, programmeId);
  if (!quote.canJoin) {
    throw new Error(`Programme blocked: ${quote.blockers.join("; ")}`);
  }
  const definition = quote.definition;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    lab.politics.programmes.push(programmeId);
    if (definition.onJoin.attention !== undefined) {
      lab.politics.governmentAttention = rating(
        clamp(lab.politics.governmentAttention + definition.onJoin.attention),
      );
    }
    if (definition.onJoin.dependence !== undefined) {
      lab.politics.strategicDependence = rating(
        clamp(lab.politics.strategicDependence + definition.onJoin.dependence),
      );
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Joined ${definition.displayName}.`,
      category: "narrative",
      source: { kind: "system", id: programmeModifierSourceId(labId, programmeId) },
      relatedIds: [],
    });
  });
  reconcileGovernmentProgrammeModifiers(tx, labId);
  tx.emit({
    kind: "government-programme-joined",
    labId,
    programmeId,
  });
}

export function leaveGovernmentProgramme(
  tx: SimulationTransaction,
  labId: LabId,
  programmeId: GovernmentProgrammeId,
): void {
  const lab = requireLab(tx.read(), labId);
  if (!lab.politics.programmes.includes(programmeId)) {
    throw new Error(`Not enrolled in ${programmeId}`);
  }
  const exit = quoteGovernmentProgrammeExit(tx.read(), labId, programmeId);
  const exiting = new Set(exit.programmeIds);
  tx.update((draft) => {
    const mutable = draft.labs[labId];
    if (mutable === undefined) throw new Error(`Unknown lab ${labId}`);
    mutable.politics.programmes = mutable.politics.programmes.filter(
      (candidate) => !exiting.has(candidate),
    );
    mutable.politics.governmentTrust = rating(
      clamp(mutable.politics.governmentTrust - exit.trustCost),
    );
    // Leaving the champion programme surrenders the refusal privilege; it is
    // not something a lab can bank and walk away with.
    if (exiting.has("national-champion")) {
      delete mutable.flags["politics:champion-refusal-spent"];
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        programmeExitTrustCost(draft, labId) > PROGRAMME_EXIT_TRUST_COST
          ? `Left ${exit.programmeNames.join(", ")} mid-inquiry; walking out during an intervention reads as fleeing (trust -${String(exit.trustCost)}).`
          : `Left ${exit.programmeNames.join(", ")}; the state remembers (trust -${String(exit.trustCost)}).`,
      category: "narrative",
      source: { kind: "system", id: programmeModifierSourceId(labId, programmeId) },
      relatedIds: [],
    });
  });
  reconcileGovernmentProgrammeModifiers(tx, labId);
  for (const exitedProgrammeId of exit.programmeIds) {
    tx.emit({
      kind: "government-programme-left",
      labId,
      programmeId: exitedProgrammeId,
    });
  }
}

/** Current cash payment, exposed to quotes so accelerator indexing is never opaque. */
export function governmentProgrammeQuarterlyGrant(
  state: Readonly<GameState>,
  content: CompiledContent,
  programmeId: GovernmentProgrammeId,
): number {
  const definition = GOVERNMENT_PROGRAMMES[programmeId];
  const generation = content.gpuGenerations[state.world.currentGpuGenerationId];
  if (generation === undefined) {
    throw new Error(
      `Unknown current GPU generation ${state.world.currentGpuGenerationId}`,
    );
  }
  const indexedPayment =
    (definition.quarterly.currentGpuPriceMultiplier ?? 0) *
    generation.gameCostMillionsPerThousand;
  return (
    Math.round(
      Math.max(definition.quarterly.cashFloorMillions ?? 0, indexedPayment) * 100,
    ) / 100
  );
}

/** Quarterly grants and trust drift for every active programme. */
export function settleGovernmentProgrammes(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId = tx.read().run.playerLabId,
): void {
  const lab = requireLab(tx.read(), labId);
  for (const programmeId of lab.politics.programmes) {
    const definition = GOVERNMENT_PROGRAMMES[programmeId];
    const grant = governmentProgrammeQuarterlyGrant(tx.read(), content, programmeId);
    if (grant > 0) {
      applyEffect(
        tx,
        {
          kind: "add-resource",
          subject: { type: "lab", labId },
          resource: "cash",
          amount: grant,
          financeCategory: "contract-revenue",
        },
        { kind: "system", id: programmeModifierSourceId(labId, programmeId) },
      );
    }
    if (definition.quarterly.trust !== undefined) {
      tx.update((draft) => {
        const mutable = draft.labs[labId];
        if (mutable === undefined) throw new Error(`Unknown lab ${labId}`);
        mutable.politics.governmentTrust = rating(
          clamp(mutable.politics.governmentTrust + (definition.quarterly.trust ?? 0)),
        );
      });
    }
  }
}

/** Quarter-boundary assessment. Consequences are represented by pending events. */
export function updateGovernmentQuarter(
  tx: SimulationTransaction,
  labId: LabId = tx.read().run.playerLabId,
): InterventionPressureBreakdownState {
  const evaluatedAt = tick(tx.read().run.tick + 1);
  const quarterIndex = Math.floor(evaluatedAt / 13);
  const pressure = calculateInterventionPressure(tx.read(), labId);
  // Ordinary interventions share one cooldown. The ladder can still escalate
  // immediately into a genuinely eligible takeover, but it cannot alternate
  // paperwork, licensing and restrictions every quarter.
  const detected = activeIntervention(tx.read(), labId)
    ? undefined
    : detectGovernmentCrisisTriggers(tx.read(), labId)[0];
  const candidate =
    detected !== undefined && interventionCoolingDown(tx.read(), labId, detected)
      ? undefined
      : detected;
  let intervention: GovernmentInterventionState | undefined;
  if (candidate !== undefined) {
    const id = tx.allocateId("government-action", labId);
    intervention = {
      id,
      kind: candidate.kind,
      trigger: candidate.trigger,
      createdAt: evaluatedAt,
      quarterIndex,
      pressureAtTrigger: candidate.pressure.final,
      status: "pending-event",
    };
  }
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    if (intervention !== undefined) {
      lab.politics.interventions.push(structuredClone(intervention));
    }
    lab.politics.quarterlyAssessments.push({
      quarterIndex,
      evaluatedAt,
      breakdown: structuredClone(pressure),
      ...(intervention === undefined ? {} : { interventionId: intervention.id }),
    });
    draft.decisionLog.push({
      tick: evaluatedAt,
      summary:
        `Government quarter: pressure ${pressure.final.toFixed(1)} ` +
        `(${pressure.band})${intervention === undefined ? "." : `; ${intervention.kind} opened.`}`,
    });
  });
  tx.emit({
    kind: "government-quarter-evaluated",
    labId,
    pressure: pressure.final,
    band: pressure.band,
  });
  if (intervention !== undefined) {
    tx.emit({
      kind: "government-intervention-triggered",
      labId,
      interventionId: intervention.id,
      interventionKind: intervention.kind,
      trigger: intervention.trigger,
      pressure: intervention.pressureAtTrigger,
    });
  }
  return pressure;
}

export function isNationalisationEligible(
  state: Readonly<GameState>,
  labId: LabId,
  interventionId: string,
  response: GovernmentResponseOutcome,
): boolean {
  const intervention = requireLab(state, labId).politics.interventions.find(
    (candidate) => candidate.id === interventionId,
  );
  return (
    intervention?.kind === "nationalisation-crisis" &&
    intervention.pressureAtTrigger >= 80 &&
    intervention.trigger !== "quarterly-pressure" &&
    (response === "failed" || response === "refused")
  );
}

/** Called only after a government decision event records its response. */
export function resolveGovernmentIntervention(
  tx: SimulationTransaction,
  labId: LabId,
  interventionId: string,
  response: GovernmentResponseOutcome,
): void {
  const intervention = requireLab(tx.read(), labId).politics.interventions.find(
    (candidate) => candidate.id === interventionId,
  );
  if (intervention === undefined)
    throw new Error(`Unknown intervention ${interventionId}`);
  if (intervention.status !== "pending-event") {
    throw new Error(`Intervention ${interventionId} is already ${intervention.status}`);
  }
  const eligible = isNationalisationEligible(tx.read(), labId, interventionId, response);
  // A National Champion can refuse the state once. It is not free: refusing
  // burns the standing that bought the privilege, and the second refusal
  // arrives with no privilege left to spend.
  const championProtection =
    response === "refused" && championRefusalAvailable(tx.read(), labId);
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    const mutable = lab.politics.interventions.find(
      (candidate) => candidate.id === interventionId,
    );
    if (mutable === undefined) throw new Error(`Unknown intervention ${interventionId}`);
    mutable.status =
      response === "failed" || (response === "refused" && !championProtection)
        ? "failed"
        : "resolved";
    mutable.response = response;
    mutable.resolvedAt = draft.run.tick;
    mutable.nationalisationEligibleAtResolution = eligible && !championProtection;
    if (championProtection) {
      lab.flags["politics:champion-refusal-spent"] = true;
      lab.politics.strategicDependence = rating(
        clamp(lab.politics.strategicDependence - CHAMPION_REFUSAL_DEPENDENCE_COST),
      );
      lab.politics.governmentTrust = rating(
        clamp(lab.politics.governmentTrust - CHAMPION_REFUSAL_TRUST_COST),
      );
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          "National Champion standing absorbed the refusal. The privilege is spent; the next refusal will not be.",
        category: "narrative",
        source: { kind: "system", id: interventionId },
        relatedIds: [],
      });
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Government response: ${intervention.kind} / ${response}${eligible ? " (nationalisation eligible)" : ""}.`,
    });
  });
  tx.emit({
    kind: "government-intervention-resolved",
    labId,
    interventionId,
    response,
    nationalisationEligible: eligible,
  });
  if (eligible && !championProtection) {
    applyEffect(
      tx,
      {
        kind: "end-run",
        result: "lost",
        endingId: contentId("base:ending.nationalised-future"),
      },
      { kind: "system", id: interventionId },
    );
  }
}

const RESPONSE_TAGS: Readonly<Record<string, GovernmentResponseOutcome>> = {
  "government-response:satisfied": "satisfied",
  "government-response:negotiated": "negotiated",
  "government-response:failed": "failed",
  "government-response:refused": "refused",
};

/** Resolve pending interventions from typed memories emitted by event options. */
export function synchroniseGovernmentEventResponses(
  tx: SimulationTransaction,
  labId: LabId = tx.read().run.playerLabId,
): void {
  const pending = requireLab(tx.read(), labId).politics.interventions.filter(
    (intervention) => intervention.status === "pending-event",
  );
  for (const intervention of pending) {
    const instance = Object.values(tx.read().eventInstances).find(
      (candidate) =>
        candidate.tokens["INTERVENTION_ID"] === intervention.id &&
        (candidate.status === "resolved" || candidate.status === "expired"),
    );
    if (instance === undefined) continue;
    const tags = tx
      .read()
      .decisionMemories.filter((memory) => memory.sourceEventInstanceId === instance.id)
      .flatMap((memory) => memory.tags);
    const response = Object.entries(RESPONSE_TAGS).find(([tag]) =>
      tags.includes(tag),
    )?.[1];
    if (response !== undefined) {
      resolveGovernmentIntervention(tx, labId, intervention.id, response);
    }
  }
}

function politicalSkill(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): number {
  const candidates = Object.values(state.researchers)
    .filter(
      (researcher) =>
        researcher.employerLabId === labId &&
        researcher.status === "employed" &&
        (researcher.assignment?.kind === "external-council" ||
          researcher.assignment?.kind === "research-council"),
    )
    .map((researcher) => ({
      skill:
        content.researchers.definitions[researcher.definitionId]?.skills["politics"] ?? 0,
      external: researcher.assignment?.kind === "external-council",
    }))
    .sort((left, right) => right.skill - left.skill);
  return clamp(
    candidates.reduce(
      (sum, candidate, index) =>
        sum + candidate.skill * (candidate.external ? (index === 0 ? 18 : 8) : 5),
      0,
    ),
  );
}

function coalitionBreadth(state: Readonly<GameState>, labId: LabId): number {
  const raw = requireLab(state, labId).flags["politics:coalition-breadth"];
  return typeof raw === "number" ? clamp(raw) : 0;
}

function calculateLobbyingStrength(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  approach: LobbyingApproach,
): LobbyingStrengthBreakdownState {
  const trust = requireLab(state, labId).politics.governmentTrust;
  const skill = politicalSkill(state, content, labId);
  const breadth = coalitionBreadth(state, labId);
  const approachBonus = APPROACH_RULES[approach].strengthBonus;
  return {
    governmentTrust: trust,
    politicalSkill: skill,
    coalitionBreadth: breadth,
    approachBonus,
    final: round(trust * 0.45 + skill * 0.35 + breadth * 0.2 + approachBonus),
  };
}

export interface LobbyingProjectQuote {
  readonly futureProjectId: ProjectId;
  readonly objective: LobbyingObjective;
  readonly approach: LobbyingApproach;
  readonly displayName: string;
  readonly approachName: string;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly durationWeeks: number;
  readonly chanceRange: readonly [number, number];
  readonly chanceLabel: "Long shot" | "Uncertain" | "Promising" | "Strong";
  /** What success actually pays. The costs always rendered; this did not. */
  readonly successLabel: string;
  readonly blockers: readonly string[];
}

/**
 * One sentence per objective describing exactly what applyLobbyingSuccess
 * does. These two must move together: a payoff changed there without its
 * label is an unexplained outcome, which is how this mechanic spent its
 * first year.
 */
const LOBBYING_SUCCESS_LABELS: Readonly<Record<LobbyingObjective, string>> = {
  "reduce-restriction":
    "Settles the oldest pending intervention as negotiated · +3 government trust",
  "gain-grant": "+$18M grant · +8 strategic dependence · +4 government attention",
  "shape-standard":
    "+7 government trust · −3 capture concern · the technical standard bears your fingerprints",
  "support-coalition": "+5 government trust · +15 coalition breadth",
};

function chanceRange(probability: number): readonly [number, number] {
  const lower = Math.max(0.05, Math.floor(probability * 10) / 10);
  return [round(lower, 2), round(Math.min(0.95, lower + 0.1), 2)];
}

export function quoteLobbyingProject(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  objective: LobbyingObjective,
  approach: LobbyingApproach,
): LobbyingProjectQuote {
  const lab = requireLab(state, labId);
  const objectiveRule = OBJECTIVE_RULES[objective];
  const approachRule = APPROACH_RULES[approach];
  const cashCost = round(objectiveRule.cashCostMillions * approachRule.cashMultiplier);
  const lobbyingAuraCost = resolveModifierValue(
    state,
    "action.tag.lobbying.auraCost",
    objectiveRule.auraCost * approachRule.auraMultiplier,
    { clampMin: 0 },
  ).final;
  const auraCost = round(
    objective === "support-coalition"
      ? resolveModifierValue(state, "action.tag.coalition.auraCost", lobbyingAuraCost, {
          clampMin: 0,
        }).final
      : lobbyingAuraCost,
  );
  const durationWeeks = Math.max(
    1,
    Math.round(objectiveRule.durationWeeks * approachRule.durationMultiplier),
  );
  const strength = calculateLobbyingStrength(state, content, labId, approach);
  const successLabel =
    approach === "transparent-standards"
      ? `${LOBBYING_SUCCESS_LABELS[objective]} · +4 trust for transparency`
      : LOBBYING_SUCCESS_LABELS[objective];
  const probability = Math.min(
    0.95,
    Math.max(0.05, logisticProbability(strength.final, objectiveRule.difficulty)),
  );
  const blockers: string[] = [];
  if (lab.finance.cash < cashCost) blockers.push("Insufficient cash");
  if (lab.aura.spendable < auraCost) blockers.push("Insufficient Aura");
  if (
    Object.values(state.projects).some(
      (project) =>
        project.ownerLabId === labId &&
        project.kind === "lobbying" &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    )
  ) {
    blockers.push("A lobbying project is already in progress");
  }
  if (
    objective === "reduce-restriction" &&
    !lab.politics.interventions.some(
      (intervention) =>
        intervention.status === "pending-event" &&
        intervention.kind !== "nationalisation-crisis",
    )
  ) {
    blockers.push("There is no ordinary intervention to reduce");
  }
  if (objective === "gain-grant" && lab.politics.governmentTrust < 30) {
    blockers.push("Government Trust must be at least 30");
  }
  return {
    futureProjectId: formatRunEntityId(
      "project",
      labId,
      state.run.idCounters.project,
    ) as ProjectId,
    objective,
    approach,
    displayName: objectiveRule.displayName,
    approachName: approachRule.displayName,
    cashCostMillions: cashCost,
    auraCost,
    durationWeeks,
    chanceRange: chanceRange(probability),
    chanceLabel:
      probability < 0.25
        ? "Long shot"
        : probability < 0.5
          ? "Uncertain"
          : probability < 0.75
            ? "Promising"
            : "Strong",
    successLabel,
    blockers,
  };
}

export function startLobbyingProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  objective: LobbyingObjective,
  approach: LobbyingApproach,
): LobbyingProjectQuote {
  const quote = quoteLobbyingProject(tx.read(), content, labId, objective, approach);
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const strength = calculateLobbyingStrength(tx.read(), content, labId, approach);
  const projectId = tx.allocateId("project", labId) as ProjectId;
  if (projectId !== quote.futureProjectId) {
    throw new Error("Lobbying quote became stale before project creation");
  }
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "cash",
      amount: 0 - quote.cashCostMillions,
      financeCategory: "project-cost",
    },
    { kind: "system", id: projectId },
  );
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId },
      resource: "aura-spendable",
      amount: 0 - quote.auraCost,
      auraChangeKind: "spend",
      auraCategory: "politics",
    },
    { kind: "system", id: projectId },
  );
  if (approach === "aggressive-access") {
    applyEffect(
      tx,
      {
        kind: "add-rating",
        subject: { type: "lab", labId },
        rating: "captureConcern",
        amount: 8,
      },
      { kind: "system", id: projectId },
    );
  }
  const project: ProjectState = {
    id: projectId,
    ownerLabId: labId,
    definitionId: contentId(`base:project.lobbying.${objective}`),
    kind: "lobbying",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "lobbying",
      objective,
      approach,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      auraCost: quote.auraCost,
      strengthAtStart: strength,
      difficultyAtStart: OBJECTIVE_RULES[objective].difficulty,
    },
  };
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${quote.displayName} started via ${quote.approachName}; ${formatValuation(quote.cashCostMillions)} and ${quote.auraCost.toFixed(0)} Aura committed.`,
    });
  });
  tx.emit({ kind: "project-queued", labId, projectId, projectKind: "lobbying" });
  return quote;
}

function addRating(
  tx: SimulationTransaction,
  labId: LabId,
  projectId: ProjectId,
  ratingKey:
    "governmentAttention" | "governmentTrust" | "strategicDependence" | "captureConcern",
  amount: number,
): void {
  applyEffect(
    tx,
    {
      kind: "add-rating",
      subject: { type: "lab", labId },
      rating: ratingKey,
      amount,
    },
    { kind: "system", id: projectId },
  );
}

function applyLobbyingSuccess(tx: SimulationTransaction, project: ProjectState): void {
  if (project.payload.kind !== "lobbying") throw new Error("Not a lobbying project");
  const { objective, approach } = project.payload;
  if (approach === "transparent-standards")
    addRating(tx, project.ownerLabId, project.id, "governmentTrust", 4);
  if (objective === "reduce-restriction") {
    const intervention = requireLab(tx.read(), project.ownerLabId)
      .politics.interventions.filter(
        (candidate) =>
          candidate.status === "pending-event" &&
          candidate.kind !== "nationalisation-crisis",
      )
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (intervention !== undefined) {
      resolveGovernmentIntervention(
        tx,
        project.ownerLabId,
        intervention.id,
        "negotiated",
      );
    }
    addRating(tx, project.ownerLabId, project.id, "governmentTrust", 3);
  } else if (objective === "gain-grant") {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: project.ownerLabId },
        resource: "cash",
        amount: 18,
        financeCategory: "grant",
      },
      { kind: "system", id: project.id },
    );
    addRating(tx, project.ownerLabId, project.id, "strategicDependence", 8);
    addRating(tx, project.ownerLabId, project.id, "governmentAttention", 4);
  } else if (objective === "shape-standard") {
    addRating(tx, project.ownerLabId, project.id, "governmentTrust", 7);
    addRating(tx, project.ownerLabId, project.id, "captureConcern", -3);
    applyEffect(
      tx,
      {
        kind: "set-flag",
        subject: { type: "lab", labId: project.ownerLabId },
        flag: "politics:technical-standard-shaped",
        value: true,
      },
      { kind: "system", id: project.id },
    );
  } else {
    addRating(tx, project.ownerLabId, project.id, "governmentTrust", 5);
    const previous = coalitionBreadth(tx.read(), project.ownerLabId);
    applyEffect(
      tx,
      {
        kind: "set-flag",
        subject: { type: "lab", labId: project.ownerLabId },
        flag: "politics:coalition-breadth",
        value: clamp(previous + 15),
      },
      { kind: "system", id: project.id },
    );
  }
}

export const LOBBYING_PROJECT_HANDLER: ProjectHandler<"lobbying"> = {
  kind: "lobbying",
  advance(tx, _content, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.progress = Math.min(
        1,
        mutable.progress + 1 / mutable.expectedDurationWeeks,
      );
    });
  },
  complete(tx, _content, project): void {
    if (project.payload.kind !== "lobbying") {
      throw new Error(`Project ${project.id} is not lobbying`);
    }
    const objective = project.payload.objective;
    const approach = project.payload.approach;
    const resolution = resolveCheck(
      new RandomOracleV1(tx.read().run.seed),
      randomKey("politics", "lobbying", project.id, objective, approach),
      {
        strength: project.payload.strengthAtStart.final,
        difficulty: project.payload.difficultyAtStart,
      },
    );
    if (resolution.success) applyLobbyingSuccess(tx, project);
    else {
      addRating(tx, project.ownerLabId, project.id, "governmentTrust", -3);
      addRating(tx, project.ownerLabId, project.id, "governmentAttention", 2);
    }
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable?.payload.kind !== "lobbying") {
        throw new Error(`Unknown lobbying project ${project.id}`);
      }
      mutable.payload.resolution = {
        resolvedAt: draft.run.tick,
        probability: fraction(resolution.probability),
        draw: fraction(resolution.draw),
        success: resolution.success,
      };
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${OBJECTIVE_RULES[objective].displayName} ${resolution.success ? "succeeded" : "failed"}.`,
      });
    });
    tx.emit({
      kind: "lobbying-project-resolved",
      labId: project.ownerLabId,
      projectId: project.id,
      objective,
      approach,
      success: resolution.success,
      probability: resolution.probability,
      draw: resolution.draw,
    });
  },
  cancel(tx, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
    });
  },
};
