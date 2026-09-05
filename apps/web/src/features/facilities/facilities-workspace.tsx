import { useState, type ReactElement } from "react";

import type { CampusView, GameView } from "@neolab/sim/public";

import { CampusFacilityDialog } from "../campus/campus-facility-dialog.tsx";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { CampusStrip } from "../campus/campus-strip.tsx";
import { CampusErrorBoundary } from "../recovery/runtime-recovery.tsx";
import { FacilitiesPanel } from "./facilities-panel.tsx";

type CampusFacility = CampusView["facilities"][number];

function facilityKey(facility: CampusFacility): string {
  return facility.facilityId ?? facility.definitionId;
}

export function FacilitiesWorkspace({
  runtime,
  view,
  paused,
  onInspectResearcher,
}: {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly paused: boolean;
  readonly onInspectResearcher: (researcherId: string) => void;
}): ReactElement {
  const [selectedFacilityKey, setSelectedFacilityKey] = useState<string>();
  const selectedBuilding = view.campus.facilities.find(
    (facility) => facilityKey(facility) === selectedFacilityKey,
  );
  const selectedDetail =
    selectedBuilding === undefined
      ? undefined
      : view.facilities.catalogue.find(
          (facility) => facility.definitionId === selectedBuilding.definitionId,
        );
  const selectedCompleted =
    selectedBuilding === undefined
      ? undefined
      : view.facilities.completed.find((facility) =>
          selectedBuilding.facilityId === undefined
            ? facility.definitionId === selectedBuilding.definitionId
            : facility.facilityId === selectedBuilding.facilityId,
        );

  return (
    <div className="facilities-workspace">
      <CampusErrorBoundary runtime={runtime}>
        <CampusStrip
          campus={view.campus}
          dateLabel={view.meta.dateLabel}
          paused={paused}
          onInspectFacility={(facility) => setSelectedFacilityKey(facilityKey(facility))}
          onInspectResearcher={onInspectResearcher}
        />
      </CampusErrorBoundary>
      <FacilitiesPanel runtime={runtime} view={view} />
      {selectedBuilding === undefined ? null : (
        <CampusFacilityDialog
          building={selectedBuilding}
          {...(selectedDetail === undefined ? {} : { detail: selectedDetail })}
          {...(selectedCompleted === undefined
            ? {}
            : { completedAtTick: selectedCompleted.completedAtTick })}
          onClose={() => setSelectedFacilityKey(undefined)}
        />
      )}
    </div>
  );
}
