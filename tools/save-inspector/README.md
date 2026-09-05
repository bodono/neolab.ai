# Save inspector

This is a local developer tool for exported `.neolab-save.json` files. It uses the production load
pipeline: envelope schema, checksum, sequential migrations, current state schema, and global
invariants. It never repairs or rewrites the source save.

```bash
pnpm save:inspect -- save.neolab-save.json
pnpm save:inspect -- save.neolab-save.json --json --output artifacts/save.json
pnpm save:inspect -- before.json after.json --max-changes 200
pnpm save:inspect -- before.json after.json --json --output artifacts/save-diff.json
```

One input produces a mechanical summary, migration record, canonical state hash, entity counts,
economy/research state, score/endgame state, and exact model truth. Two inputs are independently
loaded and migrated, then their complete canonical states are compared by deterministic JSON Pointer
path. Diff output is bounded but reports the full change count and whether returned rows were
truncated.

Inputs use the same 8 MiB limit as browser save import. JSON reports are privileged developer
evidence: they include the seed, hidden model safety, hidden institutional values, and other state
that must never be shown by the active-run UI. The tool has no network access or production-bundle
entry point.
