import type {
  CompiledContent,
  EventCategory,
  EventEffectDefinition,
  EventLikelihoodLabel,
  EventSeverity,
} from "@neolab/content-schema";

import { previewEventOption } from "../events/event-engine.ts";
import type { EventInstanceState, GameState } from "../model/state.ts";

const CANDIDATE_DECLARATION_EVENT_ID = "base:event.endgame.candidate-declaration";

function targetsPlayerLab(
  state: Readonly<GameState>,
  instance: Readonly<EventInstanceState>,
): boolean {
  if (instance.definitionId !== CANDIDATE_DECLARATION_EVENT_ID) return true;
  const modelId = instance.tokens["MODEL_ID"];
  return Object.values(state.models).some(
    (model) => model.id === modelId && model.ownerLabId === state.run.playerLabId,
  );
}

export interface EventQueueOptionView {
  readonly optionId: string;
  readonly labelKey: string;
  readonly previewKey: string;
  readonly enabled: boolean;
  readonly blockers: readonly string[];
  readonly knownCosts: readonly EventEffectDefinition[];
  /** Guaranteed authored effects; random outcome branches remain hidden. */
  readonly immediateEffects: readonly EventEffectDefinition[];
  readonly uncertainty: "none" | "precommitted-checks";
  readonly likelihoodPromises: readonly {
    readonly checkId: string;
    readonly label: EventLikelihoodLabel;
  }[];
  readonly confirmationRequired: boolean;
}

export interface EventQueueItemView {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly severity: EventSeverity;
  readonly category: EventCategory;
  readonly source: "opportunity" | "mandatory";
  readonly priority: number;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly tokens: Readonly<Record<string, string | number>>;
  readonly evidence: readonly {
    readonly textKey: string;
    readonly metric?: string;
    readonly value?: number;
  }[];
  readonly createdAtTick: number;
  readonly expiresAtTick?: number;
  readonly expiresInWeeks?: number;
  readonly deadlineLabel: string;
  readonly options: readonly EventQueueOptionView[];
}

export interface EventQueueView {
  readonly autoPauseReasons: readonly string[];
  readonly items: readonly EventQueueItemView[];
}

/** Player-safe event queue. Random commitments and outcome branches stay canonical-only. */
export function projectEventQueueView(
  state: Readonly<GameState>,
  content: CompiledContent,
): EventQueueView {
  const items = Object.values(state.eventInstances)
    .filter(
      (instance) => instance.status === "unresolved" && targetsPlayerLab(state, instance),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.createdAt - right.createdAt ||
        (left.id < right.id ? -1 : 1),
    )
    .flatMap<EventQueueItemView>((instance) => {
      const definition = content.events.definitions[instance.definitionId];
      if (definition === undefined) return [];
      const expiresInWeeks =
        instance.expiresAt === undefined
          ? undefined
          : Math.max(0, instance.expiresAt - state.run.tick);
      return [
        {
          instanceId: instance.id,
          definitionId: instance.definitionId,
          severity: definition.severity,
          category: definition.category,
          source: instance.source,
          priority: instance.priority,
          titleKey: definition.titleKey,
          bodyKey: definition.bodyKey,
          tokens: { ...instance.tokens },
          evidence: instance.evidenceSnapshot.map((line) => ({ ...line })),
          createdAtTick: instance.createdAt,
          ...(expiresInWeeks === undefined
            ? {}
            : {
                expiresAtTick: instance.expiresAt ?? state.run.tick,
                expiresInWeeks,
              }),
          deadlineLabel:
            expiresInWeeks === undefined
              ? definition.severity === "critical"
                ? "Blocking decision · no expiry"
                : "No expiry · remains in Lab feed"
              : expiresInWeeks === 0
                ? "Default action due now"
                : `${String(expiresInWeeks)} week${expiresInWeeks === 1 ? "" : "s"} remaining`,
          options: definition.options.map((option) => {
            const preview = previewEventOption(state, content, instance.id, option.id);
            return {
              optionId: option.id,
              labelKey: preview.labelKey,
              previewKey: preview.previewKey,
              enabled: preview.enabled,
              blockers: [...preview.blockers],
              knownCosts: preview.knownCosts.map((effect) => structuredClone(effect)),
              immediateEffects: preview.immediateEffects.map((effect) =>
                structuredClone(effect),
              ),
              uncertainty: preview.uncertainty,
              likelihoodPromises: preview.likelihoodPromises.map((promise) => ({
                ...promise,
              })),
              confirmationRequired: preview.confirmationRequired,
            };
          }),
        },
      ];
    });
  return { autoPauseReasons: [...state.run.autoPauseReasons], items };
}
