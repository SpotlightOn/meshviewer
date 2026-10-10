import { beforeEach, describe, expect, it as test, vi } from "vitest";

// The GLB view creates a WebGL renderer and uses OrbitControls/GLTFLoader; jsdom
// has no WebGL and no controls, so stub all three while keeping the rest of
// three intact for the real math (Box3, Vector3, camera).
const { rendererInstances, controlInstances } = vi.hoisted(() => ({
  rendererInstances: [],
  controlInstances: [],
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  class FakeRenderer {
    constructor() {
      rendererInstances.push(this);
      this.domElement = document.createElement("canvas");
      this.size = null;
      this.animationLoop = null;
      this.rendered = 0;
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
    render() {
      this.rendered += 1;
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

vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const THREE = await import("three");
  class FakeOrbitControls {
    constructor(camera, domElement) {
      controlInstances.push(this);
      this.camera = camera;
      this.domElement = domElement;
      this.target = new THREE.Vector3();
      this.enableDamping = false;
      this.minDistance = 0;
      this.maxDistance = Infinity;
      this.disposed = false;
      this.dollyInCalls = 0;
      this.dollyOutCalls = 0;
      this.resetCalls = 0;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    dispatch(type) {
      for (const listener of this.listeners.get(type) ?? []) listener();
    }
    update() {}
    saveState() {}
    dollyIn() {
      this.dollyInCalls += 1;
    }
    dollyOut() {
      this.dollyOutCalls += 1;
    }
    reset() {
      this.resetCalls += 1;
    }
    dispose() {
      this.disposed = true;
    }
  }
  return { OrbitControls: FakeOrbitControls };
});

vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const THREE = await import("three");
  class FakeGLTFLoader {
    parse(_data, _path, onLoad) {
      const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      onLoad({ scene: object });
    }
  }
  return { GLTFLoader: FakeGLTFLoader };
});

// jsdom does not implement ResizeObserver.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { createGlbView } from "../../../src/renderer/3d/view.js";

/** Creates a host element with a fixed client size. */
function createHost() {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 320, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 240, configurable: true });
  document.body.append(host);
  return host;
}

const MODEL = new ArrayBuffer(8);

describe("createGlbView", () => {
  beforeEach(() => {
    rendererInstances.length = 0;
    controlInstances.length = 0;
    document.body.replaceChildren();
  });

  test("loads a model, shows the canvas and starts the render loop", async () => {
    const host = createHost();
    const view = createGlbView({ host });

    await view.load(MODEL);

    const renderer = rendererInstances.at(-1);
    expect(renderer.animationLoop).toBeTypeOf("function");
    expect(renderer.rendered).toBeGreaterThanOrEqual(1);
    expect(renderer.size).toEqual({ width: 320, height: 240 });
    expect(host.querySelector("canvas")).not.toBeNull();
  });

  test("reports the zoom percentage when the camera changes", async () => {
    const host = createHost();
    const onChange = vi.fn();
    const view = createGlbView({ host, onChange });

    await view.load(MODEL);
    controlInstances.at(-1).dispatch("change");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeGreaterThan(0);
  });

  test("deactivate stops the loop and hides the canvas, activate restores it", async () => {
    const host = createHost();
    const view = createGlbView({ host });

    await view.load(MODEL);
    const renderer = rendererInstances.at(-1);
    const canvas = host.querySelector("canvas");

    view.deactivate();
    expect(renderer.animationLoop).toBeNull();
    expect(canvas.style.display).toBe("none");

    view.activate();
    expect(renderer.animationLoop).toBeTypeOf("function");
    expect(canvas.style.display).toBe("block");
  });

  test("zoom verbs delegate to the controls", async () => {
    const host = createHost();
    const view = createGlbView({ host });

    await view.load(MODEL);
    const controls = controlInstances.at(-1);

    view.zoomIn();
    view.zoomOut();
    view.reset();

    expect(controls.dollyInCalls).toBe(1);
    expect(controls.dollyOutCalls).toBe(1);
    expect(controls.resetCalls).toBe(1);
  });

  test("setZoomPercent moves the camera", async () => {
    const host = createHost();
    const view = createGlbView({ host });

    await view.load(MODEL);
    const camera = controlInstances.at(-1).camera;
    const before = camera.position.clone();

    view.setZoomPercent(200);

    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
  });

  test("dispose tears down controls, renderer and canvas", async () => {
    const host = createHost();
    const view = createGlbView({ host });

    await view.load(MODEL);
    const renderer = rendererInstances.at(-1);
    const controls = controlInstances.at(-1);

    expect(() => view.dispose()).not.toThrow();

    expect(controls.disposed).toBe(true);
    expect(renderer.disposed).toBe(true);
    expect(renderer.contextLost).toBe(true);
    expect(renderer.animationLoop).toBeNull();
    expect(host.querySelector("canvas")).toBeNull();

    expect(() => view.dispose()).not.toThrow();
  });
});
