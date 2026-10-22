import { bounds } from "./polygon";
import {
  openingGeometry,
  openingSwing,
  type Opening,
  type OpeningContext,
} from "./openings";
export default function OpeningsLayer({
  context,
  openings,
  selected,
  scale,
  preview,
  invalid,
  interactive = true,
}: {
  context: OpeningContext;
  openings: Opening[];
  selected: string | null;
  scale: number;
  preview?: Opening | null;
  invalid?: boolean;
  interactive?: boolean;
}) {
  return (
    <>
      {[
        ...openings.filter((o) => o.id !== preview?.id),
        ...(preview ? [preview] : []),
      ].map((o) => {
        let g;
        try {
          g = openingGeometry(context, o);
        } catch {
          return null;
        }
        if (o.width <= 0)
          return (
            <g key={o.id} data-opening-preview="true">
              <circle
                cx={g.center.x}
                cy={g.center.y}
                r={8 / scale}
                fill="#ac443c"
                pointerEvents="none"
              />
            </g>
          );
        const swing = openingSwing(context, o),
          active = o.id === selected || o.id === preview?.id,
          color =
            o.id === preview?.id
              ? invalid
                ? "#ac443c"
                : "#348064"
              : active
                ? "#a07131"
                : "#315f63";
        return (
          <g
            key={o.id}
            data-opening-id={o.id}
            data-opening-preview={o.id === preview?.id ? "true" : undefined}
          >
            <rect
              {...g.gap}
              fill={
                o.id === preview?.id
                  ? invalid
                    ? "#c45b4e77"
                    : "#73a88077"
                  : "#f2ead4"
              }
              stroke={color}
              strokeWidth={1 / scale}
              pointerEvents="none"
            />
            {swing && (
              <g data-door-swing="true" pointerEvents="none">
                <path
                  d={`M ${swing.pivot.x} ${swing.pivot.y} L ${swing.tip.x} ${swing.tip.y}`}
                  stroke={color}
                  strokeWidth={2 / scale}
                />
                <path
                  d={swing.arc}
                  fill="none"
                  stroke={color}
                  strokeWidth={1 / scale}
                  strokeDasharray={`${3 / scale} ${2 / scale}`}
                />
              </g>
            )}
            {interactive && (
              <rect
                x={
                  g.gap.x -
                  (g.u.x === 0 ? Math.max(0, 44 / scale - g.gap.width) / 2 : 0)
                }
                y={
                  g.gap.y -
                  (g.u.y === 0 ? Math.max(0, 44 / scale - g.gap.height) / 2 : 0)
                }
                width={
                  g.u.x === 0 ? Math.max(44 / scale, g.gap.width) : g.gap.width
                }
                height={
                  g.u.y === 0
                    ? Math.max(44 / scale, g.gap.height)
                    : g.gap.height
                }
                fill="transparent"
              />
            )}
            {active &&
              interactive &&
              [g.lo, g.hi].map((p, i) => (
                <g key={i} data-opening-end={i}>
                  <circle cx={p.x} cy={p.y} r={22 / scale} fill="transparent" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={5 / scale}
                    fill="#fffaf0"
                    stroke={color}
                    strokeWidth={2 / scale}
                    pointerEvents="none"
                  />
                </g>
              ))}
          </g>
        );
      })}
    </>
  );
}

export function OpeningMask({
  context,
  openings,
  id,
}: {
  context: OpeningContext;
  openings: Opening[];
  id: string;
}) {
  const box = bounds(context.outer),
    region = {
      x: box.minX - 10,
      y: box.minY - 10,
      width: box.length + 20,
      height: box.width + 20,
    };
  return (
    <mask
      id={id}
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse"
      {...region}
      style={{ maskType: "luminance" }}
    >
      <rect {...region} fill="white" />
      {openings.map((o) => (
        <rect
          key={o.id}
          {...openingGeometry(context, o).gap}
          fill="black"
          data-opening-gap={o.id}
        />
      ))}
    </mask>
  );
}
