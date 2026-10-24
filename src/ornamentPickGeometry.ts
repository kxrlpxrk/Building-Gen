/** Derived off-scene picking/preview triangles: reuse the exact existing artwork. */
import type { Building, Section } from "./model";
import { appendOrnaments } from "./ornamentGeometry";
import { beam, type Surface } from "./exteriorGeometry";
import type { Ornament } from "./ornamentation";
import type { OrnamentPlacementContext } from "./ornamentPlacement";
export function ornamentPickParts(
  b: Building,
  s: Section,
  o: Ornament,
  context: OrnamentPlacementContext,
): { body: number[]; relief: number[] } {
  const parts = {
    wall: [],
    roof: [],
    stone: [],
    timber: [],
    door: [],
    detail: [],
    glass: [],
    brick: [],
    roofDetail: [],
    ornamentWood: [],
    ornamentDark: [],
    ornamentOchre: [],
    ornamentPale: [],
  } as Record<Surface, number[]>;
  appendOrnaments(
    b,
    {
      ...s,
      exterior: {
        ...s.exterior,
        ornamentation: {
          level:
            s.exterior.ornamentation.level === "None"
              ? "Subtle"
              : s.exterior.ornamentation.level,
          items: [o],
        },
      },
    },
    parts,
    context.roofAt,
    beam,
    context.opening,
  );
  return {
    body: [
      ...parts.ornamentWood,
      ...parts.ornamentDark,
      ...parts.ornamentOchre,
      ...parts.ornamentPale,
    ],
    relief: parts.detail,
  };
}

export function ornamentTriangles(
  b: Building,
  s: Section,
  o: Ornament,
  context: OrnamentPlacementContext,
  includeRelief = false,
) {
  const parts = ornamentPickParts(b, s, o, context);
  return includeRelief ? [...parts.body, ...parts.relief] : parts.body;
}
