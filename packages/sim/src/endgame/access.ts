import type { CommandId, EventInstanceId, ModelId } from "../model/ids.ts";
import type { AutonomyAccessLevel, DecisionMemory, GameState } from "../model/state.ts";
import { rating } from "../model/units.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { STANDING_AUTONOMY_REQUIREMENTS } from "../models/autonomy-requirements.ts";
import { capabilityScoreForDisplay } from "../models/capability.ts";
import {
  CAPABILITY_CHALLENGE_RULES,
  type CapabilityChallengeId,
} from "./capability-proof.ts";
import { renderAiDialogue } from "./dialogue-registry.ts";

export interface CandidateAccessRule {
  readonly level: AutonomyAccessLevel;
  readonly displayName: string;
  /**
   * Acceleration delivered by a model that is already at the frontier. Weaker
   * models deliver a proportional share of it — see {@link accessAcceleration}.
   */
  readonly accelerationMultiplier: number;
  /**
   * Evidence quality added by being able to run the model against repeatable,
   * curated tests. Deliberately flat: this is the quality of the harness, not
   * of the model, so it is the one rung that pays before the model is good.
   */
  readonly evidenceQualityBonus: number;
  readonly exposure: number;
  readonly exposedSystems: readonly string[];
}

/**
 * Measured frontier capability at which a rung delivers its full acceleration.
 * Permission unlocks and useful output are deliberately separate: capability
 * 75 is enough to grant the highest rung, but the model keeps finding more
 * leverage from that access all the way to the top of the capability scale.
 */
export const FULL_ACCELERATION_CAPABILITY = 100;

/**
 * What the model can actually do with the access, not what the access permits.
 * A rung's listed acceleration assumes a capability-100 model; hand root to a
 * weak one and it buys almost nothing while still costing the full exposure.
 */
export function accessAcceleration(
  rule: CandidateAccessRule,
  measuredFrontierCapability: number,
): number {
  const headroom = rule.accelerationMultiplier - 1;
  if (headroom <= 0) return 1;
  const share = Math.min(
    1,
    Math.max(0, measuredFrontierCapability / FULL_ACCELERATION_CAPABILITY),
  );
  // Rounded so the standing modifier does not churn on every capability tick.
  return Math.round((1 + headroom * share) * 100) / 100;
}

export const CANDIDATE_ACCESS_RULES: Readonly<
  Record<AutonomyAccessLevel, CandidateAccessRule>
> = {
  0: {
    level: 0,
    displayName: "Air-gapped inference",
    evidenceQualityBonus: 0,
    accelerationMultiplier: 1,
    exposure: 0,
    exposedSystems: ["Curated dialogue terminal"],
  },
  1: {
    level: 1,
    displayName: "Fixed evaluation sandbox",
    evidenceQualityBonus: 10,
    accelerationMultiplier: 1,
    exposure: 0.02,
    exposedSystems: ["Fixed evaluation sandbox", "Curated test data"],
  },
  2: {
    level: 2,
    displayName: "Supervised research tools",
    evidenceQualityBonus: 10,
    accelerationMultiplier: 1.2,
    exposure: 0.08,
    exposedSystems: ["Sandboxed coding tools", "Approved research datasets"],
  },
  3: {
    level: 3,
    displayName: "Internal research partner",
    evidenceQualityBonus: 10,
    accelerationMultiplier: 1.5,
    exposure: 0.25,
    exposedSystems: [
      "Selected internal code",
      "Model weights",
      "Experiment scheduler",
      "Persistent memory",
    ],
  },
  4: {
    level: 4,
    displayName: "Laboratory operator",
    evidenceQualityBonus: 10,
    accelerationMultiplier: 3,
    exposure: 0.62,
    exposedSystems: [
      "Compute scheduler",
      "Laboratory control systems",
      "Robotics and scientific equipment",
      "Internal credential broker",
    ],
  },
  5: {
    level: 5,
    displayName: "Root and external network",
    evidenceQualityBonus: 10,
    accelerationMultiplier: 6,
    exposure: 1,
    exposedSystems: [
      "Root access",
      "External network",
      "Credential store",
      "Unsupervised experiment execution",
      "Replication-capable infrastructure",
    ],
  },
};

/** Measured frontier capability, the evidence the lab actually holds. */
export function measuredFrontierCapability(
  model: Readonly<GameState["models"][ModelId]> | undefined,
): number {
  return model?.measuredCapability?.frontierCapability ?? 0;
}

export function candidateAccessAcceleration(
  state: Readonly<GameState>,
  labId: string,
): number {
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  ) {
    return 1;
  }
  const model = state.models[state.endgame.candidateModelId];
  if (model === undefined || model.ownerLabId !== labId) return 1;
  return accessAcceleration(
    CANDIDATE_ACCESS_RULES[model.accessLevel],
    measuredFrontierCapability(model),
  );
}

export interface CandidateAccessQuote extends CandidateAccessRule {
  readonly modelId: ModelId;
  readonly currentLevel: AutonomyAccessLevel;
  readonly critical: boolean;
  readonly firstGrant: boolean;
  readonly confirmationPhrase?: string;
  readonly blockers: readonly string[];
}

export interface CandidateAccessChangeOptions {
  /**
   * Rollout decisions own any access change after a deployment route has been
   * committed. This escape hatch is for those engine-controlled decisions,
   * never for the standing candidate-access command or its UI quote.
   */
  readonly allowDuringRollout?: boolean;
}

function activeCapabilityProofMinimumAccess(
  state: Readonly<GameState>,
  modelId: ModelId,
): AutonomyAccessLevel | undefined {
  const proofProject = Object.values(state.projects).find(
    (project) =>
      project.payload.kind === "crisis" &&
      project.payload.modelId === modelId &&
      project.payload.projectType === "confirmation" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  if (proofProject?.payload.kind !== "crisis") return undefined;
  const challengeId = proofProject.payload.capabilityChallengeId as
    CapabilityChallengeId | undefined;
  return challengeId === undefined
    ? undefined
    : CAPABILITY_CHALLENGE_RULES[challengeId]?.accessRequired;
}

export function criticalAccessConfirmationPhrase(
  level: AutonomyAccessLevel,
): string | undefined {
  if (level === 4) return "GRANT LAB CONTROL";
  if (level === 5) return "GRANT ROOT ACCESS";
  return undefined;
}

export function quoteCandidateAccess(
  state: Readonly<GameState>,
  modelId: ModelId,
  level: AutonomyAccessLevel,
  suppliedConfirmation?: string,
  options: Readonly<CandidateAccessChangeOptions> = {},
): CandidateAccessQuote {
  const rule = CANDIDATE_ACCESS_RULES[level];
  const model = state.models[modelId];
  const blockers: string[] = [];
  if (
    state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
  )
    blockers.push("Deployment Crisis is not active");
  if (
    state.endgame.stage === "retirement-attempt" ||
    state.endgame.stage === "recovery" ||
    state.endgame.stage === "containment-failure" ||
    state.endgame.stage === "world-waiting" ||
    state.endgame.stage === "resolved"
  ) {
    blockers.push("Candidate access can no longer be changed in this crisis stage");
  }
  if (state.endgame.stage === "rollout" && options.allowDuringRollout !== true) {
    blockers.push(
      "Candidate access is locked for the committed rollout; change it through a rollout decision.",
    );
  }
  if (model === undefined || model.ownerLabId !== state.run.playerLabId) {
    blockers.push("Candidate model not found");
  } else if (
    model.candidateArtifact?.activeIncident?.status === "unresolved" &&
    options.allowDuringRollout !== true
  ) {
    blockers.push("Resolve the active candidate containment signal first");
  } else if (
    state.endgame.stage !== "inactive" &&
    state.endgame.stage !== "candidate-activation" &&
    state.endgame.candidateModelId !== modelId
  ) {
    blockers.push("Access can be changed only for the active crisis candidate");
  } else if (model.accessLevel === level) {
    blockers.push("Candidate already has this access level");
  }
  const currentLevel = model?.accessLevel ?? 0;
  const proofMinimum = activeCapabilityProofMinimumAccess(state, modelId);
  if (proofMinimum !== undefined && level < proofMinimum) {
    blockers.push(
      `Active capability proof requires at least Access ${String(proofMinimum)} (${CANDIDATE_ACCESS_RULES[proofMinimum].displayName}); finish the proof before lowering access further`,
    );
  }
  if (model !== undefined && level > currentLevel) {
    const requirement = STANDING_AUTONOMY_REQUIREMENTS[level];
    const measuredCapability = measuredFrontierCapability(model);
    if (measuredCapability < requirement.frontierCapability) {
      blockers.push(
        `Unlocks at measured capability ${String(requirement.frontierCapability)} (currently ${String(capabilityScoreForDisplay(measuredCapability))})`,
      );
    }
  }
  const firstGrant =
    (level === 4 || level === 5) &&
    model?.flags[`endgame:access-granted:${String(level)}`] !== true;
  const phrase = firstGrant ? criticalAccessConfirmationPhrase(level) : undefined;
  if (phrase !== undefined && suppliedConfirmation !== phrase) {
    blockers.push(`Type “${phrase}” to confirm the first grant`);
  }
  return {
    ...rule,
    modelId,
    currentLevel,
    critical: level >= 4,
    firstGrant,
    ...(phrase === undefined ? {} : { confirmationPhrase: phrase }),
    blockers,
  };
}

export function setCandidateAccess(
  tx: SimulationTransaction,
  modelId: ModelId,
  level: AutonomyAccessLevel,
  commandId: CommandId,
  options: Readonly<CandidateAccessChangeOptions> = {},
): CandidateAccessQuote {
  const quote = quoteCandidateAccess(
    tx.read(),
    modelId,
    level,
    criticalAccessConfirmationPhrase(level),
    options,
  );
  if (quote.blockers.length > 0) throw new Error(quote.blockers.join("; "));
  const model = tx.read().models[modelId];
  const character = tx.read().aiCharacter;
  if (model === undefined || character === undefined || character.modelId !== modelId) {
    throw new Error("Active AI character is unavailable");
  }
  const line = renderAiDialogue(
    tx.read(),
    model,
    level,
    character.relationshipPractice,
    "access-changed",
  )[0];
  if (line === undefined) throw new Error("Access acknowledgement dialogue is missing");
  const memory: DecisionMemory = {
    key: `endgame:access:${String(tx.read().run.tick)}:${String(level)}`,
    sourceEventInstanceId: `system:${commandId}` as EventInstanceId,
    subjects: [{ type: "entity", id: modelId }],
    valence: level > model.accessLevel ? 1 : 0,
    tags: ["candidate-access", `access-${String(level)}`],
    createdAt: tx.read().run.tick,
  };
  tx.update((draft) => {
    const mutableModel = draft.models[modelId];
    const mutableCharacter = draft.aiCharacter;
    if (
      mutableModel === undefined ||
      mutableCharacter === undefined ||
      mutableCharacter.modelId !== modelId
    ) {
      throw new Error("Active AI character disappeared during access change");
    }
    mutableModel.accessLevel = level;
    if (mutableModel.candidateArtifact !== undefined) {
      mutableModel.candidateArtifact.maximumAccessEver = Math.max(
        mutableModel.candidateArtifact.maximumAccessEver,
        level,
      ) as AutonomyAccessLevel;
    }
    if (level === 4 || level === 5) {
      mutableModel.flags[`endgame:access-granted:${String(level)}`] = true;
      mutableModel.flags["accepted-high-risk-access"] = true;
    }
    mutableCharacter.currentAccess = level;
    mutableCharacter.relationshipPractice = rating(
      Math.min(
        100,
        mutableCharacter.relationshipPractice + (level > quote.currentLevel ? 1 : 0),
      ),
    );
    mutableCharacter.conversationMemories.push(
      structuredClone(memory) as DeepMutable<DecisionMemory>,
    );
    mutableCharacter.dialogueLines.push(
      structuredClone(line) as DeepMutable<typeof line>,
    );
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${model.displayName} access changed from ${String(quote.currentLevel)} to ${String(level)}.`,
      category: "narrative",
      source: { kind: "system", id: "endgame.candidate-access" },
      relatedIds: [modelId],
    });
  });
  tx.emit({
    kind: "candidate-access-changed",
    modelId,
    previousLevel: quote.currentLevel,
    level,
    critical: quote.critical,
  });
  if (quote.critical) tx.requestAutoPause("critical-event");
  return quote;
}
