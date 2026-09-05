import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
} from "react";

import { formatTeraflops, type GameView } from "@neolab/sim/public";

import { allocationCommand } from "../../app/command-builders.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";

interface UseResearchAllocationOptions {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly servingBasisPoints: number;
}

export function useResearchAllocation({
  runtime,
  view,
  servingBasisPoints,
}: UseResearchAllocationOptions) {
  const appliedCapabilityBasisPoints = view.compute.allocation.capabilities.basisPoints;
  const queuedCapabilityBasisPoints =
    view.compute.queuedAllocation?.capabilityBasisPoints ?? appliedCapabilityBasisPoints;
  const [capabilityBasisPoints, setCapabilityBasisPoints] = useState(
    queuedCapabilityBasisPoints,
  );
  const [message, setMessage] = useState(
    "Changes to research allocation apply on the next simulation week.",
  );

  useEffect(
    () => setCapabilityBasisPoints(queuedCapabilityBasisPoints),
    [queuedCapabilityBasisPoints],
  );

  const command = useMemo(
    () => allocationCommand(view, servingBasisPoints, capabilityBasisPoints),
    [view, servingBasisPoints, capabilityBasisPoints],
  );
  const validation = useMemo(() => runtime.validate(command), [command, runtime]);
  const consequences = validation.ok
    ? validation.preview.gpuAllocationConsequences
    : undefined;
  const plan = validation.ok ? validation.preview.gpuAllocationPlan : undefined;
  const deliveredTeraflops =
    consequences?.deliveredTeraflops ?? view.market.deliveredTeraflops;
  const researchTeraflops = Math.max(
    0,
    view.compute.unreservedTeraflops - deliveredTeraflops,
  );
  const capabilityTeraflops = researchTeraflops * (capabilityBasisPoints / 10_000);
  const safetyTeraflops = Math.max(0, researchTeraflops - capabilityTeraflops);

  const committedServingBasisPoints =
    view.compute.queuedAllocation?.servingFleetShareBasisPoints ??
    view.compute.allocation.serving.basisPoints;

  const commit = useCallback(
    (
      nextCapabilityBasisPoints: number = capabilityBasisPoints,
      nextServingBasisPoints: number = servingBasisPoints,
    ): boolean => {
      if (
        nextCapabilityBasisPoints === queuedCapabilityBasisPoints &&
        nextServingBasisPoints === committedServingBasisPoints
      ) {
        return true;
      }
      const refreshed = allocationCommand(
        view,
        nextServingBasisPoints,
        nextCapabilityBasisPoints,
      );
      const checked = runtime.validate(refreshed);
      if (!checked.ok) {
        setMessage(checked.errors.map((error) => error.message).join(" · "));
        return false;
      }
      runtime.dispatch(refreshed);
      setMessage("Allocation confirmed · applies next week.");
      return true;
    },
    [
      capabilityBasisPoints,
      committedServingBasisPoints,
      queuedCapabilityBasisPoints,
      runtime,
      servingBasisPoints,
      view,
    ],
  );

  return {
    appliedCapabilityBasisPoints,
    capabilityBasisPoints,
    capabilityTeraflops,
    commit,
    consequences,
    isDraft: capabilityBasisPoints !== queuedCapabilityBasisPoints,
    isPending:
      queuedCapabilityBasisPoints !== appliedCapabilityBasisPoints &&
      capabilityBasisPoints === queuedCapabilityBasisPoints,
    message,
    plan,
    safetyTeraflops,
    setCapabilityBasisPoints,
  };
}

interface ResearchAllocationControlProps {
  readonly capabilityBasisPoints: number;
  readonly capabilityTeraflops: number;
  readonly safetyTeraflops: number;
  readonly isDraft: boolean;
  readonly isPending: boolean;
  readonly message: string;
  readonly onChange: (basisPoints: number) => void;
  readonly onCommit: (basisPoints: number) => void;
  readonly onOpenFullAllocation?: () => void;
  readonly compact?: boolean;
  readonly capabilityOnly?: boolean;
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(0)}%`;
}

export function ResearchAllocationControl({
  capabilityBasisPoints,
  capabilityTeraflops,
  safetyTeraflops,
  isDraft,
  isPending,
  message,
  onChange,
  onCommit,
  onOpenFullAllocation,
  compact = false,
  capabilityOnly = false,
}: ResearchAllocationControlProps): ReactElement {
  const sliderId = useId();
  const safetyBasisPoints = 10_000 - capabilityBasisPoints;
  const status = isDraft ? "DRAFT" : isPending ? "APPLIES NEXT WEEK" : "LIVE";

  return (
    <section
      className={`research-allocation-control${compact ? " compact" : ""}`}
      aria-labelledby={`${sliderId}-title`}
    >
      <header>
        <div>
          <p className="eyebrow">RESEARCH ALLOCATION</p>
          <h3 id={`${sliderId}-title`}>
            {capabilityOnly ? "Broad capability research" : "Research split"}
          </h3>
        </div>
        <div className="research-allocation-tools">
          <span data-status={isDraft ? "draft" : isPending ? "pending" : "live"}>
            {status}
          </span>
          {onOpenFullAllocation === undefined ? null : (
            <button className="text-button" type="button" onClick={onOpenFullAllocation}>
              Full compute allocation →
            </button>
          )}
        </div>
      </header>

      <div className="research-allocation-readout">
        <article className="capability">
          <span>Broad capability research</span>
          <strong>{percent(capabilityBasisPoints)}</strong>
          <small>{formatTeraflops(capabilityTeraflops)} effective</small>
        </article>
        {capabilityOnly ? null : (
          <article className="safety">
            <span>Safety research</span>
            <strong>{percent(safetyBasisPoints)}</strong>
            <small>{formatTeraflops(safetyTeraflops)} effective</small>
          </article>
        )}
      </div>

      {capabilityOnly ? (
        <button
          className="primary"
          type="button"
          disabled={capabilityBasisPoints === 10_000 && !isDraft}
          onClick={() => {
            onChange(10_000);
            onCommit(10_000);
          }}
        >
          {capabilityBasisPoints === 10_000 && !isDraft
            ? "100% broad capability research"
            : "Commit all research compute to broad capability"}
        </button>
      ) : (
        <label className="research-allocation-slider" htmlFor={sliderId}>
          <span className="sr-only">
            Broad capability research share of available R&amp;D compute
          </span>
          <input
            id={sliderId}
            aria-label="Broad capability research share of available R&D compute"
            aria-valuetext={`${percent(capabilityBasisPoints)} broad capability research and ${percent(safetyBasisPoints)} safety research`}
            type="range"
            min="0"
            max="10000"
            step="100"
            value={capabilityBasisPoints}
            onChange={(event) => onChange(event.target.valueAsNumber)}
            onPointerUp={(event) => onCommit(event.currentTarget.valueAsNumber)}
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
                onCommit(event.currentTarget.valueAsNumber);
              }
            }}
            onBlur={(event) => {
              if (isDraft) {
                onCommit(event.currentTarget.valueAsNumber);
              }
            }}
          />
          <i aria-hidden="true">
            <span style={{ width: `${String(capabilityBasisPoints / 100)}%` }} />
          </i>
        </label>
      )}

      <p className="research-allocation-footnote" role="status">
        {message}
      </p>
    </section>
  );
}
