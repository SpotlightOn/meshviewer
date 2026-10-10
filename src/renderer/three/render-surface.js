import * as THREE from "three";

/**
 * Creates a WebGL render surface bound to a host element. It owns the renderer,
 * keeps its drawing buffer in sync with the host size and exposes a uniform
 * start/stop/dispose lifecycle shared by all three.js views. The canvas is not
 * attached to the host automatically; the caller decides when the surface
 * becomes visible.
 * @param {object} options - Options.
 * @param {HTMLElement} options.host - Container element that defines the size.
 * @param {(size: {width: number, height: number}) => void} [options.onResize] - Called after the surface was resized, so the caller can update its camera.
 * @returns {{renderer: import('three').WebGLRenderer, canvas: HTMLCanvasElement, resize: () => void, start: (render: () => void) => void, stop: () => void, dispose: () => void}} Render surface controller.
 */
function createRenderSurface({ host, onResize }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio);
  const canvas = renderer.domElement;

  let disposed = false;

  /**
   * Sizes the renderer to the host and notifies the caller so it can update its
   * camera.
   */
  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height);
    onResize?.({ width, height });
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  return {
    renderer,
    canvas,
    resize,

    /**
     * Starts the render loop.
     * @param {() => void} render - Per-frame callback.
     */
    start(render) {
      if (disposed) return;
      renderer.setAnimationLoop(render);
    },

    /**
     * Stops the render loop.
     */
    stop() {
      renderer.setAnimationLoop(null);
    },

    /**
     * Stops the loop, releases the WebGL context and removes the canvas.
     */
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export { createRenderSurface };
