import { it, expect } from "vitest";
import { createProject } from "./model";
import { applyPreset } from "./footprint";
import { generateBuildings, defaultBuildingConfig } from "./buildingGenerator";
import { buildExterior } from "./exteriorGeometry";
import { attachmentPreview } from "./attachments";
import { containsPoint } from "./interior";
import { roofHeight } from "./exteriorGeometry";
import { Vector3, Triangle } from "three";
import { readExterior } from "./exteriorSettings";
import {
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import { replaceSection } from "./assembly";
import { initialHistory, commit, undo, redo } from "./history";
import oldV7 from "../tests/fixtures/bg01-project-v7.json";

const fixtures = () => {
  const long = generateBuildings({ ...defaultBuildingConfig(), extensions: 3 })
    .proposals[0].project;
  return [
    long,
    ...(["L-shape", "T-shape"] as const).map((shape) => {
      const p = createProject();
      p.building.sections[0] = applyPreset(p.building.sections[0], shape);
      return p;
    }),
  ];
};
it("roof top facets cover every exact roof cell", () => {
  for (const p of fixtures())
    for (const mixed of [false, true]) {
      if (mixed)
        p.building.sections.forEach(
          (s, i) =>
            (s.exterior.roofStyle = (["Gable", "Hip", "Shed"] as const)[i % 3]),
        );
      const m = buildExterior(p.building);
      let area = 0;
      for (const s of m.sections) {
        const a = s.parts.roof;
        for (let i = 0; i < a.length; i += 9) {
          const z =
            (a[i + 3] - a[i]) * (a[i + 7] - a[i + 1]) -
            (a[i + 4] - a[i + 1]) * (a[i + 6] - a[i]);
          if (z > 0) area += z / 2;
        }
      }
      expect(area).toBeCloseTo(m.roofArea, 2);
    }
});

function perpendicular() {
  const p = createProject();
  const r = attachmentPreview(p.building, {
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
  p.building = r.building!;
  return p;
}
it("joins a perpendicular roof through its valley instead of inserting an attachment-line wall", () => {
  const p = perpendicular(),
    b = p.building,
    m = buildExterior(b);
  const q = { x: 6000, y: 500 };
  const facet = m.roofFacets.find((f) => containsPoint(f.polygon, q));
  expect(facet).toBeDefined();
  expect(
    facet!.plane.a * q.x + facet!.plane.b * q.y + facet!.plane.c,
  ).toBeCloseTo(roofHeight(b.sections[1], b, q));
  expect(
    m.roofTransitions.filter(
      (t) =>
        t.kind === "step" &&
        t.a.y === 0 &&
        t.b.y === 0 &&
        Math.min(t.a.x, t.b.x) < 6000 &&
        Math.max(t.a.x, t.b.x) > 6000,
    ),
  ).toHaveLength(0);
});

function hasFace(points: number[], p: Vector3) {
  const nearest = new Vector3();
  for (let i = 0; i < points.length; i += 9) {
    const t = new Triangle(
      new Vector3(points[i], points[i + 1], points[i + 2]),
      new Vector3(points[i + 3], points[i + 4], points[i + 5]),
      new Vector3(points[i + 6], points[i + 7], points[i + 8]),
    );
    t.closestPointToPoint(p, nearest);
    if (nearest.distanceTo(p) < 0.001) return true;
  }
  return false;
}
it("closes actual stepped profiles and fascia, without requiring a wall inside a continuous valley", () => {
  for (const a of ["Gable", "Hip", "Shed"] as const)
    for (const z of ["Gable", "Hip", "Shed"] as const)
      for (const equal of [true, false]) {
        const p = perpendicular(),
          b = p.building;
        b.sections[0].exterior.roofStyle = a;
        b.sections[1].exterior.roofStyle = z;
        b.sections[1].exterior.wallHeight = equal ? 3800 : 2800;
        b.sections.forEach((s) => (s.exterior.detailLevel = "Low"));
        const m = buildExterior(b),
          points = m.sections.flatMap((s) => [
            ...s.parts.wall,
            ...s.parts.roof,
          ]);
        for (const t of m.roofTransitions) {
          const x = (t.a.x + t.b.x) / 2,
            y = (t.a.y + t.b.y) / 2,
            low = (t.low[0] + t.low[1]) / 2,
            high = (t.high[0] + t.high[1]) / 2;
          const heights =
            t.kind === "fascia"
              ? [(low + high) / 2]
              : [
                  low - 120 + Math.min(120, high - low) / 2,
                  high - Math.min(120, high - low) / 2,
                  ...(high - low > 120 ? [(low + high - 120) / 2] : []),
                ];
          for (const height of heights)
            expect(hasFace(points, new Vector3(x, y, height))).toBe(true);
        }
      }
});

it("rotates gable and hip ridges independently while preserving pitch and eaves", () => {
  const p = createProject(),
    b = p.building,
    s = b.sections[0];
  s.exterior.roofPitch = 45;
  s.exterior.ridgeAxis = "X";
  expect(roofHeight(s, b, { x: 6000, y: 4000 })).toBeCloseTo(7800);
  s.exterior.ridgeAxis = "Y";
  expect(roofHeight(s, b, { x: 6000, y: 4000 })).toBeCloseTo(9800);
  s.exterior.roofStyle = "Hip";
  const h = roofHeight(s, b, { x: 6000, y: 4000 });
  expect(roofHeight(s, b, { x: 6000, y: 4500 })).toBeCloseTo(h);
  expect(roofHeight(s, b, { x: 6500, y: 4000 })).toBeLessThan(h);
  expect(s.exterior.roofPitch).toBe(45);
  expect(s.exterior.wallHeight).toBe(3800);
  const m = buildExterior(b);
  expect(
    buildExterior({ ...b, frame: { ...b.frame, rotation: 137 } }).sections,
  ).toEqual(m.sections);
});
it.each(["+X", "-X", "+Y", "-Y"] as const)(
  "shed high edge %s has the correct signed local slope",
  (direction) => {
    const p = createProject(),
      b = p.building,
      s = b.sections[0];
    s.exterior.roofStyle = "Shed";
    s.exterior.shedHighEdge = direction;
    const center = { x: 6000, y: 4000 },
      axis = direction.endsWith("X") ? "x" : "y",
      high = {
        ...center,
        [axis]: center[axis] + (direction.startsWith("+") ? 500 : -500),
      };
    expect(roofHeight(s, b, high)).toBeGreaterThan(roofHeight(s, b, center));
    const m = buildExterior(b);
    expect(m.sections[0].parts.roof.every(Number.isFinite)).toBe(true);
  },
);
it("direction migration, ornaments, locks, history, save JSON and duplication preserve the canonical plan", () => {
  const old = JSON.stringify(oldV7),
    migrated = validateProject(oldV7);
  expect(migrated).toMatchObject({ ...oldV7, schemaVersion: 8 });
  expect(JSON.stringify(oldV7)).toBe(old);
  expect(migrated.building.sections[0].exterior.ridgeAxis).toBe("Auto");
  const p = createProject(),
    s = p.building.sections[0];
  s.exterior.features = [
    {
      id: "ornament",
      kind: "Gable ornament",
      x: 0,
      y: 0,
      height: 700,
      doorId: null,
      finish: "Stone",
    },
  ];
  const next = replaceSection(p.building, {
      ...s,
      exterior: { ...s.exterior, ridgeAxis: "Y" },
    }),
    before = structuredClone(p.building);
  expect(next.sections[0].exterior.features).toEqual(s.exterior.features);
  expect(buildExterior(next).maxHeight).toBeGreaterThan(
    buildExterior(before).maxHeight,
  );
  const h = commit(initialHistory(before), next);
  expect(undo(h).present).toEqual(before);
  expect(redo(undo(h)).present).toEqual(next);
  p.building = next;
  expect(parseProject(serializeProject(p))).toEqual(p);
  expect(
    validateProject(duplicateProject(p)).building.sections[0].exterior
      .ridgeAxis,
  ).toBe("Y");
  next.sections[0].locked = true;
  expect(() =>
    replaceSection(next, {
      ...next.sections[0],
      exterior: { ...next.sections[0].exterior, ridgeAxis: "X" },
    }),
  ).toThrow(/locked/);
  expect(() => readExterior({ ...s.exterior, ridgeAxis: "Z" })).toThrow(
    /direction/,
  );
  const invalid = structuredClone(p);
  delete (invalid.building.sections[0].exterior as Partial<typeof s.exterior>)
    .ridgeAxis;
  expect(() => validateProject(invalid)).toThrow(/direction/);
});

it("winds perimeter fascia outward rather than depending on backface visibility", () => {
  const p = createProject();
  p.building.sections[0].exterior.detailLevel = "Low";
  const m = buildExterior(p.building),
    a = m.sections[0].parts.roof;
  for (let i = 0; i < a.length; i += 9) {
    const aa = new Vector3(a[i], a[i + 1], a[i + 2]),
      b = new Vector3(a[i + 3], a[i + 4], a[i + 5]),
      c = new Vector3(a[i + 6], a[i + 7], a[i + 8]),
      normal = new Triangle(aa, b, c).getNormal(new Vector3());
    if (Math.abs(normal.z) > 0.001 || normal.lengthSq() < 0.1) continue;
    const midpoint = aa.clone().add(b).add(c).divideScalar(3);
    expect(
      normal.x * (midpoint.x - 6000) + normal.y * (midpoint.y - 4000),
    ).toBeGreaterThan(0);
  }
});
it("revalidates existing window trim against steeper oriented hip end planes", () => {
  const p = createProject(),
    s = p.building.sections[0];
  s.exterior.roofStyle = "Hip";
  s.exterior.roofPitch = 65;
  s.exterior.windows = [
    {
      id: "window",
      edge: 0,
      offset: 3000,
      width: 900,
      height: 1000,
      sill: 2000,
      style: "Timber shuttered",
      shutters: true,
      glazing: false,
    },
  ];
  expect(() => validateProject(p)).not.toThrow();
  expect(() =>
    replaceSection(p.building, {
      ...s,
      exterior: { ...s.exterior, ridgeAxis: "Y" },
    }),
  ).toThrow(/roof underside/);
  expect(s.exterior.ridgeAxis).toBe("Auto");
  expect(s.exterior.windows[0].sill).toBe(2000);
});
