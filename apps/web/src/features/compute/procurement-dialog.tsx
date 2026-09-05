import { useEffect, useState, type ReactElement } from "react";

import {
  formatTeraflops,
  formatValuation,
  generationTeraflopsPerGpu,
  type GameView,
} from "@neolab/sim/public";

import { buyGpusCommand, sellGpusCommand } from "../../app/command-builders.ts";
import type { BrowserContent } from "../../app/runtime-provider.tsx";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";

interface ProcurementDialogProps {
  readonly content: BrowserContent;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onClose: () => void;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatProcurementMoney(millions: number): string {
  return formatValuation(millions);
}

function parseUnits(value: string, maximum: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : undefined;
}

export function ProcurementDialog({
  content,
  runtime,
  view,
  onClose,
}: ProcurementDialogProps): ReactElement {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  // One quantity (in 1,000-GPU units) per generation row.
  // Keep the draft as text so the field can be temporarily empty while the
  // player replaces its value.
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();

  const availabilityByGeneration = new Map(
    view.compute.generationMix.map((line) => [line.generationId, line]),
  );
  const supported = view.facilities.capacity.supportedOwnedGpuCount;
  const incoming = view.compute.pendingDeliveries.reduce(
    (sum, delivery) => sum + delivery.physicalGpus,
    0,
  );
  const occupied = view.compute.totalOwnedPhysicalGpus + incoming;
  const spare = Math.max(0, supported - occupied);

  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog procurement-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-title"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">PROCUREMENT WINDOW // ALL GENERATIONS</p>
            <h2 id="purchase-title">Buy & sell GPUs</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close GPU procurement"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="procurement-capacity" role="status">
          <strong>
            Capacity: {formatCount(occupied)} / {formatCount(supported)} GPUs
          </strong>
          <span>
            {formatCount(spare)} slots free
            {incoming > 0 ? ` · ${formatCount(incoming)} in transit` : ""} ·{" "}
            {formatTeraflops(view.compute.totalTeraflops)} online
          </span>
          <div className="procurement-capacity-footer">
            <span className="procurement-sellable-total">
              {formatCount(view.compute.sellablePhysicalGpus)} GPUs sellable now
            </span>
            <MechanicHelp label="Buying and selling GPUs">
              GPUs reserved by active or queued work cannot be sold. Sales use blocks of
              1,000 and return 25% of the catalogue price.
            </MechanicHelp>
          </div>
        </div>
        <div className="procurement-list">
          {view.compute.unlockedGenerationIds.map((generationId) => {
            const generation = content.gpuGenerations[generationId];
            if (generation === undefined) return null;
            const availability = availabilityByGeneration.get(generationId);
            const owned = availability?.ownedPhysicalGpus ?? 0;
            const sellable = availability?.sellablePhysicalGpus ?? 0;
            const maximumUnits = Math.max(
              1,
              Math.floor(Math.max(spare, sellable) / 1000),
            );
            const unitDraft = unitDrafts[generationId] ?? "1";
            const rowUnits = parseUnits(unitDraft, maximumUnits);
            const buyCommand =
              rowUnits === undefined
                ? undefined
                : buyGpusCommand(view, generationId, rowUnits);
            const sellCommand =
              rowUnits === undefined
                ? undefined
                : sellGpusCommand(view, generationId, rowUnits);
            const buyValidation =
              buyCommand === undefined ? undefined : runtime.validate(buyCommand);
            const sellValidation =
              sellCommand === undefined ? undefined : runtime.validate(sellCommand);
            const perGpu = generationTeraflopsPerGpu(generation);
            return (
              <article key={generationId} className="procurement-row">
                <div className="procurement-row-title">
                  <strong>{generation.displayName}</strong>
                  <span>
                    {generation.historicity === "fictional" ? "FICTIONAL · " : ""}
                    {formatTeraflops(perGpu)} per GPU · reliability{" "}
                    {generation.reliability}
                  </span>
                  <small>
                    {formatProcurementMoney(generation.gameCostMillionsPerThousand)} per
                    1,000 ·{" "}
                    {formatProcurementMoney(
                      generation.gameOperatingCostMillionsPerThousandPerCycle,
                    )}
                    /cycle · delivery {generation.deliveryWeeks}w
                  </small>
                  <small className="procurement-row-availability">
                    Owned {formatCount(owned)} ·{" "}
                    <strong>sellable now {formatCount(sellable)}</strong>
                  </small>
                </div>
                <div className="procurement-row-controls">
                  <label>
                    <span>×1,000</span>
                    <input
                      type="number"
                      min={1}
                      max={maximumUnits}
                      step={1}
                      value={unitDraft}
                      onChange={(event) => {
                        const next = event.target.value;
                        setUnitDrafts((current) => ({
                          ...current,
                          [generationId]: next,
                        }));
                      }}
                      onBlur={() => {
                        if (rowUnits !== undefined) return;
                        setUnitDrafts((current) => ({
                          ...current,
                          [generationId]: "1",
                        }));
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    data-tutorial-target="buy-gpus"
                    disabled={buyValidation?.ok !== true}
                    title={
                      rowUnits === undefined
                        ? `Enter a whole number from 1 to ${formatCount(maximumUnits)}.`
                        : buyValidation?.ok === true
                          ? undefined
                          : buyValidation?.errors
                              .map((error) => error.message)
                              .join(" · ")
                    }
                    onClick={() => {
                      if (buyCommand === undefined || rowUnits === undefined) return;
                      runtime.dispatch(buyCommand);
                      setNotice(
                        `${formatCount(rowUnits * 1000)} ${generation.displayName} ordered — arrives in ${String(generation.deliveryWeeks)} weeks.`,
                      );
                    }}
                  >
                    Buy ·{" "}
                    {buyValidation?.ok === true && buyValidation.preview.gpuPurchaseQuote
                      ? formatProcurementMoney(
                          buyValidation.preview.gpuPurchaseQuote.upfrontCostMillions,
                        )
                      : rowUnits === undefined
                        ? "—"
                        : formatProcurementMoney(
                            Math.round(
                              rowUnits * generation.gameCostMillionsPerThousand * 100,
                            ) / 100,
                          )}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={sellValidation?.ok !== true}
                    title={
                      rowUnits === undefined
                        ? `Enter a whole number from 1 to ${formatCount(maximumUnits)}.`
                        : sellValidation?.ok === true
                          ? undefined
                          : sellValidation?.errors
                              .map((error) => error.message)
                              .join(" · ")
                    }
                    onClick={() => {
                      if (sellCommand === undefined || rowUnits === undefined) return;
                      runtime.dispatch(sellCommand);
                      setNotice(
                        `${formatCount(rowUnits * 1000)} ${generation.displayName} sold.`,
                      );
                    }}
                  >
                    Sell ·{" "}
                    {sellValidation?.ok === true && sellValidation.preview.gpuSaleQuote
                      ? `+${formatProcurementMoney(
                          sellValidation.preview.gpuSaleQuote.cashProceedsMillions,
                        )}`
                      : `25% back`}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {notice === undefined ? null : (
          <p className="procurement-notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
