export type FleetCapacityState = "available" | "full" | "over";

export interface FleetCapacitySummary {
  readonly committedPhysicalGpus: number;
  readonly supportedPhysicalGpus: number;
  readonly freePhysicalGpus: number;
  readonly state: FleetCapacityState;
  readonly label: string;
}

function formatGpuCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function summarizeFleetCapacity({
  ownedPhysicalGpus,
  incomingPhysicalGpus,
  supportedPhysicalGpus,
}: {
  readonly ownedPhysicalGpus: number;
  readonly incomingPhysicalGpus: number;
  readonly supportedPhysicalGpus: number;
}): FleetCapacitySummary {
  const committedPhysicalGpus = ownedPhysicalGpus + incomingPhysicalGpus;
  const freePhysicalGpus = Math.max(0, supportedPhysicalGpus - committedPhysicalGpus);
  const overCapacity = Math.max(0, committedPhysicalGpus - supportedPhysicalGpus);
  const state: FleetCapacityState =
    overCapacity > 0 ? "over" : freePhysicalGpus > 0 ? "available" : "full";
  const status =
    state === "over"
      ? `${formatGpuCount(overCapacity)} over`
      : state === "full"
        ? "Full"
        : `${formatGpuCount(freePhysicalGpus)} free`;

  return {
    committedPhysicalGpus,
    supportedPhysicalGpus,
    freePhysicalGpus,
    state,
    label: `Capacity ${formatGpuCount(committedPhysicalGpus)} / ${formatGpuCount(supportedPhysicalGpus)} GPUs · ${status}`,
  };
}
