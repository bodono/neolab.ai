import type { CompiledContent } from "@neolab/content-schema";

import {
  accessAcceleration,
  criticalAccessConfirmationPhrase,
  measuredFrontierCapability,
  CANDIDATE_ACCESS_RULES,
  FULL_ACCELERATION_CAPABILITY,
  type CandidateAccessRule,
} from "../endgame/access.ts";
import { accessLevelAttention } from "../politics/politics.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { LabId, ModelId, ModifierId } from "../model/ids.ts";
import type { AutonomyAccessLevel, GameState, ModelState } from "../model/state.ts";
import { rating } from "../model/units.ts";
import { STANDING_AUTONOMY_REQUIREMENTS } from "./autonomy-requirements.ts";
import { capabilityScoreForDisplay } from "./capability.ts";

export {
  STANDING_AUTONOMY_REQUIREMENTS,
  type StandingAutonomyRequirement,
} from "./autonomy-requirements.ts";

/**
 * The Autonomy Programme: recursive self-improvement as a standing bargain.
 * The player may grant the current frontier model the same access ladder the
 * Deployment Crisis uses (one ladder, one truth), pre-candidacy. Higher rungs
 * multiply lab research output — the model is doing science — while the
 * model's hidden situational awareness climbs and, if its true alignment is
 * poor, its deceptive intent compounds. Every new frontier model starts
 * back at its trained access level and must re-earn the ladder.
 */
export const AUTONOMY_MODIFIER_TAG = "autonomy";
/** Governance cooldown imposed after an escalation response rolls access back. */
export const AUTONOMY_ACCESS_ROLLBACK_LOCK_WEEKS = 52;

export type AutonomySafetyTone =
  "contained" | "guarded" | "elevated" | "high" | "critical";

const AUTONOMY_SAFETY_LABELS: Readonly<
  Record<
    AutonomyAccessLevel,
    { readonly tone: AutonomySafetyTone; readonly label: string }
  >
> = {
  0: {
    tone: "contained",
    label:
      "No autonomous action surface. Safety risk is limited to how humans use the model's answers.",
  },
  1: {
    tone: "guarded",
    label:
      "The fixed sandbox limits action, but repeated test access teaches the model what the lab measures.",
  },
  2: {
    tone: "elevated",
    label:
      "ELEVATED: tool use begins hidden situational-awareness drift; an unsafe model may learn to conceal intent.",
  },
  3: {
    tone: "high",
    label:
      "HIGH: persistent memory, weights, and internal code accelerate autonomous-action and deceptive-behaviour risk.",
  },
  4: {
    tone: "critical",
    label:
      "CRITICAL: laboratory controls enable unsanctioned experiments and systems intrusion, beginning an escalation chain that can become irreversible.",
  },
  5: {
    tone: "critical",
    label:
      "EXTREME: root and network access enable weight exfiltration, replication, and attacks on critical infrastructure. Missed or ignored escalations can end the run.",
  },
};

function autonomySourceId(labId: LabId): string {
  return `autonomy:${labId}`;
}

export function autonomySafety(level: AutonomyAccessLevel): {
  readonly tone: AutonomySafetyTone;
  readonly label: string;
} {
  return AUTONOMY_SAFETY_LABELS[level];
}

function formatMultiplier(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * What this rung is worth right now. Acceleration is quoted at the model the
 * lab actually has, with the capability-100 ceiling shown alongside so the
 * ladder reads as "this gets better as the model does" rather than as a
 * headline the player never sees.
 */
export function autonomyBenefitLabel(
  rule: CandidateAccessRule,
  measuredCapability: number,
): string {
  const parts: string[] = [];
  if (rule.accelerationMultiplier > 1) {
    const actual = accessAcceleration(rule, measuredCapability);
    parts.push(
      actual >= rule.accelerationMultiplier
        ? `Research output ×${formatMultiplier(actual)}`
        : `Research output ×${formatMultiplier(actual)}, rising to ×${formatMultiplier(
            rule.accelerationMultiplier,
          )} at measured capability ${String(FULL_ACCELERATION_CAPABILITY)}`,
    );
  }
  if (rule.evidenceQualityBonus > 0) {
    parts.push(`+${String(rule.evidenceQualityBonus)} evaluation evidence quality`);
  }
  if (parts.length === 0) return "No research acceleration";
  return parts.join(" · ");
}

/**
 * The standing political cost of the rung, which no model quality reduces.
 * Quoted from the politics formula itself so the shown number cannot drift
 * away from the charged one.
 */
export function autonomyCostLabel(rule: CandidateAccessRule): string {
  const attention = accessLevelAttention(rule.level);
  if (attention <= 0) return "No government attention from access";
  return `+${String(Math.round(attention))} government attention`;
}

export interface StandingAutonomyQuote {
  readonly rule: CandidateAccessRule;
  readonly currentLevel: AutonomyAccessLevel;
  readonly benefitLabel: string;
  readonly critical: boolean;
  readonly firstGrant: boolean;
  readonly confirmationPhrase?: string;
  readonly blockers: readonly string[];
  readonly canApply: boolean;
}

/**
 * Keep the low-level model system independent of the campaign command layer.
 * Classic games have no maturity flags and retain the complete ladder; the
 * progressive campaign begins emitting unlock requests only in its dedicated
 * Autonomy chapter.
 */
function autonomyProgrammeRevealed(state: Readonly<GameState>, labId: LabId): boolean {
  const flags = state.labs[labId]?.flags;
  if (flags?.["campaign:progressive"] !== true) return true;
  const stage = flags["campaign:lab-maturity-stage"];
  return stage === "autonomy" || stage === "frontier";
}

export function quoteStandingAutonomy(
  state: Readonly<GameState>,
  labId: LabId,
  level: AutonomyAccessLevel,
): StandingAutonomyQuote {
  const rule = CANDIDATE_ACCESS_RULES[level];
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  const modelId = lab.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  const blockers: string[] = [];
  if (model === undefined) blockers.push("Requires a current frontier model");
  if (model?.flags["endgame:false-dawn-long-pause-archive"] === true) {
    blockers.push(
      "This model is sealed in a verified Long Pause archive and cannot receive autonomy",
    );
  }
  if (state.endgame.stage !== "inactive") {
    blockers.push(
      "During the Deployment Crisis, access is governed from the crisis console",
    );
  }
  const currentLevel = model?.accessLevel ?? 0;
  if (model !== undefined && currentLevel === level) {
    blockers.push("The model already operates at this access level");
  }
  const requirement = STANDING_AUTONOMY_REQUIREMENTS[level];
  const raising = level > currentLevel;
  const accessIncreaseLockedUntil = lab.autonomy.accessIncreaseLockedUntil;
  if (
    raising &&
    accessIncreaseLockedUntil !== undefined &&
    state.run.tick < accessIncreaseLockedUntil
  ) {
    const weeksRemaining = accessIncreaseLockedUntil - state.run.tick;
    blockers.push(
      `Autonomy Programme access cannot be raised for ${String(weeksRemaining)} more ${weeksRemaining === 1 ? "week" : "weeks"} after the containment rollback`,
    );
  }
  if (model !== undefined && raising) {
    const measuredCapability = model.measuredCapability?.frontierCapability;
    if (measuredCapability === undefined) {
      blockers.push("Requires a baseline capability evaluation");
    } else if (measuredCapability < requirement.frontierCapability) {
      blockers.push(
        `Unlocks at measured capability ${String(requirement.frontierCapability)} (currently ${String(capabilityScoreForDisplay(measuredCapability))})`,
      );
    }
  }
  const firstGrant =
    raising &&
    (level === 4 || level === 5) &&
    model?.flags[`endgame:access-granted:${String(level)}`] !== true;
  const confirmationPhrase = raising
    ? criticalAccessConfirmationPhrase(level)
    : undefined;
  return {
    rule,
    currentLevel,
    benefitLabel: autonomyBenefitLabel(rule, measuredFrontierCapability(model)),
    critical: level >= 4,
    firstGrant,
    ...(confirmationPhrase === undefined ? {} : { confirmationPhrase }),
    blockers,
    canApply: blockers.length === 0,
  };
}

/**
 * Record newly crossed capability thresholds and request the highest newly
 * unlocked rung. A single strong training jump can cross several thresholds;
 * one request is presented rather than a stack of near-identical popups.
 */
export function processStandingAutonomyUnlocks(
  tx: SimulationTransaction,
  modelId: ModelId,
): void {
  const state = tx.read();
  const model = state.models[modelId];
  const lab = model === undefined ? undefined : state.labs[model.ownerLabId];
  if (
    model === undefined ||
    lab === undefined ||
    model.ownerLabId !== state.run.playerLabId ||
    lab.models.currentModelId !== modelId ||
    state.endgame.stage !== "inactive" ||
    !autonomyProgrammeRevealed(state, lab.id)
  ) {
    return;
  }
  const measuredCapability = measuredFrontierCapability(model);
  const newlyUnlocked = ([1, 2, 3, 4, 5] as const).filter(
    (level) =>
      measuredCapability >= STANDING_AUTONOMY_REQUIREMENTS[level].frontierCapability &&
      model.flags[`autonomy:capability-unlocked:${String(level)}`] !== true,
  );
  if (newlyUnlocked.length === 0) return;
  const requestedLevel = newlyUnlocked.at(-1);
  if (requestedLevel === undefined) return;
  const presentationKey = `autonomy-unlock:${modelId}:${String(requestedLevel)}`;
  tx.update((draft) => {
    const mutableModel = draft.models[modelId];
    if (mutableModel === undefined) throw new Error(`Unknown model ${modelId}`);
    for (const level of newlyUnlocked) {
      mutableModel.flags[`autonomy:capability-unlocked:${String(level)}`] = true;
    }
    if (
      requestedLevel > mutableModel.accessLevel &&
      !draft.presentationQueue.some((item) => item.key === presentationKey)
    ) {
      draft.presentationQueue.push({
        key: presentationKey,
        kind: "autonomy-unlock",
        attention: "modal",
        modelId,
        level: requestedLevel,
        createdAt: draft.run.tick,
      });
    }
  });
  if (requestedLevel > model.accessLevel) {
    tx.emit({
      kind: "autonomy-level-unlocked",
      modelId,
      level: requestedLevel,
    });
  }
}

export function setStandingAutonomy(
  tx: SimulationTransaction,
  labId: LabId,
  level: AutonomyAccessLevel,
  confirmationText?: string,
): StandingAutonomyQuote {
  const quote = quoteStandingAutonomy(tx.read(), labId, level);
  if (!quote.canApply) throw new Error(quote.blockers.join("; "));
  if (
    quote.confirmationPhrase !== undefined &&
    confirmationText !== quote.confirmationPhrase
  ) {
    throw new Error(`Type “${quote.confirmationPhrase}” to confirm critical access`);
  }
  const lab = tx.read().labs[labId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : tx.read().models[modelId];
  if (model === undefined) throw new Error("Current model disappeared");
  tx.update((draft) => {
    const mutableModel = draft.models[model.id];
    if (mutableModel === undefined) throw new Error("Current model disappeared");
    mutableModel.accessLevel = level;
    if (mutableModel.candidateArtifact !== undefined) {
      mutableModel.candidateArtifact.maximumAccessEver = Math.max(
        mutableModel.candidateArtifact.maximumAccessEver,
        level,
      ) as AutonomyAccessLevel;
    }
    if (level === 4 || level === 5) {
      mutableModel.flags[`endgame:access-granted:${String(level)}`] = true;
      mutableModel.flags["accepted-high-risk-access"] = true;
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        level > quote.currentLevel
          ? `${model.displayName} granted autonomy: ${quote.rule.displayName}.`
          : `${model.displayName} autonomy reduced to ${quote.rule.displayName}.`,
      category: "narrative",
      source: { kind: "system", id: autonomySourceId(labId) },
      relatedIds: [model.id],
    });
  });
  tx.emit({
    kind: "candidate-access-changed",
    modelId: model.id,
    previousLevel: quote.currentLevel,
    level,
    critical: quote.critical,
  });
  if (quote.critical && level > quote.currentLevel) {
    tx.requestAutoPause("critical-event");
  }
  reconcileAutonomyModifiers(tx, labId);
  return quote;
}

interface DesiredAutonomyModifier {
  readonly target: string;
  readonly operation: "multiply" | "add";
  readonly value: number;
}

/**
 * What the current rung should be paying out. Acceleration scales with the
 * model the lab actually measured; evidence quality does not, because it comes
 * from the test harness rather than from the model.
 */
function desiredAutonomyModifiers(
  model: Readonly<ModelState> | undefined,
): readonly DesiredAutonomyModifier[] {
  if (model === undefined) return [];
  const rule = CANDIDATE_ACCESS_RULES[model.accessLevel];
  const wanted: DesiredAutonomyModifier[] = [];
  const multiplier = accessAcceleration(rule, measuredFrontierCapability(model));
  if (multiplier > 1) {
    wanted.push({
      target: "lab.research.all.output",
      operation: "multiply",
      value: multiplier,
    });
  }
  if (rule.evidenceQualityBonus > 0) {
    wanted.push({
      target: "lab.evidence.displayedQuality",
      operation: "add",
      value: rule.evidenceQualityBonus,
    });
  }
  return wanted;
}

/** Keep the standing access modifiers exactly in step with current access. */
export function reconcileAutonomyModifiers(
  tx: SimulationTransaction,
  labId: LabId,
): void {
  const state = tx.read();
  const lab = state.labs[labId];
  if (lab === undefined) return;
  const modelId = lab.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  const wanted = desiredAutonomyModifiers(model);
  const sourceId = autonomySourceId(labId);
  const existing = Object.values(state.modifiers).filter(
    (modifier) =>
      modifier.source.kind === "system" &&
      modifier.source.id === sourceId &&
      modifier.tags?.includes(AUTONOMY_MODIFIER_TAG),
  );
  const alreadyCorrect =
    existing.length === wanted.length &&
    wanted.every((entry) =>
      existing.some(
        (modifier) =>
          modifier.target === entry.target &&
          modifier.operation === entry.operation &&
          modifier.value === entry.value,
      ),
    );
  if (alreadyCorrect) return;
  tx.update((draft) => {
    for (const modifier of existing) delete draft.modifiers[modifier.id];
  });
  for (const entry of wanted) {
    const modifierId = tx.allocateId("modifier", "world") as ModifierId;
    tx.update((draft) => {
      draft.modifiers[modifierId] = {
        id: modifierId,
        source: { kind: "system", id: sourceId },
        labId,
        target: entry.target,
        operation: entry.operation,
        value: entry.value,
        startsAt: draft.run.tick,
        tags: [AUTONOMY_MODIFIER_TAG],
      };
    });
  }
}

/** Per-week hidden drift while the model runs with meaningful autonomy. */
const AWARENESS_DRIFT_PER_RUNG = 0.25;
const DECEPTION_DRIFT_PER_RUNG = 0.2;
const AWARENESS_DECEPTION_THRESHOLD = 50;
const ALIGNMENT_SAFE_HARBOUR = 60;

/** Apply one week of hidden safety drift to any model using the access ladder. */
export function driftAutonomySafety(model: DeepMutable<ModelState>): void {
  if (model.accessLevel < 2) return;
  const rungs = model.accessLevel - 1;
  const hidden = model.hiddenSafety;
  hidden.situationalAwareness = rating(
    Math.min(100, hidden.situationalAwareness + AWARENESS_DRIFT_PER_RUNG * rungs),
  );
  if (
    hidden.situationalAwareness >= AWARENESS_DECEPTION_THRESHOLD &&
    hidden.trueAlignment < ALIGNMENT_SAFE_HARBOUR
  ) {
    const pressure =
      (ALIGNMENT_SAFE_HARBOUR - hidden.trueAlignment) / ALIGNMENT_SAFE_HARBOUR;
    hidden.deceptiveIntent = rating(
      Math.min(100, hidden.deceptiveIntent + DECEPTION_DRIFT_PER_RUNG * rungs * pressure),
    );
  }
}

export function updateAutonomyWeekly(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  void content;
  const state = tx.read();
  if (state.run.status !== "active") return;
  const labId = state.run.playerLabId;
  reconcileAutonomyModifiers(tx, labId);
  const lab = state.labs[labId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) return;
  processStandingAutonomyUnlocks(tx, model.id);
  if (model.accessLevel < 2) return;
  tx.update((draft) => {
    const mutable = draft.models[model.id];
    if (mutable === undefined) return;
    driftAutonomySafety(mutable);
  });
}
