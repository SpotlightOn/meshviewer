import * as THREE from "three";
import { initI18n, t } from "./i18n.js";
import { createDirectoryTree } from "./tree.js";
import { formatSize, mimeFor, toArrayBuffer } from "./utils.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const THUMB_SIZE = 256;
const CONCURRENCY = 4;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(THUMB_SIZE, THUMB_SIZE);
renderer.setClearColor(0x3a3a3a, 1);

const upBtn = document.getElementById("btn-up");
const homeBtn = document.getElementById("btn-home");
const currentDirEl = document.getElementById("current-dir");
const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");

const largeView = document.getElementById("large-view");
const largeCanvas = document.getElementById("large-canvas");
const largeTitle = document.getElementById("large-title");
const largeBack = document.getElementById("large-back");

let largeViewState = null;
let tree = null;
let currentPath = null;
let navInFlight = false;

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
 * Processes a list with limited concurrency.
 * @template T
 * @template R
 * @param {Array<T>} items - Items to process.
 * @param {number} concurrency - Maximum number of parallel workers.
 * @param {(item: T, index: number) => Promise<R>} worker - Async processing function.
 * @returns {Promise<Array<R>>} Results in original order.
 */
async function processQueue(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Reads an image file and creates a blob URL for it.
 * @param {{path: string, name: string}} file - File object.
 * @returns {Promise<string>} Blob URL of the image.
 */
async function loadImageThumbnail(file) {
  const data = await window.api.readFile(file.path);
  const blob = new Blob([toArrayBuffer(data)], { type: mimeFor(file.name) });
  return URL.createObjectURL(blob);
}

/**
 * Creates a grid tile for a file.
 * @param {{path: string, name: string, size: number, type: 'glb'|'image'}} file - File object.
 * @returns {HTMLDivElement} The tile.
 */
function createCard(file) {
  const card = document.createElement("div");
  card.className = "card";
  card.title = file.path;

  const wrap = document.createElement("div");
  wrap.className = "thumb-wrap loading";

  const thumb = document.createElement("img");
  thumb.className = "thumb";
  thumb.alt = file.name;

  wrap.append(thumb);

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
 * Disposes the resources of the large view (renderer, controls, scene).
 */
function disposeLargeView() {
  if (largeViewState) {
    const { renderer, controls, scene, resizeObserver, gltf, objectUrl } = largeViewState;
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement) renderer.domElement.remove();
    }
    if (controls) controls.dispose();
    if (resizeObserver) resizeObserver.disconnect();
    if (scene) disposeObject(scene);
    if (gltf) disposeObject(gltf.scene);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    largeViewState = null;
  }
  largeCanvas.replaceChildren();
  largeCanvas.style.display = "none";
}

/**
 * Closes and hides the large view.
 */
function closeLargeView() {
  disposeLargeView();
  largeView.classList.add("hidden");
  largeTitle.textContent = "";
}

/**
 * Opens the large view for a file (GLB or image).
 * @param {{path: string, name: string, size: number, type: 'glb'|'image'}} file - File object.
 * @returns {Promise<void>}
 */
async function showLargeView(file) {
  closeLargeView();
  largeView.classList.remove("hidden");
  largeTitle.textContent = file.name;

  if (file.type === "glb") {
    await showLargeGlb(file);
  } else {
    await showLargeImage(file);
  }
}

/**
 * Displays an image at full size in the large view.
 * @param {{path: string, name: string}} file - File object.
 * @returns {Promise<void>}
 */
async function showLargeImage(file) {
  const data = await window.api.readFile(file.path);
  const blob = new Blob([toArrayBuffer(data)], { type: mimeFor(file.name) });
  const url = URL.createObjectURL(blob);

  const img = document.createElement("img");
  img.className = "large-image";
  img.alt = file.name;
  img.src = url;
  largeCanvas.append(img);
  largeCanvas.style.display = "flex";

  largeViewState = { objectUrl: url };
}

/**
 * Displays a GLB model interactively in the large view.
 * @param {{path: string, name: string}} file - File object.
 * @returns {Promise<void>}
 */
async function showLargeGlb(file) {
  const data = await window.api.readFile(file.path);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x242424);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 1.4));
  scene.add(new THREE.DirectionalLight(0xffffff, 1.8));

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio);
  largeCanvas.append(renderer.domElement);
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
    closeLargeView();
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

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  largeViewState = { renderer, controls, scene, resizeObserver, gltf };
}

/**
 * Closes the large view on ESC key press.
 * @param {KeyboardEvent} event - Keyboard event.
 */
function handleEscape(event) {
  if (event.key === "Escape" && !largeView.classList.contains("hidden")) {
    closeLargeView();
  }
}

document.addEventListener("keydown", handleEscape);
largeBack.addEventListener("click", closeLargeView);

/** @type {number} */
let loadToken = 0;

/**
 * Loads a folder into the grid and renders its previews.
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

  if (files.length === 0) {
    emptyState.textContent = t("grid.noMedia");
    emptyState.style.display = "block";
    return true;
  }

  const cards = files.map(createCard);
  for (const card of cards) {
    grid.append(card);
  }

  await processQueue(files, CONCURRENCY, async (file, i) => {
    const card = cards[i];
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
  });

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
  setTreeRoot(root);
  const [home, cwd] = await Promise.all([window.api.getHomeDir(), window.api.getCwd()]);
  currentDirEl.value = home;
  currentPath = cwd;
  if (!(await tree.selectPath(cwd))) {
    await tree.selectPath(home);
  }
});
