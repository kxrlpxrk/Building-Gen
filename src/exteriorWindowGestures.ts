import {
  defaultWindow,
  positionWindow,
  type WallHit,
  type WindowPlacement,
} from "./windowPlacement";
import {
  installPlacementGestures,
  type PointerPosition,
} from "./exteriorPlacementGestures";
/** Window behaviour is unchanged: moved existing windows commit on release. */
export function installWindowGestures(
  canvas: HTMLCanvasElement,
  controls: { enabled: boolean },
  placement: () => WindowPlacement,
  hit: (e: PointerPosition) => WallHit | null,
  step: () => number | null,
) {
  return installPlacementGestures(
    canvas,
    controls,
    () => !!placement().getState(),
    (e) => {
      const p = placement(),
        s = p.getState(),
        h = hit(e);
      if (!s || !h) return null;
      const before = structuredClone(s),
        anchor = s.draft ?? s.source,
        w = anchor?.window ?? defaultWindow();
      const onWindow =
        anchor?.sectionId === h.sectionId &&
        w.edge === h.edge &&
        Math.abs(h.offset - w.offset) <= w.width / 2 + 100 &&
        h.z >= w.sill - 100 &&
        h.z <= w.sill + w.height + 100;
      const grab = onWindow
        ? { offset: h.offset - w.offset, z: h.z - w.sill }
        : { offset: 0, z: w.height / 2 };
      return {
        update: (e) => {
          const h = hit(e),
            s = placement().getState();
          if (!s) return;
          if (!h) {
            placement().restore({
              ...s,
              issue:
                "Position is not on an exposed exterior wall. Move back onto a wall or cancel.",
            });
            return;
          }
          placement().preview(positionWindow(h, w, step(), grab));
        },
        restore: () => placement().restore(before),
        finish: (moved) => {
          const p = placement();
          if (moved && p.getState()?.mode === "move" && !p.getState()?.issue)
            p.commit();
        },
      };
    },
  );
}
