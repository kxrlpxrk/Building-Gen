import { describe, it, expect } from "vitest";
import {
  defaultBuildingConfig,
  generateBuildings,
  createGeneratedProject,
  BUILDING_TRIAL_LIMIT,
  BUILDING_ATTEMPT_LIMIT,
  type BuildingConfig,
  PURPOSES,
} from "./buildingGenerator";
import {
  combinedGeometry,
  canonicalVertices,
  prepareBuilding,
  replaceSection,
  translateBuilding,
} from "./assembly";
import { polygonArea, SHAPES } from "./polygon";
import { footprintVertices } from "./geometry";
import {
  createProject,
  validateProject,
  parseProject,
  serializeProject,
  duplicateProject,
} from "./model";
import { generateLayouts, starterConfig } from "./layoutGenerator";
import { saveProject, loadProject } from "./storage";
import "fake-indexeddb/auto";
function config(patch: Partial<BuildingConfig> = {}): BuildingConfig {
  return { ...defaultBuildingConfig(), ...patch };
}
function generated(patch: Partial<BuildingConfig> = {}) {
  const c = config(patch),
    result = generateBuildings(c);
  expect(result.trials).toBeLessThanOrEqual(BUILDING_TRIAL_LIMIT);
  expect(result.attempts).toBeLessThanOrEqual(BUILDING_ATTEMPT_LIMIT);
  expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(0);
  for (const p of result.proposals) {
    expect(validateProject(p.project)).toEqual(p.project);
    expect(p.project.building.sections).toHaveLength(c.extensions + 1);
    expect(p.project.building.interior).toEqual({ partitions: [], rooms: [] });
    expect(p.project.building.openings).toEqual([]);
    const b = p.project.building,
      g = combinedGeometry(b);
    expect(p.exteriorArea).toBe(polygonArea(g.vertices));
    expect(p.interiorArea).toBe(polygonArea(g.inner));
    expect(p.exteriorArea).toBe(
      b.sections.reduce((n, s) => n + polygonArea(footprintVertices(s)), 0),
    );
    expect(g.contacts.length).toBeGreaterThanOrEqual(c.extensions);
    expect(b.sections[0].length).toBe(c.length);
    expect(b.sections[0].width).toBe(c.width);
    expect(
      b.sections.every(
        (s) =>
          !s.locked &&
          [
            s.length,
            s.width,
            s.position.x,
            s.position.y,
            s.wallThickness,
          ].every(Number.isSafeInteger),
      ),
    ).toBe(true);
  }
  return result;
}
describe("deterministic building composition", () => {
  it("generates a simple elongated Norse longhouse and honestly reports fixed-outline zero-extension variety", () => {
    const result = generated({ extensions: 0 });
    expect(result.proposals).toHaveLength(1);
    expect(result.messages.join(" ")).toContain("only one geometry");
    expect(result.proposals[0].exteriorArea).toBe(144e6);
    expect(result.proposals[0].interiorArea).toBe(133.76e6);
  });
  it.each(PURPOSES)(
    "generates purpose-specific connected %s compositions",
    (purpose) => {
      const r = generated({
        purpose,
        complexity: "Organic",
        extensions: purpose === "Manor" ? 4 : 1,
      });
      const p = r.proposals[0];
      expect(p.project.building.sections[0].name.toLowerCase()).toContain(
        purpose === "Tavern/Inn"
          ? "tavern"
          : purpose === "Trading Hall"
            ? "trading"
            : purpose.toLowerCase(),
      );
      if (purpose === "Workshop")
        expect(p.project.building.sections[1].type).toBe("Storage");
      if (purpose === "Farmhouse")
        expect(p.project.building.sections[1].type).toBe("Residential Wing");
    },
  );
  it.each(SHAPES)(
    "supports an exact %s main outline without decorative rectangles",
    (outline) => {
      const r = generated({
        purpose: "Manor",
        outline,
        length: 18000,
        width: 12000,
        extensions: 0,
      });
      const s = r.proposals[0].project.building.sections[0];
      expect(s.kind).toBe(outline === "Rectangle" ? "rectangle" : "polygon");
      if (outline !== "Rectangle")
        expect(r.proposals[0].exteriorArea).toBeLessThan(s.length * s.width);
    },
  );
  it.each(SHAPES)(
    "attaches a valid wing to the %s starting outline",
    (outline) => {
      generated({
        purpose: "Manor",
        outline,
        length: 18000,
        width: 12000,
        extensions: 1,
      });
    },
  );
  it("supports five wings and a connected T-style rectangle composition", () => {
    generated({
      purpose: "Manor",
      complexity: "Grand",
      length: 24000,
      width: 16000,
      extensions: 5,
    });
    const t = generated({
      purpose: "Farmhouse",
      complexity: "Simple",
      outline: "Rectangle",
      extensions: 1,
    }).proposals[0];
    expect(combinedGeometry(t.project.building).vertices.length).toBe(8);
  });
  it("repeats complete proposals exactly and offers meaningfully different geometry", () => {
    const c = config({
      purpose: "Farmhouse",
      extensions: 2,
      complexity: "Organic",
    });
    const a = generateBuildings(c),
      b = generateBuildings(c);
    expect(a).toEqual(b);
    expect(a.proposals).toHaveLength(3);
    const outline = (p: (typeof a.proposals)[number]) =>
      combinedGeometry(p.project.building).vertices;
    expect(
      new Set(a.proposals.map((p) => JSON.stringify(outline(p)))).size,
    ).toBe(3);
    const other = generateBuildings({ ...c, seed: "another-seed" });
    expect(outline(other.proposals[0])).not.toEqual(outline(a.proposals[0]));
  });
  it("complexity and purpose affect sizes, outline and arrangements, rather than labels alone", () => {
    const simple = generated({
      purpose: "Farmhouse",
      complexity: "Simple",
      extensions: 2,
    }).proposals[0];
    const organic = generated({
      purpose: "Farmhouse",
      complexity: "Organic",
      extensions: 2,
    }).proposals[0];
    const grand = generated({
      purpose: "Manor",
      complexity: "Grand",
      extensions: 2,
    }).proposals[0];
    const outline = (p: typeof simple) =>
      combinedGeometry(p.project.building).vertices;
    expect(outline(simple)).not.toEqual(outline(organic));
    expect(outline(simple)).not.toEqual(outline(grand));
    expect(outline(organic).length).toBeGreaterThan(4);
  });
  it("can use a preferred square tower footprint instead of just renaming a wing", () => {
    const r = generated({
      purpose: "Manor",
      architecture: "Medieval",
      extensions: 1,
      preferredTypes: ["Tower Footprint"],
    });
    const towers = r.proposals
      .flatMap((p) => p.project.building.sections.slice(1))
      .filter((s) => s.type === "Tower Footprint");
    expect(towers.length).toBeGreaterThan(0);
    expect(towers.every((s) => s.length === s.width)).toBe(true);
  });
  it("preferences are reported honestly without changing mandatory section count", () => {
    const r = generated({
      purpose: "Farmhouse",
      extensions: 2,
      preferredTypes: ["Tower Footprint", "Workshop", "Porch"],
    });
    for (const p of r.proposals)
      for (const t of ["Tower Footprint", "Workshop", "Porch"])
        expect(
          p.project.building.sections.slice(1).some((s) => s.type === t) ||
            p.warnings.some((w) => w.includes(t)),
        ).toBe(true);
  });
  it("refuses incompatible and impossible requirements without changing configuration or source", () => {
    const source = createProject(),
      before = structuredClone(source),
      c = config({ length: 5000, width: 8000 });
    expect(() => generateBuildings(c)).toThrow(/longhouse requires/);
    expect(() => generateBuildings(config({ extensions: 6 }))).toThrow(/0–5/);
    expect(() => generateBuildings(config({ length: 18000.1 }))).toThrow(
      /whole millimetres/,
    );
    const impossible = config({
      purpose: "Cottage",
      length: 4000,
      width: 4000,
      outline: "Cross",
      extensions: 3,
    });
    const r = generateBuildings(impossible);
    expect(r.proposals).toEqual([]);
    expect(r.messages.join(" ")).toContain("original project is unchanged");
    expect(source).toEqual(before);
    expect(c.length).toBe(5000);
  });
  it("allows existing manual editing, validates locked geometry and preserves whole-building transforms", () => {
    const b = generated({ purpose: "Farmhouse" }).proposals[0].project.building;
    const moved = translateBuilding(b, { x: 2000, y: 3000 });
    expect(combinedGeometry(moved).exterior).toBe(combinedGeometry(b).exterior);
    const rotated = prepareBuilding(
      { ...b, frame: { ...b.frame, rotation: 47 } },
      b,
    );
    expect(rotated.connections).toEqual(b.connections);
    expect(canonicalVertices(rotated.sections[1], rotated)).toEqual(
      canonicalVertices(b.sections[1], b),
    );
    const locked = prepareBuilding(
      { ...b, sections: b.sections.map((s) => ({ ...s, locked: true })) },
      b,
    );
    expect(() =>
      replaceSection(locked, {
        ...locked.sections[1],
        length: locked.sections[1].length + 1000,
      }),
    ).toThrow(/locked/);
    const editable = replaceSection(b, {
      ...b.sections[1],
      name: "My editable wing",
    });
    expect(editable.sections[1].name).toBe("My editable wing");
    const detached = {
      ...b.sections[1],
      position: { ...b.sections[1].position, x: 100000 },
    };
    expect(() => replaceSection(b, detached)).toThrow();
  });
  it("creates unique independent schema-v5 projects that save/reopen, import/export and duplicate", async () => {
    const proposal = generated({ purpose: "Workshop" }).proposals[0],
      before = structuredClone(proposal);
    const p = createGeneratedProject(proposal, "New workshop"),
      other = createGeneratedProject(proposal, "Another workshop");
    const ids = (p: typeof proposal.project) => [
      p.id,
      p.building.id,
      ...p.building.sections.map((s) => s.id),
      ...p.building.connections.map((j) => j.id),
    ];
    expect(
      ids(p).every(
        (id) => !ids(other).includes(id) && !ids(proposal.project).includes(id),
      ),
    ).toBe(true);
    expect(parseProject(serializeProject(p))).toEqual(p);
    const copy = duplicateProject(p);
    expect(validateProject(copy)).toEqual(copy);
    await saveProject(p);
    await saveProject(other);
    expect(await loadProject(p.id)).toEqual(p);
    expect(await loadProject(other.id)).toEqual(other);
    p.building.sections[0].name = "Independent";
    expect(proposal).toEqual(before);
    const invalid = structuredClone(proposal);
    invalid.project.building.sections[1].position.x += 100000;
    expect(() => createGeneratedProject(invalid, "Invalid")).toThrow();
  });
  it("remains compatible with BG-04A on a supported generated rectangle", () => {
    const p = generated({
      length: 12000,
      width: 8000,
      purpose: "Cottage",
      extensions: 0,
    }).proposals[0].project;
    const r = generateLayouts(p, starterConfig());
    expect(r.proposals.length).toBeGreaterThan(0);
  });
});
