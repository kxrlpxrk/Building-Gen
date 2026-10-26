import type { LayoutConfig, RoomRequest } from "./layoutGenerator";
export const LAYOUT_PURPOSES = [
  "Viking Longhouse",
  "Medieval Cottage",
  "Farmhouse",
  "Workshop",
  "Tavern/Inn",
  "Manor",
  "Trading Hall",
  "Custom",
] as const;
export type LayoutPurpose = (typeof LAYOUT_PURPOSES)[number];
/** Transient recommendations only. Users retain control of every requirement. */
export function purposeLayout(
  purpose: LayoutPurpose,
  usable = 88.16,
  seed = "1041",
): LayoutConfig {
  const rooms: RoomRequest[] = [];
  const add = (
    type: RoomRequest["type"],
    name: string,
    share: number,
    quantity = 1,
    priority: RoomRequest["priority"] = "Required",
    notes = "",
  ) =>
    rooms.push({
      key: `purpose-${rooms.length}`,
      type,
      name,
      notes,
      quantity,
      priority,
      minimumArea: Math.max(4, Math.floor(usable * share * 0.65 * 4) / 4),
      preferredArea: Math.max(6, Math.floor(usable * share * 4) / 4),
    });
  if (purpose === "Workshop") {
    add(
      "Workshop",
      "Main Workshop",
      0.5,
      1,
      "Required",
      "Primary work floor; keep storage close and avoid private through-traffic.",
    );
    add("Storage", "Materials Store", 0.2);
    add("Utility", "Service Room", 0.15);
    add(
      "Custom",
      "Office",
      0.1,
      1,
      "Preferred",
      "Optional record-keeping or private work space.",
    );
  } else if (purpose === "Manor") {
    add("Main Hall", "Entrance Hall", 0.24);
    add("Dining", "Dining Hall", 0.19);
    add("Kitchen", "Kitchen", 0.14);
    add("Bedroom", "Private Chamber", 0.11, 2);
    add("Storage", "Stores", 0.08);
    add("Custom", "Private Study", 0.07, 1, "Preferred");
    add("Utility", "Service Room", 0.06, 1, "Preferred");
  } else {
    const long = purpose === "Viking Longhouse",
      tavern = purpose === "Tavern/Inn",
      trade = purpose === "Trading Hall",
      cottage = purpose === "Medieval Cottage";
    add(
      "Main Hall",
      long
        ? "Main Longhall"
        : tavern
          ? "Public Hall"
          : trade
            ? "Trading Floor"
            : "Main Hall",
      long || trade ? 0.48 : 0.38,
      1,
      "Required",
      long
        ? "Shared ground-floor hall; the hearth and furnishings are planning notes only, not generated objects."
        : "Public or shared gathering space, preferably reached directly from the entrance.",
    );
    if (!trade) add("Kitchen", cottage ? "Food Preparation" : "Kitchen", 0.17);
    if (trade) {
      add("Storage", "Goods Store", 0.24);
      add("Custom", "Counting Room", 0.13);
      add("Utility", "Service Room", 0.1, 1, "Preferred");
    } else {
      add(
        "Bedroom",
        long
          ? "Sleeping Chamber"
          : tavern
            ? "Guest Chamber"
            : "Sleeping Chamber",
        tavern ? 0.13 : 0.2,
        tavern ? 2 : 1,
      );
      add(
        "Storage",
        "Food and Equipment Store",
        0.1,
        1,
        cottage ? "Preferred" : "Required",
      );
    }
    if (long)
      add(
        "Bedroom",
        "Chieftain Chamber",
        0.12,
        1,
        "Preferred",
        "Optional private chamber, away from through-traffic.",
      );
    if (tavern) add("Utility", "Service Room", 0.08, 1, "Preferred");
    if (purpose === "Farmhouse")
      add("Utility", "Farm Service Room", 0.1, 1, "Preferred");
  }
  return { purpose, rooms, style: "Balanced", seed };
}
