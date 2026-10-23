import { it, expect, describe } from "vitest";
import {
  createProject,
  validateProject,
  duplicateProject,
  parseProject,
  serializeProject,
} from "./model";
import {
  openingContext,
  replaceSection,
  translateBuilding,
  prepareBuilding,
} from "./assembly";
import { changePartitions } from "./interiorBuilding";
import { changeOpenings } from "./openingBuilding";
import {
  newOpening,
  openingGeometry,
  openingAreas,
  openingSwing,
  swingWarnings,
  validateOpenings,
} from "./openings";
import { circulation } from "./circulation";
import { initialHistory, commit, undo, redo } from "./history";
import { attachmentPreview, EXTENSION_TEMPLATES } from "./attachments";
import { applyPreset } from "./footprint";
import v1 from "../tests/fixtures/bg01-project.json";
import v2 from "../tests/fixtures/bg02a-project.json";
import v3 from "../tests/fixtures/bg01-project-v3.json";
import v4 from "../tests/fixtures/bg01-project-v4.json";
const divided = () =>
  changePartitions(createProject().building, [
    {
      id: "partition",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
const inside = () =>
  newOpening("door", { kind: "partition", partitionId: "partition" }, 3800);
const entrance = (b = divided()) =>
  newOpening(
    "entrance",
    { kind: "exterior", sectionId: b.sections[0].id, edge: 0 },
    3000,
  );
describe("physical openings and logical rooms", () => {
  it("adds an entrance and a 0.9 m door, preserving two named room identities", () => {
    const b = divided();
    b.interior.rooms[0].name = "Hall";
    b.interior.rooms[1].name = "Kitchen";
    const next = changeOpenings(b, [entrance(b), inside()]);
    expect(next.interior).toEqual(b.interior);
    expect(openingGeometry(openingContext(next), inside()).gap).toEqual({
      x: 5950,
      y: 3550,
      width: 100,
      height: 900,
    });
  });
  it("reconciles thresholds and remaining walls without changing exterior interior baseline", () => {
    const b = divided(),
      doors = [entrance(b), inside()],
      c = openingContext(b),
      areas = openingAreas(c, doors);
    expect(areas.thresholds).toBe(90000);
    expect(areas.physicalPartitions).toBe(670000);
    expect(areas.exteriorThresholds).toBe(180000);
    expect(areas.physicalExterior).toBe(7660000);
    expect(
      c.regions.reduce((n, r) => n + r.area, 0) +
        areas.thresholds +
        areas.physicalPartitions,
    ).toBe(88160000);
  });
  it("connects rooms only through real doors, including multi-hop access", () => {
    let b = divided();
    let c = openingContext(b);
    expect(circulation(c, []).reachable.size).toBe(0);
    expect(circulation(c, [entrance(b)]).reachable.size).toBe(1);
    expect(circulation(c, [entrance(b), inside()]).reachable.size).toBe(2);
    expect(circulation(c, [entrance(b)]).unreachable).toHaveLength(1);
    b = changePartitions(b, [
      ...b.interior.partitions,
      {
        id: "wall-two",
        a: { x: 9000, y: 200 },
        b: { x: 9000, y: 7800 },
        thickness: 100,
      },
    ]);
    c = openingContext(b);
    expect(
      circulation(c, [
        entrance(b),
        inside(),
        newOpening("two", { kind: "partition", partitionId: "wall-two" }, 3800),
      ]).reachable.size,
    ).toBe(3);
  });
  it("treats passage openings as traversable without leaf or swing", () => {
    const b = divided(),
      passage = newOpening(
        "passage",
        { kind: "partition", partitionId: "partition" },
        3800,
        true,
      );
    changeOpenings(b, [entrance(b), passage]);
    expect(passage.width).toBe(1200);
    expect(openingSwing(openingContext(b), passage)).toBeNull();
    expect(
      circulation(openingContext(b), [entrance(b), passage]).reachable.size,
    ).toBe(2);
  });
  it("flips hinge and swing geometrically with a 90-degree radius", () => {
    const b = divided(),
      c = openingContext(b),
      door = inside();
    if (door.type === "passage") throw Error();
    const a = openingSwing(c, door)!,
      flip = openingSwing(c, { ...door, hinge: "right" })!,
      reverse = openingSwing(c, { ...door, swing: -1 })!;
    expect(a.pivot.y).not.toBe(flip.pivot.y);
    expect(a.tip.x).toBeLessThan(6000);
    expect(reverse.tip.x).toBeGreaterThan(6000);
    expect(Math.hypot(a.tip.x - a.pivot.x, a.tip.y - a.pivot.y)).toBe(900);
  });
  it("warns about a wall-obstructed swept leaf but permits intentional placement", () => {
    const original = divided(),
      b = changePartitions(original, [
        ...original.interior.partitions,
        {
          id: "obstacle",
          a: { x: 5300, y: 200 },
          b: { x: 5300, y: 7800 },
          thickness: 100,
        },
      ]),
      d = inside();
    changeOpenings(b, [d]);
    expect(swingWarnings(openingContext(b), [d]).size).toBe(1);
    expect(swingWarnings(openingContext(divided()), [inside()]).size).toBe(0);
  });
  it.each([
    () => ({ ...inside(), width: 8000 }),
    () => ({ ...inside(), offset: 0 }),
    () => ({ ...inside(), width: 0 }),
    () => ({ ...inside(), offset: 1.5 }),
    () => ({
      ...inside(),
      host: { kind: "partition" as const, partitionId: "missing" },
    }),
  ])("rejects invalid opening geometry safely (%#)", (make) => {
    const b = divided(),
      before = structuredClone(b);
    expect(() => changeOpenings(b, [make()])).toThrow();
    expect(b).toEqual(before);
  });
  it("rejects adjacent overlapping doors and junction placements", () => {
    const b = divided();
    expect(() =>
      changeOpenings(b, [inside(), { ...inside(), id: "near", offset: 4000 }]),
    ).toThrow(/overlap/);
    const tee = changePartitions(b, [
      ...b.interior.partitions,
      {
        id: "tee",
        a: { x: 200, y: 4000 },
        b: { x: 6000, y: 4000 },
        thickness: 100,
      },
    ]);
    expect(() => changeOpenings(tee, [inside()])).toThrow(/junction/);
  });
  it("does not offer open-plan section joins as exterior door hosts", () => {
    const p = createProject(),
      t = EXTENSION_TEMPLATES[0],
      b = attachmentPreview(p.building, {
        ...t,
        id: "wing",
        shape: "Rectangle",
        edge: 0,
        offset: 0,
      }).building!;
    const join = b.connections[0];
    const ref = join.a;
    expect(() =>
      changeOpenings(b, [
        newOpening(
          "fake",
          { kind: "exterior", sectionId: ref.sectionId, edge: ref.edge },
          3000,
        ),
      ]),
    ).toThrow(/external|wall|segment|entrance/);
    expect(openingContext(b).regions).toHaveLength(1);
  });
  it("supports concave exterior entrances and continuous attached-wing interiors", () => {
    const p = createProject();
    p.building.sections[0] = applyPreset(p.building.sections[0], "L-shape");
    const c = openingContext(p.building),
      h = c.hosts.find((h) => h.ref.kind === "exterior")!;
    const d = newOpening("entry", h.ref, 2000);
    validateOpenings(c, [d]);
    expect(circulation(c, [d]).reachable.size).toBe(1);
  });
  it("keeps anchors during host movement and exact width edits without modifying walls", () => {
    const b = changeOpenings(divided(), [inside()]),
      next = changeOpenings(b, [{ ...inside(), offset: 4123, width: 987 }]);
    expect(next.interior).toEqual(b.interior);
    const moved = changePartitions(next, [
      {
        ...next.interior.partitions[0],
        a: { x: 7000, y: 200 },
        b: { x: 7000, y: 7800 },
      },
    ]);
    expect(moved.openings).toEqual(next.openings);
    expect(
      openingGeometry(openingContext(moved), moved.openings[0]).center.x,
    ).toBe(7000);
  });
  it("rejects shortening/deleting hosts or exterior edits that invalidate doors", () => {
    const base = divided(),
      b = changeOpenings(base, [inside(), entrance(base)]);
    expect(() => changePartitions(b, [])).toThrow(/host/);
    expect(() =>
      changePartitions(b, [
        { ...b.interior.partitions[0], b: { x: 6000, y: 4000 } },
      ]),
    ).toThrow(/segment/);
    expect(() =>
      replaceSection(b, { ...b.sections[0], length: 2000 }),
    ).toThrow();
  });
  it("protects openings touching locked sections", () => {
    const b = divided();
    b.sections[0].locked = true;
    expect(() => changeOpenings(b, [inside()])).toThrow(/locked/);
    const unlocked = divided(),
      placed = changeOpenings(unlocked, [inside()]);
    placed.sections[0].locked = true;
    expect(() => changeOpenings(placed, [])).toThrow(/locked/);
  });
  it("preserves local anchors and swings through whole-building movement/rotation", () => {
    const base = divided(),
      b = changeOpenings(base, [inside(), entrance(base)]),
      moved = translateBuilding(b, { x: 2537, y: -7461 }),
      rotated = prepareBuilding(
        { ...moved, frame: { ...moved.frame, rotation: 37.5 } },
        moved,
      );
    expect(rotated.openings).toEqual(b.openings);
    expect(openingGeometry(openingContext(rotated), inside())).toEqual(
      openingGeometry(openingContext(b), inside()),
    );
    expect(rotated.interior).toEqual(b.interior);
  });
  it("undoes and redoes independent placement/deletion transactions", () => {
    const b = divided(),
      p = { ...createProject(), building: b },
      added = { ...p, building: changeOpenings(b, [inside()]) };
    let h = commit(initialHistory(p), added);
    h = commit(h, { ...added, building: changeOpenings(added.building, []) });
    expect(undo(h).present).toEqual(added);
    expect(undo(undo(h)).present).toEqual(p);
    expect(redo(undo(h)).present.building.openings).toEqual([]);
  });
});
describe("v5 migrations and identities", () => {
  it.each([v1, v2, v3, v4])(
    "migrates schema $schemaVersion losslessly with empty openings",
    (source) => {
      const before = structuredClone(source),
        p = validateProject(source);
      expect(source).toEqual(before);
      expect(p.schemaVersion).toBe(7);
      expect(p.building.openings).toEqual([]);
      expect(p.building.sections).toMatchObject(source.building.sections);
      expect(p.id).toBe(source.id);
    },
  );
  it("roundtrips v5 and duplicates all door hosts and room IDs independently", () => {
    const p = createProject();
    const base = divided();
    p.building = changeOpenings(base, [inside(), entrance(base)]);
    expect(parseProject(serializeProject(p))).toEqual(p);
    const copy = duplicateProject(p);
    expect(validateProject(copy)).toEqual(copy);
    expect(
      copy.building.openings.every(
        (o) => !p.building.openings.some((v) => v.id === o.id),
      ),
    ).toBe(true);
    const d = copy.building.openings[0];
    expect(d.host.kind === "partition" && d.host.partitionId).toBe(
      copy.building.interior.partitions[0].id,
    );
    expect(
      copy.building.openings[1].host.kind === "exterior" &&
        copy.building.openings[1].host.sectionId,
    ).toBe(copy.building.sections[0].id);
  });
  it("rejects malformed, stale or duplicate imported door data", () => {
    const p = createProject();
    p.building = changeOpenings(divided(), [inside()]);
    const bad = structuredClone(p);
    bad.building.openings[0].id = bad.building.interior.rooms[0].id;
    expect(() => validateProject(bad)).toThrow(/distinct/);
    expect(() =>
      validateProject({
        ...p,
        building: {
          ...p.building,
          openings: [
            {
              ...inside(),
              host: { kind: "partition", partitionId: "missing" },
            },
          ],
        },
      }),
    ).toThrow(/host/);
  });
});

it("migrates a populated v4 interior without changing partition/room IDs or metadata", () => {
  const p = createProject("Preserved interior");
  p.building = divided();
  p.building.interior.rooms[0].name = "Named hall";
  p.building.interior.rooms[0].notes = "Keep these notes";
  const legacy = {
      ...p,
      schemaVersion: 4,
      building: { ...p.building, openings: undefined },
    },
    before = structuredClone(legacy),
    migrated = parseProject(JSON.stringify(legacy));
  expect(legacy).toEqual(before);
  expect(migrated.building.interior).toEqual(p.building.interior);
  expect(migrated.building.openings).toEqual([]);
  expect(migrated.building.sections).toEqual(p.building.sections);
});

it("resizing a wall start keeps its door centre fixed; reversing hosts is rejected", () => {
  const b = changeOpenings(divided(), [inside()]),
    old = openingGeometry(openingContext(b), b.openings[0]);
  const resized = changePartitions(b, [
    { ...b.interior.partitions[0], a: { x: 6000, y: 1000 } },
  ]);
  expect(
    openingGeometry(openingContext(resized), resized.openings[0]).center,
  ).toEqual(old.center);
  expect(resized.openings[0].offset).toBe(3000);
  expect(() =>
    changePartitions(b, [
      {
        ...b.interior.partitions[0],
        a: { x: 6000, y: 7800 },
        b: { x: 6000, y: 200 },
      },
    ]),
  ).toThrow(/direction/);
});
