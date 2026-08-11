const { createHash } = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const THUMB_SIZE = 256;

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  // sharp may be unavailable on cross-built platforms (missing native binaries)
}

/**
 * Computes the cache file name for a media file.
 * @param {{path: string, size: number, mtimeMs: number}} file - Media file with stat info.
 * @returns {string} Cache file name (with .jpg extension).
 */
function thumbnailKey(file) {
  const hash = createHash("sha1")
    .update(`${file.path}\0${file.size}\0${file.mtimeMs}`)
    .digest("hex");
  return `${hash}.jpg`;
}

/**
 * Returns a JPEG data URL of a cached thumbnail.
 * @param {Buffer} data - JPEG thumbnail bytes.
 * @returns {string} Data URL.
 */
function toDataUrl(data) {
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}

/**
 * Generates a thumbnail for an image file and stores it in the cache.
 * @param {{path: string, size: number, mtimeMs: number}} file - Media file with stat info.
 * @param {string} cacheFile - Target cache file.
 * @returns {Promise<void>}
 */
async function generateThumbnail(file, cacheFile) {
  await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
  await sharp(file.path, { failOn: "none", limitInputPixels: 100_000_000 })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#3a3a3a" })
    .jpeg({ quality: 80, progressive: true })
    .toFile(cacheFile);
}

/**
 * Returns a JPEG data URL thumbnail for an image, generating it on a cache miss.
 * @param {{path: string, size: number, mtimeMs: number}} file - Media file with stat info.
 * @param {string} cacheDir - Directory that stores thumbnails.
 * @returns {Promise<string|null>} JPEG data URL, or null if generation is not possible.
 */
async function getThumbnail(file, cacheDir) {
  const cacheFile = path.join(cacheDir, thumbnailKey(file));
  try {
    return toDataUrl(await fsp.readFile(cacheFile));
  } catch {
    // cache miss
  }
  if (sharp == null) {
    return null;
  }
  try {
    await generateThumbnail(file, cacheFile);
    return toDataUrl(await fsp.readFile(cacheFile));
  } catch {
    return null;
  }
}

module.exports = {
  THUMB_SIZE,
  generateThumbnail,
  getThumbnail,
  thumbnailKey,
  toDataUrl,
};
