import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findMediaFiles,
  listDirectories,
  parentDir,
  readFileBuffer,
  registerFsIpc,
} from "../../src/fsIpc.js";

let fixtureDir;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "meshviewer-test-"));
  await mkdir(join(fixtureDir, "sub"));
  await mkdir(join(fixtureDir, ".hidden"));
  const files = [
    "foto.png",
    "foto.jpg",
    "model.glb",
    "sub/inner.webp",
    ".hidden/secret.glb",
    "notes.txt",
    "archive.zip",
  ];
  for (const file of files) {
    const abs = join(fixtureDir, file);
    await writeFile(abs, `content of ${file}`);
  }

  await symlink(join(fixtureDir, "sub"), join(fixtureDir, "link-to-sub"));
  await symlink(join(fixtureDir, "foto.png"), join(fixtureDir, "link.png"));
  await symlink(join(fixtureDir, "does-not-exist"), join(fixtureDir, "broken-link"));
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("findMediaFiles", () => {
  it("collects glb and image files recursively, ignoring non-media files", async () => {
    const result = await findMediaFiles(fixtureDir);
    const names = result.map((f) => f.path.slice(fixtureDir.length + 1)).sort();
    expect(names).toEqual([
      ".hidden/secret.glb",
      "foto.jpg",
      "foto.png",
      "link-to-sub/inner.webp",
      "link.png",
      "model.glb",
      "sub/inner.webp",
    ]);
    expect(result.every((f) => f.type === "glb" || f.type === "image")).toBe(true);
    const glb = result.find((f) => f.name === "model.glb");
    expect(glb.type).toBe("glb");
    expect(glb.size).toBeGreaterThan(0);
    expect(glb.path).toBe(join(fixtureDir, "model.glb"));
  });

  it("returns an empty array for an empty directory", async () => {
    const empty = await mkdtemp(join(tmpdir(), "meshviewer-empty-"));
    try {
      expect(await findMediaFiles(empty)).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("traverses symlinked directories and collects symlinked media files", async () => {
    const result = await findMediaFiles(fixtureDir);
    const names = result.map((f) => f.name);
    expect(names).toContain("inner.webp");
    expect(names).toContain("link.png");
  });
});

describe("listDirectories", () => {
  it("returns visible subdirectories sorted by name", async () => {
    const result = await listDirectories(fixtureDir);
    expect(result).toEqual([
      { path: join(fixtureDir, "link-to-sub"), name: "link-to-sub" },
      { path: join(fixtureDir, "sub"), name: "sub" },
    ]);
  });

  it("returns an empty array for a non-existent path", async () => {
    expect(await listDirectories(join(fixtureDir, "missing"))).toEqual([]);
  });

  it("includes symlinks that point to directories", async () => {
    const result = await listDirectories(fixtureDir);
    expect(result).toContainEqual({ path: join(fixtureDir, "link-to-sub"), name: "link-to-sub" });
  });

  it("ignores broken symlinks and symlinks to files", async () => {
    const result = await listDirectories(fixtureDir);
    expect(result.map((d) => d.name)).not.toContain("broken-link");
    expect(result.map((d) => d.name)).not.toContain("link.png");
  });
});

describe("parentDir", () => {
  it("returns the directory itself at the filesystem root", () => {
    expect(parentDir("/")).toBe("/");
  });

  it("returns the parent for nested paths", () => {
    expect(parentDir(join(fixtureDir, "sub"))).toBe(fixtureDir);
  });
});

describe("readFileBuffer", () => {
  it("returns the exact file content as an ArrayBuffer", async () => {
    const file = join(fixtureDir, "foto.png");
    const buffer = await readFileBuffer(file);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(await readFile(file)));
  });
});

describe("registerFsIpc", () => {
  function createFakes() {
    const handlers = {};
    const ipcMain = {
      handle: (channel, fn) => {
        handlers[channel] = fn;
      },
    };
    const app = {
      getPath: () => "/home/pi",
      getLocale: () => "de-DE",
    };
    const shell = { openPath: () => Promise.resolve("") };
    return { handlers, ipcMain, app, shell };
  }

  it("registers all expected channels", () => {
    const { handlers, ipcMain, app, shell } = createFakes();
    registerFsIpc(ipcMain, app, shell);
    const channels = [
      "fs:listMediaFiles",
      "fs:listDirectories",
      "fs:homeDir",
      "fs:cwd",
      "fs:locale",
      "fs:rootDir",
      "fs:parentDir",
      "fs:readFile",
      "shell:openPath",
    ];
    for (const channel of channels) {
      expect(typeof handlers[channel]).toBe("function");
    }
  });

  it("exposes app-provided values through handlers", async () => {
    const { handlers, ipcMain, app, shell } = createFakes();
    registerFsIpc(ipcMain, app, shell);
    expect(await handlers["fs:homeDir"]()).toBe("/home/pi");
    expect(await handlers["fs:locale"]()).toBe("de-DE");
    expect(await handlers["fs:rootDir"]()).toBe("/");
    expect(await handlers["fs:parentDir"](null, "/home/pi")).toBe("/home");
    expect(await handlers["fs:parentDir"](null, "/")).toBe("/");
  });

  it("serves real filesystem data through the handlers", async () => {
    const { handlers, ipcMain, app, shell } = createFakes();
    registerFsIpc(ipcMain, app, shell);
    const dirs = await handlers["fs:listDirectories"](null, fixtureDir);
    expect(dirs.map((d) => d.name)).toEqual(["link-to-sub", "sub"]);
    const media = await handlers["fs:listMediaFiles"](null, fixtureDir);
    expect(media.map((f) => f.name)).toContain("model.glb");
    const buffer = await handlers["fs:readFile"](null, join(fixtureDir, "foto.png"));
    expect(buffer.byteLength).toBe("content of foto.png".length);
  });
});
