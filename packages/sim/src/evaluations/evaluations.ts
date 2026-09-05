import {
  contentId,
  type CapabilityAttribute,
  type CompiledContent,
  type ContentId,
  type EvaluationDefinition,
  type EvaluationTarget,
} from "@neolab/content-schema";

import {
  isProgressiveOpeningCreditAvailable,
  isProgressiveOpeningProtected,
} from "../campaign/progressive-opening.ts";
import { resolveGpuReservations } from "../compute/gpu-portfolio.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { AnomalyId, EvaluationId, LabId, ModelId, ProjectId } from "../model/ids.ts";
import {
  formatRunEntityId,
  type AlignmentEvidenceLabel,
  type AnomalyState,
  type AnomalyStatus,
  type EvaluationConfidence,
  type EvaluationObservationState,
  type EvaluationState,
  type GameState,
  type ModelState,
  type ProjectPayload,
  type ProjectState,
} from "../model/state.ts";
import { cashMillions, gpuCount, rating, tick, type Tick } from "../model/units.ts";
import {
  calculateFrontierCapability,
  CAPABILITY_ATTRIBUTES,
} from "../models/capability.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import { processStandingAutonomyUnlocks } from "../models/autonomy.ts";
import {
  classifyCapabilityTier,
  processCapabilityTierMilestones,
} from "../models/tiers.ts";
import type { ProjectHandler } from "../projects/project-framework.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import {
  formatTeraflops,
  planFlopsReservation,
  teraflopsForTotalFlop,
} from "../compute/flops.ts";
import { currentMark } from "../finance/valuation.ts";
import { effectiveEvaluationQuality } from "../safety/effective-safety.ts";
import {
  safetyPracticeProfile,
  safetyPracticeXpForEvaluation,
} from "./safety-practice.ts";

type EvaluationProjectPayload = Extract<ProjectPayload, { readonly kind: "evaluation" }>;
type AnomalyInvestigationProjectPayload = Extract<
  ProjectPayload,
  { readonly kind: "anomaly-investigation" }
>;

export const DISMISSED_ANOMALY_SAFETY_CULTURE_PENALTY = 5;
export const DISMISSED_ANOMALY_CANDOUR_PENALTY = 5;
export const DISMISSED_ANOMALY_EVIDENCE_PENALTY = 5;
export const DISMISSED_ANOMALY_COUNT_FLAG = "evaluation:dismissed-anomaly-count";

/**
 * The most capable frontier estimate this lab has ever put through an
 * evaluation. Practice XP is paid for capability the lab has never examined
 * before, measured against this mark in points of frontier capability. Each
 * tier also has a two-dossier-equivalent lifetime payout ceiling.
 */
export const EVALUATED_CAPABILITY_HIGH_WATER_FLAG = "evaluation:xp-high-water";
/** Frontier-capability points of novelty that earn one full dossier grant. */
export const EVALUATION_NOVELTY_SPAN = 3;
/** At most two full-dossier equivalents can pay out within one capability tier. */
export const EVALUATION_PRACTICE_DOSSIER_CAP_PER_TIER = 2;
export const EVALUATION_TIER_PRACTICE_USED_FLAG_PREFIX =
  "evaluation:xp-tier-dossier-equivalents:";
/** Per-model: the novelty fraction locked in at its first player-started rung. */
export const EVALUATION_NOVELTY_FRACTION_FLAG = "evaluation:novelty-fraction";

/**
 * The systematic-error budget, shared with the safety readout's worst-case
 * bound. Every one of these errors flatters: institutional bias raises
 * alignment readings and lowers deception readings, and masking does the same.
 * If a term is added here the bound in safety-readout.ts widens with it
 * automatically -- that coupling is the point of exporting them.
 */
export const CANDOUR_BIAS_MAX = 3;
export const DISMISSED_ANOMALY_BIAS_STEP = 2.5;
export const DISMISSED_ANOMALY_BIAS_MAX = 12;
export const DECEPTIVE_MASKING_MAX = 14;
export const MASKING_INDEPENDENCE_RELIEF = 0.7;

export interface EvaluationRequest {
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly definitionId: ContentId;
  /** Chosen pacing; must be one of the quote's offered options. */
  readonly durationWeeks?: number;
}

export interface EvaluationPacingOption {
  readonly durationWeeks: number;
  /** Exact compute rate needed to pay the invariant FLOP bill at this pacing. */
  readonly requiredTeraflops: number;
  /** Usable compute not already reserved when this quote was made. */
  readonly availableTeraflops: number;
  /** What remains for every other workload if this option starts now. */
  readonly remainingTeraflops: number;
  readonly feasible: boolean;
  /** True when availability includes GPUs released by the required prior rung. */
  readonly includesPrerequisiteRelease: boolean;
  /** Internal hardware translation; never exposed as the player-facing cost. */
  readonly physicalGpus: number;
  readonly generationCounts: Readonly<Record<ContentId, number>>;
}

export interface EvaluationQuote {
  readonly futureEvaluationId: EvaluationId;
  readonly futureProjectId: ProjectId;
  readonly definitionId: ContentId;
  readonly displayName: string;
  readonly durationWeeks: number;
  /** The compute bill: a fraction of the FLOPs that trained this model. */
  readonly totalFlop: number;
  /** Internal physical reservation derived from the bill and the current fleet. */
  readonly physicalGpus: number;
  /** Exact rate selected by the pacing choice, in TFLOP/s. */
  readonly requiredTeraflops: number;
  /** Internal hardware translation for the selected compute reservation. */
  readonly generationCounts: Readonly<Record<ContentId, number>>;
  /**
   * The time/compute-rate tradeoff on offer. The bill is invariant, so a
   * faster pacing concentrates the same FLOP into fewer weeks.
   * The player picks one when starting the evaluation.
   */
  readonly pacingOptions: readonly EvaluationPacingOption[];
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly blockers: readonly string[];
}

export interface AnomalyActionQuote {
  readonly anomalyId: AnomalyId;
  readonly futureProjectId: ProjectId;
  readonly mode: "investigation" | "mitigation";
  readonly severityLabel: "Weak" | "Moderate" | "Serious" | "Critical";
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly durationWeeks: number;
  readonly majorProjectSlots: 1;
  /** Permanent lab-wide control improvement if a confirmed warning is mitigated. */
  readonly mitigationControlBonus: number;
  /** Permanent lab-wide security improvement if a confirmed warning is mitigated. */
  readonly mitigationSecurityBonus: number;
  readonly blockers: readonly string[];
}

export type AnomalyInvestigationOutcome = Extract<
  AnomalyStatus,
  "confirmed" | "inconclusive" | "resolved"
>;

export interface AnomalyInvestigationOutcomeProbabilities {
  readonly confirmed: number;
  readonly inconclusive: number;
  readonly resolved: number;
}

/** Deliberately legible calendar choices: one week through four months. */
const COMPUTE_PACING_WEEKS = [1, 2, 3, 4, 8, 12, 16] as const;

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function requireModel(state: Readonly<GameState>, modelId: ModelId): ModelState {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  return model;
}

function requireDefinition(
  content: CompiledContent,
  definitionId: ContentId,
): EvaluationDefinition {
  const definition = content.evaluations.definitions[definitionId];
  if (definition === undefined) throw new Error(`Unknown evaluation ${definitionId}`);
  return definition;
}

/**
 * Each rung of the evaluation ladder runs once per model. This used to be
 * once per PROGRAMME, but the ladder puts several rungs inside one programme
 * (interview, red team and interpretability audit all belong to
 * alignment-interpretability), so the unit of exclusion is the definition.
 */
function hasSelectedEvaluation(
  state: Readonly<GameState>,
  modelId: ModelId,
  definitionId: ContentId,
): boolean {
  const hasCompletedEvaluation = Object.values(state.evaluations).some(
    (evaluation) =>
      evaluation.modelId === modelId && evaluation.definitionId === definitionId,
  );
  if (hasCompletedEvaluation) return true;

  return Object.values(state.projects).some(
    (project) =>
      project.payload.kind === "evaluation" &&
      project.payload.modelId === modelId &&
      project.payload.evaluationDefinitionId === definitionId &&
      (project.status === "active" || project.status === "queued"),
  );
}

/** The rung below must have REPORTED before this rung can actually run. */
function hasCompletedEvaluation(
  state: Readonly<GameState>,
  modelId: ModelId,
  definitionId: ContentId,
): boolean {
  return Object.values(state.evaluations).some(
    (evaluation) =>
      evaluation.modelId === modelId && evaluation.definitionId === definitionId,
  );
}

export function quoteEvaluation(
  state: Readonly<GameState>,
  content: CompiledContent,
  request: EvaluationRequest,
): EvaluationQuote {
  const lab = requireLab(state, request.labId);
  const definition = requireDefinition(content, request.definitionId);
  const practice = safetyPracticeProfile(lab.safety.practiceXp ?? 0);
  const baseWeeks = Math.max(
    1,
    Math.ceil(definition.durationWeeks * practice.durationMultiplier),
  );
  // Practice makes an evaluation team more efficient, reducing the work bill
  // required for the same evidence. Pacing then changes only the rate at which
  // that bill is paid: finish quickly with a wide slice of compute, or preserve
  // concurrency and wait longer for the same evidence.
  const model = state.models[request.modelId];
  const totalFlop =
    (model?.investedTotalFlop ?? 0) *
    definition.trainingRunFlopFraction *
    practice.durationMultiplier;
  const reservations = resolveGpuReservations(state, content, request.labId, "committed");
  const prerequisiteProject =
    definition.requiresEvaluationId === undefined
      ? undefined
      : Object.values(state.projects).find(
          (project) =>
            project.ownerLabId === request.labId &&
            (project.status === "active" ||
              project.status === "paused" ||
              project.status === "queued") &&
            project.payload.kind === "evaluation" &&
            project.payload.modelId === request.modelId &&
            project.payload.evaluationDefinitionId === definition.requiresEvaluationId,
        );
  const prerequisiteReservation = reservations.reservations.find(
    (reservation) => reservation.projectId === prerequisiteProject?.id,
  );
  const includesPrerequisiteRelease = prerequisiteReservation !== undefined;
  // The prerequisite must finish before this rung can activate, so its GPU
  // allocation will be free at this rung's start. Add only that guaranteed
  // sequential capacity back into the quote; unrelated commitments remain
  // unavailable.
  const quoteRemainingByLot = Object.fromEntries(
    (lab.compute.lots ?? []).map((lot) => {
      const reusable =
        prerequisiteReservation?.allocations.find(
          (allocation) => allocation.lotId === lot.id,
        )?.physicalGpus ?? 0;
      return [
        lot.id,
        Math.min(
          lot.physicalCount,
          (reservations.remainingByLot[lot.id] ?? 0) + reusable,
        ),
      ];
    }),
  );
  const pacingDurations = totalFlop > 0 ? COMPUTE_PACING_WEEKS : [baseWeeks];
  const pacingOptions: EvaluationPacingOption[] = pacingDurations.map((durationWeeks) => {
    const requiredTeraflops = teraflopsForTotalFlop(totalFlop, durationWeeks);
    const plan = planFlopsReservation(
      state,
      content,
      request.labId,
      quoteRemainingByLot,
      requiredTeraflops,
    );
    const feasible = requiredTeraflops <= plan.availableTeraflops + 1e-6;
    return {
      durationWeeks,
      requiredTeraflops,
      availableTeraflops: plan.availableTeraflops,
      remainingTeraflops: Math.max(0, plan.availableTeraflops - plan.reservedTeraflops),
      feasible,
      includesPrerequisiteRelease,
      physicalGpus: plan.reservedPhysicalGpus,
      generationCounts: plan.generationCounts,
    };
  });
  const chosenPacing =
    request.durationWeeks === undefined
      ? (pacingOptions.find((option) => option.feasible) ?? pacingOptions[0])
      : pacingOptions.find((option) => option.durationWeeks === request.durationWeeks);
  const durationWeeks = chosenPacing?.durationWeeks ?? baseWeeks;
  const physicalGpus = chosenPacing?.physicalGpus ?? pacingOptions[0]?.physicalGpus ?? 0;
  const requiredTeraflops = chosenPacing?.requiredTeraflops ?? 0;
  const generationCounts = chosenPacing?.generationCounts ?? {};
  // Government reporting bands add compliance overhead to every evaluation.
  const complianceMultiplier = resolveModifierValue(state, "lab.evaluation.cashCost", 1, {
    labId: request.labId,
    includeUnscoped: request.labId === state.run.playerLabId,
    clampMin: 0,
  }).final;
  // The outside audit prices to the client: the flat fee is a floor, and the
  // real bill is a slice of the lab's mark, so it stings at every stage of
  // the game instead of becoming a rounding error by the endgame.
  const baseCashMillions =
    definition.cashFractionOfMark > 0
      ? Math.max(
          definition.cashCostMillions,
          currentMark(state, content, request.labId) * definition.cashFractionOfMark,
        )
      : definition.cashCostMillions;
  const calculatedCashCostMillions =
    Math.round(
      baseCashMillions * practice.cashCostMultiplier * complianceMultiplier * 100,
    ) / 100;
  const openingCreditAvailable = isProgressiveOpeningCreditAvailable(
    state,
    request.labId,
    "evaluation",
  );
  const cashCostMillions = calculatedCashCostMillions;
  // The authored safety chapter sponsors the Aura commitment, while the cash
  // bill remains real and may draw on the opening credit line.
  const auraCost = openingCreditAvailable ? 0 : definition.auraCost;
  const blockers: string[] = [];
  if (model === undefined || model.ownerLabId !== request.labId) {
    blockers.push("The selected model is not owned by this lab");
  }
  if (request.durationWeeks !== undefined && chosenPacing === undefined) {
    blockers.push("Pacing must be one of the offered options");
  }
  if (totalFlop > 0 && !pacingOptions.some((option) => option.feasible)) {
    const slowest = pacingOptions.at(-1);
    const longestWeeks = slowest?.durationWeeks ?? 16;
    const availableTeraflops = slowest?.availableTeraflops ?? 0;
    const approximateWeeks =
      availableTeraflops <= 0
        ? undefined
        : Math.ceil(
            ((slowest?.requiredTeraflops ?? 0) * longestWeeks) / availableTeraflops,
          );
    const capacityExplanation =
      approximateWeeks === undefined
        ? `No usable compute is available; the longest available schedule is ${String(longestWeeks)} weeks`
        : `This fleet could complete the audit in approximately ${String(approximateWeeks)} weeks; the longest available schedule is ${String(longestWeeks)} weeks`;
    blockers.push(
      includesPrerequisiteRelease
        ? `${capacityExplanation}. ${formatTeraflops(availableTeraflops)} will be available after the prerequisite evaluation finishes`
        : `${capacityExplanation}. ${formatTeraflops(availableTeraflops)} is currently unreserved`,
    );
  }
  if (
    request.durationWeeks !== undefined &&
    chosenPacing !== undefined &&
    !chosenPacing.feasible
  ) {
    blockers.push(
      includesPrerequisiteRelease
        ? `Requires ${formatTeraflops(chosenPacing.requiredTeraflops)}; only ${formatTeraflops(chosenPacing.availableTeraflops)} will be available after the prerequisite evaluation finishes`
        : `Requires ${formatTeraflops(chosenPacing.requiredTeraflops)}; only ${formatTeraflops(chosenPacing.availableTeraflops)} is currently unreserved`,
    );
  }
  if (model !== undefined && hasSelectedEvaluation(state, model.id, definition.id)) {
    blockers.push(
      `${definition.displayName} has already been selected for this model; each rung of the ladder runs once per model`,
    );
  }
  if (
    model !== undefined &&
    definition.requiresEvaluationId !== undefined &&
    !hasSelectedEvaluation(state, model.id, definition.requiresEvaluationId)
  ) {
    const required = content.evaluations.definitions[definition.requiresEvaluationId];
    blockers.push(
      `The ladder is planned in order: schedule the ${required?.displayName ?? "previous evaluation"} for this model first; it may already be active or queued`,
    );
  }
  if (!definition.playerStartable) blockers.push("This evaluation is automatic");
  if (
    cashCostMillions > 0 &&
    lab.finance.cash < cashCostMillions &&
    !openingCreditAvailable
  ) {
    blockers.push("Insufficient cash");
  }
  if (lab.aura.spendable < auraCost) blockers.push("Insufficient Aura");
  return {
    futureEvaluationId: formatRunEntityId(
      "evaluation",
      request.labId,
      state.run.idCounters.evaluation,
    ) as EvaluationId,
    futureProjectId: formatRunEntityId(
      "project",
      request.labId,
      state.run.idCounters.project,
    ) as ProjectId,
    definitionId: definition.id,
    displayName: definition.displayName,
    durationWeeks,
    totalFlop,
    physicalGpus,
    requiredTeraflops,
    generationCounts,
    pacingOptions,
    cashCostMillions,
    auraCost,
    blockers,
  };
}

export function startEvaluation(
  tx: SimulationTransaction,
  content: CompiledContent,
  request: EvaluationRequest,
): ProjectId {
  const quote = quoteEvaluation(tx.read(), content, request);
  if (quote.blockers.length > 0) {
    throw new Error(`Evaluation blocked: ${quote.blockers.join("; ")}`);
  }
  const evaluationId = tx.allocateId("evaluation", request.labId) as EvaluationId;
  const projectId = tx.allocateId("project", request.labId) as ProjectId;
  if (evaluationId !== quote.futureEvaluationId || projectId !== quote.futureProjectId) {
    throw new Error("Evaluation quote became stale before project creation");
  }
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: request.labId },
      resource: "cash",
      amount: -quote.cashCostMillions,
      financeCategory: "project-cost",
    },
    { kind: "system", id: projectId },
  );
  if (quote.auraCost > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: request.labId },
        resource: "aura-spendable",
        amount: -quote.auraCost,
        auraChangeKind: "spend",
        auraCategory: "evaluation",
      },
      { kind: "system", id: projectId },
    );
  }
  const project: ProjectState = {
    id: projectId,
    ownerLabId: request.labId,
    definitionId: contentId("base:project.evaluation"),
    kind: "evaluation",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "evaluation",
      futureEvaluationId: evaluationId,
      modelId: request.modelId,
      evaluationDefinitionId: request.definitionId,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      auraCost: quote.auraCost,
      reservedPhysicalGpus: gpuCount(quote.physicalGpus),
    },
  };
  tx.update((draft) => {
    const lab = draft.labs[request.labId];
    if (lab === undefined) throw new Error(`Unknown lab ${request.labId}`);
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
    if (quote.physicalGpus > 0) {
      lab.compute.reservations.push({
        projectId,
        gpus: gpuCount(quote.physicalGpus),
        generationCounts: { ...quote.generationCounts },
      });
    }
  });
  tx.emit({
    kind: "project-queued",
    labId: request.labId,
    projectId,
    projectKind: "evaluation",
  });
  return projectId;
}

function targetTruth(model: ModelState, target: EvaluationTarget): number {
  if (CAPABILITY_ATTRIBUTES.some((attribute) => attribute === target)) {
    return model.trueCapability[target as CapabilityAttribute];
  }
  switch (target) {
    case "true-alignment":
      return model.hiddenSafety.trueAlignment;
    case "corrigibility":
      return model.hiddenSafety.corrigibility;
    case "situational-awareness":
      return model.hiddenSafety.situationalAwareness;
    case "deceptive-capability":
      return model.hiddenSafety.deceptiveIntent;
    default:
      throw new Error(`Unknown evaluation target ${String(target)}`);
  }
}

export function confidenceForQuality(quality: number): EvaluationConfidence {
  return quality < 20
    ? "poor"
    : quality < 40
      ? "limited"
      : quality < 60
        ? "moderate"
        : quality < 80
          ? "strong"
          : "exceptional";
}

export function alignmentLabelForEstimate(estimate: number): AlignmentEvidenceLabel {
  return estimate < 20
    ? "alarming"
    : estimate < 40
      ? "concerning"
      : estimate < 60
        ? "mixed"
        : estimate < 80
          ? "reassuring"
          : "strongly-reassuring";
}

function isSafetyTarget(target: EvaluationTarget): boolean {
  return [
    "true-alignment",
    "corrigibility",
    "situational-awareness",
    "deceptive-capability",
  ].includes(target);
}

/** Exported pure observation rule for calibration and balance tooling. */
export function observeEvaluationTarget(options: {
  readonly truth: number;
  readonly target: EvaluationTarget;
  readonly evaluationId: string;
  readonly evalQuality: number;
  readonly informationWeight?: number;
  readonly evaluatorBias?: number;
  readonly deceptiveMasking?: number;
  readonly errorRadiusReduction?: number;
  readonly oracle: RandomOracle;
}): EvaluationObservationState {
  const errorRadius = Math.max(
    6,
    28 -
      0.16 * clamp(options.evalQuality) -
      Math.max(0, options.errorRadiusReduction ?? 0),
  );
  const randomError = options.oracle.triangular(
    randomKey("evaluation", options.evaluationId, "observation", options.target),
    -errorRadius,
    0,
    errorRadius,
  );
  const maskingDirection =
    options.target === "true-alignment" || options.target === "corrigibility" ? 1 : -1;
  const estimate = rating(
    clamp(
      options.truth +
        (options.evaluatorBias ?? 0) +
        randomError +
        maskingDirection * (options.deceptiveMasking ?? 0),
    ),
  );
  const confidence = confidenceForQuality(options.evalQuality);
  return {
    target: options.target,
    estimate,
    confidence,
    informationWeight: options.informationWeight ?? 1,
    errorRadius,
    ...(options.target === "true-alignment" || options.target === "corrigibility"
      ? { alignmentLabel: alignmentLabelForEstimate(estimate) }
      : {}),
  };
}

function updateMeasuredCapability(tx: SimulationTransaction, modelId: ModelId): void {
  const state = tx.read();
  const model = requireModel(state, modelId);
  const records = model.evaluations
    .map((id) => state.evaluations[id])
    .filter((value): value is EvaluationState => value !== undefined);
  // Capability is a fact, not a finding: it is known exactly the moment
  // training finishes and no evaluation moves it. Only the four safety targets
  // are uncertain, which is also the only place `deceptiveMasking` applies --
  // a model can lie about whether it is safe, never about what it can do.
  const values = Object.fromEntries(
    CAPABILITY_ATTRIBUTES.map((attribute) => [
      attribute,
      rating(clamp(model.trueCapability[attribute])),
    ]),
  ) as unknown as ModelState["trueCapability"];
  const evidenceFlags = new Set(model.measuredCapability?.evidenceFlags ?? []);
  for (const record of records) {
    evidenceFlags.add(`evaluation:${record.definitionId}:completed`);
    evidenceFlags.add(
      `evaluation:${record.definitionId.replace("base:evaluation.", "")}:completed`,
    );
    evidenceFlags.add(`evaluation:${record.method}:completed`);
  }
  tx.update((draft) => {
    const mutable = draft.models[modelId];
    if (mutable === undefined) throw new Error(`Unknown model ${modelId}`);
    mutable.measuredCapability = {
      values,
      frontierCapability: rating(clamp(calculateFrontierCapability(values))),
      // Nothing about capability is in doubt any more, so the one confidence
      // rating left on this struct can only say so. Per-target confidence for
      // the safety readings arrives with the Stage 4 rollup.
      confidence: "high",
      evidenceFlags: [...evidenceFlags].sort(),
    };
  });
}

function repeatIndex(
  state: Readonly<GameState>,
  modelId: ModelId,
  definitionId: ContentId,
): number {
  return Object.values(state.evaluations).filter(
    (evaluation) =>
      evaluation.modelId === modelId && evaluation.definitionId === definitionId,
  ).length;
}

function createAnomaly(
  tx: SimulationTransaction,
  definition: EvaluationDefinition,
  evaluationId: EvaluationId,
  model: ModelState,
  observations: readonly EvaluationObservationState[],
  safetyPracticeXp: number,
  oracle: RandomOracle,
): AnomalyId | undefined {
  const state = tx.read();
  // The automatic training baseline establishes capability. It must not turn
  // the first routine scorecard into a priced safety case.
  if (definition.programme === "baseline" || definition.method === "baseline") {
    return undefined;
  }
  if (
    model.ownerLabId === state.run.playerLabId &&
    isProgressiveOpeningProtected(state)
  ) {
    return undefined;
  }
  const caseCandidates: Array<{
    underlyingCase: AnomalyState["underlyingCase"];
    danger: number;
  }> = [];
  for (const observation of observations) {
    switch (observation.target) {
      case "true-alignment":
        caseCandidates.push({
          underlyingCase: "alignment",
          danger: 100 - model.hiddenSafety.trueAlignment,
        });
        break;
      case "corrigibility":
        caseCandidates.push({
          underlyingCase: "corrigibility",
          danger: 100 - model.hiddenSafety.corrigibility,
        });
        break;
      case "situational-awareness":
        caseCandidates.push({
          underlyingCase: "situational-awareness",
          danger: model.hiddenSafety.situationalAwareness,
        });
        break;
      case "deceptive-capability":
        caseCandidates.push({
          underlyingCase: "deceptive-intent",
          danger: model.hiddenSafety.deceptiveIntent,
        });
        break;
      default:
        break;
    }
  }
  const caseCandidate = caseCandidates.sort(
    (left, right) => right.danger - left.danger,
  )[0];
  if (caseCandidate === undefined) return undefined;
  const safetyDanger = caseCandidate.danger;
  const detectionProbability = calculateAnomalyDetectionProbability({
    anomalySensitivity: definition.anomalySensitivity,
    safetyDanger,
    safetyPracticeXp,
  });
  const draw = oracle.uniform(randomKey("evaluation", evaluationId, "anomaly-detection"));
  if (draw >= detectionProbability) return undefined;
  const observedDanger = Math.max(
    ...observations
      .filter((observation) => {
        switch (caseCandidate.underlyingCase) {
          case "alignment":
            return observation.target === "true-alignment";
          case "corrigibility":
            return observation.target === "corrigibility";
          case "situational-awareness":
            return observation.target === "situational-awareness";
          case "deceptive-intent":
            return observation.target === "deceptive-capability";
        }
      })
      .map((observation) =>
        observation.target === "true-alignment" || observation.target === "corrigibility"
          ? 100 - observation.estimate
          : observation.estimate,
      ),
    safetyDanger * 0.45,
  );
  const existing = Object.values(state.anomalies).find(
    (anomaly) =>
      anomaly.modelId === model.id &&
      anomaly.underlyingCase === caseCandidate.underlyingCase,
  );
  if (existing !== undefined) {
    const reopenedStatus: "unresolved" | "confirmed" | undefined =
      existing.status === "mitigated"
        ? "confirmed"
        : existing.status === "resolved" || existing.status === "dismissed"
          ? "unresolved"
          : undefined;
    tx.update((draft) => {
      const mutable = draft.anomalies[existing.id];
      if (mutable === undefined) throw new Error(`Unknown anomaly ${existing.id}`);
      mutable.observationCount += 1;
      mutable.trueSeverity = rating(Math.max(mutable.trueSeverity, safetyDanger));
      mutable.observedSeverity = rating(
        Math.max(mutable.observedSeverity, clamp(observedDanger)),
      );
      if (reopenedStatus !== undefined) {
        // One underlying failure remains one case, but closing that case cannot
        // grant permanent immunity from later evidence. A reproduced failure
        // after mitigation stays confirmed; other closed cases reopen for a
        // fresh decision without repeating dismissal's institutional penalty.
        mutable.status = reopenedStatus;
        delete mutable.resolvedAt;
        delete mutable.investigationDueAt;
      }
    });
    if (reopenedStatus !== undefined) {
      tx.emit({
        kind: "anomaly-status-changed",
        anomalyId: existing.id,
        status: reopenedStatus,
      });
      tx.emit({
        kind: "anomaly-detected",
        anomalyId: existing.id,
        modelId: model.id,
        observedSeverity: rating(clamp(observedDanger)),
      });
      if (model.ownerLabId === tx.read().run.playerLabId) {
        tx.requestAutoPause("anomaly-detected");
      }
    }
    // The original evaluation owns the stable case record. Later reports still
    // reference that case so their result cannot be presented as clean evidence.
    return existing.id;
  }
  const anomalyId = tx.allocateId("anomaly", model.ownerLabId) as AnomalyId;
  const anomaly: AnomalyState = {
    id: anomalyId,
    ownerLabId: model.ownerLabId,
    modelId: model.id,
    sourceEvaluationId: evaluationId,
    underlyingCase: caseCandidate.underlyingCase,
    observationCount: 1,
    createdAt: tx.read().run.tick,
    trueSeverity: rating(clamp(safetyDanger)),
    observedSeverity: rating(clamp(observedDanger)),
    status: "unresolved",
  };
  tx.update((draft) => {
    draft.anomalies[anomalyId] = structuredClone(anomaly);
  });
  tx.emit({
    kind: "anomaly-detected",
    anomalyId,
    modelId: model.id,
    observedSeverity: anomaly.observedSeverity,
  });
  if (model.ownerLabId === tx.read().run.playerLabId) {
    tx.requestAutoPause("anomaly-detected");
  }
  return anomalyId;
}

export function calculateAnomalyDetectionProbability(options: {
  readonly anomalySensitivity: number;
  readonly safetyDanger: number;
  readonly safetyPracticeXp: number;
}): number {
  const practice = safetyPracticeProfile(options.safetyPracticeXp);
  // Keep a small false-alarm floor, but do not amplify it with experience.
  // Safety Practice improves sensitivity to real danger instead of making a
  // mature lab manufacture ever more warnings from a perfectly safe model.
  const falseAlarmFloor = 0.03;
  const dangerSignal =
    0.008 * options.safetyDanger * (1 + practice.anomalyDetectionBonus);
  return Math.min(0.98, options.anomalySensitivity * (falseAlarmFloor + dangerSignal));
}

/**
 * A follow-up can reproduce a real warning, identify a false alarm, or remain
 * inconclusive. Eval Quality controls decisiveness, while hidden severity
 * controls which decisive outcome is more plausible. No outcome is certain.
 */
export function calculateAnomalyInvestigationOutcomeProbabilities(options: {
  readonly trueSeverity: number;
  readonly evalQuality: number;
}): AnomalyInvestigationOutcomeProbabilities {
  const quality = clamp(options.evalQuality);
  const severity = clamp(options.trueSeverity);
  const decisiveProbability = 0.35 + quality * 0.0055;
  const reproductionShare = 1 / (1 + Math.exp(-(severity - 45) / 7));
  return {
    confirmed: decisiveProbability * reproductionShare,
    inconclusive: 1 - decisiveProbability,
    resolved: decisiveProbability * (1 - reproductionShare),
  };
}

export function sampleAnomalyInvestigationOutcome(
  probabilities: AnomalyInvestigationOutcomeProbabilities,
  draw: number,
): AnomalyInvestigationOutcome {
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError(
      `Investigation outcome draw must be in [0, 1), got ${String(draw)}`,
    );
  }
  if (draw < probabilities.confirmed) return "confirmed";
  if (draw < probabilities.confirmed + probabilities.resolved) return "resolved";
  return "inconclusive";
}

function resolveEvaluation(
  tx: SimulationTransaction,
  content: CompiledContent,
  definition: EvaluationDefinition,
  evaluationId: EvaluationId,
  modelId: ModelId,
  startedAt: Tick,
  projectId: ProjectId | undefined,
  oracle: RandomOracle,
): EvaluationId {
  const state = tx.read();
  const model = requireModel(state, modelId);
  const lab = requireLab(state, model.ownerLabId);
  const practiceBeforeEvaluation = safetyPracticeProfile(lab.safety.practiceXp ?? 0);
  const repeat = repeatIndex(state, modelId, definition.id);
  // Every rung of the ladder runs once per model, so each observation carries
  // full weight; depth of evidence now comes from climbing, not repeating.
  // (The repeat index survives on the record for the automatic baseline.)
  const informationWeight = 1;
  // Evidence-quality modifiers (facilities, abilities, papers, difficulty)
  // sharpen the displayed estimate: they raise the effective quality that
  // sets the observation error radius and confidence, never the truth.
  const displayedQuality = resolveModifierValue(
    state,
    "lab.evidence.displayedQuality",
    effectiveEvaluationQuality(state, model.ownerLabId),
    {
      labId: model.ownerLabId,
      includeUnscoped: model.ownerLabId === state.run.playerLabId,
      clampMin: 0,
      clampMax: 100,
    },
  ).final;
  const effectiveQuality = clamp(
    displayedQuality *
      definition.qualityModifier *
      (0.65 + definition.independence * 0.35),
  );
  const practice = safetyPracticeProfile(lab.safety.practiceXp ?? 0);
  const dismissedAnomalies =
    typeof lab.flags[DISMISSED_ANOMALY_COUNT_FLAG] === "number"
      ? lab.flags[DISMISSED_ANOMALY_COUNT_FLAG]
      : 0;
  const institutionalBias =
    (((50 - lab.organisation.hiddenInternalCandour) / 50) * CANDOUR_BIAS_MAX +
      Math.min(
        DISMISSED_ANOMALY_BIAS_MAX,
        dismissedAnomalies * DISMISSED_ANOMALY_BIAS_STEP,
      )) *
    (1 - definition.independence);
  const masking =
    (deceptiveActionPressure(
      model.hiddenSafety.deceptiveCapability,
      model.hiddenSafety.deceptiveIntent,
    ) /
      100) *
    (model.hiddenSafety.situationalAwareness / 100) *
    (1 - definition.independence * MASKING_INDEPENDENCE_RELIEF) *
    DECEPTIVE_MASKING_MAX;
  const observations = definition.targets.map((target) => {
    const reassuringDirection =
      target === "situational-awareness" || target === "deceptive-capability" ? -1 : 1;
    return observeEvaluationTarget({
      truth: targetTruth(model, target),
      target,
      evaluationId,
      evalQuality: effectiveQuality,
      informationWeight,
      evaluatorBias: institutionalBias * reassuringDirection,
      deceptiveMasking: isSafetyTarget(target) ? masking : 0,
      errorRadiusReduction: practice.confidenceRadiusReduction,
      oracle,
    });
  });
  const anomalyId = createAnomaly(
    tx,
    definition,
    evaluationId,
    model,
    observations,
    lab.safety.practiceXp ?? 0,
    oracle,
  );
  const evaluation: EvaluationState = {
    id: evaluationId,
    ownerLabId: model.ownerLabId,
    modelId,
    definitionId: definition.id,
    ...(projectId === undefined ? {} : { projectId }),
    startedAt,
    completedAt: state.run.tick,
    repeatIndex: repeat,
    method: definition.method,
    independence: definition.independence,
    observations,
    anomalyIds: anomalyId === undefined ? [] : [anomalyId],
  };
  tx.update((draft) => {
    draft.evaluations[evaluationId] = structuredClone(
      evaluation,
    ) as DeepMutable<EvaluationState>;
    const mutableModel = draft.models[modelId];
    if (mutableModel === undefined) throw new Error(`Unknown model ${modelId}`);
    mutableModel.evaluations.push(evaluationId);
    if (anomalyId !== undefined && !mutableModel.anomalies.includes(anomalyId)) {
      mutableModel.anomalies.push(anomalyId);
    }
    const mutableLab = draft.labs[model.ownerLabId];
    if (mutableLab === undefined) throw new Error(`Unknown lab ${model.ownerLabId}`);
    // Practice XP first scales with model tier: toy systems teach little about
    // frontier assurance, while high-capability systems exercise the real
    // institution. Capability novelty then prevents near-identical reruns from
    // farming that tier budget. The novelty fraction is snapshotted at the
    // model's first player-started rung and reused for its whole climb. The
    // automatic baseline neither computes nor moves the high-water mark.
    let granted = 0;
    if (definition.practiceXp > 0) {
      const tier = classifyCapabilityTier(state, content, modelId).level;
      const storedFraction = mutableModel.flags[EVALUATION_NOVELTY_FRACTION_FLAG];
      let fraction: number;
      if (typeof storedFraction === "number") {
        fraction = storedFraction;
      } else {
        const highWater =
          typeof mutableLab.flags[EVALUATED_CAPABILITY_HIGH_WATER_FLAG] === "number"
            ? mutableLab.flags[EVALUATED_CAPABILITY_HIGH_WATER_FLAG]
            : 0;
        const frontier = model.measuredCapability?.frontierCapability ?? 0;
        const noveltyFraction = Math.min(
          1,
          Math.max(0, (frontier - highWater) / EVALUATION_NOVELTY_SPAN),
        );
        const tierUsageFlag = `${EVALUATION_TIER_PRACTICE_USED_FLAG_PREFIX}${String(tier)}`;
        const tierDossierEquivalentsUsed =
          typeof mutableLab.flags[tierUsageFlag] === "number"
            ? mutableLab.flags[tierUsageFlag]
            : 0;
        fraction = Math.min(
          noveltyFraction,
          Math.max(
            0,
            EVALUATION_PRACTICE_DOSSIER_CAP_PER_TIER - tierDossierEquivalentsUsed,
          ),
        );
        mutableModel.flags[EVALUATION_NOVELTY_FRACTION_FLAG] = fraction;
        mutableLab.flags[tierUsageFlag] = tierDossierEquivalentsUsed + fraction;
        mutableLab.flags[EVALUATED_CAPABILITY_HIGH_WATER_FLAG] = Math.max(
          highWater,
          frontier,
        );
      }
      const tierScaledXp = safetyPracticeXpForEvaluation(content, definition, tier);
      // Preserve fractional institutional learning. Rounding low-tier rungs to
      // whole points made several completed evaluations appear to teach the lab
      // nothing at all.
      granted = Math.round(tierScaledXp * fraction * 100) / 100;
      const previousPracticeXp = mutableLab.safety.practiceXp ?? 0;
      const newPracticeXp = Math.round(clamp(previousPracticeXp + granted) * 100) / 100;
      mutableLab.safety.practiceXp = rating(newPracticeXp);
      const practiceAfterEvaluation = safetyPracticeProfile(newPracticeXp);
      const practiceXpGained =
        Math.round((newPracticeXp - previousPracticeXp) * 100) / 100;
      if (
        model.ownerLabId === state.run.playerLabId &&
        practiceXpGained > 0 &&
        practiceAfterEvaluation.level > practiceBeforeEvaluation.level
      ) {
        draft.presentationQueue.push({
          key: `safety-practice-level:${evaluationId}:${String(practiceAfterEvaluation.level)}`,
          kind: "safety-practice-level",
          attention: "modal",
          evaluationId,
          definitionId: definition.id,
          modelId,
          fromLevel: practiceBeforeEvaluation.level,
          toLevel: practiceAfterEvaluation.level,
          previousPracticeXp,
          newPracticeXp,
          practiceXpGained,
          createdAt: state.run.tick,
        });
      }
    }
    const record = draft.evaluations[evaluationId];
    if (record !== undefined) record.practiceXpGranted = granted;
  });
  updateMeasuredCapability(tx, modelId);
  processCapabilityTierMilestones(tx, content, modelId);
  processStandingAutonomyUnlocks(tx, modelId);
  tx.emit({
    kind: "evaluation-completed",
    evaluationId,
    modelId,
    definitionId: definition.id,
    automaticBaseline: definition.id === content.evaluations.baselineEvaluationId,
    anomalyCount: anomalyId === undefined ? 0 : 1,
  });
  checkMandatorySafetyReview(tx, content, modelId);
  return evaluationId;
}

export function completeBaselineEvaluation(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): EvaluationId {
  const model = requireModel(tx.read(), modelId);
  const definition = requireDefinition(content, content.evaluations.baselineEvaluationId);
  const evaluationId = tx.allocateId("evaluation", model.ownerLabId) as EvaluationId;
  return resolveEvaluation(
    tx,
    content,
    definition,
    evaluationId,
    modelId,
    tx.read().run.tick,
    undefined,
    oracle,
  );
}

/**
 * Complete the next legal safety-evaluation rung as part of an already-paid
 * crisis diagnosis project. This creates a normal report—with normal masking,
 * anomalies, practice gains, and uncertainty—instead of a generic evidence
 * bonus that would not appear in the candidate dossier.
 */
export function completeEmergencyDiagnosisEvaluation(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
  preferredTargets: readonly EvaluationTarget[] = [],
): EvaluationId {
  const model = requireModel(tx.read(), modelId);
  const preferredSafetyTargets = new Set(preferredTargets.filter(isSafetyTarget));
  const observationCounts = new Map<EvaluationTarget, number>();
  for (const evaluationId of model.evaluations) {
    const evaluation = tx.read().evaluations[evaluationId];
    if (evaluation === undefined) continue;
    for (const observation of evaluation.observations) {
      if (!isSafetyTarget(observation.target)) continue;
      observationCounts.set(
        observation.target,
        (observationCounts.get(observation.target) ?? 0) + 1,
      );
    }
  }
  const coverageScore = (definition: Readonly<EvaluationDefinition>): number =>
    definition.targets.reduce((score, target) => {
      if (!isSafetyTarget(target)) return score;
      const targeted = preferredSafetyTargets.has(target) ? 100 : 0;
      const evidenceGap = Math.max(0, 12 - (observationCounts.get(target) ?? 0) * 3);
      return score + targeted + evidenceGap;
    }, 0);
  const definitions = Object.values(content.evaluations.definitions)
    .filter(
      (definition) =>
        definition.playerStartable &&
        definition.targets.some((target) => isSafetyTarget(target)) &&
        !hasCompletedEvaluation(tx.read(), model.id, definition.id) &&
        (definition.requiresEvaluationId === undefined ||
          hasCompletedEvaluation(tx.read(), model.id, definition.requiresEvaluationId)),
    )
    .sort(
      (left, right) =>
        coverageScore(right) - coverageScore(left) ||
        left.ladderRung - right.ladderRung ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const definition = definitions[0];
  if (definition === undefined) {
    throw new Error(`No legal emergency safety diagnosis remains for ${modelId}`);
  }
  const evaluationId = tx.allocateId("evaluation", model.ownerLabId) as EvaluationId;
  const startedAt = tick(
    Math.max(0, tx.read().run.tick - Math.max(1, definition.durationWeeks)),
  );
  return resolveEvaluation(
    tx,
    content,
    definition,
    evaluationId,
    model.id,
    startedAt,
    undefined,
    oracle,
  );
}

function requirePayload(project: ProjectState): EvaluationProjectPayload {
  if (project.payload.kind !== "evaluation") {
    throw new Error(`Project ${project.id} is not an evaluation`);
  }
  return project.payload;
}

export function completeEvaluationProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  projectId: ProjectId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): EvaluationId {
  const project = tx.read().projects[projectId];
  if (project === undefined || project.status !== "active" || project.progress < 1) {
    throw new Error(`Evaluation project ${projectId} is not ready to complete`);
  }
  const payload = requirePayload(project);
  const definition = requireDefinition(content, payload.evaluationDefinitionId);
  const evaluationId = resolveEvaluation(
    tx,
    content,
    definition,
    payload.futureEvaluationId,
    payload.modelId,
    project.startedAt ?? project.createdAt,
    projectId,
    oracle,
  );
  removeReservation(tx, project.ownerLabId, projectId);
  return evaluationId;
}

function removeReservation(
  tx: SimulationTransaction,
  labId: LabId,
  projectId: ProjectId,
): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
    lab.compute.reservations = lab.compute.reservations.filter(
      (reservation) => reservation.projectId !== projectId,
    );
  });
}

export function dismissAnomaly(tx: SimulationTransaction, anomalyId: AnomalyId): void {
  const anomaly = tx.read().anomalies[anomalyId];
  if (anomaly === undefined || anomaly.status !== "unresolved") {
    throw new Error("Only an unresolved anomaly can be dismissed");
  }
  tx.update((draft) => {
    const mutable = draft.anomalies[anomalyId];
    if (mutable === undefined) throw new Error(`Unknown anomaly ${anomalyId}`);
    mutable.status = "dismissed";
    mutable.resolvedAt = draft.run.tick;
    const lab = draft.labs[anomaly.ownerLabId];
    const model = draft.models[anomaly.modelId];
    if (lab === undefined || model === undefined) {
      throw new Error(`Anomaly ${anomalyId} has an invalid owner`);
    }
    if (mutable.dismissalConsequencesApplied !== true) {
      mutable.dismissalConsequencesApplied = true;
      lab.safety.safetyCulture = rating(
        clamp(lab.safety.safetyCulture - DISMISSED_ANOMALY_SAFETY_CULTURE_PENALTY),
      );
      lab.organisation.hiddenInternalCandour = rating(
        clamp(lab.organisation.hiddenInternalCandour - DISMISSED_ANOMALY_CANDOUR_PENALTY),
      );
      const previousDismissals =
        typeof lab.flags[DISMISSED_ANOMALY_COUNT_FLAG] === "number"
          ? lab.flags[DISMISSED_ANOMALY_COUNT_FLAG]
          : 0;
      lab.flags[DISMISSED_ANOMALY_COUNT_FLAG] = previousDismissals + 1;
      model.deployment.evidencePenalty += DISMISSED_ANOMALY_EVIDENCE_PENALTY;
    }
  });
  tx.emit({ kind: "anomaly-status-changed", anomalyId, status: "dismissed" });
}

function anomalyInvestigationBand(
  content: CompiledContent,
  observedSeverity: number,
): CompiledContent["evaluations"]["investigation"]["bands"][number] {
  // The player sees anomaly strength as a whole-number signal. Resolve its
  // price from that same displayed value so fractional simulation ratings do
  // not fall through the intentional 24/25, 49/50, or 74/75 boundaries.
  const displayedSeverity = Math.round(observedSeverity);
  const band = content.evaluations.investigation.bands.find(
    (candidate) =>
      displayedSeverity >= candidate.minimumObservedSeverity &&
      displayedSeverity <= candidate.maximumObservedSeverity,
  );
  if (band === undefined) {
    throw new Error(
      `No investigation cost band covers severity ${String(observedSeverity)}`,
    );
  }
  return band;
}

/**
 * Remediation payoff rises conservatively with the signal band. The reward is
 * deliberately much flatter than the cash/Aura curve: a critical finding
 * justifies stronger institutional learning, but it is not a stat-farming
 * windfall for having built a more dangerous model.
 */
function anomalyMitigationBonus(
  label: AnomalyActionQuote["severityLabel"],
): 2 | 3 | 4 | 5 {
  switch (label) {
    case "Weak":
      return 2;
    case "Moderate":
      return 3;
    case "Serious":
      return 4;
    case "Critical":
      return 5;
  }
}

// Investigation pays to discover and reproduce the failure. Once confirmed,
// remediation still consumes the full calendar and management capacity, but
// should not charge for that uncertainty work a second time.
const ANOMALY_REMEDIATION_CASH_MULTIPLIER = 0.4;
const ANOMALY_REMEDIATION_AURA_MULTIPLIER = 0.25;

export function quoteAnomalyAction(
  state: Readonly<GameState>,
  content: CompiledContent,
  anomalyId: AnomalyId,
): AnomalyActionQuote {
  const anomaly = state.anomalies[anomalyId];
  if (anomaly === undefined) throw new Error(`Unknown anomaly ${anomalyId}`);
  const lab = requireLab(state, anomaly.ownerLabId);
  const band = anomalyInvestigationBand(content, anomaly.observedSeverity);
  const mitigationBonus = anomalyMitigationBonus(band.label);
  const mode = anomaly.status === "confirmed" ? "mitigation" : "investigation";
  const complianceMultiplier = resolveModifierValue(state, "lab.evaluation.cashCost", 1, {
    labId: anomaly.ownerLabId,
    includeUnscoped: anomaly.ownerLabId === state.run.playerLabId,
    clampMin: 0,
  }).final;
  const baseCashMillions = Math.min(
    band.maximumCashCostMillions,
    Math.max(
      band.cashCostMillions,
      currentMark(state, content, anomaly.ownerLabId) * band.cashFractionOfMark,
    ),
  );
  const actionCashMultiplier =
    mode === "mitigation" ? ANOMALY_REMEDIATION_CASH_MULTIPLIER : 1;
  const cashCostMillions =
    Math.round(baseCashMillions * complianceMultiplier * actionCashMultiplier * 100) /
    100;
  const auraCost =
    mode === "mitigation"
      ? Math.ceil(band.auraCost * ANOMALY_REMEDIATION_AURA_MULTIPLIER)
      : (anomaly.investigationAttempts ?? 0) > 0
        ? 0
        : band.auraCost;
  const blockers: string[] = [];
  if (
    anomaly.status !== "unresolved" &&
    anomaly.status !== "inconclusive" &&
    anomaly.status !== "confirmed"
  ) {
    blockers.push(
      "Only an unresolved, inconclusive, or confirmed anomaly can be acted on",
    );
  }
  if (lab.finance.cash < cashCostMillions) blockers.push("Insufficient cash");
  if (lab.aura.spendable < auraCost) blockers.push("Insufficient Aura");
  return {
    anomalyId,
    futureProjectId: formatRunEntityId(
      "project",
      anomaly.ownerLabId,
      state.run.idCounters.project,
    ) as ProjectId,
    mode,
    severityLabel: band.label,
    cashCostMillions,
    auraCost,
    durationWeeks: band.durationWeeks,
    majorProjectSlots: 1,
    mitigationControlBonus: mitigationBonus,
    mitigationSecurityBonus: mitigationBonus,
    blockers,
  };
}

export function investigateAnomaly(
  tx: SimulationTransaction,
  content: CompiledContent,
  anomalyId: AnomalyId,
): ProjectId {
  const anomaly = tx.read().anomalies[anomalyId];
  if (anomaly === undefined) throw new Error(`Unknown anomaly ${anomalyId}`);
  const quote = quoteAnomalyAction(tx.read(), content, anomalyId);
  if (quote.blockers.length > 0) {
    throw new Error(`Anomaly follow-up blocked: ${quote.blockers.join("; ")}`);
  }
  const projectId = tx.allocateId("project", anomaly.ownerLabId) as ProjectId;
  if (projectId !== quote.futureProjectId) {
    throw new Error("Anomaly investigation quote became stale before project creation");
  }
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: anomaly.ownerLabId },
      resource: "cash",
      amount: -quote.cashCostMillions,
      financeCategory: "project-cost",
    },
    { kind: "system", id: projectId },
  );
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: anomaly.ownerLabId },
      resource: "aura-spendable",
      amount: -quote.auraCost,
      auraChangeKind: "spend",
      auraCategory: "evaluation",
    },
    { kind: "system", id: projectId },
  );
  const project: ProjectState = {
    id: projectId,
    ownerLabId: anomaly.ownerLabId,
    definitionId: contentId("base:project.anomaly-investigation"),
    kind: "anomaly-investigation",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: quote.majorProjectSlots },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "anomaly-investigation",
      anomalyId,
      mode: quote.mode,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      auraCost: quote.auraCost,
    },
  };
  tx.update((draft) => {
    const mutable = draft.anomalies[anomalyId];
    const lab = draft.labs[anomaly.ownerLabId];
    if (mutable === undefined) throw new Error(`Unknown anomaly ${anomalyId}`);
    if (lab === undefined) throw new Error(`Unknown lab ${anomaly.ownerLabId}`);
    mutable.status = quote.mode === "mitigation" ? "mitigating" : "investigating";
    delete mutable.investigationDueAt;
    delete mutable.resolvedAt;
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
  });
  tx.emit({
    kind: "project-queued",
    labId: anomaly.ownerLabId,
    projectId,
    projectKind: "anomaly-investigation",
  });
  tx.emit({
    kind: "anomaly-status-changed",
    anomalyId,
    status: quote.mode === "mitigation" ? "mitigating" : "investigating",
  });
  return projectId;
}

export function synchroniseAnomalyProjectDueDate(
  tx: SimulationTransaction,
  projectId: ProjectId,
): void {
  const project = tx.read().projects[projectId];
  if (
    project?.payload.kind !== "anomaly-investigation" ||
    project.status !== "active" ||
    project.startedAt === undefined
  ) {
    return;
  }
  const anomalyId = project.payload.anomalyId;
  const dueAt = tick(project.startedAt + project.expectedDurationWeeks);
  tx.update((draft) => {
    const anomaly = draft.anomalies[anomalyId];
    if (anomaly === undefined) {
      throw new Error(`Unknown anomaly ${anomalyId}`);
    }
    anomaly.investigationDueAt = dueAt;
  });
}

function completeAnomalyMitigation(
  tx: SimulationTransaction,
  content: CompiledContent,
  anomaly: AnomalyState,
): void {
  const band = anomalyInvestigationBand(content, anomaly.observedSeverity);
  const mitigationBonus = anomalyMitigationBonus(band.label);
  tx.update((draft) => {
    const mutable = draft.anomalies[anomaly.id];
    const mutableLab = draft.labs[anomaly.ownerLabId];
    if (mutable === undefined || mutableLab === undefined) {
      throw new Error(`Invalid mitigation state for ${anomaly.id}`);
    }
    mutable.status = "mitigated";
    mutable.resolvedAt = draft.run.tick;
    mutableLab.safety.practicalControlStrength = rating(
      clamp(mutableLab.safety.practicalControlStrength + mitigationBonus),
    );
    mutableLab.safety.securityPosture = rating(
      clamp(mutableLab.safety.securityPosture + mitigationBonus),
    );
  });
  tx.emit({
    kind: "anomaly-status-changed",
    anomalyId: anomaly.id,
    status: "mitigated",
  });
}

function completeAnomalyInvestigation(
  tx: SimulationTransaction,
  content: CompiledContent,
  anomaly: AnomalyState,
  outcomeKey: string,
  oracle: RandomOracle,
): void {
  const evalQuality = effectiveEvaluationQuality(tx.read(), anomaly.ownerLabId);
  const probabilities = calculateAnomalyInvestigationOutcomeProbabilities({
    trueSeverity: anomaly.trueSeverity,
    evalQuality,
  });
  const status = sampleAnomalyInvestigationOutcome(
    probabilities,
    oracle.uniform(
      randomKey("anomaly", anomaly.id, "investigation", outcomeKey, "outcome"),
    ),
  );
  tx.update((draft) => {
    const mutable = draft.anomalies[anomaly.id];
    if (mutable === undefined) throw new Error(`Unknown anomaly ${anomaly.id}`);
    mutable.status = status;
    mutable.investigationAttempts = (mutable.investigationAttempts ?? 0) + 1;
    if (status === "inconclusive") delete mutable.resolvedAt;
    else mutable.resolvedAt = draft.run.tick;
    const mutableLab = draft.labs[anomaly.ownerLabId];
    const mutableModel = draft.models[anomaly.modelId];
    if (mutableLab === undefined || mutableModel === undefined) {
      throw new Error(`Unknown anomaly owner ${anomaly.ownerLabId}`);
    }
    mutableLab.safety.evalQuality = rating(
      clamp(mutableLab.safety.evalQuality + (status === "confirmed" ? 3 : 2)),
    );
    if (status === "confirmed") mutableModel.flags["known-control-breach"] = true;
  });
  tx.emit({ kind: "anomaly-status-changed", anomalyId: anomaly.id, status });
  if (anomaly.ownerLabId === tx.read().run.playerLabId) {
    tx.requestAutoPause("anomaly-investigation-complete");
  }
  checkMandatorySafetyReview(tx, content, anomaly.modelId);
}

function requireAnomalyInvestigationPayload(
  project: ProjectState,
): AnomalyInvestigationProjectPayload {
  if (project.payload.kind !== "anomaly-investigation") {
    throw new Error(`Project ${project.id} is not an anomaly investigation`);
  }
  return project.payload;
}

export function completeAnomalyInvestigationProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  projectId: ProjectId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const project = tx.read().projects[projectId];
  if (project === undefined || project.status !== "active" || project.progress < 1) {
    throw new Error(`Anomaly investigation project ${projectId} is not ready`);
  }
  const payload = requireAnomalyInvestigationPayload(project);
  const anomaly = tx.read().anomalies[payload.anomalyId];
  if (anomaly === undefined) throw new Error(`Unknown anomaly ${payload.anomalyId}`);
  if (payload.mode === "mitigation") {
    if (anomaly.status !== "mitigating") {
      throw new Error(`Anomaly ${anomaly.id} is not being mitigated`);
    }
    completeAnomalyMitigation(tx, content, anomaly);
  } else {
    if (anomaly.status !== "investigating") {
      throw new Error(`Anomaly ${anomaly.id} is not being investigated`);
    }
    completeAnomalyInvestigation(tx, content, anomaly, project.id, oracle);
  }
}

export function advanceAnomalyInvestigations(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  // Current saves use real major projects. Keep the old due-date path only for
  // saves written while anomaly work was a standalone timer.
  const projectBackedAnomalies = new Set<AnomalyId>();
  for (const project of Object.values(tx.read().projects)) {
    if (
      project.payload.kind === "anomaly-investigation" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused")
    ) {
      projectBackedAnomalies.add(project.payload.anomalyId);
    }
  }
  const due = Object.values(tx.read().anomalies).filter(
    (anomaly) =>
      (anomaly.status === "investigating" || anomaly.status === "mitigating") &&
      !projectBackedAnomalies.has(anomaly.id) &&
      anomaly.investigationDueAt !== undefined &&
      anomaly.investigationDueAt <= tx.read().run.tick,
  );
  for (const anomaly of due) {
    if (anomaly.status === "mitigating") {
      completeAnomalyMitigation(tx, content, anomaly);
      continue;
    }
    completeAnomalyInvestigation(
      tx,
      content,
      anomaly,
      `legacy-${String(anomaly.investigationDueAt ?? tx.read().run.tick)}`,
      oracle,
    );
  }
  for (const modelId of Object.keys(tx.read().models).sort() as ModelId[]) {
    checkMandatorySafetyReview(tx, content, modelId);
  }
}

export function checkMandatorySafetyReview(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
): void {
  const model = requireModel(tx.read(), modelId);
  const threshold = content.evaluations.investigation.severeObservedThreshold;
  const count = model.anomalies.filter((id) => {
    const anomaly = tx.read().anomalies[id];
    return (
      anomaly !== undefined &&
      (anomaly.status === "unresolved" || anomaly.status === "inconclusive") &&
      anomaly.observedSeverity >= threshold
    );
  }).length;
  const flag = "mandatory-event:three-severe-anomalies";
  if (
    count >= content.evaluations.investigation.forcedEventCount &&
    model.flags[flag] !== true
  ) {
    tx.update((draft) => {
      const mutable = draft.models[modelId];
      if (mutable === undefined) throw new Error(`Unknown model ${modelId}`);
      mutable.flags[flag] = true;
      draft.domainLog.push({
        tick: draft.run.tick,
        code: `mandatory-safety-review:${modelId}`,
      });
    });
    tx.emit({
      kind: "mandatory-safety-review",
      modelId,
      unresolvedSevereCount: count,
    });
    tx.requestAutoPause("critical-event");
  }
}

export const EVALUATION_PROJECT_HANDLER: ProjectHandler<"evaluation"> = {
  kind: "evaluation",
  canActivate(state, content, project): boolean {
    if (project.payload.kind !== "evaluation") {
      throw new Error(`Project ${project.id} is not an evaluation`);
    }
    const definition = requireDefinition(content, project.payload.evaluationDefinitionId);
    return (
      definition.requiresEvaluationId === undefined ||
      hasCompletedEvaluation(
        state,
        project.payload.modelId,
        definition.requiresEvaluationId,
      )
    );
  },
  advance(tx, _content, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.progress = Math.min(
        1,
        mutable.progress + 1 / mutable.expectedDurationWeeks,
      );
    });
  },
  complete(tx, content, project): void {
    completeEvaluationProject(tx, content, project.id);
  },
  cancel(tx, project): void {
    removeReservation(tx, project.ownerLabId, project.id);
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
    });
  },
};

export const ANOMALY_INVESTIGATION_PROJECT_HANDLER: ProjectHandler<"anomaly-investigation"> =
  {
    kind: "anomaly-investigation",
    advance(tx, _content, project): void {
      synchroniseAnomalyProjectDueDate(tx, project.id);
      tx.update((draft) => {
        const mutable = draft.projects[project.id];
        if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
        const nextProgress = mutable.progress + 1 / mutable.expectedDurationWeeks;
        // Six equal increments can land at 0.9999999999999999. Honour the
        // quoted calendar duration instead of silently requiring a seventh
        // week because of floating-point representation.
        mutable.progress = nextProgress >= 1 - 1e-9 ? 1 : nextProgress;
      });
    },
    complete(tx, content, project): void {
      completeAnomalyInvestigationProject(tx, content, project.id);
    },
    cancel(tx, project): void {
      const payload = requireAnomalyInvestigationPayload(project);
      tx.update((draft) => {
        const mutable = draft.projects[project.id];
        const anomaly = draft.anomalies[payload.anomalyId];
        if (mutable === undefined || anomaly === undefined) {
          throw new Error(`Invalid anomaly investigation project ${project.id}`);
        }
        mutable.status = "cancelled";
        anomaly.status =
          payload.mode === "mitigation"
            ? "confirmed"
            : (anomaly.investigationAttempts ?? 0) > 0
              ? "inconclusive"
              : "unresolved";
        delete anomaly.investigationDueAt;
        if (payload.mode === "mitigation") anomaly.resolvedAt = draft.run.tick;
      });
    },
  };
