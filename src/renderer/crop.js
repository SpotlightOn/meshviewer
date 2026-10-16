/**
 * Pure geometry for the lossless JPEG crop: the iMCU grid of an image, snapping
 * a selection onto it and mapping the selection from the displayed image back
 * to the stored pixels.
 *
 * A lossless crop can only start on an iMCU boundary. The iMCU is
 * `8 * max horizontal sampling factor` by `8 * max vertical sampling factor`,
 * which is 8x8 for 4:4:4, 16x8 for 4:2:2 and 16x16 for the common 4:2:0.
 */

/**
 * Frame header markers (SOF), which carry the component sampling factors.
 * @type {Set<number>}
 */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Markers that stand alone, without a length field.
 * @type {Set<number>}
 */
const STANDALONE_MARKERS = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
]);

/** Grid assumed when the frame header cannot be read. */
const DEFAULT_IMCU = Object.freeze({ width: 8, height: 8 });

/**
 * Clamps a value into a range.
 * @param {number} value - Value to clamp.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} The clamped value.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds a value down to the next multiple of a step.
 * @param {number} value - Value to round.
 * @param {number} step - Grid step.
 * @returns {number} The rounded value.
 */
function floorTo(value, step) {
  return Math.floor(value / step) * step;
}

/**
 * Rounds a value up to the next multiple of a step.
 * @param {number} value - Value to round.
 * @param {number} step - Grid step.
 * @returns {number} The rounded value.
 */
function ceilTo(value, step) {
  return Math.ceil(value / step) * step;
}

/**
 * Rounds a value to the nearest multiple of a step.
 * @param {number} value - Value to round.
 * @param {number} step - Grid step.
 * @returns {number} The rounded value.
 */
function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Reads the iMCU size of a JPEG from its frame header. Anything that is not a
 * readable JPEG falls back to 8x8, the smallest possible iMCU.
 * @param {Uint8Array} bytes - Content of the JPEG file.
 * @returns {{width: number, height: number}} iMCU size in pixels.
 */
function imcuSize(bytes) {
  if (!bytes || bytes.length < 4) return { ...DEFAULT_IMCU };

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (STANDALONE_MARKERS.has(marker)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) {
      offset += 2;
      continue;
    }
    if (SOF_MARKERS.has(marker)) {
      const components = bytes[offset + 9];
      if (components === 0) return { ...DEFAULT_IMCU };
      let maxHorizontal = 0;
      let maxVertical = 0;
      for (let index = 0; index < components; index += 1) {
        const sampling = bytes[offset + 11 + index * 3];
        maxHorizontal = Math.max(maxHorizontal, sampling >> 4);
        maxVertical = Math.max(maxVertical, sampling & 0x0f);
      }
      if (maxHorizontal === 0 || maxVertical === 0) return { ...DEFAULT_IMCU };
      return { width: 8 * maxHorizontal, height: 8 * maxVertical };
    }
    offset += 2 + length;
  }
  return { ...DEFAULT_IMCU };
}

/**
 * Returns whether an EXIF orientation swaps the image axes.
 * @param {number} orientation - EXIF orientation value (1-8).
 * @returns {boolean} true for the orientations that rotate by 90 or 270 degrees.
 */
function swapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Returns the size the stored image is displayed with.
 * @param {{width: number, height: number}} stored - Dimensions of the stored pixels.
 * @param {number} orientation - EXIF orientation value (1-8).
 * @returns {{width: number, height: number}} Dimensions as displayed.
 */
function displaySize(stored, orientation) {
  return swapsAxes(orientation) ? { width: stored.height, height: stored.width } : { ...stored };
}

/**
 * Returns the iMCU grid as it appears in the displayed image. For the
 * orientations that swap the axes the steps swap with them.
 * @param {{width: number, height: number}} imcu - iMCU size of the stored image.
 * @param {number} orientation - EXIF orientation value (1-8).
 * @returns {{width: number, height: number}} Grid steps in displayed pixels.
 */
function displayGrid(imcu, orientation) {
  return swapsAxes(orientation) ? { width: imcu.height, height: imcu.width } : { ...imcu };
}

/**
 * Snaps a selection onto the grid and keeps it inside the image. The origin is
 * rounded down to the next grid line, the far edges are rounded up, except
 * where they already reach the image border. A region is never smaller than one
 * grid cell.
 * @param {{x: number, y: number, width: number, height: number}} region - Selection in pixels.
 * @param {{width: number, height: number}} grid - Grid steps.
 * @param {{width: number, height: number}} bounds - Image dimensions the region has to stay in.
 * @returns {{x: number, y: number, width: number, height: number}} Snapped selection.
 */
function snapRegion(region, grid, bounds) {
  const x = clamp(floorTo(region.x, grid.width), 0, bounds.width);
  const y = clamp(floorTo(region.y, grid.height), 0, bounds.height);

  const right = region.x + region.width;
  const bottom = region.y + region.height;
  const snappedRight =
    right >= bounds.width ? bounds.width : clamp(ceilTo(right, grid.width), x, bounds.width);
  const snappedBottom =
    bottom >= bounds.height ? bounds.height : clamp(ceilTo(bottom, grid.height), y, bounds.height);

  return {
    x,
    y,
    width: Math.max(snappedRight - x, Math.min(grid.width, bounds.width - x)),
    height: Math.max(snappedBottom - y, Math.min(grid.height, bounds.height - y)),
  };
}

/**
 * Maps a selection from the displayed image back to the stored pixels, using
 * the EXIF orientation that is applied for the display.
 * @param {{x: number, y: number, width: number, height: number}} region - Selection in displayed pixels.
 * @param {number} orientation - EXIF orientation value (1-8).
 * @param {{width: number, height: number}} stored - Dimensions of the stored pixels.
 * @returns {{x: number, y: number, width: number, height: number}} Selection in stored pixels.
 */
function orientRegion(region, orientation, stored) {
  const { x, y, width, height } = region;
  const { width: storedWidth, height: storedHeight } = stored;

  switch (orientation) {
    case 2:
      return { x: storedWidth - x - width, y, width, height };
    case 3:
      return { x: storedWidth - x - width, y: storedHeight - y - height, width, height };
    case 4:
      return { x, y: storedHeight - y - height, width, height };
    case 5:
      return { x: y, y: x, width: height, height: width };
    case 6:
      return { x: y, y: storedHeight - x - width, width: height, height: width };
    case 7:
      return {
        x: storedWidth - y - height,
        y: storedHeight - x - width,
        width: height,
        height: width,
      };
    case 8:
      return { x: storedWidth - y - height, y: x, width: height, height: width };
    default:
      return { x, y, width, height };
  }
}

/**
 * Builds a selection from two drag points, snapped onto the grid.
 * @param {{x: number, y: number}} from - Point where the drag started, in pixels.
 * @param {{x: number, y: number}} to - Current point, in pixels.
 * @param {{width: number, height: number}} grid - Grid steps.
 * @param {{width: number, height: number}} bounds - Image dimensions.
 * @returns {{x: number, y: number, width: number, height: number}} Snapped selection.
 */
function regionFromPoints(from, to, grid, bounds) {
  return snapRegion(
    {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    },
    grid,
    bounds,
  );
}

/**
 * Moves a selection by a pixel delta, keeping its size. The origin lands on the
 * grid and the region stays inside the image.
 * @param {{x: number, y: number, width: number, height: number}} region - Current selection.
 * @param {number} dx - Horizontal delta in pixels.
 * @param {number} dy - Vertical delta in pixels.
 * @param {{width: number, height: number}} grid - Grid steps.
 * @param {{width: number, height: number}} bounds - Image dimensions.
 * @returns {{x: number, y: number, width: number, height: number}} Moved selection.
 */
function moveRegion(region, dx, dy, grid, bounds) {
  const maxX = Math.max(0, bounds.width - region.width);
  const maxY = Math.max(0, bounds.height - region.height);
  return {
    x: clamp(roundTo(region.x + dx, grid.width), 0, maxX),
    y: clamp(roundTo(region.y + dy, grid.height), 0, maxY),
    width: region.width,
    height: region.height,
  };
}

/**
 * Resizes a selection by dragging one of its handles. Only the edges the handle
 * belongs to move, they land on the grid and stay inside the image.
 * @param {{x: number, y: number, width: number, height: number}} region - Current selection.
 * @param {string} handle - One of `n`, `s`, `e`, `w` or a combination like `nw`.
 * @param {number} dx - Horizontal delta in pixels.
 * @param {number} dy - Vertical delta in pixels.
 * @param {{width: number, height: number}} grid - Grid steps.
 * @param {{width: number, height: number}} bounds - Image dimensions.
 * @returns {{x: number, y: number, width: number, height: number}} Resized selection.
 */
function resizeRegion(region, handle, dx, dy, grid, bounds) {
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;

  if (handle.includes("w"))
    left = clamp(roundTo(left + dx, grid.width), 0, Math.max(0, right - grid.width));
  if (handle.includes("e"))
    right = clamp(
      roundTo(right + dx, grid.width),
      Math.min(bounds.width, left + grid.width),
      bounds.width,
    );
  if (handle.includes("n"))
    top = clamp(roundTo(top + dy, grid.height), 0, Math.max(0, bottom - grid.height));
  if (handle.includes("s"))
    bottom = clamp(
      roundTo(bottom + dy, grid.height),
      Math.min(bounds.height, top + grid.height),
      bounds.height,
    );

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export {
  displayGrid,
  displaySize,
  imcuSize,
  moveRegion,
  orientRegion,
  regionFromPoints,
  resizeRegion,
  snapRegion,
};
