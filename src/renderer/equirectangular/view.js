import * as THREE from "three";
import { createRenderSurface } from "../three/render-surface.js";
import { EQUIRECT_FOV_MAX, EQUIRECT_FOV_MIN, fovForPercent, percentForFov } from "./utils.js";

const SPHERE_RADIUS = 500;
const SPHERE_SEGMENTS = 60;
const SPHERE_RINGS = 40;
const LAT_CLAMP_DEG = 85;
const WHEEL_FOV_STEP = 0.05;
const DRAG_SENSITIVITY = 0.1;
const ZOOM_STEP = 1.25;

/**
 * Creates an equirectangular panorama view that maps an already decoded image
 * onto the inside of a sphere: dragging looks around and the mouse wheel or the
 * zoom percentage change the field of view. The canvas stays hidden until
 * activated and is layered over the normal image while active. While active it
 * consumes its own pointer and wheel events, so the image view beneath stays
 * inert.
 * @param {HTMLElement} host - Container element that receives the canvas.
 * @param {HTMLImageElement} image - Decoded image element used as the texture.
 * @param {(percent: number) => void} onChange - Called after the zoom changed with the zoom percentage.
 * @returns {{activate: () => void, deactivate: () => void, setZoomPercent: (percent: number) => void, zoomIn: () => void, zoomOut: () => void, reset: () => void, dispose: () => void}} Panorama view controller.
 */
function createEquirectView({ host, image, onChange }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fovForPercent(100), 1, 1, 1100);
  const surface = createRenderSurface({
    host,
    onResize: ({ width, height }) => {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  });
  const canvas = surface.canvas;
  canvas.className = "equirect-canvas";
  canvas.style.display = "none";

  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS, SPHERE_RINGS);
  // Invert the geometry on the x-axis so that all of the faces point inward.
  geometry.scale(-1, 1, 1);
  scene.add(new THREE.Mesh(geometry, material));

  const state = { lon: 0, lat: 0 };
  let pointerId = null;
  let downX = 0;
  let downY = 0;
  let downLon = 0;
  let downLat = 0;
  let active = false;
  let disposed = false;

  /**
   * Renders the sphere from the current look direction.
   */
  function render() {
    const lat = THREE.MathUtils.clamp(state.lat, -LAT_CLAMP_DEG, LAT_CLAMP_DEG);
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(state.lon);
    camera.lookAt(
      SPHERE_RADIUS * Math.sin(phi) * Math.cos(theta),
      SPHERE_RADIUS * Math.cos(phi),
      SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta),
    );
    surface.renderer.render(scene, camera);
  }

  /**
   * Applies a field of view clamped to the panorama range, redraws while active
   * and reports the resulting zoom percentage.
   * @param {number} fov - Field of view in degrees.
   */
  function updateFov(fov) {
    camera.fov = THREE.MathUtils.clamp(fov, EQUIRECT_FOV_MIN, EQUIRECT_FOV_MAX);
    camera.updateProjectionMatrix();
    if (active) render();
    onChange?.(percentForFov(camera.fov));
  }

  /**
   * Shows the canvas, attaches the look-around listeners and starts the loop.
   */
  function activate() {
    if (disposed || active) return;
    active = true;
    surface.resize();
    canvas.style.display = "block";
    canvas.style.cursor = "grab";
    if (!canvas.isConnected) host.append(canvas);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    surface.start(render);
    render();
  }

  /**
   * Detaches the look-around listeners, stops the loop and hides the canvas
   * without releasing resources.
   */
  function deactivate() {
    if (disposed || !active) return;
    teardown();
  }

  /**
   * Detaches the look-around listeners, stops the loop and hides the canvas. It
   * deliberately ignores the `disposed` flag so disposal can reuse it.
   */
  function teardown() {
    active = false;
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    surface.stop();
    canvas.style.display = "none";
  }

  /**
   * Sets the zoom to an exact percentage (mapped to the field of view).
   * @param {number} percent - Zoom in percent.
   */
  function setZoomPercent(percent) {
    if (disposed) return;
    updateFov(fovForPercent(percent));
  }

  /**
   * Narrows the field of view (zooms in).
   */
  function zoomIn() {
    if (disposed) return;
    updateFov(camera.fov / ZOOM_STEP);
  }

  /**
   * Widens the field of view (zooms out).
   */
  function zoomOut() {
    if (disposed) return;
    updateFov(camera.fov * ZOOM_STEP);
  }

  /**
   * Returns to the initial look direction and zoom.
   */
  function reset() {
    if (disposed) return;
    state.lon = 0;
    state.lat = 0;
    updateFov(fovForPercent(100));
  }

  /**
   * Releases all WebGL resources and removes the canvas.
   */
  function dispose() {
    if (disposed) return;
    disposed = true;
    teardown();
    surface.dispose();
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  /**
   * Starts looking around with the primary pointer.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.isPrimary === false) return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    downX = event.clientX;
    downY = event.clientY;
    downLon = state.lon;
    downLat = state.lat;
    canvas.style.cursor = "grabbing";
  }

  /**
   * Updates the look direction while dragging.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerMove(event) {
    event.stopPropagation();
    if (event.pointerId !== pointerId) return;
    state.lon = (downX - event.clientX) * DRAG_SENSITIVITY + downLon;
    state.lat = (event.clientY - downY) * DRAG_SENSITIVITY + downLat;
  }

  /**
   * Ends a look-around drag and releases the captured pointer.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerUp(event) {
    event.stopPropagation();
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  }

  /**
   * Zooms with the mouse wheel by changing the field of view. The event is
   * consumed so the image view beneath does not zoom at the same time.
   * @param {WheelEvent} event - Wheel event.
   */
  function onWheel(event) {
    event.preventDefault();
    event.stopPropagation();
    updateFov(camera.fov + event.deltaY * WHEEL_FOV_STEP);
  }

  return { activate, deactivate, setZoomPercent, zoomIn, zoomOut, reset, dispose };
}

export { createEquirectView };
