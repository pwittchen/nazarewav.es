import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ERMIDA,
  FORT_POSITION,
  FUNICULAR,
  HARBOUR_LIGHTS,
  LARGO,
  SANCTUARY,
  SURFACE,
  terrainHeight,
  surfaceAt,
  townShoreZ,
  segmentDistance,
  clamp,
  createRandom,
} from '../utils/terrain';
import { buildings, type Building } from '../utils/geodata';
import { createInstancedMesh, createHouseMeshes, createLightPoints, disposeObject, type InstanceSpec } from '../utils/instancing';

interface TownProps {
  night: boolean;
}

const wallColors = ['#f6f3ee', '#f4f1ea', '#efe9dc', '#f2efe8', '#ece2c8', '#f1e3b5', '#dfe8ec', '#f3e1d3']
  .map((c) => new THREE.Color(c));
// Facades clad in azulejo tiles
const tileColors = ['#5f86b3', '#6f9a86', '#c9a24a'].map((c) => new THREE.Color(c));
const roofColors = ['#b4552f', '#a34a2a', '#c0683d', '#9b4528'].map((c) => new THREE.Color(c));

// North of here the coast is Praia do Norte, with only kiosks and car parks on the sand
const TOWN_NORTH = -560;

/** Modelled separately, so their OSM footprints are skipped */
function hasOwnModel({ x, z }: Building) {
  const { lower, upper } = FUNICULAR;
  return Math.hypot(x - SANCTUARY.x, z - SANCTUARY.z) < 32
    || Math.hypot(x - FORT_POSITION.x, z - FORT_POSITION.z) < 45
    || Math.hypot(x - ERMIDA.x, z - ERMIDA.z) < 8
    || Math.hypot(x - lower.x, z - lower.z) < 10
    || Math.hypot(x - upper.x, z - upper.z) < 10
    || (x > LARGO.minX && x < LARGO.maxX && z > LARGO.minZ && z < LARGO.maxZ)
    || segmentDistance(x, z, lower.x, lower.z, upper.x, upper.z).dist < 6;
}

/** Sand close by on the seaward side: the blocks of the seafront Avenida da República */
function onSeafront({ x, z, width, depth }: Building) {
  if (x > TOWN_NORTH || width * depth < 90) return false;
  return [40, 70, 100].some((d) => (surfaceAt(x, z - d) & SURFACE.classMask) === SURFACE.beach);
}

/**
 * Nazaré, the Sítio and Pederneira: one house per OSM footprint, at its real position
 * and street alignment, with mapped floors or a typical 2-3 storeys and taller seafront blocks.
 */
function createTownHouses() {
  const rand = createRandom(1912);
  const walls: InstanceSpec[] = [];
  const roofs: InstanceSpec[] = [];
  const lights: THREE.Vector3[] = [];

  for (const building of buildings) {
    if (hasOwnModel(building)) continue;
    const { x, z, width, depth, angle, levels } = building;
    const cos = Math.cos(angle) / 2;
    const sin = Math.sin(angle) / 2;
    // Sit on the lowest corner so houses on the slope never float
    const y = Math.min(
      terrainHeight(x + width * cos - depth * sin, z + width * sin + depth * cos),
      terrainHeight(x + width * cos + depth * sin, z + width * sin - depth * cos),
      terrainHeight(x - width * cos - depth * sin, z - width * sin + depth * cos),
      terrainHeight(x - width * cos + depth * sin, z - width * sin - depth * cos),
    ) - 0.8;
    const big = width * depth > 400;
    const storeys = levels || (onSeafront(building) ? 4 + Math.floor(rand() * 4) : big ? 2 : 2 + Math.floor(rand() * 2.3));
    const height = storeys * 3 + 0.8;
    walls.push({
      position: new THREE.Vector3(x, y, z),
      rotationY: -angle,
      scale: new THREE.Vector3(width, height, depth),
      color: !big && rand() < 0.08 ? tileColors[Math.floor(rand() * tileColors.length)] : wallColors[Math.floor(rand() * wallColors.length)],
    });
    // Most houses have hipped tile roofs, the taller blocks flat roof terraces
    if (storeys <= 3 ? rand() < 0.85 : rand() < 0.25) {
      roofs.push({
        position: new THREE.Vector3(x, y + height, z),
        rotationY: -angle,
        scale: new THREE.Vector3(width * 1.06, Math.min(1.4 + rand() * 1.2, 0.3 * Math.min(width, depth) + 0.6), depth * 1.06),
        color: roofColors[Math.floor(rand() * roofColors.length)],
      });
    }
    if (rand() < 0.5) {
      lights.push(new THREE.Vector3(x, y + 2.5 + Math.floor(rand() * storeys) * 3, z - depth / 2 - 0.3));
    }
  }

  return { meshes: createHouseMeshes(walls, roofs), lights };
}

/** Traditional Nazaré fishing boat: brightly painted hull with a tall pointed bow */
function createBoatGeometry() {
  const shape = new THREE.Shape([
    new THREE.Vector2(-3.6, 0.35),
    new THREE.Vector2(-2.6, 0),
    new THREE.Vector2(2.5, 0),
    new THREE.Vector2(3.5, 0.5),
    new THREE.Vector2(4.1, 2.1),
    new THREE.Vector2(3.5, 1.15),
    new THREE.Vector2(-3.2, 1.0),
    new THREE.Vector2(-3.9, 1.5),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -0.5);
  // Taper towards bow, stern and keel
  const position = geo.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const width = 2 * (1 - 0.75 * (x / 4.1) ** 2) * (0.45 + 0.55 * clamp(y, 0, 1));
    position.setZ(i, position.getZ(i) * width);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Striped canvas beach tents (barracas) in rows on the sand */
function createTentGeometry() {
  const body = new THREE.BoxGeometry(2.2, 1.7, 2.2);
  body.translate(0, 0.85, 0);
  const top = new THREE.ConeGeometry(1.6, 0.8, 4);
  top.rotateY(Math.PI / 4);
  top.translate(0, 2.1, 0);
  const geo = mergeGeometries([body, top]);
  body.dispose();
  top.dispose();
  return geo;
}

function createBeach() {
  const rand = createRandom(1640);
  const boats: InstanceSpec[] = [];
  const tents: InstanceSpec[] = [];
  const hullColors = ['#1f5fa8', '#c62d2d', '#e7b416', '#2f8f4e', '#f2f2ee', '#2b2f6b', '#d8642a'].map((c) => new THREE.Color(c));
  const canvasColors = ['#2c64b5', '#d23b3b', '#f0f0ea', '#e9a52a', '#2f8a5b'].map((c) => new THREE.Color(c));

  // Fishing boats hauled up on the south end of the beach, bows to the sea
  for (let x = -1760; x < -1540; x += 6 + rand() * 6) {
    const z = townShoreZ(x) + 40 + rand() * 30;
    const size = 0.85 + rand() * 0.3;
    boats.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) - 0.15, z),
      rotationY: Math.PI / 2 + (rand() - 0.5) * 0.5,
      scale: new THREE.Vector3(size, size, size),
      color: hullColors[Math.floor(rand() * hullColors.length)],
    });
  }

  // Two rows of tents in front of the town centre
  for (const row of [40, 44]) {
    for (let x = -1400; x < -900; x += 3) {
      if (rand() < 0.12) continue;
      const z = townShoreZ(x) + row;
      tents.push({
        position: new THREE.Vector3(x, terrainHeight(x, z) - 0.1, z),
        rotationY: 0,
        scale: new THREE.Vector3(1, 1, 1),
        color: canvasColors[Math.floor(rand() * canvasColors.length)],
      });
    }
  }

  return [
    createInstancedMesh(createBoatGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), boats),
    createInstancedMesh(createTentGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.9 }), tents),
  ];
}

/** Red or green striped beacon on a mole head, flashing every 4 seconds at night */
function HarbourLight({ x, z, color, night }: TownProps & (typeof HARBOUR_LIGHTS)[number]) {
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (lampRef.current) lampRef.current.emissiveIntensity = night && clock.elapsedTime % 4 < 1 ? 4 : 0;
  });

  return (
    <group position={[x, Math.max(terrainHeight(x, z), 3.4), z]}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 1 + i * 2, 0]}>
          <cylinderGeometry args={[0.8 - i * 0.06, 0.85 - i * 0.06, 2, 16]} />
          <meshStandardMaterial color={i % 2 ? '#f2f0ea' : color} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 8.6, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 1.2, 12]} />
        <meshStandardMaterial ref={lampRef} color={color} emissive={color} emissiveIntensity={0} />
      </mesh>
    </group>
  );
}

export function Town({ night }: TownProps) {
  const houses = useMemo(() => createTownHouses(), []);
  const lights = useMemo(() => createLightPoints(houses.lights), [houses]);
  const beach = useMemo(() => createBeach(), []);

  useEffect(() => () => {
    [...houses.meshes, ...beach, lights].forEach(disposeObject);
  }, [houses, beach, lights]);

  return (
    <group>
      {houses.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      {beach.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      {night && <primitive object={lights} />}
      {HARBOUR_LIGHTS.map((light) => <HarbourLight key={light.x} {...light} night={night} />)}
    </group>
  );
}
