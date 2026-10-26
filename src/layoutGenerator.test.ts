import { it, expect } from "vitest";
import { createProject } from "./model";
import { generateLayouts, starterConfig } from "./layoutGenerator";
import { applyPreset } from "./footprint";
import { attachmentPreview, EXTENSION_TEMPLATES } from "./attachments";
import { openingContext } from "./assembly";
import { circulation } from "./circulation";
it.each([2, 3, 4, 5])("generates %i valid accessible rooms", (n) => {
  const p = createProject(),
    c = starterConfig();
  if (n < 4) c.rooms = c.rooms.slice(0, n);
  if (n === 5) c.rooms[2].quantity = 2;
  const result = generateLayouts(p, c);
  expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(0);
  for (const proposal of result.proposals) {
    expect(proposal.building.interior.rooms).toHaveLength(n);
    expect(
      circulation(openingContext(proposal.building), proposal.building.openings)
        .unreachable,
    ).toHaveLength(0);
  }
});
it("supports a default L-shaped building", () => {
  const p = createProject();
  p.building.sections[0] = applyPreset(p.building.sections[0], "L-shape");
  const result = generateLayouts(p, starterConfig());
  expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(0);
});
it("supports a connected attached wing", () => {
  const p = createProject(),
    t = EXTENSION_TEMPLATES[0];
  p.building = attachmentPreview(p.building, {
    ...t,
    id: "wing",
    shape: "Rectangle",
    edge: 0,
    offset: 0,
  }).building!;
  const result = generateLayouts(p, starterConfig());
  expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(0);
});

import {
  acceptGeneratedLayout,
  SEARCH_LIMIT,
  DOOR_TRIAL_LIMIT,
  minimumSpans,
  type LayoutProposal,
} from "./layoutGenerator";
import {
  validateProject,
  parseProject,
  serializeProject,
  duplicateProject,
} from "./model";
import { deriveInterior } from "./interior";
import { changeOpenings } from "./openingBuilding";
import {
  newOpening,
  swingWarnings,
  validateOpenings,
  openingAreas,
} from "./openings";
import { initialHistory, commit, undo, redo } from "./history";
it("satisfies every required minimum, exact area conservation and unobstructed circulation", () => {
  const p = createProject(),
    c = starterConfig(),
    result = generateLayouts(p, c);
  expect(result.proposals).toHaveLength(3);
  expect(result.evaluations).toBeLessThanOrEqual(SEARCH_LIMIT);
  expect(result.doorEvaluations).toBeLessThanOrEqual(DOOR_TRIAL_LIMIT);
  for (const candidate of result.proposals) {
    const b = candidate.building,
      context = openingContext(b),
      geometry = deriveInterior(context.inner, b.interior.partitions),
      areas = openingAreas(context, b.openings);
    expect(geometry.regions.every(minimumSpans)).toBe(true);
    expect(
      geometry.clearArea + areas.physicalPartitions + areas.thresholds,
    ).toBe(geometry.usableArea);
    expect(candidate.assignedArea).toBe(geometry.clearArea);
    expect(candidate.unassignedArea).toBe(0);
    for (const room of b.interior.rooms) {
      const r = geometry.regions.find((r) => r.key === room.regionKey)!,
        request = c.rooms.find((r) => r.type === room.type)!;
      expect(r.area).toBeGreaterThanOrEqual(request.minimumArea * 1e6);
    }
    expect(swingWarnings(context, b.openings).size).toBe(0);
    expect(() => validateOpenings(context, b.openings)).not.toThrow();
    expect(validateProject({ ...p, building: b }).building).toEqual(b);
  }
});
it("reproduces complete proposals with the same seed, with distinct geometry across variations", () => {
  const p = createProject(),
    c = starterConfig(),
    first = generateLayouts(p, c),
    same = generateLayouts(p, structuredClone(c)),
    other = generateLayouts(p, { ...c, seed: "another-seed" });
  expect(same).toEqual(first);
  expect(other.proposals.length).toBeGreaterThan(0);
  expect(
    other.proposals.map((p) =>
      p.building.interior.partitions.map((w) => [w.a, w.b]),
    ),
  ).not.toEqual(
    first.proposals.map((p) =>
      p.building.interior.partitions.map((w) => [w.a, w.b]),
    ),
  );
  expect(
    new Set(
      first.proposals.map((p) =>
        JSON.stringify(p.building.interior.partitions.map((w) => [w.a, w.b])),
      ),
    ).size,
  ).toBe(first.proposals.length);
});
it("never mutates source data on successful or failed generation", () => {
  const p = createProject(),
    before = structuredClone(p);
  generateLayouts(p, starterConfig());
  expect(p).toEqual(before);
  const c = starterConfig();
  c.rooms[0].minimumArea = 200;
  c.rooms[0].preferredArea = 200;
  expect(() => generateLayouts(p, c)).toThrow(/Required minimum.*exceeds/);
  expect(p).toEqual(before);
});
it("reports omitted Preferred rooms explicitly and never omits Required rooms", () => {
  const p = createProject(),
    c = starterConfig();
  c.rooms.push({
    key: "huge",
    type: "Workshop",
    quantity: 1,
    minimumArea: 300,
    preferredArea: 400,
    priority: "Preferred",
  });
  const result = generateLayouts(p, c);
  expect(result.proposals.length).toBeGreaterThan(0);
  expect(result.messages.join(" ")).toContain("Workshop");
  expect(
    result.proposals.every(
      (p) =>
        p.omitted.includes("Workshop") &&
        p.building.interior.rooms.length === 4,
    ),
  ).toBe(true);
});
it("explains bounded/no-solution outcomes without fabricating proposals", () => {
  const p = createProject(),
    c = starterConfig();
  p.building.sections[0].length = 4000;
  p.building.sections[0].width = 4000;
  c.rooms = c.rooms
    .slice(0, 2)
    .map((r) => ({ ...r, minimumArea: 6, preferredArea: 7 }));
  const result = generateLayouts(p, c);
  expect(result.proposals).toHaveLength(0);
  expect(result.messages.join(" ")).toContain("original project is unchanged");
  expect(result.evaluations).toBeLessThanOrEqual(SEARCH_LIMIT);
  expect(result.doorEvaluations).toBeLessThanOrEqual(DOOR_TRIAL_LIMIT);
});
it("refuses protected sections and invalid configurations safely", () => {
  const p = createProject();
  p.building.sections[0].locked = true;
  const old = structuredClone(p);
  expect(() => generateLayouts(p, starterConfig())).toThrow(/Unlock/);
  expect(p).toEqual(old);
  expect(() =>
    generateLayouts(createProject(), { ...starterConfig(), seed: "" }),
  ).toThrow(/seed/);
  expect(() =>
    generateLayouts(createProject(), { ...starterConfig(), rooms: [] }),
  ).toThrow(/2–8/);
});
it("preserves existing exterior entrance records while replacing manual interiors", () => {
  const p = createProject();
  p.building = changeOpenings(p.building, [
    newOpening(
      "kept-entrance",
      { kind: "exterior", sectionId: p.building.mainSectionId, edge: 0 },
      3000,
    ),
  ]);
  const result = generateLayouts(p, starterConfig());
  expect(result.proposals.length, result.messages.join(" ")).toBeGreaterThan(0);
  for (const proposal of result.proposals)
    expect(
      proposal.building.openings.filter((o) => o.host.kind === "exterior"),
    ).toEqual(p.building.openings);
});
it("accepts as one complete undoable plan and roundtrips generated editable geometry", () => {
  const p = createProject(),
    proposal = generateLayouts(p, starterConfig()).proposals[0],
    next = acceptGeneratedLayout(p, proposal);
  const h = commit(initialHistory(p), next);
  expect(undo(h).present).toEqual(p);
  expect(redo(undo(h)).present).toEqual(next);
  expect(parseProject(serializeProject(next))).toEqual(next);
  const copy = duplicateProject(next);
  expect(validateProject(copy)).toEqual(copy);
  expect(copy.building.interior.partitions[0].id).not.toBe(
    next.building.interior.partitions[0].id,
  );
  expect(
    copy.building.openings.every(
      (o) => !next.building.openings.some((v) => v.id === o.id),
    ),
  ).toBe(true);
});
it("rejects stale/forged proposals without changing the current project", () => {
  const p = createProject(),
    proposal = generateLayouts(p, starterConfig()).proposals[0],
    moved = structuredClone(p);
  moved.building.sections[0].length = 13000;
  expect(() => acceptGeneratedLayout(moved, proposal)).toThrow(
    /footprint changed/,
  );
  const bad: LayoutProposal = structuredClone(proposal);
  bad.building.openings = [];
  expect(() => acceptGeneratedLayout(p, bad)).toThrow(/inaccessible/);
  expect(p.building.interior.partitions).toEqual([]);
});
