import { test, expect, type Page } from "@playwright/test";
import type { Project } from "../src/model";
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill("Interior hall");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
}
async function localPoint(page: Page, x: number, y: number) {
  await page.getByRole("application").scrollIntoViewIfNeeded();
  return page.locator("[data-interior-layer]").evaluate(
    (el, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(
        (el as SVGGraphicsElement).getScreenCTM()!,
      );
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
}
async function tap(page: Page, x: number, y: number) {
  const p = await localPoint(page, x, y);
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function fullWall(page: Page) {
  await page.getByRole("button", { name: "Draw Wall", exact: true }).click();
  await tap(page, 6000, 200);
  await tap(page, 6000, 7800);
  await expect(page.locator("[data-partition-id]")).toHaveCount(1);
}
async function numeric(page: Page, label: string, value: string) {
  const input = page.getByRole("textbox", { name: label, exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function stored(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction("projects"),
        r = tx.objectStore("projects").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return rows;
  });
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /Saved/ }),
  ).toBeVisible();
}

test("draw, assign rooms, edit exact walls, reject invalid exterior edits, undo and reopen", async ({
  page,
}) => {
  await create(page);
  await expect(page.getByTestId("partition-area")).toHaveText("0.00 m²");
  await fullWall(page);
  await expect(page.getByTestId("partition-area")).toHaveText("0.76 m²");
  await expect(page.locator("[data-room-key]")).toHaveCount(2);
  await page.getByRole("button", { name: "Select Room", exact: true }).click();
  await tap(page, 3000, 4000);
  await expect(page.getByTestId("room-area")).toContainText("43.70");
  const name = page.getByRole("textbox", { name: "Room name", exact: true });
  await name.fill("Hearth Hall");
  await name.press("Tab");
  await expect(page.getByLabel("Room type", { exact: true })).toBeFocused();
  await page.getByLabel("Room type", { exact: true }).selectOption("Main Hall");
  const notes = page.getByLabel("Room notes", { exact: true });
  await notes.fill(
    "A place for feasting" + "\n".repeat(12) + "Further planning notes",
  );
  await expect
    .poll(() => notes.evaluate((el) => el.scrollHeight <= el.clientHeight + 1))
    .toBe(true);
  await notes.fill("A place for feasting");
  await notes.press("Tab");
  await page.getByRole("button", { name: "Select Wall", exact: true }).click();
  await tap(page, 6000, 4000);
  await numeric(page, "Wall start X", "7");
  await expect(page.getByLabel("Wall start X", { exact: true })).toHaveValue(
    "7",
  );
  await numeric(page, "Wall start X", "0");
  await expect(page.getByRole("alert")).toContainText("protrudes");
  await numeric(page, "Wall start X", "7");
  await page.getByRole("button", { name: "Select Room", exact: true }).click();
  await tap(page, 3000, 4000);
  await expect(page.getByLabel("Room name", { exact: true })).toHaveValue(
    "Hearth Hall",
  );
  await expect(page.getByTestId("room-area")).toContainText("51.30");
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await numeric(page, "Width", "7");
  await expect(page.getByRole("alert")).toContainText("Interior plan");
  await numeric(page, "Width", "8");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await page.getByRole("button", { name: "Select Wall", exact: true }).click();
  await tap(page, 6000, 4000);
  await expect(page.getByLabel("Wall start X", { exact: true })).toHaveValue(
    "6",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await numeric(page, "Building X", "1.234");
  await numeric(page, "Building Y", "-5.678");
  await numeric(page, "Interior building rotation", "37.5");
  await saved(page);
  const before = (await stored(page))[0];
  expect(before.schemaVersion).toBe(5);
  expect(before.building.interior.partitions[0].a.x).toBe(7000);
  expect(
    before.building.interior.rooms.some(
      (r) => r.name === "Hearth Hall" && r.notes === "A place for feasting",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to project library" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Open Interior hall", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await expect(page.locator("[data-partition-id]")).toHaveCount(1);
  expect((await stored(page))[0]).toEqual(before);
});

test("wall handles, stable scrolled coordinates, page scrolling, merges, duplication and JSON", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  await fullWall(page);
  await page.getByRole("button", { name: "Select Wall", exact: true }).click();
  await tap(page, 6000, 4000);
  const handle = await page
    .locator('[data-wall-end="1"] circle')
    .first()
    .boundingBox();
  const pixels = await page
    .locator("[data-interior-layer]")
    .evaluate((el) => (el as SVGGraphicsElement).getScreenCTM()!.d * 1000);
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2 - pixels,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(
    page.getByLabel("Partition length", { exact: true }),
  ).toHaveValue("6.8");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 100));
  const start = await page.locator("[data-interior-layer]").evaluate((el) => {
    const m = (el as SVGGraphicsElement).getScreenCTM()!,
      p = new DOMPoint(6000, 4000).matrixTransform(m);
    return { x: p.x, y: p.y, delta: 1000 * m.a };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + start.delta, start.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("Wall start X", { exact: true })).toHaveValue(
    "7",
  );
  expect(await page.evaluate(() => scrollY)).toBe(100);
  await page.getByRole("button", { name: "Select Room", exact: true }).click();
  await tap(page, 3000, 4000);
  const name = page.getByLabel("Room name", { exact: true });
  await name.fill("Retain me");
  await name.press("Tab");
  await page.getByRole("button", { name: "Select Wall", exact: true }).click();
  await tap(page, 7000, 4000);
  await page
    .getByRole("button", { name: "Delete partition", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete partition", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Retained room labels" }),
  ).toBeVisible();
  await expect(page.getByText("Retain me", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  const original = (await stored(page))[0];
  const camera = await page
    .locator(".plan-canvas > g")
    .first()
    .getAttribute("transform");
  await page.getByLabel("Select room", { exact: true }).focus();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.locator(".plan-canvas > g").first().getAttribute("transform"),
  ).toBe(camera);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: false }).click();
  const file = await download;
  const path = await file.path();
  await page.getByRole("button", { name: "Back to project library" }).click();
  await page
    .getByRole("button", { name: "Duplicate Interior hall", exact: true })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Independent rooms");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  const copy = (await stored(page)).find(
    (p) => p.name === "Independent rooms",
  )!;
  expect(copy.building.interior.partitions[0].id).not.toBe(
    original.building.interior.partitions[0].id,
  );
  expect(copy.building.interior.rooms[0].id).not.toBe(
    original.building.interior.rooms[0].id,
  );
  await page.getByLabel("Import project JSON file").setInputFiles(path!);
  const rows = await stored(page);
  expect(rows).toHaveLength(3);
  expect(rows.every((p) => p.building.interior.partitions.length === 1)).toBe(
    true,
  );
});

test("pinch cancels an interior wall drag and unfinished draw without geometry edits", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native multi-touch requires Chromium mobile CDP.",
  );
  await create(page);
  await fullWall(page);
  await saved(page);
  const original = (await stored(page))[0];
  await page.getByRole("button", { name: "Select Wall", exact: true }).click();
  const p = await localPoint(page, 6000, 4000);
  const client = await page.context().newCDPSession(page);
  const t = (id: number, x: number, y: number) => ({
    id,
    x,
    y,
    radiusX: 3,
    radiusY: 3,
  });
  const pinch = async () => {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [t(1, p.x, p.y)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [t(1, p.x + 25, p.y)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [t(1, p.x + 25, p.y), t(2, p.x - 35, p.y)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [t(1, p.x + 65, p.y + 15), t(2, p.x - 65, p.y + 15)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [t(1, p.x + 65, p.y + 15)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [t(1, p.x + 90, p.y)],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const scroll = await page.evaluate(() => scrollY);
  await pinch();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  expect((await stored(page))[0]).toEqual(original);
  await page.getByRole("button", { name: "Draw Wall", exact: true }).click();
  await tap(page, 200, 4000);
  await pinch();
  expect((await stored(page))[0]).toEqual(original);
  await client.detach();
});
