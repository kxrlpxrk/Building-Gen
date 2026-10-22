import type { Point } from "./geometry";
import { bounds, signedArea } from "./polygon";

export const ROOM_TYPES = [
  "Main Hall",
  "Bedroom",
  "Kitchen",
  "Dining",
  "Storage",
  "Workshop",
  "Bathroom",
  "Corridor",
  "Utility",
  "Custom",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export type Partition = { id: string; a: Point; b: Point; thickness: number };
export type RoomRecord = {
  id: string;
  regionKey: string | null;
  name: string;
  type: RoomType;
  notes: string;
};
export type InteriorPlan = { partitions: Partition[]; rooms: RoomRecord[] };
export type Cell = { x: number; y: number; width: number; height: number };
export type Region = {
  key: string;
  topology: string;
  loops: Point[][];
  cells: Cell[];
  area: number;
  label: Point;
  dimensions: { length: number; width: number };
};
export const emptyInterior = (): InteriorPlan => ({
  partitions: [],
  rooms: [],
});
export function wallBox(w: Partition): Cell {
  const vertical = w.a.x === w.b.x;
  return {
    x: Math.min(w.a.x, w.b.x) - (vertical ? w.thickness / 2 : 0),
    y: Math.min(w.a.y, w.b.y) - (vertical ? 0 : w.thickness / 2),
    width: vertical ? w.thickness : Math.abs(w.b.x - w.a.x),
    height: vertical ? Math.abs(w.b.y - w.a.y) : w.thickness,
  };
}
export const wallLength = (w: Partition) =>
  Math.abs(w.a.x - w.b.x) + Math.abs(w.a.y - w.b.y);
export function containsPoint(ring: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
const overlap = (a: Cell, b: Cell) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const key = (p: Point) => `${p.x},${p.y}`;
function validateWalls(walls: Partition[]) {
  if (walls.length > 64) throw new Error("Maximum 64 ground-floor partitions.");
  if (new Set(walls.map((w) => w.id)).size !== walls.length)
    throw new Error("Partition IDs must be unique.");
  walls.forEach((w) => {
    if (
      ![w.a.x, w.a.y, w.b.x, w.b.y, w.thickness].every(Number.isSafeInteger) ||
      [w.a.x, w.a.y, w.b.x, w.b.y].some((n) => Math.abs(n) > 2000000)
    )
      throw new Error("Partitions require integer-millimetre coordinates.");
    if ((w.a.x === w.b.x) === (w.a.y === w.b.y) || wallLength(w) < 100)
      throw new Error(
        "Draw a horizontal or vertical wall at least 0.1 m long.",
      );
    if (w.thickness < 10 || w.thickness > 1000)
      throw new Error("Partition thickness must be between 0.01 and 1 m.");
  });
  walls.forEach((a, i) =>
    walls.slice(i + 1).forEach((b) => {
      if (!overlap(wallBox(a), wallBox(b))) return;
      const av = a.a.x === a.b.x,
        bv = b.a.x === b.b.x;
      if (av === bv)
        throw new Error(
          "Partition interiors overlap. Collinear walls may meet only at their ends.",
        );
      const v = av ? a : b,
        h = av ? b : a;
      const x = v.a.x,
        y = h.a.y;
      const inH = x >= Math.min(h.a.x, h.b.x) && x <= Math.max(h.a.x, h.b.x);
      const inV = y >= Math.min(v.a.y, v.b.y) && y <= Math.max(v.a.y, v.b.y);
      const endpoint = x === h.a.x || x === h.b.x || y === v.a.y || y === v.b.y;
      if (!inH || !inV || !endpoint)
        throw new Error(
          "Unsupported partition crossing or overlap. Join at an endpoint for a corner or T-junction.",
        );
    }),
  );
}
/** Exact coordinate compression, wall union and clear-space flood fill.
 * Coordinates come only from true boundary/wall edges, including half-mm faces
 * for odd integer wall thicknesses. No area is sampled or approximated. */
export function deriveInterior(inner: Point[], walls: Partition[]) {
  validateWalls(walls);
  const boxes = walls.map(wallBox);
  const xs = [
    ...new Set([
      ...inner.map((p) => p.x),
      ...boxes.flatMap((b) => [b.x, b.x + b.width]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      ...inner.map((p) => p.y),
      ...boxes.flatMap((b) => [b.y, b.y + b.height]),
    ]),
  ].sort((a, b) => a - b);
  const nx = xs.length - 1,
    ny = ys.length - 1;
  if (nx * ny > 1000000)
    throw new Error(
      "Interior arrangement exceeds the exact geometry complexity limit.",
    );
  const cells = new Int32Array(nx * ny).fill(-1),
    xi = new Map(xs.map((x, i) => [x, i])),
    yi = new Map(ys.map((y, i) => [y, i]));
  for (let x = 0; x < nx; x++) {
    const mid = (xs[x] + xs[x + 1]) / 2,
      crosses: number[] = [];
    inner.forEach((a, i) => {
      const b = inner[(i + 1) % inner.length];
      if (a.y === b.y && mid > Math.min(a.x, b.x) && mid < Math.max(a.x, b.x))
        crosses.push(a.y);
    });
    crosses.sort((a, b) => a - b);
    for (let i = 0; i < crosses.length; i += 2)
      for (let y = yi.get(crosses[i])!; y < yi.get(crosses[i + 1])!; y++)
        cells[x * ny + y] = -3;
  }
  for (const b of boxes)
    for (let x = xi.get(b.x)!; x < xi.get(b.x + b.width)!; x++)
      for (let y = yi.get(b.y)!; y < yi.get(b.y + b.height)!; y++) {
        if (cells[x * ny + y] === -1)
          throw new Error(
            "Partition protrudes outside the merged clear interior. Existing interior data is preserved.",
          );
        cells[x * ny + y] = -2;
      }
  const groups: number[][] = [];
  let partitionArea = 0;
  for (let i = 0; i < cells.length; i++) {
    const x = Math.floor(i / ny),
      y = i % ny;
    if (cells[i] === -2)
      partitionArea += (xs[x + 1] - xs[x]) * (ys[y + 1] - ys[y]);
    if (cells[i] !== -3) continue;
    const index = groups.length,
      queue = [i];
    cells[i] = index;
    for (let at = 0; at < queue.length; at++) {
      const n = queue[at],
        cx = Math.floor(n / ny),
        cy = n % ny;
      for (const neighbour of [
        cx > 0 ? n - ny : -1,
        cx < nx - 1 ? n + ny : -1,
        cy > 0 ? n - 1 : -1,
        cy < ny - 1 ? n + 1 : -1,
      ])
        if (neighbour >= 0 && cells[neighbour] === -3) {
          cells[neighbour] = index;
          queue.push(neighbour);
        }
    }
    groups.push(queue);
  }
  if (!groups.length)
    throw new Error("Partitions must leave usable clear space.");
  // Reject narrow slivers and necks in either orthogonal direction.
  if (walls.length)
    for (const vertical of [false, true])
      for (let line = 0; line < (vertical ? nx : ny); line++) {
        let start = -1,
          last = -1;
        const size = vertical ? ny : nx,
          coordinates = vertical ? ys : xs;
        for (let n = 0; n <= size; n++) {
          const current =
            n === size ? -1 : cells[vertical ? line * ny + n : n * ny + line];
          if (current !== last) {
            if (last >= 0 && coordinates[n] - coordinates[start] < 100)
              throw new Error(
                "Clear interior passages and room spans must be at least 0.1 m wide.",
              );
            start = n;
            last = current;
          }
        }
      }
  const regions: Region[] = groups.map((group, index) => {
    const edges = new Map<string, Point>();
    const add = (a: Point, b: Point) => {
      if (edges.has(key(a)))
        throw new Error("Partitions produce a self-touching room boundary.");
      edges.set(key(a), b);
    };
    const tiles: Cell[] = group.map((n) => {
      const x = Math.floor(n / ny),
        y = n % ny;
      const a = { x: xs[x], y: ys[y] },
        b = { x: xs[x + 1], y: ys[y] },
        c = { x: xs[x + 1], y: ys[y + 1] },
        d = { x: xs[x], y: ys[y + 1] };
      if (y === 0 || cells[n - 1] !== index) add(a, b);
      if (x === nx - 1 || cells[n + ny] !== index) add(b, c);
      if (y === ny - 1 || cells[n + 1] !== index) add(c, d);
      if (x === 0 || cells[n - ny] !== index) add(d, a);
      return { x: a.x, y: a.y, width: b.x - a.x, height: d.y - a.y };
    });
    const loops: Point[][] = [];
    while (edges.size) {
      const start = edges.keys().next().value!,
        ring: Point[] = [];
      let at = start;
      do {
        const next = edges.get(at);
        if (!next) throw new Error("Invalid room boundary.");
        const [x, y] = at.split(",").map(Number);
        ring.push({ x, y });
        edges.delete(at);
        at = key(next);
      } while (at !== start);
      loops.push(
        ring.filter((p, i) => {
          const a = ring[(i + ring.length - 1) % ring.length],
            b = ring[(i + 1) % ring.length];
          return !(
            (a.x === p.x && p.x === b.x) ||
            (a.y === p.y && p.y === b.y)
          );
        }),
      );
    }
    const topology = new Set<string>();
    boxes.forEach((b, i) =>
      tiles.forEach((t) => {
        if (Math.min(t.y + t.height, b.y + b.height) > Math.max(t.y, b.y)) {
          if (t.x + t.width === b.x) topology.add(`${walls[i].id}:W`);
          if (t.x === b.x + b.width) topology.add(`${walls[i].id}:E`);
        }
        if (Math.min(t.x + t.width, b.x + b.width) > Math.max(t.x, b.x)) {
          if (t.y + t.height === b.y) topology.add(`${walls[i].id}:N`);
          if (t.y === b.y + b.height) topology.add(`${walls[i].id}:S`);
        }
      }),
    );
    const largest = tiles.reduce((a, b) =>
        a.width * a.height > b.width * b.height ? a : b,
      ),
      extent = bounds(loops.flat());
    const area = tiles.reduce((sum, t) => sum + t.width * t.height, 0);
    if (
      Math.abs(loops.reduce((sum, l) => sum + signedArea(l), 0) - area) > 0.001
    )
      throw new Error("Room boundary area does not reconcile.");
    return {
      key: loops
        .map((l) => l.map(key).join(";"))
        .sort()
        .join("|"),
      topology: [...topology].sort().join("/"),
      loops,
      cells: tiles,
      area,
      label: {
        x: largest.x + largest.width / 2,
        y: largest.y + largest.height / 2,
      },
      dimensions: { length: extent.length, width: extent.width },
    };
  });
  return {
    regions,
    partitionArea,
    clearArea: regions.reduce((sum, r) => sum + r.area, 0),
    usableArea: Math.abs(signedArea(inner)),
  };
}
/** Unique topological matches retain IDs. Ambiguous merges/splits archive all
 * existing records, visibly retaining labels for manual reassignment. */
export function reconcileInterior(
  oldInner: Point[],
  old: InteriorPlan,
  inner: Point[],
  partitions: Partition[],
): InteriorPlan {
  if (!old.partitions.length && !partitions.length && !old.rooms.length) {
    deriveInterior(inner, partitions);
    return emptyInterior();
  }
  const before = deriveInterior(oldInner, old.partitions).regions,
    after = deriveInterior(inner, partitions).regions;
  const rooms: RoomRecord[] = old.rooms
    .filter((r) => r.regionKey === null)
    .map((r) => ({ ...r }));
  const available = new Set(before.map((r) => r.key));
  const matches = new Map<string, string>();
  for (const r of after) {
    const candidates = before.filter(
      (p) => available.has(p.key) && p.topology === r.topology,
    );
    if (
      candidates.length === 1 &&
      after.filter((p) => p.topology === r.topology).length === 1
    ) {
      matches.set(r.key, candidates[0].key);
      available.delete(candidates[0].key);
    }
  }
  const overlaps = (a: Region, b: Region) =>
    a.cells.some((c) => b.cells.some((d) => overlap(c, d) > 0));
  for (const r of after.filter((r) => !matches.has(r.key))) {
    const candidates = before.filter(
      (p) => available.has(p.key) && overlaps(p, r),
    );
    if (
      candidates.length === 1 &&
      after.filter((p) => !matches.has(p.key) && overlaps(candidates[0], p))
        .length === 1
    ) {
      matches.set(r.key, candidates[0].key);
      available.delete(candidates[0].key);
    }
  }
  for (const r of after) {
    const source = old.rooms.find((p) => p.regionKey === matches.get(r.key));
    rooms.push(
      source
        ? { ...source, regionKey: r.key }
        : {
            id: crypto.randomUUID(),
            regionKey: r.key,
            name: "",
            type: "Custom",
            notes: "",
          },
    );
  }
  for (const r of old.rooms.filter(
    (r) =>
      r.regionKey !== null &&
      available.has(r.regionKey) &&
      (r.name.trim() || r.notes.trim() || r.type !== "Custom"),
  ))
    rooms.push({ ...r, regionKey: null });
  if (rooms.length > 512)
    throw new Error(
      "Maximum 512 active/retained room records; remove unused retained labels before continuing.",
    );
  return { partitions: structuredClone(partitions), rooms };
}
export function validateInterior(inner: Point[], plan: InteriorPlan) {
  const geometry = deriveInterior(inner, plan.partitions),
    keys = new Set(geometry.regions.map((r) => r.key)),
    active = new Set<string>();
  for (const r of plan.rooms) {
    if (r.regionKey !== null) {
      if (!keys.has(r.regionKey) || active.has(r.regionKey))
        throw new Error(
          "Room assignments do not match the derived clear regions.",
        );
      active.add(r.regionKey);
    }
  }
  return geometry;
}
export function snapInteriorPoint(
  p: Point,
  inner: Point[],
  walls: Partition[],
  step: number | null,
  tolerance: number,
): Point {
  const result = { x: Math.round(p.x), y: Math.round(p.y) };
  for (const axis of ["x", "y"] as const) {
    const candidates = [
      ...inner.map((q) => q[axis]),
      ...walls.flatMap((w) => [w.a[axis], w.b[axis]]),
    ];
    const nearest = candidates.sort(
      (a, b) => Math.abs(a - p[axis]) - Math.abs(b - p[axis]),
    )[0];
    result[axis] =
      nearest !== undefined && Math.abs(nearest - p[axis]) <= tolerance
        ? Math.round(nearest)
        : step
          ? Math.round(p[axis] / step) * step
          : Math.round(p[axis]);
  }
  return result;
}
