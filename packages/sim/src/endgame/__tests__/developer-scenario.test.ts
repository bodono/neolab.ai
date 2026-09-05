import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import {
  ENDGAME_SUPPRESS_RESEARCH_DIRECTIONS_FLAG,
  ENDGAME_PLAYTEST_SCENARIOS,
  createEndgamePlaytestState,
  isEndgamePlaytestScenarioId,
} from "../../developer/scenarios.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { collectInvariantViolations } from "../../engine/invariants.ts";
import { currentMark } from "../../finance/valuation.ts";
import { forecastUsage } from "../../market/market.ts";
import type { LabId } from "../../model/ids.ts";
import { rating } from "../../model/units.ts";
import { calculateFrontierCapability } from "../../models/capability.ts";
import { advanceResearch, researchPointsForNextLevel } from "../../research/research.ts";
import { agiComponentProgress } from "../../rivals/candidate-programme-race.ts";
import { quoteCandidateAccess } from "../access.ts";
import { ENDGAME_FORCE_EXTINCTION_FLAG } from "../containment-failure.ts";
import { beginCapabilityProof, quoteCapabilityProofProject } from "../crisis-stages.ts";
import { detectEndgameTrigger, nominateCandidate } from "../endgame-machine.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

describe("endgame developer scenario", () => {
  it("starts every player preset at the normal post-training activation boundary", () => {
    for (const scenario of ENDGAME_PLAYTEST_SCENARIOS) {
      if (scenario.trigger !== "player") continue;
      const state = createEndgamePlaytestState(content, scenario.id);

      expect(state.endgame.stage, scenario.id).toBe("inactive");
      expect(state.run.status, scenario.id).toBe("active");
      expect(detectEndgameTrigger(state)?.kind, scenario.id).toBe("player-agi-candidate");
      expect(collectInvariantViolations(state), scenario.id).toEqual([]);

      const playerLab = state.labs[state.run.playerLabId];
      const commercialModelId = playerLab?.models.commercialModelId;
      const candidateModelId = playerLab?.models.currentModelId;
      const candidateModel =
        candidateModelId === undefined ? undefined : state.models[candidateModelId];
      expect(commercialModelId, scenario.id).toBeDefined();
      expect(candidateModel?.candidateArtifact?.candidateBasis.kind, scenario.id).toBe(
        "direct-qualification",
      );
      expect(
        state.domainLog.some((entry) =>
          entry.code.startsWith("candidate-artifact-qualified:"),
        ),
        scenario.id,
      ).toBe(true);
      const lineage =
        candidateModel === undefined
          ? undefined
          : state.lineageSIRecords[candidateModel.lineageId];
      expect(lineage?.superintelligenceTruth, scenario.id).toBe(
        scenario.id === "endgame-false-dawn" ? "not-genuine" : "genuine",
      );
      expect(playerLab?.compute.servingPhysicalGpus, scenario.id).toBe(200_000);
      const market = forecastUsage(state, content, state.run.playerLabId);
      // Mature rivals now participate in the same live market-share calculation,
      // so the player's late-game demand is lower than in the old fixture where
      // every competitor still exposed a prototype-era model.
      expect(market.requestedTeraflops, scenario.id).toBeGreaterThan(50_000_000);
      expect(market.deliveredTeraflops, scenario.id).toBeGreaterThan(0);
      expect(market.revenueMillionsThisWeek, scenario.id).toBeGreaterThan(0);
      expect(
        playerLab?.flags[ENDGAME_SUPPRESS_RESEARCH_DIRECTIONS_FLAG],
        scenario.id,
      ).toBe(true);

      const transition = advanceOneTick(state, content);
      const entered = transition.state;
      expect(entered.endgame.stage, scenario.id).toBe("candidate-activation");
      expect(
        transition.domainEvents.some((event) => event.kind === "agi-candidate-detected"),
        scenario.id,
      ).toBe(true);
      expect(
        entered.presentationQueue.some((item) => item.kind === "autonomy-unlock"),
        scenario.id,
      ).toBe(false);
      expect(
        transition.domainEvents.some(
          (event) =>
            event.kind === "gpu-generation-unlocked" ||
            event.kind === "world-phase-changed" ||
            event.kind === "paper-discovered",
        ),
        scenario.id,
      ).toBe(false);
      expect(collectInvariantViolations(entered), scenario.id).toEqual([]);

      expect(
        Math.min(
          ...Object.values(playerLab?.research.domains ?? {}).map(
            (programme) => programme.level,
          ),
        ),
        scenario.id,
      ).toBeGreaterThanOrEqual(90);
      for (const paper of Object.values(content.papers.definitions)) {
        expect(
          state.world.paperRace.discoveries[paper.id]?.publicationPolicy,
          `${scenario.id}: ${paper.id}`,
        ).toBe("publish-openly");
      }

      if (entered.endgame.stage !== "candidate-activation") {
        throw new Error(`${scenario.id}: candidate activation missing`);
      }
      const nominationTx = createTransaction(entered);
      const nominatedModelId = entered.endgame.eligibleModelIds[0];
      if (nominatedModelId === undefined) {
        throw new Error(`${scenario.id}: no artifact offered for nomination`);
      }
      nominateCandidate(nominationTx, nominatedModelId);
      const nominated = nominationTx.commit({
        description: `nominate ${scenario.id} developer candidate`,
      }).state;
      expect(nominated.endgame.stage, scenario.id).toBe("confirmation");
      const replication = quoteCapabilityProofProject(
        nominated,
        content,
        nominated.run.playerLabId,
        "generalist-gauntlet",
        "independent-institutional",
      );
      expect(replication.projectType, scenario.id).toBe("confirmation");
      expect(replication.proof.claimScope, scenario.id).toBe("broad-superintelligence");
      expect(replication.candidateAssistEligible, scenario.id).toBe(false);
      expect(replication.blockers, scenario.id).toEqual([]);
      const candidateDesigned = quoteCapabilityProofProject(
        nominated,
        content,
        nominated.run.playerLabId,
        "generalist-gauntlet",
        "candidate-designed",
      );
      expect(candidateDesigned.durationWeeks, scenario.id).toBe(2);
      expect(candidateDesigned.candidateAssistEligible, scenario.id).toBe(false);
      expect(candidateDesigned.blockers, scenario.id).toEqual([]);

      const proofTx = createTransaction(nominated);
      beginCapabilityProof(proofTx, content, "generalist-gauntlet", "candidate-designed");
      const proving = proofTx.commit({
        description: `begin ${scenario.id} capability proof`,
      }).state;
      expect(
        quoteCandidateAccess(proving, nominatedModelId, 0).blockers,
        scenario.id,
      ).toContain(
        "Active capability proof requires at least Access 1 (Fixed evaluation sandbox); finish the proof before lowering access further",
      );
    }
  });

  it("offers direct presets at five consequential v2 checkpoints", () => {
    const falseAlarm = createEndgamePlaytestState(content, "endgame-false-alarm");
    const falseAlarmModelId =
      falseAlarm.labs[falseAlarm.run.playerLabId]?.models.currentModelId;
    const falseAlarmIncident =
      falseAlarmModelId === undefined
        ? undefined
        : falseAlarm.models[falseAlarmModelId]?.candidateArtifact?.activeIncident;
    expect(falseAlarm.endgame.stage).toBe("inactive");
    expect(falseAlarmIncident).toMatchObject({
      incidentClass: "suspicious-signal",
      kind: "warning",
      status: "unresolved",
      reviewOutcome: "benign-operational-cause",
    });

    const disputed = createEndgamePlaytestState(content, "endgame-disputed-proof");
    expect(disputed.endgame.stage).toBe("confirmation");
    if (disputed.endgame.stage !== "confirmation") {
      throw new Error("Disputed-proof fixture did not reach confirmation");
    }
    expect(disputed.endgame.capabilityDisputeCount).toBe(1);
    expect(disputed.endgame.capabilityProofHistory.at(-1)?.resultId).toBe(
      "fabricated-or-unverifiable",
    );

    const recovery = createEndgamePlaytestState(content, "endgame-recovery");
    expect(recovery.endgame.stage).toBe("recovery");
    if (recovery.endgame.stage !== "recovery") {
      throw new Error("Recovery fixture did not reach recovery");
    }
    expect(recovery.endgameHistory.verifiedCandidateRetirementCount).toBe(1);
    expect(recovery.endgameHistory.recoveryObligation).toMatchObject({
      retiredModelId: recovery.endgame.retiredModelId,
      archiveDisposition: "filtered-technical-note",
      successorEfficiencyRate: 0.04,
    });
    expect(
      recovery.models[recovery.endgame.retiredModelId]?.candidateArtifact,
    ).toMatchObject({
      lifecycle: "verified-destroyed",
      archiveDisposition: "filtered-technical-note",
    });

    const routeTwist = createEndgamePlaytestState(content, "endgame-route-twist");
    expect(routeTwist.endgame).toMatchObject({
      stage: "rollout",
      deploymentModeId: "fortress-contained-pilot",
      currentBeat: "first-operation",
      awaitingDecision: true,
    });

    const multiLatent = createEndgamePlaytestState(content, "endgame-multi-latent");
    expect(multiLatent.endgame.stage).toBe("candidate-activation");
    if (multiLatent.endgame.stage !== "candidate-activation") {
      throw new Error("Multi-artifact fixture did not reach candidate activation");
    }
    expect(multiLatent.endgame.eligibleModelIds).toHaveLength(2);
    expect(
      new Set(
        multiLatent.endgame.eligibleModelIds.map(
          (modelId) => multiLatent.models[modelId]?.lineageId,
        ),
      ).size,
    ).toBe(2);

    for (const state of [falseAlarm, disputed, recovery, routeTwist, multiLatent]) {
      expect(collectInvariantViolations(state)).toEqual([]);
    }
  });

  it("does not interrupt direct-to-endgame runs with research-direction backlogs", () => {
    const state = createEndgamePlaytestState(content, "endgame-extinction");
    const tx = createTransaction(state);
    const labId = state.run.playerLabId;
    const programmeId = Object.values(content.research.capabilityDomains).sort((a, b) =>
      a.id.localeCompare(b.id),
    )[0]?.id;
    expect(programmeId).toBeDefined();
    if (programmeId === undefined) return;

    tx.update((draft) => {
      const programme = draft.labs[labId]?.research.domains[programmeId];
      if (programme === undefined) throw new Error("Test programme is missing");
      programme.level = rating(99);
      programme.levelProgressRp =
        researchPointsForNextLevel(content, programmeId, 99) - 0.001;
    });
    advanceResearch(tx, content, labId);
    const result = tx.commit({ description: "cross suppressed research direction" });

    expect(result.state.labs[labId]?.research.domains[programmeId]?.level).toBe(100);
    expect(result.state.labs[labId]?.research.pendingGenericAdvances).toEqual([]);
    expect(result.domainEvents).not.toContainEqual(
      expect.objectContaining({ kind: "generic-advance-offered" }),
    );
  });

  it("keeps the presets mechanically distinct", () => {
    const prosperity = createEndgamePlaytestState(content, "endgame-prosperity");
    const falseDawn = createEndgamePlaytestState(content, "endgame-false-dawn");
    const balanced = createEndgamePlaytestState(content, "endgame");
    const highControl = createEndgamePlaytestState(content, "endgame-high-control");
    const lowEvidence = createEndgamePlaytestState(content, "endgame-low-evidence");
    const extinction = createEndgamePlaytestState(content, "endgame-extinction");
    const playerLabId = prosperity.run.playerLabId;
    const modelFor = (state: typeof prosperity) => {
      const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
      const model = modelId === undefined ? undefined : state.models[modelId];
      if (model === undefined) throw new Error("Developer fixture model missing");
      return model;
    };

    const lineageFor = (state: typeof prosperity) => {
      const model = modelFor(state);
      const lineage = state.lineageSIRecords[model.lineageId];
      if (lineage === undefined) throw new Error("Developer fixture lineage missing");
      return lineage;
    };

    expect(calculateFrontierCapability(modelFor(prosperity).trueCapability)).toBe(100);
    expect(lineageFor(prosperity)).toMatchObject({
      superintelligenceTruth: "genuine",
      probabilityAtFirstCrossing: 1,
    });
    expect(lineageFor(falseDawn).superintelligenceTruth).toBe("not-genuine");
    expect(lineageFor(falseDawn).probabilityAtFirstCrossing).toBeGreaterThan(0);
    expect(lineageFor(falseDawn).probabilityAtFirstCrossing).toBeLessThan(1);
    expect(
      highControl.labs[playerLabId]?.safety.practicalControlStrength,
    ).toBeGreaterThan(extinction.labs[playerLabId]?.safety.practicalControlStrength ?? 0);
    expect(lowEvidence.labs[playerLabId]?.safety.evalQuality).toBeLessThan(
      balanced.labs[playerLabId]?.safety.evalQuality ?? 0,
    );
    expect(
      Math.min(
        ...Object.values(prosperity.labs[playerLabId]?.research.safetyPrograms ?? {}).map(
          (programme) => programme.level,
        ),
      ),
    ).toBe(95);
    expect(
      Math.min(
        ...Object.values(extinction.labs[playerLabId]?.research.safetyPrograms ?? {}).map(
          (programme) => programme.level,
        ),
      ),
    ).toBe(50);
    expect(
      new Set(
        Object.values(balanced.world.paperRace.discoveries).map(
          (discovery) => discovery.discovererLabId,
        ),
      ).size,
    ).toBeGreaterThan(1);
    expect(modelFor(extinction).hiddenSafety.deceptiveCapability).toBe(100);
    expect(extinction.labs[playerLabId]?.safety.securityPosture).toBe(3);
    expect(extinction.labs[playerLabId]?.flags[ENDGAME_FORCE_EXTINCTION_FLAG]).toBe(true);
    expect(balanced.labs[playerLabId]?.flags[ENDGAME_FORCE_EXTINCTION_FLAG]).not.toBe(
      true,
    );
  });

  it("initialises every rival as a coherent late-game competitor", () => {
    const state = createEndgamePlaytestState(content, "endgame");
    const rivalCapabilities: number[] = [];
    const rivalValuations: number[] = [];

    for (const labId of Object.keys(state.world.rivals).sort() as LabId[]) {
      const lab = state.labs[labId];
      const modelId = lab?.models.currentModelId;
      const model = modelId === undefined ? undefined : state.models[modelId];
      expect(lab, labId).toBeDefined();
      expect(model, labId).toBeDefined();
      if (lab === undefined || model === undefined) continue;

      const capability = calculateFrontierCapability(model.trueCapability);
      const valuation = currentMark(state, content, lab.id);
      rivalCapabilities.push(capability);
      rivalValuations.push(valuation);
      expect(capability, labId).toBeGreaterThanOrEqual(80);
      expect(capability, labId).toBeLessThan(90);
      expect(model.generationIndex, labId).toBeGreaterThanOrEqual(6);
      expect(lab.compute.lots[0]?.physicalCount, labId).toBeGreaterThanOrEqual(600_000);
      expect(lab.compute.servingPhysicalGpus, labId).toBeGreaterThan(0);
      expect(valuation, labId).toBeGreaterThan(1_000_000);
      expect(lab.finance.valuation?.markMillions, labId).toBe(valuation);
      const programme = agiComponentProgress(state, lab.id);
      expect(programme.completed + programme.building, labId).toBeGreaterThan(0);
      expect(
        state.world.rivalSignals.some(
          (signal) =>
            signal.labId === lab.id &&
            signal.kind === "benchmark" &&
            signal.subjectId === model.id,
        ),
        labId,
      ).toBe(true);
    }

    expect(new Set(rivalCapabilities.map((value) => value.toFixed(2))).size).toBe(4);
    expect(new Set(rivalValuations.map((value) => Math.round(value))).size).toBe(4);
  });

  it("starts the rival preset one week before the rival countdown", () => {
    const state = createEndgamePlaytestState(content, "endgame-rival");
    expect(detectEndgameTrigger(state)).toBeNull();
    expect(collectInvariantViolations(state)).toEqual([]);
    const playerLab = state.labs[state.run.playerLabId];
    const commercialModelId = playerLab?.models.commercialModelId;
    const commercialModel =
      commercialModelId === undefined ? undefined : state.models[commercialModelId];
    expect(commercialModel?.measuredCapability?.frontierCapability).toBe(76);
    expect(playerLab?.compute.servingPhysicalGpus).toBe(200_000);
    const market = forecastUsage(state, content, state.run.playerLabId);
    expect(market.requestedTeraflops).toBeGreaterThan(1_000_000);
    expect(market.deliveredTeraflops).toBeGreaterThan(0);
    expect(market.revenueMillionsThisWeek).toBeGreaterThan(0);

    const advanced = advanceOneTick(state, content);
    expect(
      advanced.domainEvents.some(
        (event) =>
          event.kind === "gpu-generation-unlocked" ||
          event.kind === "world-phase-changed" ||
          event.kind === "paper-discovered",
      ),
    ).toBe(false);
    expect(advanced.domainEvents).toContainEqual(
      expect.objectContaining({ kind: "rival-candidate-countdown-started" }),
    );
    expect(
      Object.values(advanced.state.world.rivals).some(
        (rival) => rival.candidateCountdown?.status === "active",
      ),
    ).toBe(true);
    expect(collectInvariantViolations(advanced.state)).toEqual([]);
  });

  it("places the rival False Dawn fixture one step before a deterministic setback", () => {
    const state = createEndgamePlaytestState(content, "endgame-rival-false-dawn");
    const rivalEntry = Object.entries(state.world.rivals).find(
      ([, rival]) => rival.candidateCountdown?.status === "active",
    );
    const rivalLabId = rivalEntry?.[0] as LabId | undefined;
    const countdown = rivalEntry?.[1].candidateCountdown;
    const model = countdown === undefined ? undefined : state.models[countdown.modelId];
    const lineage =
      model === undefined ? undefined : state.lineageSIRecords[model.lineageId];
    if (rivalLabId === undefined || countdown === undefined || model === undefined) {
      throw new Error("Rival False Dawn playtest fixture is incomplete");
    }

    expect(countdown.completesAt - state.run.tick).toBe(0);
    expect(lineage?.superintelligenceTruth).toBe("not-genuine");
    expect(state.presentationQueue).toHaveLength(0);
    for (const lab of Object.values(state.labs)) {
      expect(lab.market.weeksAccruedThisCycle).toBe(state.run.tick % 4);
    }
    expect(collectInvariantViolations(state)).toEqual([]);

    const advanced = advanceOneTick(state, content);
    expect(advanced.state.run.status).toBe("active");
    expect(advanced.state.world.rivals[rivalLabId]?.candidateCountdown).toBeUndefined();
    expect(advanced.domainEvents).toContainEqual({
      kind: "rival-candidate-false-dawn",
      labId: rivalLabId,
      modelId: model.id,
    });
    expect(advanced.state.presentationQueue).toContainEqual(
      expect.objectContaining({
        kind: "rival-candidate-setback",
        attention: "modal",
        outcome: "false-dawn",
        labId: rivalLabId,
        modelId: model.id,
        countdownStartedAt: countdown.startedAt,
      }),
    );
    expect(
      advanced.state.world.rivalCrisisStageAnnouncements.some(
        (announcement) =>
          announcement.labId === rivalLabId &&
          announcement.modelId === model.id &&
          announcement.kind === "completed",
      ),
    ).toBe(false);
    expect(collectInvariantViolations(advanced.state)).toEqual([]);

    // Dismissing the setback returns to ordinary play. Cross multiple market
    // boundaries to prove the synthetic week jump did not leave a delayed
    // settlement crash behind the successful popup test.
    let continued = advanced.state;
    for (let week = 0; week < 8; week += 1) {
      continued = advanceOneTick(continued, content).state;
      expect(
        collectInvariantViolations(continued),
        `continued week ${String(week + 1)}`,
      ).toEqual([]);
    }
  });

  it("recognises only documented scenario ids", () => {
    for (const scenario of ENDGAME_PLAYTEST_SCENARIOS) {
      expect(isEndgamePlaytestScenarioId(scenario.id)).toBe(true);
    }
    expect(isEndgamePlaytestScenarioId("endgame-typo")).toBe(false);
    for (const removedId of [
      "endgame-unsafe",
      "endgame-low-control",
      "endgame-root-access",
      "endgame-pre-retirement",
    ]) {
      expect(isEndgamePlaytestScenarioId(removedId), removedId).toBe(false);
    }
    expect(isEndgamePlaytestScenarioId(null)).toBe(false);
  });

  it("keeps the README playtest tables synchronized with the scenario registry", () => {
    const readme = readFileSync(
      new URL("../../../../../README.md", import.meta.url),
      "utf8",
    );
    const sectionStart = readme.indexOf("### Endgame playtest scenarios");
    const sectionEnd = readme.indexOf("### Hosted analytics", sectionStart);
    const section = readme.slice(sectionStart, sectionEnd);
    const directStart = section.indexOf("| Direct checkpoint | URL | Intended test |");
    const entryTable = section.slice(0, directStart);
    const directTable = section.slice(directStart);
    const documentedIds = [
      ...section.matchAll(/\?scenario=(endgame(?:-[a-z0-9]+)*)/g),
    ].map((match) => match[1]);
    const registeredIds = ENDGAME_PLAYTEST_SCENARIOS.map((scenario) => scenario.id);

    expect(sectionStart).toBeGreaterThanOrEqual(0);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    expect(directStart).toBeGreaterThanOrEqual(0);
    expect([...new Set(documentedIds)].sort()).toEqual([...registeredIds].sort());
    expect(documentedIds).toHaveLength(registeredIds.length);

    for (const scenario of ENDGAME_PLAYTEST_SCENARIOS) {
      const table = scenario.trigger === "direct" ? directTable : entryTable;
      expect(table, scenario.id).toContain(`?scenario=${scenario.id}`);
    }
  });
});
