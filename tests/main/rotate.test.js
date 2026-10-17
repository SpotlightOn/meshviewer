import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readJpegFrame } from "../../src/renderer/jpeg-frame.js";
import { normalizeAngle, registerRotateIpc, rotateJpeg } from "../../src/rotate.js";
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

/** Extra result fields of a rotation step that was MCU aligned. */
const ALIGNED = { perfect: true };

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
  dir = await mkdtemp(join(tmpdir(), "meshviewer-rotate-"));
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

describe("normalizeAngle", () => {
  it("keeps the supported clockwise angles", () => {
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(270)).toBe(270);
  });

  it("normalizes negative and oversized angles", () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-720)).toBeNull();
  });

  it("rejects angles that are not a quarter turn", () => {
    expect(normalizeAngle(0)).toBeNull();
    expect(normalizeAngle(45)).toBeNull();
    expect(normalizeAngle(91)).toBeNull();
    expect(normalizeAngle(Number.NaN)).toBeNull();
    expect(normalizeAngle("90")).toBeNull();
  });
});

describe("rotateJpeg", () => {
  it("replaces the file with the rotated bytes", async () => {
    const result = await rotateJpeg(filePath, 90, {
      rotate: succeedWith("rotated-bytes", ALIGNED),
    });
    expect(result).toMatchObject({ ok: true, path: filePath, angle: 90, perfect: true });
    expect(result.size).toBe("rotated-bytes".length);
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(filePath, "utf8")).toBe("rotated-bytes");
  });

  it("keeps the permission bits of the original file", async () => {
    await rotateJpeg(filePath, 90, { rotate: succeedWith("rotated-bytes", ALIGNED) });
    expect((await stat(filePath)).mode & 0o7777).toBe(0o640);
  });

  it("turns a counter-clockwise request into a 270 degree turn", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    const result = await rotateJpeg(filePath, -90, { rotate: step });
    expect(calls.map(([, angle]) => angle)).toEqual([270]);
    expect(result).toMatchObject({ ok: true, angle: 270 });
  });

  it("reports a transform that was not MCU aligned", async () => {
    const result = await rotateJpeg(filePath, 90, {
      rotate: succeedWith("rotated-bytes", { perfect: false }),
    });
    expect(result).toMatchObject({ ok: true, perfect: false });
  });

  it("leaves no temporary file behind", async () => {
    await rotateJpeg(filePath, 90, { rotate: succeedWith("rotated-bytes", ALIGNED) });
    expect(await dirEntries(dir)).toEqual(["photo.jpg"]);
  });

  it("keeps the original file when the rotation fails", async () => {
    const result = await rotateJpeg(filePath, 90, {
      rotate: failWith(new Error("library failure")),
    });
    expect(result).toMatchObject({ ok: false, code: "transform", detail: "library failure" });
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
    expect(await dirEntries(dir)).toEqual(["photo.jpg"]);
  });

  it("reports an empty output", async () => {
    const result = await rotateJpeg(filePath, 90, {
      rotate: () => ({ data: new Uint8Array(0), perfect: true }),
    });
    expect(result).toMatchObject({ ok: false, code: "transform" });
    expect(await readFile(filePath, "utf8")).toBe("original-bytes");
  });

  it("rejects angles that are not a quarter turn", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    await expect(rotateJpeg(filePath, 45, { rotate: step })).resolves.toEqual({
      ok: false,
      code: "invalid-angle",
    });
    expect(calls).toEqual([]);
  });

  it("rejects files that are not JPEGs", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    await expect(rotateJpeg(join(dir, "photo.png"), 90, { rotate: step })).resolves.toEqual({
      ok: false,
      code: "not-jpeg",
    });
    expect(calls).toEqual([]);
  });

  it("reports a missing input file", async () => {
    const { step, calls } = recordingStep(ALIGNED);
    const result = await rotateJpeg(join(dir, "missing.jpg"), 90, { rotate: step });
    expect(result).toMatchObject({ ok: false, code: "io" });
    expect(calls).toEqual([]);
  });
});

describe("rotateJpeg with the WebAssembly module", () => {
  it("rotates the fixture in place and reports a perfect transform", async () => {
    await copyFile(FIXTURE, filePath);
    const before = await readFile(filePath);
    expect(readJpegFrame(before)).toMatchObject({
      width: 512,
      height: 512,
      imcu: { width: 8, height: 8 },
    });

    const result = await rotateJpeg(filePath, 90);

    expect(result).toMatchObject({ ok: true, angle: 90, perfect: true });
    const after = await readFile(filePath);
    expect(after).not.toEqual(before);
    expect(readJpegFrame(after)).toMatchObject({ width: 512, height: 512 });
  });

  it("turns the image by 90 degrees, not by another angle", async () => {
    await copyFile(FIXTURE, filePath);
    await rotateJpeg(filePath, 90);
    await rotateJpeg(filePath, 90);
    const twiceNinety = await readFile(filePath);

    await copyFile(FIXTURE, filePath);
    await rotateJpeg(filePath, 180);

    expect(await readFile(filePath)).toEqual(twiceNinety);
  });

  it("keeps the JFIF block", async () => {
    await copyFile(FIXTURE, filePath);
    expect(hasJfif(await readFile(filePath))).toBe(true);
    await rotateJpeg(filePath, 180);
    expect(hasJfif(await readFile(filePath))).toBe(true);
  });

  it("reports a file with a JPEG extension that is not a JPEG", async () => {
    await writeFile(filePath, "definitely not a jpeg");
    const result = await rotateJpeg(filePath, 90);
    expect(result).toMatchObject({ ok: false, code: "not-jpeg" });
    expect(await readFile(filePath, "utf8")).toBe("definitely not a jpeg");
  });
});

describe("registerRotateIpc", () => {
  it("registers the rotation handler", async () => {
    const handlers = {};
    const ipcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };
    registerRotateIpc(ipcMain);
    expect(Object.keys(handlers)).toEqual(["rotate:jpeg"]);
    await expect(handlers["rotate:jpeg"](null, join(dir, "photo.txt"), 90)).resolves.toEqual({
      ok: false,
      code: "not-jpeg",
    });
  });
});
