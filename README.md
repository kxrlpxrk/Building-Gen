# Building Generator · BG-03B

A mobile-first architectural studio for medieval, Viking/Norse and grounded-fantasy building plans. React + TypeScript + Vite, with IndexedDB on this device and no backend, accounts, external fonts or runtime API. This repository remains independent of Hearthlands. BG-03B adds manually placed doors, passages and ground-floor circulation analysis to BG-03A interiors, retaining BG-02B.1 mobile document scrolling. No BG-04 features are implemented.

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

## Doors, openings and circulation · BG-03B

In **Interior Planning**, use **Place Door** and tap a real partition or exterior wall. The Doors & Openings Inspector shows a translucent placement with valid/invalid feedback. Adjust its centre distance from the host's start and width, then **Confirm opening** or **Cancel opening**. No preview changes saved geometry. Hinged doors default to **0.9 m**, open passages to **1.2 m**; the host determines Interior Door or Exterior Entrance. Passage openings may also open to outside.

- Tap a saved opening or use **Select door/opening**. Drag its centre along its wall, or a jamb handle to resize symmetrically, then confirm the preview. Exact numeric edits on a saved opening commit independently; they never resize its wall. Deletion asks for confirmation. All accepted operations support Undo/Redo. Grid/Free affects canvas placement/dragging; exact inputs preserve integer-mm precision. Whole-building translation/rotation preserves anchors and door orientation.
- Each opening has a stable ID, type, source-wall reference and integer-mm centre offset/width. Partition references use stable partition IDs; external references use source section ID plus edge index. Source edges must coincide with a real merged exterior boundary. BG-02B open-plan section joins have no wall and cannot host doors.
- Physical gaps are cut from the wall bands with SVG luminance masks, including exterior walls in Footprint mode. Room-separating partition geometry stays logically complete: inserting/removing doors never merges regions, rekeys rooms or changes their names/types/notes. Threshold surfaces are shown separately.
- A hinged leaf opens 90° about its chosen jamb, with a true radius-width swing arc. **Left** means the wall-start jamb; **Right** the wall-end jamb. **Side A** is left of the directed host, **Side B** right. **Flip Hinge** and **Reverse Swing** update the geometry. Passages have no leaf, hinge or arc. A warning appears when the swept quarter-disc intersects physical wall geometry; this includes exterior walls and excludes confirmed opening gaps. It is advisory and does not prevent intentionally obstructed layouts.
- Widths are **0.4–3 m**. Leave **0.1 m** from host endpoints, merged exterior corners, other openings and partition junctions. The full aperture must adjoin clear space on both partition sides, or exactly one interior side for an exterior opening. Invalid overlaps, junction cuts, unsupported hosts and protrusions are rejected. Maximum **128 openings**. Relevant section locks protect opening placement, edits and deletion.
- Moving a host carries its opening. Resizing a wall start adjusts its stored offset to keep the opening's longitudinal location fixed. Reversing/replacing a host direction requires explicit opening removal/relocation first. Host shortening, removal and footprint/extension edits revalidate all openings and reject invalid edits without detaching or deleting them.

**Area convention:** thresholds through partitions are **separate passage area**, excluded from logical net room areas. Net rooms + remaining physical partitions + interior thresholds = the unchanged usable-interior baseline. Exterior thresholds reduce exterior wall footprint only and are never added to that baseline. For the centred BG-03A partition, rooms remain **43.70 + 43.70 = 87.40 m²**. A 0.9 m door through its 0.1 m thickness contributes **0.09 m²** threshold and leaves **0.67 m²** partition: **87.40 + 0.09 + 0.67 = 88.16 m²**. A 0.9 m entrance through 0.2 m exterior walls removes **0.18 m²** exterior wall footprint without changing 88.16 m². Calculations are exact; displayed areas are rounded.

`src/circulation.ts` builds an access graph from validated apertures and the actual full-width clear regions on each wall side. Exterior openings seed reachability; interior doors/passages add region edges, including multi-hop routes. Open-plan regions are already continuous. The Inspector reports **Accessible** or **No entrance path**, including the selected room; disconnected regions receive warning outlines. Intentionally inaccessible rooms remain valid and savable. This is potential ground-floor traversal through placed doors, without a closed/locked door state; it is not real-world code, accessibility or fire-escape certification. No connections are invented.

## Manual interior planning · BG-03A

Switch between **Footprint** and **Interior Planning**. Footprint retains the complete section editor; Interior Planning shows the actual merged clear interior, including continuous open-plan joins. Floor counts remain metadata; only the ground floor has a plan.

- **Draw Wall**: tap a start, then an end. The preview is constrained to horizontal/vertical building-local axes. Boundary and existing partition endpoint/centreline snapping takes priority within 10 screen pixels, then the selected grid; Free preserves millimetres without grid rounding. Snap off disables magnets. Use **Cancel wall start** or Escape to cancel. Default thickness is **0.1 m**; set New partition thickness before drawing.
- **Select Wall**: tap the physical wall or its 44px hit region; drag its body to move, or either endpoint to resize along its axis. The partition dropdown resolves junction ambiguity. Exact start X/Y, direction, length and thickness inputs ignore grid rounding. Deletion requires confirmation. Each accepted edit is one undo transaction.
- Corners and T-junctions may meet at centreline endpoints; an end can also butt against a wall face. Junction footprints are unioned once. Protrusions, positive-area parallel overlaps, unsupported four-way crossings, zero/short walls and impossible clear geometry are rejected with an explanation. Wall thickness is physical geometry, not a display stroke.
- **Select Room**: tap a clear region or choose it in the Inspector. Assign a name, one of ten room types and notes. Text fields commit on blur; wall geometry controls boundaries. A named or typed region counts as assigned; other clear space is visibly unassigned. Areas exclude the unioned partition footprint, including clean joints and floating/unfinished walls.
- A dangling or floating partition does not create additional rooms. Clear connected regions may be concave or contain a partition island; even-odd boundary rings and exact cell area account for these. Displayed outer extents are labelled as extents and are never used as net area.
- When topology remains unchanged, region IDs and labels survive wall movement through unique boundary-side/topological matching, with an unambiguous positive-area overlap fallback. Merges/splits retain ambiguous names, types and notes under **Retained room labels**, with a visible notice in both modes. Copy a label to a selected region; discarding a retained label requires confirmation. Undo restores all prior assignments.
- Existing interiors validate against every structural footprint/extension edit. Invalid edits are rejected, preserving the previous plan. Valid edits that merge/split clear space retain affected labels. Whole-building X/Y placement translates sections and their frame equally; rotation changes only the frame. Both preserve local partition coordinates. Section locks prevent adding, moving or deleting partitions that overlap the locked section; whole-building translation also respects locks.

Acceptance example: a **12 × 8 m** rectangle with **0.2 m** exterior walls has **88.16 m²** usable interior. A vertical partition from **(6, 0.2) m** to **(6, 7.8) m**, thickness **0.1 m**, occupies **0.76 m²**, leaving **two 43.70 m² regions**, **87.40 m²** total clear area. Assigned + unassigned + partition area reconciles exactly with usable interior; the UI rounds displayed areas to two decimals.

`src/interior.ts` performs deterministic coordinate compression at actual boundary/wall-face coordinates, unions wall occupancy, flood-fills clear regions and traces oriented exterior/hole rings. It uses no sampled raster, bounding-box room areas or runtime geometry dependency. Integer-mm centrelines and thickness are stored; odd thicknesses have exact half-mm derived faces. Geometry/topology remains separate from SVG rendering and camera transforms.

Planning limits: **64 partitions**, **512 active/retained room records**, at least **0.1 m** wall length and **0.1 m** clear passages/spans with partitions, **0.01–1 m** partition thickness, at most **1,000,000 exact compressed cells**. Valid older footprints with narrower clear space remain loadable with an empty plan. These are editing limits, not structural-engineering guarantees.

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

Example: a **6 × 4 m** wing sharing an edge with a **12 × 8 m** building yields **120 m²** exterior area, and **110.56 m²** clear interior at 0.2 m walls for the default attachment. The merged wall path removes the shared internal wall. Connections are **open-plan only**; no automatic separating partition, doorway or door generation is claimed. Manually drawn partitions can span these joins.

## Preserved footprint editor

Rectangle, L-shape, T-shape, U-shape, Cross and Irregular are genuine polygon outlines. The default rectangle is 12 × 8 m with 0.2 m walls: **96 m² exterior / 88.16 m² interior**. The default L removes a 4 × 3 m corner: **84 / 76.16 m²**. Presets replace the selected outline; Undo restores it, and assembly validation rejects invalid replacements.

Master coordinates use integer millimetres. Exact numeric metre inputs accept three decimal places and ignore grid snapping. Polygon length/width are validated outer extents; changing them scales that local axis with explicit millimetre rounding. Areas always use actual boundary polygons. Irregular starts with an eight-vertex stepped ring; insertion/removal/freehand drawing are not included, but imported sections can contain 4–64 vertices.

Vertex edits adjust their two neighbours to keep orthogonal edges. Edge drags move perpendicular to themselves; exact edge length fixes its start and shifts its end/following perpendicular edge. Selection highlights vertices/edges. An adjoining section's actual interior wins over transparent handle hit regions; boundary ambiguity retains the selected section, and the section list/dropdown is always available. Handles are at least 44 CSS pixels.

Independent display-grid and snap toggles; **0.25 / 0.5 / 1 / 2 m** presets and **Free**. Vertex/edge snapping uses local section axes; section movement uses shared assembly axes. Free retains 1 mm precision. Display grid thins at distant zoom and reports its visible spacing. Grid changes never change geometry.

In mobile portrait (up to 650 CSS pixels), the Studio scrolls as one document: swiping the Inspector moves the toolbar and canvas offscreen, and scrolling back reveals them. Inspector contents and the architectural section list expand to their full height, with no nested scroll areas. Collapse/expand is retained. The canvas has a stable `clamp(320px, 55svh, 520px)` editing height (420px fallback), so Safari's dynamic address bar does not resize it during scrolling. Safe-area padding is retained; there are no sticky workspace elements. Desktop and landscape retain their viewport workspace with a scrolling side Inspector.

Canvas-specific touch capture stays on the SVG; Inspector inputs use ordinary page scrolling. Pointer mapping reads the current canvas screen bounds on each event, including after document scrolling. Edit/Pan tools, anchored zoom, wheel/pinch and Fit are retained. Pointer previews commit once on release; cancellation or a second finger rolls back the preview before pinch starts. A remaining finger cannot accidentally resume editing. Undo history retains the last 100 transactions in the active session.

Keyboard: **V** Edit, **H** Pan, **⌘/Ctrl Z** Undo, **⌘/Ctrl Shift Z / Ctrl Y** Redo, **⌘/Ctrl S** Save. Focus canvas and use arrows to move the selected unlocked section by its snap step (0.1 m for Free/snap-off; Shift ×10). Enter commits exact inputs; Escape restores a numeric field or cancels/deselects a canvas gesture.

## Deterministic geometry and limits

`orthogonalUnion.ts` uses **coordinate compression and a vertical sweep**. Slabs are delimited by actual integer edge coordinates; they are exact cells, not a sampled raster. Occupied intervals form the union. Positive-area overlaps are detected, internal edges are removed, the exterior boundary is traced, and collinear segments are simplified. Multiple boundary loops or branching/touching contours are rejected, so holes/disconnections are never silently repaired. Results are deterministic across input order/winding.

Each section uses a simple orthogonal ring before rotation, with 4–64 vertices, alternating horizontal/vertical edges and at least 0.1 m per edge. Section/combined extents are limited to 0.5–500 m, source local vertices to ±500 m, and stored section/frame positions to ±10,000 m. The merged ring supports up to 768 vertices. Sections must share one ground-level Z value and common wall thickness. Z and floor counts remain metadata, not structural levels.

Shoelace area computes exact exterior area. Clear area and the continuous rendered external wall band use the **validated mitered inward offset of the merged boundary**, not sums of section interiors or bounding-box estimates. The offset must remain one positive connected ring, not reverse edges, cross boundaries or intrude within the wall clearance. Too-thick walls, tiny jogs, collapsing necks, split interiors, overlapping interiors, holes, corner-only contacts and detached sections are rejected. Common exterior walls must be at least 0.01 m. No invalid measurement is replaced by an estimated value.

## Schema v5 and migration

The existing `building-generator-bg01` IndexedDB database, database version 1, and `projects` object store are retained. `schemaVersion: 5` retains:

- `building.mainSectionId` and up to twelve `sections`.
- Section `name`, `type`, `locked`, with the original rectangle or polygon geometry fields.
- `building.frame`: `origin` (integer XY), `axis`, `rotation`, `mode`.
- Explicit connections: stable `id`, endpoint section IDs and edge indices, shared integer segment `start`/`end`, `mode: "open-plan"`.

Schema v4 introduced `building.interior: { partitions, rooms }`. Each partition has a stable ID, integer-mm endpoints `a`/`b` and integer-mm thickness. Room records have a stable ID, a derived geometric `regionKey` (or null for retained labels), name, type and notes. Geometric region keys contain coordinates, not identity references.

Schema v5 adds `building.openings`, each with `id`, `type`, a partition/exterior `host`, `offset` and `width`; hinged records also require `hinge` and `swing`. Passages omit hinge/swing. Runtime validation checks references, aperture geometry, clearances and unique IDs.

Pure read-time migration accepts schema **1, 2, 3, 4 and 5**. Versions 1–4 receive an empty opening collection. Populated BG-03A interiors retain every partition/room ID, coordinate and label. Versions 1–3 receive an empty interior plan without modifying their original geometry or metadata. Valid BG-01/BG-02A sections retain **all original IDs, names, architecture, geometry, position, rotation, wall/floor measurements and timestamps**. New section metadata defaults to Main building / Custom / unlocked. Legacy rectangles remain rectangles; polygons retain their original vertices and ordering. `frame.mode: "legacy"` preserves the single section's world transform and precision; its initial origin/axis mirror the section without rewriting geometry.

The first accepted attachment enters **assembly** mode. Positions then share integer assembly axes anchored at that preserved origin; section quarter turns are relative to the frame axis. The frame's additional `rotation` is applied only for rendering/world transforms, so attachments stay exact. An assembly retains its frame even after its last extension is removed; remaining sections cannot jump, including moved/locked sections. Earlier-phase single-section projects retain their original arbitrary orientation and world-placement controls until attachment.

Connections are derived from real shared section edges and persisted explicitly. Edits recompute segments and retain connection IDs for the same endpoint-edge pair. Imports require connection records to match the geometry exactly, rather than silently repairing stale relationships. Project duplication and conflicting-ID imports rekey **every section, connection, partition, room and opening identity** and remap section/partition host references, with independent geometry arrays. Exports use v5; v1/v2/v3/v4 imports remain supported, but older app versions cannot open v5 exports. Room geometric keys remain valid after identity rekeying.

Library reads never overwrite old records. A successfully validated legacy record is written as v5 on the next edit/save/exit. Invalid/unsupported records stay untouched and are reported; loading failures never create fallback projects. The legacy JSON schemas remain alongside `schemas/project-v5.schema.json`. Runtime validation adds connectivity, lock-transition, geometry and cross-field checks beyond structural JSON Schema.

## BG-03B implementation map

| Files                                                                                                                | Responsibility                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/openings.ts`, `src/openingBuilding.ts`                                                                          | Host geometry, gap validation, anchor preservation, locks, physical areas and swept-leaf warnings |
| `src/circulation.ts`                                                                                                 | Ground-floor room access graph and entrance reachability                                          |
| `src/DoorsInspector.tsx`, `src/OpeningsLayer.tsx`                                                                    | Preview/confirm, exact controls, hinge/swing actions, masks, leaves/arcs and access summaries     |
| `src/Editor.tsx`, `src/Studio.tsx`, `src/InteriorLayer.tsx`, `src/InteriorInspector.tsx`, `src/styles.css`           | Touch selection/dragging, existing camera gestures, room status and portrait scrolling            |
| `src/model.ts`, `src/assembly.ts`, `src/interiorBuilding.ts`                                                         | Schema v5, identity remapping, lossless migrations and structural edit validation                 |
| `schemas/project-v5.schema.json`, `tests/fixtures/bg01-project-v5.json`                                              | Versioned schema and migration expectation; older schemas/fixtures remain intact                  |
| `src/openings.test.ts`, `src/storage.test.ts`, `src/assembly.test.ts`, `src/polygon.test.ts`, `src/interior.test.ts` | Door geometry/access/migration coverage and prior-phase schema expectations                       |
| `tests/openings.spec.ts`, `tests/footprints.spec.ts`, `tests/interiors.spec.ts`, `tests/sections.spec.ts`            | End-to-end doors, earlier regression workflows and version expectations                           |
| `src/App.tsx`, `package.json`, `package-lock.json`, `README.md`                                                      | BG-03B / 0.5.0 release and documentation                                                          |

Existing interior topology, camera transforms, history and IndexedDB modules are reused. No runtime dependency or repository was added.

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

Tests retain BG-01 through BG-03A workflows and cover physical wall gaps, exact opening/threshold areas, stable room identities, entrance/multi-hop reachability, passages, hinge/swing geometry, obstruction warnings, invalid hosts/overlaps/junctions, lock protection, host resizing/movement, undo/redo, v1–v5 import/export, independent host references, persistence and native multi-touch cancellation. Mobile scrolling and pointer-to-world regressions remain enabled.

BG-03B validation: **139 unit/storage tests passed**, **42 desktop/mobile Chromium production-browser tests passed**, and **6 desktop-inapplicable native touch tests skipped** (their mobile runs passed). TypeScript/Vite production build and formatting checks passed.

WebKit is not installed in this machine (the official browser CDN was blocked during BG-01 setup). Chromium mobile emulation/native Chromium touch dispatch does **not** verify physical iPhone Safari; run the playtest below on a device.

## Known limitations and data safety

- Strict edge-to-edge, **open-plan** joins only; all positive-area overlaps are rejected. Attachment aligns the candidate's first local edge; change the external segment, offset or shape to choose another placement. No generated partitioned joins or doors, holes in the exterior footprint, split exterior wall insets, slanted local edges, vertex insertion/removal or freehand drawing. Interior rooms are manually planned with orthogonal partitions.
- One main building cannot be removed. Section count max 12; combined dimensions max 500 m. No automatic movement of neighbours to “fix” an invalid edit. A duplicated section must be placed on a valid external edge before acceptance.
- Common walls/elevation must agree. A locked section blocks any operation that would modify its stored data. Whole-building rotation is an intentional frame operation and does not unlock/change section records. Undo/redo restores previously committed lock/geometry states.
- IndexedDB autosaves after 400 ms idle; Saving/Saved/Save Error, retry/export backup and flush-before-leave are retained. Wait for **Saved**. Private browsing, clearing site data, storage pressure, origin changes or OS termination can lose local/unsaved data. Export JSON backups. Persistent storage is requested but not guaranteed.
- Same-project multi-tab editing has no conflict resolution (last save wins). History/view/grid preferences are session-only. No service worker/offline installation.
- BG-03B remains ground-floor manual planning. Hinged doors are single leaves with a 90° swing. No windows, stairs, upper-floor editing, furniture, automatic layouts, roofs, 3D, procedural generation, game conversion or structural engineering. No BG-04 work is included.

## Short iPhone Safari playtest

1. At the same HTTPS origin, reopen legacy v1–v4 projects, including a named BG-03A room plan. Verify unchanged geometry, IDs/labels and empty openings; export backups.
2. Add a centred partition to the default building and name both regions. Place a 0.9 m interior door and an exterior entrance: preview, adjust, cancel/retry and confirm. Check real gaps, unchanged two 43.70 m² rooms, 0.09 m² threshold, 0.67 m² remaining partition and access to both rooms.
3. Select by tap/dropdown, drag/move/resize after page scrolling, edit exact width/position, Flip Hinge and Reverse Swing. Test passage openings, swing obstruction warnings, invalid overlaps/junctions/endpoints and locked sections. Invalid operations must leave saved walls/rooms/doors untouched.
4. Remove the connecting door: the far room should show No entrance path. Undo/Redo, add a passage, and confirm multi-room routes. Resize/move hosts and try invalid host removal/shortening; check preserved anchors or safe rejection. Translate/rotate the whole building, Fit and pan/pinch during a door drag or placement preview; camera gestures must never commit geometry.
5. In portrait, swipe through the Inspector so canvas/toolbar move offscreen and return. Collapse/expand, use numeric fields with the keyboard open, expand/retract Safari's address bar, and rotate landscape/back. Check safe areas, no nested Inspector scroll trap, no horizontal overflow and accurate taps after scrolling.
6. Wait for Saved, reopen Safari, export/import v5 and duplicate the project. Verify door dimensions, host references, hinge/swing, room labels/notes and independent IDs. Invalid JSON must preserve all saved data.
