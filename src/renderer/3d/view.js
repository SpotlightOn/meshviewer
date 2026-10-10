import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createRenderSurface } from "../three/render-surface.js";
import { clampZoomPercent, MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT } from "../utils.js";
import { disposeObject, glbDistanceForPercent, glbPercentForDistance } from "./utils.js";

const CAMERA_FOV = 45;
const CAMERA_NEAR = 0.01;
const CAMERA_FAR = 1000;
const DOLLY_FACTOR = 1.25;

/**
 * Creates an interactive GLB model viewer that renders a parsed model with
 * OrbitControls: dragging orbits the camera, the mouse wheel zooms it, and the
 * zoom percentage maps to the camera distance. The canvas joins the host only
 * after the model was parsed, and all WebGL resources are self-contained.
 * @param {HTMLElement} host - Container element that receives the canvas.
 * @param {(percent: number) => void} [onChange] - Called after the zoom changed with the zoom percentage.
 * @returns {{activate: () => void, deactivate: () => void, load: (data: ArrayBuffer) => Promise<void>, setZoomPercent: (percent: number) => void, zoomIn: () => void, zoomOut: () => void, reset: () => void, dispose: () => void}} GLB viewer controller.
 */
function createGlbView({ host, onChange }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x242424);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 1.4));
  scene.add(new THREE.DirectionalLight(0xffffff, 1.8));

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  const surface = createRenderSurface({
    host,
    onResize: ({ width, height }) => {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
  });
  const canvas = surface.canvas;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  let gltf = null;
  let baseDistance = 0;
  let active = false;
  let loaded = false;
  let disposed = false;

  /**
   * Renders one frame: updates the damped controls and draws the scene.
   */
  function render() {
    controls.update();
    surface.renderer.render(scene, camera);
  }

  /**
   * Shows the canvas, resumes the render loop and draws a first frame.
   */
  function activate() {
    if (disposed || active) return;
    active = true;
    surface.resize();
    canvas.style.display = "block";
    if (!canvas.isConnected) host.append(canvas);
    surface.start(render);
    render();
  }

  /**
   * Stops the render loop and hides the canvas without releasing resources.
   */
  function deactivate() {
    if (disposed || !active) return;
    active = false;
    surface.stop();
    canvas.style.display = "none";
  }

  /**
   * Parses and displays the model, then activates the view. The canvas joins
   * the host only once the model is parsed, so the previous content stays
   * visible for the whole load.
   * @param {ArrayBuffer} data - GLB binary data.
   * @returns {Promise<void>} Resolves when the model is shown, rejects on a parse error.
   */
  async function load(data) {
    if (disposed) return;

    let parsed;
    try {
      parsed = await new Promise((resolve, reject) =>
        new GLTFLoader().parse(data, "", resolve, reject),
      );
    } catch (error) {
      dispose();
      throw error;
    }
    if (disposed) {
      disposeObject(parsed.scene);
      return;
    }
    gltf = parsed;

    const object = parsed.scene;
    scene.add(object);

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    object.position.sub(center);

    camera.position.set(maxDim * 0.9, maxDim * 0.6, maxDim * 1.6);
    controls.target.set(0, 0, 0);
    controls.update();

    baseDistance = camera.position.distanceTo(controls.target);
    controls.minDistance = glbDistanceForPercent(baseDistance, MAX_ZOOM_PERCENT);
    controls.maxDistance = glbDistanceForPercent(baseDistance, MIN_ZOOM_PERCENT);
    controls.saveState();
    controls.addEventListener("change", onControlsChange);

    loaded = true;
    activate();
  }

  /**
   * Reports the current camera distance as a zoom percentage.
   */
  function onControlsChange() {
    if (disposed) return;
    const distance = camera.position.distanceTo(controls.target);
    onChange?.(glbPercentForDistance(baseDistance, distance));
  }

  /**
   * Sets the camera zoom to an exact percentage (mapped to the distance).
   * @param {number} percent - Zoom in percent.
   */
  function setZoomPercent(percent) {
    if (!loaded || disposed) return;
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position
      .copy(controls.target)
      .addScaledVector(direction, glbDistanceForPercent(baseDistance, clampZoomPercent(percent)));
    controls.update();
  }

  /**
   * Dollies the camera in.
   */
  function zoomIn() {
    if (loaded && !disposed) controls.dollyIn(DOLLY_FACTOR);
  }

  /**
   * Dollies the camera out.
   */
  function zoomOut() {
    if (loaded && !disposed) controls.dollyOut(DOLLY_FACTOR);
  }

  /**
   * Restores the camera to the initial fit position.
   */
  function reset() {
    if (loaded && !disposed) controls.reset();
  }

  /**
   * Releases all WebGL resources and removes the canvas.
   */
  function dispose() {
    if (disposed) return;
    disposed = true;
    surface.stop();
    controls.dispose();
    surface.dispose();
    if (gltf) disposeObject(gltf.scene);
  }

  return { activate, deactivate, load, setZoomPercent, zoomIn, zoomOut, reset, dispose };
}

export { createGlbView };
