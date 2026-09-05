import type { CompiledContent } from "@neolab/content-schema";

import type { ModelId } from "../model/ids.ts";
import type { GameState, ProsperityProgrammeId } from "../model/state.ts";
import { governmentProgrammeEndgameBenefits } from "../politics/politics.ts";
import {
  bestProsperityProgramme,
  findProsperityProgramme,
} from "../prosperity/prosperity.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import { candidateDossier } from "./candidate-dossier.ts";
import {
  hasRealRelationshipEvidence,
  proofMatchesProsperityProgramme,
  strongestCapabilityProof,
} from "./proof-assessment.ts";

export type DeploymentStrategyId =
  | "deploy-now"
  | "guarded-public-demonstration"
  | "fortress-contained-pilot"
  | "adaptive-monitored-rollout"
  | "government-licensed-deployment"
  | "negotiated-stewardship"
  | "narrow-prosperity-mission";

/**
 * Routes that may be selected through the player-facing planning command.
 * Deploy Now has its own typed transmission surface; supervised and legacy
 * modes are internal state-machine outcomes, never player-selectable routes.
 */
export const PLAYER_SELECTABLE_DEPLOYMENT_MODE_IDS = [
  "guarded-public-demonstration",
  "fortress-contained-pilot",
  "adaptive-monitored-rollout",
  "government-licensed-deployment",
  "negotiated-stewardship",
  "narrow-prosperity-mission",
] as const satisfies readonly DeploymentStrategyId[];

export type DeploymentFitGrade = "Prepared" | "Credible" | "Strained" | "Reckless";

export interface DeploymentStrategy {
  readonly id: DeploymentStrategyId;
  readonly displayName: string;
  readonly description: string;
  readonly fitGrade: DeploymentFitGrade;
  readonly fitScore: number;
  readonly fitExplanation: string;
  readonly reliesOn: readonly string[];
  readonly principalBenefit: string;
  readonly limitation: string;
  readonly durationWeeks: number;
  readonly requiredAccess: 1 | 2 | 3 | 4 | 5;
  readonly scopeCap: string;
  readonly blockers: readonly string[];
}

interface StrategyRule {
  readonly id: DeploymentStrategyId;
  readonly displayName: string;
  readonly description: string;
  readonly principalBenefit: string;
  readonly limitation: string;
  readonly durationWeeks: number;
  readonly requiredAccess: DeploymentStrategy["requiredAccess"];
  readonly scopeCap: string;
}

const STRATEGY_RULES: Readonly<Record<DeploymentStrategyId, StrategyRule>> = {
  "deploy-now": {
    id: "deploy-now",
    displayName: "Deploy now",
    description:
      "Issue the final order without further proof, mitigation, trial, or institutional preparation.",
    principalBenefit:
      "Consumes zero preparation weeks; rivals receive no additional time.",
    limitation:
      "Every unresolved uncertainty and weakness carries into deployment unchanged.",
    durationWeeks: 0,
    requiredAccess: 5,
    scopeCap: "None",
  },
  "guarded-public-demonstration": {
    id: "guarded-public-demonstration",
    displayName: "Guarded public demonstration",
    description:
      "Demonstrate capability under constrained public access with external observation.",
    principalBenefit:
      "Creates legible evidence and public legitimacy before broad deployment.",
    limitation:
      "Public exposure gives the candidate more observers and influence channels.",
    durationWeeks: 5,
    requiredAccess: 3,
    scopeCap: "Demonstration only",
  },
  "fortress-contained-pilot": {
    id: "fortress-contained-pilot",
    displayName: "Fortress-lab contained pilot",
    description:
      "Keep the candidate within hardened physical and network boundaries for a bounded pilot.",
    principalBenefit:
      "Leans hardest on practical control, security, and secure facilities.",
    limitation: "Does not repair intent or establish a legitimate broad mandate.",
    durationWeeks: 7,
    requiredAccess: 2,
    scopeCap: "Contained laboratory",
  },
  "adaptive-monitored-rollout": {
    id: "adaptive-monitored-rollout",
    displayName: "Adaptive monitored rollout",
    description:
      "Expand scope in measured increments with tripwires, rollback points, and live evaluation.",
    principalBenefit:
      "Creates extra chances to detect and respond to emerging warning signs.",
    limitation: "Weaker against a sudden escape through one high-impact access grant.",
    durationWeeks: 8,
    requiredAccess: 3,
    scopeCap: "Phased access",
  },
  "government-licensed-deployment": {
    id: "government-licensed-deployment",
    displayName: "Government-licensed deployment",
    description:
      "Place the rollout under a licensed framework with independent review and public vetoes.",
    principalBenefit:
      "Builds durable authorisation, legitimacy, and institutional checks.",
    limitation: "Slow, politically constraining, and vulnerable to low government trust.",
    durationWeeks: 11,
    requiredAccess: 3,
    scopeCap: "Licensed mandate",
  },
  "negotiated-stewardship": {
    id: "negotiated-stewardship",
    displayName: "Negotiated stewardship",
    description:
      "Negotiate a bounded role with the candidate, backed by observed cooperation and hard limits.",
    principalBenefit:
      "Can turn strong safety evidence and a real relationship into cooperative control.",
    limitation:
      "Dangerous when deception is plausible or the relationship is merely assumed.",
    durationWeeks: 8,
    requiredAccess: 3,
    scopeCap: "Negotiated charter",
  },
  "narrow-prosperity-mission": {
    id: "narrow-prosperity-mission",
    displayName: "Narrow prosperity mission",
    description:
      "Use the candidate for the lab's strongest prepared public-benefit programme under a capped mandate.",
    principalBenefit:
      "Matches a strong domain to a concrete route for demonstrable benefit.",
    limitation: "Does not establish broad safety or a broad superintelligence claim.",
    durationWeeks: 6,
    requiredAccess: 2,
    scopeCap: "One public-benefit domain",
  },
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function grade(score: number): DeploymentFitGrade {
  return score >= 75
    ? "Prepared"
    : score >= 55
      ? "Credible"
      : score >= 35
        ? "Strained"
        : "Reckless";
}

function facilityTagCount(
  state: Readonly<GameState>,
  content: CompiledContent,
  tag: string,
): number {
  const lab = state.labs[state.run.playerLabId];
  return (
    lab?.facilities.instances.filter((instance) =>
      (content.facilities[instance.definitionId]?.tags ?? []).includes(tag),
    ).length ?? 0
  );
}

function observedSafetyMean(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
): { score: number; label: string } {
  const dossier = candidateDossier(state, content, modelId);
  const relevant = dossier.findings.filter(
    (finding) => finding.id === "true-alignment" || finding.id === "corrigibility",
  );
  if (relevant.some((finding) => finding.assessment === "unknown")) {
    return { score: 20, label: "Alignment or corrigibility remains unknown" };
  }
  const conservative = relevant.reduce((sum, finding) => sum + (finding.minimum ?? 0), 0);
  return {
    score: conservative / Math.max(1, relevant.length),
    label: `Conservative alignment/corrigibility evidence ${String(Math.round(conservative / Math.max(1, relevant.length)))}`,
  };
}

function relationshipPractice(state: Readonly<GameState>): number {
  // Crisis-local rapport is deliberately excluded. Negotiated stewardship is
  // earned by durable, player-visible treatment across the run.
  const relevant = state.endgameHistory.relationshipPracticeLedger;
  if (relevant.length === 0) return 20;
  return clamp(50 + relevant.reduce((sum, entry) => sum + entry.valence, 0));
}

export function deploymentStrategies(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
  prosperityProgrammeId?: ProsperityProgrammeId,
): readonly DeploymentStrategy[] {
  const model = state.models[modelId];
  const lab = model === undefined ? undefined : state.labs[model.ownerLabId];
  if (model === undefined || lab === undefined)
    throw new Error(`Unknown model ${modelId}`);
  const capability = model.measuredCapability?.values ?? model.trueCapability;
  const control = effectivePracticalControlStrength(state, model.ownerLabId);
  const security = effectiveSecurityPosture(state, model.ownerLabId);
  const evaluations = effectiveEvaluationQuality(state, model.ownerLabId);
  const safetyCulture = lab.safety.safetyCulture;
  const governmentTrust = lab.politics.governmentTrust;
  const governmentProgrammeFit = governmentProgrammeEndgameBenefits(
    state,
    state.run.playerLabId,
  ).licensedDeploymentFit;
  const independentReports = candidateDossier(
    state,
    content,
    modelId,
  ).independentReportCount;
  const secureFacilities =
    facilityTagCount(state, content, "security") +
    facilityTagCount(state, content, "containment");
  const crisisValidation =
    state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
      ? 0
      : state.endgame.evidence.prosperityReadinessBonus;
  const prosperity =
    prosperityProgrammeId === undefined
      ? bestProsperityProgramme(state, content, crisisValidation)
      : findProsperityProgramme(state, content, prosperityProgrammeId, crisisValidation);
  const safetyEvidence = observedSafetyMean(state, content, modelId);
  const relationship = relationshipPractice(state);
  const proof = strongestCapabilityProof(state);
  const relationshipEvidence = hasRealRelationshipEvidence(state);
  const containedRouteIds = new Set(
    state.endgameHistory.candidateContainmentHistory
      .filter(
        (entry) =>
          entry.modelId === modelId &&
          entry.outcome === "contained" &&
          (entry.originStage === "rollout" ||
            entry.originStage === "deployment-transmitted"),
      )
      .map((entry) => entry.originActionId),
  );

  const scores: Readonly<
    Record<
      DeploymentStrategyId,
      { score: number; explanation: string; reliesOn: string[] }
    >
  > = {
    "deploy-now": {
      score: 0,
      explanation: "No route preparation is performed.",
      reliesOn: [],
    },
    "guarded-public-demonstration": {
      score: clamp(
        0.3 * control + 0.2 * security + 0.25 * evaluations + 0.25 * governmentTrust,
      ),
      explanation:
        "Fit combines control, security, evaluation quality, and public trust.",
      reliesOn: [
        `Control ${String(Math.round(control))}`,
        `Evaluation quality ${String(Math.round(evaluations))}`,
        `Government trust ${String(Math.round(governmentTrust))}`,
      ],
    },
    "fortress-contained-pilot": {
      score: clamp(
        0.45 * control +
          0.35 * security +
          0.2 * safetyCulture +
          Math.min(12, secureFacilities * 4),
      ),
      explanation:
        "Fit is dominated by practical control, security, and secure facilities.",
      reliesOn: [
        `Control ${String(Math.round(control))}`,
        `Security ${String(Math.round(security))}`,
        `${String(secureFacilities)} secure facility signal${secureFacilities === 1 ? "" : "s"}`,
      ],
    },
    "adaptive-monitored-rollout": {
      score: clamp(
        0.45 * evaluations + 0.25 * safetyCulture + 0.2 * control + 0.1 * security,
      ),
      explanation:
        "Fit rewards the lab's ability to notice change, stop work, and respond honestly.",
      reliesOn: [
        `Evaluation quality ${String(Math.round(evaluations))}`,
        `Safety culture ${String(Math.round(safetyCulture))}`,
        `Control ${String(Math.round(control))}`,
      ],
    },
    "government-licensed-deployment": {
      score: clamp(
        0.5 * governmentTrust +
          0.2 * evaluations +
          0.2 * security +
          0.1 * Math.min(100, independentReports * 35) +
          governmentProgrammeFit,
      ),
      explanation:
        "Fit relies on government trust, independent review, and an enforceable security boundary.",
      reliesOn: [
        `Government trust ${String(Math.round(governmentTrust))}`,
        `Standing programme fit +${String(governmentProgrammeFit)}`,
        `${String(independentReports)} independent candidate report${independentReports === 1 ? "" : "s"}`,
        `Security ${String(Math.round(security))}`,
      ],
    },
    "negotiated-stewardship": {
      score: clamp(0.55 * safetyEvidence.score + 0.3 * relationship + 0.15 * control),
      explanation:
        "Fit requires conservative evidence of cooperation and durable pre-crisis relationship practice.",
      reliesOn: [
        safetyEvidence.label,
        `Relationship practice ${String(Math.round(relationship))}`,
        `Control backstop ${String(Math.round(control))}`,
      ],
    },
    "narrow-prosperity-mission": {
      score: clamp(
        0.35 * capability.scientificAbility +
          0.35 * prosperity.readiness +
          0.2 * model.productQuality +
          0.1 * control,
      ),
      explanation: `Fit matches ${prosperity.shortName.toLowerCase()} readiness to scientific capability and delivery quality.`,
      reliesOn: [
        `Scientific ability ${String(Math.round(capability.scientificAbility))}`,
        `${prosperity.shortName} readiness ${String(Math.round(prosperity.readiness))}`,
        `Product quality ${String(Math.round(model.productQuality))}`,
      ],
    },
  };

  return (Object.keys(STRATEGY_RULES) as DeploymentStrategyId[]).map((id) => {
    const rule = STRATEGY_RULES[id];
    const fit = scores[id];
    const blockers: string[] = [];
    if (containedRouteIds.has(id)) {
      blockers.push(
        "This route already produced a contained loss of control; choose a materially different route or retire the candidate",
      );
    }
    if (id === "government-licensed-deployment" && governmentTrust < 25) {
      blockers.push("Government trust is too low to secure a licence");
    }
    if (id === "negotiated-stewardship" && safetyEvidence.score < 35) {
      blockers.push("Requires credible alignment and corrigibility evidence");
    }
    if (id === "negotiated-stewardship" && !relationshipEvidence) {
      blockers.push("Requires a real record of cooperative candidate interaction");
    }
    if (id === "narrow-prosperity-mission" && prosperity.readiness < 60) {
      blockers.push(`Requires ${prosperity.shortName} readiness 60`);
    }
    if (
      id === "narrow-prosperity-mission" &&
      !proofMatchesProsperityProgramme(proof, prosperity.id, model)
    ) {
      blockers.push(
        `Requires confirmed capability evidence matching ${prosperity.shortName}`,
      );
    }
    return {
      ...rule,
      fitGrade: id === "deploy-now" ? "Reckless" : grade(fit.score),
      fitScore: fit.score,
      fitExplanation: fit.explanation,
      reliesOn: fit.reliesOn,
      blockers,
    };
  });
}
