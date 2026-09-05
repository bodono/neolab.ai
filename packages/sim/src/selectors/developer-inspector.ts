import type {
  CompiledContent,
  EvaluationTarget,
  EventDefinition,
} from "@neolab/content-schema";

import { evaluateCoalitionEligibility } from "../coalition/coalition.ts";
import {
  calculateDerivedEndgameScores,
  deriveEndgameScoreInputs,
} from "../endgame/resolution.ts";
import { deriveEndingResolutionInputs } from "../endgame/endings.ts";
import { detectEndgameTrigger } from "../endgame/endgame-machine.ts";
import { collectInvariantViolations } from "../engine/invariants.ts";
import {
  evaluateModifierActivation,
  resolveModifierValue,
} from "../engine/modifier-resolver.ts";
import { evaluatePredicate } from "../engine/predicates.ts";
import {
  calculateOpportunityChance,
  listEligibleEventDefinitions,
} from "../events/event-engine.ts";
import { validateGameState } from "../model/schema.ts";
import type { LabId } from "../model/ids.ts";
import type {
  EvaluationObservationState,
  GameState,
  ModelState,
  ModifierState,
} from "../model/state.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import { derivePaperBreakthroughChance, listEligiblePapers } from "../research/papers.ts";

/** Release audit sentinel: this exact value must never appear in production bytes. */
export const DEVELOPER_INSPECTOR_BUNDLE_SENTINEL = "NEOLAB_PRIVILEGED_INSPECTOR_V1";

export interface DeveloperRandomLookup {
  readonly contractVersion: number;
  readonly key: string;
  readonly uniform: number;
  readonly integerZeroTo999999: number;
  readonly triangularZeroModeHalfOne: number;
}

export interface DeveloperScenarioFixtureV1 {
  readonly format: "neolab-developer-scenario-v1";
  readonly contentHash: string;
  readonly contentVersion: string;
  readonly engineRulesVersion: string;
  readonly runId: string;
  readonly tick: number;
  readonly expected: {
    readonly runStatus: GameState["run"]["status"];
    readonly endgameStage: GameState["endgame"]["stage"];
    readonly invariantViolationCodes: readonly string[];
  };
  readonly canonicalState: GameState;
}

interface CapturedDiagnostic<T> {
  readonly status: "available" | "unavailable";
  readonly value?: T;
  readonly reason?: string;
}

function capture<T>(read: () => T): CapturedDiagnostic<T> {
  try {
    return { status: "available", value: read() };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function playerLab(state: Readonly<GameState>) {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Developer inspector: player lab missing");
  return lab;
}

function modelTruth(model: Readonly<ModelState>, target: EvaluationTarget): number {
  switch (target) {
    case "language":
    case "reasoning":
    case "agency":
    case "toolUse":
    case "multimodality":
    case "scientificAbility":
    case "embodiment":
      return model.trueCapability[target];
    case "true-alignment":
      return model.hiddenSafety.trueAlignment;
    case "corrigibility":
      return model.hiddenSafety.corrigibility;
    case "situational-awareness":
      return model.hiddenSafety.situationalAwareness;
    case "deceptive-capability":
      // The legacy evaluation-target ID is retained in saved/content data, but
      // safety evaluations now observe intent rather than raw strategic ability.
      return model.hiddenSafety.deceptiveIntent;
  }
}

function evaluationObservation(
  model: Readonly<ModelState>,
  observation: Readonly<EvaluationObservationState>,
) {
  const truth = modelTruth(model, observation.target);
  return {
    target: observation.target,
    truth,
    estimate: observation.estimate,
    signedError: observation.estimate - truth,
    absoluteError: Math.abs(observation.estimate - truth),
    confidence: observation.confidence,
    errorRadius: observation.errorRadius,
    informationWeight: observation.informationWeight,
    ...(observation.alignmentLabel === undefined
      ? {}
      : { alignmentLabel: observation.alignmentLabel }),
  };
}

function modifierIsActive(
  state: Readonly<GameState>,
  modifier: Readonly<ModifierState>,
): boolean {
  return (
    modifier.startsAt <= state.run.tick &&
    (modifier.endsAt === undefined || state.run.tick < modifier.endsAt) &&
    (modifier.activation === undefined ||
      evaluateModifierActivation(state, modifier.activation))
  );
}

function eventBlockers(
  state: Readonly<GameState>,
  definition: Readonly<EventDefinition>,
): string[] {
  const blockers: string[] = [];
  if (definition.phase !== "any" && definition.phase !== state.run.phase) {
    blockers.push(`phase ${state.run.phase}; requires ${definition.phase}`);
  }
  if (!evaluatePredicate(state, definition.prerequisites)) {
    blockers.push("prerequisites false");
  }
  if (
    definition.exclusions !== undefined &&
    evaluatePredicate(state, definition.exclusions)
  ) {
    blockers.push("exclusion true");
  }
  const cooldownUntil =
    state.world.eventCooldowns[definition.cooldown.group] ?? state.run.tick;
  if (cooldownUntil > state.run.tick) {
    blockers.push(`cooldown until tick ${String(cooldownUntil)}`);
  }
  const matchingInstances = Object.values(state.eventInstances).filter(
    (instance) => instance.definitionId === definition.id,
  );
  if (definition.unique && matchingInstances.length > 0) {
    blockers.push("unique event already instantiated");
  }
  if (matchingInstances.some((instance) => instance.status === "unresolved")) {
    blockers.push("matching event already unresolved");
  }
  if (
    !definition.options.some((option) => evaluatePredicate(state, option.requirements))
  ) {
    blockers.push("no option currently legal");
  }
  return blockers;
}

function eventStateMultiplier(
  state: Readonly<GameState>,
  definition: Readonly<EventDefinition>,
): number {
  return definition.weightModifiers.reduce(
    (product, modifier) =>
      evaluatePredicate(state, modifier.predicate)
        ? product * modifier.multiplier
        : product,
    1,
  );
}

/**
 * Privileged, development-only projection. Its output intentionally includes
 * hidden truth and must never cross a player-facing selector boundary.
 */
export function projectDeveloperInspector(input: unknown, content: CompiledContent) {
  const state = validateGameState(input);
  const lab = playerLab(state);
  const opportunityCandidates = new Map(
    listEligibleEventDefinitions(state, content).map((candidate) => [
      candidate.definitionId,
      candidate,
    ]),
  );

  const modifierTargets = [
    ...new Set(Object.values(state.modifiers).map((modifier) => modifier.target)),
  ].sort();
  const labIds = Object.keys(state.labs).sort() as LabId[];

  return {
    sentinel: DEVELOPER_INSPECTOR_BUNDLE_SENTINEL,
    run: {
      runId: state.run.runId,
      seed: state.run.seed,
      tick: state.run.tick,
      calendar: state.run.calendar,
      campaignPhase: state.run.phase,
      status: state.run.status,
      endingId: state.run.endingId,
      engineRulesVersion: state.engineRulesVersion,
      contentVersion: state.contentVersion,
      randomContractVersion: state.randomContractVersion,
      queuedOrders: state.run.queuedOrders,
      autoPauseReasons: state.run.autoPauseReasons,
    },
    invariants: collectInvariantViolations(state),
    finance: labIds.map((labId) => {
      const inspectedLab = state.labs[labId];
      if (inspectedLab === undefined) throw new Error(`Missing lab ${labId}`);
      return {
        labId,
        labDefinitionId: inspectedLab.definitionId,
        control: inspectedLab.control,
        cashMillions: inspectedLab.finance.cash,
        ledger: inspectedLab.finance.ledger,
        settlements: inspectedLab.finance.settlements,
      };
    }),
    modifiers: modifierTargets.map((target) => ({
      target,
      fromZeroBase: resolveModifierValue(state, target, 0),
      fromOneBase: resolveModifierValue(state, target, 1),
      records: Object.values(state.modifiers)
        .filter((modifier) => modifier.target === target)
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map((modifier) => ({
          ...modifier,
          activeNow: modifierIsActive(state, modifier),
        })),
    })),
    papers: labIds.map((labId) => {
      const inspectedLab = state.labs[labId];
      if (inspectedLab === undefined) throw new Error(`Missing lab ${labId}`);
      const eligible = new Set(
        listEligiblePapers(state, content, labId).map((paper) => paper.paperId),
      );
      return {
        labId,
        papers: Object.values(content.papers.definitions)
          .sort(
            (left, right) =>
              left.gameOrder - right.gameOrder ||
              (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
          )
          .map((paper) => {
            const requirement = paper.breakthroughRequirement;
            const programme =
              inspectedLab.research.domains[requirement.programmeId] ??
              inspectedLab.research.safetyPrograms[requirement.programmeId];
            const currentLevel = programme?.level ?? 0;
            return {
              paperId: paper.id,
              title: paper.title,
              gameOrder: paper.gameOrder,
              breakthroughProgrammeId: requirement.programmeId,
              requiredLevel: requirement.level,
              currentLevel,
              weeklyChance: derivePaperBreakthroughChance(
                state,
                content,
                labId,
                paper.id,
              ),
              eligible: eligible.has(paper.id),
              discovered: inspectedLab.research.discoveredPaperIds.includes(paper.id),
              worldDiscovery: state.world.paperRace.discoveries[paper.id],
            };
          }),
      };
    }),
    models: Object.values(state.models)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((model) => {
        const owner = state.labs[model.ownerLabId];
        return {
          modelId: model.id,
          ownerLabId: model.ownerLabId,
          displayName: model.displayName,
          isCurrentModel: owner?.models.currentModelId === model.id,
          isCommercialModel: owner?.models.commercialModelId === model.id,
          trueCapability: model.trueCapability,
          measuredCapability: model.measuredCapability,
          hiddenSafety: model.hiddenSafety,
          accessLevel: model.accessLevel,
          evaluations: model.evaluations.map((evaluationId) => {
            const evaluation = state.evaluations[evaluationId];
            return evaluation === undefined
              ? { evaluationId, missing: true as const }
              : {
                  evaluationId,
                  definitionId: evaluation.definitionId,
                  method: evaluation.method,
                  observations: evaluation.observations.map((observation) =>
                    evaluationObservation(model, observation),
                  ),
                };
          }),
          anomalies: model.anomalies.map((anomalyId) => {
            const anomaly = state.anomalies[anomalyId];
            return anomaly === undefined
              ? { anomalyId, missing: true as const }
              : {
                  anomalyId,
                  trueSeverity: anomaly.trueSeverity,
                  observedSeverity: anomaly.observedSeverity,
                  signedError: anomaly.observedSeverity - anomaly.trueSeverity,
                  status: anomaly.status,
                };
          }),
        };
      }),
    events: {
      opportunityChance: calculateOpportunityChance(state),
      unresolvedInstances: Object.values(state.eventInstances).filter(
        (instance) => instance.status === "unresolved",
      ),
      definitions: Object.values(content.events.definitions)
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map((definition) => {
          const candidate = opportunityCandidates.get(definition.id);
          const multiplier = eventStateMultiplier(state, definition);
          const blockers = eventBlockers(state, definition);
          if (
            definition.trigger.kind === "opportunity" &&
            candidate === undefined &&
            blockers.length === 0
          ) {
            blockers.push("suppressed by category repetition or non-positive weight");
          }
          return {
            eventId: definition.id,
            trigger: definition.trigger,
            category: definition.category,
            severity: definition.severity,
            blockers,
            eligibleForOpportunity: candidate !== undefined,
            baseWeight: definition.baseWeight,
            stateMultiplier: multiplier,
            effectiveWeight: candidate?.weight ?? definition.baseWeight * multiplier,
          };
        }),
    },
    rivals: Object.values(state.world.rivals)
      .sort((left, right) =>
        left.labId < right.labId ? -1 : left.labId > right.labId ? 1 : 0,
      )
      .map((rival) => ({
        labId: rival.labId,
        currentPlanId: rival.currentPlanId,
        planStartedAt: rival.planStartedAt,
        planEndsAt: rival.planEndsAt,
        personality: rival.personality,
        latestPlanDecision: rival.quarterlyDecisions.at(-1),
        candidateCountdown: rival.candidateCountdown,
        relationship: rival.relationship,
        incidents: rival.incidents,
      })),
    coalitions: Object.values(state.world.coalitions)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((coalition) => ({
        coalition,
        eligibility: capture(() => evaluateCoalitionEligibility(state, coalition.id)),
      })),
    endgame: {
      stage: state.endgame.stage,
      trigger: detectEndgameTrigger(state),
      state: state.endgame,
      scoreInputs:
        state.endgame.stage === "inactive"
          ? { status: "unavailable" as const, reason: "Deployment Crisis inactive" }
          : capture(() => deriveEndgameScoreInputs(state, content)),
      derivedScores:
        state.endgame.stage === "inactive"
          ? { status: "unavailable" as const, reason: "Deployment Crisis inactive" }
          : capture(() =>
              calculateDerivedEndgameScores(deriveEndgameScoreInputs(state, content)),
            ),
      endingInputs:
        state.endgame.stage === "rollout"
          ? capture(() => deriveEndingResolutionInputs(state, content))
          : {
              status: "unavailable" as const,
              reason: "Rollout gate inputs are available during rollout",
            },
    },
    playerHiddenInstitution: {
      organisation: lab.organisation,
      safety: lab.safety,
      politics: lab.politics,
      flags: lab.flags,
    },
  };
}

export type DeveloperInspectorView = ReturnType<typeof projectDeveloperInspector>;

export function lookupDeveloperRandom(
  input: unknown,
  segments: readonly string[],
): DeveloperRandomLookup {
  const state = validateGameState(input);
  const key = randomKey(...segments);
  const oracle = new RandomOracleV1(state.run.seed);
  return {
    contractVersion: state.randomContractVersion,
    key: describeRandomKey(key),
    uniform: oracle.uniform(key),
    integerZeroTo999999: oracle.integer(key, 0, 999_999),
    triangularZeroModeHalfOne: oracle.triangular(key, 0, 0.5, 1),
  };
}

export function exportDeveloperScenarioFixture(
  input: unknown,
  content: CompiledContent,
): DeveloperScenarioFixtureV1 {
  const state = validateGameState(input);
  const violations = collectInvariantViolations(state);
  return {
    format: "neolab-developer-scenario-v1",
    contentHash: content.manifest.bundleHash,
    contentVersion: state.contentVersion,
    engineRulesVersion: state.engineRulesVersion,
    runId: state.run.runId,
    tick: state.run.tick,
    expected: {
      runStatus: state.run.status,
      endgameStage: state.endgame.stage,
      invariantViolationCodes: violations.map((violation) => violation.code),
    },
    canonicalState: state,
  };
}
