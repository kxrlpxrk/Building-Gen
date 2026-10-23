import { describe, it, expect } from "vitest";
import {
  createProject,
  validateProject,
  duplicateProject,
  serializeProject,
  parseProject,
} from "./model";
import { attachmentPreview, removeSection } from "./attachments";
import {
  combinedGeometry,
  displaySection,
  replaceSection,
  prepareBuilding,
} from "./assembly";
import { orthogonalUnion } from "./orthogonalUnion";
import { polygonArea, presetVertices } from "./polygon";
import { applyPreset } from "./footprint";
const config = (edge = 0, offset = 0) => ({
  id: crypto.randomUUID(),
  name: "Side wing",
  type: "Residential Wing" as const,
  length: 6000,
  width: 4000,
  shape: "Rectangle" as const,
  edge,
  offset,
});
const attached = () => {
  const b = createProject().building;
  const p = attachmentPreview(b, config());
  if (p.error) throw new Error(p.error);
  return p.building!;
};
describe("deterministic orthogonal section union", () => {
  it("adds a 6 × 4 m wing to 12 × 8 m without a doubled join wall", () => {
    const b = attached(),
      g = combinedGeometry(b);
    expect(g.exterior).toBe(120);
    expect(g.interior).toBe(110.56);
    expect(b.connections).toHaveLength(1);
    expect(b.connections[0].mode).toBe("open-plan");
    expect(polygonArea(g.vertices)).toBe(120e6);
    // Shared edge is absent from the merged outer ring; union area equals sum.
    expect(g.vertices).toHaveLength(6);
    expect(
      g.vertices.some(
        (p, i) =>
          p.y === 0 &&
          g.vertices[(i + 1) % g.vertices.length].y === 0 &&
          p.x === 0 &&
          g.vertices[(i + 1) % g.vertices.length].x === 6000,
      ),
    ).toBe(false);
  });
  it("accepts partial edge sharing and multiple connected extensions", () => {
    const b = attached();
    const next = attachmentPreview(b, config(0, -1000));
    expect(next.error).toBeNull();
    expect(combinedGeometry(next.building!).exterior).toBe(144);
    const partial = attachmentPreview(
      createProject().building,
      config(0, -2000),
    );
    expect(partial.error).toBeNull();
    expect(combinedGeometry(partial.building!).exterior).toBe(120);
  });
  it("rejects overlap, holes, corner contact, tiny joins and detached shapes", () => {
    const r = presetVertices("Rectangle", 6000, 4000),
      translate = (x: number, y: number) =>
        r.map((p) => ({ x: p.x + x, y: p.y + y }));
    expect(() => orthogonalUnion([r, translate(1000, 0)])).toThrow(/overlap/);
    expect(() => orthogonalUnion([r, translate(6000, 4000)])).toThrow(
      /Corner|touch/,
    );
    expect(() => orthogonalUnion([r, translate(7000, 0)])).toThrow(/connected/);
    const rect = (x: number, y: number, l: number, w: number) =>
      presetVertices("Rectangle", l, w).map((p) => ({
        x: p.x + x,
        y: p.y + y,
      }));
    expect(() =>
      orthogonalUnion([
        rect(0, 0, 12000, 2000),
        rect(0, 10000, 12000, 2000),
        rect(0, 2000, 2000, 8000),
        rect(10000, 2000, 2000, 8000),
      ]),
    ).toThrow(/holes/);
    expect(
      attachmentPreview(createProject().building, config(0, 12000)).error,
    ).not.toBeNull();
    expect(
      attachmentPreview(createProject().building, config(0, 11950)).error,
    ).not.toBeNull();
  });
  it("supports concave union outlines and both input windings deterministically", () => {
    const a = presetVertices("Rectangle", 12000, 8000),
      b = presetVertices("Rectangle", 6000, 4000).map((p) => ({
        x: p.x,
        y: p.y - 4000,
      }));
    expect(orthogonalUnion([a, b])).toEqual(
      orthogonalUnion([b.reverse(), a.reverse()]),
    );
  });
  it("rejects merged invalid wall interiors and incompatible orientations", () => {
    const b = attached();
    expect(() =>
      replaceSection(b, { ...b.sections[1], orientation: 45 }),
    ).toThrow(/compatible/);
    expect(() =>
      replaceSection(b, { ...b.sections[1], wallThickness: 300 }),
    ).toThrow(/common/);
    const first = createProject().building;
    first.sections[0].wallThickness = 1500;
    const narrow = attachmentPreview(first, {
      ...config(),
      length: 4000,
      width: 4000,
      offset: 11900,
    });
    expect(narrow.error).not.toBeNull();
  });
  it("preserves connections on valid slide/resize and rejects disconnection", () => {
    const b = attached(),
      s = b.sections[1];
    const moved = replaceSection(b, {
      ...s,
      position: { ...s.position, x: s.position.x + 1000 },
    });
    expect(combinedGeometry(moved).exterior).toBe(120);
    expect(moved.connections[0].id).toBe(b.connections[0].id);
    expect(() =>
      replaceSection(b, {
        ...s,
        position: { ...s.position, y: s.position.y - 1000 },
      }),
    ).toThrow();
    expect(() => replaceSection(b, { ...s, length: 5000 })).not.toThrow();
  });
  it("does not change locked section data and prevents locked edits/removal", () => {
    const b = attached();
    b.sections[0].locked = true;
    const before = structuredClone(b.sections[0]);
    const next = replaceSection(b, { ...b.sections[1], length: 5000 });
    expect(next.sections[0]).toEqual(before);
    expect(() =>
      replaceSection(b, { ...b.sections[0], length: 13000 }),
    ).toThrow(/locked/);
    b.sections[1].locked = true;
    expect(() => removeSection(b, b.sections[1].id)).toThrow(/locked/);
  });
  it("rotates whole assemblies without rounding or changing relative geometry", () => {
    const b = attached(),
      before = JSON.stringify(b.sections),
      joins = JSON.stringify(b.connections),
      g = combinedGeometry(b);
    const rotated = { ...b, frame: { ...b.frame, rotation: 37.5 } };
    expect(combinedGeometry(rotated).vertices).toEqual(g.vertices);
    expect(JSON.stringify(rotated.sections)).toBe(before);
    expect(JSON.stringify(rotated.connections)).toBe(joins);
    expect(displaySection(rotated.sections[0], rotated).orientation).toBe(37.5);
  });
  it("duplicates all section and connection identities independently and roundtrips schema v3", () => {
    const p = createProject();
    p.building = attached();
    const copy = duplicateProject(p);
    expect(copy.building.sections).toHaveLength(2);
    expect(copy.building.connections[0].a.sectionId).toBe(
      copy.building.sections[0].id,
    );
    expect(copy.building.connections[0].id).not.toBe(
      p.building.connections[0].id,
    );
    expect(parseProject(serializeProject(p))).toEqual(p);
    copy.building.sections[1].position.x += 1000;
    expect(copy.building.sections[1].position).not.toEqual(
      p.building.sections[1].position,
    );
  });
  it("rejects stale attachments and limits assemblies to 12 sections", () => {
    const p = createProject();
    p.building = attached();
    const bad = structuredClone(p);
    bad.building.connections[0].start.x += 1;
    expect(() => validateProject(bad)).toThrow(/Attachment/);
    const b = attached();
    expect(() =>
      prepareBuilding({
        ...b,
        sections: Array.from({ length: 13 }, () => b.sections[0]),
      }),
    ).toThrow(/1–12/);
  });
  it("retains a polygon main and supports attachments after arbitrary legacy rotation", () => {
    const p = createProject();
    p.building.sections[0] = applyPreset(p.building.sections[0], "L-shape");
    p.building.sections[0].orientation = 37.5;
    p.building.sections[0].position = { x: -1251, y: 2837, z: 950 };
    const next = attachmentPreview(p.building, config());
    expect(next.error).toBeNull();
    expect(next.building!.sections[0]).toEqual(p.building.sections[0]);
    expect(combinedGeometry(next.building!).exterior).toBe(108);
  });
});

import { EXTENSION_TEMPLATES } from "./attachments";
import { commit, initialHistory, undo, redo } from "./history";
import legacyV1 from "../tests/fixtures/bg01-project.json";
import legacyV2 from "../tests/fixtures/bg02a-project.json";
import { corners } from "./geometry";
it.each(EXTENSION_TEMPLATES)(
  "attaches the $name template as configurable geometry",
  (t) => {
    const b = createProject().building,
      p = attachmentPreview(b, {
        ...config(),
        name: t.name,
        type: t.type,
        length: t.length,
        width: t.width,
        shape: t.shape,
      });
    expect(p.error).toBeNull();
    expect(p.building!.sections[1].type).toBe(t.type);
  },
);
it.each([legacyV1, legacyV2])(
  "migrates schema $schemaVersion without altering legacy geometry or metadata",
  (legacy) => {
    const before = structuredClone(legacy),
      p = validateProject(legacy);
    expect(p.schemaVersion).toBe(7);
    expect(p).toMatchObject({ ...legacy, schemaVersion: 7 });
    expect(legacy).toEqual(before);
    expect(p.building.mainSectionId).toBe(legacy.building.sections[0].id);
    expect(p.building.connections).toEqual([]);
    const old = legacy.building.sections[0],
      beforeCorners = corners(old),
      after = corners(displaySection(p.building.sections[0], p.building));
    expect(after).toEqual(beforeCorners);
    expect(p.id).toBe(legacy.id);
    expect(p.architecture).toBe(legacy.architecture);
    expect(p.createdAt).toBe(legacy.createdAt);
    expect(p.updatedAt).toBe(legacy.updatedAt);
  },
);
it("undoes/redoes additions, removals, dimension and lock changes as transactions", () => {
  const p = createProject(),
    b = attached();
  let h = initialHistory(p.building);
  h = commit(h, b);
  const resized = replaceSection(b, { ...b.sections[1], length: 5000 });
  h = commit(h, resized);
  h = commit(h, removeSection(resized, resized.sections[1].id));
  expect(undo(h).present).toEqual(resized);
  expect(undo(undo(h)).present).toEqual(b);
  expect(redo(undo(h)).present.sections).toHaveLength(1);
});
it("rejects removing an intermediate connector that strands another wing", () => {
  const b = attached();
  const p = attachmentPreview(b, config(0));
  expect(p.error).toBeNull();
  expect(() => removeSection(p.building!, b.sections[1].id)).toThrow(
    /connected|contact/,
  );
});
it("can clone a reversed or vertically-starting polygon onto an external edge", () => {
  const b = createProject().building,
    s = applyPreset(b.sections[0], "L-shape");
  if (s.kind !== "polygon") throw new Error("fixture");
  for (const vertices of [
    [...s.vertices].reverse(),
    [...s.vertices.slice(1), s.vertices[0]],
  ]) {
    const source = { ...s, vertices };
    const p = attachmentPreview(b, config(), source);
    expect(p.error).toBeNull();
    expect(combinedGeometry(p.building!).exterior).toBe(180);
  }
});
it("retains exact integer assembly geometry under fractional-angle rotations", () => {
  const p = createProject();
  p.building.sections[0].orientation = 37.1234567;
  const a = attachmentPreview(p.building, config());
  expect(a.error).toBeNull();
  const b = a.building!;
  for (const s of b.sections) expect(displaySection(s, b)).toBeTruthy();
  expect(combinedGeometry(b).exterior).toBe(120);
});
it("removing the last extension preserves a moved, locked and rotated main in world space", () => {
  let b = attached();
  b = replaceSection(b, {
    ...b.sections[0],
    position: { ...b.sections[0].position, x: 1000 },
  });
  b = {
    ...b,
    frame: { ...b.frame, rotation: 37.5 },
    sections: b.sections.map((s, i) => (i === 0 ? { ...s, locked: true } : s)),
  };
  const before = corners(displaySection(b.sections[0], b)),
    remaining = removeSection(b, b.sections[1].id);
  expect(remaining.frame).toEqual(b.frame);
  expect(remaining.sections[0]).toEqual(b.sections[0]);
  expect(corners(displaySection(remaining.sections[0], remaining))).toEqual(
    before,
  );
  expect(combinedGeometry(remaining).exterior).toBe(96);
});
it("accepts twelve connected sections and refuses the thirteenth", () => {
  let b = createProject().building;
  for (let i = 1; i < 12; i++) {
    const p = attachmentPreview(b, config());
    expect(p.error).toBeNull();
    b = p.building!;
  }
  expect(b.sections).toHaveLength(12);
  expect(b.connections).toHaveLength(11);
  expect(attachmentPreview(b, config()).error).toMatch(/12/);
});
