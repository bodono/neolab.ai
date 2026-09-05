const BASE_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "seed",
  "idcounters",
  "hiddeninternalscandour",
  "hiddensafety",
  "truealignment",
  "corrigibility",
  "situationalawareness",
  "deceptivecapability",
  "deceptiveintent",
  "generatedbyrandomcontract",
  "truecapability",
  "trueseverity",
  "randomcontractversion",
  "levelprogressrp",
  "totalresearchpoints",
  "paperprogress",
  "truecapability",
  "completionreport",
  // Endgame ontic truth and keyed random resolutions. Player-safe selectors
  // may expose authored bands and visible factors, never these raw records.
  "superintelligencetruth",
  "probabilityatfirstcrossing",
  "lineagesirecords",
  "randomkey",
  "draw",
  "probability",
  "hiddenaudit",
  "genuinesuperintelligence",
  "selectedendingid",
  "gateresolutions",
  // Latent-artifact hazard internals. Custody views expose only actionable
  // labels, load/capacity summaries, and observed incidents.
  "trainingexposure",
  "hazardpressure",
  "incidentthreshold",
  "incidentthresholdkey",
  "incidentthresholddraw",
  "reviewoutcome",
]);

export interface HiddenKeyGuardOptions {
  readonly additionalForbiddenKeys?: readonly string[];
}

/**
 * Recursively fails if a player-facing projection acquires a canonical hidden
 * field. The shared list grows as later stages introduce new private truth.
 */
export function assertNoHiddenKeys(
  value: unknown,
  options: HiddenKeyGuardOptions = {},
): void {
  const forbidden = new Set(BASE_FORBIDDEN_KEYS);
  for (const key of options.additionalForbiddenKeys ?? []) {
    forbidden.add(key.toLowerCase());
  }
  visit(value, "$", forbidden, new Set<object>());
}

function visit(
  value: unknown,
  path: string,
  forbidden: ReadonlySet<string>,
  seen: Set<object>,
): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      visit(child, `${path}[${String(index)}]`, forbidden, seen);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalised = key.toLowerCase();
    if (normalised.startsWith("hidden") || forbidden.has(normalised)) {
      throw new Error(`Player view exposes forbidden hidden key ${path}.${key}`);
    }
    visit(child, `${path}.${key}`, forbidden, seen);
  }
}
