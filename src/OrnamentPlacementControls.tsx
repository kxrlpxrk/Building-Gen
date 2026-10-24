import { useEffect, useRef } from "react";
import type { OrnamentPlacement } from "./ornamentPlacement";
import { ORNAMENT_TYPES, type Ornament } from "./ornamentation";
export default function OrnamentPlacementControls({
  ornamentPlacement,
  snapStep,
  inInspector = false,
}: {
  ornamentPlacement: OrnamentPlacement;
  snapStep: number | null;
  inInspector?: boolean;
}) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inInspector) node.current?.scrollIntoView({ block: "nearest" });
  }, [inInspector]);
  const state = ornamentPlacement.state;
  if (!state) return null;
  return (
    <div
      ref={node}
      className="ornament-placement-controls"
      aria-label="Ornament placement controls"
    >
      <label className="direct-ornament-type">
        Ornament type
        <select
          aria-label="Direct ornament type"
          value={state.template.type}
          disabled={state.mode === "move"}
          onChange={(e) => {
            const type = e.target.value as Ornament["type"];

            ornamentPlacement.start(type);
          }}
        >
          {ORNAMENT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <p
        role="status"
        className={
          state.issue
            ? "placement-invalid"
            : state.draft
              ? "placement-valid"
              : ""
        }
      >
        {state.issue ||
          (state.draft
            ? "Valid ornament preview"
            : "Tap a compatible exposed wall, entrance, gable or ridge")}
        . {snapStep ? `Snap ${snapStep / 1000} m` : "Free"}. Two fingers
        pan/zoom; confirm to save.
      </p>
      <button
        disabled={!state.draft || !!state.issue}
        onClick={ornamentPlacement.commit}
        aria-label="Confirm ornament placement"
      >
        Confirm ornament
      </button>
      <button
        onClick={ornamentPlacement.cancel}
        aria-label="Cancel ornament placement"
      >
        Cancel ornament
      </button>
    </div>
  );
}
