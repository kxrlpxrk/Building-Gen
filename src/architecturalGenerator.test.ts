import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  generateArchitecturalBuildings,
  defaultArchitecturalConfig,
  purposeDefaults,
  createArchitecturalProject,
  architecturalConfigError,
} from "./architecturalGenerator";
import { PURPOSES } from "./buildingGenerator";
import { STYLE_PRESETS, ROOF_STYLES } from "./exteriorSettings";
import {
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import { buildExterior } from "./exteriorGeometry";
import { saveProject, loadProject } from "./storage";
import { generateLayouts, starterConfig } from "./layoutGenerator";
const config = defaultArchitecturalConfig;
describe("BG-05 complete architectural generation", () => {
  it.each(PURPOSES)(
    "creates complete valid %s architecture",
    (purpose) => {
      const result = generateArchitecturalBuildings(purposeDefaults(purpose));
      expect(
        result.proposals.length,
        result.messages.join(" "),
      ).toBeGreaterThan(0);
      for (const p of result.proposals) {
        const b = p.project.building;
        expect(validateProject(p.project)).toEqual(p.project);
        expect(b.openings.some((o) => o.type === "exterior-door")).toBe(true);
        expect(b.interior).toEqual({ partitions: [], rooms: [] });
        expect(b.sections.every((s) => s.exterior.ridgeAxis !== "Auto")).toBe(
          true,
        );
        expect(
          b.sections.flatMap((s) => s.exterior.windows).length,
        ).toBeGreaterThan(0);
        const mesh = buildExterior(b);
        expect(mesh.roofFacets.length).toBeGreaterThan(0);
        for (const s of mesh.sections)
          for (const values of Object.values(s.parts))
            expect(values.every(Number.isFinite)).toBe(true);
      }
    },
    20000,
  );
  it.each(STYLE_PRESETS)("coordinates %s defaults", (style) => {
    const p = generateArchitecturalBuildings({
      ...config(),
      style,
      extensions: 0,
    }).proposals[0];
    expect(p).toBeDefined();
    expect(p.project.building.sections[0].exterior.stylePreset).toBe(style);
  });
  it("reproduces complete data and produces distinct silhouette variations", () => {
    const c = { ...config(), complexity: "Organic" as const };
    const a = generateArchitecturalBuildings(c),
      b = generateArchitecturalBuildings(c);
    expect(a).toEqual(b);
    expect(a.proposals).toHaveLength(3);
    const silhouettes = a.proposals.map((p) =>
      JSON.stringify(
        p.project.building.sections.map((s) => [
          s.length,
          s.width,
          s.position,
          s.exterior.wallHeight,
          s.exterior.roofStyle,
        ]),
      ),
    );
    expect(new Set(silhouettes).size).toBe(3);
    expect(
      generateArchitecturalBuildings({ ...c, seed: "different" }).proposals[0]
        .project.building,
    ).not.toEqual(a.proposals[0].project.building);
  });
  it("canonicalizes configuration order and unordered roof preferences", () => {
    const c = { ...config(), extensions: 0 };
    const reordered = Object.fromEntries(
      Object.entries(c).reverse(),
    ) as typeof c;
    reordered.roofs = [...c.roofs].reverse();
    expect(generateArchitecturalBuildings(reordered)).toEqual(
      generateArchitecturalBuildings(c),
    );
  });
  it("complexity influences connected composition and None suppresses windows", () => {
    const buildings = ["Simple", "Organic", "Grand"].map(
      (complexity) =>
        generateArchitecturalBuildings({
          ...config(),
          complexity: complexity as "Simple",
          extensions: 2,
          windows: "None",
        }).proposals[0].project.building,
    );
    expect(
      new Set(
        buildings.map((b) =>
          JSON.stringify(
            b.sections.map((s) => [s.length, s.width, s.position]),
          ),
        ),
      ).size,
    ).toBe(3);
    expect(
      buildings.every((b) =>
        b.sections.every((s) => !s.exterior.windows.length),
      ),
    ).toBe(true);
  });
  it("validates or explicitly omits requested features", () => {
    const p = generateArchitecturalBuildings({
      ...config(),
      chimneys: true,
      ornaments: true,
      canopies: true,
      roofs: ["Hip"],
      extensions: 0,
    }).proposals[0];
    expect(validateProject(p.project)).toEqual(p.project);
    expect(
      p.warnings.some((w) => w.startsWith("Gable ornament omitted:")),
    ).toBe(true);
  });
  it("keeps preview independent and rekeys all architecture on acceptance/duplication", async () => {
    const p = generateArchitecturalBuildings({
        ...config(),
        extensions: 0,
        chimneys: true,
      }).proposals[0],
      before = serializeProject(p.project);
    const accepted = createArchitecturalProject(p, "Accepted hall");
    expect(serializeProject(p.project)).toBe(before);
    expect(accepted.id).not.toBe(p.project.id);
    expect(accepted.building.sections[0].exterior.windows[0].id).not.toBe(
      p.project.building.sections[0].exterior.windows[0].id,
    );
    const copy = validateProject(duplicateProject(accepted));
    expect(copy.building.openings[0].host).not.toEqual(
      accepted.building.openings[0].host,
    );
    expect(parseProject(serializeProject(accepted))).toEqual(accepted);
    await saveProject(accepted);
    await saveProject(copy);
    expect(await loadProject(accepted.id)).toEqual(accepted);
    expect(await loadProject(copy.id)).toEqual(copy);
  });
  it("permits later BG-04A room generation on a supported generated rectangle", () => {
    const p = generateArchitecturalBuildings({
      ...purposeDefaults("Cottage"),
      extensions: 0,
    }).proposals[0];
    const result = generateLayouts(p.project, starterConfig());
    expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(
      0,
    );
  }, 20000);
  it.each(ROOF_STYLES)(
    "validates an all-%s supported composition without missing roof skin",
    (roof) => {
      const result = generateArchitecturalBuildings({
        ...config(),
        roofs: [roof],
        chimneys: false,
        ornaments: false,
        canopies: false,
        extensions: 3,
        detail: "High",
      });
      expect(
        result.proposals.length,
        result.messages.join(" "),
      ).toBeGreaterThan(0);
      for (const p of result.proposals) {
        expect(
          p.project.building.sections.every(
            (s) => s.exterior.roofStyle === roof,
          ),
        ).toBe(true);
        const m = buildExterior(p.project.building);
        let top = 0,
          bottom = 0;
        for (const section of m.sections)
          for (let i = 0; i < section.parts.roof.length; i += 9) {
            const a = section.parts.roof;
            const area =
              ((a[i + 3] - a[i]) * (a[i + 7] - a[i + 1]) -
                (a[i + 4] - a[i + 1]) * (a[i + 6] - a[i])) /
              2;
            if (area > 0) top += area;
            else bottom -= area;
          }
        expect(top).toBeCloseTo(m.roofArea, 2);
        expect(bottom).toBeCloseTo(m.roofArea, 2);
      }
    },
    20000,
  );
  it("fails impossible dimensions and malformed configuration without fallback data", () => {
    expect(() =>
      generateArchitecturalBuildings({
        ...config(),
        scale: "Custom",
        length: 1,
      }),
    ).toThrow("4–60");
    expect(architecturalConfigError({ ...config(), roofs: [] })).toContain(
      "at least one",
    );
  });
});
