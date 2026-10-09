/**
 * Inline SVG icons available to context menu entries, keyed by icon name.
 * @type {Object<string, string>}
 */
const MENU_ICONS = {
  openInNew:
    '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h560v-280h80v280q0 33-23.5 56.5T760-120H200Zm188-212-56-56 372-372H560v-80h280v280h-80v-144L388-332Z"/></svg>',
  info: '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  copy: '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Z"/></svg>',
  paste:
    '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M360-480h240v-80H360v80Zm0 160h240v-80H360v80Zm0 160h160v-80H360v80ZM200-120q-33 0-56.5-23.5T120-200v-640q0-33 23.5-56.5T200-920h120q11-35 39-57.5t61-22.5q33 0 61 22.5t39 57.5h120q33 0 56.5 23.5T720-840v640q0 33-23.5 56.5T640-120H200Zm0-80h440v-640H200v640Zm220-680q17 0 28.5-11.5T460-880q0-17-11.5-28.5T420-920q-17 0-28.5 11.5T380-880q0 17 11.5 28.5T420-840Z"/></svg>',
  newFolder:
    '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M560-320h80v-80h80v-80h-80v-80h-80v80h-80v80h80v80ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>',
  delete:
    '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>',
};

/**
 * Context menu module: a reusable popup menu whose entries are registered
 * externally through `register()`. The menu opens through a single delegated
 * `contextmenu` listener on the host element and positions itself at the
 * cursor. Right-clicks on empty areas only close any open menu.
 * @param {object} deps - Module dependencies.
 * @param {HTMLElement} deps.host - Element receiving the delegated contextmenu events.
 * @param {HTMLElement} deps.menuEl - The popup element (role="menu").
 * @param {(target: EventTarget) => object|null} deps.resolveTarget - Maps a contextmenu target to its context (file, folder, …), or null for empty areas.
 * @returns {{register: (item: object) => void, open: (context: object, x: number, y: number) => void, close: () => void, isOpen: () => boolean}} Context menu API.
 */
export function createContextMenu({ host, menuEl, resolveTarget }) {
  /** @type {Array<{id: string, label: string|(() => string), icon?: string, order?: number, enabled?: (context: object) => boolean, action: (context: object) => void}>} */
  const items = [];
  let activeContext = null;

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
    activeContext = null;
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
  }

  /**
   * Builds and shows the menu for a context, listing only the items enabled
   * for it in ascending `order` (registration order breaks ties).
   * @param {object} context - Context the menu opens for.
   * @param {number} x - Pointer X coordinate.
   * @param {number} y - Pointer Y coordinate.
   */
  function open(context, x, y) {
    close();
    activeContext = context;
    menuEl.replaceChildren();
    const visible = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.enabled || item.enabled(context))
      .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index);
    for (const { item } of visible) {
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
        item.action(context);
      });
      menuEl.append(button);
    }
    if (itemButtons().length === 0) {
      activeContext = null;
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
   * Opens the menu on right-clicks over a resolved context; empty areas just
   * close any open menu.
   * @param {MouseEvent} event - Contextmenu event.
   */
  function onContextMenu(event) {
    const context = resolveTarget(event.target);
    if (context) {
      event.preventDefault();
      open(context, event.clientX, event.clientY);
    } else {
      close();
    }
  }

  host.addEventListener("contextmenu", onContextMenu);
  menuEl.addEventListener("keydown", onKeydown);

  /**
   * Registers a menu entry. Labels may be functions resolved at open time;
   * `enabled` filters the entry per context; `order` sorts the visible
   * entries, defaults to 0.
   * @param {{id: string, label: string|(() => string), icon?: string, order?: number, enabled?: (context: object) => boolean, action: (context: object) => void}} item - Menu entry.
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
