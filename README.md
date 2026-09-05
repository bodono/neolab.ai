# Neolab.ai

[![CI](https://github.com/bodono/neolab.ai/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bodono/neolab.ai/actions/workflows/ci.yml)

> Raise rounds. Train models. Publish papers. Keep your GPUs cool and your releases hot. Usher in a
> new era of aligned prosperity. But whatever you do, don't destroy the world—the board has been
> very clear about this.

**Neolab.ai** is a browser-based strategy game about running a frontier AI laboratory. It combines
resource management, a five-lab research race, model training and deployment, autonomy permissions,
uncertain safety evidence, institutional politics, and a deployment-crisis endgame with dry
AI-industry satire.

This repository contains a playable private alpha and its deterministic simulation, web UI,
content compiler, soundtrack, test harnesses, balance tools, and design documentation. Authored
content and final balance are still in production.

> **Independent project:** Neolab.ai is a work of fiction and satire created in a personal
> capacity. It is not affiliated with, sponsored by, or endorsed by Google, Google DeepMind, or
> any person or organisation depicted, referenced, parodied, or used as inspiration. The project
> does not represent the views of Google or the creator's employer. See
> [`DISCLAIMER.md`](DISCLAIMER.md).

> **Removal requests:** some characters are affectionate parodies inspired by real researchers and
> lab leaders. If you are, or represent, someone who inspired a character and would prefer not to
> be included, email <bodonoghue85@gmail.com>. The character will be removed or renamed on a
> best-effort basis within 30 days, no explanation needed. See
> [`DISCLAIMER.md`](DISCLAIMER.md#removal-requests).

> **Public release hold:** a restricted itch.io alpha may be updated for invited playtesters.
> Do not activate GitHub Pages, change repository visibility, configure a public domain, make the
> itch.io page public, create a release tag, or announce availability until the project owner gives
> separate explicit approval.

## Run locally

Requirements: Node.js 22 or newer (use `.nvmrc` for the repository-pinned version) and the pnpm
version pinned in `package.json` (Corepack can provide it).

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. A new game starts paused after leader selection, so it is safe to
inspect the dashboard before advancing time.

New campaigns use a milestone-driven opening. The player begins in a garage with no GPUs, and
departments appear only when their underlying story milestone has been completed. The first
prototype is capped below FC 5; World then reveals rivals that have been progressing since week
one. A newly authorised FC 5 generation opens productisation and serving, a later FC 10 generation
opens safety evaluations, and a later FC 20 generation opens recursive self-improvement. Each
threshold requires its own newly authorised model, so one unusually strong run cannot consume
several story beats at once. Fundraising, facilities, researcher leadership, research, and finally
the Candidate Programme open around those capability milestones. Locked systems are absent from
the interface and rejected by the simulation command layer; they are not merely disabled buttons.
Development scenarios remain fully open unless they explicitly opt into this campaign progression.

Development builds also show a **Dev inspector** control after entering a lab. It exposes privileged
simulation diagnostics and deterministic fixture export; see
[`docs/developer-inspector.md`](docs/developer-inspector.md). The inspector is absent from production
builds.

### Endgame playtest scenarios

Development builds provide deterministic, development-only URLs for exercising the Deployment
Crisis without playing an entire campaign. These fixtures are excluded from production entry
points. The entry scenarios omit the expensive training project but begin at its real completion
boundary: advance one simulation week and the normal end-of-tick candidate detector opens the
nomination screen and auto-pauses, exactly as it does on the week a qualifying training run
finishes in an ordinary campaign. Direct checkpoint scenarios open at the named later state.

The canonical registry is
[`ENDGAME_PLAYTEST_SCENARIOS`](packages/sim/src/developer/scenarios.ts). A synchronization test
requires every registered scenario—and no removed scenario—to appear in the appropriate table
below.

| Entry scenario | URL | Intended test |
| --- | --- | --- |
| Balanced crisis | `http://localhost:5173/?scenario=endgame` | Neutral mixed-strength baseline and general endgame navigation |
| Prosperity route | `http://localhost:5173/?scenario=endgame-prosperity` | Guaranteed genuine SI with a cooperative model and strong institution; favourable victory routes cannot collapse into False Dawn |
| False Dawn | `http://localhost:5173/?scenario=endgame-false-dawn` | Guaranteed non-SI lineage for deployment, revelation, return-to-race, and Long Pause testing |
| Unsafe model, strong controls | `http://localhost:5173/?scenario=endgame-high-control` | Emergency control and containment against a dangerous candidate |
| Evidence-starved crisis | `http://localhost:5173/?scenario=endgame-low-evidence` | Weak evaluation quality, interpretability, and internal candour |
| Extinction | `http://localhost:5173/?scenario=endgame-extinction` | Worst-case hidden safety, access, and defences; after containment is lost, emergency containment fails and an extinction pathway is selected deterministically |
| Rival candidate race | `http://localhost:5173/?scenario=endgame-rival` | Rival Candidate Programme completion, race warnings, crisis stages, and ascendance countdown |

| Direct checkpoint | URL | Intended test |
| --- | --- | --- |
| Rival False Dawn | `http://localhost:5173/?scenario=endgame-rival-false-dawn` | One simulation step before a rival capability claim collapses, for the rival-setback interrupt and return-to-race flow |
| False alarm in custody | `http://localhost:5173/?scenario=endgame-false-alarm` | Investigating a suspicious candidate signal whose hidden cause is benign |
| Disputed capability proof | `http://localhost:5173/?scenario=endgame-disputed-proof` | Escalation and recovery after an unverifiable benchmark declaration |
| Verified-retirement recovery | `http://localhost:5173/?scenario=endgame-recovery` | Quarantine, supervised rebuild, successor continuity, and the post-retirement Long Pause |
| Contained-pilot route twist | `http://localhost:5173/?scenario=endgame-route-twist` | The first live decision in a fortress-contained rollout |
| Multiple latent artifacts | `http://localhost:5173/?scenario=endgame-multi-latent` | Exact-artifact nomination when two independent qualifying lineages exist |

The entry profiles deliberately target ontic outcome families: False Dawn fixes a non-genuine
lineage draw, while the other player entries fix a genuine lineage so their intended control,
prosperity, and catastrophe branches remain reachable. Prosperity additionally reaches certainty
through the public FC 100 probability curve. Every proof, incident, rollout, and player decision
after registration still uses normal simulation logic, except for the final two gates in the
dedicated `endgame-extinction` fixture: once the player has actually lost containment, emergency
containment is forced to fail and the extinction gate is forced to pass. The concrete causal
extinction pathway is still selected from the scenario's normal weighted pathway model. See
[`docs/endgame-scenarios-review.md`](docs/endgame-scenarios-review.md) for the manual branch matrix.

Saves and local high scores are stored in separate IndexedDB databases in the current browser.
Saves can also be exported and imported as JSON. There are no accounts or cloud saves. A configured
published build automatically sends anonymous gameplay milestones and sanitised crash fingerprints
to Hosted Umami Cloud. There is no in-game analytics opt-out. Local development and endgame test
scenarios never send analytics. Optional full local diagnostics are off by default and are never
transmitted automatically. Automatic page-view tracking and URL query-string collection are
disabled.

### Hosted analytics

Analytics require a hosted Umami Cloud website ID at build time; there is no analytics server or
database in this repository. The GitHub Pages workflow is configured for the project's Hosted
Umami site. For another static host such as itch.io, build with:

```bash
VITE_ANALYTICS_PROVIDER=umami \
VITE_UMAMI_WEBSITE_ID=29f3bde0-f7b6-4a4b-8e43-43cb99121aa1 \
VITE_DEPLOYMENT_CHANNEL=itch \
pnpm --filter @neolab/web build
```

If the website ID is absent, analytics are a true no-op and the provider script is not loaded. The
event contract and privacy boundaries are documented in
[`docs/product-analytics-plan.md`](docs/product-analytics-plan.md).

## Useful checks

```bash
pnpm lint               # ESLint plus repository-wide Prettier verification
pnpm typecheck          # TypeScript checks across every workspace package
pnpm build              # content, types, unit/integration tests, production web build
pnpm test:browser       # real-Chromium component contracts
pnpm test:e2e           # Playwright scenarios in Chromium, Firefox, and WebKit
pnpm content:check      # authored-content validation and quota/review report
pnpm content:branches   # force every available event option/outcome
pnpm content:links      # non-mutating external-source health report
pnpm invariant:smoke    # deterministic random-legal invariant campaign
pnpm balance:smoke      # small strategy/balance matrix
pnpm balance:endings    # 70 full-horizon core-strategy ending runs
pnpm playtest:report    # validate and summarise recorded human-playtest evidence
pnpm release:check      # static release, privacy, security, licence, and bundle audit
pnpm save:inspect -- exported.neolab-save.json
```

Generated reports and local packages go under `artifacts/`, which is ignored by Git.

## Repository map

- `apps/web` — React/Vite game client and browser tests
- `content` — human-authored YAML for labs, researchers, papers, events, hardware, and balance
- `packages/sim` — deterministic, UI-free game simulation
- `packages/content-schema` — authored and compiled content contracts
- `packages/content` — generated content bundle and typed loader
- `packages/testkit` — scenario builders and catalogue branch harness
- `tools/content-compiler` — YAML compiler and release validation
- `tools/balance-runner` — policies, batch simulation, calibration, and invariant campaigns
- `tools/playtest` and `playtests` — privacy-bounded human-playtest evidence and reporting
- `tools/release` — static-build, itch.io packaging, privacy, security, licence, and bundle checks
- `tools/save-inspector` — privileged local save validation, summaries, and diffs
- `docs/developer-inspector.md` — local browser diagnostics and production-exclusion contract
- `docs/runtime-recovery.md` — fault containment, error boundaries, and emergency saves
- `docs/save-compatibility.md` — immutable historical-save fixtures and migration rules
- `docs/asset-pipeline.md` — validated visual-asset manifest and hashed browser resolution
- `docs/deployment.md` and `docs/itch-io-release.md` — gated static deployment and restricted-alpha delivery
- `docs/release-checks.md` — production privacy, security, licence, and asset audit contract
- `soundtrack` — original soundtrack sources, production encodes, and integration guides
- `docs/game-design.md` — detailed rules, content, UI, and endgame design
- `docs/endgame-scenarios-review.md` — all implemented endgame routes, endings, gates, and review questions
- `docs/recursive-self-improvement-design.md` — exploration of richer recursive-improvement cycles beyond the current Autonomy Programme
- `docs/feedback-review-2026-07-23.md` — owner feedback backlog pending current-alpha verification
- `docs/technical-design.md` — implementation architecture and contracts
- `docs/implementation-plan.md` — staged execution plan and append-only decision log
- `design/mockups/dashboard-concept.html` — historical design reference, not the production client

The simulation is deliberately deterministic: identical content, seed, configuration, and command
log must produce the same canonical state. Player-facing projections are separately guarded so
hidden safety truth and rival state cannot leak into the UI.

## Copyright and licence

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>.
All rights reserved.

Neolab.ai is proprietary software and content. A lawfully supplied unmodified build may be used
only under the limited personal, non-commercial permission in [`LICENSE`](LICENSE). Access to this
repository does not grant permission to copy, modify, redistribute, publish, rehost, or create
derivative works except through the licence's narrow contribution-only pull-request workflow.
Gameplay videos, livestreams, screenshots, reviews, and ordinary channel monetisation are
permitted; standalone redistribution, modified releases, and asset extraction are not. See
[`CONTRIBUTING.md`](CONTRIBUTING.md), [`COPYRIGHT.md`](COPYRIGHT.md), and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The project's independence and
fictionalisation terms, including the
[character removal policy](DISCLAIMER.md#removal-requests), are in
[`DISCLAIMER.md`](DISCLAIMER.md).
