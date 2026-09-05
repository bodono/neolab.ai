import { useState, type ReactElement } from "react";

import {
  COALITION_MECHANIC_ENABLED,
  formatValuation,
  type CoalitionAssetKind,
  type GameView,
  type RivalWorldView,
} from "@neolab/sim/public";

import {
  joinProgrammeCommand,
  leaveProgrammeCommand,
  startLobbyingCommand,
  coalitionProjectCommand,
  proposeCoalitionCommand,
  ratifyCoalitionCommand,
} from "../../app/command-builders.ts";
import { majorProjectActionLabel } from "../../app/major-projects.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import { formatCapabilityScore } from "../models/capability-format.ts";
import { PixelPortrait } from "../portraits/pixel-portrait.tsx";

// TODO(government-lobbying-redesign): keep lobbying off the player-facing
// World surface until its choices, outcomes, and relationship to government
// programmes are clear enough to justify the extra strategic layer. The sim
// machinery remains intact for a future redesign.
const GOVERNMENT_LOBBYING_UI_ENABLED = false;

function label(value: string): string {
  return value.replaceAll("-", " ");
}

function playerCandidateProgrammeLabel(view: GameView): string {
  if (view.meta.raceEscalation.playerCandidateUnderReview) {
    return "Candidate under final review";
  }
  const components = view.models.candidateProgramme.components;
  const complete = components.filter(
    (component) => component.status === "complete",
  ).length;
  const building = components.filter(
    (component) => component.status === "in-progress",
  ).length;
  if (complete === components.length) {
    return `${String(complete)}/${String(components.length)} works complete · candidate pending`;
  }
  if (complete === 0 && building === 0) {
    return `0/${String(components.length)} works · not started`;
  }
  return `${String(complete)}/${String(components.length)} complete${
    building === 0 ? "" : ` · ${String(building)} building`
  }`;
}

function rivalCandidateProgrammeLabel(rival: RivalWorldView): string {
  if (rival.candidateCountdown !== undefined) {
    return `Candidate live · ${rival.candidateCountdown.stageLabel} · ${rival.candidateCountdown.estimateLabel} to deployment`;
  }
  const { building, completed } = rival.candidateWorks;
  if (completed === 0 && building === 0) {
    return "0/4 works · no programme detected";
  }
  if (completed === 4) return "4/4 works complete · candidate pending";
  return `${String(completed)}/4 complete${
    building === 0 ? "" : ` · ${String(building)} building`
  }`;
}

/** The race banner reports the leading rival's actual visible position. */
function raceStatusTitle(view: GameView): string {
  const race = view.meta.raceEscalation;
  if (race.playerCandidateUnderReview) {
    return "Your candidate is under review while the race continues";
  }
  const leader = race.leader;
  if (leader === undefined) return "No rival lab is in the field";
  if (leader.phase === "countdown") {
    return `${leader.labName} is deploying an AGI candidate${
      leader.countdownLabel === undefined ? "" : ` — ${leader.countdownLabel}`
    }`;
  }
  if (leader.phase === "programme") {
    return `${leader.labName} has ${String(leader.worksComplete)} of ${String(
      leader.worksTotal,
    )} candidate works standing`;
  }
  return `${leader.labName} leads the field`;
}

function raceStatusMarker(view: GameView): string {
  const leader = view.meta.raceEscalation.leader;
  if (leader?.phase === "countdown") return "COUNTDOWN LIVE";
  if (leader?.phase === "programme") {
    return `${String(leader.worksComplete)}/${String(leader.worksTotal)} WORKS`;
  }
  if (leader?.capabilityRange !== undefined) {
    const [low, high] = leader.capabilityRange;
    return `EST ${String(Math.round(low))}–${String(Math.round(high))}`;
  }
  return "NO CAPABILITY SIGNAL";
}

function raceStatusBody(view: GameView): string {
  const race = view.meta.raceEscalation;
  if (race.playerCandidateUnderReview) {
    return "Rival clocks continue during final review.";
  }
  const leader = race.leader;
  if (leader === undefined) return "No rival lab is currently in the field.";
  if (leader.phase === "countdown") {
    return `${leader.labName} has a candidate. Its deployment countdown is running.`;
  }
  if (leader.phase === "programme") {
    const building =
      leader.worksBuilding > 0
        ? `, with ${String(leader.worksBuilding)} more under construction`
        : "";
    return `${leader.labName}: ${String(leader.worksComplete)}/${String(
      leader.worksTotal,
    )} works complete${building}. No countdown until full candidacy.`;
  }
  const confidence =
    leader.capabilityConfidence === undefined
      ? ""
      : ` at ${leader.capabilityConfidence} confidence`;
  return `${leader.labName} leads current estimates${confidence}. No countdown until full candidacy.`;
}

function raceStatusProgress(view: GameView): number {
  const race = view.meta.raceEscalation;
  if (race.playerCandidateUnderReview) return 100;
  const leader = race.leader;
  if (leader === undefined) return 0;
  if (leader.phase === "countdown") {
    return leader.countdownUrgency === "imminent"
      ? 98
      : leader.countdownUrgency === "urgent"
        ? 90
        : 80;
  }
  const works =
    ((leader.worksComplete + leader.worksBuilding * 0.5) / leader.worksTotal) * 70;
  const capability =
    leader.capabilityRange === undefined
      ? 0
      : Math.min(
          10,
          ((leader.capabilityRange[0] + leader.capabilityRange[1]) / 200) * 10,
        );
  return Math.min(78, works + capability);
}

function CompetitiveIntelligence({
  focusedRivalId,
  view,
}: {
  readonly focusedRivalId?: string;
  readonly view: GameView;
}): ReactElement {
  const currentPlayerModel = view.models.cards.find((model) => model.isCurrentModel);

  return (
    <section className="console-panel rival-operations" aria-labelledby="rivals-title">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">COMPETITIVE INTELLIGENCE</p>
          <h2 id="rivals-title">The AGI race</h2>
        </div>
        <div className="panel-heading-tools">
          <MechanicHelp label="Intelligence estimates">
            Your figures are current estimates. Rival figures are intelligence ranges;
            better intelligence narrows them.
          </MechanicHelp>
          <span>Five labs</span>
        </div>
      </header>
      <div className="rival-score-grid" aria-label="Competitive intelligence scoreboard">
        <article className="rival-score-card player-score-card">
          <header className="rival-score-identity">
            <PixelPortrait
              className="rival-leader-portrait"
              subjectId={view.identity.leaderId}
              name={view.identity.leaderName}
              altText={`${view.identity.leaderName}, leader of ${view.identity.labName}`}
            />
            <div>
              <span>Your lab</span>
              <strong>{view.identity.labName}</strong>
              <small className="rival-leader-name">{view.identity.leaderName}</small>
              <small>
                {currentPlayerModel?.displayName ??
                  `${view.identity.aiName} · no evaluated model`}
              </small>
            </div>
          </header>
          <div className="rival-score-value">
            <strong>
              {currentPlayerModel === undefined
                ? "—"
                : formatCapabilityScore(currentPlayerModel.frontierCapabilityEstimate)}
            </strong>
            <span>/ 100</span>
          </div>
          <p>
            {currentPlayerModel === undefined
              ? "Train and evaluate a model to establish a score"
              : `${currentPlayerModel.capabilityConfidence} confidence · evaluated model`}
          </p>
          <dl className="rival-score-facts">
            <div>
              <dt>Market valuation</dt>
              <dd>{view.finance.valuation.markLabel}</dd>
              <small>Current market mark</small>
            </div>
          </dl>
          <div
            className={`rival-programme-status${
              view.meta.raceEscalation.playerCandidateUnderReview
                ? " candidate-live"
                : view.models.candidateProgramme.components.some(
                      (component) =>
                        component.status === "complete" ||
                        component.status === "in-progress",
                    )
                  ? " programme-active"
                  : ""
            }`}
          >
            <span>AGI programme</span>
            <strong>{playerCandidateProgrammeLabel(view)}</strong>
          </div>
        </article>
        {view.world.rivals.map((rival) => (
          <article
            key={rival.labId}
            className={`rival-score-card${
              rival.labId === focusedRivalId ? " focused-rival-score-card" : ""
            }`}
          >
            <header className="rival-score-identity">
              <PixelPortrait
                className="rival-leader-portrait"
                subjectId={rival.leaderId}
                name={rival.leaderName}
                altText={`${rival.leaderName}, leader of ${rival.labName}`}
              />
              <div>
                <span>Rival</span>
                <strong>{rival.labName}</strong>
                <small className="rival-leader-name">{rival.leaderName}</small>
                <small>{rival.aiName}</small>
              </div>
            </header>
            <div className="rival-score-value">
              <strong>
                {rival.latestCapabilitySignal === undefined
                  ? "—"
                  : `${rival.latestCapabilitySignal.estimateRange[0].toFixed(
                      0,
                    )}–${rival.latestCapabilitySignal.estimateRange[1].toFixed(0)}`}
              </strong>
              <span>/ 100</span>
            </div>
            <p>
              {rival.latestCapabilitySignal === undefined
                ? "No reliable public estimate yet"
                : `${rival.latestCapabilitySignal.confidence} confidence · intelligence range`}
            </p>
            <dl className="rival-score-facts">
              <div>
                <dt>Reported valuation</dt>
                <dd>{rival.reportedValuation.label}</dd>
                <small>Quarterly rumour range</small>
              </div>
            </dl>
            <div
              className={`rival-programme-status${
                rival.candidateCountdown !== undefined
                  ? " candidate-live"
                  : rival.candidateWorks.completed > 0 ||
                      rival.candidateWorks.building > 0
                    ? " programme-active"
                    : ""
              }`}
            >
              <span>AGI programme</span>
              <strong>{rivalCandidateProgrammeLabel(rival)}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorldWorkspace({
  focusedRivalId,
  onOpenDecision,
  runtime,
  view,
}: {
  readonly focusedRivalId?: string;
  readonly onOpenDecision: (instanceId: string) => void;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const [coalitionInvites, setCoalitionInvites] = useState<readonly string[]>([]);
  const [governmentMember, setGovernmentMember] = useState(false);
  const [independentBodyMember, setIndependentBodyMember] = useState(false);
  const [assetSelection, setAssetSelection] = useState("");
  const [notice, setNotice] = useState<string>();
  const proposalCommand = proposeCoalitionCommand(
    view,
    coalitionInvites,
    governmentMember,
    independentBodyMember,
  );
  const proposalValidation = runtime.validate(proposalCommand);
  const coalition = view.world.coalition;
  const availableAssetOptions = coalition?.assetOptions.filter(
    (option) => option.available,
  );
  const defaultAssetOption =
    availableAssetOptions?.find((option) => option.uniqueToPlayer) ??
    availableAssetOptions?.[0];
  const effectiveAssetSelection =
    assetSelection ||
    (defaultAssetOption === undefined
      ? ""
      : `${defaultAssetOption.contributorLabId}|${defaultAssetOption.assetKind}`);
  const [assetContributorId, assetKindValue] = effectiveAssetSelection.split("|");
  const assetKind = assetKindValue as CoalitionAssetKind | undefined;
  const activeCoalitionProjects = view.facilities.projects.filter(
    (project) => project.kind === "coalition" && project.status !== "completed",
  );

  function dispatch(command: Parameters<BrowserGameRuntime["dispatch"]>[0]): void {
    try {
      runtime.dispatch(command);
      setNotice("Action recorded. The institutional machinery has begun moving.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="world-workspace">
      <section
        className="console-panel race-escalation-panel"
        aria-labelledby="race-escalation-title"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">GLOBAL RACE PRESSURE // COMPETITORS DO NOT WAIT</p>
            <h2 id="race-escalation-title">{raceStatusTitle(view)}</h2>
          </div>
          <strong>{raceStatusMarker(view)}</strong>
        </header>
        <p>{raceStatusBody(view)}</p>
        <div
          className="race-escalation-track"
          role="progressbar"
          aria-label={raceStatusBody(view)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(raceStatusProgress(view))}
        >
          <i style={{ width: `${String(raceStatusProgress(view))}%` }} />
        </div>
      </section>
      <CompetitiveIntelligence
        view={view}
        {...(focusedRivalId === undefined ? {} : { focusedRivalId })}
      />
      <section
        className={`console-panel regulation-board regulation-${view.politics.pressureBand}`}
        aria-labelledby="regulation-title"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">STATE CAPACITY HAS LOGGED ON</p>
            <h2 id="regulation-title">Government & regulation</h2>
          </div>
          <div className="panel-heading-tools">
            <MechanicHelp label="Regulatory pressure">
              Attention and risk raise pressure. Trust and strategic value reduce it.
            </MechanicHelp>
            <span className="regulation-band">
              {view.politics.pressureBand.toUpperCase()}
            </span>
          </div>
        </header>
        <div className="regulation-readout">
          <article className="regulation-pressure">
            <span>Intervention pressure</span>
            <strong>{view.politics.interventionPressure.toFixed(0)}</strong>
          </article>
          <article className="regulation-attention">
            <span>Government attention</span>
            <strong>{view.politics.governmentAttention.toFixed(0)}</strong>
          </article>
          <article className="regulation-trust">
            <span>Government trust</span>
            <strong>{view.politics.governmentTrust.toFixed(0)}</strong>
          </article>
          <article className="regulation-dependence">
            <span>Strategic dependence</span>
            <strong>{view.politics.strategicDependence.toFixed(0)}</strong>
          </article>
        </div>
        <p className="regulation-explanation">
          <strong>
            Why pressure is {view.politics.interventionPressure.toFixed(0)}:
          </strong>{" "}
          {view.politics.pressureExplanation}
        </p>
        <ol className="regulation-band-ladder">
          {view.politics.pressureBands.map((entry) => (
            <li key={entry.band} className={entry.current ? "current" : ""}>
              <b>{entry.floor}+</b>
              <span>{entry.band}</span>
            </li>
          ))}
        </ol>
        <small>
          Next formal assessment in {view.politics.nextQuarterInWeeks} weeks.
          {view.politics.pressureToNextBand === undefined
            ? " Highest pressure band."
            : ` Next band in ${view.politics.pressureToNextBand.toFixed(1)}.`}
        </small>
        <small className="programme-stack-note">
          Programme terms stack. Payments track current accelerator prices.
        </small>
        <div className="programme-grid">
          {view.politics.programmes.map((programme) => {
            const joinCmd = joinProgrammeCommand(view, programme.id);
            const leaveCmd = leaveProgrammeCommand(view, programme.id);
            return (
              <article
                key={programme.id}
                className={`programme-card ${programme.active ? "active" : programme.canJoin ? "available" : "locked"}`}
              >
                <header>
                  <strong>{programme.displayName}</strong>
                  <span>
                    {programme.active
                      ? "ENROLLED"
                      : programme.canJoin
                        ? "AVAILABLE"
                        : "LOCKED"}
                  </span>
                </header>
                <p>{programme.summary}</p>
                <small className="programme-benefit">
                  <strong>Benefits:</strong>{" "}
                  {programme.quarterlyCashMillions > 0
                    ? `${formatValuation(programme.quarterlyCashMillions)} each quarter now · `
                    : ""}
                  {programme.benefitLabel}
                </small>
                <small className="programme-cost">
                  <strong>Trade-offs:</strong> {programme.costLabel}
                </small>
                <small className="programme-endgame">
                  <strong>Endgame:</strong> {programme.endgameLabel}
                </small>
                {programme.active ? (
                  <>
                    {programme.championRefusalAvailable ? (
                      <small className="programme-privilege">
                        Standing available: you may refuse the state once.
                      </small>
                    ) : null}
                    {programme.exitProgrammeCount > 1 ? (
                      <small className="programme-cascade">
                        Leaving this rung also exits every programme above it.
                      </small>
                    ) : null}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => runtime.dispatch(leaveCmd)}
                    >
                      {programme.exitProgrammeCount > 1
                        ? `Leave ${programme.exitProgrammeCount} programmes · trust −${programme.exitTrustCost}`
                        : `Leave · trust −${programme.exitTrustCost}`}
                    </button>
                  </>
                ) : programme.canJoin ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => runtime.dispatch(joinCmd)}
                  >
                    Accept terms &amp; join
                  </button>
                ) : (
                  <small className="programme-blockers">
                    {programme.blockers.join(" · ")}
                  </small>
                )}
              </article>
            );
          })}
        </div>
        {GOVERNMENT_LOBBYING_UI_ENABLED ? (
          <details className="lobbying-section">
            <summary>
              Lobby the government
              <small>Failure still spends the cost.</small>
            </summary>
            <div className="lobbying-grid">
              {view.politics.lobbyingOptions.map((option) => {
                const command = startLobbyingCommand(
                  view,
                  option.objective,
                  option.approach,
                );
                return (
                  <article
                    key={`${option.objective}:${option.approach}`}
                    className={`lobbying-card ${option.available ? "" : "locked"}`}
                  >
                    <header>
                      <strong>{option.displayName}</strong>
                      <span>{option.approachName}</span>
                    </header>
                    <p className="lobbying-success">{option.successLabel}</p>
                    <small>
                      {formatValuation(option.cashCostMillions)} · {option.auraCost} Aura
                      · {option.durationWeeks} weeks ·{" "}
                      {Math.round(option.chanceRange[0] * 100)}–
                      {Math.round(option.chanceRange[1] * 100)}% ({option.chanceLabel})
                    </small>
                    {option.available ? (
                      <button type="button" onClick={() => runtime.dispatch(command)}>
                        Start campaign
                      </button>
                    ) : (
                      <small className="programme-blockers">
                        {option.blockers.join(" · ")}
                      </small>
                    )}
                  </article>
                );
              })}
            </div>
          </details>
        ) : null}
        {view.politics.pendingInterventions.length === 0 ? null : (
          <div className="intervention-list">
            {[...view.politics.pendingInterventions].reverse().map((intervention) => {
              const decision = view.eventQueue.items.find(
                (item) => item.tokens["INTERVENTION_ID"] === intervention.interventionId,
              );
              return (
                <article
                  key={intervention.interventionId}
                  className={`intervention-card intervention-${intervention.status}`}
                >
                  <div>
                    <strong>{label(intervention.kind)}</strong>
                    <span>
                      {intervention.status === "pending-event"
                        ? intervention.decisionState === "scheduled"
                          ? "DECISION NEXT WEEK"
                          : intervention.decisionState === "open"
                            ? "DECISION OPEN"
                            : "RESPONSE FILED"
                        : intervention.status.toUpperCase()}
                    </span>
                  </div>
                  <p>
                    {intervention.status === "pending-event"
                      ? intervention.decisionState === "scheduled"
                        ? "Decision arrives next week."
                        : intervention.decisionState === "open"
                          ? "Response required."
                          : "Response filed; resolves next week."
                      : (intervention.response ??
                        (intervention.status === "failed"
                          ? "The intervention collapsed before taking effect."
                          : "Resolved."))}
                  </p>
                  <small>
                    Triggered by {label(intervention.trigger)} at pressure{" "}
                    {intervention.pressureAtTrigger.toFixed(0)}
                  </small>
                  {intervention.status === "pending-event" && decision !== undefined ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => onOpenDecision(decision.instanceId)}
                    >
                      Open government decision
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {/* TODO(coalition-redesign): board hidden while the mechanic is
          disabled; the panel and its styles stay for the redesign. */}
      {COALITION_MECHANIC_ENABLED && (
        <section
          className="console-panel coalition-board"
          aria-labelledby="coalition-title"
        >
          <header className="panel-heading">
            <div>
              <p className="eyebrow">THE HARD ROUTE</p>
              <h2 id="coalition-title">Coalition board</h2>
            </div>
            <span>{coalition?.status.toUpperCase() ?? "NO CHARTER"}</span>
          </header>
          {coalition === undefined ? (
            <div className="coalition-proposal">
              <p>
                Coalitions require trust, shared protocols, verification, contributions,
                and 20 Aura.
              </p>
              <fieldset>
                <legend>Invite signatories</legend>
                {view.world.proposalCandidates.map((candidate) => (
                  <label key={candidate.labId}>
                    <input
                      type="checkbox"
                      checked={coalitionInvites.includes(candidate.labId)}
                      onChange={(event) =>
                        setCoalitionInvites((current) =>
                          event.target.checked
                            ? [...current, candidate.labId]
                            : current.filter((id) => id !== candidate.labId),
                        )
                      }
                    />
                    <span>{candidate.labName}</span>
                    <small>{candidate.aiName}</small>
                  </label>
                ))}
              </fieldset>
              <div className="institution-options">
                <label>
                  <input
                    type="checkbox"
                    checked={governmentMember}
                    onChange={(event) => setGovernmentMember(event.target.checked)}
                  />
                  Government charter member
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={independentBodyMember}
                    onChange={(event) => setIndependentBodyMember(event.target.checked)}
                  />
                  Independent verification body
                </label>
              </div>
              <button
                className="primary"
                type="button"
                disabled={!proposalValidation.ok}
                title={
                  proposalValidation.ok
                    ? proposalValidation.preview.summary
                    : proposalValidation.errors.map((error) => error.message).join(" · ")
                }
                onClick={() => dispatch(proposalCommand)}
              >
                Propose coalition
              </button>
              {proposalValidation.ok ? null : (
                <small className="coalition-blockers">
                  {proposalValidation.errors.map((error) => error.message).join(" · ")}
                </small>
              )}
            </div>
          ) : (
            <>
              <div className="coalition-identity">
                <p>
                  {coalition.memberNames.join(" · ")}
                  {coalition.governmentMember ? " · Government" : ""}
                  {coalition.independentBodyMember ? " · Independent body" : ""}
                </p>
                <span>{coalition.activeWeeks}/26 minimum weeks</span>
              </div>
              <div className="coalition-metrics">
                {[
                  ["Charter clarity", coalition.charterClarity],
                  ["Shared protocol", coalition.sharedProtocolQuality],
                  ["Verification", coalition.verification],
                  ["Aura invested", coalition.formationAuraSpent],
                ].map(([metric, value]) => (
                  <article key={metric}>
                    <span>{metric}</span>
                    <strong>{value}</strong>
                  </article>
                ))}
              </div>
              <div className="coalition-checklist">
                {coalition.checks.map((check) => (
                  <div
                    key={check.id}
                    className={check.satisfied ? "complete" : undefined}
                  >
                    <i aria-hidden="true">{check.satisfied ? "✓" : "·"}</i>
                    <span>{label(check.id)}</span>
                    <small>{check.detail}</small>
                  </div>
                ))}
              </div>
              {activeCoalitionProjects.length === 0 ? null : (
                <div className="coalition-active-projects">
                  {activeCoalitionProjects.map((project) => (
                    <span key={project.projectId}>
                      {project.displayName} · {project.status} · {project.progressLabel}
                    </span>
                  ))}
                </div>
              )}
              <div className="coalition-project-grid">
                {coalition.projectOptions.map((option) => (
                  <article key={option.projectType}>
                    <h3>{option.displayName}</h3>
                    <p>
                      {formatValuation(option.cashCostMillions)} · {option.auraCost} Aura
                      · {option.durationWeeks}w
                    </p>
                    <button
                      className="secondary"
                      type="button"
                      disabled={!option.available}
                      title={option.blockers.join(" · ")}
                      onClick={() =>
                        dispatch(
                          coalitionProjectCommand(
                            view,
                            coalition.coalitionId,
                            option.projectType,
                          ),
                        )
                      }
                    >
                      {majorProjectActionLabel(
                        view,
                        "Commission",
                        "Add to project queue",
                      )}
                    </button>
                  </article>
                ))}
              </div>
              <div className="asset-contribution">
                <label>
                  Signatory asset
                  <select
                    value={effectiveAssetSelection}
                    onChange={(event) => setAssetSelection(event.target.value)}
                  >
                    {coalition.assetOptions.map((option) => (
                      <option
                        key={`${option.contributorLabId}:${option.assetKind}`}
                        value={`${option.contributorLabId}|${option.assetKind}`}
                        disabled={!option.available}
                      >
                        {option.contributorName} · {label(option.assetKind)}
                        {option.uniqueToPlayer ? " · UNIQUE" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  type="button"
                  disabled={assetContributorId === "" || assetKind === undefined}
                  onClick={() =>
                    dispatch(
                      coalitionProjectCommand(
                        view,
                        coalition.coalitionId,
                        "asset-contribution",
                        assetContributorId,
                        assetKind,
                      ),
                    )
                  }
                >
                  {majorProjectActionLabel(
                    view,
                    "Verify contribution",
                    "Add verification to queue",
                  )}
                </button>
              </div>
              <button
                className="primary ratify-button"
                type="button"
                disabled={!coalition.eligible}
                onClick={() =>
                  dispatch(ratifyCoalitionCommand(view, coalition.coalitionId))
                }
              >
                Ratify charter
              </button>
            </>
          )}
          {notice === undefined ? null : <p className="world-notice">{notice}</p>}
        </section>
      )}
    </div>
  );
}
