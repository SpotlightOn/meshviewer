import { describe, expect, it } from "vitest";
import {
  FORMAT_BACKENDS,
  imageCapabilities,
  registerImageIpc,
  runImageOp,
} from "../../src/image-ops.js";

/**
 * Builds a format registry with fake backends that record every call, so the
 * routing can be checked without touching a file.
 * @returns {{backends: Array<object>, calls: Array<Array<unknown>>}} Registry and the arguments of every backend call.
 */
function fakeBackends() {
  const calls = [];
  const record = (name) => (filePath, argument) => {
    calls.push([name, filePath, argument]);
    return { ok: true, name };
  };
  const backends = ["jpeg", "jxl"].map((name) => ({
    name,
    isFormat: (filePath) => filePath.toLowerCase().endsWith(`.${name === "jpeg" ? "jpg" : name}`),
    rotate: record(`${name}:rotate`),
    flip: record(`${name}:flip`),
    crop: record(`${name}:crop`),
    capabilities: async () => ({ ok: true, animated: name === "jxl-animated" }),
  }));
  return { backends, calls };
}

/**
 * Collects the handlers an ipcMain receives, like Electron does.
 * @returns {{ipcMain: {handle: Function}, handlers: Record<string, Function}}} Fake ipcMain and the registered handlers.
 */
function fakeIpcMain() {
  const handlers = {};
  return {
    ipcMain: {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    },
    handlers,
  };
}

describe("registerImageIpc", () => {
  it("registers the generic channels", () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerImageIpc(ipcMain, fakeBackends().backends);
    expect(Object.keys(handlers)).toEqual([
      "rotate:image",
      "flip:image",
      "crop:image",
      "image:capabilities",
    ]);
  });

  it("routes every operation to the backend of the file extension", async () => {
    const { backends, calls } = fakeBackends();
    const { ipcMain, handlers } = fakeIpcMain();
    registerImageIpc(ipcMain, backends);

    await handlers["rotate:image"](null, "/tmp/photo.jpg", 90);
    await handlers["rotate:image"](null, "/tmp/photo.jxl", 90);
    await handlers["flip:image"](null, "/tmp/photo.jxl", "horizontal");
    await handlers["crop:image"](null, "/tmp/photo.jpg", { x: 0, y: 0, width: 8, height: 8 });

    expect(calls).toEqual([
      ["jpeg:rotate", "/tmp/photo.jpg", 90],
      ["jxl:rotate", "/tmp/photo.jxl", 90],
      ["jxl:flip", "/tmp/photo.jxl", "horizontal"],
      ["jpeg:crop", "/tmp/photo.jpg", { x: 0, y: 0, width: 8, height: 8 }],
    ]);
  });

  it("rejects paths of formats no backend handles", async () => {
    const { backends, calls } = fakeBackends();
    const { ipcMain, handlers } = fakeIpcMain();
    registerImageIpc(ipcMain, backends);

    await expect(handlers["rotate:image"](null, "/tmp/photo.png", 90)).resolves.toEqual({
      ok: false,
      code: "unsupported-format",
    });
    await expect(handlers["flip:image"](null, "/tmp/photo", "horizontal")).resolves.toEqual({
      ok: false,
      code: "unsupported-format",
    });
    await expect(
      handlers["crop:image"](null, undefined, { x: 0, y: 0, width: 8, height: 8 }),
    ).resolves.toEqual({ ok: false, code: "unsupported-format" });
    expect(calls).toEqual([]);
  });
});

describe("runImageOp", () => {
  it("picks the backend by extension and passes the argument through", async () => {
    const { backends, calls } = fakeBackends();
    await expect(runImageOp("rotate", "/tmp/photo.JXL", 180, backends)).resolves.toEqual({
      ok: true,
      name: "jxl:rotate",
    });
    expect(calls).toEqual([["jxl:rotate", "/tmp/photo.JXL", 180]]);
  });

  it("fails with the real registry on a path of a supported but missing file", async () => {
    const result = await runImageOp("rotate", "/nonexistent/photo.jpg", 90, FORMAT_BACKENDS);
    expect(result).toMatchObject({ ok: false, code: "io" });
  });
});

describe("imageCapabilities", () => {
  it("reports the format of the backend that handles the file", async () => {
    const { backends } = fakeBackends();
    await expect(imageCapabilities("/tmp/photo.jpg", backends)).resolves.toEqual({
      ok: true,
      animated: false,
      format: "jpeg",
    });
  });

  it("reports unsupported formats", async () => {
    const { backends } = fakeBackends();
    await expect(imageCapabilities("/tmp/photo.png", backends)).resolves.toEqual({
      ok: false,
      code: "unsupported-format",
    });
  });
});
