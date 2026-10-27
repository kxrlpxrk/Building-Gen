import { it, expect } from "vitest";
import baseline from "../docs/layout-quality/baseline.json";
import type { Project } from "./model";
import { validateProject } from "./model";
import {
  generateLayouts,
  SEARCH_LIMIT,
  DOOR_TRIAL_LIMIT,
  ASSIGNMENT_LIMIT,
  type LayoutConfig,
} from "./layoutGenerator";
import {
  assessLayout,
  privateRoom,
  privateThroughRoutes,
  roomShape,
  sectionShare,
  distances,
  unusableRoom,
} from "./layoutQuality";
import { canonicalVertices, openingContext } from "./assembly";
import { circulation } from "./circulation";
import { deriveInterior, type RoomRecord } from "./interior";
import { openingAreas, swingWarnings } from "./openings";

it.each(baseline)(
  "measurably improves $purpose without losing room constraints or exterior architecture",
  (f) => {
    const project = f.project as Project,
      config = f.config as LayoutConfig,
      original = structuredClone(project),
      result = generateLayouts(project, config),
      before = assessLayout(f.before.building as Project["building"], config);
    expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(
      0,
    );
    expect(result.proposals.length).toBeLessThanOrEqual(3);
    expect(result.evaluations).toBeLessThanOrEqual(SEARCH_LIMIT);
    expect(result.doorEvaluations).toBeLessThanOrEqual(DOOR_TRIAL_LIMIT);
    expect(result.assignmentOperations).toBeLessThanOrEqual(ASSIGNMENT_LIMIT);
    expect(result.proposals[0].quality.score).toBeGreaterThan(before.score);
    const topology = new Set<string>();
    for (const p of result.proposals) {
      validateProject({ ...project, building: p.building });
      expect({
        ...p.building,
        interior: project.building.interior,
        openings: project.building.openings,
      }).toEqual(project.building);
      const c = openingContext(p.building),
        access = circulation(c, p.building.openings),
        areas = openingAreas(c, p.building.openings);
      expect(access.unreachable).toEqual([]);
      expect(
        privateThroughRoutes(
          access.graph,
          access.entrances,
          p.building.interior.rooms,
        ),
      ).toEqual([]);
      expect(swingWarnings(c, p.building.openings).size).toBe(0);
      expect(p.assignedArea + areas.physicalPartitions + areas.thresholds).toBe(
        p.usableArea,
      );
      expect(p.quality.score).toBeGreaterThanOrEqual(65);
      topology.add(
        JSON.stringify(p.building.interior.partitions.map((w) => [w.a, w.b])),
      );
      const primary = p.building.interior.rooms.find(
        (r) => r.type === (f.purpose === "Workshop" ? "Workshop" : "Main Hall"),
      )!;
      if (
        ["Viking Longhouse", "Workshop", "Trading Hall"].includes(f.purpose)
      ) {
        const r = c.regions.find((r) => r.key === primary.regionKey)!;
        expect(r.area).toBeGreaterThanOrEqual(
          Math.max(
            ...c.regions.filter((t) => t.key !== r.key).map((t) => t.area),
          ) * 1.5,
        );
        expect(
          sectionShare(
            r,
            canonicalVertices(
              p.building.sections.find(
                (s) => s.id === p.building.mainSectionId,
              )!,
              p.building,
            ),
          ),
        ).toBeGreaterThan(0.7);
        expect(roomShape(r).coreRatio).toBeGreaterThan(0.7);
      }
      for (const room of p.building.interior.rooms) {
        const r = c.regions.find((r) => r.key === room.regionKey)!,
          request = config.rooms.find(
            (w) =>
              w.type === room.type &&
              (room.name === (w.name || w.type) ||
                room.name.startsWith((w.name || w.type) + " ")),
          )!;
        expect(r.area).toBeGreaterThanOrEqual(request.minimumArea * 1e6);
        expect(unusableRoom(r, room.type)).toBe(false);
        if (
          room.type === "Bedroom" &&
          ![...access.graph.get(room.regionKey!)!].some((k) =>
            ["Main Hall", "Corridor", "Dining"].includes(
              p.building.interior.rooms.find((r) => r.regionKey === k)!.type,
            ),
          )
        )
          expect(p.quality.warnings).toContain(
            `${room.name} is entered from a work/service room rather than a hall.`,
          );
      }
      // Every displayed direct service relationship must be a real physical opening.
      for (const a of p.building.interior.rooms)
        for (const b of p.building.interior.rooms) {
          if (
            p.quality.strengths.includes(
              `${a.name} ↔ ${b.name}: direct validated doorway/passage.`,
            )
          )
            expect(access.graph.get(a.regionKey!)!.has(b.regionKey!)).toBe(
              true,
            );
        }
    }
    expect(topology.size).toBe(result.proposals.length);
    const best = result.proposals[0],
      c = openingContext(best.building),
      a = circulation(c, best.building.openings),
      rooms = best.building.interior.rooms,
      store = rooms.find((r) => r.type === "Storage")!,
      work = rooms.find(
        (r) => r.type === (f.purpose === "Workshop" ? "Workshop" : "Kitchen"),
      );
    for (const room of rooms.filter((r) => r.type === "Bedroom"))
      expect(
        [...a.graph.get(room.regionKey!)!].some((k) =>
          ["Main Hall", "Corridor", "Dining"].includes(
            rooms.find((r) => r.regionKey === k)!.type,
          ),
        ),
      ).toBe(true);
    if (work && store)
      expect(
        distances(a.graph, work.regionKey!).get(store.regionKey!),
      ).toBeLessThanOrEqual(f.purpose === "Workshop" ? 1 : 2);
    if (f.purpose === "Manor") {
      const kitchen = rooms.find((r) => r.type === "Kitchen")!,
        dining = rooms.find((r) => r.type === "Dining")!;
      expect(
        distances(a.graph, kitchen.regionKey!).get(dining.regionKey!),
      ).toBeLessThanOrEqual(2);
    }
    expect(project).toEqual(original);
  },
  20000,
);

const record = (
  id: string,
  type: RoomRecord["type"],
  name = id,
): RoomRecord => ({ id, regionKey: id, type, name, notes: "" });
it("rejects private articulation routes, while allowing a bedroom with independent alternate public routes", () => {
  const rooms = [
      record("hall", "Main Hall"),
      record("bed", "Bedroom"),
      record("store", "Storage"),
    ],
    graph = new Map([
      ["hall", new Set(["bed"])],
      ["bed", new Set(["hall", "store"])],
      ["store", new Set(["bed"])],
    ]);
  expect(
    privateThroughRoutes(graph, new Set(["hall"]), rooms).map((r) => r.id),
  ).toEqual(["store"]);
  graph.get("hall")!.add("store");
  graph.get("store")!.add("hall");
  expect(privateThroughRoutes(graph, new Set(["hall"]), rooms)).toEqual([]);
});
it("treats named private studies/counting rooms as private but leaves ordinary Custom rooms neutral", () => {
  expect(privateRoom(record("custom", "Custom", "Counting Room"))).toBe(true);
  expect(privateRoom(record("custom", "Custom", "Private Study"))).toBe(true);
  expect(privateRoom(record("custom", "Custom", "Custom 1"))).toBe(false);
});
it("measures the true uninterrupted rectangular core of a concave room instead of its bounding box", () => {
  const region = deriveInterior(
    [
      { x: 0, y: 0 },
      { x: 12000, y: 0 },
      { x: 12000, y: 5000 },
      { x: 8000, y: 5000 },
      { x: 8000, y: 8000 },
      { x: 0, y: 8000 },
    ],
    [],
  ).regions[0];
  expect(region.area).toBe(84000000);
  expect(roomShape(region).coreRatio).toBeCloseTo(64 / 84);
  const thin = deriveInterior(
    [
      { x: 0, y: 0 },
      { x: 20000, y: 0 },
      { x: 20000, y: 1800 },
      { x: 0, y: 1800 },
    ],
    [],
  ).regions[0];
  expect(unusableRoom(thin, "Bedroom")).toBe(true);
  expect(unusableRoom(thin, "Corridor")).toBe(false);
});
it("respects Custom sizes instead of forcing a dominant hall over the user's larger kitchen request", () => {
  const p = baseline[7].project as Project,
    c: LayoutConfig = {
      purpose: "Custom",
      seed: "custom-sizing",
      style: "Balanced",
      rooms: [
        {
          key: "a",
          type: "Main Hall",
          quantity: 1,
          minimumArea: 8,
          preferredArea: 10,
          priority: "Required",
        },
        {
          key: "b",
          type: "Kitchen",
          quantity: 1,
          minimumArea: 45,
          preferredArea: 60,
          priority: "Required",
        },
      ],
    },
    result = generateLayouts(p, c);
  expect(result.proposals.length).toBeGreaterThan(0);
  for (const proposal of result.proposals) {
    const c = openingContext(proposal.building),
      room = proposal.building.interior.rooms.find(
        (r) => r.type === "Kitchen",
      )!;
    expect(
      c.regions.find((r) => r.key === room.regionKey)!.area,
    ).toBeGreaterThanOrEqual(45000000);
    expect(
      proposal.quality.strengths.some((s) => s.includes("dominant room")),
    ).toBe(false);
  }
});
