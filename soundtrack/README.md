# Neolab.ai soundtrack laboratory

This folder is a self-contained music experiment. Nothing here is imported by the game, included
in its build, or treated as final production audio.

The direction is **peaceful laboratory electronica**: concise melodies, rounded leads and triangle
basses, understated tonal percussion, warm synthetic pads, and occasional procedural irregularity. It
is inspired by the broad tradition of inventive puzzle-game and tracker music, but the melodies,
arrangements, sounds, and track identities are original to Neolab.ai.

## Start here

- [`soundtrack-design.md`](soundtrack-design.md) is the score bible and adaptive-music plan.
- [`track-manifest.yaml`](track-manifest.yaml) defines all nine tracks and twenty event cues.
- [`gameplay-integration.md`](gameplay-integration.md) defines when every asset plays and specifies
  the main-page play/pause control.
- [`audition.html`](audition.html) exposes every audio asset without importing game code.
- [`prototypes/`](prototypes/) contains the nine full soundtrack tracks.
- [`events/`](events/) contains the twenty one-shot event cues.
- [`tools/render_prototypes.py`](tools/render_prototypes.py) deterministically composes and
  synthesises the prototypes from source.

## Render the soundtrack

The renderer requires Python 3 and NumPy:

```sh
python3 soundtrack/tools/render_prototypes.py
python3 soundtrack/tools/render_prototypes.py --events
```

It writes temporary stereo WAV masters, uses macOS `afconvert` when available to create compact
AAC/M4A listening copies, and removes the temporary WAV files. On another platform, pass
`--keep-wav` to retain browser-compatible WAV files for auditioning or conversion with another
encoder.

Useful options:

```sh
python3 soundtrack/tools/render_prototypes.py --track hello-world-model --keep-wav
python3 soundtrack/tools/render_prototypes.py --event paper-discovered --keep-wav
python3 soundtrack/tools/render_prototypes.py --output /tmp/neolab-music --keep-wav
```

The compositions use a fixed seed and should render identically for a given NumPy version and
sample rate. They contain no samples, copied melodies, or third-party musical assets.

## Status

The **Complete Alpha** contains nine full compositions—about 23½ minutes—and twenty event cues.
All use the approved comfort palette: no raw pulse/square waves, quantised chip fuzz, bright hats,
snare cracks, or alert-like transients. Before shipping, the material still needs gameplay mixing,
production-rate masters, exact Web Audio loop metadata, final codec exports, and a formal licensing
decision.
