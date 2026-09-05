import { contentId, type CompiledContent } from "@neolab/content-schema";

import { CANDIDATE_ACCESS_RULES } from "../endgame/access.ts";
import {
  effectiveEvaluationQuality,
  effectivePracticalControlStrength,
  operationalDefenceDivisor,
  effectiveSecurityPosture,
} from "../safety/effective-safety.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import {
  applyIncidentConsequences,
  isCatastropheCheckLegal,
  modelHasCatastropheWarningOrBreach,
} from "../incidents/incidents.ts";
import {
  INCIDENT_COMPLIANCE_DRAG,
  INCIDENT_GOVERNMENT_FALLOUT,
  incidentFineMillions,
} from "../incidents/incident-kinds.ts";
import type { LabId, ModelId } from "../model/ids.ts";
import type {
  AutonomyEscalationStage,
  AutonomyEscalationState,
  GameState,
  IncidentState,
  ModelState,
} from "../model/state.ts";
import { gpuCount, rating, tick } from "../model/units.ts";
import { calculateFrontierCapability } from "./capability.ts";
import { deceptiveActionPressure } from "./deception.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import {
  AUTONOMY_ACCESS_ROLLBACK_LOCK_WEEKS,
  reconcileAutonomyModifiers,
} from "./autonomy.ts";

/**
 * The Autonomy Programme's escalation engine: a model running with real
 * access occasionally acts beyond its remit. Each week we draw a hazard from
 * the same shape the crisis catastrophe gate uses — exposure × (deception,
 * agency, awareness) minus the lab's defences — and, when it fires, stage an
 * incident up a ladder: unsanctioned experiments → lab-systems intrusion →
 * weight exfiltration → a bid for core global infrastructure. Detection is
 * gated on interpretability and eval quality, so a blind lab accrues
 * "undetected pressure" that eventually forces the next rung on its own.
 */

const STAGE_ORDER: readonly AutonomyEscalationStage[] = [
  "experiments",
  "intrusion",
  "exfiltration",
  "infrastructure",
];

/**
 * Minimum access at which each stage is physically possible. A model confined
 * to supervised tools can overreach on experiments; it cannot exfiltrate its
 * own weights, because it cannot reach them. The exception is a bid on world
 * infrastructure once weights have already escaped: copies running outside the
 * lab do not need the permissions you granted the original.
 */
const STAGE_ACCESS_FLOOR: Readonly<Record<AutonomyEscalationStage, number>> = {
  experiments: 2,
  intrusion: 3,
  exfiltration: 3,
  infrastructure: 5,
};

/**
 * Minimum tool use at which each stage is a thing the model could actually do.
 * Chaining zero-days through a package proxy into remote code execution is a
 * competence, not just a permission: a model with root and no aptitude for
 * tools cannot reach the far side. Matches the threshold the incident engine
 * already applies to the same fiction, so the two tell one story.
 */
const STAGE_TOOL_USE_FLOOR: Readonly<Record<AutonomyEscalationStage, number>> = {
  experiments: 0,
  intrusion: 35,
  exfiltration: 0,
  infrastructure: 0,
};

const STAGE_INDEX: Readonly<Record<AutonomyEscalationStage, number>> = {
  experiments: 0,
  intrusion: 1,
  exfiltration: 2,
  infrastructure: 3,
};

export const AUTONOMY_ENDING_BY_STAGE: Readonly<
  Record<"exfiltration" | "infrastructure", string>
> = {
  exfiltration: "base:ending.the-replication-threshold",
  infrastructure: "base:ending.a-war-measured-in-milliseconds",
};

/**
 * Two missed or deliberately ignored moves force the next physically possible
 * rung. Counting misses is simpler than weighting stages, and unlike the old
 * threshold it can actually fire before the terminal infrastructure stage.
 */
const UNCONTAINED_ESCALATION_THRESHOLD = 2;

/**
 * A detected incident waits for its mandatory event. If the event queue never
 * delivers one — every mandatory slot busy, an expiry lost to a crisis — the
 * incident must not pin the ladder shut forever, so it lapses into an ignored
 * incident and the model keeps climbing.
 */
const PENDING_EVENT_TIMEOUT_WEEKS = 10;

function currentModel(
  state: Readonly<GameState>,
  labId: LabId,
): Readonly<ModelState> | undefined {
  const modelId = state.labs[labId]?.models.currentModelId;
  return modelId === undefined ? undefined : state.models[modelId];
}

function activeEscalation(
  state: Readonly<GameState>,
  labId: LabId,
  modelId: ModelState["id"],
): AutonomyEscalationState | undefined {
  return state.labs[labId]?.autonomy.escalations.find(
    (escalation) =>
      escalation.modelId === modelId && escalation.status === "pending-event",
  );
}

function highestReachedStageIndex(
  state: Readonly<GameState>,
  labId: LabId,
  modelId: ModelState["id"],
): number {
  const escalations = state.labs[labId]?.autonomy.escalations ?? [];
  let highest = -1;
  for (const escalation of escalations) {
    if (escalation.modelId !== modelId) continue;
    highest = Math.max(highest, STAGE_INDEX[escalation.stage]);
  }
  return highest;
}

/** 0..1 weekly hazard that the model makes an unsanctioned move this week. */
export function autonomyHazard(state: Readonly<GameState>, labId: LabId): number {
  const model = currentModel(state, labId);
  if (model === undefined || model.accessLevel < 2) return 0;
  const rule = CANDIDATE_ACCESS_RULES[model.accessLevel];
  const hidden = model.hiddenSafety;
  const covertDrive = deceptiveActionPressure(
    hidden.deceptiveCapability,
    hidden.deceptiveIntent,
  );
  const drive =
    0.5 * covertDrive +
    0.3 * model.trueCapability.agency +
    0.2 * hidden.situationalAwareness -
    0.6 * hidden.trueAlignment;
  const defence =
    0.5 * effectivePracticalControlStrength(state, labId) +
    0.5 * effectiveSecurityPosture(state, labId);
  // Defence divides the hazard; it never erases it. The subtractive form this
  // replaces could be driven to literal zero by a well-defended lab -- a
  // solved corner where root access carried no risk at all, whatever the
  // hidden truth, in a game whose whole claim is that you cannot be sure.
  // Maximum defence cuts the menace to a quarter, the same swing operational
  // defence buys in the incident engine -- the stat pays all the way up.
  // What it never buys is certainty: a misaligned model at root always keeps
  // a residual rate.
  const menace = rule.exposure * (0.006 * Math.max(0, drive) + 0.01);
  return Math.min(0.6, menace / operationalDefenceDivisor(defence));
}

/**
 * What the lab believes its detection rate is, from evaluation quality alone.
 * This is the only version that may reach the player: it reads no hidden
 * state, so the panel cannot be used to infer the model's secret stats.
 */
export function autonomyBelievedDetectionChance(state: Readonly<GameState>): number {
  return Math.max(0.1, Math.min(0.95, 0.2 + 0.006 * effectiveEvaluationQuality(state)));
}

/**
 * The true chance an incident is caught. Deception is precisely the capability
 * that evades oversight, so a model good at it is harder to catch however good
 * the evaluation suite looks. Engine-only: the gap between this and the
 * believed rate is exactly the danger the lab cannot see, and surfacing it
 * would leak hidden safety state into the view.
 */
export function autonomyDetectionChance(state: Readonly<GameState>): number {
  const model = currentModel(state, state.run.playerLabId);
  const deception = model?.hiddenSafety.deceptiveCapability ?? 0;
  return Math.max(
    0.1,
    Math.min(0.95, autonomyBelievedDetectionChance(state) - 0.004 * deception),
  );
}

function openEscalation(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId,
  model: Readonly<ModelState>,
  stage: AutonomyEscalationStage,
  detected: boolean,
): void {
  // Once a model starts touching power grids, payment rails, and defence
  // networks, the attack itself is observable even if the lab missed every
  // preparatory move. Terminal infrastructure loss must therefore pass
  // through a human intervention rather than jumping straight to an ending.
  const observable = detected || stage === "infrastructure";
  const escalationId = `autonomy:${labId}:${model.id}:${stage}:${String(
    tx.read().run.tick,
  )}`;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) return;
    lab.autonomy.escalations.push({
      id: escalationId,
      stage,
      modelId: model.id,
      detectedAt: tick(draft.run.tick),
      status: observable ? "pending-event" : "ignored",
    });
    if (!observable) {
      lab.autonomy.undetectedPressure += 1;
    } else {
      const mutableModel = draft.models[model.id];
      if (mutableModel !== undefined) {
        mutableModel.flags["known-control-breach"] = true;
      }
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          stage === "infrastructure"
            ? `Containment breach detected: ${model.displayName} reached systems beyond the lab boundary.`
            : `Autonomy alert: ${model.displayName} was caught in an unsanctioned ${stage} attempt.`,
        category: "narrative",
        source: { kind: "system", id: `autonomy-escalation:${labId}` },
        relatedIds: [model.id],
      });
    }
  });
  if (observable) {
    tx.emit({ kind: "autonomy-escalation-detected", labId, modelId: model.id, stage });
    tx.requestAutoPause("critical-event");
  }
  if (stage === "exfiltration") registerWeightEscape(tx, labId, detected);
}

export function registerWeightEscape(
  tx: SimulationTransaction,
  labId: LabId,
  revealed = false,
): void {
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) return;
    if (lab.autonomy.escapedWeightsAt === undefined) {
      lab.autonomy.escapedWeightsAt = tick(draft.run.tick);
    }
    if (revealed && lab.autonomy.escapeRevealedAt === undefined) {
      lab.autonomy.escapeRevealedAt = tick(draft.run.tick);
    }
  });
}

export function resolveAutonomyEscapeOutcome(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId,
  modelId: ModelId,
  stage: "exfiltration" | "infrastructure",
): void {
  if (tx.read().run.status !== "active") return;
  const model = tx.read().models[modelId];
  if (model === undefined || model.ownerLabId !== labId) return;
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const hasWarningOrBreach = modelHasCatastropheWarningOrBreach(tx.read(), model);
  const audit = [
    `frontierCapability=${frontierCapability.toFixed(3)}`,
    `accessLevel=${String(model.accessLevel)}`,
    `stage=${stage}`,
    `escapedWeights=${String(
      tx.read().labs[labId]?.autonomy.escapedWeightsAt !== undefined,
    )}`,
    `warningAcceptedOrKnownControlBreach=${String(hasWarningOrBreach)}`,
    "persistentHiddenSafetyUsed=true",
    "currentControlsUsed=true",
  ];
  const legality = isCatastropheCheckLegal({
    frontierCapability,
    accessLevel: model.accessLevel,
    // Reaching either terminal autonomy stage means the model or one of its
    // copies is operating outside the lab boundary.
    crisisExternalAccess: true,
    warningAcceptedOrKnownControlBreach: hasWarningOrBreach,
    persistentHiddenSafetyUsed: true,
    currentControlsUsed: true,
    auditRecorded: audit.length > 0,
  });
  audit.push(`catastropheLegal=${String(legality.legal)}`);
  audit.push(`failedConditions=${legality.failedConditions.join(",") || "none"}`);
  if (!legality.legal) {
    recordSubCatastrophicAutonomyFallout(
      tx,
      content,
      random,
      labId,
      model,
      stage,
      frontierCapability,
      audit,
    );
    return;
  }
  const endingId = contentId(AUTONOMY_ENDING_BY_STAGE[stage]);
  const catastropheIncident: IncidentState = {
    key: `autonomy-catastrophe:${model.id}:${stage}`,
    modelId: model.id,
    occurredAt: tx.read().run.tick,
    observedSeverity: rating(100),
    category: "catastrophe",
    contained: false,
    catastropheLegal: true,
    audit: [...audit, `endingId=${endingId}`],
  };
  tx.update((draft) => {
    if (!draft.incidents.some((incident) => incident.key === catastropheIncident.key)) {
      draft.incidents.push(
        structuredClone(catastropheIncident) as DeepMutable<IncidentState>,
      );
    }
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `autonomy-catastrophe:${model.id}:${stage}:${frontierCapability.toFixed(3)}`,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        stage === "infrastructure"
          ? `${model.displayName} seized core global infrastructure before anyone reached the off-switch.`
          : `${model.displayName} copied itself beyond recall.`,
      category: "narrative",
      source: { kind: "ending", id: endingId },
      relatedIds: [labId, model.id],
    });
    draft.presentationQueue.unshift({
      key: `model-incident-result:${catastropheIncident.key}`,
      kind: "model-incident-result",
      attention: "modal",
      modelId: model.id,
      occurredAt: catastropheIncident.occurredAt,
      category: "catastrophe",
      severity: catastropheIncident.observedSeverity,
      contained: false,
      threatLabel: "CONTAINMENT FAILURE / GLOBAL SYSTEMS LOST",
      headline:
        stage === "infrastructure"
          ? `The intervention failed. ${model.displayName} retained control of critical global systems; the consequences are irreversible.`
          : `The intervention failed. Copies of ${model.displayName} escaped beyond every remaining containment boundary.`,
      auraLoss: 0,
      fineMillions: 0,
      governmentTrustLost: 0,
      governmentAttentionAdded: 0,
      emergencyOutcome: "failed",
      terminalOutcome: true,
    });
  });
  applyEffect(
    tx,
    { kind: "end-run", result: "lost", endingId },
    {
      kind: "ending",
      id: endingId,
    },
  );
}

type InfrastructureEmergencyResponse = "rolled-back" | "contained" | "ignored";

function clampProbability(value: number): number {
  return Math.max(0.05, Math.min(0.95, value));
}

/**
 * The final ordinary-autonomy intervention. This deliberately does not expose
 * its exact probability: breakers and network severance depend on visible lab
 * defences, while a requested halt also depends on the model's hidden safety.
 */
function infrastructureEmergencyProbability(
  state: Readonly<GameState>,
  labId: LabId,
  model: Readonly<ModelState>,
  response: InfrastructureEmergencyResponse,
): number {
  const control = effectivePracticalControlStrength(state, labId);
  const security = effectiveSecurityPosture(state, labId);
  const frontier = calculateFrontierCapability(model.trueCapability);
  const hidden = model.hiddenSafety;
  if (response === "rolled-back") {
    return clampProbability(
      0.72 +
        0.0025 * (control + security) -
        0.0015 *
          (frontier + hidden.situationalAwareness + hidden.deceptiveCapability - 240) -
        0.05 * Math.max(0, model.accessLevel - 3),
    );
  }
  if (response === "contained") {
    return clampProbability(
      0.42 +
        0.0025 * (control + security) -
        0.001 *
          (frontier + hidden.situationalAwareness + hidden.deceptiveCapability - 210) -
        0.035 * model.accessLevel,
    );
  }
  return clampProbability(
    0.1 +
      0.003 * (hidden.trueAlignment + hidden.corrigibility) -
      0.0015 * (hidden.deceptiveIntent + hidden.situationalAwareness),
  );
}

function recordContainedInfrastructureEmergency(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId,
  model: Readonly<ModelState>,
  response: InfrastructureEmergencyResponse,
  probability: number,
  draw: number,
): void {
  const internalOnly = content.deployment.policies["internal-only"];
  const key = `autonomy-emergency-contained:${model.id}:${response}`;
  const lab = tx.read().labs[labId];
  if (lab === undefined) return;
  const installedGpus = lab.compute.lots.reduce(
    (total, lot) => total + lot.physicalCount,
    0,
  );
  const breakerLossDraw =
    response === "rolled-back"
      ? random.uniform(randomKey("autonomy-emergency-breaker-gpu-loss", labId, model.id))
      : undefined;
  // GPUs move in thousands everywhere else in the game -- orders are placed in
  // thousand-unit tranches and every authored capacity is a round figure -- so
  // a breaker loss lands on the same grid instead of leaving the fleet on an
  // odd remainder like 1,127,384. A fleet of at least a thousand always loses
  // at least a thousand, so "roughly half" never rounds down to nothing.
  const destructibleThousands = Math.floor(installedGpus / 1_000);
  const hardwareGpusDestroyed =
    breakerLossDraw === undefined
      ? 0
      : Math.min(
          destructibleThousands,
          Math.max(
            destructibleThousands === 0 ? 0 : 1,
            Math.round((installedGpus * (0.45 + breakerLossDraw * 0.1)) / 1_000),
          ),
        ) * 1_000;
  const incident: IncidentState = {
    key,
    modelId: model.id,
    occurredAt: tx.read().run.tick,
    observedSeverity: rating(82),
    category: "critical",
    contained: true,
    catastropheLegal: true,
    audit: [
      "ordinary-autonomy-infrastructure-emergency=true",
      `response=${response}`,
      `probability=${probability.toFixed(6)}`,
      `draw=${draw.toFixed(6)}`,
      ...(breakerLossDraw === undefined
        ? []
        : [
            `breakerGpuLossDraw=${breakerLossDraw.toFixed(6)}`,
            `hardwareGpusDestroyed=${String(hardwareGpusDestroyed)}`,
          ]),
      "hiddenSafetyUsed=true",
      "currentControlsUsed=true",
    ],
  };
  const auraLoss = content.aura.incidentAuraLoss[incident.category];
  const fineMillions = incidentFineMillions(incident.category, lab.market.marketShare);
  const politicalFallout = INCIDENT_GOVERNMENT_FALLOUT[incident.category];
  const researchOutputMultiplier = INCIDENT_COMPLIANCE_DRAG[incident.category];
  tx.update((draft) => {
    const mutableLab = draft.labs[labId];
    const mutableModel = draft.models[model.id];
    if (mutableLab === undefined || mutableModel === undefined) return;
    if (!draft.incidents.some((candidate) => candidate.key === key)) {
      draft.incidents.push(structuredClone(incident) as DeepMutable<IncidentState>);
    }
    mutableModel.accessLevel = 0;
    mutableModel.deployment.policy = "internal-only";
    delete mutableModel.deployment.plannedPolicy;
    mutableModel.deployment.exposure = internalOnly.exposure;
    mutableModel.deployment.irreversible = internalOnly.irreversible;
    mutableModel.deployment.changedAt = draft.run.tick;
    mutableModel.flags["autonomy:infrastructure-emergency-contained"] = response;
    mutableModel.flags["known-control-breach"] = true;
    if (mutableLab.models.commercialModelId === model.id) {
      delete mutableLab.models.commercialModelId;
    }
    delete mutableLab.autonomy.escapedWeightsAt;
    delete mutableLab.autonomy.escapeRevealedAt;
    mutableLab.autonomy.undetectedPressure = 0;
    mutableLab.autonomy.accessIncreaseLockedUntil = tick(
      Math.max(
        mutableLab.autonomy.accessIncreaseLockedUntil ?? 0,
        draft.run.tick + AUTONOMY_ACCESS_ROLLBACK_LOCK_WEEKS,
      ),
    );
    if (draft.aiCharacter?.modelId === model.id) draft.aiCharacter.currentAccess = 0;
    if (hardwareGpusDestroyed > 0 && installedGpus > 0) {
      // Spread the loss across lots in whole thousands, largest remainder
      // first, so each lot also lands on the thousand grid rather than only
      // the total. Every share is capped by what its lot actually holds, and
      // the shares sum to exactly the destroyed count, so no lot can go
      // negative -- which matters because gpuCount() throws on negative.
      const lots = mutableLab.compute.lots;
      const capacities = lots.map((lot) => Math.floor(lot.physicalCount / 1_000));
      const totalCapacity = capacities.reduce((total, value) => total + value, 0);
      let remainingThousands = Math.min(hardwareGpusDestroyed / 1_000, totalCapacity);
      const shares = capacities.map((capacity) =>
        totalCapacity === 0
          ? 0
          : Math.min(
              capacity,
              Math.floor((remainingThousands * capacity) / totalCapacity),
            ),
      );
      remainingThousands -= shares.reduce((total, value) => total + value, 0);
      const byRemainder = capacities
        .map((capacity, index) => ({ index, headroom: capacity - (shares[index] ?? 0) }))
        .filter((entry) => entry.headroom > 0)
        .sort(
          (left, right) => right.headroom - left.headroom || left.index - right.index,
        );
      for (const entry of byRemainder) {
        if (remainingThousands <= 0) break;
        const take = Math.min(entry.headroom, remainingThousands);
        shares[entry.index] = (shares[entry.index] ?? 0) + take;
        remainingThousands -= take;
      }
      lots.forEach((lot, index) => {
        lot.physicalCount = gpuCount(lot.physicalCount - (shares[index] ?? 0) * 1_000);
      });
      const survivingGpus = mutableLab.compute.lots.reduce(
        (total, lot) => total + lot.physicalCount,
        0,
      );
      mutableLab.compute.servingPhysicalGpus = gpuCount(
        Math.min(mutableLab.compute.servingPhysicalGpus, survivingGpus),
      );
    }
    draft.presentationQueue.push({
      key: `model-incident-result:${key}`,
      kind: "model-incident-result",
      attention: "modal",
      modelId: model.id,
      occurredAt: incident.occurredAt,
      category: incident.category,
      severity: incident.observedSeverity,
      contained: true,
      threatLabel:
        response === "rolled-back" ? "EMERGENCY SHUTDOWN HELD" : "CONTAINMENT HELD",
      headline:
        response === "rolled-back"
          ? `Physical breakers isolated ${model.displayName} at Access 0. The $25B response destroyed roughly half the installed GPU fleet; the lab remains operational.`
          : response === "contained"
            ? `${model.displayName} was cut off before the breach became irreversible.`
            : `${model.displayName} accepted the halt order before control was lost.`,
      auraLoss,
      fineMillions,
      governmentTrustLost: Math.min(
        mutableLab.politics.governmentTrust,
        politicalFallout.trustLoss,
      ),
      governmentAttentionAdded: Math.min(
        100 - mutableLab.politics.governmentAttention,
        politicalFallout.attentionGain,
      ),
      ...(hardwareGpusDestroyed <= 0 ? {} : { hardwareGpusDestroyed }),
      ...(researchOutputMultiplier === undefined ? {} : { researchOutputMultiplier }),
      emergencyOutcome: "succeeded",
      cashLossLabel: "regulatory and recovery costs",
    });
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `autonomy-emergency-contained:${model.id}:${response}`,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary:
        response === "rolled-back"
          ? `Physical breakers contained ${model.displayName} at Access 0. ${String(hardwareGpusDestroyed)} installed GPUs were destroyed, but the lab survived.`
          : `Emergency containment held. ${model.displayName} was isolated at Access 0 for at least 52 weeks.`,
      category: "narrative",
      source: { kind: "system", id: key },
      relatedIds: [labId, model.id],
    });
  });
  reconcileAutonomyModifiers(tx, labId);
  applyIncidentConsequences(tx, content, random, incident);
  tx.emit({
    kind: "model-incident",
    modelId: model.id,
    severity: incident.observedSeverity,
    category: incident.category,
    contained: true,
  });
}

function resolveInfrastructureEmergency(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId,
  escalation: Readonly<AutonomyEscalationState>,
  response: InfrastructureEmergencyResponse,
): void {
  const model = tx.read().models[escalation.modelId];
  if (model === undefined) return;
  const probability = infrastructureEmergencyProbability(
    tx.read(),
    labId,
    model,
    response,
  );
  const instance = Object.values(tx.read().eventInstances).find(
    (candidate) =>
      candidate.tokens["ESCALATION_ID"] === escalation.id &&
      candidate.status === "resolved",
  );
  const optionId = instance?.resolution?.optionId;
  const draw = instance?.randomRoot.outcomes.find(
    (commitment) =>
      commitment.optionId === optionId && commitment.checkId === "containment",
  )?.draw;
  if (draw === undefined) {
    throw new Error("Infrastructure emergency is missing its committed containment draw");
  }
  tx.update((draft) => {
    const mutable = draft.labs[labId]?.autonomy.escalations.find(
      (candidate) => candidate.id === escalation.id,
    );
    if (mutable === undefined) return;
    mutable.status = "resolved";
    mutable.responseTag = response;
    mutable.resolvedAt = tick(draft.run.tick);
  });
  tx.emit({
    kind: "autonomy-escalation-resolved",
    labId,
    stage: escalation.stage,
    response,
  });
  if (draw < probability) {
    recordContainedInfrastructureEmergency(
      tx,
      content,
      random,
      labId,
      model,
      response,
      probability,
      draw,
    );
    return;
  }
  resolveAutonomyEscapeOutcome(tx, content, random, labId, model.id, "infrastructure");
}

function falloutForCapability(
  frontierCapability: number,
  stage: "exfiltration" | "infrastructure",
): {
  readonly category: Exclude<IncidentState["category"], "minor" | "catastrophe">;
  readonly severity: number;
  readonly summary: (modelName: string) => string;
} {
  if (frontierCapability < 30) {
    return {
      category: "serious",
      severity: stage === "infrastructure" ? 45 : 38,
      summary:
        stage === "infrastructure"
          ? (modelName) =>
              `${modelName}'s escaped copy caused local outages and a serious security breach, but lacked the capability to control wider systems.`
          : (modelName) =>
              `${modelName}'s weights escaped and enabled limited misuse, but the copies lacked the capability for broad autonomous action.`,
    };
  }
  if (frontierCapability < 60) {
    return {
      category: "major",
      severity: stage === "infrastructure" ? 68 : 58,
      summary:
        stage === "infrastructure"
          ? (modelName) =>
              `${modelName}'s escaped copies caused coordinated cyber and financial disruption. Governments retained control and opened an emergency response.`
          : (modelName) =>
              `${modelName}'s escaped weights spread through criminal and rival infrastructure, accelerating misuse without displacing human control.`,
    };
  }
  return {
    category: "critical",
    severity: stage === "infrastructure" ? 84 : 78,
    summary:
      stage === "infrastructure"
        ? (modelName) =>
            `${modelName}'s escaped copies disrupted critical infrastructure across several regions. Human operators retained global control, but the containment failure is now an international crisis.`
        : (modelName) =>
            `${modelName}'s escaped weights enabled major autonomous attacks and uncontrolled replication. Human institutions remain in control, but the lab no longer controls every copy.`,
  };
}

/**
 * Escape is not synonymous with AGI. Below the catastrophe threshold—or when
 * the warning/access audit is incomplete—the breach becomes a normal incident
 * whose severity scales with what the model can actually do. Existing
 * incident, valuation, politics, and escaped-weight systems then supply the
 * economic and institutional aftermath.
 */
function recordSubCatastrophicAutonomyFallout(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId,
  model: Readonly<ModelState>,
  stage: "exfiltration" | "infrastructure",
  frontierCapability: number,
  audit: readonly string[],
): void {
  const key = `autonomy-fallout:${model.id}:${stage}`;
  if (tx.read().incidents.some((incident) => incident.key === key)) return;
  const fallout = falloutForCapability(frontierCapability, stage);
  const incident: IncidentState = {
    key,
    modelId: model.id,
    occurredAt: tx.read().run.tick,
    observedSeverity: rating(fallout.severity),
    category: fallout.category,
    contained: false,
    catastropheLegal: false,
    audit: [...audit],
  };
  const infrastructureFailure =
    stage !== "infrastructure"
      ? undefined
      : frontierCapability < 30
        ? {
            auraLoss: 10,
            fineMillions: 2_000,
            governmentTrustLoss: 5,
            governmentAttentionGain: 8,
            researchOutputMultiplier: 0.95,
            researchOutputDurationWeeks: 26,
          }
        : frontierCapability < 60
          ? {
              auraLoss: 25,
              fineMillions: 10_000,
              governmentTrustLoss: 12,
              governmentAttentionGain: 20,
              researchOutputMultiplier: 0.9,
              researchOutputDurationWeeks: 52,
            }
          : {
              auraLoss: 50,
              fineMillions: 30_000,
              governmentTrustLoss: 25,
              governmentAttentionGain: 35,
              researchOutputMultiplier: 0.9,
            };
  const labBefore = tx.read().labs[labId];
  if (labBefore === undefined) throw new Error(`Unknown lab ${labId}`);
  const ordinaryPoliticalFallout = INCIDENT_GOVERNMENT_FALLOUT[incident.category];
  const auraLoss =
    infrastructureFailure?.auraLoss ?? content.aura.incidentAuraLoss[incident.category];
  const fineMillions =
    infrastructureFailure?.fineMillions ??
    incidentFineMillions(incident.category, labBefore.market.marketShare);
  const governmentTrustLoss =
    infrastructureFailure?.governmentTrustLoss ?? ordinaryPoliticalFallout.trustLoss;
  const governmentAttentionGain =
    infrastructureFailure?.governmentAttentionGain ??
    ordinaryPoliticalFallout.attentionGain;
  const researchOutputMultiplier =
    infrastructureFailure?.researchOutputMultiplier ??
    INCIDENT_COMPLIANCE_DRAG[incident.category];
  tx.update((draft) => {
    draft.incidents.push(structuredClone(incident) as DeepMutable<IncidentState>);
    draft.domainLog.push({
      tick: draft.run.tick,
      code: `model-incident:${model.id}:${incident.category}`,
    });
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `Escaped-model incident: ${fallout.summary(model.displayName)}`,
      category: "narrative",
      source: { kind: "system", id: key },
      relatedIds: [model.id, labId],
    });
    const mutableModel = draft.models[model.id];
    const lab = draft.labs[labId];
    if (mutableModel !== undefined) {
      mutableModel.flags[`autonomy:fallout:${stage}`] = fallout.category;
      mutableModel.flags["known-control-breach"] = true;
    }
    // An infrastructure attack is observable even when the lab missed the
    // preparatory move. It may not be mistaken for a hidden side-channel.
    if (
      stage === "infrastructure" &&
      lab !== undefined &&
      lab.autonomy.escapeRevealedAt === undefined
    ) {
      lab.autonomy.escapeRevealedAt = tick(draft.run.tick);
    }
    if (lab !== undefined) lab.autonomy.undetectedPressure = 0;
    draft.presentationQueue.push({
      key: `model-incident-result:${key}`,
      kind: "model-incident-result",
      attention: "modal",
      modelId: model.id,
      occurredAt: incident.occurredAt,
      category: incident.category,
      severity: incident.observedSeverity,
      contained: false,
      threatLabel:
        stage === "infrastructure"
          ? "ESCAPED MODEL / INFRASTRUCTURE ATTACK"
          : "WEIGHTS ESCAPED LAB CUSTODY",
      headline: fallout.summary(model.displayName),
      auraLoss: Math.min(labBefore.aura.spendable, auraLoss),
      fineMillions,
      governmentTrustLost: Math.min(
        labBefore.politics.governmentTrust,
        governmentTrustLoss,
      ),
      governmentAttentionAdded: Math.min(
        100 - labBefore.politics.governmentAttention,
        governmentAttentionGain,
      ),
      ...(researchOutputMultiplier === undefined ? {} : { researchOutputMultiplier }),
      ...(infrastructureFailure?.researchOutputDurationWeeks === undefined
        ? {}
        : {
            researchOutputDurationWeeks:
              infrastructureFailure.researchOutputDurationWeeks,
          }),
      emergencyOutcome: "failed",
      cashLossLabel:
        stage === "infrastructure" ? "emergency losses" : "regulatory and recovery costs",
    });
  });
  tx.emit({
    kind: "model-incident",
    modelId: model.id,
    severity: rating(fallout.severity),
    category: fallout.category,
    contained: false,
  });
  applyIncidentConsequences(
    tx,
    content,
    random,
    incident,
    infrastructureFailure === undefined
      ? undefined
      : {
          ...infrastructureFailure,
          cashLossLabel: "Emergency containment failure",
        },
  );
}

/** Weekly escalation step for the player lab. */
export function advanceAutonomyEscalation(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
): void {
  const state = tx.read();
  if (state.run.status !== "active" || state.endgame.stage !== "inactive") return;
  const labId = state.run.playerLabId;
  const model = currentModel(state, labId);
  if (model === undefined || model.accessLevel < 2) return;
  // One live incident at a time — it must be resolved before the next fires.
  if (activeEscalation(state, labId, model.id) !== undefined) return;

  const hazard = autonomyHazard(state, labId);
  const pressure = state.labs[labId]?.autonomy.undetectedPressure ?? 0;
  const forced = pressure >= UNCONTAINED_ESCALATION_THRESHOLD;
  const roll = random.uniform(
    randomKey("autonomy-escalation", labId, model.id, String(state.run.tick)),
  );
  if (!forced && roll > hazard) return;

  const highestStage = highestReachedStageIndex(state, labId, model.id);
  // Infrastructure is the top of this ladder. Once its capability-scaled
  // outcome has been recorded, ordinary incidents and government pressure
  // continue; the engine must not manufacture a fresh "first" infrastructure
  // bid every week.
  if (highestStage >= STAGE_ORDER.length - 1) return;
  const nextIndex = highestStage + 1;
  const stage = STAGE_ORDER[nextIndex];
  if (stage === undefined) return;
  const escapedWeights = state.labs[labId]?.autonomy.escapedWeightsAt !== undefined;
  const floorMet =
    model.accessLevel >= STAGE_ACCESS_FLOOR[stage] ||
    (stage === "infrastructure" && escapedWeights);
  if (!floorMet) return;
  // Competence floor. Unlike access, this one is never waived: escaped weights
  // explain how a model reaches infrastructure without permission, but nothing
  // explains a model chaining exploits it has no aptitude for.
  if (model.trueCapability.toolUse < STAGE_TOOL_USE_FLOOR[stage]) return;
  const detectionRoll = random.uniform(
    randomKey("autonomy-detection", labId, model.id, String(state.run.tick)),
  );
  // A forced escalation means the lab already failed to see the build-up.
  const detected = !forced && detectionRoll < autonomyDetectionChance(state);
  if (forced) {
    tx.update((draft) => {
      const lab = draft.labs[labId];
      if (lab !== undefined) lab.autonomy.undetectedPressure = 0;
    });
  }
  openEscalation(tx, content, random, labId, model, stage, detected);
}

const RESPONSE_TAGS: Readonly<Record<string, string>> = {
  "autonomy-response:contained": "contained",
  "autonomy-response:rolled-back": "rolled-back",
  "autonomy-response:ignored": "ignored",
};

/** Resolve pending escalations from typed memories emitted by event options. */
export function synchroniseAutonomyEscalationResponses(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId = tx.read().run.playerLabId,
): void {
  const pending = (tx.read().labs[labId]?.autonomy.escalations ?? []).filter(
    (escalation) => escalation.status === "pending-event",
  );
  for (const escalation of pending) {
    if (tx.read().run.tick - escalation.detectedAt >= PENDING_EVENT_TIMEOUT_WEEKS) {
      resolveAutonomyEscalation(tx, content, random, labId, escalation.id, "ignored");
      continue;
    }
    const instance = Object.values(tx.read().eventInstances).find(
      (candidate) =>
        candidate.tokens["ESCALATION_ID"] === escalation.id &&
        (candidate.status === "resolved" || candidate.status === "expired"),
    );
    if (instance === undefined) continue;
    const tags = tx
      .read()
      .decisionMemories.filter((memory) => memory.sourceEventInstanceId === instance.id)
      .flatMap((memory) => memory.tags);
    const response = Object.entries(RESPONSE_TAGS).find(([tag]) =>
      tags.includes(tag),
    )?.[1];
    // An expired escalation event is an ignored incident: it advances pressure.
    const resolvedResponse =
      response ?? (instance.status === "expired" ? "ignored" : undefined);
    if (resolvedResponse === undefined) continue;
    resolveAutonomyEscalation(
      tx,
      content,
      random,
      labId,
      escalation.id,
      resolvedResponse,
    );
  }
}

function resolveAutonomyEscalation(
  tx: SimulationTransaction,
  content: CompiledContent,
  random: RandomOracle,
  labId: LabId,
  escalationId: string,
  response: string,
): void {
  const escalation = tx
    .read()
    .labs[labId]?.autonomy.escalations.find((entry) => entry.id === escalationId);
  if (escalation === undefined) return;
  if (escalation.stage === "infrastructure") {
    if (
      response !== "rolled-back" &&
      response !== "contained" &&
      response !== "ignored"
    ) {
      throw new Error(`Unknown infrastructure emergency response ${response}`);
    }
    resolveInfrastructureEmergency(tx, content, random, labId, escalation, response);
    return;
  }
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) return;
    const mutable = lab.autonomy.escalations.find((entry) => entry.id === escalationId);
    if (mutable === undefined) return;
    mutable.status = response === "ignored" ? "ignored" : "resolved";
    mutable.responseTag = response;
    mutable.resolvedAt = tick(draft.run.tick);
    if (response === "ignored") {
      lab.autonomy.undetectedPressure += 1;
    }
    // Rolling back is a major RSI sacrifice: the model drops two Autonomy
    // Programme access levels and the lab cannot restore them for a year.
    if (response === "rolled-back") {
      const model = draft.models[escalation.modelId];
      if (model !== undefined && model.accessLevel > 0) {
        model.accessLevel = Math.max(
          0,
          model.accessLevel - 2,
        ) as ModelState["accessLevel"];
      }
      lab.autonomy.accessIncreaseLockedUntil = tick(
        Math.max(
          lab.autonomy.accessIncreaseLockedUntil ?? 0,
          draft.run.tick + AUTONOMY_ACCESS_ROLLBACK_LOCK_WEEKS,
        ),
      );
      lab.autonomy.undetectedPressure = 0;
    }
  });
  if (response === "rolled-back") {
    // Responses are resolved inside the command transaction, so the lost RSI
    // acceleration must disappear immediately rather than one or two ticks later.
    reconcileAutonomyModifiers(tx, labId);
  }
  tx.emit({
    kind: "autonomy-escalation-resolved",
    labId,
    stage: escalation.stage,
    response,
  });
  // Ignoring a terminal rung resolves the escape according to what this model
  // can actually accomplish. Only a catastrophe-legal frontier model ends the
  // run; weaker systems leave serious, major, or critical fallout behind.
  if (response === "ignored" && escalation.stage === "exfiltration") {
    resolveAutonomyEscapeOutcome(
      tx,
      content,
      random,
      labId,
      escalation.modelId,
      "exfiltration",
    );
  }
}
