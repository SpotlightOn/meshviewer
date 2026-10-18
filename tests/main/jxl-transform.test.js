import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeOrientation,
  isJxlPath,
  jxlCapabilities,
  readJxlInfo,
} from "../../src/jxl-transform.js";

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

describe("jxlCapabilities", () => {
  it("reports a still image as not animated", async () => {
    await copyFile(STILL, join(dir, "still.jxl"));
    await expect(jxlCapabilities(join(dir, "still.jxl"))).resolves.toEqual({
      ok: true,
      animated: false,
    });
  });

  it("reports an animation", async () => {
    await copyFile(ANIM, join(dir, "anim.jxl"));
    await expect(jxlCapabilities(join(dir, "anim.jxl"))).resolves.toEqual({
      ok: true,
      animated: true,
    });
  });

  it("reports a missing file instead of throwing", async () => {
    await expect(jxlCapabilities(join(dir, "missing.jxl"))).resolves.toMatchObject({
      ok: false,
      code: "io",
    });
  });
});
