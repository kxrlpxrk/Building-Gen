import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { ornamentBuilding } from "../tests/fixtures/ornamentBuildings";
import { ORNAMENT_TYPES, suggestedOrnament } from "./ornamentation";
import {
  ornamentPlacementContext,
  positionOrnament,
  placeOrnament,
  previewOrnament,
  type OrnamentHit,
  type OrnamentAnchor,
} from "./ornamentPlacement";
import { defaultRoofFeature } from "./roofFeatures";
import {
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import { buildExterior } from "./exteriorGeometry";
import { ornamentTriangles, ornamentPickParts } from "./ornamentPickGeometry";
import { initialHistory, commit, undo, redo } from "./history";
import { saveProject, loadProject } from "./storage";
import { generateArchitecturalBuildings } from "./architecturalGenerator";
import { advancedExamples } from "../tests/fixtures/advancedArchitecture";
const fixture = () => ornamentBuilding("None");
function wall(
  p: ReturnType<typeof fixture>,
  offset = 5000,
  z = 1800,
): OrnamentHit {
  const s = p.building.sections[0];
  return {
    sectionId: s.id,
    point: { x: offset, y: 0, z },
    wall: { sectionId: s.id, edge: 0, offset, z },
  };
}
describe("BG-06C.1 canonical direct placement", () => {
  it.each(ORNAMENT_TYPES)(
    "places %s through existing anchor validation, without changing architecture",
    (type) => {
      const p = fixture(),
        b = p.building,
        s = b.sections[0],
        ctx = ornamentPlacementContext(b),
        o = suggestedOrnament(b, s, type);
      const hit =
        type === "Entrance pillars"
          ? wall(p, 9000)
          : [
                "Dragon head",
                "Gable finial",
                "Gable panel",
                "Bargeboard",
                "Ridge trim",
              ].includes(type)
            ? {
                sectionId: s.id,
                point: {
                  x: 18000,
                  y: 4000,
                  z: ctx.roofAt({ x: 18000, y: 4000 }) - 100,
                },
                wall: null,
              }
            : wall(p);
      const draft = positionOrnament(b, hit, o, 500, ctx);
      previewOrnament(b, draft, null, ctx);
      const before = buildExterior(b),
        next = placeOrnament(b, draft, null),
        mesh = buildExterior(next);
      expect(b.sections[0].exterior.ornamentation.items).toHaveLength(0);
      expect(next.sections[0].exterior.ornamentation.items[0].id).toBe(o.id);
      expect(mesh.roofFacets).toEqual(before.roofFacets);
      expect(next.openings).toEqual(b.openings);
      expect(next.interior).toEqual(b.interior);
      const points = ornamentTriangles(
        next,
        next.sections[0],
        draft.ornament,
        ornamentPlacementContext(next),
      );
      expect(points.length).toBeGreaterThan(0);
      expect(points.every(Number.isFinite)).toBe(true);
      const parts = mesh.sections[0].parts;
      expect(points).toEqual([
        ...parts.ornamentWood,
        ...parts.ornamentDark,
        ...parts.ornamentOchre,
        ...parts.ornamentPale,
      ]);
      expect(
        ornamentPickParts(
          next,
          next.sections[0],
          draft.ornament,
          ornamentPlacementContext(next),
        ).relief,
      ).toEqual(parts.detail.slice(before.sections[0].parts.detail.length));
    },
  );
  it("moves wall anchors with grid and Free precision; preserves ID/settings/history and storage", async () => {
    const p = fixture(),
      s = p.building.sections[0],
      ctx = ornamentPlacementContext(p.building);
    const o = {
      ...suggestedOrnament(p.building, s, "Shield"),
      variant: 3 as const,
      finish: "Ochre" as const,
      mirror: true,
      scale: 850,
    };
    const first = positionOrnament(
      p.building,
      wall(p, 5017, 1801),
      o,
      null,
      ctx,
    );
    p.building = placeOrnament(p.building, first, null);
    const before = serializeProject(p),
      next = positionOrnament(
        p.building,
        wall(p, 6517, 2027),
        o,
        250,
        ornamentPlacementContext(p.building),
      );
    expect(next.ornament.anchor).toEqual({
      kind: "wall",
      edge: 0,
      offset: 6500,
      sill: 1500,
    });
    const moved = placeOrnament(p.building, next, first);
    expect(moved.sections[0].exterior.ornamentation.items[0]).toEqual({
      ...o,
      anchor: next.ornament.anchor,
    });
    const h = commit(initialHistory(p.building), moved);
    expect(undo(h).present).toEqual(p.building);
    expect(redo(undo(h)).present).toEqual(moved);
    expect(serializeProject(p)).toBe(before);
    const accepted = validateProject({ ...p, building: moved });
    expect(parseProject(serializeProject(accepted))).toEqual(accepted);
    const copy = validateProject(duplicateProject(accepted));
    expect(
      copy.building.sections[0].exterior.ornamentation.items[0].id,
    ).not.toBe(o.id);
    await saveProject(accepted);
    expect(await loadProject(accepted.id)).toEqual(accepted);
  });
  it("snaps a dragon between exposed main/cross-gable ends and rejects missing hosts", () => {
    const p = fixture(),
      s = p.building.sections[0];
    s.exterior.roofFeatures = [defaultRoofFeature(s, "cross")];
    validateProject(p);
    const ctx = ornamentPlacementContext(p.building),
      o = suggestedOrnament(p.building, s, "Dragon head");
    const first = positionOrnament(
      p.building,
      {
        sectionId: s.id,
        point: { x: 18000, y: 4000, z: ctx.roofAt({ x: 18000, y: 4000 }) },
        wall: null,
      },
      o,
      null,
      ctx,
    );
    const before = placeOrnament(p.building, first, null);
    const next = positionOrnament(
      before,
      {
        sectionId: s.id,
        point: { x: 9000, y: 0, z: ctx.roofAt({ x: 9000, y: 0 }) },
        wall: null,
      },
      o,
      null,
      ctx,
    );
    expect(next.ornament.anchor).toMatchObject({
      roofFeatureId: "cross",
      end: "Negative",
      offset: 0,
    });
    const moved = placeOrnament(before, next, first);
    expect(moved.sections[0].exterior.ornamentation.items).toHaveLength(1);
    expect(() =>
      placeOrnament(
        before,
        {
          ...next,
          ornament: {
            ...o,
            anchor: {
              kind: "roof",
              roofFeatureId: "missing",
              end: "Negative",
              offset: 0,
            },
          },
        },
        first,
      ),
    ).toThrow("anchor");
  });
  it("rejects door/window collisions, wrong hosts, missing entrances, stale sources and locks without mutation", () => {
    const p = fixture(),
      b = p.building,
      s = b.sections[0],
      ctx = ornamentPlacementContext(b),
      o = suggestedOrnament(b, s, "Shield"),
      before = serializeProject(p);
    const collision = positionOrnament(b, wall(p, 2000), o, null, ctx);
    expect(() => previewOrnament(b, collision, null, ctx)).toThrow(
      "door/window",
    );
    expect(() =>
      positionOrnament(b, { ...wall(p), wall: null }, o, null, ctx),
    ).toThrow("exposed");
    expect(() =>
      positionOrnament(
        b,
        wall(p, 1000),
        suggestedOrnament(b, s, "Entrance pillars"),
        null,
        ctx,
      ),
    ).toThrow("entrance");
    const first = positionOrnament(b, wall(p), o, null, ctx),
      placed = placeOrnament(b, first, null);
    expect(() =>
      placeOrnament(
        placed,
        { ...first, ornament: { ...o, id: "different" } },
        first,
      ),
    ).toThrow("stable ID");
    expect(() =>
      placeOrnament(placed, first, {
        ...first,
        ornament: { ...o, variant: 3 },
      }),
    ).toThrow("changed");
    const locked = structuredClone(placed);
    locked.sections[0].locked = true;
    expect(() => placeOrnament(locked, first, first)).toThrow("unlocked");
    expect(serializeProject(p)).toBe(before);
  });
  it("moves generated ornaments between compatible sections and respects both locks", () => {
    const p = generateArchitecturalBuildings(advancedExamples[2].config)
      .proposals[0].project;
    const b = structuredClone(p.building);
    b.sections.forEach(
      (s) => (s.exterior.ornamentation = { level: "Subtle", items: [] }),
    );
    const ctx = ornamentPlacementContext(b);
    const a = suggestedOrnament(b, b.sections[0], "Shield");
    let source: OrnamentAnchor | null = null,
      target: OrnamentAnchor | null = null;
    for (const section of b.sections) {
      for (const h of ctx.opening.hosts) {
        if (h.ref.kind !== "exterior" || h.ref.sectionId !== section.id)
          continue;
        for (
          let offset = 1000;
          offset < Math.hypot(h.b.x - h.a.x, h.b.y - h.a.y) - 500;
          offset += 750
        ) {
          const draft = {
            sectionId: section.id,
            ornament: {
              ...a,
              anchor: {
                kind: "wall" as const,
                edge: h.ref.edge,
                offset,
                sill: 1200,
              },
            },
          };
          try {
            previewOrnament(b, draft, null, ctx);
            if (!source) source = draft;
            else if (source.sectionId !== section.id) target = draft;
          } catch {}
          if (target) break;
        }
        if (target) break;
      }
      if (target) break;
    }
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    const placed = placeOrnament(b, source!, null),
      moved = placeOrnament(placed, target!, source!);
    expect(
      moved.sections.find((s) => s.id === source!.sectionId)!.exterior
        .ornamentation.items,
    ).toHaveLength(0);
    expect(
      moved.sections.find((s) => s.id === target!.sectionId)!.exterior
        .ornamentation.items[0].id,
    ).toBe(a.id);
    for (const id of [source!.sectionId, target!.sectionId]) {
      const locked = structuredClone(placed);
      locked.sections.find((s) => s.id === id)!.locked = true;
      expect(() => placeOrnament(locked, target!, source!)).toThrow("unlocked");
    }
  });
});
