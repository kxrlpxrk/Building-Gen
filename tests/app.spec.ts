import { test, expect, type Page } from "@playwright/test";
async function create(page: Page, name: string) {
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await expect(page.getByRole("application")).toBeVisible();
}
async function input(page: Page, name: string, value: string) {
  const el = page.getByRole("textbox", { name, exact: true });
  await el.fill(value);
  await el.press("Enter");
}
async function back(page: Page) {
  await page.getByRole("button", { name: "Back to project library" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent projects" }),
  ).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const result = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction("projects");
      const r = tx.objectStore("projects").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return result;
  });
}
test("precise editing, grid independence, undo, reload, project management and imports", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Every great hall starts with a line."),
  ).toBeVisible();
  await create(page, "Ashwood Hall");
  await expect(page.getByText("88.16", { exact: false })).toBeVisible();
  await input(page, "Length", "13.247");
  await page.getByLabel("Grid spacing").selectOption("2000");
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13.247");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("12");
  await page.getByLabel("Redo", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13.247");
  await input(page, "Position X", "-1.251");
  await input(page, "Wall thickness", "20");
  await expect(page.getByRole("alert")).toContainText("positive interior");
  await input(page, "Wall thickness", "0.2");
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(page.getByText("Saved", { exact: false }).first()).toBeVisible();
  await back(page);
  await page
    .getByRole("button", { name: "Duplicate Ashwood Hall", exact: true })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill("Stone Keep");
  await page.getByRole("button", { name: "Create copy" }).click();
  await expect(
    page.getByRole("button", { name: "Open Stone Keep", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rename Stone Keep", exact: true })
    .click();
  await page.getByLabel("Building name", { exact: true }).fill("Stone Tower");
  await page.getByRole("button", { name: "Save name" }).click();
  await page
    .getByRole("button", { name: "Open Stone Tower", exact: true })
    .click();
  await input(page, "Length", "18");
  await back(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Ashwood Hall", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13.247");
  await expect(
    page.getByRole("textbox", { name: "Position X", exact: true }),
  ).toHaveValue("-1.251");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await exportPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await back(page);
  await page.getByLabel("Import project JSON file").setInputFiles(path!);
  await expect(page.getByRole("application")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13.247");
  await back(page);
  const before = await stored(page);
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":900}'),
  });
  await expect(page.getByRole("alert")).toContainText("Import failed");
  expect(await stored(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Delete Stone Tower", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Stone Tower", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete Stone Tower", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete building", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Stone Tower", exact: true }),
  ).toHaveCount(0);
  expect(await stored(page)).toHaveLength(2);
});
test("canvas movement, resize, pan, zoom and pinch isolate geometry", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Gesture Hall");
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  const canvas = page.getByRole("application"),
    box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const geometry = async () =>
    page.locator('[data-building="true"]').first().getAttribute("transform");
  const body = page.locator('[data-building="true"] rect').first(),
    bodyBox = await body.boundingBox();
  expect(bodyBox).toBeTruthy();
  const start = {
    x: bodyBox!.x + bodyBox!.width / 2,
    y: bodyBox!.y + bodyBox!.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 35, start.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(geometry).not.toBe("translate(0 0) rotate(0)");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect.poll(geometry).toBe("translate(0 0) rotate(0)");
  const corner = page.locator('[data-corner="2"] circle'),
    cb = await corner.boundingBox();
  expect(cb).toBeTruthy();
  await page.mouse.move(cb!.x + cb!.width / 2, cb!.y + cb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    cb!.x + cb!.width / 2 + 30,
    cb!.y + cb!.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).not.toHaveValue("12");
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("12");
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  const initial = await geometry();
  // Use touch PointerEvents on both engines; no browser-specific CDP shortcuts.
  await canvas.evaluate((node) => {
    const b = node.getBoundingClientRect();
    const fire = (type: string, id: number, x: number, y: number) =>
      node.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          clientX: b.left + x,
          clientY: b.top + y,
          bubbles: true,
        }),
      );
    // Synthetic pointers cannot acquire native capture; override capture only for this gesture test.
    node.setPointerCapture = () => {};
    node.hasPointerCapture = () => false;
    const x = b.width / 2,
      y = b.height / 2;
    fire("pointerdown", 10, x - 35, y);
    fire("pointerdown", 11, x + 35, y);
    fire("pointermove", 10, x - 65, y + 15);
    fire("pointermove", 11, x + 75, y + 15);
    fire("pointerup", 10, x - 65, y + 15);
    fire("pointermove", 11, x + 120, y + 20);
    fire("pointerup", 11, x + 120, y + 20);
  });
  expect(await geometry()).toBe(initial);
  await page.getByRole("button", { name: "Pan", exact: false }).click();
  await page.mouse.move(box!.x + 50, box!.y + 60);
  await page.mouse.down();
  await page.mouse.move(box!.x + 100, box!.y + 90);
  await page.mouse.up();
  expect(await geometry()).toBe(initial);
  expect(await canvas.evaluate((el) => getComputedStyle(el).touchAction)).toBe(
    "none",
  );
});
test("responsive layouts keep controls within the viewport", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Mobile Hall");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 320, height: 568 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const box = await page.getByRole("application").boundingBox();
    expect(box!.height).toBeGreaterThan(120);
    expect(box!.width).toBeGreaterThan(200);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle inspector" }),
    ).toBeVisible();
  }
});
test("loading failure does not overwrite saved projects", async ({ page }) => {
  await page.goto("/");
  await create(page, "Do not replace");
  await back(page);
  const before = await stored(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      value: {
        open() {
          throw new Error("Simulated database access denied");
        },
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText("Your project library could not be loaded"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New Building", exact: false }),
  ).toBeDisabled();
  // Accessing storage through a fresh origin page confirms the failed load did not write defaults.
  const clean = await page.context().newPage();
  // Init script is page-scoped, so it does not apply to this page.
  await clean.goto("/");
  expect(await stored(clean)).toEqual(before);
  await clean.close();
});
test("save errors retain session edits, allow backup and recover on retry", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "Unsaved hall");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreStorage: () => void }).restoreStorage =
      () => {
        IDBObjectStore.prototype.put = original;
      };
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("Simulated quota failure", "QuotaExceededError");
    };
  });
  await input(page, "Length", "15.123");
  await expect(
    page.getByRole("status").filter({ hasText: "Save Error" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export backup", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to project library" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("15.123");
  await page.evaluate(() =>
    (window as unknown as { restoreStorage: () => void }).restoreStorage(),
  );
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await back(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Unsaved hall", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("15.123");
});
test("native multi-touch cancels an in-progress drag and never edits during pinch", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native touch dispatch uses Chromium CDP on a mobile device profile.",
  );
  await page.goto("/");
  await create(page, "Touch hall");
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  const body = page.locator('[data-building="true"] rect').first(),
    box = await body.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  const client = await page.context().newCDPSession(page);
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
    touchPoints: [touch(1, x + 25, y + 15)],
  });
  await expect
    .poll(() =>
      page.locator('[data-building="true"]').first().getAttribute("transform"),
    )
    .not.toBe("translate(0 0) rotate(0)");
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, x + 25, y + 15), touch(2, x - 35, y + 15)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x + 65, y + 25), touch(2, x - 65, y + 25)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [touch(1, x + 65, y + 25)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touch(1, x + 90, y + 30)],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator('[data-building="true"]').first()).toHaveAttribute(
    "transform",
    "translate(0 0) rotate(0)",
  );
  await expect(page.getByLabel("Undo", { exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await client.detach();
});
