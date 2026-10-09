import { clampSidebarWidth } from "./sidebar-resizer.js";

/**
 * Settings dialog module: loads, edits and persists the settings and applies
 * them (animation duration, transparency background, thumbnail fit, sidebar
 * width) to the document styles.
 * @param {object} deps - Module dependencies.
 * @param {{overlay: HTMLElement, interval: HTMLInputElement, transition: HTMLSelectElement, duration: HTMLInputElement, editor: HTMLInputElement, editorBrowse: HTMLButtonElement, verify: HTMLInputElement, thumbnailFit: HTMLSelectElement, transparency: HTMLSelectElement, transparencyColor: HTMLInputElement, save: HTMLButtonElement, cancel: HTMLButtonElement}} deps.dom - Settings dialog elements.
 * @param {() => void} [deps.onSaved] - Called after settings were saved (e.g. to restart a running slideshow).
 * @returns {{load: () => Promise<void>, get: () => object, isOpen: () => boolean, open: () => void, close: () => void, applySidebarWidth: (width: number) => void, saveSidebarWidth: (width: number) => Promise<void>}} Settings module API.
 */
export function createSettings({ dom, onSaved }) {
  const {
    overlay,
    interval,
    transition,
    duration,
    editor,
    editorBrowse,
    verify,
    thumbnailFit,
    transparency,
    transparencyColor,
    save,
    cancel,
  } = dom;
  let settings = {
    slideshowIntervalSeconds: 5,
    slideshowTransition: "slide",
    animationDurationMs: 300,
    editorCommand: "",
    verifyMoveChecksum: true,
    transparencyBackground: "checkerboard",
    transparencyColor: "#ffffff",
    thumbnailFit: "cover",
    sidebarWidth: 280,
  };

  /** Background modes that draw a solid color instead of the checkerboard. */
  const SOLID_BACKGROUNDS = ["white", "custom"];

  /**
   * Applies the current settings to the document styles.
   */
  function applyStyles() {
    document.documentElement.style.setProperty(
      "--transition-duration",
      `${settings.animationDurationMs}ms`,
    );
    applyTransparency();
    applyThumbnailFit();
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${clampSidebarWidth(settings.sidebarWidth)}px`,
    );
  }

  /**
   * Updates the sidebar width in memory and applies it (without persisting).
   * @param {number} width - Desired width in pixels.
   */
  function applySidebarWidth(width) {
    settings.sidebarWidth = clampSidebarWidth(width);
    applyStyles();
  }

  /**
   * Updates and persists the sidebar width.
   * @param {number} width - Desired width in pixels.
   * @returns {Promise<void>}
   */
  async function saveSidebarWidth(width) {
    settings.sidebarWidth = clampSidebarWidth(width);
    applyStyles();
    try {
      settings = await window.api.saveSettings(settings);
    } catch {
      // Keep the in-memory value when persisting fails.
    }
  }

  /**
   * Applies the thumbnail fit (cover or contain) as a CSS variable used by the
   * grid thumbnail rule.
   */
  function applyThumbnailFit() {
    document.documentElement.style.setProperty(
      "--thumb-fit",
      settings.thumbnailFit === "contain" ? "contain" : "cover",
    );
  }

  /**
   * Applies the transparency background (checkerboard or a solid color) by
   * overriding the two checker color variables; the defaults are the checkerboard.
   */
  function applyTransparency() {
    const root = document.documentElement;
    const mode = settings.transparencyBackground;
    const solidColor = mode === "white" ? "#ffffff" : settings.transparencyColor;
    root.style.setProperty("--checker-a", SOLID_BACKGROUNDS.includes(mode) ? solidColor : "");
    root.style.setProperty("--checker-b", SOLID_BACKGROUNDS.includes(mode) ? solidColor : "");
  }

  /**
   * Shows the color picker only for the "custom" transparency background.
   */
  function syncTransparencyColor() {
    const row = transparencyColor.closest(".settings-row");
    if (row) row.hidden = transparency.value !== "custom";
  }

  /**
   * Loads the persisted settings from the main process.
   * @returns {Promise<void>}
   */
  async function load() {
    settings = await window.api.getSettings();
    applyStyles();
  }

  /**
   * Returns the current settings object.
   * @returns {object} Current settings.
   */
  function get() {
    return settings;
  }

  /**
   * Returns whether the settings dialog is currently open.
   * @returns {boolean} true while the overlay is visible.
   */
  function isOpen() {
    return !overlay.classList.contains("hidden");
  }

  /**
   * Opens the settings dialog with the current values.
   */
  function open() {
    interval.value = String(settings.slideshowIntervalSeconds);
    transition.value = settings.slideshowTransition;
    duration.value = String(settings.animationDurationMs);
    editor.value = settings.editorCommand;
    verify.checked = settings.verifyMoveChecksum !== false;
    thumbnailFit.value = settings.thumbnailFit;
    transparency.value = settings.transparencyBackground;
    transparencyColor.value = settings.transparencyColor;
    syncTransparencyColor();
    overlay.classList.remove("hidden");
    interval.focus();
    interval.select();
  }

  /**
   * Closes the settings dialog.
   */
  function close() {
    overlay.classList.add("hidden");
  }

  /**
   * Persists the settings, applies them and notifies the caller.
   * @returns {Promise<void>}
   */
  async function saveSettings() {
    const parsedDuration = Number(duration.value);
    const next = {
      slideshowIntervalSeconds: Math.max(1, Math.min(3600, Number(interval.value) || 5)),
      slideshowTransition: transition.value === "slide" ? "slide" : "fade",
      animationDurationMs: Number.isFinite(parsedDuration)
        ? Math.max(0, Math.min(5000, Math.round(parsedDuration)))
        : settings.animationDurationMs,
      editorCommand: editor.value.trim(),
      verifyMoveChecksum: verify.checked,
      thumbnailFit: thumbnailFit.value === "contain" ? "contain" : "cover",
      transparencyBackground: ["checkerboard", "white", "custom"].includes(transparency.value)
        ? transparency.value
        : "checkerboard",
      transparencyColor: /^#[0-9a-f]{6}$/i.test(transparencyColor.value)
        ? transparencyColor.value.toLowerCase()
        : settings.transparencyColor,
      sidebarWidth: clampSidebarWidth(settings.sidebarWidth),
    };
    try {
      settings = await window.api.saveSettings(next);
    } catch {
      settings = next;
    }
    applyStyles();
    onSaved?.();
    close();
  }

  save.addEventListener("click", saveSettings);
  cancel.addEventListener("click", close);
  transparency.addEventListener("change", syncTransparencyColor);
  editorBrowse.addEventListener("click", async () => {
    try {
      const picked = await window.api.pickExecutable();
      if (picked) editor.value = picked;
    } catch {
      // The dialog was canceled or the picker failed; keep the current value.
    }
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  window.api.onOpenSettings(open);

  return { load, get, isOpen, open, close, applySidebarWidth, saveSidebarWidth };
}
