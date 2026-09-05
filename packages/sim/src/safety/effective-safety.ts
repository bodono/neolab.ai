import type { LabId } from "../model/ids.ts";
import type { GameState } from "../model/state.ts";

export const SAFETY_PROGRAM_OPERATIONAL_CONVERSION = 0.2;
/**
 * Effective evaluation quality deliberately needs three different kinds of
 * investment. Research supplies methods, repeated evaluations supply practice,
 * and authored lab rewards supply institutional foundations. No one pillar can
 * reach 100 alone.
 */
export const EVALUATION_QUALITY_RESEARCH_CONVERSION = 0.3;
export const EVALUATION_QUALITY_PRACTICE_CONVERSION = 0.4;
export const EVALUATION_QUALITY_LAB_RECORD_MAX = 30;
export const OPERATIONAL_DEFENCE_PRACTICAL_CONTROL_WEIGHT = 0.7;
export const OPERATIONAL_DEFENCE_SECURITY_WEIGHT = 0.3;

export interface EvaluationQualityBreakdown {
  /** Effective contribution from permanent model-evaluation practice. */
  readonly practice: number;
  /** Effective contribution from starting quality, papers, and decisions. */
  readonly labRecord: number;
  /** Effective contribution from Interpretability & Evals research. */
  readonly research: number;
  readonly uncapped: number;
  readonly effective: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function resolveLabId(state: Readonly<GameState>, labId?: LabId): LabId {
  return labId ?? state.run.playerLabId;
}

function safetyProgrammeLevel(
  state: Readonly<GameState>,
  labId: LabId,
  programmeId: string,
): number {
  return state.labs[labId]?.research.safetyPrograms[programmeId]?.level ?? 0;
}

/**
 * Mature safety programmes turn published methods into operational capacity.
 * These selectors are shared by ordinary incidents, autonomy and the endgame
 * so a programme level has one mechanical meaning everywhere.
 */
export function effectivePracticalControlStrength(
  state: Readonly<GameState>,
  labId: LabId = resolveLabId(state),
): number {
  const lab = state.labs[labId];
  return clamp(
    (lab?.safety.practicalControlStrength ?? 0) +
      safetyProgrammeLevel(state, labId, "base:safety.alignment-control") *
        SAFETY_PROGRAM_OPERATIONAL_CONVERSION,
  );
}

export function effectiveSecurityPosture(
  state: Readonly<GameState>,
  labId: LabId = resolveLabId(state),
): number {
  const lab = state.labs[labId];
  return clamp(
    (lab?.safety.securityPosture ?? 0) +
      safetyProgrammeLevel(state, labId, "base:safety.security-containment") *
        SAFETY_PROGRAM_OPERATIONAL_CONVERSION,
  );
}

export function effectiveEvaluationQuality(
  state: Readonly<GameState>,
  labId: LabId = resolveLabId(state),
): number {
  return evaluationQualityBreakdown(state, labId).effective;
}

export function evaluationQualityBreakdown(
  state: Readonly<GameState>,
  labId: LabId = resolveLabId(state),
): EvaluationQualityBreakdown {
  const lab = state.labs[labId];
  const practice = (lab?.safety.practiceXp ?? 0) * EVALUATION_QUALITY_PRACTICE_CONVERSION;
  const labRecord = Math.min(
    EVALUATION_QUALITY_LAB_RECORD_MAX,
    lab?.safety.evalQuality ?? 0,
  );
  const research =
    safetyProgrammeLevel(state, labId, "base:safety.interpretability-evals") *
    EVALUATION_QUALITY_RESEARCH_CONVERSION;
  const uncapped = practice + labRecord + research;
  return {
    practice,
    labRecord,
    research,
    uncapped,
    effective: clamp(uncapped),
  };
}

/**
 * Perfect defence divides risk by this factor -- a 75% cut -- and never
 * erases it: a misaligned model at root always keeps a residual rate.
 * Shared by the incident engine and autonomy escalation so the two risk
 * systems always agree on what a point of defence is worth.
 */
export const OPERATIONAL_DEFENCE_MAX_DIVISOR = 4;

export function operationalDefenceDivisor(defence: number): number {
  return 1 + ((OPERATIONAL_DEFENCE_MAX_DIVISOR - 1) * clamp(defence)) / 100;
}

/**
 * The same 75% endpoint as the divisor, but linear in the multiplier: risk
 * x1 at zero defence falling to x0.25 at perfect defence. The incident
 * engine uses this shape because division front-loads its relief -- under a
 * divisor, a startup's first ten points of hygiene bought a quarter of the
 * total cut, which is exactly backwards for a stat that must be earned.
 */
export function operationalDefenceMultiplier(defence: number): number {
  return 1 - ((1 - 1 / OPERATIONAL_DEFENCE_MAX_DIVISOR) * clamp(defence)) / 100;
}

/**
 * Ordinary failures can be prevented by sound controls and by containment.
 * Practical controls remain the larger contribution; security is deliberately
 * secondary rather than irrelevant.
 */
export function effectiveOperationalDefence(
  state: Readonly<GameState>,
  labId: LabId = resolveLabId(state),
): number {
  return clamp(
    OPERATIONAL_DEFENCE_PRACTICAL_CONTROL_WEIGHT *
      effectivePracticalControlStrength(state, labId) +
      OPERATIONAL_DEFENCE_SECURITY_WEIGHT * effectiveSecurityPosture(state, labId),
  );
}
