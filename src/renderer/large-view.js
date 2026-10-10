import { createGlbView } from "./3d/view.js";
import { isPixmap } from "./equirectangular/utils.js";
import { createEquirectView } from "./equirectangular/view.js";
import { t } from "./i18n.js";
import {
  clampZoom,
  clampZoomPercent,
  formatSize,
  mimeFor,
  parseZoomPercent,
  retireFrames,
  toArrayBuffer,
  zoomPercent,
  zoomScale,
} from "./utils.js";

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
 * @returns {{fitView: () => void, zoomIn: (anchor?: {x: number, y: number}) => void, zoomOut: (anchor?: {x: number, y: number}) => void, reset: () => void, setZoom: (percent: number) => void, toggleFit: () => void, getScale: () => number, dispose: () => void}} Image view controller.
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

/**
 * Large view module: shows a file (image or GLB) at full size with zoom,
 * keyboard navigation and a slideshow.
 * @param {object} deps - Module dependencies.
 * @param {{largeView: HTMLElement, largeCanvas: HTMLElement, largeInfo: HTMLElement, largeZoom: HTMLInputElement, largeZoomValue: HTMLInputElement, largeBack: HTMLButtonElement, infoButton: HTMLButtonElement, largeSlideshow: HTMLInputElement, largeEquirect: HTMLInputElement, largeActual: HTMLButtonElement, largeFit: HTMLButtonElement, largePrev: HTMLButtonElement, largeNext: HTMLButtonElement, largeFullscreen: HTMLButtonElement, largeFullscreenExit: HTMLButtonElement, slideshowProgress: HTMLDivElement}} deps.dom - Large view DOM elements.
 * @param {{get: () => object}} deps.settings - Settings module API.
 * @param {() => Array} deps.getFiles - Returns the media files of the current folder.
 * @param {{open: (file: object, imageSize?: {width: number, height: number}) => void, close: () => void, isOpen: () => boolean}} deps.infoDialog - File information dialog API.
 * @returns {{show: Function, close: () => void, isActive: () => boolean, onKeydown: (event: KeyboardEvent) => boolean, toggleSlideshow: () => void, restartSlideshow: () => void}} Large view module API.
 */
export function createLargeView({ dom, settings, getFiles, infoDialog }) {
  const {
    largeView,
    largeCanvas,
    largeInfo,
    largeZoom,
    largeZoomValue,
    largeBack,
    infoButton,
    largeSlideshow,
    largeEquirect,
    largeActual,
    largeFit,
    largePrev,
    largeNext,
    largeFullscreen,
    largeFullscreenExit,
    slideshowProgress,
  } = dom;
  let largeViewState = null;
  let largeToken = 0;
  let slideshowTimer = null;
  let fullscreen = false;
  let fullscreenExitVisible = false;
  let fullscreenIdleTimer = null;

  /** @type {number} */
  let currentZoomPercent = 100;

  /**
   * Disposes the resources of the current large view (GLB viewer, image
   * listeners, panorama, object URL) without touching the DOM.
   */
  function disposeResources() {
    if (!largeViewState) return;
    const { glb, objectUrl, imageView, equirect } = largeViewState;
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
    largeFullscreenExit.classList.add("visible");
    clearTimeout(fullscreenIdleTimer);
    fullscreenIdleTimer = setTimeout(() => {
      fullscreenExitVisible = false;
      largeFullscreenExit.classList.remove("visible");
    }, 2500);
  }

  /**
   * Hides the fullscreen exit button and cancels its timer.
   */
  function hideFullscreenExit() {
    fullscreenExitVisible = false;
    clearTimeout(fullscreenIdleTimer);
    largeFullscreenExit.classList.remove("visible");
  }

  /**
   * Applies the window fullscreen state to the large view: the header and
   * status bar hide and an exit button appears while the mouse is moving.
   * @param {boolean} active - Whether the window is in fullscreen mode.
   */
  function setFullscreen(active) {
    fullscreen = active;
    largeView.classList.toggle("fullscreen", active);
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
   * Closes and hides the large view.
   */
  function close() {
    largeToken += 1;
    infoDialog.close();
    if (fullscreen) window.api.setFullScreen(false);
    dispose();
    stopSlideshow();
    largeView.classList.add("hidden");
    largeInfo.textContent = "";
    largePrev.disabled = true;
    largeNext.disabled = true;
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
    slideshowProgress.style.animation = `slideshow-progress ${intervalMs}ms linear forwards`;
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
  function enableEquirect() {
    if (largeViewState?.type !== "image") return;
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
      view = createEquirectView({
        host: largeCanvas,
        image: imageEl,
        onChange: (percent) => syncZoomControl(percent / 100),
      });
      largeViewState.equirect = view;
    }
    view.activate();
    view.setZoomPercent(currentZoomPercent);
    frame.classList.add("equirect-hidden");
    largeViewState.mode = "equirect";
  }

  /**
   * Disables the equirectangular panorama mode and shows the normal image
   * again with its previous zoom and pan state.
   */
  function disableEquirect() {
    const { equirect, frame, imageView } = largeViewState ?? {};
    if (!equirect) return;
    equirect.deactivate();
    frame.classList.remove("equirect-hidden");
    largeViewState.mode = "image";
    if (imageView) syncZoomControl(imageView.getScale());
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
    largeView.classList.remove("hidden");
    updateStatusBar(file);
    updateNavButtons();
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
  }

  /**
   * Returns whether the large view is currently visible.
   * @returns {boolean} true while the large view is shown.
   */
  function isActive() {
    return !largeView.classList.contains("hidden");
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
    img.className = "large-image";
    img.alt = file.name;
    img.src = url;
    const frame = document.createElement("div");
    frame.className = "large-frame";
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
      },
      (delta) => navigate(delta),
    );
    imageView.fitView();
    updateStatusBar(file, { width: img.naturalWidth, height: img.naturalHeight });

    frame.classList.add(
      settings.get().slideshowTransition === "slide" ? "enter-slide" : "enter-fade",
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
   * navigate, F5 toggles the slideshow, F toggles fit/original size,
   * Ctrl++/Ctrl+- zoom (3D dolly or image zoom), Ctrl+0/Ctrl+1 reset to 100%.
   * Returns true when the event was consumed.
   * @param {KeyboardEvent} event - Keyboard event.
   * @returns {boolean} true if the event was handled.
   */
  function onKeydown(event) {
    if (largeView.classList.contains("hidden") || !largeViewState) return false;
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
    if (!event.ctrlKey || (!zoomIn && !zoomOut && !reset)) {
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
      enableEquirect();
    } else {
      disableEquirect();
    }
  });
  largeActual.addEventListener("click", () => setZoom(100));
  largeFit.addEventListener("click", fitToScreen);
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
