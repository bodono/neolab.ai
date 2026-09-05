import type { CSSProperties, ReactElement } from "react";

import type { GameView } from "../../runtime/index.ts";

export function LabAmbientActivity({
  view,
  paused,
}: {
  readonly view: GameView;
  readonly paused: boolean;
}): ReactElement {
  const people = view.people.roster.length;
  const facilities = view.facilities.completed.length;
  const models = view.models.cards.length;
  const activity = Math.min(1, 0.2 + people * 0.05 + facilities * 0.04 + models * 0.08);
  const nodeCount = 38 + Math.round(activity * 30);
  const processorCount = 7 + Math.round(activity * 6);
  const packetCount = 14 + Math.round(activity * 14);
  const workerCount = Math.min(
    22,
    9 + people * 2 + facilities + Math.round(activity * 4),
  );
  const label =
    activity < 0.3 ? "small lab" : activity < 0.62 ? "growing lab" : "frontier campus";

  return (
    <>
      <div
        className="lab-ambient-activity"
        data-paused={paused ? "true" : "false"}
        style={
          {
            "--lab-activity-opacity": 0.34 + activity * 0.28,
            "--lab-activity-speed": `${String(7 - activity * 2.4)}s`,
            "--lab-node-scale": 1 + activity * 0.8,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <i className="ambient-bus bus-one" />
        <i className="ambient-bus bus-two" />
        <i className="ambient-bus bus-three" />
        <i className="ambient-bus bus-four" />
        <i className="ambient-bus bus-five" />
        <i className="ambient-bus bus-six" />
        <i className="ambient-bus bus-seven" />
        <i className="ambient-bus bus-eight" />
        {Array.from({ length: nodeCount }, (_, index) => (
          <span
            className="ambient-node"
            key={index}
            style={
              {
                "--ambient-left": `${String(3 + ((index * 13) % 94))}%`,
                "--ambient-top": `${String(3 + ((index * 23) % 94))}%`,
                "--ambient-duration": `${String(4.2 + (index % 4) * 0.8)}s`,
                "--ambient-delay": `${String(index * -0.61)}s`,
              } as CSSProperties
            }
          />
        ))}
        {Array.from({ length: processorCount }, (_, index) => (
          <b
            className="ambient-processor"
            key={`processor:${String(index)}`}
            style={
              {
                "--processor-left": `${String(7 + ((index * 17) % 86))}%`,
                "--processor-top": `${String(8 + ((index * 29) % 82))}%`,
                "--processor-delay": `${String(index * -1.4)}s`,
              } as CSSProperties
            }
          >
            <i />
            <i />
            <i />
          </b>
        ))}
        {Array.from({ length: packetCount }, (_, index) => (
          <span
            className={`ambient-packet packet-${String(index % 4)}`}
            key={`packet:${String(index)}`}
            style={
              {
                "--packet-left": `${String(2 + ((index * 19) % 97))}%`,
                "--packet-delay": `${String(index * -0.73)}s`,
                "--packet-duration": `${String(6.5 + (index % 6) * 1.4)}s`,
              } as CSSProperties
            }
          >
            <i />
            <i />
            <i />
          </span>
        ))}
        {Array.from({ length: workerCount }, (_, index) => (
          <em
            className={`ambient-worker worker-${String(index % 4)}`}
            key={`worker:${String(index)}`}
            style={
              {
                "--worker-top": `${String(5 + ((index * 17) % 90))}%`,
                "--worker-delay": `${String(index * -1.37)}s`,
                "--worker-duration": `${String(13 + (index % 7) * 2.1)}s`,
              } as CSSProperties
            }
          >
            <i />
          </em>
        ))}
      </div>
      <span className="sr-only" role="status">
        Ambient lab activity: {label}; motion is {paused ? "paused" : "running"}.
      </span>
    </>
  );
}
