import { useCallback, useEffect, useRef, useState } from "react";
import { areas, GRID_PRESETS, metres, validateRectangle } from "./geometry";
import { commit, initialHistory, redo, undo, type History } from "./history";
import { type Architecture, type Project, type Section } from "./model";
import { saveProject } from "./storage";
import Editor from "./Editor";
import { Brand, downloadProject, Modal, NumericField } from "./components";
type Props = {
  project: Project;
  onBack: () => void;
  onSaved: (p: Project) => void;
};
export default function Studio({ project, onBack, onSaved }: Props) {
  const [history, setHistory] = useState(() => initialHistory(project));
  const current = history.present;
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
  const [grid, setGrid] = useState<number | null>(500),
    [snapEnabled, setSnap] = useState(true),
    [gridVisible, setGridVisible] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true),
    [inspectorOpen, setInspectorOpen] = useState(true);
  const section = current.building.sections[0],
    area = areas(section);
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
    setHistory((h) => {
      if (JSON.stringify(h.present) === JSON.stringify(next)) return h;
      return commit(h, { ...next, updatedAt: new Date().toISOString() });
    });
  }
  function changeSection(s: Section) {
    edit({ ...current, building: { ...current.building, sections: [s] } });
  }
  function dimension(
    key: "length" | "width" | "wallThickness" | "orientation" | "floorCount",
    value: number,
  ) {
    const next = { ...section, [key]: value };
    const error = validateRectangle(next);
    if (error) return error;
    if (![1, 2, 3, 4].includes(next.floorCount)) return "Choose 1–4 floors.";
    changeSection(next);
    return null;
  }
  function position(key: "x" | "y" | "z", value: number) {
    const next = {
        ...section,
        position: { ...section.position, [key]: value },
      },
      error = validateRectangle(next);
    if (error) return error;
    changeSection(next);
    return null;
  }
  function travel(action: (h: History<Project>) => History<Project>) {
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
        <span className="version">BG-01</span>
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
              <p className="eyebrow">BUILDING STRUCTURE</p>
              <button
                className={`section-button ${selected ? "selected" : ""}`}
                onClick={() => setSelected(true)}
              >
                <span>▱</span>
                <span>
                  Rectangular section
                  <small>
                    {metres(section.length)} × {metres(section.width)} m
                  </small>
                </span>
              </button>
              <p className="panel-note">
                One precise footprint.
                <br />A foundation for what comes next.
              </p>
              <div className="project-spec">
                <span>{current.architecture} architecture</span>
                <span>
                  {section.floorCount}{" "}
                  {section.floorCount === 1 ? "floor" : "floors"} · metadata
                  only
                </span>
              </div>
            </div>
          )}
        </aside>
        <main className="editor-main">
          <Editor
            section={section}
            onChange={changeSection}
            grid={grid}
            snapEnabled={snapEnabled}
            gridVisible={gridVisible}
            tool={tool}
            selected={selected}
            onSelect={setSelected}
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
              <small>{selected ? "Rectangular section" : "Project"}</small>
            </span>
            <span>{inspectorOpen ? "−" : "+"}</span>
          </button>
          {inspectorOpen && (
            <div className="inspector-content">
              {selected ? (
                <>
                  <div className="inspector-section">
                    <h2>
                      Dimensions <span>EXTERIOR</span>
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
                      X/Y: plan position at the section’s first corner. Z:
                      elevation. Floors (1–4) are metadata only.
                    </p>
                  </div>
                </>
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
