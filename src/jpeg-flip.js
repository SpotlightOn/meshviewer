import fsp from "node:fs/promises";
import { COPY, TRANSFORM } from "@chimok/jpegtran-js";
import { loadTransformer, readJpeg, transformFailure, writeAtomically } from "./jpeg-transform.js";

/**
 * Flip axes the module can apply.
 * @type {Set<string>}
 */
const FLIP_AXES = new Set(["horizontal", "vertical"]);

/**
 * The jpegtran transform behind every supported flip axis.
 * @type {Record<string, number>}
 */
const FLIP_TRANSFORMS = {
  horizontal: TRANSFORM.flipHorizontal,
  vertical: TRANSFORM.flipVertical,
};

/**
 * Normalizes a requested flip axis to one of the supported ones.
 * @param {unknown} axis - Requested axis ("horizontal" mirrors left/right, "vertical" top/bottom).
 * @returns {string|null} The axis, or null when it is not supported.
 */
function normalizeAxis(axis) {
  return typeof axis === "string" && FLIP_AXES.has(axis) ? axis : null;
}

/**
 * Flips JPEG bytes in memory through the @chimok/jpegtran-js API: the module
 * only rearranges the DCT blocks, the image is never decoded and recompressed,
 * so the quality stays exactly as it was and every extra marker (Exif included)
 * is kept.
 * @param {Uint8Array} bytes - Content of the JPEG file.
 * @param {string} axis - "horizontal" or "vertical".
 * @returns {Promise<{data: Uint8Array, perfect: boolean}>} Flipped bytes and whether the transform was MCU aligned.
 */
async function flipBytes(bytes, axis) {
  const transformer = await loadTransformer();
  const transform = FLIP_TRANSFORMS[axis];
  const perfect = transformer.perfectPossible(bytes, transform);
  const { data } = transformer.transformDetailed(bytes, { transform, copy: COPY.all });
  return { data, perfect };
}

/**
 * Mirrors a JPEG file losslessly in place with the @chimok/jpegtran-js API.
 * Nothing is recompressed and every extra marker is kept.
 *
 * The result is written to a temporary file first; the original is only
 * replaced once a complete output exists, and its permission bits are carried
 * over. Images whose dimensions are not a multiple of the MCU block size are
 * flipped anyway, with the non-transformable edge blocks cropped like
 * `jpegtran` without `-perfect`; the result then reports `perfect: false`.
 *
 * @param {string} filePath - Absolute path of the JPEG file.
 * @param {string} axis - "horizontal" (left/right) or "vertical" (top/bottom).
 * @param {{flip?: (bytes: Uint8Array, axis: string) => {data: Uint8Array, perfect: boolean} | Promise<{data: Uint8Array, perfect: boolean}>, fs?: object}} [options] - Injectable dependencies for tests.
 * @returns {Promise<{ok: true, path: string, size: number, mtimeMs: number, axis: string, perfect: boolean} | {ok: false, code: 'invalid-axis'|'not-jpeg'|'transform'|'io', detail?: string}>} Flip result.
 */
async function flipJpeg(filePath, axis, options = {}) {
  const flip = options.flip ?? flipBytes;
  const fileSystem = options.fs ?? fsp;

  const flipAxis = normalizeAxis(axis);
  if (flipAxis === null) return { ok: false, code: "invalid-axis" };

  const input = await readJpeg(filePath, fileSystem);
  if (!input.ok) return input;

  let flipped;
  try {
    flipped = await flip(input.bytes, flipAxis);
  } catch (error) {
    return transformFailure(error);
  }
  if (!flipped?.data?.length) {
    return { ok: false, code: "transform", detail: "the flip produced no output" };
  }

  try {
    await writeAtomically(fileSystem, filePath, flipped.data, input.stat.mode);
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }

  try {
    const updated = await fileSystem.stat(filePath);
    return {
      ok: true,
      path: filePath,
      size: updated.size,
      mtimeMs: updated.mtimeMs,
      axis: flipAxis,
      perfect: flipped.perfect !== false,
    };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

/**
 * Registers the flip IPC handler on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 */
function registerFlipIpc(ipcMain) {
  ipcMain.handle("flip:jpeg", (_event, filePath, axis) => flipJpeg(filePath, axis));
}

export { flipJpeg, normalizeAxis, registerFlipIpc };
