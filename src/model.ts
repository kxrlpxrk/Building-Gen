import { validateFootprint, type Rectangle } from "./geometry";
export type Architecture = "Medieval" | "Norse" | "Mixed";
import { SHAPES, type Shape } from "./polygon";
import type { Point } from "./geometry";
type SectionBase = Rectangle & { id: string; floorCount: number };
export type Section = SectionBase &
  (
    | { kind: "rectangle" }
    | { kind: "polygon"; preset: Shape; vertices: Point[] }
  );
export type Project = {
  schemaVersion: 2;
  id: string;
  name: string;
  architecture: Architecture;
  createdAt: string;
  updatedAt: string;
  building: { id: string; sections: [Section] };
};
export function createProject(name = "Untitled building"): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name,
    architecture: "Norse",
    createdAt: now,
    updatedAt: now,
    building: {
      id: crypto.randomUUID(),
      sections: [
        {
          id: crypto.randomUUID(),
          kind: "rectangle",
          position: { x: 0, y: 0, z: 0 },
          length: 12000,
          width: 8000,
          wallThickness: 200,
          orientation: 0,
          floorCount: 1,
        },
      ],
    },
  };
}
function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const validDate = (v: unknown) =>
  typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
// Reconstruct only the supported version's fields: untrusted JSON never enters state directly.
export function validateProject(value: unknown): Project {
  if (!object(value) || ![1, 2].includes(value.schemaVersion as number))
    throw new Error(
      "Unsupported project schema. BG-02A accepts schemaVersion 1 or 2.",
    );
  if (
    !validId(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    !["Medieval", "Norse", "Mixed"].includes(value.architecture as string) ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt)
  )
    throw new Error("Invalid project metadata.");
  if (
    !object(value.building) ||
    !validId(value.building.id) ||
    !Array.isArray(value.building.sections) ||
    value.building.sections.length !== 1
  )
    throw new Error("BG-02A requires exactly one footprint section.");
  const s = value.building.sections[0];
  if (
    !object(s) ||
    !validId(s.id) ||
    (s.kind !== "rectangle" &&
      (value.schemaVersion !== 2 || s.kind !== "polygon")) ||
    !object(s.position) ||
    ![1, 2, 3, 4].includes(s.floorCount as number)
  )
    throw new Error("Invalid building section.");
  for (const v of [
    s.length,
    s.width,
    s.wallThickness,
    s.orientation,
    s.position.x,
    s.position.y,
    s.position.z,
  ])
    if (typeof v !== "number")
      throw new Error("Geometry measurements must be numbers.");
  let section: Section = {
    id: s.id,
    kind: "rectangle",
    length: s.length as number,
    width: s.width as number,
    wallThickness: s.wallThickness as number,
    orientation: s.orientation as number,
    floorCount: s.floorCount as number,
    position: {
      x: s.position.x as number,
      y: s.position.y as number,
      z: s.position.z as number,
    },
  };
  if (s.kind === "polygon") {
    if (
      !SHAPES.includes(s.preset as Shape) ||
      s.preset === "Rectangle" ||
      !Array.isArray(s.vertices)
    )
      throw new Error("Invalid polygon preset or vertices.");
    const vertices = s.vertices.map((p: unknown) => {
      if (!object(p) || typeof p.x !== "number" || typeof p.y !== "number")
        throw new Error(
          "Each polygon vertex requires numeric X and Y coordinates.",
        );
      return { x: p.x, y: p.y };
    });
    section = {
      ...section,
      kind: "polygon",
      preset: s.preset as Shape,
      vertices,
    };
  }
  const error = validateFootprint(section);
  if (error) throw new Error(error);
  if (new Set([value.id, value.building.id, section.id]).size !== 3)
    throw new Error("Project, building and section IDs must be distinct.");
  return {
    schemaVersion: 2,
    id: value.id,
    name: value.name.trim(),
    architecture: value.architecture as Architecture,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    building: { id: value.building.id, sections: [section] },
  };
}
export const serializeProject = (p: Project) =>
  JSON.stringify(validateProject(p), null, 2);
export function parseProject(text: string): Project {
  if (text.length > 1_000_000)
    throw new Error("Project file is too large (maximum 1 MB).");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  return validateProject(value);
}
export function duplicateProject(
  p: Project,
  name = `${p.name.slice(0, 93)} (copy)`,
): Project {
  const copy = structuredClone(p),
    now = new Date().toISOString();
  copy.id = crypto.randomUUID();
  copy.building.id = crypto.randomUUID();
  copy.building.sections[0].id = crypto.randomUUID();
  copy.name = name;
  copy.createdAt = now;
  copy.updatedAt = now;
  return copy;
}
