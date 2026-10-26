/** Roof editing parameters only: the approved roof solvers remain authoritative. */
import type { Building, Section } from "./model";
import type { ExteriorSettings } from "./exteriorSettings";
import { reconcileRoofDecorations } from "./roofDecorations";
import { ridgeAlongX } from "./exteriorSettings";
import { prepareBuilding } from "./assembly";
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
  together = true,
) {
  if (s.locked)
    throw new Error("Section is locked. Unlock it before changing its roof.");
  const candidate =
    together &&
    "ridgeAxis" in direction &&
    direction.ridgeAxis !== "Auto" &&
    s.exterior.roofFeatures.some((f) => f.ridgeAxis === direction.ridgeAxis) &&
    (direction.ridgeAxis === "X") !== ridgeAlongX(s)
      ? rotateCrossingFrame(s, direction.ridgeAxis)
      : { ...s, exterior: { ...s.exterior, ...direction } };
  // This also checks locks, anchors, clearances and every existing reference.
  const reconciled = reconcileRoofDecorations(
    {
      ...b,
      sections: b.sections.map((t) => (t.id === s.id ? candidate : t)),
    },
    s.id,
  );
  const next = prepareBuilding(reconciled.building, b);
  const model = buildExterior(next);
  return {
    section: next.sections.find((t) => t.id === s.id)!,
    model,
    building: next,
    changes: reconciled.changes,
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
      ? "The host and crossing frames could not be rotated safely. Adjust the crossing dimensions before retrying."
      : /window|chimney|clearance/i.test(detail)
        ? "Adjust or explicitly relocate the affected window or chimney before retrying."
        : "Adjust the crossing dimensions or roof settings, or explicitly relocate affected features before retrying. Inspect Roof support & limitations for supported intersections.";
  return `${detail} No roof settings were saved. ${action}`;
}
