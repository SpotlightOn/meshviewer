const { contextBridge, ipcRenderer } = require("electron");

/**
 * Renderer API exposed via contextBridge.
 * @typedef {object} MeshViewerApi
 * @property {(dirPath: string) => Promise<Array<{path: string, name: string, size: number, mtimeMs: number, type: string}>>} listMediaFiles - Lists media files of a directory.
 * @property {(dirPath: string) => Promise<Array<{path: string, name: string}>>} listDirectories - Lists child directories.
 * @property {() => Promise<string>} getHomeDir - Returns the user's home directory.
 * @property {() => Promise<string>} getCwd - Returns the current working directory.
 * @property {() => Promise<string>} getLocale - Returns the system locale (BCP-47).
 * @property {() => Promise<string>} getRootDir - Returns the filesystem root directory.
 * @property {(dirPath: string) => Promise<string>} getParentDir - Returns the parent directory.
 * @property {(filePath: string) => Promise<ArrayBuffer>} readFile - Reads a file as an ArrayBuffer.
 * @property {(sources: Array<string>, targetDir: string) => Promise<Array<{source: string, target: string, ok: boolean, error?: string}>>} copyFiles - Copies files into a directory, renaming files that already exist in the target.
 * @property {(parentDir: string, name: string) => Promise<{ok: true, path: string} | {ok: false, code: string}>} createDirectory - Creates a new directory inside a parent directory.
 * @property {(paths: Array<string>) => Promise<{trashed: Array<string>, failed: Array<{path: string, error: string}>}>} trashFiles - Moves files to the operating system trash.
 * @property {(filePath: string) => Promise<object|null>} exif - Reads the EXIF tag groups of an image, or null when none can be read.
 * @property {(file: {path: string, size: number, mtimeMs: number}) => Promise<string|null>} getThumbnail - Returns a JPEG data URL thumbnail for an image, or null if it could not be generated.
 * @property {(filePath: string) => Promise<string>} openPath - Opens a file with the system handler.
 * @property {() => Promise<string|null>} pickExecutable - Opens a native file dialog to choose an editor executable, or null when canceled.
 * @property {(command: string, filePath: string) => Promise<{ok: boolean, error?: string}>} runEditor - Launches the given editor command on the file.
 * @property {() => Promise<{slideshowIntervalSeconds: number, slideshowTransition: string, animationDurationMs: number, editorCommand: string}>} getSettings - Returns the current application settings.
 * @property {(settings: {slideshowIntervalSeconds: number, slideshowTransition: string, animationDurationMs: number, editorCommand: string}) => Promise<{slideshowIntervalSeconds: number, slideshowTransition: string, animationDurationMs: number, editorCommand: string}>} saveSettings - Persists and returns the normalized settings.
 * @property {(callback: () => void) => () => void} onOpenSettings - Subscribes to the "open settings" menu event; returns an unsubscribe function.
 * @property {(flag: boolean) => Promise<void>} setFullScreen - Puts the window into or out of fullscreen mode.
 * @property {(callback: (value: boolean) => void) => () => void} onFullScreenChanged - Subscribes to fullscreen state changes; returns an unsubscribe function.
 */

/** @type {MeshViewerApi} */
const api = {
  listMediaFiles: (dirPath) => ipcRenderer.invoke("fs:listMediaFiles", dirPath),
  listDirectories: (dirPath) => ipcRenderer.invoke("fs:listDirectories", dirPath),
  getHomeDir: () => ipcRenderer.invoke("fs:homeDir"),
  getCwd: () => ipcRenderer.invoke("fs:cwd"),
  getLocale: () => ipcRenderer.invoke("fs:locale"),
  getRootDir: () => ipcRenderer.invoke("fs:rootDir"),
  getParentDir: (dirPath) => ipcRenderer.invoke("fs:parentDir", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  copyFiles: (sources, targetDir) => ipcRenderer.invoke("fs:copyFiles", sources, targetDir),
  createDirectory: (parentDir, name) => ipcRenderer.invoke("fs:createDirectory", parentDir, name),
  trashFiles: (paths) => ipcRenderer.invoke("fs:trashFiles", paths),
  exif: (filePath) => ipcRenderer.invoke("fs:exif", filePath),
  getThumbnail: (file) => ipcRenderer.invoke("fs:getThumbnail", file),
  openPath: (filePath) => ipcRenderer.invoke("shell:openPath", filePath),
  pickExecutable: () => ipcRenderer.invoke("editor:pick"),
  runEditor: (command, filePath) => ipcRenderer.invoke("editor:run", command, filePath),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:open-settings", listener);
    return () => ipcRenderer.removeListener("menu:open-settings", listener);
  },
  setFullScreen: (flag) => ipcRenderer.invoke("win:setFullScreen", flag),
  onFullScreenChanged: (callback) => {
    const listener = (_event, value) => callback(Boolean(value));
    ipcRenderer.on("win:fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("win:fullscreen-changed", listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
