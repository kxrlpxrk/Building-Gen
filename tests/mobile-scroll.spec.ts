import { test, expect, type Page } from "@playwright/test";

async function create(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New Building", exact: false })
    .click();
  await page
    .getByLabel("Building name", { exact: true })
    .fill("Scrolling studio");
  await page
    .getByRole("button", { name: "Create building", exact: true })
    .click();
  await expect(page.getByRole("application")).toBeVisible();
}

const snapshot = (page: Page) =>
  page.locator(".plan-canvas").evaluate((svg) => ({
    camera: svg.querySelector(":scope > g")!.getAttribute("transform"),
    geometry: svg.querySelector('[data-building="true"]')!.outerHTML,
    height: svg.getBoundingClientRect().height,
  }));

test("portrait inspector flows with the document, including focused inputs and collapse", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  const before = await snapshot(page);
  const canvasTop = (await page.getByRole("application").boundingBox())!.y;
  for (const selector of [".inspector-content", ".inspector .section-list"]) {
    const dimensions = await page.locator(selector).evaluate((el) => ({
      overflow: getComputedStyle(el).overflowY,
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    expect(dimensions.overflow).toBe("visible");
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  }
  await page.getByRole("textbox", { name: "Position X", exact: true }).focus();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(400);
  expect((await page.getByRole("application").boundingBox())!.y).toBeLessThan(
    -before.height,
  );
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => window.scrollBy(0, 120));
  expect(
    await page.locator(".inspector-content").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(async () => (await page.getByRole("application").boundingBox())!.y)
    .toBe(canvasTop);
  expect(await snapshot(page)).toEqual(before);
  const openHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(page.locator(".inspector-content")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThan(openHeight);
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(page.locator(".inspector-content")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  for (const size of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await page.getByRole("application").boundingBox())!.height,
    ).toBeGreaterThan(120);
    if (size.width > size.height) {
      expect(
        await page
          .locator(".inspector-content")
          .evaluate((el) => getComputedStyle(el).overflowY),
      ).toBe("auto");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1,
        ),
      ).toBe(true);
    }
  }
});

test("movement and resizing retain millimetre mapping after document scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  await page.evaluate(() => window.scrollTo(0, 100));
  expect(await page.evaluate(() => scrollY)).toBe(100);
  const group = page.locator('[data-building="true"]').first();
  const start = await group.evaluate((el) => {
    const matrix = (el as SVGGraphicsElement).getScreenCTM()!;
    const p = new DOMPoint(6000, 4000).matrixTransform(matrix);
    return { x: p.x, y: p.y, step: 1000 * matrix.a };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + start.step, start.y, { steps: 5 });
  await page.mouse.up();
  await expect(group).toHaveAttribute(
    "transform",
    "translate(1000 0) rotate(0)",
  );
  const corner = page.locator('[data-corner="2"] circle');
  const point = await corner.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const matrix = (el as SVGGraphicsElement).getScreenCTM()!;
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      step: 1000 * matrix.a,
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + point.step, point.y, { steps: 5 });
  await page.mouse.up();
  await expect(
    page.getByRole("textbox", { name: "Length", exact: true }),
  ).toHaveValue("13");
  await expect(
    page.getByRole("textbox", { name: "Width", exact: true }),
  ).toHaveValue("8");
  expect(await page.evaluate(() => scrollY)).toBe(100);
});

test("native swipes over the inspector scroll the page without editing the canvas", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium" || !isMobile,
    "Native touch dispatch requires mobile Chromium CDP.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  const before = await snapshot(page);
  const client = await page.context().newCDPSession(page);
  const swipe = async (from: number, to: number) => {
    const point = (y: number) => ({ id: 1, x: 15, y, radiusX: 3, radiusY: 3 });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(from)],
    });
    for (let i = 1; i <= 12; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(from + ((to - from) * i) / 12)],
      });
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  await swipe(790, 230);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  expect((await page.getByRole("application").boundingBox())!.y).toBeLessThan(
    0,
  );
  expect(await snapshot(page)).toEqual(before);
  // Always begin the return gesture in the Inspector. Once the canvas returns,
  // a fixed screen coordinate can land on its gesture-capturing SVG instead.
  for (
    let attempt = 0;
    attempt < 5 && (await page.evaluate(() => scrollY)) >= 100;
    attempt++
  ) {
    const inspector = (await page.locator(".inspector").boundingBox())!;
    await swipe(Math.max(140, Math.min(720, inspector.y + 60)), 800);
  }
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(100);
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.locator(".inspector-content").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await client.detach();
});
