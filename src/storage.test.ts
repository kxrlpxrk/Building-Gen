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

import legacyProject from "../tests/fixtures/bg01-project.json";
import expectedV4 from "../tests/fixtures/bg01-project-v4.json";
import { applyPreset } from "./footprint";
import { validateProject } from "./model";
it("reads BG-01 from the original database and upgrades only when saved", async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("building-generator-bg01", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(legacyProject);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const raw = () =>
    new Promise<unknown>((resolve) => {
      const tx = db.transaction("projects");
      const req = tx.objectStore("projects").get(legacyProject.id);
      tx.oncomplete = () => resolve(req.result);
    });
  const migrated = await loadProject(legacyProject.id);
  expect(migrated).toEqual(expectedV4);
  expect(await raw()).toEqual(legacyProject);
  await saveProject(migrated);
  expect(await raw()).toEqual(migrated);
  db.close();
  await deleteProject(migrated.id);
});
it("persists polygon footprints with independent data after reopening", async () => {
  const p = validateProject(legacyProject);
  p.building.sections = [applyPreset(p.building.sections[0], "U-shape")];
  const copy = duplicateProject(p, "Independent U");
  await saveProject(p);
  await saveProject(copy);
  const a = await loadProject(p.id),
    b = await loadProject(copy.id);
  expect(a).toEqual(p);
  expect(b).toEqual(copy);
  if (b.building.sections[0].kind === "polygon")
    b.building.sections[0].vertices[0].x = 100;
  expect(await loadProject(p.id)).toEqual(p);
  await deleteProject(p.id);
  await deleteProject(copy.id);
});

import legacyV2 from "../tests/fixtures/bg02a-project.json";
import { attachmentPreview } from "./attachments";
it("loads BG-02A from existing IndexedDB without rewriting it or unsupported neighbours", async () => {
  const unsupported = {
    id: "keep-unsupported-storage-test",
    schemaVersion: 900,
    name: "Never reset",
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("building-generator-bg01", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const read = (id: string) =>
    new Promise<unknown>((resolve) => {
      const tx = db.transaction("projects"),
        r = tx.objectStore("projects").get(id);
      tx.oncomplete = () => resolve(r.result);
    });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(legacyV2);
    tx.objectStore("projects").put(unsupported);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const migrated = await loadProject(legacyV2.id);
  expect(migrated).toMatchObject({ ...legacyV2, schemaVersion: 4 });
  expect(await read(legacyV2.id)).toEqual(legacyV2);
  expect((await listProjects()).invalidCount).toBe(1);
  await saveProject(migrated);
  expect(await read(legacyV2.id)).toEqual(migrated);
  expect(await read(unsupported.id)).toEqual(unsupported);
  db.close();
  await deleteProject(legacyV2.id);
  await deleteProject(unsupported.id);
});
it("persists sections and explicit joins and rejects invalid writes without damaging the saved assembly", async () => {
  const p = createProject("Stored assembly"),
    preview = attachmentPreview(p.building, {
      id: crypto.randomUUID(),
      name: "Wing",
      type: "Residential Wing",
      length: 6000,
      width: 4000,
      shape: "Rectangle",
      edge: 0,
      offset: 0,
    });
  expect(preview.error).toBeNull();
  p.building = preview.building!;
  await saveProject(p);
  expect(await loadProject(p.id)).toEqual(p);
  const bad = structuredClone(p);
  bad.building.connections[0].end.x += 1;
  await expect(saveProject(bad)).rejects.toThrow(/Attachment/);
  expect(await loadProject(p.id)).toEqual(p);
  await deleteProject(p.id);
});

import { changePartitions } from "./interiorBuilding";
it("saves and reopens v4 partitions/labels independently and rejects corrupt interiors", async () => {
  const p = createProject("Interior persistence");
  p.building = changePartitions(p.building, [
    {
      id: crypto.randomUUID(),
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  p.building.interior.rooms[0].name = "Hall";
  const copy = duplicateProject(p, "Copied interior");
  await saveProject(p);
  await saveProject(copy);
  expect(await loadProject(p.id)).toEqual(p);
  expect(await loadProject(copy.id)).toEqual(copy);
  const invalid = structuredClone(p);
  invalid.building.interior.partitions[0].a.y = 0;
  await expect(saveProject(invalid)).rejects.toThrow(/protrudes/);
  expect(await loadProject(p.id)).toEqual(p);
  await deleteProject(p.id);
  await deleteProject(copy.id);
});
