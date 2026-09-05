import type { ContentId } from "@neolab/content-schema";

import type { GpuLotId, LabId, ModifierId, ResearcherId } from "./ids.ts";
import type {
  EffectSource,
  AuraCategory,
  AuraChangeKind,
  FinanceLedgerCategory,
  FlagValue,
  ModifierOperation,
  ResearcherMemoryEffectState,
  ResearcherPromiseConditionState,
} from "./state.ts";

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
  readonly financeCategory?: FinanceLedgerCategory;
  /** Aura-only metadata. Negative changes default to spend, positives to gain. */
  readonly auraChangeKind?: AuraChangeKind;
  readonly auraCategory?: AuraCategory;
  /** Recent public-event contribution to Aura Signal; decays over 26 weeks. */
  readonly auraSignalImpact?: number;
}

/** Immediate rating change, clamped to 0-100 at application (GDD 28.3). */
export interface AddRatingEffect {
  readonly kind: "add-rating";
  readonly subject: EffectSubject;
  readonly rating: RatingKey;
  readonly amount: number;
}

/** Event/project hook for the player's single live coalition process. */
export interface AddCoalitionRatingEffect {
  readonly kind: "add-coalition-rating";
  readonly rating: "charterClarity" | "sharedProtocolQuality" | "verification";
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
  /** Omitted for a genuinely global modifier. */
  readonly subject?: EffectSubject;
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

export interface DamageGpuLotEffect {
  readonly kind: "damage-gpu-lot";
  readonly subject: EffectSubject;
  readonly lotId: GpuLotId;
  readonly physicalGpusLost: number;
}

export interface RemoveGpuLotEffect {
  readonly kind: "remove-gpu-lot";
  readonly subject: EffectSubject;
  readonly lotId: GpuLotId;
  readonly reason: "sold" | "returned" | "lease-expired" | "seized" | "destroyed";
}

export interface AddResearcherPromiseEffect {
  readonly kind: "add-researcher-promise";
  readonly researcherId: ResearcherId;
  readonly label: string;
  readonly dueInWeeks: number;
  readonly condition: ResearcherPromiseConditionState;
  readonly severity: "minor" | "major" | "flagrant";
  readonly keptMemory: ResearcherMemoryEffectState;
  readonly brokenMemory: ResearcherMemoryEffectState;
}

export interface EndRunEffect {
  readonly kind: "end-run";
  readonly result: "won" | "lost";
  readonly endingId: ContentId;
}

export type Effect =
  | AddResourceEffect
  | AddRatingEffect
  | AddCoalitionRatingEffect
  | SetFlagEffect
  | AddModifierEffect
  | RemoveModifierEffect
  | ScheduleEffectsEffect
  | DamageGpuLotEffect
  | RemoveGpuLotEffect
  | AddResearcherPromiseEffect
  | EndRunEffect;

export type { EffectSource };
