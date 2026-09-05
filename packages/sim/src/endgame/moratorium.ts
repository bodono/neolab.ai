import type { CompiledContent } from "@neolab/content-schema";

import { calculateAuraSignal } from "../aura/aura.ts";
import { resolveCheck, resolveCheckProbability } from "../engine/checks.ts";
import type { LabId, ModelId } from "../model/ids.ts";
import type {
  GameState,
  GateFactorContributionState,
  GateResolutionState,
} from "../model/state.ts";
import { fraction, tick } from "../model/units.ts";
import { governmentProgrammeEndgameBenefits } from "../politics/politics.ts";
import {
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  CAPABILITY_ATTRIBUTES,
  calculateFrontierCapability,
} from "../models/capability.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import { agiComponentProgress } from "../rivals/candidate-programme-race.ts";

function factors(
  rows: readonly (readonly [id: string, label: string, value: number])[],
): GateFactorContributionState[] {
  return rows.map(([id, label, value]) => ({ id, label, value }));
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const SHARED_STANDARDS_BONUS_PER_APPEAL = 6;
const MAX_SHARED_STANDARDS_BONUS = 24;
export const MORATORIUM_NEGOTIATION_WEEKS = 8;

export interface MoratoriumForecastFactor {
  readonly id: string;
  readonly label: string;
  readonly sourceValue: number;
  readonly contribution: number;
}

export interface MoratoriumRivalPressure {
  readonly labId: LabId;
  readonly readiness: number;
  readonly contribution: number;
  readonly completedWorks: number;
  readonly buildingWorks: number;
  readonly candidateActive: boolean;
}

export interface DurableMoratoriumForecast {
  readonly strength: number;
  readonly difficulty: number;
  readonly probability: number;
  readonly positiveFactors: readonly MoratoriumForecastFactor[];
  readonly pressureFactors: readonly MoratoriumForecastFactor[];
  readonly rivalPressure: readonly MoratoriumRivalPressure[];
}

/**
 * Publicly calling for shared standards before the endgame creates durable
 * institutional groundwork for a Long Pause. The warning event can occur once
 * per rival, so the cap prevents repeated appeals from deciding the gate alone.
 */
export function sharedStandardsMoratoriumBonus(state: Readonly<GameState>): number {
  const playerLabId = state.run.playerLabId;
  const appeals = state.decisionMemories.filter(
    (memory) =>
      memory.tags.includes("long-pause-groundwork") &&
      memory.subjects.some(
        (subject) => subject.type === "lab" && subject.labId === playerLabId,
      ),
  ).length;
  return Math.min(
    MAX_SHARED_STANDARDS_BONUS,
    appeals * SHARED_STANDARDS_BONUS_PER_APPEAL,
  );
}

function rivalMoratoriumPressure(
  state: Readonly<GameState>,
): readonly MoratoriumRivalPressure[] {
  return (Object.keys(state.world.rivals).sort() as LabId[]).map((labId) => {
    const lab = state.labs[labId];
    if (lab === undefined) throw new Error(`Rival lab ${labId} missing`);
    const progress = agiComponentProgress(state, labId);
    const candidateActive = state.world.rivals[labId]?.candidateCountdown !== undefined;
    const strongestCapabilityProgress = lab.models.modelIds.reduce((best, modelId) => {
      const model = state.models[modelId];
      if (model === undefined) return best;
      const frontierProgress =
        calculateFrontierCapability(model.trueCapability) /
        AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY;
      const weakestTraitProgress =
        Math.min(
          ...CAPABILITY_ATTRIBUTES.map((attribute) => model.trueCapability[attribute]),
        ) / AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE;
      return Math.max(
        best,
        clamp(Math.min(frontierProgress, weakestTraitProgress), 0, 1),
      );
    }, 0);
    const worksProgress = clamp((progress.completed + progress.building * 0.5) / 4, 0, 1);
    const readiness = candidateActive
      ? 1
      : clamp(strongestCapabilityProgress * 0.65 + worksProgress * 0.35, 0, 1);
    const contribution =
      readiness === 0 ? 0 : Math.round((0.5 + readiness * readiness * 7.5) * 10) / 10;
    return {
      labId,
      readiness,
      contribution,
      completedWorks: progress.completed,
      buildingWorks: progress.building,
      candidateActive,
    };
  });
}

/**
 * Canonical mechanical forecast for the Long Pause. Rival pressure follows
 * actual candidate readiness rather than merely counting laboratories which
 * happen to own a model. Player-facing selectors replace that hidden term with
 * an intelligence estimate before displaying odds.
 */
export function durableMoratoriumForecast(
  state: Readonly<GameState>,
  content: CompiledContent,
  reviewerIndependence: number,
): DurableMoratoriumForecast {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Player lab missing");
  const auraSignal = calculateAuraSignal(state, content, state.run.playerLabId).final;
  const sharedStandardsBonus = sharedStandardsMoratoriumBonus(state);
  const programmeBonus = governmentProgrammeEndgameBenefits(
    state,
    state.run.playerLabId,
  ).moratorium;
  const positiveFactors: readonly MoratoriumForecastFactor[] = [
    {
      id: "government-trust",
      label: "Government trust",
      sourceValue: lab.politics.governmentTrust,
      contribution: lab.politics.governmentTrust * 0.45,
    },
    {
      id: "reviewer-independence",
      label: "Independent verification",
      sourceValue: reviewerIndependence,
      contribution: reviewerIndependence * 0.25,
    },
    {
      id: "public-legitimacy",
      label: "Public legitimacy",
      sourceValue: auraSignal,
      contribution: auraSignal * 0.2,
    },
    {
      id: "government-programmes",
      label: "Government programmes",
      sourceValue: lab.politics.programmes.length,
      contribution: programmeBonus,
    },
    {
      id: "shared-standards-groundwork",
      label: "Shared-standards groundwork",
      sourceValue: sharedStandardsBonus / SHARED_STANDARDS_BONUS_PER_APPEAL,
      contribution: sharedStandardsBonus,
    },
  ];
  const rivalPressure = rivalMoratoriumPressure(state);
  const rivalPressureTotal = rivalPressure.reduce(
    (sum, rival) => sum + rival.contribution,
    0,
  );
  const interventionPressure =
    state.endgameHistory.cumulativeCandidateInterventionPressure * 0.2;
  const pressureFactors: readonly MoratoriumForecastFactor[] = [
    {
      id: "base-difficulty",
      label: "Base diplomatic difficulty",
      sourceValue: 58,
      contribution: 58,
    },
    {
      id: "rival-pressure",
      label: "Rival race pressure",
      sourceValue: rivalPressure.filter((rival) => rival.readiness > 0).length,
      contribution: rivalPressureTotal,
    },
    {
      id: "intervention-pressure",
      label: "Repeat-candidate intervention pressure",
      sourceValue: state.endgameHistory.cumulativeCandidateInterventionPressure,
      contribution: interventionPressure,
    },
  ];
  const strength = clamp(
    positiveFactors.reduce((sum, factor) => sum + factor.contribution, 0),
  );
  const difficulty = clamp(
    pressureFactors.reduce((sum, factor) => sum + factor.contribution, 0),
  );
  return {
    strength,
    difficulty,
    probability: resolveCheckProbability(strength, difficulty, 0.05, 0.95),
    positiveFactors,
    pressureFactors,
    rivalPressure,
  };
}

/**
 * Shared, stage-independent international-moratorium gate. Retirement and a
 * public False Dawn use the same institutional test; only the semantic random
 * key differs, so neither route gets a hidden balance advantage.
 */
export function resolveDurableMoratoriumGate(
  state: Readonly<GameState>,
  content: CompiledContent,
  oracle: RandomOracle,
  options: {
    readonly modelId: ModelId;
    readonly reviewerIndependence: number;
    readonly context: "post-retirement" | "false-dawn";
    readonly resolvedAt?: number;
  },
): GateResolutionState {
  const forecast = durableMoratoriumForecast(
    state,
    content,
    options.reviewerIndependence,
  );
  const key = randomKey(
    "endgame",
    options.modelId,
    options.context,
    "durable-moratorium",
    String(state.endgameHistory.verifiedCandidateRetirementCount),
  );
  const result = resolveCheck(oracle, key, {
    strength: forecast.strength,
    difficulty: forecast.difficulty,
    minimumProbability: 0.05,
    maximumProbability: 0.95,
  });
  return {
    gate: "moratorium",
    resolvedAt: tick(options.resolvedAt ?? state.run.tick),
    strength: forecast.strength,
    difficulty: forecast.difficulty,
    probability: fraction(result.probability),
    randomKey: describeRandomKey(key),
    draw: fraction(result.draw),
    resultId: result.success ? "durable-moratorium-secured" : "moratorium-failed",
    visibleFactors: factors([
      ...forecast.positiveFactors.map(
        (factor) => [factor.id, factor.label, factor.contribution] as const,
      ),
      ...forecast.pressureFactors
        .filter((factor) => factor.id !== "rival-pressure")
        .map((factor) => [factor.id, factor.label, -factor.contribution] as const),
    ]),
    hiddenFactors: factors([
      [
        "rival-pressure",
        "Rivals' actual candidate readiness",
        -(
          forecast.pressureFactors.find((factor) => factor.id === "rival-pressure")
            ?.contribution ?? 0
        ),
      ],
    ]),
    effects: [],
  };
}
