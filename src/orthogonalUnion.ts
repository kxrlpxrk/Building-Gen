import type { Point } from "./geometry";
import { bounds, validatePolygon } from "./polygon";
const key = (p: Point) => `${p.x},${p.y}`;
/** Coordinate-compressed vertical sweep. Cells are exact slabs between integer
 * edge coordinates, not a sampled raster. Positive-area overlaps are rejected. */
export function orthogonalUnion(rings: readonly Point[][]): Point[] {
  if (!rings.length) throw new Error("A building needs a main footprint.");
  const xs = [...new Set(rings.flatMap((v) => v.map((p) => p.x)))].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set(rings.flatMap((v) => v.map((p) => p.y)))].sort(
    (a, b) => a - b,
  );
  const nx = xs.length - 1,
    ny = ys.length - 1,
    cells = new Uint8Array(nx * ny),
    yi = new Map(ys.map((y, i) => [y, i]));
  const extent = bounds(rings.flat());
  if (extent.length > 500000 || extent.width > 500000)
    throw new Error("Combined building extents must not exceed 500 m.");
  for (let x = 0; x < nx; x++) {
    const mid = (xs[x] + xs[x + 1]) / 2;
    for (const v of rings) {
      const crossings: number[] = [];
      for (let i = 0; i < v.length; i++) {
        const a = v[i],
          b = v[(i + 1) % v.length];
        if (a.y === b.y && Math.min(a.x, b.x) < mid && mid < Math.max(a.x, b.x))
          crossings.push(a.y);
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i < crossings.length; i += 2)
        for (
          let y = yi.get(crossings[i])!;
          y < yi.get(crossings[i + 1])!;
          y++
        ) {
          const index = x * ny + y;
          if (cells[index])
            throw new Error(
              "Sections overlap in their interiors. Only shared edges are allowed.",
            );
          cells[index] = 1;
        }
    }
  }
  const edges = new Map<string, Point>();
  function add(a: Point, b: Point) {
    if (edges.has(key(a)))
      throw new Error(
        "Corner-only contact or a self-touching boundary is invalid. Share a full edge segment.",
      );
    edges.set(key(a), b);
  }
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      if (cells[x * ny + y]) {
        const a = { x: xs[x], y: ys[y] },
          b = { x: xs[x + 1], y: ys[y] },
          c = { x: xs[x + 1], y: ys[y + 1] },
          d = { x: xs[x], y: ys[y + 1] };
        if (y === 0 || !cells[x * ny + y - 1]) add(a, b);
        if (x === nx - 1 || !cells[(x + 1) * ny + y]) add(b, c);
        if (y === ny - 1 || !cells[x * ny + y + 1]) add(c, d);
        if (x === 0 || !cells[(x - 1) * ny + y]) add(d, a);
      }
  const start = edges.keys().next().value as string,
    ring: Point[] = [];
  let at = start;
  do {
    const next = edges.get(at);
    if (!next) throw new Error("The combined boundary is not a closed ring.");
    const [x, y] = at.split(",").map(Number);
    ring.push({ x, y });
    edges.delete(at);
    at = key(next);
  } while (at !== start);
  if (edges.size)
    throw new Error("The building must be connected and contain no holes.");
  const simplified = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length],
      b = ring[(i + 1) % ring.length];
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
  const error = validatePolygon(simplified, 100, 768, 2000000);
  if (error) throw new Error(`Combined footprint: ${error}`);
  return simplified;
}
