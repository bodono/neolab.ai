import { describe, expect, it } from "vitest";

import { eventCatalogueDefinitionSchema, eventDefinitionSchema } from "../compiled.ts";

function validEvent(): Record<string, unknown> {
  return {
    id: "base:event.ai.root-access-request",
    version: 1,
    category: "ai",
    severity: "urgent",
    phase: "any",
    trigger: { kind: "opportunity" },
    prerequisites: {
      type: "compare",
      metric: "player.cash",
      op: "gte",
      value: 4,
    },
    baseWeight: 1,
    weightModifiers: [
      { predicate: { type: "has-flag", flag: "ai:asked-before" }, multiplier: 0.5 },
    ],
    cooldown: { group: "ai_access_request", weeks: 13 },
    unique: false,
    expiryWeeks: 2,
    defaultOptionId: "deny",
    titleKey: "event.root_access.title",
    bodyKey: "event.root_access.body",
    evidence: [{ textKey: "event.root_access.cash", metric: "player.cash" }],
    tokenBindings: [{ token: "AI_NAME", source: "player-ai-name" }],
    options: [
      {
        id: "deny",
        labelKey: "event.root_access.deny.label",
        requirements: { type: "always" },
        knownCosts: [],
        previewKey: "event.root_access.deny.preview",
        immediateEffects: [
          {
            kind: "set-flag",
            subject: { type: "player-lab" },
            flag: "root-access-denied",
            value: true,
          },
        ],
        checks: [],
        memories: [
          {
            key: "denied-root-access",
            subjects: [{ type: "player-lab" }],
            tags: ["root-access"],
          },
        ],
        confirmationRequired: false,
      },
    ],
    followUps: [],
    telemetryTags: ["root-access"],
  };
}

describe("compiled event schemas", () => {
  it("accepts the closed event, predicate, option, effect, and memory grammar", () => {
    const definition = validEvent();
    expect(eventDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(
      eventCatalogueDefinitionSchema.safeParse({
        definitions: { "base:event.ai.root-access-request": definition },
        orderedIds: ["base:event.ai.root-access-request"],
      }).success,
    ).toBe(true);
  });

  it("accepts government mandatory detectors and typed trigger tokens", () => {
    const definition = validEvent();
    definition["trigger"] = {
      kind: "mandatory",
      detector: "government-nationalisation",
      priority: 100,
    };
    definition["tokenBindings"] = [
      { token: "INTERVENTION_ID", source: "trigger-text" },
      { token: "INTERVENTION_PRESSURE", source: "trigger-number" },
    ];
    expect(eventDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it("rejects unknown keys, unregistered metrics, and invalid outcome ranges", () => {
    const unknownKey = { ...validEvent(), runScript: "absolutely not" };
    expect(eventDefinitionSchema.safeParse(unknownKey).success).toBe(false);

    const invalidMetric = validEvent();
    invalidMetric["prerequisites"] = {
      type: "compare",
      metric: "player.hiddenSafety",
      op: "gte",
      value: 1,
    };
    expect(eventDefinitionSchema.safeParse(invalidMetric).success).toBe(false);

    const invalidOutcome = validEvent();
    const options = invalidOutcome["options"] as Record<string, unknown>[];
    const first = options[0];
    if (first === undefined) throw new Error("missing option fixture");
    first["checks"] = [
      {
        id: "bad-range",
        outcomes: [
          {
            id: "impossible",
            minimumInclusive: -0.1,
            maximumExclusive: 1.1,
            effects: [],
            memories: [],
          },
        ],
      },
    ];
    expect(eventDefinitionSchema.safeParse(invalidOutcome).success).toBe(false);
  });

  it("rejects a sentiment score on an authored memory", () => {
    // Memories dispatch on tags. Valence exists on the runtime memory record
    // and is read for exactly one runtime-built case, so an authored score
    // would look like a consequence and be inert. Tag it instead.
    const scored = validEvent();
    const options = scored["options"] as Record<string, unknown>[];
    const first = options[0];
    if (first === undefined) throw new Error("missing option fixture");
    const memories = first["memories"] as Record<string, unknown>[];
    const memory = memories[0];
    if (memory === undefined) throw new Error("missing memory fixture");
    memory["valence"] = -1;
    expect(eventDefinitionSchema.safeParse(scored).success).toBe(false);
  });

  it("accepts only closed, non-empty structured likelihood promises", () => {
    const promised = validEvent();
    const options = promised["options"] as Record<string, unknown>[];
    const first = options[0];
    if (first === undefined) throw new Error("missing option fixture");
    first["checks"] = [
      {
        id: "result",
        outcomes: [
          {
            id: "success",
            minimumInclusive: 0,
            maximumExclusive: 1,
            effects: [],
            memories: [],
          },
        ],
        likelihoodPromise: {
          label: "very-likely",
          successOutcomeIds: ["success"],
        },
      },
    ];
    expect(eventDefinitionSchema.safeParse(promised).success).toBe(true);

    const invalidLabel = structuredClone(promised);
    const invalidOptions = invalidLabel["options"] as Record<string, unknown>[];
    const invalidChecks = invalidOptions[0]?.["checks"] as Record<string, unknown>[];
    const invalidPromise = invalidChecks[0]?.["likelihoodPromise"] as Record<
      string,
      unknown
    >;
    invalidPromise["label"] = "probably-ish";
    expect(eventDefinitionSchema.safeParse(invalidLabel).success).toBe(false);

    const emptySuccesses = structuredClone(promised);
    const emptyOptions = emptySuccesses["options"] as Record<string, unknown>[];
    const emptyChecks = emptyOptions[0]?.["checks"] as Record<string, unknown>[];
    const emptyPromise = emptyChecks[0]?.["likelihoodPromise"] as Record<string, unknown>;
    emptyPromise["successOutcomeIds"] = [];
    expect(eventDefinitionSchema.safeParse(emptySuccesses).success).toBe(false);
  });
});
