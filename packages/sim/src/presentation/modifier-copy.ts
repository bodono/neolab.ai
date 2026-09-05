const RESEARCH_DOMAIN_LABELS: Readonly<Record<string, string>> = {
  architectures: "Architectures",
  "alignment-control": "Alignment & Control",
  "interpretability-evals": "Interpretability & Evaluations",
  multimodality: "Multimodality",
  "optimisation-scaling": "Optimisation & Scaling",
  "reasoning-tools": "Reasoning & Tool Use",
  "reasoning-tool-use": "Reasoning & Tool Use",
  "reinforcement-agency": "Reinforcement Learning & Agency",
  "robotics-embodiment": "Robotics & Embodiment",
  "scientific-ai": "Scientific AI",
  "security-containment": "Security & Containment",
};

const MODIFIER_TARGET_LABELS: Readonly<Record<string, string>> = {
  "lab.organisation.boardPatienceTarget": "Legacy organisation term",
  "lab.compute.ownedDeliveryDuration": "Owned GPU delivery time",
  "lab.compute.ownedPowerCost": "Owned-GPU operating cost",
  "lab.compute.ownedPurchasePrice": "Owned GPU purchase price",
  "lab.compute.workloadThroughput": "Effective GPU throughput",
  "lab.evidence.displayedQuality": "Evaluation evidence quality",
  "lab.evaluation.cashCost": "Evaluation cash cost",
  "lab.market.acquisitionRate": "Customer market reach",
  "lab.market.demandCeiling": "Customer demand ceiling",
  "lab.organisation.internalCandourTarget": "Internal candour",
  "lab.organisation.safetyCultureTarget": "Safety culture",
  "lab.organisation.safetyCultureFloor": "Safety culture floor",
  "lab.politics.governmentTrustFloor": "Government trust floor",
  "lab.incident.hazard": "Incident risk",
  "lab.product.durationWeeks": "Future model launch time",
  // Says the cadence out loud. This is the only recurring Aura target, and
  // "+1" alone reads as a one-off grant rather than income -- which is the
  // entire difference between it and lab.aura.spendable.starting. Four weeks
  // is TICKS_PER_CYCLE; this module is a leaf with no imports, so the number
  // is written out rather than dragging the engine into presentation.
  "lab.aura.standingIncome": "Aura per cycle (4 weeks)",
  "lab.research.all.output": "Overall research output",
  "lab.research.alignment.output": "Alignment research output",
  "lab.research.capability.output": "Capability research output",
  "lab.research.diffusionRate": "Knowledge diffusion rate",
  "lab.research.interpretability.output": "Interpretability research output",
  "lab.research.safety.output": "Safety research output",
  "lab.research.security.output": "Security and containment research output",
  "lab.revenue.all": "All revenue",
  "lab.training.technicalFailureHazard": "Training technical-failure risk",
  "researcher.departurePressure": "Researcher departure pressure",
  "researcher.loyalty": "Researcher loyalty",
  "researcher.moraleTarget": "Researcher morale",
  "serving.computePerRequest": "Compute per served request",
  "world.rival.progress": "Rival research progress",
  "assignedProgramme.weeklyVarianceWidth":
    "Assigned programme week-to-week progress variation",
};

function humanizeIdentifier(value: string): string {
  const semanticTail = value.split(":").at(-1) ?? value;
  return semanticTail
    .replace(/^.*\//, "")
    .replaceAll(".", " ")
    .replaceAll("-", " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function weeklyProgressVariationScope(target: string): string | undefined {
  if (target === "assignedProgramme.weeklyVarianceWidth") {
    return "the assigned research programme";
  }
  const domain = /^lab\.research\.domain\.(.+)\.weeklyVarianceWidth$/.exec(target)?.[1];
  if (domain === undefined) return undefined;
  return RESEARCH_DOMAIN_LABELS[domain] ?? humanizeIdentifier(domain);
}

export function modifierTargetDisplayLabel(target: string): string {
  const exact = MODIFIER_TARGET_LABELS[target];
  if (exact !== undefined) return exact;
  const programme =
    /^(?:lab\.research\.domain\.|lab\.research\.program\.base:(?:domain|safety)\.)([^.]+)\.output$/.exec(
      target,
    )?.[1];
  if (programme !== undefined) {
    return `${RESEARCH_DOMAIN_LABELS[programme] ?? humanizeIdentifier(programme)} research output`;
  }
  const variationScope = weeklyProgressVariationScope(target);
  if (variationScope !== undefined) {
    const sentenceCaseScope =
      variationScope === "the assigned research programme"
        ? "Assigned programme"
        : variationScope;
    return `${sentenceCaseScope} week-to-week progress variation`;
  }
  return humanizeIdentifier(target.replace(/^(?:lab|world)\./, ""));
}

function compactNumber(value: number, decimalPlaces = 1): string {
  return String(Number(value.toFixed(decimalPlaces)));
}

export function modifierEffectPreview(
  target: string,
  operation: "add" | "multiply" | "min" | "max",
  value: number,
): string {
  const variationScope = weeklyProgressVariationScope(target);
  if (variationScope !== undefined && operation === "multiply") {
    const percentage = Math.abs((value - 1) * 100);
    if (value === 1) {
      return `Week-to-week progress in ${variationScope} is unchanged`;
    }
    return `Week-to-week progress in ${variationScope} becomes ${compactNumber(percentage)}% ${value < 1 ? "more consistent" : "less consistent"}`;
  }

  const label = modifierTargetDisplayLabel(target);
  switch (operation) {
    case "add":
      return `${label} ${value >= 0 ? "+" : "−"}${compactNumber(Math.abs(value), 2)}`;
    case "multiply": {
      const percentage = Math.abs((value - 1) * 100);
      if (value === 1) return `${label} unchanged`;
      return `${label} ${value > 1 ? "increases" : "decreases"} by ${compactNumber(percentage)}%`;
    }
    case "min":
      return `${label} capped at ${compactNumber(value, 2)}`;
    case "max":
      return `${label} cannot fall below ${compactNumber(value, 2)}`;
  }
}
