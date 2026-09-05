import { contentId } from "@neolab/content-schema";

import type { SimulationTransaction } from "../engine/transaction.ts";
import type { ResearcherId } from "../model/ids.ts";
import type { EventInstanceState, GameState } from "../model/state.ts";

export const RESEARCHER_ULTIMATUM_EVENT_ID = contentId(
  "base:event.people.resignation-ultimatum",
);

const RESEARCHER_ID_TOKEN = "RESEARCHER_ID";
const ULTIMATUM_ID_TOKEN = "ULTIMATUM_ID";
const TRIGGER_PREFIX = "researcher-ultimatum:";

function eventUltimatumId(instance: Readonly<EventInstanceState>): string | undefined {
  const token = instance.tokens[ULTIMATUM_ID_TOKEN];
  if (typeof token === "string") return token;
  return instance.triggerKey?.startsWith(TRIGGER_PREFIX)
    ? instance.triggerKey.slice(TRIGGER_PREFIX.length)
    : undefined;
}

function matchesUltimatumEvent(
  instance: Readonly<EventInstanceState>,
  researcherId: ResearcherId,
  ultimatumId: string,
): boolean {
  if (
    instance.definitionId !== RESEARCHER_ULTIMATUM_EVENT_ID ||
    instance.tokens[RESEARCHER_ID_TOKEN] !== researcherId
  ) {
    return false;
  }
  const linkedUltimatumId = eventUltimatumId(instance);
  // Events in older saves did not persist ULTIMATUM_ID or a trigger key. The
  // researcher id is the only available identity for those legacy instances.
  return linkedUltimatumId === undefined || linkedUltimatumId === ultimatumId;
}

export function researcherUltimatumEventBlockers(
  state: Readonly<GameState>,
  instance: Readonly<EventInstanceState>,
): readonly string[] {
  if (instance.definitionId !== RESEARCHER_ULTIMATUM_EVENT_ID) return [];
  const researcherId = instance.tokens[RESEARCHER_ID_TOKEN];
  if (typeof researcherId !== "string") {
    return ["Researcher ultimatum target is unavailable"];
  }
  const researcher = state.researchers[researcherId as ResearcherId];
  const linkedUltimatumId = eventUltimatumId(instance);
  if (
    researcher?.ultimatum?.status !== "pending" ||
    (linkedUltimatumId !== undefined && researcher.ultimatum.id !== linkedUltimatumId)
  ) {
    return ["This ultimatum is no longer pending"];
  }
  return [];
}

export function invalidateResearcherUltimatumEvents(
  tx: SimulationTransaction,
  researcherId: ResearcherId,
  ultimatumId: string,
  reason: string,
): void {
  const instanceIds = Object.values(tx.read().eventInstances)
    .filter(
      (instance) =>
        instance.status === "unresolved" &&
        matchesUltimatumEvent(instance, researcherId, ultimatumId),
    )
    .map((instance) => instance.id);
  if (instanceIds.length === 0) return;

  tx.update((draft) => {
    for (const instanceId of instanceIds) {
      const instance = draft.eventInstances[instanceId];
      if (instance === undefined || instance.status !== "unresolved") continue;
      instance.status = "invalidated";
      instance.invalidationReason = reason;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: `Event invalidated: ${instance.definitionId} (${reason}).`,
        category: "event-invalidated",
        source: { kind: "event", id: instanceId },
        relatedIds: [instanceId, instance.definitionId, researcherId, ultimatumId],
      });
    }
  });
  for (const instanceId of instanceIds) {
    tx.emit({
      kind: "decision-event-invalidated",
      instanceId,
      reason,
    });
  }
}
