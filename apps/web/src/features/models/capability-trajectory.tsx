import type { ReactElement } from "react";

import type { GameView } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import { formatCapabilityScore } from "./capability-format.ts";

const WIDTH = 720;
const HEIGHT = 236;
const LEFT = 46;
const RIGHT = 18;
const TOP = 24;
const BOTTOM = 36;

const CAPABILITY_MILESTONES = [
  { value: 5, label: "Product" },
  { value: 10, label: "Safety evaluations" },
  { value: 20, label: "RSI" },
  { value: 88, label: "AGI candidate" },
] as const;

interface TrajectoryPoint {
  readonly modelId: string;
  readonly displayName: string;
  readonly tick: number;
  readonly estimate: number;
  readonly confidence: string;
}

interface FrontierPoint extends TrajectoryPoint {
  readonly gain: number;
}

function capabilityIndexSince(estimate: number, baseline: number): number {
  return 2 ** ((estimate - baseline) / 10);
}

function compactIndex(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k×`;
  if (value >= 100) return `${value.toFixed(0)}×`;
  if (value >= 10) return `${value.toFixed(1).replace(/\.0$/, "")}×`;
  return `${value.toFixed(1).replace(/\.0$/, "")}×`;
}

function formatCapabilityChange(value: number): string {
  if (value < 0.1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(1).replace(/\.0$/, "");
}

function frontierFrom(points: readonly TrajectoryPoint[]): readonly FrontierPoint[] {
  const frontier: FrontierPoint[] = [];
  let previousBest = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.estimate <= previousBest) continue;
    frontier.push({
      ...point,
      gain: Number.isFinite(previousBest) ? point.estimate - previousBest : 0,
    });
    previousBest = point.estimate;
  }
  return frontier;
}

function timeTicks(maximumTick: number): readonly number[] {
  const maximumYear = Math.max(1, Math.ceil(maximumTick / 52));
  const interval =
    [1, 2, 5, 10, 20, 50, 100].find((candidate) => maximumYear / candidate <= 6) ?? 100;
  const ticks = [0];
  for (let year = interval; year <= maximumYear; year += interval) {
    ticks.push(Math.min(year * 52, maximumTick));
  }
  return [...new Set(ticks)];
}

function sampledFrontier(frontier: readonly FrontierPoint[]): readonly FrontierPoint[] {
  if (frontier.length <= 4) return frontier;
  return [frontier[0]!, ...frontier.slice(-3)];
}

function paceLabel(frontier: readonly FrontierPoint[]): string {
  if (frontier.length < 2) return "Need 2 advances";
  const recent = frontier.slice(-4);
  const first = recent[0]!;
  const last = recent.at(-1)!;
  const elapsed = last.tick - first.tick;
  if (elapsed <= 0) return "Need more time";
  const pace = (last.estimate - first.estimate) / elapsed;
  return `${pace < 0.01 ? "<0.01" : pace.toFixed(2)} FC/week`;
}

function nextMilestoneLabel(frontierCapability: number): string {
  const next = [...CAPABILITY_MILESTONES, { value: 100, label: "Scale ceiling" }].find(
    (milestone) => milestone.value > frontierCapability,
  );
  if (next === undefined) return "FC 100 reached";
  return `FC ${String(next.value)} · ${formatCapabilityChange(
    next.value - frontierCapability,
  )} to go`;
}

export function CapabilityTrajectory({
  view,
}: {
  readonly view: GameView;
}): ReactElement {
  const points: readonly TrajectoryPoint[] = view.models.cards
    .filter((model) => Object.keys(model.capability).length > 0)
    .map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName,
      tick: model.trainedAtTick,
      estimate: model.frontierCapabilityEstimate,
      confidence: model.capabilityConfidence,
    }))
    .sort(
      (left, right) =>
        left.tick - right.tick || left.modelId.localeCompare(right.modelId),
    );
  const frontier = frontierFrom(points);
  const currentFrontier = frontier.at(-1);
  const previousFrontier = frontier.at(-2);
  const firstModel = points[0];
  const latestModel = points.at(-1);
  const maximumTick = Math.max(52, view.meta.tick, ...points.map((point) => point.tick));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const projectX = (tick: number): number => LEFT + (tick / maximumTick) * plotWidth;
  const projectY = (estimate: number): number =>
    TOP + plotHeight - (Math.max(0, Math.min(100, estimate)) / 100) * plotHeight;
  const projected = points.map((point) => ({
    ...point,
    x: projectX(point.tick),
    y: projectY(point.estimate),
  }));
  const projectedFrontier = frontier.map((point) => ({
    ...point,
    x: projectX(point.tick),
    y: projectY(point.estimate),
  }));
  const frontierPath = projectedFrontier
    .map((point, index) => {
      if (index === 0) return `M ${String(point.x)} ${String(point.y)}`;
      const previous = projectedFrontier[index - 1]!;
      return `L ${String(point.x)} ${String(previous.y)} L ${String(point.x)} ${String(
        point.y,
      )}`;
    })
    .join(" ");
  const extendedFrontierPath =
    projectedFrontier.length === 0 ? "" : `${frontierPath} H ${String(WIDTH - RIGHT)}`;
  const labelledModelIds = new Set<string>();
  if (firstModel !== undefined) labelledModelIds.add(firstModel.modelId);
  if (latestModel !== undefined) labelledModelIds.add(latestModel.modelId);
  const largestAdvance = frontier
    .slice(1)
    .reduce<FrontierPoint | undefined>(
      (largest, point) =>
        largest === undefined || point.gain > largest.gain ? point : largest,
      undefined,
    );
  if (largestAdvance !== undefined) labelledModelIds.add(largestAdvance.modelId);
  for (const milestone of CAPABILITY_MILESTONES) {
    const crossing = frontier.find((point) => point.estimate >= milestone.value);
    if (crossing !== undefined) labelledModelIds.add(crossing.modelId);
  }
  const exponentialModels = sampledFrontier(frontier);
  const baselineCapability = firstModel?.estimate ?? 0;
  const currentRelativeIndex =
    currentFrontier === undefined
      ? 1
      : capabilityIndexSince(currentFrontier.estimate, baselineCapability);
  const capabilityDoublings =
    currentFrontier === undefined
      ? 0
      : Math.max(0, (currentFrontier.estimate - baselineCapability) / 10);

  return (
    <section
      className="capability-trajectory"
      aria-labelledby="capability-trajectory-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">MEASURED CAPABILITY // LAB HISTORY</p>
          <h2 id="capability-trajectory-title">How fast the frontier is moving</h2>
        </div>
        <span>
          {points.length} evaluated {points.length === 1 ? "generation" : "generations"}
        </span>
      </header>
      {points.length === 0 || currentFrontier === undefined ? (
        <div className="trajectory-empty">
          <strong>No measured model evidence yet.</strong>
          <span>Train the lab&apos;s first model to begin its capability history.</span>
        </div>
      ) : (
        <>
          <dl className="trajectory-pace-strip">
            <div>
              <dt>Current frontier</dt>
              <dd>{formatCapabilityScore(currentFrontier.estimate)}</dd>
            </div>
            <div>
              <dt>Last advance</dt>
              <dd>
                {previousFrontier === undefined
                  ? "First reading"
                  : `+${formatCapabilityChange(currentFrontier.gain)} FC`}
              </dd>
            </div>
            <div>
              <dt>Recent pace</dt>
              <dd>{paceLabel(frontier)}</dd>
            </div>
            <div>
              <dt>Next milestone</dt>
              <dd>{nextMilestoneLabel(currentFrontier.estimate)}</dd>
            </div>
          </dl>
          <svg
            viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
            role="img"
            aria-labelledby="capability-trajectory-svg-title capability-trajectory-svg-desc"
          >
            <title id="capability-trajectory-svg-title">
              Measured Frontier Capability over game years
            </title>
            <desc id="capability-trajectory-svg-desc">
              {projected
                .map(
                  (point) =>
                    `${point.displayName}, week ${String(point.tick)}, Frontier Capability ${formatCapabilityScore(point.estimate)}, ${point.confidence} confidence`,
                )
                .join(". ")}
            </desc>
            {[0, 20, 40, 60, 80, 100].map((value) => {
              const y = projectY(value);
              return (
                <g className="trajectory-grid-line" key={value}>
                  <line x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} />
                  <text x={LEFT - 8} y={y + 3} textAnchor="end">
                    {value}
                  </text>
                </g>
              );
            })}
            {timeTicks(maximumTick).map((tick) => {
              const x = projectX(tick);
              return (
                <g className="trajectory-time-tick" key={tick}>
                  <line x1={x} y1={TOP} x2={x} y2={TOP + plotHeight} />
                  <text x={x} y={HEIGHT - 8} textAnchor={tick === 0 ? "start" : "middle"}>
                    {tick === 0 ? "Week 0" : `Year ${String(Math.round(tick / 52))}`}
                  </text>
                </g>
              );
            })}
            {CAPABILITY_MILESTONES.map((milestone) => {
              const y = projectY(milestone.value);
              return (
                <g className="trajectory-milestone" key={milestone.value}>
                  <line x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} />
                  <text x={WIDTH - RIGHT - 4} y={y - 4} textAnchor="end">
                    {milestone.label} · FC {milestone.value}
                  </text>
                </g>
              );
            })}
            <line
              className="trajectory-axis"
              x1={LEFT}
              y1={TOP + plotHeight}
              x2={WIDTH - RIGHT}
              y2={TOP + plotHeight}
            />
            {projected.length > 1 ? (
              <polyline
                className="trajectory-generation-line"
                points={projected
                  .map((point) => `${String(point.x)},${String(point.y)}`)
                  .join(" ")}
              />
            ) : null}
            {projectedFrontier.length > 0 ? (
              <path className="trajectory-frontier-line" d={extendedFrontierPath} />
            ) : null}
            {projected.map((point) => {
              const labelled = labelledModelIds.has(point.modelId);
              const labelBelow = point.y < TOP + 18;
              return (
                <g
                  className={`trajectory-point confidence-${point.confidence.toLowerCase().replaceAll(" ", "-")}${
                    labelled ? " labelled" : ""
                  }`}
                  key={point.modelId}
                >
                  <circle cx={point.x} cy={point.y} r={labelled ? 5 : 3.5} />
                  {labelled ? (
                    <text
                      className="trajectory-model-label"
                      x={point.x}
                      y={point.y + (labelBelow ? 14 : -8)}
                      textAnchor={
                        point.x < LEFT + 70
                          ? "start"
                          : point.x > WIDTH - RIGHT - 70
                            ? "end"
                            : "middle"
                      }
                    >
                      {point.displayName}
                    </text>
                  ) : null}
                  <title>
                    {point.displayName}: FC {formatCapabilityScore(point.estimate)} in
                    week {point.tick} ({point.confidence} confidence)
                  </title>
                </g>
              );
            })}
          </svg>
          <section className="trajectory-exponential-lens">
            <header>
              <div>
                <p className="eyebrow">THE EXPONENTIAL LENS</p>
                <strong>
                  {compactIndex(currentRelativeIndex)} since the first model ·{" "}
                  {capabilityDoublings.toFixed(1)} capability doublings
                </strong>
              </div>
              <MechanicHelp label="Exponential capability scale">
                This view treats every +10 FC as a doubling to show compounding progress.
                It is not a direct measure of revenue, research output or real-world
                impact.
              </MechanicHelp>
            </header>
            <ol>
              {exponentialModels.map((point) => (
                <li key={point.modelId}>
                  <span>{point.displayName}</span>
                  <strong>
                    {compactIndex(
                      capabilityIndexSince(point.estimate, baselineCapability),
                    )}
                  </strong>
                  <small>FC {formatCapabilityScore(point.estimate)}</small>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </section>
  );
}
