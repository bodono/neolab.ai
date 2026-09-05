import type { ReactElement } from "react";

import {
  formatTeraflops,
  formatValuation,
  generationTeraflopsPerGpu,
} from "@neolab/sim/public";

import type { BrowserContent } from "../../app/runtime-provider.tsx";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import { PixelPortrait } from "../portraits/pixel-portrait.tsx";

/**
 * The hardware keynote's eternal presenter. Fictionalised in the same way as
 * the playable leaders: a satirical portrayal of a public figure, no
 * endorsement implied.
 */
const PRESENTER = {
  subjectId: "jensen-hwang",
  name: "Jensen Hwang",
  epithet: "The Keynote Eternal",
} as const;

const FACILITY_TIER_BY_HARDWARE: Readonly<Record<string, number>> = {
  "base:gpu.rubin": 4,
  "base:gpu.markov": 5,
};

export function facilitiesUnlockedByHardware(
  content: BrowserContent,
  generationId: string,
): readonly string[] {
  const tier = FACILITY_TIER_BY_HARDWARE[generationId];
  if (tier === undefined) return [];
  return Object.values(content.facilities)
    .filter((facility) => facility.tier === tier)
    .map((facility) => facility.displayName)
    .sort((left, right) => left.localeCompare(right));
}

export function GpuGenerationDialog({
  generationId,
  content,
  onOpenProcurement,
  onOpenFacilities,
  onContinue,
}: {
  readonly generationId: string;
  readonly content: BrowserContent;
  readonly onOpenProcurement: () => void;
  readonly onOpenFacilities: () => void;
  readonly onContinue: () => void;
}): ReactElement | null {
  const generation = content.gpuGenerations[generationId];
  if (generation === undefined) return null;
  const predecessor = Object.values(content.gpuGenerations)
    .filter((candidate) => candidate.nominalYear < generation.nominalYear)
    .sort((left, right) => right.nominalYear - left.nominalYear)[0];
  const improvement =
    predecessor === undefined
      ? undefined
      : generation.trainingFactor / predecessor.trainingFactor;
  const perGpu = generationTeraflopsPerGpu(generation);
  const unlockedFacilities = facilitiesUnlockedByHardware(content, generationId);
  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog gpu-generation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gpu-generation-title"
      >
        <p className="eyebrow">
          LIVE FROM THE KEYNOTE // {generation.manufacturer.toUpperCase()}
          {generation.historicity === "fictional" ? " · FICTIONAL HARDWARE" : ""}
        </p>
        <header className="gpu-keynote-header">
          <PixelPortrait
            className="gpu-keynote-portrait"
            subjectId={PRESENTER.subjectId}
            name={PRESENTER.name}
            altText={`Pixel portrait of ${PRESENTER.name} in a black leather jacket`}
          />
          <div>
            <h2 id="gpu-generation-title">
              {PRESENTER.name} announces {generation.displayName}
            </h2>
            <small>{PRESENTER.epithet} · the jacket is load-bearing</small>
          </div>
        </header>
        <blockquote className="gpu-keynote-quote">“{generation.announcement}”</blockquote>
        <p>
          <strong>{formatTeraflops(perGpu)} per GPU</strong>
          {improvement === undefined
            ? ""
            : ` — ${improvement.toFixed(1)}× the training compute of ${predecessor?.displayName ?? "the last generation"}`}
          . {formatValuation(generation.gameCostMillionsPerThousand)} per 1,000 GPUs,
          delivery in {generation.deliveryWeeks} weeks.
        </p>
        <MechanicHelp label={`${generation.displayName} notes`}>
          {generation.education}
        </MechanicHelp>
        <p className="phase-transition-next">
          Older GPUs remain available. New hardware delivers{" "}
          {improvement === undefined ? "more" : `${improvement.toFixed(1)}×`} compute per
          rack slot.
        </p>
        {unlockedFacilities.length > 0 ? (
          <section className="phase-transition-unlocks" aria-label="New facility tier">
            <div>
              <p className="eyebrow">FACILITIES // NEW TIER UNLOCKED</p>
              <strong>
                {unlockedFacilities.length} new facility
                {unlockedFacilities.length === 1 ? " plan is" : " plans are"} now
                available
              </strong>
              <p>{unlockedFacilities.join(" · ")}</p>
            </div>
          </section>
        ) : null}
        <div className="exit-dialog-actions">
          <button className="secondary" type="button" onClick={onContinue}>
            Continue
          </button>
          <button className="primary" type="button" autoFocus onClick={onOpenProcurement}>
            Open procurement
          </button>
          {unlockedFacilities.length > 0 ? (
            <button className="primary" type="button" onClick={onOpenFacilities}>
              Open facilities
            </button>
          ) : null}
        </div>
        <small className="gpu-keynote-disclaimer">
          Fictionalised satire · no endorsement
        </small>
      </section>
    </div>
  );
}
