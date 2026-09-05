# Event sound cues

These twenty one-shot cues cover the major simulation, crisis, coalition, score, and ending event
families. They deliberately avoid alert beeps, bright percussion, and sudden loudness. Meaning
comes from harmony and shared soundtrack motifs; the UI must always carry the actual warning.

Each cue also has a distinct `gesture` in the manifest. This describes its arrangement shape—not
just its mood—and prevents the library from becoming the same musical sentence transposed twenty
times.

The canonical event-to-file mapping is in [`../track-manifest.yaml`](../track-manifest.yaml). Use a
separate event/SFX bus in the game, gently duck music by 2–4 dB while a cue plays, and never loop an
event cue.

Regenerate the complete library from the repository root:

```sh
python3 soundtrack/tools/render_prototypes.py --events
```

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../../COPYRIGHT.md).
