import { Menu } from "electron";
import i18next from "i18next";

/**
 * Creates the application menu. Every visible label comes from i18next so the
 * whole menu follows the app locale instead of Electron's built-in role
 * localization; the standard editing roles keep their behavior.
 * @param {object} actions - Menu action callbacks.
 * @param {() => void} actions.onSettings - Opens the settings dialog in the main window.
 * @param {() => void} actions.onShortcuts - Opens the keyboard shortcuts dialog.
 * @param {() => void} actions.onAbout - Opens the About dialog.
 */
function createAppMenu({ onSettings, onShortcuts, onAbout }) {
  const isMac = process.platform === "darwin";
  const t = (key) => i18next.t(key);
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: t("menu.file"),
      submenu: isMac
        ? [{ role: "close", label: t("menu.closeWindow") }]
        : [{ role: "quit", label: t("menu.quit") }],
    },
    {
      label: t("menu.edit"),
      submenu: [
        { role: "undo", label: t("menu.undo") },
        { role: "redo", label: t("menu.redo") },
        { type: "separator" },
        { role: "cut", label: t("menu.cut") },
        { role: "copy", label: t("menu.copy") },
        { role: "paste", label: t("menu.paste") },
        { role: "selectAll", label: t("menu.selectAll") },
        { type: "separator" },
        { label: t("menu.settings"), click: onSettings },
      ],
    },
    {
      label: t("menu.view"),
      submenu: [
        { role: "reload", label: t("menu.reload") },
        { role: "forceReload", label: t("menu.forceReload") },
        { role: "toggleDevTools", label: t("menu.toggleDevTools") },
        { type: "separator" },
        { role: "resetZoom", label: t("menu.resetZoom") },
        { role: "zoomIn", label: t("menu.zoomIn") },
        { role: "zoomOut", label: t("menu.zoomOut") },
        { type: "separator" },
        { role: "togglefullscreen", label: t("menu.toggleFullscreen") },
      ],
    },
    {
      label: t("menu.window"),
      submenu: [
        { role: "minimize", label: t("menu.minimize") },
        { role: "zoom", label: t(isMac ? "menu.macZoom" : "menu.maximize") },
        ...(isMac ? [] : [{ role: "close", label: t("menu.closeWindow") }]),
      ],
    },
    {
      label: t("menu.help"),
      submenu: [
        { label: t("menu.shortcuts"), click: onShortcuts },
        { type: "separator" },
        { label: t("menu.about"), click: onAbout },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export { createAppMenu };
