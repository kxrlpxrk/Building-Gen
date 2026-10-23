import { combinedGeometry } from "./assembly";
import { bounds } from "./polygon";
import { it, expect } from "vitest";
import {
  createProject,
  validateProject,
  duplicateProject,
  parseProject,
  serializeProject,
} from "./model";
import { replaceSection, translateBuilding, openingContext } from "./assembly";
import { buildExterior, roofHeight } from "./exteriorGeometry";
import {
  STYLE_PRESETS,
  styleMaterial,
  type ExteriorWindow,
} from "./exteriorSettings";
import { validateExterior, windowOpening } from "./exteriorValidation";
import { changeOpenings } from "./openingBuilding";
import { newOpening, openingGeometry } from "./openings";
import { initialHistory, commit, undo, redo } from "./history";
import legacy from "../tests/fixtures/bg01-project-v6.json";
const window = (): ExteriorWindow => ({
  id: "window",
  edge: 0,
  offset: 3000,
  width: 900,
  height: 1000,
  sill: 1000,
  style: "Timber shuttered",
  shutters: true,
  glazing: false,
});
function fixture() {
  const p = createProject();
  p.building.sections[0].exterior.windows = [window()];
  return p;
}
it("cuts a real window aperture through the full wall and leaves logical rooms and circulation untouched", () => {
  const p = fixture(),
    before = structuredClone(p.building.interior),
    b = p.building;
  validateExterior(b);
  const g = openingGeometry(
    openingContext(b),
    windowOpening(b.sections[0], window()),
  );
  const m = buildExterior(b);
  const a = m.sections[0].parts.wall;
  for (let i = 0; i < a.length; i += 9) {
    const x = (a[i] + a[i + 3] + a[i + 6]) / 3,
      y = (a[i + 1] + a[i + 4] + a[i + 7]) / 3,
      z = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
    expect(
      x > g.gap.x + 0.01 &&
        x < g.gap.x + g.gap.width - 0.01 &&
        y > g.gap.y + 0.01 &&
        y < g.gap.y + g.gap.height - 0.01 &&
        z > 1000.01 &&
        z < 1999.99,
    ).toBe(false);
  }
  expect(b.interior).toEqual(before);
  expect(b.openings).toEqual([]);
});
it("rejects overlapping windows/doors, corners, excessive heights, invalid hosts and unsafe structural edits without mutations", () => {
  const p = fixture(),
    b = p.building,
    s = b.sections[0],
    before = JSON.stringify(b);
  expect(() =>
    changeOpenings(b, [
      newOpening("door", { kind: "exterior", sectionId: s.id, edge: 0 }, 3000),
    ]),
  ).toThrow(/overlap/);
  for (const change of [
    { offset: 200 },
    { height: 4000 },
    { width: 3000 },
    { edge: 99 },
  ])
    expect(() =>
      replaceSection(b, {
        ...s,
        exterior: { ...s.exterior, windows: [{ ...window(), ...change }] },
      }),
    ).toThrow();
  expect(() => replaceSection(b, { ...s, length: 2000 })).toThrow();
  expect(JSON.stringify(b)).toBe(before);
  const b2 = replaceSection(b, {
    ...s,
    exterior: {
      ...s.exterior,
      windows: [
        { ...window(), offset: 4000, width: 1100, height: 900, sill: 1200 },
      ],
    },
  });
  expect(b2.sections[0].exterior.windows[0].offset).toBe(4000);
});
it("preserves anchors on building translation/rotation, compatible resizing and settings history", () => {
  const p = fixture(),
    b = p.building,
    s = b.sections[0];
  const moved = translateBuilding(b, { x: 1000, y: 2000 });
  expect(moved.sections[0].exterior.windows).toEqual(s.exterior.windows);
  const rotated = { ...b, frame: { ...b.frame, rotation: 90 } };
  validateExterior(rotated);
  expect(buildExterior(rotated).sections).toEqual(buildExterior(b).sections);
  const resized = replaceSection(b, { ...s, length: 14000 });
  expect(resized.sections[0].exterior.windows).toEqual(s.exterior.windows);
  const h = commit(initialHistory(b), resized);
  expect(undo(h).present).toEqual(b);
  expect(redo(undo(h)).present).toEqual(resized);
  s.locked = true;
  expect(() =>
    replaceSection(b, { ...s, exterior: { ...s.exterior, windows: [] } }),
  ).toThrow(/locked/);
});
it.each(["Gable", "Hip", "Shed"] as const)(
  "supports a flashed chimney on %s and rejects unsafe placements",
  (roofStyle) => {
    const p = createProject(),
      s = p.building.sections[0];
    s.exterior.roofStyle = roofStyle;
    s.exterior.features = [
      {
        id: "chimney",
        kind: "Chimney",
        x: 4000,
        y: 3000,
        height: 1000,
        doorId: null,
        finish: "Brick",
      },
    ];
    validateExterior(p.building);
    const m = buildExterior(p.building);
    expect(m.sections[0].parts.brick.length).toBeGreaterThan(0);
    expect(m.maxHeight).toBeGreaterThan(
      roofHeight(s, p.building, { x: 4000, y: 3000 }),
    );
    expect(() =>
      replaceSection(p.building, {
        ...s,
        exterior: {
          ...s.exterior,
          features: [{ ...s.exterior.features[0], x: 100 }],
        },
      }),
    ).toThrow(/clearance/);
  },
);
it("validates entrance canopies, gable ornaments and retained door references", () => {
  const p = createProject(),
    s = p.building.sections[0];
  p.building = changeOpenings(p.building, [
    newOpening("door", { kind: "exterior", sectionId: s.id, edge: 0 }, 6000),
  ]);
  s.exterior.features = [
    {
      id: "canopy",
      kind: "Entrance canopy",
      x: 0,
      y: 0,
      height: 1000,
      doorId: "door",
      finish: "Stone",
    },
    {
      id: "ornament",
      kind: "Gable ornament",
      x: 0,
      y: 0,
      height: 700,
      doorId: null,
      finish: "Stone",
    },
  ];
  // changeOpenings retains section objects; validate/build must not mutate them.
  validateExterior(p.building);
  expect(buildExterior(p.building).maxHeight).toBeGreaterThan(7000);
  expect(() => changeOpenings(p.building, [])).toThrow(/requires/);
  expect(() =>
    replaceSection(p.building, {
      ...s,
      exterior: { ...s.exterior, roofStyle: "Hip" },
    }),
  ).toThrow(/gable/i);
  const copy = duplicateProject(p);
  expect(copy.building.sections[0].exterior.features[0].doorId).toBe(
    copy.building.openings[0].id,
  );
  expect(() => validateProject(copy)).not.toThrow();
});
it("migrates v6 exterior heights, roofs, locks and IDs losslessly; adds no windows/features", () => {
  const old = structuredClone(legacy),
    before = JSON.stringify(old),
    p = validateProject(old);
  expect(p.schemaVersion).toBe(7);
  expect(p).toMatchObject({ ...old, schemaVersion: 7 });
  expect(JSON.stringify(old)).toBe(before);
  expect(p.building.sections[0].exterior.windows).toEqual([]);
  expect(p.building.sections[0].exterior.features).toEqual([]);
});
it("roundtrips v7 windows/features and rekeys independent nested identities", () => {
  const p = fixture();
  p.building.sections[0].exterior.features = [
    {
      id: "chimney",
      kind: "Chimney",
      x: 4000,
      y: 3000,
      height: 1000,
      doorId: null,
      finish: "Stone",
    },
  ];
  expect(parseProject(serializeProject(p))).toEqual(p);
  const copy = duplicateProject(p);
  expect(() => validateProject(copy)).not.toThrow();
  expect(copy.building.sections[0].exterior.windows[0].id).not.toBe("window");
  expect(copy.building.sections[0].exterior.features[0].id).not.toBe("chimney");
  copy.building.sections[0].exterior.windows[0].width = 1200;
  expect(p.building.sections[0].exterior.windows[0].width).toBe(900);
  const bad = structuredClone(p);
  bad.building.sections[0].exterior.features[0].id = "window";
  expect(() => validateProject(bad)).toThrow(/distinct/);
});
it("five presets produce deterministic distinct facade geometry within bounded mobile buffers", () => {
  const p = createProject(),
    s = p.building.sections[0],
    shapes = new Set<string>();
  for (const stylePreset of STYLE_PRESETS) {
    s.exterior.stylePreset = stylePreset;
    s.exterior.material = styleMaterial(stylePreset);
    const m = buildExterior(p.building);
    shapes.add(JSON.stringify(m.sections[0].parts));
    expect(m).toEqual(buildExterior(p.building));
  }
  expect(shapes.size).toBe(5);
  s.exterior.detailLevel = "Low";
  expect(buildExterior(p.building).sections[0].parts.detail).toHaveLength(0);
  s.exterior.detailLevel = "High";
  const high = buildExterior(p.building);
  expect(high.sections[0].parts.detail.length).toBeGreaterThan(0);
  expect(
    Object.values(high.sections[0].parts).reduce((n, a) => n + a.length / 9, 0),
  ).toBeLessThan(250000);
});

import "fake-indexeddb/auto";
import { saveProject, loadProject, deleteProject } from "./storage";
import { changePartitions } from "./interiorBuilding";
it("validates new partition junctions against existing window bays before committing", () => {
  const p = fixture(),
    b = p.building,
    before = JSON.stringify(b);
  expect(() =>
    changePartitions(b, [
      {
        id: "partition",
        a: { x: 3000, y: 200 },
        b: { x: 3000, y: 7800 },
        thickness: 100,
      },
    ]),
  ).toThrow();
  expect(JSON.stringify(b)).toBe(before);
});
it("persists and reopens independent window/feature records and rejects corrupt imports without harming stored data", async () => {
  const p = fixture();
  p.building.sections[0].exterior.features = [
    {
      id: "chimney",
      kind: "Chimney",
      x: 4000,
      y: 3000,
      height: 1000,
      doorId: null,
      finish: "Stone",
    },
  ];
  const copy = duplicateProject(p);
  await saveProject(p);
  await saveProject(copy);
  expect(await loadProject(p.id)).toEqual(p);
  expect(await loadProject(copy.id)).toEqual(copy);
  const bad = structuredClone(p);
  bad.building.sections[0].exterior.windows[0].edge = 99;
  await expect(saveProject(bad)).rejects.toThrow();
  expect(await loadProject(p.id)).toEqual(p);
  const old = { ...structuredClone(p), schemaVersion: 6 };
  expect(() => validateProject(old)).toThrow(/require schemaVersion 7/);
  await deleteProject(p.id);
  await deleteProject(copy.id);
});

import { attachmentPreview } from "./attachments";
it("copies decorated sections with independent detail IDs and suppresses rafter overhang on joined-roof fallback", () => {
  const p = fixture(),
    s = p.building.sections[0];
  s.exterior.windows[0] = { ...window(), edge: 1, offset: 4000 };
  const result = attachmentPreview(
    p.building,
    {
      id: "copied-section",
      name: "Copy",
      type: "Custom",
      length: 12000,
      width: 8000,
      shape: "Rectangle",
      edge: 0,
      offset: 0,
    },
    s,
  );
  expect(result.error).toBeNull();
  const b = result.building!;
  expect(() => validateProject({ ...p, building: b })).not.toThrow();
  expect(b.sections[1].exterior.windows[0].id).not.toBe("window");
  b.sections[1].exterior.overhang = 200;
  const m = buildExterior(b),
    g = combinedGeometry(b);
  expect(m.warnings.some((w) => w.startsWith("Overhang fallback"))).toBe(true);
  const box = bounds(g.vertices);
  for (const section of m.sections) {
    const a = section.parts.detail;
    for (let i = 0; i < a.length; i += 3) {
      expect(a[i]).toBeGreaterThanOrEqual(box.minX - 150);
      expect(a[i]).toBeLessThanOrEqual(box.maxX + 150);
      expect(a[i + 1]).toBeGreaterThanOrEqual(box.minY - 150);
      expect(a[i + 1]).toBeLessThanOrEqual(box.maxY + 150);
    }
  }
});
it("reserves the complete frame/shutter bay at corners and beside adjacent openings", () => {
  const p = fixture(),
    s = p.building.sections[0];
  expect(() =>
    replaceSection(p.building, {
      ...s,
      exterior: { ...s.exterior, windows: [{ ...window(), offset: 1000 }] },
    }),
  ).toThrow(/frame\/shutters/);
  expect(() =>
    replaceSection(p.building, {
      ...s,
      exterior: {
        ...s.exterior,
        windows: [window(), { ...window(), id: "next", offset: 4600 }],
      },
    }),
  ).toThrow(/overlap/);
});
it("rejects steep low-eave roofs that would collide with window trim or an entrance canopy", () => {
  const p = fixture(),
    s = p.building.sections[0];
  expect(() =>
    replaceSection(p.building, {
      ...s,
      exterior: { ...s.exterior, wallHeight: 2400, roofPitch: 65 },
    }),
  ).toThrow(/roof underside/);
  const q = createProject(),
    a = q.building.sections[0];
  q.building = changeOpenings(q.building, [
    newOpening("entry", { kind: "exterior", sectionId: a.id, edge: 0 }, 6000),
  ]);
  expect(() =>
    replaceSection(q.building, {
      ...a,
      exterior: {
        ...a.exterior,
        wallHeight: 3100,
        roofPitch: 65,
        overhang: 1000,
        features: [
          {
            id: "canopy",
            kind: "Entrance canopy",
            x: 0,
            y: 0,
            height: 1000,
            doorId: "entry",
            finish: "Stone",
          },
        ],
      },
    }),
  ).toThrow(/roof overhang/);
});
it("rejects overlapping canopy roofs over neighbouring valid entrances", () => {
  const p = createProject(),
    s = p.building.sections[0];
  p.building = changeOpenings(
    p.building,
    [6000, 7400].map((offset, i) =>
      newOpening(
        `door${i}`,
        { kind: "exterior", sectionId: s.id, edge: 0 },
        offset,
      ),
    ),
  );
  expect(() =>
    replaceSection(p.building, {
      ...s,
      exterior: {
        ...s.exterior,
        features: [0, 1].map((i) => ({
          id: `canopy${i}`,
          kind: "Entrance canopy",
          x: 0,
          y: 0,
          height: 1000,
          doorId: `door${i}`,
          finish: "Stone",
        })),
      },
    }),
  ).toThrow(/canopies overlap/);
});
