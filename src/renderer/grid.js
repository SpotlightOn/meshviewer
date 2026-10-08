import * as THREE from "three";
import { t } from "./i18n.js";
import { disposeObject } from "./three-utils.js";
import { formatSize, mimeFor, toArrayBuffer } from "./utils.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";

const THUMB_SIZE = 256;

const MIN_TILE = 80;
const MAX_TILE = 600;
const DEFAULT_TILE = 200;
const TILE_STEP = 1.1;

// Singleton renderer for GLB thumbnails.
const thumbnailRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
thumbnailRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
thumbnailRenderer.setClearColor(0x3a3a3a, 1);

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

        thumbnailRenderer.render(scene, camera);
        const dataUrl = thumbnailRenderer.domElement.toDataURL("image/png");

        disposeObject(scene);
        resolve(dataUrl);
      },
      (error) => reject(error),
    );
  });
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
 * Media grid module: loads a folder into the tile grid, lazily renders the
 * previews and provides the tile-zoom shortcuts.
 * @param {object} deps - Module dependencies.
 * @param {{grid: HTMLElement, emptyState: HTMLElement, contentEl: HTMLElement}} deps.dom - Grid DOM elements.
 * @param {(file: object) => void} deps.onOpenFile - Called when a tile is clicked.
 * @param {(dirPath: string) => void} deps.onFolderChange - Called when the shown folder changes (updates the location bar).
 * @returns {{loadFolder: (dirPath: string) => Promise<boolean>, getFiles: () => Array, zoomTiles: (step: number) => void}} Grid module API.
 */
export function createGrid({ dom, onOpenFile, onFolderChange }) {
  const { grid, emptyState, contentEl } = dom;
  let files = [];
  let path = null;
  let loadToken = 0;
  let thumbnailObserver = null;

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

    card.addEventListener("click", () => onOpenFile(file));
    return card;
  }

  /**
   * Loads a folder into the grid and lazily renders its previews.
   * @param {string} dirPath - Path of the folder to display.
   * @returns {Promise<boolean>} true if the folder was opened successfully.
   */
  async function loadFolder(dirPath) {
    const token = ++loadToken;
    grid.innerHTML = "";
    emptyState.style.display = "none";

    let loaded;
    try {
      loaded = await window.api.listMediaFiles(dirPath);
    } catch {
      if (token !== loadToken) return false;
      emptyState.textContent = t("grid.loadError");
      emptyState.style.display = "block";
      return false;
    }

    if (token !== loadToken) return false;

    path = dirPath;
    files = loaded;
    onFolderChange(dirPath);

    if (files.length === 0) {
      emptyState.textContent = t("grid.noMedia");
      emptyState.style.display = "block";
      return true;
    }

    const cards = files.map(createCard);
    const fragment = document.createDocumentFragment();
    for (const card of cards) {
      fragment.append(card);
    }
    grid.append(fragment);

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
   * Returns the media files of the currently shown folder.
   * @returns {Array} Current file list.
   */
  function getFiles() {
    return files;
  }

  /**
   * Returns the path of the currently shown folder.
   * @returns {string | null} Current folder path.
   */
  function getPath() {
    return path;
  }

  /**
   * Zooms the thumbnail grid: step > 0 enlarges, step < 0 shrinks, 0 resets.
   * @param {number} step - Zoom direction.
   */
  function zoomTiles(step) {
    const root = document.documentElement;
    const current =
      parseFloat(getComputedStyle(root).getPropertyValue("--tile-size")) || DEFAULT_TILE;
    const base = step === 0 ? DEFAULT_TILE : step > 0 ? current * TILE_STEP : current / TILE_STEP;
    const next = Math.min(MAX_TILE, Math.max(MIN_TILE, base));
    root.style.setProperty("--tile-size", `${next}px`);
  }

  return { loadFolder, getFiles, getPath, zoomTiles };
}
