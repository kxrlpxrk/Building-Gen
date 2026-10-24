import {
  installPlacementGestures,
  type PointerPosition,
} from "./exteriorPlacementGestures";
import type { OrnamentPlacement, OrnamentHit } from "./ornamentPlacement";
export function installOrnamentGestures(
  canvas: HTMLCanvasElement,
  controls: { enabled: boolean },
  placement: () => OrnamentPlacement,
  hit: (p: PointerPosition) => OrnamentHit | null,
  visible: (anchor: import("./ornamentPlacement").OrnamentAnchor) => boolean,
) {
  return installPlacementGestures(
    canvas,
    controls,
    () => !!placement().getState(),
    (e) => {
      const s = placement().getState();
      if (!s) return null;
      const before = structuredClone(s),
        a = s.draft ?? s.source,
        h = hit(e),
        o = a?.ornament;
      const wall = o?.anchor.kind === "wall" ? o.anchor : null;
      const grab =
        wall &&
        h?.wall &&
        a?.sectionId === h.wall.sectionId &&
        wall.edge === h.wall.edge &&
        Math.abs(h.wall.offset - wall.offset) < (900 * o!.scale) / 1000
          ? { offset: h.wall.offset - wall.offset, z: h.wall.z - wall.sill }
          : undefined;
      return {
        update: (e) => placement().position(hit(e), grab, visible),
        restore: () => placement().restore(before),
        finish: () => {
          /* Explicit confirmation keeps the saved original in place until accepted. */
        },
      };
    },
  );
}
