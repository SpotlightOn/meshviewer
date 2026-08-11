import { existsSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const BINARY = join(process.cwd(), "dist", "linux-unpacked", "meshviewer");
test.skip(!existsSync(BINARY), "packaged app not built (run npm run pack first)");

test("packaged app renders the directory tree and media grid", async () => {
  const electronApp = await electron.launch({
    executablePath: BINARY,
    args: ["."],
  });
  const page = await electronApp.firstWindow();
  await expect(page).toHaveTitle("MeshViewer");
  await expect(page.locator(".tree-label").first()).toHaveText("/");
  await expect(page.locator(".card").first()).toBeVisible();
  await electronApp.close();
});
