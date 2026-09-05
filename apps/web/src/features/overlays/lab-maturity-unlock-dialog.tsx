import type { ReactElement } from "react";

import type { LabMaturityUnlockPresentationQueueItemView } from "@neolab/sim/public";

export function LabMaturityUnlockDialog({
  item,
  onContinue,
}: {
  readonly item: LabMaturityUnlockPresentationQueueItemView;
  readonly onContinue: () => void;
}): ReactElement {
  const opening = item.stage === "garage";
  const complete = item.completionBriefing !== undefined;
  const insolvencyProtected =
    item.stage === "garage" ||
    item.stage === "cluster" ||
    item.stage === "model" ||
    item.stage === "startup" ||
    item.stage === "foundation" ||
    item.stage === "product";
  return (
    <div className={`modal-backdrop lab-maturity-backdrop stage-${item.stage}`}>
      <section
        className="lab-maturity-unlock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`lab-maturity-${item.stage}`}
        data-modal-initial-focus
        tabIndex={-1}
      >
        <p className="eyebrow">{item.chapter}</p>
        <h2 id={`lab-maturity-${item.stage}`}>{item.title}</h2>
        <p className="lab-maturity-narrative">{item.narrative}</p>
        <div className="lab-maturity-mechanic">
          <span>HOW IT WORKS</span>
          <p>{item.mechanic}</p>
        </div>
        {!complete ? (
          <div className="lab-maturity-credit-line">
            <span>OPENING CREDIT</span>
            <p>
              Required chapter purchases keep their real price and may take cash below $0.
              Optional spending still needs cash.{" "}
              {insolvencyProtected
                ? "The insolvency clock begins when fundraising unlocks."
                : "Now that fundraising is available, negative cash counts toward bankruptcy."}
            </p>
          </div>
        ) : null}
        <div className="lab-maturity-unlocked">
          <span>{opening ? "AVAILABLE NOW" : "NEW SYSTEMS ONLINE"}</span>
          <ul>
            {item.unlocked.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
        {item.completionBriefing === undefined ? (
          <div className="lab-maturity-directive">
            <span>NEXT OBJECTIVE</span>
            <strong>{item.directive}</strong>
          </div>
        ) : (
          <div className="lab-maturity-completion-briefing">
            <p className="eyebrow">{item.completionBriefing.eyebrow}</p>
            <h3>{item.completionBriefing.objective}</h3>
            <p>{item.completionBriefing.summary}</p>
            <ol>
              {item.completionBriefing.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ol>
            <small>{item.completionBriefing.note}</small>
          </div>
        )}
        <footer>
          <small>
            {complete
              ? "The opening chapters are complete. From here, the simulation will not protect the lab from haste, uncertainty, rivals, or its own decisions."
              : "Objectives remain visible on Overview."}
          </small>
          <button type="button" onClick={onContinue}>
            {opening
              ? "Open the garage"
              : complete
                ? "Enter the full game"
                : "Continue building"}
          </button>
        </footer>
      </section>
    </div>
  );
}
