# BG-06B ornamentation evidence

Production WebGL captures from `tests/ornamentation.spec.ts`, release **1.2.0**, schema **10**. Every image has **section outline OFF**. These are unretouched browser renders from the existing Three.js viewer; no imported assets, compositing or image generation. Camera controls remain visible.

| Example                             | Front three-quarter                  | Rear three-quarter                 | Above                                |
| ----------------------------------- | ------------------------------------ | ---------------------------------- | ------------------------------------ |
| Plain Norse longhouse · None        | [Front](plain-norse-front.png)       | [Rear](plain-norse-rear.png)       | [Above](plain-norse-above.png)       |
| Subtle Norse longhouse              | [Front](subtle-norse-front.png)      | [Rear](subtle-norse-rear.png)      | [Above](subtle-norse-above.png)      |
| Ornate Norse Chieftain's Hall       | [Front](ornate-chieftain-front.png)  | [Rear](ornate-chieftain-rear.png)  | [Above](ornate-chieftain-above.png)  |
| Fantasy Norse Chieftain's Hall      | [Front](fantasy-chieftain-front.png) | [Rear](fantasy-chieftain-rear.png) | [Above](fantasy-chieftain-above.png) |
| Decorated BG-06A crossing gable     | [Close front](cross-gable-front.png) | [Rear](cross-gable-rear.png)       | [Above](cross-gable-above.png)       |
| Decorated medieval cottage · Ornate | [Front](medieval-front.png)          | [Rear](medieval-rear.png)          | [Above](medieval-above.png)          |

Carving close-ups: [Hooked snout / Ornate](ornate-chieftain-dragon-detail.png) · [Crested wyrm / Fantasy](fantasy-chieftain-dragon-detail.png). The dragon profile has an extruded curved neck, jaw and snout, horns, carved eye/brow relief and a ridge-mounted timber foot. Roof silhouette and valley geometry are retained rather than hidden by decoration.

[Multi-wing performance fixture](multi-wing-performance.png): 18 × 8 m High-detail main hall, three architectural extensions, a one-sided crossing gable and independently anchored ornaments. The browser test asserts fewer than **180 draw calls** and **150,000 visible triangles**, checks camera-distance simplification without GPU reconstruction, and preserves canonical project data through camera interaction.

[iPhone-sized Chromium crossing-gable capture](iphone-cross-gable.png). The same six examples and three angles run on desktop and iPhone-sized Chromium. The suite also tests preview/Cancel, invalid scale, atomic acceptance and Undo/Redo, reopen, replacement/reset and horizontal overflow. This is automated browser evidence, **not physical iPhone Safari certification**.

Reproduce after `npm ci && npm run build`:

```sh
BG_E2E_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/ornamentation.spec.ts --project=desktop-chromium --project=iphone-chromium
```

Set the executable path to your installed Chromium, or omit it to use Playwright's downloaded browser. Fresh captures are written to the ignored `test-results/` directory. Fixtures are in `tests/fixtures/ornamentBuildings.ts`.

Supported anchors and limitations are documented in the root [README](../../README.md#architectural-ornamentation--bg-06b). There is no new structural-engineering claim or universal ornament-placement solver. Physical Safari must still be checked for sustained performance, pinch/orbit, portrait document scrolling, landscape, input focus, reopen and context recovery on real hardware.
