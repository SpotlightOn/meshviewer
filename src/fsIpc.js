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
  ipcMain.handle("fs:trashFiles", (_event, paths) => trashFiles(paths, shell));
  ipcMain.handle("shell:openPath", (_event, filePath) => shell.openPath(filePath));
}

export {
  copyFiles,
  createDirectory,
  IMAGE_EXTENSIONS,
  listDirectories,
  listMediaFiles,
  parentDir,
  readFileBuffer,
  registerFsIpc,
  trashFiles,
  uniqueTargetPath,
};
