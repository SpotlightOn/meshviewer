import { cropJpeg } from "./jpeg-crop.js";
import { flipJpeg } from "./jpeg-flip.js";
import { rotateJpeg } from "./jpeg-rotate.js";
import { isJpegPath } from "./jpeg-transform.js";
import { cropJxl, restoreJxl } from "./jxl-crop.js";
import { flipJxl } from "./jxl-flip.js";
import { rotateJxl } from "./jxl-rotate.js";
import { isJxlPath, jxlCapabilities } from "./jxl-transform.js";

/**
 * Format registry and IPC layer of the lossless image tools. The renderer
 * calls the generic channels (`rotate:image`, `flip:image`, `crop:image`,
 * `restore:image`) and this module routes each call to the backend of the
 * file's format, so the UI never carries format knowledge. A new transformable
 * format joins by adding one entry to the registry; a backend that does not
 * implement an operation reports it as unsupported.
 */

/** Result for a path that no format backend handles. */
const UNSUPPORTED = Object.freeze({ ok: false, code: "unsupported-format" });

/**
 * The transformable formats: which paths belong to the format, the lossless
 * operations it supports and how to ask what a file allows.
 * @type {Array<{name: string, isFormat: (filePath: string) => boolean, rotate: Function, flip: Function, crop: Function, capabilities: Function, restore?: Function}>}
 */
const FORMAT_BACKENDS = [
  {
    name: "jpeg",
    isFormat: isJpegPath,
    rotate: rotateJpeg,
    flip: flipJpeg,
    crop: cropJpeg,
    capabilities: async () => ({ ok: true, animated: false, undoable: false }),
  },
  {
    name: "jxl",
    isFormat: isJxlPath,
    rotate: rotateJxl,
    flip: flipJxl,
    crop: cropJxl,
    restore: restoreJxl,
    capabilities: jxlCapabilities,
  },
];

/**
 * Picks the backend that handles a path.
 * @param {string} filePath - Absolute path of the image file.
 * @param {Array} backends - Format registry to search.
 * @returns {object|null} The backend of the format, or null when no format matches.
 */
function backendFor(filePath, backends) {
  if (typeof filePath !== "string") return null;
  return backends.find((backend) => backend.isFormat(filePath)) ?? null;
}

/**
 * Runs one lossless operation on a file through the backend of its format.
 * A backend that does not implement the operation is reported as unsupported,
 * like a format no backend handles.
 * @param {'rotate'|'flip'|'crop'|'restore'} operation - Operation to run.
 * @param {string} filePath - Absolute path of the image file.
 * @param {number|string|object} argument - Operation argument: degrees for a rotation, an axis for a flip, a region for a crop, none for a restore.
 * @param {Array} backends - Format registry.
 * @returns {Promise<object>} Operation result; `unsupported-format` when no backend handles the path or the operation.
 */
async function runImageOp(operation, filePath, argument, backends) {
  const backend = backendFor(filePath, backends);
  if (backend === null || typeof backend[operation] !== "function") return { ...UNSUPPORTED };
  return backend[operation](filePath, argument);
}

/**
 * Reports what a file supports: its format, whether it is animated (so the crop
 * tool can be hidden) and whether it holds a region it does not display (so an
 * undone crop can be offered).
 * @param {string} filePath - Absolute path of the image file.
 * @param {Array} backends - Format registry.
 * @returns {Promise<{ok: true, format: string, animated: boolean, undoable: boolean} | {ok: false, code: string, detail?: string}>} Capabilities or an error result.
 */
async function imageCapabilities(filePath, backends) {
  const backend = backendFor(filePath, backends);
  if (backend === null) return { ...UNSUPPORTED };
  const result = await backend.capabilities(filePath);
  return result.ok ? { ...result, format: backend.name } : result;
}

/**
 * Reports the capability state of a file without ever throwing: a backend
 * that cannot read the file (or fails to load its module) becomes an error
 * result, which the renderer treats as "not animated" and "nothing to undo".
 * @param {string} filePath - Absolute path of the image file.
 * @param {Array} backends - Format registry.
 * @returns {Promise<{ok: true, format: string, animated: boolean, undoable: boolean} | {ok: false, code: string, detail?: string}>} Capabilities or an error result.
 */
async function safeCapabilities(filePath, backends) {
  try {
    return await imageCapabilities(filePath, backends);
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

/**
 * Registers the generic image tool IPC handlers on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 * @param {Array} [backends] - Format registry; injectable for tests.
 */
function registerImageIpc(ipcMain, backends = FORMAT_BACKENDS) {
  ipcMain.handle("rotate:image", (_event, filePath, degrees) =>
    runImageOp("rotate", filePath, degrees, backends),
  );
  ipcMain.handle("flip:image", (_event, filePath, axis) =>
    runImageOp("flip", filePath, axis, backends),
  );
  ipcMain.handle("crop:image", (_event, filePath, rect) =>
    runImageOp("crop", filePath, rect, backends),
  );
  ipcMain.handle("restore:image", (_event, filePath) =>
    runImageOp("restore", filePath, undefined, backends),
  );
  ipcMain.handle("image:capabilities", (_event, filePath) => safeCapabilities(filePath, backends));
}

export { FORMAT_BACKENDS, imageCapabilities, registerImageIpc, runImageOp };
