import type { Point } from "./geometry";
import {
  containsPoint,
  wallBox,
  type Cell,
  type Partition,
  type Region,
} from "./interior";
export type OpeningHost =
  | { kind: "partition"; partitionId: string }
  | { kind: "exterior"; sectionId: string; edge: number };
export type Opening = {
  id: string;
  host: OpeningHost;
  offset: number;
  width: number;
} & (
  | { type: "passage" }
  | {
      type: "interior-door" | "exterior-door";
      hinge: "left" | "right";
      swing: 1 | -1;
    }
);
export type DoorType = Opening["type"];
export type HostSegment = {
  ref: OpeningHost;
  a: Point;
  b: Point;
  thickness: number;
  inward: Point | null;
};
export type OpeningContext = {
  outer: Point[];
  inner: Point[];
  partitions: Partition[];
  regions: Region[];
  hosts: HostSegment[];
  locked: Point[][];
  exteriorArea: number;
  partitionArea: number;
};
export const hostKey = (h: OpeningHost) =>
  h.kind === "partition" ? `p:${h.partitionId}` : `e:${h.sectionId}:${h.edge}`;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (p: Point, u: Point, k: number): Point => ({
  x: p.x + u.x * k,
  y: p.y + u.y * k,
});
export const rectOverlap = (a: Cell, b: Cell) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export function touchesRing(box: Cell, ring: Point[]) {
  const xs = [
      ...new Set([
        box.x,
        box.x + box.width,
        ...ring
          .map((p) => p.x)
          .filter((x) => x > box.x && x < box.x + box.width),
      ]),
    ].sort((a, b) => a - b),
    ys = [
      ...new Set([
        box.y,
        box.y + box.height,
        ...ring
          .map((p) => p.y)
          .filter((y) => y > box.y && y < box.y + box.height),
      ]),
    ].sort((a, b) => a - b);
  return xs.slice(0, -1).some((x, i) =>
    ys.slice(0, -1).some((y, j) =>
      containsPoint(ring, {
        x: (x + xs[i + 1]) / 2,
        y: (y + ys[j + 1]) / 2,
      }),
    ),
  );
}
export function openingGeometry(c: OpeningContext, o: Opening) {
  const host = c.hosts.find((h) => hostKey(h.ref) === hostKey(o.host));
  if (!host)
    throw new Error(
      "Opening host is missing or is not an external wall. Open-plan section joins cannot host doors.",
    );
  const length = Math.abs(host.b.x - host.a.x) + Math.abs(host.b.y - host.a.y),
    u = {
      x: (host.b.x - host.a.x) / length,
      y: (host.b.y - host.a.y) / length,
    },
    n = { x: -u.y, y: u.x };
  const start = host.inward
    ? add(host.a, host.inward, host.thickness / 2)
    : host.a;
  const center = add(start, u, o.offset),
    lo = add(center, u, -o.width / 2),
    hi = add(center, u, o.width / 2);
  const gap: Cell = {
    x: Math.min(lo.x, hi.x) - (u.x === 0 ? host.thickness / 2 : 0),
    y: Math.min(lo.y, hi.y) - (u.y === 0 ? host.thickness / 2 : 0),
    width: u.x === 0 ? host.thickness : o.width,
    height: u.y === 0 ? host.thickness : o.width,
  };
  return { host, length, u, n, center, gap, lo, hi };
}
function regionOnSide(
  c: OpeningContext,
  o: Opening,
  side: 1 | -1,
): string | null {
  const g = openingGeometry(c, o),
    p = add(g.center, g.n, side * (g.host.thickness / 2 + 0.01));
  const axis = g.u.x === 0 ? "y" : "x",
    perp = axis === "x" ? "y" : "x",
    low = p[axis] - o.width / 2,
    high = p[axis] + o.width / 2;
  for (const region of c.regions) {
    const intervals = region.cells
      .filter(
        (b) =>
          p[perp] > b[perp] &&
          p[perp] < b[perp] + (perp === "x" ? b.width : b.height),
      )
      .map((b) => [b[axis], b[axis] + (axis === "x" ? b.width : b.height)])
      .sort((a, b) => a[0] - b[0]);
    let end = low;
    for (const [a, b] of intervals) {
      if (a > end) break;
      if (b > end) end = b;
      if (end >= high) return region.key;
    }
  }
  return null;
}
export function openingSides(c: OpeningContext, o: Opening) {
  return [regionOnSide(c, o, 1), regionOnSide(c, o, -1)] as const;
}
function onExterior(c: OpeningContext, o: Opening) {
  const g = openingGeometry(c, o),
    a = add(g.host.a, g.u, o.offset - o.width / 2),
    b = add(a, g.u, o.width);
  return c.outer.some((p, i) => {
    const q = c.outer[(i + 1) % c.outer.length];
    if (g.u.x === 0) {
      return (
        p.x === a.x &&
        q.x === a.x &&
        Math.min(a.y, b.y) >= Math.min(p.y, q.y) + 100 &&
        Math.max(a.y, b.y) <= Math.max(p.y, q.y) - 100
      );
    }
    return (
      p.y === a.y &&
      q.y === a.y &&
      Math.min(a.x, b.x) >= Math.min(p.x, q.x) + 100 &&
      Math.max(a.x, b.x) <= Math.max(p.x, q.x) - 100
    );
  });
}
export function validateOpenings(c: OpeningContext, openings: Opening[]) {
  if (openings.length > 128) throw new Error("Maximum 128 doors/openings.");
  if (new Set(openings.map((o) => o.id)).size !== openings.length)
    throw new Error("Opening IDs must be unique.");
  for (const o of openings) {
    if (
      !Number.isSafeInteger(o.offset) ||
      !Number.isSafeInteger(o.width) ||
      o.width < 400 ||
      o.width > 3000
    )
      throw new Error(
        "Opening width must be 0.4–3 m; position and width require integer millimetres.",
      );
    const g = openingGeometry(c, o);
    if (o.offset - o.width / 2 < 100 || o.offset + o.width / 2 > g.length - 100)
      throw new Error(
        "Opening exceeds the available wall segment. Leave at least 0.1 m at each endpoint.",
      );
    if (
      (o.type === "interior-door" && o.host.kind !== "partition") ||
      (o.type === "exterior-door" && o.host.kind !== "exterior")
    )
      throw new Error("Door type does not match its wall host.");
    if (o.host.kind === "exterior" && !onExterior(c, o))
      throw new Error(
        "Opening must lie on a real external segment, at least 0.1 m from corners. Open-plan joins are not walls.",
      );
    const keepout = {
      x: g.gap.x - 100,
      y: g.gap.y - 100,
      width: g.gap.width + 200,
      height: g.gap.height + 200,
    };
    for (const w of c.partitions) {
      if (o.host.kind === "partition" && w.id === o.host.partitionId) continue;
      if (rectOverlap(keepout, wallBox(w)))
        throw new Error(
          "Opening is too close to another partition or wall junction; leave 0.1 m clearance.",
        );
    }
    const sides = openingSides(c, o);
    if (o.host.kind === "partition" && (!sides[0] || !sides[1]))
      throw new Error(
        "The full opening must connect clear interior on both sides of its partition.",
      );
    if (
      o.host.kind === "exterior" &&
      Number(!!sides[0]) + Number(!!sides[1]) !== 1
    )
      throw new Error(
        "Exterior entrance must connect one interior region to outside.",
      );
  }
  for (let i = 0; i < openings.length; i++)
    for (let j = i + 1; j < openings.length; j++) {
      const a = openingGeometry(c, openings[i]).gap,
        b = openingGeometry(c, openings[j]).gap;
      if (
        rectOverlap(
          {
            x: a.x - 100,
            y: a.y - 100,
            width: a.width + 200,
            height: a.height + 200,
          },
          b,
        )
      )
        throw new Error(
          "Doors/openings overlap or leave less than 0.1 m between openings.",
        );
    }
}
export function checkOpeningLocks(
  c: OpeningContext,
  old: Opening[],
  next: Opening[],
) {
  for (const o of [...old, ...next]) {
    const a = old.find((v) => v.id === o.id),
      b = next.find((v) => v.id === o.id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const g = openingGeometry(c, o);
    if (c.locked.some((r) => touchesRing(g.gap, r)))
      throw new Error(
        "This opening touches a locked section. Unlock the section before editing it.",
      );
  }
}
export function nearestOpeningHost(
  c: OpeningContext,
  p: Point,
  tolerance: number,
) {
  return (
    c.hosts
      .map((h) => {
        const length = Math.abs(h.b.x - h.a.x) + Math.abs(h.b.y - h.a.y),
          u = { x: (h.b.x - h.a.x) / length, y: (h.b.y - h.a.y) / length };
        const a = h.inward ? add(h.a, h.inward, h.thickness / 2) : h.a;
        const raw = dot(sub(p, a), u),
          offset = Math.max(0, Math.min(length, raw));
        const q = add(a, u, offset);
        return { host: h, offset, distance: Math.hypot(q.x - p.x, q.y - p.y) };
      })
      .filter((h) => h.distance <= tolerance)
      .sort((a, b) => a.distance - b.distance)[0] ?? null
  );
}
export function newOpening(
  id: string,
  host: OpeningHost,
  offset: number,
  passage = false,
): Opening {
  return passage
    ? { id, host, offset, width: 1200, type: "passage" }
    : {
        id,
        host,
        offset,
        width: 900,
        type: host.kind === "exterior" ? "exterior-door" : "interior-door",
        hinge: "left",
        swing: 1,
      };
}
export function openingSwing(c: OpeningContext, o: Opening) {
  if (o.type === "passage") return null;
  const g = openingGeometry(c, o),
    direction = o.hinge === "left" ? 1 : -1,
    closedAxis = { x: g.u.x * direction, y: g.u.y * direction },
    openAxis = { x: g.n.x * o.swing, y: g.n.y * o.swing };
  const pivot = add(
      add(g.center, g.u, (-direction * o.width) / 2),
      g.n,
      (o.swing * g.host.thickness) / 2,
    ),
    closed = add(pivot, closedAxis, o.width),
    tip = add(pivot, openAxis, o.width);
  return {
    pivot,
    closed,
    tip,
    closedAxis,
    openAxis,
    arc: `M ${closed.x} ${closed.y} A ${o.width} ${o.width} 0 0 ${direction * o.swing > 0 ? 1 : 0} ${tip.x} ${tip.y}`,
  };
}
function subtractBox(a: Cell, b: Cell): Cell[] {
  if (!rectOverlap(a, b)) return [a];
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y),
    r = Math.min(a.x + a.width, b.x + b.width),
    d = Math.min(a.y + a.height, b.y + b.height);
  return [
    { x: a.x, y: a.y, width: a.width, height: y - a.y },
    { x: a.x, y: d, width: a.width, height: a.y + a.height - d },
    { x: a.x, y, width: x - a.x, height: d - y },
    { x: r, y, width: a.x + a.width - r, height: d - y },
  ].filter((v) => v.width > 0 && v.height > 0);
}
/** Physical wall pieces for swing collision; quarter-disc vs rectangle is exact
 * in orthogonal host axes. Door leaves do not affect logical room topology. */
export function swingWarnings(
  c: OpeningContext,
  openings: Opening[],
): Map<string, string> {
  const hinged = openings.filter((o) => o.type !== "passage");
  if (!hinged.length) return new Map();
  const gaps = openings.map((o) => openingGeometry(c, o).gap),
    xs = [...new Set([...c.outer, ...c.inner].map((p) => p.x))].sort(
      (a, b) => a - b,
    ),
    ys = [...new Set([...c.outer, ...c.inner].map((p) => p.y))].sort(
      (a, b) => a - b,
    );
  const obstacles = c.partitions.map(wallBox);
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const p = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (containsPoint(c.outer, p) && !containsPoint(c.inner, p))
        obstacles.push({
          x: xs[i],
          y: ys[j],
          width: xs[i + 1] - xs[i],
          height: ys[j + 1] - ys[j],
        });
    }
  const physical = obstacles.flatMap((b) =>
    gaps.reduce((parts, gap) => parts.flatMap((p) => subtractBox(p, gap)), [b]),
  );
  const warnings = new Map<string, string>();
  for (const o of hinged) {
    const swing = openingSwing(c, o)!;
    const blocked = physical.some((b) => {
      const points = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height },
        { x: b.x + b.width, y: b.y + b.height },
      ].map((p) => ({
        x: dot(sub(p, swing.pivot), swing.closedAxis),
        y: dot(sub(p, swing.pivot), swing.openAxis),
      }));
      const minX = Math.max(0, Math.min(...points.map((p) => p.x))),
        minY = Math.max(0, Math.min(...points.map((p) => p.y)));
      return (
        Math.max(...points.map((p) => p.x)) > 0 &&
        Math.max(...points.map((p) => p.y)) > 0 &&
        minX * minX + minY * minY < o.width * o.width - 0.0001
      );
    });
    if (blocked)
      warnings.set(
        o.id,
        "Door swing is obstructed by a physical wall. Flip hinge, reverse swing or adjust its position.",
      );
  }
  return warnings;
}
export function openingAreas(c: OpeningContext, openings: Opening[]) {
  const thresholds = openings
      .filter((o) => o.host.kind === "partition")
      .reduce((n, o) => n + o.width * openingGeometry(c, o).host.thickness, 0),
    exteriorThresholds = openings
      .filter((o) => o.host.kind === "exterior")
      .reduce((n, o) => n + o.width * openingGeometry(c, o).host.thickness, 0);
  return {
    thresholds,
    exteriorThresholds,
    physicalPartitions: c.partitionArea - thresholds,
    physicalExterior: c.exteriorArea - exteriorThresholds,
  };
}

/** Host translation carries its opening. Resizing a start keeps the opening's
 * longitudinal location; reversing/replacing its direction requires removal. */
export function reanchorOpenings(
  before: OpeningContext,
  after: OpeningContext,
  openings: Opening[],
): Opening[] {
  return openings.map((o) => {
    const a = openingGeometry(before, o),
      b = openingGeometry(after, o);
    if (a.u.x !== b.u.x || a.u.y !== b.u.y)
      throw new Error(
        "An opening host changed direction/topology. Remove or explicitly relocate its opening before this structural edit.",
      );
    const da = sub(b.host.a, a.host.a),
      db = sub(b.host.b, a.host.b);
    if (da.x === db.x && da.y === db.y) return o;
    return { ...o, offset: o.offset - dot(da, a.u) };
  });
}
