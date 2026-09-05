# Valuation Mechanic — Design Plan

Status: **implemented** (commit `e7d677f`). This document is the design of
record; deviations made during implementation are noted inline.
Scope: a lab-valuation system spanning ~$50M seed to $1T+ near-AGI, for the
player and all rivals, integrated with fundraising, events, and score.

Reference points: real frontier labs run ~$50M (2012 seed era) to ~$1T
(Anthropic, 2026). The game's alternate history should trace the same arc —
about four orders of magnitude across a campaign, with the last order arriving
in a rush as AGI candidacy approaches.

---

## 1. Design goals

1. **A second number-goes-up arc.** Cash is operational; Aura is social;
   valuation is *belief about the future*. It should dwarf both by endgame and
   make the scale of the thing the player is building legible.
2. **Markets price public information only.** Valuation must derive from
   player-visible signals (measured capability, revenue, aura, incidents,
   climate) — never `trueCapability`/`hiddenSafety` directly. A deceptively
   misaligned model with great benchmarks *should* produce a magnificent
   valuation. That is the satire and the tragedy.
3. **It must do something.** Valuation sets fundraising round sizes (replacing
   the crude `2^rounds` doubling), prices conditions, and creates new
   failure/comedy states (down rounds, AGI repricing, the $1T milestone that
   changes nothing about the eval backlog).
4. **Rivals live on the same ladder**, seen through the existing noisy-signal
   projection, so the league table becomes a second race track next to the
   capability comparison.

## 2. Core model

### 2.1 The mark

Each lab carries a continuous **market mark** `V` (in $M), updated weekly in
log-space, plus an **official mark** set at accepted funding rounds.

Target mark (computed weekly per lab, from *visible* state only):

```
revenueRunRate  = sum(segment.lastCycleRevenueMillions) * 13        # annualised
revenueValue    = revenueRunRate * revenueMultiple(fundingClimate)  # ~8-25x
capabilityValue = optionBase * exp(k * measuredFrontierCapability)  # the dream
hypeMultiplier  = 0.6 + auraSignal/100 * 0.8                        # 0.6-1.4
trustMultiplier = 0.7 + investorTrust/100 * 0.6                     # 0.7-1.3
agiRepricing    = 1  |  ~3 at frontier>=80  |  ~8 while candidate confirmed
haircuts        = product of active penalties (restriction, incidents, scandal)

targetV = max(floorV, (revenueValue + capabilityValue))
          * hypeMultiplier * trustMultiplier * climateMultiplier
          * agiRepricing * haircuts
```

The mark then moves toward `targetV` with **momentum** (e.g. closes ~15% of the
log-gap per week, keyed noise ±few %), so it behaves like a market: it trends,
overshoots slightly, and visibly reacts to news rather than teleporting.

- `capabilityValue` is exponential in *measured* frontier capability. This is
  what carries the arc from hundreds of millions (capability ~15) to hundreds
  of billions (capability ~75) without revenue justifying it. Tune `k` so the
  jumps between capability tiers roughly 3-5x the mark.
- `floorV`: assets + cash — a lab with GPUs is never worth $0 until it is.
- All parameters live in `content/balance.yaml` under a new `valuation:` block.

### 2.2 Event shocks

Discrete news applies an immediate multiplicative shock to the mark (then
momentum continues). Sourced from existing domain events — no new detection
needed:

| Event (existing signal)                  | Shock to mark |
| ---------------------------------------- | ------------- |
| World-first paper published              | +3-8% (famous papers more) |
| Model launch, by capability tier         | +10-40% |
| AGI candidacy confirmed (`agi-candidate`)| enters ×8 repricing regime |
| False Dawn / candidate archived          | repricing collapses, extra −25% overshoot |
| Incident: serious / major / critical / catastrophe | −3% / −10% / −25% / −70% |
| Government: reporting / licensing / restriction / nationalisation | −2% / −8% / −20% / mark frozen, "state asset" |
| Down round accepted                      | mark := round mark; investorTrust −10 |
| Rival candidacy news                     | sector-wide +15% (tide lifts), relative league drop |
| Funding climate swings (existing)        | already inside `climateMultiplier` |
| Star researcher signing / principled resignation | +1-2% / −2-4% |

Incidents thus hit labs **four ways** (aura, fines, scrutiny, mark) — each
small, but coherent: the market reads the same feed the player does.

### 2.3 Rival valuations

**No new rival behaviour.** Rivals do not raise, run campaigns, or announce
rounds — their existing `LabState` economics already contain everything the
formula needs. Their **true mark** is computed weekly by the same function as
the player's, from their current state, and stays hidden.

The player sees a **reported valuation**: the true mark viewed through a
keyed noise offset, deliberately shaped so the number cannot be inverted into
precise rival state:

- the noise offset is **re-drawn quarterly** (keyed on labId + quarter) and
  interpolated between draws, so week-to-week movement in the reported figure
  is dominated by noise, not by the rival's actual week;
- the displayed value is **quantized to coarse buckets** (e.g. 1-2-5 steps)
  and always shown as a band, never a point;
- the noise radius scales with the existing intelligence-quality concept
  (better espionage → tighter bands), reusing the capability-estimate
  presentation — no new rival mechanics, only a new projected readout.

Real trends still emerge — a rival compounding capability for a year visibly
climbs the league — but only at quarter resolution, which is exactly the
fidelity a private-market rumour mill should have.

## 3. Display

### 3.1 Player

- **No new HUD card** — the command-status strip is full (six cards, uniform
  height; a seventh wraps badly and a taller card grows the whole strip).
  Instead, restructure the **Cash card** at zero height cost: merge its two
  related small lines (`in/out/net` + `runway`) into one
  (`−$4.6m net · 38.8w runway` — full detail stays in Finances), freeing the
  second small line for `Valuation ~$4.2B · rerating` (one-word market mood:
  `rerating`, `frothy`, `wobbly`, `repricing`). The valuation then sits on
  the card that already owns the Fundraise button — the number and the action
  it drives share a surface. Compact notation throughout: $180M → $4.2B →
  $1.1T. **V1 ships without any HUD change**: the mark moves slowly by
  design, so the Finances panel, milestone toasts, and feed shocks carry it
  until the fundraising coupling (V2) makes it action-relevant.
- **Finances & score workspace**: a valuation panel with the breakdown bars
  (revenue value / capability option / hype / trust / haircuts), the official
  last-round mark vs current mark, and round history. Reuses the
  `FundingScoreBreakdownState` presentation pattern.
- **Milestones** (once per run, decisionLog + toast, satirical register):
  unicorn ($1B), decacorn ($10B), hectocorn ($100B), and $1T — "The lab is now
  worth one trillion dollars. The eval backlog is unaffected."
- **Chatter integration**: ambient pools gain valuation-gated lines (post-$1T
  register; down-round gallows humour folds into TIGHT_MONEY's family).

### 3.2 Rivals

- **World & rivals workspace**: each rival row adds `reported ~$120-180B`,
  uncertainty styled exactly like the capability estimate track (same widget
  language: never a point estimate, always a band).
- **League table**: labs sorted by reported mark, player inline — the second
  standings board next to frontier capability. Deliberately comic when the
  ordering disagrees with the capability board.
- RIVAL GOSSIP ambient lines already mock announcements; add round-rumour
  lines ("{lab} is raising at a valuation described as 'forward-looking'.").

## 4. Fundraising integration

1. **Round size from valuation** — offers raise ~12% of the current mark.
   **Implementation note:** the `2^acceptedRounds` ladder is retained as a
   *floor* rather than removed. The rest of the economy (compute prices,
   project costs, phase pacing) is tuned against it, and deleting it starved
   early labs badly enough that scripted runs no longer reached the Frontier
   phase. Valuation lifts the ceiling; the ladder protects the early game.
2. **Rounds set the official mark** — accepting an offer marks the company at
   the implied valuation (small premium/discount by offer shape). The official
   mark is the anchor the market mark drifts from.
3. **Down rounds** — raising while the mark sits below the last official mark
   is allowed but priced: investorTrust penalty, aura loss, morale ding,
   nastier covenant tiers (existing conditions machinery), and the board
   remembers. Sometimes eating the down round is correct play; make it hurt
   but not dumb.
4. **Investor influence (light equity model)** — no cap table. Track
   cumulative `raisedToDate / currentMark`; high ratios raise an *investor
   influence* pressure that feeds existing boardPatience dynamics ("you sold
   the story; the story now has opinions"). Full dilution/ownership modelling
   is deliberately out of scope (v2 if wanted).
5. **Insolvency rescue** reprices against the mark: distressed raises at
   `0.4×` mark — survival at reputational cost, replacing flat rescue values.

## 5. Score and endgame

- Milestones feed **Institution Building** score (unicorn 50 / decacorn 100 /
  hectocorn 200 / trillion 400).
- Final mark contributes to **Prosperity and Impact** — logarithmically, so
  score never says "the only thing that mattered was the number".
- Endings gain valuation epilogue lines: what the mark did in the last week of
  the world (aligned-AGI: "the question of what a dollar is now under review";
  ruin: "briefly the most valuable object ever destroyed by its own product").
- Nationalisation: mark frozen as "strategic asset — priceless, worthless".

## 6. Implementation sketch (for later)

- **State**: `lab.finance.valuation?: { mark, officialMark, lastRoundAt,
  momentum }` + `world.sectorSentiment?` — optional fields only (old saves
  load; the weekly step initialises from current state on first tick).
- **New module** `packages/sim/src/finance/valuation.ts`: pure target
  computation + weekly advance + shock application; keyed draws
  (`randomKey("valuation", labId, ...)`); event shocks consumed from the
  domain-event stream in the same advance step (no new emitters needed).
- **Advance-tick**: one new step after market settlement, before politics.
- **Selectors**: `GameView` additions (player breakdown; rival reported bands
  via the signal-projection helpers).
- **UI**: HUD card, finance panel, rival-watch rows, milestone toasts.
- **Content**: tuning currently lives in `VALUATION_TUNING` in
  `packages/sim/src/finance/valuation.ts` — a single exported object — rather
  than `content/balance.yaml`. Migrating it to authored content is a clean
  follow-up; scoring.yaml milestone entries are not yet wired.
- **Tests**: magnitude-arc golden test (scripted campaign hits ~$100M / ~$5B /
  ~$500B bands by era), determinism/replay, down-round trust, incident shock,
  rival projection error shrinks with intelligence.
- **Sequencing note**: touches `state.ts`, `schema.ts`, `game-view.ts`,
  `advance-tick.ts`, `balance.yaml` — all currently carrying the other
  workstream's uncommitted changes. Land after their in-flight work commits.

Phasing: **V1** mark + player display (read-only, no gameplay effect) →
**V2** fundraising coupling (round sizes, official marks, down rounds) →
**V3** rival reported marks + league table → **V4** shocks, milestones, score,
endgame epilogues.

## 7. Risks and guardrails

- **Feedback loop** (mark → bigger raises → compute → capability → mark) *is*
  the AI-investment supercycle and belongs in the game — but brake it with
  investor influence, climate cycles, and down-round friction so runaway
  compounding isn't strictly optimal.
- **No double-counting Aura**: aura is an *input* to the mark; the mark must
  never feed aura back. One direction only.
- **Hidden-information contract**: the mark reads measured capability and
  public events only. Verify no `hiddenSafety`/`trueCapability` reference
  survives review; incidents are the sanctioned reveal channel.
- **Momentum state must replay**: momentum/noise via keyed draws on (labId,
  tick) — no accumulated float drift outside state.
- **Formatting**: one shared compact-currency formatter ($999M → $1.0B →
  $999B → $1.0T) to keep HUD, feed, and rival rows consistent.
