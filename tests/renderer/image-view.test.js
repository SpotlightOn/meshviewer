import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImageView } from "../../src/renderer/image-view.js";

// jsdom does not implement ResizeObserver or pointer capture.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let capturedPointerId = null;
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = (pointerId) => {
    capturedPointerId = pointerId;
  };
  HTMLElement.prototype.hasPointerCapture = (pointerId) => capturedPointerId === pointerId;
  HTMLElement.prototype.releasePointerCapture = () => {
    capturedPointerId = null;
  };
}

/**
 * Creates an image view on a canvas of a fixed size.
 * @param {{width?: number, height?: number, imageWidth?: number, imageHeight?: number}} [options] - Canvas and image dimensions.
 * @returns {{canvas: HTMLElement, img: HTMLImageElement, view: object, onChange: Function, onSwipe: Function}} Image view under test.
 */
function createView({ width = 400, height = 300, imageWidth = 800, imageHeight = 600 } = {}) {
  const canvas = document.createElement("div");
  Object.defineProperty(canvas, "clientWidth", { value: width });
  Object.defineProperty(canvas, "clientHeight", { value: height });
  document.body.append(canvas);

  const img = document.createElement("img");
  Object.defineProperty(img, "naturalWidth", { value: imageWidth });
  Object.defineProperty(img, "naturalHeight", { value: imageHeight });

  const onChange = vi.fn();
  const onSwipe = vi.fn();
  const view = createImageView(canvas, img, onChange, onSwipe);
  return { canvas, img, view, onChange, onSwipe };
}

/**
 * Builds a pointer event with an explicit pointer id.
 * @param {string} type - Event type.
 * @param {number} x - Client x coordinate.
 * @param {number} y - Client y coordinate.
 * @param {number} button - Mouse button.
 * @returns {PointerEvent} Pointer event.
 */
function pointer(type, x, y, button = 0) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("createImageView", () => {
  beforeEach(() => {
    capturedPointerId = null;
    document.body.replaceChildren();
  });

  it("fits the image into the canvas without upscaling", () => {
    const { view, onChange } = createView();
    view.fitView();

    expect(view.getScale()).toBeCloseTo(0.5);
    expect(view.getTransform()).toMatchObject({ tx: 0, ty: 0, scale: 0.5 });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("never upscales an image smaller than the canvas", () => {
    const { view } = createView({ imageWidth: 100, imageHeight: 100 });
    view.fitView();

    expect(view.getScale()).toBe(1);
    expect(view.getTransform()).toMatchObject({ tx: 150, ty: 100 });
  });

  it("zooms in and out in steps around the canvas centre", () => {
    const { view } = createView();
    view.fitView();
    view.zoomIn();
    expect(view.getScale()).toBeCloseTo(0.625);
    view.zoomOut();
    expect(view.getScale()).toBeCloseTo(0.5);
  });

  it("zooms with the wheel around the cursor", () => {
    const { canvas, view } = createView();
    view.fitView();
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, clientX: 300, clientY: 150 }));
    expect(view.getScale()).toBeCloseTo(0.55);
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, clientX: 300, clientY: 150 }));
    expect(view.getScale()).toBeCloseTo(0.5);
  });

  it("sets an exact zoom percentage", () => {
    const { view } = createView();
    view.setZoom(200);

    expect(view.getScale()).toBe(2);
  });

  it("resets the image to 100% and centres it", () => {
    const { view } = createView();
    view.fitView();
    view.reset();

    expect(view.getTransform()).toMatchObject({ tx: -200, ty: -150, scale: 1 });
  });

  it("toggles between the fitted view and 100%", () => {
    const { view } = createView();
    view.fitView();
    view.toggleFit();
    expect(view.getScale()).toBe(1);
    view.toggleFit();
    expect(view.getScale()).toBeCloseTo(0.5);
  });

  it("pans the zoomed image by the drag delta", () => {
    const { canvas, img, view } = createView();
    view.fitView();
    view.setZoom(200);
    const before = view.getTransform();

    canvas.dispatchEvent(pointer("pointerdown", 100, 100));
    canvas.dispatchEvent(pointer("pointermove", 140, 130));
    canvas.dispatchEvent(pointer("pointerup", 140, 130));

    const after = view.getTransform();
    expect(after.tx - before.tx).toBe(40);
    expect(after.ty - before.ty).toBe(30);
    expect(after.scale).toBe(2);
    expect(img.style.transform).toBe(`translate(${after.tx}px, ${after.ty}px) scale(2)`);
  });

  it("toggles between fit and 100% on a middle click", () => {
    const { canvas, view } = createView();
    view.fitView();

    canvas.dispatchEvent(pointer("pointerdown", 200, 150, 1));
    canvas.dispatchEvent(pointer("pointerup", 200, 150, 1));
    expect(view.getScale()).toBe(1);

    canvas.dispatchEvent(pointer("pointerdown", 200, 150, 1));
    canvas.dispatchEvent(pointer("pointerup", 200, 150, 1));
    expect(view.getScale()).toBeCloseTo(0.5);
  });

  it("navigates on a horizontal drag that passes the threshold", () => {
    const { canvas, view, onSwipe } = createView();
    view.fitView();

    canvas.dispatchEvent(pointer("pointerdown", 300, 150));
    canvas.dispatchEvent(pointer("pointermove", 100, 150));
    canvas.dispatchEvent(pointer("pointerup", 100, 150));

    expect(onSwipe).toHaveBeenCalledWith(1);
  });

  it("snaps back without navigating when the drag is too short", () => {
    const { canvas, img, view, onSwipe } = createView();
    view.fitView();

    canvas.dispatchEvent(pointer("pointerdown", 300, 150));
    canvas.dispatchEvent(pointer("pointermove", 280, 150));
    canvas.dispatchEvent(pointer("pointerup", 280, 150));

    expect(onSwipe).not.toHaveBeenCalled();
    expect(img.style.transition).toBe("transform 180ms ease-out");
  });

  it("stops reacting once it is disposed", () => {
    const { canvas, view } = createView();
    view.fitView();
    view.dispose();

    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, clientX: 300, clientY: 150 }));
    canvas.dispatchEvent(pointer("pointerdown", 300, 150));
    canvas.dispatchEvent(pointer("pointermove", 100, 150));
    canvas.dispatchEvent(pointer("pointerup", 100, 150));

    expect(view.getScale()).toBeCloseTo(0.5);
  });
});
