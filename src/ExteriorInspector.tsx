import type { Building, Section, Architecture } from "./model";
import { NumericField } from "./components";
import {
  exteriorDefaults,
  readExterior,
  ROOF_STYLES,
  type ExteriorSettings,
} from "./exteriorSettings";
import { buildExterior } from "./exteriorGeometry";
import { useMemo } from "react";
export default function ExteriorInspector({
  building,
  section,
  onSelect,
  onChange,
}: {
  building: Building;
  section: Section;
  onSelect: (id: string) => void;
  onChange: (s: Section) => string | null;
}) {
  const analysis = useMemo(() => {
    try {
      return { model: buildExterior(building), error: "" };
    } catch (e) {
      return { model: null, error: (e as Error).message };
    }
  }, [building]);
  const ex = section.exterior;
  const roof = analysis.model?.sections.find((s) => s.id === section.id)?.parts
    .roof;
  const ridge = roof?.length
    ? roof.reduce(
        (n, value, i) => (i % 3 === 2 ? Math.max(n, value) : n),
        -Infinity,
      )
    : null;
  function edit(change: Partial<ExteriorSettings>) {
    try {
      return onChange({
        ...section,
        exterior: readExterior({ ...ex, ...change }),
      });
    } catch (e) {
      return (e as Error).message;
    }
  }
  return (
    <div className="exterior-inspector">
      <section className="inspector-section">
        <h2>Architectural exterior</h2>
        <label className="field">
          <span>Selected section</span>
          <select
            aria-label="Exterior section"
            value={section.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {building.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.locked ? " · Locked" : ""}
              </option>
            ))}
          </select>
        </label>
        <p>
          Tap a surface in 3D or choose its section here. Footprint and section
          IDs are shared with the 2D editor. Floor count remains metadata; no
          upper-floor plans are created.
        </p>
        {section.locked && (
          <p role="status">
            This section is locked. Unlock it in Footprint mode before changing
            architecture.
          </p>
        )}
      </section>
      <fieldset disabled={section.locked} className="section-fields">
        <section className="inspector-section">
          <NumericField
            label="Eaves height"
            value={ex.wallHeight}
            onCommit={(wallHeight) => edit({ wallHeight })}
          />
          <label className="field">
            <span>Roof style</span>
            <select
              aria-label="Roof style"
              value={ex.roofStyle}
              onChange={(e) =>
                edit({
                  roofStyle: e.target.value as ExteriorSettings["roofStyle"],
                })
              }
            >
              {ROOF_STYLES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <NumericField
            label="Roof pitch"
            unit="°"
            value={ex.roofPitch}
            onCommit={(roofPitch) => edit({ roofPitch })}
          />
          <NumericField
            label="Roof overhang"
            value={ex.overhang}
            onCommit={(overhang) => edit({ overhang })}
          />
          <label className="field">
            <span>Material preset</span>
            <select
              aria-label="Exterior material preset"
              value={ex.material}
              onChange={(e) =>
                edit({ material: e.target.value as Architecture })
              }
            >
              {["Norse", "Medieval", "Mixed"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              onChange({
                ...section,
                exterior: exteriorDefaults(
                  ex.material,
                  section.type,
                  section.id === building.mainSectionId,
                ),
              })
            }
          >
            Reset section to style defaults
          </button>
          <p>
            Derived ridge/high edge:{" "}
            {ridge === null ? "unavailable" : (ridge / 1000).toFixed(2)} m above
            ground; roof rise{" "}
            {ridge === null
              ? "unavailable"
              : ((ridge - ex.wallHeight) / 1000).toFixed(2)}{" "}
            m. Roof skin is 0.12 m thick. Pitch 10–65°, overhang 0–1 m.
          </p>
        </section>
      </fieldset>
      <section className="inspector-section">
        <h2>Roof support & limitations</h2>
        {analysis.model?.warnings.map((s) => (
          <p className="roof-warning" key={s}>
            {s}
          </p>
        ))}
        {!analysis.model?.warnings.length && !analysis.error && (
          <p>
            Rectangular roof: exact piecewise planar slopes, ridge/eaves,
            gable-end infill and perimeter overhang.
          </p>
        )}
        {analysis.error && <p role="alert">{analysis.error}</p>}
        <p>
          Facade framing and cladding are decorative. No functional windows are
          invented. Existing exterior openings have real wall gaps, using a 2.1
          m door height; interior doors stay inside. No roof-engineering or
          building-code certification.
        </p>
      </section>
    </div>
  );
}
