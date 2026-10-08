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
 * ExifReader groups that only carry file-format data (file info, PNG chunks,
 * GIF header data, BMP header data) instead of EXIF metadata.
 * @type {Set<string>}
 */
const EXIF_FORMAT_GROUPS = new Set(["file", "png", "gif", "bmp"]);

/**
 * Whether an ExifReader group only carries file-format data. Groups named
 * like "pngFile" or "jpegFile" match by suffix, the rest by name.
 * @param {string} group - ExifReader group name.
 * @returns {boolean} true for format-only groups.
 */
function isExifFormatGroup(group) {
  return EXIF_FORMAT_GROUPS.has(group) || /File$/i.test(group);
}

/**
 * Splits an ExifReader tag name into a readable label
 * ("ExposureTime" -> "Exposure Time", "GPSPosition" -> "GPS Position").
 * @param {string} name - Raw ExifReader tag name.
 * @returns {string} Human-readable label.
 */
function exifTagLabel(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/**
 * Flattens an ExifReader tag into its display value, preferring the formatted
 * description and falling back to the raw value.
 * @param {{description?: *, value?: *}|*} tag - ExifReader tag object.
 * @returns {string} Display value, empty when the tag carries none.
 */
function exifTagValue(tag) {
  const raw = tag?.description ?? tag?.value;
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) {
    return raw
      .map((item) => exifTagValue({ value: item }))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof raw === "object") {
    const inner = raw.description ?? raw.value;
    return inner === undefined || inner === null ? "" : String(inner);
  }
  return String(raw);
}

/**
 * Converts expanded ExifReader tags into sections of display rows. Groups
 * that only hold file-format data are dropped, so an empty result means the
 * file carries no EXIF metadata.
 * @param {object|null} tags - Expanded ExifReader result.
 * @returns {Array<{group: string, rows: Array<{label: string, value: string}>}>} Sections with at least one row each.
 */
function exifToSections(tags) {
  if (!tags || typeof tags !== "object") return [];
  const sections = [];
  for (const [group, entries] of Object.entries(tags)) {
    if (isExifFormatGroup(group)) continue;
    if (!entries || typeof entries !== "object") continue;
    const rows = [];
    for (const [name, tag] of Object.entries(entries)) {
      const value = exifTagValue(tag);
      if (value === "") continue;
      rows.push({ label: exifTagLabel(name), value });
    }
    if (rows.length > 0) sections.push({ group, rows });
  }
  return sections;
}

/**
 * Builds the basic file information rows shown when a file has no EXIF data.
 * The label keys refer to the `info.*` translation namespace.
 * @param {{name: string, size: number, mtimeMs: number}} file - Media file entry.
 * @param {{width: number, height: number}} [imageSize] - Pixel size when known.
 * @returns {Array<{key: string, value: string}>} Rows with i18n label keys.
 */
function fileInfoRows(file, imageSize) {
  const rows = [{ key: "size", value: formatSize(file.size) }];
  if (imageSize && imageSize.width > 0 && imageSize.height > 0) {
    rows.push({ key: "dimensions", value: `${imageSize.width}x${imageSize.height}` });
  }
  rows.push({ key: "modified", value: new Date(file.mtimeMs).toLocaleString() });
  const dot = file.name.lastIndexOf(".");
  if (dot > -1 && dot < file.name.length - 1) {
    rows.push({ key: "type", value: file.name.slice(dot + 1).toUpperCase() });
  }
  return rows;
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
 * Smallest zoom of the large view as a scale factor (10 %).
 * @type {number}
 */
const MIN_ZOOM = 0.1;

/**
 * Largest zoom of the large view as a scale factor (800 %).
 * @type {number}
 */
const MAX_ZOOM = 8;

/**
 * Smallest zoom of the large-view slider in percent.
 * @type {number}
 */
const MIN_ZOOM_PERCENT = MIN_ZOOM * 100;

/**
 * Largest zoom of the large-view slider in percent.
 * @type {number}
 */
const MAX_ZOOM_PERCENT = MAX_ZOOM * 100;

/**
 * Clamps a scale factor to the large-view zoom range.
 * @param {number} scale - Scale factor (1 = 100 %).
 * @returns {number} Clamped scale factor.
 */
function clampZoom(scale) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Clamps a zoom percentage to the large-view slider range.
 * @param {number} percent - Zoom in percent.
 * @returns {number} Clamped percentage.
 */
function clampZoomPercent(percent) {
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, percent));
}

/**
 * Converts a scale factor to a whole percentage within the slider range.
 * @param {number} scale - Scale factor (1 = 100 %).
 * @returns {number} Zoom in percent.
 */
function zoomPercent(scale) {
  return Math.round(clampZoom(scale) * 100);
}

/**
 * Converts a zoom percentage to a clamped scale factor.
 * @param {number} percent - Zoom in percent.
 * @returns {number} Scale factor.
 */
function zoomScale(percent) {
  return clampZoom(percent / 100);
}

/**
 * Converts a zoom percentage to a GLB camera distance, where 100 % equals the
 * fitted distance and higher percentages move the camera closer.
 * @param {number} baseDistance - Camera distance at 100 %.
 * @param {number} percent - Zoom in percent.
 * @returns {number} Camera distance.
 */
function glbDistanceForPercent(baseDistance, percent) {
  return baseDistance * (100 / clampZoomPercent(percent));
}

/**
 * Converts a GLB camera distance to a zoom percentage within the slider range.
 * @param {number} baseDistance - Camera distance at 100 %.
 * @param {number} distance - Current camera distance.
 * @returns {number} Zoom in percent.
 */
function glbPercentForDistance(baseDistance, distance) {
  return clampZoomPercent(Math.round((baseDistance / Math.max(1e-9, distance)) * 100));
}

/**
 * Parses a zoom text input ("80", "120 %") into a whole percentage, or null
 * when the input is not a plain number.
 * @param {string} value - Raw input value.
 * @returns {number|null} Zoom percentage or null.
 */
function parseZoomPercent(value) {
  const text = value.trim();
  const digits = text.endsWith("%") ? text.slice(0, -1) : text;
  if (digits === "" || !/^[+-]?\d+(\.\d+)?$/.test(digits.trim())) return null;
  const number = Number(digits);
  return Number.isFinite(number) ? Math.round(number) : null;
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

export {
  clampZoom,
  clampZoomPercent,
  exifTagLabel,
  exifToSections,
  fileInfoRows,
  formatSize,
  glbDistanceForPercent,
  glbPercentForDistance,
  IMAGE_MIME,
  MAX_ZOOM,
  MAX_ZOOM_PERCENT,
  MIN_ZOOM,
  MIN_ZOOM_PERCENT,
  mimeFor,
  parseZoomPercent,
  retireFrames,
  toArrayBuffer,
  zoomPercent,
  zoomScale,
};
