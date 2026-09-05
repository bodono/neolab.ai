import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";
import { scenario, scenarioContent } from "@neolab/testkit";

import {
  advanceOneTick,
  applyCommand,
  calculateDomainOutput,
  researchPointsForNextLevel,
  CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG,
  rating,
  type CommandId,
} from "@neolab/sim";

const content = scenarioContent();
const architectures = contentId("base:domain.architectures");
const robotics = contentId("base:domain.robotics-embodiment");
const security = contentId("base:safety.security-containment");

describe("research content", () => {
  it("compiles all programmes and two choices at every twenty-level threshold", () => {
    expect(Object.keys(content.research.capabilityDomains)).toHaveLength(7);
    expect(Object.keys(content.research.safetyPrograms)).toHaveLength(3);
    expect(Object.keys(content.research.genericAdvances)).toHaveLength(100);
    expect(content.research.rules.genericAdvanceThresholds).toEqual([
      20, 40, 60, 80, 100,
    ]);
    expect(
      content.research.capabilityDomains[architectures]?.genericAdvanceOptionIds["80"],
    ).toHaveLength(2);
    expect(
      content.research.capabilityDomains[architectures]?.genericAdvanceOptionIds["10"],
    ).toBeUndefined();
  });

  it("pairs former rewards so the five-checkpoint ladder preserves terminal power", () => {
    const programme = content.research.capabilityDomains[architectures];
    if (programme === undefined) throw new Error("architectures content missing");
    const cleanerBlockEffects = Object.values(programme.genericAdvanceOptionIds)
      .map((optionIds) =>
        optionIds
          .map((optionId) => content.research.genericAdvances[optionId])
          .find((option) => option?.pathId === "cleaner-blocks"),
      )
      .map((option) => option?.effects[0]?.value);

    expect(cleanerBlockEffects).toEqual([1.1395, 1.20445, 1.2712, 1.33975, 1.4101]);
    expect(
      cleanerBlockEffects.reduce(
        (product: number, value) => product * (typeof value === "number" ? value : 1),
        1,
      ),
    ).toBeCloseTo(3.2960262967840253, 12);
  });

  it("applies programme personalities inside the separate branch cost curves", () => {
    const capabilityProgrammes = Object.values(content.research.capabilityDomains);
    const safetyProgrammes = Object.values(content.research.safetyPrograms);
    const architectureCost = researchPointsForNextLevel(content, architectures, 40);
    const roboticsCost = researchPointsForNextLevel(content, robotics, 40);
    const securityCost = researchPointsForNextLevel(content, security, 40);

    expect(roboticsCost).toBeCloseTo(architectureCost * 1.2, 10);
    expect(securityCost).toBeCloseTo(50 * 0.98 * 1.15 ** 20, 10);
    expect(roboticsCost).toBeGreaterThan(architectureCost);
    expect(securityCost).toBeGreaterThan(architectureCost);
    expect(
      new Set(capabilityProgrammes.map((programme) => programme.levelCostMultiplier))
        .size,
    ).toBe(capabilityProgrammes.length);
    expect(
      safetyProgrammes.map((programme) => programme.levelCostMultiplier).sort(),
    ).toEqual([0.98, 1, 1.02]);
  });

  it("never offers two research branches with identical mechanical effects", () => {
    const programmes = [
      ...Object.values(content.research.capabilityDomains),
      ...Object.values(content.research.safetyPrograms),
    ];
    for (const programme of programmes) {
      for (const optionIds of Object.values(programme.genericAdvanceOptionIds)) {
        const effectFingerprints = optionIds.map((optionId) =>
          JSON.stringify(content.research.genericAdvances[optionId]?.effects),
        );
        expect(
          new Set(effectFingerprints).size,
          `${programme.name} offers a false choice`,
        ).toBe(optionIds.length);
      }
    }
  });

  it("gives every programme milestone distinct authored choices and benefits", () => {
    const programmes = [
      ...Object.values(content.research.capabilityDomains),
      ...Object.values(content.research.safetyPrograms),
    ];
    for (const programme of programmes) {
      const milestones = Object.entries(programme.genericAdvanceOptionIds).sort(
        ([left], [right]) => Number(left) - Number(right),
      );
      const choices = milestones.flatMap(([, optionIds]) =>
        optionIds.map((optionId) => content.research.genericAdvances[optionId]),
      );
      const names = choices.map((choice) => choice?.name);
      const descriptions = choices.map((choice) => choice?.description);
      expect(new Set(names).size, `${programme.name} repeats branch names`).toBe(10);
      expect(
        new Set(descriptions).size,
        `${programme.name} repeats branch descriptions`,
      ).toBe(10);

      for (const branchIndex of [0, 1]) {
        const effectFingerprints = milestones.map(([, optionIds]) => {
          const optionId = optionIds[branchIndex];
          if (optionId === undefined) throw new Error("advance option missing");
          return JSON.stringify(content.research.genericAdvances[optionId]?.effects);
        });
        expect(
          new Set(effectFingerprints).size,
          `${programme.name} repeats the same branch benefit at every milestone`,
        ).toBe(5);
      }
    }
  });
});

describe("calculateDomainOutput", () => {
  it("uses delivered effective FLOP/s and exposes every non-secret factor", () => {
    // Pin the fleet explicitly: the pinned factor breakdown assumes 10,000
    // Kepler-class GPUs, independent of the (smaller) starting-rack economy.
    const state = scenario()
      .withPlayerLab((lab) => lab.gpus("gpu.kepler", 10_000))
      .build();
    const output = calculateDomainOutput(
      state,
      content,
      state.run.playerLabId,
      architectures,
    );
    // Mirrors content/research/domains.yaml: baseCoefficient and gpuExponent
    // were retuned to accelerate the opening while pinning the late game.
    const expectedBase = 0.675 * (1072 / 100) ** 0.56;

    expect(output).toMatchObject({
      physicalGpus: 1072,
      effectiveTeraflops: 4288,
      isFunded: true,
      generalTeamContribution: 0.225,
      talentMultiplier: 1.225,
      // Facilities no longer add a flat per-building research bonus; they pay
      // only through their own modifiers and the diffusion ladder.
      facilityMultiplier: 1,
      // Was derived from the research-freedom rating, which has been removed.
      // Now a flat baseline that returns the upside that rating used to sell.
      freedomMultiplier: 1.03,
      modelAssistMultiplier: 1,
      contextSwitchMultiplier: 1,
    });
    expect(output.baseResearchPoints).toBeCloseTo(expectedBase, 12);
    // freedomMultiplier is read from the output rather than pinned at 1: it was
    // omitted here while it happened to equal 1, so raising it silently broke an
    // assertion that looked like it covered the whole formula.
    expect(output.finalResearchPoints).toBeCloseTo(
      expectedBase *
        1.225 *
        output.freedomMultiplier *
        output.outputModifier *
        output.weeklyVariance,
      12,
    );
    expect(output.generations).toEqual([
      expect.objectContaining({
        generationId: "base:gpu.kepler",
        physicalGpus: 1072,
        effectiveTeraflops: 4288,
      }),
    ]);
    expect(
      calculateDomainOutput(state, content, state.run.playerLabId, architectures),
    ).toEqual(output);
    expect("researchScale" in output).toBe(false);
  });

  it("keeps weekly variance on a single band for every lab", () => {
    // Variance used to widen above a research-freedom rating of 80. That stat is
    // gone -- it bundled three hidden effects behind one number a player could
    // not read -- so every lab now draws from the same band and content moves
    // research output directly instead.
    const output = calculateDomainOutput(
      scenario().build(),
      content,
      scenario().build().run.playerLabId,
      architectures,
    );
    expect(output.weeklyVariance).toBeGreaterThanOrEqual(0.9);
    expect(output.weeklyVariance).toBeLessThanOrEqual(1.1);
  });

  it("applies the one-week context-switch penalty from the Stage 2 flag", () => {
    const clean = scenario().build();
    const penalised = structuredClone(clean);
    const lab = penalised.labs[penalised.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    (lab.flags as Record<string, string | number | boolean>)[
      CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG
    ] = penalised.run.tick;
    const cleanOutput = calculateDomainOutput(
      clean,
      content,
      clean.run.playerLabId,
      architectures,
    );
    const penalisedOutput = calculateDomainOutput(
      penalised,
      content,
      penalised.run.playerLabId,
      architectures,
    );
    expect(penalisedOutput.contextSwitchMultiplier).toBe(0.95);
    expect(penalisedOutput.finalResearchPoints).toBeCloseTo(
      cleanOutput.finalResearchPoints * 0.95,
      12,
    );
  });
});

describe("research commands and weekly progression", () => {
  it("offers a deterministic choice at level 20, records the command, effect, and score", () => {
    // A 10,000-GPU fleet keeps weekly output high enough to cross the level
    // threshold in one tick, as this fixture assumes.
    const state = structuredClone(
      scenario()
        .withPlayerLab((lab) => lab.gpus("gpu.kepler", 10_000))
        .build(),
    );
    const lab = state.labs[state.run.playerLabId];
    const domain = lab?.research.domains[architectures];
    if (lab === undefined || domain === undefined)
      throw new Error("research state missing");
    const mutableDomain = domain as unknown as {
      level: number;
      levelProgressRp: number;
      totalResearchPoints: number;
      weeklyMomentum: number;
    };
    mutableDomain.level = rating(19);
    mutableDomain.levelProgressRp = 49;

    const advanced = advanceOneTick(state, content);
    expect(advanced.autoPauseReasons).toContain("research-direction");
    const pending = advanced.state.labs[
      state.run.playerLabId
    ]?.research.pendingGenericAdvances.find(
      (candidate) => candidate.programId === architectures && candidate.threshold === 20,
    );
    expect(pending?.optionIds).toHaveLength(2);
    const optionId = pending?.optionIds[0];
    if (optionId === undefined) throw new Error("advance option missing");
    const selected = applyCommand(advanced.state, content, {
      kind: "choose-generic-advance",
      meta: {
        commandId: "command:generic-advance" as CommandId,
        expectedTick: advanced.state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      programId: architectures,
      threshold: 20,
      optionId,
    });
    const selectedLab = selected.state.labs[state.run.playerLabId];
    expect(selectedLab?.research.pendingGenericAdvances).not.toContainEqual(pending);
    expect(selectedLab?.research.genericAdvances[architectures]).toEqual([optionId]);
    expect(Object.values(selected.state.modifiers)).toContainEqual(
      expect.objectContaining({ source: { kind: "system", id: optionId } }),
    );
    expect(selected.state.score.entries).toContainEqual(
      expect.objectContaining({
        key: `research/generic/${architectures}/20`,
        amount: 200,
        categoryId: "score.scientific-legacy",
      }),
    );
    const beforeArchitecture = calculateDomainOutput(
      advanced.state,
      content,
      state.run.playerLabId,
      architectures,
    );
    const afterArchitecture = calculateDomainOutput(
      selected.state,
      content,
      state.run.playerLabId,
      architectures,
    );
    const otherProgramme = contentId("base:domain.optimisation-scaling");
    const beforeOther = calculateDomainOutput(
      advanced.state,
      content,
      state.run.playerLabId,
      otherProgramme,
    );
    const afterOther = calculateDomainOutput(
      selected.state,
      content,
      state.run.playerLabId,
      otherProgramme,
    );
    expect(afterArchitecture.outputModifier).toBeCloseTo(
      beforeArchitecture.outputModifier * 1.1395,
      12,
    );
    expect(afterOther.outputModifier).toBeCloseTo(beforeOther.outputModifier, 12);
    expect(selected.audit.commandId).toBe("command:generic-advance");
  });

  it("awards the content-defined first-time score at domain level 50", () => {
    const state = structuredClone(scenario().build());
    const domain = state.labs[state.run.playerLabId]?.research.domains[architectures];
    if (domain === undefined) throw new Error("research state missing");
    const mutableDomain = domain as unknown as { level: number; levelProgressRp: number };
    mutableDomain.level = rating(49);
    // Sit just short of the level-50 threshold, derived from content: the
    // cost curve compounds with level, so a hardcoded figure silently stops
    // reaching the milestone whenever the curve is retuned.
    mutableDomain.levelProgressRp =
      researchPointsForNextLevel(content, architectures, 49) - 0.5;

    const advanced = advanceOneTick(state, content).state;
    expect(advanced.score.entries).toContainEqual(
      expect.objectContaining({
        key: `research/domain-level/${architectures}/50`,
        amount: 250,
        categoryId: "score.scientific-legacy",
      }),
    );
  });
});
