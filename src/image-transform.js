import path from "node:path";

/**
 * Format-neutral helpers shared by the lossless image transforms (JPEG and
 * JPEG XL): reading a source file, writing a result atomically, validating
 * the arguments the renderer sends and picking free output names.
 */

/** Permission bits that are carried over from the source file. */
const MODE_MASK = 0o7777;

/**
 * Marker inside the name of a temporary file, which also carries a `.tmp`
 * extension so a leftover file is never picked up as a media file.
 * @type {string}
 */
const TEMP_MARKER = ".meshviewer-image";

/** Sequence number for the temporary file names inside this process. */
let tempCounter = 0;

/**
 * Rotation angles the transforms can apply (clockwise turns of the image).
 * @type {Set<number>}
 */
const ROTATION_ANGLES = new Set([90, 180, 270]);

/**
 * Flip axes the transforms can apply.
 * @type {Set<string>}
 */
const FLIP_AXES = new Set(["horizontal", "vertical"]);

/** Highest number appended to a transform output name before giving up. */
const MAX_OUTPUT_SUFFIX = 999;

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
 * Normalizes a requested flip axis to one of the supported ones.
 * @param {unknown} axis - Requested axis ("horizontal" mirrors left/right, "vertical" top/bottom).
 * @returns {string|null} The axis, or null when it is not supported.
 */
function normalizeAxis(axis) {
  return typeof axis === "string" && FLIP_AXES.has(axis) ? axis : null;
}

/**
 * Validates a crop rectangle coming from the renderer. The values are pixel
 * counts, so they have to be non-negative integers and the region has to have
 * a size.
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
 * Returns the temporary path a transform writes to before the result is moved
 * to its final name. It lives in the same directory as the target, so the move
 * is an atomic rename inside one filesystem.
 * @param {string} targetPath - Absolute path of the final output file.
 * @returns {string} Absolute path of the temporary file.
 */
function tempPathFor(targetPath) {
  const name = `${path.basename(targetPath)}.${process.pid}-${tempCounter}${TEMP_MARKER}.tmp`;
  tempCounter += 1;
  return path.join(path.dirname(targetPath), name);
}

/**
 * Maps a failed transform to a result object for the renderer.
 * @param {Error & {status?: number}} error - Error the transform threw.
 * @returns {{ok: false, code: 'transform', detail: string}} Error result.
 */
function transformFailure(error) {
  const detail = (error?.message ?? String(error)).trim();
  return { ok: false, code: "transform", detail };
}

/**
 * Reads an image file together with its stat, so the caller can carry the
 * permission bits over to the output.
 * @param {string} filePath - Absolute path of the image file.
 * @param {Set<string>} extensions - Extensions (lowercase, with leading dot) that are accepted.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @returns {Promise<{ok: true, stat: object, bytes: Uint8Array} | {ok: false, code: 'unsupported-format'|'io', detail?: string}>} File content or an error result.
 */
async function readSourceFile(filePath, extensions, fileSystem) {
  if (!extensions.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, code: "unsupported-format" };
  }

  let stat;
  try {
    stat = await fileSystem.stat(filePath);
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
  if (!stat.isFile()) return { ok: false, code: "io", detail: "not a regular file" };

  try {
    const bytes = await fileSystem.readFile(filePath);
    return { ok: true, stat, bytes: new Uint8Array(bytes) };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

/**
 * Writes data to a path atomically: the bytes go to a temporary file in the
 * same directory, receive the given permission bits and are then renamed onto
 * the target, so a half-written file is never visible under its final name.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @param {string} targetPath - Absolute path of the output file.
 * @param {Uint8Array} data - Bytes to write.
 * @param {number} mode - Permission bits of the source file.
 * @returns {Promise<void>} Resolves once the file is in place.
 */
async function writeAtomically(fileSystem, targetPath, data, mode) {
  const tempPath = tempPathFor(targetPath);
  try {
    await fileSystem.writeFile(tempPath, data);
    await fileSystem.chmod(tempPath, mode & MODE_MASK).catch(() => {});
    await fileSystem.rename(tempPath, targetPath);
  } catch (error) {
    await fileSystem.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Picks a free output path next to a source file, named
 * `<basename>-<marker>-<n><ext>` and numbered up while a name is taken.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @param {string} filePath - Absolute path of the source file.
 * @param {string} marker - Word between the source name and the number, e.g. "crop".
 * @returns {Promise<string>} Absolute path that is not in use yet.
 * @throws {Error} When every number up to the limit is taken.
 */
async function numberedPathFor(fileSystem, filePath, marker) {
  const dir = path.dirname(filePath);
  const extension = path.extname(filePath);
  const base = path.basename(filePath, extension);
  for (let number = 1; number <= MAX_OUTPUT_SUFFIX; number += 1) {
    const candidate = path.join(dir, `${base}-${marker}-${number}${extension}`);
    try {
      await fileSystem.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`no free ${marker} output name for ${filePath}`);
}

/**
 * Picks the output path of a crop: `<basename>-crop-<n><ext>` next to the
 * source, using the first number that is still free.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @param {string} filePath - Absolute path of the source file.
 * @returns {Promise<string>} Absolute path that is not in use yet.
 */
function cropPathFor(fileSystem, filePath) {
  return numberedPathFor(fileSystem, filePath, "crop");
}

/**
 * Picks the output path of an undone crop: `<basename>-undo-<n><ext>` next to
 * the source, using the first number that is still free.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @param {string} filePath - Absolute path of the source file.
 * @returns {Promise<string>} Absolute path that is not in use yet.
 */
function undoPathFor(fileSystem, filePath) {
  return numberedPathFor(fileSystem, filePath, "undo");
}

export {
  cropPathFor,
  FLIP_AXES,
  normalizeAngle,
  normalizeAxis,
  normalizeRect,
  ROTATION_ANGLES,
  readSourceFile,
  tempPathFor,
  transformFailure,
  undoPathFor,
  writeAtomically,
};
