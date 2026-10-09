import { beforeEach, describe, expect, it } from "vitest";
import { createContextMenu } from "../../src/renderer/context-menu.js";

/** Files resolved from the fake grid cards. */
const FILES = [
  { id: 1, name: "foto.png", path: "/tmp/foto.png" },
  { id: 2, name: "model.glb", path: "/tmp/model.glb" },
];

/**
 * Builds a fresh grid + menu DOM and a wired context menu.
 * @param {Array<{id: string, label: string|(() => string), icon?: string, order?: number, enabled?: (context: object) => boolean, action: (context: object) => void}>} [extraItems] - Extra registered entries.
 * @returns {{menu: ReturnType<typeof createContextMenu>, menuEl: HTMLElement, grid: HTMLElement, calls: Array<{id: string, fileId: number}>}} Test harness.
 */
function makeMenu(extraItems = []) {
  const calls = [];
  document.body.innerHTML = `
    <div id="grid" class="grid">
      <div class="card" data-index="0"><span>foto.png</span></div>
      <div class="card" data-index="1"><span>model.glb</span></div>
    </div>
    <div id="context-menu" class="context-menu" role="menu" hidden></div>`;
  const grid = document.getElementById("grid");
  const menuEl = document.getElementById("context-menu");
  const menu = createContextMenu({
    host: grid,
    menuEl,
    resolveTarget: (target) => {
      const card = target.closest(".card");
      if (!card || card.dataset.index === undefined) return null;
      return FILES[Number(card.dataset.index)] ?? null;
    },
  });
  menu.register({
    id: "open-with",
    label: "Open with default application",
    icon: "openInNew",
    action: (file) => calls.push({ id: "open-with", fileId: file.id }),
  });
  menu.register({
    id: "file-info",
    label: "File information",
    icon: "info",
    action: (file) => calls.push({ id: "file-info", fileId: file.id }),
  });
  for (const item of extraItems) menu.register(item);
  return { menu, menuEl, grid, calls };
}

/**
 * Dispatches a contextmenu event over the given element.
 * @param {HTMLElement} target - Element the event starts on.
 * @param {number} [x] - Cursor X.
 * @param {number} [y] - Cursor Y.
 */
function rightClick(target, x = 120, y = 60) {
  target.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
}

describe("createContextMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens on a card, lists the registered items and focuses the first one", () => {
    const { menu, menuEl, grid } = makeMenu();
    expect(menu.isOpen()).toBe(false);

    rightClick(grid.querySelector(".card"), 120, 60);

    expect(menu.isOpen()).toBe(true);
    const buttons = [...menuEl.querySelectorAll("button[data-action]")];
    expect(buttons.map((b) => b.dataset.action)).toEqual(["open-with", "file-info"]);
    expect(buttons[0].getAttribute("role")).toBe("menuitem");
    expect(document.activeElement).toBe(buttons[0]);
    expect(menuEl.style.left).toBe("120px");
    expect(menuEl.style.top).toBe("60px");
  });

  it("clamps the position to the window edges", () => {
    const { menuEl, grid } = makeMenu();
    rightClick(grid.querySelector(".card"), 5000, 5000);
    expect(menuEl.style.left).toBe("1016px");
    expect(menuEl.style.top).toBe("760px");
  });

  it("resolves function labels at open time and honors enabled()", () => {
    let label = "Draft";
    const { menuEl, grid } = makeMenu([
      {
        id: "conditional",
        label: () => label,
        enabled: (file) => file.id === 2,
        action: () => {},
      },
    ]);
    label = "Final";
    rightClick(grid.querySelector(".card[data-index='1']"));
    const items = [...menuEl.querySelectorAll(".context-item span.context-label")].map(
      (el) => el.textContent,
    );
    expect(items).toEqual(["Open with default application", "File information", "Final"]);

    rightClick(grid.querySelector(".card[data-index='0']"));
    const labels = [...menuEl.querySelectorAll(".context-item span.context-label")].map(
      (el) => el.textContent,
    );
    expect(labels).not.toContain("Final");
  });

  it("calls the action with the file and closes on click", () => {
    const { menu, menuEl, grid, calls } = makeMenu();
    rightClick(grid.querySelector(".card[data-index='1']"));
    menuEl.querySelector('[data-action="file-info"]').click();
    expect(calls).toEqual([{ id: "file-info", fileId: 2 }]);
    expect(menu.isOpen()).toBe(false);
    expect(menuEl.querySelectorAll("button")).toHaveLength(0);
  });

  it("closes with Escape and stops the event from reaching the app", () => {
    const { menu, grid } = makeMenu();
    const seen = [];
    document.addEventListener("keydown", (event) => seen.push(event.key));
    rightClick(grid.querySelector(".card"));
    const focused = document.activeElement;
    focused.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("moves the focus with the arrow keys", () => {
    const { menuEl, grid } = makeMenu();
    rightClick(grid.querySelector(".card"));
    const buttons = [...menuEl.querySelectorAll("button[data-action]")];
    buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("closes on pointer presses outside but stays open on the menu itself", () => {
    const { menu, menuEl, grid } = makeMenu();
    rightClick(grid.querySelector(".card"));
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);

    rightClick(grid.querySelector(".card"));
    menuEl
      .querySelector('[data-action="open-with"]')
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
  });

  it("closes without opening when an empty area is right-clicked", () => {
    const { menu, menuEl, grid } = makeMenu();
    rightClick(grid, 350, 120);
    expect(menu.isOpen()).toBe(false);
    expect(menuEl.querySelectorAll("button")).toHaveLength(0);
  });

  it("sorts visible entries by order and skips disabled contexts", () => {
    const menuEl = document.createElement("div");
    menuEl.className = "context-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.hidden = true;
    document.body.append(menuEl);
    const menu = createContextMenu({
      host: document.body,
      menuEl,
      resolveTarget: () => null,
    });
    menu.register({
      id: "file-info",
      order: 0,
      label: "File information",
      enabled: (context) => context.kind === "file",
      action: () => {},
    });
    menu.register({
      id: "open-with",
      order: 1,
      label: "Open with",
      enabled: (context) => context.kind === "file",
      action: () => {},
    });
    menu.register({
      id: "new-folder",
      order: 0,
      label: "New folder",
      enabled: (context) => context.kind === "folder",
      action: () => {},
    });
    menu.register({
      id: "paste",
      order: 11,
      label: "Paste",
      enabled: (context) => context.kind === "folder",
      action: () => {},
    });

    menu.open({ kind: "folder" }, 50, 60);
    let actions = [...menuEl.querySelectorAll("button[data-action]")].map((b) => b.dataset.action);
    expect(actions).toEqual(["new-folder", "paste"]);

    menu.open({ kind: "file", file: FILES[0] }, 50, 60);
    actions = [...menuEl.querySelectorAll("button[data-action]")].map((b) => b.dataset.action);
    expect(actions).toEqual(["file-info", "open-with"]);
  });
});
