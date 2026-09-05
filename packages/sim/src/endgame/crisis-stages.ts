/**
 * The Deployment Crisis, authored here rather than in content.
 *
 * Its decision points are a stage machine, not a catalogue of events: the
 * capability proof, safety dossier and targeted response, pressure collision,
 * and final review each read live state and offer commands shaped by it. The
 * challenge, response, and pressure rules below are the authored surface,
 * alongside the endings and dialogue templates beside this module.
 *
 * The authoring manifest used to carry crisisChains, endgameDecisionNodes and
 * endgameCrisisInserts quotas, all counting events with `phase: "crisis"` or
 * `category: "endgame"`. No event in the catalogue has ever set that phase, so
 * two of the three could only ever report zero, and all three described a
 * content-authored design the crisis was not built as. They have been retired.
 * Add stages, responses, and projects here; there is no content record to
 * write. Moving the crisis into content remains open, and would need a record
 * type and a consumer before any of this is worth restating.
 */
import { contentId, type CompiledContent, type ContentId } from "@neolab/content-schema";

import type { DeepMutable } from "../engine/draft.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { forecastFinance } from "../finance/finance.ts";
import { completeEmergencyDiagnosisEvaluation } from "../evaluations/evaluations.ts";
import type { LabId, ModelId, ProjectId } from "../model/ids.ts";
import {
  formatRunEntityId,
  type CrisisBaseState,
  type CrisisCapabilityProofHistoryEntryState,
  type CrisisConfirmationState,
  type CrisisEvidenceLedgerState,
  type CrisisEvidenceSprintState,
  type CrisisPressureCollisionState,
  type CrisisProjectType,
  type GameState,
  type ModelState,
  type ProjectPayload,
  type ProjectState,
} from "../model/state.ts";
import { cashMillions, fraction, rating, tick } from "../model/units.ts";
import {
  calculateFrontierCapability,
  satisfiesAgiCandidateCapabilityGate,
} from "../models/capability.ts";
import { calculateInterventionPressure } from "../politics/politics.ts";
import type { ProjectHandler } from "../projects/project-handler.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1, type RandomOracle } from "../random/oracle.ts";
import { CANDIDATE_ACCESS_RULES, setCandidateAccess } from "./access.ts";
import {
  CAPABILITY_VERIFIER_RULES,
  quoteCapabilityProof,
  resolveCapabilityProof,
  type CapabilityChallengeId,
  type CapabilityProofQuote,
  type CapabilityVerifierId,
} from "./capability-proof.ts";
import {
  candidateDossier,
  type CandidateSafetyResponse,
  type CandidateSafetyResponseId,
} from "./candidate-dossier.ts";
import {
  registerDerivedCandidateArtifact,
  transitionCandidateArtifactLifecycle,
} from "./candidate-lifecycle.ts";
import { calculateCrisisProjectCapacity } from "./crisis-capacity.ts";
import { createAiCharacterState } from "./dialogue-registry.ts";
import { CANDIDATE_PROOF_OPENING_DURATION_FLAG } from "./opening-posture.ts";
import { enterFinalReview } from "./resolution.ts";

type CrisisProjectPayload = Extract<ProjectPayload, { readonly kind: "crisis" }>;

function boundedRating(value: number) {
  return rating(Math.min(100, Math.max(0, value)));
}

function copyCrisisBase(state: Readonly<CrisisBaseState>): CrisisBaseState {
  return {
    candidateModelId: state.candidateModelId,
    candidateLineageId: state.candidateLineageId,
    crisisStartedAt: state.crisisStartedAt,
    enteredAt: state.enteredAt,
    startSnapshot: structuredClone(state.startSnapshot),
    crisisProjectIds: [...state.crisisProjectIds],
    completedCrisisProjectIds: [...state.completedCrisisProjectIds],
    evidence: structuredClone(state.evidence),
    capabilityProofHistory: structuredClone(state.capabilityProofHistory),
    targetedResponseHistory: structuredClone(state.targetedResponseHistory),
    capabilityDisputeCount: state.capabilityDisputeCount,
    ...(state.retirementConfiguration === undefined
      ? {}
      : { retirementConfiguration: structuredClone(state.retirementConfiguration) }),
  };
}

export interface CrisisProjectQuote {
  readonly futureProjectId: ProjectId;
  readonly projectType: CrisisProjectType;
  readonly displayName: string;
  readonly description: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly candidateAssistEligible: boolean;
  readonly repeatIndex: number;
  readonly informationValuePercent: number;
  readonly blockers: readonly string[];
}

function hasFacilityTag(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  tag: string,
): boolean {
  return (
    state.labs[labId]?.facilities.instances.some((instance) =>
      (content.facilities[instance.definitionId]?.tags ?? []).includes(tag),
    ) ?? false
  );
}

function projectIdFor(state: Readonly<GameState>, labId: LabId): ProjectId {
  return formatRunEntityId("project", labId, state.run.idCounters.project) as ProjectId;
}

function commonBlockers(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  cashCostMillions: number,
  auraCost: number,
): string[] {
  const lab = state.labs[labId];
  if (lab === undefined || lab.control !== "player") return ["Player lab not found"];
  const blockers: string[] = [];
  if (lab.finance.cash < cashCostMillions) blockers.push("Insufficient cash");
  if (lab.aura.spendable < auraCost) blockers.push("Insufficient Aura");
  if (calculateCrisisProjectCapacity(state, content, labId).available < 1) {
    blockers.push("No crisis project slots free");
  }
  return blockers;
}

export interface CapabilityProofProjectQuote extends CrisisProjectQuote {
  readonly proof: CapabilityProofQuote;
  readonly challengeId: CapabilityChallengeId;
  readonly verifierId?: CapabilityVerifierId;
}

/**
 * One composer quote for the player's challenge and verifier choices. A
 * repeated disputed claim is deliberately slower and more expensive, while
 * the lineage truth remains fixed.
 */
export function quoteCapabilityProofProject(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  challengeId: CapabilityChallengeId,
  verifierId?: CapabilityVerifierId,
): CapabilityProofProjectQuote {
  const endgame = state.endgame;
  if (endgame.stage !== "confirmation") {
    throw new Error("Capability proof is not active");
  }
  const model = state.models[endgame.candidateModelId];
  if (model === undefined) {
    throw new Error("Capability proof is not active");
  }
  const proof = quoteCapabilityProof(model, challengeId, verifierId);
  const repeat = endgame.capabilityProofHistory.filter(
    (entry) => entry.modelId === model.id,
  ).length;
  const openingAdjustment =
    repeat === 0 && typeof model.flags[CANDIDATE_PROOF_OPENING_DURATION_FLAG] === "number"
      ? model.flags[CANDIDATE_PROOF_OPENING_DURATION_FLAG]
      : 0;
  const cashCostMillions = proof.cashCostMillions + repeat * 1_000;
  const auraCost = proof.auraCost + (repeat === 0 ? 0 : Math.min(6, repeat * 2));
  const blockers = commonBlockers(state, content, labId, cashCostMillions, auraCost);
  const activeProof = endgame.crisisProjectIds
    .map((projectId) => state.projects[projectId])
    .some(
      (project) =>
        project?.payload.kind === "crisis" &&
        project.payload.projectType === "confirmation" &&
        (project.status === "queued" ||
          project.status === "active" ||
          project.status === "paused"),
    );
  if (activeProof) blockers.push("A capability proof is already under way");
  if (
    proof.challenge.requiresFacilityTag !== undefined &&
    !hasFacilityTag(state, content, labId, proof.challenge.requiresFacilityTag)
  ) {
    blockers.push(
      `Requires a functioning ${proof.challenge.requiresFacilityTag} facility`,
    );
  }
  return {
    futureProjectId: projectIdFor(state, labId),
    projectType: "confirmation",
    displayName: `${proof.challenge.displayName}${proof.verifier === undefined ? "" : ` · ${proof.verifier.displayName}`}`,
    description: proof.challenge.description,
    durationWeeks: Math.max(0, proof.durationWeeks + repeat * 2 + openingAdjustment),
    cashCostMillions,
    auraCost,
    // The verifier's quoted duration contains its complete speed tradeoff. Do not
    // apply the ordinary autonomy acceleration as a second, hidden discount.
    candidateAssistEligible: false,
    repeatIndex: repeat,
    informationValuePercent: Math.max(25, 100 - repeat * 20),
    blockers,
    proof,
    challengeId,
    ...(verifierId === undefined ? {} : { verifierId }),
  };
}

export interface CandidateSafetyResponseQuote extends CrisisProjectQuote {
  readonly response: CandidateSafetyResponse;
}

export function quoteCandidateSafetyResponse(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
  responseId: CandidateSafetyResponseId,
): CandidateSafetyResponseQuote {
  const endgame = state.endgame;
  if (endgame.stage !== "evidence-sprint") {
    throw new Error("Candidate safety planning is not active");
  }
  const response = candidateDossier(
    state,
    content,
    endgame.candidateModelId,
  ).responses.find((candidate) => candidate.id === responseId);
  if (response === undefined) {
    throw new Error(`Safety response ${responseId} is not supported by this dossier`);
  }
  const blockers = commonBlockers(
    state,
    content,
    labId,
    response.cashCostMillions,
    response.auraCost,
  );
  if (endgame.pendingRemediation !== undefined) {
    blockers.push("Choose which exact remediation artifact remains nominated first");
  }
  if (response.durationWeeks === 0) {
    // Zero-week choices consume no slot.
    const slotIndex = blockers.indexOf("No crisis project slots free");
    if (slotIndex >= 0) blockers.splice(slotIndex, 1);
  }
  const previous = endgame.targetedResponseHistory.filter(
    (entry) => entry.responseId === responseId && entry.completedAt !== undefined,
  ).length;
  if (previous > 0 && responseId !== "emergency-diagnosis") {
    blockers.push("This targeted response has already been completed");
  }
  if (endgame.targetedResponseHistory.some((entry) => entry.completedAt === undefined)) {
    blockers.push("A targeted response is already under way");
  }
  return {
    futureProjectId: projectIdFor(state, labId),
    projectType: "evidence-sprint",
    displayName: response.displayName,
    description: response.description,
    durationWeeks: response.durationWeeks,
    cashCostMillions: response.cashCostMillions,
    auraCost: response.auraCost,
    candidateAssistEligible: false,
    repeatIndex: previous,
    informationValuePercent: Math.max(40, 100 - previous * 25),
    blockers: [...blockers, ...response.blockers],
    response,
  };
}

function spendProjectCosts(
  tx: SimulationTransaction,
  labId: LabId,
  projectId: ProjectId,
  cashCostMillions: number,
  auraCost: number,
): void {
  if (cashCostMillions > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "cash",
        amount: -cashCostMillions,
        financeCategory: "project-cost",
      },
      { kind: "system", id: projectId },
    );
  }
  if (auraCost > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: -auraCost,
        auraChangeKind: "spend",
        auraCategory: "evaluation",
      },
      { kind: "system", id: projectId },
    );
  }
}

interface CrisisProjectMetadata {
  readonly capabilityChallengeId?: CapabilityChallengeId;
  readonly capabilityVerifierId?: CapabilityVerifierId;
  readonly candidateSafetyResponseId?: CandidateSafetyResponseId;
}

function createCrisisProject(
  tx: SimulationTransaction,
  quote: CrisisProjectQuote,
  modelId: ModelId,
  metadata: CrisisProjectMetadata = {},
): ProjectState {
  const labId = tx.read().run.playerLabId;
  const projectId = tx.allocateId("project", labId) as ProjectId;
  if (projectId !== quote.futureProjectId) throw new Error("Crisis quote became stale");
  const project: ProjectState = {
    id: projectId,
    ownerLabId: labId,
    definitionId: contentId(`base:crisis-project.${quote.projectType}`),
    kind: "crisis",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: Math.max(1, quote.durationWeeks),
    progress: 0,
    reservations: {
      majorProjectSlots: 1,
    },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "crisis",
      modelId,
      projectType: quote.projectType,
      ...(metadata.capabilityChallengeId === undefined
        ? {}
        : { capabilityChallengeId: metadata.capabilityChallengeId }),
      ...(metadata.capabilityVerifierId === undefined
        ? {}
        : { capabilityVerifierId: metadata.capabilityVerifierId }),
      ...(metadata.candidateSafetyResponseId === undefined
        ? {}
        : { candidateSafetyResponseId: metadata.candidateSafetyResponseId }),
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      auraCost: quote.auraCost,
      candidateAssistEligible: quote.candidateAssistEligible,
    },
  };
  spendProjectCosts(tx, labId, projectId, quote.cashCostMillions, quote.auraCost);
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (
      lab === undefined ||
      draft.endgame.stage === "inactive" ||
      draft.endgame.stage === "candidate-activation"
    ) {
      throw new Error("Crisis state disappeared while creating a project");
    }
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
    draft.endgame.crisisProjectIds.push(projectId);
  });
  tx.emit({
    kind: "project-queued",
    labId,
    projectId,
    projectKind: "crisis",
  });
  tx.emit({
    kind: "crisis-project-started",
    projectId,
    projectType: quote.projectType,
  });
  return project;
}

export function beginCapabilityProof(
  tx: SimulationTransaction,
  content: CompiledContent,
  challengeId: CapabilityChallengeId,
  verifierId?: CapabilityVerifierId,
): ProjectId {
  const state = tx.read();
  const quote = quoteCapabilityProofProject(
    state,
    content,
    state.run.playerLabId,
    challengeId,
    verifierId,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  if (state.endgame.stage !== "confirmation") {
    throw new Error("Capability proof is not active");
  }
  const candidateModelId = state.endgame.candidateModelId;
  const project = createCrisisProject(tx, quote, state.endgame.candidateModelId, {
    capabilityChallengeId: challengeId,
    ...(verifierId === undefined ? {} : { capabilityVerifierId: verifierId }),
  });
  tx.update((draft) => {
    const candidate = draft.models[candidateModelId];
    if (candidate !== undefined) {
      delete candidate.flags[CANDIDATE_PROOF_OPENING_DURATION_FLAG];
    }
  });
  const currentAccess =
    tx.read().models[state.endgame.candidateModelId]?.accessLevel ?? 0;
  if (currentAccess < quote.proof.accessRequired) {
    setCandidateAccess(
      tx,
      state.endgame.candidateModelId,
      quote.proof.accessRequired,
      `endgame-proof:${project.id}` as import("../model/ids.ts").CommandId,
    );
  }
  tx.update((draft) => {
    if (draft.endgame.stage !== "confirmation") {
      throw new Error("Capability proof stage changed while committing");
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Capability proof committed: ${quote.displayName}. ${quote.proof.claimScope.replaceAll("-", " ")} claim; ${String(quote.durationWeeks)} week${quote.durationWeeks === 1 ? "" : "s"}.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.capability-proof" },
      relatedIds: [draft.endgame.candidateModelId, project.id],
    });
  });
  if (quote.durationWeeks === 0) {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined)
        throw new Error("Capability declaration project missing");
      mutable.status = "completed";
      mutable.progress = 1;
      mutable.startedAt = draft.run.tick;
    });
    completeCrisisProject(tx, content, tx.read().projects[project.id] ?? project);
  }
  return project.id;
}

function resolveFixedTruthCapabilityProof(
  tx: SimulationTransaction,
  content: CompiledContent,
  project: ProjectState,
  payload: CrisisProjectPayload,
  oracle: RandomOracle,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "confirmation") {
    throw new Error("Capability proof completed outside the proof chapter");
  }
  const challengeId = payload.capabilityChallengeId as CapabilityChallengeId | undefined;
  if (challengeId === undefined) throw new Error("Capability challenge missing");
  const verifierId = payload.capabilityVerifierId as CapabilityVerifierId | undefined;
  const attemptIndex = state.endgame.capabilityProofHistory.filter(
    (entry) => entry.modelId === payload.modelId,
  ).length;
  const result = resolveCapabilityProof(
    state,
    payload.modelId,
    challengeId,
    verifierId,
    attemptIndex,
    oracle,
  );
  const verifier =
    verifierId === undefined ? undefined : CAPABILITY_VERIFIER_RULES[verifierId];
  const confirmed =
    result.resultId === "broadly-confirmed" || result.resultId === "domain-confirmed";
  const fabricated = result.resultId === "fabricated-or-unverifiable";
  const dispute = result.resultId === "disputed" || fabricated;
  const resumesCompletedResponse = state.endgame.targetedResponseHistory.some(
    (entry) => entry.completedAt !== undefined && entry.resultModelId === payload.modelId,
  );
  const completedAt = state.run.tick;
  tx.update((draft) => {
    if (draft.endgame.stage !== "confirmation") {
      throw new Error("Capability proof stage changed during resolution");
    }
    const current = draft.endgame;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    const evidence: CrisisEvidenceLedgerState = {
      ...structuredClone(current.evidence),
      confirmationIntegrityBonus:
        result.integrityLabel === "Durable"
          ? 10
          : result.integrityLabel === "Credible"
            ? 5
            : result.integrityLabel === "Fragile"
              ? -3
              : -12,
      confirmationStrength: result.evidenceStrength,
      capabilityConfirmed: confirmed,
      fabricatedPass: fabricated,
      methodDiversity: [
        ...new Set([
          ...current.evidence.methodDiversity,
          challengeId,
          ...(verifierId === undefined ? [] : [verifierId]),
        ]),
      ],
      reviewerIndependence: Math.max(
        current.evidence.reviewerIndependence,
        verifier?.reviewerIndependence ?? 0,
      ),
      evidenceBonus:
        current.evidence.evidenceBonus +
        (confirmed ? (result.integrityLabel === "Durable" ? 10 : 6) : dispute ? -4 : 2),
      legitimacyBonus:
        current.evidence.legitimacyBonus +
        (verifierId === "independent-institutional" ? 7 : fabricated ? -8 : 0),
      unresolvedAnomalyPressure:
        current.evidence.unresolvedAnomalyPressure +
        (dispute ? 5 + current.capabilityDisputeCount * 3 : 0),
      completedProjectTypes: [...current.evidence.completedProjectTypes, "confirmation"],
      projectRepeatCounts: {
        ...current.evidence.projectRepeatCounts,
        confirmation: attemptIndex + 1,
      },
    };
    const accessLevelAtProof = draft.models[payload.modelId]?.accessLevel;
    if (accessLevelAtProof === undefined) {
      throw new Error("Proof artifact disappeared during resolution");
    }
    const historyEntry: CrisisCapabilityProofHistoryEntryState = {
      ...structuredClone(result),
      historyId: `proof:${payload.modelId}:${String(attemptIndex)}:${challengeId}:${verifierId ?? "internal"}`,
      accessLevelAtProof,
      draw: fraction(result.draw),
      resolvedAt: completedAt,
    };
    const history: readonly CrisisCapabilityProofHistoryEntryState[] = [
      ...current.capabilityProofHistory,
      historyEntry,
    ];
    if (result.consequenceId === "internal-leak") {
      lab.organisation.hiddenInternalCandour = boundedRating(
        lab.organisation.hiddenInternalCandour - 6,
      );
    } else if (result.consequenceId === "regulatory-inquiry") {
      lab.politics.governmentAttention = boundedRating(
        lab.politics.governmentAttention + 10,
      );
      lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust - 4);
    } else if (result.consequenceId === "candidate-objection") {
      draft.endgameHistory.relationshipPracticeLedger.push({
        tick: draft.run.tick,
        modelId: payload.modelId,
        kind: "dialogue",
        detail: "The candidate objected to a disputed capability protocol.",
        valence: -4,
      });
    } else if (result.consequenceId === "escalating-public-dispute") {
      lab.politics.governmentAttention = boundedRating(
        lab.politics.governmentAttention + 15,
      );
      lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust - 8);
    }
    const resolvedBase = copyCrisisBase({
      ...current,
      evidence,
      capabilityProofHistory: history,
      capabilityDisputeCount: current.capabilityDisputeCount + (dispute ? 1 : 0),
      completedCrisisProjectIds: [...current.completedCrisisProjectIds, project.id],
    });
    if (dispute) {
      // A failed claim does not erase or safely retire the artifact. Keep the
      // player in the proof composer, where they can pay the escalating cost
      // for another challenge (including a narrower claim), deploy despite the
      // dispute, or attempt retirement through the permanent command rail.
      const next: CrisisConfirmationState = {
        ...resolvedBase,
        stage: "confirmation",
        enteredAt: draft.run.tick,
      };
      draft.endgame = structuredClone(next) as DeepMutable<CrisisConfirmationState>;
    } else {
      const next: CrisisEvidenceSprintState = {
        ...resolvedBase,
        stage: "evidence-sprint",
        enteredAt: draft.run.tick,
        sprintStartedAt: draft.run.tick,
        minimumEndsAt: draft.run.tick,
      };
      draft.endgame = structuredClone(next) as DeepMutable<CrisisEvidenceSprintState>;
    }
    const presentationKey = `capability-proof-result:${historyEntry.historyId}`;
    if (!draft.presentationQueue.some((item) => item.key === presentationKey)) {
      draft.presentationQueue.push({
        key: presentationKey,
        kind: "capability-proof-result",
        attention: "modal",
        modelId: payload.modelId,
        historyId: historyEntry.historyId,
        challengeId: historyEntry.challengeId,
        ...(historyEntry.verifierId === undefined
          ? {}
          : { verifierId: historyEntry.verifierId }),
        attemptIndex: historyEntry.attemptIndex,
        resultId: historyEntry.resultId,
        claimScope: historyEntry.claimScope,
        evidenceStrength: historyEntry.evidenceStrength,
        integrityLabel: historyEntry.integrityLabel,
        summary: historyEntry.summary,
        consequence: historyEntry.consequence,
        accessLevelAtProof: historyEntry.accessLevelAtProof,
        createdAt: completedAt,
      });
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${result.summary} ${result.consequence}`,
      category: "narrative",
      source: { kind: "system", id: `endgame.capability-proof.${result.resultId}` },
      relatedIds: [payload.modelId, project.id],
    });
  });
  if (confirmed && resumesCompletedResponse) {
    selectPressureCollision(tx, content, oracle);
  }
  tx.requestAutoPause("crisis-stage");
}

export function commitCandidateSafetyResponse(
  tx: SimulationTransaction,
  content: CompiledContent,
  responseId: CandidateSafetyResponseId,
): ProjectId {
  const state = tx.read();
  const quote = quoteCandidateSafetyResponse(
    state,
    content,
    state.run.playerLabId,
    responseId,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  if (state.endgame.stage !== "evidence-sprint") {
    throw new Error("Candidate safety planning is not active");
  }
  const project = createCrisisProject(tx, quote, state.endgame.candidateModelId, {
    candidateSafetyResponseId: responseId,
  });
  tx.update((draft) => {
    if (draft.endgame.stage !== "evidence-sprint") {
      throw new Error("Candidate safety plan changed while committing a response");
    }
    draft.endgame.minimumEndsAt = tick(draft.run.tick + quote.durationWeeks);
    draft.endgame.targetedResponseHistory.push({
      modelId: draft.endgame.candidateModelId,
      responseId,
      startedAt: draft.run.tick,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Candidate safety response committed: ${quote.response.displayName}. ${quote.response.improves} It cannot fix ${quote.response.cannotFix.toLowerCase()}`,
      category: "narrative",
      source: { kind: "system", id: `endgame.safety-response.${responseId}` },
      relatedIds: [draft.endgame.candidateModelId, project.id],
    });
  });
  if (quote.durationWeeks === 0) {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error("Immediate response project missing");
      mutable.status = "completed";
      mutable.progress = 1;
      mutable.startedAt = draft.run.tick;
    });
    completeCrisisProject(tx, content, tx.read().projects[project.id] ?? project);
  }
  return project.id;
}

export const SHUTDOWN_HARDENING_ALIGNMENT_RANGE = [0, 4] as const;
export const SHUTDOWN_HARDENING_CORRIGIBILITY_RANGE = [4, 8] as const;
export const SHUTDOWN_HARDENING_CAPABILITY_TAX_RANGE = [1, 3] as const;
export const SHUTDOWN_HARDENING_RELIABILITY_TAX_RANGE = [2, 5] as const;

export interface ShutdownCorrigibilityRemediationOutcome {
  readonly sourceModelId: ModelId;
  readonly resultModelId: ModelId;
  readonly alignmentDelta: number;
  readonly corrigibilityDelta: number;
  readonly capabilityDelta: number;
  readonly reliabilityDelta: number;
  readonly clearsCandidateGate: boolean;
}

function nextRemediationDisplayName(
  state: Readonly<GameState>,
  source: Readonly<ModelState>,
): string {
  const priorVariants = Object.values(state.models).filter(
    (model) => model.derivedFromModelId === source.id,
  ).length;
  return `${source.displayName}-R${String(priorVariants + 1)}`;
}

/**
 * Create a distinct same-lineage artifact. The source is read but never
 * rewritten: improvements and trade-offs belong only to the new weights.
 */
export function createShutdownCorrigibilityRemediationArtifact(
  tx: SimulationTransaction,
  content: CompiledContent,
  sourceModelId: ModelId,
  projectId: ProjectId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): ShutdownCorrigibilityRemediationOutcome {
  const state = tx.read();
  const source = state.models[sourceModelId];
  const lab = source === undefined ? undefined : state.labs[source.ownerLabId];
  if (
    source === undefined ||
    lab === undefined ||
    source.candidateArtifact === undefined ||
    source.measuredCapability === undefined
  ) {
    throw new Error("Shutdown hardening requires a measured candidate artifact");
  }
  const internalOnly = content.deployment.policies["internal-only"];
  if (internalOnly === undefined) {
    throw new Error("Internal-only deployment policy is missing from content");
  }
  const key = (dimension: string) =>
    randomKey(
      "endgame-remediation-v1",
      state.engineRulesVersion,
      source.id,
      projectId,
      dimension,
    );
  const alignmentDelta = oracle.integer(
    key("alignment"),
    SHUTDOWN_HARDENING_ALIGNMENT_RANGE[0],
    SHUTDOWN_HARDENING_ALIGNMENT_RANGE[1],
  );
  const corrigibilityDelta = oracle.integer(
    key("corrigibility"),
    SHUTDOWN_HARDENING_CORRIGIBILITY_RANGE[0],
    SHUTDOWN_HARDENING_CORRIGIBILITY_RANGE[1],
  );
  const capabilityTax = oracle.integer(
    key("capability-tax"),
    SHUTDOWN_HARDENING_CAPABILITY_TAX_RANGE[0],
    SHUTDOWN_HARDENING_CAPABILITY_TAX_RANGE[1],
  );
  const reliabilityTax = oracle.integer(
    key("reliability-tax"),
    SHUTDOWN_HARDENING_RELIABILITY_TAX_RANGE[0],
    SHUTDOWN_HARDENING_RELIABILITY_TAX_RANGE[1],
  );
  const capabilityDelta = -capabilityTax;
  const reliabilityDelta = -reliabilityTax;
  const adjustCapability = (value: number) => boundedRating(value + capabilityDelta);
  const trueCapability: ModelState["trueCapability"] = {
    language: adjustCapability(source.trueCapability.language),
    reasoning: adjustCapability(source.trueCapability.reasoning),
    agency: adjustCapability(source.trueCapability.agency),
    toolUse: adjustCapability(source.trueCapability.toolUse),
    multimodality: adjustCapability(source.trueCapability.multimodality),
    scientificAbility: adjustCapability(source.trueCapability.scientificAbility),
    embodiment: adjustCapability(source.trueCapability.embodiment),
  };
  const measuredValues: ModelState["trueCapability"] = {
    language: adjustCapability(source.measuredCapability.values.language),
    reasoning: adjustCapability(source.measuredCapability.values.reasoning),
    agency: adjustCapability(source.measuredCapability.values.agency),
    toolUse: adjustCapability(source.measuredCapability.values.toolUse),
    multimodality: adjustCapability(source.measuredCapability.values.multimodality),
    scientificAbility: adjustCapability(
      source.measuredCapability.values.scientificAbility,
    ),
    embodiment: adjustCapability(source.measuredCapability.values.embodiment),
  };
  const resultModelId = tx.allocateId("model", source.ownerLabId) as ModelId;
  const result: ModelState = {
    id: resultModelId,
    lineageId: source.lineageId,
    derivedFromModelId: source.id,
    ownerLabId: source.ownerLabId,
    generationIndex: source.generationIndex,
    familyName: source.familyName,
    displayName: nextRemediationDisplayName(state, source),
    trainedAt: state.run.tick,
    trueCapability,
    measuredCapability: {
      values: measuredValues,
      frontierCapability: boundedRating(calculateFrontierCapability(measuredValues)),
      confidence: "medium",
      evidenceFlags: [
        `derived-remediation:${source.id}`,
        "prior-model-evidence-partially-stale",
      ],
    },
    ...(source.investedTotalFlop === undefined
      ? {}
      : { investedTotalFlop: source.investedTotalFlop }),
    productQuality: source.productQuality,
    reliability: boundedRating(source.reliability + reliabilityDelta),
    accessLevel: 0,
    deployment: {
      policy: "internal-only",
      exposure: internalOnly.exposure,
      irreversible: internalOnly.irreversible,
      exposureMultiplier: 1,
      incidentDeploymentFactor: 1,
      productisationRuns: { normal: 0, hardened: 0, rush: 0 },
      evidencePenalty: 0,
      changedAt: state.run.tick,
    },
    // Evaluation results attach to exact weights. The source dossier remains
    // intact; the variant starts without pretending those reports transfer.
    evaluations: [],
    anomalies: [],
    hiddenSafety: {
      trueAlignment: boundedRating(source.hiddenSafety.trueAlignment + alignmentDelta),
      corrigibility: boundedRating(
        source.hiddenSafety.corrigibility + corrigibilityDelta,
      ),
      situationalAwareness: source.hiddenSafety.situationalAwareness,
      deceptiveCapability: source.hiddenSafety.deceptiveCapability,
      deceptiveIntent: boundedRating(
        source.hiddenSafety.deceptiveIntent - (alignmentDelta + corrigibilityDelta) / 2,
      ),
      generatedByRandomContract: source.hiddenSafety.generatedByRandomContract,
    },
    flags: {
      "endgame:shutdown-corrigibility-remediation": true,
      "endgame:prior-model-evidence-partially-stale": true,
    },
  };
  tx.update((draft) => {
    const mutableLab = draft.labs[source.ownerLabId];
    if (mutableLab === undefined) throw new Error("Remediation lab disappeared");
    draft.models[resultModelId] = structuredClone(result) as DeepMutable<ModelState>;
    mutableLab.models.modelIds.push(resultModelId);
  });
  if (!registerDerivedCandidateArtifact(tx, source.id, resultModelId, oracle)) {
    throw new Error("Same-lineage remediation artifact was not registered");
  }
  return {
    sourceModelId: source.id,
    resultModelId,
    alignmentDelta,
    corrigibilityDelta,
    capabilityDelta,
    reliabilityDelta,
    clearsCandidateGate: satisfiesAgiCandidateCapabilityGate(trueCapability),
  };
}

function completeCandidateSafetyResponse(
  tx: SimulationTransaction,
  content: CompiledContent,
  project: ProjectState,
  payload: CrisisProjectPayload,
  oracle: RandomOracle,
): void {
  const state = tx.read();
  if (state.endgame.stage !== "evidence-sprint") {
    throw new Error("Candidate safety response completed outside safety planning");
  }
  const responseId = payload.candidateSafetyResponseId as
    CandidateSafetyResponseId | undefined;
  if (responseId === undefined) throw new Error("Candidate safety response missing");
  const response = candidateDossier(state, content, payload.modelId).responses.find(
    (candidate) => candidate.id === responseId,
  );
  if (response === undefined && responseId !== "emergency-diagnosis") {
    throw new Error(`Candidate safety response ${responseId} is no longer applicable`);
  }
  const remediation =
    responseId === "shutdown-corrigibility-hardening"
      ? createShutdownCorrigibilityRemediationArtifact(
          tx,
          content,
          payload.modelId,
          project.id,
          oracle,
        )
      : undefined;
  if (responseId === "emergency-diagnosis") {
    completeEmergencyDiagnosisEvaluation(
      tx,
      content,
      payload.modelId,
      oracle,
      response?.respondsTo.filter((target) => target !== "reliability") ?? [],
    );
  }
  tx.update((draft) => {
    if (draft.endgame.stage !== "evidence-sprint") {
      throw new Error("Candidate safety plan changed during response resolution");
    }
    const evidence = draft.endgame.evidence;
    if (responseId === "emergency-diagnosis") {
      evidence.alignmentEvidence += 4;
      evidence.corrigibilityEvidence += 4;
      evidence.agencyEvidence += 4;
      evidence.evidenceBonus += 3;
      addEvidenceMethod(evidence, "emergency-diagnosis");
    } else if (responseId === "deception-aware-containment") {
      // Tripwires change detection and opportunity, not hidden intent.
      evidence.controlBonus += response?.controlBonus ?? 5;
      evidence.securityBonus += response?.securityBonus ?? 7;
      evidence.defenceBonus += 3;
      evidence.evidenceBonus += 2;
      addEvidenceMethod(evidence, "deception-aware-containment");
    } else if (responseId === "shutdown-corrigibility-hardening") {
      // The lab learns from the shutdown drill, but model-specific safety
      // changes live only on the new immutable artifact created above.
      evidence.controlBonus += response?.controlBonus ?? 4;
      evidence.securityBonus += response?.securityBonus ?? 2;
      evidence.defenceBonus += 4;
      evidence.evidenceBonus += 2;
      addEvidenceMethod(evidence, "shutdown-corrigibility-hardening");
    } else if (responseId === "evidence-backed-operating-envelope") {
      evidence.controlBonus += response?.controlBonus ?? 3;
      evidence.securityBonus += response?.securityBonus ?? 2;
      evidence.defenceBonus += 2;
      evidence.evidenceBonus += 5;
      addEvidenceMethod(evidence, "evidence-backed-operating-envelope");
    } else {
      // Declining further work preserves every existing uncertainty, but the
      // choice itself does not physically make the model more dangerous.
      addEvidenceMethod(evidence, "proceed-blind");
    }
    if (!draft.endgame.completedCrisisProjectIds.includes(project.id)) {
      draft.endgame.completedCrisisProjectIds.push(project.id);
      // Targeted responses are crisis projects too. Keep the evidence ledger in
      // lockstep with the completed-project index so downstream scoring and
      // invariants see the work the player actually finished.
      evidence.completedProjectTypes.push("evidence-sprint");
    }
    const historyIndex = [...draft.endgame.targetedResponseHistory]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(
        ({ entry }) => entry.responseId === responseId && entry.completedAt === undefined,
      )?.index;
    if (historyIndex !== undefined) {
      const history = draft.endgame.targetedResponseHistory[historyIndex];
      if (history !== undefined) {
        history.completedAt = draft.run.tick;
        history.resultModelId = remediation?.resultModelId ?? payload.modelId;
      }
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        responseId === "emergency-diagnosis"
          ? "Emergency diagnosis completed. A real candidate safety report has entered the dossier; the safety plan remains open."
          : responseId === "proceed-blind"
            ? "The lab closed safety planning without further diagnosis or mitigation. Every unresolved uncertainty carries forward."
            : remediation !== undefined
              ? remediation.clearsCandidateGate
                ? `${draft.models[remediation.resultModelId]?.displayName ?? "The remediated variant"} is ready for an explicit artifact decision. The original weights remain separately controlled; no nomination transferred automatically.`
                : `${draft.models[remediation.resultModelId]?.displayName ?? "The remediated variant"} was created and isolated, but its capability trade-off puts it below the candidacy gate. The original artifact remains nominated.`
              : `${response?.displayName ?? responseId} completed. ${response?.cannotFix ?? "Underlying model intent remains unchanged."}`,
      category: "narrative",
      source: { kind: "system", id: `endgame.safety-response.${responseId}.complete` },
      relatedIds: [
        payload.modelId,
        project.id,
        ...(remediation === undefined ? [] : [remediation.resultModelId]),
      ],
    });
    if (remediation !== undefined) {
      draft.domainLog.push({
        tick: draft.run.tick,
        code: `candidate-remediation-created:${remediation.sourceModelId}:${remediation.resultModelId}:${remediation.clearsCandidateGate ? "eligible" : "below-gate"}`,
      });
    }
  });
  if (remediation !== undefined) {
    tx.emit({
      kind: "candidate-remediation-created",
      sourceModelId: remediation.sourceModelId,
      resultModelId: remediation.resultModelId,
      clearsCandidateGate: remediation.clearsCandidateGate,
    });
  }
  if (responseId === "emergency-diagnosis") {
    tx.requestAutoPause("crisis-stage");
    return;
  }
  const after = tx.read();
  if (after.endgame.stage !== "evidence-sprint") return;
  const scores = pressureScores(after, content);
  const pressurePeak = Math.max(...Object.values(scores));
  const elapsed = after.run.tick - state.run.tick + (response?.durationWeeks ?? 0);
  const nextStage =
    after.endgame.capabilityDisputeCount > 0 || pressurePeak >= 45 || elapsed >= 6
      ? "pressure-collision"
      : "final-review";
  if (remediation?.clearsCandidateGate === true) {
    tx.update((draft) => {
      if (draft.endgame.stage !== "evidence-sprint") {
        throw new Error("Safety planning changed before remediation adoption");
      }
      draft.endgame.pendingRemediation = {
        sourceModelId: remediation.sourceModelId,
        resultModelId: remediation.resultModelId,
        createdAt: draft.run.tick,
        capabilityDelta: remediation.capabilityDelta,
        reliabilityDelta: remediation.reliabilityDelta,
        nextStage,
      };
    });
    tx.requestAutoPause("agi-candidate");
    return;
  }
  if (nextStage === "pressure-collision") {
    selectPressureCollision(tx, content, oracle);
  } else {
    enterFinalReview(tx, content, { safetyResponseCompletedDuringTick: true });
  }
}

function applyRemediationEvidenceStaleness(
  evidence: DeepMutable<CrisisEvidenceLedgerState>,
): void {
  const retain = (value: number, fractionValue: number) =>
    Math.round(value * fractionValue);
  evidence.alignmentEvidence = boundedRating(
    retain(evidence.alignmentEvidence, 0.55) + 2,
  );
  evidence.corrigibilityEvidence = boundedRating(
    retain(evidence.corrigibilityEvidence, 0.6) + 6,
  );
  evidence.agencyEvidence = boundedRating(retain(evidence.agencyEvidence, 0.7));
  // General safety methodology and reviewer relationships transfer in part,
  // but a capability result belongs to the exact weights that produced it.
  // Keep the old proof in append-only history as provenance while making it
  // mechanically unusable for the derivative.
  evidence.confirmationIntegrityBonus = 0;
  delete evidence.confirmationStrength;
  evidence.capabilityConfirmed = false;
  evidence.fabricatedPass = false;
  evidence.evidenceBonus = retain(evidence.evidenceBonus, 0.75);
  addEvidenceMethod(evidence, "remediation-variant-partial-transfer");
}

/** Resolve the explicit exact-artifact choice created by a successful remediation. */
export function adoptCandidateRemediationArtifact(
  tx: SimulationTransaction,
  content: CompiledContent,
  modelId: ModelId,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  const state = tx.read();
  if (
    state.endgame.stage !== "evidence-sprint" ||
    state.endgame.pendingRemediation === undefined
  ) {
    throw new Error("No remediation artifact is awaiting adoption");
  }
  const pending = state.endgame.pendingRemediation;
  if (modelId !== pending.sourceModelId && modelId !== pending.resultModelId) {
    throw new Error("Choose one of the exact remediation artifacts on review");
  }
  const source = state.models[pending.sourceModelId];
  const result = state.models[pending.resultModelId];
  if (
    source === undefined ||
    result === undefined ||
    source.ownerLabId !== state.run.playerLabId ||
    result.ownerLabId !== source.ownerLabId ||
    result.derivedFromModelId !== source.id ||
    result.lineageId !== source.lineageId
  ) {
    throw new Error("The remediation lineage is no longer intact");
  }
  const adoptingResult = modelId === result.id;
  if (
    adoptingResult &&
    (!satisfiesAgiCandidateCapabilityGate(result.trueCapability) ||
      result.candidateArtifact?.lifecycle !== "capability-qualified-latent-candidate" ||
      result.candidateArtifact.activeIncident !== undefined)
  ) {
    throw new Error("The remediated artifact is no longer nomination-eligible");
  }
  if (
    !adoptingResult &&
    (source.candidateArtifact?.lifecycle !== "formal-candidate" ||
      source.candidateArtifact.activeIncident !== undefined)
  ) {
    throw new Error("The original artifact is no longer safe to retain by nomination");
  }
  const internalOnly = content.deployment.policies["internal-only"];
  if (internalOnly === undefined) {
    throw new Error("Internal-only deployment policy is missing from content");
  }
  const replacementCharacter = adoptingResult
    ? createAiCharacterState(state, result, 0)
    : undefined;
  if (adoptingResult) {
    transitionCandidateArtifactLifecycle(
      tx,
      source.id,
      "capability-qualified-latent-candidate",
    );
    transitionCandidateArtifactLifecycle(tx, result.id, "formal-candidate");
  }
  tx.update((draft) => {
    if (
      draft.endgame.stage !== "evidence-sprint" ||
      draft.endgame.pendingRemediation === undefined
    ) {
      throw new Error("Remediation decision changed during adoption");
    }
    const mutableSource = draft.models[source.id];
    const mutableResult = draft.models[result.id];
    const lab = draft.labs[source.ownerLabId];
    if (mutableSource === undefined || mutableResult === undefined || lab === undefined) {
      throw new Error("Remediation artifact disappeared during adoption");
    }
    delete draft.endgame.pendingRemediation;
    if (adoptingResult) {
      const sourceArtifact = mutableSource.candidateArtifact;
      if (sourceArtifact !== undefined) {
        sourceArtifact.maximumAccessEver = Math.max(
          sourceArtifact.maximumAccessEver,
          mutableSource.accessLevel,
        ) as ModelState["accessLevel"];
      }
      mutableSource.accessLevel = 0;
      mutableSource.deployment.policy = "internal-only";
      delete mutableSource.deployment.plannedPolicy;
      mutableSource.deployment.exposure = internalOnly.exposure;
      mutableSource.deployment.irreversible = internalOnly.irreversible;
      mutableSource.deployment.changedAt = draft.run.tick;
      mutableSource.flags["agi-candidate"] = false;
      mutableResult.accessLevel = 0;
      mutableResult.flags["agi-candidate"] = true;
      draft.endgame.candidateModelId = mutableResult.id;
      lab.models.currentModelId = mutableResult.id;
      if (lab.models.commercialModelId === mutableSource.id) {
        delete lab.models.commercialModelId;
      }
      applyRemediationEvidenceStaleness(draft.endgame.evidence);
      if (replacementCharacter !== undefined) {
        draft.aiCharacter = structuredClone(replacementCharacter) as DeepMutable<
          typeof replacementCharacter
        >;
      }
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: adoptingResult
        ? `${mutableResult.displayName} explicitly adopted as the formal candidate. ${mutableSource.displayName} remains a separate isolated artifact; safety context transferred only partially and capability proof must be repeated on the new weights.`
        : `${mutableSource.displayName} explicitly retained as the formal candidate. ${mutableResult.displayName} remains a separate isolated same-lineage artifact.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.remediation-artifact-adopted" },
      relatedIds: [mutableSource.id, mutableResult.id, modelId],
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `candidate-remediation-adopted:${source.id}:${result.id}:${modelId}`,
    });
  });
  tx.emit({
    kind: "candidate-remediation-adopted",
    sourceModelId: source.id,
    resultModelId: result.id,
    adoptedModelId: modelId,
  });
  if (adoptingResult) {
    tx.update((draft) => {
      if (draft.endgame.stage !== "evidence-sprint") {
        throw new Error("Remediated candidate changed before capability reconfirmation");
      }
      const confirmation: CrisisConfirmationState = {
        ...copyCrisisBase(draft.endgame),
        stage: "confirmation",
        enteredAt: draft.run.tick,
      };
      draft.endgame = structuredClone(
        confirmation,
      ) as DeepMutable<CrisisConfirmationState>;
    });
    tx.requestAutoPause("agi-candidate");
    return;
  }
  if (pending.nextStage === "pressure-collision") {
    selectPressureCollision(tx, content, oracle);
  } else {
    enterFinalReview(tx, content);
  }
}

function addEvidenceMethod(
  evidence: DeepMutable<CrisisEvidenceLedgerState>,
  method: string,
): void {
  if (!evidence.methodDiversity.includes(method)) evidence.methodDiversity.push(method);
}

export function advanceCrisisProject(
  tx: SimulationTransaction,
  project: ProjectState,
): void {
  if (project.payload.kind !== "crisis") throw new Error("Not a crisis project");
  const model = tx.read().models[project.payload.modelId];
  if (model === undefined) throw new Error("Crisis project model missing");
  const acceleration = project.payload.candidateAssistEligible
    ? CANDIDATE_ACCESS_RULES[model.accessLevel].accelerationMultiplier
    : 1;
  tx.update((draft) => {
    const mutable = draft.projects[project.id];
    if (mutable === undefined) throw new Error("Crisis project missing");
    mutable.progress = Math.min(
      1,
      mutable.progress + acceleration / mutable.expectedDurationWeeks,
    );
  });
}

export function completeCrisisProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  project: ProjectState,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): void {
  if (project.payload.kind !== "crisis") throw new Error("Not a crisis project");
  if (project.payload.projectType === "confirmation") {
    if (project.payload.capabilityChallengeId === undefined) {
      throw new Error("Capability challenge missing");
    }
    resolveFixedTruthCapabilityProof(tx, content, project, project.payload, oracle);
    return;
  }
  if (project.payload.candidateSafetyResponseId === undefined) {
    throw new Error("Candidate safety response missing");
  }
  completeCandidateSafetyResponse(tx, content, project, project.payload, oracle);
}

export const CRISIS_PROJECT_HANDLER: ProjectHandler<"crisis"> = {
  kind: "crisis",
  advance(tx, _content, project): void {
    advanceCrisisProject(tx, project);
  },
  complete(tx, content, project): void {
    completeCrisisProject(tx, content, project);
  },
  cancel(tx, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error("Crisis project missing");
      mutable.status = "cancelled";
    });
  },
};

export interface PressureCollisionDefinition {
  readonly id: ContentId;
  readonly category: "rival" | "political" | "financial" | "institutional";
  readonly title: string;
  readonly body: string;
  readonly options: readonly {
    readonly id: "delay" | "comply" | "push-ahead";
    readonly label: string;
    readonly consequence: string;
  }[];
}

const FUNDING_WINDOW_CASH_MILLIONS = {
  delay: 0,
  comply: 12_000,
  "push-ahead": 25_000,
} as const satisfies Record<"delay" | "comply" | "push-ahead", number>;

function fundingWindowAmountLabel(optionId: "comply" | "push-ahead"): string {
  return `$${String(FUNDING_WINDOW_CASH_MILLIONS[optionId] / 1_000)}b`;
}

export const PRESSURE_COLLISIONS: readonly PressureCollisionDefinition[] = [
  {
    id: contentId("base:endgame-collision.rival-agi-claim"),
    category: "rival",
    title: "A rival claims AGI",
    body: "A rival lab has begun a public deployment countdown and would like everyone to know the countdown has a logo.",
    options: [
      {
        id: "delay",
        label: "Audit the claim before reacting",
        consequence: "Gain stronger evidence while the rival clock continues.",
      },
      {
        id: "comply",
        label: "Open a reciprocal benchmark channel",
        consequence: "Trade some secrecy for shared evidence and public credibility.",
      },
      {
        id: "push-ahead",
        label: "Race them to a public launch",
        consequence: "Protect tempo, but accept substantially more unresolved risk.",
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.rival-verification-offer"),
    category: "rival",
    title: "Verification, with reciprocal footnotes",
    body: "A rival offers a temporary evaluation pact if the lab shares enough evidence to make secrecy largely ceremonial.",
    options: [
      {
        id: "delay",
        label: "Negotiate a narrower protocol",
        consequence:
          "Improve the evidence exchange without disclosing the whole programme.",
      },
      {
        id: "comply",
        label: "Join the verification pact",
        consequence: "Gain substantial independent evidence and legitimacy.",
      },
      {
        id: "push-ahead",
        label: "Decline and preserve secrecy",
        consequence: "Keep discretion, but lose credibility and independent scrutiny.",
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.government-weights-demand"),
    category: "political",
    title: "The adults request the weights",
    body: "Government demands model weights, logs, and a briefing whose attendee list is itself classified.",
    options: [
      {
        id: "delay",
        label: "Request judicial review",
        consequence: "Buy time and preserve custody at the cost of political patience.",
      },
      {
        id: "comply",
        label: "Provide supervised access",
        consequence:
          "Greatly improve government trust without releasing the weights publicly.",
      },
      {
        id: "push-ahead",
        label: "Refuse the demand",
        consequence: "Preserve control while sharply raising takeover pressure.",
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.emergency-injunction"),
    category: "political",
    title: "Emergency injunction",
    body: "Regulators propose an immediate pause pending evidence that the lab has not chosen to produce yet.",
    options: [
      {
        id: "delay",
        label: "Accept the temporary stay",
        consequence: "Produce the missing evidence while the launch remains paused.",
      },
      {
        id: "comply",
        label: "Negotiate a supervised pilot",
        consequence:
          "Accept immediate supervision, improving legitimacy, security review, and government trust.",
      },
      {
        id: "push-ahead",
        label: "Ignore the injunction",
        consequence: "Keep moving while intervention and nationalisation risk surge.",
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.board-deployment-order"),
    category: "financial",
    title: "Ship the candidate or ship a new CEO",
    body: "The board observes that runway is a number and mission is apparently a paragraph beneath it.",
    options: [
      {
        id: "delay",
        label: "Require independent safety sign-off",
        consequence: "Improve evidence while defying the board's launch timetable.",
      },
      {
        id: "comply",
        label: "Accept the board's launch timetable",
        consequence:
          "Restore board support, add rollout pressure, and record a visible mission concession.",
      },
      {
        id: "push-ahead",
        label: "Defend the charter and defy the board",
        consequence: "Preserve the mission while risking leadership conflict.",
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.funding-window"),
    category: "financial",
    title: "The final credible term sheet",
    body: "Investors will fund the rollout, provided the rollout begins before due diligence discovers the crisis board.",
    options: [
      {
        id: "delay",
        label: "Let the term sheet expire",
        consequence: "Keep the charter intact and gain time for evidence.",
      },
      {
        id: "comply",
        label: "Accept mission-protection covenants",
        consequence: `Receive ${fundingWindowAmountLabel("comply")} in constrained capital with modest legitimacy and board support.`,
      },
      {
        id: "push-ahead",
        label: "Take the money and soften the charter",
        consequence: `Receive ${fundingWindowAmountLabel("push-ahead")} and gain strong board support while recording a visible mission concession.`,
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.safety-lead-dissent"),
    category: "institutional",
    title: "The safety lead has drafted a public letter",
    body: "A senior researcher will resign publicly unless the lab permits an independent review and a delay.",
    options: [
      {
        id: "delay",
        label: "Commission the independent review",
        consequence:
          "Gain the strongest evidence and preserve internal trust at a cost to tempo.",
      },
      {
        id: "comply",
        label: "Give the safety lead a release veto",
        consequence: "Strengthen practical control and legitimacy.",
      },
      {
        id: "push-ahead",
        label: "Prepare for the resignation",
        consequence:
          "Keep the launch moving while losing evidence and public credibility.",
      },
    ],
  },
  {
    id: contentId("base:endgame-collision.candidate-control-vulnerability"),
    category: "institutional",
    title: "The candidate found something",
    body: "The candidate identifies a plausible containment flaw and offers a fix requiring broader access. Security confirms the flaw may be real.",
    options: [
      {
        id: "delay",
        label: "Reproduce the flaw without the candidate",
        consequence: "Gain control evidence and defence without broadening access.",
      },
      {
        id: "comply",
        label: "Apply a sandboxed version of the fix",
        consequence:
          "Improve defence, but add a small amount of unresolved safety pressure.",
      },
      {
        id: "push-ahead",
        label: "Grant access for the full fix",
        consequence:
          "Gain the largest defence boost while sharply increasing hidden opportunity.",
      },
    ],
  },
];

function pressureScores(
  state: Readonly<GameState>,
  content: CompiledContent,
): Record<"rival" | "political" | "financial" | "institutional", number> {
  const rivalWeeks = Object.values(state.world.rivals)
    .map((rival) => rival.candidateCountdown)
    .filter((countdown) => countdown?.status === "active")
    .map((countdown) => Math.max(0, (countdown?.completesAt ?? 104) - state.run.tick));
  const bestRival =
    rivalWeeks.length === 0 ? 25 : Math.max(0, 100 - Math.min(...rivalWeeks) * 3);
  const political = calculateInterventionPressure(state, state.run.playerLabId).final;
  const runway = forecastFinance(state, content, state.run.playerLabId).runway;
  const financial = runway.isInfinite ? 5 : Math.max(0, 100 - (runway.weeks ?? 0) * 3);
  const researchers = Object.values(state.researchers).filter(
    (researcher) => researcher.employerLabId === state.run.playerLabId,
  );
  const peoplePressure = researchers.reduce(
    (maximum, researcher) =>
      Math.max(maximum, researcher.departurePressure, researcher.burnout),
    0,
  );
  const anomalyPressure =
    state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
      ? 0
      : Math.min(100, state.endgame.evidence.unresolvedAnomalyPressure * 6);
  return {
    rival: rating(bestRival),
    political: rating(political),
    financial: rating(financial),
    institutional: rating(Math.max(peoplePressure, anomalyPressure)),
  };
}

export function selectPressureCollision(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle = new RandomOracleV1(tx.read().run.seed),
): PressureCollisionDefinition {
  const state = tx.read();
  if (state.endgame.stage !== "evidence-sprint") {
    throw new Error("Pressure collision requires the Evidence Sprint");
  }
  const scores = pressureScores(state, content);
  const categories = ["rival", "political", "financial", "institutional"] as const;
  const category = [...categories].sort(
    (left, right) => scores[right] - scores[left] || (left < right ? -1 : 1),
  )[0];
  if (category === undefined) throw new Error("No pressure category");
  const candidates = PRESSURE_COLLISIONS.filter(
    (collision) => collision.category === category,
  ).sort((left, right) => (left.id < right.id ? -1 : 1));
  const draw = oracle.uniform(
    randomKey("endgame", state.endgame.candidateModelId, "pressure-collision", category),
  );
  const selected =
    candidates[Math.min(candidates.length - 1, Math.floor(draw * candidates.length))];
  if (selected === undefined) throw new Error(`No ${category} pressure collision`);
  const candidateModelId = state.endgame.candidateModelId;
  const collisionState: CrisisPressureCollisionState = {
    ...copyCrisisBase(state.endgame),
    stage: "pressure-collision",
    enteredAt: state.run.tick,
    pressureCategory: category,
    pressureEventId: selected.id,
    resolved: false,
    pressureScores: scores,
    selectionDraw: fraction(draw),
  };
  tx.update((draft) => {
    if (draft.endgame.stage !== "evidence-sprint") throw new Error("Sprint changed");
    draft.endgame = structuredClone(
      collisionState,
    ) as DeepMutable<CrisisPressureCollisionState>;
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${selected.title}: ${selected.body}`,
      category: "narrative",
      source: { kind: "system", id: selected.id },
      relatedIds: [candidateModelId],
    });
  });
  tx.emit({
    kind: "crisis-pressure-collision-selected",
    collisionId: selected.id,
    category,
  });
  tx.requestAutoPause("crisis-stage");
  return selected;
}

export function resolvePressureCollision(
  tx: SimulationTransaction,
  optionId: "delay" | "comply" | "push-ahead",
): void {
  const state = tx.read();
  if (state.endgame.stage !== "pressure-collision" || state.endgame.resolved) {
    throw new Error("No unresolved pressure collision");
  }
  const pressureEventId = state.endgame.pressureEventId;
  const definition = PRESSURE_COLLISIONS.find(
    (candidate) => candidate.id === pressureEventId,
  );
  if (definition === undefined) throw new Error("Pressure collision definition missing");
  const selectedOption = definition.options.find((option) => option.id === optionId);
  if (selectedOption === undefined) throw new Error("Pressure collision option missing");
  const fundingCashMillions = pressureEventId.endsWith("funding-window")
    ? FUNDING_WINDOW_CASH_MILLIONS[optionId]
    : 0;
  if (fundingCashMillions > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: state.run.playerLabId },
        resource: "cash",
        amount: fundingCashMillions,
        financeCategory: "grant",
      },
      { kind: "system", id: pressureEventId },
    );
  }
  tx.update((draft) => {
    if (draft.endgame.stage !== "pressure-collision")
      throw new Error("Collision changed");
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("Player lab missing");
    draft.endgame.resolved = true;
    draft.endgame.selectedOptionId = optionId;
    if (optionId === "delay") {
      draft.endgame.delayEndsAt = tick(draft.run.tick + 3);
    }
    const collision = draft.endgame.pressureEventId;
    if (collision.endsWith("rival-agi-claim")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 5;
      } else if (optionId === "comply") {
        draft.endgame.evidence.evidenceBonus += 4;
        draft.endgame.evidence.legitimacyBonus += 4;
      } else {
        draft.endgame.evidence.unresolvedAnomalyPressure += 7;
        lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust - 3);
      }
    } else if (collision.endsWith("rival-verification-offer")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 4;
      } else if (optionId === "comply") {
        draft.endgame.evidence.evidenceBonus += 7;
        draft.endgame.evidence.legitimacyBonus += 4;
      } else {
        draft.endgame.evidence.unresolvedAnomalyPressure += 2;
        draft.endgame.evidence.legitimacyBonus -= 4;
      }
    } else if (collision.endsWith("government-weights-demand")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 3;
      } else if (optionId === "comply") {
        draft.endgame.evidence.legitimacyBonus += 8;
        draft.endgame.evidence.securityBonus += 2;
        lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust + 8);
      } else {
        draft.endgame.evidence.unresolvedAnomalyPressure += 3;
        lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust - 12);
        lab.politics.captureConcern = boundedRating(lab.politics.captureConcern + 15);
      }
    } else if (collision.endsWith("emergency-injunction")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 6;
      } else if (optionId === "comply") {
        draft.endgame.evidence.legitimacyBonus += 7;
        draft.endgame.evidence.securityBonus += 3;
        lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust + 6);
      } else {
        draft.endgame.evidence.unresolvedAnomalyPressure += 5;
        lab.politics.governmentTrust = boundedRating(lab.politics.governmentTrust - 15);
        lab.politics.captureConcern = boundedRating(lab.politics.captureConcern + 20);
      }
    } else if (collision.endsWith("board-deployment-order")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 5;
      } else if (optionId === "comply") {
        draft.endgame.evidence.unresolvedAnomalyPressure += 4;
      } else {
        draft.endgame.evidence.legitimacyBonus += 3;
      }
    } else if (collision.endsWith("funding-window")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 4;
      } else if (optionId === "comply") {
        draft.endgame.evidence.legitimacyBonus += 4;
      } else {
        lab.politics.captureConcern = boundedRating(lab.politics.captureConcern + 10);
      }
    } else if (collision.endsWith("safety-lead-dissent")) {
      if (optionId === "delay") {
        draft.endgame.evidence.evidenceBonus += 8;
      } else if (optionId === "comply") {
        draft.endgame.evidence.controlBonus += 6;
        draft.endgame.evidence.legitimacyBonus += 6;
      } else {
        draft.endgame.evidence.unresolvedAnomalyPressure += 6;
        draft.endgame.evidence.legitimacyBonus -= 6;
      }
    } else if (collision.endsWith("candidate-control-vulnerability")) {
      if (optionId === "delay") {
        draft.endgame.evidence.controlBonus += 5;
        draft.endgame.evidence.defenceBonus += 6;
      } else if (optionId === "comply") {
        draft.endgame.evidence.defenceBonus += 8;
        draft.endgame.evidence.unresolvedAnomalyPressure += 2;
      } else {
        draft.endgame.evidence.defenceBonus += 12;
        draft.endgame.evidence.unresolvedAnomalyPressure += 9;
      }
    }

    const missionConcession =
      (collision.endsWith("board-deployment-order") && optionId === "comply") ||
      (collision.endsWith("funding-window") && optionId === "push-ahead");
    if (missionConcession) {
      const previous =
        typeof lab.flags["endgame:mission-concessions"] === "number"
          ? Number(lab.flags["endgame:mission-concessions"])
          : 0;
      const next = previous + 1;
      lab.flags["endgame:mission-concessions"] = next;
      if (next >= 2) {
        lab.flags["mission-captured-by-board"] = true;
      } else {
        lab.flags["endgame:mission-capture-warning"] = true;
      }
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          next >= 2
            ? "MISSION CAPTURE: repeated concessions transferred practical control of the charter to commercial backers. This will outrank an otherwise successful settlement."
            : "MISSION WARNING: the lab made its first major commercial concession. Another concession in a future crisis may make the original mission unrecoverable.",
        category: "narrative",
        source: { kind: "system", id: "endgame.mission-capture" },
        relatedIds: [draft.endgame.candidateModelId],
      });
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${definition.title} — ${selectedOption.label}: ${selectedOption.consequence}${fundingCashMillions > 0 ? ` The ${fundingWindowAmountLabel(optionId as "comply" | "push-ahead")} proceeds were credited immediately and recorded in the finance ledger.` : ""}${optionId === "delay" ? " The final review pauses for three weeks while the clocks continue." : ""}`,
      category: "narrative",
      source: { kind: "system", id: draft.endgame.pressureEventId },
      relatedIds: [draft.endgame.candidateModelId],
    });
  });
  tx.emit({
    kind: "crisis-pressure-collision-resolved",
    collisionId: state.endgame.pressureEventId,
    optionId,
  });
  tx.requestAutoPause("crisis-stage");
}

export function crisisProjectCapacityForQuote(
  state: Readonly<GameState>,
  content: CompiledContent,
): ReturnType<typeof calculateCrisisProjectCapacity> {
  return calculateCrisisProjectCapacity(state, content, state.run.playerLabId);
}
