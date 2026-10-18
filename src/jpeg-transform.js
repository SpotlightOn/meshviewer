import path from "node:path";
import { createRotator, STATUS } from "@chimok/jpegtran-js";
import { transformFailure as failureOf, readSourceFile } from "./image-transform.js";

/**
 * JPEG layer of the lossless transforms: the file extensions that count as
 * JPEG, the WebAssembly transformer singleton and the error mapping that
 * keeps the `not-jpeg` code for input that is no JPEG.
 */

/**
 * File extensions that are treated as JPEG input.
 * @type {Set<string>}
 */
const JPEG_EXTENSIONS = new Set([".jpg", ".jpeg"]);

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
 * Maps a failed transform to a result object for the renderer. jpegtran
 * reports "not a JPEG" with its own status, which becomes the `not-jpeg` code.
 * @param {Error & {status?: number}} error - Error the transform threw.
 * @returns {{ok: false, code: 'not-jpeg'|'transform', detail: string}} Error result.
 */
function transformFailure(error) {
  const result = failureOf(error);
  return error?.status === STATUS.notJpeg ? { ...result, code: "not-jpeg" } : result;
}

/**
 * Reads a JPEG file together with its stat, so the caller can carry the
 * permission bits over to the output.
 * @param {string} filePath - Absolute path of the JPEG file.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @returns {Promise<{ok: true, stat: object, bytes: Uint8Array} | {ok: false, code: 'not-jpeg'|'io', detail?: string}>} File content or an error result.
 */
async function readJpeg(filePath, fileSystem) {
  const input = await readSourceFile(filePath, JPEG_EXTENSIONS, fileSystem);
  if (input.ok || input.code !== "unsupported-format") return input;
  return { ok: false, code: "not-jpeg" };
}

export { isJpegPath, loadTransformer, readJpeg, transformFailure };
