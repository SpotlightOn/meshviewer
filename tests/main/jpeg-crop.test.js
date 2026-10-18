import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cropJpeg } from "../../src/jpeg-crop.js";
import { readJpegFrame } from "../../src/renderer/jpeg-frame.js";
import { dirEntries } from "./helpers/files.js";
import { hasJfif } from "./helpers/jpeg.js";
import { recordingStep, succeedWith } from "./helpers/steps.js";

/**
 * Lenna, a 512x512 baseline JPEG, used by the tests that exercise the real
 * WebAssembly module. It is committed as a fixture, so the tests need no image
 * library to build their input.
 * @type {URL}
 */
const FIXTURE = new URL("./fixtures/lenna.jpg", import.meta.url);

/** Extra result fields of a crop step. */
const CROPPED = { width: 8, height: 8 };

let dir;
let filePath;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-crop-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const name of await dirEntries(dir)) {
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
      { crop: succeedWith("cropped-bytes", CROPPED) },
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
      { crop: succeedWith("cropped-bytes", CROPPED) },
    );
    expect((await stat(join(dir, "photo-crop-1.jpg"))).mode & 0o7777).toBe(0o640);
  });

  it("numbers the files upward", async () => {
    await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("one", CROPPED) },
    );
    await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("two", CROPPED) },
    );
    await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("three", CROPPED) },
    );

    expect(await dirEntries(dir)).toEqual([
      "photo-crop-1.jpg",
      "photo-crop-2.jpg",
      "photo-crop-3.jpg",
      "photo.jpg",
    ]);
    expect(await readFile(join(dir, "photo-crop-2.jpg"), "utf8")).toBe("two");
  });

  it("passes the requested region on unchanged", async () => {
    const { step, calls } = recordingStep(CROPPED);
    await cropJpeg(filePath, { x: 32, y: 16, width: 64, height: 48 }, { crop: step });
    expect(calls.map(([, rect]) => rect)).toEqual([{ x: 32, y: 16, width: 64, height: 48 }]);
  });

  it("leaves no temporary file behind", async () => {
    await cropJpeg(
      filePath,
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: succeedWith("cropped-bytes", CROPPED) },
    );
    expect(await dirEntries(dir)).toEqual(["photo-crop-1.jpg", "photo.jpg"]);
  });

  it("rejects a region that is not a positive integer rectangle", async () => {
    const { step, calls } = recordingStep(CROPPED);
    const options = { crop: step };

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
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEGs", async () => {
    const { step, calls } = recordingStep(CROPPED);
    await expect(
      cropJpeg(join(dir, "photo.png"), { x: 0, y: 0, width: 8, height: 8 }, { crop: step }),
    ).resolves.toEqual({ ok: false, code: "not-jpeg" });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep(CROPPED);
    const result = await cropJpeg(
      join(dir, "missing.jpg"),
      { x: 0, y: 0, width: 8, height: 8 },
      { crop: step },
    );
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
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
    expect(await dirEntries(dir)).toEqual(["photo.jpg"]);
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
    expect(readJpegFrame(cropped)).toMatchObject({ width: 128, height: 96 });
    expect(hasJfif(cropped)).toBe(true);
  });

  it("reports a region that reaches past the image", async () => {
    await copyFile(FIXTURE, filePath);
    const result = await cropJpeg(filePath, { x: 480, y: 480, width: 64, height: 64 });
    expect(result).toMatchObject({ ok: false, code: "bad-crop" });
    expect(await dirEntries(dir)).toEqual(["photo.jpg"]);
  });

  it("reports a file with a JPEG extension that is not a JPEG", async () => {
    await writeFile(filePath, "definitely not a jpeg");
    const result = await cropJpeg(filePath, { x: 0, y: 0, width: 8, height: 8 });
    expect(result).toMatchObject({ ok: false, code: "not-jpeg" });
    expect(await readFile(filePath, "utf8")).toBe("definitely not a jpeg");
  });
});
