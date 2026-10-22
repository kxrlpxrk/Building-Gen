import { test, expect, type Page } from "@playwright/test";
import legacyV2 from "./fixtures/bg02a-project.json" with { type: "json" };
import type { Project } from "../src/model";
async function create(page: Page, name = "Wing hall") {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await expect(page.getByRole("application")).toBeVisible();
}
async function exact(page: Page, name: string, value: string) {
  const field = page.getByRole("textbox", { name, exact: true });
  await field.fill(value);
  await field.press("Enter");
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function records(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction("projects"),
        r = tx.objectStore("projects").getAll();
      tx.oncomplete = () => resolve(r.result);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return result;
  });
}
async function add(page: Page) {
  await page
    .getByRole("button", { name: "Attach Extension", exact: true })
    .click();
  await expect(
    page.getByText("Valid attachment", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("[data-placement-preview]")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Accept extension", exact: true })
    .click();
}
async function back(page: Page) {
  await page.getByRole("button", { name: "Back to project library" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent projects" }),
  ).toBeVisible();
}
test("preview, attach, edit, lock, duplicate, remove, rotate and roundtrip a connected building", async ({
  page,
}) => {
  await create(page);
  await saved(page);
  await page
    .getByRole("button", { name: "Attach Extension", exact: true })
    .click();
  expect((await records(page))[0].building.sections).toHaveLength(1);
  await exact(page, "Along-edge offset", "12");
  await expect(
    page.getByRole("button", { name: "Accept extension", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(
    /Corner|connected|contact/,
  );
  await exact(page, "Along-edge offset", "0");
  await expect(
    page.getByText("Valid attachment", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Accept extension", exact: true })
    .click();
  await expect(
    page.getByText("Exterior area", { exact: true }).locator(".."),
  ).toContainText("120");
  await expect(page.locator("[data-combined-wall] path")).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("6");
  await expect(
    page.getByRole("textbox", { name: "Width", exact: true }),
  ).toHaveValue("4");
  await exact(page, "Section name", "Workshop A");
  await page
    .getByLabel("Section type", { exact: true })
    .selectOption("Workshop");
  await exact(page, "Position Y", "-1");
  await expect(page.getByRole("alert")).toContainText(/connected|contact/);
  await exact(page, "Position Y", "0");
  await exact(page, "Position X", "7");
  await exact(page, "Length", "5");
  await expect(
    page.getByText("Exterior area", { exact: true }).locator(".."),
  ).toContainText("116");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("6");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await exact(page, "Length", "6");
  await page.getByRole("button", { name: "Lock section", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toBeDisabled();
  await saved(page);
  let p = (await records(page))[0];
  const child = p.building.sections[1],
    mainId = p.building.mainSectionId;
  await page
    .getByLabel("Selected section", { exact: true })
    .selectOption(mainId);
  await exact(page, "Length", "13");
  await exact(page, "Wall thickness", "0.3");
  await expect(page.getByRole("alert")).toContainText("locked");
  await exact(page, "Wall thickness", "0.2");
  await saved(page);
  expect((await records(page))[0].building.sections[1]).toEqual(child);
  await exact(page, "Building rotation", "37.5");
  await saved(page);
  p = (await records(page))[0];
  expect(p.building.frame.rotation).toBe(37.5);
  expect(p.building.sections[1]).toEqual(child);
  await page
    .getByLabel("Selected section", { exact: true })
    .selectOption(child.id);
  await page
    .getByRole("button", { name: "Unlock section", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Duplicate section", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept extension", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Accept extension", exact: true })
    .click();
  await saved(page);
  expect((await records(page))[0].building.sections).toHaveLength(3);
  await page
    .getByRole("button", { name: "Remove section", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove section", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm remove section", exact: true })
    .click();
  await saved(page);
  expect((await records(page))[0].building.sections).toHaveLength(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect((await records(page))[0].building.sections).toHaveLength(3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  const before = (await records(page))[0],
    downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const file = await (await downloadEvent).path();
  await back(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Wing hall", exact: true })
    .click();
  await saved(page);
  expect((await records(page))[0]).toEqual(before);
  await back(page);
  await page.getByLabel("Import project JSON file").setInputFiles(file!);
  await expect(page.getByRole("application")).toBeVisible();
  await saved(page);
  const all = await records(page);
  expect(all).toHaveLength(2);
  const imported = all.find((p) => p.id !== before.id)!;
  expect(imported.building.sections).toHaveLength(2);
  expect(imported.building.frame).toEqual(before.building.frame);
  expect(imported.building.sections.map((s) => ({ ...s, id: "" }))).toEqual(
    before.building.sections.map((s) => ({ ...s, id: "" })),
  );
  expect(imported.building.connections).toHaveLength(1);
  expect(
    imported.building.connections.every(
      (c) =>
        imported.building.sections.some((s) => s.id === c.a.sectionId) &&
        imported.building.sections.some((s) => s.id === c.b.sectionId),
    ),
  ).toBe(true);
});
test("migrates a BG-02A polygon, attaches to its rotated edge and preserves all legacy geometry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Every great hall starts with a line."),
  ).toBeVisible();
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "legacy-v2.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacyV2)),
  });
  await expect(
    page.getByRole("textbox", { name: "Orientation", exact: true }),
  ).toHaveValue("37.5");
  await add(page);
  await expect(
    page.getByText("Exterior area", { exact: true }).locator(".."),
  ).toContainText("108");
  await exact(page, "Building rotation", "23.125");
  await saved(page);
  const p = (await records(page))[0];
  expect(p.schemaVersion).toBe(3);
  expect(p.building.sections[0]).toMatchObject(legacyV2.building.sections[0]);
  expect(p.building.sections[0].id).toBe(legacyV2.building.sections[0].id);
  expect(p.building.connections).toHaveLength(1);
  expect(p.building.frame.rotation).toBe(23.125);
  await back(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open BG-02A legacy L", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Building rotation", exact: true }),
  ).toHaveValue("23.125");
});
test("touch regions select the adjoining section, and mobile controls do not overflow", async ({
  page,
}) => {
  await create(page, "Touch assembly");
  await add(page);
  await saved(page);
  let p = (await records(page))[0];
  const main = p.building.sections[0],
    child = p.building.sections[1];
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  // A point just inside the main building, inside the wing handle's 44 px region,
  // must select the main building rather than accidentally resizing the wing.
  const group = page.locator(`[data-section-id="${main.id}"]`);
  const point = await group.evaluate((node) => {
    const p = new DOMPoint(3000, 100).matrixTransform(
      (node as SVGGraphicsElement).getScreenCTM()!,
    );
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(
    page.getByLabel("Selected section", { exact: true }),
  ).toHaveValue(main.id);
  await page
    .getByLabel("Selected section", { exact: true })
    .selectOption(child.id);
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  const body = page.locator(`[data-section-id="${child.id}"] rect`).first(),
    box = await body.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y, { steps: 5 });
  await page.mouse.up();
  await saved(page);
  p = (await records(page))[0];
  expect(p.building.sections[1].position.x).not.toBe(child.position.x);
  expect(p.building.connections).toHaveLength(1);
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page
    .getByRole("button", { name: "Attach Extension", exact: true })
    .click();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const canvas = await page.getByRole("application").boundingBox();
    expect(canvas!.height).toBeGreaterThan(120);
    await expect(
      page.getByRole("button", { name: "Fit", exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Cancel attachment", exact: true })
    .click();
});
test("native multi-touch leaves all section geometry and attachments unchanged", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native multi-touch uses Chromium mobile CDP.",
  );
  await create(page, "Pinch wings");
  await add(page);
  await saved(page);
  const before = (await records(page))[0];
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  const canvas = page.getByRole("application"),
    box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const client = await page.context().newCDPSession(page),
    x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2,
    touch = (id: number, px: number, py: number) => ({
      id,
      x: px,
      y: py,
      radiusX: 3,
      radiusY: 3,
    });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, x - 30, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, x - 30, y), touch(2, x + 30, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x - 70, y + 20), touch(2, x + 70, y + 20)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touch(1, x - 70, y + 20)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x - 100, y + 40)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect((await records(page))[0]).toEqual(before);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect((await records(page))[0].building.sections).toHaveLength(1);
  await client.detach();
});
