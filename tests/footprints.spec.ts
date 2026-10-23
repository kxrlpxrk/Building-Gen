import { test, expect, type Page } from "@playwright/test";
import legacy from "./fixtures/bg01-project.json" with { type: "json" };
import expectedV5 from "./fixtures/bg01-project-v5.json" with { type: "json" };
async function create(page: Page, name: string) {
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
  const input = page.getByRole("textbox", { name, exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function back(page: Page) {
  await page.getByRole("button", { name: "Back to project library" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent projects" }),
  ).toBeVisible();
}
const outer = (page: Page) =>
  page.locator('[data-building="true"] > path').first();
async function raw(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const records = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const tx = db.transaction("projects");
        const r = tx.objectStore("projects").getAll();
        tx.oncomplete = () => resolve(r.result);
        tx.onabort = () => reject(tx.error);
      },
    );
    db.close();
    return records;
  });
}
test("all presets, exact edges, validation, undo, reload, duplicate and v2 JSON roundtrip", async ({
  page,
}) => {
  await create(page, "Polygon hall");
  await expect(page.getByText("BG-04B", { exact: true })).toBeVisible();
  for (const shape of [
    "L-shape",
    "T-shape",
    "U-shape",
    "Cross",
    "Irregular",
    "Rectangle",
    "L-shape",
  ]) {
    await page
      .getByLabel("Footprint Shape", { exact: true })
      .selectOption(shape);
    await expect(
      page.getByLabel("Footprint Shape", { exact: true }),
    ).toHaveValue(shape);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await expect(
    page.getByText("Exterior area", { exact: true }).locator(".."),
  ).toContainText("84");
  await expect(
    page.getByText("Usable interior", { exact: true }).locator(".."),
  ).toContainText("76.16");
  const original = await outer(page).getAttribute("d");
  for (const grid of ["250", "500", "1000", "2000", "free"]) {
    await page.getByLabel("Grid spacing").selectOption(grid);
    expect(await outer(page).getAttribute("d")).toBe(original);
  }
  await page.getByLabel("Select footprint part").selectOption("edge:2");
  await expect(
    page.locator('[data-edge="2"] path[stroke="#c37b1d"]'),
  ).toHaveCount(1);
  await exact(page, "Edge 3 length", "3.251");
  await expect(page.getByLabel("Footprint Shape", { exact: true })).toHaveValue(
    "Irregular",
  );
  await expect(
    page.getByText("Exterior area", { exact: true }).locator(".."),
  ).toContainText("86.247");
  await exact(page, "Edge 3 length", "-2");
  await expect(page.getByRole("alert")).toContainText("at least");
  await exact(page, "Edge 3 length", "3.251");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await outer(page).getAttribute("d")).toBe(original);
  await page.getByLabel("Select footprint part").selectOption("vertex:3");
  await exact(page, "Vertex 4 X", "7");
  await exact(page, "Vertex 4 Y", "4.5");
  await expect(
    page.getByText("Exterior area", { exact: true }).locator(".."),
  ).toContainText("78.5");
  const edited = await outer(page).getAttribute("d");
  await exact(page, "Vertex 4 Y", "-1");
  await expect(page.getByRole("alert")).toContainText("self-intersect");
  expect(await outer(page).getAttribute("d")).toBe(edited);
  await exact(page, "Vertex 4 Y", "4.5");
  await exact(page, "Length", "-12");
  await expect(page.getByRole("alert")).toContainText("between");
  expect(await outer(page).getAttribute("d")).toBe(edited);
  await exact(page, "Length", "12");
  await exact(page, "Wall thickness", "3");
  await expect(page.getByRole("alert")).toContainText("interior");
  expect(await outer(page).getAttribute("d")).toBe(edited);
  await exact(page, "Wall thickness", "0.2");
  await exact(page, "Orientation", "37.5");
  await exact(page, "Position X", "-1.251");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadEvent,
    file = await download.path();
  await back(page);
  await page
    .getByRole("button", { name: "Duplicate Polygon hall", exact: true })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill("Polygon copy");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Polygon copy", exact: true })
    .click();
  await page
    .getByLabel("Footprint Shape", { exact: true })
    .selectOption("Cross");
  await back(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Polygon hall", exact: true })
    .click();
  expect(await outer(page).getAttribute("d")).toBe(edited);
  await expect(
    page.getByRole("textbox", { name: "Orientation", exact: true }),
  ).toHaveValue("37.5");
  await back(page);
  await page.getByLabel("Import project JSON file").setInputFiles(file!);
  expect(await outer(page).getAttribute("d")).toBe(edited);
  await back(page);
  const records = await raw(page);
  expect(records).toHaveLength(3);
  expect(records.every((p) => p.schemaVersion === 5)).toBe(true);
  expect(new Set(records.map((p) => p.id)).size).toBe(3);
});
test("real edge and vertex drags remain orthogonal and undo as whole transactions", async ({
  page,
}) => {
  await create(page, "Drag polygon");
  await page
    .getByLabel("Footprint Shape", { exact: true })
    .selectOption("L-shape");
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const original = await outer(page).getAttribute("d");
  const edge = page.locator('[data-edge="2"] path').first();
  const mid = await edge.evaluate((node) => {
    const path = node as SVGPathElement,
      p = path.getPointAtLength(path.getTotalLength() / 2);
    const q = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
    return { x: q.x, y: q.y };
  });
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y + 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => outer(page).getAttribute("d")).not.toBe(original);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await outer(page).getAttribute("d")).toBe(original);
  const handle = await page.locator('[data-corner="3"] circle').boundingBox();
  expect(handle).toBeTruthy();
  const x = handle!.x + handle!.width / 2,
    y = handle!.y + handle!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 20, y - 15, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => outer(page).getAttribute("d")).not.toBe(original);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await outer(page).getAttribute("d")).toBe(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => outer(page).getAttribute("d")).not.toBe(original);
  const edited = await outer(page).getAttribute("d");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  expect(await outer(page).getAttribute("d")).toBe(edited);
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
  }
});
test("legacy database and JSON migrate without resetting invalid or unsupported records", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Every great hall starts with a line."),
  ).toBeVisible();
  const unsupported = {
    id: "unsupported-keep-me",
    schemaVersion: 999,
    preciousData: "Do not reset",
  };
  await page.evaluate(
    async (records) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("building-generator-bg01", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        for (const r of records) tx.objectStore("projects").put(r);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    [legacy, unsupported],
  );
  await page.reload();
  await expect(
    page.getByText("1 unreadable project record(s)", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open BG-01 legacy hall", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13.247");
  await expect(
    page.getByRole("textbox", { name: "Width", exact: true }),
  ).toHaveValue("8.751");
  await expect(
    page.getByRole("textbox", { name: "Position X", exact: true }),
  ).toHaveValue("-1.251");
  await expect(
    page.getByRole("textbox", { name: "Orientation", exact: true }),
  ).toHaveValue("37.5");
  expect((await raw(page)).find((p) => p.id === legacy.id)).toEqual(legacy);
  await back(page);
  const migrated = (await raw(page)).find((p) => p.id === legacy.id);
  expect(migrated).toEqual(expectedV5);
  expect((await raw(page)).find((p) => p.id === unsupported.id)).toEqual(
    unsupported,
  );
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "bg01.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13.247");
  await back(page);
  const records = await raw(page);
  expect(records).toHaveLength(3);
  expect(records.find((p) => p.id === unsupported.id)).toEqual(unsupported);
});
test("native polygon pinch cancels a vertex drag without changing geometry", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native multi-touch uses Chromium CDP on a mobile profile.",
  );
  await create(page, "Pinch polygon");
  await page
    .getByLabel("Footprint Shape", { exact: true })
    .selectOption("L-shape");
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const scrollBeforePinch = await page.evaluate(() => scrollY);
  const original = await outer(page).getAttribute("d"),
    box = await page.locator('[data-corner="3"] circle').boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2,
    client = await page.context().newCDPSession(page);
  const touch = (id: number, px: number, py: number) => ({
    id,
    x: px,
    y: py,
    radiusX: 3,
    radiusY: 3,
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, x, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x - 20, y - 20)],
  });
  await expect.poll(() => outer(page).getAttribute("d")).not.toBe(original);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, x - 20, y - 20), touch(2, x - 65, y - 20)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x + 5, y), touch(2, x - 100, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touch(1, x + 5, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x + 20, y + 10)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await outer(page).getAttribute("d")).toBe(original);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforePinch);
  // Only the preset transaction exists; one undo must restore the BG-01 rectangle.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(page.getByLabel("Footprint Shape", { exact: true })).toHaveValue(
    "Rectangle",
  );
  await client.detach();
});
