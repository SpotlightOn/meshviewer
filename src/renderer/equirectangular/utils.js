import { clampZoomPercent, MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT } from "../utils.js";

/**
 * Raster ("pixmap") image extensions that can be mapped onto an
 * equirectangular sphere. Vector (SVG) and icon (ICO) formats are excluded.
 * @type {Set<string>}
 */
const PIXMAP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp"]);

/**
 * Whether a file name has a raster image extension that supports the
 * equirectangular panorama mode.
 * @param {string} filename - File name.
 * @returns {boolean} true for pixmap formats.
 */
function isPixmap(filename) {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();
  return PIXMAP_EXTENSIONS.has(ext);
}

/**
 * Smallest field of view in degrees of the equirectangular panorama, reached
 * at the highest zoom.
 * @type {number}
 */
const EQUIRECT_FOV_MIN = 10;

/**
 * Largest field of view in degrees of the equirectangular panorama, reached
 * at the lowest zoom.
 * @type {number}
 */
const EQUIRECT_FOV_MAX = 75;

/**
 * Converts a zoom percentage to an equirectangular camera field of view,
 * where 100 % is the initial panorama view and higher percentages zoom in.
 * @param {number} percent - Zoom in percent.
 * @returns {number} Field of view in degrees.
 */
function fovForPercent(percent) {
  const clamped = clampZoomPercent(percent);
  return (
    EQUIRECT_FOV_MAX -
    ((clamped - MIN_ZOOM_PERCENT) * (EQUIRECT_FOV_MAX - EQUIRECT_FOV_MIN)) /
      (MAX_ZOOM_PERCENT - MIN_ZOOM_PERCENT)
  );
}

/**
 * Converts an equirectangular camera field of view to a zoom percentage
 * within the slider range.
 * @param {number} fov - Field of view in degrees.
 * @returns {number} Zoom in percent.
 */
function percentForFov(fov) {
  const clamped = Math.min(EQUIRECT_FOV_MAX, Math.max(EQUIRECT_FOV_MIN, fov));
  return clampZoomPercent(
    Math.round(
      MIN_ZOOM_PERCENT +
        ((EQUIRECT_FOV_MAX - clamped) * (MAX_ZOOM_PERCENT - MIN_ZOOM_PERCENT)) /
          (EQUIRECT_FOV_MAX - EQUIRECT_FOV_MIN),
    ),
  );
}

export { EQUIRECT_FOV_MAX, EQUIRECT_FOV_MIN, fovForPercent, isPixmap, percentForFov };
