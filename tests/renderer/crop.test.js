import { describe, expect, it } from "vitest";
import {
  displayGrid,
  displaySize,
  imcuSize,
  orientRegion,
  snapRegion,
} from "../../src/renderer/crop.js";

/**
 * The first 39 bytes of a JPEG written by `cjpeg -sample 2x2`: SOI, APP0 and the
 * frame header of a 32x24 4:2:0 image. Kept as a literal so the iMCU parser is
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
 * Builds a minimal JPEG with a frame header that carries the given sampling
 * factors, so the parser can be exercised without image files.
 * @param {Array<number>} sampling - Sampling byte per component, e.g. 0x22.
 * @returns {Uint8Array} JPEG bytes with SOI, APP0, a frame header and EOI.
 */
function jpegWithSampling(sampling) {
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
  bytes.push(
    0xff,
    0xc0,
    (length >> 8) & 0xff,
    length & 0xff,
    8,
    0x00,
    0x40,
    0x00,
    0x40,
    sampling.length,
  );
  for (const value of sampling) bytes.push(0x01, value, 0x00);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

describe("imcuSize", () => {
  it("reads 4:2:0 from a header a real encoder wrote", () => {
    expect(imcuSize(hexBytes(REAL_420_HEADER))).toEqual({ width: 16, height: 16 });
  });

  it("derives the grid from the sampling factors", () => {
    expect(imcuSize(jpegWithSampling([0x11, 0x11, 0x11]))).toEqual({ width: 8, height: 8 });
    expect(imcuSize(jpegWithSampling([0x21, 0x11, 0x11]))).toEqual({ width: 16, height: 8 });
    expect(imcuSize(jpegWithSampling([0x22, 0x11, 0x11]))).toEqual({ width: 16, height: 16 });
    expect(imcuSize(jpegWithSampling([0x41, 0x11, 0x11]))).toEqual({ width: 32, height: 8 });
  });

  it("uses the largest sampling factor of the components", () => {
    expect(imcuSize(jpegWithSampling([0x11, 0x22, 0x11]))).toEqual({ width: 16, height: 16 });
  });

  it("treats a single component image as 8x8", () => {
    expect(imcuSize(jpegWithSampling([0x11]))).toEqual({ width: 8, height: 8 });
  });

  it("falls back to 8x8 when there is no frame header", () => {
    expect(imcuSize(new Uint8Array([]))).toEqual({ width: 8, height: 8 });
    expect(imcuSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toEqual({ width: 8, height: 8 });
    expect(imcuSize(new TextEncoder().encode("not a jpeg at all"))).toEqual({
      width: 8,
      height: 8,
    });
  });
});

describe("snapRegion", () => {
  const grid = { width: 16, height: 16 };
  const bounds = { width: 100, height: 80 };

  it("moves the origin down and the far edges up to the grid", () => {
    expect(snapRegion({ x: 20, y: 20, width: 30, height: 30 }, grid, bounds)).toEqual({
      x: 16,
      y: 16,
      width: 48,
      height: 48,
    });
  });

  it("leaves a region that already sits on the grid", () => {
    expect(snapRegion({ x: 32, y: 16, width: 32, height: 16 }, grid, bounds)).toEqual({
      x: 32,
      y: 16,
      width: 32,
      height: 16,
    });
  });

  it("keeps an edge that reaches the image border there", () => {
    expect(snapRegion({ x: 0, y: 0, width: 100, height: 80 }, grid, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
    expect(snapRegion({ x: 16, y: 16, width: 90, height: 70 }, grid, bounds)).toEqual({
      x: 16,
      y: 16,
      width: 84,
      height: 64,
    });
  });

  it("never leaves the image", () => {
    const snapped = snapRegion({ x: 95, y: 75, width: 20, height: 20 }, grid, bounds);
    expect(snapped.x + snapped.width).toBeLessThanOrEqual(bounds.width);
    expect(snapped.y + snapped.height).toBeLessThanOrEqual(bounds.height);
  });

  it("keeps at least one grid cell", () => {
    expect(snapRegion({ x: 4, y: 4, width: 2, height: 2 }, grid, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });

  it("uses the grid it is given", () => {
    expect(
      snapRegion({ x: 10, y: 10, width: 4, height: 4 }, { width: 8, height: 8 }, bounds),
    ).toEqual({
      x: 8,
      y: 8,
      width: 8,
      height: 8,
    });
  });
});

describe("orientRegion", () => {
  const stored = { width: 40, height: 24 };

  it("maps the whole displayed image back to the whole stored image", () => {
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const display = displaySize(stored, orientation);
      const region = { x: 0, y: 0, width: display.width, height: display.height };
      expect(orientRegion(region, orientation, stored)).toEqual({
        x: 0,
        y: 0,
        width: 40,
        height: 24,
      });
    }
  });

  it("keeps the region for orientation 1", () => {
    expect(orientRegion({ x: 8, y: 16, width: 16, height: 8 }, 1, stored)).toEqual({
      x: 8,
      y: 16,
      width: 16,
      height: 8,
    });
  });

  it("turns the region by 180 degrees", () => {
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 3, stored)).toEqual({
      x: 32,
      y: 16,
      width: 8,
      height: 8,
    });
  });

  it("maps the top left corner of a 90 degree clockwise display to the bottom left", () => {
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 6, stored)).toEqual({
      x: 0,
      y: 16,
      width: 8,
      height: 8,
    });
  });

  it("maps the top left corner of a 90 degree counter-clockwise display to the top right", () => {
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 8, stored)).toEqual({
      x: 32,
      y: 0,
      width: 8,
      height: 8,
    });
  });

  it("maps the top left corner of a transposed display to the top left", () => {
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 5, stored)).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 8,
    });
  });

  it("mirrors the region for the mirroring orientations", () => {
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 2, stored)).toEqual({
      x: 32,
      y: 0,
      width: 8,
      height: 8,
    });
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 4, stored)).toEqual({
      x: 0,
      y: 16,
      width: 8,
      height: 8,
    });
    expect(orientRegion({ x: 0, y: 0, width: 8, height: 8 }, 7, stored)).toEqual({
      x: 32,
      y: 16,
      width: 8,
      height: 8,
    });
  });

  it("falls back to the identity for an unknown orientation", () => {
    expect(orientRegion({ x: 8, y: 8, width: 8, height: 8 }, 0, stored)).toEqual({
      x: 8,
      y: 8,
      width: 8,
      height: 8,
    });
  });
});

describe("displayGrid and displaySize", () => {
  it("swaps the axes for the orientations that rotate by 90 or 270 degrees", () => {
    expect(displayGrid({ width: 16, height: 8 }, 1)).toEqual({ width: 16, height: 8 });
    expect(displayGrid({ width: 16, height: 8 }, 6)).toEqual({ width: 8, height: 16 });
    expect(displaySize({ width: 40, height: 24 }, 8)).toEqual({ width: 24, height: 40 });
    expect(displaySize({ width: 40, height: 24 }, 3)).toEqual({ width: 40, height: 24 });
  });
});
