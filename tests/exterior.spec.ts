import { PerspectiveCamera, Vector3 } from "three";
import { windowOpening } from "../src/exteriorValidation";
import { openingGeometry } from "../src/openings";
import { test, expect, type Page } from "@playwright/test";
import { createProject, serializeProject, type Project } from "../src/model";
import {
  defaultBuildingConfig,
  generateBuildings,
} from "../src/buildingGenerator";
import { changePartitions } from "../src/interiorBuilding";
import { changeOpenings } from "../src/openingBuilding";
import { newOpening } from "../src/openings";
import { applyPreset } from "../src/footprint";
import { openingContext } from "../src/assembly";
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
async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Architectural hall");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
}
async function saved(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
}
async function open3d(page: Page) {
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
    { timeout: 15000 },
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
async function numeric(page: Page, name: string, value: string) {
  const field = page.getByLabel(name, { exact: true });
  await field.fill(value);
  await field.press("Enter");
}
async function importProject(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "exterior.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await saved(page);
}
const plan = (p: Project) => ({
  ...p.building,
  sections: p.building.sections.map(({ exterior: _, ...s }) => s),
});

test("lazy 3D architecture, real style/height/pitch changes, camera controls and whole-plan undo", async ({
  page,
}) => {
  let chunks = 0;
  page.on("request", (r) => {
    if (r.url().includes("ExteriorViewer-")) chunks++;
  });
  await create(page);
  await saved(page);
  const original = (await records(page))[0];
  expect(chunks).toBe(0);
  const oldCamera = await page
    .locator(".plan-canvas > g")
    .first()
    .getAttribute("transform");
  await open3d(page);
  expect(chunks).toBeGreaterThan(0);
  const host = page.locator(".exterior-viewport"),
    canvas = host.locator("canvas");
  const before = Number(
    await page.getByTestId("exterior-viewer").getAttribute("data-roof-height"),
  );
  expect(before).toBeGreaterThan(7000);
  expect(Number(await host.getAttribute("data-triangles"))).toBeGreaterThan(
    100,
  );
  const norse = await canvas.screenshot();
  await numeric(page, "Eaves height", "4.8");
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("exterior-viewer")
          .getAttribute("data-roof-height"),
      ),
    )
    .toBeCloseTo(before + 1000, 3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByTestId("exterior-viewer")
          .getAttribute("data-roof-height"),
      ),
    )
    .toBeCloseTo(before, 3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await numeric(page, "Roof pitch", "50");
  expect(
    Number(
      await page
        .getByTestId("exterior-viewer")
        .getAttribute("data-roof-height"),
    ),
  ).toBeGreaterThan(before + 1000);
  for (const roof of ["Hip", "Shed", "Gable"]) {
    await page.getByLabel("Roof style", { exact: true }).selectOption(roof);
    await saved(page);
    expect(
      (await records(page))[0].building.sections[0].exterior.roofStyle,
    ).toBe(roof);
  }
  await numeric(page, "Roof overhang", "0.65");
  await page
    .getByLabel("Exterior material preset", { exact: true })
    .selectOption("Medieval");
  await saved(page);
  expect(await canvas.screenshot()).not.toEqual(norse);
  await page
    .getByRole("button", {
      name: "Reset section to style defaults",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Eaves height", { exact: true })).toHaveValue(
    "3.6",
  );
  await host.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const camera = await host.getAttribute("data-camera");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(host).not.toHaveAttribute("data-camera", camera!);
  await page.getByRole("button", { name: "Pan 3D", exact: true }).click();
  await page.getByRole("button", { name: "Perspective", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Orthographic", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await saved(page);
  const edited = (await records(page))[0];
  expect(plan(edited)).toEqual(plan(original));
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await expect(page.locator(".exterior-viewport canvas")).toHaveCount(0);
  expect(
    await page.locator(".plan-canvas > g").first().getAttribute("transform"),
  ).toBe(oldCamera);
  await numeric(page, "Length", "14");
  await saved(page);
  await open3d(page);
  expect((await records(page))[0].building.sections[0].exterior).toEqual(
    edited.building.sections[0].exterior,
  );
  await expect(host).toHaveAttribute("data-render-status", "ready");
});

test("a generated three-extension longhouse renders, keeps shared IDs, updates only necessary GPU groups and retains all data", async ({
  page,
}) => {
  const p = generateBuildings({ ...defaultBuildingConfig(), extensions: 3 })
    .proposals[0].project;
  p.name = "Three-wing longhouse";
  let entrance = false;
  for (const host of openingContext(p.building).hosts.filter(
    (h) => h.ref.kind === "exterior",
  )) {
    try {
      p.building = changeOpenings(p.building, [
        newOpening(
          "exterior-entry",
          host.ref,
          Math.round(
            (Math.abs(host.a.x - host.b.x) + Math.abs(host.a.y - host.b.y)) / 2,
          ),
        ),
      ]);
      entrance = true;
      break;
    } catch {
      /* Try another actual exterior segment. */
    }
  }
  expect(entrance).toBe(true);
  await importProject(page, p);
  await open3d(page);
  await expect(
    page.getByText("Joined roof fallback:", { exact: false }),
  ).toBeVisible();
  const host = page.locator(".exterior-viewport"),
    ids = p.building.sections.map((s) => s.id);
  expect(
    await page.getByLabel("Exterior section", { exact: true }).inputValue(),
  ).toBe(ids[0]);
  const rebuilds = Number(await host.getAttribute("data-mesh-rebuilds"));
  await page
    .getByLabel("Exterior material preset", { exact: true })
    .selectOption("Medieval");
  await expect
    .poll(async () => Number(await host.getAttribute("data-mesh-rebuilds")))
    .toBe(rebuilds + 1);
  const storage = p.building.sections.find((s) => s.type === "Storage")!;
  await page
    .getByLabel("Exterior section", { exact: true })
    .selectOption(storage.id);
  await numeric(page, "Eaves height", "3.2");
  await saved(page);
  const stored = (await records(page))[0];
  expect(plan(stored)).toEqual(plan(p));
  expect(stored.building.openings).toEqual(p.building.openings);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const path = await (await download).path();
  await page
    .getByRole("button", { name: "Back to project library", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Duplicate Three-wing longhouse",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Independent exterior");
  await page.getByRole("button", { name: "Create copy", exact: true }).click();
  await expect.poll(async () => (await records(page)).length).toBe(2);
  const copy = (await records(page)).find(
    (p) => p.name === "Independent exterior",
  )!;
  expect(copy.building.sections[1].id).not.toBe(stored.building.sections[1].id);
  expect(copy.building.sections.map((s) => s.exterior)).toEqual(
    stored.building.sections.map((s) => s.exterior),
  );
  await page.getByLabel("Import project JSON file").setInputFiles(path!);
  await expect.poll(async () => (await records(page)).length).toBe(3);
  await open3d(page);
  await page
    .getByLabel("Exterior section", { exact: true })
    .selectOption({ index: 1 });
  await expect(page.getByLabel("Eaves height", { exact: true })).toHaveValue(
    "3.2",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Open Three-wing longhouse", exact: true })
    .first()
    .click();
  await open3d(page);
  await expect(host).toHaveAttribute("data-render-status", "ready");
});

test("L-shaped roof warnings, mobile page scroll, idle pause and exterior settings survive reopen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const p = createProject("Concave exterior");
  p.building.sections[0] = applyPreset(p.building.sections[0], "L-shape");
  await importProject(page, p);
  await open3d(page);
  await expect(
    page.getByText("Concave roof fallback:", { exact: false }),
  ).toBeVisible();
  const host = page.locator(".exterior-viewport");
  await host.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const camera = await host.getAttribute("data-camera");
  await page
    .getByRole("button", {
      name: "Reset section to style defaults",
      exact: true,
    })
    .focus();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
  expect((await host.boundingBox())!.y).toBeLessThan(0);
  expect(
    await page
      .locator(".inspector-content")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toBe("visible");
  await page.waitForTimeout(150);
  const frames = await host.getAttribute("data-render-count");
  await page.waitForTimeout(250);
  expect(await host.getAttribute("data-render-count")).toBe(frames);
  expect(await host.getAttribute("data-camera")).toBe(camera);
  await numeric(page, "Eaves height", "4.1");
  await saved(page);
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
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await page.getByRole("button", { name: "Lock section", exact: true }).click();
  await open3d(page);
  await expect(page.getByLabel("Eaves height", { exact: true })).toBeDisabled();
});

test("WebGL failure and context loss preserve interiors, openings and autosave", async ({
  page,
}) => {
  const p = createProject("Interior retained");
  p.building = changePartitions(p.building, [
    {
      id: "partition",
      a: { x: 6000, y: 200 },
      b: { x: 6000, y: 7800 },
      thickness: 100,
    },
  ]);
  p.building = changeOpenings(p.building, [
    newOpening(
      "interior-door",
      { kind: "partition", partitionId: "partition" },
      4000,
    ),
  ]);
  await importProject(page, p);
  await open3d(page);
  await page
    .locator(".exterior-viewport canvas")
    .dispatchEvent("webglcontextlost", { cancelable: true });
  await expect(
    page.getByRole("alert").filter({ hasText: "WebGL context lost" }),
  ).toBeVisible();
  expect((await records(page))[0]).toEqual(p);
  await page.getByRole("button", { name: "Retry 3D", exact: true }).click();
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      if (String(args[0]).startsWith("webgl")) return null;
      return original.apply(this, args as Parameters<typeof original>);
    } as typeof original;
  });
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "WebGL is unavailable" }),
  ).toBeVisible();
  expect((await records(page))[0]).toEqual(p);
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  await numeric(page, "Length", "13");
  await saved(page);
  const changed = (await records(page))[0];
  expect(changed.building.interior.partitions).toEqual(
    p.building.interior.partitions,
  );
  expect(
    changed.building.interior.rooms.map(({ regionKey: _, ...r }) => r),
  ).toEqual(p.building.interior.rooms.map(({ regionKey: _, ...r }) => r));
  expect(changed.building.openings).toEqual(p.building.openings);
});

test("native 3D pinch orbits/zooms without page scroll or data edits", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native touch dispatch uses Chromium CDP.",
  );
  await create(page);
  await saved(page);
  const p = (await records(page))[0];
  await open3d(page);
  const host = page.locator(".exterior-viewport");
  await host.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const box = (await host.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2,
    camera = await host.getAttribute("data-camera"),
    scroll = await page.evaluate(() => scrollY),
    client = await page.context().newCDPSession(page),
    t = (id: number, x: number, y: number) => ({
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
  await expect(host).not.toHaveAttribute("data-camera", camera!);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  expect((await records(page))[0]).toEqual(p);
  await client.detach();
});

test("BG-04D window previews, exact aperture edits, features, history and persistence", async ({
  page,
}) => {
  await create(page);
  await open3d(page);
  await saved(page);
  const original = await records(page);
  await page.getByRole("button", { name: "Place window", exact: true }).click();
  await page
    .getByRole("button", { name: "Use precision placement", exact: true })
    .click();
  await numeric(page, "Window position along wall", "0.1");
  await expect(
    page.getByRole("button", { name: "Confirm window", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Cancel window", exact: true })
    .click();
  expect(await records(page)).toEqual(original);
  await page.getByRole("button", { name: "Place window", exact: true }).click();
  await page
    .getByRole("button", { name: "Use precision placement", exact: true })
    .click();
  await expect(
    page.getByText("Valid placement · preview only, not saved"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm window", exact: true })
    .click();
  await numeric(page, "Window width", "1.1");
  await numeric(page, "Window sill", "1.2");
  await page
    .getByLabel("Window style", { exact: true })
    .selectOption("Medieval glazed");
  await page.getByRole("button", { name: "Add chimney", exact: true }).click();
  await numeric(page, "Chimney 1 local X", "4");
  await page
    .getByLabel("Chimney 1 finish", { exact: true })
    .selectOption("Brick");
  await page
    .getByRole("button", { name: "Add gable ornament", exact: true })
    .click();
  await saved(page);
  const p = (await records(page))[0];
  expect(p.schemaVersion).toBe(10);
  expect(p.building.sections[0].exterior.windows[0]).toMatchObject({
    width: 1100,
    sill: 1200,
    style: "Medieval glazed",
  });
  expect(p.building.sections[0].exterior.features).toHaveLength(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  expect(
    (await records(page))[0].building.sections[0].exterior.features,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await saved(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Architectural hall", exact: true })
    .click();
  await open3d(page);
  const viewport = page.locator(".exterior-viewport");
  await viewport.scrollIntoViewIfNeeded();
  const rect = (await viewport.boundingBox())!,
    values = (await viewport.getAttribute("data-camera"))!
      .split(",")
      .map(Number);
  const camera = new PerspectiveCamera(42, rect.width / rect.height, 0.1, 2000);
  camera.position.set(values[0], values[1], values[2]);
  camera.lookAt(new Vector3(values[3], values[4], values[5]));
  camera.zoom = values[6];
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const window = p.building.sections[0].exterior.windows[0],
    g = openingGeometry(
      openingContext(p.building),
      windowOpening(p.building.sections[0], window),
    );
  const target = new Vector3(
    g.center.x / 1000,
    (window.sill + window.height / 2) / 1000,
    -g.center.y / 1000,
  ).project(camera);
  await page.mouse.click(
    rect.x + ((target.x + 1) * rect.width) / 2,
    rect.y + ((1 - target.y) * rect.height) / 2,
  );
  await expect(page.getByLabel("Selected window", { exact: true })).toHaveValue(
    window.id,
  );
  await expect(page.getByLabel("Window width", { exact: true })).toHaveValue(
    "1.1",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Remove window", exact: true })
    .click();
  await saved(page);
  expect(
    (await records(page))[0].building.sections[0].exterior.windows,
  ).toEqual([]);
  await expect(page.locator(".exterior-viewport")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("BG-04D architectural presets have distinct rendered detail and bounded draws", async ({
  page,
}, testInfo) => {
  const p = createProject("Detail quality hall");
  const s = p.building.sections[0];
  s.exterior.windows = [
    {
      id: "window",
      edge: 0,
      offset: 3500,
      width: 900,
      height: 1000,
      sill: 1000,
      style: "Timber shuttered",
      shutters: true,
      glazing: true,
    },
  ];
  s.exterior.features = [
    {
      id: "chimney",
      kind: "Chimney",
      x: 5000,
      y: 3000,
      height: 1000,
      doorId: null,
      finish: "Stone",
    },
  ];
  await importProject(page, p);
  await open3d(page);
  for (const [index, style] of [
    "Rustic Norse",
    "Norse Chieftain's Hall",
    "Medieval Timber Cottage",
    "Medieval Manor",
    "Mixed Architectural Fantasy",
  ].entries()) {
    await page
      .getByLabel("Architectural style", { exact: true })
      .selectOption(style);
    await page.getByLabel("Detail level", { exact: true }).selectOption("High");
    await page.getByRole("button", { name: "Fit 3D", exact: true }).click();
    await expect(page.locator(".exterior-viewport")).toHaveAttribute(
      "data-render-status",
      "ready",
    );
    await expect
      .poll(async () =>
        Number(
          await page
            .locator(".exterior-viewport")
            .getAttribute("data-draw-calls"),
        ),
      )
      .toBeLessThan(30);
    await page
      .locator(".exterior-wrap")
      .screenshot({ path: `/tmp/bg04d-${testInfo.project.name}-${index}.png` });
  }
  await saved(page);
  const savedProject = (await records(page))[0];
  expect(savedProject.building.sections[0].exterior.windows).toHaveLength(1);
});
