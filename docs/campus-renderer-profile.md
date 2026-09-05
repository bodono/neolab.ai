# Campus renderer profile

Status: accepted for the browser alpha  
Measured: 2026-07-22  
Decision: retain the React/DOM/CSS renderer; do not add PixiJS

## What was measured

The development-only `?campus-profile=1` fixture renders the maximum contract density accepted by `CampusStrip`:

- 20 completed facility families (the full launch catalogue target) across all visual treatments
- 3 simultaneous construction projects at distinct phases
- 8 named researchers
- 18 decorative staff sprites
- 3 temporary scene cues and their visual props
- Active or heavy load animation on every facility

Playwright runs Chromium at a 1280 × 900 minimum-laptop viewport with 4× CPU throttling. It samples 120 `requestAnimationFrame` callbacks after render, counts every DOM node and computed animation in the campus ground, records Chromium's page-heap reading when available, and verifies the equivalent text summary.

Run it with:

```sh
pnpm --filter @neolab/web exec playwright test e2e/campus-performance.spec.ts --workers=1
```

## Recorded result

| Measure | Result | Acceptance boundary |
|---|---:|---:|
| Animated elements | 79 | Below the TDD §22.2 PixiJS trigger of 80 sprites |
| Campus DOM descendants | 192 | Local guard: below 260 |
| Mean frame interval | 13.3 ms | Diagnostic |
| p95 frame interval | 26.7 ms | Local guard: below 50 ms under 4× CPU throttling |
| Missed frames (>34 ms) | 0 / 119 | Local guard: below 10% |
| Whole-page JS heap | 42.1 MB | Local guard: below 128 MiB |

Frame and heap values vary by host, so the executable fixture owns the guardrails and CI retries. Node and animation caps are deterministic.

## Decision

PixiJS is not justified for this renderer:

1. The full 20-family launch scene remains bounded at 79 animated elements—under the explicit 80-sprite threshold—with no missed frames in the throttled profile.
2. The scene uses simple pixel modules, walking sprites, load lights, construction phases and small incident props. It does not need particle batching, dynamic lighting, collision detection or pathfinding.
3. The campus remains a small supporting strip rather than a primary game mode.
4. The DOM implementation supplies a player-safe text alternative, reduced-motion behaviour and keyboard-scrollable panorama without a second accessibility projection.

Reconsider a bounded `CampusRenderer`/PixiJS adapter only if a future profile exceeds 80 simultaneous animated sprites with missed frames, the art direction commits to material particle/lighting effects, or the campus becomes a major interactive feature. React must continue to own commands and accessibility if that happens.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
