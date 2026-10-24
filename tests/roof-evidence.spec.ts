import { test, expect, type Page } from "@playwright/test";
import { serializeProject } from "../src/model";
import { roofCompositions } from "./fixtures/roofCompositions";
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
test("roof intersection evidence selected and unselected from above, front, rear and opposite side", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const stage = process.env.BG_ROOF_EVIDENCE_STAGE ?? "after",
    cases = roofCompositions();
  for (const [index, p] of (stage === "before"
    ? cases.slice(0, 2)
    : cases
  ).entries()) {
    p.building.sections.forEach((s) => (s.exterior.detailLevel = "High"));
    await page.goto("/");
    await page.getByLabel("Import project JSON file").setInputFiles({
      name: "roof.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(p)),
    });
    await expect(
      page.getByRole("status").filter({ hasText: /^● Saved$/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Exterior 3D", exact: true })
      .click();
    const v = page.locator(".exterior-viewport");
    await expect(v).toHaveAttribute("data-render-status", "ready");
    for (const view of ["front", "above", "rear", "opposite"]) {
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      if (view === "above") await drag(page, 0, 0.1);
      if (view === "rear") await drag(page, 0.5, 0);
      if (view === "opposite") await drag(page, 0.25, 0);
      const count = await v.getAttribute("data-triangles"),
        rebuilds = await v.getAttribute("data-mesh-rebuilds");
      for (const selected of [true, false]) {
        const button = page.getByRole("button", {
          name: "Section outline",
          exact: true,
        });
        if ((await button.getAttribute("aria-pressed")) !== String(selected))
          await button.click();
        const file = `${stage}-${index}-${view}-${selected ? "selected" : "unselected"}.png`,
          path = info.outputPath(file);
        await page.locator(".exterior-wrap").screenshot({ path });
        await info.attach(file, { path, contentType: "image/png" });
        expect(await v.getAttribute("data-triangles")).toBe(count);
        expect(await v.getAttribute("data-mesh-rebuilds")).toBe(rebuilds);
      }
    }
  }
});
