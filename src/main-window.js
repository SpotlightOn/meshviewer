import path from "node:path";
import { BrowserWindow } from "electron";
import { PROTOCOL } from "./protocol.js";

/**
 * Creates the main application window.
 * @returns {BrowserWindow} The created window.
 */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MeshViewer",
    icon: path.join(import.meta.dirname, "..", "icons", "meshviewer.png"),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`${PROTOCOL}://app/index.html`);
  return win;
}

export { createMainWindow };
