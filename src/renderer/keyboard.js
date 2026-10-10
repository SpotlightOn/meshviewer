/**
 * Global input shortcuts: F11 toggles fullscreen, Esc closes the settings,
 * file information, new folder or confirmation dialog, large view shortkeys
 * are delegated to the large view module. Ctrl++/Ctrl+-/Ctrl+0 and Ctrl + mouse
 * wheel zoom the tile grid when no other view is active. Selection shortcuts
 * (Ctrl+A/C/V, Delete, Esc) apply to the file grid.
 * @param {object} deps - Module dependencies.
 * @param {{isOpen: () => boolean, close: () => void}} deps.settings - Settings module API.
 * @param {{isOpen: () => boolean, close: () => void}} deps.infoDialog - File information dialog API.
 * @param {{isOpen: () => boolean, close: () => void}} deps.folderDialog - New folder dialog API.
 * @param {{isOpen: () => boolean, close: () => void}} deps.confirmDialog - Confirmation dialog API.
 * @param {{onKeydown: (event: KeyboardEvent) => boolean, isActive: () => boolean}} deps.largeView - Large view module API.
 * @param {{zoomTiles: (step: number) => void, selectAll: () => void, clearSelection: () => void, hasSelection: () => boolean, hasCopyBuffer: () => boolean, copySelection: () => void, cutSelection: () => void, paste: () => Promise<boolean>, trashSelection: () => Promise<boolean>, openActive: () => boolean}} deps.grid - Grid module API.
 * @param {HTMLElement} deps.contentEl - Scroll container of the tile grid (receives the zoom wheel events).
 */
export function createKeyboard({
  settings,
  infoDialog,
  folderDialog,
  confirmDialog,
  largeView,
  grid,
  contentEl,
}) {
  /**
   * Toggles the window between normal and fullscreen mode on F11.
   * @param {KeyboardEvent} event - Keyboard event.
   */
  function handleFullscreen(event) {
    event.preventDefault();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  /**
   * Routes key events: F11 for fullscreen, Esc to close the settings, file
   * information or new folder dialog, everything else to the large view while
   * it is active.
   * @param {KeyboardEvent} event - Keyboard event.
   */
  function handleKeydown(event) {
    if (event.key === "F11") {
      handleFullscreen(event);
      return;
    }
    if (settings.isOpen()) {
      if (event.key === "Escape") {
        settings.close();
      }
      return;
    }
    if (infoDialog.isOpen()) {
      if (event.key === "Escape") {
        infoDialog.close();
      }
      return;
    }
    if (folderDialog.isOpen()) {
      if (event.key === "Escape") {
        folderDialog.close();
      }
      return;
    }
    if (confirmDialog.isOpen()) {
      if (event.key === "Escape") {
        confirmDialog.close();
      }
      return;
    }
    largeView.onKeydown(event);
  }

  /**
   * Returns whether the keyboard event targets a text entry field.
   * @param {KeyboardEvent} event - Keyboard event.
   * @returns {boolean} true when typing in an input, textarea or contenteditable.
   */
  function isTypingTarget(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  }

  /**
   * Handles the grid selection shortcuts: Ctrl+A selects all files, Ctrl+C
   * copies the selection, Ctrl+V pastes the clipboard into the current folder,
   * Delete moves the selection to the OS trash and Esc clears the selection.
   * @param {KeyboardEvent} event - Keyboard event.
   */
  function handleFileShortcuts(event) {
    if (settings.isOpen()) return;
    if (infoDialog.isOpen()) return;
    if (folderDialog.isOpen()) return;
    if (confirmDialog.isOpen()) return;
    if (largeView.isActive()) return;
    if (isTypingTarget(event)) return;

    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && key === "a") {
      event.preventDefault();
      grid.selectAll();
      return;
    }
    if (mod && key === "c") {
      if (!grid.hasSelection()) return;
      event.preventDefault();
      grid.copySelection();
      return;
    }
    if (mod && key === "x") {
      if (!grid.hasSelection()) return;
      event.preventDefault();
      grid.cutSelection();
      return;
    }
    if (mod && key === "v") {
      if (!grid.hasCopyBuffer()) return;
      event.preventDefault();
      void grid.paste();
      return;
    }
    if (event.key === "Delete") {
      if (!grid.hasSelection()) return;
      event.preventDefault();
      void grid.trashSelection();
      return;
    }
    if (event.key === "Enter") {
      if (grid.openActive()) event.preventDefault();
      return;
    }
    if (event.key === "Escape" && grid.hasSelection()) {
      grid.clearSelection();
    }
  }

  /**
   * Zooms the thumbnail grid with Ctrl++/Ctrl+- and resets it with Ctrl+0.
   * @param {KeyboardEvent} event - Keyboard event.
   */
  function handleGridZoom(event) {
    if (settings.isOpen()) return;
    if (folderDialog.isOpen()) return;
    if (confirmDialog.isOpen()) return;
    if (largeView.isActive()) return;
    if (!event.ctrlKey || isTypingTarget(event)) return;

    const zoomIn = event.key === "+" || event.key === "=" || event.key === "Add";
    const zoomOut = event.key === "-" || event.key === "_" || event.key === "Subtract";
    const reset = event.key === "0";
    if (!zoomIn && !zoomOut && !reset) return;

    event.preventDefault();
    grid.zoomTiles(reset ? 0 : zoomIn ? 1 : -1);
  }

  /**
   * Zooms the thumbnail grid with Ctrl + mouse wheel: wheel up enlarges,
   * wheel down shrinks.
   * @param {WheelEvent} event - Wheel event.
   */
  function handleGridWheel(event) {
    if (!event.ctrlKey) return;
    if (settings.isOpen()) return;
    if (folderDialog.isOpen()) return;
    if (confirmDialog.isOpen()) return;
    if (largeView.isActive()) return;
    if (event.deltaY === 0) return;

    event.preventDefault();
    grid.zoomTiles(event.deltaY < 0 ? 1 : -1);
  }

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("keydown", handleGridZoom);
  document.addEventListener("keydown", handleFileShortcuts);
  contentEl.addEventListener("wheel", handleGridWheel, { passive: false });
}
