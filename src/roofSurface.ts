/** Deterministic roof Boolean surface calculations. Model XY/Z in millimetres;
 * no Three.js, raster sampling or persisted render data. */
import type { Point } from "./geometry";
import { containsPoint } from "./interior";
import { bounds, signedArea } from "./polygon";
export type RoofPlane = { a: number; b: number; c: number };
export type RoofFacet = { polygon: Point[]; plane: RoofPlane; owner: number };
export type RoofDomain = {
  polygon: Point[];
  owner: number;
  kind: "section" | "eave" | "intersection";
};
const EPS = 1e-7;
export const planeHeight = (f: RoofPlane, p: Point) =>
  f.a * p.x + f.b * p.y + f.c;
export const fieldHeight = (planes: RoofPlane[], p: Point) =>
  Math.min(...planes.map((f) => planeHeight(f, p)));
export function cleanPolygon(input: Point[]): Point[] {
  const p: Point[] = [];
  for (const q of input)
    if (
      !p.length ||
      Math.hypot(q.x - p[p.length - 1].x, q.y - p[p.length - 1].y) > EPS
    )
      p.push(q);
  if (
    p.length > 1 &&
    Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) <= EPS
  )
    p.pop();
  let changed = true;
  while (changed && p.length >= 3) {
    changed = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length],
        b = p[i],
        c = p[(i + 1) % p.length];
      if (
        Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) <
        EPS * Math.max(1, Math.hypot(c.x - a.x, c.y - a.y))
      ) {
        p.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (p.length < 3 || Math.abs(signedArea(p)) < 1e-5) return [];
  return signedArea(p) < 0 ? p.reverse() : p;
}
export function clipRoof(poly: Point[], f: RoofPlane): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      fa = planeHeight(f, a),
      fb = planeHeight(f, b),
      ia = fa <= EPS,
      ib = fb <= EPS;
    if (ia) out.push(a);
    if (ia !== ib) {
      const d = fa - fb;
      if (Math.abs(d) > EPS) {
        const t = Math.max(0, Math.min(1, fa / d));
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  return cleanPolygon(out);
}
export function pitchFacets(
  poly: Point[],
  planes: RoofPlane[],
): { polygon: Point[]; plane: RoofPlane }[] {
  const result: { polygon: Point[]; plane: RoofPlane }[] = [];
  for (let i = 0; i < planes.length; i++) {
    let p = poly;
    for (let j = 0; j < planes.length && p.length; j++)
      if (i !== j)
        p = clipRoof(p, {
          a: planes[i].a - planes[j].a,
          b: planes[i].b - planes[j].b,
          c: planes[i].c - planes[j].c,
        });
    if (p.length) result.push({ polygon: p, plane: planes[i] });
  }
  return result;
}
export const rectangleRoof = (
  x: number,
  y: number,
  w: number,
  h: number,
): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
export function onRing(p: Point[], q: Point) {
  return p.some((a, i) => {
    const b = p[(i + 1) % p.length];
    return (
      Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) < 0.001 &&
      q.x >= Math.min(a.x, b.x) - EPS &&
      q.x <= Math.max(a.x, b.x) + EPS &&
      q.y >= Math.min(a.y, b.y) - EPS &&
      q.y <= Math.max(a.y, b.y) + EPS
    );
  });
}
const covers = (d: RoofDomain, p: Point) =>
  containsPoint(d.polygon, p) || onRing(d.polygon, p);
export function profileBreaks(
  a: Point,
  b: Point,
  sets: RoofPlane[][],
  offsets = [0],
) {
  const cuts = [0, 1],
    pp = sets.flat();
  for (let i = 0; i < pp.length; i++)
    for (let j = i + 1; j < pp.length; j++)
      for (const offset of offsets) {
        const f = {
            a: pp[i].a - pp[j].a,
            b: pp[i].b - pp[j].b,
            c: pp[i].c - pp[j].c + offset,
          },
          v = planeHeight(f, a),
          d = f.a * (b.x - a.x) + f.b * (b.y - a.y);
        if (Math.abs(d) > EPS) {
          const t = -v / d;
          if (t > EPS && t < 1 - EPS) cuts.push(t);
        }
      }
  return [...new Set(cuts.map((t) => Math.round(t * 1e12) / 1e12))].sort(
    (a, b) => a - b,
  );
}
/** Only promote a roof across a direct rectangular neighbour if every artificial
 * cutoff is below that neighbour's native roof. Edges on the genuine exterior
 * may rise with the intersected roof and receive matching facade infill. */
export function intersectionDomains(
  rings: Point[][],
  planes: RoofPlane[][],
  rectangular: boolean[],
  joins: {
    a: { sectionId: string };
    b: { sectionId: string };
    start: Point;
    end: Point;
  }[],
  ids: string[],
  outer: Point[],
) {
  const result: RoofDomain[] = [];
  let refused = 0;
  for (const join of joins)
    for (const [from, to] of [
      [ids.indexOf(join.a.sectionId), ids.indexOf(join.b.sectionId)],
      [ids.indexOf(join.b.sectionId), ids.indexOf(join.a.sectionId)],
    ]) {
      if (!rectangular[from] || !rectangular[to]) {
        refused++;
        continue;
      }
      const box = bounds(rings[to]),
        a = join.start,
        b = join.end,
        horizontal = Math.abs(a.y - b.y) < EPS;
      const midpoint = horizontal
        ? (box.minY + box.maxY) / 2
        : (box.minX + box.maxX) / 2;
      const poly = horizontal
        ? rectangleRoof(
            Math.min(a.x, b.x),
            Math.min(a.y, midpoint),
            Math.abs(a.x - b.x),
            Math.abs(a.y - midpoint),
          )
        : rectangleRoof(
            Math.min(a.x, midpoint),
            Math.min(a.y, b.y),
            Math.abs(a.x - midpoint),
            Math.abs(a.y - b.y),
          );
      let safe = true;
      for (let i = 0; i < 4; i++) {
        const p = poly[i],
          q = poly[(i + 1) % 4],
          sameJoin = horizontal
            ? Math.abs(p.y - a.y) < EPS && Math.abs(q.y - a.y) < EPS
            : Math.abs(p.x - a.x) < EPS && Math.abs(q.x - a.x) < EPS;
        if (sameJoin) continue;
        const exterior = outer.some((a, i) => {
          const b = outer[(i + 1) % outer.length];
          return onRing([a, b], p) && onRing([a, b], q);
        });
        if (exterior) continue;
        for (const t of profileBreaks(p, q, [planes[from], planes[to]])) {
          const point = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
          if (
            fieldHeight(planes[from], point) >
            fieldHeight(planes[to], point) + 0.001
          )
            safe = false;
        }
      }
      if (safe)
        result.push({ polygon: poly, owner: from, kind: "intersection" });
      else refused++;
    }
  return { domains: result, refused };
}
export function roofSurface(planes: RoofPlane[][], domains: RoofDomain[]) {
  const boxes = domains.map((d) => bounds(d.polygon));
  const candidates = (p: Point) => {
    const native = new Set<number>(),
      active = new Set<number>();
    domains.forEach((d, i) => {
      const b = boxes[i];
      if (
        p.x >= b.minX - EPS &&
        p.x <= b.maxX + EPS &&
        p.y >= b.minY - EPS &&
        p.y <= b.maxY + EPS &&
        covers(d, p)
      ) {
        active.add(d.owner);
        if (d.kind === "section") native.add(d.owner);
      }
    });
    return [...active].sort(
      (a, b) => Number(native.has(b)) - Number(native.has(a)) || a - b,
    );
  };
  const height = (owners: number[], p: Point) =>
    Math.max(...owners.map((i) => fieldHeight(planes[i], p)));
  function facets(poly: Point[], owners: number[]): RoofFacet[] {
    const out: RoofFacet[] = [];
    for (const owner of owners)
      for (const facet of pitchFacets(poly, planes[owner])) {
        let pieces = [facet.polygon];
        for (const other of owners)
          if (other !== owner) {
            const next: Point[][] = [];
            for (const p of pieces)
              for (const g of pitchFacets(p, planes[other])) {
                const f = facet.plane,
                  d = {
                    a: g.plane.a - f.a,
                    b: g.plane.b - f.b,
                    c: g.plane.c - f.c,
                  };
                const same =
                  Math.abs(d.a) < EPS &&
                  Math.abs(d.b) < EPS &&
                  Math.abs(d.c) < EPS;
                if (same) {
                  if (owners.indexOf(owner) < owners.indexOf(other))
                    next.push(g.polygon);
                } else {
                  const clipped = clipRoof(g.polygon, d);
                  if (clipped.length) next.push(clipped);
                }
              }
            pieces = next;
            if (pieces.length > 2048)
              throw new Error("Roof intersection complexity limit.");
            if (!pieces.length) break;
          }
        for (const polygon of pieces)
          out.push({ polygon, plane: facet.plane, owner });
      }
    return out;
  }
  const at = (p: Point) => height(candidates(p), p);
  function over(poly: Point[]): RoofFacet[] {
    const box = bounds(poly),
      xs = [
        ...new Set([
          box.minX,
          box.maxX,
          ...domains
            .flatMap((d) => d.polygon.map((p) => p.x))
            .filter((x) => x > box.minX && x < box.maxX),
        ]),
      ].sort((a, b) => a - b),
      ys = [
        ...new Set([
          box.minY,
          box.maxY,
          ...domains
            .flatMap((d) => d.polygon.map((p) => p.y))
            .filter((y) => y > box.minY && y < box.maxY),
        ]),
      ].sort((a, b) => a - b),
      out: RoofFacet[] = [];
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j < ys.length - 1; j++) {
        let p = poly;
        for (const f of [
          { a: -1, b: 0, c: xs[i] },
          { a: 1, b: 0, c: -xs[i + 1] },
          { a: 0, b: -1, c: ys[j] },
          { a: 0, b: 1, c: -ys[j + 1] },
        ])
          p = clipRoof(p, f);
        if (p.length) {
          const mid = {
            x: (xs[i] + xs[i + 1]) / 2,
            y: (ys[j] + ys[j + 1]) / 2,
          };
          out.push(...facets(p, candidates(mid)));
        }
      }
    return out;
  }
  return { candidates, height, facets, at, over, domains };
}
