import { validateOrnamentation } from "./ornamentation";
import { validateRoofFeatures } from "./roofFeatures";
/** Exact model validation; no Three.js dependency. Windows never enter circulation. */
import type { Building, Section } from "./model";
import type { ExteriorWindow, ExteriorFeature } from "./exteriorSettings";
import {
  readExterior,
  ridgeAlongX,
  maximumRoofSlope,
} from "./exteriorSettings";
import { openingContext, canonicalVertices } from "./assembly";
import {
  openingGeometry,
  reanchorOpenings,
  validateOpenings,
  onExterior,
  rectOverlap,
  touchesRing,
  type Opening,
} from "./openings";
import { rotate, footprintVertices } from "./geometry";
import { bounds } from "./polygon";
import { containsPoint } from "./interior";
export const windowOpening = (s: Section, w: ExteriorWindow): Opening => ({
  id: w.id,
  host: { kind: "exterior", sectionId: s.id, edge: w.edge },
  offset: w.offset,
  width: w.width,
  type: "passage",
});
export function featurePoint(
  b: Building,
  s: Section,
  f: Pick<ExteriorFeature, "x" | "y">,
) {
  const p = rotate(f, s.orientation - b.frame.axis);
  return {
    x: p.x + s.position.x - b.frame.origin.x,
    y: p.y + s.position.y - b.frame.origin.y,
  };
}
export function validateExterior(b: Building) {
  for (const s of b.sections) readExterior(s.exterior);
  validateRoofFeatures(b);
  validateOrnamentation(b);
  const ids = [
    b.id,
    ...b.sections.map((s) => s.id),
    ...b.connections.map((c) => c.id),
    ...b.openings.map((o) => o.id),
    ...b.interior.partitions.map((w) => w.id),
    ...b.interior.rooms.map((r) => r.id),
    ...b.sections.flatMap((s) =>
      [
        ...s.exterior.windows,
        ...s.exterior.features,
        ...s.exterior.roofFeatures,
        ...s.exterior.ornamentation.items,
      ].map((f) => f.id),
    ),
  ];
  if (new Set(ids).size !== ids.length)
    throw new Error(
      "All building, window and architectural feature IDs must be distinct.",
    );
  if (
    !b.sections.some(
      (s) => s.exterior.windows.length || s.exterior.features.length,
    )
  )
    return;
  const c = openingContext(b);
  const canopies: { x: number; y: number; width: number; height: number }[] =
    [];
  const all = b.sections.flatMap((s) =>
    s.exterior.windows.map((w) => windowOpening(s, w)),
  );
  // Same horizontal clearance and true external-host constraints as doors. Vertical
  // stacking is deliberately unsupported: clear facade bays are reserved per opening.
  if (all.length) validateOpenings(c, [...b.openings, ...all]);
  for (const s of b.sections) {
    for (const w of s.exterior.windows) {
      const roofClearance = Math.max(
        250,
        175 + maximumRoofSlope(s) * (w.shutters ? 200 : 115),
      );
      if (w.sill + w.height > s.exterior.wallHeight - roofClearance)
        throw new Error(
          "Window frame/shutters would intersect the roof underside. Lower the sill, reduce the height or reduce roof pitch. A conservative eaves clearance is required.",
        );
      const aperture = windowOpening(s, w),
        bay = {
          ...aperture,
          width: w.width + (w.shutters ? w.width + 200 : 160),
        };
      const g = openingGeometry(c, bay);
      if (
        bay.offset - bay.width / 2 < 100 ||
        bay.offset + bay.width / 2 > g.length - 100 ||
        !onExterior(c, bay)
      )
        throw new Error(
          "Window frame/shutters need a fully exposed wall bay with 0.1 m corner/end clearance. Move the window, reduce its width or disable shutters.",
        );
      for (const other of [
        ...b.openings,
        ...b.sections.flatMap((t) =>
          t.exterior.windows.map((v) => ({
            ...windowOpening(t, v),
            width: v.width + (v.shutters ? v.width + 200 : 160),
          })),
        ),
      ]) {
        if (other.id === w.id) continue;
        const gap = openingGeometry(c, other).gap;
        if (
          rectOverlap(
            {
              x: g.gap.x - 100,
              y: g.gap.y - 100,
              width: g.gap.width + 200,
              height: g.gap.height + 200,
            },
            gap,
          )
        )
          throw new Error(
            "Window frame/shutters overlap a door or another window bay. Leave 0.1 m clearance.",
          );
      }
      if (
        w.width < 400 ||
        w.width > 2400 ||
        w.height < 300 ||
        w.height > 2200 ||
        w.sill < 500 ||
        w.sill + w.height > s.exterior.wallHeight - 250
      )
        throw new Error(
          "Window requires width 0.4–2.4 m, height 0.3–2.2 m, sill ≥0.5 m and 0.25 m below the eaves.",
        );
    }
    const chimneys = s.exterior.features.filter((f) => f.kind === "Chimney");
    if (chimneys.length > 2)
      throw new Error("At most two chimneys per section.");
    for (const f of s.exterior.features) {
      if (f.height < 500 || f.height > 2000)
        throw new Error("Feature height must be 0.5–2 m.");
      if (s.kind !== "rectangle")
        throw new Error(
          "Architectural features currently require a rectangular section; windows support all valid exterior walls.",
        );
      const box = bounds(footprintVertices(s));
      if (f.kind === "Chimney") {
        if (
          f.x < box.minX + 800 ||
          f.x > box.maxX - 800 ||
          f.y < box.minY + 800 ||
          f.y > box.maxY - 800
        )
          throw new Error(
            "Chimney needs 0.8 m clearance inside the section perimeter.",
          );
        const p = featurePoint(b, s, f);
        // Avoid junctions, unsupported overhangs and competing roof domains.
        if (
          !containsPoint(c.inner, p) ||
          b.sections.some(
            (t) =>
              t.id !== s.id &&
              canonicalVertices(t, b).some(
                (q) => Math.hypot(q.x - p.x, q.y - p.y) < 1000,
              ),
          )
        )
          throw new Error(
            "Chimney is too close to a roof junction or invalid interior.",
          );
        if (
          chimneys.some(
            (t) => t.id !== f.id && Math.hypot(t.x - f.x, t.y - f.y) < 1000,
          )
        )
          throw new Error("Chimneys need at least 1 m separation.");
      } else if (f.kind === "Gable ornament") {
        if (s.exterior.roofStyle !== "Gable")
          throw new Error("Gable ornament requires a rectangular gable roof.");
        const longX = ridgeAlongX(s);
        for (const sign of [-1, 1]) {
          const p = featurePoint(b, s, {
            x: longX
              ? sign < 0
                ? box.minX
                : box.maxX
              : (box.minX + box.maxX) / 2,
            y: longX
              ? (box.minY + box.maxY) / 2
              : sign < 0
                ? box.minY
                : box.maxY,
          });
          if (
            !c.outer.some((a, i) => {
              const z = c.outer[(i + 1) % c.outer.length];
              return (
                (a.x === z.x &&
                  p.x === a.x &&
                  p.y >= Math.min(a.y, z.y) &&
                  p.y <= Math.max(a.y, z.y)) ||
                (a.y === z.y &&
                  p.y === a.y &&
                  p.x >= Math.min(a.x, z.x) &&
                  p.x <= Math.max(a.x, z.x))
              );
            })
          )
            throw new Error(
              "Gable ornament requires both gable ends to remain on the true external boundary.",
            );
        }
        if (s.exterior.features.filter((t) => t.kind === f.kind).length > 1)
          throw new Error("Only one paired gable ornament per section.");
      } else {
        if (s.exterior.wallHeight < 3100)
          throw new Error("Entrance canopy needs eaves at least 3.1 m high.");
        const reach = Math.min(900, s.exterior.overhang),
          slope = maximumRoofSlope(s);
        if (
          s.exterior.wallHeight -
            120 -
            slope * reach -
            (2850 - (400 * reach) / 900) <
          100
        )
          throw new Error(
            "Canopy lacks clearance below the roof overhang. Raise the eaves or reduce pitch/overhang.",
          );
        const door = b.openings.find(
          (o) =>
            o.id === f.doorId &&
            o.host.kind === "exterior" &&
            o.host.sectionId === s.id,
        );
        if (!door)
          throw new Error(
            "Entrance canopy requires an existing exterior door on this section.",
          );
        const g = openingGeometry(c, door),
          outward = { x: -g.host.inward!.x, y: -g.host.inward!.y };
        if (
          s.exterior.windows.some(
            (w) =>
              w.edge ===
                (door.host.kind === "exterior" ? door.host.edge : -1) &&
              Math.abs(w.offset - door.offset) <
                (w.width + door.width) / 2 + 350 &&
              w.sill < 3000 &&
              w.sill + w.height > 2300,
          )
        )
          throw new Error("Canopy conflicts with a window above the entrance.");
        if (
          door.offset - door.width / 2 < 350 ||
          door.offset + door.width / 2 > g.length - 350
        )
          throw new Error("Canopy needs 0.35 m clearance from wall endpoints.");
        for (const t of [-door.width / 2 - 250, door.width / 2 + 250]) {
          const p = {
            x: g.center.x + g.u.x * t + outward.x * 900,
            y: g.center.y + g.u.y * t + outward.y * 900,
          };
          if (containsPoint(c.outer, p))
            throw new Error("Canopy would intersect another building wing.");
        }
        const corners = [-door.width / 2 - 250, door.width / 2 + 250].flatMap(
          (t) =>
            [1, 900].map((d) => ({
              x: g.host.a.x + g.u.x * (door.offset + t) + outward.x * d,
              y: g.host.a.y + g.u.y * (door.offset + t) + outward.y * d,
            })),
        );
        const minX = Math.min(...corners.map((p) => p.x)),
          minY = Math.min(...corners.map((p) => p.y));
        const canopyBox = {
          x: minX,
          y: minY,
          width: Math.max(...corners.map((p) => p.x)) - minX,
          height: Math.max(...corners.map((p) => p.y)) - minY,
        };
        if (
          canopies.some((other) =>
            rectOverlap(
              {
                ...canopyBox,
                x: canopyBox.x - 100,
                y: canopyBox.y - 100,
                width: canopyBox.width + 200,
                height: canopyBox.height + 200,
              },
              other,
            ),
          )
        )
          throw new Error("Entrance canopies overlap or lack 0.1 m clearance.");
        canopies.push(canopyBox);
        if (touchesRing(canopyBox, c.outer))
          throw new Error(
            "Canopy would intersect an exterior wall or another wing.",
          );
        if (
          s.exterior.features.some(
            (t) =>
              t.id !== f.id &&
              t.kind === "Entrance canopy" &&
              t.doorId === f.doorId,
          )
        )
          throw new Error("This entrance already has a canopy.");
      }
    }
  }
}
export function reanchorExterior(before: Building, after: Building) {
  if (
    !after.sections.some(
      (s) =>
        s.exterior.windows.length ||
        s.exterior.ornamentation.items.some((o) => o.anchor.kind === "wall"),
    )
  )
    return after;
  const old = openingContext(before),
    next = openingContext(after);
  return {
    ...after,
    sections: after.sections.map((s) => {
      const prior = before.sections.find((t) => t.id === s.id);
      if (!prior) return s;
      const windows = s.exterior.windows.map((w) => {
        if (!prior.exterior.windows.some((t) => t.id === w.id)) return w;
        const [o] = reanchorOpenings(old, next, [windowOpening(prior, w)]);
        return { ...w, offset: o.offset };
      });
      const items = s.exterior.ornamentation.items.map((o) => {
        const previous = prior.exterior.ornamentation.items.find(
          (t) => t.id === o.id,
        );
        if (
          o.anchor.kind !== "wall" ||
          previous?.anchor.kind !== "wall" ||
          o.anchor.edge !== previous.anchor.edge
        )
          return o;
        const fake = {
          id: o.id,
          host: {
            kind: "exterior" as const,
            sectionId: s.id,
            edge: o.anchor.edge,
          },
          offset: o.anchor.offset,
          width: 400,
          type: "passage" as const,
        };
        const [anchored] = reanchorOpenings(old, next, [fake]);
        return { ...o, anchor: { ...o.anchor, offset: anchored.offset } };
      });
      return {
        ...s,
        exterior: {
          ...s.exterior,
          windows,
          ornamentation: { ...s.exterior.ornamentation, items },
        },
      };
    }),
  };
}
