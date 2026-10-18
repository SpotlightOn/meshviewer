import fsp from "node:fs/promises";
import { COPY } from "@chimok/jpegtran-js";
import { normalizeAngle, writeAtomically } from "./image-transform.js";
import { loadTransformer, readJpeg, transformFailure } from "./jpeg-transform.js";

/**
 * Rotates JPEG bytes in memory through the @chimok/jpegtran-js API: the module
 * only rearranges the DCT blocks, the image is never decoded and recompressed,
 * so the quality stays exactly as it was and every extra marker (Exif included)
 * is kept.
 * @param {Uint8Array} bytes - Content of the JPEG file.
 * @param {number} angle - Clockwise angle (90, 180 or 270).
 * @returns {Promise<{data: Uint8Array, perfect: boolean}>} Rotated bytes and whether the transform was MCU aligned.
 */
async function rotateBytes(bytes, angle) {
  const transformer = await loadTransformer();
  const { data, perfect } = transformer.rotate(bytes, angle, { copy: COPY.all });
  return { data, perfect };
}

/**
 * Rotates a JPEG file losslessly in place with the @chimok/jpegtran-js API.
 * Nothing is recompressed and every extra marker is kept.
 *
 * The result is written to a temporary file first; the original is only
 * replaced once a complete output exists, and its permission bits are carried
 * over. Images whose dimensions are not a multiple of the MCU block size are
 * rotated anyway, with the non-transformable edge blocks cropped like
 * `jpegtran` without `-perfect`; the result then reports `perfect: false`.
 *
 * @param {string} filePath - Absolute path of the JPEG file.
 * @param {number} degrees - Rotation angle in degrees (90 clockwise, 180, 270 = 90 counter-clockwise; negative values are normalized).
 * @param {{rotate?: (bytes: Uint8Array, angle: number) => {data: Uint8Array, perfect: boolean} | Promise<{data: Uint8Array, perfect: boolean}>, fs?: object}} [options] - Injectable dependencies for tests.
 * @returns {Promise<{ok: true, path: string, size: number, mtimeMs: number, angle: number, perfect: boolean} | {ok: false, code: 'invalid-angle'|'not-jpeg'|'transform'|'io', detail?: string}>} Rotation result.
 */
async function rotateJpeg(filePath, degrees, options = {}) {
  const rotate = options.rotate ?? rotateBytes;
  const fileSystem = options.fs ?? fsp;

  const angle = normalizeAngle(degrees);
  if (angle === null) return { ok: false, code: "invalid-angle" };

  const input = await readJpeg(filePath, fileSystem);
  if (!input.ok) return input;

  let rotated;
  try {
    rotated = await rotate(input.bytes, angle);
  } catch (error) {
    return transformFailure(error);
  }
  if (!rotated?.data?.length) {
    return { ok: false, code: "transform", detail: "the rotation produced no output" };
  }

  try {
    await writeAtomically(fileSystem, filePath, rotated.data, input.stat.mode);
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
      angle,
      perfect: rotated.perfect !== false,
    };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

export { rotateJpeg };
