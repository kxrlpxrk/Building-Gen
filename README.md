# Building Generator · BG-02A

A mobile-first architectural studio for medieval, Norse and grounded-fantasy building plans. React + TypeScript + Vite, with browser-local project storage and no backend, account, external fonts or runtime API. This repository is independent of Hearthlands. BG-02A adds advanced footprints to BG-01; BG-02B is not implemented.

## Run, validate and deploy

Use Node **22.12+** (`.nvmrc`: Node 24).

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
npm run format:check
```

For a cloud sandbox with a read-only home directory, use `npm ci --cache /tmp/bg-npm-cache`. Use this checkout; no separate worktree is required. Development uses port 5173 and production preview uses 4173. Access through the environment's forwarded-port UI or run locally. Deploy **dist/** to an HTTPS static host; there are no server routes or environment secrets. For a subdirectory deployment: `npm run build -- --base=/your-path/`.

Use **HTTPS for iPhone/device testing**, or localhost for desktop development. UUID creation uses secure-context Web Crypto. Keep the same protocol, host and port between visits: IndexedDB is origin-scoped. No deployment is performed by these commands.

## Studio workflow

- Dashboard and searchable library: create, open, rename, independent duplicate, confirmed delete, JSON import/export.
- Start with a **12 × 8 m** rectangle and **0.2 m** exterior walls: **96 m²** exterior and **88.16 m²** clear interior.
- Choose **Rectangle, L-shape, T-shape, U-shape, Cross or Irregular** in the inspector. Each preset is a single connected outline. Presets replace local geometry, preserving position, rotation, walls, IDs and metadata; Undo restores the prior outline. Invalid preset/wall combinations are rejected. The default L is 12 × 8 m minus a 4 × 3 m corner: **84 m²**, or **76.16 m²** inside 0.2 m walls.
- Edit exact metre inputs (up to three decimal places). Polygon Length/Width describe **outer extents**, and changing them scales that local axis with integer-millimetre rounding. Exterior and usable interior areas always use actual polygons, never bounding-box area.
- In Edit, drag inside the footprint to move it. Drag a vertex to reposition it and its orthogonal neighbours. Drag an edge perpendicular to itself. Vertices and edges have 44+ CSS-pixel hit targets and highlight when selected.
- Use **Vertices & edges → Select a part** to select without dragging, then enter exact edge length or local vertex X/Y. An exact edge-length edit fixes its start and moves its end and the following perpendicular edge. Numbering follows the stored vertex order. Short-edge labels show their number at distant zoom; selecting an edge or zooming in reveals its exact length. Enter commits numeric fields; Escape restores their current value.
- A valid preview commits once on pointer release, making one undo transaction. Invalid previews show an error and cannot commit; no invalid measurement is replaced by an estimate. Adding a second finger cancels a geometry preview before starting pinch/pan. After one finger lifts, the remaining finger cannot accidentally edit geometry.
- Independent display-grid and snap toggles; presets **0.25, 0.5, 1, 2 m**, plus **Free**. Numeric edits ignore snapping. For rotated polygons, vertex/edge snapping follows the local unrotated axes; whole-footprint movement snaps world position. Free retains millimetre precision and uses a 0.5 m display grid when visible. At distant zoom, grid lines are thinned to a larger labelled spacing. Grid changes never alter geometry.
- Edit/Pan tools, mouse wheel and touch pinch, anchored zoom, Fit, and arrow-key movement use the existing BG-01 camera and history. Fit uses the rotated footprint vertices. Collapsible desktop panels; scrollable bottom inspector in portrait and side inspector in landscape, with safe areas.
- Architecture (Medieval/Norse/Mixed), XYZ origin, clockwise orientation and floors (1–4). Floors and Z elevation remain metadata only.

Keyboard: **V** Edit, **H** Pan, **⌘/Ctrl Z** undo, **⌘/Ctrl Shift Z** or **Ctrl Y** redo, **⌘/Ctrl S** save. Focus the canvas and use arrows to move the whole footprint by the snap step (0.1 m for Free/snap-off); Shift multiplies by 10. Escape cancels/deselects. Session history retains the last 100 transactions.

## Geometry and wall rules

Master coordinates are **integer millimetres**. X/Y form the overhead plane (screen Y increases downward); positive orientation is clockwise. Position is the world location of the local origin, not necessarily a polygon's bounding-box corner. Local edges remain orthogonal before rotation.

- One simple ring, **4–64 vertices**, with alternating horizontal and vertical edges. No holes, self-crossings, self-touching, redundant collinear/reversing vertices or zero edges. Polygon edges must be at least **0.1 m**.
- Outer extents: **0.5–500 m**; local vertex coordinates: **±500 m**; world XYZ origin: **±10,000 m**; orientation: **0° ≤ angle < 360°**.
- Walls: at least **0.01 m**, with a valid positive clear interior. Shoelace area computes the exact exterior area. Clear area comes from an **orthogonal mitered inward offset** at the specified wall thickness, using integer arithmetic for its vertices. Both source windings are supported.
- An offset is rejected if it reverses an edge, self-intersects, leaves the exterior, collapses, or changes topology. Thin-neck shapes whose clear interior would split into separate islands are not accepted in BG-02A. There is no bounding-box subtraction fallback or silently estimated area.
- The wall band rendered with an even-odd SVG path is exactly the outer ring minus this validated inner ring. Geometry is separate from rendering and has no polygon dependency.

Irregular starts with an editable eight-vertex stepped ring. Editing a polygon marks its preset as Irregular. Vertex insertion/removal and freehand drawing are not included; imported valid orthogonal rings can have up to 64 vertices.

## Schema v2 and BG-01 migration

`schemaVersion: 2` supports a rectangle section (BG-01's original fields) or polygon section (`kind: "polygon"`, `preset`, `vertices`). For polygons, vertices are authoritative; `length` and `width` are validated outer-extent fields for existing dimension controls. A mismatch is rejected, not silently repaired. One building/one editable section remains the only supported structure.

**BG-01 storage and JSON remain readable.** The database stays `building-generator-bg01`, version 1, with the same `projects` store. A pure read-time migration validates a schema-v1 rectangle and reconstructs schema v2 **without changing IDs, name, architecture, timestamps, measurements, position, orientation or floor count**. Retaining rectangle sections avoids any coordinate rounding or geometry conversion loss.

Migration does not rewrite the database during library loading. A validated project is saved as v2 on its next edit, explicit save or exit from the studio. Invalid and unsupported records are left untouched and reported as unreadable. Imports validate completely before writing. Both v1 and v2 imports are supported; exports use v2. BG-01 cannot read v2 exports. The v1 schema remains available; the v2 schema documents the new structure and the runtime validator enforces geometric cross-field rules.

Importing an existing ID creates fresh project/building/section IDs while preserving the imported name, timestamps, geometry and metadata. Existing records are never replaced by an import. Duplication deep-copies all vertices and metadata. The 1 MB import limit and safe unknown-field reconstruction remain in place.

## Files and responsibilities

| File                                                               | Responsibility                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/App.tsx`                                                      | Dashboard/library, actual polygon previews, import and project management             |
| `src/Studio.tsx`                                                   | Active project, autosave queue, history, preset selector and exact inspector          |
| `src/Editor.tsx`                                                   | Existing SVG/pointer state machine extended with edge and vertex interaction          |
| `src/polygon.ts`                                                   | Orthogonal validation, shoelace area, inward wall offset, six presets and part edits  |
| `src/geometry.ts`                                                  | BG-01 geometry plus footprint dispatch, area and validation                           |
| `src/footprint.ts`                                                 | Typed preset application, polygon extent updates and axis scaling                     |
| `src/transforms.ts`, `src/history.ts`                              | Reused BG-01 camera transforms and bounded transaction history                        |
| `src/model.ts`                                                     | Schema-v2 validation, pure BG-01 migration, serialization and independent duplication |
| `src/storage.ts`                                                   | Reused IndexedDB transactions; validator performs safe read-time migration            |
| `src/components.tsx`, `src/styles.css`, `src/main.tsx`             | Shared UI, responsive styles, error boundary                                          |
| `schemas/project-v1.schema.json`, `schemas/project-v2.schema.json` | Legacy and current JSON schemas                                                       |
| `src/*.test.ts`                                                    | Original BG-01 regressions plus polygon, migration and persistence tests              |
| `tests/app.spec.ts`, `tests/footprints.spec.ts`                    | Original and new browser workflows and native mobile touch checks                     |
| `tests/fixtures/bg01-project.json`                                 | Actual schema-v1 fixture with precise non-default measurements and metadata           |

## Browser tests and results

```sh
npx playwright install chromium webkit
npm run test:e2e
```

Linux may need Playwright system dependencies (`npx playwright install-deps`, with administrator permission). Browser downloads require access to Playwright's official CDN. If Chromium is already installed:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=desktop-chromium --project=iphone-chromium
```

After `npm run build`, prefix the browser command with **`BG_E2E_PREVIEW=1`** to test `dist/` through Vite preview. Stop any other server using port 5173 first. To test Safari's engine when WebKit is available:

```sh
npm run test:e2e -- --project=iphone-webkit
```

The original BG-01 tests remain unchanged and passing. Added checks cover six preset rings, known concave areas and wall insets, vertex/edge editing, invalid geometry, exact measurements versus grid, rotated movement/fit, undo/redo, deep duplication, pure v1 migration, real v1 database/JSON reads, v2 save/reload/import/export, invalid record preservation, responsive overflow, and pinch isolation. Validation: **50 unit/storage tests passed**, **18 desktop/mobile Chromium browser tests passed against the production build**, two desktop-inapplicable native touch tests intentionally skipped. TypeScript/Vite build and formatting checks passed. WebKit is not installed in this cloud machine (its official CDN download was blocked during BG-01 setup). Physical iPhone Safari remains a required manual playtest; Chromium emulation does not establish Safari compatibility.

## Data safety and known limits

- IndexedDB autosaves after 400 ms idle, with **Saving / Saved / Save Error**, retry and JSON backup. Leaving flushes before navigation; a failed flush needs confirmation to leave unsaved. Loading errors never create fallback projects.
- Wait for **Saved** before closing. Safari private browsing, clearing site data, OS storage pressure and origin changes can remove or hide local data. Persistent storage is requested after create/import but is not guaranteed. Export backups. Mobile termination can interrupt an in-flight save, even with the background flush attempt.
- Same-project multi-tab editing has no conflict resolution (last save wins). View/grid preferences and undo history are session-only.
- The legacy rectangle corner-resize clamp remains for BG-01 compatibility; polygon and exact measurement edits reject invalid geometry. Polygon axis scaling rounds to whole millimetres and validates the result. Rotated rectangle origin rounding can displace the opposite corner by less than 1 mm per resize transaction.
- Single orthogonal outline only: no vertex insertion/removal, holes, split interior offsets, architectural wings, multi-section editing, rooms, procedural generation, roofs, 3D, interiors, game conversion, accounts, cloud sync or AI. No BG-02B. No offline service worker.

## Short iPhone Safari playtest

1. Open an HTTPS deployment at the same origin used for BG-01. Reopen a legacy plan; verify precise measurements, IDs via export, architecture, position, rotation and floors survive. Export a backup.
2. Try all six presets. Check the default L shows **84 m² exterior / 76.16 m² clear interior**. Change grid and Free without changing existing dimensions.
3. Select/drag each concave vertex and edge. Edit an edge to **3.251 m** and local vertex X/Y numerically. Try a negative edge length, crossing edit and oversized walls; confirm visible rejection and unchanged saved geometry. Undo/redo each valid transaction.
4. Move/rotate the footprint; zoom, Fit, pan and pinch during an active vertex drag. Pinch must cancel the drag, leave geometry unchanged and add no undo step. Lifting one finger must not resume editing.
5. Rotate portrait/landscape, open/collapse/scroll inspector, and use the virtual keyboard. Verify no page scroll during canvas touches, horizontal overflow, clipped controls or unsafe-area overlap.
6. Wait for Saved, refresh and reopen Safari. Duplicate and edit independently; export/import v1 and v2 JSON, try invalid JSON and cancel/confirm deletion. Existing projects must remain intact.
