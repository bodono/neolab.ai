import { useEffect, type ReactElement } from "react";

import { formatValuation, type GameView } from "@neolab/sim/public";

import {
  acceptFundingOfferCommand,
  fundraisingCampaignCommand,
} from "../../app/command-builders.ts";
import { majorProjectActionLabel } from "../../app/major-projects.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";

interface FundraisingDialogProps {
  readonly runtime: BrowserGameRuntime;
  readonly view: GameView;
  readonly onClose: () => void;
}

function humanise(value: string): string {
  return value.replaceAll("-", " ");
}

export function fundraisingAuraShortfallMessage(
  requiredAura: number,
  availableAura: number,
): string | undefined {
  const shortfall = Math.max(0, requiredAura - availableAura);
  return shortfall > 0
    ? `Need ${String(shortfall)} more Aura (${String(availableAura)} available · ${String(requiredAura)} required)`
    : undefined;
}

export function FundraisingDialog({
  runtime,
  view,
  onClose,
}: FundraisingDialogProps): ReactElement {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const liveOffers = view.fundraising.offers.filter(
    (offer) => offer.status === "available",
  );

  function acceptOffer(command: ReturnType<typeof acceptFundingOfferCommand>): void {
    const receipt = runtime.dispatch(command);
    if (receipt.fault === undefined) onClose();
  }

  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog fundraising-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fundraising-title"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">CAPITAL FORMATION DESK</p>
            <h2 id="fundraising-title">Fundraising</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close fundraising"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="fundraising-summary">
          <div>
            <span>Next round</span>
            <strong>{view.fundraising.nextRoundLabel}</strong>
            <small>
              {view.fundraising.latestClosedRound === undefined
                ? "No financing round closed yet"
                : `Last: ${view.fundraising.latestClosedRound.label} · ${formatValuation(view.fundraising.latestClosedRound.cashMillions)}`}
            </small>
          </div>
          <div>
            <span>Funding score</span>
            <strong>{Math.round(view.fundraising.fundingScore)}</strong>
            <small className="funding-score-breakdown">
              Traction {view.fundraising.fundingScoreBreakdown.productTraction} ·
              Capability {view.fundraising.fundingScoreBreakdown.recentCapability} · Aura{" "}
              {view.fundraising.fundingScoreBreakdown.lifetimeAura}
              {view.fundraising.fundingScoreBreakdown.scandalPenalty > 0
                ? ` · −${String(view.fundraising.fundingScoreBreakdown.scandalPenalty)} scandal`
                : ""}
            </small>
          </div>
          <div className="fundraising-summary-market">
            <div>
              <span>Market outlook</span>
              <strong>{view.fundraising.fundingScoreLabel}</strong>
            </div>
            <MechanicHelp label="Fundraising estimates">
              Product traction reflects customer use and served-model revenue. Offers
              scale with valuation. Conditions pay more cash; world capability and recent
              rounds raise Aura costs.
            </MechanicHelp>
          </div>
        </div>

        {view.fundraising.activeCampaign === undefined ? null : (
          <section className="active-campaign" aria-label="Active fundraising campaign">
            <p className="eyebrow">
              {view.fundraising.nextRoundLabel.toUpperCase()} //{" "}
              {view.fundraising.activeCampaign.status === "queued"
                ? "ROADSHOW QUEUED"
                : "ROADSHOW IN PROGRESS"}
            </p>
            <h3>{view.fundraising.activeCampaign.displayName}</h3>
            <p>{view.fundraising.activeCampaign.progressLabel}</p>
          </section>
        )}

        {liveOffers.length === 0 ? null : (
          <section className="funding-offers" aria-labelledby="funding-offers-title">
            <header>
              <p className="eyebrow">
                TERM SHEETS RECEIVED // {view.fundraising.nextRoundLabel.toUpperCase()}
              </p>
              <h3 id="funding-offers-title">
                Choose the offer that closes {view.fundraising.nextRoundLabel}
              </h3>
            </header>
            <p className="funding-offers-explainer">
              Accept one term sheet to receive its cash. The other offers expire.
            </p>
            <div className="offer-list">
              {liveOffers.map((offer) => {
                const command = acceptFundingOfferCommand(view, offer.offerId);
                const validation = runtime.validate(command);
                return (
                  <article className="offer-card funding-offer-card" key={offer.offerId}>
                    <div>
                      <p className="eyebrow">
                        {view.fundraising.nextRoundLabel.toUpperCase()} //{" "}
                        {humanise(offer.investorStyle).toUpperCase()}
                      </p>
                      <h3>{formatValuation(offer.cashMillions)}</h3>
                    </div>
                    <dl>
                      <div>
                        <dt>Structure</dt>
                        <dd>{humanise(offer.dilutionFlavor)}</dd>
                      </div>
                      <div>
                        <dt>Decision due</dt>
                        <dd>
                          {offer.expiresInWeeks} week
                          {offer.expiresInWeeks === 1 ? "" : "s"}
                        </dd>
                      </div>
                      {offer.impliedMarkMillions === undefined ? null : (
                        <div>
                          <dt>Post-money valuation</dt>
                          <dd>
                            {formatValuation(offer.impliedMarkMillions)} — after this
                            investment; it sizes every later round
                          </dd>
                        </div>
                      )}
                      {offer.openingRecapitalisation === undefined ? null : (
                        <div>
                          <dt>Cash after close</dt>
                          <dd>
                            {formatValuation(
                              offer.openingRecapitalisation.postCloseCashMillions,
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {offer.openingRecapitalisation === undefined ? null : (
                      <p className="opening-seed-recapitalisation">
                        Your parents convert the opening credit into their angel stake.
                        This Seed leaves at least $30M in the bank.
                      </p>
                    )}
                    {offer.conditions.length === 0 ? (
                      <p>No unusual conditions beyond the usual unusual conditions.</p>
                    ) : (
                      <ul>
                        {offer.conditions.map((condition) => (
                          <li key={condition.id}>{condition.label}</li>
                        ))}
                      </ul>
                    )}
                    <button
                      className="primary"
                      type="button"
                      data-testid="accept-funding-offer"
                      disabled={!validation.ok}
                      title={
                        validation.ok
                          ? validation.preview.summary
                          : validation.errors.map((error) => error.message).join(" · ")
                      }
                      onClick={() => acceptOffer(command)}
                    >
                      Close {view.fundraising.nextRoundLabel} · accept{" "}
                      {formatValuation(offer.cashMillions)}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="fundraising-capacity-disclosure">
          <div>
            <p className="eyebrow">MAJOR PROJECTS</p>
            <strong>
              {Math.min(
                view.facilities.capacity.occupiedMajorProjectSlots,
                view.facilities.capacity.majorProjectSlots,
              )}
              /{view.facilities.capacity.majorProjectSlots} major-project slots in use
            </strong>
          </div>
          <p>A roadshow uses one slot while active; otherwise it waits in the queue.</p>
        </section>

        <section className="campaign-catalogue" aria-labelledby="campaign-title">
          <header>
            <p className="eyebrow">
              NEXT FINANCING // {view.fundraising.nextRoundLabel.toUpperCase()}
            </p>
            <h3 id="campaign-title">
              Choose how to pursue {view.fundraising.nextRoundLabel}
            </h3>
          </header>
          <div className="offer-list campaign-list">
            {view.fundraising.campaigns.map((campaign) => {
              const command = fundraisingCampaignCommand(view, campaign.campaign);
              const validation = runtime.validate(command);
              const aura = campaign.auraCostBreakdown;
              const availableAura = view.topBar.aura.spendable;
              const auraShortfallMessage = fundraisingAuraShortfallMessage(
                aura.totalAuraCost,
                availableAura,
              );
              return (
                <article className="offer-card campaign-card" key={campaign.campaign}>
                  <p className="eyebrow">
                    {view.fundraising.nextRoundLabel.toUpperCase()} OPTION
                  </p>
                  <h3>{campaign.displayName}</h3>
                  <dl>
                    <div className="campaign-aura-cost">
                      <dt>Aura cost</dt>
                      <dd>{aura.totalAuraCost} Aura</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{campaign.durationWeeks} weeks</dd>
                    </div>
                    <div>
                      <dt>Expected offers</dt>
                      <dd>{campaign.offerCount}</dd>
                    </div>
                    <div>
                      <dt>Estimated capital</dt>
                      <dd>
                        {formatValuation(campaign.estimatedCashRangeMillions[0])}–
                        {formatValuation(campaign.estimatedCashRangeMillions[1])}
                      </dd>
                    </div>
                  </dl>
                  {!validation.ok ? (
                    <p className="validation-error">
                      {validation.errors
                        .map((error) =>
                          error.code === "insufficient-aura" &&
                          auraShortfallMessage !== undefined
                            ? auraShortfallMessage
                            : error.message,
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                  <button
                    className="secondary"
                    type="button"
                    disabled={!validation.ok}
                    onClick={() => runtime.dispatch(command)}
                  >
                    {majorProjectActionLabel(
                      view,
                      `Start ${view.fundraising.nextRoundLabel} · ${campaign.displayName}`,
                      `Queue ${view.fundraising.nextRoundLabel} · ${campaign.displayName}`,
                    )}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        {/*
          The "N conditions recorded for future board and event follow-up" note
          used to live here. Nothing ever followed up: the obligations it counted
          sat at "pending-stage-5" forever. Conditions now apply in full on
          acceptance and expire on their own schedule, so the terms listed on
          each offer are the whole story and there is nothing left to promise.
        */}
      </section>
    </div>
  );
}
