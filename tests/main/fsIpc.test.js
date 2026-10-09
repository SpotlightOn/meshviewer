import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  copyFiles,
  createDirectory,
  listDirectories,
  listMediaFiles,
  parentDir,
  readFileBuffer,
  registerFsIpc,
  trashFiles,
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

describe("listMediaFiles", () => {
  it("lists media files directly in the directory, ignoring non-media files", async () => {
    const result = await listMediaFiles(fixtureDir);
    const names = result.map((f) => f.path.slice(fixtureDir.length + 1)).sort();
    expect(names).toEqual(["foto.jpg", "foto.png", "link.png", "model.glb"]);
    expect(result.every((f) => f.type === "glb" || f.type === "image")).toBe(true);
    const glb = result.find((f) => f.name === "model.glb");
    expect(glb.type).toBe("glb");
    expect(glb.size).toBeGreaterThan(0);
    expect(glb.path).toBe(join(fixtureDir, "model.glb"));
  });

  it("does not recurse into subdirectories", async () => {
    const result = await listMediaFiles(fixtureDir);
    expect(result.map((f) => f.name)).not.toContain("inner.webp");
    expect(result.map((f) => f.name)).not.toContain("secret.glb");
  });

  it("includes symlinks that point to media files", async () => {
    const result = await listMediaFiles(fixtureDir);
    expect(result.map((f) => f.name)).toContain("link.png");
  });

  it("returns an empty array for an empty directory", async () => {
    const empty = await mkdtemp(join(tmpdir(), "meshviewer-empty-"));
    try {
      expect(await listMediaFiles(empty)).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("rejects for a non-existent directory", async () => {
    await expect(listMediaFiles(join(fixtureDir, "missing"))).rejects.toThrow();
  });

  it("skips directories without read permission instead of throwing", async () => {
    const locked = await mkdtemp(join(tmpdir(), "meshviewer-locked-"));
    await mkdir(join(locked, "locked-sub"));
    await writeFile(join(locked, "locked-sub", "secret.png"), "secret");
    await writeFile(join(locked, "open.png"), "open");
    try {
      await chmod(join(locked, "locked-sub"), 0o000);
      if (typeof process.getuid === "function" && process.getuid() === 0) {
        return; // root ignores permissions
      }
      const result = await listMediaFiles(locked);
      expect(result.map((f) => f.name)).toEqual(["open.png"]);
    } finally {
      await chmod(join(locked, "locked-sub"), 0o755);
      await rm(locked, { recursive: true, force: true });
    }
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

describe("copyFiles", () => {
  it("copies a file into the target directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meshviewer-copy-"));
    try {
      const source = join(dir, "a.png");
      const targetDir = join(dir, "target");
      await mkdir(targetDir);
      await writeFile(source, "hello");

      const results = await copyFiles([source], targetDir);

      expect(results).toEqual([{ source, target: join(targetDir, "a.png"), ok: true }]);
      expect(await readFile(join(targetDir, "a.png"), "utf8")).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renames on name collisions with a (1), (2) suffix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meshviewer-copy-"));
    try {
      const source = join(dir, "a.png");
      const targetDir = join(dir, "target");
      await mkdir(targetDir);
      await writeFile(source, "hello");
      await writeFile(join(targetDir, "a.png"), "existing");
      await writeFile(join(targetDir, "a (1).png"), "existing");

      const results = await copyFiles([source], targetDir);

      expect(results[0].target).toBe(join(targetDir, "a (2).png"));
      expect(results[0].ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports missing sources as failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meshviewer-copy-"));
    try {
      const targetDir = join(dir, "target");
      await mkdir(targetDir);
      const missing = join(dir, "missing.png");

      const results = await copyFiles([missing], targetDir);

      expect(results[0].ok).toBe(false);
      expect(results[0].source).toBe(missing);
      expect(typeof results[0].error).toBe("string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects directories as sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meshviewer-copy-"));
    try {
      const source = join(dir, "sub");
      const targetDir = join(dir, "target");
      await mkdir(source);
      await mkdir(targetDir);

      const results = await copyFiles([source], targetDir);

      expect(results[0].ok).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createDirectory", () => {
  it("creates a new directory inside the parent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meshviewer-mkdir-"));
    try {
      const result = await createDirectory(dir, "Neu");
      expect(result.ok).toBe(true);
      expect(result.path).toBe(join(dir, "Neu"));
      const stat = await import("node:fs/promises").then(({ stat }) => stat(result.path));
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an existing name with the exists code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "meshviewer-mkdir-"));
    try {
      await mkdir(join(dir, "sub"));
      const result = await createDirectory(dir, "sub");
      expect(result).toEqual({ ok: false, code: "exists" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid names", async () => {
    for (const name of ["", ".", "..", "a/b", "a\\b", "a\0b", null, 42]) {
      const result = await createDirectory("/tmp", name);
      expect(result).toEqual({ ok: false, code: "invalid" });
    }
  });
});

describe("trashFiles", () => {
  it("collects successful and failed paths", async () => {
    const shell = {
      trashItem: async (filePath) => {
        if (filePath === "/b") throw new Error("permission denied");
      },
    };

    const result = await trashFiles(["/a", "/b"], shell);

    expect(result.trashed).toEqual(["/a"]);
    expect(result.failed).toEqual([{ path: "/b", error: "permission denied" }]);
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
    const shell = {
      openPath: () => Promise.resolve(""),
      trashItem: () => Promise.resolve(),
    };
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
      "fs:exif",
      "fs:getThumbnail",
      "fs:copyFiles",
      "fs:createDirectory",
      "fs:trashFiles",
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
