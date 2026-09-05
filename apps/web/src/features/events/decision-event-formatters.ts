import {
  formatValuation,
  modifierEffectPreview,
  type EventQueueOptionView,
} from "@neolab/sim/public";

type EventEffect = EventQueueOptionView["knownCosts"][number];

export type EventCopyRole = "title" | "body" | "label" | "preview" | "evidence";
export type EventCopyTokens = Readonly<Record<string, string | number>>;

function humaniseIdentifier(value: string): string {
  const semanticTail = value.split(":").at(-1) ?? value;
  return semanticTail
    .replaceAll("_", "-")
    .replaceAll(".", "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .split("-")
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part,
    )
    .join(" ");
}

const EVENT_RATING_LABELS: Readonly<Record<string, string>> = {
  captureConcern: "Government capture concern",
  evalQuality: "Evaluation quality",
  governmentAttention: "Government attention",
  governmentTrust: "Government trust",
  internalCandour: "Internal candour",
  practicalControlStrength: "Practical control strength",
  safetyCulture: "Safety culture",
  securityPosture: "Security posture",
  strategicDependence: "Strategic dependence",
};

function signedAmount(value: number): string {
  return `${value >= 0 ? "+" : "−"}${String(Math.abs(value))}`;
}

export function eventCopyFallback(
  key: string,
  tokens: EventCopyTokens,
  role: EventCopyRole,
): string {
  let interpolated = key;
  for (const [token, value] of Object.entries(tokens)) {
    interpolated = interpolated.replaceAll(`{${token}}`, String(value));
  }
  if (interpolated.includes(" ") || !interpolated.includes(".")) return interpolated;
  const parts = interpolated.split(".");
  const suffix = parts.at(-1);
  const semantic =
    suffix === "title" || suffix === "body" || suffix === "label" || suffix === "preview"
      ? parts.at(-2)
      : suffix;
  const label = humaniseIdentifier(semantic ?? "decision");
  return role === "body"
    ? `${label}. Review the evidence and declared consequences below.`
    : label;
}

export function formatEventEvidenceValue(
  metric: string | undefined,
  value: number,
): string {
  if (metric === "player.cash") {
    const rounded = Math.round(value * 10) / 10;
    return formatValuation(rounded);
  }
  return Math.round(value).toLocaleString("en-GB");
}

export function describeEventEffect(effect: EventEffect): string {
  switch (effect.kind) {
    case "add-resource": {
      // Cash is authored in $m; render it with the game's money notation
      // rather than a bare "-6 cash". Aura is a plain count.
      if (effect.resource === "cash") {
        return `${effect.amount >= 0 ? "+" : ""}${formatValuation(effect.amount)} cash`;
      }
      const aura = `${signedAmount(effect.amount)} Aura`;
      return effect.auraSignalImpact === undefined
        ? aura
        : `${aura} · ${signedAmount(effect.auraSignalImpact)} public Aura Signal`;
    }
    case "add-rating":
      return `${signedAmount(effect.amount)} ${
        EVENT_RATING_LABELS[effect.rating] ?? humaniseIdentifier(effect.rating)
      }`;
    case "add-coalition-rating":
      return `${signedAmount(effect.amount)} coalition ${humaniseIdentifier(effect.rating)}`;
    case "set-flag":
      return humaniseIdentifier(effect.flag);
    case "add-modifier": {
      const description = modifierEffectPreview(
        effect.target,
        effect.operation,
        effect.value,
      );
      return effect.durationWeeks === undefined
        ? description
        : `${description} for ${String(effect.durationWeeks)} week${
            effect.durationWeeks === 1 ? "" : "s"
          }`;
    }
    case "schedule-effects":
      return `Guaranteed consequence in ${String(effect.dueInWeeks)} week${
        effect.dueInWeeks === 1 ? "" : "s"
      }`;
  }
}

export function eventLikelihoodCopy(option: EventQueueOptionView): string {
  if (option.likelihoodPromises.length > 0) {
    return option.likelihoodPromises
      .map((promise) => humaniseIdentifier(promise.label).toUpperCase())
      .join(" · ");
  }
  return option.uncertainty === "precommitted-checks"
    ? "OUTCOME UNCERTAIN"
    : "GUARANTEED OUTCOME";
}
