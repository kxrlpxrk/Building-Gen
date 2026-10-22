import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  corners,
  metres,
  moveRectangle,
  resizeRectangle,
  validateFootprint,
  footprintVertices,
  rotate,
  type Point,
} from "./geometry";
import {
  bounds,
  dragEdge,
  dragVertex,
  edgeLength,
  insetPolygon,
  polygonPath,
} from "./polygon";
import { withVertices, type Part } from "./footprint";
import { combinedGeometry, displaySection, storedSection } from "./assembly";
import { attachmentBase } from "./attachments";
import type { Building } from "./model";
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
  building: Building;
  placement: {
    candidate: Section;
    building?: Building;
    error: string | null;
    edge?: number;
  } | null;
  onSectionSelect: (id: string) => void;
  validateChange: (s: Section) => string | null;
  onChange: (s: Section) => void;
  grid: number | null;
  snapEnabled: boolean;
  gridVisible: boolean;
  tool: "edit" | "pan";
  selected: boolean;
  onSelect: (v: boolean) => void;
  part: Part;
  onPartSelect: (part: Part) => void;
};
type Gesture =
  | {
      kind: "drag";
      start: Point;
      section: Section;
      corner: number | null;
      edge: number | null;
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
  building,
  placement,
  onSectionSelect,
  validateChange,
  onChange,
  grid,
  snapEnabled,
  gridVisible,
  tool,
  selected,
  onSelect,
  part,
  onPartSelect,
}: Props) {
  const [geometryError, setGeometryError] = useState("");
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
  const draftBuilding = draft
    ? {
        ...building,
        sections: building.sections.map((s) =>
          s.id === draft.id ? storedSection(draft, building) : s,
        ),
      }
    : building;
  const merged = combinedGeometry(draftBuilding);
  const others = building.sections
    .filter((s) => s.id !== section.id)
    .map((s) => displaySection(s, building));
  const placementSection = placement
    ? displaySection(placement.candidate, {
        ...attachmentBase(building),
        sections: [...building.sections, placement.candidate],
      })
    : null;
  function fitEnvelope() {
    if (placement?.building)
      return combinedGeometry(placement.building).envelope;
    if (
      placement &&
      placementSection &&
      !validateFootprint(placement.candidate)
    )
      return {
        ...merged.envelope,
        position: { x: 0, y: 0, z: 0 },
        orientation: 0,
        vertices: [...corners(merged.envelope), ...corners(placementSection)],
      };
    return merged.envelope;
  }
  useEffect(() => {
    if (placement) setCamera(fitCamera(fitEnvelope(), viewportRef.current));
  }, [placement?.candidate.id]);
  // External changes (undo, inspector edits, selection) cancel stale pointer snapshots.
  const modelKey = JSON.stringify([building, section.id]);
  useEffect(() => {
    preview(null);
    gesture.current = pointers.current.size ? { kind: "blocked" } : null;
    setGeometryError("");
  }, [modelKey]);
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
        setCamera(fitCamera(combinedGeometry(building).envelope, v));
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
    setGeometryError("");
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
    const world = screenToWorld(p, cameraRef.current, viewportRef.current);
    // Exclusive interiors win over transparent handles belonging to neighbours.
    // Shared-edge ambiguity retains the current selection; the section panel also
    // offers an exact, touch-friendly selector.
    function interior(s: Section) {
      const q = rotate(
          { x: world.x - s.position.x, y: world.y - s.position.y },
          -s.orientation,
        ),
        v = footprintVertices(s);
      let inside = false;
      for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
        const a = v[i],
          b = v[j];
        if (
          (a.x === b.x &&
            q.x === a.x &&
            q.y >= Math.min(a.y, b.y) &&
            q.y <= Math.max(a.y, b.y)) ||
          (a.y === b.y &&
            q.y === a.y &&
            q.x >= Math.min(a.x, b.x) &&
            q.x <= Math.max(a.x, b.x))
        )
          return false;
        if (
          a.y > q.y !== b.y > q.y &&
          q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x
        )
          inside = !inside;
      }
      return inside;
    }
    if (tool === "edit" && !placement) {
      const hit = others.find(interior);
      if (hit) {
        onSectionSelect(hit.id);
        onSelect(true);
        onPartSelect(null);
        gesture.current = { kind: "blocked" };
        return;
      }
    }
    const target = (e.target as Element).closest("[data-building]");
    if (tool === "pan" || e.button === 1 || placement)
      gesture.current = { kind: "pan", start: p, camera: cameraRef.current };
    else if (target) {
      onSelect(true);
      if (section.locked) {
        setGeometryError("This section is locked. Unlock it to edit geometry.");
        gesture.current = { kind: "blocked" };
        return;
      }
      const handle = (e.target as Element)
        .closest("[data-corner]")
        ?.getAttribute("data-corner");
      const edge = (e.target as Element)
        .closest("[data-edge]")
        ?.getAttribute("data-edge");
      onPartSelect(
        handle != null
          ? { kind: "vertex", index: Number(handle) }
          : edge != null
            ? { kind: "edge", index: Number(edge) }
            : null,
      );
      gesture.current = {
        kind: "drag",
        start: p,
        section: structuredClone(section),
        corner: handle == null ? null : Number(handle),
        edge: edge == null ? null : Number(edge),
        camera: cameraRef.current,
      };
    } else {
      onSelect(false);
      onPartSelect(null);
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
      let result: Section;
      const base = storedSection(g.section, building);
      const vertices = footprintVertices(base);
      const localDelta = rotate(delta, -g.section.orientation);
      const assemblyDelta =
        building.frame.mode === "assembly"
          ? rotate(delta, -building.frame.axis - building.frame.rotation)
          : delta;
      const quantize = (n: number) =>
        step ? Math.round(n / step) * step : Math.round(n);
      if (g.edge != null) {
        const a = vertices[g.edge],
          b = vertices[(g.edge + 1) % vertices.length];
        const axis = a.x === b.x ? "x" : "y";
        result = withVertices(
          base,
          dragEdge(
            vertices,
            g.edge,
            quantize(a[axis] + localDelta[axis]) - a[axis],
          ),
        );
      } else if (g.corner != null && g.section.kind === "polygon") {
        const a = vertices[g.corner];
        result = withVertices(
          base,
          dragVertex(vertices, g.corner, {
            x: quantize(a.x + localDelta.x),
            y: quantize(a.y + localDelta.y),
          }),
        );
      } else if (g.corner != null) {
        const editBase = {
          ...base,
          orientation:
            building.frame.mode === "assembly"
              ? (base.orientation - building.frame.axis + 360) % 360
              : base.orientation + building.frame.rotation,
        };
        const anchor = corners(editBase)[g.corner];
        result = {
          ...base,
          ...resizeRectangle(
            editBase,
            g.corner,
            { x: anchor.x + assemblyDelta.x, y: anchor.y + assemblyDelta.y },
            step,
          ),
          orientation: base.orientation,
        };
      } else result = { ...base, ...moveRectangle(base, assemblyDelta, step) };
      result = displaySection(result, building);
      const error = validateChange(result);
      setGeometryError(error || "");
      preview(error ? null : result);
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
  const vertices = footprintVertices(display),
    box = bounds(vertices);
  const outerPath = polygonPath(vertices);
  const path = `${outerPath} ${polygonPath(insetPolygon(vertices, display.wallThickness))}`;
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
            !section.locked &&
            !placement &&
            tool === "edit" &&
            arrows[e.key] &&
            !pointers.current.size
          ) {
            e.preventDefault();
            const step =
                (snapEnabled && grid ? grid : 100) * (e.shiftKey ? 10 : 1),
              d = arrows[e.key];
            const base = storedSection(section, building);
            const result = moveRectangle(
              base,
              { x: d.x * step, y: d.y * step },
              null,
            );
            const next = displaySection({ ...base, ...result }, building),
              error = validateChange(next);
            if (!error) onChange(next);
            else setGeometryError(error);
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
          {others.map((other) => (
            <g
              key={other.id}
              data-section-id={other.id}
              transform={`translate(${other.position.x} ${other.position.y}) rotate(${other.orientation})`}
            >
              <path
                d={polygonPath(footprintVertices(other))}
                fill={other.locked ? "#e9debf" : "#dae6d9"}
                stroke={other.locked ? "#a68649" : "#91a58b"}
                strokeWidth={1 / s}
              />
            </g>
          ))}
          <g
            data-section-id={display.id}
            transform={`translate(${display.position.x} ${display.position.y}) rotate(${display.orientation})`}
            data-building="true"
          >
            {display.kind === "rectangle" ? (
              <rect
                width={display.length}
                height={display.width}
                fill="#f7f5ea"
                stroke="none"
              />
            ) : (
              <path d={outerPath} fill="#f7f5ea" stroke="none" />
            )}
            <path
              d={path}
              fill={building.sections.length > 1 ? "none" : "#46655e"}
              fillRule="evenodd"
              stroke={building.sections.length > 1 ? "none" : "#23463e"}
              strokeWidth={1.25 / s}
            />
            {selected && (
              <path
                d={outerPath}
                fill="none"
                stroke={section.locked ? "#8b633a" : "#b27b31"}
                strokeWidth={2 / s}
                strokeDasharray={`${5 / s} ${4 / s}`}
                pointerEvents="none"
              />
            )}
            {selected &&
              !section.locked &&
              !placement &&
              tool === "edit" &&
              vertices.map((a, i) => {
                const b = vertices[(i + 1) % vertices.length],
                  active = part?.kind === "edge" && part.index === i;
                return (
                  <g
                    key={i}
                    data-building="true"
                    data-edge={i}
                    className="edge-handle"
                  >
                    <path
                      d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                      stroke="transparent"
                      strokeWidth={44 / s}
                      fill="none"
                    />
                    {active && (
                      <path
                        d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                        stroke="#c37b1d"
                        strokeWidth={4 / s}
                        fill="none"
                        pointerEvents="none"
                      />
                    )}
                    {display.kind === "polygon" && (
                      <text
                        transform={
                          a.x === b.x
                            ? `translate(${a.x - 12 / s} ${(a.y + b.y) / 2}) rotate(-90)`
                            : `translate(${(a.x + b.x) / 2} ${a.y - 12 / s})`
                        }
                        className="dimension-text"
                        textAnchor="middle"
                        fontSize={11 / s}
                        pointerEvents="none"
                      >
                        E{i + 1}
                        {active || edgeLength(vertices, i) * s > 95
                          ? ` · ${metres(edgeLength(vertices, i))} m`
                          : ""}
                      </text>
                    )}
                  </g>
                );
              })}
            {display.kind === "rectangle" && (
              <>
                {display.length * s > 190 && (
                  <text
                    x={box.minX + display.length / 2}
                    y={box.minY + display.width / 2 - 6 / s}
                    textAnchor="middle"
                    fontSize={13 / s}
                    fill="#315448"
                    pointerEvents="none"
                  >
                    RECTANGULAR SECTION
                  </text>
                )}
                <text
                  x={box.minX + display.length / 2}
                  y={
                    box.minY +
                    display.width / 2 +
                    (display.length * s > 190 ? 15 : 4) / s
                  }
                  textAnchor="middle"
                  fontSize={12 / s}
                  fill="#60776d"
                  pointerEvents="none"
                >
                  {metres(display.length)} × {metres(display.width)} m
                </text>
              </>
            )}
            <g
              stroke="#748c80"
              strokeWidth={1 / s}
              fill="none"
              pointerEvents="none"
            >
              <path
                d={`M ${box.minX} ${box.minY - 14 / s} V ${box.minY - 40 / s} M ${box.maxX} ${box.minY - 14 / s} V ${box.minY - 40 / s} M ${box.minX} ${box.minY - 32 / s} H ${box.maxX}`}
              />
              <path
                d={`M ${box.minX - 14 / s} ${box.minY} H ${box.minX - 40 / s} M ${box.minX - 14 / s} ${box.maxY} H ${box.minX - 40 / s} M ${box.minX - 32 / s} ${box.minY} V ${box.maxY}`}
              />
            </g>
            <text
              className="dimension-text"
              x={box.minX + display.length / 2}
              y={box.minY - 40 / s}
              textAnchor="middle"
              fontSize={13 / s}
            >
              {metres(display.length)} m
            </text>
            <text
              className="dimension-text"
              transform={`translate(${box.minX - 42 / s} ${box.minY + display.width / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={13 / s}
            >
              {metres(display.width)} m
            </text>
          </g>
          {building.sections.length > 1 && (
            <g
              data-combined-wall="true"
              transform={`translate(${merged.envelope.position.x} ${merged.envelope.position.y}) rotate(${merged.envelope.orientation})`}
              pointerEvents="none"
            >
              <path
                d={`${polygonPath(merged.vertices)} ${polygonPath(merged.inner)}`}
                fill="#46655e"
                fillRule="evenodd"
                stroke="#23463e"
                strokeWidth={1.25 / s}
              />
            </g>
          )}
          {placement?.edge != null && merged.vertices[placement.edge] && (
            <g
              transform={`translate(${merged.envelope.position.x} ${merged.envelope.position.y}) rotate(${merged.envelope.orientation})`}
              pointerEvents="none"
            >
              <path
                data-attachment-edge="true"
                d={`M ${merged.vertices[placement.edge].x} ${merged.vertices[placement.edge].y} L ${merged.vertices[(placement.edge + 1) % merged.vertices.length].x} ${merged.vertices[(placement.edge + 1) % merged.vertices.length].y}`}
                stroke="#3b80a0"
                strokeWidth={5 / s}
                fill="none"
              />
            </g>
          )}
          {placementSection &&
            placement &&
            !validateFootprint(placement.candidate) && (
              <g
                data-placement-preview="true"
                transform={`translate(${placementSection.position.x} ${placementSection.position.y}) rotate(${placementSection.orientation})`}
                pointerEvents="none"
              >
                <path
                  d={polygonPath(footprintVertices(placementSection))}
                  fill={placement?.error ? "#cc635c66" : "#5a9d7966"}
                  stroke={placement?.error ? "#b43d35" : "#26704e"}
                  strokeWidth={2 / s}
                  strokeDasharray={`${7 / s} ${4 / s}`}
                />
              </g>
            )}
          {selected &&
            !section.locked &&
            !placement &&
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
                  fill={
                    part?.kind === "vertex" && part.index === i
                      ? "#c37b1d"
                      : "#fffaf0"
                  }
                  stroke="#a66e26"
                  strokeWidth={2 / s}
                  pointerEvents="none"
                />
              </g>
            ))}
        </g>
      </svg>
      {geometryError && (
        <div className="geometry-error" role="alert">
          {geometryError} Drag cancelled until geometry is valid.
        </div>
      )}
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
        <button onClick={() => setCamera(fitCamera(fitEnvelope(), viewport))}>
          Fit
        </button>
      </div>
    </div>
  );
}
