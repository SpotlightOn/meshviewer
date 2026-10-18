import fsp from "node:fs/promises";
import path from "node:path";
import { createJxlTran } from "@chimok/jxltran-js";
import { readSourceFile } from "./image-transform.js";

/**
 * JPEG XL layer of the lossless transforms: the file extensions, the
 * WebAssembly transformer singleton and the orientation algebra.
 *
 * A rotation or a flip of a JPEG XL file only changes the Exif orientation tag
 * of the image header; the pixels stay untouched and decoders apply the
 * transform on display. `--set-orientation` replaces the tag, so a transform
 * that should turn the *displayed* image has to be composed with the tag that
 * is already there. The eight tags form the symmetry group of the square:
 * every tag is a quarter-turn rotation R (90 degrees clockwise) applied after
 * an optional mirror M of the x axis, written D = R^r o M^f.
 */

/**
 * File extensions that are treated as JPEG XL input.
 * @type {Set<string>}
 */
const JXL_EXTENSIONS = new Set([".jxl"]);

/**
 * Every orientation tag as the pair (rotation, mirror) of its display
 * transform D = R^r o M^f (the mirror runs first, the rotation after it).
 * @type {Record<number, [number, number]>}
 */
const ORIENTATION_RF = Object.freeze({
  1: [0, 0],
  2: [0, 1],
  3: [2, 0],
  4: [2, 1],
  5: [3, 1],
  6: [1, 0],
  7: [1, 1],
  8: [3, 0],
});

/**
 * The loaded transformer, shared by every transform in this process.
 * @type {Promise<object>|null}
 */
let transformerPromise = null;

/**
 * Reports whether a path names a JPEG XL file, judged by its extension.
 * @param {string} filePath - Absolute path of the file.
 * @returns {boolean} true when the extension is `.jxl`.
 */
function isJxlPath(filePath) {
  return JXL_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Loads the @chimok/jxltran-js WebAssembly module once and caches it. A failed
 * load is not cached, so the next transform tries again.
 * @returns {Promise<object>} The transformer from @chimok/jxltran-js.
 */
async function loadJxlTransformer() {
  if (transformerPromise === null) {
    transformerPromise = createJxlTran().catch((error) => {
      transformerPromise = null;
      throw error;
    });
  }
  return transformerPromise;
}

/**
 * Composes an orientation tag with a transform of the displayed image. The
 * result is the tag whose display transform equals the requested transform
 * applied on top of the current one: D(result) = op o D(current).
 *
 * The mirror and the rotation anti-commute (mirroring turns a clockwise
 * quarter turn into a counter-clockwise one), which is what the rotation term
 * of the formula relies on.
 *
 * @param {number} current - Current orientation tag (1-8).
 * @param {[number, number]} op - Requested transform as [rotation, mirror] (a quarter-turn count for R, 0 or 1 for M).
 * @returns {number} The orientation tag (1-8) that applies the transform on top of the current one.
 */
function composeOrientation(current, op) {
  const [rt, ft] = ORIENTATION_RF[current] ?? ORIENTATION_RF[1];
  const [ro, fo] = op;
  const rotation = (((ro + (fo % 2 === 0 ? rt : -rt)) % 4) + 4) % 4;
  const mirror = (fo + ft) % 2;
  const tag = Object.keys(ORIENTATION_RF).find(
    (key) => ORIENTATION_RF[key][0] === rotation && ORIENTATION_RF[key][1] === mirror,
  );
  return Number(tag);
}

/**
 * Reads a JPEG XL file together with its stat and its header information, so
 * the caller knows the display dimensions, the orientation tag and whether the
 * file is animated.
 * @param {string} filePath - Absolute path of the JPEG XL file.
 * @param {object} fileSystem - fs/promises-compatible module.
 * @returns {Promise<{ok: true, stat: object, bytes: Uint8Array, info: object} | {ok: false, code: 'not-jxl'|'transform'|'io', detail?: string}>} File content and header info, or an error result.
 */
async function readJxlInfo(filePath, fileSystem = fsp) {
  const input = await readSourceFile(filePath, JXL_EXTENSIONS, fileSystem);
  if (!input.ok)
    return input.code === "unsupported-format" ? { ok: false, code: "not-jxl" } : input;

  try {
    const transformer = await loadJxlTransformer();
    return { ...input, info: transformer.info(input.bytes) };
  } catch (error) {
    const detail = (error?.message ?? String(error)).trim();
    return { ok: false, code: "transform", detail };
  }
}

/**
 * Reports whether a JPEG XL file is animated. Every other format is treated as
 * a still image, so the caller can hide the crop tool for animations.
 * @param {string} filePath - Absolute path of the file.
 * @returns {Promise<{ok: true, animated: boolean} | {ok: false, code: string, detail?: string}>} Animation state or an error result.
 */
async function jxlCapabilities(filePath) {
  const input = await readJxlInfo(filePath);
  if (!input.ok) return input;
  return { ok: true, animated: input.info.animation === true };
}

export {
  composeOrientation,
  isJxlPath,
  JXL_EXTENSIONS,
  jxlCapabilities,
  loadJxlTransformer,
  ORIENTATION_RF,
  readJxlInfo,
};
