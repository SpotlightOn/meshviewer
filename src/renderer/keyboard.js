/**
 * Global keyboard shortcuts: F11 toggles fullscreen, Esc closes the settings
 * dialog, large view shortkeys are delegated to the large view module and
 * Ctrl++/Ctrl+-/Ctrl+0 zoom the tile grid when no other view is active.
 * @param {object} deps - Module dependencies.
 * @param {{isOpen: () => boolean, close: () => void}} deps.settings - Settings module API.
 * @param {{onKeydown: (event: KeyboardEvent) => boolean, isActive: () => boolean}} deps.largeView - Large view module API.
 * @param {{zoomTiles: (step: number) => void}} deps.grid - Grid module API.
 */
export function createKeyboard({ settings, largeView, grid }) {
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
   * Routes key events: F11 for fullscreen, Esc to close the settings dialog,
   * everything else to the large view while it is active.
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
    largeView.onKeydown(event);
  }

  /**
   * Zooms the thumbnail grid with Ctrl++/Ctrl+- and resets it with Ctrl+0.
   * @param {KeyboardEvent} event - Keyboard event.
   */
  function handleGridZoom(event) {
    if (settings.isOpen()) return;
    if (largeView.isActive()) return;
    if (!event.ctrlKey) return;

    const zoomIn = event.key === "+" || event.key === "=" || event.key === "Add";
    const zoomOut = event.key === "-" || event.key === "_" || event.key === "Subtract";
    const reset = event.key === "0";
    if (!zoomIn && !zoomOut && !reset) return;

    event.preventDefault();
    grid.zoomTiles(reset ? 0 : zoomIn ? 1 : -1);
  }

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("keydown", handleGridZoom);
}
