import {
  defaultWindow,
  positionWindow,
  type WallHit,
  type WindowPlacement,
  type WindowSession,
} from "./windowPlacement";
/** Capture only an explicitly activated one-pointer window edit. On a second
 * pointer restore the draft and hand both live pointers to OrbitControls. */
export function installWindowGestures(
  canvas: HTMLCanvasElement,
  controls: { enabled: boolean },
  placement: () => WindowPlacement,
  hit: (e: Pick<PointerEvent, "clientX" | "clientY">) => WallHit | null,
  step: () => number | null,
) {
  const pointers = new Map<
    number,
    { x: number; y: number; pointerType: string }
  >();
  let gesture: {
    id: number;
    x: number;
    y: number;
    moved: boolean;
    before: WindowSession;
    window: ReturnType<typeof defaultWindow>;
    grab: { offset: number; z: number };
  } | null = null;
  let multi = false,
    handoff = false,
    frame = 0,
    pending: Pick<PointerEvent, "clientX" | "clientY"> | null = null;
  const clearFrame = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
  };
  function deliver(e: Pick<PointerEvent, "clientX" | "clientY">) {
    if (!gesture) return;
    const h = hit(e),
      p = placement(),
      s = p.getState();
    if (!s) return;
    if (!h) {
      p.restore({
        ...s,
        issue:
          "Position is not on an exposed exterior wall. Move back onto a wall or cancel.",
      });
      return;
    }
    p.preview(positionWindow(h, gesture.window, step(), gesture.grab));
  }
  const down = (e: PointerEvent) => {
    if (handoff) return;
    const p = placement(),
      s = p.getState();
    if (!s) return;
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
        p.restore(gesture.before);
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
    const h = hit(e);
    if (!h) return;
    const anchor = s.draft ?? s.source,
      w = anchor?.window ?? defaultWindow();
    const onWindow =
      anchor?.sectionId === h.sectionId &&
      w.edge === h.edge &&
      Math.abs(h.offset - w.offset) <= w.width / 2 + 100 &&
      h.z >= w.sill - 100 &&
      h.z <= w.sill + w.height + 100;
    gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      before: structuredClone(s),
      window: w,
      grab: onWindow
        ? { offset: h.offset - w.offset, z: h.z - w.sill }
        : { offset: 0, z: w.height / 2 },
    };
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopImmediatePropagation();
    deliver(e);
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
    pending = { clientX: e.clientX, clientY: e.clientY };
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const latest = pending;
        pending = null;
        if (latest) deliver(latest);
      });
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (gesture?.id === e.pointerId && !multi) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearFrame();
      deliver(e);
      const moved = gesture.moved,
        p = placement();
      gesture = null;
      controls.enabled = true;
      if (canvas.hasPointerCapture(e.pointerId))
        canvas.releasePointerCapture(e.pointerId);
      if (moved && p.getState()?.mode === "move" && !p.getState()?.issue)
        p.commit();
    }
    if (!pointers.size) multi = false;
  };
  const cancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (gesture) {
      clearFrame();
      placement().restore(gesture.before);
      gesture = null;
      controls.enabled = true;
      e.stopImmediatePropagation();
    }
    if (!pointers.size) multi = false;
  };
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("pointermove", move, true);
  canvas.addEventListener("pointerup", up, true);
  canvas.addEventListener("pointercancel", cancel, true);
  function reset() {
    clearFrame();
    gesture = null;
    controls.enabled = true;
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
    },
  };
}
