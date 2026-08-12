import { beforeEach, describe, expect, it } from "vitest";
import { createDirectoryTree } from "../../src/renderer/tree.js";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeTree(entries) {
  const selected = [];
  const tree = createDirectoryTree({
    rootPath: "/",
    rootLabel: "Root",
    getChildren: async (path) => entries[path] || [],
    onSelect: (path) => selected.push(path),
  });
  return { tree, selected };
}

describe("createDirectoryTree", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("creates a tree element with role and tabindex", () => {
    const { tree } = makeTree({});
    expect(tree.el.tagName).toBe("DIV");
    expect(tree.el.getAttribute("role")).toBe("tree");
    expect(tree.el.getAttribute("tabindex")).toBe("0");
  });

  it("renders the root node with its label", () => {
    const { tree } = makeTree({});
    const label = tree.el.querySelector(".tree-label");
    expect(label.textContent).toBe("Root");
    expect(label.title).toBe("/");
  });

  it("loads and renders children after initial expansion", async () => {
    const { tree } = makeTree({
      "/": [
        { path: "/home", name: "home" },
        { path: "/media", name: "media" },
      ],
    });
    await flush();
    const labels = Array.from(tree.el.querySelectorAll(".tree-label")).map((el) => el.textContent);
    expect(labels).toEqual(["Root", "home", "media"]);
  });

  it("hides the twisty when a node has no children", async () => {
    const { tree } = makeTree({ "/": [] });
    await flush();
    expect(tree.el.querySelector(".tree-twisty").classList.contains("hidden")).toBe(true);
  });

  it("expands and collapses a node on toggle", async () => {
    const { tree } = makeTree({
      "/": [{ path: "/home", name: "home" }],
      "/home": [{ path: "/home/Desktop", name: "Desktop" }],
    });
    await flush();

    const homeRow = Array.from(tree.el.querySelectorAll(".tree-row")).find(
      (row) => row.querySelector(".tree-label").textContent === "home",
    );
    homeRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();
    expect(homeRow.closest("li").classList.contains("expanded")).toBe(true);
    expect(homeRow.closest("li").getAttribute("aria-expanded")).toBe("true");
    expect(tree.el.textContent).toContain("Desktop");

    homeRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();
    expect(homeRow.closest("li").classList.contains("expanded")).toBe(false);
  });

  it("selects a node on click and reports it", async () => {
    const { tree, selected } = makeTree({
      "/": [{ path: "/home", name: "home" }],
    });
    await flush();

    const homeRow = Array.from(tree.el.querySelectorAll(".tree-row")).find(
      (row) => row.querySelector(".tree-label").textContent === "home",
    );
    homeRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(selected).toEqual(["/home"]);
    expect(tree.getSelectedPath()).toBe("/home");
    expect(homeRow.closest("li").classList.contains("selected")).toBe(true);
  });

  it("selects a nested path and expands its ancestors via selectPath", async () => {
    const { tree, selected } = makeTree({
      "/": [{ path: "/home", name: "home" }],
      "/home": [{ path: "/home/Desktop", name: "Desktop" }],
    });
    await flush();

    const ok = await tree.selectPath("/home/Desktop");
    expect(ok).toBe(true);
    expect(selected).toEqual(["/home/Desktop"]);
    expect(tree.getSelectedPath()).toBe("/home/Desktop");
    const expandedLis = tree.el.querySelectorAll("li.expanded");
    expect(expandedLis.length).toBe(3);
  });

  it("returns false for an unknown path", async () => {
    const { tree } = makeTree({
      "/": [{ path: "/home", name: "home" }],
    });
    await flush();
    expect(await tree.selectPath("/nope")).toBe(false);
  });

  it("selects without notifying when notify is false", async () => {
    const { tree, selected } = makeTree({
      "/": [{ path: "/home", name: "home" }],
    });
    await flush();

    const ok = await tree.selectPath("/home", { notify: false });
    expect(ok).toBe(true);
    expect(tree.getSelectedPath()).toBe("/home");
    expect(selected).toEqual([]);
  });

  it("prefetches grandchildren after a node is expanded", async () => {
    const { tree } = makeTree({
      "/": [{ path: "/a", name: "a" }],
      "/a": [{ path: "/a/b", name: "b" }],
    });
    await flush();
    expect(tree.el.textContent).toContain("b");
    const bLi = Array.from(tree.el.querySelectorAll("li")).find(
      (li) => li.querySelector(".tree-label").textContent === "b",
    );
    expect(bLi).toBeTruthy();
  });

  it("prefetches only one level ahead without cascading", async () => {
    const calls = [];
    const tree = createDirectoryTree({
      rootPath: "/",
      rootLabel: "Root",
      getChildren: async (path) => {
        calls.push(path);
        if (path === "/") return [{ path: "/a", name: "a" }];
        if (path === "/a") return [{ path: "/a/b", name: "b" }];
        if (path === "/a/b") return [{ path: "/a/b/c", name: "c" }];
        return [];
      },
    });
    await flush();
    expect(calls).toContain("/a");
    expect(calls).not.toContain("/a/b");
    expect(tree.el.textContent).toContain("b");
    expect(tree.el.textContent).not.toContain("c");
  });

  it("navigates with keyboard arrows and enter", async () => {
    const { tree, selected } = makeTree({
      "/": [
        { path: "/a", name: "a" },
        { path: "/b", name: "b" },
      ],
    });
    await flush();

    const rows = Array.from(tree.el.querySelectorAll(".tree-row"));
    expect(rows.map((r) => r.querySelector(".tree-label").textContent)).toEqual(["Root", "a", "b"]);

    tree.el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[0].closest("li").classList.contains("focused")).toBe(true);

    tree.el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[1].closest("li").classList.contains("focused")).toBe(true);

    tree.el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[2].closest("li").classList.contains("focused")).toBe(true);

    tree.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(tree.getSelectedPath()).toBe("/b");
    expect(selected).toContain("/b");
  });
});
