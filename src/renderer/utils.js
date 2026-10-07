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

/**
 * Starts the exit animation of the `.large-frame` elements left in a container
 * and removes each of them when its animation ended, or after the configured
 * duration plus a grace period as a safety net. The frame that was just added
 * is passed as `keep` and is never retired.
 * @param {HTMLElement} container - Element holding the frames.
 * @param {{direction: number, slide: boolean, durationMs: number, keep?: HTMLElement}} options - Navigation direction (1 forward, -1 backward, 0 none), whether the slide transition is active, the animation duration in milliseconds and the frame to keep.
 * @returns {void}
 */
function retireFrames(container, { direction, slide, durationMs, keep = null }) {
  const leaving = [
    ...container.querySelectorAll(".large-frame:not(.leave-slide):not(.leave-fade)"),
  ].filter((frame) => frame !== keep);
  for (const frame of leaving) {
    frame.classList.remove("enter-slide", "enter-fade");
    frame.classList.add(slide ? "leave-slide" : "leave-fade");
    if (slide) frame.style.setProperty("--slide-dir", direction < 0 ? "-1" : "1");
    const remove = () => frame.remove();
    frame.addEventListener(
      "animationend",
      (event) => {
        if (event.target === frame) remove();
      },
      { once: true },
    );
    setTimeout(remove, Math.max(0, durationMs) + 200);
  }
}

export { formatSize, IMAGE_MIME, mimeFor, retireFrames, toArrayBuffer };
