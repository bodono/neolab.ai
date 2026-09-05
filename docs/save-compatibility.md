# Save compatibility archive

Neolab.ai keeps real exported save envelopes as immutable release evidence. Tests must
load these files through the same checksum, sequential migration, schema and invariant
pipeline used by the browser. An in-memory object shaped like an old save is useful for
unit-testing a particular migration, but it is not a substitute for preserving the bytes
that players could have downloaded.

## Current archive

`packages/sim/src/persistence/__fixtures__/alpha-v3/` freezes four save-version 3
envelopes from the content-complete implementation alpha:

- a fresh opening run;
- an active run after 26 complete weekly ticks;
- the protected Deployment Crisis Start checkpoint;
- a terminal insolvency loss after score finalisation.

Its manifest records the engine, random-contract and content versions, the state checksum,
the SHA-256 of each exact file and a small expected lifecycle projection. The test verifies
the archived bytes first, then invokes `loadSaveEnvelope` twice, checks the resulting current
schema and invariants, and proves a current-version re-envelope takes the identity path.

Engine rules version `0.2.0` retains save version 3. The new optional
`LabModelPortfolioState.commercialModelId` therefore requires no structural migration: a legacy
portfolio without it treats its externally deployed current model as commercial until the next
explicit deployment command. New games under `0.2.0` start with no model; archived opening saves
remain historical evidence and are not rewritten to imitate the new opening.

## Rules for future releases

1. Never regenerate, reformat or replace an existing fixture directory. Its file digest is
   deliberately a tripwire.
2. Before changing `SAVE_VERSION`, add the sequential pure migration and keep every earlier
   fixture in the test matrix.
3. For each public tag, archive at least opening, ordinary mid-run, crisis/checkpoint and
   terminal saves. Add a scenario when a new persistent subsystem is not represented by
   those four lifecycle states.
4. Name a new fixture set after the release and source save version. Copy and adjust
   `packages/sim/scripts/archive-alpha-saves.ts`; do not point it at an old directory.
5. Generate the set from the exact release commit and commit it with the tag. The generator
   refuses to overwrite a non-empty archive.
6. If a file cannot migrate safely, preserve its original bytes and add an explicit loader
   rejection fixture plus player-facing recovery/export guidance. Never silently discard it.

Run the contract with:

```sh
pnpm exec vitest run packages/sim/src/persistence/__tests__/save-compatibility.test.ts
```

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
