import type { WindowPlacement } from "./windowPlacement";
import { useState } from "react";
import type { Building, Section } from "./model";
import { NumericField } from "./components";
import { openingContext } from "./assembly";
import {
  type ExteriorWindow,
  type ExteriorFeature,
  WINDOW_STYLES,
} from "./exteriorSettings";
import { windowOpening } from "./exteriorValidation";
import { openingGeometry } from "./openings";
export default function ExteriorDetails({
  building,
  section,
  onChange,
  placement,
  selected,
  onWindow,
}: {
  building: Building;
  section: Section;
  onChange: (s: Section) => string | null;
  placement: WindowPlacement;
  selected: string;
  onWindow: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const ex = section.exterior,
    c = openingContext(building),
    hosts = c.hosts.filter(
      (h) => h.ref.kind === "exterior" && h.ref.sectionId === section.id,
    );
  const current = ex.windows.find((w) => w.id === selected),
    session = placement.state;
  const draft =
    session?.draft?.sectionId === section.id ? session.draft.window : null;
  const previewIssue = session?.issue ?? "";
  const write = (windows = ex.windows, features = ex.features) => {
    const issue = onChange({
      ...section,
      exterior: { ...ex, windows, features },
    });
    setError(issue ?? "");
    return issue;
  };
  const patch = (change: Partial<ExteriorWindow>) =>
    current
      ? write(
          ex.windows.map((w) =>
            w.id === current.id ? { ...w, ...change } : w,
          ),
        )
      : null;
  function addFeature(kind: ExteriorFeature["kind"]) {
    const door = building.openings.find(
      (o) => o.host.kind === "exterior" && o.host.sectionId === section.id,
    );
    write(ex.windows, [
      ...ex.features,
      {
        id: crypto.randomUUID(),
        kind,
        x: Math.round(section.length * 0.4),
        y: Math.round(section.width * 0.4),
        height: 1000,
        doorId: kind === "Entrance canopy" ? (door?.id ?? null) : null,
        finish: "Stone",
      },
    ]);
  }
  const windowFields = (
    w: ExteriorWindow,
    update: (v: Partial<ExteriorWindow>) => string | null,
  ) => (
    <>
      <label className="field">
        <span>External wall</span>
        <select
          aria-label="Window wall"
          value={w.edge}
          onChange={(e) => update({ edge: Number(e.target.value) })}
        >
          {hosts.map(
            (h) =>
              h.ref.kind === "exterior" && (
                <option key={h.ref.edge} value={h.ref.edge}>
                  Wall {h.ref.edge + 1} ·{" "}
                  {(Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y) / 1000).toFixed(2)}{" "}
                  m
                </option>
              ),
          )}
        </select>
      </label>
      <NumericField
        label="Window position along wall"
        value={w.offset}
        onCommit={(offset) => update({ offset })}
      />
      <NumericField
        label="Window width"
        value={w.width}
        onCommit={(width) => update({ width })}
      />
      <NumericField
        label="Window height"
        value={w.height}
        onCommit={(height) => update({ height })}
      />
      <NumericField
        label="Window sill"
        value={w.sill}
        onCommit={(sill) => update({ sill })}
      />
      <label className="field">
        <span>Window style</span>
        <select
          aria-label="Window style"
          value={w.style}
          onChange={(e) => {
            const style = e.target.value as ExteriorWindow["style"];
            update({
              style,
              shutters: style === "Timber shuttered",
              glazing: style === "Medieval glazed",
              ...(style === "Narrow slit" ? { width: 400, height: 900 } : {}),
            });
          }}
        >
          {WINDOW_STYLES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={w.shutters}
          onChange={(e) => update({ shutters: e.target.checked })}
        />
        Shutters
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={w.glazing}
          onChange={(e) => update({ glazing: e.target.checked })}
        />
        Glazing
      </label>
    </>
  );
  return (
    <fieldset disabled={section.locked} className="section-fields">
      <section className="inspector-section">
        <h2>Exterior windows</h2>
        <p>
          Choose a genuine exterior wall, then set exact placement. Window
          thresholds do not change rooms or circulation. Horizontal clearance is
          reserved for the full bay; stacked windows are not supported.
        </p>
        <button onClick={placement.start}>Place window</button>
        {current && !session && (
          <button
            onClick={() =>
              placement.move({ sectionId: section.id, window: current })
            }
          >
            Move window
          </button>
        )}
        {session && (
          <>
            <p role="status">
              {session.issue ||
                (session.draft
                  ? "Valid placement · preview only, not saved"
                  : "Tap an exposed wall in 3D. Drag to position; two fingers pan/zoom.")}
            </p>
            {!session.draft && (
              <button onClick={() => placement.precision(section.id)}>
                Use precision placement
              </button>
            )}
            <button onClick={placement.cancel}>Cancel window</button>
          </>
        )}
        {draft && (
          <div className="window-draft">
            <h3>Window placement preview</h3>

            {windowFields(draft, (v) => {
              placement.preview({
                sectionId: section.id,
                window: { ...draft, ...v },
              });
              return null;
            })}
            <svg viewBox="0 0 300 140" aria-label="Window elevation preview">
              <rect x="10" y="10" width="280" height="120" fill="#c8b796" />
              <rect
                x={150 - draft.width / 40}
                y={130 - (draft.sill + draft.height) / 25}
                width={draft.width / 20}
                height={draft.height / 25}
                fill="#52716b"
                stroke="#493528"
                strokeWidth="4"
              />
            </svg>
            <button disabled={!!previewIssue} onClick={placement.commit}>
              Confirm window
            </button>
          </div>
        )}
        {!!ex.windows.length && (
          <>
            <label className="field">
              <span>Select window</span>
              <select
                aria-label="Selected window"
                value={current?.id ?? ""}
                onChange={(e) => {
                  onWindow(e.target.value);
                  setError("");
                }}
              >
                <option value="">Choose a window</option>
                {ex.windows.map((w, i) => (
                  <option key={w.id} value={w.id}>
                    {i + 1}. {w.style} · Wall {w.edge + 1}
                  </option>
                ))}
              </select>
            </label>
            {current && !draft && (
              <>
                {windowFields(current, patch)}
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm("Remove this exterior window?"))
                      write(ex.windows.filter((w) => w.id !== current.id));
                  }}
                >
                  Remove window
                </button>
              </>
            )}
          </>
        )}
        {current && (
          <p>
            Wall aperture:{" "}
            {(
              openingGeometry(c, windowOpening(section, current)).length / 1000
            ).toFixed(2)}{" "}
            m host. Changes remain attached to this wall.
          </p>
        )}
      </section>
      <section className="inspector-section">
        <h2>Architectural features</h2>
        <p>
          Rectangular sections only. Chimneys include exterior flashing, without
          an interior flue. Canopies require an existing exterior entrance and
          clear space outside it.
        </p>
        <button onClick={() => addFeature("Chimney")}>Add chimney</button>
        <button onClick={() => addFeature("Gable ornament")}>
          Add gable ornament
        </button>
        <button onClick={() => addFeature("Entrance canopy")}>
          Add entrance canopy
        </button>
        {ex.features.map((f, i) => (
          <div className="feature-card" key={f.id}>
            <h3>
              {i + 1}. {f.kind}
            </h3>
            {f.kind === "Gable ornament" && (
              <NumericField
                label={`Ornament ${i + 1} height`}
                value={f.height}
                onCommit={(height) =>
                  write(
                    ex.windows,
                    ex.features.map((v) =>
                      v.id === f.id ? { ...v, height } : v,
                    ),
                  )
                }
              />
            )}
            {f.kind === "Chimney" && (
              <>
                <NumericField
                  label={`Chimney ${i + 1} local X`}
                  value={f.x}
                  onCommit={(x) =>
                    write(
                      ex.windows,
                      ex.features.map((v) => (v.id === f.id ? { ...v, x } : v)),
                    )
                  }
                />
                <NumericField
                  label={`Chimney ${i + 1} local Y`}
                  value={f.y}
                  onCommit={(y) =>
                    write(
                      ex.windows,
                      ex.features.map((v) => (v.id === f.id ? { ...v, y } : v)),
                    )
                  }
                />
                <NumericField
                  label={`Chimney ${i + 1} height above roof`}
                  value={f.height}
                  onCommit={(height) =>
                    write(
                      ex.windows,
                      ex.features.map((v) =>
                        v.id === f.id ? { ...v, height } : v,
                      ),
                    )
                  }
                />
                <label className="field">
                  <span>Chimney finish</span>
                  <select
                    aria-label={`Chimney ${i + 1} finish`}
                    value={f.finish}
                    onChange={(e) =>
                      write(
                        ex.windows,
                        ex.features.map((v) =>
                          v.id === f.id
                            ? {
                                ...v,
                                finish: e.target
                                  .value as ExteriorFeature["finish"],
                              }
                            : v,
                        ),
                      )
                    }
                  >
                    <option>Stone</option>
                    <option>Brick</option>
                  </select>
                </label>
              </>
            )}
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Remove ${f.kind.toLowerCase()}?`))
                  write(
                    ex.windows,
                    ex.features.filter((v) => v.id !== f.id),
                  );
              }}
            >
              Remove {f.kind.toLowerCase()}
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            if (
              confirm(
                "Remove this section’s windows and architectural features? Roof dimensions and footprint will be preserved. This can be undone.",
              )
            )
              write([], []);
          }}
        >
          Reset architectural details
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    </fieldset>
  );
}
