import { test, expect, type Page } from "@playwright/test";
import {
  createProject,
  serializeProject,
  validateProject,
  type Project,
} from "../src/model";
import { defaultRoofFeature } from "../src/roofFeatures";
import {
  generateArchitecturalBuildings,
  defaultArchitecturalConfig,
} from "../src/architecturalGenerator";
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
async function imported(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "roof.json",
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
async function value(page: Page, label: string, text: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(text);
  await input.press("Enter");
}
test("cross-gable preview/cancel, exact edits, atomic history and reopen keep footprint and architecture intact", async ({
  page,
}) => {
  const p = createProject("Manual cross roof");
  await imported(page, p);
  const original = (await records(page))[0];
  await page
    .getByRole("button", { name: "Add cross-gable preview", exact: true })
    .click();
  await expect(
    page.getByText(
      "Unsaved roof preview — orbit to inspect before accepting.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Cancel roof preview", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Add cross-gable preview", exact: true })
    .click();
  await value(page, "Cross-gable width", "3");
  await value(page, "Roof feature placement", "3.5");
  await page
    .getByLabel("Gable projection", { exact: true })
    .selectOption("Negative");
  await value(page, "Roof projection depth", "4");
  await expect(
    page.getByRole("button", { name: "Accept roof architecture", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Accept roof architecture", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
  const accepted = (await records(page))[0];
  expect(accepted.building.sections[0].exterior.roofFeatures).toHaveLength(1);
  expect(accepted.building.sections[0].length).toBe(
    original.building.sections[0].length,
  );
  expect(accepted.building.openings).toEqual(original.building.openings);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.roofFeatures
          .length,
    )
    .toBe(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.roofFeatures
          .length,
    )
    .toBe(1);
  await page
    .getByRole("button", {
      name: "Rotate crossing roof frame preview",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Accept roof architecture", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Accept roof architecture", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ridgeAxis,
    )
    .toBe("Y");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ridgeAxis,
    )
    .toBe("Auto");
  await value(page, "Roof projection depth", "1");
  await expect(
    page.getByRole("button", { name: "Accept roof architecture", exact: true }),
  ).toBeDisabled();
  expect((await records(page))[0].building).toEqual(accepted.building);
  await page
    .getByRole("button", { name: "Cancel roof preview", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Manual cross roof", exact: false })
    .click();
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  const id = accepted.building.sections[0].exterior.roofFeatures[0].id;
  await page
    .getByLabel("Selected roof feature", { exact: true })
    .selectOption(id);
  await expect(
    page.getByLabel("Cross-gable width", { exact: true }),
  ).toHaveValue("3");
  await page
    .getByRole("button", { name: "Remove roof feature preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Accept roof architecture", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.roofFeatures
          .length,
    )
    .toBe(0);
});
function fixtures() {
  const hall = createProject("18 m crossing hall"),
    s = hall.building.sections[0];
  s.length = 18000;
  s.exterior.detailLevel = "High";
  s.exterior.roofFeatures = [defaultRoofFeature(s, "cross-hall")];
  const offset = structuredClone(hall);
  offset.id = "offset-project";
  offset.name = "Offset L roof";
  offset.building.sections[0].exterior.roofFeatures = [
    {
      ...s.exterior.roofFeatures[0],
      side: "Negative",
      offset: 4000,
      width: 3000,
      depth: 4000,
      relativeHeight: 200,
      pitch: 48,
    },
  ];
  const generated = generateArchitecturalBuildings({
    ...defaultArchitecturalConfig(),
    extensions: 3,
    detail: "High",
    style: "Norse Chieftain's Hall",
  }).proposals[0].project;
  let found = false;
  for (const side of ["Negative", "Positive"] as const)
    for (let offset = 2000; offset < 16000 && !found; offset += 1000) {
      const candidate = structuredClone(generated),
        sec = candidate.building.sections[0];
      sec.exterior.roofFeatures = [
        {
          ...defaultRoofFeature(sec, "wing-cross"),
          width: 2400,
          offset,
          depth: 4000,
          side,
        },
      ];
      try {
        validateProject(candidate);
        generated.building = candidate.building;
        found = true;
      } catch {}
    }
  if (!found)
    throw new Error("No exposed cross-gable bay in fixed multi-wing fixture.");
  return [hall, offset, generated].map(validateProject);
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
test("cross-gable screenshot evidence: full cross, offset L/T and multi-wing from four sides selected/unselected", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  for (const [index, p] of fixtures().entries()) {
    await imported(page, p);
    const v = page.locator(".exterior-viewport");
    for (const view of ["front", "above", "rear", "opposite"]) {
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      if (view === "above") await drag(page, 0, 0.1);
      if (view === "rear") await drag(page, 0.5, 0);
      if (view === "opposite") await drag(page, 0.25, 0);
      await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
      const triangles = await v.getAttribute("data-triangles"),
        rebuilds = await v.getAttribute("data-mesh-rebuilds");
      for (const selected of [true, false]) {
        const toggle = page.getByRole("button", {
          name: "Section outline",
          exact: true,
        });
        if ((await toggle.getAttribute("aria-pressed")) !== String(selected))
          await toggle.click();
        const file = `cross-${index}-${view}-${selected ? "selected" : "unselected"}.png`,
          path = info.outputPath(file);
        await page.locator(".exterior-wrap").screenshot({ path });
        await info.attach(file, { path, contentType: "image/png" });
        expect(await v.getAttribute("data-triangles")).toBe(triangles);
        expect(await v.getAttribute("data-mesh-rebuilds")).toBe(rebuilds);
      }
    }
  }
});
