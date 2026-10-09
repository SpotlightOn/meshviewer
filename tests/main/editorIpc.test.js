import { EventEmitter } from "node:events";
import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { launchCommand, registerEditorIpc } from "../../src/editorIpc.js";

i18next.init({ lng: "en" });

describe("launchCommand", () => {
  it("resolves ok when the command starts", async () => {
    await expect(launchCommand("/bin/echo", ["hello"])).resolves.toEqual({ ok: true });
  });

  it("resolves with an error when the command does not exist", async () => {
    const result = await launchCommand("/nonexistent-binary-xyz", []);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("resolves with an error when spawn throws synchronously", async () => {
    const proc = {
      spawn: () => {
        throw new Error("boom");
      },
    };
    await expect(launchCommand("x", [], proc)).resolves.toEqual({ ok: false, error: "boom" });
  });

  it("resolves with an error when the process reports one", async () => {
    const child = new EventEmitter();
    const proc = { spawn: () => child };
    process.nextTick(() => child.emit("error", new Error("ENOENT")));
    const result = await launchCommand("x", [], proc);
    expect(result).toEqual({ ok: false, error: "ENOENT" });
  });
});

describe("registerEditorIpc", () => {
  const handlers = {};
  const ipcMain = {
    handle: (channel, handler) => {
      handlers[channel] = handler;
    },
  };

  it("registers the pick and run handlers", () => {
    registerEditorIpc(ipcMain, {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });
    expect(Object.keys(handlers).sort()).toEqual(["editor:pick", "editor:run"]);
  });

  it("returns the picked executable path", async () => {
    registerEditorIpc(ipcMain, {
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/usr/bin/gimp"] }),
    });
    await expect(handlers["editor:pick"]()).resolves.toBe("/usr/bin/gimp");
  });

  it("returns null when the dialog is canceled", async () => {
    registerEditorIpc(ipcMain, {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });
    await expect(handlers["editor:pick"]()).resolves.toBeNull();
  });

  it("runs the editor on the file path", async () => {
    registerEditorIpc(ipcMain, {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });
    await expect(handlers["editor:run"](null, "/bin/echo", "/tmp/foto.png")).resolves.toEqual({
      ok: true,
    });
  });
});
