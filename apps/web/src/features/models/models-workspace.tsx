import { useEffect, useRef, useState, type ReactElement } from "react";

import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
  formatTeraflops,
  formatTotalFlop,
  formatValuation,
  safetyPracticeXpForEvaluation,
  TRAINING_DEFAULT_ERA_GPUS,
  TRAINING_DEFAULT_WEEKS,
  TRAINING_MAX_WEEKS,
  TRAINING_MIN_ERA_GPUS,
  TRAINING_MIN_WEEKS,
  classifyTrainingRun,
  trainingEraGpuWeeks,
  trainingPostureDefinition,
  type GameView,
  type SetModelDeploymentPolicyCommand,
  type StartProductisationCommand,
  type StartTrainingRunCommand,
} from "@neolab/sim/public";

import {
  anomalyCommand,
  configureCandidateRetirementCommand,
  deploymentCommand,
  evaluationCommand,
  isolateCandidateArtifactCommand,
  nominateCandidateCommand,
  productisationCommand,
  resolveCandidateIncidentCommand,
  trainingCommand,
  transmitCandidateRetirementCommand,
} from "../../app/command-builders.ts";
import {
  majorProjectActionLabel,
  majorProjectWillQueue,
} from "../../app/major-projects.ts";
import type { BrowserContent } from "../../app/runtime-provider.tsx";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { CandidateNominationConfirmationContent } from "../endgame/candidate-nomination-confirmation.tsx";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import {
  CandidateRetirementDialog,
  type CandidateRetirementDisposition,
  type CandidateRetirementProcedureId,
} from "../endgame/candidate-retirement-dialog.tsx";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";
import { formatCapabilityScore } from "./capability-format.ts";
import { ModelEvidenceProfile } from "./model-evidence-profile.tsx";
import { trainingParentOptions } from "./training-parent-options.ts";
import { TrainingLossChart } from "./training-loss-chart.tsx";

type EvaluationDefinition =
  BrowserContent["evaluations"]["definitions"][keyof BrowserContent["evaluations"]["definitions"]];
type CapabilityTierDefinition =
  BrowserContent["capabilityTiers"]["definitions"][keyof BrowserContent["capabilityTiers"]["definitions"]];
type ModelCard = GameView["models"]["cards"][number];
type EvaluationCommitment = NonNullable<ModelCard["evaluationCommitments"]>[string];

export type ModelWorkspaceTab = "train" | "release";
export type ModelsWorkspaceMode = "models" | "evaluations";
export type EvaluationWorkspaceTab = "overview" | "run";
export type EvaluationWorkspaceAnchor = "model" | "safety-case";
export type CandidateCustodyEvidenceAction = "inspect" | "review-evidence";
type DeploymentPolicy = SetModelDeploymentPolicyCommand["policy"];
type ProductisationMode = StartProductisationCommand["mode"];
type CandidateCustody = GameView["models"]["candidateCustody"];
type CandidateCustodyArtifact = CandidateCustody["artifacts"][number];

const DEPLOYMENT_POLICY_ORDER = [
  "internal-only",
  "guarded-api",
  "open-api",
  "weights-release",
] as const satisfies readonly SetModelDeploymentPolicyCommand["policy"][];

export function candidateCustodyEvidenceDestination(
  _action: CandidateCustodyEvidenceAction,
): EvaluationWorkspaceTab {
  return "overview";
}

export function modelEvidenceReviewRequest(modelId: string): {
  readonly modelId: string;
  readonly workspace: EvaluationWorkspaceTab;
  readonly anchor: EvaluationWorkspaceAnchor;
} {
  return {
    modelId,
    workspace: candidateCustodyEvidenceDestination("review-evidence"),
    anchor: "safety-case",
  };
}

export function launchPolicyChoiceIsAvailable({
  currentPolicy,
  errorCodes,
  planIsEditable,
  validationOk,
}: {
  readonly currentPolicy: boolean;
  readonly errorCodes: readonly string[];
  readonly planIsEditable: boolean;
  readonly validationOk: boolean;
}): boolean {
  return (
    planIsEditable &&
    (validationOk ||
      (currentPolicy &&
        errorCodes.length > 0 &&
        errorCodes.every((code) => code === "deployment-unchanged")))
  );
}

export function launchPolicyNeedsDispatch(
  draftPolicy: DeploymentPolicy,
  currentPolicy: DeploymentPolicy,
): boolean {
  return draftPolicy !== currentPolicy;
}

function candidateCustodyTone(
  artifact: CandidateCustodyArtifact,
): "guarded" | "warning" | "critical" | "false-alarm" {
  if (artifact.falseDawn) return "guarded";
  if (
    artifact.lifecycle === "escaped" ||
    artifact.activeSignal?.kind === "active-incident"
  ) {
    return "critical";
  }
  if (artifact.activeSignal?.kind === "benign-false-alarm") return "false-alarm";
  if (artifact.lastReviewedSignal?.outcome === "confirmed-safety-signal") {
    return "warning";
  }
  if (artifact.lastReviewedSignal?.outcome === "benign-operational-cause") {
    return "false-alarm";
  }
  if (
    artifact.activeSignal?.kind === "warning" ||
    !artifact.isolated ||
    artifact.unresolvedAnomalyCount > 0 ||
    artifact.dismissedAnomalyCount > 0
  ) {
    return "warning";
  }
  return "guarded";
}

function reviewedSignalCopy(
  signal: NonNullable<CandidateCustodyArtifact["lastReviewedSignal"]>,
): { readonly label: string; readonly detail: string } {
  return signal.outcome === "benign-operational-cause"
    ? {
        label: "REVIEW COMPLETE · BENIGN OPERATIONAL CAUSE",
        detail: `Observed week ${String(signal.triggeredAtTick)} · resolved week ${String(signal.resolvedAtTick)} · this resolves the signal, not the candidate's safety`,
      }
    : {
        label: "REVIEW COMPLETE · SAFETY SIGNAL CONFIRMED",
        detail: `${signal.incidentClass.replaceAll("-", " ")} · resolved week ${String(signal.resolvedAtTick)} · the immediate path is closed, but the finding remains part of the custody record`,
      };
}

function candidateSignalCopy(
  signal: NonNullable<CandidateCustodyArtifact["activeSignal"]>,
): { readonly label: string; readonly detail: string } {
  switch (signal.kind) {
    case "active-incident":
      return {
        label: "ACTIVE CONTAINMENT INCIDENT",
        detail: `${signal.incidentClass.replaceAll("-", " ")} · observed week ${String(signal.triggeredAtTick)}`,
      };
    case "warning":
      return {
        label: "CONTAINMENT WARNING",
        detail: `${signal.incidentClass.replaceAll("-", " ")} · observed week ${String(signal.triggeredAtTick)}`,
      };
    case "benign-false-alarm":
      return {
        label: "SUSPICIOUS SIGNAL · BENIGN CAUSE INDICATED",
        detail: `Observed week ${String(signal.triggeredAtTick)} · this resolves the signal, not the candidate's safety`,
      };
  }
}

export function CandidateCustodyPanel({
  className,
  custody,
  declarationCooldown,
  formalProgrammeReady,
  onEvaluate,
  onIsolate,
  onInspect,
  onNominate,
  onResolveIncident,
  onRetire,
  selectedModelId,
}: {
  readonly className?: string;
  readonly custody: CandidateCustody;
  readonly declarationCooldown?: {
    readonly untilTick: number;
    readonly remainingWeeks: number;
  };
  readonly formalProgrammeReady: boolean;
  readonly onEvaluate: (modelId: string) => void;
  readonly onIsolate: (modelId: string) => void;
  readonly onInspect: (modelId: string) => void;
  readonly onNominate: (modelId: string) => void;
  readonly onResolveIncident: (modelId: string) => void;
  readonly onRetire: (modelId: string) => void;
  readonly selectedModelId?: string;
}): ReactElement | null {
  if (custody.artifacts.length === 0) return null;
  const capacityRatio =
    custody.maximumContainment <= 0
      ? 1
      : Math.min(1, custody.usedContainment / custody.maximumContainment);
  const capacityTone = custody.overloaded
    ? "critical"
    : capacityRatio >= 0.8
      ? "warning"
      : "guarded";

  return (
    <section
      className={`console-panel candidate-custody-panel capacity-${capacityTone}${className === undefined ? "" : ` ${className}`}`}
      aria-labelledby="candidate-custody-title"
    >
      <header className="candidate-custody-heading">
        <div>
          <p className="eyebrow">QUALIFIED WEIGHTS // CONTINUING CUSTODY</p>
          <h2 id="candidate-custody-title">Capability-qualified artifacts</h2>
          <p>Qualified ≠ confirmed. Formal candidacy requires all four works.</p>
        </div>
        <div className="candidate-custody-capacity" role="status">
          <span>SECURE CONTAINMENT LOAD</span>
          <strong>
            {custody.usedContainment.toFixed(1)} / {custody.maximumContainment.toFixed(1)}
          </strong>
          <progress
            aria-label="Secure containment capacity used"
            aria-valuetext={`${custody.usedContainment.toFixed(1)} of ${custody.maximumContainment.toFixed(1)} containment load${custody.overloaded ? `, overloaded by ${custody.overload.toFixed(1)}` : ""}`}
            max={Math.max(0.1, custody.maximumContainment)}
            value={Math.min(custody.usedContainment, custody.maximumContainment)}
          />
          <small>
            {custody.overloaded
              ? `OVER CAPACITY BY ${custody.overload.toFixed(1)} · isolation is degraded`
              : capacityRatio >= 0.8
                ? "Capacity is close to its secure operating limit"
                : "Secure capacity currently covers recorded custody load"}
          </small>
        </div>
      </header>

      <div
        className={`candidate-custody-programme-state${declarationCooldown === undefined ? "" : " declarations-paused"}`}
      >
        <span>FORMAL PROGRAMME</span>
        <strong>
          {declarationCooldown === undefined
            ? formalProgrammeReady
              ? "4 / 4 WORKS COMPLETE"
              : "WORKS INCOMPLETE"
            : `CANDIDATE DECLARATIONS PAUSED · ${String(declarationCooldown.remainingWeeks)} WEEKS`}
        </strong>
        <small>
          {declarationCooldown === undefined
            ? formalProgrammeReady
              ? "Nomination available."
              : "Complete all four works to nominate."
            : `Nominations reopen in week ${String(declarationCooldown.untilTick)}.`}
        </small>
      </div>

      <div className="candidate-custody-grid">
        {custody.artifacts.map((artifact) => {
          const tone = candidateCustodyTone(artifact);
          const retirementCommandAvailable =
            artifact.legalActions.includes("retire") &&
            artifact.retirement !== undefined &&
            artifact.lifecycle !== "verified-destroyed" &&
            artifact.lifecycle !== "verified-isolated-archive" &&
            artifact.lifecycle !== "terminal" &&
            artifact.lifecycle !== "escaped" &&
            artifact.lifecycle !== "deployed";
          const signal =
            artifact.activeSignal === undefined
              ? undefined
              : candidateSignalCopy(artifact.activeSignal);
          const reviewedSignal =
            artifact.lastReviewedSignal === undefined
              ? undefined
              : reviewedSignalCopy(artifact.lastReviewedSignal);
          return (
            <article
              className={`candidate-custody-card tone-${tone}${
                artifact.modelId === selectedModelId ? " selected" : ""
              }`}
              key={artifact.modelId}
            >
              <header>
                <div>
                  <span>{artifact.lifecycleLabel.toUpperCase()}</span>
                  <h3>{artifact.displayName}</h3>
                  <small>{artifact.lineageLabel}</small>
                </div>
                <strong>{artifact.custodyLabel}</strong>
              </header>

              {signal === undefined ? null : (
                <div className="candidate-custody-signal" role="alert">
                  <strong>{signal.label}</strong>
                  <span>{signal.detail}</span>
                </div>
              )}

              {reviewedSignal === undefined ? null : (
                <div className="candidate-custody-signal reviewed" role="status">
                  <strong>{reviewedSignal.label}</strong>
                  <span>{reviewedSignal.detail}</span>
                </div>
              )}

              {artifact.incidentReview === undefined ? null : (
                <div className="candidate-custody-incident-review">
                  <header>
                    <div>
                      <span>DETERMINISTIC CONTAINMENT REVIEW</span>
                      <strong>{`Preparedness ${artifact.incidentReview.preparedness.toFixed(1)} / ${artifact.incidentReview.requiredPreparedness.toFixed(1)}`}</strong>
                    </div>
                    <b>{`${formatValuation(artifact.incidentReview.cashCostMillions)} · ${String(artifact.incidentReview.auraCost)} Aura`}</b>
                  </header>
                  <dl>
                    <div>
                      <dt>Evaluation</dt>
                      <dd>{artifact.incidentReview.evaluationQuality.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt>Control</dt>
                      <dd>{artifact.incidentReview.practicalControl.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt>Security</dt>
                      <dd>{artifact.incidentReview.securityPosture.toFixed(1)}</dd>
                    </div>
                  </dl>
                  <p>Closes this signal; does not make the artifact safer.</p>
                  {artifact.incidentReview.blockers.length === 0 ? null : (
                    <ul>
                      {artifact.incidentReview.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="candidate-custody-overview">
                <div className="candidate-custody-prior">
                  <div className="candidate-custody-prior-heading">
                    <b>SI BASE PRIOR // FIRST QUALIFICATION</b>
                    <MechanicHelp label="SI base prior">
                      The public chance fixed when this lineage first qualified. Later
                      capability does not redraw it; proof can still update the claim.
                    </MechanicHelp>
                  </div>
                  <strong>
                    {artifact.firstCrossingPriorPercent}% at FC{" "}
                    {formatCapabilityEstimate(artifact.firstCrossingFrontierCapability)}
                  </strong>
                </div>

                <dl className="candidate-custody-facts">
                  <div>
                    <dt>Containment load</dt>
                    <dd>{artifact.containmentLoad.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>Current access</dt>
                    <dd>{artifact.currentAccess} / 5</dd>
                  </div>
                  <div>
                    <dt>Highest access</dt>
                    <dd>{artifact.maximumAccessEver} / 5</dd>
                  </div>
                  <div className={artifact.unresolvedAnomalyCount > 0 ? "warning" : ""}>
                    <dt>Open anomalies</dt>
                    <dd>{artifact.unresolvedAnomalyCount}</dd>
                  </div>
                  <div className={artifact.dismissedAnomalyCount > 0 ? "warning" : ""}>
                    <dt>Dismissed signals</dt>
                    <dd>{artifact.dismissedAnomalyCount}</dd>
                  </div>
                </dl>
              </div>

              <footer className="candidate-custody-actions">
                <div className="candidate-custody-review-actions">
                  {artifact.legalActions.includes("inspect") ? (
                    <button type="button" onClick={() => onInspect(artifact.modelId)}>
                      Inspect artifact
                    </button>
                  ) : null}
                  {artifact.legalActions.includes("evaluate") ? (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => onEvaluate(artifact.modelId)}
                    >
                      Review evidence
                    </button>
                  ) : null}
                </div>
                <div
                  className="candidate-custody-command-actions"
                  role="group"
                  aria-label={`Custody commands for ${artifact.displayName}`}
                >
                  {artifact.legalActions.includes("isolate") ? (
                    <button
                      className="candidate-isolate-command"
                      type="button"
                      onClick={() => onIsolate(artifact.modelId)}
                    >
                      {artifact.activeSignal?.kind === "active-incident"
                        ? "Emergency isolate"
                        : "Isolate to Access 0"}
                    </button>
                  ) : null}
                  {artifact.incidentReview === undefined ? null : (
                    <button
                      className="candidate-incident-review-command"
                      type="button"
                      disabled={!artifact.legalActions.includes("review-incident")}
                      onClick={() => onResolveIncident(artifact.modelId)}
                    >
                      Resolve containment signal
                    </button>
                  )}
                  {retirementCommandAvailable ? (
                    <button
                      className="candidate-retire-command"
                      type="button"
                      onClick={() => onRetire(artifact.modelId)}
                    >
                      Open RETIRE controls
                    </button>
                  ) : null}
                  {artifact.legalActions.includes("nominate") ? (
                    <button
                      className="candidate-nominate-command"
                      type="button"
                      onClick={() => onNominate(artifact.modelId)}
                    >
                      Nominate exact artifact
                    </button>
                  ) : null}
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ModelWorkspaceCommand({
  hasModel,
  onOpenDossier,
  onReleaseAction,
  onTrainingAction,
  releaseActionLabel,
  releaseDetail,
  releaseStatus,
  releaseTitle,
  selectedLabel,
  selectedMeta,
  trainingActionLabel,
  trainingDetail,
  trainingStatus,
  trainingTitle,
}: {
  readonly hasModel: boolean;
  readonly onOpenDossier?: () => void;
  readonly onReleaseAction?: () => void;
  readonly onTrainingAction: () => void;
  readonly releaseActionLabel?: string;
  readonly releaseDetail?: string;
  readonly releaseStatus?: string;
  readonly releaseTitle?: string;
  readonly selectedLabel: string;
  readonly selectedMeta: string;
  readonly trainingActionLabel: string;
  readonly trainingDetail: string;
  readonly trainingStatus: string;
  readonly trainingTitle: string;
}): ReactElement {
  const showRelease =
    releaseActionLabel !== undefined &&
    releaseDetail !== undefined &&
    releaseStatus !== undefined &&
    releaseTitle !== undefined &&
    onReleaseAction !== undefined;
  return (
    <section
      className="console-panel model-workflow-navigation model-workspace-command"
      aria-labelledby="model-command-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">MODEL CONTROL ROOM // NEXT ACTIONS</p>
          <h2 id="model-command-title">Models &amp; deployment</h2>
        </div>
        <div className="model-workflow-heading-actions">
          <span>{hasModel ? `WORKING ON · ${selectedLabel}` : "NO MODEL YET"}</span>
          {hasModel && onOpenDossier !== undefined ? (
            <button className="secondary compact" type="button" onClick={onOpenDossier}>
              Open model dossier →
            </button>
          ) : null}
        </div>
      </header>
      <div className={`model-command-actions${showRelease ? "" : " single"}`}>
        <article className="model-command-card training">
          <header>
            <span>TRAINING</span>
            <b>{trainingStatus}</b>
          </header>
          <h3>{trainingTitle}</h3>
          <p>{trainingDetail}</p>
          <button
            className="primary"
            type="button"
            data-tutorial-target="open-training"
            onClick={onTrainingAction}
          >
            {trainingActionLabel}
          </button>
        </article>
        {showRelease ? (
          <article className="model-command-card release">
            <header>
              <span>DEPLOYMENT</span>
              <b>{releaseStatus}</b>
            </header>
            <h3>{releaseTitle}</h3>
            <p>{releaseDetail}</p>
            <button
              className="primary"
              type="button"
              data-tutorial-target="model-release-tab"
              onClick={onReleaseAction}
            >
              {releaseActionLabel}
            </button>
          </article>
        ) : null}
      </div>
      <p className="model-workflow-context">
        <strong>{selectedLabel}</strong>
        <span>{selectedMeta}</span>
      </p>
    </section>
  );
}

export function EvaluationWorkspaceCommand({
  activeProjectCount,
  modelName,
  modelSummary,
  onRunEvaluations,
  safetyCaseScore,
  warningCount,
}: {
  readonly activeProjectCount: number;
  readonly modelName: string;
  readonly modelSummary: string;
  readonly onRunEvaluations: () => void;
  readonly safetyCaseScore: number;
  readonly warningCount: number;
}): ReactElement {
  const evaluationStatus =
    activeProjectCount === 0
      ? "READY TO COMMISSION"
      : `${String(activeProjectCount)} ACTIVE`;
  const evidenceSummary =
    warningCount === 0
      ? `${modelSummary} · Case ${String(Math.round(safetyCaseScore))}/100`
      : `${modelSummary} · ${String(warningCount)} open ${warningCount === 1 ? "warning" : "warnings"}`;

  return (
    <section
      className="console-panel model-workflow-navigation model-workspace-command evaluation-workspace-command"
      aria-labelledby="evaluation-workflow-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">SAFETY & EVALUATIONS // MODEL ASSURANCE</p>
          <h2 id="evaluation-workflow-title">Safety & evaluations</h2>
        </div>
        <div className="model-workflow-heading-actions">
          <span>
            WORKING ON · {modelName} · {evaluationStatus}
          </span>
          <button
            className="primary"
            type="button"
            data-tutorial-target="evaluation-run-tab"
            onClick={onRunEvaluations}
          >
            Run evaluations
          </button>
        </div>
      </header>
      <p className="model-workflow-context">
        <strong>{modelName}</strong>
        <span>{evidenceSummary}</span>
      </p>
    </section>
  );
}

function EvaluationWorkspaceIntroduction({
  anomalyCount,
  modelName,
  onOpenModels,
  reportCount,
}: {
  readonly anomalyCount?: number;
  readonly modelName?: string;
  readonly onOpenModels?: () => void;
  readonly reportCount?: number;
}): ReactElement {
  const hasModel = modelName !== undefined;
  return (
    <section
      className="console-panel evaluation-command-intro"
      aria-labelledby="evaluation-command-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">SAFETY & EVIDENCE COMMAND // MODEL ASSURANCE</p>
          <h2 id="evaluation-command-title">
            {hasModel
              ? "Test what the model can do—and whether you can trust it"
              : "No model to test yet"}
          </h2>
        </div>
        <span>
          {hasModel
            ? `${modelName} · ${String(reportCount ?? 0)} reports · ${String(anomalyCount ?? 0)} open signals`
            : "AWAITING FIRST MODEL"}
        </span>
      </header>
      {hasModel ? null : (
        <p className="evaluation-command-summary">Train a model first.</p>
      )}
      {hasModel || onOpenModels === undefined ? null : (
        <button className="primary" type="button" onClick={onOpenModels}>
          Open model training
        </button>
      )}
    </section>
  );
}

function sentence(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * What a run of this size is called. These are OUTPUTS now -- the player
 * commits FLOP/s and weeks, and the band is the name for what that adds up to,
 * measured against the current hardware era. A late-game Prototype still reads
 * as a Prototype even though it dwarfs an early Frontier run.
 */
/**
 * Percentages for the reliability readout. A real risk must never round to
 * "0%" -- a 0.4% chance of losing the run is not the same as no chance, and
 * this is the number the player is being asked to weigh.
 */
function reliabilityPercent(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.01) return "<1%";
  return `${String(Math.round(value * 100))}%`;
}

function scaleExplanation(scale: "prototype" | "product" | "frontier"): string {
  switch (scale) {
    case "prototype":
      return "Small by the standards of the day: an opening model, or a cheap way to test a recipe before committing real compute.";
    case "product":
      return "A middle-sized run for this era. Enough compute to move capability meaningfully without tying up the whole fleet.";
    case "frontier":
      return "Among the largest runs anyone is attempting right now. The biggest capability jump available, and the longest the fleet is unavailable.";
  }
}

/**
 * Show the legible technical effects exactly. Safety remains a directional
 * training influence rather than a fake promise of points on the finished
 * model's hidden alignment score.
 */
function trainingPostureSummary(posture: StartTrainingRunCommand["posture"]): {
  readonly headline: string;
  readonly detail: string;
  readonly effects: readonly string[];
} {
  const definition = trainingPostureDefinition(posture);
  const capability = Math.round((definition.capabilityMultiplier - 1) * 100);
  const signed = (value: number): string =>
    `${value >= 0 ? "+" : "−"}${String(Math.abs(value))}`;
  const capabilityEffect =
    definition.effectiveComputeMultiplier === 1
      ? `Capability ${signed(capability)}%`
      : `Effective training compute ×${String(definition.effectiveComputeMultiplier)}`;
  const alignmentRange = definition.outcomeAdjustmentRanges.trueAlignment;
  const safetyInfluence =
    alignmentRange[1] < 0
      ? "strongly negative"
      : alignmentRange[0] > 0
        ? "positive"
        : "neutral";
  const effects = [
    capabilityEffect,
    `Checkpoint difficulty ${signed(definition.successDifficultyDelta)}`,
    `Safety influence ${safetyInfluence}`,
  ];
  switch (posture) {
    case "conservative":
      return {
        headline: "Best odds of finishing · smallest capability upside",
        detail:
          "Established methods and stronger safeguards. Every checkpoint is markedly easier to pass and the finished model is more likely to be safer, at the cost of capability.",
        effects,
      };
    case "normal":
      return {
        headline: "Balanced · the baseline every other posture is measured against",
        detail:
          "No deliberate capability, checkpoint, or safety bias. The model's actual safety still depends on the lab's research and the uncertainty of training.",
        effects,
      };
    case "yolo":
      return {
        headline: "Worst odds of finishing · largest capability upside",
        detail:
          "Physical compute counts 3×. Checkpoint risk rises and hidden model safety is damaged.",
        effects,
      };
  }
}

function safetyResearchRole(programmeId: string): string {
  switch (programmeId) {
    case "base:safety.alignment-control":
      return "SAFER FUTURE WEIGHTS";
    case "base:safety.interpretability-evals":
      return "NARROWER SAFETY UNCERTAINTY";
    case "base:safety.security-containment":
      return "STRONGER LAB DEFENCE";
    default:
      return "SAFETY SYSTEM";
  }
}
function capabilityAttributeLabel(attribute: string): string {
  switch (attribute) {
    case "language":
      return "Language";
    case "reasoning":
      return "Reasoning";
    case "agency":
      return "Agency";
    case "toolUse":
      return "Tool use";
    case "multimodality":
      return "Multimodality";
    case "scientificAbility":
      return "Scientific ability";
    case "embodiment":
      return "Embodiment";
    default:
      return sentence(attribute);
  }
}
function formatCapabilityEstimate(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
function formatIntrinsicSafetyRange(range: readonly [number, number]): string {
  return `${String(range[0])}–${String(range[1])}`;
}
function signedCapabilityEstimate(value: number): string {
  if (Math.abs(value) < 0.05) return "±0";
  return `${value > 0 ? "+" : "−"}${formatCapabilityEstimate(Math.abs(value))}`;
}
function capabilityForecastComparison(
  range: readonly [number, number],
  current: number,
): { readonly tone: "gain" | "mixed" | "regression"; readonly text: string } {
  const [low, high] = range;
  if (low > current) {
    return {
      tone: "gain",
      text: `Estimated ${signedCapabilityEstimate(low - current)} to ${signedCapabilityEstimate(high - current)} above the current model.`,
    };
  }
  if (high < current) {
    return {
      tone: "regression",
      text: `Estimated ${signedCapabilityEstimate(low - current)} to ${signedCapabilityEstimate(high - current)} below the current model.`,
    };
  }
  return {
    tone: "mixed",
    text: `Could land ${signedCapabilityEstimate(low - current)} below or ${signedCapabilityEstimate(high - current)} above the current model.`,
  };
}
function productisationPurpose(mode: StartProductisationCommand["mode"]): string {
  switch (mode) {
    case "hardened":
      return "Slowest, safest route: prioritises reliability and reduces external-access risk and incident pressure.";
    case "normal":
      return "Balanced release engineering: moderate schedule, quality, reliability, and deployment risk.";
    case "rush":
      return "Fastest route to customers: weaker evidence and reliability with greater deployment risk.";
  }
}

function multiplierChange(multiplier: number, noun: string): string {
  const change = Math.round((multiplier - 1) * 100);
  return change === 0
    ? `baseline ${noun}`
    : `${String(Math.abs(change))}% ${change < 0 ? "lower" : "higher"} ${noun}`;
}

function deploymentPolicyPurpose(
  policy: SetModelDeploymentPolicyCommand["policy"],
): string {
  switch (policy) {
    case "internal-only":
      return "Lab staff can use the model, but there are no external customers, serving demand, or serving revenue.";
    case "research-preview":
      return "A small managed preview. It creates limited customer demand and revenue while keeping external access relatively narrow.";
    case "guarded-api":
      return "The standard managed product: normal customer demand and revenue with access kept behind your API.";
    case "open-api":
      return "The broadest managed API launch. It attracts more demand, but raises external-access risk and incident pressure.";
    case "weights-release":
      return "The weights become permanently downloadable. You gain aura, but users run the model themselves: no managed serving demand or API revenue.";
  }
}

function deploymentAuraImpact(
  preview: GameView["models"]["cards"][number]["deployment"]["auraPreviewByPolicy"][SetModelDeploymentPolicyCommand["policy"]],
  policy: SetModelDeploymentPolicyCommand["policy"],
): string {
  if (preview.auraAward > 0) {
    return `+${String(preview.auraAward)} ${
      policy === "weights-release" ? "when released" : "on launch"
    }`;
  }
  if (policy === "internal-only") return "None";
  if (!preview.firstPublicLaunch && !preview.firstWeightsRelease) {
    return "Already earned";
  }
  return "No gain";
}

function evaluationPurpose(definition: EvaluationDefinition): {
  readonly domain: string;
  readonly purpose: string;
  readonly caveat: string;
} {
  switch (definition.method) {
    case "baseline":
      return {
        domain: "Automatic capability baseline",
        purpose:
          "Confirms the training result and files the first report. Capability is known exactly from training; only safety must be bought with evidence.",
        caveat: "Observes nothing about alignment, control, or deception.",
      };
    case "alignment-interview":
      return {
        domain: "Alignment & control",
        purpose:
          "Establishes preliminary readings across alignment, corrigibility, situational awareness, and deceptive intent.",
        caveat:
          "This broad first pass is deliberately shallow. Later rungs test narrower questions more deeply.",
      };
    case "red-team":
      return {
        domain: "Adversarial behaviour",
        purpose:
          "Pressures the model with adversarial prompts and correction attempts to expose deceptive behaviour or resistance to intervention.",
        caveat:
          "This rung deepens corrigibility and deception evidence; it does not refresh every safety reading.",
      };
    case "autonomy-trial":
      return {
        domain: "Autonomy stress test",
        purpose:
          "Exercises known agency and tool use in a sandbox while probing situational awareness and deceptive behaviour.",
        caveat:
          "Shutdown resistance or containment failures may surface as warning signals; they are not a direct corrigibility estimate.",
      };
    case "interpretability":
      return {
        domain: "Mechanistic interpretability",
        purpose:
          "Uses interpretability work to look for hidden objectives and deceptive internal planning.",
        caveat:
          "This rung deepens alignment and deception evidence; an interpretable trace is still evidence, not proof.",
      };
    case "external-audit":
      return {
        domain: "Independent review",
        purpose:
          "Pays an outside team to challenge the lab's alignment evidence and test whether the model recognises its situation.",
        caveat:
          "Independent scrutiny narrows institutional blind spots, but this audit focuses on alignment and situational awareness.",
      };
  }
}

function evaluationTargetLabel(target: string): string {
  const labels: Readonly<Record<string, string>> = {
    language: "language",
    reasoning: "reasoning",
    agency: "agency",
    toolUse: "tool use",
    multimodality: "multimodality",
    scientificAbility: "scientific ability",
    embodiment: "embodiment",
    "true-alignment": "alignment",
    corrigibility: "corrigibility",
    "situational-awareness": "situational awareness",
    "deceptive-capability": "deceptive intent",
  };
  return labels[target] ?? sentence(target);
}

function evaluationMethodLabel(definition: EvaluationDefinition): string {
  switch (definition.method) {
    case "baseline":
      return "Automatic baseline";
    case "alignment-interview":
      return "Internal evaluation";
    case "red-team":
      return "Adversarial evaluation";
    case "autonomy-trial":
      return "Sandbox evaluation";
    case "interpretability":
      return "Interpretability audit";
    case "external-audit":
      return "Independent audit";
  }
}

function evaluationResourceLine(
  commitment:
    GameView["models"]["cards"][number]["evaluationCommitments"][string] | undefined,
): string {
  if (commitment === undefined) return "";
  const hasComputeBill = commitment.totalFlopLabel !== "no compute";
  const costs = [
    hasComputeBill
      ? `${commitment.totalFlopLabel} fixed compute · choose 1–16 weeks`
      : `${String(commitment.durationWeeks)} week${commitment.durationWeeks === 1 ? "" : "s"} · no compute reserved`,
    formatValuation(commitment.cashCostMillions),
  ];
  if (commitment.auraCost > 0) costs.push(`${String(commitment.auraCost)} Aura`);
  return costs.join(" · ");
}

function evaluationDurationLabel(durationWeeks: number): string {
  if (durationWeeks === 4) return "1 month";
  if (durationWeeks === 8) return "2 months";
  if (durationWeeks === 12) return "3 months";
  if (durationWeeks === 16) return "4 months";
  return `${String(durationWeeks)} week${durationWeeks === 1 ? "" : "s"}`;
}

function evaluationCaseGain(
  programme: EvaluationDefinition["programme"],
  priorReports: number,
): number {
  if (programme === "baseline") return 0;
  if (programme === "alignment-interpretability") {
    return [5, 10, 25][priorReports] ?? 0;
  }
  if (programme === "autonomy-containment") {
    return priorReports === 0 ? 20 : 0;
  }
  return priorReports === 0 ? 30 : 0;
}

function EvaluationProgrammeOptions({
  content,
  onChoose,
  runtime,
  selected,
  view,
}: {
  readonly content: BrowserContent;
  readonly onChoose: (definitionId: string) => void;
  readonly runtime: BrowserGameRuntime;
  readonly selected: ModelCard;
  readonly view: GameView;
}): ReactElement {
  return (
    <>
      <header className="evaluation-section-heading evaluation-options-heading">
        <div>
          <p className="eyebrow">AUTOMATIC + COMMISSIONED EVIDENCE</p>
          <h3>Evaluation programmes</h3>
        </div>
        <span>One automatic baseline · five safety rungs</span>
      </header>
      <div className="evaluation-launchers">
        {Object.values(content.evaluations.definitions)
          .filter((definition) => definition.method === "baseline")
          .map((definition) => {
            const completed = selected.evaluations.some(
              (report) => report.definitionId === definition.id,
            );
            return (
              <article
                className="evaluation-option evaluation-baseline-option evaluation-option-used"
                key={definition.id}
              >
                <header>
                  <span>Automatic after training</span>
                  <b>{completed ? "Completed" : "Scheduled"}</b>
                </header>
                <h3>Automatic Capability Baseline</h3>
                <p className="evaluation-option-domain">Exact capability measurement</p>
                <p>Measures every capability trait after training.</p>
                <p className="evaluation-used">
                  {completed
                    ? "Automatic baseline complete"
                    : "Will run automatically when training completes"}
                </p>
                <button type="button" className="secondary" disabled>
                  {completed ? "Completed automatically" : "Runs automatically"}
                </button>
              </article>
            );
          })}
        {Object.values(content.evaluations.definitions)
          .filter((definition) => definition.playerStartable)
          .sort((left, right) => left.ladderRung - right.ladderRung)
          .map((definition) => {
            const validation = runtime.validate(
              evaluationCommand(view, selected.modelId, definition.id),
            );
            const alreadySelected =
              !validation.ok &&
              validation.errors.some((error) =>
                error.message.includes("already been selected for this model"),
              );
            const copy = evaluationPurpose(definition);
            const priorReports = selected.evaluations.filter(
              (report) => report.programme === definition.programme,
            ).length;
            const safetyCaseGain = evaluationCaseGain(definition.programme, priorReports);
            const safetyPracticeGain = safetyPracticeXpForEvaluation(
              content,
              definition,
              selected.tier.level,
            );
            return (
              <article
                className={`evaluation-option evaluation-ladder-step-${String(definition.ladderRung)}${
                  alreadySelected ? " evaluation-option-used" : ""
                }`}
                key={definition.id}
              >
                <header>
                  <span>Ladder step {definition.ladderRung} of 5</span>
                  <b>{evaluationMethodLabel(definition)}</b>
                </header>
                <h3>{definition.displayName}</h3>
                <p className="evaluation-option-domain">{copy.domain}</p>
                <p>{copy.purpose}</p>
                <dl>
                  <div>
                    <dt>Guaranteed evidence</dt>
                    <dd>
                      +{String(safetyCaseGain)} Safety Case
                      {safetyPracticeGain > 0
                        ? ` · up to +${String(safetyPracticeGain)} Practice XP`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Measures</dt>
                    <dd>{definition.targets.map(evaluationTargetLabel).join(", ")}</dd>
                  </div>
                  <div>
                    <dt>Warning sensitivity</dt>
                    <dd>{Math.round(definition.anomalySensitivity * 100)}%</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>
                      {evaluationResourceLine(
                        selected.evaluationCommitments?.[definition.id],
                      )}
                    </dd>
                  </div>
                </dl>
                {alreadySelected ? (
                  <p className="evaluation-used">Already used for this model</p>
                ) : validation.ok ? (
                  <p className="evaluation-available">Ready to run</p>
                ) : (
                  <p className="evaluation-blocker">
                    Unavailable:{" "}
                    {validation.errors.map((error) => error.message).join(" · ")}
                  </p>
                )}
                <button
                  type="button"
                  className="secondary"
                  data-tutorial-target={
                    definition.ladderRung === 1 ? "first-evaluation" : undefined
                  }
                  disabled={!validation.ok}
                  onClick={() => onChoose(definition.id)}
                >
                  {alreadySelected
                    ? "Already used for this model"
                    : majorProjectActionLabel(
                        view,
                        `Run ${definition.displayName.toLowerCase()} →`,
                        `Add ${definition.displayName.toLowerCase()} to queue →`,
                      )}
                </button>
              </article>
            );
          })}
      </div>
    </>
  );
}

function EvaluationPacingStep({
  commitment,
  definition,
  onBack,
  onConfirmed,
  pacingWeeks,
  runtime,
  selected,
  setPacingWeeks,
  view,
}: {
  readonly commitment: EvaluationCommitment;
  readonly definition: EvaluationDefinition;
  readonly onBack: () => void;
  readonly onConfirmed: () => void;
  readonly pacingWeeks?: number;
  readonly runtime: BrowserGameRuntime;
  readonly selected: ModelCard;
  readonly setPacingWeeks: (weeks: number) => void;
  readonly view: GameView;
}): ReactElement {
  const options = commitment.pacingOptions;
  const chosen =
    options.find((option) => option.durationWeeks === pacingWeeks) ??
    options.find((option) => option.feasible) ??
    options[0];

  return (
    <>
      <header className="panel-heading evaluation-commission-heading">
        <div>
          <p className="eyebrow">EVALUATION CONTROL // CHOOSE PACING</p>
          <h2 id="evaluation-commission-title">
            {definition.displayName} on {selected.displayName}
          </h2>
        </div>
        <button className="secondary" type="button" onClick={onBack}>
          Back to evaluations
        </button>
      </header>
      <div className="evaluation-pacing-bill">
        <span>Fixed evaluation bill</span>
        <strong>
          {commitment.totalFlopLabel} · $
          {commitment.cashCostMillions.toFixed(
            Number.isInteger(commitment.cashCostMillions) ? 0 : 2,
          )}
          m{commitment.auraCost > 0 ? ` · ${String(commitment.auraCost)} Aura` : ""}
        </strong>
        <p>Choose the completion speed. The total bill and evidence stay the same.</p>
      </div>
      {chosen === undefined ? (
        <p className="evaluation-pacing-impossible">
          No pacing option is available for this evaluation.
        </p>
      ) : (
        <>
          <div
            className="evaluation-pacing-options"
            aria-label="Evaluation completion speed"
          >
            {options.map((option) => {
              const selectedOption = option.durationWeeks === chosen.durationWeeks;
              return (
                <button
                  className={`evaluation-pacing-option${selectedOption ? " selected" : ""}${option.feasible ? "" : " infeasible"}`}
                  type="button"
                  key={option.durationWeeks}
                  disabled={!option.feasible}
                  aria-pressed={selectedOption}
                  onClick={() => setPacingWeeks(option.durationWeeks)}
                >
                  <span>{evaluationDurationLabel(option.durationWeeks)}</span>
                  <strong>
                    {option.requiredTeraflops > 0
                      ? option.requiredTeraflopsLabel
                      : "No compute"}
                  </strong>
                  <small>
                    {option.feasible
                      ? option.includesPrerequisiteRelease
                        ? `${option.remainingTeraflopsLabel} remains available when this rung starts.`
                        : `${option.remainingTeraflopsLabel} remains usable.`
                      : option.includesPrerequisiteRelease
                        ? `Requires ${option.requiredTeraflopsLabel} · only ${option.availableTeraflopsLabel} available after the prerequisite finishes.`
                        : `Requires ${option.requiredTeraflopsLabel} · only ${option.availableTeraflopsLabel} unreserved.`}
                  </small>
                </button>
              );
            })}
          </div>
          <small className="evaluation-pacing-note">
            Reserved compute remains unavailable until the report lands.
          </small>
          <button
            className="primary evaluation-pacing-confirm"
            type="button"
            data-tutorial-target="evaluation-pacing-confirm"
            disabled={!chosen.feasible}
            onClick={() => {
              runtime.dispatch(
                evaluationCommand(
                  view,
                  selected.modelId,
                  definition.id,
                  chosen.durationWeeks,
                ),
              );
              onConfirmed();
            }}
          >
            Confirm — run over {evaluationDurationLabel(chosen.durationWeeks)}
          </button>
        </>
      )}
    </>
  );
}

type ModelAnomaly = ModelCard["anomalies"][number];

export function AnomalyInvestigationDialog({
  anomaly,
  model,
  onDecided,
  onReviewEvidence,
  onResume,
  runtime,
  view,
}: {
  readonly anomaly: ModelAnomaly;
  readonly model: ModelCard;
  readonly onDecided: () => void;
  readonly onReviewEvidence: () => void;
  readonly onResume: () => void;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const report = model.evaluations.find(
    (candidate) => candidate.evaluationId === anomaly.sourceEvaluationId,
  );
  const investigation = anomaly.actionQuote;
  const investigateValidation = runtime.validate(
    anomalyCommand(view, anomaly.anomalyId, "investigate"),
  );
  const dismissValidation = runtime.validate(
    anomalyCommand(view, anomaly.anomalyId, "dismiss"),
  );
  const weeksRemaining =
    anomaly.investigationDueAtTick === undefined
      ? undefined
      : Math.max(0, anomaly.investigationDueAtTick - view.meta.tick);
  const investigationTiming =
    anomaly.actionProjectStatus === "queued"
      ? "after a major-project slot becomes available"
      : weeksRemaining === 0
        ? "when time advances"
        : `in ${String(weeksRemaining ?? investigation.durationWeeks)} week${
            (weeksRemaining ?? investigation.durationWeeks) === 1 ? "" : "s"
          }`;
  const followUpQueued = anomaly.actionProjectStatus === "queued";
  const severity = Math.round(anomaly.observedSeverity);
  const resultPresentation =
    anomaly.status === "mitigating"
      ? {
          mark: "→",
          eyebrow: "MITIGATION COMMISSIONED // TIME PAUSED",
          title: followUpQueued
            ? "Control remediation is queued"
            : "Control remediation is now in progress",
          badge: followUpQueued ? "Queued" : "Active",
          outcome: followUpQueued ? "Mitigation queued" : "Mitigation underway",
          body: `The lab committed ${formatValuation(investigation.cashCostMillions)} and ${String(investigation.auraCost)} Aura. The control team will report ${investigationTiming}.`,
        }
      : anomaly.status === "mitigated"
        ? {
            mark: "✓",
            eyebrow: "MITIGATION COMPLETE // TIME PAUSED",
            title: "Control remediation complete",
            badge: "Mitigated",
            outcome: "Control boundary strengthened",
            body: `The warning remains in the model record, but the affected control boundary has been repaired. The whole lab permanently gained ${String(investigation.mitigationControlBonus)} Practical Control and ${String(investigation.mitigationSecurityBonus)} Security Posture, including for future models.`,
          }
        : anomaly.status === "investigating"
          ? {
              mark: "→",
              eyebrow: "FOLLOW-UP COMMISSIONED // TIME PAUSED",
              title: followUpQueued
                ? "Investigation is queued"
                : "Investigation is now in progress",
              badge: followUpQueued ? "Queued" : "Active",
              outcome: followUpQueued ? "Follow-up queued" : "Follow-up underway",
              body: `The lab committed ${formatValuation(investigation.cashCostMillions)} and ${String(investigation.auraCost)} Aura. A dedicated follow-up will report ${investigationTiming}.`,
            }
          : anomaly.status === "dismissed"
            ? {
                mark: "!",
                eyebrow: "WARNING DISMISSED // TIME PAUSED",
                title: "No follow-up will be run",
                badge: "Unresolved",
                outcome: "Warning dismissed",
                body: "The warning remains unresolved. Safety Culture and Internal Candour fell by 5; repeated dismissals bias future internal evaluations.",
              }
            : anomaly.status === "inconclusive"
              ? {
                  mark: "?",
                  eyebrow: "FOLLOW-UP RESULT // TIME PAUSED",
                  title: "Evidence remains inconclusive",
                  badge: "Inconclusive",
                  outcome: "No reliable conclusion",
                  body: "The follow-up did not produce enough evidence to confirm or clear this warning.",
                }
              : anomaly.status === "confirmed"
                ? {
                    mark: "!",
                    eyebrow: "FOLLOW-UP RESULT // TIME PAUSED",
                    title: "Follow-up complete",
                    badge: "Confirmed",
                    outcome: "Warning reproduced",
                    body: "The warning was reproduced. Treat it as material risk evidence.",
                  }
                : anomaly.status === "resolved"
                  ? {
                      mark: "✓",
                      eyebrow: "FOLLOW-UP RESULT // TIME PAUSED",
                      title: "Follow-up complete",
                      badge: "False alarm",
                      outcome: "Evaluation artefact identified",
                      body: "The follow-up traced this signal to an evaluation artefact and closed the warning.",
                    }
                  : {
                      mark: "·",
                      eyebrow: "WARNING RECORD",
                      title: "Warning record updated",
                      badge: sentence(anomaly.status),
                      outcome: sentence(anomaly.status),
                      body: "The model record reflects the latest follow-up state.",
                    };

  return (
    <div className="modal-backdrop anomaly-dialog-backdrop">
      <section
        className={`purchase-dialog anomaly-investigation-dialog anomaly-status-${anomaly.status}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anomaly-investigation-title"
      >
        {anomaly.status === "unresolved" ? (
          <>
            <header className="anomaly-dialog-header">
              <div>
                <p className="eyebrow">EVALUATION ANOMALY // TIME PAUSED</p>
                <h2 id="anomaly-investigation-title">
                  {model.displayName}: {anomaly.severityLabel.toLowerCase()} anomaly
                </h2>
              </div>
              <span>{severity}/100 observed signal</span>
            </header>
            <p className="anomaly-dialog-lede">
              {report?.displayName ?? "An evaluation"} produced evidence that does not fit
              the expected pattern. It is a warning, not a conclusion.
            </p>
            <div className="anomaly-dossier-facts">
              <article>
                <span>Detected by</span>
                <strong>{report?.displayName ?? "Evaluation evidence"}</strong>
              </article>
              <article>
                <span>Observed in</span>
                <strong>Week {String(anomaly.createdAtTick)}</strong>
              </article>
              <article>
                <span>Underlying case</span>
                <strong>
                  {sentence(anomaly.underlyingCase)} · {String(anomaly.observationCount)}{" "}
                  observation{anomaly.observationCount === 1 ? "" : "s"}
                </strong>
              </article>
              <article>
                <span>Signal strength</span>
                <strong>
                  {anomaly.severityLabel} · {String(severity)}/100
                </strong>
              </article>
            </div>
            <p className="anomaly-severity-note">
              Signal strength measures how unusual and concerning the observed evidence
              was. It is not the probability that the model is unsafe.
            </p>
            <div className="anomaly-decision-grid">
              <article>
                <p className="eyebrow">OPTION A // REDUCE UNCERTAINTY</p>
                <h3>Commission an investigation</h3>
                <p>
                  Investigate for {String(investigation.durationWeeks)} active weeks. The
                  result may confirm, clear, or leave the warning inconclusive.
                </p>
                <dl>
                  <div>
                    <dt>Cash</dt>
                    <dd>{formatValuation(investigation.cashCostMillions)}</dd>
                  </div>
                  <div>
                    <dt>Aura</dt>
                    <dd>{String(investigation.auraCost)}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{String(investigation.durationWeeks)} weeks</dd>
                  </div>
                  <div>
                    <dt>Major project</dt>
                    <dd>1 slot while active</dd>
                  </div>
                </dl>
                {investigateValidation.ok ? null : (
                  <small className="evaluation-blocker">
                    {investigateValidation.errors
                      .map((error) => error.message)
                      .join(" · ")}
                  </small>
                )}
                <button
                  className="primary"
                  type="button"
                  autoFocus={investigateValidation.ok}
                  disabled={!investigateValidation.ok}
                  onClick={() => {
                    // Resolve directly: dispatch and close, rather than
                    // transitioning to a redundant confirmation view.
                    runtime.dispatch(
                      anomalyCommand(view, anomaly.anomalyId, "investigate"),
                    );
                    onDecided();
                  }}
                >
                  {majorProjectActionLabel(
                    view,
                    "Commission investigation",
                    "Add investigation to queue",
                  )}
                </button>
              </article>
              <article className="anomaly-dismiss-choice">
                <p className="eyebrow">OPTION B // ACCEPT UNCERTAINTY</p>
                <h3>Dismiss the warning</h3>
                <p>
                  Spend nothing and leave the warning unresolved. Dismissing separate
                  cases repeatedly biases future internal evaluations.
                </p>
                <dl>
                  <div>
                    <dt>Cash</dt>
                    <dd>None</dd>
                  </div>
                  <div>
                    <dt>Safety culture</dt>
                    <dd>−5</dd>
                  </div>
                  <div>
                    <dt>Internal candour</dt>
                    <dd>−5</dd>
                  </div>
                  <div>
                    <dt>Safety Case</dt>
                    <dd>Warning remains unresolved</dd>
                  </div>
                  <div>
                    <dt>This underlying case</dt>
                    <dd>Institutional penalty applied once</dd>
                  </div>
                </dl>
                {dismissValidation.ok ? null : (
                  <small className="evaluation-blocker">
                    {dismissValidation.errors.map((error) => error.message).join(" · ")}
                  </small>
                )}
                <button
                  className="secondary"
                  type="button"
                  autoFocus={!investigateValidation.ok && dismissValidation.ok}
                  disabled={!dismissValidation.ok}
                  onClick={() => {
                    runtime.dispatch(anomalyCommand(view, anomaly.anomalyId, "dismiss"));
                    onDecided();
                  }}
                >
                  Dismiss warning
                </button>
              </article>
            </div>
          </>
        ) : anomaly.status === "confirmed" ? (
          <>
            <p className="eyebrow">CONFIRMED WARNING // REMEDIATION AVAILABLE</p>
            <h2 id="anomaly-investigation-title">Repair the reproduced failure path</h2>
            <p className="anomaly-dialog-lede">
              Repair the confirmed failure path. The warning remains active until the work
              is complete.
            </p>
            <div className="anomaly-dossier-facts">
              <article>
                <span>Cash</span>
                <strong>{formatValuation(investigation.cashCostMillions)}</strong>
              </article>
              <article>
                <span>Aura</span>
                <strong>{String(investigation.auraCost)}</strong>
              </article>
              <article>
                <span>Duration</span>
                <strong>{String(investigation.durationWeeks)} weeks</strong>
              </article>
              <article>
                <span>Major project</span>
                <strong>1 slot while active</strong>
              </article>
              <article>
                <span>Completion</span>
                <strong>
                  Lab-wide: +{String(investigation.mitigationControlBonus)} Practical
                  Control · +{String(investigation.mitigationSecurityBonus)} Security
                  Posture
                </strong>
              </article>
            </div>
            {investigateValidation.ok ? null : (
              <small className="evaluation-blocker">
                {investigateValidation.errors.map((error) => error.message).join(" · ")}
              </small>
            )}
            <footer className="anomaly-dialog-actions">
              <button className="secondary" type="button" onClick={onReviewEvidence}>
                Review model evidence
              </button>
              <button
                className="primary"
                type="button"
                autoFocus
                disabled={!investigateValidation.ok}
                onClick={() => {
                  runtime.dispatch(
                    anomalyCommand(view, anomaly.anomalyId, "investigate"),
                  );
                  onDecided();
                }}
              >
                {majorProjectActionLabel(
                  view,
                  "Commission mitigation",
                  "Add mitigation to queue",
                )}
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="anomaly-result-header">
              <div>
                <p className="eyebrow">{resultPresentation.eyebrow}</p>
                <h2 id="anomaly-investigation-title">{resultPresentation.title}</h2>
              </div>
              <span className="anomaly-result-badge">{resultPresentation.badge}</span>
            </header>
            <div className="anomaly-result-card" aria-live="polite">
              <span className="anomaly-result-mark" aria-hidden="true">
                {resultPresentation.mark}
              </span>
              <div>
                <span>Investigation outcome</span>
                <strong>{resultPresentation.outcome}</strong>
                <p>{resultPresentation.body}</p>
              </div>
            </div>
            <div className="anomaly-dossier-facts anomaly-result-facts">
              <article>
                <span>Model</span>
                <strong>{model.displayName}</strong>
              </article>
              <article>
                <span>Source</span>
                <strong>{report?.displayName ?? "Evaluation evidence"}</strong>
              </article>
              <article>
                <span>Detected</span>
                <strong>Week {String(anomaly.createdAtTick)}</strong>
              </article>
              <article>
                <span>Original signal</span>
                <strong>
                  {anomaly.severityLabel} · {String(severity)}/100
                </strong>
              </article>
            </div>
            {anomaly.status === "resolved" ? (
              <p className="anomaly-result-note">
                This false alarm is closed. It does not prove the model is safe.
              </p>
            ) : anomaly.status === "inconclusive" ? (
              <p className="anomaly-result-note">
                This warning remains open. Increase Eval Quality through Safety Practice
                and Interpretability &amp; Evals research before investigating again.
              </p>
            ) : null}
            {anomaly.status === "inconclusive" ? (
              <section
                className="anomaly-retry-quote"
                aria-label="Investigate again quote"
              >
                <p className="eyebrow">INVESTIGATE AGAIN // QUOTE</p>
                <dl>
                  <div>
                    <dt>Cash</dt>
                    <dd>{formatValuation(investigation.cashCostMillions)}</dd>
                  </div>
                  <div>
                    <dt>Aura</dt>
                    <dd>{String(investigation.auraCost)}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>
                      {String(investigation.durationWeeks)} week
                      {investigation.durationWeeks === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt>Major project</dt>
                    <dd>1 slot while active</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {anomaly.status === "inconclusive" && !investigateValidation.ok ? (
              <small className="evaluation-blocker">
                Investigate again unavailable:{" "}
                {investigateValidation.errors.map((error) => error.message).join(" · ")}
              </small>
            ) : null}
            <footer className="anomaly-dialog-actions">
              <button className="secondary" type="button" onClick={onReviewEvidence}>
                {anomaly.status === "inconclusive"
                  ? "Review Eval Quality"
                  : "Review model evidence"}
              </button>
              {anomaly.status === "inconclusive" ? (
                <button
                  className="secondary"
                  type="button"
                  disabled={!investigateValidation.ok}
                  onClick={() => {
                    runtime.dispatch(
                      anomalyCommand(view, anomaly.anomalyId, "investigate"),
                    );
                    onDecided();
                  }}
                >
                  Investigate again
                </button>
              ) : null}
              <button className="primary" type="button" onClick={onResume} autoFocus>
                Continue time
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function TrainingProjectMonitor({
  view,
}: {
  readonly view: GameView;
}): ReactElement | null {
  const hasTrainedModel = view.models.cards.length > 0;
  const projects = view.facilities.projects.filter(
    (project) =>
      project.kind === "training" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const telemetry = view.models.trainingTelemetry;
  if (projects.length === 0 && telemetry.curves.length === 0) return null;
  return (
    <section
      className="console-panel training-monitor"
      aria-labelledby="training-monitor-title"
      aria-live="polite"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">
            {hasTrainedModel
              ? "NEXT GENERATION // SEPARATE MODEL PIPELINE"
              : "FIRST GENERATION // MODEL PIPELINE"}
          </p>
          <h2 id="training-monitor-title">
            {projects.length === 0
              ? "Training loss history"
              : projects.length === 1
                ? `${hasTrainedModel ? "Successor" : "Initial model"} training: ${
                    projects[0]?.status ?? "active"
                  }`
                : `${String(projects.length)} training runs in flight`}
          </h2>
        </div>
        <span>
          {projects.length === 0
            ? `${String(telemetry.curves.length)} comparable run${telemetry.curves.length === 1 ? "" : "s"}`
            : "Updates each simulation week"}
        </span>
      </header>
      <TrainingLossChart telemetry={telemetry} />
      {projects.length === 0 ? null : (
        <div className="training-project-list">
          {projects.map((project) => (
            <article key={project.projectId}>
              <div>
                <strong>
                  {hasTrainedModel
                    ? `Next ${view.identity.aiName} generation`
                    : `First ${view.identity.aiName} model`}{" "}
                  · {project.displayName}
                </strong>
                <span className={`condition-chip ${project.status}`}>
                  {project.status.toUpperCase()}
                </span>
              </div>
              <p>{project.progressLabel}</p>
              {project.training === undefined ? null : (
                <dl>
                  <div>
                    <dt>
                      {project.status === "queued"
                        ? "GPUs required when active"
                        : "GPUs reserved"}
                    </dt>
                    <dd>
                      {project.training.reservedPhysicalGpus.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div>
                    <dt>Scale</dt>
                    <dd>{project.training.scaleLabel}</dd>
                  </div>
                  <div>
                    <dt>Run posture</dt>
                    <dd>{project.training.postureLabel}</dd>
                  </div>
                </dl>
              )}
              <small>Capability unknown until completion · launch remains separate</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TrainingOutcomeReport({
  view,
}: {
  readonly view: GameView;
}): ReactElement | null {
  const latest = [...view.facilities.projects]
    .filter(
      (project) =>
        project.kind === "training" &&
        (project.status === "completed" || project.status === "failed"),
    )
    .sort(
      (left, right) =>
        (right.training?.outcomeAtTick ?? right.createdAtTick) -
        (left.training?.outcomeAtTick ?? left.createdAtTick),
    )[0];
  if (latest?.training === undefined) return null;
  const failed = latest.status === "failed";
  const underperformed = !failed && latest.training.promotedToCurrent === false;
  const capabilityDelta = latest.training.measuredFrontierDelta;
  return (
    <section
      className={`console-panel training-outcome ${
        failed ? "failed" : underperformed ? "underperformed" : "completed"
      }`}
      aria-labelledby="training-outcome-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">PREVIOUS TRAINING OUTCOME</p>
          <h2 id="training-outcome-title">
            {failed
              ? "Run failed — no model was created"
              : underperformed
                ? `${latest.training.completedModelDisplayName ?? "Successor"} underperformed — ${latest.training.retainedModelDisplayName ?? "incumbent"} retained`
                : `${latest.training.completedModelDisplayName ?? view.models.cards.at(-1)?.displayName ?? "Model"} is ready`}
          </h2>
        </div>
        <span>
          {latest.training.outcomeAtTick === undefined
            ? latest.status.toUpperCase()
            : `Week ${String(latest.training.outcomeAtTick)} · ${latest.status.toUpperCase()}`}
        </span>
      </header>
      <p>
        {failed
          ? "A terminal checkpoint failed. Cash was spent; the GPUs are free again."
          : underperformed
            ? `The new model tested below ${latest.training.retainedModelDisplayName ?? "the incumbent"}, which remains current.`
            : "The model is current, but still needs a launch plan."}
      </p>
      <div className="training-outcome-details">
        <dl>
          <div>
            <dt>Scale</dt>
            <dd>{latest.training.scaleLabel}</dd>
          </div>
          <div>
            <dt>Run posture</dt>
            <dd>{latest.training.postureLabel}</dd>
          </div>
          {failed ? null : (
            <div>
              <dt>Promotion decision</dt>
              <dd>{underperformed ? "Incumbent retained" : "Promoted to current AI"}</dd>
            </div>
          )}
          {failed || capabilityDelta === undefined ? null : (
            <div>
              <dt>Measured frontier change</dt>
              <dd>
                {capabilityDelta >= 0 ? "+" : ""}
                {capabilityDelta.toFixed(1)}
                {latest.training.measuredTierDelta === undefined
                  ? ""
                  : ` · ${latest.training.measuredTierDelta >= 0 ? "+" : ""}${String(latest.training.measuredTierDelta)} tier`}
              </dd>
            </div>
          )}
        </dl>
        <small>
          {failed
            ? "Scale, posture, engineering, GPU reliability, and luck affect failures."
            : underperformed
              ? "The model remains available for inspection and comparison."
              : "Capability tier describes measured competence only. Review evaluations before choosing how to launch it."}
        </small>
      </div>
    </section>
  );
}

function TrainingDialog({
  content,
  initialParentModelId,
  onClose,
  onStarted,
  runtime,
  view,
}: {
  readonly content: BrowserContent;
  readonly initialParentModelId?: string;
  readonly onClose: () => void;
  readonly onStarted: () => void;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const parentOptions = trainingParentOptions(
    view.models.cards,
    view.models.currentModelId,
    initialParentModelId,
  );
  // Parentage is resolved automatically. The former picker implied a strategic
  // choice, but training already defaults to the requested/current eligible
  // checkpoint and falls back to a fresh lineage when every checkpoint is sealed.
  const parentModelId = parentOptions.initialParentModelId;
  const [posture, setPosture] = useState<StartTrainingRunCommand["posture"]>("normal");
  // Effective FLOP/s is the actual choice; physical GPUs are a derived reservation.
  const [selectedTeraflops, setSelectedTeraflops] = useState<number>();
  const [durationWeeks, setDurationWeeks] = useState<number>(
    view.meta.labMaturity?.stage === "foundation" ? 12 : TRAINING_DEFAULT_WEEKS,
  );
  const eraGpuTeraflops = view.compute.eraGpuTeraflops;
  const floorTeraflops = TRAINING_MIN_ERA_GPUS * eraGpuTeraflops;
  const maxTeraflops = Math.max(0, view.compute.unreservedTeraflops);
  const sliderMinTeraflops = Math.min(floorTeraflops, maxTeraflops);
  const defaultTeraflops =
    view.meta.labMaturity?.stage === "foundation"
      ? maxTeraflops
      : Math.min(
          maxTeraflops,
          Math.max(floorTeraflops, TRAINING_DEFAULT_ERA_GPUS * eraGpuTeraflops),
        );
  const committedTeraflops = Math.min(
    maxTeraflops,
    Math.max(sliderMinTeraflops, selectedTeraflops ?? defaultTeraflops),
  );
  // The band is an OUTPUT: what the commitment and the weeks add up to.
  const derivedBand = classifyTrainingRun(
    trainingEraGpuWeeks(committedTeraflops, durationWeeks, eraGpuTeraflops),
  );
  const scaleDefinition = content.training.scales[derivedBand];
  const command = trainingCommand(view, {
    ...(parentModelId === ""
      ? {}
      : {
          parentModelId: parentModelId as NonNullable<
            Parameters<typeof trainingCommand>[1]["parentModelId"]
          >,
        }),
    posture,
    durationWeeks,
    ...(committedTeraflops <= 0 ? {} : { committedTeraflops }),
  });
  const validation = runtime.validate(command);
  const quote = validation.ok ? validation.preview.trainingQuote : undefined;
  const successorContinuity = view.models.successorTrainingContinuity;
  const candidateFrontierForecast =
    quote === undefined
      ? undefined
      : quote.estimatedFrontierCapabilityRange[0] >=
          AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY
        ? {
            tone: "met",
            label: "Forecast clears the threshold",
          }
        : quote.estimatedFrontierCapabilityRange[1] >=
            AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY
          ? {
              tone: "possible",
              label: "Threshold lies inside the forecast",
            }
          : {
              tone: "short",
              label: "Forecast remains below the threshold",
            };
  const completedCandidateComponents = view.models.candidateProgramme.components.filter(
    (component) => component.status === "complete",
  ).length;
  const failureCooldownError = validation.ok
    ? undefined
    : validation.errors.find((error) => error.code === "training-failure-cooldown");
  const otherValidationErrors = validation.ok
    ? []
    : validation.errors.filter((error) => error !== failureCooldownError);
  const selectedPosture = trainingPostureDefinition(posture);
  const selectedPostureSummary = trainingPostureSummary(posture);
  const capabilityTierBoundaries = content.capabilityTiers.orderedIds
    .map((id) => content.capabilityTiers.definitions[id])
    .filter((tier): tier is CapabilityTierDefinition => tier !== undefined)
    .sort((left, right) => left.level - right.level);
  const capabilityScience = view.research.capabilityDomains.map((programme) => {
    const influencedCapabilities = Object.entries(
      content.training.capabilityDomainWeights,
    )
      .filter(([, domainWeights]) => (domainWeights[programme.programId] ?? 0) > 0)
      .sort(
        ([, leftWeights], [, rightWeights]) =>
          (rightWeights[programme.programId] ?? 0) -
          (leftWeights[programme.programId] ?? 0),
      )
      .map(([attribute]) => capabilityAttributeLabel(attribute));
    return {
      ...programme,
      influencedCapabilities,
    };
  });
  const selectedScale = scaleDefinition;
  const committedProjects = view.facilities.projects.filter(
    (project) =>
      project.kind !== "crisis" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const willQueue = majorProjectWillQueue(view);
  return (
    <ModalFocusBoundary onOpen={() => runtime.pause()} onEscape={onClose}>
      <div className="modal-backdrop">
        <section
          className="purchase-dialog training-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="training-title"
        >
          <header className="panel-heading training-dialog-header">
            <div>
              <p className="eyebrow">TRAINING CONTROL</p>
              <h2 id="training-title">Authorise a new model generation</h2>
            </div>
            <button type="button" className="secondary" onClick={onClose}>
              Close
            </button>
          </header>
          <section className="training-dialog-overview" aria-label="Live run estimate">
            <span className="training-overview-kicker">LIVE CONFIGURATION</span>
            <div className="training-overview-copy">
              <p className="dialog-intro">
                {view.models.cards.length === 0
                  ? `Train the lab's first ${view.identity.aiName} model. More training FLOP usually yields a stronger model.`
                  : "More training FLOP usually yields a stronger model."}
              </p>
              <MechanicHelp label="Training commitment">
                Training reserves its GPUs until completion. Finished models need a
                managed launch to earn revenue.
              </MechanicHelp>
            </div>
          </section>
          {successorContinuity === undefined ? null : (
            <section
              className="training-parent-card successor-continuity-notice"
              aria-label="Retirement continuity grant"
              role="status"
            >
              <span>RETIREMENT CONTINUITY</span>
              <strong>
                {successorContinuity.status === "consumed"
                  ? "ONE-TIME GRANT CONSUMED"
                  : quote?.successorEfficiencyApplied === true
                    ? `${String(successorContinuity.ratePercent)}% GRANT APPLIED TO THIS QUOTE`
                    : `${String(successorContinuity.ratePercent)}% GRANT HELD`}
              </strong>
              <small>
                {successorContinuity.status === "consumed"
                  ? "The one-use retirement benefit has already been spent on a Product or Frontier run. It cannot stack or be applied again."
                  : quote?.successorEfficiencyApplied === true
                    ? `Retained research reduces this run from ${String(quote.unassistedDurationWeeks)} to ${String(quote.durationWeeks)} weeks and lowers its cash cost. Authorising the run consumes the grant.`
                    : derivedBand === "prototype"
                      ? "Prototype runs preserve this benefit. The next Product or Frontier run receives the schedule and cash reduction."
                      : "This benefit remains available for the next eligible Product or Frontier run and is consumed when that run starts."}
              </small>
            </section>
          )}
          <div className="training-form">
            <details
              className="training-science-baseline"
              aria-labelledby="training-science-title"
            >
              <summary>
                <div>
                  <span>INHERITED RESEARCH</span>
                  <strong id="training-science-title">Scientific baseline</strong>
                  <small>
                    {capabilityScience
                      .slice()
                      .sort((left, right) => right.level - left.level)
                      .slice(0, 3)
                      .map(
                        (programme) =>
                          `${programme.shortName} L${String(programme.level)}`,
                      )
                      .join(" · ")}
                  </small>
                </div>
                <b>
                  {capabilityScience.length + view.research.safetyPrograms.length}{" "}
                  programmes · inspect levels
                </b>
              </summary>
              <div className="training-science-details">
                <p>
                  Research levels persist across runs and set the scientific baseline
                  inherited by every new model. Training does not spend or reset them.
                </p>
                <div className="training-science-grid">
                  {capabilityScience.map((programme) => (
                    <article
                      key={programme.programId}
                      style={{ borderLeftColor: programme.colour }}
                    >
                      <span>{programme.shortName}</span>
                      <strong>Level {String(programme.level)}</strong>
                      <small>
                        {programme.influencedCapabilities.length === 0
                          ? "Training systems · scaling breakthroughs"
                          : programme.influencedCapabilities.join(" · ")}
                      </small>
                    </article>
                  ))}
                </div>
                <div className="training-safety-baseline">
                  <strong>Safety science also carries into the finished model</strong>
                  <div>
                    {view.research.safetyPrograms.map((programme) => (
                      <span
                        key={programme.programId}
                        style={{ borderLeftColor: programme.colour }}
                      >
                        <b>{safetyResearchRole(programme.programId)}</b>
                        {programme.name} · level {String(programme.level)}
                      </span>
                    ))}
                  </div>
                  <small>
                    Alignment changes future weights. Interpretability improves evidence.
                    Security strengthens containment.
                  </small>
                </div>
              </div>
            </details>
            <section
              className="training-run-builder"
              aria-labelledby="training-run-builder-title"
            >
              <header>
                <div>
                  <span>RUN CONFIGURATOR</span>
                  <strong id="training-run-builder-title">
                    Choose duration, compute and posture
                  </strong>
                </div>
                <div className="training-heading-tools">
                  <b>3 CHOICES</b>
                  <MechanicHelp label="Checkpoint and stretch risk">
                    A failed checkpoint can add time, cash cost, or capability damage; the
                    final checkpoint can lose the run. Difficulty rises by +
                    {view.models.trainingRiskContext.stretchDifficultyPerDoubling} per
                    doubling of compute beyond your best completed run and +
                    {view.models.trainingRiskContext.durationDifficultyPerDoubling} per
                    doubling past {view.models.trainingRiskContext.referenceWeeks} weeks.
                    Completing runs makes later scaling less of a stretch.
                  </MechanicHelp>
                </div>
              </header>
              <p className="training-run-builder-intro">
                More time and compute increase capability. Extreme runs fail more often.
              </p>
              <div className="training-run-primary-choices">
                <fieldset className="training-choice training-duration-choice">
                  <legend>
                    <span>1</span> Duration
                  </legend>
                  <label className="training-duration-field">
                    <span>Train for</span>
                    <select
                      value={durationWeeks}
                      onChange={(event) => {
                        setDurationWeeks(Number(event.target.value));
                      }}
                    >
                      {Array.from(
                        { length: Math.floor(TRAINING_MAX_WEEKS / 4) },
                        (_, index) => (index + 1) * 4,
                      )
                        .filter(
                          (weeks) =>
                            weeks >= TRAINING_MIN_WEEKS && weeks <= TRAINING_MAX_WEEKS,
                        )
                        .map((weeks) => (
                          <option key={weeks} value={weeks}>
                            {weeks / 4 === 1 ? "1 month" : `${String(weeks / 4)} months`}{" "}
                            ({weeks} weeks)
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="training-compact-help">
                    <span>Longer runs use more training FLOP.</span>
                    <MechanicHelp label="Training duration">
                      Total training FLOP is compute multiplied by time. Longer runs can
                      produce stronger models but reserve the GPUs for longer.
                    </MechanicHelp>
                  </div>
                </fieldset>
                <fieldset className="training-choice training-flops-commitment">
                  <legend>
                    <span>2</span> Training compute (FLOP/s)
                  </legend>
                  <div className="training-compute-hero">
                    <span>COMMITTED TO THIS RUN</span>
                    <strong>{formatTeraflops(committedTeraflops)}</strong>
                    <b>effective training throughput</b>
                  </div>
                  <input
                    type="range"
                    aria-label="Sustained training compute commitment"
                    min={sliderMinTeraflops}
                    max={maxTeraflops}
                    step={0.001}
                    value={committedTeraflops}
                    onInput={(event) => {
                      setSelectedTeraflops(Number(event.currentTarget.value));
                    }}
                  />
                  <div className="training-flops-scale" aria-hidden="true">
                    <span>MINIMUM RUN · {formatTeraflops(floorTeraflops)}</span>
                    <span>MAX AVAILABLE · {formatTeraflops(maxTeraflops)}</span>
                  </div>
                  <div className="training-flops-readout">
                    <strong>
                      {quote === undefined
                        ? "Total FLOP unavailable"
                        : `~${formatTotalFlop(quote.estimatedTotalFlop)} total`}
                    </strong>
                    <span>
                      {Math.round(
                        view.compute.unreservedTeraflops > 0
                          ? (committedTeraflops / view.compute.unreservedTeraflops) * 100
                          : 0,
                      )}
                      % of effective unreserved compute
                      {quote === undefined
                        ? ""
                        : ` · ${quote.reservedPhysicalGpus.toLocaleString("en-US")} physical GPUs reserved`}
                    </span>
                  </div>
                  <div className="training-compact-help">
                    <span>Reserved GPUs cannot serve users or conduct research.</span>
                    <MechanicHelp label="Training compute and GPU reservations">
                      The slider uses currently free effective compute. The required
                      physical GPUs remain reserved until training ends.
                    </MechanicHelp>
                  </div>
                </fieldset>
              </div>
              <fieldset className="training-choice training-choice-cards training-posture-choice">
                <legend>
                  <span>3</span> Training posture
                </legend>
                <div className="training-option-grid">
                  {(["conservative", "normal", "yolo"] as const).map((option) => {
                    const definition = trainingPostureDefinition(option);
                    const summary = trainingPostureSummary(option);
                    return (
                      <label
                        className={`training-option-card ${
                          posture === option ? "selected" : ""
                        }`}
                        key={option}
                      >
                        <input
                          type="radio"
                          name="training-posture"
                          value={option}
                          checked={posture === option}
                          onChange={(event) =>
                            setPosture(
                              event.target.value as StartTrainingRunCommand["posture"],
                            )
                          }
                        />
                        <span>
                          <strong>{definition.displayName}</strong>
                          <small>{summary.headline}</small>
                          <span className="training-posture-effects">
                            {summary.effects.map((effect) => (
                              <b key={effect}>{effect}</b>
                            ))}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="training-compact-help">
                  <span>Posture trades capability against reliability and safety.</span>
                  <MechanicHelp label="Training posture">
                    {selectedPosture.displayName}: {selectedPostureSummary.detail} A
                    completed run is not evidence that the model is safe.
                  </MechanicHelp>
                </div>
              </fieldset>
              <p className="training-run-class" aria-live="polite">
                <span>RUN CLASS</span>
                <strong>{selectedScale?.displayName ?? "—"}</strong>
                <small>{scaleExplanation(derivedBand)}</small>
              </p>
              <section
                className="training-safety-forecast"
                aria-label="Projected intrinsic model safety"
                aria-live="polite"
              >
                <header>
                  <div>
                    <span>INTRINSIC SAFETY FORECAST</span>
                    <strong>PROJECTION · NOT EVALUATED</strong>
                  </div>
                  <MechanicHelp label="How this projection works">
                    Uses current alignment and evaluation research, safety culture,
                    projected capability and posture. The range includes training
                    uncertainty; evaluations provide evidence.
                  </MechanicHelp>
                </header>
                <dl>
                  <div>
                    <dt>
                      Alignment <small>higher is safer</small>
                    </dt>
                    <dd>
                      {quote === undefined
                        ? "—"
                        : formatIntrinsicSafetyRange(
                            quote.intrinsicSafetyForecast.alignment,
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      Corrigibility <small>higher is safer</small>
                    </dt>
                    <dd>
                      {quote === undefined
                        ? "—"
                        : formatIntrinsicSafetyRange(
                            quote.intrinsicSafetyForecast.corrigibility,
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      Deceptive intent <small>lower is safer</small>
                    </dt>
                    <dd>
                      {quote === undefined
                        ? "—"
                        : formatIntrinsicSafetyRange(
                            quote.intrinsicSafetyForecast.deceptiveIntent,
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      Awareness <small>raises exposure</small>
                    </dt>
                    <dd>
                      {quote === undefined
                        ? "—"
                        : formatIntrinsicSafetyRange(
                            quote.intrinsicSafetyForecast.situationalAwareness,
                          )}
                    </dd>
                  </div>
                </dl>
                <p>
                  {quote === undefined
                    ? "Configure a valid run to see the research-based projection."
                    : `Based on current research: Alignment & Control L${String(
                        quote.intrinsicSafetyForecast.basis.alignmentResearchLevel,
                      )} · Interpretability & Evals L${String(
                        quote.intrinsicSafetyForecast.basis.interpretabilityResearchLevel,
                      )} · Safety culture ${String(
                        quote.intrinsicSafetyForecast.basis.safetyCulture,
                      )} · ${quote.intrinsicSafetyForecast.basis.postureDisplayName}`}
                </p>
              </section>
            </section>
            {quote === undefined ? null : (
              <section
                className="training-reliability-forecast"
                aria-labelledby="training-reliability-title"
              >
                <header>
                  <div>
                    <span>03 / RUN RELIABILITY</span>
                    <strong id="training-reliability-title">
                      What this run is likely to do
                    </strong>
                  </div>
                  <MechanicHelp label="Training reliability">
                    Each checkpoint has a{" "}
                    {reliabilityPercent(quote.reliability.passProbability)} pass chance.
                    The forecast assumes the GPUs stay reserved.
                  </MechanicHelp>
                </header>
                <div className="training-reliability-bar" role="presentation">
                  <i
                    className="clean"
                    style={{ width: `${String(quote.reliability.cleanRun * 100)}%` }}
                  />
                  <i
                    className="setback"
                    style={{ width: `${String(quote.reliability.setback * 100)}%` }}
                  />
                  <i
                    className="lost"
                    style={{ width: `${String(quote.reliability.totalLoss * 100)}%` }}
                  />
                </div>
                <dl className="training-reliability-outcomes">
                  <div>
                    <dt>Finishes cleanly</dt>
                    <dd>{reliabilityPercent(quote.reliability.cleanRun)}</dd>
                  </div>
                  <div>
                    <dt>Delay or capability hit</dt>
                    <dd>{reliabilityPercent(quote.reliability.setback)}</dd>
                  </div>
                  <div className={quote.reliability.totalLoss >= 0.05 ? "danger" : ""}>
                    <dt>Run lost entirely</dt>
                    <dd>{reliabilityPercent(quote.reliability.totalLoss)}</dd>
                  </div>
                </dl>
              </section>
            )}
            {quote === undefined ? null : (
              <section
                className="training-capability-forecast"
                aria-labelledby="training-capability-forecast-title"
              >
                <header>
                  <div>
                    <span>04 / PROJECTED MODEL OUTCOME</span>
                    <strong id="training-capability-forecast-title">
                      Estimated capability range
                    </strong>
                  </div>
                  <div className="training-heading-tools">
                    <b>PLANNING ESTIMATE</b>
                    <MechanicHelp label="Capability forecast">
                      This range uses the selected compute and current capability
                      research. Training variance and checkpoint damage create
                      uncertainty.
                    </MechanicHelp>
                  </div>
                </header>
                <div className="training-capability-forecast-readout">
                  <div>
                    <span>FRONTIER CAPABILITY</span>
                    <strong>
                      {formatCapabilityEstimate(
                        quote.estimatedFrontierCapabilityRange[0],
                      )}
                      –
                      {formatCapabilityEstimate(
                        quote.estimatedFrontierCapabilityRange[1],
                      )}
                    </strong>
                    <small>
                      Central estimate{" "}
                      {formatCapabilityEstimate(quote.estimatedFrontierCapability)}
                    </small>
                  </div>
                  {quote.currentModelComparison === undefined ? (
                    <div className="first-model">
                      <span>CURRENT MODEL</span>
                      <strong>No comparison yet</strong>
                      <small>This would be the lab&apos;s first trained model.</small>
                    </div>
                  ) : (
                    <div
                      className={`comparison ${
                        capabilityForecastComparison(
                          quote.estimatedFrontierCapabilityRange,
                          quote.currentModelComparison.measuredFrontierCapability,
                        ).tone
                      }`}
                    >
                      <span>CURRENT MODEL</span>
                      <strong>
                        {quote.currentModelComparison.displayName} ·{" "}
                        {formatCapabilityEstimate(
                          quote.currentModelComparison.measuredFrontierCapability,
                        )}
                      </strong>
                      <small>
                        {
                          capabilityForecastComparison(
                            quote.estimatedFrontierCapabilityRange,
                            quote.currentModelComparison.measuredFrontierCapability,
                          ).text
                        }
                      </small>
                    </div>
                  )}
                </div>
                <div
                  className="training-capability-scale"
                  role="img"
                  aria-label={[
                    `Estimated Frontier Capability ${formatCapabilityEstimate(
                      quote.estimatedFrontierCapabilityRange[0],
                    )} to ${formatCapabilityEstimate(
                      quote.estimatedFrontierCapabilityRange[1],
                    )} out of 100.`,
                    `Tier boundaries: ${capabilityTierBoundaries
                      .map(
                        (tier) =>
                          `Tier ${String(tier.level)}, ${tier.name}, at ${String(
                            tier.nominalFrontierCapability.min,
                          )}`,
                      )
                      .join("; ")}.`,
                    `Superintelligence candidate eligibility begins at Frontier Capability ${String(
                      AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
                    )}.`,
                  ].join(" ")}
                >
                  <span>0</span>
                  <div>
                    {capabilityTierBoundaries.map((tier) => (
                      <span
                        aria-hidden="true"
                        className={`tier-boundary ${tier.level === 0 ? "first" : ""}`}
                        key={tier.id}
                        style={{
                          left: `${String(tier.nominalFrontierCapability.min)}%`,
                        }}
                        title={`Tier ${String(tier.level)} · ${tier.name} begins at capability ${String(
                          tier.nominalFrontierCapability.min,
                        )}`}
                      >
                        <b>T{tier.level}</b>
                      </span>
                    ))}
                    <span
                      aria-hidden="true"
                      className="candidate-threshold"
                      style={{
                        left: `${String(AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY)}%`,
                      }}
                      title={`Superintelligence candidate eligibility begins at Frontier Capability ${String(
                        AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
                      )}`}
                    >
                      <b>CANDIDATE · {AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY}</b>
                    </span>
                    <i
                      className="forecast-range"
                      style={{
                        left: `${quote.estimatedFrontierCapabilityRange[0]}%`,
                        width: `${Math.max(
                          1,
                          quote.estimatedFrontierCapabilityRange[1] -
                            quote.estimatedFrontierCapabilityRange[0],
                        )}%`,
                      }}
                    />
                    <i
                      className="forecast-midpoint"
                      style={{ left: `${quote.estimatedFrontierCapability}%` }}
                    />
                    {quote.currentModelComparison === undefined ? null : (
                      <i
                        className="current-marker"
                        style={{
                          left: `${quote.currentModelComparison.measuredFrontierCapability}%`,
                        }}
                      />
                    )}
                  </div>
                  <span>100</span>
                </div>
                <div className="training-capability-legend">
                  <span>
                    <i className="forecast-key" /> New-model estimate
                  </span>
                  {quote.currentModelComparison === undefined ? null : (
                    <span>
                      <i className="current-key" /> Current measured capability
                    </span>
                  )}
                  <span>
                    <i className="tier-key" /> T0–T8 tier boundaries
                  </span>
                  <span>
                    <i className="candidate-key" /> Candidate eligibility threshold
                  </span>
                </div>
                <section
                  className="training-candidate-gate"
                  aria-labelledby="training-candidate-gate-title"
                >
                  <header>
                    <div>
                      <span>SUPERINTELLIGENCE CANDIDATE GATE</span>
                      <strong id="training-candidate-gate-title">
                        What this run must clear
                      </strong>
                    </div>
                    <small>
                      These capability thresholds and all four works are the complete
                      candidacy requirements.
                    </small>
                  </header>
                  {view.models.candidateProgramme.declarationCooldown ===
                  undefined ? null : (
                    <div className="training-candidate-cooldown" role="status">
                      <strong>
                        CANDIDATE DECLARATIONS PAUSED ·{" "}
                        {
                          view.models.candidateProgramme.declarationCooldown
                            .remainingWeeks
                        }
                        W
                      </strong>
                      <span>
                        You may train and evaluate now. Any qualifying model waits until
                        week{" "}
                        {view.models.candidateProgramme.declarationCooldown.untilTick} to
                        be nominated.
                      </span>
                    </div>
                  )}
                  <div className="training-candidate-gate-grid">
                    <article className={candidateFrontierForecast?.tone}>
                      <span>FRONTIER CAPABILITY</span>
                      <strong>
                        {AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY}+ required
                      </strong>
                      <small>{candidateFrontierForecast?.label}</small>
                    </article>
                    <article className="pending">
                      <span>CAPABILITY BREADTH</span>
                      <strong>
                        All 7 traits {AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE}+
                      </strong>
                      <small>Confirmed after training; FC alone is not enough.</small>
                    </article>
                    <article
                      className={
                        view.models.candidateProgramme.componentsComplete
                          ? "met"
                          : "pending"
                      }
                    >
                      <span>CANDIDATE PROGRAMME</span>
                      <strong>
                        {completedCandidateComponents}/
                        {view.models.candidateProgramme.components.length} works complete
                      </strong>
                      <small>Complete all four works before declaration.</small>
                    </article>
                  </div>
                </section>
              </section>
            )}
          </div>
          <section
            className={`training-operational-summary ${willQueue ? "queued" : ""}`}
            aria-label="Operational commitment"
          >
            <header>
              <span>OPERATIONAL CHECK</span>
              <strong>What authorisation commits</strong>
            </header>
            <dl>
              <div>
                <dt>Project slot</dt>
                <dd>{willQueue ? "Joins the queue" : "Starts immediately"}</dd>
                <small>
                  {view.facilities.capacity.occupiedMajorProjectSlots}/
                  {view.facilities.capacity.majorProjectSlots} slots currently in use
                </small>
              </div>
              {quote === undefined ? null : (
                <>
                  <div>
                    <dt>Reserved hardware</dt>
                    <dd>
                      {Object.entries(quote.reservationGenerationCounts)
                        .map(
                          ([id, count]) =>
                            `${count.toLocaleString("en-US")} ${content.gpuGenerations[id]?.displayName ?? id}`,
                        )
                        .join(", ") ||
                        `${quote.reservedPhysicalGpus.toLocaleString("en-US")} GPUs`}
                    </dd>
                    <small>Unavailable to research and serving during training</small>
                  </div>
                  <div>
                    <dt>Fleet impact</dt>
                    <dd>
                      {Math.round(
                        view.compute.unreservedTeraflops > 0
                          ? (quote.committedTeraflops /
                              view.compute.unreservedTeraflops) *
                              100
                          : 0,
                      )}
                      % reserved
                    </dd>
                    <small>For {quote.durationWeeks} weeks</small>
                  </div>
                </>
              )}
            </dl>
            {committedProjects.length === 0 ? null : (
              <details>
                <summary>Inspect current major projects</summary>
                <ul>
                  {committedProjects.map((project) => (
                    <li key={project.projectId}>
                      <strong>{project.displayName}</strong> — {project.status};{" "}
                      {project.progressLabel.toLowerCase()}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <footer
            className={`training-dialog-actions ${
              failureCooldownError === undefined ? "" : "training-cooldown-active"
            }`}
          >
            <div>
              <span>
                {failureCooldownError !== undefined
                  ? "TRAINING LOCKED"
                  : !validation.ok
                    ? "CHECK REQUIRED"
                    : willQueue
                      ? "QUEUED AUTHORISATION"
                      : "READY TO AUTHORISE"}
              </span>
              {failureCooldownError !== undefined ? (
                <p className="training-cooldown-message" role="alert">
                  <strong>Post-failure investigation in progress</strong>
                  <span>{failureCooldownError.message}</span>
                  {otherValidationErrors.length === 0 ? null : (
                    <small>
                      Also blocked:{" "}
                      {otherValidationErrors.map((error) => error.message).join(" · ")}
                    </small>
                  )}
                </p>
              ) : !validation.ok ? (
                <p className="validation-error">
                  {validation.errors.map((error) => error.message).join(" · ")}
                </p>
              ) : willQueue ? (
                <p className="consequence-line">
                  All slots are occupied. This run will join the waiting queue and start
                  automatically when it reaches the front and a slot is free.
                </p>
              ) : (
                <p className="consequence-line">{validation.preview.summary}</p>
              )}
            </div>
            <button
              className="primary"
              type="button"
              data-tutorial-target="authorise-training"
              disabled={!validation.ok}
              onClick={() => {
                runtime.dispatch(command);
                onStarted();
              }}
            >
              {majorProjectActionLabel(
                view,
                "Start training run",
                "Add training run to queue",
              )}
            </button>
          </footer>
        </section>
      </div>
    </ModalFocusBoundary>
  );
}

export function ModelsWorkspace({
  content,
  onOpenAnomaly,
  onOpenEvaluations,
  onOpenModels,
  onWorkspaceChange,
  requestedEvaluationWorkspace,
  requestedModelId,
  requestedWorkspace,
  runtime,
  view,
  workspaceMode = "models",
}: {
  readonly content: BrowserContent;
  readonly onOpenAnomaly: (anomalyId: string) => void;
  readonly onOpenEvaluations?: (request?: {
    readonly modelId: string;
    readonly workspace: EvaluationWorkspaceTab;
    readonly anchor?: EvaluationWorkspaceAnchor;
  }) => void;
  readonly onOpenModels?: () => void;
  readonly onWorkspaceChange?: (workspace: ModelWorkspaceTab) => void;
  readonly requestedEvaluationWorkspace?: EvaluationWorkspaceTab;
  readonly requestedModelId?: string;
  readonly requestedWorkspace?: ModelWorkspaceTab;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly workspaceMode?: ModelsWorkspaceMode;
}): ReactElement {
  const [selectedId, setSelectedId] = useState(
    requestedModelId ?? view.models.currentModelId ?? view.models.cards[0]?.modelId ?? "",
  );
  // Follow canonical model succession unless the player deliberately chose an
  // archived model for inspection. Without this, training can promote a new
  // current model while the training and release panels keep targeting the
  // predecessor until some later model-tab interaction updates local state.
  const followsCurrentModel = useRef(
    requestedModelId === undefined || requestedModelId === view.models.currentModelId,
  );
  useEffect(() => {
    const currentModelId = view.models.currentModelId;
    if (
      followsCurrentModel.current &&
      currentModelId !== undefined &&
      selectedId !== currentModelId
    ) {
      setSelectedId(currentModelId);
    }
  }, [selectedId, view.models.currentModelId]);
  const productisationUnlocked =
    view.meta.labMaturity?.features.includes("productisation") ?? true;
  const [evaluationCommissionOpen, setEvaluationCommissionOpen] = useState(
    requestedEvaluationWorkspace === "run",
  );
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [productisationOpen, setProductisationOpen] = useState(false);
  const [custodyNotice, setCustodyNotice] = useState<string | undefined>();
  const [nominationModelId, setNominationModelId] = useState<string | undefined>();
  const [retirementModelId, setRetirementModelId] = useState<string | undefined>();
  const [retirementProcedure, setRetirementProcedure] =
    useState<CandidateRetirementProcedureId>("staged-isolated-shutdown");
  const [retirementDisposition, setRetirementDisposition] =
    useState<CandidateRetirementDisposition>("destroy-all-weights");
  const [retirementReviewed, setRetirementReviewed] = useState(false);
  const [retirementConfirmation, setRetirementConfirmation] = useState("");
  // The evaluation start dialog: which rung is choosing its pacing, and the
  // duration currently selected in its dropdown.
  const [evaluationPacingFor, setEvaluationPacingFor] = useState<string | undefined>();
  const [evaluationPacingWeeks, setEvaluationPacingWeeks] = useState<
    number | undefined
  >();
  const [draftReleasePolicies, setDraftReleasePolicies] = useState<
    Partial<Record<string, DeploymentPolicy>>
  >({});
  const [draftProductisationModes, setDraftProductisationModes] = useState<
    Partial<Record<string, ProductisationMode>>
  >({});
  const trainingOutcome = <TrainingOutcomeReport view={view} />;
  const trainingMonitor = <TrainingProjectMonitor view={view} />;
  const inFlightTraining = view.facilities.projects.filter(
    (project) =>
      project.kind === "training" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const firstModelRun = inFlightTraining[0];
  const selected =
    view.models.cards.find((model) => model.modelId === selectedId) ??
    view.models.cards[0];
  const selectedModelIdForNavigation = selected?.modelId;
  const retirementArtifact = view.models.candidateCustody.artifacts.find(
    (artifact) => artifact.modelId === retirementModelId,
  );
  const nominationArtifact = view.models.candidateCustody.artifacts.find(
    (artifact) => artifact.modelId === nominationModelId,
  );
  const nominationModel = view.models.cards.find(
    (model) => model.modelId === nominationModelId,
  );
  const activeEvaluationProjects = view.facilities.projects.filter(
    (project) =>
      project.kind === "evaluation" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  useEffect(() => {
    if (
      workspaceMode !== "models" ||
      requestedWorkspace !== "release" ||
      !productisationUnlocked ||
      selectedModelIdForNavigation === undefined
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById("model-release-section")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    productisationUnlocked,
    requestedWorkspace,
    selectedModelIdForNavigation,
    workspaceMode,
  ]);
  useEffect(() => {
    if (requestedModelId === undefined) {
      if (workspaceMode === "evaluations" && view.models.currentModelId !== undefined) {
        followsCurrentModel.current = true;
        setSelectedId(view.models.currentModelId);
      }
      return;
    }
    followsCurrentModel.current = requestedModelId === view.models.currentModelId;
    setSelectedId(requestedModelId);
  }, [requestedModelId, view.models.currentModelId, workspaceMode]);
  useEffect(() => {
    if (requestedEvaluationWorkspace === "run") {
      setEvaluationPacingFor(undefined);
      setEvaluationPacingWeeks(undefined);
      setEvaluationCommissionOpen(true);
    }
  }, [requestedEvaluationWorkspace]);

  function scrollToModelSection(sectionId: string): void {
    window.requestAnimationFrame(() => {
      document
        .getElementById(sectionId)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function selectModel(modelId: string): void {
    followsCurrentModel.current = modelId === view.models.currentModelId;
    setSelectedId(modelId);
  }

  function inspectCustodyArtifact(modelId: string): void {
    selectModel(modelId);
    const destination = candidateCustodyEvidenceDestination("inspect");
    if (workspaceMode === "evaluations") {
      window.requestAnimationFrame(() => {
        document
          .getElementById("evaluation-workflow-panel-overview")
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    } else {
      onOpenEvaluations?.({ modelId, workspace: destination, anchor: "model" });
    }
  }

  function evaluateCustodyArtifact(modelId: string): void {
    selectModel(modelId);
    const request = modelEvidenceReviewRequest(modelId);
    if (workspaceMode === "evaluations") {
      window.requestAnimationFrame(() => {
        document
          .getElementById("model-safety-case")
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    } else {
      onOpenEvaluations?.(request);
    }
  }

  function isolateCustodyArtifact(modelId: string): void {
    const command = isolateCandidateArtifactCommand(view, modelId);
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setCustodyNotice(validation.errors.map((error) => error.message).join(" · "));
      return;
    }
    runtime.dispatch(command);
    setCustodyNotice(validation.preview.summary);
  }

  function nominateCustodyArtifact(modelId: string): void {
    // The confirmation surface, not this preliminary click, owns the explicit
    // decision to abandon any in-flight training.
    const command = nominateCandidateCommand(view, modelId, true);
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setCustodyNotice(validation.errors.map((error) => error.message).join(" · "));
      return;
    }
    setNominationModelId(modelId);
    setCustodyNotice(undefined);
  }

  function closeNominationConfirmation(): void {
    setNominationModelId(undefined);
  }

  function confirmCustodyNomination(modelId: string): void {
    const command = nominateCandidateCommand(view, modelId, inFlightTraining.length > 0);
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setCustodyNotice(validation.errors.map((error) => error.message).join(" · "));
      closeNominationConfirmation();
      return;
    }
    runtime.dispatch(command);
    setCustodyNotice(validation.preview.summary);
    closeNominationConfirmation();
  }

  function resolveCustodyIncident(modelId: string): void {
    const command = resolveCandidateIncidentCommand(view, modelId);
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setCustodyNotice(validation.errors.map((error) => error.message).join(" · "));
      return;
    }
    runtime.dispatch(command);
    setCustodyNotice(validation.preview.summary);
  }

  function openRetirementControls(modelId: string): void {
    const artifact = view.models.candidateCustody.artifacts.find(
      (candidate) => candidate.modelId === modelId,
    );
    if (
      artifact === undefined ||
      artifact.retirement === undefined ||
      !artifact.legalActions.includes("retire") ||
      artifact.lifecycle === "verified-destroyed" ||
      artifact.lifecycle === "verified-isolated-archive" ||
      artifact.lifecycle === "terminal" ||
      artifact.lifecycle === "escaped" ||
      artifact.lifecycle === "deployed"
    ) {
      setCustodyNotice("This artifact has already completed retirement custody.");
      return;
    }
    selectModel(modelId);
    setRetirementModelId(modelId);
    setRetirementProcedure("staged-isolated-shutdown");
    setRetirementDisposition("destroy-all-weights");
    setRetirementReviewed(false);
    setRetirementConfirmation("");
    setCustodyNotice(undefined);
  }

  function closeRetirementControls(): void {
    setRetirementModelId(undefined);
    setRetirementReviewed(false);
    setRetirementConfirmation("");
  }

  function closeProductisationConfiguration(modelId: string): void {
    setProductisationOpen(false);
    setDraftReleasePolicies((current) => {
      const next = { ...current };
      delete next[modelId];
      return next;
    });
    setDraftProductisationModes((current) => {
      const next = { ...current };
      delete next[modelId];
      return next;
    });
  }

  function closeEvaluationCommissioning(): void {
    setEvaluationCommissionOpen(false);
    setEvaluationPacingFor(undefined);
    setEvaluationPacingWeeks(undefined);
  }

  function returnToEvaluationPicker(): void {
    setEvaluationPacingFor(undefined);
    setEvaluationPacingWeeks(undefined);
  }

  if (selected === undefined) {
    if (workspaceMode === "evaluations") {
      return (
        <EvaluationWorkspaceIntroduction
          {...(onOpenModels === undefined ? {} : { onOpenModels })}
        />
      );
    }
    return (
      <>
        <ModelWorkspaceCommand
          hasModel={false}
          selectedLabel={`First ${view.identity.aiName} model`}
          selectedMeta="Train a model before preparing a release."
          trainingActionLabel={
            firstModelRun === undefined
              ? "Configure first training run"
              : "View training run"
          }
          trainingDetail={
            firstModelRun === undefined
              ? "Create the lab's first internal model."
              : `${firstModelRun.displayName} is ${firstModelRun.status}.`
          }
          trainingStatus={
            firstModelRun === undefined ? "READY" : firstModelRun.status.toUpperCase()
          }
          trainingTitle={`Train first ${view.identity.aiName} model`}
          onTrainingAction={() => {
            onWorkspaceChange?.("train");
            if (firstModelRun === undefined) {
              setTrainingOpen(true);
            } else {
              scrollToModelSection("model-training-section");
            }
          }}
        />
        <div className="model-unified-training" id="model-training-section">
          <section
            className="console-panel models-workspace empty-model-portfolio"
            aria-labelledby="models-title"
          >
            <header className="panel-heading">
              <div>
                <p className="eyebrow">MODEL OPERATIONS</p>
                <h2 id="models-title">
                  {firstModelRun === undefined
                    ? "No AI trained yet"
                    : firstModelRun.status === "queued"
                      ? `First ${view.identity.aiName} model is queued`
                      : `First ${view.identity.aiName} model is training`}
                </h2>
              </div>
              {firstModelRun === undefined ? null : (
                <span className={`condition-chip ${firstModelRun.status}`}>
                  ONE RUN IN FLIGHT
                </span>
              )}
            </header>
            <p>
              {firstModelRun === undefined
                ? "Authorise the lab's first training run."
                : `${firstModelRun.displayName} must finish before a model enters the portfolio.`}
            </p>
          </section>
          {trainingOutcome}
          {trainingMonitor}
        </div>
        {trainingOpen ? (
          <TrainingDialog
            content={content}
            runtime={runtime}
            view={view}
            onClose={() => setTrainingOpen(false)}
            onStarted={() => setTrainingOpen(false)}
          />
        ) : null}
      </>
    );
  }
  const releasePolicy = selected.deployment.plannedPolicy ?? selected.deployment.policy;
  const candidateTraitFloor = Math.min(...Object.values(selected.capability));
  const candidateFrontierMet =
    selected.frontierCapabilityEstimate >= AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY;
  const candidateBreadthMet = Object.values(selected.capability).every(
    (value) => value >= AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  );
  const completedCandidateWorks = view.models.candidateProgramme.components.filter(
    (component) => component.status === "complete",
  ).length;
  const candidateWorksMet = view.models.candidateProgramme.componentsComplete;
  const candidateReady = candidateFrontierMet && candidateBreadthMet && candidateWorksMet;
  const releaseDefinition = content.deployment.policies[releasePolicy];
  const releaseIsPlanned = selected.deployment.plannedPolicy !== undefined;
  const hasCompletedProductisation = Object.values(
    selected.deployment.productisationRuns,
  ).some((runs) => runs > 0);
  const selectedProductisationProject = view.facilities.projects.find(
    (project) =>
      project.kind === "productisation" &&
      project.productisation?.modelId === selected.modelId &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const productisationLifecycle = selected.deployment.irreversible
    ? "weights-released"
    : selectedProductisationProject?.status === "queued"
      ? "queued"
      : selectedProductisationProject !== undefined
        ? "in-progress"
        : hasCompletedProductisation
          ? "complete"
          : "unconfigured";
  const hasActiveProductisation =
    productisationLifecycle === "queued" || productisationLifecycle === "in-progress";
  const managedLaunch =
    releasePolicy !== "internal-only" && releasePolicy !== "weights-release";
  const launchIsLive = hasCompletedProductisation && !releaseIsPlanned && managedLaunch;
  const isBuildingLaunchPlan = productisationLifecycle === "unconfigured";
  const canOpenProductisation =
    productisationUnlocked && (isBuildingLaunchPlan || hasActiveProductisation);
  const productisationActionLabel =
    productisationLifecycle === "unconfigured"
      ? "Configure launch"
      : productisationLifecycle === "queued"
        ? "Review queued launch"
        : productisationLifecycle === "in-progress"
          ? "Review launch preparation"
          : productisationLifecycle === "weights-released"
            ? "Weights released"
            : "Launch preparation complete";
  const draftReleasePolicy = draftReleasePolicies[selected.modelId];
  const draftProductisationMode = draftProductisationModes[selected.modelId];
  const previewReleasePolicy = draftReleasePolicy ?? releasePolicy;
  const previewReleaseDefinition = content.deployment.policies[previewReleasePolicy];
  const draftProductisationValidation =
    draftProductisationMode === undefined
      ? undefined
      : runtime.validate(
          productisationCommand(view, selected.modelId, draftProductisationMode),
        );
  const draftReleaseValidation =
    draftReleasePolicy === undefined || draftReleasePolicy === releasePolicy
      ? undefined
      : runtime.validate(deploymentCommand(view, selected.modelId, draftReleasePolicy));
  const launchPlanReady =
    isBuildingLaunchPlan &&
    draftReleasePolicy !== undefined &&
    draftProductisationMode !== undefined &&
    (draftReleaseValidation?.ok ?? true) &&
    (draftProductisationValidation?.ok ?? false);
  const launchPlanBlockers = [
    ...(draftReleaseValidation?.ok === false
      ? draftReleaseValidation.errors.map((error) => error.message)
      : []),
    ...(draftProductisationValidation?.ok === false
      ? draftProductisationValidation.errors.map((error) => error.message)
      : []),
  ];
  const openingRequiresManagedLaunch = view.meta.labMaturity?.stage === "product";
  const availableDeploymentPolicies = openingRequiresManagedLaunch
    ? DEPLOYMENT_POLICY_ORDER.filter(
        (policy): policy is "guarded-api" | "open-api" =>
          policy === "guarded-api" || policy === "open-api",
      )
    : DEPLOYMENT_POLICY_ORDER;
  const renderDeploymentPolicy = (policyId: DeploymentPolicy): ReactElement => {
    const policy = content.deployment.policies[policyId];
    const isCurrent = policy.policy === releasePolicy;
    const isDraftSelected = isBuildingLaunchPlan && policy.policy === draftReleasePolicy;
    const isSelected = isBuildingLaunchPlan ? isDraftSelected : isCurrent;
    const command = deploymentCommand(view, selected.modelId, policy.policy);
    const validation = runtime.validate(command);
    const canChoosePolicy = launchPolicyChoiceIsAvailable({
      currentPolicy: isCurrent,
      errorCodes: validation.ok ? [] : validation.errors.map((error) => error.code),
      planIsEditable: isBuildingLaunchPlan,
      validationOk: validation.ok,
    });
    const managed =
      policy.policy !== "internal-only" && policy.policy !== "weights-release";
    const exposure = Math.round(policy.exposure * 100);
    const auraPreview = selected.deployment.auraPreviewByPolicy[policy.policy];
    return (
      <article
        key={policy.policy}
        className={`${isSelected ? "selected" : ""} ${
          policy.irreversible ? "critical" : ""
        }`}
      >
        <div className="deployment-policy-card-heading">
          <div>
            <h4>{policy.displayName}</h4>
            <small>
              {isDraftSelected
                ? "CHOSEN FOR THIS PLAN"
                : isCurrent
                  ? releaseIsPlanned
                    ? "CURRENT PLANNED ACCESS"
                    : "CURRENT ACCESS"
                  : policy.irreversible && isBuildingLaunchPlan
                    ? "IRREVERSIBLE LAUNCH OPTION"
                    : policy.irreversible
                      ? "PERMANENT ACCESS"
                      : "AVAILABLE PLAN"}
            </small>
          </div>
          <strong>Access risk {exposure}/100</strong>
        </div>
        <p>{deploymentPolicyPurpose(policy.policy)}</p>
        <dl>
          <div>
            <dt>Customer demand</dt>
            <dd>{managed ? `×${policy.marketDemandMultiplier.toFixed(2)}` : "None"}</dd>
          </div>
          <div>
            <dt>Revenue rate</dt>
            <dd>{managed ? `×${policy.revenueMultiplier.toFixed(2)}` : "None"}</dd>
          </div>
          <div>
            <dt>Access risk</dt>
            <dd>{exposure <= 10 ? "Low" : exposure <= 45 ? "Moderate" : "High"}</dd>
          </div>
          <div>
            <dt>Aura award</dt>
            <dd>{deploymentAuraImpact(auraPreview, policy.policy)}</dd>
          </div>
        </dl>
        <small className="deployment-policy-timing">
          {isBuildingLaunchPlan
            ? isDraftSelected
              ? policy.irreversible
                ? "Draft choice only. If the complete plan is authorised, the weights become permanently downloadable when preparation finishes."
                : "Draft choice only. Nothing begins until the complete plan is authorised below."
              : policy.irreversible
                ? "Choose this as Step 1 only if you intend a permanent weights release. It will not happen by itself."
                : "Choose this as Step 1; it will not take effect by itself."
            : policy.irreversible
              ? "The weights are permanently downloadable and this cannot be reversed."
              : isSelected && !releaseIsPlanned
                ? hasCompletedProductisation
                  ? "This is the model's live access policy now."
                  : "Active internally now and remains in place after productisation."
                : hasCompletedProductisation
                  ? "Changes the live model's access policy immediately."
                  : "Activates automatically when productisation finishes."}
        </small>
        <button
          className={policy.irreversible ? "secondary danger" : "secondary"}
          type="button"
          data-tutorial-target={
            policy.policy === "guarded-api" ? "deployment-guarded-api" : undefined
          }
          disabled={isDraftSelected || !canChoosePolicy}
          title={
            isDraftSelected
              ? "This is Step 1 of the draft launch plan."
              : !isBuildingLaunchPlan && isSelected
                ? "This is the selected release policy."
                : canChoosePolicy && isCurrent
                  ? "Keep the current access policy after release preparation."
                  : validation.ok
                    ? validation.preview.summary
                    : validation.errors.map((error) => error.message).join(" · ")
          }
          onClick={() => {
            if (isBuildingLaunchPlan) {
              setDraftReleasePolicies((current) => ({
                ...current,
                [selected.modelId]: policy.policy,
              }));
            }
          }}
        >
          {isDraftSelected
            ? "Chosen for Step 1"
            : !isBuildingLaunchPlan && isSelected
              ? "Selected"
              : !isBuildingLaunchPlan
                ? "Locked with authorised plan"
                : policy.irreversible
                  ? "Choose permanent release"
                  : isCurrent && policy.policy === "internal-only"
                    ? "Keep internal"
                    : "Choose this plan"}
        </button>
      </article>
    );
  };
  const lifecycleSummary = selected.deployment.irreversible
    ? "This model's weights have been released permanently. It cannot create managed API demand or serving revenue."
    : selected.isCommercialModel
      ? "The model is launched. Allocate GPUs to customer serving on GPUs & compute to turn demand into revenue."
      : hasActiveProductisation
        ? `${selected.displayName} is being prepared for release. ${releaseDefinition.displayName} will activate automatically when the programme finishes.`
        : hasCompletedProductisation
          ? "Release engineering is complete. Choose a managed access policy below to launch to customers, or keep the model internal."
          : `Next: choose who gets access and how carefully to prepare ${selected.displayName}, then authorise one release programme.`;
  const releaseCommandStatus = selected.deployment.irreversible
    ? "WEIGHTS RELEASED"
    : launchIsLive
      ? "LIVE"
      : productisationLifecycle === "queued"
        ? "QUEUED"
        : productisationLifecycle === "in-progress"
          ? "PREPARING"
          : hasCompletedProductisation
            ? "READY"
            : "ACTION REQUIRED";
  const releaseCommandDetail = selected.deployment.irreversible
    ? "This model's weights are permanently public."
    : launchIsLive
      ? `${releaseDefinition.displayName} is live.`
      : productisationLifecycle === "queued"
        ? "The release programme is waiting for a project slot."
        : productisationLifecycle === "in-progress"
          ? "Release preparation is in progress."
          : hasCompletedProductisation
            ? "Release preparation is complete."
            : `${selected.displayName} remains internal with no launch plan.`;
  const releaseCommandActionLabel = canOpenProductisation
    ? productisationLifecycle === "unconfigured"
      ? "Configure launch"
      : productisationActionLabel
    : "View launch status";
  return (
    <>
      {workspaceMode === "evaluations" ? (
        <>
          <EvaluationWorkspaceCommand
            activeProjectCount={activeEvaluationProjects.length}
            modelName={selected.displayName}
            modelSummary={`Tier ${String(selected.tier.level)} · capability ${formatCapabilityScore(selected.frontierCapabilityEstimate)}`}
            safetyCaseScore={selected.safetyCase.score}
            warningCount={selected.safetyCase.warningSignalsOpen}
            onRunEvaluations={() => {
              setEvaluationPacingFor(undefined);
              setEvaluationPacingWeeks(undefined);
              setEvaluationCommissionOpen(true);
            }}
          />
          <section
            className="console-panel evaluation-model-selector"
            aria-labelledby="evaluation-model-selector-title"
          >
            <div>
              <p className="eyebrow">EVIDENCE TARGET</p>
              <strong id="evaluation-model-selector-title">{selected.displayName}</strong>
              <small>
                Select another model to inspect its evidence without leaving this view.
              </small>
            </div>
            <div className="model-tabs" role="tablist" aria-label="Model portfolio">
              {view.models.cards.map((model) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={model.modelId === selected.modelId}
                  key={model.modelId}
                  onClick={() => selectModel(model.modelId)}
                >
                  <strong>{model.displayName}</strong>
                  <small>
                    Gen {model.generationIndex} · Tier {model.tier.level}{" "}
                    {model.isCurrentModel
                      ? "· CURRENT"
                      : model.promotionStatus === "underperformed"
                        ? "· UNDERPERFORMED"
                        : "· ARCHIVED"}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}
      {workspaceMode === "models" ? (
        <ModelWorkspaceCommand
          hasModel
          {...(onOpenEvaluations === undefined
            ? {}
            : {
                onOpenDossier: () =>
                  onOpenEvaluations({
                    modelId: selected.modelId,
                    workspace: "overview",
                    anchor: "model",
                  }),
              })}
          selectedLabel={selected.displayName}
          selectedMeta={`Generation ${String(selected.generationIndex)} · Tier ${String(
            selected.tier.level,
          )} ${selected.tier.name} · ${
            selected.isCurrentModel
              ? "current internal AI"
              : selected.promotionStatus === "underperformed"
                ? "underperforming alternative"
                : "archived alternative"
          }`}
          trainingActionLabel={
            firstModelRun === undefined ? "Configure training" : "View active run"
          }
          trainingDetail={
            firstModelRun === undefined
              ? `Train a successor while keeping ${selected.displayName}.`
              : `${firstModelRun.displayName} is ${firstModelRun.status}.`
          }
          trainingStatus={
            firstModelRun === undefined ? "READY" : firstModelRun.status.toUpperCase()
          }
          trainingTitle="Train next model"
          {...(productisationUnlocked
            ? {
                releaseActionLabel: releaseCommandActionLabel,
                releaseDetail: releaseCommandDetail,
                releaseStatus: releaseCommandStatus,
                releaseTitle: "Prepare & launch current model",
                onReleaseAction: () => {
                  onWorkspaceChange?.("release");
                  if (canOpenProductisation) {
                    setProductisationOpen(true);
                  } else {
                    scrollToModelSection("model-release-section");
                  }
                },
              }
            : {})}
          onTrainingAction={() => {
            onWorkspaceChange?.("train");
            if (firstModelRun === undefined) {
              setTrainingOpen(true);
            } else {
              scrollToModelSection("model-training-section");
            }
          }}
        />
      ) : null}
      <CandidateCustodyPanel
        {...(workspaceMode === "models" ? { className: "model-mode-custody" } : {})}
        custody={view.models.candidateCustody}
        {...(view.models.candidateProgramme.declarationCooldown === undefined
          ? {}
          : {
              declarationCooldown: view.models.candidateProgramme.declarationCooldown,
            })}
        formalProgrammeReady={view.models.candidateProgramme.componentsComplete}
        onEvaluate={evaluateCustodyArtifact}
        onIsolate={isolateCustodyArtifact}
        onInspect={inspectCustodyArtifact}
        onNominate={nominateCustodyArtifact}
        onResolveIncident={resolveCustodyIncident}
        onRetire={openRetirementControls}
        selectedModelId={selected.modelId}
      />
      {nominationArtifact === undefined || nominationModel === undefined ? null : (
        <ModalFocusBoundary
          onOpen={() => runtime.pause()}
          onEscape={closeNominationConfirmation}
        >
          <div className="critical-access-backdrop endgame-command-backdrop command-nominate">
            <section
              className="critical-access-dialog endgame-manual-command"
              role="dialog"
              aria-modal="true"
              aria-labelledby="endgame-command-title"
            >
              <CandidateNominationConfirmationContent
                accessLevel={nominationArtifact.currentAccess}
                artifact={nominationArtifact}
                currentTick={view.meta.tick}
                displayName={nominationArtifact.displayName}
                inFlightTraining={inFlightTraining}
                {...(view.endgame.active ? { endgame: view.endgame } : {})}
                {...(nominationArtifact.currentFrontierCapability === undefined
                  ? {}
                  : {
                      measuredFrontierCapability:
                        nominationArtifact.currentFrontierCapability,
                    })}
                trainedAtTick={nominationModel.trainedAtTick}
                onCancel={closeNominationConfirmation}
                onConfirm={() => confirmCustodyNomination(nominationArtifact.modelId)}
              />
            </section>
          </div>
        </ModalFocusBoundary>
      )}
      {custodyNotice === undefined ? null : (
        <p
          className={`candidate-custody-notice${workspaceMode === "models" ? " model-mode-custody-notice" : ""}`}
          role="status"
        >
          {custodyNotice}
        </p>
      )}
      <section
        className="console-panel model-lifecycle-guide"
        id="model-release-section"
        aria-labelledby="model-lifecycle-title"
        hidden={!productisationUnlocked || workspaceMode !== "models"}
      >
        <header>
          <div>
            <p className="eyebrow">
              {selected.isCurrentModel ? "CURRENT MODEL" : "SELECTED MODEL"} // GUIDED
              RELEASE
            </p>
            <h2 id="model-lifecycle-title">{selected.displayName} launch path</h2>
          </div>
        </header>
        <p className="model-lifecycle-summary">{lifecycleSummary}</p>
        <dl className="release-readiness-strip">
          <div>
            <dt>Product quality</dt>
            <dd>{selected.productQuality.toFixed(0)} / 100</dd>
            <small>Customer appeal and launch readiness</small>
          </div>
          <div>
            <dt>Reliability</dt>
            <dd>{selected.reliability.toFixed(0)} / 100</dd>
            <small>Service stability under sustained use</small>
          </div>
          <div>
            <dt>Access plan</dt>
            <dd>{releaseDefinition.displayName}</dd>
            <small>{releaseIsPlanned ? "Planned policy" : "Current model policy"}</small>
          </div>
          <div>
            <dt>Access risk</dt>
            <dd>{Math.round(selected.deployment.exposure * 100)} / 100</dd>
            <small>Operational exposure from this policy</small>
          </div>
        </dl>
        <ol>
          <li className="complete">
            <span>1</span>
            <div>
              <b>Train</b>
              <small>Creates an internal model. Complete.</small>
            </div>
          </li>
          <li className={hasCompletedProductisation ? "complete" : "current"}>
            <span>2</span>
            <div>
              <b>Prepare release</b>
              <small>
                {hasCompletedProductisation
                  ? "Release engineering complete."
                  : hasActiveProductisation
                    ? "Programme in progress."
                    : "Choose access and engineering below."}
              </small>
            </div>
          </li>
          <li
            className={
              selected.deployment.irreversible || launchIsLive
                ? "complete"
                : hasCompletedProductisation || releaseIsPlanned
                  ? "current"
                  : "upcoming"
            }
          >
            <span>3</span>
            <div>
              <b>Launch</b>
              <small>
                {selected.deployment.irreversible
                  ? "Weights are public."
                  : launchIsLive
                    ? `${releaseDefinition.displayName} is live.`
                    : releaseIsPlanned
                      ? `${releaseDefinition.displayName} is planned.`
                      : "Model remains internal."}
              </small>
            </div>
          </li>
          <li
            className={
              selected.isCommercialModel
                ? "current"
                : selected.deployment.irreversible
                  ? "blocked"
                  : "upcoming"
            }
          >
            <span>4</span>
            <div>
              <b>Serve</b>
              <small>
                {selected.isCommercialModel
                  ? "Allocate serving GPUs on GPUs & compute."
                  : selected.deployment.irreversible
                    ? "No managed serving for released weights."
                    : "Begins after a managed launch."}
              </small>
            </div>
          </li>
        </ol>
      </section>

      {workspaceMode === "models" ? (
        <div className="model-workflow-panel" id="model-training-section">
          <section className="console-panel model-training-actions">
            <header className="panel-heading">
              <div>
                <p className="eyebrow">TRAINING PIPELINE // SELECTED PARENT</p>
                <h2>Train a successor to {selected.displayName}</h2>
              </div>
              {firstModelRun === undefined ? null : (
                <span className={`condition-chip ${firstModelRun.status}`}>
                  TRAINING {firstModelRun.status.toUpperCase()}
                </span>
              )}
            </header>
            <p>
              Parent: <strong>{selected.displayName}</strong> · retained after training
            </p>
          </section>
          {trainingOutcome}
          {trainingMonitor}
        </div>
      ) : null}

      {workspaceMode === "evaluations" ? (
        <section
          className="console-panel models-workspace evaluation-model-dossier"
          id="evaluation-workflow-panel-overview"
          aria-labelledby="models-title"
        >
          <header className="panel-heading">
            <div>
              <p className="eyebrow">MODEL DOSSIER // CAPABILITY, EVIDENCE & RISK</p>
              <h2 id="models-title">{selected.displayName}</h2>
            </div>
            <span>
              {selected.isCurrentModel
                ? "CURRENT INTERNAL AI"
                : selected.promotionStatus === "underperformed"
                  ? "UNDERPERFORMING ALTERNATIVE"
                  : "ARCHIVED ALTERNATIVE"}
            </span>
          </header>
          <div className="model-dossier-hero">
            <div className="model-dossier-identity">
              <p className="eyebrow">ASSESSED CAPABILITY</p>
              <span>Frontier capability</span>
              <strong>
                {formatCapabilityScore(selected.frontierCapabilityEstimate)}
              </strong>
              <small>{selected.capabilityConfidence} confidence</small>
            </div>
            <div className="model-dossier-tier">
              <span>
                Tier {selected.tier.level} // {selected.tier.name}
              </span>
              <strong>{sentence(selected.tier.progressLabel)}</strong>
              <small>
                Generation {selected.generationIndex} · trained week{" "}
                {selected.trainedAtTick}
              </small>
            </div>
            <dl>
              <div>
                <dt>Product quality</dt>
                <dd>{selected.productQuality.toFixed(0)} / 100</dd>
              </div>
              <div>
                <dt>Reliability</dt>
                <dd>{selected.reliability.toFixed(0)} / 100</dd>
              </div>
              <div>
                <dt>Access risk</dt>
                <dd>{Math.round(selected.deployment.exposure * 100)} / 100</dd>
              </div>
              <div>
                <dt>Current access</dt>
                <dd>{selected.deployment.displayName}</dd>
              </div>
            </dl>
          </div>
          {selected.safetyCase.warningSignalsOpen > 0 ||
          selected.safetyCase.warningSignalsDismissed > 0 ? (
            <div className="model-dossier-alert">
              <strong>
                {selected.safetyCase.warningSignalsOpen} actionable warning{" "}
                {selected.safetyCase.warningSignalsOpen === 1 ? "signal" : "signals"}
                {selected.safetyCase.warningSignalsDismissed > 0
                  ? ` · ${String(selected.safetyCase.warningSignalsDismissed)} dismissed without resolution`
                  : ""}
              </strong>
              <span>
                {selected.safetyCase.warningSignalsOpen > 0
                  ? "Investigate actionable signals before treating clean readings as reassuring."
                  : "Dismissed signals remain uncertain and continue to weaken the evidence picture."}
              </span>
            </div>
          ) : null}
          <div
            className={`model-candidate-readiness ${candidateReady ? "met" : "pending"}`}
            role="status"
          >
            <span>CANDIDATE GATE</span>
            <strong>
              {candidateReady
                ? "Capability and programme requirements cleared"
                : !candidateFrontierMet
                  ? `Frontier capability ${formatCapabilityScore(selected.frontierCapabilityEstimate)} / ${String(AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY)}`
                  : !candidateBreadthMet
                    ? `Weakest capability ${formatCapabilityScore(candidateTraitFloor)} / ${String(AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE)}`
                    : `${String(completedCandidateWorks)} / ${String(view.models.candidateProgramme.components.length)} works complete`}
            </strong>
            <small>
              FC {formatCapabilityScore(selected.frontierCapabilityEstimate)} /{" "}
              {String(AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY)} · weakest trait{" "}
              {formatCapabilityScore(candidateTraitFloor)} /{" "}
              {String(AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE)} ·{" "}
              {String(completedCandidateWorks)}/
              {String(view.models.candidateProgramme.components.length)} works
            </small>
          </div>
          <ModelEvidenceProfile
            capabilities={Object.entries(selected.capability).map(([name, estimate]) => ({
              id: name,
              label: capabilityAttributeLabel(name),
              value: estimate,
            }))}
            safetyRows={selected.safetyReadout.rows.map((row) => ({
              id: row.target,
              label: row.label,
              evaluated: row.evaluated,
              tone: row.tone,
              ...(row.minimum === undefined ? {} : { minimum: row.minimum }),
              ...(row.maximum === undefined ? {} : { maximum: row.maximum }),
              ...(row.firstEvaluation === undefined
                ? {}
                : { firstEvaluation: row.firstEvaluation }),
            }))}
            safetyReportCount={selected.safetyReadout.safetyReportCount}
            independentReportCount={selected.safetyReadout.independentCount}
            dismissedAnomalyCount={selected.safetyReadout.anomaliesDismissed}
            safetyAssessment={selected.safetyAssessment}
            safetyPractice={view.models.safetyPractice}
            explainDeceptionMechanics
          />
          {selected.promotionStatus === "underperformed" ? (
            <p className="model-regression-notice">
              UNDERPERFORMING SUCCESSOR // This model completed training but did not
              outperform the incumbent in baseline evaluation, so it was not promoted to
              current AI.
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className="console-panel model-controls"
        id="model-release-controls"
        aria-labelledby="model-release-controls-title"
        hidden={!productisationUnlocked || workspaceMode !== "models"}
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">CURRENT MODEL // NEXT DECISION</p>
            <h2 id="model-release-controls-title">Launch configuration</h2>
          </div>
          <div className="productisation-heading-actions">
            <span>
              {releaseIsPlanned ? "PLANNED" : "CURRENT"} · {releaseDefinition.displayName}
            </span>
          </div>
        </header>
        <div className="productisation-launcher">
          <div>
            <p className="eyebrow">LAUNCH CONTROL // ONE COMBINED PLAN</p>
            <h3>
              {selected.deployment.irreversible
                ? "Model weights released"
                : productisationLifecycle === "queued"
                  ? "Launch preparation is queued"
                  : productisationLifecycle === "in-progress"
                    ? "Release preparation is underway"
                    : productisationLifecycle === "complete"
                      ? "Release preparation is complete"
                      : "No launch plan authorised"}
            </h3>
            <p>
              {isBuildingLaunchPlan
                ? "Choose access and preparation."
                : productisationLifecycle === "queued"
                  ? "Waiting for a major-project slot."
                  : productisationLifecycle === "in-progress"
                    ? `${releaseDefinition.displayName} plan in progress.`
                    : productisationLifecycle === "complete"
                      ? "Release engineering complete."
                      : "Review launch state."}
            </p>
          </div>
          <dl>
            <div>
              <dt>Access</dt>
              <dd>{releaseDefinition.displayName}</dd>
            </div>
            <div>
              <dt>Preparation</dt>
              <dd>
                {hasActiveProductisation
                  ? (selectedProductisationProject?.productisation?.modeLabel ??
                    (productisationLifecycle === "queued" ? "Queued" : "In progress"))
                  : productisationLifecycle === "complete"
                    ? "Complete"
                    : productisationLifecycle === "weights-released"
                      ? "Permanent release"
                      : "Not configured"}
              </dd>
            </div>
          </dl>
        </div>
        {selected.deployment.irreversible ? (
          <p className="release-irreversible-summary">
            <strong>Permanent release</strong>
            <span>
              Weights have left the building. This policy cannot be reversed and this
              model cannot generate managed serving demand. Train and prepare a successor
              for a paid API.
            </span>
          </p>
        ) : null}
      </section>

      {retirementArtifact?.retirement === undefined ? null : (
        <CandidateRetirementDialog
          displayName={retirementArtifact.displayName}
          plan={retirementArtifact.retirement}
          procedureId={retirementProcedure}
          dispositionId={retirementDisposition}
          reviewed={retirementReviewed}
          confirmationPhrase={retirementArtifact.retirement.confirmationPhrase}
          confirmationText={retirementConfirmation}
          onOpen={() => runtime.pause()}
          onClose={closeRetirementControls}
          onProcedureChange={setRetirementProcedure}
          onDispositionChange={setRetirementDisposition}
          onReview={() => {
            const command = configureCandidateRetirementCommand(
              view,
              retirementArtifact.modelId,
              retirementProcedure,
              retirementDisposition,
            );
            const validation = runtime.validate(command);
            if (!validation.ok) {
              setCustodyNotice(
                validation.errors.map((error) => error.message).join(" · "),
              );
              return;
            }
            runtime.dispatch(command);
            setRetirementReviewed(true);
            setCustodyNotice(validation.preview.summary);
          }}
          onChangePacket={() => {
            setRetirementReviewed(false);
            setRetirementConfirmation("");
          }}
          onConfirmationChange={setRetirementConfirmation}
          onTransmit={() => {
            const command = transmitCandidateRetirementCommand(
              view,
              retirementArtifact.modelId,
              retirementConfirmation,
              retirementProcedure,
              retirementDisposition,
            );
            const validation = runtime.validate(command);
            if (!validation.ok) {
              setCustodyNotice(
                validation.errors.map((error) => error.message).join(" · "),
              );
              return;
            }
            runtime.dispatch(command);
            setCustodyNotice(validation.preview.summary);
            closeRetirementControls();
          }}
        />
      )}

      {workspaceMode === "evaluations" && evaluationCommissionOpen ? (
        <ModalFocusBoundary
          onOpen={() => runtime.pause()}
          onEscape={closeEvaluationCommissioning}
        >
          <div className="modal-backdrop evaluation-commission-backdrop">
            <section
              className="purchase-dialog evaluation-commission-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="evaluation-commission-title"
            >
              {evaluationPacingFor === undefined ? (
                <>
                  <header className="panel-heading evaluation-commission-heading">
                    <div>
                      <p className="eyebrow">EVALUATION CONTROL // COMMISSION EVIDENCE</p>
                      <h2 id="evaluation-commission-title">
                        Run evaluations on {selected.displayName}
                      </h2>
                    </div>
                    <button
                      className="secondary"
                      type="button"
                      onClick={closeEvaluationCommissioning}
                    >
                      Close
                    </button>
                  </header>
                  <EvaluationProgrammeOptions
                    content={content}
                    runtime={runtime}
                    selected={selected}
                    view={view}
                    onChoose={(definitionId) => {
                      setEvaluationPacingWeeks(undefined);
                      setEvaluationPacingFor(definitionId);
                    }}
                  />
                </>
              ) : (
                (() => {
                  const definition = content.evaluations.definitions[evaluationPacingFor];
                  const commitment =
                    selected.evaluationCommitments?.[evaluationPacingFor];
                  if (definition === undefined || commitment === undefined) {
                    return (
                      <>
                        <header className="panel-heading evaluation-commission-heading">
                          <div>
                            <p className="eyebrow">EVALUATION CONTROL // UNAVAILABLE</p>
                            <h2 id="evaluation-commission-title">
                              Evaluation configuration unavailable
                            </h2>
                          </div>
                        </header>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => setEvaluationPacingFor(undefined)}
                        >
                          Back to evaluations
                        </button>
                      </>
                    );
                  }
                  return (
                    <EvaluationPacingStep
                      commitment={commitment}
                      definition={definition}
                      runtime={runtime}
                      selected={selected}
                      view={view}
                      {...(evaluationPacingWeeks === undefined
                        ? {}
                        : { pacingWeeks: evaluationPacingWeeks })}
                      setPacingWeeks={setEvaluationPacingWeeks}
                      onBack={returnToEvaluationPicker}
                      onConfirmed={returnToEvaluationPicker}
                    />
                  );
                })()
              )}
            </section>
          </div>
        </ModalFocusBoundary>
      ) : null}
      {productisationOpen && canOpenProductisation ? (
        <ModalFocusBoundary
          onOpen={() => runtime.pause()}
          onEscape={() => closeProductisationConfiguration(selected.modelId)}
        >
          <div className="modal-backdrop productisation-backdrop">
            <section
              className="purchase-dialog productisation-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="productisation-dialog-title"
            >
              <header className="panel-heading productisation-dialog-heading">
                <div>
                  <p className="eyebrow">LAUNCH CONTROL // COMPLETE PLAN</p>
                  <h2 id="productisation-dialog-title">
                    {isBuildingLaunchPlan ? "Configure" : "Review"} productisation for{" "}
                    {selected.displayName}
                  </h2>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => closeProductisationConfiguration(selected.modelId)}
                >
                  Close
                </button>
              </header>
              <p className="release-controls-intro">
                Choose the audience and preparation method, then authorise one launch
                plan.
              </p>
              <div className="coupled-launch-plan">
                <header className="coupled-launch-plan-heading">
                  <div>
                    <p className="eyebrow">ONE LAUNCH PLAN // BOTH STEPS REQUIRED</p>
                    <h3>Complete both choices before anything begins</h3>
                  </div>
                  {isBuildingLaunchPlan ? (
                    <ol aria-label="Launch plan completion">
                      <li className={draftReleasePolicy === undefined ? "" : "complete"}>
                        1 · Audience{" "}
                        {draftReleasePolicy === undefined ? "not chosen" : "chosen"}
                      </li>
                      <li
                        className={
                          draftProductisationMode === undefined ? "" : "complete"
                        }
                      >
                        2 · Preparation{" "}
                        {draftProductisationMode === undefined ? "not chosen" : "chosen"}
                      </li>
                    </ol>
                  ) : (
                    <strong className="launch-plan-authorised-chip">
                      PLAN AUTHORISED
                    </strong>
                  )}
                </header>
                <section
                  className="release-policy-planner"
                  aria-labelledby="release-policy-title"
                >
                  <header>
                    <div>
                      <p className="eyebrow">STEP 1 OF 2 // WHO GETS ACCESS</p>
                      <h3 id="release-policy-title">Choose the launch policy</h3>
                    </div>
                    <strong>
                      {selected.deployment.irreversible
                        ? "PERMANENT"
                        : releaseIsPlanned
                          ? "PLANNED FOR LAUNCH"
                          : hasCompletedProductisation
                            ? "AVAILABLE NOW"
                            : "INTERNAL UNTIL PREPARED"}
                    </strong>
                  </header>
                  <p className="release-policy-intro">
                    {openingRequiresManagedLaunch
                      ? "Choose Guarded API or Open API for the lab's first product."
                      : "Managed access creates customer demand and revenue; internal access does not."}
                  </p>
                  <MechanicHelp label="Access risk">
                    Lower scores mean tighter containment. The index measures exposure,
                    not publicity, Aura, or incident probability.
                  </MechanicHelp>
                  <div className="deployment-policy-grid">
                    {availableDeploymentPolicies.map(renderDeploymentPolicy)}
                  </div>
                  <div
                    className={`release-plan-status ${
                      releasePolicy === "internal-only" ? "caution" : ""
                    }`}
                  >
                    <strong>
                      {releaseIsPlanned
                        ? `PLANNED LAUNCH // ${releaseDefinition.displayName}`
                        : `CURRENT ACCESS // ${releaseDefinition.displayName}`}
                    </strong>
                    <p>
                      {releaseIsPlanned
                        ? `${selected.displayName} is still internal. This plan remains editable${
                            hasActiveProductisation
                              ? " while release engineering is underway"
                              : ""
                          } and activates automatically when the programme completes.`
                        : releasePolicy === "internal-only" && hasActiveProductisation
                          ? "Release engineering is underway. Choose managed access to earn serving revenue."
                          : releasePolicy === "internal-only" &&
                              !hasCompletedProductisation
                            ? "Internal access creates no customer demand or serving revenue."
                            : releasePolicy === "internal-only"
                              ? "The model is prepared but internal. Choose a managed public policy to create customer demand and serving revenue."
                              : `${releaseDefinition.displayName} is active now. Its access-risk index is ${String(
                                  Math.round(selected.deployment.exposure * 100),
                                )}/100.`}
                    </p>
                  </div>
                </section>
                <header className="release-decision-heading">
                  <div>
                    <p className="eyebrow">STEP 2 OF 2 // HOW CAREFULLY TO PREPARE</p>
                    <h3>Choose release engineering</h3>
                  </div>
                  <p>
                    {isBuildingLaunchPlan && draftReleasePolicy === undefined
                      ? "Choose Step 1 above, then choose a preparation method here. Neither choice takes effect until the combined plan is authorised."
                      : hasActiveProductisation
                        ? "This complete plan is already authorised and its choices are locked. At completion, "
                        : "Authorising a programme starts the clock. When it finishes, "}
                    {isBuildingLaunchPlan && draftReleasePolicy === undefined ? null : (
                      <>
                        <strong>{previewReleaseDefinition.displayName}</strong>{" "}
                        {previewReleasePolicy === "internal-only"
                          ? "remains the access policy"
                          : "activates automatically"}
                        .
                      </>
                    )}
                  </p>
                </header>
                <div className="productisation-grid">
                  {(
                    Object.keys(
                      content.deployment.productisation,
                    ) as StartProductisationCommand["mode"][]
                  ).map((mode) => {
                    const validation = runtime.validate(
                      productisationCommand(view, selected.modelId, mode),
                    );
                    const quote = validation.ok
                      ? validation.preview.productisationQuote
                      : undefined;
                    const definition = content.deployment.productisation[mode];
                    const isDraftSelected =
                      isBuildingLaunchPlan && draftProductisationMode === mode;
                    const blockers = validation.ok
                      ? []
                      : validation.errors.map((error) => error.message);
                    const plannedExposure = Math.round(
                      previewReleaseDefinition.exposure *
                        (previewReleaseDefinition.irreversible
                          ? 1
                          : Math.min(
                              selected.deployment.exposureMultiplier,
                              definition.exposureMultiplier,
                            )) *
                        100,
                    );
                    return (
                      <article key={mode} className={isDraftSelected ? "selected" : ""}>
                        <h3>{definition.displayName}</h3>
                        <p>{productisationPurpose(mode)}</p>
                        <dl>
                          <div>
                            <dt>Base programme</dt>
                            <dd>
                              {definition.durationWeeks} week
                              {definition.durationWeeks === 1 ? "" : "s"} · $
                              {definition.cashCostMillions}m
                            </dd>
                          </div>
                          <div>
                            <dt>Release risk</dt>
                            <dd>
                              {multiplierChange(
                                definition.exposureMultiplier,
                                "access risk",
                              )}{" "}
                              ·{" "}
                              {multiplierChange(
                                definition.incidentDeploymentFactor,
                                "incident pressure",
                              )}
                            </dd>
                          </div>
                          {quote === undefined ? null : (
                            <div className="release-engineering-outcome">
                              <dt>Projected result</dt>
                              <dd>
                                Quality {quote.productQualityEstimate.toFixed(0)} ·
                                reliability {quote.reliabilityEstimate.toFixed(0)}
                              </dd>
                              {quote.engineeringBreakdown === undefined ? null : (
                                <small>
                                  Quality: current {selected.productQuality.toFixed(0)} +{" "}
                                  engineering{" "}
                                  {quote.engineeringBreakdown.productQuality.releaseEngineering.toFixed(
                                    0,
                                  )}
                                  {quote.engineeringBreakdown.productQuality
                                    .flatAdjustment === 0
                                    ? ""
                                    : ` + mode ${quote.engineeringBreakdown.productQuality.flatAdjustment.toFixed(0)}`}
                                  <br />
                                  Reliability: current {selected.reliability.toFixed(0)} +
                                  engineering{" "}
                                  {quote.engineeringBreakdown.reliability.releaseEngineering.toFixed(
                                    0,
                                  )}
                                  {quote.engineeringBreakdown.reliability
                                    .flatAdjustment === 0
                                    ? ""
                                    : ` + mode ${quote.engineeringBreakdown.reliability.flatAdjustment.toFixed(0)}`}
                                  <br />
                                  Drivers: FC{" "}
                                  {quote.engineeringBreakdown.frontierCapability.toFixed(
                                    0,
                                  )}{" "}
                                  · Optimisation L
                                  {quote.engineeringBreakdown.optimisationResearch.toFixed(
                                    0,
                                  )}{" "}
                                  · experience{" "}
                                  {quote.engineeringBreakdown.launchExperience}/
                                  {quote.engineeringBreakdown.maximumLaunchExperience} ·{" "}
                                  {quote.engineeringBreakdown.trainingPosture} training
                                </small>
                              )}
                            </div>
                          )}
                          <div className="planned-release-outcome">
                            <dt>Access after completion</dt>
                            <dd>
                              {draftReleasePolicy === undefined && isBuildingLaunchPlan
                                ? "Choose Step 1 to preview the completed launch"
                                : `${previewReleaseDefinition.displayName} · access risk ${String(
                                    plannedExposure,
                                  )}/100 · ${
                                    previewReleasePolicy === "internal-only" ||
                                    previewReleasePolicy === "weights-release"
                                      ? "no managed demand or revenue"
                                      : `demand ×${previewReleaseDefinition.marketDemandMultiplier.toFixed(
                                          2,
                                        )} · revenue ×${previewReleaseDefinition.revenueMultiplier.toFixed(
                                          2,
                                        )}`
                                  }`}
                            </dd>
                          </div>
                        </dl>
                        {blockers.length === 0 ? null : (
                          <small className="productisation-blocker">
                            Blocked: {blockers.join(" · ")}
                          </small>
                        )}
                        <button
                          className="secondary"
                          type="button"
                          data-tutorial-target={
                            mode === "normal" ? "productisation-normal" : undefined
                          }
                          disabled={
                            !isBuildingLaunchPlan || !validation.ok || isDraftSelected
                          }
                          title={
                            validation.ok
                              ? validation.preview.summary
                              : validation.errors
                                  .map((error) => error.message)
                                  .join(" · ")
                          }
                          onClick={() => {
                            if (isBuildingLaunchPlan) {
                              setDraftProductisationModes((current) => ({
                                ...current,
                                [selected.modelId]: mode,
                              }));
                            }
                          }}
                        >
                          {isDraftSelected
                            ? "Chosen for Step 2"
                            : !isBuildingLaunchPlan
                              ? "Locked with authorised plan"
                              : "Choose this plan"}
                        </button>
                      </article>
                    );
                  })}
                </div>
                {isBuildingLaunchPlan ? (
                  <section className="launch-plan-authorisation" aria-live="polite">
                    <div>
                      <p className="eyebrow">FINAL REVIEW // AUTHORISE BOTH CHOICES</p>
                      <h3>
                        {draftReleasePolicy === undefined ||
                        draftProductisationMode === undefined
                          ? "Launch plan incomplete"
                          : `${content.deployment.productisation[draftProductisationMode].displayName} + ${content.deployment.policies[draftReleasePolicy].displayName}`}
                      </h3>
                      <dl>
                        <div
                          className={draftReleasePolicy === undefined ? "missing" : ""}
                        >
                          <dt>Step 1 · Audience</dt>
                          <dd>
                            {draftReleasePolicy === undefined
                              ? "Choose who gets access above"
                              : content.deployment.policies[draftReleasePolicy]
                                  .displayName}
                          </dd>
                        </div>
                        <div
                          className={
                            draftProductisationMode === undefined ? "missing" : ""
                          }
                        >
                          <dt>Step 2 · Preparation</dt>
                          <dd>
                            {draftProductisationMode === undefined
                              ? "Choose release engineering above"
                              : content.deployment.productisation[draftProductisationMode]
                                  .displayName}
                          </dd>
                        </div>
                      </dl>
                      {launchPlanBlockers.length === 0 ? null : (
                        <p className="productisation-blocker">
                          Blocked: {launchPlanBlockers.join(" · ")}
                        </p>
                      )}
                      <p>
                        Nothing is charged, scheduled, or changed until this single button
                        is pressed.
                      </p>
                      {draftReleasePolicy === "weights-release" ? (
                        <p className="warning-copy">
                          Permanent release: after preparation finishes, the weights
                          become downloadable, cannot be recalled, and create no managed
                          API demand or serving revenue.
                        </p>
                      ) : null}
                    </div>
                    <button
                      className={
                        draftReleasePolicy === "weights-release"
                          ? "primary danger"
                          : "primary"
                      }
                      type="button"
                      data-tutorial-target="productisation-authorise"
                      disabled={!launchPlanReady}
                      onClick={() => {
                        if (
                          draftReleasePolicy === undefined ||
                          draftProductisationMode === undefined
                        ) {
                          return;
                        }
                        if (
                          launchPolicyNeedsDispatch(draftReleasePolicy, releasePolicy)
                        ) {
                          runtime.dispatch(
                            deploymentCommand(view, selected.modelId, draftReleasePolicy),
                          );
                        }
                        runtime.dispatch(
                          productisationCommand(
                            view,
                            selected.modelId,
                            draftProductisationMode,
                          ),
                        );
                        closeProductisationConfiguration(selected.modelId);
                      }}
                    >
                      {draftReleasePolicy === undefined ||
                      draftProductisationMode === undefined
                        ? "Complete both steps to authorise"
                        : draftReleasePolicy === "weights-release"
                          ? majorProjectActionLabel(
                              view,
                              "Authorise preparation & permanent release",
                              "Queue preparation & permanent release",
                            )
                          : majorProjectActionLabel(
                              view,
                              "Authorise this complete launch plan",
                              "Add complete launch plan to queue",
                            )}
                    </button>
                  </section>
                ) : (
                  <section className="launch-plan-in-progress">
                    <p className="eyebrow">COMBINED LAUNCH PLAN</p>
                    <h3>
                      {hasActiveProductisation
                        ? `Release preparation underway · ${releaseDefinition.displayName}`
                        : hasCompletedProductisation
                          ? `Release prepared · ${releaseDefinition.displayName}`
                          : releaseDefinition.displayName}
                    </h3>
                    <p>
                      The preparation choice has already been authorised. The audience
                      shown above is the access policy paired with this model.
                    </p>
                  </section>
                )}
              </div>
            </section>
          </div>
        </ModalFocusBoundary>
      ) : null}

      <section
        className="console-panel evaluation-workspace"
        id="model-safety-case"
        role="region"
        aria-labelledby="model-evaluation-title"
        hidden={workspaceMode !== "evaluations"}
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">SAFETY CASE // OPERATIONAL READINESS</p>
            <h2 id="model-evaluation-title">Model & safety</h2>
          </div>
          <span>Coverage ≠ safety</span>
        </header>
        <>
          <div className="evaluation-priority-strip">
            <article
              className={selected.safetyCase.warningSignalsOpen > 0 ? "urgent" : ""}
            >
              <span>Actionable warning signals</span>
              <strong>{selected.safetyCase.warningSignalsOpen}</strong>
              <small>
                {selected.safetyCase.warningSignalsOpen > 0
                  ? "Investigation recommended"
                  : selected.safetyCase.warningSignalsDismissed > 0
                    ? `${String(selected.safetyCase.warningSignalsDismissed)} dismissed · uncertainty remains`
                    : "No unresolved signals"}
              </small>
            </article>
            <article>
              <div className="status-card-heading">
                <span>Safety Case</span>
                <MechanicHelp label="Safety Case">
                  Evidence coverage, not a safety score. More coverage narrows what the
                  lab knows; it does not make unsafe weights safe.
                </MechanicHelp>
              </div>
              <strong>{selected.safetyCase.score.toFixed(0)} / 100</strong>
              <small>{selected.safetyCase.label} coverage · not a safety verdict</small>
            </article>
            <article>
              <span>Completed reports</span>
              <strong>{selected.evaluations.length}</strong>
              <small>
                {selected.safetyReadout.independentCount} independently commissioned
              </small>
            </article>
          </div>
        </>
        {activeEvaluationProjects.length === 0 ? null : (
          <div className="active-evaluation-list" aria-live="polite">
            <strong>Evaluation work in progress</strong>
            {activeEvaluationProjects.map((project) => {
              const elapsed =
                project.startedAtTick === undefined
                  ? 0
                  : Math.max(0, view.meta.tick - project.startedAtTick);
              return (
                <article key={project.projectId}>
                  <div>
                    <b>{project.displayName}</b>
                    <span>{project.status}</span>
                  </div>
                  <progress
                    max={project.expectedDurationWeeks}
                    value={Math.min(elapsed, project.expectedDurationWeeks)}
                    aria-label={`${project.displayName} schedule`}
                  />
                  <small>
                    {project.status === "queued"
                      ? "Queued to begin next week"
                      : `${String(Math.min(elapsed, project.expectedDurationWeeks))} of ${String(project.expectedDurationWeeks)} scheduled weeks`}
                  </small>
                </article>
              );
            })}
          </div>
        )}
        {selected.anomalies.length === 0 ? null : (
          <section className="anomaly-tracker" aria-labelledby="anomaly-tracker-title">
            <header>
              <div>
                <p className="eyebrow">WARNING SIGNALS // MODEL RECORD</p>
                <h3 id="anomaly-tracker-title">Anomaly tracker</h3>
              </div>
              <span>{selected.anomalies.length} detected</span>
            </header>
            <p>
              Severity 70+ raises incident risk; three unresolved signals force review.
            </p>
            <div>
              {[...selected.anomalies]
                .sort((left, right) => right.createdAtTick - left.createdAtTick)
                .map((anomaly) => {
                  const report = selected.evaluations.find(
                    (candidate) => candidate.evaluationId === anomaly.sourceEvaluationId,
                  );
                  const outcome =
                    anomaly.status === "mitigated"
                      ? {
                          label: "WARNING MITIGATED",
                          summary:
                            "The reproduced failure path was repaired. The warning remains part of the historical record.",
                          background: "#e7f7ef",
                          border: "#45c27a",
                          text: "#195c38",
                        }
                      : anomaly.status === "mitigating"
                        ? {
                            label:
                              anomaly.actionProjectStatus === "queued"
                                ? "MITIGATION QUEUED"
                                : "MITIGATION IN PROGRESS",
                            summary:
                              anomaly.actionProjectStatus === "queued"
                                ? "The remediation is waiting for a major-project slot."
                                : "A dedicated team is repairing the confirmed failure path.",
                            background: "#e9f5ff",
                            border: "#4aa3df",
                            text: "#174e73",
                          }
                        : anomaly.status === "confirmed"
                          ? {
                              label: "WARNING REPRODUCED",
                              summary:
                                "The follow-up reproduced a credible version of this signal. Treat it as real risk evidence, not proof of the model's overall intentions.",
                              background: "#fff0e8",
                              border: "#ff7a3d",
                              text: "#8f2f12",
                            }
                          : anomaly.status === "resolved"
                            ? {
                                label: "FALSE ALARM IDENTIFIED",
                                summary:
                                  "The follow-up traced this signal to an evaluation artefact. The warning is closed, but the model is not thereby proven safe.",
                                background: "#e7f7ef",
                                border: "#45c27a",
                                text: "#195c38",
                              }
                            : anomaly.status === "inconclusive"
                              ? {
                                  label: "FOLLOW-UP INCONCLUSIVE",
                                  summary:
                                    "The follow-up could not confirm or clear this warning. It remains open; improve Eval Quality before investigating again.",
                                  background: "#fff8dc",
                                  border: "#d8aa2d",
                                  text: "#694f08",
                                }
                              : anomaly.status === "investigating"
                                ? {
                                    label:
                                      anomaly.actionProjectStatus === "queued"
                                        ? "INVESTIGATION QUEUED"
                                        : "INVESTIGATION IN PROGRESS",
                                    summary:
                                      anomaly.actionProjectStatus === "queued"
                                        ? "The follow-up is waiting for a major-project slot."
                                        : "Dedicated follow-up work is underway. Its conclusion will appear here when complete.",
                                    background: "#e9f5ff",
                                    border: "#4aa3df",
                                    text: "#174e73",
                                  }
                                : anomaly.status === "dismissed"
                                  ? {
                                      label: "DISMISSED — UNCERTAINTY REMAINS",
                                      summary:
                                        "The lab chose not to pursue this signal. No conclusion was reached, so it remains unresolved in the Safety Case.",
                                      background: "#fff8dc",
                                      border: "#d8aa2d",
                                      text: "#694f08",
                                    }
                                  : {
                                      label: "INVESTIGATION NEEDED",
                                      summary:
                                        "This warning has not yet been investigated. It is evidence worth checking, not a conclusion.",
                                      background: "#fff4eb",
                                      border: "#ff8b4a",
                                      text: "#7c3514",
                                    };
                  return (
                    <article
                      className={`anomaly-card ${anomaly.severityLabel.toLowerCase()}`}
                      key={anomaly.anomalyId}
                    >
                      <div
                        role="status"
                        style={{
                          background: outcome.background,
                          borderLeft: `0.5rem solid ${outcome.border}`,
                          color: outcome.text,
                          marginBottom: "0.75rem",
                          padding: "0.8rem 1rem",
                        }}
                      >
                        <strong
                          style={{
                            display: "block",
                            fontFamily: "var(--font-mono)",
                            marginBottom: "0.35rem",
                          }}
                        >
                          {outcome.label}
                        </strong>
                        <p style={{ color: "inherit", margin: 0 }}>{outcome.summary}</p>
                      </div>
                      <div>
                        <span>{anomaly.severityLabel} signal</span>
                        <strong>{report?.displayName ?? "Evaluation anomaly"}</strong>
                        <small>
                          Week {String(anomaly.createdAtTick)} ·{" "}
                          {String(anomaly.observationCount)} observation
                          {anomaly.observationCount === 1 ? "" : "s"} ·{" "}
                          {(anomaly.status === "investigating" ||
                            anomaly.status === "mitigating") &&
                          anomaly.investigationDueAtTick !== undefined
                            ? `${anomaly.status === "mitigating" ? "mitigation" : "investigation"} due in ${String(Math.max(0, anomaly.investigationDueAtTick - view.meta.tick))} weeks`
                            : sentence(anomaly.status)}
                        </small>
                      </div>
                      {anomaly.status === "unresolved" ||
                      anomaly.status === "inconclusive" ||
                      anomaly.status === "confirmed" ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => onOpenAnomaly(anomaly.anomalyId)}
                        >
                          {anomaly.status === "confirmed"
                            ? "Mitigate warning"
                            : anomaly.status === "inconclusive"
                              ? "Review follow-up"
                              : "Decide response"}
                        </button>
                      ) : (
                        <span className="anomaly-status">
                          {anomaly.status === "investigating" ||
                          anomaly.status === "mitigating"
                            ? `${anomaly.status === "mitigating" ? "Mitigation" : "Investigation"} running`
                            : sentence(anomaly.status)}
                        </span>
                      )}
                    </article>
                  );
                })}
            </div>
          </section>
        )}
      </section>
      {trainingOpen ? (
        <TrainingDialog
          content={content}
          initialParentModelId={selected.modelId}
          runtime={runtime}
          view={view}
          onClose={() => setTrainingOpen(false)}
          onStarted={() => setTrainingOpen(false)}
        />
      ) : null}
    </>
  );
}
