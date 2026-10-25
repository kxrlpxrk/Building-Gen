import { test, expect, type Page } from "@playwright/test";
import { serializeProject, validateProject, type Project } from "../src/model";
import { wingFixture } from "./fixtures/roofCompositions";
import { defaultRoofFeature } from "../src/roofFeatures";
import { suggestedOrnament } from "../src/ornamentation";
import { ridgeAlongX } from "../src/exteriorSettings";
import { generateArchitecturalBuildings } from "../src/architecturalGenerator";
import { advancedExamples } from "./fixtures/advancedArchitecture";
async function records(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("building-generator-bg01", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const data = await new Promise<Project[]>((resolve, reject) => {
      const tx = db.transaction("projects"),
        r = tx.objectStore("projects").getAll();
      tx.oncomplete = () => resolve(r.result);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return data;
  });
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function open(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "building.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await saved(page);
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".exterior-viewport")
          .getAttribute("data-render-count"),
      ),
    )
    .toBeGreaterThan(0);
}

for (const style of ["Gable", "Hip"] as const)
  test(`extension ${style} directions are isolated, rendered, undoable and persisted`, async ({
    page,
  }) => {
    const p = wingFixture();
    p.building.sections[1].exterior.roofStyle = style;
    await open(page, p);
    const original = (await records(page))[0];
    await page
      .getByLabel("Exterior section", { exact: true })
      .selectOption(p.building.sections[1].id);
    const v = page.locator(".exterior-viewport"),
      oldMesh = await v.getAttribute("data-mesh-rebuilds");
    for (const axis of ["X", "Y"]) {
      await page
        .getByLabel("Ridge direction", { exact: true })
        .selectOption(axis);
      await expect
        .poll(
          async () =>
            (await records(page))[0].building.sections[1].exterior.ridgeAxis,
        )
        .toBe(axis);
      await expect(
        page.getByLabel("Ridge direction", { exact: true }),
      ).toHaveAttribute("aria-invalid", "false");
    }
    await expect
      .poll(() => v.getAttribute("data-mesh-rebuilds"))
      .not.toBe(oldMesh);
    expect((await records(page))[0].building.sections[0]).toEqual(
      original.building.sections[0],
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByLabel("Ridge direction", { exact: true }),
    ).toHaveValue("X");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await records(page))[0].building.sections[1].exterior.ridgeAxis,
      )
      .toBe("Y");
    // Ordinary editing must not restore the old automatic long-axis default.
    const height = page.getByLabel("Eaves height", { exact: true });
    await height.fill("3.1");
    await height.press("Enter");
    await expect
      .poll(
        async () =>
          (await records(page))[0].building.sections[1].exterior.wallHeight,
      )
      .toBe(3100);
    expect(
      (await records(page))[0].building.sections[1].exterior.ridgeAxis,
    ).toBe("Y");
    const accepted = (await records(page))[0];
    expect(
      serializeProject(validateProject(JSON.parse(serializeProject(accepted)))),
    ).toBe(serializeProject(accepted));
    await page.reload();
    await page
      .getByRole("button", { name: `Open ${p.name}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Exterior 3D", exact: true })
      .click();
    await page
      .getByLabel("Exterior section", { exact: true })
      .selectOption(p.building.sections[1].id);
    await expect(
      page.getByLabel("Ridge direction", { exact: true }),
    ).toHaveValue("Y");
  });
test("extension shed high edges persist and never change the main roof", async ({
  page,
}) => {
  const p = wingFixture();
  p.building.sections[1].exterior.roofStyle = "Shed";
  await open(page, p);
  await page
    .getByLabel("Exterior section", { exact: true })
    .selectOption(p.building.sections[1].id);
  for (const axis of ["+X", "-X", "+Y", "-Y"]) {
    await page.getByLabel("Shed high edge", { exact: true }).selectOption(axis);
    await expect
      .poll(
        async () =>
          (await records(page))[0].building.sections[1].exterior.shedHighEdge,
      )
      .toBe(axis);
    expect((await records(page))[0].building.sections[0]).toEqual(
      p.building.sections[0],
    );
  }
});
test("conflicting extension crossing direction explains rejection and offers one atomic rotation", async ({
  page,
}, info) => {
  const p = wingFixture(),
    s = p.building.sections[1];
  s.exterior.roofFeatures = [
    {
      ...defaultRoofFeature(s, "wing-cross"),
      width: 1800,
      depth: 3000,
      side: "Positive",
      pitch: 25,
    },
  ];
  validateProject(p);
  await open(page, p);
  const original = (await records(page))[0];
  await page.getByLabel("Exterior section", { exact: true }).selectOption(s.id);
  const axis = ridgeAlongX(s) ? "Y" : "X",
    select = page.getByLabel("Ridge direction", { exact: true });
  await select.selectOption(axis);
  await expect(select).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText(
    "No roof settings were saved",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Rotate host and crossing roofs",
  );
  expect((await records(page))[0]).toEqual(original);
  const described = await select.getAttribute("aria-describedby");
  expect(described).toBeTruthy();
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("crossing-direction-rejection.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: `Rotate host and crossing roofs to local ${axis}`,
      exact: true,
    })
    .click();
  await expect(select).toHaveValue(axis);
  await expect(select).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[1].exterior.ridgeAxis,
    )
    .toBe(axis);
  const accepted = (await records(page))[0];
  expect(accepted.building.sections[1].exterior.roofFeatures[0]).toMatchObject({
    id: "wing-cross",
    width: 1800,
    depth: 3000,
    pitch: 25,
  });
  expect(accepted.building.sections[0]).toEqual(original.building.sections[0]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await records(page))[0].building)
    .toEqual(original.building);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(async () => (await records(page))[0].building)
    .toEqual(accepted.building);
});
test("dragon support rejection is visible next to the control and never removes the ornament", async ({
  page,
}) => {
  const p = wingFixture(),
    s = p.building.sections[1];
  s.exterior.ridgeAxis = "X";
  const o = suggestedOrnament(p.building, s, "Dragon head");
  o.anchor = { kind: "roof", roofFeatureId: null, end: "Negative", offset: 0 };
  s.exterior.ornamentation = { level: "Ornate", items: [o] };
  validateProject(p);
  await open(page, p);
  const original = (await records(page))[0];
  await page.getByLabel("Exterior section", { exact: true }).selectOption(s.id);
  const select = page.getByLabel("Ridge direction", { exact: true });
  await select.selectOption("Y");
  await expect(select).toHaveValue("X");
  await expect(select).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText(
    "relocate the affected ornament",
  );
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByLabel("Exterior section", { exact: true })
    .selectOption(p.building.mainSectionId);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("locked extension direction is disabled with an associated unlock explanation", async ({
  page,
}) => {
  const p = wingFixture();
  p.building.sections[1].locked = true;
  await open(page, p);
  await page
    .getByLabel("Exterior section", { exact: true })
    .selectOption(p.building.sections[1].id);
  await expect(
    page.getByLabel("Ridge direction", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Roof direction is locked.", { exact: false }),
  ).toBeVisible();
});
test("generated three-extension hall direction edits either save explicitly or expose the validator reason", async ({
  page,
}) => {
  const p = generateArchitecturalBuildings(advancedExamples[2].config)
    .proposals[0].project;
  await open(page, p);
  for (const section of p.building.sections.slice(1)) {
    const before = (await records(page))[0];
    await page
      .getByLabel("Exterior section", { exact: true })
      .selectOption(section.id);
    const select = page.getByLabel("Ridge direction", { exact: true }),
      axis = ridgeAlongX(section) ? "Y" : "X";
    await select.selectOption(axis);
    await expect
      .poll(
        async () =>
          (await select.getAttribute("aria-invalid")) === "true" ||
          (await records(page))[0].building.sections.find(
            (s) => s.id === section.id,
          )!.exterior.ridgeAxis === axis,
      )
      .toBe(true);
    if ((await select.getAttribute("aria-invalid")) === "true") {
      await expect(page.getByRole("alert")).toContainText(
        "No roof settings were saved",
      );
      expect((await records(page))[0]).toEqual(before);
    } else
      expect(
        (await records(page))[0].building.sections.filter(
          (s) => s.id !== section.id,
        ),
      ).toEqual(before.building.sections.filter((s) => s.id !== section.id));
  }
});
