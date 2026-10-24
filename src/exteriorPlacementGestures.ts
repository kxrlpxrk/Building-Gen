/** Shared capture/handoff lifecycle for explicit 3D editing tools. Orbit owns all other gestures. */
export type PointerPosition = Pick<PointerEvent, "clientX" | "clientY">;
export type PlacementGesture = {
  update: (e: PointerPosition) => void;
  restore: () => void;
  finish: (moved: boolean) => void;
};
export function installPlacementGestures(
  canvas: HTMLCanvasElement,
  controls: { enabled: boolean },
  active: () => boolean,
  begin: (e: PointerPosition) => PlacementGesture | null,
) {
  const pointers = new Map<
    number,
    { x: number; y: number; pointerType: string }
  >();
  let gesture:
      | (PlacementGesture & {
          id: number;
          x: number;
          y: number;
          moved: boolean;
        })
      | null = null,
    multi = false,
    handoff = false,
    frame = 0,
    pending: PointerPosition | null = null;
  const clearFrame = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
  };
  function release(id: number) {
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  const down = (e: PointerEvent) => {
    if (handoff || !active()) return;
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
    });
    if (pointers.size > 1) {
      multi = true;
      clearFrame();
      controls.enabled = true;
      if (gesture) {
        gesture.restore();
        gesture = null;
        const [id, first] = [...pointers].find(([id]) => id !== e.pointerId)!;
        handoff = true;
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: id,
            pointerType: first.pointerType,
            clientX: first.x,
            clientY: first.y,
            button: 0,
            buttons: 1,
            isPrimary: true,
          }),
        );
        handoff = false;
      }
      return;
    }
    multi = false;
    const next = begin(e);
    if (!next) return;
    gesture = {
      ...next,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopImmediatePropagation();
    gesture.update(e);
  };
  const move = (e: PointerEvent) => {
    if (pointers.has(e.pointerId))
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        pointerType: e.pointerType,
      });
    if (!gesture || multi || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 6)
      gesture.moved = true;
    if (!gesture.moved) return;
    pending = { clientX: e.clientX, clientY: e.clientY };
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const p = pending;
        pending = null;
        if (p) gesture?.update(p);
      });
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (gesture?.id === e.pointerId && !multi) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearFrame();
      const current = gesture;
      current.update(e);
      gesture = null;
      controls.enabled = true;
      release(e.pointerId);
      current.finish(current.moved);
    }
    if (!pointers.size) multi = false;
  };
  const cancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (gesture?.id === e.pointerId) {
      const old = gesture;
      gesture = null;
      clearFrame();
      old.restore();
      controls.enabled = true;
      release(e.pointerId);
      e.stopImmediatePropagation();
    }
    if (!pointers.size) multi = false;
  };
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("pointermove", move, true);
  canvas.addEventListener("pointerup", up, true);
  canvas.addEventListener("pointercancel", cancel, true);
  canvas.addEventListener("lostpointercapture", cancel, true);
  function reset() {
    clearFrame();
    gesture = null;
    controls.enabled = true;
    for (const id of pointers.keys()) release(id);
    pointers.clear();
    multi = false;
  }
  return {
    reset,
    dispose: () => {
      reset();
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", up, true);
      canvas.removeEventListener("pointercancel", cancel, true);
      canvas.removeEventListener("lostpointercapture", cancel, true);
    },
  };
}
