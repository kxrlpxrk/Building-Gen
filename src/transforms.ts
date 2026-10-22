import { corners, type Point, type Rectangle } from "./geometry";
export type Camera = { center: Point; scale: number };
export type Viewport = { width: number; height: number };
export const MIN_SCALE = 0.0002;
export const MAX_SCALE = 2;
export const screenToWorld = (p: Point, c: Camera, v: Viewport): Point => ({
  x: (p.x - v.width / 2) / c.scale + c.center.x,
  y: (p.y - v.height / 2) / c.scale + c.center.y,
});
export const worldToScreen = (p: Point, c: Camera, v: Viewport): Point => ({
  x: (p.x - c.center.x) * c.scale + v.width / 2,
  y: (p.y - c.center.y) * c.scale + v.height / 2,
});
export function zoomAt(
  c: Camera,
  anchor: Point,
  factor: number,
  v: Viewport,
): Camera {
  const before = screenToWorld(anchor, c, v);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, c.scale * factor));
  return {
    scale,
    center: {
      x: before.x - (anchor.x - v.width / 2) / scale,
      y: before.y - (anchor.y - v.height / 2) / scale,
    },
  };
}
export function panCamera(c: Camera, delta: Point): Camera {
  return {
    ...c,
    center: {
      x: c.center.x - delta.x / c.scale,
      y: c.center.y - delta.y / c.scale,
    },
  };
}
export function pinchCamera(
  c: Camera,
  initialMidpoint: Point,
  midpoint: Point,
  ratio: number,
  v: Viewport,
): Camera {
  return panCamera(zoomAt(c, initialMidpoint, ratio, v), {
    x: midpoint.x - initialMidpoint.x,
    y: midpoint.y - initialMidpoint.y,
  });
}
export function fitCamera(r: Rectangle, v: Viewport): Camera {
  const pts = corners(r),
    xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    scale: Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        Math.max(40, v.width - 128) / (maxX - minX),
        Math.max(40, v.height - 144) / (maxY - minY),
      ),
    ),
  };
}
