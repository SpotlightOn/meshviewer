import { describe, expect, it } from "vitest";
import { formatSize, mimeFor, toArrayBuffer } from "../../src/renderer/utils.js";

describe("formatSize", () => {
  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(15360)).toBe("15.0 KB");
  });

  it("formats megabytes with two decimals", () => {
    expect(formatSize(1024 * 1024)).toBe("1.00 MB");
    expect(formatSize(2 * 1024 * 1024 + 512 * 1024)).toBe("2.50 MB");
  });
});

describe("mimeFor", () => {
  it("maps known extensions to MIME types", () => {
    expect(mimeFor("photo.png")).toBe("image/png");
    expect(mimeFor("photo.jpg")).toBe("image/jpeg");
    expect(mimeFor("photo.jpeg")).toBe("image/jpeg");
    expect(mimeFor("photo.gif")).toBe("image/gif");
    expect(mimeFor("photo.webp")).toBe("image/webp");
    expect(mimeFor("photo.avif")).toBe("image/avif");
    expect(mimeFor("photo.bmp")).toBe("image/bmp");
    expect(mimeFor("photo.svg")).toBe("image/svg+xml");
    expect(mimeFor("photo.ico")).toBe("image/x-icon");
  });

  it("is case-insensitive", () => {
    expect(mimeFor("PHOTO.PNG")).toBe("image/png");
    expect(mimeFor("Photo.WebP")).toBe("image/webp");
  });

  it("falls back for unknown extensions", () => {
    expect(mimeFor("model.glb")).toBe("application/octet-stream");
    expect(mimeFor("noextension")).toBe("application/octet-stream");
  });
});

describe("toArrayBuffer", () => {
  it("returns ArrayBuffer as-is", () => {
    const buffer = new ArrayBuffer(8);
    expect(toArrayBuffer(buffer)).toBe(buffer);
  });

  it("extracts the exact view slice from a Buffer-like object", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer;
    const view = new Uint8Array(backing, 2, 4);
    const result = toArrayBuffer(view);
    expect(result.byteLength).toBe(4);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([2, 3, 4, 5]));
  });
});
