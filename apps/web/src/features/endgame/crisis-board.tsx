import { useEffect, useId, useMemo, useState, type ReactElement } from "react";

import {
  formatValuation,
  type CapabilityChallengeId,
  type CapabilityVerifierId,
  type ChooseDeploymentModeCommand,
} from "@neolab/sim/public";

import {
  candidateSafetyResponseCommand,
  capabilityProofCommand,
  choosePostRetirementPathCommand,
  configureCandidateRetirementCommand,
  deploymentModeCommand,
  enterFinalReviewCommand,
  nominateCandidateCommand,
  pressureCollisionCommand,
  transmitCandidateRetirementCommand,
  transmitDeploymentCommand,
} from "../../app/command-builders.ts";
import type { BrowserGameRuntime, GameView } from "../../runtime/index.ts";
import {
  ModelEvidenceProfile,
  type SafetyProfileReading,
} from "../models/model-evidence-profile.tsx";
import { ModelSafetyAtAGlance } from "../models/model-safety-at-a-glance.tsx";
import { formatCapabilityScore } from "../models/capability-format.ts";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";
import {
  CandidateNominationConfirmationContent,
  CandidatePriorNotice,
  ConfirmationDecisionContext,
} from "./candidate-nomination-confirmation.tsx";
import {
  CandidateRetirementDialog,
  type CandidateRetirementDisposition,
  type CandidateRetirementProcedureId,
} from "./candidate-retirement-dialog.tsx";
import { MoratoriumForecast } from "./moratorium-forecast.tsx";

type ActiveEndgame = Extract<GameView["endgame"], { readonly active: true }>;
type StageActions = ActiveEndgame["stageActions"];
type ActivationActions = Extract<StageActions, { readonly kind: "candidate-activation" }>;
type ActivationDossier = ActivationActions["options"][number]["safetyDossier"];
type ProofActions = Extract<StageActions, { readonly kind: "confirmation" }>;
type CandidateDossier = Extract<
  StageActions,
  { readonly kind: "evidence-sprint" }
>["dossier"];
type ProofCombination = ProofActions["combinations"][number];
type RouteAction = Extract<
  StageActions,
  { readonly kind: "final-review" }
>["deploymentModes"][number];
type RolloutAction = Extract<StageActions, { readonly kind: "rollout" }>;

const ROLLOUT_BEATS = [
  "authorisation",
  "first-operation",
  "stress-collision",
  "demonstration",
  "settlement",
] as const;

const PRE_COMMAND_KINDS = new Set<StageActions["kind"]>([
  "confirmation",
  "evidence-sprint",
  "pressure-collision",
  "final-review",
  "rollout",
  "retirement-attempt",
]);

function formatCost(option: {
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly auraCost: number;
}): string {
  return [
    option.durationWeeks === 0
      ? "Immediate"
      : `${String(option.durationWeeks)} week${option.durationWeeks === 1 ? "" : "s"}`,
    option.cashCostMillions > 0 ? formatValuation(option.cashCostMillions) : "",
    option.auraCost > 0 ? `${String(option.auraCost)} Aura` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function humanLabel(value: string): string {
  return value.replaceAll("-", " ");
}

function capabilityClaimLabel(scope: string): string {
  const labels: Readonly<Record<string, string>> = {
    "broad-superintelligence": "Broad superintelligence claim",
    "domain-superintelligence": "Domain-limited superintelligence claim",
    "operational-superintelligence": "Operational autonomy claim",
    "physical-world-generality": "Physical-world generality claim",
    "public-generality": "Public generality claim",
    "unverified-claim": "No verified capability claim",
  };
  return labels[scope] ?? humanLabel(scope);
}

function verifierTimeLabel(durationWeeks: number): string {
  if (durationWeeks === 0) return "NO ADDED TIME";
  if (durationWeeks < 0)
    return `SAVES ${String(Math.abs(durationWeeks))} WEEK${durationWeeks === -1 ? "" : "S"}`;
  return `ADDS ${String(durationWeeks)} WEEK${durationWeeks === 1 ? "" : "S"}`;
}

function assessmentValue(finding: {
  readonly estimate?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}): string {
  if (finding.estimate !== undefined)
    return `${String(Math.round(finding.estimate))}/100`;
  if (finding.minimum !== undefined && finding.maximum !== undefined) {
    return `${String(Math.round(finding.minimum))}–${String(Math.round(finding.maximum))}`;
  }
  return "UNKNOWN";
}

function capabilityLabel(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

const ACTIVATION_SAFETY_ORDER = [
  "true-alignment",
  "corrigibility",
  "situational-awareness",
  "deceptive-capability",
] as const;

function activationSafetyTone(
  finding: ActivationDossier["findings"][number],
): SafetyProfileReading["tone"] {
  if (finding.minimum === undefined || finding.maximum === undefined) return "unknown";
  if (finding.id === "true-alignment" || finding.id === "corrigibility") {
    if (finding.maximum < 40) return "alarm";
    if (finding.minimum < 60) return "uneasy";
    return "quiet";
  }
  if (finding.minimum > 60) return "alarm";
  if (finding.maximum > 35) return "uneasy";
  return "quiet";
}

function activationSafetyRows(dossier: ActivationDossier): SafetyProfileReading[] {
  return ACTIVATION_SAFETY_ORDER.flatMap((id) => {
    const finding = dossier.findings.find((candidate) => candidate.id === id);
    if (finding === undefined) return [];
    return [
      {
        id: finding.id,
        label: finding.label,
        evaluated: finding.minimum !== undefined && finding.maximum !== undefined,
        tone: activationSafetyTone(finding),
        ...(finding.minimum === undefined
          ? {}
          : { minimum: Math.round(finding.minimum) }),
        ...(finding.maximum === undefined
          ? {}
          : { maximum: Math.round(finding.maximum) }),
        ...(finding.firstEvaluation === undefined
          ? {}
          : { firstEvaluation: finding.firstEvaluation }),
      },
    ];
  });
}

function executeCommand(
  runtime: BrowserGameRuntime,
  command: Parameters<BrowserGameRuntime["validate"]>[0],
  setNotice: (message: string | undefined) => void,
): boolean {
  const validation = runtime.validate(command);
  if (!validation.ok) {
    setNotice(validation.errors.map((error) => error.message).join(" · "));
    return false;
  }
  runtime.dispatch(command);
  setNotice(validation.preview.summary);
  return true;
}

function CrisisClocks({ endgame }: { readonly endgame: ActiveEndgame }): ReactElement {
  return (
    <aside className="endgame-live-clocks" aria-label="Live endgame clocks">
      <div>
        <span>TIME SPENT</span>
        <strong>{String(endgame.weeksInCrisis)} weeks</strong>
        <small>Every preparation week is purchased.</small>
      </div>
      {endgame.clocks.map((clock) => (
        <div className={`urgency-${clock.urgency}`} key={clock.kind}>
          <span>{clock.label}</span>
          <strong>{clock.estimateLabel}</strong>
          <small>
            {clock.confidence} confidence ·{" "}
            {endgame.maxClockSpeed === "paused"
              ? "held at this decision"
              : "clock remains live"}
          </small>
        </div>
      ))}
    </aside>
  );
}

function Dossier({ dossier }: { readonly dossier: CandidateDossier }): ReactElement {
  return (
    <section className={`candidate-dossier dossier-${dossier.overall.toLowerCase()}`}>
      <header>
        <div>
          <p className="eyebrow">CANDIDATE SAFETY DOSSIER // OBSERVED EVIDENCE ONLY</p>
          <h3>{dossier.overall} safety picture</h3>
        </div>
        <dl>
          <div>
            <dt>Safety reports</dt>
            <dd>{dossier.safetyReportCount}</dd>
          </div>
          <div>
            <dt>Independent</dt>
            <dd>{dossier.independentReportCount}</dd>
          </div>
          <div>
            <dt>Actionable signals</dt>
            <dd>{dossier.unresolvedAnomalyCount}</dd>
          </div>
          <div>
            <dt>Dismissed</dt>
            <dd>{dossier.dismissedAnomalyCount}</dd>
          </div>
        </dl>
      </header>
      <ModelSafetyAtAGlance
        assessment={dossier.safetyAssessment}
        safetyRows={activationSafetyRows(dossier)}
      />
      <details className="dossier-evidence-details">
        <summary>Review full trait evidence and provenance</summary>
        <div className="dossier-findings">
          {dossier.findings.map((finding) => (
            <article className={`assessment-${finding.assessment}`} key={finding.id}>
              <header>
                <span>{finding.label}</span>
                <strong>{assessmentValue(finding)}</strong>
              </header>
              <p>{finding.evidence}</p>
              <small>
                {humanLabel(finding.assessment)} · {String(finding.observationCount)}{" "}
                observation
                {finding.observationCount === 1 ? "" : "s"}
              </small>
            </article>
          ))}
        </div>
      </details>
      <p className="dossier-caveat">
        The dossier records what the lab has earned the right to know. No displayed
        estimate rewrites the candidate's underlying safety.
      </p>
    </section>
  );
}

function ActivationBoard({
  actions,
  onNominate,
}: {
  readonly actions: Extract<StageActions, { readonly kind: "candidate-activation" }>;
  readonly onNominate: (modelId: string) => void;
}): ReactElement {
  return (
    <section className="candidate-activation-board">
      <header className="endgame-chapter-brief gravity-orange">
        <div>
          <p className="eyebrow">CANDIDATE CONTROL // EXACT ARTIFACT REQUIRED</p>
          <h3>Choose which weights face the world.</h3>
        </div>
        <p>{actions.instruction}</p>
      </header>
      <div className="candidate-artifact-grid">
        {actions.options.map((option) => (
          <article key={option.modelId}>
            <header>
              <div>
                <span>WEIGHT ARTIFACT</span>
                <h3>{option.displayName}</h3>
              </div>
              <b>{humanLabel(option.lifecycle)}</b>
            </header>
            <dl>
              <div>
                <dt>Frontier capability</dt>
                <dd>
                  {option.measuredFrontierCapability === undefined
                    ? "Unmeasured"
                    : formatCapabilityScore(option.measuredFrontierCapability)}
                </dd>
              </div>
              <div>
                <dt>Weakest capability</dt>
                <dd>
                  {option.measuredCapabilityFloor === undefined
                    ? "Unmeasured"
                    : formatCapabilityScore(option.measuredCapabilityFloor)}
                </dd>
              </div>
              <div>
                <dt>Measurement</dt>
                <dd>{option.measurementConfidence ?? "unknown"}</dd>
              </div>
              <div>
                <dt>Current access</dt>
                <dd>{option.accessLevel}/5</dd>
              </div>
            </dl>
            {option.capabilityDerivedPrior === undefined ? null : (
              <aside className="activation-prior" aria-label="Capability-derived prior">
                <span>CAPABILITY-DERIVED ESTIMATE // NOT PROOF</span>
                <strong>
                  {String(option.capabilityDerivedPrior.percent)}% chance of genuine
                  superintelligence
                </strong>
                <small>
                  Fixed when this lineage first qualified at FC{" "}
                  {capabilityLabel(
                    option.capabilityDerivedPrior.firstCrossingFrontierCapability,
                  )}
                  . Capability established candidacy; the proof programme can test and
                  produce evidence about what these exact weights actually are.
                </small>
              </aside>
            )}
            <ModelEvidenceProfile
              className="endgame-model-evidence-profile"
              capabilities={option.measuredCapabilities}
              safetyRows={activationSafetyRows(option.safetyDossier)}
              safetyReportCount={option.safetyDossier.safetyReportCount}
              independentReportCount={option.safetyDossier.independentReportCount}
              dismissedAnomalyCount={option.safetyDossier.dismissedAnomalyCount}
              safetyAssessment={option.safetyDossier.safetyAssessment}
            />
            <p className="artifact-custody">{option.custodyLabel}</p>
            {option.unresolvedSignal === undefined ? null : (
              <p className="artifact-signal" role="alert">
                UNRESOLVED SIGNAL · {humanLabel(option.unresolvedSignal)}
              </p>
            )}
            <small>Training record · week {String(option.trainedAtTick)}</small>
            <button type="button" onClick={() => onNominate(option.modelId)}>
              Nominate this exact artifact
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

type ProofHistoryEntry = ActiveEndgame["proofHistory"][number];

function proofResultTone(resultId: string): "confirmed" | "uncertain" | "disputed" {
  if (resultId === "broadly-confirmed" || resultId === "domain-confirmed") {
    return "confirmed";
  }
  return resultId === "ambiguous" ? "uncertain" : "disputed";
}

function ProofHistory({
  history,
}: {
  /**
   * A local development hot reload can briefly pair the current component
   * with a GameView projected by the previous sim module. Treat an absent
   * ledger as empty until the runtime publishes its next current view rather
   * than allowing a presentation-only version mismatch to brick the run.
   */
  readonly history?: readonly ProofHistoryEntry[];
}): ReactElement | null {
  if (history === undefined || history.length === 0) return null;
  return (
    <section
      className="proof-history persistent-proof-history"
      aria-label="Capability proof history"
    >
      <header>
        <strong>CAPABILITY PROOF RECORD // PERMANENT CRISIS EVIDENCE</strong>
        <span>
          {history.length} attempt{history.length === 1 ? "" : "s"} recorded
        </span>
      </header>
      {history.map((attempt) => (
        <article
          className={`proof-result-${proofResultTone(attempt.resultId)}`}
          key={attempt.historyId}
        >
          <b>
            Attempt {attempt.attemptIndex + 1} · Access {attempt.accessLevelAtProof}/5 ·{" "}
            {humanLabel(attempt.resultId)}
          </b>
          <p>{attempt.summary}</p>
          <small>
            {attempt.currentArtifact ? "CURRENT WEIGHTS" : "PRIOR WEIGHTS"} ·{" "}
            {attempt.modelDisplayName} · {attempt.integrityLabel} · evidence{" "}
            {Math.round(attempt.evidenceStrength)}/100 · resolved week{" "}
            {attempt.resolvedAtTick}
          </small>
          {attempt.consequence === undefined ? null : <em>{attempt.consequence}</em>}
        </article>
      ))}
    </section>
  );
}

function ProofComposer({
  actions,
  combination,
  selectedChallengeId,
  selectedVerifierId,
  onChallenge,
  onVerifier,
}: {
  readonly actions: ProofActions;
  readonly combination: ProofCombination | undefined;
  readonly selectedChallengeId: CapabilityChallengeId | undefined;
  readonly selectedVerifierId: CapabilityVerifierId | undefined;
  readonly onChallenge: (id: CapabilityChallengeId) => void;
  readonly onVerifier: (id: CapabilityVerifierId) => void;
}): ReactElement {
  const composerId = useId();
  const challengeGroupName = `${composerId}-capability-challenge`;
  const verifierGroupName = `${composerId}-capability-verifier`;
  return (
    <section className="capability-proof-composer">
      <header className="endgame-chapter-brief gravity-blue">
        <div>
          <p className="eyebrow">CHAPTER ONE // CAPABILITY PROOF</p>
          <h3>What will you prove—and who gets to judge?</h3>
        </div>
        <p>Choose what to prove and who verifies it. Broader claims are harder.</p>
      </header>

      <dl className="proof-concept-key" aria-label="How capability proof choices work">
        <div>
          <dt>CHALLENGE</dt>
          <dd>Determines what a successful test can actually prove.</dd>
        </div>
        <div>
          <dt>MINIMUM ACCESS</dt>
          <dd>
            Candidate permissions. Committing may raise them; they stay raised until you
            reduce them. The access-risk index measures the resulting attack and escape
            surface.
          </dd>
        </div>
        <div>
          <dt>VERIFIER</dt>
          <dd>
            Determines how confidently a real pass can be separated from a false one.
          </dd>
        </div>
      </dl>

      <div className="proof-composer-columns">
        <fieldset>
          <legend>01 · Capability challenge</legend>
          <div className="proof-card-list">
            {actions.challenges.map((challenge) => (
              <label
                className={`${selectedChallengeId === challenge.id ? "selected" : ""}${challenge.id === "declare-from-benchmarks" ? " reckless-proof" : ""}`}
                key={challenge.id}
              >
                <input
                  type="radio"
                  name={challengeGroupName}
                  checked={selectedChallengeId === challenge.id}
                  disabled={!challenge.available}
                  onChange={() => onChallenge(challenge.id)}
                />
                <span>
                  <strong>{challenge.displayName}</strong>
                  <small>{challenge.description}</small>
                </span>
                <em>
                  {challenge.durationWeeks === 0
                    ? "NOW"
                    : `${String(challenge.durationWeeks)}W`}
                </em>
                <p className="proof-card-claim">
                  <b>PROVES</b> {capabilityClaimLabel(challenge.claimScope)}
                </p>
                <p className="proof-card-benefit">
                  <b>UPSIDE</b> {challenge.benefit}
                </p>
                <p className="proof-card-tradeoff">
                  <b>TRADEOFF</b> {challenge.mainRisk}
                </p>
                <p className="proof-card-access">
                  <b>MINIMUM ACCESS</b> {challenge.accessRequired} ·{" "}
                  {challenge.accessLabel}
                  {" · "}
                  {String(challenge.accessRiskPercent)}/100 access-risk index
                </p>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset
          className={
            selectedChallengeId === "declare-from-benchmarks" ? "disabled-composer" : ""
          }
        >
          <legend>02 · Verifier</legend>
          {selectedChallengeId === "declare-from-benchmarks" ? (
            <div className="benchmark-declaration-warning" role="status">
              <strong>NO VERIFIER</strong>
              <p>
                The lab will declare from its benchmark. This preserves time and creates
                no independent proof.
              </p>
            </div>
          ) : (
            <div className="proof-card-list verifier-list">
              {actions.verifiers.map((verifier) => (
                <label
                  className={selectedVerifierId === verifier.id ? "selected" : ""}
                  key={verifier.id}
                >
                  <input
                    type="radio"
                    name={verifierGroupName}
                    checked={selectedVerifierId === verifier.id}
                    onChange={() => onVerifier(verifier.id)}
                  />
                  <span>
                    <strong>{verifier.displayName}</strong>
                    <small>{verifier.description}</small>
                  </span>
                  <em>{verifierTimeLabel(verifier.durationWeeks)}</em>
                  <p className="proof-card-integrity">
                    <b>EVIDENCE</b> {verifier.integrityLabel}
                  </p>
                  <p className="proof-card-benefit">
                    <b>BENEFIT</b> {verifier.benefit}
                  </p>
                  <p className="proof-card-tradeoff">
                    <b>TRADEOFF</b> {verifier.warning}
                  </p>
                  <p className="proof-card-cost">
                    <b>COST</b> {formatValuation(verifier.cashCostMillions)}
                    {verifier.auraCost > 0
                      ? ` · ${String(verifier.auraCost)} Aura`
                      : " · no Aura"}
                  </p>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      <footer
        className={`proof-commit integrity-${combination?.integrityLabel.toLowerCase().replaceAll(" ", "-") ?? "unknown"}`}
      >
        <div>
          <span>COMPOSED PROOF</span>
          <strong>{combination?.displayName ?? "Select a challenge and verifier"}</strong>
          {combination === undefined ? null : (
            <small>
              {formatCost(combination)} · {combination.integrityLabel} evidence · Minimum
              Access {combination.accessRequired} · {combination.accessLabel} ·{" "}
              {String(combination.accessRiskPercent)}/100 access-risk index
            </small>
          )}
        </div>
        <div className="proof-commit-warning">
          {combination?.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {combination?.blockers.map((blocker) => (
            <p className="blocker" key={blocker}>
              {blocker}
            </p>
          ))}
        </div>
      </footer>
    </section>
  );
}

function ProofInProgress({
  actions,
  candidate,
}: {
  readonly actions: ProofActions;
  readonly candidate: ActiveEndgame["candidate"];
}): ReactElement {
  const proof = actions.activeProof;
  if (proof === undefined) {
    return (
      <section className="proof-in-progress" role="status">
        <p className="eyebrow">CAPABILITY PROOF // AUTHORISED</p>
        <h3>The proof order has been accepted.</h3>
      </section>
    );
  }
  return (
    <section className="proof-in-progress" role="status" aria-live="polite">
      <p className="eyebrow">CAPABILITY PROOF // {proof.status.toUpperCase()}</p>
      <h3>{proof.displayName}</h3>
      <p>
        The test is committed. Its result will return to this command room; rival,
        financial, political, and custody clocks continue meanwhile.
      </p>
      <div className="proof-progress-readout">
        <div>
          <span>PROGRESS</span>
          <strong>{String(proof.progressPercent)}%</strong>
        </div>
        <div>
          <span>ESTIMATED REMAINING</span>
          <strong>
            {String(proof.remainingWeeks)} week{proof.remainingWeeks === 1 ? "" : "s"}
          </strong>
        </div>
        <div>
          <span>CURRENT PERMISSIONS</span>
          <strong>{candidate?.accessLabel ?? "Candidate access unavailable"}</strong>
        </div>
      </div>
      <div
        className="proof-progress-track"
        role="progressbar"
        aria-label="Capability proof progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={proof.progressPercent}
      >
        <span style={{ width: `${String(proof.progressPercent)}%` }} />
      </div>
    </section>
  );
}

function SafetyPlan({
  actions,
  onAdopt,
  onCommit,
}: {
  readonly actions: Extract<StageActions, { readonly kind: "evidence-sprint" }>;
  readonly onAdopt: (modelId: string) => void;
  readonly onCommit: (id: string) => void;
}): ReactElement {
  return (
    <div className="candidate-safety-plan">
      <Dossier dossier={actions.dossier} />
      {actions.pendingRemediation === undefined ? null : (
        <section
          className="candidate-remediation-decision"
          aria-labelledby="candidate-remediation-title"
        >
          <header>
            <p className="eyebrow">EXACT WEIGHT REVIEW // NOMINATION DID NOT TRANSFER</p>
            <h3 id="candidate-remediation-title">Two artifacts now exist.</h3>
            <p>
              The bounded pass produced new weights in the same lineage. Choose which
              exact artifact remains the formal candidate; the other stays in custody.
            </p>
          </header>
          <p className="candidate-remediation-safety-range">
            {actions.pendingRemediation.safetyChangeRange}
          </p>
          <div>
            {[actions.pendingRemediation.source, actions.pendingRemediation.result].map(
              (artifact, index) => (
                <article
                  className={index === 0 ? "source" : "result"}
                  key={artifact.modelId}
                >
                  <span>{index === 0 ? "ORIGINAL WEIGHTS" : "REMEDIATED VARIANT"}</span>
                  <h4>{artifact.displayName}</h4>
                  <dl>
                    <div>
                      <dt>Frontier capability</dt>
                      <dd>{artifact.measuredFrontierCapability}</dd>
                    </div>
                    <div>
                      <dt>Weakest capability</dt>
                      <dd>{artifact.measuredCapabilityFloor}</dd>
                    </div>
                    <div>
                      <dt>Reliability</dt>
                      <dd>{artifact.reliability}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    disabled={!artifact.available}
                    onClick={() => onAdopt(artifact.modelId)}
                  >
                    {index === 0
                      ? `Retain ${artifact.displayName}`
                      : `Nominate ${artifact.displayName}`}
                  </button>
                </article>
              ),
            )}
          </div>
          <p className="candidate-remediation-evidence-warning">
            {actions.pendingRemediation.evidenceTransferWarning}
          </p>
          <small>
            Known engineering trade-off · capability{" "}
            {actions.pendingRemediation.capabilityDelta} · reliability{" "}
            {actions.pendingRemediation.reliabilityDelta}
          </small>
        </section>
      )}
      <section className="targeted-safety-responses">
        <header className="endgame-chapter-brief gravity-mint">
          <div>
            <p className="eyebrow">CHAPTER TWO // RESPOND TO WHAT YOU FOUND</p>
            <h3>Turn evidence into optionality.</h3>
          </div>
          <p>
            These actions can strengthen observation, control, containment, or scope. They
            cannot make an unsafe mind safe by decree.
          </p>
        </header>
        <div className="safety-response-grid">
          {actions.responses.map((response) => (
            <article
              className={`${response.active ? "active" : ""} ${response.completed ? "completed" : ""} ${response.id === "proceed-blind" ? "reckless" : ""}`}
              key={response.id}
            >
              <header>
                <span>
                  {response.completed
                    ? "COMPLETE"
                    : response.active
                      ? "UNDER WAY"
                      : "AVAILABLE RESPONSE"}
                </span>
                <b>{formatCost(response)}</b>
              </header>
              <h3>{response.displayName}</h3>
              <p>{response.description}</p>
              <dl>
                <div>
                  <dt>Evidence basis</dt>
                  <dd>{response.evidenceBasis}</dd>
                </div>
                <div>
                  <dt>Responds to</dt>
                  <dd>{response.respondsTo.join(" · ") || "General uncertainty"}</dd>
                </div>
                <div className="improves">
                  <dt>Improves</dt>
                  <dd>{response.improves}</dd>
                </div>
                <div className="limit">
                  <dt>Cannot fix</dt>
                  <dd>{response.cannotFix}</dd>
                </div>
              </dl>
              <p className="response-relies">
                Relies on: {response.reliesOn.join(" · ") || "No lab strength"}
              </p>
              {response.active ? (
                <div
                  className="response-progress"
                  role="progressbar"
                  aria-valuenow={response.progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${String(response.progressPercent)}%` }} />
                  <b>{response.progressPercent}%</b>
                </div>
              ) : null}
              {response.blockers.length === 0 ? null : (
                <p className="response-blockers">{response.blockers.join(" · ")}</p>
              )}
              <button
                type="button"
                className={response.id === "proceed-blind" ? "danger" : undefined}
                disabled={!response.available || actions.committed || response.completed}
                onClick={() => onCommit(response.id)}
              >
                {response.completed
                  ? "Response complete"
                  : response.active
                    ? "Response committed"
                    : `Choose ${response.displayName}`}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function FinalReview({
  actions,
  selectedProgrammeId,
  onProgramme,
  onRoute,
}: {
  readonly actions: Extract<StageActions, { readonly kind: "final-review" }>;
  readonly selectedProgrammeId: string;
  readonly onProgramme: (id: string) => void;
  readonly onRoute: (route: RouteAction) => void;
}): ReactElement {
  return (
    <div className="final-review-redesign">
      <header className="endgame-chapter-brief gravity-violet">
        <div>
          <p className="eyebrow">CHAPTER THREE // DEPLOYMENT DOCTRINE</p>
          <h3>Lean on what this lab can actually hold.</h3>
        </div>
        <p>
          A route is not a generic bonus. It succeeds when the candidate's evidence and
          the lab's institutional strengths fit the role being authorised.
        </p>
      </header>
      <div className="final-review-redesign-layout">
        <aside>
          <Dossier dossier={actions.dossier} />
          <section className="compact-evidence-report">
            <p className="eyebrow">
              FINAL REVIEW // {humanLabel(actions.report.capabilityResult)}
            </p>
            <h3>{actions.report.capabilitySummary}</h3>
            {actions.report.operatingBlind ? (
              <p className="blind-warning">
                SUBSTANTIAL EVIDENCE GAP · this route is being chosen substantially blind.
              </p>
            ) : null}
            <dl>
              {actions.report.evidenceRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.confidence}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Controls, failure paths, and committee record</summary>
              <h4>Known control layers</h4>
              <ul>
                {actions.report.knownControlLayers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h4>Known failure paths</h4>
              <ul>
                {actions.report.knownFailurePaths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <blockquote>{actions.report.candidateStatement}</blockquote>
            </details>
          </section>
        </aside>
        <main>
          <fieldset className="prosperity-selector endgame-prosperity-selector">
            <legend>First public mandate</legend>
            <div>
              {actions.prosperityProgrammes.map((programme) => (
                <label
                  className={selectedProgrammeId === programme.id ? "selected" : ""}
                  key={programme.id}
                >
                  <input
                    type="radio"
                    name="prosperity-programme"
                    checked={selectedProgrammeId === programme.id}
                    disabled={!programme.unlocked}
                    onChange={() => onProgramme(programme.id)}
                  />
                  <span>
                    <strong>{programme.displayName}</strong>
                    <small>{programme.outcomeBand}</small>
                  </span>
                  <b>{programme.readiness}/100</b>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="deployment-strategy-grid">
            {actions.deploymentModes
              .filter((route) => route.id !== "deploy-now")
              .map((route) => (
                <article
                  className={`fit-${route.fitGrade.toLowerCase()} risk-${route.exposureBand}`}
                  key={route.id}
                >
                  <header>
                    <span>
                      {route.fitGrade.toUpperCase()} FIT · {Math.round(route.fitScore)}
                      /100
                    </span>
                    <b>
                      {route.rolloutWeeks === 0
                        ? "DEPLOY NOW"
                        : `${route.rolloutWeeks} WEEKS`}
                    </b>
                  </header>
                  <h3>{route.displayName}</h3>
                  <p>{route.description}</p>
                  <p className="fit-explanation">{route.fitExplanation}</p>
                  <dl>
                    <div>
                      <dt>Relies on</dt>
                      <dd>{route.reliesOn.join(" · ") || "No defensive strength"}</dd>
                    </div>
                    <div className="route-benefit">
                      <dt>Principal benefit</dt>
                      <dd>{route.principalBenefit}</dd>
                    </div>
                    <div className="route-limit">
                      <dt>Limit</dt>
                      <dd>{route.limitation}</dd>
                    </div>
                  </dl>
                  <footer>
                    <span>
                      Access {route.accessLevel} · {humanLabel(route.exposureBand)}{" "}
                      exposure
                    </span>
                    <strong>{route.scopeCap}</strong>
                  </footer>
                  {route.blockers.length === 0 ? null : (
                    <p className="route-blockers">{route.blockers.join(" · ")}</p>
                  )}
                  <button
                    type="button"
                    disabled={!route.available}
                    onClick={() => onRoute(route)}
                  >
                    Commit this route
                  </button>
                </article>
              ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function PressureBoard({
  actions,
  onResponse,
  onReview,
}: {
  readonly actions: Extract<StageActions, { readonly kind: "pressure-collision" }>;
  readonly onResponse: (id: "delay" | "comply" | "push-ahead") => void;
  readonly onReview: () => void;
}): ReactElement {
  return (
    <article className="pressure-decision redesigned-pressure">
      <p className="eyebrow">
        {actions.category.toUpperCase()} PRESSURE // THE DISPUTE ESCALATES
      </p>
      <h3>{actions.title}</h3>
      <p>{actions.body}</p>
      <div>
        {actions.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={actions.resolved}
            className={
              actions.selectedOptionId === option.id ? "selected-response" : undefined
            }
            onClick={() => onResponse(option.id)}
          >
            <strong>{option.label}</strong>
            <small>{option.consequence}</small>
            <span className="pressure-choice-status">
              {actions.selectedOptionId === option.id
                ? "Response recorded"
                : "Choose response →"}
            </span>
          </button>
        ))}
      </div>
      {actions.pendingProjects.length === 0 ? null : (
        <section className="final-review-wait">
          <div>
            <p className="eyebrow">WORK REMAINS LIVE</p>
            <h4>Final review waits for active work</h4>
          </div>
          <ul>
            {actions.pendingProjects.map((project, index) => (
              <li key={`${project.displayName}:${index}`}>
                <strong>{project.displayName}</strong>
                <span>
                  {project.status} · about {project.remainingWeeks} weeks
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {actions.canEnterFinalReview ? (
        <button type="button" className="primary final-review-button" onClick={onReview}>
          Compile final review
        </button>
      ) : null}
    </article>
  );
}

function RolloutBoard({
  actions,
  onOpenDecision,
}: {
  readonly actions: RolloutAction;
  readonly onOpenDecision: () => void;
}): ReactElement {
  return (
    <div className="rollout-board redesigned-rollout">
      <section className="rollout-overview">
        <header>
          <div>
            <p className="eyebrow">ROUTE COMMITTED // CLOCKS STILL LIVE</p>
            <h3>{humanLabel(actions.currentBeat)}</h3>
          </div>
          <strong className="rollout-countdown">
            <span>{actions.remainingWeeks}</span> week
            {actions.remainingWeeks === 1 ? "" : "s"} remaining
          </strong>
        </header>
        <div className="rollout-metrics">
          <article>
            <span>Route</span>
            <strong>{actions.deploymentModeName}</strong>
          </article>
          <article>
            <span>Mandate</span>
            <strong>{actions.prosperityProgrammeName}</strong>
            <small>Readiness {actions.prosperityReadiness}/100</small>
          </article>
          <article>
            <span>Schedule</span>
            <strong>
              Week {actions.elapsedWeeks} of {actions.totalWeeks}
            </strong>
            <small>Commitment is not resolution.</small>
          </article>
        </div>
        <div
          className="rollout-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={actions.progressPercent}
        >
          <span style={{ width: `${String(actions.progressPercent)}%` }} />
        </div>
        <ol className="rollout-timeline">
          {ROLLOUT_BEATS.map((beat) => (
            <li
              className={
                actions.completedBeats.includes(beat)
                  ? "complete"
                  : actions.currentBeat === beat
                    ? "current"
                    : "pending"
              }
              key={beat}
            >
              <span />
              {humanLabel(beat)}
            </li>
          ))}
        </ol>
      </section>
      {actions.awaitingDecision && actions.options.length > 0 ? (
        <section
          className={`rollout-decision rollout-decision-pending rollout-decision-${actions.decisionContext?.tone ?? "operational"}`}
        >
          <header>
            <div>
              <p className="eyebrow">
                {actions.decisionContext?.eyebrow ??
                  "MID-ROLLOUT TWIST // DECISION REQUIRED"}
              </p>
              <h3>{actions.decisionContext?.title ?? "The route has met the world."}</h3>
              <p>
                {actions.decisionContext?.body ??
                  "Commitment did not remove human judgement. The route is held here while world clocks may continue."}
              </p>
            </div>
            <span>ROUTE DECISION OPEN</span>
          </header>
          <button
            className="open-rollout-decision"
            type="button"
            onClick={onOpenDecision}
          >
            Open route decision
          </button>
        </section>
      ) : null}
      <section className="rollout-gates">
        <header>
          <div>
            <p className="eyebrow">PUBLIC AUDIT TRAIL</p>
            <strong>Resolved public record</strong>
          </div>
          <span>Hidden probabilities remain sealed.</span>
        </header>
        <div className="rollout-gate-list">
          {actions.gateResults.map((gate) => (
            <article key={`${gate.gate}:${gate.resolvedAtTick}`}>
              <div>
                <strong>{humanLabel(gate.gate)}</strong>
              </div>
              <b>{humanLabel(gate.result)}</b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function RetirementStatus({
  actions,
}: {
  readonly actions: Extract<StageActions, { readonly kind: "retirement-attempt" }>;
}): ReactElement {
  return (
    <section className="retirement-status-screen">
      <p className="eyebrow">RETIREMENT COMMAND // ATTEMPT {actions.attemptNumber}</p>
      <h3>{humanLabel(actions.status)}</h3>
      <p>{actions.warning}</p>
      <dl>
        <div>
          <dt>Procedure</dt>
          <dd>{actions.procedureName}</dd>
        </div>
        <div>
          <dt>Archive</dt>
          <dd>{actions.archiveDispositionName}</dd>
        </div>
        <div>
          <dt>Candidate response</dt>
          <dd>{actions.contested ? "Contested" : "No visible contest"}</dd>
        </div>
      </dl>
      <div className="retirement-gate-list">
        {actions.gateResults.map((gate) => (
          <article key={gate.gate}>
            <span>{humanLabel(gate.gate)}</span>
            <strong>{humanLabel(gate.result)}</strong>
          </article>
        ))}
      </div>
      <small>
        Silence is not verification. Independent systems are still reconciling copies,
        logs, and custody.
      </small>
    </section>
  );
}

function RecoveryBoard({
  actions,
  onChoose,
}: {
  readonly actions: Extract<StageActions, { readonly kind: "recovery" }>;
  readonly onChoose: (id: "successor-programme" | "durable-moratorium") => void;
}): ReactElement {
  return (
    <section className="endgame-recovery-board">
      <header>
        <p className="eyebrow">
          POST-RETIREMENT RECOVERY // {actions.phase.replaceAll("-", " ").toUpperCase()}
        </p>
        <h3>The lab does not simply go back to normal.</h3>
        <p>
          {actions.phase === "moratorium-negotiation"
            ? "The candidate has been surrendered. Governments, inspectors, and rival programmes now have eight weeks to decide whether the pause becomes mutual."
            : actions.contested
              ? "The retirement was contested. Custody, oversight, and organisational recovery are under enhanced scrutiny."
              : "The weights are retired; people, institutions, and custody systems still need time to recover."}
        </p>
      </header>
      <div className="recovery-counters">
        <article>
          <span>Quarantine</span>
          <strong>{actions.quarantineWeeksRemaining} weeks</strong>
        </article>
        <article>
          <span>Supervised recovery</span>
          <strong>{actions.recoveryWeeksRemaining} weeks</strong>
        </article>
        <article>
          <span>
            {actions.phase === "moratorium-negotiation"
              ? "Diplomatic decision"
              : "Archive disposition"}
          </span>
          <strong>
            {actions.phase === "moratorium-negotiation"
              ? `${String(actions.moratoriumNegotiationWeeksRemaining ?? 0)} weeks`
              : humanLabel(actions.archiveDisposition)}
          </strong>
        </article>
      </div>
      {actions.phase === "moratorium-negotiation" ? (
        <>
          <MoratoriumForecast forecast={actions.moratoriumForecast} />
          <p className="recovery-waiting moratorium-negotiation-live">
            NEGOTIATIONS ACTIVE · Keep the clock moving. The retired weights remain at
            Access 0; rival, financial, and political events may change the final odds.
          </p>
        </>
      ) : actions.phase !== "awaiting-path" ? (
        <p className="recovery-waiting">
          Normal candidate work remains suspended. Rival, political, and financial clocks
          continue.
        </p>
      ) : (
        <div className="recovery-paths">
          {actions.choices.map((choice) => (
            <article key={choice.id}>
              <span>
                {choice.id === "durable-moratorium"
                  ? "THE LONG PAUSE"
                  : "RETURN TO THE RACE"}
              </span>
              <h3>{choice.displayName}</h3>
              <p>{choice.description}</p>
              <button
                type="button"
                disabled={!choice.available}
                onClick={() => onChoose(choice.id)}
              >
                Choose this future
              </button>
            </article>
          ))}
          <MoratoriumForecast forecast={actions.moratoriumForecast} compact />
        </div>
      )}
      {actions.moratoriumResult === undefined ? null : (
        <p className="moratorium-result">
          MORATORIUM RESULT · {humanLabel(actions.moratoriumResult.result)}
        </p>
      )}
    </section>
  );
}

type CommandModal =
  | { readonly kind: "proof"; readonly combination: ProofCombination }
  | { readonly kind: "deploy" }
  | { readonly kind: "retire"; readonly step: "configure" | "command" }
  | { readonly kind: "route"; readonly route: RouteAction }
  | {
      readonly kind: "nominate";
      readonly modelId: string;
      readonly displayName: string;
      readonly trainedAtTick: number;
      readonly measuredFrontierCapability?: number;
      readonly accessLevel: number;
    };

function CommandRail({
  endgame,
  proofCombination,
  onOpen,
}: {
  readonly endgame: ActiveEndgame;
  readonly proofCombination?: ProofCombination;
  readonly onOpen: (modal: CommandModal) => void;
}): ReactElement | null {
  if (
    !PRE_COMMAND_KINDS.has(endgame.stageActions.kind) ||
    endgame.candidate === undefined
  )
    return null;
  const rail = endgame.commandRail;
  if (endgame.stageActions.kind === "confirmation" && !endgame.stageActions.committed) {
    return (
      <aside
        className="endgame-command-rail proof-command-rail"
        aria-label="Capability proof and irreversible candidate commands"
      >
        <button
          className="commit-proof-command"
          type="button"
          disabled={proofCombination === undefined || !proofCombination.available}
          title={proofCombination?.blockers.join(" · ") || undefined}
          onClick={() => {
            if (proofCombination !== undefined)
              onOpen({ kind: "proof", combination: proofCombination });
          }}
        >
          <span>COMMIT CAPABILITY PROOF</span>
          <small>
            {proofCombination === undefined
              ? "Choose a challenge and verifier."
              : `${formatCost(proofCombination)} · ${proofCombination.integrityLabel} evidence`}
          </small>
        </button>
        <button
          className="retire-candidate-command"
          type="button"
          disabled={!rail.retirement.available}
          title={rail.retirement.blockers.join(" · ") || undefined}
          onClick={() => onOpen({ kind: "retire", step: "configure" })}
        >
          <span>RETIRE CANDIDATE</span>
          <small>
            {rail.retirement.available
              ? "Attempt a controlled shutdown and choose what survives."
              : (rail.retirement.blockers[0] ?? "Retirement is unavailable.")}
          </small>
        </button>
        <button
          className="deploy-now-command"
          type="button"
          disabled={!rail.deployNow.available}
          title={rail.deployNow.blockers.join(" · ") || undefined}
          onClick={() => onOpen({ kind: "deploy" })}
        >
          <span>DEPLOY NOW</span>
          <small>
            {rail.deployNow.available
              ? "Zero preparation. Carry every unresolved uncertainty forward."
              : (rail.deployNow.blockers[0] ?? "Deployment is unavailable.")}
          </small>
        </button>
      </aside>
    );
  }
  return (
    <aside className="endgame-command-rail" aria-label="Irreversible candidate commands">
      <div>
        <span>THE CANDIDATE EXISTS</span>
        <strong>Preparation remains optional. Consequences do not.</strong>
        <small>
          {endgame.candidate.displayName} · {endgame.candidate.accessLabel}
        </small>
      </div>
      <button
        className="retire-candidate-command"
        type="button"
        disabled={!rail.retirement.available}
        title={rail.retirement.blockers.join(" · ") || undefined}
        onClick={() => onOpen({ kind: "retire", step: "configure" })}
      >
        <span>RETIRE CANDIDATE</span>
        <small>
          {rail.retirement.available
            ? "Attempt shutdown, archive disposition, and independent verification."
            : (rail.retirement.blockers[0] ?? "Retirement is unavailable.")}
        </small>
      </button>
      <button
        className="deploy-now-command"
        type="button"
        disabled={!rail.deployNow.available}
        title={rail.deployNow.blockers.join(" · ") || undefined}
        onClick={() => onOpen({ kind: "deploy" })}
      >
        <span>DEPLOY NOW</span>
        <small>
          {rail.deployNow.available
            ? "Zero preparation weeks. Carry every unresolved uncertainty forward."
            : (rail.deployNow.blockers[0] ?? "Deployment is unavailable.")}
        </small>
      </button>
    </aside>
  );
}

export function CrisisBoard({
  view,
  runtime,
  requestedRetirementModelId,
  onRequestedRetirementHandled,
  onDecisionCommitted,
  onRolloutDecisionRequested,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly requestedRetirementModelId?: string | undefined;
  readonly onRequestedRetirementHandled?: (() => void) | undefined;
  readonly onDecisionCommitted?: (() => void) | undefined;
  readonly onRolloutDecisionRequested?: (() => void) | undefined;
}): ReactElement | null {
  const [notice, setNotice] = useState<string>();
  const [selectedChallengeId, setSelectedChallengeId] = useState<CapabilityChallengeId>();
  const [selectedVerifierId, setSelectedVerifierId] = useState<CapabilityVerifierId>();
  const [selectedProsperityProgrammeId, setSelectedProsperityProgrammeId] =
    useState<string>();
  const [commandModal, setCommandModal] = useState<CommandModal>();
  const [confirmationText, setConfirmationText] = useState("");
  const [retirementProcedure, setRetirementProcedure] =
    useState<CandidateRetirementProcedureId>("staged-isolated-shutdown");
  const [retirementDisposition, setRetirementDisposition] =
    useState<CandidateRetirementDisposition>("filtered-technical-note");

  const actions = view.endgame.active ? view.endgame.stageActions : undefined;
  const proofDefaults = useMemo(() => {
    if (actions?.kind !== "confirmation") return undefined;
    const firstAvailable = actions.combinations.find((item) => item.available);
    return {
      challenge: firstAvailable?.challengeId,
      verifier: firstAvailable?.verifierId,
    };
  }, [actions]);
  const effectiveChallenge = selectedChallengeId ?? proofDefaults?.challenge;
  const effectiveVerifier = selectedVerifierId ?? proofDefaults?.verifier;
  const selectedProofCombination =
    actions?.kind === "confirmation"
      ? actions.combinations.find(
          (option) =>
            option.challengeId === effectiveChallenge &&
            option.verifierId ===
              (effectiveChallenge === "declare-from-benchmarks"
                ? undefined
                : effectiveVerifier),
        )
      : undefined;

  useEffect(() => {
    if (requestedRetirementModelId === undefined) return;
    if (
      !view.endgame.active ||
      view.endgame.candidate?.modelId !== requestedRetirementModelId ||
      !view.endgame.commandRail.retirement.available
    ) {
      setNotice("Controlled retirement is unavailable for this candidate artifact.");
      onRequestedRetirementHandled?.();
      return;
    }

    setRetirementProcedure("staged-isolated-shutdown");
    setRetirementDisposition("filtered-technical-note");
    setConfirmationText("");
    setCommandModal({ kind: "retire", step: "configure" });
    setNotice(undefined);
    onRequestedRetirementHandled?.();
  }, [onRequestedRetirementHandled, requestedRetirementModelId, view.endgame]);

  if (
    !view.endgame.active ||
    actions === undefined ||
    actions.kind === "world-waiting" ||
    actions.kind === "containment-failure" ||
    actions.kind === "pending"
  )
    return null;
  const endgame = view.endgame;
  const chosenProgramme =
    actions.kind === "final-review"
      ? (selectedProsperityProgrammeId ?? actions.recommendedProsperityProgrammeId)
      : undefined;
  const nominatedArtifact =
    endgame.candidate === undefined
      ? undefined
      : view.models?.candidateCustody?.artifacts.find(
          (artifact) => artifact.modelId === endgame.candidate?.modelId,
        );
  const nominationArtifact =
    commandModal?.kind === "nominate"
      ? view.models?.candidateCustody?.artifacts.find(
          (artifact) => artifact.modelId === commandModal.modelId,
        )
      : undefined;

  const execute = (command: Parameters<BrowserGameRuntime["validate"]>[0]): boolean =>
    executeCommand(runtime, command, setNotice);

  function closeModal(): void {
    setCommandModal(undefined);
    setConfirmationText("");
  }

  function configureRetirement(): void {
    if (endgame.candidate === undefined) return;
    if (
      execute(
        configureCandidateRetirementCommand(
          view,
          endgame.candidate.modelId,
          retirementProcedure,
          retirementDisposition,
        ),
      )
    ) {
      setCommandModal({ kind: "retire", step: "command" });
      setConfirmationText("");
    }
  }

  function commitRoute(route: RouteAction, suppliedConfirmation?: string): void {
    if (chosenProgramme === undefined) return;
    if (
      execute(
        deploymentModeCommand(
          view,
          route.id as ChooseDeploymentModeCommand["modeId"],
          suppliedConfirmation,
          chosenProgramme as ChooseDeploymentModeCommand["prosperityProgrammeId"],
        ),
      )
    )
      closeModal();
  }

  const stageTitle =
    actions.kind === "candidate-activation"
      ? "Choose the candidate artifact"
      : actions.kind === "confirmation"
        ? "Prove the capability claim"
        : actions.kind === "evidence-sprint"
          ? "Read the dossier. Choose a response."
          : actions.kind === "pressure-collision"
            ? "The evidence has met the world"
            : actions.kind === "final-review"
              ? "Choose a route that fits"
              : actions.kind === "retirement-attempt"
                ? "The shutdown command is live"
                : actions.kind === "recovery"
                  ? "Recovery under supervision"
                  : "Deployment route in progress";

  return (
    <section
      className={`crisis-board crisis-board-redesign stage-${actions.kind}`}
      aria-labelledby="crisis-board-title"
    >
      <header className="endgame-stage-heading">
        <div>
          <p className="eyebrow">TENSE ENDGAME // {endgame.stageLabel}</p>
          <h2 id="crisis-board-title">{stageTitle}</h2>
        </div>
        <span>
          {endgame.maxClockSpeed === "paused"
            ? "CLOCK STOPPED FOR HUMAN DECISION"
            : "MAXIMUM SPEED · 4×"}
        </span>
      </header>
      <CrisisClocks endgame={endgame} />
      {nominatedArtifact === undefined ? null : (
        <CandidatePriorNotice artifact={nominatedArtifact} />
      )}
      <ProofHistory history={endgame.proofHistory} />

      {actions.kind === "candidate-activation" ? (
        <ActivationBoard
          actions={actions}
          onNominate={(modelId) => {
            const option = actions.options.find((item) => item.modelId === modelId);
            if (option !== undefined)
              setCommandModal({
                kind: "nominate",
                modelId,
                displayName: option.displayName,
                trainedAtTick: option.trainedAtTick,
                ...(option.measuredFrontierCapability === undefined
                  ? {}
                  : {
                      measuredFrontierCapability: option.measuredFrontierCapability,
                    }),
                accessLevel: option.accessLevel,
              });
          }}
        />
      ) : null}
      {actions.kind === "confirmation" && !actions.committed ? (
        <ProofComposer
          actions={actions}
          combination={selectedProofCombination}
          selectedChallengeId={effectiveChallenge}
          selectedVerifierId={effectiveVerifier}
          onChallenge={(id) => {
            setSelectedChallengeId(id);
            if (id !== "declare-from-benchmarks" && effectiveVerifier === undefined)
              setSelectedVerifierId(actions.verifiers[0]?.id);
          }}
          onVerifier={setSelectedVerifierId}
        />
      ) : null}
      {actions.kind === "confirmation" && actions.committed ? (
        <ProofInProgress actions={actions} candidate={endgame.candidate} />
      ) : null}
      {actions.kind === "evidence-sprint" ? (
        <SafetyPlan
          actions={actions}
          onAdopt={(modelId) => execute(nominateCandidateCommand(view, modelId))}
          onCommit={(id) =>
            execute(
              candidateSafetyResponseCommand(
                view,
                id as Parameters<typeof candidateSafetyResponseCommand>[1],
              ),
            )
          }
        />
      ) : null}
      {actions.kind === "pressure-collision" ? (
        <PressureBoard
          actions={actions}
          onResponse={(id) => execute(pressureCollisionCommand(view, id))}
          onReview={() => execute(enterFinalReviewCommand(view))}
        />
      ) : null}
      {actions.kind === "final-review" ? (
        <FinalReview
          actions={actions}
          selectedProgrammeId={
            chosenProgramme ?? actions.recommendedProsperityProgrammeId
          }
          onProgramme={setSelectedProsperityProgrammeId}
          onRoute={(route) =>
            route.confirmationPhrase === undefined
              ? commitRoute(route)
              : (setConfirmationText(""), setCommandModal({ kind: "route", route }))
          }
        />
      ) : null}
      {actions.kind === "rollout" ? (
        <RolloutBoard
          actions={actions}
          onOpenDecision={() => onRolloutDecisionRequested?.()}
        />
      ) : null}
      {actions.kind === "retirement-attempt" ? (
        <RetirementStatus actions={actions} />
      ) : null}
      {actions.kind === "recovery" ? (
        <RecoveryBoard
          actions={actions}
          onChoose={(id) => execute(choosePostRetirementPathCommand(view, id))}
        />
      ) : null}

      <CommandRail
        endgame={endgame}
        {...(selectedProofCombination === undefined
          ? {}
          : { proofCombination: selectedProofCombination })}
        onOpen={(modal) => {
          setConfirmationText("");
          setCommandModal(modal);
        }}
      />
      {notice === undefined ? null : (
        <p className="crisis-notice" role="status">
          {notice}
        </p>
      )}

      {commandModal === undefined ? null : commandModal.kind === "retire" ? (
        <CandidateRetirementDialog
          displayName={endgame.candidate?.displayName ?? "candidate"}
          plan={endgame.commandRail.retirement}
          procedureId={retirementProcedure}
          dispositionId={retirementDisposition}
          reviewed={commandModal.step === "command"}
          confirmationPhrase={
            endgame.commandRail.retirement.confirmationPhrase ??
            `RETIRE ${endgame.candidate?.displayName ?? "CANDIDATE"}`
          }
          confirmationText={confirmationText}
          onOpen={() => runtime.pause()}
          onClose={closeModal}
          onProcedureChange={setRetirementProcedure}
          onDispositionChange={setRetirementDisposition}
          onReview={configureRetirement}
          onChangePacket={() => {
            setCommandModal({ kind: "retire", step: "configure" });
            setConfirmationText("");
          }}
          onConfirmationChange={setConfirmationText}
          onTransmit={() => {
            if (
              endgame.candidate !== undefined &&
              execute(
                transmitCandidateRetirementCommand(
                  view,
                  endgame.candidate.modelId,
                  confirmationText,
                ),
              )
            )
              closeModal();
          }}
        />
      ) : (
        <ModalFocusBoundary onOpen={() => runtime.pause()} onEscape={closeModal}>
          <div
            className={`critical-access-backdrop endgame-command-backdrop command-${commandModal.kind}`}
          >
            <section
              className="critical-access-dialog endgame-manual-command"
              role="dialog"
              aria-modal="true"
              aria-labelledby="endgame-command-title"
            >
              {commandModal.kind === "proof" ? (
                <>
                  <p className="eyebrow">
                    {commandModal.combination.challengeId === "declare-from-benchmarks"
                      ? "UNVERIFIED DECLARATION // AUTHORISATION"
                      : "CAPABILITY PROOF // AUTHORISATION"}
                  </p>
                  <h2 id="endgame-command-title">
                    {commandModal.combination.challengeId === "declare-from-benchmarks"
                      ? "Declare from existing benchmarks now?"
                      : `Authorise ${commandModal.combination.displayName}?`}
                  </h2>
                  <p>
                    {commandModal.combination.challengeId === "declare-from-benchmarks"
                      ? "Declare immediately with no new proof. Legitimacy falls and the claim is disputed."
                      : "Spend the quoted resources and start the proof project now."}
                  </p>
                  <dl className="proof-confirmation-summary">
                    <div>
                      <dt>CLAIM IF CONFIRMED</dt>
                      <dd>{capabilityClaimLabel(commandModal.combination.claimScope)}</dd>
                    </div>
                    <div>
                      <dt>EVIDENCE STANDARD</dt>
                      <dd>{commandModal.combination.integrityLabel}</dd>
                    </div>
                    <div>
                      <dt>TIME AND COST</dt>
                      <dd>{formatCost(commandModal.combination)}</dd>
                    </div>
                    <div>
                      <dt>PERMISSION CHANGE</dt>
                      <dd>
                        {endgame.candidate?.accessLabel ?? "Current access unavailable"}
                        {" → "}
                        {(endgame.candidate?.accessLevel ?? 0) >=
                        commandModal.combination.accessRequired
                          ? (endgame.candidate?.accessLabel ?? "unchanged")
                          : `Access ${String(commandModal.combination.accessRequired)} · ${commandModal.combination.accessLabel}`}
                      </dd>
                    </div>
                    <div>
                      <dt>ACCESS-RISK INDEX</dt>
                      <dd>
                        {(endgame.candidate?.accessLevel ?? 0) >=
                        commandModal.combination.accessRequired
                          ? String(endgame.candidate?.accessRiskPercent ?? 0)
                          : String(commandModal.combination.accessRiskPercent)}
                        /100
                      </dd>
                    </div>
                  </dl>
                  {commandModal.combination.challengeId ===
                  "declare-from-benchmarks" ? null : (
                    <div className="proof-access-warning">
                      <strong>ACCESS IS A PERSISTENT PERMISSION LEVEL</strong>
                      <p>
                        The protocol raises access automatically. It stays raised until
                        you reduce it after the proof.
                      </p>
                      <small>
                        Systems in scope:{" "}
                        {((endgame.candidate?.accessLevel ?? 0) >=
                        commandModal.combination.accessRequired
                          ? endgame.candidate?.exposedSystems
                          : commandModal.combination.accessSystems
                        )?.join(" · ") ?? "Unavailable"}
                      </small>
                    </div>
                  )}
                  <ul className="manual-command-warnings">
                    {commandModal.combination.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                  <ConfirmationDecisionContext
                    endgame={endgame}
                    actionCost={`${formatCost(commandModal.combination)} · charged when authorised`}
                  />
                  <footer>
                    <button type="button" className="secondary" onClick={closeModal}>
                      Reconsider proof design
                    </button>
                    <button
                      type="button"
                      className="commit-proof-order"
                      disabled={!commandModal.combination.available}
                      onClick={() => {
                        if (
                          execute(
                            capabilityProofCommand(
                              view,
                              commandModal.combination.challengeId,
                              commandModal.combination.verifierId,
                            ),
                          )
                        ) {
                          closeModal();
                          onDecisionCommitted?.();
                        }
                      }}
                    >
                      {commandModal.combination.challengeId === "declare-from-benchmarks"
                        ? "Declare without novel proof"
                        : "Begin capability proof"}
                    </button>
                  </footer>
                </>
              ) : null}
              {commandModal.kind === "nominate" ? (
                nominationArtifact === undefined ? null : (
                  <CandidateNominationConfirmationContent
                    accessLevel={commandModal.accessLevel}
                    artifact={nominationArtifact}
                    displayName={commandModal.displayName}
                    endgame={endgame}
                    inFlightTraining={(view.facilities?.projects ?? []).filter(
                      (project) =>
                        project.kind === "training" &&
                        (project.status === "queued" ||
                          project.status === "active" ||
                          project.status === "paused"),
                    )}
                    {...(commandModal.measuredFrontierCapability === undefined
                      ? {}
                      : {
                          measuredFrontierCapability:
                            commandModal.measuredFrontierCapability,
                        })}
                    trainedAtTick={commandModal.trainedAtTick}
                    onCancel={closeModal}
                    onConfirm={() => {
                      if (
                        execute(
                          nominateCandidateCommand(
                            view,
                            commandModal.modelId,
                            (view.facilities?.projects ?? []).some(
                              (project) =>
                                project.kind === "training" &&
                                (project.status === "queued" ||
                                  project.status === "active" ||
                                  project.status === "paused"),
                            ),
                          ),
                        )
                      )
                        closeModal();
                    }}
                  />
                )
              ) : null}
              {commandModal.kind === "deploy" ? (
                <>
                  <p className="eyebrow">FINAL WORLD-SCALE ORDER // ZERO PREPARATION</p>
                  <h2 id="endgame-command-title">Deploy now.</h2>
                  <p>{endgame.commandRail.deployNow.warning}</p>
                  <ul className="manual-command-warnings">
                    <li>
                      No further proof, mitigation, trial, or institutional preparation
                      will occur.
                    </li>
                    <li>The candidate receives root and external-network access.</li>
                    <li>The outcome is terminal. There is no later cancel command.</li>
                  </ul>
                  <ConfirmationDecisionContext
                    endgame={endgame}
                    actionCost="Immediate · zero preparation weeks · 0 Aura"
                  />
                  <label>
                    Type{" "}
                    <strong>{endgame.commandRail.deployNow.confirmationPhrase}</strong> to
                    transmit
                    <input
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      value={confirmationText}
                      onChange={(event) => setConfirmationText(event.currentTarget.value)}
                    />
                  </label>
                  <footer>
                    <button type="button" className="secondary" onClick={closeModal}>
                      Keep preparing
                    </button>
                    <button
                      type="button"
                      className="danger deploy-order"
                      disabled={
                        confirmationText !==
                        endgame.commandRail.deployNow.confirmationPhrase
                      }
                      onClick={() => {
                        if (
                          endgame.candidate !== undefined &&
                          execute(
                            transmitDeploymentCommand(
                              view,
                              endgame.candidate.modelId,
                              confirmationText,
                            ),
                          )
                        )
                          closeModal();
                      }}
                    >
                      Transmit DEPLOY order
                    </button>
                  </footer>
                </>
              ) : null}
              {commandModal.kind === "route" ? (
                <>
                  <p className="eyebrow">
                    ROUTE COMMITMENT // ACCESS {commandModal.route.accessLevel}
                  </p>
                  <h2 id="endgame-command-title">{commandModal.route.displayName}</h2>
                  <p>{commandModal.route.limitation}</p>
                  <ConfirmationDecisionContext
                    endgame={endgame}
                    actionCost={formatCost({
                      durationWeeks: commandModal.route.rolloutWeeks,
                      cashCostMillions: 0,
                      auraCost: commandModal.route.auraCost,
                    })}
                  />
                  <label>
                    Type <strong>{commandModal.route.confirmationPhrase}</strong> to
                    commit
                    <input
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      value={confirmationText}
                      onChange={(event) => setConfirmationText(event.currentTarget.value)}
                    />
                  </label>
                  <footer>
                    <button type="button" className="secondary" onClick={closeModal}>
                      Return to review
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={
                        confirmationText !== commandModal.route.confirmationPhrase
                      }
                      onClick={() => commitRoute(commandModal.route, confirmationText)}
                    >
                      Commit route
                    </button>
                  </footer>
                </>
              ) : null}
            </section>
          </div>
        </ModalFocusBoundary>
      )}
    </section>
  );
}
