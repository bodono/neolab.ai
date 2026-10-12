# Save compatibility archive

Neolab.ai keeps real exported save envelopes as immutable release evidence. Tests must
load these files through the same checksum, sequential migration, schema and invariant
pipeline used by the browser. An in-memory object shaped like an old save is useful for
unit-testing a particular migration, but it is not a substitute for preserving the bytes
that players could have downloaded.

## Current archive

Each public release has a directory under `packages/sim/src/persistence/__fixtures__/`
holding gzipped save envelopes and a `manifest.json` with each file's SHA-256 (of the
uncompressed bytes), tick, run status and endgame stage:

- `v0.0.19/` (save version 6) was reconstructed after the fact from the `v0.0.19` tag,
  which shipped without an archive. Its classic and guided saves come from that
  release's balance-runner policies, and its endgame saves from that release's developer
  scenarios, all exported by that release's own engine.
- `v0.0.20/` (save version 7) was written by `packages/sim/scripts/archive-release-saves.ts`
  from the release commit.

Each set covers a fresh opening, an ordinary mid-run save, a finished run, a guided
opening, and candidate, confirmation, recovery and rollout endgame states.

`packages/sim/src/persistence/__tests__/save-compatibility.test.ts` verifies every file's
digest, loads it through `loadSaveEnvelope` (checksum, sequential migration, schema,
invariants), projects the player view, and plays it on for a year without player input
(or until the run ends or a decision stops the clock). `apps/web/e2e/persistence.spec.ts`
imports three `v0.0.19` saves through the title screen and plays a week in the browser.

The alpha save-version 3 archive described in earlier revisions of this document was
retired with the endgame redesign, when saves before version 6 stopped loading.

## Rules for future releases

1. Never regenerate, reformat or replace an existing fixture directory. Its file digest is
   deliberately a tripwire.
2. Before changing `SAVE_VERSION`, add the sequential pure migration and keep every earlier
   fixture in the test matrix.
3. For each public tag, archive at least opening, ordinary mid-run, crisis/checkpoint and
   terminal saves. Add a scenario when a new persistent subsystem is not represented by
   those four lifecycle states.
4. Name a new fixture set after the release: run
   `node packages/sim/scripts/archive-release-saves.ts vX.Y.Z` after `pnpm content:build`.
5. Generate the set from the exact release commit and commit it with the tag. The generator
   refuses to overwrite an existing archive.
6. If a file cannot migrate safely, preserve its original bytes and add an explicit loader
   rejection fixture plus player-facing recovery/export guidance. Never silently discard it.

Run the contract with:

```sh
pnpm exec vitest run packages/sim/src/persistence/__tests__/save-compatibility.test.ts
```

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
