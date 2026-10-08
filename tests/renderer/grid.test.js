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

import { createGrid } from "../../src/renderer/grid.js";

/**
 * Renders the grid DOM and creates the module against a stubbed API.
 * @param {() => Promise<Array>} listFiles - Stub for window.api.listMediaFiles.
 * @returns {Promise<{loadFolder: (path: string) => Promise<boolean>, emptyState: HTMLElement, emptyMessage: HTMLElement}>}
 */
async function makeGrid(listFiles) {
  document.body.innerHTML = `
    <div id="empty-state" class="empty-state">
      <img class="empty-logo" src="app://app/icons/meshviewer.svg" alt="MeshViewer" />
      <p id="empty-message" class="empty-message"></p>
    </div>
    <div id="grid" class="grid"></div>
    <div id="content" class="content"></div>`;
  window.api = { listMediaFiles: listFiles };
  const grid = createGrid({
    dom: {
      grid: document.getElementById("grid"),
      emptyState: document.getElementById("empty-state"),
      emptyMessage: document.getElementById("empty-message"),
      contentEl: document.getElementById("content"),
    },
    onOpenFile: () => {},
    onFolderChange: () => {},
  });
  return {
    loadFolder: grid.loadFolder,
    emptyState: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-message"),
  };
}

describe("grid empty state", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      resources: {
        en: {
          translation: {
            grid: {
              noMedia: "No media files in this folder",
              loadError: "Could not load the folder",
            },
          },
        },
      },
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
