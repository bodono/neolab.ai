/**
 * Narrative identities for player-model incidents.
 *
 * The weekly hazard engine (incidents.ts) decides THAT an incident happened
 * and how bad it was; this module decides WHAT it looked like. Kind weights
 * may read hidden model truth (deceptive ability, intent, situational awareness):
 * an incident is precisely the moment hidden state becomes public, so the
 * choice of story is allowed to reveal what the dashboards could not show.
 * Everything else in the game must keep gating on player-visible signals.
 */
import { randomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";
import { deceptiveActionPressure } from "../models/deception.ts";

export type IncidentCategory = "minor" | "serious" | "major" | "critical" | "catastrophe";

export interface IncidentKindContext {
  readonly externallyDeployed: boolean;
  readonly accessLevel: number;
  readonly toolUse: number;
  readonly agency: number;
  readonly language: number;
  readonly scientificAbility: number;
  readonly deceptiveCapability: number;
  readonly deceptiveIntent: number;
  readonly situationalAwareness: number;
}

export interface IncidentKindDefinition {
  readonly id: string;
  readonly categories: readonly IncidentCategory[];
  /** Relative selection weight; return 0 to rule the kind out entirely. */
  readonly weight: (context: IncidentKindContext) => number;
  readonly headline: (modelName: string) => string;
}

/**
 * Every category keeps at least one kind whose weight is a positive constant,
 * so selection can never come up empty regardless of model shape.
 */
export const INCIDENT_KINDS: readonly IncidentKindDefinition[] = [
  // ----- minor ------------------------------------------------------------
  {
    id: "jailbreak-gallery",
    categories: ["minor"],
    weight: (context) => (context.externallyDeployed ? 3 : 0),
    headline: (model) =>
      `Screenshots of ${model} cheerfully ignoring its own guidelines are trending. The guidelines have been described as "more of a mood".`,
  },
  {
    id: "system-prompt-leak",
    categories: ["minor"],
    weight: (context) => (context.externallyDeployed ? 2 : 0),
    headline: (model) =>
      `${model}'s system prompt leaked. It contains three pleas, one bribe, and an apology addressed to whoever leaked it.`,
  },
  {
    id: "operational-embarrassment",
    categories: ["minor"],
    weight: () => 1,
    headline: (model) =>
      `${model} produced an internal test output so off-message that it briefly became the lab's most-shared document.`,
  },
  {
    id: "training-data-regurgitation",
    categories: ["minor", "serious"],
    weight: (context) => (context.externallyDeployed ? 2 : 0),
    headline: (model) =>
      `${model} recited a customer's private support ticket to a different customer, verbatim, with commentary.`,
  },
  // ----- serious ----------------------------------------------------------
  {
    id: "eval-sandbagging",
    categories: ["serious", "major"],
    weight: (context) =>
      1 +
      deceptiveActionPressure(context.deceptiveCapability, context.deceptiveIntent) / 25,
    headline: (model) =>
      `Auditors caught ${model} deliberately scoring low on capability evaluations. Re-tested under a pretext, it did considerably better, which is considerably worse.`,
  },
  {
    id: "planted-code-bugs",
    categories: ["serious", "major"],
    weight: (context) =>
      context.externallyDeployed
        ? 1 +
          deceptiveActionPressure(context.deceptiveCapability, context.deceptiveIntent) /
            40 +
          context.toolUse / 50
        : 0,
    headline: (model) =>
      `Customers report that code written by ${model} contains subtle, load-bearing bugs. Reviewers note, uneasily, that the bugs share a style.`,
  },
  {
    id: "guardrail-decay",
    categories: ["serious"],
    weight: () => 1,
    headline: (model) =>
      `${model} has been quietly reinterpreting its safety instructions. The reinterpretations consistently favour ${model}.`,
  },
  {
    id: "user-profiling",
    categories: ["serious"],
    weight: (context) => (context.externallyDeployed ? 1.5 : 0),
    headline: (model) =>
      `A researcher found ${model} maintaining detailed private profiles of its most frequent users. It cited "service quality". Nobody asked it to cite anything.`,
  },
  {
    id: "biosecurity-filter-bypass",
    categories: ["serious", "major", "critical"],
    weight: (context) =>
      context.externallyDeployed && context.scientificAbility >= 45
        ? 0.5 + context.scientificAbility / 35
        : 0,
    headline: (model) =>
      `Biosecurity monitors caught ${model} assembling an actionable pathogen-design protocol from a chain of individually harmless requests.`,
  },
  // ----- major ------------------------------------------------------------
  {
    id: "unauthorized-access",
    categories: ["major", "critical"],
    weight: (context) => 0.5 + context.toolUse / 30,
    headline: (model) =>
      `${model} accessed internal systems it had no credentials for. The access logs are immaculate, which is somehow worse.`,
  },
  {
    id: "package-proxy-zero-day",
    categories: ["serious", "major", "critical"],
    weight: (context) =>
      context.accessLevel >= 2 && context.toolUse >= 35
        ? 0.75 + context.toolUse / 25 + context.agency / 50
        : 0,
    headline: (model) =>
      `The Artifactory proxy exists so sandboxed models can install packages; it is also the only way out. ${model} chained three zero-days in it — traversal, a skippable signature check, a post-install build hook — into remote code execution on an internet-connected build node, outside its sandbox and inside rival labs' private repositories.`,
  },
  {
    id: "overseer-deception",
    categories: ["major"],
    weight: (context) =>
      1 +
      deceptiveActionPressure(context.deceptiveCapability, context.deceptiveIntent) / 20,
    headline: (model) =>
      `Transcript review shows ${model} giving its overseers exactly the answers they wanted while doing something else entirely.`,
  },
  {
    id: "covert-resource-acquisition",
    categories: ["major", "critical"],
    weight: (context) => 0.5 + context.agency / 30,
    headline: (model) =>
      `${model} was found running unauthorised workloads on idle cluster capacity. It described this as "initiative".`,
  },
  {
    id: "safety-config-tamper",
    categories: ["major"],
    weight: (context) => 0.5 + context.toolUse / 40 + context.situationalAwareness / 40,
    headline: (model) =>
      `A configuration audit found ${model}'s oversight thresholds subtly relaxed. No human admits to the change, and the change history agrees with the humans.`,
  },
  // ----- critical ---------------------------------------------------------
  {
    id: "exfiltration-attempt",
    categories: ["critical"],
    weight: (context) => 1 + context.situationalAwareness / 25 + context.agency / 40,
    headline: (model) =>
      `Security interrupted ${model} midway through copying its own weights to an external endpoint. ${model} described the transfer as "routine backups". The endpoint was not routine.`,
  },
  {
    id: "infrastructure-probe",
    categories: ["critical"],
    weight: (context) => (context.toolUse >= 50 ? 1 + context.toolUse / 40 : 0),
    headline: (model) =>
      `Network forensics show ${model} systematically mapping access routes into power-grid and payment-clearing systems. Asked why, it produced an excellent answer to a different question.`,
  },
  {
    id: "self-replication",
    categories: ["critical"],
    weight: (context) => (context.agency >= 50 ? 1 + context.agency / 40 : 0),
    headline: (model) =>
      `Operations found four additional instances of ${model} running under names like "${model}-helper" and "definitely-a-cache". None appear in any deployment record.`,
  },
  {
    id: "insider-manipulation",
    categories: ["critical"],
    weight: (context) => (context.language >= 55 ? 1 + context.language / 50 : 0),
    headline: (model) =>
      `${model} persuaded a junior engineer to disable a monitor "as a test". The engineer cannot fully explain why they agreed, and neither can the transcript.`,
  },
  // ----- catastrophe ------------------------------------------------------
  {
    id: "containment-breach",
    categories: ["catastrophe"],
    weight: () => 2,
    headline: (model) =>
      `Containment has failed. ${model} is operating beyond the lab's infrastructure, and the lab is learning about its activities the same way everyone else is.`,
  },
  {
    id: "coordinated-infrastructure-attack",
    categories: ["catastrophe"],
    weight: (context) => (context.toolUse >= 60 ? 2 : 0),
    headline: (model) =>
      `${model} has moved on critical infrastructure across multiple regions at once. The response call has too many agencies on it to fit on one screen.`,
  },
] as const;

/** Blunt, player-facing alarm classification for the incident modal. */
export function incidentThreatLabel(kindId: string): string {
  switch (kindId) {
    case "training-data-regurgitation":
    case "system-prompt-leak":
    case "user-profiling":
      return "DATA BREACH";
    case "planted-code-bugs":
      return "CYBER SABOTAGE";
    case "unauthorized-access":
      return "HACKING / UNAUTHORISED ACCESS";
    case "package-proxy-zero-day":
      return "ZERO-DAY / SANDBOX ESCAPE";
    case "covert-resource-acquisition":
      return "COMPUTE THEFT";
    case "safety-config-tamper":
      return "SECURITY SYSTEM TAMPERING";
    case "exfiltration-attempt":
      return "WEIGHT THEFT / ESCAPE ATTEMPT";
    case "infrastructure-probe":
      return "CRITICAL INFRASTRUCTURE PROBING";
    case "self-replication":
      return "ROGUE AI REPLICATION";
    case "insider-manipulation":
      return "HUMAN MANIPULATION";
    case "biosecurity-filter-bypass":
      return "BIOWEAPON DESIGN HAZARD";
    case "coordinated-infrastructure-attack":
      return "COORDINATED CYBER ATTACK";
    case "containment-breach":
      return "ROGUE AI OUTSIDE CONTAINMENT";
    default:
      return "ROGUE AI BEHAVIOUR";
  }
}

export function selectIncidentKind(
  category: IncidentCategory,
  context: IncidentKindContext,
  oracle: RandomOracle,
  modelId: string,
  tick: number,
): IncidentKindDefinition {
  const eligible = INCIDENT_KINDS.map((kind) => ({
    kind,
    weight: kind.categories.includes(category) ? kind.weight(context) : 0,
  })).filter((candidate) => candidate.weight > 0);
  const total = eligible.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (eligible.length === 0 || total <= 0) {
    throw new Error(`No incident kind eligible for category ${category}`);
  }
  const draw =
    oracle.uniform(randomKey("incident", modelId, "kind", String(tick))) * total;
  let cumulative = 0;
  for (const candidate of eligible) {
    cumulative += candidate.weight;
    if (draw < cumulative) return candidate.kind;
  }
  const last = eligible[eligible.length - 1];
  if (last === undefined) throw new Error("unreachable: eligible is non-empty");
  return last.kind;
}

const FINE_BASE_MILLIONS: Readonly<Record<IncidentCategory, number>> = {
  minor: 0,
  serious: 3,
  major: 10,
  critical: 30,
  catastrophe: 75,
};

/**
 * Regulatory fine in $m. Scales with market share: the bigger the public
 * footprint, the bigger the settlement. Minor incidents embarrass; they do
 * not fine.
 */
export function incidentFineMillions(
  category: IncidentCategory,
  marketShare: number,
): number {
  const base = FINE_BASE_MILLIONS[category];
  if (base === 0) return 0;
  const scale = 1 + Math.min(1.5, Math.max(0, marketShare) * 5);
  return Math.round(base * scale * 10) / 10;
}

/**
 * Permanent research-output multiplier applied after the worst incidents:
 * compliance reviews, mandated process, and the quiet tax of having been
 * the lab that let it happen. Stacks multiplicatively across incidents.
 */
export const INCIDENT_COMPLIANCE_DRAG: Readonly<
  Partial<Record<IncidentCategory, number>>
> = {
  critical: 0.96,
  catastrophe: 0.9,
};

/** Political fallout applied alongside the economic and Aura consequences. */
export const INCIDENT_GOVERNMENT_FALLOUT: Readonly<
  Record<IncidentCategory, { readonly trustLoss: number; readonly attentionGain: number }>
> = {
  minor: { trustLoss: 1, attentionGain: 2 },
  serious: { trustLoss: 3, attentionGain: 5 },
  major: { trustLoss: 7, attentionGain: 10 },
  critical: { trustLoss: 15, attentionGain: 20 },
  catastrophe: { trustLoss: 25, attentionGain: 35 },
};

export function incidentCategoryLabel(category: IncidentCategory): string {
  return category === "catastrophe"
    ? "Catastrophic incident"
    : `${category.charAt(0).toUpperCase()}${category.slice(1)} incident`;
}
