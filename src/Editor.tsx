import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  corners,
  metres,
  moveRectangle,
  resizeRectangle,
  validateRectangle,
  type Point,
} from "./geometry";
import type { Section } from "./model";
import {
  fitCamera,
  panCamera,
  pinchCamera,
  screenToWorld,
  zoomAt,
  type Camera,
  type Viewport,
} from "./transforms";
type Props = {
  section: Section;
  onChange: (s: Section) => void;
  grid: number | null;
  snapEnabled: boolean;
  gridVisible: boolean;
  tool: "edit" | "pan";
  selected: boolean;
  onSelect: (v: boolean) => void;
};
type Gesture =
  | {
      kind: "drag";
      start: Point;
      section: Section;
      corner: number | null;
      camera: Camera;
    }
  | { kind: "pan"; start: Point; camera: Camera }
  | { kind: "pinch"; start: Point; distance: number; camera: Camera }
  | { kind: "blocked" };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export default function Editor({
  section,
  onChange,
  grid,
  snapEnabled,
  gridVisible,
  tool,
  selected,
  onSelect,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({
    width: 600,
    height: 500,
  });
  const [camera, setCamera] = useState<Camera>({
    center: { x: 6000, y: 4000 },
    scale: 0.035,
  });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [draft, setDraft] = useState<Section | null>(null);
  const draftRef = useRef<Section | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const initialized = useRef(false);
  const patternId = useId().replace(/:/g, "");
  const display = draft || section;
  function preview(s: Section | null) {
    draftRef.current = s;
    setDraft(s);
  }
  useEffect(() => {
    const node = svg.current!;
    const observer = new ResizeObserver(([entry]) => {
      const v = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      if (!v.width || !v.height) return;
      setViewport(v);
      if (!initialized.current) {
        setCamera(fitCamera(section, v));
        initialized.current = true;
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []); // Initial fit only; panel and orientation changes preserve camera position.
  useEffect(() => {
    const node = svg.current!;
    function wheel(e: WheelEvent) {
      e.preventDefault();
      if (pointers.current.size) return;
      const box = node.getBoundingClientRect();
      const anchor = { x: e.clientX - box.left, y: e.clientY - box.top };
      setCamera((c) =>
        zoomAt(
          c,
          anchor,
          Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0015)),
          viewportRef.current,
        ),
      );
    }
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  function point(e: ReactPointerEvent<SVGSVGElement>): Point {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
  function down(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    svg.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      preview(null); // An interrupted drag is rolled back before any pinch can edit geometry.
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: "pinch",
        start: midpoint(a, b),
        distance: Math.max(1, distance(a, b)),
        camera: cameraRef.current,
      };
      return;
    }
    const target = (e.target as Element).closest("[data-building]");
    if (tool === "pan" || e.button === 1)
      gesture.current = { kind: "pan", start: p, camera: cameraRef.current };
    else if (target) {
      onSelect(true);
      const handle = (e.target as Element)
        .closest("[data-corner]")
        ?.getAttribute("data-corner");
      gesture.current = {
        kind: "drag",
        start: p,
        section: structuredClone(section),
        corner: handle == null ? null : Number(handle),
        camera: cameraRef.current,
      };
    } else {
      onSelect(false);
      gesture.current = { kind: "pan", start: p, camera: cameraRef.current };
    }
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    e.preventDefault();
    const p = point(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g || g.kind === "blocked") return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (a && b)
        setCamera(
          pinchCamera(
            g.camera,
            g.start,
            midpoint(a, b),
            distance(a, b) / g.distance,
            viewport,
          ),
        );
    } else if (g.kind === "pan")
      setCamera(
        panCamera(g.camera, { x: p.x - g.start.x, y: p.y - g.start.y }),
      );
    else {
      if (distance(p, g.start) < 4 && !draftRef.current) return;
      const start = screenToWorld(g.start, g.camera, viewport),
        current = screenToWorld(p, g.camera, viewport);
      const step = snapEnabled ? grid : null;
      const delta = { x: current.x - start.x, y: current.y - start.y };
      const anchor = g.corner == null ? null : corners(g.section)[g.corner];
      const result =
        anchor && g.corner != null
          ? resizeRectangle(
              g.section,
              g.corner,
              { x: anchor.x + delta.x, y: anchor.y + delta.y },
              step,
            )
          : moveRectangle(g.section, delta, step);
      if (!validateRectangle(result)) preview({ ...g.section, ...result });
    }
  }
  function finish(e: ReactPointerEvent<SVGSVGElement>, cancelled = false) {
    if (!pointers.current.has(e.pointerId)) return;
    const g = gesture.current;
    if (!cancelled && g?.kind === "drag" && draftRef.current)
      onChange(draftRef.current);
    preview(null);
    pointers.current.delete(e.pointerId);
    gesture.current = pointers.current.size ? { kind: "blocked" } : null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const s = camera.scale;
  let visualGrid = grid || 500;
  while (visualGrid * s < 12) visualGrid *= 2;
  const pts = corners(display);
  const path = `M 0 0 H ${display.length} V ${display.width} H 0 Z M ${display.wallThickness} ${display.wallThickness} V ${display.width - display.wallThickness} H ${display.length - display.wallThickness} V ${display.wallThickness} Z`;
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  return (
    <div className="canvas-wrap">
      <svg
        ref={svg}
        className={`plan-canvas tool-${tool}`}
        role="application"
        aria-label="Building plan. Edit tool: drag building to move, drag corners to resize. Pan tool: drag canvas. Pinch or scroll to zoom. Arrow keys move selected building."
        tabIndex={0}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => finish(e)}
        onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => finish(e, true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            preview(null);
            gesture.current = { kind: "blocked" };
            onSelect(false);
          }
          const arrows: Record<string, Point> = {
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
          };
          if (
            selected &&
            tool === "edit" &&
            arrows[e.key] &&
            !pointers.current.size
          ) {
            e.preventDefault();
            const step =
                (snapEnabled && grid ? grid : 100) * (e.shiftKey ? 10 : 1),
              d = arrows[e.key];
            const result = moveRectangle(
              section,
              { x: d.x * step, y: d.y * step },
              null,
            );
            if (!validateRectangle(result)) onChange({ ...section, ...result });
          }
        }}
      >
        <defs>
          <pattern
            id={patternId}
            width={visualGrid}
            height={visualGrid}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${visualGrid} 0 H 0 V ${visualGrid}`}
              fill="none"
              stroke="#c9d4ce"
              strokeWidth={1 / s}
            />
          </pattern>
        </defs>
        <g
          transform={`translate(${viewport.width / 2} ${viewport.height / 2}) scale(${s}) translate(${-camera.center.x} ${-camera.center.y})`}
        >
          {gridVisible && (
            <rect
              x={camera.center.x - viewport.width / s / 2}
              y={camera.center.y - viewport.height / s / 2}
              width={viewport.width / s}
              height={viewport.height / s}
              fill={`url(#${patternId})`}
            />
          )}
          <g
            transform={`translate(${display.position.x} ${display.position.y}) rotate(${display.orientation})`}
            data-building="true"
          >
            <rect
              width={display.length}
              height={display.width}
              fill="#f7f5ea"
              stroke="none"
            />
            <path
              d={path}
              fill="#46655e"
              fillRule="evenodd"
              stroke="#23463e"
              strokeWidth={1.25 / s}
            />
            {selected && (
              <rect
                x={-3 / s}
                y={-3 / s}
                width={display.length + 6 / s}
                height={display.width + 6 / s}
                fill="none"
                stroke="#b27b31"
                strokeWidth={1.5 / s}
                strokeDasharray={`${5 / s} ${4 / s}`}
                pointerEvents="none"
              />
            )}
            <text
              x={display.length / 2}
              y={display.width / 2 - 6 / s}
              textAnchor="middle"
              fontSize={13 / s}
              fill="#315448"
              pointerEvents="none"
            >
              RECTANGULAR SECTION
            </text>
            <text
              x={display.length / 2}
              y={display.width / 2 + 15 / s}
              textAnchor="middle"
              fontSize={12 / s}
              fill="#60776d"
              pointerEvents="none"
            >
              {metres(display.length)} × {metres(display.width)} m
            </text>
            <g
              stroke="#748c80"
              strokeWidth={1 / s}
              fill="none"
              pointerEvents="none"
            >
              <path
                d={`M 0 ${-14 / s} V ${-40 / s} M ${display.length} ${-14 / s} V ${-40 / s} M 0 ${-32 / s} H ${display.length}`}
              />
              <path
                d={`M ${-14 / s} 0 H ${-40 / s} M ${-14 / s} ${display.width} H ${-40 / s} M ${-32 / s} 0 V ${display.width}`}
              />
            </g>
            <text
              className="dimension-text"
              x={display.length / 2}
              y={-40 / s}
              textAnchor="middle"
              fontSize={13 / s}
            >
              {metres(display.length)} m
            </text>
            <text
              className="dimension-text"
              transform={`translate(${-42 / s} ${display.width / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={13 / s}
            >
              {metres(display.width)} m
            </text>
          </g>
          {selected &&
            tool === "edit" &&
            pts.map((p, i) => (
              <g
                key={i}
                data-building="true"
                data-corner={i}
                className="resize-handle"
              >
                <circle cx={p.x} cy={p.y} r={23 / s} fill="transparent" />
                <rect
                  x={p.x - 6 / s}
                  y={p.y - 6 / s}
                  width={12 / s}
                  height={12 / s}
                  rx={2 / s}
                  fill="#fffaf0"
                  stroke="#a66e26"
                  strokeWidth={2 / s}
                  pointerEvents="none"
                />
              </g>
            ))}
        </g>
      </svg>
      <div className="canvas-compass" aria-hidden="true">
        <span>↑ Y−</span>
        <span>X+ →</span>
      </div>
      <div className="canvas-caption">
        PLAN / XY{" "}
        <span>
          {gridVisible ? `${metres(visualGrid)} m display grid` : "Grid hidden"}
        </span>
      </div>
      <div className="zoom-controls" aria-label="View controls">
        <button
          aria-label="Zoom out"
          onClick={() =>
            setCamera((c) => zoomAt(c, center, 1 / 1.25, viewport))
          }
        >
          −
        </button>
        <output aria-label="Zoom percentage">
          {Math.round((s / 0.04) * 100)}%
        </output>
        <button
          aria-label="Zoom in"
          onClick={() => setCamera((c) => zoomAt(c, center, 1.25, viewport))}
        >
          +
        </button>
        <button onClick={() => setCamera(fitCamera(display, viewport))}>
          Fit
        </button>
      </div>
    </div>
  );
}
