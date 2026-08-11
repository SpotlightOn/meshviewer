/**
 * MIME types for supported image file extensions.
 * @type {Record<string, string>}
 */
const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Formats a file size in bytes as readable text.
 * @param {number} bytes - Size in bytes.
 * @returns {string} Formatted size (B/KB/MB).
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Determines the MIME type of a file based on its extension.
 * @param {string} filename - File name.
 * @returns {string} MIME type or 'application/octet-stream'.
 */
function mimeFor(filename) {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return IMAGE_MIME[ext] || "application/octet-stream";
}

/**
 * Normalizes IPC data into an ArrayBuffer.
 * @param {ArrayBuffer|{buffer: ArrayBuffer, byteOffset: number, byteLength: number}} data - ArrayBuffer or Buffer-like object.
 * @returns {ArrayBuffer} The underlying ArrayBuffer.
 */
function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export { formatSize, IMAGE_MIME, mimeFor, toArrayBuffer };
