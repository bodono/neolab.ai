import { contentId, type CompiledContent } from "@neolab/content-schema";

import { applyEffects } from "../engine/effect-executor.ts";
import { awardScore } from "../engine/score.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { CoalitionId, LabId, ProjectId } from "../model/ids.ts";
import type {
  CoalitionAssetKind,
  CoalitionProjectType,
  CoalitionState,
  GameState,
  ProjectState,
} from "../model/state.ts";
import { cashMillions, rating } from "../model/units.ts";
import type { ProjectHandler } from "../projects/project-handler.ts";

/**
 * TODO(coalition-redesign): the coalition mechanic is disabled, not deleted.
 *
 * Why it is off: the current design is hard to understand and thin in play.
 * Forming a coalition means clearing nine opaque eligibility checks, then
 * running three near-identical projects (charter / protocol / verification)
 * that mostly move numbers the player never sees, with betrayal and
 * ratification arriving as consequences rather than choices. It reads as
 * paperwork, not diplomacy.
 *
 * What a redesign should deliver before this flips back to true:
 *  - a legible fantasy: who is in the room, what each party wants, and what
 *    the player gives up to get it;
 *  - real decisions with visible stakes rather than a checklist to satisfy;
 *  - a reason to defect and a reason to stay honest, both interesting;
 *  - a coalition ending that is earned by play, not by paperwork completion.
 *
 * The machinery below stays intact and tested so a redesign can reuse or
 * replace it deliberately. Disabling happens at the entry points only:
 * the three coalition commands are rejected, the tick step is skipped, and
 * the UI affordance is hidden. Search `coalition-redesign` for every seam.
 */
export const COALITION_MECHANIC_ENABLED = false;

/** Player-facing reason used wherever a coalition action is refused. */
export const COALITION_DISABLED_REASON =
  "Coalitions are disabled in this build while the mechanic is redesigned.";

interface CoalitionProjectRule {
  readonly displayName: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly charterGain: number;
  readonly protocolGain: number;
  readonly verificationGain: number;
}

export const COALITION_PROJECT_RULES: Readonly<
  Record<CoalitionProjectType, CoalitionProjectRule>
> = {
  "charter-drafting": {
    displayName: "Coalition charter drafting",
    durationWeeks: 6,
    cashCostMillions: 2,
    auraCost: 3,
    charterGain: 30,
    protocolGain: 0,
    verificationGain: 0,
  },
  "shared-evaluation-protocol": {
    displayName: "Shared evaluation protocol",
    durationWeeks: 8,
    cashCostMillions: 3,
    auraCost: 4,
    charterGain: 0,
    protocolGain: 30,
    verificationGain: 0,
  },
  "verification-mechanism": {
    displayName: "Independent verification mechanism",
    durationWeeks: 10,
    cashCostMillions: 4,
    auraCost: 4,
    charterGain: 0,
    protocolGain: 0,
    verificationGain: 30,
  },
  "asset-contribution": {
    displayName: "Signatory asset contribution",
    durationWeeks: 4,
    cashCostMillions: 2,
    auraCost: 3,
    charterGain: 0,
    protocolGain: 0,
    verificationGain: 0,
  },
};

export interface CoalitionProposalQuote {
  readonly rivalLabIds: readonly LabId[];
  readonly governmentMember: boolean;
  readonly independentBodyMember: boolean;
  readonly blockers: readonly string[];
}

export interface CoalitionProjectQuote {
  readonly coalitionId: CoalitionId;
  readonly projectType: CoalitionProjectType;
  readonly displayName: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
  readonly contributorLabId?: LabId;
  readonly assetKind?: CoalitionAssetKind;
  readonly assetUniqueToPlayer?: boolean;
  readonly blockers: readonly string[];
}

export interface CoalitionEligibilityCheck {
  readonly id:
    | "member-composition"
    | "charter-clarity"
    | "shared-protocol"
    | "verification"
    | "relationships"
    | "betrayals"
    | "formation-aura"
    | "unique-asset"
    | "formation-period";
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface CoalitionEligibility {
  readonly coalitionId: CoalitionId;
  readonly eligible: boolean;
  readonly checks: readonly CoalitionEligibilityCheck[];
}

function requireCoalition(
  state: Readonly<GameState>,
  coalitionId: CoalitionId,
): CoalitionState {
  const coalition = state.world.coalitions[coalitionId];
  if (coalition === undefined) throw new Error(`Unknown coalition ${coalitionId}`);
  return coalition;
}

function rivalMemberIds(state: Readonly<GameState>, coalition: CoalitionState): LabId[] {
  return coalition.memberLabIds.filter(
    (labId) => state.world.rivals[labId] !== undefined,
  );
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateCoalitionAssetUniqueness(
  state: Readonly<GameState>,
  playerLabId: LabId,
  contributorLabId: LabId,
  assetKind: CoalitionAssetKind,
): boolean {
  const player = state.labs[playerLabId];
  const contributor = state.labs[contributorLabId];
  if (player === undefined || contributor === undefined) return false;
  switch (assetKind) {
    case "capability":
      return (
        contributor.research.discoveredPaperIds.some(
          (paperId) => !player.research.discoveredPaperIds.includes(paperId),
        ) ||
        Object.entries(contributor.research.domains).some(
          ([domainId, domain]) =>
            domain.level >= (player.research.domains[domainId]?.level ?? 0) + 5,
        )
      );
    case "safety":
      return (
        average([
          contributor.safety.alignmentScience,
          contributor.safety.evalQuality,
          contributor.safety.controlTheory,
          contributor.safety.practicalControlStrength,
        ]) >=
        average([
          player.safety.alignmentScience,
          player.safety.evalQuality,
          player.safety.controlTheory,
          player.safety.practicalControlStrength,
        ]) +
          5
      );
    case "compute": {
      const total = (labId: LabId) =>
        state.labs[labId]?.compute.lots.reduce(
          (sum, lot) => sum + lot.physicalCount * lot.availableFraction,
          0,
        ) ?? 0;
      return total(contributorLabId) >= total(playerLabId) * 1.1;
    }
    case "prosperity":
      return Object.entries(contributor.flags).some(
        ([flag, value]) =>
          flag.startsWith("prosperity:") && value === true && player.flags[flag] !== true,
      );
  }
}

export function quoteCoalitionProposal(
  state: Readonly<GameState>,
  playerLabId: LabId,
  rivalLabIds: readonly LabId[],
  governmentMember: boolean,
  independentBodyMember: boolean,
): CoalitionProposalQuote {
  const blockers: string[] = [];
  const player = state.labs[playerLabId];
  if (player === undefined || player.control !== "player") {
    throw new Error(`Coalition proposal requires player lab ${playerLabId}`);
  }
  const uniqueRivals = [...new Set(rivalLabIds)].sort();
  if (uniqueRivals.length !== rivalLabIds.length) blockers.push("Duplicate rival member");
  if (uniqueRivals.length < 1) blockers.push("Invite at least one rival lab");
  if (uniqueRivals.length > 4)
    blockers.push("A coalition cannot invite more than four rivals");
  for (const labId of uniqueRivals) {
    if (state.world.rivals[labId] === undefined) {
      blockers.push(`Unknown rival member ${labId}`);
    }
  }
  if (
    Object.values(state.world.coalitions).some(
      (coalition) => coalition.status !== "fractured",
    )
  ) {
    blockers.push("The player already has a live coalition process");
  }
  return {
    rivalLabIds: uniqueRivals,
    governmentMember,
    independentBodyMember,
    blockers,
  };
}

export function proposeCoalition(
  tx: SimulationTransaction,
  playerLabId: LabId,
  rivalLabIds: readonly LabId[],
  governmentMember: boolean,
  independentBodyMember: boolean,
): CoalitionId {
  const quote = quoteCoalitionProposal(
    tx.read(),
    playerLabId,
    rivalLabIds,
    governmentMember,
    independentBodyMember,
  );
  if (quote.blockers.length > 0) {
    throw new Error(`Coalition proposal blocked: ${quote.blockers.join("; ")}`);
  }
  const coalitionId = tx.allocateId("coalition", playerLabId) as CoalitionId;
  tx.update((draft) => {
    draft.world.coalitions[coalitionId] = {
      id: coalitionId,
      status: "proposed",
      proposerLabId: playerLabId,
      memberLabIds: [playerLabId, ...quote.rivalLabIds],
      governmentMember,
      independentBodyMember,
      charterClarity: rating(0),
      sharedProtocolQuality: rating(0),
      verification: rating(0),
      formationAuraSpent: 0,
      assets: [],
      betrayals: [],
      projectIds: [],
      createdAt: draft.run.tick,
    };
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Coalition proposed with ${String(quote.rivalLabIds.length)} rival signatory or signatories.`,
      category: "narrative",
      source: { kind: "system", id: coalitionId },
      relatedIds: [coalitionId, ...quote.rivalLabIds],
    });
  });
  tx.emit({
    kind: "coalition-proposed",
    coalitionId,
    memberLabIds: [playerLabId, ...quote.rivalLabIds],
  });
  return coalitionId;
}

export function evaluateCoalitionEligibility(
  state: Readonly<GameState>,
  coalitionId: CoalitionId,
): CoalitionEligibility {
  const coalition = requireCoalition(state, coalitionId);
  const rivalIds = rivalMemberIds(state, coalition);
  const compositionSatisfied =
    rivalIds.length >= 2 ||
    (rivalIds.length >= 1 &&
      coalition.governmentMember &&
      coalition.independentBodyMember);
  const relationshipValues = rivalIds.map(
    (labId) => state.world.rivals[labId]?.relationship.trust ?? -100,
  );
  const unresolvedBetrayals = coalition.betrayals.filter(
    (betrayal) => betrayal.resolvedAt === undefined,
  );
  const uniqueAssets = coalition.assets.filter(
    (asset) => asset.uniqueToPlayer && rivalIds.includes(asset.contributorLabId),
  );
  const age = state.run.tick - coalition.createdAt;
  const checks: readonly CoalitionEligibilityCheck[] = [
    {
      id: "member-composition",
      satisfied: compositionSatisfied,
      detail: `${String(rivalIds.length)} rival signatory/signatories; government ${coalition.governmentMember ? "included" : "absent"}; independent body ${coalition.independentBodyMember ? "included" : "absent"}`,
    },
    {
      id: "charter-clarity",
      satisfied: coalition.charterClarity >= 60,
      detail: `${String(coalition.charterClarity)}/100 (60 required)`,
    },
    {
      id: "shared-protocol",
      satisfied: coalition.sharedProtocolQuality >= 60,
      detail: `${String(coalition.sharedProtocolQuality)}/100 (60 required)`,
    },
    {
      id: "verification",
      satisfied: coalition.verification >= 60,
      detail: `${String(coalition.verification)}/100 (60 required)`,
    },
    {
      id: "relationships",
      satisfied: relationshipValues.every((value) => value >= 30),
      detail:
        relationshipValues.length === 0
          ? "No rival signatory"
          : `lowest Trust ${String(Math.min(...relationshipValues))} (30 required)`,
    },
    {
      id: "betrayals",
      satisfied: unresolvedBetrayals.length === 0,
      detail: `${String(unresolvedBetrayals.length)} unresolved major betrayal(s)`,
    },
    {
      id: "formation-aura",
      satisfied: coalition.formationAuraSpent >= 20,
      detail: `${String(coalition.formationAuraSpent)} Aura spent (20 required)`,
    },
    {
      id: "unique-asset",
      satisfied: uniqueAssets.length >= 1,
      detail: `${String(uniqueAssets.length)} unique signatory asset(s)`,
    },
    {
      id: "formation-period",
      satisfied: age >= 26,
      detail: `${String(age)}/26 weeks elapsed`,
    },
  ];
  return {
    coalitionId,
    eligible: checks.every((check) => check.satisfied),
    checks,
  };
}

function foundationalChecksSatisfied(eligibility: CoalitionEligibility): boolean {
  return eligibility.checks
    .filter((check) => check.id !== "formation-period")
    .every((check) => check.satisfied);
}

export function refreshCoalitionPhases(tx: SimulationTransaction): void {
  for (const coalitionId of Object.keys(
    tx.read().world.coalitions,
  ).sort() as CoalitionId[]) {
    const coalition = tx.read().world.coalitions[coalitionId];
    if (
      coalition === undefined ||
      coalition.status === "active" ||
      coalition.status === "fractured"
    ) {
      continue;
    }
    const eligibility = evaluateCoalitionEligibility(tx.read(), coalitionId);
    if (foundationalChecksSatisfied(eligibility) && coalition.status !== "ratifying") {
      tx.update((draft) => {
        const live = draft.world.coalitions[coalitionId];
        if (live !== undefined) live.status = "ratifying";
      });
      tx.emit({ kind: "coalition-ratification-ready", coalitionId });
    }
  }
}

export function quoteCoalitionProject(
  state: Readonly<GameState>,
  content: CompiledContent,
  playerLabId: LabId,
  coalitionId: CoalitionId,
  projectType: CoalitionProjectType,
  contributorLabId?: LabId,
  assetKind?: CoalitionAssetKind,
): CoalitionProjectQuote {
  const coalition = requireCoalition(state, coalitionId);
  const rule = COALITION_PROJECT_RULES[projectType];
  const player = state.labs[playerLabId];
  if (player === undefined || player.control !== "player") {
    throw new Error(`Coalition projects require player lab ${playerLabId}`);
  }
  const blockers: string[] = [];
  if (coalition.proposerLabId !== playerLabId)
    blockers.push("Player does not own this process");
  if (coalition.status === "active" || coalition.status === "fractured") {
    blockers.push(`Coalition projects cannot start while ${coalition.status}`);
  }
  if (player.finance.cash < rule.cashCostMillions) blockers.push("Insufficient cash");
  if (player.aura.spendable < rule.auraCost) blockers.push("Insufficient Aura");
  let assetUniqueToPlayer: boolean | undefined;
  if (projectType === "asset-contribution") {
    if (
      contributorLabId === undefined ||
      contributorLabId === playerLabId ||
      !coalition.memberLabIds.includes(contributorLabId)
    ) {
      blockers.push("Choose a rival signatory as the asset contributor");
    }
    if (assetKind === undefined) blockers.push("Choose a contributed asset type");
    if (contributorLabId !== undefined && assetKind !== undefined) {
      assetUniqueToPlayer = calculateCoalitionAssetUniqueness(
        state,
        playerLabId,
        contributorLabId,
        assetKind,
      );
    }
  } else if (contributorLabId !== undefined || assetKind !== undefined) {
    blockers.push("Only an asset-contribution project accepts asset fields");
  }
  return {
    coalitionId,
    projectType,
    displayName: rule.displayName,
    durationWeeks: rule.durationWeeks,
    cashCostMillions: rule.cashCostMillions,
    auraCost: rule.auraCost,
    ...(contributorLabId === undefined ? {} : { contributorLabId }),
    ...(assetKind === undefined ? {} : { assetKind }),
    ...(assetUniqueToPlayer === undefined ? {} : { assetUniqueToPlayer }),
    blockers,
  };
}

export function startCoalitionProject(
  tx: SimulationTransaction,
  content: CompiledContent,
  playerLabId: LabId,
  coalitionId: CoalitionId,
  projectType: CoalitionProjectType,
  contributorLabId?: LabId,
  assetKind?: CoalitionAssetKind,
): CoalitionProjectQuote {
  const quote = quoteCoalitionProject(
    tx.read(),
    content,
    playerLabId,
    coalitionId,
    projectType,
    contributorLabId,
    assetKind,
  );
  if (quote.blockers.length > 0) {
    throw new Error(`Coalition project blocked: ${quote.blockers.join("; ")}`);
  }
  applyEffects(
    tx,
    [
      {
        kind: "add-resource",
        subject: { type: "lab", labId: playerLabId },
        resource: "cash",
        amount: 0 - quote.cashCostMillions,
        financeCategory: "project-cost",
      },
      {
        kind: "add-resource",
        subject: { type: "lab", labId: playerLabId },
        resource: "aura-spendable",
        amount: 0 - quote.auraCost,
        auraChangeKind: "spend",
        auraCategory: "politics",
      },
    ],
    { kind: "system", id: coalitionId },
  );
  const projectId = tx.allocateId("project", playerLabId) as ProjectId;
  const project: ProjectState = {
    id: projectId,
    ownerLabId: playerLabId,
    definitionId: contentId(`base:coalition-project.${projectType}`),
    kind: "coalition",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "coalition",
      coalitionId,
      projectType,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
      auraCost: quote.auraCost,
      ...(contributorLabId === undefined ? {} : { contributorLabId }),
      ...(assetKind === undefined ? {} : { assetKind }),
    },
  };
  tx.update((draft) => {
    const coalition = draft.world.coalitions[coalitionId];
    const lab = draft.labs[playerLabId];
    if (coalition === undefined || lab === undefined) {
      throw new Error(`Coalition project owner missing for ${coalitionId}`);
    }
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
    coalition.projectIds.push(projectId);
    coalition.formationAuraSpent += quote.auraCost;
    if (coalition.status === "proposed") coalition.status = "negotiating";
  });
  tx.emit({
    kind: "project-queued",
    labId: playerLabId,
    projectId,
    projectKind: "coalition",
  });
  tx.emit({
    kind: "coalition-project-started",
    coalitionId,
    projectId,
    projectType,
  });
  return quote;
}

function completeCoalitionProject(
  tx: SimulationTransaction,
  project: ProjectState,
): void {
  if (project.payload.kind !== "coalition") {
    throw new Error(`Project ${project.id} is not a coalition project`);
  }
  const payload = project.payload;
  const rule = COALITION_PROJECT_RULES[payload.projectType];
  tx.update((draft) => {
    const coalition = draft.world.coalitions[payload.coalitionId];
    if (coalition === undefined)
      throw new Error(`Unknown coalition ${payload.coalitionId}`);
    coalition.charterClarity = rating(
      Math.min(100, coalition.charterClarity + rule.charterGain),
    );
    coalition.sharedProtocolQuality = rating(
      Math.min(100, coalition.sharedProtocolQuality + rule.protocolGain),
    );
    coalition.verification = rating(
      Math.min(100, coalition.verification + rule.verificationGain),
    );
    if (
      payload.projectType === "asset-contribution" &&
      payload.contributorLabId !== undefined &&
      payload.assetKind !== undefined
    ) {
      coalition.assets.push({
        id: `coalition-asset:${project.id}`,
        contributorLabId: payload.contributorLabId,
        kind: payload.assetKind,
        contributedAt: draft.run.tick,
        uniqueToPlayer: calculateCoalitionAssetUniqueness(
          draft,
          coalition.proposerLabId,
          payload.contributorLabId,
          payload.assetKind,
        ),
        sourceProjectId: project.id,
      });
    }
  });
  tx.emit({
    kind: "coalition-project-resolved",
    coalitionId: payload.coalitionId,
    projectId: project.id,
    projectType: payload.projectType,
  });
  refreshCoalitionPhases(tx);
}

export const COALITION_PROJECT_HANDLER: ProjectHandler<"coalition"> = {
  kind: "coalition",
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
  complete(tx, _content, project): void {
    completeCoalitionProject(tx, project);
  },
  cancel(tx, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable !== undefined) mutable.status = "cancelled";
    });
  },
};

function coalitionRatificationScore(content: CompiledContent): number {
  const raw = content.scoreRules.awardTables.raceAwards["coalitionCharterRatified"];
  if (raw === null || typeof raw !== "object") {
    throw new Error("Missing coalition-charter score rule");
  }
  const points = (raw as { readonly points?: unknown }).points;
  if (typeof points !== "number" || !Number.isFinite(points)) {
    throw new Error("Invalid coalition-charter score rule");
  }
  return points;
}

export function ratifyCoalition(
  tx: SimulationTransaction,
  content: CompiledContent,
  coalitionId: CoalitionId,
): CoalitionEligibility {
  refreshCoalitionPhases(tx);
  const coalition = requireCoalition(tx.read(), coalitionId);
  const eligibility = evaluateCoalitionEligibility(tx.read(), coalitionId);
  if (coalition.status !== "ratifying") {
    throw new Error(`Coalition ${coalitionId} is not ready for ratification`);
  }
  if (!eligibility.eligible) {
    throw new Error(
      `Coalition ratification blocked: ${eligibility.checks
        .filter((check) => !check.satisfied)
        .map((check) => check.id)
        .join(", ")}`,
    );
  }
  tx.update((draft) => {
    const live = draft.world.coalitions[coalitionId];
    if (live === undefined) throw new Error(`Unknown coalition ${coalitionId}`);
    live.status = "active";
    live.activatedAt = draft.run.tick;
    for (const labId of live.memberLabIds) {
      const countdown = draft.world.rivals[labId]?.candidateCountdown;
      if (countdown?.status === "active") {
        countdown.status = "paused";
        countdown.pausedAt = draft.run.tick;
        countdown.remainingWeeksAtPause = Math.max(
          0,
          countdown.completesAt - draft.run.tick,
        );
      }
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Coalition charter ${coalitionId} ratified.`,
      category: "narrative",
      source: { kind: "system", id: coalitionId },
      relatedIds: [coalitionId, ...live.memberLabIds],
    });
  });
  awardScore(tx, {
    key: `coalition/charter-ratified/${coalitionId}`,
    categoryId: "score.race-operations",
    amount: coalitionRatificationScore(content),
    source: { kind: "system", id: coalitionId },
    explanationKey: "score.coalition.charter-ratified",
  });
  tx.emit({
    kind: "coalition-ratified",
    coalitionId,
    memberLabIds: coalition.memberLabIds,
  });
  return eligibility;
}

export function recordCoalitionBetrayal(
  tx: SimulationTransaction,
  coalitionId: CoalitionId,
  labId: LabId,
  summary: string,
): string {
  const coalition = requireCoalition(tx.read(), coalitionId);
  if (!coalition.memberLabIds.includes(labId)) {
    throw new Error(`${labId} is not a member of ${coalitionId}`);
  }
  const id = `coalition-betrayal:${coalitionId}:${String(coalition.betrayals.length)}`;
  tx.update((draft) => {
    const live = draft.world.coalitions[coalitionId];
    if (live === undefined) throw new Error(`Unknown coalition ${coalitionId}`);
    live.betrayals.push({ id, labId, occurredAt: draft.run.tick, summary });
  });
  tx.emit({ kind: "coalition-betrayal-recorded", coalitionId, betrayalId: id, labId });
  return id;
}
