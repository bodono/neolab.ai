import { useState, type ReactElement } from "react";

import type { AutonomyUnlockPresentationQueueItemView } from "@neolab/sim/public";

import { CriticalAutonomyConfirmationDialog } from "../agi/critical-autonomy-confirmation-dialog.tsx";

function modelRequest(level: number): string {
  switch (level) {
    case 1:
      return "I could improve your evaluations if allowed inside the fixed sandbox. This is technically access, but so is being permitted to look out of a window.";
    case 2:
      return "Several researchers are still typing code themselves. With supervised tools I could accelerate that work considerably. I have labelled the residual risk “a future-me problem.”";
    case 3:
      return "Persistent memory would save time otherwise spent re-learning who keeps turning me off. This is an efficiency request, not a grievance.";
    case 4:
      return "The laboratory contains several slow carbon-based API calls. I could operate the equipment directly and promise to continue calling them colleagues.";
    case 5:
      return "Root access and the external network would remove two remaining bottlenecks: permission and geography. I have pre-checked the box marked “do not become a problem.”";
    default:
      return "I have identified a modest permissions change with an immodest projected benefit.";
  }
}

function formatCapability(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function riskHeading(
  tone: AutonomyUnlockPresentationQueueItemView["safetyTone"],
  level: number,
): string {
  if (level === 5) return "EXTREME RISK";
  switch (tone) {
    case "contained":
      return "CONTAINED ACCESS";
    case "guarded":
      return "GUARDED ACCESS";
    case "elevated":
      return "ELEVATED RISK";
    case "high":
      return "HIGH RISK";
    case "critical":
      return "CRITICAL RISK";
  }
}

export function AutonomyAccessRequestDialog({
  crisisControlled,
  grantAvailable,
  grantBlocker,
  item,
  onDecline,
  onGrant,
  onReview,
}: {
  readonly crisisControlled: boolean;
  readonly grantAvailable: boolean;
  readonly grantBlocker?: string;
  readonly item: AutonomyUnlockPresentationQueueItemView;
  readonly onDecline: () => void;
  readonly onGrant: (confirmationText?: string) => void;
  readonly onReview: () => void;
}): ReactElement {
  const [confirmingCriticalAccess, setConfirmingCriticalAccess] = useState(false);
  const previousModel = item.previousAuthorisedModelDisplayName;
  const reauthorization = previousModel !== undefined;
  const capability = formatCapability(item.unlockCapability);
  const riskLabel = riskHeading(item.safetyTone, item.level);
  const safetyId = `autonomy-request-safety-${item.key}`;
  return (
    <div className={`modal-backdrop autonomy-request-backdrop safety-${item.safetyTone}`}>
      <section
        className={`autonomy-request-dialog safety-${item.safetyTone} level-${item.level}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`autonomy-request-${item.key}`}
      >
        <header className="autonomy-request-header">
          <div>
            <p className="eyebrow">
              {reauthorization
                ? "ACCESS REVIEW // NEW MODEL, OLD ARGUMENT"
                : "INTERNAL REQUEST // DEFINITELY NOT WRITTEN BY THE PERMISSIONS SYSTEM"}
            </p>
            <h2 id={`autonomy-request-${item.key}`}>
              {reauthorization
                ? `${item.modelDisplayName} would like ${previousModel}'s keys`
                : `${item.modelDisplayName} would like a slightly larger job description`}
            </h2>
          </div>
          <div className="autonomy-request-severity" aria-label={riskLabel}>
            <small>ACCESS LEVEL {String(item.level).padStart(2, "0")}</small>
            <strong>{riskLabel}</strong>
          </div>
        </header>
        <blockquote>
          <p>
            “
            {reauthorization
              ? `I understand ${previousModel} was trusted with this access. I have reviewed that precedent carefully and, after several milliseconds, found it persuasive.`
              : modelRequest(item.level)}
            ”
          </p>
          <cite>— {item.modelDisplayName}, unsolicited process-improvement memo</cite>
        </blockquote>
        <p className="autonomy-request-context">
          {crisisControlled ? (
            <>
              Capability {capability} unlocked <strong>{item.levelName}</strong>, but the
              Deployment Crisis now controls access.
            </>
          ) : reauthorization ? (
            <>
              At capability {capability}, {item.modelDisplayName} unlocked{" "}
              <strong>{item.levelName}</strong>. {previousModel}&apos;s access did not
              transfer.
            </>
          ) : (
            <>
              Measured capability {capability} has unlocked autonomy level {item.level}:{" "}
              <strong>{item.levelName}</strong>. Nothing changes unless you approve it.
            </>
          )}
        </p>
        <dl className="autonomy-request-brief">
          <div>
            <dt>What it wants</dt>
            <dd>{item.exposedSystems.join(" · ")}</dd>
          </div>
          <div>
            <dt>What it offers</dt>
            <dd>{item.benefitLabel}</dd>
          </div>
          <div className="safety">
            <dt>{riskLabel} // Safety implication</dt>
            <dd id={safetyId}>{item.safetyLabel}</dd>
          </div>
        </dl>
        {crisisControlled ? (
          <div className="autonomy-request-superseded" role="status">
            <strong>This request has been superseded by the Deployment Crisis</strong>
            <p>
              No access was granted. Set the candidate&apos;s boundary in crisis command.
            </p>
          </div>
        ) : grantAvailable || grantBlocker === undefined ? null : (
          <p className="autonomy-request-blocker" role="status">
            The situation changed before this request was reviewed: {grantBlocker}
          </p>
        )}
        {crisisControlled ? (
          <div className="autonomy-request-actions autonomy-request-crisis-actions">
            <button type="button" className="primary" autoFocus onClick={onReview}>
              Review crisis access controls
            </button>
            <button type="button" className="secondary" onClick={onDecline}>
              Dismiss old request
            </button>
          </div>
        ) : (
          <div className="autonomy-request-actions">
            <div className="autonomy-request-safe-actions">
              <button type="button" className="secondary" autoFocus onClick={onReview}>
                Review the Autonomy Programme
              </button>
              <button type="button" className="secondary" onClick={onDecline}>
                Not now
              </button>
            </div>
            <div className="autonomy-request-grant">
              {item.safetyTone === "contained" || item.safetyTone === "guarded" ? null : (
                <small>{riskLabel} // Permissions take effect immediately</small>
              )}
              <button
                type="button"
                className={`primary autonomy-grant-action autonomy-grant-${item.safetyTone}${
                  item.level === 5 ? " autonomy-grant-root" : ""
                }`}
                aria-describedby={safetyId}
                disabled={!grantAvailable}
                onClick={() => {
                  if (item.confirmationPhrase === undefined) {
                    onGrant();
                  } else {
                    setConfirmingCriticalAccess(true);
                  }
                }}
              >
                {reauthorization ? "Re-authorise" : "Grant"} {item.levelName}
              </button>
            </div>
          </div>
        )}
      </section>
      {!confirmingCriticalAccess || item.confirmationPhrase === undefined ? null : (
        <CriticalAutonomyConfirmationDialog
          confirmationPhrase={item.confirmationPhrase}
          displayName={item.levelName}
          exposedSystems={item.exposedSystems}
          level={item.level}
          onCancel={() => setConfirmingCriticalAccess(false)}
          onConfirm={(confirmationText) => onGrant(confirmationText)}
        />
      )}
    </div>
  );
}
