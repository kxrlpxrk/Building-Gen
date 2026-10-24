import { exteriorDefaults } from "./exteriorSettings";
import {
  SECTION_TYPES,
  combinedGeometry,
  prepareBuilding,
  type SectionType,
} from "./assembly";
import type { Building, Section } from "./model";
import { footprintVertices, rotate } from "./geometry";
import { edgeLength, signedArea, type Shape } from "./polygon";
import { applyPreset } from "./footprint";
export const EXTENSION_TEMPLATES = [
  {
    name: "Small side wing",
    type: "Residential Wing",
    length: 6000,
    width: 4000,
    shape: "Rectangle",
  },
  {
    name: "Rear extension",
    type: "Hall Extension",
    length: 6000,
    width: 4000,
    shape: "Rectangle",
  },
  {
    name: "Corner wing",
    type: "Residential Wing",
    length: 6000,
    width: 6000,
    shape: "L-shape",
  },
  {
    name: "Workshop attachment",
    type: "Workshop",
    length: 6000,
    width: 4000,
    shape: "Rectangle",
  },
  {
    name: "Entrance porch",
    type: "Porch",
    length: 4000,
    width: 2000,
    shape: "Rectangle",
  },
  {
    name: "Square tower footprint",
    type: "Tower Footprint",
    length: 4000,
    width: 4000,
    shape: "Rectangle",
  },
  {
    name: "Custom dimensions",
    type: "Custom",
    length: 6000,
    width: 4000,
    shape: "Rectangle",
  },
] as const;
export type AttachmentConfig = {
  id: string;
  name: string;
  type: SectionType;
  length: number;
  width: number;
  shape: Shape;
  edge: number;
  offset: number;
};
export function attachmentBase(b: Building): Building {
  if (b.frame.mode === "assembly") return b;
  const s = b.sections[0];
  return {
    ...b,
    frame: {
      ...b.frame,
      origin: { x: s.position.x, y: s.position.y },
      axis: s.orientation,
      mode: "assembly",
    },
  };
}
export function attachmentPreview(
  b: Building,
  c: AttachmentConfig,
  source?: Section,
): { candidate: Section; building?: Building; error: string | null } {
  b = attachmentBase(b);
  const main = b.sections.find((s) => s.id === b.mainSectionId)!;
  let candidate: Section = source
    ? { ...structuredClone(source), id: c.id, name: c.name, locked: false }
    : applyPreset(
        {
          ...main,
          id: c.id,
          name: c.name,
          type: c.type,
          locked: false,
          kind: "rectangle",
          length: c.length,
          width: c.width,
          floorCount: 1,
          exterior: exteriorDefaults(main.exterior.material, c.type, false),
        },
        c.shape,
      );
  if (source) {
    const roofIds = new Map(
      candidate.exterior.roofFeatures.map((f, i) => [
        f.id,
        `${c.id}-roof-${i}`,
      ]),
    );
    candidate.exterior = {
      ...candidate.exterior,
      windows: candidate.exterior.windows.map((w, i) => ({
        ...w,
        id: `${c.id}-w-${i}`,
      })),
      roofFeatures: candidate.exterior.roofFeatures.map((f, i) => ({
        ...f,
        id: `${c.id}-roof-${i}`,
      })),
      ornamentation: {
        level: candidate.exterior.ornamentation.level,
        items: candidate.exterior.ornamentation.items.map((o, i) => ({
          ...o,
          id: `${c.id}-ornament-${i}`,
          anchor:
            o.anchor.kind === "roof"
              ? {
                  ...o.anchor,
                  roofFeatureId: o.anchor.roofFeatureId
                    ? roofIds.get(o.anchor.roofFeatureId)!
                    : null,
                }
              : o.anchor,
        })),
      },
      features: candidate.exterior.features.map((f, i) => ({
        ...f,
        id: `${c.id}-f-${i}`,
      })),
    };
  }
  if (
    source?.exterior.ornamentation.items.some(
      (o) => o.anchor.kind === "entrance",
    )
  )
    return {
      candidate,
      error:
        "Remove entrance ornaments before duplicating a section; doors are duplicated only with complete projects.",
    };
  // Strip polygon-only fields from rectangular templates copied from a polygon main.
  if (!source && c.shape === "Rectangle")
    candidate = applyPreset(candidate, "Rectangle");
  try {
    if (source?.exterior.features.some((f) => f.kind === "Entrance canopy"))
      throw new Error(
        "A section with an entrance canopy cannot be copied independently of its door. Duplicate the project, or remove the canopy before duplicating this section.",
      );
    if (
      !c.name.trim() ||
      c.name.length > 100 ||
      !SECTION_TYPES.includes(c.type)
    )
      throw new Error("Enter a section name and valid type.");
    if (!Number.isSafeInteger(c.offset) || Math.abs(c.offset) > 500000)
      throw new Error(
        "Attachment offset must be whole millimetres within ±500 m.",
      );
    if (b.sections.length >= 12)
      throw new Error("The building already has the maximum of 12 sections.");
    const outline = combinedGeometry(b).vertices,
      a = outline[c.edge],
      d = outline[(c.edge + 1) % outline.length];
    if (!a || !d) throw new Error("Select an external building edge.");
    const length = edgeLength(outline, c.edge),
      dx = (d.x - a.x) / length,
      dy = (d.y - a.y) / length;
    const v = footprintVertices(candidate),
      join = edgeLength(v, 0),
      sign = Math.sign(signedArea(v));
    const edgeAngle =
      (Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x) * 180) / Math.PI;
    const turn =
      ((Math.atan2(-dy * sign, -dx * sign) * 180) / Math.PI - edgeAngle + 720) %
      360;
    const first = rotate(v[0], turn),
      along = c.offset + (sign > 0 ? join : 0);
    const origin = {
      x: Math.round(a.x + dx * along - first.x),
      y: Math.round(a.y + dy * along - first.y),
    };
    candidate = {
      ...candidate,
      position: {
        x: b.frame.origin.x + origin.x,
        y: b.frame.origin.y + origin.y,
        z: main.position.z,
      },
      orientation: (b.frame.axis + turn) % 360,
      wallThickness: main.wallThickness,
    };
    const building = prepareBuilding(
      { ...b, sections: [...b.sections, candidate] },
      b,
    );
    return { candidate, building, error: null };
  } catch (e) {
    return { candidate, error: (e as Error).message };
  }
}
export function removeSection(b: Building, id: string): Building {
  if (id === b.mainSectionId)
    throw new Error("The main building cannot be removed.");
  return prepareBuilding(
    { ...b, sections: b.sections.filter((s) => s.id !== id) },
    b,
  );
}
