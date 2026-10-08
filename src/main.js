import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import i18next from "i18next";
import { registerDialogIpc, showAbout, showShortcuts } from "./dialogs.js";
import { registerFsIpc } from "./fsIpc.js";
import i18nDe from "./locales/de.json" with { type: "json" };
import i18nEn from "./locales/en.json" with { type: "json" };
import { createMainWindow } from "./main-window.js";
import { createAppMenu } from "./menu.js";
import { registerAppProtocol } from "./protocol.js";
import { registerSettingsIpc } from "./settingsStore.js";

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

app.whenReady().then(() => {
  registerAppProtocol();
  registerFsIpc(ipcMain, app, shell);
  registerSettingsIpc(ipcMain, (fileName) => path.join(app.getPath("userData"), fileName));
  registerDialogIpc(ipcMain);
  initI18n();
  createAppMenu({
    onSettings: openSettings,
    onShortcuts: showShortcuts,
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
