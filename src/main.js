const { app, BrowserWindow, ipcMain, protocol, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const i18next = require("i18next");
const i18nEn = require("./locales/en.json");
const i18nDe = require("./locales/de.json");
const { registerFsIpc } = require("./fsIpc");

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
  </style>
</head>
<body>
  <h1>MeshViewer</h1>
  <div class="meta">${escapeHtml(i18next.t("about.version"))} ${escapeHtml(APP_INFO.version)}</div>
  <div class="meta">${escapeHtml(i18next.t("about.copyright"))} &copy; ${year} ${escapeHtml(APP_INFO.author)}</div>
  <div class="meta">${escapeHtml(i18next.t("about.license"))}: ${escapeHtml(APP_INFO.license)}</div>
  <div class="license">${escapeHtml(licenseText())}</div>
  <p><a href="https://codeberg.org/notabug/meshviewer" target="_blank">codeberg.org/notabug/meshviewer</a></p>
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
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: i18next.t("menu.help"),
      submenu: [{ label: i18next.t("menu.about"), click: showAbout }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerProtocol();
  registerFsIpc(ipcMain, app, shell);
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
