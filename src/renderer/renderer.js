import { createConfirmDialog } from "./confirm-dialog.js";
import { createContextMenu } from "./context-menu.js";
import { createInfoDialog } from "./exif-dialog.js";
import { createGrid } from "./grid.js";
import { initI18n, t } from "./i18n.js";
import { createKeyboard } from "./keyboard.js";
import { createLargeView } from "./large-view.js";
import { createNewFolderDialog } from "./new-folder-dialog.js";
import { createPathBar } from "./pathbar.js";
import { createSettings } from "./settings.js";
import { createSidebarResizer } from "./sidebar-resizer.js";
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
    editor: document.getElementById("settings-editor"),
    editorBrowse: document.getElementById("settings-editor-browse"),
    verify: document.getElementById("settings-verify-checksum"),
    thumbnailFit: document.getElementById("settings-thumbnail-fit"),
    transparency: document.getElementById("settings-transparency"),
    transparencyColor: document.getElementById("settings-transparency-color"),
    save: document.getElementById("settings-save"),
    cancel: document.getElementById("settings-cancel"),
  },
  onSaved: () => largeViewRef.current?.restartSlideshow(),
});

createSidebarResizer({
  handle: document.getElementById("sidebar-resizer"),
  getWidth: () => settings.get().sidebarWidth,
  onResize: (width) => settings.applySidebarWidth(width),
  onCommit: (width) => {
    settings.saveSidebarWidth(width);
  },
});

let grid;
const infoDialog = createInfoDialog({
  dom: {
    overlay: document.getElementById("info-overlay"),
    content: document.getElementById("info-content"),
    closeBtn: document.getElementById("info-close"),
  },
});
const newFolderDialog = createNewFolderDialog({
  dom: {
    overlay: document.getElementById("new-folder-overlay"),
    input: document.getElementById("new-folder-input"),
    error: document.getElementById("new-folder-error"),
    create: document.getElementById("new-folder-create"),
    cancel: document.getElementById("new-folder-cancel"),
  },
  onCreated: (parentPath) => void tree?.refresh(parentPath),
});
const confirmDialog = createConfirmDialog({
  dom: {
    overlay: document.getElementById("confirm-overlay"),
    title: document.getElementById("confirm-title"),
    message: document.getElementById("confirm-message"),
    accept: document.getElementById("confirm-accept"),
    cancel: document.getElementById("confirm-cancel"),
  },
});
const largeView = createLargeView({
  dom: {
    largeView: document.getElementById("large-view"),
    largeCanvas: document.getElementById("large-canvas"),
    largeTitle: document.getElementById("large-title"),
    largeInfo: document.getElementById("large-file-info"),
    largeZoom: document.getElementById("large-zoom"),
    largeZoomValue: document.getElementById("large-zoom-value"),
    largeBack: document.getElementById("large-back"),
    infoButton: document.getElementById("large-details"),
    largeSlideshow: document.getElementById("large-slideshow"),
    largeActual: document.getElementById("large-actual"),
    largeFit: document.getElementById("large-fit"),
    largePrev: document.getElementById("large-prev"),
    largeNext: document.getElementById("large-next"),
    largeFullscreen: document.getElementById("large-fullscreen"),
    largeFullscreenExit: document.getElementById("large-fullscreen-exit"),
    slideshowProgress: document.getElementById("slideshow-progress"),
  },
  settings,
  getFiles: () => grid.getFiles(),
  infoDialog,
});
largeViewRef.current = largeView;

const contextMenu = createContextMenu({
  host: document.body,
  menuEl: document.getElementById("context-menu"),
  resolveTarget: (target) => {
    const card = target.closest?.(".card");
    if (card?.dataset.index !== undefined) {
      const file = grid?.getFiles()[Number(card.dataset.index)];
      if (file) return { kind: "file", file };
    }
    const row = target.closest?.(".tree-row");
    if (row) {
      const dirPath = row.closest("li")?.dataset.path;
      if (dirPath) return { kind: "folder", path: dirPath, origin: "tree" };
    }
    if (target.closest?.(".content")) {
      const dirPath = grid?.getPath();
      if (dirPath) return { kind: "folder", path: dirPath, origin: "content" };
    }
    return null;
  },
});

contextMenu.register({
  id: "new-folder",
  order: 0,
  label: () => t("contextMenu.newFolder"),
  icon: "newFolder",
  enabled: (context) => context.kind === "folder",
  action: (context) => newFolderDialog.open(context.path),
});
contextMenu.register({
  id: "file-info",
  order: 0,
  label: () => t("contextMenu.fileInfo"),
  icon: "info",
  enabled: (context) => context.kind === "file",
  action: (context) => infoDialog.open(context.file),
});
contextMenu.register({
  id: "open-with",
  order: 1,
  label: () => t("contextMenu.openWith"),
  icon: "openInNew",
  enabled: (context) => context.kind === "file",
  action: (context) => void window.api.openPath(context.file.path),
});
contextMenu.register({
  id: "edit-with",
  order: 2,
  label: () => {
    const command = settings.get().editorCommand;
    const app = command ? command.split(/[\\/]/).pop() : "";
    return t("contextMenu.editWith", { app });
  },
  icon: "edit",
  enabled: (context) => context.kind === "file" && settings.get().editorCommand !== "",
  action: (context) => {
    const command = settings.get().editorCommand;
    if (!command) return;
    void window.api.runEditor(command, context.file.path).then((result) => {
      if (!result.ok) console.error(t("console.editorLaunchError"), result.error);
    });
  },
});
contextMenu.register({
  id: "separator-open",
  order: 3,
  separator: true,
  enabled: (context) => context.kind === "file",
});
contextMenu.register({
  id: "cut",
  order: 9,
  label: () => t("contextMenu.cut"),
  icon: "cut",
  enabled: (context) => context.kind === "file",
  action: () => grid.cutSelection(),
});
contextMenu.register({
  id: "copy",
  order: 10,
  label: () => t("contextMenu.copy"),
  icon: "copy",
  enabled: (context) => context.kind === "file",
  action: () => grid.copySelection(),
});
contextMenu.register({
  id: "paste",
  order: 11,
  label: () => t("contextMenu.paste"),
  icon: "paste",
  enabled: (context) =>
    (context.kind === "file" || context.kind === "folder") && grid.hasCopyBuffer(),
  action: (context) => void grid.paste(context.kind === "folder" ? context.path : undefined),
});
contextMenu.register({
  id: "trash",
  order: 12,
  label: () => t("contextMenu.moveToTrash"),
  icon: "delete",
  enabled: (context) =>
    context.kind === "file" || (context.kind === "folder" && context.origin === "tree"),
  action: (context) => {
    if (context.kind === "folder") void deleteFolder(context.path);
    else void grid.trashSelection();
  },
});

grid = createGrid({
  dom: {
    grid: document.getElementById("grid"),
    emptyState: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
    contentEl: document.querySelector(".content"),
    selectionInfo: document.getElementById("selection-info"),
  },
  onOpenFile: (file) => largeViewRef.current?.show(file),
  onFolderChange: (dirPath) => {
    pathBar.setPath(dirPath);
    contextMenu.close();
  },
  getSettings: () => settings.get(),
});

createKeyboard({
  settings,
  infoDialog,
  folderDialog: newFolderDialog,
  confirmDialog,
  largeView,
  grid,
});

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

/**
 * Returns whether a path is the given directory or lives inside it.
 * @param {string|null} candidate - Path to test.
 * @param {string} dir - Directory path.
 * @returns {boolean} true when candidate is dir or below it.
 */
function isPathInside(candidate, dir) {
  if (!candidate || !dir) return false;
  if (candidate === dir) return true;
  const separator = dir.includes("\\") ? "\\" : "/";
  const prefix = dir.endsWith(separator) ? dir : `${dir}${separator}`;
  return candidate.startsWith(prefix);
}

/**
 * Asks for confirmation, then moves a folder and all of its contents to the
 * OS trash. The tree is refreshed and the grid navigates to the parent folder
 * when the removed folder (or one of its descendants) was being displayed.
 * @param {string} folderPath - Absolute path of the folder to remove.
 * @returns {Promise<void>}
 */
async function deleteFolder(folderPath) {
  const name = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;
  const accepted = await confirmDialog.open({
    title: t("confirm.deleteFolder.title"),
    message: t("confirm.deleteFolder.message", { name }),
    acceptLabel: t("contextMenu.moveToTrash"),
  });
  if (!accepted) return;
  const result = await window.api.trashFiles([folderPath]);
  if (result.failed.length > 0) {
    console.error(t("console.trashFailed"), result.failed);
    return;
  }
  grid.flash(t("grid.trashed", { count: result.trashed.length }));
  const parent = await window.api.getParentDir(folderPath);
  await tree?.refresh(parent);
  if (isPathInside(grid.getPath(), folderPath)) {
    await openPath(parent === folderPath ? await window.api.getHomeDir() : parent);
  }
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
