import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cropJxl } from "../../src/jxl-crop.js";
import { dirEntries } from "./helpers/files.js";
import { jxlInfo } from "./helpers/jxl.js";
import { recordingStep, succeedWith } from "./helpers/steps.js";

/**
 * Lenna, a 256x256 lossy JPEG XL with alpha and orientation tag 1, used by the
 * tests that exercise the real WebAssembly module.
 * @type {URL}
 */
const STILL = new URL("./fixtures/jxl-lenna.jxl", import.meta.url);

/** The same image with its orientation tag set to 6. @type {URL} */
const ORIENTED = new URL("./fixtures/jxl-oriented6.jxl", import.meta.url);

/** The animated sample: 64x64, three frames. @type {URL} */
const ANIM = new URL("./fixtures/jxl-anim.jxl", import.meta.url);

/** A region that lies inside the 256x256 fixture. */
const INSIDE = { x: 10, y: 20, width: 100, height: 80 };

let dir;
let filePath;

/**
 * Builds a crop step that throws.
 * @param {Error} error - Error the step throws.
 * @returns {() => never} Crop step.
 */
function failWith(error) {
  return () => {
    throw error;
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-jxl-crop-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const name of await dirEntries(dir)) {
    await rm(join(dir, name), { force: true, recursive: true });
  }
  filePath = join(dir, "photo.jxl");
  await copyFile(STILL, filePath);
  await chmod(filePath, 0o640);
});

describe("cropJxl", () => {
  it("writes the region as a new file and leaves the source untouched", async () => {
    const result = await cropJxl(filePath, INSIDE, { crop: succeedWith("cropped-bytes") });
    expect(result).toMatchObject({
      ok: true,
      path: join(dir, "photo-crop-1.jxl"),
      name: "photo-crop-1.jxl",
      width: 100,
      height: 80,
    });
    expect(result.size).toBe("cropped-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(join(dir, "photo-crop-1.jxl"), "utf8")).toBe("cropped-bytes");
    expect(await readFile(filePath)).toEqual(await readFile(STILL));
  });

  it("keeps the permission bits of the source on the new file", async () => {
    await cropJxl(filePath, INSIDE, { crop: succeedWith("cropped-bytes") });
    expect((await stat(join(dir, "photo-crop-1.jxl"))).mode & 0o7777).toBe(0o640);
  });

  it("numbers the outputs up while a name is taken", async () => {
    await cropJxl(filePath, INSIDE, { crop: succeedWith("first") });
    const second = await cropJxl(filePath, INSIDE, { crop: succeedWith("second") });
    expect(second).toMatchObject({ ok: true, name: "photo-crop-2.jxl" });
    expect(await dirEntries(dir)).toEqual(["photo-crop-1.jxl", "photo-crop-2.jxl", "photo.jxl"]);
  });

  it("passes the region on unchanged", async () => {
    const { step, calls } = recordingStep();
    const result = await cropJxl(filePath, INSIDE, { crop: step });
    expect(calls).toEqual([[expect.any(Uint8Array), INSIDE]]);
    expect(result).toMatchObject({ ok: true, width: 100, height: 80 });
  });

  it("leaves no temporary file behind", async () => {
    await cropJxl(filePath, INSIDE, { crop: succeedWith("cropped-bytes") });
    expect(await dirEntries(dir)).toEqual(["photo-crop-1.jxl", "photo.jxl"]);
  });

  it("keeps the source when the crop fails", async () => {
    const source = await readFile(filePath);
    const result = await cropJxl(filePath, INSIDE, {
      crop: failWith(new Error("library failure")),
    });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(filePath)).toEqual(source);
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });

  it("reports an empty output", async () => {
    const result = await cropJxl(filePath, INSIDE, { crop: () => ({ data: new Uint8Array(0) }) });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });

  it("rejects regions that are not usable", async () => {
    const { step, calls } = recordingStep();
    for (const rect of [
      null,
      {},
      { x: -4, y: 0, width: 8, height: 8 },
      { x: 0, y: 0, width: 0, height: 8 },
      { x: 0.5, y: 0, width: 8, height: 8 },
      { x: 0, y: 0, width: 8 },
    ]) {
      await expect(cropJxl(filePath, rect, { crop: step })).resolves.toEqual({
        ok: false,
        code: "invalid-rect",
      });
    }
    expect(calls).toEqual([]);
  });

  it("rejects regions that reach outside the image", async () => {
    const { step, calls } = recordingStep();
    const result = await cropJxl(
      filePath,
      { x: 200, y: 0, width: 100, height: 80 },
      { crop: step },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid-rect" });
    expect(calls).toEqual([]);
  });

  it("refuses to crop an animation", async () => {
    await copyFile(ANIM, filePath);
    const { step, calls } = recordingStep();
    const result = await cropJxl(filePath, { x: 0, y: 0, width: 32, height: 32 }, { crop: step });
    expect(result).toEqual({ ok: false, code: "animated" });
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEG XLs", async () => {
    const { step, calls } = recordingStep();
    await expect(cropJxl(join(dir, "photo.png"), INSIDE, { crop: step })).resolves.toEqual({
      ok: false,
      code: "not-jxl",
    });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep();
    const result = await cropJxl(join(dir, "missing.jxl"), INSIDE, { crop: step });
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
  });
});

describe("cropJxl with the WebAssembly module", () => {
  it("writes the region with its dimensions and leaves the source untouched", async () => {
    const source = await readFile(filePath);

    const result = await cropJxl(filePath, INSIDE);

    expect(result).toMatchObject({ ok: true, name: "photo-crop-1.jxl", width: 100, height: 80 });
    expect(await readFile(filePath)).toEqual(source);
    expect(await jxlInfo(result.path)).toMatchObject({
      width: 100,
      height: 80,
      orientation: 1,
      animation: false,
    });
  });

  it("keeps the orientation tag of an oriented image", async () => {
    await copyFile(ORIENTED, filePath);
    expect(await jxlInfo(filePath)).toMatchObject({ width: 256, height: 256, orientation: 6 });

    const result = await cropJxl(filePath, INSIDE);

    expect(result).toMatchObject({ ok: true, width: 100, height: 80 });
    expect(await jxlInfo(result.path)).toMatchObject({
      width: 100,
      height: 80,
      orientation: 6,
    });
  });

  it("crops the whole image when the region covers it", async () => {
    const result = await cropJxl(filePath, { x: 0, y: 0, width: 256, height: 256 });
    expect(result).toMatchObject({ ok: true, width: 256, height: 256 });
    expect(await jxlInfo(result.path)).toMatchObject({ width: 256, height: 256 });
  });

  it("rejects a region that reaches outside the image", async () => {
    const result = await cropJxl(filePath, { x: 100, y: 100, width: 200, height: 200 });
    expect(result).toMatchObject({ ok: false, code: "invalid-rect" });
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });
});
