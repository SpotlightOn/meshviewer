import { beforeEach, describe, expect, it as test, vi } from "vitest";

// render-surface creates a WebGL renderer; jsdom has no WebGL, so stub the
// renderer while keeping the rest of three intact.
const { rendererInstances } = vi.hoisted(() => ({ rendererInstances: [] }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  class FakeRenderer {
    constructor() {
      rendererInstances.push(this);
      this.domElement = document.createElement("canvas");
      this.size = null;
      this.animationLoop = null;
      this.disposed = false;
      this.contextLost = false;
    }

    setPixelRatio() {}
    setSize(width, height) {
      this.size = { width, height };
    }
    setAnimationLoop(animationLoop) {
      this.animationLoop = animationLoop;
    }
    dispose() {
      this.disposed = true;
    }
    forceContextLoss() {
      this.contextLost = true;
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

// jsdom does not implement ResizeObserver; record the instances so the tests can
// inspect what was observed and disconnected.
const observers = [];
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.observed = null;
    this.disconnected = false;
    observers.push(this);
  }
  observe(element) {
    this.observed = element;
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
};

import { createRenderSurface } from "../../../src/renderer/three/render-surface.js";

/** Creates a host element with a fixed client size. */
function createHost(width = 320, height = 240) {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: height, configurable: true });
  document.body.append(host);
  return host;
}

describe("createRenderSurface", () => {
  beforeEach(() => {
    rendererInstances.length = 0;
    observers.length = 0;
    document.body.replaceChildren();
  });

  test("observes the host and sizes the renderer on resize", () => {
    const host = createHost(320, 240);
    const onResize = vi.fn();
    const surface = createRenderSurface({ host, onResize });
    const renderer = rendererInstances.at(-1);

    expect(observers.at(-1).observed).toBe(host);

    surface.resize();

    expect(renderer.size).toEqual({ width: 320, height: 240 });
    expect(onResize).toHaveBeenLastCalledWith({ width: 320, height: 240 });
  });

  test("starts and stops the render loop", () => {
    const surface = createRenderSurface({ host: createHost() });
    const renderer = rendererInstances.at(-1);
    const render = vi.fn();

    surface.start(render);
    expect(renderer.animationLoop).toBe(render);

    surface.stop();
    expect(renderer.animationLoop).toBeNull();
  });

  test("dispose releases the renderer, context, observer and canvas", () => {
    const host = createHost();
    const surface = createRenderSurface({ host });
    const renderer = rendererInstances.at(-1);
    host.append(surface.canvas);

    surface.dispose();

    expect(renderer.disposed).toBe(true);
    expect(renderer.contextLost).toBe(true);
    expect(renderer.animationLoop).toBeNull();
    expect(observers.at(-1).disconnected).toBe(true);
    expect(surface.canvas.isConnected).toBe(false);

    surface.start(() => {});
    expect(renderer.animationLoop).toBeNull();
  });
});
