import { useEffect, useRef, useState } from "react";
import {
  PURPOSES,
  COMPLEXITIES,
  type BuildingProposal,
  type BuildingResult,
} from "./buildingGenerator";
import {
  defaultArchitecturalConfig,
  purposeDefaults,
  createArchitecturalProject,
  SCALES,
  DENSITIES,
  type ArchitecturalConfig,
} from "./architecturalGenerator";
import { STYLE_PRESETS, ROOF_STYLES } from "./exteriorSettings";
import { Thumbnail } from "./BuildingGeneratorPanel";
import { hashSeed } from "./layoutGenerator";
import type { BuildingWorkerReply } from "./buildingWorker";
import type { Project } from "./model";
export default function ArchitecturalGeneratorPanel({
  onPreview,
  onCancel,
  onCreate,
}: {
  onPreview: (p: BuildingProposal | null) => void;
  onCancel: () => void;
  onCreate: (p: Project) => Promise<void>;
}) {
  const [config, setConfig] = useState(defaultArchitecturalConfig),
    [result, setResult] = useState<BuildingResult | null>(null),
    [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [compare, setCompare] = useState(true);
  const worker = useRef<Worker | null>(null),
    serial = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      serial.current++;
      worker.current?.terminate();
    };
  }, []);
  function update(patch: Partial<ArchitecturalConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
    setResult(null);
    onPreview(null);
    setError("");
  }
  function generate(next = false) {
    worker.current?.terminate();
    const id = ++serial.current;
    const c = {
      ...config,
      seed: next ? String(hashSeed(config.seed + ":next")) : config.seed,
    };
    setConfig(c);
    setBusy(true);
    setResult(null);
    setError("");
    onPreview(null);
    try {
      const w = new Worker(
        new URL("./architecturalWorker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      w.onmessage = (event: MessageEvent<BuildingWorkerReply>) => {
        if (id !== serial.current || !mounted.current) return;
        const data = event.data;
        if ("progress" in data) return;
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
        setName(data.result.proposals[0]?.project.name ?? "");
      };
      w.onerror = () => {
        if (id !== serial.current) return;
        w.terminate();
        setBusy(false);
        setError(
          "Architectural generation failed. The original project is unchanged; retry or cancel.",
        );
      };
      w.postMessage(c);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }
  const proposal = result?.proposals[selected];
  async function create() {
    if (!proposal || saving) return;
    setSaving(true);
    setError("");
    try {
      await onCreate(createArchitecturalProject(proposal, name));
    } catch (e) {
      if (mounted.current)
        setError(`Could not save new project: ${(e as Error).message}`);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const select = <K extends keyof ArchitecturalConfig>(
    label: string,
    key: K,
    options: readonly string[],
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={String(config[key])}
        onChange={(e) =>
          update({ [key]: e.target.value } as Partial<ArchitecturalConfig>)
        }
      >
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="generator-panel architectural-generator">
      <section className="inspector-section">
        <h2>Generate Architectural Building</h2>
        <p>
          Complete editable architecture, without interior rooms. Preview never
          changes the source project. Accept creates a separate project.
        </p>
        <fieldset className="generator-fields" disabled={busy || saving}>
          <legend>Architectural configuration</legend>
          <label className="field">
            <span>Building purpose</span>
            <select
              aria-label="Architectural building purpose"
              value={config.purpose}
              onChange={(e) => {
                const defaults = purposeDefaults(
                  e.target.value as ArchitecturalConfig["purpose"],
                );
                update({ ...defaults, seed: config.seed });
              }}
            >
              {PURPOSES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          {select("Architectural preset", "style", STYLE_PRESETS)}
          {select("Overall scale", "scale", SCALES)}
          {select("Architectural complexity", "complexity", COMPLEXITIES)}
          {config.scale === "Custom" && (
            <div className="layout-request">
              {(["length", "width"] as const).map((key) => (
                <label className="field" key={key}>
                  <span>Main {key} (m)</span>
                  <input
                    aria-label={`Architectural main ${key}`}
                    type="number"
                    min="4"
                    max="60"
                    step="0.001"
                    value={config[key] / 1000}
                    onChange={(e) =>
                      update({
                        [key]: Math.round(Number(e.target.value) * 1000),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <label className="field">
            <span>Extension count preference</span>
            <select
              aria-label="Architectural extensions"
              value={config.extensions}
              onChange={(e) => update({ extensions: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <details>
            <summary>Advanced architectural options</summary>
            <fieldset className="building-preferences">
              <legend>Preferred roof types · at least one</legend>
              {ROOF_STYLES.map((r) => (
                <label key={r}>
                  <input
                    type="checkbox"
                    checked={config.roofs.includes(r)}
                    onChange={(e) =>
                      update({
                        roofs: e.target.checked
                          ? [...config.roofs, r]
                          : config.roofs.filter((v) => v !== r),
                      })
                    }
                  />
                  {r}
                </label>
              ))}
            </fieldset>
            {select("Window density", "windows", DENSITIES)}
            {select("Architectural detail", "detail", [
              "Low",
              "Standard",
              "High",
            ])}
            <fieldset className="building-preferences">
              <legend>Optional features</legend>
              {(["chimneys", "ornaments", "canopies"] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={config[key]}
                    onChange={(e) => update({ [key]: e.target.checked })}
                  />
                  {key === "ornaments"
                    ? "Gable ornaments"
                    : key === "canopies"
                      ? "Entrance canopies"
                      : "Chimneys"}
                </label>
              ))}
            </fieldset>
          </details>
          <label className="field">
            <span>Seed</span>
            <input
              aria-label="Architectural seed"
              value={config.seed}
              maxLength={64}
              onChange={(e) => update({ seed: e.target.value })}
            />
          </label>
        </fieldset>
        <p>
          Mandatory: valid connected geometry, exact scale/custom dimensions and
          an exterior entrance. Extensions and optional features may be omitted
          with explanations. Rectangular source sections use repaired pitched
          intersections or closed steps.
        </p>
        <div className="section-actions">
          <button disabled={busy || saving} onClick={() => generate()}>
            Generate architecture
          </button>
          <button disabled={busy || saving} onClick={() => generate(true)}>
            Regenerate architecture
          </button>
          <button
            disabled={!result || busy || saving}
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            Compare architecture
          </button>
          <button
            disabled={saving}
            onClick={() => {
              serial.current++;
              worker.current?.terminate();
              onCancel();
            }}
          >
            Cancel architectural generation
          </button>
        </div>
        {busy && (
          <p role="status">
            Designing and validating on this device… Cancel remains available.
          </p>
        )}
        {saving && <p role="status">Saving new architectural project…</p>}
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
      </section>
      {proposal && (
        <section className="inspector-section">
          <h2>Architectural proposals</h2>
          <div className="section-actions">
            {result!.proposals.map((p, i) => (
              <button
                key={p.label}
                disabled={saving}
                aria-label={`Preview architecture ${p.label}`}
                aria-pressed={selected === i}
                onClick={() => {
                  setSelected(i);
                  onPreview(p);
                }}
              >
                Proposal {p.label} · {p.score}
              </button>
            ))}
          </div>
          {(compare ? result!.proposals : [proposal]).map((p) => (
            <article className="layout-proposal" key={p.label}>
              <h3>
                Design {p.label} · coherence {p.score}
              </h3>
              <Thumbnail proposal={p} />
              <p>
                {p.length / 1000} × {p.width / 1000} m overall ·{" "}
                {(p.exteriorArea / 1e6).toFixed(2)} m² exterior ·{" "}
                {(p.interiorArea / 1e6).toFixed(2)} m² usable ·{" "}
                {p.project.building.sections.length} sections
              </p>
              {p.explanation.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
              {p.warnings.map((s, i) => (
                <p className="save-note" key={i}>
                  {s}
                </p>
              ))}
            </article>
          ))}
          <p>
            The selected design is the only active 3D preview. Orbit, pan, pinch
            and Fit remain available. Windows and geometry are read-only until
            you create a project.
          </p>
          <label className="field">
            <span>New project name</span>
            <input
              aria-label="Architectural project name"
              value={name}
              disabled={saving}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={saving}
            onClick={() => void create()}
          >
            Create New Project
          </button>
        </section>
      )}
    </div>
  );
}
