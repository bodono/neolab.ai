import type { IdNamespace } from "../model/state.ts";
import {
  formatRunEntityId,
  type AutoPauseReason,
  type GameState,
  type ScheduledEffectState,
} from "../model/state.ts";
import type { DeepMutable } from "./draft.ts";
import type { DomainEvent } from "./domain-events.ts";
import { assertInvariants } from "./invariants.ts";

export type StateUpdater = (draft: DeepMutable<GameState>) => void;

export interface TransitionAudit {
  readonly description: string;
  readonly commandId?: string;
}

export interface TransitionResult {
  readonly state: GameState;
  readonly domainEvents: readonly DomainEvent[];
  readonly autoPauseReasons: readonly AutoPauseReason[];
  readonly audit: TransitionAudit;
}

/**
 * Mutable working copy for one atomic transition (TDD section 9.3).
 *
 * The draft is a structured clone: a thrown updater leaves the input state
 * untouched. `commit` validates invariants, freezes the result, and can run
 * exactly once. `applyEffects` is wired to the effect executor in S1.6.
 */
export interface SimulationTransaction {
  readonly before: Readonly<GameState>;
  read(): Readonly<GameState>;
  update(updater: StateUpdater): void;
  emit(event: DomainEvent): void;
  requestAutoPause(reason: AutoPauseReason): void;
  schedule(effect: ScheduledEffectState): void;
  allocateId(namespace: IdNamespace, owner: string): string;
  commit(audit: TransitionAudit): TransitionResult;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function createTransaction(before: GameState): SimulationTransaction {
  const draft = structuredClone(before) as DeepMutable<GameState>;
  const events: DomainEvent[] = [];
  let committed = false;

  const guard = (): void => {
    if (committed) {
      throw new Error("SimulationTransaction used after commit");
    }
  };

  return {
    before,
    read(): Readonly<GameState> {
      return draft;
    },
    update(updater: StateUpdater): void {
      guard();
      updater(draft);
    },
    emit(event: DomainEvent): void {
      guard();
      events.push(event);
    },
    requestAutoPause(reason: AutoPauseReason): void {
      guard();
      if (!draft.run.autoPauseReasons.includes(reason)) {
        draft.run.autoPauseReasons.push(reason);
      }
    },
    schedule(effect: ScheduledEffectState): void {
      guard();
      draft.scheduledEffects.push(structuredClone(effect));
    },
    allocateId(namespace: IdNamespace, owner: string): string {
      guard();
      const counter = draft.run.idCounters[namespace] ?? 0;
      draft.run.idCounters[namespace] = counter + 1;
      return formatRunEntityId(namespace, owner, counter);
    },
    commit(audit: TransitionAudit): TransitionResult {
      guard();
      committed = true;
      const state = draft as GameState;
      assertInvariants(state);
      deepFreeze(state);
      return {
        state,
        domainEvents: events,
        autoPauseReasons: state.run.autoPauseReasons,
        audit,
      };
    },
  };
}
