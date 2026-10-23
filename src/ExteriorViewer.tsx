import { useEffect, useMemo, useRef, useState } from "react";
import type { Building } from "./model";
import { buildExterior } from "./exteriorGeometry";
import { createExteriorScene, type ExteriorScene } from "./exteriorScene";
export default function ExteriorViewer({
  building,
  selectedId,
  onSelect,
}: {
  building: Building;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<ExteriorScene | null>(null),
    pick = useRef(onSelect);
  pick.current = onSelect;
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false),
    [ortho, setOrtho] = useState(false),
    [pan, setPan] = useState(false);
  const geometry = useMemo(() => {
    try {
      return { model: buildExterior(building), error: "" };
    } catch (e) {
      return { model: null, error: (e as Error).message };
    }
  }, [building]);
  useEffect(() => {
    setReady(false);
    setError("");
    let view: ExteriorScene | null = null;
    try {
      view = createExteriorScene(
        host.current!,
        (id) => pick.current(id),
        setError,
      );
      scene.current = view;
      setReady(true);
    } catch (e) {
      setError(
        `WebGL is unavailable: ${(e as Error).message}. Your saved project is unchanged. Use the 2D studio or retry with WebGL enabled.`,
      );
    }
    return () => {
      scene.current = null;
      view?.dispose();
    };
  }, [retry]);
  useEffect(() => {
    if (scene.current && geometry.model)
      try {
        scene.current.update(geometry.model, building);
      } catch (e) {
        setError(
          `3D rebuild failed: ${(e as Error).message}. Your plan is preserved.`,
        );
      }
  }, [geometry, building, retry, ready]);
  useEffect(
    () => scene.current?.select(selectedId),
    [selectedId, geometry, ready, retry],
  );
  useEffect(() => scene.current?.projection(ortho), [ortho, ready, retry]);
  useEffect(() => scene.current?.pan(pan), [pan, ready, retry]);
  const issue = error || geometry.error;
  return (
    <div
      className="canvas-wrap exterior-wrap"
      data-testid="exterior-viewer"
      data-roof-height={geometry.model?.maxHeight}
    >
      <div
        ref={host}
        className="exterior-viewport"
        role="application"
        aria-label="Exterior 3D viewer. Drag to orbit, two fingers to zoom and pan. Select a section by tapping its surface."
        data-render-status={issue ? "error" : ready ? "ready" : "loading"}
        tabIndex={0}
      />
      {issue ? (
        <div className="viewer-fallback" role="alert">
          <strong>3D viewer unavailable</strong>
          <p>{issue}</p>
          <button onClick={() => setRetry((n) => n + 1)}>Retry 3D</button>
          <p>Footprint and Interior Planning remain available above.</p>
        </div>
      ) : (
        <>
          <span className="exterior-caption">EXTERIOR / GROUND FLOOR</span>
          <div className="viewer-controls" aria-label="3D camera controls">
            <button aria-pressed={!pan} onClick={() => setPan(false)}>
              Orbit
            </button>
            <button aria-pressed={pan} onClick={() => setPan(true)}>
              Pan 3D
            </button>
            <button aria-pressed={ortho} onClick={() => setOrtho(!ortho)}>
              {ortho ? "Orthographic" : "Perspective"}
            </button>
            <button onClick={() => scene.current?.fit()}>Fit 3D</button>
            <button onClick={() => scene.current?.reset()}>Reset view</button>
          </div>
        </>
      )}
    </div>
  );
}
