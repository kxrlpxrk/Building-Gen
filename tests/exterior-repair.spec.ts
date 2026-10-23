import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { createProject, serializeProject, type Project } from "../src/model";
import {
  generateBuildings,
  defaultBuildingConfig,
} from "../src/buildingGenerator";
import { applyPreset } from "../src/footprint";
import { attachmentPreview } from "../src/attachments";
import { changePartitions } from "../src/interiorBuilding";
import { openingContext } from "../src/assembly";
async function records(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction("projects"),
        r = tx.objectStore("projects").getAll();
      tx.oncomplete = () => resolve(r.result);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return data;
  });
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function open(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "building.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await saved(page);
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".exterior-viewport")
          .getAttribute("data-render-count"),
      ),
    )
    .toBeGreaterThan(0);
}
async function point(page: Page, x: number, y: number, z: number) {
  const v = page.locator(".exterior-viewport");
  await v.scrollIntoViewIfNeeded();
  const r = (await v.boundingBox())!,
    a = (await v.getAttribute("data-camera"))!.split(",").map(Number);
  const c = new PerspectiveCamera(42, r.width / r.height, 0.1, 2000);
  c.position.set(a[0], a[1], a[2]);
  c.lookAt(new Vector3(a[3], a[4], a[5]));
  c.zoom = a[6];
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  const p = new Vector3(x / 1000, z / 1000, -y / 1000).project(c);
  return {
    x: r.x + ((p.x + 1) * r.width) / 2,
    y: r.y + ((1 - p.y) * r.height) / 2,
  };
}
async function drag(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 15 });
  await page.mouse.up();
}
const toolbar = (page: Page) => page.locator(".window-toolbar");

test("direct wall placement, live invalid feedback, cancel, drag transactions and another wall preserve rooms", async ({
  page,
}) => {
  test.setTimeout(60000);
  const p = createProject("Visual windows");
  p.building = changePartitions(p.building, [
    {
      id: "partition",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  p.building.interior.rooms = openingContext(p.building).regions.map(
    (r, i) => ({
      id: `room${i}`,
      regionKey: r.key,
      name: `Keep room ${i}`,
      type: "Bedroom",
      notes: "Retain notes",
    }),
  );
  await open(page, p);
  const original = (await records(page))[0],
    v = page.locator(".exterior-viewport");
  await toolbar(page)
    .getByRole("button", { name: "Place Window", exact: true })
    .click();
  let a = await point(page, 3000, 0, 1500);
  await page.mouse.click(a.x, a.y);
  await expect(v).toHaveAttribute("data-window-preview", "valid");
  let b = await point(page, 4000, 0, 2000);
  await drag(page, a, b);
  await expect(page.getByLabel("Window sill", { exact: true })).toHaveValue(
    "1.5",
  );
  expect((await records(page))[0]).toEqual(original);
  await toolbar(page).getByRole("button", { name: "Cancel placement" }).click();
  await expect(v).toHaveAttribute("data-window-preview", "none");
  expect((await records(page))[0]).toEqual(original);
  await toolbar(page)
    .getByRole("button", { name: "Place Window", exact: true })
    .click();
  a = await point(page, 3000, 0, 1500);
  await page.mouse.click(a.x, a.y);
  await toolbar(page)
    .getByRole("button", { name: "Confirm placement" })
    .click();
  await saved(page);
  const added = (await records(page))[0];
  expect(added.building.sections[0].exterior.windows[0]).toMatchObject({
    offset: 3000,
    sill: 1000,
  });
  // An ordinary orbit starting on a window must never edit it.
  const camera = await v.getAttribute("data-camera");
  a = await point(page, 3000, 0, 1500);
  await drag(page, a, { x: a.x + 25, y: a.y - 8 });
  await expect.poll(() => v.getAttribute("data-camera")).not.toBe(camera);
  expect((await records(page))[0]).toEqual(added);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  a = await point(page, 3000, 0, 1500);
  await page.mouse.click(a.x, a.y);
  await toolbar(page)
    .getByRole("button", { name: "Move Window", exact: true })
    .click();
  a = await point(page, 3000, 0, 1500);
  b = await point(page, 4500, 0, 2000);
  await drag(page, a, b);
  await saved(page);
  const moved = (await records(page))[0];
  expect(moved.building.sections[0].exterior.windows[0]).toMatchObject({
    offset: 4500,
    sill: 1500,
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect(
    (await records(page))[0].building.sections[0].exterior.windows,
  ).toEqual(added.building.sections[0].exterior.windows);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  await toolbar(page)
    .getByRole("button", { name: "Move Window", exact: true })
    .click();
  a = await point(page, 4500, 0, 2000);
  b = await point(page, 6000, 0, 1500);
  await drag(page, a, b);
  await expect(v).toHaveAttribute("data-window-preview", "invalid");
  await expect(
    toolbar(page).getByRole("button", { name: "Confirm placement" }),
  ).toBeDisabled();
  expect((await records(page))[0].building).toEqual(moved.building);
  await toolbar(page).getByRole("button", { name: "Cancel placement" }).click();
  await toolbar(page)
    .getByRole("button", { name: "Move Window", exact: true })
    .click();
  a = await point(page, 4500, 0, 2000);
  b = await point(page, 12000, 4000, 1500);
  await drag(page, a, b);
  await saved(page);
  const final = (await records(page))[0];
  expect(final.building.sections[0].exterior.windows[0]).toMatchObject({
    edge: 1,
    offset: 4000,
    sill: 1000,
  });
  expect(final.building.interior).toEqual(original.building.interior);
  expect(final.building.openings).toEqual(original.building.openings);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("native two-finger handoff cancels window dragging and retains orbit/pinch", async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile || browserName !== "chromium",
    "Native Chromium multi-touch fixture",
  );
  await open(page, createProject());
  const v = page.locator(".exterior-viewport"),
    old = await records(page);
  await toolbar(page)
    .getByRole("button", { name: "Place Window", exact: true })
    .click();
  const a = await point(page, 4000, 0, 1500),
    session = await page.context().newCDPSession(page);
  const touch = (id: number, x: number, y: number) => ({
    id,
    x,
    y,
    radiusX: 5,
    radiusY: 5,
    force: 1,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, a.x, a.y)],
  });
  await expect(v).toHaveAttribute("data-window-preview", "valid");
  const camera = await v.getAttribute("data-camera");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, a.x, a.y), touch(2, a.x + 35, a.y - 25)],
  });
  for (let i = 1; i <= 5; i++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        touch(1, a.x - i * 5, a.y + i * 3),
        touch(2, a.x + 35 + i * 5, a.y - 25 - i * 3),
      ],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(v).toHaveAttribute("data-window-preview", "waiting");
  await expect.poll(() => v.getAttribute("data-camera")).not.toBe(camera);
  expect(await records(page)).toEqual(old);
  await session.detach();
});

test("local roof direction controls persist and undo independently of footprint geometry", async ({
  page,
}) => {
  const p = createProject("Direction fixture");
  await open(page, p);
  const before = (await records(page))[0];
  await page.getByLabel("Ridge direction", { exact: true }).selectOption("Y");
  await saved(page);
  const changed = (await records(page))[0];
  expect(changed.building.sections[0].exterior.ridgeAxis).toBe("Y");
  expect(changed.building.sections[0].length).toBe(
    before.building.sections[0].length,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  await expect(page.getByLabel("Ridge direction", { exact: true })).toHaveValue(
    "X",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByLabel("Roof style", { exact: true }).selectOption("Hip");
  await expect(page.getByLabel("Ridge direction", { exact: true })).toHaveValue(
    "Y",
  );
  await page.getByLabel("Roof style", { exact: true }).selectOption("Shed");
  for (const edge of ["+X", "-X", "+Y", "-Y"])
    await page.getByLabel("Shed high edge", { exact: true }).selectOption(edge);
  await saved(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Direction fixture", exact: true })
    .click();
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(page.getByLabel("Shed high edge", { exact: true })).toHaveValue(
    "-Y",
  );
});

test("closed roof junction screenshot fixtures from four sides, including mixed styles and perpendicular wings", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const wing = createProject("Perpendicular wing"),
    r = attachmentPreview(wing.building, {
      id: "wing",
      name: "Wing",
      type: "Residential Wing",
      length: 4000,
      width: 6000,
      shape: "Rectangle",
      edge: 0,
      offset: 4000,
    });
  wing.building = r.building!;
  const long = generateBuildings({ ...defaultBuildingConfig(), extensions: 3 })
    .proposals[0].project;
  const shapes = (["L-shape", "T-shape"] as const).map((shape) => {
    const p = createProject(shape);
    p.building.sections[0] = applyPreset(p.building.sections[0], shape);
    return p;
  });
  const equal = structuredClone(wing);
  equal.id = "equal-project";
  equal.name = "Equal roofs";
  equal.building.sections.forEach((s) => (s.exterior.wallHeight = 3800));
  const mixed = structuredClone(long);
  mixed.id = "mixed-project";
  mixed.name = "Mixed roofs";
  mixed.building.sections.forEach((s, i) => {
    s.exterior.roofStyle = (["Gable", "Hip", "Shed"] as const)[i % 3];
    s.exterior.detailLevel = "High";
  });
  for (const [index, p] of [long, ...shapes, wing, equal, mixed].entries()) {
    await open(page, p);
    const v = page.locator(".exterior-viewport");
    await v.scrollIntoViewIfNeeded();
    const r = (await v.boundingBox())!;
    for (let angle = 0; angle < 4; angle++) {
      await expect(v).toHaveAttribute("data-render-status", "ready");
      const path = info.outputPath(`junction-${index}-angle-${angle}.png`);
      await page.locator(".exterior-wrap").screenshot({ path });
      await info.attach(`junction-${index}-angle-${angle}`, {
        path,
        contentType: "image/png",
      });
      await drag(
        page,
        { x: r.x + r.width * 0.45, y: r.y + r.height * 0.45 },
        { x: r.x + r.width * 0.45 + r.height * 0.25, y: r.y + r.height * 0.45 },
      );
    }
  }
});
