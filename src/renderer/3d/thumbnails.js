import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeObject } from "./utils.js";

const THUMB_SIZE = 256;

// Singleton renderer shared by all GLB thumbnail renders.
const thumbnailRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
thumbnailRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
thumbnailRenderer.setClearColor(0x3a3a3a, 1);

/**
 * Renders a GLB model as a PNG data URL (thumbnail).
 * @param {ArrayBuffer} arrayBuffer - GLB binary data.
 * @returns {Promise<string>} PNG data URL of the rendered thumbnail.
 */
function renderGlbThumbnail(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x505050, 1.4));
        scene.add(new THREE.DirectionalLight(0xffffff, 1.8));

        const object = gltf.scene;
        scene.add(object);

        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
        const halfFov = THREE.MathUtils.degToRad(45 / 2);
        const distance = (maxDim / 2 / Math.tan(halfFov)) * 1.25;
        const offset = new THREE.Vector3(0.7, 0.75, 1).normalize().multiplyScalar(distance);

        camera.position.copy(center).add(offset);
        camera.near = distance / 1000;
        camera.far = distance * 10;
        camera.lookAt(center);
        camera.updateProjectionMatrix();

        thumbnailRenderer.render(scene, camera);
        const dataUrl = thumbnailRenderer.domElement.toDataURL("image/png");

        disposeObject(scene);
        resolve(dataUrl);
      },
      (error) => reject(error),
    );
  });
}

export { renderGlbThumbnail };
