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
