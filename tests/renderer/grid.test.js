import i18next from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

// grid.js creates a WebGL renderer at module scope; jsdom has no WebGL, so
// stub the renderer while keeping the rest of three intact.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  class FakeRenderer {
    setSize() {}
    setClearColor() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

// jsdom does not implement IntersectionObserver, which grid.js uses to lazily
// load thumbnails and folder previews. The stub records its instances so tests
// can trigger intersections on demand.
const intersectionObservers = [];
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      intersectionObservers.push(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
    }
  };
}

// Force the setTimeout fallback of whenIdle so tests can flush the deferred
// preview pass deterministically.
window.requestIdleCallback = undefined;

/**
 * Reports the latest IntersectionObserver's targets as intersecting.
 * @param {Array<HTMLElement>} targets - Elements to report.
 */
function intersect(targets) {
  const observer = intersectionObservers.at(-1);
  observer.callback(targets.map((target) => ({ target, isIntersecting: true })));
}

/**
 * Waits for a macrotask so the deferred preview pass can run.
 * @returns {Promise<void>} Resolves after the next timer tick.
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

import { cardIndexesInRect, createGrid } from "../../src/renderer/grid.js";

/** Translation resources shared by the grid tests. */
const translations = {
  grid: {
    typeGlb: "3D model",
    typeImage: "Image",
    typeFolder: "Folder",
    noMedia: "No media files in this folder",
    loadError: "Could not load the folder",
    nSelected: "{{count}} selected",
    copyBuffer: "{{count}} copied to clipboard",
    cutBuffer: "{{count}} cut to clipboard",
    pasteDone: "{{count}} copied into this folder",
    trashed: "{{count}} moved to trash",
  },
  console: {
    pasteFailed: "Some files could not be copied:",
    trashFailed: "Some files could not be moved to trash:",
  },
};

/**
 * Builds a media file fixture.
 * @param {string} name - File name.
 * @param {number} [index] - Index used for size/mtime.
 * @returns {{path: string, name: string, size: number, mtimeMs: number, type: string}} File object.
 */
function media(name, index = 0) {
  return {
    path: `/tmp/folder/${name}`,
    name,
    size: 1024 + index,
    mtimeMs: index,
    type: name.endsWith(".glb") ? "glb" : "image",
  };
}

/**
 * Builds a child-directory fixture.
 * @param {string} name - Directory name.
 * @returns {{path: string, name: string}} Directory object.
 */
function dir(name) {
  return { path: `/tmp/folder/${name}`, name };
}

/**
 * Renders the grid DOM and creates the module against a stubbed API.
 * @param {() => Promise<Array>} listFiles - Stub for window.api.listMediaFiles.
 * @param {object} [options] - Optional spies/overrides.
 * @param {(file: object) => void} [options.onOpenFile] - Spy for media tile clicks.
 * @param {(dirPath: string) => void} [options.onOpenFolder] - Spy for folder tile clicks.
 * @param {() => Promise<Array>} [options.listDirectories] - Stub for window.api.listDirectories.
 * @param {(dirPath: string, limit: number) => Promise<Array>} [options.listImageFiles] - Stub for window.api.listImageFiles.
 * @param {Function} [options.getThumbnail] - Stub for window.api.getThumbnail.
 * @param {Function} [options.copyFiles] - Stub for window.api.copyFiles.
 * @param {Function} [options.moveFiles] - Stub for window.api.moveFiles.
 * @param {Function} [options.trashFiles] - Stub for window.api.trashFiles.
 * @param {() => object} [options.getSettings] - Stub for the settings accessor.
 * @returns {Promise<object>} Grid module API with DOM references and spies.
 */
async function makeGrid(listFiles, options = {}) {
  document.body.innerHTML = `
    <div id="empty-state" class="empty-state">
      <img class="empty-logo" src="app://app/icons/meshviewer.svg" alt="MeshViewer" />
      <p id="empty-message" class="empty-message"></p>
    </div>
    <div id="grid" class="grid"></div>
    <div id="selection-info" class="selection-info" hidden></div>
    <div id="content" class="content"></div>`;
  const onOpenFile = options.onOpenFile ?? (() => {});
  const onOpenFolder = options.onOpenFolder ?? (() => {});
  const onDirectoriesChanged = options.onDirectoriesChanged ?? (() => {});
  window.api = {
    listMediaFiles: listFiles,
    listImageFiles:
      options.listImageFiles ??
      (async (dirPath, limit) =>
        (await listFiles(dirPath)).filter((file) => file.type === "image").slice(0, limit)),
    listDirectories: options.listDirectories ?? vi.fn(async () => []),
    getThumbnail: options.getThumbnail ?? vi.fn(async () => "data:image/png;base64,AAAA"),
    copyFiles: options.copyFiles ?? vi.fn(async () => []),
    moveFiles: options.moveFiles ?? vi.fn(async () => []),
    trashFiles: options.trashFiles ?? vi.fn(async () => ({ trashed: [], failed: [] })),
  };
  const grid = createGrid({
    dom: {
      grid: document.getElementById("grid"),
      emptyState: document.getElementById("empty-state"),
      emptyMessage: document.getElementById("empty-message"),
      contentEl: document.getElementById("content"),
      selectionInfo: document.getElementById("selection-info"),
    },
    onOpenFile,
    onOpenFolder,
    onFolderChange: () => {},
    onDirectoriesChanged,
    getSettings: options.getSettings,
  });
  return {
    grid,
    onOpenFile,
    onOpenFolder,
    onDirectoriesChanged,
    loadFolder: grid.loadFolder,
    emptyState: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
    selectionInfo: document.getElementById("selection-info"),
  };
}

/**
 * Dispatches a mouse click on a card with optional modifiers.
 * @param {HTMLElement} card - Target card.
 * @param {object} [modifiers] - ctrlKey/shiftKey/metaKey flags.
 */
function clickCard(card, modifiers = {}) {
  card.dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers }));
}

describe("grid empty state", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      resources: { en: { translation: translations } },
    });
  });

  it("keeps the logo and shows the no-media message for an empty folder", async () => {
    const { loadFolder, emptyState, emptyMessage } = await makeGrid(async () => []);
    expect(await loadFolder("/tmp/empty")).toBe(true);
    expect(emptyState.style.display).toBe("flex");
    expect(emptyMessage.textContent).toBe("No media files in this folder");
    expect(emptyState.querySelector(".empty-logo")).not.toBeNull();
  });

  it("shows the load-error message when listing fails", async () => {
    const { loadFolder, emptyState, emptyMessage } = await makeGrid(async () => {
      throw new Error("boom");
    });
    expect(await loadFolder("/missing")).toBe(false);
    expect(emptyState.style.display).toBe("flex");
    expect(emptyMessage.textContent).toBe("Could not load the folder");
  });
});

describe("grid selection", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      resources: { en: { translation: translations } },
    });
  });

  it("selects a single file and opens it on a plain click", async () => {
    const onOpenFile = vi.fn();
    const { loadFolder, grid, selectionInfo } = await makeGrid(
      async () => [media("a.png", 0), media("b.png", 1)],
      { onOpenFile },
    );
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[1]);

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile.mock.calls[0][0].name).toBe("b.png");
    expect(grid.getSelectionFiles().map((file) => file.name)).toEqual(["b.png"]);
    expect(selectionInfo.hidden).toBe(false);
    expect(selectionInfo.textContent).toBe("1 selected");
  });

  it("toggles the selection with Ctrl-click without opening the file", async () => {
    const onOpenFile = vi.fn();
    const { loadFolder, grid, selectionInfo } = await makeGrid(
      async () => [media("a.png", 0), media("b.png", 1)],
      { onOpenFile },
    );
    await loadFolder("/tmp/folder");
    const cards = document.querySelectorAll(".card");

    clickCard(cards[0], { ctrlKey: true });
    clickCard(cards[1], { ctrlKey: true });

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(grid.getSelectionFiles().map((file) => file.name)).toEqual(["a.png", "b.png"]);
    expect(selectionInfo.textContent).toBe("2 selected");

    clickCard(cards[1], { ctrlKey: true });
    expect(grid.getSelectionFiles().map((file) => file.name)).toEqual(["a.png"]);
    expect(selectionInfo.textContent).toBe("1 selected");

    clickCard(cards[0], { ctrlKey: true });
    expect(grid.hasSelection()).toBe(false);
    expect(selectionInfo.hidden).toBe(true);
  });

  it("selects a range with Shift-click", async () => {
    const { loadFolder, grid } = await makeGrid(async () => [
      media("a.png", 0),
      media("b.png", 1),
      media("c.png", 2),
      media("d.png", 3),
    ]);
    await loadFolder("/tmp/folder");
    const cards = document.querySelectorAll(".card");

    clickCard(cards[0], { ctrlKey: true });
    clickCard(cards[2], { shiftKey: true });

    expect(grid.getSelectionFiles().map((file) => file.name)).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("keeps a multi-selection when an already selected card is included", async () => {
    const { loadFolder, grid } = await makeGrid(async () => [
      media("a.png", 0),
      media("b.png", 1),
      media("c.png", 2),
    ]);
    await loadFolder("/tmp/folder");
    const cards = document.querySelectorAll(".card");

    clickCard(cards[0], { ctrlKey: true });
    clickCard(cards[1], { ctrlKey: true });
    grid.ensureInSelection(1);
    expect(grid.getSelectionFiles().map((file) => file.name)).toEqual(["a.png", "b.png"]);

    grid.ensureInSelection(2);
    expect(grid.getSelectionFiles().map((file) => file.name)).toEqual(["c.png"]);
  });

  it("selects all files and clears the selection", async () => {
    const { loadFolder, grid, selectionInfo } = await makeGrid(async () => [
      media("a.png", 0),
      media("b.png", 1),
      media("c.png", 2),
    ]);
    await loadFolder("/tmp/folder");

    grid.selectAll();
    expect(grid.getSelectionFiles()).toHaveLength(3);
    expect(selectionInfo.textContent).toBe("3 selected");

    grid.clearSelection();
    expect(grid.hasSelection()).toBe(false);
    expect(selectionInfo.hidden).toBe(true);
  });

  it("buffers the selected files and shows the copy message", async () => {
    const { loadFolder, grid, selectionInfo } = await makeGrid(async () => [
      media("a.png", 0),
      media("b.png", 1),
    ]);
    await loadFolder("/tmp/folder");
    const cards = document.querySelectorAll(".card");

    clickCard(cards[0], { ctrlKey: true });
    clickCard(cards[1], { ctrlKey: true });
    grid.copySelection();

    expect(grid.hasCopyBuffer()).toBe(true);
    expect(selectionInfo.textContent).toBe("2 copied to clipboard");
  });

  it("pastes the clipboard into the current folder and reloads", async () => {
    const copyFiles = vi.fn(async () => [
      { source: "/tmp/folder/a.png", target: "/tmp/folder/a (1).png", ok: true },
    ]);
    const { loadFolder, grid, selectionInfo } = await makeGrid(
      async () => [media("a.png", 0), media("b.png", 1)],
      { copyFiles },
    );
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.copySelection();
    const copied = await grid.paste();

    expect(copied).toBe(true);
    expect(copyFiles).toHaveBeenCalledWith(["/tmp/folder/a.png"], "/tmp/folder");
    expect(selectionInfo.textContent).toBe("1 copied into this folder");
  });

  it("pastes the clipboard into a given folder without reloading another", async () => {
    const listFiles = vi.fn(async () => [media("a.png", 0), media("b.png", 1)]);
    const copyFiles = vi.fn(async () => [
      { source: "/tmp/folder/a.png", target: "/tmp/other/a.png", ok: true },
    ]);
    const { loadFolder, grid, selectionInfo } = await makeGrid(listFiles, { copyFiles });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.copySelection();
    const copied = await grid.paste("/tmp/other");

    expect(copied).toBe(true);
    expect(copyFiles).toHaveBeenCalledWith(["/tmp/folder/a.png"], "/tmp/other");
    // The grid still shows /tmp/folder and was not reloaded.
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(grid.getPath()).toBe("/tmp/folder");
    expect(selectionInfo.textContent).toBe("1 copied into this folder");
  });

  it("cuts the selected files into the clipboard and shows the cut message", async () => {
    const { loadFolder, grid, selectionInfo } = await makeGrid(async () => [
      media("a.png", 0),
      media("b.png", 1),
    ]);
    await loadFolder("/tmp/folder");
    const cards = document.querySelectorAll(".card");

    clickCard(cards[0], { ctrlKey: true });
    clickCard(cards[1], { ctrlKey: true });
    grid.cutSelection();

    expect(grid.hasCopyBuffer()).toBe(true);
    expect(selectionInfo.textContent).toBe("2 cut to clipboard");
  });

  it("moves cut files on paste, reloads the folder and consumes the clipboard", async () => {
    const listFiles = vi.fn(async () => [media("a.png", 0), media("b.png", 1)]);
    const moveFiles = vi.fn(async () => [
      { source: "/tmp/folder/a.png", target: "/tmp/other/a.png", ok: true },
    ]);
    const { loadFolder, grid, selectionInfo } = await makeGrid(listFiles, { moveFiles });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.cutSelection();
    const moved = await grid.paste("/tmp/other");

    expect(moved).toBe(true);
    expect(moveFiles).toHaveBeenCalledWith(["/tmp/folder/a.png"], "/tmp/other", {
      checksum: false,
    });
    // The current folder may have lost files, so it is reloaded too.
    expect(listFiles).toHaveBeenCalledTimes(2);
    // A cut clipboard is consumed by the first paste.
    expect(grid.hasCopyBuffer()).toBe(false);
    expect(selectionInfo.textContent).toBe("1 copied into this folder");
  });

  it("moves cut files when pasting into the current folder", async () => {
    const listFiles = vi.fn(async () => [media("a.png", 0), media("b.png", 1)]);
    const moveFiles = vi.fn(async () => [
      { source: "/tmp/folder/a.png", target: "/tmp/folder/a.png", ok: true, unchanged: true },
    ]);
    const { loadFolder, grid } = await makeGrid(listFiles, { moveFiles });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.cutSelection();
    const moved = await grid.paste();

    expect(moved).toBe(true);
    expect(moveFiles).toHaveBeenCalledWith(["/tmp/folder/a.png"], "/tmp/folder", {
      checksum: false,
    });
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(grid.hasCopyBuffer()).toBe(false);
  });

  it("passes the checksum setting to moveFiles when enabled", async () => {
    const moveFiles = vi.fn(async () => [
      { source: "/tmp/folder/a.png", target: "/tmp/other/a.png", ok: true },
    ]);
    const { loadFolder, grid } = await makeGrid(async () => [media("a.png", 0)], {
      moveFiles,
      getSettings: () => ({ verifyMoveChecksum: true }),
    });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.cutSelection();
    await grid.paste("/tmp/other");

    expect(moveFiles).toHaveBeenCalledWith(["/tmp/folder/a.png"], "/tmp/other", {
      checksum: true,
    });
  });

  it("moves the selected files to the trash and reloads", async () => {
    const trashFiles = vi.fn(async () => ({
      trashed: ["/tmp/folder/a.png"],
      failed: [],
    }));
    const { loadFolder, grid, selectionInfo } = await makeGrid(
      async () => [media("a.png", 0), media("b.png", 1)],
      { trashFiles },
    );
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    const trashed = await grid.trashSelection();

    expect(trashed).toBe(true);
    expect(trashFiles).toHaveBeenCalledWith(["/tmp/folder/a.png"]);
    expect(selectionInfo.textContent).toBe("1 moved to trash");
  });

  it("clears the selection when a folder is loaded", async () => {
    const { loadFolder, grid, selectionInfo } = await makeGrid(async () => [
      media("a.png", 0),
      media("b.png", 1),
    ]);
    await loadFolder("/tmp/folder");
    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    expect(grid.hasSelection()).toBe(true);

    await loadFolder("/tmp/folder");

    expect(grid.hasSelection()).toBe(false);
    expect(selectionInfo.hidden).toBe(true);
  });
});

describe("grid folder tiles", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      resources: { en: { translation: translations } },
    });
  });

  it("lists folders before media files", async () => {
    const { loadFolder, grid } = await makeGrid(async () => [media("a.png", 0)], {
      listDirectories: async () => [dir("sub"), dir("zeta")],
    });
    await loadFolder("/tmp/folder");

    const cards = document.querySelectorAll(".card");
    expect([...cards].map((card) => card.dataset.kind)).toEqual(["folder", "folder", "image"]);
    expect(grid.getFiles().map((file) => file.name)).toEqual(["a.png"]);
    expect(grid.getEntry(0)).toMatchObject({ kind: "folder", name: "sub" });
  });

  it("opens a folder on a plain click without opening the large view", async () => {
    const onOpenFile = vi.fn();
    const onOpenFolder = vi.fn();
    const { loadFolder } = await makeGrid(async () => [], {
      listDirectories: async () => [dir("sub")],
      onOpenFile,
      onOpenFolder,
    });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0]);

    expect(onOpenFolder).toHaveBeenCalledWith("/tmp/folder/sub");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("selects folders together with files", async () => {
    const { loadFolder, grid, selectionInfo } = await makeGrid(async () => [media("a.png", 0)], {
      listDirectories: async () => [dir("sub")],
    });
    await loadFolder("/tmp/folder");

    grid.selectAll();

    expect(grid.getSelectionFiles().map((entry) => entry.name)).toEqual(["sub", "a.png"]);
    expect(selectionInfo.textContent).toBe("2 selected");
  });

  it("copies a selected folder path into the clipboard", async () => {
    const copyFiles = vi.fn(async () => [
      { source: "/tmp/folder/sub", target: "/tmp/other/sub", ok: true },
    ]);
    const { loadFolder, grid } = await makeGrid(async () => [], {
      listDirectories: async () => [dir("sub")],
      copyFiles,
    });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.copySelection();
    const copied = await grid.paste("/tmp/other");

    expect(copied).toBe(true);
    expect(copyFiles).toHaveBeenCalledWith(["/tmp/folder/sub"], "/tmp/other");
  });

  it("trashes the selected folder", async () => {
    const trashFiles = vi.fn(async () => ({ trashed: ["/tmp/folder/sub"], failed: [] }));
    const { loadFolder, grid } = await makeGrid(async () => [], {
      listDirectories: async () => [dir("sub")],
      trashFiles,
    });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    await grid.trashSelection();

    expect(trashFiles).toHaveBeenCalledWith(["/tmp/folder/sub"]);
  });

  it("shows the empty state only when there are neither folders nor media", async () => {
    const { loadFolder, emptyState } = await makeGrid(async () => [], {
      listDirectories: async () => [dir("empty-sub")],
    });
    expect(await loadFolder("/tmp/folder")).toBe(true);
    expect(emptyState.style.display).toBe("none");
    expect(document.querySelectorAll(".card")).toHaveLength(1);
  });

  it("signals a directory change after trashing a folder", async () => {
    const onDirectoriesChanged = vi.fn();
    const trashFiles = vi.fn(async () => ({ trashed: ["/tmp/folder/sub"], failed: [] }));
    const { loadFolder, grid } = await makeGrid(async () => [], {
      listDirectories: async () => [dir("sub")],
      trashFiles,
      onDirectoriesChanged,
    });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    await grid.trashSelection();

    expect(onDirectoriesChanged).toHaveBeenCalledWith("/tmp/folder");
  });

  it("signals a directory change in the target after pasting a folder", async () => {
    const onDirectoriesChanged = vi.fn();
    const copyFiles = vi.fn(async () => [
      { source: "/tmp/folder/sub", target: "/tmp/other/sub", ok: true },
    ]);
    const { loadFolder, grid } = await makeGrid(async () => [], {
      listDirectories: async () => [dir("sub")],
      copyFiles,
      onDirectoriesChanged,
    });
    await loadFolder("/tmp/folder");

    clickCard(document.querySelectorAll(".card")[0], { ctrlKey: true });
    grid.copySelection();
    await grid.paste("/tmp/other");

    expect(onDirectoriesChanged).toHaveBeenCalledWith("/tmp/other");
  });
});

describe("grid folder previews", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      resources: { en: { translation: translations } },
    });
  });

  /**
   * Returns the folder tile's thumb wrapper after loading the grid.
   * @returns {HTMLElement} Folder thumb wrapper.
   */
  function folderWrap() {
    return document.querySelector('.card[data-kind="folder"] .thumb-wrap');
  }

  it("shows the folder's first image inside a folder-shaped frame", async () => {
    const listFiles = vi.fn(async (dirPath) =>
      dirPath === "/tmp/folder/sub" ? [media("a.png", 0), media("b.png", 1)] : [],
    );
    const getThumbnail = vi.fn(async (file) => `data:image/png;base64,${file.name}`);
    const { loadFolder } = await makeGrid(listFiles, {
      listDirectories: async () => [dir("sub")],
      getThumbnail,
    });
    await loadFolder("/tmp/folder");

    const wrap = folderWrap();
    intersect([wrap]);
    await settle();

    // The frame keeps the folder shape, so the tile still reads as a directory.
    expect(wrap.querySelector(".folder-frame")).not.toBeNull();
    const img = wrap.querySelector(".folder-frame .folder-preview-img");
    expect(img?.src).toBe("data:image/png;base64,a.png");
    // Only the first image is used, so only its thumbnail is generated.
    expect(getThumbnail).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty folder frame when the folder holds no images", async () => {
    const getThumbnail = vi.fn(async () => "data:image/png;base64,AAAA");
    const { loadFolder } = await makeGrid(async () => [media("model.glb", 0)], {
      listDirectories: async () => [dir("sub")],
      getThumbnail,
    });
    await loadFolder("/tmp/folder");

    const wrap = folderWrap();
    intersect([wrap]);
    await settle();

    expect(wrap.querySelector(".folder-frame")).not.toBeNull();
    expect(wrap.querySelector(".folder-preview-img")).toBeNull();
    // GLB previews need an offscreen 3D render and are skipped.
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  it("reuses the cached preview when the folder is reloaded", async () => {
    const listFiles = vi.fn(async (dirPath) =>
      dirPath === "/tmp/folder/sub" ? [media("a.png", 0)] : [],
    );
    const getThumbnail = vi.fn(async () => "data:image/png;base64,AAAA");
    const { loadFolder } = await makeGrid(listFiles, {
      listDirectories: async () => [dir("sub")],
      getThumbnail,
    });
    await loadFolder("/tmp/folder");
    intersect([folderWrap()]);
    await settle();

    await loadFolder("/tmp/folder");
    intersect([folderWrap()]);
    await settle();

    const subfolderScans = listFiles.mock.calls.filter(
      ([dirPath]) => dirPath === "/tmp/folder/sub",
    );
    expect(subfolderScans).toHaveLength(1);
    expect(getThumbnail).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".card .folder-preview-img")).not.toBeNull();
  });
});

describe("cardIndexesInRect", () => {
  it("returns the indices of cards intersecting the rectangle", () => {
    const card = (index, rect) => ({
      dataset: { index: String(index) },
      getBoundingClientRect: () => rect,
    });
    const cards = [
      card(0, { left: 0, top: 0, right: 100, bottom: 100 }),
      card(1, { left: 200, top: 0, right: 300, bottom: 100 }),
    ];

    expect(cardIndexesInRect(cards, new DOMRect(50, 50, 100, 100))).toEqual([0]);
    expect(cardIndexesInRect(cards, new DOMRect(0, 0, 400, 200))).toEqual([0, 1]);
    expect(cardIndexesInRect(cards, new DOMRect(120, 0, 40, 40))).toEqual([]);
  });
});
