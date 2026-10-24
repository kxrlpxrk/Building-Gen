import { test, expect, type Page } from "@playwright/test";
import type { Project } from "../src/model";
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
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Original architecture");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function open(page: Page) {
  await page
    .getByRole("button", {
      name: "Generate Architectural Building",
      exact: true,
    })
    .click();
}
async function generate(page: Page) {
  await page
    .getByRole("button", { name: "Generate architecture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview architecture A", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}
test("architectural worker previews, compares and cancels without saving; page scrolling remains natural", async ({
  page,
}, info) => {
  await create(page);
  const original = await records(page);
  await open(page);
  await page
    .getByText("Advanced architectural options", { exact: true })
    .click();
  await page
    .getByLabel("Architectural detail", { exact: true })
    .selectOption("High");
  await page
    .getByLabel("Architectural extensions", { exact: true })
    .selectOption("3");
  await generate(page);
  await expect(
    page.getByRole("button", { name: "Place Window", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("EXTERIOR / GROUND FLOOR", { exact: true }),
  ).toBeVisible();
  const preview = page.getByRole("button", {
    name: "Preview architecture B",
    exact: true,
  });
  await preview.click();
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".building-thumbnail")).toHaveCount(3);
  const viewport = page.locator(".exterior-viewport");
  await viewport.scrollIntoViewIfNeeded();
  await expect(viewport).toHaveAttribute("data-render-status", "ready");
  await expect
    .poll(async () => Number(await viewport.getAttribute("data-triangles")))
    .toBeGreaterThan(0);
  await viewport.screenshot({
    path: info.outputPath("generated-longhouse.png"),
  });
  expect(await records(page)).toEqual(original);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", {
      name: "Cancel architectural generation",
      exact: true,
    })
    .click();
  expect(await records(page)).toEqual(original);
  await open(page);
  await page
    .getByLabel("Architectural building purpose", { exact: true })
    .selectOption("Manor");
  await generate(page);
  await viewport.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
  await viewport.screenshot({ path: info.outputPath("generated-manor.png") });
  expect(await records(page)).toEqual(original);
  await page
    .getByRole("button", { name: "Regenerate architecture", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Cancel architectural generation",
      exact: true,
    })
    .click();
  expect(await records(page)).toEqual(original);
});
test("complete proposal creates an independent editable saved project", async ({
  page,
}) => {
  await create(page);
  const original = (await records(page))[0];
  await open(page);
  await generate(page);
  await page
    .getByLabel("Architectural project name", { exact: true })
    .fill("Generated architecture");
  await page
    .getByRole("button", { name: "Create New Project", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
  const rows = await records(page);
  expect(rows).toHaveLength(2);
  expect(rows.find((p) => p.id === original.id)).toEqual(original);
  const generated = rows.find((p) => p.id !== original.id)!;
  expect(
    generated.building.openings.some((o) => o.type === "exterior-door"),
  ).toBe(true);
  expect(
    generated.building.sections.flatMap((s) => s.exterior.windows).length,
  ).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Open Generated architecture",
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Generated architecture", exact: false })
    .click();
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Place Window", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate Building", exact: true }),
  ).toBeVisible();
});
