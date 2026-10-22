# Building Generator · BG-01

A mobile-first architectural studio for medieval, Norse and grounded-fantasy building plans. React + TypeScript + Vite; no backend, account, external fonts, or runtime API required. This repository is independent of Hearthlands. Only BG-01 is implemented.

## Run and deploy

Use Node **22.12+** (Node 24 used for validation).

```sh
npm ci
npm run dev
```

In a cloud sandbox with a read-only home directory, use `npm ci --cache /tmp/bg-npm-cache` instead. Use the existing checkout; no separate worktree is required.

```sh
npm test
npm run build
npm run preview
```

`dev` uses port 5173 and `preview` uses port 4173 by default. Access these through your environment's supported forwarded-port UI, or run locally. No deployment was performed. Deploy the generated **dist/** directory to any HTTPS static host. There are no server routes or environment secrets. For a subdirectory deployment, build with `npm run build -- --base=/your-path/`.

Use **HTTPS for iPhone/device testing** (or localhost for desktop development): stable UUID creation uses the browser's secure-context Web Crypto API. Use a trusted HTTPS static deployment for the most representative Safari playtest. Keep the same origin between visits: IndexedDB is scoped to protocol, hostname, and port.

## What works

- Dashboard and searchable project library; create, open, rename, independent duplicate, confirmed delete.
- One rectangular section, initially 12 × 8 m, with 0.2 m exterior walls.
- Architecture, XYZ position, orientation, and floor metadata (1–4).
- Integer-millimetre master geometry; exact metre inputs (three decimal places), exterior and usable interior areas.
- Visible wall thickness, dimension labels, selection, movement, corner resize, Edit/Pan tools, Fit, zoom controls, mouse wheel, touch pan and pinch.
- Independent display-grid and snapping toggles; 0.25 / 0.5 / 1 / 2 m presets and Free. Free removes quantization while retaining 1 mm model precision; its display grid remains 0.5 m when visible. At distant zoom levels, display-grid spacing increases to remain legible. Grid settings never change existing geometry.
- Collapsible desktop panels; compact mobile toolbar, scrollable bottom inspector in portrait and side inspector in landscape; safe-area support.
- Session undo/redo (last 100 transactions). Drag previews commit on pointer release; pointer cancellation or a second finger rolls the drag back. Pinch/pan never commits geometry. Resize uses pointer deltas so grabbing the edge of a large handle does not jump the corner.
- Validated IndexedDB storage, autosave after 400 ms of inactivity, explicit Saving / Saved / Save Error status, retry and JSON backup on error. Leaving the studio flushes the current project before navigation. A failed flush requires confirmation to leave unsaved.
- Versioned JSON export/import with size limits and runtime schema validation. Invalid files never write to storage. An import with an existing project ID gets fresh project/building/section IDs while retaining its name, timestamps, geometry and metadata; the original is preserved.

Keyboard: **V** Edit, **H** Pan, **⌘/Ctrl Z** undo, **⌘/Ctrl Shift Z** or **Ctrl Y** redo, **⌘/Ctrl S** save. Focus the canvas to use arrow keys to move a selection (current snap step, or 0.1 m in Free/snap-off; Shift multiplies by 10). Escape cancels a canvas gesture or deselects. Enter commits numeric fields; Escape restores the current value in a numeric field.

## Model and implementation map

| File                             | Responsibility                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                    | Dashboard, project library, validated import and project-management dialogs                           |
| `src/Studio.tsx`                 | Active project, editing history, autosave queue, toolbar and inspector                                |
| `src/Editor.tsx`                 | SVG plan and pointer-gesture state machine                                                            |
| `src/geometry.ts`                | Millimetre validation, areas, snapping, rotated rectangles, move/resize                               |
| `src/transforms.ts`              | Camera, invertible screen/world transforms, anchored zoom, pan, pinch, fit                            |
| `src/model.ts`                   | Schema v1, stable identities, safe parsing/serialization, deep duplication                            |
| `src/storage.ts`                 | IndexedDB transactions, validation, error isolation and persistence request                           |
| `src/history.ts`                 | Pure bounded transactional undo/redo                                                                  |
| `src/components.tsx`             | Dialog, exact numeric fields, export and branding                                                     |
| `src/styles.css`                 | Responsive studio/dashboard and safe-area styles                                                      |
| `schemas/project-v1.schema.json` | Portable structural JSON Schema; model validator also checks cross-field constraints                  |
| `src/*.test.ts`                  | Core calculations, transforms, history, serialization and IndexedDB tests                             |
| `tests/app.spec.ts`              | Browser project lifecycle, precise editing, gestures, responsive layouts and storage failure/recovery |

A project owns a building containing a typed section list. IDs persist across edits and exports. `kind: "rectangle"` is the current section discriminator; `schemaVersion` gates future migrations. Do not silently load a newer or unknown schema as defaults. Future footprints, rooms, roofs, interiors, extensions and game conversion should extend a deliberate schema version; there are no nonfunctional placeholder features.

X/Y form the overhead plane (SVG Y increases down); positive rotation is clockwise on screen. Position is the section's first exterior corner; Z is metadata elevation. Length and width range from 0.5 to 500 m, position from −10,000 to +10,000 m, walls from 0.01 m up to strictly less than half the shorter side, orientation from 0° up to 360° exclusive. Interior area is `(length − 2 × wall) × (width − 2 × wall)`.

## Tests

```sh
npm test
npm run build
npm run format:check
npx playwright install chromium webkit
npm run test:e2e
```

Playwright includes desktop Chromium, iPhone-profile Chromium and iPhone-profile WebKit. Linux hosts may need Playwright system dependencies (`npx playwright install-deps`, with administrator permission). Browser downloads need access to Playwright's official CDN.

If Chromium is preinstalled, run without downloading another copy:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=desktop-chromium --project=iphone-chromium
```

To run the browser checks against a previously built `dist/` rather than the development server, prefix the test command with `BG_E2E_PREVIEW=1` (stop any server on port 5173 first). Both development and production modes were exercised.

Validation in this cloud machine: **20 unit/storage tests passed**, production TypeScript/Vite build passed, **11 Chromium browser tests passed** (desktop + mobile profiles), one native-touch-only test intentionally skipped in the desktop profile. Responsive checks cover 320 × 568, 390 × 844, 844 × 390 and 1440 × 900 with no horizontal document overflow. Native Chromium touch dispatch verifies that adding a second finger cancels an in-progress geometry edit and that pinching/panning does not create an undo transaction.

WebKit browser installation was blocked by network policy at the Playwright download CDN. WebKit and physical iPhone Safari playtests have **not** been executed; Chromium device emulation is not a substitute for Safari. Run the WebKit project when the browser is available:

```sh
npm run test:e2e -- --project=iphone-webkit
```

## Known limits and data safety

- Browser-local storage only. Safari private browsing, clearing site data, OS storage pressure or origin changes can remove or hide projects. A persistence request is attempted after creation/import but the browser decides whether to grant it. Export JSON backups for durable copies.
- Wait for **Saved** before refreshing or closing. Mobile OS termination can interrupt an in-flight save; the app also tries to flush when hidden. It does not promise that OS-killed unsaved edits survive.
- One active editing session per project is recommended. Simultaneous edits to the same project in multiple tabs have no conflict resolution (last save wins).
- Undo history and view/grid preferences are session-only. Saved project geometry and metadata persist.
- Integer coordinates can introduce sub-millimetre rounding when resizing a rotated rectangle; opposite-corner displacement is bounded to less than 1 mm per resize transaction.
- No service worker/offline installation; the application shell must be served. No BG-02 features, 3D, rooms, procedural generation, roofs, interiors, games, accounts, AI, or cloud sync.

## iPhone Safari playtest

1. Open the HTTPS deployment in normal Safari. In portrait, create two buildings; verify the default **96 m²** exterior / **88.16 m²** interior areas.
2. Enter **13.247 m** length and a negative X position. Change all grid presets and Free; confirm exact inputs do not change. Reject walls too thick for the footprint.
3. Drag the building and each corner handle. Undo/redo each transaction. Check pinch while a drag is active: it should cancel the preview, zoom/pan the view, and leave geometry untouched. Lift one finger and continue moving it; geometry must remain unchanged.
4. Switch Edit/Pan, pan, zoom, and Fit. Confirm canvas touches do not scroll the page. Collapse/expand the inspector, scroll its fields and rotate to landscape; verify no clipped controls, horizontal overflow, or unsafe-area overlap. Check the virtual keyboard does not zoom the page or prevent committing a field.
5. Wait for Saved, refresh, close Safari and reopen the same origin. Confirm both independent projects, names, measurements, orientation and floors remain.
6. Rename, duplicate, edit the copy, cancel deletion, then confirm deletion. Export JSON to Files and import it; verify metadata/geometry and preservation of the original. Try malformed JSON; existing projects must remain intact.
7. If local storage is unavailable or full, verify Save Error, retry and export backup; never accept a silently reset project.
