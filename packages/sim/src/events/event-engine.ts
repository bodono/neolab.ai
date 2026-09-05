import {
  contentId,
  type CompiledContent,
  type ContentId,
  type EventDefinition,
  type EventEffectDefinition,
  type EventLikelihoodLabel,
  type EventMemoryDefinition,
} from "@neolab/content-schema";

import { applyEffects } from "../engine/effect-executor.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { evaluatePredicate, readMetric } from "../engine/predicates.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { forecastFinance } from "../finance/finance.ts";
import type { Effect } from "../model/effects.ts";
import type { CommandId, EventInstanceId, ModelId, ResearcherId } from "../model/ids.ts";
import type {
  DecisionMemory,
  DecisionMemorySubject,
  EventInstanceState,
  EventOutcomeCommitmentState,
  EventTokenValue,
  GameState,
} from "../model/state.ts";
import { fraction, tick } from "../model/units.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { setCandidateAccess } from "../endgame/access.ts";
import {
  isProgressiveCampaign,
  isProgressiveOpeningProtected,
  labMaturityStage,
  LAB_MATURITY_STAGE_ENTERED_AT_FLAG,
} from "../campaign/lab-maturity.ts";
import {
  CANDIDATE_DECLARATION_OPTION_IDS,
  CANDIDATE_PROOF_OPENING_DURATION_FLAG,
} from "../endgame/opening-posture.ts";
import { acceptUltimatumSettlement } from "../researchers/people.ts";
import { formatEventMessage } from "./message-format.ts";
import {
  RESEARCHER_ULTIMATUM_EVENT_ID,
  researcherUltimatumEventBlockers,
} from "./researcher-ultimatum-lifecycle.ts";

const BASE_OPPORTUNITY_CHANCE = 0.022;
const PITY_START_WEEKS = 12;
const PITY_WEEKLY_STEP = 0.003;
const PITY_MAX_CHANCE = 0.08;
const GUARANTEE_AFTER_WEEKS = 30;
const CANDIDATE_DECLARATION_EVENT_ID = contentId(
  "base:event.endgame.candidate-declaration",
);
const SEVERITY_PRIORITY: Readonly<Record<EventDefinition["severity"], number>> = {
  feed: 0,
  decision: 10,
  urgent: 50,
  critical: 100,
};

export interface TriggerCandidate {
  readonly definitionId: ContentId;
  readonly priority: number;
  readonly triggerKey: string;
  readonly tokens: Readonly<Record<string, EventTokenValue>>;
}

export interface WeightedEventCandidate {
  readonly definitionId: ContentId;
  readonly category: EventDefinition["category"];
  readonly weight: number;
  readonly stateMultiplier: number;
}

export interface EventOptionPreview {
  readonly instanceId: EventInstanceId;
  readonly optionId: string;
  readonly labelKey: string;
  readonly previewKey: string;
  readonly enabled: boolean;
  readonly blockers: readonly string[];
  readonly knownCosts: readonly EventEffectDefinition[];
  /** Deterministic effects applied immediately after the option is chosen. */
  readonly immediateEffects: readonly EventEffectDefinition[];
  readonly uncertainty: "none" | "precommitted-checks";
  readonly checkCount: number;
  /** Player-safe authored promises only; success branches and probabilities stay hidden. */
  readonly likelihoodPromises: readonly {
    readonly checkId: string;
    readonly label: EventLikelihoodLabel;
  }[];
  readonly confirmationRequired: boolean;
}

export interface EventResolution {
  readonly instanceId: EventInstanceId;
  readonly optionId: string;
  readonly kind: "player" | "default";
  readonly outcomeIds: readonly string[];
}

interface InstantiateOptions {
  readonly source: "opportunity" | "mandatory";
  readonly triggerKey?: string;
  readonly priorityBonus?: number;
  readonly tokens?: Readonly<Record<string, EventTokenValue>>;
}

function definitionIds(content: CompiledContent): readonly ContentId[] {
  return content.events.orderedIds.length > 0
    ? content.events.orderedIds
    : (Object.keys(content.events.definitions).sort() as ContentId[]);
}

function requireDefinition(
  content: CompiledContent,
  definitionId: ContentId,
): EventDefinition {
  const definition = content.events.definitions[definitionId];
  if (definition === undefined)
    throw new Error(`Unknown event definition ${definitionId}`);
  return definition;
}

/** Log summaries read and interpolate authored copy so later views remain readable. */
function eventCopy(
  content: CompiledContent,
  key: string,
  tokens: Readonly<Record<string, EventTokenValue>>,
): string {
  return formatEventMessage(
    content.copy.messages[key] ?? key,
    tokens,
    content.copy.locale,
  );
}

function phaseMatches(state: Readonly<GameState>, definition: EventDefinition): boolean {
  return definition.phase === "any" || definition.phase === state.run.phase;
}

/**
 * The progressive chapters are a protected opening, not a second event
 * economy. Random offers and mandatory authored decisions stay dormant until
 * the player reaches the fully unlocked frontier; otherwise an unlucky event
 * can consume the cash or Aura required to finish onboarding.
 */
function authoredEventsUnlocked(state: Readonly<GameState>): boolean {
  return !isProgressiveOpeningProtected(state);
}

function hasUnresolvedDefinition(
  state: Readonly<GameState>,
  definitionId: ContentId,
): boolean {
  return Object.values(state.eventInstances).some(
    (instance) =>
      instance.definitionId === definitionId && instance.status === "unresolved",
  );
}

function commonEligibility(
  state: Readonly<GameState>,
  definition: EventDefinition,
  allowParallelDefinition = false,
  ignoreCooldown = false,
): boolean {
  if (!authoredEventsUnlocked(state)) return false;
  if (!phaseMatches(state, definition)) return false;
  if (!evaluatePredicate(state, definition.prerequisites)) return false;
  if (
    definition.exclusions !== undefined &&
    evaluatePredicate(state, definition.exclusions)
  ) {
    return false;
  }
  if (
    !ignoreCooldown &&
    (state.world.eventCooldowns[definition.cooldown.group] ?? 0) > state.run.tick
  ) {
    return false;
  }
  if (
    definition.unique &&
    Object.values(state.eventInstances).some(
      (instance) => instance.definitionId === definition.id,
    )
  ) {
    return false;
  }
  if (!allowParallelDefinition && hasUnresolvedDefinition(state, definition.id)) {
    return false;
  }
  return definition.options.some((option) =>
    evaluatePredicate(state, option.requirements),
  );
}

function recentOpportunityCategories(
  state: Readonly<GameState>,
  content: CompiledContent,
): ReadonlySet<EventDefinition["category"]> {
  const categories = Object.values(state.eventInstances)
    .filter((instance) => instance.source === "opportunity")
    .sort(
      (left, right) => right.createdAt - left.createdAt || (left.id < right.id ? -1 : 1),
    )
    .slice(0, 2)
    .flatMap((instance) => {
      const definition = content.events.definitions[instance.definitionId];
      return definition === undefined ? [] : [definition.category];
    });
  return new Set(categories);
}

/** GDD 43.3 pity curve. Returns a fraction in [0,1]. */
export function calculateOpportunityChance(state: Readonly<GameState>): number {
  const playerLab = state.labs[state.run.playerLabId];
  const frontierEnteredAt =
    isProgressiveCampaign(state) && labMaturityStage(state) === "frontier"
      ? playerLab?.flags[LAB_MATURITY_STAGE_ENTERED_AT_FLAG]
      : undefined;
  const cadenceStart = typeof frontierEnteredAt === "number" ? frontierEnteredAt : 0;
  const latest = Object.values(state.eventInstances)
    .filter((instance) => instance.source === "opportunity")
    .reduce<number | undefined>(
      (current, instance) =>
        current === undefined || instance.createdAt > current
          ? instance.createdAt
          : current,
      undefined,
    );
  const weeksSince = state.run.tick - Math.max(latest ?? cadenceStart, cadenceStart);
  if (weeksSince >= GUARANTEE_AFTER_WEEKS) return 1;
  if (weeksSince <= PITY_START_WEEKS) return BASE_OPPORTUNITY_CHANCE;
  return Math.min(
    PITY_MAX_CHANCE,
    BASE_OPPORTUNITY_CHANCE + (weeksSince - PITY_START_WEEKS) * PITY_WEEKLY_STEP,
  );
}

/** Eligible opportunity events in stable weighted-selection order. */
export function listEligibleEventDefinitions(
  state: Readonly<GameState>,
  content: CompiledContent,
): readonly WeightedEventCandidate[] {
  const recentCategories = recentOpportunityCategories(state, content);
  const candidates: WeightedEventCandidate[] = [];
  for (const definitionId of definitionIds(content)) {
    const definition = content.events.definitions[definitionId];
    if (
      definition === undefined ||
      definition.trigger.kind !== "opportunity" ||
      !commonEligibility(state, definition)
    ) {
      continue;
    }
    const stateMultiplier = definition.weightModifiers.reduce(
      (product, modifier) =>
        evaluatePredicate(state, modifier.predicate)
          ? product * modifier.multiplier
          : product,
      1,
    );
    const weight = definition.baseWeight * stateMultiplier;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (recentCategories.has(definition.category) && stateMultiplier < 3) continue;
    candidates.push({
      definitionId,
      category: definition.category,
      weight,
      stateMultiplier,
    });
  }
  return candidates.sort((left, right) =>
    left.definitionId < right.definitionId
      ? -1
      : left.definitionId > right.definitionId
        ? 1
        : 0,
  );
}

function baseTokens(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: EventDefinition,
): Readonly<Record<string, EventTokenValue>> {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Event token binding: player lab missing");
  const labDefinition = content.labs[lab.definitionId];
  const leaderDefinition = Object.values(content.leaders).find(
    (leader) => leader.labId === lab.definitionId,
  );
  const tokens: Record<string, EventTokenValue> = {};
  for (const binding of definition.tokenBindings) {
    switch (binding.source) {
      case "player-lab-name":
        tokens[binding.token] = labDefinition?.displayName ?? lab.definitionId;
        break;
      case "player-leader-name":
        tokens[binding.token] = leaderDefinition?.displayName ?? "Lab leadership";
        break;
      case "player-ai-name":
        tokens[binding.token] = leaderDefinition?.aiFamily ?? "the model";
        break;
      case "calendar-year":
        tokens[binding.token] = state.run.calendar.year;
        break;
      case "trigger-text":
      case "trigger-number":
        // Mandatory detectors inject these values at instantiation. Keeping
        // them in the binding list lets the compiler type-check copy without
        // fabricating a placeholder value here.
        break;
    }
  }
  return tokens;
}

function precommitOutcomes(
  definition: EventDefinition,
  instanceId: EventInstanceId,
  oracle: RandomOracle,
): readonly EventOutcomeCommitmentState[] {
  const commitments: EventOutcomeCommitmentState[] = [];
  for (const option of definition.options) {
    for (const check of option.checks) {
      const draw = oracle.uniform(
        randomKey(
          "event-option",
          instanceId,
          definition.id,
          String(definition.version),
          option.id,
          check.id,
        ),
      );
      const outcome = check.outcomes.find(
        (candidate) =>
          draw >= candidate.minimumInclusive && draw < candidate.maximumExclusive,
      );
      if (outcome === undefined) {
        throw new Error(
          `${definition.id}/${option.id}/${check.id} does not cover draw ${String(draw)}`,
        );
      }
      commitments.push({
        optionId: option.id,
        checkId: check.id,
        draw: fraction(draw),
        outcomeId: outcome.id,
      });
    }
  }
  return commitments;
}

export function instantiateEvent(
  tx: SimulationTransaction,
  content: CompiledContent,
  definitionId: ContentId,
  options: InstantiateOptions,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): EventInstanceId {
  const state = tx.read();
  const definition = requireDefinition(content, definitionId);
  if (
    !commonEligibility(
      state,
      definition,
      options.source === "mandatory",
      options.source === "mandatory",
    )
  ) {
    throw new Error(`Event ${definitionId} is not currently eligible`);
  }
  if (
    options.triggerKey !== undefined &&
    Object.values(state.eventInstances).some(
      (instance) =>
        instance.definitionId === definitionId &&
        instance.triggerKey === options.triggerKey,
    )
  ) {
    throw new Error(`Mandatory trigger ${options.triggerKey} was already instantiated`);
  }
  const instanceId = tx.allocateId("event", "world") as EventInstanceId;
  const enabledOptionIds = definition.options
    .filter((option) => evaluatePredicate(state, option.requirements))
    .map((option) => option.id);
  if (enabledOptionIds.length === 0) {
    throw new Error(`Event ${definitionId} has no enabled option`);
  }
  const semanticRoot = [
    "event-root-v1",
    instanceId,
    definition.id,
    String(definition.version),
  ].join("/");
  const instance: EventInstanceState = {
    id: instanceId,
    definitionId,
    definitionVersion: definition.version,
    createdAt: state.run.tick,
    ...(definition.severity === "critical" || definition.expiryWeeks === undefined
      ? {}
      : { expiresAt: tick(state.run.tick + definition.expiryWeeks) }),
    status: "unresolved",
    source: options.source,
    ...(options.triggerKey === undefined ? {} : { triggerKey: options.triggerKey }),
    priority: SEVERITY_PRIORITY[definition.severity] + (options.priorityBonus ?? 0),
    tokens: {
      ...baseTokens(state, content, definition),
      ...(options.tokens ?? {}),
    },
    evidenceSnapshot: definition.evidence.map((line) => ({
      textKey: line.textKey,
      ...(line.metric === undefined
        ? {}
        : { metric: line.metric, value: readMetric(state, line.metric) }),
    })),
    enabledOptionIds,
    randomRoot: {
      version: 1,
      semanticRoot,
      outcomes: precommitOutcomes(definition, instanceId, oracle),
    },
  };
  tx.update((draft) => {
    draft.eventInstances[instanceId] = structuredClone(
      instance,
    ) as DeepMutable<EventInstanceState>;
    draft.world.eventCooldowns[definition.cooldown.group] = tick(
      draft.run.tick + definition.cooldown.weeks,
    );
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Event opened: ${eventCopy(content, definition.titleKey, instance.tokens)}.`,
      category: "event-opened",
      source: { kind: "event", id: instanceId },
      relatedIds: [instanceId, definition.id],
    });
  });
  tx.emit({
    kind: "decision-event-instantiated",
    instanceId,
    definitionId,
    severity: definition.severity,
    source: options.source,
  });
  if (definition.severity === "critical") tx.requestAutoPause("critical-event");
  else if (definition.severity === "urgent") tx.requestAutoPause("urgent-event");
  return instanceId;
}

function triggerHandled(
  state: Readonly<GameState>,
  definitionId: ContentId,
  triggerKey: string,
): boolean {
  return Object.values(state.eventInstances).some(
    (instance) =>
      instance.definitionId === definitionId && instance.triggerKey === triggerKey,
  );
}

function activeFormalPlayerCandidate(state: Readonly<GameState>) {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return undefined;
  }
  const model = state.models[state.endgame.candidateModelId];
  return model?.ownerLabId === state.run.playerLabId &&
    model.candidateArtifact?.lifecycle === "formal-candidate"
    ? model
    : undefined;
}

function formalCandidateDeclarationOccurrence(state: Readonly<GameState>) {
  const activeModel = activeFormalPlayerCandidate(state);
  if (
    activeModel === undefined ||
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return undefined;
  }
  const entryCandidate = state.endgame.startSnapshot.candidate;
  return {
    activeModelId: activeModel.id,
    triggerKey: `agi-candidate:${entryCandidate.modelId}:entry:${String(state.endgame.crisisStartedAt)}`,
    tokens: {
      MODEL_NAME: entryCandidate.displayName,
      MODEL_ID: entryCandidate.modelId,
    },
  } as const;
}

function mandatoryOccurrences(
  state: Readonly<GameState>,
  content: CompiledContent,
  definition: EventDefinition,
): readonly Omit<TriggerCandidate, "definitionId" | "priority">[] {
  if (definition.trigger.kind !== "mandatory") return [];
  switch (definition.trigger.detector) {
    case "critical-runway": {
      const runway = forecastFinance(state, content, state.run.playerLabId).runway;
      return runway.band === "critical"
        ? [{ triggerKey: "critical-runway", tokens: {} }]
        : [];
    }
    case "researcher-ultimatum":
      return Object.values(state.researchers)
        .filter((researcher) => researcher.ultimatum?.status === "pending")
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .map((researcher) => ({
          triggerKey: `researcher-ultimatum:${researcher.ultimatum?.id ?? researcher.id}`,
          tokens: {
            RESEARCHER:
              content.researchers.definitions[researcher.definitionId]?.displayName ??
              researcher.id,
            RESEARCHER_ID: researcher.id,
            ULTIMATUM_ID: researcher.ultimatum?.id ?? researcher.id,
          },
        }));
    case "agi-candidate": {
      const occurrence = formalCandidateDeclarationOccurrence(state);
      return occurrence === undefined
        ? []
        : [
            {
              triggerKey: occurrence.triggerKey,
              tokens: occurrence.tokens,
            },
          ];
    }
    case "rival-candidate":
      return Object.values(state.world.rivals)
        .filter((strategy) => strategy.candidateCountdown?.status === "active")
        .sort((left, right) => (left.labId < right.labId ? -1 : 1))
        .flatMap((strategy) => {
          const countdown = strategy.candidateCountdown;
          const lab = state.labs[strategy.labId];
          const model =
            countdown === undefined ? undefined : state.models[countdown.modelId];
          if (countdown === undefined || lab === undefined || model === undefined) {
            return [];
          }
          const labDefinition = content.labs[lab.definitionId];
          return [
            {
              // This is a strategic warning about the rival laboratory, not a
              // notification for every successor model it nominates. Keeping
              // the model out of the occurrence identity limits it to once per
              // rival while preserving the current candidate in the tokens.
              triggerKey: `rival-candidate:${strategy.labId}`,
              tokens: {
                RIVAL_LAB: labDefinition?.displayName ?? strategy.labId,
                RIVAL_LAB_ID: strategy.labId,
                AI_NAME: labDefinition?.aiFamily ?? model.familyName,
                MODEL_NAME: model.displayName,
                MODEL_ID: model.id,
              },
            },
          ];
        });
    case "three-severe-anomalies":
      return Object.values(state.models)
        .filter((model) => model.flags["mandatory-event:three-severe-anomalies"] === true)
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .map((model) => ({
          triggerKey: `three-severe-anomalies:${model.id}`,
          tokens: { MODEL_NAME: model.displayName, MODEL_ID: model.id },
        }));
    case "government-reporting":
    case "government-licensing":
    case "government-restriction":
    case "government-nationalisation": {
      const expectedKind =
        definition.trigger.detector === "government-reporting"
          ? "reporting-request"
          : definition.trigger.detector === "government-licensing"
            ? "licensing-action"
            : definition.trigger.detector === "government-restriction"
              ? "deployment-restriction"
              : "nationalisation-crisis";
      const politics = state.labs[state.run.playerLabId]?.politics;
      return (politics?.interventions ?? [])
        .filter(
          (intervention) =>
            intervention.status === "pending-event" && intervention.kind === expectedKind,
        )
        .sort((left, right) =>
          left.createdAt !== right.createdAt
            ? left.createdAt - right.createdAt
            : left.id < right.id
              ? -1
              : 1,
        )
        .map((intervention) => ({
          triggerKey: `government-intervention:${intervention.id}`,
          tokens: {
            INTERVENTION_ID: intervention.id,
            INTERVENTION_PRESSURE: intervention.pressureAtTrigger,
            INTERVENTION_TRIGGER: intervention.trigger,
          },
        }));
    }
    case "autonomy-experiments":
    case "autonomy-intrusion":
    case "autonomy-exfiltration":
    case "autonomy-infrastructure": {
      const expectedStage =
        definition.trigger.detector === "autonomy-experiments"
          ? "experiments"
          : definition.trigger.detector === "autonomy-intrusion"
            ? "intrusion"
            : definition.trigger.detector === "autonomy-exfiltration"
              ? "exfiltration"
              : "infrastructure";
      const autonomy = state.labs[state.run.playerLabId]?.autonomy;
      return (autonomy?.escalations ?? [])
        .filter(
          (escalation) =>
            escalation.status === "pending-event" && escalation.stage === expectedStage,
        )
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .map((escalation) => ({
          triggerKey: `autonomy-escalation:${escalation.id}`,
          tokens: {
            ESCALATION_ID: escalation.id,
            MODEL_NAME: state.models[escalation.modelId]?.displayName ?? "the model",
            MODEL_ID: escalation.modelId,
          },
        }));
    }
    case "autonomy-egress-postmortem": {
      const autonomy = state.labs[state.run.playerLabId]?.autonomy;
      const lab = state.labs[state.run.playerLabId];
      if (
        autonomy?.escapedWeightsAt === undefined ||
        autonomy.escapeRevealedAt !== undefined ||
        // The reveal waits: escaped weights surface via outside investigators.
        state.run.tick - autonomy.escapedWeightsAt < 6
      ) {
        return [];
      }
      const modelId = lab?.models.currentModelId;
      return [
        {
          triggerKey: `autonomy-egress-postmortem:${String(autonomy.escapedWeightsAt)}`,
          tokens: {
            MODEL_NAME:
              (modelId === undefined ? undefined : state.models[modelId]?.displayName) ??
              "your model",
          },
        },
      ];
    }
  }
}

/** Explicit mandatory detectors; no event receives a fake giant weight. */
export function collectMandatoryTriggers(
  state: Readonly<GameState>,
  content: CompiledContent,
): readonly TriggerCandidate[] {
  const candidates: TriggerCandidate[] = [];
  for (const definitionId of definitionIds(content)) {
    const definition = content.events.definitions[definitionId];
    if (
      definition === undefined ||
      definition.trigger.kind !== "mandatory" ||
      !commonEligibility(state, definition, true)
    ) {
      continue;
    }
    for (const occurrence of mandatoryOccurrences(state, content, definition)) {
      if (triggerHandled(state, definitionId, occurrence.triggerKey)) continue;
      candidates.push({
        definitionId,
        priority: definition.trigger.priority,
        ...occurrence,
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      right.priority - left.priority ||
      (left.definitionId < right.definitionId
        ? -1
        : left.definitionId > right.definitionId
          ? 1
          : left.triggerKey < right.triggerKey
            ? -1
            : 1),
  );
}

/**
 * Open the declaration decision in the same transaction that formally
 * nominates its exact weight artifact. The mandatory detector uses the same
 * identity and provides an idempotent fallback for any state missing the event.
 */
export function instantiateCandidateDeclarationEvent(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
): EventInstanceId | undefined {
  const occurrence = formalCandidateDeclarationOccurrence(tx.read());
  if (occurrence === undefined || occurrence.activeModelId !== modelId) {
    throw new Error(`${modelId} is not the active formal player candidate`);
  }
  const definition = requireDefinition(content, CANDIDATE_DECLARATION_EVENT_ID);
  if (
    definition.trigger.kind !== "mandatory" ||
    definition.trigger.detector !== "agi-candidate"
  ) {
    throw new Error("Candidate declaration event has the wrong mandatory detector");
  }
  if (triggerHandled(tx.read(), definition.id, occurrence.triggerKey)) return undefined;
  return instantiateEvent(tx, content, definition.id, {
    source: "mandatory",
    triggerKey: occurrence.triggerKey,
    priorityBonus: definition.trigger.priority,
    tokens: occurrence.tokens,
  });
}

function affordabilityBlockers(
  state: Readonly<GameState>,
  effects: readonly EventEffectDefinition[],
): readonly string[] {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return ["Player lab is missing"];
  const cashCost = effects.reduce(
    (sum, effect) =>
      effect.kind === "add-resource" && effect.resource === "cash" && effect.amount < 0
        ? sum - effect.amount
        : sum,
    0,
  );
  const auraCost = effects.reduce(
    (sum, effect) =>
      effect.kind === "add-resource" &&
      effect.resource === "aura-spendable" &&
      effect.amount < 0 &&
      effect.auraChangeKind !== "loss"
        ? sum - effect.amount
        : sum,
    0,
  );
  return [
    ...(lab.finance.cash < cashCost ? ["Insufficient cash"] : []),
    ...(lab.aura.spendable < auraCost ? ["Insufficient Aura"] : []),
  ];
}

export function previewEventOption(
  state: Readonly<GameState>,
  content: CompiledContent,
  instanceId: EventInstanceId,
  optionId: string,
): EventOptionPreview {
  const instance = state.eventInstances[instanceId];
  if (instance === undefined) throw new Error(`Unknown event instance ${instanceId}`);
  const definition = requireDefinition(content, instance.definitionId);
  const option = definition.options.find((candidate) => candidate.id === optionId);
  if (option === undefined) throw new Error(`Unknown option ${optionId}`);
  const blockers: string[] = [];
  if (instance.status !== "unresolved") blockers.push("Event is already resolved");
  if (instance.expiresAt !== undefined && state.run.tick >= instance.expiresAt) {
    blockers.push("Event has expired");
  }
  if (!instance.enabledOptionIds.includes(optionId)) {
    blockers.push(option.disabledReasonKey ?? "Option was unavailable when opened");
  }
  if (!evaluatePredicate(state, option.requirements)) {
    blockers.push(option.disabledReasonKey ?? "Option requirements are no longer met");
  }
  blockers.push(...researcherUltimatumEventBlockers(state, instance));
  blockers.push(...affordabilityBlockers(state, option.knownCosts));
  return {
    instanceId,
    optionId,
    labelKey: option.labelKey,
    previewKey: option.previewKey,
    enabled: blockers.length === 0,
    blockers,
    knownCosts: option.knownCosts.map((effect) => structuredClone(effect)),
    immediateEffects: option.immediateEffects.map((effect) => structuredClone(effect)),
    uncertainty: option.checks.length === 0 ? "none" : "precommitted-checks",
    checkCount: option.checks.length,
    likelihoodPromises: option.checks.flatMap((check) =>
      check.likelihoodPromise === undefined
        ? []
        : [{ checkId: check.id, label: check.likelihoodPromise.label }],
    ),
    confirmationRequired: option.confirmationRequired,
  };
}

function memorySubjects(
  state: Readonly<GameState>,
  instance: EventInstanceState,
  definition: EventMemoryDefinition,
): readonly DecisionMemorySubject[] {
  return definition.subjects.map((subject) => {
    if (subject.type === "player-lab") {
      return { type: "lab", labId: state.run.playerLabId };
    }
    const value = instance.tokens[subject.token];
    if (value === undefined) {
      throw new Error(
        `Memory ${definition.key} references missing token ${subject.token}`,
      );
    }
    return { type: "entity", id: String(value) };
  });
}

function addDecisionMemories(
  tx: SimulationTransaction,
  instance: EventInstanceState,
  definitions: readonly EventMemoryDefinition[],
): void {
  if (definitions.length === 0) return;
  const memories: DecisionMemory[] = definitions.map((definition) => ({
    key: definition.key,
    sourceEventInstanceId: instance.id,
    subjects: memorySubjects(tx.read(), instance, definition),
    // Event-authored memories are neutral by construction; only the runtime
    // candidate-access path scores a memory, and only that score is read.
    valence: 0,
    tags: [...definition.tags],
    createdAt: tx.read().run.tick,
    ...(definition.expiresInWeeks === undefined
      ? {}
      : { expiresAt: tick(tx.read().run.tick + definition.expiresInWeeks) }),
  }));
  tx.update((draft) => {
    for (const memory of memories) {
      const duplicate = draft.decisionMemories.some(
        (candidate) =>
          candidate.sourceEventInstanceId === memory.sourceEventInstanceId &&
          candidate.key === memory.key,
      );
      if (!duplicate) {
        draft.decisionMemories.push(
          structuredClone(memory) as DeepMutable<DecisionMemory>,
        );
      }
    }
  });
}

function eventEffects(effects: readonly EventEffectDefinition[]): readonly Effect[] {
  return effects;
}

function applyCandidateDeclarationPosture(
  tx: SimulationTransaction,
  instance: Readonly<EventInstanceState>,
  optionId: string,
): void {
  if (instance.definitionId !== CANDIDATE_DECLARATION_EVENT_ID) return;
  const modelId = instance.tokens["MODEL_ID"];
  const state = tx.read();
  if (
    typeof modelId !== "string" ||
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation" ||
    state.endgame.candidateModelId !== modelId
  ) {
    throw new Error("The declared candidate artifact is no longer active");
  }
  const candidateModelId = modelId as ModelId;
  if (optionId === CANDIDATE_DECLARATION_OPTION_IDS.quietReview) {
    tx.update((draft) => {
      const model = draft.models[candidateModelId];
      if (model === undefined) throw new Error("Candidate disappeared during review");
      model.flags[CANDIDATE_PROOF_OPENING_DURATION_FLAG] = 2;
    });
    return;
  }
  if (optionId !== CANDIDATE_DECLARATION_OPTION_IDS.rapidPush) return;
  tx.update((draft) => {
    const model = draft.models[candidateModelId];
    if (model === undefined)
      throw new Error("Candidate disappeared during rapid opening");
    model.flags[CANDIDATE_PROOF_OPENING_DURATION_FLAG] = -2;
  });
  const currentAccess = tx.read().models[candidateModelId]?.accessLevel ?? 0;
  if (currentAccess < 3) {
    setCandidateAccess(
      tx,
      candidateModelId,
      3,
      `event:${instance.id}:rapid-opening` as CommandId,
    );
  }
}

function applyResearcherUltimatumSettlement(
  tx: SimulationTransaction,
  instance: Readonly<EventInstanceState>,
  optionId: string,
  commitments: readonly EventOutcomeCommitmentState[],
): void {
  if (instance.definitionId !== RESEARCHER_ULTIMATUM_EVENT_ID) return;
  const accepted =
    optionId === "meet-terms" ||
    (optionId === "compromise" &&
      commitments.some((commitment) => commitment.outcomeId === "accepted"));
  if (!accepted) return;
  const researcherId = instance.tokens["RESEARCHER_ID"];
  if (typeof researcherId !== "string") {
    throw new Error("Researcher ultimatum event is missing its researcher id");
  }
  acceptUltimatumSettlement(tx, researcherId as ResearcherId);
}

export function resolveEventOption(
  tx: SimulationTransaction,
  content: CompiledContent,
  instanceId: EventInstanceId,
  optionId: string,
  kind: "player" | "default" = "player",
): EventResolution {
  const state = tx.read();
  const instance = state.eventInstances[instanceId];
  if (instance === undefined) throw new Error(`Unknown event instance ${instanceId}`);
  const definition = requireDefinition(content, instance.definitionId);
  const option = definition.options.find((candidate) => candidate.id === optionId);
  if (option === undefined) throw new Error(`Unknown option ${optionId}`);
  const preview = previewEventOption(state, content, instanceId, optionId);
  const blockers =
    kind === "default"
      ? preview.blockers.filter((blocker) => blocker !== "Event has expired")
      : preview.blockers;
  if (blockers.length > 0) throw new Error(blockers.join("; "));
  const commitments = instance.randomRoot.outcomes.filter(
    (commitment) => commitment.optionId === optionId,
  );
  applyEffects(tx, eventEffects([...option.knownCosts, ...option.immediateEffects]), {
    kind: "event",
    id: instanceId,
  });
  addDecisionMemories(tx, instance, option.memories);
  applyCandidateDeclarationPosture(tx, instance, optionId);
  for (const commitment of commitments) {
    const check = option.checks.find((candidate) => candidate.id === commitment.checkId);
    const outcome = check?.outcomes.find(
      (candidate) => candidate.id === commitment.outcomeId,
    );
    if (outcome === undefined) {
      throw new Error(
        `Committed event outcome ${commitment.checkId}/${commitment.outcomeId} is missing`,
      );
    }
    applyEffects(tx, eventEffects(outcome.effects), { kind: "event", id: instanceId });
    addDecisionMemories(tx, instance, outcome.memories);
  }
  applyResearcherUltimatumSettlement(tx, instance, optionId, commitments);
  tx.update((draft) => {
    const mutable = draft.eventInstances[instanceId];
    if (mutable === undefined) throw new Error(`Event ${instanceId} disappeared`);
    mutable.status = kind === "default" ? "expired" : "resolved";
    mutable.resolution = {
      optionId,
      resolvedAt: draft.run.tick,
      kind,
      outcomes: structuredClone(commitments),
    };
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${kind === "default" ? "Event expired to" : "Event decision"}: ${eventCopy(content, definition.titleKey, instance.tokens)} / ${eventCopy(content, option.labelKey, instance.tokens)}.`,
      category: "event-resolved",
      source: { kind: "event", id: instanceId },
      relatedIds: [instanceId, definition.id, option.id],
    });
  });
  tx.emit({
    kind: "decision-event-resolved",
    instanceId,
    definitionId: definition.id,
    optionId,
    resolutionKind: kind,
  });
  return {
    instanceId,
    optionId,
    kind,
    outcomeIds: commitments.map((commitment) => commitment.outcomeId),
  };
}

function invalidateEvent(
  tx: SimulationTransaction,
  instanceId: EventInstanceId,
  reason: string,
): void {
  tx.update((draft) => {
    const instance = draft.eventInstances[instanceId];
    if (instance === undefined) return;
    instance.status = "invalidated";
    instance.invalidationReason = reason;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Event invalidated: ${instance.definitionId} (${reason}).`,
      category: "event-invalidated",
      source: { kind: "event", id: instanceId },
      relatedIds: [instanceId, instance.definitionId],
    });
  });
  tx.emit({ kind: "decision-event-invalidated", instanceId, reason });
}

export function expireDueEvents(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  const due = Object.values(tx.read().eventInstances)
    .filter(
      (instance) =>
        instance.status === "unresolved" &&
        instance.expiresAt !== undefined &&
        instance.expiresAt <= tx.read().run.tick,
    )
    .sort(
      (left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1),
    );
  for (const instance of due) {
    const definition = content.events.definitions[instance.definitionId];
    if (definition?.defaultOptionId === undefined) {
      invalidateEvent(tx, instance.id, "expired without a declared default option");
      continue;
    }
    const preview = previewEventOption(
      tx.read(),
      content,
      instance.id,
      definition.defaultOptionId,
    );
    // Expiry itself is expected, so remove only that blocker before deciding
    // whether the authored default can still resolve lawfully.
    const hardBlockers = preview.blockers.filter(
      (blocker) => blocker !== "Event has expired",
    );
    if (hardBlockers.length > 0) {
      invalidateEvent(tx, instance.id, hardBlockers.join("; "));
      continue;
    }
    resolveEventOption(tx, content, instance.id, definition.defaultOptionId, "default");
  }
}

/** Weekly event-generation phase: expire, enqueue mandatory, then at most one ordinary event. */
export function advanceEventGeneration(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  expireDueEvents(tx, content);
  for (const candidate of collectMandatoryTriggers(tx.read(), content)) {
    instantiateEvent(
      tx,
      content,
      candidate.definitionId,
      {
        source: "mandatory",
        triggerKey: candidate.triggerKey,
        priorityBonus: candidate.priority,
        tokens: candidate.tokens,
      },
      oracle,
    );
  }
  const unresolvedOpportunity = Object.values(tx.read().eventInstances).some(
    (instance) => instance.source === "opportunity" && instance.status === "unresolved",
  );
  if (unresolvedOpportunity) return;
  const candidates = listEligibleEventDefinitions(tx.read(), content);
  if (candidates.length === 0) return;
  const chance = calculateOpportunityChance(tx.read());
  const opportunityDraw = oracle.uniform(
    randomKey("event-opportunity", String(tx.read().run.tick), "occurs"),
  );
  if (opportunityDraw >= chance) return;
  const selected = oracle.weighted(
    randomKey("event-opportunity", String(tx.read().run.tick), "selection"),
    Object.fromEntries(
      candidates.map((candidate) => [candidate.definitionId, candidate.weight]),
    ),
  ) as ContentId;
  instantiateEvent(tx, content, selected, { source: "opportunity" }, oracle);
}
