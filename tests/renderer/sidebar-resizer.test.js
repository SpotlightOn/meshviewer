import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampSidebarWidth, createSidebarResizer } from "../../src/renderer/sidebar-resizer.js";

/**
 * Builds a separator element attached to the document.
 * @returns {HTMLDivElement} The handle element.
 */
function makeHandle() {
  const handle = document.createElement("div");
  document.body.append(handle);
  return handle;
}

/**
 * Creates a pointer-like mouse event.
 * @param {string} type - Event type.
 * @param {number} clientX - Horizontal pointer position.
 * @returns {MouseEvent} The event.
 */
function pointer(type, clientX) {
  return new MouseEvent(type, { clientX, button: 0, bubbles: true });
}

describe("clampSidebarWidth", () => {
  it("clamps to the allowed range and rounds", () => {
    expect(clampSidebarWidth(10)).toBe(160);
    expect(clampSidebarWidth(10000)).toBe(720);
    expect(clampSidebarWidth(300.7)).toBe(301);
    expect(clampSidebarWidth(Number.NaN)).toBe(160);
  });
});

describe("createSidebarResizer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("resizing");
  });

  it("updates live while dragging and commits on release", () => {
    const handle = makeHandle();
    const onResize = vi.fn();
    const onCommit = vi.fn();
    let width = 280;
    createSidebarResizer({
      handle,
      getWidth: () => width,
      onResize: (value) => {
        width = value;
        onResize(value);
      },
      onCommit,
    });

    handle.dispatchEvent(pointer("pointerdown", 280));
    expect(document.documentElement.classList.contains("resizing")).toBe(true);
    handle.dispatchEvent(pointer("pointermove", 340));
    expect(onResize).toHaveBeenLastCalledWith(340);
    expect(onCommit).not.toHaveBeenCalled();

    handle.dispatchEvent(pointer("pointerup", 340));
    expect(onCommit).toHaveBeenLastCalledWith(340);
    expect(document.documentElement.classList.contains("resizing")).toBe(false);
  });

  it("clamps the dragged width to the allowed range", () => {
    const handle = makeHandle();
    const onResize = vi.fn();
    createSidebarResizer({
      handle,
      getWidth: () => 280,
      onResize,
      onCommit: vi.fn(),
    });

    handle.dispatchEvent(pointer("pointerdown", 280));
    handle.dispatchEvent(pointer("pointermove", 0));
    expect(onResize).toHaveBeenLastCalledWith(160);
  });

  it("resizes with the arrow keys and commits", () => {
    const handle = makeHandle();
    const onResize = vi.fn();
    const onCommit = vi.fn();
    let width = 280;
    createSidebarResizer({
      handle,
      getWidth: () => width,
      onResize: (value) => {
        width = value;
        onResize(value);
      },
      onCommit,
    });

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(296);
    expect(onCommit).toHaveBeenLastCalledWith(296);

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(onResize).toHaveBeenLastCalledWith(280);
    expect(onCommit).toHaveBeenLastCalledWith(280);
  });

  it("stops updating after dispose", () => {
    const handle = makeHandle();
    const onResize = vi.fn();
    const resizer = createSidebarResizer({
      handle,
      getWidth: () => 280,
      onResize,
      onCommit: vi.fn(),
    });
    resizer.dispose();

    handle.dispatchEvent(pointer("pointerdown", 280));
    handle.dispatchEvent(pointer("pointermove", 340));
    expect(onResize).not.toHaveBeenCalled();
  });
});
