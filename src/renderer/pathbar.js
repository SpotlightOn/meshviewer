/**
 * Dolphin-style path bar: clickable breadcrumb segments that jump to a folder,
 * plus an editable text mode for typing or pasting a full path. Clicking the
 * active segment or the empty space to its right switches to the text field;
 * Enter opens the entered path, Esc or blur reverts to the breadcrumb.
 */

/**
 * Splits a directory path into breadcrumb segments from the tree root down to
 * the directory itself. Windows drive roots and forward-slash input are handled.
 * @param {string} dirPath - Absolute directory path.
 * @param {string} rootPath - Tree root path.
 * @returns {Array<{name: string, path: string}>} Breadcrumb segments.
 */
function pathSegments(dirPath, rootPath) {
  const windowsStyle = rootPath.includes("\\");
  const root = windowsStyle ? rootPath.replaceAll("/", "\\") : rootPath;
  const target = windowsStyle ? dirPath.replaceAll("/", "\\") : dirPath;
  const relative = target.startsWith(root) ? target.slice(root.length) : target;
  const segments = [{ name: root, path: root }];
  let acc = root;
  for (const part of relative.split(/[\\/]/).filter(Boolean)) {
    acc = joinPath(acc, part);
    segments.push({ name: part, path: acc });
  }
  return segments;
}

/**
 * Appends one path segment to a base path using the base's separator style.
 * @param {string} base - Base path.
 * @param {string} part - Segment name.
 * @returns {string} Joined path.
 */
function joinPath(base, part) {
  if (base.endsWith("/") || base.endsWith("\\")) return base + part;
  return base + (base.includes("\\") ? "\\" : "/") + part;
}

/**
 * Creates the path bar module.
 * @param {object} params - Module parameters.
 * @param {{root: HTMLElement, segments: HTMLElement, input: HTMLInputElement}} params.dom - Path bar elements.
 * @param {(path: string) => Promise<boolean>} params.navigate - Opens a directory; resolves true when it exists.
 * @returns {{setRoot: (rootPath: string) => void, setPath: (dirPath: string) => void}} Path bar API.
 */
function createPathBar({ dom, navigate }) {
  const { root, segments, input } = dom;
  /** @type {string} */
  let currentPath = "";
  let treeRoot = "/";
  let editing = false;
  let navigating = false;

  /**
   * Renders the breadcrumb buttons for the current directory.
   */
  function render() {
    if (!currentPath) return;
    segments.replaceChildren(
      ...pathSegments(currentPath, treeRoot).map((crumb) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `path-segment${crumb.path === currentPath ? " active" : ""}`;
        button.textContent = crumb.name;
        button.title = crumb.path;
        button.addEventListener("click", () => selectCrumb(crumb.path));
        return button;
      }),
    );
    segments.scrollLeft = segments.scrollWidth;
  }

  /**
   * Opens a breadcrumb segment; clicking the active one switches to edit mode.
   * @param {string} crumbPath - Path of the clicked segment.
   */
  async function selectCrumb(crumbPath) {
    if (crumbPath === currentPath) {
      startEdit();
      return;
    }
    await navigate(crumbPath);
  }

  /**
   * Switches to the text field with the current path preselected.
   */
  function startEdit() {
    if (editing) return;
    editing = true;
    root.classList.add("editing");
    input.value = currentPath;
    input.focus();
    input.select();
  }

  /**
   * Leaves the text field and restores the breadcrumb view. The field is
   * blurred explicitly so the document regains keyboard focus: while a hidden
   * input keeps focus, global shortcuts such as Ctrl+C or Delete are treated
   * as typing and ignored.
   */
  function endEdit() {
    if (!editing) return;
    editing = false;
    root.classList.remove("editing");
    if (document.activeElement === input) input.blur();
    render();
  }

  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = input.value.trim();
      if (!value || value === currentPath) {
        input.value = currentPath;
        endEdit();
        return;
      }
      navigating = true;
      const ok = await navigate(value);
      navigating = false;
      if (!ok) {
        input.value = currentPath;
      }
      endEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      input.value = currentPath;
      endEdit();
    }
  });

  input.addEventListener("blur", () => {
    if (navigating) return;
    if (input.value !== currentPath) {
      input.value = currentPath;
    }
    endEdit();
  });

  root.addEventListener("click", (event) => {
    if (event.target.closest(".path-segment")) return; // handled by the segment
    if (editing) return;
    startEdit();
  });

  return {
    /** @param {string} rootPath - Tree root path. */
    setRoot(rootPath) {
      treeRoot = rootPath;
      if (!editing) render();
    },
    /** @param {string} dirPath - Absolute directory path. */
    setPath(dirPath) {
      currentPath = dirPath;
      if (!editing) render();
    },
  };
}

export { createPathBar, pathSegments };
