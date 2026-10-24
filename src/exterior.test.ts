import { it, expect } from "vitest";
import {
  createProject,
  validateProject,
  duplicateProject,
  parseProject,
  serializeProject,
} from "./model";
import { buildExterior, roofHeight, ROOF_THICKNESS } from "./exteriorGeometry";
import {
  exteriorDefaults,
  readExterior,
  ROOF_STYLES,
} from "./exteriorSettings";
import { applyPreset } from "./footprint";
import { SHAPES, polygonArea } from "./polygon";
import {
  combinedGeometry,
  prepareBuilding,
  replaceSection,
  translateBuilding,
  openingContext,
} from "./assembly";
import { defaultBuildingConfig, generateBuildings } from "./buildingGenerator";
import { changeOpenings } from "./openingBuilding";
import { changePartitions } from "./interiorBuilding";
import { newOpening } from "./openings";
import { initialHistory, commit, undo, redo } from "./history";
import v1 from "../tests/fixtures/bg01-project.json";
import v2 from "../tests/fixtures/bg02a-project.json";
import v3 from "../tests/fixtures/bg01-project-v3.json";
import v4 from "../tests/fixtures/bg01-project-v4.json";
import v5 from "../tests/fixtures/bg01-project-v5.json";
const count = (p: number[]) => p.length / 9;
it.each(ROOF_STYLES)(
  "makes real planar %s slopes, thickness, walls and timber on a rectangle",
  (style) => {
    const p = createProject(),
      s = p.building.sections[0];
    s.exterior.roofStyle = style;
    const m = buildExterior(p.building),
      g = combinedGeometry(p.building),
      part = m.sections[0].parts;
    expect(m.wallFootprintArea).toBe(
      polygonArea(g.vertices) - polygonArea(g.inner),
    );
    expect(count(part.roof)).toBeGreaterThan(10);
    expect(part.timber.length).toBeGreaterThan(0);
    expect(part.stone.length).toBeGreaterThan(0);
    expect(m.warnings).toHaveLength(0);
    expect(m.maxHeight).toBeGreaterThan(s.exterior.wallHeight + 1000);
    const z = part.roof.filter((_, i) => i % 3 === 2);
    expect(new Set(z).size).toBeGreaterThan(4);
    expect(ROOF_THICKNESS).toBe(120);
    expect(m.roofArea).toBe(
      (s.length + 2 * s.exterior.overhang) *
        (s.width + 2 * s.exterior.overhang),
    );
  },
);
it("has analytically correct gable, hip and shed ridge/high-edge heights", () => {
  const p = createProject(),
    s = p.building.sections[0];
  s.exterior.roofPitch = 45;
  s.exterior.wallHeight = 3600;
  expect(roofHeight(s, p.building, { x: 6000, y: 4000 })).toBeCloseTo(7600);
  expect(roofHeight(s, p.building, { x: 6000, y: 0 })).toBeCloseTo(3600);
  s.exterior.roofStyle = "Hip";
  expect(roofHeight(s, p.building, { x: 0, y: 4000 })).toBeCloseTo(3600);
  s.exterior.roofStyle = "Shed";
  expect(roofHeight(s, p.building, { x: 6000, y: 8000 })).toBeCloseTo(11600);
});
it.each(SHAPES)(
  "closes roofs on %s footprints without substituting bounding-box walls",
  (shape) => {
    const p = createProject();
    p.building.sections[0] = applyPreset(p.building.sections[0], shape);
    const m = buildExterior(p.building),
      g = combinedGeometry(p.building);
    expect(m.wallFootprintArea).toBe(
      polygonArea(g.vertices) - polygonArea(g.inner),
    );
    expect(m.sections[0].parts.roof.every(Number.isFinite)).toBe(true);
    if (shape !== "Rectangle")
      expect(m.warnings.join(" ")).toContain("Concave roof fallback");
  },
);
it("builds a generated Norse longhouse with three connected, differently scaled sections", () => {
  const p = generateBuildings({ ...defaultBuildingConfig(), extensions: 3 })
      .proposals[0].project,
    b = p.building;
  const m = buildExterior(b),
    g = combinedGeometry(b);
  expect(m.sections).toHaveLength(4);
  expect(m.warnings.join(" ")).toContain("Joined roof fallback");
  expect(m.wallFootprintArea).toBe(
    polygonArea(g.vertices) - polygonArea(g.inner),
  );
  expect(
    b.sections.find((s) => s.type === "Storage")!.exterior.wallHeight,
  ).toBeLessThan(b.sections[0].exterior.wallHeight);
  expect(b.sections.find((s) => s.type === "Porch")!.exterior.roofStyle).toBe(
    "Shed",
  );
  expect(
    m.sections.every((s) =>
      Object.values(s.parts).flat().every(Number.isFinite),
    ),
  ).toBe(true);
});
it("renders only exterior openings, cutting real wall volumes while retaining room topology", () => {
  const p = createProject();
  p.building = changePartitions(p.building, [
    {
      id: "partition",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  const old = structuredClone(p.building.interior);
  p.building = changeOpenings(p.building, [
    newOpening(
      "entry",
      { kind: "exterior", sectionId: p.building.mainSectionId, edge: 0 },
      3000,
    ),
    newOpening("inside", { kind: "partition", partitionId: "partition" }, 4000),
  ]);
  const m = buildExterior(p.building);
  expect(m.doorCount).toBe(1);
  expect(p.building.interior).toEqual(old);
  // No triangle from the wall/foundation surface occupies the aperture face below 2.1m.
  for (const key of ["wall", "stone", "timber"] as const) {
    const a = m.sections[0].parts[key];
    for (let i = 0; i < a.length; i += 9) {
      const center = {
        x: (a[i] + a[i + 3] + a[i + 6]) / 3,
        y: (a[i + 1] + a[i + 4] + a[i + 7]) / 3,
        z: (a[i + 2] + a[i + 5] + a[i + 8]) / 3,
      };
      expect(
        center.x > 2550.01 &&
          center.x < 3449.99 &&
          center.y > 0.01 &&
          center.y < 199.99 &&
          center.z < 2099.99,
      ).toBe(false);
    }
  }
  expect(openingContext(p.building).regions).toHaveLength(2);
});
it("keeps 2D data unchanged, preserves settings on geometry changes and undoes full architectural settings", () => {
  const p = createProject(),
    before = structuredClone(p),
    s = p.building.sections[0];
  buildExterior(p.building);
  expect(p).toEqual(before);
  const next = {
    ...p,
    building: replaceSection(p.building, {
      ...s,
      exterior: { ...s.exterior, roofStyle: "Hip" as const, wallHeight: 4500 },
    }),
  };
  const h = commit(initialHistory(p), next);
  expect(undo(h).present).toEqual(p);
  expect(redo(undo(h)).present).toEqual(next);
  const resized = replaceSection(next.building, {
    ...next.building.sections[0],
    length: 14000,
  });
  expect(resized.sections[0].exterior).toEqual(
    next.building.sections[0].exterior,
  );
  const rotated = { ...resized, frame: { ...resized.frame, rotation: 47 } };
  expect(buildExterior(rotated).sections).toEqual(
    buildExterior(resized).sections,
  );
  const moved = translateBuilding(resized, { x: 4000, y: -3000 });
  expect(buildExterior(moved).sections).toEqual(
    buildExterior(resized).sections,
  );
  const locked = prepareBuilding(
    {
      ...next.building,
      sections: next.building.sections.map((s) => ({ ...s, locked: true })),
    },
    next.building,
  );
  expect(() =>
    replaceSection(locked, {
      ...locked.sections[0],
      exterior: { ...s.exterior, wallHeight: 5000 },
    }),
  ).toThrow(/locked/);
});
it("material presets change cladding/framing geometry; defaults distinguish porches, storage and towers", () => {
  const p = createProject(),
    norse = buildExterior(p.building);
  p.building.sections[0].exterior.material = "Medieval";
  const medieval = buildExterior(p.building);
  expect(medieval.sections[0].parts.timber.length).toBeGreaterThan(
    norse.sections[0].parts.timber.length,
  );
  expect(exteriorDefaults("Norse", "Porch", false).wallHeight).toBe(2400);
  expect(
    exteriorDefaults("Norse", "Tower Footprint", false).wallHeight,
  ).toBeGreaterThan(3800);
  expect(() =>
    readExterior({ ...exteriorDefaults("Norse"), roofPitch: 0 }),
  ).toThrow(/Invalid exterior/);
  expect(() =>
    readExterior({ ...exteriorDefaults("Norse"), overhang: 1001 }),
  ).toThrow();
});
it.each([v1, v2, v3, v4, v5])(
  "losslessly migrates schema $schemaVersion with new defaults and preserves source bytes",
  (old) => {
    const before = JSON.stringify(old),
      p = validateProject(old);
    expect(p.schemaVersion).toBe(10);
    expect(p).toMatchObject({ ...old, schemaVersion: 10 });
    expect(JSON.stringify(old)).toBe(before);
    expect(
      p.building.sections.every((s) => s.exterior.material === p.architecture),
    ).toBe(true);
    expect(parseProject(serializeProject(p))).toEqual(p);
  },
);
it("schema v5 populated interiors/doors/locks migrate, v6 roundtrips and duplicates independently", () => {
  const p = createProject();
  p.building = changePartitions(p.building, [
    {
      id: "w",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  const key = openingContext(p.building).regions[0].key;
  p.building.interior.rooms = [
    {
      id: "room",
      regionKey: key,
      name: "Keep hall",
      type: "Main Hall",
      notes: "Keep notes",
    },
  ];
  p.building = changeOpenings(p.building, [
    newOpening(
      "entry",
      { kind: "exterior", sectionId: p.building.mainSectionId, edge: 0 },
      3000,
    ),
  ]);
  p.building.sections[0].locked = true;
  const old = { ...structuredClone(p), schemaVersion: 5 };
  for (const s of old.building.sections)
    delete (s as Partial<typeof s>).exterior;
  const migrated = validateProject(old);
  expect(migrated.building.interior).toEqual(p.building.interior);
  expect(migrated.building.openings).toEqual(p.building.openings);
  expect(migrated.building.sections[0].locked).toBe(true);
  const copy = duplicateProject(migrated);
  expect(copy.building.sections[0].id).not.toBe(
    migrated.building.sections[0].id,
  );
  expect(copy.building.sections[0].exterior).toEqual(
    migrated.building.sections[0].exterior,
  );
  copy.building.sections[0].exterior.wallHeight = 5000;
  expect(migrated.building.sections[0].exterior.wallHeight).toBe(3800);
  const invalid = structuredClone(migrated);
  delete (
    invalid.building.sections[0] as Partial<
      (typeof invalid.building.sections)[0]
    >
  ).exterior;
  expect(() => validateProject(invalid)).toThrow(/Invalid exterior/);
});
