import { useState, useRef, useLayoutEffect, useEffect } from "react";
import type { ReactNode } from "react";
import type { Building } from "./model";
import {
  ROOM_TYPES,
  wallLength,
  type Partition,
  type Region,
  type RoomRecord,
  type RoomType,
} from "./interior";
import { NumericField } from "./components";
import { metres } from "./geometry";
export type InteriorTool = "draw" | "wall" | "room" | "door";
export type InteriorSelection =
  | { kind: "wall"; id: string }
  | { kind: "room"; key: string }
  | { kind: "opening"; id: string }
  | null;
type Props = {
  doors?: ReactNode;
  roomAccess?: boolean;
  building: Building;
  regions: Region[];
  partitionArea: number;
  usableArea: number;
  selection: InteriorSelection;
  onSelect: (s: InteriorSelection) => void;
  onWalls: (walls: Partition[]) => string | null;
  onRoom: (room: RoomRecord) => void;
  onForget: (id: string) => void;
  onPlacement: (key: "x" | "y" | "rotation", value: number) => string | null;
  thickness: number;
  onThickness: (n: number) => void;
};
function RoomFields({
  record,
  onChange,
}: {
  record: RoomRecord;
  onChange: (r: RoomRecord) => void;
}) {
  const [name, setName] = useState(record.name),
    [notes, setNotes] = useState(record.notes);
  useEffect(() => setName(record.name), [record.name]);
  useEffect(() => setNotes(record.notes), [record.notes]);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  function fitNotes() {
    const node = notesRef.current;
    if (node) {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight + 2}px`;
    }
  }
  useLayoutEffect(fitNotes, [notes]);
  useEffect(() => {
    const node = notesRef.current;
    if (!node) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fitNotes();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <label className="field">
        <span>Room name</span>
        <input
          aria-label="Room name"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== record.name) onChange({ ...record, name });
          }}
        />
      </label>
      <label className="field">
        <span>Room type</span>
        <select
          aria-label="Room type"
          value={record.type}
          onChange={(e) =>
            onChange({ ...record, type: e.target.value as RoomType })
          }
        >
          {ROOM_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Room notes</span>
        <textarea
          ref={notesRef}
          aria-label="Room notes"
          maxLength={2000}
          rows={Math.max(3, Math.ceil(notes.length / 28))}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== record.notes) onChange({ ...record, notes });
          }}
        />
      </label>
    </>
  );
}
export default function InteriorInspector({
  doors,
  roomAccess,
  building,
  regions,
  partitionArea,
  usableArea,
  selection,
  onSelect,
  onWalls,
  onRoom,
  onForget,
  thickness,
  onThickness,
  onPlacement,
}: Props) {
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const plan = building.interior,
    wall =
      selection?.kind === "wall"
        ? plan.partitions.find((w) => w.id === selection.id)
        : undefined;
  const region =
    selection?.kind === "room"
      ? regions.find((r) => r.key === selection.key)
      : undefined;
  const record = region
    ? plan.rooms.find((r) => r.regionKey === region.key)
    : undefined;
  const retained = plan.rooms.filter((r) => r.regionKey === null);
  const assigned = regions
    .filter((r) =>
      plan.rooms.some(
        (m) => m.regionKey === r.key && (m.name.trim() || m.type !== "Custom"),
      ),
    )
    .reduce((sum, r) => sum + r.area, 0);
  const change = (w: Partition) =>
    onWalls(plan.partitions.map((p) => (p.id === w.id ? w : p)));
  return (
    <div className="interior-inspector">
      {doors}
      <section className="inspector-section">
        <h2>Whole-building placement</h2>
        <NumericField
          label="Building X"
          value={building.frame.origin.x}
          onCommit={(n) => onPlacement("x", n)}
        />
        <NumericField
          label="Building Y"
          value={building.frame.origin.y}
          onCommit={(n) => onPlacement("y", n)}
        />
        <NumericField
          label="Interior building rotation"
          unit="°"
          value={building.frame.rotation}
          onCommit={(n) => onPlacement("rotation", n)}
        />
      </section>
      <section className="inspector-section">
        <h2>Ground-floor interior</h2>
        <p className="interior-help">
          Open-plan joins are continuous clear space. Upper floors are metadata.
          Draw Wall: tap a start, then tap an end; corners and T-junctions join
          at wall centreline endpoints. Escape cancels.
        </p>
        <NumericField
          label="New partition thickness"
          value={thickness}
          onCommit={(n) => {
            if (n < 10 || n > 1000) return "Use 0.01–1 m.";
            onThickness(n);
            return null;
          }}
        />
        <dl className="interior-totals">
          <div>
            <dt>Usable interior</dt>
            <dd>{(usableArea / 1e6).toFixed(2)} m²</dd>
          </div>
          <div>
            <dt>Logical partition footprint</dt>
            <dd data-testid="partition-area">
              {(partitionArea / 1e6).toFixed(2)} m²
            </dd>
          </div>
          <div>
            <dt>Assigned room area</dt>
            <dd>{(assigned / 1e6).toFixed(2)} m²</dd>
          </div>
          <div>
            <dt>Unassigned clear space</dt>
            <dd>
              {((usableArea - partitionArea - assigned) / 1e6).toFixed(2)} m²
            </dd>
          </div>
        </dl>
      </section>
      <section className="inspector-section">
        <h2>
          Partitions <small>{plan.partitions.length}/64</small>
        </h2>
        <label className="field">
          <span>Select partition</span>
          <select
            aria-label="Select partition"
            value={wall?.id ?? ""}
            onChange={(e) =>
              onSelect(
                e.target.value ? { kind: "wall", id: e.target.value } : null,
              )
            }
          >
            <option value="">Choose a partition</option>
            {plan.partitions.map((w, i) => (
              <option key={w.id} value={w.id}>
                Wall {i + 1} · {metres(wallLength(w))} m
              </option>
            ))}
          </select>
        </label>
        {wall && (
          <>
            <label className="field">
              <span>Wall direction</span>
              <select
                aria-label="Wall direction"
                value={wall.a.x === wall.b.x ? "vertical" : "horizontal"}
                onChange={(e) => {
                  const issue = change({
                    ...wall,
                    b:
                      e.target.value === "vertical"
                        ? { x: wall.a.x, y: wall.a.y + wallLength(wall) }
                        : { x: wall.a.x + wallLength(wall), y: wall.a.y },
                  });
                  setError(issue ?? "");
                }}
              >
                <option value="vertical">Vertical / Y</option>
                <option value="horizontal">Horizontal / X</option>
              </select>
            </label>
            <NumericField
              label="Wall start X"
              value={wall.a.x}
              onCommit={(x) =>
                change({
                  ...wall,
                  a: { ...wall.a, x },
                  b: { ...wall.b, x: wall.b.x + x - wall.a.x },
                })
              }
            />
            <NumericField
              label="Wall start Y"
              value={wall.a.y}
              onCommit={(y) =>
                change({
                  ...wall,
                  a: { ...wall.a, y },
                  b: { ...wall.b, y: wall.b.y + y - wall.a.y },
                })
              }
            />
            <NumericField
              label="Partition length"
              value={wallLength(wall)}
              onCommit={(length) =>
                change({
                  ...wall,
                  b:
                    wall.a.x === wall.b.x
                      ? {
                          x: wall.a.x,
                          y: wall.a.y + Math.sign(wall.b.y - wall.a.y) * length,
                        }
                      : {
                          x: wall.a.x + Math.sign(wall.b.x - wall.a.x) * length,
                          y: wall.a.y,
                        },
                })
              }
            />
            <NumericField
              label="Partition thickness"
              value={wall.thickness}
              onCommit={(n) => change({ ...wall, thickness: n })}
            />
            {removing === wall.id ? (
              <div className="section-actions">
                <button onClick={() => setRemoving(null)}>
                  Keep partition
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    const issue = onWalls(
                      plan.partitions.filter((w) => w.id !== wall.id),
                    );
                    setError(issue ?? "");
                    if (!issue) {
                      onSelect(null);
                      setRemoving(null);
                    }
                  }}
                >
                  Confirm delete partition
                </button>
              </div>
            ) : (
              <button className="danger" onClick={() => setRemoving(wall.id)}>
                Delete partition
              </button>
            )}
          </>
        )}
      </section>
      <section className="inspector-section">
        <h2>
          Clear regions <small>{regions.length}</small>
        </h2>
        <label className="field">
          <span>Select room</span>
          <select
            aria-label="Select room"
            value={region?.key ?? ""}
            onChange={(e) =>
              onSelect(
                e.target.value ? { kind: "room", key: e.target.value } : null,
              )
            }
          >
            <option value="">Choose clear space</option>
            {regions.map((r, i) => (
              <option key={r.key} value={r.key}>
                {plan.rooms.find((m) => m.regionKey === r.key)?.name ||
                  `Unassigned ${i + 1}`}{" "}
                · {(r.area / 1e6).toFixed(2)} m²
              </option>
            ))}
          </select>
        </label>
        {region && (
          <>
            <p
              data-testid="selected-room-access"
              className={roomAccess ? "access-reachable" : "field-error"}
            >
              {roomAccess ? "Accessible" : "No entrance path"}
            </p>
            <p data-testid="room-area">
              Net area: {(region.area / 1e6).toFixed(2)} m²
            </p>
            <p className="interior-help">
              Outer extents: {region.dimensions.length / 1000} ×{" "}
              {region.dimensions.width / 1000} m. The outline determines net
              area.
            </p>
            <RoomFields
              key={region.key}
              record={
                record ?? {
                  id: crypto.randomUUID(),
                  regionKey: region.key,
                  name: "",
                  type: "Custom",
                  notes: "",
                }
              }
              onChange={onRoom}
            />
          </>
        )}
      </section>
      {retained.length > 0 && (
        <section className="inspector-section">
          <h2>Retained room labels</h2>
          <p className="interior-help" role="status">
            A room merged, split or disappeared. Its previous labels remain
            here. Select a clear region to reassign a label.
          </p>
          {retained.map((r) => (
            <div className="retained-label" key={r.id}>
              <strong>{r.name || r.type}</strong>
              <p>{r.notes || "No notes"}</p>
              <button
                disabled={!region}
                onClick={() => {
                  if (region)
                    onRoom({
                      ...r,
                      id: record?.id ?? crypto.randomUUID(),
                      regionKey: region.key,
                    });
                }}
              >
                Copy label to selected room
              </button>
              {removing === r.id ? (
                <>
                  <button onClick={() => setRemoving(null)}>Keep label</button>
                  <button
                    className="danger"
                    onClick={() => {
                      onForget(r.id);
                      setRemoving(null);
                    }}
                  >
                    Confirm discard label
                  </button>
                </>
              ) : (
                <button onClick={() => setRemoving(r.id)}>
                  Discard retained label
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {error && (
        <p className="inspector-section field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
