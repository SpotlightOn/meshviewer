import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import i18next from "i18next";
import { registerDialogIpc, showAbout, showUsage } from "./dialogs.js";
import { registerEditorIpc } from "./editorIpc.js";
import { registerFsIpc } from "./fsIpc.js";
import i18nDe from "./locales/de.json" with { type: "json" };
import i18nEn from "./locales/en.json" with { type: "json" };
import { createMainWindow } from "./main-window.js";
import { createAppMenu } from "./menu.js";
import { registerAppProtocol } from "./protocol.js";
import { loadSettings, registerSettingsIpc } from "./settingsStore.js";
import { registerWindowIpc } from "./window-ipc.js";

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

/**
 * Asks the main window to open the settings dialog.
 */
function openSettings() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send("menu:open-settings");
  }
}

app.whenReady().then(async () => {
  registerAppProtocol();
  registerFsIpc(ipcMain, app, shell);
  const settingsPath = (fileName) => path.join(app.getPath("userData"), fileName);
  nativeTheme.themeSource = (await loadSettings(settingsPath("settings.json"))).theme;
  registerSettingsIpc(ipcMain, settingsPath, (settings) => {
    nativeTheme.themeSource = settings.theme;
  });
  registerEditorIpc(ipcMain, dialog);
  registerDialogIpc(ipcMain);
  registerWindowIpc(ipcMain);
  initI18n();
  createAppMenu({
    onSettings: openSettings,
    onUsage: showUsage,
    onAbout: showAbout,
  });
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
