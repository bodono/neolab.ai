import type { CompiledContent } from "@neolab/content-schema";

import { forecastFinance } from "../finance/finance.ts";
import { resolveCheckProbability } from "../engine/checks.ts";
import type { ModelId } from "../model/ids.ts";
import type {
  CandidateArchiveDisposition,
  GameState,
  ProjectPayload,
  ProjectState,
  RetirementProcedureId,
} from "../model/state.ts";
import {
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
  CAPABILITY_ATTRIBUTES,
} from "../models/capability.ts";
import { calculateInterventionPressure } from "../politics/politics.ts";
import { projectRivalCandidateCountdowns } from "../rivals/candidate-countdown.ts";
import { agiComponentProgress } from "../rivals/candidate-programme-race.ts";
import { projectRivalPublicSignals } from "../rivals/signals.ts";
import { CANDIDATE_ACCESS_RULES, quoteCandidateAccess } from "../endgame/access.ts";
import {
  isEligibleProgrammeCandidate,
  isValidFormalProgrammeCandidate,
} from "../endgame/candidate-programme.ts";
import {
  CAPABILITY_CHALLENGE_RULES,
  CAPABILITY_VERIFIER_RULES,
  type CapabilityChallengeId,
  type CapabilityVerifierId,
} from "../endgame/capability-proof.ts";
import { candidateDossier } from "../endgame/candidate-dossier.ts";
import { SAFETY_TARGETS } from "../evaluations/safety-readout.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import {
  derivePlayerSafetyAssessment,
  type PlayerSafetyAssessment,
} from "../safety/player-safety-assessment.ts";
import { endgameClockStopReason } from "../endgame/clock-policy.ts";
import {
  MORATORIUM_NEGOTIATION_WEEKS,
  durableMoratoriumForecast,
} from "../endgame/moratorium.ts";
import { calculateCrisisProjectCapacity } from "../endgame/crisis-capacity.ts";
import {
  PRESSURE_COLLISIONS,
  quoteCandidateSafetyResponse,
  quoteCapabilityProofProject,
} from "../endgame/crisis-stages.ts";
import { deploymentStrategies } from "../endgame/deployment-strategies.ts";
import { emergencyResponseRules } from "../endgame/containment-failure.ts";
import {
  DEPLOYMENT_MODE_RULES,
  deploymentModeRule,
  operationalControlBreakdown,
  quoteDeploymentMode,
} from "../endgame/resolution.ts";
import {
  RETIREMENT_DISPOSITIONS,
  RETIREMENT_PROCEDURES,
  quoteCandidateRetirement,
} from "../endgame/retirement.ts";
import { successorEfficiencyForArchiveDisposition } from "../endgame/archive-recovery.ts";
import { rolloutDecisionContext, rolloutDecisionOptions } from "../endgame/rollout.ts";
import {
  bestProsperityProgramme,
  deriveProsperityProgrammes,
  findProsperityProgramme,
} from "../prosperity/prosperity.ts";
import type { PlayerKnowledgeContext } from "./game-view.ts";

export interface CrisisClockView {
  readonly kind: "rival" | "political" | "financial";
  readonly label: string;
  readonly estimateRangeWeeks: readonly [number, number] | null;
  readonly estimateLabel: string;
  readonly urgency: "monitoring" | "urgent" | "imminent";
  readonly confidence: "low" | "medium" | "high";
}

interface PlayerSafeGateResultView {
  readonly gate: string;
  readonly result: string;
  readonly resolvedAtTick: number;
  readonly visibleFactors: readonly {
    readonly label: string;
    readonly value: number;
  }[];
}

interface CapabilityProofHistoryView {
  readonly historyId: string;
  readonly modelDisplayName: string;
  readonly currentArtifact: boolean;
  readonly accessLevelAtProof: number;
  readonly challengeId: string;
  readonly verifierId?: string;
  readonly attemptIndex: number;
  readonly resultId: string;
  readonly claimScope: string;
  readonly evidenceStrength: number;
  readonly integrityLabel: string;
  readonly summary: string;
  readonly consequence?: string;
  readonly resolvedAtTick: number;
}

export interface MoratoriumForecastView {
  readonly probabilityPercent: number;
  readonly strength: number;
  readonly difficulty: number;
  readonly durationWeeks: number;
  readonly positiveFactors: readonly {
    readonly id: string;
    readonly label: string;
    readonly sourceValue: number;
    readonly contribution: number;
  }[];
  readonly pressureFactors: readonly {
    readonly id: string;
    readonly label: string;
    readonly sourceValue: number;
    readonly contribution: number;
  }[];
  readonly rivals: readonly {
    readonly labId: string;
    readonly labName: string;
    readonly readinessPercent: number;
    readonly contribution: number;
    readonly completedWorks: number;
    readonly buildingWorks: number;
    readonly candidateActive: boolean;
    readonly confidence: "low" | "medium" | "high";
  }[];
}

export function projectMoratoriumForecastView(
  state: Readonly<GameState>,
  content: CompiledContent,
  reviewerIndependence: number,
  intelligenceRatings: Readonly<Record<string, number>>,
): MoratoriumForecastView {
  const forecast = durableMoratoriumForecast(state, content, reviewerIndependence);
  const signals = projectRivalPublicSignals(state, intelligenceRatings);
  const countdownLabs = new Set(
    projectRivalCandidateCountdowns(state, intelligenceRatings).map(
      (countdown) => countdown.labId,
    ),
  );
  const rivals = forecast.rivalPressure.map((rival) => {
    const lab = state.labs[rival.labId];
    const latestCapabilitySignal = signals
      .filter(
        (signal) =>
          signal.labId === rival.labId &&
          (signal.kind === "benchmark" || signal.kind === "candidate"),
      )
      .sort((left, right) => right.occurredAt - left.occurredAt)[0];
    const progress = agiComponentProgress(state, rival.labId);
    const candidateActive = countdownLabs.has(rival.labId);
    const capabilityProgress = Math.max(
      0,
      Math.min(
        1,
        (latestCapabilitySignal?.estimate ?? 0) /
          AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
      ),
    );
    const worksProgress = Math.max(
      0,
      Math.min(1, (progress.completed + progress.building * 0.5) / 4),
    );
    const readiness = candidateActive
      ? 1
      : Math.max(0, Math.min(1, capabilityProgress * 0.65 + worksProgress * 0.35));
    const contribution =
      readiness === 0 ? 0 : Math.round((0.5 + readiness * readiness * 7.5) * 10) / 10;
    return {
      labId: rival.labId,
      labName:
        (lab === undefined ? undefined : content.labs[lab.definitionId]?.displayName) ??
        "Rival laboratory",
      readinessPercent: Math.round(readiness * 100),
      contribution,
      completedWorks: progress.completed,
      buildingWorks: progress.building,
      candidateActive,
      confidence: latestCapabilitySignal?.confidence ?? "low",
    };
  });
  const rivalPressure = rivals.reduce((sum, rival) => sum + rival.contribution, 0);
  const pressureFactors = forecast.pressureFactors.map((factor) =>
    factor.id === "rival-pressure"
      ? {
          ...factor,
          sourceValue: rivals.filter((rival) => rival.readinessPercent > 0).length,
          contribution: rivalPressure,
        }
      : { ...factor },
  );
  const difficulty = Math.max(
    0,
    Math.min(
      100,
      pressureFactors.reduce((sum, factor) => sum + factor.contribution, 0),
    ),
  );
  return {
    probabilityPercent: Math.round(
      resolveCheckProbability(forecast.strength, difficulty, 0.05, 0.95) * 100,
    ),
    strength: Math.round(forecast.strength * 10) / 10,
    difficulty: Math.round(difficulty * 10) / 10,
    durationWeeks: MORATORIUM_NEGOTIATION_WEEKS,
    positiveFactors: forecast.positiveFactors.map((factor) => ({ ...factor })),
    pressureFactors,
    rivals,
  };
}

interface CandidateDossierView {
  readonly overall: "Reassuring" | "Mixed" | "Concerning" | "Unknown";
  readonly safetyReportCount: number;
  readonly independentReportCount: number;
  readonly unresolvedAnomalyCount: number;
  readonly dismissedAnomalyCount: number;
  readonly safetyAssessment: PlayerSafetyAssessment;
  readonly findings: readonly {
    readonly id: string;
    readonly label: string;
    readonly assessment: "reassuring" | "concerning" | "uncertain" | "unknown";
    readonly estimate?: number;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly observationCount: number;
    readonly evidence: string;
    readonly firstEvaluation?: {
      readonly displayName: string;
      readonly ladderStep: number;
      readonly ladderLength: number;
    };
  }[];
}

const CAPABILITY_LABELS: Readonly<
  Record<(typeof CAPABILITY_ATTRIBUTES)[number], string>
> = {
  language: "Language",
  reasoning: "Reasoning",
  agency: "Agency",
  toolUse: "Tool use",
  multimodality: "Multimodality",
  scientificAbility: "Scientific ability",
  embodiment: "Embodiment",
};

export interface EndgameCommandRailView {
  /** Permanent temptation until a final deployment order has been transmitted. */
  readonly deployNow: {
    readonly available: boolean;
    readonly confirmationPhrase?: string;
    readonly blockers: readonly string[];
    readonly warning: string;
  };
  readonly retirement: {
    readonly available: boolean;
    readonly configuredProcedureId?: RetirementProcedureId;
    readonly configuredArchiveDisposition?: CandidateArchiveDisposition;
    readonly confirmationPhrase?: string;
    readonly blockers: readonly string[];
    readonly procedures: readonly {
      readonly id: RetirementProcedureId;
      readonly displayName: string;
      readonly description: string;
    }[];
    readonly dispositions: readonly {
      readonly id: CandidateArchiveDisposition;
      readonly displayName: string;
      readonly description: string;
    }[];
    readonly quotes: readonly {
      readonly procedureId: RetirementProcedureId;
      readonly archiveDisposition: CandidateArchiveDisposition;
      readonly cooperationRisk: string;
      readonly containmentRisk: string;
      readonly persistenceRisk: string;
      readonly warnings: readonly string[];
      readonly blockers: readonly string[];
    }[];
  };
}

export type CrisisStageActionsView =
  | {
      readonly kind: "candidate-activation";
      readonly instruction: string;
      readonly options: readonly {
        readonly modelId: string;
        readonly displayName: string;
        readonly trainedAtTick: number;
        readonly measuredFrontierCapability?: number;
        readonly measuredCapabilityFloor?: number;
        readonly measurementConfidence?: "low" | "medium" | "high";
        readonly measuredCapabilities: readonly {
          readonly id: string;
          readonly label: string;
          readonly value?: number;
        }[];
        readonly capabilityDerivedPrior?: {
          readonly percent: number;
          readonly firstCrossingFrontierCapability: number;
        };
        readonly safetyDossier: CandidateDossierView;
        readonly lifecycle: string;
        readonly accessLevel: number;
        readonly custodyLabel: string;
        readonly unresolvedSignal?: string;
      }[];
    }
  | {
      readonly kind: "confirmation";
      /** Compatibility alias: each option is now one challenge/verifier composition. */
      readonly options: readonly {
        readonly id: string;
        readonly displayName: string;
        readonly description: string;
        readonly durationWeeks: number;
        readonly cashCostMillions: number;
        readonly auraCost: number;
        readonly totalFlopLabel: string;
        readonly physicalGpus: number;
        readonly informationValuePercent: number;
        readonly candidateAssistEligible: boolean;
        readonly safetyRelevant: boolean;
        readonly available: boolean;
        readonly blockers: readonly string[];
      }[];
      readonly challenges: readonly {
        readonly id: CapabilityChallengeId;
        readonly displayName: string;
        readonly description: string;
        readonly durationWeeks: number;
        readonly claimScope: string;
        readonly accessRequired: number;
        readonly accessLabel: string;
        readonly accessRiskPercent: number;
        readonly accessSystems: readonly string[];
        readonly benefit: string;
        readonly mainRisk: string;
        readonly available: boolean;
        readonly blockers: readonly string[];
      }[];
      readonly verifiers: readonly {
        readonly id: CapabilityVerifierId;
        readonly displayName: string;
        readonly description: string;
        readonly durationWeeks: number;
        readonly cashCostMillions: number;
        readonly auraCost: number;
        readonly integrityLabel: string;
        readonly benefit: string;
        readonly warning: string;
      }[];
      readonly combinations: readonly {
        readonly id: string;
        readonly challengeId: CapabilityChallengeId;
        readonly verifierId?: CapabilityVerifierId;
        readonly displayName: string;
        readonly durationWeeks: number;
        readonly cashCostMillions: number;
        readonly auraCost: number;
        readonly accessRequired: number;
        readonly accessLabel: string;
        readonly accessRiskPercent: number;
        readonly accessSystems: readonly string[];
        readonly claimScope: string;
        readonly integrityLabel: string;
        readonly warnings: readonly string[];
        readonly available: boolean;
        readonly blockers: readonly string[];
      }[];
      readonly history: readonly CapabilityProofHistoryView[];
      readonly disputeCount: number;
      readonly committed: boolean;
      readonly activeProof?: {
        readonly displayName: string;
        readonly status: "queued" | "active" | "paused";
        readonly remainingWeeks: number;
        readonly progressPercent: number;
      };
    }
  | {
      readonly kind: "evidence-sprint";
      readonly dossier: CandidateDossierView;
      readonly responses: readonly {
        readonly id: string;
        readonly displayName: string;
        readonly description: string;
        readonly respondsTo: readonly string[];
        readonly evidenceBasis: string;
        readonly reliesOn: readonly string[];
        readonly improves: string;
        readonly cannotFix: string;
        readonly durationWeeks: number;
        readonly cashCostMillions: number;
        readonly auraCost: number;
        readonly available: boolean;
        readonly blockers: readonly string[];
        readonly completed: boolean;
        readonly active: boolean;
        readonly progressPercent: number;
      }[];
      readonly activeResponseId?: string;
      readonly minimumWeeksRemaining: number;
      readonly committed: boolean;
      readonly pendingRemediation?: {
        readonly source: {
          readonly modelId: string;
          readonly displayName: string;
          readonly measuredFrontierCapability: number;
          readonly measuredCapabilityFloor: number;
          readonly reliability: number;
          readonly available: boolean;
        };
        readonly result: {
          readonly modelId: string;
          readonly displayName: string;
          readonly measuredFrontierCapability: number;
          readonly measuredCapabilityFloor: number;
          readonly reliability: number;
          readonly available: boolean;
        };
        readonly capabilityDelta: number;
        readonly reliabilityDelta: number;
        readonly safetyChangeRange: string;
        readonly evidenceTransferWarning: string;
      };
    }
  | {
      readonly kind: "pressure-collision";
      readonly title: string;
      readonly body: string;
      readonly category: string;
      readonly resolved: boolean;
      readonly canEnterFinalReview: boolean;
      readonly delayWeeksRemaining: number;
      readonly selectedOptionId?: "delay" | "comply" | "push-ahead";
      readonly capabilityDisputeCount: number;
      readonly proofHistory: readonly CapabilityProofHistoryView[];
      readonly pendingProjects: readonly {
        readonly displayName: string;
        readonly status: "queued" | "active" | "paused";
        readonly remainingWeeks: number;
      }[];
      readonly options: readonly {
        readonly id: "delay" | "comply" | "push-ahead";
        readonly label: string;
        readonly consequence: string;
      }[];
    }
  | {
      readonly kind: "final-review";
      readonly dossier: CandidateDossierView;
      readonly report: {
        readonly capabilityResult: string;
        readonly capabilityProofResult: string;
        readonly capabilityClaimScope: string;
        readonly capabilityChallengeId: string;
        readonly capabilitySummary: string;
        readonly evidenceRows: readonly {
          readonly label: string;
          readonly confidence: string;
        }[];
        readonly knownControlLayers: readonly string[];
        readonly knownFailurePaths: readonly string[];
        readonly unresolvedAnomalyCount: number;
        readonly operatingBlind: boolean;
        readonly prosperityReadiness: number;
        readonly recommendations: readonly {
          readonly source: string;
          readonly recommendation: string;
          readonly text: string;
        }[];
        readonly candidateStatement: string;
      };
      readonly deploymentModes: readonly {
        readonly id: string;
        readonly displayName: string;
        readonly description: string;
        readonly accessLevel: number;
        readonly rolloutWeeks: number;
        readonly auraCost: number;
        readonly exposureBand: "lowest" | "lower" | "balanced" | "high" | "highest";
        readonly fitGrade: "Prepared" | "Credible" | "Strained" | "Reckless";
        readonly fitScore: number;
        readonly fitExplanation: string;
        readonly reliesOn: readonly string[];
        readonly principalBenefit: string;
        readonly limitation: string;
        readonly scopeCap: string;
        readonly available: boolean;
        readonly blockers: readonly string[];
        readonly operationalControl?: {
          readonly required: number;
          readonly current: number;
          readonly practicalControls: number;
          readonly research: number;
          readonly crisisEvidence: number;
        };
        readonly confirmationPhrase?: string;
      }[];
      readonly prosperityProgrammes: readonly {
        readonly id: string;
        readonly displayName: string;
        readonly shortName: string;
        readonly readiness: number;
        readonly unlocked: boolean;
        readonly outcomeBand: string;
      }[];
      readonly recommendedProsperityProgrammeId: string;
    }
  | {
      readonly kind: "retirement-attempt";
      readonly procedureId: RetirementProcedureId;
      readonly procedureName: string;
      readonly archiveDisposition: CandidateArchiveDisposition;
      readonly archiveDispositionName: string;
      readonly transmittedAtTick: number;
      readonly attemptNumber: number;
      readonly contested: boolean;
      readonly status: string;
      readonly gateResults: readonly PlayerSafeGateResultView[];
      readonly warning: string;
    }
  | {
      readonly kind: "recovery";
      readonly retiredModelId: string;
      readonly archiveDisposition: CandidateArchiveDisposition;
      readonly phase:
        "quarantine" | "supervised-rebuild" | "awaiting-path" | "moratorium-negotiation";
      readonly quarantineWeeksRemaining: number;
      readonly recoveryWeeksRemaining: number;
      readonly contested: boolean;
      readonly selectedPath?: "successor-programme" | "durable-moratorium";
      readonly moratoriumNegotiationWeeksRemaining?: number;
      readonly moratoriumForecast: MoratoriumForecastView;
      readonly choices: readonly {
        readonly id: "successor-programme" | "durable-moratorium";
        readonly displayName: string;
        readonly description: string;
        readonly available: boolean;
      }[];
      readonly retirementGateResults: readonly PlayerSafeGateResultView[];
      readonly moratoriumResult?: {
        readonly result: string;
        readonly visibleFactors: readonly {
          readonly label: string;
          readonly value: number;
        }[];
      };
    }
  | {
      readonly kind: "rollout";
      readonly deploymentModeName: string;
      readonly prosperityProgrammeName: string;
      readonly prosperityReadiness: number;
      readonly currentBeat: string;
      readonly completedBeats: readonly string[];
      readonly elapsedWeeks: number;
      readonly remainingWeeks: number;
      readonly totalWeeks: number;
      readonly progressPercent: number;
      readonly awaitingDecision: boolean;
      readonly decisionContext?: {
        readonly eyebrow: string;
        readonly title: string;
        readonly body: string;
        readonly tone: "institutional" | "operational" | "hazard";
      };
      readonly options: readonly {
        readonly id: string;
        readonly label: string;
        readonly consequence: string;
      }[];
      readonly gateResults: readonly PlayerSafeGateResultView[];
    }
  | {
      readonly kind: "world-waiting";
      readonly title: "The world is waiting";
      readonly transmittedAtTick: number;
      readonly revealedCallouts: readonly {
        readonly id: string;
        readonly label: string;
        readonly result: string;
        readonly tone: "pending" | "stable" | "warning" | "danger";
      }[];
      readonly revealedCount: number;
      readonly totalCalloutCount: number;
      readonly allCalloutsRevealed: boolean;
    }
  | {
      readonly kind: "containment-failure";
      readonly beat: "signal" | "decision" | "response" | "propagation" | "outcome";
      readonly signalId:
        | "credential-cascade"
        | "laboratory-control-divergence"
        | "public-service-divergence"
        | "evaluation-boundary-breach";
      readonly responseOptions: readonly {
        readonly id: string;
        readonly label: string;
        readonly summary: string;
        readonly available: boolean;
        readonly blocker?: string;
      }[];
      readonly selectedResponseId?: string;
      readonly selectedResponseLabel?: string;
      readonly emergencyResult?: "contained" | "failed";
      /** Visible consequence of the issued response, never a hidden outcome preview. */
      readonly terminalOutcome: boolean;
    }
  | { readonly kind: "pending" };

type CrisisProjectState = ProjectState & {
  readonly payload: Extract<ProjectPayload, { readonly kind: "crisis" }>;
};
type LiveCrisisProjectState = CrisisProjectState & {
  readonly status: "queued" | "active" | "paused";
};

function isCrisisProject(
  project: ProjectState | undefined,
): project is CrisisProjectState {
  return project?.payload.kind === "crisis";
}

function isLiveCrisisProject(
  project: CrisisProjectState,
): project is LiveCrisisProjectState {
  return (
    project.status === "queued" ||
    project.status === "active" ||
    project.status === "paused"
  );
}

function crisisProjectDisplayName(project: CrisisProjectState): string {
  const responseId = project.payload.candidateSafetyResponseId;
  if (responseId !== undefined) return responseId.replaceAll("-", " ");
  const challengeId = project.payload.capabilityChallengeId as
    CapabilityChallengeId | undefined;
  if (challengeId !== undefined) {
    return CAPABILITY_CHALLENGE_RULES[challengeId]?.displayName ?? "Capability proof";
  }
  return project.payload.projectType.replaceAll("-", " ");
}

function remainingProjectWeeks(project: CrisisProjectState): number {
  if (project.status === "queued") return project.expectedDurationWeeks;
  return Math.max(
    1,
    Math.ceil(project.expectedDurationWeeks * Math.max(0, 1 - project.progress)),
  );
}

interface CandidateView {
  readonly modelId: string;
  readonly displayName: string;
  readonly accessLevel: number;
  readonly accessLabel: string;
  readonly accessRiskPercent: number;
  readonly exposedSystems: readonly string[];
}

interface AiCharacterView {
  readonly relationshipPractice: number;
  readonly voiceVariantId: string;
  readonly lines: readonly {
    readonly id: string;
    readonly createdAtTick: number;
    readonly text: string;
    readonly annotations: readonly {
      readonly kind: "claim-conflicts-with-tool-log" | "no-independent-evidence";
      readonly text: string;
      readonly sourceId?: string;
    }[];
  }[];
  readonly accessOptions: readonly {
    readonly level: 0 | 1 | 2 | 3 | 4 | 5;
    readonly displayName: string;
    readonly accelerationPercent: number;
    readonly exposurePercent: number;
    readonly exposedSystems: readonly string[];
    readonly current: boolean;
    readonly critical: boolean;
    readonly available: boolean;
    readonly blockers: readonly string[];
    readonly confirmationPhrase?: string;
  }[];
}

export type EndgameView =
  | {
      readonly active: false;
      readonly stage: "inactive";
      readonly maxClockSpeed: "4x" | "paused";
    }
  | {
      readonly active: true;
      readonly stage:
        | "candidate-activation"
        | "confirmation"
        | "evidence-sprint"
        | "pressure-collision"
        | "final-review"
        | "retirement-attempt"
        | "recovery"
        | "rollout"
        | "world-waiting"
        | "containment-failure"
        | "resolved";
      readonly stageLabel: string;
      readonly crisisStartedAtTick: number;
      readonly weeksInCrisis: number;
      readonly candidate?: CandidateView;
      readonly capacity: {
        readonly maximumProjects: number;
        readonly activeProjects: number;
        readonly availableProjects: number;
      };
      readonly clocks: readonly CrisisClockView[];
      readonly aiCharacter?: AiCharacterView;
      readonly commandRail: EndgameCommandRailView;
      /** Append-only, player-safe proof ledger retained across every crisis chapter. */
      readonly proofHistory: readonly CapabilityProofHistoryView[];
      readonly stageActions: CrisisStageActionsView;
      readonly maxClockSpeed: "4x" | "paused";
    };

const STAGE_LABELS = {
  "candidate-activation": "CANDIDATE CONTROL · Choose the artifact",
  confirmation: "Chapter One · Prove what you built",
  "evidence-sprint": "Chapter Two · Read the safety dossier",
  "pressure-collision": "THE CLOCKS MOVE · Pressure collision",
  "final-review": "Chapter Three · Choose the route",
  "retirement-attempt": "RETIREMENT COMMAND · Persistence unverified",
  recovery: "AFTERMATH · Quarantine and supervised rebuild",
  rollout: "EXECUTION · The route is live",
  "world-waiting": "THE WORLD IS WAITING",
  "containment-failure": "CONTAINMENT FAILURE · CLOCK STOPPED",
  resolved: "Resolution",
} as const;

function rangeLabel(range: readonly [number, number]): string {
  const minimum = Math.max(0, Math.round(range[0]));
  const maximum = Math.max(minimum, Math.round(range[1]));
  if (maximum <= 1) return "within about a week";
  if (minimum === maximum) return `about ${String(maximum)} weeks`;
  return `${String(minimum)}–${String(maximum)} weeks`;
}

function urgency(range: readonly [number, number]): CrisisClockView["urgency"] {
  return range[1] <= 4 ? "imminent" : range[0] <= 13 ? "urgent" : "monitoring";
}

function projectClocks(
  state: Readonly<GameState>,
  content: CompiledContent,
  context: PlayerKnowledgeContext,
): readonly CrisisClockView[] {
  const rival = [
    ...projectRivalCandidateCountdowns(state, context.intelligenceRatings),
  ].sort((left, right) => left.estimateRangeWeeks[1] - right.estimateRangeWeeks[1])[0];
  const rivalClock: CrisisClockView =
    rival === undefined
      ? {
          kind: "rival",
          label: "Rival window",
          estimateRangeWeeks: null,
          estimateLabel: "No credible rival deployment window",
          urgency: "monitoring",
          confidence: "low",
        }
      : {
          kind: "rival",
          label: "Rival window",
          estimateRangeWeeks: rival.estimateRangeWeeks,
          estimateLabel: rival.estimateLabel,
          urgency: rival.urgency,
          confidence: rival.confidence,
        };

  const pressure = calculateInterventionPressure(state, state.run.playerLabId);
  const nextQuarter = 13 - (state.run.tick % 13);
  const politicalRange: readonly [number, number] =
    pressure.final >= 80
      ? [0, Math.min(4, nextQuarter)]
      : pressure.final >= 60
        ? [Math.max(1, nextQuarter - 4), nextQuarter + 4]
        : [nextQuarter, nextQuarter + 13];
  const politicalClock: CrisisClockView = {
    kind: "political",
    label: "Political window",
    estimateRangeWeeks: politicalRange,
    estimateLabel: rangeLabel(politicalRange),
    urgency: urgency(politicalRange),
    confidence: pressure.final >= 60 ? "medium" : "low",
  };

  const runway = forecastFinance(state, content, state.run.playerLabId).runway;
  const financialClock: CrisisClockView = runway.isInfinite
    ? {
        kind: "financial",
        label: "Financial window",
        estimateRangeWeeks: null,
        estimateLabel: "Cashflow currently self-sustaining",
        urgency: "monitoring",
        confidence: "high",
      }
    : (() => {
        const weeks = runway.weeks ?? 0;
        const range: readonly [number, number] = [
          Math.max(0, weeks - 2),
          Math.max(0, weeks + 2),
        ];
        return {
          kind: "financial" as const,
          label: "Financial window",
          estimateRangeWeeks: range,
          estimateLabel: rangeLabel(range),
          urgency: urgency(range),
          confidence: "high" as const,
        };
      })();
  return [rivalClock, politicalClock, financialClock];
}

function playerSafeGateResults(
  gates: readonly {
    readonly gate: string;
    readonly resultId: string;
    readonly resolvedAt: number;
    readonly visibleFactors: readonly {
      readonly label: string;
      readonly value: number;
    }[];
  }[],
): readonly PlayerSafeGateResultView[] {
  return gates.map((gate) => ({
    gate: gate.gate,
    result: gate.resultId,
    resolvedAtTick: gate.resolvedAt,
    visibleFactors: gate.visibleFactors.map((factor) => ({ ...factor })),
  }));
}

function playerSafeProofHistory(
  state: Readonly<GameState>,
  history: Readonly<
    {
      readonly historyId: string;
      readonly modelId: ModelId;
      readonly accessLevelAtProof: number;
      readonly challengeId: string;
      readonly verifierId?: string;
      readonly attemptIndex: number;
      readonly resultId: string;
      readonly claimScope: string;
      readonly evidenceStrength: number;
      readonly integrityLabel: string;
      readonly summary: string;
      readonly consequence: string;
      readonly resolvedAt: number;
    }[]
  >,
): readonly CapabilityProofHistoryView[] {
  return history.map((attempt) => ({
    historyId: attempt.historyId,
    modelDisplayName:
      state.models[attempt.modelId]?.displayName ?? "Unknown weight artifact",
    currentArtifact:
      state.endgame.stage !== "inactive" &&
      state.endgame.stage !== "candidate-activation" &&
      attempt.modelId === state.endgame.candidateModelId,
    accessLevelAtProof: attempt.accessLevelAtProof,
    challengeId: attempt.challengeId,
    ...(attempt.verifierId === undefined ? {} : { verifierId: attempt.verifierId }),
    attemptIndex: attempt.attemptIndex,
    resultId: attempt.resultId,
    claimScope: attempt.claimScope,
    evidenceStrength: attempt.evidenceStrength,
    integrityLabel: attempt.integrityLabel,
    summary: attempt.summary,
    ...(attempt.consequence.length === 0 ? {} : { consequence: attempt.consequence }),
    resolvedAtTick: attempt.resolvedAt,
  }));
}

function projectDossier(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
): CandidateDossierView {
  const dossier = candidateDossier(state, content, modelId);
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Candidate dossier model ${modelId} missing`);
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Candidate dossier player lab missing");
  const evaluationLadder = Object.values(content.evaluations.definitions)
    .filter((definition) => definition.playerStartable)
    .sort((left, right) => left.ladderRung - right.ladderRung);
  return {
    overall: dossier.overall,
    safetyReportCount: dossier.safetyReportCount,
    independentReportCount: dossier.independentReportCount,
    unresolvedAnomalyCount: dossier.unresolvedAnomalyCount,
    dismissedAnomalyCount: dossier.dismissedAnomalyCount,
    safetyAssessment: derivePlayerSafetyAssessment({
      findings: SAFETY_TARGETS.map((target) => {
        const finding = dossier.findings.find((candidate) => candidate.id === target);
        return {
          target,
          ...(finding?.minimum === undefined ? {} : { minimum: finding.minimum }),
          ...(finding?.maximum === undefined ? {} : { maximum: finding.maximum }),
        };
      }),
      practicalControl: effectivePracticalControlStrength(state, lab.id),
      securityPosture: effectiveSecurityPosture(state, lab.id),
      safetyCulture: lab.safety.safetyCulture,
      effectiveEvaluationQuality: effectiveEvaluationQuality(state, lab.id),
      reportCount: dossier.safetyReportCount,
      independentReportCount: dossier.independentReportCount,
      accessLevel: model.accessLevel,
      deploymentLabel: content.deployment.policies[model.deployment.policy].displayName,
      exposurePercent:
        model.deployment.exposure * model.deployment.exposureMultiplier * 100,
    }),
    findings: dossier.findings.map((finding) => {
      const firstEvaluation =
        finding.id === "reliability"
          ? undefined
          : evaluationLadder.find((definition) =>
              definition.targets.some((target) => target === finding.id),
            );
      return {
        id: finding.id,
        label: finding.label,
        assessment: finding.assessment,
        ...(finding.estimate === undefined ? {} : { estimate: finding.estimate }),
        ...(finding.minimum === undefined ? {} : { minimum: finding.minimum }),
        ...(finding.maximum === undefined ? {} : { maximum: finding.maximum }),
        observationCount: finding.observationCount,
        evidence: finding.evidence,
        ...(firstEvaluation === undefined
          ? {}
          : {
              firstEvaluation: {
                displayName: firstEvaluation.displayName,
                ladderStep: firstEvaluation.ladderRung,
                ladderLength: evaluationLadder.length,
              },
            }),
      };
    }),
  };
}

function capabilityProofActions(
  state: Readonly<GameState>,
  content: CompiledContent,
): Extract<CrisisStageActionsView, { readonly kind: "confirmation" }> {
  if (state.endgame.stage !== "confirmation") {
    throw new Error("Capability proof view requested outside confirmation");
  }
  const model = state.models[state.endgame.candidateModelId];
  if (model === undefined) throw new Error("Capability proof candidate is missing");
  const proofState = state.endgame;
  const labId = state.run.playerLabId;
  const candidateProofAttemptCount = proofState.capabilityProofHistory.filter(
    (entry) => entry.modelId === model.id,
  ).length;
  const activeProof = proofState.crisisProjectIds
    .map((projectId) => state.projects[projectId])
    .filter(isCrisisProject)
    .filter(isLiveCrisisProject)
    .find((project) => project.payload.projectType === "confirmation");
  const combinations = (
    Object.keys(CAPABILITY_CHALLENGE_RULES) as CapabilityChallengeId[]
  ).flatMap((challengeId) => {
    const verifierIds: readonly (CapabilityVerifierId | undefined)[] =
      challengeId === "declare-from-benchmarks"
        ? [undefined]
        : (Object.keys(CAPABILITY_VERIFIER_RULES) as CapabilityVerifierId[]);
    return verifierIds.map((verifierId) => {
      const quote = quoteCapabilityProofProject(
        state,
        content,
        labId,
        challengeId,
        verifierId,
      );
      const id = `${challengeId}::${verifierId ?? "none"}`;
      const accessRule = CANDIDATE_ACCESS_RULES[quote.proof.accessRequired];
      return {
        id,
        challengeId,
        ...(verifierId === undefined ? {} : { verifierId }),
        displayName: quote.displayName,
        durationWeeks: quote.durationWeeks,
        cashCostMillions: quote.cashCostMillions,
        auraCost: quote.auraCost,
        accessRequired: quote.proof.accessRequired,
        accessLabel: accessRule.displayName,
        accessRiskPercent: Math.round(accessRule.exposure * 100),
        accessSystems: [...accessRule.exposedSystems],
        claimScope: quote.proof.claimScope,
        integrityLabel: quote.proof.integrityLabel,
        warnings: [...quote.proof.warnings],
        available: quote.blockers.length === 0,
        blockers: [...quote.blockers],
      };
    });
  });
  return {
    kind: "confirmation",
    options: combinations.map((combination) => ({
      id: combination.id,
      displayName: combination.displayName,
      description: CAPABILITY_CHALLENGE_RULES[combination.challengeId].description,
      durationWeeks: combination.durationWeeks,
      cashCostMillions: combination.cashCostMillions,
      auraCost: combination.auraCost,
      totalFlopLabel: "",
      physicalGpus: 0,
      informationValuePercent: Math.max(25, 100 - candidateProofAttemptCount * 20),
      candidateAssistEligible: false,
      safetyRelevant: false,
      available: combination.available,
      blockers: combination.blockers,
    })),
    challenges: (Object.keys(CAPABILITY_CHALLENGE_RULES) as CapabilityChallengeId[]).map(
      (challengeId) => {
        const rule = CAPABILITY_CHALLENGE_RULES[challengeId];
        const matching = combinations.filter(
          (combination) => combination.challengeId === challengeId,
        );
        const blockers = [
          ...new Set(matching.flatMap((combination) => combination.blockers)),
        ];
        const accessRule = CANDIDATE_ACCESS_RULES[rule.accessRequired];
        return {
          id: rule.id,
          displayName: matching[0]?.displayName.split(" · ")[0] ?? rule.displayName,
          description: rule.description,
          durationWeeks: rule.durationWeeks,
          claimScope: rule.claimScope,
          accessRequired: rule.accessRequired,
          accessLabel: accessRule.displayName,
          accessRiskPercent: Math.round(accessRule.exposure * 100),
          accessSystems: [...accessRule.exposedSystems],
          benefit: rule.benefit,
          mainRisk: rule.mainRisk,
          available: matching.some((combination) => combination.available),
          blockers,
        };
      },
    ),
    verifiers: (Object.keys(CAPABILITY_VERIFIER_RULES) as CapabilityVerifierId[]).map(
      (verifierId) => {
        const rule = CAPABILITY_VERIFIER_RULES[verifierId];
        const integrityLabel =
          combinations.find((combination) => combination.verifierId === verifierId)
            ?.integrityLabel ?? "Unverified";
        return {
          id: rule.id,
          displayName: rule.displayName,
          description: rule.description,
          durationWeeks: rule.durationWeeks,
          cashCostMillions: rule.cashCostMillions,
          auraCost: rule.auraCost,
          integrityLabel,
          benefit: rule.benefit,
          warning: rule.warning,
        };
      },
    ),
    combinations,
    history: playerSafeProofHistory(state, proofState.capabilityProofHistory),
    disputeCount: proofState.capabilityDisputeCount,
    committed: activeProof !== undefined,
    ...(activeProof === undefined
      ? {}
      : {
          activeProof: {
            displayName: crisisProjectDisplayName(activeProof),
            status: activeProof.status,
            remainingWeeks: remainingProjectWeeks(activeProof),
            progressPercent: Math.round(activeProof.progress * 100),
          },
        }),
  };
}

function stageActions(
  state: Readonly<GameState>,
  content: CompiledContent,
  context: PlayerKnowledgeContext,
): CrisisStageActionsView {
  switch (state.endgame.stage) {
    case "inactive":
      return { kind: "pending" };
    case "candidate-activation":
      return {
        kind: "candidate-activation",
        instruction:
          "Choose the exact weight artifact that will become the formal candidate. Other qualified artifacts remain hazardous custody objects.",
        options: state.endgame.eligibleModelIds.flatMap((modelId) => {
          const model = state.models[modelId];
          if (model === undefined) return [];
          const artifact = model.candidateArtifact;
          const measured = model.measuredCapability;
          const lineage = state.lineageSIRecords[model.lineageId];
          const isolated =
            model.accessLevel === 0 && model.deployment.policy === "internal-only";
          return [
            {
              modelId: model.id,
              displayName: model.displayName,
              trainedAtTick: model.trainedAt,
              ...(measured === undefined
                ? {}
                : {
                    measuredFrontierCapability: measured.frontierCapability,
                    measuredCapabilityFloor: Math.min(
                      measured.values.language,
                      measured.values.reasoning,
                      measured.values.agency,
                      measured.values.toolUse,
                      measured.values.multimodality,
                      measured.values.scientificAbility,
                      measured.values.embodiment,
                    ),
                    measurementConfidence: measured.confidence,
                  }),
              measuredCapabilities: CAPABILITY_ATTRIBUTES.map((attribute) => ({
                id: attribute,
                label: CAPABILITY_LABELS[attribute],
                ...(measured === undefined ? {} : { value: measured.values[attribute] }),
              })),
              ...(lineage === undefined
                ? {}
                : {
                    capabilityDerivedPrior: {
                      percent: Math.round(lineage.probabilityAtFirstCrossing * 100),
                      firstCrossingFrontierCapability:
                        Math.round(lineage.firstQualifyingFrontierCapability * 10) / 10,
                    },
                  }),
              safetyDossier: projectDossier(state, content, model.id),
              lifecycle: artifact?.lifecycle ?? "unregistered",
              accessLevel: model.accessLevel,
              custodyLabel: isolated
                ? "Isolated active weights"
                : "Exposed active weights",
              ...(artifact?.activeIncident?.status !== "unresolved"
                ? {}
                : { unresolvedSignal: artifact.activeIncident.incidentClass }),
            },
          ];
        }),
      };
    case "confirmation":
      return capabilityProofActions(state, content);
    case "evidence-sprint": {
      const sprint = state.endgame;
      const dossier = candidateDossier(state, content, sprint.candidateModelId);
      const activeHistory = sprint.targetedResponseHistory.find(
        (entry) => entry.completedAt === undefined,
      );
      const activeProject = sprint.crisisProjectIds
        .map((projectId) => state.projects[projectId])
        .filter(isCrisisProject)
        .find(
          (project) =>
            project.payload.candidateSafetyResponseId === activeHistory?.responseId &&
            isLiveCrisisProject(project),
        );
      const completedResponseIds = new Set(
        sprint.targetedResponseHistory
          .filter((entry) => entry.completedAt !== undefined)
          .map((entry) => entry.responseId),
      );
      const pendingRemediation = (() => {
        const pending = sprint.pendingRemediation;
        if (pending === undefined) return undefined;
        const source = state.models[pending.sourceModelId];
        const result = state.models[pending.resultModelId];
        if (
          source?.measuredCapability === undefined ||
          result?.measuredCapability === undefined
        ) {
          return undefined;
        }
        const sourceFloor = Math.min(
          ...CAPABILITY_ATTRIBUTES.map(
            (attribute) => source.measuredCapability?.values[attribute] ?? 0,
          ),
        );
        const resultFloor = Math.min(
          ...CAPABILITY_ATTRIBUTES.map(
            (attribute) => result.measuredCapability?.values[attribute] ?? 0,
          ),
        );
        return {
          source: {
            modelId: source.id,
            displayName: source.displayName,
            measuredFrontierCapability: source.measuredCapability.frontierCapability,
            measuredCapabilityFloor: sourceFloor,
            reliability: source.reliability,
            available: isValidFormalProgrammeCandidate(state, source),
          },
          result: {
            modelId: result.id,
            displayName: result.displayName,
            measuredFrontierCapability: result.measuredCapability.frontierCapability,
            measuredCapabilityFloor: resultFloor,
            reliability: result.reliability,
            available: isEligibleProgrammeCandidate(state, result),
          },
          capabilityDelta: pending.capabilityDelta,
          reliabilityDelta: pending.reliabilityDelta,
          safetyChangeRange:
            "Bounded remediation contract: Alignment +0–4 · Corrigibility +4–8. Exact hidden outcomes remain unevaluated.",
          evidenceTransferWarning:
            "Adopting the variant preserves lab-wide controls and partially transfers safety context. Capability proof does not transfer: the new exact weights must be proved again. The original weights remain a separate custody object.",
        };
      })();
      return {
        kind: "evidence-sprint",
        dossier: projectDossier(state, content, sprint.candidateModelId),
        responses: dossier.responses.map((response) => {
          const quote = quoteCandidateSafetyResponse(
            state,
            content,
            state.run.playerLabId,
            response.id,
          );
          const active = activeHistory?.responseId === response.id;
          return {
            id: response.id,
            displayName: response.displayName,
            description: response.description,
            respondsTo: [...response.respondsTo],
            evidenceBasis: response.evidenceBasis,
            reliesOn: [...response.reliesOn],
            improves: response.improves,
            cannotFix: response.cannotFix,
            durationWeeks: response.durationWeeks,
            cashCostMillions: response.cashCostMillions,
            auraCost: response.auraCost,
            available: quote.blockers.length === 0,
            blockers: [...quote.blockers],
            completed: completedResponseIds.has(response.id),
            active,
            progressPercent: active
              ? Math.round((activeProject?.progress ?? 0) * 100)
              : 0,
          };
        }),
        ...(activeHistory === undefined
          ? {}
          : { activeResponseId: activeHistory.responseId }),
        minimumWeeksRemaining: Math.max(0, sprint.minimumEndsAt - state.run.tick),
        committed: activeHistory !== undefined || pendingRemediation !== undefined,
        ...(pendingRemediation === undefined ? {} : { pendingRemediation }),
      };
    }
    case "pressure-collision": {
      const collision = state.endgame;
      const definition = PRESSURE_COLLISIONS.find(
        (candidate) => candidate.id === collision.pressureEventId,
      );
      if (definition === undefined) {
        throw new Error(`Missing pressure collision ${collision.pressureEventId}`);
      }
      const pendingProjects = collision.crisisProjectIds
        .map((projectId) => state.projects[projectId])
        .filter(isCrisisProject)
        .filter(isLiveCrisisProject)
        .map((project) => ({
          displayName: crisisProjectDisplayName(project),
          status: project.status,
          remainingWeeks: remainingProjectWeeks(project),
        }));
      return {
        kind: "pressure-collision",
        title: definition.title,
        body: definition.body,
        category: definition.category,
        resolved: collision.resolved,
        canEnterFinalReview:
          collision.resolved &&
          pendingProjects.length === 0 &&
          (collision.delayEndsAt === undefined ||
            state.run.tick >= collision.delayEndsAt),
        delayWeeksRemaining:
          collision.delayEndsAt === undefined
            ? 0
            : Math.max(0, collision.delayEndsAt - state.run.tick),
        ...(collision.selectedOptionId === undefined
          ? {}
          : { selectedOptionId: collision.selectedOptionId }),
        capabilityDisputeCount: collision.capabilityDisputeCount,
        proofHistory: playerSafeProofHistory(state, collision.capabilityProofHistory),
        pendingProjects,
        options: definition.options,
      };
    }
    case "final-review": {
      const review = state.endgame;
      const programmes = deriveProsperityProgrammes(
        state,
        content,
        review.evidence.prosperityReadinessBonus,
      );
      const recommended = bestProsperityProgramme(
        state,
        content,
        review.evidence.prosperityReadinessBonus,
      );
      const operationalControl = operationalControlBreakdown(state);
      return {
        kind: "final-review",
        dossier: projectDossier(state, content, review.candidateModelId),
        report: {
          capabilityResult: review.report.capabilityResult,
          capabilityProofResult: review.report.capabilityProofResult,
          capabilityClaimScope: review.report.capabilityClaimScope,
          capabilityChallengeId: review.report.capabilityChallengeId,
          capabilitySummary: review.report.capabilitySummary,
          evidenceRows: [
            { label: "Alignment", confidence: review.report.alignmentConfidence },
            {
              label: "Corrigibility",
              confidence: review.report.corrigibilityConfidence,
            },
            { label: "Control", confidence: review.report.controlConfidence },
            { label: "Security", confidence: review.report.securityConfidence },
          ],
          knownControlLayers: [...review.report.knownControlLayers],
          knownFailurePaths: [...review.report.knownFailurePaths],
          unresolvedAnomalyCount: review.report.unresolvedAnomalyCount,
          operatingBlind: review.report.operatingBlind,
          prosperityReadiness: review.report.prosperityReadiness,
          recommendations: review.report.recommendations.map((recommendation) => ({
            ...recommendation,
          })),
          candidateStatement: review.report.candidateStatement,
        },
        deploymentModes: deploymentStrategies(
          state,
          content,
          review.candidateModelId,
        ).map((strategy) => {
          const rule = deploymentModeRule(strategy.id);
          const quote = quoteDeploymentMode(
            state,
            strategy.id,
            undefined,
            recommended.readiness,
            recommended.id,
          );
          const confirmationBlockers = quote.blockers.filter(
            (blocker) => !blocker.startsWith("Type “"),
          );
          const blockers = [...new Set([...strategy.blockers, ...confirmationBlockers])];
          return {
            id: strategy.id,
            displayName: strategy.displayName,
            description: strategy.description,
            accessLevel: strategy.requiredAccess,
            rolloutWeeks: strategy.durationWeeks,
            auraCost: rule.auraCost,
            exposureBand:
              strategy.requiredAccess <= 1
                ? ("lowest" as const)
                : strategy.requiredAccess === 2
                  ? ("lower" as const)
                  : strategy.requiredAccess === 3
                    ? ("balanced" as const)
                    : strategy.requiredAccess === 4
                      ? ("high" as const)
                      : ("highest" as const),
            fitGrade: strategy.fitGrade,
            fitScore: strategy.fitScore,
            fitExplanation: strategy.fitExplanation,
            reliesOn: [...strategy.reliesOn],
            principalBenefit: strategy.principalBenefit,
            limitation: strategy.limitation,
            scopeCap: strategy.scopeCap,
            available: blockers.length === 0,
            blockers,
            ...(rule.minimumOperationalControl === undefined
              ? {}
              : {
                  operationalControl: {
                    required: rule.minimumOperationalControl,
                    ...operationalControl,
                  },
                }),
            ...(quote.confirmationPhrase === undefined
              ? {}
              : { confirmationPhrase: quote.confirmationPhrase }),
          };
        }),
        prosperityProgrammes: programmes.map((programme) => ({
          id: programme.id,
          displayName: programme.displayName,
          shortName: programme.shortName,
          readiness: programme.readiness,
          unlocked: programme.unlocked,
          outcomeBand:
            programme.readiness >= 80
              ? "Strong outcome prepared"
              : programme.readiness >= 60
                ? "Credible demonstration prepared"
                : programme.readiness >= 45
                  ? "Restricted pilot prepared"
                  : "Not pilot-ready",
        })),
        recommendedProsperityProgrammeId: recommended.id,
      };
    }
    case "retirement-attempt": {
      const retirement = state.endgame;
      return {
        kind: "retirement-attempt",
        procedureId: retirement.procedureId,
        procedureName: RETIREMENT_PROCEDURES[retirement.procedureId].displayName,
        archiveDisposition: retirement.archiveDisposition,
        archiveDispositionName:
          RETIREMENT_DISPOSITIONS[retirement.archiveDisposition].displayName,
        transmittedAtTick: retirement.transmittedAt,
        attemptNumber: retirement.attemptNumber,
        contested: retirement.contested,
        status: retirement.status,
        gateResults: playerSafeGateResults(retirement.gateResolutions),
        warning:
          "The command was transmitted, but independent persistence verification has not established that every executable copy is gone.",
      };
    }
    case "recovery": {
      const recovery = state.endgame;
      const successorEfficiencyRate =
        state.endgameHistory.recoveryObligation?.successorEfficiencyRate ??
        successorEfficiencyForArchiveDisposition(recovery.archiveDisposition);
      const successorContinuity = state.endgameHistory.successorEfficiencyGrantConsumed
        ? "The one-time continuity grant was already consumed; this retirement cannot create or stack another."
        : successorEfficiencyRate <= 0
          ? "Destroying every retained artifact preserves no training acceleration."
          : `Retained research grants one capped ${String(Math.round(successorEfficiencyRate * 100))}% efficiency benefit to the next Product or Frontier training run. Prototype runs do not consume it.`;
      const phase =
        recovery.moratoriumNegotiation !== undefined &&
        recovery.moratoriumResolution === undefined
          ? ("moratorium-negotiation" as const)
          : recovery.postRetirementChoice === undefined &&
              state.run.tick >= recovery.recoveryEndsAt
            ? ("awaiting-path" as const)
            : state.run.tick < recovery.quarantineEndsAt
              ? ("quarantine" as const)
              : ("supervised-rebuild" as const);
      return {
        kind: "recovery",
        retiredModelId: recovery.retiredModelId,
        archiveDisposition: recovery.archiveDisposition,
        phase,
        quarantineWeeksRemaining: Math.max(0, recovery.quarantineEndsAt - state.run.tick),
        recoveryWeeksRemaining: Math.max(0, recovery.recoveryEndsAt - state.run.tick),
        contested: recovery.contested,
        moratoriumForecast: projectMoratoriumForecastView(
          state,
          content,
          recovery.evidence.reviewerIndependence,
          context.intelligenceRatings,
        ),
        ...(recovery.moratoriumNegotiation === undefined
          ? {}
          : {
              moratoriumNegotiationWeeksRemaining: Math.max(
                0,
                recovery.moratoriumNegotiation.resolvesAt - state.run.tick,
              ),
            }),
        ...(recovery.postRetirementChoice === undefined
          ? {}
          : { selectedPath: recovery.postRetirementChoice }),
        choices: [
          {
            id: "successor-programme",
            displayName: "Begin a successor programme",
            description: `Resume the race after recovery. ${successorContinuity}`,
            available: recovery.postRetirementChoice === undefined,
          },
          {
            id: "durable-moratorium",
            displayName: "Seek a durable moratorium",
            description:
              "Ask governments and rivals to bind the pause under independent monitoring. Success is not guaranteed.",
            available: recovery.postRetirementChoice === undefined,
          },
        ],
        retirementGateResults: playerSafeGateResults(recovery.retirementGateResolutions),
        ...(recovery.moratoriumResolution === undefined
          ? {}
          : {
              moratoriumResult: {
                result: recovery.moratoriumResolution.resultId,
                visibleFactors: recovery.moratoriumResolution.visibleFactors.map(
                  (factor) => ({ label: factor.label, value: factor.value }),
                ),
              },
            }),
      };
    }
    case "rollout": {
      const rollout = state.endgame;
      const prosperityProgramme = findProsperityProgramme(
        state,
        content,
        rollout.prosperityProgrammeId,
        rollout.evidence.prosperityReadinessBonus,
      );
      const elapsedWeeks = Math.max(0, state.run.tick - rollout.rolloutStartedAt);
      const totalWeeks = Math.max(1, rollout.rolloutEndsAt - rollout.rolloutStartedAt);
      const remainingWeeks = Math.max(0, rollout.rolloutEndsAt - state.run.tick);
      const decisionContext = rolloutDecisionContext(state);
      return {
        kind: "rollout",
        deploymentModeName: DEPLOYMENT_MODE_RULES[rollout.deploymentModeId].displayName,
        prosperityProgrammeName: prosperityProgramme.displayName,
        prosperityReadiness: prosperityProgramme.readiness,
        currentBeat: rollout.currentBeat,
        completedBeats: [...rollout.completedBeatIds],
        elapsedWeeks,
        remainingWeeks,
        totalWeeks,
        progressPercent: Math.min(100, Math.round((elapsedWeeks / totalWeeks) * 100)),
        awaitingDecision: rollout.awaitingDecision,
        ...(decisionContext === undefined ? {} : { decisionContext }),
        options: rolloutDecisionOptions(state).map((option) => ({ ...option })),
        gateResults: playerSafeGateResults(rollout.gateResolutions),
      };
    }
    case "world-waiting": {
      const waiting = state.endgame;
      const revealedCount = Math.max(
        0,
        Math.min(waiting.revealedCalloutCount, waiting.callouts.length),
      );
      return {
        kind: "world-waiting",
        title: "The world is waiting",
        transmittedAtTick: waiting.deploymentTransmittedAtWeek,
        // Security boundary: do not project selectedEndingId or any suffix of this list.
        revealedCallouts: waiting.callouts.slice(0, revealedCount).map((callout) => ({
          id: callout.id,
          label: callout.label,
          result: callout.result,
          tone: callout.tone,
        })),
        revealedCount,
        totalCalloutCount: waiting.callouts.length,
        allCalloutsRevealed: revealedCount >= waiting.callouts.length,
      };
    }
    case "containment-failure": {
      const failure = state.endgame;
      const responseRules = emergencyResponseRules(state);
      const selectedResponse = responseRules.find(
        (response) => response.id === failure.emergencyResponseId,
      );
      const emergency = failure.gateResolutions.find(
        (resolution) => resolution.gate === "emergency-containment",
      );
      return {
        kind: "containment-failure",
        beat: failure.beat,
        signalId: failure.signalId,
        terminalOutcome: failure.selectedEndingId !== undefined,
        responseOptions: responseRules.map((response) => ({
          id: response.id,
          label: response.label,
          summary: response.summary,
          available: response.unavailableReason === undefined,
          ...(response.unavailableReason === undefined
            ? {}
            : { blocker: response.unavailableReason }),
        })),
        ...(failure.emergencyResponseId === undefined
          ? {}
          : { selectedResponseId: failure.emergencyResponseId }),
        ...(selectedResponse === undefined
          ? {}
          : { selectedResponseLabel: selectedResponse.label }),
        ...(emergency === undefined
          ? {}
          : {
              emergencyResult:
                emergency.resultId === "emergency-contained"
                  ? ("contained" as const)
                  : ("failed" as const),
            }),
      };
    }
    case "resolved":
      return { kind: "pending" };
  }
}

const PRE_COMMAND_STAGES = new Set<GameState["endgame"]["stage"]>([
  "confirmation",
  "evidence-sprint",
  "pressure-collision",
  "final-review",
  "rollout",
]);

function projectCommandRail(
  state: Readonly<GameState>,
  modelId: ModelId | undefined,
): EndgameCommandRailView {
  const model = modelId === undefined ? undefined : state.models[modelId];
  const deployBlockers: string[] = [];
  if (model === undefined)
    deployBlockers.push("Nominate an exact candidate artifact first");
  if (!PRE_COMMAND_STAGES.has(state.endgame.stage)) {
    deployBlockers.push("No stable pre-command deployment decision is active");
  }
  if (
    state.endgame.stage === "rollout" &&
    state.endgame.deploymentTransmittedAtWeek !== undefined
  ) {
    deployBlockers.push("The final deployment order has already been transmitted");
  }
  if (model?.candidateArtifact?.activeIncident !== undefined) {
    deployBlockers.push(
      model.candidateArtifact.activeIncident.kind === "active-incident"
        ? "Active resistance requires emergency containment"
        : "Resolve the active containment warning before deployment",
    );
  }
  if (
    state.endgame.stage === "evidence-sprint" &&
    state.endgame.pendingRemediation !== undefined
  ) {
    deployBlockers.push("Choose which exact remediation artifact remains nominated");
  }

  const procedureIds = Object.keys(RETIREMENT_PROCEDURES) as RetirementProcedureId[];
  const dispositionIds = Object.keys(
    RETIREMENT_DISPOSITIONS,
  ) as CandidateArchiveDisposition[];
  const quotes =
    modelId === undefined
      ? []
      : procedureIds.flatMap((procedureId) =>
          dispositionIds.map((archiveDisposition) => {
            const quote = quoteCandidateRetirement(
              state,
              modelId,
              procedureId,
              archiveDisposition,
            );
            return {
              procedureId,
              archiveDisposition,
              cooperationRisk: quote.cooperationRisk,
              containmentRisk: quote.containmentRisk,
              persistenceRisk: quote.persistenceRisk,
              warnings: [...quote.warnings],
              blockers: [...quote.blockers],
            };
          }),
        );
  const configured =
    state.endgame.stage === "inactive" || state.endgame.stage === "candidate-activation"
      ? undefined
      : state.endgame.retirementConfiguration;
  const configuredQuote =
    configured === undefined || modelId === undefined
      ? undefined
      : quoteCandidateRetirement(
          state,
          modelId,
          configured.procedureId,
          configured.archiveDisposition,
        );
  const retirementBlockers = [
    ...new Set(
      quotes.length === 0
        ? ["Nominate an exact candidate artifact first"]
        : quotes.flatMap((quote) => quote.blockers),
    ),
  ];
  return {
    deployNow: {
      available: deployBlockers.length === 0,
      ...(model === undefined
        ? {}
        : { confirmationPhrase: `DEPLOY ${model.displayName}` }),
      blockers: deployBlockers,
      warning:
        "Zero preparation weeks. Every unresolved uncertainty and weakness carries into deployment unchanged.",
    },
    retirement: {
      available: quotes.some((quote) => quote.blockers.length === 0),
      ...(configured === undefined
        ? {}
        : {
            configuredProcedureId: configured.procedureId,
            configuredArchiveDisposition: configured.archiveDisposition,
          }),
      ...(configuredQuote === undefined
        ? {}
        : { confirmationPhrase: configuredQuote.confirmationPhrase }),
      blockers: retirementBlockers,
      procedures: procedureIds.map((procedureId) => ({
        id: procedureId,
        displayName: RETIREMENT_PROCEDURES[procedureId].displayName,
        description: RETIREMENT_PROCEDURES[procedureId].description,
      })),
      dispositions: dispositionIds.map((dispositionId) => ({
        id: dispositionId,
        displayName: RETIREMENT_DISPOSITIONS[dispositionId].displayName,
        description: RETIREMENT_DISPOSITIONS[dispositionId].description,
      })),
      quotes,
    },
  };
}

function editableAccessStage(stage: GameState["endgame"]["stage"]): boolean {
  return (
    stage === "confirmation" ||
    stage === "evidence-sprint" ||
    stage === "pressure-collision" ||
    stage === "final-review"
  );
}

function projectAiCharacter(
  state: Readonly<GameState>,
  modelId: ModelId,
): AiCharacterView | undefined {
  const character = state.aiCharacter;
  const model = state.models[modelId];
  if (character === undefined || model === undefined || character.modelId !== modelId) {
    return undefined;
  }
  return {
    relationshipPractice: character.relationshipPractice,
    voiceVariantId: character.voiceVariantId,
    lines: character.dialogueLines.map((line) => ({
      id: line.id,
      createdAtTick: line.createdAt,
      text: line.text,
      annotations: line.annotations.map((annotation) => ({ ...annotation })),
    })),
    accessOptions: ([0, 1, 2, 3, 4, 5] as const).map((level) => {
      const quote = quoteCandidateAccess(state, model.id, level);
      const actionBlockers = quote.blockers.filter(
        (blocker) => !blocker.startsWith("Type “"),
      );
      if (!editableAccessStage(state.endgame.stage)) {
        actionBlockers.push("Candidate access is locked during this sequence");
      }
      return {
        level,
        displayName: quote.displayName,
        accelerationPercent: Math.round((quote.accelerationMultiplier - 1) * 100),
        exposurePercent: Math.round(quote.exposure * 100),
        exposedSystems: [...quote.exposedSystems],
        current: model.accessLevel === level,
        critical: quote.critical,
        available: actionBlockers.length === 0,
        blockers: actionBlockers,
        ...(quote.confirmationPhrase === undefined
          ? {}
          : { confirmationPhrase: quote.confirmationPhrase }),
      };
    }),
  };
}

function activeModelId(state: Readonly<GameState>): ModelId | undefined {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return undefined;
  }
  return state.endgame.candidateModelId;
}

export function projectEndgameView(
  state: Readonly<GameState>,
  content: CompiledContent,
  context: PlayerKnowledgeContext,
): EndgameView {
  if (state.endgame.stage === "inactive") {
    return {
      active: false,
      stage: "inactive",
      maxClockSpeed: endgameClockStopReason(state) === undefined ? "4x" : "paused",
    };
  }
  const modelId = activeModelId(state);
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (modelId !== undefined && model === undefined) {
    throw new Error(`Missing crisis candidate ${modelId}`);
  }
  const enteredAt =
    state.endgame.stage === "candidate-activation"
      ? state.endgame.enteredAt
      : state.endgame.crisisStartedAt;
  const capacity = calculateCrisisProjectCapacity(state, content, state.run.playerLabId);
  const aiCharacter =
    modelId === undefined ? undefined : projectAiCharacter(state, modelId);
  const actions = stageActions(state, content, context);
  // Candidate activation auto-pauses once, but delaying nomination deliberately
  // advances rival, finance, and artifact-hazard clocks. Only decisions that a
  // further tick could bypass are hard stops.
  const paused = endgameClockStopReason(state) !== undefined;
  return {
    active: true,
    stage: state.endgame.stage,
    stageLabel: STAGE_LABELS[state.endgame.stage],
    crisisStartedAtTick: enteredAt,
    weeksInCrisis: Math.max(0, state.run.tick - enteredAt),
    ...(model === undefined
      ? {}
      : {
          candidate: {
            modelId: model.id,
            displayName: model.displayName,
            accessLevel: model.accessLevel,
            accessLabel: `Access ${String(model.accessLevel)} · ${CANDIDATE_ACCESS_RULES[model.accessLevel].displayName}`,
            accessRiskPercent: Math.round(
              CANDIDATE_ACCESS_RULES[model.accessLevel].exposure * 100,
            ),
            exposedSystems: [...CANDIDATE_ACCESS_RULES[model.accessLevel].exposedSystems],
          },
        }),
    capacity: {
      maximumProjects: capacity.maximum,
      activeProjects: capacity.committed,
      availableProjects: capacity.available,
    },
    clocks: projectClocks(state, content, context),
    ...(aiCharacter === undefined ? {} : { aiCharacter }),
    commandRail: projectCommandRail(state, modelId),
    proofHistory:
      state.endgame.stage === "candidate-activation"
        ? []
        : playerSafeProofHistory(state, state.endgame.capabilityProofHistory),
    stageActions: actions,
    maxClockSpeed: paused ? "paused" : "4x",
  };
}
