import { useEffect, useState, type ReactElement } from "react";

import { formatTeraflops, formatValuation, type GameView } from "@neolab/sim/public";

import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import type { MarketAllocationPreview } from "./market-allocation-preview.ts";
import {
  ResearchAllocationControl,
  useResearchAllocation,
} from "./research-allocation-control.tsx";

function number(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function money(value: number): string {
  return `${value < 0 ? "" : "+"}${formatValuation(value)}`;
}

function percentage(basisPoints: number): string {
  const value = basisPoints / 100;
  const precision = Number.isInteger(value) ? 0 : value < 10 ? 2 : 1;
  return `${value.toFixed(precision)}%`;
}

interface AllocationPanelProps {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly onOpenModels: () => void;
  readonly onMarketPreviewChange: (preview: MarketAllocationPreview | undefined) => void;
}

interface DemandBlocker {
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
}

export function servingModelLabel(view: GameView): string {
  const servingModel = view.models.cards.find(
    (model) => model.modelId === view.models.commercialModelId,
  );
  return servingModel === undefined
    ? "No customer-facing model deployed"
    : `Serving ${servingModel.displayName} · ${servingModel.deployment.displayName}`;
}

function progressiveResearchAvailable(view: GameView): boolean {
  return (
    view.meta.labMaturity === undefined ||
    view.meta.labMaturity.features.includes("research")
  );
}

function demandBlocker(view: GameView): DemandBlocker {
  const currentModel = view.models.cards.find(
    (model) => model.modelId === view.models.currentModelId,
  );
  const hasProductisation =
    currentModel !== undefined &&
    Object.values(currentModel.deployment.productisationRuns).some((runs) => runs > 0);
  const liveProductisation =
    currentModel === undefined
      ? undefined
      : view.facilities.projects.find(
          (project) =>
            project.productisation?.modelId === currentModel.modelId &&
            (project.status === "queued" ||
              project.status === "active" ||
              project.status === "paused"),
        );

  if (currentModel === undefined) {
    return {
      title: "Serving unavailable",
      detail: "Launch a managed model first.",
      actionLabel: "Open Models",
    };
  }
  if (currentModel.deployment.policy === "weights-release") {
    return {
      title: "Weights release creates no serving demand",
      detail:
        "Public weights run on customer hardware. Launch a managed model for revenue.",
      actionLabel: "Open model portfolio",
    };
  }
  if (!hasProductisation) {
    if (liveProductisation !== undefined) {
      const elapsedWeeks =
        liveProductisation.startedAtTick === undefined
          ? 0
          : Math.min(
              liveProductisation.expectedDurationWeeks,
              Math.max(0, view.meta.tick - liveProductisation.startedAtTick),
            );
      return {
        title:
          liveProductisation.status === "queued"
            ? `${currentModel.displayName} launch preparation is queued`
            : liveProductisation.status === "paused"
              ? `${currentModel.displayName} launch preparation is paused`
              : `${currentModel.displayName} launch preparation is in progress`,
        detail:
          liveProductisation.status === "queued"
            ? "Waiting for a major-project slot."
            : liveProductisation.status === "paused"
              ? `Paused after ${String(elapsedWeeks)} week${elapsedWeeks === 1 ? "" : "s"}.`
              : `${String(elapsedWeeks)} of ${String(liveProductisation.expectedDurationWeeks)} weeks complete.`,
        actionLabel: "Review release engineering",
      };
    }
    return {
      title: `${currentModel.displayName} is trained, but not launched`,
      detail: "Prepare it for a managed launch.",
      actionLabel: "Configure launch",
    };
  }
  if (currentModel.deployment.policy === "internal-only") {
    return {
      title: `${currentModel.displayName} is product-ready, but still internal`,
      detail: "Choose a managed deployment policy.",
      actionLabel: "Choose deployment",
    };
  }
  if (view.models.commercialModelId === undefined) {
    return {
      title: "Customer deployment is incomplete",
      detail: "Review its deployment policy.",
      actionLabel: "Review deployment",
    };
  }
  return {
    title: "Deployment is live; customer demand is ready",
    detail: "Allocate GPUs to serve it.",
    actionLabel: "Review deployment",
  };
}

export function AllocationPanel({
  view,
  runtime,
  onOpenModels,
  onMarketPreviewChange,
}: AllocationPanelProps): ReactElement {
  const committedServing =
    view.compute.queuedAllocation?.servingFleetShareBasisPoints ??
    view.compute.allocation.serving.basisPoints;
  const servingDemandCap = view.market.servingDemandCap;
  const blocker = demandBlocker(view);
  const [serving, setServing] = useState(committedServing);

  // The ceiling is the player's alone: nothing clamps it back down, because
  // asking for more than demand can absorb simply leaves the surplus to
  // research rather than wasting it on serving.
  useEffect(() => setServing(committedServing), [committedServing]);
  const researchAllocation = useResearchAllocation({
    runtime,
    view,
    servingBasisPoints: serving,
  });
  const { capabilityBasisPoints: capabilities, consequences, plan } = researchAllocation;
  useEffect(() => {
    onMarketPreviewChange(consequences);
  }, [consequences, onMarketPreviewChange]);
  const plannedServingTeraflops =
    consequences?.deliveredTeraflops ?? view.market.deliveredTeraflops;
  const generationMixDescription = view.compute.generationMix
    .map((generation) => generation.label)
    .join(", ");
  const totalScheduledPhysicalGpus =
    view.compute.reservedPhysicalGpus + view.compute.allocatablePhysicalGpus;
  const shareOfFleet = (physicalGpus: number): number =>
    totalScheduledPhysicalGpus <= 0
      ? 0
      : (physicalGpus / totalScheduledPhysicalGpus) * 100;
  // Where demand sits on the same fleet-denominated track as the slider, so the
  // handle and the marker can be read against each other directly.
  const demandMarkerBasisPoints =
    servingDemandCap.fleetPhysicalGpus <= 0
      ? 0
      : Math.round(
          (servingDemandCap.maximumPhysicalGpus * 10_000) /
            servingDemandCap.fleetPhysicalGpus,
        );
  // The ceiling in hardware terms, which is what a screen reader needs: a
  // percentage alone says nothing about how many GPUs it commits.
  const servingCeilingPhysicalGpus = Math.round(
    (totalScheduledPhysicalGpus * serving) / 10_000,
  );
  const demandCoverage =
    demandMarkerBasisPoints === 0
      ? 0
      : Math.min(100, (serving / demandMarkerBasisPoints) * 100);

  function setServingAndCommit(nextServing: number): void {
    setServing(nextServing);
    researchAllocation.commit(capabilities, nextServing);
  }

  return (
    <section
      className="console-panel allocation-panel"
      aria-labelledby="allocation-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">COMPUTE SCHEDULER</p>
          <h2 id="allocation-title">GPU allocation</h2>
        </div>
        <div className="panel-heading-tools">
          <MechanicHelp label="GPU allocation">
            Serving uses free GPUs up to customer demand. Everything left goes to R&amp;D;
            the second slider divides that compute between capability and safety.
          </MechanicHelp>
          <span className="uncertainty-tag">PLAN</span>
        </div>
      </header>

      <p id="gpu-generation-mix-description" className="sr-only">
        GPU fleet generation mix: {generationMixDescription || "no GPUs online"}.
      </p>

      {view.compute.reservedPhysicalGpus > 0 ? (
        <div className="gpu-reservation-summary" role="status">
          <div className="gpu-reservation-heading">
            <div>
              <span className="gpu-reservation-kicker">PROJECT COMPUTE — LOCKED</span>
              <strong>
                {number(view.compute.reservedPhysicalGpus)} GPUs reserved ·{" "}
                {number(view.compute.allocatablePhysicalGpus)} left to schedule
              </strong>
            </div>
            <span>
              {shareOfFleet(view.compute.reservedPhysicalGpus).toFixed(1)}% of fleet
            </span>
          </div>
          <div className="gpu-reservation-list">
            {view.compute.reservations.map((reservation) => (
              <div key={reservation.projectId}>
                <span>
                  <strong>{reservation.displayName}</strong>
                  <small>{reservation.statusLabel}</small>
                </span>
                <b>{number(reservation.reservedPhysicalGpus)} GPUs</b>
              </div>
            ))}
          </div>
          <small>
            {number(view.compute.allocatablePhysicalGpus)} GPUs remain schedulable.
          </small>
        </div>
      ) : null}

      <div className="slider-control serving-slider">
        <span>
          <label htmlFor="customer-serving-allocation">
            <strong>Customer serving</strong>
            <small className="serving-model-label">{servingModelLabel(view)}</small>
          </label>
          <output>
            Up to {percentage(serving)} of fleet ·{" "}
            {formatTeraflops(plannedServingTeraflops)}
            {" · "}
            {demandCoverage.toFixed(0)}% of demand
          </output>
        </span>
        <input
          id="customer-serving-allocation"
          aria-label="Customer serving compute ceiling"
          aria-valuetext={`${percentage(serving)} of the GPU fleet, ${number(servingCeilingPhysicalGpus)} physical GPUs per week at most, currently delivering ${formatTeraflops(plannedServingTeraflops)} — ${demandCoverage.toFixed(0)} percent of customer demand`}
          aria-describedby="gpu-generation-mix-description serving-allocation-hint"
          type="range"
          min="0"
          max="10000"
          step="1"
          value={serving}
          onChange={(event) => setServing(event.target.valueAsNumber)}
          onPointerUp={() => researchAllocation.commit(capabilities, serving)}
          onKeyUp={(event) => {
            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key.startsWith("Arrow") ||
              event.key === "Home" ||
              event.key === "End" ||
              event.key === "PageUp" ||
              event.key === "PageDown"
            ) {
              researchAllocation.commit(capabilities, serving);
            }
          }}
          onBlur={() => {
            if (serving !== committedServing) {
              researchAllocation.commit(capabilities, serving);
            }
          }}
        />
        {demandMarkerBasisPoints > 0 ? (
          <div className="serving-range-scale" aria-hidden="true">
            <span>0 · no serving</span>
            <span>
              Demand needs {percentage(demandMarkerBasisPoints)} ·{" "}
              {number(servingDemandCap.maximumPhysicalGpus)} GPUs
            </span>
            <span>100% · whole fleet</span>
          </div>
        ) : null}
        <div className="serving-allocation-actions">
          {demandMarkerBasisPoints > 0 ? (
            <>
              <button
                className="secondary"
                type="button"
                disabled={serving === 0}
                onClick={() => setServingAndCommit(0)}
              >
                Stop serving
              </button>
              <button
                className="secondary"
                type="button"
                data-tutorial-target="serve-full-demand"
                disabled={serving >= demandMarkerBasisPoints}
                onClick={() => setServingAndCommit(demandMarkerBasisPoints)}
              >
                {serving >= demandMarkerBasisPoints
                  ? "Full demand covered"
                  : `Cover full demand · ${formatTeraflops(servingDemandCap.requestedTeraflops)}`}
              </button>
            </>
          ) : null}
        </div>
        {demandMarkerBasisPoints > 0 ? (
          <small id="serving-allocation-hint" className="automatic-serving-hint">
            {serving >= demandMarkerBasisPoints
              ? "Full current demand is covered; unused compute returns to R&D."
              : `${demandCoverage.toFixed(0)}% of current demand is covered; unused compute remains with R&D.`}
          </small>
        ) : null}
      </div>
      {demandMarkerBasisPoints === 0 ? (
        <div
          id="serving-allocation-hint"
          className="serving-demand-blocker"
          role="status"
        >
          <div>
            <strong>{blocker.title}</strong>
            <small>{blocker.detail}</small>
          </div>
          <button className="secondary" type="button" onClick={onOpenModels}>
            {blocker.actionLabel}
          </button>
        </div>
      ) : null}

      {progressiveResearchAvailable(view) ? (
        <ResearchAllocationControl
          capabilityBasisPoints={capabilities}
          capabilityTeraflops={researchAllocation.capabilityTeraflops}
          safetyTeraflops={researchAllocation.safetyTeraflops}
          isDraft={researchAllocation.isDraft}
          isPending={researchAllocation.isPending}
          message={researchAllocation.message}
          onChange={researchAllocation.setCapabilityBasisPoints}
          onCommit={(nextCapabilities) =>
            researchAllocation.commit(nextCapabilities, serving)
          }
          capabilityOnly={view.meta.labMaturity?.safetyResearchUnlocked === false}
        />
      ) : null}

      <div className="allocation-bar" aria-label="Planned whole-fleet allocation">
        {view.compute.reservedPhysicalGpus > 0 ? (
          <i
            className="reserved"
            title={`${number(view.compute.reservedPhysicalGpus)} GPUs locked by projects`}
            style={{
              width: `${String(shareOfFleet(view.compute.reservedPhysicalGpus))}%`,
            }}
          />
        ) : null}
        <i
          className="serving"
          style={{ width: `${String(shareOfFleet(plan?.servingPhysicalGpus ?? 0))}%` }}
        />
        <i
          className="capabilities"
          style={{
            width: `${String(shareOfFleet(plan?.capabilityPhysicalGpus ?? 0))}%`,
          }}
        />
        <i
          className="safety"
          style={{ width: `${String(shareOfFleet(plan?.safetyPhysicalGpus ?? 0))}%` }}
        />
      </div>
      <div className="allocation-legend">
        {view.compute.reservedPhysicalGpus > 0 ? (
          <span>
            <i className="reserved" />
            Project compute {number(view.compute.reservedPhysicalGpus)}
          </span>
        ) : null}
        <span>
          <i className="serving" />
          Serving {number(plan?.servingPhysicalGpus ?? 0)}
        </span>
        <span>
          <i className="capabilities" />
          Capabilities {number(plan?.capabilityPhysicalGpus ?? 0)}
        </span>
        <span>
          <i className="safety" />
          Safety {number(plan?.safetyPhysicalGpus ?? 0)}
        </span>
      </div>
      <p className="consequence-line" aria-live="polite">
        {consequences === undefined
          ? researchAllocation.message
          : `${money(consequences.netMillionsPerCycle)} / 4 weeks · ${formatTeraflops(consequences.deliveredTeraflops)} of ${formatTeraflops(consequences.requestedTeraflops)} demand served · ${researchAllocation.message}`}
      </p>
    </section>
  );
}
