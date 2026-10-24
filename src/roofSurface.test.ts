import { it, expect } from "vitest";
import {
  roofCompositions,
  wingFixture,
} from "../tests/fixtures/roofCompositions";
import { buildExterior, roofHeight } from "./exteriorGeometry";
import { combinedGeometry, openingContext } from "./assembly";
import { containsPoint } from "./interior";
import {
  onRing,
  planeHeight,
  clipRoof,
  rectangleRoof,
  roofSurface,
  intersectionDomains,
} from "./roofSurface";
import { polygonArea } from "./polygon";
import {
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import type { Point } from "./geometry";
const onSegment = (p: Point, a: Point, b: Point) => onRing([a, b], p);
function roofAt(m: ReturnType<typeof buildExterior>, p: Point) {
  const f = m.roofFacets.filter(
    (f) => containsPoint(f.polygon, p) || onRing(f.polygon, p),
  );
  return Math.max(...f.map((f) => planeHeight(f.plane, p)));
}
it("solves a true upper-envelope valley, with one exposed surface at coincident pitch planes", () => {
  const d = rectangleRoof(0, 0, 100, 100),
    planes = [[{ a: 1, b: 0, c: 0 }], [{ a: -1, b: 0, c: 100 }]],
    surface = roofSurface(planes, [
      { polygon: d, owner: 0, kind: "section" },
      { polygon: d, owner: 1, kind: "intersection" },
    ]);
  const f = surface.facets(d, [0, 1]);
  expect(f.reduce((n, f) => n + polygonArea(f.polygon), 0)).toBeCloseTo(10000);
  expect(f).toHaveLength(2);
  const same = roofSurface(
    [planes[0], planes[0]],
    [
      { polygon: d, owner: 0, kind: "section" },
      { polygon: d, owner: 1, kind: "intersection" },
    ],
  ).facets(d, [0, 1]);
  expect(same).toHaveLength(1);
  expect(same[0].owner).toBe(0);
  expect(clipRoof(d, { a: 1, b: 0, c: 0 })).toEqual([]);
});
it("matches analytic perpendicular roof intersection and removes the BG-04D.1 vertical fin", () => {
  const p = wingFixture(),
    b = p.building,
    m = buildExterior(b),
    q = { x: 6000, y: 500 };
  expect(roofAt(m, q)).toBeCloseTo(roofHeight(b.sections[1], b, q));
  expect(roofAt(m, q)).toBeGreaterThan(roofHeight(b.sections[0], b, q));
  expect(
    m.roofTransitions.some(
      (t) => t.kind === "step" && onSegment({ x: 6000, y: 0 }, t.a, t.b),
    ),
  ).toBe(false);
});
it("keeps roof domains unchanged by aperture-driven tessellation", () => {
  const p = wingFixture(),
    before = buildExterior(p.building);
  p.building.sections[0].exterior.windows = [
    {
      id: "window",
      edge: 1,
      offset: 3500,
      width: 900,
      height: 1000,
      sill: 1000,
      style: "Medieval glazed",
      shutters: false,
      glazing: true,
    },
  ];
  validateProject(p);
  const after = buildExterior(p.building);
  for (let x = 700; x < 11500; x += 857)
    for (let y = -5400; y < 7500; y += 617) {
      const p = { x, y },
        a = roofAt(before, p),
        b = roofAt(after, p);
      if (Number.isFinite(a)) expect(b).toBeCloseTo(a, 5);
    }
});
it.each(roofCompositions())(
  "resolved roof matrix: $name has exact faces, supported steps and no protruding wall",
  (source) => {
    for (let variant = 0; variant < 6; variant++) {
      const p = structuredClone(source),
        b = p.building;
      b.sections.forEach((s, i) => {
        s.exterior.detailLevel = variant % 2 ? "High" : "Standard";
        s.exterior.ridgeAxis = variant % 2 ? "X" : "Y";
        s.exterior.roofPitch = [30, 42, 55][variant % 3];
        s.exterior.overhang = [0, 450, 800][variant % 3];
        if (variant >= 2)
          s.exterior.roofStyle = (["Gable", "Hip", "Shed"] as const)[
            (i + variant) % 3
          ];
        if (variant === 5) s.exterior.wallHeight = 3800;
      });
      const bytes = JSON.stringify(b),
        g = combinedGeometry(b),
        m = buildExterior(b);
      expect(JSON.stringify(b)).toBe(bytes);
      expect(
        m.roofFacets.reduce((n, f) => n + polygonArea(f.polygon), 0),
      ).toBeCloseTo(m.roofArea, 2);
      let topArea = 0,
        bottomArea = 0;
      for (const section of m.sections) {
        const a = section.parts.roof;
        for (let i = 0; i < a.length; i += 9) {
          const area =
            ((a[i + 3] - a[i]) * (a[i + 7] - a[i + 1]) -
              (a[i + 4] - a[i + 1]) * (a[i + 6] - a[i])) /
            2;
          if (area > 0) topArea += area;
          else bottomArea -= area;
        }
      }
      expect(topArea).toBeCloseTo(m.roofArea, 2);
      expect(bottomArea).toBeCloseTo(m.roofArea, 2);
      for (const f of m.roofFacets) {
        expect(polygonArea(f.polygon)).toBeGreaterThan(1e-5);
        const c = {
          x: f.polygon.reduce((n, p) => n + p.x, 0) / f.polygon.length,
          y: f.polygon.reduce((n, p) => n + p.y, 0) / f.polygon.length,
        };
        expect(planeHeight(f.plane, c)).toBeCloseTo(roofAt(m, c), 3);
      }
      for (const t of m.roofTransitions.filter((t) => t.kind === "step")) {
        const mid = { x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2 };
        expect(
          g.contacts.some((c) => onSegment(mid, c.start, c.end)),
          `${source.name}/${variant}: unsupported step ${JSON.stringify(mid)}`,
        ).toBe(true);
      }
      for (const section of m.sections)
        for (const [kind, points] of Object.entries(section.parts))
          for (let i = 0; i < points.length; i += 9) {
            const ux = points[i + 3] - points[i],
              uy = points[i + 4] - points[i + 1],
              uz = points[i + 5] - points[i + 2],
              vx = points[i + 6] - points[i],
              vy = points[i + 7] - points[i + 1],
              vz = points[i + 8] - points[i + 2];
            expect(
              Math.hypot(
                uy * vz - uz * vy,
                uz * vx - ux * vz,
                ux * vy - uy * vx,
              ),
            ).toBeGreaterThanOrEqual(1e-5);
            if (kind === "wall") {
              const c = {
                  x: (points[i] + points[i + 3] + points[i + 6]) / 3,
                  y: (points[i + 1] + points[i + 4] + points[i + 7]) / 3,
                },
                z = (points[i + 2] + points[i + 5] + points[i + 8]) / 3;
              expect(z).toBeLessThanOrEqual(roofAt(m, c) - 120 + 0.01);
            }
          }
      expect(parseProject(serializeProject(p))).toEqual(p);
      expect(
        validateProject(duplicateProject(p)).building.sections,
      ).toHaveLength(b.sections.length);
    }
  },
);
it("refuses artificial projected cutoffs that would leave a floating internal wall", () => {
  const rings = [
      rectangleRoof(0, -4000, 4000, 4000),
      rectangleRoof(0, 0, 4000, 8000),
    ],
    planes = [[{ a: 0, b: 0, c: 5000 }], [{ a: 0, b: 0, c: 3000 }]],
    outer = [
      { x: 0, y: -4000 },
      { x: 4000, y: -4000 },
      { x: 4000, y: 8000 },
      { x: 0, y: 8000 },
    ];
  const result = intersectionDomains(
    rings,
    planes,
    [true, true],
    [
      {
        a: { sectionId: "a" },
        b: { sectionId: "b" },
        start: { x: 0, y: 0 },
        end: { x: 4000, y: 0 },
      },
    ],
    ["a", "b"],
    outer,
  );
  expect(result.domains.some((d) => d.owner === 0)).toBe(false);
});
it("keeps chimneys and openings on the repaired surface without changing canonical records", () => {
  const p = wingFixture(),
    b = p.building,
    s = b.sections[0];
  s.exterior.features = [
    {
      id: "chimney",
      kind: "Chimney",
      x: 6000,
      y: 1200,
      height: 1000,
      doorId: null,
      finish: "Stone",
    },
  ];
  // This position is roof-local and survives a new valley; no interior flue is invented.
  validateProject(p);
  const before = JSON.stringify(b),
    m = buildExterior(b);
  expect(JSON.stringify(b)).toBe(before);
  expect(m.maxHeight).toBeGreaterThan(roofAt(m, { x: 6000, y: 1200 }));
  expect(openingContext(b).regions).toHaveLength(1);
});
it("anchors a steep-ridge chimney above every intersected roof point and keeps flashing parallel", () => {
  const p = wingFixture(),
    s = p.building.sections[0];
  s.exterior.roofPitch = 65;
  s.exterior.features = [
    {
      id: "chimney",
      kind: "Chimney",
      x: 6000,
      y: 4000,
      height: 500,
      doorId: null,
      finish: "Brick",
    },
  ];
  const bytes = JSON.stringify(p);
  validateProject(p);
  const m = buildExterior(p.building),
    brick = m.sections[0].parts.brick;
  expect(Math.max(...brick.filter((_, i) => i % 3 === 2))).toBeCloseTo(
    roofAt(m, { x: 6000, y: 4000 }) + 500,
    3,
  );
  expect(JSON.stringify(p)).toBe(bytes);
  for (const section of m.sections)
    expect(Object.values(section.parts).flat().every(Number.isFinite)).toBe(
      true,
    );
});
it("omits unsafe overhangs on steep narrow hips instead of projecting through the foundation", () => {
  const p = wingFixture();
  p.building.sections.forEach((s) => {
    s.exterior.roofStyle = "Hip";
    s.exterior.ridgeAxis = "Y";
    s.exterior.roofPitch = 65;
    s.exterior.overhang = 1000;
  });
  const m = buildExterior(p.building);
  expect(m.warnings.some((w) => w.startsWith("Overhang fallback"))).toBe(true);
  expect(
    m.roofFacets.every((f) =>
      f.polygon.every((p) => planeHeight(f.plane, p) >= 350),
    ),
  ).toBe(true);
});

it("has no overlapping exposed facets and preserves native material ownership on equal planes", () => {
  for (const p of roofCompositions()) {
    const m = buildExterior(p.building);
    for (let i = 0; i < m.roofFacets.length; i++)
      for (let j = i + 1; j < m.roofFacets.length; j++) {
        let intersection = m.roofFacets[i].polygon;
        const q = m.roofFacets[j].polygon;
        for (let k = 0; k < q.length && intersection.length; k++) {
          const a = q[k],
            b = q[(k + 1) % q.length];
          intersection = clipRoof(intersection, {
            a: b.y - a.y,
            b: a.x - b.x,
            c: (b.x - a.x) * a.y - (b.y - a.y) * a.x,
          });
        }
        if (intersection.length)
          expect(polygonArea(intersection)).toBeLessThan(0.01);
      }
  }
  const polygon = rectangleRoof(0, 0, 100, 100),
    planes = [[{ a: 1, b: 0, c: 0 }], [{ a: 1, b: 0, c: 0 }]],
    surface = roofSurface(planes, [
      { polygon, owner: 0, kind: "intersection" },
      { polygon, owner: 1, kind: "section" },
    ]);
  expect(
    surface
      .facets(polygon, surface.candidates({ x: 50, y: 50 }))
      .map((f) => f.owner),
  ).toEqual([1]);
});
