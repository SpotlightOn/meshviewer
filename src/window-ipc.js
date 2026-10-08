import { BrowserWindow } from "electron";

/**
 * Registers window control IPC handlers.
 * @param {import("electron").IpcMain} ipcMain - The IPC main instance.
 */
export function registerWindowIpc(ipcMain) {
  ipcMain.handle("win:setFullScreen", (event, flag) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(Boolean(flag));
  });
}
