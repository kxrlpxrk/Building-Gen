import type { InteriorPlan, Partition, Region } from "./interior";
import { wallBox } from "./interior";
import type { Point } from "./geometry";
import { polygonPath } from "./polygon";
import type { InteriorSelection, InteriorTool } from "./InteriorInspector";
export default function InteriorLayer({
  inner,
  outer,
  plan,
  regions,
  scale,
  selection,
  tool,
  preview,
  invalid,
  start,
}: {
  inner: Point[];
  outer: Point[];
  plan: InteriorPlan;
  regions: Region[];
  scale: number;
  selection: InteriorSelection;
  tool: InteriorTool;
  preview: Partition | null;
  invalid: boolean;
  start: Point | null;
}) {
  return (
    <g data-interior-layer="true">
      <path d={polygonPath(outer)} fill="#46655e" />
      <path d={polygonPath(inner)} fill="#f8f5e9" />
      {regions.map((r, i) => {
        const record = plan.rooms.find((m) => m.regionKey === r.key),
          assigned =
            !!record && (!!record.name.trim() || record.type !== "Custom"),
          active = selection?.kind === "room" && selection.key === r.key;
        return (
          <g key={r.key} data-room-key={r.key}>
            <path
              d={r.loops.map(polygonPath).join(" ")}
              fillRule="evenodd"
              fill={active ? "#cddfda" : assigned ? "#e1e9d3" : "#f8f5e9"}
              stroke={active ? "#326e70" : "#b5bba5"}
              strokeWidth={(active ? 2 : 1) / scale}
            />
            <text
              x={r.label.x}
              y={r.label.y - 5 / scale}
              textAnchor="middle"
              fontSize={12 / scale}
              fill="#34534b"
              pointerEvents="none"
            >
              {(
                record?.name ||
                (assigned ? record!.type : `Unassigned ${i + 1}`)
              ).slice(0, 24)}
            </text>
            <text
              x={r.label.x}
              y={r.label.y + 12 / scale}
              textAnchor="middle"
              fontSize={11 / scale}
              fill="#63776b"
              pointerEvents="none"
            >
              {(r.area / 1e6).toFixed(2)} m²
            </text>
          </g>
        );
      })}
      {plan.partitions.map((w) => {
        const b = wallBox(w),
          active = selection?.kind === "wall" && selection.id === w.id;
        return (
          <g key={w.id} data-partition-id={w.id}>
            <rect
              {...b}
              fill={active ? "#a87735" : "#46655e"}
              stroke={active ? "#7d501f" : "none"}
              strokeWidth={1 / scale}
            />
            {tool === "wall" && (
              <path
                d={`M ${w.a.x} ${w.a.y} L ${w.b.x} ${w.b.y}`}
                stroke="transparent"
                strokeWidth={Math.max(w.thickness, 44 / scale)}
              />
            )}
            {active &&
              tool === "wall" &&
              ([w.a, w.b] as Point[]).map((p, i) => (
                <g key={i} data-wall-end={i}>
                  <circle cx={p.x} cy={p.y} r={22 / scale} fill="transparent" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6 / scale}
                    fill="#fffaf0"
                    stroke="#a87735"
                    strokeWidth={2 / scale}
                    pointerEvents="none"
                  />
                </g>
              ))}
          </g>
        );
      })}
      {preview && (
        <rect
          {...wallBox(preview)}
          data-wall-preview="true"
          fill={invalid ? "#c55a4b99" : "#58927999"}
          stroke={invalid ? "#ae3c34" : "#28674d"}
          strokeWidth={2 / scale}
          pointerEvents="none"
        />
      )}
      {start && (
        <circle
          cx={start.x}
          cy={start.y}
          r={6 / scale}
          fill="#fffaf0"
          stroke="#a87735"
          strokeWidth={2 / scale}
          pointerEvents="none"
        />
      )}
    </g>
  );
}
