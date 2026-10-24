import type { Section, Building } from "./model";
import { bounds } from "./polygon";
import { footprintVertices, rotate, type Point } from "./geometry";
import { ridgeAlongX, hipEndSlopeRatio } from "./exteriorSettings";
type Plane = { a: number; b: number; c: number };
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
  const ridgeX = ridgeAlongX(s),
    transverse = ridgeX ? y : x;
  if (s.exterior.roofStyle === "Hip") {
    if (s.exterior.ridgeAxis === "Auto") return [...x, ...y];
    // Preserve transverse pitch. Steepen end hips only as necessary to leave
    // a real ridge on the requested axis (at least 20% of its span).
    const ratio = hipEndSlopeRatio(s);
    const ends = (ridgeX ? x : y).map((p) => ({
      a: p.a * ratio,
      b: p.b * ratio,
      c: s.exterior.wallHeight + (p.c - s.exterior.wallHeight) * ratio,
    }));
    return [...transverse, ...ends];
  }
  if (s.exterior.roofStyle === "Shed") {
    const direction =
      s.exterior.shedHighEdge === "Auto"
        ? box.length >= box.width
          ? "+Y"
          : "+X"
        : s.exterior.shedHighEdge;
    return [
      (direction.endsWith("X") ? x : y)[direction.startsWith("+") ? 0 : 1],
    ];
  }
  return transverse;
}
const height = (planes: Plane[], p: Point) =>
  Math.min(...planes.map((f) => f.a * p.x + f.b * p.y + f.c));
export function roofHeight(s: Section, b: Building, p: Point) {
  return height(roofPlanes(s, b), p);
}
