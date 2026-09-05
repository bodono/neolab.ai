# Privileged development inspector

The browser game has a local-development-only inspector for diagnosing the deterministic
simulation without weakening the player-facing hidden-information boundary.

## Open it

Run the ordinary development server:

```bash
pnpm dev
```

Start or load a game, then select **Dev inspector** in the lower-right corner. The control and its
code do not exist in a production build.

## Available diagnostics

The panel exposes:

- the current tick phase, total transition duration, and per-system timings;
- the last command validation result and atomic transition audit;
- exact finance ledgers for every lab;
- active/dormant modifier records grouped by target, resolved from both zero and one base values;
- deterministic random-oracle lookup for a semantic key;
- exact per-lab paper thresholds, progress, eligibility, and world ownership;
- model truth, active-internal/commercial portfolio roles, hidden safety traits, evaluation error,
  and anomaly error;
- opportunity-event eligibility, blockers, state multipliers, and effective weights;
- rival utility decisions, personalities, incidents, and exact candidate countdowns;
- coalition ratification checks and endgame trigger/score/gate inputs;
- the complete invariant pack; and
- deterministic export of the current canonical state as a test fixture.

The export format is `neolab-developer-scenario-v1`. It records the compiled-content hash,
engine/content versions, run identity, tick, expected lifecycle state, invariant codes, and the
complete canonical state. It intentionally contains hidden information and should be treated as a
developer artifact, not a player save or bug-report attachment.

System durations are presentation diagnostics only. The browser injects the monotonic clock through
an optional observer; the simulation never reads wall-clock time, and the observations are not part
of canonical state, saves, command logs, hashes, or replay.

## Production boundary

The normal React tree never imports canonical state. `BrowserGameRuntime` will return a development
snapshot only when constructed with its explicit development option; production entry points pass a
compile-time false value. The inspector component is dynamically imported behind
`import.meta.env.DEV` and is the only UI module allowed to import `@neolab/sim/debug`.

The privileged projection carries the sentinel `NEOLAB_PRIVILEGED_INSPECTOR_V1`. The release audit
scans all emitted HTML, JavaScript, and CSS and fails if that sentinel is present. The component CSS
is imported by the development module itself, so it is excluded alongside the code rather than
merely hiding a production panel.

Verify the boundary with:

```bash
pnpm --filter @neolab/web build
pnpm release:check-built
```

The release report must contain `developerTools.privilegedInspectorBundled: false`.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
