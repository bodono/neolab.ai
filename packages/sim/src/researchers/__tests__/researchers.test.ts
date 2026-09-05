import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { resolveResearcherStack } from "../../engine/modifier-resolver.ts";
import { createTransaction } from "../../engine/transaction.ts";
import type { CommandId, ModifierId, ResearcherId } from "../../model/ids.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import {
  calendarFromTick,
  type GameState,
  type ResearcherAssignmentState,
} from "../../model/state.ts";
import { basisPoints, cashMillions, rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { setModelDeploymentPolicy } from "../../productisation/productisation.ts";
import { choosePublicationPolicy } from "../../research/papers.ts";
import { calculateDomainOutput } from "../../research/research.ts";
import { assignResearcher, quoteResearcherAssignment } from "../assignments.ts";
import {
  evaluateResearcherCompactCheck,
  evaluateResearcherCompacts,
  recordResearcherCompactActions,
} from "../compacts.ts";
import { quoteResearcherCommitment } from "../commitments.ts";
import { calculateDeparturePressure } from "../people.ts";
import {
  programmeModifierTarget,
  quoteResearcherContribution,
  syncResearcherAbilityModifiers,
} from "../researchers.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);
const architectures = contentId("base:domain.architectures");
const hintoff = contentId("base:researcher.geoffrey-hintoff") as unknown as ResearcherId;
const benji = contentId("base:researcher.joshua-benji") as unknown as ResearcherId;
const lemon = contentId("base:researcher.ian-lemon") as unknown as ResearcherId;
const sterling = contentId("base:researcher.david-sterling") as unknown as ResearcherId;
const gee = contentId("base:researcher.andrew-n-gee") as unknown as ResearcherId;
const ash = contentId("base:researcher.ash-vashwani") as unknown as ResearcherId;
const noam = contentId("base:researcher.noam-shazer") as unknown as ResearcherId;
const jurgen = contentId("base:researcher.jurgen-smithhuber") as unknown as ResearcherId;
const paul = contentId("base:researcher.paul-christiani") as unknown as ResearcherId;
const sutton = contentId("base:researcher.rick-sutton") as unknown as ResearcherId;
const simonian = contentId("base:researcher.karen-simonian") as unknown as ResearcherId;
const levinsky = contentId("base:researcher.sergei-levinsky") as unknown as ResearcherId;
const kingman = contentId("base:researcher.diederik-kingman") as unknown as ResearcherId;
const reinforcementAgency = contentId("base:domain.reinforcement-agency");
const roboticsEmbodiment = contentId("base:domain.robotics-embodiment");
const optimisationScaling = contentId("base:domain.optimisation-scaling");

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

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function requireDraftResearcher(
  state: DeepMutable<GameState>,
  researcherId: ResearcherId,
) {
  const researcher = state.researchers[researcherId];
  if (researcher === undefined) throw new Error(`missing ${researcherId}`);
  return researcher;
}

function requireDraftLab(state: DeepMutable<GameState>) {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  return lab;
}

function setTick(state: DeepMutable<GameState>, value: number): void {
  state.run.tick = tick(value);
  state.run.calendar = calendarFromTick(value);
}

function employ(
  state: DeepMutable<GameState>,
  researcherId: ResearcherId,
  assignment: ResearcherAssignmentState,
  compactIncluded = false,
): void {
  const researcher = state.researchers[researcherId];
  const lab = state.labs[state.run.playerLabId];
  if (researcher === undefined || lab === undefined) throw new Error("fixture missing");
  researcher.employerLabId = state.run.playerLabId;
  researcher.employedAt = state.run.tick;
  researcher.status = "employed";
  researcher.housing = "housed";
  researcher.assignment = structuredClone(assignment);
  researcher.compact = {
    includedInOffer: compactIncluded,
    windowStartedAt: state.run.tick,
    status: compactIncluded ? "tracking" : "not-applicable",
  };
  lab.roster.researcherIds.push(researcherId);
  state.talentMarket.visibleResearcherIds =
    state.talentMarket.visibleResearcherIds.filter((id) => id !== researcherId);
}

function sync(state: GameState, researcherId: ResearcherId): GameState {
  const tx = createTransaction(state);
  syncResearcherAbilityModifiers(tx, content, researcherId);
  return tx.commit({ description: "sync researcher test" }).state;
}

describe("compiled researcher catalogue", () => {
  it("ships the released catalogue with complete review and presentation records", () => {
    // 119: the released catalogue, including the ten 2026 roster additions.
    expect(content.researchers.orderedIds).toHaveLength(119);
    for (const researcher of Object.values(content.researchers.definitions)) {
      expect(researcher.eventReactions).toHaveLength(3);
      expect(researcher.feedLines.length).toBeGreaterThanOrEqual(6);
      expect(researcher.sources.length).toBeGreaterThan(0);
      expect(researcher.biography.length).toBeGreaterThan(100);
      expect(researcher.portrait.brief.length).toBeGreaterThan(20);
      expect(researcher.portrait.altText.length).toBeGreaterThan(20);
      expect(researcher.review.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const researcher of Object.values(content.researchers.definitions)) {
      expect(
        researcher.signature.eligibleAssignments.every(
          (kind) => kind === "capability-program" || kind === "safety-program",
        ),
        researcher.displayName,
      ).toBe(true);
    }
    expect(Object.keys(newState().researchers)).toEqual(content.researchers.orderedIds);
  });

  it("ships the two fictionalized additions with one-route recurring promises", () => {
    expect(
      content.researchers.definitions["base:researcher.alec-broadford"],
    ).toMatchObject({
      displayName: "Alec Broadford",
      inspirationName: "Alec Radford",
      compact: {
        cadence: "rolling",
        requirement: "Complete one zero-shot transfer evaluation every 52 weeks.",
        check: {
          type: "tagged-action-within",
          tags: ["zero-shot-transfer-evaluation"],
          weeks: 52,
        },
      },
    });
    expect(
      content.researchers.definitions["base:researcher.koray-kavukoglu"],
    ).toMatchObject({
      displayName: "Koray Kavukoglu",
      inspirationName: "Koray Kavukcuoglu",
      compact: {
        cadence: "rolling",
        requirement: "Complete one production-readiness review every 52 weeks.",
        check: {
          type: "tagged-action-within",
          tags: ["production-readiness-review"],
          weeks: 52,
        },
      },
    });
  });

  it("marks only permanently completable commitments as one-time promises", () => {
    expect(
      Object.values(content.researchers.definitions)
        .filter((researcher) => researcher.compact.cadence === "one-time")
        .map((researcher) => researcher.id)
        .sort(),
    ).toEqual(
      [
        "base:researcher.ash-vashwani",
        "base:researcher.christopher-olin",
        "base:researcher.geoff-deen",
        "base:researcher.jon-jumper",
        "base:researcher.kelsey-finn",
        "base:researcher.peter-abell",
        "base:researcher.pushmeet-kohly",
        "base:researcher.sergei-levinsky",
        "base:researcher.stewart-russel",
      ].sort(),
    );
  });
});

describe("researcher contributions and abilities", () => {
  it("quotes the baseline lead bonus and the four-week signature ramp", () => {
    const base = mutable(newState());
    employ(base, hintoff, {
      kind: "capability-program",
      targetId: architectures,
      role: "lead",
      assignedAt: tick(0),
    });
    const hintoffState = requireDraftResearcher(base, hintoff);
    const assignment = hintoffState.assignment;
    if (assignment === undefined) throw new Error("assignment missing");
    const lead = quoteResearcherContribution(base, content, hintoff, assignment);
    expect(lead.skillLevel).toBe(5);
    expect(lead.genericPercentagePoints).toBe(15);
    expect(lead.signatureRamp).toBe(0.25);

    // Hintoff's named Architecture signature is x1.04 at full strength, so
    // the four-week ramp lands a quarter of the four-point bonus each week.
    const expected = [1.01, 1.02, 1.03, 1.04];
    for (const [week, value] of expected.entries()) {
      const atWeek = mutable(base);
      setTick(atWeek, week);
      const synced = sync(atWeek, hintoff);
      const signature = Object.values(synced.modifiers).find(
        (modifier) =>
          modifier.source.kind === "researcher" &&
          modifier.target === programmeModifierTarget(architectures),
      );
      expect(signature?.value).toBeCloseTo(value, 10);
    }
  });

  it("combines generic and signature output without suppressing researcher stacking", () => {
    const draft = mutable(newState());
    employ(draft, hintoff, {
      kind: "capability-program",
      targetId: architectures,
      role: "lead",
      assignedAt: tick(0),
    });
    const state = sync(draft, hintoff);
    const output = calculateDomainOutput(
      state,
      content,
      state.run.playerLabId,
      architectures,
    );
    expect(output.starResearcherContributions[0]?.genericPercentagePoints).toBe(15);
    expect(output.starResearcherMultiplier).toBeCloseTo(1.15 * 1.01, 10);

    const stacked = mutable(state);
    const target = programmeModifierTarget(architectures);
    for (const [id, modifier] of Object.entries(stacked.modifiers)) {
      if (modifier.source.kind === "researcher" && modifier.target === target) {
        delete stacked.modifiers[id as ModifierId];
      }
    }
    for (const [index, value] of [1.5, 1.5].entries()) {
      const id = `researcher-modifier:test/${String(index)}` as ModifierId;
      stacked.modifiers[id] = {
        id,
        source: { kind: "researcher", id: `test/${String(index)}` },
        labId: state.run.playerLabId,
        target,
        operation: "multiply",
        value,
        startsAt: stacked.run.tick,
        tags: [],
      };
    }
    const stack = resolveResearcherStack(stacked, target, 1);
    expect(stack.final).toBeCloseTo(2.25, 10);
  });

  it("keeps a named signature active across an unrelated programme assignment", () => {
    const draft = mutable(newState());
    employ(draft, hintoff, {
      kind: "safety-program",
      targetId: contentId("base:safety.alignment-control"),
      role: "lead",
      assignedAt: tick(0),
    });
    const state = sync(draft, hintoff);
    const architectureSignature = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.source.kind === "researcher" &&
        modifier.target === programmeModifierTarget(architectures),
    );
    expect(architectureSignature).toBeDefined();
    expect(architectureSignature?.value).toBeGreaterThan(1);
  });

  it("keeps multi-area signatures active without an institutional assignment", () => {
    const draft = mutable(newState());
    employ(draft, benji, {
      kind: "capability-program",
      targetId: contentId("base:domain.reasoning-tools"),
      role: "lead",
      assignedAt: tick(0),
    });
    const state = sync(draft, benji);
    const reasoning = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target ===
          programmeModifierTarget(contentId("base:domain.reasoning-tools")) &&
        modifier.source.kind === "researcher",
    );
    const alignment = Object.values(state.modifiers).find(
      (modifier) =>
        modifier.target ===
          programmeModifierTarget(contentId("base:safety.alignment-control")) &&
        modifier.source.kind === "researcher",
    );
    expect(reasoning?.value).toBeCloseTo(1.01, 10);
    expect(alignment?.value).toBeCloseTo(1.01, 10);
  });

  it("allows only one lead for each programme", () => {
    const draft = mutable(newState());
    employ(draft, hintoff, {
      kind: "capability-program",
      targetId: architectures,
      role: "lead",
      assignedAt: tick(0),
    });
    employ(draft, benji, {
      kind: "safety-program",
      targetId: contentId("base:safety.alignment-control"),
      role: "lead",
      assignedAt: tick(0),
    });
    employ(draft, lemon, {
      kind: "capability-program",
      targetId: reinforcementAgency,
      role: "lead",
      assignedAt: tick(0),
    });

    expect(
      quoteResearcherAssignment(draft, content, draft.run.playerLabId, benji, {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
      }).blockers,
    ).toContain("That assignment already has a lead");
    expect(
      quoteResearcherAssignment(draft, content, draft.run.playerLabId, lemon, {
        kind: "safety-program",
        targetId: contentId("base:safety.alignment-control"),
        role: "lead",
      }).blockers,
    ).toContain("That assignment already has a lead");
  });

  it("halves ability and generic strength while a researcher is unhoused", () => {
    const draft = mutable(newState());
    employ(draft, hintoff, {
      kind: "capability-program",
      targetId: architectures,
      role: "lead",
      assignedAt: tick(0),
    });
    const hintoffState = requireDraftResearcher(draft, hintoff);
    hintoffState.housing = "unhoused";
    hintoffState.unhousedSince = tick(0);
    if (hintoffState.assignment === undefined) throw new Error("assignment missing");
    const contribution = quoteResearcherContribution(
      draft,
      content,
      hintoff,
      hintoffState.assignment,
    );
    expect(contribution.genericPercentagePoints).toBe(7.5);
    const state = sync(draft, hintoff);
    const signature = Object.values(state.modifiers).find(
      (modifier) => modifier.target === programmeModifierTarget(architectures),
    );
    expect(signature?.value).toBeCloseTo(1.005, 10);
  });
});

describe("compact rolling windows", () => {
  it("offers one promise action only when its stated assignment is active", () => {
    const draft = mutable(newState());
    employ(
      draft,
      simonian,
      {
        kind: "capability-program",
        targetId: reinforcementAgency,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const definition =
      content.researchers.definitions[
        requireDraftResearcher(draft, simonian).definitionId
      ];
    if (definition === undefined) throw new Error("researcher definition missing");
    expect(
      evaluateResearcherCompactCheck(draft, content, simonian, definition.compact.check),
    ).toMatchObject({ satisfied: true, applicable: false });

    expect(
      quoteResearcherCommitment(draft, content, draft.run.playerLabId, simonian).blockers,
    ).toContain("Assign this researcher to the relevant programme first");

    requireDraftResearcher(draft, simonian).assignment = {
      kind: "capability-program",
      targetId: architectures,
      role: "lead",
      assignedAt: tick(0),
    };
    expect(
      evaluateResearcherCompactCheck(draft, content, simonian, definition.compact.check),
    ).toMatchObject({ satisfied: false, applicable: true });
    expect(
      quoteResearcherCommitment(draft, content, draft.run.playerLabId, simonian).blockers,
    ).not.toContain("Assign this researcher to the relevant programme first");
  });

  it("grants fulfilment rewards once per review window, not once per weekly check", () => {
    const draft = mutable(newState());
    employ(
      draft,
      gee,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const initialMorale = requireDraftResearcher(draft, gee).morale;
    const firstTx = createTransaction(draft);
    recordResearcherCompactActions(firstTx, content, draft.run.playerLabId, [
      "internal-course",
    ]);
    const first = firstTx.commit({ description: "promise first fulfilment" }).state;
    expect(first.researchers[gee]?.morale).toBe(initialMorale + 3);

    const repeatedTx = createTransaction(first);
    evaluateResearcherCompacts(repeatedTx, content);
    const repeated = repeatedTx.commit({
      description: "same promise weekly check",
    }).state;
    expect(repeated.researchers[gee]?.morale).toBe(initialMorale + 3);

    const prewarningDraft = mutable(repeated);
    setTick(prewarningDraft, 39);
    const prewarningTx = createTransaction(prewarningDraft);
    evaluateResearcherCompacts(prewarningTx, content);
    const prewarning = prewarningTx.commit({
      description: "promise not yet due",
    });
    expect(prewarning.state.researchers[gee]?.compact.status).toBe("fulfilled");
    expect(prewarning.domainEvents).not.toContainEqual(
      expect.objectContaining({ kind: "researcher-compact-warning" }),
    );

    const renewalDraft = mutable(prewarning.state);
    setTick(renewalDraft, 40);
    const warningTx = createTransaction(renewalDraft);
    evaluateResearcherCompacts(warningTx, content);
    const warningResult = warningTx.commit({ description: "promise renewal warning" });
    const warning = warningResult.state;
    expect(warning.researchers[gee]?.compact.status).toBe("warning");
    expect(warningResult.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "researcher-compact-warning",
        weeksRemaining: 12,
      }),
    );
    expect(
      quoteResearcherCommitment(warning, content, warning.run.playerLabId, gee).status,
    ).toBe("available");

    const renewedTx = createTransaction(warning);
    recordResearcherCompactActions(renewedTx, content, warning.run.playerLabId, [
      "internal-course",
    ]);
    const renewed = renewedTx.commit({ description: "promise renewed" }).state;
    expect(renewed.researchers[gee]?.morale).toBe(initialMorale + 6);
  });

  it("warns before still-valid rolling evidence expires, then clears on renewal", () => {
    const draft = mutable(newState());
    employ(
      draft,
      lemon,
      {
        kind: "capability-program",
        targetId: contentId("base:domain.multimodality"),
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    requireDraftLab(draft).flags["action:open-paper:lastAt"] = tick(0);
    setTick(draft, 22);
    const warningTx = createTransaction(draft);
    evaluateResearcherCompacts(warningTx, content);
    const warning = warningTx.commit({ description: "rolling evidence warning" });
    expect(warning.state.researchers[lemon]?.compact.status).toBe("warning");
    expect(warning.domainEvents).toContainEqual(
      expect.objectContaining({
        kind: "researcher-compact-warning",
        weeksRemaining: 4,
      }),
    );

    const renewalTx = createTransaction(warning.state);
    recordResearcherCompactActions(renewalTx, content, warning.state.run.playerLabId, [
      "open-paper",
    ]);
    const renewed = renewalTx.commit({ description: "rolling evidence renewed" });
    expect(renewed.state.researchers[lemon]?.compact.status).toBe("fulfilled");
    expect(renewed.state.researchers[lemon]?.compact.lastSatisfiedAt).toBe(22);
  });

  it("repairs a missed one-time facility promise when the building is completed late", () => {
    const draft = mutable(newState());
    employ(
      draft,
      levinsky,
      {
        kind: "capability-program",
        targetId: roboticsEmbodiment,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    setTick(draft, 26);
    const breachTx = createTransaction(draft);
    evaluateResearcherCompacts(breachTx, content);
    const breached = breachTx.commit({ description: "facility promise missed" }).state;
    const breachedResearcher = breached.researchers[levinsky];
    if (breachedResearcher === undefined) throw new Error("researcher fixture missing");
    expect(breachedResearcher.compact).toMatchObject({
      status: "breached",
      breachedAt: 26,
    });
    expect(calculateDeparturePressure(breached, levinsky).compact).toBe(15);
    const loyaltyAfterBreach = breachedResearcher.loyalty;
    const storedDeparturePressureAfterBreach = breachedResearcher.departurePressure;

    const lateDraft = mutable(breached);
    setTick(lateDraft, 30);
    requireDraftLab(lateDraft).facilities.instances.push({
      definitionId: contentId("base:facility.robotics-lab-1"),
      completedAt: tick(30),
      majorProjectSlotBonus: 0,
      modifierIds: [],
    });
    const moraleAfterBreach = requireDraftResearcher(lateDraft, levinsky).morale;
    const repairTx = createTransaction(lateDraft);
    evaluateResearcherCompacts(repairTx, content);
    const repaired = repairTx.commit({ description: "facility promise repaired" }).state;
    const repairedResearcher = repaired.researchers[levinsky];
    if (repairedResearcher === undefined) throw new Error("researcher fixture missing");
    expect(repairedResearcher.compact).toMatchObject({
      status: "fulfilled",
      breachedAt: 26,
      lastSatisfiedAt: 30,
    });
    expect(repairedResearcher.morale).toBe(moraleAfterBreach + 3);
    expect(repairedResearcher.loyalty).toBe(loyaltyAfterBreach);
    expect(repairedResearcher.departurePressure).toBe(storedDeparturePressureAfterBreach);
    expect(calculateDeparturePressure(repaired, levinsky).compact).toBe(0);

    const definition = content.researchers.definitions[repairedResearcher.definitionId];
    if (definition === undefined) throw new Error("researcher definition missing");
    expect(
      evaluateResearcherCompactCheck(
        repaired,
        content,
        levinsky,
        definition.compact.check,
      ),
    ).toMatchObject({
      satisfied: true,
      satisfiedAt: 30,
    });

    const repeatedTx = createTransaction(repaired);
    evaluateResearcherCompacts(repeatedTx, content);
    const repeated = repeatedTx.commit({
      description: "late facility remains fulfilled",
    }).state;
    expect(repeated.researchers[levinsky]?.morale).toBe(moraleAfterBreach + 3);
  });

  it("activates assignment promises from real programme assignments and expires their work", () => {
    const draft = mutable(newState());
    employ(
      draft,
      simonian,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const lab = requireDraftLab(draft);
    const definition =
      content.researchers.definitions[
        requireDraftResearcher(draft, simonian).definitionId
      ];
    if (definition === undefined) throw new Error("researcher definition missing");
    expect(
      evaluateResearcherCompactCheck(draft, content, simonian, definition.compact.check),
    ).toMatchObject({ satisfied: false, applicable: true });

    lab.flags["project-tag:cross-task-validation:lastAt"] = tick(0);
    expect(
      evaluateResearcherCompactCheck(draft, content, simonian, definition.compact.check),
    ).toMatchObject({ satisfied: true, satisfiedAt: 0 });
    setTick(draft, 51);
    expect(
      evaluateResearcherCompactCheck(draft, content, simonian, definition.compact.check),
    ).toMatchObject({ satisfied: true, satisfiedAt: 0 });
    setTick(draft, 52);
    expect(
      evaluateResearcherCompactCheck(draft, content, simonian, definition.compact.check),
    ).toMatchObject({ satisfied: false, applicable: true });
  });

  it("consumes one review per relevant publication and breaches immediately if absent", () => {
    const draft = mutable(newState());
    employ(
      draft,
      jurgen,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const lab = requireDraftLab(draft);
    lab.flags["review-tag:expanded-historical-note:lastAt"] = tick(0);
    const architecturePapers = Object.values(content.papers.definitions).filter((paper) =>
      paper.tags.includes("architectures"),
    );
    const firstPaper = architecturePapers[0];
    const secondPaper = architecturePapers[1];
    if (firstPaper === undefined || secondPaper === undefined) {
      throw new Error("architecture paper fixtures missing");
    }
    draft.world.paperRace.discoveries[firstPaper.id] = {
      paperId: firstPaper.id,
      discovererLabId: draft.run.playerLabId,
      discoveredAt: tick(0),
    };
    const firstTx = createTransaction(draft);
    choosePublicationPolicy(firstTx, content, firstPaper.id, "controlled-publication");
    const first = firstTx.commit({ description: "reviewed architecture paper" });
    expect(first.state.researchers[jurgen]?.compact.status).toBe("fulfilled");
    expect(
      first.state.labs[first.state.run.playerLabId]?.flags[
        "review-tag:expanded-historical-note:usedAt"
      ],
    ).toBe(0);

    const secondDraft = mutable(first.state);
    setTick(secondDraft, 1);
    secondDraft.world.paperRace.discoveries[secondPaper.id] = {
      paperId: secondPaper.id,
      discovererLabId: secondDraft.run.playerLabId,
      discoveredAt: tick(1),
    };
    const secondTx = createTransaction(secondDraft);
    choosePublicationPolicy(secondTx, content, secondPaper.id, "controlled-publication");
    const second = secondTx.commit({ description: "unreviewed architecture paper" });
    expect(second.state.researchers[jurgen]?.compact.status).toBe("breached");
    expect(second.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-compact-breached" }),
    );
  });

  it("fulfils Rick Sutton's single research-charter promise", () => {
    const draft = mutable(newState());
    employ(
      draft,
      sutton,
      {
        kind: "capability-program",
        targetId: reinforcementAgency,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const initialMorale = requireDraftResearcher(draft, sutton).morale;
    const tx = createTransaction(draft);
    recordResearcherCompactActions(tx, content, draft.run.playerLabId, [
      "open-research-charter",
    ]);
    const fulfilled = tx.commit({ description: "open research charter" }).state;
    expect(fulfilled.researchers[sutton]?.compact.status).toBe("fulfilled");
    expect(fulfilled.researchers[sutton]?.morale).toBe(initialMorale + 3);
  });

  it("calculates the academic-latitude publication ratio from real discoveries", () => {
    const draft = mutable(newState());
    employ(
      draft,
      hintoff,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const papers = Object.values(content.papers.definitions).slice(0, 3);
    const firstPaper = papers[0];
    if (firstPaper === undefined || papers.length < 3) {
      throw new Error("paper fixtures missing");
    }
    for (const [index, paper] of papers.entries()) {
      draft.world.paperRace.discoveries[paper.id] = {
        paperId: paper.id,
        discovererLabId: draft.run.playerLabId,
        discoveredAt: tick(index),
        ...(index === 0
          ? { publicationPolicy: "controlled-publication", policyChosenAt: tick(0) }
          : { publicationPolicy: "keep-secret", policyChosenAt: tick(index) }),
      };
    }
    const definition =
      content.researchers.definitions[
        requireDraftResearcher(draft, hintoff).definitionId
      ];
    if (definition === undefined) throw new Error("researcher definition missing");
    expect(
      evaluateResearcherCompactCheck(draft, content, hintoff, definition.compact.check),
    ).toMatchObject({ satisfied: true, evidence: "ratio=0.3333333333333333" });
    const first = draft.world.paperRace.discoveries[firstPaper.id];
    if (first === undefined) throw new Error("discovery fixture missing");
    first.publicationPolicy = "keep-secret";
    expect(
      evaluateResearcherCompactCheck(draft, content, hintoff, definition.compact.check),
    ).toMatchObject({ satisfied: false, evidence: "ratio=0" });
  });

  it("enforces Ash Vashwani's protected appointment and records its completion", () => {
    const draft = mutable(newState());
    employ(
      draft,
      ash,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    setTick(draft, 5);
    const definition =
      content.researchers.definitions[requireDraftResearcher(draft, ash).definitionId];
    if (definition === undefined) throw new Error("Ash definition missing");
    expect(
      evaluateResearcherCompactCheck(draft, content, ash, definition.compact.check),
    ).toMatchObject({
      satisfied: false,
      applicable: true,
      evidence: "protected appointment 5/13 weeks",
    });
    expect(
      quoteResearcherAssignment(draft, content, draft.run.playerLabId, ash, {
        kind: "capability-program",
        targetId: reinforcementAgency,
        role: "lead",
      }).blockers,
    ).toContain("Protected appointment: 8 weeks remain before a voluntary transfer");

    setTick(draft, 13);
    expect(
      evaluateResearcherCompactCheck(draft, content, ash, definition.compact.check),
    ).toMatchObject({
      satisfied: true,
      applicable: true,
      evidence: "protected appointment 13/13 weeks",
      satisfiedAt: 13,
    });
    const transferTx = createTransaction(draft);
    assignResearcher(transferTx, content, draft.run.playerLabId, ash, {
      kind: "capability-program",
      targetId: reinforcementAgency,
      role: "lead",
    });
    const transferred = transferTx.commit({ description: "protected focus completed" });
    expect(
      transferred.state.labs[transferred.state.run.playerLabId]?.flags[
        "assignment-duration:base:domain.architectures:at"
      ],
    ).toBe(13);
  });

  it("lets Andrew N. Gee complete Teach the Lab through visible promise work", () => {
    const draft = mutable(newState());
    const lab = requireDraftLab(draft);
    employ(
      draft,
      gee,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );

    const startingCash = Number(lab.finance.cash);
    const geeDefinition =
      content.researchers.definitions[requireDraftResearcher(draft, gee).definitionId];
    if (geeDefinition === undefined) {
      throw new Error("Andrew N. Gee definition missing");
    }
    const expectedCashCost = geeDefinition.contract.baseSalaryPerCycle;
    const started = applyCommand(draft, content, {
      kind: "start-researcher-commitment",
      meta: {
        commandId: "command:test:teach-the-lab" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: lab.id,
      researcherId: gee,
    }).state;
    expect(Number(started.labs[lab.id]?.finance.cash)).toBe(
      startingCash - expectedCashCost,
    );
    expect(
      Object.values(started.projects).find(
        (project) => project.kind === "researcher-commitment",
      ),
    ).toMatchObject({
      status: "active",
      expectedDurationWeeks: 4,
      payload: {
        kind: "researcher-commitment",
        researcherId: gee,
        cashCostMillions: expectedCashCost,
        actionTags: ["internal-course"],
      },
    });

    let running = started;
    for (let elapsed = 0; elapsed < 3; elapsed += 1) {
      running = advanceOneTick(running, content).state;
    }
    expect(running.researchers[gee]?.compact.status).not.toBe("fulfilled");

    const completed = advanceOneTick(running, content).state;
    expect(completed.researchers[gee]?.compact.status).toBe("fulfilled");
    expect(completed.labs[lab.id]?.flags["action:internal-course:lastAt"]).toBe(3);
  });

  it("gives Noam Shazer one visible annual expert-routing promise", () => {
    const draft = mutable(newState());
    employ(
      draft,
      noam,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );

    expect(
      content.researchers.definitions[requireDraftResearcher(draft, noam).definitionId]
        ?.compact,
    ).toMatchObject({
      cadence: "rolling",
      label: "Wake the Right Experts",
      requirement: "Complete one expert-routing and load-balancing audit every 52 weeks.",
      check: {
        type: "tagged-action-within",
        tags: ["expert-routing-audit"],
        weeks: 52,
      },
    });
    expect(
      quoteResearcherCommitment(draft, content, draft.run.playerLabId, noam),
    ).toMatchObject({
      title: "Complete Expert Routing Audit",
      expectedDurationWeeks: 4,
      cashCostMillions:
        content.researchers.definitions[requireDraftResearcher(draft, noam).definitionId]
          ?.contract.baseSalaryPerCycle,
      status: "available",
      blockers: [],
      actionTags: ["expert-routing-audit"],
    });
  });

  it("scales button-driven promise work with the researcher's current salary", () => {
    const draft = mutable(newState());
    const lab = requireDraftLab(draft);
    employ(
      draft,
      noam,
      {
        kind: "capability-program",
        targetId: architectures,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    requireDraftResearcher(draft, noam).contract = {
      salaryPerCycle: cashMillions(6),
      signingCash: cashMillions(0),
      auraCost: 0,
      agreedAt: draft.run.tick,
    };

    const quote = quoteResearcherCommitment(draft, content, draft.run.playerLabId, noam);
    expect(quote).toMatchObject({
      expectedDurationWeeks: 4,
      cashCostMillions: 6,
      status: "available",
    });

    const startingCash = Number(lab.finance.cash);
    const started = applyCommand(draft, content, {
      kind: "start-researcher-commitment",
      meta: {
        commandId: "command:test:salary-scaled-promise" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: lab.id,
      researcherId: noam,
    }).state;
    expect(Number(started.labs[lab.id]?.finance.cash)).toBe(startingCash - 6);
    expect(
      Object.values(started.projects).find(
        (project) => project.kind === "researcher-commitment",
      ),
    ).toMatchObject({
      payload: {
        kind: "researcher-commitment",
        researcherId: noam,
        cashCostMillions: 6,
      },
    });
  });

  it("holds The Conviction: an Autonomous Researcher model must be allowed to act", () => {
    // David Silver's compact rebuilt: once any model reaches Tier 5 (FC 65+),
    // it must run at Laboratory Operator access. Dormant below the tier,
    // breached while the lab keeps the model boxed, kept once access is
    // granted -- the promise pushes the player UP the RSI ladder.
    const draft = mutable(addBaselineModelsForTest(newState(), content));
    employ(
      draft,
      sterling,
      {
        kind: "capability-program",
        targetId: reinforcementAgency,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const check = {
      type: "conditional-metric-at-least",
      condition: { metric: "lab.model.maxActiveFC", value: 65 },
      metric: "lab.model.currentAccessLevel",
      value: 4,
    } as const;
    const lab = requireDraftLab(draft);
    const modelId = lab.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (model === undefined || model.measuredCapability === undefined) {
      throw new Error("model fixture missing");
    }

    // Below Tier 5 the condition is inactive: no demand, no breach.
    model.measuredCapability.frontierCapability = rating(50);
    expect(evaluateResearcherCompactCheck(draft, content, sterling, check)).toMatchObject(
      { satisfied: true, evidence: "condition is inactive" },
    );

    // Tier 5 with the model boxed: the promise is being broken.
    model.measuredCapability.frontierCapability = rating(70);
    model.accessLevel = 2;
    expect(
      evaluateResearcherCompactCheck(draft, content, sterling, check).satisfied,
    ).toBe(false);

    // Laboratory Operator access keeps it.
    model.accessLevel = 4;
    expect(
      evaluateResearcherCompactCheck(draft, content, sterling, check).satisfied,
    ).toBe(true);
  });

  it("keeps The Cadence while a run is live and starts the clock when it ends", () => {
    // Diederik Kingman's compact rebuilt: Experimental Breadth demanded an
    // allocation share the player only indirectly controls; the promise is now
    // a training cadence. A live run satisfies it continuously -- a 40-week
    // frontier run must never breach a 26-week promise mid-run -- and once the
    // lab goes idle the clock anchors on the last completed run.
    const draft = mutable(addBaselineModelsForTest(newState(), content));
    employ(
      draft,
      kingman,
      {
        kind: "capability-program",
        targetId: optimisationScaling,
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    expect(
      content.researchers.definitions[requireDraftResearcher(draft, kingman).definitionId]
        ?.compact,
    ).toMatchObject({
      label: "The Cadence",
      check: {
        type: "tagged-action-within",
        tags: ["training-run-underway"],
        weeks: 26,
      },
    });
    const check = {
      type: "tagged-action-within",
      tags: ["training-run-underway"],
      weeks: 26,
    } as const;

    // Idle with the last run finished twenty-four weeks ago: inside the window.
    setTick(draft, 24);
    expect(evaluateResearcherCompactCheck(draft, content, kingman, check)).toMatchObject({
      satisfied: true,
      evidence: "latest tagged action at 0",
    });

    // Idle for twenty-seven weeks: the promise is being broken.
    setTick(draft, 27);
    expect(evaluateResearcherCompactCheck(draft, content, kingman, check).satisfied).toBe(
      false,
    );

    // A live run satisfies it continuously, however stale the last completion.
    const lab = requireDraftLab(draft);
    if (lab.models.currentModelId === undefined) {
      throw new Error("model fixture missing");
    }
    const running = applyCommand(draft, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:test-cadence-run" as CommandId,
        expectedTick: draft.run.tick,
        issuedBy: "player",
      },
      labId: draft.run.playerLabId,
      parentModelId: lab.models.currentModelId,
      durationWeeks: 5,
      posture: "normal",
    }).state;
    expect(
      evaluateResearcherCompactCheck(running, content, kingman, check),
    ).toMatchObject({
      satisfied: true,
      evidence: "latest tagged action at 27",
    });
  });

  it("does not let an open model substitute for the promised open paper", () => {
    const draft = mutable(addBaselineModelsForTest(newState(), content));
    employ(
      draft,
      lemon,
      {
        kind: "capability-program",
        targetId: contentId("base:domain.multimodality"),
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    setTick(draft, 26);
    const breachTx = createTransaction(draft);
    evaluateResearcherCompacts(breachTx, content);
    const breached = breachTx.commit({ description: "model compact breach" }).state;
    const lab = breached.labs[breached.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    if (lab === undefined || modelId === undefined)
      throw new Error("model fixture missing");

    const launchTx = createTransaction(breached);
    setModelDeploymentPolicy(launchTx, content, lab.id, modelId, "open-api");
    const launched = launchTx.commit({ description: "open model" }).state;
    expect(launched.labs[lab.id]?.flags["action:open-model:lastAt"]).toBe(26);
    expect(launched.researchers[lemon]?.compact.status).toBe("breached");
    expect(launched.researchers[lemon]?.compact.lastSatisfiedAt).toBeUndefined();
  });

  it("checks the external-audit promise on the actual public model release", () => {
    const draft = mutable(addBaselineModelsForTest(newState(), content));
    employ(
      draft,
      paul,
      {
        kind: "safety-program",
        targetId: contentId("base:safety.alignment-control"),
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const lab = requireDraftLab(draft);
    const modelId = lab.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (modelId === undefined || model?.measuredCapability === undefined) {
      throw new Error("model fixture missing");
    }
    model.measuredCapability.frontierCapability = rating(60);
    const launchTx = createTransaction(draft);
    setModelDeploymentPolicy(launchTx, content, lab.id, modelId, "open-api");
    const launched = launchTx.commit({ description: "unaudited public release" });
    expect(launched.state.researchers[paul]?.compact.status).toBe("breached");
    expect(launched.state.labs[lab.id]?.flags["compact-violation:release-fc-60"]).toBe(
      true,
    );
    expect(launched.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-compact-breached" }),
    );
  });

  it("immediately fulfils Publication Freedom after an open paper", () => {
    const draft = mutable(newState());
    employ(
      draft,
      lemon,
      {
        kind: "capability-program",
        targetId: contentId("base:domain.multimodality"),
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    setTick(draft, 26);
    const breachTx = createTransaction(draft);
    evaluateResearcherCompacts(breachTx, content);
    const breached = breachTx.commit({ description: "publication compact breach" }).state;
    expect(breached.researchers[lemon]?.compact.status).toBe("breached");

    const publicationDraft = mutable(breached);
    const lab = requireDraftLab(publicationDraft);
    const paperId = content.papers.graph.realHistoryDisplayOrder[0];
    if (paperId === undefined) throw new Error("paper fixture missing");
    publicationDraft.world.paperRace.discoveries[paperId] = {
      paperId,
      discovererLabId: lab.id,
      discoveredAt: publicationDraft.run.tick,
    };
    lab.research.discoveredPaperIds.push(paperId);

    const publicationTx = createTransaction(publicationDraft);
    choosePublicationPolicy(publicationTx, content, paperId, "publish-openly");
    const published = publicationTx.commit({ description: "open paper" }).state;
    const researcher = published.researchers[lemon];
    if (researcher === undefined) {
      throw new Error("researcher fixture missing");
    }
    const definition = content.researchers.definitions[researcher.definitionId];
    if (definition === undefined) throw new Error("researcher definition missing");
    expect(published.labs[lab.id]?.flags["action:open-paper:lastAt"]).toBe(26);
    expect(researcher.compact.status).toBe("fulfilled");
    expect(researcher.compact.lastSatisfiedAt).toBe(26);
    expect(
      evaluateResearcherCompactCheck(published, content, lemon, definition.compact.check),
    ).toMatchObject({
      satisfied: true,
      satisfiedAt: 26,
      evidence: "latest tagged action at 26",
    });

    const preFixState = mutable(published);
    const preFixLab = requireDraftLab(preFixState);
    delete preFixLab.flags["action:open-paper:lastAt"];
    delete preFixLab.flags["action:open-paper:count"];
    expect(
      evaluateResearcherCompactCheck(
        preFixState,
        content,
        lemon,
        definition.compact.check,
      ),
    ).toMatchObject({
      satisfied: true,
      satisfiedAt: 26,
      evidence: "latest tagged action at 26",
    });
  });

  it("emits one warning and one breach hook with visible consequences", () => {
    const draft = mutable(addBaselineModelsForTest(newState(), content));
    employ(
      draft,
      benji,
      {
        kind: "safety-program",
        targetId: contentId("base:safety.alignment-control"),
        role: "lead",
        assignedAt: tick(0),
      },
      true,
    );
    const lab = requireDraftLab(draft);
    const currentModelId = lab.models.currentModelId;
    if (currentModelId === undefined) throw new Error("current model missing");
    const model = draft.models[currentModelId];
    if (model?.measuredCapability === undefined) throw new Error("estimate missing");
    model.measuredCapability.frontierCapability = rating(60);
    lab.compute.allocation.capabilityBasisPoints = basisPoints(8000);

    setTick(draft, 22);
    const warningTx = createTransaction(draft);
    evaluateResearcherCompacts(warningTx, content);
    const warning = warningTx.commit({ description: "compact warning" });
    expect(warning.state.researchers[benji]?.compact.status).toBe("warning");
    expect(warning.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-compact-warning" }),
    );
    expect(warning.state.decisionLog.at(-1)?.summary).toContain("due soon");

    const breachDraft = mutable(warning.state);
    setTick(breachDraft, 26);
    const breachTx = createTransaction(breachDraft);
    evaluateResearcherCompacts(breachTx, content);
    const breach = breachTx.commit({ description: "compact breach" });
    const researcher = breach.state.researchers[benji];
    expect(researcher?.compact.status).toBe("breached");
    expect(researcher?.morale).toBe(40);
    expect(researcher?.loyalty).toBe(40);
    expect(researcher?.departurePressure).toBe(15);
    expect(breach.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "researcher-compact-breached" }),
    );
    expect(breach.state.run.autoPauseReasons).not.toContain("resignation-ultimatum");

    const repeatedTx = createTransaction(breach.state);
    evaluateResearcherCompacts(repeatedTx, content);
    const repeated = repeatedTx.commit({ description: "compact no duplicate" });
    expect(repeated.domainEvents).toHaveLength(0);
    expect(repeated.state.decisionLog).toHaveLength(breach.state.decisionLog.length);
  });
});

describe("named research areas", () => {
  it("names an area for every programme effect, never a floating one", () => {
    // assignedProgramme/pairedProgramme FOLLOWED whatever the researcher led, so
    // 98 researchers rendered the same generic line AND stacked on the generic
    // lead bonus, which already pays up to +15% on that same programme. Every
    // effect now names the area it helps, whether or not the researcher leads it.
    const floating = Object.values(content.researchers.definitions).flatMap((d) =>
      [d.signature, d.passive]
        .flatMap((a) => a?.effects ?? [])
        .filter(
          (e) =>
            e.target === "assignedProgramme.researchOutput" ||
            e.target === "pairedProgramme.researchOutput",
        )
        .map(() => d.displayName),
    );
    expect(floating).toEqual([]);
  });

  it("keeps a two-area researcher's areas distinct and differently valued", () => {
    // Peter Abeter used two mutually-exclusive MODES: +10% if he led Robotics,
    // +6% if he led Reinforcement. A blanket value cap once flattened both to
    // the same number, which silently deleted the distinction between them.
    const abeter = Object.values(content.researchers.definitions).find(
      (d) => d.displayName === "Peter Abeter",
    );
    if (abeter === undefined) throw new Error("Peter Abeter missing");
    const areas = abeter.signature.effects.filter((e) =>
      e.target.endsWith(".researchOutput"),
    );
    expect(areas).toHaveLength(2);
    expect(new Set(areas.map((e) => e.target)).size).toBe(2);
    expect(new Set(areas.map((e) => e.value)).size).toBe(2);
  });
});

describe("always-on abilities without an assignment", () => {
  it("still produces live modifiers, on the researcher's strongest programme", () => {
    const state = mutable(newState());
    const researcher = Object.values(state.researchers).find(
      (candidate) =>
        content.researchers.definitions[candidate.definitionId]?.displayName ===
        "Ian Goodfriend",
    );
    if (researcher === undefined) throw new Error("fixture researcher missing");
    // Hired, housed, and deliberately NOT assigned to anything.
    researcher.employerLabId = state.run.playerLabId;
    researcher.employedAt = state.run.tick;
    researcher.status = "employed";
    researcher.housing = "housed";
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    lab.roster.researcherIds.push(researcher.id);
    const synced = sync(state, researcher.id);
    const produced = Object.values(synced.modifiers).filter(
      (modifier) => modifier.source.kind === "researcher",
    );
    // Signature and passive both fire; the signature resolves to a programme
    // target rather than being silently dropped for want of an assignment.
    expect(produced.length).toBeGreaterThan(1);
    const programmeTargets = produced
      .map((modifier) => modifier.target)
      .filter((target) => target.startsWith("lab.research.program."));
    expect(programmeTargets.length).toBeGreaterThan(0);
    // Paired resolves to a DIFFERENT programme than the primary.
    expect(new Set(programmeTargets).size).toBe(programmeTargets.length);
  });
});
