/** Roof editing parameters only: the approved roof solvers remain authoritative. */
import type { Building, Section } from "./model";
import type { ExteriorSettings } from "./exteriorSettings";
import { replaceSection } from "./assembly";
import { buildExterior } from "./exteriorGeometry";
export type RoofDirection =
  Pick<ExteriorSettings, "ridgeAxis"> | Pick<ExteriorSettings, "shedHighEdge">;
export function rotateCrossingFrame(s: Section, axis: "X" | "Y"): Section {
  return {
    ...s,
    exterior: {
      ...s.exterior,
      ridgeAxis: axis,
      roofFeatures: s.exterior.roofFeatures.map((f) => {
        const oldPlacementSpan = f.ridgeAxis === "Y" ? s.length : s.width;
        const newPlacementSpan = axis === "X" ? s.length : s.width;
        return {
          ...f,
          ridgeAxis: axis === "X" ? "Y" : "X",
          offset: Math.round((f.offset / oldPlacementSpan) * newPlacementSpan),
          // Full crossings derive their run from the host span. Only one-sided
          // projection depth is editable; preserve it and reject if unsafe.
          depth:
            f.side === "Both" ? (axis === "X" ? s.width : s.length) : f.depth,
        };
      }),
    },
  };
}
export function prepareRoofDirection(
  b: Building,
  s: Section,
  direction: RoofDirection,
  together = false,
) {
  const candidate =
    together && "ridgeAxis" in direction && direction.ridgeAxis !== "Auto"
      ? rotateCrossingFrame(s, direction.ridgeAxis)
      : { ...s, exterior: { ...s.exterior, ...direction } };
  // This also checks locks, anchors, clearances and every existing reference.
  const next = replaceSection(b, candidate);
  const model = buildExterior(next);
  return {
    section: next.sections.find((t) => t.id === s.id)!,
    model,
    building: next,
  };
}
export function roofDirectionError(reason: string): string {
  const detail = reason
    .replace(/^Interior plan: /, "")
    .replace(
      " Change the host direction first or remove its roof features.",
      "",
    )
    .replace(
      / Footprint edit rejected; partitions and room labels were preserved\.$/,
      "",
    );
  const action = /locked/i.test(detail)
    ? "Unlock this section in Footprint mode before editing."
    : /secondary ridge|cross the host/i.test(detail)
      ? "Use Rotate host and crossing roofs below to try both frames as one validated edit."
      : /ornament|gable ornament/i.test(detail)
        ? "Explicitly relocate the affected ornament to a supported exposed gable before retrying."
        : /window|chimney|clearance/i.test(detail)
          ? "Adjust or explicitly relocate the affected window or chimney before retrying."
          : "Adjust the crossing dimensions or roof settings, or explicitly relocate affected features before retrying. Inspect Roof support & limitations for supported intersections.";
  return `${detail} No roof settings were saved. ${action}`;
}
