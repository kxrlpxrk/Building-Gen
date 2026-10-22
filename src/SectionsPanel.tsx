import type { Building } from "./model";
import { metres } from "./geometry";
type Props = {
  building: Building;
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
};
export default function SectionsPanel({
  building,
  selectedId,
  onSelect,
  onAdd,
}: Props) {
  return (
    <div className="sections-panel">
      <h2>
        Architectural Sections <small>{building.sections.length}/12</small>
      </h2>
      <div className="section-list">
        {building.sections.map((s) => (
          <button
            key={s.id}
            className={`section-button ${s.id === selectedId ? "selected" : ""} ${s.locked ? "locked" : ""}`}
            onClick={() => onSelect(s.id)}
            aria-label={`Select section ${s.name}`}
            aria-pressed={s.id === selectedId}
          >
            <span aria-hidden="true">{s.locked ? "▣" : "▱"}</span>
            <span>
              {s.name}
              <small>
                {s.id === building.mainSectionId ? "Main building" : s.type} ·{" "}
                {metres(s.length)} × {metres(s.width)} m
                {s.locked ? " · Locked" : ""}
              </small>
            </span>
          </button>
        ))}
      </div>
      <button disabled={building.sections.length >= 12} onClick={onAdd}>
        ＋ Add Section
      </button>
    </div>
  );
}
