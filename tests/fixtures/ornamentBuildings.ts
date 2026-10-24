import {
  generateArchitecturalBuildings,
  defaultArchitecturalConfig,
} from "../../src/architecturalGenerator";
import { createProject, validateProject, type Project } from "../../src/model";
import {
  ornamentPreset,
  type OrnamentLevel,
  suggestedOrnament,
} from "../../src/ornamentation";
import { defaultRoofFeature } from "../../src/roofFeatures";
export function ornamentBuilding(
  level: OrnamentLevel = "None",
  medieval = false,
): Project {
  const p = createProject(
      `${level} ${medieval ? "medieval cottage" : "Norse hall"}`,
    ),
    s = p.building.sections[0];
  s.length = medieval ? 10000 : 18000;
  s.width = medieval ? 7000 : 8000;
  p.architecture = medieval ? "Medieval" : "Norse";
  s.exterior.material = p.architecture;
  s.exterior.stylePreset = medieval
    ? "Medieval Timber Cottage"
    : level === "None" || level === "Subtle"
      ? "Rustic Norse"
      : "Norse Chieftain's Hall";
  s.exterior.covering = medieval ? "Clay tiles" : "Wood shingles";
  s.exterior.detailLevel = "High";
  s.exterior.wallHeight = medieval ? 3400 : 4200;
  s.exterior.roofPitch = medieval ? 44 : 42;
  p.building.openings = [
    {
      id: "entry",
      host: { kind: "exterior", sectionId: s.id, edge: 0 },
      offset: s.length / 2,
      width: 900,
      type: "exterior-door",
      hinge: "left",
      swing: 1,
    },
  ];
  s.exterior.windows = [2000, s.length - 2000].map((offset, i) => ({
    id: `window-${i}`,
    edge: 0,
    offset,
    width: 650,
    height: 800,
    sill: 1100,
    style: medieval ? "Medieval glazed" : "Timber shuttered",
    shutters: !medieval,
    glazing: medieval,
  }));
  s.exterior.ornamentation = ornamentPreset(p.building, s, level).ornamentation;
  return validateProject(p);
}
export function ornamentExamples() {
  const plain = ornamentBuilding(),
    subtle = ornamentBuilding("Subtle"),
    ornate = ornamentBuilding("Ornate"),
    fantasy = ornamentBuilding("Fantasy"),
    cross = ornamentBuilding("Ornate"),
    s = cross.building.sections[0];
  s.exterior.roofFeatures = [defaultRoofFeature(s, "cross-gable")];
  const items = [];
  for (const end of ["Negative", "Positive"] as const)
    for (const type of ["Dragon head", "Bargeboard", "Gable panel"] as const) {
      const o = suggestedOrnament(
        cross.building,
        s,
        type,
        `cross-${end}-${type.replaceAll(" ", "-")}`,
      );
      o.anchor = { kind: "roof", roofFeatureId: "cross-gable", end, offset: 0 };
      o.variant = 3;
      o.scale = type === "Dragon head" ? 1300 : 1000;
      items.push(o);
    }
  s.exterior.ornamentation = { level: "Fantasy", items };
  cross.name = "Decorated crossing gables";
  validateProject(cross);
  return [
    plain,
    subtle,
    ornate,
    fantasy,
    cross,
    ornamentBuilding("Ornate", true),
  ];
}

export function ornamentPerformanceBuilding(): Project {
  const p = generateArchitecturalBuildings({
    ...defaultArchitecturalConfig(),
    extensions: 3,
    style: "Norse Chieftain's Hall",
    detail: "High",
    ornaments: false,
    chimneys: false,
    canopies: false,
  }).proposals[0].project;
  let found = false;
  for (const side of ["Negative", "Positive"] as const)
    for (let offset = 2000; offset < 16000 && !found; offset += 1000) {
      const trial = structuredClone(p),
        s = trial.building.sections[0];
      s.exterior.roofFeatures = [
        {
          ...defaultRoofFeature(s, "performance-cross"),
          width: 2400,
          depth: 4000,
          side,
          offset,
        },
      ];
      try {
        validateProject(trial);
        p.building = trial.building;
        found = true;
      } catch {}
    }
  if (!found)
    throw new Error("No supported cross-gable bay in performance fixture.");
  for (const s of p.building.sections)
    s.exterior.ornamentation = ornamentPreset(
      p.building,
      s,
      s.id === p.building.mainSectionId ? "Ornate" : "Subtle",
    ).ornamentation;
  const s = p.building.sections[0],
    f = s.exterior.roofFeatures[0],
    o = suggestedOrnament(p.building, s, "Dragon head", "performance-dragon");
  o.anchor = {
    kind: "roof",
    roofFeatureId: f.id,
    end: f.side === "Positive" ? "Positive" : "Negative",
    offset: 0,
  };
  s.exterior.ornamentation.items.push(o);
  p.name = "High-detail carved multi-wing hall";
  return validateProject(p);
}
