import type { Building } from "./model";
import type { Region, RoomRecord, RoomType } from "./interior";
import { containsPoint, wallLength } from "./interior";
import { bounds } from "./polygon";
import { canonicalVertices, openingContext } from "./assembly";
import { circulation } from "./circulation";
import type { LayoutConfig, RoomRequest } from "./layoutGenerator";

export type RoomRole = Pick<RoomRecord, "type" | "name">;
export const privateRoom = (r: RoomRole) =>
  r.type === "Bedroom" ||
  r.type === "Bathroom" ||
  (r.type === "Custom" && /\b(private|counting|office|study)\b/i.test(r.name));
export const primaryRoom = (r: Pick<RoomRole, "type">) =>
  r.type === "Main Hall" || r.type === "Workshop";
export function relatedRooms(a: RoomType, b: RoomType) {
  const types = [a, b];
  if (
    types.includes("Storage") &&
    (types.includes("Workshop") || types.includes("Kitchen"))
  )
    return 3;
  if (
    types.includes("Dining") &&
    (types.includes("Kitchen") || types.includes("Main Hall"))
  )
    return 3;
  if (
    types.includes("Main Hall") &&
    (types.includes("Kitchen") || types.includes("Storage"))
  )
    return 2;
  if (
    types.includes("Utility") &&
    (types.includes("Kitchen") || types.includes("Workshop"))
  )
    return 1;
  return 0;
}

const shares = new WeakMap<
  Region,
  Map<ReturnType<typeof canonicalVertices>, number>
>();
/** Exact main-section intersection of the clear cells, independent of rendering. */
export function sectionShare(
  r: Region,
  main: ReturnType<typeof canonicalVertices>,
) {
  const cached = shares.get(r)?.get(main);
  if (cached !== undefined) return cached;
  let area = 0;
  for (const cell of r.cells) {
    const xs = [
        ...new Set([
          cell.x,
          ...main
            .map((p) => p.x)
            .filter((x) => x > cell.x && x < cell.x + cell.width),
          cell.x + cell.width,
        ]),
      ].sort((a, b) => a - b),
      ys = [
        ...new Set([
          cell.y,
          ...main
            .map((p) => p.y)
            .filter((y) => y > cell.y && y < cell.y + cell.height),
          cell.y + cell.height,
        ]),
      ].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j < ys.length - 1; j++)
        if (
          containsPoint(main, {
            x: (xs[i] + xs[i + 1]) / 2,
            y: (ys[j] + ys[j + 1]) / 2,
          })
        )
          area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  const result = area / r.area;
  if (!shares.has(r)) shares.set(r, new Map());
  shares.get(r)!.set(main, result);
  return result;
}
const shapes = new WeakMap<Region, ReturnType<typeof measureShape>>();
function measureShape(r: Region) {
  const box = bounds(r.loops.flat()),
    ys = [...new Set(r.loops.flat().map((p) => p.y))].sort((a, b) => a - b);
  const rows = ys.slice(0, -1).map((y, i) => {
    const spans = r.cells
        .filter((c) => c.y < ys[i + 1] && c.y + c.height > y)
        .map((c) => [c.x, c.x + c.width])
        .sort((a, b) => a[0] - b[0]),
      merged: number[][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    return merged;
  });
  let coreArea = 0;
  for (let i = 0; i < rows.length; i++) {
    let spans = rows[i];
    for (let j = i; j < rows.length; j++) {
      if (j > i)
        spans = spans.flatMap((a) =>
          rows[j]
            .map((b) => [Math.max(a[0], b[0]), Math.min(a[1], b[1])])
            .filter(([a, b]) => b > a),
        );
      for (const [lo, hi] of spans)
        coreArea = Math.max(coreArea, (hi - lo) * (ys[j + 1] - ys[i]));
    }
  }
  return {
    aspect: Math.max(box.length, box.width) / Math.min(box.length, box.width),
    coreRatio: coreArea / r.area,
    corners: r.loops.reduce((n, l) => n + l.length, 0),
  };
}
/** Largest uninterrupted rectangle is measured inside actual clear space, never a bounding-box area. */
export function roomShape(r: Region) {
  let shape = shapes.get(r);
  if (!shape) {
    shape = measureShape(r);
    shapes.set(r, shape);
  }
  return shape;
}
export function proportionPenalty(r: Region, type: RoomType) {
  const s = roomShape(r),
    ideal =
      type === "Corridor"
        ? 8
        : type === "Storage"
          ? 3.5
          : type === "Main Hall" || type === "Workshop"
            ? 3.5
            : 2.4;
  return (
    Math.max(0, s.aspect - ideal) * 8 +
    Math.max(0, 0.8 - s.coreRatio) * 45 +
    Math.max(0, s.corners - 6) * 1.5
  );
}
export function unusableRoom(r: Region, type: RoomType) {
  const shape = roomShape(r);
  return shape.coreRatio < 0.35 || (type !== "Corridor" && shape.aspect > 8);
}
export function distances(
  graph: Map<string, Set<string>>,
  start: string,
  blocked = new Set<string>(),
) {
  const result = new Map<string, number>();
  if (blocked.has(start)) return result;
  result.set(start, 0);
  const queue = [start];
  for (let i = 0; i < queue.length; i++)
    for (const next of graph.get(queue[i]) ?? [])
      if (!blocked.has(next) && !result.has(next)) {
        result.set(next, result.get(queue[i])! + 1);
        queue.push(next);
      }
  return result;
}
/** Removing all private rooms must never sever another room's only entrance path. */
export function privateThroughRoutes(
  graph: Map<string, Set<string>>,
  entrances: Set<string>,
  rooms: RoomRecord[],
) {
  const privateKeys = new Set(
      rooms.filter(privateRoom).map((r) => r.regionKey!),
    ),
    reached = new Set<string>();
  for (const entrance of entrances)
    for (const key of distances(graph, entrance, privateKeys).keys())
      reached.add(key);
  return rooms.filter((r) =>
    privateKeys.has(r.regionKey!)
      ? !entrances.has(r.regionKey!) &&
        ![...(graph.get(r.regionKey!) ?? [])].some((k) => reached.has(k))
      : !reached.has(r.regionKey!),
  );
}
export type LayoutQuality = {
  score: number;
  strengths: string[];
  warnings: string[];
  components: {
    hierarchy: number;
    proportions: number;
    adjacency: number;
    privacy: number;
    circulation: number;
    sectionSuitability: number;
    simplicity: number;
  };
};
const clamp = (n: number) => Math.max(0, Math.min(100, n));
/** Assesses validated physical connections; potential contacts never become claimed links. */
export function assessLayout(
  building: Building,
  config: LayoutConfig,
): LayoutQuality {
  const c = openingContext(building),
    access = circulation(c, building.openings),
    rooms = building.interior.rooms,
    main = canonicalVertices(
      building.sections.find((s) => s.id === building.mainSectionId)!,
      building,
    ),
    total = c.regions.reduce((n, r) => n + r.area, 0),
    primary = rooms
      .filter(primaryRoom)
      .sort(
        (a, b) =>
          c.regions.find((r) => r.key === b.regionKey)!.area -
          c.regions.find((r) => r.key === a.regionKey)!.area,
      )[0],
    privateKeys = new Set(rooms.filter(privateRoom).map((r) => r.regionKey!)),
    components = {
      hierarchy: 100,
      proportions: 100,
      adjacency: 100,
      privacy: 100,
      circulation: 100,
      sectionSuitability: 100,
      simplicity: 100,
    },
    strengths: string[] = [],
    warnings: string[] = [];
  for (const room of rooms) {
    const region = c.regions.find((r) => r.key === room.regionKey)!,
      shape = roomShape(region),
      penalty = proportionPenalty(region, room.type);
    components.proportions -= (penalty / rooms.length) * 3;
    if (unusableRoom(region, room.type))
      throw new Error(
        `${room.name} has an unusably thin or fragmented clear floor shape.`,
      );
    if (penalty > 12)
      warnings.push(
        `${room.name}: elongated or stepped shape; uninterrupted clear core ${(shape.coreRatio * 100).toFixed(0)}%.`,
      );
    if (primaryRoom(room))
      components.sectionSuitability -= (1 - sectionShare(region, main)) * 60;
    if (room.type === "Corridor")
      components.simplicity -= Math.max(0, region.area / total - 0.12) * 180;
    if (privateRoom(room)) {
      const neighbours = [...(access.graph.get(room.regionKey!) ?? [])].map(
        (k) => rooms.find((r) => r.regionKey === k)!,
      );
      if (
        neighbours.some(
          (r) =>
            r.type === "Kitchen" ||
            r.type === "Storage" ||
            r.type === "Workshop" ||
            r.type === "Utility",
        )
      ) {
        components.privacy -= 12;
        warnings.push(
          `${room.name} is entered from a work/service room rather than a hall.`,
        );
      }
      if (neighbours.length > 1) components.privacy -= 5;
    }
  }
  if (access.unreachable.length)
    throw new Error("A generated room has no entrance path.");
  if (privateThroughRoutes(access.graph, access.entrances, rooms).length)
    throw new Error(
      "A private chamber would be the sole route to another room. Try another partition arrangement.",
    );
  strengths.push(
    "All rooms have entrance paths without using a private chamber as a through-route.",
  );
  if (primary && config.purpose && config.purpose !== "Custom") {
    const region = c.regions.find((r) => r.key === primary.regionKey)!,
      largestOther = Math.max(
        ...c.regions.filter((r) => r.key !== region.key).map((r) => r.area),
        1,
      ),
      request = config.rooms.find((r) => r.type === primary.type),
      otherPreference = Math.max(
        ...config.rooms
          .filter((r) => r.type !== primary.type)
          .map((r) => r.preferredArea),
        0,
      ),
      dominant = ["Viking Longhouse", "Workshop", "Trading Hall"].includes(
        config.purpose || "",
      );
    if (sectionShare(region, main) < 0.5)
      throw new Error(
        `${primary.name} is chiefly in a supporting wing rather than the main structure.`,
      );
    if (request && request.preferredArea >= otherPreference) {
      components.hierarchy -=
        Math.max(0, (dominant ? 1.5 : 1.1) - region.area / largestOther) * 35;
      components.hierarchy -=
        Math.max(0, (dominant ? 0.38 : 0.26) - region.area / total) * 120;
      if (region.area >= largestOther * 1.2)
        strengths.push(
          `${primary.name} is the dominant room (${((region.area / total) * 100).toFixed(0)}% of net room area).`,
        );
      else
        warnings.push(
          `${primary.name} has limited dominance; other requested rooms constrain the hierarchy.`,
        );
    }
    if (sectionShare(region, main) >= 0.7)
      strengths.push(`${primary.name} lies chiefly in the main structure.`);
  }
  let links = 0,
    linkPenalty = 0;
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i],
        b = rooms[j],
        importance = relatedRooms(a.type, b.type);
      if (!importance) continue;
      const distance =
        distances(access.graph, a.regionKey!, privateKeys).get(b.regionKey!) ??
        Infinity;
      links += importance;
      linkPenalty += Math.min(3, Math.max(0, distance - 1)) * importance;
      if (distance === 1 && importance === 3)
        strengths.push(
          `${a.name} ↔ ${b.name}: direct validated doorway/passage.`,
        );
      else if (distance > 2)
        warnings.push(
          `${a.name} ↔ ${b.name}: ${Number.isFinite(distance) ? `${distance} door steps` : "no public route"}; a closer service link would be preferable.`,
        );
    }
  if (links) components.adjacency -= (linkPenalty / links) * 50;
  for (const key of access.entrances) {
    const room = rooms.find((r) => r.regionKey === key)!;
    if (primaryRoom(room) || room.type === "Corridor")
      strengths.push(`Exterior entrance opens into ${room.name}.`);
    else {
      components.circulation -= privateRoom(room) ? 45 : 20;
      warnings.push(
        `Preserved/proposed entrance opens into ${room.name}, rather than a public hall.`,
      );
    }
  }
  // Exact partition length, scaled to clear floor area; more cuts are not intrinsically better.
  components.simplicity -=
    Math.max(
      0,
      building.interior.partitions.reduce((n, w) => n + wallLength(w), 0) /
        Math.sqrt(total) -
        3.5,
    ) * 5;
  for (const k of Object.keys(components) as (keyof typeof components)[])
    components[k] = Math.round(clamp(components[k]));
  const score =
    Math.round(
      (components.hierarchy * 0.2 +
        components.proportions * 0.16 +
        components.adjacency * 0.23 +
        components.privacy * 0.15 +
        components.circulation * 0.1 +
        components.sectionSuitability * 0.1 +
        components.simplicity * 0.06) *
        100,
    ) / 100;
  return { score, components, strengths: [...new Set(strengths)], warnings };
}

/** Assignment heuristic only. Final quality uses validated doors, never this potential graph. */
export function assignmentQuality(
  regions: Region[],
  requests: (RoomRequest & { name: string })[],
  main: ReturnType<typeof canonicalVertices>,
  graph: Map<string, Set<string>>,
  entrances = new Set<string>(),
) {
  let cost = 0;
  const rooms = regions.map((r, i) => ({
    id: String(i),
    regionKey: r.key,
    ...requests[i],
    notes: "",
  }));
  const privateKeys = new Set(
    rooms.filter(privateRoom).map((r) => r.regionKey),
  );
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i],
      want = requests[i];
    if (r.area < want.minimumArea * 1e6 || unusableRoom(r, want.type))
      return Infinity;
    cost +=
      Math.pow(
        (r.area / 1e6 - want.preferredArea) / Math.max(1, want.preferredArea),
        2,
      ) *
        8 +
      proportionPenalty(r, want.type);
    if (primaryRoom(want)) cost += (1 - sectionShare(r, main)) * 25;
    if (entrances.has(r.key))
      cost +=
        primaryRoom(want) || want.type === "Corridor"
          ? -10
          : privateRoom(want)
            ? 150
            : 20;
    if (
      privateRoom(want) &&
      ![...(graph.get(r.key) ?? [])].some((k) => !privateKeys.has(k))
    )
      cost += 100;
    for (let j = 0; j < i; j++) {
      const relation = relatedRooms(want.type, requests[j].type);
      if (relation)
        cost +=
          Math.min(
            4,
            Math.max(
              0,
              (distances(graph, r.key, privateKeys).get(regions[j].key) ?? 5) -
                1,
            ),
          ) *
          relation *
          6;
    }
  }
  const publicRooms = rooms.filter((r) => !privateRoom(r));
  if (publicRooms.length) {
    const reach = distances(graph, publicRooms[0].regionKey, privateKeys);
    cost += publicRooms.filter((r) => !reach.has(r.regionKey)).length * 200;
  }
  return cost;
}
