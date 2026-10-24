import { createProject, type Project } from "../../src/model";
import { attachmentPreview } from "../../src/attachments";
import {
  generateBuildings,
  defaultBuildingConfig,
} from "../../src/buildingGenerator";
export function wingFixture(offset = 4000, equal = false): Project {
  const p = createProject("Perpendicular wing"),
    r = attachmentPreview(p.building, {
      id: "wing",
      name: "Wing",
      type: "Residential Wing",
      length: 4000,
      width: 6000,
      shape: "Rectangle",
      edge: 0,
      offset,
    });
  if (!r.building) throw new Error(r.error!);
  p.building = r.building;
  if (equal) p.building.sections[1].exterior.wallHeight = 3800;
  return p;
}
export function roofCompositions(): Project[] {
  const long = generateBuildings({
    ...defaultBuildingConfig(),
    length: 18000,
    width: 8000,
    extensions: 3,
  }).proposals[0].project;
  long.name = "Longhouse with three extensions";
  const wing = wingFixture(),
    l = wingFixture(0),
    equal = wingFixture(4000, true),
    hip = wingFixture(),
    direction = wingFixture();
  l.name = "L composition";
  equal.name = "Equal eaves T composition";
  hip.name = "Gable to Hip";
  hip.building.sections[1].exterior.roofStyle = "Hip";
  direction.name = "Opposite ridge direction";
  direction.building.sections[0].exterior.ridgeAxis = "Y";
  direction.building.sections[1].exterior.ridgeAxis = "X";
  return [long, wing, l, equal, hip, direction];
}
