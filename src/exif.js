import fsp from "node:fs/promises";
import ExifReader from "exifreader";

/**
 * Reads the metadata of an image file as EXIF tag groups.
 * The parsing runs in the main process, so the renderer only ever receives
 * the extracted tags instead of the raw file bytes.
 * @param {string} filePath - Absolute path of the image file.
 * @returns {Promise<object|null>} Tag groups keyed by group name (each group a
 *   map of tag name to tag object), or null when the file cannot be read or is
 *   not a parsable image.
 */
async function readExif(filePath) {
  try {
    const data = await fsp.readFile(filePath);
    const tags = await ExifReader.load(data, { expanded: true });
    return tags && typeof tags === "object" ? tags : null;
  } catch {
    return null;
  }
}

export { readExif };
