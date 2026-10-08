import { basename } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Launches the Electron app and returns the first window.
 * @returns {Promise<import('@playwright/test').Page>} Main window.
 */
async function launchApp() {
  const electronApp = await electron.launch({ args: ["."] });
  return { electronApp, page: await electronApp.firstWindow() };
}

test("app boots and renders the directory tree", async () => {
  const { electronApp, page } = await launchApp();
  await expect(page).toHaveTitle("MeshViewer");
  await expect(page.locator(".tree")).toBeVisible();
  await expect(page.locator(".tree-label").first()).toHaveText("/");
  await expect(page.locator(".empty-logo")).toBeVisible();
  await electronApp.close();
});

test("navigates to a folder and displays media thumbnails", async () => {
  const { electronApp, page } = await launchApp();

  await expect(page.locator(".path-segment.active")).toHaveText(basename(process.cwd()));

  const tmpRow = page.locator(".tree-row", { has: page.getByText("tmp", { exact: true }) }).first();
  await tmpRow.locator(".tree-twisty").click();
  const opencodeRow = page.locator(".tree-row", { hasText: "opencode" }).first();
  await expect(opencodeRow).toBeVisible();
  await opencodeRow.locator(".tree-twisty").click();
  const glbtestRow = page.locator(".tree-row", { hasText: "glbtest" }).first();
  await expect(glbtestRow).toBeVisible();
  await glbtestRow.click();

  await expect(page.locator(".path-segment.active")).toHaveText("glbtest");
  await expect(page.locator(".card")).toHaveCount(4);
  await expect(page.locator(".card", { hasText: "test.glb" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "textured.glb" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "foto.png" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "foto2.png" })).toBeVisible();

  await expect(page.locator(".card", { hasText: "foto.png" }).locator(".thumb")).toHaveAttribute(
    "src",
    /^(blob:|data:image\/jpeg;)/,
  );
  await electronApp.close();
});

test("opens a folder via the path input", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".path-segment.active")).toHaveText("glbtest");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".path-segment.active").click();
  await input.fill("/nonexistent/path/xyz");
  await input.press("Enter");
  await expect(page.locator(".path-segment.active")).toHaveText("glbtest");
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator(".empty-logo")).toBeVisible();
  await expect(page.locator("#empty-message")).not.toBeEmpty();

  await electronApp.close();
});

test("file information dialog shows basic info and closes with Esc", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "foto.png" }).click();
  await expect(page.locator("#large-view")).toBeVisible();
  await page.locator("#large-details").click();
  await expect(page.locator("#info-overlay")).toBeVisible();
  await expect(page.locator(".info-loading")).toBeHidden();
  await expect(page.locator(".info-section:first-child .info-rows dd")).toHaveCount(4);
  const title = (await page.locator("#info-dialog-title").textContent()) ?? "";
  expect(title.includes("info.title")).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.locator("#info-overlay")).toBeHidden();
  await expect(page.locator("#large-view")).toBeVisible();

  await page.locator("#large-back").click();
  await page.locator(".card", { hasText: "test.glb" }).click();
  await expect(page.locator("#large-view")).toBeVisible();
  await page.locator("#large-details").click();
  await expect(page.locator("#info-overlay")).toBeVisible();
  await expect(page.locator(".info-section:first-child .info-rows dd")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.locator("#info-overlay")).toBeHidden();

  await electronApp.close();
});

test("file information dialog renders the embedded preview image and hides raw metadata", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/exiftest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(1);

  await page.locator(".card").click();
  await expect(page.locator("#large-view")).toBeVisible();
  await page.locator("#large-details").click();
  await expect(page.locator("#info-overlay")).toBeVisible();
  await expect(page.locator(".info-loading")).toBeHidden();

  const image = page.locator(".info-image");
  await expect(image).toBeVisible();
  const src = (await image.getAttribute("src")) ?? "";
  expect(src.startsWith("data:image/jpeg;base64,")).toBe(true);

  const text = (await page.locator("#info-content").textContent()) ?? "";
  expect(text).not.toContain("[Raw maker note data]");
  expect(text).not.toContain("hdrp_makernote");

  await page.keyboard.press("Escape");
  await expect(page.locator("#info-overlay")).toBeHidden();
  await electronApp.close();
});

/**
 * Waits until the large view transition has fully finished: only the current
 * frame remains and its image is centered in the canvas.
 * @param {import('@playwright/test').Page} page - Page.
 */
async function expectImageCentered(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector("#large-canvas");
    if (!canvas) return false;
    const frames = canvas.querySelectorAll(".large-frame");
    if (frames.length !== 1) return false;
    const img = frames[0].querySelector("img");
    if (!img) return false;
    const c = canvas.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return (
      Math.abs(i.x + i.width / 2 - (c.x + c.width / 2)) < 1 &&
      Math.abs(i.y + i.height / 2 - (c.y + c.height / 2)) < 1
    );
  });
}

test("right-clicking a thumbnail opens the context menu", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "foto.png" }).click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  // The "edit with" entry only appears when an editor command is configured,
  // which depends on the persisted user settings; assert the stable entries.
  await expect(page.locator('#context-menu .context-item[data-action="open-with"]')).toBeVisible();
  await expect(page.locator('#context-menu .context-item[data-action="file-info"]')).toBeVisible();

  // The file information entry reuses the EXIF dialog.
  await page.locator('#context-menu .context-item[data-action="file-info"]').click();
  await expect(page.locator("#info-overlay")).toBeVisible();
  await expect(page.locator("#context-menu")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#info-overlay")).toBeHidden();

  // Right-click again and close with Escape.
  await page.locator(".card", { hasText: "foto.png" }).click({ button: "right" });
  await expect(page.locator("#context-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#context-menu")).toBeHidden();

  // Right-clicking empty grid space (below the tiles) shows no menu.
  const lastCard = await page.locator(".card", { hasText: "foto2.png" }).boundingBox();
  if (lastCard) {
    await page.mouse.click(lastCard.x + lastCard.width / 2, lastCard.y + lastCard.height + 30, {
      button: "right",
    });
    await expect(page.locator("#context-menu")).toBeHidden();
  }

  await electronApp.close();
});

test("actual-size button resets the large view zoom to 100 percent", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "foto.png" }).click();
  await expect(page.locator("#large-view")).toBeVisible();

  await page.locator("#large-zoom-value").fill("200");
  await page.locator("#large-zoom-value").press("Enter");
  await expect(page.locator("#large-zoom-value")).toHaveValue("200%");

  await page.locator("#large-actual").click();
  await expect(page.locator("#large-zoom-value")).toHaveValue("100%");

  await electronApp.close();
});

test("zoom slider zooms the 3D view", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "test.glb" }).click();
  await expect(page.locator("#large-view")).toBeVisible();
  await page.waitForSelector(".large-canvas canvas");

  // The GLB state is only set once the model finished loading; retry until
  // the slider input reaches the 3D view so the assertion is stable.
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.locator("#large-zoom").focus();
    await page.keyboard.press("End");
    if ((await page.locator("#large-zoom-value").inputValue()) === "800%") break;
    await page.waitForTimeout(100);
  }
  await expect(page.locator("#large-zoom")).toHaveValue("800");
  await expect(page.locator("#large-zoom-value")).toHaveValue("800%");

  await page.keyboard.press("Home");
  await expect(page.locator("#large-zoom")).toHaveValue("10");
  await expect(page.locator("#large-zoom-value")).toHaveValue("10%");

  await electronApp.close();
});

test("status bar shows file info and the arrow buttons navigate", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "foto.png" }).click();
  await expect(page.locator("#large-view")).toBeVisible();
  const info = (await page.locator("#large-file-info").textContent()) ?? "";
  expect(info).toMatch(/^foto\.png \| [0-9]+x[0-9]+ \| \d+(\.\d+)? (B|KB|MB)$/);

  const before = (await page.locator("#large-file-info").textContent()) ?? "";
  if (await page.locator("#large-next").isEnabled()) {
    await page.locator("#large-next").click();
    await expect(page.locator("#large-file-info")).not.toHaveText(before);
    await page.locator("#large-prev").click();
    await expect(page.locator("#large-file-info")).toHaveText(before);
  }

  await electronApp.close();
});

test("swiping the image navigates to the previous and next image", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "foto.png" }).click();
  await expect(page.locator("#large-view")).toBeVisible();
  const before = (await page.locator("#large-file-info").textContent()) ?? "";

  const box = (await page.locator("#large-canvas").boundingBox()) ?? { x: 0, y: 0 };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Swiping left goes to the next image, swiping right back to the previous one.
  // The direction to test first depends on the folder's listing order.
  const swipeLeftFirst = await page.locator("#large-next").isEnabled();
  const swipeLeft = { dx: -150, dy: 0 };
  const swipeRight = { dx: 150, dy: 0 };
  await expectImageCentered(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + (swipeLeftFirst ? swipeLeft.dx : swipeRight.dx), cy, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#large-file-info")).not.toHaveText(before);

  await expectImageCentered(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + (swipeLeftFirst ? swipeRight.dx : swipeLeft.dx), cy, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#large-file-info")).toHaveText(before);

  // A short drag below the threshold snaps back without navigating.
  await expectImageCentered(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#large-file-info")).toHaveText(before);
  await expectImageCentered(page);

  await electronApp.close();
});

test("middle mouse click toggles the image between 100 percent and fit", async () => {
  const { electronApp, page } = await launchApp();

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".card")).toHaveCount(4);

  await page.locator(".card", { hasText: "foto.png" }).click();
  await expect(page.locator("#large-view")).toBeVisible();

  await page.locator("#large-zoom-value").fill("200");
  await page.locator("#large-zoom-value").press("Enter");
  await expect(page.locator("#large-zoom-value")).toHaveValue("200%");
  await expectImageCentered(page);

  const box = (await page.locator("#large-canvas").boundingBox()) ?? { x: 0, y: 0 };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Not at 100%: the middle click resets to 100% (1:1).
  await page.mouse.click(cx, cy, { button: "middle" });
  await expect(page.locator("#large-zoom-value")).toHaveValue("100%");

  // At 100%: the middle click fits the image; for a 64x64 fixture fit equals 100%.
  await page.mouse.click(cx, cy, { button: "middle" });
  await expect(page.locator("#large-zoom-value")).toHaveValue("100%");

  await electronApp.close();
});
