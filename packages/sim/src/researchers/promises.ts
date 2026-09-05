import type { SimulationTransaction } from "../engine/transaction.ts";
import type { ResearcherId } from "../model/ids.ts";
import type {
  GameState,
  ResearcherMemoryEffectState,
  ResearcherMemoryState,
  ResearcherPromiseConditionState,
  ResearcherPromiseState,
  ResearcherState,
} from "../model/state.ts";
import { fraction, rating, tick } from "../model/units.ts";

export interface AddResearcherPromiseRequest {
  readonly researcherId: ResearcherId;
  readonly label: string;
  readonly dueInWeeks: number;
  readonly condition: ResearcherPromiseConditionState;
  readonly severity: ResearcherPromiseState["severity"];
  readonly keptMemory: ResearcherMemoryEffectState;
  readonly brokenMemory: ResearcherMemoryEffectState;
}

const LAB_METRICS: Readonly<Record<string, (state: Readonly<GameState>) => number>> = {
  safetyCulture: (state) => state.labs[state.run.playerLabId]?.safety.safetyCulture ?? 0,
  alignmentScience: (state) =>
    state.labs[state.run.playerLabId]?.safety.alignmentScience ?? 0,
  evalQuality: (state) => state.labs[state.run.playerLabId]?.safety.evalQuality ?? 0,
  securityPosture: (state) =>
    state.labs[state.run.playerLabId]?.safety.securityPosture ?? 0,
  boardPatience: (state) =>
    state.labs[state.run.playerLabId]?.organisation.boardPatience ?? 0,
  internalCandour: (state) =>
    state.labs[state.run.playerLabId]?.organisation.hiddenInternalCandour ?? 0,
  spendableAura: (state) => state.labs[state.run.playerLabId]?.aura.spendable ?? 0,
};

export const ZERO_RESEARCHER_MEMORY_EFFECT: ResearcherMemoryEffectState = {
  morale: 0,
  loyalty: 0,
  burnout: 0,
  departurePressure: 0,
};

function requireResearcher(
  state: Readonly<GameState>,
  researcherId: ResearcherId,
): ResearcherState {
  const researcher = state.researchers[researcherId];
  if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
  return researcher;
}

function finiteEffect(effect: ResearcherMemoryEffectState): boolean {
  return [effect.morale, effect.loyalty, effect.burnout, effect.departurePressure].every(
    Number.isFinite,
  );
}

function requiredWeeks(condition: ResearcherPromiseConditionState): number | undefined {
  return condition.kind === "assignment-maintained" ||
    condition.kind === "gpu-share-maintained"
    ? condition.requiredWeeks
    : undefined;
}

export function addResearcherPromise(
  tx: SimulationTransaction,
  request: AddResearcherPromiseRequest,
): ResearcherPromiseState {
  const state = tx.read();
  const researcher = requireResearcher(state, request.researcherId);
  if (researcher.status !== "employed" && researcher.status !== "sabbatical") {
    throw new Error(`Cannot make a promise to ${request.researcherId} while unavailable`);
  }
  if (!Number.isInteger(request.dueInWeeks) || request.dueInWeeks <= 0) {
    throw new RangeError("Researcher promises require a positive whole-week deadline");
  }
  const minimumWeeks = requiredWeeks(request.condition);
  if (
    minimumWeeks !== undefined &&
    (!Number.isInteger(minimumWeeks) ||
      minimumWeeks <= 0 ||
      minimumWeeks > request.dueInWeeks)
  ) {
    throw new RangeError(
      "A maintained promise must require one or more weeks within its deadline",
    );
  }
  if (!finiteEffect(request.keptMemory) || !finiteEffect(request.brokenMemory)) {
    throw new RangeError("Researcher promise memory effects must be finite");
  }
  const promise: ResearcherPromiseState = {
    id: tx.allocateId("promise", "world"),
    label: request.label,
    madeAt: state.run.tick,
    dueAt: tick(state.run.tick + request.dueInWeeks),
    condition: structuredClone(request.condition),
    severity: request.severity,
    status: "pending",
    progress: fraction(0),
    satisfiedWeeks: 0,
    keptMemory: structuredClone(request.keptMemory),
    brokenMemory: structuredClone(request.brokenMemory),
  };
  tx.update((draft) => {
    const mutable = draft.researchers[request.researcherId];
    if (mutable === undefined)
      throw new Error(`Unknown researcher ${request.researcherId}`);
    mutable.promises.push(structuredClone(promise));
    draft.decisionLog.push({
      tick: state.run.tick,
      summary: `Promise made to ${request.researcherId}: ${request.label}`,
    });
  });
  tx.emit({
    kind: "researcher-promise-added",
    researcherId: request.researcherId,
    promiseId: promise.id,
    dueAt: promise.dueAt,
  });
  return promise;
}

export function recordResearcherMemory(
  tx: SimulationTransaction,
  researcherId: ResearcherId,
  input: Omit<ResearcherMemoryState, "id" | "occurredAt">,
): ResearcherMemoryState {
  const now = tx.read().run.tick;
  const memory: ResearcherMemoryState = {
    id: tx.allocateId("people", "world"),
    occurredAt: now,
    ...structuredClone(input),
  };
  tx.update((draft) => {
    const researcher = draft.researchers[researcherId];
    if (researcher === undefined) throw new Error(`Unknown researcher ${researcherId}`);
    const clamp = (value: number): number => Math.min(100, Math.max(0, value));
    researcher.morale = rating(clamp(researcher.morale + memory.effect.morale));
    researcher.loyalty = rating(clamp(researcher.loyalty + memory.effect.loyalty));
    researcher.burnout = rating(clamp(researcher.burnout + memory.effect.burnout));
    researcher.departurePressure = rating(
      clamp(researcher.departurePressure + memory.effect.departurePressure),
    );
    researcher.memories.push(structuredClone(memory));
  });
  return memory;
}

interface PromiseProgress {
  readonly progress: number;
  readonly satisfiedWeeks: number;
}

function evaluateCondition(
  state: Readonly<GameState>,
  researcher: ResearcherState,
  promise: ResearcherPromiseState,
): PromiseProgress {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Player lab missing");
  const condition = promise.condition;
  switch (condition.kind) {
    case "lab-metric-at-least": {
      const read = LAB_METRICS[condition.metric];
      const flagged = lab.flags[`metric:${condition.metric}`];
      const value = read?.(state) ?? (typeof flagged === "number" ? flagged : undefined);
      if (value === undefined) {
        throw new Error(`Unknown promise metric ${condition.metric}`);
      }
      return { progress: value >= condition.value ? 1 : 0, satisfiedWeeks: 0 };
    }
    case "lab-flag-equals":
      return {
        progress: lab.flags[condition.flag] === condition.value ? 1 : 0,
        satisfiedWeeks: 0,
      };
    case "facility-completed":
      return {
        progress: lab.facilities.instances.some(
          (facility) => facility.definitionId === condition.definitionId,
        )
          ? 1
          : 0,
        satisfiedWeeks: 0,
      };
    case "action-count-at-least": {
      const count = lab.flags[`action:${condition.tag}:count`];
      return {
        progress:
          typeof count === "number" && count >= condition.count
            ? 1
            : Math.max(
                0,
                Math.min(1, (typeof count === "number" ? count : 0) / condition.count),
              ),
        satisfiedWeeks: 0,
      };
    }
    case "assignment-maintained": {
      const matches =
        researcher.assignment?.kind === condition.assignmentKind &&
        (condition.targetId === undefined ||
          researcher.assignment.targetId === condition.targetId);
      const satisfiedWeeks = matches ? promise.satisfiedWeeks + 1 : 0;
      return {
        progress: Math.min(1, satisfiedWeeks / condition.requiredWeeks),
        satisfiedWeeks,
      };
    }
    case "gpu-share-maintained": {
      const actual =
        condition.pool === "capability"
          ? lab.compute.allocation.capabilityBasisPoints
          : 10_000 - lab.compute.allocation.capabilityBasisPoints;
      const meets = actual >= condition.minimumBasisPoints;
      const satisfiedWeeks = meets ? promise.satisfiedWeeks + 1 : 0;
      return {
        progress: Math.min(1, satisfiedWeeks / condition.requiredWeeks),
        satisfiedWeeks,
      };
    }
  }
}

/** Resolve pending promise progress and apply each outcome's memory exactly once. */
export function evaluateResearcherPromises(tx: SimulationTransaction): void {
  const snapshot = tx.read();
  for (const researcher of Object.values(snapshot.researchers)) {
    if (researcher.status !== "employed" && researcher.status !== "sabbatical") {
      continue;
    }
    for (const promise of researcher.promises) {
      if (promise.status !== "pending") continue;
      const current = requireResearcher(tx.read(), researcher.id);
      const livePromise = current.promises.find(
        (candidate) => candidate.id === promise.id,
      );
      if (livePromise === undefined || livePromise.status !== "pending") continue;
      const result = evaluateCondition(tx.read(), current, livePromise);
      const kept = result.progress >= 1;
      const broken = !kept && tx.read().run.tick >= livePromise.dueAt;
      tx.update((draft) => {
        const mutable = draft.researchers[researcher.id]?.promises.find(
          (candidate) => candidate.id === promise.id,
        );
        if (mutable === undefined) throw new Error(`Unknown promise ${promise.id}`);
        mutable.progress = fraction(result.progress);
        mutable.satisfiedWeeks = result.satisfiedWeeks;
        if (kept || broken) {
          mutable.status = kept ? "kept" : "broken";
          mutable.resolvedAt = draft.run.tick;
        }
      });
      if (!kept && !broken) continue;
      const memory = kept ? livePromise.keptMemory : livePromise.brokenMemory;
      recordResearcherMemory(tx, researcher.id, {
        kind: kept ? "promise-kept" : "promise-broken",
        summary: `${livePromise.label} was ${kept ? "kept" : "broken"}`,
        effect: memory,
        flagrant: !kept && livePromise.severity === "flagrant",
      });
      tx.update((draft) => {
        draft.decisionLog.push({
          tick: draft.run.tick,
          summary: `${researcher.id}: ${livePromise.label} was ${kept ? "kept" : "broken"}`,
        });
        draft.domainLog.push({
          tick: draft.run.tick,
          code: `researcher.promise.${kept ? "kept" : "broken"}:${researcher.id}:${livePromise.id}`,
        });
      });
      tx.emit({
        kind: kept ? "researcher-promise-kept" : "researcher-promise-broken",
        researcherId: researcher.id,
        promiseId: livePromise.id,
        flagrant: !kept && livePromise.severity === "flagrant",
      });
    }
  }
}
