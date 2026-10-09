import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piexif from "piexifjs";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  embeddedThumbnailAngle,
  extractEmbeddedThumbnail,
  extractExifTags,
  generateThumbnail,
  getThumbnail,
  readEmbeddedThumbnail,
  thumbnailKey,
} from "../../src/thumbnails.js";
import { makeExifJpeg, makeOrientedJpeg, makePlainJpeg } from "./fixtures/make-exif-jpeg.mjs";

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

describe("extractExifTags", () => {
  it("reads the orientation of the main image and the thumbnail", async () => {
    const filePath = join(dir, "tags.jpg");
    await makeOrientedJpeg(filePath, { mainOrientation: 6, thumbOrientation: 8 });
    const data = await readFile(filePath);
    expect(extractExifTags(data)).toEqual({ main: 6, thumbnail: 8 });
  });

  it("returns null for data without EXIF", () => {
    expect(extractExifTags(Buffer.from("not an image"))).toBeNull();
  });
});

describe("embeddedThumbnailAngle", () => {
  let thumb;

  beforeAll(async () => {
    thumb = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#1ec81e" },
    })
      .jpeg()
      .toBuffer();
  });

  it("returns 0 when the outer file has no orientation", () => {
    expect(embeddedThumbnailAngle(null, thumb)).toBe(0);
    expect(embeddedThumbnailAngle({}, thumb)).toBe(0);
  });

  it("maps the common rotation orientations to angles", () => {
    expect(embeddedThumbnailAngle({ main: 3 }, thumb)).toBe(180);
    expect(embeddedThumbnailAngle({ main: 6 }, thumb)).toBe(90);
    expect(embeddedThumbnailAngle({ main: 8 }, thumb)).toBe(270);
  });

  it("returns null for mirrored orientations", () => {
    for (const orientation of [2, 4, 5, 7]) {
      expect(embeddedThumbnailAngle({ main: orientation }, thumb)).toBeNull();
    }
  });

  it("prefers the thumbnail's own orientation", () => {
    expect(embeddedThumbnailAngle({ main: 6, thumbnail: 8 }, thumb)).toBe(270);
  });

  it("returns null when the embedded bytes carry their own orientation", () => {
    const nested = Buffer.from(
      piexif.insert(
        piexif.dump({ "0th": { [piexif.ImageIFD.Orientation]: 6 } }),
        thumb.toString("binary"),
      ),
      "binary",
    );
    expect(embeddedThumbnailAngle({ main: 6 }, nested)).toBeNull();
  });
});

describe("getThumbnail with EXIF orientation", () => {
  async function generatedThumbnail(filePath, cacheDirName) {
    const fileState = await stat(filePath);
    const file = { path: filePath, size: fileState.size, mtimeMs: fileState.mtimeMs };
    await getThumbnail(file, join(dir, cacheDirName));
    return join(dir, cacheDirName, thumbnailKey(file));
  }

  it("rotates the embedded thumbnail by the main orientation", async () => {
    const filePath = join(dir, "orient6.jpg");
    await makeOrientedJpeg(filePath, { mainOrientation: 6 });
    const meta = await sharp(await generatedThumbnail(filePath, "cache-orient6")).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(160);
  });

  it("rotates by 270 degrees for orientation 8", async () => {
    const filePath = join(dir, "orient8.jpg");
    await makeOrientedJpeg(filePath, { mainOrientation: 8 });
    const meta = await sharp(await generatedThumbnail(filePath, "cache-orient8")).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(160);
  });

  it("uses the thumbnail's own orientation when present", async () => {
    const filePath = join(dir, "orient-both.jpg");
    await makeOrientedJpeg(filePath, { mainOrientation: 6, thumbOrientation: 6 });
    const meta = await sharp(await generatedThumbnail(filePath, "cache-orient-both")).metadata();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(160);
  });

  it("falls back to the full decode for mirrored orientations", async () => {
    const filePath = join(dir, "orient5.jpg");
    await makeOrientedJpeg(filePath, { mainOrientation: 5 });
    const meta = await sharp(await generatedThumbnail(filePath, "cache-orient5")).metadata();
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(256);
  });
});
