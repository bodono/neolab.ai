import type { ReactElement } from "react";

import type { MoratoriumForecastView } from "@neolab/sim/public";

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function sourceLabel(id: string, value: number): string {
  if (id === "government-programmes") return `${String(value)} active`;
  if (id === "shared-standards-groundwork") {
    return `${String(value)} public ${value === 1 ? "appeal" : "appeals"}`;
  }
  if (id === "base-difficulty") return "structural";
  if (id === "rival-pressure") return `${String(value)} active programmes`;
  if (id === "intervention-pressure") return `${String(value)} accumulated`;
  return `${Math.round(value)}/100`;
}

export function MoratoriumForecast({
  forecast,
  compact = false,
}: {
  readonly forecast: MoratoriumForecastView;
  readonly compact?: boolean;
}): ReactElement {
  return (
    <section className={`moratorium-forecast${compact ? " compact" : ""}`}>
      <header>
        <div>
          <span>ESTIMATED CHANCE OF A BINDING PAUSE</span>
          <strong>{forecast.probabilityPercent}%</strong>
        </div>
        <div>
          <span>DIPLOMATIC CAMPAIGN</span>
          <strong>{forecast.durationWeeks} weeks</strong>
        </div>
      </header>

      <div className="moratorium-forecast-columns">
        <section>
          <h4>Support for the pause · {forecast.strength.toFixed(1)}</h4>
          <dl>
            {forecast.positiveFactors.map((factor) => (
              <div key={factor.id}>
                <dt>
                  {factor.label}
                  <small>{sourceLabel(factor.id, factor.sourceValue)}</small>
                </dt>
                <dd>{signed(factor.contribution)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h4>Resistance to the pause · {forecast.difficulty.toFixed(1)}</h4>
          <dl>
            {forecast.pressureFactors.map((factor) => (
              <div key={factor.id}>
                <dt>
                  {factor.label}
                  <small>{sourceLabel(factor.id, factor.sourceValue)}</small>
                </dt>
                <dd>−{factor.contribution.toFixed(1)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {forecast.rivals.some((rival) => rival.readinessPercent > 0) ? (
        <div className="moratorium-rival-pressure">
          <span>RIVAL RACE PRESSURE</span>
          {forecast.rivals
            .filter((rival) => rival.readinessPercent > 0)
            .map((rival) => (
              <article key={rival.labId}>
                <div>
                  <strong>{rival.labName}</strong>
                  <small>
                    {rival.candidateActive
                      ? "Candidate process active"
                      : `${String(rival.completedWorks)}/4 works complete${rival.buildingWorks > 0 ? ` · ${String(rival.buildingWorks)} building` : ""}`}
                  </small>
                </div>
                <div>
                  <strong>{rival.readinessPercent}% ready</strong>
                  <small>
                    {rival.confidence} confidence · −{rival.contribution.toFixed(1)}
                    pressure
                  </small>
                </div>
              </article>
            ))}
        </div>
      ) : null}

      <p className="moratorium-forecast-note">
        An estimate, not a guarantee. Rival readiness is recalculated after the campaign
        while world clocks continue.
      </p>
    </section>
  );
}
