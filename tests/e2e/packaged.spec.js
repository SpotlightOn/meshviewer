import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp } from "./launch.js";

const BINARY = join(process.cwd(), "dist", "linux-unpacked", "meshviewer");
test.skip(!existsSync(BINARY), "packaged app not built (run npm run pack first)");

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
