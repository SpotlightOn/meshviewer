import fsp from "node:fs/promises";
import path from "node:path";
import { COPY, createRotator, STATUS } from "@chimok/jpegtran-js";

/**
 * Rotation angles the module can apply (clockwise turns of the stored pixels).
 * @type {Set<number>}
 */
const ROTATION_ANGLES = new Set([90, 180, 270]);

/**
 * File extensions that are treated as JPEG input.
 * @type {Set<string>}
 */
const JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);

/** Permission bits that are carried over from the original file. */
const MODE_MASK = 0o7777;

/**
 * Marker inside the name of the temporary file, which also carries a `.tmp`
 * extension so a leftover file is never picked up as a media file.
 * @type {string}
 */
const TEMP_MARKER = ".meshviewer-rotate";

/** Sequence number for the temporary file names inside this process. */
let tempCounter = 0;

/** The loaded transformer, shared by every rotation in this process. */
let transformerPromise = null;

/**
 * Normalizes a requested rotation angle to one of the supported clockwise
 * turns. Negative values are accepted (`-90` becomes `270`).
 * @param {number} degrees - Requested angle in degrees.
 * @returns {number|null} A multiple of 90° in [0, 360), or null when the angle is not supported.
 */
function normalizeAngle(degrees) {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return null;
  const angle = ((Math.trunc(degrees) % 360) + 360) % 360;
  return ROTATION_ANGLES.has(angle) ? angle : null;
}

/**
 * Loads the @chimok/jpegtran-js WebAssembly module once and caches it. A failed
 * load is not cached, so the next rotation tries again.
 * @returns {Promise<object>} The transformer from @chimok/jpegtran-js.
 */
async function loadTransformer() {
  if (transformerPromise === null) {
    transformerPromise = createRotator().catch((error) => {
      transformerPromise = null;
      throw error;
    });
  }
  return transformerPromise;
}

/**
 * Rotates JPEG bytes in memory through the @chimok/jpegtran-js API: the module only
 * rearranges the DCT blocks, the image is never decoded and recompressed, so
 * the quality stays exactly as it was and every extra marker (Exif included) is
 * kept.
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
 * Returns the temporary path a rotation writes to before the original file is
 * replaced. It lives in the same directory as the source, so the final move is
 * an atomic rename inside one filesystem.
 * @param {string} filePath - Absolute path of the input file.
 * @returns {string} Absolute path of the temporary output file.
 */
function tempPathFor(filePath) {
  const name = `${path.basename(filePath)}.${process.pid}-${tempCounter}${TEMP_MARKER}.tmp`;
  tempCounter += 1;
  return path.join(path.dirname(filePath), name);
}

/**
 * Maps a failed rotation to a result object for the renderer.
 * @param {Error & {status?: number}} error - Error the rotation threw.
 * @returns {{ok: false, code: 'not-jpeg'|'transform', detail: string}} Error result.
 */
function transformFailure(error) {
  const detail = (error?.message ?? String(error)).trim();
  const code = error?.status === STATUS.notJpeg ? "not-jpeg" : "transform";
  return { ok: false, code, detail };
}

/**
 * Rotates a JPEG file losslessly in place with the @chimok/jpegtran-js API. Nothing is
 * recompressed and every extra marker is kept.
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
  if (!JPEG_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, code: "not-jpeg" };
  }

  let stat;
  try {
    stat = await fileSystem.stat(filePath);
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
  if (!stat.isFile()) return { ok: false, code: "io", detail: "not a regular file" };

  let bytes;
  try {
    bytes = await fileSystem.readFile(filePath);
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }

  let rotated;
  try {
    rotated = await rotate(new Uint8Array(bytes), angle);
  } catch (error) {
    return transformFailure(error);
  }
  if (!rotated?.data?.length) {
    return { ok: false, code: "transform", detail: "the rotation produced no output" };
  }

  const tempPath = tempPathFor(filePath);
  try {
    await fileSystem.writeFile(tempPath, rotated.data);
    await fileSystem.chmod(tempPath, stat.mode & MODE_MASK).catch(() => {});
    await fileSystem.rename(tempPath, filePath);
  } catch (error) {
    await fileSystem.rm(tempPath, { force: true }).catch(() => {});
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

/**
 * Registers the rotation IPC handler on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 */
function registerRotateIpc(ipcMain) {
  ipcMain.handle("rotate:jpeg", (_event, filePath, degrees) => rotateJpeg(filePath, degrees));
}

export { normalizeAngle, registerRotateIpc, rotateJpeg };
