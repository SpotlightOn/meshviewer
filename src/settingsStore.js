import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Default values for all user settings.
 * @typedef {object} AppSettings
 * @property {number} slideshowIntervalSeconds - Seconds between slideshow images.
 * @property {"fade"|"slide"} slideshowTransition - Slideshow image transition.
 * @property {number} animationDurationMs - Duration of the transition animation in milliseconds.
 * @property {string} editorCommand - External editor command used by the context menu "edit with" entry; empty disables the entry.
 * @property {boolean} verifyMoveChecksum - Whether cross-filesystem moves compare SHA-256 checksums before removing the source.
 * @property {"checkerboard"|"white"|"custom"} transparencyBackground - Background shown behind transparent images.
 * @property {string} transparencyColor - Hex color used when transparencyBackground is "custom".
 * @property {"cover"|"contain"} thumbnailFit - How image thumbnails are fitted into their tile.
 * @property {number} sidebarWidth - Width of the directory tree sidebar in pixels.
 */

/** @type {Readonly<AppSettings>} */
const DEFAULT_SETTINGS = Object.freeze({
  slideshowIntervalSeconds: 5,
  slideshowTransition: "slide",
  animationDurationMs: 300,
  editorCommand: "",
  verifyMoveChecksum: true,
  transparencyBackground: "checkerboard",
  transparencyColor: "#ffffff",
  thumbnailFit: "cover",
  sidebarWidth: 280,
});

/** Allowed sidebar width range in pixels. */
const SIDEBAR_WIDTH_MIN = 160;
const SIDEBAR_WIDTH_MAX = 720;

/** @type {ReadonlyArray<AppSettings["slideshowTransition"]>} */
const TRANSITIONS = Object.freeze(["fade", "slide"]);

/** @type {ReadonlyArray<AppSettings["transparencyBackground"]>} */
const TRANSPARENCY_BACKGROUNDS = Object.freeze(["checkerboard", "white", "custom"]);

/** @type {ReadonlyArray<AppSettings["thumbnailFit"]>} */
const THUMBNAIL_FITS = Object.freeze(["cover", "contain"]);

/** Matches an opaque RGB hex color such as "#1a2b3c". */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
    const duration = Number(value.animationDurationMs);
    if (Number.isFinite(duration)) {
      settings.animationDurationMs = Math.min(5000, Math.max(0, Math.round(duration)));
    }
    if (typeof value.editorCommand === "string") {
      settings.editorCommand = value.editorCommand.trim();
    }
    if (typeof value.verifyMoveChecksum === "boolean") {
      settings.verifyMoveChecksum = value.verifyMoveChecksum;
    }
    if (TRANSPARENCY_BACKGROUNDS.includes(value.transparencyBackground)) {
      settings.transparencyBackground = value.transparencyBackground;
    }
    if (typeof value.transparencyColor === "string" && HEX_COLOR.test(value.transparencyColor)) {
      settings.transparencyColor = value.transparencyColor.toLowerCase();
    }
    if (THUMBNAIL_FITS.includes(value.thumbnailFit)) {
      settings.thumbnailFit = value.thumbnailFit;
    }
    const sidebarWidth = Number(value.sidebarWidth);
    if (Number.isFinite(sidebarWidth)) {
      settings.sidebarWidth = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, Math.round(sidebarWidth)),
      );
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

export {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  registerSettingsIpc,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  saveSettings,
  THUMBNAIL_FITS,
  TRANSITIONS,
  TRANSPARENCY_BACKGROUNDS,
};
