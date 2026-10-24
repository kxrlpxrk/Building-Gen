/** Canonical architectural ornaments and exact attachment validation. No Three.js. */
import type { Building, Section } from "./model";
import { ridgeAlongX } from "./exteriorSettings";
import {
  canonicalVertices,
  combinedGeometry,
  openingContext,
} from "./assembly";
import { crossRoofFields } from "./roofFeatures";
import { roofPlanes } from "./roofFields";
import {
  roofSurface,
  intersectionDomains,
  fieldHeight,
  onRing,
  profileBreaks,
  type RoofDomain,
} from "./roofSurface";
import { rotate, type Point } from "./geometry";
import {
  openingGeometry,
  onExterior,
  touchesRing,
  type OpeningContext,
} from "./openings";
import { windowOpening } from "./exteriorValidation";
export const ORNAMENT_LEVELS = ["None", "Subtle", "Ornate", "Fantasy"] as const;
export const ORNAMENT_TYPES = [
  "Dragon head",
  "Gable finial",
  "Carved post",
  "Entrance pillars",
  "Knotwork panel",
  "Gable panel",
  "Bargeboard",
  "Ridge trim",
  "Shield",
  "Carved brace",
  "Beam ends",
] as const;
export const ORNAMENT_FINISHES = [
  "Oiled wood",
  "Dark wood",
  "Ochre",
  "Weathered wood",
] as const;
export type OrnamentLevel = (typeof ORNAMENT_LEVELS)[number];
export type OrnamentAnchor =
  | {
      kind: "roof";
      roofFeatureId: string | null;
      end: "Negative" | "Positive";
      offset: number;
    }
  | { kind: "wall"; edge: number; offset: number; sill: number }
  | { kind: "entrance"; doorId: string };
export type Ornament = {
  id: string;
  type: (typeof ORNAMENT_TYPES)[number];
  anchor: OrnamentAnchor;
  variant: 1 | 2 | 3;
  scale: number;
  mirror: boolean;
  finish: (typeof ORNAMENT_FINISHES)[number];
};
export type Ornamentation = { level: OrnamentLevel; items: Ornament[] };
export const emptyOrnamentation = (): Ornamentation => ({
  level: "None",
  items: [],
});
export function readOrnamentation(value: unknown): Ornamentation {
  const v = value as Ornamentation,
    id = (s: unknown) =>
      typeof s === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(s),
    int = Number.isSafeInteger;
  if (
    !v ||
    !ORNAMENT_LEVELS.includes(v.level) ||
    !Array.isArray(v.items) ||
    v.items.length > 12
  )
    throw new Error(
      "Invalid ornamentation level or collection (maximum 12 per section).",
    );
  const items = v.items.map((o) => {
    if (
      !o ||
      !id(o.id) ||
      !ORNAMENT_TYPES.includes(o.type) ||
      ![1, 2, 3].includes(o.variant) ||
      !int(o.scale) ||
      o.scale < 600 ||
      o.scale > 1500 ||
      typeof o.mirror !== "boolean" ||
      !ORNAMENT_FINISHES.includes(o.finish) ||
      !o.anchor
    )
      throw new Error(
        "Invalid ornament: choose a type, variant 1–3, scale 60–150% and a supported finish.",
      );
    const a = o.anchor;
    let anchor: OrnamentAnchor;
    if (
      a.kind === "roof" &&
      (a.roofFeatureId === null || id(a.roofFeatureId)) &&
      ["Negative", "Positive"].includes(a.end) &&
      int(a.offset)
    )
      anchor = {
        kind: a.kind,
        roofFeatureId: a.roofFeatureId,
        end: a.end,
        offset: a.offset,
      };
    else if (
      a.kind === "wall" &&
      int(a.edge) &&
      a.edge >= 0 &&
      int(a.offset) &&
      int(a.sill)
    )
      anchor = { kind: a.kind, edge: a.edge, offset: a.offset, sill: a.sill };
    else if (a.kind === "entrance" && id(a.doorId))
      anchor = { kind: a.kind, doorId: a.doorId };
    else throw new Error("Invalid ornament anchor.");
    return {
      id: o.id,
      type: o.type,
      anchor,
      variant: o.variant,
      scale: o.scale,
      mirror: o.mirror,
      finish: o.finish,
    };
  });
  return { level: v.level, items };
}
export function ornamentRoofSurface(b: Building) {
  const rings = b.sections.map((s) => canonicalVertices(s, b)),
    planes = b.sections.map((s) => roofPlanes(s, b));
  const domains: RoofDomain[] = rings.map((polygon, owner) => ({
    polygon,
    owner,
    kind: "section",
  }));
  domains.push(
    ...intersectionDomains(
      rings,
      planes,
      b.sections.map((s) => s.kind === "rectangle"),
      combinedGeometry(b).contacts,
      b.sections.map((s) => s.id),
      combinedGeometry(b).vertices,
    ).domains,
  );
  for (const s of b.sections)
    for (const f of crossRoofFields(s, b)) {
      const owner = planes.length;
      planes.push(f.planes);
      domains.push({ polygon: f.domain, owner, kind: "intersection" });
    }
  return roofSurface(planes, domains).at;
}
export type OrnamentFrame = {
  origin: { x: number; y: number; z: number };
  u: Point;
  v: Point;
  size: number;
  width: number;
  height: number;
  span: number;
  slope: number;
};
const roofTypes = new Set<Ornament["type"]>([
  "Dragon head",
  "Gable finial",
  "Gable panel",
  "Bargeboard",
  "Ridge trim",
]);
export const isRoofOrnament = (type: Ornament["type"]) => roofTypes.has(type);
export function resolveOrnament(
  b: Building,
  s: Section,
  o: Ornament,
  roofAt: (p: Point) => number,
  opening?: OpeningContext,
): OrnamentFrame {
  const a = o.anchor,
    scale = o.scale / 1000;
  if (a.kind === "roof") {
    if (
      !isRoofOrnament(o.type) ||
      s.kind !== "rectangle" ||
      s.exterior.roofStyle !== "Gable"
    )
      throw new Error(
        "Roof ornaments require a rectangular Gable roof and a roof ornament type.",
      );
    const f =
      a.roofFeatureId === null
        ? null
        : s.exterior.roofFeatures.find((f) => f.id === a.roofFeatureId);
    if (a.roofFeatureId && !f)
      throw new Error(
        "Ornament roof-feature anchor is missing. Remove or relocate its ornaments explicitly first.",
      );
    if (f && f.side !== "Both" && f.side !== a.end)
      throw new Error(
        "Ornament needs an exposed cross-gable end, not an internal roof cutoff.",
      );
    const x = f ? f.ridgeAxis === "X" : ridgeAlongX(s),
      span = x ? s.length : s.width,
      width = f ? f.width : x ? s.width : s.length;
    if (
      a.offset < 0 ||
      a.offset > Math.min(1000, span / 4) ||
      (["Gable panel", "Bargeboard"].includes(o.type) && a.offset !== 0)
    )
      throw new Error(
        "Ridge ornaments allow 0–1 m inboard offset; facade gable panels/bargeboards must stay at offset zero.",
      );
    const along = a.end === "Negative" ? 0 : span,
      across = f ? f.offset : (x ? s.width : s.length) / 2,
      sign = a.end === "Negative" ? -1 : 1;
    const local = (t: number, q: number) =>
        x ? { x: t, y: q } : { x: q, y: t },
      angle = s.orientation - b.frame.axis;
    const world = (p: Point) => {
      const q = rotate(p, angle);
      return {
        x: q.x + s.position.x - b.frame.origin.x,
        y: q.y + s.position.y - b.frame.origin.y,
      };
    };
    const end = world(local(along, across)),
      u = rotate(x ? { x: sign, y: 0 } : { x: 0, y: sign }, angle),
      v = { x: -u.y, y: u.x };
    const outer = combinedGeometry(b).vertices,
      half =
        o.type === "Bargeboard"
          ? width / 2
          : Math.max(300, Math.min(width * 0.2, 650 * scale));
    const ends = [-half, half].map((d) => world(local(along, across + d)));
    if (
      !outer.some((p, i) =>
        ends.every((q) => onRing([p, outer[(i + 1) % outer.length]], q)),
      )
    )
      throw new Error(
        "Gable ornament needs an exposed supported facade; open-plan joins cannot host it.",
      );
    const p = { x: end.x - u.x * a.offset, y: end.y - u.y * a.offset };
    const own = f
        ? crossRoofFields(s, b).find((g) => g.feature.id === f.id)!.planes
        : roofPlanes(s, b),
      z = fieldHeight(own, p);
    const size = (Math.min(1100, width * 0.13) / 1000) * scale;
    const reach =
      o.type === "Ridge trim"
        ? Math.min(3000 * size, span * 0.3)
        : o.type === "Dragon head" && o.mirror
          ? 1700 * size
          : 500 * size;
    const endSupport = { x: p.x - u.x * reach, y: p.y - u.y * reach };
    const sets = b.sections.flatMap((t) => [
      roofPlanes(t, b),
      ...crossRoofFields(t, b).map((f) => f.planes),
    ]);
    const cuts = profileBreaks(p, endSupport, sets);
    for (const q of b.sections.flatMap((t) => [
      ...canonicalVertices(t, b),
      ...crossRoofFields(t, b).flatMap((f) => f.domain),
    ])) {
      const t =
        Math.abs(endSupport.x - p.x) > 1e-6
          ? (q.x - p.x) / (endSupport.x - p.x)
          : (q.y - p.y) / (endSupport.y - p.y);
      if (t > 0 && t < 1) cuts.push(t);
    }
    cuts.sort((a, z) => a - z);
    for (const t of [
      ...cuts,
      ...cuts.slice(0, -1).map((t, i) => (t + cuts[i + 1]) / 2),
    ]) {
      const q = {
        x: p.x + (endSupport.x - p.x) * t,
        y: p.y + (endSupport.y - p.y) * t,
      };
      if (Math.abs(roofAt(q) - fieldHeight(own, q)) > 2)
        throw new Error(
          "Roof ornament support is covered by another roof or crosses a junction. Relocate/remove it explicitly.",
        );
    }
    if (
      a.roofFeatureId === null &&
      ["Dragon head", "Gable finial"].includes(o.type) &&
      s.exterior.features.some((f) => f.kind === "Gable ornament") &&
      a.offset < 600
    )
      throw new Error(
        "Retain the legacy paired gable ornament: inset the new terminal at least 0.6 m, or explicitly remove the old feature.",
      );
    for (const chimney of s.exterior.features.filter(
      (f) => f.kind === "Chimney",
    )) {
      const q = world(chimney),
        d = { x: q.x - p.x, y: q.y - p.y };
      const along = d.x * u.x + d.y * u.y,
        across = Math.abs(d.x * v.x + d.y * v.y);
      const reach =
        o.type === "Ridge trim"
          ? Math.min(3000 * size, span * 0.3)
          : 500 * size;
      if (
        along >= -reach - 600 &&
        along <= 1700 * size &&
        across < 600 + 250 * size
      )
        throw new Error(
          "Roof decoration conflicts with a chimney clearance. Move or remove the ornament explicitly.",
        );
    }
    return {
      origin: { ...p, z },
      u,
      v,
      size,
      width,
      height: f
        ? s.exterior.wallHeight + f.relativeHeight
        : s.exterior.wallHeight,
      span,
      slope: Math.tan(((f ? f.pitch : s.exterior.roofPitch) * Math.PI) / 180),
    };
  }
  if (isRoofOrnament(o.type))
    throw new Error("Choose a supported roof anchor for this ornament.");
  if (o.type === "Entrance pillars" && a.kind !== "entrance")
    throw new Error("Entrance pillars require an existing exterior entrance.");
  if (o.type !== "Entrance pillars" && a.kind !== "wall")
    throw new Error("Wall ornaments require an exposed wall bay.");
  const c = opening ?? openingContext(b);
  let edge: number, offset: number, sill: number, width: number, height: number;
  if (a.kind === "entrance") {
    const door = b.openings.find(
      (d) =>
        d.id === a.doorId &&
        d.type === "exterior-door" &&
        d.host.kind === "exterior" &&
        d.host.sectionId === s.id,
    );
    if (!door || door.host.kind !== "exterior")
      throw new Error(
        "Entrance ornament anchor is missing. Remove or relocate decorations before removing its door.",
      );
    if (s.exterior.wallHeight < 3000)
      throw new Error("Carved entrance pillars need eaves at least 3 m high.");
    edge = door.host.edge;
    offset = door.offset;
    sill = 300;
    width = door.width + 700 * scale;
    height = 2500;
  } else {
    edge = a.edge;
    offset = a.offset;
    sill = a.sill;
    width = (o.type === "Carved post" ? 300 : 1000) * scale;
    height =
      o.type === "Carved post" ? s.exterior.wallHeight - 700 : 1000 * scale;
    if (o.type === "Carved post" && sill !== 350)
      throw new Error("Support posts start at the 0.35 m foundation band.");
  }
  const fake = {
      id: o.id,
      host: { kind: "exterior" as const, sectionId: s.id, edge },
      offset,
      width,
      type: "passage" as const,
    },
    g = openingGeometry(c, fake);
  if (
    offset - width / 2 < 150 ||
    offset + width / 2 > g.length - 150 ||
    !onExterior(c, fake) ||
    sill < 300 ||
    sill + height > s.exterior.wallHeight - 200
  )
    throw new Error(
      "Ornament needs a fully exposed wall bay, 0.15 m end clearance and 0.2 m roof clearance.",
    );
  for (const other of [
    ...b.openings,
    ...b.sections.flatMap((t) =>
      t.exterior.windows.map((w) => ({
        ...windowOpening(t, w),
        width: w.width + (w.shutters ? w.width + 200 : 160),
      })),
    ),
  ]) {
    if (a.kind === "entrance" && other.id === a.doorId) continue;
    const h = openingGeometry(c, other),
      zlo =
        "hinge" in other
          ? 0
          : (b.sections
              .flatMap((t) => t.exterior.windows)
              .find((w) => w.id === other.id)?.sill ?? 0),
      zhi =
        "hinge" in other
          ? 2300
          : zlo +
            (b.sections
              .flatMap((t) => t.exterior.windows)
              .find((w) => w.id === other.id)?.height ?? 2300);
    // Parallel exposed faces only: compare their physical reserved bays and height.
    if (
      sill < zhi + 100 &&
      sill + height > zlo - 100 &&
      Math.abs(g.u.x * h.u.y - g.u.y * h.u.x) < 0.001 &&
      Math.abs(
        (h.center.x - g.center.x) * g.n.x + (h.center.y - g.center.y) * g.n.y,
      ) < 350 &&
      Math.abs(
        (h.center.x - g.center.x) * g.u.x + (h.center.y - g.center.y) * g.u.y,
      ) <
        (width + other.width) / 2 + 150
    )
      throw new Error(
        "Decoration overlaps a door/window bay. Choose a clear wall position.",
      );
  }
  const outward = { x: -g.host.inward!.x, y: -g.host.inward!.y },
    center = { x: g.host.a.x + g.u.x * offset, y: g.host.a.y + g.u.y * offset };
  const reach =
    (o.type === "Beam ends"
      ? 750
      : o.type === "Shield"
        ? 300
        : o.type === "Entrance pillars"
          ? 350
          : 250) * scale;
  const corners = [-width / 2, width / 2].flatMap((t) =>
    [1, reach].map((d) => ({
      x: center.x + g.u.x * t + outward.x * d,
      y: center.y + g.u.y * t + outward.y * d,
    })),
  );
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y));
  if (
    touchesRing(
      {
        x,
        y,
        width: Math.max(...corners.map((p) => p.x)) - x,
        height: Math.max(...corners.map((p) => p.y)) - y,
      },
      c.outer,
    )
  )
    throw new Error(
      "The decoration would intersect another building wing. Choose a clearer exposed bay.",
    );
  return {
    origin: { ...center, z: sill },
    u: g.u,
    v: outward,
    size: scale,
    width,
    height,
    span: g.length,
    slope: 0,
  };
}
export function validateOrnamentation(
  b: Building,
  cache?: { roofAt: (p: Point) => number; opening: OpeningContext },
) {
  const items = b.sections.flatMap((s) =>
    s.exterior.ornamentation.items.map((o) => ({ s, o })),
  );
  if (items.length > 48) throw new Error("Building ornament limit: 48.");
  if (!items.length) return;
  const roofAt = cache?.roofAt ?? ornamentRoofSurface(b),
    opening = cache?.opening ?? openingContext(b),
    frames = items.map(({ s, o }) => resolveOrnament(b, s, o, roofAt, opening));
  for (let i = 0; i < items.length; i++)
    for (let j = 0; j < i; j++) {
      const a = items[i].o,
        z = items[j].o,
        f = frames[i],
        g = frames[j];
      if (
        ["Dragon head", "Gable finial"].includes(a.type) &&
        ["Dragon head", "Gable finial"].includes(z.type) &&
        Math.hypot(f.origin.x - g.origin.x, f.origin.y - g.origin.y) <
          1400 * (f.size + g.size) &&
        Math.abs(f.origin.z - g.origin.z) < 1700 * Math.max(f.size, g.size)
      )
        throw new Error(
          "Ridge terminal motifs are too close to one another. Use separate clear roof ends.",
        );
      if (items[i].s.id !== items[j].s.id) continue;
      if (a.anchor.kind === "roof" && z.anchor.kind === "roof") {
        if (
          a.anchor.roofFeatureId === z.anchor.roofFeatureId &&
          a.anchor.end === z.anchor.end &&
          ((["Dragon head", "Gable finial"].includes(a.type) &&
            ["Dragon head", "Gable finial"].includes(z.type)) ||
            a.type === z.type)
        )
          throw new Error(
            "This roof anchor already has that ornament or a terminal motif.",
          );
      } else if (
        a.anchor.kind !== "roof" &&
        z.anchor.kind !== "roof" &&
        Math.abs(f.u.x * g.u.y - f.u.y * g.u.x) < 0.001 &&
        Math.abs(
          (g.origin.x - f.origin.x) * f.v.x + (g.origin.y - f.origin.y) * f.v.y,
        ) < 300 &&
        Math.abs(
          (g.origin.x - f.origin.x) * f.u.x + (g.origin.y - f.origin.y) * f.u.y,
        ) <
          (f.width + g.width) / 2 + 100 &&
        f.origin.z < g.origin.z + g.height + 50 &&
        f.origin.z + f.height > g.origin.z - 50
      )
        throw new Error("Architectural decorations need separate wall bays.");
    }
}
export function suggestedOrnament(
  b: Building,
  s: Section,
  type: Ornament["type"],
  id = crypto.randomUUID() as string,
): Ornament {
  return {
    id,
    type,
    anchor: isRoofOrnament(type)
      ? { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 }
      : type === "Entrance pillars"
        ? {
            kind: "entrance",
            doorId:
              b.openings.find(
                (d) =>
                  d.type === "exterior-door" &&
                  d.host.kind === "exterior" &&
                  d.host.sectionId === s.id,
              )?.id ?? "missing-entrance",
          }
        : {
            kind: "wall",
            edge: 0,
            offset: 2000,
            sill: type === "Carved post" ? 350 : 1200,
          },
    variant: 1,
    scale: 1000,
    mirror: false,
    finish: "Oiled wood",
  };
}
/** Bounded explicit preset proposal. Omitted optional anchors are reported, never faked. */
export function ornamentPreset(b: Building, s: Section, level: OrnamentLevel) {
  const items: Ornament[] = [],
    messages: string[] = [];
  if (level === "None") return { ornamentation: { level, items }, messages };
  const supports = {
    roofAt: ornamentRoofSurface(b),
    opening: openingContext(b),
  };
  const append = (o: Ornament) => {
    try {
      const next = {
        ...b,
        sections: b.sections.map((t) =>
          t.id === s.id
            ? {
                ...t,
                exterior: {
                  ...t.exterior,
                  ornamentation: { level, items: [...items, o] },
                },
              }
            : t,
        ),
      };
      validateOrnamentation(next, supports);
      items.push(o);
      return true;
    } catch {
      return false;
    }
  };
  const roof =
    level === "Subtle" ||
    s.exterior.material === "Medieval" ||
    s.exterior.stylePreset.startsWith("Medieval")
      ? "Gable finial"
      : "Dragon head";
  for (const end of ["Negative", "Positive"] as const) {
    const o = suggestedOrnament(b, s, roof);
    o.anchor = {
      kind: "roof",
      roofFeatureId: null,
      end,
      offset: s.exterior.features.some((f) => f.kind === "Gable ornament")
        ? 600
        : 0,
    };
    o.scale = level === "Fantasy" ? 1250 : level === "Subtle" ? 750 : 1000;
    o.variant = level === "Fantasy" ? 3 : level === "Ornate" ? 2 : 1;
    if (!append(o))
      messages.push(
        `${roof} at ${end.toLowerCase()} main gable omitted: no exposed compatible support.`,
      );
  }
  if (level !== "Subtle") {
    for (const end of ["Negative", "Positive"] as const) {
      const o = suggestedOrnament(b, s, "Bargeboard");
      o.anchor = { kind: "roof", roofFeatureId: null, end, offset: 0 };
      o.variant = level === "Fantasy" ? 3 : 2;
      append(o);
    }
    const entrance = suggestedOrnament(b, s, "Entrance pillars");
    if (!append(entrance))
      messages.push("Entrance pillars omitted: no compatible entrance bay.");
  }
  if (level !== "Subtle") {
    for (const end of (level === "Fantasy"
      ? ["Negative", "Positive"]
      : ["Negative"]) as ("Negative" | "Positive")[]) {
      const panel = suggestedOrnament(b, s, "Gable panel");
      panel.anchor = { kind: "roof", roofFeatureId: null, end, offset: 0 };
      if (!append(panel))
        messages.push(
          `Gable panel at ${end} omitted: no clear supported gable.`,
        );
    }
    const trim = suggestedOrnament(b, s, "Ridge trim");
    if (!append(trim))
      messages.push("Ridge trim omitted: roof or feature clearance.");
  }
  const types: Ornament["type"][] =
    level === "Subtle"
      ? ["Carved post"]
      : level === "Fantasy"
        ? ["Carved post", "Knotwork panel", "Shield", "Carved brace"]
        : ["Carved post", "Knotwork panel", "Shield"];
  for (const type of types) {
    let placed = false,
      attempts = 0;
    const hosts = openingContext(b).hosts.filter(
      (h) => h.ref.kind === "exterior" && h.ref.sectionId === s.id,
    );
    for (const h of hosts) {
      if (placed) break;
      const length = Math.abs(h.a.x - h.b.x) + Math.abs(h.a.y - h.b.y);
      for (let t = 1000; t < length - 500 && attempts++ < 64; t += 1500) {
        const o = suggestedOrnament(b, s, type);
        o.anchor = {
          kind: "wall",
          edge: h.ref.kind === "exterior" ? h.ref.edge : 0,
          offset: t,
          sill: type === "Carved post" ? 350 : 1100,
        };
        o.variant = level === "Fantasy" ? 3 : 1;
        if (append(o)) {
          placed = true;
          break;
        }
      }
    }
    if (!placed) messages.push(`${type} omitted: no clear wall bay.`);
  }
  return { ornamentation: { level, items }, messages };
}
