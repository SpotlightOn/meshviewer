import { describe, expect, it } from "vitest";
import {
  displayGrid,
  displaySize,
  imcuSize,
  moveRegion,
  orientRegion,
  regionFromPoints,
  resizeRegion,
  snapRegion,
} from "../../src/renderer/crop.js";

/** Grid steps and image size used by the selection geometry tests. */
const grid = { width: 16, height: 16 };
const bounds = { width: 100, height: 80 };

describe("imcuSize", () => {
  it("reads the iMCU size from the frame header", () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00,
      0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
    ]);
    expect(imcuSize(bytes)).toEqual({ width: 16, height: 16 });
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

describe("regionFromPoints", () => {
  it("builds a snapped selection from the two drag points", () => {
    expect(regionFromPoints({ x: 10, y: 20 }, { x: 60, y: 70 }, grid, bounds)).toEqual({
      x: 0,
      y: 16,
      width: 64,
      height: 64,
    });
  });

  it("builds the same selection for a drag in any direction", () => {
    expect(regionFromPoints({ x: 60, y: 70 }, { x: 10, y: 20 }, grid, bounds)).toEqual(
      regionFromPoints({ x: 10, y: 20 }, { x: 60, y: 70 }, grid, bounds),
    );
  });

  it("keeps at least one grid cell for a click without a drag", () => {
    expect(regionFromPoints({ x: 50, y: 50 }, { x: 50, y: 50 }, grid, bounds)).toEqual({
      x: 48,
      y: 48,
      width: 16,
      height: 16,
    });
  });

  it("stops a drag past the image border at the border", () => {
    expect(regionFromPoints({ x: 90, y: 70 }, { x: 200, y: 200 }, grid, bounds)).toEqual({
      x: 80,
      y: 64,
      width: 20,
      height: 16,
    });
  });

  it("clamps a drag that starts outside the image", () => {
    expect(regionFromPoints({ x: 10, y: 20 }, { x: -30, y: -40 }, grid, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 32,
    });
  });

  it("keeps a selection that covers the whole image", () => {
    expect(regionFromPoints({ x: 0, y: 0 }, { x: 100, y: 80 }, grid, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });
});

describe("moveRegion", () => {
  it("moves the region by the delta and lands on the grid", () => {
    expect(moveRegion({ x: 32, y: 32, width: 32, height: 16 }, 10, -20, grid, bounds)).toEqual({
      x: 48,
      y: 16,
      width: 32,
      height: 16,
    });
  });

  it("stops the region at the bottom right border", () => {
    expect(moveRegion({ x: 64, y: 48, width: 32, height: 32 }, 100, 100, grid, bounds)).toEqual({
      x: 68,
      y: 48,
      width: 32,
      height: 32,
    });
  });

  it("stops the region at the top left corner", () => {
    expect(moveRegion({ x: 16, y: 16, width: 32, height: 16 }, -100, -100, grid, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 32,
      height: 16,
    });
  });
});

describe("resizeRegion", () => {
  const region = { x: 16, y: 16, width: 32, height: 16 };

  it("moves the dragged edges and lands on the grid", () => {
    expect(resizeRegion(region, "se", 10, 20, grid, bounds)).toEqual({
      x: 16,
      y: 16,
      width: 48,
      height: 32,
    });
  });

  it("moves both edges of a corner handle", () => {
    expect(resizeRegion(region, "nw", -20, -20, grid, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 32,
    });
    expect(resizeRegion(region, "ne", 10, -20, grid, bounds)).toEqual({
      x: 16,
      y: 0,
      width: 48,
      height: 32,
    });
  });

  it("leaves the edges alone that the handle does not belong to", () => {
    expect(resizeRegion(region, "s", 0, 100, grid, bounds)).toEqual({
      x: 16,
      y: 16,
      width: 32,
      height: 64,
    });
    expect(resizeRegion(region, "n", 0, -100, grid, bounds)).toEqual({
      x: 16,
      y: 0,
      width: 32,
      height: 32,
    });
  });

  it("stops a dragged edge at the image border", () => {
    expect(resizeRegion(region, "e", 100, 0, grid, bounds)).toEqual({
      x: 16,
      y: 16,
      width: 84,
      height: 16,
    });
  });

  it("keeps at least one grid cell when an edge is dragged over the opposite one", () => {
    expect(resizeRegion(region, "w", 100, 0, grid, bounds)).toEqual({
      x: 32,
      y: 16,
      width: 16,
      height: 16,
    });
  });

  it("keeps the region when the delta rounds to no grid step", () => {
    expect(resizeRegion(region, "nw", -3, -3, grid, bounds)).toEqual(region);
  });
});

describe("snapRegion", () => {
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
