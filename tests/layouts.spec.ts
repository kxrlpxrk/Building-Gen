import { test, expect, type Page } from "@playwright/test";
import type { Project } from "../src/model";
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Generated hall");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
}
async function records(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data = await new Promise<Project[]>((resolve, reject) => {
      const r = db.transaction("projects").objectStore("projects").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return data;
  });
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /Saved/ }),
  ).toBeVisible();
}
async function openGenerator(page: Page) {
  await page
    .getByRole("button", { name: "Generate Layout", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Generate Layout", exact: true }),
  ).toBeVisible();
}
async function generate(page: Page) {
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview layout A", exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
async function numeric(page: Page, label: string, value: string) {
  const input = page.getByRole("textbox", { name: label, exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function tap(page: Page, x: number, y: number) {
  await page.getByRole("application").scrollIntoViewIfNeeded();
  const p = await page.locator("[data-interior-layer]").evaluate(
    (el, p) => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(
        (el as SVGGraphicsElement).getScreenCTM()!,
      );
      return { x: q.x, y: q.y };
    },
    { x, y },
  );
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

test("worker proposals are deterministic read-only previews; compare, regenerate and cancel preserve storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  const original = (await records(page))[0];
  await openGenerator(page);
  await expect(page.getByTestId("layout-minimum")).toContainText("46.00");
  await generate(page);
  await expect(
    page.getByRole("button", { name: "Preview layout C", exact: true }),
  ).toBeVisible();
  const canvas = page.getByRole("application");
  await expect(canvas.locator("[data-partition-id]")).toHaveCount(3);
  const geometry = await canvas
    .locator("[data-physical-partition]")
    .evaluateAll((nodes) =>
      nodes.map((n) =>
        ["x", "y", "width", "height"].map((a) => n.getAttribute(a)),
      ),
    );
  expect((await records(page))[0]).toEqual(original);
  await expect(
    page.getByRole("button", { name: "Draw Wall", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".layout-thumbnail")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Toggle inspector", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept layout A", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Toggle inspector", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept layout A", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".layout-thumbnail")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Preview layout B", exact: true })
    .click();
  await expect(
    page.getByText("LAYOUT B / PREVIEW", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview layout A", exact: true })
    .click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview layout A", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(
    await canvas
      .locator("[data-physical-partition]")
      .evaluateAll((nodes) =>
        nodes.map((n) =>
          ["x", "y", "width", "height"].map((a) => n.getAttribute(a)),
        ),
      ),
  ).toEqual(geometry);
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview layout A", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("Random seed", { exact: true })).not.toHaveValue(
    "1041",
  );
  const camera = await page
    .locator(".plan-canvas > g")
    .first()
    .getAttribute("transform");
  await page.getByLabel("Random seed", { exact: true }).focus();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.locator(".plan-canvas > g").first().getAttribute("transform"),
  ).toBe(camera);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
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
  await page
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  await expect(canvas.locator("[data-partition-id]")).toHaveCount(0);
  expect((await records(page))[0]).toEqual(original);
});

test("accept is one undo transaction; generated rooms and openings remain editable and portable", async ({
  page,
}) => {
  await create(page);
  const original = (await records(page))[0];
  await openGenerator(page);
  await generate(page);
  await page
    .getByRole("button", { name: "Accept layout A", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Generate Layout", exact: true }),
  ).toHaveCount(0);
  await saved(page);
  const accepted = (await records(page))[0];
  expect(accepted.schemaVersion).toBe(6);
  expect(accepted.building.interior.rooms).toHaveLength(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect((await records(page))[0].building).toEqual(original.building);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  expect((await records(page))[0].building).toEqual(accepted.building);
  await page
    .getByLabel("Select room", { exact: true })
    .selectOption({ index: 1 });
  const name = page.getByRole("textbox", { name: "Room name", exact: true });
  await name.fill("Edited generated room");
  await name.press("Tab");
  const inside = accepted.building.openings.find(
    (o) => o.host.kind === "partition",
  )!;
  await page
    .getByLabel("Select door/opening", { exact: true })
    .selectOption(inside.id);
  await numeric(page, "Opening width", "0.8");
  await saved(page);
  const edited = (await records(page))[0];
  expect(
    edited.building.interior.rooms.some(
      (r) => r.name === "Edited generated room",
    ),
  ).toBe(true);
  expect(edited.building.openings.find((o) => o.id === inside.id)!.width).toBe(
    800,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const file = await download,
    path = await file.path();
  await page.getByRole("button", { name: "Back to project library" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Open Generated hall", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(edited);
  await page.getByRole("button", { name: "Back to project library" }).click();
  await page.getByLabel("Import project JSON file").setInputFiles(path!);
  const rows = await records(page);
  expect(rows).toHaveLength(2);
  expect(
    rows.every((p) =>
      p.building.interior.rooms.some((r) => r.name === "Edited generated room"),
    ),
  ).toBe(true);
  expect(rows[0].building.interior.rooms[0].id).not.toBe(
    rows[1].building.interior.rooms[0].id,
  );
});

test("manual replacement requires explicit review, preserves exterior entrances, and undoes losslessly", async ({
  page,
}) => {
  await create(page);
  await page.getByRole("button", { name: "Draw Wall", exact: true }).click();
  await tap(page, 6000, 200);
  await tap(page, 6000, 7800);
  await page
    .getByLabel("Select room", { exact: true })
    .selectOption({ index: 1 });
  const name = page.getByLabel("Room name", { exact: true });
  await name.fill("Keep my manual label");
  await name.press("Tab");
  await page.getByRole("button", { name: "Place Door", exact: true }).click();
  await tap(page, 6000, 4000);
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await tap(page, 3000, 100);
  await page
    .getByRole("button", { name: "Confirm opening", exact: true })
    .click();
  await saved(page);
  const original = (await records(page))[0];
  await openGenerator(page);
  await generate(page);
  await page
    .getByRole("button", { name: "Accept layout A", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("1 partitions");
  await expect(page.getByRole("dialog")).toContainText(
    "exterior entrances/openings are preserved",
  );
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Keep current plan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(original);
  await openGenerator(page);
  await generate(page);
  await page
    .getByRole("button", { name: "Accept layout A", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm replace interior", exact: true })
    .click();
  await saved(page);
  const accepted = (await records(page))[0];
  expect(accepted.building.interior.rooms).toHaveLength(4);
  expect(
    accepted.building.openings.filter((o) => o.host.kind === "exterior"),
  ).toEqual(
    original.building.openings.filter((o) => o.host.kind === "exterior"),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect((await records(page))[0].building).toEqual(original.building);
});

test("impossible requests and locked sections fail without touching the project", async ({
  page,
}) => {
  await create(page);
  const original = (await records(page))[0];
  await openGenerator(page);
  await page.getByLabel("Request 1 minimum area", { exact: true }).fill("200");
  await page
    .getByLabel("Request 1 preferred area", { exact: true })
    .fill("200");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("exceeds usable");
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await page.getByRole("button", { name: "Lock section", exact: true }).click();
  await saved(page);
  const locked = (await records(page))[0];
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await openGenerator(page);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Unlock");
  expect((await records(page))[0]).toEqual(locked);
});

test("native preview pinch pans/zooms without committing generated geometry", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native multi-touch uses mobile Chromium CDP.",
  );
  await create(page);
  const original = (await records(page))[0];
  await openGenerator(page);
  await generate(page);
  const canvas = page.getByRole("application");
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox(),
    x = b!.x + b!.width / 2,
    y = b!.y + b!.height / 2,
    client = await page.context().newCDPSession(page),
    t = (id: number, x: number, y: number) => ({
      id,
      x,
      y,
      radiusX: 3,
      radiusY: 3,
    }),
    scroll = await page.evaluate(() => scrollY);
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
    touchPoints: [t(1, x - 70, y + 15)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [t(1, x - 100, y + 25)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  expect((await records(page))[0]).toEqual(original);
  await expect(canvas.locator("[data-partition-id]")).toHaveCount(3);
  await client.detach();
});
