import { attachmentPreview } from "../src/attachments";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { Camera, Vector3 } from "three";
import { serializeProject, validateProject, type Project } from "../src/model";
import { ornamentBuilding } from "./fixtures/ornamentBuildings";
import {
  ORNAMENT_TYPES,
  suggestedOrnament,
  resolveOrnament,
} from "../src/ornamentation";
import {
  ornamentPlacementContext,
  placeOrnament,
} from "../src/ornamentPlacement";
import { defaultRoofFeature } from "../src/roofFeatures";
import { generateArchitecturalBuildings } from "../src/architecturalGenerator";
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
async function open(page: Page, p: Project) {
  await page.goto("/");
  await page.getByLabel("Import project JSON file").setInputFiles({
    name: "ornament-direct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await expect(
    page.getByRole("status").filter({ hasText: /^● Saved$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(view(page)).toHaveAttribute("data-render-status", "ready");
  await expect
    .poll(() => view(page).getAttribute("data-projection"))
    .not.toBeNull();
  await page
    .getByRole("button", { name: "Section outline", exact: true })
    .click();
}
const view = (p: Page) => p.locator(".exterior-viewport");
async function point(
  page: Page,
  b: Project["building"],
  p: { x: number; y: number; z: number },
) {
  const v = view(page);
  await v.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const r = (await v.boundingBox())!,
        m = (await v.getAttribute("data-projection"))!.split(",").map(Number);
      return Math.abs(m[5] / m[0] - r.width / r.height);
    })
    .toBeLessThan(0.001);
  const r = (await v.boundingBox())!,
    a = (await v.getAttribute("data-camera"))!.split(",").map(Number),
    matrix = (await v.getAttribute("data-projection"))!.split(",").map(Number);
  const camera = new Camera();
  camera.position.set(...(a.slice(0, 3) as [number, number, number]));
  camera.lookAt(new Vector3(...(a.slice(3, 6) as [number, number, number])));
  camera.updateMatrixWorld();
  camera.projectionMatrix.fromArray(matrix);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const q = new Vector3(p.x / 1000, p.z / 1000, -p.y / 1000)
    .applyAxisAngle(
      new Vector3(0, 1, 0),
      ((b.frame.axis + b.frame.rotation) * Math.PI) / 180,
    )
    .add(
      new Vector3(
        b.frame.origin.x / 1000,
        b.sections[0].position.z / 1000,
        -b.frame.origin.y / 1000,
      ),
    )
    .project(camera);
  return {
    x: r.x + ((q.x + 1) * r.width) / 2,
    y: r.y + ((1 - q.y) * r.height) / 2,
  };
}
async function tap(
  page: Page,
  b: Project["building"],
  p: { x: number; y: number; z: number },
) {
  const q = await point(page, b, p);
  await page.mouse.click(q.x, q.y);
}
async function drag(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 15 });
  await page.mouse.up();
}
async function start(page: Page, type: string) {
  await page
    .getByRole("button", { name: "Place Ornament", exact: true })
    .click();
  await page
    .getByLabel("Direct ornament type", { exact: true })
    .selectOption(type);
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  if (name.includes("selected") || name.includes("invalid"))
    await page.screenshot({ path, fullPage: true });
  else await page.locator(".editor-main").screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}
const confirm = (page: Page) =>
  page.getByRole("button", { name: "Confirm ornament placement", exact: true });
for (const type of ORNAMENT_TYPES)
  test(`direct 3D placement: ${type}`, async ({ page }, info) => {
    const p = ornamentBuilding(),
      b = p.building,
      ctx = ornamentPlacementContext(b),
      roof = [
        "Dragon head",
        "Gable finial",
        "Gable panel",
        "Bargeboard",
        "Ridge trim",
      ].includes(type);
    await open(page, p);
    const original = await records(page),
      rebuilds = await view(page).getAttribute("data-mesh-rebuilds");
    await start(page, type);
    await tap(
      page,
      b,
      roof
        ? { x: 18000, y: 4000, z: ctx.roofAt({ x: 18000, y: 4000 }) - 450 }
        : { x: type === "Entrance pillars" ? 8350 : 5000, y: 0, z: 1800 },
    );
    await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
    expect(await records(page)).toEqual(original);
    expect(await view(page).getAttribute("data-mesh-rebuilds")).toBe(rebuilds);
    if (type === "Dragon head" || type === "Shield")
      await capture(
        page,
        info,
        type === "Shield" ? "shield-wall-preview" : "dragon-placement-preview",
      );
    await confirm(page).click();
    await expect
      .poll(
        async () =>
          (await records(page))[0].building.sections[0].exterior.ornamentation
            .items.length,
      )
      .toBe(1);
    const saved = (await records(page))[0];
    expect(
      saved.building.sections[0].exterior.ornamentation.items[0].type,
    ).toBe(type);
    expect(saved.building.openings).toEqual(b.openings);
    expect(saved.building.sections[0].exterior.roofFeatures).toEqual(
      b.sections[0].exterior.roofFeatures,
    );
  });
test("pick a visible shield, drag in two dimensions, cancel/confirm/history, invalid feedback and tool isolation", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const p = ornamentBuilding(),
    b = p.building,
    s = b.sections[0];
  const o = {
    ...suggestedOrnament(b, s, "Shield"),
    variant: 3 as const,
    finish: "Ochre" as const,
    scale: 850,
    mirror: true,
    anchor: { kind: "wall" as const, edge: 0, offset: 5000, sill: 1200 },
  };
  p.building = placeOrnament(b, { sectionId: s.id, ornament: o }, null);
  await open(page, p);
  const original = (await records(page))[0];
  const center = { x: 5000, y: -150, z: 1200 + 450 * 0.85 };
  await tap(page, p.building, center);
  await expect(
    page.getByLabel("Selected ornament", { exact: true }),
  ).toHaveValue(o.id);
  await expect(page.getByLabel("Ornament finish", { exact: true })).toHaveValue(
    "Ochre",
  );
  if ((page.viewportSize()?.width ?? 0) > 650)
    await page
      .getByLabel("Selected ornament", { exact: true })
      .scrollIntoViewIfNeeded();
  await capture(page, info, "selected-shield-inspector");
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  const from = await point(page, p.building, center),
    to = await point(page, p.building, { x: 6500, y: 0, z: 2200 });
  await drag(page, from, to);
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Cancel ornament placement", exact: true })
    .click();
  expect((await records(page))[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await drag(
    page,
    await point(page, p.building, center),
    await point(page, p.building, { x: 6500, y: 0, z: 2200 }),
  );
  await confirm(page).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .items[0].anchor,
    )
    .not.toEqual(o.anchor);
  const moved = (await records(page))[0],
    m = moved.building.sections[0].exterior.ornamentation.items[0];
  expect({ ...m, anchor: o.anchor }).toEqual(o);
  expect(m.anchor).toMatchObject({ kind: "wall" });
  if (m.anchor.kind === "wall") {
    expect(m.anchor.offset).toBeGreaterThan(5000);
    expect(m.anchor.sill).toBeGreaterThan(1200);
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await records(page))[0].building)
    .toEqual(original.building);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(async () => (await records(page))[0].building)
    .toEqual(moved.building);
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await tap(page, moved.building, { x: 2000, y: 0, z: 1700 });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "invalid");
  await expect(confirm(page)).toBeDisabled();
  await capture(page, info, "invalid-window-overlap");
  await tap(page, moved.building, { x: 9000, y: 3500, z: 7800 });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "invalid");
  await expect(page.locator(".ornament-placement-controls")).toContainText(
    "exposed exterior wall",
  );
  await capture(page, info, "invalid-roof-for-shield");
  await page.getByRole("button", { name: "Place Window", exact: true }).click();
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "none");
  await page
    .getByRole("button", { name: "Place Ornament", exact: true })
    .click();
  await expect(view(page)).toHaveAttribute("data-window-preview", "none");
  await page.getByRole("button", { name: "Orbit", exact: true }).click();
  const v = view(page);
  await v.scrollIntoViewIfNeeded();
  const r = (await v.boundingBox())!;
  await drag(
    page,
    { x: r.x + r.width * 0.45, y: r.y + r.height * 0.6 },
    { x: r.x + r.width * 0.55, y: r.y + r.height * 0.6 },
  );
  expect((await records(page))[0].building).toEqual(moved.building);
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${p.name}`, exact: false })
    .click();
  expect((await records(page))[0].building).toEqual(moved.building);
});
test("dragon selection and relocation onto a cross-gable keep the original until confirmation", async ({
  page,
}, info) => {
  const p = ornamentBuilding(),
    s = p.building.sections[0];
  s.exterior.roofFeatures = [defaultRoofFeature(s, "direct-cross")];
  const o = {
    ...suggestedOrnament(p.building, s, "Dragon head"),
    variant: 3 as const,
    finish: "Dark wood" as const,
    anchor: {
      kind: "roof" as const,
      roofFeatureId: null,
      end: "Positive" as const,
      offset: 0,
    },
  };
  p.building = placeOrnament(
    p.building,
    { sectionId: s.id, ornament: o },
    null,
  );
  validateProject(p);
  await open(page, p);
  const old = (await records(page))[0],
    ctx = ornamentPlacementContext(p.building),
    f = resolveOrnament(p.building, s, o, ctx.roofAt, ctx.opening);
  const skull = {
    x: f.origin.x + f.u.x * 900 * f.size - f.v.x * 115 * f.size,
    y: f.origin.y + f.u.y * 900 * f.size - f.v.y * 115 * f.size,
    z: f.origin.z + 1100 * f.size,
  };
  await tap(page, p.building, skull);
  await expect(
    page.getByLabel("Selected ornament", { exact: true }),
  ).toHaveValue(o.id);
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await tap(page, p.building, {
    x: 9000,
    y: 0,
    z: ctx.roofAt({ x: 9000, y: 0 }) - 450,
  });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  await expect(
    page.getByLabel("Ornament roof anchor", { exact: true }),
  ).toHaveValue("direct-cross");
  expect((await records(page))[0]).toEqual(old);
  await capture(page, info, "dragon-cross-gable-move");
  await confirm(page).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .items[0].anchor,
    )
    .toMatchObject({
      roofFeatureId: "direct-cross",
      end: "Negative",
      offset: 0,
    });
  const moved = (await records(page))[0].building.sections[0].exterior
    .ornamentation.items[0];
  expect({ ...moved, anchor: o.anchor }).toEqual(o);
});
test("hidden ornaments cannot be picked through a roof or opposite wall", async ({
  page,
}) => {
  const p = ornamentBuilding(),
    s = p.building.sections[0],
    o = {
      ...suggestedOrnament(p.building, s, "Shield"),
      anchor: { kind: "wall" as const, edge: 2, offset: 5000, sill: 1200 },
    };
  p.building = placeOrnament(
    p.building,
    { sectionId: s.id, ornament: o },
    null,
  );
  await open(page, p);
  const ctx = ornamentPlacementContext(p.building),
    f = resolveOrnament(p.building, s, o, ctx.roofAt, ctx.opening);
  await tap(page, p.building, {
    x: f.origin.x + f.v.x * 160,
    y: f.origin.y + f.v.y * 160,
    z: f.origin.z + 450,
  });
  await expect(
    page.getByRole("button", { name: "Move Ornament", exact: true }),
  ).toHaveCount(0);
  await start(page, "Gable panel");
  const roof = ornamentPlacementContext(p.building).roofAt({ x: 0, y: 4000 });
  await tap(page, p.building, { x: 0, y: 4000, z: roof - 600 });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "invalid");
  await expect(confirm(page)).toBeDisabled();
  expect((await records(page))[0].building).toEqual(p.building);
});
test("native second-finger handoff and pointer cancellation never commit ornament drags", async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    !isMobile || browserName !== "chromium",
    "Native Chromium multi-touch fixture",
  );
  const p = ornamentBuilding();
  await open(page, p);
  const old = await records(page);
  await start(page, "Shield");
  const cancelPoint = await point(page, p.building, { x: 5000, y: 0, z: 1800 });
  await page.mouse.move(cancelPoint.x, cancelPoint.y);
  await page.mouse.down();
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  await view(page).locator("canvas").dispatchEvent("pointercancel", {
    pointerId: 1,
    pointerType: "mouse",
    clientX: cancelPoint.x,
    clientY: cancelPoint.y,
  });
  await page.mouse.up();
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "waiting");
  const a = await point(page, p.building, { x: 5000, y: 0, z: 1800 }),
    v = view(page),
    session = await page.context().newCDPSession(page);
  const touch = (id: number, x: number, y: number) => ({
    id,
    x,
    y,
    radiusX: 5,
    radiusY: 5,
    force: 1,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, a.x, a.y)],
  });
  await expect(v).toHaveAttribute("data-ornament-preview", "valid");
  const camera = await v.getAttribute("data-camera");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch(1, a.x, a.y), touch(2, a.x + 35, a.y - 25)],
  });
  for (let i = 1; i <= 5; i++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        touch(1, a.x - i * 5, a.y + i * 3),
        touch(2, a.x + 35 + i * 5, a.y - 25 - i * 3),
      ],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(v).toHaveAttribute("data-ornament-preview", "waiting");
  await expect.poll(() => v.getAttribute("data-camera")).not.toBe(camera);
  expect(await records(page)).toEqual(old);
  await page
    .getByRole("button", { name: "Cancel ornament placement", exact: true })
    .click();
  await session.detach();
});
test("BG-06C generated ornaments select through their existing IDs", async ({
  page,
}) => {
  const p = generateArchitecturalBuildings(advancedExamples[1].config)
    .proposals[0].project;
  await open(page, p);
  const set = p.building.sections.find((s) =>
    s.exterior.ornamentation.items.some((o) => o.type === "Dragon head"),
  )!;
  const o = set.exterior.ornamentation.items.find(
    (o) => o.type === "Dragon head",
  )!;
  // Inspector selection remains available even when a generated anchor is on the opposite side.
  await page
    .getByRole("button", { name: "Architectural Ornamentation", exact: true })
    .click();
  await page
    .getByLabel("Selected ornament", { exact: true })
    .selectOption(o.id);
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await expect(
    page.getByLabel("Direct ornament type", { exact: true }),
  ).toHaveValue("Dragon head");
  const offset = o.anchor.kind === "roof" ? o.anchor.offset + 100 : 100;
  if (o.anchor.kind !== "roof")
    throw new Error("Fixture expects a generated roof terminal.");
  placeOrnament(
    p.building,
    { sectionId: set.id, ornament: { ...o, anchor: { ...o.anchor, offset } } },
    { sectionId: set.id, ornament: o },
  );
  const input = page.getByLabel("Ornament ridge offset", { exact: true });
  await input.fill(String(offset / 1000));
  await input.press("Enter");
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  expect((await records(page))[0].building).toEqual(p.building);
  await confirm(page).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections
          .find((s) => s.id === set.id)!
          .exterior.ornamentation.items.find((item) => item.id === o.id)!
          .anchor,
    )
    .toMatchObject({ offset });
});

function wingFixture() {
  const p = ornamentBuilding();
  const result = attachmentPreview(p.building, {
    id: "placement-wing",
    name: "Placement wing",
    type: "Residential Wing",
    length: 6000,
    width: 4000,
    shape: "Rectangle",
    edge: 1,
    offset: 1000,
  });
  if (!result.building) throw new Error(result.error!);
  p.building = result.building;
  const s = p.building.sections[0],
    o = {
      ...suggestedOrnament(p.building, s, "Shield"),
      anchor: { kind: "wall" as const, edge: 0, offset: 5000, sill: 1200 },
    };
  p.building = placeOrnament(
    p.building,
    { sectionId: s.id, ornament: o },
    null,
  );
  return { p, o };
}
test("move to another section and retain precise hits after scrolling, rotation and orthographic projection", async ({
  page,
}) => {
  const { p, o } = wingFixture();
  p.building.frame.rotation = 37;
  await open(page, p);
  await page.getByRole("button", { name: "Perspective", exact: true }).click();
  const previous = await view(page).getAttribute("data-projection");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(() => view(page).getAttribute("data-projection"))
    .not.toBe(previous);
  await tap(page, p.building, { x: 5000, y: -170, z: 1650 });
  await expect(
    page.getByLabel("Selected ornament", { exact: true }),
  ).toHaveValue(o.id);
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await tap(page, p.building, { x: 20000, y: 1000, z: 1800 });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  await confirm(page).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[1].exterior.ornamentation
          .items[0]?.id,
    )
    .toBe(o.id);
  const saved = (await records(page))[0];
  expect(saved.building.sections[0].exterior.ornamentation.items).toHaveLength(
    0,
  );
  expect(saved.building.sections[1].exterior.ornamentation.items).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const locked of ["source", "destination"] as const)
  test(`direct section lock: ${locked}`, async ({ page }) => {
    const { p, o } = wingFixture();
    p.building.sections[locked === "source" ? 0 : 1].locked = true;
    await open(page, p);
    await tap(page, p.building, { x: 5000, y: -170, z: 1650 });
    await expect(
      page.getByLabel("Selected ornament", { exact: true }),
    ).toHaveValue(o.id);
    const move = page.getByRole("button", {
      name: "Move Ornament",
      exact: true,
    });
    if (locked === "source") await expect(move).toBeDisabled();
    else {
      await move.click();
      await tap(page, p.building, { x: 20000, y: 1000, z: 1800 });
      await expect(view(page)).toHaveAttribute(
        "data-ornament-preview",
        "invalid",
      );
      await expect(confirm(page)).toBeDisabled();
    }
    expect((await records(page))[0].building).toEqual(p.building);
  });
test("entrance pillars relocate only between real entrance references", async ({
  page,
}) => {
  const p = ornamentBuilding(),
    s = p.building.sections[0],
    entry = p.building.openings[0];
  p.building.openings.push({ ...entry, id: "second-entrance", offset: 5000 });
  const o = suggestedOrnament(p.building, s, "Entrance pillars");
  p.building = placeOrnament(
    p.building,
    { sectionId: s.id, ornament: o },
    null,
  );
  await open(page, p);
  await tap(page, p.building, { x: 8320, y: -170, z: 1600 });
  await expect(
    page.getByLabel("Selected ornament", { exact: true }),
  ).toHaveValue(o.id);
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await tap(page, p.building, { x: 4350, y: 0, z: 1800 });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  await confirm(page).click();
  await expect
    .poll(
      async () =>
        (await records(page))[0].building.sections[0].exterior.ornamentation
          .items[0].anchor,
    )
    .toEqual({ kind: "entrance", doorId: "second-entrance" });
});

test("nearby ornaments select independently and mode changes discard unfinished previews", async ({
  page,
}) => {
  const p = ornamentBuilding();
  const s = p.building.sections[0];
  const ids: string[] = [];
  for (const offset of [5000, 6500]) {
    const o = {
      ...suggestedOrnament(p.building, s, "Shield"),
      anchor: { kind: "wall" as const, edge: 0, offset, sill: 1200 },
    };
    ids.push(o.id);
    p.building = placeOrnament(
      p.building,
      { sectionId: s.id, ornament: o },
      null,
    );
  }
  await open(page, p);
  const original = (await records(page))[0];
  for (const [i, offset] of [5000, 6500].entries()) {
    await tap(page, p.building, { x: offset, y: -150, z: 1650 });
    await expect(
      page.getByLabel("Selected ornament", { exact: true }),
    ).toHaveValue(ids[i]);
  }
  await page
    .getByRole("button", { name: "Move Ornament", exact: true })
    .click();
  await tap(page, p.building, { x: 7500, y: 0, z: 2000 });
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "valid");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Footprint", exact: true }).click();
  expect((await records(page))[0]).toEqual(original);
  await page.getByRole("button", { name: "Exterior 3D", exact: true }).click();
  await expect(view(page)).toHaveAttribute("data-render-status", "ready");
  await expect(view(page)).toHaveAttribute("data-ornament-preview", "none");
  expect((await records(page))[0]).toEqual(original);
});
