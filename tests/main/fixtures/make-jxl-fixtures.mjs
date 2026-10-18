import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CONTAINER, createJxlTran, ORIENTATION } from "@chimok/jxltran-js";

/**
 * Derives the committed JPEG XL fixtures from the two base files next to this
 * script, so every fixture can be rebuilt:
 *
 * - `jxl-lenna.jxl` (256x256, lossy, alpha, orientation 1, bare codestream) and
 *   `jxl-anim.jxl` (64x64, three frames) are copies of the sample fixtures of
 *   the `jxltran-js` project itself (Lenna test image, Wikipedia CC BY-SA 4.0).
 * - `jxl-oriented6.jxl` is the still sample with its orientation tag set to 6
 *   (displayed rotated by 90 degrees clockwise).
 * - `jxl-container.jxl` is the still sample wrapped into an ISOBMFF container
 *   with an EXIF box, so the transforms can be checked for box preservation.
 *
 * Run with `node tests/main/fixtures/make-jxl-fixtures.mjs`.
 */

const here = new URL(".", import.meta.url);

/** An empty big-endian TIFF, the payload of the EXIF box of the container fixture. */
const EMPTY_TIFF = new Uint8Array([
  0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/**
 * Reads a fixture next to this script.
 * @param {string} name - File name.
 * @returns {Promise<Uint8Array>} File content.
 */
async function readFixture(name) {
  return new Uint8Array(await readFile(new URL(name, here)));
}

/**
 * Writes a fixture next to this script.
 * @param {string} name - File name.
 * @param {Uint8Array} bytes - File content.
 * @returns {Promise<void>}
 */
async function writeFixture(name, bytes) {
  await writeFile(new URL(name, here), bytes);
}

/**
 * Builds the derived fixtures from the two base files.
 * @returns {Promise<void>}
 */
export async function makeJxlFixtures() {
  const transformer = await createJxlTran();
  const still = await readFixture("jxl-lenna.jxl");

  const oriented = transformer.setOrientation(still, ORIENTATION.rotate90);
  await writeFixture("jxl-oriented6.jxl", oriented.data);

  transformer.fs.writeFile("/fixture-exif.bin", EMPTY_TIFF);
  const boxed = transformer.container(still, CONTAINER.yes, {
    extraArgs: ["--set-exif=/fixture-exif.bin"],
  });
  await writeFixture("jxl-container.jxl", boxed.data);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  await makeJxlFixtures();
}
