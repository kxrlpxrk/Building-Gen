import { useState } from "react";
import type { Building } from "./model";
import { NumericField } from "./components";
import {
  checkOpeningLocks,
  hostKey,
  newOpening,
  openingAreas,
  swingWarnings,
  validateOpenings,
  type Opening,
  type OpeningContext,
} from "./openings";
import { circulation } from "./circulation";
export default function DoorsInspector({
  building,
  context,
  selectedId,
  draft,
  passage,
  onPassage,
  onDraft,
  onChange,
  onSelect,
}: {
  building: Building;
  context: OpeningContext;
  selectedId: string | null;
  draft: Opening | null;
  passage: boolean;
  onPassage: (v: boolean) => void;
  onDraft: (v: Opening | null) => void;
  onChange: (openings: Opening[]) => string | null;
  onSelect: (id: string) => void;
}) {
  const [error, setError] = useState(""),
    [remove, setRemove] = useState<string | null>(null);
  const opening = draft ?? building.openings.find((o) => o.id === selectedId),
    areas = openingAreas(context, building.openings),
    access = circulation(context, building.openings);
  let issue = "";
  if (draft)
    try {
      const next = [
        ...building.openings.filter((o) => o.id !== draft.id),
        draft,
      ];
      validateOpenings(context, next);
      checkOpeningLocks(context, building.openings, next);
    } catch (e) {
      issue = (e as Error).message;
    }
  const warnings = swingWarnings(
    context,
    draft && !issue
      ? [...building.openings.filter((o) => o.id !== draft.id), draft]
      : building.openings,
  );
  const change = (o: Opening, report = true) => {
    if (draft) {
      onDraft(o);
      setError("");
      return null;
    }
    const result = onChange(
      building.openings.map((old) => (old.id === o.id ? o : old)),
    );
    setError(report ? (result ?? "") : "");
    return result;
  };
  return (
    <>
      <section className="inspector-section doors-inspector">
        <h2>
          Doors &amp; Openings <small>{building.openings.length}/128</small>
        </h2>
        <p className="interior-help">
          Place Door: tap a real wall to preview, then confirm here. Drag a
          selected door along its host. White gaps are physical; logical room
          boundaries remain intact.
        </p>
        <label className="field">
          <span>New opening</span>
          <select
            aria-label="New opening type"
            value={passage ? "passage" : "hinged"}
            onChange={(e) => onPassage(e.target.value === "passage")}
          >
            <option value="hinged">Hinged door · 0.9 m</option>
            <option value="passage">Open passage · 1.2 m</option>
          </select>
        </label>
        <label className="field">
          <span>Select door/opening</span>
          <select
            aria-label="Select door/opening"
            value={selectedId ?? ""}
            onChange={(e) => {
              if (e.target.value) {
                onDraft(null);
                onSelect(e.target.value);
              }
            }}
          >
            <option value="">Choose an opening</option>
            {building.openings.map((o, i) => (
              <option key={o.id} value={o.id}>
                {o.type === "passage"
                  ? "Passage"
                  : o.host.kind === "exterior"
                    ? "Entrance"
                    : "Door"}{" "}
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        {opening && (
          <>
            <label className="field">
              <span>Wall host</span>
              <select
                aria-label="Opening wall host"
                value={hostKey(opening.host)}
                disabled={!draft}
                onChange={(e) => {
                  const h = context.hosts.find(
                    (h) => hostKey(h.ref) === e.target.value,
                  )!;
                  const length =
                    Math.abs(h.b.x - h.a.x) + Math.abs(h.b.y - h.a.y);
                  onDraft(
                    newOpening(
                      opening.id,
                      h.ref,
                      Math.round(length / 2),
                      opening.type === "passage",
                    ),
                  );
                }}
              >
                {context.hosts.map((h, i) => (
                  <option key={hostKey(h.ref)} value={hostKey(h.ref)}>
                    {h.ref.kind === "exterior" ? "Exterior" : "Partition"}{" "}
                    segment {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Opening type</span>
              <select
                aria-label="Opening type"
                value={opening.type === "passage" ? "passage" : "hinged"}
                onChange={(e) => {
                  const base = {
                    id: opening.id,
                    host: opening.host,
                    offset: opening.offset,
                    width: opening.width,
                  };
                  change(
                    e.target.value === "passage"
                      ? { ...base, type: "passage" }
                      : {
                          ...base,
                          type:
                            opening.host.kind === "exterior"
                              ? "exterior-door"
                              : "interior-door",
                          hinge: "left",
                          swing: 1,
                        },
                  );
                }}
              >
                <option value="hinged">Hinged door</option>
                <option value="passage">Open passage</option>
              </select>
            </label>
            <NumericField
              label="Opening position"
              value={opening.offset}
              onCommit={(offset) => change({ ...opening, offset }, false)}
            />
            <p className="interior-help">
              Centre distance from the referenced wall start, along its
              direction. End clearance ≥ 0.1 m.
            </p>
            <NumericField
              label="Opening width"
              value={opening.width}
              onCommit={(width) => change({ ...opening, width }, false)}
            />
            {opening.type !== "passage" && (
              <>
                <label className="field">
                  <span>Hinge side</span>
                  <select
                    aria-label="Hinge side"
                    value={opening.hinge}
                    onChange={(e) =>
                      change({
                        ...opening,
                        hinge: e.target.value as "left" | "right",
                      })
                    }
                  >
                    <option value="left">Left / wall-start jamb</option>
                    <option value="right">Right / wall-end jamb</option>
                  </select>
                </label>
                <label className="field">
                  <span>Swing side</span>
                  <select
                    aria-label="Swing side"
                    value={opening.swing}
                    onChange={(e) =>
                      change({
                        ...opening,
                        swing: Number(e.target.value) as 1 | -1,
                      })
                    }
                  >
                    <option value="1">Side A / left of wall direction</option>
                    <option value="-1">Side B / right of wall direction</option>
                  </select>
                </label>
                <div className="section-actions">
                  <button
                    onClick={() =>
                      change({
                        ...opening,
                        hinge: opening.hinge === "left" ? "right" : "left",
                      })
                    }
                  >
                    Flip Hinge
                  </button>
                  <button
                    onClick={() =>
                      change({
                        ...opening,
                        swing: opening.swing === 1 ? -1 : 1,
                      })
                    }
                  >
                    Reverse Swing
                  </button>
                </div>
                {warnings.get(opening.id) && (
                  <p className="field-error" role="status">
                    {warnings.get(opening.id)}
                  </p>
                )}
              </>
            )}
            {draft ? (
              <>
                <p
                  role="status"
                  className={
                    issue
                      ? "placement-status invalid-preview"
                      : "placement-status valid-preview"
                  }
                >
                  {issue || "Valid placement. Confirm to save this opening."}
                </p>
                <div className="section-actions">
                  <button
                    disabled={!!issue}
                    onClick={() => {
                      const result = onChange([
                        ...building.openings.filter((o) => o.id !== draft.id),
                        draft,
                      ]);
                      setError(result ?? "");
                      if (!result) {
                        onSelect(draft.id);
                        onDraft(null);
                      }
                    }}
                  >
                    Confirm opening
                  </button>
                  <button
                    onClick={() => {
                      onDraft(null);
                      setError("");
                    }}
                  >
                    Cancel opening
                  </button>
                </div>
              </>
            ) : remove === opening.id ? (
              <div className="section-actions">
                <button onClick={() => setRemove(null)}>Keep opening</button>
                <button
                  className="danger"
                  onClick={() => {
                    const result = onChange(
                      building.openings.filter((o) => o.id !== opening.id),
                    );
                    setError(result ?? "");
                    if (!result) setRemove(null);
                  }}
                >
                  Confirm delete opening
                </button>
              </div>
            ) : (
              <button className="danger" onClick={() => setRemove(opening.id)}>
                Delete opening
              </button>
            )}
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <dl className="interior-totals">
          <div>
            <dt>Remaining physical partitions</dt>
            <dd data-testid="physical-partitions">
              {(areas.physicalPartitions / 1e6).toFixed(3)} m²
            </dd>
          </div>
          <div>
            <dt>Interior passage thresholds</dt>
            <dd data-testid="threshold-area">
              {(areas.thresholds / 1e6).toFixed(3)} m²
            </dd>
          </div>
          <div>
            <dt>Remaining exterior walls</dt>
            <dd>{(areas.physicalExterior / 1e6).toFixed(3)} m²</dd>
          </div>
          <div>
            <dt>Exterior thresholds (outside baseline)</dt>
            <dd>{(areas.exteriorThresholds / 1e6).toFixed(3)} m²</dd>
          </div>
        </dl>
        <p className="interior-help">
          Thresholds are separate passage area. Net rooms + remaining partitions
          + interior thresholds = usable interior. Exterior thresholds never
          enlarge the interior baseline.
        </p>
      </section>
      <section className="inspector-section">
        <h2>Ground-floor access</h2>
        <p data-testid="access-summary">
          {access.reachable.size} of {context.regions.length} clear regions
          accessible from an exterior entrance.
        </p>
        {context.regions.map((r, i) => (
          <p
            className={
              access.reachable.has(r.key) ? "access-reachable" : "field-error"
            }
            key={r.key}
          >
            {building.interior.rooms.find((m) => m.regionKey === r.key)?.name ||
              `Unassigned ${i + 1}`}
            : {access.reachable.has(r.key) ? "Accessible" : "No entrance path"}
          </p>
        ))}
        <p className="interior-help">
          Warnings do not change your design. Ground floor only; this is not
          building-code or fire-escape certification.
        </p>
      </section>
    </>
  );
}
