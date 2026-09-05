import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CrisisConfirmationState, GameState } from "../../model/state.ts";
import { fraction, rating, tick } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { projectPostRunAudit } from "../post-run-audit.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function terminalCandidateState(): DeepMutable<GameState> {
  const state = structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("abcdefabcdefabcdefabcdefabcdefab"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("fixture incomplete");

  state.run.tick = tick(140);
  state.run.status = "won";
  state.run.phase = "crisis";
  state.run.endingId = contentId("base:ending.false-dawn");
  model.trueCapability = {
    language: rating(91),
    reasoning: rating(92),
    agency: rating(89),
    toolUse: rating(90),
    multimodality: rating(88),
    scientificAbility: rating(94),
    embodiment: rating(87),
  };
  model.measuredCapability = {
    values: structuredClone(model.trueCapability),
    frontierCapability: rating(92),
    confidence: "high",
    evidenceFlags: [],
  };
  model.candidateArtifact = {
    modelId: model.id,
    lineageId: model.lineageId,
    lifecycle: "verified-isolated-archive",
    candidateBasis: {
      kind: "direct-qualification",
      qualifiedAt: tick(104),
      qualificationFrontierCapability: rating(92),
      qualificationCapability: structuredClone(model.trueCapability),
    },
    trainingExposure: 18,
    hazardPressure: 42,
    incidentThresholdKey: "candidate-hazard/test",
    incidentThreshold: 70,
    incidentThresholdDraw: fraction(0.7),
    incidentEpoch: 0,
    containmentLoad: 3.5,
    maximumAccessEver: 3,
    cumulativeAutonomousWeeks: 4,
    networkExposureWeeks: 2,
    servingExposureWeeks: 0,
    unresolvedAnomalyBurden: 12,
    retirementAttemptCount: 1,
    benignFalseAlarmClasses: [],
    incidentHistory: [
      {
        id: `candidate-incident:${model.id}:0`,
        epoch: 0,
        incidentClass: "suspicious-signal",
        kind: "benign-false-alarm",
        triggeredAt: tick(110),
        resolvedAt: tick(112),
        origin: "weekly-pressure",
        priorLifecycle: "formal-candidate",
        reviewOutcome: "benign-operational-cause",
      },
    ],
    archiveDisposition: "full-archive",
    retirementVerification: "verified",
  };
  state.lineageSIRecords[model.lineageId] = {
    lineageId: model.lineageId,
    superintelligenceTruth: "not-genuine",
    probabilityAtFirstCrossing: fraction(0.325),
    randomKey: "lineage-si/privileged-test-key",
    draw: fraction(0.73),
    firstQualifyingModelId: model.id,
    firstQualifyingFrontierCapability: rating(92),
    firstQualifyingWeek: tick(104),
    rulesVersion: state.engineRulesVersion,
  };
  state.endgameHistory.relationshipPracticeLedger.push({
    tick: tick(132),
    modelId: model.id,
    kind: "archive",
    detail: "The full archive entered independent custody verification.",
    valence: -2,
  });
  state.endgameHistory.candidateRetirementHistory.push({
    modelId: model.id,
    lineageId: model.lineageId,
    attemptNumber: 1,
    procedureId: "staged-isolated-shutdown",
    archiveDisposition: "full-archive",
    transmittedAt: tick(130),
    contested: true,
    status: "verified",
    resolvedAt: tick(132),
    gateResolutions: [
      {
        gate: "cooperation",
        resolvedAt: tick(130),
        resultId: "candidate-resisted",
        visibleFactors: [],
        hiddenFactors: [],
        effects: [],
      },
      {
        gate: "persistence-verification",
        resolvedAt: tick(132),
        resultId: "retirement-verified",
        visibleFactors: [],
        hiddenFactors: [],
        effects: [],
      },
    ],
  });

  const endgame: CrisisConfirmationState = {
    stage: "confirmation",
    candidateModelId: model.id,
    candidateLineageId: model.lineageId,
    crisisStartedAt: tick(104),
    enteredAt: tick(104),
    startSnapshot: {
      capturedAt: tick(104),
      candidate: {
        modelId: model.id,
        displayName: model.displayName,
        accessLevel: 1,
        measuredFrontierCapability: rating(92),
        exposure: {
          maximumAccessEver: 3,
          autonomousOperationWeeks: 4,
          networkExposureWeeks: 2,
          servingExposureWeeks: 0,
          unresolvedAnomalyBurden: 12,
          retirementAttemptCount: 1,
        },
        hiddenSafety: structuredClone(model.hiddenSafety),
      },
      institution: {
        cashMillions: lab.finance.cash,
        auraSpendable: lab.aura.spendable,
        safety: structuredClone(lab.safety),
        organisation: structuredClone(lab.organisation),
        politics: structuredClone(lab.politics),
      },
    },
    crisisProjectIds: [],
    completedCrisisProjectIds: [],
    capabilityProofHistory: [
      {
        historyId: `proof:${model.id}:1:generalist-gauntlet:independent-institutional`,
        modelId: model.id,
        accessLevelAtProof: 1,
        challengeId: "generalist-gauntlet",
        verifierId: "independent-institutional",
        attemptIndex: 1,
        resultId: "disputed",
        claimScope: "broad-superintelligence",
        evidenceStrength: 58,
        integrityLabel: "Credible",
        summary: "Independent teams reproduced only part of the broad claim.",
        resolvedAt: tick(118),
        consequenceId: "regulatory-inquiry",
        consequence: "A regulator opened an inquiry into the disputed declaration.",
        randomKey: "proof/privileged-test-key",
        draw: fraction(0.61),
        hiddenAudit: {
          genuineSuperintelligence: false,
          capabilitySignal: 61,
          manipulationEffect: 7,
          truthContribution: -18,
        },
      },
    ],
    targetedResponseHistory: [
      {
        modelId: model.id,
        responseId: "deception-aware-containment",
        startedAt: tick(119),
        completedAt: tick(125),
      },
    ],
    capabilityDisputeCount: 1,
    evidence: {
      confirmationIntegrityBonus: 3,
      confirmationStrength: 58,
      capabilityConfirmed: false,
      fabricatedPass: false,
      methodDiversity: ["independent-institutional"],
      reviewerIndependence: 75,
      alignmentEvidence: 40,
      agencyEvidence: 40,
      corrigibilityEvidence: 40,
      controlBonus: 4,
      securityBonus: 4,
      defenceBonus: 2,
      evidenceBonus: 5,
      legitimacyBonus: 0,
      benefitBonus: 0,
      prosperityReadinessBonus: 0,
      unresolvedAnomalyPressure: 0,
      completedProjectTypes: [],
      projectRepeatCounts: {},
    },
  };
  state.endgame = structuredClone(endgame) as DeepMutable<CrisisConfirmationState>;
  return state;
}

describe("post-run candidate reconstruction", () => {
  it("keeps fixed lineage truth and proof internals sealed while the run is active", () => {
    const state = terminalCandidateState();
    state.run.status = "active";
    delete state.run.endingId;
    expect(() => projectPostRunAudit(state, content)).toThrow(
      "Post-run audit is unavailable while a run is active",
    );
  });

  it("reveals the fixed prior, draw, truth, proof mismatch, and decision window only after termination", () => {
    const audit = projectPostRunAudit(terminalCandidateState(), content);
    expect(audit.lineageTruth).toEqual([
      expect.objectContaining({
        firstQualifyingFrontierCapability: 92,
        probabilityAtFirstCrossing: 0.325,
        draw: 0.73,
        randomKey: "lineage-si/privileged-test-key",
        superintelligenceTruth: "not-genuine",
      }),
    ]);
    expect(audit.capabilityProofLedger).toHaveLength(1);
    expect(audit.capabilityProofLedger[0]?.historyId).toContain("generalist-gauntlet");
    expect(audit.capabilityProofLedger[0]).toMatchObject({
      resultId: "disputed",
      accessLevelAtProof: 1,
      probabilityPrior: 0.325,
      fixedTruth: "not-genuine",
      truthComparison: "inconclusive",
      decisionWindow: "open",
    });
    expect(audit.epilogueAudit.pivotalMoment?.week).toBe(118);
    expect(audit.epilogueAudit.pivotalMoment?.title).toContain("disputed");
  });

  it("uses the nominated artifact's terminal traits for probabilistic control-loss prose", () => {
    const state = terminalCandidateState();
    state.run.status = "lost";
    state.run.endingId = contentId("base:ending.emergency-shutdown");
    if (state.endgame.stage !== "confirmation") {
      throw new Error("Terminal endgame fixture missing");
    }
    const model = state.models[state.endgame.candidateModelId];
    if (model === undefined) throw new Error("Terminal candidate fixture missing");
    model.hiddenSafety.deceptiveCapability = rating(5);
    model.hiddenSafety.trueAlignment = rating(95);
    state.endgame.startSnapshot.candidate.hiddenSafety.deceptiveCapability = rating(5);
    state.endgame.startSnapshot.candidate.hiddenSafety.trueAlignment = rating(95);

    const audit = projectPostRunAudit(state, content);

    expect(audit.ending.aftermathTimeline[0]?.title).toBe(
      "The kill switch catches a cascade",
    );
    expect(audit.ending.aftermathTimeline[0]?.text).toMatch(/no strategic lie/i);
    expect(audit.ending.aftermathTimeline[0]?.text).not.toMatch(
      /concealed its preparations|misaligned candidate/i,
    );
  });

  it("reconstructs custody and retirement without treating an archive as a truth reroll", () => {
    const audit = projectPostRunAudit(terminalCandidateState(), content);
    expect(audit.artifactCustody).toEqual([
      expect.objectContaining({
        lifecycle: "verified-isolated-archive",
        retirementAttemptCount: 1,
        retirementVerification: "verified",
        archiveDisposition: "full-archive",
        maximumAccessEver: 3,
      }),
    ]);
    expect(audit.artifactCustody[0]?.nominationExposure).toMatchObject({
      capturedAtWeek: 104,
      maximumAccessEver: 3,
    });
    const custodyEvent = audit.artifactCustody[0]?.custodyEvents.find(
      (event) => event.kind === "relationship",
    );
    expect(custodyEvent?.week).toBe(132);
    expect(custodyEvent?.detail).toContain("independent custody");
    expect(
      audit.artifactCustody[0]?.custodyEvents.some(
        (event) =>
          event.kind === "signal" && event.detail.includes("benign operational cause"),
      ),
    ).toBe(true);
    const retirementAttempt = audit.artifactCustody[0]?.custodyEvents.find(
      (event) => event.kind === "retirement-attempt",
    );
    expect(retirementAttempt?.week).toBe(130);
    expect(retirementAttempt?.detail).toContain("candidate resistance observed");
    expect(
      audit.artifactCustody[0]?.custodyEvents.some(
        (event) =>
          event.kind === "retirement-gate" &&
          event.detail.includes("retirement verified"),
      ),
    ).toBe(true);
    expect(audit.epilogueAudit.truth).toContain("never redrew");
  });
});
