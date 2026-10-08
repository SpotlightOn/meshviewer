import * as THREE from "three";
import { t } from "./i18n.js";
import { disposeObject } from "./three-utils.js";
import {
  clampZoom,
  clampZoomPercent,
  glbDistanceForPercent,
  glbPercentForDistance,
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  mimeFor,
  parseZoomPercent,
  retireFrames,
  toArrayBuffer,
  zoomPercent,
  zoomScale,
} from "./utils.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

/**
 * Creates an interactive zoom/pan controller for an image in the large view.
 * Supports mouse-wheel zoom, drag-to-pan, and fit/100% resets.
 * @param {HTMLElement} canvas - The container element.
 * @param {HTMLImageElement} img - The image element (must be loaded).
 * @param {(scale: number) => void} [onChange] - Called after every zoom change with the current scale factor.
 * @returns {{fitView: () => void, zoomIn: (anchor?: {x: number, y: number}) => void, zoomOut: (anchor?: {x: number, y: number}) => void, reset: () => void, setZoom: (percent: number) => void, toggleFit: () => void, dispose: () => void}} Image view controller.
 */
function createImageView(canvas, img, onChange) {
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
   * Applies the current transform to the image element.
   */
  function apply() {
    img.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
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
   * Starts a pan drag.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerdown(event) {
    event.preventDefault();
    state.panning = true;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    img.setPointerCapture(event.pointerId);
    img.style.cursor = "grabbing";
  }

  /**
   * Prevents the browser's native image drag from stealing the pointer stream.
   * @param {DragEvent} event - Drag event.
   */
  function onDragStart(event) {
    event.preventDefault();
  }

  /**
   * Updates the pan offset while dragging.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointermove(event) {
    if (!state.panning) return;
    state.tx += event.clientX - state.lastX;
    state.ty += event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    clampPan();
    apply();
  }

  /**
   * Ends a pan drag.
   * @param {PointerEvent} event - Pointer event.
   */
  function pointerup(event) {
    state.panning = false;
    img.style.cursor = "grab";
    if (img.hasPointerCapture(event.pointerId)) img.releasePointerCapture(event.pointerId);
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

  img.addEventListener("pointerdown", pointerdown);
  img.addEventListener("pointermove", pointermove);
  img.addEventListener("pointerup", pointerup);
  img.addEventListener("pointercancel", pointerup);
  img.addEventListener("dragstart", onDragStart);
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
    dispose() {
      img.removeEventListener("pointerdown", pointerdown);
      img.removeEventListener("pointermove", pointermove);
      img.removeEventListener("pointerup", pointerup);
      img.removeEventListener("pointercancel", pointerup);
      img.removeEventListener("dragstart", onDragStart);
      canvas.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
    },
  };
}

/**
 * Large view module: shows a file (image or GLB) at full size with zoom,
 * keyboard navigation and a slideshow.
 * @param {object} deps - Module dependencies.
 * @param {{largeView: HTMLElement, largeCanvas: HTMLElement, largeTitle: HTMLElement, largeInfo: HTMLElement, largeZoom: HTMLInputElement, largeZoomValue: HTMLInputElement, largeBack: HTMLButtonElement, largeSlideshow: HTMLInputElement, largeFit: HTMLButtonElement, largeFullscreen: HTMLButtonElement, largeFullscreenExit: HTMLButtonElement, slideshowProgress: HTMLDivElement}} deps.dom - Large view DOM elements.
 * @param {{get: () => object}} deps.settings - Settings module API.
 * @param {() => Array} deps.getFiles - Returns the media files of the current folder.
 * @returns {{show: Function, close: () => void, isActive: () => boolean, onKeydown: (event: KeyboardEvent) => boolean, toggleSlideshow: () => void, restartSlideshow: () => void}} Large view module API.
 */
export function createLargeView({ dom, settings, getFiles }) {
  const {
    largeView,
    largeCanvas,
    largeTitle,
    largeInfo,
    largeZoom,
    largeZoomValue,
    largeBack,
    largeSlideshow,
    largeFit,
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
   * Disposes the resources of the current large view (renderer, controls, scene,
   * image listeners, object URL) without touching the DOM.
   */
  function disposeResources() {
    if (!largeViewState) return;
    const { renderer, controls, scene, resizeObserver, gltf, objectUrl, imageView } =
      largeViewState;
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement) renderer.domElement.remove();
    }
    if (controls) controls.dispose();
    if (resizeObserver) resizeObserver.disconnect();
    if (imageView) imageView.dispose();
    if (scene) disposeObject(scene);
    if (gltf) disposeObject(gltf.scene);
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
   * Sets the GLB camera zoom to an exact percentage.
   * @param {{camera: object, controls: object, glbBaseDistance: number}} view - Active GLB large view state.
   * @param {number} percent - Zoom in percent.
   */
  function setGlbZoom(view, percent) {
    const { camera, controls, glbBaseDistance } = view;
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position
      .copy(controls.target)
      .addScaledVector(direction, glbDistanceForPercent(glbBaseDistance, percent));
    controls.update();
  }

  /**
   * Applies a zoom percentage to the active large view and syncs the controls.
   * @param {number} percent - Zoom in percent.
   */
  function setZoom(percent) {
    if (!largeViewState) return;
    const clamped = clampZoomPercent(percent);
    if (largeViewState.type === "image" && largeViewState.imageView) {
      largeViewState.imageView.setZoom(clamped);
    } else if (largeViewState.type === "glb") {
      setGlbZoom(largeViewState, clamped);
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
    if (largeViewState.type === "image" && largeViewState.imageView) {
      largeViewState.imageView.fitView();
    } else if (largeViewState.type === "glb") {
      largeViewState.controls.reset();
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
   * Closes and hides the large view.
   */
  function close() {
    largeToken += 1;
    if (fullscreen) window.api.setFullScreen(false);
    dispose();
    stopSlideshow();
    largeView.classList.add("hidden");
    largeTitle.textContent = "";
    largeInfo.textContent = "";
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
    disposeResources();
    largeViewState = { token, file };
    largeView.classList.remove("hidden");
    largeTitle.textContent = file.name;
    largeInfo.textContent = "";
    syncZoomControl(1);

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
    const imageView = createImageView(largeCanvas, img, (scale) => {
      largeInfo.textContent = `${img.naturalWidth}x${img.naturalHeight}`;
      syncZoomControl(scale);
    });
    imageView.fitView();

    frame.classList.add(
      settings.get().slideshowTransition === "slide" ? "enter-slide" : "enter-fade",
    );
    largeCanvas.append(frame);
    retireLargeFrames(direction, frame);

    largeViewState = { token, file, type: "image", objectUrl: url, imageView };
  }

  /**
   * Releases the resources of a GLB view that never became the active large
   * view, because its load failed or was superseded by another navigation.
   * @param {{renderer: object, controls: object, resizeObserver: ResizeObserver, gltf?: object}} parts - Resources to release.
   */
  function disposeUnusedGlbView({ renderer, controls, resizeObserver, gltf }) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.forceContextLoss();
    controls.dispose();
    resizeObserver.disconnect();
    if (gltf) disposeObject(gltf.scene);
  }

  /**
   * Displays a GLB model interactively in the large view.
   * The renderer canvas joins the view only once the model is parsed, so the
   * previous content stays visible for the whole load.
   * @param {{path: string, name: string}} file - File object.
   * @param {number} token - Load token; aborts if the view changed meanwhile.
   * @param {number} [direction] - Navigation direction: 1 forward, -1 backward, 0 none.
   * @returns {Promise<void>}
   */
  async function showGlb(file, token, direction = 0) {
    const data = await window.api.readFile(file.path);
    if (largeViewState?.token !== token) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x242424);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 1.4));
    scene.add(new THREE.DirectionalLight(0xffffff, 1.8));

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(window.devicePixelRatio);
    largeCanvas.style.display = "block";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const resize = () => {
      const width = Math.max(1, largeCanvas.clientWidth);
      const height = Math.max(1, largeCanvas.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(largeCanvas);

    let gltf;
    try {
      gltf = await new Promise((resolve, reject) =>
        new GLTFLoader().parse(data, "", resolve, reject),
      );
    } catch (error) {
      console.error(t("console.glbLoadError"), error);
      disposeUnusedGlbView({ renderer, controls, resizeObserver });
      close();
      return;
    }
    if (largeViewState?.token !== token) {
      disposeUnusedGlbView({ renderer, controls, resizeObserver, gltf });
      return;
    }

    const object = gltf.scene;
    scene.add(object);

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    object.position.sub(center);

    camera.position.set(maxDim * 0.9, maxDim * 0.6, maxDim * 1.6);
    controls.target.set(0, 0, 0);
    controls.update();

    const baseDistance = camera.position.distanceTo(controls.target);
    controls.minDistance = glbDistanceForPercent(baseDistance, MAX_ZOOM_PERCENT);
    controls.maxDistance = glbDistanceForPercent(baseDistance, MIN_ZOOM_PERCENT);
    controls.saveState();
    controls.addEventListener("change", () => {
      if (largeViewState?.type !== "glb") return;
      const distance = camera.position.distanceTo(controls.target);
      syncZoomControl(glbPercentForDistance(baseDistance, distance) / 100);
    });
    syncZoomControl(1);

    largeCanvas.append(renderer.domElement);
    retireLargeFrames(direction);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    largeViewState = {
      token,
      file,
      type: "glb",
      renderer,
      controls,
      scene,
      resizeObserver,
      gltf,
      glbBaseDistance: baseDistance,
    };
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
        if (largeViewState.type === "image" && largeViewState.imageView) {
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
    if (largeViewState.type === "glb") {
      const { controls } = largeViewState;
      if (zoomIn) controls.dollyIn(1.25);
      else if (zoomOut) controls.dollyOut(1.25);
      else controls.reset();
    } else if (largeViewState.type === "image" && largeViewState.imageView) {
      if (zoomIn) largeViewState.imageView.zoomIn();
      else if (zoomOut) largeViewState.imageView.zoomOut();
      else largeViewState.imageView.reset();
    }
    return true;
  }

  largeBack.addEventListener("click", close);
  largeSlideshow.addEventListener("change", toggleSlideshow);
  largeFit.addEventListener("click", fitToScreen);
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
