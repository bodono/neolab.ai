import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { compactWindowWeeks } from "../../researchers/compacts.ts";
import { researcherCommitmentTargets } from "../../researchers/commitments.ts";
import { projectPeopleAbilityView, projectPeopleView } from "../people-view.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.sam-altmann"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

describe("projectPeopleView", () => {
  it("keeps researcher effect scopes distinct and explains stacking", () => {
    for (const definition of Object.values(content.researchers.definitions)) {
      for (const ability of [definition.signature, definition.passive]) {
        const projected = projectPeopleAbilityView(ability);
        const labels = projected.effects.map((effect) => effect.displayLabel);
        expect(new Set(labels).size, definition.displayName).toBe(labels.length);
        for (const effect of projected.effects) {
          expect(effect.explanation).not.toHaveLength(0);
        }
        for (const mode of projected.modes) {
          const modeLabels = mode.effects.map((effect) => effect.displayLabel);
          expect(
            new Set(modeLabels).size,
            `${definition.displayName} · ${mode.label}`,
          ).toBe(modeLabels.length);
        }
      }
    }

    const geoff = content.researchers.definitions["base:researcher.geoff-deen"]?.passive;
    const ian =
      content.researchers.definitions["base:researcher.ian-goodfriend"]?.signature;
    const ianPassive =
      content.researchers.definitions["base:researcher.ian-goodfriend"]?.passive;
    if (geoff === undefined || ian === undefined || ianPassive === undefined)
      throw new Error("catalogue fixture missing");
    expect(
      projectPeopleAbilityView(geoff).effects.map((effect) => effect.displayLabel),
    ).toEqual(["Owned-GPU power cost −10%"]);
    expect(
      projectPeopleAbilityView(ian).effects.map((effect) => effect.displayLabel),
    ).toEqual([
      "Multimodality domain research output +5%",
      "Security Containment safety programme research output +5%",
    ]);
    expect(
      projectPeopleAbilityView(ianPassive).effects.map((effect) => effect.displayLabel),
    ).toEqual(["Incident risk −8%"]);
  });

  it("projects fixed listed terms without hidden acceptance probabilities", () => {
    const state = newState();
    const view = projectPeopleView(state, content, state.run.playerLabId);
    expect(view.slots).toMatchObject({ occupied: 0, unlocked: 3, vacant: 3 });
    expect(view.market.candidates).toHaveLength(6);
    expect(view.assignmentOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "capability-program",
          role: "lead",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest types stringMatching as any
          label: expect.stringMatching(/^Lead · /),
        }),
      ]),
    );
    // Leading a research area is the only assignment: no advisor seats, no
    // institutional councils, and no postings that appear and vanish with
    // whichever project happens to be in flight.
    expect(
      view.assignmentOptions.every(
        (option) =>
          option.role === "lead" &&
          (option.kind === "capability-program" || option.kind === "safety-program"),
      ),
    ).toBe(true);
    const listedTerms = view.market.candidates[0]?.listedTerms;
    expect(listedTerms).toBeDefined();
    if (listedTerms === undefined) throw new Error("Listed terms missing");
    expect(typeof listedTerms.salaryMillionsPerCycle).toBe("number");
    expect(typeof listedTerms.signingCashMillions).toBe("number");
    expect(typeof listedTerms.auraCost).toBe("number");
    expect(listedTerms.blockers).toEqual([]);
    for (const candidate of view.market.candidates) {
      const definition = content.researchers.definitions[candidate.definitionId];
      expect(definition).toBeDefined();
      expect(candidate.researchSkills).toHaveLength(10);
      for (const skill of candidate.researchSkills) {
        expect(skill.level).toBe(definition?.skills[skill.skillKey] ?? 0);
        expect(skill.leadOutputBonusPercent).toBe(skill.level * 3);
      }
    }
    expect(JSON.stringify(view)).not.toMatch(
      /acceptanceProbability|candidateThreshold|cashVarianceDraw|\"draw\"/,
    );
  });

  it("projects the real-world inspiration and optional sourced summary", () => {
    const state = newState();
    const initial = projectPeopleView(state, content, state.run.playerLabId);
    const candidate = initial.market.candidates[0];
    if (candidate === undefined) throw new Error("talent-market fixture missing");

    const definition = content.researchers.definitions[candidate.definitionId];
    if (definition === undefined) throw new Error("researcher definition missing");
    const stagedDefinition = {
      ...definition,
      inspirationSummary:
        "A sourced account of the real researcher’s professional contribution.",
    };
    const stagedContent: CompiledContent = {
      ...content,
      researchers: {
        ...content.researchers,
        definitions: {
          ...content.researchers.definitions,
          [candidate.definitionId]: stagedDefinition,
        },
      },
    };

    const projected = projectPeopleView(
      state,
      stagedContent,
      state.run.playerLabId,
    ).market.candidates.find((person) => person.definitionId === candidate.definitionId);

    expect(projected).toMatchObject({
      inspirationName: stagedDefinition.inspirationName,
      inspirationSummary: stagedDefinition.inspirationSummary,
    });
  });

  it("projects roster assignments, conditions, warnings, and dismissal costs", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const researcher = Object.values(state.researchers).find(
      (candidate) => candidate.definitionId === "base:researcher.andrew-n-gee",
    );
    const researcherId = researcher?.id;
    const definition =
      researcher === undefined
        ? undefined
        : content.researchers.definitions[researcher.definitionId];
    if (
      lab === undefined ||
      researcherId === undefined ||
      researcher === undefined ||
      definition === undefined
    ) {
      throw new Error("people view fixture missing");
    }
    researcher.employerLabId = state.run.playerLabId;
    researcher.employedAt = state.run.tick;
    researcher.status = "employed";
    researcher.housing = "unhoused";
    researcher.unhousedSince = state.run.tick;
    researcher.assignment = {
      kind: "capability-program",
      targetId: contentId("base:domain.architectures"),
      role: "lead",
      assignedAt: state.run.tick,
    };
    researcher.contract = {
      salaryPerCycle: cashMillions(1),
      signingCash: cashMillions(6),
      auraCost: 8,
      agreedAt: state.run.tick,
    };
    researcher.compact = {
      includedInOffer: true,
      status: "warning",
      windowStartedAt: state.run.tick,
      warnedAt: state.run.tick,
    };
    const rivalLab = Object.values(state.labs).find((candidate) => {
      return candidate.control === "rival";
    });
    if (rivalLab === undefined) throw new Error("rival lab fixture missing");
    researcher.poaching = {
      id: "run:people:test-poaching",
      rivalLabId: rivalLab.id,
      stage: "counteroffer",
      signalledAt: state.run.tick,
      counterofferAt: state.run.tick,
      resolvesAt: tick(state.run.tick + 3),
      rivalOfferStrength: 60,
      playerRetentionStrength: 0,
    };
    lab.roster.researcherIds.push(researcherId);

    const person = projectPeopleView(state, content, state.run.playerLabId).roster[0];
    expect(person).toMatchObject({
      researcherId,
      housing: "unhoused",
      assignment: { role: "lead" },
      compactStatus: "warning",
      compactReview: {
        includedInOffer: true,
        reviewInWeeks: compactWindowWeeks(content, definition.compact.check),
      },
      contract: { salaryMillionsPerCycle: 1 },
      rivalApproach: {
        stage: "counteroffer",
        rivalLabName: content.labs[rivalLab.definitionId]?.displayName,
        resolvesInWeeks: 3,
        retentionResponseKind: "none",
        retentionResponseLabel: "No retention offer submitted",
      },
      dismissal: { severanceCashMillions: 2, auraLoss: 3 },
    });
    if (person === undefined) throw new Error("person missing");
    // The departure ledger: unhoused + compact warning + an active rival
    // approach all feed the pressure, so this researcher cannot be Settled,
    // and the top factors name what is driving it.
    expect(person.departure.label).not.toBe("Settled");
    expect(person.departure.topFactors).toContain("unhoused");
    // transferFraction mirrored: 0.6 - security/250 - loyalty/500, clamped.
    const security = lab.safety.securityPosture;
    expect(person.knowledgeTransferPercent).toBe(
      Math.round(
        Math.min(0.6, Math.max(0.2, 0.6 - security / 250 - researcher.loyalty / 500)) *
          100,
      ),
    );
    expect(person?.assignment?.label).toContain("Lead");
    expect(person?.warnings).toEqual(
      expect.arrayContaining(["Unhoused · reduced effectiveness", "Promise due soon"]),
    );

    researcher.poaching.playerRetentionStrength = 13;
    expect(
      projectPeopleView(state, content, state.run.playerLabId).roster[0]?.rivalApproach,
    ).toMatchObject({
      retentionResponseKind: "serious",
      retentionResponseLabel: "Serious retention package recorded",
    });
  });

  it("turns a research compact into one actionable binary promise", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const researcher = Object.values(state.researchers).find(
      (candidate) => candidate.definitionId === "base:researcher.geoff-deen",
    );
    if (lab === undefined || researcher === undefined) {
      throw new Error("Geoff compact fixture missing");
    }
    researcher.employerLabId = state.run.playerLabId;
    researcher.employedAt = state.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.compact = {
      includedInOffer: true,
      status: "tracking",
      windowStartedAt: state.run.tick,
    };
    lab.roster.researcherIds.push(researcher.id);

    const person = projectPeopleView(state, content, state.run.playerLabId).roster[0];
    expect(person?.compact.requirement).toBe(
      "Complete Data Centre I within 26 weeks of hiring.",
    );
    expect(person?.compactReview).toMatchObject({
      reviewInWeeks: 26,
      condition: {
        progress: "Data Centre I not completed yet",
        satisfied: false,
        actionLabel: "Open facilities",
        destination: "lab",
      },
      fulfilmentReward: "+3 morale when completed",
    });
  });

  it("gives Andrew N. Gee one real, queueable promise action", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    const researcher = Object.values(state.researchers).find(
      (candidate) => candidate.definitionId === "base:researcher.andrew-n-gee",
    );
    const definition =
      researcher === undefined
        ? undefined
        : content.researchers.definitions[researcher.definitionId];
    if (lab === undefined || researcher === undefined || definition === undefined) {
      throw new Error("Andrew compact fixture missing");
    }
    researcher.employerLabId = state.run.playerLabId;
    researcher.employedAt = state.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    researcher.compact = {
      includedInOffer: true,
      status: "tracking",
      windowStartedAt: state.run.tick,
    };
    lab.roster.researcherIds.push(researcher.id);

    const person = projectPeopleView(state, content, state.run.playerLabId).roster[0];
    const expectedCashCost = definition.contract.baseSalaryPerCycle;
    expect(person?.compact.requirement).toBe(
      "Complete one internal machine-learning course every 52 weeks.",
    );
    expect(person?.compactReview).toMatchObject({
      reviewInWeeks: 52,
      condition: {
        progress: "Not yet completed",
        satisfied: false,
      },
      promiseWork: {
        title: "Complete Internal Course",
        expectedDurationWeeks: 4,
        cashCostMillions: expectedCashCost,
        status: "available",
        actionTags: ["internal-course"],
        blockers: [],
      },
    });
    expect(person?.compactReview.promiseWork?.summary).toContain(
      "Complete one internal machine-learning course",
    );
    expect(person?.compactReview.promiseWork?.summary).toContain(
      "final 12 weeks before its deadline",
    );
    expect(person?.compactReview.condition?.explanation).toBe(
      "Completion is recorded automatically when this promise project finishes.",
    );
  });

  it("makes every catalogue promise understandable and actionable", () => {
    const state = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.roster.researcherIds = [];
    lab.finance.cash = cashMillions(1_000);

    for (const researcher of Object.values(state.researchers)) {
      researcher.employerLabId = state.run.playerLabId;
      researcher.employedAt = state.run.tick;
      researcher.status = "employed";
      researcher.housing = "housed";
      delete researcher.assignment;
      researcher.compact = {
        includedInOffer: true,
        status: "tracking",
        windowStartedAt: state.run.tick,
      };
      lab.roster.researcherIds.push(researcher.id);
    }

    const view = projectPeopleView(state, content, state.run.playerLabId);
    expect(view.roster).toHaveLength(content.researchers.orderedIds.length);
    let recurringPromiseWorkCount = 0;
    let nonPeriodicPromiseWorkCount = 0;
    for (const person of view.roster) {
      const definition = content.researchers.definitions[person.definitionId];
      if (definition === undefined) {
        throw new Error(`Missing definition ${person.definitionId}`);
      }
      expect(person.compact.requirement, definition.displayName).not.toHaveLength(0);
      const condition = person.compactReview.condition;
      expect(condition, definition.displayName).toBeDefined();
      if (condition === undefined) continue;
      expect(condition.progress, definition.displayName).not.toHaveLength(0);
      expect(condition.explanation, definition.displayName).not.toHaveLength(0);
      if (condition.destination !== undefined) {
        expect(condition.actionLabel, definition.displayName).not.toHaveLength(0);
      }

      const targets = researcherCommitmentTargets(definition.compact.check);
      const abstractTargetCount =
        targets.actionTags.length +
        targets.projectTags.length +
        targets.reviewTags.length +
        targets.requiredFlags.length;
      expect(abstractTargetCount, definition.displayName).toBeLessThanOrEqual(1);
      const hasAbstractWork = abstractTargetCount > 0;
      if (hasAbstractWork) {
        const isRecurringPromiseWork = definition.compact.cadence === "rolling";
        const researcher = Object.values(state.researchers).find(
          (candidate) => candidate.id === person.researcherId,
        );
        if (researcher === undefined) {
          throw new Error(`Missing researcher ${person.researcherId}`);
        }
        const salaryCycles = isRecurringPromiseWork ? 1 : 0.25;
        const expectedCashCost =
          Math.round(
            Number(
              researcher.contract?.salaryPerCycle ??
                definition.contract.baseSalaryPerCycle,
            ) *
              salaryCycles *
              100,
          ) / 100;
        if (isRecurringPromiseWork) {
          recurringPromiseWorkCount += 1;
          expect(
            compactWindowWeeks(content, definition.compact.check),
            definition.displayName,
          ).toBe(52);
          expect(definition.compact.requirement, definition.displayName).toContain(
            "52 weeks",
          );
        } else {
          nonPeriodicPromiseWorkCount += 1;
        }
        expect(person.compactReview.promiseWork, definition.displayName).toMatchObject({
          expectedDurationWeeks: isRecurringPromiseWork ? 4 : 2,
          cashCostMillions: expectedCashCost,
          status: "available",
        });
        expect(
          person.compactReview.promiseWork?.blockers.every(
            (blocker) =>
              blocker === "Assign this researcher to the relevant programme first" ||
              blocker ===
                "This promise activates when its stated model threshold is reached",
          ),
          definition.displayName,
        ).toBe(true);
      } else {
        expect(person.compactReview.promiseWork?.status, definition.displayName).toBe(
          "not-applicable",
        );
        expect(
          person.compactReview.condition?.destination,
          definition.displayName,
        ).toBeDefined();
      }
    }
    expect(recurringPromiseWorkCount).toBe(101);
    expect(nonPeriodicPromiseWorkCount).toBe(3);
  });
});
