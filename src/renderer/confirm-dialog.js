import { t } from "./i18n.js";

/**
 * Confirmation dialog module: shows a modal question with a cancel and a
 * confirm button. Opening returns a promise that resolves to true only when
 * the user accepted; closing any other way resolves false. This keeps
 * destructive actions behind an explicit confirmation.
 * @param {object} deps - Module dependencies.
 * @param {{overlay: HTMLElement, title: HTMLElement, message: HTMLElement, accept: HTMLButtonElement, cancel: HTMLButtonElement}} deps.dom - Dialog elements.
 * @returns {{open: (options: {title: string, message: string, acceptLabel?: string}) => Promise<boolean>, close: () => void, isOpen: () => boolean}} Dialog module API.
 */
export function createConfirmDialog({ dom }) {
  const { overlay, title, message, accept, cancel } = dom;
  /** @type {((accepted: boolean) => void) | null} */
  let resolvePending = null;

  /**
   * Returns whether the confirmation dialog is currently open.
   * @returns {boolean} true while the overlay is visible.
   */
  function isOpen() {
    return !overlay.classList.contains("hidden");
  }

  /**
   * Closes the dialog and resolves the pending question.
   * @param {boolean} [accepted] - Whether the user accepted. Defaults to false.
   */
  function close(accepted = false) {
    if (!isOpen()) return;
    overlay.classList.add("hidden");
    const resolve = resolvePending;
    resolvePending = null;
    resolve?.(accepted);
  }

  /**
   * Opens the dialog with the given texts.
   * @param {{title: string, message: string, acceptLabel?: string}} options - Dialog texts.
   * @returns {Promise<boolean>} true when the user accepted, false otherwise.
   */
  function open({ title: titleText, message: messageText, acceptLabel }) {
    title.textContent = titleText;
    message.textContent = messageText;
    accept.textContent = acceptLabel ?? t("dialog.confirm");
    overlay.classList.remove("hidden");
    cancel.focus();
    return new Promise((resolve) => {
      resolvePending = resolve;
    });
  }

  accept.addEventListener("click", () => close(true));
  cancel.addEventListener("click", () => close(false));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close(false);
  });

  return { open, close, isOpen };
}
