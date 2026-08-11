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

  await expect(page.locator("#current-dir")).toHaveValue(process.cwd());

  const tmpRow = page.locator(".tree-row", { hasText: "tmp" }).first();
  await tmpRow.locator(".tree-twisty").click();
  const opencodeRow = page.locator(".tree-row", { hasText: "opencode" }).first();
  await expect(opencodeRow).toBeVisible();
  await opencodeRow.locator(".tree-twisty").click();
  const glbtestRow = page.locator(".tree-row", { hasText: "glbtest" }).first();
  await expect(glbtestRow).toBeVisible();
  await glbtestRow.click();

  await expect(page.locator("#current-dir")).toHaveValue("/tmp/opencode/glbtest");
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

  const input = page.locator("#current-dir");
  await expect(input).toHaveValue(process.cwd());
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(input).toHaveValue("/tmp/opencode/glbtest");
  await expect(page.locator(".card")).toHaveCount(4);

  await input.fill("/nonexistent/path/xyz");
  await input.press("Enter");
  await expect(input).toHaveValue("/tmp/opencode/glbtest");
  await expect(page.locator("#empty-state")).toBeVisible();

  await electronApp.close();
});
