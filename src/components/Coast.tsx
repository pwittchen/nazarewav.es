import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import {
  TERRAIN_BOUNDS,
  SANCTUARY,
  ERMIDA,
  SURFACE,
  terrainHeight,
  surfaceAt,
  createRandom,
} from '../utils/terrain';
import { regionGrid } from '../utils/geodata';
import { createTerrainMaterial } from '../utils/terrainMaterial';
import { createInstancedMesh, disposeObject, type InstanceSpec } from '../utils/instancing';
import { Lighthouse } from './Lighthouse';
import { Town } from './Town';
import { Funicular } from './Funicular';

interface CoastProps {
  config: WaveConfig;
  night: boolean;
}

const TERRAIN_SPACING = 5; // Meters between terrain vertices, half the baked grid (heights are sampled bicubic)
const OUTER_STEP = 1;      // Outer hills use every cell of the 30 m regional grid

function createTerrainGeometry() {
  const { minX, maxX, minZ, maxZ } = TERRAIN_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const geo = new THREE.PlaneGeometry(width, depth, Math.round(width / TERRAIN_SPACING), Math.round(depth / TERRAIN_SPACING));
  geo.rotateX(-Math.PI / 2);
  geo.translate(minX + width / 2, 0, minZ + depth / 2);
  geo.deleteAttribute('uv');

  const position = geo.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, terrainHeight(position.getX(i), position.getZ(i)));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Hills around the detailed terrain, so that the land runs on into the haze */
function createOuterHills() {
  const { minX, minZ, cell, nx, nz, heights } = regionGrid;
  const b = TERRAIN_BOUNDS;
  const step = OUTER_STEP;
  const positions: number[] = [];
  const indices: number[] = [];
  const columns = Math.floor((nx - 1) / step) + 1;
  const rows = Math.floor((nz - 1) / step) + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const h = heights[j * step * nx + i * step];
      positions.push(minX + i * step * cell, h - 1, minZ + j * step * cell);
    }
  }
  const quad = step * cell;
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < columns; i++) {
      const x = minX + i * quad;
      const z = minZ + j * quad;
      const inner = x >= b.minX + quad && x + quad <= b.maxX - quad && z >= b.minZ + quad && z + quad <= b.maxZ - quad;
      const a = j * columns + i;
      const land = Math.max(positions[a * 3 + 1], positions[(a + 1) * 3 + 1], positions[(a + columns) * 3 + 1], positions[(a + columns + 1) * 3 + 1]);
      if (inner || land < -0.5) continue;
      indices.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1); // Counter-clockwise from above
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Armour stones along the harbour moles mapped in OSM */
function createRocks() {
  const rand = createRandom(2013);
  const rocks: InstanceSpec[] = [];
  const dark = new THREE.Color('#4e4840');
  const light = new THREE.Color('#857b6c');
  const { minX, maxX, minZ, maxZ } = TERRAIN_BOUNDS;
  for (let x = Math.max(minX, -3300); x < Math.min(maxX, -1500); x += 5) {
    for (let z = Math.max(minZ, 500); z < Math.min(maxZ, 1500); z += 5) {
      if (!(surfaceAt(x, z) & SURFACE.rock)) continue;
      const size = 1.8 + rand() * 2;
      const rx = x + (rand() - 0.5) * 6;
      const rz = z + (rand() - 0.5) * 6;
      rocks.push({
        position: new THREE.Vector3(rx, terrainHeight(rx, rz) - size * 0.2, rz),
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
    <group position={[SANCTUARY.x, y, SANCTUARY.z]} rotation={[0, Math.PI + 0.04, 0]}>
      {/* Facade (local -Z) faces east onto the Largo */}
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
  const outerHills = useMemo(() => createOuterHills(), []);
  const rocks = useMemo(() => createRocks(), []);
  const terrainMaterial = useMemo(() => createTerrainMaterial(), []);

  useEffect(() => () => {
    terrainGeometry.dispose();
    outerHills.dispose();
    terrainMaterial.dispose();
    disposeObject(rocks);
  }, [terrainGeometry, outerHills, terrainMaterial, rocks]);

  // In wireframe mode the seabed is clipped away so it doesn't clutter the grid
  const clippingPlanes = useMemo(
    () => (config.wireframe ? [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.5)] : []),
    [config.wireframe]
  );
  useEffect(() => {
    terrainMaterial.clippingPlanes = clippingPlanes;
  }, [terrainMaterial, clippingPlanes]);

  return (
    <group>
      <mesh geometry={terrainGeometry} material={terrainMaterial} />
      <mesh geometry={outerHills} material={terrainMaterial} />
      <primitive object={rocks} />
      <Sanctuary />
      <Ermida />
      <Town night={night} />
      <Funicular night={night} />
      <Lighthouse night={night} />
    </group>
  );
}
