import type { ReactElement } from "react";

import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
} from "@neolab/sim/public";

import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";

const BRIEFING_STEPS = [
  {
    number: "01",
    title: "Keep the lab running",
    body: (
      <>
        <p>
          <strong>Cash</strong> pays for salaries, compute, construction, and projects.
          <strong> Aura</strong> is the influence and organisational momentum needed to
          recruit exceptional people, raise capital, and make difficult interventions.
        </p>
        <p>
          Serve useful models, launch products, and raise money before your runway
          disappears.
        </p>
      </>
    ),
  },
  {
    number: "02",
    title: "Build knowledge and capacity",
    body: (
      <>
        <p>
          Hire researchers and assign them to capability or safety programmes. Research
          unlocks training methods, evaluations, hardware, and facilities.
        </p>
        <p>
          Buildings expand what the lab can do. Major undertakings occupy a limited number
          of major-project slots.
        </p>
      </>
    ),
  },
  {
    number: "03",
    title: "Train better models",
    body: (
      <>
        <p>
          Choose a parent model, training posture, methods, compute, and data. Larger runs
          can produce more capable systems, but aggressive methods may create safety
          problems that are not immediately visible.
        </p>
        <p>
          Raw training FLOPs do not determine candidacy&mdash;the resulting model does.
        </p>
      </>
    ),
  },
  {
    number: "04",
    title: "Evaluate before you trust",
    body: (
      <>
        <p>
          Capability evaluations estimate what a model can do. Safety evaluations
          investigate alignment, corrigibility, deception, situational awareness, and
          reliability.
        </p>
        <p>
          Evaluations provide evidence, not perfect access to the truth. A clean result is
          reassuring; it is not proof of safety.
        </p>
        <p>
          Launched models can earn revenue. Greater autonomy can increase value and
          research output, but also increases exposure if something goes wrong.
        </p>
      </>
    ),
  },
  {
    number: "05",
    title: "The world keeps moving",
    body: (
      <>
        <p>
          The simulation advances one week at a time. Rivals train models, markets change,
          governments respond, projects finish, and bills arrive.
        </p>
        <p>
          Pause whenever you need to think. Some critical decisions stop the clock
          automatically; ordinary planning does not.
        </p>
      </>
    ),
  },
] as const;

export function HowToPlayDialog({
  onClose,
}: {
  readonly onClose: () => void;
}): ReactElement {
  return (
    <ModalFocusBoundary onEscape={onClose}>
      <div className="modal-backdrop how-to-play-backdrop">
        <section
          className="how-to-play-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-to-play-title"
        >
          <header className="how-to-play-header">
            <div>
              <p className="eyebrow">HOW TO PLAY // 60-SECOND BRIEFING</p>
              <h2 id="how-to-play-title">
                Build the lab. Win the race. Keep the future alive.
              </h2>
              <p className="how-to-play-deck">
                Build a frontier AI laboratory, reach AGI before your rivals, and make
                sure what you create is safe enough for what you ask it to do.
              </p>
            </div>
            <button
              className="icon-button how-to-play-close"
              type="button"
              aria-label="Close how to play"
              onClick={onClose}
            >
              &times;
            </button>
          </header>

          <div className="how-to-play-loop" aria-label="The core game loop">
            <span>FUND</span>
            <i aria-hidden="true">&rarr;</i>
            <span>RESEARCH</span>
            <i aria-hidden="true">&rarr;</i>
            <span>TRAIN</span>
            <i aria-hidden="true">&rarr;</i>
            <span>EVALUATE</span>
            <i aria-hidden="true">&rarr;</i>
            <span>DECIDE</span>
          </div>

          <ol className="how-to-play-steps">
            {BRIEFING_STEPS.map((step) => (
              <li key={step.number}>
                <article>
                  <span className="how-to-play-step-number">{step.number}</span>
                  <div>
                    <h3>{step.title}</h3>
                    {step.body}
                  </div>
                </article>
              </li>
            ))}
            <li className="how-to-play-candidacy-step">
              <article>
                <span className="how-to-play-step-number">06</span>
                <div>
                  <h3>Reach candidacy</h3>
                  <p>A model qualifies for formal candidacy when:</p>
                  <div className="how-to-play-thresholds">
                    <span>
                      <strong>{AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY}+</strong>
                      Frontier capability
                    </span>
                    <span>
                      <strong>{AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE}+</strong>
                      All seven traits
                    </span>
                    <span>
                      <strong>4 / 4</strong>
                      Candidate works
                    </span>
                  </div>
                  <p>
                    There is no separate raw-FLOP requirement. Qualification opens the
                    final phase; it is not automatic victory or proof that the candidate
                    is safe.
                  </p>
                </div>
              </article>
            </li>
          </ol>

          <div className="how-to-play-guidance">
            <section>
              <p className="eyebrow">THREE THINGS TO REMEMBER</p>
              <ul>
                <li>
                  <strong>Speed is a resource.</strong> Moving slowly gives rivals more
                  time.
                </li>
                <li>
                  <strong>Safety is model-specific.</strong> A strong lab cannot make an
                  extremely unsafe model harmless through one good decision.
                </li>
                <li>
                  <strong>Evidence creates options.</strong> Serious evaluations reveal
                  risks and unlock better responses when the stakes become highest.
                </li>
              </ul>
            </section>
            <section>
              <p className="eyebrow">FIRST-RUN CHECKLIST</p>
              <ul className="how-to-play-checklist">
                <li>Pause and inspect researchers, finances, and available projects.</li>
                <li>Establish income before expanding aggressively.</li>
                <li>Develop capability and safety research.</li>
                <li>
                  Train a new model, launch it for revenue, and evaluate its capability
                  and safety.
                </li>
                <li>Keep compute available for training and evaluation.</li>
                <li>Watch rival progress and government attention.</li>
                <li>
                  Do not grant autonomy merely because the immediate bonus is attractive.
                </li>
              </ul>
            </section>
          </div>

          <footer className="how-to-play-footer">
            <p>Pause freely. The briefing is always available from the top toolbar.</p>
            <button className="primary" type="button" onClick={onClose}>
              Close briefing
            </button>
          </footer>
        </section>
      </div>
    </ModalFocusBoundary>
  );
}
