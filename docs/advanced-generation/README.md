# BG-06C generated architecture evidence

Release **1.3.0**, schema **10**. These are production WebGL captures from the real **Generate Architectural Building** worker and existing Three.js viewer. Every image has **section outline OFF**. No imported assets, image generation or compositing was used.

| Generated example                    | Front                                | Rear                               | Above                                | Opposite                                   |
| ------------------------------------ | ------------------------------------ | ---------------------------------- | ------------------------------------ | ------------------------------------------ |
| Subtle Rustic Norse longhouse        | [Front](rustic-subtle-front.png)     | [Rear](rustic-subtle-rear.png)     | [Above](rustic-subtle-above.png)     | [Opposite](rustic-subtle-opposite.png)     |
| Ornate Norse Chieftain's Hall        | [Front](chieftain-ornate-front.png)  | [Rear](chieftain-ornate-rear.png)  | [Above](chieftain-ornate-above.png)  | [Opposite](chieftain-ornate-opposite.png)  |
| Grand Fantasy Norse Chieftain's Hall | [Front](chieftain-fantasy-front.png) | [Rear](chieftain-fantasy-rear.png) | [Above](chieftain-fantasy-above.png) | [Opposite](chieftain-fantasy-opposite.png) |
| Medieval Cottage                     | [Front](medieval-cottage-front.png)  | [Rear](medieval-cottage-rear.png)  | [Above](medieval-cottage-above.png)  | [Opposite](medieval-cottage-opposite.png)  |
| Medieval Manor                       | [Front](medieval-manor-front.png)    | [Rear](medieval-manor-rear.png)    | [Above](medieval-manor-above.png)    | [Opposite](medieval-manor-opposite.png)    |
| Mixed Architectural Fantasy          | [Front](mixed-fantasy-front.png)     | [Rear](mixed-fantasy-rear.png)     | [Above](mixed-fantasy-above.png)     | [Opposite](mixed-fantasy-opposite.png)     |

[iPhone-sized Chromium: Grand Fantasy hall](iphone-chieftain-fantasy.png).

Fixtures are in `tests/fixtures/advancedArchitecture.ts`: seed **6142**, High detail, supported Gable preference, explicit generated ornamentation and no legacy finials or chimneys. The six examples retain working entrance openings, windows and entrance canopies where validated. Roof/ornament records are generated normally; no fixture inserts special geometry or bypasses validation.

The browser suite captures all six examples at four angles on both desktop and iPhone-sized Chromium (**48 captures**), compares the source IndexedDB records before/after every preview, asserts no horizontal overflow, and checks fewer than **180 draw calls** and **150,000 visible triangles**. Camera zoom must not rebuild GPU meshes or modify saved data. These bounds are automated safeguards, not a physical-device frame-rate certification.

A separate workflow test cancels an active worker, compares proposals, creates an independent project, edits generated ornament finish and roof pitch through the ordinary inspectors, tests complete ornament Undo/Redo and reopens the saved building. Source records must remain unchanged.

Reproduce:

```sh
npm ci
npm run build
BG_E2E_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/advanced-generation.spec.ts --project=desktop-chromium --project=iphone-chromium
```

Use your Chromium executable path, or omit that variable to use Playwright's downloaded browser. Fresh captures are written to ignored `test-results/`. Only the desktop comparison set and one mobile example are retained here.

The [root README](../../README.md#automated-advanced-roof-and-fantasy-ornament-generation--bg-06c) documents supported roof hosts, bounded optional simplification, canonical editable records and the physical iPhone Safari retest. BG-06B's 30/30 physical Safari approval remains the baseline; BG-06C needs its own device check.
