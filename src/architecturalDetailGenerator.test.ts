import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  defaultArchitecturalConfig,
  purposeDefaults,
  generateArchitecturalBuildings,
  createArchitecturalProject,
  architecturalConfigError,
} from "./architecturalGenerator";
import {
  CROSS_GABLE_COMPLEXITIES,
  generateArchitecturalDetails,
} from "./architecturalDetailGenerator";
import { generateLayouts, starterConfig } from "./layoutGenerator";
import {
  ORNAMENT_LEVELS,
  resolveOrnament,
  ornamentRoofSurface,
} from "./ornamentation";
import {
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import { buildExterior } from "./exteriorGeometry";
import { saveProject, loadProject } from "./storage";
import { replaceSection } from "./assembly";
import { advancedExamples } from "../tests/fixtures/advancedArchitecture";
import { STYLE_PRESETS } from "./exteriorSettings";
const config = () => ({
  ...defaultArchitecturalConfig(),
  extensions: 0,
  roofs: ["Gable" as const],
  ornaments: false,
  chimneys: false,
});
function check(result: ReturnType<typeof generateArchitecturalBuildings>) {
  expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(0);
  for (const p of result.proposals) {
    expect(validateProject(p.project)).toEqual(p.project);
    const b = p.project.building,
      mesh = buildExterior(b);
    expect(b.openings.some((o) => o.type === "exterior-door")).toBe(true);
    expect(b.interior).toEqual({ partitions: [], rooms: [] });
    const roofAt = ornamentRoofSurface(b);
    for (const s of b.sections) {
      expect(s.exterior.ornamentation.items.length).toBeLessThanOrEqual(12);
      for (const o of s.exterior.ornamentation.items)
        expect(resolveOrnament(b, s, o, roofAt).origin.z).toBeGreaterThan(0);
      for (const a of Object.values(
        mesh.sections.find((t) => t.id === s.id)!.parts,
      ))
        expect(a.every(Number.isFinite)).toBe(true);
    }
    expect(
      b.sections.flatMap((s) => s.exterior.ornamentation.items).length,
    ).toBeLessThanOrEqual(48);
    // Existing exact skin closure: the added ornaments cannot substitute for missing roof faces.
    const skin = buildExterior({
      ...b,
      sections: b.sections.map((s) => ({
        ...s,
        exterior: {
          ...s.exterior,
          features: [],
        },
      })),
    });
    // Legacy canopy faces and chimney caps are accessory roofs outside roofArea; test the structural skin alone.
    let top = 0,
      bottom = 0;
    for (const s of skin.sections)
      for (let i = 0; i < s.parts.roof.length; i += 9) {
        const a = s.parts.roof;
        const area =
          ((a[i + 3] - a[i]) * (a[i + 7] - a[i + 1]) -
            (a[i + 4] - a[i + 1]) * (a[i + 6] - a[i])) /
          2;
        if (area > 0) top += area;
        else bottom -= area;
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
    expect(top).toBeCloseTo(skin.roofArea, 1);
    expect(bottom).toBeCloseTo(skin.roofArea, 1);
  }
}
describe("BG-06C generated roof architecture and ornamentation", () => {
  it.each(advancedExamples)(
    "validates $name with exact closed roofs and real anchors",
    ({ config }) => {
      const result = generateArchitecturalBuildings(config);
      check(result);
      expect(
        result.proposals.some((p) =>
          p.project.building.sections.some(
            (s) => s.exterior.roofFeatures.length,
          ),
        ),
      ).toBe(true);
      expect(
        result.proposals.every((p) =>
          p.project.building.sections.some(
            (s) => s.exterior.ornamentation.items.length,
          ),
        ),
      ).toBe(true);
      if (config.style.startsWith("Medieval"))
        expect(
          result.proposals
            .flatMap((p) =>
              p.project.building.sections.flatMap(
                (s) => s.exterior.ornamentation.items,
              ),
            )
            .some((o) => o.type === "Dragon head"),
        ).toBe(false);
    },
    30000,
  );
  it.each([
    "Longhouse",
    "Cottage",
    "Tavern/Inn",
    "Manor",
    "Trading Hall",
  ] as const)(
    "supports advanced %s generation",
    (purpose) => {
      check(
        generateArchitecturalBuildings({
          ...purposeDefaults(purpose),
          crossGables: "Occasional",
          ornamentation: "Ornate",
          detail: "High",
        }),
      );
    },
    30000,
  );
  it.each(ORNAMENT_LEVELS)(
    "respects %s ornamentation without changing the saved schema",
    (ornamentation) => {
      const result = generateArchitecturalBuildings({
        ...config(),
        ornamentation,
        crossGables: "Occasional",
      });
      check(result);
      for (const p of result.proposals) {
        expect(p.project.schemaVersion).toBe(10);
        const items = p.project.building.sections.flatMap(
          (s) => s.exterior.ornamentation.items,
        );
        expect(
          ornamentation === "None" ? items.length === 0 : items.length > 0,
        ).toBe(true);
      }
    },
    30000,
  );
  it.each(CROSS_GABLE_COMPLEXITIES)(
    "respects %s cross-gables and deterministic complete data",
    (crossGables) => {
      const c = { ...config(), crossGables, ornamentation: "Ornate" as const };
      const a = generateArchitecturalBuildings(c),
        b = generateArchitecturalBuildings(c);
      expect(a).toEqual(b);
      for (const p of a.proposals) {
        const n = p.project.building.sections.flatMap(
          (s) => s.exterior.roofFeatures,
        ).length;
        expect(crossGables === "None" ? n === 0 : n > 0).toBe(true);
        expect(n).toBeLessThanOrEqual(crossGables === "Prominent" ? 2 : 1);
      }
      const silhouettes = (
        result: ReturnType<typeof generateArchitecturalBuildings>,
      ) =>
        result.proposals.map((p) =>
          JSON.stringify(
            p.project.building.sections.map((s) => [
              s.length,
              s.width,
              s.position,
              s.exterior,
            ]),
            (key, value) =>
              ["id", "doorId", "roofFeatureId"].includes(key)
                ? undefined
                : value,
          ),
        );
      expect(new Set(silhouettes(a)).size).toBe(a.proposals.length);
      if (crossGables !== "None")
        expect(
          silhouettes(generateArchitecturalBuildings({ ...c, seed: "other" })),
        ).not.toEqual(silhouettes(a));
    },
    30000,
  );
  it("preserves old BG-05 defaults and reports unsupported preferences explicitly", () => {
    const legacy = { ...config() };
    delete legacy.crossGables;
    delete legacy.ornamentation;
    expect(generateArchitecturalBuildings(legacy)).toEqual(
      generateArchitecturalBuildings(config()),
    );
    const unsupported = generateArchitecturalBuildings({
      ...config(),
      roofs: ["Hip"],
      crossGables: "Prominent",
      ornamentation: "Fantasy",
    });
    check(unsupported);
    expect(
      unsupported.proposals.every((p) =>
        p.warnings.some((w) => w.includes("No rectangular Gable host")),
      ),
    ).toBe(true);
    expect(
      architecturalConfigError({
        ...config(),
        crossGables: "Unsupported" as "None",
      }),
    ).toContain("supported");
  });
  it("keeps protected sections unchanged and reports omitted preferences", () => {
    const p = generateArchitecturalBuildings(config()).proposals[0].project;
    p.building.sections.forEach((s) => {
      s.locked = true;
    });
    const before = serializeProject(p);
    const result = generateArchitecturalDetails(
      p,
      { crossGables: "Prominent", ornamentation: "Fantasy", seed: "locked" },
      0,
    );
    expect(serializeProject(p)).toBe(before);
    expect(result.roofTrials).toBe(0);
    expect(result.warnings.some((w) => w.includes("locked"))).toBe(true);
  });
  it("allows later interior generation without deleting roof or carving records", () => {
    const p = generateArchitecturalBuildings({
      ...purposeDefaults("Cottage"),
      extensions: 0,
      crossGables: "Occasional",
      ornamentation: "Subtle",
    }).proposals[0].project;
    const before = serializeProject(p);
    const result = generateLayouts(p, starterConfig());
    expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(
      0,
    );
    expect(serializeProject(p)).toBe(before);
    for (const proposal of result.proposals)
      expect(proposal.building.sections).toEqual(p.building.sections);
  }, 30000);
  it("accepts independent editable records with rekeyed anchors, JSON and storage", async () => {
    const p = generateArchitecturalBuildings({
      ...config(),
      crossGables: "Prominent",
      ornamentation: "Fantasy",
    }).proposals[0];
    const before = serializeProject(p.project),
      accepted = createArchitecturalProject(p, "Generated carvings"),
      b = accepted.building;
    expect(serializeProject(p.project)).toBe(before);
    expect(accepted.id).not.toBe(p.project.id);
    const s = b.sections[0],
      item = s.exterior.ornamentation.items[0];
    const edited = replaceSection(b, {
      ...s,
      exterior: {
        ...s.exterior,
        ornamentation: {
          ...s.exterior.ornamentation,
          items: s.exterior.ornamentation.items.map((o) =>
            o.id === item.id ? { ...o, finish: "Dark wood" } : o,
          ),
        },
      },
    });
    expect(edited.sections[0].exterior.ornamentation.items[0].finish).toBe(
      "Dark wood",
    );
    expect(parseProject(serializeProject(accepted))).toEqual(accepted);
    const copy = validateProject(duplicateProject(accepted));
    expect(
      copy.building.sections[0].exterior.ornamentation.items[0].id,
    ).not.toBe(item.id);
    await saveProject(accepted);
    await saveProject(copy);
    expect(await loadProject(accepted.id)).toEqual(accepted);
    expect(await loadProject(copy.id)).toEqual(copy);
    expect(
      STYLE_PRESETS.every((style) =>
        advancedExamples.some((e) => e.config.style === style),
      ),
    ).toBe(true);
  });
});
