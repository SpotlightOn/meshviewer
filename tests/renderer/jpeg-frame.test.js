import { describe, expect, it } from "vitest";
import { readJpegFrame } from "../../src/renderer/jpeg-frame.js";

/**
 * The first 39 bytes of a JPEG written by `cjpeg -sample 2x2`: SOI, APP0 and the
 * frame header of a 32x24 4:2:0 image. Kept as a literal so the parser is
 * checked against bytes a real encoder produced.
 * @type {string}
 */
const REAL_420_HEADER =
  "ffd8ffe000104a46494600010100000100010000ffc00011080018002003012200021101031101";

/**
 * Decodes a hex string into bytes.
 * @param {string} hex - Hex string with an even number of digits.
 * @returns {Uint8Array} Decoded bytes.
 */
function hexBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Builds a minimal JPEG with a frame header that carries the given dimensions
 * and sampling factors, so the parser can be exercised without image files.
 * @param {Array<number>} sampling - Sampling byte per component, e.g. 0x22.
 * @param {{width?: number, height?: number, markers?: Array<number>}} [options] - Frame dimensions and extra markers to insert before the frame header.
 * @returns {Uint8Array} JPEG bytes with SOI, APP0, a frame header and EOI.
 */
function jpegWithSampling(sampling, { width = 64, height = 64, markers = [] } = {}) {
  const length = 8 + sampling.length * 3;
  const bytes = [0xff, 0xd8];
  bytes.push(
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
  );
  bytes.push(...markers);
  bytes.push(
    0xff,
    0xc0,
    (length >> 8) & 0xff,
    length & 0xff,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    sampling.length,
  );
  for (const value of sampling) bytes.push(0x01, value, 0x00);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

describe("readJpegFrame", () => {
  it("reads the dimensions and the iMCU grid from a header a real encoder wrote", () => {
    expect(readJpegFrame(hexBytes(REAL_420_HEADER))).toEqual({
      width: 32,
      height: 24,
      imcu: { width: 16, height: 16 },
    });
  });

  it("derives the iMCU grid from the sampling factors", () => {
    expect(readJpegFrame(jpegWithSampling([0x11, 0x11, 0x11])).imcu).toEqual({
      width: 8,
      height: 8,
    });
    expect(readJpegFrame(jpegWithSampling([0x21, 0x11, 0x11])).imcu).toEqual({
      width: 16,
      height: 8,
    });
    expect(readJpegFrame(jpegWithSampling([0x22, 0x11, 0x11])).imcu).toEqual({
      width: 16,
      height: 16,
    });
    expect(readJpegFrame(jpegWithSampling([0x41, 0x11, 0x11])).imcu).toEqual({
      width: 32,
      height: 8,
    });
  });

  it("uses the largest sampling factor of the components", () => {
    expect(readJpegFrame(jpegWithSampling([0x11, 0x22, 0x11])).imcu).toEqual({
      width: 16,
      height: 16,
    });
  });

  it("treats a single component image as 8x8", () => {
    expect(readJpegFrame(jpegWithSampling([0x11])).imcu).toEqual({ width: 8, height: 8 });
  });

  it("reads the dimensions from the frame header", () => {
    expect(readJpegFrame(jpegWithSampling([0x11], { width: 320, height: 240 }))).toMatchObject({
      width: 320,
      height: 240,
    });
  });

  it("skips markers that stand alone", () => {
    const bytes = jpegWithSampling([0x22, 0x11, 0x11], { markers: [0xff, 0x01, 0xff, 0xd8] });
    expect(readJpegFrame(bytes)).toMatchObject({ width: 64, height: 64 });
  });

  it("returns null when there is no frame header", () => {
    expect(readJpegFrame(new Uint8Array([]))).toBeNull();
    expect(readJpegFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readJpegFrame(new TextEncoder().encode("not a jpeg at all"))).toBeNull();
  });
});
