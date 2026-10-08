import childProcess from "node:child_process";
import i18next from "i18next";

/**
 * Launches an external command detached from the app process. Resolves once
 * the process was successfully spawned, or with an error otherwise. The
 * command runs without a shell, so arguments never need quoting.
 * @param {string} command - Executable path or command name.
 * @param {string[]} args - Command arguments.
 * @param {typeof childProcess} [proc] - child_process module, injectable for tests.
 * @returns {Promise<{ok: boolean, error?: string}>} Spawn result.
 */
async function launchCommand(command, args, proc = childProcess) {
  return new Promise((resolve) => {
    let child;
    try {
      child = proc.spawn(command, args, { detached: true, stdio: "ignore" });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    child.once("error", (error) => resolve({ ok: false, error: error.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

/**
 * Registers the editor IPC handlers: picking an executable with the native
 * file dialog and launching the configured editor on a file.
 * @param {{handle: Function}} ipcMain - Electron ipcMain module.
 * @param {{showOpenDialog: Function}} dialog - Electron dialog module.
 */
function registerEditorIpc(ipcMain, dialog) {
  ipcMain.handle("editor:pick", async () => {
    const result = await dialog.showOpenDialog({
      title: i18next.t("editor.pickTitle"),
      properties: ["openFile"],
      filters: [{ name: "Applications", extensions: ["*"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("editor:run", (_event, command, filePath) => launchCommand(command, [filePath]));
}

export { launchCommand, registerEditorIpc };
