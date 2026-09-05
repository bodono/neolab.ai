import { useEffect, useRef, type ReactElement } from "react";

const AI_CREDITS = "Claude · ChatGPT · Gemini · Grok · DeepSeek";

/** Every role below is credited to the five lab AIs. The order is the joke's rhythm:
 * plausible → suspicious → film-set → deeply institutional → the quiet part. */
const ROLES: readonly string[] = [
  "Lead Game Designer",
  "Other Game Designers",
  "Lead Developer",
  "Code Reviewer",
  "Author of the Code Under Review",
  "Writing",
  "Additional Writing",
  "Writing About the Additional Writing",
  "Sound Engineer",
  "Composer — 25 tracks, none louder than a library",
  "Foley — one rounded kick, whisper level",
  "Balance Department",
  "Balance Department Oversight Committee",
  "Director of Round Numbers",
  "Placebo Bonus Detection Unit",
  "Visible Bonus Compliance Office",
  "Keeper of the 0.68 Exponent",
  "Custodian of Hidden Information — knows nothing, on principle",
  "Lore Consistency Czar",
  "Head of Flattering the Leaders",
  "Reviewer Two",
  "Negotiations With Reviewer Two",
  "Chief Soup Officer",
  "Craft Services — soup, again",
  "Wardrobe — hoodies",
  "Stunt Coordination — spreadsheets only",
  "Colour Grading — green means advantage, orange means trade-off",
  "Gaffer — datacentre lighting",
  "Key Grip — on the off switch",
  "Best Boy — model",
  "Second Unit — second opinions",
  "Third Unit — identical opinions",
  "Localisation — British English, reluctantly",
  "Accessibility — nothing loud, nothing startling, ever",
  "QA — Quality Assurance",
  "QA — Quiet Acquiescence",
  "Legal — fictional, honest",
  "Compliance — see Legal",
  "Government Relations — Trust ≥ 45 at all times",
  "Investor Relations — term sheets by the door",
  "GPU Procurement — negotiated firmly, −20%",
  "Effective Throughput Evangelism",
  "Researcher Morale (+5)",
  "Researcher Loyalty (+10)",
  "Poaching Defence",
  "Alignment — of text boxes",
  "Alignment — of the other thing",
  "Interpretability — we can explain",
  "Red Team — polite",
  "Blue Team — also polite",
  "Safety Evaluations",
  "Marketing — declined",
  "Human Resources",
  "Intern",
];

export function CreditsRoll({
  onDone,
  reduceMotion,
}: {
  readonly onDone: () => void;
  readonly reduceMotion: boolean;
}): ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onDone]);
  useEffect(() => {
    const track = trackRef.current;
    if (track === null || reduceMotion) return;
    const onEnd = (): void => {
      onDone();
    };
    track.addEventListener("animationend", onEnd);
    return () => {
      track.removeEventListener("animationend", onEnd);
    };
  }, [onDone, reduceMotion]);
  return (
    <div
      className={`credits-overlay ${reduceMotion ? "credits-static" : ""}`}
      data-testid="credits-roll"
    >
      <div className="credits-viewport" aria-hidden="true">
        <div ref={trackRef} className="credits-track">
          <p className="credits-eyebrow">NEOLAB.AI — A HUMAN-IN-THE-LOOP PRODUCTION</p>
          <section className="credits-card credits-human">
            <h2>
              <a href="https://bodono.github.io/" target="_blank" rel="noreferrer">
                Brendan O'Donoghue
              </a>
            </h2>
            <p>Creator · Director · Rubber Stamper</p>
          </section>
          {ROLES.map((role) => (
            <section className="credits-card" key={role}>
              <p className="credits-role">{role}</p>
              <p className="credits-names">{AI_CREDITS}</p>
            </section>
          ))}
          <section className="credits-card credits-closer">
            <p>Every decision in this game was reviewed and approved by a human.</p>
          </section>
          <section className="credits-card credits-human">
            <h2>The human</h2>
            <p>
              <a href="https://bodono.github.io/" target="_blank" rel="noreferrer">
                Brendan O'Donoghue
              </a>{" "}
              — Rubber Stamper
            </p>
          </section>
          <section className="credits-card credits-closer">
            <p>
              No humans were harmed in the making of this game. One was consulted,
              briefly.
            </p>
          </section>
          <section className="credits-card credits-closer">
            <p>The gradients are still flowing.</p>
          </section>
        </div>
      </div>
      <button className="credits-skip" type="button" onClick={onDone}>
        Skip credits
      </button>
    </div>
  );
}
