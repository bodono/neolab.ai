import type { CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import type { GameState } from "../model/state.ts";
import { createTransaction, type TransitionResult } from "../engine/transaction.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { buyGpus, sellGpus } from "../compute/gpu-market.ts";
import { quoteFacilityConstruction } from "../facilities/facilities.ts";
import {
  activateEligibleQueuedProjects,
  cancelProject,
  startConstructionProject,
} from "../projects/project-framework.ts";
import type { GameCommand } from "./types.ts";
import { advanceResearcherReactions } from "../feed/reactions.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import { startResearcherCommitment } from "../researchers/commitments.ts";
import { validateCommand } from "./validate.ts";
import { choosePublicationPolicy } from "../research/papers.ts";
import { chooseGenericAdvance } from "../research/research.ts";
import { startTrainingRun } from "../training/training.ts";
import { startAgiComponent } from "../endgame/candidate-programme.ts";
import {
  dismissAnomaly,
  investigateAnomaly,
  synchroniseAnomalyProjectDueDate,
  startEvaluation,
} from "../evaluations/evaluations.ts";
import {
  setModelDeploymentPolicy,
  startProductisation,
} from "../productisation/productisation.ts";
import { recruitResearcher } from "../researchers/talent-market.ts";
import { assignResearcher } from "../researchers/assignments.ts";
import {
  dismissResearcher,
  respondToUltimatum,
  submitRetentionOffer,
} from "../researchers/people.ts";
import {
  acceptFundingOffer,
  startFundraisingCampaign,
} from "../fundraising/fundraising.ts";
import {
  instantiateCandidateDeclarationEvent,
  resolveEventOption,
} from "../events/event-engine.ts";
import {
  joinGovernmentProgramme,
  leaveGovernmentProgramme,
  startLobbyingProject,
} from "../politics/politics.ts";
import { resolveRivalDiplomacy } from "../rivals/diplomacy.ts";
import {
  proposeCoalition,
  ratifyCoalition,
  startCoalitionProject,
} from "../coalition/coalition.ts";
import { setCandidateAccess } from "../endgame/access.ts";
import { setStandingAutonomy } from "../models/autonomy.ts";
import { synchroniseAutonomyEscalationResponses } from "../models/autonomy-escalation.ts";
import {
  beginCapabilityProof,
  adoptCandidateRemediationArtifact,
  commitCandidateSafetyResponse,
  resolvePressureCollision,
} from "../endgame/crisis-stages.ts";
import { nominateCandidate } from "../endgame/endgame-machine.ts";
import { inFlightOrdinaryTrainingProjectIds } from "../endgame/training-commitment.ts";
import {
  isolateCandidateArtifact,
  resolveCandidateIncident,
} from "../endgame/candidate-lifecycle.ts";
import { chooseDeploymentMode, enterFinalReview } from "../endgame/resolution.ts";
import { resolveRolloutDecision } from "../endgame/rollout.ts";
import { resolveContainmentFailureAction } from "../endgame/containment-failure.ts";
import {
  choosePostRetirementPath,
  configureCandidateRetirement,
  transmitCandidateRetirement,
} from "../endgame/retirement.ts";
import {
  advanceWorldWaiting,
  transmitDeployment,
} from "../endgame/deployment-command.ts";
import { chooseFalseDawnPath } from "../endgame/nonterminal-outcome.ts";
import { awardProsperityReadinessMilestones, finaliseEndedRun } from "../engine/score.ts";
import { recordPlayerLabMaturityCommand } from "../campaign/lab-maturity.ts";

export class CommandRejectedError extends Error {
  readonly codes: readonly string[];

  constructor(codes: readonly string[], detail: string) {
    super(`Command rejected: ${detail}`);
    this.name = "CommandRejectedError";
    this.codes = codes;
  }
}

/**
 * Validate and atomically apply one command (TDD section 8.2). Allocation and
 * policy commands queue an order for the next tick (TDD section 8.3); no cost
 * is ever partially paid.
 */
export function applyCommand(
  state: GameState,
  content: CompiledContent,
  command: GameCommand,
): TransitionResult {
  const validation = validateCommand(state, content, command);
  if (!validation.ok) {
    throw new CommandRejectedError(
      validation.errors.map((error) => error.code),
      validation.errors.map((error) => error.message).join("; "),
    );
  }

  const tx = createTransaction(state);
  switch (command.kind) {
    case "set-gpu-allocation": {
      tx.update((draft) => {
        // Replace any earlier queued allocation for the same lab: the last
        // order issued during a pause wins (GDD section 30.2).
        draft.run.queuedOrders = draft.run.queuedOrders.filter(
          (order) =>
            !(order.kind === "set-gpu-allocation" && order.labId === command.labId),
        );
        draft.run.queuedOrders.push({
          kind: "set-gpu-allocation",
          labId: command.labId,
          allocation: structuredClone(command.allocation),
        });
      });
      tx.emit({
        kind: "order-queued",
        labId: command.labId,
        order: "set-gpu-allocation",
      });
      break;
    }
    case "buy-gpus": {
      buyGpus(tx, content, command.labId, command.generationId, command.thousandUnits);
      break;
    }
    case "sell-gpus": {
      sellGpus(tx, content, command.labId, command.generationId, command.thousandUnits);
      break;
    }
    case "set-public-price": {
      tx.update((draft) => {
        const lab = draft.labs[command.labId];
        if (lab === undefined)
          throw new Error(`Price command targets unknown lab ${command.labId}`);
        lab.market.pendingPriceTier = command.priceTier;
      });
      tx.emit({
        kind: "public-price-scheduled",
        labId: command.labId,
        priceTier: command.priceTier,
      });
      break;
    }
    case "start-facility-construction": {
      const quote = quoteFacilityConstruction(
        state,
        content,
        command.labId,
        command.definitionId,
      );
      applyEffect(
        tx,
        {
          kind: "add-resource",
          subject: { type: "lab", labId: command.labId },
          resource: "cash",
          amount: 0 - quote.upfrontCostMillions,
          financeCategory: "project-cost",
        },
        { kind: "system", id: command.definitionId },
      );
      startConstructionProject(
        tx,
        content,
        command.labId,
        command.definitionId,
        quote.upfrontCostMillions,
      );
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "start-fundraising-campaign": {
      startFundraisingCampaign(tx, content, command.labId, command.campaign);
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "accept-funding-offer": {
      acceptFundingOffer(tx, command.labId, command.offerId);
      break;
    }
    case "start-agi-component": {
      startAgiComponent(tx, content, command.labId, command.componentType);
      break;
    }
    case "join-government-programme": {
      joinGovernmentProgramme(tx, content, command.labId, command.programmeId);
      break;
    }
    case "leave-government-programme": {
      leaveGovernmentProgramme(tx, command.labId, command.programmeId);
      break;
    }
    case "start-lobbying-project": {
      startLobbyingProject(
        tx,
        content,
        command.labId,
        command.objective,
        command.approach,
      );
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "conduct-rival-diplomacy": {
      resolveRivalDiplomacy(
        tx,
        command.labId,
        command.rivalLabId,
        command.action,
        command.meta.commandId,
      );
      break;
    }
    case "propose-coalition": {
      proposeCoalition(
        tx,
        command.labId,
        command.rivalLabIds,
        command.governmentMember,
        command.independentBodyMember,
      );
      break;
    }
    case "start-coalition-project": {
      startCoalitionProject(
        tx,
        content,
        command.labId,
        command.coalitionId,
        command.projectType,
        command.contributorLabId,
        command.assetKind,
      );
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "ratify-coalition": {
      ratifyCoalition(tx, content, command.coalitionId);
      break;
    }
    case "choose-generic-advance": {
      chooseGenericAdvance(
        tx,
        content,
        command.labId,
        command.programId,
        command.threshold,
        command.optionId,
      );
      break;
    }
    case "choose-publication-policy": {
      choosePublicationPolicy(tx, content, command.paperId, command.policy);
      break;
    }
    case "start-training-run": {
      startTrainingRun(tx, content, command);
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "start-evaluation": {
      startEvaluation(tx, content, command);
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "dismiss-anomaly": {
      dismissAnomaly(tx, command.anomalyId);
      break;
    }
    case "investigate-anomaly": {
      const projectId = investigateAnomaly(tx, content, command.anomalyId);
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      synchroniseAnomalyProjectDueDate(tx, projectId);
      break;
    }
    case "start-productisation": {
      startProductisation(tx, content, command);
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "set-model-deployment-policy": {
      setModelDeploymentPolicy(
        tx,
        content,
        command.labId,
        command.modelId,
        command.policy,
      );
      break;
    }
    case "assign-researcher": {
      assignResearcher(
        tx,
        content,
        command.labId,
        command.researcherId,
        command.assignment,
      );
      break;
    }
    case "recruit-researcher": {
      recruitResearcher(tx, content, command.labId, command.researcherId);
      break;
    }
    case "start-researcher-commitment": {
      startResearcherCommitment(tx, content, command.labId, command.researcherId);
      activateEligibleQueuedProjects(tx, content, [command.labId]);
      break;
    }
    case "submit-retention-offer": {
      submitRetentionOffer(
        tx,
        content,
        command.labId,
        command.researcherId,
        command.offer,
      );
      break;
    }
    case "resolve-researcher-ultimatum": {
      respondToUltimatum(
        tx,
        content,
        command.labId,
        command.researcherId,
        command.response,
      );
      break;
    }
    case "dismiss-researcher": {
      dismissResearcher(tx, content, command.labId, command.researcherId);
      break;
    }
    case "review-rival-race": {
      // The maturity recorder below persists this UI-originated campaign action.
      break;
    }
    case "respond-to-decision-event": {
      resolveEventOption(tx, content, command.instanceId, command.optionId);
      // Autonomy escalation options communicate their response through typed
      // event memories. Consume them in this transaction so promised access
      // rollbacks and containment outcomes happen when the player decides,
      // rather than silently waiting for the next weekly tick.
      synchroniseAutonomyEscalationResponses(
        tx,
        content,
        new RandomOracleV1(tx.read().run.seed),
      );
      break;
    }
    case "set-model-autonomy": {
      setStandingAutonomy(tx, command.labId, command.level, command.confirmationText);
      break;
    }
    case "set-candidate-access": {
      setCandidateAccess(tx, command.modelId, command.level, command.meta.commandId);
      break;
    }
    case "isolate-candidate-artifact": {
      isolateCandidateArtifact(tx, content, command.modelId);
      break;
    }
    case "resolve-candidate-incident": {
      resolveCandidateIncident(tx, command.modelId);
      break;
    }
    case "nominate-candidate": {
      const endgame = tx.read().endgame;
      if (
        endgame.stage === "evidence-sprint" &&
        endgame.pendingRemediation !== undefined
      ) {
        adoptCandidateRemediationArtifact(tx, content, command.modelId);
      } else {
        if (command.abandonInFlightTraining === true) {
          for (const projectId of inFlightOrdinaryTrainingProjectIds(
            tx.read(),
            command.labId,
          )) {
            cancelProject(tx, projectId);
          }
        }
        nominateCandidate(tx, command.modelId);
      }
      instantiateCandidateDeclarationEvent(tx, content, command.modelId);
      break;
    }
    case "commit-capability-proof": {
      beginCapabilityProof(tx, content, command.challengeId, command.verifierId);
      activateEligibleQueuedProjects(tx, content, [tx.read().run.playerLabId]);
      break;
    }
    case "commit-candidate-safety-response": {
      commitCandidateSafetyResponse(tx, content, command.responseId);
      activateEligibleQueuedProjects(tx, content, [tx.read().run.playerLabId]);
      break;
    }
    case "configure-candidate-retirement": {
      configureCandidateRetirement(
        tx,
        command.modelId,
        command.procedureId,
        command.archiveDisposition,
      );
      break;
    }
    case "transmit-candidate-retirement": {
      transmitCandidateRetirement(
        tx,
        content,
        command.modelId,
        command.confirmationText,
        undefined,
        command.procedureId === undefined || command.archiveDisposition === undefined
          ? undefined
          : {
              procedureId: command.procedureId,
              archiveDisposition: command.archiveDisposition,
            },
      );
      break;
    }
    case "choose-post-retirement-path": {
      choosePostRetirementPath(tx, content, command.path);
      break;
    }
    case "choose-false-dawn-path": {
      chooseFalseDawnPath(tx, content, command.presentationKey, command.path);
      break;
    }
    case "transmit-deployment": {
      transmitDeployment(tx, content, command.confirmationText, command.meta.commandId);
      break;
    }
    case "advance-world-waiting": {
      advanceWorldWaiting(tx);
      break;
    }
    case "resolve-pressure-collision": {
      resolvePressureCollision(tx, command.optionId);
      break;
    }
    case "enter-final-review": {
      enterFinalReview(tx, content);
      break;
    }
    case "choose-deployment-mode": {
      chooseDeploymentMode(
        tx,
        content,
        command.modeId,
        command.meta.commandId,
        undefined,
        command.prosperityProgrammeId,
      );
      break;
    }
    case "resolve-rollout-decision": {
      resolveRolloutDecision(tx, content, command.optionId, command.meta.commandId);
      break;
    }
    case "resolve-containment-failure": {
      resolveContainmentFailureAction(tx, content, command.actionId);
      break;
    }
    default:
      assertNever(command);
  }

  recordPlayerLabMaturityCommand(tx, command);
  awardProsperityReadinessMilestones(tx, content);
  // Player decisions emit their events in this transaction, not the weekly
  // tick's, so colleagues react here or never: a recruitment, a deployment
  // change, a disclosure chosen. The oracle is keyed, so rebuilding it from
  // the seed is deterministic.
  advanceResearcherReactions(tx, content, new RandomOracleV1(tx.read().run.seed));
  finaliseEndedRun(tx, content);

  return tx.commit({
    description: `command ${command.kind}`,
    commandId: command.meta.commandId,
  });
}
