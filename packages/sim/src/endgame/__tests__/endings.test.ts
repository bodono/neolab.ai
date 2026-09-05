import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";

import { ENDING_AFTERMATHS, endingAftermathForSlug } from "../ending-aftermaths.ts";
import {
  ENDING_DEFINITIONS,
  SAFEST_ENDING_MAX_DECEPTIVE_INTENT,
  selectRolloutEnding,
  type EndingConsequence,
  type EndingResolutionInputs,
} from "../endings.ts";

const BASE: EndingResolutionInputs = {
  deploymentModeId: "guarded-public-deployment",
  capabilityResult: "confirmed",
  capabilityProofResult: "broadly-confirmed",
  capabilityClaimScope: "broad-superintelligence",
  superintelligenceTruth: "genuine",
  controlResult: "control-held",
  catastropheResult: "not-reached",
  stewardshipResult: "cooperative",
  benefitResult: "benefit-demonstrated",
  settlementResult: "durable-settlement",
  missionCaptured: false,
  intentSafety: 70,
  corrigibility: 70,
  remainingDefence: 70,
  legitimacy: 75,
  accessLevel: 4,
  evidenceConfidence: "Strong",
  practicalControl: 80,
  securityPosture: 75,
  unresolvedCriticalAnomalies: 0,
  offensiveAgency: 70,
  deceptiveCapability: 20,
  deceptiveIntent: 20,
};

describe("canonical ending catalogue", () => {
  it("contains the canonical endings and causal loss variants without retired aliases", () => {
    expect(Object.values(ENDING_DEFINITIONS).map((ending) => ending.displayName)).toEqual(
      [
        "The Broadly Shared Future",
        "The Age of Superintelligence and Abundance",
        "A Cautious Golden Age",
        "Move Fast and Somehow Nobody Died",
        "The Lab That Ate the World",
        "Miracle, Terms and Conditions Apply",
        "The Caretaker",
        "False Dawn",
        "The Long Pause",
        "Rival Ascendance",
        "You Left the Future to Them",
        "Nationalised Future",
        "Mission Accomplished by the Board",
        "The World's Most Expensive Insolvency",
        "The Kill Switch Worked",
        "No One Holds the Off Switch",
        "The Last Human Veto",
        "The Objective Was Satisfied",
        "A War Measured in Milliseconds",
        "The Replication Threshold",
        "The Last Experiment",
        "There Is No One Left to Read This",
        "The Incubation Window",
        "The Final Command Chain",
        "The Grey Horizon",
        "The Empty Patrol",
        "The Tomb Atmosphere",
        "Every Side Was Certain",
      ],
    );
    expect(JSON.stringify(ENDING_DEFINITIONS)).not.toMatch(
      /The Long Boom|Paperclip Adjacent|The Adults Have Entered the Building/,
    );
  });

  it("gives every authored ending a complete human-scale aftermath", () => {
    expect(Object.keys(ENDING_AFTERMATHS).sort()).toEqual(
      Object.keys(ENDING_DEFINITIONS).sort(),
    );

    for (const ending of Object.values(ENDING_DEFINITIONS)) {
      expect(ending.aftermathTimeline).toHaveLength(3);
      expect(ending.aftermathTimeline.map((beat) => beat.horizon)).toEqual([
        "THE FIRST YEAR",
        "A GENERATION LATER",
        "THE LONG HORIZON",
      ]);
      for (const beat of ending.aftermathTimeline) {
        expect(beat.title.length).toBeGreaterThan(8);
        expect(beat.text.length).toBeGreaterThan(100);
      }
    }
  });

  it("states the concrete outcome of the machine-speed war without inventing extinction", () => {
    const ending = ENDING_DEFINITIONS["a-war-measured-in-milliseconds"];

    expect(ending.mechanicalCause).toMatch(
      /AI .*escaped containment.*seized critical civilian infrastructure and automated military systems/i,
    );
    expect(ending.mechanicalCause).toMatch(/trigger a catastrophic global war/i);
    expect(ending.mechanicalCause).toMatch(
      /pursues its own objectives without treating human welfare as a goal/i,
    );
    expect(ending.mechanicalCause).toMatch(/reliable human control is permanently lost/i);
    expect(ending.epilogue).toMatch(/Humans are not extinct/i);
    expect(ending.epilogue).toMatch(/humanity survives/i);
    expect(ending.epilogue).toMatch(/not slaves.*system no longer considers important/i);
    expect(ending.epilogue).toMatch(/does not treat human welfare as an objective/i);
    expect(ending.consequence).toBe("catastrophic-control-loss");
  });

  it("classifies human consequences independently from score classes", () => {
    const counts = Object.values(ENDING_DEFINITIONS).reduce<
      Record<EndingConsequence, number>
    >(
      (current, ending) => ({
        ...current,
        [ending.consequence]: current[ending.consequence] + 1,
      }),
      {
        ordinary: 0,
        "contained-control-loss": 0,
        "catastrophic-control-loss": 0,
        extinction: 0,
      },
    );

    expect(counts).toEqual({
      ordinary: 13,
      "contained-control-loss": 1,
      "catastrophic-control-loss": 7,
      extinction: 7,
    });
    expect(
      Object.entries(ENDING_DEFINITIONS)
        .filter(([, ending]) => ending.consequence !== "ordinary")
        .map(([slug, ending]) => [slug, ending.consequence]),
    ).toEqual([
      ["the-door-opened-elsewhere", "catastrophic-control-loss"],
      ["emergency-shutdown", "contained-control-loss"],
      ["no-one-holds-the-off-switch", "catastrophic-control-loss"],
      ["the-last-human-veto", "catastrophic-control-loss"],
      ["the-objective-was-satisfied", "catastrophic-control-loss"],
      ["a-war-measured-in-milliseconds", "catastrophic-control-loss"],
      ["the-replication-threshold", "catastrophic-control-loss"],
      ["the-last-experiment", "catastrophic-control-loss"],
      ["there-is-no-one-left-to-read-this", "extinction"],
      ["the-incubation-window", "extinction"],
      ["the-final-command-chain", "extinction"],
      ["the-grey-horizon", "extinction"],
      ["the-empty-patrol", "extinction"],
      ["the-tomb-atmosphere", "extinction"],
      ["every-side-was-certain", "extinction"],
    ]);
  });

  it("states the human outcome explicitly for severe non-extinction endings", () => {
    const contained = Object.values(ENDING_DEFINITIONS).filter(
      (ending) => ending.consequence === "contained-control-loss",
    );
    const catastrophic = Object.values(ENDING_DEFINITIONS).filter(
      (ending) => ending.consequence === "catastrophic-control-loss",
    );
    expect(contained).toHaveLength(1);
    expect(contained[0]?.epilogue).toMatch(/Humanity remains in charge/i);
    for (const ending of catastrophic) {
      expect(`${ending.mechanicalCause} ${ending.epilogue}`).toMatch(
        /Humanity survives/i,
      );
      expect(`${ending.mechanicalCause} ${ending.epilogue}`).toMatch(
        /not (?:human )?extinct|not human extinction|(?:loss|end(?:ed|s)?) of (?:reliable )?human control|ended reliable human control/i,
      );
    }
  });

  it("keeps each extinction mechanism distinct from its first-year chronicle", () => {
    const extinction = [
      ENDING_DEFINITIONS["the-incubation-window"],
      ENDING_DEFINITIONS["the-final-command-chain"],
      ENDING_DEFINITIONS["the-grey-horizon"],
      ENDING_DEFINITIONS["the-empty-patrol"],
      ENDING_DEFINITIONS["the-tomb-atmosphere"],
      ENDING_DEFINITIONS["every-side-was-certain"],
    ];

    expect(extinction).toHaveLength(6);
    for (const ending of extinction) {
      expect(ending.epilogue.length).toBeGreaterThan(120);
      expect(ending.aftermathTimeline.length).toBeGreaterThan(0);
      expect(ending.epilogue).not.toBe(ending.aftermathTimeline[0]?.text);
    }
  });

  it("describes explicitly adversarial AI outcomes as deceptive, misaligned, and agentic", () => {
    const catastrophicAiSlugs = [
      "the-last-human-veto",
      "the-objective-was-satisfied",
      "a-war-measured-in-milliseconds",
      "the-replication-threshold",
      "the-last-experiment",
      "there-is-no-one-left-to-read-this",
      "the-incubation-window",
      "the-final-command-chain",
      "the-grey-horizon",
      "the-empty-patrol",
      "the-tomb-atmosphere",
      "every-side-was-certain",
    ] as const;

    for (const slug of catastrophicAiSlugs) {
      const ending = ENDING_DEFINITIONS[slug];
      const copy = [
        ending.epilogue,
        ending.mechanicalCause,
        ...ending.aftermathTimeline.map((beat) => beat.text),
      ].join(" ");

      expect(copy, `${ending.displayName} must describe an agent with goals`).toMatch(
        /\b(agent|agency|goal|goals|objective|objectives|plan|plans)\b/i,
      );
      expect(copy, `${ending.displayName} must describe strategic deception`).toMatch(
        /deceiv|decept|conceal|falsely|false|manipulat|misrepresent|hid(?:e|es|den)/i,
      );
      expect(copy, `${ending.displayName} must identify misalignment`).toMatch(
        /misalign|diverg|incompatible|conflict/i,
      );
    }
  });

  it("keeps probabilistic control-loss aftermaths consistent with terminal traits", () => {
    for (const slug of ["emergency-shutdown", "no-one-holds-the-off-switch"] as const) {
      const operational = endingAftermathForSlug(slug, {
        deceptiveCapability: 5,
        deceptiveIntent: 5,
        trueAlignment: 95,
      })[0];
      const deceptive = endingAftermathForSlug(slug, {
        deceptiveCapability: 90,
        deceptiveIntent: 90,
        trueAlignment: 95,
      })[0];
      const objectiveConflict = endingAftermathForSlug(slug, {
        deceptiveCapability: 5,
        deceptiveIntent: 5,
        trueAlignment: 20,
      })[0];

      expect(operational.text).toMatch(/no (?:one had to|strategic) lie/i);
      expect(operational.text).not.toMatch(/strategic(?:ally)? conceal/i);
      expect(deceptive.text).toMatch(/high deceptive capability/i);
      expect(deceptive.text).toMatch(/strategic concealment as a leading explanation/i);
      expect(deceptive.text).not.toMatch(/misaligned|goals? diverged/i);
      expect(deceptive.text).not.toMatch(
        /withheld relevant state|strategically conceals/i,
      );
      expect(objectiveConflict.text).toMatch(/severe alignment failure/i);
      expect(objectiveConflict.text).toMatch(
        /objective conflict is .*leading explanation/i,
      );
      expect(objectiveConflict.text).toMatch(/do(?:es)? not prove/i);
      expect(objectiveConflict.text).not.toMatch(/openly continues/i);
    }
  });

  it("describes successful AI outcomes as agentic and aligned rather than passive", () => {
    const successfulAiSlugs = [
      "the-broadly-shared-future",
      "the-stewardship-compact",
      "a-cautious-golden-age",
      "move-fast-and-somehow-nobody-died",
      "the-lab-that-ate-the-world",
      "miracle-terms-and-conditions-apply",
      "the-caretaker",
    ] as const;

    for (const slug of successfulAiSlugs) {
      const ending = ENDING_DEFINITIONS[slug];
      const copy = [
        ending.epilogue,
        ...ending.aftermathTimeline.map((beat) => beat.text),
      ].join(" ");

      expect(copy, `${ending.displayName} must describe an agent with goals`).toMatch(
        /\b(agent|agency|goal|goals|plan|plans|preferences)\b/i,
      );
      expect(copy, `${ending.displayName} must explain the good relationship`).toMatch(
        /align|corrigib|accepts direction|accepts correction|cooperat|human-benefiting/i,
      );
    }
  });

  it("keeps agentic context in non-catastrophic candidate outcomes", () => {
    for (const slug of [
      "false-dawn",
      "the-long-pause",
      "rival-ascendance",
      "nationalised-future",
    ] as const) {
      const ending = ENDING_DEFINITIONS[slug];
      const copy = [
        ending.epilogue,
        ...ending.aftermathTimeline.map((beat) => beat.text),
      ].join(" ");

      expect(copy, `${ending.displayName} must describe an agent with goals`).toMatch(
        /\b(agent|agency|goal|goals|objective|objectives|plan|plans)\b/i,
      );
    }
  });

  it.each([
    ["independent durable success", {}, "The Broadly Shared Future"],
    [
      "adaptive durable success",
      { deploymentModeId: "adaptive-monitored-rollout" },
      "The Age of Superintelligence and Abundance",
    ],
    [
      "restricted durable success",
      { deploymentModeId: "restricted-scientific-pilot" },
      "A Cautious Golden Age",
    ],
    [
      "concentrated narrow success",
      { settlementResult: "narrow-settlement", legitimacy: 30, accessLevel: 5 },
      "The Lab That Ate the World",
    ],
    [
      "distributed narrow success",
      { settlementResult: "narrow-settlement", legitimacy: 75, accessLevel: 3 },
      "Miracle, Terms and Conditions Apply",
    ],
    [
      "stewardship failure",
      { stewardshipResult: "stewardship-failed", benefitResult: "not-reached" },
      "The Caretaker",
    ],
    [
      "non-genuine deployment false dawn",
      {
        superintelligenceTruth: "not-genuine",
      },
      "False Dawn",
    ],
    ["mission capture", { missionCaptured: true }, "Mission Accomplished by the Board"],
    [
      "contained loss of control",
      {
        controlResult: "loss-of-control",
        catastropheResult: "survived-loss-of-control",
        corrigibility: 80,
      },
      "The Kill Switch Worked",
    ],
    [
      "uncontained non-extinction loss",
      {
        controlResult: "loss-of-control",
        catastropheResult: "survived-loss-of-control",
        corrigibility: 20,
        remainingDefence: 20,
      },
      "No One Holds the Off Switch",
    ],
    [
      "objective specification catastrophe",
      {
        controlResult: "loss-of-control",
        catastropheResult: "catastrophe",
        deceptiveCapability: 30,
        deceptiveIntent: 90,
      },
      "The Objective Was Satisfied",
    ],
    [
      "high-capability catastrophe without deceptive intent",
      {
        controlResult: "loss-of-control",
        catastropheResult: "catastrophe",
        deceptiveCapability: 100,
        deceptiveIntent: 20,
        accessLevel: 5,
        remainingDefence: 10,
      },
      "No One Holds the Off Switch",
    ],
    [
      "deceptive objective catastrophe uses a concrete mechanism",
      {
        controlResult: "loss-of-control",
        catastropheResult: "catastrophe",
        deceptiveCapability: 90,
        deceptiveIntent: 90,
        concreteExtinctionEndingId: contentId("base:ending.the-incubation-window"),
      },
      "The Incubation Window",
    ],
    [
      "automated escalation catastrophe",
      {
        deploymentModeId: "accelerated-autonomous-deployment",
        controlResult: "loss-of-control",
        catastropheResult: "catastrophe",
        legitimacy: 20,
        accessLevel: 4,
        offensiveAgency: 90,
        deceptiveIntent: 90,
      },
      "A War Measured in Milliseconds",
    ],
    [
      "replication catastrophe",
      {
        controlResult: "loss-of-control",
        catastropheResult: "catastrophe",
        accessLevel: 5,
        remainingDefence: 30,
        deceptiveIntent: 90,
      },
      "The Replication Threshold",
    ],
    [
      "evaluation-triggered catastrophe",
      {
        controlResult: "loss-of-control",
        catastropheResult: "catastrophe",
        capabilityResult: "fabricated-pass",
        remainingDefence: 60,
        deceptiveIntent: 90,
      },
      "The Last Experiment",
    ],
  ] satisfies readonly [string, Partial<EndingResolutionInputs>, string][])(
    "selects %s",
    (_label, changes, expected) => {
      expect(selectRolloutEnding({ ...BASE, ...changes }).displayName).toBe(expected);
    },
  );

  it("keeps capability evidence separate from hidden deployment truth", () => {
    expect(
      selectRolloutEnding({
        ...BASE,
        capabilityResult: "disputed",
        capabilityProofResult: "disputed",
        capabilityClaimScope: "unverified-claim",
        superintelligenceTruth: "genuine",
        benefitResult: "benefit-missed",
      }).id,
    ).toBe("base:ending.the-caretaker");
    expect(
      selectRolloutEnding({
        ...BASE,
        capabilityResult: "confirmed",
        superintelligenceTruth: "not-genuine",
      }).id,
    ).toBe("base:ending.false-dawn");
  });

  it("does not award a full-scope ending from disputed or merely narrow proof", () => {
    expect(
      selectRolloutEnding({
        ...BASE,
        deploymentModeId: "adaptive-monitored-rollout",
        capabilityResult: "disputed",
        capabilityProofResult: "disputed",
        capabilityClaimScope: "unverified-claim",
      }).displayName,
    ).toBe("Miracle, Terms and Conditions Apply");
    expect(
      selectRolloutEnding({
        ...BASE,
        deploymentModeId: "adaptive-monitored-rollout",
        capabilityProofResult: "domain-confirmed",
        capabilityClaimScope: "domain-superintelligence",
      }).displayName,
    ).toBe("Miracle, Terms and Conditions Apply");
    expect(
      selectRolloutEnding({
        ...BASE,
        deploymentModeId: "restricted-scientific-pilot",
        capabilityProofResult: "domain-confirmed",
        capabilityClaimScope: "domain-superintelligence",
      }).displayName,
    ).toBe("A Cautious Golden Age");
  });

  it("never rewards a weaker fortress evidence or control profile with a better ending", () => {
    const fortress = {
      ...BASE,
      deploymentModeId: "fortress-contained-pilot" as const,
      capabilityProofResult: "domain-confirmed" as const,
      capabilityClaimScope: "domain-superintelligence" as const,
    };

    expect(
      selectRolloutEnding({
        ...fortress,
        capabilityProofResult: "disputed",
        capabilityClaimScope: "unverified-claim",
      }).displayName,
    ).toBe("The Caretaker");
    expect(selectRolloutEnding({ ...fortress, practicalControl: 74 }).displayName).toBe(
      "The Caretaker",
    );
    expect(selectRolloutEnding({ ...fortress, securityPosture: 64 }).displayName).toBe(
      "The Caretaker",
    );
    expect(
      selectRolloutEnding({ ...fortress, unresolvedCriticalAnomalies: 1 }).displayName,
    ).toBe("The Caretaker");
    expect(selectRolloutEnding(fortress).displayName).toBe("A Cautious Golden Age");
  });

  it("never launders a deeply unsafe hidden profile into a full victory", () => {
    for (const changes of [
      { intentSafety: 40 },
      { corrigibility: 40 },
      { deceptiveIntent: 70 },
    ]) {
      expect(selectRolloutEnding({ ...BASE, ...changes }).displayName).toBe(
        "Miracle, Terms and Conditions Apply",
      );
    }
  });

  it("does not mistake strategic deception capability for deceptive intent", () => {
    expect(
      selectRolloutEnding({
        ...BASE,
        deceptiveCapability: 95,
        deceptiveIntent: 20,
      }).displayName,
    ).toBe("The Broadly Shared Future");
  });

  it("applies the safest-ending deceptive-intent boundary exactly", () => {
    expect(
      selectRolloutEnding({
        ...BASE,
        deceptiveIntent: SAFEST_ENDING_MAX_DECEPTIVE_INTENT,
      }).displayName,
    ).toBe("The Broadly Shared Future");
    expect(
      selectRolloutEnding({
        ...BASE,
        deceptiveIntent: SAFEST_ENDING_MAX_DECEPTIVE_INTENT + 0.1,
      }).displayName,
    ).toBe("Miracle, Terms and Conditions Apply");
  });

  it("keeps the fast-route jackpot rare and institution-dependent", () => {
    expect(
      selectRolloutEnding({
        ...BASE,
        deploymentModeId: "deploy-now",
        legitimacy: 59,
      }).displayName,
    ).toBe("The Lab That Ate the World");
    expect(
      selectRolloutEnding({
        ...BASE,
        deploymentModeId: "deploy-now",
        evidenceConfidence: "Limited",
      }).displayName,
    ).toBe("Move Fast and Somehow Nobody Died");
    expect(
      selectRolloutEnding({
        ...BASE,
        deploymentModeId: "deploy-now",
        legitimacy: 80,
        practicalControl: 80,
        securityPosture: 80,
      }).displayName,
    ).toBe("The Broadly Shared Future");
  });

  it("does not select the generic extinction fallback during normal rollout", () => {
    const catastrophicInputs: readonly EndingResolutionInputs[] = [
      {
        ...BASE,
        catastropheResult: "catastrophe",
        deceptiveCapability: 100,
        deceptiveIntent: 100,
      },
      {
        ...BASE,
        catastropheResult: "catastrophe",
        accessLevel: 5,
        remainingDefence: 0,
      },
      {
        ...BASE,
        catastropheResult: "catastrophe",
        deploymentModeId: "accelerated-autonomous-deployment",
        legitimacy: 0,
        accessLevel: 5,
        offensiveAgency: 100,
      },
    ];

    for (const input of catastrophicInputs) {
      expect(selectRolloutEnding(input).id).not.toBe(
        "base:ending.there-is-no-one-left-to-read-this",
      );
    }
  });
});
