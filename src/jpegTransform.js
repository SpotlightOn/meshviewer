import path from "node:path";
import { createRotator, STATUS } from "@chimok/jpegtran-js";

/**
 * File extensions that are treated as JPEG input.
 * @type {Set<string>}
 */
const JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);

/** Permission bits that are carried over from the source file. */
const MODE_MASK = 0o7777;

/**
 * Marker inside the name of a temporary file, which also carries a `.tmp`
 * extension so a leftover file is never picked up as a media file.
 * @type {string}
 */
const TEMP_MARKER = ".meshviewer-jpeg";

/** Sequence number for the temporary file names inside this process. */
let tempCounter = 0;

/** The loaded transformer, shared by every transform in this process. */
let transformerPromise = null;

/**
 * Reports whether a path names a JPEG file, judged by its extension.
 * @param {string} filePath - Absolute path of the file.
 * @returns {boolean} true when the extension is one of the JPEG ones.
 */
function isJpegPath(filePath) {
  return JPEG_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Loads the @chimok/jpegtran-js WebAssembly module once and caches it. A failed
 * load is not cached, so the next transform tries again.
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
 * @returns {{ok: false, code: 'not-jpeg'|'transform', detail: string}} Error result.
 */
function transformFailure(error) {
  const detail = (error?.message ?? String(error)).trim();
  const code = error?.status === STATUS.notJpeg ? "not-jpeg" : "transform";
  return { ok: false, code, detail };
}

/**
 * Reads a JPEG file together with its stat, so the caller can carry the
 * permission bits over to the output.
 * @param {string} filePath - Absolute path of the JPEG file.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @returns {Promise<{ok: true, stat: object, bytes: Uint8Array} | {ok: false, code: 'not-jpeg'|'io', detail?: string}>} File content or an error result.
 */
async function readJpeg(filePath, fileSystem) {
  if (!isJpegPath(filePath)) return { ok: false, code: "not-jpeg" };

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

export { loadTransformer, readJpeg, transformFailure, writeAtomically };
