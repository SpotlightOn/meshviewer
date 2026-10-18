import fsp from "node:fs/promises";
import { normalizeAngle, writeAtomically } from "./image-transform.js";
import { composeOrientation, loadJxlTransformer, readJxlInfo } from "./jxl-transform.js";

/**
 * Display transforms of the supported rotation angles: a quarter turn clockwise
 * is the rotation R once, 180 degrees twice and 270 degrees three times; none
 * of them mirrors.
 * @type {Record<number, [number, number]>}
 */
const ROTATION_OPS = {
  90: [1, 0],
  180: [2, 0],
  270: [3, 0],
};

/**
 * Rotates JPEG XL bytes in memory through the @chimok/jxltran-js API: only the
 * Exif orientation tag of the image header is changed, the pixels stay
 * untouched and decoders apply the rotation on display, so there is no
 * quality loss. The requested angle is a turn of the *displayed* image, so it
 * is composed with the orientation tag the file already carries.
 * @param {Uint8Array} bytes - Content of the JPEG XL file.
 * @param {number} angle - Clockwise angle (90, 180 or 270) of the displayed image.
 * @returns {Promise<{data: Uint8Array, orientation: number}>} Rotated bytes and the resulting orientation tag.
 */
async function rotateBytes(bytes, angle) {
  const transformer = await loadJxlTransformer();
  const current = transformer.info(bytes).orientation;
  const target = composeOrientation(current, ROTATION_OPS[angle]);
  const { data } = transformer.setOrientation(bytes, target);
  return { data, orientation: target };
}

/**
 * Rotates a JPEG XL file losslessly in place with the @chimok/jxltran-js API.
 * Nothing is recompressed; the transform only replaces the orientation tag in
 * the image header, which every decoder applies on display. Animated files are
 * rotated the same way - the tag change touches no frame.
 *
 * The result is written to a temporary file first; the original is only
 * replaced once a complete output exists, and its permission bits are carried
 * over.
 *
 * @param {string} filePath - Absolute path of the JPEG XL file.
 * @param {number} degrees - Rotation angle in degrees (90 clockwise, 180, 270 = 90 counter-clockwise; negative values are normalized).
 * @param {{rotate?: (bytes: Uint8Array, angle: number) => {data: Uint8Array, orientation: number} | Promise<{data: Uint8Array, orientation: number}>, fs?: object}} [options] - Injectable dependencies for tests.
 * @returns {Promise<{ok: true, path: string, size: number, mtimeMs: number, angle: number, perfect: true, orientation?: number} | {ok: false, code: 'invalid-angle'|'not-jxl'|'transform'|'io', detail?: string}>} Rotation result.
 */
async function rotateJxl(filePath, degrees, options = {}) {
  const rotate = options.rotate ?? rotateBytes;
  const fileSystem = options.fs ?? fsp;

  const angle = normalizeAngle(degrees);
  if (angle === null) return { ok: false, code: "invalid-angle" };

  const input = await readJxlInfo(filePath, fileSystem);
  if (!input.ok) return input;

  let rotated;
  try {
    rotated = await rotate(input.bytes, angle);
  } catch (error) {
    const detail = (error?.message ?? String(error)).trim();
    return { ok: false, code: "transform", detail };
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
      perfect: true,
      orientation: rotated.orientation,
    };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

export { rotateJxl };
