import { readFile } from "node:fs/promises";
import { createJxlTran } from "@chimok/jxltran-js";

/**
 * Small readers for JPEG XL bytes, used by the tests that check the output of
 * a lossless transform through the real WebAssembly module.
 */

/** The shared transformer; the module is loaded once per test run. */
let transformerPromise = null;

/**
 * Loads the transformer of @chimok/jxltran-js once and caches it.
 * @returns {Promise<object>} The transformer.
 */
function loadTransformer() {
  transformerPromise ??= createJxlTran().catch((error) => {
    transformerPromise = null;
    throw error;
  });
  return transformerPromise;
}

/**
 * Reads the image header information of JPEG XL bytes.
 * @param {Uint8Array} bytes - JPEG XL file content.
 * @returns {Promise<{width: number, height: number, orientation: number, animation: boolean, alpha: boolean, frames: Array<object>}>} Display size, orientation tag, animation flag and frames.
 */
async function jxlInfoOf(bytes) {
  return (await loadTransformer()).info(bytes);
}

/**
 * Reads the image header information of a JPEG XL file.
 * @param {string} target - Absolute path of the file.
 * @returns {Promise<object>} The same values as {@link jxlInfoOf}.
 */
async function jxlInfo(target) {
  return jxlInfoOf(new Uint8Array(await readFile(target)));
}

/**
 * Reports whether JPEG XL bytes start with an ISOBMFF container instead of a
 * bare codestream: the JXL signature box, followed by the file type box.
 * @param {Buffer|Uint8Array} bytes - JPEG XL file content.
 * @returns {boolean} true when the file is wrapped in a container.
 */
function isContainer(bytes) {
  const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return box === "JXL " || box === "ftyp";
}

export { isContainer, jxlInfo, jxlInfoOf };
