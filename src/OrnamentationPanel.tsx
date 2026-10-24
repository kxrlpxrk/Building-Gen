import { useEffect, useState } from "react";
import type { Building, Section } from "./model";
import { replaceSection, openingContext } from "./assembly";
import { buildExterior } from "./exteriorGeometry";
import { NumericField } from "./components";
import {
  ORNAMENT_LEVELS,
  ORNAMENT_TYPES,
  ORNAMENT_FINISHES,
  ornamentPreset,
  suggestedOrnament,
  isRoofOrnament,
  type Ornament,
  type Ornamentation,
} from "./ornamentation";
export default function OrnamentationPanel({
  building,
  section,
  onChange,
  onPreview,
}: {
  building: Building;
  section: Section;
  onChange: (s: Section) => string | null;
  onPreview: (b: Building | null) => void;
}) {
  const [draft, setDraft] = useState<Ornamentation | null>(null),
    [selected, setSelected] = useState(""),
    [type, setType] = useState<Ornament["type"]>(
      section.exterior.material === "Medieval" ||
        section.exterior.stylePreset.startsWith("Medieval")
        ? "Gable finial"
        : "Dragon head",
    ),
    [error, setError] = useState(""),
    [messages, setMessages] = useState<string[]>([]);
  const current = draft ?? section.exterior.ornamentation,
    item = current.items.find((o) => o.id === selected),
    hosts = openingContext(building).hosts.filter(
      (h) => h.ref.kind === "exterior" && h.ref.sectionId === section.id,
    );
  useEffect(() => {
    setDraft(null);
    setError("");
    setMessages([]);
  }, [section]);
  useEffect(() => {
    if (!draft) {
      onPreview(null);
      return;
    }
    try {
      const b = replaceSection(building, {
        ...section,
        exterior: { ...section.exterior, ornamentation: draft },
      });
      buildExterior(b);
      setError("");
      onPreview(b);
    } catch (e) {
      setError((e as Error).message);
      onPreview(null);
    }
    return () => onPreview(null);
  }, [draft, section, building, onPreview]);
  const patch = (change: Partial<Ornament>) => {
    if (!item) return null;
    setDraft({
      ...current,
      items: current.items.map((o) =>
        o.id === item.id ? { ...o, ...change } : o,
      ),
    });
    return null;
  };
  const anchor = (change: Partial<Ornament["anchor"]>) =>
    item
      ? patch({ anchor: { ...item.anchor, ...change } as Ornament["anchor"] })
      : null;
  function level(value: Ornamentation["level"]) {
    const result = ornamentPreset(building, section, value);
    setDraft(result.ornamentation);
    setMessages(result.messages);
    setSelected(result.ornamentation.items[0]?.id ?? "");
  }
  function add() {
    const base = suggestedOrnament(building, section, type),
      candidates: Ornament[] = [base];
    if (isRoofOrnament(type))
      for (const roofFeatureId of [
        null,
        ...section.exterior.roofFeatures.map((f) => f.id),
      ])
        for (const end of ["Negative", "Positive"] as const)
          candidates.push({
            ...base,
            anchor: { kind: "roof", roofFeatureId, end, offset: 0 },
          });
    if (base.anchor.kind === "wall")
      for (const h of hosts)
        for (const offset of [1000, 2000, 3500, 5000])
          candidates.push({
            ...base,
            anchor: {
              kind: "wall",
              edge: h.ref.kind === "exterior" ? h.ref.edge : 0,
              offset,
              sill: type === "Carved post" ? 350 : 1100,
            },
          });
    let candidate = base;
    for (const c of candidates) {
      try {
        replaceSection(building, {
          ...section,
          exterior: {
            ...section.exterior,
            ornamentation: {
              level: current.level === "None" ? "Subtle" : current.level,
              items: [...current.items, c],
            },
          },
        });
        candidate = c;
        break;
      } catch {}
    }
    setDraft({
      level: current.level === "None" ? "Subtle" : current.level,
      items: [...current.items, candidate],
    });
    setSelected(candidate.id);
    setMessages([]);
  }
  return (
    <section className="inspector-section ornamentation-panel">
      <h2>Architectural Ornamentation</h2>
      <p>
        Carved timber and grounded motifs on real architectural anchors. Presets
        replace this section’s ornament set only after acceptance; individual
        additions remain editable.
      </p>
      <fieldset className="section-fields" disabled={section.locked}>
        <label className="field">
          <span>Ornamentation level</span>
          <select
            aria-label="Ornamentation level"
            value={current.level}
            onChange={(e) => level(e.target.value as Ornamentation["level"])}
          >
            {ORNAMENT_LEVELS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ornament to add</span>
          <select
            aria-label="Ornament to add"
            value={type}
            onChange={(e) => setType(e.target.value as Ornament["type"])}
          >
            {ORNAMENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button disabled={current.items.length >= 12} onClick={add}>
          Add ornament preview
        </button>
        <label className="field">
          <span>Selected ornament</span>
          <select
            aria-label="Selected ornament"
            value={item?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose an ornament</option>
            {current.items.map((o, i) => (
              <option key={o.id} value={o.id}>
                {i + 1}. {o.type}
              </option>
            ))}
          </select>
        </label>
        {item && (
          <>
            <label className="field">
              <span>
                {item.type === "Dragon head"
                  ? "Dragon variant"
                  : "Carving variant"}
              </span>
              <select
                aria-label="Ornament variant"
                value={item.variant}
                onChange={(e) =>
                  patch({ variant: Number(e.target.value) as 1 | 2 | 3 })
                }
              >
                {[1, 2, 3].map((v) => (
                  <option key={v} value={v}>
                    {item.type === "Dragon head"
                      ? ["Serpent", "Hooked snout", "Crested wyrm"][v - 1]
                      : ["Geometric", "Interlaced", "Layered"][v - 1]}
                  </option>
                ))}
              </select>
            </label>
            <NumericField
              label="Ornament scale"
              unit="%"
              value={item.scale / 10}
              onCommit={(n) => patch({ scale: Math.round(n * 10) })}
            />
            <label className="field">
              <span>Wood finish</span>
              <select
                aria-label="Ornament finish"
                value={item.finish}
                onChange={(e) =>
                  patch({ finish: e.target.value as Ornament["finish"] })
                }
              >
                {ORNAMENT_FINISHES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <button
              aria-pressed={item.mirror}
              onClick={() => patch({ mirror: !item.mirror })}
            >
              {item.type === "Dragon head"
                ? "Flip dragon direction"
                : "Mirror carving"}
            </button>
            {item.anchor.kind === "roof" && (
              <>
                <label className="field">
                  <span>Roof anchor</span>
                  <select
                    aria-label="Ornament roof anchor"
                    value={item.anchor.roofFeatureId ?? "main"}
                    onChange={(e) =>
                      anchor({
                        roofFeatureId:
                          e.target.value === "main" ? null : e.target.value,
                      })
                    }
                  >
                    <option value="main">Main section ridge</option>
                    {section.exterior.roofFeatures.map((f, i) => (
                      <option key={f.id} value={f.id}>
                        Cross-gable {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Ridge terminal</span>
                  <select
                    aria-label="Ornament ridge end"
                    value={item.anchor.end}
                    onChange={(e) =>
                      anchor({ end: e.target.value as "Negative" | "Positive" })
                    }
                  >
                    <option>Negative</option>
                    <option>Positive</option>
                  </select>
                </label>
                <fieldset
                  disabled={["Gable panel", "Bargeboard"].includes(item.type)}
                >
                  <NumericField
                    label="Ornament ridge offset"
                    value={item.anchor.offset}
                    onCommit={(offset) => anchor({ offset })}
                  />
                </fieldset>
                <p>
                  Gable panels/bargeboards stay on the facade; terminal motifs
                  may move up to 1 m inboard.
                </p>
              </>
            )}
            {item.anchor.kind === "wall" && (
              <>
                <label className="field">
                  <span>Exposed wall</span>
                  <select
                    aria-label="Ornament wall"
                    value={item.anchor.edge}
                    onChange={(e) => anchor({ edge: Number(e.target.value) })}
                  >
                    {hosts.map(
                      (h) =>
                        h.ref.kind === "exterior" && (
                          <option key={h.ref.edge} value={h.ref.edge}>
                            Wall {h.ref.edge + 1}
                          </option>
                        ),
                    )}
                  </select>
                </label>
                <NumericField
                  label="Ornament wall offset"
                  value={item.anchor.offset}
                  onCommit={(offset) => anchor({ offset })}
                />
                <fieldset disabled={item.type === "Carved post"}>
                  <NumericField
                    label="Ornament elevation"
                    value={item.anchor.sill}
                    onCommit={(sill) => anchor({ sill })}
                  />
                </fieldset>
              </>
            )}
            {item.anchor.kind === "entrance" && (
              <label className="field">
                <span>Exterior entrance</span>
                <select
                  aria-label="Ornament entrance"
                  value={item.anchor.doorId}
                  onChange={(e) => anchor({ doorId: e.target.value })}
                >
                  <option value="missing-entrance">Choose an entrance</option>
                  {building.openings
                    .filter(
                      (o) =>
                        o.type === "exterior-door" &&
                        o.host.kind === "exterior" &&
                        o.host.sectionId === section.id,
                    )
                    .map((o, i) => (
                      <option key={o.id} value={o.id}>
                        Entrance {i + 1}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button
              onClick={() => {
                setDraft({
                  ...current,
                  items: current.items.filter((o) => o.id !== item.id),
                });
                setSelected("");
              }}
            >
              Remove ornament preview
            </button>
          </>
        )}
        <button onClick={() => level("None")}>
          Reset ornamentation preview
        </button>
        {messages.map((m, i) => (
          <p role="status" key={i}>
            {m}
          </p>
        ))}
        {draft && (
          <>
            <p role="status">
              Unsaved ornament preview: {current.items.length} items. Accept
              replaces the saved set of{" "}
              {section.exterior.ornamentation.items.length}.{" "}
              {error
                ? "Invalid placement; saved architecture is shown."
                : "Orbit to inspect before accepting."}
            </p>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <div className="section-actions">
              <button
                disabled={!!error}
                onClick={() => {
                  const issue = onChange({
                    ...section,
                    exterior: { ...section.exterior, ornamentation: draft },
                  });
                  setError(issue ?? "");
                  if (!issue) {
                    setDraft(null);
                    onPreview(null);
                  }
                }}
              >
                Accept ornamentation
              </button>
              <button
                onClick={() => {
                  setDraft(null);
                  setError("");
                  setMessages([]);
                  onPreview(null);
                }}
              >
                Cancel ornament preview
              </button>
            </div>
          </>
        )}
      </fieldset>
      <p>
        Limits: 12 per section / 48 per building. Roof ornaments need exposed
        rectangular Gable or cross-gable ends; wall bays avoid openings.
        Ornamentation is decorative, without a structural-engineering claim.
        Medieval level presets use finials rather than dragons; dragons can be
        selected explicitly.
      </p>
    </section>
  );
}
