# BG-07A.1 architectural floor-plan comparisons

These are production-browser captures of real canonical plans. **Before** is the frozen top BG-07A proposal from [a12ad63](https://github.com/kxrlpxrk/Building-Gen/commit/a12ad63e9301387cad8c8f58cda8383176027aeb), imported into the current viewer. **After** uses the current cancellable worker with the same source footprint, room requirements, style and seed. Camera Fit and viewport match within each pair. The fixed sources, requests and original proposals are retained in [baseline.json](baseline.json); they contain no derived meshes. Custom uses the unchanged four-room starter. The three-wing hall includes its original valid exterior entrances, cross-gables, windows and Fantasy ornamentation.

| Purpose                                 | Before                              | After                              | Visible improvement                                                                                |
| --------------------------------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| 18 × 8 m Viking hall + three extensions | [Plan](viking-longhouse-before.png) | [Plan](viking-longhouse-after.png) | Sleeping chamber reached from the hall instead of storage; dominant main hall retained.            |
| Small Medieval Cottage                  | [Plan](medieval-cottage-before.png) | [Plan](medieval-cottage-after.png) | More convenient kitchen/storage access while keeping a compact shared/private plan.                |
| Farmhouse                               | [Plan](farmhouse-before.png)        | [Plan](farmhouse-after.png)        | Sleeping room no longer approached through storage; service relationships retained.                |
| Workshop                                | [Plan](workshop-before.png)         | [Plan](workshop-after.png)         | Direct work-floor/materials-store connection; support rooms replace the thin service strip.        |
| Tavern/Inn                              | [Plan](tavern-inn-before.png)       | [Plan](tavern-inn-after.png)       | Direct kitchen/store access, guest rooms away from required service routes.                        |
| Eight-room Manor                        | [Plan](manor-before.png)            | [Plan](manor-after.png)            | Kitchen/dining/store links, private chambers reached from public rooms rather than service spaces. |
| Trading Hall                            | [Plan](trading-hall-before.png)     | [Plan](trading-hall-after.png)     | Dominant public trading floor, more practical service-room proportions.                            |
| Custom                                  | [Plan](custom-before.png)           | [Plan](custom-after.png)           | User requirements retained, practical shapes and genuine service links preferred.                  |

iPhone-sized comparisons:

- Viking hall: [before](viking-longhouse-before-iphone.png) / [after](viking-longhouse-after-iphone.png).
- Workshop: [before](workshop-before-iphone.png) / [after](workshop-after-iphone.png).
- Manor: [before](manor-before-iphone.png) / [after](manor-after-iphone.png).

Measured top-proposal quality, using the same rubric for both versions ([full component report](comparison.json)):

| Purpose          | Before |  After |
| ---------------- | -----: | -----: |
| Viking Longhouse |  91.45 |  95.66 |
| Medieval Cottage |  95.17 |  96.78 |
| Farmhouse        |  93.83 |  97.24 |
| Workshop         |  87.45 |  98.20 |
| Tavern/Inn       |  92.87 |  97.24 |
| Manor            |  88.33 |  94.79 |
| Trading Hall     |  99.68 | 100.00 |
| Custom           |  94.21 |  96.78 |

Desktop and iPhone-sized runs produced identical measured results for all eight fixtures.

Scores are deterministic architectural heuristics, not professional design certification. Both old and new plans are evaluated using the **same BG-07A.1 rubric**, rather than comparing the old 1,000-point score against the new 100-point score. Minimum areas, clearances, actual region topology and entrance connectivity are independently validated. The generator can still return warnings or fewer proposals when geometry and requested rooms conflict. These examples demonstrate improvements, not a universal solution for every possible footprint.

Reproduce from this checkout:

```sh
npm run build
BG_E2E_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/layout-quality.spec.ts --project=desktop-chromium --project=iphone-chromium --workers=1
npx vitest run src/layoutQuality.test.ts --maxWorkers=1
```

Omit the executable override when using Playwright's installed Chromium. The browser test emits before/after PNGs and `comparison.json` in `test-results/`, verifies all Dashboard/Studio version labels, and proves preview does not save and acceptance preserves the complete exterior. Desktop and iPhone-sized Chromium checks do not substitute for physical iPhone Safari, keyboard and VoiceOver playtests; use the targeted checklist in the root README.
