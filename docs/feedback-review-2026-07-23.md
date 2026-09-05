# Design and Alpha Feedback Review — 2026-07-23

Status: captured for verification and triage; items are not marked complete merely because related
code already exists.

This review was written against an earlier alpha state. Before implementing an item, inspect the
current production client and simulation. Classify it as:

- `still missing`;
- `implemented but defective`;
- `implemented and needs acceptance review`;
- `superseded by a later design decision`;
- `content-owned`;
- `requires owner choice`.

## 1. New major mechanics

### 1.1 Recursive self-improvement

Make recursive self-improvement a major mid-/late-game loop rather than a flat research bonus.
Design options and a recommended mechanic are in
[`recursive-self-improvement-design.md`](recursive-self-improvement-design.md).

No RSI implementation should begin until the major decisions in that document are reviewed.

### 1.2 Government and military work

Add explicit military and national-security applications:

- revenue, compute, security data, and short-term political protection;
- reduced true safety/control transfer or increased misuse/exposure;
- classified obligations and government dependence;
- researcher-specific objections, ultimatums, departures, and whistleblowing;
- coalition and Aura consequences.

The RSI design recommends keeping the existing four government values and presenting a prominent
derived Regulatory Pressure/Government Posture indicator rather than inventing a spendable
Regulatory Interest resource.

## 2. Identity, art, and visual direction

Current code status: a persistent, accessible light/dark mode now covers the ordinary management
shell; the top identity surface contains quiet state-scaled activity which freezes on Pause; and a
measured-evidence-only capability-index trajectory is visible under the resource cards. These are
implemented for visual/playtest acceptance. Final portraits, logos, facility artwork, and the
owner-selected production art treatment remain gated. Leader cards now show their numeric headline
effects, while the selected-leader dossier shows the complete unclipped biography and every
starting trait.

- Fix clipped leader bonuses and biographies on the selection screen.
- Add semi-accurate pixel portraits for every leader on selection and in-run identity surfaces.
- Add a distinctive AI-themed lab/leader logo and display it prominently.
- Replace researcher initials with approved portraits.
- Give facility families distinct small images.
- Preserve the soundtrack laboratory as a permanent development/audition page.
- Add quiet ambient main-dashboard activity which grows with the lab and stops while paused.
- Add a truthful capability-trajectory chart which can display an exponential regime.
- Add a complete dark mode and a prominent mode toggle.
- Await the explicit final art-treatment selection before generating the full production batch.

## 3. Information architecture and explanations

Current code status: the first remediation tranche is implemented for browser review. The Archive
now contains the complete finance forecast and every active modifier with source/stacking/expiry;
facility reveal is phase/prerequisite gated; canonical IDs are removed from these surfaces; the
Internal Wire is bounded; the title explainer, global version, and pause glyph are updated.
The first accessible focus/click explanation set now covers the resource cards, allocation,
research momentum, rival estimates, and regulatory pressure, and the former “intentionally
withheld” copy has been replaced by an uncertainty-aware momentum explanation. The remaining
raw-ID and explanation audit is still open.

- Add an all-modifiers panel listing every active bonus/penalty and its source.
- Add a complete income/outgoings/net/balance breakdown.
- Explain researcher abilities and other unfamiliar mechanics through accessible hover/focus
  tooltips.
- Expand tooltips throughout the interface without relying on hover alone.
- Replace raw IDs such as `run:lab:rival:0003` and `base:facility.data-centre-1` with display names.
- Hide unrevealed facility definitions from the build catalogue; reveal them only when their
  knowledge/phase prerequisites are satisfied, while still explaining prerequisites for known but
  currently unaffordable facilities.
- Bound or scroll the Internal Wire feed rather than allowing endless page growth.
- Clarify `Progress estimate intentionally withheld`; use rough uncertainty-aware estimates where
  allowed by the hidden-information rules.
- Add a concise title-page explainer focused on building aligned AGI without causing a race to the
  bottom.
- Add visible application/content version information to every major page.
- Change the pause control so it reads unmistakably as a pause icon rather than `II`.

## 4. People and employment

Current code status: signing cash and ongoing salary are visible on the recruiting slate and final
offer; employed dossiers show salary and the next deterministic annual review. Ongoing pay rises
five percent on each individual 52-week contract anniversary and enters the normal finance ledger.
Scoped ability labels retain the subject that previously collapsed several distinct effects into
duplicate-looking “Severity”, “Upfront Cash Cost”, or “Research Output” chips; every effect can be
opened for operation, stacking, appointment, and ramp guidance. Authored numerical conflicts
remain the content workstream's responsibility.

- Every star researcher needs both a signing cost and ongoing salary.
- Salary should grow over time through a documented rule such as market inflation, seniority,
  retention rounds, or contract renegotiation.
- Audit every researcher ability for duplicate or conflicting rendered effects.
- In particular, verify duplicate `UpfrontCashCost −10%`, repeated `Severity −10%`, and apparently
  overlapping `ResearchOutput +18%` / `+12%` lines.
- Explain stacking, scope, and duration in the researcher dossier.

Authored researcher YAML remains owned by the separate content workstream; code-side aggregation,
deduplication, labels, and tooltips can be fixed independently after the catalogue audit.

## 5. Economy and insolvency

Current status: the code-side correction is implemented for review. Standard starts include a
documented 12.0 cash bootstrap runway; accepted financing rounds double later cheque ranges;
negative settlement auto-pauses while an available, active, or launchable fundraising rescue can
cover the deficit; and an emergency Quiet Bridge can consume the remaining positive Aura while
cash is negative. Terminal bankruptcy now requires no legal fundraising rescue. Broader
acquisition/government/founder-guarantee rescue content remains a later authored/system expansion,
and final human balance acceptance is still required.

- Rebalance costs and fundraising because accidental bankruptcy is too common.
- Before terminal insolvency, auto-pause and present every legal rescue action.
- If a valid Aura-funded campaign or committed near-term rescue exists, allow a clearly bounded
  emergency negative balance while it resolves.
- End the run only when no legal rescue, revenue bridge, sale, acquisition, government rescue, or
  founder guarantee remains.
- Make fundraising amounts grow from millions to billions and beyond over the game, with
  era-appropriate display units and obligations.
- Keep rescue decisions strategic; do not silently auto-accept a financing offer.

This must be calibrated in the headless matrix rather than solved by an arbitrary cash grant.

## 6. Research, papers, and rivals

Current code status: player world-firsts now generate a paused educational decision dialog with the
exact immediate score, unlocks, and visible policy Aura/publication-score consequences. Rival
world-firsts enter the bounded wire with the rival lab's display name. The ordinary-event catalogue
and frequent contained sandbox-boundary content remain separately owned/open.

- Make player paper discoveries unmistakable: auto-pause and show the educational card.
- Show the exact immediate Aura/score/unlock consequences of the chosen publication policy.
- Broadcast rival papers less prominently but visibly, with real rival names.
- Recheck that first-seen landmark cards appear whether the player or a rival wins the discovery.
- Make rough research-programme progress legible without exposing undiscovered-paper thresholds.
- Give frequent contained sandbox boundary incidents, including ordinary sandbox escapes, while
  preserving strict catastrophe legality.

## 7. Compute, demand, and models

Current status: implemented and awaiting browser/playtest acceptance. Production new games have no
model, demand, or serving allocation. The first parentless training creates the active internal
model. The portfolio separately tracks the active internal and commercial model, so a trained
successor does not silently replace the served product. External deployment changes the commercial
role. The serving control exposes a deterministic useful-demand cap in percent and GPUs/week,
rejects commands above it, and automatically returns stale excess serving allocation to R&D.

- Prevent serving allocation beyond current effective demand or make the wasted-GPU region
  impossible to miss.
- Show the serving-demand cap directly on the allocation control and in GPUs/week.
- Start demand at zero until the lab has a trained and productised/deployed model or another
  explicit demand-unlock source.
- Begin a new game with no current AI; the first model must be trained.
- Make successor completion, productisation, and selection of the current commercial/internal model
  explicit and reliable.
- Verify the interface clearly indicates when a trained successor replaces the previous current
  model.

These changes materially affect the opening economy, tutorials, seeded fixtures, balance, and model
state. They require a coordinated design update rather than isolated UI patches.

## 8. Notifications and navigation

Current code status: Quit/New Game is implemented with confirmation, save-before-exit, and
conditional resume on cancellation. Auto-pauses now route funding/bankruptcy, training, papers,
people, world/race/politics, and crisis reasons to the relevant decision surface; event overlays
remain blocking. Further acceptance testing with the full event catalogue remains open.

- A funding-offer auto-pause action should open the relevant offer, not merely acknowledge and
  resume.
- Apply the same rule to papers, training completions, access requests, crises, and other actionable
  warnings.
- Add a main-page Quit/New Game action with a destructive confirmation and save-state explanation.

## 9. Audio

Current code status: the main-page control now names the current track, keeps a distinct accessible
music pause/play control, and adds an explicit Next action. Normal laboratory tracks no longer loop
forever: four focus-aware ordered playlists reuse the accepted peaceful tracks and rotate at each
natural ending without consuming simulation RNG. The soundtrack laboratory remains permanent.
This is ready for the next repetition/mix playtest; composing additional originals remains an
asset-production follow-up if the longer rotation still feels repetitive.

- Keep prominent pause/play and next-track controls on the main page.
- Show the current track name, allowing an accessible scrolling treatment only when necessary.
- Reuse suitable existing tracks across more states.
- Add substantially more normal-lab-operation music because that state occupies most play time.
- Preserve the peaceful, non-jarring mix direction across all future music and cues.

The current audio implementation must be acceptance-tested against these requirements before any
item is marked complete.

## 10. Copy, identity changes, and ownership

Current code status: the requested title copy and global `v0.0.0` display are implemented. The
identity renames remain content-owned. The copyright/licensing pass now adds the named owner and
contact to every web route, the repository README, the documentation index, and a dedicated
copyright notice while leaving the canonical GPL text and generated third-party notices intact.

- Rename `Sam Altmann` to `Stan Altmann`.
- Rename `OpenMind` to `ClopenAI`.
- Replace the title copy with:

  > Build the models. Fund the science. Try to keep the GPUs cool and the releases hot. Achieve
  > AGI and usher in an era of aligned prosperity, just don't destroy the world.

- Add copyright attribution for Brendan O'Donoghue and `bodonoghue85@gmail.com` to appropriate
  website, documentation, and licensing surfaces.

Copyright and licence changes require a deliberate repository-wide ownership/licensing pass. Do not
blindly place an email address inside generated third-party licence notices or vendored files.

## 11. Repository presentation

- The README build/test status badge links to the private CI workflow.
- Keep the public-release hold. A green badge or validated Pages artifact is not authorisation to
  make the game public.

## 12. Acceptance order

Recommended order after the RSI design review:

1. Verify every item against the current alpha and mark its real status.
2. Resolve identity/copyright/art-direction owner choices.
3. Fix raw IDs, clipping, action routing, feed bounds, model replacement, and other correctness
   defects.
4. Design opening-model/demand and insolvency/rescue changes together, then rebalance.
5. Implement RSI as a staged mechanics milestone.
6. Add government/military contracts and researcher reactions through the event/content system.
7. Complete portraits, logos, facility art, dark mode, ambient motion, and trajectory chart.
8. Expand normal-operation music and run a new mix review.
9. Run deterministic, balance, accessibility, cross-browser, and real human playtest gates.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
