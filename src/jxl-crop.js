import fsp from "node:fs/promises";
import path from "node:path";
import { cropPathFor, normalizeRect, writeAtomically } from "./image-transform.js";
import { loadJxlTransformer, readJxlInfo } from "./jxl-transform.js";

/**
 * Crops JPEG XL bytes in memory through the @chimok/jxltran-js API. The crop
 * is a reversible, metadata-only resize of the canvas: the codestream is never
 * decoded or recompressed, so the quality stays exactly as it was and every
 * metadata box is kept.
 *
 * The region is given in display space (as decoders show the image after the
 * orientation tag), which is exactly what the renderer picks, so no mapping
 * onto stored pixels is needed. Any pixel rectangle is accepted; the
 * orientation tag of the file survives the crop unchanged.
 *
 * @param {Uint8Array} bytes - Content of the JPEG XL file.
 * @param {{x: number, y: number, width: number, height: number}} rect - Region to keep, in displayed pixels.
 * @returns {Promise<{data: Uint8Array}>} Cropped bytes.
 */
async function cropBytes(bytes, rect) {
  const transformer = await loadJxlTransformer();
  const { data } = transformer.crop(bytes, rect);
  return { data };
}

/**
 * Crops a JPEG XL file losslessly into a new file next to it, leaving the
 * source untouched. The output is named `<basename>-crop-<n>.jxl`, keeps the
 * permission bits and every metadata box of the source, and stays inside the
 * image - unlike the command line tool, a region that reaches beyond the image
 * borders is rejected instead of padded.
 *
 * @param {string} filePath - Absolute path of the JPEG XL file.
 * @param {{x: number, y: number, width: number, height: number}} rect - Region to keep, in displayed pixels.
 * @param {{crop?: (bytes: Uint8Array, rect: object) => {data: Uint8Array} | Promise<{data: Uint8Array}>, fs?: object}} [options] - Injectable dependencies for tests.
 * @returns {Promise<{ok: true, path: string, name: string, size: number, mtimeMs: number, width: number, height: number} | {ok: false, code: 'invalid-rect'|'not-jxl'|'animated'|'transform'|'io', detail?: string}>} Crop result.
 */
async function cropJxl(filePath, rect, options = {}) {
  const crop = options.crop ?? cropBytes;
  const fileSystem = options.fs ?? fsp;

  const region = normalizeRect(rect);
  if (region === null) return { ok: false, code: "invalid-rect" };

  const input = await readJxlInfo(filePath, fileSystem);
  if (!input.ok) return input;

  if (input.info.animation === true) return { ok: false, code: "animated" };
  if (region.x + region.width > input.info.width || region.y + region.height > input.info.height) {
    return { ok: false, code: "invalid-rect", detail: "the region lies outside the image" };
  }

  let cropped;
  try {
    cropped = await crop(input.bytes, region);
  } catch (error) {
    const detail = (error?.message ?? String(error)).trim();
    return { ok: false, code: "transform", detail };
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
      width: region.width,
      height: region.height,
    };
  } catch (error) {
    return { ok: false, code: "io", detail: error?.message ?? String(error) };
  }
}

export { cropJxl };
