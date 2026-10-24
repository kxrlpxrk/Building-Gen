import { test, expect, type Page } from "@playwright/test";
import { serializeProject, type Project } from "../src/model";
import {
  ornamentBuilding,
  ornamentExamples,
  ornamentPerformanceBuilding,
} from "./fixtures/ornamentBuildings";
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
async function load(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "ornaments.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
}
test("ornament previews, invalid positions, complete history and persistence retain the source architecture", async ({
  page,
}) => {
  const p = ornamentBuilding();
  await load(page, p);
  const original = (await records(page))[0];
  await page
    .getByRole("button", { name: "Architectural Ornamentation", exact: true })
    .click();
  await page
    .getByLabel("Ornamentation level", { exact: true })
    .selectOption("Ornate");
  await expect(
    page.getByRole("button", { name: "Accept ornamentation", exact: true }),
  ).toBeEnabled();
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Cancel ornament preview", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByLabel("Ornamentation level", { exact: true })
    .selectOption("Fantasy");
  await page
    .getByRole("button", { name: "Accept ornamentation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .level,
    )
    .toBe("Fantasy");
  const accepted = (await records(page))[0];
  expect(accepted.building.openings).toEqual(original.building.openings);
  expect(accepted.building.sections[0].exterior.windows).toEqual(
    original.building.sections[0].exterior.windows,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .level,
    )
    .toBe("None");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .level,
    )
    .toBe("Fantasy");
  const first = accepted.building.sections[0].exterior.ornamentation.items.find(
    (o) => o.type === "Dragon head",
  )!;
  await page
    .getByLabel("Selected ornament", { exact: true })
    .selectOption(first.id);
  await page
    .getByRole("button", { name: "Flip dragon direction", exact: true })
    .click();
  await page.getByLabel("Ornament variant", { exact: true }).selectOption("1");
  await page
    .getByRole("button", { name: "Accept ornamentation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await records(page)
        )[0].building.sections[0].exterior.ornamentation.items.find(
          (o) => o.id === first.id,
        )!.mirror,
    )
    .toBe(true);
  const scale = page.getByLabel("Ornament scale", { exact: true });
  await scale.fill("200");
  await scale.press("Enter");
  await expect(
    page.getByRole("button", { name: "Accept ornamentation", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Cancel ornament preview", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${p.name}`, exact: false })
    .click();
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await page
    .getByRole("button", { name: "Architectural Ornamentation", exact: true })
    .click();
  await expect(
    page.getByLabel("Ornamentation level", { exact: true }),
  ).toHaveValue("Fantasy");
  await page
    .getByRole("button", { name: "Reset ornamentation preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Accept ornamentation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .items.length,
    )
    .toBe(0);
});
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
test("ornamentation visual evidence: six architectural examples, multiple angles, section outline off", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  for (const [index, p] of ornamentExamples().entries()) {
    await load(page, p);
    await page
      .getByRole("button", { name: "Section outline", exact: true })
      .click();
    const v = page.locator(".exterior-viewport");
    await expect
      .poll(async () => Number(await v.getAttribute("data-triangles")))
      .toBeGreaterThan(0);
    for (const angle of ["front", "rear", "above"]) {
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      if (angle === "rear") await drag(page, 0.5, 0);
      if (angle === "above") await drag(page, 0, 0.1);
      await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
      if (index === 4) {
        await v.scrollIntoViewIfNeeded();
        if (angle === "front") {
          await page
            .getByRole("button", { name: "Pan 3D", exact: true })
            .click();
          await drag(page, 0.14, 0.06);
          await page
            .getByRole("button", { name: "Orbit", exact: true })
            .click();
        }
        await v.hover();
        await page.mouse.wheel(0, angle === "front" ? -1800 : -600);
      }
      const path = info.outputPath(`ornament-${index}-${angle}.png`);
      await page.locator(".exterior-wrap").screenshot({ path });
      await info.attach(`ornament-${index}-${angle}`, {
        path,
        contentType: "image/png",
      });
      await expect(v).toHaveAttribute("data-render-status", "ready");
    }
    if (index === 2 || index === 3) {
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      await page.getByRole("button", { name: "Pan 3D", exact: true }).click();
      await drag(page, -0.25, 0);
      await page.getByRole("button", { name: "Orbit", exact: true }).click();
      await v.hover();
      await page.mouse.wheel(0, -2000);
      const path = info.outputPath(`ornament-${index}-dragon-detail.png`);
      await page.locator(".exterior-wrap").screenshot({ path });
      await info.attach(`ornament-${index}-dragon-detail`, {
        path,
        contentType: "image/png",
      });
    }
  }
});

test("High-detail multi-wing crossing hall keeps draw calls bounded and camera-only interaction independent", async ({
  page,
}, info) => {
  const p = ornamentPerformanceBuilding();
  await load(page, p);
  const original = (await records(page))[0],
    v = page.locator(".exterior-viewport");
  await page
    .getByRole("button", { name: "Section outline", exact: true })
    .click();
  await expect
    .poll(async () => Number(await v.getAttribute("data-draw-calls")))
    .toBeGreaterThan(0);
  const calls = Number(await v.getAttribute("data-draw-calls")),
    triangles = Number(await v.getAttribute("data-triangles")),
    rebuilds = await v.getAttribute("data-mesh-rebuilds");
  expect(calls).toBeLessThan(180);
  expect(triangles).toBeLessThan(150000);
  const path = info.outputPath("ornament-performance-multi-wing.png");
  await page.locator(".exterior-wrap").screenshot({ path });
  await info.attach("carved-multi-wing", { path, contentType: "image/png" });
  await v.scrollIntoViewIfNeeded();
  await v.hover();
  await page.mouse.wheel(0, 3500);
  await expect
    .poll(async () => Number(await v.getAttribute("data-draw-calls")))
    .toBeLessThanOrEqual(calls);
  expect(await v.getAttribute("data-mesh-rebuilds")).toBe(rebuilds);
  expect((await records(page))[0]).toEqual(original);
  await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
