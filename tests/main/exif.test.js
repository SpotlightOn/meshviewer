import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readExif } from "../../src/exif.js";

let fixtureDir;

/**
 * Builds a minimal JPEG that carries three EXIF IFD0 tags (Make, Model and
 * Orientation) in a little-endian APP1 segment.
 * @returns {Buffer} JPEG file content.
 */
function buildExifJpeg() {
  const tiff = Buffer.alloc(63);
  tiff.write("II", 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(3, 8);
  tiff.writeUInt16LE(0x010f, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(8, 14);
  tiff.writeUInt32LE(50, 18);
  tiff.writeUInt16LE(0x0110, 22);
  tiff.writeUInt16LE(2, 24);
  tiff.writeUInt32LE(5, 26);
  tiff.writeUInt32LE(58, 30);
  tiff.writeUInt16LE(0x0112, 34);
  tiff.writeUInt16LE(3, 36);
  tiff.writeUInt32LE(1, 38);
  tiff.writeUInt16LE(6, 42);
  tiff.writeUInt32LE(0, 46);
  tiff.write("TestCam\0", 50);
  tiff.write("X100\0", 58);

  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1Length = payload.length + 2;
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff]),
    payload,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "meshviewer-exif-"));
  await writeFile(join(fixtureDir, "exif.jpg"), buildExifJpeg());
  await writeFile(join(fixtureDir, "notes.txt"), "no image at all");
  const plainJpeg = await sharp({
    create: { width: 8, height: 6, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
  await writeFile(join(fixtureDir, "plain.jpg"), plainJpeg);
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("readExif", () => {
  it("reads the EXIF tag groups of a JPEG", async () => {
    const tags = await readExif(join(fixtureDir, "exif.jpg"));
    expect(tags).not.toBeNull();
    expect(tags.exif.Make.description).toBe("TestCam");
    expect(tags.exif.Model.value).toEqual(["X100"]);
  });

  it("returns the format groups for an image without EXIF data", async () => {
    const tags = await readExif(join(fixtureDir, "plain.jpg"));
    expect(tags).not.toBeNull();
    expect(tags.file).toBeDefined();
  });

  it("returns null for a file that is not an image", async () => {
    expect(await readExif(join(fixtureDir, "notes.txt"))).toBeNull();
  });

  it("returns null for a missing file", async () => {
    expect(await readExif(join(fixtureDir, "missing.jpg"))).toBeNull();
  });
});
