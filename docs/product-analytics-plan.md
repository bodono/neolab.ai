# Neolab.ai product analytics and telemetry plan

> Status: Implemented for configured production builds using Hosted Umami Cloud
>
> Last reviewed: 1 August 2026
>
> Recommended first provider: Umami Cloud, behind a provider-neutral adapter

## 1. Purpose

Neolab.ai needs enough product analytics to answer a small set of important questions:

- How many browsers visit the game, and how many runs are started?
- How far do runs progress before players stop?
- How many runs reach each major model, research, deployment, and endgame stage?
- Which endgame routes and endings are reached, and how often?
- Which important decisions are overwhelmingly popular or almost never chosen?
- Which releases or game surfaces produce runtime faults?

The objective is to improve pacing, clarity, balance, and reliability. It is not to build an
advertising profile, record everything a player does, or reconstruct hidden simulation state.

This plan deliberately separates three systems:

1. **The deterministic simulation** remains a pure functional core with no analytics dependency.
2. **Local diagnostics** remain consent-gated, local-only, bounded, and manually exported by the
   player. They gain no automatic transport.
3. **Product analytics** are a configured browser-shell service that automatically sends only an
   approved, low-cardinality event schema in published production builds.

## 2. What the numbers can and cannot mean

Without accounts, a browser game cannot count unique human beings exactly.

| Metric | What can be measured | Important limitation |
|---|---|---|
| Visitors | Estimated unique browsers or devices | One person can use several browsers; several people can share one; storage clearing and blockers cause undercounting |
| Sessions | Provider-defined visits | Session rules and blocked scripts vary |
| Runs started | Exact observed `run_started` events | Runs from unconfigured builds or blocked provider scripts are absent |
| Milestones and endings | Exact observed events | They are exact within the observed analytics sample, not for every player |
| Funnel conversion | Share of observed runs reaching later stages | Cross-session run continuity requires an anonymous run identifier |

Dashboards and public claims should therefore use wording such as **observed players**, **estimated
visitors**, and **observed runs**. “Total players” must not be presented as an exact human count.

## 3. Recommendation: Umami first, GA4 only if needed

### 3.1 Umami Cloud

Umami is the recommended first provider because its hosted tracker supports JavaScript custom
events and event properties while being designed around cookie-free, non-fingerprinting analytics.
Umami Cloud provides a hosted free tier, so it does not require operating a server.

Advantages for Neolab.ai:

- substantially simpler privacy posture;
- custom event names and properties are sufficient for the progression and ending questions;
- small tracker and simple hosted deployment;
- data can be exported;
- no need to introduce Google advertising infrastructure.

Limitations:

- unique people remain estimates;
- advanced cross-session funnels and cohort analysis are less mature than GA4;
- every event and event-data record consumes hosted-plan usage, so the event set must stay sparse;
- provider limits and the current free allowance must be checked again immediately before launch.

### 3.2 Google Analytics 4

GA4 is a viable fallback if richer explorations, funnels, cohorts, or attribution become important.
It supports custom events, parameters, Realtime, and DebugView. Its default web implementation,
however, uses first-party `_ga` cookies to distinguish users and sessions, collects a broader set of
device and approximate-location data, and adds consent and privacy complexity. Consent Mode adjusts
tag behaviour but is not itself a consent banner.

### 3.3 Decision

Implement one provider-neutral analytics interface and connect **only Umami Cloud in phase one**.
Do not send every event to both providers: dual collection creates divergent numbers, doubles the
privacy surface, and makes every test and schema migration more complicated. Reconsider GA4 only
after real use shows that the Umami dashboard cannot answer an agreed question.

## 4. Privacy and data boundaries

### 4.1 Data that may be sent

- application version and content-bundle version;
- deployment channel: GitHub Pages, itch.io, or another approved production host;
- a random, non-semantic run analytics ID when cross-session run funnels are enabled;
- approved event names and enum-valued properties;
- coarse capability, research, duration, and in-game-week buckets;
- the ordinary game page path and cookie-free visit metadata attached by Hosted Umami;
- sanitized runtime-fault scope, code, error class, and stable crash fingerprint;
- an optional normalized top application-frame identifier with origins, paths, query strings, line
  numbers, and arguments removed.

### 4.2 Data that must never be sent

- save files, command logs, run seeds, or hidden simulation state;
- true hidden alignment, awareness, deception, or other safety values;
- free-form player text;
- names, email addresses, account identifiers, or a custom persistent person ID;
- URL query strings or fragments, especially developer scenario parameters;
- exception messages, raw or truncated stack traces, crash diagnostics, or downloaded diagnostic
  JSON;
- exact high-cardinality economic or gameplay state merely because it is available;
- audio state, pointer trails, keystrokes, or screen recordings.

### 4.3 Identifier policy

Phase one should not create a permanent installation or person identifier. If cross-session funnels
are required, generate a random `telemetryRunId` when a run is created and store it in browser save
metadata, separate from the canonical simulation state. It identifies one game run, not one person,
and is never derived from the deterministic seed.

If a later product question genuinely requires returning-player cohorts, a persistent anonymous
installation ID must be treated as a separate privacy decision, documented and consented to rather
than quietly added.

### 4.4 Disclosure and collection policy

Configured production builds load Hosted Umami and collect the approved event set automatically.
There is no in-game analytics opt-out. The title screen discloses the provider, purpose, and payload
limits. Local development, localhost, builds without a Hosted Umami website ID, and developer
endgame scenarios remain hard-disabled. Before public launch, configure the shortest useful provider
retention and complete the privacy/legal review appropriate to the launch regions. Cookie-free is
useful, but it is not by itself a complete legal analysis.

## 5. Technical architecture

Analytics belongs in the browser application, never in `packages/sim`.

Proposed structure:

```text
apps/web/src/telemetry/
  analytics-events.ts           # typed event and property allowlist
  analytics-config.ts           # production/host/scenario gating
  analytics-client.ts           # safe no-op facade and validation
  analytics-ledger.ts           # opaque run IDs and exact-once emission
  crash-sanitizer.ts            # bounded crash classifications and fingerprints
  runtime-analytics-observer.ts # canonical state-transition observer
  umami-provider.ts             # Hosted Umami adapter
```

The public interface should be deliberately small:

```ts
interface AnalyticsClient {
  track(name: AnalyticsEventName, data: AnalyticsData): void;
  trackRuntimeFault(fault: RuntimeFault, error: unknown): void;
  dispose(): void;
}
```

Provider loading and event delivery must be best-effort. A blocked script, offline browser, quota
error, malformed provider response, or thrown provider callback must never pause the clock, change a
command, corrupt a save, or show a runtime-fault screen.

### 5.1 Configuration

Suggested build-time configuration:

```text
VITE_ANALYTICS_PROVIDER=none|umami
VITE_UMAMI_WEBSITE_ID=29f3bde0-f7b6-4a4b-8e43-43cb99121aa1
VITE_DEPLOYMENT_CHANNEL=github-pages|itch|production-preview
```

Website and measurement IDs are public configuration identifiers, not secrets. Analytics defaults
to `none` for localhost, tests, preview fixtures, and every `?scenario=endgame-*` developer scenario.
Developer playtests must not pollute production funnels.

### 5.2 Observe outcomes, not clicks

The runtime analytics observer should subscribe to canonical runtime snapshots and emit events only
when state actually transitions. Button handlers are the wrong source of truth: a click may be
rejected, queued, repeated, restored from a save, or superseded by an automatic action.

The observer must also distinguish the player lab from rivals. A rival crossing a candidate
threshold must never emit the player’s `candidate_threshold_cleared` milestone.

### 5.3 Idempotency

React Strict Mode, re-renders, save reloads, and subscription replacement can otherwise duplicate
events. Each once-per-run milestone needs a stable deduplication key, for example:

```text
telemetryRunId + event schema version + milestone ID
```

Deduplication state should live in save metadata or bounded browser analytics metadata so reloading a
save does not emit every historical milestone again. Stage transitions that may legitimately repeat
must include a transition sequence or explicit `entered`/`left` phase.

## 6. Event schema

All events are versioned, typed, allowlisted, and low-cardinality. Event names use `snake_case` and
provider adapters map them to provider-specific constraints.

### 6.1 Lifecycle events

| Event | When | Properties |
|---|---|---|
| `app_loaded` | Production game becomes usable | `app_version`, `content_version`, `deployment_channel` |
| `game_setup_opened` | New-game setup first opens | `deployment_channel` |
| `run_started` | A new canonical run is successfully created | `telemetry_run_id`, `leader_id`, `difficulty_id`, `mandate_id`, versions |
| `run_resumed` | A saved run successfully becomes active | `telemetry_run_id`, `run_week_bucket`, `run_age_bucket` |
| `run_ended` | A terminal ending is committed | fields in section 6.4 |
An implicit tab close is not a reliable `run_abandoned` signal. Initially, record abandonment only
when the player explicitly leaves a live run or starts a new one; report other drop-off through
funnel non-completion.

### 6.2 Progression milestones

Use one `milestone_reached` event with an allowlisted `milestone_id`:

- `first_researcher_hired`
- `first_fundraise_closed`
- `first_paper_discovered`
- `first_model_trained`
- `first_model_productised`
- `first_model_deployed`
- `model_tier_1` through the highest defined tier
- `agi_candidate_programme_started`
- `agi_candidate_work_1` through `agi_candidate_work_4`
- `candidate_threshold_cleared`
- `deployment_crisis_started`

Common properties:

- `telemetry_run_id`;
- `run_week_bucket`;
- `active_play_time_bucket`;
- `leader_id`, `difficulty_id`, and `mandate_id`;
- optional `capability_band` and `safety_research_band` where relevant.

Do not emit an event for ordinary weekly research levels, notifications, slider changes, or every
paper. Those volumes would obscure the funnel and consume event allowance without answering a
priority question.

### 6.3 Endgame events

`endgame_stage_changed` records player-candidate transitions, with `stage_id` and `phase`:

- `candidate_confirmation`
- `operating_boundary`
- `evidence_sprint`
- `final_review`
- `deployment_rollout`
- `containment_failure`

`phase` is `entered`, `completed`, or `left_without_completion`. Route-specific sub-stages can be
added only when a dashboard question requires them.

`major_decision_made` records a curated set of endgame and high-impact decisions with only stable
`decision_id`, `choice_id`, `stage_id`, and coarse run context. It must not become a generic record of
every click or event choice.

### 6.4 Ending event

`run_ended` is emitted once with:

- `ending_id`;
- `outcome_class`: `victory` or `loss`;
- `human_outcome`: a small enum such as `abundance`, `survival`, `subjugation`, or `extinction`;
- `deployment_route`;
- `final_access_level`;
- `capability_band`;
- `capability_research_band` and `safety_research_band`;
- `run_week_bucket` and `active_play_time_bucket`;
- `ending_source`: player deployment, containment failure, rival ascendance, bankruptcy, or another
  allowlisted terminal source.

For rival ascendance, include allowlisted `rival_id` and rival model tier, not arbitrary model names.

### 6.5 Reliability event

An optional `runtime_fault` event may contain only:

- `fault_code`;
- `fault_scope`;
- `error_class`: an allowlisted built-in class such as `TypeError`, `RangeError`, or `other`;
- `fault_fingerprint`: a one-way hash of normalized application frames, used only to group likely
  instances of the same fault;
- `top_application_frame`: an optional normalized module/function identifier with no hostname,
  filesystem path, query string, arguments, line number, or column number;
- `run_week_bucket`;
- application and content versions;
- deployment channel.

The browser may inspect a stack locally to derive the fingerprint and normalized top frame, but the
raw stack must never be placed in an analytics event, provider queue, browser analytics storage, or
debug log. Normalization must discard non-application frames and remove origins, local filesystem
paths, query strings, function arguments, line and column numbers, and other unbounded text before
hashing. The full exception message and stack remain only in the existing downloadable crash
diagnostic, which is the detailed debugging route.

This is an intentional separation of concerns. Umami and GA4 are product-analytics systems: their
event-property limits truncate stack traces, while trace variants create high-cardinality data that
is difficult to group and may contain unintended information. If automatic full-stack reporting is
later required, add a dedicated error-monitoring service as a separate privacy decision, with source
maps, sampling, retention limits, and pre-send redaction. Do not expand `runtime_fault` to become an
error-reporting transport.

### 6.6 Bucketing rules

Continuous values should be bucketed before transmission:

- capability and research: `0-9`, `10-19`, …, `90-100`;
- in-game week: `0-25`, `26-51`, `52-103`, `104-207`, `208-415`, `416+`;
- active play time: `<15m`, `15-59m`, `1-2h`, `2-4h`, `4-8h`, `8h+`;
- access: the existing finite access-level enum;
- ending, leader, mandate, route, and decision values: authored IDs from explicit allowlists.

Do not transmit raw cash, valuation, FLOP, precise probability, or precise safety values merely to
avoid defining a useful bucket.

## 7. Dashboards and questions

### 7.1 Audience overview

- estimated visitors;
- sessions;
- production app loads;
- runs started;
- run starts per estimated visitor;
- save resumes;
- split by deployment channel and release version.

### 7.2 Main progression funnel

```text
run started
  -> first model trained
  -> first model deployed
  -> first high-tier model
  -> Candidate Programme started
  -> candidate threshold cleared
  -> Deployment Crisis started
  -> run ended
```

Report both event counts and unique observed run IDs. This reveals where players stop without
instrumenting every intermediate action.

### 7.3 Endgame funnel

```text
threshold cleared
  -> candidate confirmation
  -> operating boundary
  -> evidence sprint
  -> final review
  -> deployment rollout
  -> ending
```

Break down by deployment route, assistance/access choice, outcome class, human outcome, and ending
ID. Show explicit counts for every implemented game-over screen so an ending that is unreachable or
overwhelmingly common becomes obvious.

### 7.4 Balance and choice review

- major decision choice shares;
- completion and ending rates by leader, mandate, and difficulty;
- coarse capability and safety-research bands at endgame entry and ending;
- time and in-game weeks to the main milestones;
- rival ascendance versus player deployment versus non-endgame losses.

Small samples must be labelled and should not prompt immediate balance changes.

### 7.5 Reliability

- runtime faults by release, scope, and code;
- event volume by event name, to detect accidental event storms;
- duplicate milestone and duplicate ending rate, which should be zero;
- events unexpectedly received from localhost or developer scenarios, which should be zero.

## 8. Testing strategy

Analytics needs additional automated coverage beyond ordinary UI tests. The test architecture uses an
in-memory provider; unit and browser tests must never contact Umami or Google.

### 8.1 Schema and privacy tests

- every event union member accepts its documented fields and rejects unknown fields;
- event and property names satisfy both provider naming limits;
- raw continuous values are bucketed correctly at every boundary;
- forbidden keys such as `seed`, `saveState`, `stack`, `exception`, and hidden safety traits cannot be
  represented by the typed public API;
- provider payload snapshots contain only approved fields;
- developer scenario query strings and full URLs never enter event properties;
- the Hosted Umami script is configured to exclude URL query strings and automatic page views;
- adversarial exception fixtures containing email-like text, save fragments, command payloads,
  query parameters, absolute filesystem paths, and hidden-state names produce none of those values
  in the analytics payload;
- crash fingerprints are stable for equivalent normalized application frames and differ for
  materially different faults;
- changes to URL origin, cache-busting query, filesystem prefix, line number, column number, or
  non-application frames do not change the normalized fingerprint;
- `top_application_frame` is bounded and contains no raw URL, path, arguments, or source position;
- raw stacks never reach the in-memory provider, provider adapter, retry queue, or analytics debug
  logger.

### 8.2 Analytics client tests

- unavailable or hard-disabled analytics is a true no-op and does not load a provider;
- a provider throw, rejected promise, blocked script, storage error, or offline state is swallowed;
- provider failure cannot alter runtime state or surface a game crash;
- queued events are bounded and old events are discarded rather than growing indefinitely;
- disposal unsubscribes all observers and sends no later events.

### 8.3 Runtime observer tests

- a canonical state transition emits its milestone exactly once;
- a rejected button click emits nothing;
- queued work emits a milestone only when the authored milestone actually completes;
- React Strict Mode double mounting and ordinary re-renders do not duplicate events;
- loading the same save twice does not replay historical milestones;
- resuming a run emits `run_resumed`, not another `run_started`;
- starting a second genuinely new run emits a distinct run ID;
- rival milestones never emit player milestones;
- player Candidate Programme works 1–4 emit in order and at most once;
- every player endgame stage emits the correct entered/completed/left transition;
- every terminal ending ID emits exactly one `run_ended` with the correct outcome and human-outcome
  classification;
- nonterminal endgame returns do not emit `run_ended`;
- explicit quit/new-game behavior records only the approved abandonment signal.

### 8.4 Persistence and migration tests

- the anonymous telemetry run ID persists across save, reload, import, and resume without entering
  canonical hidden simulation state;
- old saves without telemetry metadata receive a new random analytics run ID without failing schema
  validation;
- deduplication metadata remains bounded;
- clearing analytics data does not delete or damage saves;
- imported copies receive a documented identity policy so they do not silently double-count the same
  historical milestones.

### 8.5 Browser and end-to-end tests

Add a fake analytics provider to Playwright/browser fixtures and cover:

1. start a run;
2. reach a representative early milestone;
3. save and reload;
4. verify no milestone replay;
5. enter a developer endgame fixture using only the injected in-memory test provider;
6. traverse each endgame stage;
7. reach a victory and a loss in separate runs;
8. assert one correctly classified ending payload for each;
9. simulate provider failure throughout and assert the game remains playable.

The existing endgame scenario matrix should drive parameterized coverage for every ending family.
This is especially important because developer scenarios are disabled in real analytics but are the
fastest deterministic way to verify event classification.

### 8.6 Provider-contract and manual verification

- contract-test the Umami adapter against a captured local stub of `window.umami.track`;
- verify event-name length, data types, string length, number precision, and property count against
  current Umami limits;
- run a production-preview smoke test and inspect the browser network request;
- confirm one synthetic run in the provider’s live event view and reconcile it against the expected
  event ledger;
- verify ad blocking, denied consent, and a missing provider script all leave the game usable;
- if GA4 is ever added, repeat the contract tests and validate with GA DebugView and Tag Assistant.

### 8.7 Required test gate

Analytics implementation is not complete until CI proves:

- no production network requests occur in unit, browser, or Playwright tests;
- the typed schema and privacy tests pass;
- one synthetic run produces the exact expected ordered event ledger;
- every ending ID is covered by a classification test;
- duplicate events remain zero across Strict Mode, save/resume, and endgame transitions;
- an analytics provider outage cannot fail a simulation transition or presentation render.

## 9. Rollout plan

### Phase 0 — measurement contract — complete

- approve the questions, event allowlist, buckets, identifier policy, and privacy notice;
- choose the Umami Cloud data region and verify the current hosted-plan limits;
- collect automatically in configured production builds without an in-game opt-out.

### Phase 1 — safe foundation — complete

- implement typed events, no-op client, production gating, and in-memory test provider;
- keep provider set to `none` in every deployed build;
- land the full schema, failure-isolation, and privacy test suite first.

### Phase 2 — core funnel — complete in code; provider configuration pending

- connect Umami Cloud;
- emit lifecycle and major progression milestones only;
- build audience and main progression dashboards;
- observe event volume and duplicate rate for at least one release.

### Phase 3 — endgame and endings — complete in code

- add endgame stage transitions, curated major decisions, and `run_ended`;
- parameterize tests over every endgame scenario and ending classification;
- build the endgame funnel and ending distribution dashboard.

### Phase 4 — reliability — complete in code

- add sanitized `runtime_fault` events containing only the approved classification fields,
  normalized top frame, and one-way crash fingerprint;
- reconcile fault counts with voluntarily submitted local diagnostics;
- add malicious-stack redaction, fingerprint-stability, provider-payload, and failure-isolation tests
  before enabling the event;
- do not expand the payload to include exception messages, stack traces, diagnostic JSON, or hidden
  state;
- evaluate a dedicated error-monitoring service separately if automatic full-stack collection is
  ever required.

### Phase 5 — reassess

After enough real traffic exists, list questions Umami cannot answer. Add GA4 only if those questions
are valuable enough to justify its additional consent, identifier, retention, and testing burden.

## 10. Hosting considerations

GitHub Pages and itch.io can both load a hosted analytics script because the game is a static web
application. The build still needs production configuration and network access, and browser privacy
tools will undercount traffic. An itch.io iframe may also change referrer/session behaviour, so every
event must include a low-cardinality deployment channel and both hosts need separate smoke tests.

Analytics IDs embedded in a static build are not credentials. No API secret should be placed in Vite
client environment variables.

## 11. Acceptance criteria

- The owner can see estimated visitors, sessions, observed runs, and main funnel conversion.
- The owner can see counts for every player endgame stage and every ending ID.
- Rival progress is never attributed to the player.
- Save/resume, Strict Mode, and re-renders do not duplicate milestones or endings.
- No forbidden or hidden state appears in payload snapshots or provider traffic.
- Developer scenarios, localhost, tests, and production previews do not pollute production analytics.
- Automatic page views and URL query strings are not collected.
- Unconfigured, local, and developer-scenario builds make no provider calls.
- Provider failure has no visible gameplay consequence.
- The implementation includes the full automated coverage in section 8 and passes a synthetic
  provider reconciliation before launch.

## 12. Remaining launch configuration

1. Create the Hosted Umami Cloud website and add its website ID as the deployment build variable.
2. Choose the Hosted Umami data region and shortest useful retention.
3. Build the progression, endgame, ending, and runtime-fault dashboards from the implemented events.
4. Run the production-host network smoke test and reconcile one synthetic run with the provider.

## 13. Implementation status

The browser client, typed schema, provider adapter, exact-once run ledger, lifecycle observer,
endgame and ending events, sanitised runtime-fault tracking, title-screen disclosure, CSP, release
audit, and focused automated tests are implemented. Production transmission remains a true no-op
until a Hosted Umami website ID is supplied at build time.

## 14. Official references

Provider behavior and limits are time-sensitive. These official sources were checked on 1 August
2026 and should be checked again immediately before implementation:

- [Umami overview and privacy model](https://docs.umami.is/docs)
- [Umami Cloud](https://docs.umami.is/docs/cloud)
- [Umami Cloud FAQ](https://docs.umami.is/docs/cloud/faq)
- [Umami event tracking](https://docs.umami.is/docs/track-events)
- [Umami tracker functions and event-data limits](https://docs.umami.is/docs/tracker-functions)
- [Google Analytics custom events](https://developers.google.com/analytics/devguides/collection/ga4/events)
- [Google Analytics default data collection and client ID](https://support.google.com/analytics/answer/11593727)
- [Google Analytics cookie usage](https://support.google.com/analytics/answer/11397207)
- [Google Analytics Consent Mode](https://support.google.com/analytics/answer/10000067)
- [Google Analytics setup verification and DebugView](https://developers.google.com/analytics/devguides/collection/ga4/troubleshoot)
