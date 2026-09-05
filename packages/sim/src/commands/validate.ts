import type { CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import { gpuAllocationSchema } from "../model/schema.ts";
import type { GameState } from "../model/state.ts";
import { gpuCount, tick } from "../model/units.ts";
import {
  hasLargeCapabilityDomainSwing,
  normaliseAllocation,
  planGpuPortfolio,
} from "../compute/gpu-portfolio.ts";
import { formatTeraflops } from "../compute/flops.ts";
import { quoteGpuPurchase, quoteGpuSale } from "../compute/gpu-market.ts";
import { forecastFinance } from "../finance/finance.ts";
import { formatValuation } from "../finance/valuation.ts";
import {
  forecastUsage,
  MARKET_CYCLE_WEEKS,
  projectServingAura,
  PUBLIC_PRICE_TIERS,
  settledServingPhysicalGpusFor,
} from "../market/market.ts";
import { quoteFacilityConstruction } from "../facilities/facilities.ts";
import {
  quoteFundingOffer,
  quoteFundraisingCampaign,
} from "../fundraising/fundraising.ts";
import { quoteTrainingRun } from "../training/training.ts";
import { quoteAnomalyAction, quoteEvaluation } from "../evaluations/evaluations.ts";
import {
  quoteDeploymentAura,
  quoteProductisation,
} from "../productisation/productisation.ts";
import { quoteRecruitment } from "../researchers/talent-market.ts";
import { quoteResearcherAssignment } from "../researchers/assignments.ts";
import { quoteResearcherCommitment } from "../researchers/commitments.ts";
import {
  calculatePaperPublicationAura,
  calculatePaperPublicationScore,
  describePaperScientificPayload,
} from "../research/papers.ts";
import { previewEventOption } from "../events/event-engine.ts";
import {
  AGI_COMPONENT_RULES,
  quoteAgiComponent,
} from "../endgame/candidate-programme.ts";
import {
  GOVERNMENT_PROGRAMMES,
  quoteGovernmentProgramme,
  quoteGovernmentProgrammeExit,
  quoteLobbyingProject,
} from "../politics/politics.ts";
import {
  quoteRivalDiplomacy,
  RIVAL_DIPLOMACY_DISABLED_REASON,
  RIVAL_DIPLOMACY_ENABLED,
} from "../rivals/diplomacy.ts";
import {
  evaluateCoalitionEligibility,
  quoteCoalitionProject,
  COALITION_DISABLED_REASON,
  COALITION_MECHANIC_ENABLED,
  quoteCoalitionProposal,
} from "../coalition/coalition.ts";
import { measuredFrontierCapability, quoteCandidateAccess } from "../endgame/access.ts";
import {
  autonomyBenefitLabel,
  autonomyCostLabel,
  quoteStandingAutonomy,
} from "../models/autonomy.ts";
import {
  quoteCandidateSafetyResponse,
  quoteCapabilityProofProject,
} from "../endgame/crisis-stages.ts";
import {
  CAPABILITY_CHALLENGE_RULES,
  CAPABILITY_VERIFIER_RULES,
} from "../endgame/capability-proof.ts";
import {
  candidateDeclarationCooldownRemaining,
  isEligibleProgrammeCandidate,
  isValidFormalProgrammeCandidate,
} from "../endgame/candidate-programme.ts";
import { DEPLOYMENT_MODE_RULES, quoteDeploymentMode } from "../endgame/resolution.ts";
import { rolloutDecisionOptions } from "../endgame/rollout.ts";
import { emergencyResponseRules } from "../endgame/containment-failure.ts";
import {
  quoteCandidateRetirement,
  RETIREMENT_DISPOSITIONS,
  RETIREMENT_PROCEDURES,
} from "../endgame/retirement.ts";
import { quoteDeploymentTransmission } from "../endgame/deployment-command.ts";
import {
  deploymentStrategies,
  PLAYER_SELECTABLE_DEPLOYMENT_MODE_IDS,
} from "../endgame/deployment-strategies.ts";
import {
  quoteCandidateIncidentReview,
  quoteCandidateIsolation,
} from "../endgame/candidate-lifecycle.ts";
import { inFlightOrdinaryTrainingProjectIds } from "../endgame/training-commitment.ts";
import {
  PROSPERITY_PROGRAMME_IDS,
  bestProsperityProgramme,
  findProsperityProgramme,
} from "../prosperity/prosperity.ts";
import {
  quoteDismissal,
  quoteRetentionOffer,
  quoteUltimatumResponse,
} from "../researchers/people.ts";
import type {
  CommandValidation,
  ChooseGenericAdvanceCommand,
  ChoosePublicationPolicyCommand,
  GameCommand,
  RuleViolation,
  BuyGpusCommand,
  SellGpusCommand,
  SetGpuAllocationCommand,
  SetPublicPriceCommand,
  StartFacilityConstructionCommand,
  StartTrainingRunCommand,
  StartEvaluationCommand,
  DismissAnomalyCommand,
  InvestigateAnomalyCommand,
  StartProductisationCommand,
  SetModelDeploymentPolicyCommand,
  AssignResearcherCommand,
  RecruitResearcherCommand,
  StartResearcherCommitmentCommand,
  SubmitRetentionOfferCommand,
  ResolveResearcherUltimatumCommand,
  DismissResearcherCommand,
  StartFundraisingCampaignCommand,
  AcceptFundingOfferCommand,
  StartLobbyingProjectCommand,
  ConductRivalDiplomacyCommand,
  ProposeCoalitionCommand,
  StartCoalitionProjectCommand,
  RatifyCoalitionCommand,
  RespondToDecisionEventCommand,
  SetCandidateAccessCommand,
  IsolateCandidateArtifactCommand,
  ResolveCandidateIncidentCommand,
  NominateCandidateCommand,
  CommitCapabilityProofCommand,
  CommitCandidateSafetyResponseCommand,
  ResolvePressureCollisionCommand,
  EnterFinalReviewCommand,
  ChooseDeploymentModeCommand,
  ResolveRolloutDecisionCommand,
  ResolveContainmentFailureCommand,
  ConfigureCandidateRetirementCommand,
  TransmitCandidateRetirementCommand,
  ChoosePostRetirementPathCommand,
  ChooseFalseDawnPathCommand,
  TransmitDeploymentCommand,
  AdvanceWorldWaitingCommand,
} from "./types.ts";
import {
  FALSE_DAWN_ENDING_ID,
  falseDawnMoratoriumBlocker,
} from "../endgame/nonterminal-outcome.ts";
import {
  isProgressiveCampaign,
  labMaturityCommandBlocker,
  labMaturityStage,
} from "../campaign/lab-maturity.ts";

function rejectUnsupportedCommand(command: never, errors: RuleViolation[]): void {
  const kind = (command as unknown as { readonly kind?: unknown }).kind;
  errors.push({
    code: "unsupported-command",
    message:
      typeof kind === "string"
        ? `Command "${kind}" is no longer supported; refresh the page to load the current controls`
        : "This command is not supported; refresh the page to load the current controls",
  });
}

const PUBLICATION_POLICIES = [
  "publish-openly",
  "controlled-publication",
  "keep-secret",
  "release-everything",
] as const;
const PRESSURE_COLLISION_OPTIONS = ["delay", "comply", "push-ahead"] as const;
const CONTAINMENT_FAILURE_ACTIONS = [
  "continue",
  "trip-physical-breakers",
  "sever-credentials-and-network",
  "invoke-government-protocol",
  "request-candidate-halt",
] as const;
const DEPLOYMENT_MODE_IDS = Object.keys(DEPLOYMENT_MODE_RULES) as Array<
  keyof typeof DEPLOYMENT_MODE_RULES
>;

const ALLOCATION_SUM = 10_000;

function validateSetGpuAllocation(
  state: GameState,
  content: CompiledContent,
  command: SetGpuAllocationCommand,
  errors: RuleViolation[],
): void {
  const lab = state.labs[command.labId];
  if (lab === undefined) {
    errors.push({ code: "unknown-lab", message: `No lab ${command.labId}` });
    return;
  }
  if (
    (lab.control === "rival" && command.meta.issuedBy !== "rival") ||
    (lab.control === "player" && command.meta.issuedBy === "rival")
  ) {
    errors.push({
      code: "not-player-lab",
      message: "Command issuer does not control this lab",
    });
    return;
  }
  // Runtime boundary validation (TDD 8.2): the web app cannot enforce
  // compile-time types, and an unvalidated payload that reaches canonical
  // state would make later saves unloadable under the strict load schema.
  const parsedAllocation = gpuAllocationSchema.safeParse(command.allocation);
  if (!parsedAllocation.success) {
    const issue = parsedAllocation.error.issues[0];
    errors.push({
      code: "malformed-allocation",
      message: `Allocation payload invalid at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? "?"}`,
    });
    return;
  }
  const allocation = parsedAllocation.data;
  const domainSum = Object.values(allocation.capabilityDomainWeights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (domainSum !== ALLOCATION_SUM) {
    errors.push({
      code: "allocation-sum",
      message: `Capability domain weights must sum to 10000 basis points, got ${String(domainSum)}`,
    });
  }
  const safetySum = Object.values(allocation.safetyProgramWeights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (safetySum !== ALLOCATION_SUM) {
    errors.push({
      code: "allocation-sum",
      message: `Safety programme weights must sum to 10000 basis points, got ${String(safetySum)}`,
    });
  }
  for (const domainId of Object.keys(allocation.capabilityDomainWeights)) {
    if (!(domainId in lab.research.domains)) {
      errors.push({
        code: "unknown-domain",
        message: `Allocation references locked or unknown domain ${domainId}`,
      });
    }
  }
}

function validatePlayerLab(
  state: GameState,
  labId: SetGpuAllocationCommand["labId"],
  errors: RuleViolation[],
  issuedBy: import("./types.ts").CommandMeta["issuedBy"] = "player",
): boolean {
  const lab = state.labs[labId];
  if (lab === undefined) {
    errors.push({ code: "unknown-lab", message: `No lab ${labId}` });
    return false;
  }
  if (
    (lab.control === "rival" && issuedBy !== "rival") ||
    (lab.control === "player" && issuedBy === "rival")
  ) {
    errors.push({
      code: "not-player-lab",
      message: "Command issuer does not control this lab",
    });
    return false;
  }
  return true;
}

function validateRivalDiplomacy(
  state: GameState,
  command: ConductRivalDiplomacyCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  // TODO(diplomacy-redesign): entry point disabled; see diplomacy.ts.
  if (!RIVAL_DIPLOMACY_ENABLED) {
    errors.push({ code: "diplomacy-disabled", message: RIVAL_DIPLOMACY_DISABLED_REASON });
    return;
  }
  try {
    const quote = quoteRivalDiplomacy(
      state,
      command.labId,
      command.rivalLabId,
      command.action,
    );
    for (const blocker of quote.blockers) {
      errors.push({
        code:
          blocker === "Insufficient cash"
            ? "insufficient-cash"
            : blocker === "Insufficient Aura"
              ? "insufficient-aura"
              : "diplomacy-blocked",
        message: blocker,
      });
    }
  } catch (error) {
    errors.push({
      code: "invalid-rival-diplomacy",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateCoalitionProposal(
  state: GameState,
  command: ProposeCoalitionCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  // TODO(coalition-redesign): entry point disabled; see coalition.ts.
  if (!COALITION_MECHANIC_ENABLED) {
    errors.push({ code: "coalition-disabled", message: COALITION_DISABLED_REASON });
    return;
  }
  try {
    for (const blocker of quoteCoalitionProposal(
      state,
      command.labId,
      command.rivalLabIds,
      command.governmentMember,
      command.independentBodyMember,
    ).blockers) {
      errors.push({ code: "coalition-proposal-blocked", message: blocker });
    }
  } catch (error) {
    errors.push({
      code: "invalid-coalition-proposal",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateCoalitionProject(
  state: GameState,
  content: CompiledContent,
  command: StartCoalitionProjectCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  // TODO(coalition-redesign): entry point disabled; see coalition.ts.
  if (!COALITION_MECHANIC_ENABLED) {
    errors.push({ code: "coalition-disabled", message: COALITION_DISABLED_REASON });
    return;
  }
  try {
    for (const blocker of quoteCoalitionProject(
      state,
      content,
      command.labId,
      command.coalitionId,
      command.projectType,
      command.contributorLabId,
      command.assetKind,
    ).blockers) {
      errors.push({
        code:
          blocker === "Insufficient cash"
            ? "insufficient-cash"
            : blocker === "Insufficient Aura"
              ? "insufficient-aura"
              : "coalition-project-blocked",
        message: blocker,
      });
    }
  } catch (error) {
    errors.push({
      code: "invalid-coalition-project",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateCoalitionRatification(
  state: GameState,
  command: RatifyCoalitionCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  // TODO(coalition-redesign): entry point disabled; see coalition.ts.
  if (!COALITION_MECHANIC_ENABLED) {
    errors.push({ code: "coalition-disabled", message: COALITION_DISABLED_REASON });
    return;
  }
  try {
    const coalition = state.world.coalitions[command.coalitionId];
    if (coalition === undefined)
      throw new Error(`Unknown coalition ${command.coalitionId}`);
    if (coalition.proposerLabId !== command.labId) {
      errors.push({
        code: "coalition-not-owned",
        message: "Player does not own this process",
      });
    }
    if (coalition.status !== "ratifying") {
      errors.push({
        code: "coalition-not-ratifying",
        message: "Coalition has not reached ratification",
      });
    }
    const eligibility = evaluateCoalitionEligibility(state, command.coalitionId);
    for (const check of eligibility.checks.filter((candidate) => !candidate.satisfied)) {
      errors.push({
        code: `coalition-${check.id}`,
        message: check.detail,
      });
    }
  } catch (error) {
    errors.push({
      code: "invalid-coalition-ratification",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateFacilityConstruction(
  state: GameState,
  content: CompiledContent,
  command: StartFacilityConstructionCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  let quote;
  try {
    quote = quoteFacilityConstruction(
      state,
      content,
      command.labId,
      command.definitionId,
    );
  } catch (error) {
    errors.push({
      code: "unknown-facility",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash" ? "insufficient-cash" : "facility-requirement",
      message: blocker,
    });
  }
}

function validateGpuPurchase(
  state: GameState,
  content: CompiledContent,
  command: BuyGpusCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  let quote;
  try {
    quote = quoteGpuPurchase(
      state,
      content,
      command.labId,
      command.generationId,
      command.thousandUnits,
    );
  } catch (error) {
    errors.push({
      code: "unknown-gpu-generation",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash"
          ? "insufficient-cash"
          : blocker.includes("can be ordered again")
            ? "gpu-procurement-cooldown"
            : "gpu-requirement",
      message: blocker,
    });
  }
}

function validateGpuSale(
  state: GameState,
  content: CompiledContent,
  command: SellGpusCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  let quote;
  try {
    quote = quoteGpuSale(
      state,
      content,
      command.labId,
      command.generationId,
      command.thousandUnits,
    );
  } catch (error) {
    errors.push({
      code: "unknown-gpu-generation",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({ code: "gpu-sale-blocked", message: blocker });
  }
}

function validatePublicPrice(
  state: GameState,
  command: SetPublicPriceCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const requested: unknown = command.priceTier;
  if (
    typeof requested !== "string" ||
    !PUBLIC_PRICE_TIERS.some((tier) => tier === requested)
  ) {
    errors.push({
      code: "unknown-price-tier",
      message: `Unknown public price tier ${String(requested)}`,
    });
    return;
  }
  const market = state.labs[command.labId]?.market;
  if (
    market !== undefined &&
    (market.pendingPriceTier ?? market.priceTier) === requested
  ) {
    errors.push({ code: "price-unchanged", message: "That price tier is already set" });
  }
}

function validateFundraisingCampaign(
  state: GameState,
  content: CompiledContent,
  command: StartFundraisingCampaignCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    const quote = quoteFundraisingCampaign(
      state,
      content,
      command.labId,
      command.campaign,
    );
    for (const blocker of quote.blockers) {
      errors.push({
        code:
          blocker === "Insufficient Aura" ? "insufficient-aura" : "fundraising-blocked",
        message: blocker,
      });
    }
  } catch (error) {
    errors.push({
      code: "invalid-fundraising-campaign",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateAcceptFundingOffer(
  state: GameState,
  command: AcceptFundingOfferCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    for (const blocker of quoteFundingOffer(state, command.labId, command.offerId)
      .blockers) {
      errors.push({ code: "funding-offer-blocked", message: blocker });
    }
  } catch (error) {
    errors.push({
      code: "invalid-funding-offer",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateLobbyingProject(
  state: GameState,
  content: CompiledContent,
  command: StartLobbyingProjectCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    const quote = quoteLobbyingProject(
      state,
      content,
      command.labId,
      command.objective,
      command.approach,
    );
    for (const blocker of quote.blockers) {
      errors.push({
        code:
          blocker === "Insufficient cash"
            ? "insufficient-cash"
            : blocker === "Insufficient Aura"
              ? "insufficient-aura"
              : "lobbying-blocked",
        message: blocker,
      });
    }
  } catch (error) {
    errors.push({
      code: "invalid-lobbying-project",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateGenericAdvance(
  state: GameState,
  content: CompiledContent,
  command: ChooseGenericAdvanceCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const lab = state.labs[command.labId];
  if (lab === undefined) return;
  const pending = lab.research.pendingGenericAdvances.find(
    (candidate) =>
      candidate.programId === command.programId &&
      candidate.threshold === command.threshold,
  );
  if (pending === undefined) {
    errors.push({
      code: "generic-advance-not-pending",
      message: "That advance choice is not pending",
    });
    return;
  }
  if (!pending.optionIds.includes(command.optionId)) {
    errors.push({
      code: "generic-advance-option",
      message: "That option is not offered for this advance",
    });
    return;
  }
  const definition = content.research.genericAdvances[command.optionId];
  if (
    definition === undefined ||
    definition.programId !== command.programId ||
    definition.threshold !== command.threshold
  ) {
    errors.push({
      code: "generic-advance-content",
      message: "The offered advance is missing from content",
    });
  }
}

function validatePublicationPolicy(
  state: GameState,
  content: CompiledContent,
  command: ChoosePublicationPolicyCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (!PUBLICATION_POLICIES.some((policy) => policy === command.policy)) {
    errors.push({
      code: "unknown-publication-policy",
      message: "Unknown publication policy",
    });
    return;
  }
  const paper = content.papers.definitions[command.paperId];
  const discovery = state.world.paperRace.discoveries[command.paperId];
  if (paper === undefined || discovery === undefined) {
    errors.push({
      code: "unknown-paper-discovery",
      message: "That paper has not been discovered",
    });
  } else if (discovery.discovererLabId !== command.labId) {
    errors.push({
      code: "not-paper-discoverer",
      message: "Only the discovering lab chooses this policy",
    });
  } else if (discovery.publicationPolicy !== undefined) {
    errors.push({
      code: "publication-policy-chosen",
      message: "A publication policy is already locked",
    });
  }
}

function validateStartTrainingRun(
  state: GameState,
  content: CompiledContent,
  command: StartTrainingRunCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  let quote;
  try {
    quote = quoteTrainingRun(state, content, command);
  } catch (error) {
    errors.push({
      code: "invalid-training-recipe",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    const isFailureCooldown = blocker.startsWith(
      "The team is debugging the last failed run",
    );
    errors.push({
      code: isFailureCooldown
        ? "training-failure-cooldown"
        : blocker === "Insufficient cash"
          ? "insufficient-cash"
          : blocker.includes("GPU")
            ? "insufficient-training-gpus"
            : "training-requirement",
      message: blocker,
    });
  }
}

function validateStartEvaluation(
  state: GameState,
  content: CompiledContent,
  command: StartEvaluationCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  let quote;
  try {
    quote = quoteEvaluation(state, content, command);
  } catch (error) {
    errors.push({
      code: "invalid-evaluation",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash"
          ? "insufficient-cash"
          : blocker === "Insufficient Aura"
            ? "insufficient-aura"
            : blocker.includes("unreserved")
              ? "insufficient-evaluation-gpus"
              : "evaluation-requirement",
      message: blocker,
    });
  }
}

function validateAnomalyAction(
  state: GameState,
  content: CompiledContent,
  command: DismissAnomalyCommand | InvestigateAnomalyCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const anomaly = state.anomalies[command.anomalyId];
  if (anomaly === undefined || anomaly.ownerLabId !== command.labId) {
    errors.push({ code: "unknown-anomaly", message: "Anomaly not found" });
    return;
  }
  const statusAllowed =
    command.kind === "investigate-anomaly"
      ? anomaly.status === "unresolved" ||
        anomaly.status === "inconclusive" ||
        anomaly.status === "confirmed"
      : anomaly.status === "unresolved";
  if (!statusAllowed) {
    errors.push({
      code: "anomaly-not-unresolved",
      message:
        command.kind === "investigate-anomaly"
          ? "Only an unresolved, inconclusive, or confirmed anomaly can be acted on"
          : "Only an unresolved anomaly can be dismissed",
    });
  }
  if (command.kind === "investigate-anomaly" && statusAllowed) {
    const quote = quoteAnomalyAction(state, content, command.anomalyId);
    for (const blocker of quote.blockers) {
      errors.push({
        code: blocker === "Insufficient Aura" ? "insufficient-aura" : "insufficient-cash",
        message: blocker,
      });
    }
  }
}

function validateStartProductisation(
  state: GameState,
  content: CompiledContent,
  command: StartProductisationCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  let quote;
  try {
    quote = quoteProductisation(state, content, command);
  } catch (error) {
    errors.push({
      code: "invalid-productisation",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash"
          ? "insufficient-cash"
          : "productisation-requirement",
      message: blocker,
    });
  }
}

function validateModelDeploymentPolicy(
  state: GameState,
  content: CompiledContent,
  command: SetModelDeploymentPolicyCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors, command.meta.issuedBy)) return;
  const model = state.models[command.modelId];
  const policy = content.deployment.policies[command.policy];
  if (model === undefined || model.ownerLabId !== command.labId) {
    errors.push({ code: "unknown-model", message: "Model not found" });
    return;
  }
  if (policy === undefined) {
    errors.push({ code: "unknown-deployment-policy", message: "Unknown policy" });
    return;
  }
  if ((model.deployment.plannedPolicy ?? model.deployment.policy) === command.policy) {
    errors.push({ code: "deployment-unchanged", message: "That policy is already set" });
  }
  if (model.deployment.irreversible) {
    errors.push({
      code: "deployment-irreversible",
      message: "Released weights cannot be made exclusive again",
    });
  }
  if (
    model.flags["endgame:false-dawn-long-pause-archive"] === true &&
    command.policy !== "internal-only"
  ) {
    errors.push({
      code: "long-pause-archive-sealed",
      message:
        "The model was surrendered to a verified Long Pause archive and cannot be deployed",
    });
  }
}

function validateRecruitment(
  state: GameState,
  content: CompiledContent,
  command: RecruitResearcherCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  let quote;
  try {
    quote = quoteRecruitment(state, content, command.labId, command.researcherId);
  } catch (error) {
    errors.push({
      code: "invalid-recruitment",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash"
          ? "insufficient-cash"
          : blocker === "Insufficient Aura"
            ? "insufficient-aura"
            : "recruitment-requirement",
      message: blocker,
    });
  }
}

function validateResearcherCommitment(
  state: GameState,
  content: CompiledContent,
  command: StartResearcherCommitmentCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  let quote;
  try {
    quote = quoteResearcherCommitment(
      state,
      content,
      command.labId,
      command.researcherId,
    );
  } catch (error) {
    errors.push({
      code: "invalid-researcher-commitment",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const blocker of quote.blockers) {
    errors.push({
      code: blocker.startsWith("Requires $")
        ? "insufficient-cash"
        : "researcher-commitment-requirement",
      message: blocker,
    });
  }
}

function validateResearcherAssignment(
  state: GameState,
  content: CompiledContent,
  command: AssignResearcherCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    appendPeopleBlockers(
      quoteResearcherAssignment(
        state,
        content,
        command.labId,
        command.researcherId,
        command.assignment,
      ).blockers,
      errors,
    );
  } catch (error) {
    errors.push({
      code: "invalid-researcher-assignment",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function appendPeopleBlockers(
  blockers: readonly string[],
  errors: RuleViolation[],
): void {
  for (const blocker of blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash"
          ? "insufficient-cash"
          : blocker === "Insufficient Aura"
            ? "insufficient-aura"
            : "researcher-requirement",
      message: blocker,
    });
  }
}

function validateRetentionOffer(
  state: GameState,
  command: SubmitRetentionOfferCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    appendPeopleBlockers(
      quoteRetentionOffer(state, command.labId, command.researcherId, command.offer)
        .blockers,
      errors,
    );
  } catch (error) {
    errors.push({
      code: "invalid-retention-offer",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateUltimatumResponse(
  state: GameState,
  command: ResolveResearcherUltimatumCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    appendPeopleBlockers(
      quoteUltimatumResponse(state, command.labId, command.researcherId, command.response)
        .blockers,
      errors,
    );
  } catch (error) {
    errors.push({
      code: "invalid-ultimatum-response",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateDismissResearcher(
  state: GameState,
  content: CompiledContent,
  command: DismissResearcherCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (command.confirmed !== true) {
    errors.push({
      code: "dismissal-not-confirmed",
      message: "Researcher dismissal requires explicit confirmation",
    });
    return;
  }
  try {
    appendPeopleBlockers(
      quoteDismissal(state, content, command.labId, command.researcherId).blockers,
      errors,
    );
  } catch (error) {
    errors.push({
      code: "invalid-dismissal",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateDecisionEventResponse(
  state: GameState,
  content: CompiledContent,
  command: RespondToDecisionEventCommand,
  errors: RuleViolation[],
): void {
  try {
    const preview = previewEventOption(
      state,
      content,
      command.instanceId,
      command.optionId,
    );
    for (const blocker of preview.blockers) {
      errors.push({ code: "event-option-blocked", message: blocker });
    }
  } catch (error) {
    errors.push({
      code: "invalid-event-option",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateCandidateAccess(
  state: GameState,
  command: SetCandidateAccessCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const rawLevel: unknown = command.level;
  if (
    typeof rawLevel !== "number" ||
    !Number.isInteger(rawLevel) ||
    rawLevel < 0 ||
    rawLevel > 5
  ) {
    errors.push({
      code: "invalid-access-level",
      message: "Candidate access level must be an integer from 0 to 5",
    });
    return;
  }
  for (const blocker of quoteCandidateAccess(
    state,
    command.modelId,
    command.level,
    command.confirmationText,
  ).blockers) {
    errors.push({
      code: blocker.startsWith("Type “")
        ? "critical-confirmation-required"
        : "candidate-access-blocked",
      message: blocker,
    });
  }
}

function validateCandidateIsolation(
  state: GameState,
  command: IsolateCandidateArtifactCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  for (const blocker of quoteCandidateIsolation(state, command.modelId).blockers) {
    errors.push({ code: "candidate-isolation-blocked", message: blocker });
  }
}

function validateCandidateIncidentReview(
  state: GameState,
  command: ResolveCandidateIncidentCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  for (const blocker of quoteCandidateIncidentReview(state, command.modelId).blockers) {
    errors.push({
      code:
        blocker === "Insufficient cash"
          ? "insufficient-cash"
          : blocker === "Insufficient Aura"
            ? "insufficient-aura"
            : "candidate-incident-review-blocked",
      message: blocker,
    });
  }
}

function validateNominateCandidate(
  state: GameState,
  command: NominateCandidateCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const cooldownRemaining = candidateDeclarationCooldownRemaining(state, command.labId);
  if (cooldownRemaining > 0) {
    errors.push({
      code: "candidate-declaration-cooldown",
      message: `Candidate declarations are paused for ${String(cooldownRemaining)} more ${cooldownRemaining === 1 ? "week" : "weeks"} after False Dawn. Training and evaluation remain available.`,
    });
    return;
  }
  const model = state.models[command.modelId];
  if (
    state.endgame.stage === "evidence-sprint" &&
    state.endgame.pendingRemediation !== undefined
  ) {
    const pending = state.endgame.pendingRemediation;
    const retainingSource = command.modelId === pending.sourceModelId;
    const adoptingResult = command.modelId === pending.resultModelId;
    if (
      model === undefined ||
      model.ownerLabId !== command.labId ||
      (!retainingSource && !adoptingResult) ||
      (retainingSource && !isValidFormalProgrammeCandidate(state, model)) ||
      (adoptingResult && !isEligibleProgrammeCandidate(state, model))
    ) {
      errors.push({
        code: "candidate-remediation-not-eligible",
        message:
          "Choose one of the exact remediation artifacts that remains eligible on review",
      });
    }
    return;
  }
  if (
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation"
  ) {
    errors.push({
      code: "candidate-activation-inactive",
      message: "No qualified candidate is awaiting nomination",
    });
    return;
  }
  if (
    model === undefined ||
    model.ownerLabId !== command.labId ||
    (state.endgame.stage === "candidate-activation" &&
      !state.endgame.eligibleModelIds.includes(command.modelId)) ||
    !isEligibleProgrammeCandidate(state, model)
  ) {
    errors.push({
      code: "candidate-not-eligible",
      message: "That exact weight artifact is no longer eligible for formal candidacy",
    });
  }
  const inFlightTraining = inFlightOrdinaryTrainingProjectIds(state, command.labId);
  if (inFlightTraining.length > 0 && command.abandonInFlightTraining !== true) {
    errors.push({
      code: "candidate-training-commitment-required",
      message:
        "Finish the lab's current training programme, or explicitly abandon it before formal nomination",
    });
  }
}

function validateCapabilityProof(
  state: GameState,
  content: CompiledContent,
  command: CommitCapabilityProofCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (!(command.challengeId in CAPABILITY_CHALLENGE_RULES)) {
    errors.push({
      code: "invalid-capability-challenge",
      message: "Unknown capability challenge",
    });
    return;
  }
  if (
    command.verifierId !== undefined &&
    !(command.verifierId in CAPABILITY_VERIFIER_RULES)
  ) {
    errors.push({
      code: "invalid-capability-verifier",
      message: "Unknown capability verifier",
    });
    return;
  }
  try {
    const quote = quoteCapabilityProofProject(
      state,
      content,
      command.labId,
      command.challengeId,
      command.verifierId,
    );
    for (const blocker of quote.blockers) {
      errors.push({ code: "capability-proof-blocked", message: blocker });
    }
  } catch (error) {
    errors.push({
      code: "capability-proof-inactive",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validateCandidateSafetyResponse(
  state: GameState,
  content: CompiledContent,
  command: CommitCandidateSafetyResponseCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  try {
    const quote = quoteCandidateSafetyResponse(
      state,
      content,
      command.labId,
      command.responseId,
    );
    for (const blocker of quote.blockers) {
      errors.push({ code: "candidate-safety-response-blocked", message: blocker });
    }
  } catch (error) {
    errors.push({
      code: "candidate-safety-response-invalid",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function validatePressureCollisionResponse(
  state: GameState,
  command: ResolvePressureCollisionCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const rawOption: unknown = command.optionId;
  if (
    typeof rawOption !== "string" ||
    !PRESSURE_COLLISION_OPTIONS.includes(
      rawOption as (typeof PRESSURE_COLLISION_OPTIONS)[number],
    )
  ) {
    errors.push({ code: "invalid-pressure-response", message: "Unknown response" });
    return;
  }
  if (state.endgame.stage !== "pressure-collision" || state.endgame.resolved) {
    errors.push({
      code: "pressure-collision-inactive",
      message: "There is no unresolved pressure collision",
    });
  }
}

function validateEnterFinalReview(
  state: GameState,
  command: EnterFinalReviewCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (state.endgame.stage !== "pressure-collision" || !state.endgame.resolved) {
    errors.push({
      code: "final-review-blocked",
      message: "Resolve the pressure collision before compiling final review",
    });
    return;
  }
  if (
    state.endgame.delayEndsAt !== undefined &&
    state.run.tick < state.endgame.delayEndsAt
  ) {
    errors.push({
      code: "final-review-blocked",
      message: `The pressure-response delay continues for ${String(state.endgame.delayEndsAt - state.run.tick)} week(s)`,
    });
  }
  const liveCrisisProject = state.endgame.crisisProjectIds.some((projectId) => {
    const status = state.projects[projectId]?.status;
    return status === "queued" || status === "active" || status === "paused";
  });
  if (liveCrisisProject) {
    errors.push({
      code: "final-review-blocked",
      message: "Wait for active crisis projects to finish before final review",
    });
  }
}

function validateChooseDeploymentMode(
  state: GameState,
  content: CompiledContent,
  command: ChooseDeploymentModeCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const rawMode: unknown = command.modeId;
  if (
    typeof rawMode !== "string" ||
    !DEPLOYMENT_MODE_IDS.includes(rawMode as (typeof DEPLOYMENT_MODE_IDS)[number])
  ) {
    errors.push({ code: "invalid-deployment-mode", message: "Unknown deployment mode" });
    return;
  }
  if (
    !PLAYER_SELECTABLE_DEPLOYMENT_MODE_IDS.includes(
      rawMode as (typeof PLAYER_SELECTABLE_DEPLOYMENT_MODE_IDS)[number],
    )
  ) {
    errors.push({
      code: "deployment-mode-not-player-selectable",
      message:
        "That deployment mode is an internal outcome, legacy route, or separate final-order action",
    });
    return;
  }
  if (state.endgame.stage !== "final-review") {
    errors.push({
      code: "deployment-mode-blocked",
      message: "Final review is not active",
    });
    return;
  }
  const rawProgramme: unknown = command.prosperityProgrammeId;
  if (
    rawProgramme !== undefined &&
    (typeof rawProgramme !== "string" ||
      !PROSPERITY_PROGRAMME_IDS.includes(
        rawProgramme as (typeof PROSPERITY_PROGRAMME_IDS)[number],
      ))
  ) {
    errors.push({
      code: "invalid-prosperity-programme",
      message: "Unknown Prosperity Programme",
    });
    return;
  }
  const programme =
    command.prosperityProgrammeId === undefined
      ? bestProsperityProgramme(
          state,
          content,
          state.endgame.evidence.prosperityReadinessBonus,
        )
      : findProsperityProgramme(
          state,
          content,
          command.prosperityProgrammeId,
          state.endgame.evidence.prosperityReadinessBonus,
        );
  if (!programme.unlocked) {
    errors.push({
      code: "prosperity-programme-locked",
      message: `${programme.displayName} is not unlocked`,
    });
  }
  for (const blocker of quoteDeploymentMode(
    state,
    command.modeId,
    command.confirmationText,
    programme.readiness,
    programme.id,
  ).blockers) {
    errors.push({
      code: blocker.startsWith("Type “")
        ? "critical-confirmation-required"
        : "deployment-mode-blocked",
      message: blocker,
    });
  }
  const strategy = deploymentStrategies(
    state,
    content,
    state.endgame.candidateModelId,
    programme.id,
  ).find((candidate) => candidate.id === command.modeId);
  for (const blocker of strategy?.blockers ?? []) {
    errors.push({ code: "deployment-mode-blocked", message: blocker });
  }
}

function validateRolloutDecision(
  state: GameState,
  command: ResolveRolloutDecisionCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const options = rolloutDecisionOptions(state);
  if (!options.some((option) => option.id === command.optionId)) {
    errors.push({
      code: "rollout-decision-blocked",
      message: "That response is not available for the current rollout beat",
    });
  }
}

function validateContainmentFailureAction(
  state: GameState,
  command: ResolveContainmentFailureCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const rawAction: unknown = command.actionId;
  if (
    typeof rawAction !== "string" ||
    !CONTAINMENT_FAILURE_ACTIONS.includes(
      rawAction as (typeof CONTAINMENT_FAILURE_ACTIONS)[number],
    )
  ) {
    errors.push({
      code: "invalid-containment-failure-action",
      message: "Unknown containment-failure action",
    });
    return;
  }
  if (state.endgame.stage !== "containment-failure") {
    errors.push({
      code: "containment-failure-inactive",
      message: "There is no active containment failure",
    });
    return;
  }
  if (state.endgame.beat === "decision" && command.actionId !== "continue") {
    const response = emergencyResponseRules(state).find(
      (rule) => rule.id === command.actionId,
    );
    if (response?.unavailableReason !== undefined) {
      errors.push({
        code: "emergency-response-unavailable",
        message: response.unavailableReason,
      });
    }
    return;
  }
  if (state.endgame.beat === "decision") {
    errors.push({
      code: "emergency-response-required",
      message: "Choose an emergency response",
    });
    return;
  }
  if (command.actionId !== "continue") {
    errors.push({
      code: "containment-failure-action-blocked",
      message:
        state.endgame.beat === "signal"
          ? "Acknowledge the first signal before choosing a response"
          : "The emergency response has already been chosen",
    });
  }
}

function validateConfigureCandidateRetirement(
  state: GameState,
  command: ConfigureCandidateRetirementCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (!(command.procedureId in RETIREMENT_PROCEDURES)) {
    errors.push({
      code: "invalid-retirement-procedure",
      message: "Unknown retirement procedure",
    });
    return;
  }
  if (!(command.archiveDisposition in RETIREMENT_DISPOSITIONS)) {
    errors.push({
      code: "invalid-archive-disposition",
      message: "Unknown archive disposition",
    });
    return;
  }
  for (const blocker of quoteCandidateRetirement(
    state,
    command.modelId,
    command.procedureId,
    command.archiveDisposition,
  ).blockers) {
    errors.push({ code: "candidate-retirement-blocked", message: blocker });
  }
}

function validateTransmitCandidateRetirement(
  state: GameState,
  command: TransmitCandidateRetirementCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const endgame = state.endgame;
  if (
    endgame.stage === "recovery" ||
    endgame.stage === "containment-failure" ||
    endgame.stage === "world-waiting" ||
    endgame.stage === "resolved" ||
    (endgame.stage !== "inactive" &&
      endgame.stage !== "candidate-activation" &&
      endgame.candidateModelId !== command.modelId)
  ) {
    errors.push({
      code: "stale-retirement-candidate",
      message: "That model is no longer the active retirement candidate",
    });
    return;
  }
  const inlineConfiguration =
    command.procedureId === undefined || command.archiveDisposition === undefined
      ? undefined
      : {
          procedureId: command.procedureId,
          archiveDisposition: command.archiveDisposition,
        };
  if (
    (command.procedureId === undefined) !==
    (command.archiveDisposition === undefined)
  ) {
    errors.push({
      code: "retirement-packet-incomplete",
      message:
        "The shutdown procedure and archive disposition must be transmitted together",
    });
    return;
  }
  const configuration =
    inlineConfiguration ??
    (endgame.stage === "inactive" || endgame.stage === "candidate-activation"
      ? undefined
      : endgame.retirementConfiguration);
  if (configuration === undefined) {
    errors.push({
      code: "retirement-not-configured",
      message: "Configure the shutdown procedure and archive disposition first",
    });
    return;
  }
  if (
    endgame.stage !== "inactive" &&
    endgame.stage !== "candidate-activation" &&
    endgame.retirementConfiguration !== undefined &&
    (configuration.procedureId !== endgame.retirementConfiguration.procedureId ||
      configuration.archiveDisposition !==
        endgame.retirementConfiguration.archiveDisposition)
  ) {
    errors.push({
      code: "retirement-packet-mismatch",
      message: "The transmitted retirement packet does not match its review",
    });
    return;
  }
  const quote = quoteCandidateRetirement(
    state,
    command.modelId,
    configuration.procedureId,
    configuration.archiveDisposition,
  );
  for (const blocker of quote.blockers) {
    errors.push({ code: "candidate-retirement-blocked", message: blocker });
  }
  if (command.confirmationText !== quote.confirmationPhrase) {
    errors.push({
      code: "critical-confirmation-required",
      message: `Type “${quote.confirmationPhrase}” exactly to transmit retirement`,
    });
  }
}

function validatePostRetirementPath(
  state: GameState,
  command: ChoosePostRetirementPathCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (command.path !== "successor-programme" && command.path !== "durable-moratorium") {
    errors.push({
      code: "invalid-post-retirement-path",
      message: "Unknown recovery path",
    });
    return;
  }
  if (state.endgame.stage !== "recovery") {
    errors.push({
      code: "retirement-recovery-inactive",
      message: "A verified retirement recovery is not active",
    });
  } else if (state.endgame.postRetirementChoice !== undefined) {
    errors.push({
      code: "post-retirement-path-chosen",
      message: "The post-retirement path has already been chosen",
    });
  }
}

function validateFalseDawnPath(
  state: GameState,
  command: ChooseFalseDawnPathCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (command.path !== "successor-programme" && command.path !== "durable-moratorium") {
    errors.push({
      code: "invalid-false-dawn-path",
      message: "Unknown False Dawn future",
    });
    return;
  }
  const pending = state.endgameHistory.pendingFalseDawnChoice;
  const presentation = state.presentationQueue.find(
    (item) => item.key === command.presentationKey,
  );
  if (state.endgame.stage !== "inactive" || pending === undefined) {
    errors.push({
      code: "false-dawn-choice-inactive",
      message: "A False Dawn follow-up is not active",
    });
  } else if (
    pending.presentationKey !== command.presentationKey ||
    presentation?.kind !== "endgame-return" ||
    presentation.endingId !== FALSE_DAWN_ENDING_ID
  ) {
    errors.push({
      code: "stale-false-dawn-choice",
      message: "This False Dawn outcome is no longer awaiting a decision",
    });
  } else if (
    pending.phase === "moratorium-failed" &&
    command.path === "durable-moratorium"
  ) {
    errors.push({
      code: "false-dawn-moratorium-resolved",
      message: "The Long Pause attempt has already failed; return to the race",
    });
  } else if (command.path === "durable-moratorium") {
    const blocker = falseDawnMoratoriumBlocker(state, pending.modelId);
    if (blocker !== undefined) {
      errors.push({
        code: "false-dawn-moratorium-unsealable",
        message: blocker,
      });
    }
  }
}

function validateTransmitDeployment(
  state: GameState,
  command: TransmitDeploymentCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  const activeModelId =
    state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
      ? undefined
      : state.endgame.candidateModelId;
  if (activeModelId !== command.modelId) {
    errors.push({
      code: "stale-deployment-candidate",
      message: "That exact weight artifact is no longer the active candidate",
    });
    return;
  }
  const quote = quoteDeploymentTransmission(state, command.confirmationText);
  for (const blocker of quote.blockers) {
    errors.push({
      code: blocker.startsWith("Type “")
        ? "critical-confirmation-required"
        : "candidate-deployment-blocked",
      message: blocker,
    });
  }
}

function validateAdvanceWorldWaiting(
  state: GameState,
  command: AdvanceWorldWaitingCommand,
  errors: RuleViolation[],
): void {
  if (!validatePlayerLab(state, command.labId, errors)) return;
  if (state.endgame.stage !== "world-waiting") {
    errors.push({
      code: "world-waiting-inactive",
      message: "The post-command world-waiting sequence is not active",
    });
  }
}

function previewAllocation(
  state: GameState,
  content: CompiledContent,
  command: SetGpuAllocationCommand,
) {
  const lab = state.labs[command.labId];
  if (lab === undefined) throw new Error(`Unknown lab ${command.labId}`);
  const portfolio = planGpuPortfolio(state, content, command.labId);
  return normaliseAllocation(
    command.allocation,
    lab.compute.lots.map((lot) => ({
      ...lot,
      physicalCount: gpuCount(portfolio.reservations.remainingByLot[lot.id] ?? 0),
    })),
    settledServingPhysicalGpusFor(state, content, command.labId, command.allocation),
  );
}

function previewAllocationConsequences(
  state: GameState,
  content: CompiledContent,
  command: SetGpuAllocationCommand,
) {
  const lab = state.labs[command.labId];
  if (lab === undefined) throw new Error(`Unknown lab ${command.labId}`);
  const previewState: GameState = {
    ...state,
    labs: {
      ...state.labs,
      [command.labId]: {
        ...lab,
        compute: {
          ...lab.compute,
          allocation: command.allocation,
          // Preview what the order would settle to, not last week's grant.
          servingPhysicalGpus: gpuCount(
            settledServingPhysicalGpusFor(
              state,
              content,
              command.labId,
              command.allocation,
            ),
          ),
        },
      },
    },
  };
  const finance = forecastFinance(previewState, content, command.labId, 1, "measured");
  // Command previews are player-facing. Match the market panel's measured
  // capability projection rather than allowing the preview to reveal hidden
  // true capability through demand or revenue.
  const usage = forecastUsage(previewState, content, command.labId, "measured");
  const servingAura = projectServingAura(
    previewState,
    content,
    command.labId,
    "measured",
  );
  return {
    netMillionsPerCycle: finance.netMillionsPerCycle,
    servingCapacityTeraflops: usage.servingCapacityTeraflops,
    requestedTeraflops: usage.requestedTeraflops,
    deliveredTeraflops: usage.deliveredTeraflops,
    unmetTeraflops: usage.unmetTeraflops,
    projectedRevenueMillionsPerCycle: usage.revenueMillionsThisWeek * MARKET_CYCLE_WEEKS,
    projectedServingAuraPerCycle: servingAura.perCycle,
    projectedServingFulfilment: servingAura.fulfilment,
    segments: usage.segments.map((segment) => ({
      segmentId: segment.segmentId,
      requestedTeraflops: segment.requestedTeraflops,
      deliveredTeraflops: segment.deliveredTeraflops,
      projectedRevenueMillionsPerCycle:
        segment.grossRevenueMillionsThisWeek * MARKET_CYCLE_WEEKS,
    })),
  };
}

export function validateCommand(
  state: GameState,
  content: CompiledContent,
  command: GameCommand,
): CommandValidation {
  const errors: RuleViolation[] = [];

  if (state.run.status !== "active") {
    errors.push({ code: "run-ended", message: "The run has already ended" });
  }
  // Stale-confirmation rejection (TDD section 8.1).
  if (command.meta.expectedTick !== state.run.tick) {
    errors.push({
      code: "stale-command",
      message:
        `Command was issued for tick ${String(command.meta.expectedTick)} but the ` +
        `simulation is at tick ${String(state.run.tick)}; review updated costs`,
    });
  }

  const maturityBlocker = labMaturityCommandBlocker(state, command);
  if (maturityBlocker !== undefined) {
    errors.push({ code: "lab-feature-locked", message: maturityBlocker });
  }

  if (errors.length === 0) {
    switch (command.kind) {
      case "set-gpu-allocation":
        validateSetGpuAllocation(state, content, command, errors);
        break;
      case "buy-gpus":
        validateGpuPurchase(state, content, command, errors);
        break;
      case "sell-gpus":
        validateGpuSale(state, content, command, errors);
        break;
      case "set-public-price":
        validatePublicPrice(state, command, errors);
        break;
      case "start-facility-construction":
        validateFacilityConstruction(state, content, command, errors);
        break;
      case "start-fundraising-campaign":
        validateFundraisingCampaign(state, content, command, errors);
        break;
      case "accept-funding-offer":
        validateAcceptFundingOffer(state, command, errors);
        break;
      case "start-lobbying-project":
        validateLobbyingProject(state, content, command, errors);
        break;
      case "start-agi-component": {
        if (!validatePlayerLab(state, command.labId, errors)) break;
        const quote = quoteAgiComponent(
          state,
          content,
          command.labId,
          command.componentType,
        );
        for (const blocker of quote.blockers) {
          errors.push({ code: "agi-component-blocked", message: blocker });
        }
        break;
      }
      case "join-government-programme": {
        if (!validatePlayerLab(state, command.labId, errors)) break;
        const quote = quoteGovernmentProgramme(
          state,
          content,
          command.labId,
          command.programmeId,
        );
        for (const blocker of quote.blockers) {
          errors.push({ code: "programme-blocked", message: blocker });
        }
        break;
      }
      case "leave-government-programme": {
        if (!validatePlayerLab(state, command.labId, errors)) break;
        const lab = state.labs[command.labId];
        if (lab?.politics.programmes.includes(command.programmeId) !== true) {
          errors.push({
            code: "programme-not-active",
            message: "The lab is not enrolled in this programme",
          });
        }
        break;
      }
      case "conduct-rival-diplomacy":
        validateRivalDiplomacy(state, command, errors);
        break;
      case "propose-coalition":
        validateCoalitionProposal(state, command, errors);
        break;
      case "start-coalition-project":
        validateCoalitionProject(state, content, command, errors);
        break;
      case "ratify-coalition":
        validateCoalitionRatification(state, command, errors);
        break;
      case "choose-generic-advance":
        validateGenericAdvance(state, content, command, errors);
        break;
      case "choose-publication-policy":
        validatePublicationPolicy(state, content, command, errors);
        break;
      case "start-training-run":
        validateStartTrainingRun(state, content, command, errors);
        break;
      case "start-evaluation":
        validateStartEvaluation(state, content, command, errors);
        break;
      case "dismiss-anomaly":
      case "investigate-anomaly":
        validateAnomalyAction(state, content, command, errors);
        break;
      case "start-productisation":
        validateStartProductisation(state, content, command, errors);
        break;
      case "set-model-deployment-policy":
        validateModelDeploymentPolicy(state, content, command, errors);
        break;
      case "assign-researcher":
        validateResearcherAssignment(state, content, command, errors);
        break;
      case "recruit-researcher":
        validateRecruitment(state, content, command, errors);
        break;
      case "start-researcher-commitment":
        validateResearcherCommitment(state, content, command, errors);
        break;
      case "submit-retention-offer":
        validateRetentionOffer(state, command, errors);
        break;
      case "resolve-researcher-ultimatum":
        validateUltimatumResponse(state, command, errors);
        break;
      case "dismiss-researcher":
        validateDismissResearcher(state, content, command, errors);
        break;
      case "review-rival-race":
        if (!validatePlayerLab(state, command.labId, errors)) break;
        if (!isProgressiveCampaign(state) || labMaturityStage(state) !== "model") {
          errors.push({
            code: "campaign-objective-inactive",
            message: "The rival-race review is not an active campaign objective",
          });
        }
        break;
      case "respond-to-decision-event":
        validateDecisionEventResponse(state, content, command, errors);
        break;
      case "set-model-autonomy": {
        const quote = quoteStandingAutonomy(state, command.labId, command.level);
        for (const blocker of quote.blockers) {
          errors.push({ code: "autonomy-blocked", message: blocker });
        }
        if (
          quote.confirmationPhrase !== undefined &&
          command.confirmationText !== quote.confirmationPhrase
        ) {
          errors.push({
            code: "critical-confirmation-required",
            message: `Type “${quote.confirmationPhrase}” to confirm critical access`,
          });
        }
        break;
      }
      case "set-candidate-access":
        validateCandidateAccess(state, command, errors);
        break;
      case "isolate-candidate-artifact":
        validateCandidateIsolation(state, command, errors);
        break;
      case "resolve-candidate-incident":
        validateCandidateIncidentReview(state, command, errors);
        break;
      case "nominate-candidate":
        validateNominateCandidate(state, command, errors);
        break;
      case "commit-capability-proof":
        validateCapabilityProof(state, content, command, errors);
        break;
      case "commit-candidate-safety-response":
        validateCandidateSafetyResponse(state, content, command, errors);
        break;
      case "configure-candidate-retirement":
        validateConfigureCandidateRetirement(state, command, errors);
        break;
      case "transmit-candidate-retirement":
        validateTransmitCandidateRetirement(state, command, errors);
        break;
      case "choose-post-retirement-path":
        validatePostRetirementPath(state, command, errors);
        break;
      case "choose-false-dawn-path":
        validateFalseDawnPath(state, command, errors);
        break;
      case "transmit-deployment":
        validateTransmitDeployment(state, command, errors);
        break;
      case "advance-world-waiting":
        validateAdvanceWorldWaiting(state, command, errors);
        break;
      case "resolve-pressure-collision":
        validatePressureCollisionResponse(state, command, errors);
        break;
      case "enter-final-review":
        validateEnterFinalReview(state, command, errors);
        break;
      case "choose-deployment-mode":
        validateChooseDeploymentMode(state, content, command, errors);
        break;
      case "resolve-rollout-decision":
        validateRolloutDecision(state, command, errors);
        break;
      case "resolve-containment-failure":
        validateContainmentFailureAction(state, command, errors);
        break;
      default:
        rejectUnsupportedCommand(command, errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const summary = (() => {
    switch (command.kind) {
      case "set-gpu-allocation": {
        const current = state.labs[command.labId]?.compute.allocation;
        return current !== undefined &&
          hasLargeCapabilityDomainSwing(current, command.allocation)
          ? "Allocation queued; takes effect next week with a one-week context-switch penalty"
          : "Allocation queued; takes effect next week";
      }
      case "buy-gpus": {
        const quote = quoteGpuPurchase(
          state,
          content,
          command.labId,
          command.generationId,
          command.thousandUnits,
        );
        return `${String(quote.physicalGpuCount)} ${quote.generationDisplayName} GPUs ordered; they arrive in ${String(quote.deliveryWeeks)} weeks`;
      }
      case "sell-gpus": {
        const quote = quoteGpuSale(
          state,
          content,
          command.labId,
          command.generationId,
          command.thousandUnits,
        );
        return `${String(quote.physicalGpuCount)} ${quote.generationDisplayName} GPUs sold for ${formatValuation(quote.cashProceedsMillions)}`;
      }
      case "set-public-price":
        return `${content.market.priceTiers[command.priceTier].displayName} pricing queued; takes effect next cycle`;
      case "start-facility-construction": {
        const quote = quoteFacilityConstruction(
          state,
          content,
          command.labId,
          command.definitionId,
        );
        return `${quote.displayName} construction queued for ${formatValuation(quote.upfrontCostMillions)}`;
      }
      case "start-fundraising-campaign": {
        const quote = quoteFundraisingCampaign(
          state,
          content,
          command.labId,
          command.campaign,
        );
        const aura = quote.auraCostBreakdown;
        const relief =
          aura.emergencyBridgeReliefAuraCost > 0
            ? ` - ${String(aura.emergencyBridgeReliefAuraCost)} emergency relief`
            : "";
        return `${quote.displayName} takes ${String(quote.durationWeeks)} weeks, spends ${String(aura.baseAuraCost)} base + ${String(aura.globalMarketPressureAuraCost)} global + ${String(aura.recentRoundPressureAuraCost)} recent${relief} = ${String(aura.totalAuraCost)} Aura, and seeks ${String(quote.offerCount)} offer(s)`;
      }
      case "accept-funding-offer": {
        const quote = quoteFundingOffer(state, command.labId, command.offerId);
        return `Accept ${formatValuation(quote.offer.cashMillions)} with ${String(quote.offer.conditions.length)} recorded condition(s)`;
      }
      case "start-agi-component": {
        const rule = AGI_COMPONENT_RULES[command.componentType];
        return `${rule.displayName} authorised: ${formatValuation(rule.cashCostMillions)}, ${String(rule.durationWeeks)} weeks, one major-project slot`;
      }
      case "join-government-programme":
        return `Joined ${GOVERNMENT_PROGRAMMES[command.programmeId].displayName}; standing effects apply immediately`;
      case "leave-government-programme": {
        const exit = quoteGovernmentProgrammeExit(
          state,
          command.labId,
          command.programmeId,
        );
        return `Left ${exit.programmeNames.join(", ")}; government trust -${String(exit.trustCost)}`;
      }
      case "start-lobbying-project": {
        const quote = quoteLobbyingProject(
          state,
          content,
          command.labId,
          command.objective,
          command.approach,
        );
        return `${quote.displayName}: ${quote.approachName}, ${String(quote.durationWeeks)} weeks, ${quote.chanceLabel}`;
      }
      case "conduct-rival-diplomacy": {
        const quote = quoteRivalDiplomacy(
          state,
          command.labId,
          command.rivalLabId,
          command.action,
        );
        return `${quote.displayName}: ${quote.chanceLabel}; ${formatValuation(quote.cashCostMillions)} and ${quote.auraCost.toFixed(0)} Aura`;
      }
      case "propose-coalition":
        return `Propose coalition with ${String(command.rivalLabIds.length)} rival signatory or signatories`;
      case "start-coalition-project": {
        const quote = quoteCoalitionProject(
          state,
          content,
          command.labId,
          command.coalitionId,
          command.projectType,
          command.contributorLabId,
          command.assetKind,
        );
        return `${quote.displayName}: ${String(quote.durationWeeks)} weeks, ${formatValuation(quote.cashCostMillions)}, ${String(quote.auraCost)} Aura`;
      }
      case "ratify-coalition":
        return "Ratify the coalition charter and enter shared governance";
      case "choose-generic-advance": {
        const advance = content.research.genericAdvances[command.optionId];
        return `${advance?.name ?? "Generic advance"} selected`;
      }
      case "choose-publication-policy": {
        const paper = content.papers.definitions[command.paperId];
        if (paper === undefined) return "Unknown paper publication decision";
        const auraAward = calculatePaperPublicationAura(
          state,
          content,
          paper,
          command.policy,
          command.labId,
        );
        const scoreAward = calculatePaperPublicationScore(content, paper, command.policy);
        const policyLabel = command.policy
          .replaceAll("-", " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase());
        const scientificPayload = describePaperScientificPayload(
          paper,
          command.policy === "keep-secret" ? "private" : "public",
        );
        if (command.policy === "keep-secret") {
          return `${paper.title}: ${policyLabel} grants 0 Aura and no scientific-legacy score. Your lab keeps ${scientificPayload}. Every other lab must independently rediscover the paper before receiving those effects; rediscoverers receive reduced prestige and no publication choice.`;
        }
        return `${paper.title}: ${policyLabel} grants ${String(auraAward)} Aura and +${String(scoreAward)} scientific-legacy score. Every lab immediately receives ${scientificPayload}; the paper satisfies prerequisites globally and cannot be rediscovered.`;
      }
      case "start-training-run": {
        const quote = quoteTrainingRun(state, content, command);
        return `${quote.displayName} training authorised: ${formatTeraflops(quote.committedTeraflops)} for ${String(quote.durationWeeks)} weeks, ${formatValuation(quote.cashCostMillions)} · ${String(quote.reservedPhysicalGpus)} physical GPUs reserved`;
      }
      case "start-evaluation": {
        const quote = quoteEvaluation(state, content, command);
        return `${quote.displayName} authorised: ${formatTeraflops(quote.requiredTeraflops)} for ${String(quote.durationWeeks)} weeks`;
      }
      case "dismiss-anomaly":
        return "Anomaly dismissed: Safety Culture −5, Internal Candour −5; the unresolved warning remains in the Safety Case and repeated dismissals increasingly bias internal evaluations toward reassuring answers";
      case "investigate-anomaly": {
        const quote = quoteAnomalyAction(state, content, command.anomalyId);
        const action = quote.mode === "mitigation" ? "mitigation" : "investigation";
        return `${quote.severityLabel} anomaly ${action} commissioned: ${formatValuation(quote.cashCostMillions)} · ${String(quote.auraCost)} Aura · ${String(quote.durationWeeks)} weeks · 1 major-project slot`;
      }
      case "start-productisation": {
        const quote = quoteProductisation(state, content, command);
        return `${quote.displayName} authorised for ${String(quote.durationWeeks)} weeks, ${formatValuation(quote.cashCostMillions)}`;
      }
      case "set-model-deployment-policy": {
        const policy = content.deployment.policies[command.policy];
        const model = state.models[command.modelId];
        const aura = quoteDeploymentAura(state, content, command.modelId, command.policy);
        const multiplier = policy.irreversible
          ? 1
          : (model?.deployment.exposureMultiplier ?? 1);
        const productisationRuns = Object.values(
          model?.deployment.productisationRuns ?? {},
        ).reduce((sum, runs) => sum + runs, 0);
        const isManagedPublicPolicy =
          command.policy !== "internal-only" && command.policy !== "weights-release";
        const timing =
          isManagedPublicPolicy && productisationRuns === 0
            ? "is planned and will activate automatically after productisation"
            : "takes effect immediately";
        return `${policy.displayName} ${timing} at access risk ${String(Math.round(policy.exposure * multiplier * 100))}/100${aura.auraAward > 0 ? ` · +${String(aura.auraAward)} Aura` : ""}`;
      }
      case "assign-researcher": {
        const quote = quoteResearcherAssignment(
          state,
          content,
          command.labId,
          command.researcherId,
          command.assignment,
        );
        return `${command.assignment.role} assignment ready · ${quote.skillKey} skill ${String(quote.skillLevel)}/5`;
      }
      case "recruit-researcher": {
        const quote = quoteRecruitment(
          state,
          content,
          command.labId,
          command.researcherId,
        );
        const definitionId = state.researchers[command.researcherId]?.definitionId;
        const name =
          definitionId === undefined
            ? command.researcherId
            : (content.researchers.definitions[definitionId]?.displayName ??
              command.researcherId);
        const aura = quote.auraCostBreakdown;
        return `Recruit ${name} at listed terms: ${formatValuation(quote.signingCash)} signing, ${formatValuation(quote.salaryPerCycle)} per cycle, and ${String(aura.baseAuraCost)} base + ${String(aura.globalMarketPressureAuraCost)} global = ${String(aura.marketAdjustedAuraCost)} Aura`;
      }
      case "start-researcher-commitment": {
        const quote = quoteResearcherCommitment(
          state,
          content,
          command.labId,
          command.researcherId,
        );
        return `${quote.title}: ${String(quote.expectedDurationWeeks)} weeks, ${formatValuation(quote.cashCostMillions)}`;
      }
      case "submit-retention-offer": {
        const quote = quoteRetentionOffer(
          state,
          command.labId,
          command.researcherId,
          command.offer,
        );
        return `Retention offer adds ${quote.strengthGain.toFixed(1)} strength before week ${String(quote.resolvesAt)}`;
      }
      case "resolve-researcher-ultimatum":
        return command.response === "accept-conditions"
          ? "Accept the conditions and create a tracked thirteen-week promise"
          : "Wish the researcher well and begin departure consequences";
      case "dismiss-researcher": {
        const quote = quoteDismissal(state, content, command.labId, command.researcherId);
        return `Dismissal costs ${formatValuation(quote.severanceCash)} and ${String(quote.auraLoss)} Aura`;
      }
      case "review-rival-race":
        return "Rival race reviewed for the Chapter 3 strategic briefing";
      case "respond-to-decision-event": {
        const preview = previewEventOption(
          state,
          content,
          command.instanceId,
          command.optionId,
        );
        return `${preview.labelKey}: ${preview.previewKey}`;
      }
      case "set-model-autonomy": {
        const quote = quoteStandingAutonomy(state, command.labId, command.level);
        return `${quote.rule.displayName}: ${quote.benefitLabel} · ${autonomyCostLabel(quote.rule)}`;
      }
      case "set-candidate-access": {
        const quote = quoteCandidateAccess(
          state,
          command.modelId,
          command.level,
          command.confirmationText,
        );
        const benefit = autonomyBenefitLabel(
          quote,
          measuredFrontierCapability(state.models[command.modelId]),
        );
        return `${quote.displayName}: ${benefit} · ${autonomyCostLabel(quote)}`;
      }
      case "isolate-candidate-artifact": {
        const quote = quoteCandidateIsolation(state, command.modelId);
        return `Isolate ${quote.displayName}: revoke Access ${String(quote.currentAccess)} and return current custody to internal-only; historical maximum remains ${String(quote.maximumAccessEver)}/5`;
      }
      case "resolve-candidate-incident": {
        const quote = quoteCandidateIncidentReview(state, command.modelId);
        return `Resolve ${quote.displayName} containment signal: preparedness ${quote.preparedness.toFixed(1)}/${String(quote.requiredPreparedness)}; ${formatValuation(quote.cashCostMillions)} and ${String(quote.auraCost)} Aura`;
      }
      case "nominate-candidate":
        return state.endgame.stage === "evidence-sprint" &&
          state.endgame.pendingRemediation !== undefined
          ? `Resolve remediation review: retain or adopt ${state.models[command.modelId]?.displayName ?? String(command.modelId)} as the exact formal candidate`
          : `Nominate ${state.models[command.modelId]?.displayName ?? String(command.modelId)} as the formal programme candidate`;
      case "commit-capability-proof": {
        const quote = quoteCapabilityProofProject(
          state,
          content,
          command.labId,
          command.challengeId,
          command.verifierId,
        );
        return `${quote.displayName}: ${String(quote.durationWeeks)} week capability proof; ${quote.proof.integrityLabel.toLowerCase()} integrity`;
      }
      case "commit-candidate-safety-response": {
        const quote = quoteCandidateSafetyResponse(
          state,
          content,
          command.labId,
          command.responseId,
        );
        return `${quote.response.displayName}: ${String(quote.durationWeeks)} week targeted response; cannot fix ${quote.response.cannotFix.toLowerCase()}`;
      }
      case "configure-candidate-retirement": {
        const quote = quoteCandidateRetirement(
          state,
          command.modelId,
          command.procedureId,
          command.archiveDisposition,
        );
        return `${quote.procedure.displayName}; ${quote.archiveDisposition.displayName}. Configuration is reversible until transmission.`;
      }
      case "transmit-candidate-retirement":
        return `Transmit the irreversible model-specific retirement order for ${String(command.modelId)}`;
      case "choose-post-retirement-path":
        return command.path === "successor-programme"
          ? "Continue through recovery and prepare one non-stacking successor efficiency grant"
          : "Attempt a durable international moratorium; Long Pause requires this separate gate to succeed";
      case "choose-false-dawn-path":
        return command.path === "successor-programme"
          ? "Return to the race under the 52-week candidacy declaration pause"
          : "Attempt a durable international moratorium; Long Pause requires the gate to succeed";
      case "transmit-deployment": {
        const quote = quoteDeploymentTransmission(state, command.confirmationText);
        return quote.route === "prepared-route"
          ? `Transmit the final deployment order for ${quote.candidateDisplayName ?? String(command.modelId)}`
          : `Deploy ${quote.candidateDisplayName ?? String(command.modelId)} now with zero further preparation weeks`;
      }
      case "advance-world-waiting":
        return state.endgame.stage === "world-waiting" &&
          state.endgame.revealedCalloutCount >= state.endgame.callouts.length
          ? "Resolve the final outcome"
          : "Advance the world-waiting sequence";
      case "resolve-pressure-collision":
        return `Pressure response: ${command.optionId.replaceAll("-", " ")}`;
      case "enter-final-review":
        return "Compile the final review from the evidence currently on record";
      case "choose-deployment-mode": {
        if (state.endgame.stage !== "final-review") {
          return "Select a deployment mode after final review";
        }
        const programme =
          command.prosperityProgrammeId === undefined
            ? bestProsperityProgramme(
                state,
                content,
                state.endgame.evidence.prosperityReadinessBonus,
              )
            : findProsperityProgramme(
                state,
                content,
                command.prosperityProgrammeId,
                state.endgame.evidence.prosperityReadinessBonus,
              );
        const quote = quoteDeploymentMode(
          state,
          command.modeId,
          command.confirmationText,
          programme.readiness,
        );
        return `${quote.rule.displayName}: ${programme.shortName} at ${String(programme.readiness)}/100, access ${String(quote.rule.accessLevel)}, ${String(quote.rule.rolloutWeeks)}-week rollout`;
      }
      case "resolve-rollout-decision": {
        const option = rolloutDecisionOptions(state).find(
          (candidate) => candidate.id === command.optionId,
        );
        return `${option?.label ?? command.optionId}: ${option?.consequence ?? "recorded rollout response"}`;
      }
      case "resolve-containment-failure":
        return command.actionId === "continue"
          ? "Advance the containment-failure sequence"
          : `Emergency response: ${
              emergencyResponseRules(state).find(
                (response) => response.id === command.actionId,
              )?.label ?? command.actionId
            }`;
      default:
        return assertNever(command);
    }
  })();
  return {
    ok: true,
    preview: {
      summary,
      takesEffectAtTick:
        command.kind === "buy-gpus"
          ? quoteGpuPurchase(
              state,
              content,
              command.labId,
              command.generationId,
              command.thousandUnits,
            ).arrivesAt
          : command.kind === "sell-gpus"
            ? state.run.tick
            : command.kind === "set-public-price"
              ? tick(state.run.tick + (4 - (state.run.tick % 4)))
              : command.kind === "start-facility-construction"
                ? tick(state.run.tick + 1)
                : command.kind === "start-fundraising-campaign"
                  ? tick(state.run.tick + 1)
                  : command.kind === "accept-funding-offer"
                    ? state.run.tick
                    : command.kind === "start-agi-component"
                      ? tick(state.run.tick + 1)
                      : command.kind === "join-government-programme" ||
                          command.kind === "leave-government-programme"
                        ? state.run.tick
                        : command.kind === "start-lobbying-project"
                          ? tick(state.run.tick + 1)
                          : command.kind === "conduct-rival-diplomacy"
                            ? state.run.tick
                            : command.kind === "propose-coalition" ||
                                command.kind === "ratify-coalition"
                              ? state.run.tick
                              : command.kind === "start-coalition-project"
                                ? tick(state.run.tick + 1)
                                : command.kind === "choose-generic-advance"
                                  ? state.run.tick
                                  : command.kind === "choose-publication-policy"
                                    ? state.run.tick
                                    : command.kind === "start-training-run"
                                      ? tick(state.run.tick + 1)
                                      : command.kind === "start-evaluation"
                                        ? tick(state.run.tick + 1)
                                        : command.kind === "dismiss-anomaly" ||
                                            command.kind === "investigate-anomaly"
                                          ? state.run.tick
                                          : command.kind === "start-productisation"
                                            ? tick(state.run.tick + 1)
                                            : command.kind ===
                                                "set-model-deployment-policy"
                                              ? state.run.tick
                                              : command.kind === "assign-researcher" ||
                                                  command.kind === "recruit-researcher"
                                                ? state.run.tick
                                                : command.kind ===
                                                    "start-researcher-commitment"
                                                  ? tick(state.run.tick + 1)
                                                  : command.kind ===
                                                        "submit-retention-offer" ||
                                                      command.kind ===
                                                        "resolve-researcher-ultimatum" ||
                                                      command.kind ===
                                                        "dismiss-researcher" ||
                                                      command.kind ===
                                                        "respond-to-decision-event" ||
                                                      command.kind ===
                                                        "set-candidate-access" ||
                                                      command.kind ===
                                                        "isolate-candidate-artifact" ||
                                                      command.kind ===
                                                        "resolve-candidate-incident" ||
                                                      command.kind ===
                                                        "nominate-candidate" ||
                                                      command.kind ===
                                                        "configure-candidate-retirement" ||
                                                      command.kind ===
                                                        "transmit-candidate-retirement" ||
                                                      command.kind ===
                                                        "choose-post-retirement-path" ||
                                                      command.kind ===
                                                        "choose-false-dawn-path" ||
                                                      command.kind ===
                                                        "resolve-pressure-collision" ||
                                                      command.kind ===
                                                        "enter-final-review" ||
                                                      command.kind ===
                                                        "choose-deployment-mode" ||
                                                      command.kind ===
                                                        "resolve-rollout-decision" ||
                                                      command.kind ===
                                                        "resolve-containment-failure" ||
                                                      command.kind ===
                                                        "transmit-deployment" ||
                                                      command.kind ===
                                                        "advance-world-waiting"
                                                    ? state.run.tick
                                                    : tick(state.run.tick + 1),
      ...(command.kind === "set-gpu-allocation"
        ? {
            gpuAllocationPlan: previewAllocation(state, content, command),
            gpuAllocationConsequences: previewAllocationConsequences(
              state,
              content,
              command,
            ),
          }
        : {}),
      ...(command.kind === "buy-gpus"
        ? {
            gpuPurchaseQuote: quoteGpuPurchase(
              state,
              content,
              command.labId,
              command.generationId,
              command.thousandUnits,
            ),
          }
        : {}),
      ...(command.kind === "set-public-price"
        ? { publicPriceTier: command.priceTier }
        : {}),
      ...(command.kind === "start-facility-construction"
        ? {
            constructionQuote: quoteFacilityConstruction(
              state,
              content,
              command.labId,
              command.definitionId,
            ),
          }
        : {}),
      ...(command.kind === "sell-gpus"
        ? {
            gpuSaleQuote: quoteGpuSale(
              state,
              content,
              command.labId,
              command.generationId,
              command.thousandUnits,
            ),
          }
        : {}),
      ...(command.kind === "start-fundraising-campaign"
        ? {
            fundraisingCampaign: quoteFundraisingCampaign(
              state,
              content,
              command.labId,
              command.campaign,
            ),
          }
        : {}),
      ...(command.kind === "accept-funding-offer"
        ? {
            fundingOffer: quoteFundingOffer(state, command.labId, command.offerId),
          }
        : {}),
      ...(command.kind === "start-lobbying-project"
        ? {
            lobbyingProject: quoteLobbyingProject(
              state,
              content,
              command.labId,
              command.objective,
              command.approach,
            ),
          }
        : {}),
      ...(command.kind === "conduct-rival-diplomacy"
        ? {
            rivalDiplomacy: quoteRivalDiplomacy(
              state,
              command.labId,
              command.rivalLabId,
              command.action,
            ),
          }
        : {}),
      ...(command.kind === "propose-coalition"
        ? {
            coalitionProposal: quoteCoalitionProposal(
              state,
              command.labId,
              command.rivalLabIds,
              command.governmentMember,
              command.independentBodyMember,
            ),
          }
        : {}),
      ...(command.kind === "start-coalition-project"
        ? {
            coalitionProject: quoteCoalitionProject(
              state,
              content,
              command.labId,
              command.coalitionId,
              command.projectType,
              command.contributorLabId,
              command.assetKind,
            ),
          }
        : {}),
      ...(command.kind === "ratify-coalition"
        ? {
            coalitionEligibility: evaluateCoalitionEligibility(
              state,
              command.coalitionId,
            ),
          }
        : {}),
      ...(command.kind === "start-training-run"
        ? { trainingQuote: quoteTrainingRun(state, content, command) }
        : {}),
      ...(command.kind === "start-evaluation"
        ? { evaluationQuote: quoteEvaluation(state, content, command) }
        : {}),
      ...(command.kind === "start-productisation"
        ? { productisationQuote: quoteProductisation(state, content, command) }
        : {}),
      ...(command.kind === "set-model-deployment-policy"
        ? {
            deploymentPolicy: {
              policy: command.policy,
              displayName: content.deployment.policies[command.policy].displayName,
              exposure:
                content.deployment.policies[command.policy].exposure *
                (content.deployment.policies[command.policy].irreversible
                  ? 1
                  : (state.models[command.modelId]?.deployment.exposureMultiplier ?? 1)),
              irreversible: content.deployment.policies[command.policy].irreversible,
              auraAward: quoteDeploymentAura(
                state,
                content,
                command.modelId,
                command.policy,
              ).auraAward,
              marketDemandMultiplier:
                content.deployment.policies[command.policy].marketDemandMultiplier,
              revenueMultiplier:
                content.deployment.policies[command.policy].revenueMultiplier,
            },
          }
        : {}),
      ...(command.kind === "recruit-researcher"
        ? {
            recruitment: quoteRecruitment(
              state,
              content,
              command.labId,
              command.researcherId,
            ),
          }
        : {}),
      ...(command.kind === "start-researcher-commitment"
        ? {
            researcherCommitment: quoteResearcherCommitment(
              state,
              content,
              command.labId,
              command.researcherId,
            ),
          }
        : {}),
      ...(command.kind === "assign-researcher"
        ? {
            researcherAssignment: quoteResearcherAssignment(
              state,
              content,
              command.labId,
              command.researcherId,
              command.assignment,
            ),
          }
        : {}),
      ...(command.kind === "submit-retention-offer"
        ? {
            retentionOffer: quoteRetentionOffer(
              state,
              command.labId,
              command.researcherId,
              command.offer,
            ),
          }
        : {}),
      ...(command.kind === "resolve-researcher-ultimatum"
        ? {
            ultimatumResponse: quoteUltimatumResponse(
              state,
              command.labId,
              command.researcherId,
              command.response,
            ),
          }
        : {}),
      ...(command.kind === "dismiss-researcher"
        ? {
            dismissal: quoteDismissal(
              state,
              content,
              command.labId,
              command.researcherId,
            ),
          }
        : {}),
      ...(command.kind === "respond-to-decision-event"
        ? {
            eventOption: previewEventOption(
              state,
              content,
              command.instanceId,
              command.optionId,
            ),
          }
        : {}),
      ...(command.kind === "set-candidate-access"
        ? {
            candidateAccess: quoteCandidateAccess(
              state,
              command.modelId,
              command.level,
              command.confirmationText,
            ),
          }
        : {}),
      ...(command.kind === "resolve-candidate-incident"
        ? {
            candidateIncidentReview: quoteCandidateIncidentReview(state, command.modelId),
          }
        : {}),
      ...(command.kind === "commit-capability-proof"
        ? {
            capabilityProof: quoteCapabilityProofProject(
              state,
              content,
              command.labId,
              command.challengeId,
              command.verifierId,
            ),
          }
        : {}),
      ...(command.kind === "commit-candidate-safety-response"
        ? {
            candidateSafetyResponse: quoteCandidateSafetyResponse(
              state,
              content,
              command.labId,
              command.responseId,
            ),
          }
        : {}),
      ...(command.kind === "choose-deployment-mode"
        ? {
            deploymentMode: quoteDeploymentMode(
              state,
              command.modeId,
              command.confirmationText,
            ),
          }
        : {}),
      ...(command.kind === "transmit-deployment"
        ? {
            deploymentTransmission: quoteDeploymentTransmission(
              state,
              command.confirmationText,
            ),
          }
        : {}),
    },
  };
}
