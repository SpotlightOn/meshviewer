import { createInfoDialog } from "./exif-dialog.js";
import { createGrid } from "./grid.js";
import { initI18n } from "./i18n.js";
import { createKeyboard } from "./keyboard.js";
import { createLargeView } from "./large-view.js";
import { createPathBar } from "./pathbar.js";
import { createSettings } from "./settings.js";
import { createDirectoryTree } from "./tree.js";

const upBtn = document.getElementById("btn-up");
const homeBtn = document.getElementById("btn-home");

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
const infoDialog = createInfoDialog({
  dom: {
    overlay: document.getElementById("info-overlay"),
    content: document.getElementById("info-content"),
    closeBtn: document.getElementById("info-close"),
  },
});
const largeView = createLargeView({
  dom: {
    largeView: document.getElementById("large-view"),
    largeCanvas: document.getElementById("large-canvas"),
    largeTitle: document.getElementById("large-title"),
    largeInfo: document.getElementById("large-info"),
    largeZoom: document.getElementById("large-zoom"),
    largeZoomValue: document.getElementById("large-zoom-value"),
    largeBack: document.getElementById("large-back"),
    infoButton: document.getElementById("large-details"),
    largeSlideshow: document.getElementById("large-slideshow"),
    largeActual: document.getElementById("large-actual"),
    largeFit: document.getElementById("large-fit"),
    largeFullscreen: document.getElementById("large-fullscreen"),
    largeFullscreenExit: document.getElementById("large-fullscreen-exit"),
    slideshowProgress: document.getElementById("slideshow-progress"),
  },
  settings,
  getFiles: () => grid.getFiles(),
  infoDialog,
});
largeViewRef.current = largeView;

grid = createGrid({
  dom: {
    grid: document.getElementById("grid"),
    emptyState: document.getElementById("empty-state"),
    contentEl: document.querySelector(".content"),
  },
  onOpenFile: (file) => largeViewRef.current?.show(file),
  onFolderChange: (dirPath) => pathBar.setPath(dirPath),
});

createKeyboard({ settings, infoDialog, largeView, grid });

const pathBar = createPathBar({
  dom: {
    root: document.getElementById("pathbar-root"),
    segments: document.getElementById("path-segments"),
    input: document.getElementById("path-input"),
  },
  navigate: openPath,
});

/** @type {ReturnType<typeof createDirectoryTree> | null} */
let tree = null;

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
  pathBar.setRoot(root);
  const [home, cwd] = await Promise.all([window.api.getHomeDir(), window.api.getCwd()]);
  pathBar.setPath(home);
  if (!(await tree.selectPath(cwd))) {
    await tree.selectPath(home);
  }
});
