import {
  isRoundEffectValue,
  nearestRoundEffectValue,
  type CompiledContent,
  type EventEffectDefinition,
  type RoundedEffectOperation,
} from "@neolab/content-schema";

/**
 * Release lint for the owner's rule that every player-facing bonus is real,
 * visible and round (see `isRoundEffectValue` in @neolab/content-schema).
 *
 * It walks every authored effect and modifier in the compiled bundle that a
 * player sees as a bonus or penalty: event effects, researcher signature,
 * passive and compact effects, leader bonuses, mandates, difficulties, paper
 * unlock effects, facility modifiers and research specialisations (generic
 * advances). Caps and floors (`min`/`max`), event cash (era-scaled and rounded
 * at runtime), durations, probabilities and weights are not bonuses and are
 * not checked.
 */

export type RoundValueArea =
  | "event"
  | "researcher"
  | "researcher-rules"
  | "leader"
  | "mandate"
  | "difficulty"
  | "paper"
  | "facility"
  | "generic-advance";

export interface NonRoundValue {
  readonly area: RoundValueArea;
  /** Repo-relative authored file, when the compiler supplied one. */
  readonly file: string;
  /** Compiled definition that carries the value. */
  readonly entityId: string;
  /** Path to the value inside the compiled bundle. */
  readonly location: string;
  readonly target: string;
  readonly operation: RoundedEffectOperation;
  readonly value: number;
  /** Nearest round value in the same direction of effect. */
  readonly suggestion: number;
}

export interface RoundValueAllowance {
  readonly target: string;
  readonly operation: RoundedEffectOperation;
  readonly reason: string;
}

/**
 * Deliberate exceptions. Each one must say why a round value would break the
 * author's intent rather than merely look different.
 */
export const ROUND_VALUE_ALLOWANCES: readonly RoundValueAllowance[] = [
  {
    target: "lab.research.diffusionRate",
    operation: "add",
    reason:
      "a rate, not a flat bonus: each colleague skill point (0-5 scale) adds this many research-output percentage points, and the card says so per skill point; whole-number rates would quadruple knowledge diffusion and erase the 0.25/0.4/0.6 step between campus facilities",
  },
];

/** Where each area is authored when the compiler did not name a file. */
const AREA_FALLBACK_FILES: Readonly<Record<RoundValueArea, string>> = {
  event: "content/events",
  researcher: "content/researchers",
  "researcher-rules": "content/researchers/rules.yaml",
  leader: "content/labs/launch.yaml",
  mandate: "content/balance.yaml",
  difficulty: "content/balance.yaml",
  paper: "content/research/papers-a.yaml",
  facility: "content/facilities/core-stage-2.yaml",
  "generic-advance": "content/research/domains.yaml",
};

interface EffectLike {
  readonly target: string;
  readonly operation: string;
  readonly value: unknown;
}

function isAllowed(target: string, operation: RoundedEffectOperation): boolean {
  return ROUND_VALUE_ALLOWANCES.some(
    (allowance) => allowance.target === target && allowance.operation === operation,
  );
}

export function findNonRoundPlayerFacingValues(
  content: CompiledContent,
  authoredSources: Readonly<Record<string, string>> = {},
): readonly NonRoundValue[] {
  const findings: NonRoundValue[] = [];
  const check = (
    area: RoundValueArea,
    entityId: string,
    location: string,
    target: string,
    operation: string,
    value: unknown,
  ): void => {
    if (operation !== "add" && operation !== "multiply") return;
    if (typeof value !== "number") return;
    if (isAllowed(target, operation) || isRoundEffectValue(operation, value)) return;
    findings.push({
      area,
      file: authoredSources[entityId] ?? AREA_FALLBACK_FILES[area],
      entityId,
      location,
      target,
      operation,
      value,
      suggestion: nearestRoundEffectValue(operation, value),
    });
  };
  const checkEffects = (
    area: RoundValueArea,
    entityId: string,
    location: string,
    effects: readonly EffectLike[],
  ): void => {
    effects.forEach((effect, index) =>
      check(
        area,
        entityId,
        `${location}[${String(index)}]`,
        effect.target,
        effect.operation,
        effect.value,
      ),
    );
  };

  for (const [eventKey, event] of Object.entries(content.events.definitions)) {
    const visit = (effect: EventEffectDefinition, location: string): void => {
      switch (effect.kind) {
        case "add-modifier":
          check(
            "event",
            event.id,
            location,
            effect.target,
            effect.operation,
            effect.value,
          );
          return;
        case "add-rating":
          check(
            "event",
            event.id,
            location,
            `rating.${effect.rating}`,
            "add",
            effect.amount,
          );
          return;
        case "add-coalition-rating":
          check(
            "event",
            event.id,
            location,
            `coalition.${effect.rating}`,
            "add",
            effect.amount,
          );
          return;
        case "add-resource":
          // Cash is era-scaled at runtime and rounded where it is shown.
          if (effect.resource !== "cash") {
            check("event", event.id, location, effect.resource, "add", effect.amount);
          }
          return;
        case "schedule-effects":
          effect.effects.forEach((child, index) =>
            visit(child, `${location}.effects[${String(index)}]`),
          );
          return;
        case "set-flag":
          return;
      }
    };
    event.options.forEach((option, optionIndex) => {
      const optionLocation = `events.definitions.${eventKey}.options[${String(optionIndex)}]`;
      option.knownCosts.forEach((effect, index) =>
        visit(effect, `${optionLocation}.knownCosts[${String(index)}]`),
      );
      option.immediateEffects.forEach((effect, index) =>
        visit(effect, `${optionLocation}.immediateEffects[${String(index)}]`),
      );
      option.checks.forEach((eventCheck, checkIndex) =>
        eventCheck.outcomes.forEach((outcome, outcomeIndex) =>
          outcome.effects.forEach((effect, index) =>
            visit(
              effect,
              `${optionLocation}.checks[${String(checkIndex)}].outcomes[${String(outcomeIndex)}].effects[${String(index)}]`,
            ),
          ),
        ),
      );
    });
  }

  for (const [researcherKey, researcher] of Object.entries(
    content.researchers.definitions,
  )) {
    const base = `researchers.definitions.${researcherKey}`;
    for (const abilityKey of ["signature", "passive"] as const) {
      const ability = researcher[abilityKey];
      checkEffects(
        "researcher",
        researcher.id,
        `${base}.${abilityKey}.effects`,
        ability.effects,
      );
      ability.modes.forEach((mode, modeIndex) =>
        checkEffects(
          "researcher",
          researcher.id,
          `${base}.${abilityKey}.modes[${String(modeIndex)}].effects`,
          mode.effects,
        ),
      );
    }
    checkEffects(
      "researcher",
      researcher.id,
      `${base}.compact.attachedEffects`,
      researcher.compact.attachedEffects,
    );
    checkEffects(
      "researcher",
      researcher.id,
      `${base}.compact.fulfilmentEffects`,
      researcher.compact.fulfilmentEffects,
    );
  }
  checkEffects(
    "researcher-rules",
    "researchers.rules",
    "researchers.rules.compact.breachEffects",
    content.researchers.rules.compact.breachEffects,
  );

  for (const [leaderKey, leader] of Object.entries(content.leaders)) {
    const base = `leaders.${leaderKey}`;
    checkEffects(
      "leader",
      leader.id,
      `${base}.headlineBonus.effects`,
      leader.headlineBonus.effects,
    );
    leader.labModifiers.forEach((group, groupIndex) =>
      checkEffects(
        "leader",
        leader.id,
        `${base}.labModifiers[${String(groupIndex)}].effects`,
        group.effects,
      ),
    );
  }

  for (const [mandateKey, mandate] of Object.entries(content.mandates)) {
    checkEffects(
      "mandate",
      mandate.id,
      `mandates.${mandateKey}.effects`,
      mandate.effects,
    );
  }

  for (const [difficultyKey, difficulty] of Object.entries(content.difficulties)) {
    const base = `difficulties.${difficultyKey}`;
    for (const field of [
      "revenueMultiplier",
      "fixedCostMultiplier",
      "rivalProgressMultiplier",
      "incidentPressureMultiplier",
    ] as const) {
      check(
        "difficulty",
        difficulty.id,
        `${base}.${field}`,
        field,
        "multiply",
        difficulty[field],
      );
    }
    check(
      "difficulty",
      difficulty.id,
      `${base}.displayedEstimateQualityBonus`,
      "displayedEstimateQualityBonus",
      "add",
      difficulty.displayedEstimateQualityBonus,
    );
  }

  for (const [paperKey, paper] of Object.entries(content.papers.definitions)) {
    checkEffects(
      "paper",
      paper.id,
      `papers.definitions.${paperKey}.unlockEffects`,
      paper.unlockEffects,
    );
  }

  for (const [facilityKey, facility] of Object.entries(content.facilities)) {
    checkEffects(
      "facility",
      facility.id,
      `facilities.${facilityKey}.modifiers`,
      facility.modifiers,
    );
  }

  for (const [advanceKey, advance] of Object.entries(content.research.genericAdvances)) {
    checkEffects(
      "generic-advance",
      advance.id,
      `research.genericAdvances.${advanceKey}.effects`,
      advance.effects,
    );
  }

  return findings;
}

export function describeNonRoundValue(finding: NonRoundValue): string {
  const verb = finding.operation === "multiply" ? "x" : "add ";
  return (
    `${finding.file}: ${finding.entityId} ${finding.target} ${verb}${String(finding.value)} ` +
    `is not a round player-facing value; use ${verb}${String(finding.suggestion)}`
  );
}
