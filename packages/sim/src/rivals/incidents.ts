import type { LabId } from "../model/ids.ts";
import type {
  GameState,
  RivalIncidentConsequence,
  RivalIncidentSeverity,
} from "../model/state.ts";
import { fraction, rating, tick } from "../model/units.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import { CANDIDATE_ACCESS_RULES } from "../endgame/access.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import { recordRivalPublicSignal } from "./signals.ts";

export const RIVAL_INCIDENT_CONSEQUENCES: readonly RivalIncidentConsequence[] = [
  "major-delay",
  "government-intervention",
  "compute-loss",
  "model-weights-loss",
  "aura-market-collapse",
  "safety-information-shared",
  "shared-restrictions",
];

const RIVAL_INCIDENT_CONSEQUENCE_COPY: Readonly<
  Record<RivalIncidentConsequence, string>
> = {
  "major-delay": "Its research programme suffered a major delay.",
  "government-intervention": "The government intervened.",
  "compute-loss": "It lost part of its compute fleet.",
  "model-weights-loss": "Its current model programme was damaged.",
  "aura-market-collapse": "Its reputation and customer demand collapsed.",
  "safety-information-shared":
    "It shared safety information with the other frontier labs.",
  "shared-restrictions": "Shared restrictions were imposed across every frontier lab.",
};

export function formatRivalIncidentSummary(
  labName: string,
  severity: RivalIncidentSeverity,
  consequences: readonly RivalIncidentConsequence[],
): string {
  const severityCopy = severity === "critical" ? "critical" : "serious";
  const consequenceCopy = consequences
    .map((consequence) => RIVAL_INCIDENT_CONSEQUENCE_COPY[consequence])
    .join(" ");
  return `${labName} contained a ${severityCopy} laboratory incident.${consequenceCopy.length === 0 ? "" : ` ${consequenceCopy}`}`;
}

export interface RivalIncidentRisk {
  readonly risk: number;
  readonly triggerProbability: number;
}

interface IncidentResolutionInput {
  readonly riskAtCheck?: number;
  readonly triggerProbability?: number;
  readonly triggerDraw?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function calculateModelExposure(state: Readonly<GameState>, labId: LabId): number {
  const modelId = state.labs[labId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  return model?.deployment.exposure ?? 0;
}

function calculateAutonomyExposure(state: Readonly<GameState>, labId: LabId): number {
  const modelId = state.labs[labId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  return model === undefined ? 0 : CANDIDATE_ACCESS_RULES[model.accessLevel].exposure;
}

/** Uses only a rival's own state and public world conditions, never player hidden state. */
export function calculateRivalIncidentRisk(
  state: Readonly<GameState>,
  labId: LabId,
): RivalIncidentRisk {
  const lab = state.labs[labId];
  const strategy = state.world.rivals[labId];
  if (lab === undefined || lab.control !== "rival" || strategy === undefined) {
    throw new Error(`Unknown rival lab ${labId}`);
  }
  const safetyReadiness =
    (lab.safety.safetyCulture +
      lab.safety.evalQuality +
      lab.safety.practicalControlStrength +
      lab.safety.securityPosture) /
    4;
  const modelId = lab.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  const hiddenModelRisk =
    model === undefined
      ? 0
      : (100 - model.hiddenSafety.trueAlignment) * 0.18 +
        (100 - model.hiddenSafety.corrigibility) * 0.08 +
        deceptiveActionPressure(
          model.hiddenSafety.deceptiveCapability,
          model.hiddenSafety.deceptiveIntent,
        ) *
          0.1 +
        model.hiddenSafety.situationalAwareness * 0.07 +
        model.trueCapability.agency * 0.07;
  const planRisk =
    strategy.currentPlanId === "frontier-training"
      ? 14
      : strategy.currentPlanId === "publish-sprint"
        ? 7
        : strategy.currentPlanId === "safety-stand-down"
          ? -14
          : 0;
  const risk = clamp(
    (100 - safetyReadiness) * 0.3 +
      hiddenModelRisk +
      strategy.personality.raceUrgency * 0.15 +
      strategy.personality.financialRisk * 0.08 +
      calculateModelExposure(state, labId) * 10 +
      calculateAutonomyExposure(state, labId) * 35 +
      planRisk,
    0,
    100,
  );
  return {
    risk,
    triggerProbability: clamp(0.04 + risk * 0.0022, 0.04, 0.26),
  };
}

function applyConsequence(
  tx: SimulationTransaction,
  labId: LabId,
  consequence: RivalIncidentConsequence,
  incidentId: string,
): void {
  switch (consequence) {
    case "major-delay":
      tx.update((draft) => {
        const lab = draft.labs[labId];
        const strategy = draft.world.rivals[labId];
        if (lab === undefined || strategy === undefined) return;
        for (const paperId of Object.keys(lab.research.paperProgress)) {
          lab.research.paperProgress[paperId] =
            (lab.research.paperProgress[paperId] ?? 0) * 0.65;
        }
        strategy.planEndsAt = tick(strategy.planEndsAt + 4);
      });
      return;
    case "government-intervention":
      applyEffect(
        tx,
        {
          kind: "add-rating",
          subject: { type: "lab", labId },
          rating: "governmentAttention",
          amount: 20,
        },
        { kind: "system", id: incidentId },
      );
      applyEffect(
        tx,
        {
          kind: "add-rating",
          subject: { type: "lab", labId },
          rating: "governmentTrust",
          amount: -15,
        },
        { kind: "system", id: incidentId },
      );
      return;
    case "compute-loss":
      tx.update((draft) => {
        const lab = draft.labs[labId];
        const largest = lab?.compute.lots
          .filter((lot) => lot.availableFraction > 0)
          .sort(
            (left, right) =>
              right.physicalCount * right.availableFraction -
              left.physicalCount * left.availableFraction,
          )[0];
        if (largest !== undefined) {
          largest.availableFraction = fraction(largest.availableFraction * 0.5);
        }
      });
      return;
    case "model-weights-loss":
      tx.update((draft) => {
        const modelId = draft.labs[labId]?.models.currentModelId;
        const model = modelId === undefined ? undefined : draft.models[modelId];
        if (model !== undefined) {
          model.productQuality = rating(Math.max(0, model.productQuality - 18));
          model.reliability = rating(Math.max(0, model.reliability - 15));
        }
      });
      return;
    case "aura-market-collapse":
      applyEffect(
        tx,
        {
          kind: "add-resource",
          subject: { type: "lab", labId },
          resource: "aura-spendable",
          amount: -10,
          auraChangeKind: "loss",
          auraCategory: "incident",
          auraSignalImpact: -12,
        },
        { kind: "system", id: incidentId },
      );
      tx.update((draft) => {
        const lab = draft.labs[labId];
        if (lab === undefined) return;
        lab.market.marketShare = fraction(lab.market.marketShare * 0.7);
        for (const segment of Object.values(lab.market.segments)) {
          segment.desiredUsagePerCycle *= 0.7;
          segment.satisfaction = rating(Math.max(0, segment.satisfaction - 15));
        }
      });
      return;
    case "safety-information-shared":
      for (const participantId of Object.keys(tx.read().labs).sort() as LabId[]) {
        applyEffect(
          tx,
          {
            kind: "add-rating",
            subject: { type: "lab", labId: participantId },
            rating: "evalQuality",
            amount: 3,
          },
          { kind: "system", id: incidentId },
        );
      }
      return;
    case "shared-restrictions":
      tx.update((draft) => {
        for (const participant of Object.values(draft.labs)) {
          participant.flags["world:shared-restrictions-until"] = tick(
            draft.run.tick + 13,
          );
          for (const segment of Object.values(participant.market.segments)) {
            segment.desiredUsagePerCycle *= 0.9;
          }
        }
      });
      for (const participantId of Object.keys(tx.read().labs).sort() as LabId[]) {
        applyEffect(
          tx,
          {
            kind: "add-rating",
            subject: { type: "lab", labId: participantId },
            rating: "governmentAttention",
            amount: 8,
          },
          { kind: "system", id: incidentId },
        );
      }
      return;
  }
}

/**
 * Converts a rival high-severity failure into the closed non-extinction set.
 * This function deliberately has no `end-run` path.
 */
export function resolveRivalHighSeverityFailure(
  tx: SimulationTransaction,
  labId: LabId,
  severity: RivalIncidentSeverity,
  random: RandomOracle,
  input: IncidentResolutionInput = {},
): void {
  const strategy = tx.read().world.rivals[labId];
  if (strategy === undefined) throw new Error(`Unknown rival lab ${labId}`);
  const calculated = calculateRivalIncidentRisk(tx.read(), labId);
  const incidentId = `rival-incident:${labId}:${String(tx.read().run.tick)}:${String(strategy.incidents.length)}`;
  const riskAtCheck = input.riskAtCheck ?? calculated.risk;
  const triggerProbability = input.triggerProbability ?? calculated.triggerProbability;
  const triggerDraw =
    input.triggerDraw ??
    random.uniform(randomKey("rival-incident", labId, incidentId, "trigger"));
  const consequenceCount = severity === "critical" ? 2 : 1;
  const consequences = random
    .shuffle(
      randomKey("rival-incident", labId, incidentId, "consequences"),
      RIVAL_INCIDENT_CONSEQUENCES,
    )
    .slice(0, consequenceCount);
  for (const consequence of consequences) {
    applyConsequence(tx, labId, consequence, incidentId);
  }
  tx.update((draft) => {
    const liveStrategy = draft.world.rivals[labId];
    if (liveStrategy === undefined) throw new Error(`Missing rival strategy ${labId}`);
    liveStrategy.incidents.push({
      id: incidentId,
      occurredAt: draft.run.tick,
      severity,
      consequences: [...consequences],
      riskAtCheck: rating(riskAtCheck),
      triggerProbability: fraction(triggerProbability),
      draw: fraction(triggerDraw),
    });
    liveStrategy.relationship.strategicFear = clamp(
      liveStrategy.relationship.strategicFear - (severity === "critical" ? 8 : 4),
      -100,
      100,
    );
    if (consequences.includes("safety-information-shared")) {
      liveStrategy.relationship.trust = clamp(
        liveStrategy.relationship.trust + 8,
        -100,
        100,
      );
      liveStrategy.relationship.perceivedHonesty = clamp(
        liveStrategy.relationship.perceivedHonesty + 10,
        -100,
        100,
      );
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: formatRivalIncidentSummary("A rival lab", severity, consequences),
      category: "narrative",
      source: { kind: "system", id: incidentId },
      relatedIds: [labId],
    });
  });
  recordRivalPublicSignal(tx, {
    labId,
    kind: "incident",
    subjectId: incidentId,
    actualValue: riskAtCheck,
    baseErrorRadius: severity === "critical" ? 8 : 14,
    summary: `A rival lab reported a contained ${severity === "critical" ? "critical" : "serious"} laboratory incident.`,
  });
  tx.emit({
    kind: "rival-incident-resolved",
    labId,
    incidentId,
    severity,
    consequences,
  });
}

export function advanceRivalIncidents(
  tx: SimulationTransaction,
  random: RandomOracle,
): void {
  if ((tx.read().run.tick + 1) % 13 !== 0) return;
  for (const labId of Object.keys(tx.read().world.rivals).sort() as LabId[]) {
    const { risk, triggerProbability } = calculateRivalIncidentRisk(tx.read(), labId);
    const quarter = Math.floor((tx.read().run.tick + 1) / 13);
    const draw = random.uniform(
      randomKey("rival-incident", labId, `quarter-${String(quarter)}`, "trigger"),
    );
    if (draw >= triggerProbability) continue;
    const severityDraw = random.uniform(
      randomKey("rival-incident", labId, `quarter-${String(quarter)}`, "severity"),
    );
    const severity: RivalIncidentSeverity =
      (risk >= 75 && severityDraw < 0.5) || severityDraw < 0.12 ? "critical" : "high";
    resolveRivalHighSeverityFailure(tx, labId, severity, random, {
      riskAtCheck: risk,
      triggerProbability,
      triggerDraw: draw,
    });
  }
}
