import type { CSSProperties, ReactElement } from "react";

import type { GameView } from "../../runtime/index.ts";

const WIDTH = 780;
const HEIGHT = 286;
const LEFT = 68;
const RIGHT = 34;
const TOP = 20;
const BOTTOM = 52;
const MIN_PERPLEXITY = 1;
const MAX_PERPLEXITY = 256;
const PERPLEXITY_TICKS = [256, 64, 16, 4, 1] as const;
const FRACTION_TICKS = [0, 25, 50, 75, 100] as const;
const CURVE_COLOURS = ["#2f9ae8", "#8f70e0", "#e98b42", "#3ca986", "#bc5d9f"] as const;

type TrainingTelemetry = GameView["models"]["trainingTelemetry"];
type TrainingCurve = TrainingTelemetry["curves"][number];

interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  readonly validationPerplexity: number;
  readonly trainingFractionBasisPoints: number;
}

function projectX(trainingFractionBasisPoints: number): number {
  return LEFT + (trainingFractionBasisPoints / 10_000) * (WIDTH - LEFT - RIGHT);
}

function projectY(validationPerplexity: number): number {
  const clamped = Math.min(
    MAX_PERPLEXITY,
    Math.max(MIN_PERPLEXITY, validationPerplexity),
  );
  const logarithmicFraction =
    (Math.log(MAX_PERPLEXITY) - Math.log(clamped)) /
    (Math.log(MAX_PERPLEXITY) - Math.log(MIN_PERPLEXITY));
  return TOP + logarithmicFraction * (HEIGHT - TOP - BOTTOM);
}

function projectCurve(curve: TrainingCurve): readonly ProjectedPoint[] {
  return curve.points.map((point) => ({
    ...point,
    x: projectX(point.trainingFractionBasisPoints),
    y: projectY(point.validationPerplexity),
  }));
}

function formatPerplexity(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function curveColour(curve: TrainingCurve): string {
  if (curve.role === "failed-baseline") return "#d14d35";
  return (
    CURVE_COLOURS[(Math.max(1, curve.attemptNumber) - 1) % CURVE_COLOURS.length] ??
    "#2f9ae8"
  );
}

function roleLabel(curve: TrainingCurve): string {
  if (curve.role === "failed-baseline") return "latest failed baseline";
  if (curve.role === "history") return "completed history";
  return curve.status === "queued" ? "queued" : "current run";
}

export function TrainingLossChart({
  telemetry,
}: {
  readonly telemetry: TrainingTelemetry;
}): ReactElement {
  const projected = telemetry.curves.map((curve) => ({
    curve,
    points: projectCurve(curve),
  }));
  const hasObservedPoints = projected.some(({ points }) => points.length > 0);
  const description = telemetry.curves
    .map((curve) => {
      const latest =
        curve.latestPerplexity === undefined
          ? "no observations yet"
          : `latest validation perplexity ${formatPerplexity(curve.latestPerplexity)}`;
      const failure =
        curve.failedAtBasisPoints === undefined
          ? ""
          : `, diverged at ${String(curve.failedAtBasisPoints / 100)} percent`;
      return `${curve.label}, ${roleLabel(curve)}, ${latest}${failure}`;
    })
    .join(". ");

  return (
    <figure className="training-loss-chart">
      <div className="training-loss-chart-heading">
        <div>
          <span>LIVE OPTIMISATION TELEMETRY</span>
          <strong>Held-out validation perplexity</strong>
        </div>
        <small>Lower is better · logarithmic scale</small>
      </div>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-labelledby="training-loss-title training-loss-description"
      >
        <title id="training-loss-title">
          Training progress and validation perplexity by model-training run
        </title>
        <desc id="training-loss-description">
          {description ||
            "No model-training telemetry has been observed yet. The chart updates weekly."}
        </desc>
        {PERPLEXITY_TICKS.map((perplexity) => {
          const y = projectY(perplexity);
          return (
            <g key={perplexity}>
              <line
                className="training-loss-gridline"
                x1={LEFT}
                y1={y}
                x2={WIDTH - RIGHT}
                y2={y}
              />
              <text x={LEFT - 10} y={y + 3} textAnchor="end">
                {String(perplexity)}
              </text>
            </g>
          );
        })}
        {FRACTION_TICKS.map((percentage) => {
          const x = projectX(percentage * 100);
          return (
            <g key={percentage}>
              <line
                className="training-loss-gridline vertical"
                x1={x}
                y1={TOP}
                x2={x}
                y2={HEIGHT - BOTTOM}
              />
              <text x={x} y={HEIGHT - BOTTOM + 19} textAnchor="middle">
                {String(percentage)}%
              </text>
            </g>
          );
        })}
        <line
          className="training-loss-axis"
          x1={LEFT}
          y1={HEIGHT - BOTTOM}
          x2={WIDTH - RIGHT}
          y2={HEIGHT - BOTTOM}
        />
        <line
          className="training-loss-axis"
          x1={LEFT}
          y1={TOP}
          x2={LEFT}
          y2={HEIGHT - BOTTOM}
        />
        <text
          className="training-loss-axis-label"
          x={(LEFT + WIDTH - RIGHT) / 2}
          y={HEIGHT - 8}
          textAnchor="middle"
        >
          Training fraction complete
        </text>
        <text
          className="training-loss-axis-label"
          x={14}
          y={(TOP + HEIGHT - BOTTOM) / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(TOP + HEIGHT - BOTTOM) / 2})`}
        >
          Validation perplexity
        </text>
        {projected.map(({ curve, points }) => {
          const colour = curveColour(curve);
          const latest = points.at(-1);
          const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
          const style = { "--training-curve-colour": colour } as CSSProperties;
          return (
            <g
              className={`training-loss-series ${curve.role}`}
              data-status={curve.status}
              key={curve.projectId}
              style={style}
            >
              {points.length > 1 ? (
                <polyline points={pointString}>
                  <title>
                    {curve.label}: {roleLabel(curve)}
                    {curve.latestPerplexity === undefined
                      ? ""
                      : `, perplexity ${formatPerplexity(curve.latestPerplexity)}`}
                  </title>
                </polyline>
              ) : null}
              {latest === undefined ? null : (
                <circle
                  className="training-loss-latest-point"
                  cx={latest.x}
                  cy={latest.y}
                  r={4}
                >
                  <title>
                    {curve.label} at {String(latest.trainingFractionBasisPoints / 100)}%:
                    validation perplexity {formatPerplexity(latest.validationPerplexity)}
                  </title>
                </circle>
              )}
              {curve.failedAtBasisPoints === undefined || latest === undefined ? null : (
                <g className="training-loss-diverged">
                  <line
                    x1={latest.x - 5}
                    y1={latest.y - 5}
                    x2={latest.x + 5}
                    y2={latest.y + 5}
                  />
                  <line
                    x1={latest.x - 5}
                    y1={latest.y + 5}
                    x2={latest.x + 5}
                    y2={latest.y - 5}
                  />
                  <text
                    x={Math.min(WIDTH - RIGHT - 3, latest.x + 9)}
                    y={Math.max(TOP + 10, latest.y - 8)}
                    textAnchor={latest.x > WIDTH - RIGHT - 85 ? "end" : "start"}
                  >
                    DIVERGED
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {hasObservedPoints ? null : (
          <text
            className="training-loss-awaiting"
            x={(LEFT + WIDTH - RIGHT) / 2}
            y={(TOP + HEIGHT - BOTTOM) / 2}
            textAnchor="middle"
          >
            QUEUED // AWAITING FIRST OPTIMISATION STEP
          </text>
        )}
      </svg>
      <ol className="training-loss-legend">
        {telemetry.curves.map((curve) => (
          <li
            className={curve.role}
            key={curve.projectId}
            style={{ "--training-curve-colour": curveColour(curve) } as CSSProperties}
          >
            <i aria-hidden="true" />
            <span>
              <strong>{curve.label}</strong>
              <small>
                {roleLabel(curve)} · {curve.scaleLabel} · {curve.postureLabel}
              </small>
            </span>
            <b>
              {curve.latestPerplexity === undefined
                ? curve.status.toUpperCase()
                : formatPerplexity(curve.latestPerplexity)}
            </b>
          </li>
        ))}
      </ol>
      {telemetry.omittedSuccessfulRuns > 0 ? (
        <figcaption>
          {String(telemetry.omittedSuccessfulRuns)} older successful run
          {telemetry.omittedSuccessfulRuns === 1 ? " is" : "s are"} omitted.
        </figcaption>
      ) : null}
    </figure>
  );
}
