import type { Point } from "./geometry";
export const MIN_EDGE = 100;
export const MAX_VERTICES = 64;
export const SHAPES = [
  "Rectangle",
  "L-shape",
  "T-shape",
  "U-shape",
  "Cross",
  "Irregular",
] as const;
export type Shape = (typeof SHAPES)[number];
export function signedArea(vertices: readonly Point[]): number {
  return (
    vertices.reduce((sum, a, i) => {
      const b = vertices[(i + 1) % vertices.length];
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2
  );
}
export const polygonArea = (vertices: readonly Point[]) =>
  Math.abs(signedArea(vertices));
export function bounds(vertices: readonly Point[]) {
  const xs = vertices.map((p) => p.x),
    ys = vertices.map((p) => p.y);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    maxX = Math.max(...xs),
    maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, length: maxX - minX, width: maxY - minY };
}
export const edgeLength = (v: readonly Point[], i: number) => {
  const a = v[i],
    b = v[(i + 1) % v.length];
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
};
function intersects(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    Math.min(a.x, b.x) <= Math.max(c.x, d.x) &&
    Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.min(a.y, b.y) <= Math.max(c.y, d.y) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
    abC * abD <= 0 &&
    cdA * cdB <= 0
  );
}
export function validatePolygon(
  v: readonly Point[],
  minEdge = MIN_EDGE,
): string | null {
  if (v.length < 4 || v.length > MAX_VERTICES)
    return `A footprint requires 4–${MAX_VERTICES} vertices.`;
  if (
    v.some(
      (p) =>
        !Number.isSafeInteger(p.x) ||
        !Number.isSafeInteger(p.y) ||
        Math.abs(p.x) > 500000 ||
        Math.abs(p.y) > 500000,
    )
  )
    return "Vertices must use whole millimetres within ±500 m of the local origin.";
  for (let i = 0; i < v.length; i++) {
    const a = v[i],
      b = v[(i + 1) % v.length],
      c = v[(i + 2) % v.length];
    if ((a.x === b.x) === (a.y === b.y))
      return "Every edge must be horizontal or vertical and have nonzero length.";
    if (edgeLength(v, i) < minEdge)
      return `Edges must be at least ${minEdge / 1000} m long.`;
    if ((a.x === b.x) === (b.x === c.x))
      return "Adjacent edges must meet at a right angle; redundant or reversing vertices are invalid.";
    for (let j = i + 1; j < v.length; j++) {
      if (j === i + 1 || (i === 0 && j === v.length - 1)) continue;
      if (intersects(a, b, v[j], v[(j + 1) % v.length]))
        return "Footprint edges must not self-intersect or touch nonadjacent edges.";
    }
  }
  if (polygonArea(v) === 0) return "The footprint must have a positive area.";
  return null;
}
function inside(p: Point, v: readonly Point[]) {
  let yes = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i],
      b = v[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      yes = !yes;
  }
  return yes;
}
/** Exact mitered inward offset for an orthogonal ring. Topology-changing offsets
 * are rejected, never replaced by bounding-box or area estimates. */
export function insetPolygon(v: readonly Point[], thickness: number): Point[] {
  const sourceError = validatePolygon(v);
  if (sourceError) throw new Error(sourceError);
  if (!Number.isSafeInteger(thickness) || thickness < 10)
    throw new Error("Walls must be at least 0.01 m and use whole millimetres.");
  const direction = Math.sign(signedArea(v));
  const normals = v.map((a, i) => {
    const b = v[(i + 1) % v.length],
      length = edgeLength(v, i);
    return {
      x: (-(b.y - a.y) / length) * direction,
      y: ((b.x - a.x) / length) * direction,
    };
  });
  const inner = v.map((p, i) => {
    const a = normals[(i + v.length - 1) % v.length],
      b = normals[i];
    return {
      x: p.x + (a.x + b.x) * thickness,
      y: p.y + (a.y + b.y) * thickness,
    };
  });
  const invalid =
    validatePolygon(inner, 1) ||
    Math.sign(signedArea(inner)) !== direction ||
    inner.some((a, i) => {
      const b = inner[(i + 1) % inner.length],
        p = v[i],
        q = v[(i + 1) % v.length];
      return (
        (b.x - a.x) * (q.x - p.x) + (b.y - a.y) * (q.y - p.y) <= 0 ||
        !inside(a, v) ||
        !inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v) ||
        // Check the entire segment against every exterior edge, not just its
        // endpoints: a remote notch must not intrude into the wall clearance.
        v.some((c, j) => {
          const d = v[(j + 1) % v.length];
          const gapX = Math.max(
            0,
            Math.min(a.x, b.x) - Math.max(c.x, d.x),
            Math.min(c.x, d.x) - Math.max(a.x, b.x),
          );
          const gapY = Math.max(
            0,
            Math.min(a.y, b.y) - Math.max(c.y, d.y),
            Math.min(c.y, d.y) - Math.max(a.y, b.y),
          );
          return Math.max(gapX, gapY) < thickness;
        })
      );
    });
  if (invalid)
    throw new Error(
      "Wall thickness is impossible here: it collapses or intersects the clear interior. Reduce the walls or widen the footprint.",
    );
  return inner;
}
export function presetVertices(
  shape: Shape,
  length = 12000,
  width = 8000,
): Point[] {
  const x = (f: number) => Math.round(length * f),
    y = (f: number) => Math.round(width * f);
  const shapes: Record<Shape, number[][]> = {
    Rectangle: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    "L-shape": [
      [0, 0],
      [1, 0],
      [1, 5 / 8],
      [2 / 3, 5 / 8],
      [2 / 3, 1],
      [0, 1],
    ],
    "T-shape": [
      [0, 0],
      [1, 0],
      [1, 1 / 3],
      [2 / 3, 1 / 3],
      [2 / 3, 1],
      [1 / 3, 1],
      [1 / 3, 1 / 3],
      [0, 1 / 3],
    ],
    "U-shape": [
      [0, 0],
      [1 / 3, 0],
      [1 / 3, 2 / 3],
      [2 / 3, 2 / 3],
      [2 / 3, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    Cross: [
      [1 / 3, 0],
      [2 / 3, 0],
      [2 / 3, 1 / 3],
      [1, 1 / 3],
      [1, 2 / 3],
      [2 / 3, 2 / 3],
      [2 / 3, 1],
      [1 / 3, 1],
      [1 / 3, 2 / 3],
      [0, 2 / 3],
      [0, 1 / 3],
      [1 / 3, 1 / 3],
    ],
    Irregular: [
      [0, 0],
      [2 / 3, 0],
      [2 / 3, 1 / 4],
      [1, 1 / 4],
      [1, 3 / 4],
      [1 / 2, 3 / 4],
      [1 / 2, 1],
      [0, 1],
    ],
  };
  return shapes[shape].map(([a, b]) => ({ x: x(a), y: y(b) }));
}
export function dragVertex(
  v: readonly Point[],
  i: number,
  point: Point,
): Point[] {
  const result = v.map((p) => ({ ...p })),
    prev = (i + v.length - 1) % v.length,
    next = (i + 1) % v.length;
  result[i] = { ...point };
  if (v[prev].x === v[i].x) result[prev].x = point.x;
  else result[prev].y = point.y;
  if (v[next].x === v[i].x) result[next].x = point.x;
  else result[next].y = point.y;
  return result;
}
export function dragEdge(
  v: readonly Point[],
  i: number,
  offset: number,
): Point[] {
  const result = v.map((p) => ({ ...p })),
    j = (i + 1) % v.length,
    axis = v[i].x === v[j].x ? "x" : "y";
  result[i][axis] += offset;
  result[j][axis] += offset;
  return result;
}
export function setEdgeLength(
  v: readonly Point[],
  i: number,
  length: number,
): Point[] {
  if (!Number.isSafeInteger(length) || length < MIN_EDGE)
    throw new Error(
      "Edge length must be at least 0.1 m and use whole millimetres.",
    );
  const a = v[i],
    b = v[(i + 1) % v.length],
    j = (i + 1) % v.length;
  // Keep the start fixed; translate the following perpendicular edge.
  const end =
    a.x === b.x
      ? { x: b.x, y: a.y + Math.sign(b.y - a.y) * length }
      : { x: a.x + Math.sign(b.x - a.x) * length, y: b.y };
  return dragVertex(v, j, end);
}
export const polygonPath = (v: readonly Point[]) =>
  `${v.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ")} Z`;
