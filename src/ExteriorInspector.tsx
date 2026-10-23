import type { WindowPlacement } from "./windowPlacement";
import ExteriorDetails from "./ExteriorDetails";
import type { Building, Section, Architecture } from "./model";
import { NumericField } from "./components";
import {
  exteriorDefaults,
  ridgeAlongX,
  defaultStyle,
  styleMaterial,
  STYLE_PRESETS,
  COVERINGS,
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
  windowPlacement,
  selectedWindowId,
  onWindow,
}: {
  building: Building;
  section: Section;
  onSelect: (id: string) => void;
  onChange: (s: Section) => string | null;
  windowPlacement: WindowPlacement;
  selectedWindowId: string;
  onWindow: (id: string) => void;
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
          <label className="field">
            <span>Architectural style</span>
            <select
              aria-label="Architectural style"
              value={ex.stylePreset}
              onChange={(e) => {
                const stylePreset = e.target
                  .value as ExteriorSettings["stylePreset"];
                edit({
                  stylePreset,
                  material: styleMaterial(stylePreset),
                  covering:
                    styleMaterial(stylePreset) === "Medieval"
                      ? stylePreset === "Medieval Manor"
                        ? "Slate"
                        : "Clay tiles"
                      : "Wood shingles",
                });
              }}
            >
              {STYLE_PRESETS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Detail level</span>
            <select
              aria-label="Detail level"
              value={ex.detailLevel}
              onChange={(e) =>
                edit({
                  detailLevel: e.target
                    .value as ExteriorSettings["detailLevel"],
                })
              }
            >
              {["Low", "Standard", "High"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Roof covering</span>
            <select
              aria-label="Roof covering"
              value={ex.covering}
              onChange={(e) =>
                edit({
                  covering: e.target.value as ExteriorSettings["covering"],
                })
              }
            >
              {COVERINGS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
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
          <label className="field">
            <span>
              {ex.roofStyle === "Shed" ? "Shed high edge" : "Ridge direction"}
            </span>
            {ex.roofStyle === "Shed" ? (
              <select
                aria-label="Shed high edge"
                value={
                  ex.shedHighEdge === "Auto"
                    ? section.length >= section.width
                      ? "+Y"
                      : "+X"
                    : ex.shedHighEdge
                }
                onChange={(e) =>
                  edit({
                    shedHighEdge: e.target
                      .value as ExteriorSettings["shedHighEdge"],
                  })
                }
              >
                {["+X", "-X", "+Y", "-Y"].map((d) => (
                  <option key={d} value={d}>
                    Local {d}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="Ridge direction"
                value={ridgeAlongX(section) ? "X" : "Y"}
                onChange={(e) =>
                  edit({
                    ridgeAxis: e.target.value as ExteriorSettings["ridgeAxis"],
                  })
                }
              >
                <option value="X">Ridge along local X axis</option>
                <option value="Y">Ridge along local Y axis</option>
              </select>
            )}
          </label>
          <p>
            Direction is relative to this section. Hip end slopes adjust to
            retain a ridge on the chosen axis; the transverse pitch stays
            unchanged.
          </p>
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
                edit({
                  material: e.target.value as Architecture,
                  stylePreset: defaultStyle(e.target.value as Architecture),
                })
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
                exterior: {
                  ...exteriorDefaults(
                    ex.material,
                    section.type,
                    section.id === building.mainSectionId,
                  ),
                  windows: ex.windows,
                  features: ex.features,
                },
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
      <ExteriorDetails
        key={section.id}
        building={building}
        section={section}
        onChange={onChange}
        placement={windowPlacement}
        selected={selectedWindowId}
        onWindow={onWindow}
      />
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
          Facade framing and cladding are decorative. Windows are explicit
          modelled apertures; no windows or chimneys are added automatically.
          Existing exterior openings have real wall gaps, using a 2.1 m door
          height; interior doors stay inside. No roof-engineering or
          building-code certification.
        </p>
      </section>
    </div>
  );
}
