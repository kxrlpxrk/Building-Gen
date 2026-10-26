import { useCallback, useEffect, useRef, useState } from "react";
import { metres } from "./geometry";
import {
  createProject,
  duplicateProject,
  parseProject,
  type Project,
} from "./model";
import {
  deleteProject,
  listProjects,
  loadProject,
  requestPersistentStorage,
  saveProject,
} from "./storage";
import { Brand, Modal } from "./components";
import Studio from "./Studio";
import { bounds, polygonPath } from "./polygon";
import { combinedGeometry } from "./assembly";
import { shapeName } from "./footprint";
type Dialog =
  | { kind: "new" }
  | { kind: "rename" | "delete" | "duplicate"; project: Project };
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [active, setActive] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true),
    [loadFailed, setLoadFailed] = useState(false),
    [error, setError] = useState(""),
    [warning, setWarning] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [dialogError, setDialogError] = useState("");
  const [view, setView] = useState<"dashboard" | "library">("dashboard"),
    [search, setSearch] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listProjects();
      setProjects(result.projects);
      setLoadFailed(false);
      setWarning(
        result.invalidCount
          ? `${result.invalidCount} unreadable project record(s) were left untouched. No defaults have replaced them.`
          : "",
      );
    } catch (e) {
      setError(message(e));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const onSaved = useCallback((p: Project) => {
    setProjects((old) =>
      [p, ...old.filter((item) => item.id !== p.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  }, []);
  const closeDialog = useCallback(() => {
    if (!busy) {
      setDialog(null);
      setDialogError("");
    }
  }, [busy]);
  function showDialog(next: Dialog) {
    setDialog(next);
    setName(
      next.kind === "new"
        ? ""
        : next.kind === "duplicate"
          ? `${next.project.name.slice(0, 93)} (copy)`
          : next.project.name,
    );
    setDialogError("");
  }
  async function open(p: Project) {
    setBusy(true);
    setError("");
    try {
      setActive(await loadProject(p.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!dialog || busy) return;
    if (dialog.kind !== "delete" && !name.trim()) {
      setDialogError("Enter a building name.");
      return;
    }
    setBusy(true);
    setDialogError("");
    try {
      if (dialog.kind === "delete") {
        await deleteProject(dialog.project.id);
        setProjects((old) => old.filter((p) => p.id !== dialog.project.id));
      } else {
        let next: Project;
        if (dialog.kind === "new") next = createProject(name.trim());
        else {
          const latest = await loadProject(dialog.project.id);
          next =
            dialog.kind === "duplicate"
              ? duplicateProject(latest, name.trim())
              : {
                  ...latest,
                  name: name.trim(),
                  updatedAt: new Date().toISOString(),
                };
        }
        await saveProject(next);
        onSaved(next);
        void requestPersistentStorage();
        if (dialog.kind === "new") setActive(next);
      }
      setDialog(null);
    } catch (e) {
      setDialogError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    setError("");
    setBusy(true);
    try {
      if (file.size > 1_000_000)
        throw new Error("Project file is too large (maximum 1 MB).");
      let imported = parseProject(await file.text());
      // Never overwrite a saved record, even when importing its own export.
      const existing = await listProjects();
      if (
        existing.projects.some((p) => p.id === imported.id) ||
        existing.invalidCount
      ) {
        const original = imported;
        imported = {
          ...duplicateProject(imported, imported.name),
          createdAt: original.createdAt,
          updatedAt: original.updatedAt,
        };
      }
      await saveProject(imported);
      onSaved(imported);
      void requestPersistentStorage();
      setActive(imported);
    } catch (e) {
      setError(
        `Import failed: ${message(e)} Existing projects have not been changed.`,
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  if (active)
    return (
      <Studio
        key={active.id}
        project={active}
        onSaved={onSaved}
        onCreate={async (p) => {
          await saveProject(p);
          onSaved(p);
          void requestPersistentStorage();
          setActive(p);
        }}
        onBack={() => {
          setActive(null);
          void refresh();
        }}
      />
    );
  const visible = projects
    .filter((p) =>
      `${p.name} ${p.architecture}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, view === "dashboard" && !search ? 6 : undefined);
  return (
    <div className="library-shell">
      <aside className="library-nav">
        <Brand />
        <nav aria-label="Main navigation">
          <button
            aria-current={view === "dashboard" ? "page" : undefined}
            onClick={() => setView("dashboard")}
          >
            <span>◫</span> Dashboard
          </button>
          <button
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            <span>▤</span> Project library <small>{projects.length}</small>
          </button>
        </nav>
        <div className="nav-bottom">
          <div className="rune" aria-hidden="true">
            ᛒ
          </div>
          <p>
            Good buildings begin
            <br />
            with a considered plan.
          </p>
          <span className="version">BG-06C.1.2</span>
        </div>
      </aside>
      <div className="library-body">
        <header className="library-topbar">
          <span>YOUR DESIGN WORKSPACE</span>
          <span className="local-badge">● Local storage</span>
          <span className="version mobile-version">BG-06C.1.2</span>
        </header>
        <main className="dashboard">
          <section className="welcome">
            <div>
              <p className="eyebrow">FROM FIRST LINE TO GREAT HALL</p>
              <h1>
                {view === "dashboard"
                  ? "A place for your next build."
                  : "Your project library."}
              </h1>
              <p>
                Shape medieval halls, Norse homesteads, and worlds of your own.
                <br className="desktop-break" /> Begin with a precise plan.
              </p>
            </div>
            <button
              className="primary new-button"
              disabled={loading || loadFailed || busy}
              onClick={() => showDialog({ kind: "new" })}
            >
              <span>＋</span> New Building
            </button>
          </section>
          <section className="workspace-overview">
            <div>
              <span className="overview-icon">▱</span>
              <div>
                <strong>Plan with precision</strong>
                <p>Exact measurements. Room to imagine.</p>
              </div>
            </div>
            <div className="overview-meta">
              <span>2D PLAN STUDIO</span>
              <span>METRIC · MILLIMETRE PRECISION</span>
            </div>
          </section>
          <section className="projects-section">
            <div className="section-title">
              <div>
                <p className="eyebrow">
                  {view === "dashboard"
                    ? "PICK UP WHERE YOU LEFT OFF"
                    : "ALL YOUR BUILDINGS"}
                </p>
                <h2>
                  {view === "dashboard" ? "Recent projects" : "Projects"}{" "}
                  <span>{projects.length.toString().padStart(2, "0")}</span>
                </h2>
              </div>
              <div className="library-actions">
                <input
                  aria-label="Search projects"
                  className="search"
                  type="search"
                  placeholder="Search projects…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  disabled={loading || loadFailed || busy}
                  onClick={() => fileInput.current?.click()}
                >
                  ↑ Import JSON
                </button>
                <input
                  ref={fileInput}
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  aria-label="Import project JSON file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
              </div>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button onClick={() => void refresh()}>Reload library</button>
              </div>
            )}
            {warning && (
              <div className="warning-banner" role="status">
                {warning}
              </div>
            )}
            {loading ? (
              <div className="empty-state" role="status">
                <span className="empty-icon">◌</span>
                <h3>Opening your workspace…</h3>
                <p>Reading projects saved on this device.</p>
              </div>
            ) : loadFailed ? (
              <div className="empty-state">
                <h3>Your project library could not be loaded</h3>
                <p>
                  Existing records have been left untouched. Restore storage
                  access and retry.
                </p>
                <button onClick={() => void refresh()}>Retry loading</button>
              </div>
            ) : !visible.length ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  ⌂
                </span>
                <h3>
                  {search
                    ? "No matching buildings"
                    : "Every great hall starts with a line."}
                </h3>
                <p>
                  {search
                    ? "Try a different name or architecture."
                    : "Create your first building or import an existing JSON plan."}
                </p>
                {!search && (
                  <button
                    className="primary"
                    onClick={() => showDialog({ kind: "new" })}
                  >
                    ＋ Create a building
                  </button>
                )}
              </div>
            ) : (
              <div className="project-grid">
                {visible.map((p) => (
                  <article className="project-card" key={p.id}>
                    <button
                      className="project-open"
                      aria-label={`Open ${p.name}`}
                      disabled={busy}
                      onClick={() => void open(p)}
                    >
                      <div
                        className={`project-preview architecture-${p.architecture.toLowerCase()}`}
                      >
                        <svg viewBox="0 0 280 160" aria-hidden="true">
                          <defs>
                            <pattern
                              id={`grid-${p.id}`}
                              width="16"
                              height="16"
                              patternUnits="userSpaceOnUse"
                            >
                              <path
                                d="M 16 0 H 0 V 16"
                                fill="none"
                                stroke="currentColor"
                                strokeOpacity=".13"
                              />
                            </pattern>
                          </defs>
                          <rect
                            width="280"
                            height="160"
                            fill={`url(#grid-${p.id})`}
                          />
                          <MiniPlan project={p} />
                        </svg>
                        <span className="architecture-tag">
                          {p.architecture}
                        </span>
                      </div>
                      <div className="project-info">
                        <h3>{p.name}</h3>
                        <p>
                          {shapeName(p.building.sections[0])} ·{" "}
                          {metres(combinedGeometry(p.building).envelope.length)}{" "}
                          ×{" "}
                          {metres(combinedGeometry(p.building).envelope.width)}{" "}
                          m <span>·</span>{" "}
                          {combinedGeometry(p.building).exterior.toLocaleString(
                            undefined,
                            {
                              maximumFractionDigits: 3,
                            },
                          )}{" "}
                          m²
                        </p>
                        <time dateTime={p.updatedAt}>
                          Edited{" "}
                          {new Date(p.updatedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </time>
                      </div>
                    </button>
                    <div className="card-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          showDialog({ kind: "rename", project: p })
                        }
                        aria-label={`Rename ${p.name}`}
                      >
                        Rename
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          showDialog({ kind: "duplicate", project: p })
                        }
                        aria-label={`Duplicate ${p.name}`}
                      >
                        Duplicate
                      </button>
                      <button
                        disabled={busy}
                        className="text-danger"
                        onClick={() =>
                          showDialog({ kind: "delete", project: p })
                        }
                        aria-label={`Delete ${p.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {busy && !dialog && (
              <p role="status" className="operation-status">
                Opening project…
              </p>
            )}
          </section>
          <footer className="library-footer">
            <span>
              BUILDING GENERATOR <b> / </b> BG-06C.1.2
            </span>
            <span>
              Saved on this device. Export your plans to keep a backup.
            </span>
          </footer>
        </main>
      </div>
      {dialog && (
        <Modal
          title={
            dialog.kind === "new"
              ? "Start a new building"
              : dialog.kind === "delete"
                ? "Delete this building?"
                : dialog.kind === "duplicate"
                  ? "Duplicate building"
                  : "Rename building"
          }
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {dialog.kind === "delete" ? (
              <p>
                “{dialog.project.name}” will be permanently removed from this
                device. Export a backup before deleting if you need to keep it.
              </p>
            ) : (
              <>
                <p>
                  {dialog.kind === "new"
                    ? "Your plan begins with a 12 × 8 m rectangular section and 0.2 m walls."
                    : dialog.kind === "duplicate"
                      ? "Create an independent copy, with its own geometry and history."
                      : "Choose a clear name for your plan."}
                </p>
                <label className="field">
                  <span>Building name</span>
                  <input
                    aria-label="Building name"
                    value={name}
                    maxLength={100}
                    placeholder="e.g. The Ashwood Hall"
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            {dialogError && (
              <p className="field-error" role="alert">
                {dialogError}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" disabled={busy} onClick={closeDialog}>
                Cancel
              </button>
              <button
                className={dialog.kind === "delete" ? "danger" : "primary"}
                disabled={busy}
                type="submit"
              >
                {busy
                  ? "Working…"
                  : dialog.kind === "new"
                    ? "Create building"
                    : dialog.kind === "delete"
                      ? "Delete building"
                      : dialog.kind === "duplicate"
                        ? "Create copy"
                        : "Save name"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function MiniPlan({ project }: { project: Project }) {
  const section = project.building.sections[0],
    geometry = combinedGeometry(project.building),
    vertices = geometry.vertices,
    box = bounds(vertices);
  const scale = Math.min(170 / box.length, 85 / box.width);
  return (
    <g
      transform={`translate(${(280 - box.length * scale) / 2} ${(160 - box.width * scale) / 2})`}
    >
      <g transform={`scale(${scale}) translate(${-box.minX} ${-box.minY})`}>
        <path
          d={`${polygonPath(vertices)} ${polygonPath(geometry.inner)}`}
          fill="currentColor"
          fillRule="evenodd"
          opacity=".8"
        />
      </g>
      <text
        x={(box.length * scale) / 2}
        y={-12}
        textAnchor="middle"
        fill="currentColor"
        fontSize="9"
      >
        {metres(box.length)} m ·{" "}
        {project.building.sections.length > 1
          ? `${project.building.sections.length} sections`
          : shapeName(section)}
      </text>
    </g>
  );
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : "An unexpected storage error occurred. Please retry.";
}
