import fsp from "node:fs/promises";
import { normalizeAxis, writeAtomically } from "./image-transform.js";
import { composeOrientation, loadJxlTransformer, readJxlInfo } from "./jxl-transform.js";

/**
 * Display transforms of the supported flip axes: a horizontal mirror is the
 * mirror M alone, a vertical mirror is the mirror turned by 180 degrees.
 * @type {Record<string, [number, number]>}
 */
const FLIP_OPS = {
  horizontal: [0, 1],
  vertical: [2, 1],
};

/**
 * Flips JPEG XL bytes in memory through the @chimok/jxltran-js API: only the
 * Exif orientation tag of the image header is changed, the pixels stay
 * untouched and decoders apply the mirror on display, so there is no quality
 * loss. The requested axis is the one of the *displayed* image, so it is
 * composed with the orientation tag the file already carries.
 * @param {Uint8Array} bytes - Content of the JPEG XL file.
 * @param {string} axis - "horizontal" (left/right) or "vertical" (top/bottom) of the displayed image.
 * @returns {Promise<{data: Uint8Array, orientation: number}>} Flipped bytes and the resulting orientation tag.
 */
async function flipBytes(bytes, axis) {
  const transformer = await loadJxlTransformer();
  const current = transformer.info(bytes).orientation;
  const target = composeOrientation(current, FLIP_OPS[axis]);
  const { data } = transformer.setOrientation(bytes, target);
  return { data, orientation: target };
}

/**
 * Mirrors a JPEG XL file losslessly in place with the @chimok/jxltran-js API.
 * Nothing is recompressed; the transform only replaces the orientation tag in
 * the image header, which every decoder applies on display. Animated files are
 * mirrored the same way - the tag change touches no frame.
 *
 * The result is written to a temporary file first; the original is only
 * replaced once a complete output exists, and its permission bits are carried
 * over.
 *
 * @param {string} filePath - Absolute path of the JPEG XL file.
 * @param {string} axis - "horizontal" (left/right) or "vertical" (top/bottom) of the displayed image.
 * @param {{flip?: (bytes: Uint8Array, axis: string) => {data: Uint8Array, orientation: number} | Promise<{data: Uint8Array, orientation: number}>, fs?: object}} [options] - Injectable dependencies for tests.
 * @returns {Promise<{ok: true, path: string, size: number, mtimeMs: number, axis: string, perfect: true, orientation?: number} | {ok: false, code: 'invalid-axis'|'not-jxl'|'transform'|'io', detail?: string}>} Flip result.
 */
async function flipJxl(filePath, axis, options = {}) {
  const flip = options.flip ?? flipBytes;
  const fileSystem = options.fs ?? fsp;

  const flipAxis = normalizeAxis(axis);
  if (flipAxis === null) return { ok: false, code: "invalid-axis" };

  const input = await readJxlInfo(filePath, fileSystem);
  if (!input.ok) return input;

  let flipped;
  try {
    flipped = await flip(input.bytes, flipAxis);
  } catch (error) {
    const detail = (error?.message ?? String(error)).trim();
    return { ok: false, code: "transform", detail };
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
      perfect: true,
      orientation: flipped.orientation,
    };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

export { flipJxl };
