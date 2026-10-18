import {
  displayGrid,
  displaySize,
  imcuSize,
  moveRegion,
  orientFlipAxis,
  orientRegion,
  resizeRegion,
} from "./crop-geometry.js";
import { createCropOverlay } from "./crop-overlay.js";
import { isPixmap } from "./equirectangular/pano-utils.js";
import { t } from "./i18n.js";
import { createImageView } from "./image-view.js";
import {
  clampZoomPercent,
  formatSize,
  isJpeg,
  mimeFor,
  parseZoomPercent,
  retireFrames,
  toArrayBuffer,
  zoomPercent,
  zoomScale,
} from "./utils.js";

/**
 * Large view module: shows a file (image or GLB) at full size with zoom,
 * keyboard navigation and a slideshow.
 * @param {object} deps - Module dependencies.
 * @param {{largeView: HTMLElement, largeCanvas: HTMLElement, largeInfo: HTMLElement, largeZoom: HTMLInputElement, largeZoomValue: HTMLInputElement, largeBack: HTMLButtonElement, infoButton: HTMLButtonElement, largeRotateLeft: HTMLButtonElement, largeRotateRight: HTMLButtonElement, largeFlipHorizontal: HTMLButtonElement, largeFlipVertical: HTMLButtonElement, largeSlideshow: HTMLInputElement, largeEquirect: HTMLInputElement, largeActual: HTMLButtonElement, largeFit: HTMLButtonElement, largePrev: HTMLButtonElement, largeNext: HTMLButtonElement, largeFullscreen: HTMLButtonElement, largeFullscreenExit: HTMLButtonElement, slideshowProgress: HTMLDivElement}} deps.dom - Large view DOM elements.
 * @param {{get: () => object}} deps.settings - Settings module API.
 * @param {() => Array} deps.getFiles - Returns the media files of the current folder.
 * @param {{open: (file: object, imageSize?: {width: number, height: number}) => void, close: () => void, isOpen: () => boolean}} deps.infoDialog - File information dialog API.
 * @param {(file: {path: string, size: number, mtimeMs: number}) => void} [deps.onFileChanged] - Called after a file was rewritten on disk, so other views (the grid) can refresh their thumbnail.
 * @param {(file: object) => Promise<void>} [deps.onFileCreated] - Called after a new file was written next to the current one, so other views (the grid) can pick it up.
 * @returns {{show: Function, close: () => void, isActive: () => boolean, onKeydown: (event: KeyboardEvent) => boolean, toggleSlideshow: () => void, restartSlideshow: () => void}} Large view module API.
 */
export function createLargeView({
  dom,
  settings,
  getFiles,
  infoDialog,
  onFileChanged,
  onFileCreated,
}) {
  const {
    largeView,
    largeCanvas,
    largeInfo,
    largeZoom,
    largeZoomValue,
    largeBack,
    infoButton,
    largeRotateLeft,
    largeRotateRight,
    largeFlipHorizontal,
    largeFlipVertical,
    largeSlideshow,
    largeEquirect,
    largeActual,
    largeFit,
    largePrev,
    largeNext,
    largeFullscreen,
    largeFullscreenExit,
    slideshowProgress,
    largeCrop,
    cropTools,
    cropReadout,
    cropApply,
    cropReset,
    cropCancel,
  } = dom;
  let largeViewState = null;
  let largeToken = 0;
  let slideshowTimer = null;
  let fullscreen = false;
  let fullscreenExitVisible = false;
  let fullscreenIdleTimer = null;
  let transforming = false;
  let crop = null;
  let cropping = false;

  /** @type {number} */
  let currentZoomPercent = 100;

  /**
   * Disposes the resources of the current large view (GLB viewer, image
   * listeners, panorama, object URL) without touching the DOM.
   */
  function disposeResources() {
    if (!largeViewState) return;
    const { glb, objectUrl, imageView, equirect } = largeViewState;
    if (crop) leaveCrop();
    if (glb) glb.dispose();
    if (imageView) imageView.dispose();
    if (equirect) equirect.dispose();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    largeViewState = null;
  }

  /**
   * Disposes the resources of the large view and clears its DOM.
   */
  function dispose() {
    disposeResources();
    largeCanvas.replaceChildren();
    largeCanvas.style.display = "none";
  }

  /**
   * Starts the exit animation of the frames that are still in the large view.
   * @param {number} direction - Navigation direction: 1 forward, -1 backward, 0 none.
   * @param {HTMLElement} [keep] - The frame that was just added and must stay.
   */
  function retireLargeFrames(direction, keep = null) {
    retireFrames(largeCanvas, {
      direction,
      slide: settings.get().slideshowTransition === "slide",
      durationMs: settings.get().animationDurationMs,
      keep,
    });
  }

  /**
   * Synchronizes the zoom slider and its input field with a scale factor.
   * @param {number} scale - Scale factor (1 = 100 %).
   */
  function syncZoomControl(scale) {
    const percent = zoomPercent(scale);
    currentZoomPercent = percent;
    largeZoom.value = String(percent);
    largeZoomValue.value = `${percent}%`;
  }

  /**
   * Applies a zoom percentage to the active large view and syncs the controls.
   * @param {number} percent - Zoom in percent.
   */
  function setZoom(percent) {
    if (!largeViewState) return;
    const clamped = clampZoomPercent(percent);
    if (largeViewState.mode === "equirect" && largeViewState.equirect) {
      largeViewState.equirect.setZoomPercent(clamped);
    } else if (largeViewState.type === "image" && largeViewState.imageView) {
      largeViewState.imageView.setZoom(clamped);
    } else if (largeViewState.type === "glb" && largeViewState.glb) {
      largeViewState.glb.setZoomPercent(clamped);
    }
    syncZoomControl(zoomScale(clamped));
  }

  /**
   * Reads the zoom input field, applies it and syncs the slider, or reverts the
   * field when the entered text is not a valid percentage.
   */
  function commitZoomInput() {
    const parsed = parseZoomPercent(largeZoomValue.value);
    if (parsed === null) {
      syncZoomControl(zoomScale(currentZoomPercent));
      return;
    }
    setZoom(parsed);
  }

  /**
   * Fits the current file to the screen: resets an image to its fitted size or
   * restores the GLB camera to the initial fit position.
   */
  function fitToScreen() {
    if (!largeViewState) return;
    if (largeViewState.mode === "equirect" && largeViewState.equirect) {
      largeViewState.equirect.reset();
      syncZoomControl(1);
    } else if (largeViewState.type === "image" && largeViewState.imageView) {
      largeViewState.imageView.fitView();
    } else if (largeViewState.type === "glb" && largeViewState.glb) {
      largeViewState.glb.reset();
    }
  }

  /**
   * Reveals the fullscreen exit button for a fixed window of time. A later
   * mouse move shows it again; further moves do not extend the window, so it
   * always disappears even with continuous pointer events.
   */
  function revealFullscreenExit() {
    if (!fullscreen || fullscreenExitVisible) return;
    fullscreenExitVisible = true;
    largeFullscreenExit.classList.add("large-view__exit--visible");
    clearTimeout(fullscreenIdleTimer);
    fullscreenIdleTimer = setTimeout(() => {
      fullscreenExitVisible = false;
      largeFullscreenExit.classList.remove("large-view__exit--visible");
    }, 2500);
  }

  /**
   * Hides the fullscreen exit button and cancels its timer.
   */
  function hideFullscreenExit() {
    fullscreenExitVisible = false;
    clearTimeout(fullscreenIdleTimer);
    largeFullscreenExit.classList.remove("large-view__exit--visible");
  }

  /**
   * Applies the window fullscreen state to the large view: the header and
   * status bar hide and an exit button appears while the mouse is moving.
   * @param {boolean} active - Whether the window is in fullscreen mode.
   */
  function setFullscreen(active) {
    fullscreen = active;
    largeView.classList.toggle("large-view--fullscreen", active);
    if (active) {
      revealFullscreenExit();
    } else {
      hideFullscreenExit();
    }
  }

  /**
   * Updates the status bar with the file name, pixel size and formatted file
   * size.
   * @param {{name: string, size: number}} file - Media file entry.
   * @param {{width: number, height: number}} [imageSize] - Pixel size when known.
   */
  function updateStatusBar(file, imageSize) {
    const size = formatSize(file.size);
    const dims = imageSize ? `${imageSize.width}x${imageSize.height}` : null;
    largeInfo.textContent = [file.name, dims, size].filter(Boolean).join(" | ");
  }

  /**
   * Disables the previous/next buttons at the folder boundaries.
   */
  function updateNavButtons() {
    const files = getFiles();
    const index = files.findIndex((file) => file.path === largeViewState?.file?.path);
    largePrev.disabled = index <= 0;
    largeNext.disabled = index < 0 || index >= files.length - 1;
  }

  /**
   * Returns whether the shown file supports the lossless JPEG tools: JPEG is the
   * only supported format, every other file type has no block-based transform.
   * @returns {boolean} true when a rotation, a flip or a crop is possible.
   */
  function canEditJpeg() {
    const file = largeViewState?.file;
    return Boolean(file) && isJpeg(file.name);
  }

  /**
   * Shows the JPEG tools only for JPEG files and disables them while one of
   * them is running. For every other format the buttons are hidden, so the
   * toolbar never offers an action the file does not support.
   */
  function updateToolButtons() {
    const applicable = canEditJpeg() && largeViewState?.mode !== "equirect";
    const busy = transforming || cropping;
    largeRotateLeft.hidden = !applicable;
    largeRotateRight.hidden = !applicable;
    largeFlipHorizontal.hidden = !applicable;
    largeFlipVertical.hidden = !applicable;
    largeRotateLeft.disabled = !applicable || busy;
    largeRotateRight.disabled = !applicable || busy;
    largeFlipHorizontal.disabled = !applicable || busy;
    largeFlipVertical.disabled = !applicable || busy;
    largeCrop.hidden = !applicable || crop !== null;
    largeCrop.disabled = !applicable || busy;
    cropTools.hidden = crop === null;
    cropApply.disabled = busy;
    cropReset.disabled = busy;
    cropCancel.disabled = busy;
  }

  /**
   * Runs a lossless JPEG transform on disk and reloads the file, so the pixels
   * in the file and the pixels on screen match again. The JPEG tools stay
   * disabled until the transform finished; a failure only reaches the console
   * and leaves the file untouched.
   * @param {(file: {path: string, size: number, mtimeMs: number}) => Promise<{ok: boolean, size?: number, mtimeMs?: number, perfect?: boolean, code?: string, detail?: string}>} transform - IPC call that rewrites the file.
   * @param {string} failureKey - i18n key of the console message for a failed transform.
   * @param {string} imperfectKey - i18n key of the console message for a transform that could not keep every image edge (edge blocks may be missing).
   * @returns {Promise<void>}
   */
  async function applyLosslessTransform(transform, failureKey, imperfectKey) {
    if (transforming || cropping || !canEditJpeg()) return;
    const state = largeViewState;
    transforming = true;
    updateToolButtons();
    try {
      const result = await transform(state.file);
      if (!result.ok) {
        console.error(t(failureKey), state.file.path, result.code, result.detail ?? "");
        return;
      }
      if (result.perfect === false) {
        console.warn(t(imperfectKey), state.file.path);
      }
      state.file.size = result.size;
      state.file.mtimeMs = result.mtimeMs;
      onFileChanged?.(state.file);
      if (largeViewState !== state) return;
      await show(state.file, 0);
    } finally {
      transforming = false;
      updateToolButtons();
    }
  }

  /**
   * Rotates the shown JPEG losslessly on disk and reloads it.
   * @param {number} degrees - Clockwise angle: 90 for a quarter turn to the right, 270 for a quarter turn to the left.
   * @returns {Promise<void>}
   */
  function rotateCurrent(degrees) {
    return applyLosslessTransform(
      (file) => window.api.rotateJpeg(file.path, degrees),
      "console.rotateFailed",
      "console.rotateImperfect",
    );
  }

  /**
   * Mirrors the shown JPEG losslessly on disk and reloads it. The axis is the
   * one the user sees: for the EXIF orientations that turn the image by 90 or
   * 270 degrees the mirror axes in the file are swapped.
   * @param {"horizontal"|"vertical"} axis - Flip axis on screen: "horizontal" mirrors left/right, "vertical" mirrors top/bottom.
   * @returns {Promise<void>}
   */
  async function flipCurrent(axis) {
    if (!canEditJpeg()) return;
    const state = largeViewState;
    const orientation = await readOrientation(state.file.path);
    if (largeViewState !== state) return;
    const storedAxis = orientFlipAxis(axis, orientation);
    await applyLosslessTransform(
      (file) => window.api.flipJpeg(file.path, storedAxis),
      "console.flipFailed",
      "console.flipImperfect",
    );
  }

  /**
   * Reads the EXIF orientation of an image, so a selection made on the rotated
   * display and a flip axis picked there can be mapped back to the stored
   * pixels.
   * @param {string} filePath - Absolute path of the image.
   * @returns {Promise<number>} Orientation between 1 and 8, 1 when unknown.
   */
  async function readOrientation(filePath) {
    try {
      const tags = await window.api.exif(filePath);
      const value = Number(tags?.exif?.Orientation?.value);
      return Number.isInteger(value) && value >= 1 && value <= 8 ? value : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Shows the current selection in the toolbar.
   */
  function updateCropReadout() {
    const region = crop?.overlay.getRegion() ?? null;
    cropReadout.textContent =
      region === null ? "" : `${region.x}, ${region.y} — ${region.width} × ${region.height}`;
  }

  /**
   * Starts the crop mode for the shown JPEG. The selection grid is the iMCU of
   * the file, so the crop never has to move or grow the region that was picked.
   * @returns {Promise<void>}
   */
  async function startCrop() {
    if (crop !== null || !canEditJpeg()) return;
    const state = largeViewState;
    const orientation = await readOrientation(state.file.path);
    if (largeViewState !== state) return;

    const display = state.imageSize;
    const imcu = imcuSize(state.imageBytes);
    const overlay = createCropOverlay(largeCanvas, {
      getTransform: () => state.imageView.getTransform(),
      getBounds: () => display,
      getGrid: () => displayGrid(imcu, orientation),
      onChange: updateCropReadout,
    });
    crop = { overlay, orientation, imcu, stored: displaySize(display, orientation) };
    overlay.setRegion({ x: 0, y: 0, width: display.width, height: display.height });
    updateCropReadout();
    updateToolButtons();
  }

  /**
   * Leaves the crop mode and drops the selection.
   */
  function leaveCrop() {
    if (crop === null) return;
    crop.overlay.dispose();
    crop = null;
    cropReadout.textContent = "";
    updateToolButtons();
  }

  /**
   * Puts the selection back onto the whole image.
   */
  function resetCrop() {
    const display = largeViewState?.imageSize;
    if (crop === null || !display) return;
    crop.overlay.setRegion({ x: 0, y: 0, width: display.width, height: display.height });
  }

  /**
   * Writes the selection as a new file next to the source and switches to it.
   * The source file is left untouched.
   * @returns {Promise<void>}
   */
  async function applyCrop() {
    if (crop === null || cropping) return;
    const state = largeViewState;
    const displayRegion = crop.overlay.getRegion();
    if (displayRegion === null) return;

    const rect = orientRegion(displayRegion, crop.orientation, crop.stored);
    cropping = true;
    updateToolButtons();
    try {
      const result = await window.api.cropJpeg(state.file.path, rect);
      if (!result.ok) {
        console.error(t("console.cropFailed"), state.file.path, result.code, result.detail ?? "");
        return;
      }
      if (largeViewState !== state) return;
      const created = {
        path: result.path,
        name: result.name,
        type: "image",
        size: result.size,
        mtimeMs: result.mtimeMs,
      };
      leaveCrop();
      await onFileCreated?.(created);
      await show(created, 0);
    } finally {
      cropping = false;
      updateToolButtons();
    }
  }

  /**
   * Handles the keyboard while the crop mode is running: the arrow keys move the
   * selection (with Shift they resize it), Enter writes the crop and Escape
   * leaves the mode.
   * @param {KeyboardEvent} event - Keyboard event.
   * @returns {boolean} true when the event was consumed.
   */
  function handleCropKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      leaveCrop();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void applyCrop();
      return true;
    }
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      resetCrop();
      return true;
    }

    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return false;

    event.preventDefault();
    const region = crop.overlay.getRegion();
    if (region === null) return true;
    const grid = displayGrid(crop.imcu, crop.orientation);
    const bounds = largeViewState.imageSize;
    const dx = direction[0] * grid.width;
    const dy = direction[1] * grid.height;
    if (!event.shiftKey) {
      crop.overlay.setRegion(moveRegion(region, dx, dy, grid, bounds));
      return true;
    }

    const handle =
      direction[0] !== 0 ? (direction[0] > 0 ? "e" : "w") : direction[1] > 0 ? "s" : "n";
    crop.overlay.setRegion(resizeRegion(region, handle, dx, dy, grid, bounds));
    return true;
  }

  /**
   * Closes and hides the large view.
   */
  function close() {
    largeToken += 1;
    infoDialog.close();
    if (fullscreen) window.api.setFullScreen(false);
    dispose();
    stopSlideshow();
    largeView.classList.add("large-view--hidden");
    largeInfo.textContent = "";
    largePrev.disabled = true;
    largeNext.disabled = true;
    updateToolButtons();
    syncZoomControl(1);
  }

  /**
   * Runs the slideshow progress bar over a full interval. Restarting the
   * animation each interval keeps it aligned with the timer even if it drifts.
   * @param {number} intervalMs - Duration of one slideshow interval.
   */
  function startProgressBar(intervalMs) {
    slideshowProgress.style.animation = "none";
    void slideshowProgress.offsetWidth;
    slideshowProgress.style.animation = `large-view__progress ${intervalMs}ms linear forwards`;
  }

  /**
   * Hides the slideshow progress bar.
   */
  function stopProgressBar() {
    slideshowProgress.style.animation = "none";
  }

  /**
   * Stops the slideshow timer and resets the switch and progress bar.
   */
  function stopSlideshow() {
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    largeSlideshow.checked = false;
    stopProgressBar();
  }

  /**
   * Starts the slideshow, advancing to the next file every interval. The
   * progress bar animation runs for exactly one interval so it reaches the
   * right edge when the next file appears.
   */
  function startSlideshow() {
    if (slideshowTimer) return;
    largeSlideshow.checked = true;
    const intervalMs = Math.max(1000, settings.get().slideshowIntervalSeconds * 1000);
    startProgressBar(intervalMs);
    slideshowTimer = setInterval(() => {
      startProgressBar(intervalMs);
      navigate(1, true);
    }, intervalMs);
  }

  /**
   * Toggles the slideshow on or off.
   */
  function toggleSlideshow() {
    if (slideshowTimer) {
      stopSlideshow();
    } else {
      startSlideshow();
    }
  }

  /**
   * Restarts the slideshow with the current settings when it is running.
   */
  function restartSlideshow() {
    if (slideshowTimer) {
      stopSlideshow();
      startSlideshow();
    }
  }

  /**
   * Enables the equirectangular panorama mode for the current image: the view
   * is built lazily on first use and layered over the image, which is hidden
   * while the panorama is active.
   */
  async function enableEquirect() {
    if (largeViewState?.type !== "image") return;
    if (crop !== null) leaveCrop();
    if (!isPixmap(largeViewState.file.name)) {
      largeEquirect.checked = false;
      return;
    }
    const { frame, imageEl } = largeViewState;
    if (!imageEl) {
      largeEquirect.checked = false;
      return;
    }
    let view = largeViewState.equirect;
    if (!view) {
      const { createEquirectView } = await import("./equirectangular/pano-view.js");
      view = createEquirectView({
        host: largeCanvas,
        image: imageEl,
        onChange: (percent) => syncZoomControl(percent / 100),
      });
      largeViewState.equirect = view;
    }
    view.activate();
    view.setZoomPercent(currentZoomPercent);
    frame.classList.add("large-view__frame--equirect");
    largeViewState.mode = "equirect";
    updateToolButtons();
  }

  /**
   * Disables the equirectangular panorama mode and shows the normal image
   * again with its previous zoom and pan state.
   */
  function disableEquirect() {
    const { equirect, frame, imageView } = largeViewState ?? {};
    if (!equirect) return;
    equirect.deactivate();
    frame.classList.remove("large-view__frame--equirect");
    largeViewState.mode = "image";
    if (imageView) syncZoomControl(imageView.getScale());
    updateToolButtons();
  }

  /**
   * Moves the large view to the previous or next file in the current folder.
   * @param {number} delta - -1 for previous, 1 for next.
   * @param {boolean} [wrap] - Whether to wrap around at the folder boundaries.
   */
  function navigate(delta, wrap = false) {
    if (!largeViewState?.file) return;
    const files = getFiles();
    const index = files.findIndex((file) => file.path === largeViewState.file.path);
    if (index === -1) return;
    const count = files.length;
    let next = index + delta;
    if (wrap) next = ((next % count) + count) % count;
    if (next < 0 || next >= count) return;
    show(files[next], delta);
  }

  /**
   * Opens the large view for a file (GLB or image).
   * The previous content stays visible until the new one is decoded and fitted;
   * only then do the frames start their transition.
   * @param {{path: string, name: string, size: number, type: 'glb'|'image'}} file - File object.
   * @param {number} [direction] - Navigation direction: 1 forward, -1 backward, 0 none.
   * @returns {Promise<void>}
   */
  async function show(file, direction = 0) {
    const token = ++largeToken;
    infoDialog.close();
    disposeResources();
    largeViewState = { token, file };
    largeView.classList.remove("large-view--hidden");
    updateStatusBar(file);
    updateNavButtons();
    updateToolButtons();
    syncZoomControl(1);
    largeEquirect.checked = false;
    largeEquirect.disabled = !isPixmap(file.name);

    try {
      if (file.type === "glb") {
        await showGlb(file, token, direction);
      } else {
        await showImage(file, token, direction);
      }
    } catch (error) {
      console.error(t("console.fileOpenError"), file.path, error);
      if (largeViewState?.token === token) close();
    }
    updateToolButtons();
  }

  /**
   * Returns whether the large view is currently visible.
   * @returns {boolean} true while the large view is shown.
   */
  function isActive() {
    return !largeView.classList.contains("large-view--hidden");
  }

  /**
   * Displays an image at full size in the large view.
   * The frame is built detached, decoded and fitted first, then appended in the
   * same task that starts its enter animation, so no unscaled image is painted.
   * @param {{path: string, name: string}} file - File object.
   * @param {number} token - Load token; aborts if the view changed meanwhile.
   * @param {number} [direction] - Navigation direction: 1 forward, -1 backward, 0 none.
   * @returns {Promise<void>}
   */
  async function showImage(file, token, direction = 0) {
    const data = await window.api.readFile(file.path);
    if (largeViewState?.token !== token) return;
    const blob = new Blob([toArrayBuffer(data)], { type: mimeFor(file.name) });
    const url = URL.createObjectURL(blob);

    const img = document.createElement("img");
    img.className = "large-view__image";
    img.alt = file.name;
    img.src = url;
    const frame = document.createElement("div");
    frame.className = "large-view__frame";
    if (settings.get().slideshowTransition === "slide") {
      frame.style.setProperty("--slide-dir", direction < 0 ? "-1" : "1");
    }
    frame.append(img);

    try {
      await img.decode();
    } catch {
      // The view still shows whatever could be decoded.
    }
    if (largeViewState?.token !== token) {
      URL.revokeObjectURL(url);
      return;
    }

    largeCanvas.style.display = "block";
    const imageView = createImageView(
      largeCanvas,
      img,
      (scale) => {
        syncZoomControl(scale);
        crop?.overlay.render();
      },
      (delta) => navigate(delta),
    );
    imageView.fitView();
    updateStatusBar(file, { width: img.naturalWidth, height: img.naturalHeight });

    frame.classList.add(
      settings.get().slideshowTransition === "slide"
        ? "large-view__frame--enter-slide"
        : "large-view__frame--enter-fade",
    );
    largeCanvas.append(frame);
    retireLargeFrames(direction, frame);

    const imageSize = { width: img.naturalWidth, height: img.naturalHeight };
    largeViewState = {
      token,
      file,
      type: "image",
      objectUrl: url,
      imageView,
      imageSize,
      imageBytes: new Uint8Array(toArrayBuffer(data)),
      frame,
      imageEl: img,
    };
  }

  /**
   * Displays a GLB model interactively in the large view: the viewer owns the
   * scene, camera, controls and render loop, this function wires it into the
   * view. The viewer's canvas joins the view only once the model is parsed, so
   * the previous content stays visible for the whole load.
   * @param {{path: string, name: string}} file - File object.
   * @param {number} token - Load token; aborts if the view changed meanwhile.
   * @param {number} [direction] - Navigation direction: 1 forward, -1 backward, 0 none.
   * @returns {Promise<void>}
   */
  async function showGlb(file, token, direction = 0) {
    const data = await window.api.readFile(file.path);
    if (largeViewState?.token !== token) return;

    const { createGlbView } = await import("./3d/glb-view.js");
    const glb = createGlbView({
      host: largeCanvas,
      onZoomChange: (percent) => syncZoomControl(percent / 100),
    });
    largeViewState.glb = glb;
    largeCanvas.style.display = "block";
    try {
      await glb.load(data);
    } catch (error) {
      console.error(t("console.glbLoadError"), error);
      close();
      return;
    }
    if (largeViewState?.token !== token) return;
    largeViewState.type = "glb";
    retireLargeFrames(direction);
  }

  /**
   * Handles large view keyboard shortcuts: Esc closes, arrows/Backspace/Space
   * navigate, F5 toggles the slideshow, F toggles fit/original size, + and -
   * zoom (3D dolly or image zoom), 0 and 1 reset to 100 %. The Ctrl variants
   * are left to the menu, which scales the whole UI.
   * Returns true when the event was consumed.
   * @param {KeyboardEvent} event - Keyboard event.
   * @returns {boolean} true if the event was handled.
   */
  function onKeydown(event) {
    if (largeView.classList.contains("large-view--hidden") || !largeViewState) return false;
    if (crop !== null && handleCropKey(event)) return true;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (
        target.closest("input, textarea, select") &&
        !target.matches("input[type='checkbox'], input[type='radio']")
      ) {
        return false;
      }
      const nativeToggle =
        target.closest("button") || target.matches("input[type='checkbox'], input[type='radio']");
      if (nativeToggle && (event.key === " " || event.key === "Enter")) return false;
    }

    if (event.key === "Escape") {
      if (fullscreen) {
        window.api.setFullScreen(false);
      } else {
        close();
      }
      return true;
    }

    if (event.key === "ArrowLeft" || event.key === "Backspace") {
      event.preventDefault();
      navigate(-1);
      return true;
    }
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      navigate(1);
      return true;
    }

    if (event.key === "f" || event.key === "F") {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (largeViewState.mode === "equirect" && largeViewState.equirect) {
          event.preventDefault();
          largeViewState.equirect.reset();
          syncZoomControl(1);
        } else if (largeViewState.type === "image" && largeViewState.imageView) {
          event.preventDefault();
          largeViewState.imageView.toggleFit();
        }
      }
      return true;
    }

    if (event.key === "F5") {
      event.preventDefault();
      toggleSlideshow();
      return true;
    }

    const zoomIn = event.key === "+" || event.key === "=" || event.key === "Add";
    const zoomOut = event.key === "-" || event.key === "_" || event.key === "Subtract";
    const reset = event.key === "0" || event.key === "1";
    if (event.ctrlKey || event.metaKey || event.altKey || (!zoomIn && !zoomOut && !reset)) {
      return false;
    }

    event.preventDefault();
    if (largeViewState.mode === "equirect" && largeViewState.equirect) {
      if (zoomIn) largeViewState.equirect.zoomIn();
      else if (zoomOut) largeViewState.equirect.zoomOut();
      else largeViewState.equirect.reset();
    } else if (largeViewState.type === "glb" && largeViewState.glb) {
      if (zoomIn) largeViewState.glb.zoomIn();
      else if (zoomOut) largeViewState.glb.zoomOut();
      else largeViewState.glb.reset();
    } else if (largeViewState.type === "image" && largeViewState.imageView) {
      if (zoomIn) largeViewState.imageView.zoomIn();
      else if (zoomOut) largeViewState.imageView.zoomOut();
      else largeViewState.imageView.reset();
    }
    return true;
  }

  largeBack.addEventListener("click", close);
  infoButton.addEventListener("click", () => {
    if (!largeViewState?.file) return;
    infoDialog.open(largeViewState.file, largeViewState.imageSize);
  });
  largeSlideshow.addEventListener("change", toggleSlideshow);
  largeEquirect.addEventListener("change", () => {
    if (largeEquirect.checked) {
      void enableEquirect();
    } else {
      disableEquirect();
    }
  });
  largeActual.addEventListener("click", () => setZoom(100));
  largeFit.addEventListener("click", fitToScreen);
  largeRotateLeft.addEventListener("click", () => void rotateCurrent(270));
  largeRotateRight.addEventListener("click", () => void rotateCurrent(90));
  largeFlipHorizontal.addEventListener("click", () => void flipCurrent("horizontal"));
  largeFlipVertical.addEventListener("click", () => void flipCurrent("vertical"));
  largeCrop.addEventListener("click", () => void startCrop());
  cropApply.addEventListener("click", () => void applyCrop());
  cropReset.addEventListener("click", resetCrop);
  cropCancel.addEventListener("click", leaveCrop);
  largePrev.addEventListener("click", () => navigate(-1));
  largeNext.addEventListener("click", () => navigate(1));
  largeFullscreen.addEventListener("click", () => window.api.setFullScreen(true));
  largeFullscreenExit.addEventListener("click", () => window.api.setFullScreen(false));
  largeView.addEventListener("mousemove", revealFullscreenExit);
  window.api.onFullScreenChanged(setFullscreen);

  largeZoom.addEventListener("input", () => {
    setZoom(Number(largeZoom.value));
  });

  largeZoomValue.addEventListener("focus", () => largeZoomValue.select());
  largeZoomValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitZoomInput();
      largeZoomValue.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      syncZoomControl(zoomScale(currentZoomPercent));
      largeZoomValue.blur();
    }
  });
  largeZoomValue.addEventListener("blur", commitZoomInput);

  return { show, close, isActive, onKeydown, toggleSlideshow, restartSlideshow };
}
