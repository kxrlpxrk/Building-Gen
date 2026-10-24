import { appendOrnaments } from "./ornamentGeometry";
import { roofPlanes, roofHeight } from "./roofFields";
import { crossRoofFields } from "./roofFeatures";
import {
  roofSurface,
  intersectionDomains,
  clipRoof,
  profileBreaks,
  cleanPolygon,
  onRing,
  type RoofDomain,
  type RoofFacet,
} from "./roofSurface";
import { featurePoint, windowOpening } from "./exteriorValidation";
import { ridgeAlongX, type ExteriorSettings } from "./exteriorSettings";
import type { Building, Section } from "./model";
import {
  canonicalVertices,
  combinedGeometry,
  openingContext,
} from "./assembly";
import { footprintVertices, rotate, type Point } from "./geometry";
import { bounds, edgeLength, signedArea, validatePolygon } from "./polygon";
import { containsPoint } from "./interior";
import { openingGeometry, openingSwing } from "./openings";
export type V3 = { x: number; y: number; z: number };
export type Surface =
  | "wall"
  | "roof"
  | "stone"
  | "timber"
  | "door"
  | "detail"
  | "glass"
  | "brick"
  | "roofDetail"
  | "ornamentWood"
  | "ornamentDark"
  | "ornamentOchre"
  | "ornamentPale";
export type SectionExterior = {
  id: string;
  material: Section["exterior"]["material"];
  stylePreset: ExteriorSettings["stylePreset"];
  covering: ExteriorSettings["covering"];
  detailLevel: ExteriorSettings["detailLevel"];
  parts: Record<Surface, number[]>;
};
export type ExteriorModel = {
  sections: SectionExterior[];
  warnings: string[];
  maxHeight: number;
  bounds: ReturnType<typeof bounds>;
  wallFootprintArea: number;
  doorCount: number;
  roofArea: number;
  cellCount: number;
  roofFacets: RoofFacet[];
  roofTransitions: {
    a: Point;
    b: Point;
    high: [number, number];
    low: [number, number];
    kind: "step" | "fascia";
  }[];
};
export const ROOF_THICKNESS = 120;
export const EXTERIOR_CELL_LIMIT = 40000;
type Cell = {
  x: number;
  y: number;
  w: number;
  h: number;
  owner: number;
  candidates: number[];
  facets: RoofFacet[];
};
const EPS = 1e-6;
function triangle(out: number[], a: V3, b: V3, c: V3) {
  const ux = b.x - a.x,
    uy = b.y - a.y,
    uz = b.z - a.z,
    vx = c.x - a.x,
    vy = c.y - a.y,
    vz = c.z - a.z;
  if (
    Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-5
  )
    return;
  out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}
function quad(out: number[], a: V3, b: V3, c: V3, d: V3) {
  triangle(out, a, b, c);
  triangle(out, a, c, d);
}
function prism(
  out: number[],
  poly: Point[],
  lo: number,
  top: (p: Point) => number,
  capTop = true,
) {
  const bottom = poly.map((p) => ({ ...p, z: lo })),
    upper = poly.map((p) => ({ ...p, z: top(p) }));
  for (let i = 1; i < poly.length - 1; i++) {
    if (capTop) triangle(out, upper[0], upper[i], upper[i + 1]);
    triangle(out, bottom[0], bottom[i + 1], bottom[i]);
  }
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    quad(out, bottom[i], bottom[j], upper[j], upper[i]);
  }
}
/** All pure geometry uses model X/Y horizontal, Z vertical, in mm. */
export function beam(out: number[], a: V3, b: V3, size: number) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    len = Math.hypot(dx, dy, dz);
  if (len < EPS) return;
  const horizontal = Math.hypot(dx, dy),
    u =
      horizontal > EPS
        ? {
            x: ((-dy / horizontal) * size) / 2,
            y: ((dx / horizontal) * size) / 2,
            z: 0,
          }
        : { x: size / 2, y: 0, z: 0 };
  const v = {
    x: (dy * u.z - dz * u.y) / len,
    y: (dz * u.x - dx * u.z) / len,
    z: (dx * u.y - dy * u.x) / len,
  };
  const corners = (p: V3) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([i, j]) => ({
      x: p.x + i * u.x + j * v.x,
      y: p.y + i * u.y + j * v.y,
      z: p.z + i * u.z + j * v.z,
    }));
  const aa = corners(a),
    bb = corners(b);
  quad(out, aa[3], aa[2], aa[1], aa[0]);
  quad(out, bb[0], bb[1], bb[2], bb[3]);
  for (let i = 0; i < 4; i++)
    quad(out, aa[i], aa[(i + 1) % 4], bb[(i + 1) % 4], bb[i]);
}
function ring(s: Section, b: Building) {
  return canonicalVertices(s, b);
}
export { roofPlanes, roofHeight } from "./roofFields";
const clip = clipRoof;
const rectangle = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
function distance(p: Point, v: Point[]) {
  return Math.min(
    ...v.map((a, i) => {
      const b = v[(i + 1) % v.length];
      return Math.hypot(
        p.x - Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), p.x)),
        p.y - Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), p.y)),
      );
    }),
  );
}
const height = (planes: { a: number; b: number; c: number }[], p: Point) =>
  Math.min(...planes.map((f) => f.a * p.x + f.b * p.y + f.c));
const edgeBreaks = profileBreaks;
export function buildExterior(b: Building): ExteriorModel {
  const g = combinedGeometry(b),
    rings = b.sections.map((s) => ring(s, b)),
    planes = b.sections.map((s) => roofPlanes(s, b)),
    data = b.sections.map((s) => ({
      id: s.id,
      material: s.exterior.material,
      stylePreset: s.exterior.stylePreset,
      covering: s.exterior.covering,
      detailLevel: s.exterior.detailLevel,
      parts: {
        wall: [],
        roof: [],
        stone: [],
        timber: [],
        door: [],
        detail: [],
        glass: [],
        brick: [],
        roofDetail: [],
        ornamentWood: [],
        ornamentDark: [],
        ornamentOchre: [],
        ornamentPale: [],
      } as Record<Surface, number[]>,
    }));
  const warnings: string[] = [];
  if (b.sections.some((s) => s.kind === "polygon"))
    warnings.push(
      "Concave roof fallback: section pitch planes are clipped to the actual outline. This is a simplified roof, not a calculated valley/hip intersection.",
    );
  const sign = Math.sign(signedArea(g.vertices)),
    segments: { a: Point; b: Point; owner: number; n: Point }[] = [];
  const owner = (p: Point) => {
    let index = rings.findIndex((v) => containsPoint(v, p));
    if (index < 0)
      index = rings.reduce(
        (best, v, i) => (distance(p, v) < distance(p, rings[best]) ? i : best),
        0,
      );
    return index;
  };
  // Split the authoritative merged boundary at actual source-section endpoints.
  g.vertices.forEach((a, i) => {
    const z = g.vertices[(i + 1) % g.vertices.length],
      vertical = a.x === z.x,
      axis = vertical ? "y" : "x",
      length = edgeLength(g.vertices, i),
      dx = (z.x - a.x) / length,
      dy = (z.y - a.y) / length;
    const cuts = [0, length];
    for (const v of rings.flat())
      if (vertical ? v.x === a.x : v.y === a.y) {
        const t = (v[axis] - a[axis]) * (vertical ? dy : dx);
        if (t > 0 && t < length) cuts.push(t);
      }
    const ts = [...new Set(cuts)].sort((a, b) => a - b);
    for (let j = 0; j < ts.length - 1; j++) {
      const p = { x: a.x + dx * ts[j], y: a.y + dy * ts[j] },
        q = { x: a.x + dx * ts[j + 1], y: a.y + dy * ts[j + 1] },
        n = { x: dy * sign, y: -dx * sign };
      segments.push({
        a: p,
        b: q,
        n,
        owner: owner({ x: (p.x + q.x) / 2 - n.x, y: (p.y + q.y) / 2 - n.y }),
      });
    }
  });
  // Variable perimeter overhangs have no overhang on open-plan joins. Validate
  // the offset; pathological notches get an explicit no-overhang fallback.
  const expanded = segments.map((seg, i) => {
    const prev = segments[(i + segments.length - 1) % segments.length],
      o = b.sections[seg.owner].exterior.overhang,
      po = b.sections[prev.owner].exterior.overhang;
    if (prev.n.x === seg.n.x && prev.n.y === seg.n.y)
      return {
        x: seg.a.x + seg.n.x * Math.min(o, po),
        y: seg.a.y + seg.n.y * Math.min(o, po),
      };
    return {
      x: seg.a.x + seg.n.x * o + prev.n.x * po,
      y: seg.a.y + seg.n.y * o + prev.n.y * po,
    };
  });
  // Collinear boundary ownership splits make an offset ring with collinear
  // steps; build a conservative uniform offset if widths differ at such splits.
  const varying = b.sections.some(
    (s) => s.exterior.overhang !== b.sections[0].exterior.overhang,
  );
  let roofRing = expanded;
  const invalid =
    validatePolygon(roofRing, 1, 2000, 2000000) ||
    Math.sign(signedArea(roofRing)) !== sign ||
    g.vertices.some((p, i) => {
      const q = g.vertices[(i + 1) % g.vertices.length];
      return [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }].some(
        (t) => !containsPoint(roofRing, t) && distance(t, roofRing) > EPS,
      );
    });
  if (
    invalid ||
    (varying &&
      segments.some((s, i) => {
        const p = segments[(i + segments.length - 1) % segments.length];
        return s.n.x === p.n.x && s.n.y === p.n.y && s.owner !== p.owner;
      }))
  ) {
    roofRing = g.vertices;
    if (b.sections.some((s) => s.exterior.overhang))
      warnings.push(
        "Overhang fallback: unequal adjacent eaves or a tight notch prevents a simple clean perimeter offset. Overhang is omitted for this assembly; stored settings are retained.",
      );
  }
  const nativeDomains: RoofDomain[] = rings.map((polygon, owner) => ({
    polygon,
    owner,
    kind: "section",
  }));
  if (roofRing !== g.vertices)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i],
        o = b.sections[seg.owner].exterior.overhang;
      for (const polygon of [
        [
          seg.a,
          seg.b,
          { x: seg.b.x + seg.n.x * o, y: seg.b.y + seg.n.y * o },
          { x: seg.a.x + seg.n.x * o, y: seg.a.y + seg.n.y * o },
        ],
        rectangle(
          Math.min(seg.a.x, expanded[i].x),
          Math.min(seg.a.y, expanded[i].y),
          Math.abs(seg.a.x - expanded[i].x),
          Math.abs(seg.a.y - expanded[i].y),
        ),
      ]) {
        const clean = cleanPolygon(polygon);
        if (clean.length)
          nativeDomains.push({
            polygon: clean,
            owner: seg.owner,
            kind: "eave",
          });
      }
    }
  const joins = intersectionDomains(
    rings,
    planes,
    b.sections.map((s) => s.kind === "rectangle"),
    g.contacts,
    b.sections.map((s) => s.id),
    g.vertices,
  );
  const roofParents = b.sections.map((_, i) => i);
  const crossDomains: RoofDomain[] = [];
  b.sections.forEach((s, parent) => {
    for (const field of crossRoofFields(s, b)) {
      const owner = planes.length;
      planes.push(field.planes);
      roofParents.push(parent);
      crossDomains.push({ polygon: field.domain, owner, kind: "intersection" });
    }
  });
  const domains = [...nativeDomains, ...joins.domains, ...crossDomains];
  let surface = roofSurface(planes, domains);
  if (b.sections.length > 1)
    warnings.push(
      joins.refused
        ? `Joined roof fallback: ${joins.domains.length} safe projected domains form exact pitched intersections; unsupported/raised or concave cutoffs retain closed stepped transitions. No universal valley solver is claimed.`
        : "Joined roof surfaces use clipped upper-envelope pitch intersections. Roof valleys are geometric, not structural engineering.",
    );
  const visibleHeight = (p: Point, fallback = 0) => {
    const h = surface.at(p);
    return Number.isFinite(h) ? h : fallback;
  };
  const context = openingContext(b),
    doors = b.openings
      .filter((o) => o.host.kind === "exterior")
      .map((o) => ({ opening: o, geometry: openingGeometry(context, o) }));
  const windows = b.sections.flatMap((s) =>
    s.exterior.windows.map((w) => ({
      window: w,
      section: s,
      geometry: openingGeometry(context, windowOpening(s, w)),
    })),
  );
  const apertures = [
    ...doors.map((d) => ({ ...d, low: 0, high: 2100 })),
    ...windows.map((d) => ({
      ...d,
      low: d.window.sill,
      high: d.window.sill + d.window.height,
    })),
  ];
  const points = [
    ...g.vertices,
    ...g.inner,
    ...roofRing,
    ...rings.flat(),
    ...domains.flatMap((d) => d.polygon),
    ...apertures.flatMap((d) =>
      rectangle(
        d.geometry.gap.x,
        d.geometry.gap.y,
        d.geometry.gap.width,
        d.geometry.gap.height,
      ),
    ),
  ];
  const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b),
    ys = [...new Set(points.map((p) => p.y))].sort((a, b) => a - b);
  if ((xs.length - 1) * (ys.length - 1) > EXTERIOR_CELL_LIMIT)
    throw new Error(
      `This footprint exceeds the mobile 3D limit of ${EXTERIOR_CELL_LIMIT.toLocaleString()} exact cells. Your 2D plan and saved data are unchanged.`,
    );
  const roofCells = new Map<string, Cell>();
  const roofFacets: RoofFacet[] = [];
  const roofTransitions: ExteriorModel["roofTransitions"] = [];
  function makeRoofCells() {
    roofCells.clear();
    roofFacets.length = 0;
    for (let ix = 0; ix < xs.length - 1; ix++)
      for (let iy = 0; iy < ys.length - 1; iy++) {
        const x = xs[ix],
          y = ys[iy],
          w = xs[ix + 1] - x,
          h = ys[iy + 1] - y,
          p = { x: x + w / 2, y: y + h / 2 };
        if (!containsPoint(roofRing, p)) continue;
        const candidates = surface.candidates(p);
        if (!candidates.length) throw new Error("Uncovered roof domain.");
        const facets = surface.facets(rectangle(x, y, w, h), candidates);
        roofCells.set(`${ix},${iy}`, {
          x,
          y,
          w,
          h,
          owner: owner(p),
          candidates,
          facets,
        });
        roofFacets.push(...facets);
        if (roofFacets.length > 40000)
          throw new Error("Roof intersection facet budget.");
      }
  }
  try {
    makeRoofCells();
  } catch {
    surface = roofSurface(planes, [...nativeDomains, ...crossDomains]);
    makeRoofCells();
    warnings.push(
      "Roof complexity fallback: projected intersections exceeded the mobile facet limit. Native roof domains use closed stepped transitions; project geometry is unchanged.",
    );
  }

  // Overhang material cannot support a tall clerestory outside the actual walls.
  // A discontinuous eave envelope uses the established no-overhang fallback.
  if (roofRing !== g.vertices) {
    let unsafe = roofFacets.some((f) =>
      f.polygon.some(
        (p) =>
          f.plane.a * p.x + f.plane.b * p.y + f.plane.c - ROOF_THICKNESS < 350,
      ),
    );
    for (const [key, c] of roofCells) {
      const [ix, iy] = key.split(",").map(Number);
      for (const n of [
        roofCells.get(`${ix + 1},${iy}`),
        roofCells.get(`${ix},${iy + 1}`),
      ]) {
        if (!n || unsafe) continue;
        const a = c.x + c.w === n.x ? { x: n.x, y: c.y } : { x: c.x, y: n.y },
          q =
            c.x + c.w === n.x
              ? { x: n.x, y: c.y + c.h }
              : { x: c.x + c.w, y: n.y };
        const mid = { x: (a.x + q.x) / 2, y: (a.y + q.y) / 2 };
        if (containsPoint(g.vertices, mid)) continue;
        for (const t of edgeBreaks(
          a,
          q,
          [...c.candidates, ...n.candidates].map((i) => planes[i]),
        )) {
          const p = { x: a.x + (q.x - a.x) * t, y: a.y + (q.y - a.y) * t };
          if (
            Math.abs(
              surface.height(c.candidates, p) - surface.height(n.candidates, p),
            ) > 0.001
          )
            unsafe = true;
        }
      }
    }
    if (unsafe) {
      roofRing = g.vertices;
      makeRoofCells();
      warnings.push(
        "Overhang fallback: the eaves would require unsupported infill outside the walls or intersect the foundation. Overhang is omitted; stored settings are retained.",
      );
    }
  }
  let roofDetailBudget = 0;
  let wallArea = 0,
    roofArea = 0,
    maxHeight = 0;
  for (let ix = 0; ix < xs.length - 1; ix++)
    for (let iy = 0; iy < ys.length - 1; iy++) {
      const x = xs[ix],
        y = ys[iy],
        w = xs[ix + 1] - x,
        h = ys[iy + 1] - y,
        p = { x: x + w / 2, y: y + h / 2 },
        inside = containsPoint(g.vertices, p),
        s = owner(p),
        out = data[s].parts;
      if (inside && !containsPoint(g.inner, p)) {
        wallArea += w * h;
        const gaps = apertures
          .filter(
            (d) =>
              p.x > d.geometry.gap.x - EPS &&
              p.x < d.geometry.gap.x + d.geometry.gap.width + EPS &&
              p.y > d.geometry.gap.y - EPS &&
              p.y < d.geometry.gap.y + d.geometry.gap.height + EPS,
          )
          .sort((a, b) => a.low - b.low);
        const ranges: { lo: number; hi: number }[] = [];
        let bottom = 0;
        for (const gap of [...gaps, { low: Infinity, high: Infinity }]) {
          if (gap.low > bottom) ranges.push({ lo: bottom, hi: gap.low });
          bottom = Math.max(bottom, gap.high);
        }
        for (const { polygon: face, plane: f } of roofCells.get(`${ix},${iy}`)!
          .facets) {
          // Wall/gable tops finish at the actual roof UNDERSIDE. The old prism
          // ended on the roof top, emitting a second coplanar triangle surface
          // through the shingles (the apparent cutouts / floating wall patches).
          const ceiling = { ...f, c: f.c - ROOF_THICKNESS };
          for (const range of ranges)
            for (const [lo, hi, target] of [
              [range.lo, Math.min(range.hi, 350), out.stone],
              [Math.max(range.lo, 350), range.hi, out.wall],
            ] as const) {
              if (hi <= lo) continue;
              const base = clip(face, {
                a: -ceiling.a,
                b: -ceiling.b,
                c: lo - ceiling.c,
              });
              if (!base.length) continue;
              if (Number.isFinite(hi)) {
                const below = clip(base, {
                    a: ceiling.a,
                    b: ceiling.b,
                    c: ceiling.c - hi,
                  }),
                  above = clip(base, {
                    a: -ceiling.a,
                    b: -ceiling.b,
                    c: hi - ceiling.c,
                  });
                if (below.length)
                  prism(
                    target,
                    below,
                    lo,
                    (p) => ceiling.a * p.x + ceiling.b * p.y + ceiling.c,
                    false,
                  );
                if (above.length) prism(target, above, lo, () => hi);
              } else
                prism(
                  target,
                  base,
                  lo,
                  (p) => ceiling.a * p.x + ceiling.b * p.y + ceiling.c,
                  false,
                );
            }
        }
      }
      if (!containsPoint(roofRing, p)) continue;
      roofArea += w * h;
      for (const { polygon: face, plane: f, owner: roofOwner } of roofCells.get(
        `${ix},${iy}`,
      )!.facets) {
        const out = data[roofParents[roofOwner]].parts,
          settings = b.sections[roofParents[roofOwner]].exterior;
        const upper = face.map((p) => ({
            ...p,
            z: f.a * p.x + f.b * p.y + f.c,
          })),
          lower = upper.map((p) => ({ ...p, z: p.z - ROOF_THICKNESS }));
        if (settings.detailLevel === "High") {
          const lo = Math.min(...upper.map((p) => p.z)),
            hi = Math.max(...upper.map((p) => p.z));
          for (
            let z = Math.ceil(lo / 260) * 260;
            z < hi && roofDetailBudget++ < 3000;
            z += 260
          ) {
            const hits: Point[] = [];
            for (let i = 0; i < face.length; i++) {
              const a = upper[i],
                d = upper[(i + 1) % upper.length];
              if ((a.z <= z && d.z > z) || (d.z <= z && a.z > z)) {
                const t = (z - a.z) / (d.z - a.z);
                hits.push({
                  x: a.x + (d.x - a.x) * t,
                  y: a.y + (d.y - a.y) * t,
                });
              }
            }
            if (hits.length === 2)
              beam(
                out.roofDetail,
                { ...hits[0], z: z + 14 },
                { ...hits[1], z: z + 14 },
                22,
              );
          }
        }
        // Ridge / hip caps lie on shared pitch-plane boundaries, clipped to the
        // actual section domain. Cell fragments meet without extra draw calls.
        if (settings.detailLevel !== "Low")
          for (let i = 0; i < face.length; i++) {
            const a = face[i],
              d = face[(i + 1) % face.length];
            if (
              planes[roofOwner].some(
                (other) =>
                  planes[roofOwner].indexOf(other) >
                    planes[roofOwner].indexOf(f) &&
                  Math.abs(
                    (other.a - f.a) * a.x +
                      (other.b - f.b) * a.y +
                      other.c -
                      f.c,
                  ) < EPS &&
                  Math.abs(
                    (other.a - f.a) * d.x +
                      (other.b - f.b) * d.y +
                      other.c -
                      f.c,
                  ) < EPS,
              )
            )
              beam(
                out.timber,
                { ...a, z: f.a * a.x + f.b * a.y + f.c + 35 },
                { ...d, z: f.a * d.x + f.b * d.y + f.c + 35 },
                90,
              );
          }
        for (const p of upper) maxHeight = Math.max(maxHeight, p.z);
        for (let i = 1; i < upper.length - 1; i++) {
          triangle(out.roof, upper[0], upper[i], upper[i + 1]);
          triangle(out.roof, lower[0], lower[i + 1], lower[i]);
        }
      }
    }
  // Close every perimeter and every unequal roof junction, never overlap planes.
  for (const [key, c] of roofCells) {
    const [ix, iy] = key.split(",").map(Number),
      edges = [
        {
          a: { x: c.x, y: c.y },
          z: { x: c.x + c.w, y: c.y },
          neighbour: roofCells.get(`${ix},${iy - 1}`),
        },
        {
          a: { x: c.x + c.w, y: c.y },
          z: { x: c.x + c.w, y: c.y + c.h },
          neighbour: roofCells.get(`${ix + 1},${iy}`),
        },
        {
          a: { x: c.x + c.w, y: c.y + c.h },
          z: { x: c.x, y: c.y + c.h },
          neighbour: roofCells.get(`${ix},${iy + 1}`),
        },
        {
          a: { x: c.x, y: c.y + c.h },
          z: { x: c.x, y: c.y },
          neighbour: roofCells.get(`${ix - 1},${iy}`),
        },
      ];
    for (const { a, z, neighbour: n } of edges) {
      if (n && (n.x < c.x || n.y < c.y)) continue;
      const sets = [...c.candidates, ...(n?.candidates ?? [])].map(
          (i) => planes[i],
        ),
        ts = edgeBreaks(a, z, sets, [0, ROOF_THICKNESS, -ROOF_THICKNESS]);
      const point = (t: number) => ({
        x: a.x + (z.x - a.x) * t,
        y: a.y + (z.y - a.y) * t,
      });
      for (let j = 0; j < ts.length - 1; j++) {
        const p = point(ts[j]),
          q = point(ts[j + 1]);
        const hp = surface.height(c.candidates, p),
          hq = surface.height(c.candidates, q),
          lp = n ? surface.height(n.candidates, p) : hp - ROOF_THICKNESS,
          lq = n ? surface.height(n.candidates, q) : hq - ROOF_THICKNESS;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const roofOwner =
          c.facets.find(
            (f) =>
              Math.abs(
                f.plane.a * mid.x +
                  f.plane.b * mid.y +
                  f.plane.c -
                  surface.height(c.candidates, mid),
              ) < 0.001,
          )?.owner ?? c.owner;
        if (n) {
          if (Math.max(Math.abs(hp - lp), Math.abs(hq - lq)) <= 0.001) continue;
          const highP = Math.max(hp, lp),
            highQ = Math.max(hq, lq),
            lowP = Math.min(hp, lp),
            lowQ = Math.min(hq, lq),
            highC = hp + hq >= lp + lq;
          const band = (
            out: number[],
            bottomP: number,
            bottomQ: number,
            topP: number,
            topQ: number,
          ) => {
            if (highC)
              quad(
                out,
                { ...p, z: bottomP },
                { ...q, z: bottomQ },
                { ...q, z: topQ },
                { ...p, z: topP },
              );
            else
              quad(
                out,
                { ...p, z: topP },
                { ...q, z: topQ },
                { ...q, z: bottomQ },
                { ...p, z: bottomP },
              );
          };
          const otherHeight = surface.height(n.candidates, mid),
            otherOwner =
              n.candidates.find(
                (i) => Math.abs(height(planes[i], mid) - otherHeight) < 0.001,
              ) ?? n.owner;
          const highOut =
              data[roofParents[highC ? roofOwner : otherOwner]].parts,
            lowOut = data[roofParents[highC ? otherOwner : roofOwner]].parts;
          if ((highP - lowP + highQ - lowQ) / 2 >= ROOF_THICKNESS) {
            band(
              lowOut.roof,
              lowP - ROOF_THICKNESS,
              lowQ - ROOF_THICKNESS,
              lowP,
              lowQ,
            );
            band(
              highOut.wall,
              lowP,
              lowQ,
              highP - ROOF_THICKNESS,
              highQ - ROOF_THICKNESS,
            );
            band(
              highOut.roof,
              highP - ROOF_THICKNESS,
              highQ - ROOF_THICKNESS,
              highP,
              highQ,
            );
          } else {
            band(
              lowOut.roof,
              lowP - ROOF_THICKNESS,
              lowQ - ROOF_THICKNESS,
              highP - ROOF_THICKNESS,
              highQ - ROOF_THICKNESS,
            );
            band(highOut.roof, lowP, lowQ, highP, highQ);
          }
          roofTransitions.push({
            a: p,
            b: q,
            high: [highP, highQ],
            low: [lowP, lowQ],
            kind: "step",
          });
        } else {
          quad(
            data[roofParents[roofOwner]].parts.roof,
            { ...p, z: lp },
            { ...q, z: lq },
            { ...q, z: hq },
            { ...p, z: hp },
          );
          roofTransitions.push({
            a: p,
            b: q,
            high: [hp, hq],
            low: [lp, lq],
            kind: "fascia",
          });
        }
        if (!n)
          beam(
            data[roofParents[roofOwner]].parts.timber,
            { ...p, z: hp - 65 },
            { ...q, z: hq - 65 },
            65,
          );
      }
    }
  }
  // Facade posts/beams/braces are decoration, never invented windows/doors.
  let detailCount = 0;
  for (const seg of segments) {
    const { a, z, n } = { a: seg.a, z: seg.b, n: seg.n },
      s = b.sections[seg.owner],
      parts = data[seg.owner].parts,
      ex = s.exterior,
      len = Math.hypot(z.x - a.x, z.y - a.y),
      dx = (z.x - a.x) / len,
      dy = (z.y - a.y) / len;
    const rich =
        ex.stylePreset === "Medieval Manor" ||
        ex.stylePreset === "Norse Chieftain's Hall",
      intervals = Math.min(
        32,
        Math.max(1, Math.ceil(len / (rich ? 1600 : 2200))),
      ),
      gapAt = (t: number) => {
        const p = { x: a.x + dx * t - n.x * 30, y: a.y + dy * t - n.y * 30 };
        return apertures.some(
          (d) =>
            p.x >= d.geometry.gap.x - 100 &&
            p.x <= d.geometry.gap.x + d.geometry.gap.width + 100 &&
            p.y >= d.geometry.gap.y - 100 &&
            p.y <= d.geometry.gap.y + d.geometry.gap.height + 100,
        );
      };
    const point = (t: number, h: number): V3 => ({
      x: a.x + dx * t + n.x * 25,
      y: a.y + dy * t + n.y * 25,
      z: h,
    });
    beam(
      parts.timber,
      point(0, ex.wallHeight - 180),
      point(len, ex.wallHeight - 180),
      130,
    );
    for (let i = 0; i <= intervals; i++)
      if (!gapAt((i * len) / intervals) && detailCount++ < 900) {
        const t = (i * len) / intervals,
          p = point(t, 0);
        beam(
          parts.timber,
          point(t, 350),
          point(
            t,
            Math.max(
              ex.wallHeight,
              visibleHeight(
                { x: p.x - n.x * 25, y: p.y - n.y * 25 },
                roofHeight(s, b, p),
              ),
            ) - 100,
          ),
          rich ? 180 : 140,
        );
      }
    if (ex.material !== "Norse")
      for (let i = 0; i < intervals && detailCount++ < 900; i++) {
        const lo = (i * len) / intervals,
          hi = ((i + 1) * len) / intervals;
        if (
          apertures.some((d) => {
            const p = d.geometry.lo,
              q = d.geometry.hi;
            const off = Math.abs((p.x - a.x) * n.x + (p.y - a.y) * n.y);
            const t1 = (p.x - a.x) * dx + (p.y - a.y) * dy,
              t2 = (q.x - a.x) * dx + (q.y - a.y) * dy;
            return (
              off <= s.wallThickness + 100 &&
              Math.max(t1, t2) + 100 > lo &&
              Math.min(t1, t2) - 100 < hi
            );
          })
        )
          continue;
        beam(
          parts.timber,
          point(lo + 100, 500),
          point(hi - 100, Math.min(2300, ex.wallHeight - 350)),
          90,
        );
      }
    // Plinth courses and facade boards follow each real exterior segment.
    const detail = ex.detailLevel !== "Low";
    const bands = rich ? [160, 310, 430] : [160, 330];
    for (const h of bands) {
      for (let i = 0; i < Math.ceil(len / 700); i++) {
        const lo = i * 700,
          hi = Math.min(len, (i + 1) * 700);
        if (
          !doors.some((d) => {
            const t =
              (d.geometry.center.x - a.x) * dx +
              (d.geometry.center.y - a.y) * dy;
            const off = Math.abs(
              (d.geometry.center.x - a.x) * n.x +
                (d.geometry.center.y - a.y) * n.y,
            );
            return (
              off < s.wallThickness + 100 &&
              t + d.opening.width / 2 > lo &&
              t - d.opening.width / 2 < hi
            );
          })
        )
          beam(
            parts.stone,
            point(lo + 12, h),
            point(hi - 12, h),
            rich ? 125 : 90,
          );
      }
    }
    if (detail && ex.stylePreset === "Mixed Architectural Fantasy") {
      // Low timber wainscot and upper plaster/framing combine the two traditions.
      for (let h = 620; h < 1300; h += 210)
        for (let i = 0; i < intervals; i++) {
          const lo = (i * len) / intervals,
            hi = ((i + 1) * len) / intervals;
          if (![lo, (lo + hi) / 2, hi].some(gapAt))
            beam(parts.detail, point(lo + 85, h), point(hi - 85, h), 55);
        }
    }
    if (detail && ex.material === "Norse") {
      if (ex.stylePreset === "Norse Chieftain's Hall") {
        for (let t = 180; t < len && detailCount++ < 2500; t += 220)
          if (!gapAt(t))
            beam(
              parts.detail,
              point(t, 500),
              point(t, ex.wallHeight - 300),
              35,
            );
      } else
        for (let h = 650; h < ex.wallHeight - 300; h += 240) {
          // Split boards around physical apertures, never board over a window.
          const cuts = [0, len];
          for (const d of apertures) {
            const off = Math.abs(
              (d.geometry.center.x - a.x) * n.x +
                (d.geometry.center.y - a.y) * n.y,
            );
            if (off < s.wallThickness + 100) {
              const t =
                (d.geometry.center.x - a.x) * dx +
                (d.geometry.center.y - a.y) * dy;
              cuts.push(
                Math.max(
                  0,
                  t -
                    (d.geometry.u.x
                      ? d.geometry.gap.width
                      : d.geometry.gap.height) /
                      2 -
                    100,
                ),
                Math.min(
                  len,
                  t +
                    (d.geometry.u.x
                      ? d.geometry.gap.width
                      : d.geometry.gap.height) /
                      2 +
                    100,
                ),
              );
            }
          }
          cuts.sort((a, b) => a - b);
          for (let i = 0; i < cuts.length - 1 && detailCount++ < 2500; i++) {
            const lo = cuts[i],
              hi = cuts[i + 1];
            if (hi - lo > 50 && !gapAt((lo + hi) / 2))
              beam(parts.detail, point(lo + 10, h), point(hi - 10, h), 28);
          }
        }
    }
    if (detail)
      for (let i = 0; i <= intervals && detailCount++ < 2500; i++) {
        const t = (i * len) / intervals,
          p = point(t, 0),
          q = {
            x: p.x + n.x * (roofRing === g.vertices ? 0 : ex.overhang),
            y: p.y + n.y * (roofRing === g.vertices ? 0 : ex.overhang),
          };
        beam(
          parts.detail,
          {
            ...p,
            z:
              visibleHeight(
                { x: p.x - n.x * 25, y: p.y - n.y * 25 },
                roofHeight(s, b, p),
              ) - 160,
          },
          { ...q, z: visibleHeight(q, roofHeight(s, b, q)) - 160 },
          rich ? 110 : 80,
        );
      }
    if (ex.material !== "Norse" && detail) {
      // A continuous mid-rail only in solid bays; richer manor has paired braces.
      for (let i = 0; i < intervals; i++) {
        const lo = (i * len) / intervals,
          hi = ((i + 1) * len) / intervals;
        if ([lo, (lo + hi) / 2, hi].some(gapAt)) continue;
        beam(
          parts.timber,
          point(lo, ex.wallHeight * 0.55),
          point(hi, ex.wallHeight * 0.55),
          100,
        );
        if (rich)
          beam(
            parts.detail,
            point(lo + 150, ex.wallHeight - 350),
            point(hi - 150, ex.wallHeight * 0.55 + 150),
            80,
          );
      }
    }
    // Gable sloping bar gives clear architectural silhouette on pronounced ends.
    const breaks = [
      ...new Set([
        ...edgeBreaks(a, z, planes),
        ...domains
          .flatMap((d) => d.polygon)
          .flatMap((p) => {
            const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
            return t > 0 &&
              t < 1 &&
              Math.abs((p.x - a.x) * n.x + (p.y - a.y) * n.y) < 0.001
              ? [t]
              : [];
          }),
      ]),
    ].sort((a, b) => a - b);
    for (let j = 0; j < breaks.length - 1; j++) {
      const p = point(breaks[j] * len, 0),
        q = point(breaks[j + 1] * len, 0),
        mid = { x: (p.x + q.x) / 2 - n.x * 25, y: (p.y + q.y) / 2 - n.y * 25 },
        owners = surface.candidates(mid),
        hp = surface.height(owners, { x: p.x - n.x * 25, y: p.y - n.y * 25 }),
        hq = surface.height(owners, { x: q.x - n.x * 25, y: q.y - n.y * 25 });
      if (Math.max(hp, hq) > ex.wallHeight + 100)
        beam(parts.timber, { ...p, z: hp - 100 }, { ...q, z: hq - 100 }, 110);
    }
  }
  for (const d of doors) {
    const opening = d.opening,
      host = opening.host;
    if (host.kind !== "exterior") continue;
    const index = b.sections.findIndex((s) => s.id === host.sectionId),
      out = data[index].parts;
    const swing = openingSwing(context, opening);
    if (swing) {
      const p = swing.pivot,
        axis = swing.openAxis;
      beam(
        out.door,
        { x: p.x, y: p.y, z: 1050 },
        {
          x: p.x + axis.x * opening.width,
          y: p.y + axis.y * opening.width,
          z: 1050,
        },
        70,
      ); // Crossbar on the open door leaf.
      const end = {
        x: p.x + axis.x * opening.width,
        y: p.y + axis.y * opening.width,
      };
      const side = { x: -axis.y * 30, y: axis.x * 30 };
      prism(
        out.door,
        [
          { x: p.x + side.x, y: p.y + side.y },
          { x: end.x + side.x, y: end.y + side.y },
          { x: end.x - side.x, y: end.y - side.y },
          { x: p.x - side.x, y: p.y - side.y },
        ],
        40,
        () => 2040,
      );
    }
  }
  // Window jambs/sills, recessed glazing and open timber shutters are separate
  // from door topology. Physical wall voids were cut before any facade decoration.
  for (const d of windows) {
    const { window: w, geometry: g } = d,
      out = data[b.sections.indexOf(d.section)].parts;
    const inward = g.host.inward!,
      outward = { x: -inward.x, y: -inward.y };
    const p = (t: number, z: number, depth = 60): V3 => ({
      x: g.host.a.x + g.u.x * (w.offset + t) + outward.x * depth,
      y: g.host.a.y + g.u.y * (w.offset + t) + outward.y * depth,
      z,
    });
    for (const t of [-w.width / 2, w.width / 2])
      beam(out.timber, p(t, w.sill - 40), p(t, w.sill + w.height + 40), 90);
    for (const z of [w.sill, w.sill + w.height])
      beam(out.timber, p(-w.width / 2 - 50, z), p(w.width / 2 + 50, z), 110);
    if (w.glazing) {
      quad(
        out.glass,
        p(-w.width / 2 + 45, w.sill + 45, -50),
        p(w.width / 2 - 45, w.sill + 45, -50),
        p(w.width / 2 - 45, w.sill + w.height - 45, -50),
        p(-w.width / 2 + 45, w.sill + w.height - 45, -50),
      );
      beam(out.timber, p(0, w.sill), p(0, w.sill + w.height), 45);
      if (w.style === "Medieval glazed")
        beam(
          out.timber,
          p(-w.width / 2, w.sill + w.height / 2),
          p(w.width / 2, w.sill + w.height / 2),
          45,
        );
    }
    if (w.shutters)
      for (const sign of [-1, 1]) {
        const a = sign * (w.width / 2 + 80),
          z = sign * (w.width + 60);
        quad(
          out.door,
          p(a, w.sill, 100),
          p(z, w.sill, 160),
          p(z, w.sill + w.height, 160),
          p(a, w.sill + w.height, 100),
        );
        for (const h of [w.sill + 130, w.sill + w.height - 130])
          beam(out.timber, p(a, h, 125), p(z, h, 185), 55);
      }
  }
  for (const d of doors) {
    const g = d.geometry,
      out =
        data[
          b.sections.findIndex(
            (s) =>
              d.opening.host.kind === "exterior" &&
              s.id === d.opening.host.sectionId,
          )
        ].parts;
    for (const sign of [-1, 1]) {
      const p = {
        x: g.center.x + g.u.x * sign * (d.opening.width / 2 + 65),
        y: g.center.y + g.u.y * sign * (d.opening.width / 2 + 65),
      };
      beam(out.timber, { ...p, z: 50 }, { ...p, z: 2150 }, 110);
    }
    beam(out.timber, { ...g.lo, z: 2190 }, { ...g.hi, z: 2190 }, 160);
  }
  for (let i = 0; i < b.sections.length; i++) {
    const s = b.sections[i],
      out = data[i].parts;
    for (const f of s.exterior.features) {
      if (f.kind === "Chimney") {
        const p = featurePoint(b, s, f),
          poly = rectangle(p.x - 300, p.y - 300, 600, 600),
          flashing = rectangle(p.x - 390, p.y - 390, 780, 780),
          flashFacets = surface.over(flashing),
          zs = flashFacets.flatMap((f) =>
            f.polygon.map((p) => f.plane.a * p.x + f.plane.b * p.y + f.plane.c),
          ),
          top = Math.max(...zs) + f.height;
        // Anchor to the resolved roof, including ridges inside the flashing.
        // A thin parallel skin replaces the old flat-bottom wedge, which could
        // invert on steep pitches and bury the chimney cap beneath the roof.
        prism(
          f.finish === "Brick" ? out.brick : out.stone,
          poly,
          Math.min(...zs) - 180,
          () => top,
        );
        for (const facet of flashFacets) {
          const upper = facet.polygon.map((p) => ({
              ...p,
              z: facet.plane.a * p.x + facet.plane.b * p.y + facet.plane.c + 30,
            })),
            lower = upper.map((p) => ({ ...p, z: p.z - 4 }));
          for (let j = 1; j < upper.length - 1; j++) {
            triangle(out.roof, upper[0], upper[j], upper[j + 1]);
            triangle(out.roof, lower[0], lower[j + 1], lower[j]);
          }
          for (let j = 0; j < upper.length; j++) {
            const k = (j + 1) % upper.length,
              mid = {
                x: (upper[j].x + upper[k].x) / 2,
                y: (upper[j].y + upper[k].y) / 2,
              };
            if (onRing(flashing, mid))
              quad(out.roof, lower[j], lower[k], upper[k], upper[j]);
          }
        }
        prism(
          out.stone,
          rectangle(p.x - 360, p.y - 360, 720, 720),
          top - 140,
          () => top,
        );
        prism(
          out.timber,
          rectangle(p.x - 190, p.y - 190, 380, 380),
          top + 2,
          () => top + 10,
        );
        maxHeight = Math.max(maxHeight, top);
      } else if (f.kind === "Gable ornament") {
        const box = bounds(footprintVertices(s)),
          longX = ridgeAlongX(s);
        for (const sign of [-1, 1]) {
          const local = {
              x: longX
                ? sign < 0
                  ? box.minX
                  : box.maxX
                : (box.minX + box.maxX) / 2,
              y: longX
                ? (box.minY + box.maxY) / 2
                : sign < 0
                  ? box.minY
                  : box.maxY,
            },
            p = featurePoint(b, s, local),
            z = visibleHeight(p, roofHeight(s, b, p));
          beam(
            out.timber,
            { ...p, z: z - 100 },
            { ...p, z: z + f.height },
            110,
          );
          const dir = rotate(
            { x: longX ? sign * 220 : 0, y: longX ? 0 : sign * 220 },
            s.orientation - b.frame.axis,
          );
          beam(
            out.timber,
            { ...p, z: z + f.height - 200 },
            { x: p.x + dir.x, y: p.y + dir.y, z: z + f.height - 60 },
            90,
          );
          maxHeight = Math.max(maxHeight, z + f.height);
        }
      } else {
        const door = b.openings.find((o) => o.id === f.doorId)!;
        const g = openingGeometry(context, door),
          n = { x: -g.host.inward!.x, y: -g.host.inward!.y },
          width = door.width + 500;
        const p = (t: number, d: number, z: number) => ({
          x: g.host.a.x + g.u.x * (door.offset + t) + n.x * d,
          y: g.host.a.y + g.u.y * (door.offset + t) + n.y * d,
          z,
        });
        const h = 2450;
        quad(
          out.roof,
          p(-width / 2, 0, h + 400),
          p(width / 2, 0, h + 400),
          p(width / 2, 900, h),
          p(-width / 2, 900, h),
        );
        for (const t of [-width / 2, width / 2]) {
          beam(out.timber, p(t, 850, 0), p(t, 850, h - 70), 100);
          beam(out.timber, p(t, 0, h + 350), p(t, 900, h - 50), 100);
        }
        beam(
          out.timber,
          p(-width / 2, 900, h - 50),
          p(width / 2, 900, h - 50),
          100,
        );
      }
    }
  }
  for (let i = 0; i < b.sections.length; i++)
    appendOrnaments(
      b,
      b.sections[i],
      data[i].parts,
      visibleHeight,
      beam,
      context,
    );
  for (const section of data)
    for (const points of Object.values(section.parts))
      for (let i = 2; i < points.length; i += 3)
        maxHeight = Math.max(maxHeight, points[i]);
  if (
    data.reduce(
      (n, s) => n + Object.values(s.parts).reduce((m, a) => m + a.length, 0),
      0,
    ) > 2250000
  )
    throw new Error(
      "The exterior exceeds the mobile triangle budget. The 2D plan remains available and unchanged.",
    );
  return {
    sections: data,
    warnings,
    maxHeight,
    bounds: bounds(roofRing),
    wallFootprintArea: wallArea,
    doorCount: doors.length,
    roofArea,
    cellCount: (xs.length - 1) * (ys.length - 1),
    roofFacets,
    roofTransitions,
  };
}
