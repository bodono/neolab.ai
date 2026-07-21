import type { ContentId } from "@neolab/content-schema";

import type { LabId, ModifierId } from "./ids.ts";
import type { EffectSource, FlagValue, ModifierOperation } from "./state.ts";

/**
 * Declarative effect vocabulary (TDD section 11.1). Effects are plain data:
 * authored content and scheduled consequences store them; only the central
 * executor applies them. There is deliberately no script/eval effect.
 */

export type EffectSubject =
  | { readonly type: "player-lab" }
  | {
      readonly type: "lab";
      readonly labId: LabId;
    };

export type RatingKey =
  | "safetyCulture"
  | "alignmentScience"
  | "evalQuality"
  | "controlTheory"
  | "practicalControlStrength"
  | "securityPosture"
  | "engineeringQuality"
  | "managementCapacity"
  | "researchFreedom"
  | "boardPatience"
  | "internalCandour"
  | "governmentAttention"
  | "governmentTrust"
  | "strategicDependence"
  | "captureConcern";

export interface AddResourceEffect {
  readonly kind: "add-resource";
  readonly subject: EffectSubject;
  readonly resource: "cash" | "aura-spendable";
  readonly amount: number;
}

/** Immediate rating change, clamped to 0-100 at application (GDD 28.3). */
export interface AddRatingEffect {
  readonly kind: "add-rating";
  readonly subject: EffectSubject;
  readonly rating: RatingKey;
  readonly amount: number;
}

export interface SetFlagEffect {
  readonly kind: "set-flag";
  readonly subject: EffectSubject;
  readonly flag: string;
  readonly value: FlagValue;
}

export interface AddModifierEffect {
  readonly kind: "add-modifier";
  readonly target: string;
  readonly operation: ModifierOperation;
  readonly value: number;
  readonly durationWeeks?: number;
  readonly tags?: readonly string[];
}

export interface RemoveModifierEffect {
  readonly kind: "remove-modifier";
  readonly modifierId: ModifierId;
}

export interface ScheduleEffectsEffect {
  readonly kind: "schedule-effects";
  readonly dueInWeeks: number;
  readonly effects: readonly Effect[];
}

export interface EndRunEffect {
  readonly kind: "end-run";
  readonly result: "won" | "lost";
  readonly endingId: ContentId;
}

export type Effect =
  | AddResourceEffect
  | AddRatingEffect
  | SetFlagEffect
  | AddModifierEffect
  | RemoveModifierEffect
  | ScheduleEffectsEffect
  | EndRunEffect;

export type { EffectSource };
