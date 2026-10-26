import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createProject, serializeProject, type Project } from "../src/model";
import {
  generateArchitecturalBuildings,
  purposeDefaults,
} from "../src/architecturalGenerator";
import { applyPreset } from "../src/footprint";
const saved = (p: Page) =>
  expect(p.getByRole("status").filter({ hasText: /^● Saved$/ })).toBeVisible();
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
async function open(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "purpose.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await saved(page);
  await page
    .getByRole("button", { name: "Interior Planning", exact: true })
    .click();
}
async function generator(page: Page, purpose: string) {
  await page
    .getByRole("button", { name: "Generate Layout", exact: true })
    .click();
  await page
    .getByLabel("Interior purpose preset", { exact: true })
    .selectOption(purpose);
}
async function generate(page: Page) {
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview layout A", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}
const structure = (p: Project) => ({
  ...p.building,
  interior: undefined,
  openings: undefined,
});
test("purpose worker cancellation, eight-room acceptance, manual edits, confirmation and complete history preserve architecture", async ({
  page,
}) => {
  test.setTimeout(120000);
  const p = createProject("Purpose Manor");
  p.building.sections[0].length = 24000;
  p.building.sections[0].width = 16000;
  await open(page, p);
  const original = (await records(page))[0];
  await generator(page, "Manor");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(original);
  await generator(page, "Manor");
  await generate(page);
  expect((await records(page))[0]).toEqual(original);
  await expect(page.locator(".generator-panel")).toContainText(
    "Required rooms satisfied: 6 / 6",
  );
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".layout-proposal")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Accept layout A", exact: true })
    .click();
  await saved(page);
  const accepted = (await records(page))[0];
  expect(accepted.building.interior.rooms).toHaveLength(8);
  expect(structure(accepted)).toEqual(structure(original));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await records(page))[0].building)
    .toEqual(original.building);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  await page
    .getByLabel("Select room", { exact: true })
    .selectOption({ index: 1 });
  await page.getByLabel("Room name", { exact: true }).fill("Private archive");
  await page.getByLabel("Room name", { exact: true }).press("Tab");
  await page
    .getByLabel("Room notes", { exact: true })
    .fill("Keep these handwritten planning notes");
  await page.getByLabel("Room notes", { exact: true }).press("Tab");
  const door = accepted.building.openings.find(
    (o) => o.host.kind === "partition",
  )!;
  await page
    .getByLabel("Select door/opening", { exact: true })
    .selectOption(door.id);
  await page.getByLabel("Opening width", { exact: true }).fill("0.8");
  await page.getByLabel("Opening width", { exact: true }).press("Enter");
  await saved(page);
  const edited = (await records(page))[0];
  expect(
    edited.building.interior.rooms.some((r) => r.notes.includes("handwritten")),
  ).toBe(true);
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const path = await (await event).path();
  expect(JSON.parse(await readFile(path!, "utf8"))).toEqual(edited);
  await generator(page, "Workshop");
  await generate(page);
  await page
    .getByRole("button", { name: "Accept layout A", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("8 room records");
  await expect(page.getByRole("dialog")).toContainText("Private archive");
  expect((await records(page))[0]).toEqual(edited);
  await page
    .getByRole("button", { name: "Keep current plan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel generation", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(edited);
  await generator(page, "Workshop");
  await generate(page);
  await page
    .getByRole("button", { name: "Accept layout A", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm replace interior", exact: true })
    .click();
  await saved(page);
  expect(structure((await records(page))[0])).toEqual(structure(edited));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await records(page))[0].building)
    .toEqual(edited.building);
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${p.name}`, exact: true })
    .click();
  expect((await records(page))[0].building).toEqual(edited.building);
});
test("production purpose plan screenshots, previews and mobile page flow", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const fixtures: { name: string; purpose: string; p: Project }[] = [];
  for (const [purpose, length, width] of [
    ["Viking Longhouse", 18000, 8000],
    ["Medieval Cottage", 8000, 6000],
    ["Workshop", 14000, 10000],
    ["Tavern/Inn", 18000, 12000],
    ["Manor", 24000, 16000],
    ["Trading Hall", 18000, 10000],
  ] as const) {
    const p = createProject(purpose);
    p.building.sections[0].length = length;
    p.building.sections[0].width = width;
    fixtures.push({
      name: purpose.toLowerCase().replace(/[^a-z]+/g, "-"),
      purpose,
      p,
    });
  }
  const wing = generateArchitecturalBuildings({
    ...purposeDefaults("Longhouse"),
    length: 18000,
    width: 8000,
    extensions: 3,
    complexity: "Grand",
    style: "Norse Chieftain's Hall",
    crossGables: "Prominent",
    ornamentation: "Fantasy",
  }).proposals[0].project;
  fixtures.push({
    name: "norse-three-wings",
    purpose: "Viking Longhouse",
    p: wing,
  });
  const t = createProject("T-shaped farmhouse");
  t.building.sections[0].length = 18000;
  t.building.sections[0].width = 12000;
  t.building.sections[0] = applyPreset(t.building.sections[0], "T-shape");
  fixtures.push({ name: "t-farmhouse", purpose: "Farmhouse", p: t });
  for (const fixture of fixtures) {
    await open(page, fixture.p);
    const before = await records(page);
    await generator(page, fixture.purpose);
    await generate(page);
    await expect(page.locator(".generator-panel")).toContainText(
      "rooms reachable",
    );
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const file = info.outputPath(`${fixture.name}.png`);
    await page.locator(".editor-main").screenshot({ path: file });
    await info.attach(fixture.name, { path: file, contentType: "image/png" });
    expect(await records(page)).toEqual(before);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page
      .getByLabel("Request 1 name", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByLabel("Request 1 name", { exact: true }).focus();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .getByRole("button", { name: "Cancel generation", exact: true })
      .click();
    expect(await records(page)).toEqual(before);
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await generator(page, "Custom");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
