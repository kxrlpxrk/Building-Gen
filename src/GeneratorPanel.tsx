import { LAYOUT_PURPOSES, purposeLayout } from "./layoutPurposes";
import { useEffect, useId, useRef, useState } from "react";
import type { Project, Building } from "./model";
import { combinedGeometry, openingContext } from "./assembly";
import { ROOM_TYPES, deriveInterior, wallBox } from "./interior";
import { bounds, polygonPath } from "./polygon";
import { OpeningMask } from "./OpeningsLayer";
import OpeningsLayer from "./OpeningsLayer";
import {
  starterConfig,
  configError,
  hashSeed,
  SEARCH_LIMIT,
  type LayoutConfig,
  type LayoutResult,
  type LayoutProposal,
} from "./layoutGenerator";
import type { LayoutWorkerReply } from "./layoutWorker";
import { Modal } from "./components";
export function replacementSummary(b: Building) {
  return {
    partitions: b.interior.partitions.length,
    labels: b.interior.rooms.filter(
      (r) => r.name.trim() || r.type !== "Custom" || r.notes.trim(),
    ).length,
    rooms: b.interior.rooms.length,
    doors: b.openings.filter((o) => o.host.kind === "partition").length,
    entrances: b.openings.filter((o) => o.host.kind === "exterior").length,
  };
}
function Thumbnail({ proposal, id }: { proposal: LayoutProposal; id: string }) {
  const c = openingContext(proposal.building),
    box = bounds(c.outer),
    pad = Math.max(box.length, box.width) * 0.05,
    scale = 180 / (box.length + pad * 2);
  return (
    <svg
      aria-hidden="true"
      className="layout-thumbnail"
      viewBox={`${box.minX - pad} ${box.minY - pad} ${box.length + pad * 2} ${box.width + pad * 2}`}
    >
      <defs>
        <OpeningMask
          context={c}
          openings={proposal.building.openings}
          id={id}
        />
      </defs>
      <path d={polygonPath(c.outer)} fill="#46655e" mask={`url(#${id})`} />
      <path d={polygonPath(c.inner)} fill="#f7f5ea" />
      {c.regions.map((r) => (
        <g key={r.key}>
          <path
            d={r.loops.map(polygonPath).join(" ")}
            fill="#e2e8d5"
            fillRule="evenodd"
          />
          <text
            x={r.label.x}
            y={r.label.y}
            fontSize={9 / scale}
            textAnchor="middle"
            fill="#34534b"
          >
            {
              proposal.building.interior.rooms.find(
                (m) => m.regionKey === r.key,
              )?.name
            }
          </text>
        </g>
      ))}
      {proposal.building.interior.partitions.map((w) => (
        <rect key={w.id} {...wallBox(w)} fill="#46655e" mask={`url(#${id})`} />
      ))}
      <OpeningsLayer
        context={c}
        openings={proposal.building.openings}
        selected={null}
        scale={scale}
        interactive={false}
      />
    </svg>
  );
}
export default function GeneratorPanel({
  project,
  onPreview,
  onAccept,
  onCancel,
}: {
  project: Project;
  onPreview: (proposal: LayoutProposal | null) => void;
  onAccept: (proposal: LayoutProposal) => string | null;
  onCancel: () => void;
}) {
  const [config, setConfig] = useState<LayoutConfig>(starterConfig),
    [result, setResult] = useState<LayoutResult | null>(null),
    [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [compare, setCompare] = useState(false),
    [confirm, setConfirm] = useState(false);
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    id = useId().replace(/:/g, ""),
    initial = useRef(project);
  const usable =
      deriveInterior(combinedGeometry(project.building).inner, []).usableArea /
      1e6,
    count = config.rooms.reduce((n, r) => n + r.quantity, 0),
    required = config.rooms
      .filter((r) => r.priority === "Required")
      .reduce((n, r) => n + r.minimumArea * r.quantity, 0),
    proposal = result?.proposals[selected],
    summary = replacementSummary(project.building);
  useEffect(
    () => () => {
      request.current++;
      worker.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    if (initial.current !== project) {
      request.current++;
      worker.current?.terminate();
      setBusy(false);
      setResult(null);
      setConfirm(false);
      setError("The project changed. Generate new previews before accepting.");
      onPreview(null);
      initial.current = project;
    }
  }, [project]);
  function update(next: LayoutConfig) {
    setConfig(next);
    setResult(null);
    setConfirm(false);
    setError("");
    onPreview(null);
  }
  function generate(next = config) {
    const issue = configError(next);
    if (issue) {
      setError(issue);
      return;
    }
    worker.current?.terminate();
    const current = ++request.current;
    setConfig(next);
    setResult(null);
    setBusy(true);
    setProgress(0);
    setError("");
    setConfirm(false);
    onPreview(null);
    try {
      const w = new Worker(new URL("./layoutWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = (event: MessageEvent<LayoutWorkerReply>) => {
        if (current !== request.current) return;
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
      };
      w.onerror = () => {
        if (current !== request.current) return;
        w.terminate();
        setBusy(false);
        setError(
          "The layout worker could not complete. Manual planning and the saved project are unchanged.",
        );
      };
      w.postMessage({ project, config: next });
    } catch (e) {
      setBusy(false);
      setError(
        `Layout worker unavailable: ${(e as Error).message}. The saved project is unchanged.`,
      );
    }
  }
  function accept() {
    if (!proposal) return;
    if (initial.current !== project) {
      setError("The project changed. Generate new previews before accepting.");
      return;
    }
    const issue = onAccept(proposal);
    if (issue) {
      setError(issue);
      setConfirm(false);
    }
  }
  return (
    <div className="generator-panel">
      <section className="inspector-section">
        <h2>Generate Layout</h2>
        <p className="interior-help">
          Ground floor · 2–8 rooms · 0.1 m partitions · clear spans ≥ 1.8 m.
          Previews change no saved data. Rectangles, supported L/T shapes and
          connected wings use exact clear geometry.
        </p>
        <p data-testid="layout-minimum">
          Required minimum: <strong>{required.toFixed(2)} m²</strong> / usable{" "}
          <strong>{usable.toFixed(2)} m²</strong>.
        </p>
        <p className="interior-help">
          Allow room for partitions and passage thresholds. Preferred areas
          guide scoring; minimum areas are hard constraints for every included
          room.
        </p>
        <fieldset disabled={busy} className="generator-fields">
          <legend>Room requests · {count}/8</legend>
          <label className="field">
            <span>Interior purpose preset</span>
            <select
              aria-label="Interior purpose preset"
              value={config.purpose || "Custom"}
              onChange={(e) => {
                const purpose = e.target
                  .value as (typeof LAYOUT_PURPOSES)[number];
                update(
                  purpose === "Custom"
                    ? { ...config, purpose }
                    : purposeLayout(purpose, usable, config.seed),
                );
              }}
            >
              {LAYOUT_PURPOSES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <p className="interior-help">
            Presets recommend editable requirements. Custom retains your current
            requests. No bathrooms are added by a historical preset.
          </p>
          {config.rooms.map((r, index) => (
            <div className="layout-request" key={r.key}>
              <label className="field">
                <span>Room type</span>
                <select
                  aria-label={`Request ${index + 1} type`}
                  value={r.type}
                  onChange={(e) =>
                    update({
                      ...config,
                      rooms: config.rooms.map((v, i) =>
                        i === index
                          ? {
                              ...v,
                              type: e.target.value as typeof r.type,
                              name: e.target.value,
                              notes: "",
                            }
                          : v,
                      ),
                    })
                  }
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Room label</span>
                <input
                  aria-label={`Request ${index + 1} name`}
                  value={r.name ?? r.type}
                  maxLength={100}
                  onChange={(e) =>
                    update({
                      ...config,
                      rooms: config.rooms.map((v, i) =>
                        i === index ? { ...v, name: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Quantity</span>
                <input
                  aria-label={`Request ${index + 1} quantity`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={8}
                  value={r.quantity}
                  onChange={(e) =>
                    update({
                      ...config,
                      rooms: config.rooms.map((v, i) =>
                        i === index
                          ? { ...v, quantity: Number(e.target.value) }
                          : v,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Minimum area · m²</span>
                <input
                  aria-label={`Request ${index + 1} minimum area`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="any"
                  value={r.minimumArea}
                  onChange={(e) =>
                    update({
                      ...config,
                      rooms: config.rooms.map((v, i) =>
                        i === index
                          ? { ...v, minimumArea: Number(e.target.value) }
                          : v,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Preferred area · m²</span>
                <input
                  aria-label={`Request ${index + 1} preferred area`}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="any"
                  value={r.preferredArea}
                  onChange={(e) =>
                    update({
                      ...config,
                      rooms: config.rooms.map((v, i) =>
                        i === index
                          ? { ...v, preferredArea: Number(e.target.value) }
                          : v,
                      ),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Priority</span>
                <select
                  aria-label={`Request ${index + 1} priority`}
                  value={r.priority}
                  onChange={(e) =>
                    update({
                      ...config,
                      rooms: config.rooms.map((v, i) =>
                        i === index
                          ? {
                              ...v,
                              priority: e.target.value as typeof r.priority,
                            }
                          : v,
                      ),
                    })
                  }
                >
                  <option>Required</option>
                  <option>Preferred</option>
                </select>
              </label>
              <button
                disabled={count - r.quantity < 2}
                onClick={() =>
                  update({
                    ...config,
                    rooms: config.rooms.filter((_, i) => i !== index),
                  })
                }
              >
                Remove request {index + 1}
              </button>
            </div>
          ))}
          <button
            disabled={count >= 8 || config.rooms.length >= 8}
            onClick={() =>
              update({
                ...config,
                rooms: [
                  ...config.rooms,
                  {
                    key: crypto.randomUUID(),
                    type: "Custom",
                    quantity: 1,
                    minimumArea: 6,
                    preferredArea: 10,
                    priority: "Preferred",
                  },
                ],
              })
            }
          >
            Add room request
          </button>
          <label className="field">
            <span>Layout style</span>
            <select
              aria-label="Layout style"
              value={config.style}
              onChange={(e) =>
                update({
                  ...config,
                  style: e.target.value as LayoutConfig["style"],
                })
              }
            >
              <option>Compact</option>
              <option>Balanced</option>
              <option>Open</option>
            </select>
          </label>
          <label className="field">
            <span>Random seed</span>
            <input
              aria-label="Random seed"
              value={config.seed}
              maxLength={64}
              onChange={(e) => update({ ...config, seed: e.target.value })}
            />
          </label>
        </fieldset>
        <div className="section-actions">
          <button disabled={busy} onClick={() => generate()}>
            Generate
          </button>
          <button
            disabled={busy}
            onClick={() =>
              generate({
                ...config,
                seed: String(hashSeed(config.seed + ":next")),
              })
            }
          >
            Regenerate
          </button>
          <button
            disabled={!result?.proposals.length || busy}
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
          >
            Compare
          </button>
          <button
            onClick={() => {
              request.current++;
              worker.current?.terminate();
              onCancel();
            }}
          >
            Cancel generation
          </button>
        </div>
        {busy && (
          <p role="status">
            Generating on this device… {progress}/{SEARCH_LIMIT} cut
            evaluations. Cancel remains available.
          </p>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {result?.messages.map((m, i) => (
          <p role="status" className="interior-help" key={i}>
            {m}
          </p>
        ))}
      </section>
      {result && (
        <p className="inspector-section interior-help">
          Search completed: {result.evaluations} cut evaluations and{" "}
          {result.doorEvaluations} door slots.
        </p>
      )}
      {result && result.proposals.length > 0 && (
        <section className="inspector-section">
          <h2>Layout proposals</h2>
          <div className="section-actions">
            {result.proposals.map((p, i) => (
              <button
                key={p.label}
                aria-label={`Preview layout ${p.label}`}
                aria-pressed={selected === i}
                onClick={() => {
                  setSelected(i);
                  onPreview(p);
                }}
              >
                Preview {p.label} · {p.score}
              </button>
            ))}
          </div>
          <p className="interior-help">
            Quality ranks main-room hierarchy, practical proportions, real
            service connections, privacy, section suitability and partition
            simplicity. Private chambers cannot be required through-routes.
            Minimum sizes, valid geometry, unobstructed swings and complete
            access are mandatory. Previews are read-only; pan, zoom, pinch and
            Fit remain available.
          </p>
          {(compare ? result.proposals : proposal ? [proposal] : []).map(
            (p) => (
              <article key={p.label} className="layout-proposal">
                <h3>
                  Proposal {p.label} · score {p.score}
                </h3>
                <p>{p.summary}</p>
                <details className="interior-help">
                  <summary>Architectural quality breakdown</summary>
                  <dl className="interior-totals">
                    {Object.entries(p.quality.components).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>
                            {
                              (
                                {
                                  hierarchy: "Main-room hierarchy",
                                  proportions: "Room proportions",
                                  adjacency: "Functional connections",
                                  privacy: "Privacy",
                                  circulation: "Entrance circulation",
                                  sectionSuitability: "Section suitability",
                                  simplicity: "Partition simplicity",
                                } as Record<string, string>
                              )[key]
                            }
                          </dt>
                          <dd>{value}/100</dd>
                        </div>
                      ),
                    )}
                  </dl>
                </details>
                <ul aria-label={`Proposal ${p.label} architectural strengths`}>
                  {p.quality.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                {p.quality.warnings.length > 0 && (
                  <ul
                    aria-label={`Proposal ${p.label} architectural compromises`}
                  >
                    {p.quality.warnings.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
                <p>
                  Required rooms satisfied: {p.requiredSatisfied} /{" "}
                  {config.rooms
                    .filter((r) => r.priority === "Required")
                    .reduce((n, r) => n + r.quantity, 0)}
                  .
                </p>
                <Thumbnail proposal={p} id={`${id}-layout-${p.label}`} />
                <dl className="interior-totals">
                  <div>
                    <dt>Usable</dt>
                    <dd>{(p.usableArea / 1e6).toFixed(2)} m²</dd>
                  </div>
                  <div>
                    <dt>Assigned net rooms</dt>
                    <dd>{(p.assignedArea / 1e6).toFixed(2)} m²</dd>
                  </div>
                  <div>
                    <dt>Unassigned</dt>
                    <dd>{(p.unassignedArea / 1e6).toFixed(2)} m²</dd>
                  </div>
                  <div>
                    <dt>Passage thresholds</dt>
                    <dd>{(p.thresholdArea / 1e6).toFixed(2)} m²</dd>
                  </div>
                </dl>
                <p>
                  Access: all {p.building.interior.rooms.length} rooms
                  reachable.
                </p>
                {!summary.entrances && (
                  <p>
                    This proposal includes a new validated exterior entrance.
                  </p>
                )}
                <ul>
                  {openingContext(p.building).regions.map((r) => (
                    <li key={r.key}>
                      {
                        p.building.interior.rooms.find(
                          (m) => m.regionKey === r.key,
                        )?.name
                      }{" "}
                      · {(r.area / 1e6).toFixed(2)} m²
                    </li>
                  ))}
                </ul>
                {p.preferences.map((m, i) => (
                  <p className="interior-help" key={i}>
                    {m}
                  </p>
                ))}
                {p.omitted.length > 0 && (
                  <p>Preferred rooms omitted: {p.omitted.join(", ")}</p>
                )}
              </article>
            ),
          )}
          <p className="interior-help">
            Accept changes walls, room labels and openings in one Undo step.
            Existing exterior entrances are preserved.
          </p>
          <button
            className="primary"
            onClick={() =>
              summary.partitions || summary.rooms || summary.doors
                ? setConfirm(true)
                : accept()
            }
          >
            Accept layout {proposal?.label}
          </button>
        </section>
      )}
      {confirm && proposal && (
        <Modal
          title="Replace existing interior plan?"
          onClose={() => setConfirm(false)}
        >
          <p>
            This replaces {summary.partitions} partitions, {summary.rooms} room
            records ({summary.labels} labelled or noted) and {summary.doors}{" "}
            interior doors/openings. Existing room names and notes will be
            replaced. {summary.entrances} exterior entrances/openings are
            preserved unchanged.
          </p>
          {summary.labels > 0 && (
            <p>
              Labels replaced:{" "}
              {project.building.interior.rooms
                .filter(
                  (r) => r.name.trim() || r.notes.trim() || r.type !== "Custom",
                )
                .slice(0, 6)
                .map((r) => r.name || r.type)
                .join(", ")}
              {summary.labels > 6 ? `, and ${summary.labels - 6} more` : ""}.
            </p>
          )}
          <p>
            Accept proposal {proposal.label}? Undo restores the complete
            previous plan.
          </p>
          <div className="modal-actions">
            <button onClick={() => setConfirm(false)}>Keep current plan</button>
            <button className="danger" onClick={accept}>
              Confirm replace interior
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
