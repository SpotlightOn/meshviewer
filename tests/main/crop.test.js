import { chmod, copyFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cropJpeg, registerCropIpc } from "../../src/crop.js";
import { hasJfif, jpegSize } from "./helpers/jpeg.js";

/**
 * Lenna, a 512x512 baseline JPEG, used by the tests that exercise the real
 * WebAssembly module. It is committed as a fixture, so the tests need no image
 * library to build their input.
 * @type {URL}
 */
const FIXTURE = new URL("./fixtures/lenna.jpg", import.meta.url);

let dir;
let filePath;

/**
 * Builds a crop step that returns fixed bytes, like the real module does.
 * @param {string|Uint8Array} data - Bytes the step reports as the cropped output.
 * @param {{width?: number, height?: number}} [size] - Dimensions the step reports.
 * @returns {(bytes: Uint8Array, rect: object) => {data: Uint8Array, width: number, height: number}} Crop step.
 */
function succeedWith(data, size = {}) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return () => ({ data: bytes, width: size.width ?? 8, height: size.height ?? 8 });
}

/**
 * Builds a crop step that records the regions it is called with.
 * @returns {{crop: Function, regions: Array<object>}} Recording crop step.
 */
function recordingStep() {
  const regions = [];
  const crop = (_bytes, rect) => {
    regions.push(rect);
    return { data: new Uint8Array([1]), width: 8, height: 8 };
  };
  return { crop, regions };
}

/**
 * Returns the names inside the fixture directory, sorted.
 * @returns {Promise<Array<string>>} Directory entries.
 */
async function dirEntries() {
  return (await readdir(dir)).sort();
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-crop-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const name of await dirEntries()) {
    await rm(join(dir, name), { force: true, recursive: true });
  }
  filePath = join(dir, "photo.jpg");
  await writeFile(filePath, "original-bytes");
  await chmod(filePath, 0o640);
});

describe("cropJpeg", () => {
  it("writes a new file next to the source and leaves the source untouched", async () => {
    const result = await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("cropped-bytes") },
    );

    expect(result).toMatchObject({
      ok: true,
      path: join(dir, "photo-crop-1.jpg"),
      width: 8,
      height: 8,
    });
    expect(result.size).toBe("cropped-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
    expect(await readFile(join(dir, "photo-crop-1.jpg"), "utf8")).toBe("cropped-bytes");
  });

  it("keeps the permission bits of the source", async () => {
    await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("cropped-bytes") },
    );
    expect((await stat(join(dir, "photo-crop-1.jpg"))).mode & 0o7777).toBe(0o640);
  });

  it("numbers the files upward", async () => {
    await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 }, { crop: succeedWith("one") });
    await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 }, { crop: succeedWith("two") });
    await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 }, { crop: succeedWith("three") });

    expect(await dirEntries()).toEqual([
      "photo-crop-1.jpg",
      "photo-crop-2.jpg",
      "photo-crop-3.jpg",
      "photo.jpg",
    ]);
    expect(await readFile(join(dir, "photo-crop-2.jpg"), "utf8")).toBe("two");
  });

  it("passes the requested region on unchanged", async () => {
    const step = recordingStep();
    await cropJpeg(filePath, { x: 32, y: 16, width: 64, height: 48 }, { crop: step.crop });
    expect(step.regions).toEqual([{ x: 32, y: 16, width: 64, height: 48 }]);
  });

  it("leaves no temporary file behind", async () => {
    await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("cropped-bytes") },
    );
    expect(await dirEntries()).toEqual(["photo-crop-1.jpg", "photo.jpg"]);
  });

  it("rejects a region that is not a positive integer rectangle", async () => {
    const step = recordingStep();
    const options = { crop: step.crop };

    await expect(cropJpeg(filePath, { x: 0, y: 0, width: 0, height: 8 }, options)).resolves.toEqual(
      {
        ok: false,
        code: "invalid-rect",
      },
    );
    await expect(cropJpeg(filePath, { x: 0, y: 0, width: 8 }, options)).resolves.toEqual({
      ok: false,
      code: "invalid-rect",
    });
    await expect(
      cropJpeg(filePath, { x: -8, y: 0, width: 8, height: 8 }, options),
    ).resolves.toEqual({
      ok: false,
      code: "invalid-rect",
    });
    await expect(
      cropJpeg(filePath, { x: 0, y: 0, width: 8.5, height: 8 }, options),
    ).resolves.toEqual({
      ok: false,
      code: "invalid-rect",
    });
    await expect(cropJpeg(filePath, null, options)).resolves.toEqual({
      ok: false,
      code: "invalid-rect",
    });
    expect(step.regions).toEqual([]);
  });

  it("rejects files that are not JPEGs", async () => {
    const step = recordingStep();
    await expect(
      cropJpeg(join(dir, "photo.png"), { x: 0, y: 0, width: 8, height: 8 }, { crop: step.crop }),
    ).resolves.toEqual({ ok: false, code: "not-jpeg" });
    expect(step.regions).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const step = recordingStep();
    const result = await cropJpeg(
      join(dir, "missing.jpg"),
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: step.crop },
    );
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(step.regions).toEqual([]);
  });

  it("reports a region the module refuses", async () => {
    const error = Object.assign(new Error("Invalid crop request"), { status: 5 });
    const crop = () => {
      throw error;
    };
    const result = await cropJpeg(filePath, { x: 600, y: 600, width: 8, height: 8 }, { crop });
    expect(result).toMatchObject({ ok: false, code: "bad-crop", detail: "Invalid crop request" });
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
  });

  it("reports a failing module", async () => {
    const crop = () => {
      throw new Error("library failure");
    };
    const result = await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 }, { crop });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
  });

  it("reports an empty output", async () => {
    const crop = () => ({ data: new Uint8Array(0), width: 8, height: 8 });
    const result = await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 }, { crop });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await dirEntries()).toEqual(["photo.jpg"]);
  });
});

describe("cropJpeg with the WebAssembly module", () => {
  it("crops the fixture into a new file and keeps the source", async () => {
    await copyFile(FIXTURE, filePath);
    const before = await readFile(filePath);

    const result = await cropJpeg(filePath, { x: 64, y: 32, width: 128, height: 96 });

    expect(result).toMatchObject({
      ok: true,
      path: join(dir, "photo-crop-1.jpg"),
      width: 128,
      height: 96,
    });
    expect(await readFile(filePath)).toEqual(before);
    const cropped = await readFile(join(dir, "photo-crop-1.jpg"));
    expect(jpegSize(cropped)).toEqual({ width: 128, height: 96 });
    expect(hasJfif(cropped)).toBe(true);
  });

  it("reports a region that reaches past the image", async () => {
    await copyFile(FIXTURE, filePath);
    const result = await cropJpeg(filePath, { x: 480, y: 480, width: 64, height: 64 });
    expect(result).toMatchObject({ ok: false, code: "bad-crop" });
    expect(await dirEntries()).toEqual(["photo.jpg"]);
  });

  it("reports a file with a JPEG extension that is not a JPEG", async () => {
    await writeFile(filePath, "definitely not a jpeg");
    const result = await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 });
    expect(result).toMatchObject({ ok: false, code: "not-jpeg" });
    expect(await readFile(filePath, "utf8")).toBe("definitely not a jpeg");
  });
});

describe("registerCropIpc", () => {
  it("registers the crop handler", async () => {
    const handlers = {};
    const ipcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };
    registerCropIpc(ipcMain);
    expect(Object.keys(handlers)).toEqual(["crop:jpeg"]);
    await expect(
      handlers["crop:jpeg"](null, join(dir, "photo.txt"), { x: 0, y: 0, width: 8, height: 8 }),
    ).resolves.toEqual({ ok: false, code: "not-jpeg" });
  });
});
