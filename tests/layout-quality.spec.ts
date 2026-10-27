import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import baseline from "../docs/layout-quality/baseline.json" with { type: "json" };
import { serializeProject, type Project } from "../src/model";
import type { LayoutConfig } from "../src/layoutGenerator";
import { assessLayout } from "../src/layoutQuality";
const saved = (page: Page) =>
  expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
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
async function open(page: Page, project: Project) {
  await page.goto("/");
  await expect(page.locator(".version")).toHaveText(["BG-07A.1", "BG-07A.1"]);
  await expect(page.locator(".library-footer")).toContainText("BG-07A.1");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "quality.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await saved(page);
  await expect(page.getByText("BG-07A.1", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
}
test("production architectural-quality comparisons use identical footprints, requests and seeds", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const comparisons = [];
  for (const f of baseline) {
    const source = f.project as Project,
      config = f.config as LayoutConfig,
      before = {
        ...source,
        id: source.id + "-before",
        building: f.before.building,
      } as Project,
      slug = f.purpose.toLowerCase().replace(/[^a-z]+/g, "-");
    await open(page, before);
    const beforeImage = info.outputPath(slug + "-before.png");
    await page.locator(".editor-main").screenshot({ path: beforeImage });
    await info.attach(slug + "-before", {
      path: beforeImage,
      contentType: "image/png",
    });
    await open(page, source);
    const original = await records(page);
    await page
      .getByRole("button", { name: "Generate Layout", exact: true })
      .click();
    await page
      .getByLabel("Interior purpose preset", { exact: true })
      .selectOption(f.purpose);
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Preview layout A", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByLabel("Proposal A architectural strengths", { exact: true }),
    ).toContainText("without using a private chamber as a through-route");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const afterImage = info.outputPath(slug + "-after.png");
    await page.locator(".editor-main").screenshot({ path: afterImage });
    await info.attach(slug + "-after", {
      path: afterImage,
      contentType: "image/png",
    });
    expect(await records(page)).toEqual(original);
    await page
      .getByText("Architectural quality breakdown", { exact: true })
      .click();
    await expect(page.locator(".generator-panel")).toContainText(
      "Functional connections",
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Accept layout A", exact: true })
      .click();
    await saved(page);
    const accepted = (await records(page)).find((p) => p.id === source.id)!;
    const beforeQuality = assessLayout(before.building, config),
      afterQuality = assessLayout(accepted.building, config);
    expect(afterQuality.score).toBeGreaterThan(beforeQuality.score);
    comparisons.push({
      purpose: f.purpose,
      before: beforeQuality,
      after: afterQuality,
    });
    expect(
      (await records(page)).find((p) => p.id === before.id)!.building,
    ).toEqual(before.building);
    expect({
      ...accepted.building,
      interior: source.building.interior,
      openings: source.building.openings,
    }).toEqual(source.building);
  }
  const report = info.outputPath("comparison.json");
  await writeFile(report, JSON.stringify(comparisons, null, 2));
  await info.attach("architectural-quality-comparison", {
    path: report,
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 844, height: 390 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
