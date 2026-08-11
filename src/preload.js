const { contextBridge, ipcRenderer } = require("electron");

/**
 * Renderer API exposed via contextBridge.
 * @typedef {object} MeshViewerApi
 * @property {(dirPath: string) => Promise<Array<{path: string, name: string, size: number, type: string}>>} listMediaFiles - Lists media files of a directory.
 * @property {(dirPath: string) => Promise<Array<{path: string, name: string}>>} listDirectories - Lists child directories.
 * @property {() => Promise<string>} getHomeDir - Returns the user's home directory.
 * @property {() => Promise<string>} getCwd - Returns the current working directory.
 * @property {() => Promise<string>} getLocale - Returns the system locale (BCP-47).
 * @property {() => Promise<string>} getRootDir - Returns the filesystem root directory.
 * @property {(dirPath: string) => Promise<string>} getParentDir - Returns the parent directory.
 * @property {(filePath: string) => Promise<ArrayBuffer>} readFile - Reads a file as an ArrayBuffer.
 * @property {(filePath: string) => Promise<string>} openPath - Opens a file with the system handler.
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
  openPath: (filePath) => ipcRenderer.invoke("shell:openPath", filePath),
};

contextBridge.exposeInMainWorld("api", api);
