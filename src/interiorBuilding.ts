import { canonicalVertices, combinedGeometry } from "./assembly";
import type { Building } from "./model";
import {
  containsPoint,
  reconcileInterior,
  wallBox,
  type Partition,
} from "./interior";

/** A locked section protects its interior partition geometry as well. */
export function changePartitions(
  b: Building,
  partitions: Partition[],
): Building {
  for (const s of b.sections.filter((s) => s.locked)) {
    const ring = canonicalVertices(s, b);
    const touches = (w: Partition) => {
      const box = wallBox(w),
        xs = [
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
    };
    for (const w of [...b.interior.partitions, ...partitions]) {
      const old = b.interior.partitions.find((p) => p.id === w.id),
        next = partitions.find((p) => p.id === w.id);
      if (JSON.stringify(old) !== JSON.stringify(next) && touches(w))
        throw new Error(
          `“${s.name}” is locked. Unlock it before editing partitions in that section.`,
        );
    }
  }
  const inner = combinedGeometry(b).inner;
  return {
    ...b,
    interior: reconcileInterior(inner, b.interior, inner, partitions),
  };
}
