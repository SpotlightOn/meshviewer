const { app, BrowserWindow, ipcMain, protocol, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const i18next = require("i18next");
const i18nEn = require("./locales/en.json");
const i18nDe = require("./locales/de.json");
const { registerFsIpc } = require("./fsIpc");
const { registerSettingsIpc } = require("./settingsStore");

const PROTOCOL = "app";

protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const PROJECT_ROOT = path.join(__dirname, "..");
const RENDERER_ROOT = path.join(__dirname, "renderer");

const APP_INFO = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));

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
 * Initializes i18next based on the system locale.
 */
function initI18n() {
  const locale = app.getLocale();
  const lng = locale.toLowerCase().startsWith("de") ? "de" : "en";
  i18next.init({
    lng,
    fallbackLng: "en",
    resources: {
      en: { translation: i18nEn },
      de: { translation: i18nDe },
    },
  });
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/**
 * Registers the app:// protocol with MIME types and a CSP header.
 */
function registerProtocol() {
  protocol.handle(PROTOCOL, (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");

    if (rel === "") {
      rel = "index.html";
    }

    let root = RENDERER_ROOT;
    if (rel.startsWith("node_modules/")) {
      root = PROJECT_ROOT;
    } else if (rel.startsWith("locales/")) {
      root = __dirname;
    }

    const filePath = path.join(root, rel);
    const relative = path.relative(root, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return new Response("Not found", { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = fs.readFileSync(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": contentType,
        "content-security-policy":
          "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:",
      },
    });
  });
}

/**
 * Creates the main window.
 * @returns {BrowserWindow} The created window.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MeshViewer",
    icon: path.join(PROJECT_ROOT, "icons", "meshviewer.png"),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`${PROTOCOL}://app/index.html`);
  return win;
}

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
 * Opens the modal "About MeshViewer" window.
 */
function showAbout() {
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const year = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="${i18next.language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
           background: #1e1e1e; color: #e0e0e0; margin: 0; padding: 20px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { font-size: 13px; color: #9a9a9a; margin: 2px 0; }
    .license { white-space: pre-wrap; font-size: 11px; background: #2b2b2b;
               border: 1px solid #3c3c3c; border-radius: 6px; padding: 10px;
               max-height: 220px; overflow: auto; margin-top: 14px; }
    a { color: #4f9cf9; }
    button { display: block; margin: 14px 0 0 auto; padding: 6px 16px; font-size: 13px;
             color: #e0e0e0; background: #3c3c3c; border: 1px solid #4a4a4a;
             border-radius: 6px; cursor: pointer; }
    button:hover { background: #4a4a4a; }
  </style>
</head>
<body>
  <h1>MeshViewer</h1>
  <div class="meta">${escapeHtml(i18next.t("about.version"))} ${escapeHtml(APP_INFO.version)}</div>
  <div class="meta">${escapeHtml(i18next.t("about.copyright"))} &copy; ${year} ${escapeHtml(APP_INFO.author)}</div>
  <div class="meta">${escapeHtml(i18next.t("about.license"))}: ${escapeHtml(APP_INFO.license)}</div>
  <div class="license">${escapeHtml(licenseText())}</div>
  <p><a href="https://github.com/SpotlightOn/meshviewer" target="_blank">github.com/SpotlightOn/meshviewer</a></p>
  <button id="dialog-close">${escapeHtml(i18next.t("about.close"))}</button>
</body>
</html>`;

  const win = new BrowserWindow({
    width: 480,
    height: 600,
    parent,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: i18next.t("about.title"),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "dialogPreload.js"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/**
 * Asks the main window to open the settings dialog.
 */
function openSettings() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send("menu:open-settings");
  }
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
 */
function showShortcuts() {
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
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

  const html = `<!DOCTYPE html>
<html lang="${i18next.language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
  <style>
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
    button { display: block; margin: 14px 0 0 auto; padding: 6px 16px; font-size: 13px;
             color: #e0e0e0; background: #3c3c3c; border: 1px solid #4a4a4a;
             border-radius: 6px; cursor: pointer; }
    button:hover { background: #4a4a4a; }
  </style>
</head>
<body>
  <h2>${escapeHtml(i18next.t("shortcuts.title"))}</h2>
  ${section("shortcuts.largeView", rows)}
  ${section("shortcuts.grid", gridRows)}
  ${section("shortcuts.pathField", pathRows)}
  <p class="note">${escapeHtml(i18next.t("shortcuts.zoomFieldNote"))}</p>
  <button id="dialog-close">${escapeHtml(i18next.t("shortcuts.close"))}</button>
</body>
</html>`;

  const win = new BrowserWindow({
    width: 480,
    height: 600,
    parent,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: i18next.t("shortcuts.title"),
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "dialogPreload.js"),
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/**
 * Creates the application menu.
 */
function createMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    {
      label: i18next.t("menu.edit"),
      submenu: [
        // { role: "undo" },
        // { role: "redo" },
        // { role: "cut" },
        // { role: "copy" },
        // { role: "paste" },
        // { role: "selectAll" },
        { type: "separator" },
        { label: i18next.t("menu.settings"), click: openSettings },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: i18next.t("menu.help"),
      submenu: [
        { label: i18next.t("menu.shortcuts"), click: showShortcuts },
        { type: "separator" },
        { label: i18next.t("menu.about"), click: showAbout },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerProtocol();
  registerFsIpc(ipcMain, app, shell);
  registerSettingsIpc(ipcMain, (fileName) => path.join(app.getPath("userData"), fileName));
  ipcMain.on("dialog:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  initI18n();
  createMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
