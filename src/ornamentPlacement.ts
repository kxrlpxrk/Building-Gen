/** Direct editing of canonical ornaments. Geometry/clearance rules live in ornamentation.ts. */
import type { Building } from "./model";
import { prepareBuilding, openingContext } from "./assembly";
import { snap } from "./geometry";
import { buildExterior } from "./exteriorGeometry";
import {
  isRoofOrnament,
  resolveOrnament,
  ornamentRoofSurface,
  validateOrnamentation,
  readOrnamentation,
  type Ornament,
} from "./ornamentation";
import type { WallHit } from "./windowPlacement";
export type OrnamentAnchor = { sectionId: string; ornament: Ornament };
export type OrnamentHit = {
  sectionId: string;
  point: { x: number; y: number; z: number };
  wall: WallHit | null;
};
export type OrnamentSession = {
  mode: "place" | "move";
  source: OrnamentAnchor | null;
  draft: OrnamentAnchor | null;
  template: Ornament;
  issue: string;
  hit: OrnamentHit | null;
};
export type OrnamentPlacement = {
  state: OrnamentSession | null;
  getState: () => OrnamentSession | null;
  start: (type: Ornament["type"]) => void;
  move: (source: OrnamentAnchor) => void;
  preview: (draft: OrnamentAnchor) => void;
  position: (
    hit: OrnamentHit | null,
    grab?: { offset: number; z: number },
    visible?: (anchor: OrnamentAnchor) => boolean,
  ) => void;
  restore: (state: OrnamentSession | null) => void;
  commit: () => string | null;
  cancel: () => void;
};
export const ornamentPlacementContext = (b: Building) => ({
  roofAt: ornamentRoofSurface(b),
  opening: openingContext(b),
});
export type OrnamentPlacementContext = ReturnType<
  typeof ornamentPlacementContext
>;
/** This cheap immutable candidate is also used for live validation; no building mesh rebuild. */
export function ornamentCandidate(
  b: Building,
  draft: OrnamentAnchor,
  source: OrnamentAnchor | null,
): Building {
  const target = b.sections.find((s) => s.id === draft.sectionId),
    prior = source && b.sections.find((s) => s.id === source.sectionId);
  if (!target) throw new Error("Ornament destination section is missing.");
  if (target.locked || prior?.locked)
    throw new Error(
      "Source and destination sections must be unlocked to place or move ornaments.",
    );
  if (
    source &&
    (!prior ||
      !prior.exterior.ornamentation.items.some(
        (o) => JSON.stringify(o) === JSON.stringify(source.ornament),
      ))
  )
    throw new Error("Original ornament changed. Cancel and select it again.");
  if (source && draft.ornament.id !== source.ornament.id)
    throw new Error("Moving an ornament must preserve its stable ID.");
  if (
    !source &&
    b.sections.some((s) =>
      s.exterior.ornamentation.items.some((o) => o.id === draft.ornament.id),
    )
  )
    throw new Error("This ornament ID already exists.");
  return {
    ...b,
    sections: b.sections.map((s) => {
      const set = s.exterior.ornamentation;
      if (s.id !== source?.sectionId && s.id !== draft.sectionId) return s;
      const items = set.items.filter(
        (o) => !source || o.id !== source.ornament.id,
      );
      if (s.id === draft.sectionId) items.push(draft.ornament);
      const ornamentation = readOrnamentation({
        level:
          s.id === draft.sectionId && set.level === "None"
            ? "Subtle"
            : set.level,
        items,
      });
      return { ...s, exterior: { ...s.exterior, ornamentation } };
    }),
  };
}
export function previewOrnament(
  b: Building,
  draft: OrnamentAnchor,
  source: OrnamentAnchor | null,
  context: OrnamentPlacementContext,
) {
  const next = ornamentCandidate(b, draft, source);
  validateOrnamentation(next, context);
  return next;
}
export function placeOrnament(
  b: Building,
  draft: OrnamentAnchor,
  source: OrnamentAnchor | null,
) {
  const next = prepareBuilding(ornamentCandidate(b, draft, source), b);
  buildExterior(next); // Full renderer budget is checked once, on confirmation.
  return next;
}
/** Ray hits are canonical building-local millimetres, never arbitrary saved XYZ positions. */
export function positionOrnament(
  b: Building,
  hit: OrnamentHit,
  ornament: Ornament,
  step: number | null,
  context: OrnamentPlacementContext,
  grab = { offset: 0, z: (500 * ornament.scale) / 1000 },
): OrnamentAnchor {
  const s = b.sections.find((s) => s.id === hit.sectionId);
  if (!s) throw new Error("Tap a visible architectural surface.");
  if (!isRoofOrnament(ornament.type)) {
    const wall = hit.wall;
    if (!wall || wall.sectionId !== s.id)
      throw new Error(
        "This ornament needs an exposed exterior wall, not a roof or hidden facade.",
      );
    if (ornament.type === "Entrance pillars") {
      const doors = b.openings
        .filter(
          (d) =>
            d.type === "exterior-door" &&
            d.host.kind === "exterior" &&
            d.host.sectionId === s.id &&
            d.host.edge === wall.edge,
        )
        .sort(
          (a, z) =>
            Math.abs(a.offset - wall.offset) - Math.abs(z.offset - wall.offset),
        );
      const door = doors[0];
      if (
        !door ||
        Math.abs(door.offset - wall.offset) > Math.max(1800, door.width)
      )
        throw new Error(
          "Tap near a real exterior entrance on this exposed wall.",
        );
      return {
        sectionId: s.id,
        ornament: {
          ...ornament,
          anchor: { kind: "entrance", doorId: door.id },
        },
      };
    }
    return {
      sectionId: s.id,
      ornament: {
        ...ornament,
        anchor: {
          kind: "wall",
          edge: wall.edge,
          offset: snap(wall.offset - grab.offset, step),
          sill:
            ornament.type === "Carved post" ? 350 : snap(wall.z - grab.z, step),
        },
      },
    };
  }
  let closest: { draft: OrnamentAnchor; distance: number } | null = null,
    reason = "Tap a supported exposed Gable roof or gable end.";
  for (const roofFeatureId of [
    null,
    ...s.exterior.roofFeatures.map((f) => f.id),
  ])
    for (const end of ["Negative", "Positive"] as const) {
      try {
        const zero = {
          ...ornament,
          anchor: { kind: "roof" as const, roofFeatureId, end, offset: 0 },
        };
        // Resolve structural support only; collision validation follows on the candidate.
        const frame = resolveOrnament(
          b,
          s,
          zero,
          context.roofAt,
          context.opening,
        );
        const fixed =
          ornament.type === "Gable panel" || ornament.type === "Bargeboard";
        const inward =
          (frame.origin.x - hit.point.x) * frame.u.x +
          (frame.origin.y - hit.point.y) * frame.u.y;
        const offset = fixed
          ? 0
          : Math.max(0, Math.min(1000, frame.span / 4, snap(inward, step)));
        const p = {
          x: frame.origin.x - frame.u.x * offset,
          y: frame.origin.y - frame.u.y * offset,
        };
        const distance = Math.hypot(
          p.x - hit.point.x,
          p.y - hit.point.y,
          (frame.origin.z - hit.point.z) * 0.35,
        );
        if (distance > Math.max(2000, frame.width / 2 + 1200)) continue;
        if (!closest || distance < closest.distance)
          closest = {
            draft: {
              sectionId: s.id,
              ornament: { ...zero, anchor: { ...zero.anchor, offset } },
            },
            distance,
          };
      } catch (e) {
        reason = (e as Error).message;
      }
    }
  if (!closest) throw new Error(reason);
  return closest.draft;
}
