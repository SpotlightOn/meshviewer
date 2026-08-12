import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freedesktopUri, getThumbnail, thumbnailKey } from "../../src/thumbnails.js";

let fixtureDir;
let cacheDir;
let largeFile;
let smallFile;
let brokenFile;
let desktopSource;
let desktopDir;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "meshviewer-thumb-"));
  cacheDir = join(fixtureDir, "cache");
  largeFile = join(fixtureDir, "large.png");
  smallFile = join(fixtureDir, "small.png");
  brokenFile = join(fixtureDir, "broken.png");
  desktopSource = join(fixtureDir, "desktop.png");
  desktopDir = join(fixtureDir, "xdg");
  process.env.XDG_CACHE_HOME = desktopDir;
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "#336699" } })
    .png()
    .toFile(largeFile);
  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#99cc33" } })
    .png()
    .toFile(smallFile);
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ff8800" } })
    .png()
    .toFile(desktopSource);
  await writeFile(brokenFile, "this is not an image");
});

afterAll(async () => {
  delete process.env.XDG_CACHE_HOME;
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("thumbnailKey", () => {
  it("is deterministic for the same file state", async () => {
    const fileState = await stat(largeFile);
    const file = { path: largeFile, size: fileState.size, mtimeMs: fileState.mtimeMs };
    expect(thumbnailKey(file)).toBe(thumbnailKey(file));
  });

  it("changes when size or mtime changes", async () => {
    const fileState = await stat(largeFile);
    const file = { path: largeFile, size: fileState.size, mtimeMs: fileState.mtimeMs };
    expect(thumbnailKey({ ...file, size: file.size + 1 })).not.toBe(thumbnailKey(file));
    expect(thumbnailKey({ ...file, mtimeMs: file.mtimeMs + 1 })).not.toBe(thumbnailKey(file));
  });
});

describe("getThumbnail", () => {
  it("generates a thumbnail on cache miss and reuses it on cache hit", async () => {
    const fileState = await stat(largeFile);
    const file = { path: largeFile, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const first = await getThumbnail(file, cacheDir);
    expect(first).toMatch(/^data:image\/jpeg;base64,/);
    const entries = await readdir(cacheDir);
    expect(entries).toHaveLength(1);
    const cached = await readFile(join(cacheDir, entries[0]));
    expect(first).toBe(`data:image/jpeg;base64,${cached.toString("base64")}`);
    const second = await getThumbnail(file, cacheDir);
    expect(second).toBe(first);
  });

  it("scales large images down to 256px", async () => {
    const fileState = await stat(largeFile);
    const file = { path: largeFile, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const key = thumbnailKey(file);
    await getThumbnail(file, cacheDir);
    const meta = await sharp(join(cacheDir, key)).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(192);
  });

  it("keeps small images at natural size", async () => {
    const fileState = await stat(smallFile);
    const file = { path: smallFile, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const key = thumbnailKey(file);
    await getThumbnail(file, cacheDir);
    const meta = await sharp(join(cacheDir, key)).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
  });

  it("regenerates the thumbnail when the file content changes", async () => {
    const target = join(fixtureDir, "changed.png");
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#111111" } })
      .png()
      .toFile(target);
    const state1 = await stat(target);
    const file1 = { path: target, size: state1.size, mtimeMs: state1.mtimeMs };
    const before = await getThumbnail(file1, cacheDir);
    await sharp({ create: { width: 128, height: 64, channels: 3, background: "#222222" } })
      .png()
      .toFile(target);
    const state2 = await stat(target);
    const file2 = { path: target, size: state2.size, mtimeMs: state2.mtimeMs };
    const after = await getThumbnail(file2, cacheDir);
    expect(thumbnailKey(file1)).not.toBe(thumbnailKey(file2));
    expect(after).not.toBe(before);
  });

  it("returns null when the file cannot be decoded", async () => {
    const fileState = await stat(brokenFile);
    const result = await getThumbnail(
      { path: brokenFile, size: fileState.size, mtimeMs: fileState.mtimeMs },
      cacheDir,
    );
    expect(result).toBeNull();
  });
});

describe("readFreedesktopThumbnail", () => {
  function desktopThumbPath() {
    const hash = createHash("md5").update(freedesktopUri(desktopSource)).digest("hex");
    return join(desktopDir, "thumbnails", "large", `${hash}.png`);
  }

  async function writeDesktopThumb() {
    const png = await sharp({
      create: { width: 256, height: 256, channels: 3, background: "#0000ff" },
    })
      .png()
      .toBuffer();
    await mkdir(join(desktopDir, "thumbnails", "large"), { recursive: true });
    await writeFile(
      desktopThumbPath(),
      Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), png]),
    );
  }

  it("uses a fresh freedesktop thumbnail without generating one", async () => {
    await writeDesktopThumb();
    const ownCache = join(fixtureDir, "cache-desktop-hit");
    const fileState = await stat(desktopSource);
    const file = { path: desktopSource, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const result = await getThumbnail(file, ownCache);
    expect(result).toMatch(/^data:image\/png;base64,/);
    const cached = await readFile(desktopThumbPath());
    const png = cached.subarray(8);
    expect(result).toBe(`data:image/png;base64,${png.toString("base64")}`);
    let ownEntries = [];
    try {
      ownEntries = await readdir(ownCache);
    } catch {
      // own cache directory was never created
    }
    expect(ownEntries).toHaveLength(0);
  });

  it("ignores a stale freedesktop thumbnail and falls back to sharp", async () => {
    await writeDesktopThumb();
    await utimes(desktopThumbPath(), 0, 0);
    const ownCache = join(fixtureDir, "cache-desktop-stale");
    const fileState = await stat(desktopSource);
    const file = { path: desktopSource, size: fileState.size, mtimeMs: fileState.mtimeMs };
    const result = await getThumbnail(file, ownCache);
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    expect(await readdir(ownCache)).toHaveLength(1);
  });
});
