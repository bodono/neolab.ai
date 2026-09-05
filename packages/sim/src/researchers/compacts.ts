import type {
  CompiledContent,
  ContentId,
  ResearcherCompactCheckDefinition,
} from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ResearcherId } from "../model/ids.ts";
import type { GameState, LabState, ResearcherState } from "../model/state.ts";
import { rating, tick, type Tick } from "../model/units.ts";

export interface CompactCheckResult {
  readonly satisfied: boolean;
  /** False when a conditional or event-driven promise has not activated yet. */
  readonly applicable: boolean;
  /** Most recent canonical fact satisfying a rolling requirement. */
  readonly satisfiedAt?: Tick;
  /** Most recent event that directly violated an event-driven requirement. */
  readonly violationAt?: Tick;
  readonly evidence: string;
}

function flagTick(lab: LabState, key: string): Tick | undefined {
  const value = lab.flags[key];
  return typeof value === "number" && Number.isInteger(value) ? tick(value) : undefined;
}

function recordedActionTick(lab: LabState, tag: string): Tick | undefined {
  return flagTick(lab, `action:${tag}:lastAt`);
}

function targetTick(lab: LabState, kind: "project-tag" | "review-tag", tag: string) {
  return flagTick(lab, `${kind}:${tag}:lastAt`);
}

function targetIsFresh(
  state: Readonly<GameState>,
  content: CompiledContent,
  lab: LabState,
  kind: "project-tag" | "review-tag",
  tag: string,
  windowWeeks = content.researchers.rules.compact.defaultRollingWindowWeeks,
): Tick | undefined {
  const completedAt = targetTick(lab, kind, tag);
  if (completedAt === undefined) return undefined;
  const usedAt = flagTick(lab, `${kind}:${tag}:usedAt`);
  return state.run.tick - completedAt < windowWeeks &&
    (usedAt === undefined || completedAt > usedAt)
    ? completedAt
    : undefined;
}

const ASSIGNMENT_TAG_TARGETS: Readonly<Record<string, readonly string[]>> = {
  "alignment-programme": ["safety.alignment-control"],
  "architecture-programme": ["domain.architectures"],
  "data-programme": ["domain.multimodality"],
  "generative-programme": ["domain.multimodality"],
  "interpretability-programme": ["safety.interpretability-evals"],
  "multimodal-programme": ["domain.multimodality"],
  "optimisation-programme": ["domain.optimisation-scaling"],
  "reasoning-programme": ["domain.reasoning-tools"],
  "reinforcement-programme": ["domain.reinforcement-agency"],
  "robotics-programme": ["domain.robotics-embodiment"],
  "scientific-ai-programme": ["domain.scientific-ai"],
  "security-programme": ["safety.security-containment"],
  "vision-programme": ["domain.multimodality"],
};

function assignmentTagApplies(researcher: ResearcherState, tag: string): boolean {
  const assignment = researcher.assignment;
  if (assignment === undefined) return false;
  if (tag === "capability-programme") return assignment.kind === "capability-program";
  return (
    assignment.targetId !== undefined &&
    (ASSIGNMENT_TAG_TARGETS[tag]?.some(
      (targetId) =>
        assignment.targetId === targetId ||
        assignment.targetId?.endsWith(`:${targetId}`) === true,
    ) === true ||
      assignment.targetId.includes(tag.replace(/-programme$/, "")))
  );
}

function canonicalActionTick(
  state: Readonly<GameState>,
  lab: LabState,
  tag: string,
): Tick | undefined {
  if (tag === "open-paper") {
    return Object.values(state.world.paperRace.discoveries).reduce<Tick | undefined>(
      (latest, discovery) => {
        const qualifies =
          discovery.discovererLabId === lab.id &&
          (discovery.publicationPolicy === "publish-openly" ||
            discovery.publicationPolicy === "release-everything") &&
          discovery.policyChosenAt !== undefined;
        if (!qualifies) return latest;
        return latest === undefined || discovery.policyChosenAt > latest
          ? discovery.policyChosenAt
          : latest;
      },
      undefined,
    );
  }
  if (tag === "open-model") {
    return lab.models.modelIds.reduce<Tick | undefined>((latest, modelId) => {
      const model = state.models[modelId];
      const qualifies =
        model?.ownerLabId === lab.id &&
        (model.deployment.policy === "open-api" ||
          model.deployment.policy === "weights-release");
      if (!qualifies) return latest;
      return latest === undefined || model.deployment.changedAt > latest
        ? model.deployment.changedAt
        : latest;
    }, undefined);
  }
  if (tag === "training-run-underway") {
    // A live run satisfies the promise continuously, so the window clock only
    // runs between runs -- a 40-week frontier run must never breach the
    // promise mid-run. Once idle, the anchor is the end of the last
    // completed run (the produced model's trainedAt); a cancelled run's credit
    // comes from lastSatisfiedAt having advanced weekly while it was live.
    const live = Object.values(state.projects).some(
      (project) =>
        project.ownerLabId === lab.id &&
        project.kind === "training" &&
        project.status === "active",
    );
    if (live) return state.run.tick;
    return lab.models.modelIds.reduce<Tick | undefined>((latest, modelId) => {
      const trainedAt = state.models[modelId]?.trainedAt;
      return trainedAt !== undefined && (latest === undefined || trainedAt > latest)
        ? trainedAt
        : latest;
    }, undefined);
  }
  return undefined;
}

function actionTick(
  state: Readonly<GameState>,
  lab: LabState,
  tag: string,
): Tick | undefined {
  const recorded = recordedActionTick(lab, tag);
  const canonical = canonicalActionTick(state, lab, tag);
  if (recorded === undefined) return canonical;
  if (canonical === undefined) return recorded;
  return recorded > canonical ? recorded : canonical;
}

function latestAction(
  state: Readonly<GameState>,
  lab: LabState,
  tags: readonly string[],
): Tick | undefined {
  return tags.reduce<Tick | undefined>((latest, tag) => {
    const candidate = actionTick(state, lab, tag);
    return candidate !== undefined && (latest === undefined || candidate > latest)
      ? candidate
      : latest;
  }, undefined);
}

/**
 * Record a completed player action and immediately reconcile rolling researcher
 * promises so their status never lags behind the command that satisfied them.
 */
export function recordResearcherCompactActions(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  tags: readonly string[],
): void {
  if (tags.length === 0) return;
  const now = tx.read().run.tick;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown compact action lab ${labId}`);
    for (const tag of new Set(tags)) {
      const countKey = `action:${tag}:count`;
      const count = lab.flags[countKey];
      lab.flags[`action:${tag}:lastAt`] = now;
      lab.flags[countKey] = typeof count === "number" ? count + 1 : 1;
    }
  });
  evaluateResearcherCompacts(tx, content);
}

function publicationEventKey(paperTag: string, reviewTag: string): string {
  return `compact-event:publication:${paperTag}:${reviewTag}`;
}

function releaseEventKey(minFc: number, projectTag: string): string {
  return `compact-event:release-fc-${String(minFc)}:${projectTag}`;
}

/**
 * Reconcile promises that apply to every relevant publication. A completed
 * review is consumed by one publication, so a single two-week project cannot
 * silently certify the rest of the lab's papers forever.
 */
export function recordResearcherPublicationCompactEvent(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  paperTags: readonly string[],
  policy: string,
): void {
  const requiresPublicationReview =
    policy === "publish-openly" ||
    policy === "controlled-publication" ||
    policy === "release-everything";
  if (!requiresPublicationReview) return;
  const now = tx.read().run.tick;
  const relevant = requiresPublicationReview
    ? Object.values(tx.read().researchers).flatMap((researcher) => {
        if (
          researcher.employerLabId !== labId ||
          (researcher.status !== "employed" && researcher.status !== "sabbatical") ||
          !researcher.compact.includedInOffer
        ) {
          return [];
        }
        const definition = content.researchers.definitions[researcher.definitionId];
        if (definition === undefined) return [];
        const check = definition.compact.check;
        return "type" in check &&
          check.type === "publication-requires-review-tag" &&
          paperTags.includes(check.paperTag)
          ? [check]
          : [];
      })
    : [];
  if (relevant.length === 0) return;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown compact publication lab ${labId}`);
    for (const check of relevant) {
      if (!("type" in check) || check.type !== "publication-requires-review-tag") {
        continue;
      }
      const reviewedAt = targetIsFresh(
        draft,
        content,
        lab,
        "review-tag",
        check.reviewTag,
      );
      const key = publicationEventKey(check.paperTag, check.reviewTag);
      lab.flags[`${key}:lastAt`] = now;
      lab.flags[`${key}:compliant`] = reviewedAt !== undefined;
      if (reviewedAt !== undefined) {
        lab.flags[`review-tag:${check.reviewTag}:usedAt`] = now;
      } else {
        lab.flags[`compact-violation:publication:${check.paperTag}`] = true;
      }
    }
  });
  evaluateResearcherCompacts(tx, content);
}

/**
 * Reconcile promises that apply to every high-capability public model release.
 * Each audit can certify one release and expires after the standard window.
 */
export function recordResearcherModelReleaseCompactEvent(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  frontierCapability: number,
  policy: string,
): void {
  if (policy === "internal-only") return;
  const now = tx.read().run.tick;
  const relevant = Object.values(tx.read().researchers).flatMap((researcher) => {
    if (
      researcher.employerLabId !== labId ||
      (researcher.status !== "employed" && researcher.status !== "sabbatical") ||
      !researcher.compact.includedInOffer
    ) {
      return [];
    }
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) return [];
    const check = definition.compact.check;
    return "type" in check &&
      check.type === "release-requires-project" &&
      frontierCapability >= check.minFc
      ? [check]
      : [];
  });
  if (relevant.length === 0) return;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Unknown compact release lab ${labId}`);
    for (const check of relevant) {
      if (!("type" in check) || check.type !== "release-requires-project") {
        continue;
      }
      const auditedAt = targetIsFresh(
        draft,
        content,
        lab,
        "project-tag",
        check.projectTag,
      );
      const key = releaseEventKey(check.minFc, check.projectTag);
      lab.flags[`${key}:lastAt`] = now;
      lab.flags[`${key}:compliant`] = auditedAt !== undefined;
      if (auditedAt !== undefined) {
        lab.flags[`project-tag:${check.projectTag}:usedAt`] = now;
      } else {
        // Preserve an irreversible audit trail for scoring and the post-run
        // report, even if a later release is handled correctly.
        lab.flags[`compact-violation:release-fc-${String(check.minFc)}`] = true;
      }
    }
  });
  evaluateResearcherCompacts(tx, content);
}

function maxActiveFrontierCapability(state: Readonly<GameState>, lab: LabState): number {
  return Math.max(
    0,
    ...lab.models.modelIds.map(
      (modelId) => state.models[modelId]?.measuredCapability?.frontierCapability ?? 0,
    ),
  );
}

function metricValue(
  state: Readonly<GameState>,
  lab: LabState,
  metric: string,
): number | undefined {
  switch (metric) {
    case "lab.allocation.rdSafetyShare":
      return 1 - lab.compute.allocation.capabilityBasisPoints / 10_000;
    case "lab.model.maxActiveFC":
      return maxActiveFrontierCapability(state, lab);
    case "lab.model.currentAccessLevel": {
      const modelId = lab.models.currentModelId;
      const model = modelId === undefined ? undefined : state.models[modelId];
      return model?.accessLevel ?? 0;
    }
    default: {
      const value = lab.flags[`metric:${metric}`];
      return typeof value === "number" ? value : undefined;
    }
  }
}

function conditionSatisfied(
  state: Readonly<GameState>,
  lab: LabState,
  researcher: ResearcherState,
  condition: Readonly<Record<string, string | number>>,
): boolean {
  if (typeof condition["metric"] === "string") {
    const threshold =
      typeof condition["value"] === "number"
        ? condition["value"]
        : typeof condition["atLeast"] === "number"
          ? condition["atLeast"]
          : 0;
    return (metricValue(state, lab, condition["metric"]) ?? 0) >= threshold;
  }
  if (typeof condition["assignmentDomain"] === "string") {
    return researcher.assignment?.targetId === condition["assignmentDomain"];
  }
  if (typeof condition["modelTrainingOrDeployedFcAtLeast"] === "number") {
    return (
      maxActiveFrontierCapability(state, lab) >=
      condition["modelTrainingOrDeployedFcAtLeast"]
    );
  }
  return false;
}

function poolShare(lab: LabState, pool: string, target?: string): number {
  if (pool === "rd" && target === "safety") {
    return 1 - lab.compute.allocation.capabilityBasisPoints / 10_000;
  }
  if (pool === "rd" && target === "capability") {
    return lab.compute.allocation.capabilityBasisPoints / 10_000;
  }
  if (pool === "capability" && target !== undefined) {
    return (lab.compute.allocation.capabilityDomainWeights[target] ?? 0) / 10_000;
  }
  if (pool === "safety" && target !== undefined) {
    return (lab.compute.allocation.safetyProgramWeights[target] ?? 0) / 10_000;
  }
  return 0;
}

function latestFacilityCompletion(
  lab: LabState,
  facilityId: ContentId,
): Tick | undefined {
  return lab.facilities.instances.reduce<Tick | undefined>((latest, facility) => {
    if (facility.definitionId !== facilityId) return latest;
    return latest === undefined || facility.completedAt > latest
      ? facility.completedAt
      : latest;
  }, undefined);
}

function result(
  satisfied: boolean,
  evidence: string,
  satisfiedAt?: Tick,
  applicable = true,
  violationAt?: Tick,
): CompactCheckResult {
  return {
    satisfied,
    applicable,
    evidence,
    ...(satisfiedAt === undefined ? {} : { satisfiedAt }),
    ...(violationAt === undefined ? {} : { violationAt }),
  };
}

/** Closed compact predicate evaluator. Unsupported ad-hoc callbacks cannot enter. */
export function evaluateResearcherCompactCheck(
  state: Readonly<GameState>,
  content: CompiledContent,
  researcherId: ResearcherId,
  check: ResearcherCompactCheckDefinition,
): CompactCheckResult {
  const researcher = state.researchers[researcherId];
  if (researcher?.employerLabId === undefined) {
    return result(false, "researcher is not employed");
  }
  const lab = state.labs[researcher.employerLabId];
  if (lab === undefined) return result(false, "employer lab is missing");

  if ("metric" in check && "atLeast" in check) {
    const value = metricValue(state, lab, check.metric);
    return result(
      value !== undefined && value >= check.atLeast,
      `${check.metric}=${String(value ?? "unknown")}`,
      value !== undefined && value >= check.atLeast ? state.run.tick : undefined,
    );
  }
  switch (check.type) {
    case "tagged-action-within": {
      const latest = latestAction(state, lab, check.tags);
      return result(
        latest !== undefined && state.run.tick - latest < check.weeks,
        `latest tagged action at ${String(latest ?? "never")}`,
        latest,
      );
    }
    case "conditional-tagged-action-within": {
      const active =
        (metricValue(state, lab, check.condition.metric) ?? 0) >= check.condition.atLeast;
      if (!active) return result(true, "condition is inactive", undefined, false);
      const latest = latestAction(state, lab, check.tags);
      return result(
        latest !== undefined && state.run.tick - latest < check.weeks,
        `latest conditional action at ${String(latest ?? "never")}`,
        latest,
      );
    }
    case "assignment-requires-project-tag": {
      const applies =
        lab.flags[`assignment-tag:${check.assignmentTag}`] === true ||
        assignmentTagApplies(researcher, check.assignmentTag);
      if (!applies) {
        return result(true, "assignment condition is inactive", undefined, false);
      }
      const completedAt = targetIsFresh(
        state,
        content,
        lab,
        "project-tag",
        check.projectTag,
        compactWindowWeeks(content, check),
      );
      return result(
        completedAt !== undefined,
        `project tag ${check.projectTag}`,
        completedAt,
      );
    }
    case "conditional-metric-at-least": {
      if (!conditionSatisfied(state, lab, researcher, check.condition)) {
        return result(true, "condition is inactive", undefined, false);
      }
      const value = metricValue(state, lab, check.metric);
      return result(
        value !== undefined && value >= check.value,
        `${check.metric}=${String(value ?? "unknown")}`,
        value !== undefined && value >= check.value ? state.run.tick : undefined,
      );
    }
    case "conditional-pool-share-at-least": {
      if (!conditionSatisfied(state, lab, researcher, check.condition)) {
        return result(true, "condition is inactive", undefined, false);
      }
      const share = poolShare(lab, check.pool, check.target);
      return result(
        share >= check.value,
        `pool share=${String(share)}`,
        share >= check.value ? state.run.tick : undefined,
      );
    }
    case "facility-owned-within": {
      const completedAt = latestFacilityCompletion(lab, check.facility);
      // The compact window enforces the authored deadline and records a breach
      // when it is missed. Facility ownership itself is durable: completing the
      // promised building late repairs the ongoing relationship state without
      // erasing the earlier breach log or its one-off consequences.
      return result(completedAt !== undefined, `facility ${check.facility}`, completedAt);
    }
    case "minimum-assignment-duration": {
      const completedAt = flagTick(lab, `assignment-duration:${check.domain}:at`);
      if (completedAt !== undefined) {
        return result(
          true,
          `protected appointment completed at ${String(completedAt)}`,
          completedAt,
        );
      }
      if (researcher.assignment?.targetId !== check.domain) {
        return result(true, "protected appointment has not started", undefined, false);
      }
      const elapsed = state.run.tick - researcher.assignment.assignedAt;
      return result(
        elapsed >= check.weeks,
        `protected appointment ${String(Math.min(elapsed, check.weeks))}/${String(check.weeks)} weeks`,
        elapsed >= check.weeks
          ? tick(researcher.assignment.assignedAt + check.weeks)
          : undefined,
      );
    }
    case "publication-requires-review-tag": {
      const key = publicationEventKey(check.paperTag, check.reviewTag);
      const observedAt = flagTick(lab, `${key}:lastAt`);
      if (observedAt === undefined) {
        return result(true, "no relevant publication yet", undefined, false);
      }
      const compliant = lab.flags[`${key}:compliant`] === true;
      return result(
        compliant,
        compliant
          ? `publication review ${check.reviewTag} completed`
          : `publication review ${check.reviewTag} was missing`,
        compliant ? observedAt : undefined,
        true,
        compliant ? undefined : observedAt,
      );
    }
    case "ratio-at-least": {
      const tenureDiscoveries =
        check.numerator === "discoveries.publishedOrControlled" &&
        check.denominator === "discoveries.total"
          ? Object.values(state.world.paperRace.discoveries).filter(
              (discovery) =>
                discovery.discovererLabId === lab.id &&
                discovery.discoveredAt >= (researcher.employedAt ?? state.run.tick),
            )
          : undefined;
      const numerator =
        tenureDiscoveries === undefined
          ? (metricValue(state, lab, check.numerator) ?? 0)
          : tenureDiscoveries.filter(
              (discovery) =>
                discovery.publicationPolicy !== undefined &&
                discovery.publicationPolicy !== "keep-secret",
            ).length;
      const denominator =
        tenureDiscoveries?.length ?? metricValue(state, lab, check.denominator) ?? 0;
      const satisfied =
        denominator <= check.graceDiscoveries ||
        (denominator > 0 && numerator / denominator >= check.value);
      return result(
        satisfied,
        `ratio=${String(denominator === 0 ? 1 : numerator / denominator)}`,
        satisfied ? state.run.tick : undefined,
      );
    }
    case "release-requires-project": {
      const key = releaseEventKey(check.minFc, check.projectTag);
      const observedAt = flagTick(lab, `${key}:lastAt`);
      if (observedAt === undefined) {
        return result(true, "no qualifying public release yet", undefined, false);
      }
      const compliant = lab.flags[`${key}:compliant`] === true;
      return result(
        compliant,
        compliant
          ? `release audit ${check.projectTag} completed`
          : `release audit ${check.projectTag} was missing`,
        compliant ? observedAt : undefined,
        true,
        compliant ? undefined : observedAt,
      );
    }
    case "deployment-requires-flag": {
      if (maxActiveFrontierCapability(state, lab) < check.frontierCapabilityAtLeast) {
        const established = lab.flags[check.flag] === true;
        return established
          ? result(true, `required flag ${check.flag}`, state.run.tick)
          : result(true, "frontier threshold is inactive", undefined, false);
      }
      const satisfied = lab.flags[check.flag] === true;
      return result(
        satisfied,
        `required flag ${check.flag}`,
        satisfied ? state.run.tick : undefined,
      );
    }
  }
}

function explicitWindowWeeks(
  check: ResearcherCompactCheckDefinition,
): number | undefined {
  if ("type" in check) {
    if ("weeks" in check && typeof check.weeks === "number") return check.weeks;
  }
  return undefined;
}

export function compactWindowWeeks(
  content: CompiledContent,
  check: ResearcherCompactCheckDefinition,
): number {
  return (
    explicitWindowWeeks(check) ??
    content.researchers.rules.compact.defaultRollingWindowWeeks
  );
}

/** Annual promises get a full quarter of notice; shorter cadences keep one month. */
export function compactWarningLeadWeeks(windowWeeks: number): number {
  return windowWeeks >= 52 ? 12 : 4;
}

function clampRating(value: number): ReturnType<typeof rating> {
  return rating(Math.max(0, Math.min(100, value)));
}

function latestTick(...values: readonly (Tick | undefined)[]): Tick | undefined {
  return values.reduce<Tick | undefined>(
    (latest, value) =>
      value !== undefined && (latest === undefined || value > latest) ? value : latest,
    undefined,
  );
}

function recordCompletedMinimumAssignments(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
): void {
  const researcher = tx.read().researchers[researcherId];
  if (researcher?.employerLabId === undefined || researcher.assignment === undefined) {
    return;
  }
  const labId = researcher.employerLabId;
  const definition = content.researchers.definitions[researcher.definitionId];
  if (definition === undefined) return;
  const check = definition.compact.check;
  if (
    !("type" in check) ||
    check.type !== "minimum-assignment-duration" ||
    researcher.assignment.targetId !== check.domain ||
    tx.read().run.tick - researcher.assignment.assignedAt < check.weeks
  ) {
    return;
  }
  const key = `assignment-duration:${check.domain}:at`;
  const lab = tx.read().labs[labId];
  if (lab === undefined || flagTick(lab, key) !== undefined) return;
  const completedAt = tick(researcher.assignment.assignedAt + check.weeks);
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    if (mutableLab !== undefined) mutableLab.flags[key] = completedAt;
  });
}

/**
 * Apply a promise's fulfilment reward. The compiler supplies a modest morale
 * reward when content does not author something more specific. The caller
 * guarantees this runs once per completed window/event, never every weekly
 * reconciliation.
 */
function applyCompactFulfilment(
  mutable: { morale: number; loyalty: number; departurePressure: number },
  effects: readonly { readonly target: string; readonly value: number }[],
): void {
  for (const effect of effects) {
    if (effect.target === "researcher.moraleTarget") {
      mutable.morale = clampRating(mutable.morale + effect.value);
    } else if (effect.target === "researcher.loyalty") {
      mutable.loyalty = clampRating(mutable.loyalty + effect.value);
    } else if (effect.target === "researcher.departurePressure") {
      mutable.departurePressure = clampRating(mutable.departurePressure + effect.value);
    }
  }
}

function deliverCompactBreach(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
  now: Tick,
  startNextWindow: boolean,
): void {
  const definitionId = tx.read().researchers[researcherId]?.definitionId;
  const definition =
    definitionId === undefined
      ? undefined
      : content.researchers.definitions[definitionId];
  if (definition === undefined) return;
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    if (mutable === undefined) return;
    if (startNextWindow) mutable.compact.windowStartedAt = now;
    mutable.compact.status = "breached";
    mutable.compact.breachedAt = now;
    for (const effect of content.researchers.rules.compact.breachEffects) {
      if (effect.target === "researcher.moraleTarget") {
        mutable.morale = clampRating(mutable.morale + effect.value);
      } else if (effect.target === "researcher.loyalty") {
        mutable.loyalty = clampRating(mutable.loyalty + effect.value);
      } else if (effect.target === "researcher.departurePressure") {
        mutable.departurePressure = clampRating(mutable.departurePressure + effect.value);
      }
    }
    draft.decisionLog.push({
      tick: now,
      summary: `${definition.displayName}'s promise was broken: ${definition.compact.requirement}`,
    });
    draft.domainLog.push({
      tick: now,
      code: `researcher.compact.breached:${researcherId}`,
    });
  });
  tx.emit({
    kind: "researcher-compact-breached",
    researcherId,
    compactId: definition.compact.id,
    eventId: definition.compact.breachEvent,
  });
}

function deliverCompactWarning(
  tx: SimulationTransaction,
  content: CompiledContent,
  researcherId: ResearcherId,
  now: Tick,
  weeksRemaining: number,
): void {
  const definitionId = tx.read().researchers[researcherId]?.definitionId;
  const definition =
    definitionId === undefined
      ? undefined
      : content.researchers.definitions[definitionId];
  if (definition === undefined) return;
  tx.update((draft) => {
    const mutable = draft.researchers[researcherId];
    if (mutable === undefined) return;
    mutable.compact.status = "warning";
    mutable.compact.warnedAt = now;
    draft.decisionLog.push({
      tick: now,
      summary: `${definition.displayName}'s promise is due soon: ${definition.compact.requirement}`,
    });
    draft.domainLog.push({
      tick: now,
      code: `researcher.compact.warning:${researcherId}`,
    });
  });
  tx.emit({
    kind: "researcher-compact-warning",
    researcherId,
    compactId: definition.compact.id,
    eventId: definition.compact.breachEvent,
    weeksRemaining,
  });
}

/** Weekly warning/breach delivery with rolling, one-time, and per-event cadence. */
export function evaluateResearcherCompacts(
  tx: SimulationTransaction,
  content: CompiledContent,
): void {
  for (const researcherId of Object.keys(tx.read().researchers).sort()) {
    const typedResearcherId = researcherId as ResearcherId;
    recordCompletedMinimumAssignments(tx, content, typedResearcherId);
    const state = tx.read();
    const researcher = state.researchers[typedResearcherId];
    if (
      researcher === undefined ||
      researcher.employerLabId === undefined ||
      (researcher.status !== "employed" && researcher.status !== "sabbatical") ||
      !researcher.compact.includedInOffer
    ) {
      continue;
    }
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) {
      throw new Error(`Missing definition ${researcher.definitionId}`);
    }
    const now = state.run.tick;
    const checked = evaluateResearcherCompactCheck(
      state,
      content,
      researcher.id,
      definition.compact.check,
    );
    const windowWeeks = compactWindowWeeks(content, definition.compact.check);
    const windowStart =
      researcher.compact.windowStartedAt ?? researcher.employedAt ?? now;
    if (!checked.applicable) {
      tx.update((draft) => {
        const mutable = draft.researchers[researcher.id];
        if (mutable === undefined) return;
        mutable.compact.windowStartedAt = now;
        if (mutable.compact.status !== "fulfilled") {
          mutable.compact.status = "tracking";
        }
        delete mutable.compact.warnedAt;
      });
      continue;
    }

    if (definition.compact.cadence === "event-driven") {
      if (checked.satisfied) {
        const satisfiedAt = checked.satisfiedAt ?? now;
        const shouldReward =
          researcher.compact.lastSatisfiedAt === undefined ||
          satisfiedAt > researcher.compact.lastSatisfiedAt;
        tx.update((draft) => {
          const mutable = draft.researchers[researcher.id];
          if (mutable === undefined) return;
          mutable.compact.lastSatisfiedAt = satisfiedAt;
          mutable.compact.status = "fulfilled";
          if (shouldReward) {
            applyCompactFulfilment(mutable, definition.compact.fulfilmentEffects);
          }
          delete mutable.compact.warnedAt;
        });
      } else if (
        checked.violationAt !== undefined &&
        (researcher.compact.breachedAt === undefined ||
          researcher.compact.breachedAt < checked.violationAt)
      ) {
        deliverCompactBreach(tx, content, researcher.id, now, false);
      }
      continue;
    }

    if (
      !checked.satisfied &&
      checked.violationAt !== undefined &&
      (researcher.compact.breachedAt === undefined ||
        researcher.compact.breachedAt < checked.violationAt)
    ) {
      deliverCompactBreach(
        tx,
        content,
        researcher.id,
        now,
        definition.compact.cadence === "rolling",
      );
      continue;
    }

    const anchor =
      latestTick(researcher.compact.lastSatisfiedAt, windowStart) ?? windowStart;
    const satisfactionAnchor = checked.satisfiedAt ?? anchor;
    const elapsed = now - anchor;
    const satisfiedElapsed = now - satisfactionAnchor;
    const warningAt = Math.max(0, windowWeeks - compactWarningLeadWeeks(windowWeeks));

    if (checked.satisfied) {
      const alreadyWarnedThisWindow =
        researcher.compact.warnedAt !== undefined &&
        researcher.compact.warnedAt >= satisfactionAnchor;
      if (definition.compact.cadence === "rolling" && satisfiedElapsed >= warningAt) {
        tx.update((draft) => {
          const mutable = draft.researchers[researcher.id];
          if (mutable === undefined) return;
          mutable.compact.lastSatisfiedAt = satisfactionAnchor;
        });
        if (!alreadyWarnedThisWindow) {
          deliverCompactWarning(
            tx,
            content,
            researcher.id,
            now,
            Math.max(0, windowWeeks - satisfiedElapsed),
          );
        }
      } else {
        const shouldReward = researcher.compact.status !== "fulfilled";
        tx.update((draft) => {
          const mutable = draft.researchers[researcher.id];
          if (mutable === undefined) return;
          mutable.compact.lastSatisfiedAt = satisfactionAnchor;
          mutable.compact.status = "fulfilled";
          if (shouldReward) {
            applyCompactFulfilment(mutable, definition.compact.fulfilmentEffects);
          }
          delete mutable.compact.warnedAt;
        });
      }
      continue;
    }

    const alreadyBreachedThisWindow =
      researcher.compact.breachedAt !== undefined &&
      researcher.compact.breachedAt >= anchor;
    if (elapsed >= windowWeeks && !alreadyBreachedThisWindow) {
      deliverCompactBreach(
        tx,
        content,
        researcher.id,
        now,
        definition.compact.cadence === "rolling",
      );
      continue;
    }

    const alreadyWarnedThisWindow =
      researcher.compact.warnedAt !== undefined && researcher.compact.warnedAt >= anchor;
    if (elapsed >= warningAt && !alreadyWarnedThisWindow) {
      deliverCompactWarning(
        tx,
        content,
        researcher.id,
        now,
        Math.max(0, windowWeeks - elapsed),
      );
    }
  }
}
