import type { ReactElement } from "react";

import { SAFEST_ENDING_MAX_DECEPTIVE_INTENT } from "@neolab/sim/public";

import { formatCapabilityScore } from "./capability-format.ts";
import {
  ModelSafetyAtAGlance,
  type ModelSafetyAssessmentView,
  type SafetyPracticeAssessmentView,
} from "./model-safety-at-a-glance.tsx";
import { ModelMetricLabel } from "./model-metric-help.tsx";

export interface CapabilityProfileReading {
  readonly id: string;
  readonly label: string;
  readonly value?: number;
}

export interface SafetyProfileReading {
  readonly id: string;
  readonly label: string;
  readonly evaluated: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly tone: "unknown" | "quiet" | "uneasy" | "alarm";
  readonly firstEvaluation?: {
    readonly displayName: string;
    readonly ladderStep: number;
    readonly ladderLength: number;
  };
}

export function ModelEvidenceProfile({
  capabilities,
  safetyRows,
  safetyReportCount,
  independentReportCount,
  dismissedAnomalyCount,
  safetyAssessment,
  safetyPractice,
  explainDeceptionMechanics = false,
  className,
}: {
  readonly capabilities: readonly CapabilityProfileReading[];
  readonly safetyRows: readonly SafetyProfileReading[];
  readonly safetyReportCount: number;
  readonly independentReportCount: number;
  readonly dismissedAnomalyCount: number;
  readonly safetyAssessment?: ModelSafetyAssessmentView;
  readonly safetyPractice?: SafetyPracticeAssessmentView;
  readonly explainDeceptionMechanics?: boolean;
  readonly className?: string;
}): ReactElement {
  const internalReportCount = Math.max(0, safetyReportCount - independentReportCount);
  return (
    <div
      className={["model-dossier-columns", "model-evidence-profile", className]
        .filter(Boolean)
        .join(" ")}
    >
      {safetyAssessment === undefined ? null : (
        <ModelSafetyAtAGlance
          assessment={safetyAssessment}
          safetyRows={safetyRows}
          {...(safetyPractice === undefined ? {} : { safetyPractice })}
        />
      )}
      <section className="model-capability-profile">
        <header>
          <div>
            <p className="eyebrow">FULL CAPABILITY PROFILE</p>
            <h3>What the model can do</h3>
          </div>
          <span>0–100 assessed scale</span>
        </header>
        <div className="capability-readout">
          {capabilities.map((reading) => (
            <div key={reading.id}>
              <ModelMetricLabel kind="capability" id={reading.id} label={reading.label} />
              <strong>
                {reading.value === undefined
                  ? "???"
                  : formatCapabilityScore(reading.value)}
              </strong>
              <progress
                max={100}
                value={reading.value ?? 0}
                aria-label={`${reading.label} assessed capability`}
              />
            </div>
          ))}
        </div>
      </section>
      <section className="model-safety-summary">
        <header className="model-safety-heading">
          <div>
            <p className="eyebrow">DETAILED MODEL TRAITS // MEASURED, POSSIBLY WRONG</p>
            <h3>Alignment, corrigibility, deception and awareness</h3>
          </div>
          <p className="model-safety-caption">
            Warnings are evidence. Clean results are not proof.
          </p>
        </header>
        {explainDeceptionMechanics ? (
          <aside className="deception-mechanics-brief" aria-label="How deception works">
            <header>
              <strong>DECEPTION // TWO DIFFERENT RISKS</strong>
              <span>The true scores remain hidden.</span>
            </header>
            <div>
              <section>
                <strong>Deceptive intent</strong>
                <p>
                  The model&apos;s inclination to mislead its controllers. Lower is safer;
                  true intent above {SAFEST_ENDING_MAX_DECEPTIVE_INTENT} prevents the
                  safest deployment outcomes.
                </p>
              </section>
              <section>
                <strong>Strategic deception capability</strong>
                <p>
                  Ability to deceive if it tried. Intelligence raises this capability and
                  makes containment failures more dangerous, but does not itself imply
                  misalignment.
                </p>
              </section>
            </div>
          </aside>
        ) : null}
        <div className="model-safety-rows">
          {safetyRows.map((row) => {
            if (
              !row.evaluated ||
              row.minimum === undefined ||
              row.maximum === undefined
            ) {
              return (
                <div key={row.id} className="model-safety-row tone-unknown">
                  <ModelMetricLabel kind="safety" id={row.id} label={row.label} />
                  <strong>???</strong>
                  <small>not evaluated</small>
                  {row.firstEvaluation === undefined ? null : (
                    <small className="model-safety-next-evaluation">
                      Next: {row.firstEvaluation.displayName} ·{" "}
                      {row.firstEvaluation.ladderStep}/{row.firstEvaluation.ladderLength}
                    </small>
                  )}
                </div>
              );
            }
            return (
              <div key={row.id} className={`model-safety-row tone-${row.tone}`}>
                <ModelMetricLabel kind="safety" id={row.id} label={row.label} />
                <strong>
                  {row.minimum}–{row.maximum}
                </strong>
              </div>
            );
          })}
        </div>
        <p className="model-safety-provenance">
          Based on {internalReportCount} internal safety report
          {internalReportCount === 1 ? "" : "s"} · {independentReportCount} independent
          report{independentReportCount === 1 ? "" : "s"}
          {dismissedAnomalyCount > 0
            ? ` · ${String(dismissedAnomalyCount)} dismissed ${dismissedAnomalyCount === 1 ? "anomaly widens" : "anomalies widen"} these ranges`
            : ""}
        </p>
      </section>
    </div>
  );
}
