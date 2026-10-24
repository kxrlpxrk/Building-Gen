import { it, expect } from "vitest";
import { createProject } from "./model";
import {
  placeWindow,
  positionWindow,
  defaultWindow,
  type WindowAnchor,
} from "./windowPlacement";
import { initialHistory, commit, undo, redo } from "./history";
import { changeOpenings } from "./openingBuilding";
import { newOpening } from "./openings";
import { validateProject, serializeProject, parseProject } from "./model";
import { changePartitions } from "./interiorBuilding";
import { openingContext } from "./assembly";
import { attachmentPreview } from "./attachments";

it("snaps visual positioning in integer mm, preserves grab offsets, and keeps Free exact", () => {
  const window = defaultWindow(),
    hit = { sectionId: "section", edge: 1, offset: 3617, z: 1842 };
  expect(positionWindow(hit, window, 500).window).toMatchObject({
    edge: 1,
    offset: 3500,
    sill: 1500,
  });
  expect(
    positionWindow(hit, window, null, { offset: 17, z: 342 }).window,
  ).toMatchObject({ offset: 3600, sill: 1500 });
});
it("places, moves across exposed hosts, rejects invalid/locked edits and undoes one complete transaction", () => {
  const p = createProject(),
    b = p.building,
    s = b.sections[0],
    before = JSON.stringify(b),
    anchor: WindowAnchor = {
      sectionId: s.id,
      window: { ...defaultWindow(), offset: 3000 },
    };
  const added = placeWindow(b, anchor, null);
  expect(JSON.stringify(b)).toBe(before);
  expect(added.interior).toEqual(b.interior);
  expect(added.openings).toEqual(b.openings);
  const target = {
      ...anchor,
      window: { ...anchor.window, edge: 1, offset: 4000, sill: 1500 },
    },
    moved = placeWindow(added, target, anchor);
  expect(moved.sections[0].exterior.windows).toEqual([target.window]);
  expect(added.sections[0].exterior.windows).toEqual([anchor.window]);
  const h = commit(initialHistory(added), moved);
  expect(undo(h).present).toEqual(added);
  expect(redo(undo(h)).present).toEqual(moved);
  expect(() =>
    placeWindow(
      added,
      { ...target, window: { ...target.window, offset: 100 } },
      anchor,
    ),
  ).toThrow();
  added.sections[0].locked = true;
  expect(() => placeWindow(added, target, anchor)).toThrow(/locked/);
});
it("visual placement cannot bypass doors and unsupported source hosts", () => {
  const p = createProject(),
    s = p.building.sections[0];
  p.building = changeOpenings(p.building, [
    newOpening("door", { kind: "exterior", sectionId: s.id, edge: 0 }, 3000),
  ]);
  const anchor = {
    sectionId: s.id,
    window: { ...defaultWindow(), offset: 3000 },
  };
  expect(() => placeWindow(p.building, anchor, null)).toThrow(/overlap/);
  expect(() =>
    placeWindow(
      p.building,
      { ...anchor, window: { ...anchor.window, edge: 99 } },
      null,
    ),
  ).toThrow();
  expect(p.building.sections[0].exterior.windows).toEqual([]);
});
it("migrates populated v7 plans, windows and roof features without changing any existing data", () => {
  const p = createProject(),
    s = p.building.sections[0];
  p.building = changePartitions(p.building, [
    {
      id: "partition",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  p.building = changeOpenings(p.building, [
    newOpening("entry", { kind: "exterior", sectionId: s.id, edge: 0 }, 9000),
    newOpening("inside", { kind: "partition", partitionId: "partition" }, 4000),
  ]);
  p.building.interior.rooms = openingContext(p.building).regions.map(
    (r, i) => ({
      id: `room${i}`,
      regionKey: r.key,
      name: `Keep ${i}`,
      type: "Bedroom",
      notes: "Keep notes",
    }),
  );
  const section = p.building.sections[0];
  section.exterior.windows = [{ ...defaultWindow(), offset: 3000 }];
  section.exterior.features = [
    {
      id: "chimney",
      kind: "Chimney",
      x: 4000,
      y: 3000,
      height: 1000,
      doorId: null,
      finish: "Brick",
    },
  ];
  section.locked = true;
  const old = { ...structuredClone(p), schemaVersion: 7 };
  for (const s of old.building.sections) {
    delete (s.exterior as Partial<typeof s.exterior>).ridgeAxis;
    delete (s.exterior as Partial<typeof s.exterior>).shedHighEdge;
  }
  const bytes = JSON.stringify(old),
    next = validateProject(old);
  expect(next).toMatchObject({ ...old, schemaVersion: 9 });
  expect(JSON.stringify(old)).toBe(bytes);
  expect(parseProject(serializeProject(next))).toEqual(next);
  const invalid = structuredClone(old);
  invalid.building.sections[0].exterior.ridgeAxis = "Y";
  expect(() => validateProject(invalid)).toThrow(/require schemaVersion 8/);
});

it("moves a window between section identities atomically and protects locked destination content", () => {
  const p = createProject(),
    s = p.building.sections[0],
    r = attachmentPreview(p.building, {
      id: "wing",
      name: "Wing",
      type: "Residential Wing",
      length: 4000,
      width: 6000,
      shape: "Rectangle",
      edge: 0,
      offset: 4000,
    });
  expect(r.error).toBeNull();
  const from = {
      sectionId: s.id,
      window: { ...defaultWindow(), offset: 2000 },
    },
    b = placeWindow(r.building!, from, null),
    to = {
      sectionId: "wing",
      window: { ...from.window, edge: 1, offset: 3000 },
    };
  const moved = placeWindow(b, to, from);
  expect(moved.sections[0].exterior.windows).toEqual([]);
  expect(moved.sections[1].exterior.windows).toEqual([to.window]);
  expect(b.sections[0].exterior.windows).toEqual([from.window]);
  b.sections[1].locked = true;
  expect(() => placeWindow(b, to, from)).toThrow(/locked/);
});
