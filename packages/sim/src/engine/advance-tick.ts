import { contentId, type CompiledContent } from "@neolab/content-schema";

import { assertNever } from "../model/assert-never.ts";
import type { LabId } from "../model/ids.ts";
import { calendarFromTick, type GameState } from "../model/state.ts";
import { fraction, tick as makeTick } from "../model/units.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import {
  CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG,
  hasLargeCapabilityDomainSwing,
} from "../compute/gpu-portfolio.ts";
import {
  NEGATIVE_CASH_BANKRUPTCY_WEEKS,
  NEGATIVE_CASH_WARNING_WEEKS,
  settleCycle,
} from "../finance/finance.ts";
import { payAuraStandingIncome } from "../aura/aura.ts";
import { accrueWeeklyUsage, settleWorldMarketCycle } from "../market/market.ts";
import {
  activateEligibleQueuedProjects,
  advanceProjects,
  completeReadyProjects,
} from "../projects/project-framework.ts";
import { advanceResearch } from "../research/research.ts";
import { advancePaperRace } from "../research/papers.ts";
import { advanceAnomalyInvestigations } from "../evaluations/evaluations.ts";
import { updateAutonomyWeekly } from "../models/autonomy.ts";
import {
  advanceAutonomyEscalation,
  synchroniseAutonomyEscalationResponses,
} from "../models/autonomy-escalation.ts";
import { advanceIncidentChecks } from "../incidents/incidents.ts";
import { advanceValuations } from "../finance/valuation.ts";
import { evaluateResearcherCompacts } from "../researchers/compacts.ts";
import { evaluateResearcherPromises } from "../researchers/promises.ts";
import {
  advanceResearcherSalaryReviews,
  advanceResearcherCrises,
  updateOrganisationRatings,
  updateResearcherStates,
} from "../researchers/people.ts";
import { syncAllResearcherAbilityModifiers } from "../researchers/researchers.ts";
import { refreshTalentMarket } from "../researchers/talent-market.ts";
import { isProgressiveOpeningInsolvencyProtected } from "../campaign/progressive-opening.ts";
import { applyEffect, applyEffects } from "./effect-executor.ts";
import { expireFundingOffers } from "../fundraising/fundraising.ts";
import { advanceEventGeneration } from "../events/event-engine.ts";
import {
  synchroniseGovernmentEventResponses,
  settleGovernmentProgrammes,
  updateGovernmentQuarter,
  updateGovernmentWeekly,
} from "../politics/politics.ts";
import {
  advanceRivalTalentMoves,
  queueRivalWeeklyCommands,
  recapitaliseRivals,
  updateRivalQuarterPlans,
} from "../rivals/policy.ts";
import { advanceRivalResearch } from "../rivals/research.ts";
import { advanceRivalIncidents } from "../rivals/incidents.ts";
import { advanceRivalCandidateCountdowns } from "../rivals/candidate-countdown.ts";
import { advanceRivalCandidateProgramme } from "../rivals/candidate-programme-race.ts";
import { advanceRivalInfrastructure } from "../rivals/infrastructure.ts";
import {
  COALITION_MECHANIC_ENABLED,
  refreshCoalitionPhases,
} from "../coalition/coalition.ts";
import { detectAndEnterDeploymentCrisis } from "../endgame/endgame-machine.ts";
import { endgameClockStopReason } from "../endgame/clock-policy.ts";
import { advanceRollout } from "../endgame/rollout.ts";
import { advanceRetirementRecovery } from "../endgame/retirement.ts";
import { advanceLatentCandidateHazards } from "../endgame/latent-hazard.ts";
import { advanceAmbientChatter } from "../feed/ambient.ts";
import { advanceResearcherReactions } from "../feed/reactions.ts";
import { createSystemRegistry, type TickContext, type TickSystem } from "./systems.ts";
import {
  createTransaction,
  type SimulationTransaction,
  type TransitionResult,
} from "./transaction.ts";
import { awardProsperityReadinessMilestones, finaliseEndedRun } from "./score.ts";
import {
  advanceWorldGpuGeneration,
  advanceWorldPhaseAfterHardware,
} from "./world-progression.ts";
import type { TickPhase } from "./tick-phases.ts";
import { isGuidedTutorial } from "../tutorial/guided-tutorial.ts";
import {
  isProgressiveOpeningProtected,
  shouldHoldAmbientSimulation,
  synchronisePlayerLabMaturity,
} from "../campaign/lab-maturity.ts";

function holdAmbientSimulation(state: Readonly<GameState>): boolean {
  return isGuidedTutorial(state) || shouldHoldAmbientSimulation(state);
}

/** Ticks per financial cycle and per quarter (GDD section 28.1). */
export const TICKS_PER_CYCLE = 4;
export const TICKS_PER_QUARTER = 13;

function endRunForInsolvency(
  tx: SimulationTransaction,
  labId: LabId,
  cashMillions: number,
  occurredAt: number,
): void {
  tx.update((draft) => {
    draft.domainLog.push({
      tick: makeTick(occurredAt),
      code: "finance.insolvency",
    });
  });
  tx.emit({
    kind: "finance-insolvent",
    labId,
    cashMillions,
  });
  applyEffect(
    tx,
    {
      kind: "end-run",
      result: "lost",
      endingId: contentId("base:ending.the-worlds-most-expensive-insolvency"),
    },
    { kind: "system", id: "finance.insolvency" },
  );
}

function updateNegativeCashStreak(
  tx: SimulationTransaction,
  labId: LabId,
): { readonly cashMillions: number; readonly consecutiveWeeks: number } {
  let cashMillions = 0;
  let consecutiveWeeks = 0;
  tx.update((draft) => {
    const lab = draft.labs[labId];
    if (lab === undefined) throw new Error(`Finance targets unknown lab ${labId}`);
    cashMillions = lab.finance.cash;
    consecutiveWeeks = isProgressiveOpeningInsolvencyProtected(draft)
      ? 0
      : cashMillions < 0
        ? (lab.finance.consecutiveNegativeCashWeeks ?? 0) + 1
        : 0;
    lab.finance.consecutiveNegativeCashWeeks = consecutiveWeeks;
  });
  return { cashMillions, consecutiveWeeks };
}

function hasActiveFundraisingAttempt(state: Readonly<GameState>, labId: LabId): boolean {
  return Object.values(state.projects).some(
    (project) =>
      project.ownerLabId === labId &&
      project.kind === "fundraising" &&
      project.status === "active",
  );
}

function requestBankruptcyWarningUnlessFundraisingActive(
  tx: SimulationTransaction,
  labId: LabId,
): void {
  const state = tx.read();
  if (
    !isProgressiveOpeningInsolvencyProtected(state) &&
    !hasActiveFundraisingAttempt(state, labId)
  ) {
    tx.requestAutoPause("bankruptcy-warning");
  }
}

function warnForPersistentNegativeCash(
  tx: SimulationTransaction,
  labId: LabId,
  cashMillions: number,
  consecutiveWeeks: 26 | 39,
  occurredAt: number,
): void {
  tx.update((draft) => {
    draft.domainLog.push({
      tick: makeTick(occurredAt),
      code: `finance.negative-cash.${String(consecutiveWeeks)}-weeks`,
    });
    draft.decisionLog.push({
      tick: makeTick(occurredAt),
      summary:
        `Cash has remained below zero for ${String(consecutiveWeeks)} consecutive weeks. ` +
        `Restoring the balance to $0 or above is the only way to reset the ` +
        `${String(NEGATIVE_CASH_BANKRUPTCY_WEEKS)}-week insolvency clock.`,
    });
  });
  tx.emit({
    kind: "finance-negative-balance-warning",
    labId,
    cashMillions,
    consecutiveWeeks,
    bankruptcyAtWeeks: NEGATIVE_CASH_BANKRUPTCY_WEEKS,
  });
  requestBankruptcyWarningUnlessFundraisingActive(tx, labId);
}

/**
 * Baseline system set for the walking skeleton. Stages 2+ append real
 * economy/research/rival systems into their canonical phases.
 */
function baselineSystems(): readonly TickSystem[] {
  return [
    {
      id: "orders.apply-queued",
      phase: "apply-orders",
      priority: 0,
      run(tx): void {
        tx.update((draft) => {
          const orders = draft.run.queuedOrders;
          if (orders.length === 0) return;
          for (const order of orders) {
            switch (order.kind) {
              case "set-gpu-allocation": {
                const lab = draft.labs[order.labId];
                if (lab !== undefined) {
                  if (
                    hasLargeCapabilityDomainSwing(
                      lab.compute.allocation,
                      order.allocation,
                    )
                  ) {
                    lab.flags[CAPABILITY_CONTEXT_SWITCH_PENALTY_FLAG] = draft.run.tick;
                  }
                  lab.compute.allocation = order.allocation;
                }
                break;
              }
              default:
                assertNever(order.kind);
            }
          }
          draft.run.queuedOrders = [];
        });
        const applied = tx.before.run.queuedOrders.length;
        if (applied > 0) {
          tx.emit({
            kind: "orders-applied",
            tick: tx.before.run.tick,
            count: applied,
          });
        }
      },
    },
    {
      id: "market.accrue-serving",
      phase: "serving",
      priority: 0,
      run(tx, context): void {
        for (const labId of Object.keys(tx.read().labs).sort() as LabId[]) {
          const usage = accrueWeeklyUsage(tx, context.content, labId);
          if (usage.unmetTeraflops > 0) {
            tx.emit({
              kind: "serving-shortage",
              labId,
              requestedTeraflops: usage.requestedTeraflops,
              deliveredTeraflops: usage.deliveredTeraflops,
            });
          }
        }
      },
    },
    {
      id: "researchers.sync-abilities",
      phase: "research",
      priority: -1,
      run(tx, context): void {
        if (shouldHoldAmbientSimulation(tx.read())) return;
        syncAllResearcherAbilityModifiers(tx, context.content);
      },
    },
    {
      id: "research.advance-weekly",
      phase: "research",
      priority: 0,
      run(tx, context): void {
        if (shouldHoldAmbientSimulation(tx.read())) return;
        advanceResearch(tx, context.content, tx.read().run.playerLabId, context.random);
      },
    },
    {
      id: "rivals.advance-research",
      phase: "research",
      priority: 1,
      run(tx, context): void {
        // Progressive campaigns hide the race during the garage opening, but
        // rivals do not wait for the player to discover them. The dedicated
        // guided tutorial remains the only mode that freezes rival progress.
        if (isGuidedTutorial(tx.read())) return;
        advanceRivalResearch(tx, context.content, context.random);
      },
    },
    {
      id: "projects.advance",
      phase: "projects",
      priority: 0,
      run(tx, context): void {
        advanceProjects(tx, context.content);
      },
    },
    {
      id: "projects.complete",
      phase: "project-completion",
      priority: 0,
      run(tx, context): void {
        completeReadyProjects(tx, context.content);
        if (
          isGuidedTutorial(tx.read()) &&
          tx
            .emittedEvents()
            .some(
              (event) =>
                event.kind === "training-completed" ||
                event.kind === "evaluation-completed" ||
                event.kind === "productisation-completed" ||
                event.kind === "facility-completed",
            )
        ) {
          // Each lesson step ends at a deliberate hand-off. The player reads
          // the result and chooses the next action before the calendar moves.
          tx.requestAutoPause("manual");
        }
        // Completion can free a slot or finish a facility that adds one. Hand
        // that capacity to queued work immediately, but stamp the project at
        // the next weekly boundary because this week's advancement is already
        // over. The promoted project therefore appears active without gaining
        // a free week of progress.
        activateEligibleQueuedProjects(
          tx,
          context.content,
          Object.keys(tx.read().labs).sort() as LabId[],
          makeTick(context.tick + 1),
        );
      },
    },
    {
      id: "world.advance-phase",
      phase: "project-completion",
      priority: 1,
      run(tx, context): void {
        if (isGuidedTutorial(tx.read())) return;
        advanceWorldPhaseAfterHardware(tx, context.content);
      },
    },
    {
      id: "papers.advance-race",
      phase: "papers",
      priority: 0,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        advancePaperRace(tx, context.content, context.random);
      },
    },
    {
      id: "rivals.advance-infrastructure",
      phase: "rivals",
      priority: -1,
      run(tx, context): void {
        if (isGuidedTutorial(tx.read())) return;
        advanceRivalInfrastructure(tx, context.content);
      },
    },
    {
      id: "rivals.issue-weekly-commands",
      phase: "rivals",
      priority: 0,
      run(tx, context): void {
        if (isGuidedTutorial(tx.read())) return;
        queueRivalWeeklyCommands(tx, context.content);
        advanceRivalTalentMoves(tx, context.content, context.random);
      },
    },
    {
      id: "rivals.advance-candidate-countdowns",
      phase: "rivals",
      priority: 1,
      run(tx, context): void {
        if (isGuidedTutorial(tx.read())) return;
        advanceRivalCandidateProgramme(tx, context.content, context.random);
        advanceRivalCandidateCountdowns(tx, context.random);
      },
    },
    {
      id: "coalition.refresh-phases",
      phase: "rivals",
      priority: 2,
      run(tx): void {
        // TODO(coalition-redesign): step kept in the schedule (its id appears
        // in replay traces) but inert while the mechanic is disabled.
        if (!COALITION_MECHANIC_ENABLED) return;
        refreshCoalitionPhases(tx);
      },
    },
    {
      id: "safety.advance-anomaly-investigations",
      phase: "incidents",
      priority: 0,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        advanceAnomalyInvestigations(tx, context.content);
        updateAutonomyWeekly(tx, context.content);
        if (isProgressiveOpeningProtected(tx.read())) return;
        synchroniseAutonomyEscalationResponses(tx, context.content, context.random);
        advanceAutonomyEscalation(tx, context.content, context.random);
      },
    },
    {
      id: "researchers.evaluate-compacts",
      phase: "organisational-update",
      priority: -1,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        evaluateResearcherCompacts(tx, context.content);
      },
    },
    {
      id: "researchers.adjust-salaries",
      phase: "organisational-update",
      priority: -5,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        advanceResearcherSalaryReviews(tx, context.content);
      },
    },
    {
      id: "researchers.refresh-talent-market",
      phase: "organisational-update",
      priority: -4,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        refreshTalentMarket(tx, context.content);
      },
    },
    {
      id: "researchers.update-state-drift",
      phase: "organisational-update",
      priority: -3,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        updateOrganisationRatings(tx);
        updateResearcherStates(tx, context.content);
      },
    },
    {
      id: "researchers.evaluate-promises",
      phase: "organisational-update",
      priority: -2,
      run(tx): void {
        if (holdAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        evaluateResearcherPromises(tx);
      },
    },
    {
      id: "researchers.advance-crises",
      phase: "organisational-update",
      priority: 0,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        advanceResearcherCrises(tx, context.content);
      },
    },
    {
      id: "safety.advance-candidate-hazards",
      phase: "incidents",
      priority: 1,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        advanceLatentCandidateHazards(tx, context.random);
      },
    },
    {
      id: "safety.check-model-incidents",
      phase: "incidents",
      priority: 2,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        advanceIncidentChecks(tx, context.content, context.random);
      },
    },
    {
      id: "rivals.check-incidents",
      phase: "incidents",
      priority: 3,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        advanceRivalIncidents(tx, context.random);
      },
    },
    {
      id: "events.generate",
      phase: "event-generation",
      priority: 0,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        advanceEventGeneration(tx, context.content, context.random);
      },
    },
    {
      // Run after every incident generator so the immediate market shock sees
      // incidents from the week in which they actually occur.
      id: "finance.advance-valuations",
      phase: "incidents",
      priority: 4,
      run(tx, context): void {
        advanceValuations(tx, context.content, context.random);
      },
    },
    {
      id: "politics.synchronise-event-responses",
      phase: "organisational-update",
      priority: 2,
      run(tx): void {
        if (shouldHoldAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        synchroniseGovernmentEventResponses(tx);
      },
    },
    {
      id: "effects.apply-delayed",
      phase: "delayed-effects",
      priority: 0,
      run(tx, context): void {
        // Scheduled consequences fire when their tick arrives (TDD 8.4, GDD
        // 43 delayed effects). Drained to a fixpoint: an effect scheduled with
        // dueInWeeks 0 while this phase runs fires in the SAME tick, so a
        // nested chain can never strand a past-due entry for the commit
        // invariants to reject (review finding: run-bricking softlock).
        const MAX_DRAIN_ROUNDS = 100;
        for (let round = 0; ; round += 1) {
          const due = tx
            .read()
            .scheduledEffects.filter((scheduled) => scheduled.dueAt <= context.tick);
          if (due.length === 0) return;
          if (round >= MAX_DRAIN_ROUNDS) {
            throw new Error(
              `delayed-effects did not settle after ${String(MAX_DRAIN_ROUNDS)} rounds — ` +
                "a scheduled effect is re-scheduling itself with dueInWeeks 0",
            );
          }
          tx.update((draft) => {
            draft.scheduledEffects = draft.scheduledEffects.filter(
              (scheduled) => scheduled.dueAt > context.tick,
            );
          });
          for (const scheduled of due) {
            tx.update((draft) => {
              draft.decisionLog.push({
                tick: draft.run.tick,
                summary:
                  `Delayed consequence ${scheduled.id} fired from ` +
                  `${scheduled.source.kind}:${scheduled.source.id ?? "unspecified"}.`,
                category: "delayed-effect-fired",
                source: structuredClone(scheduled.source),
                relatedIds: [scheduled.id],
              });
            });
            tx.emit({
              kind: "delayed-effect-fired",
              scheduledEffectId: scheduled.id,
              source: structuredClone(scheduled.source),
              effectCount: scheduled.effects.length,
            });
            applyEffects(tx, scheduled.effects, scheduled.source);
          }
        }
      },
    },
    {
      id: "world.advance-gpu-generation",
      phase: "deliveries",
      priority: -1,
      run(tx, context): void {
        advanceWorldGpuGeneration(tx, context.content);
      },
    },
    {
      id: "compute.receive-deliveries",
      phase: "deliveries",
      priority: 1,
      run(tx, context): void {
        const due = Object.values(tx.read().labs).flatMap((lab) =>
          lab.compute.deliveries
            .filter((delivery) => delivery.dueAt <= context.tick + 1)
            .map((delivery) => ({ labId: lab.id, delivery })),
        );
        if (due.length === 0) return;
        tx.update((draft) => {
          for (const { labId, delivery } of due) {
            const lab = draft.labs[labId];
            if (lab === undefined)
              throw new Error(`Delivery targets unknown lab ${labId}`);
            lab.compute.lots.push({
              id: delivery.lotId,
              generationId: delivery.generationId,
              ownership: delivery.ownership,
              physicalCount: delivery.physicalCount,
              availableFraction: fraction(1),
              reliability: delivery.reliability,
              acquisitionCostMillions: delivery.acquisitionCostMillions,
              recurringCostMillionsPerCycle: delivery.recurringCostMillionsPerCycle,
              ...(delivery.resaleFraction === undefined
                ? {}
                : { resaleFraction: delivery.resaleFraction }),
            });
            lab.compute.deliveries = lab.compute.deliveries.filter(
              (candidate) => candidate.lotId !== delivery.lotId,
            );
          }
        });
        for (const { labId, delivery } of due) {
          tx.emit({ kind: "gpu-delivered", labId, lotId: delivery.lotId });
        }
      },
    },
    {
      id: "finance.cycle-boundary",
      phase: "cycle-settlement",
      priority: 0,
      run(tx, context): void {
        const isCycleBoundary = (context.tick + 1) % TICKS_PER_CYCLE === 0;
        if (isCycleBoundary) {
          tx.emit({ kind: "cycle-boundary", tick: context.tick });
          const settledAt = makeTick(context.tick + 1);
          const labIds = Object.keys(tx.read().labs).sort() as LabId[];
          const priceBefore = Object.fromEntries(
            labIds.map((labId) => [labId, tx.read().labs[labId]?.market.priceTier]),
          );
          const financeSettlements = Object.fromEntries(
            labIds.map((labId) => {
              const settlement = settleCycle(tx, context.content, labId, settledAt);
              tx.emit({
                kind: "cycle-settled",
                tick: context.tick,
                labId,
                netMillions: settlement.netMillions,
                closingCashMillions: settlement.closingCashMillions,
              });
              return [labId, settlement];
            }),
          );
          const marketSettlements = settleWorldMarketCycle(
            tx,
            context.content,
            settledAt,
          );
          payAuraStandingIncome(tx, settledAt);
          for (const labId of labIds) {
            const labMarketSettlements = marketSettlements[labId] ?? [];
            tx.emit({
              kind: "market-cycle-settled",
              labId,
              revenueMillions: labMarketSettlements.reduce(
                (sum, marketSettlement) => sum + marketSettlement.revenueMillions,
                0,
              ),
            });
            const priceAfter = tx.read().labs[labId]?.market.priceTier;
            if (
              priceBefore[labId] !== undefined &&
              priceAfter !== undefined &&
              priceAfter !== priceBefore[labId]
            ) {
              tx.emit({ kind: "public-price-changed", labId, priceTier: priceAfter });
            }
          }
          const labId = tx.read().run.playerLabId;
          const settlement = financeSettlements[labId];
          if (settlement === undefined)
            throw new Error("Player finance settlement missing");
          const runway = settlement.runway;
          if (
            !isProgressiveOpeningInsolvencyProtected(tx.read()) &&
            !runway.isInfinite &&
            runway.weeks !== null &&
            runway.band !== "healthy"
          ) {
            tx.emit({
              kind: "finance-runway-warning",
              labId,
              band: runway.band,
              weeks: runway.weeks,
            });
            if (runway.band === "critical") {
              requestBankruptcyWarningUnlessFundraisingActive(tx, labId);
            }
          }
        }
        const labId = tx.read().run.playerLabId;
        const openingCreditProtected = isProgressiveOpeningInsolvencyProtected(tx.read());
        const { cashMillions, consecutiveWeeks } = updateNegativeCashStreak(tx, labId);
        if (cashMillions >= 0 || openingCreditProtected) return;

        const warningWeek = NEGATIVE_CASH_WARNING_WEEKS.find(
          (week): week is 26 | 39 => week === consecutiveWeeks,
        );
        if (warningWeek !== undefined) {
          warnForPersistentNegativeCash(
            tx,
            labId,
            cashMillions,
            warningWeek,
            context.tick + 1,
          );
        }

        if (consecutiveWeeks >= NEGATIVE_CASH_BANKRUPTCY_WEEKS) {
          endRunForInsolvency(tx, labId, cashMillions, context.tick + 1);
          return;
        }
        if (isCycleBoundary) {
          requestBankruptcyWarningUnlessFundraisingActive(tx, labId);
          tx.emit({
            kind: "finance-insolvency-grace",
            labId,
            cashMillions,
          });
        }
      },
    },
    {
      id: "politics.weekly",
      phase: "quarter-update",
      priority: -1,
      run(tx): void {
        if (shouldHoldAmbientSimulation(tx.read())) return;
        if (isProgressiveOpeningProtected(tx.read())) return;
        updateGovernmentWeekly(tx);
      },
    },
    {
      id: "world.quarter-boundary",
      phase: "quarter-update",
      priority: 0,
      run(tx, context): void {
        if ((context.tick + 1) % TICKS_PER_QUARTER !== 0) return;
        if (
          !shouldHoldAmbientSimulation(tx.read()) &&
          !isProgressiveOpeningProtected(tx.read())
        ) {
          settleGovernmentProgrammes(tx, context.content);
          updateGovernmentQuarter(tx);
        }
        if (!isGuidedTutorial(tx.read())) {
          updateRivalQuarterPlans(tx, context.content, context.random);
          recapitaliseRivals(tx, context.content);
        }
        if (
          !shouldHoldAmbientSimulation(tx.read()) &&
          !isProgressiveOpeningProtected(tx.read())
        ) {
          tx.emit({ kind: "quarter-boundary", tick: context.tick });
        }
      },
    },
    {
      id: "campaign.advance-lab-maturity",
      phase: "ending-checks",
      priority: -1,
      run(tx): void {
        // Deliveries, project completions, serving revenue, accepted rounds,
        // and appointments have all settled before the chapter is assessed.
        synchronisePlayerLabMaturity(tx);
      },
    },
    {
      id: "endgame.detect-player-candidate",
      phase: "ending-checks",
      priority: 0,
      run(tx, context): void {
        // Candidate declarations become available in the committed state at
        // the end of their final cooldown week, not one tick later.
        detectAndEnterDeploymentCrisis(tx, makeTick(context.tick + 1));
        advanceRollout(tx, context.content);
        advanceRetirementRecovery(tx, context.content, context.random);
      },
    },
    {
      // Runs before ambient chatter: reactions respond to the week's actual
      // events, so they outrank random flavour on the same feed.
      id: "feed.researcher-reactions",
      phase: "tick-summary",
      priority: -2,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        advanceResearcherReactions(tx, context.content, context.random);
      },
    },
    {
      id: "feed.ambient-chatter",
      phase: "tick-summary",
      priority: -1,
      run(tx, context): void {
        if (holdAmbientSimulation(tx.read())) return;
        advanceAmbientChatter(tx, context.content, context.random);
      },
    },
    {
      id: "summary.advance-date",
      phase: "tick-summary",
      priority: 0,
      run(tx, context): void {
        // GDD 30.3 step 18: write the tick summary and advance the date.
        tx.emit({ kind: "tick-completed", tick: context.tick });
        tx.update((draft) => {
          const next = context.tick + 1;
          draft.run.tick = makeTick(next);
          draft.run.calendar = calendarFromTick(next);
        });
      },
    },
  ];
}

const REGISTRY = createSystemRegistry(baselineSystems());

export interface TickSystemTiming {
  readonly systemId: string;
  readonly phase: TickPhase | "post-systems";
  readonly priority: number;
  readonly durationMilliseconds: number;
}

/**
 * Optional, presentation-owned timing hooks. The simulation never reads a
 * clock itself, and these observations cannot affect canonical state.
 */
export interface TickInstrumentation {
  readonly nowMilliseconds: () => number;
  readonly onSystemStart?: (
    system: Readonly<{ systemId: string; phase: TickSystemTiming["phase"] }>,
  ) => void;
  readonly onSystemComplete: (timing: TickSystemTiming) => void;
}

function runInstrumented(
  instrumentation: TickInstrumentation | undefined,
  system: Readonly<{
    systemId: string;
    phase: TickSystemTiming["phase"];
    priority: number;
    run: () => void;
  }>,
): void {
  if (instrumentation === undefined) {
    system.run();
    return;
  }
  instrumentation.onSystemStart?.({
    systemId: system.systemId,
    phase: system.phase,
  });
  const startedAt = instrumentation.nowMilliseconds();
  system.run();
  const finishedAt = instrumentation.nowMilliseconds();
  instrumentation.onSystemComplete({
    systemId: system.systemId,
    phase: system.phase,
    priority: system.priority,
    durationMilliseconds: Math.max(0, finishedAt - startedAt),
  });
}

/**
 * Advance exactly one atomic, ordered week (TDD section 9.1). Fast-forward is
 * a loop over this function — there is no multi-week shortcut.
 */
export function advanceOneTick(
  state: GameState,
  content: CompiledContent,
  instrumentation?: TickInstrumentation,
): TransitionResult {
  if (state.run.status !== "active") {
    throw new Error(`Cannot advance a ${state.run.status} run`);
  }
  const clockStopReason = endgameClockStopReason(state);
  if (clockStopReason !== undefined) {
    const message = {
      "world-waiting":
        "Cannot advance time during the sealed world-waiting sequence; reveal the outcome",
      "containment-failure":
        "Cannot advance time during a containment failure; resolve the emergency sequence",
      "false-dawn-future": "Cannot advance time until the False Dawn future is chosen",
      "retirement-unresolved":
        "Cannot advance time while candidate retirement remains unverified",
      "recovery-path-decision":
        "Cannot advance time until the post-retirement path is chosen",
      "final-deployment-decision":
        "Cannot advance time while final deployment awaits human authorisation",
    } satisfies Record<typeof clockStopReason, string>;
    throw new Error(message[clockStopReason]);
  }

  const tx = createTransaction(state);
  // Auto-pause reasons are outputs of a single tick; clear before running.
  tx.update((draft) => {
    draft.run.autoPauseReasons = [];
  });

  const context: TickContext = {
    tick: state.run.tick,
    content,
    random: new RandomOracleV1(state.run.seed),
    calendar: state.run.calendar,
  };

  for (const system of REGISTRY) {
    runInstrumented(instrumentation, {
      systemId: system.id,
      phase: system.phase,
      priority: system.priority,
      run: () => system.run(tx, context),
    });
  }

  runInstrumented(instrumentation, {
    systemId: "fundraising.expire-offers",
    phase: "post-systems",
    priority: -1,
    run: () => expireFundingOffers(tx),
  });
  runInstrumented(instrumentation, {
    systemId: "score.award-prosperity-readiness",
    phase: "post-systems",
    priority: 0,
    run: () => awardProsperityReadinessMilestones(tx, content),
  });
  runInstrumented(instrumentation, {
    systemId: "score.finalise-ended-run",
    phase: "post-systems",
    priority: 1,
    run: () => finaliseEndedRun(tx, content),
  });

  return tx.commit({ description: `tick ${String(state.run.tick)}` });
}
