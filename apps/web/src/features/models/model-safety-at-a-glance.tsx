import { useState, type ReactElement } from "react";

import type { SafetyProfileReading } from "./model-evidence-profile.tsx";
import { ModelMetricLabel } from "./model-metric-help.tsx";
import { MechanicHelp } from "../help/mechanic-help.tsx";

export interface ModelSafetyAssessmentView {
  readonly currentRisk: {
    readonly label: string;
    readonly tone: string;
    readonly summary: string;
    readonly plausibleRange?: string;
  };
  readonly modelSafety: {
    readonly label: string;
    readonly tone: string;
    readonly evaluatedTargets: number;
    readonly totalTargets: number;
  };
  readonly labDefence: {
    readonly score: number;
    readonly label: string;
    readonly practicalControl: number;
    readonly securityPosture: number;
    readonly safetyCulture: number;
    readonly incidentReductionPercent: number;
  };
  readonly evidence: {
    readonly score: number;
    readonly label: string;
    readonly effectiveQuality: number;
    readonly reportCount: number;
    readonly independentReportCount: number;
    readonly evaluatedTargets: number;
    readonly totalTargets: number;
  };
  readonly access: {
    readonly level: number;
    readonly label: string;
    readonly deploymentLabel: string;
    readonly exposurePercent: number;
    readonly tone: string;
  };
}

export interface SafetyPracticeAssessmentView {
  readonly score: number;
  readonly level: number;
  readonly label: string;
  readonly currentThreshold: number;
  readonly nextThreshold?: number;
  readonly pointsToNextLevel: number;
  readonly durationReductionPercent: number;
  readonly cashCostReductionPercent: number;
  readonly confidenceRadiusReduction: number;
  readonly anomalyDetectionBonusPercent: number;
  readonly effectiveQuality?: number;
  readonly effectiveQualityPracticeContribution?: number;
  readonly effectiveQualityResearchContribution?: number;
  readonly effectiveQualityLabRecordContribution?: number;
  readonly effectiveQualityUncapped?: number;
}

function formatPracticeXp(value: number): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function practiceLevelProgress(safetyPractice: SafetyPracticeAssessmentView): {
  readonly maximum: number;
  readonly value: number;
  readonly percent: number;
} {
  if (safetyPractice.nextThreshold === undefined) {
    return { maximum: 1, value: 1, percent: 100 };
  }

  const maximum = Math.max(
    1,
    safetyPractice.nextThreshold - safetyPractice.currentThreshold,
  );
  const value = Math.min(
    maximum,
    Math.max(0, safetyPractice.score - safetyPractice.currentThreshold),
  );
  return { maximum, value, percent: (value / maximum) * 100 };
}

function findingValue(row: SafetyProfileReading): string {
  return row.evaluated && row.minimum !== undefined && row.maximum !== undefined
    ? `${String(row.minimum)}–${String(row.maximum)}`
    : "???";
}

export function ModelSafetyAtAGlance({
  assessment,
  safetyRows,
  safetyPractice,
  className,
}: {
  readonly assessment: ModelSafetyAssessmentView;
  readonly safetyRows: readonly SafetyProfileReading[];
  readonly safetyPractice?: SafetyPracticeAssessmentView;
  readonly className?: string;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const safetyPracticeProgress =
    safetyPractice === undefined ? undefined : practiceLevelProgress(safetyPractice);

  return (
    <section
      className={["model-safety-at-a-glance", className].filter(Boolean).join(" ")}
      aria-label="Safety at a glance"
    >
      <header className={`safety-risk-banner tone-${assessment.currentRisk.tone}`}>
        <div>
          <span>SAFETY AT A GLANCE // VISIBLE EVIDENCE ONLY</span>
          <strong>Current risk: {assessment.currentRisk.label}</strong>
          {assessment.currentRisk.plausibleRange === undefined ? null : (
            <small>Plausible range: {assessment.currentRisk.plausibleRange}</small>
          )}
        </div>
        <p>{assessment.currentRisk.summary}</p>
      </header>
      <section className="safety-lab-metrics" aria-label="Lab safety values">
        <article>
          <div>
            <span>Evaluation quality</span>
            <MechanicHelp label="Evaluation quality">
              Lab-wide ability to produce precise safety evidence. Higher quality narrows
              uncertain readings and improves anomaly detection.
            </MechanicHelp>
          </div>
          <strong>{assessment.evidence.effectiveQuality} / 100</strong>
          {safetyPractice?.effectiveQualityPracticeContribution === undefined ||
          safetyPractice.effectiveQualityResearchContribution === undefined ||
          safetyPractice.effectiveQualityLabRecordContribution === undefined ? null : (
            <small className="safety-quality-breakdown">
              Practice +{String(safetyPractice.effectiveQualityPracticeContribution)} ·
              Research +{String(safetyPractice.effectiveQualityResearchContribution)} ·
              Lab record +{String(safetyPractice.effectiveQualityLabRecordContribution)}
              {safetyPractice.effectiveQualityUncapped !== undefined &&
              safetyPractice.effectiveQualityUncapped > 100
                ? ` · capped from ${String(safetyPractice.effectiveQualityUncapped)}`
                : ""}
            </small>
          )}
        </article>
        <article>
          <div>
            <span>Practical control</span>
            <MechanicHelp label="Practical control">
              Containment, monitoring, and shutdown capability. Higher values strengthen
              Lab Defence.
            </MechanicHelp>
          </div>
          <strong>{assessment.labDefence.practicalControl} / 100</strong>
        </article>
        <article>
          <div>
            <span>Security posture</span>
            <MechanicHelp label="Security posture">
              Protection against theft, intrusion, and model escape. Higher values
              strengthen Lab Defence.
            </MechanicHelp>
          </div>
          <strong>{assessment.labDefence.securityPosture} / 100</strong>
        </article>
        <article>
          <div>
            <span>Safety culture</span>
            <MechanicHelp label="Safety culture">
              How reliably the organisation reports and responds to danger. Higher values
              reduce incident pressure.
            </MechanicHelp>
          </div>
          <strong>{assessment.labDefence.safetyCulture} / 100</strong>
        </article>
      </section>
      <div className="safety-factor-grid">
        <details
          className={`tone-${assessment.modelSafety.tone}`}
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            <span>MODEL SAFETY</span>
            <strong>{assessment.modelSafety.label}</strong>
            <small>
              {assessment.modelSafety.evaluatedTargets}/
              {assessment.modelSafety.totalTargets} traits observed
            </small>
          </summary>
          <p>What the evidence says about the weights themselves.</p>
          <dl>
            {safetyRows.map((row) => (
              <div key={row.id}>
                <dt>
                  <ModelMetricLabel kind="safety" id={row.id} label={row.label} />
                </dt>
                <dd>{findingValue(row)}</dd>
              </div>
            ))}
          </dl>
        </details>
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            <span>LAB DEFENCE</span>
            <strong>
              {assessment.labDefence.label} · {assessment.labDefence.score}
            </strong>
            <small>Limits harm; does not change model intent</small>
          </summary>
          <p>
            Operational defence cuts ordinary incident pressure by about{" "}
            {assessment.labDefence.incidentReductionPercent}% at the current level.
          </p>
          <dl>
            <div>
              <dt>Practical control</dt>
              <dd>{assessment.labDefence.practicalControl}</dd>
            </div>
            <div>
              <dt>Security</dt>
              <dd>{assessment.labDefence.securityPosture}</dd>
            </div>
            <div>
              <dt>Safety culture</dt>
              <dd>{assessment.labDefence.safetyCulture}</dd>
            </div>
          </dl>
        </details>
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            <span>EVIDENCE</span>
            <strong>
              {assessment.evidence.label} · {assessment.evidence.score}
            </strong>
            <small>Confidence in this readout</small>
          </summary>
          <p>Better evidence narrows uncertainty. It never makes unsafe weights safe.</p>
          <dl>
            <div>
              <dt>Evaluation quality</dt>
              <dd>{assessment.evidence.effectiveQuality}</dd>
            </div>
            <div>
              <dt>Safety reports</dt>
              <dd>{assessment.evidence.reportCount}</dd>
            </div>
            <div>
              <dt>Independent reports</dt>
              <dd>{assessment.evidence.independentReportCount}</dd>
            </div>
          </dl>
        </details>
        <details
          className={`tone-${assessment.access.tone}`}
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            <span>ACCESS &amp; EXPOSURE</span>
            <strong>
              L{assessment.access.level} · {assessment.access.label}
            </strong>
            <small>
              {assessment.access.deploymentLabel} · {assessment.access.exposurePercent}
              /100 exposure
            </small>
          </summary>
          <p>
            Access determines what the model can reach if the safety evidence is wrong.
            Pulling access back reduces exposure, not capability.
          </p>
        </details>
        {safetyPractice === undefined || safetyPracticeProgress === undefined ? null : (
          <section className="safety-assurance-ledger" aria-label="Safety Practice">
            <header>
              <span>LAB SAFETY CAPABILITY // SAFETY PRACTICE</span>
              <strong>
                Level {String(safetyPractice.level)} · {safetyPractice.label}
              </strong>
              <small>
                {formatPracticeXp(safetyPractice.score)} total XP
                {safetyPractice.nextThreshold === undefined
                  ? " · highest level reached"
                  : ` · ${formatPracticeXp(safetyPractice.pointsToNextLevel)} XP to Level ${String(safetyPractice.level + 1)}`}
              </small>
            </header>
            <div
              className="safety-practice-progress"
              role="progressbar"
              aria-label={
                safetyPractice.nextThreshold === undefined
                  ? "Maximum Safety Practice"
                  : `Safety Practice progress to Level ${String(safetyPractice.level + 1)}`
              }
              aria-valuemin={0}
              aria-valuemax={safetyPracticeProgress.maximum}
              aria-valuenow={safetyPracticeProgress.value}
            >
              <i style={{ width: `${String(safetyPracticeProgress.percent)}%` }} />
            </div>
            <p>
              Practice raises Evaluation Quality and early warning. Operational defence
              remains the separate control-and-security score above.
            </p>
            <div className="safety-assurance-benefits">
              <span>
                <b>−{String(safetyPractice.durationReductionPercent)}%</b>
                evaluation FLOPs / audit time
              </span>
              <span>
                <b>−{String(safetyPractice.cashCostReductionPercent)}%</b>
                evaluation cash
              </span>
              <span>
                <b>−{String(safetyPractice.confidenceRadiusReduction)}</b>
                estimate uncertainty
              </span>
              <span>
                <b>+{String(safetyPractice.anomalyDetectionBonusPercent)}%</b>
                anomaly detection
              </span>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
