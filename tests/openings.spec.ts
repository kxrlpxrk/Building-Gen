import { test, expect, type Page } from "@playwright/test";
import type { Project } from "../src/model";
async function point(page: Page, x: number, y: number) {
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
  const p = await point(page, x, y);
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function numeric(page: Page, name: string, value: string) {
  const input = page.getByRole("textbox", { name, exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
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
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill("Door hall");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await page.getByRole("button", { name: "Draw Wall", exact: true }).click();
  await tap(page, 6000, 200);
  await tap(page, 6000, 7800);
  await expect(page.locator("[data-partition-id]")).toHaveCount(1);
  for (const [index, name] of [
    [1, "Great Hall"],
    [2, "Kitchen"],
  ] as const) {
    await page
      .getByLabel("Select room", { exact: true })
      .selectOption({ index });
    const input = page.getByLabel("Room name", { exact: true });
    await input.fill(name);
    await input.press("Tab");
  }
  await saved(page);
  await page.getByRole("button", { name: "Place Door", exact: true }).click();
}
async function place(page: Page, x: number, y: number) {
  await tap(page, x, y);
  await expect(
    page.getByRole("button", { name: "Confirm opening", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await saved(page);
}

test("entrance, hinged door, exact edits, swing flips and circulation preserve named rooms", async ({
  page,
}) => {
  await create(page);
  const before = (await stored(page))[0];
  await expect(page.getByTestId("access-summary")).toContainText("0 of 2");
  await tap(page, 6000, 4000);
  await numeric(page, "Opening position", "3.8");
  expect((await stored(page))[0].building.openings).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await saved(page);
  let p = (await stored(page))[0];
  const door = p.building.openings[0];
  expect(door.width).toBe(900);
  expect(p.building.interior).toEqual(before.building.interior);
  await expect(page.locator(`[data-opening-gap="${door.id}"]`)).toHaveAttribute(
    "height",
    "900",
  );
  await expect(page.locator("[data-physical-partition]")).toHaveAttribute(
    "mask",
    /opening-mask/,
  );
  await expect(page.getByTestId("threshold-area")).toHaveText("0.090 m²");
  await expect(page.getByTestId("physical-partitions")).toHaveText("0.670 m²");
  await place(page, 3000, 100);
  await expect(page.getByTestId("access-summary")).toContainText("2 of 2");
  await page
    .getByLabel("Select door/opening", { exact: true })
    .selectOption(door.id);
  const leaf = page
      .locator(`[data-opening-id="${door.id}"] [data-door-swing] path`)
      .first(),
    original = await leaf.getAttribute("d");
  await page.getByRole("button", { name: "Flip Hinge", exact: true }).click();
  await expect(leaf).not.toHaveAttribute("d", original!);
  const flipped = await leaf.getAttribute("d");
  await page
    .getByRole("button", { name: "Reverse Swing", exact: true })
    .click();
  await expect(leaf).not.toHaveAttribute("d", flipped!);
  await numeric(page, "Opening width", "0.987");
  await numeric(page, "Opening position", "4.123");
  await saved(page);
  p = (await stored(page))[0];
  expect(p.building.openings[0].width).toBe(987);
  expect(p.building.openings[0].offset).toBe(4123);
  expect(p.building.interior).toEqual(before.building.interior);
  await numeric(page, "Opening width", "8");
  await expect(page.getByRole("alert")).toContainText("0.4–3");
  await numeric(page, "Opening width", "0.987");
  await page
    .getByRole("button", { name: "Delete opening", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete opening", exact: true })
    .click();
  await expect(page.getByTestId("access-summary")).toContainText("1 of 2");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("access-summary")).toContainText("2 of 2");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByTestId("access-summary")).toContainText("1 of 2");
  await page
    .getByLabel("New opening type", { exact: true })
    .selectOption("passage");
  await place(page, 6000, 6000);
  await expect(page.getByTestId("access-summary")).toContainText("2 of 2");
  await expect(page.getByLabel("Hinge side", { exact: true })).toHaveCount(0);
  await numeric(page, "Building X", "1.234");
  await numeric(page, "Interior building rotation", "37.5");
  await saved(page);
  const end = (await stored(page))[0];
  expect(end.building.interior).toEqual(before.building.interior);
  expect(
    end.building.openings.some((o) => o.type === "passage" && o.width === 1200),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to project library" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Open Door hall", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await expect(page.getByTestId("access-summary")).toContainText("2 of 2");
  expect((await stored(page))[0]).toEqual(end);
});

test("placement cancellation, scrolled drag/resize, protected hosts and independent JSON copies", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  await tap(page, 6000, 300);
  await expect(
    page.getByRole("button", { name: "Confirm opening", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Cancel opening", exact: true })
    .click();
  expect((await stored(page))[0].building.openings).toHaveLength(0);
  await place(page, 6000, 4000);
  let p = (await stored(page))[0];
  const id = p.building.openings[0].id;
  await page.evaluate(() => scrollTo(0, 150));
  const initial = await page.locator("[data-interior-layer]").evaluate((el) => {
    const m = (el as SVGGraphicsElement).getScreenCTM()!,
      p = new DOMPoint(6000, 4200).matrixTransform(m);
    return { x: p.x, y: p.y, delta: 1000 * m.d };
  });
  await page.mouse.move(initial.x, initial.y);
  await page.mouse.down();
  await page.mouse.move(initial.x, initial.y + initial.delta, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => scrollY)).toBe(150);
  await expect(
    page.getByLabel("Opening position", { exact: true }),
  ).toHaveValue("5");
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await saved(page);
  p = (await stored(page))[0];
  expect(p.building.openings[0].offset).toBe(5000);
  await page.getByRole("application").scrollIntoViewIfNeeded();
  const end = await page
    .locator(`[data-opening-id="${id}"] [data-opening-end="1"] circle`)
    .first()
    .boundingBox();
  const pixel = await page
    .locator("[data-interior-layer]")
    .evaluate((el) => (el as SVGGraphicsElement).getScreenCTM()!.d * 550);
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    end!.x + end!.width / 2,
    end!.y + end!.height / 2 + pixel,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("Opening width", { exact: true })).toHaveValue(
    "2",
  );
  await page
    .getByRole("button", { name: "Cancel opening", exact: true })
    .click();
  await page.getByRole("button", { name: "Select Wall", exact: true }).click();
  await tap(page, 6000, 2000);
  await numeric(page, "Partition length", "4");
  await expect(page.getByRole("alert")).toContainText("Opening");
  await numeric(page, "Partition length", "7.6");
  await saved(page);
  expect((await stored(page))[0].building.openings).toEqual(
    p.building.openings,
  );
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await page.getByRole("button", { name: "Lock section", exact: true }).click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await page
    .getByLabel("Select door/opening", { exact: true })
    .selectOption(id);
  await numeric(page, "Opening width", "1");
  await expect(page.getByRole("alert")).toContainText("locked");
  await numeric(page, "Opening width", "0.9");
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await page
    .getByRole("button", { name: "Unlock section", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await saved(page);
  const camera = await page
    .locator(".plan-canvas > g")
    .first()
    .getAttribute("transform");
  await page.getByLabel("Opening position", { exact: true }).focus();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await page.evaluate(() => scrollTo(0, 0));
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
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const file = await download,
    path = await file.path();
  await page.getByRole("button", { name: "Back to project library" }).click();
  await page
    .getByRole("button", { name: "Duplicate Door hall", exact: true })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Independent doors");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await page.getByLabel("Import project JSON file").setInputFiles(path!);
  const rows = await stored(page);
  expect(rows).toHaveLength(3);
  expect(
    rows.every(
      (p) => p.schemaVersion === 9 && p.building.openings.length === 1,
    ),
  ).toBe(true);
  expect(new Set(rows.map((p) => p.building.openings[0].id)).size).toBe(3);
  expect(
    new Set(rows.map((p) => p.building.interior.partitions[0].id)).size,
  ).toBe(3);
});

test("native pinch cancels door previews and drags without saved geometry changes", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native pinch uses mobile Chromium CDP.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  await place(page, 6000, 4000);
  const before = (await stored(page))[0];
  const p = await point(page, 6000, 4200),
    client = await page.context().newCDPSession(page),
    t = (id: number, x: number, y: number) => ({
      id,
      x,
      y,
      radiusX: 3,
      radiusY: 3,
    });
  const scroll = await page.evaluate(() => scrollY);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [t(1, p.x, p.y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [t(1, p.x, p.y + 25)],
  });
  await expect(
    page.getByRole("button", { name: "Confirm opening", exact: true }),
  ).toBeVisible();
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [t(1, p.x, p.y + 25), t(2, p.x - 35, p.y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [t(1, p.x + 65, p.y + 25), t(2, p.x - 65, p.y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [t(1, p.x + 65, p.y + 25)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [t(1, p.x + 90, p.y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByRole("button", { name: "Confirm opening", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  expect((await stored(page))[0]).toEqual(before);
  await client.detach();
});

test("actual door gaps win over adjoining transparent jamb hit regions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  await place(page, 6000, 4000);
  const first = (await stored(page))[0].building.openings[0];
  await tap(page, 6000, 6800);
  // Wait for the new tap preview to replace the previous controlled input
  // before fill selects its text (especially under mobile rendering load).
  await expect(
    page.getByRole("textbox", { name: "Opening position", exact: true }),
  ).toHaveValue("6.5");
  await numeric(page, "Opening position", "5.2");
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await saved(page);
  const second = (await stored(page))[0].building.openings[1];
  expect(second.offset).toBe(5200);
  await tap(page, 6000, 4200);
  await expect(
    page.getByLabel("Select door/opening", { exact: true }),
  ).toHaveValue(first.id);
  await expect(
    page.getByRole("button", { name: "Confirm opening", exact: true }),
  ).toHaveCount(0);
  await tap(page, 6000, 5400);
  await expect(
    page.getByLabel("Select door/opening", { exact: true }),
  ).toHaveValue(second.id);
});
