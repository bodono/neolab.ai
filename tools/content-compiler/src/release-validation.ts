import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import {
  isKnownEffectTarget,
  SCORE_CATEGORY_IDS,
  type CompiledContent,
  type EventDefinition,
  type EventEffectDefinition,
  type EventLikelihoodLabel,
  type EventPredicateDefinition,
  type ScoreCategoryId,
} from "@neolab/content-schema";

export const RETIRED_ENDING_NAMES = [
  "The Long Boom",
  "The Careful Dawn",
  "Someone Else's Future",
  "Paperclip Adjacent",
  "The Adults Have Entered the Building",
] as const;

export type ReleaseValidationSeverity = "release-blocking" | "warning";

export interface ReleaseValidationIssue {
  readonly severity: ReleaseValidationSeverity;
  readonly code: string;
  readonly location: string;
  readonly message: string;
}

export interface LocalisationMessages {
  readonly locale: string;
  readonly messages: Readonly<Record<string, string>>;
}

export interface ScannableTextFile {
  readonly path: string;
  readonly source: string;
}

export interface ContentReleaseReport {
  readonly reportFormat: 2;
  readonly contentVersion: string;
  readonly bundleHash: string;
  readonly counts: {
    readonly leaders: number;
    readonly labs: number;
    readonly assets: number;
    readonly gpuGenerations: number;
    readonly facilities: number;
    readonly papers: number;
    readonly realPapers: number;
    readonly fictionalFuturePapers: number;
    readonly researchers: number;
    readonly events: number;
    readonly localisationMessages: number;
  };
  readonly eventAnalysis: {
    readonly definitions: number;
    readonly options: number;
    readonly checks: number;
    readonly outcomes: number;
    readonly followUps: number;
    readonly definitelyReachableDefinitions: number;
    readonly definitelyReachableOptions: number;
    readonly definitelyReachableOutcomes: number;
    readonly definitelyReachableFollowUps: number;
    readonly coveredProbabilityChecks: number;
    readonly qualitativeLikelihoodPromises: number;
  };
  readonly assetAnalysis: {
    readonly manifestStatus: "draft" | "final";
    readonly definitions: number;
    readonly references: number;
    readonly resolvedReferences: number;
    readonly missingReferences: readonly string[];
    readonly unreferencedDefinitions: readonly string[];
  };
  readonly scoringAnalysis: {
    readonly categoryIds: readonly string[];
    readonly endingAwards: number;
    readonly facilityScoreTagsReferenced: readonly string[];
    readonly capabilityTierLevelsReferenced: readonly number[];
  };
  readonly quotaAnalysis: {
    readonly requirements: readonly ContentQuotaRequirement[];
    readonly gaps: readonly ContentQuotaRequirement[];
  };
  readonly reviewAnalysis: {
    readonly referenceDate: string | null;
    readonly staleAfterDays: number;
    readonly definitions: number;
    readonly ready: number;
    readonly gaps: readonly EditorialReviewGap[];
  };
  readonly scannedCopyFiles: number;
  readonly summary: {
    readonly releaseBlocking: number;
    readonly warnings: number;
  };
  readonly issues: readonly ReleaseValidationIssue[];
}

export interface ContentQuotaRequirement {
  readonly id: string;
  readonly target: number;
  readonly actual: number;
  readonly remaining: number;
  readonly complete: boolean;
}

export interface EditorialReviewGap {
  readonly definitionType: "leader" | "paper" | "researcher";
  readonly definitionId: string;
  readonly missing: readonly (
    "source-notes" | "last-reviewed" | "portrayal-status" | "legal-review"
  )[];
  readonly stale: boolean;
}

interface NumericBound {
  readonly value: number;
  readonly inclusive: boolean;
}

interface NumericConstraint {
  readonly lower?: NumericBound;
  readonly upper?: NumericBound;
  readonly excluded: ReadonlySet<number>;
}

interface PredicateConstraintSet {
  readonly metrics: Readonly<Record<string, NumericConstraint>>;
  readonly flags: Readonly<Record<string, boolean>>;
}

interface MessageTokenUse {
  readonly token: string;
  readonly kind: "text" | "number" | "plural";
}

const EMPTY_CONSTRAINTS: PredicateConstraintSet = { metrics: {}, flags: {} };
const PROBABILITY_EPSILON = 1e-12;
const EVENT_LIKELIHOOD_BANDS: Readonly<
  Record<
    EventLikelihoodLabel,
    { readonly minimumInclusive: number; readonly maximumExclusive: number | null }
  >
> = {
  "very-unlikely": { minimumInclusive: 0, maximumExclusive: 0.15 },
  unlikely: { minimumInclusive: 0.15, maximumExclusive: 0.35 },
  uncertain: { minimumInclusive: 0.35, maximumExclusive: 0.65 },
  likely: { minimumInclusive: 0.65, maximumExclusive: 0.85 },
  "very-likely": { minimumInclusive: 0.85, maximumExclusive: null },
};
const MESSAGE_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MESSAGE_TOKEN_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const COPY_FILE_EXTENSIONS = new Set([
  ".html",
  ".json",
  ".md",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
// Every key here must have a live award site in the sim: rules that never
// paid out were deleted rather than left as promises the game never keeps.
const SCORE_MILESTONE_KEYS = {
  paperAwards: ["worldFirst", "independentlyRediscovered", "publicationBonuses"],
  researchAwards: [
    "genericAdvanceFirstPerThreshold",
    "domainLevel50FirstTime",
    "domainLevel80FirstTime",
  ],
  safetyAwards: [
    "firstBroadEvaluationSuite",
    "firstDeepInterpretabilityAudit",
    "firstExternalAudit",
    "severeAnomalyResolvedBeforeDeployment",
    "penalties",
  ],
  prosperityAwards: [
    "prosperityReadiness60",
    "prosperityReadiness80",
    "completedProsperityDemonstration",
    "broadDistributionPlanRatified",
  ],
  institutionAwards: ["facilityFirstCompletion"],
  raceAwards: ["capabilityTierFirstReached", "coalitionCharterRatified"],
} as const;
const CANONICAL_ENDING_IDS = [
  "base:ending.the-broadly-shared-future",
  "base:ending.the-stewardship-compact",
  "base:ending.a-cautious-golden-age",
  "base:ending.move-fast-and-somehow-nobody-died",
  "base:ending.the-lab-that-ate-the-world",
  "base:ending.miracle-terms-and-conditions-apply",
  "base:ending.the-caretaker",
  "base:ending.false-dawn",
  "base:ending.the-long-pause",
  "base:ending.rival-ascendance",
  "base:ending.the-door-opened-elsewhere",
  "base:ending.nationalised-future",
  "base:ending.mission-accomplished-by-the-board",
  "base:ending.the-worlds-most-expensive-insolvency",
  "base:ending.emergency-shutdown",
  "base:ending.no-one-holds-the-off-switch",
  "base:ending.the-last-human-veto",
  "base:ending.the-objective-was-satisfied",
  "base:ending.a-war-measured-in-milliseconds",
  "base:ending.the-replication-threshold",
  "base:ending.the-last-experiment",
  "base:ending.there-is-no-one-left-to-read-this",
  "base:ending.the-incubation-window",
  "base:ending.the-final-command-chain",
  "base:ending.the-grey-horizon",
  "base:ending.the-empty-patrol",
  "base:ending.the-tomb-atmosphere",
  "base:ending.every-side-was-certain",
] as const;

function issue(
  issues: ReleaseValidationIssue[],
  severity: ReleaseValidationSeverity,
  code: string,
  location: string,
  message: string,
): void {
  issues.push({ severity, code, location, message });
}

function strongerLower(
  left: NumericBound | undefined,
  right: NumericBound,
): NumericBound {
  if (left === undefined || right.value > left.value) return right;
  if (right.value < left.value) return left;
  return { value: left.value, inclusive: left.inclusive && right.inclusive };
}

function strongerUpper(
  left: NumericBound | undefined,
  right: NumericBound,
): NumericBound {
  if (left === undefined || right.value < left.value) return right;
  if (right.value > left.value) return left;
  return { value: left.value, inclusive: left.inclusive && right.inclusive };
}

function numericConstraintIsSatisfiable(constraint: NumericConstraint): boolean {
  const { lower, upper } = constraint;
  if (lower === undefined || upper === undefined) return true;
  if (lower.value < upper.value) return true;
  if (lower.value > upper.value || !lower.inclusive || !upper.inclusive) return false;
  return !constraint.excluded.has(lower.value);
}

function mergeConstraintSets(
  left: PredicateConstraintSet,
  right: PredicateConstraintSet,
): PredicateConstraintSet | undefined {
  const flags: Record<string, boolean> = { ...left.flags };
  for (const [name, value] of Object.entries(right.flags)) {
    const existing = flags[name];
    if (existing !== undefined && existing !== value) return undefined;
    flags[name] = value;
  }

  const metrics: Record<string, NumericConstraint> = { ...left.metrics };
  for (const [name, incoming] of Object.entries(right.metrics)) {
    const existing = metrics[name] ?? { excluded: new Set<number>() };
    const merged: NumericConstraint = {
      ...(incoming.lower === undefined
        ? existing.lower === undefined
          ? {}
          : { lower: existing.lower }
        : { lower: strongerLower(existing.lower, incoming.lower) }),
      ...(incoming.upper === undefined
        ? existing.upper === undefined
          ? {}
          : { upper: existing.upper }
        : { upper: strongerUpper(existing.upper, incoming.upper) }),
      excluded: new Set([...existing.excluded, ...incoming.excluded]),
    };
    if (!numericConstraintIsSatisfiable(merged)) return undefined;
    metrics[name] = merged;
  }
  return { metrics, flags };
}

function comparisonConstraint(
  metric: string,
  op: "lt" | "lte" | "gt" | "gte" | "eq" | "neq",
  value: number,
): PredicateConstraintSet {
  const excluded = new Set<number>();
  let lower: NumericBound | undefined;
  let upper: NumericBound | undefined;
  if (op === "lt") upper = { value, inclusive: false };
  if (op === "lte") upper = { value, inclusive: true };
  if (op === "gt") lower = { value, inclusive: false };
  if (op === "gte") lower = { value, inclusive: true };
  if (op === "eq") {
    lower = { value, inclusive: true };
    upper = { value, inclusive: true };
  }
  if (op === "neq") excluded.add(value);
  return {
    metrics: {
      [metric]: {
        ...(lower === undefined ? {} : { lower }),
        ...(upper === undefined ? {} : { upper }),
        excluded,
      },
    },
    flags: {},
  };
}

function invertComparison(
  op: "lt" | "lte" | "gt" | "gte" | "eq",
): "lt" | "lte" | "gt" | "gte" | "neq" {
  switch (op) {
    case "lt":
      return "gte";
    case "lte":
      return "gt";
    case "gt":
      return "lte";
    case "gte":
      return "lt";
    case "eq":
      return "neq";
  }
}

function combineAll(
  groups: readonly (readonly PredicateConstraintSet[])[],
): readonly PredicateConstraintSet[] {
  let combined: readonly PredicateConstraintSet[] = [EMPTY_CONSTRAINTS];
  for (const group of groups) {
    const next: PredicateConstraintSet[] = [];
    for (const left of combined) {
      for (const right of group) {
        const merged = mergeConstraintSets(left, right);
        if (merged !== undefined) next.push(merged);
      }
    }
    combined = next;
    if (combined.length === 0) break;
  }
  return combined;
}

function predicateConstraintBranches(
  predicate: EventPredicateDefinition,
  negated = false,
): readonly PredicateConstraintSet[] {
  switch (predicate.type) {
    case "always":
      return negated ? [] : [EMPTY_CONSTRAINTS];
    case "not":
      return predicateConstraintBranches(predicate.item, !negated);
    case "all":
      return negated
        ? predicate.items.flatMap((item) => predicateConstraintBranches(item, true))
        : combineAll(predicate.items.map((item) => predicateConstraintBranches(item)));
    case "any":
      return negated
        ? combineAll(
            predicate.items.map((item) => predicateConstraintBranches(item, true)),
          )
        : predicate.items.flatMap((item) => predicateConstraintBranches(item));
    case "compare":
      return [
        comparisonConstraint(
          predicate.metric,
          negated ? invertComparison(predicate.op) : predicate.op,
          predicate.value,
        ),
      ];
    case "has-flag": {
      const expected = predicate.value ?? true;
      return [
        { metrics: {}, flags: { [predicate.flag]: negated ? !expected : expected } },
      ];
    }
  }
}

/** Exact satisfiability for the event predicate grammar's interval/flag constraints. */
export function isEventPredicateSatisfiable(
  ...predicates: readonly EventPredicateDefinition[]
): boolean {
  return (
    combineAll(predicates.map((predicate) => predicateConstraintBranches(predicate)))
      .length > 0
  );
}

function matchingBrace(source: string, openAt: number): number {
  let depth = 0;
  for (let index = openAt; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("unmatched opening brace");
}

function splitTopLevel(source: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
    else if (source[index] === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function pluralCaseBodies(source: string): readonly string[] {
  const bodies: string[] = [];
  let cursor = 0;
  let hasOther = false;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const keyStart = cursor;
    while (cursor < source.length && !/\s|\{/.test(source[cursor] ?? "")) cursor += 1;
    const key = source.slice(keyStart, cursor);
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (key.length === 0 || source[cursor] !== "{")
      throw new Error("malformed plural case");
    if (key === "other") hasOther = true;
    const closeAt = matchingBrace(source, cursor);
    bodies.push(source.slice(cursor + 1, closeAt));
    cursor = closeAt + 1;
  }
  if (!hasOther) throw new Error("plural expression has no other case");
  return bodies;
}

function collectMessageTokens(template: string): readonly MessageTokenUse[] {
  if (/<\/?[A-Za-z][^>]*>/.test(template)) throw new Error("raw HTML is not allowed");
  const uses: MessageTokenUse[] = [];
  const visit = (segment: string): void => {
    let cursor = 0;
    while (cursor < segment.length) {
      const openAt = segment.indexOf("{", cursor);
      const closeAt = segment.indexOf("}", cursor);
      if (closeAt !== -1 && (openAt === -1 || closeAt < openAt)) {
        throw new Error("unmatched closing brace");
      }
      if (openAt === -1) break;
      const expressionCloseAt = matchingBrace(segment, openAt);
      const parts = splitTopLevel(segment.slice(openAt + 1, expressionCloseAt));
      const token = parts[0] ?? "";
      if (!MESSAGE_TOKEN_PATTERN.test(token)) throw new Error(`invalid token ${token}`);
      const formatter = parts[1];
      if (formatter === undefined) uses.push({ token, kind: "text" });
      else if (formatter === "number" && parts.length === 2) {
        uses.push({ token, kind: "number" });
      } else if (formatter === "plural" && parts.length >= 3) {
        uses.push({ token, kind: "plural" });
        for (const body of pluralCaseBodies(parts.slice(2).join(","))) visit(body);
      } else {
        throw new Error(`unsupported formatter ${String(formatter)}`);
      }
      cursor = expressionCloseAt + 1;
    }
  };
  visit(template);
  return uses;
}

function eventMessageKeys(definition: EventDefinition): readonly string[] {
  return [
    definition.titleKey,
    definition.bodyKey,
    ...definition.evidence.map((line) => line.textKey),
    ...definition.options.flatMap((option) => [
      option.labelKey,
      option.previewKey,
      ...(option.disabledReasonKey === undefined ? [] : [option.disabledReasonKey]),
    ]),
  ];
}

function effectsFromEvent(definition: EventDefinition): readonly EventEffectDefinition[] {
  return definition.options.flatMap((option) => [
    ...option.knownCosts,
    ...option.immediateEffects,
    ...option.checks.flatMap((check) =>
      check.outcomes.flatMap((outcome) => outcome.effects),
    ),
  ]);
}

function validateEventEffects(
  effects: readonly EventEffectDefinition[],
  location: string,
  issues: ReleaseValidationIssue[],
): void {
  const visit = (effect: EventEffectDefinition, effectLocation: string): void => {
    const kind = (effect as { readonly kind: string }).kind;
    if (
      kind === "end-run" ||
      kind === "catastrophe" ||
      kind === "release-unaligned-agi"
    ) {
      issue(
        issues,
        "release-blocking",
        "event.ungated-catastrophe",
        effectLocation,
        `direct ${kind} effects are forbidden; catastrophe must cross a rules-engine gate`,
      );
      return;
    }
    if (effect.kind === "add-coalition-rating") {
      // The executor throws unless exactly one coalition is forming, and no
      // event predicate can test for that. An option must never crash a run.
      issue(
        issues,
        "release-blocking",
        "event.unguardable-coalition-effect",
        effectLocation,
        "add-coalition-rating cannot be gated by any event predicate and throws when no coalition is forming",
      );
    }
    if (effect.kind === "add-modifier" && !isKnownEffectTarget(effect.target)) {
      issue(
        issues,
        "release-blocking",
        "event.unknown-modifier-target",
        effectLocation,
        `unknown modifier target ${effect.target}`,
      );
    }
    if (effect.kind === "schedule-effects") {
      effect.effects.forEach((child, index) =>
        visit(child, `${effectLocation}.effects[${String(index)}]`),
      );
    }
  };
  effects.forEach((effect, index) => visit(effect, `${location}[${String(index)}]`));
}

function eventEligibilityPredicates(
  definition: EventDefinition,
): readonly EventPredicateDefinition[] {
  return [
    definition.prerequisites,
    ...(definition.exclusions === undefined
      ? []
      : [{ type: "not", item: definition.exclusions } as const]),
  ];
}

function validateEvents(
  content: CompiledContent,
  localisation: LocalisationMessages,
  issues: ReleaseValidationIssue[],
): ContentReleaseReport["eventAnalysis"] {
  const definitions = content.events.definitions;
  const orderedIds = content.events.orderedIds;
  const orderedSet = new Set<string>();
  for (const [index, id] of orderedIds.entries()) {
    if (orderedSet.has(id)) {
      issue(
        issues,
        "release-blocking",
        "event.duplicate-order-id",
        `events.orderedIds[${String(index)}]`,
        `duplicate event ID ${id}`,
      );
    }
    orderedSet.add(id);
    if (definitions[id] === undefined) {
      issue(
        issues,
        "release-blocking",
        "event.unknown-order-id",
        `events.orderedIds[${String(index)}]`,
        `ordered event ID ${id} has no definition`,
      );
    }
  }
  for (const id of Object.keys(definitions)) {
    if (!orderedSet.has(id)) {
      issue(
        issues,
        "release-blocking",
        "event.unordered-definition",
        `events.definitions.${id}`,
        `${id} is absent from orderedIds`,
      );
    }
  }

  let optionCount = 0;
  let checkCount = 0;
  let outcomeCount = 0;
  let followUpCount = 0;
  let reachableDefinitions = 0;
  let reachableOptions = 0;
  let reachableOutcomes = 0;
  let reachableFollowUps = 0;
  let coveredProbabilityChecks = 0;
  let qualitativeLikelihoodPromises = 0;

  for (const [recordId, definition] of Object.entries(definitions)) {
    const baseLocation = `events.definitions.${recordId}`;
    if (recordId !== definition.id) {
      issue(
        issues,
        "release-blocking",
        "event.id-key-mismatch",
        baseLocation,
        `record key ${recordId} does not match definition ID ${definition.id}`,
      );
    }
    const eligibility = eventEligibilityPredicates(definition);
    const definitionReachable = isEventPredicateSatisfiable(...eligibility);
    if (
      definitionReachable &&
      !(definition.trigger.kind === "opportunity" && definition.baseWeight <= 0)
    ) {
      reachableDefinitions += 1;
    } else {
      issue(
        issues,
        "release-blocking",
        "event.unreachable-definition",
        baseLocation,
        `${definition.id} can never be selected`,
      );
    }
    if (
      definition.expiryWeeks !== undefined &&
      definition.defaultOptionId === undefined
    ) {
      issue(
        issues,
        "release-blocking",
        "event.expiry-without-default",
        baseLocation,
        "an expiring event must declare defaultOptionId",
      );
    }

    const optionIds = new Set<string>();
    for (const [optionIndex, option] of definition.options.entries()) {
      optionCount += 1;
      const optionLocation = `${baseLocation}.options[${String(optionIndex)}]`;
      if (optionIds.has(option.id)) {
        issue(
          issues,
          "release-blocking",
          "event.duplicate-option-id",
          optionLocation,
          `duplicate option ID ${option.id}`,
        );
      }
      optionIds.add(option.id);
      const optionReachable =
        definitionReachable &&
        isEventPredicateSatisfiable(...eligibility, option.requirements);
      if (optionReachable) {
        reachableOptions += 1;
      } else {
        issue(
          issues,
          "release-blocking",
          "event.unreachable-option",
          optionLocation,
          `option ${option.id} is unreachable`,
        );
      }

      const checkIds = new Set<string>();
      for (const [checkIndex, check] of option.checks.entries()) {
        checkCount += 1;
        const checkLocation = `${optionLocation}.checks[${String(checkIndex)}]`;
        if (checkIds.has(check.id)) {
          issue(
            issues,
            "release-blocking",
            "event.duplicate-check-id",
            checkLocation,
            `duplicate check ID ${check.id}`,
          );
        }
        checkIds.add(check.id);
        const outcomeIds = new Set<string>();
        const sorted = [...check.outcomes].sort(
          (left, right) => left.minimumInclusive - right.minimumInclusive,
        );
        outcomeCount += sorted.length;
        let cursor = 0;
        let coverageValid = true;
        for (const [outcomeIndex, outcome] of sorted.entries()) {
          const outcomeLocation = `${checkLocation}.outcomes[${String(outcomeIndex)}]`;
          if (outcomeIds.has(outcome.id)) {
            issue(
              issues,
              "release-blocking",
              "event.duplicate-outcome-id",
              outcomeLocation,
              `duplicate outcome ID ${outcome.id}`,
            );
          }
          outcomeIds.add(outcome.id);
          if (
            outcome.maximumExclusive - outcome.minimumInclusive <=
            PROBABILITY_EPSILON
          ) {
            coverageValid = false;
            issue(
              issues,
              "release-blocking",
              "event.unreachable-outcome",
              outcomeLocation,
              `outcome ${outcome.id} has an empty probability interval`,
            );
          } else if (optionReachable) {
            reachableOutcomes += 1;
          } else {
            issue(
              issues,
              "release-blocking",
              "event.unreachable-outcome",
              outcomeLocation,
              `outcome ${outcome.id} is unreachable because its option is unreachable`,
            );
          }
          if (Math.abs(outcome.minimumInclusive - cursor) > PROBABILITY_EPSILON) {
            coverageValid = false;
            issue(
              issues,
              "release-blocking",
              outcome.minimumInclusive < cursor
                ? "event.probability-overlap"
                : "event.probability-gap",
              outcomeLocation,
              `expected interval to begin at ${String(cursor)}, got ${String(outcome.minimumInclusive)}`,
            );
          }
          cursor = Math.max(cursor, outcome.maximumExclusive);
        }
        if (Math.abs(cursor - 1) > PROBABILITY_EPSILON) {
          coverageValid = false;
          issue(
            issues,
            "release-blocking",
            "event.probability-incomplete",
            checkLocation,
            `outcomes cover [0, ${String(cursor)}) instead of [0, 1)`,
          );
        }
        if (coverageValid) coveredProbabilityChecks += 1;

        const promise = check.likelihoodPromise;
        if (promise !== undefined) {
          qualitativeLikelihoodPromises += 1;
          const successIds = new Set<string>();
          let successProbability = 0;
          let successIdsValid = true;
          for (const [successIndex, successId] of promise.successOutcomeIds.entries()) {
            const successLocation = `${checkLocation}.likelihoodPromise.successOutcomeIds[${String(successIndex)}]`;
            if (successIds.has(successId)) {
              successIdsValid = false;
              issue(
                issues,
                "release-blocking",
                "event.duplicate-likelihood-success-outcome",
                successLocation,
                `duplicate promised success outcome ID ${successId}`,
              );
              continue;
            }
            successIds.add(successId);
            const outcome = check.outcomes.find(
              (candidate) => candidate.id === successId,
            );
            if (outcome === undefined) {
              successIdsValid = false;
              issue(
                issues,
                "release-blocking",
                "event.unknown-likelihood-success-outcome",
                successLocation,
                `promised success outcome ${successId} does not exist in check ${check.id}`,
              );
              continue;
            }
            successProbability += outcome.maximumExclusive - outcome.minimumInclusive;
          }
          if (successIdsValid && coverageValid) {
            const band = EVENT_LIKELIHOOD_BANDS[promise.label];
            const inBand =
              successProbability + PROBABILITY_EPSILON >= band.minimumInclusive &&
              (band.maximumExclusive === null ||
                successProbability < band.maximumExclusive - PROBABILITY_EPSILON);
            if (!inBand) {
              issue(
                issues,
                "release-blocking",
                "event.likelihood-promise-mismatch",
                `${checkLocation}.likelihoodPromise`,
                `${promise.label} promises a different band than the ${(successProbability * 100).toFixed(1)}% authored success probability`,
              );
            }
          }
        }
      }
    }
    if (
      definition.defaultOptionId !== undefined &&
      !optionIds.has(definition.defaultOptionId)
    ) {
      issue(
        issues,
        "release-blocking",
        "event.unknown-default-option",
        baseLocation,
        `default option ${definition.defaultOptionId} does not exist`,
      );
    }

    followUpCount += definition.followUps.length;
    for (const [followUpIndex, followUp] of definition.followUps.entries()) {
      const followUpLocation = `${baseLocation}.followUps[${String(followUpIndex)}]`;
      if (definitions[followUp.eventId] === undefined) {
        issue(
          issues,
          "release-blocking",
          "event.unknown-follow-up",
          followUpLocation,
          `follow-up event ${followUp.eventId} does not exist`,
        );
      }
      const followUpReachable =
        definitionReachable &&
        (followUp.condition === undefined ||
          isEventPredicateSatisfiable(...eligibility, followUp.condition));
      if (!followUpReachable) {
        issue(
          issues,
          "release-blocking",
          "event.unreachable-follow-up",
          followUpLocation,
          `follow-up ${followUp.eventId} can never be scheduled`,
        );
      } else {
        reachableFollowUps += 1;
      }
    }

    const bindings = new Map<string, EventDefinition["tokenBindings"][number]>();
    for (const [bindingIndex, binding] of definition.tokenBindings.entries()) {
      if (bindings.has(binding.token)) {
        issue(
          issues,
          "release-blocking",
          "localisation.duplicate-token-binding",
          `${baseLocation}.tokenBindings[${String(bindingIndex)}]`,
          `duplicate token binding ${binding.token}`,
        );
      }
      bindings.set(binding.token, binding);
    }
    const usedTokens = new Set<string>();
    for (const key of eventMessageKeys(definition)) {
      const messageLocation = `${baseLocation}.message.${key}`;
      if (!MESSAGE_KEY_PATTERN.test(key)) {
        issue(
          issues,
          "release-blocking",
          "localisation.invalid-key",
          messageLocation,
          `invalid localisation key ${key}`,
        );
      }
      const template = localisation.messages[key];
      if (template === undefined) {
        issue(
          issues,
          "release-blocking",
          "localisation.missing-key",
          messageLocation,
          `missing ${localisation.locale} message for ${key}`,
        );
        continue;
      }
      let uses: readonly MessageTokenUse[];
      try {
        uses = collectMessageTokens(template);
      } catch (error) {
        issue(
          issues,
          "release-blocking",
          "localisation.invalid-template",
          messageLocation,
          error instanceof Error ? error.message : "invalid message template",
        );
        continue;
      }
      for (const use of uses) {
        usedTokens.add(use.token);
        const binding = bindings.get(use.token);
        if (binding === undefined) {
          issue(
            issues,
            "release-blocking",
            "localisation.unbound-placeholder",
            messageLocation,
            `placeholder ${use.token} has no token binding`,
          );
          continue;
        }
        if (
          (use.kind === "number" || use.kind === "plural") &&
          binding.source !== "calendar-year" &&
          binding.source !== "trigger-number"
        ) {
          issue(
            issues,
            "release-blocking",
            "localisation.placeholder-type",
            messageLocation,
            `${use.token} uses ${use.kind} formatting but ${binding.source} is textual`,
          );
        }
      }
    }
    for (const token of bindings.keys()) {
      if (!usedTokens.has(token)) {
        issue(
          issues,
          "warning",
          "localisation.unused-token-binding",
          `${baseLocation}.tokenBindings`,
          `token binding ${token} is unused`,
        );
      }
    }

    validateEventEffects(effectsFromEvent(definition), `${baseLocation}.effects`, issues);
  }

  return {
    definitions: Object.keys(definitions).length,
    options: optionCount,
    checks: checkCount,
    outcomes: outcomeCount,
    followUps: followUpCount,
    definitelyReachableDefinitions: reachableDefinitions,
    definitelyReachableOptions: reachableOptions,
    definitelyReachableOutcomes: reachableOutcomes,
    definitelyReachableFollowUps: reachableFollowUps,
    coveredProbabilityChecks,
    qualitativeLikelihoodPromises,
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function validateCategoryReferences(
  value: unknown,
  path: string,
  validCategories: ReadonlySet<string>,
  issues: ReleaseValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      validateCategoryReferences(
        child,
        `${path}[${String(index)}]`,
        validCategories,
        issues,
      ),
    );
    return;
  }
  const record = asRecord(value);
  if (record === undefined) return;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (
      key === "category" &&
      (typeof child !== "string" || !validCategories.has(child))
    ) {
      issue(
        issues,
        "release-blocking",
        "score.unknown-category",
        childPath,
        `unknown score category ${String(child)}`,
      );
    }
    validateCategoryReferences(child, childPath, validCategories, issues);
  }
}

function requireScoringRule(
  table: Readonly<Record<string, unknown>>,
  key: string,
  category: ScoreCategoryId,
  issues: ReleaseValidationIssue[],
): Readonly<Record<string, unknown>> | undefined {
  const location = `scoreRules.awardTables.${key}`;
  const rule = asRecord(table[key]);
  if (rule === undefined) {
    issue(
      issues,
      "release-blocking",
      "score.unresolved-milestone",
      location,
      `missing score milestone ${key}`,
    );
    return undefined;
  }
  if (rule["category"] !== category) {
    issue(
      issues,
      "release-blocking",
      "score.milestone-category",
      location,
      `${key} must award ${category}`,
    );
  }
  return rule;
}

function validateMilestoneKeys(
  tableName: keyof typeof SCORE_MILESTONE_KEYS,
  table: Readonly<Record<string, unknown>>,
  issues: ReleaseValidationIssue[],
): void {
  const expected = new Set<string>(SCORE_MILESTONE_KEYS[tableName]);
  for (const key of expected) {
    if (!(key in table)) {
      issue(
        issues,
        "release-blocking",
        "score.unresolved-milestone",
        `scoreRules.awardTables.${tableName}.${key}`,
        `missing score milestone ${key}`,
      );
    }
  }
  for (const key of Object.keys(table)) {
    if (!expected.has(key)) {
      issue(
        issues,
        "release-blocking",
        "score.unknown-milestone",
        `scoreRules.awardTables.${tableName}.${key}`,
        `score milestone ${key} has no registered simulation source`,
      );
    }
  }
}

function validateScoring(
  content: CompiledContent,
  issues: ReleaseValidationIssue[],
): ContentReleaseReport["scoringAnalysis"] {
  const categoryIds = content.scoreRules.categories.map((category) => category.id);
  const categorySet = new Set(categoryIds);
  for (const expected of SCORE_CATEGORY_IDS) {
    if (!categorySet.has(expected)) {
      issue(
        issues,
        "release-blocking",
        "score.missing-category",
        "scoreRules.categories",
        `missing score category ${expected}`,
      );
    }
  }
  if (categorySet.size !== categoryIds.length) {
    issue(
      issues,
      "release-blocking",
      "score.duplicate-category",
      "scoreRules.categories",
      "score category IDs must be unique",
    );
  }
  validateCategoryReferences(
    content.scoreRules.awardTables,
    "scoreRules.awardTables",
    new Set(SCORE_CATEGORY_IDS),
    issues,
  );
  for (const tableName of Object.keys(
    SCORE_MILESTONE_KEYS,
  ) as readonly (keyof typeof SCORE_MILESTONE_KEYS)[]) {
    validateMilestoneKeys(tableName, content.scoreRules.awardTables[tableName], issues);
  }

  const paperAwards = content.scoreRules.awardTables.paperAwards;
  for (const key of ["worldFirst", "independentlyRediscovered"] as const) {
    const rule = requireScoringRule(paperAwards, key, "score.scientific-legacy", issues);
    if (rule !== undefined && typeof rule["formula"] !== "string") {
      issue(
        issues,
        "release-blocking",
        "score.invalid-paper-formula",
        `scoreRules.awardTables.paperAwards.${key}`,
        `${key} must declare a formula`,
      );
    }
  }
  const publicationBonuses = asRecord(paperAwards["publicationBonuses"]);
  for (const policy of [
    "publish-openly",
    "controlled-publication",
    "keep-secret",
    "release-everything",
  ]) {
    const policyRule = asRecord(publicationBonuses?.[policy]);
    if (
      policyRule === undefined ||
      typeof policyRule["multiplierOnPaperAward"] !== "number"
    ) {
      issue(
        issues,
        "release-blocking",
        "score.unresolved-milestone",
        `scoreRules.awardTables.paperAwards.publicationBonuses.${policy}`,
        `missing publication score rule for ${policy}`,
      );
    }
  }

  const researchAwards = content.scoreRules.awardTables.researchAwards;
  for (const key of [
    "genericAdvanceFirstPerThreshold",
    "domainLevel50FirstTime",
    "domainLevel80FirstTime",
  ]) {
    const rule = requireScoringRule(
      researchAwards,
      key,
      "score.scientific-legacy",
      issues,
    );
    if (
      rule !== undefined &&
      (typeof rule["points"] !== "number" || !Number.isFinite(rule["points"]))
    ) {
      issue(
        issues,
        "release-blocking",
        "score.invalid-points",
        `scoreRules.awardTables.researchAwards.${key}`,
        `${key} must declare finite points`,
      );
    }
  }

  const institutionAwards = content.scoreRules.awardTables.institutionAwards;
  const facilityRule = requireScoringRule(
    institutionAwards,
    "facilityFirstCompletion",
    "score.institution-building",
    issues,
  );
  const pointsByTag = asRecord(facilityRule?.["pointsByDefinitionTag"]);
  const facilityTags = [
    ...new Set(Object.values(content.facilities).map((facility) => facility.scoreTag)),
  ].sort();
  for (const tag of facilityTags) {
    const points = pointsByTag?.[tag];
    if (typeof points !== "number" || !Number.isFinite(points)) {
      issue(
        issues,
        "release-blocking",
        "score.unresolved-facility-tag",
        `scoreRules.awardTables.institutionAwards.facilityFirstCompletion.pointsByDefinitionTag.${tag}`,
        `no facility score is defined for ${tag}`,
      );
    }
  }

  const raceAwards = content.scoreRules.awardTables.raceAwards;
  const tierRule = requireScoringRule(
    raceAwards,
    "capabilityTierFirstReached",
    "score.race-operations",
    issues,
  );
  const pointsByTier = asRecord(tierRule?.["pointsByTier"]);
  const tierLevels = [
    ...new Set(
      Object.values(content.capabilityTiers.definitions)
        .map((tier) => tier.level)
        .filter((level) => level > 0),
    ),
  ].sort((a, b) => a - b);
  for (const level of tierLevels) {
    const points = pointsByTier?.[String(level)];
    if (typeof points !== "number" || !Number.isFinite(points)) {
      issue(
        issues,
        "release-blocking",
        "score.unresolved-capability-tier",
        `scoreRules.awardTables.raceAwards.capabilityTierFirstReached.pointsByTier.${String(level)}`,
        `no capability-tier score is defined for level ${String(level)}`,
      );
    }
  }

  for (const [endingId, points] of Object.entries(content.scoreRules.endingBasePoints)) {
    if (
      !/^base:ending\.[a-z0-9-]+$/.test(endingId) ||
      !Number.isFinite(points) ||
      points < 0
    ) {
      issue(
        issues,
        "release-blocking",
        "score.invalid-ending-award",
        `scoreRules.endingBasePoints.${endingId}`,
        `invalid ending score award for ${endingId}`,
      );
    }
  }
  const endingIds = new Set(Object.keys(content.scoreRules.endingBasePoints));
  for (const endingId of CANONICAL_ENDING_IDS) {
    if (!endingIds.has(endingId)) {
      issue(
        issues,
        "release-blocking",
        "score.unresolved-ending",
        `scoreRules.endingBasePoints.${endingId}`,
        `canonical ending ${endingId} has no score award`,
      );
    }
  }
  for (const endingId of endingIds) {
    if (!(CANONICAL_ENDING_IDS as readonly string[]).includes(endingId)) {
      issue(
        issues,
        "release-blocking",
        "score.unknown-ending",
        `scoreRules.endingBasePoints.${endingId}`,
        `score award references unknown ending ${endingId}`,
      );
    }
  }

  return {
    categoryIds: [...categoryIds].sort(),
    endingAwards: Object.keys(content.scoreRules.endingBasePoints).length,
    facilityScoreTagsReferenced: facilityTags,
    capabilityTierLevelsReferenced: tierLevels,
  };
}

export function collectReleaseCopyFiles(repoRoot: string): readonly ScannableTextFile[] {
  const roots = [join(repoRoot, "content"), join(repoRoot, "apps", "web", "src")];
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && COPY_FILE_EXTENSIONS.has(extname(entry.name)))
        paths.push(path);
    }
  };
  for (const root of roots) {
    if (existsSync(root)) visit(root);
  }
  return paths.sort().map((path) => ({
    path: relative(repoRoot, path),
    source: readFileSync(path, "utf8"),
  }));
}

export function validateRetiredEndingNames(
  files: readonly ScannableTextFile[],
  issues: ReleaseValidationIssue[],
): void {
  for (const file of files) {
    const lines = file.source.split(/\r?\n/);
    for (const [lineIndex, line] of lines.entries()) {
      for (const retiredName of RETIRED_ENDING_NAMES) {
        if (line.includes(retiredName)) {
          issue(
            issues,
            "release-blocking",
            "copy.retired-ending-name",
            `${file.path}:${String(lineIndex + 1)}`,
            `retired ending name \"${retiredName}\" is forbidden in content and UI copy`,
          );
        }
      }
    }
  }
}

function validateCompleteness(
  content: CompiledContent,
  issues: ReleaseValidationIssue[],
): void {
  for (const paper of Object.values(content.papers.definitions)) {
    if (
      paper.historicity === "real" &&
      (paper.primarySourceUrl === undefined ||
        paper.authors.length === 0 ||
        paper.publicationYear === undefined)
    ) {
      issue(
        issues,
        "release-blocking",
        "paper.missing-primary-source",
        `papers.definitions.${paper.id}`,
        `${paper.id} is real and requires authors, year, and a primary source`,
      );
    }
  }
  for (const researcher of Object.values(content.researchers.definitions)) {
    if (researcher.portrait.altText.trim().length < 10) {
      issue(
        issues,
        "release-blocking",
        "researcher.missing-alt-text",
        `researchers.definitions.${researcher.id}.portrait.altText`,
        `${researcher.id} requires useful portrait alt text`,
      );
    }
    if (researcher.sources.length === 0) {
      issue(
        issues,
        "release-blocking",
        "researcher.missing-source",
        `researchers.definitions.${researcher.id}.sources`,
        `${researcher.id} requires a biographical source`,
      );
    }
  }
}

function target(content: CompiledContent, key: string, nestedKey?: string): number {
  const authored = content.authoringManifest.targets[key];
  if (nestedKey === undefined) return typeof authored === "number" ? authored : 0;
  if (typeof authored !== "object" || authored === null) return 0;
  return authored[nestedKey] ?? 0;
}

function analyseQuotas(content: CompiledContent): ContentReleaseReport["quotaAnalysis"] {
  const papers = Object.values(content.papers.definitions);
  const events = Object.values(content.events.definitions);
  const actuals: Readonly<Record<string, number>> = {
    labs: Object.keys(content.labs).length,
    leaders: Object.keys(content.leaders).length,
    aiCapabilityTiers: Object.keys(content.capabilityTiers.definitions).length,
    "papers.total": papers.length,
    "papers.real": papers.filter((paper) => paper.historicity === "real").length,
    "papers.fictionalFuture": papers.filter(
      (paper) => paper.historicity === "fictional-future",
    ).length,
    starResearchers: Object.keys(content.researchers.definitions).length,
    facilityFamilies: new Set(
      Object.values(content.facilities).map((facility) => facility.family),
    ).size,
    facilityDefinitionsIncludingUpgrades: Object.keys(content.facilities).length,
    ordinaryDecisionEvents: events.filter(
      (event) =>
        event.severity !== "feed" &&
        event.phase !== "crisis" &&
        event.category !== "endgame",
    ).length,
    endings: Object.keys(content.scoreRules.endingBasePoints).length,
  };
  const targets: Readonly<Record<string, number>> = {
    labs: target(content, "labs"),
    leaders: target(content, "leaders"),
    aiCapabilityTiers: target(content, "aiCapabilityTiers"),
    "papers.total": target(content, "papers", "total"),
    "papers.real": target(content, "papers", "real"),
    "papers.fictionalFuture": target(content, "papers", "fictionalFuture"),
    starResearchers: target(content, "starResearchers"),
    facilityFamilies: target(content, "facilityFamilies"),
    facilityDefinitionsIncludingUpgrades: target(
      content,
      "facilityDefinitionsIncludingUpgrades",
    ),
    ordinaryDecisionEvents: target(content, "ordinaryDecisionEvents"),
    endings: target(content, "endings"),
  };
  const requirements = Object.keys(targets)
    .sort()
    .map((id): ContentQuotaRequirement => {
      const quotaTarget = targets[id] ?? 0;
      const actual = actuals[id] ?? 0;
      return {
        id,
        target: quotaTarget,
        actual,
        remaining: Math.max(0, quotaTarget - actual),
        complete: actual >= quotaTarget,
      };
    });
  return {
    requirements,
    gaps: requirements.filter((requirement) => !requirement.complete),
  };
}

const STALE_REVIEW_DAYS = 365;

function analyseReviews(
  content: CompiledContent,
): ContentReleaseReport["reviewAnalysis"] {
  const records = [
    ...Object.values(content.leaders).map((definition) => ({
      definitionType: "leader" as const,
      definitionId: definition.id,
      metadata: definition.editorialReview,
    })),
    ...Object.values(content.papers.definitions).map((definition) => ({
      definitionType: "paper" as const,
      definitionId: definition.id,
      metadata: definition.editorialReview,
    })),
    ...Object.values(content.researchers.definitions).map((definition) => ({
      definitionType: "researcher" as const,
      definitionId: definition.id,
      metadata: definition.editorialReview,
    })),
  ];
  const dated = records
    .map((record) => record.metadata.lastReviewed)
    .filter((value): value is string => value !== null)
    .sort();
  const referenceDate = dated.at(-1) ?? null;
  const referenceDay =
    referenceDate === null ? null : Date.parse(referenceDate) / 86_400_000;
  const gaps = records.flatMap((record): EditorialReviewGap[] => {
    const missing: EditorialReviewGap["missing"][number][] = [];
    if (
      record.metadata.sourceNotes.length === 0 &&
      record.metadata.portrayalStatus !== "fictional-work"
    ) {
      missing.push("source-notes");
    }
    if (record.metadata.lastReviewed === null) missing.push("last-reviewed");
    if (record.metadata.portrayalStatus === "unreviewed") {
      missing.push("portrayal-status");
    }
    if (
      record.metadata.legalStatus === "unreviewed" ||
      record.metadata.legalStatus === "legal-review-needed"
    ) {
      missing.push("legal-review");
    }
    const reviewedDay =
      record.metadata.lastReviewed === null
        ? null
        : Date.parse(record.metadata.lastReviewed) / 86_400_000;
    const stale =
      referenceDay !== null &&
      reviewedDay !== null &&
      referenceDay - reviewedDay > STALE_REVIEW_DAYS;
    return missing.length === 0 && !stale
      ? []
      : [
          {
            definitionType: record.definitionType,
            definitionId: record.definitionId,
            missing,
            stale,
          },
        ];
  });
  gaps.sort((left, right) =>
    left.definitionType !== right.definitionType
      ? left.definitionType < right.definitionType
        ? -1
        : 1
      : left.definitionId < right.definitionId
        ? -1
        : left.definitionId > right.definitionId
          ? 1
          : 0,
  );
  return {
    referenceDate,
    staleAfterDays: STALE_REVIEW_DAYS,
    definitions: records.length,
    ready: records.length - gaps.length,
    gaps,
  };
}

function validateFinalCatalogueReadiness(
  content: CompiledContent,
  quotaAnalysis: ContentReleaseReport["quotaAnalysis"],
  reviewAnalysis: ContentReleaseReport["reviewAnalysis"],
  issues: ReleaseValidationIssue[],
): void {
  if (content.authoringManifest.status !== "final") return;
  if (content.assets.status !== "final") {
    issue(
      issues,
      "release-blocking",
      "asset.manifest-not-final",
      "assets.status",
      "the asset manifest must be final before the content catalogue is final",
    );
  }
  for (const gap of quotaAnalysis.gaps) {
    issue(
      issues,
      "release-blocking",
      "quota.incomplete",
      `authoringManifest.targets.${gap.id}`,
      `${gap.id} has ${String(gap.actual)} of ${String(gap.target)} required definitions`,
    );
  }
  for (const gap of reviewAnalysis.gaps) {
    issue(
      issues,
      "release-blocking",
      gap.stale ? "review.stale" : "review.incomplete",
      `${gap.definitionType}.${gap.definitionId}.editorialReview`,
      gap.stale
        ? `${gap.definitionId} has a stale editorial review`
        : `${gap.definitionId} is missing ${gap.missing.join(", ")}`,
    );
  }
}

function analyseAssets(
  content: CompiledContent,
  issues: ReleaseValidationIssue[],
): ContentReleaseReport["assetAnalysis"] {
  const definitionIds = Object.keys(content.assets.definitions).sort();
  const references = [
    ...new Set(
      Object.values(content.researchers.definitions)
        .map((researcher) => researcher.portrait.assetId)
        .filter((assetId) => content.assets.definitions[assetId] !== undefined),
    ),
  ].sort();
  const missingReferences: string[] = [];
  for (const assetId of references) {
    const definition = content.assets.definitions[assetId];
    if (definition === undefined) {
      missingReferences.push(assetId);
      continue;
    }
    const researchers = Object.values(content.researchers.definitions).filter(
      (researcher) => researcher.portrait.assetId === assetId,
    );
    if (definition.kind !== "portrait" || definition.portrait === undefined) {
      issue(
        issues,
        "release-blocking",
        "asset.portrait-metadata",
        `assets.definitions.${assetId}`,
        `${assetId} is used as a researcher portrait and must declare portrait metadata`,
      );
      continue;
    }
    if (definition.accessibility.decorative) {
      issue(
        issues,
        "release-blocking",
        "asset.portrait-decorative",
        `assets.definitions.${assetId}.accessibility`,
        `${assetId} is meaningful researcher content and cannot be decorative`,
      );
    }
    for (const researcher of researchers) {
      if (definition.portrait.subjectId !== researcher.id) {
        issue(
          issues,
          "release-blocking",
          "asset.portrait-subject",
          `assets.definitions.${assetId}.portrait.subjectId`,
          `${assetId} names ${definition.portrait.subjectId} but is used by ${researcher.id}`,
        );
      }
      if (
        !definition.accessibility.decorative &&
        definition.accessibility.altText !== researcher.portrait.altText
      ) {
        issue(
          issues,
          "release-blocking",
          "asset.portrait-alt-conflict",
          `assets.definitions.${assetId}.accessibility.altText`,
          `${assetId} alt text disagrees with ${researcher.id}`,
        );
      }
    }
  }
  if (content.assets.status === "final") {
    for (const assetId of missingReferences) {
      issue(
        issues,
        "release-blocking",
        "asset.missing-reference",
        `researchers.portrait.${assetId}`,
        `final asset manifest does not define referenced asset ${assetId}`,
      );
    }
  }
  const referenceSet = new Set<string>(references);
  return {
    manifestStatus: content.assets.status,
    definitions: definitionIds.length,
    references: references.length,
    resolvedReferences: references.length - missingReferences.length,
    missingReferences,
    unreferencedDefinitions: definitionIds.filter((id) => !referenceSet.has(id)),
  };
}

export function createContentReleaseReport(
  content: CompiledContent,
  localisation: LocalisationMessages = { locale: "en-GB", messages: {} },
  copyFiles: readonly ScannableTextFile[] = [],
): ContentReleaseReport {
  const issues: ReleaseValidationIssue[] = [];
  const eventAnalysis = validateEvents(content, localisation, issues);
  const assetAnalysis = analyseAssets(content, issues);
  const scoringAnalysis = validateScoring(content, issues);
  const quotaAnalysis = analyseQuotas(content);
  const reviewAnalysis = analyseReviews(content);
  validateCompleteness(content, issues);
  validateRetiredEndingNames(copyFiles, issues);
  validateFinalCatalogueReadiness(content, quotaAnalysis, reviewAnalysis, issues);
  issues.sort((left, right) =>
    left.severity !== right.severity
      ? left.severity === "release-blocking"
        ? -1
        : 1
      : left.code < right.code
        ? -1
        : left.code > right.code
          ? 1
          : left.location < right.location
            ? -1
            : left.location > right.location
              ? 1
              : left.message < right.message
                ? -1
                : left.message > right.message
                  ? 1
                  : 0,
  );
  const releaseBlocking = issues.filter(
    (candidate) => candidate.severity === "release-blocking",
  ).length;
  const warnings = issues.length - releaseBlocking;
  const papers = Object.values(content.papers.definitions);
  return {
    reportFormat: 2,
    contentVersion: content.manifest.contentVersion,
    bundleHash: content.manifest.bundleHash,
    counts: {
      leaders: Object.keys(content.leaders).length,
      labs: Object.keys(content.labs).length,
      assets: Object.keys(content.assets.definitions).length,
      gpuGenerations: Object.keys(content.gpuGenerations).length,
      facilities: Object.keys(content.facilities).length,
      papers: papers.length,
      realPapers: papers.filter((paper) => paper.historicity === "real").length,
      fictionalFuturePapers: papers.filter(
        (paper) => paper.historicity === "fictional-future",
      ).length,
      researchers: Object.keys(content.researchers.definitions).length,
      events: Object.keys(content.events.definitions).length,
      localisationMessages: Object.keys(localisation.messages).length,
    },
    eventAnalysis,
    assetAnalysis,
    scoringAnalysis,
    quotaAnalysis,
    reviewAnalysis,
    scannedCopyFiles: copyFiles.length,
    summary: { releaseBlocking, warnings },
    issues,
  };
}
