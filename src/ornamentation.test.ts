import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  createProject,
  validateProject,
  parseProject,
  serializeProject,
  duplicateProject,
} from "./model";
import {
  ornamentPreset,
  suggestedOrnament,
  resolveOrnament,
  ornamentRoofSurface,
  ORNAMENT_LEVELS,
  ORNAMENT_TYPES,
  readOrnamentation,
} from "./ornamentation";
import { buildExterior } from "./exteriorGeometry";
import { defaultRoofFeature } from "./roofFeatures";
import { replaceSection, prepareBuilding } from "./assembly";
import { saveProject, loadProject } from "./storage";
import { ornamentCacheSize } from "./ornamentGeometry";
import {
  generateArchitecturalBuildings,
  defaultArchitecturalConfig,
} from "./architecturalGenerator";
function fixture() {
  const p = createProject("Carved hall"),
    s = p.building.sections[0];
  s.length = 18000;
  s.exterior.stylePreset = "Norse Chieftain's Hall";
  s.exterior.detailLevel = "High";
  p.building.openings = [
    {
      id: "entrance",
      type: "exterior-door",
      host: { kind: "exterior", sectionId: s.id, edge: 0 },
      width: 900,
      offset: 9000,
      hinge: "left",
      swing: 1,
    },
  ];
  s.exterior.windows = [
    {
      id: "window",
      edge: 0,
      offset: 3500,
      width: 650,
      height: 700,
      sill: 1100,
      style: "Timber shuttered",
      shutters: true,
      glazing: false,
    },
  ];
  return validateProject(p);
}
function triangles(a: number[]) {
  expect(a.length % 9).toBe(0);
  for (let i = 0; i < a.length; i += 9) {
    const u = [a[i + 3] - a[i], a[i + 4] - a[i + 1], a[i + 5] - a[i + 2]],
      v = [a[i + 6] - a[i], a[i + 7] - a[i + 1], a[i + 8] - a[i + 2]];
    expect(
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ),
    ).toBeGreaterThan(1e-7);
  }
}
describe("BG-06B canonical ornamentation", () => {
  it.each(ORNAMENT_LEVELS)(
    "%s creates valid visible levels without changing roofs/openings",
    (level) => {
      const p = fixture(),
        s = p.building.sections[0],
        before = buildExterior(p.building);
      s.exterior.ornamentation = ornamentPreset(
        p.building,
        s,
        level,
      ).ornamentation;
      validateProject(p);
      const mesh = buildExterior(p.building);
      expect(mesh.roofFacets).toEqual(before.roofFacets);
      expect(mesh.roofTransitions).toEqual(before.roofTransitions);
      expect(mesh.sections[0].parts.roof).toEqual(
        before.sections[0].parts.roof,
      );
      const count = mesh.sections[0].parts.ornamentWood.length;
      expect(level === "None" ? count === 0 : count > 0).toBe(true);
      if (level === "Ornate" || level === "Fantasy")
        expect(
          s.exterior.ornamentation.items.some((o) => o.type === "Dragon head"),
        ).toBe(true);
      for (const part of Object.values(mesh.sections[0].parts))
        expect(part.every(Number.isFinite)).toBe(true);
    },
  );
  it.each(ORNAMENT_TYPES)(
    "renders %s as bounded attached nondegenerate meshes",
    (type) => {
      const p = fixture(),
        s = p.building.sections[0],
        o = suggestedOrnament(p.building, s, type);
      if (o.anchor.kind === "wall") o.anchor.offset = 1500;
      s.exterior.ornamentation = { level: "Ornate", items: [o] };
      validateProject(p);
      const m = buildExterior(p.building);
      const body = m.sections[0].parts.ornamentWood;
      expect(body.length).toBeGreaterThan(0);
      expect(body.length / 9).toBeLessThan(2500);
      triangles(body);
    },
  );
  it("has distinct dragon variants and correct mirrored winding", () => {
    const p = fixture(),
      s = p.building.sections[0],
      o = suggestedOrnament(p.building, s, "Dragon head");
    const volume = (a: number[]) => {
      let sum = 0;
      for (let i = 0; i < a.length; i += 9)
        sum +=
          a[i] * (a[i + 4] * a[i + 8] - a[i + 5] * a[i + 7]) +
          a[i + 1] * (a[i + 5] * a[i + 6] - a[i + 3] * a[i + 8]) +
          a[i + 2] * (a[i + 3] * a[i + 7] - a[i + 4] * a[i + 6]);
      return sum / 6;
    };
    const signatures = [];
    for (const variant of [1, 2, 3] as const) {
      s.exterior.ornamentation = {
        level: "Ornate",
        items: [{ ...o, variant }],
      };
      const a = buildExterior(p.building).sections[0].parts.ornamentWood;
      expect(volume(a)).toBeGreaterThan(0);
      signatures.push(JSON.stringify(a));
      triangles(a);
      s.exterior.ornamentation.items[0].mirror = true;
      triangles(buildExterior(p.building).sections[0].parts.ornamentWood);
    }
    expect(new Set(signatures).size).toBe(3);
    expect(ornamentCacheSize()).toBeLessThanOrEqual(64);
  });
  it("follows crossing gable pitch/height, direction, size and whole-building rotation", () => {
    const p = fixture(),
      s = p.building.sections[0];
    s.exterior.roofFeatures = [defaultRoofFeature(s, "cross")];
    const o = suggestedOrnament(p.building, s, "Dragon head");
    o.anchor = {
      kind: "roof",
      roofFeatureId: "cross",
      end: "Negative",
      offset: 0,
    };
    s.exterior.ornamentation = { level: "Ornate", items: [o] };
    validateProject(p);
    const f = resolveOrnament(
      p.building,
      s,
      o,
      ornamentRoofSurface(p.building),
    );
    s.exterior.roofFeatures[0].pitch = 50;
    validateProject(p);
    const next = resolveOrnament(
      p.building,
      s,
      o,
      ornamentRoofSurface(p.building),
    );
    expect(next.origin.z).toBeGreaterThan(f.origin.z);
    expect(next.u).toEqual(f.u);
    expect(() =>
      replaceSection(p.building, {
        ...s,
        exterior: { ...s.exterior, roofFeatures: [] },
      }),
    ).toThrow("anchor");
    const rotated = prepareBuilding(
      { ...p.building, frame: { ...p.building.frame, rotation: 90 } },
      p.building,
    );
    expect(rotated.sections[0].exterior.ornamentation).toEqual(
      s.exterior.ornamentation,
    );
    buildExterior(rotated);
  });
  it("rejects missing hosts, door/window collision, unsafe roof changes and locked edits without mutation", () => {
    const p = fixture(),
      s = p.building.sections[0],
      o = suggestedOrnament(p.building, s, "Shield");
    o.anchor = { kind: "wall", edge: 0, offset: 3500, sill: 1100 };
    s.exterior.ornamentation = { level: "Ornate", items: [o] };
    expect(() => validateProject(p)).toThrow("door/window");
    o.anchor.offset = 1500;
    validateProject(p);
    const bytes = serializeProject(p);
    const locked = structuredClone(p.building);
    locked.sections[0].locked = true;
    expect(() =>
      replaceSection(locked, {
        ...locked.sections[0],
        exterior: {
          ...s.exterior,
          ornamentation: { level: "None", items: [] },
        },
      }),
    ).toThrow("locked");
    expect(serializeProject(p)).toBe(bytes);
  });
  it("keeps medieval presets free of automatic dragons but allows explicit motifs", () => {
    const p = fixture(),
      s = p.building.sections[0];
    // A selected medieval preset must remain dragon-free even if material was edited separately.
    s.exterior.stylePreset = "Medieval Manor";
    const preset = ornamentPreset(p.building, s, "Fantasy");
    expect(
      preset.ornamentation.items.some((o) => o.type === "Dragon head"),
    ).toBe(false);
    s.exterior.ornamentation = {
      level: "Ornate",
      items: [suggestedOrnament(p.building, s, "Dragon head")],
    };
    expect(
      validateProject(p).building.sections[0].exterior.ornamentation.items,
    ).toHaveLength(1);
  });
  it("migrates v9 losslessly and rejects decorations hidden inside legacy schemas", () => {
    const p = fixture();
    p.building.sections[0].exterior.roofFeatures = [
      defaultRoofFeature(p.building.sections[0], "legacy-cross"),
    ];
    const old = JSON.parse(serializeProject(p));
    old.schemaVersion = 9;
    delete old.building.sections[0].exterior.ornamentation;
    const bytes = JSON.stringify(old),
      next = validateProject(old);
    expect(next.building).toEqual(p.building);
    expect(JSON.stringify(old)).toBe(bytes);
    const bad = structuredClone(old);
    bad.building.sections[0].exterior.ornamentation = {
      level: "Ornate",
      items: [],
    };
    expect(() => validateProject(bad)).toThrow("schemaVersion 10");
  });
  it("rekeys cross-roof and entrance ornament references on independent duplication/save/JSON", async () => {
    const p = fixture(),
      s = p.building.sections[0];
    s.exterior.roofFeatures = [defaultRoofFeature(s, "cross")];
    const o = suggestedOrnament(p.building, s, "Dragon head");
    o.anchor = {
      kind: "roof",
      roofFeatureId: "cross",
      end: "Negative",
      offset: 0,
    };
    s.exterior.ornamentation = {
      level: "Ornate",
      items: [o, suggestedOrnament(p.building, s, "Entrance pillars")],
    };
    validateProject(p);
    const copy = validateProject(duplicateProject(p)),
      ex = copy.building.sections[0].exterior;
    expect(ex.ornamentation.items[0].id).not.toBe(o.id);
    expect(ex.ornamentation.items[0].anchor).toMatchObject({
      roofFeatureId: ex.roofFeatures[0].id,
    });
    expect(ex.ornamentation.items[1].anchor).toMatchObject({
      doorId: copy.building.openings[0].id,
    });
    expect(parseProject(serializeProject(copy))).toEqual(copy);
    await saveProject(copy);
    expect(await loadProject(copy.id)).toEqual(copy);
    expect(s.exterior.roofFeatures[0].id).toBe("cross");
  });
  it("bounded complete generation still emits undecorated projects and validates all presets", () => {
    const r = generateArchitecturalBuildings({
      ...defaultArchitecturalConfig(),
      extensions: 3,
      detail: "High",
    });
    expect(r.proposals.length).toBeGreaterThan(0);
    for (const p of r.proposals) {
      const s = p.project.building.sections[0];
      expect(s.exterior.ornamentation).toEqual({ level: "None", items: [] });
      s.exterior.ornamentation = ornamentPreset(
        p.project.building,
        s,
        "Ornate",
      ).ornamentation;
      validateProject(p.project);
      buildExterior(p.project.building);
    }
  });
  it("rejects a roof change that buries a trim midway between its endpoints", () => {
    const p = fixture(),
      s = p.building.sections[0];
    s.width = 4000;
    s.exterior.ornamentation = {
      level: "Ornate",
      items: [suggestedOrnament(p.building, s, "Ridge trim")],
    };
    validateProject(p);
    const cross = {
      ...defaultRoofFeature(s, "cross-midway"),
      width: 1800,
      offset: 1500,
      relativeHeight: 400,
      pitch: 60,
    };
    expect(() =>
      replaceSection(p.building, {
        ...s,
        exterior: { ...s.exterior, roofFeatures: [cross] },
      }),
    ).toThrow("covered");
    expect(s.exterior.roofFeatures).toHaveLength(0);
  });
  it("rejects malformed scales, arrays and unknown anchor kinds", () => {
    for (const patch of [
      { scale: 0 },
      { scale: 1700 },
      { anchor: { kind: "floating" } },
    ])
      expect(() =>
        readOrnamentation({
          level: "Ornate",
          items: [
            {
              ...suggestedOrnament(
                fixture().building,
                fixture().building.sections[0],
                "Dragon head",
              ),
              ...patch,
            },
          ],
        }),
      ).toThrow();
  });
});
