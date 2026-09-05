export type ResearcherDepartureReason =
  "voluntary" | "poached" | "dismissed" | "ultimatum-expired";

const DEPARTURE_REASON_PATTERN = /\((voluntary|poached|dismissed|ultimatum-expired)\)/;
const DEPARTURE_NAME_PATTERN = /^(.+?) (?:left the lab|departed) \(/;

export function parseResearcherDepartureName(summary: string): string | undefined {
  const name = DEPARTURE_NAME_PATTERN.exec(summary)?.[1]?.trim();
  return name === undefined || name.includes(":") ? undefined : name;
}

export function parseResearcherDepartureReason(
  summary: string,
): ResearcherDepartureReason | undefined {
  return DEPARTURE_REASON_PATTERN.exec(summary)?.[1] as
    ResearcherDepartureReason | undefined;
}

export function unacknowledgedCurrentDepartureKey(
  entry: { readonly tick: number; readonly summary: string } | undefined,
  currentTick: number,
  pauseActive: boolean,
  acknowledgedKeys: ReadonlySet<string>,
): string | undefined {
  if (!pauseActive || entry?.tick !== currentTick) return undefined;
  const key = `${String(entry.tick)}:${entry.summary}`;
  return acknowledgedKeys.has(key) ? undefined : key;
}

export function describeResearcherDeparture(
  reason: ResearcherDepartureReason | undefined,
): string {
  switch (reason) {
    case "poached":
      return "They accepted an offer from a rival lab.";
    case "dismissed":
      return "The lab ended their appointment.";
    case "ultimatum-expired":
      return "They left after their ultimatum expired without a resolution.";
    case "voluntary":
      return "They chose to leave the lab.";
    case undefined:
      return "Their departure has been recorded in the Lab feed.";
  }
}
