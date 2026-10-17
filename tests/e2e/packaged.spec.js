import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./launch.js";

const BINARY = join(process.cwd(), "dist", "linux-unpacked", "meshviewer");
test.skip(!existsSync(BINARY), "packaged app not built (run npm run pack first)");

test("packaged app serves the icons and the three.js add-ons", async () => {
  const { electronApp, page } = await launchApp({ executablePath: BINARY });

  // electron-builder drops `icons/` and any top-level `examples/` directory of a
  // production dependency unless the build config keeps them, which used to break
  // the empty-state logo, the GLB viewer and the panorama view in the packaged app.
  const failures = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".empty-logo")?.complete === true);
  const logoWidth = await page.locator(".empty-logo").evaluate((img) => img.naturalWidth);
  expect(logoWidth).toBeGreaterThan(0);

  const addons = await page.evaluate(async () => {
    const [{ GLTFLoader }, { OrbitControls }] = await Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/controls/OrbitControls.js"),
    ]);
    return [typeof GLTFLoader, typeof OrbitControls];
  });
  expect(addons).toEqual(["function", "function"]);
  expect(failures).toEqual([]);

  await electronApp.close();
});

test("packaged app renders the directory tree and media grid", async () => {
  const { electronApp, page } = await launchApp({ executablePath: BINARY });
  await expect(page).toHaveTitle("MeshViewer");
  await expect(page.locator(".tree-label").first()).toHaveText("/");

  const input = page.locator("#path-input");
  await page.locator(".path-segment.active").click();
  await expect(input).toBeVisible();
  await input.fill("/tmp/opencode/glbtest");
  await input.press("Enter");
  await expect(page.locator(".path-segment.active")).toHaveText("glbtest");
  await expect(page.locator(".card")).toHaveCount(4);
  await electronApp.close();
});
