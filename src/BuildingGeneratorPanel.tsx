import { useEffect, useRef, useState } from "react";
import { SECTION_TYPES, canonicalVertices, combinedGeometry } from "./assembly";
import { polygonPath, bounds, SHAPES } from "./polygon";
import { hashSeed } from "./layoutGenerator";
import {
  defaultBuildingConfig,
  createGeneratedProject,
  PURPOSES,
  COMPLEXITIES,
  BUILDING_TRIAL_LIMIT,
  type BuildingConfig,
  type BuildingProposal,
  type BuildingResult,
} from "./buildingGenerator";
import type { BuildingWorkerReply } from "./buildingWorker";
import type { Project } from "./model";
function Thumbnail({ proposal }: { proposal: BuildingProposal }) {
  const b = proposal.project.building,
    g = combinedGeometry(b),
    box = bounds(g.vertices),
    pad = Math.max(box.length, box.width) * 0.05;
  return (
    <svg
      aria-hidden="true"
      className="layout-thumbnail building-thumbnail"
      viewBox={`${box.minX - pad} ${box.minY - pad} ${box.length + 2 * pad} ${box.width + 2 * pad}`}
    >
      <path d={polygonPath(g.vertices)} fill="#e2e8d5" />
      {b.sections.map((s) => (
        <path
          key={s.id}
          d={polygonPath(canonicalVertices(s, b))}
          fill="none"
          stroke="#b49c67"
          strokeWidth={40}
          strokeDasharray="120 80"
        />
      ))}
      <path
        d={`${polygonPath(g.vertices)} ${polygonPath(g.inner)}`}
        fill="#46655e"
        fillRule="evenodd"
      />
    </svg>
  );
}
export default function BuildingGeneratorPanel({
  onPreview,
  onCancel,
  onCreate,
}: {
  onPreview: (p: BuildingProposal | null) => void;
  onCancel: () => void;
  onCreate: (p: Project) => Promise<void>;
}) {
  const [config, setConfig] = useState<BuildingConfig>(defaultBuildingConfig),
    [length, setLength] = useState("18"),
    [width, setWidth] = useState("8");
  const [result, setResult] = useState<BuildingResult | null>(null),
    [selected, setSelected] = useState(0),
    [compare, setCompare] = useState(false),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0),
    [name, setName] = useState("");
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      worker.current?.terminate();
    };
  }, []);
  const proposal = result?.proposals[selected];
  function update(next: BuildingConfig) {
    setConfig(next);
    setResult(null);
    setError("");
    onPreview(null);
  }
  function generate(regenerate = false) {
    worker.current?.terminate();
    const serial = ++request.current;
    const millimetres = (text: string) => {
      const n = Number(text) * 1000;
      return text.trim() && Math.abs(n - Math.round(n)) < 1e-6
        ? Math.round(n)
        : NaN;
    };
    const c = {
      ...config,
      length: millimetres(length),
      width: millimetres(width),
      seed: regenerate ? String(hashSeed(config.seed + ":next")) : config.seed,
    };
    setConfig(c);
    setResult(null);
    onPreview(null);
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const w = new Worker(new URL("./buildingWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = (event: MessageEvent<BuildingWorkerReply>) => {
        if (serial !== request.current) return;
        const data = event.data;
        if ("progress" in data) {
          setProgress(data.progress);
          return;
        }
        w.terminate();
        worker.current = null;
        setBusy(false);
        if ("error" in data) {
          setError(data.error);
          return;
        }
        setResult(data.result);
        setSelected(0);
        onPreview(data.result.proposals[0] ?? null);
        if (data.result.proposals.length)
          setName(data.result.proposals[0].project.name);
      };
      w.onerror = () => {
        if (serial !== request.current) return;
        w.terminate();
        worker.current = null;
        setBusy(false);
        setError(
          "The building worker could not complete. The original project is unchanged; retry or use manual editing.",
        );
      };
      w.postMessage(c);
    } catch (e) {
      setBusy(false);
      setError(
        `Building worker unavailable: ${(e as Error).message}. Your original project is unchanged.`,
      );
    }
  }
  async function create() {
    if (!proposal || creating) return;
    setCreating(true);
    setError("");
    try {
      await onCreate(createGeneratedProject(proposal, name));
    } catch (e) {
      if (mounted.current)
        setError(
          `Could not create project: ${(e as Error).message}. The original project is preserved. Retry or cancel.`,
        );
    } finally {
      if (mounted.current) setCreating(false);
    }
  }
  return (
    <div className="generator-panel building-generator">
      <section className="inspector-section">
        <h2>Generate Building</h2>
        <p>
          Footprints only. The current project, including its locks, rooms and
          doors, stays unchanged. Create a separate project from a proposal.
        </p>
        <p>
          Mandatory: exact main dimensions, outline (unless Auto), and all
          requested extensions. Preferences: architectural style, purpose,
          composition complexity and preferred section types.
        </p>
        <fieldset className="generator-fields" disabled={busy || creating}>
          <legend>Building configuration</legend>
          <label className="field">
            <span>Architecture</span>
            <select
              aria-label="Generated architecture"
              value={config.architecture}
              onChange={(e) =>
                update({
                  ...config,
                  architecture: e.target
                    .value as BuildingConfig["architecture"],
                })
              }
            >
              {["Norse", "Medieval", "Mixed"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Building purpose</span>
            <select
              aria-label="Building purpose"
              value={config.purpose}
              onChange={(e) =>
                update({
                  ...config,
                  purpose: e.target.value as BuildingConfig["purpose"],
                })
              }
            >
              {PURPOSES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Complexity</span>
            <select
              aria-label="Building complexity"
              value={config.complexity}
              onChange={(e) =>
                update({
                  ...config,
                  complexity: e.target.value as BuildingConfig["complexity"],
                })
              }
            >
              {COMPLEXITIES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <div className="layout-request">
            <label className="field">
              <span>Main length (m)</span>
              <input
                aria-label="Generated main length"
                inputMode="decimal"
                value={length}
                onChange={(e) => {
                  setLength(e.target.value);
                  update(config);
                }}
              />
            </label>
            <label className="field">
              <span>Main width (m)</span>
              <input
                aria-label="Generated main width"
                inputMode="decimal"
                value={width}
                onChange={(e) => {
                  setWidth(e.target.value);
                  update(config);
                }}
              />
            </label>
          </div>
          <label className="field">
            <span>Desired extensions · mandatory</span>
            <select
              aria-label="Desired extensions"
              value={config.extensions}
              onChange={(e) =>
                update({ ...config, extensions: Number(e.target.value) })
              }
            >
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Main starting outline</span>
            <select
              aria-label="Main starting outline"
              value={config.outline}
              onChange={(e) =>
                update({
                  ...config,
                  outline: e.target.value as BuildingConfig["outline"],
                })
              }
            >
              {["Auto", ...SHAPES].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <fieldset className="building-preferences">
            <legend>Preferred extension types · optional</legend>
            {SECTION_TYPES.map((t) => (
              <label key={t}>
                <input
                  type="checkbox"
                  checked={config.preferredTypes.includes(t)}
                  onChange={(e) =>
                    update({
                      ...config,
                      preferredTypes: e.target.checked
                        ? [...config.preferredTypes, t]
                        : config.preferredTypes.filter((v) => v !== t),
                    })
                  }
                />
                <span>{t}</span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Seed</span>
            <input
              aria-label="Building seed"
              value={config.seed}
              maxLength={64}
              onChange={(e) => update({ ...config, seed: e.target.value })}
            />
          </label>
        </fieldset>
        <p>
          Generator limits: 4–60 m main dimensions, 0.2 m exterior walls, ≥ 1.8
          m clear limbs, ≥ 2.2 m shared edges. A longhouse needs length ≥ 1.8 ×
          width. Complexity affects shapes, sizes and offsets; it never changes
          the requested extension count. All joins are open-plan.
        </p>
        <div className="section-actions">
          <button disabled={busy || creating} onClick={() => generate()}>
            Generate footprints
          </button>
          <button disabled={busy || creating} onClick={() => generate(true)}>
            Regenerate buildings
          </button>
          <button
            disabled={!result?.proposals.length || busy || creating}
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            Compare buildings
          </button>
          <button
            disabled={creating}
            onClick={() => {
              request.current++;
              worker.current?.terminate();
              onCancel();
            }}
          >
            Cancel building generation
          </button>
        </div>
        {busy && (
          <p role="status">
            Generating on this device… {progress}/{BUILDING_TRIAL_LIMIT}{" "}
            attachment trials. Cancel remains available.
          </p>
        )}
        {creating && <p role="status">Saving the new project…</p>}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {result?.messages.map((m, i) => (
          <p role="status" key={i}>
            {m}
          </p>
        ))}
        {result && (
          <p>
            Search: {result.attempts} composition attempts / {result.trials}{" "}
            attachment trials. Previews are not saved.
          </p>
        )}
      </section>
      {proposal && (
        <section className="inspector-section">
          <h2>Building proposals</h2>
          <div className="section-actions">
            {result!.proposals.map((p, i) => (
              <button
                disabled={creating}
                aria-label={`Preview building ${p.label}`}
                aria-pressed={selected === i}
                key={p.label}
                onClick={() => {
                  setSelected(i);
                  onPreview(p);
                }}
              >
                Preview {p.label} · {p.score}
              </button>
            ))}
          </div>
          {(compare ? result!.proposals : [proposal]).map((p) => (
            <article className="layout-proposal" key={p.label}>
              <h3>
                Building {p.label} · coherence score {p.score}
              </h3>
              <Thumbnail proposal={p} />
              <dl className="interior-totals">
                <div>
                  <dt>Exterior area</dt>
                  <dd>{(p.exteriorArea / 1e6).toFixed(2)} m²</dd>
                </div>
                <div>
                  <dt>Usable interior</dt>
                  <dd>{(p.interiorArea / 1e6).toFixed(2)} m²</dd>
                </div>
                <div>
                  <dt>Building extents</dt>
                  <dd>
                    {p.length / 1000} × {p.width / 1000} m
                  </dd>
                </div>
                <div>
                  <dt>Sections</dt>
                  <dd>{p.project.building.sections.length}</dd>
                </div>
              </dl>
              <ul>
                {p.project.building.sections.map((s) => (
                  <li key={s.id}>
                    {s.name} · {s.type} · {s.length / 1000} × {s.width / 1000} m
                  </li>
                ))}
              </ul>
              {p.explanation.map((s) => (
                <p key={s}>{s}</p>
              ))}
              {p.warnings.map((s) => (
                <p key={s}>{s}</p>
              ))}
            </article>
          ))}
          <p>
            Read-only preview: pan, zoom, pinch and Fit remain available. No
            interiors or doors are generated. BG-04A can be run later; complex
            shapes may safely return no solution.
          </p>
          <label className="field">
            <span>New project name</span>
            <input
              aria-label="Generated project name"
              maxLength={100}
              value={name}
              disabled={creating}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={creating}
            onClick={() => void create()}
          >
            Create New Project
          </button>
          <p>
            The original project is preserved. Current-building replacement is
            not offered.
          </p>
        </section>
      )}
    </div>
  );
}
