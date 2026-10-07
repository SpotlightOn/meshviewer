import * as THREE from "three";
import { initI18n, t } from "./i18n.js";
import { createDirectoryTree } from "./tree.js";
import { formatSize, mimeFor, retireFrames, toArrayBuffer } from "./utils.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const THUMB_SIZE = 256;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(THUMB_SIZE, THUMB_SIZE);
renderer.setClearColor(0x3a3a3a, 1);

const upBtn = document.getElementById("btn-up");
const homeBtn = document.getElementById("btn-home");
const currentDirEl = document.getElementById("current-dir");
const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const contentEl = document.querySelector(".content");

const largeView = document.getElementById("large-view");
const largeCanvas = document.getElementById("large-canvas");
const largeTitle = document.getElementById("large-title");
const largeInfo = document.getElementById("large-info");
const largeBack = document.getElementById("large-back");
const largeSlideshow = document.getElementById("large-slideshow");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsInterval = document.getElementById("settings-interval");
const settingsTransition = document.getElementById("settings-transition");
const settingsDuration = document.getElementById("settings-duration");
const settingsSave = document.getElementById("settings-save");
const settingsCancel = document.getElementById("settings-cancel");

let largeViewState = null;
let tree = null;
let currentPath = null;
let currentFiles = [];
let navInFlight = false;
let largeToken = 0;
let slideshowTimer = null;
let settings = {
  slideshowIntervalSeconds: 5,
  slideshowTransition: "fade",
  animationDurationMs: 1000,
};

/**
 * Applies settings to the document styles.
 * @param {{animationDurationMs: number}} value - Settings to read the animation duration from.
 */
function applySettingsToStyles(value) {
  document.documentElement.style.setProperty(
    "--transition-duration",
    `${value.animationDurationMs}ms`,
  );
}

/**
 * Disposes geometries and materials (including textures) of a three.js object.
 * @param {import('three').Object3D} object - Scene or object graph.
 */
function disposeObject(object) {
  object.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        for (const key of Object.keys(material)) {
          const value = material[key];
          if (value && typeof value === "object" && value.isTexture) {
            value.dispose();
          }
        }
        material.dispose();
      }
    }
  });
}

/**
 * Renders a GLB model as a PNG data URL (thumbnail).
 * @param {ArrayBuffer} arrayBuffer - GLB binary data.
 * @returns {Promise<string>} PNG data URL of the rendered thumbnail.
 */
function renderThumbnail(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 1.4));
        scene.add(new THREE.DirectionalLight(0xffffff, 1.8));

        const object = gltf.scene;
        scene.add(object);

        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
        const halfFov = THREE.MathUtils.degToRad(45 / 2);
        const distance = (maxDim / 2 / Math.tan(halfFov)) * 1.25;
        const offset = new THREE.Vector3(0.7, 0.75, 1).normalize().multiplyScalar(distance);

        camera.position.copy(center).add(offset);
        camera.near = distance / 1000;
        camera.far = distance * 10;
        camera.lookAt(center);
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL("image/png");

        disposeObject(scene);
        resolve(dataUrl);
      },
      (error) => reject(error),
    );
  });
}

/**
 * Loads the preview for a card into its thumbnail element.
 * @param {{path: string, name: string, size: number, mtimeMs: number, type: 'glb'|'image'}} file - File object.
 * @param {HTMLDivElement} card - The tile element.
 * @returns {Promise<void>}
 */
async function loadThumb(file, card) {
  const wrap = card.querySelector(".thumb-wrap");
  const thumb = card.querySelector(".thumb");
  try {
    if (file.type === "glb") {
      thumb.src = await renderThumbnail(toArrayBuffer(await window.api.readFile(file.path)));
      wrap.classList.remove("loading");
    } else {
      thumb.src = await loadImageThumbnail(file);
      const markLoaded = () => {
        const displaySize = wrap.clientWidth || THUMB_SIZE;
        if (thumb.naturalWidth <= displaySize && thumb.naturalHeight <= displaySize) {
          thumb.classList.add("natural");
        }
        wrap.classList.remove("loading");
      };
      if (thumb.complete) {
        markLoaded();
      } else {
        thumb.addEventListener("load", markLoaded);
      }
    }
  } catch (error) {
    console.error(`${t("console.previewFailed")} ${file.name}`, error);
    wrap.remove();
    const errorBox = document.createElement("div");
    errorBox.className = "error";
    errorBox.textContent = t("grid.previewFailed");
    card.prepend(errorBox);
  }
}

/**
 * Reads an image file from the thumbnail cache and returns its data URL.
 * Falls back to the full file as a blob URL when no cached thumbnail exists.
 * @param {{path: string, name: string, size: number, mtimeMs: number}} file - File object.
 * @returns {Promise<string>} Data or blob URL of the thumbnail.
 */
async function loadImageThumbnail(file) {
  const dataUrl = await window.api.getThumbnail(file);
  if (dataUrl) return dataUrl;
  const data = await window.api.readFile(file.path);
  const blob = new Blob([toArrayBuffer(data)], { type: mimeFor(file.name) });
  return URL.createObjectURL(blob);
}

/**
 * Creates a grid tile for a file.
 * @param {{path: string, name: string, size: number, mtimeMs: number, type: 'glb'|'image'}} file - File object.
 * @returns {HTMLDivElement} The tile.
 */
function createCard(file) {
  const card = document.createElement("div");
  card.className = "card";
  card.title = file.path;

  const wrap = document.createElement("div");
  wrap.className = "thumb-wrap loading";

  const img = document.createElement("img");
  img.className = "thumb";
  img.alt = file.name;

  wrap.append(img);

  const meta = document.createElement("div");
  meta.className = "meta";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = file.name;

  const size = document.createElement("div");
  size.className = "size";
  size.textContent = `${file.type === "glb" ? t("grid.typeGlb") : t("grid.typeImage")} · ${formatSize(file.size)}`;

  meta.append(name, size);
  card.append(wrap, meta);

  card.addEventListener("click", () => showLargeView(file));
  return card;
}

/**
 * Disposes the resources of the current large view (renderer, controls, scene,
 * image listeners, object URL) without touching the DOM.
 */
function disposeLargeViewResources() {
  if (!largeViewState) return;
  const { renderer, controls, scene, resizeObserver, gltf, objectUrl, imageView } = largeViewState;
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
function disposeLargeView() {
  disposeLargeViewResources();
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
    slide: settings.slideshowTransition === "slide",
    durationMs: settings.animationDurationMs,
    keep,
  });
}

/**
 * Closes and hides the large view.
 */
function closeLargeView() {
  largeToken += 1;
  disposeLargeView();
  stopSlideshow();
  largeView.classList.add("hidden");
  largeTitle.textContent = "";
  largeInfo.textContent = "";
}

/**
 * Stops the slideshow timer and resets the toggle button state.
 */
function stopSlideshow() {
  if (slideshowTimer) {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }
  largeSlideshow.classList.remove("active");
  largeSlideshow.setAttribute("aria-pressed", "false");
}

/**
 * Starts the slideshow, advancing to the next file every interval.
 */
function startSlideshow() {
  if (slideshowTimer) return;
  largeSlideshow.classList.add("active");
  largeSlideshow.setAttribute("aria-pressed", "true");
  const intervalMs = Math.max(1000, settings.slideshowIntervalSeconds * 1000);
  slideshowTimer = setInterval(() => navigateLargeView(1, true), intervalMs);
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
 * Opens the settings dialog with the current values.
 */
function openSettingsDialog() {
  settingsInterval.value = String(settings.slideshowIntervalSeconds);
  settingsTransition.value = settings.slideshowTransition;
  settingsDuration.value = String(settings.animationDurationMs);
  settingsOverlay.classList.remove("hidden");
  settingsInterval.focus();
  settingsInterval.select();
}

/**
 * Closes the settings dialog.
 */
function closeSettingsDialog() {
  settingsOverlay.classList.add("hidden");
}

/**
 * Persists the settings, applies them and restarts a running slideshow.
 * @returns {Promise<void>}
 */
async function saveSettingsDialog() {
  const parsedDuration = Number(settingsDuration.value);
  const next = {
    slideshowIntervalSeconds: Math.max(1, Math.min(3600, Number(settingsInterval.value) || 5)),
    slideshowTransition: settingsTransition.value === "slide" ? "slide" : "fade",
    animationDurationMs: Number.isFinite(parsedDuration)
      ? Math.max(0, Math.min(5000, Math.round(parsedDuration)))
      : settings.animationDurationMs,
  };
  try {
    settings = await window.api.saveSettings(next);
  } catch {
    settings = next;
  }
  applySettingsToStyles(settings);
  if (slideshowTimer) {
    stopSlideshow();
    startSlideshow();
  }
  closeSettingsDialog();
}

settingsSave.addEventListener("click", saveSettingsDialog);
settingsCancel.addEventListener("click", closeSettingsDialog);
settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettingsDialog();
  }
});
window.api.onOpenSettings(openSettingsDialog);

/**
 * Opens the large view for a file (GLB or image).
 * The previous content stays visible until the new one is decoded and fitted;
 * only then do the frames start their transition.
 * @param {{path: string, name: string, size: number, type: 'glb'|'image'}} file - File object.
 * @param {number} [direction] - Navigation direction: 1 forward, -1 backward, 0 none.
 * @returns {Promise<void>}
 */
async function showLargeView(file, direction = 0) {
  const token = ++largeToken;
  disposeLargeViewResources();
  largeViewState = { token, file };
  largeView.classList.remove("hidden");
  largeTitle.textContent = file.name;
  largeInfo.textContent = "";

  try {
    if (file.type === "glb") {
      await showLargeGlb(file, token, direction);
    } else {
      await showLargeImage(file, token, direction);
    }
  } catch (error) {
    console.error(t("console.fileOpenError"), file.path, error);
    if (largeViewState?.token === token) closeLargeView();
  }
}

/**
 * Creates an interactive zoom/pan controller for an image in the large view.
 * Supports mouse-wheel zoom, drag-to-pan, and fit/100% resets.
 * @param {HTMLElement} canvas - The container element.
 * @param {HTMLImageElement} img - The image element (must be loaded).
 * @param {(scale: number) => void} [onChange] - Called after every zoom change with the current scale factor.
 * @returns {{fitView: () => void, zoomIn: (anchor?: {x: number, y: number}) => void, zoomOut: (anchor?: {x: number, y: number}) => void, reset: () => void, toggleFit: () => void, dispose: () => void}} Image view controller.
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
    state.minScale = fitScale();
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
    const next = Math.max(state.minScale, Math.min(64, state.scale * factor));
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
   * Toggles between the fitted view and the original size (Gwenview F key).
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
 * Displays an image at full size in the large view.
 * The frame is built detached, decoded and fitted first, then appended in the
 * same task that starts its enter animation, so no unscaled image is painted.
 * @param {{path: string, name: string}} file - File object.
 * @param {number} token - Load token; aborts if the view changed meanwhile.
 * @param {number} [direction] - Navigation direction: 1 forward, -1 backward, 0 none.
 * @returns {Promise<void>}
 */
async function showLargeImage(file, token, direction = 0) {
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
  if (settings.slideshowTransition === "slide") {
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
    largeInfo.textContent = `${img.naturalWidth}x${img.naturalHeight} | ${Math.round(scale * 100)}%`;
  });
  imageView.fitView();

  frame.classList.add(settings.slideshowTransition === "slide" ? "enter-slide" : "enter-fade");
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
async function showLargeGlb(file, token, direction = 0) {
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
    closeLargeView();
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

  largeCanvas.append(renderer.domElement);
  retireLargeFrames(direction);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  largeViewState = { token, file, type: "glb", renderer, controls, scene, resizeObserver, gltf };
}

/**
 * Handles large view keyboard shortcuts: Esc closes, F5 toggles the slideshow,
 * F toggles fit/original size (Gwenview style), Ctrl++/Ctrl+- zoom
 * (3D dolly or image zoom), Ctrl+0/Ctrl+1 reset to 100%.
 * @param {KeyboardEvent} event - Keyboard event.
 */
function handleLargeViewKeydown(event) {
  if (!settingsOverlay.classList.contains("hidden")) {
    if (event.key === "Escape") {
      closeSettingsDialog();
    }
    return;
  }
  if (largeView.classList.contains("hidden") || !largeViewState) return;

  if (event.key === "Escape") {
    closeLargeView();
    return;
  }

  if (event.key === "f" || event.key === "F") {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (largeViewState.type === "image" && largeViewState.imageView) {
        event.preventDefault();
        largeViewState.imageView.toggleFit();
      }
    }
    return;
  }

  if (event.key === "F5") {
    event.preventDefault();
    toggleSlideshow();
    return;
  }

  const zoomIn = event.key === "+" || event.key === "=" || event.key === "Add";
  const zoomOut = event.key === "-" || event.key === "_" || event.key === "Subtract";
  const reset = event.key === "0" || event.key === "1";
  if (!event.ctrlKey || (!zoomIn && !zoomOut && !reset)) return;

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
}

document.addEventListener("keydown", handleLargeViewKeydown);
largeBack.addEventListener("click", closeLargeView);
largeSlideshow.addEventListener("click", toggleSlideshow);

/**
 * Toggles the window between normal and fullscreen mode on F11.
 * @param {KeyboardEvent} event - Keyboard event.
 */
function handleFullscreen(event) {
  if (event.key !== "F11") return;
  event.preventDefault();
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}

document.addEventListener("keydown", handleFullscreen);

const MIN_TILE = 80;
const MAX_TILE = 600;
const DEFAULT_TILE = 200;
const TILE_STEP = 1.1;

/**
 * Zooms the thumbnail grid with Ctrl++/Ctrl+- and resets it with Ctrl+0.
 * @param {KeyboardEvent} event - Keyboard event.
 */
function handleGridZoom(event) {
  if (!settingsOverlay.classList.contains("hidden")) return;
  if (!largeView.classList.contains("hidden")) return;
  if (!event.ctrlKey) return;

  const zoomIn = event.key === "+" || event.key === "=" || event.key === "Add";
  const zoomOut = event.key === "-" || event.key === "_" || event.key === "Subtract";
  const reset = event.key === "0";
  if (!zoomIn && !zoomOut && !reset) return;

  event.preventDefault();

  const root = document.documentElement;
  const current =
    parseFloat(getComputedStyle(root).getPropertyValue("--tile-size")) || DEFAULT_TILE;
  const base = reset ? DEFAULT_TILE : zoomIn ? current * TILE_STEP : current / TILE_STEP;
  const next = Math.min(MAX_TILE, Math.max(MIN_TILE, base));
  root.style.setProperty("--tile-size", `${next}px`);
}

document.addEventListener("keydown", handleGridZoom);

/**
 * Moves the large view to the previous or next file in the current folder.
 * @param {number} delta - -1 for previous, 1 for next.
 * @param {boolean} [wrap] - Whether to wrap around at the folder boundaries.
 */
function navigateLargeView(delta, wrap = false) {
  if (!largeViewState?.file) return;
  const index = currentFiles.findIndex((file) => file.path === largeViewState.file.path);
  if (index === -1) return;
  const count = currentFiles.length;
  let next = index + delta;
  if (wrap) next = ((next % count) + count) % count;
  if (next < 0 || next >= count) return;
  showLargeView(currentFiles[next], delta);
}

/**
 * Handles next/previous navigation in the large view:
 * ArrowLeft/Backspace for previous, ArrowRight/Space for next (IrfanView style).
 * @param {KeyboardEvent} event - Keyboard event.
 */
function handleLargeViewNavigation(event) {
  if (!largeViewState) return;
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.closest("input, textarea, select")) return;
    if (target.closest("button") && (event.key === " " || event.key === "Enter")) return;
  }

  let delta = 0;
  if (event.key === "ArrowLeft" || event.key === "Backspace") delta = -1;
  else if (event.key === "ArrowRight" || event.key === " ") delta = 1;
  else return;

  event.preventDefault();
  navigateLargeView(delta);
}

document.addEventListener("keydown", handleLargeViewNavigation);

/** @type {number} */
let loadToken = 0;

/** @type {IntersectionObserver|null} */
let thumbnailObserver = null;

/**
 * Loads a folder into the grid and lazily renders its previews.
 * @param {string} dirPath - Path of the folder to display.
 * @returns {Promise<boolean>} true if the folder was opened successfully.
 */
async function loadFolder(dirPath) {
  const token = ++loadToken;
  currentDirEl.value = dirPath;
  grid.innerHTML = "";
  emptyState.style.display = "none";

  let files;
  try {
    files = await window.api.listMediaFiles(dirPath);
  } catch {
    if (token !== loadToken) return false;
    emptyState.textContent = t("grid.loadError");
    emptyState.style.display = "block";
    return false;
  }

  if (token !== loadToken) return false;

  currentPath = dirPath;
  currentFiles = files;

  if (files.length === 0) {
    emptyState.textContent = t("grid.noMedia");
    emptyState.style.display = "block";
    return true;
  }

  const cards = files.map(createCard);
  for (const card of cards) {
    grid.append(card);
  }

  if (thumbnailObserver) thumbnailObserver.disconnect();
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbnailObserver.unobserve(entry.target);
        const index = Number(entry.target.dataset.index);
        loadThumb(files[index], cards[index]);
      }
    },
    { root: contentEl, rootMargin: "400px" },
  );
  for (let i = 0; i < cards.length; i++) {
    const wrap = cards[i].querySelector(".thumb-wrap");
    wrap.dataset.index = String(i);
    thumbnailObserver.observe(wrap);
  }

  return true;
}

/**
 * Opens a directory path, expanding it in the tree if possible.
 * @param {string} dirPath - Absolute path.
 * @returns {Promise<boolean>} true if the folder could be opened.
 */
async function openPath(dirPath) {
  const ok = await loadFolder(dirPath);
  if (ok) {
    await tree.selectPath(dirPath, { notify: false });
  }
  return ok;
}

currentDirEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const value = currentDirEl.value.trim();
    if (!value || value === currentPath) {
      currentDirEl.value = currentPath;
      currentDirEl.blur();
      return;
    }
    navInFlight = true;
    const ok = await openPath(value);
    navInFlight = false;
    if (!ok) {
      currentDirEl.value = currentPath;
    }
    currentDirEl.blur();
  } else if (event.key === "Escape") {
    currentDirEl.value = currentPath;
    currentDirEl.blur();
  }
});

currentDirEl.addEventListener("blur", () => {
  if (!navInFlight && currentPath && currentDirEl.value !== currentPath) {
    currentDirEl.value = currentPath;
  }
});

/**
 * Builds the directory tree for a new root directory.
 * @param {string} dir - Root path of the tree.
 */
function setTreeRoot(dir) {
  const container = document.getElementById("tree");
  container.innerHTML = "";
  tree = createDirectoryTree({
    rootPath: dir,
    rootLabel: dir,
    getChildren: (path) => window.api.listDirectories(path),
    onSelect: (path) => loadFolder(path),
  });
  container.append(tree.el);
}

upBtn.addEventListener("click", async () => {
  const current = tree.getSelectedPath();
  if (!current) return;
  const parent = await window.api.getParentDir(current);
  if (parent !== current) {
    await tree.selectPath(parent);
  }
});

homeBtn.addEventListener("click", async () => {
  await tree.selectPath(await window.api.getHomeDir());
});

window.api.getRootDir().then(async (root) => {
  await initI18n();
  settings = await window.api.getSettings();
  applySettingsToStyles(settings);
  setTreeRoot(root);
  const [home, cwd] = await Promise.all([window.api.getHomeDir(), window.api.getCwd()]);
  currentDirEl.value = home;
  currentPath = cwd;
  if (!(await tree.selectPath(cwd))) {
    await tree.selectPath(home);
  }
});
