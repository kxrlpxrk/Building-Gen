import { windowOpening } from "./exteriorValidation";
import { LAYOUT_PURPOSES, type LayoutPurpose } from "./layoutPurposes";
import type { Building, Project } from "./model";
import { validateProject } from "./model";
import {
  combinedGeometry,
  openingContext,
  canonicalVertices,
} from "./assembly";
import {
  containsPoint,
  deriveInterior,
  wallLength,
  type Partition,
  type Region,
  type RoomType,
} from "./interior";
import { bounds } from "./polygon";
import {
  openingGeometry,
  newOpening,
  openingSides,
  hostKey,
  validateOpenings,
  swingWarnings,
  type Opening,
  type OpeningContext,
} from "./openings";
import { circulation } from "./circulation";
export type RoomRequest = {
  key: string;
  name?: string;
  notes?: string;
  type: RoomType;
  quantity: number;
  minimumArea: number;
  preferredArea: number;
  priority: "Required" | "Preferred";
};
export type LayoutConfig = {
  purpose?: LayoutPurpose;
  rooms: RoomRequest[];
  style: "Compact" | "Balanced" | "Open";
  seed: string;
};
export type LayoutProposal = {
  label: string;
  building: Building;
  score: number;
  usableArea: number;
  assignedArea: number;
  unassignedArea: number;
  thresholdArea: number;
  omitted: string[];
  summary: string;
  requiredSatisfied: number;
  preferences: string[];
};
export type LayoutResult = {
  proposals: LayoutProposal[];
  messages: string[];
  evaluations: number;
  doorEvaluations: number;
  assignmentOperations: number;
};
export const MIN_ROOM_SPAN = 1800;
export const SEARCH_LIMIT = 3200;
export const ASSIGNMENT_LIMIT = 6000000;
export const MAX_REGIONS = 8;
export const DOOR_TRIAL_LIMIT = 4800;
export const starterConfig = (): LayoutConfig => ({
  seed: "1041",
  style: "Balanced",
  rooms: [
    {
      key: "hall",
      type: "Main Hall",
      quantity: 1,
      minimumArea: 22,
      preferredArea: 32,
      priority: "Required",
    },
    {
      key: "kitchen",
      type: "Kitchen",
      quantity: 1,
      minimumArea: 10,
      preferredArea: 14,
      priority: "Required",
    },
    {
      key: "bedroom",
      type: "Bedroom",
      quantity: 1,
      minimumArea: 10,
      preferredArea: 16,
      priority: "Required",
    },
    {
      key: "storage",
      type: "Storage",
      quantity: 1,
      minimumArea: 4,
      preferredArea: 8,
      priority: "Required",
    },
  ],
});
export function hashSeed(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function random(seed: string) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function configError(c: LayoutConfig): string | null {
  const quantity = c.rooms.reduce((n, r) => n + r.quantity, 0);
  if (quantity < 2 || quantity > 8 || c.rooms.length > 8 || !c.rooms.length)
    return "Request 2–8 rooms in total, including quantities.";
  if (
    !["Compact", "Balanced", "Open"].includes(c.style) ||
    !c.seed.trim() ||
    c.seed.length > 64
  )
    return "Choose a layout style and a seed of 1–64 characters.";
  if (c.purpose && !LAYOUT_PURPOSES.includes(c.purpose))
    return "Choose a supported layout purpose.";
  if (new Set(c.rooms.map((r) => r.key)).size !== c.rooms.length)
    return "Room request IDs must be unique.";
  const types = [
    "Main Hall",
    "Bedroom",
    "Kitchen",
    "Dining",
    "Storage",
    "Workshop",
    "Bathroom",
    "Corridor",
    "Utility",
    "Custom",
  ];
  for (const r of c.rooms)
    if (
      (r.name !== undefined &&
        (typeof r.name !== "string" || r.name.length > 100)) ||
      (r.notes !== undefined &&
        (typeof r.notes !== "string" || r.notes.length > 2000)) ||
      !types.includes(r.type) ||
      !["Required", "Preferred"].includes(r.priority) ||
      !Number.isInteger(r.quantity) ||
      r.quantity < 1 ||
      r.quantity > 8 ||
      ![r.minimumArea, r.preferredArea].every(
        (n) => Number.isFinite(n) && n >= 1 && n <= 250000,
      ) ||
      r.preferredArea < r.minimumArea
    )
      return "Use whole quantities, areas of at least 1 m², and preferred area ≥ minimum area.";
  return null;
}
type Want = RoomRequest & { name: string };
function expand(c: LayoutConfig): Want[] {
  return c.rooms
    .flatMap((r) =>
      Array.from({ length: r.quantity }, (_, i) => ({
        ...r,
        quantity: 1,
        name:
          r.quantity > 1 ? `${r.name || r.type} ${i + 1}` : r.name || r.type,
      })),
    )
    .sort(
      (a, b) =>
        Number(b.priority === "Required") - Number(a.priority === "Required") ||
        b.minimumArea - a.minimumArea ||
        b.preferredArea - a.preferredArea ||
        a.name.localeCompare(b.name),
    );
}
function mergedIntervals(values: number[][]) {
  const sorted = values.sort((a, b) => a[0] - b[0]),
    result: number[][] = [];
  for (const pair of sorted) {
    const last = result[result.length - 1];
    if (last && pair[0] <= last[1]) last[1] = Math.max(last[1], pair[1]);
    else result.push([...pair]);
  }
  return result;
}
/** Cross-sections come from exact region cells, never their bounding-box area. */
export function minimumSpans(region: Region) {
  for (const axis of ["x", "y"] as const) {
    const other = axis === "x" ? "y" : "x",
      coordinates = [
        ...new Set(
          region.cells.flatMap((t) => [
            t[axis],
            t[axis] + (axis === "x" ? t.width : t.height),
          ]),
        ),
      ].sort((a, b) => a - b);
    for (let i = 0; i < coordinates.length - 1; i++) {
      const mid = (coordinates[i] + coordinates[i + 1]) / 2,
        spans = mergedIntervals(
          region.cells
            .filter(
              (t) =>
                mid > t[axis] &&
                mid < t[axis] + (axis === "x" ? t.width : t.height),
            )
            .map((t) => [
              t[other],
              t[other] + (other === "x" ? t.width : t.height),
            ]),
        );
      if (spans.some(([a, b]) => b - a < MIN_ROOM_SPAN)) return false;
    }
  }
  return true;
}
function weights(w: Want, c: LayoutConfig) {
  return (
    w.preferredArea *
    (w.type === "Main Hall" || w.type === "Workshop"
      ? c.style === "Open"
        ? 1.5
        : c.style === "Balanced"
          ? 1.15
          : 1
      : 1)
  );
}
/** Bounded subset assignment: reserve larger/required requests first, allowing
 * unfinished regions to hold groups of future rooms. Final groups are singletons. */
type PlanningContext = {
  main: ReturnType<typeof canonicalVertices>;
  entries: { x: number; y: number }[];
  boundaries: { x: number; y: number }[];
  operations: number;
};
function mainShare(r: Region, main: PlanningContext["main"]) {
  let area = 0;
  // Exact integration over region cells subdivided at the orthogonal section edges.
  for (const cell of r.cells) {
    const xs = [
        cell.x,
        ...main
          .map((p) => p.x)
          .filter((x) => x > cell.x && x < cell.x + cell.width),
        cell.x + cell.width,
      ].sort((a, b) => a - b),
      ys = [
        cell.y,
        ...main
          .map((p) => p.y)
          .filter((y) => y > cell.y && y < cell.y + cell.height),
        cell.y + cell.height,
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
  return area / r.area;
}
function assignment(
  regions: Region[],
  wants: Want[],
  c: LayoutConfig,
  context: PlanningContext,
) {
  const full = (1 << wants.length) - 1,
    total = regions.reduce((n, r) => n + r.area, 0),
    weight = wants.reduce((n, w) => n + weights(w, c), 0),
    memo = new Map<string, { cost: number; groups: number[] } | null>();
  const min = new Float64Array(full + 1),
    pref = new Float64Array(full + 1),
    count = new Uint8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    const bit = mask & -mask,
      i = Math.log2(bit),
      rest = mask ^ bit;
    min[mask] = min[rest] + wants[i].minimumArea * 1e6;
    pref[mask] = pref[rest] + weights(wants[i], c);
    count[mask] = count[rest] + 1;
  }
  const spatial = regions.map((r) => {
    const share = mainShare(r, context.main),
      entry = context.entries.some((p) =>
        r.cells.some(
          (t) =>
            p.x > t.x &&
            p.x < t.x + t.width &&
            p.y > t.y &&
            p.y < t.y + t.height,
        ),
      );
    return wants.map((w) => {
      const publicRoom =
        w.type === "Main Hall" ||
        w.type === "Workshop" ||
        w.type === "Corridor";
      return (
        (publicRoom ? (1 - share) * 0.08 : share * 0.005) +
        (entry ? (publicRoom ? -0.1 : w.type === "Bedroom" ? 0.12 : 0.04) : 0)
      );
    });
  });
  function solve(
    index: number,
    mask: number,
  ): { cost: number; groups: number[] } | null {
    if (index === regions.length)
      return mask === 0 ? { cost: 0, groups: [] } : null;
    const key = `${index}:${mask}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: { cost: number; groups: number[] } | null = null;
    for (let subset = mask; subset; subset = (subset - 1) & mask) {
      if (count[mask ^ subset] < regions.length - index - 1) continue;
      if (regions.length === wants.length && count[subset] !== 1) continue;
      if (count[subset] > wants.length - regions.length + 1) continue;
      if (index === regions.length - 1 && subset !== mask) continue;
      if (min[subset] > regions[index].area) continue;
      if (context.operations >= ASSIGNMENT_LIMIT) return null;
      context.operations++;
      const rest = solve(index + 1, mask ^ subset);
      if (!rest) continue;
      const delta =
          (regions[index].area - (total * pref[subset]) / weight) / total,
        cost =
          rest.cost +
          delta * delta +
          (count[subset] === 1 ? spatial[index][Math.log2(subset)] : 0);
      if (!best || cost < best.cost)
        best = { cost, groups: [subset, ...rest.groups] };
    }
    memo.set(key, best);
    return best;
  }
  return solve(0, full);
}
const partitionKey = (walls: Partition[]) =>
  walls
    .map((w) => `${w.a.x},${w.a.y}:${w.b.x},${w.b.y}`)
    .sort()
    .join("|");
function meaningful(a: Partition[], b: Partition[]) {
  if (a.length !== b.length) return true;
  const aa = [...a].sort((a, b) =>
      JSON.stringify(a.a).localeCompare(JSON.stringify(b.a)),
    ),
    bb = [...b].sort((a, b) =>
      JSON.stringify(a.a).localeCompare(JSON.stringify(b.a)),
    );
  return aa.some(
    (w, i) =>
      Math.max(
        Math.abs(w.a.x - bb[i].a.x),
        Math.abs(w.a.y - bb[i].a.y),
        Math.abs(w.b.x - bb[i].b.x),
        Math.abs(w.b.y - bb[i].b.y),
      ) >= 300 || (w.a.x === w.b.x) !== (bb[i].a.x === bb[i].b.x),
  );
}
function cuts(
  region: Region,
  rand: () => number,
  namespace: string,
  context: PlanningContext,
  wants: Want[],
): Partition[] {
  const box = bounds(region.loops.flat()),
    result: Partition[] = [];
  const fractions = [
    0.5,
    0.26 + rand() * 0.1,
    0.38 + rand() * 0.08,
    0.55 + rand() * 0.08,
    0.66 + rand() * 0.1,
  ];
  for (const vertical of [true, false])
    for (const fraction of [
      ...fractions,
      ...wants.map((w) =>
        Math.min(
          0.85,
          Math.max(
            0.15,
            w.preferredArea / wants.reduce((n, t) => n + t.preferredArea, 0),
          ),
        ),
      ),
      ...context.boundaries.flatMap((p) => {
        const v = vertical ? p.x : p.y,
          lo = vertical ? box.minX : box.minY,
          span = vertical ? box.length : box.width;
        return [-50, 50]
          .map((d) => (v + d - lo) / span)
          .filter((f) => f > 0.05 && f < 0.95);
      }),
    ]) {
      const axis = vertical ? "x" : "y",
        other = vertical ? "y" : "x",
        at =
          Math.round(
            ((vertical ? box.minX : box.minY) +
              (vertical ? box.length : box.width) * fraction) /
              50,
          ) * 50;
      const intervals = mergedIntervals(
        region.cells
          .filter(
            (t) =>
              at > t[axis] && at < t[axis] + (vertical ? t.width : t.height),
          )
          .map((t) => [t[other], t[other] + (vertical ? t.height : t.width)]),
      );
      for (const [lo, hi] of intervals) {
        if (hi - lo < MIN_ROOM_SPAN) continue;
        const a = vertical ? { x: at, y: lo } : { x: lo, y: at },
          b = vertical ? { x: at, y: hi } : { x: hi, y: at };
        if (![a.x, a.y, b.x, b.y].every(Number.isSafeInteger)) continue;
        result.push({
          id: `${namespace}-w-${hashSeed(JSON.stringify([a, b])).toString(16)}`,
          a,
          b,
          thickness: 100,
        });
      }
    }
  const unique = [
    ...new Map(result.map((w) => [partitionKey([w]), w])).values(),
  ];
  // Mix axes before truncation so eight-room searches stay both bounded and varied.
  return unique
    .map((w) => ({ w, rank: rand() }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, wants.length > 5 ? 10 : 16)
    .map((t) => t.w);
}
function clearSwing(
  context: OpeningContext,
  existing: Opening[],
  o: Opening,
): Opening | null {
  if (o.type === "passage") return o;
  const [a] = openingSides(context, o),
    inward = a ? 1 : -1;
  for (const swing of [inward, -inward] as (1 | -1)[])
    for (const hinge of ["left", "right"] as const) {
      const candidate = { ...o, swing, hinge };
      if (!swingWarnings(context, [...existing, candidate]).size)
        return candidate;
    }
  return null;
}
function positions(length: number) {
  return [
    ...new Set(
      [0.5, 0.25, 0.75, 0.375, 0.625, 0.15, 0.85].map(
        (f) => Math.round((length * f) / 50) * 50,
      ),
    ),
  ];
}
function connectRooms(
  building: Building,
  namespace: string,
  budget: { used: number },
) {
  const trial = () => {
    if (budget.used >= DOOR_TRIAL_LIMIT)
      throw new Error(
        "Door-slot search limit reached; try another seed or fewer rooms.",
      );
    budget.used++;
  };
  const c = openingContext(building),
    openings = [...building.openings],
    windows = building.sections.flatMap((s) =>
      s.exterior.windows.map((w) => windowOpening(s, w)),
    ),
    roomTypes = new Map(
      building.interior.rooms.map((r) => [r.regionKey, r.type]),
    );
  validateOpenings(c, [...windows, ...openings]);
  if (swingWarnings(c, openings).size)
    throw new Error(
      "A preserved exterior entrance swing is obstructed by these partitions.",
    );
  if (!openings.length) {
    const entrances: { door: Opening; rank: number }[] = [];
    for (const h of c.hosts.filter((h) => h.ref.kind === "exterior"))
      for (const offset of positions(
        Math.abs(h.b.x - h.a.x) + Math.abs(h.b.y - h.a.y),
      )) {
        trial();
        let d = newOpening(
          `${namespace}-entry-${hashSeed(hostKey(h.ref) + offset).toString(16)}`,
          h.ref,
          offset,
        );
        try {
          validateOpenings(c, [...windows, d]);
          const safe = clearSwing(c, [], d);
          if (!safe) continue;
          d = safe;
          const [a, b] = openingSides(c, d),
            type = roomTypes.get(a ?? b ?? "");
          entrances.push({
            door: d,
            rank:
              type === "Main Hall" || type === "Workshop"
                ? 0
                : type === "Corridor"
                  ? 1
                  : type === "Kitchen"
                    ? 2
                    : type === "Bedroom"
                      ? 5
                      : 3,
          });
        } catch {
          /* Invalid slots are discarded, never repaired. */
        }
      }
    entrances.sort(
      (a, b) => a.rank - b.rank || a.door.id.localeCompare(b.door.id),
    );
    if (!entrances.length)
      throw new Error(
        "No unobstructed exterior entrance can fit the generated rooms.",
      );
    openings.push(entrances[0].door);
  }
  const options: { door: Opening; a: string; b: string; rank: number }[] = [];
  for (const wall of building.interior.partitions)
    for (const offset of positions(wallLength(wall))) {
      trial();
      const base = newOpening(
        `${namespace}-door-${hashSeed(wall.id + offset).toString(16)}`,
        { kind: "partition", partitionId: wall.id },
        offset,
      );
      let sides: readonly (string | null)[];
      try {
        sides = openingSides(c, base);
      } catch {
        continue;
      }
      const [a, b] = sides;
      if (!a || !b || a === b) continue;
      const types = [roomTypes.get(a), roomTypes.get(b)],
        open =
          types.includes("Main Hall") &&
          (types.includes("Kitchen") || types.includes("Dining"));
      let d: Opening = open
        ? {
            id: base.id,
            host: base.host,
            offset: base.offset,
            width: 1200,
            type: "passage",
          }
        : base;
      try {
        validateOpenings(c, [...windows, ...openings, d]);
        const safe = clearSwing(c, openings, d);
        if (!safe) continue;
        d = safe;
        options.push({
          door: d,
          a,
          b,
          rank:
            types.includes("Storage") &&
            (types.includes("Kitchen") || types.includes("Workshop"))
              ? -3
              : types.includes("Main Hall") || types.includes("Workshop")
                ? 0
                : types.includes("Corridor")
                  ? 1
                  : types.includes("Bedroom") && types.includes("Kitchen")
                    ? 5
                    : 2,
        });
      } catch {
        /* Try another exact slot. */
      }
    }
  options.sort((a, b) => a.rank - b.rank || a.door.id.localeCompare(b.door.id));
  for (let step = 0; step < building.interior.rooms.length; step++) {
    const access = circulation(c, openings);
    if (access.reachable.size === c.regions.length)
      return { ...building, openings };
    let found = false;
    const ranked = [...options].sort((a, b) => {
      const rank = (o: typeof a) => {
        const from = access.reachable.has(o.a) ? o.a : o.b;
        return o.rank + (roomTypes.get(from) === "Bedroom" ? 20 : 0);
      };
      return rank(a) - rank(b) || a.door.id.localeCompare(b.door.id);
    });
    for (const option of ranked) {
      if (access.reachable.has(option.a) === access.reachable.has(option.b))
        continue;
      try {
        validateOpenings(c, [...windows, ...openings, option.door]);
        if (swingWarnings(c, [...openings, option.door]).size) continue;
        openings.push(option.door);
        found = true;
        break;
      } catch {
        /* Another route may remain valid. */
      }
    }
    if (!found) break;
  }
  throw new Error(
    "No valid unobstructed door route reaches every requested room.",
  );
}
/** Pure, seeded, bounded guillotine solver. Worker/UI code owns cancellation. */
export function generateLayouts(
  project: Project,
  config: LayoutConfig,
  onProgress?: (n: number) => void,
): LayoutResult {
  const error = configError(config);
  if (error) throw new Error(error);
  validateProject(project);
  const source = project.building,
    geometry = combinedGeometry(source),
    usable = deriveInterior(geometry.inner, []).usableArea;
  if (source.sections.some((s) => s.locked))
    throw new Error(
      "Whole-building generation cannot alter protected sections. Unlock all architectural sections first; partial locked-section generation is not supported.",
    );
  if (geometry.inner.length > 32)
    throw new Error(
      "This footprint exceeds the interior solver limit of 32 clear-boundary vertices. Manual planning remains available.",
    );
  const all = expand(config),
    required = all.filter((w) => w.priority === "Required"),
    minimum = required.reduce((n, w) => n + w.minimumArea * 1e6, 0);
  if (minimum > usable)
    throw new Error(
      `Required minimum ${(minimum / 1e6).toFixed(2)} m² exceeds usable interior ${(usable / 1e6).toFixed(2)} m², before partitions and thresholds.`,
    );
  const rand = random(
      config.seed +
        JSON.stringify(config.rooms.map(({ key: _, ...r }) => r)) +
        config.style,
    ),
    namespace = `gen-${hashSeed(source.id + config.seed + JSON.stringify(config.rooms.map(({ key: _, ...r }) => r)) + config.style).toString(16)}`;
  const base: Building = {
    ...structuredClone(source),
    interior: { partitions: [], rooms: [] },
    openings: structuredClone(
      source.openings.filter((o) => o.host.kind === "exterior"),
    ),
  };
  const subsets = Array.from({ length: 1 << all.length }, (_, mask) =>
    all.filter((_, i) => mask & (1 << i)),
  )
    .filter((w) => w.length >= 2 && required.every((r) => w.includes(r)))
    .sort(
      (a, b) =>
        b.length - a.length ||
        a.reduce((n, w) => n + w.minimumArea, 0) -
          b.reduce((n, w) => n + w.minimumArea, 0),
    );
  const originalContext = openingContext(base);
  const context: PlanningContext = {
    main: canonicalVertices(
      source.sections.find((s) => s.id === source.mainSectionId)!,
      source,
    ),
    boundaries: source.sections.flatMap((s) => canonicalVertices(s, source)),
    operations: 0,
    entries: base.openings.flatMap((o) => {
      const g = openingGeometry(originalContext, o),
        n = g.host.inward!;
      return [
        {
          x: g.center.x + n.x * (g.host.thickness / 2 + 10),
          y: g.center.y + n.y * (g.host.thickness / 2 + 10),
        },
      ];
    }),
  };
  const preservedWindows = base.sections.flatMap((s) =>
    s.exterior.windows.map((w) => windowOpening(s, w)),
  );
  const doorBudget = { used: 0 };
  let evaluations = 0,
    lastReason =
      "No arrangement met the room areas, 1.8 m clear spans and door clearances.";
  type State = { walls: Partition[]; regions: Region[]; cost: number };
  for (const wants of subsets) {
    if (evaluations >= SEARCH_LIMIT || context.operations >= ASSIGNMENT_LIMIT)
      break;
    if (wants.reduce((n, w) => n + w.minimumArea * 1e6, 0) > usable) continue;
    const subsetStart = evaluations;
    const subsetLimit = Math.min(SEARCH_LIMIT, subsetStart + 2400);
    let beam: State[] = [
      {
        walls: [],
        regions: deriveInterior(geometry.inner, []).regions,
        cost: 0,
      },
    ];
    for (let depth = 0; depth < wants.length - 1; depth++) {
      const next: State[] = [],
        seen = new Set<string>();
      explore: for (const state of beam)
        for (const region of [...state.regions].sort((a, b) => b.area - a.area))
          for (const wall of cuts(region, rand, namespace, context, wants)) {
            if (
              evaluations >= subsetLimit ||
              context.operations >= ASSIGNMENT_LIMIT
            )
              break explore;
            const walls = [...state.walls, wall],
              key = partitionKey(walls);
            if (seen.has(key)) continue;
            seen.add(key);
            evaluations++;
            if (evaluations % 40 === 0) onProgress?.(evaluations);
            try {
              const result = deriveInterior(geometry.inner, walls);
              if (
                result.regions.length !== state.regions.length + 1 ||
                !result.regions.every(minimumSpans)
              )
                continue;
              if (base.openings.length || preservedWindows.length) {
                const c = openingContext({
                  ...base,
                  interior: { partitions: walls, rooms: [] },
                });
                validateOpenings(c, [...base.openings, ...preservedWindows]);
                if (swingWarnings(c, base.openings).size) continue;
              }
              const match = assignment(result.regions, wants, config, context);
              if (!match) continue;
              next.push({
                walls,
                regions: result.regions,
                cost: match.cost + rand() * 0.00005,
              });
            } catch {
              /* A cut must pass the existing exact validators. */
            }
          }
      next.sort(
        (a, b) =>
          a.cost - b.cost ||
          partitionKey(a.walls).localeCompare(partitionKey(b.walls)),
      );
      beam = next.slice(0, wants.length > 5 ? 6 : 16);
      if (!beam.length) break;
    }
    const valid: LayoutProposal[] = [];
    for (const state of beam) {
      if (state.regions.length !== wants.length) continue;
      const match = assignment(state.regions, wants, config, context);
      if (!match) continue;
      try {
        const rooms = state.regions.map((r, i) => {
          const index = Math.log2(match.groups[i]),
            want = wants[index];
          return {
            id: `${namespace}-room-${hashSeed(r.key).toString(16)}`,
            regionKey: r.key,
            name: want.name,
            type: want.type,
            notes: want.notes || "",
          };
        });
        let building: Building = {
          ...base,
          interior: { partitions: state.walls, rooms },
        };
        building = connectRooms(building, namespace, doorBudget);
        validateProject({ ...project, building });
        const c = openingContext(building),
          access = circulation(c, building.openings);
        if (access.reachable.size !== rooms.length) continue;
        const assigned = state.regions.reduce((n, r) => n + r.area, 0),
          thresholds = building.openings
            .filter((o) => o.host.kind === "partition")
            .reduce((n, o) => n + o.width * 100, 0),
          omitted = all.filter((w) => !wants.includes(w)).map((w) => w.name);
        const adjacencyPenalty = [...access.graph].reduce(
          (n, [key, neighbours]) =>
            n +
            (rooms.find((r) => r.regionKey === key)?.type === "Bedroom" &&
            [...neighbours].some(
              (k) => rooms.find((r) => r.regionKey === k)?.type === "Kitchen",
            )
              ? 5
              : 0) +
            (rooms.find((r) => r.regionKey === key)?.type === "Bedroom" &&
            (neighbours.size > 1 ||
              (access.entrances.has(key) && neighbours.size > 0))
              ? 25
              : 0),
          0,
        );
        const entryPenalty = [...access.entrances].reduce((n, key) => {
          const type = rooms.find((r) => r.regionKey === key)?.type;
          return (
            n +
            (type === "Main Hall" || type === "Corridor" || type === "Workshop"
              ? 0
              : type === "Kitchen"
                ? 5
                : type === "Bedroom" || type === "Bathroom"
                  ? 20
                  : 10)
          );
        }, 0);
        valid.push({
          label: "",
          building,
          score:
            Math.round(
              (1000 -
                match.cost * 600 -
                (thresholds / usable) * 100 -
                adjacencyPenalty -
                entryPenalty -
                omitted.length * 100) *
                100,
            ) / 100,
          usableArea: usable,
          assignedArea: assigned,
          unassignedArea: 0,
          thresholdArea: thresholds,
          omitted,
          requiredSatisfied: required.length,
          preferences: rooms.flatMap((room, i) => {
            const want = wants[Math.log2(match.groups[i])];
            return state.regions[i].area < want.preferredArea * 1e6
              ? [
                  `${room.name}: ${(state.regions[i].area / 1e6).toFixed(2)} m², below preferred ${want.preferredArea.toFixed(2)} m²`,
                ]
              : [];
          }),
          summary: `${config.purpose || "Custom"} · ${rooms.length} ground-floor rooms · all reachable. Primary rooms favour the main section; private rooms favour leaf routes.`,
        });
      } catch (e) {
        lastReason = (e as Error).message;
      }
    }
    for (const candidate of valid) {
      const access = circulation(
        openingContext(candidate.building),
        candidate.building.openings,
      );
      for (const key of access.entrances) {
        const room = candidate.building.interior.rooms.find(
          (r) => r.regionKey === key,
        )!;
        if (!["Main Hall", "Workshop", "Corridor"].includes(room.type))
          candidate.preferences.push(
            `Entrance reaches ${room.name}; compare alternatives for a public arrival space. Existing exterior openings are preserved.`,
          );
      }
      for (const room of candidate.building.interior.rooms)
        if (
          room.type === "Bedroom" &&
          ((access.graph.get(room.regionKey!)?.size ?? 0) > 1 ||
            (access.entrances.has(room.regionKey!) &&
              (access.graph.get(room.regionKey!)?.size ?? 0) > 0))
        )
          candidate.preferences.push(
            `${room.name}: this proposal uses the chamber as a through-route; compare alternatives for more privacy.`,
          );
    }
    valid.sort(
      (a, b) =>
        b.score - a.score ||
        partitionKey(a.building.interior.partitions).localeCompare(
          partitionKey(b.building.interior.partitions),
        ),
    );
    const proposals: LayoutProposal[] = [];
    for (const candidate of valid) {
      if (
        proposals.every((p) =>
          meaningful(
            p.building.interior.partitions,
            candidate.building.interior.partitions,
          ),
        )
      )
        proposals.push({
          ...candidate,
          label: String.fromCharCode(65 + proposals.length),
        });
      if (proposals.length === 3) break;
    }
    if (proposals.length)
      return {
        proposals,
        evaluations,
        doorEvaluations: doorBudget.used,
        assignmentOperations: context.operations,
        messages: [
          ...(proposals.length < 3
            ? [
                `Found ${proposals.length} geometrically distinct valid proposal(s); fewer than 3 passed the bounded search.`,
              ]
            : []),
          ...(proposals[0].omitted.length
            ? [
                `Preferred rooms not accommodated: ${proposals[0].omitted.join(", ")}.`,
              ]
            : []),
        ],
      };
  }
  return {
    proposals: [],
    evaluations,
    doorEvaluations: doorBudget.used,
    assignmentOperations: context.operations,
    messages: [
      `No valid layout found within ${evaluations} exact cut evaluations (limit ${SEARCH_LIMIT}) and ${context.operations} feasible assignments (limit ${ASSIGNMENT_LIMIT}). ${lastReason} Required rooms were not omitted; the original project is unchanged. Try smaller minimum areas, fewer rooms or another seed. This bounded solver does not prove that all possible layouts are infeasible.`,
    ],
  };
}

/** Recheck the reviewable result against the live project before its one history
 * transaction. Generation has no authority to replace structural geometry. */
export function acceptGeneratedLayout(
  project: Project,
  proposal: LayoutProposal,
): Project {
  if (project.building.sections.some((s) => s.locked))
    throw new Error(
      "Unlock protected architectural sections before accepting a generated layout.",
    );
  const structure = (b: Building) =>
    JSON.stringify({ ...b, interior: undefined, openings: undefined });
  if (structure(project.building) !== structure(proposal.building))
    throw new Error(
      "The footprint changed. Generate new proposals for the current building.",
    );
  const old = project.building.openings.filter(
      (o) => o.host.kind === "exterior",
    ),
    next = proposal.building.openings.filter((o) => o.host.kind === "exterior");
  if (old.length && JSON.stringify(old) !== JSON.stringify(next))
    throw new Error(
      "Existing exterior entrances must be preserved unchanged. Generate a compatible layout.",
    );
  const result = validateProject({
      ...project,
      building: structuredClone(proposal.building),
    }),
    c = openingContext(result.building);
  if (
    circulation(c, result.building.openings).unreachable.length ||
    swingWarnings(c, result.building.openings).size
  )
    throw new Error(
      "The proposed layout has inaccessible rooms or an obstructed swing.",
    );
  return result;
}
