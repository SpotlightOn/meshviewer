import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { flipJxl } from "../../src/jxl-flip.js";
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
 * Builds a flip step that throws.
 * @param {Error} error - Error the step throws.
 * @returns {() => never} Flip step.
 */
function failWith(error) {
  return () => {
    throw error;
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-jxl-flip-"));
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

describe("flipJxl", () => {
  it("replaces the file with the flipped bytes", async () => {
    const result = await flipJxl(filePath, "horizontal", {
      flip: succeedWith("flipped-bytes", { orientation: 2 }),
    });
    expect(result).toMatchObject({ ok: true, path: filePath, axis: "horizontal", perfect: true });
    expect(result.size).toBe("flipped-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(filePath, "utf8")).toBe("flipped-bytes");
  });

  it("keeps the permission bits of the original file", async () => {
    await flipJxl(filePath, "vertical", { flip: succeedWith("flipped-bytes", {}) });
    expect((await stat(filePath)).mode & 0o7777).toBe(0o640);
  });

  it("passes the requested axis on unchanged", async () => {
    const { step, calls } = recordingStep({ orientation: 4 });
    const result = await flipJxl(filePath, "vertical", { flip: step });
    expect(calls.map(([, axis]) => axis)).toEqual(["vertical"]);
    expect(result).toMatchObject({ ok: true, axis: "vertical" });
  });

  it("leaves no temporary file behind", async () => {
    await flipJxl(filePath, "horizontal", { flip: succeedWith("flipped-bytes", {}) });
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });

  it("keeps the original file when the flip fails", async () => {
    const result = await flipJxl(filePath, "horizontal", {
      flip: failWith(new Error("library failure")),
    });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(filePath)).toEqual(await readFile(STILL));
    expect(await dirEntries(dir)).toEqual(["photo.jxl"]);
  });

  it("reports an empty output", async () => {
    const result = await flipJxl(filePath, "horizontal", {
      flip: () => ({ data: new Uint8Array(0), orientation: 2 }),
    });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await readFile(filePath)).toEqual(await readFile(STILL));
  });

  it("rejects axes that are not supported", async () => {
    const { step, calls } = recordingStep({});
    await expect(flipJxl(filePath, "diagonal", { flip: step })).resolves.toEqual({
      ok: false,
      code: "invalid-axis",
    });
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEG XLs", async () => {
    const { step, calls } = recordingStep({});
    await expect(flipJxl(join(dir, "photo.png"), "horizontal", { flip: step })).resolves.toEqual({
      ok: false,
      code: "not-jxl",
    });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep({});
    const result = await flipJxl(join(dir, "missing.jxl"), "horizontal", { flip: step });
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
  });
});

describe("flipJxl with the WebAssembly module", () => {
  it("sets the orientation tag of the fixture in place", async () => {
    await copyFile(STILL, filePath);
    const before = await readFile(filePath);

    const result = await flipJxl(filePath, "horizontal");

    expect(result).toMatchObject({ ok: true, axis: "horizontal", perfect: true, orientation: 2 });
    expect(await readFile(filePath)).not.toEqual(before);
    expect(await jxlInfo(filePath)).toMatchObject({ width: 256, height: 256, orientation: 2 });
  });

  it("mirrors the other axis as well", async () => {
    await copyFile(STILL, filePath);

    const result = await flipJxl(filePath, "vertical");

    expect(result).toMatchObject({ ok: true, axis: "vertical", perfect: true, orientation: 4 });
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 4 });
  });

  it("composes with the orientation tag that is already there", async () => {
    await copyFile(ORIENTED, filePath);
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 6 });

    const result = await flipJxl(filePath, "horizontal");

    expect(result).toMatchObject({ ok: true, orientation: 5 });
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 5 });
  });

  it("mirrors twice back into the original tag", async () => {
    await copyFile(ORIENTED, filePath);

    await flipJxl(filePath, "horizontal");
    await flipJxl(filePath, "horizontal");

    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 6 });
  });

  it("mirrors an animation through its tag as well", async () => {
    await copyFile(ANIM, filePath);

    const result = await flipJxl(filePath, "horizontal");

    expect(result).toMatchObject({ ok: true, orientation: 2 });
    expect(await jxlInfo(filePath)).toMatchObject({ orientation: 2, animation: true });
  });

  it("keeps the container and its metadata boxes", async () => {
    await copyFile(CONTAINER, filePath);
    expect(isContainer(await readFile(filePath))).toBe(true);

    const result = await flipJxl(filePath, "vertical");

    expect(result).toMatchObject({ ok: true, orientation: 4 });
    expect(isContainer(await readFile(filePath))).toBe(true);
  });

  it("reports a file with a JPEG XL extension that is no JPEG XL", async () => {
    await writeFile(filePath, "definitely not a jpeg xl");
    const result = await flipJxl(filePath, "horizontal");
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await readFile(filePath, "utf8")).toBe("definitely not a jpeg xl");
  });
});
