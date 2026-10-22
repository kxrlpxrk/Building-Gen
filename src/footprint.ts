import { MIN_SIZE, MAX_SIZE, footprintVertices, type Point } from "./geometry";
import type { Section } from "./model";
import { bounds, presetVertices, type Shape } from "./polygon";
export type Part = { kind: "vertex" | "edge"; index: number } | null;
export const shapeName = (s: Section): Shape =>
  s.kind === "rectangle" ? "Rectangle" : s.preset;
export function withVertices(
  s: Section,
  vertices: Point[],
): Extract<Section, { kind: "polygon" }> {
  const box = bounds(vertices);
  return {
    ...s,
    kind: "polygon",
    preset: "Irregular",
    vertices,
    length: box.length,
    width: box.width,
  };
}
export function applyPreset(s: Section, shape: Shape): Section {
  // Presets replace local geometry but retain the world origin and metadata.
  if (shape === "Rectangle") {
    const {
      id,
      position,
      length,
      width,
      wallThickness,
      orientation,
      floorCount,
    } = s;
    return {
      id,
      kind: "rectangle",
      position: { ...position },
      length,
      width,
      wallThickness,
      orientation,
      floorCount,
    };
  }
  return {
    ...withVertices(s, presetVertices(shape, s.length, s.width)),
    kind: "polygon",
    preset: shape,
  };
}
export function scaleFootprint(
  s: Section,
  axis: "length" | "width",
  value: number,
): Section {
  if (!Number.isSafeInteger(value) || value < MIN_SIZE || value > MAX_SIZE)
    throw new Error("Length and width must be between 0.5 and 500 m.");
  if (s.kind === "rectangle") return { ...s, [axis]: value };
  const box = bounds(s.vertices),
    coordinate = axis === "length" ? "x" : "y",
    origin = axis === "length" ? box.minX : box.minY;
  const vertices = footprintVertices(s).map((p) => ({
    ...p,
    [coordinate]:
      origin + Math.round(((p[coordinate] - origin) * value) / s[axis]),
  }));
  return withVertices(s, vertices);
}
