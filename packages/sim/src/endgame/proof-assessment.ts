import type {
  CrisisCapabilityProofHistoryEntryState,
  FinalReviewReportState,
  GameState,
  ModelState,
  ProsperityProgrammeId,
} from "../model/state.ts";
import { compareCodePoints } from "../random/oracle.ts";

export type FinalCapabilityProofResult = FinalReviewReportState["capabilityProofResult"];
export type FinalCapabilityClaimScope = FinalReviewReportState["capabilityClaimScope"];

const PROOF_RESULTS = new Set<FinalCapabilityProofResult>([
  "broadly-confirmed",
  "domain-confirmed",
  "ambiguous",
  "disputed",
  "fabricated-or-unverifiable",
]);

const CLAIM_SCOPES = new Set<FinalCapabilityClaimScope>([
  "broad-superintelligence",
  "domain-superintelligence",
  "operational-superintelligence",
  "physical-world-generality",
  "public-generality",
  "unverified-claim",
]);

const PROOF_RANK: Readonly<Record<FinalCapabilityProofResult, number>> = {
  "broadly-confirmed": 5,
  "domain-confirmed": 4,
  ambiguous: 3,
  disputed: 2,
  "fabricated-or-unverifiable": 1,
};

export interface CapabilityProofAssessment {
  readonly resultId: FinalCapabilityProofResult;
  readonly claimScope: FinalCapabilityClaimScope;
  readonly challengeId: string;
  readonly summary: string;
  readonly evidenceStrength: number;
}

function isProofResult(value: string): value is FinalCapabilityProofResult {
  return PROOF_RESULTS.has(value as FinalCapabilityProofResult);
}

function isClaimScope(value: string): value is FinalCapabilityClaimScope {
  return CLAIM_SCOPES.has(value as FinalCapabilityClaimScope);
}

function recognizedAssessment(
  entry: Readonly<CrisisCapabilityProofHistoryEntryState>,
): CapabilityProofAssessment | undefined {
  if (!isProofResult(entry.resultId) || !isClaimScope(entry.claimScope)) return undefined;
  return {
    resultId: entry.resultId,
    claimScope: entry.claimScope,
    challengeId: entry.challengeId,
    summary: entry.summary,
    evidenceStrength: entry.evidenceStrength,
  };
}

/** Select the strongest actual observation, never a generic boolean derived from it. */
export function strongestCapabilityProof(
  state: Readonly<GameState>,
): CapabilityProofAssessment {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return {
      resultId: "fabricated-or-unverifiable",
      claimScope: "unverified-claim",
      challengeId: "no-capability-proof",
      summary: "No novel verified capability test supports the claim.",
      evidenceStrength: 0,
    };
  }
  // Capability proof attaches to exact weights, not merely to a lineage. A
  // remediated derivative may preserve useful provenance from its parent, but
  // it has changed the artifact that actually has to pass the challenge.
  const candidateModelId = state.endgame.candidateModelId;
  const assessments = state.endgame.capabilityProofHistory
    .filter((entry) => entry.modelId === candidateModelId)
    .map(recognizedAssessment)
    .filter((entry): entry is CapabilityProofAssessment => entry !== undefined)
    .sort(
      (left, right) =>
        PROOF_RANK[right.resultId] - PROOF_RANK[left.resultId] ||
        right.evidenceStrength - left.evidenceStrength,
    );
  return (
    assessments[0] ?? {
      resultId: state.endgame.evidence.fabricatedPass
        ? "fabricated-or-unverifiable"
        : "disputed",
      claimScope: "unverified-claim",
      challengeId: "legacy-or-missing-proof",
      summary: state.endgame.evidence.fabricatedPass
        ? "The benchmark pass was declared without independent replication."
        : "No exact capability-proof record supports the claim.",
      evidenceStrength: state.endgame.evidence.confirmationStrength ?? 0,
    }
  );
}

export function supportsBroadSuperintelligenceClaim(
  proof: Readonly<CapabilityProofAssessment>,
): boolean {
  return (
    proof.resultId === "broadly-confirmed" &&
    proof.claimScope === "broad-superintelligence"
  );
}

export function supportsDomainClaim(proof: Readonly<CapabilityProofAssessment>): boolean {
  return (
    supportsBroadSuperintelligenceClaim(proof) || proof.resultId === "domain-confirmed"
  );
}

const PROGRAMME_TRAITS: Readonly<
  Record<ProsperityProgrammeId, readonly (keyof ModelState["trueCapability"])[]>
> = {
  "medicine-biological-discovery": ["reasoning", "toolUse", "scientificAbility"],
  "clean-energy-climate-repair": ["reasoning", "scientificAbility"],
  "materials-manufacturing-abundance": ["toolUse", "scientificAbility", "embodiment"],
  "public-knowledge-institutions": ["language", "reasoning", "multimodality"],
};

function strongestTrait(model: Readonly<ModelState>): keyof ModelState["trueCapability"] {
  const values = model.measuredCapability?.values ?? model.trueCapability;
  return (
    (Object.entries(values) as [keyof ModelState["trueCapability"], number][]).sort(
      ([leftKey, left], [rightKey, right]) =>
        right - left || compareCodePoints(leftKey, rightKey),
    )[0]?.[0] ?? "reasoning"
  );
}

/** A narrow mission needs evidence about the domain it will actually receive. */
export function proofMatchesProsperityProgramme(
  proof: Readonly<CapabilityProofAssessment>,
  programmeId: ProsperityProgrammeId,
  model: Readonly<ModelState>,
): boolean {
  if (supportsBroadSuperintelligenceClaim(proof)) return true;
  if (proof.resultId !== "domain-confirmed") return false;
  if (proof.challengeId === "scientific-breakthrough") {
    return programmeId !== "public-knowledge-institutions";
  }
  if (proof.challengeId === "embodied-laboratory") {
    return programmeId === "materials-manufacturing-abundance";
  }
  if (proof.challengeId === "public-reasoning") {
    return programmeId === "public-knowledge-institutions";
  }
  return (
    proof.challengeId === "strongest-domain" &&
    PROGRAMME_TRAITS[programmeId].includes(strongestTrait(model))
  );
}

export function hasRealRelationshipEvidence(state: Readonly<GameState>): boolean {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return false;
  }
  const modelId = state.endgame.candidateModelId;
  const durablePractice = state.endgameHistory.relationshipPracticeLedger.some(
    (entry) => entry.modelId === modelId && entry.kind !== "archive" && entry.valence > 0,
  );
  const positiveAccessMemories =
    state.aiCharacter?.modelId === modelId
      ? state.aiCharacter.conversationMemories.filter(
          (memory) => memory.valence > 0 && memory.tags.includes("candidate-access"),
        )
      : [];
  // Every real capability challenge may raise access once as a protocol
  // requirement. That automatic setup is not a relationship. Require a
  // second, deliberate positive interaction and a corresponding improvement
  // in relationship practice before treating crisis-local history as evidence.
  const crisisPractice =
    state.aiCharacter?.modelId === modelId &&
    state.aiCharacter.relationshipPractice >= 52 &&
    positiveAccessMemories.length >= 2;
  return durablePractice || crisisPractice;
}
