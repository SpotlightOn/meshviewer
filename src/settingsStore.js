const path = require("node:path");
const fsp = require("node:fs/promises");

/**
 * Default values for all user settings.
 * @typedef {object} AppSettings
 * @property {number} slideshowIntervalSeconds - Seconds between slideshow images.
 * @property {"fade"|"slide"} slideshowTransition - Slideshow image transition.
 */

/** @type {Readonly<AppSettings>} */
const DEFAULT_SETTINGS = Object.freeze({
  slideshowIntervalSeconds: 5,
  slideshowTransition: "fade",
});

/** @type {ReadonlyArray<AppSettings["slideshowTransition"]>} */
const TRANSITIONS = Object.freeze(["fade", "slide"]);

/**
 * Validates raw input against the defaults and returns a normalized settings object.
 * @param {unknown} value - Raw settings input.
 * @returns {AppSettings} Normalized settings.
 */
function normalizeSettings(value) {
  const settings = { ...DEFAULT_SETTINGS };
  if (value && typeof value === "object") {
    const interval = Number(value.slideshowIntervalSeconds);
    if (Number.isFinite(interval)) {
      settings.slideshowIntervalSeconds = Math.min(3600, Math.max(1, Math.round(interval)));
    }
    if (TRANSITIONS.includes(value.slideshowTransition)) {
      settings.slideshowTransition = value.slideshowTransition;
    }
  }
  return settings;
}

/**
 * Loads settings from a JSON file, falling back to the defaults.
 * @param {string} filePath - Path of the settings file.
 * @returns {Promise<AppSettings>} Normalized settings.
 */
async function loadSettings(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persists normalized settings to a JSON file.
 * @param {string} filePath - Path of the settings file.
 * @param {unknown} settings - Raw settings input.
 * @returns {Promise<AppSettings>} The normalized settings that were saved.
 */
async function saveSettings(filePath, settings) {
  const normalized = normalizeSettings(settings);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

/**
 * Registers the settings IPC handlers on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 * @param {(fileName: string) => string} getSettingsPath - Resolves the settings file path.
 */
function registerSettingsIpc(ipcMain, getSettingsPath) {
  const settingsPath = getSettingsPath("settings.json");
  ipcMain.handle("settings:get", () => loadSettings(settingsPath));
  ipcMain.handle("settings:save", (_event, settings) => saveSettings(settingsPath, settings));
}

module.exports = {
  DEFAULT_SETTINGS,
  TRANSITIONS,
  loadSettings,
  normalizeSettings,
  registerSettingsIpc,
  saveSettings,
};
