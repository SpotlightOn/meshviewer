/** Minimum and maximum sidebar width in pixels. */
const MIN_WIDTH = 160;
const MAX_WIDTH = 720;

/** Keyboard/key repeat step in pixels. */
const STEP = 16;

/**
 * Clamps a sidebar width to the allowed range and rounds it.
 * @param {number} width - Desired width in pixels.
 * @returns {number} Clamped, integer width.
 */
function clampSidebarWidth(width) {
  if (!Number.isFinite(width)) return MIN_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

/**
 * Wires the draggable sidebar separator: pointer drag plus arrow keys for
 * keyboard users. Live updates go through `onResize`, the final width through
 * `onCommit` (which persists it).
 * @param {object} deps - Dependencies.
 * @param {HTMLElement} deps.handle - The separator element.
 * @param {() => number} deps.getWidth - Returns the current sidebar width.
 * @param {(width: number) => void} deps.onResize - Applies a live width update.
 * @param {(width: number) => void} deps.onCommit - Applies and persists a width.
 * @returns {{dispose: () => void}} Handle to remove the listeners.
 */
export function createSidebarResizer({ handle, getWidth, onResize, onCommit }) {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let current = clampSidebarWidth(getWidth());

  /**
   * Applies a width live and remembers it.
   * @param {number} width - Desired width in pixels.
   */
  function apply(width) {
    current = clampSidebarWidth(width);
    handle.setAttribute("aria-valuenow", String(current));
    onResize(current);
  }

  /**
   * Starts a pointer drag.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerDown(event) {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startWidth = clampSidebarWidth(getWidth());
    current = startWidth;
    handle.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add("resizing");
    event.preventDefault();
  }

  /**
   * Updates the width while dragging.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerMove(event) {
    if (!dragging) return;
    apply(startWidth + (event.clientX - startX));
  }

  /**
   * Ends a pointer drag and persists the width.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(event.pointerId);
    document.documentElement.classList.remove("resizing");
    onCommit(current);
  }

  /**
   * Resizes with the arrow keys.
   * @param {KeyboardEvent} event - Keyboard event.
   */
  function onKeyDown(event) {
    const delta = event.key === "ArrowLeft" ? -STEP : event.key === "ArrowRight" ? STEP : 0;
    if (!delta) return;
    event.preventDefault();
    apply(getWidth() + delta);
    onCommit(current);
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
  handle.addEventListener("keydown", onKeyDown);

  return {
    dispose() {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
      handle.removeEventListener("keydown", onKeyDown);
    },
  };
}

export { clampSidebarWidth, MAX_WIDTH as SIDEBAR_WIDTH_MAX, MIN_WIDTH as SIDEBAR_WIDTH_MIN };
