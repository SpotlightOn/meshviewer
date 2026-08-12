const path = require("node:path");
const fsp = require("node:fs/promises");
const { getThumbnail } = require("./thumbnails.js");

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
 * Classifies a directory entry and resolves its media files (with parallel I/O).
 * @param {string} dir - Parent directory.
 * @param {Set<string>} ancestors - Realpaths of the directories in the current recursion path.
 * @returns {Promise<Array<{path: string, name: string, size: number, mtimeMs: number, type: 'glb'|'image'}>>} Media files of the entry.
 */
async function findMediaEntry(dir, entry, ancestors) {
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    return findMediaFiles(fullPath, ancestors);
  }
  let stat;
  if (entry.isSymbolicLink()) {
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      return []; // broken symlink
    }
    if (stat.isDirectory()) {
      return findMediaFiles(fullPath, ancestors);
    }
    if (!stat.isFile()) {
      return [];
    }
  } else if (entry.isFile()) {
    try {
      stat = await fsp.stat(fullPath);
    } catch {
      return []; // file vanished or its name cannot be re-encoded
    }
  } else {
    return [];
  }
  const ext = path.extname(entry.name).toLowerCase();
  let type = null;
  if (ext === ".glb") {
    type = "glb";
  } else if (IMAGE_EXTENSIONS.has(ext)) {
    type = "image";
  }
  if (!type) {
    return [];
  }
  return [{ path: fullPath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs, type }];
}

/**
 * Recursively collects all media files (GLB and images) of a directory.
 * @param {string} dir - Start directory.
 * @param {Set<string>} ancestors - Realpaths of the directories in the current recursion path (cycle guard).
 * @returns {Promise<Array<{path: string, name: string, size: number, mtimeMs: number, type: 'glb'|'image'}>>} List of media files.
 */
async function findMediaFiles(dir, ancestors = new Set()) {
  let real;
  try {
    real = await fsp.realpath(dir);
  } catch {
    return []; // directory does not exist or is not accessible
  }
  if (ancestors.has(real)) {
    return []; // symlink cycle, avoid infinite recursion
  }
  ancestors.add(real);
  try {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // no read permission
    }
    const results = [];
    for (const entry of entries) {
      results.push(...(await findMediaEntry(dir, entry, ancestors)));
    }
    return results;
  } finally {
    ancestors.delete(real);
  }
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
 * Registers the filesystem and shell IPC handlers on the given ipcMain.
 * @param {{handle: Function}} ipcMain - The Electron ipcMain module.
 * @param {{getPath: Function, getLocale: Function}} app - The Electron app module.
 * @param {{openPath: Function}} shell - The Electron shell module.
 */
function registerFsIpc(ipcMain, app, shell) {
  const cacheDir = path.join(app.getPath("userData"), "thumbnails");
  ipcMain.handle("fs:listMediaFiles", (_event, dirPath) => findMediaFiles(dirPath));
  ipcMain.handle("fs:listDirectories", (_event, dirPath) => listDirectories(dirPath));
  ipcMain.handle("fs:homeDir", () => app.getPath("home"));
  ipcMain.handle("fs:cwd", () => process.cwd());
  ipcMain.handle("fs:locale", () => app.getLocale());
  ipcMain.handle("fs:rootDir", () => path.parse(app.getPath("home")).root);
  ipcMain.handle("fs:parentDir", (_event, dirPath) => parentDir(dirPath));
  ipcMain.handle("fs:readFile", (_event, filePath) => readFileBuffer(filePath));
  ipcMain.handle("fs:getThumbnail", (_event, file) => getThumbnail(file, cacheDir));
  ipcMain.handle("shell:openPath", (_event, filePath) => shell.openPath(filePath));
}

module.exports = {
  IMAGE_EXTENSIONS,
  findMediaFiles,
  listDirectories,
  parentDir,
  readFileBuffer,
  registerFsIpc,
};
