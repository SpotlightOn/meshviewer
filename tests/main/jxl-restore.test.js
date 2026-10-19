import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { restoreJxl } from "../../src/jxl-crop.js";
import { dirEntries } from "./helpers/files.js";
import { jxlCropOf, jxlInfo } from "./helpers/jxl.js";
import { recordingStep, succeedWith } from "./helpers/steps.js";

/**
 * Lenna, a 256x256 lossy JPEG XL with alpha and orientation tag 1, used as the
 * file the tests crop and then restore.
 * @type {URL}
 */
const STILL = new URL("./fixtures/jxl-lenna.jxl", import.meta.url);

/** The animated sample: 64x64, three frames. @type {URL} */
const ANIM = new URL("./fixtures/jxl-anim.jxl", import.meta.url);

/** The region the tests cut out of the 256x256 fixture. */
const INSIDE = { x: 10, y: 20, width: 100, height: 80 };

let dir;
let filePath;
let croppedPath;

/**
 * Builds a restore step that throws.
 * @param {Error} error - Error the step throws.
 * @returns {() => never} Crop step.
 */
function failWith(error) {
  return () => {
    throw error;
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-jxl-restore-"));
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
  croppedPath = join(dir, "photo-crop-1.jxl");
  await writeFile(croppedPath, await jxlCropOf(new Uint8Array(await readFile(STILL)), INSIDE));
  await chmod(croppedPath, 0o640);
});

describe("restoreJxl", () => {
  it("writes the frame as a new file and leaves the source untouched", async () => {
    const source = await readFile(croppedPath);

    const result = await restoreJxl(croppedPath, { crop: succeedWith("restored-bytes") });

    expect(result).toMatchObject({
      ok: true,
      path: join(dir, "photo-crop-1-undo-1.jxl"),
      name: "photo-crop-1-undo-1.jxl",
      width: 256,
      height: 256,
    });
    expect(result.size).toBe("restored-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(join(dir, "photo-crop-1-undo-1.jxl"), "utf8")).toBe("restored-bytes");
    expect(await readFile(croppedPath)).toEqual(source);
  });

  it("passes the frame of the file as the region, including negative offsets", async () => {
    const { step, calls } = recordingStep();
    await restoreJxl(croppedPath, { crop: step });
    expect(calls).toEqual([[expect.any(Uint8Array), { x: -10, y: -20, width: 256, height: 256 }]]);
  });

  it("keeps the permission bits of the source on the new file", async () => {
    const result = await restoreJxl(croppedPath, { crop: succeedWith("restored-bytes") });
    expect((await stat(result.path)).mode & 0o7777).toBe(0o640);
  });

  it("numbers the outputs up while a name is taken", async () => {
    await restoreJxl(croppedPath, { crop: succeedWith("first") });
    const second = await restoreJxl(croppedPath, { crop: succeedWith("second") });
    expect(second).toMatchObject({ ok: true, name: "photo-crop-1-undo-2.jxl" });
  });

  it("leaves no temporary file behind", async () => {
    await restoreJxl(croppedPath, { crop: succeedWith("restored-bytes") });
    expect(await dirEntries(dir)).toEqual([
      "photo-crop-1-undo-1.jxl",
      "photo-crop-1.jxl",
      "photo.jxl",
    ]);
  });

  it("keeps the source when the restore fails", async () => {
    const source = await readFile(croppedPath);
    const result = await restoreJxl(croppedPath, { crop: failWith(new Error("library failure")) });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(croppedPath)).toEqual(source);
    expect(await dirEntries(dir)).toEqual(["photo-crop-1.jxl", "photo.jxl"]);
  });

  it("reports an empty output", async () => {
    const result = await restoreJxl(croppedPath, {
      crop: () => ({ data: new Uint8Array(0) }),
    });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await dirEntries(dir)).toEqual(["photo-crop-1.jxl", "photo.jxl"]);
  });

  it("reports a file that shows everything it holds", async () => {
    const { step, calls } = recordingStep();
    await expect(restoreJxl(filePath, { crop: step })).resolves.toEqual({
      ok: false,
      code: "nothing-hidden",
    });
    expect(calls).toEqual([]);
  });

  it("refuses to restore an animation", async () => {
    await copyFile(ANIM, join(dir, "anim.jxl"));
    const { step, calls } = recordingStep();
    await expect(restoreJxl(join(dir, "anim.jxl"), { crop: step })).resolves.toEqual({
      ok: false,
      code: "animated",
    });
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEG XLs", async () => {
    const { step, calls } = recordingStep();
    await expect(restoreJxl(join(dir, "photo.png"), { crop: step })).resolves.toEqual({
      ok: false,
      code: "not-jxl",
    });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep();
    const result = await restoreJxl(join(dir, "missing.jxl"), { crop: step });
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
  });
});

describe("restoreJxl with the WebAssembly module", () => {
  it("brings the cropped area back byte for byte", async () => {
    const source = await readFile(filePath);

    const result = await restoreJxl(croppedPath);

    expect(result).toMatchObject({
      ok: true,
      name: "photo-crop-1-undo-1.jxl",
      width: 256,
      height: 256,
    });
    expect(await readFile(result.path)).toEqual(source);
    expect(await readFile(filePath)).toEqual(source);
    expect(await jxlInfo(result.path)).toMatchObject({ width: 256, height: 256 });
  });

  it("keeps the permission bits of the source on the new file", async () => {
    const result = await restoreJxl(croppedPath);
    expect((await stat(result.path)).mode & 0o7777).toBe(0o640);
  });

  it("reports nothing to undo on the restored file", async () => {
    const restored = await restoreJxl(croppedPath);
    await expect(restoreJxl(restored.path)).resolves.toEqual({
      ok: false,
      code: "nothing-hidden",
    });
  });
});
