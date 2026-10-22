import { bounds, insetPolygon, polygonArea, validatePolygon } from "./polygon";
// Geometry is expressed in integer millimetres. Rendering never changes the model.
export type Point = { x: number; y: number };
export type Rectangle = {
  position: Point & { z: number };
  length: number;
  width: number;
  wallThickness: number;
  orientation: number;
};
export const MIN_SIZE = 500;
export const MAX_SIZE = 500_000;
export const MAX_POSITION = 10_000_000;
export const GRID_PRESETS = [250, 500, 1000, 2000] as const;
export const metres = (mm: number) => Number((mm / 1000).toFixed(3)).toString();
export const toMillimetres = (m: number) => Math.round(m * 1000);
export const snap = (value: number, step: number | null) =>
  step ? Math.round(value / step) * step : Math.round(value);
export function validateRectangle(r: Rectangle): string | null {
  if (
    ![
      r.length,
      r.width,
      r.wallThickness,
      r.position.x,
      r.position.y,
      r.position.z,
    ].every(Number.isSafeInteger)
  )
    return "Measurements must be whole millimetres (up to 3 decimal places in metres).";
  if (
    r.length < MIN_SIZE ||
    r.width < MIN_SIZE ||
    r.length > MAX_SIZE ||
    r.width > MAX_SIZE
  )
    return "Length and width must be between 0.5 and 500 m.";
  if (
    r.wallThickness < 10 ||
    2 * r.wallThickness >= Math.min(r.length, r.width)
  )
    return "Walls must be at least 0.01 m and leave a positive interior.";
  if (Object.values(r.position).some((v) => Math.abs(v) > MAX_POSITION))
    return "Position must be within ±10,000 m.";
  if (
    !Number.isFinite(r.orientation) ||
    r.orientation < 0 ||
    r.orientation >= 360
  )
    return "Orientation must be from 0° up to (but excluding) 360°.";
  return null;
}
export type Footprint = Rectangle & { vertices?: Point[] };
export const footprintVertices = (r: Footprint): Point[] =>
  r.vertices ?? [
    { x: 0, y: 0 },
    { x: r.length, y: 0 },
    { x: r.length, y: r.width },
    { x: 0, y: r.width },
  ];
export function validateFootprint(r: Footprint): string | null {
  const base = validateRectangle(r);
  if (base) return base;
  if (r.vertices) {
    const issue = validatePolygon(r.vertices);
    if (issue) return issue;
    const box = bounds(r.vertices);
    if (box.length !== r.length || box.width !== r.width)
      return "Polygon exterior extents do not match its vertices.";
    try {
      insetPolygon(r.vertices, r.wallThickness);
    } catch (e) {
      return (e as Error).message;
    }
  }
  return null;
}
export function areas(r: Footprint) {
  const v = footprintVertices(r);
  return {
    exterior: polygonArea(v) / 1e6,
    interior: polygonArea(insetPolygon(v, r.wallThickness)) / 1e6,
  };
}
export function rotate(p: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return {
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
  };
}
export function localToWorld(p: Point, r: Rectangle): Point {
  const q = rotate(p, r.orientation);
  return { x: q.x + r.position.x, y: q.y + r.position.y };
}
export function worldToLocal(p: Point, r: Rectangle): Point {
  return rotate(
    { x: p.x - r.position.x, y: p.y - r.position.y },
    -r.orientation,
  );
}
export function corners(r: Footprint): Point[] {
  return footprintVertices(r).map((p) => localToWorld(p, r));
}
export function moveRectangle(
  r: Rectangle,
  delta: Point,
  grid: number | null,
): Rectangle {
  return {
    ...r,
    position: {
      ...r.position,
      x: snap(r.position.x + delta.x, grid),
      y: snap(r.position.y + delta.y, grid),
    },
  };
}
export function resizeRectangle(
  r: Rectangle,
  corner: number,
  world: Point,
  grid: number | null,
): Rectangle {
  const p = worldToLocal(world, r);
  const left = corner === 0 || corner === 3;
  const top = corner === 0 || corner === 1;
  const minimum = Math.max(MIN_SIZE, r.wallThickness * 2 + 1);
  const length = Math.min(
    MAX_SIZE,
    Math.max(minimum, snap(left ? r.length - p.x : p.x, grid)),
  );
  const width = Math.min(
    MAX_SIZE,
    Math.max(minimum, snap(top ? r.width - p.y : p.y, grid)),
  );
  const origin = localToWorld(
    { x: left ? r.length - length : 0, y: top ? r.width - width : 0 },
    r,
  );
  return {
    ...r,
    length,
    width,
    position: {
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      z: r.position.z,
    },
  };
}
