import { describe, expect, it } from "vitest";
import {
  areas,
  corners,
  localToWorld,
  metres,
  moveRectangle,
  resizeRectangle,
  snap,
  toMillimetres,
  validateRectangle,
  worldToLocal,
} from "./geometry";
import { commit, initialHistory, redo, undo } from "./history";
import {
  createProject,
  duplicateProject,
  parseProject,
  serializeProject,
} from "./model";
import {
  fitCamera,
  panCamera,
  pinchCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "./transforms";
describe("integer millimetre measurements and geometry", () => {
  const section = createProject().building.sections[0];
  it("calculates the acceptance areas exactly", () => {
    expect(areas(section)).toEqual({ exterior: 96, interior: 88.16 });
  });
  it("formats precise metric values and converts decimal metres", () => {
    expect(metres(12345)).toBe("12.345");
    expect(toMillimetres(0.251)).toBe(251);
  });
  it("snaps positive and negative coordinates, and free mode preserves millimetres", () => {
    expect(snap(1270, 500)).toBe(1500);
    expect(snap(-1270, 500)).toBe(-1500);
    expect(snap(1271, null)).toBe(1271);
  });
  it("moves on the chosen grid without changing dimensions", () => {
    const next = moveRectangle(section, { x: 1270, y: -610 }, 500);
    expect(next.position).toEqual({ x: 1500, y: -500, z: 0 });
    expect(next.length).toBe(12000);
    expect(section.position.x).toBe(0);
  });
  it("grid selection is independent of exact dimensions", () => {
    const precise = { ...section, length: 12347 };
    for (const grid of [250, 500, 1000, 2000, null]) {
      expect(moveRectangle(precise, { x: 1, y: 1 }, grid).length).toBe(12347);
    }
  });
  it("resizes all corners while preserving the opposite anchor", () => {
    for (let corner = 0; corner < 4; corner++) {
      const old = corners(section),
        opposite = (corner + 2) % 4;
      const next = resizeRectangle(
        section,
        corner,
        { x: old[corner].x + 1000, y: old[corner].y + 500 },
        500,
      );
      expect(corners(next)[opposite]).toEqual(old[opposite]);
      expect(validateRectangle(next)).toBeNull();
    }
  });
  it("resizes rotated sections with millimetre-rounding bounded anchor error", () => {
    const r = {
      ...section,
      orientation: 37,
      position: { x: -1200, y: 3300, z: 500 },
    };
    const point = localToWorld({ x: -1000, y: -500 }, r);
    const next = resizeRectangle(r, 0, point, 500),
      oldAnchor = corners(r)[2],
      newAnchor = corners(next)[2];
    expect(
      Math.hypot(oldAnchor.x - newAnchor.x, oldAnchor.y - newAnchor.y),
    ).toBeLessThan(1);
    expect(next.length).toBe(13000);
    expect(next.width).toBe(8500);
    expect(next.position.z).toBe(500);
    const local = worldToLocal(point, r);
    expect(local.x).toBeCloseTo(-1000);
    expect(local.y).toBeCloseTo(-500);
  });
  it("prevents crossing through the opposite corner or making solid walls", () => {
    const next = resizeRectangle(
      { ...section, wallThickness: 800 },
      2,
      { x: -100, y: -100 },
      500,
    );
    expect(next.length).toBe(1601);
    expect(validateRectangle(next)).toBeNull();
    expect(validateRectangle({ ...section, wallThickness: 4000 })).toMatch(
      /positive interior/,
    );
    expect(validateRectangle({ ...section, length: 12.5 })).toMatch(
      /whole millimetres/,
    );
    expect(validateRectangle({ ...section, length: 500001 })).toMatch(/500 m/);
    expect(validateRectangle({ ...section, orientation: NaN })).toMatch(
      /Orientation/,
    );
    expect(
      validateRectangle({ ...section, position: { x: 10000001, y: 0, z: 0 } }),
    ).toMatch(/Position/);
  });
});
describe("versioned project serialization", () => {
  it("roundtrips geometry, stable IDs, timestamps and metadata", () => {
    const p = createProject("Great Hall");
    p.architecture = "Mixed";
    Object.assign(p.building.sections[0], {
      length: 13251,
      orientation: 42.5,
      floorCount: 4,
      position: { x: -123, y: 321, z: 1250 },
    });
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it("creates independent copies with new identities", () => {
    const p = createProject(),
      copy = duplicateProject(p);
    copy.building.sections[0].position.x = 9000;
    expect(p.building.sections[0].position.x).toBe(0);
    expect(copy.id).not.toBe(p.id);
    expect(copy.building.id).not.toBe(p.building.id);
    expect(copy.building.sections[0].id).not.toBe(p.building.sections[0].id);
  });
  it("rejects invalid and unsupported imports without modifying valid state", () => {
    const p = createProject(),
      original = serializeProject(p);
    for (const value of [
      "oops",
      "null",
      '{"schemaVersion":2}',
      JSON.stringify({ ...p, name: "" }),
      JSON.stringify({ ...p, building: { id: p.building.id, sections: [] } }),
    ])
      expect(() => parseProject(value)).toThrow();
    const bad = structuredClone(p);
    bad.building.sections[0].floorCount = 5;
    expect(() => parseProject(JSON.stringify(bad))).toThrow();
    bad.building.sections[0].floorCount = 1;
    bad.building.sections[0].width = Infinity;
    expect(() => parseProject(JSON.stringify(bad))).toThrow();
    expect(serializeProject(p)).toBe(original);
  });
});
describe("editing transactions", () => {
  it("undoes/redoes whole edits and discards redo after a new edit", () => {
    const p = createProject();
    let h = initialHistory(p);
    h = commit(h, { ...p, name: "Hall" });
    h = commit(h, { ...h.present, architecture: "Medieval" });
    h = undo(h);
    expect(h.present.name).toBe("Hall");
    expect(h.present.architecture).toBe("Norse");
    h = redo(h);
    expect(h.present.architecture).toBe("Medieval");
    h = commit(undo(h), { ...p, name: "New branch" });
    expect(h.future).toEqual([]);
    expect(undo(undo(h)).present).toEqual(p);
    expect(undo(initialHistory(p)).present).toEqual(p);
  });
  it("ignores unchanged commits and bounds session history", () => {
    let h = initialHistory(0);
    expect(commit(h, 0)).toBe(h);
    for (let i = 1; i <= 200; i++) h = commit(h, i);
    expect(h.past.length).toBe(100);
  });
});
describe("screen and world transforms", () => {
  const v = { width: 390, height: 410 },
    c = { center: { x: -3200, y: 7000 }, scale: 0.025 };
  it("roundtrips off-center, negative world points", () => {
    const p = { x: -12345, y: 9321 },
      actual = screenToWorld(worldToScreen(p, c, v), c, v);
    expect(actual.x).toBeCloseTo(p.x);
    expect(actual.y).toBeCloseTo(p.y);
  });
  it("keeps the pointer anchor fixed under zoom, including clamps", () => {
    const anchor = { x: 71, y: 102 },
      before = screenToWorld(anchor, c, v);
    for (const factor of [0.1, 3, 1e9, 1e-9]) {
      const next = zoomAt(c, anchor, factor, v),
        after = screenToWorld(anchor, next, v);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    }
  });
  it("pans with screen-space deltas", () => {
    expect(panCamera(c, { x: 25, y: -50 }).center).toEqual({
      x: -4200,
      y: 9000,
    });
  });
  it("pinch midpoint follows the same world anchor while zooming", () => {
    const start = { x: 100, y: 150 },
      end = { x: 160, y: 210 },
      before = screenToWorld(start, c, v);
    const after = screenToWorld(end, pinchCamera(c, start, end, 2, v), v);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it("fits rotated geometry in portrait and landscape", () => {
    const r = { ...createProject().building.sections[0], orientation: 43 };
    for (const view of [v, { width: 844, height: 200 }]) {
      const fit = fitCamera(r, view);
      for (const p of corners(r)) {
        const q = worldToScreen(p, fit, view);
        expect(q.x).toBeGreaterThan(0);
        expect(q.x).toBeLessThan(view.width);
        expect(q.y).toBeGreaterThan(0);
        expect(q.y).toBeLessThan(view.height);
      }
    }
  });
});
