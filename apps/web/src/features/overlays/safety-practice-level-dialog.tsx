import type { ReactElement } from "react";

import type { SafetyPracticeLevelPresentationQueueItemView } from "@neolab/sim/public";

interface Improvement {
  readonly label: string;
  readonly value: string;
}

function improvementRows(
  item: SafetyPracticeLevelPresentationQueueItemView,
): readonly Improvement[] {
  const previous = item.previousBenefits;
  const current = item.currentBenefits;
  const rows: Improvement[] = [];
  const auditGain =
    current.auditTimeReductionPercent - previous.auditTimeReductionPercent;
  if (auditGain > 0) {
    rows.push({ label: "Faster independent audits", value: `+${String(auditGain)}%` });
  }
  const cashGain =
    current.evaluationCashReductionPercent - previous.evaluationCashReductionPercent;
  if (cashGain > 0) {
    rows.push({ label: "Lower evaluation cash cost", value: `+${String(cashGain)}%` });
  }
  const uncertaintyGain =
    current.estimateUncertaintyReduction - previous.estimateUncertaintyReduction;
  if (uncertaintyGain > 0) {
    rows.push({
      label: "Narrower estimate uncertainty",
      value: `−${String(uncertaintyGain)}`,
    });
  }
  const detectionGain =
    current.anomalyDetectionBonusPercent - previous.anomalyDetectionBonusPercent;
  if (detectionGain > 0) {
    rows.push({
      label: "Better anomaly detection",
      value: `+${detectionGain.toFixed(1)}%`,
    });
  }
  return rows;
}

export function SafetyPracticeLevelDialog({
  item,
  onContinue,
  onReview,
}: {
  readonly item: SafetyPracticeLevelPresentationQueueItemView;
  readonly onContinue: () => void;
  readonly onReview: () => void;
}): ReactElement {
  const improvements = improvementRows(item);
  const levelsGained = item.toLevel - item.fromLevel;
  return (
    <div className="modal-backdrop safety-practice-level-backdrop">
      <section
        className="safety-practice-level-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`safety-practice-level-${String(item.toLevel)}`}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <header className="safety-practice-level-hero">
          <div>
            <p className="eyebrow">INSTITUTIONAL MILESTONE // SAFETY PRACTICE</p>
            <h2 id={`safety-practice-level-${String(item.toLevel)}`}>
              Safety Practice reaches Level {item.toLevel}.
            </h2>
            <p className="safety-practice-level-name">{item.toLabel}</p>
          </div>
          <div className="safety-practice-level-badge" aria-label="Level up">
            <span>LEVEL UP</span>
            <strong>{item.toLevel}</strong>
            <small>/ 10</small>
          </div>
        </header>

        <p className="safety-practice-level-summary">
          <strong>{item.evaluationDisplayName}</strong> on {item.modelDisplayName} added +
          {item.practiceXpGained} permanent practice XP. The lab advanced from Level{" "}
          {item.fromLevel} · {item.fromLabel}
          {levelsGained > 1 ? `, crossing ${String(levelsGained)} levels at once` : ""}.
        </p>

        <div
          className="safety-practice-level-track"
          aria-label="Safety Practice progress"
        >
          <span>LEVEL {item.fromLevel}</span>
          <div>
            <i style={{ width: `${String(Math.min(100, item.newPracticeXp))}%` }} />
          </div>
          <strong>LEVEL {item.toLevel}</strong>
          <small>{item.newPracticeXp} / 100 XP</small>
        </div>

        <section
          className="safety-practice-level-benefits"
          aria-labelledby="benefits-now-active"
        >
          <header>
            <p className="eyebrow" id="benefits-now-active">
              PERMANENT LAB MUSCLE // BENEFITS NOW ACTIVE
            </p>
            <p>Permanent bonuses for every future evaluation.</p>
          </header>
          <div className="safety-practice-benefit-grid">
            <article>
              <strong>−{item.currentBenefits.auditTimeReductionPercent}%</strong>
              <span>evaluation FLOPs / audit time</span>
            </article>
            <article>
              <strong>−{item.currentBenefits.evaluationCashReductionPercent}%</strong>
              <span>evaluation cash cost</span>
            </article>
            <article>
              <strong>−{item.currentBenefits.estimateUncertaintyReduction}</strong>
              <span>estimate uncertainty</span>
            </article>
            <article>
              <strong>
                +{item.currentBenefits.anomalyDetectionBonusPercent.toFixed(1)}%
              </strong>
              <span>anomaly detection</span>
            </article>
          </div>
        </section>

        {improvements.length === 0 ? null : (
          <section className="safety-practice-improvements">
            <p className="eyebrow">WHAT IMPROVED THIS TIME</p>
            <ul>
              {improvements.map((improvement) => (
                <li key={improvement.label}>
                  <strong>{improvement.value}</strong>
                  <span>{improvement.label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="safety-practice-next">
          {item.nextLevel === undefined ? (
            <>
              <span>HIGHEST PRACTICE LEVEL REACHED</span>
              <strong>Safety has become an institutional reflex.</strong>
            </>
          ) : (
            <>
              <span>NEXT MILESTONE // LEVEL {item.nextLevel}</span>
              <strong>
                {item.pointsToNextLevel} more permanent practice XP required
                {item.nextThreshold === undefined
                  ? "."
                  : ` · ${String(item.nextThreshold)} XP total.`}
              </strong>
            </>
          )}
        </div>

        <footer>
          <p>The evaluation team marks the milestone.</p>
          <div>
            <button className="secondary" type="button" onClick={onReview}>
              Review Safety Practice
            </button>
            <button className="primary" type="button" onClick={onContinue}>
              Celebrate, then continue
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
