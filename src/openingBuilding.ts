import { openingContext } from "./assembly";
import { checkOpeningLocks, validateOpenings, type Opening } from "./openings";
import type { Building } from "./model";
export function changeOpenings(
  building: Building,
  openings: Opening[],
): Building {
  const context = openingContext(building);
  validateOpenings(context, openings);
  checkOpeningLocks(context, building.openings, openings);
  return { ...building, openings: structuredClone(openings) };
}
