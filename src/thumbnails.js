import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import piexif from "piexifjs";

const THUMB_SIZE = 256;
const FREEDESKTOP_MAGIC = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);
const FREEDESKTOP_SIZES = ["large", "x-large", "normal", "xx-large"];
const EXIF_PREFIX_SIZE = 1024 * 1024; // embedded thumbnails live near the start of the file

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  // sharp may be unavailable on cross-built platforms (missing native binaries)
}

/**
 * Returns the freedesktop-compatible file URI for an absolute path.
 * Freedesktop thumbnail caches exist only on Linux desktops (KDE/GNOME/XFCE);
 * the lookup is skipped on other platforms. The encoding must match exactly
 * what the desktop environment produced, so it stays as-is for compatibility.
 * @param {string} absPath - Absolute file path.
 * @returns {string} file:// URI.
 */
function freedesktopUri(absPath) {
  return `file://${absPath.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Returns a PNG data URL from a freedesktop thumbnail cache (KDE/GNOME/XFCE).
 * @param {{path: string, mtimeMs: number}} file - Media file with stat info.
 * @returns {Promise<string|null>} PNG data URL, or null if no usable thumbnail exists.
 */
async function readFreedesktopThumbnail(file) {
  if (process.platform !== "linux") return null; // freedesktop caches exist only on Linux
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const variants = new Set([file.path]);
  try {
    variants.add(await fsp.realpath(file.path));
  } catch {
    // path no longer exists
  }
  for (const filePath of variants) {
    const hash = createHash("md5").update(freedesktopUri(filePath)).digest("hex");
    for (const size of FREEDESKTOP_SIZES) {
      const candidate = path.join(base, "thumbnails", size, `${hash}.png`);
      let thumbStat;
      try {
        thumbStat = await fsp.stat(candidate);
      } catch {
        continue;
      }
      if (thumbStat.mtimeMs <= file.mtimeMs) {
        continue; // thumbnail is older than the source file
      }
      const data = await fsp.readFile(candidate);
      const png = data.subarray(0, FREEDESKTOP_MAGIC.length).equals(FREEDESKTOP_MAGIC)
        ? data.subarray(FREEDESKTOP_MAGIC.length)
        : data;
      return `data:image/png;base64,${png.toString("base64")}`;
    }
  }
  return null;
}

/**
 * Extracts the embedded JPEG thumbnail from a JPEG file buffer.
 * @param {Buffer} buffer - JPEG file data.
 * @returns {Buffer|null} Thumbnail JPEG bytes, or null if none is present.
 */
function extractEmbeddedThumbnail(buffer) {
  try {
    const exif = piexif.load(buffer.toString("binary"));
    const thumbnail = exif.thumbnail;
    if (thumbnail == null || thumbnail.length === 0) return null;
    return Buffer.from(thumbnail, "binary");
  } catch {
    return null;
  }
}

/**
 * Reads a prefix of a file into a buffer.
 * @param {string} filePath - Absolute file path.
 * @param {number} bytes - Maximum number of bytes to read.
 * @returns {Promise<Buffer>} Read bytes.
 */
async function readFilePrefix(filePath, bytes) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Returns the embedded EXIF JPEG thumbnail of a JPEG file, or null.
 * @param {string} filePath - Absolute file path.
 * @returns {Promise<Buffer|null>} Thumbnail JPEG bytes, or null.
 */
async function readEmbeddedThumbnail(filePath) {
  try {
    const prefix = await readFilePrefix(filePath, EXIF_PREFIX_SIZE);
    return extractEmbeddedThumbnail(prefix);
  } catch {
    return null;
  }
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
 * Generates a thumbnail from an image file or buffer and stores it in the cache.
 * @param {string|Buffer} input - Image file path or image buffer.
 * @param {string} cacheFile - Target cache file.
 * @returns {Promise<void>}
 */
async function generateThumbnail(input, cacheFile) {
  await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
  await sharp(input, { failOn: "none", limitInputPixels: 100_000_000 })
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
  const desktop = await readFreedesktopThumbnail(file);
  if (desktop != null) {
    return desktop;
  }
  if (sharp == null) {
    return null;
  }
  try {
    const isJpeg =
      path.extname(file.path).toLowerCase() === ".jpg" ||
      path.extname(file.path).toLowerCase() === ".jpeg";
    if (isJpeg) {
      const embedded = await readEmbeddedThumbnail(file.path);
      if (embedded != null) {
        try {
          await generateThumbnail(embedded, cacheFile);
          return toDataUrl(await fsp.readFile(cacheFile));
        } catch {
          // embedded thumbnail unusable, fall through to full decode
        }
      }
    }
    await generateThumbnail(file.path, cacheFile);
    return toDataUrl(await fsp.readFile(cacheFile));
  } catch {
    return null;
  }
}

export {
  extractEmbeddedThumbnail,
  freedesktopUri,
  generateThumbnail,
  getThumbnail,
  readEmbeddedThumbnail,
  readFilePrefix,
  readFreedesktopThumbnail,
  THUMB_SIZE,
  thumbnailKey,
  toDataUrl,
};
