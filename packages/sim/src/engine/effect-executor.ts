import { assertNever } from "../model/assert-never.ts";
import type { Effect, EffectSubject, RatingKey } from "../model/effects.ts";
import type { LabId, ModifierId } from "../model/ids.ts";
import type { EffectSource, GameState, LabState } from "../model/state.ts";
import { cashMillions, tick as makeTick } from "../model/units.ts";
import { addResearcherPromise } from "../researchers/promises.ts";
import {
  modifierEffectPreview,
  modifierTargetDisplayLabel,
} from "../presentation/modifier-copy.ts";
import type { DeepMutable } from "./draft.ts";
import { isModifierTarget } from "./modifier-targets.ts";
import type { SimulationTransaction } from "./transaction.ts";

/**
 * Central effect executor (TDD section 11.1). Every effect application goes
 * through here: validated, exhaustive, and audit-friendly. There is no
 * arbitrary property-path write and no script effect.
 */

function resolveLabId(state: GameState, subject: EffectSubject): LabId {
  switch (subject.type) {
    case "player-lab":
      return state.run.playerLabId;
    case "lab":
      return subject.labId;
    default:
      return assertNever(subject);
  }
}

function requireLab(draft: DeepMutable<GameState>, labId: LabId): DeepMutable<LabState> {
  const lab = draft.labs[labId];
  if (lab === undefined) {
    throw new Error(`Effect targets unknown lab ${labId}`);
  }
  return lab;
}

const clampRating = (value: number): number => Math.min(100, Math.max(0, value));

function sourceLabel(source: EffectSource): string {
  return `${source.kind}:${source.id ?? "unspecified"}`;
}

const MODIFIER_TARGET_LOG_LABELS: Readonly<Record<string, string>> = {
  "lab.organisation.boardPatienceTarget": "a legacy organisation term",
  "lab.organisation.internalCandourTarget": "internal candour target",
  "lab.organisation.safetyCultureTarget": "safety culture target",
  "lab.organisation.safetyCultureFloor": "safety culture floor",
  "lab.politics.governmentTrustFloor": "government trust floor",
  "lab.incident.hazard": "incident risk",
  "lab.research.all.output": "overall research output",
  "lab.research.capability.output": "capability research output",
  "lab.research.safety.output": "safety research output",
  "world.rival.progress": "rival research progress",
};

function modifierTargetLogLabel(target: string): string {
  const exact = MODIFIER_TARGET_LOG_LABELS[target];
  if (exact !== undefined) return exact;
  return modifierTargetDisplayLabel(target).toLowerCase();
}

function modifierSourceLogLabel(source: EffectSource): string {
  if (source.kind === "system" && source.id?.includes(":funding-offer:") === true) {
    return "A funding agreement";
  }
  switch (source.kind) {
    case "researcher":
      return "A star researcher";
    case "facility":
      return "A facility";
    case "leader":
      return "Your lab leader";
    case "event":
      return "A decision outcome";
    case "ending":
      return "An endgame outcome";
    case "system":
      return source.id?.startsWith("mandate:") === true
        ? "Your founding mandate"
        : "A lab-wide effect";
  }
}

function compactLogNumber(value: number, decimalPlaces = 2): string {
  return String(Number(value.toFixed(decimalPlaces)));
}

function addedModifierLogSummary(
  effect: Extract<Effect, { readonly kind: "add-modifier" }>,
  source: EffectSource,
): string {
  const subject = modifierSourceLogLabel(source);
  if (
    effect.operation === "multiply" &&
    (effect.target === "assignedProgramme.weeklyVarianceWidth" ||
      effect.target.endsWith(".weeklyVarianceWidth"))
  ) {
    const duration =
      effect.durationWeeks === undefined
        ? ""
        : ` for ${String(effect.durationWeeks)} week${effect.durationWeeks === 1 ? "" : "s"}`;
    const preview = modifierEffectPreview(effect.target, effect.operation, effect.value)
      .replace(/^Week-to-week/, "week-to-week")
      .replace(" becomes ", " ");
    return `${subject} made ${preview}${duration}.`;
  }
  const target = modifierTargetLogLabel(effect.target);
  const duration =
    effect.durationWeeks === undefined
      ? ""
      : ` for ${String(effect.durationWeeks)} week${effect.durationWeeks === 1 ? "" : "s"}`;
  switch (effect.operation) {
    case "add":
      if (effect.value === 0) return `${subject} left ${target} unchanged${duration}.`;
      return `${subject} ${effect.value > 0 ? "increased" : "reduced"} ${target} by ${compactLogNumber(Math.abs(effect.value))}${duration}.`;
    case "multiply": {
      const percentage = Math.abs((effect.value - 1) * 100);
      if (effect.value === 1) return `${subject} left ${target} unchanged${duration}.`;
      return `${subject} ${effect.value > 1 ? "increased" : "reduced"} ${target} by ${compactLogNumber(percentage, 1)}%${duration}.`;
    }
    case "min":
      return `${subject} capped ${target} at ${compactLogNumber(effect.value)}${duration}.`;
    case "max":
      return `${subject} set a minimum ${target} of ${compactLogNumber(effect.value)}${duration}.`;
  }
}

type RatingWrite = (lab: DeepMutable<LabState>, value: number) => void;
type RatingRead = (lab: DeepMutable<LabState>) => number;

const RATING_ACCESS: Readonly<
  Record<RatingKey, { read: RatingRead; write: RatingWrite }>
> = {
  safetyCulture: {
    read: (lab) => lab.safety.safetyCulture,
    write: (lab, value) => {
      lab.safety.safetyCulture = clampRating(value) as typeof lab.safety.safetyCulture;
    },
  },
  alignmentScience: {
    read: (lab) => lab.safety.alignmentScience,
    write: (lab, value) => {
      lab.safety.alignmentScience = clampRating(
        value,
      ) as typeof lab.safety.alignmentScience;
    },
  },
  evalQuality: {
    read: (lab) => lab.safety.evalQuality,
    write: (lab, value) => {
      lab.safety.evalQuality = clampRating(value) as typeof lab.safety.evalQuality;
    },
  },
  controlTheory: {
    read: (lab) => lab.safety.controlTheory,
    write: (lab, value) => {
      lab.safety.controlTheory = clampRating(value) as typeof lab.safety.controlTheory;
    },
  },
  practicalControlStrength: {
    read: (lab) => lab.safety.practicalControlStrength,
    write: (lab, value) => {
      lab.safety.practicalControlStrength = clampRating(
        value,
      ) as typeof lab.safety.practicalControlStrength;
    },
  },
  securityPosture: {
    read: (lab) => lab.safety.securityPosture,
    write: (lab, value) => {
      lab.safety.securityPosture = clampRating(
        value,
      ) as typeof lab.safety.securityPosture;
    },
  },
  boardPatience: {
    read: (lab) => lab.organisation.boardPatience,
    write: (lab, value) => {
      lab.organisation.boardPatience = clampRating(
        value,
      ) as typeof lab.organisation.boardPatience;
    },
  },
  internalCandour: {
    read: (lab) => lab.organisation.hiddenInternalCandour,
    write: (lab, value) => {
      lab.organisation.hiddenInternalCandour = clampRating(
        value,
      ) as typeof lab.organisation.hiddenInternalCandour;
    },
  },
  governmentAttention: {
    read: (lab) => lab.politics.governmentAttention,
    write: (lab, value) => {
      lab.politics.governmentAttention = clampRating(
        value,
      ) as typeof lab.politics.governmentAttention;
    },
  },
  governmentTrust: {
    read: (lab) => lab.politics.governmentTrust,
    write: (lab, value) => {
      lab.politics.governmentTrust = clampRating(
        value,
      ) as typeof lab.politics.governmentTrust;
    },
  },
  strategicDependence: {
    read: (lab) => lab.politics.strategicDependence,
    write: (lab, value) => {
      lab.politics.strategicDependence = clampRating(
        value,
      ) as typeof lab.politics.strategicDependence;
    },
  },
  captureConcern: {
    read: (lab) => lab.politics.captureConcern,
    write: (lab, value) => {
      lab.politics.captureConcern = clampRating(
        value,
      ) as typeof lab.politics.captureConcern;
    },
  },
};

export function applyEffect(
  tx: SimulationTransaction,
  effect: Effect,
  source: EffectSource,
): void {
  switch (effect.kind) {
    case "add-resource": {
      const labId = resolveLabId(tx.read(), effect.subject);
      if (effect.resource === "aura-spendable") {
        const changeKind =
          effect.auraChangeKind ?? (effect.amount >= 0 ? "gain" : "spend");
        if (
          (changeKind === "gain" && effect.amount < 0) ||
          (changeKind !== "gain" && effect.amount > 0)
        ) {
          throw new Error(
            `Aura ${changeKind} has inconsistent signed amount ${String(effect.amount)}`,
          );
        }
        if (
          !Number.isFinite(effect.amount) ||
          !Number.isFinite(effect.auraSignalImpact ?? 0)
        ) {
          throw new Error("Aura changes must contain finite amounts");
        }
        let appliedDelta = 0;
        let lifetimeDelta = 0;
        let entryId = "";
        tx.update((draft) => {
          const lab = requireLab(draft, labId);
          const before = lab.aura.spendable;
          const after = Math.max(0, before + effect.amount);
          appliedDelta = after - before;
          lifetimeDelta = Math.max(0, appliedDelta);
          lab.aura.spendable = after;
          lab.aura.lifetime += lifetimeDelta;
          entryId = `aura:${String(draft.run.tick)}:${String(lab.aura.ledger.length).padStart(4, "0")}`;
          lab.aura.ledger.push({
            id: entryId,
            occurredAt: draft.run.tick,
            kind: changeKind,
            category: effect.auraCategory ?? "other",
            requestedDelta: effect.amount,
            appliedDelta,
            lifetimeDelta,
            signalImpact: effect.auraSignalImpact ?? 0,
            source: { ...source },
          });
        });
        tx.emit({
          kind: "aura-changed",
          labId,
          entryId,
          changeKind,
          category: effect.auraCategory ?? "other",
          requestedDelta: effect.amount,
          appliedDelta,
          lifetimeDelta,
        });
        return;
      }
      tx.update((draft) => {
        const lab = requireLab(draft, labId);
        lab.finance.cash = cashMillions(lab.finance.cash + effect.amount);
        if (lab.finance.cash >= 0) {
          lab.finance.consecutiveNegativeCashWeeks = 0;
        }
        // Cycle settlement history is pruned, so the total ledger length is not
        // monotonic. Immediate entries are retained; number them within the
        // current week instead so two cash effects cannot reuse an id after a
        // settlement prunes older cycle lines in the same transaction.
        const entryIndex = lab.finance.ledger.filter(
          (entry) =>
            entry.settlementId === undefined && entry.settledAt === draft.run.tick,
        ).length;
        lab.finance.ledger.push({
          id: `finance:${String(draft.run.tick)}:immediate:${String(entryIndex).padStart(4, "0")}`,
          settledAt: draft.run.tick,
          category: effect.financeCategory ?? "adjustment",
          sourceId: source.id ?? source.kind,
          amountMillions: cashMillions(effect.amount),
          description: `${source.kind}:${source.id ?? "unspecified"}`,
        });
      });
      return;
    }
    case "add-rating": {
      tx.update((draft) => {
        const lab = requireLab(draft, resolveLabId(draft, effect.subject));
        const access = RATING_ACCESS[effect.rating];
        access.write(lab, access.read(lab) + effect.amount);
      });
      return;
    }
    case "add-coalition-rating": {
      const live = Object.values(tx.read().world.coalitions).filter(
        (coalition) => coalition.status !== "active" && coalition.status !== "fractured",
      );
      if (live.length !== 1) {
        throw new Error(
          `add-coalition-rating requires exactly one forming coalition, found ${String(live.length)}`,
        );
      }
      const coalitionId = live[0]?.id;
      if (coalitionId === undefined) throw new Error("Forming coalition disappeared");
      tx.update((draft) => {
        const coalition = draft.world.coalitions[coalitionId];
        if (coalition === undefined) throw new Error(`Unknown coalition ${coalitionId}`);
        coalition[effect.rating] = clampRating(
          coalition[effect.rating] + effect.amount,
        ) as (typeof coalition)[typeof effect.rating];
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `Coalition ${effect.rating} changed by ${String(effect.amount)} from ${sourceLabel(source)}.`,
          category: "narrative",
          source: structuredClone(source),
          relatedIds: [coalitionId],
        });
      });
      return;
    }
    case "set-flag": {
      tx.update((draft) => {
        const lab = requireLab(draft, resolveLabId(draft, effect.subject));
        lab.flags[effect.flag] = effect.value;
      });
      return;
    }
    case "add-modifier": {
      if (!isModifierTarget(effect.target)) {
        throw new Error(
          `add-modifier rejected: unknown target "${effect.target}" ` +
            `(source ${source.kind}:${source.id ?? "?"})`,
        );
      }
      const id = tx.allocateId("modifier", "world") as ModifierId;
      tx.update((draft) => {
        const startsAt = draft.run.tick;
        const labId =
          effect.subject !== undefined
            ? resolveLabId(draft, effect.subject)
            : effect.target.startsWith("lab.")
              ? draft.run.playerLabId
              : undefined;
        draft.modifiers[id] = {
          id,
          source: structuredClone(source),
          ...(labId === undefined ? {} : { labId }),
          target: effect.target,
          operation: effect.operation,
          value: effect.value,
          startsAt,
          ...(effect.durationWeeks === undefined
            ? {}
            : { endsAt: makeTick(startsAt + effect.durationWeeks) }),
          tags: [...(effect.tags ?? [])],
        };
        draft.decisionLog.push({
          tick: startsAt,
          summary: addedModifierLogSummary(effect, source),
          category: "persistent-modifier-added",
          source: structuredClone(source),
          relatedIds: [id],
        });
      });
      return;
    }
    case "remove-modifier": {
      const existing = tx.read().modifiers[effect.modifierId];
      if (existing === undefined) {
        throw new Error(`remove-modifier: no modifier ${effect.modifierId}`);
      }
      tx.update((draft) => {
        draft.modifiers = Object.fromEntries(
          Object.entries(draft.modifiers).filter(
            ([modifierId]) => modifierId !== effect.modifierId,
          ),
        );
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `The ongoing ${modifierTargetLogLabel(existing.target)} effect ended.`,
          category: "persistent-modifier-removed",
          source: structuredClone(source),
          relatedIds: [effect.modifierId],
        });
      });
      return;
    }
    case "schedule-effects": {
      const scheduledAt = tx.read().run.tick;
      const dueAt = makeTick(scheduledAt + effect.dueInWeeks);
      const id = tx.allocateId("scheduled", "world");
      tx.schedule({
        id,
        scheduledAt,
        dueAt,
        source: structuredClone(source),
        effects: structuredClone(effect.effects),
      });
      tx.update((draft) => {
        draft.decisionLog.push({
          tick: scheduledAt,
          summary: `Delayed consequence ${id} scheduled for week ${String(dueAt)} by ${sourceLabel(source)}.`,
          category: "delayed-effect-scheduled",
          source: structuredClone(source),
          relatedIds: [id],
        });
      });
      return;
    }
    case "damage-gpu-lot": {
      if (!Number.isInteger(effect.physicalGpusLost) || effect.physicalGpusLost <= 0) {
        throw new RangeError("damage-gpu-lot requires a positive integer loss");
      }
      const labId = resolveLabId(tx.read(), effect.subject);
      let actualLoss = 0;
      tx.update((draft) => {
        const lab = requireLab(draft, labId);
        const lot = lab.compute.lots.find((candidate) => candidate.id === effect.lotId);
        if (lot === undefined) throw new Error(`damage-gpu-lot: no lot ${effect.lotId}`);
        actualLoss = Math.min(effect.physicalGpusLost, lot.physicalCount);
        if (lot.recurringCostMillionsPerCycle !== undefined && lot.physicalCount > 0) {
          lot.recurringCostMillionsPerCycle = cashMillions(
            Math.round(
              ((lot.recurringCostMillionsPerCycle * (lot.physicalCount - actualLoss)) /
                lot.physicalCount) *
                100,
            ) / 100,
          );
        }
        lot.physicalCount = (lot.physicalCount - actualLoss) as typeof lot.physicalCount;
        if (lot.physicalCount === 0) {
          lab.compute.lots = lab.compute.lots.filter(
            (candidate) => candidate.id !== effect.lotId,
          );
        }
      });
      tx.emit({
        kind: "gpu-lot-damaged",
        labId,
        lotId: effect.lotId,
        physicalGpusLost: actualLoss,
      });
      return;
    }
    case "remove-gpu-lot": {
      const labId = resolveLabId(tx.read(), effect.subject);
      tx.update((draft) => {
        const lab = requireLab(draft, labId);
        if (!lab.compute.lots.some((candidate) => candidate.id === effect.lotId)) {
          throw new Error(`remove-gpu-lot: no lot ${effect.lotId}`);
        }
        lab.compute.lots = lab.compute.lots.filter(
          (candidate) => candidate.id !== effect.lotId,
        );
      });
      tx.emit({
        kind: "gpu-lot-retired",
        labId,
        lotId: effect.lotId,
        reason: effect.reason,
      });
      return;
    }
    case "add-researcher-promise": {
      addResearcherPromise(tx, {
        researcherId: effect.researcherId,
        label: effect.label,
        dueInWeeks: effect.dueInWeeks,
        condition: effect.condition,
        severity: effect.severity,
        keptMemory: effect.keptMemory,
        brokenMemory: effect.brokenMemory,
      });
      return;
    }
    case "end-run": {
      tx.update((draft) => {
        draft.run.status = effect.result;
        draft.run.endingId = effect.endingId;
      });
      tx.emit({ kind: "run-ended", result: effect.result });
      tx.requestAutoPause("critical-event");
      return;
    }
    default:
      return assertNever(effect);
  }
}

export function applyEffects(
  tx: SimulationTransaction,
  effects: readonly Effect[],
  source: EffectSource,
): void {
  for (const effect of effects) {
    applyEffect(tx, effect, source);
  }
}
