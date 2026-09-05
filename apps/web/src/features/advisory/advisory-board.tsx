import type { ReactElement } from "react";

import { formatTeraflops, formatValuation, type GameView } from "@neolab/sim/public";

export type AdvisoryDestination =
  | "compute"
  | "facilities"
  | "research"
  | "models"
  | "evaluations"
  | "people"
  | "world"
  | "fundraising"
  | "buy-compute"
  | "resume"
  | "crisis";

interface AdvisoryRecommendation {
  readonly id: string;
  readonly score: number;
  readonly adviser: "CHIEF SCIENTIST" | "SAFETY CHAIR" | "CFO" | "OPERATIONS";
  readonly title: string;
  readonly reason: string;
  readonly actionLabel: string;
  readonly destination: AdvisoryDestination;
  readonly urgency: "now" | "next" | "watch";
}

interface AdvisoryBoardProps {
  readonly view: GameView;
  readonly paused: boolean;
  readonly onNavigate: (destination: AdvisoryDestination) => void;
}

function projectIsRunning(
  view: GameView,
  kind: "training" | "evaluation" | "productisation" | "fundraising" | "construction",
): boolean {
  return view.facilities.projects.some(
    (project) =>
      project.kind === kind &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
}

function currentModel(view: GameView): GameView["models"]["cards"][number] | undefined {
  return (
    view.models.cards.find((model) => model.modelId === view.models.currentModelId) ??
    view.models.cards.at(-1)
  );
}

function modelHasProductisation(
  model: GameView["models"]["cards"][number] | undefined,
): boolean {
  return (
    model !== undefined &&
    Object.values(model.deployment.productisationRuns).some((runs) => runs > 0)
  );
}

function activeAnomalyCount(
  model: GameView["models"]["cards"][number] | undefined,
): number {
  return (
    model?.anomalies.filter(
      (anomaly) =>
        anomaly.status === "unresolved" ||
        anomaly.status === "investigating" ||
        anomaly.status === "inconclusive" ||
        anomaly.status === "confirmed" ||
        anomaly.status === "mitigating",
    ).length ?? 0
  );
}

/**
 * A deterministic, state-aware tutorial policy. It only recommends destinations that
 * are presently useful; the player still makes every consequential choice.
 */
export function buildAdvisoryRecommendations(
  view: GameView,
  paused: boolean,
): readonly AdvisoryRecommendation[] {
  const recommendations: AdvisoryRecommendation[] = [];
  const model = currentModel(view);
  const hasProductisation = modelHasProductisation(model);
  const trainingRunning = projectIsRunning(view, "training");
  const productisationRunning = projectIsRunning(view, "productisation");
  const evaluationRunning = projectIsRunning(view, "evaluation");
  const fundraisingRunning = projectIsRunning(view, "fundraising");
  const constructionRunning = projectIsRunning(view, "construction");
  const hasMajorProjectSlot = view.facilities.capacity.availableMajorProjectSlots > 0;
  const availableCampaign = view.fundraising.campaigns.find(
    (campaign) => campaign.available,
  );
  const availableOffer = view.fundraising.offers
    .filter((offer) => offer.status === "available")
    .sort((left, right) => left.expiresInWeeks - right.expiresInWeeks)[0];
  const availableFacility = view.facilities.catalogue.find(
    (facility) =>
      facility.available &&
      !facility.completed &&
      !facility.building &&
      facility.cashCostMillions <= view.finance.balanceMillions,
  );
  const recruitableCandidate = view.people.market.candidates.find(
    (candidate) => candidate.listedTerms.blockers.length === 0,
  );
  const unresolvedAnomalies = activeAnomalyCount(model);
  const safetyShareOfResearch =
    view.compute.allocation.research.physicalGpusPerWeek <= 0
      ? 0
      : view.compute.allocation.safety.physicalGpusPerWeek /
        view.compute.allocation.research.physicalGpusPerWeek;

  if (view.endgame.active) {
    recommendations.push({
      id: "deployment-crisis",
      score: 120,
      adviser: "SAFETY CHAIR",
      title: "The Deployment Crisis needs the room",
      reason:
        "The normal operating plan is now secondary. Review the candidate, evidence, access, and crisis projects before time advances.",
      actionLabel: "Open crisis controls",
      destination: "crisis",
      urgency: "now",
    });
  }

  if (view.research.pendingPublicationPaperIds.length > 0) {
    recommendations.push({
      id: "publish-paper",
      score: 115,
      adviser: "CHIEF SCIENTIST",
      title: "A paper is waiting for a publication decision",
      reason:
        "Publishing earns Aura and score but shares every scientific effect immediately. Secrecy keeps those effects inside your lab and earns no publication prestige.",
      actionLabel: "Review the paper",
      destination: "research",
      urgency: "now",
    });
  }

  if (availableOffer !== undefined) {
    recommendations.push({
      id: "funding-offer",
      score: 112 + Math.max(0, 4 - availableOffer.expiresInWeeks),
      adviser: "CFO",
      title: `${formatValuation(availableOffer.cashMillions)} funding offer needs an answer`,
      reason: `It expires in ${String(availableOffer.expiresInWeeks)} week${availableOffer.expiresInWeeks === 1 ? "" : "s"}. Review its conditions before accepting the largest number in the room.`,
      actionLabel: "Review funding offer",
      destination: "fundraising",
      urgency: "now",
    });
  } else if (
    !fundraisingRunning &&
    availableCampaign !== undefined &&
    view.finance.runway.band !== "healthy"
  ) {
    recommendations.push({
      id: "fundraise",
      score: view.finance.runway.band === "critical" ? 110 : 94,
      adviser: "CFO",
      title:
        view.finance.runway.band === "critical"
          ? "Start fundraising before the runway becomes a crater"
          : "Open a fundraising process",
      reason: `${view.finance.runway.explanation} ${availableCampaign.displayName} is feasible now and costs ${String(availableCampaign.auraCost)} Aura.`,
      actionLabel: "Open fundraising",
      destination: "fundraising",
      urgency: view.finance.runway.band === "critical" ? "now" : "next",
    });
  }

  if (model === undefined && !trainingRunning) {
    recommendations.push({
      id: "first-model",
      score: 108,
      adviser: "CHIEF SCIENTIST",
      title: `Train the first ${view.identity.aiName} model`,
      reason:
        "The lab has researchers and GPUs, but no AI model. Customer demand and model launches remain impossible until a training run finishes.",
      actionLabel: hasMajorProjectSlot ? "Configure training" : "Queue training",
      destination: "models",
      urgency: "now",
    });
  } else if (model !== undefined && !hasProductisation && !productisationRunning) {
    recommendations.push({
      id: "productise-model",
      score: hasMajorProjectSlot ? 105 : 76,
      adviser: "OPERATIONS",
      title: `Turn ${model.displayName} into a usable product`,
      reason: hasMajorProjectSlot
        ? "Training produced an internal model, not a customer service. Choose a launch plan."
        : "Training produced an internal model, not a customer service. You can configure its launch now and add it to the waiting queue.",
      actionLabel: "Configure launch",
      destination: "models",
      urgency: hasMajorProjectSlot ? "now" : "watch",
    });
  } else if (
    model !== undefined &&
    hasProductisation &&
    model.deployment.policy === "internal-only"
  ) {
    recommendations.push({
      id: "deploy-model",
      score: 103,
      adviser: "OPERATIONS",
      title: `Decide how ${model.displayName} leaves the building`,
      reason:
        "The model is product-ready but internal-only. A managed deployment can create demand and revenue; broader access also raises incident and regulatory risk.",
      actionLabel: "Choose deployment policy",
      destination: "models",
      urgency: "now",
    });
  }

  if (model !== undefined && unresolvedAnomalies > 0 && !evaluationRunning) {
    recommendations.push({
      id: "investigate-anomalies",
      score: 101,
      adviser: "SAFETY CHAIR",
      title: `${String(unresolvedAnomalies)} model anomal${unresolvedAnomalies === 1 ? "y needs" : "ies need"} scrutiny`,
      reason:
        "Unresolved warning signals make deployment evidence weaker. Run or review evaluations before treating absence of proof as proof of absence.",
      actionLabel: "Open evaluations",
      destination: "evaluations",
      urgency: "now",
    });
  }

  // Demand expressed on the same whole-fleet scale as the player's ceiling, so
  // the two can be compared without one of them shifting under reservations.
  const servingDemandFleetShareBasisPoints =
    view.market.servingDemandCap.fleetPhysicalGpus <= 0
      ? 0
      : Math.round(
          (view.market.servingDemandCap.maximumPhysicalGpus * 10_000) /
            view.market.servingDemandCap.fleetPhysicalGpus,
        );
  if (
    view.models.commercialModelId !== undefined &&
    servingDemandFleetShareBasisPoints > 0 &&
    view.compute.allocation.serving.basisPoints < servingDemandFleetShareBasisPoints
  ) {
    recommendations.push({
      id: "serve-demand",
      score: view.market.unmetTeraflops > 0 ? 100 : 86,
      adviser: "CFO",
      title:
        view.market.unmetTeraflops > 0
          ? "Customers are asking for more compute"
          : "The deployed model can support serving revenue",
      reason: `Customers currently request ${formatTeraflops(view.market.requestedTeraflops)} of inference compute. Serving earns cash but diverts the same effective compute from research.`,
      actionLabel: "Review GPU allocation",
      destination: "compute",
      urgency: view.market.unmetTeraflops > 0 ? "now" : "next",
    });
  }

  if (
    view.compute.allocation.research.physicalGpusPerWeek > 0 &&
    safetyShareOfResearch < 0.2
  ) {
    recommendations.push({
      id: "safety-allocation",
      score: 83,
      adviser: "SAFETY CHAIR",
      title: "Safety research is receiving less than one GPU in five",
      reason:
        "Capabilities may advance faster than the evidence and controls needed to use them. The correct ratio is uncertain; zero is unusually confident.",
      actionLabel: "Review research allocation",
      destination: "compute",
      urgency: "next",
    });
  }

  if (
    view.politics.pressureBand === "licensing" ||
    view.politics.pressureBand === "restriction" ||
    view.politics.pressureBand === "crisis"
  ) {
    recommendations.push({
      id: "political-pressure",
      score: view.politics.pressureBand === "crisis" ? 100 : 88,
      adviser: "OPERATIONS",
      title: `Government pressure has reached ${view.politics.pressureBand}`,
      reason: view.politics.pressureExplanation,
      actionLabel: "Review government relations",
      destination: "world",
      urgency: view.politics.pressureBand === "crisis" ? "now" : "next",
    });
  }

  if (availableFacility !== undefined && !constructionRunning) {
    recommendations.push({
      id: `facility:${availableFacility.definitionId}`,
      score: 69,
      adviser: "OPERATIONS",
      title: `The lab can build ${availableFacility.displayName}`,
      reason: `${availableFacility.summary} It costs ${formatValuation(availableFacility.cashCostMillions)} and takes ${String(availableFacility.durationWeeks)} weeks.`,
      actionLabel: "Review facilities",
      destination: "facilities",
      urgency: "next",
    });
  }

  const unassignedResearcher = view.people.roster.find(
    (researcher) => researcher.assignment === undefined,
  );
  if (unassignedResearcher !== undefined) {
    recommendations.push({
      id: `assign-researcher:${unassignedResearcher.researcherId}`,
      score: 107,
      adviser: "CHIEF SCIENTIST",
      title: `Assign ${unassignedResearcher.displayName} as a programme lead`,
      reason: `${unassignedResearcher.displayName} is on payroll but is not leading a research programme, so their programme-lead contribution is inactive. Choose a capability or safety programme.`,
      actionLabel: "Assign researcher",
      destination: "people",
      urgency: "now",
    });
  }

  if (view.people.slots.vacant > 0 && recruitableCandidate !== undefined) {
    recommendations.push({
      id: "recruit-researcher",
      score: 65,
      adviser: "CHIEF SCIENTIST",
      title: `${recruitableCandidate.displayName} is available`,
      reason: `A star-researcher slot is vacant. The listed terms are ${formatValuation(recruitableCandidate.listedTerms.signingCashMillions)} signing, ${formatValuation(recruitableCandidate.listedTerms.salaryMillionsPerCycle)} per cycle, and ${String(recruitableCandidate.listedTerms.auraCost)} Aura.`,
      actionLabel: "Open talent market",
      destination: "people",
      urgency: "next",
    });
  }

  if (
    view.compute.allocatablePhysicalGpus < 2_000 &&
    view.compute.pendingDeliveries.length === 0 &&
    view.finance.balanceMillions > 4
  ) {
    recommendations.push({
      id: "buy-compute",
      score: 61,
      adviser: "OPERATIONS",
      title: "Unreserved GPU headroom is getting thin",
      reason:
        "A new training run or facility could consume the remaining flexible fleet. Compare owned, leased, and cloud capacity before the bottleneck becomes urgent.",
      actionLabel: "Open GPU market",
      destination: "buy-compute",
      urgency: "watch",
    });
  }

  if (trainingRunning || productisationRunning || fundraisingRunning) {
    const runningLabel = trainingRunning
      ? "model training"
      : productisationRunning
        ? "productisation"
        : "fundraising";
    recommendations.push({
      id: "advance-project",
      score: paused ? 58 : 38,
      adviser: "OPERATIONS",
      title: paused
        ? `Resume time to advance ${runningLabel}`
        : `${runningLabel} is moving`,
      reason: paused
        ? "Projects update on simulation weeks. Nothing progresses while the clock is paused."
        : "The project is already underway. Use this time to adjust research, recruit, or review the next decision.",
      actionLabel: paused ? "Resume time" : "Review active projects",
      destination: paused
        ? "resume"
        : trainingRunning || productisationRunning
          ? "models"
          : "fundraising",
      urgency: "watch",
    });
  }

  recommendations.push({
    id: "research-programmes",
    score: 45,
    adviser: "CHIEF SCIENTIST",
    title: "Review the research portfolio",
    reason: "Check whether the current GPU allocation still matches the lab's strategy.",
    actionLabel: "Open research",
    destination: "research",
    urgency: "watch",
  });

  recommendations.push({
    id: "run-clock",
    score: paused ? 34 : 20,
    adviser: "OPERATIONS",
    title: paused ? "The simulation is paused" : "Let the lab operate",
    reason: paused
      ? "Research, demand, projects, rivals, and events update only when a simulation week passes."
      : "No immediate intervention is required. The board reluctantly authorises one week of people doing their jobs.",
    actionLabel: paused ? "Resume at current speed" : "Review compute controls",
    destination: paused ? "resume" : "compute",
    urgency: "watch",
  });

  const usedAdvisers = new Set<AdvisoryRecommendation["adviser"]>();
  const selected: AdvisoryRecommendation[] = [];
  for (const recommendation of recommendations.sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  )) {
    if (
      selected.some(
        (existing) =>
          existing.destination === recommendation.destination &&
          existing.urgency === recommendation.urgency,
      )
    ) {
      continue;
    }
    if (usedAdvisers.has(recommendation.adviser) && selected.length < 2) continue;
    selected.push(recommendation);
    usedAdvisers.add(recommendation.adviser);
    if (selected.length === 3) break;
  }
  return selected;
}

export function AdvisoryBoard({
  view,
  paused,
  onNavigate,
}: AdvisoryBoardProps): ReactElement {
  const recommendations = buildAdvisoryRecommendations(view, paused);
  return (
    <section className="advisory-board" aria-labelledby="advisory-board-title">
      <header>
        <div>
          <p className="eyebrow">STRATEGIC ADVISORY BOARD // NON-BINDING</p>
          <h2 id="advisory-board-title">The board has suggestions</h2>
        </div>
        <span>Reconsiders every week</span>
      </header>
      <div className="advisory-board-layout">
        <div className="advisory-recommendations">
          {recommendations.map((recommendation, index) => (
            <article
              className={`advisory-recommendation urgency-${recommendation.urgency}`}
              key={recommendation.id}
            >
              <header>
                <span>{recommendation.adviser}</span>
                <small>
                  {index === 0
                    ? recommendation.urgency === "now"
                      ? "DO THIS NOW"
                      : "BEST NEXT MOVE"
                    : recommendation.urgency === "watch"
                      ? "KEEP AN EYE ON"
                      : "ALSO USEFUL"}
                </small>
              </header>
              <h3>{recommendation.title}</h3>
              <p>{recommendation.reason}</p>
              <button
                className={index === 0 ? "primary" : "secondary"}
                type="button"
                onClick={() => onNavigate(recommendation.destination)}
              >
                {recommendation.actionLabel} →
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
