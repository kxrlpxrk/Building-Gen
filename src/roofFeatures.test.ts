import { attachmentPreview } from "./attachments";
import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  createProject,
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import { defaultRoofFeature } from "./roofFeatures";
import { buildExterior, ROOF_THICKNESS } from "./exteriorGeometry";
import { combinedGeometry, replaceSection, prepareBuilding } from "./assembly";
import { containsPoint } from "./interior";
import { onRing, planeHeight } from "./roofSurface";
import { polygonArea } from "./polygon";
import { saveProject, loadProject } from "./storage";
import { roofCompositions } from "../tests/fixtures/roofCompositions";
function fixture() {
  const p = createProject("Cross-gable hall");
  p.building.sections[0].exterior.roofFeatures = [
    defaultRoofFeature(p.building.sections[0], "cross-roof"),
  ];
  return p;
}
const at = (m: ReturnType<typeof buildExterior>, p: { x: number; y: number }) =>
  Math.max(
    ...m.roofFacets
      .filter((f) => containsPoint(f.polygon, p) || onRing(f.polygon, p))
      .map((f) => planeHeight(f.plane, p)),
  );
function skin(m: ReturnType<typeof buildExterior>) {
  let top = 0,
    bottom = 0;
  for (const s of m.sections) {
    const a = s.parts.roof;
    for (let i = 0; i < a.length; i += 9) {
      const ux = a[i + 3] - a[i],
        uy = a[i + 4] - a[i + 1],
        uz = a[i + 5] - a[i + 2],
        vx = a[i + 6] - a[i],
        vy = a[i + 7] - a[i + 1],
        vz = a[i + 8] - a[i + 2];
      expect(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz)).toBeGreaterThan(
        1e-5,
      );
      const signed = (ux * vy - uy * vx) / 2;
      if (signed > 0) top += signed;
      else bottom -= signed;
    }
  }
  expect(top).toBeCloseTo(m.roofArea, 2);
  expect(bottom).toBeCloseTo(m.roofArea, 2);
  expect(
    m.roofFacets.reduce((n, f) => n + polygonArea(f.polygon), 0),
  ).toBeCloseTo(m.roofArea, 2);
}
describe("BG-06A roof architecture", () => {
  it("clips a genuine cross ridge and analytic valley without changing footprint or walls", () => {
    const p = fixture(),
      s = p.building.sections[0],
      before = structuredClone(p.building);
    validateProject(p);
    const m = buildExterior(p.building),
      slope = Math.tan((s.exterior.roofPitch * Math.PI) / 180);
    expect(at(m, { x: 6000, y: 0 })).toBeCloseTo(
      s.exterior.wallHeight + 4000 * slope,
    );
    expect(at(m, { x: 6000, y: 4000 })).toBeCloseTo(
      s.exterior.wallHeight + 4000 * slope,
    );
    expect(at(m, { x: 5000, y: 1000 })).toBeCloseTo(
      s.exterior.wallHeight + 3000 * slope,
    );
    expect(at(m, { x: 3000, y: 2000 })).toBeCloseTo(
      s.exterior.wallHeight + 2000 * slope,
    );
    expect(combinedGeometry(p.building)).toEqual(combinedGeometry(before));
    expect(p.building).toEqual(before);
    skin(m);
    expect(m.roofTransitions.filter((t) => t.kind === "step")).toEqual([]);
    // Wall vertices must finish beneath the resolved skin; never above shingles.
    for (const part of m.sections) {
      const a = part.parts.wall;
      for (let i = 0; i < a.length; i += 9) {
        const q = {
          x: (a[i] + a[i + 3] + a[i + 6]) / 3,
          y: (a[i + 1] + a[i + 4] + a[i + 7]) / 3,
        };
        expect((a[i + 2] + a[i + 5] + a[i + 8]) / 3).toBeLessThanOrEqual(
          at(m, q) - ROOF_THICKNESS + 0.01,
        );
      }
    }
  });
  it.each(["Negative", "Positive", "Both"] as const)(
    "closes offset %s projections through pitch/depth/height variations",
    (side) => {
      for (const pitch of [30, 42, 55]) {
        const p = fixture(),
          s = p.building.sections[0];
        s.exterior.detailLevel = "High";
        s.exterior.roofFeatures[0] = {
          ...s.exterior.roofFeatures[0],
          side,
          width: 3000,
          offset: 4000,
          depth: 4000,
          pitch,
          relativeHeight: -100,
        };
        validateProject(p);
        const m = buildExterior(p.building);
        skin(m);
        expect(m.roofTransitions.every((t) => t.kind === "fascia")).toBe(true);
      }
    },
  );
  it("supports both host/local ridge directions and whole-building rotation", () => {
    const p = fixture(),
      s = p.building.sections[0];
    s.exterior.ridgeAxis = "Y";
    s.exterior.roofFeatures[0] = {
      ...defaultRoofFeature(s, "cross-roof"),
      width: 4000,
    };
    validateProject(p);
    skin(buildExterior(p.building));
    const b = prepareBuilding(
      { ...p.building, frame: { ...p.building.frame, rotation: 90 } },
      p.building,
    );
    expect(b.sections[0].exterior.roofFeatures).toEqual(
      s.exterior.roofFeatures,
    );
    skin(buildExterior(b));
  });
  it("keeps quarter-turned section domains exact and closed", () => {
    const p = fixture();
    p.building.frame.mode = "assembly";
    p.building.sections[0].orientation = 90;
    validateProject(p);
    skin(buildExterior(p.building));
  });
  it("rejects unsupported hosts, direction, endpoints, cutoffs, overlap and locks without mutation", () => {
    const p = fixture(),
      s = p.building.sections[0],
      old = serializeProject(p);
    for (const patch of [
      { depth: 1000, side: "Negative" as const },
      { offset: 100 },
      { pitch: 70 },
      { ridgeAxis: "X" as const },
      { relativeHeight: -1000, width: 1800, pitch: 20 },
    ]) {
      const bad = structuredClone(p);
      Object.assign(bad.building.sections[0].exterior.roofFeatures[0], patch);
      expect(() => validateProject(bad)).toThrow();
    }
    const bad = structuredClone(p);
    bad.building.sections[0].exterior.roofStyle = "Hip";
    expect(() => validateProject(bad)).toThrow("Gable host");
    const locked = structuredClone(p.building);
    locked.sections[0].locked = true;
    expect(() =>
      replaceSection(locked, {
        ...locked.sections[0],
        exterior: { ...s.exterior, roofFeatures: [] },
      }),
    ).toThrow();
    expect(serializeProject(p)).toBe(old);
  });
  it("requires explicit roof feature removal before deleting its host section", () => {
    const p = fixture(),
      previous = attachmentPreview(p.building, {
        id: "wing",
        name: "Wing",
        type: "Storage",
        shape: "Rectangle",
        edge: 1,
        length: 4000,
        width: 4000,
        offset: 2000,
      }).building!;
    expect(previous).toBeDefined();
    expect(() =>
      prepareBuilding(
        { ...previous, sections: previous.sections.slice(1) },
        previous,
      ),
    ).toThrow("Remove this section");
  });
  it("migrates v8 without altering legacy roofs or render data, never accepts new data under an old version", () => {
    const original = createProject(),
      old = JSON.parse(serializeProject(original));
    old.schemaVersion = 8;
    delete old.building.sections[0].exterior.roofFeatures;
    const migrated = validateProject(old);
    expect(migrated.building).toEqual(original.building);
    expect(buildExterior(migrated.building)).toEqual(
      buildExterior(original.building),
    );
    expect(old.building.sections[0].exterior.roofFeatures).toBeUndefined();
    const bad = fixture();
    expect(() => validateProject({ ...bad, schemaVersion: 8 })).toThrow(
      "schemaVersion 9",
    );
  });
  it("preserves IDs/references on save and rekeys independent roof features on duplication", async () => {
    const p = fixture();
    await saveProject(p);
    expect(await loadProject(p.id)).toEqual(p);
    expect(parseProject(serializeProject(p))).toEqual(p);
    const copy = validateProject(duplicateProject(p));
    expect(copy.building.sections[0].exterior.roofFeatures[0].id).not.toBe(
      "cross-roof",
    );
    expect(copy.building.sections[0].exterior.roofFeatures[0].width).toBe(8000);
  });
  it("retains real windows, doors and a chimney while aperture grids change", () => {
    const p = fixture(),
      s = p.building.sections[0],
      before = buildExterior(p.building);
    p.building.openings = [
      {
        id: "entrance",
        host: { kind: "exterior", sectionId: s.id, edge: 0 },
        type: "exterior-door",
        offset: 9000,
        width: 900,
        hinge: "left",
        swing: 1,
      },
    ];
    s.exterior.windows = [
      {
        id: "window",
        edge: 0,
        offset: 2000,
        width: 650,
        height: 700,
        sill: 1100,
        style: "Timber shuttered",
        shutters: true,
        glazing: false,
      },
    ];
    s.exterior.features = [
      {
        id: "chimney",
        kind: "Chimney",
        x: 4000,
        y: 4000,
        height: 1000,
        doorId: null,
        finish: "Stone",
      },
    ];
    const bytes = serializeProject(p);
    validateProject(p);
    const after = buildExterior(p.building);
    // Flashing is a separate physical roof skin; only compare the structural
    // envelope with its exact domain area, excluding that intentional overlay.
    skin(
      buildExterior({
        ...p.building,
        sections: p.building.sections.map((s) => ({
          ...s,
          exterior: { ...s.exterior, features: [] },
        })),
      }),
    );
    const chimneyTop = Math.max(
      ...after.sections[0].parts.stone.filter((_, i) => i % 3 === 2),
    );
    expect(chimneyTop).toBeGreaterThanOrEqual(
      at(after, { x: 4000, y: 4000 }) + 1000,
    );
    for (let x = 1000; x < 11000; x += 1500)
      for (let y = 500; y < 7500; y += 1000)
        expect(at(after, { x, y })).toBeCloseTo(at(before, { x, y }), 5);
    expect(serializeProject(p)).toBe(bytes);
  });
  it("keeps all repaired multi-wing roof fixtures unchanged with empty roof features", () => {
    for (const p of roofCompositions()) {
      expect(
        p.building.sections.every((s) => !s.exterior.roofFeatures.length),
      ).toBe(true);
      skin(buildExterior(p.building));
    }
  });
});
