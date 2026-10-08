import { createGrid } from "./grid.js";
import { initI18n } from "./i18n.js";
import { createKeyboard } from "./keyboard.js";
import { createLargeView } from "./large-view.js";
import { createSettings } from "./settings.js";
import { createDirectoryTree } from "./tree.js";

const upBtn = document.getElementById("btn-up");
const homeBtn = document.getElementById("btn-home");
const currentDirEl = document.getElementById("current-dir");

// Late-bound reference to the large view module: it is owned by callbacks
// that only fire after the whole module graph is constructed.
const largeViewRef = { current: null };

const settings = createSettings({
  dom: {
    overlay: document.getElementById("settings-overlay"),
    interval: document.getElementById("settings-interval"),
    transition: document.getElementById("settings-transition"),
    duration: document.getElementById("settings-duration"),
    save: document.getElementById("settings-save"),
    cancel: document.getElementById("settings-cancel"),
  },
  onSaved: () => largeViewRef.current?.restartSlideshow(),
});

let grid;
const largeView = createLargeView({
  dom: {
    largeView: document.getElementById("large-view"),
    largeCanvas: document.getElementById("large-canvas"),
    largeTitle: document.getElementById("large-title"),
    largeInfo: document.getElementById("large-info"),
    largeZoom: document.getElementById("large-zoom"),
    largeZoomValue: document.getElementById("large-zoom-value"),
    largeBack: document.getElementById("large-back"),
    largeSlideshow: document.getElementById("large-slideshow"),
  },
  settings,
  getFiles: () => grid.getFiles(),
});
largeViewRef.current = largeView;

grid = createGrid({
  dom: {
    grid: document.getElementById("grid"),
    emptyState: document.getElementById("empty-state"),
    contentEl: document.querySelector(".content"),
  },
  onOpenFile: (file) => largeViewRef.current?.show(file),
  onFolderChange: (dirPath) => {
    currentDirEl.value = dirPath;
  },
});

createKeyboard({ settings, largeView, grid });

/** @type {ReturnType<typeof createDirectoryTree> | null} */
let tree = null;
let navInFlight = false;

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
    onSelect: (path) => grid.loadFolder(path),
  });
  container.append(tree.el);
}

/**
 * Opens a directory path, expanding it in the tree if possible.
 * @param {string} dirPath - Absolute path.
 * @returns {Promise<boolean>} true if the folder could be opened.
 */
async function openPath(dirPath) {
  const ok = await grid.loadFolder(dirPath);
  if (ok) {
    await tree.selectPath(dirPath, { notify: false });
  }
  return ok;
}

currentDirEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const value = currentDirEl.value.trim();
    if (!value || value === grid.getPath()) {
      currentDirEl.value = grid.getPath();
      currentDirEl.blur();
      return;
    }
    navInFlight = true;
    const ok = await openPath(value);
    navInFlight = false;
    if (!ok) {
      currentDirEl.value = grid.getPath();
    }
    currentDirEl.blur();
  } else if (event.key === "Escape") {
    currentDirEl.value = grid.getPath();
    currentDirEl.blur();
  }
});

currentDirEl.addEventListener("blur", () => {
  if (!navInFlight && grid.getPath() && currentDirEl.value !== grid.getPath()) {
    currentDirEl.value = grid.getPath();
  }
});

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
  await settings.load();
  setTreeRoot(root);
  const [home, cwd] = await Promise.all([window.api.getHomeDir(), window.api.getCwd()]);
  currentDirEl.value = home;
  if (!(await tree.selectPath(cwd))) {
    await tree.selectPath(home);
  }
});
