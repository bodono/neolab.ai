import { useState, type CSSProperties, type ReactElement } from "react";

import {
  formatTeraflops,
  type ChoosePublicationPolicyCommand,
  type GameView,
  type ResearchPaperView,
} from "@neolab/sim/public";

import {
  allocationCommand,
  genericAdvanceCommand,
  publicationPolicyCommand,
} from "../../app/command-builders.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import {
  ResearchAllocationControl,
  useResearchAllocation,
} from "../compute/research-allocation-control.tsx";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import { PixelPortrait } from "../portraits/pixel-portrait.tsx";
import { researchLevelProgressPresentation } from "./research-level-progress.ts";

// TODO(flagship-redesign): flip back on when flagship programmes become
// opt-in AGI-candidate subcomponents. See the panel below for context.
const FLAGSHIP_PROGRAMMES_ENABLED = false;

const PUBLICATION_POLICIES: readonly {
  readonly value: ChoosePublicationPolicyCommand["policy"];
  readonly label: string;
  readonly tradeoff: string;
}[] = [
  {
    value: "publish-openly",
    label: "Publish",
    tradeoff: "Full prestige · science becomes public immediately",
  },
  {
    value: "keep-secret",
    label: "Keep secret",
    tradeoff: "Exclusive science · no publication prestige",
  },
];

function formatPolicy(policy: string): string {
  return policy.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type InspectPaperResearcher = (definitionId: string, inspirationName: string) => void;

interface ProgrammeLeadIdentity {
  readonly researcherId: string;
  readonly displayName: string;
  readonly portraitAssetId: string;
  readonly portraitBrief?: string;
  readonly portraitAltText: string;
}

type ResearchProgrammeCardView = GameView["research"]["techTree"]["programmes"][number];

function signedPercent(value: number, suffix = "%"): string {
  const magnitude = Math.abs(value);
  if (magnitude < 0.05) return `0${suffix}`;
  const rounded = magnitude >= 10 ? magnitude.toFixed(0) : magnitude.toFixed(1);
  return `${value > 0 ? "+" : "−"}${rounded}${suffix}`;
}

function multiplierLabel(value: number): string {
  return `×${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function ResearchProgrammeCard({
  programme,
  allocationSharePercent,
  selected,
  lead,
  onSelect,
  onInspectLead,
  onOpenPeople,
}: {
  readonly programme: ResearchProgrammeCardView;
  readonly allocationSharePercent: number;
  readonly selected: boolean;
  readonly lead?: ProgrammeLeadIdentity;
  readonly onSelect: () => void;
  readonly onInspectLead: (researcherId: string) => void;
  readonly onOpenPeople: () => void;
}): ReactElement {
  // During Vite HMR, an already-running BrowserGameRuntime can retain the
  // pre-update projector until reload. Keep that exact legacy view neutral
  // instead of taking down the whole application shell.
  const hasLegacyProjection =
    programme.researchOutputMultiplier === undefined &&
    programme.assignedResearcherPercentagePoints === undefined;
  const assignedResearcherPercentagePoints = hasLegacyProjection
    ? 0
    : programme.assignedResearcherPercentagePoints;
  const diffusionPercentagePoints = hasLegacyProjection
    ? 0
    : programme.diffusion.percentagePoints;
  const baseResearcherMultiplier =
    1 + (assignedResearcherPercentagePoints + diffusionPercentagePoints) / 100;
  const researchOutputMultiplier = hasLegacyProjection
    ? 1
    : programme.researchOutputMultiplier;
  const totalBonusPercent = (researchOutputMultiplier - 1) * 100;
  const effectsMultiplier =
    baseResearcherMultiplier <= 0
      ? researchOutputMultiplier
      : researchOutputMultiplier / baseResearcherMultiplier;
  const totalBonusLabel = signedPercent(totalBonusPercent);
  const leadBonusLabel = signedPercent(assignedResearcherPercentagePoints);
  const diffusionLabel = signedPercent(diffusionPercentagePoints);
  const effectsLabel = signedPercent((effectsMultiplier - 1) * 100);
  const effectsMultiplierLabel = multiplierLabel(effectsMultiplier);
  const levelProgress = researchLevelProgressPresentation(
    programme.level,
    programme.momentumLabel,
  );
  const [levelEstimateMinimum, levelEstimateMaximum] = levelProgress.estimateRange;
  const nextLevel = Math.min(100, Math.floor(programme.level) + 1);
  const bonusExplanation = `${programme.name} applied programme-output bonus ${totalBonusLabel}. Lead skill ${leadBonusLabel}; knowledge diffusion ${diffusionLabel}; all additional effects ${effectsLabel} (${effectsMultiplierLabel}). Lead and diffusion form the starting multiplier; other effects then compound multiplicatively.`;
  return (
    <article
      className={`research-programme-card${selected ? " selected" : ""}`}
      style={{ "--programme-colour": programme.colour } as CSSProperties}
    >
      <button
        className="research-programme-select"
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="research-programme-heading">
          <strong title={programme.name}>{programme.shortName}</strong>
          <span className="programme-level-badge">
            <small>LEVEL</small>
            <b>{programme.level}</b>
            <i>/100</i>
          </span>
        </span>
        <span className="programme-level-progress">
          <span className="programme-level-progress-copy">
            <small>
              {levelProgress.complete
                ? "MAXIMUM LEVEL"
                : `NEXT · LEVEL ${String(nextLevel)}`}
            </small>
            <strong>
              {levelProgress.complete
                ? "COMPLETE"
                : `${levelProgress.compactLabel.replace(` → L${String(nextLevel)}`, "")} · ${programme.momentumLabel}`}
            </strong>
          </span>
          <i
            className={`programme-level-progress-track${levelProgress.complete ? " complete" : ""}`}
            role="img"
            aria-label={`${programme.name}: ${levelProgress.ariaValueText}`}
          >
            <b
              style={{
                left: levelProgress.complete ? "0%" : `${String(levelEstimateMinimum)}%`,
                width: levelProgress.complete
                  ? "100%"
                  : `${String(levelEstimateMaximum - levelEstimateMinimum)}%`,
              }}
            />
          </i>
        </span>
        <span className="programme-level-input">
          <small>RESEARCH COMPUTE</small>
          <strong>{programme.allocationLabel}</strong>
          <span>
            {programme.momentumLabel === "Unfunded"
              ? "Needs 200 TFLOP/s to advance"
              : "FLOP/s → level progress"}
          </span>
        </span>
        <small className="programme-share-label">
          {allocationSharePercent.toFixed(0)}% of{" "}
          {programme.kind === "capability" ? "capability" : "safety"} research
        </small>
      </button>
      <button
        className={`programme-lead-slot${lead === undefined ? " empty" : " occupied"}`}
        type="button"
        title={bonusExplanation}
        aria-label={
          lead === undefined
            ? `Open People to appoint a lead for ${programme.name}. ${bonusExplanation}`
            : `Inspect or reassign ${lead.displayName}, lead for ${programme.name}. ${bonusExplanation}`
        }
        onClick={() => {
          if (lead === undefined) {
            onOpenPeople();
          } else {
            onInspectLead(lead.researcherId);
          }
        }}
      >
        {lead === undefined ? (
          <span className="programme-lead-empty-portrait" aria-hidden="true">
            +
          </span>
        ) : (
          <PixelPortrait
            className="programme-lead-portrait"
            subjectId={lead.portraitAssetId}
            name={lead.displayName}
            brief={lead.portraitBrief}
            altText={lead.portraitAltText}
          />
        )}
        <span className="programme-lead-summary">
          <strong>{lead?.displayName ?? "Appoint lead"}</strong>
          <span>
            <b>{totalBonusLabel}</b> total output
          </span>
        </span>
        <span className="programme-bonus-components" aria-hidden="true">
          <span>lead {leadBonusLabel}</span>
          <span>diffusion {diffusionLabel}</span>
          <span>effects {effectsLabel}</span>
        </span>
      </button>
    </article>
  );
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

export function ProgrammeOutputLedger({
  programme,
}: {
  readonly programme: ResearchProgrammeCardView;
}): ReactElement {
  // A live Vite session can retain the previous GameView projector until the
  // page reloads. Treat the new ledger as independently optional at runtime:
  // the older multiplier fields may already exist even when this one does not.
  const ledger = programme.outputLedger as
    ResearchProgrammeCardView["outputLedger"] | undefined;
  const assignedResearcherPercentagePoints = finiteOr(
    programme.assignedResearcherPercentagePoints,
    0,
  );
  const diffusionPercentagePoints = finiteOr(programme.diffusion?.percentagePoints, 0);
  const fallbackTotalMultiplier = finiteOr(programme.researchOutputMultiplier, 1);
  const totalMultiplier = finiteOr(ledger?.totalMultiplier, fallbackTotalMultiplier);
  const leadPercentagePoints = finiteOr(
    ledger?.leadPercentagePoints,
    assignedResearcherPercentagePoints,
  );
  const ledgerDiffusionPercentagePoints = finiteOr(
    ledger?.diffusionPercentagePoints,
    diffusionPercentagePoints,
  );
  const lines = ledger?.lines ?? [];
  const leadLines = lines.filter((line) => line.group === "lead");
  const diffusionLines = lines.filter((line) => line.group === "diffusion");
  const effectLines = lines.filter((line) => line.group === "effect");
  const otherEffectCount = finiteOr(ledger?.otherEffectCount, effectLines.length);
  const startingMultiplier =
    1 + (leadPercentagePoints + ledgerDiffusionPercentagePoints) / 100;
  const otherEffectsMultiplier =
    startingMultiplier <= 0 ? totalMultiplier : totalMultiplier / startingMultiplier;
  const totalBonusLabel = signedPercent((totalMultiplier - 1) * 100);
  const leadLabel = signedPercent(leadPercentagePoints);
  const diffusionLabel = signedPercent(ledgerDiffusionPercentagePoints);
  const sourceCount = lines.length;
  const groups = [
    {
      id: "lead",
      label: "Programme lead",
      total: leadLabel,
      lines: leadLines,
    },
    {
      id: "diffusion",
      label: "Knowledge diffusion",
      total: diffusionLabel,
      lines: diffusionLines,
    },
    {
      id: "effect",
      label: "Other bonuses & penalties",
      total: signedPercent((otherEffectsMultiplier - 1) * 100),
      lines: effectLines,
    },
  ] as const;

  return (
    <details className="programme-output-ledger">
      <summary>
        <span className="programme-output-ledger-title">
          <small>PROGRAMME OUTPUT</small>
          <strong>
            <b>{totalBonusLabel}</b> research output
          </strong>
          <span>
            Lead {leadLabel} · diffusion {diffusionLabel} · {otherEffectCount} other{" "}
            {otherEffectCount === 1 ? "effect" : "effects"}
          </span>
        </span>
        <span className="programme-output-ledger-cue">
          <strong>
            {sourceCount} {sourceCount === 1 ? "source" : "sources"}
          </strong>
          <small>{ledger === undefined ? "Refresh for details" : "View breakdown"}</small>
        </span>
      </summary>

      <div className="programme-output-ledger-body">
        <p>Visible modifiers behind the programme-output total.</p>

        {ledger === undefined ? (
          <p className="programme-output-ledger-legacy">
            Detailed sources will appear after one page refresh; the running game is still
            using the pre-update display projection.
          </p>
        ) : sourceCount === 0 ? (
          <p className="programme-output-ledger-empty">
            No lead, diffusion, or other programme-output effects are active.
          </p>
        ) : (
          <div className="programme-output-ledger-groups">
            {groups.map((group) =>
              group.lines.length === 0 ? null : (
                <section key={group.id}>
                  <header>
                    <strong>{group.label}</strong>
                    <span>{group.total}</span>
                  </header>
                  <ul>
                    {group.lines.map((line, index) => (
                      <li
                        className={line.tone}
                        key={`${group.id}:${line.sourceLabel}:${line.effectLabel}:${String(index)}`}
                      >
                        <span>
                          <strong>{line.sourceLabel}</strong>
                          <small>
                            {line.sourceKind}
                            {line.remainingWeeks === undefined
                              ? ""
                              : ` · ${String(line.remainingWeeks)} weeks remaining`}
                          </small>
                          <em>{line.explanation}</em>
                        </span>
                        <b>{line.effectLabel}</b>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}

        <footer>
          <span>
            Lead skill and diffusion add to the starting multiplier; the remaining effects
            then apply in simulation order.
          </span>
          <strong>Canonical total {totalBonusLabel}</strong>
        </footer>
      </div>
    </details>
  );
}

export function RealWorldResearcherCredits({
  paper,
}: {
  readonly paper: Pick<ResearchPaperView, "realWorldResearcherCredits">;
  readonly onInspectResearcher: InspectPaperResearcher;
}): ReactElement | null {
  if (paper.realWorldResearcherCredits.length === 0) return null;
  return (
    <aside
      className="paper-real-world-researchers"
      aria-label="Real-world authors represented in the star-researcher roster"
    >
      <strong>REAL-WORLD AUTHORS IN THE STAR ROSTER</strong>
      <ul>
        {paper.realWorldResearcherCredits.map((credit) => (
          <li key={credit.definitionId}>
            <b>{credit.inspirationName}</b>
            <span> inspired the fictional character {credit.displayName}</span>
          </li>
        ))}
      </ul>
      <small>
        This is real publication authorship. The paper’s in-game discovery history is
        fictional.
      </small>
    </aside>
  );
}

function PublicationActions({
  paper,
  runtime,
  view,
  onPublicationChosen,
}: {
  readonly paper: ResearchPaperView;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onPublicationChosen?: (() => void) | undefined;
}): ReactElement {
  return (
    <div
      className="publication-actions"
      aria-label={`Publication policy for ${paper.title}`}
    >
      <strong>Choose one: publish the result or keep it inside the lab</strong>
      <div>
        {PUBLICATION_POLICIES.map((policy) => {
          const validation = runtime.validate(
            publicationPolicyCommand(view, paper.paperId, policy.value),
          );
          const validationMessage = validation.ok
            ? validation.preview.summary
            : validation.errors.map((error) => error.message).join(" · ");
          const outcomeLines =
            policy.value === "publish-openly"
              ? [
                  `+${String(paper.baseAuraAward ?? 0)} Aura · +${(paper.publicationScoreAward ?? 0).toLocaleString("en-US")} scientific-legacy score`,
                  ...paper.unlockLabels.map((unlock) => `Every lab receives ${unlock}`),
                  "Prerequisites unlock globally · no rediscovery",
                ]
              : [
                  "No Aura or scientific-legacy score",
                  ...paper.unlockLabels.map(
                    (unlock) => `Exclusive to your lab: ${unlock}`,
                  ),
                  "Rivals must rediscover the result independently",
                ];
          return (
            <article key={policy.value} data-policy={policy.value}>
              <span className="publication-tradeoff">{policy.tradeoff}</span>
              <button
                className="secondary"
                type="button"
                disabled={!validation.ok}
                title={validationMessage}
                onClick={() => {
                  runtime.dispatch(
                    publicationPolicyCommand(view, paper.paperId, policy.value),
                  );
                  onPublicationChosen?.();
                }}
              >
                {policy.label}
              </button>
              {validation.ok ? (
                <ul className="publication-outcomes">
                  {outcomeLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <small>{validationMessage}</small>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function PaperCard({
  paper,
  pendingPublication,
  runtime,
  view,
  onPublicationChosen,
  onInspectResearcher,
  expandedEducation = false,
}: {
  readonly paper: ResearchPaperView;
  readonly pendingPublication: boolean;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onPublicationChosen?: () => void;
  readonly onInspectResearcher: InspectPaperResearcher;
  readonly expandedEducation?: boolean;
}): ReactElement {
  const rewardSummary = paperRewardSummary(paper);
  return (
    <article
      className={`paper-card${paper.playerHasDiscovered ? " player-discovered" : ""}`}
    >
      <header>
        <div>
          <p className="eyebrow">
            {paper.worldFirst
              ? "YOUR LAB · WORLD-FIRST"
              : paper.playerHasDiscovered
                ? `YOUR LAB · REDISCOVERED // ${paper.discovererLabName.toUpperCase()} · WORLD-FIRST`
                : `${paper.discovererLabName.toUpperCase()} · PUBLISHED FOR EVERY LAB`}
          </p>
          <h3>{paper.title}</h3>
        </div>
        <div className="paper-card-badges">
          {paper.playerHasDiscovered ? (
            <span className="paper-ownership">OUR LAB</span>
          ) : null}
          {paper.fictionalLabel === undefined ? (
            <span className="paper-reality real">REAL PAPER</span>
          ) : (
            <span className="paper-reality fictional">{paper.fictionalLabel}</span>
          )}
        </div>
      </header>
      <p className="paper-byline">
        {paper.authors.join(", ")}
        {paper.publicationYear === undefined ? "" : ` · ${String(paper.publicationYear)}`}
        {paper.venue === undefined ? "" : ` · ${paper.venue}`}
      </p>
      <RealWorldResearcherCredits
        paper={paper}
        onInspectResearcher={onInspectResearcher}
      />
      <p>{paper.playerSummary}</p>
      {paper.playerKnowsPaper ? (
        <div className="paper-reward-summary">
          <strong>{rewardSummary.headline}</strong>
          <span>{rewardSummary.detail}</span>
          {paper.unlockLabels.length === 0 ? null : (
            <ul>
              {paper.unlockLabels.map((unlock) => (
                <li key={unlock}>{unlock}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <details open={expandedEducation}>
        <summary>Why it matters</summary>
        <p>{paper.archiveExplanation}</p>
        <p className="inside-baseball">Inside baseball: {paper.insideBaseball}</p>
      </details>
      <footer>
        {paper.primarySourceUrl === undefined ? null : (
          <a href={paper.primarySourceUrl} target="_blank" rel="noopener noreferrer">
            Open primary source · {paper.sourceDomain ?? "external site"}
          </a>
        )}
        {paper.publicationPolicy === undefined ? null : (
          <span>Policy: {formatPolicy(paper.publicationPolicy)}</span>
        )}
      </footer>
      {!pendingPublication ? null : (
        <PublicationActions
          paper={paper}
          runtime={runtime}
          view={view}
          onPublicationChosen={onPublicationChosen}
        />
      )}
    </article>
  );
}

function paperRewardSummary(paper: ResearchPaperView): {
  readonly headline: string;
  readonly detail: string;
} {
  if (paper.worldFirst) {
    if (paper.publicationPolicy === undefined) {
      return {
        headline:
          "World-first: scientific effects active locally · prestige decision pending",
        detail: `Publishing offers up to ${String(paper.baseAuraAward ?? 0)} base Aura and shares every effect immediately; secrecy awards none and preserves the lead.`,
      };
    }
    if (paper.publicationPolicy === "keep-secret") {
      return {
        headline:
          "Kept secret: scientific effects remain exclusive · no publication prestige",
        detail: `Prestige was resolved under ${formatPolicy(paper.publicationPolicy)}.`,
      };
    }
    return {
      headline: `Published world-first: +${String(paper.discoveryScoreAward ?? 0)} scientific-legacy score · +${String(paper.auraAward ?? 0)} Aura`,
      detail: `Prestige was resolved under ${formatPolicy(paper.publicationPolicy)}.`,
    };
  }
  if (paper.playerHasDiscovered) {
    return {
      headline: `Independent rediscovery: +${String(paper.discoveryScoreAward ?? 0)} score · +${String(paper.auraAward ?? 0)} Aura`,
      detail:
        "The original result was private. Your lab receives every scientific effect, but no publication choice and only 20% rediscovery credit.",
    };
  }
  return {
    headline: `Published by ${paper.discovererLabName}: scientific effects active for every lab`,
    detail:
      "No rediscovery is required: publication satisfies its prerequisites and grants its listed effects immediately.",
  };
}

export function PaperDossierDialog({
  paper,
  runtime,
  view,
  onClose,
  onOpenResearch,
  onInspectResearcher,
}: {
  readonly paper: ResearchPaperView;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onClose: () => void;
  readonly onOpenResearch: () => void;
  readonly onInspectResearcher: InspectPaperResearcher;
}): ReactElement {
  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog paper-dossier-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`paper-dossier-${paper.paperId}`}
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">LANDMARK PAPER // DOSSIER</p>
            <h2 id={`paper-dossier-${paper.paperId}`}>About this paper</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close paper dossier"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <PaperCard
          paper={paper}
          pendingPublication={view.research.pendingPublicationPaperIds.includes(
            paper.paperId,
          )}
          runtime={runtime}
          view={view}
          onPublicationChosen={onClose}
          onInspectResearcher={onInspectResearcher}
          expandedEducation
        />
        <footer className="paper-dossier-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Back to lab
          </button>
          <button className="primary" type="button" onClick={onOpenResearch}>
            Open Research
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PaperDiscoveryDialog({
  paper,
  runtime,
  view,
  onAcknowledge,
  onPublicationChosen,
  onInspectResearcher,
}: {
  readonly paper: ResearchPaperView;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onAcknowledge: () => void;
  readonly onPublicationChosen: () => void;
  readonly onInspectResearcher: InspectPaperResearcher;
}): ReactElement {
  const pendingPublication = view.research.pendingPublicationPaperIds.includes(
    paper.paperId,
  );
  const scoreAward = paper.discoveryScoreAward ?? 0;
  const baseAuraAward = paper.baseAuraAward ?? 0;
  return (
    <div className="modal-backdrop discovery-backdrop">
      <section
        className="discovery-dialog paper-discovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`paper-discovery-${paper.paperId}`}
      >
        <header className="paper-discovery-hero">
          <div>
            <p className="eyebrow">
              {paper.worldFirst
                ? "LAB-WIDE BREAKTHROUGH // WORLD FIRST // TIME PAUSED"
                : "INDEPENDENT REDISCOVERY // TIME PAUSED"}
            </p>
            <h2 id={`paper-discovery-${paper.paperId}`}>{paper.title}</h2>
            <p className="paper-byline">
              {paper.authors.join(", ")}
              {paper.publicationYear === undefined
                ? ""
                : ` · ${String(paper.publicationYear)}`}
              {paper.venue === undefined ? "" : ` · ${paper.venue}`}
            </p>
          </div>
          <span
            className={`paper-reality ${paper.historicity === "real" ? "real" : "fictional"}`}
          >
            {paper.fictionalLabel ?? "REAL PAPER"}
          </span>
        </header>

        <RealWorldResearcherCredits
          paper={paper}
          onInspectResearcher={onInspectResearcher}
        />
        <p className="paper-discovery-summary">{paper.playerSummary}</p>

        <section className="paper-discovery-rewards" aria-label="Discovery rewards">
          <article>
            <span>RUN SCORE</span>
            <strong>
              {pendingPublication ? "PENDING" : `+${scoreAward.toLocaleString("en-US")}`}
            </strong>
            <small>
              {pendingPublication
                ? "Publish for the full world-first award"
                : "Independent rediscovery"}
            </small>
          </article>
          <article>
            <span>SPENDABLE AURA</span>
            <strong>
              {paper.worldFirst
                ? `${String(baseAuraAward)} base`
                : `+${String(paper.auraAward ?? 0)}`}
            </strong>
            <small>
              {paper.worldFirst
                ? "Publish for prestige; secrecy awards none"
                : "Rediscovery earns reduced prestige automatically"}
            </small>
          </article>
          <article>
            <span>DIRECT GAME EFFECTS</span>
            <strong>
              {paper.unlockLabels.length === 0
                ? "None"
                : `${String(paper.unlockLabels.length)} change${paper.unlockLabels.length === 1 ? "" : "s"}`}
            </strong>
            <small>
              {paper.unlockLabels.length === 0
                ? "The discovery still advances science and score"
                : `${paper.unlockLabels[0]}${paper.unlockLabels.length > 1 ? ` · +${String(paper.unlockLabels.length - 1)} more below` : ""}`}
            </small>
          </article>
          <article>
            <span>DISCOVERY STATUS</span>
            <strong className="paper-discovery-status-value">
              {paper.worldFirst ? "FIRST" : "REDISCOVERED"}
            </strong>
            <small>
              {paper.worldFirst
                ? "Your lab writes this alternate history"
                : "Your lab independently reproduced the result"}
            </small>
          </article>
        </section>

        {paper.unlockLabels.length === 0 ? null : (
          <section className="paper-discovery-unlocks">
            <strong>Already active in your lab · permanent game effects</strong>
            <ul>
              {paper.unlockLabels.map((unlock) => (
                <li key={unlock}>{unlock}</li>
              ))}
            </ul>
          </section>
        )}

        <article className="paper-discovery-education">
          <section>
            <p className="eyebrow">WHY THIS PAPER MATTERS</p>
            <p>{paper.archiveExplanation}</p>
          </section>
          <section>
            <p className="eyebrow">FOR THE AI PEOPLE</p>
            <p>{paper.insideBaseball}</p>
          </section>
        </article>

        {paper.primarySourceUrl === undefined ? null : (
          <a
            className="paper-primary-source"
            href={paper.primarySourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the real paper ↗<small>{paper.sourceDomain ?? "Primary source"}</small>
          </a>
        )}

        {pendingPublication ? (
          <section className="paper-discovery-publication">
            <header>
              <p className="eyebrow">PUBLICATION DECISION REQUIRED</p>
              <h3>Publish it, or preserve the technical lead?</h3>
            </header>
            <PublicationActions
              paper={paper}
              runtime={runtime}
              view={view}
              onPublicationChosen={onPublicationChosen}
            />
          </section>
        ) : (
          <p className="paper-rediscovery-note">
            Rediscovery grants science and score but no publication-policy choice:{" "}
            {paper.discovererLabName} already established the world-first result, but
            chose to keep it secret.
          </p>
        )}

        {!pendingPublication ? (
          <footer className="paper-discovery-actions">
            <button className="primary" type="button" onClick={onAcknowledge}>
              Acknowledge discovery
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

export function ResearchDirectionDialog({
  advance,
  pendingCount,
  runtime,
  view,
}: {
  readonly advance: GameView["research"]["pendingGenericAdvances"][number];
  readonly pendingCount: number;
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
}): ReactElement {
  const [error, setError] = useState<string>();
  const titleId = `research-direction-${advance.programId}-${String(advance.threshold)}`;

  return (
    <div className="modal-backdrop research-direction-backdrop">
      <section
        className="research-direction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <p className="eyebrow">
              RESEARCH BRANCH // PERMANENT LAB SPECIALISATION // TIME PAUSED
            </p>
            <h2 id={titleId}>{advance.programName} reached a branching point</h2>
          </div>
          <span>
            LEVEL {advance.threshold} · DECISION 1 OF {pendingCount}
          </span>
        </header>

        <p className="research-direction-intro">
          Choose one permanent specialisation before time advances.
        </p>

        <div className="research-direction-options">
          {advance.options.map((option, index) => {
            const command = genericAdvanceCommand(
              view,
              advance.programId,
              advance.threshold,
              option.optionId,
            );
            const validation = runtime.validate(command);
            return (
              <article key={option.optionId}>
                <p className="eyebrow">PATH {String.fromCharCode(65 + index)}</p>
                <h3>{option.name}</h3>
                <p>{option.description}</p>
                <div className="research-direction-benefit">
                  <span>PERMANENT EFFECT</span>
                  {option.effectLabels.length === 0 ? (
                    <strong>Opens a new research specialisation</strong>
                  ) : (
                    <ul>
                      {option.effectLabels.map((effect) => (
                        <li key={effect}>{effect}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {!validation.ok ? (
                  <p className="validation-error">
                    {validation.errors.map((item) => item.message).join(" · ")}
                  </p>
                ) : null}
                <button
                  className="primary"
                  type="button"
                  autoFocus={index === 0}
                  disabled={!validation.ok}
                  onClick={() => {
                    try {
                      runtime.dispatch(command);
                      setError(undefined);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                  }}
                >
                  Choose {option.name}
                </button>
              </article>
            );
          })}
        </div>

        {error === undefined ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {pendingCount > 1 ? (
            <strong>
              {pendingCount - 1} more research decision
              {pendingCount - 1 === 1 ? "" : "s"} will follow.
            </strong>
          ) : (
            <strong>After choosing, use Resume time when you are ready.</strong>
          )}
          <span>This decision cannot be deferred while the simulation runs.</span>
        </footer>
      </section>
    </div>
  );
}

function ResearchTechTree({
  runtime,
  view,
  onInspectResearcher,
  onInspectProgrammeLead,
  onOpenPeople,
  onOpenCompute,
}: {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onInspectResearcher: InspectPaperResearcher;
  readonly onInspectProgrammeLead: (researcherId: string) => void;
  readonly onOpenPeople: () => void;
  readonly onOpenCompute: () => void;
}): ReactElement {
  const safetyResearchUnlocked = view.meta.labMaturity?.safetyResearchUnlocked !== false;
  const visibleProgrammes = view.research.techTree.programmes.filter(
    (programme) => programme.kind === "capability" || safetyResearchUnlocked,
  );
  const [selectedProgramId, setSelectedProgramId] = useState(
    visibleProgrammes[0]?.programId ?? "",
  );
  const [selectedPaperId, setSelectedPaperId] = useState<string>();
  const [allocationMessage, setAllocationMessage] = useState<string>();
  const researchAllocation = useResearchAllocation({
    runtime,
    view,
    servingBasisPoints:
      view.compute.queuedAllocation?.servingFleetShareBasisPoints ??
      view.compute.allocation.serving.basisPoints,
  });
  const committedCapabilityWeights =
    view.compute.queuedAllocation?.capabilityDomainWeights ??
    Object.fromEntries(
      view.compute.allocation.capabilityPrograms.map((programme) => [
        programme.id,
        programme.basisPoints,
      ]),
    );
  const committedSafetyWeights =
    view.compute.queuedAllocation?.safetyProgramWeights ??
    Object.fromEntries(
      view.compute.allocation.safetyPrograms.map((programme) => [
        programme.id,
        programme.basisPoints,
      ]),
    );
  const strongestCapabilityTrail = [...view.research.capabilityDomains].sort(
    (left, right) => right.weeklyMomentum - left.weeklyMomentum,
  )[0];
  const fundedCapabilityProgrammes = view.research.capabilityDomains.filter(
    (programme) => programme.isFunded,
  ).length;
  const selectedProgramme =
    visibleProgrammes.find((programme) => programme.programId === selectedProgramId) ??
    visibleProgrammes[0];
  const connectedPapers =
    selectedProgramme === undefined
      ? []
      : view.research.techTree.papers.filter(
          (paper) => paper.primaryDomainId === selectedProgramme.programId,
        );
  const paperStatusCounts = connectedPapers.reduce<
    Record<(typeof connectedPapers)[number]["status"], number>
  >(
    (counts, paper) => ({
      ...counts,
      [paper.status]: counts[paper.status] + 1,
    }),
    { discovered: 0, published: 0, available: 0, rediscovery: 0, locked: 0 },
  );
  const selectedPaper =
    connectedPapers.find((paper) => paper.paperId === selectedPaperId) ??
    connectedPapers.find(
      (paper) =>
        paper.status === "available" ||
        paper.status === "rediscovery" ||
        paper.status === "published" ||
        paper.status === "discovered",
    ) ??
    connectedPapers[0];
  const selectedPaperRecord =
    selectedPaper === undefined
      ? undefined
      : view.research.papers.find((paper) => paper.paperId === selectedPaper.paperId);
  const selectedPaperReward =
    selectedPaperRecord === undefined
      ? undefined
      : paperRewardSummary(selectedPaperRecord);
  const branchMilestone =
    selectedProgramme?.milestones.find((milestone) => milestone.status === "decision") ??
    selectedProgramme?.milestones.find((milestone) => milestone.status === "next");
  const chosenBranchMilestones =
    selectedProgramme?.milestones.filter((milestone) => milestone.status === "chosen") ??
    [];
  const selectedLevelProgress =
    selectedProgramme === undefined
      ? undefined
      : researchLevelProgressPresentation(
          selectedProgramme.level,
          selectedProgramme.momentumLabel,
        );
  const selectedLevelEstimateMinimum = selectedLevelProgress?.estimateRange[0] ?? 0;
  const selectedLevelEstimateMaximum = selectedLevelProgress?.estimateRange[1] ?? 0;

  function programmesFor(kind: "capability" | "safety") {
    return visibleProgrammes.filter((programme) => programme.kind === kind);
  }

  function evenWeights(
    programmeIds: readonly string[],
    totalBasisPoints: number,
  ): Readonly<Record<string, number>> {
    if (programmeIds.length === 0) return {};
    const base = Math.floor(totalBasisPoints / programmeIds.length);
    const remainder = totalBasisPoints - base * programmeIds.length;
    return Object.fromEntries(
      programmeIds.map((programmeId, index) => [
        programmeId,
        base + (index < remainder ? 1 : 0),
      ]),
    );
  }

  function postureWeights(
    kind: "capability" | "safety",
    posture: "balanced" | "focused",
    focusedProgrammeId?: string,
  ): Readonly<Record<string, number>> {
    const programmeIds = programmesFor(kind).map((programme) => programme.programId);
    if (posture === "balanced" || programmeIds.length <= 1) {
      return evenWeights(programmeIds, 10_000);
    }
    const focus =
      focusedProgrammeId !== undefined && programmeIds.includes(focusedProgrammeId)
        ? focusedProgrammeId
        : programmeIds[0];
    if (focus === undefined) return {};
    const otherProgrammeIds = programmeIds.filter((programmeId) => programmeId !== focus);
    return {
      ...evenWeights(otherProgrammeIds, 5_000),
      [focus]: 5_000,
    };
  }

  function committedWeights(
    kind: "capability" | "safety",
  ): Readonly<Record<string, number>> {
    return kind === "capability" ? committedCapabilityWeights : committedSafetyWeights;
  }

  function focusedProgrammeId(kind: "capability" | "safety"): string | undefined {
    return programmesFor(kind)
      .map((programme, index) => ({
        index,
        programmeId: programme.programId,
        weight: committedWeights(kind)[programme.programId] ?? 0,
      }))
      .sort((left, right) => right.weight - left.weight || left.index - right.index)[0]
      ?.programmeId;
  }

  function currentPosture(kind: "capability" | "safety"): "balanced" | "focused" {
    const programmeIds = programmesFor(kind).map((programme) => programme.programId);
    const weights = programmeIds.map(
      (programmeId) => committedWeights(kind)[programmeId] ?? 0,
    );
    const isBalanced =
      weights.reduce((total, weight) => total + weight, 0) === 10_000 &&
      Math.max(...weights) - Math.min(...weights) <= 1;
    return isBalanced ? "balanced" : "focused";
  }

  const [postureDrafts, setPostureDrafts] = useState<{
    capability: {
      posture: "balanced" | "focused";
      focusedProgrammeId: string;
    };
    safety: {
      posture: "balanced" | "focused";
      focusedProgrammeId: string;
    };
  }>(() => ({
    capability: {
      posture: currentPosture("capability"),
      focusedProgrammeId: focusedProgrammeId("capability") ?? "",
    },
    safety: {
      posture: currentPosture("safety"),
      focusedProgrammeId: focusedProgrammeId("safety") ?? "",
    },
  }));

  const capabilityDraftWeights = postureWeights(
    "capability",
    postureDrafts.capability.posture,
    postureDrafts.capability.focusedProgrammeId,
  );
  const safetyDraftWeights = safetyResearchUnlocked
    ? postureWeights(
        "safety",
        postureDrafts.safety.posture,
        postureDrafts.safety.focusedProgrammeId,
      )
    : committedSafetyWeights;
  function materiallyDifferentWeights(
    draft: Readonly<Record<string, number>>,
    committed: Readonly<Record<string, number>>,
  ): boolean {
    const programmeIds = new Set([...Object.keys(draft), ...Object.keys(committed)]);
    return [...programmeIds].some(
      (programmeId) =>
        Math.abs((draft[programmeId] ?? 0) - (committed[programmeId] ?? 0)) > 1,
    );
  }
  const hasCapabilityPostureChanges = materiallyDifferentWeights(
    capabilityDraftWeights,
    committedCapabilityWeights,
  );
  const hasSafetyPostureChanges =
    safetyResearchUnlocked &&
    materiallyDifferentWeights(safetyDraftWeights, committedSafetyWeights);
  const hasPostureChanges = hasCapabilityPostureChanges || hasSafetyPostureChanges;

  function draftResearchPosture(
    kind: "capability" | "safety",
    posture: "balanced" | "focused",
    nextFocusedProgrammeId?: string,
  ): void {
    const nextFocus =
      nextFocusedProgrammeId ??
      postureDrafts[kind].focusedProgrammeId ??
      focusedProgrammeId(kind);
    setPostureDrafts((current) => ({
      ...current,
      [kind]: {
        posture,
        focusedProgrammeId: nextFocus ?? "",
      },
    }));
    setAllocationMessage(
      "Research posture changed in draft. Apply it before leaving this page.",
    );
  }

  function applyResearchPosture(): void {
    const queued = view.compute.queuedAllocation;
    const command = allocationCommand(
      view,
      queued?.servingFleetShareBasisPoints ?? view.compute.allocation.serving.basisPoints,
      queued?.capabilityBasisPoints ?? view.compute.allocation.capabilities.basisPoints,
      {
        capabilityDomainWeights: capabilityDraftWeights,
        safetyProgramWeights: safetyDraftWeights,
      },
    );
    const validation = runtime.validate(command);
    if (!validation.ok) {
      setAllocationMessage(
        `Research posture unchanged: ${validation.errors
          .map((error) => error.message)
          .join(" · ")}`,
      );
      return;
    }
    runtime.dispatch(command);
    setAllocationMessage(
      "Research posture confirmed. It will take effect next week, and you can safely leave this page.",
    );
  }

  function allocationShare(programmeId: string, kind: "capability" | "safety"): number {
    const lines =
      kind === "capability"
        ? view.compute.allocation.capabilityPrograms
        : view.compute.allocation.safetyPrograms;
    return (lines.find((line) => line.id === programmeId)?.basisPoints ?? 0) / 100;
  }

  function allocationPool(kind: "capability" | "safety"): number {
    return kind === "capability"
      ? view.compute.allocation.capabilities.teraflops
      : view.compute.allocation.safety.teraflops;
  }

  function researchPostureControl(kind: "capability" | "safety"): ReactElement {
    const matchingProgrammes = programmesFor(kind);
    const posture = postureDrafts[kind].posture;
    const focus =
      postureDrafts[kind].focusedProgrammeId ?? matchingProgrammes[0]?.programId ?? "";
    const hasKindChanges =
      kind === "capability" ? hasCapabilityPostureChanges : hasSafetyPostureChanges;
    return (
      <section className={`research-posture-control ${kind}`}>
        <header>
          <div>
            <strong>
              {kind === "capability" ? "Capability research" : "Safety research"}
            </strong>
            <small>
              {kind === "capability"
                ? "Raises future model capability."
                : "Improves model safety, evidence, and defence."}
            </small>
          </div>
          <span>{formatTeraflops(allocationPool(kind))} available</span>
        </header>
        <div
          className="research-posture-choice"
          role="group"
          aria-label={`${kind} research posture`}
        >
          <button
            type="button"
            aria-pressed={posture === "balanced"}
            onClick={() => draftResearchPosture(kind, "balanced")}
          >
            <strong>Balanced</strong>
            <span>Even split</span>
          </button>
          <button
            type="button"
            aria-pressed={posture === "focused"}
            onClick={() => draftResearchPosture(kind, "focused", focus)}
          >
            <strong>Focused</strong>
            <span>50% to one programme</span>
          </button>
        </div>
        {posture === "focused" ? (
          <label className="research-focus-programme">
            <span>Focus programme</span>
            <select
              value={focus}
              onChange={(event) =>
                draftResearchPosture(kind, "focused", event.target.value)
              }
            >
              {matchingProgrammes.map((programme) => (
                <option key={programme.programId} value={programme.programId}>
                  {programme.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {hasKindChanges ? (
          <div className="research-posture-inline-action">
            <span>UNAPPLIED CHANGE</span>
            <button className="primary" type="button" onClick={applyResearchPosture}>
              Apply research posture
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="console-panel research-tech-tree"
      aria-labelledby="tech-tree-title"
    >
      <header className="panel-heading">
        <div>
          <p className="eyebrow">RESEARCH DIRECTORATE // PORTFOLIO & KNOWN PATHS</p>
          <h2 id="tech-tree-title">Research command centre</h2>
        </div>
      </header>

      <ResearchAllocationControl
        compact
        capabilityBasisPoints={researchAllocation.capabilityBasisPoints}
        capabilityTeraflops={researchAllocation.capabilityTeraflops}
        safetyTeraflops={researchAllocation.safetyTeraflops}
        isDraft={researchAllocation.isDraft}
        isPending={researchAllocation.isPending}
        message={researchAllocation.message}
        onChange={researchAllocation.setCapabilityBasisPoints}
        onCommit={(nextCapabilities) => researchAllocation.commit(nextCapabilities)}
        onOpenFullAllocation={onOpenCompute}
        capabilityOnly={!safetyResearchUnlocked}
      />

      <div className="research-level-flow" aria-label="How research levels increase">
        <span>
          <small>1 · INVEST</small>
          <strong>Allocate R&amp;D FLOP/s</strong>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <small>2 · RESEARCH</small>
          <strong>Build progress each week</strong>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <small>3 · ADVANCE</small>
          <strong>Raise the field level</strong>
        </span>
      </div>

      <div className="research-command-summary" aria-label="Research summary">
        <article>
          <span>MEANINGFULLY FUNDED</span>
          <strong>
            {String(fundedCapabilityProgrammes)} capability programme
            {fundedCapabilityProgrammes === 1 ? "" : "s"}
          </strong>
        </article>
        <article>
          <span>STRONGEST CURRENT TRAIL</span>
          <strong>
            {strongestCapabilityTrail === undefined
              ? "No active capability trail"
              : `${strongestCapabilityTrail.name} · ${strongestCapabilityTrail.momentumLabel}`}
          </strong>
        </article>
        <article>
          <span>LANDMARK RECORD</span>
          <strong>
            {view.research.papers.length} paper
            {view.research.papers.length === 1 ? "" : "s"} discovered worldwide
          </strong>
        </article>
      </div>

      <section
        className="research-portfolio-controls"
        aria-labelledby="research-posture-title"
      >
        <header>
          <div>
            <p className="eyebrow">RESEARCH POSTURE</p>
            <h3 id="research-posture-title">Research posture</h3>
          </div>
          <div className="panel-heading-tools">
            <small>Applies next week</small>
            <MechanicHelp label="Research posture">
              Balanced splits a pool evenly. Focused sends half to one programme and
              divides the rest. Change the capability/safety split on Compute.
            </MechanicHelp>
          </div>
        </header>
        <div className="research-posture-grid">
          {researchPostureControl("capability")}
          {safetyResearchUnlocked ? researchPostureControl("safety") : null}
        </div>
        {hasPostureChanges ? null : (
          <div className="research-posture-status">
            <span>
              {view.compute.queuedAllocation === undefined
                ? "CURRENT POSTURE"
                : "CONFIRMED · TAKES EFFECT NEXT WEEK"}
            </span>
            <strong>
              {view.compute.queuedAllocation === undefined
                ? "Posture up to date"
                : "Posture confirmed"}
            </strong>
          </div>
        )}
        {allocationMessage === undefined ? null : (
          <p className="research-allocation-message" role="status">
            {allocationMessage}
          </p>
        )}
      </section>

      <div className="research-domain-picker" aria-label="Research programmes">
        {(safetyResearchUnlocked
          ? (["capability", "safety"] as const)
          : (["capability"] as const)
        ).map((kind) => {
          const matchingProgrammes = visibleProgrammes.filter(
            (programme) => programme.kind === kind,
          );
          return (
            <section key={kind} className={`research-domain-picker-${kind}`}>
              <header>
                <strong>
                  {kind === "capability" ? "Capability programmes" : "Safety programmes"}
                </strong>
                <span>{matchingProgrammes.length} programmes</span>
              </header>
              <div data-programme-count={matchingProgrammes.length}>
                {matchingProgrammes.map((programme) => {
                  const lead = view.people.roster.find(
                    (researcher) =>
                      researcher.status === "employed" &&
                      researcher.assignment?.role === "lead" &&
                      researcher.assignment.kind ===
                        (programme.kind === "capability"
                          ? "capability-program"
                          : "safety-program") &&
                      researcher.assignment.targetId === programme.programId,
                  );
                  return (
                    <ResearchProgrammeCard
                      key={programme.programId}
                      programme={programme}
                      allocationSharePercent={allocationShare(programme.programId, kind)}
                      selected={programme.programId === selectedProgramme?.programId}
                      {...(lead === undefined ? {} : { lead })}
                      onSelect={() => setSelectedProgramId(programme.programId)}
                      onInspectLead={onInspectProgrammeLead}
                      onOpenPeople={onOpenPeople}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {selectedProgramme === undefined ? (
        <p className="empty-state">No research programmes are available.</p>
      ) : (
        <>
          <article
            className="research-tree-programme-summary"
            style={
              {
                "--programme-colour": selectedProgramme.colour,
              } as CSSProperties
            }
          >
            <div>
              <p className="eyebrow">
                {selectedProgramme.kind === "capability"
                  ? "CAPABILITY PROGRAMME"
                  : "SAFETY PROGRAMME"}
              </p>
              <h3>{selectedProgramme.name}</h3>
              <p>{selectedProgramme.description}</p>
            </div>
            <dl>
              <div>
                <dt>LEVEL</dt>
                <dd className="research-selected-level">
                  {selectedProgramme.level} <small>/ 100</small>
                </dd>
                <small>{selectedLevelProgress?.label}</small>
                <span
                  className={`research-level-stat-progress${selectedLevelProgress?.complete === true ? " complete" : ""}`}
                  role="img"
                  aria-label={`${selectedProgramme.name}: ${selectedLevelProgress?.ariaValueText ?? "progress unavailable"}`}
                >
                  <i
                    style={{
                      left:
                        selectedLevelProgress?.complete === true
                          ? "0%"
                          : `${String(selectedLevelEstimateMinimum)}%`,
                      width:
                        selectedLevelProgress?.complete === true
                          ? "100%"
                          : `${String(selectedLevelEstimateMaximum - selectedLevelEstimateMinimum)}%`,
                    }}
                  />
                </span>
              </div>
              <div>
                <dt>MOMENTUM</dt>
                <dd>{selectedProgramme.momentumLabel}</dd>
              </div>
              <div>
                <dt>RESEARCH COMPUTE</dt>
                <dd>{selectedProgramme.allocationLabel}</dd>
                <small>Feeds weekly level progress</small>
              </div>
            </dl>
            <ProgrammeOutputLedger programme={selectedProgramme} />
            <div
              className="research-tree-level-track"
              role="img"
              aria-label={`${selectedProgramme.name}: Level ${String(
                selectedProgramme.level,
              )} of 100 completed; specialisation milestones every twenty levels`}
            >
              <span
                className="research-tree-level-completed"
                style={{
                  width: `${String(selectedProgramme.level)}%`,
                }}
              />
              {selectedProgramme.milestones.map((milestone) => (
                <i
                  key={milestone.threshold}
                  style={{ left: `${String(milestone.threshold)}%` }}
                  title={`Level ${String(milestone.threshold)} branch`}
                />
              ))}
            </div>
          </article>

          <div className="research-branch-tree">
            <header className="research-branch-overview">
              <div>
                <p className="eyebrow">RECURRING SPECIALISATION</p>
                <h4>One permanent choice every twenty levels</h4>
              </div>
              <dl>
                <div>
                  <dt>CHOSEN</dt>
                  <dd>
                    {chosenBranchMilestones.length} /{" "}
                    {selectedProgramme.milestones.length}
                  </dd>
                </div>
                <div>
                  <dt>NEXT CHECKPOINT</dt>
                  <dd>
                    {branchMilestone === undefined
                      ? "Complete"
                      : `Level ${String(branchMilestone.threshold)}`}
                  </dd>
                </div>
              </dl>
            </header>

            <div
              className="research-branch-cadence"
              aria-label="Twenty-level specialisation checkpoints"
            >
              {selectedProgramme.milestones.map((milestone) => {
                const chosenOption = milestone.options.find(
                  (option) => option.status === "chosen",
                );
                return (
                  <article
                    key={milestone.threshold}
                    className={milestone.status}
                    title={
                      chosenOption === undefined
                        ? `Level ${String(milestone.threshold)}: ${milestone.status}`
                        : `Level ${String(milestone.threshold)}: ${chosenOption.name}`
                    }
                  >
                    <strong>{milestone.threshold}</strong>
                    <span>
                      {chosenOption === undefined
                        ? milestone.status === "decision"
                          ? "DECIDE"
                          : milestone.status === "next"
                            ? "NEXT"
                            : "LOCKED"
                        : "CHOSEN"}
                    </span>
                  </article>
                );
              })}
            </div>

            {branchMilestone === undefined ? (
              <div className="research-branch-complete">
                <strong>Programme specialisation complete.</strong>
                <p>All five permanent upgrade checkpoints have been resolved.</p>
              </div>
            ) : (
              <section className={`research-next-branch ${branchMilestone.status}`}>
                <header>
                  <div>
                    <span>
                      {branchMilestone.status === "decision"
                        ? "DECISION REQUIRED"
                        : "UPCOMING CHOICE"}
                    </span>
                    <h4>Level {branchMilestone.threshold} specialisation</h4>
                  </div>
                  <small>
                    {branchMilestone.status === "decision"
                      ? "Time remains paused until this is resolved."
                      : `${String(Math.max(0, branchMilestone.threshold - selectedProgramme.level))} programme levels away`}
                  </small>
                </header>
                <div>
                  {branchMilestone.options.map((option) => (
                    <article key={option.optionId} className={option.status}>
                      <span aria-hidden="true">◇</span>
                      <div>
                        <h5>{option.name}</h5>
                        <p>{option.description}</p>
                        <strong>
                          {option.effectLabels.length === 0
                            ? "Opens a new specialisation"
                            : option.effectLabels.join(" · ")}
                        </strong>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {chosenBranchMilestones.length === 0 ? null : (
              <details className="research-branch-history">
                <summary>
                  Previous branch decisions ({chosenBranchMilestones.length})
                </summary>
                <div>
                  {chosenBranchMilestones.map((milestone) => {
                    const option = milestone.options.find(
                      (candidate) => candidate.status === "chosen",
                    );
                    if (option === undefined) return null;
                    return (
                      <article key={milestone.threshold}>
                        <span>LEVEL {milestone.threshold}</span>
                        <strong>{option.name}</strong>
                        <small>{option.effectLabels.join(" · ")}</small>
                      </article>
                    );
                  })}
                </div>
              </details>
            )}
          </div>

          <div className="research-paper-tree">
            <header className="research-paper-tree-heading">
              <div className="research-paper-tree-title">
                <p className="eyebrow">LANDMARK PAPERS</p>
                <h4>{selectedProgramme.name}</h4>
              </div>
              <div className="research-paper-statuses">
                <span className="tree-status discovered">
                  {paperStatusCounts.discovered} discovered
                </span>
                <span className="tree-status published">
                  {paperStatusCounts.published} public
                </span>
                <span className="tree-status available">
                  {paperStatusCounts.available} available
                </span>
                <span className="tree-status rediscovery">
                  {paperStatusCounts.rediscovery} rediscoverable
                </span>
                <span className="tree-status locked">
                  {paperStatusCounts.locked} locked
                </span>
              </div>
              <small>Breakthrough timing is uncertain.</small>
            </header>
            {selectedPaper === undefined ? (
              <p className="empty-state">No landmark papers on this programme.</p>
            ) : (
              <div className="research-paper-browser">
                <div className="research-paper-index">
                  <nav aria-label={`${selectedProgramme.name} landmark papers`}>
                    {(["foundation", "scaling", "frontier"] as const).map((phase) => {
                      const phasePapers = connectedPapers.filter(
                        (paper) => paper.phase === phase,
                      );
                      if (phasePapers.length === 0) return null;
                      return (
                        <section key={phase}>
                          <header>
                            <span>{phase.toUpperCase()}</span>
                            <small>{phasePapers.length}</small>
                          </header>
                          <div>
                            {phasePapers.map((paper) => (
                              <button
                                key={paper.paperId}
                                type="button"
                                className={paper.status}
                                aria-pressed={paper.paperId === selectedPaper.paperId}
                                onClick={() => setSelectedPaperId(paper.paperId)}
                              >
                                <span>{paper.statusLabel}</span>
                                <strong>{paper.title}</strong>
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </nav>
                </div>
                <article
                  className={`research-paper-inspector ${selectedPaper.status}`}
                  style={
                    {
                      "--paper-domain-colour": selectedPaper.colour,
                    } as CSSProperties
                  }
                >
                  <header>
                    <span>{selectedPaper.statusLabel}</span>
                    <i>
                      {selectedPaper.historicity === "real"
                        ? "REAL PAPER"
                        : "FICTIONAL FUTURE"}
                    </i>
                  </header>
                  <h4>{selectedPaper.title}</h4>
                  {selectedPaper.worldFirstLabName === undefined ? null : (
                    <p>World first: {selectedPaper.worldFirstLabName}</p>
                  )}
                  <RealWorldResearcherCredits
                    paper={selectedPaper}
                    onInspectResearcher={onInspectResearcher}
                  />
                  {selectedPaper.primarySourceUrl === undefined ? null : (
                    <a
                      className="research-paper-source"
                      href={selectedPaper.primarySourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Read the real paper ↗
                    </a>
                  )}
                  <section className="research-paper-why">
                    <strong>WHY THIS PAPER MATTERS</strong>
                    <p>{selectedPaper.archiveExplanation}</p>
                  </section>
                  {selectedPaperReward === undefined ? null : (
                    <section className="research-paper-discovery-record">
                      <strong>DISCOVERY RECORD</strong>
                      <p>{selectedPaperReward.headline}</p>
                      <small>{selectedPaperReward.detail}</small>
                    </section>
                  )}
                  <section>
                    <strong>PREREQUISITES</strong>
                    <div className="research-paper-requirements">
                      {selectedPaper.requirementLabels.length === 0 ? (
                        <span className="met">No prerequisite papers</span>
                      ) : (
                        selectedPaper.requirementLabels.map((requirement) => (
                          <span
                            key={requirement.label}
                            className={requirement.met ? "met" : "unmet"}
                          >
                            {requirement.met ? "✓" : "○"} {requirement.label}
                          </span>
                        ))
                      )}
                    </div>
                  </section>
                  <section>
                    <strong>DIRECT GAME EFFECTS</strong>
                    {selectedPaper.unlockLabels.length === 0 ? (
                      <p>
                        No direct numerical bonus. The paper still satisfies paper
                        prerequisites once known and can earn discovery prestige.
                      </p>
                    ) : (
                      <ul>
                        {selectedPaper.unlockLabels.map((unlock) => (
                          <li key={unlock}>{unlock}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                </article>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function ResearchWorkspace({
  runtime,
  view,
  onInspectResearcher,
  onInspectProgrammeLead,
  onOpenPeople,
  onOpenCompute,
}: {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onInspectResearcher: InspectPaperResearcher;
  readonly onInspectProgrammeLead: (researcherId: string) => void;
  readonly onOpenPeople: () => void;
  readonly onOpenCompute: () => void;
}): ReactElement {
  return (
    <>
      <ResearchTechTree
        runtime={runtime}
        view={view}
        onInspectResearcher={onInspectResearcher}
        onInspectProgrammeLead={onInspectProgrammeLead}
        onOpenPeople={onOpenPeople}
        onOpenCompute={onOpenCompute}
      />

      {/* TODO(flagship-redesign): the Prosperity Directorate panel is hidden
          for now. Its four programmes accrue readiness passively, which reads
          as unclear busywork. The intended future direction is that the only
          "flagship" work is opt-in, funded AGI-candidate subcomponents (see
          the AGI-candidate-as-major-work plan). The prosperity readiness
          mechanic stays live in state/score until that lands. */}
      {FLAGSHIP_PROGRAMMES_ENABLED && (
        <section
          className="console-panel prosperity-workspace"
          aria-labelledby="prosperity-title"
        >
          <header className="panel-heading">
            <div>
              <p className="eyebrow">PROSPERITY DIRECTORATE</p>
              <h2 id="prosperity-title">Flagship programmes</h2>
            </div>
            <span>60 demonstration · 80 strong outcome</span>
          </header>
          <p className="prosperity-intro">
            Capability is not a benefit plan. Prepare research, facilities, domain
            experts, and precursor discoveries before the Deployment Crisis.
          </p>
          <div className="prosperity-grid">
            {view.prosperity.programmes.map((programme) => (
              <article
                key={programme.id}
                className={programme.unlocked ? "" : "locked"}
                data-status={programme.status}
              >
                <header>
                  <div>
                    <p className="eyebrow">{programme.statusLabel}</p>
                    <h3>{programme.displayName}</h3>
                  </div>
                  <strong>{programme.readinessLabel}</strong>
                </header>
                <p>{programme.description}</p>
                <div
                  className="prosperity-readiness-track"
                  role="meter"
                  aria-label={`${programme.displayName} readiness`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={programme.readiness}
                >
                  <span style={{ width: `${String(programme.readiness)}%` }} />
                  <i style={{ left: "60%" }} aria-hidden="true" />
                  <i style={{ left: "80%" }} aria-hidden="true" />
                </div>
                <dl>
                  {programme.contributions.map((contribution) => (
                    <div key={contribution.id}>
                      <dt>{contribution.label}</dt>
                      <dd>+{contribution.amount}</dd>
                      {contribution.sources.length === 0 ? null : (
                        <small title={contribution.sources.join(" · ")}>
                          {contribution.sources.join(" · ")}
                        </small>
                      )}
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
