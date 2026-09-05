import type { ReactElement } from "react";

import { formatTeraflops, formatValuation, type GameView } from "@neolab/sim/public";

import type { MarketAllocationPreview } from "../compute/market-allocation-preview.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";

function compactMoney(millions: number): string {
  const absolute = Math.abs(millions);
  if (absolute >= 1) return formatValuation(millions);
  if (absolute > 0) {
    const thousands = absolute * 1_000;
    if (thousands < 1) return `${millions < 0 ? "−" : ""}<$1k`;
    const precision = thousands >= 100 ? 0 : thousands >= 10 ? 1 : 2;
    return `${millions < 0 ? "−" : ""}$${thousands.toFixed(precision)}k`;
  }
  return "$0";
}

function formatAppealFormula(segment: GameView["market"]["segments"][number]): string {
  const weightedFactors = [
    ["Government Trust", segment.appeal.weights.governmentTrust],
    ["Capability", segment.appeal.weights.capability],
    ["Product quality", segment.appeal.weights.productQuality],
    ["Reliability", segment.appeal.weights.reliability],
  ] as const;
  return `${segment.displayName}: ${weightedFactors
    .filter(([, weight]) => weight > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([label, weight]) => `${label} ${String(Math.round(weight * 100))}%`)
    .join(" · ")}.`;
}

export function MarketPanel({
  view,
  allocationPreview,
}: {
  readonly view: GameView;
  readonly allocationPreview?: MarketAllocationPreview | undefined;
}): ReactElement {
  const previewSegments = new Map(
    allocationPreview?.segments.map((segment) => [segment.segmentId, segment]),
  );
  const requestedTeraflops =
    allocationPreview?.requestedTeraflops ?? view.market.requestedTeraflops;
  const deliveredTeraflops =
    allocationPreview?.deliveredTeraflops ?? view.market.deliveredTeraflops;
  const servingCapacityTeraflops =
    allocationPreview?.servingCapacityTeraflops ?? view.market.servingCapacityTeraflops;
  const projectedRevenueMillionsPerCycle =
    allocationPreview?.projectedRevenueMillionsPerCycle ??
    view.market.projectedRevenueMillionsPerCycle;
  const projectedServingAuraPerCycle =
    allocationPreview?.projectedServingAuraPerCycle ??
    view.market.projectedServingAuraPerCycle;
  const projectedServingFulfilment =
    allocationPreview?.projectedServingFulfilment ??
    view.market.projectedServingFulfilment;
  const fulfilment =
    requestedTeraflops === 0 ? 0 : deliveredTeraflops / requestedTeraflops;
  const marketShareExplanation = [
    "Each customer group compares your deployed model with rival products.",
    `Headline weighting: ${view.market.segments
      .map(
        (segment) =>
          `${segment.displayName} ${String(Math.round(segment.headlineWeightPercentage))}%`,
      )
      .join(" · ")}.`,
    ...view.market.segments.map(formatAppealFormula),
    view.market.segments.some((segment) => segment.appeal.weights.governmentTrust > 0)
      ? "Government Trust also unlocks Government demand at 45."
      : "",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
  return (
    <section className="rail-panel" aria-labelledby="market-title">
      <header className="panel-heading compact">
        <div>
          <p className="eyebrow">PUBLIC MODEL</p>
          <h2 id="market-title">Market demand</h2>
        </div>
        <div className="panel-heading-tools market-share-heading">
          <span>Market share {view.market.marketSharePercentage.toFixed(1)}%</span>
          <MechanicHelp label="Market share breakdown">
            {marketShareExplanation}
          </MechanicHelp>
        </div>
      </header>
      <div className="market-compute-summary">
        <article>
          <span>Requested inference compute</span>
          <strong>{formatTeraflops(view.market.requestedTeraflops)}</strong>
        </article>
        <article>
          <span>Allocated serving capacity</span>
          <strong>{formatTeraflops(servingCapacityTeraflops)}</strong>
        </article>
        <article className="revenue">
          <span>Projected revenue · four weeks</span>
          <strong>{compactMoney(projectedRevenueMillionsPerCycle)}</strong>
        </article>
        <article className="aura">
          <span>Projected cycle fulfilment</span>
          <strong>
            {(projectedServingFulfilment * 100).toFixed(0)}% →{" "}
            {projectedServingAuraPerCycle > 0
              ? `+${String(projectedServingAuraPerCycle)} Aura`
              : "0 Aura"}
          </strong>
        </article>
      </div>
      {requestedTeraflops > 0 ? (
        <>
          <div className="demand-meter">
            <i
              style={{
                width: `${String(Math.min(100, fulfilment * 100))}%`,
              }}
            />
          </div>
          <p className="market-summary">
            Serving now: <strong>{(fulfilment * 100).toFixed(0)}%</strong>
          </p>
        </>
      ) : (
        <p className="market-summary">No active customer demand</p>
      )}
      <div className="segment-list">
        {view.market.segments.map((segment) => {
          const preview = previewSegments.get(segment.segmentId);
          const segmentDeliveredTeraflops =
            preview?.deliveredTeraflops ?? segment.deliveredTeraflops;
          const segmentProjectedRevenueMillionsPerCycle =
            preview?.projectedRevenueMillionsPerCycle ??
            segment.projectedRevenueMillionsPerCycle;
          const segmentFulfilment =
            segment.requestedTeraflops <= 0
              ? 0
              : Math.min(1, segmentDeliveredTeraflops / segment.requestedTeraflops);
          return (
            <div key={segment.segmentId} className={!segment.unlocked ? "locked" : ""}>
              <span>
                {segment.displayName}
                <small>{segment.marketSharePercentage.toFixed(1)}% market share</small>
              </span>
              <strong>
                {segment.unlocked
                  ? compactMoney(segmentProjectedRevenueMillionsPerCycle)
                  : "LOCKED"}
                <small>
                  {segment.unlocked
                    ? `${segment.satisfaction.toFixed(0)} satisfaction`
                    : segment.lockReason}
                </small>
              </strong>
              {segment.unlocked ? (
                <small className="segment-delivery">
                  {segment.requestedTeraflops > 0
                    ? `${(segmentFulfilment * 100).toFixed(0)}% served · ${formatTeraflops(segmentDeliveredTeraflops)} of ${formatTeraflops(segment.requestedTeraflops)}`
                    : "No current demand"}
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
