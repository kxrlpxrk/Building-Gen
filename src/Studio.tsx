import BuildingGeneratorPanel from "./BuildingGeneratorPanel";
import type { BuildingProposal } from "./buildingGenerator";
import GeneratorPanel from "./GeneratorPanel";
import { acceptGeneratedLayout, type LayoutProposal } from "./layoutGenerator";
import DoorsInspector from "./DoorsInspector";
import { changeOpenings } from "./openingBuilding";
import { type Opening } from "./openings";
import { circulation } from "./circulation";
import InteriorInspector, {
  type InteriorTool,
  type InteriorSelection,
} from "./InteriorInspector";
import { changePartitions } from "./interiorBuilding";
import { deriveInterior, type Partition, type RoomRecord } from "./interior";
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
  openingContext,
  translateBuilding,
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
  onCreate: (p: Project) => Promise<void>;
};
export default function Studio({ project, onBack, onSaved, onCreate }: Props) {
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
  const [buildingGeneratorOpen, setBuildingGeneratorOpen] = useState(false);
  const [buildingPreview, setBuildingPreview] =
    useState<BuildingProposal | null>(null);
  const [creatingGenerated, setCreatingGenerated] = useState(false);
  const closeBuildingGenerator = () => {
    setBuildingGeneratorOpen(false);
    setBuildingPreview(null);
    setTool("edit");
  };
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const anyGenerator = generatorOpen || buildingGeneratorOpen;
  const [layoutPreview, setLayoutPreview] = useState<LayoutProposal | null>(
    null,
  );
  const closeGenerator = () => {
    setGeneratorOpen(false);
    setLayoutPreview(null);
    setTool("edit");
  };
  const viewBuilding =
    buildingPreview?.project.building ??
    layoutPreview?.building ??
    current.building;
  const [mode, setMode] = useState<"footprint" | "interior">("footprint");
  const [interiorTool, setInteriorTool] = useState<InteriorTool>("wall");
  const [interiorSelection, setInteriorSelection] =
    useState<InteriorSelection>(null);
  const [openingDraft, setOpeningDraft] = useState<Opening | null>(null);
  const [passage, setPassage] = useState(false);
  useEffect(() => setOpeningDraft(null), [mode, interiorTool, current]);
  const [partitionThickness, setPartitionThickness] = useState(100);
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
  const doorsContext = useMemo(
    () => openingContext(current.building, assembly),
    [current.building, assembly],
  );
  const access = useMemo(
    () => circulation(doorsContext, current.building.openings),
    [doorsContext, current.building.openings],
  );
  function doorsChange(openings: Opening[], preview = false): string | null {
    try {
      const building = changeOpenings(current.building, openings);
      if (!preview) {
        edit({ ...current, building });
        setGeometryError("");
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  const interiorGeometry = useMemo(
    () => deriveInterior(assembly.inner, current.building.interior.partitions),
    [assembly, current.building.interior.partitions],
  );
  function interiorWalls(walls: Partition[], preview = false): string | null {
    try {
      const building = changePartitions(current.building, walls);
      if (!preview) {
        edit({ ...current, building });
        setGeometryError("");
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  function roomMetadata(room: RoomRecord) {
    const rooms = current.building.interior.rooms;
    const existing = rooms.find(
      (r) => r.regionKey !== null && r.regionKey === room.regionKey,
    );
    if (!existing && rooms.length >= 512) {
      setGeometryError(
        "Remove an unused retained room label before adding another assignment (512 record limit).",
      );
      return;
    }
    setGeometryError("");
    const record = { ...room, id: existing?.id ?? room.id };
    edit({
      ...current,
      building: {
        ...current.building,
        interior: {
          ...current.building.interior,
          rooms: existing
            ? rooms.map((r) => (r.id === existing.id ? record : r))
            : [...rooms, record],
        },
      },
    });
  }
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
    if (buildingGeneratorOpen) return;
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
      } else if (e.key.toLowerCase() === "v" && !anyGenerator) {
        setTool("edit");
        setInteriorTool("wall");
      } else if (e.key.toLowerCase() === "h") setTool("pan");
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [persist, anyGenerator, buildingGeneratorOpen]);
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
          disabled={leaving || creatingGenerated}
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
        <span className="version">BG-04B</span>
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
      {current.building.interior.rooms.some((r) => r.regionKey === null) && (
        <div className="interior-notice" role="status">
          Previous room labels are retained for reassignment in Interior
          Planning.
        </div>
      )}
      {mode === "interior" && geometryError && (
        <div className="error-banner" role="alert">
          {geometryError}
        </div>
      )}
      <div className="studio-modes" aria-label="Studio planning modes">
        <button
          disabled={creatingGenerated}
          aria-pressed={mode === "footprint"}
          onClick={() => {
            closeGenerator();
            closeBuildingGenerator();
            setMode("footprint");
            setTool("edit");
          }}
        >
          Footprint
        </button>
        <button
          disabled={creatingGenerated}
          aria-pressed={mode === "interior"}
          onClick={() => {
            closeBuildingGenerator();
            setMode("interior");
            setTool("edit");
            setAttachment(null);
          }}
        >
          Interior Planning
        </button>
        {mode === "footprint" && (
          <button
            aria-pressed={buildingGeneratorOpen}
            disabled={creatingGenerated}
            onClick={() => {
              closeGenerator();
              setTool("pan");
              setAttachment(null);
              setBuildingGeneratorOpen(true);
              setInspectorOpen(true);
              setGeometryError("");
            }}
          >
            Generate Building
          </button>
        )}
        {mode === "interior" && (
          <>
            <button
              disabled={anyGenerator}
              aria-pressed={tool === "edit" && interiorTool === "draw"}
              onClick={() => {
                setInteriorTool("draw");
                setTool("edit");
              }}
            >
              Draw Wall
            </button>
            <button
              disabled={anyGenerator}
              aria-pressed={tool === "edit" && interiorTool === "room"}
              onClick={() => {
                setInteriorTool("room");
                setTool("edit");
              }}
            >
              Select Room
            </button>
            <button
              disabled={anyGenerator}
              aria-pressed={tool === "edit" && interiorTool === "door"}
              onClick={() => {
                setInteriorTool("door");
                setTool("edit");
              }}
            >
              Place Door
            </button>
            <button
              aria-pressed={generatorOpen}
              onClick={() => {
                setTool("pan");
                setGeneratorOpen(true);
                setInspectorOpen(true);
                setOpeningDraft(null);
                setGeometryError("");
              }}
            >
              Generate Layout
            </button>
          </>
        )}
      </div>
      <div className="studio-toolbar" data-read-only={anyGenerator}>
        <div className="tool-group">
          <button
            disabled={anyGenerator}
            aria-pressed={
              tool === "edit" &&
              (mode === "footprint" || interiorTool === "wall")
            }
            onClick={() => {
              setTool("edit");
              setInteriorTool("wall");
            }}
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
            <span>{mode === "interior" ? "Select Wall" : "Edit"}</span>
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
            disabled={buildingGeneratorOpen || !history.past.length}
            onClick={() => travel(undo)}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title="Redo (⌘/Ctrl Shift Z)"
            disabled={buildingGeneratorOpen || !history.future.length}
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
              {buildingGeneratorOpen ? (
                <div className="interior-overview">
                  <h2>
                    {buildingPreview
                      ? `Building ${buildingPreview.label}`
                      : "Building generator"}
                  </h2>
                  <p>
                    Read-only footprint proposals. Create a new project in the
                    Inspector; your current building stays unchanged.
                  </p>
                  {buildingPreview?.project.building.sections.map((s) => (
                    <p key={s.id}>
                      {s.name} · {s.type}
                    </p>
                  ))}
                </div>
              ) : mode === "footprint" ? (
                <SectionsPanel
                  building={current.building}
                  selectedId={section.id}
                  onSelect={selectSection}
                  onAdd={() => openAttachment()}
                />
              ) : generatorOpen ? (
                <div className="interior-overview">
                  <h2>
                    {layoutPreview
                      ? `Proposal ${layoutPreview.label}`
                      : "Layout generator"}
                  </h2>
                  <p>
                    Read-only previews. Compare and accept a proposal in the
                    Inspector, or cancel to return to your manual plan.
                  </p>
                </div>
              ) : (
                <div className="interior-overview">
                  <h2>Ground floor</h2>
                  <p>
                    Plan partitions and assign labels to clear regions. Exterior
                    sections are edited in Footprint mode.
                  </p>
                  {interiorGeometry.regions.map((r, i) => (
                    <button
                      key={r.key}
                      onClick={() =>
                        setInteriorSelection({ kind: "room", key: r.key })
                      }
                    >
                      {current.building.interior.rooms.find(
                        (m) => m.regionKey === r.key,
                      )?.name || `Unassigned ${i + 1}`}{" "}
                      · {(r.area / 1e6).toFixed(2)} m²
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
        <main className="editor-main">
          <Editor
            readOnly={anyGenerator}
            previewLabel={buildingPreview?.label ?? layoutPreview?.label}
            previewKind={buildingGeneratorOpen ? "Building" : "Layout"}
            interior={
              mode === "interior"
                ? {
                    tool: interiorTool,
                    selection: interiorSelection,
                    thickness: partitionThickness,
                    onSelect: setInteriorSelection,
                    onWalls: interiorWalls,
                    validate: (walls) => interiorWalls(walls, true),
                    openingDraft,
                    passage,
                    onOpeningDraft: setOpeningDraft,
                    validateOpenings: (openings) => doorsChange(openings, true),
                  }
                : undefined
            }
            section={displaySection(
              buildingPreview ? viewBuilding.sections[0] : section,
              viewBuilding,
            )}
            building={viewBuilding}
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
            tool={anyGenerator ? "pan" : tool}
            selected={buildingGeneratorOpen ? false : selected}
            onSelect={setSelected}
            part={activePart}
            onPartSelect={setPart}
          />
          <footer className="editor-status">
            <span>
              {buildingGeneratorOpen
                ? buildingPreview
                  ? `Building ${buildingPreview.label} preview · not saved`
                  : "Building configuration · original project"
                : generatorOpen
                  ? layoutPreview
                    ? `Layout ${layoutPreview.label} preview · not saved`
                    : "Layout configuration · original plan"
                  : mode === "interior"
                    ? "Ground-floor interior"
                    : selected
                      ? "Section selected"
                      : "No selection"}{" "}
              ·{" "}
              {tool === "pan"
                ? "Drag to pan"
                : mode === "footprint"
                  ? "Drag to move · corners resize"
                  : interiorTool === "draw"
                    ? "Tap start · tap end"
                    : interiorTool === "wall"
                      ? "Drag wall · endpoints resize"
                      : interiorTool === "door"
                        ? "Tap wall · preview · confirm"
                        : "Tap a clear region"}
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
                {mode === "interior"
                  ? "Interior Planning"
                  : selected
                    ? `${shapeName(section)} footprint`
                    : "Project"}
              </small>
            </span>
            <span>{inspectorOpen ? "−" : "+"}</span>
          </button>
          {(inspectorOpen || anyGenerator) && (
            <div className="inspector-content" hidden={!inspectorOpen}>
              {buildingGeneratorOpen ? (
                <BuildingGeneratorPanel
                  onPreview={setBuildingPreview}
                  onCancel={closeBuildingGenerator}
                  onCreate={async (generated) => {
                    setCreatingGenerated(true);
                    try {
                      if (
                        saved.current !== JSON.stringify(currentRef.current) &&
                        !(await persist(currentRef.current))
                      )
                        throw new Error(
                          "Save the current project or export a backup before creating another project.",
                        );
                      await onCreate(generated);
                    } finally {
                      setCreatingGenerated(false);
                    }
                  }}
                />
              ) : mode === "interior" ? (
                generatorOpen ? (
                  <GeneratorPanel
                    project={current}
                    onPreview={setLayoutPreview}
                    onCancel={closeGenerator}
                    onAccept={(proposal) => {
                      try {
                        const next = acceptGeneratedLayout(current, proposal);
                        edit(next);
                        closeGenerator();
                        setInteriorSelection(null);
                        setInteriorTool("room");
                        return null;
                      } catch (e) {
                        return (e as Error).message;
                      }
                    }}
                  />
                ) : (
                  <InteriorInspector
                    roomAccess={
                      interiorSelection?.kind === "room"
                        ? access.reachable.has(interiorSelection.key)
                        : undefined
                    }
                    doors={
                      <DoorsInspector
                        building={current.building}
                        context={doorsContext}
                        draft={openingDraft}
                        passage={passage}
                        onPassage={setPassage}
                        selectedId={
                          interiorSelection?.kind === "opening"
                            ? interiorSelection.id
                            : null
                        }
                        onDraft={setOpeningDraft}
                        onChange={doorsChange}
                        onSelect={(id) => {
                          setInteriorSelection({ kind: "opening", id });
                          setInteriorTool("door");
                          setTool("edit");
                        }}
                      />
                    }
                    building={current.building}
                    regions={interiorGeometry.regions}
                    partitionArea={interiorGeometry.partitionArea}
                    usableArea={interiorGeometry.usableArea}
                    selection={interiorSelection}
                    onSelect={setInteriorSelection}
                    onWalls={interiorWalls}
                    onRoom={roomMetadata}
                    onForget={(id) =>
                      edit({
                        ...current,
                        building: {
                          ...current.building,
                          interior: {
                            ...current.building.interior,
                            rooms: current.building.interior.rooms.filter(
                              (r) => r.id !== id,
                            ),
                          },
                        },
                      })
                    }
                    thickness={partitionThickness}
                    onPlacement={(key, value) => {
                      try {
                        if (
                          key === "rotation" &&
                          (!Number.isFinite(value) || value < 0 || value >= 360)
                        )
                          return "Use an angle from 0 to less than 360°.";
                        const building =
                          key === "rotation"
                            ? {
                                ...current.building,
                                frame: {
                                  ...current.building.frame,
                                  rotation: value,
                                },
                              }
                            : translateBuilding(current.building, {
                                ...current.building.frame.origin,
                                [key]: value,
                              });
                        edit({ ...current, building });
                        return null;
                      } catch (e) {
                        return (e as Error).message;
                      }
                    }}
                    onThickness={setPartitionThickness}
                  />
                )
              ) : (
                <>
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
                    <fieldset
                      className="section-fields"
                      disabled={section.locked}
                    >
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
                          Presets replace the outline. Undo restores the
                          previous footprint.
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
                                Edge {i + 1} · {metres(edgeLength(vertices, i))}{" "}
                                m
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
                                  setEdgeLength(
                                    vertices,
                                    activePart.index,
                                    value,
                                  ),
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
                                      dragVertex(
                                        vertices,
                                        activePart.index,
                                        point,
                                      ),
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
                          edge length keeps its start fixed and moves the
                          following edge. Vertex coordinates are local, before
                          rotation.
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
                          orientations must differ by quarter turns; use
                          Building rotation to rotate the whole design. Z and
                          floors (1–4) are metadata only.
                        </p>
                      </div>
                    </fieldset>
                  ) : (
                    <div className="inspector-section empty-inspector">
                      <p>
                        Select the building to edit measurements and placement.
                      </p>
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
                </>
              )}
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
