import fsp from "node:fs/promises";
import path from "node:path";
import { COPY, STATUS } from "@chimok/jpegtran-js";
import { loadTransformer, readJpeg, transformFailure, writeAtomically } from "./jpeg-transform.js";

/** Highest number appended to a crop file name before giving up. */
const MAX_CROP_SUFFIX = 999;

/**
 * Validates a crop rectangle coming from the renderer. The values are pixel
 * counts in the stored image, so they have to be non-negative integers and the
 * region has to have a size.
 * @param {object} rect - Requested region `{x, y, width, height}`.
 * @returns {{x: number, y: number, width: number, height: number}|null} Normalized region, or null when it is not usable.
 */
function normalizeRect(rect) {
  if (rect === null || typeof rect !== "object") return null;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every((value) => Number.isInteger(value) && value >= 0)) return null;
  if (width === 0 || height === 0) return null;
  return { x, y, width, height };
}

/**
 * Crops JPEG bytes in memory through the @chimok/jpegtran-js API. Only whole
 * DCT blocks are copied, the image is never decoded and recompressed, so the
 * quality stays exactly as it was and every extra marker (Exif included) is
 * kept.
 *
 * The upper left corner of the region is moved up and left to the next iMCU
 * boundary, so the caller has to pass a region whose origin already lies on
 * that grid; the returned dimensions are then exactly the requested ones.
 *
 * @param {Uint8Array} bytes - Content of the JPEG file.
 * @param {{x: number, y: number, width: number, height: number}} rect - Region to keep.
 * @returns {Promise<{data: Uint8Array, width: number, height: number}>} Cropped bytes and their dimensions.
 */
async function cropBytes(bytes, rect) {
  const transformer = await loadTransformer();
  const { data, width, height } = transformer.crop(bytes, rect, { copy: COPY.all });
  return { data, width, height };
}

/**
 * Picks the output path of a crop: `<basename>-crop-<n><ext>` next to the
 * source, using the first number that is still free.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @param {string} filePath - Absolute path of the source file.
 * @returns {Promise<string>} Absolute path that is not in use yet.
 */
async function cropPathFor(fileSystem, filePath) {
  const dir = path.dirname(filePath);
  const extension = path.extname(filePath);
  const base = path.basename(filePath, extension);
  for (let number = 1; number <= MAX_CROP_SUFFIX; number += 1) {
    const candidate = path.join(dir, `${base}-crop-${number}${extension}`);
    try {
      await fileSystem.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("no free name for the cropped file");
}

/**
 * Crops a JPEG file losslessly into a new file next to it, leaving the source
 * untouched. The output is named `<basename>-crop-<n><ext>`, keeps the
 * permission bits and every marker of the source.
 *
 * @param {string} filePath - Absolute path of the JPEG file.
 * @param {{x: number, y: number, width: number, height: number}} rect - Region to keep, in stored pixels with an iMCU aligned origin.
 * @param {{crop?: (bytes: Uint8Array, rect: object) => {data: Uint8Array, width: number, height: number} | Promise<{data: Uint8Array, width: number, height: number}>, fs?: object}} [options] - Injectable dependencies for tests.
 * @returns {Promise<{ok: true, path: string, name: string, size: number, mtimeMs: number, width: number, height: number} | {ok: false, code: 'invalid-rect'|'not-jpeg'|'bad-crop'|'transform'|'io', detail?: string}>} Crop result.
 */
async function cropJpeg(filePath, rect, options = {}) {
  const crop = options.crop ?? cropBytes;
  const fileSystem = options.fs ?? fsp;

  const region = normalizeRect(rect);
  if (region === null) return { ok: false, code: "invalid-rect" };

  const input = await readJpeg(filePath, fileSystem);
  if (!input.ok) return input;

  let cropped;
  try {
    cropped = await crop(input.bytes, region);
  } catch (error) {
    if (error?.status === STATUS.badCrop) {
      return { ok: false, code: "bad-crop", detail: (error.message ?? "").trim() };
    }
    return transformFailure(error);
  }
  if (!cropped?.data?.length) {
    return { ok: false, code: "transform", detail: "the crop produced no output" };
  }

  let outputPath;
  try {
    outputPath = await cropPathFor(fileSystem, filePath);
    await writeAtomically(fileSystem, outputPath, cropped.data, input.stat.mode);
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }

  try {
    const written = await fileSystem.stat(outputPath);
    return {
      ok: true,
      path: outputPath,
      name: path.basename(outputPath),
      size: written.size,
      mtimeMs: written.mtimeMs,
      width: cropped.width,
      height: cropped.height,
    };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

/**
 * Registers the crop IPC handler on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 */
function registerCropIpc(ipcMain) {
  ipcMain.handle("crop:jpeg", (_event, filePath, rect) => cropJpeg(filePath, rect));
}

export { cropJpeg, registerCropIpc };
