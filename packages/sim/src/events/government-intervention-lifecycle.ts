import type { SimulationTransaction } from "../engine/transaction.ts";

/** The mandatory-event occurrence key shared by every variant for one intervention. */
export function governmentInterventionTriggerKey(interventionId: string): string {
  return `government-intervention:${interventionId}`;
}

/**
 * Withdraw any still-open event for an intervention that has been settled
 * some other way. A successful lobbying project resolves the intervention
 * directly; its event used to stay open, expire to its default, and apply
 * the full restriction the lobbying had just negotiated away.
 */
export function invalidateGovernmentInterventionEvents(
  tx: SimulationTransaction,
  interventionId: string,
  reason: string,
): void {
  const triggerKey = governmentInterventionTriggerKey(interventionId);
  const instanceIds = Object.values(tx.read().eventInstances)
    .filter(
      (instance) =>
        instance.status === "unresolved" && instance.triggerKey === triggerKey,
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
        relatedIds: [instanceId, instance.definitionId, interventionId],
      });
    }
  });
  for (const instanceId of instanceIds) {
    tx.emit({ kind: "decision-event-invalidated", instanceId, reason });
  }
}
