import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { flipJpeg, normalizeAxis, registerFlipIpc } from "../../src/jpeg-flip.js";
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

/** Extra result fields of a flip step that was MCU aligned. */
const ALIGNED = { perfect: true };

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

/**
 * Decodes a file into its raw pixels, so the tests can compare what the
 * flipped image looks like without a browser.
 * @param {string} target - Absolute path of the image to decode.
 * @returns {Promise<Buffer>} Raw pixel bytes.
 */
async function pixelsOf(target) {
  return sharp(target).raw().toBuffer();
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-flip-"));
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

describe("normalizeAxis", () => {
  it("keeps the supported axes", () => {
    expect(normalizeAxis("horizontal")).toBe("horizontal");
    expect(normalizeAxis("vertical")).toBe("vertical");
  });

  it("rejects axes that are not supported", () => {
    expect(normalizeAxis("diagonal")).toBeNull();
    expect(normalizeAxis("Horizontal")).toBeNull();
    expect(normalizeAxis("")).toBeNull();
    expect(normalizeAxis(undefined)).toBeNull();
    expect(normalizeAxis(1)).toBeNull();
  });
});

describe("flipJpeg", () => {
  it("replaces the file with the flipped bytes", async () => {
    const result = await flipJpeg(filePath, "horizontal", {
      flip: succeedWith("flipped-bytes", ALIGNED),
    });
    expect(result).toMatchObject({ ok: true, path: filePath, axis: "horizontal", perfect: true });
    expect(result.size).toBe("flipped-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(filePath, "utf8")).toBe("flipped-bytes");
  });

  it("keeps the permission bits of the original file", async () => {
    await flipJpeg(filePath, "vertical", { flip: succeedWith("flipped-bytes", ALIGNED) });
    expect((await stat(filePath)).mode & 0o7777).toBe(0o640);
  });

  it("passes the requested axis on unchanged", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    const result = await flipJpeg(filePath, "vertical", { flip: step });
    expect(calls.map(([, axis]) => axis)).toEqual(["vertical"]);
    expect(result).toMatchObject({ ok: true, axis: "vertical" });
  });

  it("reports a transform that was not MCU aligned", async () => {
    const result = await flipJpeg(filePath, "horizontal", {
      flip: succeedWith("flipped-bytes", { perfect: false }),
    });
    expect(result).toMatchObject({ ok: true, perfect: false });
  });

  it("leaves no temporary file behind", async () => {
    await flipJpeg(filePath, "horizontal", { flip: succeedWith("flipped-bytes", ALIGNED) });
    expect(await dirEntries(dir)).toEqual(["photo.jpg"]);
  });

  it("keeps the original file when the flip fails", async () => {
    const result = await flipJpeg(filePath, "horizontal", {
      flip: failWith(new Error("library failure")),
    });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
    expect(await dirEntries(dir)).toEqual(["photo.jpg"]);
  });

  it("reports an empty output", async () => {
    const result = await flipJpeg(filePath, "horizontal", {
      flip: () => ({ data: new Uint8Array(0), perfect: true }),
    });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
  });

  it("rejects axes that are not supported", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    await expect(flipJpeg(filePath, "diagonal", { flip: step })).resolves.toEqual({
      ok: false,
      code: "invalid-axis",
    });
    await expect(flipJpeg(filePath, undefined, { flip: step })).resolves.toEqual({
      ok: false,
      code: "invalid-axis",
    });
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEGs", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    await expect(flipJpeg(join(dir, "photo.png"), "horizontal", { flip: step })).resolves.toEqual({
      ok: false,
      code: "not-jpeg",
    });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    const result = await flipJpeg(join(dir, "missing.jpg"), "horizontal", { flip: step });
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
  });
});

describe("flipJpeg with the WebAssembly module", () => {
  it("mirrors the fixture in place and reports a perfect transform", async () => {
    await copyFile(FIXTURE, filePath);
    const before = await readFile(filePath);
    expect(readJpegFrame(before)).toMatchObject({
      width: 512,
      height: 512,
      imcu: { width: 8, height: 8 },
    });

    const result = await flipJpeg(filePath, "horizontal");

    expect(result).toMatchObject({ ok: true, axis: "horizontal", perfect: true });
    const after = await readFile(filePath);
    expect(after).not.toEqual(before);
    expect(readJpegFrame(after)).toMatchObject({ width: 512, height: 512 });
    expect(hasJfif(after)).toBe(true);
  });

  it("turns the image into its mirror, twice back into the original", async () => {
    await copyFile(FIXTURE, filePath);
    const original = await pixelsOf(filePath);

    await flipJpeg(filePath, "horizontal");
    const mirrored = await pixelsOf(filePath);
    expect(mirrored).not.toEqual(original);

    await flipJpeg(filePath, "horizontal");
    expect(await pixelsOf(filePath)).toEqual(original);
  });

  it("flips the other axis as well", async () => {
    await copyFile(FIXTURE, filePath);
    const original = await pixelsOf(filePath);

    const result = await flipJpeg(filePath, "vertical");

    expect(result).toMatchObject({ ok: true, axis: "vertical", perfect: true });
    expect(await pixelsOf(filePath)).not.toEqual(original);
  });

  it("reports a file with a JPEG extension that is not a JPEG", async () => {
    await writeFile(filePath, "definitely not a jpeg");
    const result = await flipJpeg(filePath, "horizontal");
    expect(result).toMatchObject({ ok: false, code: "not-jpeg" });
    expect(await readFile(filePath, "utf8")).toBe("definitely not a jpeg");
  });
});

describe("registerFlipIpc", () => {
  it("registers the flip handler", async () => {
    const handlers = {};
    const ipcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };
    registerFlipIpc(ipcMain);
    expect(Object.keys(handlers)).toEqual(["flip:jpeg"]);
    const result = await handlers["flip:jpeg"](null, join(dir, "photo.txt"), "horizontal");
    expect(result).toEqual({ ok: false, code: "not-jpeg" });
  });
});
