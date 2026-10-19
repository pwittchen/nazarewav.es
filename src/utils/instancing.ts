import * as THREE from 'three';

export interface InstanceSpec {
  position: THREE.Vector3;
  rotationY: number;
  scale: THREE.Vector3;
  color: THREE.Color;
  tilt?: THREE.Euler;
}

export function createInstancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, specs: InstanceSpec[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
  const dummy = new THREE.Object3D();
  specs.forEach((spec, i) => {
    dummy.position.copy(spec.position);
    if (spec.tilt) {
      dummy.rotation.copy(spec.tilt);
    } else {
      dummy.rotation.set(0, spec.rotationY, 0);
    }
    dummy.scale.copy(spec.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, spec.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Soft round glow sprite for the light points */
function createGlowTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, 1 - r) ** 2;
      const idx = (j * size + i) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Warm street lights and lit windows, shown at night */
export function createLightPoints(positions: THREE.Vector3[], color = '#ffcf87', size = 3) {
  const geo = new THREE.BufferGeometry().setFromPoints(positions);
  const material = new THREE.PointsMaterial({
    color,
    size,
    map: createGlowTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  return new THREE.Points(geo, material);
}

export function disposeObject(object: THREE.Mesh | THREE.Points) {
  object.geometry.dispose();
  const material = object.material as THREE.Material & { map?: THREE.Texture | null };
  material.map?.dispose();
  material.dispose();
  if (object instanceof THREE.InstancedMesh) object.dispose();
}

/** Whitewashed walls (1x1x1 box standing on its base) and hipped terracotta roofs */
export function createHouseMeshes(walls: InstanceSpec[], roofs: InstanceSpec[]) {
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  // Four-sided cone rotated 45° = hipped roof with a 1x1 footprint
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);

  return [
    createInstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), walls),
    createInstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), roofs),
  ];
}
