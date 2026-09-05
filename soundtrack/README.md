# Neolab.ai soundtrack laboratory

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. The original Neolab.ai soundtrack
sources, compositions, generated recordings, and event cues are proprietary and all rights are
reserved; see [`../LICENSE`](../LICENSE) and [`../COPYRIGHT.md`](../COPYRIGHT.md).

This folder contains the score's preferred composition source, listening copies, production
encodes, and integration documentation. Selected encoded assets are imported by the browser game.

The direction is **peaceful laboratory electronica**: concise melodies, rounded leads and triangle
basses, understated tonal percussion, warm synthetic pads, and occasional procedural irregularity. It
is inspired by the broad tradition of inventive puzzle-game and tracker music, but the melodies,
arrangements, sounds, and track identities are original to Neolab.ai.

## Start here

- [`soundtrack-design.md`](soundtrack-design.md) is the score bible and adaptive-music plan.
- [`track-manifest.yaml`](track-manifest.yaml) defines all twenty-five tracks and twenty event cues.
- [`gameplay-integration.md`](gameplay-integration.md) defines when every asset plays and specifies
  the main-page play/pause control.
- [`audition.html`](audition.html) exposes every audio asset without importing game code.
- [`prototypes/`](prototypes/) contains the twenty-five full soundtrack tracks.
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
python3 soundtrack/tools/render_prototypes.py --production-codecs
python3 soundtrack/tools/render_prototypes.py --events --production-codecs
```

The compositions use a fixed seed and should render identically for a given NumPy version and
sample rate. They contain no samples, copied melodies, or third-party musical assets. Release
exports use content-hashed Opus in the game with AAC fallback; `--production-codecs` requires
ffmpeg and derives both encodings from the same generated PCM master.

## Licence

The compositions, renderer, generated recordings, and event cues are original parts of Neolab.ai
and are proprietary. The personal-use permission for a lawfully supplied game build does not grant
permission to extract, copy, sample, modify, perform, distribute, or reuse the score separately.
The Python renderer and manifest are the preferred internal source for modifying the score. No
third-party samples or recordings are incorporated. The gameplay-media permission in the project
licence allows the score to appear incidentally in permitted gameplay videos and livestreams; it
does not allow standalone soundtrack uploads or extracted audio.

## Status

The **Complete Alpha** contains twenty-five full compositions—about sixty-eight minutes—and twenty event cues.
All use the approved comfort palette: no raw pulse/square waves, quantised chip fuzz, bright hats,
snare cracks, or alert-like transients. Gameplay mixing, exact PCM-derived loop durations, Opus/AAC
release exports, and the release licence are now wired for the static build.
