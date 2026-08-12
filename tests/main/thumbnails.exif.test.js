import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  extractEmbeddedThumbnail,
  generateThumbnail,
  getThumbnail,
  readEmbeddedThumbnail,
} from "../../src/thumbnails.js";
import { makeExifJpeg, makePlainJpeg } from "./fixtures/make-exif-jpeg.mjs";

let dir;
let exifPath;
let plainPath;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "meshviewer-exif-"));
  exifPath = join(dir, "exif.jpg");
  plainPath = join(dir, "plain.jpg");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("extractEmbeddedThumbnail", () => {
  it("extracts the exact thumbnail embedded by piexifjs", async () => {
    const expected = await makeExifJpeg(exifPath);
    const data = await readFile(exifPath);
    const extracted = extractEmbeddedThumbnail(data);
    expect(extracted).not.toBeNull();
    expect(extracted.equals(expected)).toBe(true);
  });

  it("returns null for a JPEG without EXIF data", async () => {
    await makePlainJpeg(plainPath);
    const data = await readFile(plainPath);
    expect(extractEmbeddedThumbnail(data)).toBeNull();
  });

  it("returns null for data that is not a JPEG", () => {
    expect(extractEmbeddedThumbnail(Buffer.from("not an image"))).toBeNull();
  });
});

describe("readEmbeddedThumbnail", () => {
  it("returns the embedded thumbnail bytes from a file", async () => {
    const expected = await makeExifJpeg(exifPath);
    const extracted = await readEmbeddedThumbnail(exifPath);
    expect(extracted).not.toBeNull();
    expect(extracted.equals(expected)).toBe(true);
  });

  it("returns null for a file without EXIF data", async () => {
    await makePlainJpeg(plainPath);
    expect(await readEmbeddedThumbnail(plainPath)).toBeNull();
  });

  it("returns null when the file cannot be read", async () => {
    expect(await readEmbeddedThumbnail(join(dir, "missing.jpg"))).toBeNull();
  });
});

describe("generateThumbnail with a buffer input", () => {
  it("creates a thumbnail file from a buffer", async () => {
    await makeExifJpeg(exifPath);
    const data = await readFile(exifPath);
    const out = join(dir, "thumb.jpg");
    await generateThumbnail(data, out);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(256);
  });
});

describe("getThumbnail with embedded EXIF thumbnail", () => {
  it("builds the thumbnail from the embedded JPEG", async () => {
    await makeExifJpeg(exifPath);
    const fileState = await stat(exifPath);
    const cacheDir = join(dir, "cache");
    const file = { path: exifPath, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const result = await getThumbnail(file, cacheDir);
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    const entries = await readdir(cacheDir);
    expect(entries).toHaveLength(1);
    const meta = await sharp(join(cacheDir, entries[0])).metadata();
    expect(meta.width).toBeLessThanOrEqual(256);
    expect(meta.height).toBeLessThanOrEqual(256);
  });

  it("falls back to full decode when there is no embedded thumbnail", async () => {
    await makePlainJpeg(plainPath);
    const fileState = await stat(plainPath);
    const cacheDir = join(dir, "cache-plain");
    const file = { path: plainPath, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const result = await getThumbnail(file, cacheDir);
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    expect(await readdir(cacheDir)).toHaveLength(1);
  });
});
