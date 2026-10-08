/**
 * Settings dialog module: loads, edits and persists the slideshow settings
 * and applies the animation duration to the document styles.
 * @param {object} deps - Module dependencies.
 * @param {{overlay: HTMLElement, interval: HTMLInputElement, transition: HTMLSelectElement, duration: HTMLInputElement, editor: HTMLInputElement, editorBrowse: HTMLButtonElement, save: HTMLButtonElement, cancel: HTMLButtonElement}} deps.dom - Settings dialog elements.
 * @param {() => void} [deps.onSaved] - Called after settings were saved (e.g. to restart a running slideshow).
 * @returns {{load: () => Promise<void>, get: () => object, isOpen: () => boolean, open: () => void, close: () => void}} Settings module API.
 */
export function createSettings({ dom, onSaved }) {
  const { overlay, interval, transition, duration, editor, editorBrowse, save, cancel } = dom;
  let settings = {
    slideshowIntervalSeconds: 5,
    slideshowTransition: "fade",
    animationDurationMs: 1000,
    editorCommand: "",
  };

  /**
   * Applies the current settings to the document styles.
   */
  function applyStyles() {
    document.documentElement.style.setProperty(
      "--transition-duration",
      `${settings.animationDurationMs}ms`,
    );
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

  return { load, get, isOpen, open, close };
}
