import { useCallback, useState, type ReactElement } from "react";

import { formatTeraflops, type GameView } from "@neolab/sim/public";

import type { BrowserContent } from "../../app/runtime-provider.tsx";
import { MarketPanel } from "../market/market-panel.tsx";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { AllocationPanel } from "./allocation-panel.tsx";
import type { MarketAllocationPreview } from "./market-allocation-preview.ts";

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function compactDecimal(value: number, places = 3): string {
  return String(Number(value.toFixed(places)));
}

function signedPercentage(value: number): string {
  if (Math.abs(value) < 0.05) return "No net change";
  return `${value > 0 ? "+" : "−"}${compactDecimal(Math.abs(value), 1)}%`;
}

export function ComputeWorkspace({
  content: _content,
  runtime,
  view,
  onBuyGpus,
  onOpenModels,
}: {
  readonly content: BrowserContent;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onBuyGpus: () => void;
  readonly onOpenModels: () => void;
}): ReactElement {
  const [marketPreview, setMarketPreview] = useState<MarketAllocationPreview>();
  const handleMarketPreviewChange = useCallback(
    (preview: MarketAllocationPreview | undefined) => setMarketPreview(preview),
    [],
  );
  const throughputDelta = (view.compute.throughputMultiplier - 1) * 100;
  const throughputTone =
    throughputDelta > 0.05
      ? "positive"
      : throughputDelta < -0.05
        ? "negative"
        : "neutral";
  return (
    <div className="compute-workspace">
      <section className="console-panel compute-command" aria-labelledby="compute-title">
        <header className="panel-heading">
          <div>
            <p className="eyebrow">COMPUTE DIRECTORATE // FLEET & PROCUREMENT</p>
            <h2 id="compute-title">GPU fleet command</h2>
          </div>
          <button
            className="primary"
            type="button"
            data-tutorial-target="open-gpu-procurement"
            onClick={onBuyGpus}
          >
            Buy or sell GPUs
          </button>
        </header>
        <div className="compute-fleet-summary">
          <article>
            <span>Effective fleet compute</span>
            <strong>{formatTeraflops(view.compute.totalTeraflops)}</strong>
            <small>
              {view.compute.reservedPhysicalGpus === 0
                ? "All compute currently available"
                : `${formatTeraflops(view.compute.unreservedTeraflops)} available · ${number(view.compute.reservedPhysicalGpus)} GPUs project-reserved`}
            </small>
          </article>
          <article className={`throughput-${throughputTone}`}>
            <span>Throughput multiplier</span>
            <strong>×{compactDecimal(view.compute.throughputMultiplier)}</strong>
            <small>
              {view.compute.throughputEffects.length === 0
                ? "No active effects"
                : `${String(view.compute.throughputEffects.length)} active ${view.compute.throughputEffects.length === 1 ? "effect" : "effects"} · ${signedPercentage(throughputDelta)}`}
            </small>
          </article>
          <article>
            <span>Physical fleet</span>
            <strong>{number(view.compute.totalPhysicalGpus)} GPUs</strong>
            <small>
              {view.compute.onlinePhysicalGpus === view.compute.totalPhysicalGpus &&
              view.compute.allocatablePhysicalGpus === view.compute.totalPhysicalGpus
                ? "All online and schedulable"
                : `${number(view.compute.onlinePhysicalGpus)} online · ${number(view.compute.allocatablePhysicalGpus)} schedulable`}
            </small>
          </article>
        </div>
        {view.compute.throughputEffects.length === 0 ? null : (
          <details className="compute-throughput-board">
            <summary>
              <span>
                <b>Throughput effects</b>
                <small>
                  {formatTeraflops(view.compute.ratedTeraflops)} hardware ×
                  {compactDecimal(view.compute.throughputMultiplier)} ={" "}
                  {formatTeraflops(view.compute.totalTeraflops)} effective
                </small>
              </span>
              <strong className={throughputTone === "negative" ? "negative" : ""}>
                {signedPercentage(throughputDelta)} ·{" "}
                {view.compute.throughputEffects.length} active
              </strong>
            </summary>
            <ul>
              {view.compute.throughputEffects.map((effect) => (
                <li key={effect.modifierId}>
                  <span>
                    <strong>{effect.sourceLabel}</strong>
                    <small>
                      {effect.sourceKind}
                      {effect.remainingWeeks === undefined
                        ? ""
                        : ` · ${String(effect.remainingWeeks)} weeks remaining`}
                    </small>
                  </span>
                  <b className={effect.effectLabel.includes("−") ? "negative" : ""}>
                    {effect.effectLabel}
                  </b>
                  <details>
                    <summary>How it applies</summary>
                    <p>{effect.explanation}</p>
                  </details>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="compute-generation-board">
          <h3>Installed fleet</h3>
          <div>
            {view.compute.generationMix.length === 0 ? (
              <p className="empty-state">No GPU hardware is currently online.</p>
            ) : (
              view.compute.generationMix.map((generation) => (
                <span className="generation-chip" key={generation.generationId}>
                  <strong>{generation.displayName}</strong>
                  <span>{number(generation.physicalGpus)}</span>
                  {generation.historicity === "fictional" ? (
                    <span className="generation-fictional">FICTIONAL</span>
                  ) : null}
                  {generation.onlinePhysicalGpus < generation.physicalGpus ? (
                    <span className="generation-offline">
                      {number(generation.physicalGpus - generation.onlinePhysicalGpus)}{" "}
                      offline
                    </span>
                  ) : null}
                </span>
              ))
            )}
          </div>
        </div>
        {view.compute.pendingDeliveries.length === 0 ? null : (
          <div className="compute-delivery-board">
            <h3>Hardware in transit</h3>
            {view.compute.pendingDeliveries.map((delivery) => (
              <article key={delivery.lotId}>
                <strong>{delivery.displayName}</strong>
                <span>{number(delivery.physicalGpus)} GPUs</span>
                <small>{delivery.label}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <div
        className="compute-commercial-loop"
        aria-label="Customer demand and GPU serving controls"
      >
        <AllocationPanel
          view={view}
          runtime={runtime}
          onOpenModels={onOpenModels}
          onMarketPreviewChange={handleMarketPreviewChange}
        />
        <aside className="compute-market-context">
          <div className="compute-market-coupling">
            <strong>Serving GPUs ↔ customer demand</strong>
          </div>
          <MarketPanel view={view} allocationPreview={marketPreview} />
        </aside>
      </div>
    </div>
  );
}
