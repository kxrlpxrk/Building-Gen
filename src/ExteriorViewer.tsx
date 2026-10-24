import OrnamentPlacementControls from "./OrnamentPlacementControls";
import type { OrnamentPlacement } from "./ornamentPlacement";
import { type Ornament } from "./ornamentation";
import type { WindowPlacement } from "./windowPlacement";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Building } from "./model";
import { buildExterior } from "./exteriorGeometry";
import { createExteriorScene, type ExteriorScene } from "./exteriorScene";
export default function ExteriorViewer({
  building,
  readOnly = false,
  selectedId,
  onSelect,
  onRoof = () => {},
  selectedWindowId,
  onWindow,
  windowPlacement,
  ornamentPlacement,
  inlineOrnamentControls,
  selectedOrnamentId,
  onOrnament,
  snapStep,
}: {
  building: Building;
  readOnly?: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
  onRoof?: (sectionId: string, id: string) => void;
  selectedWindowId: string;
  onWindow: (sectionId: string, id: string) => void;
  windowPlacement: WindowPlacement;
  ornamentPlacement: OrnamentPlacement;
  inlineOrnamentControls: boolean;
  selectedOrnamentId: string;
  onOrnament: (sectionId: string, id: string) => void;
  snapStep: number | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<ExteriorScene | null>(null),
    pick = useRef(onSelect),
    windowPick = useRef(onWindow);
  const ornamentControl = useRef(ornamentPlacement),
    ornamentPick = useRef(onOrnament);
  ornamentControl.current = ornamentPlacement;
  ornamentPick.current = onOrnament;
  const [ornamentType, setOrnamentType] =
    useState<Ornament["type"]>("Dragon head");
  const roofPick = useRef(onRoof);
  roofPick.current = onRoof;
  const windowControl = useRef(windowPlacement),
    step = useRef(snapStep);
  windowControl.current = windowPlacement;
  step.current = snapStep;
  windowPick.current = onWindow;
  pick.current = onSelect;
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false),
    [ortho, setOrtho] = useState(false),
    [pan, setPan] = useState(false),
    [outline, setOutline] = useState(true);
  const previewBuilding = useRef("");
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
        (sectionId, id) => windowPick.current(sectionId, id),
        () => windowControl.current,
        () => step.current,
        (sectionId, id) => roofPick.current(sectionId, id),
        () => ornamentControl.current,
        (sectionId, id) => ornamentPick.current(sectionId, id),
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
      ornamentControl.current.cancel();
      view?.dispose();
    };
  }, [retry]);
  useEffect(() => {
    if (scene.current && geometry.model)
      try {
        scene.current.update(geometry.model, building);
        if (readOnly && previewBuilding.current !== building.id)
          scene.current.fit();
        previewBuilding.current = building.id;
      } catch (e) {
        setError(
          `3D rebuild failed: ${(e as Error).message}. Your plan is preserved.`,
        );
      }
  }, [geometry, building, retry, ready, readOnly]);
  useEffect(
    () =>
      scene.current?.select(
        outline ? selectedId : "",
        selectedWindowId,
        selectedOrnamentId,
      ),
    [
      selectedId,
      selectedWindowId,
      selectedOrnamentId,
      outline,
      geometry,
      ready,
      retry,
    ],
  );
  useEffect(() => scene.current?.projection(ortho), [ortho, ready, retry]);
  useEffect(() => scene.current?.pan(pan), [pan, ready, retry]);
  useEffect(
    () => scene.current?.windowPreview(windowPlacement.state),
    [windowPlacement.state, ready, retry],
  );
  useEffect(
    () => scene.current?.ornamentPreview(ornamentPlacement.state),
    [ornamentPlacement.state, geometry, ready, retry],
  );
  useEffect(() => {
    if (readOnly) {
      ornamentControl.current.cancel();
      windowControl.current.cancel();
    }
  }, [readOnly]);
  useEffect(() => {
    if (ornamentPlacement.state)
      setOrnamentType(ornamentPlacement.state.template.type);
  }, [ornamentPlacement.state?.template.type]);
  const issue = error || geometry.error;
  return (
    <>
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
            <div className="window-toolbar">
              <button
                disabled={readOnly}
                onClick={windowPlacement.start}
                aria-pressed={windowPlacement.state?.mode === "place"}
              >
                Place Window
              </button>
              <button
                disabled={readOnly}
                onClick={() => ornamentPlacement.start(ornamentType)}
                aria-pressed={!!ornamentPlacement.state}
              >
                Place Ornament
              </button>
              <button
                aria-pressed={outline}
                title="Selection annotation only; does not change architecture"
                onClick={() => setOutline(!outline)}
              >
                Section outline
              </button>
              {!readOnly && selectedWindowId && !windowPlacement.state && (
                <button
                  onClick={() => {
                    const section = building.sections.find((s) =>
                      s.exterior.windows.some((w) => w.id === selectedWindowId),
                    );
                    const window = section?.exterior.windows.find(
                      (w) => w.id === selectedWindowId,
                    );
                    if (section && window)
                      windowPlacement.move({ sectionId: section.id, window });
                  }}
                >
                  Move Window
                </button>
              )}
              {!readOnly &&
                selectedOrnamentId &&
                !ornamentPlacement.state &&
                !windowPlacement.state &&
                (() => {
                  const section = building.sections.find((s) =>
                    s.exterior.ornamentation.items.some(
                      (o) => o.id === selectedOrnamentId,
                    ),
                  );
                  const ornament = section?.exterior.ornamentation.items.find(
                    (o) => o.id === selectedOrnamentId,
                  );
                  return section && ornament ? (
                    <button
                      disabled={section.locked}
                      onClick={() =>
                        ornamentPlacement.move({
                          sectionId: section.id,
                          ornament,
                        })
                      }
                    >
                      Move Ornament
                    </button>
                  ) : null;
                })()}
              {windowPlacement.state && (
                <>
                  <p
                    role="status"
                    className={
                      windowPlacement.state.issue
                        ? "placement-invalid"
                        : "placement-valid"
                    }
                  >
                    {windowPlacement.state.issue ||
                      (windowPlacement.state.draft
                        ? "Valid window preview"
                        : "Tap an exposed wall; drag to position")}{" "}
                    · {snapStep ? `Snap ${snapStep / 1000} m` : "Free"}. Two
                    fingers pan/zoom.
                  </p>
                  <button
                    disabled={
                      !windowPlacement.state.draft ||
                      !!windowPlacement.state.issue
                    }
                    onClick={windowPlacement.commit}
                  >
                    Confirm placement
                  </button>
                  <button onClick={windowPlacement.cancel}>
                    Cancel placement
                  </button>
                </>
              )}
            </div>
            <div className="viewer-controls" aria-label="3D camera controls">
              <button
                aria-pressed={
                  !pan && !windowPlacement.state && !ornamentPlacement.state
                }
                onClick={() => {
                  windowPlacement.cancel();
                  ornamentPlacement.cancel();
                  setPan(false);
                }}
              >
                Orbit
              </button>
              <button
                aria-pressed={pan}
                onClick={() => {
                  ornamentPlacement.cancel();
                  setPan(true);
                }}
              >
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
      {!issue && inlineOrnamentControls && ornamentPlacement.state && (
        <OrnamentPlacementControls
          ornamentPlacement={ornamentPlacement}
          snapStep={snapStep}
        />
      )}
    </>
  );
}
