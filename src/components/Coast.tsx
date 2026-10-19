import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import {
  TERRAIN_BOUNDS,
  FORT_POSITION,
  FORT_GROUND,
  SPUR,
  terrainHeight,
  plateauDistance,
  shoreZ,
  fbm,
  lerp,
  smoothstep,
  createRandom,
} from '../utils/terrain';
import { Lighthouse } from './Lighthouse';

interface CoastProps {
  config: WaveConfig;
  night: boolean;
}

const TERRAIN_SPACING = 3; // meters between terrain vertices

const palette = {
  seabed: new THREE.Color('#6f6249'),
  wetSand: new THREE.Color('#9a8260'),
  sand: new THREE.Color('#d6c096'),
  drySand: new THREE.Color('#e3d1a8'),
  duneGrass: new THREE.Color('#8c8d58'),
  forestFloor: new THREE.Color('#44522e'),
  plateau: new THREE.Color('#77793f'),
  scrub: new THREE.Color('#5f6a39'),
  sandstone: new THREE.Color('#bb8656'),
  sandstoneDark: new THREE.Color('#8b5d3b'),
  rock: new THREE.Color('#7c7366'),
  rockDark: new THREE.Color('#4a443c'),
  paving: new THREE.Color('#b9ad94'),
};

const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();

function terrainColor(x: number, y: number, z: number, normalY: number, out: THREE.Color) {
  const d = z - shoreZ(x);
  const s = plateauDistance(x, z);

  // Ground cover by elevation / distance from the waterline
  if (y < -1) {
    out.copy(palette.seabed);
  } else if (y < 1.2 && d < 25) {
    out.copy(palette.wetSand).lerp(palette.sand, smoothstep(-1, 1.2, y));
  } else {
    out.copy(palette.sand).lerp(palette.drySand, smoothstep(10, 40, d));
    out.lerp(palette.duneGrass, smoothstep(55, 85, d) * smoothstep(-0.2, 0.25, fbm(x * 0.04, z * 0.04, 3)));
    out.lerp(palette.forestFloor, smoothstep(90, 130, d));
  }

  // Scrubland on top of the Sítio plateau
  if (s > -4) {
    tmpColor.copy(palette.plateau).lerp(palette.scrub, smoothstep(-0.3, 0.3, fbm(x * 0.02, z * 0.02, 3)));
    out.lerp(tmpColor, smoothstep(-4, 10, s) * smoothstep(20, 40, y));
  }

  // Stone courtyard of the fort
  const fortDist = Math.hypot(x - FORT_POSITION.x, z - FORT_POSITION.z);
  if (fortDist < 20 && y > FORT_GROUND - 2) {
    out.lerp(palette.paving, smoothstep(20, 14, fortDist));
  }

  // Cliff faces: layered ochre sandstone above, grey limestone near the sea
  const slope = 1 - normalY;
  const rockiness = smoothstep(0.22, 0.5, slope);
  if (rockiness > 0) {
    const strata = 0.5 + 0.5 * Math.sin(y * 0.9 + fbm(x * 0.02, z * 0.02, 2) * 4);
    tmpColor2.copy(palette.sandstone).lerp(palette.sandstoneDark, strata * 0.7);
    tmpColor2.lerp(palette.rock, smoothstep(30, 8, y));
    tmpColor2.lerp(palette.rockDark, smoothstep(5, -1, y));
    out.lerp(tmpColor2, rockiness);
  }

  // Fine grain variation
  out.multiplyScalar(0.9 + 0.2 * (fbm(x * 0.25, z * 0.25, 2) * 0.5 + 0.5));
}

function createTerrainGeometry() {
  const { minX, maxX, minZ, maxZ } = TERRAIN_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const geo = new THREE.PlaneGeometry(width, depth, Math.round(width / TERRAIN_SPACING), Math.round(depth / TERRAIN_SPACING));
  geo.rotateX(-Math.PI / 2);
  geo.translate(minX + width / 2, 0, minZ + depth / 2);

  const position = geo.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, terrainHeight(position.getX(i), position.getZ(i)));
  }
  geo.computeVertexNormals();

  const normal = geo.attributes.normal;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    terrainColor(position.getX(i), position.getY(i), position.getZ(i), normal.getY(i), color);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface InstanceSpec {
  position: THREE.Vector3;
  rotationY: number;
  scale: THREE.Vector3;
  color: THREE.Color;
  tilt?: THREE.Euler;
}

function createInstancedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, specs: InstanceSpec[]) {
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

/** Maritime pine forest (Pinhal) behind Praia do Norte, scrub on the dunes */
function createVegetation() {
  const rand = createRandom(1987);
  const trunks: InstanceSpec[] = [];
  const canopies: InstanceSpec[] = [];
  const shrubs: InstanceSpec[] = [];
  const trunkColor = new THREE.Color('#4b3826');
  const pineDark = new THREE.Color('#263d20');
  const pineLight = new THREE.Color('#3f5a2c');
  const shrubDark = new THREE.Color('#4f5733');
  const shrubLight = new THREE.Color('#7d8050');

  for (let attempt = 0; attempt < 16000 && canopies.length < 2600; attempt++) {
    const x = lerp(-175, TERRAIN_BOUNDS.maxX - 20, rand());
    const z = lerp(150, TERRAIN_BOUNDS.maxZ - 20, rand());
    const d = z - shoreZ(x);
    if (d < 95 + rand() * 35) continue;
    const s = plateauDistance(x, z);
    if (s > -12 && !(x < -380 && z > 380 && rand() < 0.35)) continue;
    // Natural clearings
    if (fbm(x * 0.01, z * 0.01, 2) < -0.15 && rand() < 0.75) continue;

    const y = terrainHeight(x, z);
    const height = 8 + rand() * 7;
    const spread = 3.2 + rand() * 2.4;
    trunks.push({
      position: new THREE.Vector3(x, y - 0.5, z),
      rotationY: 0,
      scale: new THREE.Vector3(1, height * 0.8, 1),
      color: trunkColor,
    });
    canopies.push({
      position: new THREE.Vector3(x, y + height * 0.8, z),
      rotationY: rand() * Math.PI,
      scale: new THREE.Vector3(spread, spread * (0.45 + rand() * 0.2), spread * (0.8 + rand() * 0.4)),
      color: pineDark.clone().lerp(pineLight, rand()),
    });
  }

  for (let attempt = 0; attempt < 12000 && shrubs.length < 2400; attempt++) {
    const x = lerp(-165, TERRAIN_BOUNDS.maxX - 20, rand());
    const z = lerp(160, 320, rand());
    const d = z - shoreZ(x);
    if (d < 38 || d > 110) continue;
    if (plateauDistance(x, z) > -12) continue;
    if (fbm(x * 0.04, z * 0.04, 3) < -0.1) continue;
    const size = 0.5 + rand() * 1.1;
    shrubs.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) - 0.1, z),
      rotationY: rand() * Math.PI,
      scale: new THREE.Vector3(size * 1.2, size * 0.8, size),
      color: shrubDark.clone().lerp(shrubLight, rand()),
    });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const shrubGeo = new THREE.IcosahedronGeometry(1, 0);
  const foliage = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });

  return [
    createInstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), trunks),
    createInstancedMesh(canopyGeo, foliage, canopies),
    createInstancedMesh(shrubGeo, foliage, shrubs),
  ];
}

/** Boulders at the foot of the headland cliffs */
function createRocks() {
  const rand = createRandom(2013);
  const rocks: InstanceSpec[] = [];
  const dark = new THREE.Color('#4e4840');
  const light = new THREE.Color('#857b6c');

  for (let attempt = 0; attempt < 20000 && rocks.length < 220; attempt++) {
    const x = lerp(-290, -150, rand());
    const z = lerp(-10, 175, rand());
    const y = terrainHeight(x, z);
    if (y < -5 || y > 4) continue;
    // Only where the cliffs meet the sea, not out on the open beach
    if (plateauDistance(x, z) < -30 && Math.hypot((x - SPUR.x) / SPUR.rx, (z - SPUR.z) / SPUR.rz) > 1.4) continue;
    const size = 1 + rand() * rand() * 5;
    rocks.push({
      position: new THREE.Vector3(x, y - size * 0.3, z),
      rotationY: 0,
      tilt: new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI),
      scale: new THREE.Vector3(size * (0.8 + rand() * 0.6), size * (0.5 + rand() * 0.4), size * (0.8 + rand() * 0.6)),
      color: dark.clone().lerp(light, rand()),
    });
  }

  const geo = new THREE.DodecahedronGeometry(1, 0);
  return createInstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), rocks);
}

const SANCTUARY = { x: -300, z: 140 };
const ERMIDA = { x: -200, z: 100 };

/** Whitewashed houses with terracotta roofs of the Sítio village on the plateau */
function createVillage() {
  const rand = createRandom(1377);
  const walls: InstanceSpec[] = [];
  const roofs: InstanceSpec[] = [];
  const wallColors = ['#f4f1ea', '#efe9dc', '#f6f3ee', '#ece2c8', '#f1e3b5', '#e9eef0'].map((c) => new THREE.Color(c));
  const roofColors = ['#b4552f', '#a34a2a', '#c0683d', '#9b4528'].map((c) => new THREE.Color(c));
  const streetAngle = 0.35;

  for (let attempt = 0; attempt < 12000 && walls.length < 320; attempt++) {
    const x = lerp(-560, -205, rand());
    const z = lerp(95, 440, rand());
    const s = plateauDistance(x, z);
    if (s < 14) continue;
    // Denser near the cliff edge, thinning out inland
    if (rand() > 0.3 + 0.7 * smoothstep(140, 25, s)) continue;
    if (Math.hypot(x - SANCTUARY.x, z - SANCTUARY.z) < 34) continue;
    if (Math.hypot(x - ERMIDA.x, z - ERMIDA.z) < 10) continue;

    const width = 5 + rand() * 5;
    const depth = 5 + rand() * 5;
    const height = 4 + Math.floor(rand() * 3) * 3 + rand();
    const rotationY = streetAngle + Math.floor(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.15;
    const y = terrainHeight(x, z) - 1;

    walls.push({
      position: new THREE.Vector3(x, y, z),
      rotationY,
      scale: new THREE.Vector3(width, height + 1, depth),
      color: wallColors[Math.floor(rand() * wallColors.length)],
    });
    roofs.push({
      position: new THREE.Vector3(x, y + height + 1, z),
      rotationY,
      scale: new THREE.Vector3(width * 1.08, 1.6 + rand() * 1.2, depth * 1.08),
      color: roofColors[Math.floor(rand() * roofColors.length)],
    });
  }

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

function gableRoofGeometry(width: number, height: number, length: number) {
  const shape = new THREE.Shape([
    new THREE.Vector2(-width / 2, 0),
    new THREE.Vector2(width / 2, 0),
    new THREE.Vector2(0, height),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  return geo;
}

const whitewash = { color: '#f4f1ea', roughness: 0.85 };
const stoneTrim = { color: '#c9bc9a', roughness: 0.9 };
const terracotta = { color: '#a84d2b', roughness: 0.8 };

/** Santuário de Nossa Senhora da Nazaré - baroque church with twin bell towers */
function Sanctuary() {
  const y = terrainHeight(SANCTUARY.x, SANCTUARY.z) - 1;
  const naveRoof = useMemo(() => gableRoofGeometry(13, 4, 26), []);
  const pediment = useMemo(() => gableRoofGeometry(11, 3.5, 0.8), []);

  return (
    <group position={[SANCTUARY.x, y, SANCTUARY.z]} rotation={[0, -Math.PI / 2 + 0.35, 0]}>
      {/* Nave */}
      <mesh position={[0, 7, 1]}>
        <boxGeometry args={[12, 14, 26]} />
        <meshStandardMaterial {...whitewash} />
      </mesh>
      <mesh geometry={naveRoof} position={[0, 14, 1]}>
        <meshStandardMaterial {...terracotta} />
      </mesh>
      {/* Facade pediment */}
      <mesh geometry={pediment} position={[0, 14, -12]}>
        <meshStandardMaterial {...whitewash} />
      </mesh>
      {/* Twin bell towers */}
      {[-7.5, 7.5].map((tx) => (
        <group key={tx} position={[tx, 0, -10.5]}>
          <mesh position={[0, 10, 0]}>
            <boxGeometry args={[4.5, 20, 4.5]} />
            <meshStandardMaterial {...whitewash} />
          </mesh>
          <mesh position={[0, 20.4, 0]}>
            <boxGeometry args={[5.2, 0.8, 5.2]} />
            <meshStandardMaterial {...stoneTrim} />
          </mesh>
          <mesh position={[0, 22.5, 0]}>
            <boxGeometry args={[3.4, 3.4, 3.4]} />
            <meshStandardMaterial {...whitewash} />
          </mesh>
          <mesh position={[0, 25.6, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[2.6, 2.8, 4]} />
            <meshStandardMaterial {...terracotta} flatShading />
          </mesh>
        </group>
      ))}
      {/* Stone corner pilasters and portal */}
      {[-5.8, 5.8].map((px) => (
        <mesh key={px} position={[px, 7, -12.1]}>
          <boxGeometry args={[0.8, 14, 0.6]} />
          <meshStandardMaterial {...stoneTrim} />
        </mesh>
      ))}
      <mesh position={[0, 3, -12.2]}>
        <boxGeometry args={[3, 6, 0.4]} />
        <meshStandardMaterial color="#5b4636" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Ermida da Memória - tiny chapel perched on the cliff edge */
function Ermida() {
  const y = terrainHeight(ERMIDA.x, ERMIDA.z) - 0.5;
  return (
    <group position={[ERMIDA.x, y, ERMIDA.z]} rotation={[0, 0.3, 0]}>
      <mesh position={[0, 3, 0]}>
        <boxGeometry args={[5, 6, 5]} />
        <meshStandardMaterial {...whitewash} />
      </mesh>
      <mesh position={[0, 7, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[3.8, 2.4, 4]} />
        <meshStandardMaterial {...terracotta} flatShading />
      </mesh>
    </group>
  );
}

export function Coast({ config, night }: CoastProps) {
  const terrainGeometry = useMemo(() => createTerrainGeometry(), []);
  const vegetation = useMemo(() => createVegetation(), []);
  const rocks = useMemo(() => createRocks(), []);
  const village = useMemo(() => createVillage(), []);

  useEffect(() => () => {
    terrainGeometry.dispose();
    [...vegetation, rocks, ...village].forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    });
  }, [terrainGeometry, vegetation, rocks, village]);

  // In wireframe mode the seabed is clipped away so it doesn't clutter the grid
  const clippingPlanes = useMemo(
    () => (config.wireframe ? [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.5)] : []),
    [config.wireframe]
  );

  return (
    <group>
      <mesh geometry={terrainGeometry}>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} clippingPlanes={clippingPlanes} />
      </mesh>
      {vegetation.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      <primitive object={rocks} />
      {village.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      <Sanctuary />
      <Ermida />
      <Lighthouse night={night} />
    </group>
  );
}
