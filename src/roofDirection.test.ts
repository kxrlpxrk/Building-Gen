import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { wingFixture } from "../tests/fixtures/roofCompositions";
import {
  prepareRoofDirection,
  rotateCrossingFrame,
  roofDirectionError,
} from "./roofDirection";
import { defaultRoofFeature } from "./roofFeatures";
import { buildExterior } from "./exteriorGeometry";
import { roofPlanes } from "./roofFields";
import { ridgeAlongX } from "./exteriorSettings";
import { validateProject, parseProject, serializeProject } from "./model";
import { commit, initialHistory, undo, redo } from "./history";
import { saveProject, loadProject } from "./storage";
import { suggestedOrnament } from "./ornamentation";
import { generateArchitecturalBuildings } from "./architecturalGenerator";
import { advancedExamples } from "../tests/fixtures/advancedArchitecture";

describe("BG-06C.1.1 extension directions", () => {
  it.each(["Gable", "Hip"] as const)(
    "updates explicit %s extension axes, rendered surfaces, history and persistence in isolation",
    async (roofStyle) => {
      const p = wingFixture();
      p.building.sections[1].exterior.roofStyle = roofStyle;
      const b = p.building,
        s = b.sections[1],
        original = structuredClone(b);
      const first = prepareRoofDirection(b, s, { ridgeAxis: "X" });
      const next = prepareRoofDirection(first.building, first.section, {
        ridgeAxis: "Y",
      });
      expect(roofPlanes(first.section, first.building)).not.toEqual(
        roofPlanes(next.section, next.building),
      );
      expect(first.model.sections[1].parts.roof).not.toEqual(
        next.model.sections[1].parts.roof,
      );
      expect(next.section.exterior.ridgeAxis).toBe("Y");
      expect(next.building.sections[0]).toEqual(b.sections[0]);
      expect({ ...next.section, exterior: s.exterior }).toEqual(s);
      const h = commit(initialHistory(first.building), next.building);
      expect(undo(h).present).toEqual(first.building);
      expect(redo(undo(h)).present).toEqual(next.building);
      const accepted = validateProject({ ...p, building: next.building });
      expect(parseProject(serializeProject(accepted))).toEqual(accepted);
      await saveProject(accepted);
      expect(await loadProject(p.id)).toEqual(accepted);
      expect(b).toEqual(original);
    },
  );
  it("supports all four shed high edges at different eaves without changing other settings", () => {
    const p = wingFixture();
    const s = p.building.sections[1];
    s.exterior.roofStyle = "Shed";
    s.exterior.wallHeight = 2600;
    const shapes = new Set<string>();
    for (const shedHighEdge of ["+X", "-X", "+Y", "-Y"] as const) {
      const r = prepareRoofDirection(p.building, s, { shedHighEdge });
      expect(r.section.exterior.shedHighEdge).toBe(shedHighEdge);
      expect(r.section.exterior.wallHeight).toBe(2600);
      expect(r.building.sections[0]).toEqual(p.building.sections[0]);
      shapes.add(JSON.stringify(roofPlanes(r.section, r.building)));
    }
    expect(shapes.size).toBe(4);
  });
  it("rejects a conflicting crossing direction then rotates both frames atomically without dropping dimensions or IDs", () => {
    const p = wingFixture();
    const s = p.building.sections[1];
    s.exterior.roofFeatures = [
      {
        ...defaultRoofFeature(s, "wing-cross"),
        width: 1800,
        depth: 3000,
        side: "Positive",
        pitch: 25,
      },
    ];
    validateProject(p);
    const axis = ridgeAlongX(s) ? "Y" : "X";
    expect(() =>
      prepareRoofDirection(p.building, s, { ridgeAxis: axis }),
    ).toThrow(/secondary ridge/);
    const next = prepareRoofDirection(p.building, s, { ridgeAxis: axis }, true);
    const f = next.section.exterior.roofFeatures[0],
      old = s.exterior.roofFeatures[0];
    expect(f.ridgeAxis).not.toBe(axis);
    expect({ ...f, ridgeAxis: old.ridgeAxis, offset: old.offset }).toEqual(old);
    expect(next.building.sections[0]).toEqual(p.building.sections[0]);
    expect(next.section.exterior.ornamentation).toEqual(
      s.exterior.ornamentation,
    );
    buildExterior(next.building);
  });
  it("keeps full-crossing run derived from the host while rotating both ways", () => {
    const p = wingFixture(),
      s = p.building.sections[0];
    s.exterior.ridgeAxis = "X";
    s.exterior.roofFeatures = [
      { ...defaultRoofFeature(s, "full-cross"), width: 1800, offset: 3000 },
    ];
    validateProject(p);
    const y = prepareRoofDirection(p.building, s, { ridgeAxis: "Y" }, true);
    expect(y.section.exterior.roofFeatures[0]).toMatchObject({
      id: "full-cross",
      width: 1800,
      depth: s.length,
    });
    const x = prepareRoofDirection(
      y.building,
      y.section,
      { ridgeAxis: "X" },
      true,
    );
    expect(x.section.exterior.roofFeatures).toEqual(s.exterior.roofFeatures);
    expect(x.building.sections[1]).toEqual(p.building.sections[1]);
  });
  it("does not shrink an unsafe crossing feature or edit locked sections", () => {
    const p = wingFixture(),
      s = p.building.sections[1];
    s.exterior.roofFeatures = [
      { ...defaultRoofFeature(s, "too-wide"), width: 4500, depth: 3000 },
    ];
    const axis = ridgeAlongX(s) ? "Y" : "X";
    expect(rotateCrossingFrame(s, axis).exterior.roofFeatures[0].width).toBe(
      4500,
    );
    expect(() =>
      prepareRoofDirection(p.building, s, { ridgeAxis: axis }, true),
    ).toThrow();
    s.exterior.roofFeatures = [];
    s.locked = true;
    expect(() =>
      prepareRoofDirection(p.building, s, { ridgeAxis: axis }),
    ).toThrow(/locked/);
  });
  it("preserves a supported dragon and rejects rotating it onto an open-plan join", () => {
    const p = wingFixture(),
      s = p.building.sections[1];
    // Local Y=0 is the shared attachment; both local X ends are exposed.
    s.exterior.ridgeAxis = "X";
    const o = suggestedOrnament(p.building, s, "Dragon head");
    o.anchor = {
      kind: "roof",
      roofFeatureId: null,
      end: "Negative",
      offset: 0,
    };
    s.exterior.ornamentation = { level: "Ornate", items: [o] };
    validateProject(p);
    const original = structuredClone(p.building);
    const unchanged = prepareRoofDirection(p.building, s, { ridgeAxis: "X" });
    expect(unchanged.section.exterior.ornamentation.items[0]).toEqual(o);
    expect(() =>
      prepareRoofDirection(p.building, s, { ridgeAxis: "Y" }),
    ).toThrow(/exposed supported facade/);
    expect(p.building).toEqual(original);
  });
  it("rejects an explicit Hip axis that would violate existing window eaves clearance", () => {
    const p = wingFixture(),
      s = p.building.sections[1];
    Object.assign(s.exterior, {
      roofStyle: "Hip",
      ridgeAxis: "Y",
      wallHeight: 3000,
      roofPitch: 35,
    });
    s.exterior.windows = [
      {
        id: "high-window",
        edge: 1,
        offset: 3000,
        width: 600,
        height: 800,
        sill: 1850,
        style: "Timber shuttered",
        shutters: true,
        glazing: false,
      },
    ];
    validateProject(p);
    const original = structuredClone(p.building);
    let issue = "";
    try {
      prepareRoofDirection(p.building, s, { ridgeAxis: "X" });
    } catch (e) {
      issue = (e as Error).message;
    }
    expect(issue).toMatch(/Window frame.*roof underside/);
    expect(roofDirectionError(issue)).toContain(
      "relocate the affected window or chimney",
    );
    expect(roofDirectionError(issue)).not.toContain("Footprint edit rejected");
    expect(p.building).toEqual(original);
  });
  it("routes generated three-extension hall edits through ordinary validators without changing other sections", () => {
    const p = generateArchitecturalBuildings(advancedExamples[2].config)
      .proposals[0].project;
    for (const s of p.building.sections.slice(1)) {
      const before = structuredClone(p.building);
      let result: ReturnType<typeof prepareRoofDirection> | null = null;
      let issue = "";
      try {
        result = prepareRoofDirection(
          p.building,
          s,
          { ridgeAxis: ridgeAlongX(s) ? "Y" : "X" },
          true,
        );
      } catch (e) {
        issue = (e as Error).message;
      }
      if (result) {
        expect(result.building.sections.filter((t) => t.id !== s.id)).toEqual(
          p.building.sections.filter((t) => t.id !== s.id),
        );
        validateProject({ ...p, building: result.building });
      } else expect(issue.length).toBeGreaterThan(5);
      expect(p.building).toEqual(before);
    }
  });
});
