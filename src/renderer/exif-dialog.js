import { t } from "./i18n.js";
import { exifToSections, fileInfoRows } from "./utils.js";

/**
 * EXIF groups with a fixed translation key; any other group falls back to its
 * capitalized group name.
 * @type {string[]}
 */
const NAMED_EXIF_GROUPS = [
  "image",
  "exif",
  "gps",
  "thumbnail",
  "interoperability",
  "ifd0",
  "iptc",
  "xmp",
];

/**
 * Returns the translated display name of an EXIF group.
 * @param {string} group - ExifReader group name.
 * @returns {string} Display name.
 */
function groupLabel(group) {
  if (NAMED_EXIF_GROUPS.includes(group)) return t(`info.groups.${group}`);
  return group.charAt(0).toUpperCase() + group.slice(1);
}

/**
 * File information dialog module: shows basic file data followed by every EXIF
 * group of the current file. Opening renders the basic information right away
 * and fills in the EXIF data once the main process parsed the file; results of
 * superseded requests are ignored.
 * @param {object} deps - Module dependencies.
 * @param {{overlay: HTMLElement, content: HTMLElement, closeBtn: HTMLButtonElement}} deps.dom - Dialog elements.
 * @returns {{open: (file: {path: string, name: string, size: number, mtimeMs: number}, imageSize?: {width: number, height: number}) => void, close: () => void, isOpen: () => boolean}} Dialog module API.
 */
export function createInfoDialog({ dom }) {
  const { overlay, content, closeBtn } = dom;
  let requestToken = 0;

  /**
   * Renders a section heading with a row list into the content area.
   * @param {HTMLElement} container - Target container.
   * @param {string} heading - Section heading.
   * @param {Array<{label: string, value: string}>} rows - Rows to render.
   */
  function renderSection(container, heading, rows) {
    if (rows.length === 0) return;
    const section = document.createElement("section");
    section.className = "info-section";
    const title = document.createElement("h3");
    title.textContent = heading;
    const list = document.createElement("dl");
    list.className = "info-rows";
    for (const row of rows) {
      const term = document.createElement("dt");
      term.textContent = row.label;
      const detail = document.createElement("dd");
      detail.textContent = row.value;
      list.append(term, detail);
    }
    section.append(title, list);
    container.append(section);
  }

  /**
   * Rebuilds the dialog content for a file and its parsed EXIF tags.
   * @param {{name: string, size: number, mtimeMs: number}} file - Media file entry.
   * @param {{width: number, height: number}} [imageSize] - Pixel size when known.
   * @param {object|null} tags - EXIF tag groups.
   */
  function render(file, imageSize, tags) {
    content.replaceChildren();
    renderSection(content, t("info.file"), fileInfoRows(file, imageSize));
    for (const section of exifToSections(tags)) {
      renderSection(content, groupLabel(section.group), section.rows);
    }
  }

  /**
   * Opens the dialog for a file and starts the EXIF request.
   * @param {{path: string, name: string, size: number, mtimeMs: number}} file - Media file entry.
   * @param {{width: number, height: number}} [imageSize] - Pixel size when known.
   */
  function open(file, imageSize) {
    const token = ++requestToken;
    render(file, imageSize, null);
    const loading = document.createElement("p");
    loading.className = "info-loading";
    loading.textContent = t("info.loading");
    content.append(loading);
    overlay.classList.remove("hidden");
    closeBtn.focus();
    window.api.exif(file.path).then(
      (tags) => {
        if (token !== requestToken) return;
        render(file, imageSize, tags);
      },
      () => {
        if (token === requestToken) loading.remove();
      },
    );
  }

  /**
   * Closes the dialog and invalidates a pending EXIF request.
   */
  function close() {
    requestToken += 1;
    overlay.classList.add("hidden");
    content.replaceChildren();
  }

  /**
   * Returns whether the dialog is currently open.
   * @returns {boolean} true while the overlay is visible.
   */
  function isOpen() {
    return !overlay.classList.contains("hidden");
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  return { open, close, isOpen };
}
