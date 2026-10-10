import { clampZoomPercent } from "../utils.js";

/**
 * Disposes geometries and materials (including textures) of a three.js object.
 * @param {import('three').Object3D} object - Scene or object graph.
 */
function disposeObject(object) {
  object.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        for (const key of Object.keys(material)) {
          const value = material[key];
          if (value && typeof value === "object" && value.isTexture) {
            value.dispose();
          }
        }
        material.dispose();
      }
    }
  });
}

/**
 * Converts a zoom percentage to a GLB camera distance, where 100 % equals the
 * fitted distance and higher percentages move the camera closer.
 * @param {number} baseDistance - Camera distance at 100 %.
 * @param {number} percent - Zoom in percent.
 * @returns {number} Camera distance.
 */
function glbDistanceForPercent(baseDistance, percent) {
  return baseDistance * (100 / clampZoomPercent(percent));
}

/**
 * Converts a GLB camera distance to a zoom percentage within the slider range.
 * @param {number} baseDistance - Camera distance at 100 %.
 * @param {number} distance - Current camera distance.
 * @returns {number} Zoom in percent.
 */
function glbPercentForDistance(baseDistance, distance) {
  return clampZoomPercent(Math.round((baseDistance / Math.max(1e-9, distance)) * 100));
}

export { disposeObject, glbDistanceForPercent, glbPercentForDistance };
