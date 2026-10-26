import { it, expect } from "vitest";
import "fake-indexeddb/auto";
import { wingFixture } from "../tests/fixtures/roofCompositions";
import { attachmentPreview } from "./attachments";
import { combinedGeometry, openingContext } from "./assembly";
import { prepareRoofDirection } from "./roofDirection";
import { reconcileRoofDecorations } from "./roofDecorations";
import {
  suggestedOrnament,
  validateOrnamentation,
  resolveOrnament,
  ornamentRoofSurface,
} from "./ornamentation";
import {
  createProject,
  validateProject,
  duplicateProject,
  parseProject,
  serializeProject,
} from "./model";
import { initialHistory, commit, undo, redo } from "./history";
import { saveProject, loadProject } from "./storage";
import { defaultRoofFeature } from "./roofFeatures";
import { generateArchitecturalBuildings } from "./architecturalGenerator";
import { advancedExamples } from "../tests/fixtures/advancedArchitecture";
const fixture = () => {
  const p = wingFixture(),
    s = p.building.sections[1];
  s.exterior.ridgeAxis = "X";
  const o = suggestedOrnament(p.building, s, "Dragon head");
  o.variant = 3;
  o.mirror = true;
  o.finish = "Ochre";
  o.scale = 800;
  o.anchor = { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 };
  s.exterior.ornamentation = { level: "Fantasy", items: [o] };
  return validateProject(p);
};
it("moves an unsupported dragon to the opposite exposed end, preserving identity and styling", () => {
  const p = fixture(),
    before = structuredClone(p),
    s = p.building.sections[1],
    o = s.exterior.ornamentation.items[0];
  const r = prepareRoofDirection(p.building, s, { ridgeAxis: "Y" });
  expect(r.section.exterior.ornamentation.items).toEqual([
    { ...o, anchor: { ...o.anchor, end: "Positive" } },
  ]);
  expect(r.changes).toMatchObject({ moved: 1, removed: 0 });
  expect(p).toEqual(before);
  expect(r.building.sections[0]).toEqual(p.building.sections[0]);
});
it("reserves a valid original end before attempting relocation, removes only the incompatible motif, and restores exact history/storage/JSON", async () => {
  const p = fixture(),
    s = p.building.sections[1],
    o = s.exterior.ornamentation.items[0];
  s.exterior.ornamentation.items.push({
    ...o,
    id: "other-dragon",
    anchor: { kind: "roof", roofFeatureId: null, end: "Positive", offset: 0 },
  });
  validateProject(p);
  const original = structuredClone(p);
  const r = prepareRoofDirection(p.building, s, { ridgeAxis: "Y" });
  expect(r.section.exterior.ornamentation.items).toEqual([
    s.exterior.ornamentation.items[1],
  ]);
  expect(r.changes).toMatchObject({ moved: 0, removed: 1 });
  expect(r.changes.removals[0]).toMatch(/Dragon head/);
  const h = commit(
    initialHistory(p),
    validateProject({ ...p, building: r.building }),
  );
  expect(undo(h).present).toEqual(original);
  expect(redo(undo(h)).present).toEqual(h.present);
  expect(parseProject(serializeProject(h.present))).toEqual(h.present);
  await saveProject(h.present);
  expect(await loadProject(p.id)).toEqual(h.present);
  const copy = duplicateProject(h.present);
  validateProject(copy);
  expect(copy.building.sections[1].exterior.ornamentation.items[0].id).not.toBe(
    "other-dragon",
  );
  expect(
    copy.building.sections[1].exterior.ornamentation.items[0].anchor,
  ).toEqual(r.section.exterior.ornamentation.items[0].anchor);
  expect(p).toEqual(original);
});
it.each([
  "Dragon head",
  "Gable finial",
  "Gable panel",
  "Bargeboard",
  "Ridge trim",
] as const)("reconciles %s without rejecting a roof direction", (type) => {
  const p = fixture(),
    s = p.building.sections[1];
  const o = suggestedOrnament(p.building, s, type);
  o.anchor = { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 };
  s.exterior.ornamentation.items = [o];
  validateProject(p);
  const r = prepareRoofDirection(p.building, s, { ridgeAxis: "Y" });
  expect(r.section.exterior.ridgeAxis).toBe("Y");
  expect(r.changes.moved + r.changes.removed).toBe(1);
  validateOrnamentation(r.building);
});
it("removes unsupported paired legacy gables without changing unrelated sections", () => {
  const p = fixture(),
    s = p.building.sections[1];
  s.exterior.ornamentation.items = [];
  const f = {
    id: "paired",
    kind: "Gable ornament" as const,
    x: 0,
    y: 0,
    height: 700,
    doorId: null,
    finish: "Stone" as const,
  };
  s.exterior.ornamentation.items = [];
  const main = p.building.sections[0];
  main.exterior.features = [f];
  validateProject(p);
  const wingEdit = prepareRoofDirection(p.building, s, { ridgeAxis: "Y" });
  expect(wingEdit.building.sections[0].exterior.features).toEqual(
    main.exterior.features,
  );
  const r = prepareRoofDirection(p.building, main, { ridgeAxis: "Y" });
  expect(r.section.exterior.features).toEqual([]);
  expect(r.building.sections[1]).toEqual(p.building.sections[1]);
  expect(r.changes.removed).toBe(1);
});
it("preserves cross-gable IDs and reconciles attached ornaments during automatic host rotation", () => {
  const p = wingFixture(),
    s = p.building.sections[1];
  s.exterior.roofFeatures = [
    {
      ...defaultRoofFeature(s, "cross"),
      width: 1800,
      depth: 3000,
      side: "Positive",
      pitch: 25,
    },
  ];
  const o = suggestedOrnament(p.building, s, "Dragon head");
  o.anchor = {
    kind: "roof",
    roofFeatureId: "cross",
    end: "Positive",
    offset: 0,
  };
  s.exterior.ornamentation = { level: "Ornate", items: [o] };
  validateProject(p);
  const r = prepareRoofDirection(p.building, s, { ridgeAxis: "X" });
  expect(r.section.exterior.roofFeatures[0]).toMatchObject({
    id: "cross",
    ridgeAxis: "Y",
    width: 1800,
    depth: 3000,
  });
  validateOrnamentation(r.building);
  expect(
    r.section.exterior.ornamentation.items.every((t) => t.id === o.id),
  ).toBe(true);
});
it("uses a compatible cross-gable when main ends cannot host a terminal", () => {
  const p = wingFixture(),
    s = p.building.sections[1];
  s.exterior.ridgeAxis = "X";
  s.exterior.roofFeatures = [
    {
      ...defaultRoofFeature(s, "cross"),
      width: 1800,
      depth: 3000,
      side: "Positive",
      pitch: 25,
    },
  ];
  const o = suggestedOrnament(p.building, s, "Dragon head");
  o.anchor = { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 };
  // Reserve the sole new main terminal so the pending original must try a cross-gable.
  s.exterior.ornamentation = {
    level: "Ornate",
    items: [
      o,
      { ...o, id: "reserved", anchor: { ...o.anchor, end: "Positive" } },
    ],
  };
  validateProject(p);
  const r = prepareRoofDirection(p.building, s, { ridgeAxis: "Y" });
  validateOrnamentation(r.building);
  const moved = r.section.exterior.ornamentation.items.find(
    (t) => t.id === o.id,
  )!;
  expect(moved.anchor).toMatchObject({
    kind: "roof",
    roofFeatureId: "cross",
    end: "Positive",
  });
  expect(r.changes).toMatchObject({ moved: 1, removed: 0 });
});
it("moves a wall decoration down to nearby valid clearance, without touching windows or doors", () => {
  const p = createProject(),
    s = p.building.sections[0];
  const o = suggestedOrnament(p.building, s, "Shield");
  o.anchor = { kind: "wall", edge: 0, offset: 3000, sill: 2000 };
  s.exterior.ornamentation = { level: "Subtle", items: [o] };
  validateProject(p);
  const candidate = structuredClone(p.building);
  candidate.sections[0].exterior.wallHeight = 3000;
  const r = reconcileRoofDecorations(candidate);
  expect(r.changes).toMatchObject({ moved: 1, removed: 0 });
  const moved = r.building.sections[0].exterior.ornamentation.items[0];
  expect(moved.id).toBe(o.id);
  expect(moved.anchor).toMatchObject({ edge: 0, offset: 3000, sill: 1750 });
  expect(r.building.openings).toEqual(p.building.openings);
});
it("protects locked sections and rejects unsafe structural crossings before ornament reconciliation", () => {
  const p = fixture(),
    s = p.building.sections[1];
  s.locked = true;
  expect(() => prepareRoofDirection(p.building, s, { ridgeAxis: "Y" })).toThrow(
    /locked/,
  );
  s.locked = false;
  s.exterior.roofFeatures = [
    { ...defaultRoofFeature(s, "unsafe"), width: 9000 },
  ];
  expect(() =>
    prepareRoofDirection(p.building, s, { ridgeAxis: "Y" }),
  ).toThrow();
});
it("keeps Hip/Shed directions and valid nondecorative records, with deterministic generated Fantasy edits", () => {
  const p = generateArchitecturalBuildings(advancedExamples[2].config)
    .proposals[0].project;
  let accepted = 0;
  for (const s of p.building.sections) {
    let a: ReturnType<typeof prepareRoofDirection>;
    try {
      a = prepareRoofDirection(p.building, s, {
        ridgeAxis: s.exterior.ridgeAxis === "Y" ? "X" : "Y",
      });
    } catch {
      continue;
    }
    accepted++;
    const b = prepareRoofDirection(p.building, s, {
      ridgeAxis: s.exterior.ridgeAxis === "Y" ? "X" : "Y",
    });
    expect(a).toEqual(b);
    validateProject({ ...p, building: a.building });
    expect(a.building.openings).toEqual(p.building.openings);
    expect(a.building.interior).toEqual(p.building.interior);
    const supportedRoof = ornamentRoofSurface(a.building),
      supportedOpenings = openingContext(a.building);
    for (const old of p.building.sections) {
      const next = a.building.sections.find((t) => t.id === old.id)!;
      if (old.id !== s.id)
        for (const ornament of old.exterior.ornamentation.items) {
          let supported = true;
          try {
            resolveOrnament(
              a.building,
              next,
              ornament,
              supportedRoof,
              supportedOpenings,
            );
          } catch {
            supported = false;
          }
          if (supported)
            expect(
              next.exterior.ornamentation.items.find(
                (t) => t.id === ornament.id,
              ),
            ).toEqual(ornament);
        }
      expect(next.exterior.windows).toEqual(old.exterior.windows);
      expect(
        next.exterior.features.filter((f) => f.kind !== "Gable ornament"),
      ).toEqual(
        old.exterior.features.filter((f) => f.kind !== "Gable ornament"),
      );
    }
  }
  expect(accepted).toBeGreaterThan(0);
});

it.each(["Hip", "Shed"] as const)(
  "preserves wall decorations and real chimneys during %s direction changes",
  (roofStyle) => {
    const p = wingFixture(),
      s = p.building.sections[1];
    s.exterior.roofStyle = roofStyle;
    const o = suggestedOrnament(p.building, s, "Shield");
    o.anchor = { kind: "wall", edge: 1, offset: 3000, sill: 500 };
    s.exterior.ornamentation = { level: "Subtle", items: [o] };
    p.building.sections[0].exterior.features = [
      {
        id: "real-chimney",
        kind: "Chimney",
        x: 6000,
        y: 4000,
        height: 1000,
        doorId: null,
        finish: "Stone",
      },
    ];
    validateProject(p);
    const r = prepareRoofDirection(
      p.building,
      s,
      roofStyle === "Shed" ? { shedHighEdge: "-X" } : { ridgeAxis: "X" },
    );
    expect(r.section.exterior.ornamentation).toEqual(s.exterior.ornamentation);
    expect(r.changes.removed).toBe(0);
    expect(r.building.sections[0].exterior.features).toEqual(
      p.building.sections[0].exterior.features,
    );
  },
);

it("preserves decorations on an unrelated locked section and refuses to reconcile an invalid locked anchor", () => {
  const p = fixture(),
    main = p.building.sections[0];
  const o = suggestedOrnament(p.building, main, "Dragon head");
  o.anchor = { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 };
  main.exterior.ornamentation = { level: "Subtle", items: [o] };
  main.locked = true;
  validateProject(p);
  const r = prepareRoofDirection(p.building, p.building.sections[1], {
    ridgeAxis: "Y",
  });
  expect(r.building.sections[0]).toEqual(main);
  const invalid = structuredClone(p.building);
  invalid.sections[0].exterior.ridgeAxis = "Y";
  expect(() => reconcileRoofDecorations(invalid)).toThrow(/locked section/);
});

it("completes a roof edit when both new gable ends are internal joins, removing only the unsupported decoration", () => {
  const p = wingFixture();
  const ring = combinedGeometry(p.building).vertices;
  const edge = ring.findIndex(
    (v, i) => v.y === 8000 && ring[(i + 1) % ring.length].y === 8000,
  );
  const attached = attachmentPreview(p.building, {
    id: "rear-wing",
    name: "Rear",
    type: "Storage",
    shape: "Rectangle",
    length: 4000,
    width: 4000,
    edge,
    offset: 4000,
  });
  expect(attached.error).toBeFalsy();
  p.building = attached.building!;
  const main = p.building.sections[0],
    o = suggestedOrnament(p.building, main, "Dragon head");
  o.anchor = { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 };
  main.exterior.ornamentation = { level: "Fantasy", items: [o] };
  validateProject(p);
  const r = prepareRoofDirection(p.building, main, { ridgeAxis: "Y" });
  expect(r.section.exterior.ridgeAxis).toBe("Y");
  expect(r.section.exterior.ornamentation).toEqual({
    level: "Fantasy",
    items: [],
  });
  expect(r.changes).toMatchObject({ moved: 0, removed: 1 });
  expect(r.building.sections.slice(1)).toEqual(p.building.sections.slice(1));
});
