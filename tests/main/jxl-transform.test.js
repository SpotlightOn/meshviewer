import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeOrientation,
  hiddenRegion,
  isJxlPath,
  jxlCapabilities,
  readJxlInfo,
} from "../../src/jxl-transform.js";
import { jxlCropOf } from "./helpers/jxl.js";

/**
 * The still sample: 256x256, lossy, alpha, orientation tag 1, bare codestream.
 * @type {URL}
 */
const STILL = new URL("./fixtures/jxl-lenna.jxl", import.meta.url);

/** The animated sample: 64x64, three frames. @type {URL} */
const ANIM = new URL("./fixtures/jxl-anim.jxl", import.meta.url);

let dir;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-jxl-transform-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isJxlPath", () => {
  it("accepts the .jxl extension in any case", () => {
    expect(isJxlPath("/tmp/photo.jxl")).toBe(true);
    expect(isJxlPath("/tmp/photo.JXL")).toBe(true);
  });

  it("rejects every other extension", () => {
    expect(isJxlPath("/tmp/photo.jpg")).toBe(false);
    expect(isJxlPath("/tmp/photo.png")).toBe(false);
    expect(isJxlPath("/tmp/photo")).toBe(false);
  });
});

describe("composeOrientation", () => {
  it("turns the displayed image clockwise through the rotation tags", () => {
    expect(composeOrientation(1, [1, 0])).toBe(6);
    expect(composeOrientation(6, [1, 0])).toBe(3);
    expect(composeOrientation(3, [1, 0])).toBe(8);
    expect(composeOrientation(8, [1, 0])).toBe(1);
  });

  it("turns the mirrored tags through the other rotation cycle", () => {
    expect(composeOrientation(2, [1, 0])).toBe(7);
    expect(composeOrientation(7, [1, 0])).toBe(4);
    expect(composeOrientation(4, [1, 0])).toBe(5);
    expect(composeOrientation(5, [1, 0])).toBe(2);
  });

  it("mirrors the displayed image", () => {
    expect(composeOrientation(1, [0, 1])).toBe(2);
    expect(composeOrientation(2, [0, 1])).toBe(1);
    expect(composeOrientation(1, [2, 1])).toBe(4);
    expect(composeOrientation(4, [2, 1])).toBe(1);
    expect(composeOrientation(6, [0, 1])).toBe(5);
  });

  it("falls back to the identity tag for an unknown current tag", () => {
    expect(composeOrientation(undefined, [1, 0])).toBe(6);
    expect(composeOrientation(99, [0, 1])).toBe(2);
  });

  it("always lands on one of the eight tags", () => {
    const ops = [
      [0, 1],
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
    ];
    for (let current = 1; current <= 8; current += 1) {
      for (const op of ops) {
        expect(composeOrientation(current, op)).toBeGreaterThanOrEqual(1);
        expect(composeOrientation(current, op)).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe("readJxlInfo", () => {
  it("reports the display size, the orientation tag and the animation state", async () => {
    await copyFile(STILL, join(dir, "still.jxl"));
    await copyFile(ANIM, join(dir, "anim.jxl"));

    const still = await readJxlInfo(join(dir, "still.jxl"));
    expect(still).toMatchObject({
      ok: true,
      info: { width: 256, height: 256, orientation: 1, animation: false },
    });

    const anim = await readJxlInfo(join(dir, "anim.jxl"));
    expect(anim).toMatchObject({
      ok: true,
      info: { width: 64, height: 64, orientation: 1, animation: true },
    });
  });

  it("rejects files that are not JPEG XLs", async () => {
    await expect(readJxlInfo(join(dir, "photo.jpg"))).resolves.toEqual({
      ok: false,
      code: "not-jxl",
    });
  });

  it("reports a file with a JPEG XL extension that is no JPEG XL", async () => {
    const filePath = join(dir, "broken.jxl");
    await writeFile(filePath, "definitely not a jpeg xl");
    const result = await readJxlInfo(filePath);
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(result.detail).toContain("not a JPEG XL");
  });

  it("reports a missing input file", async () => {
    await expect(readJxlInfo(join(dir, "missing.jxl"))).resolves.toMatchObject({
      ok: false,
      code: "io",
    });
  });
});

describe("hiddenRegion", () => {
  /**
   * Builds header information for a still image.
   * @param {{width: number, height: number}} canvas - Canvas size.
   * @param {{x: number, y: number, width: number, height: number}} frame - Frame rectangle.
   * @returns {object} Fake header information.
   */
  function info(canvas, frame) {
    return { ...canvas, orientation: 1, animation: false, frames: [{ index: 0, ...frame }] };
  }

  it("reports nothing for a file that shows the whole frame", () => {
    const region = hiddenRegion(
      info({ width: 256, height: 256 }, { x: 0, y: 0, width: 256, height: 256 }),
    );
    expect(region).toBe(null);
  });

  it("reports nothing for a padded canvas that holds the frame", () => {
    const region = hiddenRegion(
      info({ width: 300, height: 300 }, { x: 20, y: 20, width: 200, height: 200 }),
    );
    expect(region).toBe(null);
  });

  it("reports the frame of a cropped file, including negative offsets", () => {
    const region = hiddenRegion(
      info({ width: 100, height: 80 }, { x: -10, y: -20, width: 256, height: 256 }),
    );
    expect(region).toEqual({ x: -10, y: -20, width: 256, height: 256 });
  });

  it("reports a frame that only reaches beyond one border", () => {
    const region = hiddenRegion(
      info({ width: 256, height: 100 }, { x: 0, y: -20, width: 256, height: 256 }),
    );
    expect(region).toEqual({ x: 0, y: -20, width: 256, height: 256 });
  });

  it("reports nothing for an animation", () => {
    const animated = info({ width: 32, height: 32 }, { x: -8, y: -8, width: 64, height: 64 });
    animated.animation = true;
    expect(hiddenRegion(animated)).toBe(null);
  });

  it("reports nothing when the frame is missing or unusable", () => {
    expect(hiddenRegion({ width: 100, height: 100, frames: [] })).toBe(null);
    expect(hiddenRegion({ width: 100, height: 100 })).toBe(null);
    expect(hiddenRegion(null)).toBe(null);
    const empty = hiddenRegion(
      info({ width: 100, height: 100 }, { x: -10, y: 0, width: 0, height: 10 }),
    );
    expect(empty).toBe(null);
    const fractional = hiddenRegion(
      info({ width: 100, height: 100 }, { x: -10.5, y: 0, width: 200, height: 200 }),
    );
    expect(fractional).toBe(null);
  });
});

describe("jxlCapabilities", () => {
  it("reports a still image as not animated and without a hidden area", async () => {
    await copyFile(STILL, join(dir, "still.jxl"));
    await expect(jxlCapabilities(join(dir, "still.jxl"))).resolves.toEqual({
      ok: true,
      animated: false,
      undoable: false,
    });
  });

  it("reports a cropped file as undoable", async () => {
    const still = new Uint8Array(await readFile(STILL));
    await writeFile(
      join(dir, "cropped.jxl"),
      await jxlCropOf(still, { x: 10, y: 20, width: 100, height: 80 }),
    );
    await expect(jxlCapabilities(join(dir, "cropped.jxl"))).resolves.toEqual({
      ok: true,
      animated: false,
      undoable: true,
    });
  });

  it("reports an animation as animated and without a hidden area", async () => {
    await copyFile(ANIM, join(dir, "anim.jxl"));
    await expect(jxlCapabilities(join(dir, "anim.jxl"))).resolves.toEqual({
      ok: true,
      animated: true,
      undoable: false,
    });
  });

  it("reports a missing file instead of throwing", async () => {
    await expect(jxlCapabilities(join(dir, "missing.jxl"))).resolves.toMatchObject({
      ok: false,
      code: "io",
    });
  });
});
