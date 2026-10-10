import { describe, expect, it } from "vitest";
import {
  clampZoom,
  clampZoomPercent,
  EQUIRECT_FOV_MAX,
  EQUIRECT_FOV_MIN,
  exifTagLabel,
  exifToSections,
  fileInfoRows,
  formatSize,
  fovForPercent,
  glbDistanceForPercent,
  glbPercentForDistance,
  imageDataUrl,
  isPixmap,
  mimeFor,
  parseZoomPercent,
  percentForFov,
  toArrayBuffer,
  zoomPercent,
  zoomScale,
} from "../../src/renderer/utils.js";

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

describe("isPixmap", () => {
  it("accepts raster image formats", () => {
    for (const name of [
      "photo.png",
      "photo.jpg",
      "photo.jpeg",
      "photo.gif",
      "photo.webp",
      "photo.avif",
      "photo.bmp",
    ]) {
      expect(isPixmap(name)).toBe(true);
    }
  });

  it("rejects vector, icon, 3D and unknown formats", () => {
    expect(isPixmap("photo.svg")).toBe(false);
    expect(isPixmap("photo.ico")).toBe(false);
    expect(isPixmap("model.glb")).toBe(false);
    expect(isPixmap("README.md")).toBe(false);
    expect(isPixmap("noextension")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPixmap("FOTO.JPG")).toBe(true);
    expect(isPixmap("Photo.WebP")).toBe(true);
    expect(isPixmap("PHOTO.SVG")).toBe(false);
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

describe("zoom helpers", () => {
  it("clamps scale factors to the 10-800 % range", () => {
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(0.05)).toBe(0.1);
    expect(clampZoom(64)).toBe(8);
    expect(clampZoom(1)).toBe(1);
  });

  it("converts between scale factors and percentages", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomScale(100)).toBe(1);
    expect(zoomPercent(0.361)).toBe(36);
    expect(zoomScale(250)).toBe(2.5);
    expect(zoomPercent(9)).toBe(800);
    expect(zoomScale(2)).toBe(0.1);
  });

  it("clamps percentages to the slider range", () => {
    expect(clampZoomPercent(50)).toBe(50);
    expect(clampZoomPercent(5)).toBe(10);
    expect(clampZoomPercent(9000)).toBe(800);
  });

  it("maps GLB distance and percent inversely", () => {
    expect(glbDistanceForPercent(100, 100)).toBe(100);
    expect(glbDistanceForPercent(100, 200)).toBe(50);
    expect(glbDistanceForPercent(100, 10)).toBe(1000);
    expect(glbDistanceForPercent(100, 800)).toBe(12.5);
    expect(glbPercentForDistance(100, 50)).toBe(200);
    expect(glbPercentForDistance(100, 12.5)).toBe(800);
    expect(glbPercentForDistance(100, 1000)).toBe(10);
  });

  it("parses zoom text input", () => {
    expect(parseZoomPercent("80")).toBe(80);
    expect(parseZoomPercent("80%")).toBe(80);
    expect(parseZoomPercent(" 120 %")).toBe(120);
    expect(parseZoomPercent("37.4%")).toBe(37);
    expect(parseZoomPercent("0")).toBe(0);
    expect(parseZoomPercent("")).toBe(null);
    expect(parseZoomPercent("abc")).toBe(null);
    expect(parseZoomPercent("80px")).toBe(null);
    expect(parseZoomPercent("%")).toBe(null);
  });

  it("maps equirectangular zoom percentages to fields of view", () => {
    expect(fovForPercent(10)).toBe(EQUIRECT_FOV_MAX);
    expect(fovForPercent(800)).toBe(EQUIRECT_FOV_MIN);
    expect(fovForPercent(100)).toBeCloseTo(
      EQUIRECT_FOV_MAX - (90 * (EQUIRECT_FOV_MAX - EQUIRECT_FOV_MIN)) / 790,
      6,
    );
    expect(fovForPercent(5)).toBe(EQUIRECT_FOV_MAX);
    expect(fovForPercent(9000)).toBe(EQUIRECT_FOV_MIN);
  });

  it("maps fields of view back to zoom percentages", () => {
    expect(percentForFov(EQUIRECT_FOV_MAX)).toBe(10);
    expect(percentForFov(EQUIRECT_FOV_MIN)).toBe(800);
    expect(percentForFov(100)).toBe(10);
    expect(percentForFov(1)).toBe(800);
  });

  it("round-trips between zoom percentages and fields of view", () => {
    expect(percentForFov(fovForPercent(100))).toBe(100);
    expect(percentForFov(fovForPercent(250))).toBe(250);
    expect(percentForFov(fovForPercent(37))).toBe(37);
  });
});

describe("exifTagLabel", () => {
  it("splits camel-case tag names into readable labels", () => {
    expect(exifTagLabel("ExposureTime")).toBe("Exposure Time");
    expect(exifTagLabel("FNumber")).toBe("F Number");
    expect(exifTagLabel("GPSPosition")).toBe("GPS Position");
    expect(exifTagLabel("DateTimeOriginal")).toBe("Date Time Original");
    expect(exifTagLabel("Make")).toBe("Make");
    expect(exifTagLabel("ISO")).toBe("ISO");
  });
});

describe("exifToSections", () => {
  it("returns no sections for missing or empty tags", () => {
    expect(exifToSections(null)).toEqual([]);
    expect(exifToSections(undefined)).toEqual([]);
    expect(exifToSections({})).toEqual([]);
  });

  it("drops groups that only carry file-format data", () => {
    expect(
      exifToSections({
        file: { FileType: { description: "JPEG" }, FileSize: { value: 1024 } },
        png: { "Image Width": { value: 8 } },
        pngFile: { "Bit Depth": { value: 8 } },
        gif: { Width: { value: 8 } },
        bmpFile: { Width: { value: 8 } },
      }),
    ).toEqual([]);
  });

  it("keeps EXIF groups, prettifies tag names and reads the description", () => {
    const sections = exifToSections({
      file: { FileType: { description: "JPEG" } },
      exif: {
        ExposureTime: { description: "1/125 s" },
        Make: { description: "Canon" },
        EmptyTag: { value: undefined },
      },
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].group).toBe("exif");
    expect(sections[0].rows).toEqual([
      { label: "Exposure Time", value: "1/125 s" },
      { label: "Make", value: "Canon" },
    ]);
  });

  it("joins array values and unwraps nested value objects", () => {
    const sections = exifToSections({
      gps: {
        GPSPosition: { value: ["50.1", "8.6"] },
        LensModel: { value: { description: "50mm f/1.8" } },
        RawNumber: { value: 24 },
      },
    });
    expect(sections[0].rows).toEqual([
      { label: "GPS Position", value: "50.1, 8.6" },
      { label: "Lens Model", value: "50mm f/1.8" },
      { label: "Raw Number", value: "24" },
    ]);
  });

  it("renders the embedded preview stored at group level as an image row", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const sections = exifToSections({
      Thumbnail: {
        ImageWidth: { value: 120, description: 120 },
        image: bytes,
        type: "image/jpeg",
        base64: "bm90LXVzZWQ=",
      },
    });
    expect(sections).toHaveLength(1);
    const [preview, width] = sections[0].rows;
    expect(preview.image).toBe(`data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`);
    expect(preview.labelKey).toBe("info.embeddedThumbnail");
    expect(width).toEqual({ label: "Image Width", value: "120" });
  });

  it("renders binary image tags (ThumbnailImage) as image rows", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const sections = exifToSections({
      thumbnail: {
        ThumbnailImage: { value: bytes },
      },
    });
    expect(sections[0].rows).toEqual([
      {
        label: "Thumbnail Image",
        image: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      },
    ]);
  });

  it("drops unreadable binary blobs and camera junk payloads", () => {
    const byteObject = {};
    for (let i = 0; i < 64; i += 1) byteObject[i] = i;
    const sections = exifToSections({
      exif: {
        MakerNote: { value: byteObject, description: "[Raw maker note data]" },
      },
      xmp: {
        hdrp_makernote: { value: "SERSUALvZDVtXnAeLOrjTdkaADX6N".repeat(40) },
        shot_log_data: { value: "SERSUALvZDVtXnAeLOrjQ5jeJsa4v".repeat(40) },
        HasExtendedXMP: { value: "C68D43EE9A", description: "C68D43EE9A" },
      },
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].group).toBe("xmp");
    expect(sections[0].rows).toEqual([{ label: "Has Extended XMP", value: "C68D43EE9A" }]);
  });
});

describe("imageDataUrl", () => {
  it("detects JPEG, PNG, GIF, WebP and BMP magic bytes", () => {
    expect(imageDataUrl(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20]))).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect(imageDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(imageDataUrl(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toMatch(
      /^data:image\/gif;base64,/,
    );
    expect(
      imageDataUrl(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toMatch(/^data:image\/webp;base64,/);
    expect(imageDataUrl(new Uint8Array([0x42, 0x4d, 0x10, 0x20]))).toMatch(
      /^data:image\/bmp;base64,/,
    );
  });

  it("prefers the parser MIME hint over magic bytes", () => {
    expect(imageDataUrl(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/png")).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("returns null for non-image bytes and empty input", () => {
    expect(imageDataUrl(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
    expect(imageDataUrl(new Uint8Array(0))).toBeNull();
    expect(imageDataUrl(new ArrayBuffer(4))).toBeNull();
  });

  it("encodes blobs larger than one chunk correctly", () => {
    const bytes = new Uint8Array(100_000);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    expect(imageDataUrl(bytes)).toBe(
      `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
    );
  });

  it("rejects oversized blobs that would bloat the dialog", () => {
    const bytes = new Uint8Array(1024 * 1024 + 1);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    expect(imageDataUrl(bytes)).toBeNull();
  });
});

describe("fileInfoRows", () => {
  const file = { name: "foto.JPG", size: 2048, mtimeMs: Date.UTC(2026, 0, 15, 12, 0, 0) };

  it("provides size, modified date and type without pixel dimensions", () => {
    const rows = fileInfoRows(file);
    expect(rows.map((row) => row.key)).toEqual(["size", "modified", "type"]);
    const size = rows.find((row) => row.key === "size");
    expect(size.value).toBe("2.0 KB");
    const type = rows.find((row) => row.key === "type");
    expect(type.value).toBe("JPG");
    const modified = rows.find((row) => row.key === "modified");
    expect(modified.value).toContain("2026");
  });

  it("adds the dimensions row when the pixel size is known", () => {
    const rows = fileInfoRows(file, { width: 800, height: 600 });
    expect(rows.map((row) => row.key)).toEqual(["size", "dimensions", "modified", "type"]);
    expect(rows[1].value).toBe("800x600");
  });

  it("skips the type row for names without an extension", () => {
    const rows = fileInfoRows({ name: "README", size: 10, mtimeMs: 0 });
    expect(rows.map((row) => row.key)).toEqual(["size", "modified"]);
  });
});
