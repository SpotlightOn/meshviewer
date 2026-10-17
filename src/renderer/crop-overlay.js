import { moveRegion, regionFromPoints, resizeRegion, snapRegion } from "./crop.js";

/**
 * The eight resize handles of the selection, named by the edges they move.
 * @type {Array<string>}
 */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * Creates the crop overlay: a layer above the image with a darkened surround
 * and a selection rectangle that can be drawn, moved and resized with the
 * pointer. Everything is kept in displayed image pixels and snapped onto the
 * grid the caller provides, so what is on screen is what gets cropped.
 *
 * @param {HTMLElement} canvas - Container the image is displayed in.
 * @param {object} options - Accessors for the current view.
 * @param {() => {tx: number, ty: number, scale: number}} options.getTransform - Current image transform.
 * @param {() => {width: number, height: number}} options.getBounds - Size of the displayed image in pixels.
 * @param {() => {width: number, height: number}} options.getGrid - Grid steps in displayed pixels.
 * @param {(region: {x: number, y: number, width: number, height: number}) => void} [options.onChange] - Called after every change with the snapped selection.
 * @returns {{render: () => void, setRegion: (region: object|null) => void, getRegion: () => object|null, dispose: () => void}} Overlay handle.
 */
function createCropOverlay(canvas, options) {
  const layer = document.createElement("div");
  layer.className = "crop__layer";

  const box = document.createElement("div");
  box.className = "crop__box";
  layer.append(box);

  for (const name of HANDLES) {
    const handle = document.createElement("div");
    handle.className = `crop__handle crop__handle--${name}`;
    handle.dataset.handle = name;
    box.append(handle);
  }

  canvas.append(layer);

  let region = null;
  let gesture = null;

  /**
   * Converts a pointer position into displayed image pixels.
   * @param {number} clientX - Pointer x in client coordinates.
   * @param {number} clientY - Pointer y in client coordinates.
   * @returns {{x: number, y: number}} Position in displayed image pixels.
   */
  function toImage(clientX, clientY) {
    const { tx, ty, scale } = options.getTransform();
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  }

  /**
   * Projects the selection onto the canvas. The rectangle is drawn in canvas
   * pixels, so it follows the zoom and pan of the image.
   */
  function render() {
    if (region === null) {
      layer.hidden = true;
      return;
    }
    layer.hidden = false;
    const { tx, ty, scale } = options.getTransform();
    box.style.left = `${tx + region.x * scale}px`;
    box.style.top = `${ty + region.y * scale}px`;
    box.style.width = `${region.width * scale}px`;
    box.style.height = `${region.height * scale}px`;
  }

  /**
   * Replaces the selection, snapped onto the grid.
   * @param {{x: number, y: number, width: number, height: number}|null} next - Selection in displayed pixels, or null to clear it.
   */
  function setRegion(next) {
    region = next === null ? null : snapRegion(next, options.getGrid(), options.getBounds());
    render();
    if (region !== null) options.onChange?.(region);
  }

  /**
   * Starts a draw, move or resize gesture.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerdown(event) {
    if (event.button !== 0 || region === null) return;
    event.preventDefault();
    event.stopPropagation();
    layer.setPointerCapture(event.pointerId);

    const point = toImage(event.clientX, event.clientY);
    const handle = event.target instanceof HTMLElement ? event.target.dataset.handle : undefined;
    if (handle !== undefined) {
      gesture = { type: "resize", handle, start: point, region: { ...region } };
    } else if (event.target instanceof HTMLElement && event.target.closest(".crop__box") !== null) {
      gesture = { type: "move", start: point, region: { ...region } };
    } else {
      gesture = { type: "new", start: point };
    }
  }

  /**
   * Updates the selection while a gesture is running.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointermove(event) {
    if (gesture === null) return;
    event.preventDefault();
    event.stopPropagation();

    const point = toImage(event.clientX, event.clientY);
    const grid = options.getGrid();
    const bounds = options.getBounds();
    if (gesture.type === "new") {
      region = regionFromPoints(gesture.start, point, grid, bounds);
    } else {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      region =
        gesture.type === "move"
          ? moveRegion(gesture.region, dx, dy, grid, bounds)
          : resizeRegion(gesture.region, gesture.handle, dx, dy, grid, bounds);
    }
    render();
    options.onChange?.(region);
  }

  /**
   * Ends the running gesture.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerup(event) {
    if (gesture === null) return;
    gesture = null;
    if (layer.hasPointerCapture(event.pointerId)) layer.releasePointerCapture(event.pointerId);
  }

  layer.addEventListener("pointerdown", pointerdown);
  layer.addEventListener("pointermove", pointermove);
  layer.addEventListener("pointerup", pointerup);
  layer.addEventListener("pointercancel", pointerup);

  return {
    render,
    setRegion,
    getRegion: () => (region === null ? null : { ...region }),
    dispose() {
      layer.removeEventListener("pointerdown", pointerdown);
      layer.removeEventListener("pointermove", pointermove);
      layer.removeEventListener("pointerup", pointerup);
      layer.removeEventListener("pointercancel", pointerup);
      layer.remove();
    },
  };
}

export { createCropOverlay };
