import { _electron as electron } from "@playwright/test";

/**
 * Environment that keeps the Electron window unmapped. An unmapped window
 * never appears on screen and cannot take the desktop focus away from the
 * user while the tests run.
 */
const HEADLESS_ENV = { MESHVIEWER_E2E_HEADLESS: "1" };

/**
 * Chromium switches that stop it from treating the unmapped window as occluded
 * and throttling timers, rendering and image decoding in the renderer.
 */
const HEADLESS_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
];

/**
 * Launches the Electron app with the window hidden and returns the app and
 * its first window.
 * @param {import('@playwright/test').ElectronApplicationOptions} [options] - Launch options (for example `executablePath`).
 * @returns {Promise<{electronApp: import('@playwright/test').ElectronApplication, page: import('@playwright/test').Page}>} App and first window.
 */
export async function launchApp(options = {}) {
  const electronApp = await electron.launch({
    ...options,
    args: [...HEADLESS_ARGS, ...(options.args ?? ["."])],
    env: { ...process.env, ...HEADLESS_ENV, ...(options.env ?? {}) },
  });
  const page = await electronApp.firstWindow();
  return { electronApp, page };
}
