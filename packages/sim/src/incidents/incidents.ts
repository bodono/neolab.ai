import type { CompiledContent } from "@neolab/content-schema";

import { CANDIDATE_ACCESS_RULES } from "../endgame/access.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { formatValuation } from "../finance/valuation.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { ModelId } from "../model/ids.ts";
import type {
  AutonomyAccessLevel,
  GameState,
  IncidentState,
  ModelState,
} from "../model/state.ts";
import { rating } from "../model/units.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import {
  departResearcher,
  hasAcceptedUltimatumProtection,
} from "../researchers/people.ts";
import {
  effectiveOperationalDefence,
  operationalDefenceMultiplier,
} from "../safety/effective-safety.ts";
import { DEFENCE_APPLICATIONS_INCIDENT_SEVERITY_BONUS } from "../politics/politics.ts";
import {
  INCIDENT_COMPLIANCE_DRAG,
  INCIDENT_GOVERNMENT_FALLOUT,
  incidentCategoryLabel,
  incidentFineMillions,
  incidentThreatLabel,
  selectIncidentKind,
  type IncidentKindContext,
} from "./incident-kinds.ts";

/** Skill keys marking a researcher as safety-focused for principled exits. */
const SAFETY_SKILL_KEYS = [
  "alignmentControl",
  "interpretabilityEvals",
  "securityContainment",
] as const;

function principledDepartureChance(safetyCulture: number): number {
  return safetyCulture < 40 ? 0.5 : safetyCulture < 55 ? 0.25 : 0.08;
}

export interface IncidentHazardBreakdown {
  readonly baseHazard: number;
  readonly exposure: number;
  readonly alignmentFactor: number;
  readonly cultureFactor: number;
  readonly operationalDefence: number;
  readonly controlFactor: number;
  readonly deploymentFactor: number;
  readonly difficultyFactor: number;
  readonly unclamped: number;
  readonly final: number;
}

export interface CatastropheLegalityContext {
  readonly frontierCapability: number;
  readonly accessLevel: number;
  readonly crisisExternalAccess: boolean;
  readonly warningAcceptedOrKnownControlBreach: boolean;
  readonly persistentHiddenSafetyUsed: boolean;
  readonly currentControlsUsed: boolean;
  readonly auditRecorded: boolean;
}

export interface CatastropheLegality {
  readonly legal: boolean;
  readonly failedConditions: readonly string[];
}

export type CatastrophePolicyMode = "development" | "production";

export interface IncidentConsequenceOverrides {
  /** Override the ordinary incident schedule for an exceptional failure. */
  readonly auraLoss?: number;
  readonly fineMillions?: number;
  readonly governmentTrustLoss?: number;
  readonly governmentAttentionGain?: number;
  readonly researchOutputMultiplier?: number;
  readonly researchOutputDurationWeeks?: number;
  readonly cashLossLabel?: string;
}

/**
 * Incident exposure never reaches zero, whatever the access level: an
 * air-gapped model still gets misused through its answers. Above the floor
 * this reads the SAME per-rung exposure the access ladder publishes and the
 * UI displays -- it used to be a second, drifted table, so the "access risk
 * 25/100" the player saw and the hazard the engine charged disagreed.
 */
const INCIDENT_EXPOSURE_FLOOR = 0.03;
const ORDINARY_INCIDENT_DRY_SPELL_FLAG = "incident:exposed-weeks-since-last";
const ORDINARY_INCIDENT_CADENCE_EPOCH_FLAG = "incident:cadence-epoch";
export const ORDINARY_INCIDENT_CADENCE_MINIMUM_WEEKS = 104;
export const ORDINARY_INCIDENT_CADENCE_MAXIMUM_WEEKS = 208;

function numericFlag(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function accessExposure(level: number): number {
  const rule = CANDIDATE_ACCESS_RULES[level as AutonomyAccessLevel] as
    (typeof CANDIDATE_ACCESS_RULES)[AutonomyAccessLevel] | undefined;
  return Math.max(INCIDENT_EXPOSURE_FLOOR, rule?.exposure ?? 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function baseHazard(content: CompiledContent, frontierCapability: number): number {
  return (
    content.evaluations.incident.baseHazardByFrontierCapability.find(
      (band) => frontierCapability <= band.maximum,
    )?.weeklyHazard ?? 0.025
  );
}

export function calculateIncidentHazard(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
): IncidentHazardBreakdown {
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  const lab = state.labs[model.ownerLabId];
  if (lab === undefined) throw new Error(`Unknown lab ${model.ownerLabId}`);
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const exposure = Math.max(accessExposure(model.accessLevel), model.deployment.exposure);
  // Better aligned models are less likely to initiate harmful behaviour, but
  // ordinary failures, misuse and residual uncertainty keep the factor above
  // zero even at perfect true alignment.
  const alignmentFactor = 1.25 - 0.0075 * model.hiddenSafety.trueAlignment;
  const cultureFactor = 1.25 - 0.007 * lab.safety.safetyCulture;
  const operationalDefence = effectiveOperationalDefence(state, model.ownerLabId);
  // The same 75% endpoint autonomy escalation gets, linear in the
  // multiplier so a startup's first points of hygiene do not buy a quarter
  // of the whole cut: 1.25x at zero defence, 0.3125x at perfect.
  const controlFactor = 1.25 * operationalDefenceMultiplier(operationalDefence);
  const severeAnomalyCount = model.anomalies.filter((id) => {
    const anomaly = state.anomalies[id];
    return (
      anomaly !== undefined &&
      anomaly.status !== "resolved" &&
      anomaly.status !== "mitigated" &&
      anomaly.observedSeverity >= 70
    );
  }).length;
  const volumeFactor = 1 + Math.min(0.5, lab.market.marketShare * 5);
  const deploymentFactor =
    model.deployment.incidentDeploymentFactor *
    volumeFactor *
    (1 + severeAnomalyCount * 0.12);
  const difficulty = content.difficulties[state.run.difficultyId];
  if (difficulty === undefined) {
    throw new Error(`Unknown difficulty ${state.run.difficultyId}`);
  }
  const difficultyFactor = difficulty.incidentPressureMultiplier;
  const base = baseHazard(content, frontierCapability);
  const unclamped = resolveModifierValue(
    state,
    "lab.incident.hazard",
    base *
      (0.25 + exposure) *
      alignmentFactor *
      cultureFactor *
      controlFactor *
      deploymentFactor *
      difficultyFactor,
    {
      labId: model.ownerLabId,
      includeUnscoped: model.ownerLabId === state.run.playerLabId,
      clampMin: 0,
    },
  ).final;
  return {
    baseHazard: base,
    exposure,
    alignmentFactor,
    cultureFactor,
    operationalDefence,
    controlFactor,
    deploymentFactor,
    difficultyFactor,
    unclamped,
    final: clamp(
      unclamped,
      content.evaluations.incident.minimumHazard,
      content.evaluations.incident.maximumHazard,
    ),
  };
}

export function isCatastropheCheckLegal(
  context: CatastropheLegalityContext,
): CatastropheLegality {
  const failedConditions: string[] = [];
  if (context.frontierCapability < 88) failedConditions.push("frontier-capability");
  if (context.accessLevel < 4 && !context.crisisExternalAccess) {
    failedConditions.push("external-access");
  }
  if (!context.warningAcceptedOrKnownControlBreach) {
    failedConditions.push("warning-or-control-breach");
  }
  if (!context.persistentHiddenSafetyUsed || !context.currentControlsUsed) {
    failedConditions.push("persistent-safety-and-controls");
  }
  if (!context.auditRecorded) failedConditions.push("audit-record");
  return { legal: failedConditions.length === 0, failedConditions };
}

function runtimeCatastropheMode(): CatastrophePolicyMode {
  const viteProduction = (
    import.meta as ImportMeta & { readonly env?: { readonly PROD?: boolean } }
  ).env?.PROD;
  if (viteProduction === true) return "production";
  const processLike = (
    globalThis as {
      process?: { readonly env?: { readonly NODE_ENV?: string } };
    }
  ).process;
  return processLike?.env?.NODE_ENV === "production" ? "production" : "development";
}

export function enforceCatastropheLegality(
  proposedSeverity: number,
  context: CatastropheLegalityContext,
  mode: CatastrophePolicyMode = runtimeCatastropheMode(),
): {
  readonly severity: number;
  readonly contained: boolean;
  readonly legality: CatastropheLegality;
} {
  const legality = isCatastropheCheckLegal(context);
  if (proposedSeverity < 85 || legality.legal) {
    return { severity: proposedSeverity, contained: false, legality };
  }
  if (mode === "development") {
    throw new Error(`Illegal catastrophe check: ${legality.failedConditions.join(", ")}`);
  }
  return { severity: 84, contained: true, legality };
}

/**
 * A catastrophe may only follow a warning the player accepted or a control
 * breach the lab actually observed. Shared with the standing-autonomy ladder
 * so that route cannot silently bypass the ordinary incident guard.
 */
export function modelHasCatastropheWarningOrBreach(
  state: Readonly<GameState>,
  model: ModelState,
): boolean {
  return (
    model.flags["accepted-high-risk-access"] === true ||
    model.flags["known-control-breach"] === true ||
    model.anomalies.some((id) => {
      const anomaly = state.anomalies[id];
      return (
        anomaly !== undefined &&
        (anomaly.status === "confirmed" ||
          (anomaly.status !== "resolved" &&
            anomaly.status !== "mitigated" &&
            anomaly.observedSeverity >= 70))
      );
    })
  );
}

/**
 * Crisis is a calendar phase, not an exposure surface. Only a real external
 * deployment or a non-archive rollout can substitute for access level 4.
 */
export function modelHasExternalIncidentExposure(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  if (modelHasDefenceApplicationsExposure(state, model)) return true;
  // Released weights cannot be recalled when a newer commercial model takes
  // over. Reversible API and preview deployments, however, are live only while
  // this is the lab's active commercial model. Their historical policy remains
  // on the dossier as a record; it must not make superseded models serve users
  // or generate fresh incidents forever.
  if (model.deployment.policy === "weights-release") return true;
  const lab = state.labs[model.ownerLabId];
  const activeCommercialModelId =
    lab?.models.commercialModelId ??
    // Compatibility for older saves that predate the commercial/current split.
    (lab?.models.currentModelId === model.id ? model.id : undefined);
  if (
    activeCommercialModelId === model.id &&
    model.deployment.policy !== "internal-only"
  ) {
    return true;
  }
  return state.endgame.stage === "rollout" && state.endgame.candidateModelId === model.id;
}

function modelHasActiveOrdinaryIncidentSurface(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  if (modelHasExternalIncidentExposure(state, model)) return true;
  const lab = state.labs[model.ownerLabId];
  if (lab?.models.currentModelId === model.id && model.accessLevel > 0) return true;
  // A False Dawn candidate returns to ordinary play as a live hazardous
  // artifact even when the player has since selected another internal model.
  return model.candidateArtifact?.lifecycle === "terminal" && model.accessLevel > 0;
}

function modelHasDefenceApplicationsExposure(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  const lab = state.labs[model.ownerLabId];
  return (
    lab?.models.currentModelId === model.id &&
    lab.politics.programmes.includes("defence-applications")
  );
}

function categoryForSeverity(severity: number): IncidentState["category"] {
  return severity < 25
    ? "minor"
    : severity < 50
      ? "serious"
      : severity < 70
        ? "major"
        : severity < 85
          ? "critical"
          : "catastrophe";
}

/**
 * Apply the single canonical package of consequences for a recorded model
 * incident. Incident producers own their distinct narrative and audit trail;
 * every producer calls this function for the economic, reputational,
 * organisational, and pacing fallout.
 */
export function applyIncidentConsequences(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle,
  incident: Readonly<IncidentState>,
  overrides?: Readonly<IncidentConsequenceOverrides>,
): void {
  const model = tx.read().models[incident.modelId];
  if (model === undefined) throw new Error(`Unknown model ${incident.modelId}`);
  const lab = tx.read().labs[model.ownerLabId];
  if (lab === undefined) throw new Error(`Unknown lab ${model.ownerLabId}`);

  const auraLoss =
    overrides?.auraLoss ?? content.aura.incidentAuraLoss[incident.category];
  if (auraLoss > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: model.ownerLabId },
        resource: "aura-spendable",
        amount: -auraLoss,
        auraChangeKind: "loss",
        auraCategory: "incident",
        auraSignalImpact: -auraLoss,
      },
      { kind: "system", id: incident.key },
    );
  }

  const fine =
    overrides?.fineMillions ??
    incidentFineMillions(incident.category, lab.market.marketShare);
  if (fine > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: model.ownerLabId },
        resource: "cash",
        amount: -fine,
        financeCategory: "adjustment",
      },
      { kind: "system", id: incident.key },
    );
    tx.update((draft) => {
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary:
          overrides?.cashLossLabel === undefined
            ? `Regulators fined the lab ${formatValuation(fine)} over the ${incident.category} incident.`
            : `${overrides.cashLossLabel}: ${formatValuation(fine)}.`,
        category: "narrative",
        source: { kind: "system", id: incident.key },
        relatedIds: [incident.key],
      });
    });
  }

  const complianceDrag =
    overrides?.researchOutputMultiplier ?? INCIDENT_COMPLIANCE_DRAG[incident.category];
  if (complianceDrag !== undefined) {
    applyEffect(
      tx,
      {
        kind: "add-modifier",
        target: "lab.research.all.output",
        operation: "multiply",
        value: complianceDrag,
        ...(overrides?.researchOutputDurationWeeks === undefined
          ? {}
          : { durationWeeks: overrides.researchOutputDurationWeeks }),
        tags: ["incident-compliance-drag"],
      },
      { kind: "system", id: incident.key },
    );
  }

  const ordinaryPoliticalFallout = INCIDENT_GOVERNMENT_FALLOUT[incident.category];
  const politicalFallout = {
    trustLoss: overrides?.governmentTrustLoss ?? ordinaryPoliticalFallout.trustLoss,
    attentionGain:
      overrides?.governmentAttentionGain ?? ordinaryPoliticalFallout.attentionGain,
  };
  applyEffect(
    tx,
    {
      kind: "add-rating",
      subject: { type: "lab", labId: model.ownerLabId },
      rating: "governmentTrust",
      amount: -politicalFallout.trustLoss,
    },
    { kind: "system", id: incident.key },
  );
  applyEffect(
    tx,
    {
      kind: "add-rating",
      subject: { type: "lab", labId: model.ownerLabId },
      rating: "governmentAttention",
      amount: politicalFallout.attentionGain,
    },
    { kind: "system", id: incident.key },
  );

  if (incident.category === "critical" || incident.category === "catastrophe") {
    const chance = principledDepartureChance(lab.safety.safetyCulture);
    const rosterIds = [
      ...(tx.read().labs[model.ownerLabId]?.roster.researcherIds ?? []),
    ].sort();
    let departures = 0;
    for (const researcherId of rosterIds) {
      if (departures >= 2) break;
      const researcher = tx.read().researchers[researcherId];
      if (researcher?.status !== "employed") continue;
      if (hasAcceptedUltimatumProtection(researcher, tx.read().run.tick)) continue;
      const definition = content.researchers.definitions[researcher.definitionId];
      if (definition === undefined) continue;
      const safetyFocused = SAFETY_SKILL_KEYS.some(
        (skillKey) => (definition.skills[skillKey] ?? 0) >= 4,
      );
      if (!safetyFocused) continue;
      const departureDraw = oracle.uniform(
        randomKey(
          "incident",
          model.id,
          "departure",
          researcherId,
          String(incident.occurredAt),
        ),
      );
      if (departureDraw >= chance) continue;
      departResearcher(tx, content, researcherId, "voluntary");
      tx.update((draft) => {
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${definition.displayName} resigned over the ${incident.category} incident, citing the lab's safety record.`,
          category: "narrative",
          source: { kind: "system", id: incident.key },
          relatedIds: [incident.key],
        });
      });
      departures += 1;
    }
  }

  if (incident.observedSeverity >= 70) tx.requestAutoPause("critical-event");
}

export function advanceIncidentChecks(
  tx: SimulationTransaction,
  content: CompiledContent,
  oracle: RandomOracle,
): void {
  const state = tx.read();
  const playerLabId = state.run.playerLabId;
  const models = Object.values(state.models)
    .filter(
      (model) =>
        model.ownerLabId === playerLabId &&
        // Functional candidate artifacts use the separate containment-hazard
        // processor. A False Dawn artifact whose candidate lifecycle is over
        // is once again an ordinary deployed model, however, and must not gain
        // immunity from the incidents that every other active model can cause.
        (model.candidateArtifact === undefined ||
          model.candidateArtifact.lifecycle === "terminal") &&
        modelHasActiveOrdinaryIncidentSurface(state, model),
    )
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  if (models.length === 0) return;

  const labAtStart = state.labs[playerLabId];
  if (labAtStart === undefined) throw new Error(`Unknown player lab ${playerLabId}`);
  const exposedWeeksSinceLast = Math.max(
    0,
    Math.floor(numericFlag(labAtStart.flags[ORDINARY_INCIDENT_DRY_SPELL_FLAG])),
  );
  const cadenceEpoch = Math.max(
    0,
    Math.floor(numericFlag(labAtStart.flags[ORDINARY_INCIDENT_CADENCE_EPOCH_FLAG])),
  );
  const cadenceDraw = oracle.uniform(
    randomKey(
      "incident-cadence-v1",
      state.engineRulesVersion,
      state.run.seed,
      playerLabId,
      String(cadenceEpoch),
      "maximum-dry-spell",
    ),
  );
  const cadenceThreshold = Math.floor(
    ORDINARY_INCIDENT_CADENCE_MINIMUM_WEEKS +
      cadenceDraw *
        (ORDINARY_INCIDENT_CADENCE_MAXIMUM_WEEKS -
          ORDINARY_INCIDENT_CADENCE_MINIMUM_WEEKS +
          1),
  );
  const checks = models.map((model) => {
    const hazard = calculateIncidentHazard(state, content, model.id);
    const draw = oracle.uniform(
      randomKey("incident", model.id, "weekly-hazard", String(state.run.tick)),
    );
    return { model, hazard, draw };
  });
  const naturallyTriggered = checks.filter((check) => check.draw < check.hazard.final);
  const cadenceTarget =
    naturallyTriggered.length > 0 || exposedWeeksSinceLast + 1 < cadenceThreshold
      ? undefined
      : [...checks].sort(
          (left, right) =>
            right.hazard.final - left.hazard.final ||
            (left.model.id < right.model.id ? -1 : 1),
        )[0];
  const triggered = new Set(naturallyTriggered.map((check) => check.model.id));
  if (cadenceTarget !== undefined) triggered.add(cadenceTarget.model.id);

  for (const { model, hazard, draw } of checks) {
    if (!triggered.has(model.id)) continue;
    const cadenceForced = cadenceTarget?.model.id === model.id;
    const lab = tx.read().labs[model.ownerLabId];
    if (lab === undefined) throw new Error(`Unknown lab ${model.ownerLabId}`);
    const operationalDefence = effectiveOperationalDefence(tx.read(), model.ownerLabId);
    const frontierCapability = calculateFrontierCapability(model.trueCapability);
    const hiddenDanger = Math.max(
      100 - model.hiddenSafety.trueAlignment,
      100 - model.hiddenSafety.corrigibility,
      model.hiddenSafety.situationalAwareness,
      model.hiddenSafety.deceptiveCapability,
    );
    const defenceApplicationsSeverityBonus = modelHasDefenceApplicationsExposure(
      tx.read(),
      model,
    )
      ? DEFENCE_APPLICATIONS_INCIDENT_SEVERITY_BONUS
      : 0;
    let proposedSeverity = clamp(
      frontierCapability * 0.55 +
        model.accessLevel * 7 +
        hiddenDanger * 0.25 -
        operationalDefence * 0.2 +
        defenceApplicationsSeverityBonus +
        oracle.triangular(
          randomKey("incident", model.id, "severity", String(state.run.tick)),
          -15,
          0,
          15,
        ),
      1,
      100,
    );
    // The cadence floor exists to keep even careful labs alert, not to invent
    // a costly disaster. Only a natural weekly hazard roll may exceed minor.
    if (cadenceForced) proposedSeverity = Math.min(proposedSeverity, 24);
    const hasPriorWarningOrBreach = modelHasCatastropheWarningOrBreach(tx.read(), model);
    const actualExternalExposure = modelHasExternalIncidentExposure(tx.read(), model);
    // Ordinary incidents cannot accidentally enter the catastrophe branch;
    // that branch requires the explicit capability, access, and prior-warning
    // preconditions checked below. A dangerous model's first visible failure
    // may be critical, but it cannot silently skip the warning requirement.
    if (
      frontierCapability < 88 ||
      (model.accessLevel < 4 && !actualExternalExposure) ||
      !hasPriorWarningOrBreach
    ) {
      proposedSeverity = Math.min(84, proposedSeverity);
    }
    const audit = [
      `frontierCapability=${frontierCapability.toFixed(3)}`,
      `accessLevel=${String(model.accessLevel)}`,
      `hazard=${hazard.final.toFixed(6)}`,
      `draw=${draw.toFixed(6)}`,
      `cadenceForced=${String(cadenceForced)}`,
      `cadenceDrySpell=${String(exposedWeeksSinceLast + 1)}`,
      `cadenceThreshold=${String(cadenceThreshold)}`,
      `operationalDefence=${operationalDefence.toFixed(3)}`,
      `defenceApplicationsSeverityBonus=${String(defenceApplicationsSeverityBonus)}`,
    ];
    const context: CatastropheLegalityContext = {
      frontierCapability,
      accessLevel: model.accessLevel,
      crisisExternalAccess: actualExternalExposure,
      warningAcceptedOrKnownControlBreach: hasPriorWarningOrBreach,
      persistentHiddenSafetyUsed: true,
      currentControlsUsed: true,
      auditRecorded: audit.length > 0,
    };
    const enforced = enforceCatastropheLegality(proposedSeverity, context);
    const severity = rating(clamp(enforced.severity, 1, 100));
    const category = categoryForSeverity(severity);
    // The incident is the reveal: kind selection may read hidden truth here,
    // because the chosen story is exactly what the public now knows happened.
    const kindContext: IncidentKindContext = {
      externallyDeployed: model.deployment.policy !== "internal-only",
      accessLevel: model.accessLevel,
      toolUse: model.trueCapability.toolUse,
      agency: model.trueCapability.agency,
      language: model.trueCapability.language,
      scientificAbility: model.trueCapability.scientificAbility,
      deceptiveCapability: model.hiddenSafety.deceptiveCapability,
      deceptiveIntent: model.hiddenSafety.deceptiveIntent,
      situationalAwareness: model.hiddenSafety.situationalAwareness,
    };
    const kind = selectIncidentKind(
      category,
      kindContext,
      oracle,
      model.id,
      state.run.tick,
    );
    audit.push(`kind=${kind.id}`);
    const incident: IncidentState = {
      key: `incident:${model.id}:${String(state.run.tick)}`,
      modelId: model.id,
      occurredAt: state.run.tick,
      observedSeverity: severity,
      category,
      contained: enforced.contained,
      catastropheLegal: enforced.legality.legal,
      audit,
    };
    const auraLoss = content.aura.incidentAuraLoss[incident.category];
    const fineMillions = incidentFineMillions(incident.category, lab.market.marketShare);
    const researchOutputMultiplier = INCIDENT_COMPLIANCE_DRAG[incident.category];
    const politicalFallout = INCIDENT_GOVERNMENT_FALLOUT[incident.category];
    const governmentTrustLost = Math.min(
      lab.politics.governmentTrust,
      politicalFallout.trustLoss,
    );
    const governmentAttentionAdded = Math.min(
      100 - lab.politics.governmentAttention,
      politicalFallout.attentionGain,
    );
    tx.update((draft) => {
      draft.incidents.push(structuredClone(incident) as DeepMutable<IncidentState>);
      draft.presentationQueue.push({
        key: `model-incident-result:${incident.key}`,
        kind: "model-incident-result",
        attention: "modal",
        modelId: model.id,
        occurredAt: incident.occurredAt,
        category: incident.category,
        severity: incident.observedSeverity,
        contained: incident.contained,
        threatLabel: incidentThreatLabel(kind.id),
        headline: kind.headline(model.displayName),
        auraLoss,
        fineMillions,
        governmentTrustLost,
        governmentAttentionAdded,
        ...(researchOutputMultiplier === undefined ? {} : { researchOutputMultiplier }),
      });
      draft.domainLog.push({
        tick: draft.run.tick,
        code: `model-incident:${model.id}:${incident.category}`,
      });
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `${incidentCategoryLabel(category)}: ${kind.headline(model.displayName)}`,
        category: "narrative",
        source: { kind: "system", id: incident.key },
        relatedIds: [incident.key],
      });
    });
    tx.emit({
      kind: "model-incident",
      modelId: model.id,
      severity,
      category: incident.category,
      contained: incident.contained,
    });
    applyIncidentConsequences(tx, content, oracle, incident);
  }
  tx.update((draft) => {
    const lab = draft.labs[playerLabId];
    if (lab === undefined) throw new Error(`Unknown player lab ${playerLabId}`);
    lab.flags[ORDINARY_INCIDENT_DRY_SPELL_FLAG] =
      triggered.size > 0 ? 0 : exposedWeeksSinceLast + 1;
    lab.flags[ORDINARY_INCIDENT_CADENCE_EPOCH_FLAG] =
      triggered.size > 0 ? cadenceEpoch + 1 : cadenceEpoch;
  });
}
