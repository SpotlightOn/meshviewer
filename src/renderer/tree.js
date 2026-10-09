/**
 * @typedef {object} NodeState
 * @property {HTMLLIElement} li - List item element of the node.
 * @property {HTMLDivElement} row - Row div of the node.
 * @property {HTMLSpanElement} twisty - Expand/collapse indicator.
 * @property {HTMLUListElement} childrenUl - Container of the child nodes.
 * @property {string} path - Absolute path of the node.
 * @property {string} name - Display name.
 * @property {boolean} loaded - Whether the children have been loaded.
 * @property {boolean} expanded - Whether the node is expanded.
 * @property {boolean} loading - Whether a load is in progress.
 * @property {Array<{path: string, name: string}>} children - Loaded child data.
 * @property {Array<NodeState>} childStates - States of the child nodes.
 * @property {Promise<Array> | null} loadPromise - In-flight load promise.
 */

/**
 * Creates a scheduler that limits how many async tasks run concurrently.
 * @param {number} limit - Maximum number of tasks running at the same time.
 * @returns {(task: () => Promise<void>) => void} Scheduler for fire-and-forget tasks.
 */
function createTaskQueue(limit) {
  let running = 0;
  /** @type {Array<() => Promise<void>>} */
  const pending = [];
  const next = () => {
    if (running >= limit || pending.length === 0) return;
    running++;
    const task = pending.shift();
    Promise.resolve()
      .then(task)
      .finally(() => {
        running--;
        next();
      });
  };
  return (task) => {
    pending.push(task);
    next();
  };
}

/**
 * Creates a lazily loading directory tree.
 * @param {object} options - Configuration.
 * @param {string} options.rootPath - Root path.
 * @param {string} options.rootLabel - Display name of the root.
 * @param {(path: string) => Promise<Array<{path: string, name: string}>>} options.getChildren - Returns child directories.
 * @param {(path: string) => void} [options.onSelect] - Selection callback.
 * @returns {{el: HTMLDivElement, selectPath: (path: string) => Promise<boolean>, getSelectedPath: () => string | null, refresh: (path: string) => Promise<void>}} Tree API.
 */
export function createDirectoryTree({ rootPath, rootLabel, getChildren, onSelect }) {
  const tree = document.createElement("div");
  tree.className = "tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("tabindex", "0");

  const rootList = document.createElement("ul");
  rootList.className = "tree-root";
  tree.append(rootList);

  /** @type {Map<string, NodeState>} */
  const states = new Map();

  /** @type {string | null} */
  let selectedPath = null;

  /** Bounded background prefetch of child directories. */
  const schedulePrefetch = createTaskQueue(4);

  /**
   * Preloads the children of a node's children so the next expand is instant.
   * @param {NodeState} state - Expanded node whose children should be prefetched.
   */
  function prefetch(state) {
    for (const childState of state.childStates) {
      schedulePrefetch(() => ensureLoaded(childState).then(() => undefined));
    }
  }

  /**
   * Creates a tree node and its state.
   * @param {string} nodePath - Absolute path.
   * @param {string} label - Display name.
   * @returns {NodeState} State of the created node.
   */
  function createNode(nodePath, label) {
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    li.setAttribute("data-path", nodePath);
    li.setAttribute("aria-expanded", "false");

    const row = document.createElement("div");
    row.className = "tree-row";

    const twisty = document.createElement("span");
    twisty.className = "tree-twisty";
    twisty.textContent = "\u25b8";
    twisty.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "tree-label";
    text.textContent = label;
    text.title = nodePath;

    row.append(twisty, text);

    const childrenUl = document.createElement("ul");
    childrenUl.className = "tree-children";
    childrenUl.setAttribute("role", "group");

    li.append(row, childrenUl);

    const state = {
      li,
      row,
      twisty,
      childrenUl,
      path: nodePath,
      name: label,
      loaded: false,
      expanded: false,
      loading: false,
      children: [],
      childStates: [],
    };
    states.set(nodePath, state);

    row.addEventListener("click", () => activate(state));
    twisty.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle(state);
    });
    row.addEventListener("dblclick", () => toggle(state));

    return state;
  }

  /**
   * Loads the children of a node exactly once.
   * @param {NodeState} state - Node state.
   * @returns {Promise<Array<{path: string, name: string}>>} Loaded child data.
   */
  async function ensureLoaded(state) {
    if (state.loaded) return state.children;
    if (state.loadPromise) return state.loadPromise;
    state.loading = true;
    state.twisty.classList.add("loading");
    state.loadPromise = (async () => {
      const children = await getChildren(state.path).catch(() => []);
      state.children = children;
      for (const child of children) {
        const childState = createNode(child.path, child.name);
        state.childrenUl.append(childState.li);
        state.childStates.push(childState);
      }
      state.loading = false;
      state.twisty.classList.remove("loading");
      state.loadPromise = null;
      state.loaded = true;
      return children;
    })();
    return state.loadPromise;
  }

  /**
   * Expands a node and loads its children.
   * @param {NodeState} state - Node state.
   * @returns {Promise<void>}
   */
  async function expand(state) {
    state.expanded = true;
    state.li.classList.add("expanded");
    state.li.setAttribute("aria-expanded", "true");
    updateTwisty(state);
    await ensureLoaded(state);
    if (state.children.length === 0) {
      state.twisty.classList.add("hidden");
    }
    prefetch(state);
  }

  /**
   * Collapses a node.
   * @param {NodeState} state - Node state.
   */
  function collapse(state) {
    state.expanded = false;
    state.li.classList.remove("expanded");
    state.li.setAttribute("aria-expanded", "false");
    updateTwisty(state);
  }

  /**
   * Toggles a node between expanded and collapsed.
   * @param {NodeState} state - Node state.
   * @returns {Promise<void>}
   */
  async function toggle(state) {
    if (state.expanded) {
      collapse(state);
    } else {
      await expand(state);
    }
  }

  /**
   * Updates the symbol and visibility of the twisty element.
   * @param {NodeState} state - Node state.
   */
  function updateTwisty(state) {
    if (state.children.length === 0 && state.loaded) {
      state.twisty.classList.add("hidden");
      return;
    }
    state.twisty.classList.remove("hidden");
    state.twisty.textContent = state.expanded ? "\u25be" : "\u25b8";
  }

  /**
   * Marks a node as selected and invokes onSelect.
   * @param {NodeState} state - Node state.
   * @param {boolean} [notify] - Whether to invoke onSelect. Defaults to true.
   */
  function activate(state, notify = true) {
    if (selectedPath) {
      const previous = states.get(selectedPath);
      if (previous) previous.li.classList.remove("selected");
    }
    selectedPath = state.path;
    state.li.classList.add("selected");
    if (onSelect && notify) onSelect(state.path);
  }

  /**
   * Returns the currently visible nodes in DOM order.
   * @returns {Array<HTMLLIElement>} Visible list items.
   */
  function visibleNodes() {
    return Array.from(
      rootList.querySelectorAll(':scope > li, li[aria-expanded="true"] > .tree-children > li'),
    );
  }

  /**
   * Moves the keyboard focus to a node.
   * @param {HTMLLIElement} node - List item.
   * @param {boolean} [focusRoot] - Also focus the tree container.
   */
  function focus(node, focusRoot) {
    if (focusRoot) {
      tree.focus();
    }
    for (const other of rootList.querySelectorAll("li")) {
      other.classList.remove("focused");
    }
    node.classList.add("focused");
  }

  tree.addEventListener("keydown", (event) => {
    const nodes = visibleNodes();
    if (nodes.length === 0) return;

    const focusedIndex = nodes.findIndex((li) => li.classList.contains("focused"));
    const current =
      focusedIndex >= 0 ? states.get(nodes[focusedIndex].getAttribute("data-path")) : null;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focus(nodes[Math.min(nodes.length - 1, focusedIndex + 1)]);
        break;
      case "ArrowUp":
        event.preventDefault();
        focus(nodes[Math.max(0, focusedIndex - 1)]);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (current) {
          if (!current.expanded) {
            expand(current).then(() => {
              if (current.children.length > 0) {
                focus(current.childrenUl.firstElementChild);
              }
            });
          } else if (current.childrenUl.firstElementChild) {
            focus(current.childrenUl.firstElementChild);
          }
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (current) {
          if (current.expanded) {
            collapse(current);
          } else if (current.li.parentElement?.closest("li")) {
            focus(current.li.parentElement.closest("li"));
          }
        }
        break;
      case "Enter":
        event.preventDefault();
        if (current) {
          activate(current);
        }
        break;
      case " ":
        event.preventDefault();
        if (current) {
          toggle(current);
        }
        break;
    }
  });

  const root = createNode(rootPath, rootLabel);
  rootList.append(root.li);
  expand(root);

  /**
   * Returns the path of the selected node.
   * @returns {string | null} Selected path or null.
   */
  function getSelectedPath() {
    return selectedPath;
  }

  /**
   * Selects a path and expands its ancestors.
   * @param {string} targetPath - Target path.
   * @param {object} [options] - Options.
   * @param {boolean} [options.notify] - Invoke onSelect for the target. Defaults to true.
   * @returns {Promise<boolean>} true if the path was found.
   */
  async function selectPath(targetPath, options = {}) {
    const { notify = true } = options;
    // On Windows the tree uses backslash paths; accept forward slashes too so
    // user-typed paths (e.g. from the directory field) select correctly.
    const windowsStyle = rootPath.includes("\\");
    const target = windowsStyle ? targetPath.replaceAll("/", "\\") : targetPath;
    const rootState = states.get(rootPath);
    if (!rootState) return false;
    await ensureLoaded(rootState);
    if (target === rootPath) {
      activate(rootState, notify);
      return true;
    }
    const relative = target.startsWith(rootPath) ? target.slice(rootPath.length) : target;
    const segments = relative.split(windowsStyle ? /[\\/]/ : "/").filter(Boolean);
    let current = rootState;
    for (const segment of segments) {
      const child = current.childStates.find((c) => c.name === segment);
      if (!child) return false;
      if (child.path === target) {
        activate(child, notify);
        await expand(child);
        return true;
      }
      await expand(child);
      current = child;
    }
    return false;
  }

  /**
   * Reloads the children of an already loaded node so filesystem changes
   * (for example a newly created folder) show up. Nodes that were never
   * loaded stay untouched; they load fresh data on their next expand.
   * @param {string} targetPath - Path of the node to refresh.
   * @returns {Promise<void>}
   */
  async function refresh(targetPath) {
    const state = states.get(targetPath);
    if (!state || !state.loaded) return;
    state.children = [];
    state.childStates = [];
    state.childrenUl.replaceChildren();
    state.loaded = false;
    await ensureLoaded(state);
    updateTwisty(state);
    if (state.expanded) prefetch(state);
  }

  return { el: tree, selectPath, getSelectedPath, refresh };
}
