import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MIN_SIZE,
  MAX_SIZE,
  footprintVertices,
  GRID_PRESETS,
  metres,
  validateFootprint,
} from "./geometry";
import { commit, initialHistory, redo, undo, type History } from "./history";
import { type Architecture, type Project, type Section } from "./model";
import {
  applyPreset,
  scaleFootprint,
  shapeName,
  withVertices,
  type Part,
} from "./footprint";
import {
  dragVertex,
  edgeLength,
  setEdgeLength,
  MIN_EDGE,
  SHAPES,
  type Shape,
} from "./polygon";
import { saveProject } from "./storage";
import Editor from "./Editor";
import SectionsPanel from "./SectionsPanel";
import ExtensionPanel from "./ExtensionPanel";
import {
  combinedGeometry,
  prepareBuilding,
  replaceSection,
  displaySection,
  storedSection,
  canonicalVertices,
  SECTION_TYPES,
} from "./assembly";
import {
  attachmentBase,
  attachmentPreview,
  EXTENSION_TEMPLATES,
  removeSection,
  type AttachmentConfig,
} from "./attachments";
import { Brand, downloadProject, Modal, NumericField } from "./components";
type Props = {
  project: Project;
  onBack: () => void;
  onSaved: (p: Project) => void;
};
export default function Studio({ project, onBack, onSaved }: Props) {
  const [history, setHistory] = useState(() => initialHistory(project));
  const current = history.present;
  const historyRef = useRef(history);
  historyRef.current = history;
  const currentRef = useRef(current);
  currentRef.current = current;
  const saved = useRef(JSON.stringify(project));
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [saveState, setSaveState] = useState<"Saved" | "Saving" | "Save Error">(
    "Saved",
  );
  const [saveError, setSaveError] = useState("");
  const [leaving, setLeaving] = useState(false),
    [leaveError, setLeaveError] = useState(false);
  const [tool, setTool] = useState<"edit" | "pan">("edit");
  const [selected, setSelected] = useState(true);
  const [selectedId, setSelectedId] = useState(project.building.mainSectionId);
  const [attachment, setAttachment] = useState<{
    config: AttachmentConfig;
    source?: Section;
  } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [part, setPart] = useState<Part>(null);
  const [geometryError, setGeometryError] = useState("");
  const [grid, setGrid] = useState<number | null>(500),
    [snapEnabled, setSnap] = useState(true),
    [gridVisible, setGridVisible] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true),
    [inspectorOpen, setInspectorOpen] = useState(true);
  const section =
    current.building.sections.find((s) => s.id === selectedId) ??
    current.building.sections.find(
      (s) => s.id === current.building.mainSectionId,
    )!;
  const assembly = useMemo(
    () => combinedGeometry(current.building),
    [current.building],
  );
  const area = assembly;
  const placement = useMemo(
    () =>
      attachment
        ? attachmentPreview(
            current.building,
            attachment.config,
            attachment.source,
          )
        : null,
    [current.building, attachment],
  );
  function selectSection(id: string) {
    setSelectedId(id);
    setSelected(true);
    setPart(null);
  }
  function openAttachment(source?: Section) {
    if (current.building.sections.length >= 12) {
      setGeometryError("Maximum 12 sections reached.");
      return;
    }
    let edge = 0;
    if (activePart?.kind === "edge") {
      const b = attachmentBase(current.building),
        v = canonicalVertices(section, b),
        a = v[activePart.index],
        z = v[(activePart.index + 1) % v.length];
      edge = combinedGeometry(b).vertices.findIndex((p, i, all) => {
        const q = all[(i + 1) % all.length];
        return a.x === z.x
          ? p.x === a.x &&
              q.x === a.x &&
              Math.max(Math.min(a.y, z.y), Math.min(p.y, q.y)) <
                Math.min(Math.max(a.y, z.y), Math.max(p.y, q.y))
          : p.y === a.y &&
              q.y === a.y &&
              Math.max(Math.min(a.x, z.x), Math.min(p.x, q.x)) <
                Math.min(Math.max(a.x, z.x), Math.max(p.x, q.x));
      });
      if (edge < 0) {
        setGeometryError(
          "That edge is internal. Choose an external building edge for attachment.",
        );
        return;
      }
    }
    const t = EXTENSION_TEMPLATES[0];
    const config: AttachmentConfig = {
      id: crypto.randomUUID(),
      name: source ? `${source.name.slice(0, 93)} (copy)` : t.name,
      type: source?.type ?? t.type,
      length: source?.length ?? t.length,
      width: source?.width ?? t.width,
      shape: source ? shapeName(source) : t.shape,
      edge,
      offset: 0,
    };
    // Honour an explicitly selected edge. Otherwise begin on the first valid
    // exterior segment without changing the requested dimensions or shape.
    if (activePart?.kind !== "edge") {
      const outline = combinedGeometry(
        attachmentBase(current.building),
      ).vertices;
      for (let i = 0; i < outline.length; i++)
        if (
          !attachmentPreview(current.building, { ...config, edge: i }, source)
            .error
        ) {
          config.edge = i;
          break;
        }
    }
    setAttachment({ source, config });
    setInspectorOpen(true);
    setGeometryError("");
  }
  const vertices = footprintVertices(section);
  const activePart =
    selected && part && part.index < vertices.length ? part : null;
  const persist = useCallback(
    async (p: Project) => {
      setSaveState("Saving");
      setSaveError("");
      const operation = queue.current
        .catch(() => {})
        .then(() => saveProject(p));
      queue.current = operation;
      try {
        await operation;
        saved.current = JSON.stringify(p);
        onSaved(p);
        if (JSON.stringify(currentRef.current) === saved.current)
          setSaveState("Saved");
        return true;
      } catch (e) {
        setSaveState("Save Error");
        setSaveError(
          e instanceof Error ? e.message : "Local storage is unavailable.",
        );
        return false;
      }
    },
    [onSaved],
  );
  useEffect(() => {
    if (JSON.stringify(current) === saved.current) return;
    setSaveState("Saving");
    const timer = window.setTimeout(() => {
      void persist(current);
    }, 400);
    return () => clearTimeout(timer);
  }, [current, persist]);
  useEffect(() => {
    function before(e: BeforeUnloadEvent) {
      if (JSON.stringify(currentRef.current) !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    function visibility() {
      if (
        document.visibilityState === "hidden" &&
        JSON.stringify(currentRef.current) !== saved.current
      )
        void persist(currentRef.current);
    }
    window.addEventListener("beforeunload", before);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [persist]);
  function edit(next: Project) {
    if (JSON.stringify(currentRef.current) !== JSON.stringify(next))
      setSaveState("Saving");
    setHistory((h) => {
      if (JSON.stringify(h.present) === JSON.stringify(next)) return h;
      return commit(h, { ...next, updatedAt: new Date().toISOString() });
    });
  }
  function validateSectionChange(s: Section): string | null {
    try {
      replaceSection(current.building, s);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  function changeSection(s: Section, report = true) {
    const error = validateSectionChange(s);
    setGeometryError(report ? error || "" : "");
    if (error) return error;
    edit({ ...current, building: replaceSection(current.building, s) });
    return null;
  }
  function dimension(
    key: "length" | "width" | "wallThickness" | "orientation" | "floorCount",
    value: number,
  ) {
    if (
      (key === "length" || key === "width") &&
      (!Number.isSafeInteger(value) || value < MIN_SIZE || value > MAX_SIZE)
    )
      return "Length and width must be between 0.5 and 500 m.";
    if (key === "wallThickness" && current.building.sections.length > 1) {
      try {
        const building = prepareBuilding(
          {
            ...current.building,
            sections: current.building.sections.map((s) => ({
              ...s,
              wallThickness: value,
            })),
          },
          current.building,
        );
        edit({ ...current, building });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    }
    const next =
      key === "length" || key === "width"
        ? scaleFootprint(section, key, value)
        : { ...section, [key]: value };
    const error = validateFootprint(next);
    if (error) return error;
    if (![1, 2, 3, 4].includes(next.floorCount)) return "Choose 1–4 floors.";
    return changeSection(next, false);
  }
  function position(key: "x" | "y" | "z", value: number) {
    const next = {
        ...section,
        position: { ...section.position, [key]: value },
      },
      error = validateFootprint(next);
    if (error) return error;
    return changeSection(next, false);
  }
  function travel(action: (h: History<Project>) => History<Project>) {
    if (action(historyRef.current) === historyRef.current) return;
    setSaveState("Saving");
    setHistory((h) => {
      const next = action(h);
      return next === h
        ? h
        : {
            ...next,
            present: { ...next.present, updatedAt: new Date().toISOString() },
          };
    });
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input, select, textarea, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          travel(e.shiftKey ? redo : undo);
        }
        if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          travel(redo);
        }
        if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          void persist(currentRef.current);
        }
      } else if (e.key.toLowerCase() === "v") setTool("edit");
      else if (e.key.toLowerCase() === "h") setTool("pan");
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [persist]);
  async function back() {
    setLeaving(true);
    if (await persist(currentRef.current)) onBack();
    else {
      setLeaving(false);
      setLeaveError(true);
    }
  }
  const closeLeave = useCallback(() => setLeaveError(false), []);
  return (
    <div className="studio-shell">
      <header className="studio-header">
        <button
          className="back-button"
          onClick={() => void back()}
          disabled={leaving}
          aria-label="Back to project library"
        >
          ← <span>Library</span>
        </button>
        <Brand />
        <div className="studio-project">
          <strong>{current.name}</strong>
          <span
            className={`save-state ${saveState === "Save Error" ? "error" : ""}`}
            role="status"
          >
            {saveState === "Saved"
              ? "● "
              : saveState === "Saving"
                ? "◌ "
                : "! "}
            {saveState}
          </span>
        </div>
        <span className="version">BG-02B.1</span>
        <button
          className="export-button"
          onClick={() => downloadProject(current)}
        >
          Export JSON
        </button>
      </header>
      {saveState === "Save Error" && (
        <div className="error-banner" role="alert">
          {saveError}{" "}
          <button onClick={() => void persist(current)}>Retry save</button>
          <button onClick={() => downloadProject(current)}>
            Export backup
          </button>
        </div>
      )}
      <div className="studio-toolbar">
        <div className="tool-group">
          <button
            aria-pressed={tool === "edit"}
            onClick={() => setTool("edit")}
            title="Edit (V)"
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="m5 3 14 9-7 1-3 7Z" />
            </svg>{" "}
            <span>Edit</span>
          </button>
          <button
            aria-pressed={tool === "pan"}
            onClick={() => setTool("pan")}
            title="Pan (H)"
          >
            ✥ <span>Pan</span>
          </button>
        </div>
        <div className="tool-group">
          <button
            aria-label="Undo"
            title="Undo (⌘/Ctrl Z)"
            disabled={!history.past.length}
            onClick={() => travel(undo)}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title="Redo (⌘/Ctrl Shift Z)"
            disabled={!history.future.length}
            onClick={() => travel(redo)}
          >
            ↷
          </button>
        </div>
        <label className="grid-select">
          <span>Grid</span>
          <select
            aria-label="Grid spacing"
            value={grid ?? "free"}
            onChange={(e) =>
              setGrid(e.target.value === "free" ? null : Number(e.target.value))
            }
          >
            {GRID_PRESETS.map((n) => (
              <option key={n} value={n}>
                {metres(n)} m
              </option>
            ))}
            <option value="free">Free</option>
          </select>
        </label>
        <button
          className="toggle-button"
          aria-pressed={gridVisible}
          onClick={() => setGridVisible(!gridVisible)}
        >
          Grid <span>{gridVisible ? "on" : "off"}</span>
        </button>
        <button
          className="toggle-button"
          aria-pressed={snapEnabled}
          onClick={() => setSnap(!snapEnabled)}
        >
          Snap <span>{snapEnabled && grid ? "on" : "off"}</span>
        </button>
      </div>
      <div
        className={`studio-workspace ${leftOpen ? "" : "left-closed"} ${inspectorOpen ? "" : "inspector-closed"}`}
      >
        <aside className="structure-panel">
          <button
            className="panel-heading"
            onClick={() => setLeftOpen(!leftOpen)}
            aria-expanded={leftOpen}
          >
            <span>PROJECT</span>
            <span>{leftOpen ? "‹" : "›"}</span>
          </button>
          {leftOpen && (
            <div className="structure-content">
              <SectionsPanel
                building={current.building}
                selectedId={section.id}
                onSelect={selectSection}
                onAdd={() => openAttachment()}
              />
            </div>
          )}
        </aside>
        <main className="editor-main">
          <Editor
            section={displaySection(section, current.building)}
            building={current.building}
            placement={
              placement && attachment
                ? { ...placement, edge: attachment.config.edge }
                : null
            }
            onSectionSelect={selectSection}
            validateChange={(s) =>
              validateSectionChange(storedSection(s, current.building))
            }
            onChange={(s) => changeSection(storedSection(s, current.building))}
            grid={grid}
            snapEnabled={snapEnabled}
            gridVisible={gridVisible}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
            part={activePart}
            onPartSelect={setPart}
          />
          <footer className="editor-status">
            <span>
              {selected ? "Section selected" : "No selection"} ·{" "}
              {tool === "edit"
                ? "Drag to move · corners resize"
                : "Drag to pan"}
            </span>
            <span>Millimetre precision</span>
          </footer>
        </main>
        <aside className="inspector">
          <button
            className="panel-heading"
            onClick={() => setInspectorOpen(!inspectorOpen)}
            aria-expanded={inspectorOpen}
            aria-label="Toggle inspector"
          >
            <span>
              INSPECTOR{" "}
              <small>
                {selected ? `${shapeName(section)} footprint` : "Project"}
              </small>
            </span>
            <span>{inspectorOpen ? "−" : "+"}</span>
          </button>
          {inspectorOpen && (
            <div className="inspector-content">
              <div className="mobile-sections inspector-section">
                <SectionsPanel
                  building={current.building}
                  selectedId={section.id}
                  onSelect={selectSection}
                  onAdd={() => openAttachment()}
                />
              </div>
              {attachment && placement && (
                <ExtensionPanel
                  building={current.building}
                  config={attachment.config}
                  source={attachment.source}
                  error={placement.error}
                  onChange={(config) =>
                    setAttachment({ ...attachment, config })
                  }
                  onCancel={() => setAttachment(null)}
                  onAccept={() => {
                    if (placement.building) {
                      edit({ ...current, building: placement.building });
                      selectSection(placement.candidate.id);
                      setAttachment(null);
                    }
                  }}
                />
              )}
              <div className="inspector-section section-management">
                <h2>
                  {section.name} {section.locked && <span>LOCKED</span>}
                </h2>
                <label className="field">
                  <span>Selected section</span>
                  <select
                    aria-label="Selected section"
                    value={section.id}
                    onChange={(e) => selectSection(e.target.value)}
                  >
                    {current.building.sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.locked ? " · Locked" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="section-actions">
                  <button
                    onClick={() => openAttachment()}
                    disabled={
                      !!attachment || current.building.sections.length >= 12
                    }
                  >
                    Attach Extension
                  </button>
                  <button
                    onClick={() => {
                      const building = prepareBuilding(
                        {
                          ...current.building,
                          sections: current.building.sections.map((s) =>
                            s.id === section.id
                              ? { ...s, locked: !s.locked }
                              : s,
                          ),
                        },
                        current.building,
                      );
                      edit({ ...current, building });
                    }}
                  >
                    {section.locked ? "Unlock section" : "Lock section"}
                  </button>
                  <button
                    onClick={() => openAttachment(section)}
                    disabled={
                      !!attachment || current.building.sections.length >= 12
                    }
                  >
                    Duplicate section
                  </button>
                  <button
                    className="text-danger"
                    onClick={() => setRemoveId(section.id)}
                    disabled={
                      section.locked ||
                      section.id === current.building.mainSectionId ||
                      !!attachment
                    }
                  >
                    Remove section
                  </button>
                </div>
                <NumericField
                  label="Building rotation"
                  unit="°"
                  value={current.building.frame.rotation}
                  onCommit={(rotation) => {
                    if (
                      !Number.isFinite(rotation) ||
                      rotation < 0 ||
                      rotation >= 360
                    )
                      return "Rotation must be from 0° up to 360° exclusive.";
                    edit({
                      ...current,
                      building: {
                        ...current.building,
                        frame: { ...current.building.frame, rotation },
                      },
                    });
                    return null;
                  }}
                />
                {geometryError && (
                  <p role="alert" className="field-error">
                    {geometryError}
                  </p>
                )}
              </div>
              {selected && !attachment ? (
                <fieldset className="section-fields" disabled={section.locked}>
                  <div className="inspector-section">
                    <label className="field">
                      <span>Footprint Shape</span>
                      <select
                        aria-label="Footprint Shape"
                        value={shapeName(section)}
                        onChange={(e) => {
                          const next = applyPreset(
                              section,
                              e.target.value as Shape,
                            ),
                            error = validateFootprint(next);
                          setGeometryError(error || "");
                          if (!error) {
                            changeSection(next);
                            setPart(null);
                            setSelected(true);
                          }
                        }}
                      >
                        {SHAPES.map((shape) => (
                          <option key={shape}>{shape}</option>
                        ))}
                      </select>
                    </label>
                    <p className="field-hint">
                      Presets replace the outline. Undo restores the previous
                      footprint.
                    </p>
                    <h2>
                      Dimensions{" "}
                      <span>
                        {section.kind === "polygon"
                          ? "OUTER EXTENTS"
                          : "EXTERIOR"}
                      </span>
                    </h2>
                    <div className="field-row">
                      <NumericField
                        label="Length"
                        value={section.length}
                        onCommit={(v) => dimension("length", v)}
                      />
                      <NumericField
                        label="Width"
                        value={section.width}
                        onCommit={(v) => dimension("width", v)}
                      />
                    </div>
                    <NumericField
                      label="Wall thickness"
                      value={section.wallThickness}
                      onCommit={(v) => dimension("wallThickness", v)}
                    />
                    <p className="field-hint">
                      Exact inputs ignore snapping. Up to 0.001 m precision.
                    </p>
                    <p className="field-hint">
                      Combined building · {current.building.sections.length}{" "}
                      section(s) · Open-plan joins
                    </p>
                    <div className="area-summary">
                      <div>
                        <span>Exterior area</span>
                        <strong>
                          {area.exterior.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                          <small> m²</small>
                        </strong>
                      </div>
                      <div>
                        <span>Usable interior</span>
                        <strong>
                          {area.interior.toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                          <small> m²</small>
                        </strong>
                      </div>
                    </div>
                  </div>
                  <div className="inspector-section footprint-parts">
                    <h2>Vertices & edges</h2>
                    <label className="field">
                      <span>Select a part</span>
                      <select
                        aria-label="Select footprint part"
                        value={
                          activePart
                            ? `${activePart.kind}:${activePart.index}`
                            : ""
                        }
                        onChange={(e) => {
                          if (!e.target.value) setPart(null);
                          else {
                            const [kind, index] = e.target.value.split(":");
                            setPart({
                              kind: kind as "vertex" | "edge",
                              index: Number(index),
                            });
                          }
                        }}
                      >
                        <option value="">Whole footprint</option>
                        {vertices.map((_, i) => (
                          <option key={`e${i}`} value={`edge:${i}`}>
                            Edge {i + 1} · {metres(edgeLength(vertices, i))} m
                          </option>
                        ))}
                        {vertices.map((_, i) => (
                          <option key={`v${i}`} value={`vertex:${i}`}>
                            Vertex {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    {activePart?.kind === "edge" && (
                      <NumericField
                        key={`e${activePart.index}`}
                        label={`Edge ${activePart.index + 1} length`}
                        value={edgeLength(vertices, activePart.index)}
                        onCommit={(value) => {
                          if (value < MIN_EDGE)
                            return "Edge length must be at least 0.1 m.";
                          const next = withVertices(
                              section,
                              setEdgeLength(vertices, activePart.index, value),
                            ),
                            error = validateFootprint(next);
                          if (error) return error;
                          return changeSection(next, false);
                        }}
                      />
                    )}
                    {activePart?.kind === "vertex" && (
                      <div className="field-row">
                        {(["x", "y"] as const).map((axis) => (
                          <NumericField
                            key={`${activePart.index}${axis}`}
                            label={`Vertex ${activePart.index + 1} ${axis.toUpperCase()}`}
                            value={vertices[activePart.index][axis]}
                            onCommit={(value) => {
                              const point = {
                                  ...vertices[activePart.index],
                                  [axis]: value,
                                },
                                next = withVertices(
                                  section,
                                  dragVertex(vertices, activePart.index, point),
                                ),
                                error = validateFootprint(next);
                              if (error) return error;
                              return changeSection(next, false);
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <p className="field-hint">
                      Drag an edge perpendicular to itself. Moving a vertex
                      adjusts its two neighbours to keep right angles. Exact
                      edge length keeps its start fixed and moves the following
                      edge. Vertex coordinates are local, before rotation.
                    </p>
                  </div>
                  <div className="inspector-section">
                    <h2>Placement</h2>
                    <div className="field-row">
                      <NumericField
                        label="Position X"
                        value={section.position.x}
                        onCommit={(v) => position("x", v)}
                      />
                      <NumericField
                        label="Position Y"
                        value={section.position.y}
                        onCommit={(v) => position("y", v)}
                      />
                    </div>
                    <NumericField
                      label="Elevation Z"
                      value={section.position.z}
                      onCommit={(v) => position("z", v)}
                    />
                    <div className="field-row">
                      <NumericField
                        label="Orientation"
                        unit="°"
                        value={section.orientation}
                        onCommit={(v) => dimension("orientation", v)}
                      />
                      <NumericField
                        label="Floors"
                        unit=""
                        integer
                        value={section.floorCount}
                        onCommit={(v) => dimension("floorCount", v)}
                      />
                    </div>
                    <p className="field-hint">
                      X/Y use the shared assembly axes anchored at{" "}
                      {metres(current.building.frame.origin.x)},{" "}
                      {metres(current.building.frame.origin.y)} m. Joined
                      orientations must differ by quarter turns; use Building
                      rotation to rotate the whole design. Z and floors (1–4)
                      are metadata only.
                    </p>
                  </div>
                </fieldset>
              ) : (
                <div className="inspector-section empty-inspector">
                  <p>Select the building to edit measurements and placement.</p>
                  <button onClick={() => setSelected(true)}>
                    Select section
                  </button>
                </div>
              )}
              <div className="inspector-section">
                <h2>Building details</h2>
                <label className="field">
                  <span>Section name</span>
                  <input
                    aria-label="Section name"
                    key={`${section.id}:${section.name}`}
                    defaultValue={section.name}
                    maxLength={100}
                    disabled={section.locked}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name) changeSection({ ...section, name });
                      else e.target.value = section.name;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className="field">
                  <span>Section type</span>
                  <select
                    aria-label="Section type"
                    value={section.type}
                    disabled={section.locked}
                    onChange={(e) =>
                      changeSection({
                        ...section,
                        type: e.target.value as Section["type"],
                      })
                    }
                  >
                    {SECTION_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Project name</span>
                  <input
                    aria-label="Project name"
                    key={current.name}
                    defaultValue={current.name}
                    maxLength={100}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name) edit({ ...current, name });
                      else e.target.value = current.name;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </label>
                <label className="field">
                  <span>Architecture</span>
                  <select
                    value={current.architecture}
                    onChange={(e) =>
                      edit({
                        ...current,
                        architecture: e.target.value as Architecture,
                      })
                    }
                  >
                    <option>Medieval</option>
                    <option>Norse</option>
                    <option>Mixed</option>
                  </select>
                </label>
              </div>
              <div className="inspector-footnote">
                LOCAL WORKSPACE
                <br />
                <span>
                  Autosaved on this device. Export JSON for a portable backup.
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
      {removeId && (
        <Modal
          title="Remove architectural section?"
          onClose={() => setRemoveId(null)}
        >
          <p>
            This removes the selected section. The remaining building must stay
            connected. Undo can restore a successful removal.
          </p>
          <div className="modal-actions">
            <button onClick={() => setRemoveId(null)}>Cancel</button>
            <button
              className="danger"
              onClick={() => {
                try {
                  const building = removeSection(current.building, removeId);
                  edit({ ...current, building });
                  selectSection(current.building.mainSectionId);
                  setRemoveId(null);
                } catch (e) {
                  setGeometryError((e as Error).message);
                  setRemoveId(null);
                }
              }}
            >
              Confirm remove section
            </button>
          </div>
        </Modal>
      )}
      {leaveError && (
        <Modal title="Your latest edits are not saved" onClose={closeLeave}>
          <p>
            Local storage could not save this project. Keep editing, or export a
            backup before leaving.
          </p>
          <div className="modal-actions">
            <button onClick={closeLeave}>Keep editing</button>
            <button onClick={() => downloadProject(current)}>
              Export backup
            </button>
            <button className="danger" onClick={onBack}>
              Leave without saving
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
