import { readdir } from "node:fs/promises";

/**
 * Lists the names inside a directory, sorted, so tests can assert the whole
 * directory content without depending on the filesystem order.
 * @param {string} dir - Directory to read.
 * @returns {Promise<Array<string>>} Sorted entry names.
 */
async function dirEntries(dir) {
  return (await readdir(dir)).sort();
}

export { dirEntries };
