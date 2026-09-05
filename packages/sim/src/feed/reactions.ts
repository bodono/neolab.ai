import type { CompiledContent } from "@neolab/content-schema";

import type { DomainEvent } from "../engine/domain-events.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { GameState, LabState } from "../model/state.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

/**
 * Researchers reacting, in their own voice, to things that actually happened.
 *
 * Every researcher is authored with three `eventReactions`, each keyed by a
 * trigger tag ("unstable-training", "candidate-confirmation", ...). This
 * module is what makes those tags real: each week it reads the domain events
 * the tick actually emitted (plus a few standing conditions the player can
 * see on their own dashboards), translates them into trigger tags, and lets
 * one employed researcher whose reaction matches speak in the lab feed.
 *
 * Every mapping below names a moment the engine genuinely produces; nothing
 * here fires from hidden state. Player-lab scoping is enforced per event:
 * colleagues comment on their own lab's week (and on rivals' public moves),
 * never on a rival's internals.
 */

const REACTION_COOLDOWN_WEEKS = 13;

function reactionFlagTick(lab: LabState, tag: string): number | undefined {
  const value = lab.flags[`reaction:${tag}:lastAt`];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function playerModelOwned(
  state: Readonly<GameState>,
  modelId: keyof GameState["models"],
): boolean {
  return state.models[modelId]?.ownerLabId === state.run.playerLabId;
}

function playerLab(state: Readonly<GameState>): LabState | undefined {
  return state.labs[state.run.playerLabId];
}

function trainingScale(
  state: Readonly<GameState>,
  projectId: keyof GameState["projects"],
): string | undefined {
  const payload = state.projects[projectId]?.payload;
  return payload?.kind === "training" ? payload.scale : undefined;
}

function highestCapabilityDomain(lab: LabState): string | undefined {
  let best: string | undefined;
  let bestLevel = -1;
  for (const [domainId, domain] of Object.entries(lab.research.domains)) {
    if (domain.level > bestLevel) {
      best = domainId;
      bestLevel = domain.level;
    }
  }
  return best;
}

function scientificAiLevel(lab: LabState): number {
  return (
    Object.entries(lab.research.domains).find(([domainId]) =>
      domainId.endsWith("domain.scientific-ai"),
    )?.[1].level ?? 0
  );
}

function programmeTags(programId: string, threshold: number): readonly string[] {
  if (programId.endsWith("domain.architectures")) return ["architecture-fad"];
  if (programId.endsWith("domain.multimodality")) {
    return threshold >= 60
      ? ["synthetic-media", "annotation-labour", "object-detection"]
      : ["annotation-labour", "object-detection"];
  }
  if (programId.endsWith("domain.reinforcement-agency")) {
    return threshold <= 40
      ? ["hand-engineered-shortcut"]
      : ["reinforcement-breakthrough"];
  }
  if (programId.endsWith("domain.robotics-embodiment")) {
    return threshold <= 40
      ? ["repeated-robotics-project"]
      : ["simulation-transfer", "sim-to-real-gap"];
  }
  if (programId.endsWith("domain.scientific-ai")) {
    if (threshold >= 80) return ["medicine-breakthrough"];
    if (threshold >= 60) return ["drug-discovery-breakthrough", "medical-opportunity"];
    return ["scientific-ai-breakthrough"];
  }
  if (programId.endsWith("safety.alignment-control")) return ["weak-to-strong-result"];
  if (programId.endsWith("safety.interpretability-evals")) {
    return ["interpretability-breakthrough"];
  }
  if (programId.endsWith("safety.security-containment")) return ["red-team-budget"];
  return [];
}

function evaluationTags(definitionId: string, anomalyCount: number): readonly string[] {
  const anomalous = anomalyCount > 0 ? ["dataset-shortcut", "model-overconfidence"] : [];
  if (definitionId.endsWith("evaluation.interpretability-audit")) {
    return anomalyCount > 0
      ? [
          "interpretability-breakthrough",
          "colourful-heatmap",
          "attention-interpretability",
        ]
      : ["attention-interpretability", "colourful-heatmap"];
  }
  if (definitionId.endsWith("evaluation.behavioural-red-team")) {
    return ["red-team-budget", ...anomalous];
  }
  if (definitionId.endsWith("evaluation.external-audit")) {
    return ["audit-delay", "audit-pressure", ...anomalous];
  }
  if (definitionId.endsWith("evaluation.sandboxed-autonomy-trial")) {
    return ["ai-self-designed-eval", "wrong-drawer", ...anomalous];
  }
  if (definitionId.endsWith("evaluation.alignment-interview")) {
    return ["self-evaluation", ...anomalous];
  }
  return anomalous;
}

function reactionTagsForEvent(
  state: Readonly<GameState>,
  content: CompiledContent,
  event: DomainEvent,
): readonly string[] {
  const playerLabId = state.run.playerLabId;
  const lab = playerLab(state);
  switch (event.kind) {
    case "training-failure-check": {
      if (event.labId !== playerLabId || event.outcome === "none") return [];
      const tags = [
        "unstable-training",
        "technical-failure",
        "training-run-failure",
        "fine-tuning-instability",
        "vanishing-signal",
      ];
      if (event.outcome === "capability-penalty") tags.push("routing-collapse");
      if (
        lab !== undefined &&
        highestCapabilityDomain(lab)?.endsWith("domain.scientific-ai") === true
      ) {
        tags.push("scientific-ai-failure");
      }
      return tags;
    }
    case "training-started": {
      if (event.labId !== playerLabId) return [];
      const scale = trainingScale(state, event.projectId);
      if (scale === "prototype") {
        return ["ablation-budget", "frontier-run-proposal", "scaling-proposal"];
      }
      if (scale === "frontier") {
        return [
          "dataset-shortage",
          "labels-shortage",
          "frontier-run-proposal",
          "scaling-proposal",
        ];
      }
      return ["frontier-run-proposal", "scaling-proposal"];
    }
    case "training-completed":
      if (event.labId !== playerLabId) return [];
      return event.regressions.length > 0
        ? ["failed-replication", "model-overconfidence"]
        : ["beautiful-loss-curve", "experimental-validation"];
    case "capability-tier-reached": {
      if (!playerModelOwned(state, event.modelId)) return [];
      const tags = ["benchmark-record", "capability-surprise"];
      if (event.level >= 5) tags.push("benchmark-saturation");
      if (event.level >= 6) tags.push("reasoning-benchmark-record");
      return tags;
    }
    case "agi-candidate-detected":
      if (!playerModelOwned(state, event.modelId)) return [];
      return ["candidate-confirmation", "agi-declaration-pressure"];
    case "autonomy-level-unlocked": {
      if (!playerModelOwned(state, event.modelId)) return [];
      const tags = ["autonomous-systems", "oversight-bottleneck"];
      if (event.level >= 2) tags.push("ai-research-assistance");
      return tags;
    }
    case "autonomy-escalation-detected":
      if (event.labId !== playerLabId) return [];
      return [
        "model-deception-signal",
        "emergent-strategy",
        "reward-hacking",
        "objective-misspecification",
      ];
    case "anomaly-detected":
      if (!playerModelOwned(state, event.modelId)) return [];
      return ["anomalous-representation", "suspicious-representation"];
    case "mandatory-safety-review":
      if (!playerModelOwned(state, event.modelId)) return [];
      return ["board-safety-review", "audit-pressure", "board-timeline-dispute"];
    case "model-incident": {
      if (!playerModelOwned(state, event.modelId)) return [];
      if (event.severity < 40) {
        return ["instruction-following-failure", "model-overconfidence"];
      }
      const policy = state.models[event.modelId]?.deployment.policy;
      const openish = policy === "open-api" || policy === "weights-release";
      const tags = ["jailbreak", "security-breach"];
      if (policy !== undefined && policy !== "research-preview") {
        tags.push("product-fire", "enterprise-data-breach");
      }
      if (event.severity >= 60 && openish) {
        tags.push("jailbreak-viral", "synthetic-media-crisis");
      }
      return tags;
    }
    case "model-deployment-changed": {
      if (event.labId !== playerLabId) return [];
      if (event.policy === "weights-release") {
        return ["open-model-debate", "release-policy"];
      }
      if (event.policy === "open-api") {
        const tags = ["release-policy", "live-demo"];
        if (lab !== undefined && scientificAiLevel(lab) >= 60) {
          tags.push("healthcare-deployment", "medical-opportunity");
        }
        return tags;
      }
      return [];
    }
    case "productisation-started":
      if (event.labId !== playerLabId) return [];
      return ["worker-consultation"];
    case "productisation-completed":
      if (event.labId !== playerLabId) return [];
      return event.productQuality < 45
        ? ["robot-demo-failure", "sim-to-real-gap"]
        : ["live-demo", "prototype-demo"];
    case "paper-discovered": {
      if (!event.worldFirst) return [];
      if (event.labId !== playerLabId) return ["rival-paper"];
      const scientific = Object.keys(
        content.papers.definitions[event.paperId]?.domainWeights ?? {},
      ).some((domainId) => domainId.endsWith("domain.scientific-ai"));
      return scientific
        ? [
            "science-demo-pressure",
            "scientific-ai-breakthrough",
            "experimental-validation",
          ]
        : ["experimental-validation"];
    }
    case "paper-publication-policy-chosen":
      if (event.policy === "keep-secret") return ["secret-paper"];
      return event.policy === "publish-openly" || event.policy === "release-everything"
        ? ["release-policy", "technical-explainer"]
        : ["release-policy"];
    case "serving-shortage":
      if (event.labId !== playerLabId) return [];
      return ["serving-crunch", "compute-shortage", "gpu-shortage"];
    case "gpu-lot-damaged":
      if (event.labId !== playerLabId) return [];
      return ["cluster-outage"];
    case "gpu-delivered":
      if (event.labId !== playerLabId) return [];
      return ["compute-windfall"];
    case "facility-completed":
      if (event.labId !== playerLabId) return [];
      return ["infrastructure-migration"];
    case "researcher-recruited":
      if (event.labId !== playerLabId) return [];
      return ["academia-industry-tension"];
    case "researcher-assigned":
      return state.researchers[event.researcherId]?.employerLabId === playerLabId &&
        event.targetId?.endsWith("domain.robotics-embodiment") === true
        ? ["robotics-team-reorg"]
        : [];
    case "researcher-poaching-rumour":
    case "researcher-poaching-counteroffer":
      return ["talent-poaching", "hiring-bottleneck"];
    case "researcher-departed":
      if (event.formerLabId !== playerLabId) return [];
      if (event.reason === "dismissed") return ["employee-dismissal-dispute"];
      return ["student-departure", "talent-poaching"];
    case "researcher-ultimatum-issued":
      return state.researchers[event.researcherId]?.employerLabId === playerLabId
        ? ["dissent-memo", "priority-dispute"]
        : [];
    case "generic-advance-offered":
      if (event.labId !== playerLabId) return [];
      return event.programId.endsWith("domain.architectures")
        ? [
            "depth-proposal",
            "legacy-architecture-debate",
            "recurrent-bottleneck",
            "sequence-memory",
          ]
        : [];
    case "generic-advance-chosen":
      if (event.labId !== playerLabId) return [];
      return programmeTags(event.programId, event.threshold);
    case "evaluation-completed":
      if (!playerModelOwned(state, event.modelId)) return [];
      if (event.automaticBaseline) return ["self-evaluation"];
      return evaluationTags(event.definitionId, event.anomalyCount);
    case "government-intervention-triggered":
      if (event.labId !== playerLabId) return [];
      return ["government-hearing", "audit-pressure"];
    case "government-programme-joined":
      if (event.labId !== playerLabId) return [];
      return ["institutional-partnership"];
    case "coalition-proposed":
      return ["coalition-overture"];
    case "coalition-betrayal-recorded":
      return ["coalition-friction"];
    case "coalition-ratified":
      return ["institutional-partnership"];
    case "rival-diplomacy-resolved":
      return ["strategic-game-negotiation"];
    case "decision-event-resolved":
      return event.optionId === "disclose" || event.optionId === "full-disclosure"
        ? ["voluntary-disclosure"]
        : [];
    case "world-phase-changed":
      return ["research-fad", "labour-transition-debate"];
    case "rival-public-signal":
      switch (event.signalKind) {
        case "benchmark":
          return ["architecture-race", "public-match"];
        case "release":
          return ["hype-cycle-peak", "media-viral-moment"];
        case "candidate":
        case "autonomy":
          return ["existential-risk-debate", "agi-declaration-pressure"];
        case "hire":
          return ["talent-poaching", "hiring-bottleneck"];
        case "incident":
          return ["existential-risk-debate"];
      }
      return [];
    case "rival-candidate-countdown-started":
    case "rival-candidate-final-year":
      return ["existential-risk-debate", "agi-declaration-pressure"];
    default:
      return [];
  }
}

/**
 * Standing conditions the player can already see on their own screens. These
 * are the few reactions with no single event moment: a visible gap between
 * capability and alignment progress, a starved safety allocation, and a
 * product build running past its quoted schedule. The per-tag cooldown is
 * what keeps a persistent condition from becoming a weekly lecture.
 */
function reactionTagsFromConditions(state: Readonly<GameState>): readonly string[] {
  const lab = playerLab(state);
  if (lab === undefined) return [];
  const tags: string[] = [];

  const modelId = lab.models.currentModelId;
  const measured =
    modelId === undefined
      ? undefined
      : state.models[modelId]?.measuredCapability?.frontierCapability;
  const alignmentLevel =
    Object.entries(lab.research.safetyPrograms).find(([programmeId]) =>
      programmeId.endsWith("safety.alignment-control"),
    )?.[1].level ?? 0;
  if (measured !== undefined && measured >= 50 && alignmentLevel <= measured - 25) {
    tags.push("alignment-schism");
  }

  const safetyShare = 1 - lab.compute.allocation.capabilityBasisPoints / 10_000;
  if (safetyShare < 0.1) tags.push("safety-budget-cut");

  const overdueProduct = Object.values(state.projects).some(
    (project) =>
      project.ownerLabId === lab.id &&
      project.kind === "productisation" &&
      project.status === "active" &&
      project.startedAt !== undefined &&
      state.run.tick - project.startedAt > project.expectedDurationWeeks + 1,
  );
  if (overdueProduct) tags.push("product-delay");

  return tags;
}

interface ReactionCandidate {
  readonly tag: string;
  readonly summary: string;
  readonly definitionId: string;
}

function reactionCandidates(
  state: Readonly<GameState>,
  content: CompiledContent,
  firedTags: ReadonlySet<string>,
): ReactionCandidate[] {
  const lab = playerLab(state);
  if (lab === undefined) return [];
  const spoken = new Set(
    state.decisionLog
      .filter((entry) => entry.category === "reaction")
      .map((entry) => entry.summary),
  );
  const candidates: ReactionCandidate[] = [];
  for (const researcherId of lab.roster.researcherIds) {
    const researcher = state.researchers[researcherId];
    if (researcher?.status !== "employed") continue;
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) continue;
    for (const reaction of definition.eventReactions) {
      if (!firedTags.has(reaction.triggerTag)) continue;
      const summary = `${definition.displayName}: “${reaction.line}”`;
      if (spoken.has(summary)) continue;
      candidates.push({
        tag: reaction.triggerTag,
        summary,
        definitionId: researcher.definitionId,
      });
    }
  }
  return candidates;
}

/**
 * One reaction per week at most: reactions are punctuation, not a chorus.
 * Per-tag cooldowns keep a noisy signal (weekly training checks, a poaching
 * saga) from turning the corridor into a broken record.
 */
export function advanceResearcherReactions(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const state = tx.read();
  const tick = state.run.tick;
  // No auto-pause gate, deliberately: the moments worth reacting to (a run
  // completing, a candidate detected, a tier reached) request an auto-pause in
  // the very tick they fire, and the reaction belongs to that week.
  if (state.run.status !== "active" || state.endgame.stage !== "inactive") {
    return;
  }
  const lab = playerLab(state);
  if (lab === undefined) return;
  // Reactions can arrive from a player command's transaction or the weekly
  // tick's; this cap keeps the corridor to one voice per week across both.
  if (reactionFlagTick(lab, "spoken") === tick) return;
  const rawTags = [
    ...tx
      .emittedEvents()
      .flatMap((event) => [...reactionTagsForEvent(state, content, event)]),
    ...reactionTagsFromConditions(state),
  ];
  const firedTags = new Set<string>();
  for (const tag of rawTags) {
    const lastAt = reactionFlagTick(lab, tag);
    if (lastAt !== undefined && tick - lastAt < REACTION_COOLDOWN_WEEKS) continue;
    firedTags.add(tag);
  }
  if (firedTags.size === 0) return;
  const candidates = reactionCandidates(state, content, firedTags);
  if (candidates.length === 0) return;
  const selected =
    candidates[
      random.integer(
        randomKey("reaction", "pick", String(tick)),
        0,
        candidates.length - 1,
      )
    ];
  if (selected === undefined) return;
  tx.update((draft) => {
    const mutableLab = draft.labs[draft.run.playerLabId];
    if (mutableLab !== undefined) {
      mutableLab.flags[`reaction:${selected.tag}:lastAt`] = tick;
      mutableLab.flags["reaction:spoken:lastAt"] = tick;
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: selected.summary,
      category: "reaction",
      source: { kind: "researcher", id: selected.definitionId },
      relatedIds: [selected.tag],
    });
  });
}
