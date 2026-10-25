import { useEffect, useState } from "react";
import type { Building, Section } from "./model";
import type { RoofFeature } from "./exteriorSettings";
import { ridgeAlongX } from "./exteriorSettings";
import { rotateCrossingFrame } from "./roofDirection";
import { defaultRoofFeature } from "./roofFeatures";
import { replaceSection } from "./assembly";
import { buildExterior } from "./exteriorGeometry";
import { NumericField } from "./components";
export default function RoofArchitecture({
  building,
  section,
  onChange,
  onPreview,
  selected,
  onSelect,
}: {
  building: Building;
  section: Section;
  onChange: (s: Section) => string | null;
  onPreview: (b: Building | null) => void;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [draftAxis, setDraftAxis] = useState<"X" | "Y" | null>(null);
  const [draft, setDraft] = useState<RoofFeature[] | null>(null),
    [error, setError] = useState("");
  const features = draft ?? section.exterior.roofFeatures,
    current = features.find((f) => f.id === selected);
  useEffect(() => {
    setDraft(null);
    setDraftAxis(null);
    setError("");
  }, [section]);
  useEffect(() => {
    if (!draft) {
      onPreview(null);
      return;
    }
    try {
      const next = replaceSection(building, {
        ...section,
        exterior: {
          ...section.exterior,
          roofFeatures: draft,
          ridgeAxis: draftAxis ?? section.exterior.ridgeAxis,
        },
      });
      buildExterior(next);
      setError("");
      onPreview(next);
    } catch (e) {
      setError((e as Error).message);
      onPreview(null);
    }
    return () => onPreview(null);
  }, [draft, draftAxis, building, section, onPreview]);
  const patch = (change: Partial<RoofFeature>) => {
    setDraft(
      features.map((f) => (f.id === selected ? { ...f, ...change } : f)),
    );
    return null;
  };
  return (
    <section className="inspector-section roof-architecture">
      <h2>Roof Architecture</h2>
      <p>
        Roof-only crossing gables, supported by existing exterior walls. No
        footprint or rooms are added. T/L-style projections must finish below
        the host before their internal cutoff.
      </p>
      <fieldset disabled={section.locked} className="section-fields">
        <label className="field">
          <span>Selected roof feature</span>
          <select
            aria-label="Selected roof feature"
            value={current?.id ?? ""}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">Choose a roof feature</option>
            {features.map((f, i) => (
              <option key={f.id} value={f.id}>
                Cross-gable {i + 1} · ridge {f.ridgeAxis}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={
            features.length >= 2 ||
            section.kind !== "rectangle" ||
            section.exterior.roofStyle !== "Gable"
          }
          onClick={() => {
            const f = defaultRoofFeature({
              ...section,
              exterior: {
                ...section.exterior,
                ridgeAxis: draftAxis ?? section.exterior.ridgeAxis,
              },
            });
            setDraft([...features, f]);
            onSelect(f.id);
          }}
        >
          Add cross-gable preview
        </button>
        {current && (
          <>
            <label className="field">
              <span>Secondary ridge direction</span>
              <select
                aria-label="Secondary ridge direction"
                value={current.ridgeAxis}
                onChange={(e) =>
                  patch({ ridgeAxis: e.target.value as "X" | "Y" })
                }
              >
                <option>X</option>
                <option>Y</option>
              </select>
            </label>
            <label className="field">
              <span>Gable projection</span>
              <select
                aria-label="Gable projection"
                value={current.side}
                onChange={(e) =>
                  patch({ side: e.target.value as RoofFeature["side"] })
                }
              >
                <option value="Both">Both facades · cross</option>
                <option value="Negative">Negative facade · T/L</option>
                <option value="Positive">Positive facade · T/L</option>
              </select>
            </label>
            <NumericField
              label="Roof feature placement"
              value={current.offset}
              onCommit={(offset) => patch({ offset })}
            />
            <NumericField
              label="Cross-gable width"
              value={current.width}
              onCommit={(width) => patch({ width })}
            />
            <fieldset disabled={current.side === "Both"}>
              <NumericField
                label="Roof projection depth"
                value={current.depth}
                onCommit={(depth) => patch({ depth })}
              />
            </fieldset>
            <p>
              Both facades span the host completely; depth applies to one-sided
              projections.
            </p>
            <NumericField
              label="Secondary relative eaves"
              value={current.relativeHeight}
              onCommit={(relativeHeight) => patch({ relativeHeight })}
            />
            <label className="field">
              <span>Secondary roof pitch (°)</span>
              <input
                aria-label="Secondary roof pitch"
                type="number"
                min="20"
                max="60"
                step="0.1"
                value={current.pitch}
                onChange={(e) => patch({ pitch: Number(e.target.value) })}
              />
            </label>
            <button
              onClick={() => {
                const alongX = draftAxis
                    ? draftAxis === "X"
                    : ridgeAlongX(section),
                  next = alongX ? "Y" : "X";
                setDraftAxis(next);
                setDraft(
                  rotateCrossingFrame(
                    {
                      ...section,
                      exterior: { ...section.exterior, roofFeatures: features },
                    },
                    next,
                  ).exterior.roofFeatures,
                );
              }}
            >
              Rotate crossing roof frame preview
            </button>
            <p>
              Rotate changes the host and crossing ridges together, preserves
              widths and one-sided depths, and rescales placement. Full
              crossings follow the new host span. Unsafe widths or features must
              be corrected before acceptance.
            </p>
            <div className="section-actions">
              <button
                onClick={() =>
                  patch(
                    defaultRoofFeature(
                      {
                        ...section,
                        exterior: {
                          ...section.exterior,
                          ridgeAxis: draftAxis ?? section.exterior.ridgeAxis,
                        },
                      },
                      current.id,
                    ),
                  )
                }
              >
                Reset roof feature preview
              </button>
              <button
                onClick={() => {
                  setDraft(features.filter((f) => f.id !== current.id));
                  onSelect("");
                }}
              >
                Remove roof feature preview
              </button>
            </div>
          </>
        )}
        {draft && (
          <>
            <p role="status">
              {error
                ? "Invalid preview — the original roof is shown."
                : "Unsaved roof preview — orbit to inspect before accepting."}
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
                    exterior: {
                      ...section.exterior,
                      roofFeatures: features,
                      ridgeAxis: draftAxis ?? section.exterior.ridgeAxis,
                    },
                  });
                  setError(issue ?? "");
                  if (!issue) {
                    setDraft(null);
                    setDraftAxis(null);
                    onPreview(null);
                  }
                }}
              >
                Accept roof architecture
              </button>
              <button
                onClick={() => {
                  setDraft(null);
                  setDraftAxis(null);
                  setError("");
                  onPreview(null);
                }}
              >
                Cancel roof preview
              </button>
            </div>
          </>
        )}
      </fieldset>
      <p>
        Supported: rectangular Gable hosts with perpendicular secondary ridges,
        at most two separated bays per section/eight per building. Covering and
        detail follow the host. Tap a secondary roof surface or use the
        selector. Unsupported directions, shared-wall ends and unsafe cutoffs
        are rejected; no decorative slabs are substituted.
      </p>
    </section>
  );
}
