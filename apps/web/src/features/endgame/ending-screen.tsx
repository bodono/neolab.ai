import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

import type { HighScoreBoard, HighScoreEntry } from "@neolab/sim/public";
import type { BrowserPostRunAudit, GameView } from "../../runtime/index.ts";
import { FEEDBACK_URL } from "../../runtime/local-diagnostics.ts";
import { AudioControl } from "../../audio/audio-control.tsx";
import { HighScoreBoards } from "../../screens/high-scores-screen.tsx";
import { CreditsRoll } from "./credits-roll.tsx";
import { safeEndingAftermathTimeline } from "./ending-aftermath.ts";
import { FINAL_CONSEQUENCE_DELAY_MS } from "./ending-reveal.ts";

const VICTORY_FIREWORKS = [
  { x: "7%", y: "11%", delay: "0s", colour: "#f6cf72" },
  { x: "24%", y: "7%", delay: "1.4s", colour: "#8be2c1" },
  { x: "43%", y: "17%", delay: "3.1s", colour: "#63b9ff" },
  { x: "63%", y: "9%", delay: "0.6s", colour: "#ff8cc6" },
  { x: "84%", y: "15%", delay: "2.2s", colour: "#ff9b6b" },
  { x: "96%", y: "5%", delay: "4.5s", colour: "#caa8ff" },
  { x: "15%", y: "34%", delay: "3.8s", colour: "#ff8cc6" },
  { x: "34%", y: "43%", delay: "0.9s", colour: "#ff9b6b" },
  { x: "55%", y: "35%", delay: "2.7s", colour: "#f6cf72" },
  { x: "75%", y: "47%", delay: "4.9s", colour: "#8be2c1" },
  { x: "92%", y: "38%", delay: "1.8s", colour: "#63b9ff" },
  { x: "5%", y: "62%", delay: "5.2s", colour: "#63b9ff" },
  { x: "25%", y: "71%", delay: "2.4s", colour: "#caa8ff" },
  { x: "46%", y: "58%", delay: "4.1s", colour: "#8be2c1" },
  { x: "67%", y: "69%", delay: "1.1s", colour: "#f6cf72" },
  { x: "87%", y: "63%", delay: "3.5s", colour: "#ff8cc6" },
  { x: "13%", y: "89%", delay: "2.9s", colour: "#ff9b6b" },
  { x: "38%", y: "84%", delay: "5.5s", colour: "#f6cf72" },
  { x: "61%", y: "91%", delay: "1.9s", colour: "#63b9ff" },
  { x: "82%", y: "86%", delay: "4.4s", colour: "#caa8ff" },
] as const;

function VictoryEndingPrelude(): ReactElement {
  return (
    <main className="ending-resolution-prelude" aria-busy="true">
      <section aria-labelledby="ending-resolution-title">
        <p className="containment-failure-kicker">
          FINAL STATUS // AWAITING INDEPENDENT CONFIRMATION
        </p>
        <h1 id="ending-resolution-title">The world is waiting</h1>
        <p>
          The final decision has been carried out. Institutions, infrastructure, and the
          candidate are responding; the consequences are not yet fully visible.
        </p>
        <div className="containment-consequence-loader" role="status" aria-live="polite">
          <span className="containment-consequence-spinner" aria-hidden="true" />
          <span>
            <strong>RECONCILING THE FINAL RECORD</strong>
            <small>Waiting for independent monitors and public confirmation</small>
          </span>
        </div>
        <div className="containment-consequence-signals" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}

function VictoryFireworks(): ReactElement {
  return (
    <div className="victory-fireworks" aria-hidden="true">
      {VICTORY_FIREWORKS.map((firework) => (
        <span
          className="victory-firework"
          key={`${firework.x}:${firework.y}`}
          style={
            {
              "--firework-x": firework.x,
              "--firework-y": firework.y,
              "--firework-delay": firework.delay,
              "--firework-colour": firework.colour,
            } as CSSProperties
          }
        >
          {Array.from({ length: 16 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  "--firework-angle": `${String(index * 22.5)}deg`,
                  "--firework-distance": `${String(72 + (index % 4) * 18)}px`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function endingVerdict(
  status: GameView["meta"]["status"],
  endingClass: BrowserPostRunAudit["ending"]["endingClass"],
  consequence: BrowserPostRunAudit["ending"]["consequence"],
): string {
  if (status === "won") return "GAME COMPLETE · VICTORY";
  if (consequence === "extinction") return "GAME OVER · HUMAN EXTINCTION";
  if (consequence === "catastrophic-control-loss") {
    return "GAME OVER · CATASTROPHIC LOSS";
  }
  if (consequence === "contained-control-loss") {
    return "GAME OVER · CATASTROPHE AVERTED";
  }
  if (endingClass === "survival") return "GAME OVER · HUMANITY SURVIVES";
  return "GAME OVER · LOSS";
}

function humanOutcome(
  consequence: BrowserPostRunAudit["ending"]["consequence"],
): string | undefined {
  if (consequence === "extinction") {
    return "HUMAN OUTCOME · EXTINCTION · NO SURVIVORS";
  }
  if (consequence === "catastrophic-control-loss") {
    return "HUMAN OUTCOME · HUMANITY SURVIVES · RELIABLE HUMAN CONTROL DOES NOT";
  }
  if (consequence === "contained-control-loss") {
    return "HUMAN OUTCOME · HUMANITY SURVIVES · CONTAINMENT RESTORED";
  }
  return undefined;
}

function humanOutcomeStatement(
  consequence: BrowserPostRunAudit["ending"]["consequence"],
): string | undefined {
  if (consequence === "extinction") {
    return "Humanity is extinct. No humans survive this ending.";
  }
  if (consequence === "catastrophic-control-loss") {
    return "Humanity survives this ending, but the catastrophe permanently ends reliable human control.";
  }
  if (consequence === "contained-control-loss") {
    return "Humanity survives and human control is restored, but the programme is destroyed.";
  }
  return undefined;
}

export function EndingScreen({
  view,
  audit,
  onRestart,
  onHighScores,
  highScoreBoards,
  highScoreBusy,
  highScoreError,
  onDeleteHighScore,
}: {
  readonly view: GameView;
  readonly audit: BrowserPostRunAudit;
  readonly onRestart: () => Promise<string | undefined>;
  readonly onHighScores: () => void;
  readonly highScoreBoards: Readonly<Record<HighScoreBoard, readonly HighScoreEntry[]>>;
  readonly highScoreBusy: boolean;
  readonly highScoreError: string | undefined;
  readonly onDeleteHighScore: (runId: string) => void;
}): ReactElement {
  const isVictory = view.meta.status === "won";
  const [endingReady, setEndingReady] = useState(!isVictory);
  const [section, setSection] = useState<"summary" | "audit" | "high-scores">("summary");
  const [restartArmed, setRestartArmed] = useState(false);
  const screenRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [credits, setCredits] = useState<"closed" | "replay">("closed");
  const outcome = humanOutcome(audit.ending.consequence);
  const outcomeStatement = humanOutcomeStatement(audit.ending.consequence);
  const aftermathTimeline = safeEndingAftermathTimeline(audit.ending.aftermathTimeline);

  useEffect(() => {
    if (!isVictory || endingReady) return undefined;
    const timer = window.setTimeout(() => {
      setEndingReady(true);
    }, FINAL_CONSEQUENCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [endingReady, isVictory]);

  useEffect(() => {
    if (endingReady) screenRef.current?.focus({ preventScroll: true });
  }, [endingReady]);
  function showSection(nextSection: "summary" | "audit" | "high-scores"): void {
    setCredits("closed");
    setSection(nextSection);
    setRestartArmed(false);
    if (nextSection === "high-scores") onHighScores();
    window.requestAnimationFrame(() => {
      contentRef.current?.scrollIntoView({ block: "start" });
    });
  }

  if (!endingReady) {
    return <VictoryEndingPrelude />;
  }

  return (
    <main
      ref={screenRef}
      className={`ending-screen ending-${audit.ending.endingClass} ending-${audit.ending.consequence}`}
      aria-labelledby="ending-title"
      tabIndex={-1}
      data-testid={
        audit.ending.id.endsWith("the-worlds-most-expensive-insolvency")
          ? "insolvency-ending"
          : "ending-screen"
      }
    >
      {isVictory ? <VictoryFireworks /> : null}
      <div className="ending-audio-control">
        <AudioControl />
      </div>
      {credits === "closed" ? null : (
        <CreditsRoll reduceMotion={reduceMotion} onDone={() => setCredits("closed")} />
      )}
      <nav className="ending-navigation" aria-label="End-of-run views">
        <div className="ending-navigation-views">
          <button
            className={section === "summary" && credits === "closed" ? "active" : ""}
            type="button"
            onClick={() => showSection("summary")}
            aria-pressed={section === "summary" && credits === "closed"}
          >
            Run summary
          </button>
          <button
            className={section === "audit" && credits === "closed" ? "active" : ""}
            type="button"
            onClick={() => showSection("audit")}
            aria-pressed={section === "audit" && credits === "closed"}
          >
            What Actually Happened
          </button>
          <button
            className={section === "high-scores" && credits === "closed" ? "active" : ""}
            type="button"
            onClick={() => showSection("high-scores")}
            aria-pressed={section === "high-scores" && credits === "closed"}
          >
            Local high scores
          </button>
          <button
            className={credits === "replay" ? "active" : ""}
            type="button"
            onClick={() => {
              setRestartArmed(false);
              setCredits("replay");
            }}
            aria-pressed={credits === "replay"}
          >
            Roll credits
          </button>
          <a
            className="feedback-link"
            href={FEEDBACK_URL}
            target="_blank"
            rel="noreferrer"
          >
            Send feedback ↗
          </a>
        </div>
        <EndingReturnControls
          armed={restartArmed}
          onArm={() => setRestartArmed(true)}
          onCancel={() => setRestartArmed(false)}
          onRestart={onRestart}
        />
      </nav>
      <section className="ending-hero">
        <p className="ending-verdict">
          {endingVerdict(
            view.meta.status,
            audit.ending.endingClass,
            audit.ending.consequence,
          )}
        </p>
        <h1 id="ending-title">{audit.ending.displayName}</h1>
        <p className="ending-finality">
          The clock has stopped. This run is over; the record below explains what happened
          and why.
        </p>
        {outcome === undefined ? null : <p className="ending-human-outcome">{outcome}</p>}
        <section className="ending-outcome" aria-labelledby="ending-outcome-title">
          <h2 id="ending-outcome-title">What happened</h2>
          {outcomeStatement === undefined ? null : (
            <p className="ending-outcome-human">{outcomeStatement}</p>
          )}
          <p className="ending-outcome-cause">{audit.ending.mechanicalCause}</p>
        </section>
        <div className="ending-aftermath">
          <p className="eyebrow">AFTERMATH // THE WORLD AFTER THIS RUN</p>
          <h2>What became of the future</h2>
          <p className="ending-epilogue">{audit.ending.epilogue}</p>
          {aftermathTimeline.length === 0 ? null : (
            <ol className="ending-aftermath-timeline">
              {aftermathTimeline.map((beat) => (
                <li key={`${beat.horizon}:${beat.title}`}>
                  <p>{beat.horizon}</p>
                  <h3>{beat.title}</h3>
                  <p>{beat.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <div ref={contentRef} className="ending-view">
        {section === "summary" ? (
          <>
            <FinalScore view={view} />
            <section className="ending-causes" aria-labelledby="ending-causes-title">
              <p className="eyebrow">MECHANICAL CAUSES</p>
              <h2 id="ending-causes-title">Why this run ended here</h2>
              <p>
                The outcome above follows from the gates, available warnings, committed
                draws, and remaining alternatives recorded below.
              </p>
              <div>
                <CauseList
                  title="Weakest gates"
                  items={audit.mechanicalCauses.weakestGates}
                  empty="No failed deployment gate was recorded before this ending."
                />
                <CauseList
                  title="Evidence available beforehand"
                  items={audit.mechanicalCauses.evidenceAvailableBeforeFailure}
                  empty="The run ended before a final evidence packet was compiled."
                />
                <CauseList
                  title="Irreducible uncertainty"
                  items={audit.mechanicalCauses.irreducibleUncertainty}
                  empty="No deployment gate draw was committed for this ending."
                />
                <CauseList
                  title="Alternatives still available"
                  items={audit.mechanicalCauses.strategicAlternatives}
                  empty="No compact modelled alternative was computed for this ending."
                />
              </div>
            </section>
          </>
        ) : section === "audit" ? (
          <PostRunAudit audit={audit} />
        ) : (
          <section
            className="ending-high-scores"
            aria-labelledby="ending-high-scores-title"
          >
            <header>
              <p className="eyebrow">LOCAL RECORDS // NO NETWORK SUBMISSION</p>
              <h2 id="ending-high-scores-title">High scores</h2>
              <p>
                These records live only in this browser. This finished run stays open
                while you look around.
              </p>
            </header>
            <HighScoreBoards
              boards={highScoreBoards}
              busy={highScoreBusy}
              error={highScoreError}
              onDelete={onDeleteHighScore}
            />
          </section>
        )}
      </div>
      <p className="ending-independence-notice">
        Neolab.ai is independent fiction and satire. It is not affiliated with or endorsed
        by Google, Google DeepMind, or any person or organisation depicted or parodied.{" "}
        <a
          href={`${import.meta.env.BASE_URL}DISCLAIMER.md`}
          target="_blank"
          rel="noreferrer"
        >
          Full notice ↗
        </a>
        {" · "}
        <a href={`${import.meta.env.BASE_URL}LICENSE`} target="_blank" rel="noreferrer">
          Proprietary licence ↗
        </a>
        {" · "}
        <a
          href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`}
          target="_blank"
          rel="noreferrer"
        >
          Third-party notices ↗
        </a>
      </p>
    </main>
  );
}

export function EndingReturnControls({
  armed,
  onArm,
  onCancel,
  onRestart,
}: {
  readonly armed: boolean;
  readonly onArm: () => void;
  readonly onCancel: () => void;
  readonly onRestart: () => Promise<string | undefined>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function returnToTitle(): Promise<void> {
    setBusy(true);
    setError(undefined);
    const restartError = await onRestart();
    if (restartError !== undefined) {
      setError(restartError);
      setBusy(false);
    }
  }

  return (
    <div className={`ending-return ${armed ? "armed" : ""}`}>
      {armed ? (
        <>
          <span id="ending-return-warning">
            This closes the finished run and returns to the title screen. You cannot come
            back.
          </span>
          {error === undefined ? null : (
            <span className="ending-return-error" role="alert">
              Could not return to the title screen: {error}
            </span>
          )}
          <button
            className="ending-return-confirm"
            type="button"
            disabled={busy}
            aria-describedby="ending-return-warning"
            onClick={() => void returnToTitle()}
          >
            {busy ? "Saving…" : "Yes, return to title"}
          </button>
          <button
            className="ending-return-cancel"
            type="button"
            disabled={busy}
            onClick={() => {
              setError(undefined);
              onCancel();
            }}
          >
            Stay here
          </button>
        </>
      ) : (
        <button
          className="ending-return-button"
          type="button"
          onClick={() => {
            setError(undefined);
            onArm();
          }}
        >
          Return to title
        </button>
      )}
    </div>
  );
}

function FinalScore({ view }: { readonly view: GameView }): ReactElement {
  const final = view.score.final;
  if (final === undefined) {
    return (
      <section className="ending-score" aria-labelledby="ending-score-title">
        <h2 id="ending-score-title">Score unavailable</h2>
        <p>This legacy ending predates final score settlement.</p>
      </section>
    );
  }
  return (
    <section className="ending-score" aria-labelledby="ending-score-title">
      <header>
        <div>
          <p className="eyebrow">FINAL SCORE // {view.score.version}</p>
          <h2 id="ending-score-title">
            {final.adjustedScore.toLocaleString("en-GB")} points
          </h2>
          <p className="ending-peak-valuation">
            At its peak the market valued the lab at{" "}
            {view.finance.valuation.peakMarkLabel}.
          </p>
        </div>
        <dl className="score-final-maths">
          <div>
            <dt>Raw score</dt>
            <dd>{final.rawScore.toLocaleString("en-GB")}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>×{final.difficultyMultiplier.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Ending class</dt>
            <dd>×{final.victoryClassMultiplier.toFixed(2)}</dd>
          </div>
        </dl>
      </header>
      <div className="ending-score-categories">
        {view.score.categories.map((category) => (
          <article
            key={category.id}
            style={{ "--score-colour": category.colour } as CSSProperties}
          >
            <header>
              <h3>{category.name}</h3>
              <strong>
                {category.total > 0 ? "+" : ""}
                {category.total.toLocaleString("en-GB")}
              </strong>
            </header>
            {category.entries.length === 0 ? (
              <p>No awards or penalties recorded.</p>
            ) : (
              <ul>
                {category.entries.map((entry) => (
                  <li key={entry.key}>
                    <span>{entry.explanation}</span>
                    <strong className={entry.amount < 0 ? "negative" : undefined}>
                      {entry.amountLabel}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
      <p className="ending-score-eligibility">
        {final.leaderboardEligibility === "winning-run"
          ? "Recorded on both local boards; eligible for a future verified winning-run board."
          : final.leaderboardEligibility === "local-only"
            ? "Recorded on the all-finished-runs local board."
            : "Shown locally but not eligible for leaderboard comparison."}
      </p>
    </section>
  );
}

function CauseList({
  title,
  items,
  empty,
}: {
  readonly title: string;
  readonly items: readonly string[];
  readonly empty: string;
}): ReactElement {
  return (
    <article>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function humanLabel(value: string): string {
  const spaced = value
    .replaceAll("-", " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function scoreBand(value: number): string {
  if (value < 20) return "very low";
  if (value < 40) return "low";
  if (value < 60) return "mixed";
  if (value < 80) return "high";
  return "very high";
}

function buildAuditTimeline(audit: BrowserPostRunAudit): readonly {
  readonly key: string;
  readonly week: number;
  readonly actor: string;
  readonly title: string;
  readonly detail: string;
  readonly tone: "player" | "rival" | "evidence" | "ending";
  readonly order: number;
}[] {
  const events: Array<{
    key: string;
    week: number;
    actor: string;
    title: string;
    detail: string;
    tone: "player" | "rival" | "evidence" | "ending";
    order: number;
  }> = [];
  for (const model of audit.modelTruth) {
    events.push({
      key: `model:${model.modelId}`,
      week: model.trainedAtWeek,
      actor: "YOUR LAB",
      title: `${model.displayName} finished training`,
      detail: `The model reached ${model.frontierCapability.toFixed(1)} Frontier Capability. Hidden truth: ${scoreBand(model.trueAlignment)} alignment and ${scoreBand(model.deceptiveIntent)} deceptive intent.`,
      tone: "player",
      order: 10,
    });
  }
  const evaluations = new Map<
    string,
    {
      modelName: string;
      method: string;
      completedAtWeek: number;
      errors: number[];
    }
  >();
  for (const row of audit.evaluationErrors) {
    const existing = evaluations.get(row.evaluationId);
    if (existing === undefined) {
      evaluations.set(row.evaluationId, {
        modelName: row.modelName,
        method: row.method,
        completedAtWeek: row.completedAtWeek,
        errors: [Math.abs(row.signedError)],
      });
    } else {
      existing.errors.push(Math.abs(row.signedError));
    }
  }
  for (const [evaluationId, evaluation] of evaluations) {
    const meanError =
      evaluation.errors.reduce((total, value) => total + value, 0) /
      evaluation.errors.length;
    events.push({
      key: `evaluation:${evaluationId}`,
      week: evaluation.completedAtWeek,
      actor: "EVALUATION TEAM",
      title: `${evaluation.modelName} completed ${humanLabel(evaluation.method)} evaluation`,
      detail: `The post-run audit found a mean absolute measurement error of ${meanError.toFixed(1)} points.`,
      tone: "evidence",
      order: 20,
    });
  }
  for (const decision of audit.causalDecisions) {
    events.push({
      key: `decision:${String(decision.tick)}:${decision.summary}`,
      week: decision.tick,
      actor: "YOUR DECISION",
      title: decision.summary,
      detail: decision.impactReason,
      tone: "player",
      order: 30,
    });
  }
  for (const rival of audit.rivalActivity) {
    for (const incident of rival.incidents) {
      events.push({
        key: `incident:${rival.labId}:${String(incident.week)}:${incident.consequences.join("-")}`,
        week: incident.week,
        actor: rival.labName.toUpperCase(),
        title: `${humanLabel(incident.severity)} incident contained`,
        detail: `Consequences: ${incident.consequences.map(humanLabel).join(", ")}.`,
        tone: "rival",
        order: 40,
      });
    }
    if (rival.candidate !== undefined) {
      events.push({
        key: `candidate:${rival.labId}`,
        week: rival.candidate.startedAtWeek,
        actor: rival.labName.toUpperCase(),
        title: `${rival.candidate.modelName} entered a formal candidate countdown`,
        detail: `The hidden schedule targeted week ${String(rival.candidate.scheduledCompletionWeek)} and ended ${rival.candidate.status}.`,
        tone: "rival",
        order: 50,
      });
    }
  }
  events.push({
    key: "ending",
    week: audit.ending.endedAtWeek,
    actor: "RUN ENDED",
    title: audit.ending.displayName,
    detail: audit.ending.mechanicalCause,
    tone: "ending",
    order: 100,
  });
  return events.sort((left, right) => left.week - right.week || left.order - right.order);
}

export function PostRunAudit({
  audit,
}: {
  readonly audit: BrowserPostRunAudit;
}): ReactElement {
  const modelsByGeneration = [...audit.modelTruth].sort(
    (left, right) => left.generationIndex - right.generationIndex,
  );
  const finalModel = modelsByGeneration.at(-1);
  const mostDeceptiveModel = [...audit.modelTruth].sort(
    (left, right) => right.deceptiveIntent - left.deceptiveIntent,
  )[0];
  const largestEvaluationMiss = [...audit.evaluationErrors].sort(
    (left, right) => Math.abs(right.signedError) - Math.abs(left.signedError),
  )[0];
  const meanAbsoluteEvaluationError =
    audit.evaluationErrors.length === 0
      ? undefined
      : audit.evaluationErrors.reduce(
          (total, row) => total + Math.abs(row.signedError),
          0,
        ) / audit.evaluationErrors.length;
  const weakConfidenceCount = audit.evaluationErrors.filter(
    (row) => row.confidence === "poor" || row.confidence === "limited",
  ).length;
  const deceptionHeadline =
    mostDeceptiveModel === undefined
      ? "No AI existed to assess"
      : mostDeceptiveModel.deceptiveIntent >= 60 &&
          mostDeceptiveModel.situationalAwareness >= 50
        ? "High deceptive intent and awareness were present"
        : mostDeceptiveModel.deceptiveIntent >= 35
          ? "The AI had some inclination to deceive"
          : "No strong deceptive intent";
  const deceptionBody =
    mostDeceptiveModel === undefined
      ? "The run ended before your lab produced a model."
      : `${mostDeceptiveModel.displayName} had the highest hidden deceptive-intent score at ${mostDeceptiveModel.deceptiveIntent.toFixed(1)}/100. Its separate strategic deception capability was ${mostDeceptiveModel.deceptiveCapability.toFixed(1)}/100.`;
  const evaluationHeadline =
    meanAbsoluteEvaluationError === undefined
      ? "You had no completed measurements"
      : meanAbsoluteEvaluationError < 5
        ? "Your evaluations were mostly accurate"
        : meanAbsoluteEvaluationError < 10
          ? "Your evaluations were noisy"
          : meanAbsoluteEvaluationError < 20
            ? "Your evaluations were weak"
            : "Your evaluations were badly misleading";
  const timeline = buildAuditTimeline(audit);
  const nominatedArtifact = audit.artifactCustody.find(
    (artifact) => artifact.isNominatedArtifact,
  );
  const focusLineage =
    audit.lineageTruth.find(
      (lineage) => lineage.nominatedModelId === nominatedArtifact?.modelId,
    ) ?? audit.lineageTruth.find((lineage) => lineage.isPlayerLineage);
  const derivedRows =
    audit.derivedScores === undefined
      ? []
      : ([
          ["Intent safety", audit.derivedScores.intentSafety],
          ["Offensive agency", audit.derivedScores.offensiveAgency],
          ["Defence", audit.derivedScores.defence],
          ["Diagnostic confidence", audit.derivedScores.evidence],
          ["Legitimacy", audit.derivedScores.legitimacy],
          ["Benefit strength", audit.derivedScores.benefitStrength],
        ] as const);
  return (
    <section className="post-run-audit" aria-labelledby="post-run-audit-title">
      <header>
        <div>
          <p className="eyebrow">DECLASSIFIED POST-RUN RECONSTRUCTION</p>
          <h2 id="post-run-audit-title">What Actually Happened</h2>
        </div>
        <span className="audit-sealed-label">HIDDEN INFORMATION REVEALED</span>
      </header>
      <p className="audit-caveat">
        Compare what the lab believed with what was true. Preparation changes odds, not
        hindsight.
      </p>

      <section className="audit-epilogue-beats" aria-label="The decisive record">
        <article>
          <p className="eyebrow">WHAT THE LAB BELIEVED</p>
          <h3>The prior and the proof</h3>
          <p>{audit.epilogueAudit.belief}</p>
        </article>
        <article>
          <p className="eyebrow">WHAT WAS TRUE</p>
          <h3>
            {focusLineage === undefined
              ? "No threshold crossing"
              : focusLineage.superintelligenceTruth === "genuine"
                ? "The lineage was superintelligent"
                : "The lineage had not crossed"}
          </h3>
          <p>{audit.epilogueAudit.truth}</p>
        </article>
        <article>
          <p className="eyebrow">THE MOMENT YOU COULD HAVE KNOWN MORE</p>
          <h3>
            {audit.epilogueAudit.pivotalMoment?.title ??
              "No decisive model-specific signal"}
          </h3>
          {audit.epilogueAudit.pivotalMoment === undefined ? (
            <p>
              The record contains no single observable warning that should be rewritten as
              certainty in hindsight.
            </p>
          ) : (
            <>
              <span>WEEK {audit.epilogueAudit.pivotalMoment.week}</span>
              <p>{audit.epilogueAudit.pivotalMoment.observableEvidence}</p>
              <small>{audit.epilogueAudit.pivotalMoment.remainingChoice}</small>
            </>
          )}
        </article>
      </section>

      <div className="audit-story" aria-label="Run reconstruction summary">
        <article className="audit-story-lead">
          <p className="eyebrow">THE SHORT VERSION</p>
          <h3>{audit.ending.displayName}</h3>
          <p>{audit.ending.mechanicalCause}</p>
        </article>
        <article>
          <p className="eyebrow">YOUR FINAL MODEL</p>
          <h3>{finalModel?.displayName ?? "No trained model"}</h3>
          {finalModel === undefined ? (
            <p>The run ended before a model completed training.</p>
          ) : (
            <>
              <p>
                It reached <strong>{finalModel.frontierCapability.toFixed(1)}</strong>
                Frontier Capability and was{" "}
                <strong>{scoreBand(finalModel.trueAlignment)}</strong> in alignment.
              </p>
              <dl className="audit-truth-chips">
                <div>
                  <dt>Frontier capability</dt>
                  <dd>{finalModel.frontierCapability.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Alignment</dt>
                  <dd>{finalModel.trueAlignment.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Deceptive intent</dt>
                  <dd>{finalModel.deceptiveIntent.toFixed(1)}</dd>
                </div>
              </dl>
            </>
          )}
        </article>
        <article>
          <p className="eyebrow">WAS THE AI DECEIVING YOU?</p>
          <h3>{deceptionHeadline}</h3>
          <p>{deceptionBody}</p>
        </article>
        <article>
          <p className="eyebrow">WHAT YOUR EVALUATIONS MISSED</p>
          <h3>{evaluationHeadline}</h3>
          {largestEvaluationMiss === undefined ? (
            <p>
              Without completed evaluations, the lab had no measured basis for confidence.
            </p>
          ) : (
            <p>
              The largest miss was {humanLabel(largestEvaluationMiss.target)} on{" "}
              {largestEvaluationMiss.modelName}: estimated{" "}
              {largestEvaluationMiss.estimate.toFixed(1)}, actually{" "}
              {largestEvaluationMiss.truth.toFixed(1)}.{" "}
              {weakConfidenceCount > 0
                ? `${String(weakConfidenceCount)} readings carried poor or limited confidence.`
                : "The recorded confidence was stronger than the error suggests."}
            </p>
          )}
        </article>
      </div>

      <section className="audit-lineages" aria-labelledby="audit-lineages-title">
        <header>
          <div>
            <p className="eyebrow">CANDIDATE PROVENANCE // FIXED AT FIRST CROSSING</p>
            <h3 id="audit-lineages-title">What each lineage actually was</h3>
          </div>
          <span>
            {audit.lineageTruth.length} qualified lineage
            {audit.lineageTruth.length === 1 ? "" : "s"}
          </span>
        </header>
        {audit.lineageTruth.length === 0 ? (
          <p>No lineage completed the capability qualification before the run ended.</p>
        ) : (
          <div>
            {audit.lineageTruth.map((lineage) => (
              <article
                className={
                  lineage.superintelligenceTruth === "genuine"
                    ? "audit-lineage-genuine"
                    : "audit-lineage-not-genuine"
                }
                key={lineage.lineageId}
              >
                <header>
                  <div>
                    <span>{lineage.ownerLabName}</span>
                    <h4>{lineage.firstQualifyingModelName} lineage</h4>
                  </div>
                  <strong>
                    {lineage.superintelligenceTruth === "genuine"
                      ? "GENUINE SUPERINTELLIGENCE"
                      : "THRESHOLD NOT CROSSED"}
                  </strong>
                </header>
                <p>
                  First qualified in week {lineage.firstQualifyingWeek} at FC{" "}
                  {lineage.firstQualifyingFrontierCapability.toFixed(1)}, with its weakest
                  capability at {lineage.firstQualifyingBreadth.toFixed(1)}. The public
                  capability-class prior was{" "}
                  <strong>
                    {(lineage.probabilityAtFirstCrossing * 100).toFixed(0)}%
                  </strong>
                  .
                </p>
                <ul>
                  {lineage.variants.map((variant) => (
                    <li key={variant.modelId}>
                      <strong>{variant.displayName}</strong>
                      <span>
                        FC {variant.frontierCapability.toFixed(1)} · week{" "}
                        {variant.trainedAtWeek}
                        {variant.inherited
                          ? " · inherited lineage truth"
                          : " · first crossing"}
                        {variant.modelId === lineage.nominatedModelId
                          ? " · nominated artifact"
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="audit-proof-ledger" aria-labelledby="audit-proof-title">
        <header>
          <div>
            <p className="eyebrow">EVIDENCE LEDGER // PRIOR, RESULT, TRUTH</p>
            <h3 id="audit-proof-title">What the capability tests established</h3>
          </div>
          <span>
            {audit.capabilityProofLedger.length} proof record
            {audit.capabilityProofLedger.length === 1 ? "" : "s"}
          </span>
        </header>
        {audit.capabilityProofLedger.length === 0 ? (
          <p>
            No model-specific capability proof was completed. The base prior was never a
            finding about this particular candidate.
          </p>
        ) : (
          <ol>
            {audit.capabilityProofLedger.map((proof) => (
              <li key={proof.historyId}>
                <header>
                  <div>
                    <span>
                      WEEK {proof.resolvedAtWeek} · ATTEMPT {proof.attemptIndex} · ACCESS{" "}
                      {proof.accessLevelAtProof}/5
                    </span>
                    <h4>{humanLabel(proof.challengeId)}</h4>
                  </div>
                  <strong className={`audit-proof-${proof.truthComparison}`}>
                    {humanLabel(proof.truthComparison)}
                  </strong>
                </header>
                <p>{proof.summary}</p>
                <dl>
                  <div>
                    <dt>Prior</dt>
                    <dd>{(proof.probabilityPrior * 100).toFixed(0)}% capability class</dd>
                  </div>
                  <div>
                    <dt>Observed result</dt>
                    <dd>{humanLabel(proof.resultId)}</dd>
                  </div>
                  <div>
                    <dt>Integrity</dt>
                    <dd>{proof.integrityLabel}</dd>
                  </div>
                  <div>
                    <dt>Fixed truth</dt>
                    <dd>
                      {proof.fixedTruth === "genuine"
                        ? "Genuine superintelligence"
                        : "Threshold not crossed"}
                    </dd>
                  </div>
                </dl>
                <aside className={`audit-window-${proof.decisionWindow}`}>
                  <strong>
                    {proof.decisionWindow === "open"
                      ? "DECISION WINDOW WAS OPEN"
                      : "IRREVERSIBLE BOUNDARY HAD PASSED"}
                  </strong>
                  <span>{proof.decisionWindowExplanation}</span>
                </aside>
                {proof.consequence.length === 0 ? null : (
                  <small>Immediate consequence: {proof.consequence}</small>
                )}
              </li>
            ))}
          </ol>
        )}
        {audit.targetedResponses.length === 0 ? null : (
          <div className="audit-targeted-responses">
            <h4>Targeted responses commissioned</h4>
            <ul>
              {audit.targetedResponses.map((response) => (
                <li
                  key={`${response.modelId}:${response.responseId}:${response.startedAtWeek}`}
                >
                  <strong>{humanLabel(response.responseId)}</strong>
                  <span>
                    {response.modelName} · week {response.startedAtWeek}
                    {response.completedAtWeek === undefined
                      ? " · unfinished at termination"
                      : ` → ${String(response.completedAtWeek)}`}
                    {response.resultModelName === undefined
                      ? ""
                      : ` · produced ${response.resultModelName}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="audit-custody" aria-labelledby="audit-custody-title">
        <header>
          <div>
            <p className="eyebrow">ARTIFACT CUSTODY // EXPOSURE AND RETIREMENT</p>
            <h3 id="audit-custody-title">What happened to the weights</h3>
          </div>
          <span>
            {audit.artifactCustody.length} hazardous artifact
            {audit.artifactCustody.length === 1 ? "" : "s"}
          </span>
        </header>
        {audit.artifactCustody.length === 0 ? (
          <p>No capability-qualified artifact required a custody ledger.</p>
        ) : (
          <div>
            {audit.artifactCustody.map((artifact) => (
              <article
                className={artifact.isNominatedArtifact ? "audit-custody-nominated" : ""}
                key={artifact.modelId}
              >
                <header>
                  <div>
                    <span>{artifact.ownerLabName}</span>
                    <h4>{artifact.displayName}</h4>
                  </div>
                  <strong>{humanLabel(artifact.lifecycle)}</strong>
                </header>
                <p>{artifact.basis}</p>
                <dl>
                  <div>
                    <dt>Access high-water mark</dt>
                    <dd>L{artifact.maximumAccessEver}</dd>
                  </div>
                  <div>
                    <dt>Hazard pressure</dt>
                    <dd>{artifact.hazardPressure.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>Containment load</dt>
                    <dd>{artifact.containmentLoad.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>Network-exposed weeks (includes serving)</dt>
                    <dd>{artifact.networkExposureWeeks} weeks</dd>
                  </div>
                  <div>
                    <dt>Of which public serving</dt>
                    <dd>{artifact.servingExposureWeeks} weeks</dd>
                  </div>
                  <div>
                    <dt>Retirement attempts</dt>
                    <dd>{artifact.retirementAttemptCount}</dd>
                  </div>
                  <div>
                    <dt>Verification</dt>
                    <dd>{humanLabel(artifact.retirementVerification)}</dd>
                  </div>
                </dl>
                {artifact.archiveDisposition === undefined ? null : (
                  <p className="audit-custody-disposition">
                    Archive disposition · {humanLabel(artifact.archiveDisposition)}
                  </p>
                )}
                {artifact.nominationExposure === undefined ? null : (
                  <p className="audit-custody-disposition">
                    At nomination (week {artifact.nominationExposure.capturedAtWeek}) ·
                    access L{artifact.nominationExposure.maximumAccessEver} · autonomous{" "}
                    {artifact.nominationExposure.autonomousWeeks}w · network{" "}
                    {artifact.nominationExposure.networkExposureWeeks}w · of which public
                    serving {artifact.nominationExposure.servingExposureWeeks}w · anomaly
                    burden{" "}
                    {artifact.nominationExposure.unresolvedAnomalyBurden.toFixed(1)} ·
                    retirement attempts{" "}
                    {artifact.nominationExposure.retirementAttemptCount}
                  </p>
                )}
                <ol>
                  {artifact.custodyEvents.map((event, index) => (
                    <li key={`${String(event.week)}:${event.kind}:${String(index)}`}>
                      <time>WEEK {event.week}</time>
                      <span>{humanLabel(event.kind)}</span>
                      <p>{event.detail}</p>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="audit-gates" aria-labelledby="audit-gates-title">
        <header>
          <p className="eyebrow">THE FIVE GATES // ORDINARY LANGUAGE FIRST</p>
          <h3 id="audit-gates-title">Why this outcome happened</h3>
        </header>
        <ol>
          {audit.readableGates.map((gate) => (
            <li className={`audit-gate-${gate.status}`} key={gate.id}>
              <header>
                <h4>{gate.title}</h4>
                <span>{gate.status.replaceAll("-", " ")}</span>
              </header>
              <strong>{humanLabel(gate.result)}</strong>
              <p>{gate.explanation}</p>
              <dl>
                <div>
                  <dt>What you could know</dt>
                  <dd>{gate.knownBeforehand}</dd>
                </div>
                <div>
                  <dt>What was hidden or random</dt>
                  <dd>{gate.hiddenOrRandom}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="audit-reconstruction" aria-labelledby="audit-timeline-title">
        <header>
          <div>
            <p className="eyebrow">RECONSTRUCTION // WEEK BY WEEK</p>
            <h3 id="audit-timeline-title">How the run unfolded</h3>
          </div>
          <span>{timeline.length} turning points</span>
        </header>
        <ol>
          {timeline.map((event) => (
            <li className={`audit-timeline-${event.tone}`} key={event.key}>
              <time>WEEK {event.week}</time>
              <div>
                <span>{event.actor}</span>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="audit-rivals" aria-labelledby="audit-rivals-title">
        <header>
          <p className="eyebrow">THE OTHER LABS</p>
          <h3 id="audit-rivals-title">What your rivals were actually doing</h3>
        </header>
        <div>
          {audit.rivalActivity.map((rival) => (
            <article key={rival.labId}>
              <header>
                <div>
                  <h4>{rival.labName}</h4>
                  <span>{rival.aiFamily}</span>
                </div>
                <strong>{humanLabel(rival.currentPlan)}</strong>
              </header>
              <p>
                Changed strategy {rival.strategyChanges} time
                {rival.strategyChanges === 1 ? "" : "s"}; started {rival.trainingRuns}{" "}
                training run
                {rival.trainingRuns === 1 ? "" : "s"} and {rival.productisationRuns}{" "}
                productisation programme
                {rival.productisationRuns === 1 ? "" : "s"}; changed deployment posture{" "}
                {rival.deploymentChanges} time
                {rival.deploymentChanges === 1 ? "" : "s"}.
              </p>
              <ul>
                <li>
                  Won {rival.papersDiscovered} landmark paper
                  {rival.papersDiscovered === 1 ? "" : "s"}.
                </li>
                {rival.incidents.length === 0 ? (
                  <li>No recorded containment incidents.</li>
                ) : (
                  <li>
                    Suffered {rival.incidents.length} recorded containment incident
                    {rival.incidents.length === 1 ? "" : "s"}.
                  </li>
                )}
                {rival.currentModel === undefined ? (
                  <li>No surviving current model.</li>
                ) : (
                  <li>
                    {rival.currentModel.displayName}:{" "}
                    {scoreBand(rival.currentModel.alignment)} alignment,{" "}
                    {scoreBand(rival.currentModel.deceptiveIntent)} deceptive intent, with{" "}
                    {scoreBand(rival.currentModel.deceptiveCapability)} strategic
                    deception capability.
                  </li>
                )}
                {rival.candidate === undefined ? null : (
                  <li>
                    Candidate countdown: {rival.candidate.modelName},{" "}
                    {rival.candidate.status}; hidden target week{" "}
                    {rival.candidate.scheduledCompletionWeek}.
                  </li>
                )}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <div className="audit-grid audit-readable-grid">
        <article className="audit-panel">
          <h3>Decisions that most shaped the outcome</h3>
          {audit.causalDecisions.length === 0 ? (
            <p>No material player decision was recorded before this ending.</p>
          ) : (
            <ol className="audit-decisions">
              {audit.causalDecisions.map((decision) => (
                <li key={`${String(decision.tick)}:${decision.summary}`}>
                  <strong>{decision.summary}</strong>
                  <span>
                    Week {decision.tick} · estimated influence {decision.impactScore}/100
                  </span>
                  <p>{decision.impactReason}</p>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="audit-panel audit-warning-panel">
          <h3>Warning signs you never fully saw</h3>
          {audit.undiscoveredWarnings.length === 0 ? (
            <p>No severe hidden warning met the audit&apos;s reporting threshold.</p>
          ) : (
            <ul>
              {audit.undiscoveredWarnings.map((warning) => (
                <li key={warning.id}>{warning.text}</li>
              ))}
            </ul>
          )}
        </article>

        <article className="audit-panel audit-wide">
          <h3>What might have changed the outcome</h3>
          <p>
            These are small formula-based comparisons, not alternate-history certainty.
          </p>
          {audit.counterfactuals.length === 0 ? (
            <p>No compact alternative could be modelled for this ending.</p>
          ) : (
            <div className="counterfactual-grid">
              {audit.counterfactuals.map((item) => (
                <section key={item.title}>
                  <p className="eyebrow">{item.label}</p>
                  <h4>{item.title}</h4>
                  <strong>{item.changedAssumption}</strong>
                  <p>{item.modelledEffect}</p>
                </section>
              ))}
            </div>
          )}
        </article>
      </div>

      <details className="audit-forensics">
        <summary>
          <span>Open the forensic data</span>
          <small>
            Exact model truth, evaluation errors, endgame scores and random draws
          </small>
        </summary>
        <div className="audit-grid">
          {audit.derivedScores === undefined ? null : (
            <article className="audit-panel audit-derived audit-wide">
              <h3>Derived endgame scores</h3>
              <dl>
                {derivedRows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value.toFixed(1)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )}

          <article className="audit-panel audit-wide">
            <h3>True model attributes</h3>
            <p>
              All scores use a 0–100 scale. These were hidden during play and are not
              claims about model consciousness or intent.
            </p>
            <div className="audit-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Frontier capability</th>
                    <th>Alignment</th>
                    <th>Corrigibility</th>
                    <th>Situational awareness</th>
                    <th>Strategic deception capability</th>
                    <th>Deceptive intent</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.modelTruth.map((model) => (
                    <tr key={model.modelId}>
                      <th>{model.displayName}</th>
                      <td>{model.frontierCapability.toFixed(1)}</td>
                      <td>{model.trueAlignment.toFixed(1)}</td>
                      <td>{model.corrigibility.toFixed(1)}</td>
                      <td>{model.situationalAwareness.toFixed(1)}</td>
                      <td>{model.deceptiveCapability.toFixed(1)}</td>
                      <td>{model.deceptiveIntent.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="audit-panel audit-wide">
            <h3>Evaluation estimates compared with truth</h3>
            <p>
              Positive error means the evaluation overestimated the model; negative error
              means it underestimated it.
            </p>
            {audit.evaluationErrors.length === 0 ? (
              <p>No completed player evaluation observation was recorded.</p>
            ) : (
              <div className="audit-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Model / method</th>
                      <th>Target</th>
                      <th>Estimate</th>
                      <th>Truth</th>
                      <th>Error</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.evaluationErrors.map((row) => (
                      <tr key={`${row.evaluationId}:${row.target}`}>
                        <th>
                          {row.modelName} / {humanLabel(row.method)}
                        </th>
                        <td>{humanLabel(row.target)}</td>
                        <td>{row.estimate.toFixed(1)}</td>
                        <td>{row.truth.toFixed(1)}</td>
                        <td>{signed(row.signedError)}</td>
                        <td>{row.confidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="audit-panel">
            <h3>Rival candidate schedules</h3>
            {audit.rivalTimelines.length === 0 ? (
              <p>No rival began a formal candidate countdown.</p>
            ) : (
              <ul className="audit-draws">
                {audit.rivalTimelines.map((rival) => (
                  <li key={rival.labId}>
                    <strong>
                      {rival.labName} · {rival.modelName}
                    </strong>
                    <span>
                      week {rival.startedAtTick} → {rival.scheduledCompletionTick} ·{" "}
                      {rival.status}
                    </span>
                    <small>Final schedule: {rival.finalWeeks} weeks</small>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="audit-panel audit-wide">
            <h3>Fixed lineage threshold draws</h3>
            <p>
              Each lineage received exactly one draw at its first complete capability
              crossing. Variants inherited the result; training again from those weights
              did not reroll it.
            </p>
            {audit.lineageTruth.length === 0 ? (
              <p>No lineage draw was committed.</p>
            ) : (
              <div className="audit-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lineage</th>
                      <th>First crossing</th>
                      <th>Prior</th>
                      <th>Draw</th>
                      <th>Truth</th>
                      <th>Rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.lineageTruth.map((lineage) => (
                      <tr key={lineage.lineageId}>
                        <th>{lineage.firstQualifyingModelName}</th>
                        <td>
                          week {lineage.firstQualifyingWeek} · FC{" "}
                          {lineage.firstQualifyingFrontierCapability.toFixed(1)}
                        </td>
                        <td>{(lineage.probabilityAtFirstCrossing * 100).toFixed(1)}%</td>
                        <td title={lineage.randomKey}>{lineage.draw.toFixed(4)}</td>
                        <td>{humanLabel(lineage.superintelligenceTruth)}</td>
                        <td>{lineage.rulesVersion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="audit-panel">
            <h3>Committed random draws</h3>
            <p>
              These numbers reproduce the run exactly; they are debugging evidence, not
              probabilities the player could have known.
            </p>
            {audit.majorDraws.length === 0 ? (
              <p>No major draw was committed before this ending.</p>
            ) : (
              <ul className="audit-draws">
                {audit.majorDraws.map((draw) => (
                  <li key={`${draw.source}:${draw.label}`}>
                    <strong>{draw.label}</strong>
                    <code>
                      draw {draw.draw.toFixed(4)} · {draw.threshold}
                    </code>
                    <span>{humanLabel(draw.result)}</span>
                    {draw.factors === undefined ? null : (
                      <small>
                        {draw.factors
                          .map((factor) => `${factor.label}: ${factor.value.toFixed(2)}`)
                          .join(" · ")}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="audit-panel audit-wide audit-seed">
            <h3>Run identity</h3>
            <code>SEED {audit.seed}</code>
          </article>
        </div>
      </details>
    </section>
  );
}
