import { validateExterior, reanchorExterior } from "./exteriorValidation";
import {
  validateOpenings,
  reanchorOpenings,
  type OpeningContext,
  type HostSegment,
} from "./openings";
import { deriveInterior } from "./interior";
import { reconcileInterior, validateInterior } from "./interior";
import {
  footprintVertices,
  rotate,
  validateFootprint,
  type Point,
  type Footprint,
} from "./geometry";
import type { Building, Connection, Section } from "./model";
import { bounds, insetPolygon, polygonArea, signedArea } from "./polygon";
import { orthogonalUnion } from "./orthogonalUnion";
export const SECTION_LIMIT = 12;
export const SECTION_TYPES = [
  "Residential Wing",
  "Workshop",
  "Storage",
  "Porch",
  "Hall Extension",
  "Tower Footprint",
  "Custom",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];
const angle = (a: number) => ((a % 360) + 360) % 360;
export function canonicalVertices(s: Section, b: Building): Point[] {
  const relative = angle(s.orientation - b.frame.axis);
  const turns = Math.round(relative / 90);
  if (Math.abs(relative / 90 - turns) > Number.EPSILON * 16)
    throw new Error(
      "Joined sections must have compatible orientations (quarter turns in the building axes).",
    );
  return footprintVertices(s).map((p) => {
    const q = rotate(p, (turns % 4) * 90);
    return {
      x: Math.round(q.x) + s.position.x - b.frame.origin.x,
      y: Math.round(q.y) + s.position.y - b.frame.origin.y,
    };
  });
}
export function displaySection(s: Section, b: Building): Section {
  if (b.frame.mode === "legacy")
    return { ...s, orientation: angle(s.orientation + b.frame.rotation) };
  const offset = rotate(
    { x: s.position.x - b.frame.origin.x, y: s.position.y - b.frame.origin.y },
    b.frame.axis + b.frame.rotation,
  );
  return {
    ...s,
    position: {
      ...s.position,
      x: offset.x + b.frame.origin.x,
      y: offset.y + b.frame.origin.y,
    },
    orientation: angle(s.orientation + b.frame.rotation),
  };
}
export function storedSection(s: Section, b: Building): Section {
  if (b.frame.mode === "legacy")
    return {
      ...s,
      orientation: angle(s.orientation - b.frame.rotation),
      position: {
        ...s.position,
        x: Math.round(s.position.x),
        y: Math.round(s.position.y),
      },
    };
  const q = rotate(
    { x: s.position.x - b.frame.origin.x, y: s.position.y - b.frame.origin.y },
    -b.frame.axis - b.frame.rotation,
  );
  return {
    ...s,
    position: {
      ...s.position,
      x: Math.round(q.x + b.frame.origin.x),
      y: Math.round(q.y + b.frame.origin.y),
    },
    orientation: angle(s.orientation - b.frame.rotation),
  };
}
export function contacts(b: Building): Omit<Connection, "id">[] {
  const result: Omit<Connection, "id">[] = [];
  for (let i = 0; i < b.sections.length; i++)
    for (let j = i + 1; j < b.sections.length; j++) {
      const a = b.sections[i],
        c = b.sections[j],
        av = canonicalVertices(a, b),
        cv = canonicalVertices(c, b);
      av.forEach((p, ai) => {
        const q = av[(ai + 1) % av.length];
        cv.forEach((r, ci) => {
          const t = cv[(ci + 1) % cv.length];
          const vertical = p.x === q.x;
          if (
            vertical !== (r.x === t.x) ||
            (vertical ? p.x !== r.x : p.y !== r.y)
          )
            return;
          const axis = vertical ? "y" : "x",
            lo = Math.max(
              Math.min(p[axis], q[axis]),
              Math.min(r[axis], t[axis]),
            ),
            hi = Math.min(
              Math.max(p[axis], q[axis]),
              Math.max(r[axis], t[axis]),
            );
          if (hi - lo < 100) return;
          result.push({
            a: { sectionId: a.id, edge: ai },
            b: { sectionId: c.id, edge: ci },
            start: vertical ? { x: p.x, y: lo } : { x: lo, y: p.y },
            end: vertical ? { x: p.x, y: hi } : { x: hi, y: p.y },
            mode: "open-plan",
          });
        });
      });
    }
  return result;
}
export function combinedGeometry(b: Building) {
  if (!b.sections.length || b.sections.length > SECTION_LIMIT)
    throw new Error("Buildings require 1–12 sections.");
  const first = b.sections[0];
  for (const s of b.sections) {
    const error = validateFootprint(s);
    if (error) throw new Error(`${s.name}: ${error}`);
    if (s.wallThickness !== first.wallThickness)
      throw new Error(
        "All joined sections must use one common exterior wall thickness.",
      );
    if (s.position.z !== first.position.z)
      throw new Error("Sections must share the same ground-level elevation.");
  }
  if (b.frame.mode === "legacy") {
    if (b.sections.length !== 1)
      throw new Error("Legacy building frames support exactly one section.");
    const s = displaySection(first, b),
      vertices =
        signedArea(footprintVertices(s)) < 0
          ? [...footprintVertices(s)].reverse()
          : footprintVertices(s),
      inner = insetPolygon(vertices, s.wallThickness);
    return {
      vertices,
      inner,
      exterior: polygonArea(vertices) / 1e6,
      interior: polygonArea(inner) / 1e6,
      envelope: { ...s, vertices } as Footprint,
      contacts: [] as Omit<Connection, "id">[],
    };
  }
  const rings = b.sections.map((s) => canonicalVertices(s, b)),
    vertices = orthogonalUnion(rings),
    joins = contacts(b),
    seen = new Set([b.mainSectionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of joins)
      if (seen.has(c.a.sectionId) !== seen.has(c.b.sectionId)) {
        seen.add(c.a.sectionId);
        seen.add(c.b.sectionId);
        changed = true;
      }
  }
  if (seen.size !== b.sections.length)
    throw new Error(
      "Every section must connect through at least 0.1 m of shared edge; corner-only contact is not a connection.",
    );
  const inner = insetPolygon(vertices, first.wallThickness, 768, 2000000),
    box = bounds(vertices);
  const envelope: Footprint = {
    position: { ...b.frame.origin, z: first.position.z },
    orientation: angle(b.frame.axis + b.frame.rotation),
    length: box.length,
    width: box.width,
    wallThickness: first.wallThickness,
    vertices,
  };
  return {
    vertices,
    inner,
    exterior: polygonArea(vertices) / 1e6,
    interior: polygonArea(inner) / 1e6,
    envelope,
    contacts: joins,
  };
}
const connectionKey = (c: Omit<Connection, "id">) =>
  `${c.a.sectionId}:${c.a.edge}/${c.b.sectionId}:${c.b.edge}`;
export function prepareBuilding(b: Building, previous?: Building): Building {
  if (previous)
    for (const old of previous.sections)
      if (old.locked) {
        const next = b.sections.find((s) => s.id === old.id);
        if (
          !next ||
          JSON.stringify({ ...next, locked: old.locked }) !==
            JSON.stringify(old)
        )
          throw new Error(
            `“${old.name}” is locked. Unlock it before changing or removing it.`,
          );
      }
  if (previous)
    for (const old of previous.sections) {
      if (
        !b.sections.some((s) => s.id === old.id) &&
        (old.exterior.windows.length || old.exterior.features.length)
      )
        throw new Error(
          "Remove this section’s exterior windows/features explicitly before removing the section. No exterior data was deleted.",
        );
    }
  const geometry = combinedGeometry(b);
  const connections = geometry.contacts.map((c) => ({
    ...c,
    id:
      b.connections.find((old) => connectionKey(old) === connectionKey(c))
        ?.id ?? crypto.randomUUID(),
  }));
  try {
    const previousInner = previous ? combinedGeometry(previous).inner : null;
    const unchanged =
      previous &&
      JSON.stringify(previousInner) === JSON.stringify(geometry.inner) &&
      JSON.stringify(previous.interior.partitions) ===
        JSON.stringify(b.interior.partitions);
    const interior =
      previous && !unchanged
        ? reconcileInterior(
            previousInner!,
            previous.interior,
            geometry.inner,
            b.interior.partitions,
          )
        : b.interior;
    validateInterior(geometry.inner, interior);
    let next = { ...b, connections, interior };
    if (previous && next.openings.length)
      next.openings = reanchorOpenings(
        openingContext(previous),
        openingContext(next, geometry),
        next.openings,
      );
    validateOpenings(openingContext(next, geometry), next.openings);
    if (previous) next = reanchorExterior(previous, next);
    validateExterior(next);
    return next;
  } catch (e) {
    throw new Error(
      `Interior plan: ${(e as Error).message} Footprint edit rejected; partitions and room labels were preserved.`,
    );
  }
}
export function replaceSection(b: Building, s: Section): Building {
  let next = {
    ...b,
    sections: b.sections.map((old) => (old.id === s.id ? s : old)),
  };
  if (b.frame.mode === "legacy")
    next = {
      ...next,
      frame: {
        ...b.frame,
        origin: { x: s.position.x, y: s.position.y },
        axis: s.orientation,
      },
    };
  return prepareBuilding(next, b);
}
export function validateConnections(b: Building): void {
  const expected = combinedGeometry(b).contacts;
  const strip = (c: Omit<Connection, "id">) =>
    JSON.stringify({
      a: c.a,
      b: c.b,
      start: c.start,
      end: c.end,
      mode: c.mode,
    });
  if (
    b.connections.length !== expected.length ||
    expected.some(
      (c) => !b.connections.some((saved) => strip(c) === strip(saved)),
    )
  )
    throw new Error("Attachment records do not match the actual shared edges.");
}

/** Translate all sections and the shared origin equally; local interiors do not move. */
export function translateBuilding(b: Building, origin: Point): Building {
  if (
    ![origin.x, origin.y].every(
      (n) => Number.isSafeInteger(n) && Math.abs(n) <= 10000000,
    )
  )
    throw new Error(
      "Building placement requires integer millimetres within ±10,000 m.",
    );
  const dx = origin.x - b.frame.origin.x,
    dy = origin.y - b.frame.origin.y;
  return prepareBuilding(
    {
      ...b,
      frame: { ...b.frame, origin },
      sections: b.sections.map((s) => ({
        ...s,
        position: { ...s.position, x: s.position.x + dx, y: s.position.y + dy },
      })),
    },
    b,
  );
}

/** Source-wall references remain stable; only real merged exterior segments
 * are offered. Shared open-plan section edges are deliberately absent. */
export function openingContext(
  b: Building,
  geometry = combinedGeometry(b),
): OpeningContext {
  const hosts: HostSegment[] = b.interior.partitions.map((w) => ({
    ref: { kind: "partition", partitionId: w.id },
    a: w.a,
    b: w.b,
    thickness: w.thickness,
    inward: null,
  }));
  for (const s of b.sections) {
    const vertices =
      b.frame.mode === "legacy"
        ? footprintVertices(s)
        : canonicalVertices(s, b);
    vertices.forEach((a, index) => {
      const z = vertices[(index + 1) % vertices.length],
        vertical = a.x === z.x;
      const external = geometry.vertices.find((p, i) => {
        const q = geometry.vertices[(i + 1) % geometry.vertices.length];
        return vertical
          ? p.x === a.x &&
              q.x === a.x &&
              Math.max(Math.min(a.y, z.y), Math.min(p.y, q.y)) <
                Math.min(Math.max(a.y, z.y), Math.max(p.y, q.y))
          : p.y === a.y &&
              q.y === a.y &&
              Math.max(Math.min(a.x, z.x), Math.min(p.x, q.x)) <
                Math.min(Math.max(a.x, z.x), Math.max(p.x, q.x));
      });
      if (!external) return;
      const indexOf = geometry.vertices.indexOf(external),
        end = geometry.vertices[(indexOf + 1) % geometry.vertices.length],
        length = Math.abs(end.x - external.x) + Math.abs(end.y - external.y);
      hosts.push({
        ref: { kind: "exterior", sectionId: s.id, edge: index },
        a,
        b: z,
        thickness: s.wallThickness,
        inward: {
          x: -(end.y - external.y) / length,
          y: (end.x - external.x) / length,
        },
      });
    });
  }
  return {
    outer: geometry.vertices,
    inner: geometry.inner,
    partitions: b.interior.partitions,
    regions: deriveInterior(geometry.inner, b.interior.partitions).regions,
    hosts,
    locked: b.sections
      .filter((s) => s.locked)
      .map((s) =>
        b.frame.mode === "legacy"
          ? footprintVertices(s)
          : canonicalVertices(s, b),
      ),
    exteriorArea: polygonArea(geometry.vertices) - polygonArea(geometry.inner),
    partitionArea: deriveInterior(geometry.inner, b.interior.partitions)
      .partitionArea,
  };
}
