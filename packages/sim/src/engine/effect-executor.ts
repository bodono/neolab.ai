import { assertNever } from "../model/assert-never.ts";
import type { Effect, EffectSubject, RatingKey } from "../model/effects.ts";
import type { LabId, ModifierId } from "../model/ids.ts";
import type { EffectSource, GameState, LabState } from "../model/state.ts";
import { tick as makeTick } from "../model/units.ts";
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
  engineeringQuality: {
    read: (lab) => lab.organisation.engineeringQuality,
    write: (lab, value) => {
      lab.organisation.engineeringQuality = clampRating(
        value,
      ) as typeof lab.organisation.engineeringQuality;
    },
  },
  managementCapacity: {
    read: (lab) => lab.organisation.managementCapacity,
    write: (lab, value) => {
      lab.organisation.managementCapacity = clampRating(
        value,
      ) as typeof lab.organisation.managementCapacity;
    },
  },
  researchFreedom: {
    read: (lab) => lab.organisation.researchFreedom,
    write: (lab, value) => {
      lab.organisation.researchFreedom = clampRating(
        value,
      ) as typeof lab.organisation.researchFreedom;
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
      tx.update((draft) => {
        const lab = requireLab(draft, resolveLabId(draft, effect.subject));
        if (effect.resource === "cash") {
          lab.finance.cash = (lab.finance.cash +
            effect.amount) as typeof lab.finance.cash;
          return;
        }
        // Spendable Aura floors at zero; Lifetime Aura only accumulates gains
        // (GDD section 38.1).
        const before = lab.aura.spendable;
        const after = Math.max(0, before + effect.amount);
        lab.aura.spendable = after;
        if (after > before) {
          lab.aura.lifetime += after - before;
        }
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
        draft.modifiers[id] = {
          id,
          source: structuredClone(source),
          target: effect.target,
          operation: effect.operation,
          value: effect.value,
          startsAt,
          ...(effect.durationWeeks === undefined
            ? {}
            : { endsAt: makeTick(startsAt + effect.durationWeeks) }),
          tags: [...(effect.tags ?? [])],
        };
      });
      return;
    }
    case "remove-modifier": {
      tx.update((draft) => {
        if (!(effect.modifierId in draft.modifiers)) {
          throw new Error(`remove-modifier: no modifier ${effect.modifierId}`);
        }
        draft.modifiers = Object.fromEntries(
          Object.entries(draft.modifiers).filter(
            ([modifierId]) => modifierId !== effect.modifierId,
          ),
        );
      });
      return;
    }
    case "schedule-effects": {
      const dueAt = makeTick(tx.read().run.tick + effect.dueInWeeks);
      const id = tx.allocateId("scheduled", "world");
      tx.schedule({
        id,
        dueAt,
        source: structuredClone(source),
        effects: structuredClone(effect.effects),
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
