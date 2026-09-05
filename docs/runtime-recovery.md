# Runtime fault containment and recovery

Neolab.ai treats an unexpected fault as a containment event: stop time, preserve the last coherent
canonical state, show a player-safe recovery surface, and make a portable save available before the
player reloads. This implements TDD §21.7.

## Fault boundary

`BrowserGameRuntime` is the only browser owner of canonical `GameState`. It catches unexpected
exceptions from command validation, command application, tick advancement, and `GameView`
projection. A failed transition has these guarantees:

1. Canonical state and `GameView` still describe the same last coherent tick.
2. No transition autosave or high-score write is queued for an uncommitted result.
3. The clock is paused with `pauseReason: "runtime-fault"` and cannot resume or step again.
4. The runtime publishes one small `RuntimeFault` record through the normal snapshot/store bridge.
5. Normal snapshots contain a stable reference, category, scope, and tick—not the exception message,
   stack, canonical state, hidden safety truth, or random draws.

`CommandRejectedError` is an expected rules outcome and does not poison the runtime. It continues to
flow back to the initiating control so stale or unaffordable actions remain ordinary recoverable UI
states.

The privileged development snapshot retains the raw exception name, message, and stack when—and
only when—development tools were explicitly enabled. Fault metadata is presentation state: it never
enters `GameState`, the replay log, a score, or a save.

## React boundaries

`ApplicationErrorBoundary` surrounds the active game shell and development inspector.
`CampusErrorBoundary` separately surrounds the decorative campus renderer, so its fault is correctly
attributed even if a later renderer replaces the DOM/CSS implementation. Both notify the runtime,
which performs the same clock pause and safe snapshot publication as a simulation fault.

The recovery panel:

- takes focus at its heading and announces the failure as an alert;
- explains that no more simulation steps will run;
- shows only the recovery reference, last coherent tick, and safe surface label;
- offers **Export emergency save** and **Reload Neolab.ai**;
- never renders raw exception text.

## Emergency save

`BrowserGameRuntime.createEmergencySave()` bypasses IndexedDB and constructs a normal
`neolab-save` envelope directly from the last coherent canonical state. It uses the production
checksum, current save version, content hash, and manual-slot schema. The resulting
`*.neolab-save.json` file can be imported from the title screen and traverses the ordinary
checksum → migration → schema → invariant load pipeline.

This bypass is intentional: storage failure may accompany a runtime fault, and recovery must not
depend on the autosave queue or its database. If the injected wall-clock provider itself fails, the
envelope uses a deterministic epoch metadata fallback; simulation data is unaffected.

## Verification

Focused runtime tests inject failures at tick, command, and view-projection boundaries and prove
state atomicity, non-resumability, player-safe projection, privileged diagnostics, and production
save reloading. Store tests prove the Zustand bridge receives only the safe fault projection.
Chromium component tests throw inside both React boundaries and verify the focused recovery UI,
scope attribution, paused clock, required controls, and absence of raw exception copy.

For manual fault investigation in a development build:

1. Record the recovery reference and affected surface.
2. Export the emergency save before reloading.
3. If local diagnostics were enabled, export them separately from the title screen.
4. Reproduce from the save with the development inspector; do not attach privileged inspector output
   to player-facing bug reports without reviewing it first.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
