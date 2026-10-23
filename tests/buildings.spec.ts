import { test, expect, type Page } from "@playwright/test";
import { createProject, serializeProject, type Project } from "../src/model";
import { changePartitions } from "../src/interiorBuilding";
import { changeOpenings } from "../src/openingBuilding";
import { newOpening } from "../src/openings";
import { openingContext, prepareBuilding } from "../src/assembly";
async function records(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const rows = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction("projects"),
        r = tx.objectStore("projects").getAll();
      tx.oncomplete = () => resolve(r.result);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return rows;
  });
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill("Original hall");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await saved(page);
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "Generate Building", exact: true })
    .click();
}
async function generate(page: Page) {
  await page
    .getByRole("button", { name: "Generate footprints", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview building A", exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
const geometry = (page: Page) =>
  page
    .locator("[data-section-id]")
    .evaluateAll((nodes) =>
      nodes.map((n) => [
        n.getAttribute("transform"),
        n.querySelector("path")?.getAttribute("d"),
        n.querySelector("rect")?.getAttribute("width"),
        n.querySelector("rect")?.getAttribute("height"),
      ]),
    );

test("read-only building proposals repeat a seed, compare, cancel and preserve document scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  const original = (await records(page))[0];
  await open(page);
  await page
    .getByLabel("Building purpose", { exact: true })
    .selectOption("Farmhouse");
  await page
    .getByLabel("Building complexity", { exact: true })
    .selectOption("Organic");
  await page
    .getByLabel("Desired extensions", { exact: true })
    .selectOption("2");
  await generate(page);
  await expect(
    page.getByRole("button", { name: "Preview building C", exact: true }),
  ).toBeVisible();
  const a = await geometry(page);
  expect(a).toHaveLength(3);
  await page.getByRole("application").focus();
  await page.keyboard.press("v");
  await page.keyboard.press("ArrowRight");
  expect(await geometry(page)).toEqual(a);
  expect((await records(page))[0]).toEqual(original);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Compare buildings", exact: true })
    .click();
  await expect(page.locator(".building-thumbnail")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Preview building B", exact: true })
    .click();
  expect(await geometry(page)).not.toEqual(a);
  await generate(page);
  expect(await geometry(page)).toEqual(a);
  await page
    .getByRole("button", { name: "Regenerate buildings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview building A", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Building seed", { exact: true }),
  ).not.toHaveValue("2041");
  await page
    .getByRole("button", { name: "Toggle inspector", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle inspector", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create New Project", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Generated project name", { exact: true }).focus();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  expect((await page.getByRole("application").boundingBox())!.y).toBeLessThan(
    0,
  );
  expect(
    await page
      .locator(".inspector-content")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toBe("visible");
  const after = await geometry(page);
  const camera = await page
    .locator(".plan-canvas > g")
    .first()
    .getAttribute("transform");
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await geometry(page)).toEqual(after);
  expect(
    await page.locator(".plan-canvas > g").first().getAttribute("transform"),
  ).toBe(camera);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  for (const size of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Cancel building generation", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(original);
  await expect(page.locator("[data-section-id]")).toHaveCount(1);
});

test("create new preserves a locked named interior and doors; generated sections edit and roundtrip independently", async ({
  page,
}) => {
  const source = createProject("Protected manual plan");
  source.building = changePartitions(source.building, [
    {
      id: "manual-wall",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  const region = openingContext(source.building).regions[0];
  source.building.interior.rooms = [
    {
      id: "manual-room",
      regionKey: region.key,
      name: "Family hall",
      type: "Main Hall",
      notes: "Do not discard these notes",
    },
  ];
  source.building = changeOpenings(source.building, [
    newOpening(
      "manual-door",
      { kind: "partition", partitionId: "manual-wall" },
      4000,
    ),
    newOpening(
      "manual-entry",
      { kind: "exterior", sectionId: source.building.mainSectionId, edge: 0 },
      3000,
    ),
  ]);
  source.building = prepareBuilding(
    {
      ...source.building,
      sections: source.building.sections.map((s) => ({ ...s, locked: true })),
    },
    source.building,
  );
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "manual.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(source)),
  });
  await saved(page);
  const original = (await records(page))[0];
  await open(page);
  await page
    .getByLabel("Building purpose", { exact: true })
    .selectOption("Workshop");
  await generate(page);
  await expect(
    page.getByRole("button", { name: "Replace Current Building", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Generated project name", { exact: true })
    .fill("Generated workshop");
  await page
    .getByRole("button", { name: "Create New Project", exact: true })
    .click();
  await expect(page.locator(".studio-project strong")).toHaveText(
    "Generated workshop",
  );
  await saved(page);
  const rows = await records(page),
    generated = rows.find((p) => p.name === "Generated workshop")!;
  expect(rows).toHaveLength(2);
  expect(rows.find((p) => p.id === original.id)).toEqual(original);
  expect(generated.schemaVersion).toBe(5);
  expect(generated.building.sections).toHaveLength(2);
  expect(generated.building.sections[1].type).toBe("Storage");
  expect(generated.building.interior).toEqual({ partitions: [], rooms: [] });
  expect(generated.building.openings).toEqual([]);
  expect(generated.building.id).not.toBe(original.building.id);
  await page
    .getByLabel("Selected section", { exact: true })
    .selectOption(generated.building.sections[1].id);
  const name = page.getByLabel("Section name", { exact: true });
  await name.fill("Editable storage");
  await name.press("Tab");
  await saved(page);
  const width = page.getByLabel("Width", { exact: true });
  await width.fill(String(generated.building.sections[1].width / 1000 + 0.1));
  await width.press("Enter");
  await saved(page);
  expect(
    (await records(page)).find((p) => p.id === generated.id)!.building
      .sections[1].width,
  ).toBe(generated.building.sections[1].width + 100);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "Lock section", exact: true }).click();
  await saved(page);
  await expect(page.getByLabel("Length", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  const edited = (await records(page)).find((p) => p.id === generated.id)!;
  expect(edited.building.sections[1].name).toBe("Editable storage");
  expect(edited.building.sections[1].locked).toBe(false);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const path = await (await download).path();
  await page.reload();
  await page
    .getByRole("button", { name: "Open Generated workshop", exact: true })
    .click();
  await expect(
    page.getByLabel("Selected section", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to project library", exact: true })
    .click();
  await page.getByLabel("Import project JSON file").setInputFiles(path!);
  await expect.poll(async () => (await records(page)).length).toBe(3);
  const all = await records(page);
  expect(all.find((p) => p.id === original.id)).toEqual(original);
  const imported = all.find(
    (p) => p.id !== original.id && p.id !== generated.id,
  )!;
  expect(imported.building.sections[1].name).toBe("Editable storage");
  expect(imported.building.sections[1].id).not.toBe(
    generated.building.sections[1].id,
  );
});

test("invalid settings, worker cancellation and storage failure cannot overwrite the original", async ({
  page,
}) => {
  await create(page);
  const original = (await records(page))[0];
  await open(page);
  await page.getByLabel("Generated main length", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Generate footprints", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("longhouse requires");
  expect(await records(page)).toEqual([original]);
  await page
    .getByLabel("Generated main length", { exact: true })
    .fill("18.0004");
  await page
    .getByRole("button", { name: "Generate footprints", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("whole millimetres");
  await page.getByLabel("Generated main length", { exact: true }).fill("18");
  await page
    .getByRole("button", { name: "Generate footprints", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel building generation", exact: true })
    .click();
  await expect(page.getByLabel("Length", { exact: true })).toBeVisible();
  expect(await records(page)).toEqual([original]);
  await open(page);
  await generate(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(window, "restorePut", {
      value: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Test quota exhausted", "QuotaExceededError");
    };
  });
  await page
    .getByRole("button", { name: "Create New Project", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not create project",
  );
  expect(await records(page)).toEqual([original]);
  await page.evaluate(() =>
    (window as unknown as { restorePut: () => void }).restorePut(),
  );
  await page
    .getByRole("button", { name: "Create New Project", exact: true })
    .click();
  await expect.poll(async () => (await records(page)).length).toBe(2);
  expect((await records(page)).find((p) => p.id === original.id)).toEqual(
    original,
  );
});

test("native building preview pinch changes only the camera", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native touch uses mobile Chromium CDP.",
  );
  await create(page);
  const original = (await records(page))[0];
  await open(page);
  await generate(page);
  const canvas = page.getByRole("application");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const before = await geometry(page),
    camera = await page
      .locator(".plan-canvas > g")
      .first()
      .getAttribute("transform"),
    scroll = await page.evaluate(() => scrollY),
    client = await page.context().newCDPSession(page);
  const t = (id: number, x: number, y: number) => ({
    id,
    x,
    y,
    radiusX: 3,
    radiusY: 3,
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [t(1, x - 30, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [t(1, x - 30, y), t(2, x + 30, y)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [t(1, x - 70, y + 15), t(2, x + 70, y + 15)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await geometry(page)).toEqual(before);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  expect(
    await page.locator(".plan-canvas > g").first().getAttribute("transform"),
  ).not.toBe(camera);
  expect(await records(page)).toEqual([original]);
  await client.detach();
});
