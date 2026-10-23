import { exteriorDefaults } from "./exteriorSettings";
import { describe, expect, it } from "vitest";
import {
  areas,
  corners,
  footprintVertices,
  moveRectangle,
  rotate,
  validateFootprint,
} from "./geometry";
import { applyPreset, scaleFootprint, withVertices } from "./footprint";
import { commit, initialHistory, redo, undo } from "./history";
import {
  createProject,
  duplicateProject,
  parseProject,
  serializeProject,
  validateProject,
} from "./model";
import {
  bounds,
  dragEdge,
  dragVertex,
  edgeLength,
  insetPolygon,
  polygonArea,
  presetVertices,
  setEdgeLength,
  SHAPES,
  validatePolygon,
} from "./polygon";
import { fitCamera, pinchCamera, worldToScreen } from "./transforms";
describe("orthogonal polygon geometry", () => {
  const section = createProject().building.sections[0];
  it.each(SHAPES)(
    "%s is one valid connected ring with a valid clear interior",
    (shape) => {
      const s = applyPreset(section, shape),
        vertices = footprintVertices(s);
      expect(validateFootprint(s)).toBeNull();
      expect(validatePolygon(vertices)).toBeNull();
      expect(areas(s).exterior).toBeGreaterThan(areas(s).interior);
      expect(areas(s).interior).toBeGreaterThan(0);
    },
  );
  it("uses actual concave L geometry, never its 96 m² bounding box", () => {
    const s = applyPreset(section, "L-shape");
    expect(areas(s)).toEqual({ exterior: 84, interior: 76.16 });
    expect(polygonArea(presetVertices("L-shape").reverse())).toBe(84e6);
    expect(
      polygonArea(insetPolygon(presetVertices("L-shape").reverse(), 200)),
    ).toBe(76.16e6);
  });
  it("has analytically correct T, U, Cross and irregular areas on an exact 12 × 12 m grid", () => {
    const expected = {
      Rectangle: 144,
      "L-shape": 126,
      "T-shape": 80,
      "U-shape": 112,
      Cross: 80,
      Irregular: 114,
    };
    for (const shape of SHAPES)
      expect(polygonArea(presetVertices(shape, 12000, 12000)) / 1e6).toBe(
        expected[shape],
      );
  });
  it("calculates exact uniform mitered wall areas for concave shapes", () => {
    // For these simple rings (before offset topology changes): Ainner = A - perimeter*t + 4*t².
    for (const shape of SHAPES) {
      const v = presetVertices(shape),
        perimeter = v.reduce((sum, _, i) => sum + edgeLength(v, i), 0);
      expect(polygonArea(insetPolygon(v, 200))).toBe(
        polygonArea(v) - perimeter * 200 + 4 * 200 * 200,
      );
    }
  });
  it("moves an edge perpendicular and preserves all other vertices", () => {
    const v = presetVertices("L-shape"),
      moved = dragEdge(v, 2, 1000);
    expect(moved[2]).toEqual({ x: 12000, y: 6000 });
    expect(moved[3]).toEqual({ x: 8000, y: 6000 });
    expect(moved[0]).toEqual(v[0]);
    expect(polygonArea(moved)).toBe(88e6);
    expect(validatePolygon(moved)).toBeNull();
    expect(v[2].y).toBe(5000);
  });
  it("moves a concave vertex and its orthogonal neighbours accurately", () => {
    const v = presetVertices("L-shape"),
      moved = dragVertex(v, 3, { x: 7000, y: 4500 });
    expect(moved[2]).toEqual({ x: 12000, y: 4500 });
    expect(moved[4]).toEqual({ x: 7000, y: 8000 });
    expect(validatePolygon(moved)).toBeNull();
    expect(polygonArea(moved)).toBe(78.5e6);
  });
  it("edits exact edge lengths while retaining the start and orthogonality", () => {
    const v = presetVertices("L-shape"),
      moved = setEdgeLength(v, 2, 3251);
    expect(edgeLength(moved, 2)).toBe(3251);
    expect(moved[2]).toEqual(v[2]);
    expect(validatePolygon(moved)).toBeNull();
  });
  it("rejects crossed, touching, diagonal, redundant, short and zero-area polygons", () => {
    const crossed = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 6000 },
      { x: 2000, y: 6000 },
      { x: 2000, y: -2000 },
      { x: 4000, y: -2000 },
      { x: 4000, y: 4000 },
      { x: 0, y: 4000 },
    ];
    expect(validatePolygon(crossed)).toMatch(/self-intersect/);
    expect(
      validatePolygon([
        { x: 0, y: 0 },
        { x: 1000, y: 1 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ]),
    ).toMatch(/horizontal/);
    expect(
      validatePolygon([
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).not.toBeNull();
    expect(
      validatePolygon([
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 99 },
        { x: 0, y: 99 },
      ]),
    ).toMatch(/0.1 m/);
    expect(
      validatePolygon([
        { x: 0.1, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ]),
    ).toMatch(/whole millimetres/);
  });
  it("rejects walls that collapse a narrow neck even with large outer extents", () => {
    const s = applyPreset({ ...section, wallThickness: 2100 }, "U-shape");
    expect(validateFootprint(s)).toMatch(/collapses|intersects/);
    expect(() => insetPolygon(presetVertices("Rectangle"), 5000)).toThrow(
      /collapses|intersects/,
    );
  });
  it("keeps exact coordinates independent of grid selection, movement and rotation", () => {
    const s = withVertices(
        section,
        setEdgeLength(presetVertices("L-shape"), 2, 3251),
      ),
      original = JSON.stringify(s.vertices);
    for (const grid of [250, 500, 1000, 2000, null]) {
      const moved = {
        ...s,
        ...moveRectangle(s, { x: 1271, y: -732 }, grid),
        orientation: 37,
      };
      expect(JSON.stringify(moved.vertices)).toBe(original);
      expect(areas(moved)).toEqual(areas(s));
      const first = corners(moved)[0],
        expected = rotate(s.vertices[0], 37);
      expect(first.x).toBeCloseTo(expected.x + moved.position.x);
    }
    const scaled = scaleFootprint(s, "length", 14001);
    expect(scaled.length).toBe(14001);
    expect(validateFootprint(scaled)).toBeNull();
  });
  it("fits actual rotated polygon vertices and pinch never mutates geometry", () => {
    const s = { ...applyPreset(section, "Cross"), orientation: 43 },
      original = JSON.stringify(s);
    const view = { width: 390, height: 440 },
      camera = fitCamera(s, view);
    for (const p of corners(s)) {
      const q = worldToScreen(p, camera, view);
      expect(q.x).toBeGreaterThan(0);
      expect(q.x).toBeLessThan(view.width);
      expect(q.y).toBeGreaterThan(0);
      expect(q.y).toBeLessThan(view.height);
    }
    pinchCamera(camera, { x: 100, y: 200 }, { x: 150, y: 250 }, 2, view);
    expect(JSON.stringify(s)).toBe(original);
  });
  it("undoes and redoes preset, edge, movement and rotation transactions", () => {
    let h = initialHistory(section);
    const l = applyPreset(section, "L-shape");
    h = commit(h, l);
    const edge = withVertices(l, dragEdge(footprintVertices(l), 2, 500));
    h = commit(h, edge);
    const moved = {
      ...edge,
      ...moveRectangle(edge, { x: 1000, y: 500 }, null),
      orientation: 90,
    };
    h = commit(h, moved);
    expect(undo(h).present).toEqual(edge);
    expect(undo(undo(h)).present).toEqual(l);
    expect(redo(undo(h)).present).toEqual(moved);
  });
});
it("rejects negative exact lengths and scaling instead of reflecting the footprint", () => {
  const s = applyPreset(createProject().building.sections[0], "L-shape");
  expect(() => setEdgeLength(footprintVertices(s), 2, -1000)).toThrow(
    /at least/,
  );
  expect(() => scaleFootprint(s, "length", -12000)).toThrow(/between/);
  expect(() => scaleFootprint(s, "width", 499)).toThrow(/between/);
});
describe("schema v3 and lossless BG-01 migration", () => {
  const legacy = () => {
    const p = createProject("Preserved BG-01 hall");
    Object.assign(p.building.sections[0], {
      length: 13247,
      width: 8751,
      wallThickness: 251,
      orientation: 37.5,
      floorCount: 4,
      position: { x: -1251, y: 2837, z: 950 },
    });
    return { ...p, schemaVersion: 1, architecture: "Mixed" };
  };
  it("migrates v1 records and JSON, preserving original fields and adding assembly metadata", () => {
    const old = legacy(),
      before = structuredClone(old),
      migrated = validateProject(old);
    expect(migrated).toEqual({
      ...old,
      schemaVersion: 8,
      building: {
        ...old.building,
        sections: old.building.sections.map((s) => ({
          ...s,
          exterior: exteriorDefaults("Mixed"),
        })),
        frame: {
          origin: {
            x: old.building.sections[0].position.x,
            y: old.building.sections[0].position.y,
          },
          axis: old.building.sections[0].orientation,
          rotation: 0,
          mode: "legacy",
        },
      },
    });
    expect(old).toEqual(before);
    expect(parseProject(JSON.stringify(old))).toEqual(migrated);
    expect(serializeProject(migrated)).toContain('"schemaVersion": 8');
  });
  it.each(SHAPES)(
    "roundtrips %s polygons, metadata, extents and stable IDs",
    (shape) => {
      const p = createProject();
      p.building.sections = [applyPreset(p.building.sections[0], shape)];
      expect(parseProject(serializeProject(p))).toEqual(p);
    },
  );
  it("duplicates polygon vertices independently and preserves geometric metadata", () => {
    const p = createProject();
    p.building.sections = [applyPreset(p.building.sections[0], "Cross")];
    const copy = duplicateProject(p),
      a = p.building.sections[0],
      b = copy.building.sections[0];
    expect(b).toEqual({ ...a, id: b.id });
    expect(b.id).not.toBe(a.id);
    if (a.kind === "polygon" && b.kind === "polygon") {
      b.vertices[0].x += 100;
      expect(b.vertices[0]).not.toEqual(a.vertices[0]);
    }
  });
  it("rejects invalid v1/v2 and unsupported versions without replacing data", () => {
    const old = legacy();
    expect(() => validateProject({ ...old, schemaVersion: 999 })).toThrow(
      /Unsupported/,
    );
    const invalid = structuredClone(old);
    invalid.building.sections[0].length = 0;
    expect(() => validateProject(invalid)).toThrow();
    const p = createProject();
    const s = applyPreset(p.building.sections[0], "L-shape");
    p.building.sections = [s];
    expect(() => validateProject({ ...p, schemaVersion: 1 })).toThrow();
    if (s.kind === "polygon") s.vertices[2].y = 0;
    expect(() => validateProject(p)).toThrow();
    const extents = { ...s, length: 1000 };
    expect(bounds(footprintVertices(extents)).length).not.toBe(1000);
    expect(() =>
      validateProject({
        ...p,
        building: { ...p.building, sections: [extents] },
      }),
    ).toThrow();
    expect(legacy()).not.toBeNull();
  });
});

it("rejects mismatching polygon extents and malformed vertices on import", () => {
  const p = createProject();
  p.building.sections = [applyPreset(p.building.sections[0], "L-shape")];
  const s = p.building.sections[0];
  expect(() =>
    validateProject({
      ...p,
      building: { ...p.building, sections: [{ ...s, length: 11000 }] },
    }),
  ).toThrow(/extents/);
  expect(() =>
    validateProject({
      ...p,
      building: { ...p.building, sections: [{ ...s, vertices: [null] }] },
    }),
  ).toThrow(/vertex/);
});
