/**
 * Small readers for JPEG bytes, used by the tests that check the output of a
 * lossless transform without pulling in an image library.
 */

/**
 * Frame-header markers that are not an SOF: the Huffman tables, the JPG
 * extension and the arithmetic conditioning table.
 * @type {Set<number>}
 */
const SOF_EXCEPTIONS = new Set([0xc4, 0xc8, 0xcc]);

/**
 * Reads the pixel dimensions from the frame header of a JPEG.
 * @param {Buffer} bytes - JPEG file content.
 * @returns {{width: number, height: number}} Dimensions stored in the frame header.
 */
function jpegSize(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && !SOF_EXCEPTIONS.has(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error("no JPEG frame header found");
}

/**
 * Reports whether a JPEG carries a JFIF block. The module keeps it only when it
 * is asked to copy every marker, so this also checks that `COPY.all` is used.
 * @param {Buffer} bytes - JPEG file content.
 * @returns {boolean} true when the JFIF marker is present.
 */
function hasJfif(bytes) {
  return bytes.includes("JFIF");
}

export { hasJfif, jpegSize };
