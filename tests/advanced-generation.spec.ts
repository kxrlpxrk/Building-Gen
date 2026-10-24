import { test, expect, type Page } from "@playwright/test";
import type { Project } from "../src/model";
import type { ArchitecturalConfig } from "../src/architecturalGenerator";
import { advancedExamples } from "./fixtures/advancedArchitecture";
test.use({ actionTimeout: 15000 });
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
async function source(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Preserved source");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function configure(page: Page, c: ArchitecturalConfig) {
  await page
    .getByRole("button", {
      name: "Generate Architectural Building",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Architectural building purpose", { exact: true })
    .selectOption(c.purpose);
  await page
    .getByLabel("Architectural preset", { exact: true })
    .selectOption(c.style);
  await page
    .getByLabel("Architectural complexity", { exact: true })
    .selectOption(c.complexity);
  await page
    .getByLabel("Architectural extensions", { exact: true })
    .selectOption(String(c.extensions));
  await page
    .getByLabel("Cross-gable complexity", { exact: true })
    .selectOption(c.crossGables!);
  await page
    .getByText("Advanced architectural options", { exact: true })
    .click();
  for (const r of ["Gable", "Hip", "Shed"])
    await page
      .getByRole("checkbox", { name: r, exact: true })
      .setChecked(c.roofs.includes(r as "Gable"));
  await page
    .getByLabel("Architectural detail", { exact: true })
    .selectOption(c.detail);
  await page
    .getByRole("checkbox", { name: "Chimneys", exact: true })
    .setChecked(c.chimneys);
  await page
    .getByRole("checkbox", { name: "Gable ornaments", exact: true })
    .setChecked(c.ornaments);
  await page
    .getByLabel("Generated ornamentation", { exact: true })
    .selectOption(c.ornamentation!);
  await page.getByLabel("Architectural seed", { exact: true }).fill(c.seed);
}
async function generate(page: Page) {
  await page
    .getByRole("button", { name: "Generate architecture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview architecture A", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
}
async function drag(page: Page, dx: number, dy: number) {
  const v = page.locator(".exterior-viewport");
  await v.scrollIntoViewIfNeeded();
  const r = (await v.boundingBox())!;
  await page.mouse.move(r.x + r.width * 0.45, r.y + r.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(
    r.x + r.width * 0.45 + r.height * dx,
    r.y + r.height * (0.5 + dy),
    { steps: 12 },
  );
  await page.mouse.up();
}
test("advanced worker cancellation and independent acceptance preserve editable roofs, carvings and history", async ({
  page,
}) => {
  test.setTimeout(120000);
  await source(page);
  const original = (await records(page))[0];
  await configure(page, advancedExamples[1].config);
  await page
    .getByRole("button", { name: "Generate architecture", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Cancel architectural generation",
      exact: true,
    })
    .click();
  expect(await records(page)).toEqual([original]);
  await configure(page, advancedExamples[1].config);
  await generate(page);
  await page
    .getByRole("button", { name: "Preview architecture B", exact: true })
    .click();
  expect(await records(page)).toEqual([original]);
  await page
    .getByLabel("Architectural project name", { exact: true })
    .fill("Generated cross-gables and carvings");
  await page
    .getByRole("button", { name: "Create New Project", exact: true })
    .click();
  await expect.poll(async () => (await records(page)).length).toBe(2);
  const accepted = (await records(page)).find((p) => p.id !== original.id)!;
  expect((await records(page)).find((p) => p.id === original.id)).toEqual(
    original,
  );
  expect(
    accepted.building.sections.flatMap((s) => s.exterior.roofFeatures).length,
  ).toBeGreaterThan(0);
  expect(
    accepted.building.sections.flatMap((s) => s.exterior.ornamentation.items)
      .length,
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await page
    .getByRole("button", { name: "Architectural Ornamentation", exact: true })
    .click();
  const o = accepted.building.sections[0].exterior.ornamentation.items[0];
  await page
    .getByLabel("Selected ornament", { exact: true })
    .selectOption(o.id);
  await page
    .getByLabel("Ornament finish", { exact: true })
    .selectOption(o.finish === "Dark wood" ? "Ochre" : "Dark wood");
  expect((await records(page)).find((p) => p.id === accepted.id)).toEqual(
    accepted,
  );
  await page
    .getByRole("button", { name: "Accept ornamentation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page)).find((p) => p.id === accepted.id)!.building
          .sections[0].exterior.ornamentation.items[0].finish,
    )
    .not.toBe(o.finish);
  const edited = (await records(page)).find((p) => p.id === accepted.id)!;
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page)).find((p) => p.id === accepted.id)!.building,
    )
    .toEqual(accepted.building);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page)).find((p) => p.id === accepted.id)!.building,
    )
    .toEqual(edited.building);
  await page
    .getByRole("button", { name: "Roof Architecture", exact: true })
    .click();
  await page
    .getByLabel("Selected roof feature", { exact: true })
    .selectOption(accepted.building.sections[0].exterior.roofFeatures[0].id);
  await expect(
    page.getByLabel("Cross-gable width", { exact: true }),
  ).toBeEnabled();
  const pitch = accepted.building.sections[0].exterior.roofFeatures[0].pitch;
  await page
    .getByLabel("Secondary roof pitch", { exact: true })
    .fill(String(pitch + 0.1));
  await expect(
    page.getByRole("button", { name: "Accept roof architecture", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Accept roof architecture", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page)).find((p) => p.id === accepted.id)!.building
          .sections[0].exterior.roofFeatures[0].pitch,
    )
    .toBeCloseTo(pitch + 0.1, 1);
  const final = (await records(page)).find((p) => p.id === accepted.id)!;
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${accepted.name}`, exact: false })
    .click();
  expect(
    (await records(page)).find((p) => p.id === accepted.id)!.building,
  ).toEqual(final.building);
});
test("generated advanced architecture evidence: six styles from multiple angles without section outlines", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await source(page);
  const original = await records(page);
  for (const [index, example] of advancedExamples.entries()) {
    await configure(page, example.config);
    await generate(page);
    const v = page.locator(".exterior-viewport");
    await expect(page.locator(".architectural-generator")).toContainText(
      "cross-gables ·",
    );
    const outline = page.getByRole("button", {
      name: "Section outline",
      exact: true,
    });
    if ((await outline.getAttribute("aria-pressed")) === "true")
      await outline.click();
    await expect(outline).toHaveAttribute("aria-pressed", "false");
    for (const angle of ["front", "rear", "above", "opposite"]) {
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      if (angle === "rear") await drag(page, 0.5, 0);
      if (angle === "above") await drag(page, 0, 0.1);
      if (angle === "opposite") await drag(page, -0.3, 0);
      await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
      await expect
        .poll(async () => Number(await v.getAttribute("data-triangles")))
        .toBeGreaterThan(0);
      await v.hover();
      await page.mouse.wheel(0, -500);
      const path = info.outputPath(`advanced-${index}-${angle}.png`);
      await page.locator(".exterior-wrap").screenshot({ path });
      await info.attach(`${example.name}-${angle}`, {
        path,
        contentType: "image/png",
      });
    }
    expect(Number(await v.getAttribute("data-draw-calls"))).toBeLessThan(180);
    expect(Number(await v.getAttribute("data-triangles"))).toBeLessThan(150000);
    const rebuilds = await v.getAttribute("data-mesh-rebuilds");
    await v.hover();
    await page.mouse.wheel(0, 3000);
    expect(await v.getAttribute("data-mesh-rebuilds")).toBe(rebuilds);
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
  }
});
