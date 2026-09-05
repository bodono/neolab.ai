import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ModelId } from "../model/ids.ts";
import type { GameState, ModelState } from "../model/state.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import { deceptiveActionPressure } from "../models/deception.ts";
import type { RandomOracle } from "../random/oracle.ts";
import {
  effectiveOperationalDefence,
  effectivePracticalControlStrength,
  effectiveSecurityPosture,
  operationalDefenceMultiplier,
} from "../safety/effective-safety.ts";
import {
  isCandidateArtifactFunctional,
  resolveCandidatePressureCrossing,
} from "./candidate-lifecycle.ts";
import { shouldDeferArchiveHazardCrossing } from "./archive-recovery.ts";

export const ISOLATED_ARCHIVE_PRESSURE_MULTIPLIER = 0.25;
// An active qualifying artifact cannot be made inert by excellent lab
// defences. At the maximum stable threshold this guarantees a visible custody
// signal within roughly 86 low-access custody weeks. Tool and network access
// accelerate that horizon sharply, while better defences still slow the
// clock and keep severe classes rarer.
export const ACTIVE_ARTIFACT_MINIMUM_WEEKLY_PRESSURE = 0.35;
export const ISOLATED_ARCHIVE_MINIMUM_WEEKLY_PRESSURE = 0.01;
export const MAXIMUM_CONTAINMENT_OVERLOAD_MULTIPLIER = 3;

export interface CandidateContainmentCapacityView {
  readonly used: number;
  readonly maximum: number;
  readonly overload: number;
  readonly overloadRatio: number;
}

/** One shared selector for mechanics and custody UI, so capacity cannot drift. */
export function candidateContainmentCapacity(
  state: Readonly<GameState>,
  labId: LabId,
): CandidateContainmentCapacityView {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown candidate-containment lab ${labId}`);
  const maximum = Math.max(
    1,
    1.5 +
      effectivePracticalControlStrength(state, labId) / 25 +
      effectiveSecurityPosture(state, labId) / 25 +
      lab.organisation.engineersAndOps / 20,
  );
  const used = lab.models.modelIds.reduce((total, modelId) => {
    const model = state.models[modelId];
    const artifact = model?.candidateArtifact;
    if (
      model === undefined ||
      artifact === undefined ||
      !isCandidateArtifactFunctional(model) ||
      artifact.lifecycle === "escaped"
    ) {
      return total;
    }
    return total + artifact.containmentLoad;
  }, 0);
  const overload = Math.max(0, used - maximum);
  return {
    used,
    maximum,
    overload,
    overloadRatio: maximum <= 0 ? 0 : overload / maximum,
  };
}

function unresolvedAnomalyBurden(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): number {
  return model.anomalies.reduce((total, anomalyId) => {
    const anomaly = state.anomalies[anomalyId];
    if (
      anomaly === undefined ||
      anomaly.status === "resolved" ||
      anomaly.status === "mitigated"
    ) {
      return total;
    }
    return total + anomaly.observedSeverity / 100;
  }, 0);
}

function hasServingExposure(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  const lab = state.labs[model.ownerLabId];
  return (
    model.deployment.policy !== "internal-only" ||
    model.deployment.exposure > 0 ||
    lab?.models.commercialModelId === model.id
  );
}

/**
 * A rival's formal candidacy has its own staged safety and control resolver.
 * Letting the generic custody threshold independently interrupt that same
 * candidate made the 78-week deployment process structurally impossible: the
 * active-artifact pressure floor crossed every 18-30 point threshold first.
 *
 * Pressure and exposure still accumulate during the countdown and the final
 * rival resolver still uses the model's hidden safety and the lab's defences.
 * Only the duplicate automatic crossing is deferred while that resolver owns
 * the artifact. Direct/defensive crossings remain valid.
 */
function isUnderActiveRivalCandidateResolution(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
): boolean {
  const lab = state.labs[model.ownerLabId];
  const countdown = state.world.rivals[model.ownerLabId]?.candidateCountdown;
  return (
    lab?.control === "rival" &&
    countdown?.modelId === model.id &&
    (countdown.status === "active" || countdown.status === "paused")
  );
}

export interface CandidateWeeklyPressureBreakdown {
  readonly base: number;
  readonly capability: number;
  readonly agency: number;
  readonly access: number;
  readonly serving: number;
  readonly anomaly: number;
  readonly hiddenDanger: number;
  readonly superintelligence: number;
  readonly defenceMultiplier: number;
  readonly overloadMultiplier: number;
  readonly archiveMultiplier: number;
  readonly final: number;
}

const ACCESS_PRESSURE: Readonly<Record<ModelState["accessLevel"], number>> = {
  0: 0,
  1: 0.2,
  2: 1.4,
  3: 2.6,
  4: 4,
  5: 6,
};

/** Pure monotone breakdown used by balance probes and the weekly processor. */
export function candidateWeeklyPressure(
  state: Readonly<GameState>,
  modelId: ModelId,
  capacity: CandidateContainmentCapacityView = candidateContainmentCapacity(
    state,
    state.models[modelId]?.ownerLabId ?? state.run.playerLabId,
  ),
): CandidateWeeklyPressureBreakdown {
  const model = state.models[modelId];
  const artifact = model?.candidateArtifact;
  if (model === undefined || artifact === undefined) {
    throw new Error(`Unknown candidate artifact ${modelId}`);
  }
  const lineage = state.lineageSIRecords[model.lineageId];
  if (lineage === undefined)
    throw new Error(`Candidate lineage ${model.lineageId} has no truth`);
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const base = 0.12;
  const capability = Math.max(0, frontierCapability - 88) * 0.02;
  const agency = Math.max(0, model.trueCapability.agency - 70) * 0.01;
  const access = ACCESS_PRESSURE[model.accessLevel];
  const serving = hasServingExposure(state, model) ? model.deployment.exposure * 2 : 0;
  const anomaly = unresolvedAnomalyBurden(state, model) * 0.25;
  const hiddenDanger =
    ((100 -
      model.hiddenSafety.trueAlignment +
      (100 - model.hiddenSafety.corrigibility) +
      model.hiddenSafety.situationalAwareness +
      deceptiveActionPressure(
        model.hiddenSafety.deceptiveCapability,
        model.hiddenSafety.deceptiveIntent,
      )) /
      400) *
    0.35;
  const superintelligence = lineage.superintelligenceTruth === "genuine" ? 0.3 : 0;
  const defenceMultiplier = operationalDefenceMultiplier(
    effectiveOperationalDefence(state, model.ownerLabId),
  );
  const overloadMultiplier = Math.min(
    MAXIMUM_CONTAINMENT_OVERLOAD_MULTIPLIER,
    1 + capacity.overloadRatio * 1.5,
  );
  const archiveMultiplier =
    artifact.lifecycle === "verified-isolated-archive"
      ? ISOLATED_ARCHIVE_PRESSURE_MULTIPLIER
      : 1;
  const minimum =
    artifact.lifecycle === "verified-isolated-archive"
      ? ISOLATED_ARCHIVE_MINIMUM_WEEKLY_PRESSURE
      : ACTIVE_ARTIFACT_MINIMUM_WEEKLY_PRESSURE;
  const final = Math.max(
    minimum,
    (base +
      capability +
      agency +
      access +
      serving +
      anomaly +
      hiddenDanger +
      superintelligence) *
      defenceMultiplier *
      overloadMultiplier *
      archiveMultiplier,
  );
  return {
    base,
    capability,
    agency,
    access,
    serving,
    anomaly,
    hiddenDanger,
    superintelligence,
    defenceMultiplier,
    overloadMultiplier,
    archiveMultiplier,
    final,
  };
}

/**
 * Weekly accumulator for every functional candidate weight artifact, including
 * non-current models and verified isolated archives. No fresh weekly incident
 * roll exists: only a stable epoch threshold can turn pressure into an event.
 */
export function advanceLatentCandidateHazards(
  tx: SimulationTransaction,
  oracle: RandomOracle,
): void {
  const start = tx.read();
  const modelsUnderActiveSafetyWork = new Set(
    Object.values(start.projects)
      .filter(
        (project) =>
          (project.status === "queued" ||
            project.status === "active" ||
            project.status === "paused") &&
          project.payload.kind === "crisis" &&
          project.payload.candidateSafetyResponseId !== undefined,
      )
      .map((project) =>
        project.payload.kind === "crisis" ? project.payload.modelId : undefined,
      )
      .filter((modelId): modelId is ModelId => modelId !== undefined),
  );
  // Rival deployment, insolvency, or another terminal resolver may have ended
  // the run earlier in the same weekly transaction. A sealed terminal result
  // must not be mutated by later hazard processors.
  if (start.run.status !== "active") return;
  const capacities = Object.fromEntries(
    (Object.keys(start.labs).sort() as LabId[]).map((labId) => [
      labId,
      candidateContainmentCapacity(start, labId),
    ]),
  ) as Readonly<Record<LabId, CandidateContainmentCapacityView>>;
  const modelIds = Object.values(start.models)
    .filter((model) => isCandidateArtifactFunctional(model))
    .map((model) => model.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  for (const modelId of modelIds) {
    const before = tx.read();
    const model = before.models[modelId];
    const artifact = model?.candidateArtifact;
    if (
      model === undefined ||
      artifact === undefined ||
      !isCandidateArtifactFunctional(model)
    ) {
      continue;
    }
    const burden = unresolvedAnomalyBurden(before, model);
    const serving = hasServingExposure(before, model);
    // Access 1 is a fixed evaluator and Access 2 is explicitly supervised,
    // sandboxed tooling. Autonomous operation begins with persistent internal
    // surfaces at Access 3; direct external-network exposure begins only at
    // Access 5. Public serving is network exposure at any access level.
    const operationallyAutonomous = model.accessLevel >= 3;
    const networked = model.accessLevel >= 5 || serving;
    const pressure = candidateWeeklyPressure(
      before,
      model.id,
      capacities[model.ownerLabId] ??
        candidateContainmentCapacity(before, model.ownerLabId),
    );
    tx.update((draft) => {
      const mutableModel = draft.models[model.id];
      const mutable = mutableModel?.candidateArtifact;
      if (mutableModel === undefined || mutable === undefined) {
        throw new Error(
          `Candidate artifact ${model.id} vanished during weekly processing`,
        );
      }
      mutable.maximumAccessEver = Math.max(
        mutable.maximumAccessEver,
        mutableModel.accessLevel,
      ) as ModelState["accessLevel"];
      if (operationallyAutonomous) mutable.cumulativeAutonomousWeeks += 1;
      if (networked) mutable.networkExposureWeeks += 1;
      if (serving) mutable.servingExposureWeeks += 1;
      mutable.unresolvedAnomalyBurden = burden;
      if (mutable.activeIncident?.status !== "unresolved") {
        mutable.hazardPressure += pressure.final;
      }
    });
    const endgame = tx.read().endgame;
    // Do not replace one already-blocking human decision with a new custody
    // signal in the same tick. Pressure remains accumulated and is checked
    // once the remediation or pressure-collision choice has been resolved.
    const blockingDecisionAlreadyOpen =
      endgame.stage === "pressure-collision" ||
      (endgame.stage === "evidence-sprint" && endgame.pendingRemediation !== undefined);
    if (
      !modelsUnderActiveSafetyWork.has(model.id) &&
      !blockingDecisionAlreadyOpen &&
      !shouldDeferArchiveHazardCrossing(tx.read(), model) &&
      !isUnderActiveRivalCandidateResolution(tx.read(), model)
    ) {
      resolveCandidatePressureCrossing(tx, model.id, "weekly-pressure", oracle);
    }
  }
}
