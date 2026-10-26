import { it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  createProject,
  validateProject,
  serializeProject,
  parseProject,
  duplicateProject,
} from "./model";
import {
  generateLayouts,
  starterConfig,
  acceptGeneratedLayout,
  SEARCH_LIMIT,
  DOOR_TRIAL_LIMIT,
  ASSIGNMENT_LIMIT,
  minimumSpans,
  type LayoutConfig,
  type LayoutResult,
} from "./layoutGenerator";
import { purposeLayout, LAYOUT_PURPOSES } from "./layoutPurposes";
import { deriveInterior, containsPoint } from "./interior";
import { circulation } from "./circulation";
import { openingAreas, validateOpenings, swingWarnings } from "./openings";
import { saveProject, loadProject } from "./storage";
import { initialHistory, commit, undo, redo } from "./history";
function check(
  p: ReturnType<typeof createProject>,
  c: LayoutConfig,
  r: LayoutResult,
) {
  expect(r.evaluations).toBeLessThanOrEqual(SEARCH_LIMIT);
  expect(r.doorEvaluations).toBeLessThanOrEqual(DOOR_TRIAL_LIMIT);
  expect(r.assignmentOperations).toBeLessThanOrEqual(ASSIGNMENT_LIMIT);
  const requests = c.rooms.flatMap((w) =>
    Array.from({ length: w.quantity }, (_, i) => ({
      ...w,
      name: w.quantity > 1 ? `${w.name || w.type} ${i + 1}` : w.name || w.type,
    })),
  );
  for (const proposal of r.proposals) {
    const b = proposal.building,
      ctx = openingContext(b),
      g = deriveInterior(ctx.inner, b.interior.partitions),
      a = openingAreas(ctx, b.openings);
    expect(g.regions.every(minimumSpans)).toBe(true);
    expect(b.interior.rooms.length).toBeLessThanOrEqual(8);
    expect({
      ...b,
      interior: p.building.interior,
      openings: p.building.openings,
    }).toEqual(p.building);
    const old = p.building.openings.filter((o) => o.host.kind === "exterior");
    if (old.length)
      expect(b.openings.filter((o) => o.host.kind === "exterior")).toEqual(old);
    expect(g.clearArea + a.physicalPartitions + a.thresholds).toBe(
      g.usableArea,
    );
    expect(proposal.assignedArea).toBe(g.clearArea);
    expect(circulation(ctx, b.openings).unreachable).toEqual([]);
    validateOpenings(ctx, b.openings);
    expect(swingWarnings(ctx, b.openings).size).toBe(0);
    for (const room of b.interior.rooms) {
      const want = requests.find((w) => w.name === room.name)!;
      expect(want).toBeTruthy();
      expect(
        g.regions.find((r) => r.key === room.regionKey)!.area,
      ).toBeGreaterThanOrEqual(want.minimumArea * 1e6);
      expect(room.notes).toBe(want.notes || "");
    }
    for (const want of requests.filter((w) => w.priority === "Required"))
      expect(
        b.interior.rooms.some(
          (r) => r.name === want.name && r.type === want.type,
        ),
      ).toBe(true);
    expect(proposal.requiredSatisfied).toBe(
      requests.filter((w) => w.priority === "Required").length,
    );
    validateProject({ ...p, building: b });
  }
}
it.each([2, 3, 4, 5, 6, 7, 8])(
  "capacity %i",
  (n) => {
    const p = createProject();
    p.building.sections[0].length = 18000;
    p.building.sections[0].width = 10000;
    const c = starterConfig();
    c.rooms = [
      {
        key: "rooms",
        type: "Custom",
        quantity: n,
        minimumArea: 8,
        preferredArea: 18,
        priority: "Required",
      },
    ];
    const r = generateLayouts(p, c);
    expect(r.proposals.length).toBeGreaterThan(0);
    check(p, c, r);
  },
  20000,
);
it.each(LAYOUT_PURPOSES)(
  "purpose %s",
  (purpose) => {
    const p = createProject();
    p.building.sections[0].length = 18000;
    p.building.sections[0].width = 10000;
    const c = purposeLayout(purpose, 172);
    const r = generateLayouts(p, c);
    check(p, c, r);
    expect(c.rooms.some((r) => r.type === "Bathroom")).toBe(false);
    if (purpose === "Viking Longhouse" || purpose === "Workshop") {
      const primaryType = purpose === "Workshop" ? "Workshop" : "Main Hall";
      expect(
        r.proposals.some((p) => {
          const ctx = openingContext(p.building),
            primary = p.building.interior.rooms.find(
              (r) => r.type === primaryType,
            )!;
          return (
            ctx.regions.find((r) => r.key === primary.regionKey)!.area >=
            Math.max(
              ...ctx.regions
                .filter((r) => r.key !== primary.regionKey)
                .map((r) => r.area),
            )
          );
        }),
      ).toBe(true);
    }

    expect(r.proposals.length, r.messages.join(" ")).toBeGreaterThan(0);
  },
  20000,
);

import { applyPreset } from "./footprint";
import {
  combinedGeometry,
  openingContext,
  canonicalVertices,
} from "./assembly";
import {
  generateArchitecturalBuildings,
  purposeDefaults,
} from "./architecturalGenerator";
import { advancedExamples } from "../tests/fixtures/advancedArchitecture";
it.each(["L-shape", "T-shape"] as const)(
  "exact %s purpose layout",
  (shape) => {
    const p = createProject();
    p.building.sections[0].length = 18000;
    p.building.sections[0].width = 12000;
    p.building.sections[0] = applyPreset(p.building.sections[0], shape);
    const c = purposeLayout(
      "Viking Longhouse",
      combinedGeometry(p.building).interior,
    );
    const r = generateLayouts(p, c);
    check(p, c, r);
    expect(r.proposals.length, r.messages.join(" ")).toBeGreaterThan(0);
  },
  20000,
);
it.each([
  advancedExamples[2].config,
  {
    ...purposeDefaults("Longhouse"),
    length: 18000,
    width: 8000,
    extensions: 3,
    complexity: "Grand" as const,
    style: "Norse Chieftain's Hall" as const,
    crossGables: "Prominent" as const,
    ornamentation: "Fantasy" as const,
  },
])(
  "generated multi-wing interiors",
  (config) => {
    const p = generateArchitecturalBuildings(config).proposals[0].project;
    const c = purposeLayout(
      "Viking Longhouse",
      combinedGeometry(p.building).interior,
    );
    const original = structuredClone(p);
    const r = generateLayouts(p, c);
    check(p, c, r);
    expect(p).toEqual(original);
    const main = canonicalVertices(p.building.sections[0], p.building);
    expect(
      r.proposals.some((proposal) => {
        const ctx = openingContext(proposal.building),
          hall = proposal.building.interior.rooms.find(
            (r) => r.type === "Main Hall",
          )!;
        return (
          containsPoint(
            main,
            ctx.regions.find((r) => r.key === hall.regionKey)!.label,
          ) &&
          proposal.building.interior.rooms.some(
            (room) =>
              room.type !== "Main Hall" &&
              !containsPoint(
                main,
                ctx.regions.find((r) => r.key === room.regionKey)!.label,
              ),
          )
        );
      }),
    ).toBe(true);
    expect(r.proposals.length, r.messages.join(" ")).toBeGreaterThan(0);
  },
  30000,
);
it("small cottage", () => {
  const p = createProject();
  p.building.sections[0].length = 8000;
  p.building.sections[0].width = 6000;
  const r = generateLayouts(
    p,
    purposeLayout("Medieval Cottage", combinedGeometry(p.building).interior),
  );
  expect(r.proposals.length, r.messages.join(" ")).toBeGreaterThan(0);
});

it("seeded purpose plans vary geometrically, remain editable canonical records, and roundtrip history/storage", async () => {
  const p = createProject();
  p.building.sections[0].length = 18000;
  p.building.sections[0].width = 10000;
  const c = purposeLayout("Manor", 172),
    r = generateLayouts(p, c);
  expect(generateLayouts(p, c)).toEqual(r);
  const other = generateLayouts(p, { ...c, seed: "next-variation" });
  expect(other.proposals.length).toBeGreaterThan(0);
  expect(
    other.proposals.map((p) =>
      p.building.interior.partitions.map((w) => [w.a, w.b]),
    ),
  ).not.toEqual(
    r.proposals.map((p) =>
      p.building.interior.partitions.map((w) => [w.a, w.b]),
    ),
  );
  expect(
    new Set(
      r.proposals.map((p) =>
        JSON.stringify(p.building.interior.partitions.map((w) => [w.a, w.b])),
      ),
    ).size,
  ).toBe(r.proposals.length);
  const accepted = acceptGeneratedLayout(p, r.proposals[0]),
    h = commit(initialHistory(p), accepted);
  expect(undo(h).present).toEqual(p);
  expect(redo(undo(h)).present).toEqual(accepted);
  expect(parseProject(serializeProject(accepted))).toEqual(accepted);
  validateProject(duplicateProject(accepted));
  await saveProject(accepted);
  expect(await loadProject(p.id)).toEqual(accepted);
});
it("omits only Preferred requirements and fails impossible or unsupported requests without mutation", () => {
  const p = createProject(),
    before = structuredClone(p),
    c = starterConfig();
  c.rooms.push({
    key: "optional",
    type: "Custom",
    name: "Optional Suite",
    quantity: 4,
    minimumArea: 100,
    preferredArea: 110,
    priority: "Preferred",
  });
  const r = generateLayouts(p, c);
  check(p, c, r);
  expect(r.proposals.length).toBeGreaterThan(0);
  expect(r.proposals[0].omitted).toHaveLength(4);
  c.rooms[c.rooms.length - 1].priority = "Required";
  expect(() => generateLayouts(p, c)).toThrow(/Required minimum/);
  expect(p).toEqual(before);
  c.rooms[0].quantity = 9;
  expect(() => generateLayouts(p, c)).toThrow(/2–8/);
});

import { roomLabel } from "./roomLabels";
it("keeps purpose labels in actual clear-space intervals without changing regions", () => {
  const p = createProject();
  p.building.sections[0] = applyPreset(p.building.sections[0], "T-shape");
  const regions = deriveInterior(
      combinedGeometry(p.building).inner,
      [],
    ).regions,
    original = structuredClone(regions);
  for (const r of regions) {
    const label = roomLabel(r, "A descriptive private guest chamber", 0.02);
    expect(label.lines.length).toBeLessThanOrEqual(2);
    expect(
      r.cells.some(
        (c) =>
          label.x >= c.x &&
          label.x <= c.x + c.width &&
          label.y >= c.y &&
          label.y <= c.y + c.height,
      ),
    ).toBe(true);
    expect(label.width).toBeGreaterThan(0);
  }
  expect(regions).toEqual(original);
});
it.each(["Compact", "Balanced", "Open"] as const)(
  "supports %s purpose layout style",
  (style) => {
    const p = createProject();
    p.building.sections[0].length = 18000;
    p.building.sections[0].width = 10000;
    const c = { ...purposeLayout("Workshop", 172), style },
      r = generateLayouts(p, c);
    expect(r.proposals.length).toBeGreaterThan(0);
    check(p, c, r);
  },
);
