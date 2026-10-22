import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProject, duplicateProject } from "./model";
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
} from "./storage";
describe("IndexedDB project persistence", () => {
  beforeEach(async () => {
    const { projects } = await listProjects();
    for (const p of projects) await deleteProject(p.id);
  });
  it("retains two independent projects through reads and mutations", async () => {
    const a = createProject("Longhouse"),
      b = duplicateProject(a, "Castle");
    b.building.sections[0].length = 21000;
    await saveProject(a);
    await saveProject(b);
    const first = await loadProject(a.id),
      second = await loadProject(b.id);
    expect(first.building.sections[0].length).toBe(12000);
    expect(second.building.sections[0].length).toBe(21000);
    first.building.sections[0].length = 18000;
    expect((await loadProject(a.id)).building.sections[0].length).toBe(12000);
    first.name = "Renamed";
    await saveProject(first);
    expect((await loadProject(a.id)).name).toBe("Renamed");
    expect((await listProjects()).projects).toHaveLength(2);
    await deleteProject(a.id);
    expect((await listProjects()).projects.map((p) => p.id)).toEqual([b.id]);
  });
  it("rejects invalid writes and never replaces a valid project", async () => {
    const p = createProject("Keep this");
    await saveProject(p);
    const bad = structuredClone(p);
    bad.building.sections[0].length = 0;
    await expect(saveProject(bad)).rejects.toThrow();
    expect(await loadProject(p.id)).toEqual(p);
    await expect(loadProject("missing")).rejects.toThrow(/no longer exists/);
  });
});
