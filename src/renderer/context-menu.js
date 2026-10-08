/**
 * Inline SVG icons available to context menu entries, keyed by icon name.
 * @type {Object<string, string>}
 */
const MENU_ICONS = {
  openInNew:
    '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/></svg>',
  info: '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
};

/**
 * Context menu module: a reusable popup menu for media tiles. Entries are
 * registered externally through `register()`; the menu opens through a single
 * delegated `contextmenu` listener on the host element, so tiles never need
 * their own listeners.
 * @param {object} deps - Module dependencies.
 * @param {HTMLElement} deps.host - Element receiving the delegated contextmenu events.
 * @param {HTMLElement} deps.menuEl - The popup element (role="menu").
 * @param {(target: EventTarget) => object|null} deps.resolveFile - Maps a contextmenu target to its file, or null for empty areas.
 * @returns {{register: (item: object) => void, open: (file: object, x: number, y: number) => void, close: () => void, isOpen: () => boolean}} Context menu API.
 */
export function createContextMenu({ host, menuEl, resolveFile }) {
  /** @type {Array<{id: string, label: string|(() => string), icon?: string, enabled?: (file: object) => boolean, action: (file: object) => void}>} */
  const items = [];
  let file = null;

  /**
   * Resolves the displayed label of a registered item.
   * @param {{label: string|(() => string)}} item - Registered item.
   * @returns {string} Label text.
   */
  function labelOf(item) {
    return typeof item.label === "function" ? item.label() : item.label;
  }

  /**
   * Returns the visible item buttons in DOM order.
   * @returns {Array<HTMLButtonElement>} Item buttons.
   */
  function itemButtons() {
    return [...menuEl.querySelectorAll("button[data-action]")];
  }

  /**
   * Moves the focus between the visible items in the given direction.
   * @param {number} step - +1 for the next item, -1 for the previous.
   */
  function moveFocus(step) {
    const buttons = itemButtons();
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement);
    const next = (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  /**
   * Handles keyboard navigation inside the menu and stops the events from
   * reaching the global shortcut handler.
   * @param {KeyboardEvent} event - Keydown event.
   */
  function onKeydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    }
  }

  /**
   * Closes the menu when a pointer press happens outside of it.
   * @param {PointerEvent} event - Pointer event.
   */
  function onPointerDown(event) {
    if (menuEl.contains(event.target)) return;
    close();
  }

  /**
   * Positions the open menu near the cursor, clamped to the window edges so
   * it never overflows the screen.
   * @param {number} x - Pointer X coordinate.
   * @param {number} y - Pointer Y coordinate.
   */
  function position(x, y) {
    const MARGIN = 8;
    const rect = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN))}px`;
    menuEl.style.top = `${Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN))}px`;
  }

  /**
   * Hides the menu, clears its content and detaches the global listeners.
   */
  function close() {
    menuEl.hidden = true;
    menuEl.replaceChildren();
    file = null;
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
  }

  /**
   * Builds and shows the menu for a file, listing only items that are
   * enabled for it.
   * @param {object} targetFile - File the menu opens for.
   * @param {number} x - Pointer X coordinate.
   * @param {number} y - Pointer Y coordinate.
   */
  function open(targetFile, x, y) {
    close();
    file = targetFile;
    menuEl.replaceChildren();
    for (const item of items) {
      if (item.enabled && !item.enabled(file)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-item";
      button.dataset.action = item.id;
      button.setAttribute("role", "menuitem");
      const icon = item.icon && MENU_ICONS[item.icon];
      if (icon) {
        const iconEl = document.createElement("span");
        iconEl.className = "context-icon";
        iconEl.innerHTML = icon;
        button.append(iconEl);
      }
      const label = document.createElement("span");
      label.className = "context-label";
      label.textContent = labelOf(item);
      button.append(label);
      button.addEventListener("click", () => {
        close();
        item.action(targetFile);
      });
      menuEl.append(button);
    }
    if (itemButtons().length === 0) {
      file = null;
      return;
    }
    menuEl.hidden = false;
    menuEl.style.left = "0px";
    menuEl.style.top = "0px";
    position(x, y);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    itemButtons()[0].focus();
  }

  /**
   * Opens the menu on right-clicks over a resolved file; empty areas just
   * close any open menu.
   * @param {MouseEvent} event - Contextmenu event.
   */
  function onContextMenu(event) {
    const targetFile = resolveFile(event.target);
    if (targetFile) {
      event.preventDefault();
      open(targetFile, event.clientX, event.clientY);
    } else {
      close();
    }
  }

  host.addEventListener("contextmenu", onContextMenu);
  menuEl.addEventListener("keydown", onKeydown);

  /**
   * Registers a menu entry. Labels may be functions resolved at open time;
   * `enabled` filters the entry per file.
   * @param {{id: string, label: string|(() => string), icon?: string, enabled?: (file: object) => boolean, action: (file: object) => void}} item - Menu entry.
   */
  function register(item) {
    items.push(item);
  }

  /**
   * Returns whether the menu is currently open.
   * @returns {boolean} true while the menu is visible.
   */
  function isOpen() {
    return !menuEl.hidden;
  }

  return { register, open, close, isOpen };
}
