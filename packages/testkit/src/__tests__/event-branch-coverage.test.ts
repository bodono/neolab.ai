import { describe, expect, it } from "vitest";

import {
  contentId,
  type CompiledContent,
  type EventDefinition,
} from "@neolab/content-schema";

import { buildEventBranchCoverageReport } from "../event-branch-coverage.ts";
import { scenarioContent } from "../scenario.ts";

const compiled = scenarioContent();

function withEvents(...definitions: readonly EventDefinition[]): CompiledContent {
  return {
    ...compiled,
    events: {
      definitions: Object.fromEntries(
        definitions.map((definition) => [definition.id, definition]),
      ),
      orderedIds: definitions.map((definition) => definition.id),
    },
  };
}

function coveredEvent(): EventDefinition {
  return {
    id: contentId("base:event.test.branch-coverage"),
    version: 1,
    category: "politics",
    severity: "decision",
    phase: "scaling",
    trigger: { kind: "mandatory", detector: "government-restriction", priority: 30 },
    prerequisites: {
      type: "all",
      items: [
        {
          type: "compare",
          metric: "player.cash",
          op: "gte",
          value: 100,
        },
        {
          type: "compare",
          metric: "player.politics.interventionPressure",
          op: "gte",
          value: 80,
        },
        { type: "has-flag", flag: "coverage-enabled" },
      ],
    },
    exclusions: { type: "has-flag", flag: "coverage-blocked" },
    baseWeight: 1,
    weightModifiers: [],
    cooldown: { group: "test-branch-coverage", weeks: 4 },
    unique: true,
    expiryWeeks: 2,
    defaultOptionId: "accept",
    titleKey: "event.test.branch-coverage.title",
    bodyKey: "event.test.branch-coverage.body",
    evidence: [],
    tokenBindings: [
      { token: "SUBJECT", source: "trigger-text" },
      { token: "PRESSURE", source: "trigger-number" },
    ],
    options: [
      {
        id: "accept",
        labelKey: "event.test.branch-coverage.accept.label",
        requirements: {
          type: "all",
          items: [
            {
              type: "compare",
              metric: "player.aura.spendable",
              op: "gte",
              value: 50,
            },
            {
              type: "compare",
              metric: "player.safety.evalQuality",
              op: "gte",
              value: 70,
            },
          ],
        },
        knownCosts: [
          {
            kind: "add-resource",
            subject: { type: "player-lab" },
            resource: "cash",
            amount: -5,
          },
          {
            kind: "add-resource",
            subject: { type: "player-lab" },
            resource: "aura-spendable",
            amount: -10,
          },
        ],
        previewKey: "event.test.branch-coverage.accept.preview",
        immediateEffects: [],
        checks: [
          {
            id: "result",
            outcomes: [
              {
                id: "protocol",
                minimumInclusive: 0,
                maximumExclusive: 0.5,
                effects: [
                  {
                    kind: "add-coalition-rating",
                    rating: "verification",
                    amount: 5,
                  },
                ],
                memories: [
                  {
                    key: "coverage-protocol",
                    subjects: [{ type: "token", token: "SUBJECT" }],
                    tags: ["coverage"],
                  },
                ],
              },
              {
                id: "grant",
                minimumInclusive: 0.5,
                maximumExclusive: 1,
                effects: [
                  {
                    kind: "add-resource",
                    subject: { type: "player-lab" },
                    resource: "cash",
                    amount: 3,
                  },
                ],
                memories: [],
              },
            ],
            likelihoodPromise: {
              label: "uncertain",
              successOutcomeIds: ["protocol"],
            },
          },
        ],
        memories: [],
        confirmationRequired: false,
      },
    ],
    followUps: [],
    telemetryTags: ["coverage"],
  };
}

describe("event branch coverage", () => {
  it("constructs witnesses, survives save/load, and forces every outcome deterministically", () => {
    const content = withEvents(coveredEvent());
    const first = buildEventBranchCoverageReport(content);
    const second = buildEventBranchCoverageReport(content);

    expect(first).toEqual(second);
    expect(first.status).toBe("complete");
    expect(first.counts).toEqual({
      definitions: 1,
      options: 1,
      outcomes: 2,
      branches: 3,
      covered: 3,
      uncovered: 0,
    });
    expect(first.branches.every((branch) => branch.saveRoundTrip)).toBe(true);
    expect(
      first.branches
        .filter((branch) => branch.kind === "outcome")
        .map((branch) => branch.committedOutcomeId),
    ).toEqual(["protocol", "grant"]);
  });

  it("reports an option whose known cost contradicts its requirements", () => {
    const event = coveredEvent();
    const option = event.options[0];
    if (option === undefined) throw new Error("missing option fixture");
    const { exclusions: _exclusions, ...eventWithoutExclusions } = event;
    const impossible: EventDefinition = {
      ...eventWithoutExclusions,
      id: contentId("base:event.test.unaffordable-branch"),
      phase: "any",
      trigger: { kind: "opportunity" },
      prerequisites: { type: "always" },
      options: [
        {
          ...option,
          requirements: {
            type: "compare",
            metric: "player.cash",
            op: "lt",
            value: 0,
          },
          knownCosts: [
            {
              kind: "add-resource",
              subject: { type: "player-lab" },
              resource: "cash",
              amount: -1,
            },
          ],
          checks: [],
        },
      ],
    };
    const report = buildEventBranchCoverageReport(withEvents(impossible));

    expect(report.status).toBe("incomplete");
    expect(report.counts).toMatchObject({ branches: 1, covered: 0, uncovered: 1 });
    expect(report.branches[0]).toMatchObject({
      kind: "option",
      status: "uncovered",
      saveRoundTrip: false,
    });
  });

  it("funds declared known costs even when no predicate names the resource", () => {
    const event = coveredEvent();
    const option = event.options[0];
    if (option === undefined) throw new Error("missing option fixture");
    const { exclusions: _exclusions, ...eventWithoutExclusions } = event;
    const costly: EventDefinition = {
      ...eventWithoutExclusions,
      id: contentId("base:event.test.cost-only-witness"),
      phase: "any",
      trigger: { kind: "opportunity" },
      prerequisites: { type: "always" },
      options: [
        {
          ...option,
          requirements: { type: "always" },
          knownCosts: [
            {
              kind: "add-resource",
              subject: { type: "player-lab" },
              resource: "cash",
              amount: -500,
            },
            {
              kind: "add-resource",
              subject: { type: "player-lab" },
              resource: "aura-spendable",
              amount: -80,
            },
          ],
          checks: [],
        },
      ],
    };
    const report = buildEventBranchCoverageReport(withEvents(costly));
    expect(report.status).toBe("complete");
    expect(report.branches[0]).toMatchObject({ status: "covered", saveRoundTrip: true });
  });

  it("distinguishes an empty draft catalogue from complete coverage", () => {
    const report = buildEventBranchCoverageReport(withEvents());
    expect(report.status).toBe("empty");
    expect(report.counts.branches).toBe(0);
  });
});
