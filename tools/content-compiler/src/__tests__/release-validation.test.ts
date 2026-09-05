import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
  type EventDefinition,
  type EventEffectDefinition,
  type EventOutcomeDefinition,
} from "@neolab/content-schema";

import rawBundle from "../../../../packages/content/generated/content.bundle.json";
import {
  createContentReleaseReport,
  isEventPredicateSatisfiable,
  type LocalisationMessages,
} from "../release-validation.ts";

const compiled: CompiledContent = validateCompiledContent(rawBundle);

function outcome(
  id: string,
  minimumInclusive: number,
  maximumExclusive: number,
): EventOutcomeDefinition {
  return {
    id,
    minimumInclusive,
    maximumExclusive,
    effects: [],
    memories: [],
  };
}

function validEvent(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    id: contentId("base:event.test.release-validation"),
    version: 1,
    category: "research",
    severity: "decision",
    phase: "any",
    trigger: { kind: "opportunity" },
    prerequisites: { type: "always" },
    baseWeight: 1,
    weightModifiers: [],
    cooldown: { group: "test-release-validation", weeks: 4 },
    unique: false,
    expiryWeeks: 2,
    defaultOptionId: "accept",
    titleKey: "event.test.title",
    bodyKey: "event.test.body",
    evidence: [],
    tokenBindings: [
      { token: "AI_NAME", source: "player-ai-name" },
      { token: "YEAR", source: "calendar-year" },
    ],
    options: [
      {
        id: "accept",
        labelKey: "event.test.accept.label",
        requirements: { type: "always" },
        knownCosts: [],
        previewKey: "event.test.accept.preview",
        immediateEffects: [],
        checks: [
          {
            id: "result",
            outcomes: [outcome("mixed", 0, 0.4), outcome("good", 0.4, 1)],
          },
        ],
        memories: [],
        confirmationRequired: false,
      },
    ],
    followUps: [],
    telemetryTags: ["test"],
    ...overrides,
  };
}

function messages(
  overrides: Readonly<Record<string, string>> = {},
): LocalisationMessages {
  return {
    locale: "en-GB",
    messages: {
      "event.test.title": "A request from {AI_NAME}",
      "event.test.body": "The lab calendar says {YEAR, number}.",
      "event.test.accept.label": "Accept",
      "event.test.accept.preview": "The outcome is uncertain.",
      ...overrides,
    },
  };
}

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

function issueCodes(report: ReturnType<typeof createContentReleaseReport>): string[] {
  return report.issues.map((candidate) => candidate.code);
}

describe("content release validation", () => {
  it("accepts a reachable event with complete probability and localisation coverage", () => {
    const report = createContentReleaseReport(withEvents(validEvent()), messages());

    expect(report.summary).toEqual({ releaseBlocking: 0, warnings: 0 });
    expect(report.eventAnalysis).toMatchObject({
      definitions: 1,
      options: 1,
      checks: 1,
      outcomes: 2,
      definitelyReachableDefinitions: 1,
      definitelyReachableOptions: 1,
      definitelyReachableOutcomes: 2,
      coveredProbabilityChecks: 1,
    });
  });

  it("rejects probability gaps, overlaps, and empty outcome branches", () => {
    const event = validEvent();
    const option = event.options[0];
    if (option === undefined) throw new Error("missing option fixture");

    const gapEvent = validEvent({
      options: [
        {
          ...option,
          checks: [
            {
              id: "gap",
              outcomes: [outcome("first", 0, 0.4), outcome("second", 0.5, 1)],
            },
          ],
        },
      ],
    });
    expect(
      issueCodes(createContentReleaseReport(withEvents(gapEvent), messages())),
    ).toContain("event.probability-gap");

    const overlapEvent = validEvent({
      options: [
        {
          ...option,
          checks: [
            {
              id: "overlap",
              outcomes: [outcome("first", 0, 0.6), outcome("second", 0.5, 1)],
            },
          ],
        },
      ],
    });
    expect(
      issueCodes(createContentReleaseReport(withEvents(overlapEvent), messages())),
    ).toContain("event.probability-overlap");

    const emptyEvent = validEvent({
      options: [
        {
          ...option,
          checks: [{ id: "empty", outcomes: [outcome("none", 0, 0)] }],
        },
      ],
    });
    expect(
      issueCodes(createContentReleaseReport(withEvents(emptyEvent), messages())),
    ).toContain("event.unreachable-outcome");
  });

  it("validates qualitative likelihood promises against their success outcomes", () => {
    const event = validEvent();
    const option = event.options[0];
    const check = option?.checks[0];
    if (option === undefined || check === undefined) {
      throw new Error("missing likelihood fixture");
    }
    const promised = validEvent({
      options: [
        {
          ...option,
          checks: [
            {
              ...check,
              likelihoodPromise: {
                label: "uncertain",
                successOutcomeIds: ["good"],
              },
            },
          ],
        },
      ],
    });
    const accepted = createContentReleaseReport(withEvents(promised), messages());
    expect(accepted.summary).toEqual({ releaseBlocking: 0, warnings: 0 });
    expect(accepted.eventAnalysis.qualitativeLikelihoodPromises).toBe(1);

    const promisedOption = promised.options[0];
    const promisedCheck = promisedOption?.checks[0];
    if (promisedOption === undefined || promisedCheck?.likelihoodPromise === undefined) {
      throw new Error("missing cloned likelihood promise");
    }
    const mismatched = validEvent({
      options: [
        {
          ...promisedOption,
          checks: [
            {
              ...promisedCheck,
              likelihoodPromise: {
                ...promisedCheck.likelihoodPromise,
                label: "very-likely",
              },
            },
          ],
        },
      ],
    });
    expect(
      issueCodes(createContentReleaseReport(withEvents(mismatched), messages())),
    ).toContain("event.likelihood-promise-mismatch");

    const badIds = validEvent({
      options: [
        {
          ...promisedOption,
          checks: [
            {
              ...promisedCheck,
              likelihoodPromise: {
                ...promisedCheck.likelihoodPromise,
                successOutcomeIds: ["missing", "missing"],
              },
            },
          ],
        },
      ],
    });
    const badIdCodes = issueCodes(
      createContentReleaseReport(withEvents(badIds), messages()),
    );
    expect(badIdCodes).toContain("event.unknown-likelihood-success-outcome");
    expect(badIdCodes).toContain("event.duplicate-likelihood-success-outcome");
  });

  it("finds contradictory event and option predicates without inspecting game state", () => {
    expect(
      isEventPredicateSatisfiable({
        type: "all",
        items: [
          { type: "compare", metric: "player.cash", op: "lt", value: 0 },
          { type: "compare", metric: "player.cash", op: "gte", value: 0 },
        ],
      }),
    ).toBe(false);
    expect(
      isEventPredicateSatisfiable({
        type: "not",
        item: { type: "compare", metric: "player.cash", op: "eq", value: 0 },
      }),
    ).toBe(true);

    const event = validEvent();
    const option = event.options[0];
    if (option === undefined) throw new Error("missing option fixture");
    const unreachable = validEvent({
      options: [
        {
          ...option,
          requirements: {
            type: "all",
            items: [
              { type: "has-flag", flag: "approval", value: true },
              { type: "has-flag", flag: "approval", value: false },
            ],
          },
        },
      ],
    });
    const codes = issueCodes(
      createContentReleaseReport(withEvents(unreachable), messages()),
    );
    expect(codes).toContain("event.unreachable-option");
    expect(codes).toContain("event.unreachable-outcome");
  });

  it("verifies localisation keys, placeholder bindings, types, and grammar", () => {
    const invalidMessages = messages({
      "event.test.title": "{UNKNOWN} asked {AI_NAME, number}",
      "event.test.body": "{YEAR, plural, one {year}}",
    });
    const codes = issueCodes(
      createContentReleaseReport(withEvents(validEvent()), invalidMessages),
    );
    expect(codes).toContain("localisation.unbound-placeholder");
    expect(codes).toContain("localisation.placeholder-type");
    expect(codes).toContain("localisation.invalid-template");

    const missing = messages();
    const { "event.test.body": _body, ...withoutBody } = missing.messages;
    expect(
      issueCodes(
        createContentReleaseReport(withEvents(validEvent()), {
          locale: "en-GB",
          messages: withoutBody,
        }),
      ),
    ).toContain("localisation.missing-key");
  });

  it("treats mandatory trigger-number bindings as numeric placeholders", () => {
    const event = validEvent({
      trigger: {
        kind: "mandatory",
        detector: "government-nationalisation",
        priority: 100,
      },
      bodyKey: "event.test.government.body",
      tokenBindings: [
        { token: "INTERVENTION_ID", source: "trigger-text" },
        { token: "INTERVENTION_PRESSURE", source: "trigger-number" },
      ],
    });
    const report = createContentReleaseReport(
      withEvents(event),
      messages({
        "event.test.title": "Government intervention {INTERVENTION_ID}",
        "event.test.government.body": "Pressure is {INTERVENTION_PRESSURE, number}.",
      }),
    );
    expect(report.summary.releaseBlocking).toBe(0);
  });

  it("rejects direct catastrophe effects and retired ending names", () => {
    const event = validEvent();
    const option = event.options[0];
    if (option === undefined) throw new Error("missing option fixture");
    const catastrophe = validEvent({
      options: [
        {
          ...option,
          immediateEffects: [
            {
              kind: "end-run",
              result: "lost",
            } as unknown as EventEffectDefinition,
          ],
        },
      ],
    });
    const report = createContentReleaseReport(withEvents(catastrophe), messages(), [
      { path: "apps/web/src/example.tsx", source: "The Long Boom" },
    ]);
    expect(issueCodes(report)).toEqual(
      expect.arrayContaining(["copy.retired-ending-name", "event.ungated-catastrophe"]),
    );
  });

  it("checks score references and release-critical source and alt-text completeness", () => {
    const facility = Object.values(compiled.facilities)[0];
    const paper = Object.values(compiled.papers.definitions).find(
      (candidate) => candidate.historicity === "real",
    );
    const researcher = Object.values(compiled.researchers.definitions)[0];
    if (facility === undefined || paper === undefined || researcher === undefined) {
      throw new Error("compiled fixture is incomplete");
    }
    const { primarySourceUrl: _primarySourceUrl, ...paperWithoutSource } = paper;
    const syntheticFacility = {
      ...facility,
      id: contentId("base:facility.unscored-test"),
      scoreTag: "unscored-test",
    };
    const altered: CompiledContent = {
      ...compiled,
      facilities: {
        ...compiled.facilities,
        [syntheticFacility.id]: syntheticFacility,
      },
      papers: {
        ...compiled.papers,
        definitions: {
          ...compiled.papers.definitions,
          [paper.id]: paperWithoutSource,
        },
      },
      researchers: {
        ...compiled.researchers,
        definitions: {
          ...compiled.researchers.definitions,
          [researcher.id]: {
            ...researcher,
            portrait: { ...researcher.portrait, altText: "" },
          },
        },
      },
    };

    expect(issueCodes(createContentReleaseReport(altered))).toEqual(
      expect.arrayContaining([
        "paper.missing-primary-source",
        "researcher.missing-alt-text",
        "score.unresolved-facility-tag",
      ]),
    );

    const unknownMilestone: CompiledContent = {
      ...compiled,
      scoreRules: {
        ...compiled.scoreRules,
        awardTables: {
          ...compiled.scoreRules.awardTables,
          raceAwards: {
            ...compiled.scoreRules.awardTables.raceAwards,
            mysteryShortcut: {
              category: "score.race-operations",
              points: 9_999,
            },
          },
        },
      },
    };
    expect(issueCodes(createContentReleaseReport(unknownMilestone))).toContain(
      "score.unknown-milestone",
    );
  });

  it("emits a deterministic report with no wall-clock fields", () => {
    const first = createContentReleaseReport(compiled);
    const second = createContentReleaseReport(compiled);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toMatch(/generatedAt|timestamp/i);
  });

  it("reports manifest quota gaps and incomplete or stale editorial reviews", () => {
    const report = createContentReleaseReport(compiled);
    expect(report.quotaAnalysis.requirements).toContainEqual({
      id: "labs",
      target: 5,
      actual: 5,
      remaining: 0,
      complete: true,
    });
    expect(report.quotaAnalysis.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining(["ordinaryDecisionEvents"]),
    );
    expect(report.quotaAnalysis.gaps.map((gap) => gap.id)).not.toContain(
      "labFeedTemplates",
    );
    // The star-researcher quota is met by the full 105-person catalogue.
    expect(report.quotaAnalysis.gaps.map((gap) => gap.id)).not.toContain(
      "starResearchers",
    );
    expect(report.reviewAnalysis.definitions).toBe(
      Object.keys(compiled.leaders).length +
        Object.keys(compiled.papers.definitions).length +
        Object.keys(compiled.researchers.definitions).length,
    );
    expect(report.reviewAnalysis.gaps).toEqual([]);
    const leader = Object.values(compiled.leaders)[0];
    if (leader === undefined) throw new Error("no leader to check");
    const undated: CompiledContent = {
      ...compiled,
      leaders: {
        ...compiled.leaders,
        [leader.id]: {
          ...leader,
          editorialReview: { ...leader.editorialReview, lastReviewed: null },
        },
      },
    };
    expect(
      createContentReleaseReport(undated).reviewAnalysis.gaps.find(
        (gap) => gap.definitionId === leader.id,
      )?.missing,
    ).toEqual(expect.arrayContaining(["last-reviewed"]));
    const realPaper = Object.values(compiled.papers.definitions).find(
      (candidate) => candidate.editorialReview.portrayalStatus === "historical-record",
    );
    if (realPaper === undefined) throw new Error("no historical paper to check");
    const unsourced: CompiledContent = {
      ...compiled,
      papers: {
        ...compiled.papers,
        definitions: {
          ...compiled.papers.definitions,
          [realPaper.id]: {
            ...realPaper,
            editorialReview: { ...realPaper.editorialReview, sourceNotes: [] },
          },
        },
      },
    };
    expect(
      createContentReleaseReport(unsourced).reviewAnalysis.gaps.find(
        (gap) => gap.definitionId === realPaper.id,
      )?.missing,
    ).toEqual(expect.arrayContaining(["source-notes"]));
    expect(report.reviewAnalysis.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const paper = Object.values(compiled.papers.definitions)[0];
    if (paper === undefined) throw new Error("paper fixture missing");
    const flagged: CompiledContent = {
      ...compiled,
      papers: {
        ...compiled.papers,
        definitions: {
          ...compiled.papers.definitions,
          [paper.id]: {
            ...paper,
            editorialReview: {
              ...paper.editorialReview,
              legalStatus: "legal-review-needed",
            },
          },
        },
      },
    };
    expect(
      createContentReleaseReport(flagged).reviewAnalysis.gaps.find(
        (gap) => gap.definitionId === paper.id,
      )?.missing,
    ).toEqual(expect.arrayContaining(["legal-review"]));

    const stale: CompiledContent = {
      ...compiled,
      papers: {
        ...compiled.papers,
        definitions: {
          ...compiled.papers.definitions,
          [paper.id]: {
            ...paper,
            editorialReview: {
              ...paper.editorialReview,
              lastReviewed: "2020-01-01",
              legalStatus: "legal-reviewed",
            },
          },
        },
      },
    };
    expect(createContentReleaseReport(stale).reviewAnalysis.gaps).toContainEqual(
      expect.objectContaining({ definitionId: paper.id, stale: true }),
    );
  });

  it("promotes quota and editorial gaps to release blockers for a final manifest", () => {
    const final: CompiledContent = {
      ...compiled,
      authoringManifest: { ...compiled.authoringManifest, status: "final" },
    };
    const codes = issueCodes(createContentReleaseReport(final));
    expect(codes).toContain("quota.incomplete");
    expect(codes).not.toContain("review.incomplete");

    const leaderId = Object.keys(compiled.leaders)[0];
    const leader = leaderId === undefined ? undefined : compiled.leaders[leaderId];
    if (leader === undefined) throw new Error("no leader to check");
    const finalWithGap: CompiledContent = {
      ...final,
      leaders: {
        ...compiled.leaders,
        [leader.id]: {
          ...leader,
          editorialReview: { ...leader.editorialReview, lastReviewed: null },
        },
      },
    };
    expect(issueCodes(createContentReleaseReport(finalWithGap))).toContain(
      "review.incomplete",
    );
  });

  it("treats generated researcher portraits as art rather than missing files", () => {
    // Portraits are drawn by the pixel-portrait generator from each
    // researcher's id, brief and alt text. Nothing is authored, so nothing can
    // be missing -- and a final manifest must not start demanding files for
    // art that is produced at run time.
    const draftReport = createContentReleaseReport(compiled);
    expect(draftReport.assetAnalysis).toEqual({
      manifestStatus: "draft",
      definitions: 0,
      references: 0,
      resolvedReferences: 0,
      missingReferences: [],
      unreferencedDefinitions: [],
    });
    expect(issueCodes(draftReport)).not.toContain("asset.missing-reference");

    const finalAssets: CompiledContent = {
      ...compiled,
      assets: { ...compiled.assets, status: "final" },
    };
    expect(issueCodes(createContentReleaseReport(finalAssets))).not.toContain(
      "asset.missing-reference",
    );

    const researcher = Object.values(compiled.researchers.definitions)[0];
    if (researcher === undefined) throw new Error("researcher fixture missing");
    const contradictory: CompiledContent = {
      ...compiled,
      assets: {
        status: "draft",
        definitions: {
          [researcher.portrait.assetId]: {
            id: researcher.portrait.assetId,
            kind: "portrait",
            sourcePath: "design/production/researchers/wrong.png",
            sourceSha256: "c".repeat(64),
            mediaType: "image/png",
            pixelDimensions: { width: 32, height: 32 },
            scalePolicy: "integer-pixel",
            accessibility: { decorative: true },
            rights: {
              copyrightHolder: "Neolab.ai contributors",
              licence: "LicenseRef-Neolab-Proprietary",
              sourceNotes: ["Synthetic validation fixture."],
            },
            portrait: {
              subjectId: contentId("base:researcher.someone-else"),
              fictionalisationStatus: "fictionalized-real-person",
            },
          },
        },
        orderedIds: [researcher.portrait.assetId],
      },
    };
    const contradictoryCodes = issueCodes(createContentReleaseReport(contradictory));
    expect(contradictoryCodes).toContain("asset.portrait-decorative");
    expect(contradictoryCodes).toContain("asset.portrait-subject");
  });

  it("requires normalised editorial metadata in compiled sourced definitions", () => {
    const firstLeader = Object.values(compiled.leaders)[0];
    if (firstLeader === undefined) throw new Error("leader fixture missing");
    const { editorialReview: _editorialReview, ...withoutEditorialReview } = firstLeader;
    const invalid = structuredClone(compiled) as unknown as {
      leaders: Record<string, unknown>;
    };
    invalid.leaders[firstLeader.id] = withoutEditorialReview;
    expect(() => validateCompiledContent(invalid)).toThrow(
      /editorialReview.*Invalid input/i,
    );
  });

  it("requires the normalised asset catalogue in compiled content", () => {
    const invalid = structuredClone(compiled) as unknown as Record<string, unknown>;
    delete invalid["assets"];
    expect(() => validateCompiledContent(invalid)).toThrow(/assets.*Invalid input/i);
  });

  it("validates a synthetic launch-quota catalogue within the compiler budget", () => {
    const definitions: EventDefinition[] = [];
    const addEvents = (
      count: number,
      prefix: string,
      overrides: Partial<EventDefinition>,
    ): void => {
      for (let index = 0; index < count; index += 1) {
        definitions.push(
          validEvent({
            id: contentId(`base:event.volume-${prefix}-${String(index)}`),
            cooldown: { group: `volume-${prefix}`, weeks: 1 },
            ...overrides,
          }),
        );
      }
    };
    addEvents(180, "ordinary", {});
    addEvents(30, "crisis", { phase: "crisis", category: "safety" });
    addEvents(48, "endgame", { category: "endgame", phase: "frontier" });
    addEvents(12, "endgame-insert", {
      category: "endgame",
      phase: "crisis",
    });
    addEvents(600, "feed", { severity: "feed" });

    const researcherTemplates = Object.values(compiled.researchers.definitions);
    const researcherDefinitions = { ...compiled.researchers.definitions };
    for (let index = researcherTemplates.length; index < 100; index += 1) {
      const template = researcherTemplates[index % researcherTemplates.length];
      if (template === undefined) throw new Error("researcher template missing");
      const id = contentId(`base:researcher.volume-${String(index)}`);
      researcherDefinitions[id] = { ...template, id };
    }
    const facilityTemplates = Object.values(compiled.facilities);
    const facilities = { ...compiled.facilities };
    for (let index = facilityTemplates.length; index < 44; index += 1) {
      const template = facilityTemplates[index % facilityTemplates.length];
      if (template === undefined) throw new Error("facility template missing");
      const id = contentId(`base:facility.volume-${String(index)}`);
      facilities[id] = { ...template, id, prerequisiteFacilityIds: [] };
    }
    const scaled: CompiledContent = {
      ...compiled,
      facilities,
      researchers: {
        ...compiled.researchers,
        definitions: researcherDefinitions,
        orderedIds: Object.values(researcherDefinitions).map(
          (researcher) => researcher.id,
        ),
      },
      events: {
        definitions: Object.fromEntries(
          definitions.map((definition) => [definition.id, definition]),
        ),
        orderedIds: definitions.map((definition) => definition.id),
      },
    };

    const started = performance.now();
    const report = createContentReleaseReport(scaled, messages());
    const durationMs = performance.now() - started;
    expect(report.eventAnalysis.definitions).toBe(870);
    expect(report.quotaAnalysis.gaps).toEqual([]);
    expect(durationMs).toBeLessThan(5_000);
  }, 10_000);
});
