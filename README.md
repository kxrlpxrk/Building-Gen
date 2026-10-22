# Building Generator · BG-02B

A mobile-first architectural studio for medieval, Viking/Norse and grounded-fantasy building plans. React + TypeScript + Vite, with IndexedDB on this device and no backend, accounts, external fonts or runtime API. This repository remains independent of Hearthlands. BG-02B adds connected architectural wings/extensions to BG-01 and BG-02A. No BG-03 features are implemented.

## Run, validate and deploy

Node **22.12+** (`.nvmrc`: Node 24).

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
npm run format:check
```

For a sandbox with a read-only home directory: `npm ci --cache /tmp/bg-npm-cache`. Use this checkout, without creating a separate worktree. Development uses port 5173; preview uses 4173. Access through your environment's forwarded-port UI, or run locally. Deploy **dist/** to an HTTPS static host. No server routes or environment secrets. Subdirectory build: `npm run build -- --base=/your-path/`.

Use **HTTPS for iPhone/device playtests**, or localhost on desktop: UUID creation needs secure-context Web Crypto. Keep the same origin (protocol/host/port) when reopening local projects. No deployment is performed by these commands.

## Architectural sections and attachments

- Keep the main footprint and add up to **11 extensions**, for **12 sections total**. Types: Residential Wing, Workshop, Storage, Porch, Hall Extension, Tower Footprint and Custom. Every section has an ID, name, type, lock flag, exact dimensions and placement. Tower footprints are only ground-level shapes; floors remain metadata.
- Use **Architectural Sections** to select a section. The panel is on the desktop's left, and inside the mobile inspector. A second selected-section dropdown offers exact selection on small screens. Locked sections use a different tint/dashed outline and have disabled geometry/metadata controls.
- **Add Section / Attach Extension** opens a translucent preview without changing the saved project. Choose an external combined-footprint edge, template, type, shape, dimensions and along-edge offset. A selected exterior section edge is honoured; otherwise the first compatible exterior segment is suggested without changing the chosen dimensions. Internal-only selected edges cannot be attachment points.
- Templates: **Small side wing, Rear extension, Corner wing, Workshop attachment, Entrance porch, Square tower footprint, Custom dimensions**. They are editable starting geometry, not finished buildings. All six BG-02A footprint shapes are available for new extensions.
- The candidate's first polygon edge aligns to the external edge with opposing filled sides. Partial edge sharing, different lengths and negative/positive along-edge offsets are allowed. A join needs at least **0.1 m** of shared boundary. The blue edge is the selected attachment segment; green/red preview and validation text explain whether it can be accepted. Fit includes the preview, including a valid-shaped candidate with an invalid connection.
- **Accept extension** commits one undo transaction. **Cancel attachment** discards it. Pinch, pan, zoom and Fit continue to work during preview; existing geometry cannot be dragged while placement is active.
- Select and drag a section's interior to move it; drag its vertices/edges/corners to edit, or use the inspector's exact metre inputs. Every preview/edit validates the **whole assembly**, not just the selected shape. Invalid edits return to the committed geometry and show the reason. Valid edits may slide along a shared edge or alter its extent, but may not disconnect, overlap, create a hole or invalidate the wall inset.
- Rename and change the selected section type under Building details. **Duplicate section** deep-copies the source geometry and opens placement for a new attached copy; choose its external edge/offset before accepting. Copies are initially unlocked. **Remove section** asks for confirmation, refuses locked/main sections, and refuses removal of a connector if it strands another section. Undo restores accepted changes.
- Locked sections are never repositioned, resized, renamed or removed by other edits. Changing the common wall thickness is an explicit all-section operation and is rejected while a locked section would change. Whole-building rotation intentionally changes the assembly's frame, without changing any section or connection records.
- **Building rotation** rotates the entire assembly about its frame origin at any angle without coordinate rounding or broken attachments. Joined section orientations must be quarter-turn compatible in that frame. Exact XYZ position inputs describe the shared assembly axes; the inspector states the origin. Use whole-building rotation for arbitrary angles after attachment.

Example: a **6 × 4 m** wing sharing an edge with a **12 × 8 m** building yields **120 m²** exterior area, and **110.56 m²** clear interior at 0.2 m walls for the default attachment. The merged wall path removes the shared internal wall. Connections are **open-plan only**; no partition, doorway or door generation is claimed.

## Preserved footprint editor

Rectangle, L-shape, T-shape, U-shape, Cross and Irregular are genuine polygon outlines. The default rectangle is 12 × 8 m with 0.2 m walls: **96 m² exterior / 88.16 m² interior**. The default L removes a 4 × 3 m corner: **84 / 76.16 m²**. Presets replace the selected outline; Undo restores it, and assembly validation rejects invalid replacements.

Master coordinates use integer millimetres. Exact numeric metre inputs accept three decimal places and ignore grid snapping. Polygon length/width are validated outer extents; changing them scales that local axis with explicit millimetre rounding. Areas always use actual boundary polygons. Irregular starts with an eight-vertex stepped ring; insertion/removal/freehand drawing are not included, but imported sections can contain 4–64 vertices.

Vertex edits adjust their two neighbours to keep orthogonal edges. Edge drags move perpendicular to themselves; exact edge length fixes its start and shifts its end/following perpendicular edge. Selection highlights vertices/edges. An adjoining section's actual interior wins over transparent handle hit regions; boundary ambiguity retains the selected section, and the section list/dropdown is always available. Handles are at least 44 CSS pixels.

Independent display-grid and snap toggles; **0.25 / 0.5 / 1 / 2 m** presets and **Free**. Vertex/edge snapping uses local section axes; section movement uses shared assembly axes. Free retains 1 mm precision. Display grid thins at distant zoom and reports its visible spacing. Grid changes never change geometry.

Edit/Pan tools, anchored zoom, wheel/pinch, Fit, collapsible desktop panels and mobile bottom/landscape side inspector are retained. Pointer previews commit once on release; cancellation or a second finger rolls back the preview before pinch starts. A remaining finger cannot accidentally resume editing. Undo history retains the last 100 transactions in the active session.

Keyboard: **V** Edit, **H** Pan, **⌘/Ctrl Z** Undo, **⌘/Ctrl Shift Z / Ctrl Y** Redo, **⌘/Ctrl S** Save. Focus canvas and use arrows to move the selected unlocked section by its snap step (0.1 m for Free/snap-off; Shift ×10). Enter commits exact inputs; Escape restores a numeric field or cancels/deselects a canvas gesture.

## Deterministic geometry and limits

`orthogonalUnion.ts` uses **coordinate compression and a vertical sweep**. Slabs are delimited by actual integer edge coordinates; they are exact cells, not a sampled raster. Occupied intervals form the union. Positive-area overlaps are detected, internal edges are removed, the exterior boundary is traced, and collinear segments are simplified. Multiple boundary loops or branching/touching contours are rejected, so holes/disconnections are never silently repaired. Results are deterministic across input order/winding.

Each section uses a simple orthogonal ring before rotation, with 4–64 vertices, alternating horizontal/vertical edges and at least 0.1 m per edge. Section/combined extents are limited to 0.5–500 m, source local vertices to ±500 m, and stored section/frame positions to ±10,000 m. The merged ring supports up to 768 vertices. Sections must share one ground-level Z value and common wall thickness. Z and floor counts remain metadata, not structural levels.

Shoelace area computes exact exterior area. Clear area and the continuous rendered external wall band use the **validated mitered inward offset of the merged boundary**, not sums of section interiors or bounding-box estimates. The offset must remain one positive connected ring, not reverse edges, cross boundaries or intrude within the wall clearance. Too-thick walls, tiny jogs, collapsing necks, split interiors, overlapping interiors, holes, corner-only contacts and detached sections are rejected. Common exterior walls must be at least 0.01 m. No invalid measurement is replaced by an estimated value.

## Schema v3 and migration

The existing `building-generator-bg01` IndexedDB database, database version 1, and `projects` object store are retained. `schemaVersion: 3` adds:

- `building.mainSectionId` and up to twelve `sections`.
- Section `name`, `type`, `locked`, with the original rectangle or polygon geometry fields.
- `building.frame`: `origin` (integer XY), `axis`, `rotation`, `mode`.
- Explicit connections: stable `id`, endpoint section IDs and edge indices, shared integer segment `start`/`end`, `mode: "open-plan"`.

Pure read-time migration accepts schema **1, 2 and 3**. Valid BG-01/BG-02A sections retain **all original IDs, names, architecture, geometry, position, rotation, wall/floor measurements and timestamps**. New section metadata defaults to Main building / Custom / unlocked. Legacy rectangles remain rectangles; polygons retain their original vertices and ordering. `frame.mode: "legacy"` preserves the single section's world transform and precision; its initial origin/axis mirror the section without rewriting geometry.

The first accepted attachment enters **assembly** mode. Positions then share integer assembly axes anchored at that preserved origin; section quarter turns are relative to the frame axis. The frame's additional `rotation` is applied only for rendering/world transforms, so attachments stay exact. An assembly retains its frame even after its last extension is removed; remaining sections cannot jump, including moved/locked sections. Earlier-phase single-section projects retain their original arbitrary orientation and world-placement controls until attachment.

Connections are derived from real shared section edges and persisted explicitly. Edits recompute segments and retain connection IDs for the same endpoint-edge pair. Imports require connection records to match the geometry exactly, rather than silently repairing stale relationships. Project duplication and conflicting-ID imports rekey **every section and connection** and remap all references, with independent vertex arrays. Exports use v3; v1/v2 imports remain supported, but older app versions cannot open v3 exports.

Library reads never overwrite old records. A successfully validated legacy record is written as v3 on the next edit/save/exit. Invalid/unsupported records stay untouched and are reported; loading failures never create fallback projects. The legacy JSON schemas remain alongside `schemas/project-v3.schema.json`. Runtime validation adds connectivity, lock-transition, geometry and cross-field checks beyond structural JSON Schema.

## Files changed / implementation map

| File                                                                     | Responsibility                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/orthogonalUnion.ts`                                                 | Exact deterministic orthogonal union and boundary tracing                                   |
| `src/assembly.ts`                                                        | Shared frames, contacts, connected merged geometry, wall areas, lock-aware edits            |
| `src/attachments.ts`                                                     | Seven templates, edge-aligned placement preview, removal constraints                        |
| `src/SectionsPanel.tsx`, `src/ExtensionPanel.tsx`                        | Section list/actions and configurable preview inspector                                     |
| `src/Studio.tsx`                                                         | Section selection, undoable assembly operations, common walls, whole-building rotation      |
| `src/Editor.tsx`                                                         | Section hit testing, assembly-aware drags, merged walls, preview and reused camera gestures |
| `src/model.ts`                                                           | Schema v3, lossless migrations, relationship validation, complete identity remapping        |
| `src/App.tsx`                                                            | Combined dashboard previews, dimensions/area, import/export/project management              |
| `src/polygon.ts`, `src/footprint.ts`                                     | Reused polygon operations extended for merged rings; preserve section metadata              |
| `src/styles.css`                                                         | Section, lock, preview and responsive control styles                                        |
| `schemas/project-v3.schema.json`                                         | Multi-section/connection/frame schema                                                       |
| `src/assembly.test.ts`, `src/storage.test.ts`, `src/polygon.test.ts`     | Union/attachment/migration/locking regressions and updated v3 expectations                  |
| `tests/sections.spec.ts`, `tests/footprints.spec.ts`, `tests/fixtures/*` | New assembly browser coverage plus prior-phase migrations and regressions                   |
| `package.json`, `package-lock.json`, `README.md`                         | Version 0.3.0 and workflow documentation                                                    |

Camera transforms, bounded history and IndexedDB transaction modules are reused. No new runtime dependencies or repository were introduced.

## Automated checks

```sh
npx playwright install chromium webkit
npm run test:e2e
```

Linux may require Playwright system dependencies (`npx playwright install-deps`, with administrator permission). Browser installation needs the official CDN. With preinstalled Chromium:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=desktop-chromium --project=iphone-chromium
```

After building, prefix the browser command with **`BG_E2E_PREVIEW=1`** to validate the production bundle through preview. Stop other servers on port 5173 first. For WebKit when available: `npm run test:e2e -- --project=iphone-webkit`.

Tests cover the 120 m² wing acceptance case, no doubled join walls, multiple/partial attachments, all templates, invalid overlaps/holes/disconnections, compatible rotations, lock isolation, connector removal, twelve-section limit, frame stability after removing the last extension, undo/redo, complete duplication, v1/v2 migrations, persistence, v3 JSON, adjoining touch regions and native multi-touch isolation. Earlier BG-01/BG-02A workflows are retained; only schema/version expectations change to v3/BG-02B. Final validation: **78 unit/storage tests passed**, **25 desktop/mobile Chromium production-browser tests passed**, and **3 desktop-inapplicable native touch tests were intentionally skipped** (their mobile runs passed). TypeScript/Vite production build and formatting checks passed.

WebKit is not installed in this machine (the official browser CDN was blocked during BG-01 setup). Chromium mobile emulation/native Chromium touch dispatch does **not** verify physical iPhone Safari; run the playtest below on a device.

## Known limitations and data safety

- Strict edge-to-edge, **open-plan** joins only; all positive-area overlaps are rejected. Attachment aligns the candidate's first local edge; change the external segment, offset or shape to choose another placement. No partitioned joins, door/room systems, holes, split interior offsets, slanted local edges, vertex insertion/removal or freehand drawing.
- One main building cannot be removed. Section count max 12; combined dimensions max 500 m. No automatic movement of neighbours to “fix” an invalid edit. A duplicated section must be placed on a valid external edge before acceptance.
- Common walls/elevation must agree. A locked section blocks any operation that would modify its stored data. Whole-building rotation is an intentional frame operation and does not unlock/change section records. Undo/redo restores previously committed lock/geometry states.
- IndexedDB autosaves after 400 ms idle; Saving/Saved/Save Error, retry/export backup and flush-before-leave are retained. Wait for **Saved**. Private browsing, clearing site data, storage pressure, origin changes or OS termination can lose local/unsaved data. Export JSON backups. Persistent storage is requested but not guaranteed.
- Same-project multi-tab editing has no conflict resolution (last save wins). History/view/grid preferences are session-only. No service worker/offline installation.
- No BG-03: rooms, doors, stairs, furnished interiors, roofs, 3D, procedural buildings, game conversion or structural engineering are not implemented.

## Short iPhone Safari playtest

1. At the same HTTPS origin, reopen one BG-01 rectangle and one BG-02A polygon. Verify original measurements, geometry, architecture, position, rotation and floor metadata, then export backups.
2. Attach a **6 × 4 m** wing to the default main and confirm **120 m² exterior**, a single continuous external wall, and no separating wall at the join. Try each template and partial/negative offsets; verify green/red previews and safe cancel.
3. Select adjoining sections near shared-edge handles and via the panel/dropdown. Slide, resize and edit dimensions to millimetre precision. Attempt overlap/disconnection and oversized walls; verify rejection without moving neighbours.
4. Rename, lock/unlock, duplicate and remove sections. Lock a wing, edit the main, and verify the locked record stays unchanged. Try removing a connector and the main. Undo/redo accepted operations.
5. Rotate the whole building by **37.5°**, then Fit, pan and pinch during an active section drag. Geometry/connections must remain unchanged by pinch. Remove the last extension and verify the main does not jump.
6. Rotate portrait/landscape, scroll/collapse inspector, and use the virtual keyboard. Check safe areas, canvas usability, no horizontal overflow or clipped controls. Wait for Saved, reopen Safari, and roundtrip v1/v2/v3 JSON and independent project/section copies.
