# Release checks

`pnpm release:check` builds the public browser game and fails closed on the Stage 10 release
contract. CI runs the same audit against its already built artifact with `pnpm
release:check-built` and retains the reports for 90 days.

The audit verifies:

- the static build budgets and byte manifest;
- a restrictive meta Content Security Policy (self-only scripts and connections, no objects,
  workers, forms, remote fonts, or `unsafe-eval`);
- that the only runtime `fetch` call is the same-origin, content-hashed audio loader;
- that optional diagnostics are off by default, bounded to 100 allowlisted local records, and
  have no transport or automatic submission path;
- that the title, running game, and ending expose the GitHub issue feedback channel;
- that high scores use the local IndexedDB repository and no future leaderboard submission type,
  alias field, endpoint, WebSocket, EventSource, beacon, or XHR is shipped;
- all 45 score assets in content-hashed Opus plus 45 AAC fallbacks;
- the proprietary project and original-soundtrack declarations;
- that `LICENSE`, `COPYRIGHT.md`, `CONTRIBUTING.md`, `DISCLAIMER.md`, and
  `THIRD_PARTY_NOTICES.md` are included in the shipped build and linked from the title screen; and
- a deterministic inventory of production dependency licences whose package, version, licence,
  and copyright notice remain present in the shipped third-party notice.

The output directory is `artifacts/release-checks/`:

- `release-audit.json` is the machine-readable evidence;
- `production-licences.md` is the production dependency licence report; and
- `bundle-report.md` groups bytes by extension and lists the 15 largest files.

The CSP allows inline **style attributes** because bounded progress, allocation, score-colour, and
campus-placement values are projected into React styles. Inline scripts and evaluated code remain
forbidden. Browser acceptance tests fail on CSP console violations and verify that cross-origin
connections are blocked.

Diagnostics never send data. A player can explicitly enable the local notebook, inspect its record
count, export the JSON, and then choose whether to attach it to a GitHub issue. The export excludes
the run seed, saves, player text, machine identifiers, network addresses, and error messages.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
