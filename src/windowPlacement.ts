import type { Building } from "./model";
import type { ExteriorWindow } from "./exteriorSettings";
import { prepareBuilding, openingContext } from "./assembly";
import { snap } from "./geometry";
export type WindowAnchor = { sectionId: string; window: ExteriorWindow };
export type WindowSession = {
  mode: "place" | "move";
  source: WindowAnchor | null;
  draft: WindowAnchor | null;
  issue: string;
};
export type WallHit = {
  sectionId: string;
  edge: number;
  offset: number;
  z: number;
};
export type WindowPlacement = {
  state: WindowSession | null;
  getState: () => WindowSession | null;
  start: () => void;
  move: (anchor: WindowAnchor) => void;
  precision: (sectionId: string) => void;
  preview: (anchor: WindowAnchor) => void;
  restore: (state: WindowSession | null) => void;
  commit: () => string | null;
  cancel: () => void;
};
export const defaultWindow = (): ExteriorWindow => ({
  id: crypto.randomUUID(),
  edge: 0,
  offset: 0,
  width: 900,
  height: 1000,
  sill: 1000,
  style: "Timber shuttered",
  shutters: true,
  glazing: false,
});
/** Whole operation is validated before the caller adds one history entry. */
export function placeWindow(
  b: Building,
  draft: WindowAnchor,
  source: WindowAnchor | null,
): Building {
  if (!b.sections.some((s) => s.id === draft.sectionId))
    throw new Error("Window destination section is missing.");
  if (
    source &&
    !b.sections.some(
      (s) =>
        s.id === source.sectionId &&
        s.exterior.windows.some((w) => w.id === source.window.id),
    )
  )
    throw new Error("The original window changed. Cancel and select it again.");
  const next = {
    ...b,
    sections: b.sections.map((s) => ({
      ...s,
      exterior: {
        ...s.exterior,
        windows: [
          ...s.exterior.windows.filter(
            (w) => !source || w.id !== source.window.id,
          ),
          ...(s.id === draft.sectionId ? [draft.window] : []),
        ],
      },
    })),
  };
  return prepareBuilding(next, b);
}
export function positionWindow(
  hit: WallHit,
  window: ExteriorWindow,
  step: number | null,
  grab = { offset: 0, z: window.height / 2 },
): WindowAnchor {
  return {
    sectionId: hit.sectionId,
    window: {
      ...window,
      edge: hit.edge,
      offset: snap(hit.offset - grab.offset, step),
      sill: snap(hit.z - grab.z, step),
    },
  };
}
export function precisionWindow(b: Building, sectionId: string): WindowAnchor {
  const h = openingContext(b).hosts.find(
    (h) => h.ref.kind === "exterior" && h.ref.sectionId === sectionId,
  );
  if (!h || h.ref.kind !== "exterior")
    throw new Error("No exposed exterior wall is available.");
  return {
    sectionId,
    window: {
      ...defaultWindow(),
      edge: h.ref.edge,
      offset: Math.round(Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y) / 2),
    },
  };
}
