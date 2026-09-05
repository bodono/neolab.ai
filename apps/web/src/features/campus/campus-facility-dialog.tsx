import type { ReactElement } from "react";

import { formatValuation, type CampusView, type GameView } from "@neolab/sim/public";

import { FacilityBenefitItem } from "../facilities/facility-benefit-item.tsx";
import { FacilityPixelIcon } from "../facilities/facility-pixel-icon.tsx";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";

type CampusFacility = CampusView["facilities"][number];
type FacilityDetail = GameView["facilities"]["catalogue"][number];

function fallbackSummary(building: CampusFacility): string {
  if (building.family === "rented-office") {
    return "The lab's starting premises: enough desks, sockets, and lease paperwork to begin operating before a permanent headquarters exists.";
  }
  return "A commissioned part of the lab's operating campus.";
}

function emptyBenefitLabel(building: CampusFacility): string {
  if (building.family === "rented-office") {
    return "Provides the lab's baseline operating premises; it has no separate numerical modifier.";
  }
  return "No separately listed mechanical effects.";
}

export function CampusFacilityDialog({
  building,
  detail,
  completedAtTick,
  onClose,
}: {
  readonly building: CampusFacility;
  readonly detail?: FacilityDetail;
  readonly completedAtTick?: number;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <ModalFocusBoundary onEscape={onClose}>
      <div
        className="modal-backdrop campus-facility-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          className="campus-facility-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="campus-facility-dialog-title"
        >
          <header>
            <div>
              <p className="eyebrow">CAMPUS FACILITY // COMMISSIONED</p>
              <h2 id="campus-facility-dialog-title">{building.displayName}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={`Close ${building.displayName} details`}
              onClick={onClose}
            >
              ×
            </button>
          </header>

          <div className="campus-facility-overview">
            <FacilityPixelIcon
              family={building.family}
              displayName={building.displayName}
              tier={building.tier}
              variantId={building.definitionId}
            />
            <div>
              <p>{detail?.summary ?? fallbackSummary(building)}</p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{building.operational ? "Operational" : "Offline"}</dd>
                </div>
                <div>
                  <dt>Current activity</dt>
                  <dd>{building.loadLabel}</dd>
                </div>
                <div>
                  <dt>Tier</dt>
                  <dd>{building.tier}</dd>
                </div>
                <div>
                  <dt>Commissioned</dt>
                  <dd>
                    {completedAtTick === undefined
                      ? "Date unavailable"
                      : `Week ${String(completedAtTick)}`}
                  </dd>
                </div>
                {detail === undefined ? null : (
                  <div>
                    <dt>Running cost</dt>
                    <dd>
                      {formatValuation(detail.operatingCostMillionsPerCycle)} / cycle
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          <section className="campus-facility-benefits">
            <h3>What this facility provides</h3>
            {detail === undefined || detail.benefits.length === 0 ? (
              <p>{emptyBenefitLabel(building)}</p>
            ) : (
              <ul>
                {detail.benefits.map((benefit) => (
                  <FacilityBenefitItem benefit={benefit} key={benefit.label} />
                ))}
              </ul>
            )}
          </section>

          <footer>
            <button className="secondary" type="button" onClick={onClose}>
              Back to campus
            </button>
          </footer>
        </section>
      </div>
    </ModalFocusBoundary>
  );
}
