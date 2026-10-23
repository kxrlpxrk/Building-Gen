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
export type Surface = "wall" | "roof" | "stone" | "timber" | "door";
export type SectionExterior = {
  id: string;
  material: Section["exterior"]["material"];
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
};
export const ROOF_THICKNESS = 120;
export const EXTERIOR_CELL_LIMIT = 40000;
type Plane = { a: number; b: number; c: number };
type Cell = { x: number; y: number; w: number; h: number; owner: number };
const EPS = 1e-6;
function triangle(out: number[], a: V3, b: V3, c: V3) {
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
) {
  const bottom = poly.map((p) => ({ ...p, z: lo })),
    upper = poly.map((p) => ({ ...p, z: top(p) }));
  for (let i = 1; i < poly.length - 1; i++) {
    triangle(out, upper[0], upper[i], upper[i + 1]);
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
/** Roofs are minima of affine planes, giving true planar Gable/Hip/Shed faces. */
export function roofPlanes(s: Section, b: Building): Plane[] {
  const box = bounds(footprintVertices(s)),
    angle = s.orientation - b.frame.axis,
    origin = {
      x: s.position.x - b.frame.origin.x,
      y: s.position.y - b.frame.origin.y,
    };
  const ux = rotate({ x: 1, y: 0 }, angle),
    uy = rotate({ x: 0, y: 1 }, angle),
    slope = Math.tan((s.exterior.roofPitch * Math.PI) / 180);
  const plane = (v: Point, k: number, sign: number): Plane => ({
    a: v.x * sign * slope,
    b: v.y * sign * slope,
    c:
      s.exterior.wallHeight +
      (-origin.x * v.x - origin.y * v.y - k) * sign * slope,
  });
  const x = [plane(ux, box.minX, 1), plane(ux, box.maxX, -1)],
    y = [plane(uy, box.minY, 1), plane(uy, box.maxY, -1)];
  if (s.exterior.roofStyle === "Hip") return [...x, ...y];
  const short = box.length >= box.width ? y : x;
  return s.exterior.roofStyle === "Shed" ? [short[0]] : short;
}
const height = (planes: Plane[], p: Point) =>
  Math.min(...planes.map((f) => f.a * p.x + f.b * p.y + f.c));
export function roofHeight(s: Section, b: Building, p: Point) {
  return height(roofPlanes(s, b), p);
}
function clip(poly: Point[], f: Plane): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      fa = f.a * a.x + f.b * a.y + f.c,
      fb = f.a * b.x + f.b * b.y + f.c;
    if (fa <= EPS) result.push(a);
    if ((fa < -EPS && fb > EPS) || (fa > EPS && fb < -EPS)) {
      const t = fa / (fa - fb);
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return result;
}
function faces(
  poly: Point[],
  planes: Plane[],
  callback: (p: Point[], plane: Plane) => void,
) {
  for (let i = 0; i < planes.length; i++) {
    let p = poly;
    for (let j = 0; j < planes.length && p.length >= 3; j++)
      if (i !== j)
        p = clip(p, {
          a: planes[i].a - planes[j].a,
          b: planes[i].b - planes[j].b,
          c: planes[i].c - planes[j].c,
        });
    if (p.length >= 3) callback(p, planes[i]);
  }
}
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
function edgeBreaks(a: Point, b: Point, planes: Plane[][]) {
  const cuts = [0, 1];
  for (const pp of [planes.flat()])
    for (let i = 0; i < pp.length; i++)
      for (let j = i + 1; j < pp.length; j++) {
        const f = {
            a: pp[i].a - pp[j].a,
            b: pp[i].b - pp[j].b,
            c: pp[i].c - pp[j].c,
          },
          v = f.a * a.x + f.b * a.y + f.c,
          d = f.a * (b.x - a.x) + f.b * (b.y - a.y);
        if (Math.abs(d) > EPS) {
          const t = -v / d;
          if (t > EPS && t < 1 - EPS) cuts.push(t);
        }
      }
  return [...new Set(cuts)].sort((a, b) => a - b);
}
export function buildExterior(b: Building): ExteriorModel {
  const g = combinedGeometry(b),
    rings = b.sections.map((s) => ring(s, b)),
    planes = b.sections.map((s) => roofPlanes(s, b)),
    data = b.sections.map((s) => ({
      id: s.id,
      material: s.exterior.material,
      parts: { wall: [], roof: [], stone: [], timber: [], door: [] } as Record<
        Surface,
        number[]
      >,
    }));
  const warnings: string[] = [];
  if (b.sections.some((s) => s.kind === "polygon"))
    warnings.push(
      "Concave roof fallback: section pitch planes are clipped to the actual outline. This is a simplified roof, not a calculated valley/hip intersection.",
    );
  if (b.sections.length > 1)
    warnings.push(
      "Joined roof fallback: roofs are clipped to disjoint section domains with closed vertical step/clerestory junctions. No valleys, trusses or engineered roof intersections are calculated.",
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
  const context = openingContext(b),
    doors = b.openings
      .filter((o) => o.host.kind === "exterior")
      .map((o) => ({ opening: o, geometry: openingGeometry(context, o) }));
  const points = [
    ...g.vertices,
    ...g.inner,
    ...roofRing,
    ...rings.flat(),
    ...doors.flatMap((d) =>
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
        out = data[s].parts,
        settings = b.sections[s].exterior,
        poly = rectangle(x, y, w, h);
      if (inside && !containsPoint(g.inner, p)) {
        wallArea += w * h;
        const gap = doors.find(
          (d) =>
            p.x > d.geometry.gap.x - EPS &&
            p.x < d.geometry.gap.x + d.geometry.gap.width + EPS &&
            p.y > d.geometry.gap.y - EPS &&
            p.y < d.geometry.gap.y + d.geometry.gap.height + EPS,
        );
        const low = gap ? 2100 : 0;
        if (!gap) prism(out.stone, poly, 0, () => 350);
        prism(out.wall, poly, Math.max(350, low), () => settings.wallHeight);
        faces(poly, planes[s], (face, f) => {
          const clipped = clip(face, {
            a: -f.a,
            b: -f.b,
            c: settings.wallHeight - f.c,
          });
          if (clipped.length >= 3)
            prism(
              out.wall,
              clipped,
              settings.wallHeight,
              (q) => f.a * q.x + f.b * q.y + f.c,
            );
        });
      }
      if (!containsPoint(roofRing, p)) continue;
      roofArea += w * h;
      roofCells.set(`${ix},${iy}`, { x, y, w, h, owner: s });
      faces(poly, planes[s], (face, f) => {
        const upper = face.map((p) => ({
            ...p,
            z: f.a * p.x + f.b * p.y + f.c,
          })),
          lower = upper.map((p) => ({ ...p, z: p.z - ROOF_THICKNESS }));
        for (const p of upper) maxHeight = Math.max(maxHeight, p.z);
        for (let i = 1; i < upper.length - 1; i++) {
          triangle(out.roof, upper[0], upper[i], upper[i + 1]);
          triangle(out.roof, lower[0], lower[i + 1], lower[i]);
        }
      });
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
      if ((n && n.owner === c.owner) || (n && n.owner < c.owner)) continue;
      const pp = planes[c.owner],
        qq = n ? planes[n.owner] : null,
        ts = edgeBreaks(a, z, qq ? [pp, qq] : [pp]);
      const point = (t: number) => ({
        x: a.x + (z.x - a.x) * t,
        y: a.y + (z.y - a.y) * t,
      });
      for (let j = 0; j < ts.length - 1; j++) {
        const p = point(ts[j]),
          q = point(ts[j + 1]);
        const hp = height(pp, p),
          hq = height(pp, q),
          lp = qq ? height(qq, p) : hp - ROOF_THICKNESS,
          lq = qq ? height(qq, q) : hq - ROOF_THICKNESS;
        quad(
          data[c.owner].parts[n ? "wall" : "roof"],
          { ...p, z: hp },
          { ...q, z: hq },
          { ...q, z: lq },
          { ...p, z: lp },
        );
        if (!n)
          beam(
            data[c.owner].parts.timber,
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
    const intervals = Math.min(24, Math.max(1, Math.ceil(len / 2400))),
      gapAt = (t: number) => {
        const p = { x: a.x + dx * t - n.x * 30, y: a.y + dy * t - n.y * 30 };
        return doors.some(
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
          point(t, Math.max(ex.wallHeight, roofHeight(s, b, p)) - 100),
          140,
        );
      }
    if (ex.material !== "Norse")
      for (let i = 0; i < intervals && detailCount++ < 900; i++) {
        const lo = (i * len) / intervals,
          hi = ((i + 1) * len) / intervals;
        if (
          doors.some((d) => {
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
    // Gable sloping bar gives clear architectural silhouette on pronounced ends.
    const breaks = edgeBreaks(a, z, [planes[seg.owner]]);
    for (let j = 0; j < breaks.length - 1; j++) {
      const p = point(breaks[j] * len, 0),
        q = point(breaks[j + 1] * len, 0),
        hp = roofHeight(s, b, p),
        hq = roofHeight(s, b, q);
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
  };
}
