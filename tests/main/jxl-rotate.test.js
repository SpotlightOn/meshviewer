import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rotateJxl } from "../../src/jxl-rotate.js";
import { dirEntries } from "./helpers/files.js";
import { isContainer, jxlInfo } from "./helpers/jxl.js";
import { recordingStep, succeedWith } from "./helpers/steps.js";

/**
 * Lenna, a 256x256 lossy JPEG XL with alpha and orientation tag 1, used by the
 * tests that exercise the real WebAssembly module.
 * @type {URL}
 */
const STILL = new URL("./fixtures/jxl-lenna.jxl", import.meta.url);

/** The same image with its orientation tag set to 6. @type {URL} */
const ORIENTED = new URL("./fixtures/jxl-oriented6.jxl", import.meta.url);

/** The still image inside a container with an EXIF box. @type {URL} */
const CONTAINER = new URL("./fixtures/jxl-container.jxl", import.meta.url);

/** The animated sample: 64x64, three frames. @type {URL} */
const ANIM = new URL("./fixtures/jxl-anim.jxl", import.meta.url);

let dir;
let filePath;

/**
 * Builds a rotation step that throws.
 * @param {Error} error - Error the step throws.
 * @returns {() => never} Rotation step.
 */
function failWith(error) {
  return () => {
    throw error;
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-jxl-rotate-"));
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

describe("rotateJxl", () => {
  it("replaces the file with the rotated bytes", async () => {
    const result = await rotateJxl(filePath, 90, {
      rotate: succeedWith("rotated-bytes", { orientation: 6 }),
    });
    expect(result).toMatchObject({ ok: true, path: filePath, angle: 90, perfect: true });
    expect(result.size).toBe("rotated-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(filePath, "utf8")).toBe("rotated-bytes");
  });

  it("keeps the permission bits of the original file", async () => {
    await rotateJxl(filePath, 180, { rotate: succeedWith("rotated-bytes", {}) });
    expect((await stat(filePath)).mode & 0o7777).toBe(0o640);
  });

  it("normalizes the angle before the rotation runs", async () => {
    const { step, calls } = recordingStep({ orientation: 8 });
    const result = await rotateJxl(filePath, -90, { rotate: step });
    expect(calls.map(([, angle]) => angle)).toEqual([270]);
    expect(result).toMatchObject({ ok: true, angle: 270 });
  });

  it("leaves no temporary file behind", async () => {
    await rotateJxl(filePath, 90, { rotate: succeedWith("rotated-bytes", {}) });
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });

  it("keeps the original file when the rotation fails", async () => {
    const result = await rotateJxl(filePath, 90, {
      rotate: failWith(new Error("library failure")),
    });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(filePath)).toEqual(await readFile(STILL));
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });

  it("reports an empty output", async () => {
    const result = await rotateJxl(filePath, 90, {
      rotate: () => ({ data: new Uint8Array(0), orientation: 6 }),
    });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await readFile(filePath)).toEqual(await readFile(STILL));
  });

  it("rejects angles that are not supported", async () => {
    const { step, calls } = recordingStep({});
    await expect(rotateJxl(filePath, 45, { rotate: step })).resolves.toEqual({
      ok: false,
      code: "invalid-angle",
    });
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEG XLs", async () => {
    const { step, calls } = recordingStep({});
    await expect(rotateJxl(join(dir, "photo.png"), 90, { rotate: step })).resolves.toEqual({
      ok: false,
      code: "not-jxl",
    });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep({});
    const result = await rotateJxl(join(dir, "missing.jxl"), 90, { rotate: step });
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
  });
});

describe("rotateJxl with the WebAssembly module", () => {
  it("sets the orientation tag of the fixture in place", async () => {
    await copyFile(STILL, filePath);
    const before = await readFile(filePath);
    expect(await jxlInfo(filePath)).toMatchObject({ width: 256, height: 256, orientation: 1 });

    const result = await rotateJxl(filePath, 90);

    expect(result).toMatchObject({ ok: true, angle: 90, perfect: true, orientation: 6 });
    const after = await readFile(filePath);
    expect(after).not.toEqual(before);
    expect(await jxlInfo(filePath)).toMatchObject({ width: 256, height: 256, orientation: 6 });
  });

  it("composes with the orientation tag that is already there", async () => {
    await copyFile(ORIENTED, filePath);
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 6 });

    const result = await rotateJxl(filePath, 90);

    expect(result).toMatchObject({ ok: true, orientation: 3 });
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 3 });
  });

  it("turns the image back with a counter-clockwise rotation", async () => {
    await copyFile(ORIENTED, filePath);

    const result = await rotateJxl(filePath, 270);

    expect(result).toMatchObject({ ok: true, orientation: 1 });
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 1 });
  });

  it("rotates an animation through its tag as well", async () => {
    await copyFile(ANIM, filePath);

    const result = await rotateJxl(filePath, 90);

    expect(result).toMatchObject({ ok: true, orientation: 6 });
    expect(await jxlInfo(filePath)).toMatchObject({
      width: 64,
      height: 64,
      orientation: 6,
      animation: true,
    });
  });

  it("keeps the container and its metadata boxes", async () => {
    await copyFile(CONTAINER, filePath);
    const before = await readFile(filePath);
    expect(isContainer(before)).toBe(true);

    const result = await rotateJxl(filePath, 180);

    expect(result).toMatchObject({ ok: true, orientation: 3 });
    const after = await readFile(filePath);
    expect(isContainer(after)).toBe(true);
  });

  it("reports a file with a JPEG XL extension that is no JPEG XL", async () => {
    await writeFile(filePath, "definitely not a jpeg xl");
    const result = await rotateJxl(filePath, 90);
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await readFile(filePath, "utf8")).toBe("definitely not a jpeg xl");
  });
});
