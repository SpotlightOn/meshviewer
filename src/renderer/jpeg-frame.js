/**
 * Reader for the frame header of a JPEG. The crop geometry in the renderer and
 * the tests of the lossless transforms both need the pixel dimensions and the
 * iMCU grid, so they share this walk over the marker chain.
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

/**
 * Reads the first frame header of a JPEG.
 * @param {Uint8Array} bytes - Content of the JPEG file.
 * @returns {{width: number, height: number, imcu: {width: number, height: number}}|null} Pixel dimensions and iMCU grid, or null when the bytes carry no readable frame header.
 */
function readJpegFrame(bytes) {
  if (!bytes || bytes.length < 4) return null;

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
      if (components === 0) return null;
      let maxHorizontal = 0;
      let maxVertical = 0;
      for (let index = 0; index < components; index += 1) {
        const sampling = bytes[offset + 11 + index * 3];
        maxHorizontal = Math.max(maxHorizontal, sampling >> 4);
        maxVertical = Math.max(maxVertical, sampling & 0x0f);
      }
      if (maxHorizontal === 0 || maxVertical === 0) return null;
      return {
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        imcu: { width: 8 * maxHorizontal, height: 8 * maxVertical },
      };
    }
    offset += 2 + length;
  }
  return null;
}

export { readJpegFrame };
