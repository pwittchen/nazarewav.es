import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import {
  TERRAIN_BOUNDS,
  FORT_POSITION,
  FORT_GROUND,
  LARGO,
  BREAKWATER,
  FUNICULAR,
  terrainHeight,
  plateauDistance,
  southCliffX,
  shoreZ,
  townMask,
  roadDistance,
  breakwaterMask,
  segmentDistance,
  fbm,
  lerp,
  smoothstep,
  createRandom,
} from '../utils/terrain';
import { createInstancedMesh, createHouseMeshes, createLightPoints, disposeObject, type InstanceSpec } from '../utils/instancing';
import { Lighthouse } from './Lighthouse';
import { Town } from './Town';
import { Funicular } from './Funicular';

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
  plateau: new THREE.Color('#77793f'),
  scrub: new THREE.Color('#5f6a39'),
  sandstone: new THREE.Color('#bb8656'),
  sandstoneDark: new THREE.Color('#8b5d3b'),
  rock: new THREE.Color('#7c7366'),
  rockDark: new THREE.Color('#4a443c'),
  paving: new THREE.Color('#b9ad94'),
  calcada: new THREE.Color('#bdb6a6'), // Portuguese limestone pavement
  asphalt: new THREE.Color('#55534f'),
  urban: new THREE.Color('#8f877a'),
};

const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();
const tmpColor3 = new THREE.Color();

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
    out.lerp(palette.scrub, smoothstep(90, 130, d));
  }

  // Town: beach, calçada promenade, the seafront avenue, then built-up ground
  const town = townMask(x);
  if (town > 0 && d > 55) {
    tmpColor3.copy(palette.calcada)
      .lerp(palette.asphalt, smoothstep(69, 71, d) * smoothstep(81, 79, d))
      .lerp(palette.urban, smoothstep(84, 92, d));
    out.lerp(tmpColor3, town * smoothstep(60, 64, d));
  }

  // Scrubland on top of the Sítio plateau
  if (s > -4) {
    tmpColor.copy(palette.plateau).lerp(palette.scrub, smoothstep(-0.3, 0.3, fbm(x * 0.02, z * 0.02, 3)));
    out.lerp(tmpColor, smoothstep(-4, 10, s) * smoothstep(20, 40, y));
    // Largo do Sítio and the road down to the fort
    const largo = Math.max(LARGO.minX - x, x - LARGO.maxX, LARGO.minZ - z, z - LARGO.maxZ);
    out.lerp(palette.calcada, smoothstep(2, -1, largo));
    out.lerp(palette.asphalt, smoothstep(4.5, 3, roadDistance(x, z)) * smoothstep(20, 30, y));
  }

  // Rock armour of the harbour breakwater
  const mole = breakwaterMask(x, z);
  if (mole > 0) out.lerp(palette.rock, mole);

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

/** Armour stones along both flanks and around the head of the harbour breakwater */
function createRocks() {
  const rand = createRandom(2013);
  const rocks: InstanceSpec[] = [];
  const dark = new THREE.Color('#4e4840');
  const light = new THREE.Color('#857b6c');

  const bwShore = shoreZ(BREAKWATER.x);
  for (let z = bwShore + 10; z > bwShore - BREAKWATER.length - 6; z -= 2.2) {
    const tip = z < bwShore - BREAKWATER.length + 4;
    for (const side of tip ? [-1, -0.5, 0, 0.5, 1] : [-1, 1]) {
      const x = BREAKWATER.x + side * (7 + rand() * 2.5);
      const zz = tip ? z - (1 - Math.abs(side)) * 7 : z + (rand() - 0.5);
      const size = 1.6 + rand() * 1.8;
      rocks.push({
        position: new THREE.Vector3(x, terrainHeight(x, zz) - size * 0.2, zz),
        rotationY: 0,
        tilt: new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI),
        scale: new THREE.Vector3(size, size * 0.8, size),
        color: dark.clone().lerp(light, 0.4 + rand() * 0.6),
      });
    }
  }

  const geo = new THREE.DodecahedronGeometry(1, 0);
  return createInstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), rocks);
}

export const SANCTUARY = { x: -410, z: 457 };
// Ermida da Memória sits on the cliff edge by the Miradouro do Suberco, above the town
const ERMIDA = { x: southCliffX(338) + 15, z: 338 };

function isSitioLandmark(x: number, z: number) {
  return (x > LARGO.minX - 6 && x < LARGO.maxX + 6 && z > LARGO.minZ - 6 && z < LARGO.maxZ + 6)
    || Math.hypot(x - SANCTUARY.x, z - SANCTUARY.z) < 30
    || Math.hypot(x - ERMIDA.x, z - ERMIDA.z) < 12
    || Math.hypot(x - FUNICULAR.upper.x, z - FUNICULAR.upper.z) < 16
    || roadDistance(x, z) < 8;
}

/** Whitewashed houses with terracotta roofs of the Sítio and of Pederneira above the town */
function createVillage() {
  const rand = createRandom(1377);
  const walls: InstanceSpec[] = [];
  const roofs: InstanceSpec[] = [];
  const lights: THREE.Vector3[] = [];
  const wallColors = ['#f4f1ea', '#efe9dc', '#f6f3ee', '#ece2c8', '#f1e3b5', '#e9eef0'].map((c) => new THREE.Color(c));
  const roofColors = ['#b4552f', '#a34a2a', '#c0683d', '#9b4528'].map((c) => new THREE.Color(c));
  const streetAngle = 0.35;

  for (let attempt = 0; attempt < 60000 && walls.length < 560; attempt++) {
    const x = lerp(TERRAIN_BOUNDS.minX + 40, -205, rand());
    const z = lerp(95, TERRAIN_BOUNDS.maxZ - 10, rand());
    const s = plateauDistance(x, z);
    if (s < 18) continue;
    if (x > -470) {
      // Sítio: denser near the cliff edge, thinning out inland
      if (z > 640 || rand() > 0.3 + 0.7 * smoothstep(140, 25, s)) continue;
    } else if (rand() > 0.6 * smoothstep(60, 20, s)) {
      continue; // Pederneira, along the escarpment above the town
    }
    if (isSitioLandmark(x, z)) continue;
    // Keep the funicular cutting clear
    if (segmentDistance(x, z, FUNICULAR.lower.x, FUNICULAR.lower.z, FUNICULAR.upper.x, FUNICULAR.upper.z).dist < 10) continue;

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
    if (rand() < 0.45) {
      const r = width / 2 + 0.4;
      lights.push(new THREE.Vector3(x + Math.cos(rotationY) * r, y + 3.5, z - Math.sin(rotationY) * r));
    }
  }

  return { meshes: createHouseMeshes(walls, roofs), lights };
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
    <group position={[SANCTUARY.x, y, SANCTUARY.z]} rotation={[0, 0.04, 0]}>
      {/* Facade (local -Z) faces west onto the Largo */}
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
  const rocks = useMemo(() => createRocks(), []);
  const village = useMemo(() => createVillage(), []);
  const villageLights = useMemo(() => createLightPoints(village.lights), [village]);

  useEffect(() => () => {
    terrainGeometry.dispose();
    [rocks, ...village.meshes, villageLights].forEach(disposeObject);
  }, [terrainGeometry, rocks, village, villageLights]);

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
      <primitive object={rocks} />
      {village.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      {night && <primitive object={villageLights} />}
      <Sanctuary />
      <Ermida />
      <Town night={night} />
      <Funicular night={night} />
      <Lighthouse night={night} />
    </group>
  );
}
