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

export { disposeObject };
