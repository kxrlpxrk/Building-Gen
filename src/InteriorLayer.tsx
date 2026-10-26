import { useId } from "react";
import { roomLabel } from "./roomLabels";
import OpeningsLayer from "./OpeningsLayer";
import type { Opening, OpeningContext } from "./openings";
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
  doors,
}: {
  doors: {
    context: OpeningContext;
    openings: Opening[];
    draft: Opening | null;
    invalid: boolean;
    maskId: string;
    reachable: Set<string>;
  };
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
  const labelId = useId().replace(/:/g, "");
  return (
    <g data-interior-layer="true">
      <path
        d={polygonPath(outer)}
        fill="#46655e"
        mask={`url(#${doors.maskId})`}
        data-physical-exterior="true"
      />
      <path d={polygonPath(inner)} fill="#f8f5e9" />
      {regions.map((r, i) => {
        const record = plan.rooms.find((m) => m.regionKey === r.key),
          assigned =
            !!record && (!!record.name.trim() || record.type !== "Custom"),
          active = selection?.kind === "room" && selection.key === r.key,
          name =
            record?.name || (assigned ? record!.type : `Unassigned ${i + 1}`),
          label = roomLabel(r, name, scale);
        return (
          <g key={r.key} data-room-key={r.key}>
            <path
              d={r.loops.map(polygonPath).join(" ")}
              fillRule="evenodd"
              fill={active ? "#cddfda" : assigned ? "#e1e9d3" : "#f8f5e9"}
              data-access={
                doors.reachable.has(r.key) ? "accessible" : "unreachable"
              }
              stroke={
                active
                  ? "#326e70"
                  : doors.reachable.has(r.key)
                    ? "#b5bba5"
                    : "#bd8d65"
              }
              strokeDasharray={
                !active && !doors.reachable.has(r.key)
                  ? `${4 / scale} ${3 / scale}`
                  : undefined
              }
              strokeWidth={(active ? 2 : 1) / scale}
            />
            <defs>
              <clipPath id={`${labelId}-${i}`}>
                <path
                  d={r.loops.map(polygonPath).join(" ")}
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </clipPath>
            </defs>
            <g clipPath={`url(#${labelId}-${i})`} pointerEvents="none">
              <text
                x={label.x}
                y={
                  label.y -
                  ((label.lines.length > 1 ? 8 : 3) * label.fontScale) / scale
                }
                textAnchor="middle"
                fontSize={(12 * label.fontScale) / scale}
                fill="#34534b"
                aria-label={name}
              >
                {label.lines.map((line, j) => (
                  <tspan
                    key={j}
                    x={label.x}
                    dy={j ? (13 * label.fontScale) / scale : 0}
                    textLength={Math.min(
                      label.width,
                      (line.length * 6 * label.fontScale) / scale,
                    )}
                    lengthAdjust="spacingAndGlyphs"
                  >
                    {line}
                    {j < label.lines.length - 1 ? " " : ""}
                  </tspan>
                ))}
              </text>
              <text
                x={label.x}
                y={
                  label.y +
                  ((label.lines.length > 1 ? 19 : 12) * label.fontScale) / scale
                }
                textAnchor="middle"
                fontSize={(11 * label.fontScale) / scale}
                fill="#63776b"
                textLength={Math.min(
                  label.width,
                  (((r.area / 1e6).toFixed(2).length + 3) *
                    5.8 *
                    label.fontScale) /
                    scale,
                )}
                lengthAdjust="spacingAndGlyphs"
              >
                {(r.area / 1e6).toFixed(2)} m²
              </text>
            </g>
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
              mask={`url(#${doors.maskId})`}
              data-physical-partition="true"
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
      <OpeningsLayer
        context={doors.context}
        openings={doors.openings}
        preview={doors.draft}
        invalid={doors.invalid}
        selected={selection?.kind === "opening" ? selection.id : null}
        scale={scale}
        interactive={tool === "door"}
      />
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
