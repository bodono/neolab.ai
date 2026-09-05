# Neolab.ai art-direction test

GDD §26.5 requires two complete treatments to be viewed inside the actual dashboard before selecting a production pipeline. Both source sheets are generated concept art and are deliberately excluded from the production Vite bundle.

Run the comparison:

```sh
pnpm dev
```

Then open `http://localhost:5173/?fixture=art-direction`. The comparison route renders eleven crops in the real identity header, resource cards, researcher strip, workspace and event rail. The complete sheet remains available in the disclosure below the mock dashboard.

## Required comparison set

Each treatment contains the same eleven items:

1. Thomas Hassabi leader portrait
2. Ian LeMon researcher portrait
3. Geoff Hintoff researcher portrait
4. Andrei Carpathia researcher portrait
5. Frontier server room
6. Cash icon
7. GPU icon
8. Aura icon
9. Safety-evidence icon
10. Serious containment incident card
11. Comedic investor-demo event card

## Treatment A — restrained corporate

Source: `treatment-a-corporate.png`

Final built-in generation prompt:

> Create one coherent pixel-art production test sheet containing exactly eleven isolated game assets for a satirical frontier-AI laboratory management game: four kind, flattering and recognisable caricature portraits of Thomas Hassabi, Ian LeMon, Geoff Hintoff and Andrei Carpathia; a frontier GPU server room; cash, GPU, Aura and safety-evidence icons; a serious containment-alarm card; and a comic card of overdressed investors applauding a tiny unimpressive robot. Use restrained 16-bit corporate pixel art with crisp hard pixels, consistent density, subtle dithering and a limited off-white, charcoal, slate-blue, muted-orange, sage-green and dusty-violet palette. Arrange six isolated tiles over five on a warm off-white contact sheet. No text, labels, letters, numbers, logos, trademarks, watermark, photorealism, smooth gradients or extra assets.

## Treatment B — colourful arcade

Source: `treatment-b-arcade.png`

Final built-in generation prompt:

> Create the same exact eleven-asset comparison set and hierarchy as Treatment A, but as colourful 16-bit arcade pixel art with crisp hard pixels, consistent density, saturated cyan, electric purple, hot magenta, warm yellow and coral accents on deep navy, bolder outlines, playful neon highlights and an energetic retro cabinet feel that retains management-sim readability. Arrange six isolated tiles over five on a dark navy contact sheet with purple separators. No text, labels, letters, numbers, logos, trademarks, watermark, photorealism, smooth gradients or extra assets.

## Recommendation and decision gate

Treatment A is the current recommendation. Its restrained palette integrates with the dense dashboard, supports the dry satire, and leaves urgent red/orange states with more visual headroom. Treatment B is much more distinctive and immediately “game-like,” but its permanent neon intensity competes with resource state and crisis signalling.

No production assets should be generated or wired until the treatment is explicitly selected. After selection, create individual files rather than runtime-cropping these concept sheets, populate the production asset manifest, and run the portrait/legal review workflow.
