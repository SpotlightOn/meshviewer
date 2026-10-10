import { beforeEach, describe, expect, it as test, vi } from "vitest";

// equirect.js creates a WebGL renderer; jsdom has no WebGL, so stub the
// renderer while keeping the rest of three intact. The stub records the camera
// direction of every render so tests can observe the look-around state.
const { rendererInstances } = vi.hoisted(() => ({ rendererInstances: [] }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  class FakeRenderer {
    constructor() {
      rendererInstances.push(this);
      this.domElement = document.createElement("canvas");
      this.lastDirection = null;
    }

    setPixelRatio() {}
    setSize() {}
    setAnimationLoop() {}
    dispose() {}
    forceContextLoss() {}

    render(_scene, camera) {
      this.lastDirection = camera.getWorldDirection(new actual.Vector3());
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

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

import { createEquirectView } from "../../../src/renderer/equirectangular/view.js";

/** Creates an activated panorama view on its own host element. */
function createView() {
  const host = document.createElement("div");
  document.body.append(host);
  const image = new Image();
  const onChange = vi.fn();
  const view = createEquirectView({ host, image, onChange });
  view.activate();
  return { host, onChange, view, canvas: host.querySelector("canvas") };
}

/** Builds a pointer event with an explicit pointer id and primary flag. */
function pointer(type, { x = 0, y = 0, id = 1 } = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: id });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event;
}

describe("createEquirectView", () => {
  beforeEach(() => {
    capturedPointerId = null;
    document.body.replaceChildren();
  });

  test("consumes pointer events so the shared container stays inert", () => {
    const { host, canvas } = createView();
    const onHostDown = vi.fn();
    const onHostUp = vi.fn();
    host.addEventListener("pointerdown", onHostDown);
    host.addEventListener("pointerup", onHostUp);

    canvas.dispatchEvent(pointer("pointerdown", { x: 100, y: 100 }));
    canvas.dispatchEvent(pointer("pointerup", { x: 90, y: 90 }));

    expect(onHostDown).not.toHaveBeenCalled();
    expect(onHostUp).not.toHaveBeenCalled();
    expect(capturedPointerId).toBeNull();
  });

  test("consumes wheel events so the image view below does not zoom", () => {
    const { host, canvas, onChange } = createView();
    const onHostWheel = vi.fn();
    host.addEventListener("wheel", onHostWheel);

    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));

    expect(onHostWheel).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeLessThan(100);
    expect(onChange.mock.calls[0][0]).toBeGreaterThanOrEqual(10);
  });

  test("changes the look direction while dragging", () => {
    const { view, canvas } = createView();
    const renderer = rendererInstances.at(-1);

    canvas.dispatchEvent(pointer("pointerdown", { x: 100, y: 100 }));
    view.setZoomPercent(100);
    const before = renderer.lastDirection.clone();
    canvas.dispatchEvent(pointer("pointermove", { x: 80, y: 100 }));
    view.setZoomPercent(100);
    const after = renderer.lastDirection.clone();

    expect(after.distanceTo(before)).toBeGreaterThan(0.0001);
  });

  test("stops the drag when the pointer is released", () => {
    const { view, canvas } = createView();
    const renderer = rendererInstances.at(-1);

    canvas.dispatchEvent(pointer("pointerdown", { x: 100, y: 100 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 80, y: 100 }));
    view.setZoomPercent(100);
    const duringDrag = renderer.lastDirection.clone();
    canvas.dispatchEvent(pointer("pointerup", { x: 80, y: 100 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 60, y: 100 }));
    view.setZoomPercent(100);
    const afterRelease = renderer.lastDirection.clone();

    expect(afterRelease.distanceTo(duringDrag)).toBeCloseTo(0, 6);
  });

  test("dispose tears down an activated view without throwing", () => {
    const { host, canvas, onChange, view } = createView();
    const renderer = rendererInstances.at(-1);
    const stopLoop = vi.spyOn(renderer, "setAnimationLoop");
    const disposeRenderer = vi.spyOn(renderer, "dispose");

    expect(() => view.dispose()).not.toThrow();

    expect(canvas.isConnected).toBe(false);
    expect(host.querySelector("canvas")).toBeNull();
    expect(stopLoop).toHaveBeenCalledWith(null);
    expect(disposeRenderer).toHaveBeenCalledTimes(1);

    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("dispose stays safe after deactivate and when called twice", () => {
    const { view } = createView();
    view.deactivate();
    view.dispose();
    expect(() => view.dispose()).not.toThrow();
  });
});
