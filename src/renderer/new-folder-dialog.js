import { t } from "./i18n.js";

/**
 * New folder dialog module: asks for a folder name, creates the folder through
 * the main process and notifies the caller. Failed creations keep the dialog
 * open with a translated error message.
 * @param {object} deps - Module dependencies.
 * @param {{overlay: HTMLElement, input: HTMLInputElement, error: HTMLElement, create: HTMLButtonElement, cancel: HTMLButtonElement}} deps.dom - Dialog elements.
 * @param {(parentPath: string, createdPath: string) => void} [deps.onCreated] - Called after a folder was created.
 * @returns {{open: (parentPath: string) => void, close: () => void, isOpen: () => boolean}} Dialog module API.
 */
export function createNewFolderDialog({ dom, onCreated }) {
  const { overlay, input, error, create, cancel } = dom;
  let parentPath = null;

  /**
   * Shows a translated error message in the dialog.
   * @param {string} key - Translation key below "newFolder.error".
   */
  function showError(key) {
    error.textContent = t(`newFolder.error.${key}`);
    error.hidden = false;
  }

  /**
   * Validates the entered name and creates the folder.
   * @returns {Promise<void>}
   */
  async function submit() {
    if (!parentPath) return;
    const name = input.value.trim();
    if (name === "") {
      showError("invalid");
      return;
    }
    const result = await window.api.createDirectory(parentPath, name);
    if (!result.ok) {
      showError(result.code);
      return;
    }
    const createdPath = result.path;
    const createdParent = parentPath;
    close();
    if (onCreated) onCreated(createdParent, createdPath);
  }

  /**
   * Opens the dialog for a parent directory.
   * @param {string} targetDir - Directory the new folder is created in.
   */
  function open(targetDir) {
    parentPath = targetDir;
    input.value = t("newFolder.defaultName");
    error.hidden = true;
    error.textContent = "";
    overlay.classList.remove("hidden");
    input.focus();
    input.select();
  }

  /**
   * Closes the dialog without creating a folder.
   */
  function close() {
    overlay.classList.add("hidden");
    parentPath = null;
  }

  create.addEventListener("click", () => void submit());
  cancel.addEventListener("click", close);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submit();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  return {
    open,
    close,
    isOpen: () => !overlay.classList.contains("hidden"),
  };
}
