import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, shell } from "electron";
import i18next from "i18next";

const PROJECT_ROOT = path.join(import.meta.dirname, "..");
const APP_INFO = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));

/** Shared base styles for the modal About and shortcuts windows. */
const DIALOG_BASE_CSS = `
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
           background: #1e1e1e; color: #e0e0e0; margin: 0; padding: 20px; overflow-y: auto; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    h3 { font-size: 13px; color: #9a9a9a; margin: 16px 0 6px; }
    h3:first-of-type { margin-top: 0; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    td { padding: 3px 0; vertical-align: top; }
    td:first-child { white-space: nowrap; padding-right: 16px; }
    td:last-child { color: #b5b5b5; }
    kbd { display: inline-block; padding: 1px 5px; font-size: 11px; background: #2b2b2b;
          border: 1px solid #3c3c3c; border-bottom-width: 2px; border-radius: 4px; }
    .note { margin: 12px 0 14px; font-size: 12px; color: #9a9a9a; }
    a { color: #4f9cf9; }
    button { display: block; margin: 14px 0 0 auto; padding: 6px 16px; font-size: 13px;
             color: #e0e0e0; background: #3c3c3c; border: 1px solid #4a4a4a;
             border-radius: 6px; cursor: pointer; }
    button:hover { background: #4a4a4a; }
`;

/**
 * Escapes HTML special characters in a string.
 * @param {string} value - Raw input.
 * @returns {string} HTML-safe string.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Reads the license text from the LICENSE file.
 * @returns {string} Content of the LICENSE file, or an empty string.
 */
function licenseText() {
  try {
    return fs.readFileSync(path.join(PROJECT_ROOT, "LICENSE"), "utf8");
  } catch {
    return "";
  }
}

/**
 * Opens a modal dialog window with the shared dialog styling and the close
 * preload (Close button + Esc via `dialog:close`).
 * @param {object} options - Dialog configuration.
 * @param {string} options.title - Window title.
 * @param {string} options.width - Window width.
 * @param {string} options.height - Window height.
 * @param {string} options.bodyHtml - HTML for the dialog body.
 * @param {string} [options.extraCss] - Additional <style> content.
 * @param {(url: string) => void} [options.onOpenUrl] - External-link handler. Defaults to shell.openExternal.
 * @returns {Promise<void>} Resolves when the dialog finished loading.
 */
function createDialog({ title, width, height, bodyHtml, extraCss = "", onOpenUrl }) {
  const windowHtml = `<!DOCTYPE html>
<html lang="${i18next.language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
  <style>
    ${DIALOG_BASE_CSS}
    ${extraCss}
  </style>
</head>
<body>
  ${bodyHtml}
  <button id="dialog-close">${escapeHtml(i18next.t("dialog.close"))}</button>
</body>
</html>`;

  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const win = new BrowserWindow({
    width,
    height,
    parent,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(import.meta.dirname, "dialogPreload.js"),
    },
  });
  win.removeMenu(); // dialogs are plain windows (like window.open()): no menu bar

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (onOpenUrl) {
      onOpenUrl(url);
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  return win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(windowHtml)}`);
}

/**
 * Opens the modal "About MeshViewer" window.
 * @returns {Promise<void>}
 */
function showAbout() {
  const year = new Date().getFullYear();
  return createDialog({
    title: i18next.t("about.title"),
    width: 480,
    height: 600,
    extraCss: `
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { font-size: 13px; color: #9a9a9a; margin: 2px 0; }
    .license { white-space: pre-wrap; font-size: 11px; background: #2b2b2b;
               border: 1px solid #3c3c3c; border-radius: 6px; padding: 10px;
               max-height: 220px; overflow: auto; margin-top: 14px; }
  `,
    bodyHtml: `
  <h1>MeshViewer</h1>
  <div class="meta">${escapeHtml(i18next.t("about.version"))} ${escapeHtml(APP_INFO.version)}</div>
  <div class="meta">${escapeHtml(i18next.t("about.copyright"))} &copy; ${year} ${escapeHtml(APP_INFO.author)}</div>
  <div class="meta">${escapeHtml(i18next.t("about.license"))}: ${escapeHtml(APP_INFO.license)}</div>
  <div class="license">${escapeHtml(licenseText())}</div>
  <p><a href="https://github.com/SpotlightOn/meshviewer" target="_blank">github.com/SpotlightOn/meshviewer</a></p>
`,
  });
}

/**
 * Renders a keyboard-shortcut table row.
 * @param {string} keys - HTML for the key combination.
 * @param {string} descriptionKey - i18n key for the description text.
 * @returns {string} Table row HTML.
 */
function shortcutRow(keys, descriptionKey) {
  return `<tr><td>${keys}</td><td>${escapeHtml(i18next.t(descriptionKey))}</td></tr>`;
}

/**
 * Opens the modal "Keyboard shortcuts" window.
 * @returns {Promise<void>}
 */
function showShortcuts() {
  const kbd = (label) => `<kbd>${label}</kbd>`;
  const rows = [
    [`${kbd("←")} / ${kbd("Backspace")}`, "shortcuts.previous"],
    [`${kbd("→")} / ${kbd("Space")}`, "shortcuts.next"],
    [kbd("F"), "shortcuts.toggleFit"],
    [`${kbd("Ctrl")} + ${kbd("+")} / ${kbd("=")}`, "shortcuts.zoomIn"],
    [`${kbd("Ctrl")} + ${kbd("-")}`, "shortcuts.zoomOut"],
    [`${kbd("Ctrl")} + ${kbd("0")} / ${kbd("1")}`, "shortcuts.zoomReset"],
    [kbd("F5"), "shortcuts.slideshow"],
    [kbd("Esc"), "shortcuts.closeLarge"],
    [kbd("F11"), "shortcuts.fullscreen"],
  ];
  const gridRows = [
    [`${kbd("Ctrl")} + ${kbd("+")} / ${kbd("=")}`, "shortcuts.largerTiles"],
    [`${kbd("Ctrl")} + ${kbd("-")}`, "shortcuts.smallerTiles"],
    [`${kbd("Ctrl")} + ${kbd("0")}`, "shortcuts.resetTiles"],
  ];
  const pathRows = [
    [kbd("Enter"), "shortcuts.openPath"],
    [kbd("Esc"), "shortcuts.revertPath"],
  ];
  const section = (titleKey, sectionRows) =>
    `<h3>${escapeHtml(i18next.t(titleKey))}</h3><table><tbody>${sectionRows
      .map(([keys, key]) => shortcutRow(keys, key))
      .join("")}</tbody></table>`;

  return createDialog({
    title: i18next.t("shortcuts.title"),
    width: 480,
    height: 600,
    bodyHtml: `
  <h2>${escapeHtml(i18next.t("shortcuts.title"))}</h2>
  ${section("shortcuts.largeView", rows)}
  ${section("shortcuts.grid", gridRows)}
  ${section("shortcuts.pathField", pathRows)}
  <p class="note">${escapeHtml(i18next.t("shortcuts.zoomFieldNote"))}</p>
`,
  });
}

/**
 * Registers the IPC handler that closes modal dialogs (`dialog:close`).
 * @param {{on: Function}} ipcMain - The Electron ipcMain module.
 */
function registerDialogIpc(ipcMain) {
  ipcMain.on("dialog:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

export { registerDialogIpc, showAbout, showShortcuts };
