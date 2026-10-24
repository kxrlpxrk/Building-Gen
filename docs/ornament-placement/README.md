# Direct ornament placement · BG-06C.1

Browser evidence uses the production bundle, Chromium/SwiftShader and desktop/iPhone 13 sized layouts. These are real pointer-driven previews and selections, not separately constructed renderings. Section outlines are off; a selected ornament may show its own selection bounds. Physical Safari approval applies to BG-06C; this interaction update requires the checklist in the root README.

## Reproduce

```sh
npm run build
BG_E2E_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/ornament-direct.spec.ts --project=desktop-chromium --project=iphone-chromium
```

Omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using Playwright's installed browser. Test attachments also include the original screenshots in `test-results/`.

## Evidence

- [Dragon-head placement preview](dragon-placement-preview.png): a real canonical gable anchor, green preview and explicit confirmation.
- [Cross-gable dragon relocation](cross-gable-dragon-move.png): the saved original remains visible while its prospective destination is previewed.
- [Shield on an exposed timber wall](shield-wall-preview.png): surface-constrained placement without floating XYZ controls.
- [Invalid roof target](invalid-roof-for-shield.png): the wall ornament cannot be accepted on a roof.
- [Selected shield and matching Inspector](selected-shield-inspector.png): direct picking selects the existing ID, finish and other precision settings.
- [Invalid window collision](invalid-window-overlap.png): existing opening clearances remain enforced.

## Geometry and interaction safeguards

The finish-based visible ornament buffers are unchanged. Off-scene individual picking proxies reuse those exact artwork triangles; fine relief follows the same distance culling as the renderer. Nearest intersections must be visible against the building, with separate support visibility checks for snapped destinations. These proxies add no visible draw calls. One reusable temporary preview mesh is disposed with the scene; cached artwork and requestAnimationFrame updates avoid full building reconstruction during dragging.

All moves preserve the original ID and settings. Source and destination locks, canonical clearances, unsupported hosts, counts, whole-project references and renderer budgets are checked through the existing validation path. Roof panels/bargeboards and entrance-linked pillars retain discrete architectural anchors; carved posts retain their validated foundation elevation. These are deliberate constraints, not free spatial placement.

Desktop and iPhone-sized tests exercise every type, selection, wall movement, main/cross-gable relocation, compatible section changes, building rotation, orthographic projection, document scrolling, precision editing, generated records, locks, cancellation, Undo/Redo and persistence. Native touch checks interrupt a pending drag with a second finger; interrupted previews never save. Existing window, generation, ornament and roof suites remain part of the full regression run.

## Changed files

- Placement and pure picking: `src/ornamentPlacement.ts`, `src/useOrnamentPlacement.ts`, `src/ornamentPickGeometry.ts`.
- Pointer lifecycle/adapters: `src/exteriorPlacementGestures.ts`, `src/exteriorOrnamentGestures.ts`, `src/exteriorWindowGestures.ts`.
- Scene and UI: `src/exteriorScene.ts`, `src/ExteriorViewer.tsx`, `src/ExteriorInspector.tsx`, `src/OrnamentPlacementControls.tsx`, `src/OrnamentationPanel.tsx`, `src/Studio.tsx`, `src/styles.css`.
- Tests: `src/ornamentPlacement.test.ts`, `tests/ornament-direct.spec.ts`, release assertion in `tests/footprints.spec.ts`.
- Release and documentation: `src/App.tsx`, `package.json`, `package-lock.json`, root README, this guide and its six screenshots.

No generator, canonical schema, roof solver, ornament validator, artwork or preset changes are included.

## Verification

- `npm test`: **344 tests / 18 files passed**, including canonical anchors, rendered/picking triangle parity, grid/Free precision, both locks, ID preservation, history, IndexedDB, JSON and duplication.
- Production browser sweep: **137 passed / 11 desktop-native-touch skips** across desktop and iPhone-sized Chromium. A final four-case run passed the two refreshed shield/Inspector checks and two additional nearby-selection/mode-cancellation checks: **139 distinct browser cases verified**, with all 11 mobile counterparts of skipped desktop touch cases passing.
- `npm run build`, `npm run format:check` and `git diff --check` pass. The existing Vite advisory for the lazy Three.js chunk over 500 kB remains. No new dependencies.
- Schema remains **v10**; existing migration/regression suites pass. New physical iPhone Safari verification remains pending; Chromium emulation and software WebGL are not a physical-device performance certification.
