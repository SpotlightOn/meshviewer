/**
 * Interactive image view for the large view: zoom, pan, drag-to-throw
 * navigation and the fit/100% toggles. Kept next to the other view modes
 * (`3d/glb-view.js`, `equirectangular/pano-view.js`) instead of inside the large view.
 */

import { clampZoom, zoomScale } from "./utils.js";

const SWIPE_THRESHOLD = 60;
const MIDDLE_CLICK_TOLERANCE = 8;

/**
 * Creates an interactive zoom/pan controller for an image in the large view.
 * Supports mouse-wheel zoom, drag-to-pan, drag-to-throw navigation
 * (the image follows the pointer and snaps back when the drag is too short or
 * not horizontal), fit/100% resets, and a middle-click toggle between fit and 100%.
 * @param {HTMLElement} canvas - The container element.
 * @param {HTMLImageElement} img - The image element (must be loaded).
 * @param {(scale: number) => void} [onChange] - Called after every zoom change with the current scale factor.
 * @param {(delta: number) => void} [onSwipe] - Called when a drag gesture navigates (1 forward, -1 backward).
 * @returns {{fitView: () => void, zoomIn: (anchor?: {x: number, y: number}) => void, zoomOut: (anchor?: {x: number, y: number}) => void, reset: () => void, setZoom: (percent: number) => void, toggleFit: () => void, getScale: () => number, getTransform: () => {tx: number, ty: number, scale: number}, dispose: () => void}} Image view controller.
 */
function createImageView(canvas, img, onChange, onSwipe) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const state = {
    scale: 1,
    tx: 0,
    ty: 0,
    minScale: 0.01,
    panning: false,
    lastX: 0,
    lastY: 0,
    swipe: null,
    middleStart: null,
  };

  img.style.position = "absolute";
  img.style.top = "0";
  img.style.left = "0";
  img.style.width = `${nw}px`;
  img.style.height = `${nh}px`;
  img.style.maxWidth = "none";
  img.style.maxHeight = "none";
  img.style.objectFit = "none";
  img.style.transformOrigin = "0 0";
  img.style.cursor = "grab";
  img.draggable = false;

  /**
   * Renders the image transform, plus the horizontal swipe offset while a
   * fit-view drag is in progress.
   */
  function render() {
    const dx = state.swipe?.dx ?? 0;
    img.style.transform = `translate(${state.tx + dx}px, ${state.ty}px) scale(${state.scale})`;
  }

  /**
   * Applies the current transform to the image element.
   */
  function apply() {
    render();
    onChange?.(state.scale);
  }

  /**
   * Returns the scale at which the image fits the canvas (never upscales).
   * @returns {number} Fit scale.
   */
  function fitScale() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    return Math.min(width / nw, height / nh, 1);
  }

  /**
   * Constrains the pan position so the image stays at least partly visible.
   */
  function clampPan() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const cw = nw * state.scale;
    const ch = nh * state.scale;
    state.tx = cw <= width ? (width - cw) / 2 : Math.min(0, Math.max(width - cw, state.tx));
    state.ty = ch <= height ? (height - ch) / 2 : Math.min(0, Math.max(height - ch, state.ty));
  }

  /**
   * Fits the image into the canvas at its natural ratio.
   */
  function fitView() {
    state.minScale = clampZoom(fitScale());
    state.scale = state.minScale;
    clampPan();
    apply();
  }

  /**
   * Zooms by a factor around a canvas-relative anchor point.
   * @param {number} factor - Zoom multiplier (>1 zooms in).
   * @param {number} ax - Anchor x in canvas coordinates.
   * @param {number} ay - Anchor y in canvas coordinates.
   */
  function zoomAt(factor, ax, ay) {
    const next = clampZoom(state.scale * factor);
    const k = next / state.scale;
    state.tx = ax - (ax - state.tx) * k;
    state.ty = ay - (ay - state.ty) * k;
    state.scale = next;
    clampPan();
    apply();
  }

  /**
   * Zooms in around an anchor (defaults to the canvas center).
   * @param {{x: number, y: number}} [anchor] - Canvas-relative anchor point.
   */
  function zoomIn(anchor) {
    zoomAt(1.25, anchor?.x ?? canvas.clientWidth / 2, anchor?.y ?? canvas.clientHeight / 2);
  }

  /**
   * Zooms out around an anchor (defaults to the canvas center).
   * @param {{x: number, y: number}} [anchor] - Canvas-relative anchor point.
   */
  function zoomOut(anchor) {
    zoomAt(1 / 1.25, anchor?.x ?? canvas.clientWidth / 2, anchor?.y ?? canvas.clientHeight / 2);
  }

  /**
   * Sets the zoom to an exact percentage around the canvas center.
   * @param {number} percent - Zoom in percent.
   */
  function setZoom(percent) {
    const next = zoomScale(percent);
    const k = next / state.scale;
    state.tx = canvas.clientWidth / 2 - (canvas.clientWidth / 2 - state.tx) * k;
    state.ty = canvas.clientHeight / 2 - (canvas.clientHeight / 2 - state.ty) * k;
    state.scale = next;
    clampPan();
    apply();
  }

  /**
   * Resets the image to 100% (one image pixel per CSS pixel).
   */
  function reset() {
    state.scale = 1;
    state.tx = (canvas.clientWidth - nw) / 2;
    state.ty = (canvas.clientHeight - nh) / 2;
    clampPan();
    apply();
  }

  /**
   * Toggles between the fitted view and the original size.
   */
  function toggleFit() {
    if (state.scale === state.minScale) {
      reset();
    } else {
      fitView();
    }
  }

  /**
   * Starts a pan, swipe or middle-click gesture.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerdown(event) {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 1) {
      // Middle button: remember the start position and toggle fit/100% on release.
      state.middleStart = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    state.panning = true;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    img.style.transition = "";
    if (state.scale === state.minScale) {
      // The image fits the canvas, so panning is a no-op: track a swipe instead.
      state.swipe = { startX: event.clientX, startY: event.clientY, dx: 0 };
    }
    img.style.cursor = "grabbing";
    canvas.style.cursor = "grabbing";
  }

  /**
   * Prevents the browser's native middle-click autoscroll.
   * @param {MouseEvent} event - Mouse event.
   */
  function onMouseDown(event) {
    if (event.button === 1) event.preventDefault();
  }

  /**
   * Prevents the browser's native image drag from stealing the pointer stream.
   * @param {DragEvent} event - Drag event.
   */
  function onDragStart(event) {
    event.preventDefault();
  }

  /**
   * Updates the pan offset while dragging, or slides the image sideways with
   * the pointer during a fit-view swipe drag.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointermove(event) {
    if (!state.panning) return;
    if (state.scale === state.minScale && state.swipe) {
      state.swipe.dx = event.clientX - state.swipe.startX;
      render();
      return;
    }
    state.tx += event.clientX - state.lastX;
    state.ty += event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    clampPan();
    apply();
  }

  /**
   * Resets the pan drag state (cursor, pointer capture).
   * @param {PointerEvent} event - Pointer event.
   */
  function endPanGesture(event) {
    state.panning = false;
    img.style.cursor = "grab";
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  /**
   * Animates the image back to its centered fit position after a swipe drag
   * that did not pass the navigation threshold.
   */
  function snapBack() {
    img.style.transition = "transform 180ms ease-out";
    render();
    const onEnd = () => {
      img.style.transition = "";
      img.removeEventListener("transitionend", onEnd);
    };
    img.addEventListener("transitionend", onEnd);
    window.setTimeout(onEnd, 260);
  }

  /**
   * Ends a drag and triggers swipe navigation or the middle-click toggle.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerup(event) {
    endPanGesture(event);
    if (state.middleStart) {
      const dx = event.clientX - state.middleStart.x;
      const dy = event.clientY - state.middleStart.y;
      state.middleStart = null;
      if (Math.abs(dx) + Math.abs(dy) <= MIDDLE_CLICK_TOLERANCE) toggleActualFit();
      return;
    }
    if (state.swipe) {
      const dx = state.swipe.dx;
      const dy = event.clientY - state.swipe.startY;
      state.swipe = null;
      if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
        // Pushing the image left goes to the next file, right to the previous one.
        onSwipe?.(dx < 0 ? 1 : -1);
      } else {
        snapBack();
      }
    }
  }

  /**
   * Cancels an interrupted drag: the image snaps back instead of navigating.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointercancel(event) {
    endPanGesture(event);
    state.middleStart = null;
    if (state.swipe) {
      state.swipe = null;
      snapBack();
    }
  }

  /**
   * Toggles the image between 100% and fit-to-screen (middle mouse button).
   */
  function toggleActualFit() {
    if (state.scale === 1) {
      fitView();
    } else {
      reset();
    }
  }

  /**
   * Zooms with the mouse wheel around the cursor position.
   * @param {WheelEvent} event - Wheel event.
   */
  function onWheel(event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
  }

  canvas.addEventListener("pointerdown", pointerdown);
  canvas.addEventListener("pointermove", pointermove);
  canvas.addEventListener("pointerup", pointerup);
  canvas.addEventListener("pointercancel", pointercancel);
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("dragstart", onDragStart);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => {
    if (state.scale === state.minScale) {
      fitView();
    } else {
      clampPan();
      apply();
    }
  });
  resizeObserver.observe(canvas);

  return {
    fitView,
    zoomIn,
    zoomOut,
    reset,
    setZoom,
    toggleFit,
    getScale: () => state.scale,
    getTransform: () => ({ tx: state.tx, ty: state.ty, scale: state.scale }),
    dispose() {
      canvas.removeEventListener("pointerdown", pointerdown);
      canvas.removeEventListener("pointermove", pointermove);
      canvas.removeEventListener("pointerup", pointerup);
      canvas.removeEventListener("pointercancel", pointercancel);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("dragstart", onDragStart);
      canvas.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
    },
  };
}

export { createImageView };
