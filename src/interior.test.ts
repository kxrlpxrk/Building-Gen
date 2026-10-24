import { describe, it, expect } from "vitest";
import {
  createProject,
  duplicateProject,
  parseProject,
  serializeProject,
  validateProject,
} from "./model";
import {
  combinedGeometry,
  prepareBuilding,
  replaceSection,
  translateBuilding,
} from "./assembly";
import {
  deriveInterior,
  emptyInterior,
  snapInteriorPoint,
  wallBox,
  type Partition,
} from "./interior";
import { changePartitions } from "./interiorBuilding";
import { applyPreset } from "./footprint";
import { attachmentPreview, EXTENSION_TEMPLATES } from "./attachments";
import { initialHistory, commit, undo, redo } from "./history";
import v1 from "../tests/fixtures/bg01-project.json";
import v2 from "../tests/fixtures/bg02a-project.json";
import v3 from "../tests/fixtures/bg01-project-v3.json";
const wall = (
  id = "partition-one",
  a = { x: 6000, y: 200 },
  b = { x: 6000, y: 7800 },
  thickness = 100,
): Partition => ({ id, a, b, thickness });
const geometry = (b = createProject().building) =>
  deriveInterior(combinedGeometry(b).inner, b.interior.partitions);
describe("exact ground-floor interiors", () => {
  it("reconciles the 88.16 / 87.4 / 0.76 m² acceptance case", () => {
    const b = changePartitions(createProject().building, [wall()]),
      g = geometry(b);
    expect(g.usableArea).toBe(88160000);
    expect(g.partitionArea).toBe(760000);
    expect(g.clearArea).toBe(87400000);
    expect(g.regions.map((r) => r.area)).toEqual([43700000, 43700000]);
    expect(g.clearArea + g.partitionArea).toBe(g.usableArea);
  });
  it("supports millimetre/odd-thickness measurements without rounding area", () => {
    const b = changePartitions(createProject().building, [
        wall("odd", { x: 6001, y: 200 }, { x: 6001, y: 7800 }, 101),
      ]),
      g = geometry(b);
    expect(g.partitionArea).toBe(767600);
    expect(g.regions.reduce((n, r) => n + r.area, 0) + g.partitionArea).toBe(
      88160000,
    );
    expect(wallBox(b.interior.partitions[0]).x).toBe(5950.5);
  });
  it("forms three regions at a clean T-junction and counts the joint once", () => {
    const b = changePartitions(createProject().building, [
        wall(),
        wall("tee", { x: 200, y: 4000 }, { x: 6000, y: 4000 }),
      ]),
      g = geometry(b);
    expect(g.regions).toHaveLength(3);
    expect(g.partitionArea).toBe(1335000);
    expect(g.clearArea + g.partitionArea).toBe(g.usableArea);
  });
  it("supports a clean L corner without inventing an enclosed room", () => {
    const b = changePartitions(createProject().building, [
      wall("a", { x: 3000, y: 3000 }, { x: 6000, y: 3000 }),
      wall("b", { x: 6000, y: 3000 }, { x: 6000, y: 6000 }),
    ]);
    expect(geometry(b).regions).toHaveLength(1);
  });
  it("does not invent rooms from an unfinished or floating partition", () => {
    const b = changePartitions(createProject().building, [
      wall("unfinished", { x: 6000, y: 200 }, { x: 6000, y: 4000 }),
    ]);
    expect(geometry(b).regions).toHaveLength(1);
    const floating = changePartitions(createProject().building, [
        wall("floating", { x: 6000, y: 3000 }, { x: 6000, y: 5000 }),
      ]),
      g = geometry(floating);
    expect(g.regions).toHaveLength(1);
    expect(g.regions[0].loops).toHaveLength(2);
    expect(g.clearArea + g.partitionArea).toBe(88160000);
  });
  it.each(
    (
      [
        [wall("zero", { x: 1000, y: 1000 }, { x: 1000, y: 1000 })],
        [wall("diagonal", { x: 1000, y: 1000 }, { x: 2000, y: 2000 })],
        [wall("outside", { x: 6000, y: 0 }, { x: 6000, y: 7800 })],
        [wall(), wall("cross", { x: 200, y: 4000 }, { x: 11800, y: 4000 })],
        [wall(), wall("overlap", { x: 6000, y: 1000 }, { x: 6000, y: 5000 })],
        [wall("sliver", { x: 300, y: 200 }, { x: 300, y: 7800 })],
        [wall("thick", { x: 6000, y: 200 }, { x: 6000, y: 7800 }, 1001)],
      ] as Partition[][]
    ).map((walls) => ({ walls })),
  )("rejects invalid partitions without mutating source (%#)", ({ walls }) => {
    const b = createProject().building,
      before = structuredClone(b);
    expect(() => changePartitions(b, walls)).toThrow();
    expect(b).toEqual(before);
  });
  it.each(["L-shape", "T-shape", "U-shape", "Cross", "Irregular"] as const)(
    "uses exact concave clear geometry for %s",
    (shape) => {
      const p = createProject();
      p.building.sections[0] = applyPreset(p.building.sections[0], shape);
      const g = geometry(p.building);
      expect(g.regions).toHaveLength(1);
      expect(g.usableArea).toBeCloseTo(
        combinedGeometry(p.building).interior * 1e6,
        5,
      );
    },
  );
  it("derives continuous rooms across an open-plan architectural join", () => {
    const p = createProject(),
      t = EXTENSION_TEMPLATES[0];
    let b = attachmentPreview(p.building, {
      ...t,
      id: "wing",
      shape: "Rectangle",
      edge: 0,
      offset: 0,
    }).building!;
    expect(geometry(b).regions).toHaveLength(1);
    b = changePartitions(b, [wall()]);
    const g = geometry(b);
    expect(g.clearArea + g.partitionArea).toBe(g.usableArea);
  });
  it("retains stable room IDs/names when a shared wall moves", () => {
    let b = changePartitions(createProject().building, [wall()]);
    b.interior.rooms[0].name = "Longhouse";
    b.interior.rooms[0].notes = "Hearth later";
    const old = structuredClone(b.interior.rooms),
      next = changePartitions(b, [
        wall("partition-one", { x: 7000, y: 200 }, { x: 7000, y: 7800 }),
      ]);
    expect(next.interior.rooms.map((r) => r.id)).toEqual(old.map((r) => r.id));
    expect(next.interior.rooms[0].name).toBe("Longhouse");
    expect(geometry(next).regions.map((r) => r.area)).toEqual([
      51300000, 36100000,
    ]);
  });
  it("archives all assignments on merge and split, making reassignment explicit", () => {
    let b = changePartitions(createProject().building, [wall()]);
    b.interior.rooms[0].name = "Hall";
    b.interior.rooms[1].name = "Storage";
    const merged = changePartitions(b, []);
    expect(
      merged.interior.rooms
        .filter((r) => r.regionKey === null)
        .map((r) => r.name),
    ).toEqual(["Hall", "Storage"]);
    const split = changePartitions(merged, [wall()]);
    expect(
      split.interior.rooms
        .filter((r) => r.regionKey === null)
        .map((r) => r.name),
    ).toEqual(["Hall", "Storage"]);
  });
  it("rejects exterior edits that invalidate interiors and preserves locks", () => {
    let b = changePartitions(createProject().building, [wall()]);
    expect(() => replaceSection(b, { ...b.sections[0], width: 7000 })).toThrow(
      /Interior plan/,
    );
    b = { ...b, sections: b.sections.map((s) => ({ ...s, locked: true })) };
    expect(() => changePartitions(b, [])).toThrow(/locked/);
    expect(() =>
      changePartitions(b, [
        wall("second", { x: 200, y: 4000 }, { x: 5000, y: 4000 }),
      ]),
    ).toThrow(/locked/);
  });
  it("whole-building movement/rotation preserves local partitions and rooms", () => {
    const b = changePartitions(createProject().building, [wall()]),
      s = b.sections[0],
      moved = replaceSection(b, {
        ...s,
        position: { x: 2537, y: -6181, z: 0 },
        orientation: 37.5,
      });
    expect(moved.interior).toEqual(b.interior);
    expect(geometry(moved).regions).toEqual(geometry(b).regions);
    const rotated = prepareBuilding(
      { ...moved, frame: { ...moved.frame, rotation: 123.75 } },
      moved,
    );
    expect(rotated.interior).toEqual(b.interior);
  });
  it("translates an assembled interior without changing local geometry or identities", () => {
    const p = createProject(),
      t = EXTENSION_TEMPLATES[0];
    let b = attachmentPreview(p.building, {
      ...t,
      id: "wing",
      shape: "Rectangle",
      edge: 0,
      offset: 0,
    }).building!;
    b = changePartitions(b, [wall()]);
    const moved = translateBuilding(b, { x: 1234, y: -5678 });
    expect(moved.interior).toEqual(b.interior);
    expect(geometry(moved)).toEqual(geometry(b));
    expect(moved.sections[0].position.x - b.sections[0].position.x).toBe(1234);
  });
  it("keeps valid narrow legacy projects loadable with an empty interior", () => {
    const source = structuredClone(v1);
    source.building.sections[0].length = 500;
    source.building.sections[0].width = 500;
    source.building.sections[0].wallThickness = 240;
    const p = validateProject(source);
    expect(geometry(p.building).usableArea).toBe(400);
  });
  it("undo/redo restores walls and metadata as editing transactions", () => {
    let p = createProject(),
      h = initialHistory(p);
    p = { ...p, building: changePartitions(p.building, [wall()]) };
    h = commit(h, p);
    const named = structuredClone(p);
    named.building.interior.rooms[0].name = "Hall";
    h = commit(h, named);
    expect(undo(h).present).toEqual(p);
    expect(redo(undo(h)).present).toEqual(named);
    expect(undo(undo(h)).present.building.interior.partitions).toEqual([]);
  });
  it("snaps independently to exact boundaries/endpoints/grid, and Free retains mm", () => {
    const inner = combinedGeometry(createProject().building).inner;
    expect(
      snapInteriorPoint({ x: 6011, y: 217 }, inner, [wall()], 500, 30),
    ).toEqual({ x: 6000, y: 200 });
    expect(
      snapInteriorPoint({ x: 1234.4, y: 3456.4 }, inner, [], null, 0),
    ).toEqual({ x: 1234, y: 3456 });
  });
});
describe("schema v4 and interior persistence", () => {
  it.each([v1, v2, v3])(
    "migrates v$schemaVersion losslessly with an empty interior",
    (source) => {
      const before = structuredClone(source),
        p = validateProject(source);
      expect(source).toEqual(before);
      expect(p.schemaVersion).toBe(10);
      expect(p.building.interior).toEqual(emptyInterior());
      expect(p.building.sections).toMatchObject(source.building.sections);
      expect(p.name).toBe(source.name);
      expect(parseProject(JSON.stringify(source))).toEqual(p);
    },
  );
  it("roundtrips v4 with room labels, notes, identities and geometry", () => {
    const p = createProject();
    p.building = changePartitions(p.building, [wall()]);
    p.building.interior.rooms[0].name = "Main Hall";
    p.building.interior.rooms[0].notes = "Future central hearth";
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it("duplicates independent interior identities and revalidates room references", () => {
    const p = createProject();
    p.building = changePartitions(p.building, [wall()]);
    const copy = duplicateProject(p);
    expect(copy.building.interior.partitions[0].id).not.toBe(
      p.building.interior.partitions[0].id,
    );
    expect(copy.building.interior.rooms[0].id).not.toBe(
      p.building.interior.rooms[0].id,
    );
    expect(validateProject(copy)).toEqual(copy);
    copy.building.interior.partitions[0].a.x++;
    expect(p.building.interior.partitions[0].a.x).toBe(6000);
  });
  it("rejects stale room references, duplicate IDs and invalid imported geometry", () => {
    const p = createProject();
    p.building = changePartitions(p.building, [wall()]);
    const invalid = structuredClone(p);
    invalid.building.interior.rooms[0].regionKey = "stale";
    expect(() => validateProject(invalid)).toThrow(/assignments/);
    invalid.building.interior = p.building.interior;
    invalid.building.interior.rooms[0].id =
      invalid.building.interior.partitions[0].id;
    expect(() => validateProject(invalid)).toThrow(/distinct/);
  });
});
