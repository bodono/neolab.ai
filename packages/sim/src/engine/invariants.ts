import { assertPlainSerialisable } from "../model/schema.ts";
import { calendarFromTick, type GameState } from "../model/state.ts";

export interface InvariantViolation {
  readonly code: string;
  readonly detail: string;
}

const ALLOCATION_SUM = 10_000;

/**
 * Global invariants checked after every command and tick (TDD section 9.5).
 * The pack grows with the systems that own each rule; every entry lists its
 * source rule. Violations indicate an engine bug, never a player mistake.
 */
export function collectInvariantViolations(
  state: GameState,
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const push = (code: string, detail: string): void => {
    violations.push({ code, detail });
  };

  // TDD 9.5: all values finite, plain, serialisable.
  try {
    assertPlainSerialisable(state);
  } catch (error) {
    push("plain-data", error instanceof Error ? error.message : String(error));
  }

  // GDD 28.1 / TDD 7.1: displayed calendar matches the tick counter.
  const expectedCalendar = calendarFromTick(state.run.tick);
  if (
    state.run.calendar.year !== expectedCalendar.year ||
    state.run.calendar.week !== expectedCalendar.week
  ) {
    push(
      "calendar-drift",
      `calendar ${String(state.run.calendar.year)}w${String(state.run.calendar.week)} ` +
        `does not match tick ${String(state.run.tick)}`,
    );
  }

  // TDD 9.5: ending status and endgame state are compatible.
  if (state.run.status === "active" && state.run.endingId !== undefined) {
    push("ending-mismatch", "active run carries an endingId");
  }
  if (state.run.status !== "active" && state.run.endingId === undefined) {
    push("ending-mismatch", `run is ${state.run.status} without an endingId`);
  }

  // TDD 9.5: id counters never regress below existing entities.
  for (const [namespace, counter] of Object.entries(state.run.idCounters)) {
    if (!Number.isInteger(counter) || counter < 0) {
      push("id-counter", `counter ${namespace} is ${String(counter)}`);
    }
  }

  const playerLab = state.labs[state.run.playerLabId];
  if (playerLab === undefined) {
    push("missing-player-lab", `no lab ${state.run.playerLabId}`);
  }

  for (const [labId, lab] of Object.entries(state.labs)) {
    // TDD 16.1: allocation weights sum exactly at every hierarchy level.
    const allocation = lab.compute.allocation;
    const domainSum = Object.values(allocation.capabilityDomainWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (domainSum !== ALLOCATION_SUM) {
      push(
        "allocation-sum",
        `${labId} capability domain weights sum to ${String(domainSum)}`,
      );
    }
    const safetySum = Object.values(allocation.safetyProgramWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (safetySum !== ALLOCATION_SUM) {
      push(
        "allocation-sum",
        `${labId} safety programme weights sum to ${String(safetySum)}`,
      );
    }

    // Allocation weights must reference unlocked domains.
    for (const domainId of Object.keys(allocation.capabilityDomainWeights)) {
      if (!(domainId in lab.research.domains)) {
        push("allocation-domain", `${labId} weights unknown domain ${domainId}`);
      }
    }

    // TDD 9.5: entity indexes reference existing entities with correct owners.
    for (const modelId of lab.models.modelIds) {
      const model = state.models[modelId];
      if (model === undefined) {
        push("dangling-model", `${labId} lists missing model ${modelId}`);
      } else if (model.ownerLabId !== labId) {
        push(
          "model-owner",
          `${modelId} owned by ${model.ownerLabId}, listed by ${labId}`,
        );
      }
    }
    if (
      lab.models.currentModelId !== undefined &&
      !lab.models.modelIds.includes(lab.models.currentModelId)
    ) {
      push("current-model", `${labId} current model not in its portfolio`);
    }
    for (const projectId of lab.projects.projectIds) {
      if (!(projectId in state.projects)) {
        push("dangling-project", `${labId} lists missing project ${projectId}`);
      }
    }

    // GDD 38.1: Lifetime Aura is a high-water mark.
    if (lab.aura.lifetime < lab.aura.spendable) {
      push("aura-lifetime", `${labId} lifetime aura below spendable`);
    }

    // TDD 7.2.1: physical GPU counts are non-negative integers.
    for (const lot of lab.compute.lots) {
      if (!Number.isInteger(lot.physicalCount) || lot.physicalCount < 0) {
        push("gpu-count", `${labId} lot ${lot.id} count ${String(lot.physicalCount)}`);
      }
    }
  }

  // TDD 9.5: scheduled effects carry a future tick and stable ID.
  const scheduledIds = new Set<string>();
  for (const scheduled of state.scheduledEffects) {
    if (scheduled.dueAt <= state.run.tick) {
      push("scheduled-past", `${scheduled.id} due at ${String(scheduled.dueAt)}`);
    }
    if (scheduledIds.has(scheduled.id)) {
      push("scheduled-duplicate", scheduled.id);
    }
    scheduledIds.add(scheduled.id);
  }

  // TDD 18.5: score ledger keys are unique and mirrored in awardedKeys.
  const scoreKeys = new Set<string>();
  for (const entry of state.score.entries) {
    if (scoreKeys.has(entry.key)) {
      push("score-duplicate", entry.key);
    }
    scoreKeys.add(entry.key);
    if (state.score.awardedKeys[entry.key] !== true) {
      push("score-index", `ledger key ${entry.key} missing from awardedKeys`);
    }
  }
  for (const key of Object.keys(state.score.awardedKeys)) {
    if (!scoreKeys.has(key)) {
      push("score-index", `awardedKeys has ${key} without a ledger entry`);
    }
  }

  return violations;
}

export class InvariantError extends Error {
  readonly violations: readonly InvariantViolation[];

  constructor(violations: readonly InvariantViolation[]) {
    super(
      `Invariant violation(s): ${violations
        .map((violation) => `${violation.code}: ${violation.detail}`)
        .join(" | ")}`,
    );
    this.name = "InvariantError";
    this.violations = violations;
  }
}

export function assertInvariants(state: GameState): void {
  const violations = collectInvariantViolations(state);
  if (violations.length > 0) {
    throw new InvariantError(violations);
  }
}
