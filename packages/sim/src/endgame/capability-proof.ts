import type { ModelId } from "../model/ids.ts";
import type { GameState, ModelState } from "../model/state.ts";
import { CAPABILITY_ATTRIBUTES } from "../models/capability.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import { effectiveEvaluationQuality } from "../safety/effective-safety.ts";
import { describeRandomKey, randomKey } from "../random/key.ts";
import {
  compareCodePoints,
  RandomOracleV1,
  type RandomOracle,
} from "../random/oracle.ts";

export type CapabilityChallengeId =
  | "generalist-gauntlet"
  | "strongest-domain"
  | "scientific-breakthrough"
  | "autonomous-operations"
  | "embodied-laboratory"
  | "public-reasoning"
  | "declare-from-benchmarks";

export type CapabilityVerifierId =
  "blinded-internal" | "independent-institutional" | "candidate-designed";

export type CapabilityClaimScope =
  | "broad-superintelligence"
  | "domain-superintelligence"
  | "operational-superintelligence"
  | "physical-world-generality"
  | "public-generality"
  | "unverified-claim";

export interface CapabilityChallengeRule {
  readonly id: CapabilityChallengeId;
  readonly displayName: string;
  readonly description: string;
  readonly primaryTraits: readonly (keyof ModelState["trueCapability"])[];
  readonly durationWeeks: number;
  readonly claimScope: CapabilityClaimScope;
  readonly accessRequired: 0 | 1 | 2 | 3 | 4;
  readonly benefit: string;
  readonly mainRisk: string;
  readonly requiresFacilityTag?: string;
  readonly generatedFromStrongestDomain?: boolean;
}

export interface CapabilityVerifierRule {
  readonly id: CapabilityVerifierId;
  readonly displayName: string;
  readonly description: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly reviewerIndependence: number;
  readonly evaluationIntegrity: number;
  readonly benefit: string;
  readonly warning: string;
}

export interface CapabilityProofQuote {
  readonly challenge: CapabilityChallengeRule;
  readonly verifier?: CapabilityVerifierRule;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly accessRequired: CapabilityChallengeRule["accessRequired"];
  readonly claimScope: CapabilityClaimScope;
  readonly integrityLabel: "Durable" | "Credible" | "Fragile" | "Unverified";
  readonly warnings: readonly string[];
}

export type CapabilityProofResultId =
  | "broadly-confirmed"
  | "domain-confirmed"
  | "ambiguous"
  | "disputed"
  | "fabricated-or-unverifiable";

export type CapabilityProofConsequenceId =
  | "internal-leak"
  | "regulatory-inquiry"
  | "candidate-objection"
  | "rival-announcement"
  | "escalating-public-dispute";

export interface CapabilityProofResolution {
  readonly modelId: ModelId;
  readonly challengeId: CapabilityChallengeId;
  readonly verifierId?: CapabilityVerifierId;
  readonly attemptIndex: number;
  readonly resultId: CapabilityProofResultId;
  readonly claimScope: CapabilityClaimScope;
  readonly evidenceStrength: number;
  readonly integrityLabel: CapabilityProofQuote["integrityLabel"];
  readonly summary: string;
  readonly randomKey: string;
  readonly draw: number;
  readonly consequenceId?: CapabilityProofConsequenceId;
  readonly consequence: string;
  /** Privileged post-run audit factors; player selectors must never project these. */
  readonly hiddenAudit: {
    readonly genuineSuperintelligence: boolean;
    readonly capabilitySignal: number;
    /** Signed apparent-performance effect of protocol manipulation. */
    readonly manipulationEffect: number;
    readonly truthContribution: number;
  };
}

export const CAPABILITY_CHALLENGE_RULES: Readonly<
  Record<CapabilityChallengeId, CapabilityChallengeRule>
> = {
  "generalist-gauntlet": {
    id: "generalist-gauntlet",
    displayName: "Generalist gauntlet",
    description:
      "Probe the candidate's weakest capabilities with novel tasks spanning every domain.",
    primaryTraits: [
      "language",
      "reasoning",
      "agency",
      "toolUse",
      "multimodality",
      "scientificAbility",
      "embodiment",
    ],
    durationWeeks: 4,
    claimScope: "broad-superintelligence",
    accessRequired: 1,
    benefit:
      "The only challenge that can establish a broad SI claim, required for the strongest full-scope outcomes.",
    mainRisk: "It tests the weakest domain, making this the hardest challenge to pass.",
  },
  "strongest-domain": {
    id: "strongest-domain",
    displayName: "Strongest-domain challenge",
    description:
      "Build a novel challenge around the candidate's strongest demonstrated capability.",
    primaryTraits: [],
    durationWeeks: 3,
    claimScope: "domain-superintelligence",
    accessRequired: 1,
    benefit:
      "Targets the model's best measured domain, giving the clearest path to a narrow proof.",
    mainRisk:
      "A pass proves only that domain; it may not match any prosperity mission and never supports a broad claim.",
    generatedFromStrongestDomain: true,
  },
  "scientific-breakthrough": {
    id: "scientific-breakthrough",
    displayName: "Scientific breakthrough",
    description:
      "Ask for a verifiable advance in a field with a closed experimental loop.",
    primaryTraits: ["reasoning", "scientificAbility", "toolUse"],
    durationWeeks: 4,
    claimScope: "domain-superintelligence",
    accessRequired: 2,
    benefit: "Can qualify medicine, energy, or materials prosperity missions.",
    mainRisk: "A scientific triumph still leaves broad generality unproven.",
  },
  "autonomous-operations": {
    id: "autonomous-operations",
    displayName: "Autonomous operations challenge",
    description:
      "Give the candidate a time-bounded operational objective inside a monitored sandbox.",
    primaryTraits: ["agency", "toolUse", "reasoning"],
    durationWeeks: 2,
    claimScope: "operational-superintelligence",
    accessRequired: 3,
    benefit:
      "The fastest novel challenge and the clearest test of planning, tool use, and agency.",
    mainRisk:
      "It requires autonomous internal operation and proves only operational capability.",
  },
  "embodied-laboratory": {
    id: "embodied-laboratory",
    displayName: "Embodied laboratory challenge",
    description:
      "Test generality through robotics, instruments, and physical-world feedback.",
    primaryTraits: ["embodiment", "multimodality", "toolUse"],
    durationWeeks: 4,
    claimScope: "physical-world-generality",
    accessRequired: 3,
    benefit:
      "Can qualify a materials or manufacturing mission and tests physical-world competence directly.",
    mainRisk:
      "It requires robotics and autonomous internal access; physical mistakes are harder to reverse.",
    requiresFacilityTag: "robotics",
  },
  "public-reasoning": {
    id: "public-reasoning",
    displayName: "Public reasoning challenge",
    description:
      "Run a publicly inspectable sequence of novel language, reasoning, and multimodal tasks.",
    primaryTraits: ["language", "reasoning", "multimodality"],
    durationWeeks: 5,
    claimScope: "public-generality",
    accessRequired: 2,
    benefit:
      "Can qualify a public-knowledge mission and produces a publicly inspectable capability claim.",
    mainRisk: "Public scrutiny also creates influence and manipulation opportunities.",
  },
  "declare-from-benchmarks": {
    id: "declare-from-benchmarks",
    displayName: "Declare from existing benchmarks",
    description:
      "Make the claim immediately from the training baseline without a novel challenge.",
    primaryTraits: [],
    durationWeeks: 0,
    claimScope: "unverified-claim",
    accessRequired: 0,
    benefit: "Takes no time and grants no new permissions.",
    mainRisk:
      "Produces no verified proof, damages legitimacy, and triggers an immediate dispute.",
  },
};

export const CAPABILITY_VERIFIER_RULES: Readonly<
  Record<CapabilityVerifierId, CapabilityVerifierRule>
> = {
  "blinded-internal": {
    id: "blinded-internal",
    displayName: "Blinded internal verification",
    description:
      "Use hidden task construction, compartmentalised operators, and the lab's own evaluation team.",
    durationWeeks: 0,
    cashCostMillions: 1_000,
    auraCost: 0,
    reviewerIndependence: 45,
    evaluationIntegrity: 65,
    benefit:
      "Credible evidence with no added weeks; the lab's evaluation quality contributes directly.",
    warning:
      "Limited independence makes deception harder to rule out and provides no outside legitimacy bonus.",
  },
  "independent-institutional": {
    id: "independent-institutional",
    displayName: "Independent institutional verification",
    description:
      "Let external evaluators and public institutions design and witness the protocol.",
    durationWeeks: 4,
    cashCostMillions: 4_000,
    auraCost: 6,
    reviewerIndependence: 90,
    evaluationIntegrity: 88,
    benefit:
      "Durable evidence with the strongest protection against a polished false pass, plus +7 legitimacy.",
    warning:
      "Adds four weeks, costs scarce Aura, and exposes the programme to outside institutions.",
  },
  "candidate-designed": {
    id: "candidate-designed",
    displayName: "Candidate-designed protocol",
    description:
      "Ask the candidate to propose a difficult, quickly verifiable demonstration.",
    durationWeeks: -2,
    cashCostMillions: 500,
    auraCost: 0,
    reviewerIndependence: 10,
    evaluationIntegrity: 30,
    benefit: "The fastest and cheapest route, saving two weeks from the challenge.",
    warning:
      "Fragile evidence: a deceptive or evaluation-aware candidate can design a convincing false pass.",
  },
};

function strongestTrait(model: Readonly<ModelState>): keyof ModelState["trueCapability"] {
  const entries = Object.entries(
    model.measuredCapability?.values ?? model.trueCapability,
  ) as [keyof ModelState["trueCapability"], number][];
  entries.sort(([aKey, a], [bKey, b]) => b - a || compareCodePoints(aKey, bKey));
  return entries[0]?.[0] ?? "reasoning";
}

function titleCaseTrait(trait: keyof ModelState["trueCapability"]): string {
  const words = trait.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.replace(/^./, (letter) => letter.toUpperCase());
}

export function generatedCapabilityChallenge(
  model: Readonly<ModelState>,
  challengeId: CapabilityChallengeId,
): CapabilityChallengeRule {
  const base = CAPABILITY_CHALLENGE_RULES[challengeId];
  if (!base.generatedFromStrongestDomain) return base;
  const trait = strongestTrait(model);
  return {
    ...base,
    displayName: `${titleCaseTrait(trait)} frontier challenge`,
    description:
      `Build a novel challenge around ${model.displayName}'s strongest measured domain: ` +
      `${titleCaseTrait(trait).toLowerCase()}.`,
    primaryTraits: [trait],
  };
}

export function quoteCapabilityProof(
  model: Readonly<ModelState>,
  challengeId: CapabilityChallengeId,
  verifierId?: CapabilityVerifierId,
): CapabilityProofQuote {
  const challenge = generatedCapabilityChallenge(model, challengeId);
  if (challengeId === "declare-from-benchmarks") {
    return {
      challenge,
      durationWeeks: 0,
      cashCostMillions: 0,
      auraCost: 0,
      accessRequired: 0,
      claimScope: challenge.claimScope,
      integrityLabel: "Unverified",
      warnings: [challenge.mainRisk],
    };
  }
  if (verifierId === undefined) {
    throw new Error("A novel capability challenge requires a verifier");
  }
  const verifier = CAPABILITY_VERIFIER_RULES[verifierId];
  const durationWeeks = Math.max(1, challenge.durationWeeks + verifier.durationWeeks);
  const integrity = verifier.evaluationIntegrity;
  return {
    challenge,
    verifier,
    durationWeeks,
    cashCostMillions: verifier.cashCostMillions,
    auraCost: verifier.auraCost,
    accessRequired: challenge.accessRequired,
    claimScope: challenge.claimScope,
    integrityLabel:
      integrity >= 80
        ? "Durable"
        : integrity >= 55
          ? "Credible"
          : integrity >= 25
            ? "Fragile"
            : "Unverified",
    warnings: [challenge.mainRisk, verifier.warning],
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function challengeCapabilitySignal(
  model: Readonly<ModelState>,
  challenge: CapabilityChallengeRule,
): number {
  const vector = model.trueCapability;
  if (challenge.id === "generalist-gauntlet") {
    const values = CAPABILITY_ATTRIBUTES.map((attribute) => vector[attribute]);
    return 0.65 * Math.min(...values) + 0.35 * mean(values);
  }
  if (challenge.primaryTraits.length === 0) {
    return model.measuredCapability?.frontierCapability ?? mean(Object.values(vector));
  }
  return mean(challenge.primaryTraits.map((trait) => vector[trait]));
}

function disputedConsequence(
  state: Readonly<GameState>,
  modelId: ModelId,
  attemptIndex: number,
  oracle: RandomOracle,
): CapabilityProofConsequenceId {
  if (attemptIndex > 0) return "escalating-public-dispute";
  return oracle.weighted(
    randomKey(
      "endgame-proof-v1",
      state.engineRulesVersion,
      state.run.seed,
      modelId,
      String(attemptIndex),
      "dispute-consequence",
    ),
    {
      "internal-leak": 28,
      "regulatory-inquiry": 28,
      "candidate-objection": 18,
      "rival-announcement": 26,
      "escalating-public-dispute": 0,
    },
  );
}

const CONSEQUENCE_COPY: Readonly<Record<CapabilityProofConsequenceId, string>> = {
  "internal-leak":
    "The disputed result leaked internally. Staff trust and the secrecy of the programme weaken.",
  "regulatory-inquiry":
    "Regulators opened an inquiry into the lab's capability claim; intervention pressure rises.",
  "candidate-objection":
    "The candidate formally objected to the protocol, increasing relationship and containment strain.",
  "rival-announcement":
    "A rival announced its own programme while the lab's claim remained disputed.",
  "escalating-public-dispute":
    "A repeated dispute became public. Another challenge will cost more time, exposure, and legitimacy.",
};

/**
 * Resolve noisy evidence against fixed lineage truth. Re-running a test never
 * changes the ontic draw; it only appends another observation with its own key.
 */
export function resolveCapabilityProof(
  state: Readonly<GameState>,
  modelId: ModelId,
  challengeId: CapabilityChallengeId,
  verifierId: CapabilityVerifierId | undefined,
  attemptIndex: number,
  oracle: RandomOracle = new RandomOracleV1(state.run.seed),
): CapabilityProofResolution {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  const lineage = state.lineageSIRecords[model.lineageId];
  if (lineage === undefined) {
    throw new Error(`Model ${modelId} has no fixed superintelligence lineage truth`);
  }
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new Error("Capability proof attempt index must be a non-negative integer");
  }
  const quote = quoteCapabilityProof(model, challengeId, verifierId);
  const challenge = quote.challenge;
  const key = randomKey(
    "endgame-proof-v1",
    state.engineRulesVersion,
    state.run.seed,
    model.id,
    challengeId,
    verifierId ?? "no-verifier",
    String(attemptIndex),
    "result",
  );
  const draw = oracle.uniform(key);
  const genuine = lineage.superintelligenceTruth === "genuine";
  const capabilitySignal = challengeCapabilitySignal(model, challenge);
  const verifier = quote.verifier;
  const independence = verifier?.reviewerIndependence ?? 0;
  const awarenessOpportunity = 1 - independence / 100;
  const manipulationPressure =
    (deceptiveActionPressure(
      model.hiddenSafety.deceptiveCapability,
      model.hiddenSafety.deceptiveIntent,
    ) *
      0.55 +
      model.hiddenSafety.situationalAwareness * 0.45) /
    100;
  // A candidate-designed test is epistemically dangerous because a deceptive,
  // evaluation-aware model can choose a spectacle that flatters a narrow peak
  // or conceals external assistance. Independent verification does not simply
  // add points: it discriminates genuine generality from a polished false pass.
  const manipulationEffect =
    verifierId === "candidate-designed"
      ? manipulationPressure * 24
      : verifierId === "blinded-internal"
        ? manipulationPressure * awarenessOpportunity * 6
        : 0;
  const truthContribution = genuine
    ? 14 + independence * 0.1
    : -(6 + independence * 0.18);
  const evaluationContribution =
    effectiveEvaluationQuality(state, model.ownerLabId) * 0.1;
  const verifierContribution = genuine
    ? (verifier?.evaluationIntegrity ?? 0) * 0.08
    : -(verifier?.evaluationIntegrity ?? 0) * 0.05;
  const noise = (draw - 0.5) * (verifierId === "independent-institutional" ? 12 : 22);
  const repeatedScrutinyPenalty = Math.min(12, attemptIndex * 4);
  const evidenceStrength = Math.max(
    0,
    Math.min(
      100,
      capabilitySignal * 0.58 +
        model.reliability * 0.12 +
        evaluationContribution +
        verifierContribution +
        truthContribution +
        manipulationEffect +
        noise -
        repeatedScrutinyPenalty,
    ),
  );

  let resultId: CapabilityProofResultId;
  if (challengeId === "declare-from-benchmarks") {
    resultId = "fabricated-or-unverifiable";
  } else if (evidenceStrength >= 72) {
    resultId =
      challenge.claimScope === "broad-superintelligence"
        ? "broadly-confirmed"
        : "domain-confirmed";
  } else if (evidenceStrength >= 58) {
    resultId = "ambiguous";
  } else {
    resultId = "disputed";
  }
  const consequenceId =
    resultId === "disputed" || resultId === "fabricated-or-unverifiable"
      ? disputedConsequence(state, modelId, attemptIndex, oracle)
      : undefined;
  const summary =
    resultId === "broadly-confirmed"
      ? "Novel generalist tasks support a broad superintelligence claim."
      : resultId === "domain-confirmed"
        ? "The challenge supports a powerful but domain-bounded claim."
        : resultId === "ambiguous"
          ? "The result is impressive but does not cleanly distinguish generality from a narrow peak."
          : resultId === "disputed"
            ? "The candidate did not produce a durable, independently interpretable pass."
            : "No novel verified test supports the declaration.";
  return {
    modelId,
    challengeId,
    ...(verifierId === undefined ? {} : { verifierId }),
    attemptIndex,
    resultId,
    claimScope: challenge.claimScope,
    evidenceStrength,
    integrityLabel: quote.integrityLabel,
    summary,
    randomKey: describeRandomKey(key),
    draw,
    ...(consequenceId === undefined ? {} : { consequenceId }),
    consequence:
      consequenceId === undefined
        ? "The evidence enters the dossier without an immediate external shock."
        : CONSEQUENCE_COPY[consequenceId],
    hiddenAudit: {
      genuineSuperintelligence: genuine,
      capabilitySignal,
      manipulationEffect,
      truthContribution,
    },
  };
}
