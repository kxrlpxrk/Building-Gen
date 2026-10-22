import {
  emptyInterior,
  ROOM_TYPES,
  validateInterior,
  type InteriorPlan,
  type RoomType,
} from "./interior";
import { combinedGeometry } from "./assembly";
import { validateFootprint, type Rectangle, type Point } from "./geometry";
import { SHAPES, type Shape } from "./polygon";
import {
  SECTION_TYPES,
  validateConnections,
  type SectionType,
} from "./assembly";
export type Architecture = "Medieval" | "Norse" | "Mixed";
type SectionBase = Rectangle & {
  id: string;
  name: string;
  type: SectionType;
  locked: boolean;
  floorCount: number;
};
export type Section = SectionBase &
  (
    | { kind: "rectangle" }
    | { kind: "polygon"; preset: Shape; vertices: Point[] }
  );
export type Connection = {
  id: string;
  a: { sectionId: string; edge: number };
  b: { sectionId: string; edge: number };
  start: Point;
  end: Point;
  mode: "open-plan";
};
export type Building = {
  id: string;
  mainSectionId: string;
  frame: {
    origin: Point;
    axis: number;
    rotation: number;
    mode: "legacy" | "assembly";
  };
  sections: Section[];
  connections: Connection[];
  interior: InteriorPlan;
};
export type Project = {
  schemaVersion: 4;
  id: string;
  name: string;
  architecture: Architecture;
  createdAt: string;
  updatedAt: string;
  building: Building;
};
export function createProject(name = "Untitled building"): Project {
  const now = new Date().toISOString(),
    sectionId = crypto.randomUUID();
  return {
    schemaVersion: 4,
    id: crypto.randomUUID(),
    name,
    architecture: "Norse",
    createdAt: now,
    updatedAt: now,
    building: {
      id: crypto.randomUUID(),
      mainSectionId: sectionId,
      frame: { origin: { x: 0, y: 0 }, axis: 0, rotation: 0, mode: "legacy" },
      connections: [],
      interior: emptyInterior(),
      sections: [
        {
          id: sectionId,
          name: "Main building",
          type: "Custom",
          locked: false,
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
const validName = (v: unknown): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= 100;
const validAngle = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 360;
function point(v: unknown): Point {
  if (
    !object(v) ||
    !Number.isSafeInteger(v.x) ||
    !Number.isSafeInteger(v.y) ||
    Math.abs(v.x as number) > 10000000 ||
    Math.abs(v.y as number) > 10000000
  )
    throw new Error(
      "Invalid integer-millimetre attachment or frame coordinates.",
    );
  return { x: v.x as number, y: v.y as number };
}
function section(value: unknown, version: number): Section {
  if (
    !object(value) ||
    !validId(value.id) ||
    (value.kind !== "rectangle" &&
      (version === 1 || value.kind !== "polygon")) ||
    !object(value.position) ||
    ![1, 2, 3, 4].includes(value.floorCount as number)
  )
    throw new Error("Invalid building section.");
  if (
    version >= 3 &&
    (!validName(value.name) ||
      !SECTION_TYPES.includes(value.type as SectionType) ||
      typeof value.locked !== "boolean")
  )
    throw new Error("Invalid section name, type or lock state.");
  for (const v of [
    value.length,
    value.width,
    value.wallThickness,
    value.orientation,
    value.position.x,
    value.position.y,
    value.position.z,
  ])
    if (typeof v !== "number")
      throw new Error("Geometry measurements must be numbers.");
  let s: Section = {
    id: value.id,
    name: version >= 3 ? (value.name as string).trim() : "Main building",
    type: version >= 3 ? (value.type as SectionType) : "Custom",
    locked: version >= 3 ? (value.locked as boolean) : false,
    kind: "rectangle",
    length: value.length as number,
    width: value.width as number,
    wallThickness: value.wallThickness as number,
    orientation: value.orientation as number,
    floorCount: value.floorCount as number,
    position: {
      x: value.position.x as number,
      y: value.position.y as number,
      z: value.position.z as number,
    },
  };
  if (value.kind === "polygon") {
    if (
      !SHAPES.includes(value.preset as Shape) ||
      value.preset === "Rectangle" ||
      !Array.isArray(value.vertices)
    )
      throw new Error("Invalid polygon preset or vertices.");
    const vertices = value.vertices.map((p: unknown) => {
      if (!object(p) || typeof p.x !== "number" || typeof p.y !== "number")
        throw new Error(
          "Each polygon vertex requires numeric X and Y coordinates.",
        );
      return { x: p.x, y: p.y };
    });
    s = { ...s, kind: "polygon", preset: value.preset as Shape, vertices };
  }
  const error = validateFootprint(s);
  if (error) throw new Error(error);
  return s;
}
function readInterior(value: unknown): InteriorPlan {
  if (
    !object(value) ||
    !Array.isArray(value.partitions) ||
    !Array.isArray(value.rooms) ||
    value.partitions.length > 64 ||
    value.rooms.length > 512
  )
    throw new Error("Invalid ground-floor interior plan.");
  const partitions = value.partitions.map((w: unknown) => {
    if (!object(w) || !validId(w.id) || !Number.isSafeInteger(w.thickness))
      throw new Error("Invalid partition record.");
    return {
      id: w.id,
      a: point(w.a),
      b: point(w.b),
      thickness: w.thickness as number,
    };
  });
  const rooms = value.rooms.map((r: unknown) => {
    if (
      !object(r) ||
      !validId(r.id) ||
      !(
        r.regionKey === null ||
        (typeof r.regionKey === "string" && r.regionKey.length <= 100000)
      ) ||
      typeof r.name !== "string" ||
      r.name.length > 100 ||
      !ROOM_TYPES.includes(r.type as RoomType) ||
      typeof r.notes !== "string" ||
      r.notes.length > 2000
    )
      throw new Error("Invalid room metadata.");
    return {
      id: r.id,
      regionKey: r.regionKey as string | null,
      name: r.name,
      type: r.type as RoomType,
      notes: r.notes,
    };
  });
  return { partitions, rooms };
}
/** Pure, lossless read-time migration. Existing geometry fields are not rewritten. */
export function validateProject(value: unknown): Project {
  if (!object(value) || ![1, 2, 3, 4].includes(value.schemaVersion as number))
    throw new Error(
      "Unsupported project schema. BG-03A accepts schemaVersion 1, 2, 3 or 4.",
    );
  const version = value.schemaVersion as number;
  if (
    !validId(value.id) ||
    !validName(value.name) ||
    !["Medieval", "Norse", "Mixed"].includes(value.architecture as string) ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt)
  )
    throw new Error("Invalid project metadata.");
  if (
    !object(value.building) ||
    !validId(value.building.id) ||
    !Array.isArray(value.building.sections) ||
    value.building.sections.length < 1 ||
    value.building.sections.length > (version >= 3 ? 12 : 1)
  )
    throw new Error(
      "A building requires 1–12 sections (legacy schemas require exactly one).",
    );
  const source = value.building,
    sections = (source.sections as unknown[]).map((s) => section(s, version)),
    first = sections[0];
  let frame: Building["frame"] = {
      origin: { x: first.position.x, y: first.position.y },
      axis: first.orientation,
      rotation: 0,
      mode: "legacy",
    },
    mainSectionId = first.id,
    connections: Connection[] = [];
  if (version >= 3) {
    if (
      !object(source.frame) ||
      !validAngle(source.frame.axis) ||
      !validAngle(source.frame.rotation) ||
      !["legacy", "assembly"].includes(source.frame.mode as string) ||
      !validId(source.mainSectionId) ||
      !sections.some((s) => s.id === source.mainSectionId) ||
      !Array.isArray(source.connections)
    )
      throw new Error("Invalid building frame, main section or attachments.");
    frame = {
      origin: point(source.frame.origin),
      axis: source.frame.axis,
      rotation: source.frame.rotation,
      mode: source.frame.mode as "legacy" | "assembly",
    };
    mainSectionId = source.mainSectionId;
    connections = source.connections.map((c: unknown) => {
      if (
        !object(c) ||
        !validId(c.id) ||
        !object(c.a) ||
        !object(c.b) ||
        !validId(c.a.sectionId) ||
        !validId(c.b.sectionId) ||
        !Number.isSafeInteger(c.a.edge) ||
        !Number.isSafeInteger(c.b.edge) ||
        c.mode !== "open-plan"
      )
        throw new Error("Invalid attachment record.");
      return {
        id: c.id,
        a: { sectionId: c.a.sectionId, edge: c.a.edge as number },
        b: { sectionId: c.b.sectionId, edge: c.b.edge as number },
        start: point(c.start),
        end: point(c.end),
        mode: "open-plan",
      };
    });
  }
  const ids = [
    value.id,
    source.id,
    ...sections.map((s) => s.id),
    ...connections.map((c) => c.id),
  ];
  if (new Set(ids).size !== ids.length)
    throw new Error(
      "Project, building, section and connection IDs must be distinct.",
    );
  const building: Building = {
    id: source.id as string,
    mainSectionId,
    frame,
    sections,
    connections,
    interior: version === 4 ? readInterior(source.interior) : emptyInterior(),
  };
  validateConnections(building);
  validateInterior(combinedGeometry(building).inner, building.interior);
  const interiorIds = [
    ...building.interior.partitions,
    ...building.interior.rooms,
  ].map((v) => v.id);
  if (
    new Set([...ids, ...interiorIds]).size !==
    ids.length + interiorIds.length
  )
    throw new Error("All project and interior IDs must be distinct.");
  return {
    schemaVersion: 4,
    id: value.id,
    name: value.name.trim(),
    architecture: value.architecture as Architecture,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    building,
  };
}
export const serializeProject = (p: Project) =>
  JSON.stringify(validateProject(p), null, 2);
export function parseProject(text: string): Project {
  if (text.length > 1000000)
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
    now = new Date().toISOString(),
    ids = new Map(
      copy.building.sections.map((s) => [s.id, crypto.randomUUID()]),
    );
  copy.id = crypto.randomUUID();
  copy.building.id = crypto.randomUUID();
  copy.building.mainSectionId = ids.get(copy.building.mainSectionId)!;
  copy.building.sections = copy.building.sections.map((s) => ({
    ...s,
    id: ids.get(s.id)!,
  }));
  copy.building.connections = copy.building.connections.map((c) => ({
    ...c,
    id: crypto.randomUUID(),
    a: { ...c.a, sectionId: ids.get(c.a.sectionId)! },
    b: { ...c.b, sectionId: ids.get(c.b.sectionId)! },
  }));
  copy.building.interior.partitions = copy.building.interior.partitions.map(
    (w) => ({ ...w, id: crypto.randomUUID() }),
  );
  copy.building.interior.rooms = copy.building.interior.rooms.map((r) => ({
    ...r,
    id: crypto.randomUUID(),
  }));
  copy.name = name;
  copy.createdAt = now;
  copy.updatedAt = now;
  return copy;
}
