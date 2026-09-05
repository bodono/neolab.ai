import { useState, type ReactElement } from "react";

import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
  type GameView,
} from "@neolab/sim/public";

import {
  setAutonomyCommand,
  startAgiComponentCommand,
} from "../../app/command-builders.ts";
import { majorProjectActionLabel } from "../../app/major-projects.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { formatCapabilityScore } from "../models/capability-format.ts";
import { CriticalAutonomyConfirmationDialog } from "./critical-autonomy-confirmation-dialog.tsx";

function formatMultiplier(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

export function AgiWorkspace({
  runtime,
  view,
}: {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const [pendingCriticalLevel, setPendingCriticalLevel] = useState<number>();
  const programme = view.models.candidateProgramme;
  const completedComponents = programme.components.filter(
    (component) => component.status === "complete",
  ).length;
  const pendingCriticalRung = view.models.autonomy.levels.find(
    (rung) => rung.level === pendingCriticalLevel,
  );
  const candidateProgrammeAvailable =
    view.meta.labMaturity?.features.includes("agi") ?? true;
  return (
    <>
      <section
        className="console-panel agi-workspace-intro"
        aria-labelledby="agi-workspace-title"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">
              {candidateProgrammeAvailable
                ? "ENDGAME PROGRAMMES // BUILD THE CANDIDATE, CHOOSE ITS REACH"
                : "RECURSIVE SELF-IMPROVEMENT // CAPABILITY FOR ACCESS"}
            </p>
            <h2 id="agi-workspace-title">
              {candidateProgrammeAvailable ? "AGI & autonomy" : "The Autonomy Programme"}
            </h2>
          </div>
          <span>
            {candidateProgrammeAvailable
              ? `${String(completedComponents)}/${String(programme.components.length)} WORKS // `
              : ""}
            AUTONOMY L{view.models.autonomy.currentLevel}
          </span>
        </header>
        <dl className="agi-strategy-summary">
          {candidateProgrammeAvailable ? (
            <>
              <div>
                <dt>Candidate works</dt>
                <dd>
                  {completedComponents}/{programme.components.length} complete
                </dd>
              </div>
              <div>
                <dt>Capability gate</dt>
                <dd>{programme.capabilityFloorLabel}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>Capability unlock</dt>
              <dd>
                Level 1 at capability{" "}
                {view.models.autonomy.levels.find((level) => level.level === 1)
                  ?.unlockCapability ?? 20}
              </dd>
            </div>
          )}
          <div>
            <dt>Autonomy envelope</dt>
            <dd>Level {view.models.autonomy.currentLevel}</dd>
            <small>{view.models.autonomy.currentLevelName}</small>
          </div>
          {!candidateProgrammeAvailable ? (
            <div>
              <dt>The bargain</dt>
              <dd>Acceleration for exposure</dd>
            </div>
          ) : null}
        </dl>
        <nav className="agi-workspace-jump" aria-label="AGI and autonomy programmes">
          {candidateProgrammeAvailable ? (
            <a href="#candidate-programme">01 · Candidate programme</a>
          ) : null}
          <a href="#autonomy-programme">
            {candidateProgrammeAvailable ? "02" : "01"} · Autonomy programme
          </a>
        </nav>
      </section>

      {candidateProgrammeAvailable ? (
        <section
          id="candidate-programme"
          className="console-panel path-to-agi"
          aria-labelledby="path-to-agi-title"
        >
          <header className="panel-heading">
            <div>
              <p className="eyebrow">THE CANDIDATE PROGRAMME</p>
              <h2 id="path-to-agi-title">AGI Candidate Programme</h2>
            </div>
            <span>
              {completedComponents}/{programme.components.length} components
            </span>
          </header>
          <p className="path-to-agi-intro">
            4 works · FC {AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY}+ · every capability{" "}
            {AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE}+
          </p>
          {programme.declarationCooldown === undefined ? null : (
            <div className="agi-candidate-cooldown" role="status">
              <div>
                <span>FALSE DAWN REVIEW</span>
                <strong>
                  Candidate declarations paused ·{" "}
                  {programme.declarationCooldown.remainingWeeks}W remaining
                </strong>
              </div>
              <p>
                New nominations reopen in week {programme.declarationCooldown.untilTick}.
              </p>
            </div>
          )}
          <div className="agi-component-grid">
            {programme.components.map((component) => {
              const command = startAgiComponentCommand(view, component.componentType);
              const validation = runtime.validate(command);
              return (
                <article
                  key={component.componentType}
                  className={`agi-component-card ${component.status}`}
                >
                  <header>
                    <strong>{component.displayName}</strong>
                    <span>{component.status.replace("-", " ").toUpperCase()}</span>
                  </header>
                  <p>{component.description}</p>
                  <small className="agi-component-cost">{component.costLabel}</small>
                  <small className="agi-component-benefit">
                    On completion: {component.benefitLabel}
                  </small>
                  {component.status === "available" ? (
                    <button
                      type="button"
                      className="primary"
                      disabled={!validation.ok}
                      onClick={() => {
                        runtime.dispatch(command);
                      }}
                    >
                      {majorProjectActionLabel(
                        view,
                        "Begin construction",
                        "Queue construction",
                      )}
                    </button>
                  ) : component.status === "locked" ? (
                    <small className="agi-component-blockers">
                      {component.blockers.join(" · ")}
                    </small>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section
        id="autonomy-programme"
        className="console-panel autonomy-programme"
        aria-labelledby="autonomy-title"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">THE AUTONOMY PROGRAMME</p>
            <h2 id="autonomy-title">Recursive self-improvement</h2>
          </div>
          <span>
            LEVEL {view.models.autonomy.currentLevel} //{" "}
            {view.models.autonomy.currentLevelName.toUpperCase()}
          </span>
        </header>
        <p className="autonomy-intro">
          More access accelerates research and increases exposure.
        </p>
        <div className="autonomy-overview">
          <div className="autonomy-current">
            <p className="eyebrow">CURRENT OPERATING ENVELOPE</p>
            <h3>
              {view.models.autonomy.currentModelDisplayName === undefined
                ? "Awaiting the first trained model"
                : `${view.models.autonomy.currentModelDisplayName} · ${view.models.autonomy.currentLevelName}`}
            </h3>
            <p>{view.models.autonomy.benefitLabel}</p>
          </div>
          <dl className="autonomy-status">
            <div>
              <dt>Autonomous-action risk</dt>
              <dd>{view.models.autonomy.riskLabel}</dd>
            </div>
            <div>
              <dt>Monitoring coverage</dt>
              <dd>{view.models.autonomy.detectionLabel}</dd>
            </div>
            <div>
              <dt>External cost</dt>
              <dd>{view.models.autonomy.costLabel}</dd>
            </div>
            <div>
              <dt>Ignored warnings</dt>
              <dd>
                {view.models.autonomy.ignoredEscalations} of{" "}
                {view.models.autonomy.ignoredEscalationLimit} · rollback resets
              </dd>
            </div>
          </dl>
        </div>
        {view.models.autonomy.escapedWeights ? (
          <p className="autonomy-escaped">
            Copies of your weights are running outside this lab. That cannot be undone.
          </p>
        ) : null}
        <div className="autonomy-ladder">
          {view.models.autonomy.levels.map((rung) => {
            const raising = rung.level > view.models.autonomy.currentLevel;
            const requiresConfirmation = raising && rung.confirmationPhrase !== undefined;
            const command = setAutonomyCommand(
              view,
              rung.level,
              requiresConfirmation ? rung.confirmationPhrase : undefined,
            );
            const validation = runtime.validate(command);
            return (
              <article
                key={rung.level}
                className={`autonomy-rung safety-${rung.safetyTone}${
                  rung.current ? " current" : ""
                }${rung.unlocked ? " unlocked" : " locked"}`}
              >
                <header>
                  <span className="autonomy-rung-number">
                    {String(rung.level).padStart(2, "0")}
                  </span>
                  <div>
                    <small>
                      {rung.level === 0
                        ? "BASELINE"
                        : `UNLOCKS AT CAPABILITY ${String(rung.unlockCapability)}`}
                    </small>
                    <strong>{rung.displayName}</strong>
                  </div>
                  <span className="autonomy-rung-status">
                    {rung.current ? "CURRENT" : rung.unlocked ? "UNLOCKED" : "LOCKED"}
                  </span>
                </header>
                <div className="autonomy-rung-body">
                  <section className="autonomy-benefit">
                    <span>RESEARCH PAYOFF</span>
                    <strong>
                      {rung.maximumResearchMultiplier > 1
                        ? `${rung.current ? "Active" : "Projected"} research ×${formatMultiplier(rung.currentResearchMultiplier)}`
                        : rung.evidenceQualityBonus > 0
                          ? `+${String(rung.evidenceQualityBonus)} evaluation evidence`
                          : "No research acceleration"}
                    </strong>
                    {rung.maximumResearchMultiplier > rung.currentResearchMultiplier ? (
                      <small>
                        Rises to ×{formatMultiplier(rung.maximumResearchMultiplier)} at
                        capability {rung.fullAccelerationCapability}
                      </small>
                    ) : null}
                    {rung.evidenceQualityBonus > 0 &&
                    rung.maximumResearchMultiplier > 1 ? (
                      <small>
                        +{rung.evidenceQualityBonus} evaluation evidence quality
                      </small>
                    ) : null}
                  </section>
                  <section className="autonomy-safety">
                    <span>SAFETY IMPLICATION</span>
                    <p>{rung.safetyLabel}</p>
                  </section>
                  <section className="autonomy-systems">
                    <span>SYSTEMS EXPOSED</span>
                    <p>{rung.exposedSystems.join(" · ")}</p>
                  </section>
                  <small className="autonomy-cost">{rung.costLabel}</small>
                </div>
                {!rung.unlocked && rung.level > 0 ? (
                  <div className="autonomy-unlock-progress">
                    <span>
                      Measured capability{" "}
                      {formatCapabilityScore(
                        view.models.autonomy.measuredCapability ?? 0,
                      )}{" "}
                      / {rung.unlockCapability}
                    </span>
                    <progress
                      max={rung.unlockCapability}
                      value={Math.min(
                        rung.unlockCapability,
                        view.models.autonomy.measuredCapability ?? 0,
                      )}
                    />
                    {rung.blockers.length === 0 ? null : (
                      <small className="autonomy-blockers">
                        {rung.blockers.join(" · ")}
                      </small>
                    )}
                  </div>
                ) : null}
                {rung.current ? null : rung.available ? (
                  <button
                    type="button"
                    className={
                      raising && rung.level >= 4 ? "primary danger" : "secondary"
                    }
                    disabled={!validation.ok}
                    onClick={() => {
                      if (requiresConfirmation) {
                        setPendingCriticalLevel(rung.level);
                      } else {
                        runtime.dispatch(command);
                      }
                    }}
                  >
                    {raising
                      ? `Grant level ${String(rung.level)} access`
                      : "Reduce to this level"}
                  </button>
                ) : rung.unlocked ? (
                  <small className="autonomy-blockers">{rung.blockers.join(" · ")}</small>
                ) : null}
              </article>
            );
          })}
        </div>
        {view.models.autonomy.incidents.length > 0 ? (
          <div className="autonomy-ledger">
            <h3>Incident ledger</h3>
            <ul>
              {view.models.autonomy.incidents.map((incident, index) => (
                <li
                  key={`${incident.stage}:${String(incident.detectedAtTick)}:${String(index)}`}
                >
                  <strong>{incident.stageLabel}</strong>
                  <span>week {incident.detectedAtTick}</span>
                  <small>
                    {incident.responseTag ?? incident.status.replace("-", " ")}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {pendingCriticalRung?.confirmationPhrase === undefined ? null : (
        <CriticalAutonomyConfirmationDialog
          confirmationPhrase={pendingCriticalRung.confirmationPhrase}
          displayName={pendingCriticalRung.displayName}
          exposedSystems={pendingCriticalRung.exposedSystems}
          level={pendingCriticalRung.level}
          onOpen={() => runtime.pause()}
          onCancel={() => setPendingCriticalLevel(undefined)}
          onConfirm={(confirmationText) => {
            const command = setAutonomyCommand(
              view,
              pendingCriticalRung.level,
              confirmationText,
            );
            if (!runtime.validate(command).ok) return;
            runtime.dispatch(command);
            setPendingCriticalLevel(undefined);
          }}
        />
      )}
    </>
  );
}
