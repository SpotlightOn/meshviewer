import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readExif } from "./exif.js";
import { getThumbnail } from "./thumbnails.js";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".svg",
  ".ico",
]);

/**
 * Checks whether a path points to a directory (following symlinks).
 * @param {string} fullPath - Absolute path.
 * @returns {Promise<boolean>} true if the target is a directory.
 */
async function isDirectory(fullPath) {
  try {
    return (await fsp.stat(fullPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lists the media files (GLB and images) directly inside a directory.
 * Subdirectories are not scanned; they are handled by the directory tree.
 * @param {string} dir - Directory to scan.
 * @returns {Promise<Array<{path: string, name: string, size: number, mtimeMs: number, type: 'glb'|'image'}>>} List of media files.
 * @throws {Error} When the directory does not exist (ENOENT).
 */
async function listMediaFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw error; // a missing folder is not an empty folder
    return []; // unreadable directory
  }
  const jobs = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile()) {
      jobs.push(
        fsp.stat(fullPath).then(
          (stat) => ({ entry, fullPath, stat }),
          () => null, // file vanished or its name cannot be re-encoded
        ),
      );
    } else if (entry.isSymbolicLink()) {
      jobs.push(
        fsp.stat(fullPath).then(
          (stat) => (stat.isFile() ? { entry, fullPath, stat } : null),
          () => null, // broken symlink
        ),
      );
    }
  }
  const results = [];
  for (const job of await Promise.all(jobs)) {
    if (!job) continue;
    const { entry, fullPath, stat } = job;
    const ext = path.extname(entry.name).toLowerCase();
    let type = null;
    if (ext === ".glb") {
      type = "glb";
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      type = "image";
    }
    if (!type) {
      continue;
    }
    results.push({
      path: fullPath,
      name: entry.name,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      type,
    });
  }
  return results;
}

/**
 * Lists the visible subdirectories of a directory, sorted by name.
 * @param {string} dirPath - Parent directory.
 * @returns {Promise<Array<{path: string, name: string}>>} List of subdirectories.
 */
async function listDirectories(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const dirs = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(fullPath)))) {
        dirs.push({ path: fullPath, name: entry.name });
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Returns the parent directory, or the directory itself at the filesystem root.
 * @param {string} dirPath - Directory path.
 * @returns {string} Parent directory path.
 */
function parentDir(dirPath) {
  if (dirPath === path.parse(dirPath).root) return dirPath;
  return path.dirname(dirPath);
}

/**
 * Reads a file and returns its content as an ArrayBuffer.
 * @param {string} filePath - Absolute file path.
 * @returns {Promise<ArrayBuffer>} File content.
 */
async function readFileBuffer(filePath) {
  const data = await fsp.readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/**
 * Checks whether a path exists.
 * @param {string} filePath - Absolute path.
 * @returns {Promise<boolean>} true when the path exists.
 */
async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a non-colliding target path inside a directory. Existing names get
 * a " (1)", " (2)", … suffix before the extension.
 * @param {string} dir - Target directory.
 * @param {string} fileName - Original file name.
 * @returns {Promise<string>} Free absolute target path.
 */
async function uniqueTargetPath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let counter = 1;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base} (${counter})${ext}`);
    counter += 1;
  }
  return candidate;
}

/**
 * Copies files into a target directory. Existing files are renamed with a
 * " (1)", " (2)" suffix; each failed file is reported individually.
 * @param {Array<string>} sources - Absolute source file paths.
 * @param {string} targetDir - Destination directory.
 * @returns {Promise<Array<{source: string, target: string, ok: boolean, error?: string}>>} Per-file results.
 */
async function copyFiles(sources, targetDir) {
  const results = [];
  for (const source of sources) {
    const fallbackTarget = path.join(targetDir, path.basename(source));
    try {
      const stat = await fsp.stat(source);
      if (!stat.isFile()) throw new Error("not a file");
      const target = await uniqueTargetPath(targetDir, path.basename(source));
      await fsp.copyFile(source, target);
      results.push({ source, target, ok: true });
    } catch (error) {
      results.push({
        source,
        target: fallbackTarget,
        ok: false,
        error: error?.message ?? String(error),
      });
    }
  }
  return results;
}

/**
 * Creates a new directory inside a parent directory. Names containing path
 * separators, empty names and the special names "." and ".." are rejected.
 * @param {string} parentDir - Parent directory.
 * @param {string} name - Name of the new directory.
 * @returns {Promise<{ok: true, path: string} | {ok: false, code: 'invalid'|'exists'|'failed'}>} Creation result.
 */
async function createDirectory(parentDir, name) {
  if (
    typeof name !== "string" ||
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    return { ok: false, code: "invalid" };
  }
  const target = path.join(parentDir, name);
  try {
    await fsp.mkdir(target);
    return { ok: true, path: target };
  } catch (error) {
    if (error?.code === "EEXIST") return { ok: false, code: "exists" };
    return { ok: false, code: "failed" };
  }
}

/** Permission bits preserved when a file is copied as part of a move. */
const MODE_MASK = 0o7777;

/**
 * Computes the SHA-256 checksum of a file.
 * @param {string} filePath - Absolute file path.
 * @returns {Promise<string>} Lowercase hex digest.
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Copies a single file and keeps the copy only once it is verified to be
 * complete: the target size always has to match the source and, when
 * `options.checksum` is set, both files are compared by their SHA-256 digest.
 * The source permission bits and timestamps are applied to the copy. When
 * anything fails the partial target is removed so the source stays intact.
 * The copy is created exclusively (`COPYFILE_EXCL`) so an existing target is
 * never overwritten.
 * @param {string} source - Absolute source file path.
 * @param {string} target - Absolute destination file path.
 * @param {import("node:fs").Stats} stat - Stat of the source file.
 * @param {{checksum?: boolean}} [options] - Verification options.
 * @returns {Promise<void>} Resolves when a verified copy exists.
 */
async function copyFileVerified(source, target, stat, options = {}) {
  await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  try {
    const [sourceStat, targetStat] = await Promise.all([fsp.stat(source), fsp.stat(target)]);
    if (sourceStat.size !== targetStat.size) throw new Error("size mismatch");
    if (options.checksum) {
      const [sourceHash, targetHash] = await Promise.all([sha256File(source), sha256File(target)]);
      if (sourceHash !== targetHash) throw new Error("checksum mismatch");
    }
    await fsp.chmod(target, stat.mode & MODE_MASK);
    await fsp.utimes(target, stat.atime, stat.mtime);
  } catch (error) {
    await fsp.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Moves a single file into a target directory. When the target is on the same
 * filesystem the file is renamed: this is atomic, never copies data and
 * preserves every attribute. Crossing a filesystem boundary (EXDEV) falls
 * back to a verified copy with attribute preservation; only after the copy is
 * confirmed is the source removed. Files already inside the target directory
 * are reported as unchanged.
 * @param {string} source - Absolute source file path.
 * @param {string} targetDir - Destination directory.
 * @param {{checksum?: boolean}} [options] - Move options.
 * @returns {Promise<{source: string, target: string, ok: boolean, error?: string, unchanged?: boolean}>} Result for the file.
 */
async function moveFile(source, targetDir, options = {}) {
  const fallbackTarget = path.join(targetDir, path.basename(source));
  try {
    const stat = await fsp.stat(source);
    if (!stat.isFile()) throw new Error("not a file");
    if (path.dirname(source) === path.normalize(targetDir)) {
      return { source, target: source, ok: true, unchanged: true };
    }
    const target = await uniqueTargetPath(targetDir, path.basename(source));
    try {
      await fsp.rename(source, target);
    } catch (error) {
      if (error?.code !== "EXDEV") throw error;
      await copyFileVerified(source, target, stat, options);
      await fsp.unlink(source);
    }
    return { source, target, ok: true };
  } catch (error) {
    return { source, target: fallbackTarget, ok: false, error: error?.message ?? String(error) };
  }
}

/**
 * Moves files into a target directory. Same-filesystem moves use an atomic
 * rename; cross-filesystem moves copy the file first and remove the source
 * only after the copy was verified (see {@link moveFile}). Files that already
 * live in the target directory are reported as unchanged. Existing names in
 * the target get a " (1)", " (2)" suffix; each failed file is reported
 * individually.
 * @param {Array<string>} sources - Absolute source file paths.
 * @param {string} targetDir - Destination directory.
 * @param {{checksum?: boolean}} [options] - Move options; `checksum` compares SHA-256 digests on cross-filesystem copies.
 * @returns {Promise<Array<{source: string, target: string, ok: boolean, error?: string, unchanged?: boolean}>>} Per-file results.
 */
async function moveFiles(sources, targetDir, options = {}) {
  const results = [];
  for (const source of sources) {
    results.push(await moveFile(source, targetDir, options));
  }
  return results;
}

/**
 * Moves files to the operating system trash.
 * @param {Array<string>} paths - Absolute file paths.
 * @param {{trashItem: (path: string) => Promise<void>}} shell - Electron shell module.
 * @returns {Promise<{trashed: Array<string>, failed: Array<{path: string, error: string}>}>} Trash results.
 */
async function trashFiles(paths, shell) {
  const settled = await Promise.allSettled(paths.map((filePath) => shell.trashItem(filePath)));
  const trashed = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      trashed.push(paths[index]);
    } else {
      failed.push({ path: paths[index], error: result.reason?.message ?? String(result.reason) });
    }
  });
  return { trashed, failed };
}

/**
 * Registers the filesystem and shell IPC handlers on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 * @param {{getPath: Function, getLocale: Function}} app - The Electron app module.
 * @param {{openPath: Function, trashItem: Function}} shell - The Electron shell module.
 */
function registerFsIpc(ipcMain, app, shell) {
  const cacheDir = path.join(app.getPath("userData"), "thumbnails");
  ipcMain.handle("fs:listMediaFiles", (_event, dirPath) => listMediaFiles(dirPath));
  ipcMain.handle("fs:listDirectories", (_event, dirPath) => listDirectories(dirPath));
  ipcMain.handle("fs:homeDir", () => app.getPath("home"));
  ipcMain.handle("fs:cwd", () => process.cwd());
  ipcMain.handle("fs:locale", () => app.getLocale());
  ipcMain.handle("fs:rootDir", () => path.parse(app.getPath("home")).root);
  ipcMain.handle("fs:parentDir", (_event, dirPath) => parentDir(dirPath));
  ipcMain.handle("fs:readFile", (_event, filePath) => readFileBuffer(filePath));
  ipcMain.handle("fs:exif", (_event, filePath) => readExif(filePath));
  ipcMain.handle("fs:getThumbnail", (_event, file) => getThumbnail(file, cacheDir));
  ipcMain.handle("fs:copyFiles", (_event, sources, targetDir) => copyFiles(sources, targetDir));
  ipcMain.handle("fs:createDirectory", (_event, parentDir, name) =>
    createDirectory(parentDir, name),
  );
  ipcMain.handle("fs:moveFiles", (_event, sources, targetDir, options) =>
    moveFiles(sources, targetDir, options),
  );
  ipcMain.handle("fs:trashFiles", (_event, paths) => trashFiles(paths, shell));
  ipcMain.handle("shell:openPath", (_event, filePath) => shell.openPath(filePath));
}

export {
  copyFiles,
  copyFileVerified,
  createDirectory,
  IMAGE_EXTENSIONS,
  listDirectories,
  listMediaFiles,
  moveFiles,
  parentDir,
  readFileBuffer,
  registerFsIpc,
  trashFiles,
  uniqueTargetPath,
};
