import type { CompiledContent } from "@neolab/content-schema";

import {
  evaluateCoalitionEligibility,
  quoteCoalitionProject,
} from "../coalition/coalition.ts";
import type {
  CoalitionAssetKind,
  RivalDeploymentCrisisStage,
  RivalDiplomacyAction,
} from "../model/state.ts";
import type { GameState } from "../model/state.ts";
import type { LabId } from "../model/ids.ts";
import {
  projectRivalCandidateCountdowns,
  projectRivalPublicSignals,
  rivalDeploymentCrisisStageLabel,
} from "../rivals/index.ts";
import { AGI_COMPONENT_RULES } from "../endgame/candidate-programme.ts";
import { agiComponentProgress } from "../rivals/candidate-programme-race.ts";
import {
  projectRivalRelationships,
  quoteRivalDiplomacy,
  type RivalRelationshipBand,
} from "../rivals/diplomacy.ts";
import type { PlayerKnowledgeContext } from "./game-view.ts";
import { reportedRivalValuation } from "../finance/valuation.ts";
import { RandomOracleV1 } from "../random/oracle.ts";

const DIPLOMACY_ACTIONS: readonly RivalDiplomacyAction[] = [
  "research-collaboration",
  "safety-standards",
  "non-poaching-agreement",
  "share-incident-information",
];

const ASSET_KINDS: readonly CoalitionAssetKind[] = [
  "capability",
  "safety",
  "compute",
  "prosperity",
];

export interface RivalWorldView {
  readonly labId: string;
  readonly labName: string;
  readonly leaderId: string;
  readonly leaderName: string;
  readonly aiName: string;
  readonly relationship: {
    readonly trust: RivalRelationshipBand;
    readonly strategicFear: RivalRelationshipBand;
    readonly dependence: RivalRelationshipBand;
    readonly perceivedHonesty: RivalRelationshipBand;
  };
  readonly activeAgreements: readonly {
    readonly action: RivalDiplomacyAction;
    readonly expiresAtTick: number;
    readonly weeksRemaining: number;
  }[];
  readonly lastDiplomacyOutcome?: {
    readonly action: RivalDiplomacyAction;
    readonly accepted: boolean;
    readonly initiatedAtTick: number;
  };
  readonly reportedValuation: {
    readonly label: string;
    readonly lowMillions: number;
    readonly highMillions: number;
  };
  readonly latestCapabilitySignal?: {
    readonly kind: string;
    readonly summary: string;
    readonly estimateRange: readonly [number, number];
    readonly confidence: "low" | "medium" | "high";
    readonly occurredAtTick: number;
  };
  readonly latestAutonomySignal?: {
    readonly summary: string;
    readonly levelRange: readonly [number, number];
    readonly confidence: "low" | "medium" | "high";
    readonly occurredAtTick: number;
  };
  readonly candidateWorks: {
    readonly building: number;
    readonly completed: number;
  };
  readonly candidateCountdown?: {
    readonly modelName: string;
    readonly estimateRangeWeeks: readonly [number, number];
    readonly estimateLabel: string;
    readonly confidence: "low" | "medium" | "high";
    readonly urgency: "monitoring" | "urgent" | "imminent";
    readonly finalDeploymentWarningActive: boolean;
    readonly stage: RivalDeploymentCrisisStage;
    readonly stageLabel: string;
  };
  readonly diplomacyOptions: readonly {
    readonly action: RivalDiplomacyAction;
    readonly displayName: string;
    readonly cashCostMillions: number;
    readonly auraCost: number;
    readonly durationWeeks: number;
    readonly chanceLabel: "unlikely" | "uncertain" | "promising";
    readonly estimatedAcceptanceRange: readonly [number, number];
    readonly benefits: readonly string[];
    readonly strategicUse: string;
    readonly limitation: string;
    readonly available: boolean;
    readonly blockers: readonly string[];
  }[];
}

export interface CoalitionBoardView {
  readonly coalitionId: string;
  readonly status: "proposed" | "negotiating" | "ratifying" | "active" | "fractured";
  readonly memberLabIds: readonly string[];
  readonly memberNames: readonly string[];
  readonly governmentMember: boolean;
  readonly independentBodyMember: boolean;
  readonly charterClarity: number;
  readonly sharedProtocolQuality: number;
  readonly verification: number;
  readonly formationAuraSpent: number;
  readonly createdAtTick: number;
  readonly activeWeeks: number;
  readonly assets: readonly {
    readonly contributorLabId: string;
    readonly contributorName: string;
    readonly kind: CoalitionAssetKind;
    readonly uniqueToPlayer: boolean;
  }[];
  readonly checks: readonly {
    readonly id: string;
    readonly satisfied: boolean;
    readonly detail: string;
  }[];
  readonly eligible: boolean;
  readonly projectOptions: readonly {
    readonly projectType:
      "charter-drafting" | "shared-evaluation-protocol" | "verification-mechanism";
    readonly displayName: string;
    readonly durationWeeks: number;
    readonly cashCostMillions: number;
    readonly auraCost: number;
    readonly available: boolean;
    readonly blockers: readonly string[];
  }[];
  readonly assetOptions: readonly {
    readonly contributorLabId: string;
    readonly contributorName: string;
    readonly assetKind: CoalitionAssetKind;
    readonly uniqueToPlayer: boolean;
    readonly durationWeeks: number;
    readonly cashCostMillions: number;
    readonly auraCost: number;
    readonly available: boolean;
    readonly blockers: readonly string[];
  }[];
}

export interface RivalComponentAnnouncementView {
  readonly labId: string;
  readonly labName: string;
  readonly componentType: string;
  readonly componentName: string;
  readonly kind: "started" | "completed";
  readonly tick: number;
}

export interface RivalCrisisStageAnnouncementView {
  readonly labId: string;
  readonly labName: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly stage: RivalDeploymentCrisisStage;
  readonly stageLabel: string;
  readonly previousStage?: RivalDeploymentCrisisStage;
  readonly previousStageLabel?: string;
  readonly kind: "entered" | "advanced" | "completed";
  readonly tick: number;
}

export interface WorldView {
  readonly rivals: readonly RivalWorldView[];
  readonly componentAnnouncements: readonly RivalComponentAnnouncementView[];
  readonly crisisStageAnnouncements: readonly RivalCrisisStageAnnouncementView[];
  readonly proposalCandidates: readonly {
    readonly labId: string;
    readonly labName: string;
    readonly aiName: string;
  }[];
  readonly coalition?: CoalitionBoardView;
}

function fallbackName(id: string): string {
  const tail = id.split(":").at(-1) ?? id;
  return tail
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function labName(
  state: Readonly<GameState>,
  content: CompiledContent,
  labId: LabId,
): string {
  const lab = state.labs[labId];
  return lab === undefined
    ? fallbackName(labId)
    : (content.labs[lab.definitionId]?.displayName ?? fallbackName(labId));
}

export function projectWorldView(
  state: Readonly<GameState>,
  content: CompiledContent,
  context: PlayerKnowledgeContext,
): WorldView {
  const relationships = new Map(
    projectRivalRelationships(state).map((relationship) => [
      relationship.labId,
      relationship,
    ]),
  );
  const signals = projectRivalPublicSignals(state, context.intelligenceRatings);
  // Selectors are pure: a seed-derived oracle keeps reported marks stable
  // for a given run and quarter without mutating state.
  const valuationOracle = new RandomOracleV1(state.run.seed);
  const countdowns = new Map(
    projectRivalCandidateCountdowns(state, context.intelligenceRatings).map(
      (countdown) => [countdown.labId, countdown],
    ),
  );
  const rivals = (Object.keys(state.world.rivals).sort() as LabId[]).map(
    (labId): RivalWorldView => {
      const lab = state.labs[labId];
      const definition = lab === undefined ? undefined : content.labs[lab.definitionId];
      const leader =
        definition === undefined ? undefined : content.leaders[definition.leaderId];
      const relationship = relationships.get(labId);
      if (lab === undefined || definition === undefined || relationship === undefined) {
        throw new Error(`Cannot project unknown rival ${labId}`);
      }
      const countdown = countdowns.get(labId);
      const capabilitySignals = signals
        .filter(
          (signal) =>
            signal.labId === labId &&
            (signal.kind === "benchmark" || signal.kind === "candidate"),
        )
        .sort(
          (left, right) =>
            right.occurredAt - left.occurredAt ||
            (right.id < left.id ? -1 : right.id > left.id ? 1 : 0),
        );
      // Once a Deployment Crisis is live, its candidate report is the most
      // relevant capability evidence even if a later, noisier benchmark exists.
      const latestCapabilitySignal =
        (countdown === undefined
          ? undefined
          : capabilitySignals.find(
              (signal) =>
                signal.kind === "candidate" && signal.subjectId === countdown.modelId,
            )) ?? capabilitySignals[0];
      const latestAutonomySignal = signals
        .filter((signal) => signal.labId === labId && signal.kind === "autonomy")
        .sort(
          (left, right) =>
            right.occurredAt - left.occurredAt ||
            (right.id < left.id ? -1 : right.id > left.id ? 1 : 0),
        )[0];
      const reportedValuation = reportedRivalValuation(
        state,
        content,
        labId,
        context.intelligenceRatings[labId] ?? 0,
        valuationOracle,
      );
      return {
        labId,
        reportedValuation,
        candidateWorks: agiComponentProgress(state, labId),
        labName: definition.displayName,
        leaderId: definition.leaderId,
        leaderName: leader?.displayName ?? fallbackName(definition.leaderId),
        aiName: definition.aiFamily,
        relationship: {
          trust: relationship.trust,
          strategicFear: relationship.strategicFear,
          dependence: relationship.dependence,
          perceivedHonesty: relationship.perceivedHonesty,
        },
        activeAgreements: relationship.activeAgreements.map((agreement) => ({
          action: agreement.action,
          expiresAtTick: agreement.expiresAt,
          weeksRemaining: Math.max(0, agreement.expiresAt - state.run.tick),
        })),
        ...(relationship.lastOutcome === undefined
          ? {}
          : {
              lastDiplomacyOutcome: {
                action: relationship.lastOutcome.action,
                accepted: relationship.lastOutcome.accepted,
                initiatedAtTick: relationship.lastOutcome.initiatedAt,
              },
            }),
        ...(latestCapabilitySignal === undefined
          ? {}
          : {
              latestCapabilitySignal: {
                kind: latestCapabilitySignal.kind,
                summary: latestCapabilitySignal.summary,
                estimateRange: latestCapabilitySignal.estimateRange,
                confidence: latestCapabilitySignal.confidence,
                occurredAtTick: latestCapabilitySignal.occurredAt,
              },
            }),
        ...(latestAutonomySignal === undefined
          ? {}
          : {
              latestAutonomySignal: {
                summary: latestAutonomySignal.summary,
                levelRange: [
                  Math.max(0, Math.min(5, latestAutonomySignal.estimateRange[0])),
                  Math.max(0, Math.min(5, latestAutonomySignal.estimateRange[1])),
                ],
                confidence: latestAutonomySignal.confidence,
                occurredAtTick: latestAutonomySignal.occurredAt,
              },
            }),
        ...(countdown === undefined
          ? {}
          : {
              candidateCountdown: {
                modelName: countdown.modelName,
                estimateRangeWeeks: countdown.estimateRangeWeeks,
                estimateLabel: countdown.estimateLabel,
                confidence: countdown.confidence,
                urgency: countdown.urgency,
                finalDeploymentWarningActive: countdown.finalDeploymentWarningActive,
                stage: countdown.stage,
                stageLabel: countdown.stageLabel,
              },
            }),
        diplomacyOptions: DIPLOMACY_ACTIONS.map((action) => {
          const quote = quoteRivalDiplomacy(state, context.viewerLabId, lab.id, action);
          return {
            action,
            displayName: quote.displayName,
            cashCostMillions: quote.cashCostMillions,
            auraCost: quote.auraCost,
            durationWeeks: quote.durationWeeks,
            chanceLabel: quote.chanceLabel,
            estimatedAcceptanceRange: quote.estimatedAcceptanceRange,
            benefits: [...quote.benefits],
            strategicUse: quote.strategicUse,
            limitation: quote.limitation,
            available: quote.blockers.length === 0,
            blockers: [...quote.blockers],
          };
        }),
      };
    },
  );
  const liveCoalition = Object.values(state.world.coalitions).find(
    (coalition) => coalition.status !== "fractured",
  );
  const coalition = (() => {
    if (liveCoalition === undefined) return undefined;
    const eligibility = evaluateCoalitionEligibility(state, liveCoalition.id);
    const standardProjectTypes = [
      "charter-drafting",
      "shared-evaluation-protocol",
      "verification-mechanism",
    ] as const;
    return {
      coalitionId: liveCoalition.id,
      status: liveCoalition.status,
      memberLabIds: [...liveCoalition.memberLabIds],
      memberNames: liveCoalition.memberLabIds.map((memberId) =>
        labName(state, content, memberId),
      ),
      governmentMember: liveCoalition.governmentMember,
      independentBodyMember: liveCoalition.independentBodyMember,
      charterClarity: liveCoalition.charterClarity,
      sharedProtocolQuality: liveCoalition.sharedProtocolQuality,
      verification: liveCoalition.verification,
      formationAuraSpent: liveCoalition.formationAuraSpent,
      createdAtTick: liveCoalition.createdAt,
      activeWeeks: state.run.tick - liveCoalition.createdAt,
      assets: liveCoalition.assets.map((asset) => ({
        contributorLabId: asset.contributorLabId,
        contributorName: labName(state, content, asset.contributorLabId),
        kind: asset.kind,
        uniqueToPlayer: asset.uniqueToPlayer,
      })),
      checks: eligibility.checks.map((check) => ({ ...check })),
      eligible: eligibility.eligible,
      projectOptions: standardProjectTypes.map((projectType) => {
        const quote = quoteCoalitionProject(
          state,
          content,
          context.viewerLabId,
          liveCoalition.id,
          projectType,
        );
        return {
          projectType,
          displayName: quote.displayName,
          durationWeeks: quote.durationWeeks,
          cashCostMillions: quote.cashCostMillions,
          auraCost: quote.auraCost,
          available: quote.blockers.length === 0,
          blockers: [...quote.blockers],
        };
      }),
      assetOptions: liveCoalition.memberLabIds
        .filter((memberId) => memberId !== context.viewerLabId)
        .flatMap((contributorLabId) =>
          ASSET_KINDS.map((assetKind) => {
            const quote = quoteCoalitionProject(
              state,
              content,
              context.viewerLabId,
              liveCoalition.id,
              "asset-contribution",
              contributorLabId,
              assetKind,
            );
            return {
              contributorLabId,
              contributorName: labName(state, content, contributorLabId),
              assetKind,
              uniqueToPlayer: quote.assetUniqueToPlayer ?? false,
              durationWeeks: quote.durationWeeks,
              cashCostMillions: quote.cashCostMillions,
              auraCost: quote.auraCost,
              available: quote.blockers.length === 0,
              blockers: [...quote.blockers],
            };
          }),
        ),
    } satisfies CoalitionBoardView;
  })();
  const componentAnnouncements = state.world.rivalComponentAnnouncements.map(
    (announcement): RivalComponentAnnouncementView => ({
      labId: announcement.labId,
      labName: labName(state, content, announcement.labId),
      componentType: announcement.componentType,
      componentName: AGI_COMPONENT_RULES[announcement.componentType].displayName,
      kind: announcement.kind,
      tick: announcement.tick,
    }),
  );
  const crisisStageAnnouncements = state.world.rivalCrisisStageAnnouncements.map(
    (announcement): RivalCrisisStageAnnouncementView => ({
      labId: announcement.labId,
      labName: labName(state, content, announcement.labId),
      modelId: announcement.modelId,
      modelName:
        state.models[announcement.modelId]?.displayName ??
        fallbackName(announcement.modelId),
      stage: announcement.stage,
      stageLabel: rivalDeploymentCrisisStageLabel(announcement.stage),
      ...(announcement.previousStage === undefined
        ? {}
        : {
            previousStage: announcement.previousStage,
            previousStageLabel: rivalDeploymentCrisisStageLabel(
              announcement.previousStage,
            ),
          }),
      kind: announcement.kind,
      tick: announcement.tick,
    }),
  );
  return {
    rivals,
    componentAnnouncements,
    crisisStageAnnouncements,
    proposalCandidates: rivals.map((rival) => ({
      labId: rival.labId,
      labName: rival.labName,
      aiName: rival.aiName,
    })),
    ...(coalition === undefined ? {} : { coalition }),
  };
}
