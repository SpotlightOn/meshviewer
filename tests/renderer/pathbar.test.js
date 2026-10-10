import { beforeEach, describe, expect, it } from "vitest";
import { createPathBar, pathSegments } from "../../src/renderer/pathbar.js";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeBar(navigate) {
  document.body.innerHTML = `
    <div id="pathbar-root" class="pathbar">
      <div id="path-segments" class="path-segments"></div>
      <input id="path-input" class="path-input" type="text" />
    </div>`;
  const navigated = [];
  const bar = createPathBar({
    dom: {
      root: document.getElementById("pathbar-root"),
      segments: document.getElementById("path-segments"),
      input: document.getElementById("path-input"),
    },
    navigate: async (path) => {
      navigated.push(path);
      return navigate ? navigate(path) : true;
    },
  });
  return {
    bar,
    root: document.getElementById("pathbar-root"),
    segments: document.getElementById("path-segments"),
    input: document.getElementById("path-input"),
    navigated,
  };
}

describe("pathSegments", () => {
  it("splits a Linux path into breadcrumb segments", () => {
    expect(pathSegments("/home/pi/PROG", "/")).toEqual([
      { name: "/", path: "/" },
      { name: "home", path: "/home" },
      { name: "pi", path: "/home/pi" },
      { name: "PROG", path: "/home/pi/PROG" },
    ]);
  });

  it("returns only the root for the root itself", () => {
    expect(pathSegments("/", "/")).toEqual([{ name: "/", path: "/" }]);
  });

  it("handles Windows drive roots with backslashes", () => {
    expect(pathSegments("C:\\Users\\Photos", "C:\\")).toEqual([
      { name: "C:\\", path: "C:\\" },
      { name: "Users", path: "C:\\Users" },
      { name: "Photos", path: "C:\\Users\\Photos" },
    ]);
  });

  it("normalizes forward slashes on Windows roots", () => {
    expect(pathSegments("C:/Users/Photos", "C:\\")).toEqual([
      { name: "C:\\", path: "C:\\" },
      { name: "Users", path: "C:\\Users" },
      { name: "Photos", path: "C:\\Users\\Photos" },
    ]);
  });
});

describe("createPathBar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one clickable segment per breadcrumb", () => {
    const { bar, segments } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    const buttons = Array.from(segments.querySelectorAll(".path-segment"));
    expect(buttons.map((b) => b.textContent)).toEqual(["/", "home", "pi"]);
    expect(buttons.map((b) => b.title)).toEqual(["/", "/home", "/home/pi"]);
    expect(buttons[2].classList.contains("active")).toBe(true);
  });

  it("navigates when a breadcrumb segment is clicked", async () => {
    const { bar, segments, navigated } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    segments.querySelectorAll(".path-segment")[1].click();
    await flush();
    expect(navigated).toEqual(["/home"]);
  });

  it("switches to edit mode when the active segment is clicked", () => {
    const { bar, root, input } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelector(".path-segment.active").click();
    expect(root.classList.contains("editing")).toBe(true);
    expect(input.value).toBe("/home/pi");
    expect(document.activeElement).toBe(input);
  });

  it("switches to edit mode when empty space is clicked", () => {
    const { bar, root } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home");
    root.click();
    expect(root.classList.contains("editing")).toBe(true);
  });

  it("does not start editing when a non-active segment is clicked", async () => {
    const { bar, root } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelectorAll(".path-segment")[0].click();
    await flush();
    expect(root.classList.contains("editing")).toBe(false);
  });

  it("opens the typed path on Enter and leaves edit mode", async () => {
    const { bar, root, input, navigated } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelector(".path-segment.active").click();
    input.value = "/media";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    await flush();
    expect(navigated).toEqual(["/media"]);
    expect(root.classList.contains("editing")).toBe(false);
  });

  it("reverts to the current path when the navigation fails", async () => {
    const { bar, root, input } = makeBar(() => false);
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelector(".path-segment.active").click();
    input.value = "/nope";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    await flush();
    expect(input.value).toBe("/home/pi");
    expect(root.classList.contains("editing")).toBe(false);
  });

  it("reverts on Escape", () => {
    const { bar, root, input } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelector(".path-segment.active").click();
    input.value = "/typo";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(input.value).toBe("/home/pi");
    expect(root.classList.contains("editing")).toBe(false);
  });

  it("releases keyboard focus when navigation finishes", async () => {
    const { bar, root, input } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelector(".path-segment.active").click();
    expect(document.activeElement).toBe(input);

    input.value = "/media";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    await flush();

    // A hidden field that keeps focus would swallow Ctrl+C, Delete and friends.
    expect(document.activeElement).not.toBe(input);
  });

  it("leaves the current path untouched when Enter repeats it", async () => {
    const { bar, root, input, navigated } = makeBar();
    bar.setRoot("/");
    bar.setPath("/home/pi");
    root.querySelector(".path-segment.active").click();
    input.value = "/home/pi";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    await flush();
    expect(navigated).toEqual([]);
    expect(root.classList.contains("editing")).toBe(false);
  });
});
