import { renderGlbThumbnail } from "./3d/thumbnails.js";
import { t } from "./i18n.js";
import { formatSize, mimeFor, toArrayBuffer } from "./utils.js";

const MIN_TILE = 80;
const MAX_TILE = 600;
const DEFAULT_TILE = 200;
const TILE_STEP = 1.1;

/** Inline Material Symbols "folder" (outlined) icon for folder tiles. */
const FOLDER_ICON =
  '<svg class="folder-icon" viewBox="0 -960 960 960" aria-hidden="true"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>';

/**
 * Returns the indices of cards whose bounding rect intersects the given rect.
 * @param {ArrayLike<HTMLElement>} cards - Grid cards.
 * @param {DOMRect} rect - Rectangle in viewport coordinates.
 * @returns {Array<number>} Matching card indices.
 */
export function cardIndexesInRect(cards, rect) {
  const indices = [];
  for (const card of cards) {
    const cardRect = card.getBoundingClientRect();
    const intersects = !(
      rect.right < cardRect.left ||
      rect.left > cardRect.right ||
      rect.bottom < cardRect.top ||
      rect.top > cardRect.bottom
    );
    if (intersects) indices.push(Number(card.dataset.index));
  }
  return indices;
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
      thumb.src = await renderGlbThumbnail(toArrayBuffer(await window.api.readFile(file.path)));
      wrap.classList.remove("loading");
    } else {
      thumb.src = await loadImageThumbnail(file);
      const markLoaded = () => wrap.classList.remove("loading");
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
 * Grid module: loads a folder into the tile grid (subdirectories first, then
 * the media files), lazily renders the previews, provides the tile-zoom
 * shortcuts and manages multi-selection with copy/paste and move-to-trash of
 * the selected entries.
 * @param {object} deps - Module dependencies.
 * @param {{grid: HTMLElement, emptyState: HTMLElement, emptyMessage: HTMLElement, contentEl: HTMLElement, selectionInfo?: HTMLElement}} deps.dom - Grid DOM elements.
 * @param {(file: object) => void} deps.onOpenFile - Called when a media tile is clicked.
 * @param {(dirPath: string) => void} deps.onOpenFolder - Called when a folder tile is clicked.
 * @param {(dirPath: string) => void} deps.onFolderChange - Called when the shown folder changes (updates the location bar).
 * @param {(dirPath: string) => void} [deps.onDirectoriesChanged] - Called after a paste or a trash that may have changed a folder's subdirectories, so other views (the tree) can refresh.
 * @param {() => object} [deps.getSettings] - Returns the current settings (used for the move checksum option).
 * @returns {{loadFolder: (dirPath: string) => Promise<boolean>, getFiles: () => Array, getEntry: (index: number) => object|undefined, getPath: () => string|null, zoomTiles: (step: number) => void, getSelectionFiles: () => Array, hasSelection: () => boolean, selectAll: () => void, clearSelection: () => void, ensureInSelection: (index: number) => void, copySelection: () => void, cutSelection: () => void, hasCopyBuffer: () => boolean, paste: (targetDir?: string) => Promise<boolean>, trashSelection: () => Promise<boolean>, flash: (message: string) => void}} Grid module API.
 */
export function createGrid({
  dom,
  onOpenFile,
  onOpenFolder,
  onFolderChange,
  onDirectoriesChanged,
  getSettings,
}) {
  const { grid, emptyState, emptyMessage, contentEl, selectionInfo } = dom;
  let entries = [];
  let path = null;
  let loadToken = 0;
  let thumbnailObserver = null;
  let selectedIndices = new Set();
  let anchorIndex = null;
  let copyBuffer = [];
  let flashTimer = null;

  /**
   * Creates a grid tile for a folder or media entry.
   * @param {{kind: string, path: string, name: string, size?: number, mtimeMs?: number, type?: 'glb'|'image'}} entry - Entry object.
   * @returns {HTMLDivElement} The tile.
   */
  function createCard(entry) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.kind = entry.kind;
    card.title = entry.path;

    const wrap = document.createElement("div");
    wrap.className = "thumb-wrap";

    if (entry.kind === "folder") {
      wrap.innerHTML = FOLDER_ICON;
    } else {
      wrap.classList.add("loading");
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = entry.name;
      img.decoding = "async";
      img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
      wrap.append(img);
    }

    const meta = document.createElement("div");
    meta.className = "meta";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = entry.name;

    const size = document.createElement("div");
    size.className = "size";
    size.textContent =
      entry.kind === "folder"
        ? t("grid.typeFolder")
        : `${entry.kind === "glb" ? t("grid.typeGlb") : t("grid.typeImage")} · ${formatSize(entry.size)}`;

    meta.append(name, size);
    card.append(wrap, meta);

    card.addEventListener("click", (event) => {
      const index = Number(card.dataset.index);
      if (event.ctrlKey || event.metaKey) {
        toggleSelect(index);
        return;
      }
      if (event.shiftKey) {
        rangeSelect(index);
        return;
      }
      selectOnly(index);
      if (entry.kind === "folder") onOpenFolder(entry.path);
      else onOpenFile(entry);
    });
    return card;
  }

  /**
   * Applies the selection class to the cards and updates the selection badge.
   */
  function renderSelection() {
    for (const card of grid.children) {
      const index = Number(card.dataset.index);
      card.classList.toggle("selected", Number.isFinite(index) && selectedIndices.has(index));
    }
    updateSelectionInfo();
  }

  /**
   * Updates the persistent selection count badge in the content area.
   */
  function updateSelectionInfo() {
    if (!selectionInfo) return;
    const count = selectedIndices.size;
    if (count === 0) {
      selectionInfo.hidden = true;
      return;
    }
    selectionInfo.hidden = false;
    selectionInfo.textContent = t("grid.nSelected", { count });
  }

  /**
   * Shows a transient status message in the selection badge area.
   * @param {string} message - Message text.
   */
  function flashMessage(message) {
    if (!selectionInfo) return;
    selectionInfo.hidden = false;
    selectionInfo.textContent = message;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      updateSelectionInfo();
    }, 1600);
  }

  /**
   * Replaces the selection with a single card and sets the anchor.
   * @param {number} index - Card index.
   */
  function selectOnly(index) {
    selectedIndices = new Set([index]);
    anchorIndex = index;
    renderSelection();
  }

  /**
   * Replaces the selection with the range from the anchor to the given card.
   * @param {number} index - Card index.
   */
  function rangeSelect(index) {
    const from = anchorIndex ?? index;
    const lo = Math.min(from, index);
    const hi = Math.max(from, index);
    const next = new Set();
    for (let i = lo; i <= hi; i += 1) next.add(i);
    selectedIndices = next;
    anchorIndex = index;
    renderSelection();
  }

  /**
   * Toggles a card in the selection and sets the anchor.
   * @param {number} index - Card index.
   */
  function toggleSelect(index) {
    const next = new Set(selectedIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selectedIndices = next;
    anchorIndex = index;
    renderSelection();
  }

  /**
   * Selects every entry in the current folder.
   */
  function selectAll() {
    selectedIndices = new Set(entries.map((_, index) => index));
    anchorIndex = entries.length > 0 ? 0 : null;
    renderSelection();
  }

  /**
   * Clears the selection and hides the badge.
   */
  function clearSelection() {
    selectedIndices = new Set();
    anchorIndex = null;
    renderSelection();
  }

  /**
   * Ensures a card is part of the selection (used on right-click).
   * @param {number} index - Card index.
   */
  function ensureInSelection(index) {
    if (selectedIndices.has(index)) return;
    selectOnly(index);
  }

  /**
   * Returns the selected entries (folders and files) in grid order.
   * @returns {Array} Selected entry objects.
   */
  function getSelectionFiles() {
    return [...selectedIndices]
      .sort((a, b) => a - b)
      .map((index) => entries[index])
      .filter(Boolean);
  }

  /**
   * Returns whether any card is selected.
   * @returns {boolean} true when a selection exists.
   */
  function hasSelection() {
    return selectedIndices.size > 0;
  }

  /**
   * Copies the selected entries into the in-app clipboard.
   */
  function copySelection() {
    const selected = getSelectionFiles();
    if (selected.length === 0) return;
    copyBuffer = selected.map((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
    }));
    flashMessage(t("grid.copyBuffer", { count: selected.length }));
  }

  /**
   * Cuts the selected entries into the in-app clipboard: a later paste moves
   * them instead of copying them.
   */
  function cutSelection() {
    const selected = getSelectionFiles();
    if (selected.length === 0) return;
    copyBuffer = selected.map((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      cut: true,
    }));
    flashMessage(t("grid.cutBuffer", { count: selected.length }));
  }

  /**
   * Returns whether the clipboard holds copied files.
   * @returns {boolean} true when copied files are available.
   */
  function hasCopyBuffer() {
    return copyBuffer.length > 0;
  }

  /**
   * Pastes the clipboard into a directory and reloads the grid when the shown
   * folder is affected. Cut entries are moved: each source is removed after its
   * copy succeeded and the cut clipboard is consumed. Entries that already live
   * in the target directory stay unchanged.
   * @param {string} [targetDir] - Destination directory; defaults to the current folder.
   * @returns {Promise<boolean>} true when at least one entry was pasted.
   */
  async function paste(targetDir = path) {
    if (copyBuffer.length === 0 || !targetDir) return false;
    const moved = copyBuffer.some((file) => file.cut);
    const hasFolder = copyBuffer.some((file) => file.kind === "folder");
    const paths = copyBuffer.map((file) => file.path);
    const results = moved
      ? await window.api.moveFiles(paths, targetDir, {
          checksum: getSettings?.()?.verifyMoveChecksum === true,
        })
      : await window.api.copyFiles(paths, targetDir);
    const ok = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    if (targetDir === path || (moved && path)) await loadFolder(path);
    if (hasFolder) {
      onDirectoriesChanged?.(targetDir);
      if (moved && path && targetDir !== path) onDirectoriesChanged?.(path);
    }
    if (failed.length > 0) {
      console.error(t("console.pasteFailed"), failed);
    }
    flashMessage(t("grid.pasteDone", { count: ok.length }));
    if (moved) copyBuffer = [];
    return ok.length > 0;
  }

  /**
   * Moves the selected entries to the OS trash and reloads the grid.
   * @returns {Promise<boolean>} true when at least one entry was trashed.
   */
  async function trashSelection() {
    const selected = getSelectionFiles();
    if (selected.length === 0) return false;
    const hadFolder = selected.some((entry) => entry.kind === "folder");
    const result = await window.api.trashFiles(selected.map((entry) => entry.path));
    await loadFolder(path);
    if (hadFolder) onDirectoriesChanged?.(path);
    if (result.failed.length > 0) {
      console.error(t("console.trashFailed"), result.failed);
    }
    flashMessage(t("grid.trashed", { count: result.trashed.length }));
    return result.trashed.length > 0;
  }

  /**
   * Starts a rubber-band selection drag on the empty grid background.
   * @param {PointerEvent} event - Pointer down event.
   */
  function startMarquee(event) {
    const baseRect = grid.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "marquee";
    grid.append(overlay);
    const startX = event.clientX;
    const startY = event.clientY;
    const startSelection = new Set(selectedIndices);
    const apply = (moveEvent) => {
      const left = Math.min(startX, moveEvent.clientX);
      const top = Math.min(startY, moveEvent.clientY);
      overlay.style.left = `${left - baseRect.left}px`;
      overlay.style.top = `${top - baseRect.top}px`;
      overlay.style.width = `${Math.abs(moveEvent.clientX - startX)}px`;
      overlay.style.height = `${Math.abs(moveEvent.clientY - startY)}px`;
      const rect = new DOMRect(
        left,
        top,
        Math.abs(moveEvent.clientX - startX),
        Math.abs(moveEvent.clientY - startY),
      );
      const indices = cardIndexesInRect(grid.querySelectorAll(".card"), rect);
      if (moveEvent.ctrlKey || moveEvent.metaKey) {
        selectedIndices = new Set(startSelection);
        for (const index of indices) selectedIndices.add(index);
      } else {
        selectedIndices = new Set(indices);
      }
      anchorIndex = indices.length > 0 ? indices[0] : null;
      renderSelection();
    };
    const finish = () => {
      document.removeEventListener("pointermove", apply);
      document.removeEventListener("pointerup", finish);
      overlay.remove();
    };
    document.addEventListener("pointermove", apply);
    document.addEventListener("pointerup", finish);
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

    let directories;
    let media;
    try {
      [directories, media] = await Promise.all([
        window.api.listDirectories(dirPath),
        window.api.listMediaFiles(dirPath),
      ]);
    } catch {
      if (token !== loadToken) return false;
      emptyMessage.textContent = t("grid.loadError");
      emptyState.style.display = "flex";
      return false;
    }

    if (token !== loadToken) return false;

    path = dirPath;
    const folders = directories.map((dir) => ({ kind: "folder", path: dir.path, name: dir.name }));
    const mediaEntries = media.map((file) => ({ ...file, kind: file.type }));
    entries = [...folders, ...mediaEntries];
    selectedIndices = new Set();
    anchorIndex = null;
    renderSelection();
    onFolderChange(dirPath);

    if (entries.length === 0) {
      emptyMessage.textContent = t("grid.noMedia");
      emptyState.style.display = "flex";
      return true;
    }

    const cards = entries.map((entry, index) => {
      const card = createCard(entry);
      card.dataset.index = String(index);
      return card;
    });
    const fragment = document.createDocumentFragment();
    for (const card of cards) {
      fragment.append(card);
    }
    grid.append(fragment);

    if (thumbnailObserver) thumbnailObserver.disconnect();
    thumbnailObserver = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (!record.isIntersecting) continue;
          thumbnailObserver.unobserve(record.target);
          const index = Number(record.target.dataset.index);
          loadThumb(entries[index], cards[index]);
        }
      },
      { root: contentEl, rootMargin: "400px" },
    );
    for (let i = 0; i < cards.length; i++) {
      if (entries[i].kind === "folder") continue;
      const wrap = cards[i].querySelector(".thumb-wrap");
      wrap.dataset.index = String(i);
      thumbnailObserver.observe(wrap);
    }

    return true;
  }

  /**
   * Returns the media files of the currently shown folder.
   * @returns {Array} Current media file list.
   */
  function getFiles() {
    return entries.filter((entry) => entry.kind !== "folder");
  }

  /**
   * Returns the entry at a card index.
   * @param {number} index - Card index.
   * @returns {object | undefined} Entry object.
   */
  function getEntry(index) {
    return entries[index];
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

  grid.addEventListener("contextmenu", (event) => {
    const card = event.target.closest?.(".card");
    if (!card || card.dataset.index === undefined) return;
    const index = Number(card.dataset.index);
    if (!selectedIndices.has(index)) selectOnly(index);
  });

  grid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest?.(".card")) return;
    if (emptyState.style.display !== "none") return;
    startMarquee(event);
  });

  return {
    clearSelection,
    copySelection,
    cutSelection,
    ensureInSelection,
    flash: flashMessage,
    getEntry,
    getFiles,
    getPath,
    getSelectionFiles,
    hasCopyBuffer,
    hasSelection,
    loadFolder,
    paste,
    selectAll,
    trashSelection,
    zoomTiles,
  };
}
